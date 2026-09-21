/**
 * 앞차 — **상태기계만** 떼어 낸 것. 메시도 three 도 없다.
 *
 * ## 왜 앞차인가
 *
 * 실제 우회전에서 판단을 흐리는 가장 흔한 것은 신호도 보행자도 아니고 **바로 앞의 차**다.
 *
 *  - **앞차가 선다** — 내가 보고 있던 것은 신호등인데 앞차가 정지선에서 섰다. 제때 안
 *    서면 추돌이고, 앞차 차체가 횡단보도의 보행자를 가린다.
 *  - **앞차가 그냥 간다** — 적색인데 앞차가 일시정지 없이 우회전해 나간다. "앞차가 가니까"
 *    따라가는 순간 내 위반이다. 규정은 앞차가 아니라 **나에게** 걸린다.
 *
 * 둘째가 이 게임이 교정하려는 오해와 정확히 겹친다 — 사람이 법을 안 지키게 되는 이유는
 * 모르는 것보다 **남들이 안 지키는 것을 보는 것**인 경우가 많다. 뒷차의 경적(TrafficCar)이
 * 뒤에서 오는 압박이라면, 이쪽은 앞에서 오는 압박이다.
 *
 * ## 왜 떼어 냈는가
 *
 * 보행자(pedWalk.ts)와 같은 이유다. 이 로직은 두 곳에서 돌아야 한다.
 *
 *  - **게임** (Game.ts · TrafficCar 'leader') — 이 자세를 차체에 붙여 그린다
 *  - **시나리오 검증기** (scenarios/validate.ts) — AI 가 만든 앞차 판을 사람에게 주기 전에
 *    "규정대로 몰면 추돌 없이 통과하는가" 를 돌려 본다
 *
 * 두 곳이 각자 구현하면 검증기가 통과시킨 판에서 실제로는 앞차가 다른 자리에 서고,
 * 그 어긋남은 아무도 눈치채지 못한다. 그래서 **한 벌만 둔다.**
 *
 * ## 앞차는 사람을 치지 않는다
 *
 * 나쁜 본보기 앞차(`rolling`)가 건너뛰는 것은 **일시정지 의무뿐**이다. 신호가 금지한 진행
 * (적색 화살표 · 보호구역 적색)과 보행자 양보는 두 성향 모두 지킨다. 배경 차가 사람 사이로
 * 지나가는 화면은 무엇을 가르치든 해롭고, "앞차가 서지 않았다" 한 가지만 보여 줘야
 * 학습자가 그 한 가지에 대해 판단한다.
 */

import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_S_OUTER,
  LANE_WIDTH,
  PLAYER_APPROACH_X,
  STOP_LINE,
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
import {
  arcLengths,
  buildPath,
  buildStraightPath,
  poseAt,
  projectOnPath,
  type Vec2,
} from '../scenarios/turnPath';
import { ACCEL, DEFAULT_PACE, EASE_DECEL, zoneTargetKmh } from './Vehicle';
import type { DrivePace } from '../scenarios/challenge';

/** 앞차의 성향 */
export type LeadBehavior = 'lawful' | 'rolling';

/**
 * 앞차가 **어디로 가는가.**
 *
 * `straight` 가 우회전을 막는 가장 현실적인 상황이다 — 우회전 차로가 따로 없는 교차로에서
 * 앞차가 직진 대기 중이면, 적색에 우회전이 허용되는 나도 그 차 뒤에서 기다릴 수밖에 없다.
 * **직진은 적색에 갈 수 없기 때문**이다(우회전만 "정지 후 진행" 이다). 그 차를 피해 옆으로
 * 돌아 나가면 대회전·정지선 위반으로 잡힌다 — 그 판정은 이미 판정 엔진이 한다.
 */
export type LeadPath = 'right' | 'straight';

