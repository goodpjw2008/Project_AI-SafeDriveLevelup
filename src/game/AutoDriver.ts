/**
 * AI 자율 주행 — **정답을 보여 주는 운전자.**
 *
 * 사람이 하는 것과 똑같은 입력(`VehicleInput`)만 만들어 낸다. 차를 순간이동시키거나
 * 판정을 건너뛰지 않는다 — 같은 물리, 같은 판정을 그대로 통과한다. 그래야 화면에 뜨는
 * `PERFECT` 이 "규정대로 하면 이렇게 된다" 는 증거가 된다.
 *
 * 하는 일은 둘뿐이다. 속도는 차가 알아서 줄이므로(Vehicle.ts) 신경 쓰지 않는다.
 *
 *   1. **조향** — 우측 가장자리 차로를 따라가다 안쪽 코너에 붙여 돈다 (제25조 제1항)
 *   2. **정지 판단** — 언제 멈추고 언제 다시 갈 것인가
 *
 * 판단 기준은 판정 엔진(rules/lawRules.ts)이 위반으로 잡는 것과 **같은 조문**이다.
 * 다만 이쪽은 판정이 아니라 행동이라, 경계에서는 늘 **안전한 쪽으로** 기운다 —
 * 판정이 봐주는 오차범위(PEDESTRIAN_TOLERANCE_SECONDS 등)에 기대지 않는다.
 */

import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  FINISH_X,
  PLAYER_APPROACH_X,
  PLAYER_EXIT_Z,
  SPAWN_Z,
  STOP_LINE,
  CROSSWALK_S_OUTER,
  STOP_LINE_S,
} from '../layout';
import type {
  CrosswalkId,
  LightColor,
  PedSignal,
  PedestrianSample,
  RightArrowColor,
} from '../rules/lawRules';
import { STOP_HOLD_SECONDS } from '../rules/lawRules';
import type { VehicleInput } from './Vehicle';

/** 이번 프레임의 세계 — Game 이 채워 준다 (판정에 쓰는 값과 같은 출처다) */
export interface AutoDriveState {
  /** 차량 중심 */
  x: number;
  z: number;
  yaw: number;
  /** 앞범퍼 — 정지선·횡단보도까지 남은 거리를 이것으로 잰다 */
  frontX: number;
  frontZ: number;
  speedKmh: number;
  /** 완전정지를 유지한 시간 (초) */
  stopHold: number;
  vehicleLight: LightColor;
  /** 우회전 신호등. 미설치 교차로는 null. */
  rightArrow: RightArrowColor | null;
  pedSignal: Record<CrosswalkId, PedSignal | null>;
  pedestrians: PedestrianSample[];
  exitBlocked: boolean;
  isSchoolZone: boolean;
  /**
   * **진입부 어린이보호구역** — 오는 길에 지나는 구간. 없으면 `null`.
   * `light` 가 `null` 이면 신호기 없는 횡단보도이고, 그때가 제27조 제7항의 자리다.
   */
  approachZone: { light: LightColor | null } | null;
  /**
   * 앞차 — 없거나 이미 빠져나갔으면 `null`.
   * `gap` 은 내 앞범퍼에서 앞차 뒷범퍼까지 **경로를 따라 잰** 간격이다 (leadDrive.ts).
   */
  lead: { gap: number; speedKmh: number } | null;
}

/**
 * 앞차 뒤에서 **서야 하는 간격** (m).
 *
 * 속도가 붙어 있을수록 멀리서 선다 — 제동 거리(v²/2a, 감속도 4.8)에 여유 2.5m 를 더한다.
 * 서행(12km/h)이면 3.6m, 앞차가 이미 서 있으면 2.5m 뒤에 선다. 정답 주행이므로
 * 판정이 봐주는 한계까지 붙지 않는다.
 */
const followStopGap = (speedKmh: number): number => {
  const v = speedKmh / 3.6;
  return 2.5 + (v * v) / (2 * 4.8);
};

/**
 * 일시정지를 유지할 시간 (초).
 *
 * 판정 기준(0.5초)보다 **길게** 잡는다. 기준에 딱 맞춰 떼면 프레임 한 칸 차이로 미달이
 * 될 수 있고, 무엇보다 화면으로 보는 사람에게 "섰다" 로 읽히지 않는다 — 정답을 보여
 * 주는 주행이므로 멈춘 것이 눈에 보여야 한다.
 */
const HOLD_TARGET = STOP_HOLD_SECONDS + 0.7;

