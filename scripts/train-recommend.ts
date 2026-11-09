/**
 * **다음 판 추천 신경망 학습 — 가상 운전자에게 과정 전문가를 따라 배운다 (행동 복제).**
 *
 *   npm run train:recommend                                     # 기본: 세 차례 × 가상 운전자 600명 (씨앗 고정)
 *   npx vite-node scripts/train-recommend.ts --learners 60 --eval 40   # 빨리 (검증용)
 *
 * 1. **가상 운전자**(scripts/recommendSim.ts — 개념마다 진짜 실력 · 배우는 빠르기 · 잊는 빠르기가 다르다)에게 판을 골라 주며
 *    과정을 밟게 한다. 첫 차례는 예전의 규칙 · 프로그램 점수(과정 전문가)가, 둘째 · 셋째 차례는 방금 배운 신경망이 고른다.
 * 2. 고를 차례마다 절반쯤은 **과정 전문가가 이 상황에서 고를 판**을 정답으로 적고, 탈 수 있는 판에서 고르게 곁들인다
 *    (recommendSim.ts 의 bcSet — 같은 갈래에서 31판). 전문가는 레벨 · 습관 · 차례(주사위)로 후보를 거르고 프로그램 점수로 고른다 — 그 규칙은 학습 때
 *    정답을 대는 데만 쓰이고 게임에서는 돌지 않는다.
 * 3. 두 신경망이 **브라우저가 아는 것만으로**(src/ai/recommendNet.ts 의 특징) 배운다 — 차례 신경망(은닉 24 · 갈래 일곱)은 정답 판의
 *    갈래를, 추천 신경망(은닉 32 · 점수 하나)은 **같은 갈래의** 판들 가운데 정답 판을. 둘 다 소프트맥스를 씌운 분포의 정답 쪽 로그
 *    확률을 키운다.
 * 4. **둘째 차례부터**는 신경망이 직접 고르며 만난 상황에서 전문가의 정답을 다시 받아 앞 차례들과 합쳐 배운다 (DAgger —
 *    따라 하는 쪽이 스스로 만든 상황에서 틀리는 것을 막는다).
 * 5. **처음 보는 운전자**로 무작위 · 전문가(예전 프로그램) · 신경망을 견준다 — 같은 사람(같은 씨앗)을 셋이 따로 가르쳐 본다.
 *    학습에 쓴 종류의 운전자와, 더 느리게 익히고 더 빨리 잊는 **처음 보는 종류**의 운전자 둘 다. 보호구역 · 무신호 · 앞차가
 *    나온 비율도 함께 센다.
 *
 * 한때는 교사(후보마다 64번 달려 하루 뒤 남을 실력 등으로 채점)를 따라 배우게 했는데, 후보 추리기까지 맡기자 쉬운 판으로 몰려
 * 레벨이 프로그램보다 1.25 낮았다 (recommendSim.ts 의 교사 주석). 교사는 남겨 두었다 — 여러 판 앞을 보는 강화학습에 다시 쓴다.
 *
 * 병렬: 일을 나눠 같은 명령을 `--worker` 로 여럿 띄운다 (`--jobs`, 기본 코어 수 − 2).
 * 결과(src/ai/models/recommend.json)는 저장소에 커밋한다 — 브라우저는 학습하지 않고 가중치만 읽는다.
 * **특징을 바꾸면 다시 학습해야 한다** — tests/recommendNet.test.ts 가 이름이 어긋나면 잡는다.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REC_FEATURES,
  TURN_CLASSES,
  TURN_FEATURES,
  scoreCourses,
  turnProbs,
  type RecommendModel,
  type TurnNet,
} from '../src/ai/recommendNet';
import { isNoSignalZone, zoneKindOf, type LibraryEntry } from '../src/scenarios/library';
import { NO_SIGNAL_ZONE_GAP, noSignalZoneOpen, rulePick, turnClassOf, turnInputs } from '../src/scenarios/recommend';
import type { Difficulty } from '../src/scenarios/curriculum';
import { practiceTrack } from '../src/scenarios/trackPick';
import {
  SHIFTED_KIND,
  TRAIN_KIND,
  decide,
  featureRows,
  installSim,
  knownCount,
  makeEpisode,
  pinEpisode,
  play,
  bcSet,
  POOL,
  programPick,
  rng,
  seedGame,
  turnRow,
} from './recommendSim';
import { lookaheadPick, lookaheadValues, type LookaheadOptions, type ValueNet } from './recommendValue';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const sarg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
/** 한 차례에 과정을 밟는 가상 운전자 수 */
const LEARNERS = arg('learners', 600);
/** 한 사람이 밟는 판 수의 상한 */
const MAX_RUNS = arg('runs', 70);
/** 교사에게 묻는 비율 — 이웃한 차례는 비슷해서 다 물을 까닭이 적다 */
const LABEL_P = arg('label', 0.5);
/** 정답 판에 곁들이는 다른 판의 수 — 63 이면 세 차례 자료가 4GB 를 넘었다 */
const NEG = arg('neg', 31);
/** 프로그램 · 신경망이 고를 때 이만큼은 무작위로 — 교사가 다양한 상황을 보게 */
const EXPLORE = arg('explore', 0.1);
/** 한 레벨에 오래 머무는 운전자의 몫 (recommendSim.ts 의 pinEpisode) — 학습 자료에만 */
const PLATEAU = arg('plateau', 0.3);
/**
 * 견주기에서 신경망을 **LLM 과 짝을 이루는 후보 신경망**으로 쓴다 — 후보 `--set` 판(10)을 점수에 비례해 뽑고, 마지막은 외부 LLM 을
 * 대신하는 규칙(recommend.ts 의 rulePick)이 고른다 (scripts/ppo-rollout.ts 의 set 모드). 0 이면 신경망이 혼자 한 판을 고른다.
 */
