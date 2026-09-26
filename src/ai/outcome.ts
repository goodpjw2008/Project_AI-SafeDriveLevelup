/**
 * **결과 예측 모델 — 시나리오 × 학습자 → 어떤 위반이 날까 (다중 레이블 분류).**
 *
 * 이 게임의 추천은 결국 **우리가 만든 22,818판 가운데 고르는 문제**다. 판은 열네 축의 조합으로 만들어졌고 각 판이 무엇을
 * 시험하는지(targets)를 안다. 학습자는 개념별 숙달(ai/knowledge.ts)과 반응 시간으로 요약된다. 그 둘을 이어 "이 학습자가
 * 이 판을 달리면 어느 개념을 어길까" 를 개념(위반 코드)마다 확률로 낸다 — 레이블 열둘의 다중 레이블 분류다.
 *
 * ## 무엇에 쓰는가
 *
 *  - **후보 만들기**: 판마다 예측을 내어 약점을 시험하는 판(약한 개념의 위반 확률이 높지도 낮지도 않은, **가장 많이 배우는**
 *    판 — 불확실성 표집), 근접 발달 영역의 판, 복습 판, 새로운 판에 **표를 붙인다**(다중 레이블 선택). 그 뒤 생성형 AI 가
 *    표와 확률을 읽고 하나를 고른다 — 전통적인 분류 모델이 브라우저에서 후보를 추리고, LLM 이 최종 판단과 설명을 맡는 구조.
 *  - **화면**: 추천 카드에 "결과 예측: 보행자 양보 42%" 가 붙는다.
 *  - **온라인 보정**: 판이 끝나면 예측과 실제의 차만큼 레이블별 절편을 학습자 안에서 움직인다 — 브라우저에서 배우는 한 줄이다.
 *
 * ## 학습은 빌드 때 가상 학습자로
 *
 * 사람 데이터가 없으므로 `scripts/train-ai.ts` 가 **숙달 벡터를 뽑은 가상 학습자**를 시뮬레이터(playSim 의 `blind`)로 달리게
 * 한다 — 숙달 m_c 인 학습자는 확률 1−m_c 로 그 개념을 모르는 채 달린다. 판의 특징 · 시험하는 개념 · 학습자의 숙달 ·
 * 그 둘의 곱(시험하는 개념의 미숙달)을 입력으로, 실제로 난 위반을 레이블로 로지스틱 회귀 열둘을 맞춘다. 배포되는 것은
 * 가중치 몇백 개(models/outcome.json)다. 교차로 서행(NO_SLOW_DOWN)은 속도를 차가 정해 흉내 낼 수 없어 기본율만 낸다.
 *
 * 순수 모듈이다.
 */

import type { ViolationCode } from '../rules/violations';
import type { ScenarioSpec } from '../scenarios/scenarios';
import { DIFFICULTY_FEATURES, scenarioFeatures } from './difficulty';
import { BKT, SKILL_ORDER, effectiveMastery, type Knowledge } from './knowledge';
import { recall } from './forgetting';
import trained from './models/outcome.json';

/** 학습자 쪽 입력 — 개념별 숙달 0~1 과 반응 시간(초) */
export interface LearnerVector {
  mastery: Record<ViolationCode, number>;
  reaction: number;
}

/** 입력 특징 이름 — 판의 특징 · 시험 개념 · 숙달 · 시험 개념의 미숙달(곱) · 반응 시간 */
export const OUTCOME_FEATURES: readonly string[] = [
  ...DIFFICULTY_FEATURES,
  ...SKILL_ORDER.map((c) => `tests:${c}`),
  ...SKILL_ORDER.map((c) => `m:${c}`),
  ...SKILL_ORDER.map((c) => `gap:${c}`),
  'reaction',
];

export function outcomeFeatures(
  e: { spec: ScenarioSpec; targets: readonly ViolationCode[]; cost: number },
  learner: LearnerVector,
): number[] {
  const tests = new Set(e.targets);
  const x = scenarioFeatures(e.spec, e.targets, e.cost);
  for (const c of SKILL_ORDER) x.push(tests.has(c) ? 1 : 0);
  for (const c of SKILL_ORDER) x.push(learner.mastery[c]);
  for (const c of SKILL_ORDER) x.push(tests.has(c) ? 1 - learner.mastery[c] : 0);
  x.push(learner.reaction);
  return x;
}

