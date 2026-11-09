/**
 * **어텐션 추천 신경망의 강화학습 일꾼** (scripts/ppo_attn.py 가 띄운다) — 지금 정책으로 가상 운전자를 60판씩 가르치며 판마다 적는다:
 * 어텐션이 견준 판들(갈래마다 위 `perClass` 판 — 반정밀도) · 상황 입력 · 고른 판과 그 로그 확률 · 비평가가 볼 가상 운전자의 속
 * (scripts/recommendValue.ts 의 valueState — 가치 신경망과 같은 입력) · 그 판의 보상.
 *
 * 견준 판들은 정책이 바뀌어도 그대로 둔다 — 파이썬은 그 묶음에서 마지막 점수만 다시 센다 (먼저 보는 점수로 추리는 일은 한 차례 안에서
 * 거의 바뀌지 않는다). 보상은 더 알게 된 개념의 기댓값 + `--levelW` × 레벨 나아감 (recommendSim.ts 의 rewardWorth).
 *
 * **사용자가 정한 약속도 함께 적는다** (2026-11-04) — 보상만 좇으면 어텐션이 무신호 보호구역의 바닥(세 판째 없으면 그 판)을 62% 만
 * 지켰다(행동 복제 82%, 프로그램 · 로컬 신경망 100%). 그래서 판마다 ① 그 판이 바닥 차례를 채우는가(견준 판마다 — 신호기 없는
 * 보호구역) ② 로컬 신경망의 차례 신경망이 그 자리에서 갈래에 주는 확률 ③ 같은 자리에서 프로그램이 고른 판의 갈래를 적어, 파이썬이
 * 바닥과 갈래 비율을 벌점으로 지키게 한다. 바닥 차례는 프로그램과 같은 뜻이다 — 계획의 noSignalZoneDue(우회전 전용 갈래는 빼고),
 * 마스터 운행은 빼고(masterPick 은 바닥을 걸지 않는다). 보호구역 전용 도로의 차례는 갈래 설정 '자동' 이 탈 수 있는 판 자체를 그
 * 갈래로 좁히므로(tracks.ts) 따로 걸지 않는다.
 *
 *   node ppo-attn-rollout.mjs --model m.json --iter 3 --worker 0 --jobs 20 --episodes 1000 --pool 500 --out DIR
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REC_FEATURES, TURN_CLASSES, turnProbs } from '../src/ai/recommendNet';
import { attentionScores, type AttnModel } from '../src/ai/recommendAttention';
import type { LibraryEntry } from '../src/scenarios/library';
import type { Difficulty } from '../src/scenarios/curriculum';
import { isNoSignalZone, zoneKindOf } from '../src/scenarios/library';
import { turnClassOf, turnInputs } from '../src/scenarios/recommend';
import { sceneCtx } from './attnPolicy';
import {
  TRAIN_KIND,
  decide,
  featureRows,
  installSim,
  knownCount,
  makeEpisode,
  pinEpisode,
  play,
  programPick,
  rewardWorth,
  rng,
  seedGame,
  type Episode,
  type RewardWeights,
} from './recommendSim';
import { VALUE_RUNS, valueState } from './recommendValue';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const sarg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const WORKER = arg('worker', 0);
const JOBS = arg('jobs', 1);
const ITER = arg('iter', 0);
const EPISODES = arg('episodes', 1000);
const POOL = arg('pool', 500);
/** 가르칠 사람 — 4천만 + 차례 × 10만 (견주기 900만 · 행동 복제 300만 · 가치 신경망 500만 · 판마다 채점하는 신경망의 강화학습 2천만~과 겹치지 않게) */
const SEED_BASE = arg('seedBase', 40_000_000 + ITER * 100_000);
const OUT = sarg('out')!;
const model = JSON.parse(readFileSync(sarg('model')!, 'utf8')) as AttnModel;
const W: RewardWeights = { learn: 0, know: 1, retain: 0, level: arg('levelW', 0.05), debt: 0, novel: 0, frust: 0 };
const NF = REC_FEATURES.length;
const S_MAX = (model.perClass ?? 24) * TURN_CLASSES.length;