const SET_K = arg('set', 0);
/** 신경망이 한 갈래에서 채점하는 판의 수 (기본 recommendSim.ts 의 POOL) — 강화학습(scripts/ppo-rollout.ts 의 --pool)과 맞춰 견줄 때 */
const NET_POOL = arg('pool', POOL);
/** 추천 신경망이 갈래 안에서 판을 뽑는 온도 — 1 이면 배운 그대로, 작을수록 1등 쪽으로 (차례 신경망은 늘 1) */
const CTEMP = arg('ctemp', 1);
/** 진단 — 갈래는 예전 프로그램이 고른 판의 갈래로, 판만 추천 신경망이 (어디서 프로그램과 갈리는지 가를 때) */
const HYBRID = arg('hybrid', 0);
/**
 * **앞을 내다보는 교사** (scripts/recommendValue.ts) — 가치 신경망 JSON 을 주면 정답을 예전 프로그램 대신 이 교사가 낸다: 프로그램이
 * 추린 후보를 한 판씩 같은 운으로 `--rollouts` 번 달려 보고 (그 판의 보상 + 가치 신경망이 본 그 뒤의 값)이 가장 큰 판. 첫 차례의
 * 운전자도 이 교사가 가르친다. `--lambda` 는 레벨 하나의 무게 (개념 하나를 1 로).
 */
const TEACHER_PATH = sarg('teacher');
const TEACHER: LookaheadOptions | null = TEACHER_PATH
  ? { value: JSON.parse(readFileSync(TEACHER_PATH, 'utf8')) as ValueNet, lambda: arg('lambda', 0.2), rollouts: arg('rollouts', 8) }
  : null;
/** 1 이면 전문가가 견주고도 고르지 않은 최종 후보(같은 갈래)를 오답 앞자리에 둔다 (recommendSim.ts 의 bcSet) */
const HARD = arg('hard', 0);
/**
 * **최종 후보를 정답 묶음으로** (0 ~ 1, 0 이면 끔) — 전문가가 고른 판에 이만큼, 나머지를 같은 갈래의 다른 최종 후보에 고르게 나눠
 * 정답으로 두고(부드러운 정답), 무작위 판에는 갈래 안 판 수만큼의 무게를 준다(표본 소프트맥스 보정). 예전처럼 전문가 한 판만 정답으로,
 * 무작위 31판만 오답으로 두자 신경망은 31판 가운데서는 81% 맞혔지만 게임처럼 갈래 안 판 전부(평균 335판)를 채점하면 확률의
 * 29% 가 프로그램이 후보로도 올리지 않을 판에 실렸고, 그 몫이 프로그램보다 익힌 개념 0.15 를 잃게 했다 — 최종 후보 안에서만
 * 고르게 하면 같은 신경망이 프로그램과 같았다 (2026-11-02). 최종 후보를 오답으로 두면(`--hard`) 그 몫이 66% 로 더 줄었다.
 */
const SET_W = arg('setTarget', 0);
/**
 * **교사 값으로 나눈 최종 후보 정답** (`--teacher` 와 함께, 값은 소프트맥스 온도) — 갈래는 예전 프로그램이 고른 판의 갈래 그대로,
 * 그 갈래의 최종 후보마다 앞을 내다보는 교사의 값(recommendValue.ts 의 lookaheadValues)을 매겨 소프트맥스로 정답 몫을 나눈다.
 * 교사가 고른 한 판을 따라 하게 하면(가상 운전자의 속을 보고 고른 판이라) 신경망이 31% 밖에 못 맞히고 흐려져 프로그램보다
 * 익힌 개념 0.26 · 레벨 0.91 낮았다 — 값을 나눠 주면 신경망은 '보이는 것으로 짐작한 교사 값' 이 큰 쪽을 배운다.
 */
const QSET = arg('qset', 0);
/**
 * **스스로 찾은 어려운 오답** (둘째 차례부터, 값은 개수) — 방금 배운 신경망이 전문가의 갈래에서 판 500개를 채점해 **최종 후보가
 * 아닌데 높게 친 판** 을 오답 앞자리에 둔다. 신경망을 프로그램의 최종 후보 안에서만 고르게 하면 프로그램과 같았는데(+0.01 ± 0.02),
 * 갈래 안 판 전부를 채점하면 확률의 29% 가 최종 후보 밖의 비슷해 보이는 판에 실려 익힌 개념 0.1 남짓을 잃었다 — 바로 그 판들을
 * 오답으로 보여 준다 (검색 모델의 hard negative mining). 최종 후보의 다른 판은 오답으로 두지 않는다 (`--hard` 는 그래서 나빴다).
 */
const MINE = arg('mine', 0);
const ROUNDS = arg('rounds', 3);
const EVAL = arg('eval', 400);
const EVAL_RUNS = arg('evalRuns', 60);
/**
 * 견주기 운전자의 씨앗 바탕 — 늘 같은 400명을 쓰면 그 사람들의 운(주사위)이 모든 견주기에 똑같이 묻어난다. 2026-11-01 에 처음 보는
 * 운전자 400명의 프로그램 결과가 그 판들의 기댓값보다 0.21 높게 나와, 신경망이 매번 0.2 남짓 뒤지는 것처럼 보였다. 다른 사람들로
 * 다시 잴 때 바꾼다 (기본 0 — 예전과 같은 사람들).
 */
const EVAL_SEED = arg('evalSeed', 0);
const EPOCHS = arg('epochs', 20);
const HIDDEN = arg('hidden', 32);
/** 차례 신경망 — 은닉 · 학습 횟수 */
const TURN_HIDDEN = arg('turnHidden', 24);
const TURN_EPOCHS = arg('turnEpochs', 60);
const JOBS = arg('jobs', Math.max(1, cpus().length - 2));
const here = dirname(fileURLToPath(import.meta.url));
const OUT = sarg('save') ?? resolve(here, '../src/ai/models/recommend.json');
const WORK = sarg('work') ?? resolve(here, '../.train-recommend');

