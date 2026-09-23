/**
 * AI 주행의 **커리큘럼** — 쉬운 판에서 시작해 마스터까지 데려간다.
 *
 * ## 왜 난이도를 코드가 정하는가
 *
 * "쉽게 만들어 주세요" 를 모델에게 맡기면 쉬운 판이 나오지 않는다. 모델에게 쉬움과
 * 어려움은 말일 뿐이고, 이 게임에서 그것을 가르는 것은 **조건의 조합**이기 때문이다 —
 * 어린이보호구역인가, 보행신호기가 있는가, 보행자가 몇 명인가, 밤인가.
 *
 * 그래서 단계마다 **무엇을 넣어도 되는지**를 여기서 못 박고, 모델은 그 안에서만 만든다.
 * 만들어진 판이 정말 그 단계에 맞는지도 다시 잰다(`checkDifficulty`) — 1단계라고 해 놓고
 * 어린이보호구역에 보행자 셋을 넣은 판이 오면 되돌려보낸다.
 *
 * ## 진급과 강등
 *
 * 이 게임은 겨루는 물건이 아니므로 **떨어뜨리는 것이 목적이 아니다.** 위반이 나면 같은
 * 단계에 한 번 더 머물고, 두 번 이어서 틀렸을 때만 한 단계 내린다 — 어려워서 못 하는
 * 것과 한 번 실수한 것은 다르다.
 *
 * ## 마스터
 *
 * **최고 단계에서 연속 3판 무위반.** 한 판으로는 운이 섞이고, 다섯 판은 지친다.
 * 3판이면 "우연히 됐다" 를 걷어내면서 끝이 보인다.
 */

import {
  primaryHabit,
  updateHabits,
  type BadHabit,
  type HabitChange,
} from '../coach/badHabits';
import type { ViolationCode } from '../rules/violations';
import type { JudgeResult } from '../rules/lawRules';
import type { ScenarioSpec } from './scenarios';
import {
  checkBudget,
  hasCondition,
  trimToBudget,
  type ConditionKey,
} from './difficulty';

/** 1이 가장 쉽고 10이 가장 어렵다 */
export type Difficulty = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const MAX_LEVEL: Difficulty = 10;

/**
 * **경험치(XP)** — 레벨은 경험치가 차야 오른다.
 *
 * 예전에는 무위반 한 판이면 한 레벨이 올라 열 판 남짓이면 L10 이었다. 사용자가 짚었다 — "게임들도 보면 1~3레벨까지는
 * 쉽게 올라가다가 고렙이 될수록 경험치가 많아야 레벨이 올라가." 그래서 경험치 곡선을 둔다. 낮은 레벨은 한 판이면
 * 오르고, 높은 레벨일수록 오래 머물며 여러 상황을 겪은 뒤에 오른다. 라이브러리의 레벨별 판 수도 이 곡선을 따른다
 * (library.ts 의 LEVEL_SHARE — 오래 머무는 레벨일수록 판이 많아야 같은 판을 되풀이하지 않는다).
 */
/** 무위반으로 통과한 판 하나의 경험치 — **처음 통과하는 맵**이다 */
export const XP_PER_CLEAN_RUN = 100;
/**
 * **이미 무위반으로 통과한 맵을 다시 통과했을 때** — 절반이다.
 *
 * 결과 화면의 '다시 운행' 은 같은 맵을 곧바로 다시 달린다. 한 번 통과한 맵은 어디서 서고 누가 나오는지를 이미 안다 —
 * 그 맵을 되풀이해 경험치를 채우면 레벨이 오르는 동안 새 상황을 하나도 만나지 않는다. 그렇다고 0 으로 두면 틀린 판을
 * 다시 달려 고치는 것(이건 권할 일이다)과 구분이 안 된다 — 틀린 맵을 처음 통과하면 100 을 다 받는다.
 */
