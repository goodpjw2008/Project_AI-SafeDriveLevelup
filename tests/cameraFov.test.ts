/**
 * **세로로 긴 화면에서도 좌우가 보인다** (game/CameraRig.ts 의 fitHorizontal).
 *
 * three.js 의 화각은 세로라, 휴대폰 세로 화면에서는 후방 시점의 가로가 33° 로 줄어 내 차 양옆의 횡단보도 · 보행자가
 * 화면 밖으로 밀렸다 (사용자가 짚었다). 세로로 긴 화면에서만 세로 화각을 넓혀 가로를 되찾는다 — PC 화면은 그대로다.
 */
import { describe, expect, it } from 'vitest';
import { PORTRAIT_MAX_FOV, fitHorizontal, horizontalFov } from '../src/game/CameraRig';

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
    늘어나 보였다. 지금은 횡단보도 양 끝을 **좌·우 시야 창이 맡으므로**(Game 의 setOverlaysVisible)
    본 화면까지 억지로 넓힐 까닭이 없다.
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
