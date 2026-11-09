/**
 * **다음 판 추천 신경망 다듬기 — 강화학습 (정책 경사).**
 *
 *   npm run train:recommend:rl                                   # 행동 복제로 배운 모델(src/ai/models/recommend.json)에서 시작
 *   npx vite-node scripts/finetune-recommend.ts --iters 4 --seeds 36   # 빨리 (검증용)
 *
 * 행동 복제(scripts/train-recommend.ts)로 배운 두 신경망 — 차례 신경망과 추천 신경망 — 은 예전 프로그램을 따라 한 것이라 프로그램을
 * 넘지 못한다. 여기서는 **가상 운전자를 60판 가르친 결과**를 보상으로 두 신경망을 함께 다듬는다 (사용자가 정했다, 2026-11-01:
 * *"강화학습을 진행해줘"*).
 *
 * 1. 가상 운전자 한 사람(scripts/recommendSim.ts)을 **같은 운으로 네 번** 가르친다 — 고르는 주사위만 다르고 운전자의 실수 ·
 *    배움 · 잊음의 난수는 같다(공통 난수). 고르기는 게임과 같다: 차례 신경망이 갈래를 뽑고, 추천 신경망이 그 갈래에서 `POOL`
 *    판을 채점해 확률대로 뽑는다.
 * 2. 보상은 60판 동안 오른 **이 사람의 값** (아래 worth) — **진짜로 아는 개념 수**(견주기의 '익힌 개념' 과 같은 잣대)가 으뜸이고,
 *    하루 뒤 남을 실력(핵심 개념 1.5배 · 반감기) · 레벨 · 습관 빚 · 새 상황 · 연패를 작게 곁들인다 (무게는 아래 W, 인자로 바꾼다).
 *    처음 시도(2026-11-01)는 recommendSim.ts 의 value 그대로(레벨 0.15 · 연패 0.05)였는데, 레벨은 프로그램만큼 올랐지만
 *    진짜 익힌 개념이 0.21 적었다 — 레벨을 올리고 핵심 개념만 되풀이하는 쪽으로 기울었다. 그래서 실력을 으뜸으로 바꿨다.
 * 3. 판마다 **그 판부터 끝까지 오른 값**(남은 보상)을, 같은 사람의 다른 번들이 같은 차례에 받은 남은 보상의 평균과 견줘(이점)
 *    그 판의 로그 확률 기울기에 곱해 더한다 (REINFORCE + 같은 사람 · 같은 차례를 기준선으로). 앞선 판의 운이 뒤 판의 몫에
 *    섞이지 않고, 같은 사람끼리 견주므로 운전자마다 다른 실력의 잡음이 빠진다.
 * 4. Adam 으로 한 걸음 — 행동 복제 가중치에서 멀어지는 만큼 `--anchor` 로 당긴다(사용자가 정한 다양성 약속을 행동 복제가
 *    지켰으므로, 크게 벗어나지 않게).
 *
 * 차례마다 모델을 `--work` 에 남긴다. 고르는 것은 이 스크립트가 아니라 견주기다 — `train-recommend.ts --from <모델>` 로 행동 복제와
 * 같은 사람들(처음 보는 400명 × 두 종류)을 가르쳐 보고, 나을 때만 바꿔 넣는다. 그다음 다양성 검사(tests/recommend.test.ts).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TURN_CLASSES, type RecommendModel, type TurnNet } from '../src/ai/recommendNet';
import type { LibraryEntry } from '../src/scenarios/library';
import { turnClassOf } from '../src/scenarios/recommend';
import {
  POOL,
  RL_REWARD,
  TRAIN_KIND,
  decide,
  featureRows,
  installSim,
  knownCount,
  makeEpisode,
  play,
  rewardWorth,
  rng,
  seedGame,
  turnRow,
  type Episode,
  type RewardWeights,
} from './recommendSim';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const sarg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const ITERS = arg('iters', 40);
/** 한 차례에 가르치는 사람 수 — 사람마다 `K` 번 */
const SEEDS = arg('seeds', 144);
const K = arg('k', 4);
const RUNS = arg('runs', 60);
const LR = arg('lr', 0.003);
const ANCHOR = arg('anchor', 0.01);
/** 보상의 무게 (위 2) — 진짜로 아는 개념 하나를 1 로 친다 */
const W: RewardWeights = {
  /** 새로 배운 개념 수의 기댓값 (recommendSim.ts 의 expLearned) */
  learn: arg('learn', RL_REWARD.learn),
  /** 아는 개념 수 — 견주기의 '익힌 개념' 과 같은 잣대 */
  know: arg('know', RL_REWARD.know),
  /** 하루 뒤 남을 실력 (recommendSim.ts 의 retained — 핵심 개념 1.5배 · 반감기) */
  retain: arg('retain', RL_REWARD.retain),
  /** 레벨 한 걸음 (경험치 막대 포함) */
  level: arg('level', RL_REWARD.level),
  /** 습관 빚 한 칸 — 풀리기까지 남은 판 (coach/badHabits.ts 의 runsToClear) */
  debt: arg('debt', RL_REWARD.debt),
  /** 이 레벨에서 새로 겪은 상황 하나 */
  novel: arg('novel', RL_REWARD.novel),
  /** 연달아 셋 넘게 틀린 판 하나 */
  frust: arg('frust', RL_REWARD.frust),
};
const JOBS = arg('jobs', Math.max(1, cpus().length - 2));
const FROM = sarg('from') ?? resolve(here, '../src/ai/models/recommend.json');
const OUT = sarg('save') ?? resolve(here, '../.train-recommend/rl.json');
const WORK = sarg('work') ?? resolve(here, '../.train-recommend/rl');

