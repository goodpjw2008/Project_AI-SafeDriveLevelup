/**
 * 시나리오 검증기 — **사람에게 주기 전에 기계가 먼저 돌려 본다.**
 *
 * ## 왜 필요한가
 *
 * 지금 시나리오는 손으로 쓴 11개다. 앞으로 AI 가 만들게 할 텐데, LLM 이 뱉은 JSON 을
 * 그대로 실행하면 두 가지가 조용히 일어난다.
 *
 *  - **불가능한 판** — 규정대로 몰아도 통과할 수 없는 상황. 이건 최악이다. 이 게임의
 *    존재 이유가 "규정대로 몰면 된다" 를 가르치는 것인데, 그 반대를 가르치게 된다.
 *  - **가르칠 것이 없는 판** — 아무렇게나 몰아도 위반이 안 잡히는 상황. 시간만 쓴다.
 *
 * 둘 다 **눈으로는 안 보인다.** JSON 을 읽어서는 알 수 없고, 직접 플레이해 봐야 아는데
 * AI 가 판마다 새로 만든다면 사람이 다 해 볼 수 없다.
 *
 * ## 그래서 세 겹으로 거른다
 *
 *  1. **구조** — 타입·범위·필수값 (`checkSchema`)
 *  2. **정합성** — 구조는 맞지만 말이 안 되는 조합 (`checkCoherence`)
 *  3. **플레이 가능성** — 실제로 돌려 본다 (`checkPlayable`)
 *
 * 3번이 이 파일의 값어치다. 판정 엔진(lawRules.ts)과 보행자 상태기계(pedWalk.ts)를
 * **게임과 똑같은 것으로** 돌리므로, 검증이 통과했다면 사람이 플레이해도 통과한다.
 *
 * ## 이 순서가 중요하다
 *
 * 검증기를 **생성기보다 먼저** 만든다. 반대로 하면 "LLM 이 이상한 걸 뱉으면 어떡하지" 를
 * 나중에 고민하게 되고, 그 사이에 이상한 판이 사람에게 간다.
 */

import { afterLeadBrake } from './conditions';
import { LEAD_HALF_LENGTH_MAX, LEAD_HEADWAY_MAX, LEAD_HEADWAY_MIN, LeadDrive } from '../game/leadDrive';
import { PedWalk } from '../game/pedWalk';
import { CAR_HALF_LENGTH } from './turnPath';
import { DT, simulate, type DriverConfig, type WorldConfig } from './driveSim';
import {
  APPROACH_EXTRA,
  JAM_CLEAR_SECONDS,
  MAX_ARROW_WAIT,
  SCHOOL_ZONE_PROGRAM,
  STANDARD_PROGRAM,
  phaseAt,
  spawnZ,
  type PedSpawn,
  type ScenarioSpec,
  type SchoolZonePhase,
} from './scenarios';
import type { CrosswalkId, JudgeResult, LightColor, PedSignal, PedestrianSample } from '../rules/lawRules';
import { signalCrosswalk } from '../rules/lawRules';

/**
 * 이 횡단보도에 **지킬 보행신호가 있는가.**
 *
 * 어디서 정해지는지가 갈린다 — 교차로(A·C)는 `pedSignalInstalled`, 진입부(S)는
 * `approachSchoolZone.signal` 이다. 한 곳에 모아 두지 않으면 S 를 더한 뒤에도
 * 옛 자리만 보는 검사가 남는다.
 */
const hasPedSignal = (spec: ScenarioSpec, id: CrosswalkId): boolean => {
  // 사거리 없는 보호구역 도로는 횡단보도마다 신호기를 따로 둔다 (scenarios.ts 의 zoneSignals)
  if (spec.drive === 'zoneOnly') return spec.zoneSignals?.[id as 'S' | 'A' | 'B'] !== undefined;
  const at = signalCrosswalk(id);
  // B 는 A 와 같은 신호기다 (rules/lawRules.ts 의 signalCrosswalk)
  return at === null ? spec.approachSchoolZone?.signal === true : spec.pedSignalInstalled[at];
};

/** 한 건의 지적 — 어디가 왜 잘못됐는지 */
export interface Issue {
  /** `fatal` 은 실행 불가, `warn` 은 실행은 되지만 가르치는 것이 없거나 약함 */
  level: 'fatal' | 'warn';
  /** 어느 검사에서 나왔는가 */
  stage: 'schema' | 'coherence' | 'playable';
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  /** 플레이 검사에서 실제로 돌려 본 결과 — 왜 통과/실패인지 되짚을 때 쓴다 */
  probes?: {
    /** 규정대로 몬 운전자가 받은 판정 */
    exemplary: JudgeResult | null;
    /** 아무렇게나 몬 운전자가 받은 판정 */
    reckless: JudgeResult;
  };
}

const fatal = (stage: Issue['stage'], message: string): Issue => ({ level: 'fatal', stage, message });
const warn = (stage: Issue['stage'], message: string): Issue => ({ level: 'warn', stage, message });

/** 한 판의 길이 상한 (Game.ts 의 RUN_TIMEOUT 과 같아야 한다) */
const RUN_TIMEOUT = 100;