/** 시나리오에 적는 앞차 — scenarios.ts 의 `ScenarioSpec.leadCar` */
export interface LeadCarSpec {
  /**
   * - `lawful`  — 규정대로 선다. 따라가다 제때 서지 않으면 추돌한다
   * - `rolling` — **일시정지를 건너뛴다.** 적색인데 서행만 하고 우회전해 나간다
   */
  behavior: LeadBehavior;
  /**
   * **차간 시간** (초). 내 앞범퍼가 앞차 뒷범퍼가 있던 자리에 닿기까지 걸리는 시간.
   * 기본 `LEAD_HEADWAY_DEFAULT`.
   *
   * ## 왜 미터가 아니라 초인가
   *
   * 처음에는 출발 간격을 미터로 적었다. 그런데 앞차는 나보다 먼저 감속 구간에 들어가므로,
   * 14m 로 출발시켰더니 **5초 만에 2.5m 로 붙었다** — 앞차는 이미 25km/h 인데 나는 아직
   * 40km/h 였다. 두 차는 같은 속도표(Vehicle.ts 의 `zoneTargetKmh`)로 달리기 때문에
   * **시간 간격은 판 내내 그대로이고 거리만 속도에 따라 늘었다 줄었다 한다.**
   * 그래서 시간으로 적는다. 2초면 서행(12km/h)에서 6.7m 가 남아, 앞차가 서는 것을 보고
   * 반응(1초 ≒ 3.3m)해 설 수 있다.
   */
  headway?: number;
  /**
   * 앞차가 가는 방향. 기본 `right`.
   *
   * `straight` 일 때 `behavior` 는 뜻이 없다 — 직진에는 건너뛸 일시정지 의무가 없고,
   * 적색이면 성향과 무관하게 녹색까지 기다린다. 검증기가 `rolling` + `straight` 를 버린다.
   */
  path?: LeadPath;
}

/**
 * 검증기가 앞차를 굴릴 때 쓰는 차 길이의 절반 (m).
 *
 * 게임은 배역표에서 차를 뽑아 길이가 4.6~5.0m 로 판마다 다르다. 검증은 **가장 긴 차**로
 * 한다 — 앞차가 길수록 그 뒤에 선 내 차가 정지선에서 멀어지므로, 가장 불리한 경우에도
 * "정지선 앞 일시정지" 로 인정되는 자리(정지선 앞 12m)에 설 수 있어야 한다.
 */
export const LEAD_HALF_LENGTH_MAX = 2.5;

export const LEAD_HEADWAY_DEFAULT = 2.0;
/** 이보다 좁으면 앞차가 설 때 사람이 반응할 수 없다 — 시험이 아니라 함정이 된다 */
export const LEAD_HEADWAY_MIN = 1.4;
/** 이보다 넓으면 앞차가 정지선을 떠난 뒤에야 내가 닿아 "따라간다" 는 상황이 흐려진다 */
export const LEAD_HEADWAY_MAX = 4.0;

/**
 * 앞차 경로의 시작 z. **어떤 출발 자리보다도 뒤**여야 한다 — 경로상 거리(s)를 내 차와
 * 같은 좌표로 재기 위해서다 (보호구역 판의 출발 자리가 174 다 — layout.ts 의 SPAWN_Z_SCHOOL_ZONE).
 */
const PATH_START_Z = 240;

/** 진출로를 어디까지 달리는가. 이 너머로 가면 화면에서 뺀다 */
const PATH_END_X = 160;
const GONE_X = 120;
/** 직진 앞차가 교차로를 지나 북쪽으로 이만큼 가면 화면에서 뺀다 */
const GONE_Z = -60;

/**
 * 직진 앞차와의 간격을 잴 때 **내가 같은 차로에 있다고 볼 가로 오차** (m).
 *
 * 이보다 벗어났으면 나는 그 차 뒤가 아니다 — 옆 차로로 나가 앞지르는 중이거나 이미
 * 우회전을 시작했다. 차로 폭의 절반보다 조금 크게 잡는다.
 */
const SAME_LANE_TOLERANCE = LANE_WIDTH * 0.6;

/*
  가속 · 감속은 **내 차(Vehicle.ts)와 같은 값**이다 (ACCEL · EASE_DECEL 을 그대로 가져온다).

  처음에는 뒷차(TrafficCar)처럼 가속을 2.2 로 두었다. 두 차가 같은 속도표를 따르는데
  가속만 느리니, 서행 구간을 벗어나 다시 속도를 올릴 때마다 내가 앞차를 조금씩 따라잡았다 —
  보호구역 판에서는 교차로 정지선에 닿을 즈음 간격이 1m 까지 줄었다. 같은 값이면 앞차의
  움직임은 내 차의 움직임을 **차간 시간만큼 앞당긴 것**이 되어 간격이 판 내내 유지된다.
*/
/** 정지 지점을 향해 줄일 때 쓰는 감속도 — 이 값으로 √(2·a·남은거리) 를 만든다 */
const STOP_DECEL = 2.4;
/** 코앞에서 사람이 나섰을 때만 쓰는 급제동 */
const HARD_DECEL = 6.5;