export const XP_REPLAY = 50;
/** 나쁜 운전 습관 하나를 고친 판에 더 얹는 경험치 — 고친 것이 곧 보상이다 */
export const XP_HABIT_FIXED = 50;
/**
 * **다음 레벨까지 필요한 경험치** (난이도 3 '보통' 기준). L10 은 안전운전 마스터까지다.
 * 새 맵 무위반 한 판이 100 이라, 이 값 ÷ 100 이 그 레벨에 머무는 판 수다 — **2 · 2 · 3 · 3 · 3 · 3 · 4 · 4 · 4 · 4판(모두 32판).**
 *
 * ## 사용자가 정한 곡선이다
 *
 * 2026-09-22 에 사용자가 7레벨까지 달려 보고 말했다 — "레벨이 너무 늦게 오르니까 흥미가 떨어진다. 1~3까지는 2판만 깨면
 * 되고 3~7까지는 3판만 깨면 되고 7에서 10은 4판만 깨면 레벨이 올라가도록" (L1→L2 · L2→L3 은 2판, L3→L4 … L6→L7 은
 * 3판, L7→L8 … L9→L10 과 L10→마스터는 4판). 그 전 곡선은 3 · 3 · 4 · 4 · 5 · 5 · 6 · 7 · 8 · 10판(55판)이라
 * 높은 레벨에서 한 레벨에 여덟 판 · 열 판을 머물렀다.
 *
 * **감점은 그대로다** — 위반하면 난이도가 정한 만큼 잃고(보통 −20, 사고 · 이탈 · 위반 3개 이상은 두 배), 나쁜 습관이
 * 남아 있으면 막대가 차도 오르지 않는다 (아래 advance). 판 수가 줄어든 만큼 한 번의 위반이 막대에서 차지하는 몫은 커진다.
 *
 * ## 어느 레벨도 한 판으로는 오르지 않는다
 *
 * 한때 L1~L3 이 무위반 한 판이면 올랐다. 사용자가 짚었다 — "1판만 했는데 레벨 2로 올라갔어 … 저랩에서 너무 쉽게
 * 레벨이 올라가는 것 같아." 한 판은 운일 수 있다(보행자가 마침 안 나왔거나 신호가 마침 맞았다). 그래서 가장 낮은
 * 레벨도 두 판이고, 쉬운 난이도로 곡선을 줄여도 두 판 아래로는 내려가지 않는다 (xpToNext 의 바닥).
 */
export const XP_TO_NEXT: Readonly<Record<Difficulty, number>> = {
  1: 200,
  2: 200,
  3: 300,
  4: 300,
  5: 300,
  6: 300,
  7: 400,
  8: 400,
  9: 400,
  10: 400,
};

/**
 * **경험치 규칙** — 난이도 설정이 정한다 (challenge.ts 의 ChallengeRule 이 이 모양을 그대로 갖는다).
 */
export interface ProgressRule {
  /** 필요한 경험치에 곱하는 값 — 어려울수록 크다 */
  xpScale: number;
  /** 위반한 판에서 잃는 경험치 (사고 · 이탈 · 한 판 위반 3개 이상은 두 배). 0 이하로는 내려가지 않는다 */
  missPenalty: number;
}

/** 난이도 설정이 없을 때 — 보통(3)과 같은 곡선, 틀려도 경험치를 잃지 않는다 */
export const DEFAULT_PROGRESS: ProgressRule = { xpScale: 1, missPenalty: 0 };

/**
 * **가장 적게 드는 경험치** — 새 맵 무위반 두 판(한 판 100 으로는 모자라는 150).
 * 쉬움(×0.5)이면 L1 이 100 이 되어 한 판에 올랐다 — 위 "어느 레벨도 한 판으로는 오르지 않는다" 를 난이도가 깨지 않게 한다.
 */
const XP_FLOOR = XP_PER_CLEAN_RUN + 50;

/** 이 레벨에서 다음 레벨(L10 은 마스터)까지 필요한 경험치 — 50 단위로 맞춘다 */
export const xpToNext = (level: Difficulty, rule: ProgressRule = DEFAULT_PROGRESS): number =>
  Math.max(XP_FLOOR, Math.round((XP_TO_NEXT[level] * rule.xpScale) / 50) * 50);

/** 한 판이 경험치를 어떻게 움직였는가 — 결과 화면이 그대로 보여 준다 */
export interface XpStep {
  /** 이번 판에 얻은(음수면 잃은) 경험치 — 막대에 실제로 더해진 양 */
  gained: number;
  /** 판을 시작할 때의 경험치와 그때 필요했던 양 */
  before: number;
  needBefore: number;
  /** 판을 마친 뒤의 경험치와 지금 필요한 양 (레벨이 올랐으면 새 레벨의 것) */
  after: number;
  need: number;
  /** 이번 판으로 레벨이 올랐는가 (L10 에서는 마스터가 되었는가) */
  leveledUp: boolean;
  /** 막대는 찼는데 나쁜 습관이 남아 오르지 못했는가 */
  heldByHabits: boolean;
  /** 이미 통과한 맵을 다시 통과해 절반(XP_REPLAY)만 받았는가 */
  replay: boolean;
}