/** 정지선에서 횡단보도 C 까지 약 22m — `startWithin` 이 이보다 훨씬 크면 방아쇠가 무의미하다 */
const MAX_MEANINGFUL_START_WITHIN = 40;

// ── 1단계 · 구조 ────────────────────────────────────────────────────────────

/** `pedSignalInstalled` 이 담아야 하는 횡단보도 — 교차로의 둘뿐이다 (S 는 보호구역 신호가 따로 있다) */
const SIGNAL_CROSSWALKS = ['A', 'C'];

/**
 * 보행자가 설 수 있는 횡단보도.
 *
 * **S(진입로 보호구역)가 빠져 있었다.** 엔진은 S 보행자를 온전히 지원하는데(game/pedWalk.ts ·
 * rules/lawRules.ts · scenarios/playSim.ts), 여기서만 막아 **AI 가 S 보행자를 쓴 판은 무조건 반려**됐다 —
 * 정작 difficulty.ts 의 비용표는 모델에게 `"crosswalk": "S"` 를 쓰라고 이르고 있었다. 라이브러리가
 * 그 횡단보도를 늘 비워 둔 까닭이기도 하다.
 *
 * **B(교차로 건너편)는 직진 코스에서만 쓴다** — 우회전 코스에서는 지나지 않으므로 보행자를 두면
 * 아무 일도 일어나지 않는다. 아래 `checkCoherence` 가 그 어긋남을 잡는다.
 */
const CROSSWALKS = ['A', 'B', 'C', 'S'];
const FROMS = ['left', 'right'];
const KINDS = ['adult', 'child', 'elder'];
const TIMES = ['day', 'dusk', 'night'];
const LEAD_BEHAVIORS = ['lawful', 'rolling'];
const LEAD_PATHS = ['right', 'straight'];
const WEATHERS = ['clear', 'rain'];

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 타입과 범위. **AI 가 만든 것은 아무 모양이나 올 수 있다**고 보고 검사한다 —
 * `ScenarioSpec` 타입은 컴파일 시점의 약속일 뿐, 런타임에 도착한 JSON 을 지켜 주지 않는다.
 */
