/**
 * **LiDAR 인지 — 점구름에서 물체를 찾고, 무엇인지 가리고, 따라간다.**
 *
 * 센서(game/lidarSensor.ts)가 주는 것은 줄마다 거리 하나뿐이다. 거기서 "사람 셋 · 자전거 하나 · 차 둘이 어디서 어느
 * 쪽으로 움직이는가" 를 끌어내는 것이 이 모듈이다. 실제 AI 자율주행차의 LiDAR 인지가 밟는 네 단계를 그대로 밟는다.
 *
 *  1. **군집화** — 거리 영상(range image) 위에서 이웃한 칸끼리, 두 점이 같은 면에 있는지를 **각도 기준 β** 로 가려
 *     잇는다 (Bogoslavskyi & Stachniss, 2016). 거리 차이만으로 자르면 먼 곳은 줄 간격이 벌어져 한 사람이 조각나고,
 *     가까운 곳은 붙어 선 두 사람이 한 덩어리가 된다 — β 는 거리에 따라 저절로 맞는다.
 *  2. **분류** — 군집의 크기(주성분 분석으로 잰 길이 · 폭) · 층마다의 폭 · 깊이 같은 특징 열여덟으로 어른 · 어린이 ·
 *     자전거 · 차를 가른다. **학습한 분류기**(작은 신경망, models/lidar.json)다 — 시뮬레이터는 줄마다 어느 물체를
 *     맞혔는지 알므로 정답 붙은 군집을 얼마든지 만들 수 있다 (ai/lidarScenes.ts · scripts/train-lidar.ts).
 *     처음에 손으로 정한 규칙(ruleClass)과 로지스틱 회귀는 비교 기준으로 남겨 둔다.
 *  3. **추적** — 지난 물체의 예측 자리와 가까운 것끼리 잇고(최근접 연결), **알파-베타 필터**로 자리와 속도를 다듬는다.
 *     한두 바퀴 놓쳐도(가림 · 빗길) 예측 자리로 이어 가다가, 오래 안 보이면 지운다.
 *  4. **위험 평가** — 앞으로 달릴 길 위에 있는가, 그리고 **보행자 횡단 의도 예측 신경망**(ai/intent.ts)이 그 사람을
 *     어떻게 짐작했는가로 주의 · 위험을 가른다 — AI 가 양보하는 사람은 위험, 2초 안에 차도에 들어설 것 같은 사람은 주의.
 *     짐작을 붙이지 못한 물체만 예전처럼 **2초 뒤**(등속 예측)로 본다.
 *
 * 순수 모듈이다 — 화면(game/LidarPanel.ts)은 이 결과를 그리기만 한다.
 */

import { cellPoint, type LidarScan } from '../game/lidarSensor';
import trained from './models/lidar.json';

export type ObjectClass = 'adult' | 'child' | 'bike' | 'car' | 'unknown';

/** 한 바퀴에서 찾은 물체 하나 */
export interface Detection {
  /** 추정한 물체 중심 (보이는 면만 맞으므로 그만큼 뒤로 민 자리) */
  x: number;
  z: number;
  /** 길이 · 폭 (m) — 길이가 늘 폭 이상 */
  length: number;
  width: number;
  /** 긴 축의 방향 (게임의 yaw 약속) */
  yaw: number;
  /** 맞은 가장 높은 층의 높이 (m) */
  height: number;
  cls: ObjectClass;
  /** 학습한 분류기가 낸 갈래마다의 확률 (규칙으로 가렸으면 없다) */
  probs?: Partial<Record<ObjectClass, number>>;
  /** 이 물체에 맞은 점의 수 */
  points: number;
  /** 차면 L 자 맞춤 결과 — 추적이 자기 방향 · 크기로 중심을 다시 잡는 데 쓴다 */
  fit?: CarFit;
}

/** 차의 보이는 점들과 그 L 자 방향 — 센서 자리를 원점으로 둔 좌표 (m) */
export interface CarFit {
  pts: Array<[number, number]>;
  ox: number;
  oz: number;
  /** L 자 모서리의 한 축 방향 (0 ~ π/2, 월드 x 축에서 z 축 쪽으로 잰 각) — 다른 축은 여기에 직각 */
  theta: number;
}

/** 따라가는 물체 */
export interface Track {
  id: number;
  x: number;
  z: number;
  /** 속도 (m/s, 월드) */
  vx: number;
  vz: number;
  yaw: number;
  length: number;
  width: number;
  height: number;
  cls: ObjectClass;
  /** 이어 붙은 횟수 — 두 번 이상이면 확정 */
  hits: number;
  /** 마지막으로 보인 때 (초) */
  lastSeen: number;
  confirmed: boolean;
}

/** 내 길에 대해 그 물체가 얼마나 문제인가 */
export type Hazard = 'none' | 'lead' | 'caution' | 'danger';

// ── 1. 군집화 ──────────────────────────────────────────────────────────────

/** 이웃한 두 줄을 같은 면으로 보는 각도 β 의 하한 (rad) — 논문의 권장값 10° */
const BETA_MIN = (10 * Math.PI) / 180;
/** 그래도 이만큼 가까우면 잇는다 (m) — 비스듬히 본 차 옆면이 β 로는 끊기는 것을 막는다 */
const JOIN_DISTANCE = 0.35;
/** 위아래 층은 거리 차이가 이 안이면 같은 물체다 (m) */
const LAYER_JOIN = 0.6;
/** 이보다 적은 점의 군집은 버린다 */
const MIN_POINTS = 2;

/**
 * 거리 영상을 군집으로 나눈다 — 칸 번호의 묶음을 돌려준다.
 *
 * 너비 우선 탐색으로 이웃을 잇는다. 이웃은 같은 층의 양옆 줄(한 칸 건너까지 — 빗길에 한 줄이 비어도 끊기지 않게)과
 * 같은 줄의 위아래 층이다.
 */
