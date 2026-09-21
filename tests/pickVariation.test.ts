/**
 * **이번 판에서 반드시 바꿀 것** — 다양성을 부탁하지 않고 지정하는 자리
 * (scenarios/generate.ts 의 pickVariation).
 *
 * 여기서 지키려는 것은 둘이다.
 *  - **이 레벨에서 쓸 수 있는 축만** 고른다 — 못 쓰는 축을 시키면 clampToLevel 이
 *    값을 도로 꺼서, 부탁은 했는데 결과는 안 바뀌고 재시도만 는다
 *  - **이 학습자에게 필요한 다양성**부터 채운다 — 배열 순서를 그대로 도는 것은
 *    모두에게 똑같은 "다양성" 이라 AI 라고 부를 것이 없다
 */

import { describe, expect, it } from 'vitest';
import { pickVariation } from '../src/scenarios/generate';
import { ruleFor } from '../src/scenarios/curriculum';
import type { ScenarioSpec } from '../src/scenarios/scenarios';
import type { BadHabit } from '../src/coach/badHabits';
import type { ViolationCode } from '../src/rules/violations';

/** 아무 조건도 켜지 않은 판 — 여기서 하나씩 켜 가며 "이미 나온 축"을 만든다 */
const spec = (over: Partial<ScenarioSpec> = {}): ScenarioSpec =>
  ({
    id: 900,
    title: '테스트',
    brief: '',
    teaches: '',
    startPhase: 0,
    startPhaseElapsed: 0,
    pedSignalInstalled: { A: true, C: true },
    rightArrowInstalled: false,
    pedestrians: [],
    crossTraffic: 1,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
    ...over,
  }) as ScenarioSpec;

const habit = (code: ViolationCode): BadHabit => ({ code, count: 3, cleanRuns: 0, lastRun: 1 });

/** 정면 녹색 한 판만 나온 상태 — green 축은 덮였고 나머지는 다 비어 있다 */
const afterGreen = [spec({ startPhase: 0 })];

describe('예산에 안 들어오는 축은 시키지 않는다', () => {
  /*
    1레벨은 예산이 0이라 값이 드는 축을 하나도 못 켠다. 예산을 안 보던 때는 여기서도
    "적색 구간에서 시작하십시오" 를 보냈고, 트리머가 도로 깎아 재시도만 늘었다.
  */
  it('1레벨(예산 0)에서는 시킬 축이 없다 — 녹색은 이미 나왔고 나머지는 값이 든다', () => {
    expect(pickVariation(afterGreen, { level: ruleFor(1) })).toBeNull();
  });

  it('2레벨에서는 적색만 열린다', () => {
    const ask = pickVariation(afterGreen, { level: ruleFor(2) });
    expect(ask).toContain('적색');
  });

  it('레벨을 안 넘기면 예전처럼 전부 후보다 (커리큘럼 밖 생성)', () => {
    expect(pickVariation(afterGreen)).toContain('적색');
  });

  /*
    보호구역 축은 보호구역2 + 신호기없음2 = 4점이다. 예산 3점(L3)에는 안 들어오고
    5점(L4)부터 들어온다 — **옛 표에서는 L5 부터였다.** 예산제가 중간을 여는 지점이다.
  */
  it('축을 켤 값이 있어야 시킨다 — 보호구역 묶음은 4점', () => {
    const recent = [spec({ startPhase: 0 }), spec({ startPhase: 5 })];
    expect(pickVariation(recent, { level: ruleFor(3) }), 'L3 는 예산 3점').not.toContain(
      '어린이보호구역',
    );
    expect(pickVariation(recent, { level: ruleFor(4) }), 'L4 는 예산 5점').toContain(
      '어린이보호구역',
    );
  });

  /*
    **약점 묶음은 값이 0이라 어느 레벨에서도 들어온다.** 예산제로 바꾼 이유가 이것이다 —
    예산 0인 1레벨에서도 자기 약점 축은 시킬 수 있다.
  */
  it('약점 묶음은 예산 0에서도 시킨다', () => {
    const ask = pickVariation(afterGreen, {
      level: ruleFor(1),
      free: ['schoolZone', 'missingPedSignal'],
    });
    expect(ask).toContain('어린이보호구역');
  });

  it('축이 다 나왔으면 지정하지 않는다 — 그때부터는 모델이 섞게 둔다', () => {
    const recent = [
      spec({ startPhase: 0 }),
      spec({ startPhase: 5 }),
      spec({ isSchoolZone: true }),
      spec({ pedestrians: [{ crosswalk: 'C', at: 0 }, { crosswalk: 'C', at: 2 }] as never }),
      spec({ exitBlocked: true }),
      spec({ rightArrowInstalled: true }),
      spec({ timeOfDay: 'night' }),
      spec({ approachSchoolZone: { signal: false } }),
      spec({ leadCar: { behavior: 'rolling', path: 'right' } }),
      spec({ leadCar: { behavior: 'lawful', path: 'right' } }),
      spec({ leadCar: { behavior: 'lawful', path: 'straight' } }),
    ];
    expect(pickVariation(recent, { level: ruleFor(10) })).toBeNull();
  });

  it('아직 만든 판이 없으면 지정하지 않는다 — 비교할 것이 없다', () => {
    expect(pickVariation([], { level: ruleFor(10) })).toBeNull();
  });
});