/**
 * **처음 앉는 사람이 시작하는 레벨 — 1이다.**
 *
 * 레벨이 오를수록 새 개념이 열린다 (library.ts 의 assignLevels · levelGuide): L1 기본(정면 녹색 · 적색과 보행자 한 쪽) ·
 * 우회전 신호등 → L2 어린이보호구역(신호 있음 · 신호기 없음) → L5 앞차 · 꼬리물기 → L7 일시정지 무시 앞차 · 보행자
 * 여럿 → L8~L10 종합. 밤 · 비 · 뒤차 경적은 어느 레벨에나 나오는 조건이다. 처음 앉은 사람은 기본 두 규칙부터 만난다.
 *
 * ## 한때 5에서 시작했다
 *
 * 점수 예산으로 레벨을 나누던 때는 L1 에 쓸 판이 "녹색 · 보행자 없음" 뿐이라 배울 것이 없었고, AI 가
 * 일할 재료(습관)도 쌓이지 않았다. 그래서 세 오해를 첫 판에 물을 수 있는 5에서 시작했다. 개념 순서로
 * 바꾸자 L1 에 적색 일시정지 · 보행자 보호가 모두 들어와(8판) 1에서 시작해도 첫 판부터 배울 것이 있다.
 * 가장 낮은 레벨도 무위반 두 판을 머물고, 위로 갈수록 오래 머문다 (XP_TO_NEXT).
 *
 * **차는 따라오지 않는다.** 시작 레벨은 주어진 자리이지 얻은 자리가 아니라,
 * `bestLevel` 은 1에서 시작한다 (아래 `advance` 의 주석 참조).
 */
export const START_LEVEL: Difficulty = 1;

/**
 * 이 이상 위반하면 **두 번을 기다리지 않고 곧바로 내린다.**
 *
 * 시작 레벨이 5가 되면서 필요해진 규칙이다. "두 번 이어 틀려야 한 레벨" 만으로는
 * 5에서 1까지 내려오는 데 **여덟 판을 내리 실패해야** 한다 — 부스에서 그 여덟 판은
 * 사람을 떠나게 만든다.
 *
 * 한 판에 셋을 위반했거나 사고·이탈로 끝났다면 그것은 실수가 아니라 **자리가 안 맞는
 * 것**이다. 자리가 안 맞는 것은 한 판이면 알 수 있다.
 */
const HARD_MISS_VIOLATIONS = 3;

/**
 * 레벨 하나 — **쓸 수 있는 점수와 그 자리의 이름뿐이다.**
 *
 * ## 무엇이 사라졌는가
 *
 * 예전에는 여기에 불리언 열 개가 있었다(`allowSchoolZone`·`allowJaywalker` …).
 * 레벨마다 **어떤 조건을 쓸 수 있는지**를 못 박은 표였고, 그것이 이 과정의 목적과
 * 정면으로 부딪혔다 — 학습자의 약점이 그 레벨에서 금지된 조건이면 AI 는 그 약점을
 * 시험하는 판을 만들 수 없었다 (difficulty.ts 의 첫 주석 참조).
 *
 * 지금은 난이도를 **양**으로 잰다. 무엇에 쓸지는 모델이 고르고, 학습자의 약점은
 * 값을 받지 않는다. 그래서 이 표에 남은 것은 예산 하나다.
 *
 * ## 레벨 이름도 사라졌다
 *
 * `name: '어린이보호구역'` 같은 이름은 "이 레벨에서 보호구역이 열린다" 는 뜻이었다.
 * 이제 보호구역은 어느 레벨에서도 나올 수 있으므로 그 이름은 거짓말이 된다.
 * 대신 난이도의 결을 말하는 `levelTier` 를 쓰고, **이 판이 무엇을 묻는지는 판 자신이**
 * 말한다 (생성된 시나리오의 `teaches`·`why`).
 */
export interface LevelRule {
  level: Difficulty;
  /**
   * 조건에 쓸 수 있는 점수 (difficulty.ts 의 비용표).
   *
   * 공식이 아니라 **손으로 잡은 표**다. 바닥은 천천히 열어야 처음 앉은 사람이 놀라지
   * 않고, 위는 넉넉해야 조합이 다양해진다.
   */
  budget: number;
}

