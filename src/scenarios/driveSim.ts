/**
 * 3D 없이 판을 돌려 보는 주행 시뮬레이터.
 *
 * "차가 이 경로를 이 속도 프로파일로 지나갔다" 는 상황을 만들어 `RightTurnJudge` 에 먹인다.
 * 실제 게임의 Vehicle.ts 와는 독립이며, **판정 규칙 그 자체**만 다룬다.
 *
 * ## 왜 src/ 에 있는가
 *
 * 원래 tests/ 에만 있었다. 지금은 두 곳이 쓴다.
 *
 *  - **판정 엔진 테스트** (tests/simulate.ts 가 이 파일을 그대로 다시 내보낸다)
 *  - **시나리오 검증기** (validate.ts) — AI 가 만든 판을 사람에게 주기 전에
 *    "규정대로 몰면 통과하는가 · 대충 몰면 걸리는가" 를 돌려 본다
 *
 * 검증이 **테스트에서만 쓰는 도구**로 남으면 제품이 그것을 쓸 수 없다. 그래서 옮겼다.
 */

import { CROSSWALK_INNER, CROSSWALK_OUTER, STOP_LINE, STOP_LINE_S } from '../layout';
import { CAR_HALF_LENGTH, arcLengths, buildPath, poseAt, type TurnStyle } from './turnPath';
import {
  RightTurnJudge,
  type CrosswalkId,
  type JudgeResult,
  type LightColor,
  type PedSignal,
  type PedestrianSample,
  type RightArrowColor,
  type WorldSample,
} from '../rules/lawRules';

/*
  경로(폴리라인·누적 거리·자세)는 turnPath.ts 에 있다. 앞차(game/leadDrive.ts)가 같은
  길을 달려야 해서 떼어 냈다 — 두 벌이 되면 앞차와의 간격이 서로 다른 좌표계에서 재어진다.
*/
export type { TurnStyle } from './turnPath';

/** 한 스텝의 길이(초). 보행자 상태기계를 함께 굴리는 쪽이 이 값을 알아야 한다 */
export const DT = 1 / 60;

/** 시뮬레이션 중 세계 상태를 시간에 따라 바꿔 주고 싶을 때 쓰는 훅 */
export interface WorldConfig {
  vehicleLight: LightColor | ((t: number) => LightColor);
  rightArrow?: RightArrowColor | ((t: number) => RightArrowColor) | null;
  pedSignalA?: PedSignal | null | ((t: number) => PedSignal | null);
  pedSignalC?: PedSignal | null | ((t: number) => PedSignal | null);
  /** 진입부 보호구역 횡단보도(S)의 보행신호. 신호기가 없으면 생략한다 */
  pedSignalS?: PedSignal | null | ((t: number) => PedSignal | null);
  /**
   * **진입부 어린이보호구역**의 차량신호등. 구간 자체가 없으면 생략한다.
   *
   * 구간은 있는데 신호기가 없는 경우가 이 게임에서 가장 중요한 상황이라
   * (제27조 제7항) `null` 을 돌려주는 함수를 넘길 수 있게 해 둔다.
   */
  approachZone?: (LightColor | null) | ((t: number) => LightColor | null);
  /**
   * 보행자 상태.
   *
   * **매 스텝 정확히 한 번, 시간 순서대로 불린다.** 그래서 상태기계(PedWalk)를 이 안에서
   * 굴려도 된다 — 검증기가 그렇게 쓴다. 세 번째 인자로 그 순간의 차 속도를 주는 이유는
   * 보행자가 "이미 달려 들어온 차 앞으로는 나서지 않는" 판단을 하기 때문이다.
   */
  pedestrians?: (
    t: number,
    car: { frontX: number; frontZ: number },
    ctx: { speedKmh: number },
  ) => PedestrianSample[];
  /**
   * 진출로가 막혀 있는가.
   *
   * **시간에 따라 변한다.** 게임에서 정체는 `JAM_CLEAR_SECONDS` 뒤에 풀린다 — 영영 안
   * 풀리면 "진입하지 않는 것" 이 정답인데도 판을 끝낼 수 없기 때문이다. 그래서 함수도 받는다.
   */
  exitBlocked?: boolean | ((t: number) => boolean);
  /** 정지선 앞 몇 m 안에서 서야 정지로 치는가 — 난이도가 정한다 (challenge.ts 의 stopZone). 없으면 판정의 기본값 */
  stopZone?: number;
  isSchoolZone?: boolean;
  /** 낮(08~20시)인가 — 어린이보호구역 가중이 붙는 시간대인지 (기본 낮) */
  isDaytime?: boolean;
  /**
   * 앞차 (game/leadDrive.ts). 없으면 생략한다.
   *
   * **매 스텝 보행자 다음에 정확히 한 번** 불린다 — 앞차가 이번 스텝의 보행자를 보고
   * 움직여야 하기 때문이다. 그래서 상태기계(LeadDrive)를 이 안에서 굴려도 된다.
   * 내 앞범퍼를 받아 **앞차 뒷범퍼까지 경로상 간격**과 앞차 속도를 돌려준다.
   */
  lead?: (
    t: number,
    car: { frontX: number; frontZ: number },
    peds: PedestrianSample[],
  ) => { gap: number; speedKmh: number; queued?: boolean };
}

