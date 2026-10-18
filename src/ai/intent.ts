/**
 * **보행자 횡단 의도 예측 — 사람의 속을 읽지 않고, 보이는 것으로 짐작한다.**
 *
 * 도로교통법 제27조 제1항은 횡단보도를 "통행하고 있거나 **통행하려고 하는 때**" 의 보행자 앞에서 서라고 한다. 뒤의
 * 절반 — 건너려는 뜻 — 은 사람의 속에 있다. 게임 속 보행자는 그 뜻을 상태기계의 값(`intendsToCross`)으로 들고 있고,
 * 판정은 그 값으로 잰다. 예전의 AI 자율주행도 **그 값을 그대로 읽었다** — 사람 운전자는 할 수 없는 일이다.
 *
 * 이제 AI 는 그 값도, 게임 속 보행자의 자리도 보지 않는다. **LiDAR 가 찾은 사람만** 본다 — 센서(game/lidarSensor.ts)가
 * 1초에 열 바퀴 쏜 점구름을 인지(ai/perception.ts)가 군집으로 묶고, 신경망으로 사람 · 자전거를 가리고, 추적해 자리와
 * 속도를 잰 결과다(`perceivedPeople`). 그 사람마다 운전자가 보는 것과 같은 것을 본다.
 *
 *  - **선 자리** — 건널 사람은 연석까지 나와 서고, 아닌 사람은 한 걸음 물러서 있다 (game/pedBody.ts 의 WAIT_SETBACK)
 *  - **움직임** — 차도 쪽으로 다가오는가, 물러서는가, 언제부터 가만히 서 있는가 (최근 1초의 자취)
 *  - **보행신호** — 지금 무슨 색이고, 바뀐 지 얼마나 되었는가
 *  - **내 차** — 그 횡단보도까지 얼마나 남았고, 얼마나 빠른가
 *  - **LiDAR 가 잰 생김새** — 길이 · 폭 (자전거인지, 두 사람이 한 덩어리로 잡혔는지)
 *
 * LiDAR 가 못 본 사람(앞차에 가렸거나 분류기가 놓친 사람)은 AI 도 모른다. 그래서 시뮬레이터도 같은 LiDAR 를 돌려
 * 22,818판을 달려 본다.
 * 이 열일곱 가지를 **작은 신경망**(models/intent.json)이 받아 두 가지를 낸다.
 *
 *  1. **지금 양보할 사람인가** (`yield`) — 건너고 있거나 건너려 하는가. AI 자율주행이 이것으로 선다.
 *  2. **2초 안에 차도에 들어서는가** (`enter`) — LiDAR 화면의 위협 예측이 이것으로 미리 칠한다.
 *
 * 정답은 시뮬레이터가 안다 — 판마다 LiDAR 가 찾은 사람을 실제 보행자와 짝지어, 그 사람의 실제 속(뜻)과 실제로 일어난
 * 미래(2초 뒤 차도에 있었는가)를 기록해 지도학습한다 (scripts/train-intent.ts). 센서가 재는 자리의 흔들림 · 늦음까지 그대로
 * 배운다. 사람이 이름표를 달 필요가 없다.
 *
 * ## 신경망 + 규칙 안전장치
 *
 * 이미 **차도 위에 있는 사람**은 짐작할 것이 없다 — LiDAR 가 잰 자리가 연석선을 넘어 있으면 신경망과 상관없이 양보한다
 * (`onRoadway`). 신경망이 맡는 것은 보도 위에 선 사람의 속, 곧 규칙으로는 알 수 없는 부분이다. 학습한 모델이
 * 틀릴 수 있는 곳에 규칙이 받쳐 주는 것 — AI 안전에서 말하는 안전 실드다.
 *
 * 순수 모듈이다 — 게임(Game.ts)과 시뮬레이터(scenarios/playSim.ts)가 같은 것을 돌린다. 시뮬레이터는 22,818판 전부를
 * 이 판단으로 달려 본다 (tests/library.validate.*).
 */

import { pedAcross, crosswalkCenter } from '../game/pedBody';
import { CURB } from '../game/pedWalk';
import { LIDAR } from '../game/lidarSensor';
import type { CrosswalkId, PedSignal } from '../rules/lawRules';
import type { Track } from './perception';
import { crosswalkDistance } from './telemetry';
import trained from './models/intent.json';

