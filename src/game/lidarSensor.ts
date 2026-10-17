/**
 * **LiDAR 센서 시뮬레이션** — 차 지붕에서 레이저를 한 바퀴 돌려 쏘고, 줄마다 처음 맞은 물체까지의 거리를 잰다.
 *
 * 사용자가 정했다 (2026-10-17): AI 자율 주행이 주변을 **게임 속 값으로 읽지 않고 센서로 보게** 하는 첫걸음으로
 * LiDAR 시뮬레이션을 쓴다. 카메라 영상 인식보다 가볍고, 화면을 그리지 않는 검증기(scenarios/playSim.ts)에서도
 * 같은 셈으로 돈다.
 *
 * ## 무엇을 흉내 내는가
 *
 *  - **여러 층의 수평 스캔** — 층마다 한 바퀴 720줄(0.5° 간격)을 쏜다. 회전형 LiDAR 의 채널(위아래 각도)을
 *    높이 몇 개로 단순화했다. 사람은 키가 커서 위층까지 맞고, 차는 아래 두 층만 맞는다 — 인지가 키로 둘을 가른다.
 *  - **가림** — 한 줄은 처음 맞은 것에서 멈춘다. 앞차 뒤에 선 사람은 아래층에서는 안 보이고, 차보다 높은
 *    머리만 위층에 걸린다. 실제 도로에서 "앞차 뒤에서 뛰어드는 사람" 이 왜 위험한지가 센서에도 그대로 남는다.
 *  - **빗길의 반사 손실** — 비가 오면 일부 줄이 돌아오지 않는다 (`dropout`).
 *
 * 이 파일은 **센서**다 — AI 가 아니다. 점을 물체로 묶고, 무엇인지 가리고, 따라가는 일(인지)은 ai/perception.ts 가 한다.
 * 순수 모듈이다 (three.js 를 부르지 않는다).
 */

/** 센서 제원 */
export const LIDAR = {
  /** 한 층 한 바퀴의 줄 수 — 0.5° 간격 */
  rays: 720,
  /**
   * 층의 높이 (m). 차(전고 1.46~1.7m)는 아래 둘, 어린이(키 2.2m — 게임의 사람은 실물의 두 배다, Pedestrian.ts 의
   * SIZE_SCALE)는 아래 셋, 어른(3.3m)은 넷 모두에 걸린다.
   */
  layers: [0.5, 1.0, 1.8, 2.6] as readonly number[],
  /** 잴 수 있는 거리 (m) */
  range: 50,
  /** 한 바퀴 도는 횟수 (Hz) — 실제 회전형 LiDAR 의 흔한 값 */
  hz: 10,
} as const;

/**
 * 센서가 맞힐 수 있는 물체 — 바닥에 선 기둥(원기둥 · 직육면체)으로 본다.
 *
 * 상자의 `yaw` 는 게임의 차와 같은 약속이다 — 앞이 (−sin yaw, −cos yaw), `halfL` 이 앞뒤, `halfW` 가 좌우.
 */
export type LidarShape =
  | { kind: 'circle'; x: number; z: number; r: number; height: number }
  | { kind: 'box'; x: number; z: number; yaw: number; halfL: number; halfW: number; height: number };

/**
 * **사람 한 명의 몸** (자전거 포함) — 게임(Pedestrian.ts)과 분류기 학습 데이터(ai/lidarScenes.ts)가 같은 몸을 쓴다.
 *
 * 크기는 그리는 모형에서 잰다 (배율 1 기준): 몸통 · 팔 바깥까지 반폭 0.22, 머리 꼭대기 1.67, 자전거는 바퀴 끝에서 끝까지
 * 1.72 · 핸들 높이 1.15. 타고 있으면 몸이 안장 높이(0.52)만큼 올라가고, 끌고 가면 자전거를 걷는 방향과 직각인 쪽으로
 * 0.45 비켜 세운다 (Pedestrian.ts 의 buildBike).
 *
 * @param facing 모형이 돌아선 각 (three.js 의 rotation.y — 모형의 앞은 로컬 +z)
 * @param scale  사람의 배율 (어른 2.0 · 어르신 1.84 · 어린이 1.32 — Pedestrian.ts 의 SIZE_SCALE 이 곱해진 값)
 */