/**
 * 정지선·횡단보도 앞에서 제동을 시작할 거리 (m).
 *
 * 이 지점에서는 이미 서행(12km/h ≒ 3.3m/s)이고 제동 감속도가 4.8m/s² 라 1.2m 면 선다.
 * 3m 로 잡아 두면 정지선 앞 1.5~2m 에 서는데, 적법한 정지 구역(정지선 앞 12m) 안이라
 * 판정에 걸리지 않으면서 정지선을 넘길 걱정도 없다.
 */
const BRAKE_DISTANCE = 3.0;

/** 코너를 돌기 시작하는 지점 (z) 과 다 돌아 진출 차로에 붙는 지점 (x) */
const TURN_START_Z = 14;
const TURN_END_X = 14;

/**
 * 따라갈 길.
 *
 * 시나리오 카드의 그림(ui/ScenarioMap.ts)이 그리는 초록 궤적과 **같은 선**이다 —
 * 고르는 화면에서 본 길을 AI 가 그대로 달린다.
 *
 * 코너는 안쪽 모서리(9.8, 9.8)에 붙여 돈다. 교차로 안에서 그 모서리와 벌어진 최대
 * 거리가 대회전 판정 기준(WIDE_TURN_RADIUS = 7.0m)을 넘지 않아야 한다 — 이 선은
 * 3m 안쪽으로 지난다.
 */
function buildPath(): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  const lane = PLAYER_APPROACH_X;

  // 진입 직선 — 스폰보다 뒤에서 시작해 첫 프레임부터 따라갈 점이 있게 한다
  for (let z = SPAWN_Z + 20; z > TURN_START_Z; z -= 1) pts.push({ x: lane, z });

  // 코너 — 제어점을 (차로, 진출차로)에 두는 2차 베지어
  for (let i = 0; i <= 50; i += 1) {
    const t = i / 50;
    const m = 1 - t;
    pts.push({
      x: m * m * lane + 2 * m * t * lane + t * t * TURN_END_X,
      z: m * m * TURN_START_Z + 2 * m * t * PLAYER_EXIT_Z + t * t * PLAYER_EXIT_Z,
    });
  }

  // 진출 직선 — 완주선 너머까지 두어 마지막 순간에도 볼 점이 남게 한다
  for (let x = TURN_END_X; x < FINISH_X + 25; x += 1) pts.push({ x, z: PLAYER_EXIT_Z });

  return pts;
}

const PATH = buildPath();

/** 조향 최대각 (Vehicle 의 MAX_STEER 와 같아야 -1~1 로 정규화된다) */
const MAX_STEER = 0.62;

export class AutoDriver {
  /** 지금 어느 관문 앞인가 */
  /*
    관문은 만나는 순서다 — **S → 정지선 → C**. `schoolZone` 이 먼저인 이유는
    그 횡단보도가 교차로보다 앞(z 46~50)에 있기 때문이다.
  */
  private gate: 'schoolZone' | 'stopLine' | 'crosswalkC' | 'clear' = 'schoolZone';
  /** 그 관문에서 요구되는 일시정지를 이미 마쳤는가 */
  private heldAtGate = false;
  /** 길 위에서 지금 어디쯤인지 (뒤로 되돌아가지 않게 앞으로만 움직인다) */
  private pathIndex = 0;

  /**
   * @param brakeDecel 이 차의 제동 감속도 (m/s²). 난이도가 오르면 브레이크가 무르고 더 빨리 다가가므로
   *   (scenarios/challenge.ts 의 pace) 제동을 시작할 거리를 늘린다. 시범 주행은 기본값(쉬움)이다.
   */
  constructor(
    private wheelbase: number,
    private brakeDecel = 4.8,
  ) {}

  /** 관문 앞에서 제동을 시작할 거리 — 지금 속도로 서는 거리에 여유를 더한다 (BRAKE_DISTANCE 보다 짧지 않게) */
  private brakeDistance(speedKmh: number): number {
    const v = speedKmh / 3.6;
    return Math.max(BRAKE_DISTANCE, (v * v) / (2 * this.brakeDecel) + 1.8);
  }

  decide(s: AutoDriveState): VehicleInput {
    this.advanceGate(s);
    return {
      stop: this.shouldStop(s),
      steer: this.steer(s),
      // 우회전 시나리오라 깜빡이는 처음부터 끝까지 켜 둔다 (제38조 제1항)
      rightSignal: true,
    };
  }

  // ── 정지 판단 ────────────────────────────────────────────────────────────