/** 판단하는 횟수 (Hz) — LiDAR 가 한 바퀴 도는 것과 같다 */
export const INTENT_HZ = LIDAR.hz;
/** 이 거리 안의 사람만 본다 (m) — LiDAR 가 재는 거리 */
export const INTENT_RANGE = LIDAR.range;
/** 자취를 이만큼 기억한다 (초) */
const HISTORY_SECONDS = 1.2;
/** 이보다 빠르면 '움직이는 중' (m/s) — 한 걸음 나서는 것은 0.8m / 0.55초 ≒ 1.5m/s */
const MOVING_SPEED = 0.5;
/** 몸이 연석선을 이만큼 넘으면 차도 위다 (m) */
const ROADWAY_MARGIN = 0.05;

/**
 * 신경망의 입력 — 사람마다 열일곱. **센서와 지도로 알 수 있는 것만** 쓴다 (보행자의 속 · 상태기계의 값은 없다).
 *
 *  - `edge` 연석선에서 보도 쪽으로 떨어진 거리 (m, 차도 위면 음수) — 나와 선 사람 0, 물러선 사람 0.8
 *  - `vin` · `vinPast` 차도 한가운데 쪽으로 다가오는 빠르기 — 최근 0.3초 · 그 전 0.7초 (m/s, 물러서면 음수)
 *  - `moved` 최근 1초에 건너는 축으로 움직인 거리 (m) · `speed` 최근 0.3초의 빠르기 (m/s)
 *  - `still` 마지막으로 움직인 뒤 가만히 선 시간 (초) · `age` 본 지 얼마나 되었는가 (초) — 막 보이기 시작한 사람은 자취가 짧다
 *  - `sigGreen` · `sigFlash` · `sigRed` · `sigNone` 그 횡단보도의 보행신호 · `sigAge` 그 등화가 켜진 지 얼마나 되었는가 (초)
 *  - `carDist` 내 차 앞범퍼에서 그 횡단보도까지 (m) · `carSpeed` 내 차 속도 (m/s)
 *  - `ride` 자전거를 타고 있는가 — 타고 건너면 걸음보다 빠르다
 *  - `length` · `width` LiDAR 가 잰 물체의 길이 · 폭 (m) — 자전거인지, 붙어 선 두 사람이 한 덩어리로 잡혔는지가 드러난다.
 *    그런 덩어리는 가운데 자리가 사람의 자리와 어긋나므로, 신경망이 선 자리를 얼마나 믿을지 함께 배운다
 */
export const INTENT_FEATURES = [
  'edge',
  'vin',
  'vinPast',
  'moved',
  'speed',
  'still',
  'age',
  'sigGreen',
  'sigFlash',
  'sigRed',
  'sigNone',
  'sigAge',
  'carDist',
  'carSpeed',
  'ride',
  'length',
  'width',
] as const;

/** 신경망의 출력 — 차례대로 */
export const INTENT_OUTPUTS = ['yield', 'enter'] as const;

/** 한 사람의 관측 — LiDAR 추적이 잰 자리 · 생김새와 지도에서 안 횡단보도 */
export interface PedObservation {
  /** 같은 사람을 이어 보는 번호 */
  id: number;
  /** 그 사람이 선 횡단보도 — 지도에서 자리로 안다 */
  crosswalk: CrosswalkId;
  x: number;
  z: number;
  /** 자전거를 타고 있는가 (LiDAR 분류기가 '자전거' 로 가린다) */
  bike?: 'ride' | 'push';
  /** LiDAR 가 잰 길이 · 폭 (m) */
  length: number;
  width: number;
}

/** 사람 말고 보는 것 — 보행신호와 내 차 */
export interface IntentContext {
  pedSignal: Readonly<Record<CrosswalkId, PedSignal | null>>;
  front: { x: number; z: number };
  speedKmh: number;
}

/** 한 사람에 대한 짐작 */
export interface IntentEstimate {
  /** 지금 양보할 사람일 확률 (건너고 있거나 건너려 한다) */
  yield: number;
  /** 2초 안에 차도에 들어설 확률 */
  enter: number;
  /** 몸이 이미 차도 위에 있는가 — 규칙 안전장치 */
  onRoadway: boolean;
  /** AI 가 이 사람에게 양보하는가 — 차도 위이거나, 신경망이 문턱을 넘었다 */
  yields: boolean;
  /** 그 사람이 선 횡단보도 · LiDAR 가 잰 자리 */
  crosswalk: CrosswalkId;
  x: number;
  z: number;
  /** 이 사람이 건너는 축 위의 자리 (지도 좌표) · 차도 한가운데 쪽 방향 (+1 / −1) — 화면이 예측 경로를 그린다 */
  axis: number;
  inward: 1 | -1;
}

