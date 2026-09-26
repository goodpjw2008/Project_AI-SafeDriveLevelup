import { describe, expect, it } from 'vitest';
import { updateKnowledge } from '../src/ai/knowledge';
import {
  OUTCOME_FEATURES,
  OUTCOME_MODEL,
  calibrateOutcome,
  cleanProbability,
  judgeCandidate,
  learnerVector,
  outcomeFeatures,
  predictOutcome,
  topPredictions,
} from '../src/ai/outcome';
import { scenarioLibrary } from '../src/scenarios/library';
import { scenarioByCode } from '../src/scenarios/scenarioCode';
import { playScenario } from '../src/scenarios/playSim';
import { challengeRule } from '../src/scenarios/challenge';
import { candidatesFor, recommendPayload, rulePick } from '../src/scenarios/recommend';
import { abilityPriorFor } from '../src/ai/difficulty';
import type { HabitSummary } from '../src/coach/habits';
import type { Plan } from '../src/scenarios/generate';
import type { ViolationCode } from '../src/rules/violations';

/*
  **결과 예측 모델** — 시나리오 × 학습자 → 개념별 위반 확률(다중 레이블). 가상 학습자로 학습한 가중치가 실려 있고,
  숙달이 낮은 개념일수록 그 개념을 시험하는 판에서 위반 확률이 높아야 한다. 판이 끝나면 절편이 보정된다.
*/
const entry = (code: string) => {
  const spec = scenarioByCode(code);
  if (!spec) throw new Error(code);
  const e = scenarioLibrary().find((x) => x.spec.id === spec.id);
  if (!e) throw new Error(code);
  return e;
};
const learner = (m: number, over: Partial<Record<ViolationCode, number>> = {}) => {
  const v = learnerVector({}, 0);
  for (const c of Object.keys(v.mastery) as ViolationCode[]) v.mastery[c] = m;
  Object.assign(v.mastery, over);
  return v;
};

describe('시뮬레이터의 개념별 모르는 운전자', () => {
  it('적색을 모르면 적색 판에서 적색 일시정지를 어기고, 사람을 모르면 보행자 판에서 양보를 어긴다', () => {
    const red = playScenario(entry('L00271').spec, { persona: 'human', reaction: 0.6, pace: challengeRule(3).pace, trace: false, blind: new Set(['RED_NO_STOP']) });
    expect(red.result.violations.map((v) => v.code)).toContain('RED_NO_STOP');
    const ped = playScenario(entry('L00091').spec, { persona: 'human', reaction: 0.6, pace: challengeRule(3).pace, trace: false, blind: new Set(['PEDESTRIAN_BLOCKED']) });
    expect(ped.result.violations.map((v) => v.code)).toContain('PEDESTRIAN_BLOCKED');
    const fine = playScenario(entry('L00091').spec, { persona: 'human', reaction: 0.6, pace: challengeRule(3).pace, trace: false, blind: new Set(['RED_NO_STOP']) });
    expect(fine.result.violations.map((v) => v.code)).not.toContain('PEDESTRIAN_BLOCKED');
  });
});

