/**
 * 우회전 법규 판정 엔진.
 *
 * Three.js나 DOM에 전혀 의존하지 않는 순수 로직이다. 프레임마다 `update(sample, dt)`로
 * 세계 상태를 받아 누적하고, 경계선을 넘는 순간마다 판정을 확정한다.
 * 덕분에 브라우저 없이 단위 테스트로 "이 입력 시퀀스는 신호위반" 을 검증할 수 있다.
 *
 * 판정 근거는 전부 src/rules/lawCitations.ts 의 조문 원문과 1:1로 대응된다.
 */

import {
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_S_OUTER,
  INNER_CORNER,
  INTERSECTION_HALF,
  LANE_WIDTH,
  STOP_LINE,
  STOP_LINE_S,
  TURN_SIGNAL_GATE_Z,
} from '../layout';
import { VIOLATIONS, type ViolationCode, type ViolationEvent } from './violations';

// ────────────────────────────────────────────────────────────────────────────
// 입력 타입
// ────────────────────────────────────────────────────────────────────────────

/** 차량신호등 원형등화 */
export type LightColor = 'green' | 'yellow' | 'red' | 'redFlash';

/** 우회전 신호등. null 이면 해당 교차로에 설치되어 있지 않음. */
export type RightArrowColor = 'greenArrow' | 'yellowArrow' | 'redArrow';

/** 보행신호등 */
export type PedSignal = 'green' | 'greenFlash' | 'red';

/**
 * 횡단보도 식별자.
 *
 *  - `S` — **진입부 어린이보호구역**의 횡단보도. 교차로에 닿기 전, 오는 길에 있다
 *  - `A` — 교차로 진입 전(1차)
 *  - `C` — **우회전 후**(2차) — 우회전 코스에서 만난다
 *  - `B` — **교차로 건너편**(북) — 직진 코스에서 만난다. A 와 같은 남북 도로를 가로지른다
 *
 * 만나는 순서는 코스에 따라 **S → A → C**(우회전) 또는 **S → A → B**(직진)다.
 * 글자가 순서를 말하지 않는 이유는 A·B·C 가 교차로의 네 횡단보도(A·B·C·D) 중 셋이라서다 —
 * 거기에 끼워 넣으면 교차로 밖의 것을 교차로의 것처럼 부르게 된다. S 는 그 체계 밖에 있다.
 */
export type CrosswalkId = 'A' | 'B' | 'C' | 'S';

/**
 * **이 판을 어떻게 빠져나가는가.**
 *
 *  - `rightTurn` — 교차로에서 우회전 (지금까지의 모든 판)
 *  - `straight` — 교차로를 직진으로 통과
 *  - `zoneOnly` — **사거리가 없는 어린이보호구역 전용 도로**를 곧장 지난다 (사용자가 정했다:
 *    "어린이 보호구역 연습은 사거리가 나오지 말아야 해"). 교차로가 없으므로 교차로 규칙을 하나도
 *    묻지 않고, 지나는 횡단보도 셋을 **모두 보호구역 횡단보도로** 본다
 *
 * 판정이 달라지는 것은 **우회전에만 있는 의무**들이다: 우측 가장자리 통행(대회전), 방향지시등,
 * 우회전 후 횡단보도(C). 직진에서는 그 셋을 묻지 않고 대신 건너편 횡단보도(B)를 본다.
 */
export type DriveMode = 'rightTurn' | 'straight' | 'zoneOnly';

/**
 * 교차로에 딸린 횡단보도만 — 신호가 교차로의 한 주기(STANDARD_PROGRAM)를 따른다.
 *
 * S 는 자기 주기를 따로 갖거나(SCHOOL_ZONE_PROGRAM) 아예 신호기가 없으므로 여기 없다.
 */
export type IntersectionCrosswalk = 'A' | 'C';

/**
 * **B 는 A 와 같은 신호기를 쓴다.**
 *
 * 둘 다 남북 도로를 가로지르는 횡단보도이고 교차로를 사이에 두고 마주 본다 — 실제 교차로에서도
 * 그 둘의 보행신호는 **같은 등화**다(동서 차량신호가 녹색일 때 함께 녹색). 그래서 `pedSignalInstalled`
 * 에 B 자리를 따로 두지 않는다: 자리를 늘리면 시나리오 수천 개의 리터럴을 모두 고쳐야 하는데,
 * 고쳐 봐야 두 값이 **어긋날 수 있는 자리**만 새로 생긴다.
 */
export const signalCrosswalk = (c: CrosswalkId): IntersectionCrosswalk | null =>
  c === 'S' ? null : c === 'B' ? 'A' : c;

export interface PedestrianSample {
  crosswalk: CrosswalkId;
  /**
   * 제27조 제1항의 "횡단보도를 통행하고 있거나 통행하려고 하는 때"에 해당하는가.
   * 보행신호와 상관없이 보행자의 상태가 기준이다. 이것이 이 게임의 핵심 교육 포인트.
   */
  intendsToCross: boolean;
  /**
   * 아직 **통행이 끝나지 않았는가** (차도 위에 있는가).
   *
   * '내 차로를 지났는가' 가 아니다 — 내 차로만 지나면 된다고 보면 아직 횡단보도 한복판인
   * 보행자 앞으로 지나가도 위반이 아니게 된다 (Pedestrian.ts 의 같은 이름 주석 참고).
   */
  onConflictPath: boolean;
  /**
   * **자전거를 가진 사람인가** (scenarios.ts 의 `PedSpawn.bike`).
   *
   *  - `push` 끌고 건넌다 — **보행자다** (제2조 제17호). 판정도 보행자 그대로다
   *  - `ride` 타고 건넌다 — 보행자가 아니다. `BIKE_BLOCKED` 로 따로 적는다
   */
  bike?: 'ride' | 'push';
  /** 아래 값들은 판정에 쓰지 않는다 — 주행 기록과 결과 지도를 위한 것이다. */
  state?: 'waiting' | 'crossing' | 'done';
  signal?: PedSignal | null;
  /** 화면에 보이는(=아직 상황에 참여 중인) 보행자인가 */
  active?: boolean;
  /** 현재 위치 — 결과 지도에 경로를 그린다 */
  x?: number;
  z?: number;
  /** 같은 보행자의 발자국을 이어 붙이기 위한 식별자 (배열 순서) */
  id?: number;
}

