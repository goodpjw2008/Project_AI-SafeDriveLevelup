/**
 * 시나리오 정의.
 *
 * 신호 프로그램은 실제 교차로처럼 연동되어 있다. 남북(플레이어) 방향이 녹색이면
 * 동서 방향은 적색이고, 그때 플레이어가 우회전해서 만나는 횡단보도 C의 보행신호는 **녹색**이다.
 * 바로 이 구조 때문에 "내 앞은 녹색 신호인데 왜 멈춰야 하지?"라는 혼동이 생긴다.
 * 시나리오 4·5는 이 상황을 정면으로 다룬다.
 *
 * 우회전 신호등은 국내에 설치된 교차로가 드물어 시나리오에서 제외했다.
 * 법규 판정 엔진(rules/lawRules.ts)에는 규정이 남아 있다 — 시행규칙 [별표 2] 비고 제3호.
 */

import type { CrosswalkId, IntersectionCrosswalk, LightColor, PedSignal, RightArrowColor } from '../rules/lawRules';
import { SPAWN_Z, SPAWN_Z_SCHOOL_ZONE, STOP_LINE } from '../layout';
import { LEAD_HALF_LENGTH_MAX, LeadDrive, type LeadCarSpec } from '../game/leadDrive';
import { CAR_HALF_LENGTH } from './turnPath';

export type TimeOfDay = 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain';

/**
 * 꼬리물기 시나리오에서 진출로 정체가 풀리는 시각(초).
 *
 * 정체가 영영 안 풀리면 **"진입하지 않는 것" 이 정답인데도 시나리오를 끝낼 수 없다.**
 * 기다리면 풀리도록 해야 "기다렸다 들어간다" 를 학습할 수 있다.
 *
 * **여기 있는 이유**: 게임(Game.ts)과 시나리오 검증기(validate.ts)가 함께 쓴다.
 * Game.ts 에만 두었더니 검증기가 정체를 정적인 것으로 보고 돌려, 꼬리물기 판을 전부
 * "통과 불가능" 으로 버렸다 — 실제로는 10초만 기다리면 되는 판이었다.
 *
 * **10초에서 16초로 늘렸다.** 실제 차(서행으로 다가간다)는 정면 녹색이면 10.3초에 교차로에 들어서는데, 정체가
 * 10초에 풀려 **아무도 정체를 만나지 못했다** — 막 몰아도 꼬리물기로 잡히지 않았고, 판이 가르친다는 "막혔으면
 * 기다린다" 가 한 번도 일어나지 않았다 (플레이테스트가 잡았다). 검증기의 운전자는
 * 40km/h 로 곧장 달려 일찍 닿으므로 이것을 보지 못했다. 16초면 정지선에서 6초쯤 기다린다.
 */
export const JAM_CLEAR_SECONDS = 16;

export interface SignalPhase {
  name: string;
  /** 플레이어(남북) 방향 차량신호 */
  vehicle: LightColor;
  /** 횡단보도 A(플레이어 진입 전, 남북 도로를 가로지름) 보행신호 */
  pedA: PedSignal;
  /** 횡단보도 C(우회전 후, 동서 도로를 가로지름) 보행신호 */
  pedC: PedSignal;
  /**
   * 우회전 신호등의 등화. **설치된 시나리오에서만 쓴다**
   * (`rightArrowInstalled`).
   *
   * 색은 **횡단보도 C 의 보행신호와 맞물린다** — 우회전 신호등을 다는 이유가 바로
   * "우회전 차량과 횡단보도 C 보행자가 부딪히는 것"을 신호로 갈라 놓기 위해서다.
   * 그래서 C 가 녹색인 구간에는 적색 화살표, C 가 적색인 구간에 녹색 화살표가 켜진다.
   */
  rightArrow: RightArrowColor;
  duration: number;
}

/**
 * 표준 신호 프로그램 1주기.
 *
 * 남북 녹색 구간에는 동서 도로를 가로지르는 횡단보도 C가 보행 녹색이 된다.
 * 즉 "내 앞은 녹색 신호인데 우회전해서 나가는 횡단보도는 보행 녹색"이라는 상황이
 * 신호 구조상 자연스럽게 만들어진다.
 *
 * ── 우회전 신호등을 넣으면서 남북 직진을 셋으로 쪼갰다
 *
 * 우회전 녹색 화살표는 **두 횡단보도가 모두 적색일 때만** 켤 수 있다. 우회전 차량은
 * 진입 전 횡단보도(A)를 가로지른 뒤 진출 횡단보도(C)를 또 가로지르기 때문이다.
 * 처음에는 동서 직진 구간(정면 적색)에 녹색 화살표를 켰는데, 그 구간은 **A 가 보행
 * 녹색**이라 규정대로 우회전하면 사람을 치는 신호가 됐다.
 *
 * 실제 우회전 신호등 교차로가 하는 방식대로 바꿨다 — **직진 녹색을 유지한 채, C 의 보행이
 * 끝난 뒤에 우회전 화살표를 내보낸다.** 그동안 A 는 계속 적색이므로 두 횡단보도가 모두 비어 있다.
 */
/**
 * **진입부 어린이보호구역 횡단보도(S)의 신호 주기.**
 *
 * 교차로 주기(STANDARD_PROGRAM)와 **따로 돈다.** 실제로도 단일 횡단보도 신호기는
 * 교차로 신호와 연동되지 않는 것이 보통이고, 무엇보다 여기서 시험하려는 것이 다르다 —
 * 교차로 쪽은 "우회전할 때 무엇을 보는가", 이쪽은 "빨간불에 서는가" 하나뿐이다.
 *
 * ## 왜 이렇게 짧은가
 *
 * 한 주기 39초다. 교차로 주기(64초)보다 짧게 잡은 이유는, 여기서 걸리면 **교차로에
 * 닿기도 전에 판이 끝나 버리기** 때문이다. 적색 12초는 한 번 서서 기다리기에 충분하고
 * 지루하지는 않은 길이다.
 *
 * 보행 녹색과 차량 적색이 정확히 겹친다 — 한 횡단보도뿐이라 갈릴 일이 없다.
 */
export interface SchoolZonePhase {
  name: string;
  /** 차량신호등 */
  vehicle: LightColor;
  /** 횡단보도 S 의 보행신호등 */
  ped: PedSignal;
  duration: number;
}

/*
  **두 등화가 같은 순간에 바뀐다.**

  예전에는 마지막에 전적색(양쪽 모두 적색) 2초가 있었다. 실물 신호기의 정리 시간이지만,
  화면에서는 **보행등이 붉어지고 2초 뒤에야 차량등이 녹색**이 되어 "보행자 신호가 끝났는데
  왜 아직 못 가지" 로 읽혔다 — 한 횡단보도뿐이라 두 등화가 한눈에 함께 들어오는 자리다.

  정리 시간은 **보행 점멸**로 옮겼다 (4초 → 6초). 건너는 사람에게 주는 경고 시간은 그대로고
  (점멸도 "건너기 시작하지 말 것"이다), 주기 한 바퀴도 39초 그대로다.
*/
export const SCHOOL_ZONE_PROGRAM: readonly SchoolZonePhase[] = [
  { name: '차량 녹색', vehicle: 'green', ped: 'red', duration: 18 },
  { name: '차량 황색', vehicle: 'yellow', ped: 'red', duration: 3 },
  { name: '보행 녹색', vehicle: 'red', ped: 'green', duration: 12 },
  { name: '보행 점멸', vehicle: 'red', ped: 'greenFlash', duration: 6 },
];

/** 보호구역 주기 한 바퀴 (초) */
export const SCHOOL_ZONE_CYCLE = SCHOOL_ZONE_PROGRAM.reduce((n, p) => n + p.duration, 0);