export function checkSchema(spec: unknown): Issue[] {
  const out: Issue[] = [];
  const push = (m: string): void => void out.push(fatal('schema', m));

  if (typeof spec !== 'object' || spec === null) return [fatal('schema', '객체가 아닙니다')];
  const s = spec as Record<string, unknown>;

  if (!num(s.id) || s.id < 0) push('id 가 0 이상의 숫자가 아닙니다');
  if (typeof s.title !== 'string' || !s.title.trim()) push('title 이 비어 있습니다');
  if (typeof s.brief !== 'string' || !s.brief.trim()) push('brief 가 비어 있습니다');
  if (typeof s.teaches !== 'string' || !s.teaches.trim()) push('teaches 가 비어 있습니다');

  if (!num(s.startPhase) || s.startPhase < 0 || s.startPhase >= STANDARD_PROGRAM.length) {
    push(`startPhase 가 0~${STANDARD_PROGRAM.length - 1} 범위를 벗어납니다 (${String(s.startPhase)})`);
  }
  if (!num(s.startPhaseElapsed) || s.startPhaseElapsed < 0) {
    push('startPhaseElapsed 가 0 이상의 숫자가 아닙니다');
  }

  if (s.rearHonk !== undefined && typeof s.rearHonk !== 'boolean') push('rearHonk 가 boolean 이 아닙니다');

  const inst = s.pedSignalInstalled as Record<string, unknown> | undefined;
  if (typeof inst !== 'object' || inst === null) {
    /*
      **모양을 함께 적는다.** 이 사유는 그대로 다음 요청에 실려 나간다(generate.ts 의
      retryOf). "없습니다" 만 적었더니 모델이 `pedSignalInstalled: false` 를 넣고 왔다 —
      필드가 빠졌다는 말로 읽고 불리언을 채운 것이다. 그리고 그 되먹임을 받은 재시도가
      같은 실수를 세 번 반복해, 첫 요청이 통째로 실패했다.

      반려 사유는 **무엇이 틀렸는지가 아니라 무엇이 맞는지**를 말해야 한다.
    */
    push(
      'pedSignalInstalled 는 횡단보도별 boolean 을 담은 객체여야 합니다 — ' +
        `예: { ${SIGNAL_CROSSWALKS.map((c) => `"${c}": true`).join(', ')} }. ` +
        `받은 값: ${JSON.stringify(s.pedSignalInstalled)}`,
    );
  } else {
    for (const c of SIGNAL_CROSSWALKS) {
      if (typeof inst[c] !== 'boolean') push(`pedSignalInstalled.${c} 가 boolean 이 아닙니다`);
    }
  }

  if (s.rightArrowInstalled !== undefined && typeof s.rightArrowInstalled !== 'boolean') {
    push('rightArrowInstalled 가 boolean 이 아닙니다');
  }
  if (s.leadCar !== undefined) {
    const lead = s.leadCar as Record<string, unknown> | null;
    if (typeof lead !== 'object' || lead === null) {
      push('leadCar 는 { "behavior": "lawful" | "rolling" } 모양의 객체여야 합니다');
    } else {
      if (!LEAD_BEHAVIORS.includes(lead.behavior as string)) {
        push(`leadCar.behavior 가 ${LEAD_BEHAVIORS.join('·')} 중 하나가 아닙니다`);
      }
      if (lead.path !== undefined && !LEAD_PATHS.includes(lead.path as string)) {
        push(`leadCar.path 가 ${LEAD_PATHS.join('·')} 중 하나가 아닙니다`);
      }
      if (
        lead.headway !== undefined &&
        (!num(lead.headway) || lead.headway < LEAD_HEADWAY_MIN || lead.headway > LEAD_HEADWAY_MAX)
      ) {
        push(`leadCar.headway 가 ${LEAD_HEADWAY_MIN}~${LEAD_HEADWAY_MAX}초 범위가 아닙니다`);
      }
    }
  }
  if (!num(s.crossTraffic) || s.crossTraffic < 0 || s.crossTraffic > 8) {
    push('crossTraffic 이 0~8 범위가 아닙니다');
  }
  if (typeof s.exitBlocked !== 'boolean') push('exitBlocked 가 boolean 이 아닙니다');
  if (typeof s.isSchoolZone !== 'boolean') push('isSchoolZone 이 boolean 이 아닙니다');
  if (typeof s.timeOfDay !== 'string' || !TIMES.includes(s.timeOfDay)) {
    push(`timeOfDay 가 ${TIMES.join('·')} 중 하나가 아닙니다`);
  }
  if (typeof s.weather !== 'string' || !WEATHERS.includes(s.weather)) {
    push(`weather 가 ${WEATHERS.join('·')} 중 하나가 아닙니다`);
  }

  if (!Array.isArray(s.pedestrians)) {
    push('pedestrians 가 배열이 아닙니다');
  } else {
    // 덧붙이는 사람들(library.ts 의 EXTRAS)까지 다섯 사람 + 자전거 둘 = 7 이 가장 많다
    if (s.pedestrians.length > 8) push('보행자가 8명을 넘습니다');
    s.pedestrians.forEach((raw, i) => {
      const p = raw as Record<string, unknown>;
      const at = (m: string): string => `보행자[${i}] ${m}`;
      if (typeof p !== 'object' || p === null) return push(at('가 객체가 아닙니다'));
      if (typeof p.crosswalk !== 'string' || !CROSSWALKS.includes(p.crosswalk)) {
        push(at('crosswalk 가 A·B·C·S 가 아닙니다'));
      }
      /*
        S 보행자는 **그 횡단보도가 있는 판**에만 설 수 있다 — 없으면 화면에 그릴 자리가 없다.
        사거리 없는 보호구역 도로(drive: 'zoneOnly')는 S 가 그 길의 **첫 번째 횡단보도**라 늘 있다.
      */
      if (p.crosswalk === 'S' && s.drive !== 'zoneOnly' && s.approachSchoolZone === undefined) {
        push(at('S 는 진입로 어린이보호구역이 있는 판에만 쓸 수 있습니다'));
      }
      if (!num(p.at) || p.at < 0) push(at('at 이 0 이상의 숫자가 아닙니다'));
      if (typeof p.from !== 'string' || !FROMS.includes(p.from)) {
        push(at('from 이 left·right 가 아닙니다'));
      }
      if (p.startWithin !== undefined && (!num(p.startWithin) || p.startWithin <= 0)) {
        push(at('startWithin 이 양수가 아닙니다'));
      }
      if (p.speed !== undefined && (!num(p.speed) || p.speed <= 0 || p.speed > 3)) {
        push(at('speed 가 0~3 m/s 범위가 아닙니다'));
      }
      if (p.obeysSignal !== undefined && typeof p.obeysSignal !== 'boolean') {
        push(at('obeysSignal 이 boolean 이 아닙니다'));
      }
      if (p.kind !== undefined && (typeof p.kind !== 'string' || !KINDS.includes(p.kind))) {
        push(at('kind 가 adult·child·elder 가 아닙니다'));
      }
      if (p.afterLead !== undefined && typeof p.afterLead !== 'boolean') {
        push(at('afterLead 가 boolean 이 아닙니다'));
      }
      if (p.letsCarPass !== undefined && typeof p.letsCarPass !== 'boolean') {
        push(at('letsCarPass 가 boolean 이 아닙니다'));
      }
      if (p.chance !== undefined && (!num(p.chance) || p.chance <= 0 || p.chance > 1)) {
        push(at('chance 가 0~1 범위가 아닙니다'));
      }
    });
  }

  return out;
}

// ── 2단계 · 정합성 ──────────────────────────────────────────────────────────

/**
 * 구조는 맞는데 **말이 안 되는** 조합을 잡는다.
 *
 * 여기서 걸리는 것들은 타입 검사로는 절대 안 잡히고, 플레이해 보면 "뭔가 이상한데
 * 뭐가 이상한지 모르겠는" 판이 된다.
 */
