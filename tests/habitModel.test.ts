import { describe, expect, it } from 'vitest';
import { HABIT_MASTERY, primaryHabit, runsToClear, masteryOfKnowledge } from '../src/coach/badHabits';
import { mastery } from '../src/ai/knowledge';
import type { JudgeResult } from '../src/rules/lawRules';
import { advance, currentTarget, freshCurriculum, type CurriculumState } from '../src/scenarios/curriculum';

/*
  **나쁜 습관을 고쳤는지는 AI 학습자 모델이 정한다** (coach/badHabits.ts — 사용자가 정했다, 2026-11-01: *"교통법규 준수 등 정말
  어쩔수 없는경우는 프로그램으로 남기고 나머지는 모두 AI 기법으로"*). 예전에는 "그 상황에서 2번 지키면 지운다" 는 횟수 규칙이었다.
  같은 길이는 지키되(깨끗하게 두 번이면 지운다), 위험하게 지킨 판은 덜 치는 것이 모델이 더하는 것이다.
*/
const run = (codes: string[] = []): JudgeResult => ({ violations: codes.map((code) => ({ code })), failReason: null }) as unknown as JudgeResult;
const ped = new Set(['PEDESTRIAN_BLOCKED'] as const);

/** 보행자 방해로 습관이 생긴 사람 */
const withHabit = (): CurriculumState => advance(freshCurriculum(), run(['PEDESTRIAN_BLOCKED']), ped, undefined, { now: 1 }).next;

describe('습관 — 학습자 모델이 고쳤다고 볼 때 지운다', () => {
  it('어긴 뒤 깨끗하게 두 번 지키면 지운다 — 예전 횟수 규칙과 같은 길이', () => {
    let s = withHabit();
    expect(s.badHabits.map((h) => h.code)).toEqual(['PEDESTRIAN_BLOCKED']);
    s = advance(s, run(), ped, undefined, { risk: 0, now: 2 }).next;
    expect(s.badHabits).toHaveLength(1);
    const step = advance(s, run(), ped, undefined, { risk: 0, now: 3 });
    expect(step.change.cleared).toEqual(['PEDESTRIAN_BLOCKED']);
    expect(mastery(step.next.skills ?? {}, 'PEDESTRIAN_BLOCKED')).toBeGreaterThanOrEqual(HABIT_MASTERY);
  });

  it('위험하게 지킨 판은 덜 친다 — 위험도가 높은 깨끗한 판 세 번으로는 지우지 않는다', () => {
    let s = withHabit();
    for (let i = 0; i < 3; i++) s = advance(s, run(), ped, undefined, { risk: 0.8, now: 2 + i }).next;
    expect(s.badHabits.map((h) => h.code)).toEqual(['PEDESTRIAN_BLOCKED']);
    expect(mastery(s.skills ?? {}, 'PEDESTRIAN_BLOCKED')).toBeLessThan(HABIT_MASTERY);
  });

  it('남은 판은 학습자 모델로 내다본다 — 어긴 직후 2판, 한 번 지킨 뒤 1판', () => {
    const s = withHabit();
    expect(runsToClear(s.badHabits[0], s.skills)).toBe(2);
    const once = advance(s, run(), ped, undefined, { risk: 0, now: 2 }).next;
    expect(runsToClear(once.badHabits[0], once.skills)).toBe(1);
  });

  it('먼저 고칠 습관은 학습자 모델이 가장 약하게 보는 것이다 (많이 저지른 것이 아니라)', () => {
    // 적색 무정지를 세 번, 보행자 방해를 한 번 — 그 뒤 적색은 한 번 지켜 모델이 조금 익혔다고 본다
    let s = freshCurriculum();
    const red = new Set(['RED_NO_STOP'] as const);
    for (let i = 0; i < 3; i++) s = advance(s, run(['RED_NO_STOP']), red, undefined, { now: 1 + i }).next;
    s = advance(s, run(['PEDESTRIAN_BLOCKED']), ped, undefined, { now: 5 }).next;
    s = advance(s, run(), red, undefined, { risk: 0, now: 6 }).next;
    expect(s.badHabits[0].code).toBe('RED_NO_STOP'); // 목록은 많이 저지른 차례
    expect(primaryHabit(s.badHabits, masteryOfKnowledge(s.skills ?? {}))?.code).toBe('PEDESTRIAN_BLOCKED');
    expect(currentTarget(s)).toBe('PEDESTRIAN_BLOCKED');
  });
});
