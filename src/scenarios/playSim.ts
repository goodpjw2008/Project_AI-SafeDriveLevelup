/**
 * **판을 사람처럼 달려 본다** — 화면 없이, 게임과 같은 물리 · 같은 보행자 · 같은 앞차 · 같은 판정으로.
 *
 * ## 검증기(validate.ts)와 무엇이 다른가
 *
 * 검증기의 시뮬레이터(driveSim.ts)는 **이상적인 운전자**다 — 속도가 순간에 바뀌고, 정한 자리에서 정확히 선다.
 * "규정대로 몰면 통과할 수 있는가" 를 보기에는 그것이 맞다. 그런데 사람은 그렇게 몰지 않는다 — 보고 나서 1초쯤
 * 뒤에 브레이크를 밟고, 차는 난이도에 따라 더 빨리 다가가고 더 무르게 선다(challenge.ts). 그래서 "공정한가"
 * (사람이 보고 설 수 있는가)는 검증기로는 알 수 없었다.
 *
 * 여기서는 게임의 차(Vehicle) · 자율 주행(AutoDriver) · 보행자 상태기계(PedWalk) · 앞차(LeadDrive) · 판정
 * (RightTurnJudge)를 **게임 루프(Game.step)와 같은 순서로** 돌린다. 운전자는 AutoDriver 에 성격을 입혀 만든다 —
 * 늦게 알아차리는 사람, 보행자를 보지 않는 사람, 막 모는 사람.
 *
 * ## 무엇을 돌려주는가
 *
 * 판정 결과와 함께 **타임라인** — 신호가 언제 바뀌었고, 보행자가 언제 건너려는 뜻을 보였다가(노란 느낌표)
 * 언제 나섰고(빨간 느낌표 · 횡단), 앞차와 내 차가 어디서 서고 떠났는지. 사람이 이 줄들을 읽고 "이 판이 운전자에게
 * 무엇을 가르치는가" 를 판단한다 (시나리오 플레이테스트).
 *
 * ## 게임과 다른 점 (알고 읽을 것)
 *
 * - 교차 통행 차량 · 뒷차 · 정체 차량은 없다. 정체(exitBlocked)는 풀리는 시각만 따른다.
 * - 보행자와의 충돌은 차체 사각형과 보행자 위치로 잰다 (게임과 같은 식). 앞차와의 추돌은 경로상 간격으로 잰다.
 */

import { RunTelemetry } from '../ai/telemetry';
import type { ViolationCode } from '../rules/violations';
import { AutoDriver, type AutoDriveState } from '../game/AutoDriver';
import { LeadDrive } from '../game/leadDrive';
import { CURB, PedWalk } from '../game/pedWalk';
import { DEFAULT_PACE, Vehicle } from '../game/Vehicle';
import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_S_OUTER,
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  FINISH_X,
  FINISH_Z,
  PLAYER_EXIT_Z,
  ROAD_HALF_WIDTH,
  STOP_LINE,
  STOP_LINE_S,
  bikeLaneCenter,
  BIKE_SLOT_SHRINK,
} from '../layout';
import {
  RightTurnJudge,
  STOP_ZONE_DEPTH,
  type CrosswalkId,
  type JudgeResult,
  type LightColor,
  type PedSignal,
  type PedestrianSample,
  type WorldSample,
} from '../rules/lawRules';
import type { DrivePace } from './challenge';
import { afterLeadBrake, paceFor, seenPedestrians } from './conditions';
import {
  JAM_CLEAR_SECONDS,
  SCHOOL_ZONE_PROGRAM,
  STANDARD_PROGRAM,
  phaseAt,
  spawnZ,
  type PedSpawn,
  type ScenarioSpec,
} from './scenarios';

/** 게임과 같은 한 스텝 (초) */
const DT = 1 / 60;
/** 판 제한시간 (Game.ts 의 RUN_TIMEOUT) */
const RUN_TIMEOUT = 100;
/** 내 차 크기 — 카탈로그 차의 가운데쯤 */
const CAR_LENGTH = 4.6;
const CAR_WIDTH = 1.9;
/** 앞차 길이의 절반 */
const LEAD_HALF_LENGTH = 2.3;
/** 횡단보도 한가운데 (Pedestrian.ts 와 같다) */
const CROSSWALK_CENTER = (CROSSWALK_INNER + CROSSWALK_OUTER) / 2;
const CROSSWALK_S_CENTER = (CROSSWALK_S_INNER + CROSSWALK_S_OUTER) / 2;
const CROSSWALK_B_CENTER = (CROSSWALK_B_INNER + CROSSWALK_B_OUTER) / 2;
/** 막 모는 사람이 핸들을 감는 정도 — 규정대로의 이만큼만 감아 바깥 차로로 크게 돈다 */
const RECKLESS_STEER = 0.6;
/**
 * 우측 통행을 모르는 가상 학습자의 조향 — 대회전 판정(WIDE_TURN, 안쪽 코너에서 7m)에 걸릴 만큼 덜 감는다 (PlayOptions.blind).
 * 0.24 는 6m 라 안 걸리고, 0.18 부터 7.5m 로 걸린다 — 그만큼 크게 돌면 도로도 벗어난다(완주 실패). 크게 도는 사람은 그렇다.
 */