export function personShapes(p: {
  x: number;
  z: number;
  facing: number;
  scale: number;
  bike?: 'ride' | 'push';
}): LidarShape[] {
  const s = p.scale;
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  const ride = p.bike === 'ride';
  const out: LidarShape[] = [
    { kind: 'circle', x: p.x, z: p.z, r: 0.22 * s, height: (ride ? 1.67 + 0.52 : 1.67) * s },
  ];
  if (p.bike) {
    const side = ride ? 0 : 0.45 * s;
    out.push({
      kind: 'box',
      // 로컬 x(옆)는 월드에서 (fz, −fx) 쪽이다
      x: p.x + fz * side,
      z: p.z - fx * side,
      // 게임의 yaw 약속은 앞이 (−sin, −cos) — 걷는 축과 같은 축이면 앞뒤는 상관없다
      yaw: Math.atan2(-fx, -fz),
      halfL: 0.86 * s,
      halfW: 0.12 * s,
      height: 1.15 * s,
    });
  }
  return out;
}

/** 한 바퀴의 결과 — 거리 영상(range image) */
export interface LidarScan {
  /** 센서 자리 (월드) */
  ox: number;
  oz: number;
  /** 0번 줄의 방향 (게임의 yaw 약속) — 차의 정면 */
  heading: number;
  rays: number;
  layers: readonly number[];
  /** 층 × 줄의 거리 (m) — `range[layer * rays + ray]`. 돌아오지 않은 줄은 Infinity */
  range: Float32Array;
  /**
   * 칸마다 **맞은 물체의 번호** (`shapes` 의 차례, 안 맞았으면 −1) — `ScanOptions.owners` 를 켰을 때만.
   * 분류기 학습의 정답이다 — 센서는 모르는 값이라 인지(ai/perception.ts)는 읽지 않는다.
   */
  owner?: Int32Array;
}

/** 줄 번호 → 방향 (단위벡터) */
export function rayDir(scan: Pick<LidarScan, 'heading' | 'rays'>, ray: number): { x: number; z: number } {
  const a = scan.heading + (ray * 2 * Math.PI) / scan.rays;
  return { x: -Math.sin(a), z: -Math.cos(a) };
}

/** 한 칸(층 · 줄)이 맞은 자리 (월드) */
export function cellPoint(scan: LidarScan, cell: number): { x: number; z: number; y: number } {
  const ray = cell % scan.rays;
  const layer = (cell - ray) / scan.rays;
  const d = scan.range[cell];
  const dir = rayDir(scan, ray);
  return { x: scan.ox + dir.x * d, z: scan.oz + dir.z * d, y: scan.layers[layer] };
}

