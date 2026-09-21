/**
 * 판정 엔진 검증.
 *
 * 사람들이 가장 많이 오해하는 세 가지 — 적색 시 무조건 일시정지 / 보행자 유무가 기준 /
 * 어린이보호구역 무조건 일시정지 — 를 집중 검증한다.
 *
 * 우회전 삼색등 관련 테스트도 남아 있다. 국내 설치가 드물어 게임 시나리오에서는 뺐지만
 * 현행 법령이라 판정 엔진에는 규정이 살아 있고, 그 동작을 여기서 지킨다.
 */

import { describe, expect, it } from 'vitest';
import { totalFine, totalPenaltyPoints, type ViolationCode } from '../src/rules/violations';
import { CROSSWALK_INNER } from '../src/layout';
import { alwaysWaiting, crossingBetween, simulate } from './simulate';

const codes = (r: { violations: { code: ViolationCode }[] }) => r.violations.map((v) => v.code);

describe('전방 녹색, 보행자 없음', () => {
  it('서행하며 지시등 켜고 돌면 PERFECT', () => {
    const r = simulate({ vehicleLight: 'green' }, { turnKmh: 14 });
    expect(codes(r)).toEqual([]);
    expect(r.grade).toBe('PERFECT');
  });

  it('녹색에서는 일시정지 의무가 없다', () => {
    const r = simulate({ vehicleLight: 'green' }, { stopAtLine: 0 });
    expect(codes(r)).not.toContain('RED_NO_STOP');
  });

  it('교차로를 30km/h로 돌면 서행의무 위반', () => {
    const r = simulate({ vehicleLight: 'green' }, { turnKmh: 30 });
    expect(codes(r)).toContain('NO_SLOW_DOWN');
    expect(r.grade).toBe('VIOLATION');
  });

  it('방향지시등을 켜지 않으면 신호 불이행', () => {
    const r = simulate({ vehicleLight: 'green' }, { turnSignal: 'never' });
    expect(codes(r)).toContain('NO_TURN_SIGNAL');
  });

  it('교차로 20m 앞에서 뒤늦게 켜도 30m 기준 미달로 위반', () => {
    const r = simulate({ vehicleLight: 'green' }, { turnSignal: 'late' });
    expect(codes(r)).toContain('NO_TURN_SIGNAL');
  });

  it('교차로 중앙까지 부풀려 돌면 교차로 통행방법 위반', () => {
    const r = simulate({ vehicleLight: 'green' }, { turnStyle: 'wide' });
    expect(codes(r)).toContain('WIDE_TURN');
  });
});

describe('전방 적색, 보행자 없음 (가장 많이 틀리는 경우)', () => {
  it('보행자가 없어도 멈추지 않으면 신호·지시 위반', () => {
    const r = simulate({ vehicleLight: 'red' }, { stopAtLine: 0 });
    expect(codes(r)).toContain('RED_NO_STOP');
    expect(r.grade).toBe('VIOLATION');
    expect(totalFine(r.violations)).toBeGreaterThanOrEqual(60_000);
    expect(totalPenaltyPoints(r.violations)).toBeGreaterThanOrEqual(15);
  });

  it('정지선 앞에서 1초 완전정지 후 우회전하면 위반 없음', () => {
    const r = simulate({ vehicleLight: 'red' }, { stopAtLine: 1.0 });
    expect(codes(r)).toEqual([]);
    expect(r.grade).toBe('PERFECT');
    expect(r.stats.cleanStopBeforeA).toBe(true);
  });

  it('0.3초만 스치듯 멈추는 것은 일시정지로 인정되지 않는다', () => {
    const r = simulate({ vehicleLight: 'red' }, { stopAtLine: 0.3 });
    expect(codes(r)).toContain('RED_NO_STOP');
  });

  it('정지선을 넘어 횡단보도 위에서 멈추면 정지선 위반이 함께 잡힌다', () => {
    const r = simulate({ vehicleLight: 'red' }, { stopAtLine: 0, stopPastLine: 1.0 });
    expect(codes(r)).toContain('OVER_STOP_LINE');
    // 정지 자체는 했으므로 신호위반은 아니다
    expect(codes(r)).not.toContain('RED_NO_STOP');
  });

  it('정지선을 조금 넘었어도 횡단보도를 밟지 않았으면 정지선 위반이 아니다', () => {
    // 정지선(16.5m)과 횡단보도(16.0m) 사이 = 허용 오차 구간
    const r = simulate({ vehicleLight: 'red' }, { stopAtLine: 0, stopPastLine: 1.0, pastLineDepth: 0.25 });
    expect(codes(r)).not.toContain('OVER_STOP_LINE');
    expect(r.stats.cleanStopBeforeA).toBe(true);
  });

  it('적색점멸도 동일하게 일시정지 의무가 있다', () => {
    const noStop = simulate({ vehicleLight: 'redFlash' }, { stopAtLine: 0 });
    const stopped = simulate({ vehicleLight: 'redFlash' }, { stopAtLine: 1.0 });
    expect(codes(noStop)).toContain('RED_NO_STOP');
    expect(codes(stopped)).toEqual([]);
  });
});

