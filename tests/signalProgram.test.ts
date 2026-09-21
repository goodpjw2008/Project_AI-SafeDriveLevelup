/**
 * 신호 프로그램의 **짝 맞춤** 검증.
 *
 * 우회전신호등을 다는 이유는 하나다 — 우회전 차량과 **우회전해서 나가는 횡단보도(C)의
 * 보행자**를 신호로 갈라 놓는 것. 그래서 두 등화는 서로 반대로 켜져야 한다.
 *
 *   우회전 녹색 화살표  →  횡단보도 C 보행신호는 적색
 *   횡단보도 C 보행 녹색 →  우회전신호등은 적색
 *
 * 이 짝이 어긋나면 게임이 **규정을 지키면 사고가 나는 신호**를 가르치게 된다.
 */

import { describe, expect, it } from 'vitest';
import {
  GENERATED_ID_BASE,
  SCENARIOS,
  SCHOOL_ZONE_CHANCE,
  STANDARD_PROGRAM,
  phaseAt,
  prepareScenario,
  rollApproachZone,
  rollPedestrians,
  rollSchoolZoneTurn,
  type PedSpawn,
  type ScenarioSpec,
} from '../src/scenarios/scenarios';

describe('신호 프로그램 — 우회전신호등과 보행신호', () => {
  it('녹색 화살표 구간에는 **두 횡단보도가 모두** 적색이다', () => {
    /*
      우회전 차량은 진입 전 횡단보도(A)를 가로지른 뒤 진출 횡단보도(C)를 또 가로지른다.
      한쪽만 비어 있으면 규정대로 우회전한 사람이 다른 쪽에서 사람을 친다 —
      실제로 처음에는 A 가 보행 녹색인 구간(동서 직진)에 화살표를 켜 두었다.
    */
    for (const phase of STANDARD_PROGRAM) {
      if (phase.rightArrow === 'greenArrow') {
        expect(phase.pedA, `${phase.name} · 보행 A`).toBe('red');
        expect(phase.pedC, `${phase.name} · 보행 C`).toBe('red');
      }
    }
  });

  it('어느 쪽이든 보행자가 건널 수 있으면 우회전신호등은 적색이다', () => {
    const walkable = (s: string) => s === 'green' || s === 'greenFlash';
    for (const phase of STANDARD_PROGRAM) {
      if (walkable(phase.pedA) || walkable(phase.pedC)) {
        expect(phase.rightArrow, `${phase.name}`).not.toBe('greenArrow');
      }
    }
  });

  /*
    둘 다 적색인 구간(전방향 적색 2초)은 **정상이다.** 보행신호가 꺼지자마자 우회전을
    내보내면 아직 횡단보도 위에 있는 사람과 부딪힌다 — 실제 신호도 이 정리 구간을 둔다.
  */
  it('전방향 적색 구간에서는 둘 다 적색이다 (정리 구간)', () => {
    const clearance = STANDARD_PROGRAM.filter((p) => p.name === '전방향 적색');
    expect(clearance.length).toBeGreaterThan(0);
    for (const phase of clearance) {
      expect(phase.pedC).toBe('red');
      expect(phase.rightArrow).toBe('redArrow');
    }
  });
});

describe('우회전신호등 시나리오 배치', () => {
  const at = (id: number, t: number) => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    return phaseAt(STANDARD_PROGRAM, sc.startPhase, sc.startPhaseElapsed, t);
  };
  /** 정지선에 닿는 시각 — 순항·서행·정지를 거쳐 약 10초 (Vehicle 속도 프로파일 기준) */
  const AT_STOP_LINE = 10;

  it('05번: 정지선~우회전 완료까지 녹색 화살표이고 두 횡단보도가 적색이다', () => {
    for (const t of [0, AT_STOP_LINE, 13]) {
      const p = at(5, t);
      expect(p.rightArrow, `t=${t}`).toBe('greenArrow');
      expect(p.pedA, `t=${t}`).toBe('red');
      expect(p.pedC, `t=${t}`).toBe('red');
      // 05·06 은 전방 신호가 **똑같이 녹색**이고 우회전신호등만 다르다 — 이것이 대비의 핵심
      expect(p.vehicle, `t=${t}`).toBe('green');
    }
  });

  it('06번: 정지선에 닿을 때 전방은 녹색인데 우회전은 적색이다', () => {
    const p = at(6, AT_STOP_LINE);
    expect(p.vehicle).toBe('green');
    expect(p.rightArrow).toBe('redArrow');
    // 왜 적색인지가 눈에 보여야 한다 — 그 시각 횡단보도 C 는 보행 녹색
    expect(p.pedC).toBe('green');
  });

  it('06번: 보행이 끝나면 녹색 화살표로 바뀐다 (판이 끝날 수 있다)', () => {
    const p = at(6, 15);
    expect(p.rightArrow).toBe('greenArrow');
    expect(p.pedA).toBe('red');
    expect(p.pedC).toBe('red');
  });
});

