/**
 * **한 판이 모델들을 어떻게 움직였는가** — 결과 화면과 AI 코치가 그대로 보여 주는 요약.
 *
 * 학습자 모델(knowledge.ts)의 개념별 숙달이 이 판으로 얼마나 오르내렸는지, 위험도(risk.ts)가 얼마였는지, 위험했던 순간과
 * 위반의 반사실(telemetry.ts)을 한 벌로 묶는다. 순수 모듈이다 — 화면(ui/Screens.ts)은 이것을 글로 옮기기만 한다.
 */

import type { JudgeResult } from '../rules/lawRules';
import type { ViolationCode } from '../rules/violations';
import { SKILL_SHORT, mastery, type Knowledge } from './knowledge';
import { RISKY_ABOVE, riskOf } from './risk';
import { counterfactual, riskNotes, type RunFeatures } from './telemetry';

export interface SkillMove {
  code: ViolationCode;
  label: string;
  /** 판 전 · 후의 숙달 0~1 */
  before: number;
  after: number;
}

export interface ModelStep {
  /** 이 판이 시험한 개념의 숙달 변화 — 많이 움직인 순 */
  skills: SkillMove[];
  /** 이 판의 위험도 0~1 (요약 숫자로 잰 값) · 무위반인데 '위험했던 판' 기준을 넘었는가 */
  risk: number;
  risky: boolean;
  /** 위험했던 순간 — 사람의 말로 */
  notes: string[];
  /** 위반마다의 반사실 — "무엇이 조금만 달랐으면 통과했는가" */
  counterfactuals: { code: ViolationCode; text: string }[];
  /** 요약 한 줄이 없는 판(옛 기록 · 시범)이면 false */
  measured: boolean;
}

export function modelStep(
  before: Knowledge,
  after: Knowledge,
  tested: Iterable<ViolationCode>,
  result: JudgeResult,
): ModelStep {
  const f: RunFeatures | undefined = result.features;
  const skills: SkillMove[] = [...new Set(tested)]
    .map((code) => ({ code, label: SKILL_SHORT[code], before: mastery(before, code), after: mastery(after, code) }))
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
  const risk = f ? riskOf(f) : 0;
  const seen = new Set<ViolationCode>();
  const counterfactuals: { code: ViolationCode; text: string }[] = [];
  if (f) {
    for (const v of result.violations) {
      const code = v.code as ViolationCode;
      if (seen.has(code)) continue;
      seen.add(code);
      const text = counterfactual(code, f);
      if (text) counterfactuals.push({ code, text });
    }
  }
  return {
    skills,
    risk,
    risky: result.violations.length === 0 && !result.failReason && risk >= RISKY_ABOVE,
    notes: f ? riskNotes(f) : [],
    counterfactuals,
    measured: !!f,
  };
}

/** 숙달을 백분율 글자로 — "62%" */
export const pct = (p: number): string => `${Math.round(p * 100)}%`;
