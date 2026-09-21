/**
 * 배경 차량이 **보행자를 치지 않는지** 검증.
 *
 * 규정을 가르치는 화면에서 배경 차가 사람을 밀고 지나가면 그 화면이 하는 말이 무너진다.
 * 두 횡단보도 모두 건너는 차가 다르므로 각각 확인한다 —
 * A 는 내 뒤를 따라오는 뒷차가, C 는 동서 도로를 달리는 교차 통행 차량이 가로지른다.
 *
 * (08번 '조건 무작위' 에서 실제로 뒷차가 사람을 치고 지나갔다. 뒷차가 앞차인 나만 보고
 *  달렸기 때문인데, 내가 이미 지나간 뒤에 걸어 나온 사람은 아무도 보지 않는 셈이었다)
 */

import { describe, expect, it } from 'vitest';
import { TrafficCar } from '../src/game/TrafficCar';
import { CARS } from '../src/economy/cars';
import { CROSSWALK_INNER, CROSSWALK_OUTER, CROSSWALK_S_OUTER } from '../src/layout';

const SPEC = CARS[0];

/*
  **차 좌표가 아니라 앞범퍼를 본다.**

  차체는 원점을 가운데 두고 만들어져 있다(CarMesh 의 `frontZ = -L/2`). 그래서 차 좌표만
  보는 검사는 **앞범퍼가 전장의 절반만큼 더 나가 있는 것을 못 잡는다** — 실제로 그 틈으로
  배경 차가 늘 횡단보도를 0.7~0.9m 밟은 채 서 있었는데도 이 파일의 검사는 다 통과했다.
  판정에도 안 걸리는 어긋남이라(배경 차는 위반 판정 대상이 아니다) 화면을 봐야만 보였다.
*/
/** +X 로 달리는 차의 앞범퍼 x */
const frontX = (car: TrafficCar): number => car.obb.x + car.obb.halfL;
/** -Z 로 달리는 차의 앞범퍼 z */
const frontZ = (car: TrafficCar): number => car.obb.z - car.obb.halfL;

/** 보행자가 없을 때의 기본 상황 — 필요한 항목만 갈아 끼워 쓴다 */
const ctx = (over: Partial<Parameters<TrafficCar['update']>[1]> = {}) => ({
  crossHasGreen: true,
  jamCleared: true,
  pedOnExitCrosswalk: false,
  pedOnEntryCrosswalk: false,
  pedOnSchoolZoneCrosswalk: false,
  aheadGap: Infinity,
  aheadSpeed: 0,
  // 내 차는 한참 앞서 가 있다 — 뒷차가 나 때문에 서는 상황을 배제한다
  player: { x: 40, z: -40, speedKmh: 40 },
  headlightsOn: false,
  ...over,
});

/** 10초 동안(60fps) 굴리고 지나온 자리 중 가장 앞선 곳을 돌려준다 */
function run(car: TrafficCar, over: Parameters<typeof ctx>[0]): void {
  for (let i = 0; i < 600; i++) car.update(1 / 60, ctx(over));
}

describe('뒷차 — 횡단보도 A', () => {
  it('사람이 건너는 동안 횡단보도를 넘지 않는다', () => {
    const car = new TrafficCar('follower', 7, SPEC);
    run(car, { pedOnEntryCrosswalk: true });
    // 앞범퍼가 횡단보도 바깥 변(18.8)보다 남쪽(z 가 큼)에 남아 있어야 한다
    expect(frontZ(car)).toBeGreaterThan(CROSSWALK_OUTER);
  });

  it('사람이 없으면 그대로 통과한다', () => {
    const car = new TrafficCar('follower', 7, SPEC);
    run(car, {});
    expect(car.obb.z).toBeLessThan(CROSSWALK_OUTER);
  });
});

describe('교차 통행 차량 — 횡단보도 C', () => {
  /*
    **오래 굴려야 한다.** 예전에는 10초만 보고 통과시켰는데, 차는 정지선까지 기어가다가
    12.5초쯤 그것을 넘어 그대로 가속했다 — 사람이 건너는 중인데 배경 차가 횡단보도를
    통과했다. 짧게 보면 "섰다" 로 보인다.
  */
  it('사람이 건너는 동안 횡단보도를 넘지 않는다 (오래 기다려도)', () => {
    const car = new TrafficCar('crossTraffic', 0, SPEC);
    for (let i = 0; i < 1800; i++) car.update(1 / 60, ctx({ pedOnExitCrosswalk: true }));
    // 앞범퍼가 횡단보도 안쪽 변(14.8)보다 서쪽(x 가 작음)에 남아 있어야 한다
    expect(frontX(car)).toBeLessThan(CROSSWALK_INNER);
  });

  it('사람이 없으면 그대로 통과한다', () => {
    const car = new TrafficCar('crossTraffic', 0, SPEC);
    run(car, {});
    expect(car.obb.x).toBeGreaterThan(CROSSWALK_OUTER);
  });
});

/**
 * 보행자 앞에서 **어떻게** 서는가 — 서기만 하면 되는 것이 아니다.
 *
 * 실제 판(어린이보호구역 · 보행자 통행)에서 교차 통행 차량이 **보행자 코앞에서 급정거**하고
 * 사람이 지나가자마자 튀어 나갔다. 규정을 가르치는 화면에서 배경 차가 그러고 있으면
 * "다 건널 때까지 기다린다" 는 말이 화면과 어긋난다.
 */