/**
 * 정지선 **앞** 얼마에 서는가 (m, 앞범퍼 기준).
 *
 * AutoDriver 와 같은 사고다 — 정지선에 딱 붙이면 한 프레임 차이로 넘는다. 게다가 앞차가
 * 정지선을 밟고 서면 "정지선 앞에 선다" 를 가르치는 화면에서 본보기가 어긋난다.
 */
const STOP_MARGIN = 0.8;

/**
 * 규정대로 서는 앞차가 **완전히 서서 버티는 시간** (초).
 *
 * 판정 기준(0.5초)보다 한참 길다. 따라오는 사람이 "앞차가 섰다" 를 알아보고 자기도 설
 * 시간이 있어야 하고, 무엇보다 **서고 나서 다시 가는 것**이 한눈에 보여야 한다.
 */
const FULL_STOP_HOLD = STOP_HOLD_SECONDS + 1.5;

/**
 * 이 간격(m) 안에서 앞차 뒤에 서 있으면 **줄 서 있다** 로 본다 (`queuesAhead`).
 * 앞차 뒤에 서는 간격이 2.5~4m 라(driveSim · AutoDriver) 그보다 넉넉하게 잡는다.
 */
const QUEUE_GAP = 8;

/** 보행자가 차도를 벗어난 뒤 다시 움직이기까지 (초) — TrafficCar 의 PED_CLEAR_HOLD 와 같다 */
const PED_CLEAR_HOLD = 0.7;

/**
 * **아직 차도에 발을 딛지 않은 '건너려는 사람'** 앞에서 기다리는 한도 (초).
 *
 * ## 이것이 없으면 셋이 서로를 기다린다
 *
 * 보행자는 **내가 가까이 와야** 발을 뗀다 (PedSpawn.startWithin — 어떤 속도로 와도 같은
 * 장면이 되게 하는 장치다). 그런데 앞차가 그 사람에게 양보하느라 서면, 나는 앞차에 막혀
 * 다가가지 못하고, 다가가지 못하니 사람은 영영 출발하지 않고, 사람이 출발하지 않으니 앞차도
 * 영영 가지 않는다. 실제로 그렇게 멈춰 선 판이 나왔다 — 검증기는 내가 앞차 뒤에서 기다리는
 * 시간을 제한시간 안으로 보고 통과시켰는데, 화면에서는 아무도 움직이지 않았다.
 *
 * ## 실제 운전에서도 이렇게 한다
 *
 * 건널 듯하던 사람이 서 있기만 하면 차는 간다. **차도에 발을 디딘 사람에게는 이 한도가
 * 걸리지 않는다** — 그 사람은 통행 중이고, 통행이 끝날 때까지 기다리는 것이 규정이다
 * (제27조 제1항). 한도가 푸는 것은 "건너려는 뜻만 있는" 쪽뿐이다.
 *
 * 앞차가 다시 움직이면 그 사람은 어차피 나서지 않는다 (`blocksCrosswalk`) — 설 수 없는
 * 거리까지 온 차 앞으로는 걸어 나오지 않기 때문이다.
 */
const INTENT_WAIT_CAP = 3.5;

/** 앞차가 보는 세계 — 판정에 넘기는 것과 같은 출처의 값만 받는다 */
export interface LeadWorld {
  vehicleLight: LightColor;
  rightArrow: RightArrowColor | null;
  pedSignal: Record<CrosswalkId, PedSignal | null>;
  approachZone: { light: LightColor | null } | null;
  pedestrians: PedestrianSample[];
  exitBlocked: boolean;
  isSchoolZone: boolean;
}