/** 원점에서 `dir` 로 쏜 줄이 원에 처음 닿는 거리 — 안 닿으면 Infinity */
function hitCircle(px: number, pz: number, r: number, dx: number, dz: number): number {
  const b = px * dx + pz * dz;
  const c = px * px + pz * pz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

/** 원점에서 `dir` 로 쏜 줄이 상자에 처음 닿는 거리 (평판 교차, slab) — 안 닿으면 Infinity */
function hitBox(
  px: number,
  pz: number,
  yaw: number,
  halfL: number,
  halfW: number,
  dx: number,
  dz: number,
): number {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  // 상자 기준으로 옮긴 센서 자리(상자 중심에서 센서로) · 줄 방향
  const o = [-(px * fx + pz * fz), -(px * rx + pz * rz)];
  const d = [dx * fx + dz * fz, dx * rx + dz * rz];
  const h = [halfL, halfW];
  let tMin = -Infinity;
  let tMax = Infinity;
  for (let k = 0; k < 2; k += 1) {
    if (Math.abs(d[k]) < 1e-9) {
      if (Math.abs(o[k]) > h[k]) return Infinity;
      continue;
    }
    const t1 = (-h[k] - o[k]) / d[k];
    const t2 = (h[k] - o[k]) / d[k];
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  if (tMax < tMin || tMin <= 0) return Infinity;
  return tMin;
}

/** 줄 · 층 · 바퀴 번호로 정하는 0~1 값 — 빗길 손실을 고르는 데 쓴다 (같은 입력이면 늘 같은 값) */
function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export interface ScanOptions {
  /** 돌아오지 않을 줄의 비율 (0~1) — 빗길 */
  dropout?: number;
  /** 몇 번째 바퀴인가 — 손실이 바퀴마다 다른 줄에 걸리게 한다 */
  frame?: number;
  /** 칸마다 맞은 물체의 번호를 함께 적는가 (학습 데이터용) */
  owners?: boolean;
}

/**
 * 한 바퀴를 쏜다.
 *
 * **물체마다 걸리는 줄만 본다** — 물체를 둘러싼 원이 차지하는 각도 안의 줄만 셈하므로, 2,880줄 × 물체 수를 다
 * 돌지 않는다. 판에 물체가 스무 개쯤이라 한 바퀴가 1ms 안쪽이다.
 */
export function scanLidar(
  origin: { x: number; z: number },
  heading: number,
  shapes: readonly LidarShape[],
  opts: ScanOptions = {},
): LidarScan {
  const { rays, layers, range: maxRange } = LIDAR;
  const range = new Float32Array(rays * layers.length).fill(Infinity);
  const owner = opts.owners ? new Int32Array(rays * layers.length).fill(-1) : undefined;
  const step = (2 * Math.PI) / rays;

  for (let si = 0; si < shapes.length; si += 1) {
    const s = shapes[si];
    const px = s.x - origin.x;
    const pz = s.z - origin.z;
    const dc = Math.hypot(px, pz);
    const bound = s.kind === 'circle' ? s.r : Math.hypot(s.halfL, s.halfW);
    // 너무 멀거나, 센서가 그 안에 있으면(겹친 물체) 건너뛴다
    if (dc - bound > maxRange || dc <= bound) continue;

    // 그 물체 쪽 방향의 줄 번호와, 양옆으로 몇 줄까지 걸리는가
    const centerAngle = Math.atan2(-px, -pz);
    const center = (centerAngle - heading) / step;
    const half = Math.ceil(Math.asin(Math.min(1, bound / dc)) / step) + 1;
    // 그 물체 키에 닿는 가장 높은 층
    let top = -1;
    for (let l = 0; l < layers.length; l += 1) if (layers[l] < s.height) top = l;
    if (top < 0) continue;

    for (let k = Math.floor(center) - half; k <= Math.ceil(center) + half; k += 1) {
      const ray = ((k % rays) + rays) % rays;
      const a = heading + ray * step;
      const dx = -Math.sin(a);
      const dz = -Math.cos(a);
      const t =
        s.kind === 'circle'
          ? hitCircle(px, pz, s.r, dx, dz)
          : hitBox(px, pz, s.yaw, s.halfL, s.halfW, dx, dz);
      if (t > maxRange) continue;
      for (let l = 0; l <= top; l += 1) {
        const cell = l * rays + ray;
        if (t < range[cell]) {
          range[cell] = t;
          if (owner) owner[cell] = si;
        }
      }
    }
  }

  const dropout = opts.dropout ?? 0;
  if (dropout > 0) {
    const frame = opts.frame ?? 0;
    for (let cell = 0; cell < range.length; cell += 1) {
      if (range[cell] !== Infinity && hash01(cell, frame, 7) < dropout) {
        range[cell] = Infinity;
        if (owner) owner[cell] = -1;
      }
    }
  }

  return { ox: origin.x, oz: origin.z, heading, rays, layers, range, ...(owner ? { owner } : {}) };
}

/** 돌아온 점의 수 */
export function returnCount(scan: LidarScan): number {
  let n = 0;
  for (const d of scan.range) if (d !== Infinity) n += 1;
  return n;
}
