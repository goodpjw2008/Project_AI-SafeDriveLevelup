/**
 * **신호 · 정지선 판단 신경망 — AI 자율주행이 관문마다 "기다릴까, 한 번 설까" 를 정한다.**
 *
 * AI 자율주행은 길 위의 관문을 차례로 지난다 — 진입로 어린이보호구역 횡단보도(S), 교차로 정지선, 교차로를 지나 만나는
 * 횡단보도, 보호구역 도로의 횡단보도. 관문마다 묻는 것이 둘이다 (game/AutoDriver.ts).
 *
 *  1. **기다림** (`wait`) — 지금은 갈 수 없다. 직진의 적색, 우회전 신호등의 적색 · 황색 화살표, 진입로 보호구역의 적색,
 *     진출로가 막힌 교차로(꼬리물기)
 *  2. **일시정지** (`hold`) — 갈 수는 있으나 한 번은 완전히 서야 한다. 정면 적색에서 우회전하기 전, 신호기 없는 어린이보호구역
 *     횡단보도(제27조 제7항 — 사람이 없어도)
 *
 * 이 둘을 **작은 신경망**(models/signal.json)이 신호 · 보호구역 · 신호기 유무를 보고 낸다. 보행자를 보고 서는 것은 따로다 —
 * LiDAR 와 의도 예측 신경망이 맡는다 (ai/intent.ts).
 *
 * ## 무엇을 배웠고, 어떻게 믿는가
 *
 * 정답은 도로교통법이다 — 아래 `signalRule` 이 경찰청 답변과 맞춰 본 판정 규칙(rules/lawRules.ts)과 같은 조문을 행동으로
 * 옮긴 것이고, 신경망은 그 답을 따라 배운다 (scripts/train-signal.ts, 사용자가 정했다 2026-11-01: *"모든걸 ai로 하고 싶어"*).
 * 입력은 몇 가지 값의 조합뿐이라 **나올 수 있는 경우가 모두 3만 720가지**다(`signalDomain`). 학습은 그 전부에서 법규와 같은
 * 답을 내고 확률이 0.5 에서 넉넉히 떨어질 때까지 하고, 저장한(반올림한) 가중치로 다시 전부를 확인한다 — tests/signalPolicy.test.ts
 * 가 커밋마다 또 확인한다. 학습한 모델이 틀릴 수 있는 곳이 **하나도 남지 않았음을 전수로 보인 것**이라, 안전장치로 규칙을
 * 겹쳐 두지 않는다. 판정(위반을 잡는 쪽)은 그대로 규칙이다.
 *
 * 순수 모듈이다 — 게임(Game.ts) · 검증기 · 플레이 시뮬레이터가 같은 AutoDriver 로 이 판단을 돌린다.
 */

import type { LightColor, RightArrowColor } from '../rules/lawRules';
import trained from './models/signal.json';

/** 관문 — 진입로 보호구역 횡단보도 · 교차로 정지선 · 교차로를 지나 만나는 횡단보도 · 보호구역 도로의 횡단보도 */
export type SignalGate = 'S' | 'line' | 'exit' | 'zone';

/** 한 관문에서 보는 것 — 모두 신호기와 지도로 알 수 있는 값이다 */
export interface SignalQuery {
  gate: SignalGate;
  /** 교차로를 어떻게 빠져나가는가 — 보호구역 도로(zone)에서는 보지 않는다 */
  drive: 'rightTurn' | 'straight';
  /** 정면 차량신호 */
  vehicleLight: LightColor;
  /** 우회전 신호등 — 없으면 null */
  rightArrow: RightArrowColor | null;
  /** 진입로 어린이보호구역 — 없음 · 신호기 없음 · 그 신호기의 색 */
  approach: 'none' | 'noSignal' | LightColor;
  /** 보호구역 도로 횡단보도의 차량신호 — 신호기 없음 · 그 색 */
  zoneLight: 'noSignal' | LightColor;
  /** 교차로가 어린이보호구역인가 */
  schoolZone: boolean;
  /** 이 관문의 횡단보도(교차로 정지선이면 A, 교차로를 지나면 B · C)에 보행신호기가 있는가 */
  crosswalkSignal: boolean;
  /** 교차로를 지나 나갈 자리가 막혔는가 (꼬리물기) */
  exitBlocked: boolean;
}