const t0 = performance.now();
const secs = () => `${((performance.now() - t0) / 1000).toFixed(0)}초`;
const round4 = (v: number) => +v.toFixed(4);

// ── 가중치 ↔ 한 줄 ──────────────────────────────────────────────────────

/** 다듬는 가중치를 한 줄로 — 추천 신경망(W1 · b1 · w2 · b2) 다음 차례 신경망(W1 · b1 · W2 · b2). 표준화(mean · std)는 그대로 둔다 */
function flatten(m: RecommendModel): number[] {
  const t = m.turn!;
  return [...m.W1.flat(), ...m.b1, ...m.w2, m.b2, ...t.W1.flat(), ...t.b1, ...t.W2.flat(), ...t.b2];
}

function unflatten(base: RecommendModel, v: readonly number[]): RecommendModel {
  let i = 0;
  const take = (n: number) => v.slice(i, (i += n));
  const rows = (r: number, c: number) => Array.from({ length: r }, () => take(c));
  const t = base.turn!;
  const W1 = rows(base.W1.length, base.W1[0].length);
  const b1 = take(base.b1.length);
  const w2 = take(base.w2.length);
  const b2 = take(1)[0];
  const turn: TurnNet = {
    names: t.names,
    classes: t.classes,
    W1: rows(t.W1.length, t.W1[0].length),
    b1: take(t.b1.length),
    W2: rows(t.W2.length, t.W2[0].length),
    b2: take(t.b2.length),
  };
  return { ...base, W1, b1, w2, b2, turn };
}

// ── 일꾼: 고르며 로그 확률의 기울기를 쌓는다 ─────────────────────────────

const draw = (w: readonly number[], r: () => number): number => {
  let u = r() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) {
    u -= w[i];
    if (u <= 0 && w[i] > 0) return i;
  }
  return w.reduce((best, x, i) => (x > w[best] ? i : best), 0);
};

