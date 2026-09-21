/**
 * **난이도 예산** — 이 게임의 학습 설계가 숫자로 적힌 자리 (scenarios/difficulty.ts).
 *
 * 여기서 지키려는 것은 셋이다.
 *  - **옛 사다리를 재현한다** — 불리언 표에서 예산으로 옮기면서 조용히 쉬워지거나
 *    어려워지면 안 된다. L1 은 글자 그대로 같아야 한다
 *  - **약점은 공짜다** — 예산이 0인 L1 에서도 자기 약점을 만난다. 이것이 이 설계의 이유다
 *  - **깎으면 반드시 준다** — `relax` 가 값을 안 줄이면 트리머가 제자리를 돈다
 */

import { describe, expect, it } from 'vitest';
import {
  COST_TABLE,
  TARGET_KIT,
  checkBudget,
  costOf,
  freeKitFor,
  hasCondition,
  trimToBudget,
  type ConditionKey,
} from '../src/scenarios/difficulty';
import { LEVELS, MAX_LEVEL, ruleFor, type Difficulty } from '../src/scenarios/curriculum';
import { SCENARIOS, type ScenarioSpec } from '../src/scenarios/scenarios';
import { VIOLATIONS, type ViolationCode } from '../src/rules/violations';

/** 조건을 하나도 안 켠 판 — 여기서 하나씩 켜 가며 값을 잰다 */
const bare = (over: Partial<ScenarioSpec> = {}): ScenarioSpec => ({
  ...structuredClone(SCENARIOS[0]),
  startPhase: 0,
  startPhaseElapsed: 0,
  crossTraffic: 1,
  pedestrians: [],
  isSchoolZone: false,
  exitBlocked: false,
  rightArrowInstalled: false,
  pedSignalInstalled: { A: true, C: true },
  timeOfDay: 'day',
  weather: 'clear',
  ...over,
});

const ped = (over: Record<string, unknown> = {}): ScenarioSpec['pedestrians'][number] =>
  ({ crosswalk: 'C', at: 0, from: 'left', startWithin: 20, ...over }) as never;

const cost = (s: ScenarioSpec, free: ConditionKey[] = []): number => costOf(s, free).total;

describe('비용표', () => {
  it('아무 조건도 안 켠 판은 0점이다 — 옛 1단계와 글자 그대로 같다', () => {
    expect(cost(bare())).toBe(0);
    expect(cost(bare({ pedestrians: [ped()] })), '20m 밖 보행자 한 명도 0점').toBe(0);
  });

  it.each([
    ['적색 시작', bare({ startPhase: 5 }), 1],
    ['보행자 2명', bare({ pedestrians: [ped(), ped()] }), 1],
    ['보행자 4명', bare({ pedestrians: [ped(), ped(), ped(), ped()] }), 3],
    ['교차 차량 3대', bare({ crossTraffic: 3 }), 2],
    ['신호기 없음', bare({ pedSignalInstalled: { A: true, C: false } }), 2],
    ['어린이보호구역', bare({ isSchoolZone: true }), 2],
    ['밤', bare({ timeOfDay: 'night' }), 2],
    ['비', bare({ weather: 'rain' }), 2],
    ['밤 + 비', bare({ timeOfDay: 'night', weather: 'rain' }), 3],
    ['꼬리물기', bare({ exitBlocked: true }), 2],
    ['우회전 신호등', bare({ rightArrowInstalled: true }), 2],
    ['무단횡단', bare({ pedestrians: [ped({ obeysSignal: false })] }), 3],
    ['chance', bare({ pedestrians: [ped({ chance: 0.5 })] }), 3],
    ['16m 에서 나섬', bare({ pedestrians: [ped({ startWithin: 16 })] }), 2],
    ['10m 에서 나섬', bare({ pedestrians: [ped({ startWithin: 10 })] }), 5],
  ])('%s → %i점', (_name, spec, want) => {
    expect(cost(spec)).toBe(want);
  });

  /*
    **밤과 비를 따로 세지 않는 이유.** 둘 다 "보이는 거리가 준다" 는 한 가지를 한다.
    각각 2점씩 매기면 밤비 판이 보호구역 두 개짜리보다 비싸진다.
  */
  it('밤과 비가 겹쳐도 1점만 는다', () => {
    expect(cost(bare({ timeOfDay: 'night', weather: 'rain' }))).toBe(
      cost(bare({ timeOfDay: 'night' })) + 1,
    );
  });

  /*
    신호기가 없으면 지킬 신호가 없어 `obeysSignal` 이 무시된다(pedWalk.ts).
    거기에 값을 매기면 **없는 난이도를 세게 된다.**
  */
  it('신호기 없는 횡단보도의 무단횡단은 값을 매기지 않는다', () => {
    const s = bare({
      pedSignalInstalled: { A: true, C: false },
      pedestrians: [ped({ obeysSignal: false })],
    });
    expect(cost(s), '신호기 없음 2점뿐').toBe(2);
  });

  it('비용표는 조건마다 한 줄씩 있다 — 프롬프트가 이 표를 그대로 적는다', () => {
    const keys = new Set(COST_TABLE.map((c) => c.key));
    expect(keys.size, '중복 없음').toBe(COST_TABLE.length);
    for (const c of COST_TABLE) {
      expect(c.label.length, c.key).toBeGreaterThan(0);
      expect(c.note.length, c.key).toBeGreaterThan(0);
    }
  });
});

