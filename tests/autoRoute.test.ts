/**
 * **AI 가 갈 길이 내 차에서 시작한다** (game/AutoDriver.ts 의 routeAhead) — LiDAR 화면의 파란 길 띠가 읽는 값이다.
 *
 * 사용자가 짚었다: *"경로 추적이 차를 따라가지 않고, 긴 도로에서 처음부터 나타나지 않음"*. 우회전 코스의 길이 평소 스폰
 * (z = 68) 뒤에서만 시작해, 보호구역을 지나오는 긴 진입로 판(스폰 z = 174)에서는 길이 차 앞 86m 에서야 시작했다 —
 * 화면의 띠가 멀리 박혀 있다가 차가 닿아서야 이어졌다. 어느 스폰에서 출발하든, 차가 달리는 내내 길의 첫 점이 차
 * 자리에 붙어 있어야 한다.
 */

import { describe, expect, it } from 'vitest';

import { AutoDriver, type AutoDriveState } from '../src/game/AutoDriver';
import { PLAYER_APPROACH_X, SPAWN_Z, SPAWN_Z_SCHOOL_ZONE, SPAWN_Z_STRAIGHT } from '../src/layout';

/** 차로 한가운데를 북쪽(-z)으로 가는 차 — 신호 · 사람 · 앞차 없음 */
function state(z: number): AutoDriveState {
  return {
    x: PLAYER_APPROACH_X,
    z,
    yaw: 0,
    frontX: PLAYER_APPROACH_X,
    frontZ: z - 2.4,
    speedKmh: 30,
    stopHold: 0,
    vehicleLight: 'green',
    rightArrow: null,
    pedSignal: { A: null, B: null, C: null, S: null },
    pedestrians: [],
    exitBlocked: false,
    isSchoolZone: false,
    approachZone: null,
    lead: null,
  };
}

describe('AI 가 갈 길 — 내 차에서 시작한다', () => {
  for (const [name, drive, spawn] of [
    ['우회전 · 평소 스폰', 'rightTurn', SPAWN_Z],
    ['우회전 · 보호구역을 지나오는 긴 진입로', 'rightTurn', SPAWN_Z_SCHOOL_ZONE],
    ['직진 · 보호구역 전용 도로', 'zoneOnly', SPAWN_Z_STRAIGHT],
  ] as const) {
    it(`${name} (z = ${spawn}) — 첫 프레임부터 차를 따라온다`, () => {
      const driver = new AutoDriver(2.8, 4.8, drive);
      // 스폰에서 1m 씩 앞으로 — 매 프레임 길의 첫 점이 차 자리에 붙어 있고, 앞으로 40m 넘게 이어진다
      for (let z = spawn; z > 40; z -= 1) {
        driver.decide(state(z));
        const route = driver.routeAhead(45);
        expect(Math.hypot(route[0].x - PLAYER_APPROACH_X, route[0].z - z)).toBeLessThan(1);
        expect(route.length).toBeGreaterThan(40);
      }
    });
  }
});