const t0 = performance.now();
const secs = () => `${((performance.now() - t0) / 1000).toFixed(0)}초`;
const round4 = (v: number) => +v.toFixed(4);

// ── 일꾼 ─────────────────────────────────────────────────────────────────

/** 고를 차례 하나 — `rows[0]` 이 과정 전문가가 고른 판이다 (같은 갈래의 판들과 함께) */
interface Labeled {
  learner: number;
  level: number;
  rows: number[][];
  /** 차례 신경망의 입력 · 전문가가 고른 판의 갈래 · 탈 수 있는 판이 있던 갈래 (TURN_CLASSES 의 번호) */
  turn: number[];
  cls: number;
  avail: number[];
  /** `--set` 학습 — rows[1..short] 는 전문가의 최종 후보 가운데 같은 갈래의 다른 판 (정답 쪽), 그 뒤는 무작위 판 */
  short?: number;
  /** 무작위 판 하나가 대신하는 갈래 안 판 수의 로그 (표본 소프트맥스 보정 — 게임은 갈래 안 판 전부를 채점한다) */
  negW?: number;
  /** `--qset` 학습 — rows[0..short] (프로그램이 고른 판과 같은 갈래의 최종 후보)의 정답 몫: 교사 값의 소프트맥스 */
  soft?: number[];
}

type Policy = 'random' | 'program' | 'net';

const draw = (w: readonly number[], r: () => number): number => {
  let u = r() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) {
    u -= w[i];
    if (u <= 0 && w[i] > 0) return i;
  }
  return w.reduce((best, v, i) => (v > w[best] ? i : best), 0);
};

/**
 * 고른 판 — 전문가는 예전 규칙 그대로(recommendSim.ts 의 programPick), 신경망은 게임의 aiCourses 처럼 차례 신경망이 갈래를 뽑고
 * 그 갈래에서 `POOL` 판을 뽑아 점수를 확률로 바꿔 뽑는다
 */
function choose(policy: Policy, d: ReturnType<typeof decide>, model: RecommendModel | null, r: () => number): LibraryEntry {
  if (policy === 'random') return d.pool[Math.floor(r() * d.pool.length)];
  if (policy === 'net' && model) {
    const classOf = d.pool.map(turnClassOf);
    const fromProgram = HYBRID ? turnClassOf(programPick(d)) : null;
    const turn =
      fromProgram && classOf.includes(fromProgram)
        ? fromProgram
        : TURN_CLASSES[draw(turnProbs(turnInputs(d.plan, d.turns, d.cover), new Set(classOf), model), r)];
    const inTurn = d.pool.filter((_, i) => classOf[i] === turn);
    const pool: LibraryEntry[] = [];
    if (inTurn.length > NET_POOL) {
      const taken = new Set<number>();
      while (pool.length < NET_POOL) {
        const i = Math.floor(r() * inTurn.length);
        if (taken.has(i)) continue;
        taken.add(i);
        pool.push(inTurn[i]);
      }
    } else pool.push(...inTurn);
    const s = scoreCourses(featureRows(d, pool), model).map((v) => v / CTEMP);
    if (SET_K > 0) {
      const g = s.map((v) => v - Math.log(-Math.log(Math.max(1e-12, r()))));
      const shortlist = g
        .map((_, k) => k)
        .sort((x, y) => g[y] - g[x])
        .slice(0, SET_K)
        .map((k) => pool[k]);
      return rulePick(d.plan, shortlist, r, d.seen, d.cover);
    }
    const top = Math.max(...s);
    return pool[draw(s.map((v) => Math.exp(v - top)), r)];
  }
  return programPick(d);
}

/** 과정을 밟으며 과정 전문가의 정답을 모은다 */
function collect(worker: number, round: number, model: RecommendModel | null): Labeled[] {
  const out: Labeled[] = [];
  for (let i = worker; i < LEARNERS; i += JOBS) {
    const seed = round * 100_000 + i;
    const ep = makeEpisode(seed, TRAIN_KIND);
    const r = rng(seed * 31 + 7);
    if (r() < PLATEAU) pinEpisode(ep, (2 + Math.floor(r() * 9)) as Difficulty);
    seedGame(seed);
    for (let run = 0; run < MAX_RUNS; run++) {
      const d = decide(ep);
      if (!d.pool.length) break;
      let taught: LibraryEntry | null = null;
      if (d.pool.length > 1 && r() < LABEL_P) {
        // 전문가가 이 상황에서 고를 판 — 주사위(차례 · 흔들림)도 함께 굴린다. 그 뒤 과정의 난수를 다시 세운다
        seedGame(seed * 1000 + run);
        const expert = TEACHER && !QSET ? lookaheadPick(ep, d, run, seed, TEACHER) : programPick(d);
        taught = expert;
        let mined: LibraryEntry[] = [];
        if (MINE && model && !d.plan.master) {
          const ec = turnClassOf(expert);
          const shortIds0 = new Set(d.courses.map((e) => e.spec.id));
          let inC = d.pool.filter((e) => turnClassOf(e) === ec && !shortIds0.has(e.spec.id) && e !== expert);
          if (inC.length > 500) {
            for (let k = inC.length - 1; k > 0; k--) {
              const j = Math.floor(r() * (k + 1));
              [inC[k], inC[j]] = [inC[j], inC[k]];
            }
            inC = inC.slice(0, 500);
          }
          const sc = scoreCourses(featureRows(d, inC), model);
          mined = inC
            .map((e, k) => ({ e, v: sc[k] }))
            .sort((a, b) => b.v - a.v)
            .slice(0, MINE)
            .map((x) => x.e);
        }
        const set = bcSet(d, expert, NEG, r, MINE ? mined : HARD || SET_W || QSET ? d.courses : []);
        const rows = featureRows(d, set);
        const cls = TURN_CLASSES.indexOf(turnClassOf(expert));
        const shortIds = new Set(d.courses.map((e) => e.spec.id));
        let short = 0;
        while (short + 1 < set.length && shortIds.has(set[short + 1].spec.id)) short += 1;
        const inClass = d.pool.filter((e) => turnClassOf(e) === TURN_CLASSES[cls] && !shortIds.has(e.spec.id)).length;
        const nRand = set.length - 1 - short;
        const negW = nRand > 0 ? Math.log(Math.max(1, inClass) / nRand) : 0;
        let soft: number[] | undefined;
        if (QSET && TEACHER && !d.plan.master) {
          const q = lookaheadValues(ep, set.slice(0, short + 1), run, seed, TEACHER);
          soft = softmax(q.map((v) => v / QSET)).map(round4);
        }
        const have = new Set(d.pool.map(turnClassOf));
        // 전문가는 규칙이 추린 후보에서 고르므로 탈 수 있는 판 밖의 갈래일 수도 있다 — 그 갈래도 고를 수 있던 것으로 본다
        const avail = TURN_CLASSES.map((_, k) => k).filter((k) => k === cls || have.has(TURN_CLASSES[k]));
        out.push({
          learner: seed,
          level: d.plan.level,
          rows: rows.map((x) => x.map(round4)),
          turn: turnRow(d).map(round4),
          cls,
          avail,
          short,
          negW: round4(negW),
          soft,
        });
        seedGame(seed * 1000 + run + 1);
      }
      const policy: Policy = r() < EXPLORE ? 'random' : model ? 'net' : 'program';
      // 첫 차례(신경망이 없을 때)는 교사가 가르친다 — 교사가 만드는 상황에서 교사의 정답을 배우도록
      if (policy === 'program' && TEACHER && !QSET) {
        if (!taught) {
          taught = lookaheadPick(ep, d, run, seed, TEACHER);
          seedGame(seed * 1000 + run + 1);
        }
        play(ep, taught);
      } else play(ep, choose(policy, d, model, r));
    }
  }
  return out;
}