export function checkCoherence(spec: ScenarioSpec): Issue[] {
  const out: Issue[] = [];

  for (const p of spec.pedestrians) {
    /*
      신호기가 없는 횡단보도인데 '신호를 지킨다' 고 **적어 둔** 보행자다. 지킬 신호가 없으므로 이 사람은
      `obeysSignal` 이 무시되고 언제든 건넌다 — 시나리오를 쓴 쪽의 의도와 어긋난다.

      **적지 않은 것은 주장이 아니다.** 예전에는 `!== false` 로 보아 값을 생략한 판까지 짚었는데,
      신호기 없는 횡단보도에서는 생략이 오히려 맞는 표기다 (사거리 없는 보호구역 도로의 판 대부분).
    */
    if (p.obeysSignal === true && !hasPedSignal(spec, p.crosswalk)) {
      out.push(
        warn(
          'coherence',
          `${p.crosswalk} 횡단보도에 보행신호기가 없는데 보행자가 obeysSignal=true 입니다 — 지킬 신호가 없어 무시됩니다`,
        ),
      );
    }
    // 앞차 뒤로 나서는 사람인데 앞차가 없다 — 기다릴 앞차가 없으니 처음부터 평범한 보행자다
    if (p.afterLead && !spec.leadCar) {
      out.push(warn('coherence', `${p.crosswalk} 횡단보도 보행자가 afterLead 인데 앞차가 없습니다 — 무시됩니다`));
    }
    // 등장 시각이 판 길이를 넘으면 그 사람은 영영 나오지 않는다
    if (p.at >= RUN_TIMEOUT) {
      out.push(fatal('coherence', `보행자 등장 시각(${p.at}초)이 판 제한시간(${RUN_TIMEOUT}초) 이후입니다`));
    }
    if (p.startWithin !== undefined && p.startWithin > MAX_MEANINGFUL_START_WITHIN) {
      out.push(
        warn(
          'coherence',
          `startWithin=${p.startWithin}m 는 너무 멀어 거리 방아쇠가 사실상 없는 것과 같습니다`,
        ),
      );
    }
  }

  /*
    **직진하는 앞차에는 건너뛸 일시정지가 없다.** 적색이면 성향과 무관하게 녹색까지 서 있고,
    녹색이면 그냥 지나간다 — `rolling` 을 붙여 봐야 아무 일도 일어나지 않는데, 제목과 설명은
    "앞차가 그냥 간다" 를 말하게 된다. 판이 글과 다른 것을 가르치는 자리다.
  */
  if (spec.leadCar?.path === 'straight' && spec.leadCar.behavior === 'rolling') {
    out.push(
      fatal(
        'coherence',
        '직진하는 앞차에는 "rolling"(일시정지 건너뜀)이 없습니다 — 직진은 적색에 아예 갈 수 없습니다. ' +
          'behavior 를 "lawful" 로 두거나, 일시정지를 건너뛰는 앞차를 원하면 path 를 "right" 로 두십시오',
      ),
    );
  }

  /*
    우회전 신호등을 다는 이유는 우회전 차량과 횡단보도 C 보행자를 신호로 갈라 놓는 것이다.
    그런데 C 에 보행신호기가 없으면 갈라 놓을 대상이 없다 — 설치 의미가 사라진다.
  */
  if (spec.rightArrowInstalled && !spec.pedSignalInstalled.C) {
    out.push(
      warn(
        'coherence',
        '우회전 신호등이 있는데 횡단보도 C 에 보행신호기가 없습니다 — 둘을 맞물리게 하는 것이 설치 이유입니다',
      ),
    );
  }

  /*
    **불가능한 판과 지루한 판을 가른다.**

    우회전 신호등이 있으면 녹색 화살표 전에는 어떻게 해도 우회전할 수 없다. 시작 구간을
    잘못 고르면 47초를 서 있어야 하는 판이 나오는데, 제한시간 안이라 '통과 가능' 이긴 하다.
    통과 가능하다고 좋은 판은 아니다 — 배우는 게 아니라 견디는 것이 된다.
  */
  /*
    기다림은 **교차로에 닿은 뒤부터** 센다. 진입로 보호구역이 있는 판은 교차로에 닿기까지 더 걸리는데(APPROACH_EXTRA),
    그동안 녹색 화살표가 켜져 버리면 적색 화살표 앞에서 기다리는 장면이 사라진다.
  */
  const zone = spec.approachSchoolZone;
  const travel = zone ? APPROACH_EXTRA[zone.signal ? (zone.signalElapsed ? 'signal' : 'signalGreen') : 'noSignal'] : 0;
  const firstLegal = firstLegalTurnAt(spec);
  const legalAt = firstLegal === null ? null : Math.max(0, firstLegal - travel);
  if (legalAt === null) {
    out.push(fatal('coherence', '우회전 신호등이 한 주기 내내 녹색 화살표가 되지 않습니다 — 우회전할 방법이 없습니다'));
  } else if (legalAt > MAX_TOLERABLE_WAIT) {
    /*
      **경고가 아니라 치명이다.** 통과는 되지만 학습자는 적색 화살표 앞에서 47초를 서
      있게 된다. 그 시간에 배우는 것은 없고, 이 게임이 가르치려는 판단은 한 번도 일어나지
      않는다. "기술적으로 가능" 과 "줘도 되는 판" 은 다르다.
    */
    out.push(
      fatal(
        'coherence',
        `우회전이 허용되기까지 ${legalAt.toFixed(0)}초를 기다려야 합니다 — 시작 구간(startPhase)을 녹색 화살표(2번 구간)에 가깝게 옮기십시오`,
      ),
    );
  }

  return out;
}