export function segment(scan: LidarScan): number[][] {
  const { rays, range } = scan;
  const layers = scan.layers.length;
  const alpha = (2 * Math.PI) / rays;
  const label = new Int32Array(range.length).fill(-1);
  const clusters: number[][] = [];
  const queue: number[] = [];

  const joined = (a: number, b: number, gap: number): boolean => {
    const d1 = Math.max(range[a], range[b]);
    const d2 = Math.min(range[a], range[b]);
    const ang = alpha * gap;
    const dist = Math.sqrt(d1 * d1 + d2 * d2 - 2 * d1 * d2 * Math.cos(ang));
    if (dist < JOIN_DISTANCE) return true;
    if (gap > 1) return false;
    return Math.atan2(d2 * Math.sin(ang), d1 - d2 * Math.cos(ang)) > BETA_MIN;
  };

  for (let seed = 0; seed < range.length; seed += 1) {
    if (range[seed] === Infinity || label[seed] !== -1) continue;
    const id = clusters.length;
    const cells: number[] = [];
    label[seed] = id;
    queue.length = 0;
    queue.push(seed);
    while (queue.length) {
      const c = queue.pop()!;
      cells.push(c);
      const ray = c % rays;
      const layer = (c - ray) / rays;
      for (const [dl, dr] of [
        [0, 1],
        [0, -1],
        [0, 2],
        [0, -2],
        [1, 0],
        [-1, 0],
      ]) {
        const l = layer + dl;
        if (l < 0 || l >= layers) continue;
        const n = l * rays + ((ray + dr + rays) % rays);
        if (range[n] === Infinity || label[n] !== -1) continue;
        const ok = dl !== 0 ? Math.abs(range[n] - range[c]) < LAYER_JOIN : joined(c, n, Math.abs(dr));
        if (!ok) continue;
        label[n] = id;
        queue.push(n);
      }
    }
    clusters.push(cells);
  }
  return clusters.filter((c) => c.length >= MIN_POINTS);
}

// ── 2. 분류 ────────────────────────────────────────────────────────────────

/**
 * 갈래마다 **본래 크기** (m) — 보이는 면만 맞으므로 군집은 늘 실물보다 작다. 이 크기로 안쪽을 채운다.
 * 게임의 사람 · 자전거는 실물의 두 배로 그려지므로(Pedestrian.ts 의 SIZE_SCALE) 그 크기를 따른다.
 */
export const CLASS_SIZE: Record<ObjectClass, { length: number; width: number; height: number }> = {
  adult: { length: 0.9, width: 0.9, height: 3.3 },
  child: { length: 0.6, width: 0.6, height: 2.2 },
  bike: { length: 3.4, width: 0.9, height: 3.6 },
  car: { length: 4.75, width: 1.55, height: 1.5 },
  unknown: { length: 0.6, width: 0.6, height: 1.0 },
};

/** 분류기가 가르는 갈래 — 모델의 출력 차례 */
export const CLASSES = ['adult', 'child', 'bike', 'car'] as const satisfies readonly ObjectClass[];

/** 군집의 생김새 — 특징을 뽑고 중심 · 방향을 잡는 데 함께 쓴다 */
export interface ClusterGeometry {
  pts: Array<{ x: number; z: number; y: number }>;
  /** 점마다의 층 번호 · 센서에서의 거리 */
  layer: number[];
  dist: number[];
  /** 무게중심 */
  mx: number;
  mz: number;
  /** 긴 축(주성분)의 단위벡터 · 길이 · 폭 */
  ux: number;
  uz: number;
  length: number;
  width: number;
  /** 두 고윳값 — 길쭉한 정도를 잰다 */
  l1: number;
  l2: number;
}

/** 칸 번호 묶음 → 생김새 */
export function clusterGeometry(scan: LidarScan, cells: readonly number[]): ClusterGeometry {
  const pts = cells.map((c) => cellPoint(scan, c));
  const layer = cells.map((c) => Math.floor(c / scan.rays));
  const dist = cells.map((c) => scan.range[c]);
  const n = pts.length;
  let mx = 0;
  let mz = 0;
  for (const p of pts) {
    mx += p.x / n;
    mz += p.z / n;
  }
  // 주성분 — 점들이 가장 길게 늘어선 방향
  let cxx = 0;
  let cxz = 0;
  let czz = 0;
  for (const p of pts) {
    cxx += (p.x - mx) ** 2 / n;
    cxz += ((p.x - mx) * (p.z - mz)) / n;
    czz += (p.z - mz) ** 2 / n;
  }
  const phi = 0.5 * Math.atan2(2 * cxz, cxx - czz);
  let ux = Math.cos(phi);
  let uz = Math.sin(phi);
  const tr = cxx + czz;
  const det = cxx * czz - cxz * cxz;
  const gap = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const extent = (ax: number, az: number): number => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      const t = p.x * ax + p.z * az;
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    return hi - lo;
  };
  let length = extent(ux, uz);
  let width = extent(-uz, ux);
  if (width > length) {
    [length, width] = [width, length];
    [ux, uz] = [-uz, ux];
  }
  return { pts, layer, dist, mx, mz, ux, uz, length, width, l1: tr / 2 + gap, l2: Math.max(0, tr / 2 - gap) };
}

/**
 * **분류기의 입력** — 군집 하나에서 뽑는 특징 열여덟. 센서가 아는 것(점의 자리 · 층 · 거리)만 쓴다.
 *
 *  - 크기: 점 수(로그) · 거리 · 길이 · 폭 · 길쭉함(1 − 작은/큰 고윳값)
 *  - 높이: 맞은 가장 높은 · 낮은 층의 높이, 맞은 층 수, **층마다의 폭**과 맞았는지 — 옆에서 본 자전거는 아래층(바퀴 · 차체)이
 *    넓고 맨 위층(사람 머리)이 좁다. 나란히 선 사람들은 층마다 폭이 같다. 차는 위 두 층이 비어 있다.
 *  - 깊이: 센서 쪽으로 잰 두께, 맨 위층과 맨 아래층의 평균 거리 차 — 앞에서 본 자전거는 아래층(바퀴)이 가깝고 위층(사람)이 멀다
 */