export interface WorldSample {
  /** 시나리오 시작 이후 경과 시간(초) */
  t: number;
  /** 자전거횡단도가 설치된 횡단보도 (scenarios.ts 의 `ScenarioSpec.bikeLane`) — 없으면 생략 */
  bikeLane?: CrosswalkId;
  /** 차량 앞범퍼 중앙의 좌표 — 정지선/횡단보도 통과 판정 기준점 */
  frontX: number;
  frontZ: number;
  /** 차량 중심 좌표 — 회전 궤적 판정용 */
  centerX: number;
  centerZ: number;
  /** km/h */
  speedKmh: number;
  /** 우측 방향지시등 점등 여부 */
  rightSignalOn: boolean;
  /** 정면 차량신호등등 */
  vehicleLight: LightColor;
  /** 우회전 신호등. 미설치면 null. */
  rightArrow: RightArrowColor | null;
  /** 각 횡단보도의 보행신호등. 신호기 미설치면 null. */
  pedSignal: Record<CrosswalkId, PedSignal | null>;
  /**
   * **진입부 어린이보호구역** — 오는 길에 지나는 구간. 없으면 `null`.
   *
   * 교차로의 `isSchoolZone` 과 별개다. 둘 다 켜질 수도, 이쪽만 켜질 수도 있다.
   */
  approachZone: {
    /** 차량신호등. 신호기 없는 횡단보도면 `null` — 그때가 제27조 제7항의 자리다 */
    light: LightColor | null;
  } | null;
  /**
   * **사거리 없는 보호구역 전용 도로**에서, 지나는 횡단보도마다의 차량신호 (`zoneOnly` 코스).
   *
   * 값이 없는 자리는 **신호기가 없는 횡단보도**다 — 보행자가 없어도 일시정지해야 하는 자리
   * (제27조 제7항). 한 도로에 신호기가 있는 곳과 없는 곳이 섞이는 것이 이 코스의 핵심이라,
   * 교차로 주기 하나로 묶지 않고 **횡단보도마다** 따로 받는다.
   */
  zoneLights?: Partial<Record<CrosswalkId, LightColor>>;
  pedestrians: PedestrianSample[];
  /** 교차로 진출로가 정체되어 교차로 안에 갇힐 상황인가 (꼬리물기 판정) */
  exitBlocked: boolean;
  /** 어린이보호구역인가 */
  isSchoolZone: boolean;
  /**
   * **앞차 뒤에 줄 서 있는가** — 앞차가 내 앞범퍼와 다음 정지선 사이에 서 있다.
   *
   * 적색 우회전의 일시정지는 **정지선 직전**에서 하는 것이다(시행규칙 [별표 2] 적색의 등화
   * 제2호 "정지선, 횡단보도 및 교차로의 직전에서 정지한 후"). 앞차 뒤에 줄 서서 선 것은
   * 정지선 앞에 선 것이 아니므로, 앞차가 떠난 뒤 정지선에 닿으면 **한 번 더** 서야 한다.
   * 이 값이 참일 때 선 정지는 정지선 앞 일시정지로 치지 않는다. 앞차가 없으면 생략한다.
   */
  queuedBehind?: boolean;
  /**
   * 낮(오전 8시~오후 8시)인가.
   *
   * 어린이보호구역 가중이 이 시간대에만 붙는다 (시행령 제93조 제2항 · 시행규칙 [별표 28]
   * (주)4). 시나리오의 시간대에서 온다 — 낮·황혼은 참, 밤은 거짓.
   */
  isDaytime: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// 판정 상수
// ────────────────────────────────────────────────────────────────────────────

/** '정지'로 인정할 속도 상한 (km/h) */
export const STOP_SPEED_KMH = 0.5;

/** '일시정지'로 인정할 최소 정지 유지 시간 (초) */
export const STOP_HOLD_SECONDS = 0.5;

/** 정지선 앞 '적법한 정지 구역'의 길이 (m). 이보다 멀리서 선 것은 정지선 앞 정지로 보지 않는다. */
export const STOP_ZONE_DEPTH = 12;

/** 교차로 우회전 시 서행 상한 (km/h). 초과 시 서행의무 위반. */
export const SLOW_DOWN_LIMIT_KMH = 20;

/**
 * 우회전 궤적이 안쪽 코너에서 이 거리를 넘어가면 대회전으로 본다 (m).
 * 가장자리 차로(2차로)에 붙어 정상적으로 돌면 차로 폭의 0.6~0.9배,
 * 1차로로 밀려나면 **1.5배를 넘는다** — 그 사이를 가르는 값이다.
 *
 * **차로 폭에서 유도한다.** 예전에는 10.5m 로 박아 두었는데, 도로를 지금의 폭(2/3)으로
 * 줄이자 1차로까지 부풀려 돈 궤적도 그 아래로 들어와 **대회전이 아예 안 잡혔다**
 * (테스트가 잡았다). 반대로 도로를 넓히면 규정대로 돈 사람이 걸린다.
 */
export const WIDE_TURN_RADIUS = LANE_WIDTH * 1.54; // 7.0

/** 이 속도를 넘으면 '움직이는 중'으로 본다 (km/h) */
export const CREEPING_KMH = 1.5;

// ── 허용 오차 ───────────────────────────────────────────────────────────────
//
// 이 게임은 단속 시뮬레이터가 아니라 **안전 캠페인**이다.
// 판정이 실제 단속보다 정밀하면, 제대로 서고 제대로 기다린 사람이 0.1초 차이로 범칙금을
// 맞고 "이 게임 이상하다"며 떠난다. 배우게 하려면 **명백한 위반만** 잡아야 한다.
// 그래서 경계에 오차를 둔다. 오차는 아래 두 곳뿐이고, 나머지 판정은 그대로다.

/**
 * 보행자 횡단 방해를 **범칙금 위반으로 기록**하기까지의 판정 오차범위 (초).
 *
 * 0.4초에서 0.15초로 줄였다. 예전 값은 "다 지나갔다고 느끼는 순간과 실제로 끝나는 순간의
 * 차이"를 감안한 것이었는데, 그 폭이 너무 넓어 **사람이 아직 횡단보도 위에 있는데 출발한
 * 주행이 그대로 PERFECT 로 나왔다.** 이 게임이 03번에서 가르치겠다고 적어 둔 문장
 * ("일시정지는 잠깐 섰다가 아니라 보행자의 통행 종료 시까지 정지한다는 뜻") 과 정면으로
 * 어긋난다 — 화면에 "위반으로 잡지 않음" 이라고 적히는 것부터가 그렇다.
 *
 * 지금 남은 0.15초는 **판정이 한 프레임 차이로 갈리지 않게 하는 폭**일 뿐이다.
 * 그리고 오차범위로 넘어간 주행은 더 이상 PERFECT 가 아니다 (isPerfect 참조) —
 * 범칙금은 면하되 최고 등급(PERFECT)을 주지는 않는다.
 */
export const PEDESTRIAN_TOLERANCE_SECONDS = 0.15;

/**
 * 정지선을 이만큼 넘어서 선 것까지는 '정지선 앞 정지'로 인정한다 (m).
 *
 * 10cm 넘겼다고 정지선 침범으로 잡는 것은 실제 단속에도 없고, 캠페인에서 가르칠 내용도 아니다.
 *
 * **예전에는 정지선과 횡단보도 사이 간격(0.5m)에서 유도했다.** 그런데 정지선을 국내 기준인
 * 횡단보도 앞 2m 로 물리면서(layout.ts) 그 유도를 그대로 두면 **오차가 조용히 2m 로 늘어
 * 정지선을 2m 넘겨 세워도 통과**하게 된다. 그래서 값을 못 박는다 — 0.5m 는 정지선 배치를
 * 바꾸기 전과 같은 판정이다.
 */
export const STOP_LINE_TOLERANCE = 0.5;

// ────────────────────────────────────────────────────────────────────────────
// 결과 타입
// ────────────────────────────────────────────────────────────────────────────

export type Grade = 'PERFECT' | 'PASS' | 'VIOLATION' | 'FAIL';

/**
 * 등급 이름 — **결과 화면의 배지와 주행 기록이 함께 쓴다.**
 *
 * 한 곳에서만 정한다. 예전에는 화면(ui/Screens.ts)과 여기에 같은 표가 따로 있었는데,
 * 그러면 한쪽 이름만 바꿨을 때 결과 화면에는 크게 한 말이 떠 있고 기록에는 다른 말이
 * 적히게 된다. 판정 엔진은 Three.js·DOM 에 기대지 않는 순수 모듈이라 화면 쪽에서
 * 가져다 쓸 수 있다 (그 반대는 안 된다).
 *
 * (등급 값 자체는 영문 그대로 둔다 — 저장 데이터와 판정 코드가 쓰는 식별자다)
 *
 * **누구나 아는 말로 쓴다.** 한때 넷 다 `TURN` 으로 끝나는 한 벌(GRAND · OKAY · ILLEGAL
 * TURN, CRASHED)이었는데, 결과 화면에서 성공인지 실패인지가 한눈에 읽히지 않았다.
 *
 *   PERFECT ─ SUCCESS ─ VIOLATION ─ FAIL
 *
 * 마지막만 결이 다른 이유: 앞의 셋은 **돌기는 돌았고** 그 질이 갈린 것이지만,
 * FAIL 은 사람을 치거나 부딪히거나 도로를 벗어나 **애초에 끝내지 못한 것**이다.
 * 색도 VIOLATION 보다 진한 적색을 써서 그 둘을 갈라 둔다.
 */
export const GRADE_TEXT: Record<Grade, string> = {
  PERFECT: 'PERFECT',
  PASS: 'SUCCESS',
  VIOLATION: 'VIOLATION',
  FAIL: 'FAIL',
};

export type FailReason = 'PEDESTRIAN_HIT' | 'VEHICLE_COLLISION' | 'OFF_ROAD' | 'TIMEOUT';

export interface JudgeStats {
  /** 정지선 앞에서 완전정지했는가 */
  cleanStopBeforeA: boolean;
  /** 정지선을 넘어서 정지했는가 */
  lateStopBeforeA: boolean;
  /** 횡단보도 C 앞에서 완전정지했는가 */
  stopBeforeC: boolean;
  /** 교차로 내부 최고 속도 (km/h) */
  maxSpeedInIntersection: number;
  /** 우회전 궤적의 안쪽 코너 최대 이격 거리 (m) */
  turnRadius: number;
  /** 30m 전 지점에서 방향지시등이 켜져 있었는가 */
  signalAt30m: boolean;
  /** 교차로 진입 시점에 방향지시등이 켜져 있었는가 */
  signalAtEntry: boolean;
  /** 총 소요 시간 (초) */
  elapsed: number;
}

/**
 * 주행 기록 한 줄.
 *
 * "왜 이 판정이 나왔는가"를 사람이 읽을 수 있게 남긴다. 판정 결과만 보여주면
 * 억울한 사람은 억울한 채로 떠난다 — 무엇이 언제 어떤 값으로 걸렸는지 보여줘야
 * 다음에 무엇을 다르게 할지 알 수 있다.
 */
export interface RunEvent {
  /** 주행 시작으로부터의 시각 (초) */
  t: number;
  /** ok = 잘한 것, info = 사실 기록, warn = 아슬아슬하게 봐준 것, bad = 위반 */
  level: 'ok' | 'info' | 'warn' | 'bad';
  text: string;
}

/** 결과 지도에 그릴 궤적 한 점 */
export interface Crumb {
  t: number;
  x: number;
  z: number;
}

/** 보행자 한 명의 궤적 */
export interface PedestrianTrack {
  crosswalk: CrosswalkId;
  points: Crumb[];
}

export interface JudgeResult {
  grade: Grade;
  violations: ViolationEvent[];
  /** 우회전을 끝까지 완료했는가 */
  completed: boolean;
  failReason: FailReason | null;
  stats: JudgeStats;
  /** 시간순 주행 기록 */
  log: RunEvent[];
  /** 내 차 궤적 — 디브리핑 지도에 그린다 */
  path: Crumb[];
  /** 보행자 궤적 — 누가 어디로 지나갔는지 함께 보여야 판정을 되짚을 수 있다 */
  pedestrianPaths: PedestrianTrack[];
  /**
   * 앞차가 있던 판의 앞차 기록 (game/leadDrive.ts). 없던 판은 생략.
   *
   * **판정 엔진이 채우지 않는다** — 판정은 내 차만 본다. 게임이 판이 끝날 때 붙인다
   * (Game.end). 결과 화면 · AI 코치 · 습관 기록이 "앞차가 서지 않았을 때 따라갔는가" 를
   * 읽는 자리다.
   */
  lead?: LeadReport;
}

export interface LeadReport {
  behavior: 'lawful' | 'rolling';
  /** 앞차가 **서지 않고 지나간** 일시정지 자리 — 나쁜 본보기가 실제로 나왔는가 */
  skippedStops: CrosswalkId[];
  /** 내 앞범퍼와 앞차 뒷범퍼가 가장 가까웠던 간격 (m). 한 번도 재지 못했으면 -1 */
  minGap: number;
}

/**
 * 지금 차가 어디에 있는가 — 위반 카드와 주행 기록에 붙는 위치 이름.
 * 좌표(x, z)를 그대로 보여 줘 봐야 아무 의미가 없다. "정지선 앞 3m" 라야 되짚을 수 있다.
 */
function placeLabel(s: WorldSample): string {
  const { frontX: x, frontZ: z } = s;
  if (z > STOP_LINE) return `접근로 · 정지선 ${(z - STOP_LINE).toFixed(0)}m 앞`;
  if (z > CROSSWALK_OUTER) return '정지선 위';
  if (z > CROSSWALK_INNER) return '횡단보도 A 위';
  if (z > INTERSECTION_HALF) return '횡단보도 A ~ 교차로 사이';
  /*
    **교차로를 어느 쪽으로 빠져나갔는지는 좌표가 말해 준다.** 직진이면 x 가 진입 차로에 머문 채
    z 만 줄고, 우회전이면 x 가 자란다. 코스를 따로 받지 않아도 갈리므로 여기서는 좌표만 본다.
  */
  if (z < -INTERSECTION_HALF) {
    if (z > CROSSWALK_B_INNER) return '교차로 ~ 건너편 횡단보도 사이';
    if (z >= CROSSWALK_B_OUTER) return '건너편 횡단보도(B) 위';
    return '보호구역 진출로';
  }
  if (x < CROSSWALK_INNER) return '교차로 안';
  if (x <= CROSSWALK_OUTER) return '우회전 후 횡단보도(C) 위';
  return '우회전 진출로';
}

/**
 * **사거리 없는 보호구역 도로의 횡단보도 셋** (drive: 'zoneOnly') — 만나는 차례대로.
 *
 * 자리는 교차로 맵과 **같은 좌표**를 쓴다 (진입로 70 · 가운데 16.8 · 끝 -16.8). 좌표를 새로 잡지 않는
 * 이유는 보행자 · 차 · 검증기가 모두 이 값으로 움직이기 때문이다 — 길만 바뀌고 자리는 그대로다.
 *
 *  - `near` — 내가 **먼저 닿는** 가장자리 (z 가 줄어드는 방향으로 달린다)
 *  - `far` — 다 지난 가장자리
 *  - `stopLine` — 그 앞 정지선 (횡단보도에서 2m 앞)
 */
/** 이 코스가 지나는 횡단보도 — C(우회전 후)는 사거리가 없으니 없다 */
type ZoneRoadCrosswalk = 'S' | 'A' | 'B';
const ZONE_ROAD_ORDER: readonly ZoneRoadCrosswalk[] = ['S', 'A', 'B'];
/**
 * 전용 도로 횡단보도의 가장자리와 정지선.
 *
 * **밖으로 내보낸다** — 화면 쪽(game/Game.ts 의 정지 안내 · 노면 띠)도 같은 표를 봐야 한다.
 * 따로 적어 두었더니 판정은 세 곳을 보는데 화면은 사거리 기준 한 곳만 보고 있었다.
 */
export const ZONE_ROAD_EDGES: Record<ZoneRoadCrosswalk, { near: number; far: number; stopLine: number }> = {
  S: { near: CROSSWALK_S_OUTER, far: CROSSWALK_S_INNER, stopLine: STOP_LINE_S },
  A: { near: CROSSWALK_OUTER, far: CROSSWALK_INNER, stopLine: STOP_LINE },
  B: { near: CROSSWALK_B_INNER, far: CROSSWALK_B_OUTER, stopLine: CROSSWALK_B_INNER + 2 },
};
const ZONE_ROAD_NAME: Record<ZoneRoadCrosswalk, string> = {
  S: '첫 번째 횡단보도',
  A: '두 번째 횡단보도',
  B: '세 번째 횡단보도',
};

/** 주행 기록에 쓰는 사람이 읽는 표기 */
const LIGHT_TEXT: Record<LightColor, string> = {
  green: '녹색',
  yellow: '황색',
  red: '적색',
  redFlash: '적색점멸',
};

const PED_SIGNAL_TEXT: Record<PedSignal, string> = {
  green: '녹색',
  greenFlash: '녹색점멸',
  red: '적색',
};

const FAIL_TEXT: Record<FailReason, string> = {
  PEDESTRIAN_HIT: '보행자와 충돌',
  VEHICLE_COLLISION: '차량과 충돌',
  OFF_ROAD: '도로 이탈',
  TIMEOUT: '시간 초과',
};

// ────────────────────────────────────────────────────────────────────────────
// 판정기
// ────────────────────────────────────────────────────────────────────────────

export class RightTurnJudge {
  /**
   * @param stopZoneDepth 정지선 앞 몇 m 안에서 서야 "정지선 앞 정지" 인가 (기본 STOP_ZONE_DEPTH).
   *   난이도가 오르면 좁힌다 (scenarios/challenge.ts 의 stopZone) — 무엇이 위반인지는 그대로이고,
   *   **정지선 직전**이라는 자리를 얼마나 엄격하게 읽는가만 바뀐다.
   */
  /**
   * @param drive 이 판을 어떻게 빠져나가는가 (기본 우회전). 직진이면 **우회전에만 있는 의무**
   *   (대회전 · 방향지시등 · 우회전 후 횡단보도 C)를 묻지 않고, 건너편 횡단보도 B 를 본다.
   */
  constructor(
    private readonly stopZoneDepth: number = STOP_ZONE_DEPTH,
    private readonly drive: DriveMode = 'rightTurn',
  ) {}

