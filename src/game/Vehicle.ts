/**
 * 플레이어 차량.
 *
 * 이 시뮬레이터가 가르치려는 것은 **신호 준수와 상황 판단**이지 속도 조절 기술이 아니다.
 * 그래서 주행 속도는 고정이고, 차종에 따라 달라지지도 않는다.
 * 운전자가 하는 결정은 오직 두 가지 — **언제 멈추고 언제 다시 갈 것인가**, 그리고 조향이다.
 *
 * 속도는 위치에 따라 자동으로 조절된다. 교차로와 횡단보도 부근에서는 서행 속도로 내려가므로
 * (도로교통법 제25조 제1항) 플레이어가 서행 의무를 신경 쓸 필요가 없다.
 *
 * 좌표계: 전방 = -Z (yaw=0), yaw가 감소하면 우회전.
 */

import {
  CROSSWALK_OUTER,
  INTERSECTION_HALF,
  PLAYER_APPROACH_X,
  SPAWN_Z,
  STOP_LINE,
  APPROACH_ZONE_FAR_Z,
  APPROACH_ZONE_NEAR_Z,
  CROSSWALK_S_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_INNER,
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  STOP_LINE_S,
} from '../layout';
import type { DrivePace } from '../scenarios/challenge';

/** 일반 주행 속도 (km/h) */
export const CRUISE_KMH = 40;

/**
 * 진입부 어린이보호구역 판에서 **구역 밖**을 달릴 때의 속도 (km/h).
 *
 * 「안전속도 5030」의 도시부 일반도로 제한속도가 50km/h 다. 이 판에만 이 값을 쓰는
 * 이유는 **가르치려는 것이 대비**이기 때문이다 — 보호구역은 30km/h 인데(제12조 제1항)
 * 일반도로를 40 으로 달려오면 들어서며 10 줄어들 뿐이라 계기판이 거의 움직이지 않고,
 * "여기서부터 다른 길" 이라는 것이 몸에 남지 않는다. 50 → 30 이면 눈에 보인다.
 *
 * 다른 판(SPAWN_Z=68)에는 이 속도를 낼 직선이 없다 — 출발하자마자 정지선 접근이라
 * 올렸다가 곧바로 줄이는 꼴이 된다. 그래서 긴 진입로가 있는 이 판에서만이다.
 */
export const ROAD_KMH = 50;

/** 교차로 접근 구간 속도 (km/h) */
export const APPROACH_KMH = 25;

/**
 * 어린이보호구역 제한속도 (km/h).
 *
 * 도로교통법 제12조 제1항 — 시장등은 어린이보호구역의 통행속도를 **시속 30km 이내**로
 * 제한할 수 있고, 실제 지정 구역은 모두 30km/h 다. 이 게임은 속도를 자동으로 몰기 때문에
 * 플레이어가 지킬 수 있는 값이 아니라 **시뮬레이터가 지켜야 하는 값**이다 —
 * 어린이보호구역을 40km/h 로 달리는 화면을 보여 주면서 규정을 가르칠 수는 없다.
 */
export const SCHOOL_ZONE_KMH = 30;

/**
 * 교차로·횡단보도 부근의 서행 속도 (km/h).
 * 법정 서행 기준(즉시 정지할 수 있는 속도)을 넉넉히 만족하고,
 * 보행자를 발견한 뒤 정지선 앞에 설 여유도 남긴다.
 */
export const SLOW_KMH = 12;

/**
 * 정지선까지 이만큼 남으면 서행으로 내려간다 (m).
 *
 * 정지 안내가 뜨는 시점(정지선 12m 전)에는 이미 서행 중이어야 한다.
 * 25km/h 로 안내를 받으면 반응(1.5초 ≒ 10m) + 제동(5m) 이 필요해
 * 안내를 보고 밟아도 정지선을 넘게 된다. 서행(12km/h)이면 6m면 선다.
 */
const SLOW_BEFORE_LINE = 18;

/** 정지선까지 이만큼 남으면 접근 속도로 내려간다 (m) */
const APPROACH_BEFORE_LINE = 34;

/** 교차로 안·진출로에서 서행을 유지할 중심 거리 (m) */
const SLOW_RADIUS = CROSSWALK_OUTER + 5;