/** 학습한 모델 — 은닉층 하나(tanh), 출력마다 시그모이드 */
export interface IntentModel {
  kind: 'intent-mlp';
  names: readonly string[];
  outputs: readonly string[];
  mean: readonly number[];
  std: readonly number[];
  W1: ReadonlyArray<readonly number[]>;
  b1: readonly number[];
  W2: ReadonlyArray<readonly number[]>;
  b2: readonly number[];
  /** `yield` 가 이 값을 넘으면 양보한다 — 놓치는 쪽이 비싸므로 0.5 보다 낮게 잡는다 (train-intent.ts) */
  threshold: number;
  meta: { trained: boolean; [k: string]: unknown };
}

const MODEL = trained as unknown as IntentModel;

/** 학습한 모델이 있는가 — 없으면(처음 학습하기 전) AI 는 예전처럼 판정과 같은 값을 본다 */
export const intentModelReady = (model: IntentModel = MODEL): boolean => model.meta.trained === true;

/** 건너는 축의 좌표 — S · A · B 는 남북 도로를 가로질러 x, C 는 동서 도로를 가로질러 z */
export const crosswalkAxis = (id: CrosswalkId, x: number, z: number): number => (id === 'C' ? z : x);

/** 몸이 차도 위에 있는가 — 연석선(CURB)을 넘어 들어와 있다 */
export const onRoadway = (id: CrosswalkId, x: number, z: number): boolean =>
  Math.abs(crosswalkAxis(id, x, z)) < CURB - ROADWAY_MARGIN;

/** 특징 → 출력마다의 확률 */
export function intentProbs(x: readonly number[], model: IntentModel = MODEL): number[] {
  const z = x.map((v, j) => (v - model.mean[j]) / (model.std[j] || 1));
  const h = model.W1.map((row, i) => {
    let s = model.b1[i];
    for (let j = 0; j < row.length; j += 1) s += row[j] * z[j];
    return Math.tanh(s);
  });
  return model.W2.map((row, k) => {
    let s = model.b2[k];
    for (let j = 0; j < row.length; j += 1) s += row[j] * h[j];
    return 1 / (1 + Math.exp(-s));
  });
}

interface Trace {
  crosswalk: CrosswalkId;
  bike?: 'ride' | 'push';
  length: number;
  width: number;
  /** 10Hz 자취 — 건너는 축 · 그 직각 축 */
  pts: Array<{ t: number; axis: number; across: number }>;
  firstSeen: number;
  lastMoved: number;
}

/**
 * **사람마다 자취를 모아 10Hz 로 짐작한다.** 매 프레임 `update` 를 부르면 0.1초마다 한 번 특징을 뽑아 신경망을 돌리고,
 * 그 사이에는 지난 짐작을 그대로 둔다 — LiDAR 가 한 바퀴 돌 때마다 판단하는 것과 같다.
 *
 * 학습(scripts/train-intent.ts)도 이 클래스로 특징을 뽑는다 — 학습한 특징과 실제로 보는 특징이 같은 셈이어야 한다.
 */
export class IntentEstimator {
  private readonly traces = new Map<number, Trace>();
  private readonly signals = new Map<CrosswalkId, { value: PedSignal | null; since: number }>();
  private readonly estimates = new Map<number, IntentEstimate>();
  private readonly feats = new Map<number, number[]>();
  private nextTick = -Infinity;

  constructor(private readonly model: IntentModel | null = intentModelReady() ? MODEL : null) {}