  private violations: ViolationEvent[] = [];
  private seen = new Set<ViolationCode>();

  /** 현재 연속 정지 유지 시간 */
  private stopTimer = 0;

  /** 횡단보도별로 '보행자를 방해한 채 움직인' 시간. PEDESTRIAN_TOLERANCE_SECONDS 를 넘으면 확정한다. */
  private pedConflictTimer: Record<CrosswalkId, number> = { A: 0, B: 0, C: 0, S: 0 };

  /** 진입부 보호구역 횡단보도(S) 앞에서 완전히 섰는가 */
  private stoppedBeforeS = false;
  /** "앞차 뒤에서 정지 — 인정 안 함" 을 한 번만 적는다 */
  private queuedNoted = false;
  /** 정지 구역보다 멀리서 선 것을 한 번만 적는다 (trackStopTimer) */
  private farStopNoted = false;
  /** 정지선을 지나는 순간의 신호 — 교차로 진입 판정이 이것으로 본다 (trackIntersection) */
  private lightsAtLine: Pick<WorldSample, 'vehicleLight' | 'rightArrow'> | null = null;
  private enteredCrosswalkS = false;

  /** 교차로 건너편 횡단보도(B) 앞에서 섰는가 — 직진 코스에서만 쓴다 */
  private stopBeforeB = false;
  private enteredCrosswalkB = false;

