import { describe, expect, it } from 'vitest';
import { buildUserPrompt, SYSTEM_PROMPT } from '../server/recommendPrompt.mjs';
import { sanitize } from '../server/recommendHandler.mjs';
import { abilityPriorFor } from '../src/ai/difficulty';
import { updateKnowledge, type Knowledge } from '../src/ai/knowledge';
import type { HabitSummary } from '../src/coach/habits';
import type { Plan } from '../src/scenarios/generate';
import { scenarioLibrary } from '../src/scenarios/library';
import { candidatesFor, masterPick, recommendPayload, rulePick, successPercent } from '../src/scenarios/recommend';

/*
  **추천이 모델을 읽는 자리** — 후보마다 예상 성공률, 학습자 모델의 숙달과 복습 차례가 AI 에게 가고, 코드가 고를 때도
  근접 발달 영역과 약한 개념을 좋게 친다. 마스터 운행은 가장 옅어진 개념을 시험하는 코스를 고른다.
*/
/** 서버가 좁힌 요청 — 시험이 읽는 부분만 */
type Sanitized = { mastery: { code: string; p: number }[]; review: string[]; courses: { success: number | null }[] };
const habits: HabitSummary = { runs: 6, stagesPlayed: 6, grades: {}, byCode: [], points: [], trend: null, mostRetried: null, cleanRuns: 6 };
const plan = (over: Partial<Plan> = {}): Plan => ({
  level: 3,
  target: null,
  badHabits: [],
  schoolZone: false,
  lead: null,
  challenge: 3,
  ability: abilityPriorFor(3),
  skills: {},
  ...over,
});

describe('예상 성공률', () => {
  it('능력이 있으면 후보마다 0~100 이 붙고, 없으면 붙지 않는다', () => {
    const cands = candidatesFor(plan(), []);
    expect(cands.length).toBeGreaterThan(10);
    for (const e of cands.slice(0, 20)) {
      const s = successPercent(plan(), e)!;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
    expect(successPercent({ ability: undefined }, cands[0])).toBeUndefined();
    const payload = recommendPayload(plan(), habits, [], cands.slice(0, 5));
    expect(payload.courses.every((c) => typeof c.success === 'number')).toBe(true);
  });

  it('이 레벨의 보통 판은 열에 일곱쯤이다 — 처음 능력의 뜻', () => {
    const cands = candidatesFor(plan(), []).filter((e) => e.level === 3);
    const mean = cands.reduce((s, e) => s + successPercent(plan(), e)!, 0) / cands.length;
    expect(mean).toBeGreaterThan(50);
    expect(mean).toBeLessThan(90);
  });
});

describe('학습자 모델이 AI 에게 간다', () => {
  const skills: Knowledge = updateKnowledge({}, ['RED_NO_STOP', 'PEDESTRIAN_BLOCKED'], ['PEDESTRIAN_BLOCKED'], { now: Date.now() });

  it('시험된 개념의 숙달과 복습 차례를 보낸다 — 시험되지 않은 개념은 없다', () => {
    const cands = candidatesFor(plan({ skills }), []);
    const payload = recommendPayload(plan({ skills }), habits, [], cands.slice(0, 5));
    expect(payload.mastery.map((m) => m.code).sort()).toEqual(['PEDESTRIAN_BLOCKED', 'RED_NO_STOP']);
    const ped = payload.mastery.find((m) => m.code === 'PEDESTRIAN_BLOCKED')!;
    expect(ped.p).toBeLessThan(70);
    expect(payload.review).toEqual([]);
  });

  it('서버가 그 값을 받아 프롬프트에 적는다', () => {
    const cands = candidatesFor(plan({ skills }), []);
    const payload = recommendPayload(plan({ skills }), habits, [], cands.slice(0, 5));
    const req = sanitize(JSON.parse(JSON.stringify(payload))) as Sanitized;
    expect(req.mastery.length).toBe(2);
    expect(req.courses[0].success).toBe(payload.courses[0].success);
    const text = buildUserPrompt(req);
    expect(text).toContain('학습자 모델');
    expect(text).toContain('보행자 양보');
    expect(text).toMatch(/성공\d+%/);
    expect(String(SYSTEM_PROMPT)).toContain('예상 성공률');
  });

  it('모르는 필드와 범위 밖 값은 버린다', () => {
    const req = sanitize({
      level: 3,
      courses: [{ id: 1, title: 't', tests: [], level: 3, success: 250 }],
      mastery: [{ code: 'RED_NO_STOP', p: 999 }, { code: 'NOPE', p: 10 }].slice(0, 1),
      review: ['RED_NO_STOP', 'NOPE'],
    }) as Sanitized;
    expect(req.courses[0].success).toBe(100);
    expect(req.mastery[0].p).toBe(100);
    expect(req.review).toEqual(['RED_NO_STOP']);
  });
});

describe('코드가 고를 때도 모델을 본다', () => {
  it('약한 개념을 시험하는 판이 앞선다', () => {
    const skills = updateKnowledge({}, ['RED_NO_STOP', 'PEDESTRIAN_BLOCKED'], ['PEDESTRIAN_BLOCKED'], { now: Date.now() });
    const p = plan({ skills });
    const cands = candidatesFor(p, []);
    let hits = 0;
    for (let i = 0; i < 20; i++) {
      const e = rulePick(p, cands, () => (i % 7) / 7);
      if (e.targets.includes('PEDESTRIAN_BLOCKED')) hits += 1;
    }
    expect(hits).toBeGreaterThanOrEqual(14);
  });

  it('마스터 운행은 가장 옅어진 개념을 시험하는 L10 코스를 고르고 그렇게 말한다', () => {
    const now = Date.now();
    const skills = updateKnowledge({}, ['RED_NO_STOP', 'SCHOOL_ZONE_NO_STOP'], ['SCHOOL_ZONE_NO_STOP'], { now });
    const pick = masterPick([], () => 0.3, skills, now);
    const entry = scenarioLibrary().find((e) => e.spec.id === pick.scenario.id)!;
    expect(entry.level).toBe(10);
    expect(entry.targets).toContain('SCHOOL_ZONE_NO_STOP');
    expect(pick.scenario.why).toContain('보호구역 정지');
    // 모델이 없으면 전처럼 무작위다
    expect(masterPick([], () => 0.3).scenario.why).toContain('무작위');
  });
});
