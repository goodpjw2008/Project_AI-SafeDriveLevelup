import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { acesToneMapped, skyColorAt } from '../src/game/World';

/*
  바탕색은 하늘과 같은 톤매핑을 거쳐야 하늘과 이어진다 (World 생성자의 바탕색 주석).
  ACES 옮김이 three 의 셰이더와 같은 성질을 갖는지 못 박는다 — 실제 픽셀 비교는 헤드리스로 했다.
*/
describe('바탕색 — 하늘과 같은 톤매핑', () => {
  it('ACES 는 검정을 검정으로, 아주 밝은 것을 흰색으로 보내고, 사이에서는 단조롭다', () => {
    const black = acesToneMapped(new THREE.Color(0, 0, 0), 1.05);
    expect(black.r).toBe(0);
    const white = acesToneMapped(new THREE.Color(50, 50, 50), 1.05);
    expect(white.r).toBeCloseTo(1, 3);
    let prev = 0;
    for (let v = 0.05; v <= 2; v += 0.05) {
      const c = acesToneMapped(new THREE.Color(v, v, v), 1.05);
      expect(c.r).toBeGreaterThan(prev);
      prev = c.r;
    }
  });

  it('회색은 회색으로 남는다 — 색조를 만들지 않는다', () => {
    const c = acesToneMapped(new THREE.Color(0.5, 0.5, 0.5), 1.05);
    expect(Math.abs(c.r - c.g)).toBeLessThan(0.002);
    expect(Math.abs(c.g - c.b)).toBeLessThan(0.002);
  });

  it('하늘 색은 위 극에서 skyTop, 지평선 아래에서 skyBottom, 그 사이에서 섞인다', () => {
    const top = 0x6ba2e0;
    const bottom = 0xd3e4f5;
    const srgb = (c: THREE.Color) => c.getHex(THREE.SRGBColorSpace);
    expect(srgb(skyColorAt(top, bottom, 90))).toBe(top);
    expect(srgb(skyColorAt(top, bottom, -40))).toBe(bottom);
    const mid = skyColorAt(top, bottom, 10).getRGB(new THREE.Color(), THREE.SRGBColorSpace);
    // 10° 는 0.62 지점 기준 72% 쯤 skyBottom 쪽
    expect(mid.r * 255).toBeCloseTo(0x6b + (0xd3 - 0x6b) * 0.7168, 0);
  });
});
