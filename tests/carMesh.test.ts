/**
 * 방향지시등의 **빛 번짐 텍스처**를 검증한다.
 *
 * 이 텍스처는 원래 캔버스에 방사형 그라디언트를 그려 만들었다. 그 한 줄 때문에 차체를
 * 만드는 일 전체가 DOM 을 요구했고, 브라우저 없이 도는 tests/trafficCar.test.ts 가
 * **주행 로직을 검증하려는데 그림 때문에** 돌지 못했다. 그래서 픽셀을 직접 계산하도록
 * 바꿨다 (game/CarMesh.ts 의 makeGlowTexture).
 *
 * 그림을 만드는 방법을 바꿨으므로, **결과가 같은지**는 눈이 아니라 여기서 확인한다 —
 * 화면을 띄워 보지 않으면 드러나지 않는 종류의 퇴행이다.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildCar } from '../src/game/CarMesh';
import { CARS } from '../src/economy/cars';

/** 차체에서 방향지시등 스프라이트를 찾아 그 텍스처를 꺼낸다 */
function glowTexture(): THREE.DataTexture {
  const model = buildCar(CARS[0]);
  let found: THREE.DataTexture | null = null;
  model.group.traverse((o) => {
    if (found || !(o instanceof THREE.Sprite)) return;
    const map = (o.material as THREE.SpriteMaterial).map;
    if (map instanceof THREE.DataTexture) found = map;
  });
  if (!found) throw new Error('방향지시등 스프라이트를 찾지 못했다');
  return found;
}

/** (x, y) 픽셀의 알파 */
const alphaAt = (tex: THREE.DataTexture, x: number, y: number): number => {
  const size = tex.image.width as number;
  return (tex.image.data as Uint8Array)[(y * size + x) * 4 + 3];
};

describe('빛 번짐 텍스처', () => {
  const tex = glowTexture();
  const size = tex.image.width as number;

  it('DOM 없이 만들어진다', () => {
    // 이 파일이 여기까지 왔다는 것 자체가 증거다 — vitest 에는 document 가 없다
    expect(typeof document).toBe('undefined');
    expect(size).toBe(64);
  });

  it('색은 흰색뿐이다 — 주황은 재질이 입힌다', () => {
    const data = tex.image.data as Uint8Array;
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
      expect(data[i + 1]).toBe(255);
      expect(data[i + 2]).toBe(255);
    }
  });

  /*
    좌표를 다룰 때 주의: 알파는 **픽셀 중심**(+0.5)에서 잰다. 그래서 `(mid, 0)` 처럼
    "원의 가장자리" 로 보이는 자리도 실제 거리는 반지름보다 아주 조금 짧고, 알파가
    딱 0 이 아니라 1~2 로 나온다. 그것을 0 으로 못 박으면 구현이 맞는데 테스트가 깨진다.
  */
  it('가운데가 가장 밝고 가장자리에서 사라진다', () => {
    const mid = size / 2;
    expect(alphaAt(tex, mid, mid)).toBeGreaterThan(250);
    expect(alphaAt(tex, 0, 0)).toBe(0); // 모서리는 반지름 밖 — 여기는 정확히 0
    expect(alphaAt(tex, mid, 0)).toBeLessThan(5); // 원의 가장자리
  });

  it('중심에서 멀어질수록 단조 감소한다', () => {
    const mid = size / 2;
    let prev = Infinity;
    for (let x = mid; x < size; x++) {
      const a = alphaAt(tex, x, mid);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });

  /**
   * 예전 캔버스 그라디언트의 정지점을 지나는지 — 이 텍스처의 **생김새**를 정하는 값이다.
   *
   * 픽셀 중심에서 재느라 정지점에 정확히 떨어지는 픽셀이 없으므로, 값이 아니라
   * **띠**로 확인한다. 좁게 잡으면(±2) 반 픽셀 때문에 깨지고, 넓게 잡으면 곡선이
   * 통째로 달라져도 통과한다. ±10 이면 곡선 모양이 바뀌는 것은 잡힌다.
   */
  it('감쇠 곡선이 예전 그라디언트의 정지점을 지난다', () => {
    const mid = size / 2;
    const near = (x: number, expected: number) => {
      const a = alphaAt(tex, x, mid);
      expect(a).toBeGreaterThan(expected - 10);
      expect(a).toBeLessThan(expected + 10);
    };
    near(mid + 7, 0.85 * 255); // 반지름의 약 25% — 정지점 0.25
    near(mid + 17, 0.28 * 255); // 반지름의 약 55% — 정지점 0.55
  });

  it('확대해도 계단이 보이지 않게 선형 필터를 쓴다', () => {
    // DataTexture 의 기본은 NearestFilter 다 — 그대로 두면 조용히 그림이 나빠진다
    expect(tex.magFilter).toBe(THREE.LinearFilter);
  });
});
