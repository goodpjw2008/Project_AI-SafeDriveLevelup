/**
 * **주행 결과 데이터** — 한 판을 숫자 스무 개 남짓의 **요약 한 줄**로 굳힌다.
 *
 * 판정 엔진(rules/lawRules.ts)은 매 프레임 세계를 보지만, 판이 끝나면 위반 코드 몇 개와 참·거짓 넷만 남았다.
 * 학습자 모델(ai/knowledge.ts) · 위험도 모델(ai/risk.ts) · AI 코치가 "어디서 어떻게 무너지는가" 를 읽으려면
 * 위반 여부보다 **앞선** 숫자가 필요하다 — 제동을 어디서 시작했는지, 보행자의 뜻을 보고 몇 초 만에 반응했는지,
 * 사람과 얼마나 가까웠는지. 프레임을 저장하지 않고 여기서 요약만 만든다 (한 판에 200 바이트 남짓).
 *
 * **게임(game/Game.ts)과 시뮬레이터(scenarios/playSim.ts)가 같은 것을 쓴다.** 위험도 모델은 시뮬레이터의
 * 가상 운전자로 학습하므로, 학습 때 본 숫자와 실제 판에서 재는 숫자가 같은 코드에서 나와야 한다.
 *
 * 순수 모듈이다 — Three.js 도 DOM 도 없다.
 */

import {
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_S_OUTER,
  PLAYER_EXIT_Z,
  STOP_LINE,
  STOP_LINE_S,
} from '../layout';
import type { CrosswalkId, DriveMode, JudgeResult, WorldSample } from '../rules/lawRules';
import type { ViolationCode } from '../rules/violations';

/** 한 판의 요약 — 값이 없는 것은 `null` (그 상황이 없던 판) */
export interface RunFeatures {
  /** 정지선(A) 앞 제동 시작 거리 (m) — 접근로에서 처음 브레이크를 밟은 자리 */
  brakeA: number | null;
  /** 정지선 앞 첫 완전정지 자리 (m, 음수면 넘어서 섰다) */
  stopA: number | null;
  /** 정지선 앞에서 가장 오래 서 있던 시간 (초) */
  holdA: number;
  /** 정지선 30m 앞 속도 (km/h) */
  spdA30: number | null;
  /** 정지선 12m 안 최저 속도 (km/h) */
  minA: number | null;
  /** 첫 횡단보도(A) 위를 지날 때의 최고 속도 (km/h) */
  crossA: number | null;
  /** 진입로 보호구역 횡단보도(S) — 없는 판은 null */
  brakeS: number | null;
  stopS: number | null;
  holdS: number;
  crossS: number | null;
  /** 교차로 안 최고 속도 (km/h, 판정 통계) */
  inter: number;
  /** 빠져나가는 횡단보도(우회전은 C · 직진은 B) 위 최고 속도 */
  crossC: number | null;
  /** 우회전 후 횡단보도 앞에서 섰는가 (판정 통계) */
  stopC: boolean;
  /** 건너려는 뜻을 보인 사람 수 */
  peds: number;
  /** 제동이 필요해진 때부터 실제 제동까지 — 평균 · 최대 (초). 필요해지기 전에 밟았으면 0. 반응할 사람이 없던 판은 null */
  react: number | null;
  reactMax: number | null;
  /** 사람이 차도에 있는 동안 내 차와 그 횡단보도의 최소 거리 (m) */
  gap: number | null;
  /** 그때의 최소 시간 여유 (초) — 거리 ÷ 속도 */
  ttc: number | null;
  /** 뜻을 보인 사람이 아직 건너기 전에 그 횡단보도를 지나간 횟수 */
  passIntent: number;
  /** 뜻을 보였을 때의 거리(m) · 속도(km/h) — 가장 가까웠던(어려웠던) 한 번 */
  intentD: number | null;
  intentV: number | null;
  /** 방향지시등을 켠 자리 (정지선 앞 m). 켜지 않았으면 null */
  sigDist: number | null;
  /** 최대 감속도 (m/s²) */
  decel: number;
  /** 회전 안쪽 코너 이격 (m, 판정 통계) */
  turn: number;
  /** 정지선 30m 앞에서 정면 신호가 적색이었는가 */
  redAt30: boolean;
  /** 걸린 시간 (초) */
  elapsed: number;
  /** 위반 수 · 완주 실패 */
  viol: number;
  fail: boolean;
}