  /** 관문을 지났으면 다음 관문으로 넘어간다 */
  private advanceGate(s: AutoDriveState): void {
    /*
      진입부 보호구역이 없는 판에서는 이 관문을 그냥 지나친다 — 첫 프레임에 바로
      다음 관문으로 넘어가므로, 구간이 없는 판의 동작은 예전과 글자 그대로 같다.
    */
    if (this.gate === 'schoolZone' && (!s.approachZone || s.frontZ <= CROSSWALK_S_OUTER)) {
      this.gate = 'stopLine';
      this.heldAtGate = false;
    }
    if (this.gate === 'stopLine' && s.frontZ <= STOP_LINE) {
      this.gate = 'crosswalkC';
      this.heldAtGate = false;
    }
    if (this.gate === 'crosswalkC' && s.frontX >= CROSSWALK_INNER) {
      this.gate = 'clear';
      this.heldAtGate = false;
    }
  }

  private shouldStop(s: AutoDriveState): boolean {
    /*
      **앞차가 먼저다.** 신호가 녹색이어도 앞차가 서면 선다 — 어떤 관문에 있든, 관문을 다
      지난 뒤든 같다. 앞차가 속도를 줄이는 중이면 그 차의 속도만큼만 여유를 덜어 준다.
    */
    if (s.lead && s.lead.gap < followStopGap(Math.max(0, s.speedKmh - s.lead.speedKmh))) {
      return true;
    }
    if (this.gate === 'clear') return false;

    const blocked = this.gateBlocked(s);
    const needHold = this.gateNeedsFullStop(s);

    // 관문까지 남은 거리 — 아직 멀면 굳이 서지 않고 서행으로 다가간다
    const distance =
      this.gate === 'schoolZone'
        ? s.frontZ - STOP_LINE_S
        : this.gate === 'stopLine'
          ? s.frontZ - STOP_LINE
          : CROSSWALK_INNER - s.frontX;

    /*
      완전히 선 채로 충분히 버텼으면 그 관문의 일시정지 의무는 끝난 것이다 — **관문 앞에서
      선 것만** 센다. 예전에는 어디서든 섰으면 쳤는데, 앞차 뒤에 줄 서서 선 것까지 치면
      앞차가 떠난 뒤 정지선을 그냥 지나간다. 그건 정지선 직전의 일시정지가 아니다
      (판정의 WorldSample.queuedBehind).
    */
    if (s.speedKmh <= 0.5 && s.stopHold >= HOLD_TARGET && distance <= this.brakeDistance(0) + 0.5) {
      this.heldAtGate = true;
    }

    if (!blocked && (!needHold || this.heldAtGate)) return false;
    return distance <= this.brakeDistance(s.speedKmh);
  }

  /** 지금은 어떤 경우에도 갈 수 없다 (사라질 때까지 기다린다) */
  private gateBlocked(s: AutoDriveState): boolean {
    if (this.gate === 'schoolZone') {
      /*
        **여기 적색은 서서 기다리는 것이다.** 교차로 적색처럼 "서고 나서 통행" 이
        아니라, 녹색으로 바뀔 때까지 갈 수 없다 (violations.ts 의 SCHOOL_ZONE_RED).
      */
      const light = s.approachZone?.light ?? null;
      if (light !== null && light !== 'green') return true;
      return pedConflict(s, 'S');
    }
    if (this.gate === 'stopLine') {
      // 진출로가 막혔는데 들어가면 교차로 안에 갇힌다 (제25조 제5항 · 꼬리물기)
      if (s.exitBlocked) return true;
      /*
        우회전 신호등이 있으면 **다른 신호등에도 불구하고 이 등화를 따른다**
        (시행규칙 [별표 2] 비고 제3호). 녹색 화살표가 아니면 우회전 자체가 금지다.
      */
      if (s.rightArrow !== null && s.rightArrow !== 'greenArrow') return true;
      // 진입 전 횡단보도를 건너는 사람 (제27조 제1항)
      return pedConflict(s, 'A');
      /*
        **진출 쪽 횡단보도(C)는 여기서 보지 않는다.**

        한때 정지선에서 서는 김에 C 까지 함께 봤는데, 그러면 **서로 기다리다 아무도
        움직이지 않는다.** C 앞에 선 보행자는 차가 가까이 와야 건너기 시작하는데
        (Pedestrian 의 startWithin), 차는 그 사람이 건널 때까지 정지선에서 기다린다.
        08번처럼 조건이 무작위인 판에서 실제로 100초를 서 있다가 시간 초과로 끝났다.

        법으로 봐도 이쪽이 맞다 — 일시정지는 **내가 건너려는 횡단보도 앞**에서 하는
        것이지(제27조 제1항) 두 정거장 앞에서 하는 것이 아니다.
      */
    }
    // 우회전 후 횡단보도 — 보행신호 색이 아니라 **보행자의 통행 여부**가 기준이다
    return pedConflict(s, 'C');
  }