export const LIDAR_FEATURES = [
  'logN',
  'range',
  'length',
  'width',
  'linear',
  'top',
  'bottom',
  'layers',
  'span0',
  'span1',
  'span2',
  'span3',
  'has0',
  'has1',
  'has2',
  'has3',
  'depth',
  'tilt',
] as const;

export function clusterFeatures(scan: LidarScan, geo: ClusterGeometry): number[] {
  const nl = scan.layers.length;
  const span = new Array<number>(nl).fill(0);
  const has = new Array<number>(nl).fill(0);
  const sumD = new Array<number>(nl).fill(0);
  const cnt = new Array<number>(nl).fill(0);
  const lo = new Array<number>(nl).fill(Infinity);
  const hi = new Array<number>(nl).fill(-Infinity);
  geo.pts.forEach((p, i) => {
    const l = geo.layer[i];
    const t = p.x * geo.ux + p.z * geo.uz;
    lo[l] = Math.min(lo[l], t);
    hi[l] = Math.max(hi[l], t);
    has[l] = 1;
    sumD[l] += geo.dist[i];
    cnt[l] += 1;
  });
  for (let l = 0; l < nl; l += 1) if (has[l]) span[l] = hi[l] - lo[l];
  const hit = has.map((h, l) => (h ? l : -1)).filter((l) => l >= 0);
  const topL = hit[hit.length - 1];
  const botL = hit[0];
  const dMin = Math.min(...geo.dist);
  const dMax = Math.max(...geo.dist);
  return [
    Math.log(geo.pts.length),
    Math.hypot(geo.mx - scan.ox, geo.mz - scan.oz),
    geo.length,
    geo.width,
    geo.l1 > 0 ? 1 - geo.l2 / geo.l1 : 0,
    scan.layers[topL],
    scan.layers[botL],
    hit.length,
    ...span,
    ...has,
    dMax - dMin,
    sumD[topL] / cnt[topL] - sumD[botL] / cnt[botL],
  ];
}

/**
 * **학습한 분류기** — 두 가지 꼴을 읽는다. 둘 다 표준화한 특징(`(x − mean) / std`)을 받아 갈래마다의 확률을 낸다.
 *
 *  - `softmax` — 다항 로지스틱 회귀. 갈래마다 가중치 한 줄이라 무엇을 보고 가르는지 바로 읽힌다 (비교 기준).
 *  - `mlp` — 은닉층 하나(tanh)의 작은 신경망. 특징끼리의 조합(예: 짧은데 위층이 빈 것)을 배워 자전거 조각을 더 잘 가린다.
 *    배포하는 것은 이쪽이다 (scripts/train-lidar.ts 가 셋을 견준 결과).
 */
interface ModelBase {
  /** 특징 이름 — `mean` · `std` · 첫 가중치의 열 차례 */
  names: readonly string[];
  /** 갈래 — 출력 차례 */
  classes: readonly string[];
  mean: readonly number[];
  std: readonly number[];
  /** 학습 정보 — 화면에는 안 나가고 장표 · 테스트가 읽는다 */
  meta: {
    trained: boolean;
    samples?: number;
    accuracy?: number;
    ruleAccuracy?: number;
    date?: string;
    [k: string]: unknown;
  };
}
export interface SoftmaxModel extends ModelBase {
  kind: 'softmax';
  W: ReadonlyArray<readonly number[]>;
  b: readonly number[];
}
export interface MlpModel extends ModelBase {
  kind: 'mlp';
  /** 은닉층 (은닉 수 × 특징 수) · 출력층 (갈래 수 × 은닉 수) */
  W1: ReadonlyArray<readonly number[]>;
  b1: readonly number[];
  W2: ReadonlyArray<readonly number[]>;
  b2: readonly number[];
}
export type LidarModel = SoftmaxModel | MlpModel;

const MODEL = trained as unknown as LidarModel;

/** 차보다 높은 층(1.8m)에 맞으면 '키 큰 것' — 사람이나 자전거다 */
const TALL_LAYER = 1.5;
/** 어른은 맨 위층(2.6m)까지 닿는다 */
const ADULT_LAYER = 2.3;
/** 키가 큰데 이보다 길면 자전거 (m) — 사람은 0.9m 남짓, 자전거는 옆에서 보면 3m 를 넘는다 */
const BIKE_LENGTH = 2.4;

/**
 * **손으로 정한 규칙** — 처음 만든 분류기다. 학습한 분류기의 비교 기준이고, 모델이 학습 전이면 이것을 쓴다.
 * 키(맨 위로 맞은 층)로 차와 나머지를, 길이로 자전거와 사람을, 다시 키로 어른과 어린이를 가른다.
 */
export function ruleClass(geo: ClusterGeometry): ObjectClass {
  let top = 0;
  for (const p of geo.pts) top = Math.max(top, p.y);
  if (top < TALL_LAYER) return geo.length >= 1.0 ? 'car' : 'unknown';
  if (geo.length >= BIKE_LENGTH) return 'bike';
  return top >= ADULT_LAYER ? 'adult' : 'child';
}

/** 특징 → 갈래마다의 확률 (모델의 갈래 차례) */
export function classProbs(x: readonly number[], model: LidarModel = MODEL): number[] {
  const z = x.map((v, j) => (v - model.mean[j]) / (model.std[j] || 1));
  const dot = (row: readonly number[], v: readonly number[], bias: number): number => {
    let sum = bias;
    for (let j = 0; j < row.length; j += 1) sum += row[j] * v[j];
    return sum;
  };
  let logits: number[];
  if (model.kind === 'mlp') {
    const h = model.W1.map((row, i) => Math.tanh(dot(row, z, model.b1[i])));
    logits = model.W2.map((row, k) => dot(row, h, model.b2[k]));
  } else {
    logits = model.W.map((row, k) => dot(row, z, model.b[k]));
  }
  const m = Math.max(...logits);
  const e = logits.map((v) => Math.exp(v - m));
  const sum = e.reduce((a, c) => a + c, 0);
  return e.map((v) => v / sum);
}

