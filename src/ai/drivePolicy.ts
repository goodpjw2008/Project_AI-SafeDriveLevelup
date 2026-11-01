/**
 * **주행 정책 신경망 — AI 자율주행의 핸들과 브레이크.**
 *
 * AI 자율주행(game/AutoDriver.ts)이 프레임마다 정하는 것 가운데 셋을 작은 신경망이 한다 (models/drive.json) — 사용자가 정했다
 * (2026-11-01: *"교통법규 준수 등 정말 어쩔수 없는경우는 프로그램으로 남기고 나머지는 모두 AI 기법으로"*).
 *
 *  1. **조향** (`steer`) — 앞으로 달릴 길의 점들(2~12m 앞 아홉)이 차에서 어디에 보이는가와 속도 · 축간거리를 보고
 *     핸들을 얼마나 감을지 낸다. 예전에는 순수 추종(pure pursuit)이라는 기하 공식이었다.
 *  2. **관문 앞 제동** (`gate`) — 서야 하는 관문(정지선 · 횡단보도)까지 남은 거리 · 속도 · 이 차의 제동력을 보고 지금 브레이크를
 *     밟을지 낸다. 예전에는 제동 거리 공식(v²/2a + 여유)이었다.
 *  3. **앞차 뒤 제동** (`lead`) — 앞차까지의 간격과 다가가는 빠르기를 보고 지금 밟을지 낸다.
 *
 * 남은 프로그램은 **내 자리 찾기**(길 위에서 가장 가까운 점 — 지도 위 내 위치)와 **관문의 차례**(정지선 다음 횡단보도)뿐이다 —
 * 판단이 아니라 지도 기록이다. 신호 · 정지선에서 설지는 신호 판단 신경망(ai/signalPolicy.ts), 보행자에게 양보할지는 의도 예측
 * 신경망(ai/intent.ts)이 정한다. 차가 실제로 서는 물리(game/Vehicle.ts)는 세계의 일이다.
 *
 * ## 어떻게 배웠고, 어떻게 믿는가
 *
 * 정답은 예전 공식이다 — scripts/train-drive.ts 가 길 둘레의 차 자리 · 속도 · 축간거리를 고르게 지어(시뮬레이터 없이) 공식의
 * 답을 붙이고 신경망이 따라 배운다. 제동 둘은 **늦게 밟는 일이 없도록** 공식보다 0.8m 이르게 배우게 하고, 나올 수 있는 값의
 * 촘촘한 격자 전부(거리 0.05m · 속도 0.25km/h · 제동력 0.1 간격)에서 ① 공식이 밟는 자리에서는 반드시 밟고 ② 공식보다 1.5m 넘게
 * 일찍 밟지 않음을 확인한다 (tests/drivePolicy.test.ts). 조향은 연속 값이라 전수로는 못 보고, 처음 보는 차 자리 20만 개에서
 * 공식과의 차이를 재고 22,818판 전수 검증(규정대로 · 1초 늦게 보는 사람 · 보행자 역할 — tests/library.validate.*)으로 실제 주행을
 * 확인한다. 학습한 모델이 없으면(처음 학습하기 전 · 입력이 바뀜) 예전 공식이 대신한다.
 */

import trained from './models/drive.json';

/** 조향이 보는 길의 점 — 차 앞범퍼가 아니라 내 자리(길 위 가장 가까운 점)에서 길을 따라 잰 거리 (m). 내다보는 거리(3~8m) 둘레는 촘촘히 */
export const STEER_ARCS = [2, 3, 4, 5, 6, 7, 8, 10, 12] as const;
/** 조향 최대각 (Vehicle 의 MAX_STEER 와 같아야 −1~1 로 정규화된다) */
export const MAX_STEER = 0.62;

export interface Point {
  x: number;
  z: number;
}
/** 차의 자리와 방향 — 방향은 Vehicle 과 같다 (yaw 0 이 −z 쪽) */
export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