/** 앞차가 서야 할 수도 있는 자리 하나 — 만나는 순서대로 S → A → C */
interface Gate {
  id: CrosswalkId;
  /** 서는 자리 (앞범퍼의 경로상 거리) */
  stopAt: number;
  /** 앞범퍼가 횡단보도에 들어서는 자리 */
  enterAt: number;
  /** 뒷범퍼까지 횡단보도를 벗어나는 자리 (앞범퍼 기준으로 환산) */
  exitAt: number;
}

export class LeadDrive {
  readonly behavior: LeadBehavior;
  readonly path: LeadPath;
  readonly halfLength: number;

  private readonly pts: Vec2[];
  private readonly acc: number[];
  private readonly gates: Gate[];
  private readonly schoolZone: boolean;
  /** 다가가는 속도 — 내 차와 같다 (생성자의 opts.pace) */
  private readonly pace: DrivePace;
  private readonly approachZone: boolean;

  /** 차 중심의 경로상 거리 */
  private s: number;
  private v: number;

  private gateIndex = 0;
  /** 지금 관문에서 완전히 서서 버티기를 마쳤는가 — 마친 뒤에는 다시 서지 않는다 */
  private stopDone = false;
  /** 앞범퍼가 지금 관문의 정지 자리를 지났는가 */
  private crossedLine = false;
  /** 정지 자리에 닿기 직전에 일시정지 의무가 있었는가 */
  private dutyAtLine = false;
  /** 완전히 선 채로 버틴 시간 */
  private held = 0;
  /** 보행자가 비키고 나서 남은 대기 */
  private pedHold = 0;
  /** '건너려는 뜻만 있는' 사람 앞에서 서 있은 시간 (INTENT_WAIT_CAP) */
  private intentWait = 0;
  private braking = false;
  /** 일시정지 의무가 있는 자리를 서지 않고 지나갔는가 (`rolling` 만 참이 된다) */
  private skipped: CrosswalkId[] = [];

  constructor(
    spec: LeadCarSpec,
    opts: {
      /** 내 차의 출발 자리 (z, 차 중심) — scenarios.ts 의 `spawnZ` */
      playerSpawnZ: number;
      /** 내 차 길이의 절반 — 출발 간격을 앞범퍼에서 재기 위해 */
      playerHalfLength: number;
      /** 앞차 길이의 절반 (차종마다 다르다) */
      halfLength: number;
      isSchoolZone: boolean;
      hasApproachZone: boolean;
      /**
       * 다가가는 속도 — **내 차와 같은 값**을 받는다 (난이도, scenarios/challenge.ts). 앞차가 쉬움의 속도로 달리고 나는
       * 어려움의 속도로 달리면 간격이 줄어, 앞차 뒤로 나서는 사람(PedSpawn.afterLead)이 설 수 없는 거리에서 나서거나
       * 끝내 나서지 못했다. 없으면 쉬움 — 검증기는 이 값으로 잰다.
       */
      pace?: DrivePace;
    },
  ) {
    this.behavior = spec.behavior;
    this.path = spec.path ?? 'right';
    this.halfLength = opts.halfLength;
    this.schoolZone = opts.isSchoolZone;
    this.approachZone = opts.hasApproachZone;
    this.pace = opts.pace ?? DEFAULT_PACE;

    this.pts =
      this.path === 'right'
        ? buildPath('tight', PATH_START_Z, PATH_END_X)
        : buildStraightPath(PATH_START_Z);
    this.acc = arcLengths(this.pts);

    /*
      **내 차가 차간 시간만큼 달려 닿을 자리**에 앞차 뒷범퍼를 둔다. 내 차의 속도표를 그대로
      따라 걸어 본다 — 출발 자리가 보호구역 판이면 50 → 30 으로 줄어드는 구간까지 반영된다.
    */
    const headway = clampHeadway(spec.headway ?? LEAD_HEADWAY_DEFAULT);
    let z = opts.playerSpawnZ;
    for (let t = 0; t < headway; t += 0.01) {
      z -= (zoneTargetKmh(PLAYER_APPROACH_X, z, this.schoolZone, this.approachZone, this.pace) / 3.6) * 0.01;
    }
    const rearZ = z - opts.playerHalfLength;
    this.s = PATH_START_Z - (rearZ - this.halfLength);

    /*
      관문 자리는 **앞범퍼의 경로상 거리**로 잡는다. 진입 직선에서는 z 만으로 역산되지만
      C 는 코너 너머라 경로를 훑어 찾는다 (driveSim 의 distanceWhereFrontX 와 같다).
    */
    const onStraight = (frontZ: number): number => PATH_START_Z - frontZ;
    const whereFrontX = (x: number): number => {
      const total = this.acc[this.acc.length - 1];
      for (let d = 0; d <= total; d += 0.05) {
        if (poseAt(this.pts, this.acc, d - this.halfLength, this.halfLength).front.x >= x) return d;
      }
      return total;
    };
    const len = this.halfLength * 2;
    this.gates = [
      ...(this.approachZone
        ? [
            {
              id: 'S' as const,
              stopAt: onStraight(STOP_LINE_S + STOP_MARGIN),
              enterAt: onStraight(CROSSWALK_S_OUTER),
              exitAt: onStraight(CROSSWALK_S_INNER) + len,
            },
          ]
        : []),
      {
        id: 'A',
        stopAt: onStraight(STOP_LINE + STOP_MARGIN),
        enterAt: onStraight(CROSSWALK_OUTER),
        exitAt: onStraight(CROSSWALK_INNER) + len,
      },
      /*
        **진출 횡단보도(C)는 우회전하는 앞차에게만 있다.** 직진하는 차는 그 횡단보도를
        지나지 않는다 — 대신 교차로 건너편의 횡단보도를 지나지만, 이 게임의 판정과 보행자는
        A·C·S 셋만 두므로 직진 앞차가 볼 관문도 S 와 A 뿐이다.
      */
      ...(this.path === 'right'
        ? [
            {
              id: 'C' as const,
              stopAt: whereFrontX(CROSSWALK_INNER - 1.2),
              enterAt: whereFrontX(CROSSWALK_INNER),
              exitAt: whereFrontX(CROSSWALK_OUTER) + len,
            },
          ]
        : []),
    ];

    // 내 차처럼 **이미 달리는 채로** 출발한다 — 그 자리의 목표 속도로
    const c = this.pose().center;
    this.v = zoneTargetKmh(c.x, c.z, this.schoolZone, this.approachZone, this.pace) / 3.6;
  }