export interface OutcomeLabelModel {
  code: ViolationCode;
  w: readonly number[];
  b: number;
  /** 학습 표본의 양성 비율 — 학습이 안 된 레이블은 이 값만 낸다 */
  base: number;
  trained: boolean;
  auc?: number | null;
}

export interface OutcomeModel {
  names: readonly string[];
  mean: readonly number[];
  std: readonly number[];
  labels: readonly OutcomeLabelModel[];
  meta: { trained: boolean; samples: number; date?: string };
}

export const OUTCOME_MODEL: OutcomeModel | null =
  trained && (trained as OutcomeModel).meta?.trained ? (trained as OutcomeModel) : null;

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** 학습자 안에서 움직이는 레이블별 절편 — 예측과 실제의 차로 보정한다 (아래 calibrateOutcome) */
export type OutcomeBias = Partial<Record<ViolationCode, number>>;

/** 개념마다 위반 확률. 모델이 없으면 null */
export function predictOutcome(
  e: { spec: ScenarioSpec; targets: readonly ViolationCode[]; cost: number },
  learner: LearnerVector,
  bias: OutcomeBias = {},
  model: OutcomeModel | null = OUTCOME_MODEL,
): Record<ViolationCode, number> | null {
  if (!model) return null;
  const raw = outcomeFeatures(e, learner);
  const at = new Map(OUTCOME_FEATURES.map((n, i) => [n, raw[i]]));
  const z = model.names.map((n, i) => {
    const v = at.get(n);
    return v === undefined ? 0 : (v - model.mean[i]) / (model.std[i] || 1);
  });
  const tests = new Set(e.targets);
  const out = {} as Record<ViolationCode, number>;
  for (const lm of model.labels) {
    if (!lm.trained) {
      out[lm.code] = tests.has(lm.code) ? lm.base : 0;
      continue;
    }
    // 이 판이 시험하지 않는 개념은 일어날 수 없다 — 모델에게 묻지 않는다
    if (!tests.has(lm.code)) {
      out[lm.code] = 0;
      continue;
    }
    let s = lm.b + (bias[lm.code] ?? 0);
    for (let i = 0; i < z.length; i++) s += lm.w[i] * z[i];
    out[lm.code] = sigmoid(s);
  }
  return out;
}

/** 학습자 모델 → 이 모델의 입력. 시험된 적 없는 개념은 BKT 의 처음 값(L0)이다 */
export function learnerVector(skills: Knowledge, now = Date.now(), reaction = 1.0): LearnerVector {
  const mastery = {} as Record<ViolationCode, number>;
  for (const c of SKILL_ORDER) mastery[c] = skills[c] ? effectiveMastery(skills, c, now) : BKT.L0;
  return { mastery, reaction };
}

/** 위반 없이 지날 확률 — 시험하는 개념을 모두 지킬 확률 */
export function cleanProbability(p: Record<ViolationCode, number>, targets: readonly ViolationCode[]): number {
  let q = 1;
  for (const c of targets) q *= 1 - (p[c] ?? 0);
  return q;
}

/** 온라인 보정의 무게 — 한 판의 어긋남을 이만큼 절편에 옮긴다. ±CAL_LIMIT 안에서 */
export const CAL_LR = 0.35;
export const CAL_LIMIT = 2;

/**
 * **브라우저에서 배우는 한 줄** — 판이 끝나면 시험한 개념마다 (실제 − 예측) 만큼 절편을 움직인다.
 * 예측이 40% 였는데 어겼으면 +0.21, 지켰으면 −0.14. 모델 전체가 아니라 절편만 움직이므로 몇 판으로도 안정적이고
 * 저장은 숫자 열둘이다 (curriculum.ts 의 outcomeBias).
 */