/** 교차로 안·진출로의 접근 구간 중심 거리 (m) */
const APPROACH_RADIUS = CROSSWALK_OUTER + 18;

/** 가속도 (m/s²) — 모든 차량 동일. 앞차(leadDrive.ts)도 이 값을 쓴다 */
export const ACCEL = 3.2;

/** 정지 지시를 받았을 때의 감속도 (m/s²) */
const BRAKE_DECEL = 4.8;

/** 구간이 바뀌며 자연스럽게 속도를 줄일 때의 감속도 (m/s²). 앞차도 이 값을 쓴다 */
export const EASE_DECEL = 2.6;

/**
 * **난이도 1(쉬움)의 주행** — 위 세 값 그대로다. 난이도가 오르면 더 빨리 다가가고 브레이크가 무르다
 * (scenarios/challenge.ts 의 DrivePace). 앞차(leadDrive.ts)는 늘 이 값으로 달린다 — 검증된 앞차의 움직임이
 * 난이도에 따라 달라지면 안 된다.
 */
export const DEFAULT_PACE: DrivePace = { slowKmh: SLOW_KMH, approachKmh: APPROACH_KMH, brakeDecel: BRAKE_DECEL };

/** 조향 최대 각 (rad) */
const MAX_STEER = 0.62;

/** 조향 응답 속도 (rad/s) */
const STEER_RATE = 4.2;

export interface VehicleInput {
  /** 정지 지시. true면 멈춰서 그대로 대기한다. */
  stop: boolean;
  /** -1(좌) ~ +1(우) */
  steer: number;
  /** 우측 방향지시등 */
  rightSignal: boolean;
}

export class Vehicle {
  x = PLAYER_APPROACH_X;
  /**
   * 출발 자리.
   *
   * **생성자가 판을 보고 정한다.** 여기 `SPAWN_Z` 를 못 박아 두었더니, 진입부
   * 보호구역이 있는 판에서 뒤로 물린 자리(scenarios.ts 의 `spawnZ`)가 화면에 반영되지
   * 않았다 — 검증기는 164m 에서 시뮬레이션하는데 실제 차는 68m 에서 출발했다.
   * 68m 는 보호구역 **안**이고 횡단보도까지 16m 라, 출발하자마자 서야 하는 판이 됐다.
   */
  z = SPAWN_Z;
  yaw = 0;
  /** m/s */
  speed = CRUISE_KMH / 3.6;
  /** 현재 앞바퀴 조향각(rad) */
  steerAngle = 0;

  /**
   * 현재 회전 각속도 (rad/s). 우회전이 음수.
   *
   * 카메라의 코너 시선이 이 값을 쓴다. 조향각을 쓰면 서 있는 동안에도(바퀴만 꺾인 상태)
   * 시선이 돌아가 화면이 출렁이지만, 각속도는 차가 실제로 도는 만큼만 나온다.
   */
  yawRate = 0;

  /** 이번 프레임에 감속 중인가 (제동등 표시용) */
  braking = false;

  private wheelbase: number;

  /**
   * @param schoolZone   교차로가 어린이보호구역인가. 참이면 모든 구간을 30km/h 이하로 조인다.
   * @param approachZone 교차로에 닿기 전 **오는 길**이 보호구역인가. 그 구간(layout.ts 의 APPROACH_ZONE_*)
   *                     에서만 30km/h 로 조이고, 횡단보도 S 앞에서는 서행까지 내린다.
   * @param zoneRoad     사거리 없는 보호구역 전용 도로인가 (scenarios.ts 의 `drive === 'zoneOnly'`).
   *                     횡단보도 셋 앞에서 각각 교차로 정지선과 같은 두 단계로 줄인다.
   */
  constructor(
    private carLength: number,
    private schoolZone = false,
    private approachZone = false,
    /**
     * 출발 자리 (z). 판이 정한다 (scenarios.ts 의 `spawnZ`).
     *
     * **인자로 받는다.** 부르는 쪽에서 만든 뒤에 `vehicle.z = …` 로 넣게 두면
     * 잊어버릴 수 있고, 실제로 잊어서 보호구역 판이 통째로 어긋났다.
     */
    spawnZ: number = SPAWN_Z,
    /** 다가가는 속도와 브레이크 — 난이도가 정한다 (위 DEFAULT_PACE) */
    private pace: DrivePace = DEFAULT_PACE,
    private zoneRoad = false,
  ) {
    this.wheelbase = carLength * 0.58;
    this.z = spawnZ;
    /*
      **출발 속도는 그 자리의 목표 속도다.** 예전에는 `CRUISE_KMH` 로 두고 보호구역
      판만 따로 낮췄는데, 구간이 늘어날 때마다 여기에 가지가 하나씩 붙었다. 판이 정한
      자리에서 목표를 물어보면 어긋날 데가 없다 — 보호구역 교차로는 30, 진입부
      보호구역 판은 50(ROAD_KMH), 나머지는 40 으로 그대로 출발한다.
    */
    this.speed = this.zoneTargetKmh() / 3.6;
  }