/*
  **옛 사다리를 재현하는가.**

  불리언 표에서 예산으로 옮기면서 난이도가 조용히 달라지면 안 된다. 옛 표의 각 단계에서
  실제로 만들던 판이 같은 레벨의 예산에 들어오는지 본다.
*/
describe('옛 사다리 재현', () => {
  it('L1 — 조건 없는 판만 (예산 0)', () => {
    expect(ruleFor(1).budget).toBe(0);
    expect(checkBudget(bare({ pedestrians: [ped()] }), 0)).toEqual([]);
    expect(checkBudget(bare({ startPhase: 5 }), 0), '적색은 못 켠다').toHaveLength(1);
  });

  it('L2 — 적색 시작이 들어온다', () => {
    expect(checkBudget(bare({ startPhase: 5 }), ruleFor(2).budget)).toEqual([]);
  });

  it('L5 — 옛 5단계가 만들던 판(보호구역+신호기없음+적색+보행자2)이 들어온다', () => {
    const s = bare({
      isSchoolZone: true,
      pedSignalInstalled: { A: true, C: false },
      startPhase: 5,
      pedestrians: [ped(), ped()],
    });
    expect(cost(s)).toBe(6);
    expect(checkBudget(s, ruleFor(5).budget), 'L5 예산 7점').toEqual([]);
  });

  /*
    **여기가 예산제로 바꾼 이유다.** 옛 표에서 보호구역은 L5 부터였고, 그래서 L3 학습자의
    최대 약점이 보호구역이면 그 판을 만들 수 없었다.
  */
  it('L3 — 보호구역이 들어온다 (옛 표에서는 금지였다)', () => {
    const s = bare({ isSchoolZone: true, startPhase: 5 });
    expect(cost(s)).toBe(3);
    expect(checkBudget(s, ruleFor(3).budget)).toEqual([]);
  });

  /*
    프롬프트가 부탁만 하던 "한 판은 한 가지를 가르칩니다" 가 여기서 검사 가능해진다.
  */
  it('L10 — 조건을 전부 켜면 예산을 넘는다', () => {
    const everything = bare({
      startPhase: 5,
      crossTraffic: 5,
      isSchoolZone: true,
      exitBlocked: true,
      rightArrowInstalled: true,
      pedSignalInstalled: { A: false, C: false },
      timeOfDay: 'night',
      weather: 'rain',
      pedestrians: [
        ped({ startWithin: 10, chance: 0.5 }),
        ped({ startWithin: 12 }),
        ped({ startWithin: 14 }),
        ped({ startWithin: 16 }),
      ],
    });
    expect(cost(everything)).toBeGreaterThan(ruleFor(MAX_LEVEL).budget);
  });
});