const clip = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 지도 좌표의 점 → 차에서 본 자리 (오른쪽 +, 앞 +) */
function toCar(p: Point, car: Pose): { lateral: number; ahead: number } {
  const fx = -Math.sin(car.yaw);
  const fz = -Math.cos(car.yaw);
  const rx = Math.cos(car.yaw);
  const rz = -Math.sin(car.yaw);
  const dx = p.x - car.x;
  const dz = p.z - car.z;
  return { lateral: dx * rx + dz * rz, ahead: dx * fx + dz * fz };
}

/**
 * **예전 공식 — 순수 추종** (조향의 정답 · 모델이 없을 때). `path` 는 길 위의 내 자리(가장 가까운 점)부터의 점들이다. 내다보는
 * 거리(속도에 비례, 3~8m)만큼 길을 따라간 자리를 향해 자전거 모델로 감는다. 예전 AutoDriver.steer 는 그 거리를 넘는 **첫 길 점**을
 * 겨눴는데(점 사이 0.4~1m 만큼 계단이 진다), 신경망이 매끄러운 쪽을 더 정확히 배워서 길 위의 정확한 자리를 겨누게 했다.
 */
export function steerRule(path: readonly Point[], car: Pose, speedMs: number, wheelbase: number): number {
  const lookahead = Math.max(3, Math.min(8, 2.5 + speedMs * 0.6));
  const { lateral, ahead } = toCar(along(path, lookahead), car);
  const L = Math.max(1, Math.hypot(ahead, lateral));
  const curvature = (2 * lateral) / (L * L);
  const angle = Math.atan(wheelbase * curvature);
  return Math.max(-1, Math.min(1, angle / MAX_STEER));
}

/** 길을 따라 `arc` m 간 자리 — 점 사이는 곧게 잇는다 (넘치면 마지막 점) */
function along(path: readonly Point[], arc: number): Point {
  let walked = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const seg = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
    if (walked + seg >= arc) {
      const t = seg > 0 ? (arc - walked) / seg : 0;
      return { x: path[i].x + (path[i + 1].x - path[i].x) * t, z: path[i].z + (path[i + 1].z - path[i].z) * t };
    }
    walked += seg;
  }
  return path[path.length - 1];
}

/** 조향 신경망의 입력 — 길의 점 아홉이 차에서 보이는 자리(옆 · 앞, 10m 로 나눔) · 속도 · 축간거리 */
export const STEER_FEATURES: readonly string[] = [
  ...STEER_ARCS.flatMap((a) => [`lat${a}`, `ahead${a}`]),
  'speed',
  'wheelbase',
];

export function steerFeatures(path: readonly Point[], car: Pose, speedMs: number, wheelbase: number): number[] {
  const out: number[] = [];
  for (const a of STEER_ARCS) {
    const { lateral, ahead } = toCar(along(path, a), car);
    out.push(lateral / 10, ahead / 10);
  }
  // 배운 범위 — 속도 0~14m/s(50km/h) · 축간거리 2.0~3.2m
  out.push(clip(speedMs, 0, 14) / 10, clip(wheelbase, 2, 3.2) / 3);
  return out;
}

/** 예전 공식 — 관문 앞에서 지금 밟을까: 남은 거리가 이 속도로 서는 거리에 여유를 더한 것보다 짧으면 (예전 AutoDriver.holdAt) */
export const gateBrakeRule = (distance: number, speedKmh: number, decel: number): boolean => {
  const v = speedKmh / 3.6;
  return distance <= Math.max(3, (v * v) / (2 * decel) + 1.8);
};
/** 예전 공식 — 앞차 뒤에서 지금 밟을까: 간격이 다가가는 빠르기로 서는 거리에 2.5m 를 더한 것보다 짧으면 (예전 followStopGap) */
export const leadBrakeRule = (gap: number, closingKmh: number): boolean => {
  const v = closingKmh / 3.6;
  return gap < 2.5 + (v * v) / (2 * 4.8);
};

/** 은닉층 하나(tanh) · 출력 하나 */
export interface SmallNet {
  names: readonly string[];
  W1: ReadonlyArray<readonly number[]>;
  b1: readonly number[];
  w2: readonly number[];
  b2: number;
}