const WIDE_STEER = 0.18;
/** 같은 보도에 선 사람끼리의 자리 (Pedestrian.ts 의 WAIT_SLOTS) */
const WAIT_SLOTS = [0, -1.15, 1.15, -1.8, 1.8];

/**
 * 운전자의 성격.
 *
 * - `careful`   규정대로 모는 사람 — 게임의 AI 자율 주행(AutoDriver) 그대로
 * - `human`     규정대로 모는데 **늦게 알아차리는** 사람 — 신호 · 보행자 · 앞차를 `reaction` 초 늦게 본다
 * - `pedBlind`  신호와 정지선은 지키지만 **보행자를 보지 않는** 사람 — 판의 보행자가 역할을 하는지 본다
 * - `signalBlind` 보행자는 보고 서지만 **신호와 일시정지 의무는 무시하는** 사람 — 판의 신호 · 보호구역 규칙이 역할을
 *               하는지 본다. `reckless` 는 보행자를 치고 판이 먼저 끝나 신호 위반을 잴 수 없을 때가 있다
 * - `reckless`  아무 데서도 서지 않는 사람
 */
export type Persona = 'careful' | 'human' | 'pedBlind' | 'signalBlind' | 'reckless';

export interface PlayOptions {
  persona: Persona;
  /** `human` 이 알아차리는 데 걸리는 시간 (초). 기본 1.0 */
  reaction?: number;
  /** 다가가는 속도와 브레이크 — 난이도가 정한다 (challenge.ts). 기본은 쉬움 */
  pace?: DrivePace;
  /** 정지선 앞 몇 m 안이 정지인가 — 난이도가 정한다. 기본 12 */
  stopZone?: number;
  /** 확률 보행자(`chance`)를 내보내는가. 기본 true (나오는 쪽) */
  chanceAppears?: boolean;
  /** 타임라인을 남기는가. 기본 true */
  trace?: boolean;
  /** 주행 결과 데이터(ai/telemetry.ts)를 함께 만드는가 — 위험도 · 난이도 모델 학습(scripts/train-ai.ts)이 켠다. 기본 false */
  telemetry?: boolean;
  /**
   * **개념마다 모르는 운전자** — 이 개념(위반 코드)의 규칙을 모르는 것처럼 본다. `pedBlind` · `signalBlind` 를 개념 단위로
   * 잘게 나눈 것으로, 결과 예측 모델(ai/outcome.ts)의 가상 학습자가 쓴다: 숙달 m_c 인 학습자는 확률 1−m_c 로 그 개념을
   * 모르는 채 달린다. 보행자 양보 → 사람을 못 봄, 적색 일시정지 → 적색을 녹색으로 봄, 보호구역 정지 → 신호기 없는
   * 횡단보도를 녹색으로 봄, 방향지시등 → 안 켬, 우측 통행 → 크게 돎, 정지선 → 정지선이 앞에 있다고 착각해 넘어 섬, 꼬리물기 → 정체를 못 봄.
   * 교차로 서행은 속도를 차가 알아서 줄여 흉내 낼 수 없다.
   */
  blind?: ReadonlySet<ViolationCode>;
}

/** 타임라인 한 줄 */
export interface PlayEvent {
  t: number;
  /** 무엇에 대한 줄인가 — 신호 · 보행자 · 내 차 · 앞차 · 판정 */
  kind: 'signal' | 'ped' | 'car' | 'lead' | 'judge';
  text: string;
}

/** 보행자 한 사람이 이번 판에서 한 일 — 타임라인을 읽기 전에 한눈에 보는 요약 */
export interface PedSummary {
  label: string;
  crosswalk: CrosswalkId;
  /** 건너려는 뜻을 처음 보인 때 (노란 느낌표). 없으면 null */
  firstIntent: number | null;
  /** 곧 나선다를 처음 보인 때 (빨간 느낌표) */
  firstImminent: number | null;
  /** 차도로 발을 뗀 때 */
  stepped: number | null;
  /** 다 건넌 때 */
  finished: number | null;
  /** 발을 떼기 전에 뜻을 **접은** 횟수 — 노란 느낌표가 떴다 사라진 것 (역할 없이 서 있게 되는 징후) */
  intentDropped: number;
  /** 발을 뗀 순간의 보행신호 (null = 신호기 없음) */
  signalAtStep: PedSignal | null;
  /** 발을 뗀 순간 내 차가 그 횡단보도까지 남긴 거리 (m, 음수면 이미 지났다) · 내 차 속도 (km/h) */
  carAtStep: { distance: number; speedKmh: number } | null;
  /** 건너려는 뜻을 처음 보인 순간 내 차의 거리 · 속도 — 뜻이 보인 때부터 서야 하므로 공정한지는 이것으로 잰다 */
  carAtIntent: { distance: number; speedKmh: number } | null;
  /** 이 사람이 차도 위에 있는 동안 내 차가 그 횡단보도에 들어갔는가 */
  carEnteredWhileCrossing: boolean;
}

