/**
 * **다음 판 추천 신경망 — 최종 후보 가운데 이 학습자에게 가장 많이 배울 판을 고른다.**
 *
 * 설정 '다음판 추천 AI 설정' 의 **로컬 신경망 기반**(기본)이 이것이다. 규칙과 모델 점수가 추린 최종 후보 10개 안팎
 * (scenarios/recommend.ts 의 coursesByHabit)마다 점수 하나를 내고, 가장 높은 판을 고른다. 서버 · 키 · 사용 한도 없이
 * 브라우저 안에서 곱셈 몇천 번으로 끝난다.
 *
 * ## 무엇을 보는가 — 브라우저가 아는 것만
 *
 * 학습자 쪽은 레벨 · 경험치 · 흐름(연속 무위반 · 연속 실패) · 나쁜 습관 · 개념별 숙달(ai/knowledge.ts, 망각을 깎은 값)이고,
 * 판 쪽은 시험하는 개념 · 결과 예측 모델이 낸 개념별 어길 확률(ai/outcome.ts) · 예상 성공률(ai/difficulty.ts) · 최근에
 * 탄 모양과 겹치는 정도 · 이 레벨에서 처음 보는 상황인지 · 지금 프로그램의 점수다. 그 둘의 곱(시험하는 개념의 미숙달)도
 * 넣는다. 특징 이름은 `REC_FEATURES` 하나로 정하고, 학습 스크립트와 브라우저가 같은 함수(`recommendFeatures`)로 센다.
 *
 * ## 어떻게 배웠는가 — 시뮬레이터 속 가상 운전자와 교사
 *
 * 사람의 기록은 각자의 브라우저에만 있어 모을 수 없다. 그래서 `scripts/train-recommend.ts` 가 **가상 운전자 수천 명**
 * (개념마다 진짜 실력 · 배우는 빠르기 · 잊는 빠르기가 다르다)을 만들어 게임과 같은 계획 · 후보 · 레벨 규칙으로
 * 판을 고르게 하고, 고를 때마다 **교사**가 후보를 하나씩 "이 판을 골랐다면" 하고 몇 판 앞까지 미리 달려 본다.
 * 교사는 가상 운전자의 진짜 실력과 미래를 보므로 어느 판이 실제로 가장 많이 가르치는지 안다 — 사람에게는 쓸 수
 * 없는 답이다. 이 신경망은 **브라우저가 아는 것만으로 교사의 고르기를 흉내 내도록** 배운다 (교사-학생 증류).
 *
 * ## 왜 골랐는지 — 가려 보기
 *
 * 고른 판의 특징을 무리(습관 · 약한 개념 · 난이도 맞춤 · 새 상황 · 복습)마다 하나씩 후보들의 평균으로 바꿔 보고,
 * 점수가 가장 많이 떨어지는 무리를 "신경망이 가장 크게 본 근거" 로 적는다 (`explainPick`).
 *
 * 순수 모듈이다. 학습한 가중치는 models/recommend.json — 없으면(학습 전) `recommendModelReady` 가 거짓이다.
 */

import type { ViolationCode } from '../rules/violations';
import { SKILL_ORDER } from './knowledge';
import trained from './models/recommend.json';