  // ── 읽기 ────────────────────────────────────────────────────────────────

  private get front(): number {
    return this.s + this.halfLength;
  }

  pose(): { center: Vec2; front: Vec2; rear: Vec2; yaw: number } {
    const p = poseAt(this.pts, this.acc, this.s, this.halfLength);
    // Vehicle 과 같은 약속 — 전방 = (-sin yaw, -cos yaw)
    return { center: p.center, front: p.front, rear: p.rear, yaw: Math.atan2(-p.dir.x, -p.dir.z) };
  }

  get speedMs(): number {
    return this.v;
  }

  get speedKmh(): number {
    return this.v * 3.6;
  }

  /** 제동 중인가 — 브레이크등 */
  get isBraking(): boolean {
    return this.braking || this.v < 0.3;
  }

  /** 길 끝까지 빠져나가 화면에서 뺄 때가 됐는가 */
  get gone(): boolean {
    const c = this.pose().center;
    return this.path === 'right' ? c.x > GONE_X : c.z < GONE_Z;
  }

  /** 일시정지 의무가 있던 자리 중 서지 않고 지나간 곳 — 결과 화면과 코치가 쓴다 */
  get skippedStops(): readonly CrosswalkId[] {
    return this.skipped;
  }

  /**
   * 점 (x, z) 에서 **앞차 뒷범퍼까지 경로를 따라 잰 간격** (m).
   *
   * 내 앞범퍼를 넣으면 추돌까지 남은 거리다. 음수면 이미 겹쳤거나(추돌) 내가 앞질렀다.
   * 코너에서는 직선 거리가 실제로 달려야 할 거리보다 짧아, 경로를 따라 잰다.
   */
  gapFrom(x: number, z: number): number {
    if (this.gone) return Infinity;
    /*
      **직진 앞차는 내가 같은 차로에 있을 때만 앞차다.** 그 차가 정지선에 서 있는 동안 내가
      우회전을 시작하면(또는 옆 차로로 나가면) 나는 더 이상 그 뒤가 아니다 — 경로에 수선을
      내리는 방식은 그때도 "바로 뒤" 로 읽어, 이미 비켜선 나를 붙잡아 세운다.
    */
    if (this.path === 'straight') {
      if (Math.abs(x - PLAYER_APPROACH_X) > SAME_LANE_TOLERANCE) return Infinity;
      const rearZ = this.pose().center.z + this.halfLength;
      return z - rearZ;
    }
    return this.s - this.halfLength - projectOnPath(this.pts, this.acc, x, z);
  }