  get speedKmh(): number {
    return this.speed * 3.6;
  }

  /** 전방 단위벡터 */
  get forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  /** 앞범퍼 중앙 좌표 — 정지선·횡단보도 통과 판정의 기준점 */
  get front(): { x: number; z: number } {
    const f = this.forward;
    const half = this.carLength / 2;
    return { x: this.x + f.x * half, z: this.z + f.z * half };
  }

  private zoneTargetKmh(): number {
    return zoneTargetKmh(this.x, this.z, this.schoolZone, this.approachZone, this.pace, this.zoneRoad);
  }

  /**
   * @param lead 앞차 — 내 앞범퍼에서 앞차 뒷범퍼까지의 간격(m)과 앞차 속도(m/s). 없으면 생략.
   */
  update(input: VehicleInput, dt: number, lead?: { gap: number; speedMs: number } | null): void {
    const zone = this.zoneTargetKmh() / 3.6;
    const target = input.stop ? 0 : lead ? Math.min(zone, followTarget(lead, this.speed)) : zone;

    if (this.speed > target) {
      // 정지 지시는 확실하게, 구간 감속은 부드럽게
      const decel = input.stop ? this.pace.brakeDecel : EASE_DECEL;
      this.speed = Math.max(target, this.speed - decel * dt);
      this.braking = input.stop || this.speed - target > 0.4;
    } else {
      this.speed = Math.min(target, this.speed + ACCEL * dt);
      this.braking = false;
    }
    if (this.speed < 0.01) this.speed = 0;

    // ── 조향 ──
    // 속도가 낮을수록 같은 조향각으로 더 급하게 돈다. 저속에서 과하게 꺾이지 않도록 눌러 준다.
    const desired = input.steer * MAX_STEER;
    const delta = desired - this.steerAngle;
    this.steerAngle += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, delta));

    // 우조향(steer > 0) 이면 yaw 감소 = 시계방향 = 우회전
    this.yawRate =
      this.speed > 0.02 ? -(this.speed / this.wheelbase) * Math.tan(this.steerAngle) : 0;
    this.yaw += this.yawRate * dt;

    const f = this.forward;
    this.x += f.x * this.speed * dt;
    this.z += f.z * this.speed * dt;
  }

  /** 이번 프레임에 이동한 거리 (바퀴 회전량 계산용) */
  travel(dt: number): number {
    return this.speed * dt;
  }
}

/**
 * **사거리 없는 보호구역 도로의 감속 지점** — 횡단보도 셋을 오는 순서대로.
 *
 * `stop` 은 그 횡단보도의 정지선, `clear` 는 다 건넌 자리다 (z 가 작을수록 앞).
 * 판정 쪽의 같은 표는 rules/lawRules.ts 의 `ZONE_ROAD_EDGES` 다 — 자리를 옮기면 둘 다 고친다.
 */
const ZONE_ROAD_SLOWDOWNS: ReadonlyArray<{ stop: number; clear: number }> = [
  { stop: STOP_LINE_S, clear: CROSSWALK_S_INNER },
  { stop: STOP_LINE, clear: CROSSWALK_INNER },
  { stop: CROSSWALK_B_INNER + 2, clear: CROSSWALK_B_OUTER },
];

/**
 * 그 자리(차 중심)에서의 목표 속도.
 * 교차로에 가까워질수록 자동으로 느려져, 플레이어는 정지 여부만 판단하면 된다.
 *
 * **클래스 밖에 둔다.** 앞차(leadDrive.ts)가 같은 속도표로 달려야 판마다 간격이 같게
 * 유지된다 — 앞차가 따로 속도를 정하면 출발 간격이 도착할 때쯤 제멋대로 벌어지거나 좁혀진다.
 */