  /** 사거리 없는 보호구역 도로의 횡단보도별 상태 (drive: 'zoneOnly') */
  private zoneStopped: Record<CrosswalkId, boolean> = { S: false, A: false, B: false, C: false };
  private zoneEntered: Record<CrosswalkId, boolean> = { S: false, A: false, B: false, C: false };

  private cleanStopBeforeA = false;
  private lateStopBeforeA = false;
  private stopBeforeC = false;

  private maxSpeedInIntersection = 0;
  private turnRadius = 0;
  private signalAt30m = false;
  private signalAtEntry = false;

  /** 경계선 통과를 한 번만 처리하기 위한 래치 */
  private passedSignalGate = false;
  private enteredCrosswalkA = false;
  private enteredIntersection = false;
  private enteredCrosswalkC = false;
  private completed = false;

  private failReason: FailReason | null = null;
  private lastSample: WorldSample | null = null;
  private elapsed = 0;

  /** 시간순 주행 기록 */
  private events: RunEvent[] = [];

  /** 주행 궤적 (탑다운 지도용). 0.12초 간격이면 지도에 그리기 충분하다. */
  private path: Crumb[] = [];
  /** 보행자별 궤적. 같은 간격으로 찍어 두면 시각을 맞춰 "그때 저 사람은 여기 있었다"를 그릴 수 있다. */
  private pedPaths = new Map<number, PedestrianTrack>();
  private lastCrumbAt = -1;

  /** 기록 한 줄 남기기 */
  private note(t: number, level: RunEvent['level'], text: string): void {
    this.events.push({ t, level, text });
  }

  /** 프레임마다 호출. dt는 초 단위. */
  update(s: WorldSample, dt: number): void {
    if (this.failReason) return;
    this.lastSample = s;
    this.elapsed = s.t;

    if (this.lastCrumbAt < 0 || s.t - this.lastCrumbAt >= 0.12) {
      this.lastCrumbAt = s.t;
      this.path.push({ t: s.t, x: s.centerX, z: s.centerZ });
      for (const p of s.pedestrians) {
        if (p.id === undefined || p.x === undefined || p.z === undefined || !p.active) continue;
        let track = this.pedPaths.get(p.id);
        if (!track) {
          track = { crosswalk: p.crosswalk, points: [] };
          this.pedPaths.set(p.id, track);
        }
        track.points.push({ t: s.t, x: p.x, z: p.z });
      }
    }

    /*
      **사거리가 없는 보호구역 도로는 교차로 규칙을 하나도 묻지 않는다** (drive: 'zoneOnly').
      정지선 · 교차로 진입 · 우회전 후 횡단보도 같은 것이 아예 없는 길이라, 그 추적을 돌리면
      있지도 않은 자리에서 판정이 난다. 지나는 횡단보도 셋만 본다.
    */
    if (this.drive === 'zoneOnly') {
      this.updateStopTimer(s, dt);
      this.trackZoneRoad(s, dt);
      return;
    }

    this.trackStopTimer(s, dt);
    this.trackSchoolZoneCrossing(s, dt);
    this.trackTurnSignal(s);
    this.trackCrosswalkA(s, dt);
    this.trackIntersection(s);
    /*
      **코스에 따라 교차로 다음 횡단보도가 다르다** — 우회전이면 C(동쪽), 직진이면 B(북쪽).
      둘 다 보지 않는 이유는 지나지도 않은 횡단보도의 보행자를 방해했다고 적을 수 있어서다.
    */
    if (this.drive === 'straight') this.trackCrosswalkB(s, dt);
    else this.trackCrosswalkC(s, dt);
  }

  /** 충돌 등으로 시나리오가 즉시 실패한 경우 */
  fail(reason: FailReason): void {
    if (this.failReason) return;
    this.failReason = reason;
    this.note(this.elapsed, 'bad', `주행 실패: ${FAIL_TEXT[reason]}`);
  }

  /** 코스를 완주했을 때 호출 — 우회전으로 빠져나갔거나, 직진으로 보호구역을 통과했거나 */
  markCompleted(): void {
    if (!this.completed) {
      this.note(this.elapsed, 'ok', this.drive === 'rightTurn' ? '우회전 완료' : '보호구역 통과 완료');
    }
    this.completed = true;
  }

  /**
   * 진행 중 상태. HUD의 안내 표시가 "이미 의무를 이행했는지"를 판정과 같은 기준으로
   * 판단하도록 노출한다. 안내가 자체 타이머를 따로 쓰면 판정과 어긋나 교착이 생긴다.
   */
  get progress(): {
    stoppedBeforeA: boolean;
    stoppedBeforeC: boolean;
    /** 진입부 보호구역 횡단보도(S) 앞에서 일시정지했는가 */
    stoppedBeforeS: boolean;
    enteredIntersection: boolean;
    enteredCrosswalkA: boolean;
    enteredCrosswalkC: boolean;
    enteredCrosswalkS: boolean;
    /** 사거리 없는 보호구역 도로 — 횡단보도별로 앞에서 일시정지했는가 · 들어섰는가 */
    zoneStopped: Record<CrosswalkId, boolean>;
    zoneEntered: Record<CrosswalkId, boolean>;
  } {
    return {
      stoppedBeforeA: this.stoppedBeforeA(),
      stoppedBeforeC: this.stopBeforeC,
      stoppedBeforeS: this.stoppedBeforeS,
      enteredIntersection: this.enteredIntersection,
      enteredCrosswalkA: this.enteredCrosswalkA,
      enteredCrosswalkC: this.enteredCrosswalkC,
      enteredCrosswalkS: this.enteredCrosswalkS,
      zoneStopped: this.zoneStopped,
      zoneEntered: this.zoneEntered,
    };
  }

  finish(): JudgeResult {
    // 교차로를 통과한 뒤에야 판정할 수 있는 항목들
    if (this.enteredIntersection) {
      /*
        **서행 의무는 '회전할 때' 의 것이다** (제25조 — 교차로 통행방법). 직진으로 지나는 차에는
        그 의무가 없다. 보호구역의 30km/h 제한은 구간 전체에 걸리는 다른 규정이고, 그쪽은 차가
        구간에 들어서며 자동으로 조인다 (game/Vehicle.ts 의 zoneTargetKmh).

        가르지 않았더니 **규정대로 30km/h 로 직진한 주행이 서행의무 위반**으로 잡혔다.
      */
      if (this.drive === 'rightTurn' && this.maxSpeedInIntersection > SLOW_DOWN_LIMIT_KMH) {
        this.record(
          'NO_SLOW_DOWN',
          this.lastSample,
          `교차로 내 최고 ${this.maxSpeedInIntersection.toFixed(0)}km/h (기준 ${SLOW_DOWN_LIMIT_KMH}km/h)`,
        );
      }
      /*
        **대회전과 방향지시등은 우회전에만 있는 의무다.**

        직진으로 통과하면 안쪽 코너(INNER_CORNER)에서 10m 넘게 떨어져 지나므로 기준(7m)을 그대로 대면
        **규정대로 몬 주행이 전부 대회전 위반**이 된다. 지시등도 마찬가지다 — 직진에 우측 지시등을 켜면
        오히려 틀린 신호다. 이 게임이 가장 피해야 할 것이 "규정대로 했는데 위반" 이라, 모드로 가른다.
      */
      if (this.drive === 'rightTurn' && this.turnRadius > WIDE_TURN_RADIUS) {
        this.record(
          'WIDE_TURN',
          this.lastSample,
          `안쪽 코너에서 최대 ${this.turnRadius.toFixed(1)}m 벌어짐 (기준 ${WIDE_TURN_RADIUS}m)`,
        );
      }
      if (this.drive === 'rightTurn' && (!this.signalAt30m || !this.signalAtEntry)) {
        this.record(
          'NO_TURN_SIGNAL',
          this.lastSample,
          !this.signalAt30m ? '30m 전 지점에서 꺼져 있었음' : '교차로 진입 시점에 꺼져 있었음',
        );
      }
    }

    const stats: JudgeStats = {
      cleanStopBeforeA: this.cleanStopBeforeA,
      lateStopBeforeA: this.lateStopBeforeA,
      stopBeforeC: this.stopBeforeC,
      maxSpeedInIntersection: this.maxSpeedInIntersection,
      turnRadius: this.turnRadius,
      signalAt30m: this.signalAt30m,
      signalAtEntry: this.signalAtEntry,
      elapsed: this.elapsed,
    };

    let grade: Grade;
    if (this.failReason) {
      grade = 'FAIL';
    } else if (this.violations.length > 0) {
      grade = 'VIOLATION';
    } else if (!this.completed) {
      grade = 'FAIL';
    } else if (this.isPerfect(stats)) {
      grade = 'PERFECT';
    } else {
      grade = 'PASS';
    }

    this.note(
      this.elapsed,
      grade === 'VIOLATION' || grade === 'FAIL' ? 'bad' : 'ok',
      `판정 ${GRADE_TEXT[grade]}`,
    );

    return {
      grade,
      violations: [...this.violations],
      completed: this.completed,
      failReason: this.failReason,
      stats,
      log: [...this.events].sort((a, b) => a.t - b.t),
      path: [...this.path],
      // 스쳐 지나간 정도(2점 이하)는 선으로 그릴 것이 없다
      pedestrianPaths: [...this.pedPaths.values()].filter((t) => t.points.length > 2),
    };
  }