const sample = <T>(xs: readonly T[], n: number, r: () => number): T[] => {
  if (xs.length <= n) return [...xs];
  const a = [...xs];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(r() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
};
const draw = (w: readonly number[], r: () => number): number => {
  let u = r() * w.reduce((x, y) => x + y, 0);
  for (let i = 0; i < w.length; i++) {
    u -= w[i];
    if (u <= 0 && w[i] > 0) return i;
  }
  return w.reduce((best, x, i) => (x > w[best] ? i : best), 0);
};

installSim();
/*
  **한 레벨에 오래 머무는 운전자의 흐름** (`--augFlows` 명 × `--augRuns` 판, 2026-11-04) — 보상 없이 약속(바닥 · 갈래 비율)만 배우는 자리.
  보통 운전자는 몇 판 만에 레벨을 지나가서, 100차례 학습한 어텐션은 학습 자리에서 바닥을 99% 지키고도 다양성 검사(한 레벨에 400판)의
  L6 에서는 23% 만 지켰다 — 처음 보는 자리였다. 차례 신경망도 같은 까닭으로 recommendSim.ts 의 pinEpisode 운전자를 섞어 배웠다.
  절반은 습관을 지운다 (검사는 습관이 없다). 씨앗은 7억부터 — 다른 학습 · 견주기와 겹치지 않는다.
*/
const AUG_FLOWS = arg('augFlows', 0);
const AUG_RUNS = arg('augRuns', 120);
const AUG_BASE = 700_000_000 + ITER * 10_000;
const maxDec = Math.ceil(EPISODES / JOBS) * VALUE_RUNS + Math.ceil(AUG_FLOWS / JOBS) * AUG_RUNS;
const rows = new Float16Array(maxDec * S_MAX * NF);
const nsel: number[] = [];
const chosen: number[] = [];
const lp: number[] = [];
const ctxs: number[] = [];
const crit: number[] = [];
const reward: number[] = [];
const done: number[] = [];
const epIdx: number[] = [];
/** 견준 판마다 갈래 번호(빈자리 −1) · 바닥 차례를 채우는가 */
const tcls = new Int8Array(maxDec * S_MAX).fill(-1);
const tok = new Uint8Array(maxDec * S_MAX);
/** 판마다 — 바닥 차례인가 · 차례 신경망의 갈래 확률(견준 판에 있는 갈래로 다시 맞춤) */
const due: number[] = [];
const prior: number[] = [];
/** 같은 자리에서 프로그램이 고른 판의 갈래 (견준 판에 그 갈래가 없으면 −1) — 프로그램의 갈래 비율을 따라 배우는 표본 하나 */
const pcls: number[] = [];
/** 한 레벨에 머무는 흐름의 판인가 (1 이면 보상 · PPO 에 쓰지 않고 약속 벌점에만) */
const aug: number[] = [];
const episodes: { seed: number; ret: number; known: number; level: number; steps: number; due: number; met: number }[] = [];
const flows: { level: number; runs: number; zone: number; noSig: number; due: number; met: number }[] = [];

/** 한 판을 고르고 적는다 — 고른 판 · 바닥 차례였는가 · 채웠는가 */
function step(ep: Episode, run: number, r: () => number, isAug: boolean): { entry: LibraryEntry; isDue: boolean; filled: boolean } | null {
  // 프로그램의 갈래를 세려면 프로그램의 최종 후보가 있어야 한다 (decide 의 셋째 인자)
  const d = decide(ep, false, true);
  if (!d.pool.length) return null;
  const cands: LibraryEntry[] = sample(d.pool, POOL, r);
  const ctx = sceneCtx(d);
  const feats = featureRows(d, cands);
  const classes = cands.map((e) => TURN_CLASSES.indexOf(turnClassOf(e)));
  const { final } = attentionScores(feats, model, { classes, ctx });
  const sel = final.map((v, k) => (Number.isFinite(v) ? k : -1)).filter((k) => k >= 0);
  const top = Math.max(...sel.map((k) => final[k]));
  const ex = sel.map((k) => Math.exp(final[k] - top));
  const z = ex.reduce((a, b) => a + b, 0);
  const c = draw(ex, r);
  const at = nsel.length;
  sel.forEach((k, j) => rows.set(feats[k], (at * S_MAX + j) * NF));
  // 바닥 차례면 그 차례를 채우는 판 (recommend.ts 의 aiCourses 가 '차례라서 골랐다' 고 말하는 것과 같은 뜻)
  const isDue = !!d.plan.noSignalZoneDue && !d.plan.master;
  const fills = (e: LibraryEntry) => isNoSignalZone(e.tags);
  sel.forEach((k, j) => {
    tcls[at * S_MAX + j] = classes[k];
    tok[at * S_MAX + j] = isDue && fills(cands[k]) ? 1 : 0;
  });
  due.push(isDue ? 1 : 0);
  const present = new Set(sel.map((k) => classes[k]));
  const tp = turnProbs(turnInputs(d.plan, d.turns, d.cover), new Set(d.pool.map(turnClassOf))).map((q, k) => (present.has(k) ? q : 0));
  const tz = tp.reduce((a, b) => a + b, 0);
  prior.push(...tp.map((q) => (tz > 0 ? q / tz : 0)));
  const pc = TURN_CLASSES.indexOf(turnClassOf(programPick(d)));
  pcls.push(present.has(pc) ? pc : -1);
  nsel.push(sel.length);
  chosen.push(c);
  lp.push(Math.log(Math.max(1e-12, ex[c] / z)));
  ctxs.push(...ctx);
  crit.push(...valueState(ep, Math.min(run, VALUE_RUNS - 1)));
  aug.push(isAug ? 1 : 0);
  const entry = cands[sel[c]];
  return { entry, isDue, filled: isDue && fills(entry) };
}

for (let i = WORKER; i < EPISODES; i += JOBS) {
  const seed = SEED_BASE + i;
  const ep = makeEpisode(seed, TRAIN_KIND);
  seedGame(seed);
  const r = rng(seed * 977 + 1);
  const known0 = knownCount(ep.learner);
  let w = rewardWorth(ep, W);
  const w0 = w;
  let steps = 0;
  let dues = 0;
  let met = 0;
  for (let run = 0; run < VALUE_RUNS; run++) {
    const got = step(ep, run, r, false);
    if (!got) break;
    if (got.isDue) dues += 1;
    if (got.filled) met += 1;
    play(ep, got.entry);
    const w1 = rewardWorth(ep, W);
    reward.push(w1 - w);
    w = w1;
    done.push(0);
    epIdx.push(episodes.length);
    steps += 1;
  }
  if (steps) done[done.length - 1] = 1;
  const cur = ep.save.curriculum;
  episodes.push({ seed, ret: w - w0, known: knownCount(ep.learner) - known0, level: cur.level + (cur.mastered ? 1 : 0), steps, due: dues, met });
}

for (let f = WORKER; f < AUG_FLOWS; f += JOBS) {
  const seed = AUG_BASE + f;
  const ep = makeEpisode(seed, TRAIN_KIND);
  seedGame(seed);
  const r = rng(seed * 31 + 7);
  const level = (1 + Math.floor(r() * 10)) as Difficulty;
  const clean = r() < 0.5;
  pinEpisode(ep, level);
  const fl = { level, runs: 0, zone: 0, noSig: 0, due: 0, met: 0 };
  for (let run = 0; run < AUG_RUNS; run++) {
    if (clean) ep.save.curriculum = { ...ep.save.curriculum, badHabits: [] };
    const got = step(ep, run, r, true);
    if (!got) break;
    const kind = zoneKindOf(got.entry.tags);
    fl.runs += 1;
    if (kind !== 'none') fl.zone += 1;
    if (kind === 'noSignal') fl.noSig += 1;
    if (got.isDue) fl.due += 1;
    if (got.filled) fl.met += 1;
    play(ep, got.entry);
    reward.push(0);
    done.push(1);
    epIdx.push(-1);
  }
  flows.push(fl);
}

const f32 = (xs: ArrayLike<number>): Float32Array => new Float32Array(xs);
const out = resolve(OUT, `w${WORKER}`);
writeFileSync(`${out}-rows.f16`, rows.subarray(0, nsel.length * S_MAX * NF));
writeFileSync(`${out}-nsel.f32`, f32(nsel));
writeFileSync(`${out}-chosen.f32`, f32(chosen));
writeFileSync(`${out}-lp.f32`, f32(lp));
writeFileSync(`${out}-ctx.f32`, f32(ctxs));
writeFileSync(`${out}-crit.f32`, f32(crit));
writeFileSync(`${out}-reward.f32`, f32(reward));
writeFileSync(`${out}-done.f32`, f32(done));
writeFileSync(`${out}-ep.f32`, f32(epIdx));
writeFileSync(`${out}-tcls.i8`, tcls.subarray(0, nsel.length * S_MAX));
writeFileSync(`${out}-tok.u8`, tok.subarray(0, nsel.length * S_MAX));
writeFileSync(`${out}-due.f32`, f32(due));
writeFileSync(`${out}-prior.f32`, f32(prior));
writeFileSync(`${out}-pcls.f32`, f32(pcls));
writeFileSync(`${out}-aug.f32`, f32(aug));
writeFileSync(`${out}.json`, JSON.stringify({ decisions: nsel.length, sMax: S_MAX, features: NF, ctx: ctxs.length / Math.max(1, nsel.length), crit: crit.length / Math.max(1, nsel.length), episodes, flows }));
process.exit(0);