/**
 * 예산표.
 *
 * ## 옛 사다리를 재현한다
 *
 *   L1  0점 — 녹색·보행자1·교차1·낮·맑음. **옛 1단계와 글자 그대로 같다**
 *   L2  1점 — 적색 시작만. 옛 2단계와 같다
 *   L5  7점 — 보호구역2 + 신호기없음2 + 적색1 + 보행자2명1 = 6. 옛 5단계와 거의 같다
 *
 * ## 그리고 중간을 연다
 *
 *   L3  3점 — 보호구역2 + 적색1 이 들어온다. **옛 표에서는 금지였다.**
 *              L3 학습자의 약점이 보호구역이면 그 판을 만들 수 있다 (이것이 목적이다)
 *
 * ## 위는 고르게 한다
 *
 *   L10 18점 — 조건을 전부 켜면 29점이라 **다 켤 수 없다.** 프롬프트가 부탁만 하던
 *              "한 판은 한 가지를 가르칩니다" 가 여기서 검사 가능해진다.
 *              매번 다른 조합이 나오는 편이 "항상 전부 켬" 보다 낫다.
 */
export const LEVELS: readonly LevelRule[] = [
  { level: 1, budget: 0 },
  { level: 2, budget: 1 },
  { level: 3, budget: 3 },
  { level: 4, budget: 5 },
  { level: 5, budget: 7 },
  { level: 6, budget: 9 },
  { level: 7, budget: 11 },
  { level: 8, budget: 13 },
  { level: 9, budget: 15 },
  { level: 10, budget: 18 },
];

/**
 * 난이도의 결 — 화면이 레벨 숫자 옆에 붙이는 한 마디.
 * (레벨마다 무엇을 새로 여는지는 library.ts 의 levelOf 가 정한다. `LEVELS` 의 점수 예산은 이제 AI 가
 * 판을 새로 만들 때(대비책, generate.ts)만 쓴다.)
 *
 * 레벨마다 다른 이름을 지어 주지 않는 이유: 열 개를 지으면 그 이름들이 **무엇이 열리는지**를
 * 말하게 되는데(옛 표가 그랬다), 지금은 무엇이 열리는지가 레벨로 정해지지 않는다.
 * 다섯 결이면 "지금 어느 언저리에 있는가" 를 말하기에 충분하다.
 */
export const levelTier = (level: Difficulty): string =>
  level <= 2 ? '입문' : level <= 4 ? '기본' : level <= 6 ? '보통' : level <= 8 ? '까다로움' : '실전';

export const ruleFor = (level: Difficulty): LevelRule => LEVELS[level - 1];

/**
 * **레벨** — 학습자가 자기를 부르는 말이자, 이 과정의 목표다.
 *
 * ## 왜 계급을 걷어냈는가
 *
 * 한때 난이도 열 단계 위에 계급 넷(초급·중급·고급·마스터)을 얹어 두었다. 숫자만으로는
 * "어디까지 왔는지" 는 말해도 "어디로 가는지" 를 말하지 못한다는 이유였다.
 *
 * 그런데 **두 자가 따로 놀았다.** 화면에는 계급 이름과 단계 숫자가 함께 떠 있는데
 * (`우회전 중급` · `5 / 10단계`), 올라가는 것은 단계이고 이름은 세 판에 한 번만 바뀐다.
 * 무위반으로 통과해도 이름이 그대로인 판이 셋 중 둘이라, 정작 **오른 것이 안 보였다.**
 * 차가 열리는 기준도 계급이라, 다섯 단계를 올라가도 차가 안 바뀌는 구간이 생겼다.
 *
 * 지금은 **레벨 하나뿐이다.** 경험치를 채우면 레벨이 오르고(XP_TO_NEXT), 레벨이 오르면
 * 차가 바뀐다(economy/cars.ts). 오른 것이 곧 보이는 것이다.
 *
 * ## 그러면 목표는 무엇인가
 *
 * `MAX_LEVEL`(10)이다. 다만 **닿은 것과 해낸 것은 다르다** — 거기서 경험치를 끝까지 채우고 나쁜 습관을
 * 모두 고쳐야 이 과정을 마친 것이 된다. 그 전까지는 '도전' 이 붙는다.
 */

