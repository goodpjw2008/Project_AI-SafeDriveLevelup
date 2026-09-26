/**
 * 커리큘럼의 진급 규칙 — **이 게임의 학습 설계 그 자체**라 못 박아 둔다.
 *
 * 여기서 지키려는 것은 두 가지다.
 *  - 레벨은 **경험치가 차야** 오른다 (낮은 레벨은 한 판, 높은 레벨일수록 여러 판). 틀리면 경험치를 잃을 뿐 내려가지는 않는다
 *  - 마스터는 **최고 레벨의 경험치를 채우고** 나쁜 습관이 하나도 없을 때만이다
 */

import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  MAX_LEVEL,
  XP_PER_CLEAN_RUN,
  XP_REPLAY,
  XP_MAX,
  XP_TO_NEXT,
  xpToNext,
  START_LEVEL,
  levelTier,
  recordHabits,
  courseTitle,
  levelLabel,
  unlockedLevel,
  advance,
  checkDifficulty,
  clampToLevel,
  describesRemoved,
  currentTarget,
  freshCurriculum,
  type CurriculumState,
} from '../src/scenarios/curriculum';
import { SCENARIOS, type ScenarioSpec } from '../src/scenarios/scenarios';
import type { JudgeResult } from '../src/rules/lawRules';
import type { ViolationCode } from '../src/rules/violations';
import { HABIT_CLEARED_AFTER } from '../src/coach/badHabits';

/** 판정 결과 흉내 — 진급 규칙이 보는 것은 위반 목록과 실패 사유뿐이다 */
const run = (codes: string[] = [], failReason: string | null = null): JudgeResult =>
  ({
    violations: codes.map((code) => ({ code })),
    failReason,
  }) as unknown as JudgeResult;

const clean = (): JudgeResult => run();

/** 그 레벨에 서 있는 새 학습자 — 강등 규칙은 1레벨에서는 볼 수 없어 위에서 시작한다 */
const at = (level: CurriculumState['level']): CurriculumState => ({ ...freshCurriculum(), level });