describe('학습자의 약점을 먼저 채운다', () => {
  /*
    예전에는 배열 순서를 그대로 돌았다(green → red → schoolZone → …). 그래서 누가 하든
    같은 순서로 축이 돌았고, "다양성" 이 모두에게 똑같은 모양이었다.
  */
  it('가장 굳은 습관을 시험하는 축을 앞으로 당긴다', () => {
    const ask = pickVariation(afterGreen, {
      level: ruleFor(10),
      habits: [habit('BLOCKING_INTERSECTION')],
    });
    expect(ask, '꼬리물기 습관이면 배열 순서(적색)를 건너뛰고 진출로 막힘을 고른다').toContain(
      '진출로가 막힌',
    );
  });

  it('어린이보호구역 습관이면 보호구역 축을 고른다', () => {
    const ask = pickVariation(afterGreen, {
      level: ruleFor(10),
      habits: [habit('SCHOOL_ZONE_NO_STOP')],
    });
    expect(ask).toContain('어린이보호구역');
  });

  it('습관이 없으면 예전처럼 배열 순서를 따른다', () => {
    expect(pickVariation(afterGreen, { level: ruleFor(10) })).toContain('적색');
  });

  /*
    약점 묶음을 `free` 로 넘기지 않으면 정가를 치러야 하고, 그러면 예산이 모자란
    레벨에서는 못 시킨다. 실제 호출은 언제나 `free` 를 함께 넘기므로(generate.ts 의
    `freeOf`) 이 경우는 커리큘럼 밖 생성에서만 나온다.
  */
  it('약점 축이 예산에 안 들어오고 공짜도 아니면 쓸 수 있는 축으로 간다', () => {
    /*
      L2 는 예산 1점이다. 보호구역 축은 교차로 쪽이 4점, 진입부 쪽이 4점이라
      둘 다 못 산다 — 살 수 있는 것은 적색 시작(1점)뿐이다.
    */
    const ask = pickVariation(afterGreen, {
      level: ruleFor(2),
      habits: [habit('SCHOOL_ZONE_NO_STOP')],
    });
    expect(ask).not.toContain('어린이보호구역');
    expect(ask).toContain('적색');
  });

  it('맨 위 습관만 본다 — 고쳐야 할 것이 여럿이면 가장 굳은 것부터', () => {
    const ask = pickVariation(afterGreen, {
      level: ruleFor(10),
      habits: [habit('RIGHT_ARROW_RED'), habit('BLOCKING_INTERSECTION')],
    });
    expect(ask).toContain('우회전 신호등');
  });
});

/**
 * **어린이보호구역은 네 판에 한 판이다** (scenarios.ts 의 `SCHOOL_ZONE_CHANCE`).
 *
 * 차례가 아닌 판에서는 축으로도 뽑히지 않아야 한다 — 여기가 열려 있으면 "이번에는
 * 보호구역을 넣으십시오" 가 그대로 나가, 앞에서 막은 공짜 묶음이 아무 일도 못 한다.
 */
describe('보호구역 차례가 아닌 판', () => {
  /** 보호구역 축만 남기고 나머지는 다 덮은 상태 */
  const allButZone = [
    spec({ startPhase: 0 }),
    spec({ startPhase: 5 }),
    spec({ pedestrians: [{ crosswalk: 'C', at: 0, from: 'left' }, { crosswalk: 'C', at: 0, from: 'right' }] }),
    spec({ exitBlocked: true }),
    spec({ rightArrowInstalled: true }),
    spec({ timeOfDay: 'night' }),
    spec({ leadCar: { behavior: 'rolling', path: 'right' } }),
    spec({ leadCar: { behavior: 'lawful', path: 'right' } }),
    spec({ leadCar: { behavior: 'lawful', path: 'straight' } }),
  ];

  it('차례면 보호구역 축이 뽑힌다', () => {
    expect(pickVariation(allButZone, { schoolZone: true })).toContain('어린이보호구역');
  });

  it('차례가 아니면 뽑히지 않는다', () => {
    expect(pickVariation(allButZone, { schoolZone: false })).toBeNull();
  });

  it('약점이 보호구역이어도 차례가 아니면 뽑지 않는다', () => {
    const ask = pickVariation(allButZone, {
      habits: [habit('SCHOOL_ZONE_NO_STOP')],
      schoolZone: false,
    });
    expect(ask).toBeNull();
  });
});

