/**
 * **PPO 강화학습의 일꾼 — 가상 운전자를 가르치며 고른 것을 적는다** (scripts/ppo_train.py 가 띄운다).
 *
 * 한 일꾼이 맡은 가상 운전자들을 60판씩, **지금 정책**(차례 신경망 → 그 갈래에서 `--pool` 판 → 추천 신경망 — 게임의 aiCourses 와
 * 같은 짜임)으로 가르치며 판마다 적는다: 차례 신경망의 입력 · 탈 수 있던 갈래 · 뽑은 갈래와 그 로그 확률, 추천 신경망이 본 판들의
 * 특징 · 뽑은 판과 그 로그 확률, 가치 신경망(비평가)의 입력(학습자 쪽 특징 · 남은 판), 그 판의 보상(recommendSim.ts 의
 * rewardWorth 가 오른 만큼). 숫자 배열은 Float32 이진 파일로, 요약은 JSON 으로 쓴다 — 파이썬(torch)이 GPU 로 읽어 배운다.
 *
 *   node ppo-rollout.mjs --model m.json --iter 3 --worker 0 --jobs 20 --episodes 1000 --pool 64 --out DIR
 *
 * **두 가지 정책** (사용자가 정했다, 2026-11-01: *"1차 신경망 -> 2차 llm 은 llm 과 결합을 위한 최적의 신경망, 신경망으로만 동작하는것은
 * 신경망의 장점을 최대로 살린 신경망 단독"*):
 *  - `--mode pick` (기본) — **신경망 단독**: 추천 신경망이 마지막 한 판까지 고른다 (소프트맥스로 한 판).
 *  - `--mode set` — **LLM 과 짝을 이루는 후보 신경망**: 추천 신경망이 후보 `--k` 판(10)을 점수에 비례해 차례로 뽑고(플래킷-루스),
 *    마지막 한 판은 외부 LLM 을 대신하는 고르기(recommend.ts 의 rulePick — LLM 프롬프트와 같은 규칙: 고칠 습관 · 예상 성공률 55~80% ·
 *    약한 개념 · 새 상황)가 고른다. 보상은 그 판의 결과이므로, 신경망은 **LLM 이 고를 판이 가장 잘 가르치도록** 후보를 꾸리는 법을 배운다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SKILL_ORDER } from '../src/ai/knowledge';
import { TURN_CLASSES, scoreCourses, turnFeatures, turnProbs, type RecommendModel } from '../src/ai/recommendNet';
import type { LibraryEntry } from '../src/scenarios/library';
import { rulePick, turnClassOf, turnInputs } from '../src/scenarios/recommend';
import { RL_REWARD, TRAIN_KIND, decide, featureRows, installSim, knownCount, makeEpisode, play, rewardWorth, rng, seedGame, type Episode } from './recommendSim';

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
const POOL = arg('pool', 64);
const RUNS = arg('runs', 60);
const MODE = sarg('mode') ?? 'pick';
/** set 모드의 후보 수 — 외부 LLM 에게 보내는 최종 후보와 같다 */
const K = arg('k', 10);
/**
 * 가르칠 사람의 씨앗 — 차례마다 새 사람들 (`--seedBase` 로 검증용 고정 사람들을 줄 수 있다). 2천만부터 — 한때 400만 + 차례 × 10만이라
 * 50 째 차례가 견주기의 사람들(900만부터 4,000명)과 겹쳤다.
 */
const SEED_BASE = arg('seedBase', 20_000_000 + ITER * 100_000);
const OUT = sarg('out')!;
const model = JSON.parse(readFileSync(sarg('model')!, 'utf8')) as RecommendModel;

/** 비평가가 보는 학습자 쪽 특징 — REC_FEATURES 의 앞 40개(레벨 · 흐름 · 습관 · 개념별 숙달 · 시험됨)는 후보와 무관하다 */
const LEARNER_COLS = 40;
const NF = model.names.length;
const NT = TURN_CLASSES.length;