export const STANDARD_PROGRAM: SignalPhase[] = [
  {
    name: '남북 직진 · 보행',
    vehicle: 'green',
    pedA: 'red',
    pedC: 'green',
    // 우회전해서 나가는 횡단보도에 사람이 건너는 중 — 우회전 금지
    rightArrow: 'redArrow',
    duration: 16,
  },
  {
    name: '남북 직진 · 보행점멸',
    vehicle: 'green',
    pedA: 'red',
    pedC: 'greenFlash',
    rightArrow: 'redArrow',
    duration: 4,
  },
  {
    name: '남북 직진 · 우회전',
    vehicle: 'green',
    pedA: 'red',
    pedC: 'red',
    // 두 횡단보도가 모두 적색인 유일한 긴 구간 — 여기서 우회전을 내보낸다
    rightArrow: 'greenArrow',
    duration: 14,
  },
  {
    name: '남북 황색',
    vehicle: 'yellow',
    pedA: 'red',
    pedC: 'red',
    rightArrow: 'yellowArrow',
    duration: 3,
  },
  {
    name: '전방향 적색',
    vehicle: 'red',
    pedA: 'red',
    pedC: 'red',
    rightArrow: 'redArrow',
    duration: 2,
  },
  {
    name: '동서 직진',
    vehicle: 'red',
    pedA: 'green',
    pedC: 'red',
    // 내 진입 횡단보도(A)를 사람이 건너는 중이라 우회전은 여전히 금지다
    rightArrow: 'redArrow',
    duration: 20,
  },
  {
    name: '동서 황색',
    vehicle: 'red',
    pedA: 'greenFlash',
    pedC: 'red',
    rightArrow: 'redArrow',
    duration: 3,
  },
  {
    name: '전방향 적색',
    vehicle: 'red',
    pedA: 'red',
    pedC: 'red',
    rightArrow: 'redArrow',
    duration: 2,
  },
];

export interface PedSpawn {
  crosswalk: CrosswalkId;
  /**
   * 시나리오 시작 후 이 시각(초)에 **건너기 시작**한다.
   *
   * 그 전에도 보행자는 **보도에 서 있는 모습으로 보인다** — 멀리서 미리 알아보고 판단할 수
   * 있어야 하기 때문이다(Pedestrian.ts). 이 값은 '나타나는 때'가 아니라 '출발하는 때'다.
   * (보행신호를 지키는 사람은 이 시각이 지나도 녹색이 될 때까지 서 있는다)
   */
  at: number;
  /**
   * 플레이어가 이 횡단보도까지 **이만큼(m) 남았을 때** 출발한다. (`at` 과 함께 걸린다)
   *
   * 시각만으로 맞추면 **상황 자체가 연출되지 않는다.** 보행자가 다 건너는 데 12초쯤
   * 걸리는데, 접근 거리·주행 속도·도로 폭이 조금만 달라져도 내가 닿기 전에 이미 다
   * 건너가 버리거나(기다릴 일이 없다) 아직 출발도 안 한 상태가 된다. 실제로 도로 폭을
   * 두 번 바꾸는 동안 시나리오 셋의 시각이 모두 어긋났다.
   *
   * 거리로 걸면 **어떤 속도로 와도 같은 장면**이 된다. 여러 명일 때는 거리를 달리 줘서
   * 차례로 나서게 한다 (예: 24m · 18m · 12m).
   *
   * 참고 거리 — 정지선에서 횡단보도 C 까지 약 22m, 교차로 진입선에서 약 11m.
   */
  startWithin?: number;
  /**
   * 출발하는 쪽.
   * A 횡단보도: 'left' = 서쪽(x-) 보도에서 동쪽으로, 'right' = 동쪽(x+) 보도에서 서쪽으로.
   * C 횡단보도: 'left' = 북쪽(z-) 보도에서 남쪽으로, 'right' = 남쪽(z+) 보도에서 북쪽으로.
   */
  from: 'left' | 'right';
  /** 보행 속도 (m/s). 기본 1.2 */
  speed?: number;
  /**
   * 보행신호를 지키는가.
   * false면 신호와 무관하게 건넌다 — 보행신호와 상관없이 보행자의 통행 여부가 기준임을 보여주는 장치.
   */
  obeysSignal?: boolean;
  /** 외형 구분용 (어린이 = 작고 움직임이 빠름) */
  kind?: 'adult' | 'child' | 'elder';
  /**
   * **이 확률로만 나온다** (0~1, 기본 1 = 항상).
   *
   * 판마다 사람이 반드시 나오면 "사람이 보이면 선다"를 익히게 된다. 그런데 07번이
   * 가르치려는 것은 그 반대다 — **보행자의 통행 여부와 관계없이** 선다(제27조 제7항).
   * 나올 때도 있고 안 나올 때도 있어야 "어느 쪽이든 서야 한다"가 몸에 남는다.
   */
  chance?: number;
  /**
   * **앞차가 지나간 뒤에 나선다** — 앞차가 있는 판의 보행자.
   *
   * 앞차가 먼저 서서 사람을 다 보내 주면, 뒤따르는 나는 그 사람과 만날 일이 없다 (앞차가 있는 판 1,500여 개가
   * 그랬다 — 판 제목에 사람이 있어도 나에게는 서 있는 그림이었다). 실제 도로에서 흔한 사고도 이쪽이다 —
   * **앞차가 지나가자마자 그 뒤로 사람이 나선다.** 앞차 뒤를 그대로 따라가면 부딪힌다.
   *
   * 앞차가 이 횡단보도를 벗어나기 전에는 건너려는 뜻도 보이지 않는다(앞차가 양보할 이유가 없다). 벗어나면
   * 뜻을 드러내고, 1초 뒤 나선다 — **내가 설 수 있는 거리일 때만.** 이미 코앞이면 나를 보내고 건넌다
   * (pedWalk.ts 의 AFTER_LEAD_*).
   */
  afterLead?: boolean;
  /**
   * **내 차가 지나갈 때까지 기다린다** — 신호를 기다리는 사람(`mixed` 의 한 사람).
   *
   * 이 사람은 보도에 서 있기만 하고, 내 차가 그 횡단보도를 지난 뒤에야 (자기 신호가 녹색이면) 건넌다. 시각으로 맞추려
   * 했더니 앞에서 늦어지는 만큼(보호구역 신호 · 무단횡단자) 어긋나, 내가 막 출발하려는 순간 그 사람의 보행신호가 녹색이
   * 되어 뜻을 드러냈다 — 보는 사람에게는 "가만히 있던 사람이 갑자기" 가 된다 (플레이테스트가 잡았다).
   */
  letsCarPass?: boolean;
}

/**
 * 화면에 쓰는 판 이름 — `Stage01`.
 *
 * **한 곳에서 만든다.** 이 이름이 나오는 곳은 셋이다 — 목록 카드, 주행 중 목표 상자,
 * 결과 화면 제목. 세 곳에 흩어 두면 한 곳만 고쳐 놓고 나머지를 잊는다.
 *
 * 두 자리로 채우는 이유는 목록에서 세로로 줄을 맞추기 위해서다 (Stage1 · Stage10 이
 * 섞이면 앞뒤가 들쭉날쭉해진다).
 */
export const stageLabel = (id: number): string =>
  id >= LIBRARY_ID_BASE
    ? 'AI 추천'
    : id >= GENERATED_ID_BASE
      ? 'AI 맞춤'
      : `Stage${String(id).padStart(2, '0')}`;

/**
 * 시나리오 라이브러리(library.ts) 판의 id 는 여기서부터다 — AI 가 **고른** 판이다.
 * library.ts 가 이 파일을 불러 쓰므로 값은 여기 둔다 (반대로 두면 서로를 부른다).
 */
export const LIBRARY_ID_BASE = 1000;

/**
 * AI 가 만든 판의 id 는 **여기서부터** 시작한다.
 *
 * 손으로 쓴 판과 겹치면 안 된다 — 저장된 주행 기록이 stage id 로 묶이므로, 겹치면
 * AI 판의 결과가 손으로 쓴 판의 통계에 섞인다. 번호를 갈라 두면 나중에 "AI 판을 푼 뒤
 * 그 위반의 재발률이 얼마나 떨어졌는가" 도 갈라서 셀 수 있다.
 */
export const GENERATED_ID_BASE = 100;

/**
 * 시나리오 제목은 **`상황 - 조건`** 한 가지 꼴로 맞춘다.
 * 목록에서 나란히 볼 때 무엇이 달라지는지가 제목만으로 드러나야 한다
 * (정면신호 색 / 보행자 유무가 이 게임의 두 축이다).
 */