  /**
   * 보행자의 통행이 끝나기 전에 움직인 적이 있는가 (오차범위 안이라 위반으로는 잡지 않은 경우).
   * 범칙금과 등급은 다른 문제다 — 아래 isPerfect 에서 PERFECT 만 막는다.
   */
  private pedToleranceUsed = false;

  /** 위반이 없고 감점 요소도 없으며 서행·지시등까지 지킨 경우만 PERFECT */
  private isPerfect(stats: JudgeStats): boolean {
    // 사람이 아직 횡단보도 위에 있는데 출발했다면 최고 등급은 아니다
    if (this.pedToleranceUsed) return false;
    if (stats.lateStopBeforeA && !stats.cleanStopBeforeA) return false;
    if (this.drive === 'rightTurn' && stats.maxSpeedInIntersection > SLOW_DOWN_LIMIT_KMH) return false;
    // 방향지시등은 우회전에만 있는 의무다 — 직진 코스에서는 묻지 않는다 (trackTurnSignal)
    if (this.drive === 'rightTurn' && (!stats.signalAt30m || !stats.signalAtEntry)) return false;
    return true;
  }

  // ── 세부 추적 ────────────────────────────────────────────────────────────

  /** 완전히 선 시간을 센다 — 두 코스가 함께 쓴다 (교차로 코스의 trackStopTimer · 보호구역 도로의 trackZoneRoad) */
  private updateStopTimer(s: WorldSample, dt: number): void {
    if (s.speedKmh > STOP_SPEED_KMH) this.stopTimer = 0;
    else this.stopTimer += dt;
  }

  private trackStopTimer(s: WorldSample, dt: number): void {
    if (s.speedKmh > STOP_SPEED_KMH) {
      this.stopTimer = 0;
      return;
    }
    this.stopTimer += dt;
    if (this.stopTimer < STOP_HOLD_SECONDS) return;

    // 어디에서 멈췄는지에 따라 '정지선 앞 정지' / '정지선 넘어 정지'를 구분한다.
    // 정지선을 조금 넘었어도 횡단보도를 밟지 않았으면 인정한다 (STOP_LINE_TOLERANCE).
    const cleanLimit = STOP_LINE - STOP_LINE_TOLERANCE;
    if (!this.enteredIntersection) {
      /*
        **앞차 뒤에 줄 서서 선 것은 치지 않는다** (WorldSample.queuedBehind). 정지 구역(정지선 앞
        12m) 안이라도 내 앞에 앞차가 있으면 정지선 직전에 선 것이 아니다 — 앞차가 떠난 뒤
        정지선에서 다시 서야 한다. 처음에는 이것을 가르지 않아, 앞차 뒤에서 한 번 서고 그대로
        정지선을 지나도 "통과" 가 나왔다.
      */
      if (s.queuedBehind && s.frontZ > cleanLimit && s.frontZ <= STOP_LINE + this.stopZoneDepth) {
        if (!this.cleanStopBeforeA && !this.queuedNoted) {
          this.queuedNoted = true;
          this.note(
            s.t,
            'info',
            `앞차 뒤에서 정지 — 정지선까지 ${(s.frontZ - STOP_LINE).toFixed(1)}m. 정지선 앞 일시정지로 보지 않음 (앞차가 떠나면 정지선에서 다시 서야 함)`,
          );
        }
        return;
      }
      if (s.frontZ >= cleanLimit && s.frontZ <= STOP_LINE + this.stopZoneDepth) {
        if (!this.cleanStopBeforeA) {
          const over = STOP_LINE - s.frontZ;
          this.note(
            s.t,
            'ok',
            over > 0.02
              ? `정지선 앞 일시정지 인정 — 정지선을 ${over.toFixed(2)}m 넘었지만 허용 오차(${STOP_LINE_TOLERANCE.toFixed(1)}m) 안`
              : `정지선 앞 일시정지 인정 — 정지선까지 ${(-over).toFixed(2)}m`,
          );
        }
        this.cleanStopBeforeA = true;
      } else if (s.frontZ >= CROSSWALK_INNER && s.frontZ < cleanLimit) {
        if (!this.lateStopBeforeA) {
          this.note(
            s.t,
            'warn',
            `횡단보도 위에서 정지 — 정지선을 ${(STOP_LINE - s.frontZ).toFixed(2)}m 넘었다`,
          );
        }
        this.lateStopBeforeA = true;
      } else if (
        !this.cleanStopBeforeA &&
        !this.farStopNoted &&
        s.frontZ <= STOP_LINE + this.stopZoneDepth + STOP_ZONE_DEPTH
      ) {
        /*
          **너무 멀리서 선 것을 말해 준다.** 난이도가 오르면 정지 구역이 좁아져(challenge.ts 의 stopZone) 예전처럼
          한참 전에 서도 되던 자리가 인정되지 않는다. 말없이 넘기면 결과 화면에 "정면 적색 일시정지 안 함" 만 남아,
          분명히 섰는데 왜 틀렸는지 알 수 없다.
        */
        this.farStopNoted = true;
        this.note(
          s.t,
          'info',
          `정지선 ${(s.frontZ - STOP_LINE).toFixed(1)}m 앞에서 정지 — 너무 멀어 정지선 앞 일시정지로 치지 않음 (정지선 ${this.stopZoneDepth}m 안이어야 함)`,
        );
      }
    } else if (this.drive === 'straight') {
      /*
        **직진 코스에서 교차로를 지난 뒤의 정지는 건너편 횡단보도(B) 앞 정지다.**

        우회전 코스의 C 와 같은 자리다 — 교차로를 빠져나가며 만나는 횡단보도이고, 보호구역에
        신호기가 없으면 사람이 없어도 여기서 서야 한다. 앞차 뒤에 줄 서서 선 것은 치지 않는 것도 같다.
      */
      if (!this.enteredCrosswalkB && s.frontZ >= CROSSWALK_B_INNER) {
        if (s.queuedBehind) return;
        if (!this.stopBeforeB) {
          this.note(
            s.t,
            'ok',
            `건너편 횡단보도 앞 일시정지 인정 — 횡단보도까지 ${(s.frontZ - CROSSWALK_B_INNER).toFixed(2)}m`,
          );
        }
        this.stopBeforeB = true;
      }
    } else if (!this.enteredCrosswalkC && s.frontX <= CROSSWALK_INNER) {
      /*
        교차로 안, 횡단보도 C 직전에서의 정지. **앞차 뒤에 줄 서서 선 것은 치지 않는다** — 정지선(A)과 같은 규칙이다.
        예전에는 C 만 이것을 가르지 않아, 보호구역 신호기 없는 횡단보도 앞에서 앞차가 서면 그 뒤에 선 것만으로
        일시정지가 인정되어, 앞차를 따라 그대로 지나가도 위반이 아니었다 (플레이테스트가 잡았다).
      */
      if (s.queuedBehind) return;
      if (!this.stopBeforeC) {
        this.note(
          s.t,
          'ok',
          `우회전 후 횡단보도 앞 일시정지 인정 — 횡단보도까지 ${(CROSSWALK_INNER - s.frontX).toFixed(2)}m`,
        );
      }
      this.stopBeforeC = true;
    }
  }