// ── 3단계 · 플레이 가능성 ───────────────────────────────────────────────────

/** 시나리오를 시뮬레이터가 읽을 세계로 옮긴다 — 신호는 게임과 같은 프로그램을 쓴다 */
function toWorld(spec: ScenarioSpec, peds: PedSpawn[]): WorldConfig {
  const at = (t: number) => phaseAt(STANDARD_PROGRAM, spec.startPhase, spec.startPhaseElapsed, t);

  /*
    보행자는 **게임과 같은 상태기계**(pedWalk.ts)를 돌린다. 여기서 따로 흉내 내면
    검증이 통과한 판이 실제로는 다르게 굴러가고, 그 어긋남은 아무도 눈치채지 못한다.

    `simulate` 이 이 콜백을 매 스텝 정확히 한 번, 시간 순서대로 부르므로 상태를 안전하게
    굴릴 수 있다 (driveSim.ts 의 WorldConfig.pedestrians 주석 참고).
  */
  const walkers = peds.map((p) => new PedWalk(p));

  /*
    앞차도 **게임과 같은 상태기계**(leadDrive.ts)를 돌린다. 보행자와 같은 이유다.
    길이는 가장 긴 차로 잰다 (LEAD_HALF_LENGTH_MAX 주석).
  */
  const lead = spec.leadCar
    ? new LeadDrive(spec.leadCar, {
        playerSpawnZ: spawnZ(spec),
        playerHalfLength: CAR_HALF_LENGTH,
        halfLength: LEAD_HALF_LENGTH_MAX,
        isSchoolZone: spec.isSchoolZone,
        hasApproachZone: spec.approachSchoolZone !== undefined,
      })
    : null;

  /*
    **진입부 보호구역은 자기 주기를 돈다** (SCHOOL_ZONE_PROGRAM). 교차로 주기와 따로인
    이유는 scenarios.ts 의 그 표 주석에 있다. 구간이 없거나 신호기가 없으면 `null` —
    그 `null` 이 곧 "신호기 없는 횡단보도" 이고, 제27조 제7항이 걸리는 자리다.
  */
  const zoneAt = (t: number): SchoolZonePhase | null =>
    spec.approachSchoolZone?.signal
      ? phaseAt(SCHOOL_ZONE_PROGRAM, 0, spec.approachSchoolZone.signalElapsed ?? 0, t)
      : null;

  /*
    **사거리 없는 보호구역 도로는 횡단보도마다 자기 신호를 돈다** (drive: 'zoneOnly').
    적힌 자리만 신호기가 있고(spec.zoneSignals), 나머지는 없다 — 그 '없음' 이 제27조 제7항의 자리다.
  */
  const zoneLightAt = (t: number): Partial<Record<CrosswalkId, LightColor>> => {
    const out: Partial<Record<CrosswalkId, LightColor>> = {};
    for (const [id, offset] of Object.entries(spec.zoneSignals ?? {})) {
      out[id as CrosswalkId] = phaseAt(SCHOOL_ZONE_PROGRAM, 0, offset, t).vehicle;
    }
    return out;
  };
  const zonePedAt = (t: number, id: CrosswalkId): PedSignal | null => {
    const offset = spec.zoneSignals?.[id as 'S' | 'A' | 'B'];
    return offset === undefined ? null : phaseAt(SCHOOL_ZONE_PROGRAM, 0, offset, t).ped;
  };

  return {
    vehicleLight: (t) => at(t).vehicle,
    ...(spec.drive === 'zoneOnly' ? { zoneLights: zoneLightAt } : {}),
    rightArrow: spec.rightArrowInstalled ? (t) => at(t).rightArrow : null,
    pedSignalA: (t) => (spec.pedSignalInstalled.A ? at(t).pedA : null),
    pedSignalC: (t) => (spec.pedSignalInstalled.C ? at(t).pedC : null),
    pedSignalS: (t) => zoneAt(t)?.ped ?? null,
    approachZone: spec.approachSchoolZone ? (t) => zoneAt(t)?.vehicle ?? null : undefined,
    pedestrians: (t, car, ctx): PedestrianSample[] => {
      const phase = at(t);
      return walkers.map((w, i) => {
        // 사거리 없는 도로에서는 그 횡단보도의 보호구역 신호를 본다 (위 zonePedAt)
        if (spec.drive === 'zoneOnly') {
          const busyZone = lead?.blocksCrosswalk(w.crosswalk) ?? false;
          w.update(t, DT, zonePedAt(t, w.crosswalk), { x: car.frontX, z: car.frontZ }, ctx.speedKmh > 0.5, busyZone, {
            leadInWay: lead?.inWayOf(w.crosswalk) ?? false,
            carSpeedMs: ctx.speedKmh / 3.6,
            brakeDecel: afterLeadBrake(spec.weather),
          });
          return { ...w.sample(), id: i };
        }
        // 횡단보도마다 자기 신호를 본다 — B 는 A 와 같은 등화다 (rules/lawRules.ts 의 signalCrosswalk)
        const at = signalCrosswalk(w.crosswalk);
        const signal =
          at === null
            ? (zoneAt(t)?.ped ?? null)
            : spec.pedSignalInstalled[at]
              ? at === 'A'
                ? phase.pedA
                : phase.pedC
              : null;
        // 앞차가 코앞까지 온 횡단보도로는 나서지 않는다 (게임의 trafficBusy 와 같다)
        const busy = lead?.blocksCrosswalk(w.crosswalk) ?? false;
        w.update(t, DT, signal, { x: car.frontX, z: car.frontZ }, ctx.speedKmh > 0.5, busy, {
          leadInWay: lead?.inWayOf(w.crosswalk) ?? false,
          carSpeedMs: ctx.speedKmh / 3.6,
          brakeDecel: afterLeadBrake(spec.weather),
        });
        return { ...w.sample(), id: i };
      });
    },
    lead: lead
      ? (t, car, pedSamples) => {
          const phase = at(t);
          lead.update(DT, {
            vehicleLight: phase.vehicle,
            rightArrow: spec.rightArrowInstalled ? phase.rightArrow : null,
            pedSignal: {
              A: spec.pedSignalInstalled.A ? phase.pedA : null,
              B: spec.pedSignalInstalled.A ? phase.pedA : null,
              C: spec.pedSignalInstalled.C ? phase.pedC : null,
              S: zoneAt(t)?.ped ?? null,
            },
            approachZone: spec.approachSchoolZone ? { light: zoneAt(t)?.vehicle ?? null } : null,
            pedestrians: pedSamples,
            exitBlocked: spec.exitBlocked && t < JAM_CLEAR_SECONDS,
            isSchoolZone: spec.isSchoolZone,
          });
          return {
            gap: lead.gapFrom(car.frontX, car.frontZ),
            speedKmh: lead.speedKmh,
            queued: lead.queuesAhead(car.frontX, car.frontZ),
          };
        }
      : undefined,
    /*
      정체는 **풀린다.** 게임이 `JAM_CLEAR_SECONDS` 뒤에 풀어 주므로 여기서도 그렇게 본다.
      정적인 true 로 두었더니 꼬리물기 판이 전부 "통과 불가능" 으로 걸렸는데, 실제로는
      정지선에서 10초만 기다리면 되는 판이었다 — 검증기와 게임이 어긋난 사례다.
    */
    exitBlocked: (t) => spec.exitBlocked && t < JAM_CLEAR_SECONDS,
    /* 교차로가 보호구역인가 — 진입부 구간(approachZone)과 별개다 */
    isSchoolZone: spec.isSchoolZone,
    isDaytime: spec.timeOfDay !== 'night',
  };
}