/** 화면에 찍는 레벨 이름 — `L1` … `L10` */
/**
 * 화면에 적는 레벨 이름 — **`Level7` 이다** (사용자가 정했다: "L1, L2 … 를 Level1, Level2 … 로 변경해 줘").
 *
 * 한때 `L7` 이었다. 자리를 아끼는 표기였는데, 이 과정을 처음 여는 사람에게 'L' 한 글자는 레벨인지 차로인지
 * 등급인지 알 수 없다 — 운전면허 1종 · 2종처럼 읽는 사람도 있다. 뱃지 안에는 숫자만 들어가므로(ui/badges.ts)
 * 길어진 것은 글로 적는 자리뿐이다.
 */
export const levelLabel = (level: Difficulty): string => `Level${level}`;

/**
 * 지금 이 사람의 호칭.
 *
 * 최고 레벨에 올라섰지만 아직 경험치를 못 채웠으면 **'도전' 이 붙는다** —
 * 닿은 것과 해낸 것을 같은 말로 부르면 목표가 사라진다.
 */
export function courseTitle(state: Pick<CurriculumState, 'level' | 'mastered'>): string {
  /*
    호칭은 **학습자가 키우는 능력**의 이름이다. 오래 '우회전 Level6' 이었는데, 작품 이름이
    'AI 일시정지 안전운전' 이 되며 **'안전운전 Level6' 로 맞췄다** (사용자 요청) — 화면 곳곳에서 부르는
    말과 이름이 다른 것을 가리키면, 레벨이 무엇의 레벨인지부터 다시 알아봐야 한다.
  */
  if (state.mastered) return '안전운전 마스터';
  if (state.level >= MAX_LEVEL) return `안전운전 ${levelLabel(MAX_LEVEL)} 도전`;
  return `안전운전 ${levelLabel(state.level)}`;
}

/**
 * 이 과정의 지금 상태. **저장된다** — 마스터는 한 자리에서 끝낼 수 있는 것이 아니다.
 */
export interface CurriculumState {
  level: Difficulty;
  /** 이 과정에서 지금까지 푼 판 수 */
  runs: number;
  /**
   * **지금 레벨에서 모은 경험치** — `xpToNext(level)` 에 닿고 나쁜 습관이 없으면 오른다 (위 XP_TO_NEXT).
   * 레벨이 오르면 0 에서 다시 모은다.
   */
  xp: number;
  /** 이어 온 무위반 판 수 — 한 번 틀리면 0. AI 추천이 "요즘 잘하고 있는가" 를 읽는 데 쓴다 */
  cleanStreak: number;
  /** 이어 틀린 판 수 — AI 추천이 "연달아 틀려 복습이 필요한가" 를 읽는 데 쓴다 */
  missStreak: number;
  /**
   * **나쁜 운전 습관** — AI 가 다음 판을 만드는 근거다 (coach/badHabits.ts).
   *
   * 처음에는 비어 있다. 위반할 때마다 붙고, **그 위반 없이 3판을 지나면 사라진다.**
   * 전체 이력(coach/habits.ts)과 따로 두는 이유는, 이 과정 안에서 지금 고쳐야 할 것과
   * 예전에 손으로 쓴 판에서 틀렸던 것이 다르기 때문이다.
   */
  badHabits: BadHabit[];
  mastered: boolean;
  /**
   * 지금까지 **가장 높이 올라간** 단계.
   *
   * 차량이 열리는 기준이다 (economy/cars.ts). 두 번 이어 틀려 강등되면 판은 쉬워지지만
   * **이미 열린 차가 닫히지는 않는다** — 얻은 것을 도로 빼앗는 것은 이 게임이 하려는
   * 일이 아니고, 차를 잃지 않으려고 쉬운 판만 고르게 만들 이유도 없다.
   */
  bestLevel: Difficulty;
}

export const freshCurriculum = (): CurriculumState => ({
  level: START_LEVEL,
  runs: 0,
  xp: 0,
  cleanStreak: 0,
  missStreak: 0,
  badHabits: [],
  mastered: false,
  /*
    **차는 시작 레벨을 따라오지 않는다.** 5레벨에서 시작하는 것은 주어진 자리이지 얻은
    자리가 아니므로, 여기서 5로 두면 아무것도 안 하고 다섯 대가 열린다. 1에서 시작해
    **통과한 레벨**만큼 오른다 (advance 의 remember).
  */
  bestLevel: 1,
});