export interface DriverConfig {
  /**
   * 출발 자리 (z). 기본은 평소 스폰(SPAWN_Z).
   *
   * 진입부 보호구역이 있는 판은 뒤로 물린다 (scenarios.ts 의 spawnZ) — 검증기가
   * 그 값을 넘긴다. 게임과 다른 자리에서 출발하면 검증이 다른 판을 재게 된다.
   */
  startZ?: number;
  /** 순항 속도 (km/h) */
  cruiseKmh?: number;
  /**
   * **진입부 보호구역 횡단보도(S) 앞에서** 멈출지, 멈춘다면 몇 초.
   *
   * 신호기가 없으면 이 정지가 곧 제27조 제7항이다 — 여기가 0 이면 규정을 지킨 주행이
   * 아니고, 검증기의 '모범 운전' 이 그 판을 통과 불가능으로 판정하게 된다.
   */
  stopAtSchoolZoneLine?: number;
  /** 교차로 회전 속도 (km/h) */
  turnKmh?: number;
  /** 정지선 앞에서 멈출지, 멈춘다면 몇 초 */
  stopAtLine?: number;
  /** `stopAtLine` 으로 설 때 정지선에서 얼마나 떨어져 서는가 (m). 기본 0.4 — 정지선에 붙여 선다 */
  lineGap?: number;
  /** 정지선을 넘어 멈출지 (초) */
  stopPastLine?: number;
  /** 정지선을 얼마나 넘어서 멈추는가 (m). 0.5m 이하면 횡단보도를 밟지 않는다. */
  pastLineDepth?: number;
  /** 우회전 후 횡단보도 앞에서 멈출 시간 */
  stopBeforeExitCrosswalk?: number;
  /** 방향지시등: 항상 켬 / 안 켬 / 늦게 켬(교차로 20m 앞부터) */
  turnSignal?: 'always' | 'never' | 'late';
  turnStyle?: TurnStyle;
  /**
   * 보행자가 아직 건너는 중이면 **다 건널 때까지 더 기다린다.**
   *
   * 고정 초(`stopBeforeExitCrosswalk`)만으로는 모범 운전을 흉내 낼 수 없다 — 보행자가
   * 언제 나설지는 시나리오마다 다르고, 거리 방아쇠(PedSpawn.startWithin) 때문에 내가
   * 어떻게 달렸느냐에 따라서도 달라진다. 검증기의 '모범 운전' 이 이 옵션을 쓴다.
   */
  yieldUntilClear?: boolean;
  /** `yieldUntilClear` 로 기다릴 수 있는 최대 시간(초) — 무한 대기를 막는다 */
  maxYieldSeconds?: number;
  /**
   * 앞차와 **간격을 지키는가** (기본 true).
   *
   * 모범 운전만이 아니라 막 모는 운전도 기본으로 지킨다. 앞차를 들이받는 운전자를 두면
   * 그 판의 모든 위반이 추돌 하나에 가려져, "이 판에 가르칠 상황이 있는가" 를 잴 수 없다.
   * 막 모는 사람도 앞차는 피한다 — 그가 어기는 것은 **앞차가 서지 않은 자리**다.
   */
  keepsDistance?: boolean;
}

/** 앞차 뒤에 서는 간격 (m) — 이보다 붙으면 선다 */
const FOLLOW_STOP_GAP = 2.5;
/** 이 간격 안에서는 앞차 속도에 맞춰 줄인다 (m) */
const FOLLOW_SLOW_GAP = 9;
/** 이보다 붙으면 추돌이다 (m) — 경로 투영의 오차를 조금 봐준다 */
const COLLISION_GAP = 0.15;

/** 정지 이벤트: 경로상 어느 거리에서 몇 초 멈추는가 */
interface StopPoint {
  atDistance: number;
  seconds: number;
}