/**
 * 규정을 지키는 운전자의 여러 모습.
 *
 * **한 가지로 못 잡는다.** 정면이 적색이면 정지선에 서야 하고, 녹색이면 서지 않고 서행으로
 * 지나가는 것이 맞다. 어린이보호구역이면 또 다르다. 그래서 "이 중 하나라도 위반 없이
 * 통과하면 이 판은 통과 가능하다" 로 본다 — 존재만 확인하면 되는 문제다.
 */
const EXEMPLARY: DriverConfig[] = (() => {
  /*
    `maxYieldSeconds` 를 크게 잡는 이유: 규정을 지키는 운전자는 보행자가 다 건널 때까지
    **기다린다.** 짧게 끊으면 "기다리다 지쳐 밀고 들어간" 주행이 되어, 통과 불가능한 판이
    "위반은 났지만 완주는 했다" 로 잘못 읽힌다. 대신 아래에서 **제한시간**으로 거른다 —
    끝없이 기다려야 하는 판은 시간 초과로 잡힌다.
  */
  const common = {
    yieldUntilClear: true,
    turnSignal: 'always',
    turnStyle: 'tight',
    turnKmh: 12,
    maxYieldSeconds: 90,
  } as const;
  const out: DriverConfig[] = [];
  /*
    정지선에서 얼마나 서는가 — 0(서지 않음)은 정면이 녹색일 때 맞고, 12초는 적색이
    바뀌기를 기다리는 경우다.

    **진출 횡단보도(C)에서 무조건 서는 쪽을 반드시 넣어야 한다.** 어린이보호구역의
    신호기 없는 횡단보도는 **보행자가 없어도** 일시정지가 의무이기 때문이다
    (제27조 제7항). 처음에는 '보행자가 있을 때만 선다'만 넣었다가 Stage07 이
    "통과 불가능" 으로 걸렸는데, 틀린 것은 시나리오가 아니라 이 목록이었다 —
    검증기가 제 모범 운전 모델의 구멍을 먼저 찾아낸 셈이다.
  */
  /*
    **진입부 보호구역 횡단보도(S)에서도 같은 이유로 서는 쪽을 넣는다.**

    거기 신호기가 없으면 보행자가 없어도 일시정지가 의무고(제27조 제7항), 신호기가
    있으면 적색을 기다려야 한다 — 어느 쪽이든 안 서는 운전은 모범이 아니다.
    구간이 없는 판에서는 이 정지가 그냥 길에서 잠깐 서는 것이라 판정에 걸리지 않으므로,
    시나리오를 보지 않고 두 경우를 모두 넣어 둔다.

    적색을 기다리는 데 필요한 시간은 최대 21초다(SCHOOL_ZONE_PROGRAM 의 적색 12 + 점멸
    4 + 전적색 2 에 여유). 아래 목록의 25초가 그것을 덮는다.
  */
  for (const stopAtSchoolZoneLine of [0, 2, 25]) {
    for (const stopAtLine of [0, 2, 4, 12, 30, 55]) {
      for (const stopBeforeExitCrosswalk of [0, 2]) {
        out.push({ ...common, stopAtSchoolZoneLine, stopAtLine, stopBeforeExitCrosswalk });
      }
    }
  }
  /*
    **직진 코스의 모범 운전자** (어린이보호구역 연습편).

    다른 것이 둘 있다. ① 적색에는 **갈 수 없으므로** 정지선에서 녹색이 될 때까지 기다린다
    (`waitForGreen`) — 몇 초 서는가로는 흉내 낼 수 없다. ② **방향지시등을 켜지 않는다** —
    돌지 않으므로 켤 의무가 없고, 판정도 직진에서는 묻지 않는다 (rules/lawRules.ts).

    `drive` 는 여기서 정하지 않는다 — 검증기가 판을 보고 붙인다 (checkPlayable).
  */
  return out;
})();