interface EvalRow {
  kind: 'train' | 'shifted';
  seed: number;
  policy: Policy;
  /** 판 수마다 (EVAL_RUNS/2, EVAL_RUNS) */
  known: number[];
  level: number[];
  mastered: boolean;
  runs: number;
  violations: number;
  frustration: number;
  situations: number;
  known0: number;
  /** 차례 — 두 갈래를 다 연습하는 사람만 센다 (한 갈래만 고르면 보호구역 비율이 뜻이 없다) */
  both: boolean;
  zone: number;
  noSignal: number;
  lead: number;
  /** 차례를 센 판 수 */
  turnRuns: number;
  /** 신호기 없는 보호구역 없이 지나간 가장 긴 판 수 · 그것이 NO_SIGNAL_ZONE_GAP 을 넘은 판 수 */
  maxGap: number;
  overdue: number;
  /** 진단 — 고칠 습관이 있던 판 · 그 판이 그 습관을 시험한 판 · 판마다 새로 알게 될 개념 수의 기댓값(잊음 뺌)의 합 · 최근 20판 되풀이 */
  targets: number;
  hits: number;
  expGain: number;
  replays: number;
}

function evaluate(worker: number, model: RecommendModel): EvalRow[] {
  const out: EvalRow[] = [];
  for (const kind of ['train', 'shifted'] as const) {
    for (let i = worker; i < EVAL; i += JOBS) {
      const seed = (kind === 'train' ? 1_000_000 : 2_000_000) + EVAL_SEED + i;
      for (const policy of ['random', 'program', 'net'] as Policy[]) {
        const ep = makeEpisode(seed, kind === 'train' ? TRAIN_KIND : SHIFTED_KIND);
        const r = rng(seed * 17 + 3);
        seedGame(seed);
        const known0 = knownCount(ep.learner);
        const known: number[] = [];
        const level: number[] = [];
        let [both, zone, noSig, lead, counted, gap, maxGap, overdue] = [false, 0, 0, 0, 0, 0, 0, 0];
        let [targets, hits, expGain, replays] = [0, 0, 0, 0];
        for (let run = 0; run < EVAL_RUNS; run++) {
          const d = decide(ep);
          if (d.pool.length) {
            const e = choose(policy, d, model, r);
            if (d.plan.target) {
              targets += 1;
              hits += e.targets.includes(d.plan.target as never) ? 1 : 0;
            }
            replays += d.ids.slice(-20).includes(e.spec.id) ? 1 : 0;
            expGain -= ep.expKnown;
            if (practiceTrack(ep.save).track === 'both' && run >= 10) {
              // 처음 열 판은 보호구역이 열리기 전(L1)이거나 기록이 짧다 — 차례는 그 뒤부터 센다
              both = true;
              const isZone = zoneKindOf(e.tags) !== 'none';
              zone += isZone ? 1 : 0;
              noSig += isNoSignalZone(e.tags) ? 1 : 0;
              lead += e.tags.lead !== 'none' ? 1 : 0;
              counted += 1;
              const open = noSignalZoneOpen(ep.save.curriculum.level);
              gap = isNoSignalZone(e.tags) || !open ? 0 : gap + 1;
              maxGap = Math.max(maxGap, gap);
              if (gap > NO_SIGNAL_ZONE_GAP) overdue += 1;
            }
            play(ep, e);
            expGain += ep.expKnown;
          }
          if (run === EVAL_RUNS / 2 - 1 || run === EVAL_RUNS - 1) {
            known.push(knownCount(ep.learner));
            level.push(ep.save.curriculum.level + (ep.save.curriculum.mastered ? 1 : 0));
          }
        }
        out.push({
          kind,
          seed,
          policy,
          known,
          level,
          mastered: ep.save.curriculum.mastered,
          runs: ep.runs,
          violations: ep.violations,
          frustration: ep.frustration,
          situations: ep.seenKeys.size,
          known0,
          both,
          zone,
          noSignal: noSig,
          lead,
          turnRuns: counted,
          maxGap,
          overdue,
          targets,
          hits,
          expGain,
          replays,
        });
      }
    }
  }
  return out;
}

