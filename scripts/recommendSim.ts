/**
 * **가상 운전자와 교사 — 추천 신경망(src/ai/recommendNet.ts)을 가르치는 시뮬레이터.**
 *
 * scripts/train-recommend.ts 가 쓴다. 게임과 **같은 함수**로 계획(scenarios/nextPlan.ts) · 후보(recommend.ts 의
 * coursesByHabit) · 레벨 규칙(curriculum.ts 의 advance) · 학습자 모델(BKT · 능력 θ · 결과 예측 보정)을 돌리고, 판의
 * 결과만 가상 운전자의 **진짜 실력**으로 정한다.
 *
 * ## 가상 운전자
 *
 * 개념(위반 코드)마다 진짜로 아는가(참 · 거짓)를 갖는다. 브라우저의 학습자 모델은 이것을 모르고 결과로 짐작할 뿐이다.
 *
 *  - **판의 결과**: 모르는 개념은 판이 그 개념을 얼마나 날카롭게 묻는지(`exposure` — 보행자 수 · 무단횡단 · 어린이 ·
 *    가까이서 나섬 · 신호)만큼 어긴다. 아는 개념도 어려운 판(난이도 모델 ai/difficulty.ts 의 b)에서는 가끔 실수한다.
 *    결과 예측 모델(ai/outcome.ts)을 그대로 쓰지 않는 까닭: 그 모델은 학습자 쪽 입력이 숙달 '확률' 이라, 아는 개념에
 *    1 을 넣어도 보행자 양보를 44% 어긴다고 내 습관이 영영 사라지지 않았고, 모르는 적색 정지는 0.4% 만 어겼다. 또 그
 *    모델은 신경망의 입력이기도 해서, 환경까지 같은 식이면 신경망이 환경의 식을 그대로 읽게 된다.
 *  - **배움**: 모르는 개념을 어기면 결과 화면의 설명을 보고 그 개념을 익힐 수 있다 (사람마다 · 개념마다 빠르기가 다르다).
 *    한 판에 여럿을 한꺼번에 어기면 덜 익힌다(한 번에 소화할 양). 어기지 않고 지나가도 조금은 익힌다.
 *  - **잊음**: 아는 개념은 시간이 지나면 잊힌다. 간격을 두고 연습할수록 반감기가 길어진다(간격 효과 — 3분 뒤에
 *    또 묻는 것은 거의 보태지 않는다). 판 사이는 몇 분, 몇 판마다 하루 남짓 쉰다.
 *
 * ## 교사
 *
 * 판을 고를 차례마다 후보를 하나씩 "이 판을 골랐다면" 하고 복제한 운전자로 64번 달려 보고 평균을 낸다. 후보끼리는
 * **같은 운**(같은 씨앗 — 개념마다 뽑는 난수까지 같다)을 쓴다 — 차이가 운이 아니라 후보에서만 나게. 점수는
 * **하루 뒤에도 남아 있을 진짜 실력**이 는 만큼 + 레벨이 나아간 만큼 − 습관 빚(레벨을 막는 습관이 풀리기까지 남은 판) +
 * 이 레벨에서 새로 겪은 상황 − 연달아 셋 넘게 틀린 판이다 (무게는 아래 '교사의 무게 다섯' · 핵심 개념의 무게 CORE_WEIGHT).
 *
 * 처음에는 고른 판 뒤로 세 판을 지금의 프로그램으로 더 달려 보았다(8번). 그러자 뒤의 판들에서 누가 무엇을 익히고
 * 잊는지의 운이 후보 사이의 차이를 덮어, 같은 차례를 두 번 채점하면 점수의 상관이 0.47 에 그쳤다 — 신경망은 운을
 * 흉내 낼 수 없었다. 고른 판 하나만 64번 달리고, 그 뒤의 효과(복습하면 덜 잊힌다)는 '하루 뒤 남아 있을 실력' 으로 셈에
 * 넣자 상관이 0.96 이 되고 35배 빨라졌다.
 */

import { difficultyOf, abilityPriorFor, levelMeanDifficulty } from '../src/ai/difficulty';
import { runsToClear } from '../src/coach/badHabits';
import { SKILL_ORDER } from '../src/ai/knowledge';
import { learnerVector, predictOutcome } from '../src/ai/outcome';
import type { JudgeResult } from '../src/rules/lawRules';
import type { ViolationCode } from '../src/rules/violations';
import { challengeRule, type Challenge } from '../src/scenarios/challenge';
import { advance, freshCurriculum, xpToNext, type CurriculumState, type Difficulty } from '../src/scenarios/curriculum';
import type { Plan } from '../src/scenarios/generate';
import { habitsTestedBy, libraryEntry, scenarioLibrary, type LibraryEntry } from '../src/scenarios/library';
import { nextPlan } from '../src/scenarios/nextPlan';
import {
  candidatesFor,
  courseInputs,
  coursesByHabit,
  coverageOf,
  coverKeys,
  eligibleFor,
  masterFrame,
  masterPick,
  recentSet,
  rulePick,
  seenShapes,
  turnClassOf,
  turnContext,
  turnInputs,
  verdictsFor,
  type Coverage,
  type SeenShapes,
} from '../src/scenarios/recommend';
import type { TrackChoice } from '../src/scenarios/tracks';
import { recommendFeatures, turnFeatures, type TurnContext } from '../src/ai/recommendNet';

// ── 난수 · 시계 ────────────────────────────────────────────────────────────