describe('결과 예측 모델', () => {
  it('학습된 모델이 실려 있고, 입력 특징의 순서가 고정이다', () => {
    expect(OUTCOME_MODEL).not.toBeNull();
    expect(OUTCOME_MODEL!.meta.trained).toBe(true);
    expect(OUTCOME_MODEL!.names).toEqual(OUTCOME_FEATURES);
    const x = outcomeFeatures(entry('L00091'), learner(0.5));
    expect(x.length).toBe(OUTCOME_FEATURES.length);
    const trainedLabels = OUTCOME_MODEL!.labels.filter((l) => l.trained).map((l) => l.code);
    expect(trainedLabels).toContain('PEDESTRIAN_BLOCKED');
    expect(trainedLabels).toContain('RED_NO_STOP');
  });

  it('숙달이 낮을수록 그 개념을 어길 확률이 높고, 시험하지 않는 개념은 0 이다', () => {
    const e = entry('L00091'); // 녹색 · 우회전 후 보행자 둘 — 보행자 양보를 시험한다
    const weak = predictOutcome(e, learner(0.9, { PEDESTRIAN_BLOCKED: 0.1 }))!;
    const strong = predictOutcome(e, learner(0.9, { PEDESTRIAN_BLOCKED: 0.95 }))!;
    expect(weak.PEDESTRIAN_BLOCKED).toBeGreaterThan(strong.PEDESTRIAN_BLOCKED);
    expect(weak.PEDESTRIAN_BLOCKED).toBeGreaterThan(0.4);
    expect(strong.PEDESTRIAN_BLOCKED).toBeLessThan(0.3);
    expect(weak.RED_NO_STOP).toBe(0); // 녹색 판 — 적색 일시정지는 시험되지 않는다
    expect(cleanProbability(strong, e.targets)).toBeGreaterThan(cleanProbability(weak, e.targets));
  });

  it('절편 보정 — 예측보다 많이 어기면 오르고, 잘 지키면 내려간다', () => {
    const e = entry('L00091');
    const p = predictOutcome(e, learner(0.5))!;
    const up = calibrateOutcome({}, p, e.targets, ['PEDESTRIAN_BLOCKED']);
    const down = calibrateOutcome({}, p, e.targets, []);
    expect(up.PEDESTRIAN_BLOCKED!).toBeGreaterThan(0);
    expect(down.PEDESTRIAN_BLOCKED!).toBeLessThan(0);
    const after = predictOutcome(e, learner(0.5), up)!;
    expect(after.PEDESTRIAN_BLOCKED).toBeGreaterThan(p.PEDESTRIAN_BLOCKED);
  });

  it('후보에 표를 붙인다 — 약점 시험 · 근접 발달 · 복습 · 새로움, 그리고 가장 많이 배우는 판의 불확실성', () => {
    const now = Date.now();
    const skills = updateKnowledge({}, ['RED_NO_STOP', 'PEDESTRIAN_BLOCKED'], ['PEDESTRIAN_BLOCKED'], { now });
    const v = judgeCandidate(entry('L00091'), skills, { now, success: 0.7, novel: true });
    expect(v.labels).toContain('weak');
    expect(v.labels).toContain('novel');
    expect(v.predict).not.toBeNull();
    expect(v.info).toBeGreaterThan(0);
    expect(topPredictions(v.predict, entry('L00091').targets)[0]?.code).toBe('PEDESTRIAN_BLOCKED');
    // 사람이 없는 녹색 판은 약점 시험도 불확실성도 없다
    const none = judgeCandidate(entry('L00001'), skills, { now, success: 0.95 });
    expect(none.labels).not.toContain('weak');
    expect(none.info).toBe(0);
  });
});

describe('추천이 결과 예측을 쓴다', () => {
  const habits: HabitSummary = { runs: 6, stagesPlayed: 6, grades: {}, byCode: [], points: [], trend: null, mostRetried: null, cleanRuns: 6 };
  const plan = (skills: Plan['skills']): Plan => ({ level: 3, target: null, badHabits: [], schoolZone: false, lead: null, challenge: 3, ability: abilityPriorFor(3), skills });

  it('후보마다 예상 위반과 표가 AI 에게 가고, 고른 판에도 실린다', () => {
    const skills = updateKnowledge({}, ['RED_NO_STOP', 'PEDESTRIAN_BLOCKED'], ['PEDESTRIAN_BLOCKED'], { now: Date.now() });
    const p = plan(skills);
    const cands = candidatesFor(p, []);
    const payload = recommendPayload(p, habits, [], cands.slice(0, 8));
    expect(payload.courses.some((c) => (c.labels ?? []).length > 0)).toBe(true);
    const withPed = payload.courses.find((c) => c.tests.includes('PEDESTRIAN_BLOCKED'));
    if (withPed) expect(withPed.predict?.some((x) => x.code === 'PEDESTRIAN_BLOCKED')).toBe(true);
    const picked = rulePick(p, cands, () => 0.4);
    expect(picked.targets.includes('PEDESTRIAN_BLOCKED')).toBe(true);
  });
});