/** 군집 하나의 갈래 — 학습한 분류기가 있으면 그것, 없으면 규칙 */
export function classify(
  scan: LidarScan,
  geo: ClusterGeometry,
  model: LidarModel = MODEL,
): { cls: ObjectClass; probs: Partial<Record<ObjectClass, number>> | null } {
  if (!model.meta.trained) return { cls: ruleClass(geo), probs: null };
  const p = classProbs(clusterFeatures(scan, geo), model);
  const probs: Partial<Record<ObjectClass, number>> = {};
  model.classes.forEach((c, k) => (probs[c as ObjectClass] = p[k]));
  let best = 0;
  for (let k = 1; k < p.length; k += 1) if (p[k] > p[best]) best = k;
  return { cls: model.classes[best] as ObjectClass, probs };
}

/** 군집 하나 → 물체 하나 (크기 · 방향 · 갈래 · 중심) */
export function describe(scan: LidarScan, cells: readonly number[], model: LidarModel = MODEL): Detection {
  const geo = clusterGeometry(scan, cells);
  const { pts, mx, mz, length, width } = geo;
  let top = 0;
  for (const p of pts) top = Math.max(top, p.y);
  const { cls, probs } = classify(scan, geo, model);

  if (cls === 'car') return describeCar(scan, geo, top, probs);

  // 긴 축의 방향 — 게임의 yaw 약속(앞 = −sin, −cos)으로
  const yaw = Math.atan2(-geo.ux, -geo.uz);

  /*
    **보이는 면만 맞았으므로 중심은 그보다 뒤에 있다.** 센서에서 군집 쪽으로 가장 가까운 점까지 잰 뒤, 그 방향으로
    본래 크기의 절반만큼 더 들어간 자리를 중심으로 본다. 옆으로는 보이는 점들의 가운데를 쓴다.
  */
  const size = CLASS_SIZE[cls];
  const fullL = Math.max(length, size.length);
  const fullW = Math.max(width, size.width);
  const sx0 = mx - scan.ox;
  const sz0 = mz - scan.oz;
  const sd = Math.hypot(sx0, sz0) || 1;
  const sx = sx0 / sd;
  const sz = sz0 / sd;
  let near = Infinity;
  let pLo = Infinity;
  let pHi = -Infinity;
  for (const p of pts) {
    const ax = p.x - scan.ox;
    const az = p.z - scan.oz;
    near = Math.min(near, ax * sx + az * sz);
    const side = ax * -sz + az * sx;
    pLo = Math.min(pLo, side);
    pHi = Math.max(pHi, side);
  }
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  // 사람은 원기둥이라 어느 쪽에서 봐도 반지름만큼, 차 · 자전거는 상자라 보는 방향에 따라 다르다
  const round = cls === 'adult' || cls === 'child' || cls === 'unknown';
  const halfAlong = round
    ? fullW / 2
    : (fullL / 2) * Math.abs(fx * sx + fz * sz) + (fullW / 2) * Math.abs(-fz * sx + fx * sz);
  const depth = near + halfAlong;
  const side = (pLo + pHi) / 2;

  return {
    x: scan.ox + sx * depth - sz * side,
    z: scan.oz + sz * depth + sx * side,
    length: fullL,
    width: fullW,
    yaw,
    height: top,
    cls,
    ...(probs ? { probs } : {}),
    points: pts.length,
  };
}

/** 축 방향 각(월드 x 에서 z 쪽) → 게임의 yaw (그 축을 앞으로 보는) */
const axisToYaw = (a: number): number => Math.atan2(-Math.cos(a), -Math.sin(a));
/** 두 yaw 가 앞뒤를 가리지 않고 얼마나 다른가 (0 ~ π/2) */
const axisGap = (a: number, b: number): number => {
  const d = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  return Math.min(d, Math.PI - d);
};

/**
 * **L 자 맞춤** (Zhang et al., 2017 의 닫힘 기준) — 차를 비스듬히 보면 점이 뒷면과 옆면, 두 직선으로 꺾여 찍힌다.
 * 방향을 2° 씩 돌려 가며, 점마다 직사각형의 가까운 변까지의 거리가 작을수록(변에 붙을수록) 점수를 크게 주어 가장 잘
 * 맞는 방향을 고른다. 주성분 분석은 L 자의 두 팔 길이에 끌려 비스듬한 방향을 내지만, 이것은 모서리 방향을 그대로 낸다.
 */
export function lShapeAngle(pts: ReadonlyArray<readonly [number, number]>): number {
  let best = 0;
  let bestScore = -Infinity;
  const a = new Float64Array(pts.length);
  const b = new Float64Array(pts.length);
  for (let k = 0; k < 45; k += 1) {
    const th = (k / 45) * (Math.PI / 2);
    const c = Math.cos(th);
    const s = Math.sin(th);
    let aLo = Infinity;
    let aHi = -Infinity;
    let bLo = Infinity;
    let bHi = -Infinity;
    pts.forEach(([x, z], i) => {
      a[i] = x * c + z * s;
      b[i] = -x * s + z * c;
      aLo = Math.min(aLo, a[i]);
      aHi = Math.max(aHi, a[i]);
      bLo = Math.min(bLo, b[i]);
      bHi = Math.max(bHi, b[i]);
    });
    let score = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const da = Math.min(aHi - a[i], a[i] - aLo);
      const db = Math.min(bHi - b[i], b[i] - bLo);
      score += 1 / Math.max(Math.min(da, db), 0.05);
    }
    if (score > bestScore) {
      bestScore = score;
      best = th;
    }
  }
  return best;
}