export function calibrateOutcome(
  bias: OutcomeBias,
  predicted: Record<ViolationCode, number>,
  tested: Iterable<ViolationCode>,
  violated: Iterable<ViolationCode>,
  lr = CAL_LR,
): OutcomeBias {
  const bad = new Set(violated);
  const out: OutcomeBias = { ...bias };
  for (const c of new Set(tested)) {
    const p = predicted[c];
    if (p === undefined) continue;
    const next = (out[c] ?? 0) + lr * ((bad.has(c) ? 1 : 0) - p);
    out[c] = Math.max(-CAL_LIMIT, Math.min(CAL_LIMIT, next));
  }
  return out;
}

/** 후보에 붙는 표 — 하나 이상 붙으면 후보다 (다중 레이블 선택) */
export type CandidateLabel = 'weak' | 'zpd' | 'review' | 'novel';
export const LABEL_TEXT: Record<CandidateLabel, string> = {
  weak: '약점 시험',
  zpd: '근접 발달',
  review: '복습',
  novel: '새로움',
};

export interface CandidateVerdict {
  /** 개념별 위반 확률 (모델이 없으면 null) */
  predict: Record<ViolationCode, number> | null;
  /** 위반 없이 지날 확률 (모델이 없으면 null) */
  clean: number | null;
  /** 약한 개념에서 결과가 불확실한 정도 — 가장 많이 배우는 판이 1 에 가깝다 (불확실성 표집) */
  info: number;
  labels: CandidateLabel[];
}

/** 근접 발달 영역으로 치는 무위반 확률의 범위 */
export const ZPD_CLEAN = { min: 0.55, max: 0.8 } as const;

/**
 * 판 하나에 표를 붙인다.
 *
 * @param success 난이도 모델(IRT)의 예상 성공률 0~1 — 결과 예측 모델이 없으면 이것으로 근접 발달을 본다
 * @param novel 이 판이 이 레벨에서 아직 안 겪은 축을 여는가 (recommend.ts 의 경험 커버리지)
 */
export function judgeCandidate(
  e: { spec: ScenarioSpec; targets: readonly ViolationCode[]; cost: number },
  skills: Knowledge,
  opts: { now?: number; bias?: OutcomeBias; success?: number; novel?: boolean; weakBelow?: number; reviewBelow?: number } = {},
): CandidateVerdict {
  const now = opts.now ?? Date.now();
  const learner = learnerVector(skills, now);
  const predict = predictOutcome(e, learner, opts.bias ?? {});
  const clean = predict ? cleanProbability(predict, e.targets) : null;
  const weakBelow = opts.weakBelow ?? 0.7;
  const reviewBelow = opts.reviewBelow ?? 0.75;
  const labels: CandidateLabel[] = [];
  let info = 0;
  for (const c of e.targets) {
    const m = learner.mastery[c];
    const tested = !!skills[c];
    if (tested && m < weakBelow) {
      if (!labels.includes('weak')) labels.push('weak');
      if (predict) info = Math.max(info, 4 * predict[c] * (1 - predict[c]) * (1 - m));
    }
    if (tested && recall(skills[c], now) < reviewBelow && !labels.includes('review')) labels.push('review');
  }
  const zpdBy = clean ?? opts.success;
  if (zpdBy !== undefined && zpdBy >= ZPD_CLEAN.min && zpdBy <= ZPD_CLEAN.max) labels.push('zpd');
  if (opts.novel) labels.push('novel');
  return { predict, clean, info, labels };
}

/** 프롬프트와 카드에 적을 **가장 높은 위반 확률** 몇 개 — 시험하는 개념만, 낮은 것은 뺀다 */
export function topPredictions(
  predict: Record<ViolationCode, number> | null,
  targets: readonly ViolationCode[],
  n = 2,
  atLeast = 0.15,
): { code: ViolationCode; p: number }[] {
  if (!predict) return [];
  return targets
    .map((code) => ({ code, p: predict[code] ?? 0 }))
    .filter((x) => x.p >= atLeast)
    .sort((a, b) => b.p - a.p)
    .slice(0, n);
}
