/**
 * **LiDAR 차 추적이 안정적인가** (ai/perception.ts) — 차 한 대가 두 대로 **복제**되거나, 화면에서 **순간이동**하지 않는가.
 *
 * 사용자가 짚었다: *"라이다에 나타나는 차가 갑자기 복제가 되고 순간이동을 하는등 이상한점이 있어"*. 게임에서 차가 움직이는
 * 모양(우회전하는 앞차 · 교차로를 40km/h 로 가로지르는 차 · 내 뒤에 선 차 · 진출로에 줄 선 차)을 그대로 흉내 내어 1초에 열 번
 * 쏘고, 확정된 물체를 실제 차와 맞춰 본다.
 *
 *  - **복제** — 한 차에 확정된 추적이 둘 이상 붙은 바퀴
 *  - **순간이동** — 같은 추적이 한 바퀴 사이에 실제 차보다 1m 넘게 더(덜) 움직인 횟수
 *  - **어긋남** — 추적 중심과 실제 중심의 거리
 */

import { describe, expect, it } from 'vitest';

import { scanLidar, type LidarShape } from '../src/game/lidarSensor';
import { Tracker, detect, type Track } from '../src/ai/perception';

interface Pose {
  x: number;
  z: number;
  yaw: number;
}
const box = (p: Pose): LidarShape => ({ kind: 'box', x: p.x, z: p.z, yaw: p.yaw, halfL: 2.4, halfW: 0.78, height: 1.47 });
const NORTH = 0;
const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;

/** 우회전 — 북쪽으로 오다가 교차로 모서리를 돌아 동쪽으로 (반지름 4m, 3m/s) */
function rightTurner(t: number, start = 22): Pose {
  const v = 3;
  const cornerZ = 9.8;
  const r = 4;
  const s = v * t;
  const straight = start - cornerZ;
  if (s < straight) return { x: 6.825, z: start - s, yaw: NORTH };
  const arc = (Math.PI / 2) * r;
  if (s < straight + arc) {
    const a = (s - straight) / r; // 0 → π/2
    return { x: 6.825 + r - r * Math.cos(a), z: cornerZ - r * Math.sin(a), yaw: -a };
  }
  return { x: 6.825 + r + (s - straight - arc), z: cornerZ - r, yaw: EAST };
}

interface Run {
  dupScans: number;
  jumps: number;
  maxError: number;
  scans: number;
}

