/**
 * **어텐션 신경망이 시뮬레이터에서 고르는 판** — 게임의 aiCourses(recommend.ts, 설정 '로컬 신경망 어텐션')와 같은 순서:
 * 차례 신경망이 갈래를 뽑고, 탈 수 있는 판 가운데 그 갈래의 판(많으면 `pool` 판)을 채점해, 어텐션까지 거친 점수를 확률로 바꿔 뽑는다.
 * 학습의 둘째 차례부터(scripts/attn-rollout.ts) · 견주기(scripts/attn-eval.ts)가 쓴다.
 */
import { TURN_CLASSES, scoreCourses, turnFeatures, type RecommendModel } from '../src/ai/recommendNet';
import { attentionScores, attentionTurnModel, type AttnModel } from '../src/ai/recommendAttention';
import type { LibraryEntry } from '../src/scenarios/library';
import { turnClassOf, turnInputs } from '../src/scenarios/recommend';
import { turnProbs } from '../src/ai/recommendNet';
import { featureRows, type Decision } from './recommendSim';

const draw = (w: readonly number[], r: () => number): number => {
  let u = r() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) {
    u -= w[i];
    if (u <= 0 && w[i] > 0) return i;
  }
  return w.reduce((best, x, i) => (x > w[best] ? i : best), 0);
};

/** 하나로 고르는 모델(global)의 상황 입력 — 차례 신경망이 보던 입력 + 탈 수 있는 갈래 (recommend.ts 의 aiCourses 와 같다) */
export function sceneCtx(d: Decision): number[] {
  const have = new Set(d.pool.map(turnClassOf));
  return [...turnFeatures(turnInputs(d.plan, d.turns, d.cover)), ...TURN_CLASSES.map((c) => (have.has(c) ? 1 : 0))];
}

const sample = <T>(xs: readonly T[], n: number, r: () => number): T[] => {
  if (xs.length <= n) return [...xs];
  const a = [...xs];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(r() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
};

/**
 * **판마다 채점하는 신경망(설정 '로컬 신경망')이 고르는 판** — 차례 신경망이 갈래를 뽑고, 그 갈래에서 `pool` 판을 채점해 확률로 뽑는다 (온도는
 * 모델에 구워져 있다). 프로그램을 이긴 이 신경망이 어텐션의 스승이다 (scripts/attn-rollout.ts 의 `--teacher`).
 */
export function netPick(d: Decision, model: RecommendModel, r: () => number, pool: number): LibraryEntry {
  const classOf = d.pool.map(turnClassOf);
  const turn = TURN_CLASSES[draw(turnProbs(turnInputs(d.plan, d.turns, d.cover), new Set(classOf), model), r)];
  const cands = sample(
    d.pool.filter((_, i) => classOf[i] === turn),
    pool,
    r,
  );
  const s = scoreCourses(featureRows(d, cands), model);
  const top = Math.max(...s);
  return cands[draw(s.map((v) => Math.exp(v - top)), r)];
}

export function attnPick(d: Decision, model: AttnModel, r: () => number, pool: number): LibraryEntry {
  if (model.global) {
    const cands = sample(d.pool, pool, r);
    const scene = { classes: cands.map((e) => TURN_CLASSES.indexOf(turnClassOf(e))), ctx: sceneCtx(d) };
    const { final } = attentionScores(featureRows(d, cands), model, scene);
    const top = Math.max(...final);
    return cands[draw(final.map((v) => (Number.isFinite(v) ? Math.exp(v - top) : 0)), r)];
  }
  const classOf = d.pool.map(turnClassOf);
  const turn = TURN_CLASSES[draw(turnProbs(turnInputs(d.plan, d.turns, d.cover), new Set(classOf), attentionTurnModel(model)), r)];
  const inTurn = d.pool.filter((_, i) => classOf[i] === turn);
  let cands = inTurn;
  if (inTurn.length > pool) {
    const a = [...inTurn];
    for (let i = 0; i < pool; i++) {
      const j = i + Math.floor(r() * (a.length - i));
      [a[i], a[j]] = [a[j], a[i]];
    }
    cands = a.slice(0, pool);
  }
  const { final } = attentionScores(featureRows(d, cands), model);
  const top = Math.max(...final);
  return cands[draw(final.map((v) => (Number.isFinite(v) ? Math.exp(v - top) : 0)), r)];
}