  /**
   * 한 프레임. `peds` 는 지금 보이는 사람들(다 건너 사라진 사람은 뺀다). 0.1초가 지났으면 짐작을 새로 하고 참을 돌려준다.
   *
   * `force` 면 0.1초를 세지 않고 지금 짐작한다 — LiDAR 가 한 바퀴를 돈 바로 그때 부르는 쪽(Game · playSim)이 쓴다. 바퀴와
   * 짐작의 박자가 어긋나면 같은 바퀴를 두 번 보거나(빠르기 0) 한 바퀴를 건너뛰어(빠르기 두 배) 움직임 특징이 흔들린다.
   */
  update(t: number, peds: readonly PedObservation[], ctx: IntentContext, force = false): boolean {
    // 등화가 바뀐 때는 매 프레임 본다 — 바뀐 지 얼마나 되었는가(sigAge)가 특징이다
    for (const id of ['A', 'B', 'C', 'S'] as const) {
      const v = ctx.pedSignal[id] ?? null;
      const prev = this.signals.get(id);
      if (!prev || prev.value !== v) this.signals.set(id, { value: v, since: t });
    }
    if (!force && t < this.nextTick) return false;
    this.nextTick = force || !Number.isFinite(this.nextTick) ? t + 1 / INTENT_HZ : this.nextTick + 1 / INTENT_HZ;
    if (this.nextTick <= t) this.nextTick = t + 1 / INTENT_HZ;

    const seen = new Set<number>();
    for (const p of peds) {
      // LiDAR 가 재는 거리 밖의 사람은 모른다
      if (Math.hypot(p.x - ctx.front.x, p.z - ctx.front.z) > INTENT_RANGE) continue;
      seen.add(p.id);
      let tr = this.traces.get(p.id);
      if (!tr || tr.crosswalk !== p.crosswalk) {
        tr = { crosswalk: p.crosswalk, bike: p.bike, length: p.length, width: p.width, pts: [], firstSeen: t, lastMoved: -Infinity };
        this.traces.set(p.id, tr);
      }
      // 갈래 · 크기는 추적이 다듬어 가는 값이라 바퀴마다 새로 받는다
      tr.bike = p.bike;
      tr.length = p.length;
      tr.width = p.width;
      const axis = crosswalkAxis(p.crosswalk, p.x, p.z);
      const across = p.crosswalk === 'C' ? p.x : p.z;
      const last = tr.pts[tr.pts.length - 1];
      if (last && Math.hypot(axis - last.axis, across - last.across) / Math.max(1e-3, t - last.t) > MOVING_SPEED) {
        tr.lastMoved = t;
      }
      tr.pts.push({ t, axis, across });
      while (tr.pts.length > 1 && tr.pts[0].t < t - HISTORY_SECONDS) tr.pts.shift();

      const x = this.featuresOf(tr, t, ctx);
      this.feats.set(p.id, x);
      const road = onRoadway(p.crosswalk, p.x, p.z);
      const where = { crosswalk: p.crosswalk, x: p.x, z: p.z, axis, inward: (axis >= 0 ? -1 : 1) as 1 | -1 };
      if (this.model) {
        const [py, pe] = intentProbs(x, this.model);
        this.estimates.set(p.id, {
          yield: road ? 1 : py,
          enter: road ? 1 : pe,
          onRoadway: road,
          yields: road || py >= this.model.threshold,
          ...where,
        });
      } else {
        this.estimates.set(p.id, { yield: road ? 1 : 0, enter: road ? 1 : 0, onRoadway: road, yields: road, ...where });
      }
    }
    // 안 보이게 된 사람(다 건넜거나 멀어졌다)은 잊는다
    for (const id of [...this.traces.keys()]) {
      if (seen.has(id)) continue;
      this.traces.delete(id);
      this.estimates.delete(id);
      this.feats.delete(id);
    }
    return true;
  }

  /** 그 사람에 대한 지금 짐작 — 본 적이 없으면 없다 */
  estimate(id: number): IntentEstimate | undefined {
    return this.estimates.get(id);
  }

  /** 지금 짐작하고 있는 모든 사람 */
  all(): ReadonlyMap<number, IntentEstimate> {
    return this.estimates;
  }

  /** AI 가 양보하는 사람 — 사람 번호 → 양보하는가 (AutoDriver 의 `pedYield`) */
  yieldMap(): ReadonlyMap<number, boolean> {
    const m = new Map<number, boolean>();
    for (const [id, e] of this.estimates) m.set(id, e.yields);
    return m;
  }

  /** 마지막으로 뽑은 특징 — 학습 데이터를 모으는 데 쓴다 */
  lastFeatures(id: number): readonly number[] | undefined {
    return this.feats.get(id);
  }

