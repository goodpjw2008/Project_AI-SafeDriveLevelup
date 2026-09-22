/**
 * **난이도 설정 (1~5)** — 코스 · 주행 · 진급을 얼마나 어렵게 하는가.
 *
 * 레벨은 "무엇을 배웠는가"(library.ts 의 levelOf)이고, 이 설정은 "그것을 얼마나 어렵게" 다. 네 곳을 함께 조인다.
 *
 * 1. **코스** — 같은 레벨 안에서 AI 가 얼마나 복잡한 판을 고르는가, 몇 레벨 위 개념까지 섞는가
 * 2. **도움** — 주행 중 AI 우회전 말풍선 · 보행자 느낌표 · 정지 구역 노면 표시 (`hints`)
 * 3. **주행** — 교차로에 다가가는 속도와 브레이크, 정지선 앞 어디까지를 "정지선 앞 정지" 로 치는가 (`pace` · `stopZone`)
 * 4. **경험치** — 레벨업에 필요한 경험치의 배율, 위반한 판에서 잃는 경험치 (`xpScale` · `missPenalty`, curriculum.ts)
 *
 * ## 코스만 어렵게 해서는 쉬웠다
 *
 * 처음에는 1(코스)만 조였다. 가장 어렵게 해도 쉬웠던 이유는 셋이다 — 로봇이 "정지선까지 5m · 보행자가 건너려 합니다" 를
 * 먼저 말해 줘 따라 하기만 하면 됐고(도움), 교차로 앞에서 차가 12km/h 로 알아서 느려져 코앞에서 눌러도 섰고(주행),
 * 무위반 한 판이면 한 레벨이 올라 열 판 남짓이면 마스터였다(진급 — 지금은 경험치 곡선이다). 그래서 넷을 함께 조인다.
 *
 * **판정 규칙은 난이도와 상관없이 같다** — 무엇이 위반인지는 법이 정한다. 난이도는 판단할 시간과 도움의 양,
 * 그리고 증명해야 할 판 수만 바꾼다. 가장 느슨한 값(1)이 예전 동작 그대로다.
 *
 * 값은 설정 화면에서 고르고 저장본(settings.difficulty)에 남는다. 기본은 3.
 */

export type Challenge = 1 | 2 | 3 | 4 | 5;

export const DEFAULT_CHALLENGE: Challenge = 3;

/**
 * **교차로에 다가가는 속도와 브레이크** (game/Vehicle.ts).
 *
 * 이 게임은 속도를 자동으로 몰고 사람은 "언제 설 것인가" 만 정한다. 그래서 어려움은 **판단할 시간**에서 나온다 —
 * 빨리 다가갈수록, 브레이크가 무를수록 멀리서 미리 보고 눌러야 정지선 앞에 선다.
 *
 * 서행 속도는 어느 난이도든 **서행 판정 상한(20km/h, lawRules.ts 의 SLOW_DOWN_LIMIT_KMH) 아래**다 —
 * 차가 알아서 모는 속도가 위반이 되면 안 된다. 보호구역에서는 여전히 30km/h 로 묶인다.
 */
export interface DrivePace {
  /** 교차로 · 횡단보도 부근 서행 속도 (km/h) */
  slowKmh: number;
  /** 교차로 접근 구간 속도 (km/h) */
  approachKmh: number;
  /** 정지를 눌렀을 때의 감속도 (m/s²) */
  brakeDecel: number;
}