/**
 * **비평가만 보는 가상 운전자의 속** — 개념마다 아는지 · 기억의 세기 · 지금 떠올릴 확률 · 익히는 빠르기, 그리고 반감기 · 솜씨 ·
 * 이번 쉬기까지 남은 판 · 과정. 정책(추천 신경망)은 게임이 보는 것만 보고, 가치 신경망만 이것을 본다 (비대칭 행위자-비평가):
 * 한 판의 고르기가 60판 끝의 아는 개념 수를 0.05 쯤 바꾸는데 운전자마다의 운이 2 개념쯤 흔들어, 속을 모르는 비평가로는 이점이
 * 잡음에 묻혔다 (2026-11-01).
 */
const PRIV = SKILL_ORDER.length * 4 + 9;
function privateState(ep: Episode, run: number): number[] {
  const l = ep.learner;
  const now = ep.clockMs / 3_600_000;
  const x: number[] = [];
  for (const c of SKILL_ORDER) {
    const hl = Math.min(24 * 60, l.halfLife * 2 ** (0.6 * Math.max(0, l.strength[c] - 1)));
    x.push(l.known[c] ? 1 : 0, Math.min(6, l.strength[c]) / 6, l.known[c] ? 2 ** (-Math.max(0, now - l.last[c]) / hl) : 0, l.learn[c] * 2);
  }
  const cur = ep.save.curriculum;
  x.push(Math.log(l.halfLife) / 5, l.ability / 3, ep.sessionLeft / 15, cur.level / 10, cur.mastered ? 1 : 0, cur.missStreak / 5,
    cur.badHabits.length / 3, knownCount(l) / SKILL_ORDER.length, (RUNS - run) / RUNS);
  return x;
}

const draw = (w: readonly number[], r: () => number): number => {
  let u = r() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) {
    u -= w[i];
    if (u <= 0 && w[i] > 0) return i;
  }
  return w.reduce((best, x, i) => (x > w[best] ? i : best), 0);
};

installSim();
const turnX: number[] = [];
const avail: number[] = [];
const a1: number[] = [];
const lp1: number[] = [];
const rows = new Float32Array(Math.ceil(EPISODES / JOBS) * RUNS * POOL * NF);
let rowsAt = 0;
const nrows: number[] = [];
const a2: number[] = [];
/** set 모드 — 뽑은 차례대로 후보의 자리 (모자라면 −1) */
const sets: number[] = [];
const lp2: number[] = [];
const crit: number[] = [];
const priv: number[] = [];
const reward: number[] = [];
const done: number[] = [];
const epIdx: number[] = [];
const episodes: { seed: number; ret: number; known: number; level: number; frustration: number; steps: number }[] = [];