export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 게임 코드는 `Math.random` 으로 차례를 굴리고 `Date.now` 로 망각을 센다. 시뮬레이터는 둘을 갈아 끼운다 —
 * 씨앗을 고정해 재현하고, 가상 운전자의 시계로 망각을 센다.
 */
const clock = { ms: Date.UTC(2026, 0, 1) };
let installed = false;
export function installSim(): void {
  if (installed) return;
  scenarioLibrary(); // 라이브러리는 갈아 끼우기 전에 만든다 (만드는 데 난수를 쓰지 않지만, 시간을 재지 않게)
  Date.now = () => clock.ms;
  installed = true;
}
export const seedGame = (seed: number): void => {
  Math.random = rng(seed);
};

// ── 가상 운전자 ────────────────────────────────────────────────────────────

export interface Learner {
  known: Record<ViolationCode, boolean>;
  /** 기억의 세기 — 간격을 두고 연습할수록 오른다 (아래 drive 의 간격 효과). 반감기가 이만큼 길어진다 */
  strength: Record<ViolationCode, number>;
  /** 마지막으로 연습한 때 (이 사람의 시계, 시간) */
  last: Record<ViolationCode, number>;
  /** 어긴 판에서 그 개념을 익힐 확률 */
  learn: Record<ViolationCode, number>;
  /** 처음 익힌 개념의 반감기 (시간) */
  halfLife: number;
  /** 운전 솜씨 θ (난이도 모델의 자) — 아는 개념을 어려운 판에서 실수할 확률을 정한다 */
  ability: number;
}

export interface LearnerKind {
  /** 처음 아는 정도의 범위 */
  base: [number, number];
  /** 익히는 빠르기의 범위 */
  learn: [number, number];
  /** 반감기(시간)의 범위 — 로그로 고르게 */
  halfLife: [number, number];
  /** 유난히 안 익혀지는 개념이 될 확률 */
  stubborn: number;
}

/** 학습에 쓰는 운전자들 */
export const TRAIN_KIND: LearnerKind = { base: [0, 0.7], learn: [0.12, 0.5], halfLife: [10, 150], stubborn: 0.1 };
/** 검증에만 쓰는 **처음 보는 종류** — 더 느리게 익히고 더 빨리 잊는다 */
export const SHIFTED_KIND: LearnerKind = { base: [0, 0.4], learn: [0.06, 0.25], halfLife: [4, 40], stubborn: 0.2 };

const between = (r: () => number, [a, b]: [number, number]) => a + (b - a) * r();

export function makeLearner(r: () => number, kind: LearnerKind = TRAIN_KIND): Learner {
  const base = between(r, kind.base);
  const learnBase = between(r, kind.learn);
  const known = {} as Record<ViolationCode, boolean>;
  const strength = {} as Record<ViolationCode, number>;
  const last = {} as Record<ViolationCode, number>;
  const learn = {} as Record<ViolationCode, number>;
  for (const c of SKILL_ORDER) {
    const p = Math.max(0, Math.min(1, base + (r() - 0.5) * 0.4));
    known[c] = r() < p;
    strength[c] = known[c] ? 1 : 0;
    last[c] = -1e9;
    learn[c] = learnBase * (r() < kind.stubborn ? 0.3 : 0.7 + 0.6 * r());
  }
  const [h0, h1] = kind.halfLife;
  // 솜씨는 L2 판의 평균 난이도에서 L6 판의 평균 난이도 위 언저리까지
  const lo = levelMeanDifficulty(2);
  const hi = levelMeanDifficulty(6) + 0.5;
  return { known, strength, last, learn, halfLife: h0 * (h1 / h0) ** r(), ability: lo + (hi - lo) * r() };
}

const knownCount = (l: Learner): number => SKILL_ORDER.filter((c) => l.known[c]).length;

/** 한 판에 여럿을 한꺼번에 어기면 덜 익힌다 — 어긴 개념 하나 더에 이만큼씩 */
const LOAD = 0.5;
/** 어기지 않고 지나간 모르는 개념도 이만큼은 익힌다 (어겼을 때에 견준 비율) */
const QUIET_LEARN = 0.15;
/** 기억의 세기가 1 오를 때마다 반감기가 2^이만큼 */
const PER_PRACTICE = 0.6;

/** 그 개념의 지금 반감기 (시간) — 두 달에서 멈춘다 */
export const halfLifeOf = (l: Learner, c: ViolationCode): number =>
  Math.min(24 * 60, l.halfLife * 2 ** (PER_PRACTICE * Math.max(0, l.strength[c] - 1)));

/**
 * **모르는 개념을 이 판이 드러낼 확률** — 판의 구조로 센다. 보행자 양보는 사람마다 따로 걸리므로 사람이 많을수록,
 * 무단횡단 · 어린이 · 코앞에서 나섬 · 앞차 뒤에서 나섬일수록 높다. 신호와 일시정지는 모르면 거의 어긴다. 정지선 ·
 * 우측 통행 · 서행은 모르는 사람도 절반쯤은 그럭저럭 지나간다.
 */
