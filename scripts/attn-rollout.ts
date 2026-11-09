/**
 * **어텐션 추천 신경망의 학습 자료** (scripts/train-recommend-attn.py 가 일꾼으로 띄운다).
 *
 * 가상 운전자를 과정대로 가르치며, 고를 차례의 절반쯤에 **전문가(예전 프로그램 — recommendSim.ts 의 programPick)가 고른 판**과
 * 그 갈래의 판들을 함께 적는다. 어텐션 신경망은 후보들을 한꺼번에 보므로 오답 몇 개가 아니라 **그 갈래의 판 전부**(많으면 `--cap`
 * 판 — 전문가가 고른 판 · 같은 갈래의 최종 후보는 늘 넣는다)를 한 묶음으로 둔다. 묶음의 맨 앞이 전문가가 고른 판이다.
 * 첫 차례는 프로그램이, 둘째 차례부터는 방금 배운 어텐션 신경망이 운전자를 가르친다 (DAgger — 스스로 만든 상황에서도 배우게).
 *
 * `--teacher 모델.json` 이면 전문가가 프로그램이 아니라 **프로그램을 이긴 판마다 채점 신경망**이다 (attnPolicy.ts 의 netPick). 프로그램을 따라 배운
 * 어텐션은 프로그램에 못 미치고, 그 위의 강화학습은 90차례 동안 평평했다(2026-11-04) — 더 나은 스승에게서 배운다. 앱에는 어텐션 하나만 들어간다.
 * 그때 묶음은 게임에서 어텐션이 볼 판과 같은 꼴로 — 갈래마다 `POOL` 판을 스승이 채점해 위 `--top` 판 + 무작위 — 두고, 스승이 갈래마다 준 확률을
 * -tprob 에 적는다 (scripts/train-recommend-attn.py 의 `--soft`).
 *
 *   node attn-rollout.mjs --round 0 --worker 0 --jobs 20 --learners 800 [--model m.json] --out DIR
 *
 * 쓰는 것 (Float32): w{k}-rows (판마다 특징), -n (묶음의 판 수), -short (맨 앞부터 최종 후보인 판 수), -class (갈래 안 판 수),
 * -turn (차례 신경망 입력), -avail (탈 수 있는 갈래), -cls (전문가의 갈래) · w{k}.json (차례 수)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REC_FEATURES, TURN_CLASSES, TURN_FEATURES } from '../src/ai/recommendNet';
import type { AttnModel } from '../src/ai/recommendAttention';
import { scoreCourses, turnProbs, type RecommendModel } from '../src/ai/recommendNet';
import type { Difficulty } from '../src/scenarios/curriculum';
import type { LibraryEntry } from '../src/scenarios/library';
import { turnClassOf, turnInputs } from '../src/scenarios/recommend';
import { attnPick, netPick } from './attnPolicy';
import { POOL, TRAIN_KIND, decide, featureRows, installSim, makeEpisode, pinEpisode, play, programPick, rng, seedGame, turnRow } from './recommendSim';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const sarg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const ROUND = arg('round', 0);
const WORKER = arg('worker', 0);
const JOBS = arg('jobs', 1);
const LEARNERS = arg('learners', 800);
const RUNS = arg('runs', 70);
const CAP = arg('cap', 256);
/**
 * **하나로 고르는 모델의 자료** (`--global 1`) — 묶음이 모든 갈래에 걸친다: 전문가가 고른 판, 최종 후보(모든 갈래), 그리고 갈래마다
 * 무작위로 `--perClass` 판까지. 판마다 갈래를 함께 적는다 (-rowcls). 갈래 신경망은 따로 배우지 않는다.
 */
const GLOBAL = arg('global', 0);
const PER_CLASS = arg('perClass', 64);
const LABEL_P = arg('label', 0.5);
const EXPLORE = arg('explore', 0.1);
const PLATEAU = arg('plateau', 0.3);
/** 한 레벨에 머무는 운전자의 판 수 — 다양성 테스트가 한 레벨에 오래 머무는 자리를 본다 */
const PLATEAU_RUNS = arg('plateauRuns', RUNS);
const TOP = arg('top', 40);
const OUT = sarg('out')!;
const modelPath = sarg('model');
const model = modelPath ? (JSON.parse(readFileSync(modelPath, 'utf8')) as AttnModel) : null;
const teacherPath = sarg('teacher');
const teacher = teacherPath ? (JSON.parse(readFileSync(teacherPath, 'utf8')) as RecommendModel) : null;
const NF = REC_FEATURES.length;

installSim();
const maxDec = Math.ceil(LEARNERS / JOBS) * Math.max(RUNS, PLATEAU_RUNS);
const rows = new Float32Array(maxDec * CAP * NF);
let at = 0;
const ns: number[] = [];
const shorts: number[] = [];
const classes: number[] = [];
const turns: number[] = [];
const avails: number[] = [];
const clss: number[] = [];
const rowCls: number[] = [];
const tProbs: number[] = [];

const shuffle = <T>(xs: T[], r: () => number): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
};