/** 요약 한 줄에 들어가는 숫자 열쇠 — 위험도 모델의 입력 순서이기도 하다 (ai/risk.ts) */
export const NUMERIC_FEATURES = [
  'brakeA',
  'stopA',
  'holdA',
  'spdA30',
  'minA',
  'crossA',
  'brakeS',
  'stopS',
  'holdS',
  'crossS',
  'inter',
  'crossC',
  'react',
  'reactMax',
  'gap',
  'ttc',
  'passIntent',
  'intentD',
  'intentV',
  'sigDist',
  'decel',
  'turn',
  'peds',
] as const satisfies readonly (keyof RunFeatures)[];

/** 뜻을 보인 사람을 셈에 넣는 거리 — 이보다 멀면 판단할 것이 없다 */
const PED_WATCH_M = 45;
/** 제동 감속도 — 반응 시간과 반사실을 셀 때 쓰는 보통 승용차의 값 (m/s²) */
const BRAKE_MS2 = 4.5;
/** 지금 속도에서 서는 데 필요한 거리 (m) */
const stoppingDistance = (kmh: number): number => (kmh / 3.6) ** 2 / (2 * BRAKE_MS2);
/** 접근로에서 재는 구간 — 정지선 앞 이만큼부터 */
const APPROACH_M = 45;

/** 그 횡단보도까지 남은 거리 (m) — 시뮬레이터(playSim.ts 의 distanceTo)와 같은 셈 */
export function crosswalkDistance(id: CrosswalkId, front: { x: number; z: number }): number {
  if (id === 'S') return front.z - CROSSWALK_S_OUTER;
  if (id === 'A') return front.z - CROSSWALK_OUTER;
  if (id === 'B') return front.z - CROSSWALK_B_INNER;
  return front.x >= CROSSWALK_INNER
    ? CROSSWALK_INNER - front.x
    : Math.max(0, CROSSWALK_INNER - front.x) + Math.max(0, front.z - PLAYER_EXIT_Z);
}

interface PedTrack {
  intentAt: number | null;
  /** 뜻을 보였을 때 내 차의 거리 · 속도 */
  d0: number;
  v0: number;
  /** 제동이 **필요해진** 때 — 남은 거리가 제동 거리 + 여유 안으로 든 첫 순간. 그 전에 밟았으면 반응은 0 이다 */
  neededAt: number | null;
  reacted: boolean;
  passed: boolean;
}

/**
 * **반응 시간은 '필요해진 때부터' 잰다.** 뜻이 보인 순간부터 재면 멀리서 본 사람에게 규정대로 천천히 다가가는 운전자가
 * 가장 느린 것이 된다 — 규정은 "설 수 있는 거리에서 서라" 이지 "보자마자 밟아라" 가 아니다. 그래서 남은 거리가
 * 제동 거리(v²/2a) + 여유(BRAKE_MARGIN_M) 안으로 든 순간부터 실제 제동까지를 센다. 그 전에 밟았으면 0 이다.
 */
const BRAKE_MARGIN_M = 3;

/**
 * 매 프레임 세계를 보고 요약을 쌓는다. `finish` 로 한 줄을 받는다.
 *
 * @param braking 이번 프레임에 운전자가 브레이크를 밟고 있는가 — 게임은 조작 입력, 시뮬레이터는 운전자의 정지 결정
 */
export class RunTelemetry {
  private t = 0;
  private prevSpeed: number | null = null;
  private prevBraking = false;
  private brakeA: number | null = null;
  private stopA: number | null = null;
  private holdA = 0;
  private holdNowA = 0;
  private spdA30: number | null = null;
  private minA: number | null = null;
  private crossA: number | null = null;
  private brakeS: number | null = null;
  private stopS: number | null = null;
  private holdS = 0;
  private holdNowS = 0;
  private crossS: number | null = null;
  private crossExit: number | null = null;
  private gap: number | null = null;
  private ttc: number | null = null;
  private passIntent = 0;
  private intentD: number | null = null;
  private intentV: number | null = null;
  private sigDist: number | null = null;
  private decel = 0;
  private redAt30 = false;
  private readonly reacts: number[] = [];
  private readonly peds = new Map<number, PedTrack>();