describe('약점은 공짜다', () => {
  it('모든 위반 코드에 묶음이 정의되어 있다', () => {
    for (const code of Object.keys(VIOLATIONS) as ViolationCode[]) {
      expect(TARGET_KIT[code], code).toBeDefined();
    }
  });

  /*
    제27조 제7항은 **보호구역의 신호기 없는 횡단보도**에 걸린다.
    둘 중 하나만으로는 그 판단을 물을 수 없다.
  */
  it('어린이보호구역 습관은 두 조건을 함께 준다', () => {
    expect(freeKitFor('SCHOOL_ZONE_NO_STOP')).toEqual(['schoolZone', 'missingPedSignal']);
  });

  it('조건을 켜서 만들 수 없는 습관은 묶음이 비어 있다 — 어느 판에서나 시험된다', () => {
    expect(freeKitFor('NO_SLOW_DOWN')).toEqual([]);
    expect(freeKitFor('WIDE_TURN')).toEqual([]);
    expect(freeKitFor('NO_TURN_SIGNAL')).toEqual([]);
  });

  it('습관이 없으면 공짜도 없다', () => {
    expect(freeKitFor(null)).toEqual([]);
  });

  /*
    **이 한 줄이 이 설계의 전부다.** 예산 0인 L1 에서도 자기 약점을 만난다 —
    약점만 있고 나머지는 최대한 쉬운 판이 되는데, 가르치는 판으로는 그게 정답이다.
  */
  it('예산 0인 L1 에서도 약점 묶음은 통과한다', () => {
    const s = bare({ isSchoolZone: true, pedSignalInstalled: { A: true, C: false } });
    expect(cost(s), '정가 4점').toBe(4);
    expect(cost(s, [...freeKitFor('SCHOOL_ZONE_NO_STOP')]), '약점이면 0점').toBe(0);
    expect(checkBudget(s, 0, [...freeKitFor('SCHOOL_ZONE_NO_STOP')])).toEqual([]);
  });

  it('공짜라도 정가는 남겨 둔다 — 반려 사유에 쓴다', () => {
    const s = bare({ isSchoolZone: true });
    const item = costOf(s, ['schoolZone']).items.find((i) => i.key === 'schoolZone');
    expect(item?.free).toBe(true);
    expect(item?.cost).toBe(0);
    expect(item?.listPrice).toBe(2);
  });
});

describe('예산 안으로 깎기', () => {
  const heavy = bare({
    startPhase: 5,
    crossTraffic: 5,
    isSchoolZone: true,
    exitBlocked: true,
    rightArrowInstalled: true,
    pedSignalInstalled: { A: false, C: false },
    timeOfDay: 'night',
    weather: 'rain',
    pedestrians: [ped({ startWithin: 10, obeysSignal: false }), ped({ startWithin: 12 })],
  });

  it.each(LEVELS.map((l) => l.level))('L%i 예산 안에 들어온다', (level) => {
    const out = trimToBudget(heavy, ruleFor(level as Difficulty).budget);
    expect(checkBudget(out, ruleFor(level as Difficulty).budget)).toEqual([]);
  });

  it('약점 묶음은 예산 0에서도 살아남는다', () => {
    const free: ConditionKey[] = ['schoolZone', 'missingPedSignal'];
    const out = trimToBudget(heavy, 0, free);
    expect(hasCondition(out, 'schoolZone')).toBe(true);
    expect(hasCondition(out, 'missingPedSignal')).toBe(true);
    expect(hasCondition(out, 'exitBlocked'), '곁가지는 깎인다').toBe(false);
    expect(hasCondition(out, 'rightArrow')).toBe(false);
  });

  it('이미 예산 안이면 손대지 않는다', () => {
    const light = bare({ startPhase: 5 });
    expect(trimToBudget(light, 10)).toEqual(light);
  });

  /*
    **한 번 돌 때마다 값이 반드시 준다** — `relax` 의 계약이다. 안 줄면 트리머가
    제자리를 돌고, 상한(60)에 걸려 예산을 넘긴 판이 그대로 나간다.
  */
  it('깎을 때마다 값이 준다 — 제자리를 돌지 않는다', () => {
    let s = heavy;
    let prev = cost(s);
    for (let budget = prev - 1; budget >= 0; budget--) {
      s = trimToBudget(s, budget);
      const now = cost(s);
      expect(now, `예산 ${budget}`).toBeLessThanOrEqual(budget);
      expect(now, '값이 늘지는 않는다').toBeLessThanOrEqual(prev);
      prev = now;
    }
    expect(prev).toBe(0);
  });

  it('보행자를 한 명씩 던다 — 판을 통째로 무르지 않는다', () => {
    const many = bare({ pedestrians: [ped(), ped(), ped(), ped()] }); // 3점
    expect(trimToBudget(many, 2).pedestrians).toHaveLength(3);
    expect(trimToBudget(many, 1).pedestrians).toHaveLength(2);
    expect(trimToBudget(many, 0).pedestrians).toHaveLength(1);
  });

  it('거리는 2m 씩 물린다', () => {
    const late = bare({ pedestrians: [ped({ startWithin: 10 })] }); // 5점
    expect(trimToBudget(late, 4).pedestrians[0].startWithin).toBe(12);
    expect(trimToBudget(late, 0).pedestrians[0].startWithin).toBe(20);
  });
});