/** 기울기 — 가중치와 같은 모양 (flatten 의 차례) */
interface Grad {
  W1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
  tW1: number[][];
  tb1: number[];
  tW2: number[][];
  tb2: number[];
}
const zeroGrad = (m: RecommendModel): Grad => ({
  W1: m.W1.map((r) => r.map(() => 0)),
  b1: m.b1.map(() => 0),
  w2: m.w2.map(() => 0),
  b2: 0,
  tW1: m.turn!.W1.map((r) => r.map(() => 0)),
  tb1: m.turn!.b1.map(() => 0),
  tW2: m.turn!.W2.map((r) => r.map(() => 0)),
  tb2: m.turn!.b2.map(() => 0),
});
const flatGrad = (g: Grad): number[] => [...g.W1.flat(), ...g.b1, ...g.w2, g.b2, ...g.tW1.flat(), ...g.tb1, ...g.tW2.flat(), ...g.tb2];

/**
 * 게임과 같이 한 판을 고르고(recommend.ts 의 aiCourses · train-recommend.ts 의 choose), 고른 것의 로그 확률 기울기를 `g` 에 더한다.
 */
function act(d: ReturnType<typeof decide>, m: RecommendModel, r: () => number, g: Grad): LibraryEntry {
  // 1. 차례 신경망 — 탈 수 있는 판이 있는 갈래만으로 소프트맥스
  const net = m.turn!;
  const classOf = d.pool.map(turnClassOf);
  const have = new Set(classOf);
  const avail = TURN_CLASSES.map((c, k) => (have.has(c) ? k : -1)).filter((k) => k >= 0);
  const x = turnRow(d);
  const h = net.W1.map((row, q) => Math.tanh(row.reduce((s, w, j) => s + w * x[j], net.b1[q])));
  const logits = avail.map((k) => net.W2[k].reduce((s, w, q) => s + w * h[q], net.b2[k]));
  const top = Math.max(...logits);
  const ex = logits.map((v) => Math.exp(v - top));
  const sum = ex.reduce((a, b) => a + b, 0);
  const p = ex.map((v) => v / sum);
  const a = draw(p, r);
  const gh = Array(h.length).fill(0);
  avail.forEach((k, i) => {
    const c = (i === a ? 1 : 0) - p[i];
    for (let q = 0; q < h.length; q++) {
      g.tW2[k][q] += c * h[q];
      gh[q] += c * net.W2[k][q];
    }
    g.tb2[k] += c;
  });
  for (let q = 0; q < h.length; q++) {
    const gq = gh[q] * (1 - h[q] * h[q]);
    for (let j = 0; j < x.length; j++) g.tW1[q][j] += gq * x[j];
    g.tb1[q] += gq;
  }

  // 2. 추천 신경망 — 그 갈래에서 POOL 판
  const turn = TURN_CLASSES[avail[a]];
  const inTurn = d.pool.filter((_, i) => classOf[i] === turn);
  const pool: LibraryEntry[] = [];
  if (inTurn.length > POOL) {
    const taken = new Set<number>();
    while (pool.length < POOL) {
      const i = Math.floor(r() * inTurn.length);
      if (taken.has(i)) continue;
      taken.add(i);
      pool.push(inTurn[i]);
    }
  } else pool.push(...inTurn);
  const zs = featureRows(d, pool).map((row) => row.map((v, j) => (v - m.mean[j]) / (m.std[j] || 1)));
  const hs = zs.map((z) => m.W1.map((row, q) => Math.tanh(row.reduce((s, w, j) => s + w * z[j], m.b1[q]))));
  const scores = hs.map((hh) => hh.reduce((s, v, q) => s + m.w2[q] * v, m.b2));
  const sTop = Math.max(...scores);
  const sEx = scores.map((v) => Math.exp(v - sTop));
  const sSum = sEx.reduce((x1, y) => x1 + y, 0);
  const ps = sEx.map((v) => v / sSum);
  const b = draw(ps, r);
  for (let k = 0; k < zs.length; k++) {
    const c = (k === b ? 1 : 0) - ps[k];
    if (Math.abs(c) < 1e-7) continue;
    const hh = hs[k];
    const z = zs[k];
    for (let q = 0; q < hh.length; q++) {
      g.w2[q] += c * hh[q];
      const gq = c * m.w2[q] * (1 - hh[q] * hh[q]);
      const row = g.W1[q];
      for (let j = 0; j < z.length; j++) row[j] += gq * z[j];
      g.b1[q] += gq;
    }
    g.b2 += c;
  }
  return pool[b];
}