  /** 갈 수는 있으나 **한 번은 완전히 서야** 한다 */
  private gateNeedsFullStop(s: AutoDriveState): boolean {
    if (this.gate === 'stopLine') {
      /*
        우회전 신호등이 있으면 그것이 정면 차량신호등을 대신한다 — 녹색 화살표는
        "화살표시 방향으로 진행할 수 있다" 는 뜻이라 정지 의무가 없다.
      */
      if (s.rightArrow !== null) return false;
      // 정면 적색이면 보행자 유무와 관계없이 일시정지 (시행규칙 [별표 2] 적색의 등화 제2호)
      if (s.vehicleLight === 'red' || s.vehicleLight === 'redFlash') return true;
      // 황색은 정지선 직전에서 멈출 수 있으면 멈춘다 — 정답 주행이므로 무리해서 들어가지 않는다
      if (s.vehicleLight === 'yellow') return true;
      // 어린이보호구역의 신호기 없는 횡단보도 (제27조 제7항)
      return s.isSchoolZone && s.pedSignal.A === null;
    }
    if (this.gate === 'schoolZone') {
      // 신호기가 없으면 보행자 유무와 무관하게 일시정지 (제27조 제7항)
      return s.approachZone !== null && s.approachZone.light === null;
    }
    return s.isSchoolZone && s.pedSignal.C === null;
  }

  // ── 조향 ─────────────────────────────────────────────────────────────────

  /**
   * 순수 추종(pure pursuit) — 길 위에서 **앞을 내다본 한 점**을 향해 핸들을 감는다.
   *
   * 지금 위치의 오차만 보고 감으면 코너에서 늘 늦게 돌아 바깥으로 밀린다. 앞의 점을
   * 보면 코너가 오기 전에 미리 감기 시작해, 사람이 도는 것과 같은 선이 나온다.
   * 내다보는 거리는 속도에 비례한다 — 빠를수록 멀리 봐야 흔들리지 않는다.
   */
  private steer(s: AutoDriveState): number {
    const speed = s.speedKmh / 3.6;
    const lookahead = Math.max(3, Math.min(8, 2.5 + speed * 0.6));

    // 길 위에서 지금 가장 가까운 점 — 앞으로만 찾는다 (되돌아가면 코너에서 갇힌다)
    let best = this.pathIndex;
    let bestDist = Infinity;
    for (let i = this.pathIndex; i < Math.min(PATH.length, this.pathIndex + 60); i += 1) {
      const d = Math.hypot(PATH[i].x - s.x, PATH[i].z - s.z);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    this.pathIndex = best;

    // 거기서부터 내다보는 거리만큼 더 간 점
    let target = PATH[PATH.length - 1];
    let walked = 0;
    for (let i = best; i < PATH.length - 1; i += 1) {
      walked += Math.hypot(PATH[i + 1].x - PATH[i].x, PATH[i + 1].z - PATH[i].z);
      if (walked >= lookahead) {
        target = PATH[i + 1];
        break;
      }
    }

    // 차 기준으로 그 점이 얼마나 옆에 있는가 (오른쪽이 +)
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const rx = Math.cos(s.yaw);
    const rz = -Math.sin(s.yaw);
    const dx = target.x - s.x;
    const dz = target.z - s.z;
    const lateral = dx * rx + dz * rz;
    const ahead = dx * fx + dz * fz;

    // 자전거 모델의 조향각 — κ = 2·lateral / L², δ = atan(wheelbase·κ)
    const L = Math.max(1, Math.hypot(ahead, lateral));
    const curvature = (2 * lateral) / (L * L);
    const angle = Math.atan(this.wheelbase * curvature);
    return Math.max(-1, Math.min(1, angle / MAX_STEER));
  }
}

/**
 * 그 횡단보도에 **통행 중이거나 통행하려는** 보행자가 있는가 (제27조 제1항).
 *
 * 판정 엔진이 위반을 잡는 조건과 같은 값을 본다 — 보행신호 색은 보지 않는다.
 * 이것이 이 게임이 가르치려는 한 가지다.
 */
function pedConflict(s: AutoDriveState, id: CrosswalkId): boolean {
  return s.pedestrians.some(
    // `active`(결과 지도용, 등장 시각 뒤에야 켜짐)는 보지 않는다 — 판정과 같은 기준이다
    (p) => p.crosswalk === id && p.intendsToCross && p.onConflictPath,
  );
}

/** 완주선을 넘었는가 — 자율 주행이 끝났는지 판단하는 데 쓴다 */
export const isFinished = (s: AutoDriveState): boolean => s.frontX > FINISH_X;

/** 진출 횡단보도를 완전히 벗어났는가 */
export const passedExitCrosswalk = (s: AutoDriveState): boolean => s.frontX > CROSSWALK_OUTER;