export function exposure(c: ViolationCode, e: LibraryEntry): number {
  const peds = e.spec.pedestrians;
  const anyOf = (qs: number[]) => 1 - qs.reduce((m, q) => m * (1 - q), 1);
  switch (c) {
    case 'PEDESTRIAN_BLOCKED':
      return anyOf(
        peds
          .filter((p) => p.bike !== 'ride')
          .map((p) => {
            let q = p.letsCarPass ? 0.1 : 0.5;
            if (p.obeysSignal === false) q += 0.2;
            if (p.kind === 'child') q += 0.1;
            if ((p.startWithin ?? 30) < 15) q += 0.15;
            if (p.afterLead) q += 0.1;
            return Math.min(0.95, q) * (p.chance ?? 1);
          }),
      );
    case 'BIKE_BLOCKED':
      return anyOf(peds.filter((p) => p.bike === 'ride').map((p) => 0.6 * (p.chance ?? 1)));
    case 'RED_NO_STOP':
      return 0.9;
    case 'SCHOOL_ZONE_NO_STOP':
      return 0.85;
    case 'SCHOOL_ZONE_RED':
    case 'RIGHT_ARROW_RED':
    case 'STRAIGHT_RED':
      return 0.8;
    case 'BLOCKING_INTERSECTION':
      return e.spec.exitBlocked ? 0.7 : 0.2;
    case 'OVER_STOP_LINE':
    case 'WIDE_TURN':
      return 0.45;
    case 'NO_SLOW_DOWN':
      return 0.4;
    default:
      return 0.3;
  }
}

/** 아는 개념의 실수 — 판이 솜씨보다 어려울수록 (최대 12%) */
const slip = (l: Learner, b: number): number => 0.02 + 0.1 / (1 + Math.exp(-(b - l.ability)));

/**
 * 판 하나를 진짜 실력으로 달린다 — 어긴 개념을 돌려주고, 배움을 반영한다.
 *
 * **난수는 판과 상관없이 개념마다 둘씩 뽑는다** (어길지 · 익힐지). 판마다 시험하는 개념 수가 달라 쓰는 만큼만 뽑으면,
 * 교사가 후보끼리 같은 운으로 견주려 해도 난수의 줄이 후보마다 어긋난다 (공통 난수가 깨진다).
 */
/**
 * `acc` 를 주면 **이 판에서 새로 알게 될 개념 수의 기댓값**을 더한다 — 모르는 개념마다 배울 확률(어겼으면 learn × load, 아니면
 * learn × QUIET_LEARN). 실제로 알게 됐는지는 주사위라, 강화학습의 보상을 이 기댓값으로 세면 같은 목표를 훨씬 적은 잡음으로 잰다
 * (scripts/ppo-rollout.ts · rewardWorth).
 */
export function drive(l: Learner, e: LibraryEntry, r: () => number, nowHours: number, acc?: { gain: number; learn?: number }): ViolationCode[] {
  const uViolate = SKILL_ORDER.map(() => r());
  const uLearn = SKILL_ORDER.map(() => r());
  const tested = [...habitsTestedBy(e.spec)].filter((c) => SKILL_ORDER.includes(c));
  const b = difficultyOf({ spec: e.spec, targets: [...habitsTestedBy(e.spec)], cost: e.cost });
  const at = (c: ViolationCode) => SKILL_ORDER.indexOf(c);
  const violated = tested.filter((c) => uViolate[at(c)] < (l.known[c] ? slip(l, b) : exposure(c, e)));
  const load = 1 / (1 + LOAD * Math.max(0, violated.length - 1));
  for (const c of tested) {
    if (l.known[c]) {
      /*
        **간격 효과** — 기억의 세기는 마지막 연습 뒤 흐른 시간이 반감기에 견줘 길수록 많이 오른다. 3분 뒤에 또 묻는
        것은 거의 보태지 않는다. 처음에는 연습할 때마다 1 씩 올렸더니, 교사가 아는 개념을 되도록 많이 묻는 복잡한 판을
        늘 좋게 쳐서(몰아치기 연습이 하루 뒤 기억을 늘 키웠다) 신경망이 실수가 잦은 판으로 몰리고 정면 녹색 같은 판을
        피했다.
      */
      l.strength[c] += Math.min(1, (nowHours - l.last[c]) / halfLifeOf(l, c));
      l.last[c] = nowHours;
    } else {
      const p = l.learn[c] * (violated.includes(c) ? load : QUIET_LEARN);
      if (acc) {
        acc.gain += p;
        acc.learn = (acc.learn ?? 0) + p;
      }
      if (uLearn[at(c)] < p) {
        l.known[c] = true;
        l.strength[c] = Math.max(1, l.strength[c]);
        l.last[c] = nowHours;
      }
    }
  }
  return violated;
}

/** 시간이 흐른다 — 아는 개념이 반감기만큼 잊힌다 (난수는 개념마다 하나씩, 아는지와 상관없이) */
/**
 * `gap` 이 있으면 `acc` 에는 쉬는 시간의 **길이를 고르게 평균한** 잊을 확률을 뺀다 — 쉬는 시간이 4 + 68u 시간(u 는 0~1 고르게)이라
 * 그 평균은 닫힌 꼴이다. 실제로 잊는지는 그대로 이번 길이로 정한다. 쉬는 길이는 고르기와 무관한 운이라, 보상에서 빼면 같은 목표를
 * 잡음 없이 잰다.
 */
export function forget(l: Learner, hours: number, r: () => number, acc?: { gain: number }, gap?: { base: number; span: number }): void {
  for (const c of SKILL_ORDER) {
    const u = r();
    if (!l.known[c]) continue;
    const hl = halfLifeOf(l, c);
    const p = 1 - 2 ** (-hours / hl);
    if (acc) acc.gain -= gap ? 1 - (2 ** (-gap.base / hl) * hl * (1 - 2 ** (-gap.span / hl))) / (gap.span * Math.LN2) : p;
    if (u < p) l.known[c] = false;
  }
}