export interface ScenarioSpec {
  id: number;
  title: string;
  /** 플레이 전 안내 */
  brief: string;
  /** 이 시나리오가 가르치는 것 */
  teaches: string;
  /** 시작 시점의 신호 페이즈 인덱스 */
  startPhase: number;
  /** 그 페이즈에서 이미 경과한 시간(초) */
  startPhaseElapsed: number;
  /**
   * 교차로 횡단보도(A·C)의 보행신호기 설치 여부. false 면 신호기 없는 횡단보도.
   *
   * **진입부 보호구역의 횡단보도(S)는 여기 없다** — 그쪽은 교차로 주기와 무관한 자기
   * 신호를 갖거나 아예 없으므로 `approachSchoolZone` 이 따로 정한다.
   */
  pedSignalInstalled: Record<IntersectionCrosswalk, boolean>;
  /**
   * **진입부 어린이보호구역** — 교차로에 닿기 전, 오는 길에 지나는 구간. 없으면 생략한다.
   *
   * 교차로 자체를 보호구역으로 만드는 `isSchoolZone` 과 **별개다.** 둘 다 켜면 오는 길과
   * 교차로가 모두 보호구역이고, 이쪽만 켜면 보호구역을 지나 평범한 교차로에 닿는다.
   *
   * 어느 쪽이든 그 구간에서는 **30km/h 이하로 조인다**(제12조 제1항 · Vehicle.ts).
   */
  approachSchoolZone?: {
    /**
     * 횡단보도 S 에 **신호기가 있는가.**
     *
     *  - `true` — 자기 주기를 따라 등화가 돈다(SCHOOL_ZONE_PROGRAM). 적색이면 서야 한다
     *  - `false` — 신호기 없는 횡단보도. **보행자가 없어도 일시정지**가 의무다
     *    (제27조 제7항). 이 게임이 교정하려는 세 오해 중 하나가 정확히 여기다
     */
    signal: boolean;
    /** 신호 주기의 시작 오프셋(초). `signal` 이 true 일 때만 쓴다 */
    signalElapsed?: number;
  };
  /**
   * 우회전 신호등이 설치된 교차로인가.
   *
   * 국내 설치가 아직 드물어 기본은 false 다. 켜면 정지선 옆 보도에 세로형 3등화가 서고,
   * **다른 신호등에도 불구하고 이 등화를 따라야 한다**(시행규칙 [별표 2] 비고 제3호).
   */
  rightArrowInstalled?: boolean;
  /**
   * **앞차.** 없으면 생략한다 (game/leadDrive.ts).
   *
   * 내 차 앞에서 같은 길로 우회전하는 차다. `lawful` 은 규정대로 서서 추돌과 시야 가림을
   * 만들고, `rolling` 은 적색에 **일시정지 없이** 우회전해 "앞차가 가니까 따라간다" 를
   * 시험한다. 어느 쪽이든 보행자는 치지 않는다.
   */
  leadCar?: LeadCarSpec;
  pedestrians: PedSpawn[];
  /**
   * **뒤차가 경적으로 재촉하는가.** 없으면(생략) 재촉한다 — 손으로 쓴 판은 늘 그랬다.
   *
   * 정지선·횡단보도 앞에서 서 있을 때 뒤에서 울리는 경적은 실제로 사람들이 규정을 어기게
   * 만드는 가장 흔한 압박이다. `false` 면 뒤차는 조용히 따라오기만 한다 — 같은 상황을 재촉이
   * 있을 때와 없을 때로 나눠 겪게 하려고 판마다 정한다 (library.ts 의 `pressure` 축).
   */
  rearHonk?: boolean;
  /** 교차 방향 NPC 차량 대수 */
  crossTraffic: number;
  /** 교차로 진출로 정체 (꼬리물기 상황) */
  exitBlocked: boolean;
  isSchoolZone: boolean;
  timeOfDay: TimeOfDay;
  weather: Weather;
  /** 매 플레이마다 조건이 무작위로 조합되는 반복 스테이지 */
  randomized?: boolean;
  /**
   * 출발 시점을 신호 주기 안에서 무작위로 흔든다.
   * 정면 신호는 그대로 녹색이지만, 우회전 후 횡단보도의 보행신호는 매번 다른 색으로 걸린다.
   */
  randomStartOffset?: boolean;
}

