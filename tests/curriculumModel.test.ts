import { describe, expect, it } from 'vitest';
import { MASTERY_GATE, mastery } from '../src/ai/knowledge';
import type { JudgeResult } from '../src/rules/lawRules';
import { advance, freshCurriculum, recordHabits, xpToNext, type CurriculumState } from '../src/scenarios/curriculum';

/*
  **학습자 모델이 진급에 끼어드는 자리** — 습관도 없고 경험치도 찼는데 위험했던 판이면 한 판 더 본다. 능력 θ 는
  난이도를 준 판에서만 움직인다. 수동 주행도 숙달은 배운다.
*/
const run = (codes: string[] = []): JudgeResult => ({ violations: codes.map((code) => ({ code })), failReason: null }) as unknown as JudgeResult;
const clean = run();
const full = (): CurriculumState => ({ ...freshCurriculum(), xp: xpToNext(1) - 100 });

describe('학습자 모델과 진급', () => {
  it('무위반 두 판이면 오른다 — 모델도 붙잡지 않는다', () => {
    let s = freshCurriculum();
    s = advance(s, clean, new Set(['RED_NO_STOP']), undefined, { risk: 0, now: 1 }).next;
    const step = advance(s, clean, new Set(['RED_NO_STOP']), undefined, { risk: 0, now: 2 });
    expect(step.xp.leveledUp).toBe(true);
    expect(step.xp.heldByModel).toEqual([]);
    expect(mastery(step.next.skills ?? {}, 'RED_NO_STOP')).toBeGreaterThanOrEqual(MASTERY_GATE);
  });

  it('막대가 찼어도 위험했던 판이면 모델이 한 판 더 본다', () => {
    const step = advance(full(), clean, new Set(['PEDESTRIAN_BLOCKED']), undefined, { risk: 0.9, now: 1 });
    expect(step.xp.leveledUp).toBe(false);
    expect(step.xp.heldByModel).toEqual(['PEDESTRIAN_BLOCKED']);
    expect(step.next.level).toBe(1);
    // 다음 판을 안전하게 지키면 오른다
    const again = advance(step.next, clean, new Set(['PEDESTRIAN_BLOCKED']), undefined, { risk: 0, now: 2 });
    expect(again.xp.leveledUp).toBe(true);
  });

  it('능력은 난이도를 준 판에서만 움직인다 — 통과하면 오르고 틀리면 내린다', () => {
    const noDiff = advance(freshCurriculum(), clean, undefined, undefined, {}).next;
    expect(noDiff.ability).toBeUndefined();
    const up = advance(freshCurriculum(), clean, undefined, undefined, { difficulty: 0, abilityPrior: 0.5 }).next;
    expect(up.ability!).toBeGreaterThan(0.5);
    const down = advance(freshCurriculum(), run(['RED_NO_STOP']), undefined, undefined, { difficulty: 0, abilityPrior: 0.5 }).next;
    expect(down.ability!).toBeLessThan(0.5);
  });

  it('수동 주행도 숙달을 배운다 — 레벨은 그대로', () => {
    const s = recordHabits(freshCurriculum(), run(['RED_NO_STOP']), new Set(['RED_NO_STOP', 'NO_SLOW_DOWN']), { now: 3 });
    expect(mastery(s.skills ?? {}, 'RED_NO_STOP')).toBeLessThan(0.5);
    expect(mastery(s.skills ?? {}, 'NO_SLOW_DOWN')).toBeGreaterThan(0.7);
    expect(s.level).toBe(1);
    expect(s.runs).toBe(0);
  });
});