// ── 한 사람의 과정 ─────────────────────────────────────────────────────────

export interface Episode {
  learner: Learner;
  save: {
    curriculum: CurriculumState;
    history: { st: number }[];
    settings: { track: TrackChoice; difficulty: Challenge };
  };
  /** 무위반으로 통과한 판 (다시 타면 경험치 절반) */
  cleared: Set<number>;
  /** 이 사람의 시계 (ms) */
  clockMs: number;
  /** 이번 앉은 자리에서 남은 판 수 */
  sessionLeft: number;
  /** 겪은 상황 — `레벨|축=값` */
  seenKeys: Set<string>;
  /** 결과 · 배움 · 잊음의 난수 (게임의 차례 난수와 따로) */
  rand: () => number;
  /** 연달아 셋 넘게 틀린 판 수 */
  frustration: number;
  runs: number;
  violations: number;
  /** 이 레벨에 머문다 — 레벨이 올라도 되돌린다 (아래 pinEpisode) */
  pin?: Difficulty;
  /**
   * **아는 개념 수의 기댓값** — 처음 아는 수에서 판마다 배울 확률을 더하고 잊을 확률을 뺀다 (drive · forget 의 acc). 실제로 아는
   * 수(knownCount)와 기댓값이 같지만 주사위 잡음이 없어, 강화학습의 보상(rewardWorth)이 이것을 쓴다.
   */
  expKnown: number;
  /** **새로 배운 개념 수의 기댓값** — 위 expKnown 에서 잊음을 뺀 것 (배울 확률만 더한다). 강화학습의 보상(rewardWorth 의 learn) */
  expLearned: number;
}

/**
 * **한 레벨에 오래 머무는 운전자** — 그 레벨에서 처음 시작해 레벨이 올라도 그 자리로 되돌린다. 학습 자료에만 섞는다.
 *
 * 가상 운전자는 대개 몇 판 만에 레벨을 지나가서, 신경망이 '한 레벨에 오래 머문 뒤' 를 거의 보지 못했다. 그런데 습관이 남으면
 * 사람도 한 레벨에 오래 머물고, 다양성 검사(tests/recommend.test.ts — 한 레벨에서 400판을 이어 달린다)가 바로 그 자리를 잰다.
 * 이 운전자들 없이 배운 차례 신경망은 그 검사에서 L4 보호구역의 84% 를 신호기 없는 판으로, L10 의 93% 를 보호구역으로 골랐다.
 */
export function pinEpisode(ep: Episode, level: Difficulty): void {
  ep.pin = level;
  ep.save.curriculum = { ...ep.save.curriculum, level };
}

const CHALLENGE_WEIGHTS: [Challenge, number][] = [
  [1, 0.08],
  [2, 0.15],
  [3, 0.55],
  [4, 0.14],
  [5, 0.08],
];

export function makeEpisode(seed: number, kind: LearnerKind = TRAIN_KIND): Episode {
  const r = rng(seed * 2654435761);
  const learner = makeLearner(r, kind);
  let difficulty: Challenge = 3;
  let u = r();
  for (const [c, w] of CHALLENGE_WEIGHTS) {
    if (u < w) {
      difficulty = c;
      break;
    }
    u -= w;
  }
  /*
    대부분은 기본(자동)이고, 몇 명은 한 갈래를 붙잡는다. **'섞어서'(both) 를 넉넉히 둔다** — 신경망은 갈래 설정마다 후보 묶음이 달라
    (자동은 보호구역 전용 도로가 함께 들어온다) 설정마다 따로 배워야 한다. 5% 였을 때는 '섞어서' 에서 신호기 없는 보호구역 비율이
    L2 ~ L4 에서 33 ~ 42% 로 떨어졌다 (tests/recommend.test.ts 의 레벨마다 고르게 — 문턱 50%).
  */
  const t = r();
  const track: TrackChoice = t < 0.6 ? 'auto' : t < 0.675 ? 'turn' : t < 0.75 ? 'zone' : 'both';
  return {
    learner,
    save: { curriculum: freshCurriculum(), history: [], settings: { track, difficulty } },
    cleared: new Set(),
    clockMs: Date.UTC(2026, 0, 1) + Math.floor(r() * 1e9),
    sessionLeft: 4 + Math.floor(r() * 11),
    seenKeys: new Set(),
    rand: rng(seed * 40503 + 17),
    frustration: 0,
    runs: 0,
    violations: 0,
    expKnown: knownCount(learner),
    expLearned: 0,
  };
}

export function cloneEpisode(ep: Episode, rand: () => number): Episode {
  return {
    learner: {
      known: { ...ep.learner.known },
      strength: { ...ep.learner.strength },
      last: { ...ep.learner.last },
      learn: ep.learner.learn,
      halfLife: ep.learner.halfLife,
      ability: ep.learner.ability,
    },
    save: {
      curriculum: structuredClone(ep.save.curriculum),
      history: [...ep.save.history],
      settings: ep.save.settings,
    },
    cleared: new Set(ep.cleared),
    clockMs: ep.clockMs,
    sessionLeft: ep.sessionLeft,
    seenKeys: new Set(ep.seenKeys),
    rand,
    frustration: ep.frustration,
    runs: ep.runs,
    violations: ep.violations,
    expKnown: ep.expKnown,
    expLearned: ep.expLearned,
  };
}