  private trackTurnSignal(s: WorldSample): void {
    /*
      **직진 코스에서는 방향지시등을 묻지 않는다** — 돌지 않으므로 켤 의무가 없고, 오히려 켜면 틀린 신호다.
      기록조차 남기지 않는다: 주행 기록에 "지시등 켜짐/꺼짐" 이 적히면 그것이 의무인 줄 읽힌다.
    */
    if (this.drive === 'straight') return;
    // 교차로 가장자리 30m 전 지점을 통과하는 순간의 지시등 상태를 기록
    if (!this.passedSignalGate && s.frontZ <= TURN_SIGNAL_GATE_Z) {
      this.passedSignalGate = true;
      this.signalAt30m = s.rightSignalOn;
      this.note(
        s.t,
        s.rightSignalOn ? 'ok' : 'bad',
        `교차로 30m 전 통과 — 우측 방향지시등 ${s.rightSignalOn ? '켜짐' : '꺼짐'}`,
      );
    }
  }

  /**
   * 횡단보도 A (교차로 진입 전, 내가 가로지르는 횡단보도).
   *
   * 보행자 방해 판정은 "미리 멈췄는지"가 아니라 "보행자가 있는데도 밀고 들어갔는지"로 한다.
   * 정지선에서 한 번 섰더라도 보행자가 아직 건너는 중인데 출발하면 그것은 여전히 횡단 방해다.
   * 반대로 횡단보도 앞에 서서 기다리는 동안에는 절대 위반으로 잡히지 않는다.
   */
  private trackCrosswalkA(s: WorldSample, dt: number): void {
    /*
      **보행자 방해는 정지선부터 본다.** 제27조 제1항은 "횡단보도 앞(정지선이 설치되어 있는 곳에서는
      그 정지선)에서 일시정지" 다 — 서야 할 자리가 정지선이므로, 보행자가 아직 건너는데 **정지선을
      넘어 출발한 것**이 곧 방해다. 예전에는 차 앞이 횡단보도 줄무늬에 닿은 뒤에만 봐서, 정지선에서
      서 있다가 사람이 다 건너기 전에 출발해도 줄무늬에 닿기 직전에 사람이 끝을 밟으면 잡히지 않았다.
    */
    const withinBand = s.frontZ <= STOP_LINE && s.frontZ >= CROSSWALK_INNER;
    const pastNearEdge = s.frontZ <= CROSSWALK_OUTER;

    if (!this.enteredCrosswalkA && pastNearEdge) {
      this.enteredCrosswalkA = true;
      this.note(
        s.t,
        'info',
        `횡단보도 A 진입 — ${s.speedKmh.toFixed(0)}km/h · 정면신호 ${LIGHT_TEXT[s.vehicleLight]}` +
          ` · ${this.describePedestrians(this.conflictingPedestrians(s, 'A'))}`,
      );
      // 제27조 제7항 — 어린이보호구역 내 신호기 없는 횡단보도는 보행자 유무와 무관하게 일시정지
      if (s.isSchoolZone && s.pedSignal.A === null && !this.stoppedBeforeA()) {
        this.record('SCHOOL_ZONE_NO_STOP', s, '어린이보호구역 · 신호기 없는 횡단보도 A 앞 무정지');
      }
    }

    // 제27조 제1항 — 보행자가 통행 중이거나 통행하려는데 움직여서 지나감
    this.trackPedestrianConflict(s, dt, 'A', withinBand);
  }

  /**
   * 보행자 방해 판정. 판정 오차범위(PEDESTRIAN_TOLERANCE_SECONDS) 이상 이어져야 확정한다.
   * 멈추면 타이머가 즉시 풀리므로, 보행자를 보고 다시 서는 사람은 절대 걸리지 않는다.
   */
  private trackPedestrianConflict(
    s: WorldSample,
    dt: number,
    id: CrosswalkId,
    withinBand: boolean,
  ): void {
    const blocking =
      withinBand && s.speedKmh > CREEPING_KMH && this.hasConflictingPedestrian(s, id);
    if (!blocking) {
      // 오차범위 안에서 끝난 경우 — 위반으로는 잡지 않되, 무엇을 잘못했는지는 남긴다
      const held = this.pedConflictTimer[id];
      if (held > 0 && !this.seen.has('PEDESTRIAN_BLOCKED')) {
        // 범칙금은 면하지만 규정을 온전히 지킨 주행은 아니다 — 등급에 반영한다 (isPerfect)
        this.pedToleranceUsed = true;
        this.note(
          s.t,
          'warn',
          `횡단보도 ${id}: 보행자의 통행이 끝나기 전에 ${held.toFixed(2)}초 진행 — ` +
            `범칙금은 면했지만 통행이 끝날 때까지 기다려야 합니다`,
        );
      }
      this.pedConflictTimer[id] = 0;
      return;
    }
    this.pedConflictTimer[id] += dt;
    if (this.pedConflictTimer[id] >= PEDESTRIAN_TOLERANCE_SECONDS) {
      const blocked = this.conflictingPedestrians(s, id);
      /*
        **타고 건너는 자전거는 보행자가 아니다.**

        끌고 건너는 사람은 보행자이므로(제2조 제17호) 여기서는 보행자 그대로 적는다. 타고 건너는
        사람은 제27조 제1항의 대상이 아니라 **조문이 달라진다** — 자전거횡단도면 제15조의2 제3항의
        일시정지 의무이고, 아니면 안전운전의무(제48조)다. 운전자가 그 자리에서 해야 할 일은 같지만
        (선다), 무엇을 어겼는지를 틀리게 적으면 배우는 것도 틀어진다.

        한 횡단보도에 사람과 탄 자전거가 함께 있으면 **보행자 쪽을 적는다** — 둘 다 어겼고,
        제27조 제1항이 더 무겁다 (이 게임의 조합 규칙상 실제로 겹치지는 않는다).
      */
      const onlyRiders = blocked.length > 0 && blocked.every((p) => p.bike === 'ride');
      const where = onlyRiders && s.bikeLane === id ? '자전거횡단도' : `횡단보도 ${id}`;
      this.record(
        onlyRiders ? 'BIKE_BLOCKED' : 'PEDESTRIAN_BLOCKED',
        s,
        `${where}${onlyRiders && s.bikeLane !== id ? ` ${id}` : ''} · ${this.describePedestrians(blocked)}` +
          ` 앞을 ${this.pedConflictTimer[id].toFixed(1)}초간 ${s.speedKmh.toFixed(0)}km/h 로 진행` +
          (onlyRiders
            ? s.bikeLane === id
              ? ' — 자전거횡단도를 통행 중인 자전거 (제15조의2 제3항)'
              : ' — 자전거횡단도가 아닌 곳을 타고 건너는 자전거 (보행자는 아니지만 안전운전의무, 제48조)'
            : ''),
      );
    }
  }