export interface PlayResult {
  persona: Persona;
  result: JudgeResult;
  /** 판이 끝난 시각 (초) */
  elapsed: number;
  /** 내 차가 선 곳들 — 몇 초 서 있었는가 */
  stops: { at: number; where: string; seconds: number }[];
  peds: PedSummary[];
  events: PlayEvent[];
}

const PED_KIND_WORD = { adult: '어른', child: '어린이', elder: '노인' } as const;

function pedLabel(p: PedSpawn, i: number, spec: ScenarioSpec): string {
  const who = PED_KIND_WORD[p.kind ?? 'adult'];
  const hasSignal =
    p.crosswalk === 'S'
      ? spec.approachSchoolZone?.signal === true
      : spec.pedSignalInstalled[p.crosswalk === 'B' ? 'A' : p.crosswalk];
  // 신호기가 없는 횡단보도의 사람은 지킬 신호가 없다 — '신호무시' 라고 적으면 무단횡단자로 읽힌다
  const how = !hasSignal ? '신호없음' : p.obeysSignal === false ? '신호무시' : '신호준수';
  const tags = [how, p.afterLead ? '앞차뒤' : '', p.letsCarPass ? '내차보냄' : '', p.chance !== undefined ? `확률${p.chance}` : '']
    .filter(Boolean)
    .join('·');
  return `${p.crosswalk}#${i + 1}(${who} ${tags})`;
}

/** 그 횡단보도까지 내 앞범퍼가 남긴 거리 (m) — 들어섰으면 0 이하 */
function distanceTo(id: CrosswalkId, front: { x: number; z: number }): number {
  if (id === 'S') return front.z - CROSSWALK_S_OUTER;
  if (id === 'A') return front.z - CROSSWALK_OUTER;
  // B 는 교차로 건너편이라 z 가 줄어드는 쪽이다 (직진 코스)
  if (id === 'B') return front.z - CROSSWALK_B_INNER;
  // C 는 코너 너머라 (가로 + 세로)로 근사한다 — 보행자 상태기계(pedWalk.ts 의 playerDistance)와 같은 식
  return front.x >= CROSSWALK_INNER
    ? CROSSWALK_INNER - front.x
    : Math.max(0, CROSSWALK_INNER - front.x) + Math.max(0, front.z - PLAYER_EXIT_Z);
}

/** 내 앞범퍼가 그 횡단보도 위에 있는가 */
function onCrosswalk(id: CrosswalkId, front: { x: number; z: number }): boolean {
  if (id === 'S') return front.z <= CROSSWALK_S_OUTER && front.z >= CROSSWALK_S_INNER;
  if (id === 'B') return front.z <= CROSSWALK_B_INNER && front.z >= CROSSWALK_B_OUTER;
  const v = id === 'A' ? front.z : front.x;
  return (id === 'A' ? v <= CROSSWALK_OUTER && v >= CROSSWALK_INNER : v >= CROSSWALK_INNER && v <= CROSSWALK_OUTER);
}

/**
 * 내 차가 어디쯤 서 있는가 — 사람이 읽을 말로.
 *
 * **코스마다 교차로 다음이 다르다** — 우회전이면 동쪽의 C, 직진이면 북쪽의 건너편 횡단보도(B).
 * 직진 코스를 'C 까지 8m' 라고 적으면 읽는 사람이 지나지도 않을 횡단보도를 찾게 된다.
 */
function whereStopped(front: { x: number; z: number }, hasS: boolean, straight = false, zoneOnly = false): string {
  /*
    **사거리 없는 보호구역 도로**는 지나는 것이 횡단보도 셋뿐이다 — 정지선 · 교차로로 부르면
    읽는 사람이 있지도 않은 자리를 찾는다 (rules/lawRules.ts 의 ZONE_ROAD_NAME 과 같은 이름).
  */
  if (zoneOnly) {
    for (const [name, near] of [
      ['첫 번째', CROSSWALK_S_OUTER],
      ['두 번째', CROSSWALK_OUTER],
      ['세 번째', CROSSWALK_B_INNER],
    ] as const) {
      if (front.z > near) return `${name} 횡단보도 ${(front.z - near).toFixed(1)}m 앞`;
    }
    return '세 번째 횡단보도를 지난 뒤';
  }
  if (hasS && front.z > CROSSWALK_S_OUTER) return `보호구역 정지선 ${(front.z - STOP_LINE_S).toFixed(1)}m 앞`;
  if (front.z > STOP_LINE - 1) return `정지선 ${(front.z - STOP_LINE).toFixed(1)}m 앞`;
  if (front.z > CROSSWALK_INNER) return `첫 횡단보도 위 (정지선 ${(STOP_LINE - front.z).toFixed(1)}m 넘음)`;
  if (straight) {
    if (front.z > CROSSWALK_B_INNER) return `교차로 안 · 건너편 횡단보도까지 ${(front.z - CROSSWALK_B_INNER).toFixed(1)}m`;
    if (front.z >= CROSSWALK_B_OUTER) return '건너편 횡단보도 위';
    return '건너편 횡단보도를 지난 뒤';
  }
  if (front.x < CROSSWALK_INNER) return `교차로 안 · C 까지 ${(CROSSWALK_INNER - front.x).toFixed(1)}m`;
  if (front.x <= CROSSWALK_OUTER) return 'C 횡단보도 위';
  return 'C 를 지난 뒤';
}