/** 고를 차례 — 계획과 후보 */
export interface Decision {
  plan: Plan;
  courses: LibraryEntry[];
  seen: SeenShapes;
  cover: Coverage;
  /** 지금까지 탄 판 번호 — 마스터 운행의 프로그램(masterPick)이 최근 판을 뺀다 */
  ids: number[];
  /**
   * **탈 수 있는 판 전부** (recommend.ts 의 eligibleFor) — 차례 신경망은 이 가운데 어느 갈래의 판이 있는지를 보고, 추천 신경망은
   * 뽑힌 갈래에서 고르게 `POOL` 판을 채점한다. `courses` 는 예전 프로그램(규칙 + 프로그램 점수)이 추린 최종 후보다.
   */
  pool: LibraryEntry[];
  /** 최근 판의 차례 (recommend.ts 의 turnContext) */
  turns: TurnContext;
}

/** 학습 · 견주기에서 추천 신경망이 한 번에 채점하는 판의 수 (게임은 recommend.ts 의 AI_SAMPLE). 게임은 2,000판이지만 학습 · 견주기는 수만 번 고르므로 줄인다 */
export const POOL = 500;

/**
 * 다음 판의 계획을 세우고 후보를 추린다 — 게임과 같은 함수 (fast 면 교사의 빠른 근사판).
 *
 * **마스터가 된 뒤에도 이어 간다** — 게임의 마스터 운행도 설정의 추천 AI 가 L10 후보에서 고르므로(사용자가 정했다,
 * 2026-11-01) 학습 · 견주기도 그 차례를 겪어야 한다. 한때는 마스터가 되면 과정을 끝냈다. 마스터에게는 레벨 값이 더 오르지
 * 않으므로 교사의 점수는 남을 실력 · 습관 · 새 상황 · 연패로만 갈린다 (아래 value). 지금 모델은 이 변경 전에 배웠지만 마스터
 * 차례에서도 잘 고른다 (아래 교사의 무게 주석의 마지막 항).
 */
export function decide(ep: Episode, fast = false, program = true): Decision {
  clock.ms = ep.clockMs;
  const plan = nextPlan(ep.save);
  const ids = ep.save.history.map((h) => h.st);
  const seen = seenShapes(ids);
  const cover = coverageOf(ids, plan.level);
  const turns = turnContext(ids);
  if (fast) {
    // 교사가 미리 달려 볼 때의 프로그램 — 규칙이 추린 후보에서 120개만 뽑아 점수로 고른다 (전부 채점하면 너무 느리다)
    const all = candidatesFor(plan, ids);
    const courses = all.length > FAST_SAMPLE ? sample(all, FAST_SAMPLE) : all;
    return { plan, courses, seen, cover, ids, pool: courses, turns };
  }
  // 신경망만 고르면(강화학습 — scripts/finetune-recommend.ts) 예전 프로그램의 후보는 세지 않는다
  const courses = program ? coursesByHabit(plan, ids, Math.random, seen, cover).groups.flatMap((g) => g.courses) : [];
  const pool = eligibleFor(plan, ids);
  return { plan, courses, seen, cover, ids, pool, turns };
}

/**
 * **행동 복제의 후보** — 과정 전문가(예전 규칙 · 프로그램 점수, 아래 programPick)가 고른 판을 맨 앞에, 탈 수 있는 판 가운데 **같은
 * 갈래**의 판에서 고르게 `k` 판을 뒤에 둔다. 추천 신경망은 맨 앞 판의 확률이 가장 높도록 배운다 (scripts/train-recommend.ts). 갈래는
 * 차례 신경망이 따로 배우므로(아래 turnRow), 추천 신경망은 갈래 안에서 고르는 것만 배운다 — 게임에서도 그렇게 쓴다.
 */