  /**
   * 내 앞범퍼(x, z)가 **이 앞차 뒤에 줄 서 있는가** — 앞차가 나와 다음 정지선 사이에 있다.
   *
   * 판정의 `WorldSample.queuedBehind` 로 넘긴다. 앞차 뒤에서 선 것은 정지선 직전에 선 것이
   * 아니므로 정지선 일시정지로 치지 않는다 (lawRules.ts 의 같은 이름 주석).
   *
   * 조건은 셋이다 — 앞차가 바로 앞(QUEUE_GAP 안)에 있고, 앞차의 앞범퍼가 아직 그 정지선을
   * 넘지 않았고, 나도 그 정지선 전이다. 보호구역 횡단보도(S)와 교차로 정지선(A) 둘 다 본다.
   */
  queuesAhead(x: number, z: number): boolean {
    if (this.gone) return false;
    const gap = this.gapFrom(x, z);
    if (!(gap > -0.5 && gap < QUEUE_GAP)) return false;
    const lead = this.pose().front;
    const lineAhead = this.approachZone && z > STOP_LINE_S ? STOP_LINE_S : STOP_LINE;
    if (z > lineAhead) return lead.z > lineAhead - 1.5;
    /*
      **교차로 안 — 앞차가 진출 횡단보도(C) 앞에 서 있다.** 정지선과 같은 규칙이다. 예전에는 정지선까지만 보아,
      보호구역 신호기 없는 C 앞에서 앞차가 서면 그 뒤에 선 것이 곧 C 앞 일시정지로 인정되었다 (플레이테스트가 잡았다).
    */
    return x < CROSSWALK_INNER && lead.x < CROSSWALK_INNER + 1.5;
  }

  /**
   * 그 횡단보도에 **보행자가 나서면 안 되는 상태**인가.
   *
   * 앞차가 횡단보도 위에 걸쳐 있거나, 달려오고 있어 편안히 설 수 없는 거리 안이다.
   * 보행자 상태기계의 `trafficBusy` 로 넘긴다 — 교차 통행 차량(TrafficCar)과 같은 규칙이다.
   * 서서 기다리는 앞차는 막지 않는다. 그래야 사람이 건너고, 앞차도 다시 간다.
   */
  /**
   * 앞차가 **아직 그 횡단보도를 다 지나지 않았는가** — 앞차 뒤로 나서는 사람(PedSpawn.afterLead)이 기다리는 동안이다.
   *
   * 직진하는 앞차는 C 를 지나지 않는다. 그때는 A 를 벗어나면 내 길에서 비킨 것이다 — 그 뒤로는 내가 C 로 간다.
   */
  inWayOf(id: CrosswalkId): boolean {
    if (this.gone) return false;
    const g = this.gates.find((x) => x.id === id) ?? this.gates.find((x) => x.id === 'A');
    if (!g) return false;
    /*
      뒷범퍼가 **사람이 걷는 선(횡단보도 한가운데)을 1m 지나면** 비킨 것으로 본다. 횡단보도 끝까지 기다리면 그 2m 동안
      뒤따르는 내가 더 다가와, 사람이 나설 수 있는(내가 설 수 있는) 거리가 그만큼 줄었다.
    */
    return this.front <= g.exitAt - AFTER_LEAD_CLEARANCE;
  }

  blocksCrosswalk(id: CrosswalkId): boolean {
    const g = this.gates.find((x) => x.id === id);
    if (!g || this.gone) return false;
    const occupying = this.front >= g.enterAt && this.front <= g.exitAt;
    if (occupying) return true;
    if (this.v < 1) return false;
    const toEnter = g.enterAt - this.front;
    return toEnter >= 0 && toEnter < (this.v * this.v) / (2 * STOP_DECEL) + 2;
  }

