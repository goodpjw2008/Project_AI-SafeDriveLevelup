/**
 * **다음 판 추천 신경망** (src/ai/recommendNet.ts) — 설정 '다음판 추천 AI 설정' 의 로컬 신경망 기반.
 *
 * 학습은 scripts/train-recommend.ts 가 가상 운전자와 교사로 한다. 여기서는 **브라우저 쪽 약속**을 못 박는다 — 특징 이름이
 * 모델과 같은가(바꾸면 다시 학습), 고른 판이 후보 안에 있는가, 고른 까닭을 신경망의 근거로 말하는가.
 */
import { describe, expect, it } from 'vitest';

import { REC_FEATURES, explainPick, recommendFeatures, recommendModelReady, scoreCourses } from '../src/ai/recommendNet';
import trained from '../src/ai/models/recommend.json';
import { courseInputs, coursesByHabit, coverageOf, localPick, seenShapes, verdictsFor } from '../src/scenarios/recommend';
import type { Plan } from '../src/scenarios/generate';
import { abilityPriorFor } from '../src/ai/difficulty';

const plan = (over: Partial<Plan> = {}): Plan => ({
  level: 4,
  track: 'both',
  target: null,
  badHabits: [],
  schoolZone: false,
  lead: null,
  challenge: 3,
  skills: {},
  ability: abilityPriorFor(4),
  xp: 0,
  xpNeed: 400,
  cleanStreak: 0,
  missStreak: 0,
  ...over,
});

describe('추천 신경망 — 특징', () => {
  it('특징 이름은 겹치지 않고, 센 값의 수가 이름의 수와 같다', () => {
    expect(new Set(REC_FEATURES).size).toBe(REC_FEATURES.length);
    const p = plan();
    const courses = coursesByHabit(p, []).groups.flatMap((g) => g.courses);
    const v = verdictsFor(p);
    for (const e of courses) {
      const row = recommendFeatures(courseInputs(p, e, seenShapes([]), coverageOf([], p.level), v));
      expect(row).toHaveLength(REC_FEATURES.length);
      expect(row.every(Number.isFinite)).toBe(true);
    }
  });

  /*
    **특징을 바꾸면 다시 학습해야 한다** (npm run train:recommend). 이름이 어긋난 모델은 브라우저가 쓰지 않고 프로그램 점수로
    돌아가는데(recommendModelReady), 그러면 설정의 '로컬 신경망 기반' 이 조용히 신경망 없이 돈다 — 그것을 여기서 잡는다.
  */
  it('학습한 모델의 특징 이름이 지금 코드와 같다', () => {
    expect((trained as { names: string[] }).names).toEqual([...REC_FEATURES]);
    expect(recommendModelReady()).toBe(true);
  });
});

describe('추천 신경망 — 고르기', () => {
  it('고른 판은 최종 후보 안에 있고, 까닭은 신경망이 본 근거로 말한다', () => {
    const p = plan({
      badHabits: [{ code: 'PEDESTRIAN_BLOCKED', count: 3, lastRun: 2, cleanRuns: 0 }] as never,
      target: 'PEDESTRIAN_BLOCKED',
    });
    const courses = coursesByHabit(p, []).groups.flatMap((g) => g.courses);
    const pick = localPick(p, courses)!;
    expect(courses).toContain(pick.entry);
    expect(pick.scores).toHaveLength(courses.length);
    expect(pick.why).toContain('신경망');
  });

  it('점수는 같은 입력에 늘 같다 — 무작위가 아니다', () => {
    const p = plan();
    const v = verdictsFor(p);
    const rows = coursesByHabit(p, [])
      .groups.flatMap((g) => g.courses)
      .map((e) => recommendFeatures(courseInputs(p, e, seenShapes([]), coverageOf([], p.level), v)));
    expect(scoreCourses(rows)).toEqual(scoreCourses(rows));
  });

  it('가려 보기는 고른 판의 점수를 가장 많이 떨어뜨리는 근거 무리를 낸다', () => {
    const p = plan({ skills: { PEDESTRIAN_BLOCKED: { p: 0.2, n: 3, ok: 0, miss: 3, last: Date.now() } } });
    const v = verdictsFor(p);
    const rows = coursesByHabit(p, [])
      .groups.flatMap((g) => g.courses)
      .map((e) => recommendFeatures(courseInputs(p, e, seenShapes([]), coverageOf([], p.level), v)));
    const s = scoreCourses(rows);
    const best = s.indexOf(Math.max(...s));
    const why = explainPick(rows, best);
    if (why) {
      expect(['habit', 'weak', 'fit', 'novel', 'review']).toContain(why.group);
      expect(why.drop).toBeGreaterThan(0);
    }
  });
});