/**
 * 보행자 등장 확률 (`PedSpawn.chance`).
 *
 * 07번(어린이보호구역·신호기 없는 횡단보도)이 가르치려는 것은 **보행자의 통행 여부와
 * 관계없이 선다**이다. 매번 아이가 나오면 "사람이 보이면 선다"를 익히게 되어 정반대가 된다.
 */
describe('보행자 등장 확률', () => {
  const spawn = (chance?: number): PedSpawn => ({
    crosswalk: 'C',
    at: 0,
    from: 'left',
    ...(chance === undefined ? {} : { chance }),
  });

  it('chance 가 없으면 항상 나온다', () => {
    for (let i = 0; i < 20; i++) expect(rollPedestrians([spawn()])).toHaveLength(1);
  });

  it('chance 가 1 이면 항상, 0 이면 절대 나오지 않는다', () => {
    for (let i = 0; i < 20; i++) {
      expect(rollPedestrians([spawn(1)])).toHaveLength(1);
      expect(rollPedestrians([spawn(0)])).toHaveLength(0);
    }
  });

  it('07번의 아이는 나올 때도 있고 안 나올 때도 있다', () => {
    const sc = SCENARIOS.find((s) => s.id === 7)!;
    expect(sc.pedestrians).toHaveLength(1);
    expect(sc.pedestrians[0].chance).toBeGreaterThan(0);
    expect(sc.pedestrians[0].chance).toBeLessThan(1);

    const counts = new Set<number>();
    for (let i = 0; i < 200; i++) counts.add(prepareScenario(sc).pedestrians.length);
    expect(counts).toEqual(new Set([0, 1]));
  });
});

/**
 * **어린이보호구역은 네 판에 한 판이다.**
 *
 * 늘 나오면 학습자가 익히는 것은 규정이 아니라 이 게임의 버릇("여기서는 늘 한 번 더
 * 선다")이다. 늘 없으면 배울 일이 없다.
 */
describe('보호구역 차례', () => {
  it('네 판에 한 판 꼴이다', () => {
    expect(SCHOOL_ZONE_CHANCE).toBeCloseTo(0.25, 5);

    let turns = 0;
    for (let i = 0; i < 4000; i++) if (rollSchoolZoneTurn()) turns++;
    // 4000판이면 25% 에서 크게 벗어나지 않는다 (표본오차 ±2%p 남짓)
    expect(turns / 4000).toBeGreaterThan(0.21);
    expect(turns / 4000).toBeLessThan(0.29);
  });

  /** 진입부 보호구역이 적혀 있지 않은, 손으로 쓴 판 */
  const plain = (over: Partial<ScenarioSpec> = {}): ScenarioSpec =>
    ({ ...SCENARIOS.find((s) => s.id === 1)!, approachSchoolZone: undefined, ...over });

  it('아무 말도 없는 손글씨 판에는 얹기도 하고 안 얹기도 한다', () => {
    const seen = new Set<boolean>();
    for (let i = 0; i < 200; i++) seen.add(rollApproachZone(plain()).approachSchoolZone !== undefined);
    expect(seen).toEqual(new Set([true, false]));
  });

  /*
    **AI 가 만든 판에는 얹지 않는다.** 그쪽은 판을 만들기 전에 이미 차례를 정했다
    (generate.ts 의 `Plan.schoolZone`). 여기서 또 굴리면 "이번 판에는 없다" 고 정해 둔
    판에 다시 얹는 셈이라, 네 판에 한 판이라는 약속이 그만큼 깨진다.
  */
  it('AI 가 만든 판에는 얹지 않는다 — 차례는 만들기 전에 이미 정했다', () => {
    for (let i = 0; i < 200; i++) {
      const out = rollApproachZone(plain({ id: GENERATED_ID_BASE + 3 }));
      expect(out.approachSchoolZone).toBeUndefined();
    }
  });

  it('판이 이미 적어 두었으면 그대로 둔다', () => {
    const declared = plain({ approachSchoolZone: { signal: true } });
    for (let i = 0; i < 50; i++) {
      expect(rollApproachZone(declared).approachSchoolZone).toEqual({ signal: true });
    }
  });
});