/**
 * 한 판을 마친 뒤의 다음 상태.
 *
 * **순수 함수다** — 저장이나 화면을 건드리지 않는다. 진급 규칙이 이 게임의 학습 설계
 * 그 자체라, 테스트로 못 박아 두려면 다른 것이 섞이면 안 된다.
 *
 * ## 경험치
 *
 * - 무위반 통과: +100 (XP_PER_CLEAN_RUN), 이 판으로 나쁜 습관을 고쳤으면 하나에 +50 (XP_HABIT_FIXED)
 * - 위반: 난이도가 정한 만큼 잃는다 (보통 −20, 어려움 −60 · 사고 · 이탈 · 위반 3개 이상은 두 배). 0 아래로는 안 내려간다
 * - 막대가 차고 **나쁜 습관이 하나도 없으면** 오른다. 습관이 남아 있으면 막대는 찬 채로 기다린다 — 학습 루프의
 *   "습관을 다 고쳐야 다음 레벨" 은 그대로다.
 *
 * ## 레벨이 내려가지는 않는다
 *
 * 예전에는 두 번 이어 틀리면 한 레벨 내렸다. 경험치를 둔 뒤로는 틀리면 **경험치를 잃는다** — 모은 레벨을 도로
 * 빼앗는 대신 막대가 줄어 다시 채워야 한다. 연달아 틀린 사람에게 쉬운 판을 주는 것은 AI 추천이 한다 (최근 결과를 읽는다).
 */
export function advance(
  state: CurriculumState,
  result: JudgeResult,
  /** 이 판에서 일어날 수 있었던 위반 (library.ts 의 `habitsTestedBy`) — 생략하면 전부 */
  tested?: ReadonlySet<ViolationCode>,
  /** 경험치 규칙 — 난이도 설정이 정한다 (challenge.ts). 생략하면 보통의 곡선 · 틀려도 잃지 않음 */
  rule: ProgressRule = DEFAULT_PROGRESS,
  /** 이 맵을 이미 무위반으로 통과한 적이 있는가 — 있으면 무위반 경험치가 절반이다 (XP_REPLAY) */
  opts: { replay?: boolean } = {},
): { next: CurriculumState; change: HabitChange; xp: XpStep } {
  const clean = result.violations.length === 0 && !result.failReason;
  const runs = state.runs + 1;

  /*
    **습관 기록이 먼저다.** 단계가 오르내리는 것과 무관하게, 이번 판에서 무엇을 저질렀고
    무엇을 고쳤는지는 그대로 남아야 한다 (coach/badHabits.ts).
  */
  const codes = result.violations.map((v) => v.code as ViolationCode);
  const { habits, change } = updateHabits(state.badHabits, codes, runs, tested, result.failReason !== null);
  const habitsLeft = habits.length > 0;

  const needBefore = xpToNext(state.level, rule);
  const before = Math.min(state.xp ?? 0, needBefore);
  let gain: number;
  const replay = clean && !!opts.replay;
  if (clean) {
    // 습관을 고친 몫은 다시 달린 맵이어도 그대로다 — 고친 것은 고친 것이다
    gain = (replay ? XP_REPLAY : XP_PER_CLEAN_RUN) + change.cleared.length * XP_HABIT_FIXED;
  } else {
    const hardMiss = result.failReason !== null || result.violations.length >= HARD_MISS_VIOLATIONS;
    gain = -rule.missPenalty * (hardMiss ? 2 : 1);
  }
  /*
    막대는 0 과 가득 사이 — 습관 때문에 못 오르면 가득 찬 채로 기다린다.
    **마스터가 된 뒤에는 막대가 움직이지 않는다.** 마스터 운행(L10 코스를 무작위로 이어 달리기)은 오를 곳이 없는 연습이라,
    위반해도 경험치를 잃지 않고 가득 찬 채로 둔다 — 마스터는 한 번 되면 '처음부터 다시 시작' 전까지 그대로다.
    나쁜 습관은 위(updateHabits)에서 그대로 기록한다.
  */
  const filled = state.mastered ? needBefore : Math.max(0, Math.min(needBefore, before + gain));

  const next: CurriculumState = {
    ...state,
    runs,
    badHabits: habits,
    xp: filled,
    cleanStreak: clean ? state.cleanStreak + 1 : 0,
    missStreak: clean ? 0 : state.missStreak + 1,
  };

  const full = filled >= needBefore;
  let leveledUp = false;
  if (full && !habitsLeft && !state.mastered) {
    leveledUp = true;
    if (state.level < MAX_LEVEL) {
      next.level = (state.level + 1) as Difficulty;
      // 새 레벨에서는 새로 모은다 — 넘친 경험치는 넘기지 않는다 (막대가 늘 0 에서 시작해 읽기 쉽다)
      next.xp = 0;
    } else {
      next.mastered = true;
    }
  }

  /*
    **통과한 레벨만 기억한다** — 차량이 여기서 열린다 (bestLevel 주석 참고). 레벨을 올린 판이 그 레벨을 통과한 판이다.
    L10 은 위가 없으니 무위반 한 판이 달성이다.
  */
  if (next.level > state.level || (state.level >= MAX_LEVEL && clean)) {
    next.bestLevel = Math.max(next.bestLevel, state.level) as Difficulty;
  }

  const xp: XpStep = {
    gained: filled - before,
    before,
    needBefore,
    after: next.xp,
    need: xpToNext(next.level, rule),
    leveledUp,
    heldByHabits: full && habitsLeft,
    replay,
  };
  return { next, change, xp };
}