function run(cars: Array<(t: number) => Pose>, ego: (t: number) => Pose, seconds = 8, dropout = 0): Run {
  const tracker = new Tracker();
  const last = new Map<number, { x: number; z: number; car: number; truth: Pose }>();
  let dupScans = 0;
  let jumps = 0;
  let maxError = 0;
  let scans = 0;
  for (let k = 0; k <= seconds * 10; k += 1) {
    const t = k / 10;
    const truths = cars.map((c) => c(t));
    const e = ego(t);
    const scan = scanLidar({ x: e.x, z: e.z }, e.yaw, truths.map(box), { frame: k, dropout });
    tracker.update(detect(scan), t);
    const tracks = tracker.confirmed.filter((tr: Track) => tr.cls === 'car');
    scans += 1;
    // 추적마다 가장 가까운 실제 차 — 4m 안에 없으면 헛것
    const perCar = new Map<number, number>();
    for (const tr of tracks) {
      let best = -1;
      let bestD = Infinity;
      truths.forEach((p, i) => {
        const d = Math.hypot(p.x - tr.x, p.z - tr.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (bestD > 4) continue;
      perCar.set(best, (perCar.get(best) ?? 0) + 1);
      maxError = Math.max(maxError, bestD);
      const prev = last.get(tr.id);
      if (prev && prev.car === best) {
        const moved = Math.hypot(tr.x - prev.x, tr.z - prev.z);
        const truthMoved = Math.hypot(truths[best].x - prev.truth.x, truths[best].z - prev.truth.z);
        if (Math.abs(moved - truthMoved) > 1) jumps += 1;
      }
      last.set(tr.id, { x: tr.x, z: tr.z, car: best, truth: truths[best] });
    }
    if ([...perCar.values()].some((n) => n > 1)) dupScans += 1;
  }
  return { dupScans, jumps, maxError, scans };
}

const still = (p: Pose) => () => p;

describe('LiDAR 차 추적 — 복제 · 순간이동 없음', () => {
  it('정지선에 선 내 차 앞에서 앞차가 우회전한다', () => {
    const r = run([(t) => rightTurner(t)], still({ x: 6.825, z: 30, yaw: NORTH }), 10);
    expect(r.dupScans).toBe(0);
    expect(r.jumps).toBe(0);
    expect(r.maxError).toBeLessThan(1.6);
  });

  it('교차로를 40km/h 로 가로지르는 차', () => {
    const r = run([(t) => ({ x: -40 + 11 * t, z: 2.3, yaw: EAST }), (t) => ({ x: 40 - 11 * t, z: -2.3, yaw: WEST })], still({ x: 6.825, z: 24, yaw: NORTH }), 7);
    expect(r.dupScans).toBe(0);
    expect(r.jumps).toBe(0);
    expect(r.maxError).toBeLessThan(2);
  });

  it('내 차가 우회전하는 동안 — 뒤차 · 진출로에 줄 선 차', () => {
    const r = run(
      [still({ x: 6.825, z: 34, yaw: NORTH }), still({ x: 24, z: 6.825, yaw: EAST }), still({ x: 30.5, z: 6.825, yaw: EAST })],
      (t) => rightTurner(t, 26),
      8,
    );
    expect(r.dupScans).toBe(0);
    expect(r.jumps).toBe(0);
    expect(r.maxError).toBeLessThan(1.6);
  });

  it('빗길(열 줄에 한 줄 손실)에서도 복제되지 않는다 — 내 차가 우회전하며 줄 선 차를 본다', () => {
    const r = run(
      [still({ x: 6.825, z: 34, yaw: NORTH }), still({ x: 24, z: 6.825, yaw: EAST }), still({ x: 30.5, z: 6.825, yaw: EAST })],
      (t) => rightTurner(t, 26),
      8,
      0.12,
    );
    expect(r.dupScans).toBe(0);
    expect(r.maxError).toBeLessThan(1.6);
  });

  /*
    차 조각을 합치고 버리는 규칙이 **사람까지 먹으면 안 된다** — 앞차 바로 앞 횡단보도를 건너는 사람("앞차 뒤에서 뛰어드는 사람"
    판). 사람은 차 바로 뒤, 아래층 레이저가 차에 막히는 자리에서 출발한다. 게임의 사람은 키가 3.3m 라 차(1.5m) 너머로 머리가
    위층에 걸리므로, 차 옆으로 나오기 전에 이미 사람으로 잡혀야 한다 — 차 상자 안이라고 버리거나 차 조각과 합치면 놓친다.
  */
  it('앞차 앞에서 튀어나오는 사람을 놓치지 않는다', () => {
    const tracker = new Tracker();
    const lead = box({ x: 6.825, z: 20.5, yaw: NORTH });
    let seenAt: number | null = null;
    for (let k = 0; k <= 40; k += 1) {
      const t = k / 10;
      const px = 5.6 + 3.6 * t; // 차 뒤(아래층이 가려지는 5.4~8.3m)에서 오른쪽으로 걷는다 (게임의 걸음)
      const person = { kind: 'circle' as const, x: px, z: 16.8, r: 0.44, height: 3.34 };
      const scan = scanLidar({ x: 6.825, z: 30 }, NORTH, [lead, person], { frame: k });
      const tracks = tracker.update(detect(scan), t);
      const found = tracks.some((tr) => tr.confirmed && tr.cls !== 'car' && Math.hypot(tr.x - px, tr.z - 16.8) < 1.2);
      if (found && seenAt === null) seenAt = px;
    }
    // 아래층이 가려진 동안(차 그림자 8.3m 안쪽)에 이미 사람으로 잡힌다
    expect(seenAt).not.toBeNull();
    expect(seenAt!).toBeLessThan(8.3);
  });
});