/** 이 사람의 지금 값 (위 W — recommendSim.ts 의 rewardWorth) */
const worth = (ep: Episode): number => rewardWorth(ep, W);

interface Rollout {
  ret: number;
  known: number;
  level: number;
  frustration: number;
  /** 판마다의 로그 확률 기울기 · 그 판부터 끝까지 오른 값 */
  gs: number[][];
  togo: number[];
}

function rollout(seed: number, k: number, m: RecommendModel): Rollout {
  const ep = makeEpisode(seed, TRAIN_KIND);
  seedGame(seed);
  const r = rng(seed * 977 + k * 131 + 1);
  const ws = [worth(ep)];
  const gs: number[][] = [];
  const known0 = knownCount(ep.learner);
  for (let run = 0; run < RUNS; run++) {
    const d = decide(ep, false, false);
    if (!d.pool.length) break;
    const g = zeroGrad(m);
    play(ep, act(d, m, r, g));
    gs.push(flatGrad(g));
    ws.push(worth(ep));
  }
  const end = ws[ws.length - 1];
  const c = ep.save.curriculum;
  return {
    ret: end - ws[0],
    known: knownCount(ep.learner) - known0,
    level: c.level + (c.mastered ? 1 : 0),
    frustration: ep.frustration,
    gs,
    togo: ws.slice(0, -1).map((w) => end - w),
  };
}

interface WorkerOut {
  grad: number[];
  people: number;
  ret: number;
  known: number;
  level: number;
  frustration: number;
  /** 이점의 크기 — 같은 사람의 네 번이 얼마나 갈렸나 */
  spread: number;
}

function work(worker: number, iter: number, m: RecommendModel): WorkerOut {
  const grad = Array(flatten(m).length).fill(0);
  const out: WorkerOut = { grad, people: 0, ret: 0, known: 0, level: 0, frustration: 0, spread: 0 };
  for (let i = worker; i < SEEDS; i += JOBS) {
    const seed = 3_000_000 + iter * 10_000 + i;
    const rs = Array.from({ length: K }, (_, k) => rollout(seed, k, m));
    const total = rs.reduce((s, x) => s + x.ret, 0);
    rs.forEach((x, k) => {
      // 판마다 — 같은 차례에 나머지 번들이 받은 남은 보상의 평균이 기준선 (자기 자신을 빼야 기울기가 치우치지 않는다)
      for (let t = 0; t < x.gs.length; t++) {
        const others = rs.filter((y, j) => j !== k && y.togo.length > t);
        const base = others.length ? others.reduce((s, y) => s + y.togo[t], 0) / others.length : 0;
        const adv = x.togo[t] - base;
        const g = x.gs[t];
        for (let j = 0; j < grad.length; j++) grad[j] += adv * g[j];
      }
      const adv = x.ret - (total - x.ret) / (K - 1);
      out.spread += Math.abs(adv) / K;
      out.ret += x.ret / K;
      out.known += x.known / K;
      out.level += x.level / K;
      out.frustration += x.frustration / K;
    });
    out.people += 1;
  }
  return out;
}

if (args.includes('--worker')) {
  installSim();
  const m = JSON.parse(readFileSync(sarg('model')!, 'utf8')) as RecommendModel;
  writeFileSync(sarg('out')!, JSON.stringify(work(arg('worker', 0), arg('iter', 0), m)));
  process.exit(0);
}

// ── 지휘 ─────────────────────────────────────────────────────────────────