const LIGHT_WORD: Record<string, string> = {
  green: '녹색',
  yellow: '황색',
  red: '적색',
  redFlash: '적색점멸',
  yellowFlash: '황색점멸',
  greenFlash: '녹색점멸',
  greenArrow: '녹색화살표',
  yellowArrow: '황색화살표',
  redArrow: '적색화살표',
};
const word = (v: string | null | undefined): string => (v == null ? '없음' : (LIGHT_WORD[v] ?? v));

/**
 * 한 판을 한 사람이 달린다.
 */
export function playScenario(spec: ScenarioSpec, opts: PlayOptions): PlayResult {
  const persona = opts.persona;
  const reaction = persona === 'human' ? (opts.reaction ?? 1.0) : 0;
  // 환경이 물리를 바꾼다 — 빗길은 브레이크가 무르고, 밤에는 보행자가 가까이 와서야 보인다 (scenarios/conditions.ts)
  const pace = paceFor(opts.pace ?? DEFAULT_PACE, spec.weather);
  const traceOn = opts.trace ?? true;
  const events: PlayEvent[] = [];
  const log = (t: number, kind: PlayEvent['kind'], text: string): void => {
    if (traceOn) events.push({ t, kind, text });
  };

  const spawns = spec.pedestrians.filter((p) => p.chance === undefined || (opts.chanceAppears ?? true));
  const walkers = spawns.map((p) => new PedWalk(p));
  const labels = spawns.map((p, i) => pedLabel(p, i, spec));
  // 같은 보도에 선 사람끼리 자리를 어긋나게 (Game.buildPedestrians)
  const taken = new Map<string, number>();
  const offsets = spawns.map((p) => {
    const key = `${p.crosswalk}:${p.from}`;
    const slot = taken.get(key) ?? 0;
    taken.set(key, slot + 1);
    return WAIT_SLOTS[slot % WAIT_SLOTS.length];
  });

  const vehicle = new Vehicle(
    CAR_LENGTH,
    spec.isSchoolZone,
    Boolean(spec.approachSchoolZone),
    spawnZ(spec),
    pace,
    spec.drive === 'zoneOnly',
  );
  const blind: ReadonlySet<ViolationCode> = opts.blind ?? new Set();
  const driver = new AutoDriver(CAR_LENGTH * 0.58, pace.brakeDecel, spec.drive ?? 'rightTurn');
  const lead = spec.leadCar
    ? new LeadDrive(spec.leadCar, {
        playerSpawnZ: spawnZ(spec),
        playerHalfLength: CAR_LENGTH / 2,
        halfLength: LEAD_HALF_LENGTH,
        isSchoolZone: spec.isSchoolZone,
        hasApproachZone: spec.approachSchoolZone !== undefined,
        pace,
      })
    : null;
  /*
    **코스에 맞는 판정으로 돈다** (scenarios.ts 의 `drive`). 직진 코스에 우회전 판정을 대면
    규정대로 몬 주행이 대회전 · 지시등 위반으로 잡힌다 (rules/lawRules.ts 의 DriveMode).
  */
  const drive = spec.drive ?? 'rightTurn';
  /** 곧게 가는 코스인가 — 교차로 직진 통과와 사거리 없는 보호구역 도로 */
  const goesStraight = drive !== 'rightTurn';
  const judge = new RightTurnJudge(opts.stopZone ?? STOP_ZONE_DEPTH, drive);
  // 게임(Game.ts)과 같은 요약 — 위험도 모델은 여기서 만든 숫자로 학습하고 실제 판의 숫자로 예측한다
  const tele = opts.telemetry ? new RunTelemetry(drive, spec.approachSchoolZone !== undefined) : null;

  const summaries: PedSummary[] = spawns.map((p, i) => ({
    label: labels[i],
    crosswalk: p.crosswalk,
    firstIntent: null,
    firstImminent: null,
    stepped: null,
    finished: null,
    intentDropped: 0,
    signalAtStep: null,
    carAtStep: null,
    carAtIntent: null,
    carEnteredWhileCrossing: false,
  }));
  const prevPed = spawns.map(() => ({ intent: false, imminent: false, state: 'waiting' as string }));

  /** `human` 이 보는 세계 — `reaction` 초 전의 것 */
  const seen: { t: number; view: Perception }[] = [];

  let t = 0;
  let stopHold = 0;
  let lastSig = '';
  let stopStart: number | null = null;
  const stops: PlayResult['stops'] = [];
  let leadWasStopped = false;
  const leadCleared = new Set<CrosswalkId>();
  let ended = false;

  const finishStop = (now: number): void => {
    if (stopStart === null) return;
    const where = whereStopped(vehicle.front, spec.approachSchoolZone !== undefined, goesStraight, drive === 'zoneOnly');
    stops.push({ at: stopStart, where, seconds: now - stopStart });
    log(now, 'car', `출발 — ${where}에서 ${(now - stopStart).toFixed(1)}초 서 있었음`);
    stopStart = null;
  };

  while (!ended) {
    t += DT;
    const phase = phaseAt(STANDARD_PROGRAM, spec.startPhase, spec.startPhaseElapsed, t);
    const zone = spec.approachSchoolZone?.signal
      ? phaseAt(SCHOOL_ZONE_PROGRAM, 0, spec.approachSchoolZone.signalElapsed ?? 0, t)
      : null;
    /*
      **사거리 없는 보호구역 도로는 횡단보도마다 자기 신호를 돈다** (drive: 'zoneOnly').
      적힌 자리만 신호기가 있고, 나머지는 없다 — 그 '없음' 이 제27조 제7항의 자리다.
    */
    const zoneLights: Partial<Record<CrosswalkId, LightColor>> = {};
    const zonePed: Partial<Record<CrosswalkId, PedSignal>> = {};
    for (const [id, offset] of Object.entries(spec.zoneSignals ?? {})) {
      const ph = phaseAt(SCHOOL_ZONE_PROGRAM, 0, offset, t);
      zoneLights[id as CrosswalkId] = ph.vehicle;
      zonePed[id as CrosswalkId] = ph.ped;
    }
    const exitBlocked = Boolean(spec.exitBlocked) && t < JAM_CLEAR_SECONDS;
    const pedSignal: Record<CrosswalkId, PedSignal | null> =
      drive === 'zoneOnly'
        ? { A: zonePed.A ?? null, B: zonePed.B ?? null, C: null, S: zonePed.S ?? null }
        : {
            A: spec.pedSignalInstalled.A ? phase.pedA : null,
            // B 는 A 와 같은 도로를 가로지른다 — 같은 등화다 (lawRules.ts 의 signalCrosswalk)
            B: spec.pedSignalInstalled.A ? phase.pedA : null,
            C: spec.pedSignalInstalled.C ? phase.pedC : null,
            S: zone?.ped ?? null,
          };
    const rightArrow = spec.rightArrowInstalled ? phase.rightArrow : null;

    /*
      **직진 코스는 지나지 않는 횡단보도의 신호를 적지 않는다** — C(우회전 후)는 이 코스에 없고,
      대신 건너편(B)을 본다. B 의 등화는 A 와 같다 (rules/lawRules.ts 의 signalCrosswalk).
    */
    const sigLine =
      drive === 'zoneOnly'
        ? (['S', 'A', 'B'] as const)
            .map((id, i) => `${['첫', '두', '세'][i]}번째 ${zoneLights[id] ? word(zoneLights[id]!) : '신호없음'}`)
            .join(' · ')
        : `정면 ${word(phase.vehicle)}${rightArrow ? ` · 우회전 ${word(rightArrow)}` : ''} · 보행A ${word(pedSignal.A)} · ${
            goesStraight ? `보행B ${word(pedSignal.B)}` : `보행C ${word(pedSignal.C)}`
          }${spec.approachSchoolZone ? ` · 보호구역 ${word(zone?.vehicle ?? null)}` : ''}`;
    if (sigLine !== lastSig) {
      log(t, 'signal', sigLine);
      lastSig = sigLine;
    }

    // ── 입력 ── 게임과 같다: 지금 세계를 보고 정한다 (human 은 늦게 본 세계)
    const front = vehicle.front;
    const now: Perception = {
      vehicleLight: phase.vehicle,
      rightArrow,
      pedSignal,
      approachZone: spec.approachSchoolZone ? { light: zone?.vehicle ?? null } : null,
      zoneLights,
      pedestrians: seenPedestrians(walkers.map((w) => w.sample()), front, spec.timeOfDay),
      exitBlocked,
      lead: lead && !lead.gone ? { gap: lead.gapFrom(front.x, front.z), speedKmh: lead.speedKmh } : null,
    };
    seen.push({ t, view: now });
    while (seen.length > 1 && seen[1].t <= t - reaction) seen.shift();
    const view = reaction > 0 ? seen[0].view : now;
    const state: AutoDriveState = {
      x: vehicle.x,
      z: vehicle.z,
      yaw: vehicle.yaw,
      frontX: front.x,
      frontZ: front.z,
      speedKmh: vehicle.speedKmh,
      stopHold,
      isSchoolZone: spec.isSchoolZone,
      ...view,
      // 보행자를 보지 않는 사람 — 신호와 앞차는 본다
      pedestrians: persona === 'pedBlind' || persona === 'reckless' ? [] : view.pedestrians,
      // 신호와 일시정지 의무를 무시하는 사람 — 모든 등화를 녹색으로, 보호구역 · 정체를 없는 것으로 본다
      ...(persona === 'signalBlind'
        ? {
            vehicleLight: 'green' as const,
            rightArrow: view.rightArrow === null ? null : ('greenArrow' as const),
            approachZone: null,
            /*
              **사거리 없는 도로에서는 세 곳 모두 녹색으로 본다** — 신호도 일시정지 의무도 무시하는 사람이라,
              신호기가 없는 자리(제27조 제7항의 의무 정지)에서도 서지 않는다. 있는 자리만 녹색으로 바꾸면
              없는 자리에서는 여전히 서서, 이 운전자가 그 의무를 어기는 모습을 볼 수 없다.
            */
            zoneLights: { S: 'green' as const, A: 'green' as const, B: 'green' as const },
            exitBlocked: false,
            isSchoolZone: false,
          }
        : {}),
      // 앞차 간격은 몸이 느끼는 것이라 늦게 보더라도 지금 값에 가깝다 — 추돌만은 피하게 둔다
      lead: now.lead,
    };
    let input = driver.decide(blind.size ? blindView(state, blind) : state);
    if (blind.has('NO_TURN_SIGNAL')) input = { ...input, rightSignal: false };
    // 크게 도는 운전자 — 막 모는 운전자(RECKLESS_STEER)보다 더 덜 감는다. 그만큼이어야 판정의 대회전에 걸린다
    if (blind.has('WIDE_TURN')) input = { ...input, steer: input.steer * WIDE_STEER };
    if (persona === 'reckless') {
      /*
        아무 데서도 서지 않는다 — **앞차만은 피한다.** 앞차를 들이받게 두면 그 판의 다른 위반이 모두 추돌 하나에
        가려져, 이 판에 가르칠 상황이 있는지 잴 수 없다 (검증기의 막 모는 운전자와 같다, driveSim.ts 의 keepsDistance).
      */
      const g = now.lead?.gap ?? Infinity;
      const v = vehicle.speedKmh / 3.6;
      // 핸들도 덜 감는다 — 크게 돈다 (검증기 막 모는 운전자의 turnStyle: 'wide' 와 같은 뜻)
      input = { ...input, stop: g < 2.5 + (v * v) / (2 * pace.brakeDecel), steer: input.steer * RECKLESS_STEER };
    }

    // ── 차량 ──
    const leadNow = lead && !lead.gone ? { gap: lead.gapFrom(front.x, front.z), speedMs: lead.speedMs } : null;
    vehicle.update(input, DT, leadNow);
    const f = vehicle.front;
    const carMoving = vehicle.speedKmh > 1.5;

    // ── 보행자 ──
    walkers.forEach((w, i) => {
      const busy = lead?.blocksCrosswalk(w.crosswalk) ?? false;
      w.update(t, DT, pedSignal[w.crosswalk], f, carMoving, busy, {
        leadInWay: lead?.inWayOf(w.crosswalk) ?? false,
        carSpeedMs: vehicle.speedKmh / 3.6,
        brakeDecel: afterLeadBrake(spec.weather),
      });
      const s = w.sample();
      const sum = summaries[i];
      const prev = prevPed[i];
      const d = distanceTo(w.crosswalk, f);
      const intentNow = s.state === 'waiting' && s.intendsToCross;
      if (intentNow && !prev.intent) {
        if (sum.firstIntent === null) sum.carAtIntent = { distance: d, speedKmh: vehicle.speedKmh };
        sum.firstIntent ??= t;
        log(t, 'ped', `${labels[i]} 건너려는 뜻 (노란 느낌표) — 보행신호 ${word(s.signal)} · 내 차 ${d.toFixed(1)}m 앞 ${vehicle.speedKmh.toFixed(0)}km/h`);
      }
      if (!intentNow && prev.intent && s.state === 'waiting') {
        sum.intentDropped++;
        log(t, 'ped', `${labels[i]} **뜻을 접음** (느낌표 사라짐) — 보행신호 ${word(s.signal)}`);
      }
      if (s.imminent && !prev.imminent) {
        sum.firstImminent ??= t;
        log(t, 'ped', `${labels[i]} 곧 나섬 (빨간 느낌표) — 내 차 ${d.toFixed(1)}m 앞`);
      }
      if (s.state === 'crossing' && prev.state === 'waiting') {
        // 뜻을 보이지 않고 곧장 나섰다면 나선 순간이 곧 뜻이 보인 순간이다
        if (sum.firstIntent === null) {
          sum.firstIntent = t;
          sum.carAtIntent = { distance: d, speedKmh: vehicle.speedKmh };
        }
        sum.stepped = t;
        sum.signalAtStep = s.signal;
        sum.carAtStep = { distance: d, speedKmh: vehicle.speedKmh };
        log(
          t,
          'ped',
          `${labels[i]} 차도로 나섬 — 보행신호 ${word(s.signal)}${s.signal && s.signal !== 'green' && s.signal !== null ? ' (무단횡단)' : ''} · 내 차 ${d.toFixed(1)}m 앞 ${vehicle.speedKmh.toFixed(0)}km/h`,
        );
      }
      if (s.state === 'done' && prev.state !== 'done') {
        sum.finished = t;
        log(t, 'ped', `${labels[i]} 다 건넘`);
      }
      if (s.intendsToCross && s.onConflictPath && s.state === 'crossing' && onCrosswalk(w.crosswalk, f)) {
        sum.carEnteredWhileCrossing = true;
      }
      prev.intent = intentNow;
      prev.imminent = s.imminent;
      prev.state = s.state;
    });

    // ── 앞차 ──
    if (lead) {
      lead.update(DT, {
        vehicleLight: phase.vehicle,
        rightArrow,
        pedSignal,
        approachZone: spec.approachSchoolZone ? { light: zone?.vehicle ?? null } : null,
        pedestrians: walkers.map((w) => w.sample()),
        exitBlocked,
        isSchoolZone: spec.isSchoolZone,
      });
      const stopped = lead.speedKmh < 0.5 && !lead.gone;
      if (stopped !== leadWasStopped) {
        const lp = lead.pose().front;
        log(t, 'lead', stopped ? `앞차 섬 (앞차 앞범퍼 z=${lp.z.toFixed(1)} x=${lp.x.toFixed(1)})` : '앞차 출발');
        leadWasStopped = stopped;
      }
      for (const id of ['A', 'C'] as const) {
        if (!leadCleared.has(id) && !lead.inWayOf(id)) {
          leadCleared.add(id);
          log(t, 'lead', `앞차가 ${id} 를 다 지남 — 내 차 ${distanceTo(id, f).toFixed(1)}m 앞 ${vehicle.speedKmh.toFixed(0)}km/h`);
        }
      }
    }

    // ── 판정 ──
    if (vehicle.speedKmh <= 0.5) stopHold += DT;
    else stopHold = 0;
    if (vehicle.speedKmh <= 0.5 && stopStart === null) {
      stopStart = t;
      log(t, 'car', `섬 — ${whereStopped(f, spec.approachSchoolZone !== undefined, goesStraight, drive === 'zoneOnly')}`);
    } else if (vehicle.speedKmh > 1.5 && stopStart !== null) {
      finishStop(t);
    }

    const peds: PedestrianSample[] = walkers.map((w, i) => ({ ...w.sample(), id: i }));
    const sample: WorldSample = {
      t,
      frontX: f.x,
      frontZ: f.z,
      centerX: vehicle.x,
      centerZ: vehicle.z,
      speedKmh: vehicle.speedKmh,
      rightSignalOn: input.rightSignal,
      vehicleLight: phase.vehicle,
      rightArrow,
      pedSignal,
      approachZone: spec.approachSchoolZone ? { light: zone?.vehicle ?? null } : null,
      zoneLights,
      pedestrians: peds,
      exitBlocked,
      isSchoolZone: spec.isSchoolZone,
      // 자전거횡단도가 있는 횡단보도 — 판정이 조문을 가르는 데 쓴다 (rules/lawRules.ts)
      bikeLane: spec.bikeLane,
      isDaytime: spec.timeOfDay !== 'night',
      queuedBehind: lead?.queuesAhead(f.x, f.z) ?? false,
    };
    judge.update(sample, DT);
    tele?.update(sample, DT, input.stop);

    // ── 충돌 · 끝 ── (Game.checkCollisions · checkEnd)
    walkers.forEach((w, i) => {
      if (ended || w.done) return;
      /*
        **횡단보도마다 제 자리에 세운다** (game/Pedestrian.ts 의 같은 표). B 를 빠뜨려 두었더니
        세 번째 횡단보도 사람이 **두 번째 자리에서** 부딪힘 검사를 받고 있었다 — 판정(lawRules)은
        제 자리로 보는데 충돌만 엉뚱한 곳에서 보는 어긋남이라, 눈에 띄지 않은 채 남아 있었다.
      */
      /*
        **타고 건너는 자전거는 자전거횡단도 위**에 있다 (game/Pedestrian.ts 의 across 와 같은 셈).
        한쪽만 옮기면 화면에서는 띠 위를 건너는데 부딪힘은 줄무늬 한가운데에서 재게 된다.
      */
      const across =
        w.bike === 'ride'
          ? bikeLaneCenter(w.crosswalk) + offsets[i] * BIKE_SLOT_SHRINK
          : (w.crosswalk === 'S'
              ? CROSSWALK_S_CENTER
              : w.crosswalk === 'B'
                ? CROSSWALK_B_CENTER
                : CROSSWALK_CENTER) + offsets[i];
      const px = w.crosswalk === 'C' ? across : w.axis;
      const pz = w.crosswalk === 'C' ? w.axis : across;
      if (Math.abs(w.axis) > CURB + 0.5) return;
      const dx = px - vehicle.x;
      const dz = pz - vehicle.z;
      const c = Math.cos(-vehicle.yaw);
      const sn = Math.sin(-vehicle.yaw);
      const lx = dx * c + dz * sn;
      const lz = -dx * sn + dz * c;
      if (Math.abs(lx) < CAR_WIDTH / 2 + 0.28 && Math.abs(lz) < CAR_LENGTH / 2 + 0.22) {
        judge.fail('PEDESTRIAN_HIT');
        log(t, 'car', `**보행자와 부딪힘** — ${labels[i]}`);
        ended = true;
      }
    });
    if (!ended && lead && !lead.gone) {
      const gap = lead.gapFrom(f.x, f.z);
      if (gap <= 0.15 && gap > -CAR_LENGTH) {
        judge.fail('VEHICLE_COLLISION');
        log(t, 'car', '**앞차와 추돌**');
        ended = true;
      }
    }
    if (!ended) {
      const onNS = Math.abs(vehicle.x) <= ROAD_HALF_WIDTH + 1.5;
      const onEW = Math.abs(vehicle.z) <= ROAD_HALF_WIDTH + 1.5;
      // 완주선은 코스마다 다르다 — 우회전은 동쪽(x), 직진은 북쪽(z)
      if (goesStraight ? f.z < FINISH_Z : f.x > FINISH_X) {
        judge.markCompleted();
        ended = true;
      } else if (!onNS && !onEW) {
        judge.fail('OFF_ROAD');
        ended = true;
      } else if (t > RUN_TIMEOUT) {
        judge.fail('TIMEOUT');
        log(t, 'car', '**제한시간 100초 초과**');
        ended = true;
      }
    }
  }
  finishStop(t);

  const result = judge.finish();
  if (tele) result.features = tele.finish(result);
  if (traceOn) {
    for (const e of result.log) events.push({ t: e.t, kind: 'judge', text: `[${e.level}] ${e.text}` });
    events.sort((a, b) => a.t - b.t);
  }
  return { persona, result, elapsed: t, stops, peds: summaries, events };
}