  private featuresOf(tr: Trace, t: number, ctx: IntentContext): number[] {
    const pts = tr.pts;
    const now = pts[pts.length - 1];
    /** `ago` 초 전의 자취 — 그만큼 거슬러 올라가지 못하면 가장 오래된 것 */
    const at = (ago: number) => {
      for (let i = pts.length - 1; i >= 0; i -= 1) if (pts[i].t <= t - ago + 1e-6) return pts[i];
      return pts[0];
    };
    // 차도 한가운데 쪽이 + 다 — 축의 부호로 그 사람이 어느 보도에 있는지 안다
    const inward = now.axis >= 0 ? -1 : 1;
    const rate = (a: { t: number; axis: number }, b: { t: number; axis: number }): number =>
      b.t - a.t > 1e-3 ? (inward * (b.axis - a.axis)) / (b.t - a.t) : 0;
    const p03 = at(0.3);
    const p10 = at(1.0);
    const speed =
      now.t - p03.t > 1e-3 ? Math.hypot(now.axis - p03.axis, now.across - p03.across) / (now.t - p03.t) : 0;
    const sig = this.signals.get(tr.crosswalk);
    const light = sig?.value ?? null;
    const sigAge = sig ? t - sig.since : 0;
    const carDist = crosswalkDistance(tr.crosswalk, ctx.front);
    return [
      Math.abs(now.axis) - CURB,
      rate(p03, now),
      rate(p10, p03),
      Math.abs(now.axis - p10.axis),
      speed,
      Math.min(5, Number.isFinite(tr.lastMoved) ? t - tr.lastMoved : t - tr.firstSeen),
      Math.min(HISTORY_SECONDS, t - tr.firstSeen),
      light === 'green' ? 1 : 0,
      light === 'greenFlash' ? 1 : 0,
      light === 'red' ? 1 : 0,
      light === null ? 1 : 0,
      Math.min(10, sigAge),
      Math.max(-10, Math.min(60, carDist)),
      ctx.speedKmh / 3.6,
      tr.bike === 'ride' ? 1 : 0,
      Math.min(6, tr.length),
      Math.min(3, tr.width),
    ];
  }
}

/**
 * **LiDAR 가 따라가는 물체 가운데 AI 가 볼 사람** — 확정된 추적 중 분류기가 사람(어른 · 어린이)이나 자전거로 가린 것을,
 * 지도에서 선 횡단보도를 찾아(`crosswalkAt`) 관측으로 바꾼다. 번호는 추적 번호다 — 놓쳤다가 다시 잡으면 새 사람이 된다.
 *
 * AI 자율주행은 **이것만 보고** 양보한다 (Game.ts · scenarios/playSim.ts). 게임 속 보행자의 자리 · 속은 보지 않는다 —
 * LiDAR 가 못 본 사람(가림 · 분류 실수)은 AI 도 모른다. 그래서 22,818판을 LiDAR 까지 돌려 검증한다.
 */
export function perceivedPeople(tracks: readonly Track[]): PedObservation[] {
  const out: PedObservation[] = [];
  for (const tr of tracks) {
    if (!tr.confirmed || (tr.cls !== 'adult' && tr.cls !== 'child' && tr.cls !== 'bike')) continue;
    const crosswalk = crosswalkAt(tr.x, tr.z);
    if (!crosswalk) continue;
    out.push({
      id: tr.id,
      crosswalk,
      x: tr.x,
      z: tr.z,
      length: tr.length,
      width: tr.width,
      ...(tr.cls === 'bike' ? { bike: 'ride' as const } : {}),
    });
  }
  return out;
}

/**
 * **앞으로 달릴 길이 그 횡단보도를 지나는가** — 길의 점 하나라도 줄무늬 안(차도 폭 안)에 들면 지난다. LiDAR 화면이
 * 내 길에 걸린 횡단보도의 사람만 위험으로 칠하는 데 쓴다 (AI 가 그 사람 때문에 서는 것과 같은 뜻이다).
 */
export function routeCrosses(id: CrosswalkId, route: ReadonlyArray<{ x: number; z: number }>): boolean {
  const half = 2.5;
  return route.some((p) => {
    const across = id === 'C' ? p.x : p.z;
    return Math.abs(across - crosswalkCenter(id)) <= half && Math.abs(crosswalkAxis(id, p.x, p.z)) <= CURB;
  });
}

/**
 * **지도에서 그 사람이 선 횡단보도를 찾는다** — LiDAR 가 잡은 사람(추적)에게 짐작을 붙일 때 쓴다. 건너는 축과 직각으로
 * 줄무늬 한가운데에서 4m 안, 축으로는 보도 끝(연석 + 3m) 안이어야 한다. 횡단보도가 여럿이면 가까운 쪽이다.
 */
export function crosswalkAt(x: number, z: number, ids: readonly CrosswalkId[] = ['A', 'B', 'C', 'S']): CrosswalkId | null {
  let best: CrosswalkId | null = null;
  let bestD = Infinity;
  for (const id of ids) {
    const across = id === 'C' ? x : z;
    const axis = crosswalkAxis(id, x, z);
    // 타고 건너는 자전거는 줄무늬 옆 자전거횡단도 위로 간다 — 그 띠까지 넉넉히 본다
    const d = Math.min(Math.abs(across - crosswalkCenter(id)), Math.abs(across - pedAcross(id, 'ride', 0)));
    if (Math.abs(axis) > CURB + 3 || d > 4) continue;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}