/** 학습자 쪽과 판 쪽의 입력 — 부르는 쪽(scenarios/recommend.ts 의 courseInputs)이 채운다 */
export interface CourseInputs {
  /** 지금 레벨 1~10 */
  level: number;
  /** 난이도 설정 1~5 */
  challenge: number;
  /** 지금 레벨의 경험치 막대 0~1 */
  xpFrac: number;
  cleanStreak: number;
  missStreak: number;
  /** 나쁜 습관 — 개념별 횟수 */
  habits: Partial<Record<ViolationCode, number>>;
  /** 가장 많이 한 습관 (curriculum.ts 의 currentTarget) */
  target: ViolationCode | null;
  /** 능력 θ − 그 레벨의 평균 난이도 (ai/difficulty.ts) */
  abilityRel: number;
  /** 개념별 실효 숙달 0~1 — 시험된 적 없으면 처음 값 */
  mastery: Record<ViolationCode, number>;
  /** 개념별로 시험된 적이 있는가 */
  tested: Record<ViolationCode, boolean>;
  /** 이 판이 시험하는 개념 */
  tests: ReadonlySet<ViolationCode>;
  /** 결과 예측 모델의 개념별 어길 확률 — 모델이 없으면 null */
  predict: Partial<Record<ViolationCode, number>> | null;
  /** 위반 없이 지날 확률 (결과 예측) — 없으면 null */
  clean: number | null;
  /** 예상 성공률 (난이도 모델) — 없으면 undefined */
  success: number | undefined;
  /** 약한 개념에서 결과가 불확실한 정도 (ai/outcome.ts 의 info) */
  info: number;
  weak: boolean;
  zpd: boolean;
  review: boolean;
  /** 판의 레벨 − 지금 레벨 */
  levelDiff: number;
  /** 조건 점수 (scenarios/difficulty.ts) */
  cost: number;
  /** 최근에 탄 모양과 겹친 정도 (recommend.ts 의 되풀이 감점) */
  repeat: number;
  /** 이 레벨에서 아직 안 겪은 상황의 무게 (recommend.ts 의 새것 보너스) */
  novelty: number;
  /** 지금 프로그램의 점수 (recommend.ts 의 scoreOf) */
  program: number;
  zone: boolean;
  noSignalZone: boolean;
  lead: boolean;
}

const pct = (v: number) => Math.max(0, Math.min(1, v));

/** 특징 이름 — 순서가 곧 모델의 입력 순서다. **바꾸면 다시 학습해야 한다** (tests/recommendNet.test.ts 가 잡는다) */
export const REC_FEATURES: readonly string[] = [
  'level',
  'challenge',
  'xpFrac',
  'cleanStreak',
  'missStreak',
  'habitCount',
  'abilityRel',
  ...SKILL_ORDER.map((c) => `m:${c}`),
  ...SKILL_ORDER.map((c) => `seen:${c}`),
  ...SKILL_ORDER.map((c) => `h:${c}`),
  ...SKILL_ORDER.map((c) => `x:${c}`),
  ...SKILL_ORDER.map((c) => `gap:${c}`),
  ...SKILL_ORDER.map((c) => `p:${c}`),
  'targetHit',
  'habitHits',
  'clean',
  'success',
  'info',
  'weak',
  'zpd',
  'review',
  'levelDiff',
  'cost',
  'repeat',
  'novelty',
  'program',
  'zone',
  'noSignalZone',
  'lead',
];

export function recommendFeatures(x: CourseInputs): number[] {
  const habitCodes = Object.keys(x.habits) as ViolationCode[];
  const row: number[] = [
    x.level / 10,
    (x.challenge - 3) / 2,
    pct(x.xpFrac),
    Math.min(5, x.cleanStreak) / 5,
    Math.min(3, x.missStreak) / 3,
    Math.min(3, habitCodes.length) / 3,
    x.abilityRel,
  ];
  for (const c of SKILL_ORDER) row.push(x.mastery[c]);
  for (const c of SKILL_ORDER) row.push(x.tested[c] ? 1 : 0);
  for (const c of SKILL_ORDER) row.push(Math.min(3, x.habits[c] ?? 0) / 3);
  for (const c of SKILL_ORDER) row.push(x.tests.has(c) ? 1 : 0);
  for (const c of SKILL_ORDER) row.push(x.tests.has(c) ? 1 - x.mastery[c] : 0);
  for (const c of SKILL_ORDER) row.push(x.predict?.[c] ?? 0);
  row.push(
    x.target && x.tests.has(x.target) ? 1 : 0,
    Math.min(3, habitCodes.filter((c) => x.tests.has(c)).length) / 3,
    x.clean ?? x.success ?? 0.5,
    x.success ?? 0.5,
    x.info,
    x.weak ? 1 : 0,
    x.zpd ? 1 : 0,
    x.review ? 1 : 0,
    x.levelDiff / 3,
    x.cost / 10,
    x.repeat / 5,
    x.novelty / 10,
    x.program / 10,
    x.zone ? 1 : 0,
    x.noSignalZone ? 1 : 0,
    x.lead ? 1 : 0,
  );
  return row;
}