if (args.includes('--worker')) {
  installSim();
  const worker = arg('worker', 0);
  const phase = sarg('phase');
  const modelPath = sarg('model');
  const model = modelPath ? (JSON.parse(readFileSync(modelPath, 'utf8')) as RecommendModel) : null;
  const data = phase === 'eval' ? evaluate(worker, model!) : collect(worker, arg('round', 0), model);
  writeFileSync(sarg('out')!, JSON.stringify(data));
  process.exit(0);
}

// ── 지휘 ─────────────────────────────────────────────────────────────────

/**
 * 같은 명령을 `--worker k` 로 여럿 띄워 나눠 돌리고 결과를 모은다. vite-node 로 돌 때도 그대로 된다 —
 * `process.argv` 를 통째로(실행기 · 스크립트 · 인자) 다시 쓰기 때문이다.
 */
async function fanOut<T>(phase: 'collect' | 'eval', extra: string[]): Promise<T[]> {
  mkdirSync(WORK, { recursive: true });
  const tag = extra.join('_').replace(/[^\w]/g, '');
  const files = Array.from({ length: JOBS }, (_, k) => resolve(WORK, `${phase}-${tag}-${k}.json`));
  await Promise.all(
    files.map(
      (file, k) =>
        new Promise<void>((done, fail) => {
          const child = spawn(
            process.execPath,
            [...process.execArgv, ...process.argv.slice(1), '--jobs', String(JOBS), '--worker', String(k), '--phase', phase, '--out', file, ...extra],
            { stdio: ['ignore', 'ignore', 'inherit'] },
          );
          child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`일꾼 ${k} 실패 (${code})`))));
        }),
    ),
  );
  return files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as T[]);
}

interface Split {
  train: Labeled[];
  val: Labeled[];
}
const splitByLearner = (data: Labeled[]): Split => {
  // 열에 하나는 검증용 — 사람 단위로 나눈다 (같은 사람의 이웃한 차례가 양쪽에 섞이지 않게)
  const val = (l: Labeled) => l.learner % 10 === 3;
  return { train: data.filter((l) => !val(l)), val: data.filter(val) };
};

function softmax(xs: readonly number[]): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

function train(data: Labeled[]): RecommendModel {
  const d = REC_FEATURES.length;
  const all = data.flatMap((l) => l.rows);
  const mean = Array(d).fill(0);
  const std = Array(d).fill(0);
  for (const x of all) for (let j = 0; j < d; j++) mean[j] += x[j] / all.length;
  for (const x of all) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / all.length;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  const Z = data.map((l) => l.rows.map((x) => x.map((v, j) => (v - mean[j]) / std[j])));
  // 정답은 맨 앞 판 하나 (전문가가 고른 판) — `--setTarget` 이면 같은 갈래의 다른 최종 후보에도 나눠 준다 (위 SET_W)
  const T = data.map((l) => {
    if (l.soft) return l.rows.map((_, k) => l.soft![k] ?? 0);
    const m = SET_W ? (l.short ?? 0) : 0;
    return l.rows.map((_, k) => (k === 0 ? (m ? SET_W : 1) : k <= m ? (1 - SET_W) / m : 0));
  });
  // 무작위 판의 점수에 더하는 표본 보정 — 학습의 소프트맥스가 게임의 '갈래 안 판 전부' 를 닮도록
  const B = data.map((l) => l.rows.map((_, k) => ((SET_W || l.soft) && k > (l.short ?? 0) ? (l.negW ?? 0) : 0)));

  const rand = rng(11);
  const W1 = Array.from({ length: HIDDEN }, () => Array.from({ length: d }, () => (rand() * 2 - 1) * Math.sqrt(3 / d)));
  const b1 = Array(HIDDEN).fill(0);
  const w2 = Array.from({ length: HIDDEN }, () => (rand() * 2 - 1) * Math.sqrt(3 / HIDDEN));
  let b2 = 0;
  const L2 = 1e-5;
  const idx = Z.map((_, i) => i);
  console.log(`\n신경망 (은닉 ${HIDDEN} · 점수 하나) — 고를 차례 ${Z.length} · 후보 ${all.length}`);
  for (let ep = 0; ep < EPOCHS; ep++) {
    const lr = 0.02 - (0.017 * ep) / Math.max(1, EPOCHS - 1);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    let loss = 0;
    for (const i of idx) {
      const xs = Z[i];
      const hs = xs.map((x) =>
        W1.map((row, q) => {
          let s = b1[q];
          for (let j = 0; j < d; j++) s += row[j] * x[j];
          return Math.tanh(s);
        }),
      );
      const scores = hs.map((h, k) => h.reduce((s, v, q) => s + w2[q] * v, b2) + B[i][k]);
      const p = softmax(scores);
      for (let k = 0; k < p.length; k++) loss -= T[i][k] * Math.log(Math.max(1e-12, p[k]));
      // 소프트맥스 교차 엔트로피의 기울기 — 후보마다 (p − t)
      for (let k = 0; k < xs.length; k++) {
        const g = p[k] - T[i][k];
        if (Math.abs(g) < 1e-6) continue;
        const h = hs[k];
        for (let q = 0; q < HIDDEN; q++) {
          const gh = g * w2[q] * (1 - h[q] * h[q]);
          w2[q] -= lr * (g * h[q] + L2 * w2[q]);
          const row = W1[q];
          const x = xs[k];
          for (let j = 0; j < d; j++) row[j] -= lr * (gh * x[j] + L2 * row[j]);
          b1[q] -= lr * gh;
        }
        b2 -= lr * g;
      }
    }
    if (ep % 5 === 0 || ep === EPOCHS - 1) console.log(`  ${ep} · 손실 ${(loss / Z.length).toFixed(4)} · ${secs()}`);
  }
  return {
    kind: 'recommend-mlp',
    names: [...REC_FEATURES],
    mean: mean.map(round4),
    std: std.map(round4),
    W1: W1.map((r) => r.map(round4)),
    b1: b1.map(round4),
    w2: w2.map(round4),
    b2: round4(b2),
    meta: { trained: true },
  };
}

