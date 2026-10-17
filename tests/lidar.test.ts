/**
 * **LiDAR 센서와 인지** (game/lidarSensor.ts · ai/perception.ts).
 *
 * 센서가 거리를 바르게 재고 가림을 지키는지, 인지가 점을 물체로 묶어 사람 · 어린이 · 자전거 · 차를 가르고, 같은 물체를
 * 바퀴마다 이어 속도를 재고, 갈 길 위의 사람을 위험으로 보는지를 본다. 크기는 게임의 것이다 — 사람 · 자전거는 실물의
 * 두 배로 그려지므로(Pedestrian.ts 의 SIZE_SCALE) 어른 키 3.3m, 몸 반지름 0.44m 다.
 */

import { describe, expect, it } from 'vitest';

import { LIDAR, returnCount, scanLidar, type LidarShape } from '../src/game/lidarSensor';
import { Tracker, assessHazard, detect, type Track } from '../src/ai/perception';

/** 원점에서 북쪽(−z)을 보는 차 */
const ORIGIN = { x: 0, z: 0 };
const NORTH = 0;

const adult = (x: number, z: number): LidarShape => ({ kind: 'circle', x, z, r: 0.44, height: 3.34 });
const child = (x: number, z: number): LidarShape => ({ kind: 'circle', x, z, r: 0.29, height: 2.2 });
/** 차 — yaw 0 이면 북쪽을 본다(앞뒤가 z 축) */
const car = (x: number, z: number, yaw: number): LidarShape => ({
  kind: 'box',
  x,
  z,
  yaw,
  halfL: 2.4,
  halfW: 0.78,
  height: 1.47,
});
/** 자전거를 타고 동서로 건너는 사람 — 자전거 상자 + 안장 위로 올라간 몸 */
const rider = (x: number, z: number): LidarShape[] => [
  { kind: 'box', x, z, yaw: Math.PI / 2, halfL: 1.72, halfW: 0.24, height: 2.3 },
  { kind: 'circle', x, z, r: 0.44, height: 4.38 },
];

const cell = (layer: number, ray: number) => layer * LIDAR.rays + ray;

describe('LiDAR 센서', () => {
  it('정면 10m 의 사람까지 거리를 잰다 — 몸의 앞면(10 − 0.44)이고, 옆으로는 아무것도 없다', () => {
    const scan = scanLidar(ORIGIN, NORTH, [adult(0, -10)]);
    for (let l = 0; l < LIDAR.layers.length; l += 1) {
      expect(scan.range[cell(l, 0)]).toBeCloseTo(9.56, 2);
    }
    expect(scan.range[cell(0, LIDAR.rays / 4)]).toBe(Infinity);
  });

  it('앞차가 가린 사람은 아래층에서 안 보이고, 차보다 높은 머리만 위층에 걸린다', () => {
    const scan = scanLidar(ORIGIN, NORTH, [car(0, -8, 0), adult(0, -14)]);
    // 아래 두 층(0.5 · 1.0m)은 차의 뒷면(8 − 2.4)에서 멈춘다
    expect(scan.range[cell(0, 0)]).toBeCloseTo(5.6, 2);
    expect(scan.range[cell(1, 0)]).toBeCloseTo(5.6, 2);
    // 위 두 층(1.8 · 2.6m)은 차를 넘어 사람에게 닿는다
    expect(scan.range[cell(2, 0)]).toBeCloseTo(13.56, 2);
    expect(scan.range[cell(3, 0)]).toBeCloseTo(13.56, 2);
  });

  it('잴 수 있는 거리(50m) 밖은 돌아오지 않는다', () => {
    const scan = scanLidar(ORIGIN, NORTH, [adult(0, -70)]);
    expect(returnCount(scan)).toBe(0);
  });

  it('빗길에는 돌아오는 점이 줄지만, 사람은 여전히 찾는다', () => {
    const shapes = [adult(2, -12)];
    const dry = scanLidar(ORIGIN, NORTH, shapes);
    const wet = scanLidar(ORIGIN, NORTH, shapes, { dropout: 0.12, frame: 3 });
    expect(returnCount(wet)).toBeLessThan(returnCount(dry));
    expect(detect(wet).filter((d) => d.cls === 'adult')).toHaveLength(1);
  });
});