export const SCENARIOS: ScenarioSpec[] = [
  {
    id: 1,
    title: '정면신호 녹색 - 보행자 없음',
    brief:
      '정면 차량신호등이 녹색이고 보행자도 없습니다. 우측 가장자리 차로를 따라 그대로 우회전하세요.',
    teaches:
      '우측 횡단보도의 보행신호와 상관없이 보행자의 통행 여부가 기준입니다. 그 보행신호는 ' +
      '갈 때마다 녹색이거나 녹색점멸이지만, 통행 또는 통행하려는 보행자가 없으면 ' +
      '그대로 서행 통과할 수 있습니다. ' +
      '괜히 멈춰 서 있으면 뒤차의 흐름을 막습니다. ' +
      '(서행과 방향지시등은 이 시뮬레이터가 자동으로 처리합니다)',
    startPhase: 0,
    startPhaseElapsed: 2,
    // 매번 다른 시점에 출발해, 우회전 후 횡단보도의 보행신호가 녹색·녹색점멸·적색 중
    // 무엇으로 걸릴지 달라지게 한다. 우측 횡단보도의 보행신호는 판정 기준이 아님을 몸으로 익히는 장치다.
    randomStartOffset: true,
    pedSignalInstalled: { A: true, C: true },
    pedestrians: [],
    crossTraffic: 0,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
  },
  {
    id: 2,
    title: '정면신호 적색 - 보행자 없음',
    brief:
      '정면 차량신호등이 적색입니다. 횡단보도에 사람은 아무도 없습니다. 어떻게 해야 할까요?',
    teaches:
      '정면 차량신호등이 적색이면 보행자의 통행 여부와 관계없이 정지선 앞에서 반드시 ' +
      '일시정지한 뒤 우회전해야 합니다. 이것이 가장 많이 틀리는 부분입니다.',
    // 동서 직진(정면 적색) 구간 — 남북 직진을 셋으로 쪼개면서 인덱스가 3 → 5 로 밀렸다
    startPhase: 5,
    startPhaseElapsed: 3,
    pedSignalInstalled: { A: true, C: true },
    pedestrians: [],
    crossTraffic: 2,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
  },
  {
    id: 3,
    title: '정면신호 적색 - 보행 적색신호 무단 횡단',
    brief:
      '정면 차량신호등이 적색이고, 우회전한 뒤 만나는 횡단보도에 사람이 서 있습니다.',
    teaches:
      '일시정지는 "잠깐 섰다"가 아니라 "보행자의 통행 종료 시까지 정지한다"는 뜻입니다. ' +
      '정지선에서 한 번 섰더라도 보행자가 남아 있는데 출발하면 여전히 횡단 방해입니다. ' +
      '우측 횡단보도의 보행신호와 상관없이 보행자가 통행 또는 통행하려 하는지, ' +
      '통행이 종료되었는지가 핵심 요소입니다.',
    // 동서 직진(정면 적색) 구간 (인덱스 3 → 5)
    startPhase: 5,
    startPhaseElapsed: 2,
    pedSignalInstalled: { A: true, C: true },
    /*
      등장 시각은 **플레이어가 횡단보도 C 앞에 닿는 시각**(정지선에서 최소한으로 서고 바로
      돌면 약 15초)에 맞춘다. 이 두 사람은 가까운 쪽(right)에서 건너와 내 차로를 4~6초 만에
      벗어나므로, 예전 값(3.5·5.0초)으로 두면 **내가 도착하기 전에 이미 다 건너가 버려**
      "보행자가 있는데 출발하면 방해" 라는 이 시나리오의 상황 자체가 연출되지 않는다.
      (도로를 넓혀 접근 거리가 길어지고 보행 속도까지 올라가면서 어긋났다)
    */
    pedestrians: [
      { crosswalk: 'C', at: 11.0, from: 'right', obeysSignal: false, kind: 'adult' },
      { crosswalk: 'C', at: 13.5, from: 'right', obeysSignal: false, kind: 'elder' },
    ],
    crossTraffic: 2,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
  },
  {
    id: 4,
    title: '정면신호 녹색 - 보행 녹색신호 정상 횡단',
    brief:
      '정면 차량신호등이 녹색입니다. 그런데 우회전해서 나가는 횡단보도의 보행신호는 녹색이고 ' +
      '사람들이 건너고 있습니다.',
    teaches:
      '내 차량신호가 녹색이라고 해서 횡단보도를 통과할 권리가 생기는 것은 아닙니다. ' +
      '우회전한 뒤 만나는 횡단보도의 보행자 통행 여부, 통행 의사, 통행 종료 등을 ' +
      '확인하는 것이 핵심입니다.',
    startPhase: 0,
    startPhaseElapsed: 1,
    pedSignalInstalled: { A: true, C: true },
    /*
      셋 다 **내가 다가오는 거리**에 맞춰 차례로 나선다 (정지선 부근 24m → 18m → 12m).
      예전에는 1.0·2.2·4.0초로 두었는데, 그러면 내가 닿기 전에 이미 다 건너가 버려
      "통행 종료 시까지 정지" 라는 이 시나리오의 핵심 장면이 없었다.
    */
    pedestrians: [
      { crosswalk: 'C', at: 0, startWithin: 24, from: 'left', kind: 'adult' },
      { crosswalk: 'C', at: 0, startWithin: 18, from: 'right', kind: 'adult' },
      { crosswalk: 'C', at: 0, startWithin: 12, from: 'left', kind: 'child' },
    ],
    crossTraffic: 0,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
  },
  {
    id: 5,
    title: '우회전 신호등이 있는 경우 - 우회전 신호',
    brief:
      '정지선 옆에 우회전 신호등이 서 있고 지금은 녹색 화살표입니다. ' +
      '양쪽 횡단보도의 보행신호는 모두 적색입니다.',
    teaches:
      '우회전 신호등이 있으면 다른 신호등에도 불구하고 이 등화를 따릅니다(시행규칙 [별표 2] ' +
      '비고 제3호). 녹색 화살표는 "화살표시 방향으로 진행할 수 있다"는 뜻이라 ' +
      '정지 의무 없이 우회전합니다. 이 구간에 녹색인 이유는 진입 전 횡단보도와 진출 ' +
      '횡단보도의 보행신호가 모두 적색이기 때문입니다. ' +
      '06번과 정면 차량신호등은 똑같이 녹색인데, 갈리는 것은 우회전 신호등입니다.',
    /*
      **남북 직진 · 우회전** 현시에서 시작한다. 정면은 녹색을 유지한 채 횡단보도 C 의 보행이
      끝나 두 횡단보도가 모두 적색인 구간이라, 우회전 신호등이 녹색 화살표로 열린다.

      처음에는 동서 직진(정면 적색) 구간에 두었는데 **그 구간은 횡단보도 A 가 보행 녹색**이라,
      규정대로 우회전하면 사람을 치는 신호가 됐다 (STANDARD_PROGRAM 주석 참고).
      14초 동안 열려 있어 우회전을 끝낼 때까지(약 13초) 유지된다.
    */
    startPhase: 2,
    startPhaseElapsed: 0,
    pedSignalInstalled: { A: true, C: true },
    rightArrowInstalled: true,
    pedestrians: [],
    crossTraffic: 2,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
  },
  {
    id: 6,
    title: '우회전 신호등이 있는 경우 - 적색 신호',
    brief:
      '정지선 옆 우회전 신호등이 적색입니다. 정면 차량신호등은 녹색입니다.',
    teaches:
      '정면 차량신호등이 녹색이어도 우회전 신호등이 적색이면 우회전할 수 없습니다 — ' +
      '적색은 "정지선, 횡단보도 및 교차로의 직전에서 정지"입니다. ' +
      '이 구간에 적색인 이유는 우회전해서 나가는 횡단보도의 보행신호가 녹색이기 ' +
      '때문입니다. 보행자가 다 건너면 녹색 화살표로 바뀝니다 — 그때 우회전하세요.',
    /*
      남북 직진(정면 녹색·횡단보도 C 보행 녹색) 구간에서 시작한다 — 우회전 신호등은 적색.

      경과 시간이 **핵심**이다. 14초로 두었더니 내가 정지선에 닿기 전에 정면 신호가 이미
      황색·적색으로 넘어가, 정작 이 판이 보여 주려는 **"내 앞은 녹색 신호인데 우회전은 금지"**
      장면을 정지선에서 못 보고 멀리서 스쳐 지나갔다. 6초로 당기면 정지선에 서는 t≈10초에
      정면이 아직 녹색이고, 그 상태로 4초를 기다린다.

      그 뒤 황색 3초 + 전방향 적색 2초를 지나 t≈19초에 동서 직진으로 넘어가며 **녹색
      화살표**가 켜진다. 한 판 안에서 "정면 녹색인데 우회전 금지 → 정면 적색인데 우회전
      허용" 을 모두 겪는다.
    */
    startPhase: 0,
    startPhaseElapsed: 5,
    pedSignalInstalled: { A: true, C: true },
    rightArrowInstalled: true,
    /*
      기다리는 동안 **왜 적색인지**가 눈에 보여야 한다 — 횡단보도 C 를 사람이 건너고 있다.

      거리가 아니라 **시각**으로 내보낸다. 이 사람은 보행신호를 지키므로 녹색인 동안
      출발해야 하고(t=0.5초), 다 건너는 데 12초쯤 걸려 우회전 화살표가 켜지는 t≈15초
      전에 끝난다. 늦게 내보내면 화살표가 켜진 뒤에도 건너는 중이라, 신호를 가르치는
      판에서 엉뚱하게 횡단 방해가 걸린다.
    */
    pedestrians: [{ crosswalk: 'C', at: 0.5, from: 'left', kind: 'adult' }],
    crossTraffic: 0,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
  },
  {
    id: 7,
    title: '어린이보호구역 - 신호기 없는 횡단보도',
    brief:
      '어린이보호구역입니다. 우회전 후 만나는 횡단보도에는 신호기가 없습니다.',
    teaches:
      '어린이보호구역 안의 신호기 없는 횡단보도 앞에서는 보행자의 통행 여부와 관계없이 ' +
      '일시정지해야 합니다(제27조 제7항). 이 판은 아이가 나올 때도 있고 나오지 않을 때도 ' +
      '있는데, 어느 쪽이든 서야 합니다 — 아이는 차 뒤나 주차차량 사이에서 갑자기 나오기 ' +
      '때문에 만든 규정입니다. ' +
      '낮(오전 8시~오후 8시)에는 신호위반·횡단 방해의 범칙금과 벌점이 2배로 가중됩니다.',
    startPhase: 0,
    startPhaseElapsed: 3,
    /*
      **우회전 후 만나는 횡단보도(C)에 신호기를 두지 않는다.**

      제27조 제7항의 무조건 일시정지는 **신호기가 설치되지 않은 횡단보도**에만 걸린다.
      예전에는 C 에도 신호기를 두어(`C: true`) 이 시나리오가 정작 자기 제목의 규정을
      한 번도 시험하지 않았다 — 보행자가 없으면 그냥 지나가도 규정상 맞았다.
      진입 전 횡단보도(A)는 신호기가 있어, 같은 구역 안에서도 **신호기 유무로 의무가
      갈린다**는 것을 한 판에서 보게 된다.
    */
    randomStartOffset: true,
    pedSignalInstalled: { A: true, C: false },
    /*
      아이는 내가 횡단보도 16m 앞에 왔을 때 뛰어든다 (시각으로 두면 매번 다른 장면이 된다).

      **절반의 확률로만 나온다.** 매번 나오면 "사람이 보이면 선다"를 익히게 되는데,
      이 판이 가르치려는 것은 그 반대 — 보행자가 없어도 서야 한다는 것이다.
    */
    pedestrians: [
      {
        crosswalk: 'C',
        at: 0,
        startWithin: 16,
        from: 'left',
        obeysSignal: false,
        kind: 'child',
        chance: 0.5,
      },
    ],
    crossTraffic: 0,
    exitBlocked: false,
    isSchoolZone: true,
    timeOfDay: 'day',
    weather: 'clear',
  },
  {
    id: 8,
    title: '조건 무작위',
    brief: '조건이 매번 무작위로 바뀝니다. 신호 상황, 보행자 상황을 그때그때 판단하세요.',
    teaches:
      '실제 도로에서는 어떤 조건이 나올지 미리 알 수 없습니다. ' +
      '매번 신호와 보행자를 새로 확인하는 습관이 목표입니다.',
    startPhase: 0,
    startPhaseElapsed: 0,
    pedSignalInstalled: { A: true, C: true },
    pedestrians: [],
    crossTraffic: 3,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'night',
    weather: 'rain',
    randomized: true,
  },
  /*
    ── 앞차가 있는 판 (game/leadDrive.ts) ──────────────────────────────────────

    **번호를 08번 뒤에 붙인다.** 08번(조건 무작위)을 맨 뒤로 옮기면 저장된 주행 기록과
    최고 등급이 Stage 번호로 묶여 있어, 예전 08번의 기록이 이 판의 것으로 섞인다.
  */
  {
    id: 9,
    title: '정면신호 적색 - 앞차가 서지 않고 우회전',
    brief:
      '정면 차량신호등이 적색입니다. 바로 앞차가 먼저 우회전하려 합니다. 앞차를 잘 보세요.',
    teaches:
      '앞차가 일시정지 없이 우회전해 나가도, 정면 차량신호등이 적색이면 나는 정지선 앞에서 ' +
      '반드시 일시정지한 뒤 우회전해야 합니다. 규정은 앞차가 아니라 운전하는 나에게 걸립니다 — ' +
      '"앞차가 가니까" 는 위반의 이유가 되지 않습니다.',
    // 동서 직진(정면 적색) 구간 — 02번과 같은 자리다. 다른 것은 앞차 하나뿐이다
    startPhase: 5,
    startPhaseElapsed: 3,
    pedSignalInstalled: { A: true, C: true },
    /*
      **간격을 좁게 둔다(1.6초).** 앞차가 정지선을 서행으로 지나가는 모습이 내 정지 판단
      직전에 눈앞에 있어야 한다 — 멀리 두면 앞차가 이미 코너 너머로 사라진 뒤라
      "따라가고 싶어지는" 순간이 생기지 않는다. 이 앞차는 서지 않으므로 추돌 걱정은 없다.
    */
    leadCar: { behavior: 'rolling', headway: 1.6 },
    pedestrians: [],
    crossTraffic: 2,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
  },
  {
    id: 10,
    title: '정면신호 녹색 - 앞차가 횡단보도 앞에서 정지',
    brief:
      '정면 차량신호등이 녹색이고 앞차를 따라 우회전합니다. 앞차가 갑자기 서면 어떻게 할까요?',
    teaches:
      '앞차가 우회전 직후 횡단보도 앞에서 서는 것은 보행자가 있기 때문입니다. 앞차 차체에 가려 ' +
      '보행자가 보이지 않아도 앞차가 서면 나도 서고, 앞차가 떠난 뒤에도 보행자의 통행이 ' +
      '끝났는지 직접 확인한 뒤에 지나가야 합니다. 앞차와의 거리를 넉넉히 두어야 설 수 있습니다.',
    startPhase: 0,
    startPhaseElapsed: 2,
    pedSignalInstalled: { A: true, C: true },
    leadCar: { behavior: 'lawful', headway: 2.2 },
    /*
      **앞차가 C 에 닿을 때 이미 건너려는 사람이 서 있다** (보행신호 녹색 · 등장 시각 0).
      앞차가 그 앞에서 서고, 사람은 내가 26m 안으로 들어오면 발을 뗀다 — 그때 나는 앞차
      뒤에 붙어 있어 사람이 차체에 가려진다. 04번과 같은 사람인데 **보이지 않는다**는 것이
      이 판의 전부다.

      둘째 사람은 조금 늦게(14m) 나서, 앞차가 떠난 뒤에도 횡단보도가 비지 않게 한다 —
      "앞차가 갔으니 나도 간다" 를 한 번 더 시험한다.
    */
    pedestrians: [
      { crosswalk: 'C', at: 0, startWithin: 26, from: 'left', kind: 'adult' },
      { crosswalk: 'C', at: 0, startWithin: 14, from: 'right', kind: 'child' },
    ],
    crossTraffic: 0,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
  },
  {
    id: 11,
    title: '정면신호 적색 - 앞차는 직진 대기',
    brief:
      '정면 차량신호등이 적색이고, 앞차가 정지선에 서 있습니다. 그 차는 직진하려고 기다리는 중입니다.',
    teaches:
      '우회전 차로가 따로 없는 교차로에서는 **직진 대기 차량 뒤에서 기다려야 합니다.** ' +
      '적색에 우회전이 허용되는 것과, 앞차를 피해 지나갈 수 있는 것은 다른 문제입니다. ' +
      '옆으로 비켜 돌아 나가면 우측 가장자리를 따르지 않은 대회전(제25조 제1항)이 되고, ' +
      '횡단보도나 정지선을 밟으면 그 위반도 함께 걸립니다. 앞차가 녹색에 출발하면 그때 따라 나갑니다.',
    /*
      **동서 직진(정면 적색) 구간**에서 시작한다. 정확한 자리는 주행 직전에 다시 맞춰진다 —
      앞차가 정지선에 닿고 `STRAIGHT_LEAD_WAIT`(5초) 뒤에 녹색이 켜지도록 (fitStraightLeadWait).
      여기 적은 값 그대로면 11초 넘게 서 있어, 배우는 것보다 견디는 것이 길었다.
    */
    startPhase: 5,
    startPhaseElapsed: 8,
    pedSignalInstalled: { A: true, C: true },
    // 직진 앞차에는 성향이 없다 — 적색이면 어떤 차든 녹색까지 기다린다 (leadDrive.ts)
    leadCar: { behavior: 'lawful', path: 'straight', headway: 2.0 },
    pedestrians: [],
    crossTraffic: 2,
    exitBlocked: false,
    isSchoolZone: false,
    timeOfDay: 'day',
    weather: 'clear',
  },
];