/**
 * **차례 신경망** — 전문가가 고른 판의 갈래를 맞히도록 배운다. 탈 수 있는 판이 없던 갈래는 빼고 소프트맥스를 씌운다 (게임과 같다).
 * 전문가의 갈래는 주사위였으므로 맞히는 비율보다 **확률이 맞는가**(로그 확률 · 갈래별 평균 확률 대 실제 비율)를 본다.
 */
function trainTurn(data: Labeled[]): TurnNet {
  const d = TURN_FEATURES.length;
  const K = TURN_CLASSES.length;
  const rand = rng(23);
  const W1 = Array.from({ length: TURN_HIDDEN }, () => Array.from({ length: d }, () => (rand() * 2 - 1) * Math.sqrt(3 / d)));
  const b1 = Array(TURN_HIDDEN).fill(0);
  const W2 = Array.from({ length: K }, () => Array.from({ length: TURN_HIDDEN }, () => (rand() * 2 - 1) * Math.sqrt(3 / TURN_HIDDEN)));
  const b2 = Array(K).fill(0);
  const idx = data.map((_, i) => i);
  console.log(`\n차례 신경망 (은닉 ${TURN_HIDDEN} · 갈래 ${K}) — 고를 차례 ${data.length}`);
  for (let ep = 0; ep < TURN_EPOCHS; ep++) {
    const lr = 0.03 - (0.027 * ep) / Math.max(1, TURN_EPOCHS - 1);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    let loss = 0;
    for (const i of idx) {
      const { turn: x, cls, avail } = data[i];
      const h = W1.map((row, q) => Math.tanh(row.reduce((s, w, j) => s + w * x[j], b1[q])));
      const logits = avail.map((k) => W2[k].reduce((s, w, q) => s + w * h[q], b2[k]));
      const p = softmax(logits);
      loss -= Math.log(Math.max(1e-12, p[avail.indexOf(cls)]));
      const gh = Array(TURN_HIDDEN).fill(0);
      avail.forEach((k, a) => {
        const g = p[a] - (k === cls ? 1 : 0);
        for (let q = 0; q < TURN_HIDDEN; q++) {
          gh[q] += g * W2[k][q];
          W2[k][q] -= lr * (g * h[q] + 1e-5 * W2[k][q]);
        }
        b2[k] -= lr * g;
      });
      for (let q = 0; q < TURN_HIDDEN; q++) {
        const g = gh[q] * (1 - h[q] * h[q]);
        const row = W1[q];
        for (let j = 0; j < d; j++) row[j] -= lr * (g * x[j] + 1e-5 * row[j]);
        b1[q] -= lr * g;
      }
    }
    if (ep % 10 === 0 || ep === TURN_EPOCHS - 1) console.log(`  ${ep} · 손실 ${(loss / data.length).toFixed(4)} · ${secs()}`);
  }
  return {
    names: [...TURN_FEATURES],
    classes: [...TURN_CLASSES],
    W1: W1.map((r) => r.map(round4)),
    b1: b1.map(round4),
    W2: W2.map((r) => r.map(round4)),
    b2: b2.map(round4),
  };
}

/**
 * 검증 차례에서 차례 신경망 — 전문가의 갈래에 준 평균 로그 확률(견줄 것: 학습 차례의 갈래 비율), 갈래마다 평균 확률 대 실제 비율,
 * 그리고 **바닥** — 신호기 없는 보호구역이 세 판째 없던 차례에서 그 갈래에 준 확률.
 */
function offlineTurn(val: Labeled[], train: Labeled[], net: TurnNet) {
  const K = TURN_CLASSES.length;
  const prior = Array(K).fill(1e-3);
  for (const l of train) prior[l.cls] += 1;
  const due = TURN_FEATURES.indexOf('noSignalDue');
  const ns = [TURN_CLASSES.indexOf('noSignal'), TURN_CLASSES.indexOf('noSignalLead')];
  let logp = 0;
  let logpPrior = 0;
  const meanP = Array(K).fill(0);
  const freq = Array(K).fill(0);
  const dueP: number[] = [];
  let dueHit = 0;
  for (const l of val) {
    const model = { turn: net } as RecommendModel;
    const avail = new Set(l.avail.map((k) => TURN_CLASSES[k]));
    const p = turnProbsRow(l.turn, avail, model);
    logp += Math.log(Math.max(1e-12, p[l.cls]));
    const pr = prior.map((v, k) => (avail.has(TURN_CLASSES[k]) ? v : 0));
    logpPrior += Math.log(pr[l.cls] / pr.reduce((a, b) => a + b, 0));
    for (let k = 0; k < K; k++) meanP[k] += p[k] / val.length;
    freq[l.cls] += 1 / val.length;
    if (l.turn[due] === 1 && ns.some((k) => l.avail.includes(k))) {
      dueP.push(p[ns[0]] + p[ns[1]]);
      dueHit += ns.includes(l.cls) ? 1 : 0;
    }
  }
  const n = val.length || 1;
  dueP.sort((a, b) => a - b);
  return {
    logp: logp / n,
    logpPrior: logpPrior / n,
    meanP: meanP.map(round4),
    freq: freq.map(round4),
    due: { decisions: dueP.length, expert: dueHit / (dueP.length || 1), mean: dueP.reduce((a, b) => a + b, 0) / (dueP.length || 1), min: dueP[0] ?? 1 },
  };
}