export function zoneTargetKmh(
  x: number,
  z: number,
  schoolZone: boolean,
  approachZone: boolean,
  pace: DrivePace = DEFAULT_PACE,
  zoneRoad = false,
): number {
  /*
    어린이보호구역에서는 어느 구간이든 30km/h 를 넘지 않는다 (제12조 제1항).

    **구간이 둘이다.** 교차로 자체가 보호구역인 경우(`schoolZone`)와, 교차로에 닿기
    전에 지나는 구간(`approachZone`)이다. 뒤엣것은 z 로 정해지므로 지금 자리를 본다 —
    구간을 벗어나면 다시 원래 속도로 돌아간다.
  */
  const inApproachZone =
    approachZone && z <= APPROACH_ZONE_FAR_Z && z >= APPROACH_ZONE_NEAR_Z;
  const limit = (kmh: number): number =>
    schoolZone || inApproachZone ? Math.min(kmh, SCHOOL_ZONE_KMH) : kmh;

  /*
    **사거리 없는 보호구역 도로도 횡단보도마다 미리 줄인다.**

    이 길에는 교차로가 없어서 아래의 '교차로 정지선까지 남은 거리' 가지가 걸리지 않았고,
    `approachSchoolZone` 도 쓰지 않으므로 바로 아래 가지도 걸리지 않았다. 그래서 **세 횡단보도
    모두를 30km/h 그대로 달려와** 정지를 눌렀다 — 우회전 코스에서는 같은 자리를 서행(12km/h)으로
    다가가므로, 같은 브레이크인데 멈추는 거리가 7.2m 대 1.2m 로 벌어졌다. 사용자가 그대로 짚었다:
    "브레이크가 덜 듣는 느낌이야. 우회전 부분과 동일하게 제동부가 작동하도록 해 줘."

    **감속도를 키우는 것이 아니라 다가가는 속도를 맞춘다.** 브레이크(pace.brakeDecel)는 난이도가
    정하는 값이라 코스마다 다르면 난이도의 뜻이 흔들린다. 두 코스가 같은 속도로 다가가면 같은
    브레이크가 같게 듣는다.
  */
  if (zoneRoad) {
    for (const { stop, clear } of ZONE_ROAD_SLOWDOWNS) {
      if (z < clear) continue; // 이미 건너 지난 횡단보도 — 다음 것을 본다
      const toLine = z - stop;
      if (toLine < SLOW_BEFORE_LINE) return limit(pace.slowKmh);
      if (toLine < APPROACH_BEFORE_LINE) return limit(pace.approachKmh);
      break; // 가장 가까운 횡단보도도 아직 멀다
    }
    return limit(CRUISE_KMH);
  }

  /*
    **진입부 보호구역 횡단보도 앞에서도 선다.** 교차로 정지선과 같은 규칙으로
    다가가며 줄인다 — 이 게임은 속도를 자동으로 몰기 때문에, 서야 하는 자리에서
    알아서 설 수 있는 속도까지는 내려 줘야 판단만 남는다.
  */
  if (approachZone && z > CROSSWALK_S_OUTER) {
    const toLineS = z - STOP_LINE_S;
    /*
      **교차로 정지선과 같은 두 단계**로 줄인다. 한 단계(서행만)로 두었더니 코앞에서
      갑자기 느려져, 붉은 노면을 보고 설지 판단할 시간이 3초밖에 안 됐다.
      미리 25km/h 로 내려 두면 그 구간을 지나는 데 시간이 걸려 판단할 틈이 생긴다.
    */
    if (toLineS >= 0 && toLineS < SLOW_BEFORE_LINE) return limit(pace.slowKmh);
    if (toLineS >= 0 && toLineS < APPROACH_BEFORE_LINE) return limit(pace.approachKmh);
  }

  // 교차로 진입 전에는 '정지선까지 남은 거리'로 판단한다.
  // 중심에서의 거리로 재면 정지선 위치가 바뀔 때 서행 시점이 어긋난다.
  if (z > INTERSECTION_HALF) {
    const toLine = z - STOP_LINE;
    if (toLine < SLOW_BEFORE_LINE) return limit(pace.slowKmh);
    if (toLine < APPROACH_BEFORE_LINE) return limit(pace.approachKmh);
    return limit(cruiseKmh(z, approachZone));
  }
  // 교차로 안과 진출로는 중심에서의 거리로 판단한다
  const distance = Math.hypot(x, z);
  if (distance < SLOW_RADIUS) return limit(pace.slowKmh);
  if (distance < APPROACH_RADIUS) return limit(pace.approachKmh);
  return limit(CRUISE_KMH);
}