async function fanOut(iter: number, modelFile: string): Promise<WorkerOut[]> {
  const files = Array.from({ length: JOBS }, (_, k) => resolve(WORK, `out-${iter}-${k}.json`));
  await Promise.all(
    files.map(
      (file, k) =>
        new Promise<void>((done, fail) => {
          const child = spawn(
            process.execPath,
            [...process.execArgv, ...process.argv.slice(1), '--jobs', String(JOBS), '--worker', String(k), '--iter', String(iter), '--model', modelFile, '--out', file],
            { stdio: ['ignore', 'ignore', 'inherit'] },
          );
          child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`일꾼 ${k} 실패 (${code})`))));
        }),
    ),
  );
  return files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as WorkerOut);
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  const base = JSON.parse(readFileSync(FROM, 'utf8')) as RecommendModel;
  const anchor = flatten(base);
  let theta = [...anchor];
  const mom = theta.map(() => 0);
  const vel = theta.map(() => 0);
  const history: unknown[] = [];
  console.log(
    `강화학습 — ${ITERS}차례 × 가상 운전자 ${SEEDS}명 × ${K}번 · ${RUNS}판 · 가중치 ${theta.length}개 · 학습률 ${LR} · 당김 ${ANCHOR} · 보상 ${JSON.stringify(W)} (일꾼 ${JOBS})`,
  );
  for (let iter = 0; iter < ITERS; iter++) {
    const m = unflatten(base, theta);
    const modelFile = resolve(WORK, `model-${iter}.json`);
    writeFileSync(modelFile, JSON.stringify(m));
    const outs = await fanOut(iter, modelFile);
    const people = outs.reduce((s, o) => s + o.people, 0);
    const avg = (f: (o: WorkerOut) => number) => outs.reduce((s, o) => s + f(o), 0) / people;
    const grad = theta.map((_, j) => outs.reduce((s, o) => s + o.grad[j], 0) / (people * K));
    // 오르막 (보상을 키운다) — 행동 복제에서 멀어진 만큼 당긴다. Adam (β 0.9 · 0.999)
    const t = iter + 1;
    for (let j = 0; j < theta.length; j++) {
      const gj = grad[j] - ANCHOR * (theta[j] - anchor[j]);
      mom[j] = 0.9 * mom[j] + 0.1 * gj;
      vel[j] = 0.999 * vel[j] + 0.001 * gj * gj;
      theta[j] += (LR * (mom[j] / (1 - 0.9 ** t))) / (Math.sqrt(vel[j] / (1 - 0.999 ** t)) + 1e-8);
    }
    const drift = Math.sqrt(theta.reduce((s, v, j) => s + (v - anchor[j]) ** 2, 0) / theta.length);
    const row = {
      iter,
      ret: round4(avg((o) => o.ret)),
      known: round4(avg((o) => o.known)),
      level: round4(avg((o) => o.level)),
      frustration: round4(avg((o) => o.frustration)),
      spread: round4(avg((o) => o.spread)),
      drift: round4(drift),
    };
    history.push(row);
    console.log(
      `  ${iter} · 보상 ${row.ret.toFixed(3)} · 익힌 개념 +${row.known.toFixed(2)} · 레벨 ${row.level.toFixed(2)} · 연패 ${row.frustration.toFixed(1)}` +
        ` · 이점 ${row.spread.toFixed(3)} · 행동 복제에서 ${row.drift.toFixed(4)} · ${secs()}`,
    );
  }
  const final = unflatten(base, theta.map(round4));
  final.meta = {
    ...base.meta,
    rl: {
      date: new Date().toISOString().slice(0, 10),
      iters: ITERS,
      seeds: SEEDS,
      k: K,
      runs: RUNS,
      lr: LR,
      anchor: ANCHOR,
      reward: W,
      history,
    },
  };
  writeFileSync(OUT, JSON.stringify(final, null, 1));
  console.log(`\n저장: ${OUT} · ${secs()}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
