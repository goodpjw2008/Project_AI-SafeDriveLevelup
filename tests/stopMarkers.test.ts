/**
 * **정지 구역 띠** (game/StopMarkers.ts) — 멈출 자리를 노면에 물들인다. 호박색 점멸 = 여기서 서라, 초록 = 섰다.
 *
 * 사용자가 짚었다 — "처음에 어린이구역 신호없는 횡단보도가 나오고 그다음에 사거리가 나오는 맵에서 신호없는 횡단보도에
 * 일시정지 부분이 녹색으로 표시가 되지 않아. 사거리에서처럼 일시정지 부분에 표시가 되게 해 줘." 진입부 보호구역
 * 횡단보도(S)에도 교차로 정지선과 같은 띠가 켜져야 한다.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { StopMarkers } from '../src/game/StopMarkers';
import { STOP_LINE, STOP_LINE_S } from '../src/layout';

/** 띠(반투명 판) 중 z 가 그 정지선 바로 뒤(차가 오는 쪽)에 있는 것 */
const bandBehind = (m: StopMarkers, line: number) =>
  m.group.children.find(
    (o): o is THREE.Mesh =>
      o instanceof THREE.Mesh &&
      (o.material as THREE.MeshBasicMaterial).transparent &&
      o.position.z > line &&
      o.position.z < line + 8,
  )!;
const opacity = (b: THREE.Mesh) => (b.material as THREE.MeshBasicMaterial).opacity;
const color = (b: THREE.Mesh) => (b.material as THREE.MeshBasicMaterial).color.getHex();

describe('정지 구역 띠', () => {
  it('보호구역 횡단보도(S) 앞에서도 교차로처럼 띠가 켜지고, 서면 초록이 된다', () => {
    const m = new StopMarkers();
    const s = bandBehind(m, STOP_LINE_S);
    const a = bandBehind(m, STOP_LINE);
    expect(s, 'S 정지선 뒤의 띠').toBeDefined();

    m.update({ required: true, satisfied: false, target: 'zone' }, 0.25);
    expect(opacity(s), '서라 — 호박색').toBeGreaterThan(0);
    expect(color(s)).toBe(0xffb020);
    expect(opacity(a), '교차로 띠는 꺼져 있다').toBe(0);

    m.update({ required: true, satisfied: true, target: 'zone' }, 0.1);
    expect(color(s), '섰다 — 초록').toBe(0x2ee06a);
    expect(opacity(s)).toBeGreaterThan(0);

    // S 를 지나 교차로로 가면 S 띠는 꺼지고 교차로 띠가 켜진다
    m.update({ required: true, satisfied: false, target: 'line' }, 0.1);
    expect(opacity(s)).toBe(0);
    expect(opacity(a)).toBeGreaterThan(0);
    m.dispose();
  });

  it('S 띠는 교차로 띠와 같은 모양 · 같은 간격이다', () => {
    const m = new StopMarkers();
    const s = bandBehind(m, STOP_LINE_S);
    const a = bandBehind(m, STOP_LINE);
    expect(s.position.z - STOP_LINE_S).toBeCloseTo(a.position.z - STOP_LINE);
    expect(s.position.x).toBeCloseTo(a.position.x);
    m.dispose();
  });
});