export interface RecommendModel {
  kind: 'recommend-mlp';
  names: readonly string[];
  mean: readonly number[];
  std: readonly number[];
  W1: ReadonlyArray<readonly number[]>;
  b1: readonly number[];
  /** 출력은 점수 하나 — 후보끼리 소프트맥스로 견준다 */
  w2: readonly number[];
  b2: number;
  meta: { trained: boolean; [k: string]: unknown };
}

const MODEL = trained as unknown as RecommendModel;

/** 학습한 모델이 있고 특징 이름이 지금 코드와 같은가 — 아니면 로컬은 프로그램 점수로 고른다 */
export const recommendModelReady = (model: RecommendModel = MODEL): boolean =>
  model.meta?.trained === true &&
  model.names.length === REC_FEATURES.length &&
  model.names.every((n, i) => n === REC_FEATURES[i]);

const standardize = (x: readonly number[], model: RecommendModel): number[] =>
  x.map((v, j) => (v - model.mean[j]) / (model.std[j] || 1));

/** 표준화한 입력 하나의 점수 */
function scoreZ(z: readonly number[], model: RecommendModel): number {
  let out = model.b2;
  for (let i = 0; i < model.W1.length; i += 1) {
    const row = model.W1[i];
    let s = model.b1[i];
    for (let j = 0; j < row.length; j += 1) s += row[j] * z[j];
    out += model.w2[i] * Math.tanh(s);
  }
  return out;
}

/** 후보마다의 점수 — 클수록 이 학습자에게 맞는 판 */
export function scoreCourses(rows: ReadonlyArray<readonly number[]>, model: RecommendModel = MODEL): number[] {
  return rows.map((x) => scoreZ(standardize(x, model), model));
}

/** 설명에 쓰는 특징 무리 — 이름의 앞부분으로 고른다 */
export type ReasonGroup = 'habit' | 'weak' | 'fit' | 'novel' | 'review';
const GROUPS: Record<ReasonGroup, (name: string) => boolean> = {
  habit: (n) => n === 'targetHit' || n === 'habitHits',
  weak: (n) => n.startsWith('gap:') || n.startsWith('p:') || n === 'info' || n === 'weak',
  fit: (n) => n === 'success' || n === 'clean' || n === 'zpd' || n === 'levelDiff' || n === 'cost',
  novel: (n) => n === 'novelty' || n === 'repeat',
  review: (n) => n === 'review',
};

/**
 * **왜 이 판인가 — 가려 보기(occlusion).** 고른 판의 특징 무리를 하나씩 후보들의 평균으로 바꿔 점수가 얼마나
 * 떨어지는지 잰다. 가장 많이 떨어지는 무리가 신경망이 이 판을 고른 가장 큰 근거다. 떨어지는 무리가 없으면 null.
 */
export function explainPick(
  rows: ReadonlyArray<readonly number[]>,
  chosen: number,
  model: RecommendModel = MODEL,
): { group: ReasonGroup; drop: number } | null {
  const zs = rows.map((x) => standardize(x, model));
  const avg = model.names.map((_, j) => zs.reduce((s, z) => s + z[j], 0) / zs.length);
  const base = scoreZ(zs[chosen], model);
  let best: { group: ReasonGroup; drop: number } | null = null;
  for (const group of Object.keys(GROUPS) as ReasonGroup[]) {
    const z = zs[chosen].map((v, j) => (GROUPS[group](model.names[j]) ? avg[j] : v));
    const drop = base - scoreZ(z, model);
    if (drop > 0 && (!best || drop > best.drop)) best = { group, drop };
  }
  return best;
}
