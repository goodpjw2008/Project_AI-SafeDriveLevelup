/**
 * 우회전 경로 — 폴리라인 · 누적 거리 · 경로 위의 자세.
 *
 * ## 왜 따로 떼어 냈는가
 *
 * 원래 driveSim.ts 안에만 있었다. 앞차(game/leadDrive.ts)가 생기면서 **같은 길**을
 * 두 곳이 달리게 됐다 — 3D 없이 판을 돌려 보는 시뮬레이터의 운전자와, 게임과 검증기가
 * 함께 굴리는 앞차다. 둘이 각자 길을 그리면 "앞차와의 간격" 이 서로 다른 좌표계에서
 * 재어져, 검증기가 통과시킨 판에서 실제로는 추돌이 난다.
 *
 * 순수 모듈이다 — Three.js 도 DOM 도 쓰지 않는다.
 */

import {
  CROSSWALK_INNER,
  FINISH_X,
  INTERSECTION_HALF,
  PLAYER_APPROACH_X,
  PLAYER_EXIT_Z,
  ROAD_HALF_WIDTH,
  SPAWN_Z,
} from '../layout';

/** 시뮬레이터가 쓰는 차의 앞범퍼까지 거리 (m) — 실제 차는 차종마다 조금씩 다르다 */
export const CAR_HALF_LENGTH = 2.2;

/*
  경로를 잡는 비율들.

  원래는 반폭 7m 교차로에 맞춘 고정 좌표(R=4.0, 시작 z=9, 부풀림 -2)였다. 도로 폭이 바뀌면
  같은 좌표가 전혀 다른 궤적이 되어(넓힌 도로에서는 '붙어 돈 경로'가 코너에서 멀어진다)
  검증하려던 상황 자체가 사라진다. 그래서 그 좌표들을 폭에 대한 비율로 남긴다.
*/
const TIGHT_R_RATIO = 4.0 / 7.0;
const WIDE_START_RATIO = 9.0 / 7.0;
const WIDE_BULGE_RATIO = 2.0 / 7.0;

export interface Vec2 {
  x: number;
  z: number;
}

/** 우회전 궤적. tight = 우측 가장자리에 붙어 회전, wide = 교차로 중앙까지 부풀려 대회전. */
export type TurnStyle = 'tight' | 'wide';

/**
 * 주행 경로를 폴리라인으로 만든다.
 * 좌표는 전부 layout.ts 상수에서 유도한다 — 교차로 치수가 바뀌어도 경로가 따라간다.
 *
 * @param endX 진출로를 어디까지 이을지. 플레이어는 완주선 조금 너머면 되지만,
 *             앞차는 화면 밖까지 빠져나가야 한다.
 */
export function buildPath(
  style: TurnStyle,
  startZ: number = SPAWN_Z,
  endX: number = FINISH_X + 6,
): Vec2[] {
  const lane = PLAYER_APPROACH_X;
  const exitZ = PLAYER_EXIT_Z;
  const pts: Vec2[] = [{ x: lane, z: startZ }];

  if (style === 'tight') {
    // 차로를 따라 내려와 코너를 사분원으로 붙여 돈다.
    const R = ROAD_HALF_WIDTH * TIGHT_R_RATIO;
    pts.push({ x: lane, z: exitZ + R });
    const cx = lane + R;
    const cz = exitZ + R;
    for (let i = 1; i <= 60; i++) {
      const a = (Math.PI / 2) * (i / 60);
      pts.push({ x: cx - R * Math.cos(a), z: cz - R * Math.sin(a) });
    }
  } else {
    // 교차로 중앙까지 부풀려 도는 대회전 (제어점도 교차로 크기에 비례시킨다)
    const a: Vec2 = { x: lane, z: INTERSECTION_HALF * WIDE_START_RATIO };
    const b: Vec2 = { x: CROSSWALK_INNER + 1, z: exitZ };
    const c: Vec2 = {
      x: -INTERSECTION_HALF * WIDE_BULGE_RATIO,
      z: -INTERSECTION_HALF * WIDE_BULGE_RATIO,
    };
    pts.push(a);
    for (let i = 1; i <= 120; i++) {
      const t = i / 120;
      const u = 1 - t;
      pts.push({
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        z: u * u * a.z + 2 * u * t * c.z + t * t * b.z,
      });
    }
  }

  pts.push({ x: endX, z: exitZ });
  return pts;
}

/**
 * **직진 경로** — 교차로를 그대로 지나 북쪽으로 빠져나간다.
 *
 * 앞차가 우회전만 하는 것은 아니다. 우회전 차로가 따로 없는 교차로에서 우회전을 막는
 * 가장 흔한 것이 **직진 대기 차량**이고, 그때 규정은 "그 차 뒤에서 기다린다" 다.
 */
export function buildStraightPath(startZ: number, endZ = -160): Vec2[] {
  return [
    { x: PLAYER_APPROACH_X, z: startZ },
    { x: PLAYER_APPROACH_X, z: endZ },
  ];
}

/** 폴리라인의 누적 거리 테이블 */
export function arcLengths(pts: Vec2[]): number[] {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return acc;
}

export interface Pose {
  center: Vec2;
  front: Vec2;
  rear: Vec2;
  /** 진행 방향 단위벡터 */
  dir: Vec2;
}

/**
 * 경로상 거리 s 지점의 차량 중심과 앞·뒤범퍼 위치.
 *
 * @param halfLength 차 길이의 절반. 앞범퍼·뒷범퍼는 **진행 방향으로 이만큼** 떨어진 점이다.
 */
export function poseAt(
  pts: Vec2[],
  acc: number[],
  s: number,
  halfLength: number = CAR_HALF_LENGTH,
): Pose {
  const total = acc[acc.length - 1];
  const d = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < acc.length - 1 && acc[i] < d) i++;
  const segLen = acc[i] - acc[i - 1] || 1;
  const t = (d - acc[i - 1]) / segLen;
  const p0 = pts[i - 1];
  const p1 = pts[i];
  const center = { x: p0.x + (p1.x - p0.x) * t, z: p0.z + (p1.z - p0.z) * t };
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const len = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / len, z: dz / len };
  return {
    center,
    front: { x: center.x + dir.x * halfLength, z: center.z + dir.z * halfLength },
    rear: { x: center.x - dir.x * halfLength, z: center.z - dir.z * halfLength },
    dir,
  };
}

/**
 * 점 (x, z) 를 경로에 수선으로 내렸을 때의 **경로상 거리**.
 *
 * 앞차와 나의 간격을 "경로를 따라" 재는 데 쓴다. 코너에서는 직선 거리가 실제로 달려야
 * 할 거리보다 짧아, 직선으로 재면 아직 여유가 있는데도 붙었다고 판단한다.
 * 경로에서 조금 벗어난 차(대회전)도 가장 가까운 자리로 내려 준다.
 */
export function projectOnPath(pts: Vec2[], acc: number[], x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - p0.x) * dx + (z - p0.z) * dz) / len2));
    const qx = p0.x + dx * u;
    const qz = p0.z + dz * u;
    const d = (x - qx) ** 2 + (z - qz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = acc[i - 1] + Math.sqrt(len2) * u;
    }
  }
  return best;
}