/** L 자의 두 축(θ, θ+π/2) 가운데 기준 방향에 가까운 쪽을 차의 앞뒤 축으로 — 그 yaw */
export function axisYaw(theta: number, ref: number): number {
  const y1 = axisToYaw(theta);
  const y2 = axisToYaw(theta + Math.PI / 2);
  return axisGap(y1, ref) <= axisGap(y2, ref) ? y1 : y2;
}

/**
 * **보이는 모서리에 차 크기의 상자를 맞춘다** — 센서는 차의 가까운 면만 맞히므로, 축마다 점이 차 크기만큼 펼쳐져 있지 않으면
 * 센서 쪽 끝을 상자의 변으로 두고 반대쪽으로 크기만큼 채운다. 센서가 그 축의 점들 사이에 있으면(바로 옆에서 본 옆면)
 * 가운데를 쓴다. 예전처럼 '가장 가까운 점 + 반 크기' 로 시선 방향으로만 밀면, 비스듬한 차의 중심이 옆으로 1~2m 비켜났다.
 */
export function anchorBox(fit: CarFit, yaw: number, length: number, width: number): { x: number; z: number } {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  let aLo = Infinity;
  let aHi = -Infinity;
  let bLo = Infinity;
  let bHi = -Infinity;
  for (const [x, z] of fit.pts) {
    const a = x * fx + z * fz;
    const b = x * rx + z * rz;
    aLo = Math.min(aLo, a);
    aHi = Math.max(aHi, a);
    bLo = Math.min(bLo, b);
    bHi = Math.max(bHi, b);
  }
  const along = (lo: number, hi: number, full: number): number =>
    hi - lo >= full ? (lo + hi) / 2 : lo >= 0 ? lo + full / 2 : hi <= 0 ? hi - full / 2 : (lo + hi) / 2;
  const ca = along(aLo, aHi, length);
  const cb = along(bLo, bHi, width);
  return { x: fit.ox + fx * ca + rx * cb, z: fit.oz + fz * ca + rz * cb };
}

/**
 * 차 하나 — L 자 맞춤으로 방향을 잡고 보이는 모서리에 상자를 맞춘다.
 *
 * 한 면만 보이면(보이는 길이가 2.2m 안쪽) 그 면이 앞뒤 면인지 옆면인지 점만으로는 모른다 — 시선과 나란한 축을 차의 앞뒤로
 * 본다(앞차 · 뒤차는 뒷면 · 앞면을 보인다). 이 판단이 바퀴마다 뒤집히면 차가 90° 돌며 순간이동하므로, 추적이 붙은 뒤에는
 * 추적의 방향을 이어 쓴다 (Tracker 의 update).
 */
function describeCar(
  scan: LidarScan,
  geo: ClusterGeometry,
  top: number,
  probs: Partial<Record<ObjectClass, number>> | null,
): Detection {
  const pts: Array<[number, number]> = geo.pts.map((p) => [p.x - scan.ox, p.z - scan.oz]);
  const theta = lShapeAngle(pts);
  const extent = (a: number): number => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, z] of pts) {
      const t = x * c + z * s;
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    return hi - lo;
  };
  const e1 = extent(theta);
  const e2 = extent(theta + Math.PI / 2);
  let axis: number;
  if (Math.max(e1, e2) >= 2.2) {
    axis = e1 >= e2 ? theta : theta + Math.PI / 2;
  } else {
    // 시선과 나란한 축을 앞뒤로
    const los = Math.atan2(geo.mz - scan.oz, geo.mx - scan.ox);
    axis = Math.abs(Math.cos(theta - los)) >= Math.abs(Math.cos(theta + Math.PI / 2 - los)) ? theta : theta + Math.PI / 2;
  }
  const along = axis === theta ? e1 : e2;
  const across = axis === theta ? e2 : e1;
  const size = CLASS_SIZE.car;
  const length = Math.max(along, size.length);
  const width = Math.max(across, size.width);
  const fit: CarFit = { pts, ox: scan.ox, oz: scan.oz, theta };
  const yaw = axisToYaw(axis);
  const c = anchorBox(fit, yaw, length, width);
  return {
    x: c.x,
    z: c.z,
    length,
    width,
    yaw,
    height: top,
    cls: 'car',
    ...(probs ? { probs } : {}),
    points: geo.pts.length,
    fit,
  };
}

/** 낮은 조각끼리 이만큼 안에 있으면 한 차다 (m) — 비스듬히 본 옆면은 점 간격이 벌어져 몇 조각으로 끊긴다 */
const CAR_MERGE = 1.3;

/**
 * **차 조각 합치기** — 맨 위로 맞은 층이 1.0m 이하인 군집(차 높이)끼리, 점 사이가 1.3m 안이면 한 군집으로 묶는다.
 *
 * 비스듬히 본 차는 뒷면과 옆면이 각도 기준(β)에서 끊기고, 먼 옆면은 줄 간격이 벌어져 조각난다. 조각마다 차로 세면 한 차가
 * 둘 · 셋으로 복제되었다 (사용자가 짚었다: "라이다에 나타나는 차가 갑자기 복제가 되고 순간이동을 하는등"). 사람 · 자전거는
 * 위층(1.8m)까지 맞으므로 여기에 끼지 않는다 — 차 옆에 선 사람이 차에 먹히면 안 된다. 진출로에 줄 선 차들은 사이가
 * 1.5m 를 넘어 갈라진다.
 */
function mergeLowClusters(scan: LidarScan, clusters: number[][]): number[][] {
  const low = clusters.map((cells) => cells.every((c) => Math.floor(c / scan.rays) <= 1));
  const pts = clusters.map((cells) => cells.map((c) => cellPoint(scan, c)));
  const boxes = pts.map((ps) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of ps) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    return { x0, x1, z0, z1 };
  });
  const parent = clusters.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < clusters.length; i += 1) {
    if (!low[i]) continue;
    for (let j = i + 1; j < clusters.length; j += 1) {
      if (!low[j]) continue;
      const a = boxes[i];
      const b = boxes[j];
      // 감싸는 네모끼리도 멀면 볼 것 없다
      if (a.x0 - b.x1 > CAR_MERGE || b.x0 - a.x1 > CAR_MERGE || a.z0 - b.z1 > CAR_MERGE || b.z0 - a.z1 > CAR_MERGE) continue;
      let near = false;
      for (const p of pts[i]) {
        for (const q of pts[j]) {
          if (Math.hypot(p.x - q.x, p.z - q.z) < CAR_MERGE) {
            near = true;
            break;
          }
        }
        if (near) break;
      }
      if (near) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  clusters.forEach((cells, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), ...cells]);
  });
  return [...groups.values()];
}

