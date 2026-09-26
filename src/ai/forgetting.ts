/**
 * **망각 모델 — 반감기 회귀 (Half-Life Regression).**
 *
 * 개념을 익혔어도 시간이 지나면 흐려진다. 듀오링고가 단어에 쓰는 방식 그대로, 개념마다 **반감기**를 두고
 * 마지막 연습 뒤 지난 시간으로 지금 기억할 확률을 센다 — 2^(−경과/반감기). 반감기는 그 개념을 지킨 횟수만큼
 * 길어지고 어긴 횟수만큼 짧아진다 (지킬수록 오래 남는다).
 *
 * 쓰임은 둘이다. ① 실효 숙달 = 숙달(ai/knowledge.ts) × 회상 확률 — 오래 안 본 개념은 다시 낮게 보인다.
 * ② **복습 차례** — 회상 확률이 기준 아래로 내려간 개념을 마스터 운행 · 추천이 먼저 시험한다.
 *
 * 가중치는 처음엔 기본값이다(사람마다의 데이터가 몇십 판이라 학습자 안에서 맞추지 않는다). 순수 모듈이다.
 */

import type { SkillState } from './knowledge';

export const HLR = {
  /** 처음 익힌 개념의 반감기 (시간) — 하루 */
  baseHours: 24,
  /** 지킬 때마다 반감기가 2^perOk 배 — 0.8 이면 세 번 지키면 대략 5배 */
  perOk: 0.8,
  /** 어길 때마다 2^perMiss 배 */
  perMiss: -0.6,
  minHours: 4,
  /** 두 달 — 그 뒤로는 더 길어지지 않는다 */
  maxHours: 24 * 60,
} as const;

/** 이 아래면 복습이 필요하다 */
export const REVIEW_BELOW = 0.75;

/** 지킨 · 어긴 횟수로 정하는 반감기 (시간) */
export function halfLifeHours(ok: number, miss: number): number {
  const h = HLR.baseHours * 2 ** (HLR.perOk * ok + HLR.perMiss * miss);
  return Math.max(HLR.minHours, Math.min(HLR.maxHours, h));
}

/** 지금 그 개념을 기억하고 있을 확률 — 한 번도 시험되지 않았으면 1 (잊을 것이 없다) */
export function recall(s: SkillState | undefined, now = Date.now()): number {
  if (!s || s.n === 0 || !s.last) return 1;
  const hours = Math.max(0, now - s.last) / 3_600_000;
  return 2 ** (-hours / halfLifeHours(s.ok, s.miss));
}

/** 복습 차례인 개념 — 회상 확률이 낮은 순 */
export function reviewDue<K extends string>(
  skills: Partial<Record<K, SkillState>>,
  now = Date.now(),
  below = REVIEW_BELOW,
): { code: K; recall: number }[] {
  return (Object.keys(skills) as K[])
    .map((code) => ({ code, recall: recall(skills[code], now) }))
    .filter((x) => x.recall < below)
    .sort((a, b) => a.recall - b.recall);
}