export function bcSet(d: Decision, expert: LibraryEntry, k: number, r: () => number, hard: readonly LibraryEntry[] = []): LibraryEntry[] {
  const cls = turnClassOf(expert);
  const same = d.pool.filter((e) => e !== expert && turnClassOf(e) === cls);
  const out: LibraryEntry[] = [expert];
  /*
    **어려운 오답을 먼저** — 전문가가 견주고도 고르지 않은 최종 후보(같은 갈래)를 앞에 둔다. 무작위 판만 오답으로 두면 신경망은 '전문가가
    고를 만한 판' 과 아무 판을 가르는 것만 배워(31판 가운데 1등 81%) 게임에서 2,000판을 채점할 때는 비슷하게 좋은 판들 사이에서 흐려졌다.
  */
  for (const e of hard) if (out.length < k + 1 && e !== expert && turnClassOf(e) === cls && !out.includes(e)) out.push(e);
  for (let tries = 0; out.length < k + 1 && same.length && tries < k * 4; tries++) {
    const e = same[Math.floor(r() * same.length)];
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/** 차례 신경망의 입력 — 브라우저와 같은 함수 (recommend.ts 의 turnInputs) */
export const turnRow = (d: Decision): number[] => turnFeatures(turnInputs(d.plan, d.turns, d.cover));

/**
 * **게임의 프로그램이 고르는 판** — 모델이 없을 때 게임이 쓰는 것과 같다 (recommend.ts 의 recommendScenario 끝). 마스터 운행이면
 * masterPick(가장 옅어진 개념을 시험하는 L10 코스 가운데 무작위 — 후보 밖에서도 고른다), 아니면 최종 후보에서 rulePick.
 */
export function programPick(d: Decision): LibraryEntry {
  if (d.plan.master) {
    // 설정의 갈래를 따른 L10 판에서 (recommend.ts 의 masterFrame — 게임과 같다). d.pool 은 그 테두리(eligibleFor)다
    const id = masterPick(d.ids, Math.random, d.plan.skills, Date.now(), masterFrame(d.pool)).scenario.id;
    const e = libraryEntry(id);
    if (e) return e;
  }
  return rulePick(d.plan, d.courses, Math.random, d.seen, d.cover);
}

const FAST_SAMPLE = 120;
function sample<T>(xs: readonly T[], n: number): T[] {
  const out: T[] = [];
  const taken = new Set<number>();
  while (out.length < n) {
    const i = Math.floor(Math.random() * xs.length);
    if (taken.has(i)) continue;
    taken.add(i);
    out.push(xs[i]);
  }
  return out;
}

/** 고른 판을 달리고 과정을 한 판 나아가게 한다 — 게임의 finishRun 과 같은 순서 */
export function play(ep: Episode, e: LibraryEntry): { violated: ViolationCode[] } {
  clock.ms = ep.clockMs;
  const before = ep.save.curriculum;
  const tested = habitsTestedBy(e.spec);
  const targets = [...tested];
  const predicted = predictOutcome(
    { spec: e.spec, targets, cost: e.cost },
    learnerVector(before.skills ?? {}, ep.clockMs),
    before.outcomeBias ?? {},
  );
  for (const k of coverKeys(e)) ep.seenKeys.add(`${before.level}|${k}`);
  const acc: { gain: number; learn?: number } = { gain: 0 };
  const violated = drive(ep.learner, e, ep.rand, ep.clockMs / 3_600_000, acc);
  const result = {
    violations: violated.map((code) => ({ code })),
    failReason: null,
  } as unknown as JudgeResult;
  const { next } = advance(before, result, tested, challengeRule(ep.save.settings.difficulty), {
    replay: ep.cleared.has(e.spec.id),
    now: ep.clockMs,
    difficulty: difficultyOf({ spec: e.spec, targets, cost: e.cost }),
    abilityPrior: abilityPriorFor(before.level),
    predicted,
  });
  ep.save.curriculum =
    ep.pin !== undefined && (next.level > ep.pin || next.mastered) ? { ...next, level: ep.pin, mastered: false, xp: 0 } : next;
  ep.save.history.push({ st: e.spec.id });
  if (!violated.length) ep.cleared.add(e.spec.id);
  if (next.missStreak >= 3) ep.frustration += 1;
  ep.runs += 1;
  ep.violations += violated.length;
  // 시간 — 판 하나에 3분, 몇 판마다 쉰다
  let hours = 0.05;
  const [uGap, uLen] = [ep.rand(), ep.rand()];
  ep.sessionLeft -= 1;
  let gap: { base: number; span: number } | undefined;
  if (ep.sessionLeft <= 0) {
    hours += 4 + uGap * 68;
    gap = { base: 0.05 + 4, span: 68 };
    ep.sessionLeft = 4 + Math.floor(uLen * 11);
  }
  forget(ep.learner, hours, ep.rand, acc, gap);
  ep.expKnown += acc.gain;
  ep.expLearned += acc.learn ?? 0;
  ep.clockMs += hours * 3_600_000;
  return { violated };
}

// ── 교사 ───────────────────────────────────────────────────────────────────

/**
 * **교사의 무게 다섯** — 레벨 · 습관 빚 · 새 상황 · 연패, 그리고 '하루 뒤 남을 실력' 1(핵심 개념은 아래 CORE_WEIGHT 만큼 더).
 * 이 게임에서 위반은 배우는 길이면서
 * 레벨을 막는 것이라(습관이 생긴다), 무게가 신경망을 '배우기' 와 '나아가기' 사이 어디에 둘지를 정한다. 고른 자리는
 * 처음 보는 가상 운전자에게 프로그램보다 레벨이 빠르고 연패가 적으면서 진짜 실력은 같거나 나은 곳이다 (train-recommend.ts
 * 의 견주기). 거쳐 온 자리 — 다시 손볼 때 같은 길을 되밟지 않게:
 *
 *  - 레벨 0.5 · 연패 0.3 · 습관 빚 없음: 모르는 개념을 묻지 않는 쉬운 판만 골라 레벨은 빠른데 진짜 익힌 개념이 줄었다
 *    (20판에 +1.3 → +0.3). 레벨은 브라우저의 짐작(BKT · 습관)이 문을 열어, 모르는 개념을 피해 가면 배우지 않고도 오른다.
 *  - 레벨 0.15 · 새 상황 0.02 (간격 효과 전): 아는 개념을 많이 묻는 복잡한 판으로 몰려 L7 40판에 정면 녹색 · 녹색 화살표를
 *    한 번도 겪지 않았다 (tests/recommend.test.ts 의 커버리지 검사). 원인은 무게가 아니라 운전자 쪽이었다 — drive 의 간격 효과.
 *  - 습관 빚 0.6 배: 레벨은 프로그램보다 2.3 높고 마스터가 두 배였지만 진짜 익힌 개념이 0.35 적었다. 0.3 배가 그 사이다.
 *  - **후보 추리기 · 차례까지 이 교사로 배우게 했더니**(2026-11-01) 신경망이 쉬운 아래 레벨 판으로 몰려 프로그램보다 익힌 개념
 *    −0.37 · 레벨 −1.25 였다 (프로그램 점수를 입력에 넣어도 같았다). 한 판 앞만 보는 이 교사에게는 '이 레벨의 판 · 습관을 시험하는
 *    판' 이 여러 판 뒤에 주는 값이 보이지 않는다. 그래서 그 일은 과정 전문가를 따라 배우게 했다 (train-recommend.ts 의 행동 복제).
 *  - **다양성 약속(tests/recommend.test.ts)은 학습마다 아슬아슬하다.** 마스터 운행 차례를 더하고 입력에 '마스터인가' 를 넣어
 *    다시 학습하자(2026-11-01) L7 40판에 정면 녹색이 한 번도 없었고 L2 보호구역 판의 97% 가 무신호였다(검사는 80% 이하).
 *    마스터 차례를 빼고 같은 자료로 배워도 85% 였다. 고르는 자리에 '새 상황 − 되풀이' 고정 항을 더해 보니 신경망 점수의
 *    후보 사이 폭(0.5)이 그 항의 폭(12)에 묻혀, 검사를 넘기는 무게(0.05 이상)에서 교사 1등 일치가 39% → 28%(0.2 면 21%,
 *    그때 60판 견주기는 익힌 개념 −0.26 · 레벨 −0.46 으로 프로그램보다 못했다). 그래서 모델은 그대로 두었다 — 마스터 운행을
 *    보지 않고 배운 모델이 이 시뮬레이터의 마스터 차례 7,938번에서도 교사 1등을 46% 고른다(무작위 22%, 마스터 입력을 넣은 모델은 검증 43%).
 *    다시 학습할 때 다양성 검사가 깨지면 새 상황의 무게(NOVEL_VALUE)부터 본다.
 */
/** 레벨 하나가 나아간 값 — 진짜 실력 개념 하나를 1 로 칠 때 */
export const LEVEL_VALUE = 0.15;
/** 이 레벨에서 새로 겪은 상황 하나 (`레벨|축=값`) */
export const NOVEL_VALUE = 0.02;
/** 연달아 셋 넘게 틀린 판 하나 — 모르는 개념 하나를 익힐 확률 절반쯤의 무게 */
export const FRUSTRATION_COST = 0.15;
/**
 * **습관 빚 한 칸** — 나쁜 습관이 풀리기까지 그 습관을 시험하는 판을 깨끗하게 더 지나야 하는 수(coach/badHabits.ts 의
 * runsToClear — 학습자 모델이 내다본 남은 판)의 한 칸. 습관이 남아 있으면 레벨이 오르지 않고, 이 게임은 습관 없는 무위반 한 판이 곧 레벨 하나라
 * (curriculum.ts 의 XP_TO_NEXT 200 = 무위반 한 판) 빚 한 칸은 레벨 한 걸음이 미뤄지는 것에 가깝다. 이것이 없으면 한 판만
 * 보는 교사에게 '습관을 시험해 푸는 판' 의 값이 보이지 않아 신경망이 습관을 오래 끌었다(60판에 레벨 −0.6).
 */
export const HABIT_DEBT_VALUE = 0.3 * LEVEL_VALUE;

/** 다음에 앉을 때까지의 흔한 간격 (시간) — 진짜 실력을 '그때까지 남아 있을 만큼' 으로 센다 */
export const RETAIN_HOURS = 24;

/**
 * **이 작품이 가르치려는 핵심 개념은 더 무겁게** — 일시정지 둘: 정면 적색에서 우회전 전 일시정지, 신호기 없는 어린이보호구역
 * 횡단보도에서 사람이 없어도 일시정지(제27조 제7항 — 사용자가 "신호없는 횡단보도가 핵심" 이라고 했다). 같게 치자 신경망이
 * 무신호 보호구역 판을 조금 덜 골라 L8 120판의 보호구역 판 중 무신호가 48% 였다 (tests/recommend.test.ts 는 50% 이상).
 */
export const CORE_WEIGHT: Partial<Record<ViolationCode, number>> = { RED_NO_STOP: 1.5, SCHOOL_ZONE_NO_STOP: 1.5 };

/**
 * **하루 뒤에도 남아 있을 진짜 실력** — 아는 개념마다 반감기로 깎은 값의 합(핵심 개념은 CORE_WEIGHT 만큼). 막 익힌 개념은
 * 잘 잊혀 조금만 치고, 여러 번 연습한 개념은 거의 다 친다. 그래서 흐려지기 쉬운 개념을 다시 묻는 판(복습)의 효과가 한 판
 * 안에서 보인다.
 */
export function retained(l: Learner): number {
  let v = 0;
  for (const c of SKILL_ORDER) {
    if (!l.known[c]) continue;
    v += (CORE_WEIGHT[c] ?? 1) * 2 ** (-RETAIN_HOURS / halfLifeOf(l, c));
  }
  return v;
}

/** 이 사람의 지금 값 — 남아 있을 진짜 실력 + 레벨 − 습관 빚 + 겪은 상황 − 좌절 */
export function value(ep: Episode): number {
  const c = ep.save.curriculum;
  const need = xpToNext(c.level, challengeRule(ep.save.settings.difficulty));
  const progress = c.level + Math.min(1, (c.xp ?? 0) / need) + (c.mastered ? 1 : 0);
  // 습관 빚 — 풀리기까지 학습자 모델이 내다본 남은 판 (coach/badHabits.ts 의 runsToClear)
  const debt = c.badHabits.reduce((s, h) => s + runsToClear(h, c.skills), 0);
  return (
    retained(ep.learner) +
    LEVEL_VALUE * progress -
    HABIT_DEBT_VALUE * debt +
    NOVEL_VALUE * ep.seenKeys.size -
    FRUSTRATION_COST * ep.frustration
  );
}

/**
 * **강화학습의 보상 잣대** (scripts/finetune-recommend.ts · scripts/ppo-rollout.ts) — 진짜로 아는 개념 수가 으뜸이고, 하루 뒤
 * 남을 실력 · 레벨 · 습관 빚 · 새 상황 · 연패를 무게대로 곁들인다. 위 value 는 한 판만 보는 교사의 잣대라 레벨 · 연패가 무겁다 —
 * 60판을 통째로 보는 강화학습에 그대로 쓰자 레벨만 오르고 진짜 실력은 프로그램보다 0.21 적었다 (2026-11-01).
 */
export interface RewardWeights {
  /** 새로 배운 개념 수의 기댓값 (잊음 없이 — 세션 사이의 잊음은 고르기와 거의 무관한 운이라 잡음만 보탠다) */
  learn: number;
  know: number;
  retain: number;
  level: number;
  debt: number;
  novel: number;
  frust: number;
}
/**
 * 기본 무게 (2026-11-01 셋째 판) — **견주기의 잣대와 같은 것: 끝에 아는 개념 수**(의 기댓값 expKnown — 배울 확률 − 쉬는 길이를
 * 평균한 잊을 확률)와 작은 레벨 몫뿐. 둘째 판(배운 횟수 learn 1 · retain 0.2 …)은 잊고 다시 배우는 것까지 쳐서(60판에 배움 15번,
 * 끝에 늘어난 앎은 1.2개) 레벨만 −0.33 떨어졌고, 첫 판의 retain(하루 뒤 남을 실력)은 **이미 아는 개념을 되풀이해 기억을 굳히는**
 * 쪽을 좋게 쳐 새 개념을 덜 가르쳤다.
 *
 * 그 전 기본 무게 (둘째 판) — **배움이 으뜸**. 첫 판(know 1 · retain 0.5 · level 0.05 · debt 0.015 · novel 0.01 · frust 0.03)으로
 * 배운 PPO 정책은 가상 운전자 4,000명에게 레벨은 프로그램보다 +0.09 였지만 진짜 아는 개념이 −0.15 였다 — 습관 빚 · 레벨 몫이
 * '쉬운 습관 판으로 깨끗한 판을 늘려 학습자 모델의 습관을 지우는' 쪽을 좋게 쳤다 (깨끗한 판에서는 거의 배우지 않는다).
 */
export const RL_REWARD: RewardWeights = { learn: 0, know: 1, retain: 0, level: 0.02, debt: 0, novel: 0, frust: 0 };

export function rewardWorth(ep: Episode, w: RewardWeights = RL_REWARD): number {
  const c = ep.save.curriculum;
  const need = xpToNext(c.level, challengeRule(ep.save.settings.difficulty));
  const progress = c.level + Math.min(1, (c.xp ?? 0) / need) + (c.mastered ? 1 : 0);
  const debt = c.badHabits.reduce((s, h) => s + runsToClear(h, c.skills), 0);
  return (
    w.learn * ep.expLearned +
    w.know * ep.expKnown +
    w.retain * retained(ep.learner) +
    w.level * progress -
    w.debt * debt +
    w.novel * ep.seenKeys.size -
    w.frust * ep.frustration
  );
}

export interface TeacherOptions {
  /** 후보마다 미리 달려 보는 횟수 */
  rollouts: number;
  /** 고른 판 뒤로 더 달려 보는 판 수 */
  horizon: number;
}

/**
 * 후보마다의 **교사 점수** — 그 판을 고르고(`horizon` 이 있으면 그만큼 프로그램으로 더 달린 뒤) 값이 얼마나 올랐는가의
 * 평균. 후보끼리 같은 씨앗을 쓴다 (공통 난수) — 점수의 차이가 운이 아니라 후보에서 나게. 기본은 `horizon` 0 이다 (위 교사).
 */
export function teacherScores(ep: Episode, courses: readonly LibraryEntry[], seed: number, opt: TeacherOptions): number[] {
  const v0 = value(ep);
  return courses.map((e) => {
    let total = 0;
    for (let k = 0; k < opt.rollouts; k++) {
      const s = seed * 7919 + k * 104729;
      const sim = cloneEpisode(ep, rng(s + 1));
      seedGame(s + 2);
      play(sim, e);
      for (let h = 0; h < opt.horizon; h++) {
        const d = decide(sim, true);
        if (!d.courses.length) break;
        play(sim, programPick(d));
      }
      total += value(sim) - v0;
    }
    return total / opt.rollouts;
  });
}

/** 후보들을 신경망의 입력으로 — 브라우저와 같은 함수 (recommend.ts 의 courseInputs) */
export function featureRows(d: Decision, courses: readonly LibraryEntry[] = d.courses): number[][] {
  const verdict = verdictsFor(d.plan, d.cover);
  const recent = recentSet(d.ids);
  return courses.map((e) => recommendFeatures(courseInputs(d.plan, e, d.seen, d.cover, verdict, d.turns, recent)));
}

export { knownCount };