export interface SignalDecision {
  wait: boolean;
  hold: boolean;
}

const GATES: readonly SignalGate[] = ['S', 'line', 'exit', 'zone'];
const DRIVES: readonly SignalQuery['drive'][] = ['rightTurn', 'straight'];
const LIGHTS: readonly LightColor[] = ['green', 'yellow', 'red', 'redFlash'];
const ARROWS: readonly (RightArrowColor | null)[] = [null, 'greenArrow', 'yellowArrow', 'redArrow'];
const APPROACH: readonly SignalQuery['approach'][] = ['none', 'noSignal', ...LIGHTS];
const ZONE_LIGHTS: readonly SignalQuery['zoneLight'][] = ['noSignal', ...LIGHTS];

/** 입력 이름 — 순서가 곧 모델의 입력 순서다. **바꾸면 다시 학습해야 한다** (tests/signalPolicy.test.ts 가 잡는다) */
export const SIGNAL_FEATURES: readonly string[] = [
  ...GATES.map((g) => `gate:${g}`),
  ...DRIVES.map((d) => `drive:${d}`),
  ...LIGHTS.map((l) => `light:${l}`),
  ...ARROWS.map((a) => `arrow:${a ?? 'none'}`),
  ...APPROACH.map((a) => `approach:${a}`),
  ...ZONE_LIGHTS.map((z) => `zone:${z}`),
  'schoolZone',
  'crosswalkSignal',
  'exitBlocked',
];

/** 관문 하나 → 신경망의 입력 (값마다 한 칸씩 켜는 원-핫) */
export function signalFeatures(q: SignalQuery): number[] {
  const one = <T,>(values: readonly T[], v: T) => values.map((x) => (x === v ? 1 : 0));
  return [
    ...one(GATES, q.gate),
    ...one(DRIVES, q.drive),
    ...one(LIGHTS, q.vehicleLight),
    ...one(ARROWS, q.rightArrow),
    ...one(APPROACH, q.approach),
    ...one(ZONE_LIGHTS, q.zoneLight),
    q.schoolZone ? 1 : 0,
    q.crosswalkSignal ? 1 : 0,
    q.exitBlocked ? 1 : 0,
  ];
}

/**
 * **법규가 정한 답** — 신경망이 배우는 정답이자 전수 검증의 기준. 조문마다의 까닭은 game/AutoDriver.ts 의 예전 판단
 * (gateBlocked · gateNeedsFullStop)에 있던 그대로다.
 */
export function signalRule(q: SignalQuery): SignalDecision {
  switch (q.gate) {
    case 'S':
      // 진입로 보호구역 — 적색 · 황색은 녹색까지 기다리고(SCHOOL_ZONE_RED), 신호기가 없으면 한 번 선다 (제27조 제7항)
      return {
        wait: q.approach !== 'none' && q.approach !== 'noSignal' && q.approach !== 'green',
        hold: q.approach === 'noSignal',
      };
    case 'line': {
      if (q.drive === 'straight') {
        // 직진의 적색에는 '서고 나서 통행' 단서가 없다 — 녹색까지 기다린다 (STRAIGHT_RED)
        return { wait: q.exitBlocked || q.vehicleLight !== 'green', hold: q.schoolZone && !q.crosswalkSignal };
      }
      // 우회전 신호등이 있으면 그것을 따른다 — 녹색 화살표가 아니면 우회전 금지, 녹색 화살표면 일시정지 의무가 없다
      const arrowStops = q.rightArrow !== null && q.rightArrow !== 'greenArrow';
      const hold =
        q.rightArrow !== null
          ? false
          : q.vehicleLight !== 'green' // 정면 적색 · 적색 점멸이면 일시정지, 황색은 멈출 수 있으면 멈춘다
            ? true
            : q.schoolZone && !q.crosswalkSignal;
      return { wait: q.exitBlocked || arrowStops, hold };
    }
    case 'exit':
      // 교차로를 지나 만나는 횡단보도 — 신호 색이 아니라 보행자가 기준이다. 보호구역의 신호기 없는 횡단보도만 한 번 선다
      return { wait: false, hold: q.schoolZone && !q.crosswalkSignal };
    case 'zone':
      // 보호구역 도로 — 신호기가 있으면 녹색이 아닌 동안 기다리고, 없으면 사람이 없어도 한 번 선다
      return { wait: q.zoneLight !== 'noSignal' && q.zoneLight !== 'green', hold: q.zoneLight === 'noSignal' };
  }
}