/** 입력 줄을 이미 센 차례 신경망 확률 — 학습 데이터는 특징 줄만 갖고 있다 */
function turnProbsRow(x: readonly number[], avail: ReadonlySet<string>, model: RecommendModel): number[] {
  const net = model.turn!;
  const h = net.W1.map((row, q) => Math.tanh(row.reduce((s, w, j) => s + w * x[j], net.b1[q])));
  const logits = net.W2.map((row, k) => row.reduce((s, w, q) => s + w * h[q], net.b2[k]));
  const top = Math.max(...logits.filter((_, k) => avail.has(TURN_CLASSES[k])));
  const w = logits.map((v, k) => (avail.has(TURN_CLASSES[k]) ? Math.exp(v - top) : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / sum);
}

/**
 * 검증 차례에서 — 전문가가 고른 판을 신경망도 후보 가운데 1등으로 보는 비율, 그 판에 준 확률의 평균 로그(나트). 견줄 것은
 * 무작위다 (1등 1/n · 로그 확률 −ln n). 전문가도 주사위를 굴리므로 1등이 늘 맞을 수는 없다.
 */
function offline(val: Labeled[], model: RecommendModel) {
  let top1 = 0;
  let top1Random = 0;
  let logp = 0;
  let logpRandom = 0;
  for (const l of val) {
    const s = scoreCourses(l.rows, model);
    top1 += s.indexOf(Math.max(...s)) === 0 ? 1 : 0;
    top1Random += 1 / l.rows.length;
    const m = Math.max(...s);
    logp += s[0] - m - Math.log(s.reduce((a, v) => a + Math.exp(v - m), 0));
    logpRandom -= Math.log(l.rows.length);
  }
  const n = val.length || 1;
  return { decisions: val.length, top1: top1 / n, top1Random: top1Random / n, logp: logp / n, logpRandom: logpRandom / n };
}

/** 같은 사람을 신경망과 프로그램이 따로 가르쳤을 때의 차 — 평균과 표준오차 (짝지은 비교) */
function paired(rows: EvalRow[], kind: 'train' | 'shifted', f: (r: EvalRow) => number) {
  const by = new Map<number, Partial<Record<Policy, EvalRow>>>();
  for (const r of rows.filter((x) => x.kind === kind)) by.set(r.seed, { ...(by.get(r.seed) ?? {}), [r.policy]: r });
  const d = [...by.values()].filter((p) => p.net && p.program).map((p) => f(p.net!) - f(p.program!));
  const m = d.reduce((a, b) => a + b, 0) / (d.length || 1);
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, d.length - 1));
  return { mean: round4(m), se: round4(sd / Math.sqrt(d.length || 1)) };
}

/** 차례 — 두 갈래를 다 연습한 사람들의 보호구역 · 무신호 · 앞차 비율과 무신호 보호구역 공백 */
function turnStats(rs: EvalRow[]) {
  const b = rs.filter((r) => r.both && r.turnRuns > 0);
  const sum = (f: (r: EvalRow) => number) => b.reduce((s, r) => s + f(r), 0);
  const runs = sum((r) => r.turnRuns) || 1;
  return {
    zoneShare: round4(sum((r) => r.zone) / runs),
    noSignalShare: round4(sum((r) => r.noSignal) / (sum((r) => r.zone) || 1)),
    leadShare: round4(sum((r) => r.lead) / runs),
    maxGap: round4(b.reduce((m, r) => Math.max(m, r.maxGap), 0)),
    overdueShare: round4(sum((r) => r.overdue) / runs),
    hitRate: round4(rs.reduce((a, r) => a + r.hits, 0) / (rs.reduce((a, r) => a + r.targets, 0) || 1)),
    expGainPerRun: round4(rs.reduce((a, r) => a + r.expGain, 0) / (rs.reduce((a, r) => a + r.runs, 0) || 1)),
    replayRate: round4(rs.reduce((a, r) => a + r.replays, 0) / (rs.reduce((a, r) => a + r.runs, 0) || 1)),
  };
}

function summarize(rows: EvalRow[]) {
  const out: Record<string, Record<string, Record<string, number> | { mean: number; se: number }>> = {};
  for (const kind of ['train', 'shifted'] as const) {
    out[kind] = {};
    for (const policy of ['random', 'program', 'net'] as Policy[]) {
      const rs = rows.filter((r) => r.kind === kind && r.policy === policy);
      const avg = (f: (r: EvalRow) => number) => rs.reduce((s, r) => s + f(r), 0) / (rs.length || 1);
      out[kind][policy] = {
        learners: rs.length,
        gainHalf: round4(avg((r) => r.known[0] - r.known0)),
        gain: round4(avg((r) => r.known[1] - r.known0)),
        knownEnd: round4(avg((r) => r.known[1])),
        levelHalf: round4(avg((r) => r.level[0])),
        level: round4(avg((r) => r.level[1])),
        mastered: round4(avg((r) => (r.mastered ? 1 : 0))),
        violationsPerRun: round4(avg((r) => r.violations / Math.max(1, r.runs))),
        frustration: round4(avg((r) => r.frustration)),
        situations: round4(avg((r) => r.situations)),
        ...turnStats(rs),
      };
    }
    out[kind].netMinusProgramGain = paired(rows, kind, (r) => r.known[1] - r.known0);
    out[kind].netMinusProgramLevel = paired(rows, kind, (r) => r.level[1]);
    out[kind].netMinusProgramExpGain = paired(rows, kind, (r) => r.expGain);
  }
  return out;
}