export interface DriveModel {
  kind: 'drive-mlp';
  /** 출력 tanh — −1~1 핸들 */
  steer: SmallNet;
  /** 출력 시그모이드 — 0.5 넘으면 밟는다. 입력: 거리 · 속도 · 제동력 */
  gate: SmallNet;
  /** 출력 시그모이드 — 입력: 간격 · 다가가는 빠르기 */
  lead: SmallNet;
  meta: { trained: boolean; [k: string]: unknown };
}

export const GATE_FEATURES: readonly string[] = ['distance', 'speed', 'decel'];
export const LEAD_FEATURES: readonly string[] = ['gap', 'closing'];
/**
 * 제동 입력 — 배운 범위로 자르고(거리 −5~40m · 속도 0~54km/h · 제동력 3.2~5m/s² · 간격 0~40m) 크기를 맞춘다. 범위 밖은 답이
 * 분명하다 — 40m 넘게 남았으면 어느 속도에서도 아직 밟을 때가 아니고(54km/h 에서 서는 거리가 35m), 넘어섰으면 선다.
 */
export const GATE_RANGE = { distance: [-5, 40], speed: [0, 54], decel: [3.2, 5] } as const;
export const LEAD_RANGE = { gap: [0, 40], closing: [0, 54] } as const;
export const gateInput = (distance: number, speedKmh: number, decel: number): number[] => [
  clip(distance, ...GATE_RANGE.distance) / 40,
  clip(speedKmh, ...GATE_RANGE.speed) / 50,
  clip(decel, ...GATE_RANGE.decel) / 5,
];
export const leadInput = (gap: number, closingKmh: number): number[] => [
  clip(gap, ...LEAD_RANGE.gap) / 40,
  clip(closingKmh, ...LEAD_RANGE.closing) / 50,
];

/** 은닉층의 합 — 출력 함수를 씌우기 전 */
export function netRaw(net: SmallNet, x: readonly number[]): number {
  let out = net.b2;
  for (let q = 0; q < net.W1.length; q += 1) {
    const row = net.W1[q];
    let s = net.b1[q];
    for (let j = 0; j < row.length; j += 1) s += row[j] * x[j];
    out += net.w2[q] * Math.tanh(s);
  }
  return out;
}

const MODEL = trained as unknown as DriveModel;

const same = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && a.every((n, i) => n === b[i]);
/** 학습한 모델이 있고 입력 이름이 지금 코드와 같은가 */
export const driveModelReady = (model: DriveModel = MODEL): boolean =>
  model.meta?.trained === true &&
  same(model.steer?.names, STEER_FEATURES) &&
  same(model.gate?.names, GATE_FEATURES) &&
  same(model.lead?.names, LEAD_FEATURES);

const READY = driveModelReady();

/** **핸들** — 신경망이 낸다 (모델이 없으면 예전 공식) */
export function steerPolicy(path: readonly Point[], car: Pose, speedMs: number, wheelbase: number, model: DriveModel = MODEL): number {
  if (model === MODEL ? !READY : !driveModelReady(model)) return steerRule(path, car, speedMs, wheelbase);
  return Math.max(-1, Math.min(1, Math.tanh(netRaw(model.steer, steerFeatures(path, car, speedMs, wheelbase)))));
}

/** **관문 앞 제동** — 신경망이 낸다 (모델이 없으면 예전 공식) */
export function gateBrake(distance: number, speedKmh: number, decel: number, model: DriveModel = MODEL): boolean {
  if (model === MODEL ? !READY : !driveModelReady(model)) return gateBrakeRule(distance, speedKmh, decel);
  return netRaw(model.gate, gateInput(distance, speedKmh, decel)) > 0;
}

/** **앞차 뒤 제동** — 신경망이 낸다 (모델이 없으면 예전 공식) */
export function leadBrake(gap: number, closingKmh: number, model: DriveModel = MODEL): boolean {
  if (model === MODEL ? !READY : !driveModelReady(model)) return leadBrakeRule(gap, closingKmh);
  return netRaw(model.lead, leadInput(gap, closingKmh)) > 0;
}