/**
 * **곧게 가는 코스의 모범 운전자** — 교차로 직진 통과(straight)와 사거리 없는 보호구역 도로(zoneOnly).
 *
 * 우회전 목록과 다른 것이 둘 있다. ① 적색에는 **갈 수 없으므로** 녹색이 될 때까지 기다린다
 * (`waitForGreen`) — 몇 초 서는가로는 흉내 낼 수 없다. ② **방향지시등을 켜지 않는다** — 돌지 않으므로
 * 켤 의무가 없고, 판정도 묻지 않는다 (rules/lawRules.ts).
 *
 * **목록을 갈라 두는 이유**는 빠르기다. 한 판에 서른여섯 가지를 다 돌리면 보호구역 판 553개를 검증하는 데
 * 4분이 넘었다 — 우회전 운전자는 이 코스를 통과할 수 없으니 처음부터 돌리지 않는다.
 */
const EXEMPLARY_STRAIGHT: DriverConfig[] = (() => {
  const common = {
    yieldUntilClear: true,
    turnSignal: 'never',
    waitForGreen: true,
    turnKmh: 12,
    maxYieldSeconds: 90,
  } as const;
  const out: DriverConfig[] = [];
  for (const stopAtSchoolZoneLine of [2, 25]) {
    for (const stopBeforeExitCrosswalk of [2, 0]) {
      out.push({ ...common, stopAtSchoolZoneLine, stopAtLine: 2, stopBeforeExitCrosswalk });
    }
  }
  return out;
})();

/**
 * 우회전이 **처음으로 허용되는 시각**(초). 없으면 `null`.
 *
 * 우회전 신호등이 달린 교차로에서는 그 등화가 정면 신호를 대체하므로(시행규칙 [별표 2]
 * 비고 제3호), **녹색 화살표가 켜질 때까지는 어떻게 해도 우회전할 수 없다.** 시작 구간을
 * 잘못 고르면 47초를 서 있어야 하는 판이 나온다 — 불가능하지는 않지만 게임이 아니다.
 */
function firstLegalTurnAt(spec: ScenarioSpec): number | null {
  // 직진 코스는 우회전 신호등을 기다릴 일이 없다 — 곧장 통과한다
  if (spec.drive === 'straight') return 0;
  if (!spec.rightArrowInstalled) return 0;
  const cycle = STANDARD_PROGRAM.reduce((sum, p) => sum + p.duration, 0);
  for (let t = 0; t <= cycle; t += 0.5) {
    if (phaseAt(STANDARD_PROGRAM, spec.startPhase, spec.startPhaseElapsed, t).rightArrow === 'greenArrow') {
      return t;
    }
  }
  return null;
}

/** 정지선에서 이보다 오래 서 있어야 하는 판은 배우는 게 아니라 견디는 것이 된다 (scenarios.ts 와 같은 값) */
const MAX_TOLERABLE_WAIT = MAX_ARROW_WAIT;

/**
 * 아무렇게나 모는 운전자 — 이 게임이 잡아내려는 그 행동이다.
 * 정지선도 안 서고, 지시등도 안 켜고, 크게 돌고, 서행하지 않는다.
 */
const RECKLESS: DriverConfig = {
  stopAtLine: 0,
  yieldUntilClear: false,
  turnSignal: 'never',
  turnStyle: 'wide',
  turnKmh: 30,
  cruiseKmh: 45,
};

/**
 * 실제로 돌려 본다.
 *
 * `chance` 가 붙은 보행자는 나올 수도 안 나올 수도 있으므로 **양쪽 다** 확인한다 —
 * 한쪽만 통과 가능한 판은 운에 따라 불가능해진다.
 */