  constructor(private readonly drive: DriveMode = 'rightTurn', private readonly approachZone = false) {}

  update(s: WorldSample, dt: number, braking: boolean): void {
    this.t = s.t;
    const front = { x: s.frontX, z: s.frontZ };
    const v = s.speedKmh;
    const onset = braking && !this.prevBraking;

    // ── 감속도 ──
    if (this.prevSpeed !== null && dt > 0) {
      const a = ((this.prevSpeed - v) / 3.6) / dt;
      if (a > this.decel && a < 15) this.decel = a;
    }

    // ── 접근로 · 정지선 A ──
    const dA = s.frontZ - STOP_LINE;
    if (dA > 0 && dA <= APPROACH_M) {
      if (onset && this.brakeA === null) this.brakeA = dA;
      if (this.spdA30 === null && dA <= 30) {
        this.spdA30 = v;
        this.redAt30 = s.vehicleLight === 'red';
      }
      if (dA <= 12) this.minA = this.minA === null ? v : Math.min(this.minA, v);
      if (this.sigDist === null && s.rightSignalOn && this.drive === 'rightTurn') this.sigDist = dA;
    }
    // 정지선 앞(넘어선 것도 조금까지)에서 완전히 섰는가
    if (dA > -(CROSSWALK_OUTER - CROSSWALK_INNER) && dA <= 12 && v <= 0.5) {
      if (this.stopA === null) this.stopA = dA;
      this.holdNowA += dt;
      this.holdA = Math.max(this.holdA, this.holdNowA);
    } else if (v > 1.5) {
      this.holdNowA = 0;
    }
    // 첫 횡단보도 위
    if (s.frontZ <= CROSSWALK_OUTER && s.frontZ >= CROSSWALK_INNER) {
      this.crossA = this.crossA === null ? v : Math.max(this.crossA, v);
    }

    // ── 진입로 보호구역 S ──
    if (this.approachZone) {
      const dS = s.frontZ - STOP_LINE_S;
      if (dS > 0 && dS <= APPROACH_M && onset && this.brakeS === null) this.brakeS = dS;
      if (dS > -(CROSSWALK_S_OUTER - CROSSWALK_S_INNER) && dS <= 12 && v <= 0.5) {
        if (this.stopS === null) this.stopS = dS;
        this.holdNowS += dt;
        this.holdS = Math.max(this.holdS, this.holdNowS);
      } else if (v > 1.5) {
        this.holdNowS = 0;
      }
      if (s.frontZ <= CROSSWALK_S_OUTER && s.frontZ >= CROSSWALK_S_INNER) {
        this.crossS = this.crossS === null ? v : Math.max(this.crossS, v);
      }
    }

    // ── 빠져나가는 횡단보도 ──
    const onExit =
      this.drive === 'rightTurn'
        ? s.frontX >= CROSSWALK_INNER && s.frontX <= CROSSWALK_OUTER
        : s.frontZ <= CROSSWALK_B_INNER && s.frontZ >= CROSSWALK_B_OUTER;
    if (onExit) this.crossExit = this.crossExit === null ? v : Math.max(this.crossExit, v);

    // ── 보행자 ──
    s.pedestrians.forEach((p, i) => {
      const id = p.id ?? i;
      const d = crosswalkDistance(p.crosswalk, front);
      let tr = this.peds.get(id);
      if (!tr) {
        tr = { intentAt: null, d0: 0, v0: 0, neededAt: null, reacted: false, passed: false };
        this.peds.set(id, tr);
      }
      // 뜻을 보인 순간 — 내 차가 아직 그 횡단보도 앞에 있고 움직이고 있을 때만 '반응할 상황' 이다
      if (tr.intentAt === null && p.intendsToCross && d > 0 && d <= PED_WATCH_M && v > 3) {
        tr.intentAt = s.t;
        tr.d0 = d;
        tr.v0 = v;
        // 가장 어려웠던 한 번 — 거리 대비 속도가 큰 것
        const hard = v / Math.max(1, d);
        if (this.intentD === null || hard > (this.intentV ?? 0) / Math.max(1, this.intentD)) {
          this.intentD = d;
          this.intentV = v;
        }
        if (braking) {
          tr.reacted = true;
          this.reacts.push(0);
        }
      }
      if (tr.intentAt !== null && !tr.reacted && !tr.passed) {
        if (tr.neededAt === null && d <= stoppingDistance(v) + BRAKE_MARGIN_M) tr.neededAt = s.t;
        if (onset || braking || v <= 0.5) {
          tr.reacted = true;
          this.reacts.push(tr.neededAt === null ? 0 : Math.min(5, Math.max(0, s.t - tr.neededAt)));
        } else if (d < 0) {
          // 서지 않고 그 횡단보도를 지났다 — 사람이 아직 건너기 전(대기 · 건너는 중)이면 지나친 것이다
          tr.passed = true;
          this.reacts.push(tr.neededAt === null ? 0 : Math.min(5, Math.max(0, s.t - tr.neededAt)));
          if (p.state !== 'done') this.passIntent += 1;
        }
      }
      // 사람이 차도 위에 있는 동안의 거리 · 시간 여유
      if (p.onConflictPath && d > 0 && v > 1) {
        this.gap = this.gap === null ? d : Math.min(this.gap, d);
        const ttc = d / (v / 3.6);
        this.ttc = this.ttc === null ? ttc : Math.min(this.ttc, ttc);
      }
    });

    this.prevSpeed = v;
    this.prevBraking = braking;
  }