/**
 * **수동 주행의 결과를 습관 기록에만 반영한다.**
 *
 * ## 왜 필요한가
 *
 * `advance` 는 AI 과정의 판에서만 불린다(main.ts). 그래서 손으로 쓴 11판을 아무리
 * 엉망으로 몰아도 `badHabits` 는 비어 있었고, AI 과정에 처음 들어온 사람의 프롬프트는
 * **자기모순**을 일으켰다 —
 *
 *   # 이 학습자의 나쁜 운전 습관
 *   아직 기록된 것이 없습니다.            ← badHabits (AI 주행만 셌다)
 *
 *   ## 반복하는 위반 (많은 순)
 *   - 횡단보도 보행자의 통행을 방해 — 7회  ← byCode (전체 이력)
 *
 * 모델은 "이번 판이 시험할 것" 을 못 받은 채로 시작한다. 우회전을 어디서 못하는지는
 * 어느 판에서 못했든 같은 사실이므로, 습관은 **모든 주행에서** 쌓는다.
 *
 * ## 레벨은 건드리지 않는다
 *
 * 손으로 쓴 판은 난이도 표와 무관하게 만들어져 있어, 그 결과로 레벨을 올리면 4레벨
 * 학습자가 1레벨짜리 판을 통과한 것으로 진급한다. `runs` 도 세지 않는다 — 그 숫자는
 * "이 과정에서 몇 판을 풀었나" 라 첫 화면의 버튼 글자(`우회전 안전운전 연습` / `이어서 안전운전 연습`)를
 * 정한다. AI 과정을 한 판도 안 한 사람에게 '이어서' 라고 물을 수는 없다.
 *
 * **`cleanRuns` 는 함께 오른다.** 수동 주행에서 그 위반 없이 지나갔으면 그것도 고친
 * 것이라, 습관이 사라지는 셈에 들어가는 편이 맞다.
 */
export function recordHabits(
  state: CurriculumState,
  result: JudgeResult,
  tested?: ReadonlySet<ViolationCode>,
): CurriculumState {
  const codes = result.violations.map((v) => v.code as ViolationCode);
  const { habits } = updateHabits(state.badHabits, codes, state.runs, tested, result.failReason !== null);
  return { ...state, badHabits: habits };
}

/**
 * 다음 판이 정면으로 시험할 **나쁜 운전 습관** — 가장 많이 저지른 것. 없으면 `null`.
 *
 * 이 값이 프롬프트로 넘어가 "이 상황을 다시 만나게 하라" 가 된다.
 */
export function currentTarget(state: CurriculumState): string | null {
  return primaryHabit(state.badHabits)?.code ?? null;
}


/**
 * 만들어진 판이 **정말 그 레벨에 맞는지** 잰다.
 *
 * 모델에게 예산을 말로 알려 주는 것만으로는 부족하다 — 7점이라고 해 놓고 12점짜리
 * 판이 실제로 온다. 받아서 다시 잰다 (difficulty.ts 의 `checkBudget`).
 *
 * `trimToBudget` 뒤에는 통과하는 것이 정상이다. 그래도 재는 이유는, **값을 깎는 코드와
 * 재는 코드가 갈라지면 언젠가 어긋나기** 때문이다.
 */
export function checkDifficulty(
  spec: ScenarioSpec,
  level: Difficulty,
  free: readonly ConditionKey[] = [],
): string[] {
  return checkBudget(spec, ruleFor(level).budget, free);
}