describe('교차 통행 차량 — 어떻게 서는가', () => {
  /** `frames` 프레임 굴리며 매 프레임 상황을 다시 만든다 */
  const drive = (
    car: TrafficCar,
    frames: number,
    over: (i: number) => Parameters<typeof ctx>[0],
  ): void => {
    for (let i = 0; i < frames; i++) car.update(1 / 60, ctx(over(i)));
  };

  it('보행자가 나서기 전에 미리 줄여 여유 있게 선다', () => {
    const car = new TrafficCar('crossTraffic', 0, SPEC);
    drive(car, 600, () => ({ pedOnExitCrosswalk: true }));
    /*
      정지선(CROSSWALK_INNER − 1.6)에 **닿기 전에** 서 있어야 한다.
      코앞에서 급제동하면 정지선을 스치듯 넘어선 자리에 선다.
    */
    expect(frontX(car)).toBeLessThan(CROSSWALK_INNER - 1.0);
  });

  it('보행자가 차도를 벗어난 뒤 곧바로 튀어 나가지 않는다', () => {
    const car = new TrafficCar('crossTraffic', 0, SPEC);
    // 사람이 건너는 동안 충분히 굴려 **정지선 앞에 세워 둔다**
    drive(car, 900, () => ({ pedOnExitCrosswalk: true }));
    const stopped = frontX(car);

    // 사람이 벗어난 직후 0.3초 — 아직 움직이지 않아야 한다
    drive(car, 18, () => ({ pedOnExitCrosswalk: false }));
    expect(frontX(car) - stopped).toBeLessThan(0.5);

    // 그 뒤에는 정상적으로 지나간다
    drive(car, 600, () => ({ pedOnExitCrosswalk: false }));
    expect(frontX(car)).toBeGreaterThan(CROSSWALK_OUTER);
  });
});

/**
 * **횡단보도를 밟지 않고 선다** — 사진으로 잡힌 어긋남을 고정해 두는 자리.
 *
 * 위 검사들은 "넘지 않는다" 까지만 본다. 그런데 화면에서 문제로 보이는 것은 넘는 것이
 * 아니라 **밟는 것**이다 — 앞범퍼가 흰 줄 위에 얹혀 있으면, 정지선 앞에 서라고 가르치는
 * 화면에서 배경 차가 그것을 어기고 있는 그림이 된다.
 *
 * **카탈로그 전 차종으로 돈다.** 정지선이 전장에서 유도되므로(pedStopX·pedStopZ) 한
 * 차종만 보면 다른 전장에서 어긋나는 것을 놓친다 — 4.6m 와 5.0m 사이가 0.4m 차이다.
 */
describe('보행자 앞에 설 때 앞범퍼가 횡단보도를 밟지 않는다', () => {
  for (const spec of CARS) {
    it(`교차 통행 — ${spec.name} (전장 ${spec.dims.length}m)`, () => {
      const car = new TrafficCar('crossTraffic', 0, spec);
      for (let i = 0; i < 1800; i++) car.update(1 / 60, ctx({ pedOnExitCrosswalk: true }));
      // 흰 줄에 닿지도 않는다 — 여유 1.6m 에서 잔여 기어감 0.2m 를 뺀 만큼은 떨어져 있어야
      expect(frontX(car)).toBeLessThan(CROSSWALK_INNER - 1.4);
    });

    it(`뒷차 — ${spec.name} (전장 ${spec.dims.length}m)`, () => {
      const car = new TrafficCar('follower', 7, spec);
      for (let i = 0; i < 1800; i++) car.update(1 / 60, ctx({ pedOnEntryCrosswalk: true }));
      expect(frontZ(car)).toBeGreaterThan(CROSSWALK_OUTER + 1.4);
    });
  }
});

/**
 * **진입부 어린이보호구역 횡단보도(S)** — 뒷차가 지나는 또 하나의 자리.
 *
 * 뒷차는 내 뒤에서 같은 길을 따라오므로 교차로에 닿기 전에 이 횡단보도를 먼저 지난다.
 * A 만 보게 두면, 규정을 가르치는 화면에서 배경 차가 보호구역 횡단보도를 밀고 지나간다.
 */
describe('뒷차 — 진입부 보호구역 횡단보도', () => {
  /** 보호구역 판의 출발 자리에서 굴린다 */
  const run = (car: TrafficCar, over: Parameters<typeof ctx>[0]): void => {
    for (let i = 0; i < 1800; i++) car.update(1 / 60, ctx(over));
  };

  it('사람이 건너는 동안 횡단보도를 넘지 않는다', () => {
    const car = new TrafficCar('follower', 7, SPEC);
    run(car, { pedOnSchoolZoneCrosswalk: true });
    expect(frontZ(car)).toBeGreaterThan(CROSSWALK_S_OUTER);
  });

  it('앞범퍼가 흰 줄을 밟지도 않는다', () => {
    const car = new TrafficCar('follower', 7, SPEC);
    run(car, { pedOnSchoolZoneCrosswalk: true });
    expect(frontZ(car)).toBeGreaterThan(CROSSWALK_S_OUTER + 1.4);
  });

  it('사람이 없으면 그대로 지나간다', () => {
    const car = new TrafficCar('follower', 7, SPEC);
    run(car, {});
    expect(frontZ(car)).toBeLessThan(CROSSWALK_S_OUTER);
  });

  it.each(CARS.map((c) => [c.name, c] as const))(
    '%s — 전장이 달라도 밟지 않는다',
    (_name, spec) => {
      const car = new TrafficCar('follower', 7, spec);
      run(car, { pedOnSchoolZoneCrosswalk: true });
      expect(frontZ(car)).toBeGreaterThan(CROSSWALK_S_OUTER + 1.4);
    },
  );
});