  // ── 진행 ────────────────────────────────────────────────────────────────

  update(dt: number, w: LeadWorld): void {
    const gate = this.gates[this.gateIndex] as Gate | undefined;

    let limit = Infinity;
    if (gate) {
      /*
        보행자 — 두 성향 모두 양보한다 (파일 머리 주석). 횡단보도에 들어서기 전까지만 본다.

        **차도 위의 사람과 건너려는 사람을 가른다.** 앞엣사람에게는 통행이 끝날 때까지
        기다리고, 뒤엣사람에게는 한도가 있다 (INTENT_WAIT_CAP — 없으면 교착이 난다).
      */
      if (this.front < gate.enterAt) {
        const onRoad = pedOnRoad(w, gate.id);
        const intending = !onRoad && pedIntending(w, gate.id);
        if (onRoad) {
          this.pedHold = PED_CLEAR_HOLD;
          this.intentWait = 0;
        } else if (intending && this.intentWait < INTENT_WAIT_CAP) {
          this.pedHold = PED_CLEAR_HOLD;
          // **서 있는 동안만 센다** — 다가가는 시간까지 세면 멀리서부터 한도가 깎인다
          if (this.v <= 0.3) this.intentWait += dt;
        } else {
          this.pedHold = Math.max(0, this.pedHold - dt);
        }
      } else {
        this.pedHold = 0;
      }

      /*
        정지 의무와 신호 대기는 **정지 자리를 지나기 전에만** 걸리고, 그때까지 **매 프레임
        다시 본다.** 멀리서 녹색을 보고 "통과" 로 못 박아 두면, 다가가는 사이 적색으로
        바뀌어도 서지 않는다 — 규정대로 서는 앞차가 적색을 밀고 지나가는 그림이 된다.
        못 박는 것은 **완전히 서서 버틴 뒤**뿐이다.
      */
      if (this.front <= gate.stopAt + 0.05) {
        if (this.v <= 0.05 && this.front >= gate.stopAt - 0.3) this.held += dt;
        if (this.held >= FULL_STOP_HOLD) this.stopDone = true;
        const needsStop = this.needsFullStop(gate, w) && !this.stopDone;
        if (this.signalHold(gate, w) || needsStop) limit = gate.stopAt;
        this.dutyAtLine = this.dutyToStop(gate, w);
      } else if (!this.crossedLine) {
        this.crossedLine = true;
        /*
          **나쁜 본보기가 여기서 갈린다.** 규정대로라면 서야 했던 자리를 서지 않고 지나갔으면
          기록해 둔다 — 결과 화면과 코치가 "앞차가 서지 않았다" 를 짚을 근거다.
        */
        if (this.dutyAtLine && this.held === 0 && !this.skipped.includes(gate.id)) {
          this.skipped.push(gate.id);
        }
      }
      if (this.pedHold > 0) {
        // 이미 정지 자리를 지나 사람이 나섰다면 그 자리에서 선다
        limit = Math.min(limit, Math.max(this.front, gate.stopAt));
      }

      if (this.front > gate.exitAt) {
        this.gateIndex++;
        this.stopDone = false;
        this.crossedLine = false;
        this.dutyAtLine = false;
        this.held = 0;
        this.pedHold = 0;
        this.intentWait = 0;
      }
    }

    const c = this.pose().center;
    let target = zoneTargetKmh(c.x, c.z, this.schoolZone, this.approachZone, this.pace) / 3.6;
    if (Number.isFinite(limit)) {
      const remain = Math.max(0, limit - this.front);
      target = Math.min(target, remain < 0.05 ? 0 : Math.sqrt(2 * STOP_DECEL * remain));
    }

    const before = this.v;
    if (this.v < target) {
      this.v = Math.min(target, this.v + ACCEL * dt);
    } else {
      // 코앞에서 서야 하면 세게, 평소에는 부드럽게
      const urgent = Number.isFinite(limit) && target < this.v - 1;
      this.v = Math.max(target, this.v - (urgent ? HARD_DECEL : EASE_DECEL) * dt);
    }
    this.braking = this.v < before - dt * 0.5;

    this.s += this.v * dt;
    // 서야 할 자리를 넘지 않는다 — 1차 지연으로 쫓는 탓에 몇십 cm 씩 기어 넘는 것을 자른다
    if (Number.isFinite(limit) && this.front > limit) {
      this.s = Math.max(this.s - this.v * dt, limit - this.halfLength);
      this.v = 0;
    }
    const total = this.acc[this.acc.length - 1];
    if (this.s > total) this.s = total;
  }