/**
 * 만들어진 판을 **예산 안으로 깎아 넣는다.**
 *
 * ## 왜 반려가 아니라 교정인가
 *
 * 예산을 프롬프트에 적고, 비용표까지 넘기고, 출력 전에 세어 보라고까지 시켜 봤다.
 * 그래도 모델의 산수는 자주 틀린다 — 조건을 잔뜩 넣고 합계를 낮게 적어 온다.
 * 말로 시키는 것에는 한계가 있다.
 *
 * 그래서 넘은 만큼 여기서 깎는다. 판정에 쓰이는 값이라 확실히 정할 수 있고,
 * 우리가 정하는 편이 모델이 세 번 더 틀리는 것보다 낫다.
 *
 * ## 무엇을 깎는가
 *
 * **가장 비싼 곁가지부터.** 옛 `clampToLevel` 은 "금지된 것을 전부 끈다" 였는데,
 * 그러면 모델이 만든 판의 뜻이 통째로 날아갔다. 지금은 예산에 들어올 때까지만 던다.
 *
 * **학습자의 약점(`free`)은 깎지 않는다.** 그것을 깎으면 이 판을 만든 이유가 사라진다.
 */
export function clampToLevel(
  spec: ScenarioSpec,
  level: Difficulty,
  free: readonly ConditionKey[] = [],
): ScenarioSpec {
  return trimToBudget(spec, ruleFor(level).budget, free);
}

/** 조건별로 글에 나타날 만한 말 — 값을 껐는데 글이 그대로면 그 판은 거짓말을 한다 */
const MENTIONS: { key: ConditionKey; words: string[] }[] = [
  { key: 'schoolZone', words: ['어린이보호구역', '스쿨존', '어린이 보호구역'] },
  { key: 'exitBlocked', words: ['꼬리물기', '진출로', '정체'] },
  { key: 'rightArrow', words: ['우회전 신호등', '화살표'] },
  { key: 'missingPedSignal', words: ['신호기 없', '신호등 없', '무신호'] },
  { key: 'lowVisibility', words: ['야간', '밤 ', '빗길', '비 오', '우천'] },
  { key: 'jaywalker', words: ['신호를 무시', '무단횡단', '신호와 무관'] },
  { key: 'leadCar', words: ['앞차', '앞 차', '선행 차량'] },
];

/**
 * 깎아 낸 조건을 **글이 아직 말하고 있는가.**
 *
 * 값은 고칠 수 있어도 제목과 설명은 못 고친다. "어린이보호구역 - 신호기 없는 횡단보도"
 * 라고 적힌 판이 실제로는 평범한 교차로면, 학습자는 화면과 다른 것을 배우게 된다.
 *
 * **깎기 전후를 견준다.** 예전에는 "이 레벨에서 금지인 말이 글에 있는가" 를 봤는데,
 * 예산제에서는 금지된 조건이라는 것이 없다 — 비싼 조건이 있을 뿐이다. 그리고 그편이
 * 더 정확하다: 모델이 애초에 켜지 않은 조건을 말했다고 반려하는 일이 사라진다.
 */
export function describesRemoved(before: ScenarioSpec, after: ScenarioSpec): string[] {
  const text = `${after.title} ${after.brief} ${after.teaches}`;
  const out: string[] = [];

  for (const m of MENTIONS) {
    // 깎여서 사라진 조건만 본다 (있던 것이 없어졌는가)
    if (!hasCondition(before, m.key) || hasCondition(after, m.key)) continue;
    const hit = m.words.find((w) => text.includes(w));
    if (hit) out.push(`조건을 덜어 냈는데 제목·설명이 아직 "${hit}" 을 말합니다`);
  }
  return out;
}

/**
 * 지금까지 **열린 레벨** — 차량이 열리는 기준이다 (economy/cars.ts).
 *
 * 지금 레벨이 아니라 `bestLevel` 이다. 강등돼도 이미 열린 차는 닫히지 않는다.
 *
 * 한때는 계급 목록(`unlockedRanks`)이었고 최고 계급의 차만 **마스터를 해내야** 열렸다.
 * 지금은 그 예외가 없다 — 마지막 차가 L9 에 걸려 있어(economy/cars.ts) 최고 레벨에
 * 닿는 것과 차가 열리는 것이 애초에 겹치지 않는다.
 */
export const unlockedLevel = (state: CurriculumState): Difficulty => state.bestLevel;