for (let i = WORKER; i < EPISODES; i += JOBS) {
  const seed = SEED_BASE + i;
  const ep = makeEpisode(seed, TRAIN_KIND);
  seedGame(seed);
  const r = rng(seed * 977 + 1);
  const known0 = knownCount(ep.learner);
  let w = rewardWorth(ep, RL_REWARD);
  const w0 = w;
  let steps = 0;
  for (let run = 0; run < RUNS; run++) {
    const d = decide(ep, false, false);
    if (!d.pool.length) break;
    // 1. 차례 신경망
    const classOf = d.pool.map(turnClassOf);
    const have = new Set(classOf);
    const ti = turnInputs(d.plan, d.turns, d.cover);
    const probs = turnProbs(ti, have, model);
    const c = draw(probs, r);
    turnX.push(...turnFeatures(ti));
    for (let k = 0; k < NT; k++) avail.push(have.has(TURN_CLASSES[k]) ? 1 : 0);
    a1.push(c);
    lp1.push(Math.log(Math.max(1e-12, probs[c])));
    // 2. 그 갈래에서 POOL 판 — 추천 신경망
    const inTurn = d.pool.filter((_, k) => classOf[k] === TURN_CLASSES[c]);
    const pool: LibraryEntry[] = [];
    if (inTurn.length > POOL) {
      const taken = new Set<number>();
      while (pool.length < POOL) {
        const k = Math.floor(r() * inTurn.length);
        if (taken.has(k)) continue;
        taken.add(k);
        pool.push(inTurn[k]);
      }
    } else pool.push(...inTurn);
    const feats = featureRows(d, pool);
    const scores = scoreCourses(feats, model);
    const top = Math.max(...scores);
    const ex = scores.map((v) => Math.exp(v - top));
    const sum = ex.reduce((x, y) => x + y, 0);
    let b: number;
    if (MODE === 'set') {
      // 점수에 비례해 차례로 K 판 (검벨 최대 K — 플래킷-루스 표본과 같다), 그 차례의 로그 확률을 더한다
      const g = scores.map((v) => v - Math.log(-Math.log(Math.max(1e-12, r()))));
      const order = g.map((_, k) => k).sort((x, y) => g[y] - g[x]).slice(0, Math.min(K, scores.length));
      let lp = 0;
      const left = new Set(scores.map((_, k) => k));
      for (const k of order) {
        const m = Math.max(...[...left].map((j) => scores[j]));
        const z = [...left].reduce((acc, j) => acc + Math.exp(scores[j] - m), 0);
        lp += scores[k] - m - Math.log(z);
        left.delete(k);
      }
      for (let k = 0; k < K; k++) sets.push(k < order.length ? order[k] : -1);
      const shortlist = order.map((k) => pool[k]);
      const pick = rulePick(d.plan, shortlist, r, d.seen, d.cover);
      b = pool.indexOf(pick);
      lp2.push(lp);
    } else {
      b = draw(ex, r);
      lp2.push(Math.log(Math.max(1e-12, ex[b] / sum)));
    }
    for (let k = 0; k < POOL; k++) {
      if (k < feats.length) rows.set(feats[k], rowsAt);
      rowsAt += NF;
    }
    nrows.push(feats.length);
    a2.push(b);
    crit.push(...feats[0].slice(0, LEARNER_COLS), run / RUNS);
    priv.push(...privateState(ep, run));
    // 3. 달리고 보상
    play(ep, pool[b]);
    const w1 = rewardWorth(ep, RL_REWARD);
    reward.push(w1 - w);
    w = w1;
    done.push(0);
    epIdx.push(episodes.length);
    steps += 1;
  }
  if (steps) done[done.length - 1] = 1;
  const cur = ep.save.curriculum;
  episodes.push({ seed, ret: w - w0, known: knownCount(ep.learner) - known0, level: cur.level + (cur.mastered ? 1 : 0), frustration: ep.frustration, steps });
}

const f32 = (xs: ArrayLike<number>): Float32Array => new Float32Array(xs);
const base = resolve(OUT, `w${WORKER}`);
writeFileSync(`${base}-turn.f32`, f32(turnX));
writeFileSync(`${base}-avail.f32`, f32(avail));
writeFileSync(`${base}-a1.f32`, f32(a1));
writeFileSync(`${base}-lp1.f32`, f32(lp1));
writeFileSync(`${base}-rows.f32`, rows.subarray(0, rowsAt));
writeFileSync(`${base}-nrows.f32`, f32(nrows));
writeFileSync(`${base}-a2.f32`, f32(a2));
writeFileSync(`${base}-lp2.f32`, f32(lp2));
writeFileSync(`${base}-crit.f32`, f32(crit));
writeFileSync(`${base}-priv.f32`, f32(priv));
writeFileSync(`${base}-reward.f32`, f32(reward));
writeFileSync(`${base}-done.f32`, f32(done));
writeFileSync(`${base}-ep.f32`, f32(epIdx));
if (MODE === 'set') writeFileSync(`${base}-set.f32`, f32(sets));
writeFileSync(`${base}.json`, JSON.stringify({ mode: MODE, k: K, decisions: a1.length, pool: POOL, features: NF, turnFeatures: turnX.length / Math.max(1, a1.length), critFeatures: LEARNER_COLS + 1, privFeatures: PRIV, episodes }));
process.exit(0);
