/**
 * 보상 정산.
 *
 * 안전한 우회전을 반복할수록 안전 운전 포인트가 쌓이고, 위반하면 실제 범칙금 액수만큼 깎인다.
 * 연속 무위반 콤보 배수가 있어 "한 번 크게 잘하기"보다 "꾸준히 안전하게"가 유리하도록 설계했다.
 */

import type { JudgeResult } from '../rules/lawRules';
import { totalFine, totalPenaltyPoints, type ViolationEvent } from '../rules/violations';

/** 등급별 기본 획득 포인트 */
export const BASE_REWARD = {
  PERFECT: 30_000,
  PASS: 12_000,
  VIOLATION: 0,
  FAIL: 0,
} as const;

/** 연속 무위반 횟수별 배수 */
const COMBO_TIERS = [
  { streak: 0, multiplier: 1.0 },
  { streak: 3, multiplier: 1.3 },
  { streak: 6, multiplier: 1.6 },
  { streak: 10, multiplier: 2.0 },
  { streak: 15, multiplier: 2.5 },
];

export function comboMultiplier(streak: number): number {
  let m = 1.0;
  for (const tier of COMBO_TIERS) {
    if (streak >= tier.streak) m = tier.multiplier;
  }
  return m;
}

/** 다음 배수까지 몇 번 더 필요한지 (HUD 표시용). 최고 단계면 null. */
export function nextComboAt(streak: number): number | null {
  const next = COMBO_TIERS.find((t) => t.streak > streak);
  return next ? next.streak : null;
}

export interface Payout {
  /** 등급 기본 포인트 */
  base: number;
  /** 콤보 배수 */
  multiplier: number;
  /** 배수 적용 후 획득 포인트 */
  earned: number;
  /** 위반으로 깎이는 포인트 (실제 범칙금 액수를 그대로 쓴다) */
  fine: number;
  /** 최종 증감 포인트 (earned - fine) */
  net: number;
  /** 부과된 벌점 */
  penaltyPoints: number;
  /** 이번 판정 후의 연속 무위반 횟수 */
  streak: number;
  violations: ViolationEvent[];
}

export function settle(result: JudgeResult, currentStreak: number): Payout {
  const clean = result.grade === 'PERFECT' || result.grade === 'PASS';
  const streak = clean ? currentStreak + 1 : 0;
  const multiplier = clean ? comboMultiplier(currentStreak) : 1;
  const base = BASE_REWARD[result.grade];
  const earned = Math.round(base * multiplier);
  const fine = totalFine(result.violations);

  return {
    base,
    multiplier,
    earned,
    fine,
    net: earned - fine,
    penaltyPoints: totalPenaltyPoints(result.violations),
    streak,
    violations: result.violations,
  };
}

/**
 * 벌점 누적에 따른 상태.
 * 실제 제도상 1년간 121점 이상이면 면허 취소, 40점 이상이면 정지 대상이 된다.
 * 게임에서는 학습용 경고 표시로만 쓴다.
 */
export function licenseStatus(points: number): { label: string; level: 'ok' | 'warn' | 'danger' } {
  if (points >= 121) return { label: '면허 취소 기준 초과', level: 'danger' };
  if (points >= 40) return { label: '면허 정지 기준 초과', level: 'danger' };
  if (points >= 20) return { label: '주의 — 정지 기준의 절반', level: 'warn' };
  return { label: '양호', level: 'ok' };
}