describe('인지 — 군집 · 분류', () => {
  it('어른 하나 → 물체 하나, 갈래는 어른, 중심은 실제 자리 근처', () => {
    const [d, ...rest] = detect(scanLidar(ORIGIN, NORTH, [adult(1.5, -11)]));
    expect(rest).toHaveLength(0);
    expect(d.cls).toBe('adult');
    expect(Math.hypot(d.x - 1.5, d.z + 11)).toBeLessThan(0.3);
  });

  it('키로 어른과 어린이를 가른다', () => {
    const dets = detect(scanLidar(ORIGIN, NORTH, [adult(-3, -12), child(3, -12)]));
    expect(dets.map((d) => d.cls).sort()).toEqual(['adult', 'child']);
  });

  it('붙어 선 두 사람(1.15m 간격 — 같은 보도의 대기 자리)을 둘로 가른다', () => {
    const dets = detect(scanLidar(ORIGIN, NORTH, [adult(-0.575, -8), adult(0.575, -8)]));
    expect(dets.filter((d) => d.cls === 'adult')).toHaveLength(2);
  });

  it('옆에서 본 차 → 차, 중심과 방향이 맞는다', () => {
    const [d] = detect(scanLidar(ORIGIN, NORTH, [car(0, -14, Math.PI / 2)]));
    expect(d.cls).toBe('car');
    expect(Math.hypot(d.x, d.z + 14)).toBeLessThan(0.8);
    // 긴 축이 동서 — 앞뒤는 따지지 않는다
    expect(Math.abs(Math.sin(d.yaw))).toBeGreaterThan(0.95);
  });

  it('뒤에서 본 앞차 → 뒷면만 보여도 차, 긴 축은 남북이고 중심은 뒷면보다 안쪽', () => {
    const [d] = detect(scanLidar(ORIGIN, NORTH, [car(0, -12, 0)]));
    expect(d.cls).toBe('car');
    expect(Math.abs(Math.cos(d.yaw))).toBeGreaterThan(0.95);
    expect(Math.hypot(d.x, d.z + 12)).toBeLessThan(0.8);
  });

  it('옆에서 본 자전거 탄 사람 → 자전거', () => {
    const dets = detect(scanLidar(ORIGIN, NORTH, rider(0, -10)));
    expect(dets.map((d) => d.cls)).toEqual(['bike']);
  });
});

describe('인지 — 추적', () => {
  it('횡단보도를 건너는 사람을 한 물체로 이어 가며 속도를 잰다', () => {
    const tracker = new Tracker();
    const speed = 3.6; // 게임의 걸음 (실물의 세 배)
    let ids = new Set<number>();
    for (let k = 0; k <= 20; k += 1) {
      const t = k / LIDAR.hz;
      const tracks = tracker.update(detect(scanLidar(ORIGIN, NORTH, [adult(-8 + speed * t, -12)])), t);
      ids = new Set([...ids, ...tracks.map((tr) => tr.id)]);
    }
    expect(ids.size).toBe(1);
    const [tr] = tracker.confirmed;
    expect(tr.cls).toBe('adult');
    expect(tr.vx).toBeGreaterThan(speed - 0.8);
    expect(tr.vx).toBeLessThan(speed + 0.8);
    expect(Math.abs(tr.vz)).toBeLessThan(0.5);
  });

  it('잠깐 가려져도(두 바퀴) 같은 물체로 이어 붙고, 오래 안 보이면 지운다', () => {
    const tracker = new Tracker();
    const seen = (t: number, visible: boolean) =>
      tracker.update(visible ? detect(scanLidar(ORIGIN, NORTH, [adult(3, -10)])) : [], t);
    seen(0, true);
    seen(0.1, true);
    const id = tracker.confirmed[0].id;
    seen(0.2, false);
    seen(0.3, false);
    seen(0.4, true);
    expect(tracker.confirmed.map((t) => t.id)).toEqual([id]);
    for (let t = 0.5; t < 1.3; t += 0.1) seen(t, false);
    expect(tracker.confirmed).toHaveLength(0);
  });
});

describe('인지 — 위험 평가', () => {
  /** 원점에서 북쪽으로 40m 곧게 가는 길 */
  const route = Array.from({ length: 41 }, (_, i) => ({ x: 0, z: -i }));
  const track = (over: Partial<Track>): Track => ({
    id: 1,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    yaw: 0,
    length: 0.9,
    width: 0.9,
    height: 2.6,
    cls: 'adult',
    hits: 3,
    lastSeen: 0,
    confirmed: true,
    ...over,
  });

  it('갈 길 위의 사람은 위험', () => {
    expect(assessHazard(track({ x: 0.5, z: -15 }), route)).toBe('danger');
  });
  it('길가에 붙어 선 사람은 주의', () => {
    expect(assessHazard(track({ x: 4, z: -15 }), route)).toBe('caution');
  });
  it('멀리 서 있는 사람은 그대로', () => {
    expect(assessHazard(track({ x: 15, z: -15 }), route)).toBe('none');
  });
  it('멀어도 2초 뒤 길에 들어올 사람은 주의 — 등속 예측', () => {
    expect(assessHazard(track({ x: 8, z: -15, vx: -3.6 }), route)).toBe('caution');
  });
  it('길 위의 차는 앞차', () => {
    expect(assessHazard(track({ x: 0, z: -12, cls: 'car', length: 4.75, width: 1.55 }), route)).toBe('lead');
  });
});