  /**
   * **진입부 어린이보호구역의 횡단보도(S).**
   *
   * 교차로에 닿기 전, 오는 길에 있다. 여기서 묻는 것은 하나뿐이다 —
   * **신호가 있으면 신호를 지켰는가, 없으면 섰는가.**
   *
   * ## 없을 때가 어려운 자리다
   *
   * 신호기가 있으면 적색에 서는 것은 누구나 안다. 신호기가 **없는** 횡단보도가
   * 이 게임이 교정하려는 오해의 자리다 — "아이가 안 보이면 그냥 간다".
   * 제27조 제7항은 **보행자 유무와 무관하게** 일시정지를 요구한다.
   *
   * ## 적색을 교차로와 다르게 다룬다
   *
   * 교차로의 적색은 "서고 나서 우회전" 이지만, 단일 횡단보도의 적색은 **서서 기다리는
   * 것**이다. 서고 나서 가도 위반이라, 코드를 갈라 둔다 (violations.ts 의 SCHOOL_ZONE_RED).
   */
  private trackSchoolZoneCrossing(s: WorldSample, dt: number): void {
    if (!s.approachZone) return;

    /*
      정지선 앞 정지 구역에서 완전히 선 적이 있는가. 교차로 정지선과 같은 규칙이다 —
      너무 멀리서 선 것은 이 횡단보도 앞에 선 것으로 보지 않는다(STOP_ZONE_DEPTH).
    */
    if (
      !this.stoppedBeforeS &&
      // 앞차 뒤에 줄 서서 선 것은 이 횡단보도 앞에 선 것이 아니다 (WorldSample.queuedBehind)
      !s.queuedBehind &&
      s.frontZ >= CROSSWALK_S_OUTER &&
      s.frontZ <= STOP_LINE_S + this.stopZoneDepth &&
      this.stopTimer >= STOP_HOLD_SECONDS
    ) {
      this.stoppedBeforeS = true;
    }

    const withinBand = s.frontZ <= CROSSWALK_S_OUTER && s.frontZ >= CROSSWALK_S_INNER;

    if (!this.enteredCrosswalkS && s.frontZ <= CROSSWALK_S_OUTER) {
      this.enteredCrosswalkS = true;
      const light = s.approachZone.light;
      this.note(
        s.t,
        'info',
        `어린이보호구역 횡단보도 진입 — ${s.speedKmh.toFixed(0)}km/h · ` +
          (light === null ? '신호기 없음' : `차량신호 ${LIGHT_TEXT[light]}`) +
          ` · 일시정지 ${this.stoppedBeforeS ? '함' : '안 함'}` +
          ` · ${this.describePedestrians(this.conflictingPedestrians(s, 'S'))}`,
      );

      if (light === null) {
        // 제27조 제7항 — 신호기 없는 횡단보도는 보행자가 없어도 일시정지
        if (!this.stoppedBeforeS) {
          this.record('SCHOOL_ZONE_NO_STOP', s, '어린이보호구역 · 신호기 없는 횡단보도 앞 무정지');
        }
      } else if (light !== 'green') {
        /*
          **황색도 함께 잡는다.** 여기서 황색은 "곧 적색" 이고 뒤에 교차로가 없어
          빠져나갈 곳도 없다 — 정지선 앞에서 설 수 있으면 서야 한다(제5조 · [별표 2]).
          이미 선 뒤라면 걸지 않는다: 서서 기다리는 중인 차를 위반으로 볼 수 없다.
        */
        if (!this.stoppedBeforeS) {
          this.record('SCHOOL_ZONE_RED', s, `어린이보호구역 횡단보도 ${LIGHT_TEXT[light]} 통과`);
        }
      }
    }

    // 제27조 제1항 — 보행자 방해는 신호기 유무와 상관없이 걸린다
    this.trackPedestrianConflict(s, dt, 'S', withinBand);
  }

  /**
   * **사거리 없는 어린이보호구역 도로** (drive: 'zoneOnly').
   *
   * 지나는 횡단보도 셋(진입로 S · 중간 A · 끝 B)을 **모두 보호구역 횡단보도로** 본다 —
   * 신호기가 없으면 보행자가 없어도 일시정지(제27조 제7항), 있으면 적색에 서서 기다린다.
   * 교차로가 없으므로 정지선 · 진입 · 우회전 관련 판정은 하나도 하지 않는다.
   *
   * 한 도로에 신호기가 **있는 곳과 없는 곳이 섞인다** — 그 둘을 갈라 판단하는 것이 이 코스가
   * 가르치려는 것이다 (사용자가 정했다).
   */
  private trackZoneRoad(s: WorldSample, dt: number): void {
    for (const id of ZONE_ROAD_ORDER) {
      const { near, far, stopLine } = ZONE_ROAD_EDGES[id];
      /*
        **그 횡단보도 앞에서 완전히 섰는가.** 정지선 앞 정지 구역 안이어야 하고(난이도가 정한
        stopZoneDepth), **앞차 뒤에 줄 서서 선 것은 치지 않는다** — 교차로 정지선과 같은 규칙이다.
      */
      if (
        !this.zoneEntered[id] &&
        !s.queuedBehind &&
        this.stopTimer >= STOP_HOLD_SECONDS &&
        s.frontZ >= near &&
        s.frontZ <= stopLine + this.stopZoneDepth
      ) {
        if (!this.zoneStopped[id]) {
          this.note(s.t, 'ok', `${ZONE_ROAD_NAME[id]} 앞 일시정지 인정 — 횡단보도까지 ${(s.frontZ - near).toFixed(2)}m`);
        }
        this.zoneStopped[id] = true;
      }

      if (!this.zoneEntered[id] && s.frontZ <= near) {
        this.zoneEntered[id] = true;
        const light = s.zoneLights?.[id] ?? null;
        this.note(
          s.t,
          'info',
          `${ZONE_ROAD_NAME[id]} 진입 — ${s.speedKmh.toFixed(0)}km/h · ` +
            (light === null ? '신호기 없음' : `차량신호 ${LIGHT_TEXT[light]}`) +
            ` · 일시정지 ${this.zoneStopped[id] ? '함' : '안 함'}` +
            ` · ${this.describePedestrians(this.conflictingPedestrians(s, id))}`,
        );
        if (light === null) {
          // 제27조 제7항 — 신호기 없는 보호구역 횡단보도는 보행자가 없어도 일시정지
          if (!this.zoneStopped[id]) {
            this.record('SCHOOL_ZONE_NO_STOP', s, `어린이보호구역 · 신호기 없는 ${ZONE_ROAD_NAME[id]} 앞 무정지`);
          }
        } else if (light !== 'green') {
          /*
            **황색도 잡는다.** 뒤에 빠져나갈 교차로가 없는 단일 횡단보도라, 설 수 있으면 서야 한다
            ([별표 2] 황색의 등화). 이미 선 뒤라면 걸지 않는다 — 서서 기다리는 중인 차를 위반으로 볼 수 없다.
          */
          if (!this.zoneStopped[id]) {
            this.record('SCHOOL_ZONE_RED', s, `어린이보호구역 ${ZONE_ROAD_NAME[id]} ${LIGHT_TEXT[light]} 통과`);
          }
        }
      }

      /*
        제27조 제1항 — 보행자가 통행 중이거나 통행하려는데 밀고 들어갔는가.

        **횡단보도 위에 있을 때만 본다** (진입로 보호구역 횡단보도와 같은 기준). 정지선부터 보면
        **서려고 속도를 줄이는 중인 차**가 걸린다 — 실제로 규정대로 몬 자율 주행이 횡단보도 1.9m 앞에서
        2km/h 로 굴러가다 '방해' 로 잡혔다. 교차로의 A 가 정지선부터 보는 것은 거기에 정지선이 실제로
        그어져 있고 그 앞에서 서야 하기 때문이다.
      */
      this.trackPedestrianConflict(s, dt, id, s.frontZ <= near && s.frontZ >= far);
    }
  }

  private stoppedBeforeA(): boolean {
    return this.cleanStopBeforeA || this.lateStopBeforeA;
  }

  private trackIntersection(s: WorldSample): void {
    /*
      **신호는 정지선을 지나는 순간의 것으로 본다.** 녹색(녹색 화살표)에 정지선을 지났으면 그다음 바뀌는 신호는
      "이미 진입했으면 신속히 통과" 다 ([별표 2] 황색의 등화). 예전에는 교차로에 들어서는 순간의 신호로 봤는데, 정지선과
      교차로 사이에 첫 횡단보도가 있어 서행으로 3초가 걸린다 — 녹색 화살표 끝자락에 규정대로 정지선을 지난 차가
      교차로 앞에서 적색이 되어 "적색 화살표에 우회전" 으로 잡혔다 (플레이테스트가 잡았다).
    */
    if (!this.lightsAtLine && s.frontZ <= STOP_LINE) {
      this.lightsAtLine = { vehicleLight: s.vehicleLight, rightArrow: s.rightArrow };
    }
    if (!this.enteredIntersection && s.frontZ <= INTERSECTION_HALF) {
      this.enteredIntersection = true;
      this.signalAtEntry = s.rightSignalOn;
      this.note(
        s.t,
        'info',
        `교차로 진입 — 정면신호 ${LIGHT_TEXT[s.vehicleLight]}` +
          ` · 일시정지 ${this.stoppedBeforeA() ? '함' : '안 함'}` +
          (this.drive === 'straight' ? ' · 직진 통과' : ` · 지시등 ${s.rightSignalOn ? '켜짐' : '꺼짐'}`),
      );
      this.judgeApproach(s);
    }
    if (!this.enteredIntersection) return;

    const inside =
      Math.abs(s.centerX) < INTERSECTION_HALF && Math.abs(s.centerZ) < INTERSECTION_HALF;
    if (!inside) return;

    this.maxSpeedInIntersection = Math.max(this.maxSpeedInIntersection, s.speedKmh);
    const dx = s.centerX - INNER_CORNER.x;
    const dz = s.centerZ - INNER_CORNER.z;
    this.turnRadius = Math.max(this.turnRadius, Math.hypot(dx, dz));
  }