  finish(result: JudgeResult): RunFeatures {
    const n = this.reacts.length;
    return {
      brakeA: round(this.brakeA),
      stopA: round(this.stopA),
      holdA: round(this.holdA) ?? 0,
      spdA30: round(this.spdA30),
      minA: round(this.minA),
      crossA: round(this.crossA),
      brakeS: this.approachZone ? round(this.brakeS) : null,
      stopS: this.approachZone ? round(this.stopS) : null,
      holdS: this.approachZone ? (round(this.holdS) ?? 0) : 0,
      crossS: this.approachZone ? round(this.crossS) : null,
      inter: round(result.stats.maxSpeedInIntersection) ?? 0,
      crossC: round(this.crossExit),
      stopC: result.stats.stopBeforeC,
      peds: [...this.peds.values()].filter((p) => p.intentAt !== null).length,
      react: n ? round(this.reacts.reduce((a, b) => a + b, 0) / n, 2) : null,
      reactMax: n ? round(Math.max(...this.reacts), 2) : null,
      gap: round(this.gap),
      ttc: round(this.ttc, 2),
      passIntent: this.passIntent,
      intentD: round(this.intentD),
      intentV: round(this.intentV),
      sigDist: round(this.sigDist),
      decel: round(this.decel) ?? 0,
      turn: round(result.stats.turnRadius) ?? 0,
      redAt30: this.redAt30,
      elapsed: round(result.stats.elapsed) ?? round(this.t) ?? 0,
      viol: result.violations.length,
      fail: result.failReason !== null,
    };
  }
}

function round(v: number | null, digits = 1): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}


/**
 * **위험했던 순간** — 위반은 아니어도 아슬아슬했던 것을 사람의 말로. 결과 화면과 AI 코치가 그대로 보여 준다.
 * 위험도 모델(ai/risk.ts)의 확률과 함께, 학습자 모델의 관측을 "겨우 지켰다" 로 누그러뜨리는 근거다.
 */