export function getScenario(id: number): ScenarioSpec {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/**
 * 실제 주행에 쓸 시나리오를 확정한다 — 무작위 요소는 여기서 한 번에 적용한다.
 *
 * 출발 시점을 흔드는 폭(최대 6초)은 **교차로 진입 순간까지는 정면 신호가 녹색**으로
 * 남도록 잡았다. 남북 직진이 20초인데 진입까지 10초쯤 걸리므로, 6초를 밀어도 진입은 18초 —
 * 아직 녹색이다. 반면 우회전 후 횡단보도(C)에 닿는 것은 그보다 3초쯤 뒤라,
 * 그 사이 보행신호가 **녹색 또는 녹색점멸**로 갈린다.
 * (적색까지 보려면 정면 신호가 황색으로 넘어가 시나리오 전제가 깨지므로 여기까지가 한계다)
 */
export function prepareScenario(base: ScenarioSpec): ScenarioSpec {
  if (base.randomized) return fitStraightLeadWait(randomizeScenario(base));
  const out: ScenarioSpec = { ...base, pedestrians: rollPedestrians(base.pedestrians) };
  if (base.randomStartOffset) {
    out.startPhaseElapsed = base.startPhaseElapsed + Math.random() * 6;
  }
  // 보호구역을 얹으면 출발 자리가 물러나 앞차가 늦게 닿는다 — 그다음에 맞춘다
  return fitStraightLeadWait(rollApproachZone(out));
}

/**
 * 직진 대기 앞차가 정지선에서 **녹색을 기다리는 시간의 상한** (초).
 *
 * 직진은 적색에 갈 수 없어서 앞차는 녹색까지 서 있다. 그런데 적색 구간이 한 주기에 최대
 * 30초(남북 황색부터 전방향 적색(2)까지)라, 앞차가 적색 초입에 닿으면 20초 넘게 서 있었다 —
 * 그 뒤의 나도 그만큼 선다. 이 판이 가르치는 것은 "직진 대기차 뒤에서는 기다린다" 이지
 * **얼마나 오래 참는가** 가 아니다. 5초면 기다려야 한다는 것을 알아차리고, 앞차가 떠나는
 * 것을 본 뒤 따라 나가기에 충분하다.
 */
export const STRAIGHT_LEAD_WAIT = 5;

/** 신호 주기에서 i 번째 구간이 시작되는 자리 (초) */
const phaseOffset = (i: number): number =>
  STANDARD_PROGRAM.slice(0, i).reduce((n, p) => n + p.duration, 0);

const CYCLE = STANDARD_PROGRAM.reduce((n, p) => n + p.duration, 0);

/** 남북 황색이 시작되는 자리 — 여기부터 주기 끝까지가 정면 녹색이 아닌 구간이다 */
const NON_GREEN_FROM = phaseOffset(3);

/**
 * **직진 대기 앞차가 오래 서 있지 않게** 출발 시점의 신호 자리를 옮긴다.
 *
 * 신호 주기 자체는 건드리지 않는다 — 그것은 모든 판·보행자·배경 차가 함께 쓰는 값이다.
 * 대신 이 판이 **주기의 어디에서 출발하는가**(startPhase · startPhaseElapsed)만 옮겨,
 * 앞차가 정지선에 닿고 `STRAIGHT_LEAD_WAIT` 초 뒤에 녹색이 켜지게 한다.
 *
 * 앞차가 언제 닿는지는 **같은 상태기계(leadDrive.ts)를 미리 굴려서** 잰다. 차간 시간·보호구역
 * 유무에 따라 4초에서 20초 가까이 달라지기 때문에, 상수로 적어 두면 판마다 어긋난다.
 *
 * 이미 짧게 기다리는 판이나, 닿을 때 녹색인 판은 그대로 둔다. 우회전 신호등이 달린 판도
 * 그대로 둔다 — 거기서는 앞차가 아니라 화살표가 나를 붙잡는다.
 */
export function fitStraightLeadWait(spec: ScenarioSpec): ScenarioSpec {
  if (spec.leadCar?.path !== 'straight' || spec.rightArrowInstalled) return spec;

  const arrive = straightLeadArrival(spec);
  if (arrive === null) return spec;

  const pos0 = (phaseOffset(spec.startPhase) + spec.startPhaseElapsed) % CYCLE;
  const posAt = (t: number): number => (pos0 + t) % CYCLE;
  // 닿는 순간 녹색이면 서지 않는다
  if (posAt(arrive) < NON_GREEN_FROM) return spec;
  const wait = CYCLE - posAt(arrive);
  if (wait <= STRAIGHT_LEAD_WAIT) return spec;

  /*
    녹색이 `arrive + STRAIGHT_LEAD_WAIT` 초에 켜지도록 출발 자리를 역산한다.
    **출발은 여전히 녹색이 아닌 구간이어야 한다** — 이 판들의 제목과 설명이 "정면신호 적색"
    이라서다. 앞차가 늦게 닿는 판(보호구역)에서 역산한 자리가 녹색으로 넘어가면 황색 첫머리로
    붙잡는다. 그때는 조금 더 기다리지만 판이 글과 다른 것을 보여 주지는 않는다.
  */
  const greenAt = arrive + STRAIGHT_LEAD_WAIT;
  let start = (((CYCLE - greenAt) % CYCLE) + CYCLE) % CYCLE;
  if (start < NON_GREEN_FROM) start = NON_GREEN_FROM;

  let phase = STANDARD_PROGRAM.length - 1;
  for (let i = 0; i < STANDARD_PROGRAM.length; i++) {
    if (start < phaseOffset(i) + STANDARD_PROGRAM[i].duration) {
      phase = i;
      break;
    }
  }
  return { ...spec, startPhase: phase, startPhaseElapsed: start - phaseOffset(phase) };
}

/**
 * 적색 화살표 앞에서 **이보다 오래 서 있어야 하는 판은 주지 않는다** (초).
 * 검증기(validate.ts)가 이 값으로 반려하고, `fitRightArrowStart` 가 이 값 안으로 맞춘다.
 */
export const MAX_ARROW_WAIT = 25;

/**
 * **진입로 보호구역을 지나 교차로에 닿기까지 더 걸리는 시간** (초) — 규정대로 몰 때(난이도 1), 진입로 보호구역이 없는
 * 판보다 첫 횡단보도에 이만큼 늦게 닿는다 (106m 뒤에서 출발 + 보호구역 횡단보도 앞 정지).
 *
 * 라이브러리가 교차로 신호의 출발 자리를 이만큼 앞당겨, 교차로에 닿을 때의 신호를 진입로 보호구역이 없는 판과 같게
 * 맞춘다. 검증기는 녹색 화살표까지의 기다림을 잴 때 이만큼을 빼고 잰다 — 그동안 차는 아직 교차로에 없다.
 *
 * 예전에는 12초 하나였다. 보호구역 신호가 녹색일 때 지나가는 경우만 셈한 값이라, 적색에 서서 기다린 판은 교차로에
 * 8초 넘게 늦게 닿아 보행신호가 바뀌어 있었다 — 건너려던 사람이 뜻을 접고 서 있기만 했다 (플레이테스트가 잡았다).
 * 값은 playSim.ts 로 실제 차를 달려 잰 것이다.
 *
 * 횡단보도 S 를 20m 뒤로 옮길 때(S 와 A 가 한 덩어리로 보인다 — layout.ts) 다시 쟀다. 세 경우 모두 **2.6초씩**
 * 늘었다 — S 에서 A 까지 늘어난 20m 를 30km/h 로 가는 시간이다. 교차로에서 서지 않는 판(정면 녹색 · 사람 없음)의
 * 완주 시각을 진입로 보호구역이 없는 같은 판과 견줘 잰다. 이 값이 어긋나면 교차로 신호가 판이 뜻한 것과 달라진다.
 */
export const APPROACH_EXTRA: Record<'signal' | 'signalGreen' | 'noSignal', number> = {
  // 보호구역 신호가 적색이라 6초쯤 서서 기다린다 (APPROACH_SIGNAL_ELAPSED)
  signal: 21.0,
  // 보호구역 신호가 녹색이라 서지 않고 지난다 (앞차가 있는 판)
  signalGreen: 14.4,
  // 신호기가 없어 한 번 일시정지하고 간다
  noSignal: 16.4,
};

/**
 * **진입로 보호구역 신호기의 출발 자리** (초, SCHOOL_ZONE_PROGRAM 안) — 차가 닿을 때 적색이고, 17.5초에 녹색이 된다.
 *
 * 예전에는 판마다 아무 자리(0~39초)에서 출발시켰다. 그러면 절반 넘는 판에서 차가 닿을 때 이미 녹색이라, 판이
 * 가르친다는 "보호구역 신호 횡단보도 적색에서는 녹색까지 기다린다" 가 한 번도 일어나지 않았다 — 막 모는 사람도
 * 보호구역 신호 위반으로 걸리지 않았다. 차는 11~12초에 정지선에 닿으므로(난이도 5 는 10.7초) 6~7초를 서서 기다린다.
 */
export const APPROACH_SIGNAL_ELAPSED = 21.5;

/** 녹색 화살표가 켜지는 구간 — 한 주기에 2번 구간 하나뿐이다 */
const GREEN_ARROW_PHASE = STANDARD_PROGRAM.findIndex((p) => p.rightArrow === 'greenArrow');

/**
 * **우회전 신호등이 달린 판을 녹색 구간에서 출발시킨다.**
 *
 * 우회전 신호등은 정면 신호를 대체하므로, 정면 적색(4·5번 구간)에서 출발하면 녹색 화살표까지
 * 47초를 서 있어야 한다 — 검증기가 반려한다. 프롬프트에 "0~2번에서 출발" 이라고 적고 반려
 * 사유까지 돌려줘도, 약점이 `RIGHT_ARROW_RED` 인 학습자의 판에서 모델은 **세 번 내리
 * 4번을 골랐다** (습관이 "적색" 이라 적색 판을 만들려 한다). 그 판은 끝내 만들어지지 않아
 * L9 에서 "쓸 만한 판을 만들지 못했습니다" 로 메뉴로 돌아갔다.
 *
 * 값은 확실히 정할 수 있으므로 모델을 기다리지 않고 여기서 맞춘다 (`fitStraightLeadWait` 와 같다):
 *
 *  - 0번 구간 첫머리에서 출발 — 정면은 녹색이지만 **화살표는 적색**이고 C 보행자는 녹색이다.
 *    학습자는 "정면이 녹색이니 돌아도 되겠지" 를 이겨 내야 한다 — 이 약점이 묻는 바로 그 판단이다.
 *    녹색 화살표는 20초 뒤에 켜진다.
 *  - 횡단보도 C 에 보행신호기를 단다 — 화살표와 C 보행신호를 맞물리게 하는 것이 설치 이유다.
 *  - 제목의 `정면신호 적색` 을 `우회전신호 적색` 으로 바꾼다 — 출발 때 적색인 것은 화살표다.
 */
export function fitRightArrowStart(spec: ScenarioSpec): ScenarioSpec {
  if (!spec.rightArrowInstalled) return spec;
  const pos0 = (phaseOffset(spec.startPhase) + spec.startPhaseElapsed) % CYCLE;
  const greenFrom = phaseOffset(GREEN_ARROW_PHASE);
  const greenTo = greenFrom + STANDARD_PROGRAM[GREEN_ARROW_PHASE].duration;
  const wait = pos0 < greenTo ? Math.max(0, greenFrom - pos0) : CYCLE - pos0 + greenFrom;
  if (wait <= MAX_ARROW_WAIT) return spec;

  return {
    ...spec,
    startPhase: 0,
    startPhaseElapsed: 0,
    pedSignalInstalled: { ...spec.pedSignalInstalled, C: true },
    title: spec.title.replace(/^정면\s*신호\s*적색/, '우회전신호 적색'),
  };
}

/**
 * 직진 앞차가 **정지선에 서는 시각** (초). 끝내 서지 않으면 `null`.
 *
 * 적색이 계속된다고 치고 앞차만 굴려 본다 — 게임·검증기와 같은 상태기계다.
 * 길이는 검증기와 같이 가장 긴 차로 잰다 (LEAD_HALF_LENGTH_MAX).
 */
function straightLeadArrival(spec: ScenarioSpec): number | null {
  if (!spec.leadCar) return null;
  const lead = new LeadDrive(spec.leadCar, {
    playerSpawnZ: spawnZ(spec),
    playerHalfLength: CAR_HALF_LENGTH,
    halfLength: LEAD_HALF_LENGTH_MAX,
    isSchoolZone: spec.isSchoolZone,
    hasApproachZone: spec.approachSchoolZone !== undefined,
  });
  const zone = spec.approachSchoolZone
    ? { light: spec.approachSchoolZone.signal ? ('green' as const) : null }
    : null;
  const dt = 1 / 60;
  for (let t = 0; t < 60; t += dt) {
    lead.update(dt, {
      vehicleLight: 'red',
      rightArrow: null,
      pedSignal: { A: null, C: null, S: null },
      approachZone: zone,
      pedestrians: [],
      exitBlocked: false,
      isSchoolZone: spec.isSchoolZone,
    });
    // 보호구역 횡단보도에서 잠깐 서는 것과 가른다 — 교차로 정지선 가까이에서 선 것만 센다
    if (lead.speedKmh < 0.2 && lead.pose().front.z < STOP_LINE + 3) return t;
  }
  return null;
}

/**
 * 어린이보호구역이 나오는 비율 — **네 판에 한 판.**
 *
 * 늘 나오면 학습자는 "이 게임은 늘 한 번 더 선다" 를 익힌다. 그것은 규정이 아니라 이
 * 게임의 버릇이고, 버릇으로 익힌 것은 보호구역이 없는 길에서도 그대로 나온다.
 * 늘 없으면 배울 일이 없다. **네 판에 한 판**이면 매번 표지판과 노면을 보게 된다.
 *
 * AI 우회전 주행도 같은 비율을 쓴다 (generate.ts 의 `Plan.schoolZone`). 그쪽은 예전에
 * 이 값과 무관하게 **늘** 보호구역이 나왔다 — 학습자의 약점이 보호구역이면 그 조건이
 * 공짜 묶음(difficulty.ts 의 `TARGET_KIT`)에 들어가 프롬프트가 "반드시 켜십시오" 라고
 * 시켰기 때문이다. 약점을 시험하는 것은 맞지만, 네 판 내리 같은 판이면 그 판이
 * 가르치는 것은 보호구역이 아니라 **이 게임의 순서**가 된다.
 */
export const SCHOOL_ZONE_CHANCE = 0.25;

/** 이번 판이 보호구역을 낼 차례인가 — 판을 만들기 전에 한 번 굴린다 */
export const rollSchoolZoneTurn = (): boolean => Math.random() < SCHOOL_ZONE_CHANCE;
/** 나왔을 때 **신호기가 없을** 확률. 없는 쪽이 이 게임이 가르치려는 자리다 */
const APPROACH_ZONE_NO_SIGNAL_CHANCE = 0.55;

/**
 * 보호구역이 나올 차례일 때 **신호기 없는 횡단보도**가 나올 확률.
 *
 * 이 게임이 교정하려는 핵심이 제27조 제7항 — **신호기 없는 보호구역 횡단보도는 보행자가 없어도
 * 일시정지** 다. 그런데 고르는 쪽에는 신호기 유무를 가리는 자가 하나도 없었다: 보호구역 차례 판정이
 * `zone === 'yes' || approach !== 'none'` 불리언 하나뿐이고(recommend.ts 의 `inZone`), 되풀이 감점
 * 축에도 보호구역이 없었다. 라이브러리 자체는 무신호 53% · 신호 47% 로 거의 반반인데도
 * **신호 있는 보호구역이 자주 나왔다** (사용자: "어린이보호구역에서 신호없는 횡단보도가 핵심인데
 * 신호있는 어린이보호구역 횡단보도가 많이 나왔어").
 *
 * **1 로 두지 않는다.** 신호 있는 보호구역도 가르치는 것이 있다 — 진입로 보호구역 신호 횡단보도는
 * `SCHOOL_ZONE_RED`(적색이면 녹색까지 기다린다)를 시험하는 **유일한** 판이고, 교차로 보호구역 신호 판은
 * "신호가 있어도 보행자가 먼저" 를 가르친다. 무신호만 나오면 학습자가 "보호구역 = 무조건 선다" 를 외워
 * 신호 있는 보호구역에서 잘못 판단한다. 비율은 **여러 판에 걸쳐 나타나는 성질**이라 보호구역 · 앞차와
 * 같이 우리가 굴린다 (모델이 판 하나를 보고 맞출 수 있는 것이 아니다).
 */
export const ZONE_NO_SIGNAL_CHANCE = 0.65;

/** 보호구역 차례일 때 **신호기 없는 쪽인가** — 판을 고르기 전에 굴린다 (위 ZONE_NO_SIGNAL_CHANCE) */
export const rollZoneNoSignalTurn = (): boolean => Math.random() < ZONE_NO_SIGNAL_CHANCE;

/**
 * **오는 길에 어린이보호구역을 확률적으로 놓는다.**
 *
 * ## 왜 확률인가
 *
 * 보호구역이 늘 있으면 학습자는 "이 게임은 늘 한 번 더 선다" 를 익힌다. 그것은
 * 규정이 아니라 이 게임의 버릇이다. 늘 없으면 배울 일이 없다. **있을 수도 없을 수도**
 * 있어야 매번 표지판과 노면을 보고 판단하게 된다 — `chance` 보행자를 두는 것과 같은 사고다.
 *
 * ## 판이 이미 정했으면 건드리지 않는다
 *
 * `approachSchoolZone` 이 적혀 있으면 그대로 둔다. 손으로 쓴 판과 AI 가 만든 판은
 * 그 구간을 **의도해서** 넣은 것이라(AI 는 예산을 치르고 샀다) 여기서 굴려 없애면
 * 판이 가르치려던 것이 사라진다. 굴리는 것은 **아무 말도 없는 판**뿐이다.
 */
export function rollApproachZone(spec: ScenarioSpec): ScenarioSpec {
  if (spec.approachSchoolZone !== undefined) return spec;
  /*
    **AI 가 만든 판은 굴리지 않는다.** 그쪽은 판을 만들기 전에 이미 차례를 정했고
    (generate.ts 의 `Plan.schoolZone`), 여기서 또 굴리면 "이번 판에는 없다" 고 정해 놓고
    없는 판에 다시 얹는 셈이 된다 — 네 판에 한 판이라는 약속이 그만큼 깨진다.
  */
  if (spec.id >= GENERATED_ID_BASE) return spec;
  if (!rollSchoolZoneTurn()) return spec;
  return {
    ...spec,
    approachSchoolZone: {
      signal: Math.random() >= APPROACH_ZONE_NO_SIGNAL_CHANCE,
      /* 주기 어디에서 만날지도 굴린다 — 늘 같은 등화면 신호를 볼 이유가 없다 */
      signalElapsed: Math.random() * SCHOOL_ZONE_CYCLE,
    },
  };
}

/**
 * **앞차가 나오는 비율 — 세 판에 한 판.**
 *
 * 보호구역(`SCHOOL_ZONE_CHANCE`)과 같은 사고다. 늘 앞차가 있으면 학습자가 익히는 것은
 * 규정이 아니라 "이 게임에는 늘 앞차가 있다" 가 되고, 정작 앞차가 없는 판에서 무엇을 보고
 * 판단해야 하는지가 흐려진다. 반대로 없으면 배울 일이 없다.
 *
 * 처음에는 이 비율을 **모델에게 맡겼다.** 프롬프트에 앞차를 설명하자 모델은 거의 모든 판에
 * 앞차를 넣었고 그중 대부분이 우회전이었다 — 비율은 여러 판에 걸쳐 나타나는 성질이라
 * 판 하나만 보고 만드는 모델이 맞출 수 있는 것이 아니다. **판마다 우리가 굴린다.**
 */
export const LEAD_CAR_CHANCE = 1 / 3;

/** 앞차가 나올 때 **어떤 앞차인가** — scenarios.ts 가 굴리고 프롬프트가 그대로 지시한다 */
export type LeadPlan = 'straight' | 'rolling' | 'lawful';

/**
 * 앞차 종류의 비율.
 *
 * **직진 대기가 가장 많다.** 실제 도로에서 우회전을 막는 것은 대부분 직진 대기 차량이고,
 * 이 셋 중 유일하게 "내가 규정을 지켜도 갈 수 없는" 상황이라 배울 것이 가장 많다.
 * 규정대로 우회전하는 앞차가 가장 적은 이유는 그 판이 앞차 없는 판과 가장 비슷하기 때문이다.
 */
const LEAD_KINDS: readonly { kind: LeadPlan; weight: number }[] = [
  { kind: 'straight', weight: 0.45 },
  { kind: 'rolling', weight: 0.35 },
  { kind: 'lawful', weight: 0.2 },
];

/** 이번 판에 앞차를 낼 차례인가 · 낸다면 어떤 앞차인가. 차례가 아니면 `null` */
export function rollLeadTurn(): LeadPlan | null {
  if (Math.random() >= LEAD_CAR_CHANCE) return null;
  let r = Math.random();
  for (const k of LEAD_KINDS) {
    if (r < k.weight) return k.kind;
    r -= k.weight;
  }
  return LEAD_KINDS[LEAD_KINDS.length - 1].kind;
}

/** 굴려 나온 앞차를 시나리오에 적을 값으로 옮긴다 */
export const leadSpecFor = (kind: LeadPlan, headway?: number): LeadCarSpec => ({
  behavior: kind === 'rolling' ? 'rolling' : 'lawful',
  path: kind === 'straight' ? 'straight' : 'right',
  ...(headway === undefined ? {} : { headway }),
});

/** 이 판의 앞차가 어느 종류인가 — 없으면 `null` */
export const leadPlanOf = (s: ScenarioSpec): LeadPlan | null =>
  !s.leadCar ? null : s.leadCar.path === 'straight' ? 'straight' : s.leadCar.behavior === 'rolling' ? 'rolling' : 'lawful';

/** `chance` 가 붙은 보행자를 그 확률로 남긴다 (PedSpawn.chance 주석 참고) */
export function rollPedestrians(list: PedSpawn[]): PedSpawn[] {
  return list.filter((p) => p.chance === undefined || Math.random() < p.chance);
}

/** 08번(조건 무작위) 전용 — 매 플레이마다 조건을 새로 뽑는다. */
export function randomizeScenario(base: ScenarioSpec): ScenarioSpec {
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  /*
    **보호구역은 여기서도 네 판에 한 판이다** (`SCHOOL_ZONE_CHANCE`).

    예전에는 교차로(0.2)와 진입부(0.35)를 **따로** 굴렸다. 둘 중 하나라도 걸릴 확률이
    절반에 가까워, 08번만 보호구역이 흔한 판이 됐다. 한 번 굴리고 **나온 판에서만**
    어느 쪽인지 정한다 — 둘이 겹치지도 않는다.

    08번은 조건을 통째로 뽑는 판이라 보호구역도 여기서 정한다.
    prepareScenario 가 다시 굴리지 않도록 **반드시 값을 넣는다**(undefined 로 두지 않는다).
  */
  const zoneTurn = rollSchoolZoneTurn();
  const isSchoolZone = zoneTurn && Math.random() < 0.4;
  const approachSchoolZone =
    zoneTurn && !isSchoolZone
      ? { signal: Math.random() < 0.45, signalElapsed: Math.random() * SCHOOL_ZONE_CYCLE }
      : undefined;
  // 인덱스: 0 남북 보행 · 3 남북 황색 · 5 동서 직진 (남북 직진을 셋으로 쪼개며 밀렸다)
  const startPhase = pick([0, 0, 5, 5, 3]);
  const pedCount = Math.floor(Math.random() * 4);
  const pedestrians: PedSpawn[] = [];
  for (let i = 0; i < pedCount; i++) {
    pedestrians.push({
      crosswalk: Math.random() < 0.75 ? 'C' : 'A',
      at: 0,
      // 12~26m — 어떤 사람은 내가 정지선에 닿기 전에, 어떤 사람은 코너를 돌 때 나선다
      startWithin: 12 + Math.random() * 14,
      from: Math.random() < 0.5 ? 'left' : 'right',
      obeysSignal: Math.random() < 0.6,
      kind: pick(['adult', 'adult', 'child', 'elder'] as const),
    });
  }

  /* **앞차도 가끔 나온다** — 비율과 종류는 손으로 쓴 판·AI 판과 같은 곳에서 굴린다 (rollLeadTurn) */
  const leadCar = ((): ScenarioSpec['leadCar'] => {
    const kind = rollLeadTurn();
    if (!kind) return undefined;
    const headway = 1.6 + Math.random() * 1.2;
    /*
      **정면 녹색이면 늘 규정대로 우회전하는 앞차다.** 녹색에는 건너뛸 일시정지도,
      기다릴 이유도 없어 세 종류가 같은 차가 된다 — 굴려 봐야 화면은 똑같다.
    */
    return leadSpecFor(startPhase >= 3 ? kind : 'lawful', headway);
  })();

  return {
    ...base,
    isSchoolZone,
    approachSchoolZone,
    leadCar,
    startPhase,
    startPhaseElapsed: Math.random() * 4,
    pedSignalInstalled: { A: true, C: !isSchoolZone },
    pedestrians,
    crossTraffic: 1 + Math.floor(Math.random() * 4),
    exitBlocked: Math.random() < 0.15,
    timeOfDay: pick(['day', 'dusk', 'night'] as const),
    weather: Math.random() < 0.35 ? 'rain' : 'clear',
  };
}

/** 신호 프로그램에서 경과 시간에 해당하는 페이즈를 찾는다. */
/**
 * 이 판이 시작하는 자리 (z).
 *
 * **진입부 보호구역이 있으면 뒤로 물린다.** 평소 스폰(68)에서는 정지선 S(52)까지
 * 16m 뿐이라 30km/h 로 달려오면 2초 만에 닿는다 — 보고 판단할 틈이 없다.
 * 92 로 물리면 40m · 약 4.8초가 되고, 거기서 다시 정지선 A 까지 25m 가 남아
 * **두 번의 정지가 각각 서 있는 판**이 된다 (layout.ts 의 그림 참고).
 *
 * 게임(Game.spawnInfo) · 검증기(validate.ts) · 시뮬레이터(driveSim.ts)가 **모두 이
 * 함수를 쓴다.** 세 곳이 각자 정하면 검증이 통과한 판이 실제로는 다른 자리에서 시작하고,
 * 그 어긋남은 아무도 눈치채지 못한다.
 */
export const spawnZ = (spec: Pick<ScenarioSpec, 'approachSchoolZone'>): number =>
  spec.approachSchoolZone ? SPAWN_Z_SCHOOL_ZONE : SPAWN_Z;

export function phaseAt<T extends { duration: number }>(
  program: readonly T[],
  startPhase: number,
  startElapsed: number,
  t: number,
): T {
  const cycle = program.reduce((sum, p) => sum + p.duration, 0);
  // 시작 페이즈의 시작 지점까지의 누적 시간
  let offset = 0;
  for (let i = 0; i < startPhase; i++) offset += program[i].duration;
  let cursor = (offset + startElapsed + t) % cycle;
  for (const phase of program) {
    if (cursor < phase.duration) return phase;
    cursor -= phase.duration;
  }
  return program[program.length - 1];
}