export function checkPlayable(spec: ScenarioSpec): { issues: Issue[]; probes: ValidationResult['probes'] } {
  const issues: Issue[] = [];
  /*
    **어느 코스인지 먼저 정한다** — 우회전이면 지금까지와 같고, 직진이면 경로도 판정도 달라진다
    (scenarios.ts 의 `drive`). 모범 운전자 · 막 모는 운전자 모두 같은 코스로 달려야 한다.
  */
  const drive = spec.drive ?? 'rightTurn';

  const always = spec.pedestrians.filter((p) => p.chance === undefined);
  const variants: { label: string; peds: PedSpawn[] }[] =
    always.length === spec.pedestrians.length
      ? [{ label: '', peds: spec.pedestrians }]
      : [
          { label: ' (확률 보행자 전원 등장)', peds: spec.pedestrians },
          { label: ' (확률 보행자 미등장)', peds: always },
        ];

  let bestExemplary: JudgeResult | null = null;

  for (const v of variants) {
    /*
      **통과 가능한 몰기가 하나라도 있는가.** 없으면 이 판은 규정을 지켜도 못 깨는 판이고,
      그건 이 게임이 가르치려는 것의 정반대다.
    */
    let passed: JudgeResult | null = null;
    // 코스에 맞는 모범 운전자만 돌린다 (위 EXEMPLARY_STRAIGHT)
    for (const driver of drive === 'rightTurn' ? EXEMPLARY : EXEMPLARY_STRAIGHT) {
      const r = simulate(toWorld(spec, v.peds), { ...driver, startZ: spawnZ(spec), drive });
      /*
        **제한시간을 넘긴 주행은 통과가 아니다.** 게임은 100초에 시간 초과로 실패시킨다.
        위반 없이 완주했더라도 110초가 걸렸다면 사람이 플레이하면 반드시 실패한다 —
        이 검사가 없어서 "끝없이 기다려야 하는 판" 이 통과로 잡혔었다.
      */
      if (r.violations.length === 0 && !r.failReason && r.stats.elapsed <= RUN_TIMEOUT) {
        passed = r;
        break;
      }
      if (!passed && !bestExemplary) bestExemplary = r;
    }

    if (!passed) {
      issues.push(
        fatal(
          'playable',
          `규정대로 몰아도 위반 없이 통과할 수 없습니다${v.label} — 이 판은 "규정을 지키면 된다"의 반대를 가르칩니다`,
        ),
      );
    } else {
      bestExemplary = passed;
      if (passed.stats.elapsed > RUN_TIMEOUT * 0.8) {
        issues.push(
          warn(
            'playable',
            `모범 주행에 ${passed.stats.elapsed.toFixed(0)}초가 걸립니다${v.label} — 제한시간(${RUN_TIMEOUT}초)에 너무 가깝습니다`,
          ),
        );
      }
    }
  }

  /*
    **가르칠 것이 있는가.** 아무렇게나 몰았는데 아무 일도 안 일어나면, 이 판은 통과해도
    배운 것이 없다. 위반이 하나도 안 잡히면 상황 자체가 성립하지 않은 것이다.
  */
  const reckless = simulate(toWorld(spec, spec.pedestrians), {
    ...RECKLESS,
    startZ: spawnZ(spec),
    drive,
  });
  if (reckless.violations.length === 0 && !reckless.failReason) {
    issues.push(
      warn(
        'playable',
        '아무렇게나 몰아도 위반이 잡히지 않습니다 — 이 판에는 가르칠 상황이 없습니다',
      ),
    );
  }

  return { issues, probes: { exemplary: bestExemplary, reckless } };
}

// ── 전체 ────────────────────────────────────────────────────────────────────

/**
 * 세 겹을 차례로 통과시킨다. **앞 단계가 치명적으로 실패하면 뒤는 돌리지 않는다** —
 * 구조가 깨진 것을 시뮬레이터에 넣으면 검증기가 죽는다.
 */
export function validateScenario(spec: unknown): ValidationResult {
  const schema = checkSchema(spec);
  if (schema.some((i) => i.level === 'fatal')) return { ok: false, issues: schema };

  const s = spec as ScenarioSpec;

  const coherence = checkCoherence(s);
  if (coherence.some((i) => i.level === 'fatal')) {
    return { ok: false, issues: [...schema, ...coherence] };
  }

  /*
    조건이 판마다 새로 뽑히는 판(Stage08)은 **이 스펙 자체가 실행되지 않는다** —
    `prepareScenario` 가 매번 다른 것으로 갈아 끼운다. 돌려 봐야 의미가 없다.
  */
  if (s.randomized) {
    return { ok: true, issues: [...schema, ...coherence] };
  }

  const { issues: playable, probes } = checkPlayable(s);
  const issues = [...schema, ...coherence, ...playable];
  return { ok: !issues.some((i) => i.level === 'fatal'), issues, probes };
}

/** 사람이 읽을 한 줄 요약 — 개발 중 콘솔과 검증 스크립트가 쓴다 */
export function describeIssues(issues: Issue[]): string {
  if (!issues.length) return '문제 없음';
  return issues
    .map((i) => `  [${i.level === 'fatal' ? '치명' : '경고'}·${i.stage}] ${i.message}`)
    .join('\n');
}
