/**
 * **세로로 긴 화면에서도 좌우가 보인다** (game/CameraRig.ts 의 fitHorizontal).
 *
 * three.js 의 화각은 세로라, 휴대폰 세로 화면에서는 후방 시점의 가로가 33° 로 줄어 내 차 양옆의 횡단보도 · 보행자가
 * 화면 밖으로 밀렸다 (사용자가 짚었다). 세로로 긴 화면에서만 세로 화각을 넓혀 가로를 되찾는다 — PC 화면은 그대로다.
 */
import { describe, expect, it } from 'vitest';
import {
  PORTRAIT_MAX_FOV,
  crosswalkRise,
  fitHorizontal,
  horizontalFov,
} from '../src/game/CameraRig';
import { STOP_LINE, STOP_LINE_S } from '../src/layout';

const PC = 16 / 9;
const PHONE = 390 / 844;

describe('세로로 긴 화면의 화각', () => {
  it('가로로 긴 PC 화면은 그대로다', () => {
    expect(fitHorizontal(66, PC, 72)).toBe(66);
    expect(fitHorizontal(55, PC, 60)).toBe(55);
  });

  it('휴대폰 세로에서 후방 시점의 가로가 크게 넓어진다 (33° → 55° 이상)', () => {
    expect(horizontalFov(66, PHONE)).toBeLessThan(35);
    expect(horizontalFov(fitHorizontal(66, PHONE, 72), PHONE)).toBeGreaterThan(55);
  });

  it('세로 화각은 상한을 넘지 않는다 — 화면 위아래가 어안렌즈처럼 늘어나지 않게', () => {
    for (const aspect of [0.3, PHONE, 0.6, 0.75]) {
      expect(fitHorizontal(66, aspect, 72)).toBeLessThanOrEqual(PORTRAIT_MAX_FOV);
    }
  });

  it('원래 화각보다 좁아지는 일은 없다', () => {
    for (const aspect of [0.3, PHONE, 1, PC, 2.4]) {
      expect(fitHorizontal(66, aspect, 72)).toBeGreaterThanOrEqual(66);
    }
  });

  /*
    **세로 화면의 후방 시점은 덜 넓게 본다** (사용자가 사진으로 짚었다: "너무 광각으로 물체가
    왜곡되어 보인다"). 72° 를 세로 화면에 맞추면 세로 화각이 상한(108°)까지 벌어져 가장자리가
    늘어날 뿐 아니라, 정작 봐야 할 신호등과 멀리 있는 보행자가 작아진다. 횡단보도 양 끝은
    화각이 아니라 **카메라를 올려서** 담는다 (아래 '횡단보도 앞에서 올라가는 카메라').
  */
  it('세로 화면의 후방 시점 하한을 낮추면 세로 화각이 눈에 띄게 좁아진다', () => {
    const wide = fitHorizontal(66, PHONE, 72);
    const calm = fitHorizontal(66, PHONE, 56);
    // 상한(108°)에 닿아 있던 것이 10° 가까이 내려온다 — 가장자리 늘어남은 이 차이에서 온다
    expect(wide).toBeGreaterThan(105);
    expect(calm).toBeLessThan(wide - 8);
    // 그래도 앞을 보기에는 넉넉하다 — 가로로 50° 넘게 담는다
    expect(horizontalFov(calm, PHONE)).toBeGreaterThan(50);
  });

  /* PC 는 그대로다 — 하한을 낮춰도 이미 넉넉해서 원래 화각을 그대로 돌려준다 */
  it('PC 는 하한을 낮춰도 달라지지 않는다', () => {
    expect(fitHorizontal(66, PC, 56)).toBe(66);
    expect(fitHorizontal(66, PC, 72)).toBe(66);
  });
});

/*
  **횡단보도 앞에서만 카메라가 올라간다** (game/CameraRig.ts 의 crosswalkRise).

  세로 휴대폰에서 좌·우 확장 시야 창을 걷어낸 뒤 "횡단보도 저쪽 끝이 안 보인다" 가 남았다.
  화각을 넓히면 108° 까지 밀려 올라가 멀리 있는 신호등과 사람이 작아지므로, 대신 **다가올 때만**
  카메라를 올리고 조금 뒤로 물린다. 달리는 동안에는 낮고 좁은 그대로여야 한다 — 그래야 멀리가 크게 보인다.
*/
describe('횡단보도 앞에서 올라가는 카메라', () => {
  it('달리는 동안에는 올라가지 않는다', () => {
    // 교차로에서 한참 먼 곳 — 여기서 올라가 있으면 멀리 있는 신호등이 작아진다
    expect(crosswalkRise(0, 90)).toBe(0);
    expect(crosswalkRise(0, STOP_LINE + 22)).toBe(0);
  });

  it('정지선에 다가갈수록 서서히 올라가 교차로 안에서는 끝까지 올라가 있다', () => {
    const mid = crosswalkRise(0, STOP_LINE + 15);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(crosswalkRise(0, STOP_LINE + 8)).toBe(1);
    // 우회전 뒤 횡단보도까지 한 값으로 묶인다 — 교차로를 나갈 때는 x 가 커진다
    expect(crosswalkRise(0, 0)).toBe(1);
    expect(crosswalkRise(STOP_LINE + 8, 0)).toBe(1);
  });

  it('가까워질수록 값이 커지기만 한다 — 다가가다 도로 내려가면 화면이 출렁인다', () => {
    let prev = -1;
    for (let z = STOP_LINE + 30; z >= 0; z -= 1) {
      const v = crosswalkRise(0, z);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  /*
    **진입로 보호구역(S) 횡단보도 앞에서도 올라간다.** S 는 z=72 근처라 교차로(0,0)에서 한참 멀어,
    교차로까지의 거리만 보면 거기서는 내내 낮은 채였다 — 좌·우 시야 창이 그랬던 것과 같은 자리다.
  */
  it('진입로 보호구역 판에서는 그 정지선 앞에서도 올라간다', () => {
    expect(crosswalkRise(0, STOP_LINE_S, false)).toBe(0);
    expect(crosswalkRise(0, STOP_LINE_S, true)).toBe(1);
    expect(crosswalkRise(0, STOP_LINE_S + 30, true)).toBe(0);
  });
});