/**
 * 차 높이 군집은 이보다 점이 적으면 버린다 — 진출로에 줄 선 차를 거의 나란히 볼 때(우회전을 마치며) 레이저가 그 옆면을 스치듯
 * 지나 2점짜리 조각이 1.5~2m 간격으로 늘어서는데, 조각마다 차 크기 상자를 맞추면 유령 차가 줄줄이 생겼다. 진짜 차는 50m 에서도
 * 폭(1.5m)에 줄 서너 개 × 두 층이 걸려 6~8점이다. 사람 · 자전거(키 큰 것)는 그대로 2점부터 받는다.
 */
const CAR_MIN_POINTS = 4;

/**
 * **물체 단위의 군집** — 군집화 → 차 조각 합치기 → 성긴 차 조각 버리기. 인지(detect)와 분류기 학습 데이터(ai/lidarScenes.ts)가
 * 같은 과정을 거쳐야 학습한 군집과 실제로 가리는 군집이 같은 모양이다.
 */
export function objectClusters(scan: LidarScan): number[][] {
  return mergeLowClusters(scan, segment(scan)).filter(
    (cells) => cells.length >= CAR_MIN_POINTS || cells.some((c) => Math.floor(c / scan.rays) > 1),
  );
}

/** 한 바퀴 → 물체들 */
export function detect(scan: LidarScan, model: LidarModel = MODEL): Detection[] {
  return objectClusters(scan).map((cells) => describe(scan, cells, model));
}

// ── 3. 추적 ────────────────────────────────────────────────────────────────

/** 알파-베타 필터의 이득 — 자리는 재 본 값 쪽으로 절반 넘게, 속도는 천천히 */
const ALPHA = 0.55;
const BETA = 0.2;
/** 예측 자리에서 이만큼 안에 들어온 물체만 같은 것으로 잇는다 (m) — 차는 크고 빨라 넉넉히 */
const GATE = 2.6;
const CAR_GATE = 3.6;
/** 이만큼 안 보이면 지운다 (초) */
const COAST = 0.6;
/** 사람이 이보다 빠르면 자전거다 (m/s) — 게임의 걸음은 실물의 세 배라 4m/s 언저리다 (pedWalk.ts 의 WALK_SPEED_SCALE) */
const BIKE_SPEED = 5;

export class Tracker {
  private tracks: Track[] = [];
  private votes = new Map<number, Partial<Record<ObjectClass, number>>>();
  private nextId = 1;
  private lastT: number | null = null;

  /** 확정된 물체 (두 번 이상 이어진 것) */
  get confirmed(): Track[] {
    return this.tracks.filter((t) => t.confirmed);
  }