export interface ChallengeRule {
  id: Challenge;
  name: string;
  /** 설정 화면의 한 줄 설명 */
  desc: string;
  /**
   * 같은 레벨 안에서 **조건이 많은 판을 얼마나 좋게 치는가** (recommend.ts 의 scoreOf).
   * 음수면 단순한 판을, 양수면 복잡한 판을 먼저 고른다.
   */
  complexity: number;
  /**
   * 복잡함을 **어디까지** 좋게 치는가 (조건 점수 상한). 보통은 적당히 복잡한 판에서 멈추고, 어려움은 끝까지 간다 —
   * 같은 상한이면 레벨이 높을 때 보통과 어려움이 똑같이 가장 복잡한 판을 골랐다.
   */
  cap: number;
  /**
   * 있으면 **이 복잡함(조건 점수)에 가까운 판**을 좋게 친다 — "중간" 을 노릴 때 쓴다.
   * 조건 점수는 가운데가 비어 있어(보행자 한 명이 멀리서 건너면 1점 안팎, 코앞에서 대기하면 8점 안팎)
   * 기울기만으로는 쉬움 아니면 보통 쪽으로 쏠렸다.
   */
  target?: number;
  /**
   * 보행자도 조건도 없는 판을 몸풀기로만 남기는가 (그런 판에 벌점). **쉬움에서도 켠다** — 끄자 쉬운 쪽이
   * 보행자 없는 판만 골라, 우회전에서 판단할 것 자체가 없어졌다.
   */
  skipEmpty: boolean;
  /** 이 레벨보다 몇 레벨 위의 개념까지 섞는가 */
  reach: number;
  /**
   * **주행 중 도움을 얼마나 주는가.** 코스를 어렵게 골라도 AI 우회전이 "정지선까지 5m · 보행자가 건너려 합니다"
   * 를 말해 주고 보행자 머리 위에 느낌표가 뜨면, 운전자는 판단하지 않고 따라 하기만 한다.
   * - `full`: 로봇 말풍선(할 일 · 정지선 거리 · 보행자/앞차 알림) + 보행자 느낌표 + 정지 구역 노면 표시
   * - `less`: 로봇은 할 일 한마디만 (거리 · 보행자/앞차 알림 없음), 느낌표 · 노면 표시는 남김
   * - `none`: 로봇도 느낌표도 노면 표시도 없다 — 신호와 보행자를 직접 보고 판단
   */
  hints: 'full' | 'less' | 'none';
  /** 교차로에 다가가는 속도와 브레이크 (위 DrivePace) */
  pace: DrivePace;
  /**
   * **정지선 앞 몇 m 안에서 서야 "정지선 앞 정지" 로 치는가** (lawRules.ts 의 STOP_ZONE_DEPTH).
   * 좁을수록 한참 전에 서 버리는 것으로는 안 되고, 정지선에 붙여 서야 한다 — 법이 말하는 자리도 정지선 **직전**이다.
   */
  stopZone: number;
  /**
   * 레벨업(L10 은 마스터)에 필요한 경험치에 곱하는 값 (curriculum.ts 의 XP_TO_NEXT · xpToNext).
   * 보통(1)이 새 맵 무위반 32판, 쉬움(0.5)은 그 절반(다만 레벨마다 두 판 아래로는 안 내려간다), 어려움(1.5)은 한 배 반이다.
   */
  xpScale: number;
  /** 위반한 판에서 잃는 경험치 — 사고 · 이탈 · 위반 3개 이상은 두 배 (레벨은 내려가지 않는다) */
  missPenalty: number;
}

export const CHALLENGES: readonly ChallengeRule[] = [
  {
    id: 1,
    name: '쉬움',
    desc: '중간 정도로 복잡한 코스 · 도움 전부 · 경험치 절반만 모으면 레벨업',
    complexity: 0,
    cap: 20,
    target: 5,
    skipEmpty: true,
    reach: 0,
    hints: 'full',
    pace: { slowKmh: 12, approachKmh: 25, brakeDecel: 4.8 },
    stopZone: 12,
    xpScale: 0.5,
    missPenalty: 0,
  },
  {
    id: 2,
    name: '조금 쉬움',
    desc: '판단할 것이 많은 코스 · 조금 빠르게 · 경험치 ×0.75',
    complexity: 0.25,
    cap: 8,
    skipEmpty: true,
    reach: 0,
    hints: 'full',
    pace: { slowKmh: 13, approachKmh: 26, brakeDecel: 4.5 },
    stopZone: 12,
    xpScale: 0.75,
    missPenalty: 0,
  },
  {
    id: 3,
    name: '보통',
    desc: '조건이 겹친 코스 · AI 우회전은 할 일만 · 위반하면 경험치 −20',
    complexity: 0.45,
    cap: 12,
    skipEmpty: true,
    reach: 0,
    hints: 'less',
    pace: { slowKmh: 14, approachKmh: 28, brakeDecel: 4.2 },
    stopZone: 12,
    xpScale: 1,
    missPenalty: 20,
  },
  {
    id: 4,
    name: '조금 어려움',
    desc: '복잡한 코스 + 한 레벨 위 · 도움 없음 · 정지선 9m 안 · 경험치 ×1.25 · 위반 −40',
    complexity: 0.7,
    cap: 20,
    skipEmpty: true,
    reach: 1,
    hints: 'none',
    pace: { slowKmh: 15, approachKmh: 30, brakeDecel: 3.8 },
    stopZone: 9,
    xpScale: 1.25,
    missPenalty: 40,
  },
  {
    id: 5,
    name: '어려움',
    desc: '가장 복잡한 코스 + 두 레벨 위 · 도움 없음 · 정지선 8m 안 · 경험치 ×1.5 · 위반 −60',
    complexity: 0.9,
    cap: 20,
    skipEmpty: true,
    reach: 2,
    hints: 'none',
    pace: { slowKmh: 16, approachKmh: 32, brakeDecel: 3.4 },
    /*
      **8m 가 바닥이다.** 16km/h 에서 반응 1초(4.4m) + 제동(2.9m) 이 7.3m 라, 7m 로 두면 보고 눌러서는
      설 수 없었다 (tests/challenge.test.ts 가 잡았다) — 어려운 것이 아니라 불가능한 것이 된다.
    */
    stopZone: 8,
    xpScale: 1.5,
    missPenalty: 60,
  },
];

export const challengeRule = (c: number | undefined): ChallengeRule =>
  CHALLENGES.find((r) => r.id === c) ?? CHALLENGES[DEFAULT_CHALLENGE - 1];