describe('진급', () => {
  /** advance 는 { next, change } 를 준다 — 진급 규칙만 볼 때는 next 만 쓴다 */
  const step = (s: CurriculumState, r: JudgeResult): CurriculumState => advance(s, r).next;

  /*
    **처음 앉는 자리는 1레벨이다** (START_LEVEL). 레벨마다 새 개념을 하나씩 열어
    (library.ts 의 levelOf) L1 에 기본 두 규칙(적색 일시정지 · 보행자 보호)이 모두 들어 있다.
  */
  it('처음 앉는 자리는 1레벨이다', () => {
    expect(freshCurriculum().level).toBe(START_LEVEL);
    expect(START_LEVEL).toBe(1);
  });

  /*
    **어느 레벨도 한 판으로는 오르지 않는다** — 사용자가 "1판만 했는데 레벨 2로 올라갔어 … 저랩에서 너무 쉽게" 라고 했다.
    한 판은 운일 수 있다. 그 뒤 "레벨이 너무 늦게 오른다" 는 말에 가장 낮은 레벨을 세 판에서 **두 판**으로 줄였다 — 한 판은 아니다.
  */
  it('무위반 한 판으로는 오르지 않는다 — 가장 낮은 레벨도 두 판이다', () => {
    let s = step(freshCurriculum(), clean());
    expect(s.level).toBe(START_LEVEL);
    expect(s.runs).toBe(1);
    expect(s.xp).toBe(XP_PER_CLEAN_RUN);
    s = step(s, clean());
    expect(s.level).toBe(START_LEVEL + 1);
    expect(s.xp, '새 레벨은 빈 막대에서').toBe(0);
  });

  it('이미 통과한 맵을 다시 통과하면 경험치가 절반이다', () => {
    const replay = advance(freshCurriculum(), clean(), undefined, undefined, { replay: true });
    expect(replay.xp.gained).toBe(XP_REPLAY);
    expect(replay.xp.replay).toBe(true);
    expect(XP_REPLAY * 2).toBe(XP_PER_CLEAN_RUN);
    // 같은 맵만 되풀이하면 두 배를 달려야 한다
    let s = freshCurriculum();
    let n = 0;
    while (s.level === START_LEVEL && n < 20) {
      s = advance(s, clean(), undefined, undefined, { replay: true }).next;
      n++;
    }
    expect(n).toBe((XP_TO_NEXT[1] / XP_REPLAY));
  });

  it('다시 달린 맵에서 틀리면 절반 표시는 없다 — 잃는 양은 그대로', () => {
    const r = advance({ ...at(5), xp: 100 }, run(['NO_SLOW_DOWN']), undefined, { xpScale: 1, missPenalty: 20 }, { replay: true });
    expect(r.xp.replay).toBe(false);
    expect(r.xp.gained).toBe(-20);
  });

  it('한 번 틀린 것으로는 내려가지 않는다', () => {
    const s = step(freshCurriculum(), run(['NO_SLOW_DOWN']));
    expect(s.level).toBe(START_LEVEL);
    expect(s.missStreak).toBe(1);
  });

  it('이어 틀려도 레벨은 내려가지 않는다 — 경험치를 잃을 뿐이다', () => {
    let s = step(at(5), run(['NO_SLOW_DOWN']));
    s = step(s, run(['WIDE_TURN']));
    expect(s.level).toBe(5);
    expect(s.missStreak).toBe(2);
  });

  /*
    **경험치 곡선은 평평하다** — 모든 레벨이 200, 새 맵 무위반 **두 판**이면 오른다.

    사용자가 정한 값이다: "각 단계의 레벨을 200점을 맥스로 해 줘. 2게임만 성공하면 바로 레벨업이
    되는 거지. 레벨이 쉽게 올라야 사용자들이 체감하기 좋을 것 같아." 그 전에는 2 · 2 · 3 · 3 ·
    3 · 3 · 4 · 4 · 4 · 4판(모두 32판)이었고, 그보다 앞서는 55판이었다.

    **두 판이 바닥이다.** 한때 L1~L3 이 한 판이면 올랐는데 사용자가 짚었다 — "1판만 했는데 레벨 2로
    올라갔어." 한 판은 운일 수 있다(보행자가 마침 안 나왔거나 신호가 마침 맞았다).
  */
  it('어느 레벨이든 새 맵 무위반 두 판이면 오른다', () => {
    const runsToLevelUp = (level: CurriculumState['level']): number => {
      let s = at(level);
      let n = 0;
      while (s.level === level && n < 50) {
        s = step(s, clean());
        n++;
      }
      return n;
    };
    expect(([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((l) => runsToLevelUp(l))).toEqual([
      2, 2, 2, 2, 2, 2, 2, 2, 2,
    ]);
    expect(XP_TO_NEXT[MAX_LEVEL] / XP_PER_CLEAN_RUN, 'L10 → 안전운전 마스터').toBe(2);
    for (let l = 1; l <= MAX_LEVEL; l++) {
      expect(XP_TO_NEXT[l as 1], `L${l}`).toBe(XP_MAX);
    }
    expect(
      Object.values(XP_TO_NEXT).reduce((n, x) => n + x, 0) / XP_PER_CLEAN_RUN,
      '마스터까지 새 맵 무위반 20판',
    ).toBe(20);
  });

  /*
    **난이도는 필요한 경험치를 바꾸지 않는다** — 200 이 막대의 최대치이기 때문이다 (XP_MAX).
    어려움이 어려운 자리는 **감점**과 코스 · 주행 · 도움이다 (challenge.ts). 판을 더 많이
    달리게 하는 것은 어려움이 아니라 시간이 더 드는 것뿐이다.
  */
  it('난이도를 바꿔도 두 판이다 — 200 이 막대의 최대치다', () => {
    for (const xpScale of [0.5, 0.75, 1, 1.25, 1.5]) {
      for (let l = 1; l <= MAX_LEVEL; l++) {
        const need = xpToNext(l as 1, { xpScale, missPenalty: 0 });
        // 위로는 200 을 넘지 않고(XP_MAX), 아래로는 한 판으로 오르지 않는다(XP_FLOOR)
        expect(need, `×${xpScale} L${l}`).toBeLessThanOrEqual(XP_MAX);
        expect(need, `×${xpScale} L${l}`).toBeGreaterThan(XP_PER_CLEAN_RUN);
        // 어느 쪽이든 **무위반 두 판**이다 — 경험치는 한 판에 100 씩 들어온다
        expect(Math.ceil(need / XP_PER_CLEAN_RUN), `×${xpScale} L${l}`).toBe(2);
      }
    }
  });

  it('1레벨에서는 더 내려가지 않는다', () => {
    let s = freshCurriculum();
    for (let i = 0; i < 20; i++) s = step(s, run(['NO_SLOW_DOWN']));
    expect(s.level).toBe(1);
  });

  it('무위반이 섞이면 연속 실패가 끊긴다 — 다만 습관이 남아 있으면 레벨은 그대로다', () => {
    let s = step(freshCurriculum(), run(['NO_SLOW_DOWN']));
    s = step(s, clean());
    expect(s.missStreak).toBe(0);
    expect(s.level, '서행 습관이 아직 남았다').toBe(START_LEVEL);
  });

  it('완주 실패도 위반과 같이 다룬다 — 무위반 연속이 끊긴다', () => {
    const s = step(freshCurriculum(), run([], 'PEDESTRIAN_HIT'));
    expect(s.cleanStreak).toBe(0);
  });
});

/*
  **위반하면 경험치를 잃는다** — 난이도가 정한 만큼 (challenge.ts 의 missPenalty). 사고 · 이탈 · 한 판에 셋 이상 위반은
  두 배다. 예전에는 이런 판에서 레벨을 곧바로 내렸다 — 경험치를 둔 뒤로는 레벨 대신 막대가 줄어든다.
*/
describe('위반하면 경험치를 잃는다', () => {
  const normal = { xpScale: 1, missPenalty: 20 };
  const half = (level: CurriculumState['level']): CurriculumState => ({ ...at(level), xp: 100 });

  it('보통에서 위반한 판은 20 을 잃는다', () => {
    const r = advance(half(5), run(['NO_SLOW_DOWN']), undefined, normal);
    expect(r.next.xp).toBe(80);
    expect(r.xp.gained).toBe(-20);
    expect(r.next.level).toBe(5);
  });

  it('사고 · 이탈 · 위반 셋 이상은 두 배를 잃는다', () => {
    expect(advance(half(5), run([], 'PEDESTRIAN_HIT'), undefined, normal).next.xp).toBe(60);
    expect(advance(half(5), run(['RED_NO_STOP', 'NO_SLOW_DOWN', 'WIDE_TURN']), undefined, normal).next.xp).toBe(60);
  });

  it('0 아래로는 내려가지 않고, 레벨도 그대로다', () => {
    let s = at(5);
    for (let i = 0; i < 5; i++) s = advance(s, run([], 'OFF_ROAD'), undefined, normal).next;
    expect(s.xp).toBe(0);
    expect(s.level).toBe(5);
  });

  it('쉬운 난이도(감점 0)에서는 잃지 않는다', () => {
    expect(advance(half(5), run(['NO_SLOW_DOWN'])).next.xp).toBe(100);
  });
});

/*
  **서 있는 것과 통과한 것은 다르다.** 5레벨은 주어진 자리라, 앉자마자 다섯 대가
  열리면 이 게임이 보상하려는 것과 화면이 보여 주는 것이 어긋난다.
*/
describe('차가 열리는 자리 — bestLevel', () => {
  const step = (s: CurriculumState, r: JudgeResult): CurriculumState => advance(s, r).next;

  it('시작 레벨은 차를 열지 않는다', () => {
    const s = freshCurriculum();
    expect(s.level).toBe(START_LEVEL);
    expect(s.bestLevel, '앉자마자 열리는 것은 시작 차 하나뿐이다').toBe(1);
  });

  it('틀린 판은 통과가 아니다', () => {
    const s = step(freshCurriculum(), run(['NO_SLOW_DOWN']));
    expect(s.bestLevel).toBe(1);
  });

  /** 막대가 한 판 남은 L1 — 다음 무위반이 L1 을 통과하는 판이다 */
  const almost = (): CurriculumState => ({ ...freshCurriculum(), xp: XP_TO_NEXT[1] - XP_PER_CLEAN_RUN });

  it('통과한 레벨만큼 열린다 — 올라간 뒤의 레벨이 아니라 방금 통과한 레벨', () => {
    const s = step(almost(), clean());
    expect(s.level, '자리는 2로 올라가고').toBe(START_LEVEL + 1);
    expect(s.bestLevel, '열리는 것은 방금 통과한 1까지다').toBe(START_LEVEL);
  });

  it('무위반이어도 막대가 차기 전에는 통과가 아니다', () => {
    const s = step(freshCurriculum(), clean());
    expect(s.level).toBe(START_LEVEL);
    expect(s.bestLevel).toBe(1);
  });

  it('경험치를 잃어도 이미 통과한 자리는 남는다', () => {
    let s = step(almost(), clean()); // L1 통과 → bestLevel 1
    s = advance(s, run([], 'OFF_ROAD'), undefined, { xpScale: 1, missPenalty: 20 }).next;
    expect(s.level).toBe(START_LEVEL + 1);
    expect(s.bestLevel).toBe(START_LEVEL);
  });
});

/*
  **습관은 어느 판에서든 쌓인다.**

  예전에는 AI 과정의 판에서만 셌다. 그래서 손으로 쓴 11판을 엉망으로 몰아도 습관 기록은
  비어 있었고, AI 과정에 처음 들어온 사람의 프롬프트가 "기록된 것이 없습니다" 와
  "위반 7회" 를 동시에 말했다.
*/
describe('수동 주행의 습관 기록 — recordHabits', () => {
  it('위반을 습관으로 남긴다', () => {
    const s = recordHabits(freshCurriculum(), run(['PEDESTRIAN_BLOCKED']));
    expect(s.badHabits.map((h) => h.code)).toEqual(['PEDESTRIAN_BLOCKED']);
    expect(currentTarget(s)).toBe('PEDESTRIAN_BLOCKED');
  });

  it('레벨·판 수·연속 기록은 건드리지 않는다', () => {
    const before = freshCurriculum();
    const s = recordHabits(before, run(['PEDESTRIAN_BLOCKED']));
    expect(s.level).toBe(before.level);
    expect(s.runs, 'runs 는 이 과정에서 푼 판 수다 — 손으로 쓴 판은 세지 않는다').toBe(before.runs);
    expect(s.missStreak).toBe(before.missStreak);
    expect(s.bestLevel).toBe(before.bestLevel);
  });

  it('무위반으로 지나가면 습관이 고쳐지는 셈에 들어간다', () => {
    let s = recordHabits(freshCurriculum(), run(['PEDESTRIAN_BLOCKED']));
    for (let i = 0; i < HABIT_CLEARED_AFTER; i++) s = recordHabits(s, clean());
    expect(s.badHabits, '수동 주행에서 고쳐도 사라진다').toEqual([]);
  });

  it('AI 과정이 그 기록을 이어받는다', () => {
    // 수동으로 세 판 몰며 습관을 쌓고
    let s = freshCurriculum();
    for (let i = 0; i < 3; i++) s = recordHabits(s, run(['SCHOOL_ZONE_NO_STOP']));
    // AI 과정의 첫 판이 그것을 시험할 것으로 집는다
    expect(currentTarget(s)).toBe('SCHOOL_ZONE_NO_STOP');
    expect(s.badHabits[0].count).toBe(3);
  });
});

describe('마스터', () => {
  const step = (s: CurriculumState, r: JudgeResult): CurriculumState => advance(s, r).next;
  const toTop = (): CurriculumState => {
    let s = freshCurriculum();
    while (s.level < MAX_LEVEL) s = step(s, clean());
    return s;
  };

  it('최고 단계에 닿는 것만으로는 마스터가 아니다', () => {
    const s = toTop();
    expect(s.level).toBe(MAX_LEVEL);
    expect(s.mastered).toBe(false);
  });

  it('최고 단계의 경험치를 채우면 마스터다 (보통 무위반 10판)', () => {
    let s = toTop();
    const runs = XP_TO_NEXT[MAX_LEVEL] / XP_PER_CLEAN_RUN;
    for (let i = 0; i < runs; i++) {
      expect(s.mastered).toBe(false);
      s = step(s, clean());
    }
    expect(s.mastered).toBe(true);
  });

  it('중간에 틀리면 연속은 끊기지만 모은 경험치는 남는다 (감점 없는 난이도)', () => {
    /*
      **두 판이면 마스터다** (XP_MAX = 200). 그래서 '아직 마스터가 아닌' 자리를 보려면
      한 판만 통과한 뒤 틀려야 한다 — 막대가 평평해지며 달라진 것은 판 수뿐이다.
    */
    let s = toTop();
    s = step(s, clean());
    s = step(s, run(['PEDESTRIAN_BLOCKED']));
    expect(s.cleanStreak).toBe(0);
    expect(s.xp).toBe(XP_PER_CLEAN_RUN);
    expect(s.mastered).toBe(false);
  });
});

describe('나쁜 운전 습관을 기록한다', () => {
  const step = (s: CurriculumState, r: JudgeResult): CurriculumState => advance(s, r).next;
  const codesOf = (s: CurriculumState): string[] => s.badHabits.map((h) => h.code);

  it('처음에는 습관이 없다', () => {
    expect(freshCurriculum().badHabits).toEqual([]);
    expect(currentTarget(freshCurriculum())).toBeNull();
  });

  it('위반하면 습관으로 붙고 횟수를 센다', () => {
    let s = step(freshCurriculum(), run(['PEDESTRIAN_BLOCKED', 'NO_SLOW_DOWN']));
    s = step(s, run(['PEDESTRIAN_BLOCKED']));
    expect(s.badHabits.find((h) => h.code === 'PEDESTRIAN_BLOCKED')!.count).toBe(2);
    expect(s.badHabits.find((h) => h.code === 'NO_SLOW_DOWN')!.count).toBe(1);
  });

  it('가장 많이 저지른 것을 다음 판의 표적으로 삼는다', () => {
    let s = step(freshCurriculum(), run(['NO_SLOW_DOWN']));
    s = step(s, run(['PEDESTRIAN_BLOCKED']));
    s = step(s, run(['PEDESTRIAN_BLOCKED']));
    expect(currentTarget(s)).toBe('PEDESTRIAN_BLOCKED');
  });

  /*
    이 규칙이 이 기능의 핵심이다 — 고친 습관이 사라지지 않으면 AI 는 이미 고친 것을
    계속 시험하는 판을 만들고, 학습자는 나아졌는데도 같은 상황만 되풀이해 만난다.
  */
  it(`그 위반 없이 ${HABIT_CLEARED_AFTER}판을 지나면 습관이 사라진다`, () => {
    let s = step(freshCurriculum(), run(['NO_SLOW_DOWN']));
    expect(codesOf(s)).toContain('NO_SLOW_DOWN');

    // 마지막 한 판 전까지는 남아 있다 — 한 번은 운일 수 있어 한 판으로는 풀지 않는다
    for (let i = 0; i < HABIT_CLEARED_AFTER - 1; i++) {
      s = step(s, clean());
      expect(codesOf(s), `${i + 1}판째는 아직 남는다`).toContain('NO_SLOW_DOWN');
    }

    const last = advance(s, clean());
    expect(codesOf(last.next), `${HABIT_CLEARED_AFTER}판째에 사라진다`).not.toContain('NO_SLOW_DOWN');
    expect(last.change.cleared).toContain('NO_SLOW_DOWN');
  });

  it('중간에 다시 저지르면 처음부터 다시 센다', () => {
    let s = step(freshCurriculum(), run(['NO_SLOW_DOWN']));
    // 마지막 한 판을 남기고 다시 저지른다
    for (let i = 0; i < HABIT_CLEARED_AFTER - 1; i++) s = step(s, clean());
    s = step(s, run(['NO_SLOW_DOWN']));
    expect(s.badHabits.find((h) => h.code === 'NO_SLOW_DOWN')!.cleanRuns).toBe(0);

    for (let i = 0; i < HABIT_CLEARED_AFTER - 1; i++) s = step(s, clean());
    expect(codesOf(s), `아직 ${HABIT_CLEARED_AFTER}판이 안 됐다`).toContain('NO_SLOW_DOWN');
  });

  it('습관이 여럿이면 고친 것만 따로 사라진다', () => {
    let s = step(freshCurriculum(), run(['NO_SLOW_DOWN', 'WIDE_TURN']));
    // 서행은 고치고 대회전은 계속 저지른다
    for (let i = 0; i < 3; i++) s = step(s, run(['WIDE_TURN']));
    expect(codesOf(s)).not.toContain('NO_SLOW_DOWN');
    expect(codesOf(s)).toContain('WIDE_TURN');
  });

  it('새로 생긴 습관과 사라진 습관을 결과 화면에 알린다', () => {
    const first = advance(freshCurriculum(), run(['RED_NO_STOP']));
    expect(first.change.added).toEqual(['RED_NO_STOP']);
    expect(first.change.repeated).toEqual([]);

    let s = first.next;
    for (let i = 0; i < HABIT_CLEARED_AFTER - 1; i++) s = step(s, clean());
    const last = advance(s, clean());
    expect(last.change.cleared).toEqual(['RED_NO_STOP']);
  });
});

/*
  **난이도는 예산이다** (scenarios/difficulty.ts). 조건마다 값이 있고 레벨마다 쓸 수
  있는 점수가 있다. 여기서는 커리큘럼 쪽 얼굴(`checkDifficulty`·`clampToLevel`)만 보고,
  비용표 자체는 tests/difficulty.test.ts 가 본다.
*/
describe('난이도 검사 — 예산을 넘었는지', () => {
  const easy = (over: Partial<ScenarioSpec> = {}): ScenarioSpec => ({
    ...structuredClone(SCENARIOS[0]),
    startPhase: 0,
    pedestrians: [],
    crossTraffic: 1,
    isSchoolZone: false,
    exitBlocked: false,
    rightArrowInstalled: false,
    pedSignalInstalled: { A: true, C: true },
    timeOfDay: 'day',
    weather: 'clear',
    ...over,
  });

  it('아무 조건도 안 켠 판은 예산 0인 1레벨도 통과한다', () => {
    expect(checkDifficulty(easy(), 1)).toEqual([]);
  });

  it('1레벨(예산 0)에 어린이보호구역을 넣으면 걸린다', () => {
    expect(checkDifficulty(easy({ isSchoolZone: true }), 1)).toHaveLength(1);
  });

  it('사유에 무엇이 얼마나 들었는지 적는다 — 되먹임으로 그대로 나간다', () => {
    const [msg] = checkDifficulty(easy({ isSchoolZone: true, startPhase: 5 }), 1);
    expect(msg).toContain('예산 0점');
    expect(msg).toContain('어린이보호구역');
    expect(msg).toContain('적색');
  });

  /*
    **이 한 줄이 예산제로 바꾼 이유다.** 옛 표에서 보호구역은 5단계부터였고,
    그래서 3단계 학습자의 약점이 보호구역이면 그 판을 만들 수 없었다.
  */
  it('보호구역이 3레벨(예산 3)에서도 통과한다 — 나머지가 쉬우면', () => {
    expect(checkDifficulty(easy({ isSchoolZone: true, startPhase: 5 }), 3)).toEqual([]);
  });

  it('약점 묶음은 값을 받지 않는다 — 예산 0인 1레벨에서도 통과한다', () => {
    const s = easy({ isSchoolZone: true, pedSignalInstalled: { A: true, C: false } });
    expect(checkDifficulty(s, 1), '정가 4점').toHaveLength(1);
    expect(
      checkDifficulty(s, 1, ['schoolZone', 'missingPedSignal']),
      '이 학습자의 약점이면 공짜',
    ).toEqual([]);
  });

  it('레벨이 오를수록 더 많이 받는다', () => {
    const heavy = easy({ isSchoolZone: true, exitBlocked: true, startPhase: 5 }); // 5점
    expect(checkDifficulty(heavy, 3)).toHaveLength(1); // 예산 3
    expect(checkDifficulty(heavy, 4)).toEqual([]); // 예산 5
  });
});

describe('예산 안으로 깎아 넣기', () => {
  const heavy = (over: Partial<ScenarioSpec> = {}): ScenarioSpec => ({
    ...structuredClone(SCENARIOS[0]),
    startPhase: 5,
    crossTraffic: 4,
    isSchoolZone: true,
    exitBlocked: true,
    rightArrowInstalled: true,
    pedSignalInstalled: { A: false, C: false },
    timeOfDay: 'night',
    weather: 'rain',
    pedestrians: [
      { crosswalk: 'C', at: 0, from: 'left', startWithin: 10, obeysSignal: false },
      { crosswalk: 'C', at: 2, from: 'right', startWithin: 12, chance: 0.5 },
      { crosswalk: 'A', at: 1, from: 'left', startWithin: 14 },
    ] as ScenarioSpec['pedestrians'],
    ...over,
  });

  it('1레벨로 깎으면 검사를 통과한다', () => {
    const out = clampToLevel(heavy(), 1);
    expect(checkDifficulty(out, 1)).toEqual([]);
  });

  /*
    **AI 가 새로 만든 판도 L1 에서는 밤이 아니다** — 사용자가 "레벨 1 에는 야간 운전은 나오지 않게" 라고 했다. L1 예산은
    0점이고 밤 · 비는 어떤 약점 묶음에도 들지 않아(difficulty.ts 의 TARGET_KIT) 늘 깎인다. 어느 약점을 안고 와도 그렇다.
  */
  it('L1 로 깎으면 밤이 낮이 된다 — 어느 약점 묶음을 받아도', () => {
    const kits = [[], ['redStart'], ['lateStart'], ['rightArrow'], ['exitBlocked'], ['approachZone'], ['schoolZone', 'missingPedSignal']] as const;
    for (const kit of kits) {
      const out = clampToLevel(heavy(), 1, kit);
      expect(out.timeOfDay, kit.join(',')).toBe('day');
    }
  });

  it('10레벨로 깎아도 예산 안에 들어온다', () => {
    const out = clampToLevel(heavy(), 10);
    expect(checkDifficulty(out, 10)).toEqual([]);
  });

  /*
    **약점 묶음은 절대 깎지 않는다.** 그것을 깎으면 이 판을 만든 이유가 사라진다.
    예산이 0인데 묶음이 4점어치여도 그대로 남긴다.
  */
  it('약점 묶음은 예산 0에서도 살아남는다', () => {
    const out = clampToLevel(heavy(), 1, ['schoolZone', 'missingPedSignal']);
    expect(out.isSchoolZone, '보호구역은 남는다').toBe(true);
    expect(out.pedSignalInstalled.C, '신호기 없음도 남는다').toBe(false);
    expect(out.exitBlocked, '곁가지는 깎인다').toBe(false);
    expect(out.rightArrowInstalled).toBe(false);
  });

  it('비싼 곁가지부터 깎는다 — 판을 통째로 무르지 않는다', () => {
    // 예산 13(L8) 이면 다 못 담지만 절반쯤은 남는다
    const out = clampToLevel(heavy(), 8);
    const kept = [out.isSchoolZone, out.exitBlocked, out.rightArrowInstalled].filter(Boolean);
    expect(kept.length, '몇 가지는 살아남는다').toBeGreaterThan(0);
    expect(checkDifficulty(out, 8)).toEqual([]);
  });

  it('이미 예산 안이면 손대지 않는다', () => {
    const light = { ...heavy(), ...{} };
    const out = clampToLevel(light, 10);
    const twice = clampToLevel(out, 10);
    expect(twice).toEqual(out);
  });
});

describe('깎았는데 글이 그대로면 잡는다', () => {
  const spec = (over: Partial<ScenarioSpec>): ScenarioSpec => ({
    ...structuredClone(SCENARIOS[0]),
    title: '정면신호 녹색 - 보행자',
    brief: '보행자를 확인하세요.',
    teaches: '보행자의 통행 여부가 기준입니다.',
    isSchoolZone: false,
    ...over,
  });

  it('보호구역을 깎았는데 제목이 아직 그 말을 하면 걸린다', () => {
    const before = spec({ isSchoolZone: true, title: '어린이보호구역 - 신호기 없는 횡단보도' });
    const after = { ...before, isSchoolZone: false };
    expect(describesRemoved(before, after).length).toBeGreaterThan(0);
  });

  it('깎지 않았으면 같은 제목도 통과한다', () => {
    const s = spec({ isSchoolZone: true, title: '어린이보호구역 - 아이가 없어도' });
    expect(describesRemoved(s, s)).toEqual([]);
  });

  /*
    **애초에 켜지 않은 조건을 말했다고 반려하지 않는다.** 옛 검사는 "이 레벨에서 금지인
    말이 글에 있는가" 를 봐서, 모델이 설명 삼아 쓴 말까지 걸렸다.
  */
  it('켠 적 없는 조건을 글이 언급해도 통과한다', () => {
    const s = spec({ title: '어린이보호구역이 아닌 평범한 교차로' });
    expect(describesRemoved(s, s)).toEqual([]);
  });

  it('조건과 글이 맞으면 통과한다', () => {
    const s = spec({});
    expect(describesRemoved(s, s)).toEqual([]);
  });
});

describe('레벨 — Level1 에서 안전운전 마스터까지', () => {
  const step = (s: CurriculumState, r: JudgeResult): CurriculumState => advance(s, r).next;

  it('레벨은 열이고 1에서 시작해 빈틈없이 이어진다', () => {
    expect(LEVELS.length).toBe(MAX_LEVEL);
    expect(LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  /*
    **예산은 줄지 않는다.** 위로 갈수록 쓸 수 있는 점수가 늘어야 레벨이 난이도의 뜻을
    갖는다. 한 칸이라도 뒤집히면 그 레벨에서 판이 갑자기 쉬워진다.
  */
  it('예산은 레벨을 따라 오르기만 한다', () => {
    expect(LEVELS[0].budget, '1레벨은 조건을 하나도 못 켠다').toBe(0);
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].budget, `L${i + 1}`).toBeGreaterThan(LEVELS[i - 1].budget);
    }
  });

  it('난이도의 결은 다섯이고 아래에서 위로 간다', () => {
    expect(levelTier(1)).toBe('입문');
    expect(levelTier(5)).toBe('보통');
    expect(levelTier(10)).toBe('실전');
    // 열 레벨이 모두 어느 결엔가 속한다
    for (let n = 1; n <= MAX_LEVEL; n++) expect(levelTier(n as 1)).toBeTruthy();
  });

  // 'L1' 이 아니라 'Level1' 이다 — 처음 여는 사람에게 'L' 한 글자는 레벨인지 차로인지 알 수 없다 (사용자 요청)
  it('레벨 이름은 Level1 … Level10 이다', () => {
    expect(levelLabel(1)).toBe('Level1');
    expect(levelLabel(10)).toBe('Level10');
    // 열 개가 모두 다른 이름이어야 한다 — 뱃지 숫자가 곧 이 이름이다
    expect(new Set(LEVELS.map((l) => levelLabel(l.level))).size).toBe(MAX_LEVEL);
  });

  it('처음은 안전운전 Level1 이다 — 기본 두 규칙부터', () => {
    expect(courseTitle(freshCurriculum())).toBe('안전운전 Level1');
  });

  it('경험치가 차면 호칭이 따라 오른다', () => {
    let s = freshCurriculum();
    for (let n = START_LEVEL + 1; n <= MAX_LEVEL; n++) {
      while (s.level < n) s = step(s, clean());
      expect(courseTitle(s), `${n}레벨`).toBe(n === MAX_LEVEL ? '안전운전 Level10 도전' : `안전운전 Level${n}`);
    }
  });

  /*
    **닿은 것과 해낸 것은 다르다.** 최고 레벨에 올라선 순간 '마스터' 라고 부르면
    거기서부터 남은 연속 무위반 3판이 사라진 것처럼 읽힌다.
  */
  it('최고 레벨에 닿아도 아직 마스터가 아니다', () => {
    let s = freshCurriculum();
    while (s.level < MAX_LEVEL) s = step(s, clean());
    expect(s.mastered).toBe(false);
    expect(courseTitle(s)).toBe('안전운전 Level10 도전');
  });

  it('L10 의 경험치를 채워야 안전운전 마스터가 된다', () => {
    let s = freshCurriculum();
    while (s.level < MAX_LEVEL) s = step(s, clean());
    while (!s.mastered) s = step(s, clean());
    expect(courseTitle(s)).toBe('안전운전 마스터');
  });

  it('틀려도 호칭은 그대로다 — 레벨은 내려가지 않는다', () => {
    let s = at(5);
    s = step(s, run(['NO_SLOW_DOWN']));
    s = step(s, run(['WIDE_TURN']));
    expect(courseTitle(s)).toBe('안전운전 Level5');
  });

  /*
    **강등돼도 열린 차는 닫히지 않는다.** 차를 잃지 않으려고 쉬운 판만 고르게 만들
    이유가 없고, 얻은 것을 도로 빼앗는 것은 이 게임이 하려는 일이 아니다.
  */
  it('차가 열리는 기준은 지금 레벨이 아니라 통과한 최고 기록이다', () => {
    let s = freshCurriculum();
    expect(unlockedLevel(s), '5레벨에 앉아 있어도 통과한 것은 없다').toBe(1);

    // 한 레벨을 통과할 때까지 새 맵을 무위반으로 달린다 (가장 낮은 레벨도 세 판)
    const pass = (from: CurriculumState): CurriculumState => {
      let t = from;
      while (t.level === from.level) t = step(t, clean());
      return t;
    };
    s = pass(s); // L1 통과
    s = pass(s); // L2 통과
    expect(unlockedLevel(s)).toBe(START_LEVEL + 1);

    s = step(s, run(['NO_SLOW_DOWN']));
    s = step(s, run(['WIDE_TURN']));
    expect(s.level).toBe(START_LEVEL + 2);
    expect(unlockedLevel(s), '틀려도 최고 기록은 남는다').toBe(START_LEVEL + 1);
  });
});


/*
  **학습 루프 — 습관을 고쳐야 올라간다.**

  이 과정은 "나쁜 습관을 찾아 → 그 습관을 시험하는 판에서 고치고 → 다 고치면 더 어려운 판으로"
  를 되풀이한다. 아래가 그 규칙이다:
   - 습관은 **그 위반이 일어날 수 있었던 판**에서 `HABIT_CLEARED_AFTER` 판 지켜야 풀린다 (녹색 판은 적색 습관을 풀지 못한다)
   - 끝내지 못한 판(사고 · 이탈)은 지킨 것으로 세지 않는다
   - 습관이 남아 있으면 무위반이어도 레벨이 오르지 않는다. 마지막 습관이 풀리는 판에서 오른다
   - 마스터도 습관이 하나도 없을 때만이다
*/
describe('학습 루프 — 습관을 고쳐야 올라간다', () => {
  const RED = new Set<ViolationCode>(['RED_NO_STOP', 'NO_SLOW_DOWN', 'WIDE_TURN']);
  const GREEN = new Set<ViolationCode>(['NO_SLOW_DOWN', 'WIDE_TURN']);
  const step = (s: CurriculumState, r: JudgeResult, tested?: ReadonlySet<ViolationCode>) =>
    advance(s, r, tested).next;

  it('그 습관을 시험하지 않은 판은 세지 않는다 — 녹색 판만으로 적색 습관이 풀리지 않는다', () => {
    let s = step(freshCurriculum(), run(['RED_NO_STOP']), RED);
    for (let i = 0; i < 5; i++) s = step(s, clean(), GREEN);
    expect(s.badHabits.map((h) => h.code)).toEqual(['RED_NO_STOP']);
    expect(s.badHabits[0].cleanRuns).toBe(0);
    expect(s.level, '습관이 남아 레벨도 그대로').toBe(START_LEVEL);
  });

  it(`시험한 판에서 ${HABIT_CLEARED_AFTER}번 지키면 풀리고, 막대가 차 있으면 그 판에서 바로 오른다`, () => {
    /*
      **여기서 보는 것은 "습관이 마지막 관문인가" 다.** 그래서 막대를 미리 채워 두고 시작한다 —
      경험치는 따로 찬다(위 XP_TO_NEXT). 습관을 고치는 데 드는 판 수를 줄였을 때
      (`HABIT_CLEARED_AFTER` 3 → 2) 이 테스트가 경험치 부족으로 깨졌는데, 그것은 이 규칙이 아니라
      막대의 이야기다.
    */
    let s: CurriculumState = { ...freshCurriculum(), xp: XP_TO_NEXT[START_LEVEL] };
    s = step(s, run(['RED_NO_STOP']), RED);
    for (let i = 0; i < HABIT_CLEARED_AFTER - 1; i++) {
      s = step(s, clean(), RED);
      expect(s.level, '습관이 남아 있으면 막대가 차 있어도 오르지 않는다').toBe(START_LEVEL);
    }
    const last = advance(s, clean(), RED);
    expect(last.change.cleared).toEqual(['RED_NO_STOP']);
    expect(last.next.badHabits).toEqual([]);
    expect(last.next.level).toBe(START_LEVEL + 1);
  });

  it('끝내지 못한 판은 지킨 것으로 세지 않는다', () => {
    let s = step(freshCurriculum(), run(['RED_NO_STOP']), RED);
    s = step(s, run([], 'OFF_ROAD'), RED);
    expect(s.badHabits[0].cleanRuns).toBe(0);
  });

  it('습관이 없으면 막대가 차는 판에 오른다', () => {
    const s: CurriculumState = { ...freshCurriculum(), xp: XP_TO_NEXT[1] - XP_PER_CLEAN_RUN };
    expect(step(s, clean(), GREEN).level).toBe(START_LEVEL + 1);
  });

  /*
    **마스터 운행에서는 막대가 움직이지 않는다** — 오를 곳이 없어 위반해도 경험치를 잃지 않고, 마스터는 '처음부터 다시
    시작' 전까지 그대로다. 습관은 그대로 기록한다.
  */
  it('마스터가 된 뒤에는 위반해도 마스터이고 경험치는 가득 찬 채다 — 습관은 기록된다', () => {
    const rule = { xpScale: 1, missPenalty: 60 };
    const master: CurriculumState = { ...freshCurriculum(), level: 10, bestLevel: 10, xp: XP_TO_NEXT[10], mastered: true };
    const miss = advance(master, run(['RED_NO_STOP'], 'COLLISION'), RED, rule);
    expect(miss.next.mastered).toBe(true);
    expect(miss.next.level).toBe(10);
    expect(miss.next.xp).toBe(XP_TO_NEXT[10]);
    expect(miss.xp.gained).toBe(0);
    expect(miss.next.badHabits.map((h) => h.code)).toContain('RED_NO_STOP');
    const clean = advance(master, run(), GREEN, rule);
    expect(clean.next.mastered).toBe(true);
    expect(clean.next.xp).toBe(XP_TO_NEXT[10]);
    expect(clean.xp.leveledUp).toBe(false);
  });

  it('L10 의 경험치가 가득 차도 습관이 남아 있으면 마스터가 아니다', () => {
    let s: CurriculumState = { ...freshCurriculum(), level: 10, bestLevel: 10, xp: XP_TO_NEXT[10] - XP_PER_CLEAN_RUN };
    s = step(s, run(['RED_NO_STOP']), RED);
    for (let i = 0; i < 3; i++) s = step(s, clean(), GREEN);
    expect(s.xp, '막대는 가득').toBe(XP_TO_NEXT[10]);
    expect(s.mastered).toBe(false);
    for (let i = 0; i < HABIT_CLEARED_AFTER; i++) s = step(s, clean(), RED);
    expect(s.badHabits).toEqual([]);
    expect(s.mastered).toBe(true);
  });
});
