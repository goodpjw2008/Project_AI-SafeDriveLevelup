/**
 * **다음 판 추천 신경망** (src/ai/recommendNet.ts) — 설정 '다음판 추천 AI 설정' 의 로컬 신경망 기반.
 *
 * 학습은 scripts/train-recommend.ts 가 가상 운전자와 교사로 한다. 여기서는 **브라우저 쪽 약속**을 못 박는다 — 특징 이름이
 * 모델과 같은가(바꾸면 다시 학습), 고른 판이 후보 안에 있는가, 고른 까닭을 신경망의 근거로 말하는가.
 */
import { describe, expect, it } from 'vitest';

import {
  REC_FEATURES,
  TURN_CLASSES,
  TURN_FEATURES,
  explainPick,
  recommendFeatures,
  recommendModelReady,
  scoreCourses,
  turnFeatures,
  turnProbs,
  type TurnClass,
} from '../src/ai/recommendNet';
import trained from '../src/ai/models/recommend.json';
import {
  aiCourses,
  courseInputs,
  coursesByHabit,
  coverageOf,
  localPick,
  seenShapes,
  turnClassOf,
  turnContext,
  turnInputs,
  verdictsFor,
} from '../src/scenarios/recommend';
import type { Plan } from '../src/scenarios/generate';
import { HABIT_TRACK } from '../src/scenarios/tracks';
import { SKILL_ORDER } from '../src/ai/knowledge';
import type { TurnContext } from '../src/ai/recommendNet';
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
  it('학습한 모델의 특징 이름이 지금 코드와 같다 — 차례 신경망의 입력 · 갈래도', () => {
    const model = trained as { names: string[]; turn?: { names: string[]; classes: string[] } };
    expect(model.names).toEqual([...REC_FEATURES]);
    expect(model.turn?.names).toEqual([...TURN_FEATURES]);
    expect(model.turn?.classes).toEqual([...TURN_CLASSES]);
    expect(recommendModelReady()).toBe(true);
  });
});

/*
  **차례 신경망** — 이번 판의 갈래(보호구역의 신호기 유무 · 앞차 · 전용 도로)를 뽑는다. 탈 수 있는 판이 없는 갈래는 뽑지 않고,
  뽑은 뒤에는 추천 신경망이 그 갈래 안에서만 고른다.
*/
describe('차례 신경망', () => {
  it('입력의 수가 이름의 수와 같고, 확률은 탈 수 있는 갈래에만 있다', () => {
    const p = plan({ level: 6 });
    const x = turnInputs(p, turnContext([]));
    expect(turnFeatures(x)).toHaveLength(TURN_FEATURES.length);
    const avail = new Set<TurnClass>(['plain', 'noSignal']);
    const probs = turnProbs(x, avail);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    TURN_CLASSES.forEach((c, k) => {
      if (!avail.has(c)) expect(probs[k]).toBe(0);
    });
  });

  /*
    **신호기 없는 보호구역의 바닥** — 세 판째 없으면 그 판이다 (사용자: "10판 넘게 했는데 한번도 나오지 않았어"). 예전에는
    프로그램이 그 판만 후보에 올렸고, 이제는 차례 신경망이 그 바닥을 따라 배웠다. 바닥이 걸리는 자리(갈래 설정 '섞어서' 와 '자동'
    — 자동은 고칠 습관이 우회전 · 보호구역 전용 갈래의 것이면 그 갈래로 가므로 뺀다) 전부에서 그 갈래에 주는 확률을 잰다:
    레벨 9 × 고칠 습관 12 × 최근 보호구역 비율 6 × 지난 판 수 4 × 앞차 3 × 이 레벨에서 겪은 정도 2.
    학습한 모델(2026-11-01)은 습관이 없으면 88% 이상, 가장 낮은 곳(신호 보호구역 습관 · 섞어서)이 77% 였다.
  */
  it('신호기 없는 보호구역이 세 판째 없으면 그 갈래를 높은 확률로 뽑는다 — 바닥이 걸리는 자리 전부에서', () => {
    const avail = new Set<TurnClass>(TURN_CLASSES.filter((c) => c !== 'zoneRoad'));
    const ns = [TURN_CLASSES.indexOf('noSignal'), TURN_CLASSES.indexOf('noSignalLead')];
    let low = 1;
    let lowFree = 1;
    let where = '';
    for (const setting of ['both', 'auto'] as const)
      for (let level = 2; level <= 10; level++)
        for (const target of [null, ...SKILL_ORDER]) {
          if (setting === 'auto' && target && HABIT_TRACK[target]) continue;
          for (const zoneShare of [0, 1 / 12, 3 / 12, 6 / 12, 9 / 12, 1])
            for (const since of [3, 4, 6, 8])
              for (const sinceLead of [0, 2, 8])
                for (const cover of [0, 3]) {
                  const turns: TurnContext = {
                    zoneShare,
                    noSignalShare: zoneShare ? 0 : 0.65,
                    leadShare: 1 / 3,
                    sinceZone: zoneShare ? 0 : since,
                    sinceNoSignal: since,
                    sinceLead,
                    sinceZoneCourse: setting === 'auto' ? 1 : 30,
                    noSignalDue: true,
                    roadDue: false,
                  };
                  const p = plan({
                    level: level as Plan['level'],
                    target,
                    badHabits: target ? [{ code: target, count: 2, cleanRuns: 0, lastRun: 1 }] : [],
                    trackSetting: setting,
                  });
                  const x = { ...turnInputs(p, turns), cover: { plain: cover, signalZone: cover, noSignal: cover, lead: cover } };
                  const probs = turnProbs(x, avail);
                  const q = probs[ns[0]] + probs[ns[1]];
                  if (q < low) [low, where] = [q, `${setting} L${level} ${target ?? '습관 없음'}`];
                  if (!target) lowFree = Math.min(lowFree, q);
                }
        }
    expect(low, where).toBeGreaterThanOrEqual(0.75);
    expect(lowFree).toBeGreaterThanOrEqual(0.85);
  });

  it('최종 후보는 모두 뽑은 갈래의 판이고, 고른 판이 맨 앞이다', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const level of [3, 6, 9] as const) {
      const out = aiCourses(plan({ level }), [], [], rnd, seenShapes([]), coverageOf([], level), 300)!;
      expect(out.courses[0]).toBe(out.pick.entry);
      for (const e of out.courses) expect(turnClassOf(e)).toBe(out.turn);
    }
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
      expect(['habit', 'weak', 'fit', 'novel', 'review', 'turn']).toContain(why.group);
      expect(why.drop).toBeGreaterThan(0);
    }
  });
});