for (let i = WORKER; i < LEARNERS; i += JOBS) {
  // 씨앗은 300만 + 차례 × 10만 — 견주기(100만 · 200만 · 900만) · 가치 신경망(500만) · 강화학습(2천만~)과 겹치지 않게
  const seed = 3_000_000 + ROUND * 100_000 + i;
  const ep = makeEpisode(seed, TRAIN_KIND);
  const r = rng(seed * 31 + 7);
  const pinned = r() < PLATEAU;
  if (pinned) pinEpisode(ep, (2 + Math.floor(r() * 9)) as Difficulty);
  seedGame(seed);
  for (let run = 0; run < (pinned ? PLATEAU_RUNS : RUNS); run++) {
    const d = decide(ep, false, true);
    if (!d.pool.length) break;
    seedGame(seed * 1000 + run);
    const expert = teacher ? netPick(d, teacher, r, POOL) : programPick(d);
    seedGame(seed * 1000 + run + 1);
    const label = d.pool.length > 1 && r() < LABEL_P;
    if (label && GLOBAL) {
      const short = d.plan.master ? [] : d.courses.filter((e) => e !== expert);
      const takenIds = new Set([expert, ...short].map((e) => e.spec.id));
      const extra: LibraryEntry[] = [];
      for (const c of TURN_CLASSES) {
        const inC = shuffle(
          d.pool.filter((e) => turnClassOf(e) === c && !takenIds.has(e.spec.id)),
          r,
        );
        if (teacher) {
          const head = inC.slice(0, POOL);
          const s = scoreCourses(featureRows(d, head), teacher);
          const best = new Set(
            head
              .map((_, i) => i)
              .sort((x, y) => s[y] - s[x])
              .slice(0, TOP),
          );
          extra.push(...head.filter((_, i) => best.has(i)), ...head.filter((_, i) => !best.has(i)).slice(0, PER_CLASS - TOP));
        } else extra.push(...inC.slice(0, PER_CLASS));
      }
      const set: LibraryEntry[] = [expert, ...short, ...extra].slice(0, CAP);
      const feats = featureRows(d, set);
      for (const x of feats) {
        rows.set(x, at);
        at += NF;
      }
      for (const e of set) rowCls.push(TURN_CLASSES.indexOf(turnClassOf(e)));
      ns.push(set.length);
      shorts.push(Math.min(set.length, 1 + short.length));
      // 전문가 갈래의 판 수 (탈 수 있는 판 가운데) — 먼저 보는 점수의 표본 보정에 쓴다
      const ec = turnClassOf(expert);
      classes.push(Math.max(1, d.pool.filter((e) => turnClassOf(e) === ec).length));
      turns.push(...turnRow(d));
      const have = new Set(d.pool.map(turnClassOf));
      for (const c of TURN_CLASSES) avails.push(c === ec || have.has(c) ? 1 : 0);
      clss.push(TURN_CLASSES.indexOf(ec));
      if (teacher) tProbs.push(...turnProbs(turnInputs(d.plan, d.turns, d.cover), have, teacher));
    } else if (label) {
      const cls = turnClassOf(expert);
      // 마스터 운행의 전문가(masterPick)는 최종 후보 밖에서 고르므로 그때는 묶음에 최종 후보를 따로 두지 않는다
      const short = d.plan.master ? [] : d.courses.filter((e) => e !== expert && turnClassOf(e) === cls);
      const shortIds = new Set([expert, ...short].map((e) => e.spec.id));
      const rest = shuffle(
        d.pool.filter((e) => turnClassOf(e) === cls && !shortIds.has(e.spec.id)),
        r,
      );
      const set: LibraryEntry[] = [expert, ...short, ...rest].slice(0, CAP);
      const feats = featureRows(d, set);
      for (const x of feats) {
        rows.set(x, at);
        at += NF;
      }
      ns.push(set.length);
      shorts.push(Math.min(set.length, 1 + short.length));
      classes.push(1 + short.length + rest.length);
      turns.push(...turnRow(d));
      const have = new Set(d.pool.map(turnClassOf));
      for (const c of TURN_CLASSES) avails.push(c === cls || have.has(c) ? 1 : 0);
      clss.push(TURN_CLASSES.indexOf(cls));
    }
    let e: LibraryEntry;
    if (r() < EXPLORE) e = d.pool[Math.floor(r() * d.pool.length)];
    else if (model) e = attnPick(d, model, r, POOL);
    else e = expert;
    play(ep, e);
  }
}

const base = resolve(OUT, `w${WORKER}`);
writeFileSync(`${base}-rows.f32`, rows.subarray(0, at));
writeFileSync(`${base}-n.f32`, new Float32Array(ns));
writeFileSync(`${base}-short.f32`, new Float32Array(shorts));
writeFileSync(`${base}-class.f32`, new Float32Array(classes));
writeFileSync(`${base}-turn.f32`, new Float32Array(turns));
writeFileSync(`${base}-avail.f32`, new Float32Array(avails));
writeFileSync(`${base}-cls.f32`, new Float32Array(clss));
if (GLOBAL) writeFileSync(`${base}-rowcls.f32`, new Float32Array(rowCls));
if (teacher) writeFileSync(`${base}-tprob.f32`, new Float32Array(tProbs));
writeFileSync(`${base}.json`, JSON.stringify({ decisions: ns.length, names: REC_FEATURES, turnNames: TURN_FEATURES, classes: TURN_CLASSES }));
process.exit(0);