async function main() {
  const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
  let data: Labeled[] = [];
  let model: RecommendModel | null = null;
  const modelFile = resolve(WORK, 'model.json');
  const rounds: unknown[] = [];
  // --from <모델> — 학습은 건너뛰고 그 모델로 견주기만 한다 (모델을 고친 뒤 다시 잴 때)
  const from = sarg('from');
  if (from) {
    model = JSON.parse(readFileSync(from, 'utf8')) as RecommendModel;
    mkdirSync(WORK, { recursive: true });
    writeFileSync(modelFile, JSON.stringify(model));
  }
  for (let round = 0; round < (from ? 0 : ROUNDS); round++) {
    console.log(`\n${round + 1}차 — 가상 운전자 ${LEARNERS}명이 ${model ? '신경망' : '과정 전문가(예전 규칙)'}으로 과정을 밟고 전문가의 정답을 모은다 (일꾼 ${JOBS})`);
    const got = await fanOut<Labeled>('collect', ['--round', String(round), ...(model ? ['--model', modelFile] : [])]);
    console.log(`  고를 차례 ${got.length} · ${secs()}`);
    data = data.concat(got);
    const { train: tr, val } = splitByLearner(data);
    model = train(tr);
    model.turn = trainTurn(tr);
    writeFileSync(modelFile, JSON.stringify(model));
    const off = offline(val, model);
    const offTurn = offlineTurn(val, tr, model.turn);
    rounds.push({ round: round + 1, total: data.length, ...off, turn: offTurn });
    console.log(
      `  검증 — 차례 신경망: 전문가 갈래의 로그 확률 ${offTurn.logp.toFixed(3)} · 갈래 비율만 쓰면 ${offTurn.logpPrior.toFixed(3)}` +
        ` | 갈래별 평균 확률 ${offTurn.meanP.map(pct).join(' ')} · 실제 ${offTurn.freq.map(pct).join(' ')} (${TURN_CLASSES.join(' ')})`,
    );
    console.log(
      `  바닥 — 신호기 없는 보호구역이 ${NO_SIGNAL_ZONE_GAP}판째 없던 차례 ${offTurn.due.decisions}번: 전문가가 그 갈래 ${pct(offTurn.due.expert)}` +
        ` · 차례 신경망의 확률 평균 ${pct(offTurn.due.mean)} · 가장 낮은 ${pct(offTurn.due.min)}`,
    );
    console.log(
      `  검증 ${off.decisions}차례 — 전문가가 고른 판을 1등으로: 신경망 ${pct(off.top1)} · 무작위 ${pct(off.top1Random)}` +
        ` | 그 판의 로그 확률: 신경망 ${off.logp.toFixed(2)} · 무작위 ${off.logpRandom.toFixed(2)}`,
    );
  }

  console.log(`\n견주기 — 처음 보는 운전자 ${EVAL}명 × 두 종류를 무작위 · 프로그램 · 신경망이 ${EVAL_RUNS}판씩 가르친다`);
  const rows = await fanOut<EvalRow>('eval', ['--model', modelFile]);
  const table = summarize(rows);
  for (const kind of ['train', 'shifted'] as const) {
    console.log(`\n  ${kind === 'train' ? '학습에 쓴 종류' : '처음 보는 종류 (더 느리게 익히고 더 빨리 잊는다)'}`);
    for (const policy of ['random', 'program', 'net'] as Policy[]) {
      const t = table[kind][policy] as Record<string, number>;
      console.log(
        `  ${({ random: '무작위', program: '프로그램', net: '신경망' } as const)[policy].padEnd(5)}` +
          ` 익힌 개념 +${t.gainHalf.toFixed(2)}(${EVAL_RUNS / 2}판) +${t.gain.toFixed(2)}(${EVAL_RUNS}판)` +
          ` · 레벨 ${t.levelHalf.toFixed(2)} → ${t.level.toFixed(2)} · 마스터 ${pct(t.mastered)}` +
          ` · 판당 위반 ${t.violationsPerRun.toFixed(2)} · 연속 셋 넘게 틀림 ${t.frustration.toFixed(1)}판 · 겪은 상황 ${t.situations.toFixed(0)}`,
      );
      console.log(
        `         차례 — 보호구역 ${pct(t.zoneShare)} · 그중 무신호 ${pct(t.noSignalShare)} · 앞차 ${pct(t.leadShare)}` +
          ` · 무신호 공백 최장 ${t.maxGap}판 · ${NO_SIGNAL_ZONE_GAP}판 넘은 판 ${pct(t.overdueShare)}`,
      );
      console.log(
        `         진단 — 고칠 습관을 시험한 판 ${pct(t.hitRate)} · 판당 새로 알게 될 개념 기댓값 ${t.expGainPerRun.toFixed(4)} · 최근 20판 되풀이 ${pct(t.replayRate)}`,
      );
    }
    const g = table[kind].netMinusProgramGain as { mean: number; se: number };
    const l = table[kind].netMinusProgramLevel as { mean: number; se: number };
    console.log(`  같은 사람끼리 신경망 − 프로그램: 익힌 개념 ${g.mean >= 0 ? '+' : ''}${g.mean.toFixed(2)} ± ${g.se.toFixed(2)} · 레벨 ${l.mean >= 0 ? '+' : ''}${l.mean.toFixed(2)} ± ${l.se.toFixed(2)}`);
    const x = table[kind].netMinusProgramExpGain as { mean: number; se: number };
    console.log(`  같은 사람끼리 신경망 − 프로그램: 익힌 개념의 기댓값(주사위 잡음 없이) ${x.mean >= 0 ? '+' : ''}${x.mean.toFixed(3)} ± ${x.se.toFixed(3)}`);
  }

  model!.meta = {
    trained: true,
    date: new Date().toISOString().slice(0, 10),
    learners: LEARNERS * ROUNDS,
    decisions: data.length,
    candidates: data.reduce((s, l) => s + l.rows.length, 0),
    teacher: TEACHER
      ? `behavior cloning — 앞을 내다보는 교사 (scripts/recommendValue.ts — 가치 신경망 + 한 판 ${TEACHER.rollouts}번 미리 달려 보기 · 레벨 무게 ${TEACHER.lambda})`
      : 'behavior cloning — 예전 규칙 · 프로그램 점수 (recommendSim.ts 의 programPick)',
    rounds,
    eval: { learners: EVAL, runs: EVAL_RUNS, ...table },
  };
  writeFileSync(OUT, JSON.stringify(model, null, 1));
  console.log(`\n저장: ${OUT} · ${secs()}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