export function simulate(world: WorldConfig, driver: DriverConfig = {}): JudgeResult {
  const {
    cruiseKmh = 40,
    turnKmh = 14,
    stopAtLine = 0,
    lineGap = 0.4,
    stopAtSchoolZoneLine = 0,
    stopPastLine = 0,
    pastLineDepth = 1.0,
    stopBeforeExitCrosswalk = 0,
    turnSignal = 'always',
    turnStyle = 'tight',
    yieldUntilClear = false,
    maxYieldSeconds = 30,
    keepsDistance = true,
  } = driver;

  const pts = buildPath(turnStyle, driver.startZ);
  const acc = arcLengths(pts);
  const total = acc[acc.length - 1];

  // 경로상 주요 지점의 거리를 앞범퍼 기준으로 역산한다.
  const distanceWhereFrontZ = (targetZ: number): number => {
    for (let s = 0; s <= total; s += 0.05) {
      if (poseAt(pts, acc, s).front.z <= targetZ) return s;
    }
    return total;
  };
  const distanceWhereFrontX = (targetX: number): number => {
    for (let s = 0; s <= total; s += 0.05) {
      if (poseAt(pts, acc, s).front.x >= targetX) return s;
    }
    return total;
  };

  const stops: StopPoint[] = [];
  /*
    **진입부 보호구역 횡단보도가 먼저다.** `stops` 는 경로 거리 순으로 소비되므로
    (stopIndex 가 앞에서부터 올라간다) 먼저 만나는 것을 먼저 넣어야 한다 —
    순서가 뒤집히면 교차로에서 선 뒤에야 보호구역 정지가 소비되어, 이미 지나온
    자리에서 서려다 아무 데서도 안 서게 된다.
  */
  if (stopAtSchoolZoneLine > 0) {
    stops.push({
      atDistance: distanceWhereFrontZ(STOP_LINE_S + 0.4),
      seconds: stopAtSchoolZoneLine,
    });
  }
  if (stopAtLine > 0) {
    stops.push({ atDistance: distanceWhereFrontZ(STOP_LINE + lineGap), seconds: stopAtLine });
  }
  if (stopPastLine > 0) {
    stops.push({
      atDistance: distanceWhereFrontZ(STOP_LINE - pastLineDepth),
      seconds: stopPastLine,
    });
  }
  if (stopBeforeExitCrosswalk > 0 || yieldUntilClear) {
    // 두 번째 횡단보도 직전에서 멈춘다
    stops.push({
      atDistance: distanceWhereFrontX(CROSSWALK_INNER - 1),
      seconds: stopBeforeExitCrosswalk,
    });
  }
  stops.sort((p, q) => p.atDistance - q.atDistance);

  // 첫 횡단보도부터 두 번째 횡단보도까지를 '회전 구간'으로 보고 turnKmh 로 달린다.
  const turnStart = distanceWhereFrontZ(CROSSWALK_OUTER);
  const turnEnd = distanceWhereFrontX(CROSSWALK_OUTER);
  /** 진입 전 횡단보도(A) 직전 — 여기서도 보행자를 보내야 한다 */
  const gateA = distanceWhereFrontZ(CROSSWALK_OUTER + 0.5);
  /*
    진출 횡단보도(C) 직전. **루프 밖에서 한 번만 잰다** — 경로를 0.05m 씩 훑는 계산이라
    매 스텝 다시 재면 판 하나에 수천 번 돌고, 검증기가 몰기 서른여섯 가지를 돌리는 동안
    판 하나에 4초가 걸렸다.
  */
  const gateC = distanceWhereFrontX(CROSSWALK_INNER - 1);

  const judge = new RightTurnJudge(world.stopZone);
  const resolve = <T>(v: T | ((t: number) => T), t: number): T =>
    typeof v === 'function' ? (v as (t: number) => T)(t) : v;

  let s = 0;
  let t = 0;
  let stopIndex = 0;
  let stopRemaining = 0;
  let yielded = 0;
  /** 지난 스텝에 보행자를 기다리며 서 있었는가 — 이번 스텝 보행자에게 넘길 내 속도를 정한다 */
  let wasHolding = false;
  const MAX_T = 120;

  while (s < total && t < MAX_T) {
    const pose = poseAt(pts, acc, s);

    /*
      **보행자 표본을 먼저 뜬다.** 이번 스텝에 설지 갈지를 정하려면 지금 누가 차도 위에
      있는지를 알아야 하고, 그 판단이 다시 이번 스텝의 속도가 된다.
    */
    /*
      **지난 스텝에 보행자를 기다리며 서 있었으면 지금도 서 있는 차다.** 이것을 빼 먹으면 보행자에게는 기다리는 차가
      "12km/h 로 코앞까지 달려오는 차" 로 보여, 설 수 없는 차 앞에서 새로 건너려 하지 않는 규칙(pedWalk.ts)이 걸려 다음
      사람이 끝내 나서지 않았다 — 끝없이 기다려야 하는 판이 통과 가능으로 읽혔다.
    */
    const speedGuess =
      stopRemaining > 0 || wasHolding ? 0 : s >= turnStart && s <= turnEnd ? turnKmh : cruiseKmh;
    const peds = world.pedestrians
      ? world.pedestrians(
          t,
          { frontX: pose.front.x, frontZ: pose.front.z },
          { speedKmh: speedGuess },
        )
      : [];

    /*
      규정대로 모는 운전자는 **보행자가 다 건널 때까지** 기다린다. 두 횡단보도 직전에서만
      본다 — 교차로 한복판에서 멈추면 그 자체가 위반(꼬리물기)이다.
    */
    let holding = false;
    wasHolding = false;
    if (yieldUntilClear && yielded < maxYieldSeconds) {
      const atGateA = Math.abs(s - gateA) < 0.6;
      const atGateC = Math.abs(s - gateC) < 0.6;
      const which = atGateA ? 'A' : atGateC ? 'C' : null;
      if (which && peds.some((p) => p.crosswalk === which && p.intendsToCross && p.onConflictPath)) {
        holding = true;
        yielded += DT;
      }
      wasHolding = holding;
    }

    const lead = world.lead
      ? world.lead(t, { frontX: pose.front.x, frontZ: pose.front.z }, peds)
      : null;

    let speedKmh: number;
    if (holding) {
      speedKmh = 0;
    } else if (stopRemaining > 0) {
      speedKmh = 0;
      stopRemaining -= DT;
    } else if (stopIndex < stops.length && s >= stops[stopIndex].atDistance) {
      stopRemaining = stops[stopIndex].seconds;
      stopIndex++;
      speedKmh = 0;
    } else {
      speedKmh = s >= turnStart && s <= turnEnd ? turnKmh : cruiseKmh;
    }

    /*
      **앞차 뒤에서는 앞차가 속도를 정한다.** 정지 이벤트(stops)는 그대로 소비되지 않고
      남아 있다가, 앞차가 비켜 준 뒤 그 자리에 닿으면 그때 선다 — 앞차 뒤에 서 있는 동안
      정지선 정지를 "했다" 고 치면 앞차가 떠난 뒤 정지선에서 다시 설 기회가 사라진다.
    */
    if (lead && keepsDistance && Number.isFinite(lead.gap) && lead.gap > -CAR_HALF_LENGTH * 2) {
      if (lead.gap < FOLLOW_STOP_GAP) speedKmh = 0;
      else if (lead.gap < FOLLOW_SLOW_GAP) {
        speedKmh = Math.min(speedKmh, lead.speedKmh + (lead.gap - FOLLOW_STOP_GAP) * 3);
      }
    }

    const rightSignalOn =
      turnSignal === 'always' ? true : turnSignal === 'never' ? false : pose.front.z <= 20;

    const sample: WorldSample = {
      t,
      frontX: pose.front.x,
      frontZ: pose.front.z,
      centerX: pose.center.x,
      centerZ: pose.center.z,
      speedKmh,
      rightSignalOn,
      vehicleLight: resolve(world.vehicleLight, t),
      rightArrow: resolve(world.rightArrow ?? null, t),
      pedSignal: {
        A: resolve(world.pedSignalA ?? null, t),
        C: resolve(world.pedSignalC ?? null, t),
        S: resolve(world.pedSignalS ?? null, t),
      },
      approachZone: world.approachZone ? { light: resolve(world.approachZone, t) } : null,
      pedestrians: peds,
      exitBlocked: resolve(world.exitBlocked ?? false, t),
      isSchoolZone: world.isSchoolZone ?? false,
      isDaytime: world.isDaytime ?? true,
      queuedBehind: lead?.queued ?? false,
    };
    judge.update(sample, DT);

    // 앞차와 겹쳤으면 추돌이다 — 게임(Game.checkCollisions)과 같은 실패 사유로 끝낸다
    if (lead && lead.gap <= COLLISION_GAP && lead.gap > -CAR_HALF_LENGTH * 2) {
      judge.fail('VEHICLE_COLLISION');
      return judge.finish();
    }

    s += (speedKmh / 3.6) * DT;
    t += DT;
  }

  if (s >= total) judge.markCompleted();
  return judge.finish();
}

/** 보행자 헬퍼: 지정 시간 구간 동안 횡단 중 */
export function crossingBetween(
  crosswalk: CrosswalkId,
  from: number,
  to: number,
): (t: number) => PedestrianSample[] {
  return (t) => [
    {
      crosswalk,
      intendsToCross: t >= from && t <= to,
      onConflictPath: t >= from && t <= to,
    },
  ];
}

/** 보행자 헬퍼: 시나리오 내내 횡단보도 앞에 서서 건너려 하고 있음 */
export function alwaysWaiting(crosswalk: 'A' | 'C'): (t: number) => PedestrianSample[] {
  return () => [{ crosswalk, intendsToCross: true, onConflictPath: true }];
}