  /** 한 바퀴의 물체로 갱신한다 */
  update(dets: readonly Detection[], t: number): Track[] {
    const dt = this.lastT === null ? 0 : Math.max(1e-3, t - this.lastT);
    this.lastT = t;

    // 예측 — 지난 속도 그대로 dt 만큼
    const pred = this.tracks.map((tr) => ({ x: tr.x + tr.vx * dt, z: tr.z + tr.vz * dt }));

    // 가까운 짝부터 잇는다 (탐욕 연결)
    const pairs: Array<{ ti: number; di: number; d: number }> = [];
    pred.forEach((p, ti) => {
      const gate = this.tracks[ti].cls === 'car' ? CAR_GATE : GATE;
      dets.forEach((det, di) => {
        const d = Math.hypot(det.x - p.x, det.z - p.z);
        if (d < gate) pairs.push({ ti, di, d });
      });
    });
    pairs.sort((a, b) => a.d - b.d);
    const usedT = new Set<number>();
    const usedD = new Set<number>();
    for (const { ti, di } of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      usedT.add(ti);
      usedD.add(di);
      const tr = this.tracks[ti];
      const det = dets[di];
      /*
        **차는 추적의 방향 · 크기로 중심을 다시 잡는다.** 한 바퀴의 L 자 맞춤은 앞뒤 축을 90° 잘못 고를 수 있는데(한 면만
        보일 때), 그대로 쓰면 차가 돌며 중심이 1~2m 튄다. 세 번 넘게 이어진 차는 지금까지의 방향(움직이면 속도 방향)에
        가까운 축을 고르고, 지금까지 잰 크기의 상자를 보이는 모서리에 맞춘다.
      */
      let mx = det.x;
      let mz = det.z;
      let myaw = det.yaw;
      if (det.fit && tr.cls === 'car' && tr.hits >= 3) {
        const speed = Math.hypot(tr.vx, tr.vz);
        myaw = axisYaw(det.fit.theta, speed > 1.5 ? Math.atan2(-tr.vx, -tr.vz) : tr.yaw);
        const c = anchorBox(det.fit, myaw, Math.max(tr.length, det.length), Math.max(tr.width, det.width));
        mx = c.x;
        mz = c.z;
      }
      const rx = mx - pred[ti].x;
      const rz = mz - pred[ti].z;
      if (tr.hits === 1 && dt > 0) {
        /*
          **두 번째로 잡히면 속도를 두 자리의 차로 바로 잡는다** (두 점 초기화). 속도 0 에서 출발해 필터로 천천히 따라가면
          40km/h 로 가로지르는 차가 처음 몇 바퀴 뒤처졌다가 한꺼번에 따라붙어 화면에서 튀었다.
        */
        tr.vx = (mx - tr.x) / dt;
        tr.vz = (mz - tr.z) / dt;
        tr.x = mx;
        tr.z = mz;
      } else {
        /*
          **차는 순간이동하지 않는다** — 잘 따라온 차(네 번 넘게)의 측정이 예측에서 1.2m 넘게 벗어나면 측정을 덜 믿는다
          (자리는 조금만 당기고 속도는 그대로). 앞을 지나는 다른 차에 반쯤 가리면 보이는 끝이 차의 끝이 아니라 가린 경계라,
          거기에 상자를 맞춘 중심이 1~2m 밀린다 — 그대로 따라가면 화면의 차가 튀었다 돌아온다.
        */
        const doubtful = tr.cls === 'car' && tr.hits >= 4 && Math.hypot(rx, rz) > 1.2;
        const alpha = doubtful ? 0.2 : ALPHA;
        const beta = doubtful ? 0 : BETA;
        tr.x = pred[ti].x + alpha * rx;
        tr.z = pred[ti].z + alpha * rz;
        if (dt > 0) {
          tr.vx += (beta / dt) * rx;
          tr.vz += (beta / dt) * rz;
        }
      }
      tr.length += 0.3 * (det.length - tr.length);
      tr.width += 0.3 * (det.width - tr.width);
      tr.height = Math.max(tr.height * 0.9, det.height);
      tr.hits += 1;
      tr.lastSeen = t;
      tr.confirmed = tr.hits >= 2;
      this.vote(tr, det);
      tr.yaw = this.heading(tr, myaw);
    }

    // 못 이은 물체는 예측 자리로 미끄러지다가, 오래 안 보이면 지운다
    this.tracks.forEach((tr, ti) => {
      if (usedT.has(ti)) return;
      tr.x = pred[ti].x;
      tr.z = pred[ti].z;
    });
    this.tracks = this.tracks.filter((tr) => {
      const alive = t - tr.lastSeen <= COAST;
      if (!alive) this.votes.delete(tr.id);
      return alive;
    });

    /*
      **새로 나타난 것** — 단, 이미 따라가는 물체의 몸 안(테두리 0.4m 까지)에서 생긴 것은 그 물체의 **조각**이다.
      빗길에 몇 줄이 빠지면 긴 물체(자전거 · 차)의 끝이 떨어져 나와 작은 군집이 되는데, 그것을 새 물체로 세면
      자전거 한 대가 두 대로 보인다. 물체끼리는 몸이 겹칠 수 없으므로 버려도 놓치는 것이 없다.
    */
    /*
      조각은 **같은 종류의 몸** 안에서만 버린다 — 낮은 것(차 · 알 수 없음)은 차 안에서, 키 큰 것(사람 · 자전거)은 사람 · 자전거
      안에서. 차 상자 안에서 새로 잡힌 사람을 버리면 **앞차 뒤에서 튀어나오는 사람**을 놓친다 — 추정한 상자는 실제 차보다
      길 수 있다.
    */
    const lowKind = (c: ObjectClass): boolean => c === 'car' || c === 'unknown';
    const insideKnown = (det: Detection): boolean =>
      this.tracks.some((tr) => {
        if (lowKind(det.cls) !== lowKind(tr.cls)) return false;
        const margin = tr.cls === 'car' ? 0.8 : 0.4;
        const fx = -Math.sin(tr.yaw);
        const fz = -Math.cos(tr.yaw);
        const dx = det.x - tr.x;
        const dz = det.z - tr.z;
        return (
          Math.abs(dx * fx + dz * fz) < tr.length / 2 + margin && Math.abs(dx * -fz + dz * fx) < tr.width / 2 + margin
        );
      });
    dets.forEach((det, di) => {
      if (usedD.has(di) || insideKnown(det)) return;
      const tr: Track = {
        id: this.nextId++,
        x: det.x,
        z: det.z,
        vx: 0,
        vz: 0,
        yaw: det.yaw,
        length: det.length,
        width: det.width,
        height: det.height,
        cls: det.cls,
        hits: 1,
        lastSeen: t,
        confirmed: false,
      };
      this.tracks.push(tr);
      this.vote(tr, det);
    });

    this.dedupe();
    return this.tracks;
  }

  /**
   * **한 물체에 붙은 추적 둘을 하나로** — 차끼리는 중심이 2.2m(차 길이의 절반) 안, 사람 · 자전거끼리는 0.5m 안이면 같은
   * 물체로 보고 덜 이어진 쪽을 지운다. 차 상자 안에 든 '알 수 없음'(차 조각)도 지운다. 사람이 차 곁에 있는 것은 지우지 않는다.
   */
  private dedupe(): void {
    const gone = new Set<number>();
    const ts = this.tracks;
    for (let i = 0; i < ts.length; i += 1) {
      for (let j = i + 1; j < ts.length; j += 1) {
        const a = ts[i];
        const b = ts[j];
        if (gone.has(a.id) || gone.has(b.id)) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        const bothCar = a.cls === 'car' && b.cls === 'car';
        const bothTall = a.cls !== 'car' && a.cls !== 'unknown' && b.cls !== 'car' && b.cls !== 'unknown';
        const carAndScrap =
          (a.cls === 'car' && b.cls === 'unknown') || (a.cls === 'unknown' && b.cls === 'car');
        const same = bothCar ? d < 2.2 : bothTall ? d < 0.5 : carAndScrap ? d < 2.6 : false;
        if (!same) continue;
        // 차와 조각이면 조각을, 아니면 덜 이어진(같으면 나중에 생긴) 쪽을 지운다
        const loser = carAndScrap ? (a.cls === 'unknown' ? a : b) : a.hits > b.hits || (a.hits === b.hits && a.id < b.id) ? b : a;
        gone.add(loser.id);
      }
    }
    if (!gone.size) return;
    this.tracks = this.tracks.filter((t) => !gone.has(t.id));
    for (const id of gone) this.votes.delete(id);
  }