/**
 * 구간 제한이 걸리지 않은 자리에서의 순항 속도.
 *
 * 진입부 보호구역 판의 **구역 밖**에서만 50km/h(`ROAD_KMH`)이고, 구역 시작선이
 * 다가오면 거기서 30km/h 가 되도록 미리 줄인다.
 *
 * **줄이기 시작하는 자리를 상수로 적지 않는다.** 남은 거리로 역산하면
 * (v² = v_end² + 2ad) 시작선에서 딱 30 이 되고, 감속도가 `EASE_DECEL` 이라
 * 목표와 실제 속도가 어긋나지 않는다 — 상수로 적어 두면 감속도나 구역 위치를
 * 손볼 때마다 따로 맞춰야 하고, 맞추지 않으면 구역 안에서 뒤늦게 줄어든다.
 *
 * 미리 줄이는 것이 맞다. 표지는 구역 시작선보다 앞에 서 있고, 지켜야 하는 것은
 * **구역에 들어설 때 이미 30 인 것**이지 들어서고 나서 밟는 것이 아니다.
 */
function cruiseKmh(z: number, approachZone: boolean): number {
  if (!approachZone || z <= APPROACH_ZONE_FAR_Z) return CRUISE_KMH;
  const toZone = z - APPROACH_ZONE_FAR_Z;
  const entry = SCHOOL_ZONE_KMH / 3.6;
  const ramp = Math.sqrt(entry * entry + 2 * EASE_DECEL * toZone) * 3.6;
  return Math.min(ROAD_KMH, ramp);
}

/** 앞차와 떨어져 설 최소 간격 (m) */
const FOLLOW_MIN_GAP = 3.0;
/** 차간 시간 (초) — 속도가 붙을수록 더 벌린다 */
const FOLLOW_HEADWAY = 1.0;
/** 간격 오차 1m 를 속도 몇 m/s 로 바꿀 것인가 */
const FOLLOW_GAIN = 0.5;

/**
 * **앞차를 따라갈 때의 자동 속도** — 단, 서행 아래로는 내려가지 않는다.
 *
 * ## 왜 따라가게 했는가
 *
 * 이 게임에서 속도는 자동이고 사람이 하는 일은 "언제 설 것인가" 뿐이다(파일 머리 주석).
 * 앞차가 생기고 나서 그 원칙이 깨졌다 — 두 차가 같은 속도표를 따르면 **시간 간격**은
 * 유지되지만 서행(12km/h)에서는 1.6초가 차 중심 사이 5.3m 라, 차 길이를 빼면 붙어 버렸다.
 * 앞차가 서지도 않는데 사람이 계속 브레이크를 톡톡 쳐 간격을 맞춰야 하는 판이 됐다.
 *
 * ## 왜 서행 아래로는 따라 줄이지 않는가
 *
 * 끝까지 따라 서면 **앞차가 설 때 내가 설 일이 없어진다.** "앞차가 서면 나도 선다" 는
 * 판단이 통째로 자동이 되고, 규정대로 서는 앞차가 가르치려던 것이 사라진다. 그래서 간격
 * 유지는 **달리는 동안만** 돕고, 앞차가 서행 아래로 줄이면(= 서려 하면) 나는 서행으로
 * 계속 다가간다 — 거기서부터는 사람이 정지를 누를 몫이다. 서행에서 원하는 간격이 6.3m 라
 * 부딪히기까지 2초 가까이 남는다.
 */
function followTarget(lead: { gap: number; speedMs: number }, mySpeed: number): number {
  if (!Number.isFinite(lead.gap)) return Infinity;
  const desired = FOLLOW_MIN_GAP + FOLLOW_HEADWAY * mySpeed;
  const wanted = lead.speedMs + (lead.gap - desired) * FOLLOW_GAIN;
  return Math.max(SLOW_KMH / 3.6, wanted);
}