  /**
   * 교차로 진입 순간의 신호 준수 판정.
   * 시행규칙 [별표 2] 비고 제3호에 따라 우회전 신호등이 있으면 그것이 정면 차량신호등를 대체한다.
   */
  private judgeApproach(now: WorldSample): void {
    // 정지선을 지난 순간의 신호 (위 trackIntersection) — 기록이 없으면(정지선 안쪽에서 출발한 판) 지금 것
    const s = { ...now, ...(this.lightsAtLine ?? {}) };
    /*
      **직진은 적색에 갈 수 없다.**

      같은 적색인데도 우회전과 정반대다 — 우회전은 서고 나서 갈 수 있지만([별표 2] 「적색의 등화」 제2호),
      직진은 **녹색으로 바뀔 때까지 기다려야 한다.** 우회전 신호등은 직진과 무관하므로 보지 않는다.

      **황색은 잡지 않는다.** 원형등화의 황색을 우회전에서 잡지 않는 것과 같은 이유다 — 정지선 앞
      딜레마 구간에서는 멈출 수도 지날 수도 있는데, 그 순간을 단속처럼 가르면 억울한 판정만 늘어난다.
      실제로 규정대로 몬 자율 주행이 보행자를 보내고 출발하다 황색에 정지선을 지나 걸렸다.
    */
    if (this.drive === 'straight') {
      if (s.vehicleLight === 'red' || s.vehicleLight === 'redFlash') {
        this.record('STRAIGHT_RED', s, `정면신호 ${LIGHT_TEXT[s.vehicleLight]}에 직진 통과`);
      }
      return;
    }
    if (s.rightArrow !== null) {
      if (s.rightArrow === 'redArrow') {
        this.record('RIGHT_ARROW_RED', s);
      }
      /*
        녹색화살표는 "화살표시 방향으로 진행할 수 있다" — 정지 의무가 없다.

        황색화살표는 법문상 "정지선·횡단보도 직전에 정지(이미 진입했으면 신속히 통과)"지만,
        위반으로 잡지 않는다. 원형등화의 황색을 잡지 않는 것과 같은 이유다 — 딜레마 구간에서
        멈출 수도 지날 수도 있는 순간을 단속처럼 가르면 억울한 판정만 늘어난다.
      */
    } else if (s.vehicleLight === 'red' || s.vehicleLight === 'redFlash') {
      // 별표2 「적색의 등화」 제2호 — 보행자 유무와 무관하게 정지 후 우회전
      if (!this.stoppedBeforeA()) {
        this.record('RED_NO_STOP', s, '적색 등화에서 정지선 앞 일시정지 없이 진입');
      }
    }
    // 녹색·황색의 등화에서는 일시정지 의무가 없다. (황색은 보행자 횡단 방해만 금지)

    if (this.lateStopBeforeA && !this.cleanStopBeforeA) {
      this.record('OVER_STOP_LINE', s, '횡단보도를 밟고 정지 (허용 오차 초과)');
    }

    // 제25조 제5항 — 꼬리물기
    if (s.exitBlocked) {
      this.record('BLOCKING_INTERSECTION', s);
    }
  }

  /** 횡단보도 C (우회전 후 만나는 횡단보도). 판정 논리는 A와 동일하다. */
  private trackCrosswalkC(s: WorldSample, dt: number): void {
    if (!this.enteredIntersection) return;

    const pastNearEdge = s.frontX >= CROSSWALK_INNER;
    const withinBand = pastNearEdge && s.frontX <= CROSSWALK_OUTER;

    if (!this.enteredCrosswalkC && pastNearEdge) {
      this.enteredCrosswalkC = true;
      this.note(
        s.t,
        'info',
        `횡단보도 C 진입 — ${s.speedKmh.toFixed(0)}km/h` +
          ` · 앞서 일시정지 ${this.stopBeforeC ? '함' : '안 함'}` +
          ` · ${this.describePedestrians(this.conflictingPedestrians(s, 'C'))}`,
      );
      if (s.isSchoolZone && s.pedSignal.C === null && !this.stopBeforeC) {
        this.record('SCHOOL_ZONE_NO_STOP', s, '어린이보호구역 · 신호기 없는 횡단보도 C 앞 무정지');
      }
    }

    this.trackPedestrianConflict(s, dt, 'C', withinBand);
  }

  /**
   * **횡단보도 B (교차로 건너편).** 직진 코스에서 교차로를 지나 만나는 횡단보도다.
   *
   * 판정 논리는 C 와 같다 — 다른 것은 **재는 축뿐**이다. C 는 동쪽(x)으로 빠져나가며 만나고
   * B 는 북쪽(-z)으로 빠져나가며 만나므로, 가까운 가장자리가 `CROSSWALK_B_INNER`(-14.8)이고
   * 지나고 나면 `CROSSWALK_B_OUTER`(-18.8) 다. z 가 **줄어드는** 방향이라 부등호가 뒤집힌다.
   */
  private trackCrosswalkB(s: WorldSample, dt: number): void {
    if (!this.enteredIntersection) return;

    const pastNearEdge = s.frontZ <= CROSSWALK_B_INNER;
    const withinBand = pastNearEdge && s.frontZ >= CROSSWALK_B_OUTER;

    if (!this.enteredCrosswalkB && pastNearEdge) {
      this.enteredCrosswalkB = true;
      this.note(
        s.t,
        'info',
        `건너편 횡단보도 진입 — ${s.speedKmh.toFixed(0)}km/h` +
          ` · 앞서 일시정지 ${this.stopBeforeB ? '함' : '안 함'}` +
          ` · ${this.describePedestrians(this.conflictingPedestrians(s, 'B'))}`,
      );
      // 제27조 제7항 — 어린이보호구역 안, 신호기 없는 횡단보도는 보행자가 없어도 일시정지
      if (s.isSchoolZone && s.pedSignal.B === null && !this.stopBeforeB) {
        this.record('SCHOOL_ZONE_NO_STOP', s, '어린이보호구역 · 신호기 없는 건너편 횡단보도 앞 무정지');
      }
    }

    this.trackPedestrianConflict(s, dt, 'B', withinBand);
  }

  private hasConflictingPedestrian(s: WorldSample, id: CrosswalkId): boolean {
    return this.conflictingPedestrians(s, id).length > 0;
  }

  private conflictingPedestrians(s: WorldSample, id: CrosswalkId): PedestrianSample[] {
    return s.pedestrians.filter((p) => p.crosswalk === id && p.intendsToCross && p.onConflictPath);
  }

  /** "왜 이 사람 때문에 걸렸는지" — 상태와 보행신호를 그대로 적는다 */
  private describePedestrians(list: PedestrianSample[]): string {
    if (list.length === 0) return '보행자 없음';
    const one = (p: PedestrianSample) => {
      const where = p.state === 'waiting' ? '통행하려 함(보도에서 대기)' : '통행 중';
      // 자전거는 무엇을 하고 있는지가 곧 조문을 가른다 — 기록에 그대로 적는다
      const bike = p.bike === 'ride' ? '자전거 타고 ' : p.bike === 'push' ? '자전거 끌고 ' : '';
      const sig =
        p.signal === undefined
          ? ''
          : p.signal === null
            ? ' · 보행신호 없음'
            : ` · 보행신호 ${PED_SIGNAL_TEXT[p.signal]}`;
      return `${bike}${where}${sig}`;
    };
    // 전부 타고 건너는 자전거면 '보행자' 라고 부르지 않는다 (제2조 제17호 — 끌고 가는 사람만 보행자다)
    const noun = list.every((p) => p.bike === 'ride') ? '자전거' : '보행자';
    return `${noun} ${list.length}명 (${list.map(one).join(' / ')})`;
  }

  /** 같은 위반이 여러 프레임에 걸쳐 중복 기록되지 않도록 코드별로 1회만 남긴다. */
  private record(code: ViolationCode, s: WorldSample | null, why?: string): void {
    if (this.seen.has(code)) return;
    this.seen.add(code);
    const place = s ? placeLabel(s) : '주행 종료 후 집계';
    this.note(
      s?.t ?? this.elapsed,
      'bad',
      `위반 확정: ${VIOLATIONS[code].title} · ${place}${why ? ` — ${why}` : ''}`,
    );
    this.violations.push({
      code,
      atTime: s?.t ?? this.elapsed,
      atPosition: { x: s?.centerX ?? 0, z: s?.centerZ ?? 0 },
      place,
      inSchoolZone: s?.isSchoolZone ?? false,
      daytime: s?.isDaytime ?? true,
    });
  }
}