/** 나올 수 있는 모든 관문 — 학습과 전수 검증이 이것을 쓴다 */
export function signalDomain(): SignalQuery[] {
  const out: SignalQuery[] = [];
  for (const gate of GATES)
    for (const drive of DRIVES)
      for (const vehicleLight of LIGHTS)
        for (const rightArrow of ARROWS)
          for (const approach of APPROACH)
            for (const zoneLight of ZONE_LIGHTS)
              for (const schoolZone of [false, true])
                for (const crosswalkSignal of [false, true])
                  for (const exitBlocked of [false, true])
                    out.push({ gate, drive, vehicleLight, rightArrow, approach, zoneLight, schoolZone, crosswalkSignal, exitBlocked });
  return out;
}

/** 학습한 모델 — 은닉층 하나(tanh), 출력 둘(기다림 · 일시정지)마다 시그모이드 */
export interface SignalModel {
  kind: 'signal-mlp';
  names: readonly string[];
  outputs: readonly ['wait', 'hold'];
  W1: ReadonlyArray<readonly number[]>;
  b1: readonly number[];
  W2: ReadonlyArray<readonly number[]>;
  b2: readonly number[];
  meta: { trained: boolean; [k: string]: unknown };
}

const MODEL = trained as unknown as SignalModel;

/** 학습한 모델이 있고 입력 이름이 지금 코드와 같은가 */
export const signalModelReady = (model: SignalModel = MODEL): boolean =>
  model.meta?.trained === true &&
  model.names.length === SIGNAL_FEATURES.length &&
  model.names.every((n, i) => n === SIGNAL_FEATURES[i]);

/** 입력 → 출력마다의 확률 (기다림 · 일시정지) */
export function signalProbs(x: readonly number[], model: SignalModel = MODEL): [number, number] {
  const h = model.W1.map((row, i) => {
    let s = model.b1[i];
    for (let j = 0; j < row.length; j += 1) s += row[j] * x[j];
    return Math.tanh(s);
  });
  const out = model.W2.map((row, k) => {
    let s = model.b2[k];
    for (let j = 0; j < row.length; j += 1) s += row[j] * h[j];
    return 1 / (1 + Math.exp(-s));
  });
  return [out[0], out[1]];
}

/*
  한 판에 나오는 관문은 몇 가지뿐이고 프레임마다 같은 것을 묻는다 — 답을 기억해 둔다 (3만 가지라 다 담아도 작다).
*/
const memo = new Map<string, SignalDecision>();

/**
 * **이 관문에서 기다릴까, 한 번 설까** — 신경망이 정한다. 학습한 모델이 없으면(처음 학습하기 전 · 입력이 바뀜) 법규의 답을
 * 그대로 쓴다 — 그런 모델은 테스트가 커밋 전에 잡는다.
 */
export function signalDecision(q: SignalQuery, model: SignalModel = MODEL): SignalDecision {
  if (model === MODEL ? !READY : !signalModelReady(model)) return signalRule(q);
  const x = signalFeatures(q);
  const key = model === MODEL ? x.join('') : null;
  const hit = key === null ? undefined : memo.get(key);
  if (hit) return hit;
  const [w, h] = signalProbs(x, model);
  const d = { wait: w > 0.5, hold: h > 0.5 };
  if (key !== null) memo.set(key, d);
  return d;
}

const READY = signalModelReady();