describe('보행자가 있는 횡단보도', () => {
  it('우회전 후 횡단보도에 보행자가 서 있는데 그냥 지나가면 횡단 방해', () => {
    const r = simulate(
      { vehicleLight: 'red', pedestrians: alwaysWaiting('C') },
      { stopAtLine: 1.0 },
    );
    expect(codes(r)).toContain('PEDESTRIAN_BLOCKED');
  });

  it('전방이 녹색이어도 우회전 후 보행자가 있으면 멈춰야 한다', () => {
    const r = simulate({ vehicleLight: 'green', pedestrians: alwaysWaiting('C') });
    expect(codes(r)).toContain('PEDESTRIAN_BLOCKED');
  });

  it('보행자가 다 건널 때까지 기다렸다 가면 위반 없음', () => {
    const r = simulate(
      { vehicleLight: 'green', pedestrians: crossingBetween('C', 0, 6) },
      { stopBeforeExitCrosswalk: 8 },
    );
    expect(codes(r)).toEqual([]);
  });

  // 안전 캠페인이라 경계에는 오차를 둔다. 다만 오차 밖은 그대로 잡아야 한다.

  /** 차 앞끝이 횡단보도에 닿고 `after` 초 뒤에 보행자가 내 차로를 벗어나는 상황 */
  const clearsAfterEntering = (after: number) => {
    let enteredAt: number | null = null;
    return (t: number, car: { frontX: number }) => {
      if (enteredAt === null && car.frontX >= CROSSWALK_INNER) enteredAt = t;
      const cleared = enteredAt !== null && t >= enteredAt + after;
      return [{ crosswalk: 'C' as const, intendsToCross: !cleared, onConflictPath: !cleared }];
    };
  };

  it('한 프레임 차이(0.1초)로 겹친 정도는 범칙금까지 물리지 않는다', () => {
    const r = simulate(
      { vehicleLight: 'green', pedestrians: clearsAfterEntering(0.1) },
      { stopBeforeExitCrosswalk: 2 },
    );
    expect(codes(r)).not.toContain('PEDESTRIAN_BLOCKED');
  });

  /*
    판정 오차범위는 **범칙금만** 면해 준다. 사람이 아직 횡단보도 위에 있는데 움직인 주행을
    '완벽' 이라고 부르면, 이 게임이 가르치겠다는 문장("통행 종료 시까지 정지")과
    화면에 찍히는 등급이 서로 다른 말을 하게 된다.
  */
  it('오차범위로 넘어가더라도 PERFECT 는 아니다', () => {
    const r = simulate(
      { vehicleLight: 'green', pedestrians: clearsAfterEntering(0.1) },
      { stopBeforeExitCrosswalk: 2 },
    );
    expect(r.grade).not.toBe('PERFECT');
  });

  it('반 발짝(0.25초)이라도 사람이 남아 있는데 지나가면 횡단 방해', () => {
    const r = simulate(
      { vehicleLight: 'green', pedestrians: clearsAfterEntering(0.25) },
      { stopBeforeExitCrosswalk: 2 },
    );
    expect(codes(r)).toContain('PEDESTRIAN_BLOCKED');
  });

  it('오차범위를 넘겨 보행자를 밀고 지나가면 그대로 횡단 방해', () => {
    const r = simulate(
      { vehicleLight: 'green', pedestrians: clearsAfterEntering(1.2) },
      { stopBeforeExitCrosswalk: 2 },
    );
    expect(codes(r)).toContain('PEDESTRIAN_BLOCKED');
  });

  it('오차범위 안에서 넘어간 경우, 무엇을 잘못했는지가 주행 기록에 남는다', () => {
    const r = simulate(
      { vehicleLight: 'green', pedestrians: clearsAfterEntering(0.1) },
      { stopBeforeExitCrosswalk: 2 },
    );
    const forgiven = r.log.find((e) => e.level === 'warn' && e.text.includes('통행이 끝나기 전에'));
    expect(forgiven).toBeDefined();
    expect(forgiven!.text).toContain('통행이 끝날 때까지 기다려야 합니다');
  });

  it('위반이 확정되면 무엇이 왜 걸렸는지가 주행 기록에 남는다', () => {
    const r = simulate(
      { vehicleLight: 'green', pedestrians: clearsAfterEntering(1.2) },
      { stopBeforeExitCrosswalk: 2 },
    );
    const bad = r.log.filter((e) => e.level === 'bad');
    expect(bad.some((e) => e.text.includes('횡단 방해'))).toBe(true);
    // 기록은 시간순이어야 되짚을 수 있다
    const times = r.log.map((e) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('정지선에서 한 번 섰더라도 보행자가 남아 있는데 출발하면 여전히 횡단 방해', () => {
    const r = simulate(
      { vehicleLight: 'red', pedestrians: alwaysWaiting('A') },
      { stopAtLine: 1.0 },
    );
    expect(codes(r)).toContain('PEDESTRIAN_BLOCKED');
  });
});

describe('보행 신호가 녹색이지만 보행자가 없는 경우', () => {
  it('보행신호 녹색 + 보행자 0명이면 그대로 통과해도 위반이 아니다', () => {
    const r = simulate({
      vehicleLight: 'green',
      pedSignalA: 'green',
      pedSignalC: 'green',
      pedestrians: () => [],
    });
    expect(codes(r)).toEqual([]);
    expect(r.grade).toBe('PERFECT');
  });

  it('보행신호 적색이어도 보행자가 건너고 있으면 위반이다', () => {
    const r = simulate({
      vehicleLight: 'green',
      pedSignalC: 'red',
      pedestrians: alwaysWaiting('C'),
    });
    expect(codes(r)).toContain('PEDESTRIAN_BLOCKED');
  });
});

// 우회전 삼색등은 국내 설치가 드물어 게임 시나리오에서는 제외했지만,
// 현행 법령이므로 판정 엔진과 이 테스트는 그대로 유지한다.
describe('우회전 삼색등 (시행규칙 별표2 비고 3) — 게임 시나리오에서는 미사용', () => {
  it('삼색등이 적색이면 전방 차량신호가 녹색이어도 우회전 불가', () => {
    const r = simulate({ vehicleLight: 'green', rightArrow: 'redArrow' });
    expect(codes(r)).toContain('RIGHT_ARROW_RED');
    expect(r.grade).toBe('VIOLATION');
  });

  it('삼색등 적색은 정지선에서 멈췄다 가도 위반이다 (진행 자체가 금지)', () => {
    const r = simulate(
      { vehicleLight: 'green', rightArrow: 'redArrow' },
      { stopAtLine: 1.5 },
    );
    expect(codes(r)).toContain('RIGHT_ARROW_RED');
  });

  it('적색이던 삼색등이 녹색화살표로 바뀐 뒤 출발하면 위반 없음', () => {
    const r = simulate(
      {
        vehicleLight: 'red',
        rightArrow: (t) => (t < 4 ? 'redArrow' : 'greenArrow'),
      },
      { stopAtLine: 6 },
    );
    expect(codes(r)).toEqual([]);
  });

  it('삼색등이 녹색화살표여도 보행자 보호 의무는 그대로다', () => {
    const r = simulate({
      vehicleLight: 'red',
      rightArrow: 'greenArrow',
      pedestrians: alwaysWaiting('C'),
    });
    expect(codes(r)).toContain('PEDESTRIAN_BLOCKED');
  });

  it('삼색등이 있으면 전방 적색이어도 별도의 일시정지 의무는 지지 않는다', () => {
    const r = simulate(
      { vehicleLight: 'red', rightArrow: 'greenArrow' },
      { stopAtLine: 0 },
    );
    expect(codes(r)).not.toContain('RED_NO_STOP');
  });
});

describe('어린이보호구역 (제27조 제7항)', () => {
  it('신호기 없는 횡단보도 앞에서 보행자가 없어도 멈추지 않으면 위반', () => {
    const r = simulate(
      { vehicleLight: 'green', isSchoolZone: true, pedSignalC: null },
      { stopBeforeExitCrosswalk: 0 },
    );
    expect(codes(r)).toContain('SCHOOL_ZONE_NO_STOP');
  });

  it('멈췄다 가면 위반 없음', () => {
    const r = simulate(
      { vehicleLight: 'green', isSchoolZone: true, pedSignalC: null },
      { stopAtLine: 1.0, stopBeforeExitCrosswalk: 1.0 },
    );
    expect(codes(r)).toEqual([]);
  });

  it('어린이보호구역에서는 신호위반 범칙금이 12만원으로 가중된다', () => {
    const r = simulate(
      { vehicleLight: 'red', isSchoolZone: true, pedSignalA: 'red', pedSignalC: 'red' },
      { stopAtLine: 0 },
    );
    expect(codes(r)).toContain('RED_NO_STOP');
    const redNoStop = r.violations.find((v) => v.code === 'RED_NO_STOP')!;
    expect(redNoStop.inSchoolZone).toBe(true);
    expect(totalFine([redNoStop])).toBe(120_000);
    expect(totalPenaltyPoints([redNoStop])).toBe(30);
  });

  it('밤에는 어린이보호구역이어도 가중되지 않는다 (08~20시 한정)', () => {
    // 시행령 제93조 제2항 · 시행규칙 [별표 28] (주)4 — 가중은 오전 8시~오후 8시로 한정된다
    const r = simulate(
      {
        vehicleLight: 'red',
        isSchoolZone: true,
        isDaytime: false,
        pedSignalA: 'red',
        pedSignalC: 'red',
      },
      { stopAtLine: 0 },
    );
    const redNoStop = r.violations.find((v) => v.code === 'RED_NO_STOP')!;
    expect(redNoStop.inSchoolZone).toBe(true);
    expect(redNoStop.daytime).toBe(false);
    expect(totalFine([redNoStop])).toBe(60_000);
    expect(totalPenaltyPoints([redNoStop])).toBe(15);
  });

  it('제27조 제7항 위반은 가중 대상이 아니다 — 6만원 · 10점', () => {
    /*
      정의상 어린이보호구역에서만 생기는 위반이라 법령이 여기에 2배를 얹지 않는다.
       · 시행령 [별표 8] 제11호 — "어린이 보호구역에서의 일시정지 위반을 포함" · 승용 6만원
       · 시행령 [별표 10] 제2호 — 근거 조문이 제27조 제1항·제2항뿐
       · 시행규칙 [별표 28] (주)4-나 — 2배 대상에서 "법 제27조제7항은 제외한다"
    */
    const r = simulate(
      { vehicleLight: 'green', isSchoolZone: true, pedSignalA: null, pedSignalC: null },
      { stopAtLine: 0, stopBeforeExitCrosswalk: 0 },
    );
    const noStop = r.violations.find((v) => v.code === 'SCHOOL_ZONE_NO_STOP')!;
    expect(noStop).toBeDefined();
    expect(noStop.inSchoolZone).toBe(true);
    expect(totalFine([noStop])).toBe(60_000);
    expect(totalPenaltyPoints([noStop])).toBe(10);
  });

  it('보행신호기가 있는 횡단보도에는 제27조 제7항이 적용되지 않는다', () => {
    const r = simulate({
      vehicleLight: 'green',
      isSchoolZone: true,
      pedSignalA: 'red',
      pedSignalC: 'red',
    });
    expect(codes(r)).not.toContain('SCHOOL_ZONE_NO_STOP');
  });
});

describe('꼬리물기 (제25조 제5항)', () => {
  it('교차로 안에 갇힐 상황인데 진입하면 위반', () => {
    const r = simulate({ vehicleLight: 'green', exitBlocked: true });
    expect(codes(r)).toContain('BLOCKING_INTERSECTION');
  });
});

describe('실패 처리', () => {
  it('우회전을 완주하지 못하면 FAIL', () => {
    // 정지선에서 시뮬레이션 시간 내내 멈춰 있게 한다
    const r = simulate({ vehicleLight: 'red' }, { stopAtLine: 200 });
    expect(r.completed).toBe(false);
    expect(r.grade).toBe('FAIL');
  });
});

describe('범칙금 합산', () => {
  it('여러 위반이 겹치면 각각 합산된다', () => {
    const r = simulate(
      { vehicleLight: 'red', pedestrians: alwaysWaiting('C') },
      { stopAtLine: 0, turnKmh: 30, turnSignal: 'never' },
    );
    const set = new Set(codes(r));
    expect(set).toContain('RED_NO_STOP'); // 60,000
    expect(set).toContain('PEDESTRIAN_BLOCKED'); // 60,000
    expect(set).toContain('NO_SLOW_DOWN'); // 30,000
    expect(set).toContain('NO_TURN_SIGNAL'); // 30,000
    expect(totalFine(r.violations)).toBe(180_000);
  });

  it('같은 위반은 프레임마다 중복 기록되지 않는다', () => {
    const r = simulate({ vehicleLight: 'green', pedestrians: alwaysWaiting('C') });
    const blocked = r.violations.filter((v) => v.code === 'PEDESTRIAN_BLOCKED');
    expect(blocked).toHaveLength(1);
  });
});