export function riskNotes(f: RunFeatures): string[] {
  const out: string[] = [];
  if (f.reactMax !== null && f.reactMax >= 1.5) out.push(`보행자의 뜻을 보고 ${f.reactMax.toFixed(1)}초 뒤에야 제동`);
  if (f.ttc !== null && f.ttc < 1.5) out.push(`사람이 건너는 횡단보도까지 시간 여유 ${f.ttc.toFixed(1)}초`);
  if (f.passIntent > 0) out.push(`건너려는 사람 앞을 서지 않고 ${f.passIntent}번 지나감`);
  if (f.stopA !== null && f.stopA < 0.5 && f.stopA > -1) out.push(`정지선 ${f.stopA >= 0 ? `${f.stopA.toFixed(1)}m 앞` : `${(-f.stopA).toFixed(1)}m 뒤`}에 정지 (거의 넘음)`);
  if (f.crossA !== null && f.crossA > 22) out.push(`첫 횡단보도를 ${Math.round(f.crossA)}km/h 로 통과`);
  if (f.crossC !== null && f.crossC > 22) out.push(`빠져나가는 횡단보도를 ${Math.round(f.crossC)}km/h 로 통과`);
  if (f.decel >= 6) out.push(`급제동 ${f.decel.toFixed(1)}m/s²`);
  return out;
}

/**
 * **반사실 설명** — 위반이 났을 때 "무엇이 조금만 달랐으면 통과했는가" 를 이 판의 숫자로 센다.
 * 시뮬레이터를 다시 돌리지 않고 제동 거리 공식(v²/2a)으로 셈한다 — 학습자의 실제 속도와 거리를 그대로 쓴다.
 */
export function counterfactual(code: ViolationCode, f: RunFeatures): string | null {
  switch (code) {
    case 'PEDESTRIAN_BLOCKED':
    case 'BIKE_BLOCKED': {
      if (f.intentD === null || f.intentV === null || f.intentV <= 0) return null;
      const need = Math.max(0, (f.intentD - stoppingDistance(f.intentV)) / (f.intentV / 3.6));
      const react = f.reactMax ?? null;
      if (react !== null && react > 0) {
        return `사람이 뜻을 보였을 때 ${f.intentD.toFixed(0)}m 앞 ${Math.round(f.intentV)}km/h 였습니다 — ${need.toFixed(1)}초 안에 제동했으면 설 수 있었는데, 제동이 필요해진 뒤 ${react.toFixed(1)}초 늦게 밟았습니다.`;
      }
      return `사람이 뜻을 보였을 때 ${f.intentD.toFixed(0)}m 앞 ${Math.round(f.intentV)}km/h 였습니다 — 그 자리에서 바로 제동하면 ${stoppingDistance(f.intentV).toFixed(0)}m 만에 섭니다.`;
    }
    case 'RED_NO_STOP':
    case 'SCHOOL_ZONE_RED':
    case 'STRAIGHT_RED': {
      const v = f.spdA30;
      if (v === null) return null;
      const need = stoppingDistance(v) + 1;
      return `정지선 30m 앞 ${Math.round(v)}km/h 였습니다 — 정지선 ${need.toFixed(0)}m 앞에서 제동을 시작하면 선 뒤에 갈 수 있었습니다.`;
    }
    case 'SCHOOL_ZONE_NO_STOP': {
      const at = f.brakeS ?? f.brakeA;
      return at === null
        ? '보호구역 횡단보도 앞에서 브레이크를 밟지 않았습니다 — 사람이 없어도 서야 하는 자리입니다.'
        : `보호구역 횡단보도 ${at.toFixed(0)}m 앞에서 제동을 시작했지만 완전히 서지 않았습니다 — 바퀴가 멈출 때까지 밟으면 됩니다.`;
    }
    case 'OVER_STOP_LINE':
      return f.stopA !== null && f.stopA < 0
        ? `정지선을 ${(-f.stopA).toFixed(1)}m 넘어 섰습니다 — ${(-f.stopA + 1).toFixed(0)}m 앞에서 제동을 시작하면 선 앞에 섭니다.`
        : null;
    case 'NO_SLOW_DOWN':
      return `교차로 안 최고 ${Math.round(f.inter)}km/h 였습니다 — 20km/h 아래로 돌면 서행입니다.`;
    case 'NO_TURN_SIGNAL':
      return f.sigDist !== null
        ? `방향지시등을 정지선 ${f.sigDist.toFixed(0)}m 앞에서 켰습니다 — 30m 앞에서는 켜져 있어야 합니다.`
        : '방향지시등을 켜지 않았습니다 — 정지선 30m 앞에서 켭니다.';
    default:
      return null;
  }
}