  /**
   * 갈래는 지금까지 받은 표의 합으로 정한다 — 한 바퀴의 잘못 본 것에 흔들리지 않게. 분류기가 확률을 냈으면 **확률을
   * 표로** 더한다(자신 없는 바퀴는 표가 약하다). 규칙으로 가렸으면 한 표다.
   */
  private vote(tr: Track, det: Detection): void {
    const v = this.votes.get(tr.id) ?? {};
    if (det.probs) {
      for (const [k, p] of Object.entries(det.probs) as Array<[ObjectClass, number]>) v[k] = (v[k] ?? 0) + p;
    } else {
      v[det.cls] = (v[det.cls] ?? 0) + 1;
    }
    this.votes.set(tr.id, v);
    let best: ObjectClass = det.cls;
    for (const [k, n] of Object.entries(v) as Array<[ObjectClass, number]>) {
      if (n > (v[best] ?? 0)) best = k;
    }
    // 키 큰 것이 걸음보다 훨씬 빠르면 자전거다 — 앞에서 보면 길이로는 사람과 못 가른다
    const speed = Math.hypot(tr.vx, tr.vz);
    if ((best === 'adult' || best === 'child') && speed > BIKE_SPEED && tr.hits >= 3) best = 'bike';
    tr.cls = best;
  }

  /**
   * 방향 — 움직이면 움직이는 쪽, 서 있으면 재 본 축을 천천히 따른다.
   *
   * 서 있는 차는 점만으로는 **앞뒤**를 모른다 — 뒤집혀 그려지면 붉은 등이 앞에 붙는다. 그때는 **지도**를 본다(우측통행):
   * 남북 도로의 동쪽(x > 0) 차로는 북쪽, 서쪽은 남쪽으로 가고, 동서 도로의 남쪽(z > 0)은 동쪽, 북쪽은 서쪽으로 간다.
   */
  private heading(tr: Track, measured: number): number {
    const speed = Math.hypot(tr.vx, tr.vz);
    let target = speed > 1.2 ? Math.atan2(-tr.vx, -tr.vz) : measured;
    if (speed <= 1.2 && tr.cls === 'car') {
      const northSouth = Math.abs(Math.cos(target)) >= Math.abs(Math.sin(target));
      const lane = northSouth ? (tr.x >= 0 ? 0 : Math.PI) : tr.z >= 0 ? -Math.PI / 2 : Math.PI / 2;
      if (Math.cos(target - lane) < 0) target += Math.PI;
    }
    let d = target - tr.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    // 사람 · 자전거의 긴 축은 앞뒤가 없다 — 지금 방향에서 가까운 쪽(±180°)을 고른다
    if (speed <= 1.2 && tr.cls !== 'car' && Math.abs(d) > Math.PI / 2) d -= Math.sign(d) * Math.PI;
    // 차가 처음 잡힐 때는 지도 방향으로 바로 돌려세운다 (천천히 돌면 반 바퀴 도는 차가 보인다)
    if (tr.cls === 'car' && tr.hits <= 2) return target;
    return tr.yaw + d * 0.35;
  }
}

// ── 4. 위험 평가 ───────────────────────────────────────────────────────────

/** 앞으로 달릴 길의 반폭 (m) — 차 폭의 절반(0.8)에 사람이 몸을 비킬 여유를 더한다 */
export const CORRIDOR_HALF = 2.4;
/** 이 안이면 길가에서 지켜볼 사람 (m) */
const WATCH_DISTANCE = 5.5;
/** 이만큼 뒤의 자리를 예측한다 (초) */
const PREDICT_SECONDS = 2;

/** 점에서 꺾은선까지의 거리 */
export function distanceToPath(x: number, z: number, path: ReadonlyArray<{ x: number; z: number }>): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t)));
  }
  return best;
}

/** LiDAR 가 잡은 사람에게 붙인 **보행자 횡단 의도 예측**(ai/intent.ts)의 짐작 */
export interface HazardGuess {
  /** AI 가 이 사람에게 양보하는가 (차도 위이거나, 신경망이 건너려 한다고 짐작했다) */
  yields: boolean;
  /** 2초 안에 차도에 들어설 확률 */
  enter: number;
  /** 그 사람이 선 횡단보도가 앞으로 달릴 길에 걸려 있는가 */
  onRoute: boolean;
}

/**
 * 그 물체가 **앞으로 달릴 길**에 대해 얼마나 문제인가.
 *
 *  - 사람 · 자전거가 길 위에 있으면 **위험**
 *  - 의도 예측이 붙었으면 — 내 길의 횡단보도에서 AI 가 양보하는 사람은 **위험**, 2초 안에 차도에 들어설 것 같으면(확률
 *    50% 넘게) **주의**. 길가에 붙어 있어도 **주의**
 *  - 짐작이 없으면(지도의 횡단보도 밖) 예전처럼 2초 뒤(등속 예측) 길 위에 있을 것 같거나 길가에 붙어 있으면 **주의**
 *  - 차가 길 위에 있으면 **앞차** (따라가는 대상)
 */
export function assessHazard(tr: Track, path: ReadonlyArray<{ x: number; z: number }>, guess?: HazardGuess): Hazard {
  if (path.length < 2) return 'none';
  const now = distanceToPath(tr.x, tr.z, path);
  if (tr.cls === 'car') return now < 1.8 ? 'lead' : 'none';
  if (tr.cls === 'unknown') return 'none';
  if (now < CORRIDOR_HALF) return 'danger';
  if (guess) {
    if (guess.onRoute && guess.yields) return 'danger';
    if ((guess.onRoute && guess.enter >= 0.5) || now < WATCH_DISTANCE) return 'caution';
    return 'none';
  }
  const later = distanceToPath(tr.x + tr.vx * PREDICT_SECONDS, tr.z + tr.vz * PREDICT_SECONDS, path);
  if (later < CORRIDOR_HALF || now < WATCH_DISTANCE) return 'caution';
  return 'none';
}