/**
 * **개념을 모르는 운전자가 보는 세계** (PlayOptions.blind) — 규칙을 모르는 것을 "그 상황을 못 보는 것" 으로 흉내 낸다.
 * `signalBlind` · `pedBlind` 와 같은 수법을 개념마다 잘게 나눈 것이다.
 */
function blindView(s: AutoDriveState, blind: ReadonlySet<ViolationCode>): AutoDriveState {
  const out: AutoDriveState = { ...s, pedSignal: { ...s.pedSignal } };
  if (blind.has('PEDESTRIAN_BLOCKED')) out.pedestrians = out.pedestrians.filter((p) => p.bike === 'ride');
  if (blind.has('BIKE_BLOCKED')) out.pedestrians = out.pedestrians.filter((p) => p.bike !== 'ride');
  if (blind.has('RED_NO_STOP') || blind.has('STRAIGHT_RED')) out.vehicleLight = 'green';
  // 적색 직진을 모르는 운전자 — 보호구역 전용 도로의 신호기 있는 횡단보도도 녹색으로 본다
  if (blind.has('STRAIGHT_RED') && out.zoneLights) out.zoneLights = { S: 'green', A: 'green', B: 'green' };
  if (blind.has('RIGHT_ARROW_RED') && out.rightArrow !== null) out.rightArrow = 'greenArrow';
  if (blind.has('SCHOOL_ZONE_NO_STOP')) {
    // 신호기 없는 횡단보도의 의무 정지를 모른다 — 신호기가 있고 녹색인 것처럼 본다
    if (out.approachZone && out.approachZone.light === null) out.approachZone = { light: 'green' };
    out.isSchoolZone = false;
    if (out.zoneLights) out.zoneLights = { S: 'green', A: 'green', B: 'green', ...out.zoneLights };
  }
  if (blind.has('SCHOOL_ZONE_RED')) {
    if (out.approachZone && out.approachZone.light !== null) out.approachZone = { light: 'green' };
    if (out.zoneLights) out.zoneLights = { S: 'green', A: 'green', B: 'green' };
  }
  if (blind.has('BLOCKING_INTERSECTION')) out.exitBlocked = false;
  /*
    **정지선을 모르는 운전자** — 정지선이 실제보다 앞에 있다고 본다(앞범퍼가 3m 뒤에 있다고 착각). 규정대로 서는 셈은
    그대로라(정지선 1.8m 앞에 서는 운전자) 정지선을 1.2m 넘어 횡단보도 앞에 선다 — 판정의 정지선 위반(OVER_STOP_LINE, 0.5m 까지는 봐줌)에 걸린다.
  */
  if (blind.has('OVER_STOP_LINE')) {
    out.frontZ = s.frontZ + 3.0;
    out.z = s.z + 3.0;
  }
  return out;
}

/** AutoDriver 가 보는 세계 가운데 **눈으로 알아차리는** 부분 — `human` 은 이것을 늦게 본다 */
type Perception = Pick<
  AutoDriveState,
  | 'vehicleLight'
  | 'rightArrow'
  | 'pedSignal'
  | 'approachZone'
  | 'zoneLights'
  | 'pedestrians'
  | 'exitBlocked'
  | 'lead'
>;

/** 타임라인을 사람이 읽을 글로 */
export function formatTimeline(r: PlayResult): string {
  const lines = r.events.map((e) => {
    const tag = { signal: '신호', ped: '보행', car: '내차', lead: '앞차', judge: '판정' }[e.kind];
    return `  ${e.t.toFixed(1).padStart(5)}s [${tag}] ${e.text}`;
  });
  return lines.join('\n');
}