  /** 신호가 **진행 자체를 금지**하는가 — 두 성향 모두 지킨다 */
  private signalHold(gate: Gate, w: LeadWorld): boolean {
    if (gate.id === 'S') {
      const light = w.approachZone?.light ?? null;
      return light !== null && light !== 'green';
    }
    if (gate.id === 'A') {
      /*
        **직진은 적색에 갈 수 없다.** 우회전만 "정지 후 진행" 이고(시행규칙 [별표 2] 적색의
        등화 제2호), 직진 차는 녹색이 될 때까지 정지선에서 기다린다. 이 한 줄이 직진 앞차를
        우회전 앞차와 전혀 다른 상황으로 만든다 — 뒤에 선 나는 기다릴 수밖에 없다.
      */
      if (this.path === 'straight') return w.vehicleLight !== 'green';
      // 진출로가 막혔는데 들어가면 교차로 안에 갇힌다 (제25조 제5항)
      if (w.exitBlocked) return true;
      // 우회전 신호등은 녹색 화살표일 때만 진행 (시행규칙 [별표 2] 비고 제3호)
      return w.rightArrow !== null && w.rightArrow !== 'greenArrow';
    }
    return false;
  }

  /** 규정상 **한 번은 완전히 서야** 하는 자리인가 */
  private dutyToStop(gate: Gate, w: LeadWorld): boolean {
    if (gate.id === 'S') return w.approachZone !== null && w.approachZone.light === null;
    if (gate.id === 'A') {
      // 직진 차에는 일시정지 의무가 없다 — 적색이면 아예 못 가고(위 signalHold), 녹색이면 그냥 간다
      if (this.path === 'straight') return false;
      if (w.rightArrow !== null) return false;
      if (w.vehicleLight !== 'green') return true;
      return this.schoolZone && w.pedSignal.A === null;
    }
    return this.schoolZone && w.pedSignal.C === null;
  }

  /** 이 앞차가 그 의무를 **지키는가** — 성향이 갈리는 유일한 자리다 */
  private needsFullStop(gate: Gate, w: LeadWorld): boolean {
    return this.behavior === 'lawful' && this.dutyToStop(gate, w);
  }
}

/**
 * **차도 위에 사람이 있는가** — 통행이 끝날 때까지 기다려야 하는 쪽 (제27조 제1항).
 *
 * `state` 가 없는 표본은 **차도 위로 본다.** 이 값은 판정용 표본에 늘 들어 있지만
 * (pedWalk.ts 의 `sample`), 없을 때 안전한 쪽은 "기다린다" 다.
 */
function pedOnRoad(w: LeadWorld, id: CrosswalkId): boolean {
  return w.pedestrians.some(
    (p) =>
      p.crosswalk === id &&
      p.onConflictPath &&
      p.active !== false &&
      (p.state === undefined || p.state === 'crossing'),
  );
}

/** 보도에서 **건너려고 서 있는** 사람이 있는가 — 한도(INTENT_WAIT_CAP)가 걸리는 쪽 */
function pedIntending(w: LeadWorld, id: CrosswalkId): boolean {
  return w.pedestrians.some(
    // `active`(결과 지도용, 등장 시각 뒤에야 켜짐)는 보지 않는다 — 판정과 같은 기준이다
    (p) => p.crosswalk === id && p.intendsToCross && p.onConflictPath,
  );
}

/** 앞차 뒷범퍼가 횡단보도 먼 끝보다 이만큼 앞이면(= 한가운데를 1m 지나면) 사람이 걷는 선을 비킨 것이다 (m) */
const AFTER_LEAD_CLEARANCE = 1.0;

export const clampHeadway = (h: number): number =>
  Math.max(LEAD_HEADWAY_MIN, Math.min(LEAD_HEADWAY_MAX, h));