describe('앞차 축', () => {
  it('정지선 위반이 굳은 사람에게는 일시정지를 건너뛰는 앞차를 먼저 준다', () => {
    const recent = [spec({ startPhase: 5 })];
    const ask = pickVariation(recent, { level: ruleFor(10), habits: [habit('RED_NO_STOP')] });
    expect(ask).toContain('rolling');
  });

  it('보행자 방해가 굳은 사람에게는 규정대로 서는 앞차를 준다', () => {
    const recent = [
      spec({ startPhase: 0 }),
      spec({ pedestrians: [{ crosswalk: 'C', at: 0, from: 'left' }, { crosswalk: 'C', at: 0, from: 'right' }] }),
    ];
    const ask = pickVariation(recent, { level: ruleFor(10), habits: [habit('PEDESTRIAN_BLOCKED')] });
    expect(ask).toContain('lawful');
  });
});

/**
 * **이번 판에 나올 앞차와 다른 축은 뽑지 않는다** (generate.ts 의 `Plan.lead`).
 *
 * 다양성을 채우자고 "직진 대기 앞차를 만드십시오" 라고 시켜 놓고, 정작 이번 판은 앞차가
 * 나올 차례가 아니면 — 모델은 시킨 대로 만들고 우리는 그것을 돌려보낸다. 2~5초짜리
 * 재시도만 늘고 학습자는 그만큼 기다린다.
 */
describe('앞차 차례와 축', () => {
  const recent = [spec({ startPhase: 5 })];

  it('앞차 차례가 아니면 앞차 축을 뽑지 않는다', () => {
    const ask = pickVariation(recent, {
      level: ruleFor(10),
      habits: [habit('RED_NO_STOP')],
      lead: null,
    });
    expect(ask == null || !ask.includes('앞차')).toBe(true);
  });

  it('직진 대기 차례면 다른 앞차 축은 뽑지 않는다', () => {
    const ask = pickVariation(recent, {
      level: ruleFor(10),
      habits: [habit('RED_NO_STOP')],
      lead: 'straight',
    });
    if (ask?.includes('앞차')) expect(ask).toContain('straight');
  });
});

/**
 * **함께 설 수 없는 축은 시키지 않는다** (generate.ts 의 `Axis.conflicts`).
 *
 * 우회전 신호등은 녹색 구간에서 시작해야 하는데, 정지선 위반을 시험하는 판이나 직진 대기 ·
 * 일시정지 건너뜀 앞차는 정면 적색에서 시작해야 한다. 둘을 함께 시켰더니 모델은 둘 다
 * 지키려다 "우회전까지 47초를 기다리는 판" 을 만들었고 세 번 모두 버려졌다.
 */
describe('서로 부딪히는 축', () => {
  // 적색 시작 · 보행자 여럿 · 보호구역 · 꼬리물기 · 진입부 보호구역까지는 이미 나왔다
  const recent = [
    spec({ startPhase: 5 }),
    spec({ isSchoolZone: true }),
    spec({ pedestrians: [{ crosswalk: 'C', at: 0, from: 'left' }, { crosswalk: 'C', at: 0, from: 'right' }] }),
    spec({ exitBlocked: true }),
    spec({ approachSchoolZone: { signal: false } }),
  ];

  it('직진 대기 앞차 판에는 우회전 신호등 · 녹색 시작을 시키지 않는다', () => {
    const ask = pickVariation(recent, { level: ruleFor(10), lead: 'straight' }) ?? '';
    expect(ask).not.toContain('rightArrowInstalled');
    expect(ask).not.toContain('startPhase 0~2');
  });

  it('정지선 위반을 시험하는 판(적색 시작이 공짜)에도 시키지 않는다', () => {
    const ask = pickVariation(recent, { level: ruleFor(10), free: ['redStart'], lead: null }) ?? '';
    expect(ask).not.toContain('rightArrowInstalled');
  });

  it('적색이 필요 없는 판에는 우회전 신호등을 시킬 수 있다', () => {
    const ask = pickVariation(recent, { level: ruleFor(10), lead: null }) ?? '';
    expect(ask).toMatch(/startPhase 0~2|rightArrowInstalled/);
  });
});
