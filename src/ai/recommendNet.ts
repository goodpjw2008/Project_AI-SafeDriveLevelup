/**
 * **다음 판 추천 신경망 — 탈 수 있는 판 가운데 이 학습자에게 맞는 판을 고른다.**
 *
 * 설정 'AI 사용 설정' 의 **로컬 신경망 기반**(기본)이 이것이다. 이 레벨 · 연습 갈래에서 탈 수 있는 판 가운데 2,000판을
 * 뽑아(scenarios/recommend.ts 의 aiCourses) **차례 신경망**이 이번 판의 갈래(보호구역의 신호기 유무 · 앞차 · 전용 도로 — 아래
 * TURN_CLASSES)를 뽑고, 그 갈래의 판마다 점수 하나를 내어 점수를 확률로 바꿔 한 판을 고른다. 점수 순 10판(모양이
 * 겹치지 않게, 습관이 여럿이면 습관마다 가장 높은 판 하나씩)이 최종 후보이고 — 외부 LLM 이면 그 10판을 LLM 이 받는다. 서버 · 키 · 사용 한도 없이 브라우저 안에서 끝난다.
 *
 * 한때는 규칙이 후보를 거르고 보호구역 · 앞차 차례를 주사위로 굴리고 프로그램 점수가 10판을 추린 뒤 마지막 하나만 신경망이
 * 골랐다. 이제 그 모두를 이 신경망이 한다 — 사용자가 정했다 (2026-11-01: *"교통법규 준수 등 정말 어쩔수 없는경우는 프로그램으로
 * 남기고 나머지는 모두 AI 기법으로"*). 남은 테두리는 고른 연습 갈래 · 아직 열지 않은 레벨의 개념 · 최근 20판뿐이다.
 *
 * ## 무엇을 보는가 — 브라우저가 아는 것만
 *
 * 학습자 쪽은 레벨 · 경험치 · 흐름(연속 무위반 · 연속 실패) · 나쁜 습관 · 개념별 숙달(ai/knowledge.ts, 망각을 깎은 값)이고,
 * 판 쪽은 시험하는 개념 · 결과 예측 모델이 낸 개념별 어길 확률(ai/outcome.ts) · 예상 성공률(ai/difficulty.ts) · 최근에
 * 탄 모양과 겹치는 정도 · 이 레벨에서 처음 보는 상황인지 · 이 레벨의 판인가다. 그 둘의 곱(시험하는 개념의 미숙달)도 넣는다.
 * 그리고 **최근 판의 차례** — 보호구역 · 신호기 없는 보호구역 · 앞차 · 보호구역 전용 도로가 최근 몇 판에 얼마나 나왔고 마지막이
 * 언제였나 — 를 보고, 이 판이 그 비율을 맞추는 쪽인지도 본다. 특징 이름은 `REC_FEATURES` 하나로 정하고, 학습 스크립트와
 * 브라우저가 같은 함수(`recommendFeatures`)로 센다.
 *
 * ## 어떻게 배웠는가 — 과정 전문가를 따라 (행동 복제)
 *
 * 사람의 기록은 각자의 브라우저에만 있어 모을 수 없다. 그래서 `scripts/train-recommend.ts` 가 **가상 운전자 수천 명**
 * (개념마다 진짜 실력 · 배우는 빠르기 · 잊는 빠르기가 다르다)에게 판을 골라 주며 과정을 밟게 하고, 고를 때마다 **예전의 규칙 ·
 * 프로그램 점수가 골랐을 판**을 정답으로 적는다. 신경망은 그 판의 점수가 탈 수 있는 다른 판들보다 높도록 배운다 — 신호 판단
 * 신경망이 도로교통법 규칙을 따라 배운 것과 같다. 둘째 · 셋째 차례는 신경망이 직접 고르며 만난 상황에서 정답을 다시 받는다
 * (DAgger — 따라 하는 쪽이 스스로 만든 상황에서 틀리는 것을 막는다). 규칙은 학습 때 정답을 대는 데만 쓰이고, 게임에서는 돌지 않는다.
 *
 * **고르기는 둘로 나뉜다.** 차례 신경망(아래 TURN_CLASSES)은 전문가가 고른 판의 갈래를 맞히도록 배우고, 추천 신경망은 같은 갈래의
 * 판들 가운데서 전문가의 판을 맞히도록 배운다. 하나로 배우게 했더니 갈래의 비율이 탈 수 있는 판의 구성을 따라 흔들렸다 — 보호구역
 * 판이 많은 레벨에서 보호구역이 85~98% 나오고, 신호기 없는 쪽은 26~42% 로 떨어졌다 (tests/recommend.test.ts 의 다양성 검사).
 *
 * 전문가의 차례가 주사위라서 같은 상황에서도 고르는 판이 달랐다 — 그래서 두 신경망 모두 1등만 고르지 않고 **확률대로 뽑는다**
 * (소프트맥스 정책). 그래야 보호구역 · 앞차가 나오는 비율이 전문가와 같게 남는다.
 *
 * 한 판 앞만 보고 매긴 교사 점수를 따라 하게 했을 때는 쉬운 아래 레벨 판으로 몰려 가상 운전자의 레벨이 프로그램보다 1.25 낮았다
 * (scripts/recommendSim.ts 의 교사 주석) — 과정 전문가를 먼저 따라 배우는 까닭이다.
 *
 * ## 왜 골랐는지 — 가려 보기
 *
 * 고른 판의 특징을 무리(습관 · 약한 개념 · 난이도 맞춤 · 새 상황 · 복습)마다 하나씩 후보들의 평균으로 바꿔 보고,
 * 점수가 가장 많이 떨어지는 무리를 "신경망이 가장 크게 본 근거" 로 적는다 (`explainPick`).
 *
 * 순수 모듈이다. 학습한 가중치는 models/recommend.json — 없으면(학습 전) `recommendModelReady` 가 거짓이다.
 */

import type { ViolationCode } from '../rules/violations';
import { SKILL_ORDER } from './knowledge';
import { LEAD_CAR_CHANCE, SCHOOL_ZONE_CHANCE, ZONE_NO_SIGNAL_CHANCE } from '../scenarios/scenarios';
import trained from './models/recommend.json';

/** 학습자 쪽과 판 쪽의 입력 — 부르는 쪽(scenarios/recommend.ts 의 courseInputs)이 채운다 */
export interface CourseInputs {
  /** 지금 레벨 1~10 */
  level: number;
  /** 난이도 설정 1~5 */
  challenge: number;
  /** 지금 레벨의 경험치 막대 0~1 */
  xpFrac: number;
  cleanStreak: number;
  missStreak: number;
  /** 나쁜 습관 — 개념별 횟수 */
  habits: Partial<Record<ViolationCode, number>>;
  /** 가장 많이 한 습관 (curriculum.ts 의 currentTarget) */
  target: ViolationCode | null;
  /** 능력 θ − 그 레벨의 평균 난이도 (ai/difficulty.ts) */
  abilityRel: number;
  /** 개념별 실효 숙달 0~1 — 시험된 적 없으면 처음 값 */
  mastery: Record<ViolationCode, number>;
  /** 개념별로 시험된 적이 있는가 */
  tested: Record<ViolationCode, boolean>;
  /** 이 판이 시험하는 개념 */
  tests: ReadonlySet<ViolationCode>;
  /** 결과 예측 모델의 개념별 어길 확률 — 모델이 없으면 null */
  predict: Partial<Record<ViolationCode, number>> | null;
  /** 위반 없이 지날 확률 (결과 예측) — 없으면 null */
  clean: number | null;
  /** 예상 성공률 (난이도 모델) — 없으면 undefined */
  success: number | undefined;
  /** 약한 개념에서 결과가 불확실한 정도 (ai/outcome.ts 의 info) */
  info: number;
  weak: boolean;
  zpd: boolean;
  review: boolean;
  /** 판의 레벨 − 지금 레벨 */
  levelDiff: number;
  /** 조건 점수 (scenarios/difficulty.ts) */
  cost: number;
  /** 최근에 탄 모양과 겹친 정도 (recommend.ts 의 되풀이 감점) */
  repeat: number;
  /** 이 레벨에서 아직 안 겪은 상황의 무게 (recommend.ts 의 새것 보너스) */
  novelty: number;
  /** 최근 판의 차례 (recommend.ts 의 turnContext) — 이 판을 고르면 그 비율이 어느 쪽으로 가는가를 함께 본다 */
  turns: TurnContext;
  /** 설정의 연습 구분 — 자동이면 갈래도 신경망이 정한다 (보호구역 전용 도로를 고르면 그 갈래다) */
  track: 'auto' | 'both' | 'turn' | 'zone';
  /** 신호기 없는 보호구역이 이 레벨에서 열렸는가 */
  noSignalOpen: boolean;
  /** 이 판이 지금 레벨의 판인가 (아래 레벨은 복습, 위 레벨은 미리 보기) */
  sameLevel: boolean;
  /** 지금 레벨이 새 개념을 여는 레벨인가 (종합 레벨 포함) — 그 레벨에서는 새 개념의 판이 먼저다 */
  levelOpens: boolean;
  /** 안전운전 마스터인가 */
  master: boolean;
  /** 보호구역 전용 도로(사거리 없이 횡단보도 셋)의 판인가 (scenarios/zoneCourse.ts) */
  zoneCourse: boolean;
  zone: boolean;
  noSignalZone: boolean;
  lead: boolean;
}

const pct = (v: number) => Math.max(0, Math.min(1, v));

/**
 * **최근 판의 차례** — 마지막 `TURN_WINDOW` 판(scenarios/recommend.ts)에서 보호구역 · 신호기 없는 보호구역 · 앞차가 얼마나
 * 나왔고, 마지막으로 나온 뒤 몇 판이 지났는가. 기록이 없으면 비율은 목표값(아래 TURN_TARGET)이다.
 */
export interface TurnContext {
  zoneShare: number;
  /** 보호구역 판 가운데 신호기 없는 판의 비율 */
  noSignalShare: number;
  leadShare: number;
  sinceZone: number;
  sinceNoSignal: number;
  sinceLead: number;
  /** 보호구역 전용 도로를 마지막으로 탄 뒤 몇 판 */
  sinceZoneCourse: number;
  /** 최근 `NO_SIGNAL_ZONE_GAP` 판(scenarios/recommend.ts)에 신호기 없는 보호구역이 하나도 없었는가 */
  noSignalDue: boolean;
  /** 최근 `ZONE_GAP` 판(scenarios/tracks.ts)에 보호구역 전용 도로가 하나도 없었는가 */
  roadDue: boolean;
}

/**
 * **차례의 목표 비율** — 사용자가 정한 것들이다: 보호구역은 네 판에 한 판, 그중 신호기 없는 쪽이 핵심이라 65%, 앞차는 세 판에
 * 한 판 (scenarios.ts 의 SCHOOL_ZONE_CHANCE · ZONE_NO_SIGNAL_CHANCE · LEAD_CAR_CHANCE). 예전에는 프로그램이 이 확률로 주사위를
 * 굴렸다. 신경망은 그 결과를 따라 배우고, 이 값은 '이 판이 비율을 맞추는 쪽인가' 입력의 기준으로만 쓴다.
 */
export const TURN_TARGET = { zone: SCHOOL_ZONE_CHANCE, noSignal: ZONE_NO_SIGNAL_CHANCE, lead: LEAD_CAR_CHANCE } as const;
/** 몇 판 이상 지난 것은 같게 본다 */
const SINCE_CAP = 8;

// ── 차례 신경망 — 이번 판이 어느 갈래인가 ────────────────────────────────────

/**
 * **차례의 갈래** — 이번 판이 보호구역(신호 있는 · 신호기 없는)인가 보통 교차로인가, 앞차가 있는가, 보호구역 전용 도로인가.
 * 예전에는 프로그램이 주사위(보호구역 네 판에 한 판 · 그중 신호기 없는 쪽 65% · 앞차 세 판에 한 판)와 바닥(신호기 없는 보호구역이
 * 세 판째 없으면 반드시 · 자동이면 전용 도로가 다섯 판째 없으면 반드시)으로 정했다. 이제 **차례 신경망**이 정한다.
 *
 * 판 하나의 점수만 보고 고르게 하면 이 비율이 **탈 수 있는 판의 구성**을 따라 흔들린다 — 보호구역 판이 많은 레벨에서는 보호구역이
 * 90% 넘게 나왔다. 그래서 고르기를 둘로 나눈다: 차례 신경망이 갈래를 뽑고(판의 구성은 보지 않는다 — 그 갈래의 판이 있는지만
 * 본다), 추천 신경망이 그 갈래 안에서 판을 고른다. 프로그램이 주사위로 갈래를 정한 뒤 후보 안에서 고르던 것과 같은 짜임이다.
 */
export const TURN_CLASSES = ['plain', 'plainLead', 'signalZone', 'signalZoneLead', 'noSignal', 'noSignalLead', 'zoneRoad'] as const;
export type TurnClass = (typeof TURN_CLASSES)[number];
/** 화면에 적는 갈래 이름 (분석 화면 ui/AiPick.ts) */
export const TURN_LABEL: Record<TurnClass, string> = {
  plain: '보통 교차로',
  plainLead: '보통 교차로 · 앞차',
  signalZone: '신호 있는 어린이보호구역',
  signalZoneLead: '신호 있는 어린이보호구역 · 앞차',
  noSignal: '신호기 없는 어린이보호구역',
  noSignalLead: '신호기 없는 어린이보호구역 · 앞차',
  zoneRoad: '어린이보호구역 전용 도로',
};

/** 판의 갈래 — 보호구역 전용 도로가 먼저, 그다음 보호구역의 신호기 유무 · 앞차 */
export function turnClass(x: { zone: boolean; noSignalZone: boolean; lead: boolean; zoneCourse: boolean }): TurnClass {
  if (x.zoneCourse) return 'zoneRoad';
  const base = x.noSignalZone ? 'noSignal' : x.zone ? 'signalZone' : 'plain';
  return x.lead ? `${base}Lead` : base;
}

/** 차례 신경망의 입력 — 학습자 쪽만 (판 쪽은 보지 않는다) */
export interface TurnInputs {
  level: number;
  master: boolean;
  track: 'auto' | 'both' | 'turn' | 'zone';
  /** 먼저 고칠 습관 — 습관마다 그것을 시험하는 갈래가 다르다 */
  target: ViolationCode | null;
  habits: Partial<Record<ViolationCode, number>>;
  turns: TurnContext;
  /** 보호구역이 열린 레벨인가 (scenarios/tracks.ts 의 zoneOpensAt) */
  zoneOpen: boolean;
  noSignalOpen: boolean;
  levelOpens: boolean;
  /**
   * **이 레벨에서 이미 겪은 갈래** — 이 레벨(이웃 레벨은 반)에서 탄 판의 수 (scenarios/recommend.ts 의 coverageOf). 예전 프로그램은
   * 이 레벨에서 아직 안 겪은 상황을 좋게 쳐서, 레벨이 막 열렸을 때와 한참 머문 뒤의 갈래가 달랐다.
   */
  cover: { plain: number; signalZone: number; noSignal: number; lead: number };
}

export const TURN_FEATURES: readonly string[] = [
  'level',
  'master',
  'trackAuto',
  'trackBoth',
  'trackTurn',
  'trackZone',
  'zoneOpen',
  'noSignalOpen',
  'levelOpens',
  'zoneShare',
  'noSignalShare',
  'leadShare',
  'sinceZone',
  'sinceNoSignal',
  'sinceLead',
  'sinceZoneCourse',
  'noSignalDue',
  'roadDue',
  ...SKILL_ORDER.map((c) => `target:${c}`),
  'noTarget',
  ...SKILL_ORDER.map((c) => `h:${c}`),
  'cover:plain',
  'cover:signalZone',
  'cover:noSignal',
  'cover:lead',
];

export function turnFeatures(x: TurnInputs): number[] {
  const t = x.turns;
  const cap = (n: number) => Math.min(SINCE_CAP, n) / SINCE_CAP;
  return [
    x.level / 10,
    x.master ? 1 : 0,
    x.track === 'auto' ? 1 : 0,
    x.track === 'both' ? 1 : 0,
    x.track === 'turn' ? 1 : 0,
    x.track === 'zone' ? 1 : 0,
    x.zoneOpen ? 1 : 0,
    x.noSignalOpen ? 1 : 0,
    x.levelOpens ? 1 : 0,
    t.zoneShare,
    t.noSignalShare,
    t.leadShare,
    cap(t.sinceZone),
    cap(t.sinceNoSignal),
    cap(t.sinceLead),
    cap(t.sinceZoneCourse),
    t.noSignalDue ? 1 : 0,
    t.roadDue ? 1 : 0,
    ...SKILL_ORDER.map((c) => (x.target === c ? 1 : 0)),
    x.target ? 0 : 1,
    ...SKILL_ORDER.map((c) => Math.min(3, x.habits[c] ?? 0) / 3),
    Math.min(3, x.cover.plain) / 3,
    Math.min(3, x.cover.signalZone) / 3,
    Math.min(3, x.cover.noSignal) / 3,
    Math.min(3, x.cover.lead) / 3,
  ];
}

/** 은닉층 하나(tanh) · 출력은 갈래마다 하나 (소프트맥스) */
export interface TurnNet {
  names: readonly string[];
  classes: readonly string[];
  W1: ReadonlyArray<readonly number[]>;
  b1: readonly number[];
  W2: ReadonlyArray<readonly number[]>;
  b2: readonly number[];
}

const turnReady = (net: TurnNet | undefined): boolean =>
  !!net &&
  net.names.length === TURN_FEATURES.length &&
  net.names.every((n, i) => n === TURN_FEATURES[i]) &&
  net.classes.length === TURN_CLASSES.length &&
  net.classes.every((n, i) => n === TURN_CLASSES[i]);

/**
 * **갈래마다의 확률** — 탈 수 있는 판이 있는 갈래(`available`)만으로 다시 나눈다. 순서는 `TURN_CLASSES` 다.
 */
export function turnProbs(x: TurnInputs, available: ReadonlySet<TurnClass>, model: RecommendModel = MODEL): number[] {
  const net = model.turn!;
  const z = turnFeatures(x);
  const h = net.W1.map((row, q) => Math.tanh(row.reduce((s, w, j) => s + w * z[j], net.b1[q])));
  const logits = net.W2.map((row, k) => row.reduce((s, w, q) => s + w * h[q], net.b2[k]));
  const top = Math.max(...logits.filter((_, k) => available.has(TURN_CLASSES[k])));
  const w = logits.map((v, k) => (available.has(TURN_CLASSES[k]) ? Math.exp(v - top) : 0));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((v) => v / sum);
}

/** 특징 이름 — 순서가 곧 모델의 입력 순서다. **바꾸면 다시 학습해야 한다** (tests/recommendNet.test.ts 가 잡는다) */
export const REC_FEATURES: readonly string[] = [
  'level',
  'challenge',
  'xpFrac',
  'cleanStreak',
  'missStreak',
  'habitCount',
  'abilityRel',
  ...SKILL_ORDER.map((c) => `m:${c}`),
  ...SKILL_ORDER.map((c) => `seen:${c}`),
  ...SKILL_ORDER.map((c) => `h:${c}`),
  ...SKILL_ORDER.map((c) => `x:${c}`),
  ...SKILL_ORDER.map((c) => `gap:${c}`),
  ...SKILL_ORDER.map((c) => `p:${c}`),
  'targetHit',
  'habitHits',
  'clean',
  'success',
  'info',
  'weak',
  'zpd',
  'review',
  'levelDiff',
  'cost',
  'repeat',
  'novelty',
  'zone',
  'noSignalZone',
  'lead',
  'trackTurn',
  'trackZone',
  'noSignalOpen',
  'zoneShare',
  'noSignalShare',
  'leadShare',
  'sinceZone',
  'sinceNoSignal',
  'sinceLead',
  // 이 판을 고르면 비율이 목표 쪽으로 가는가 (+) 멀어지는가 (−) — 작은 신경망이 곱을 스스로 찾지 않아도 되게 미리 곱해 둔다
  'zoneBalance',
  'noSignalBalance',
  'leadBalance',
  'noSignalDue',
  'trackAuto',
  'sameLevel',
  'levelOpens',
  'master',
  'zoneCourse',
  'sinceZoneCourse',
];

export function recommendFeatures(x: CourseInputs): number[] {
  const habitCodes = Object.keys(x.habits) as ViolationCode[];
  const row: number[] = [
    x.level / 10,
    (x.challenge - 3) / 2,
    pct(x.xpFrac),
    Math.min(5, x.cleanStreak) / 5,
    Math.min(3, x.missStreak) / 3,
    Math.min(3, habitCodes.length) / 3,
    x.abilityRel,
  ];
  for (const c of SKILL_ORDER) row.push(x.mastery[c]);
  for (const c of SKILL_ORDER) row.push(x.tested[c] ? 1 : 0);
  for (const c of SKILL_ORDER) row.push(Math.min(3, x.habits[c] ?? 0) / 3);
  for (const c of SKILL_ORDER) row.push(x.tests.has(c) ? 1 : 0);
  for (const c of SKILL_ORDER) row.push(x.tests.has(c) ? 1 - x.mastery[c] : 0);
  for (const c of SKILL_ORDER) row.push(x.predict?.[c] ?? 0);
  row.push(
    x.target && x.tests.has(x.target) ? 1 : 0,
    Math.min(3, habitCodes.filter((c) => x.tests.has(c)).length) / 3,
    x.clean ?? x.success ?? 0.5,
    x.success ?? 0.5,
    x.info,
    x.weak ? 1 : 0,
    x.zpd ? 1 : 0,
    x.review ? 1 : 0,
    x.levelDiff / 3,
    x.cost / 10,
    x.repeat / 5,
    x.novelty / 10,
    x.zone ? 1 : 0,
    x.noSignalZone ? 1 : 0,
    x.lead ? 1 : 0,
    x.track === 'turn' ? 1 : 0,
    x.track === 'zone' ? 1 : 0,
    x.noSignalOpen ? 1 : 0,
  );
  const t = x.turns;
  const sign = (b: boolean) => (b ? 1 : -1);
  row.push(
    t.zoneShare,
    t.noSignalShare,
    t.leadShare,
    Math.min(SINCE_CAP, t.sinceZone) / SINCE_CAP,
    Math.min(SINCE_CAP, t.sinceNoSignal) / SINCE_CAP,
    Math.min(SINCE_CAP, t.sinceLead) / SINCE_CAP,
    sign(x.zone) * (TURN_TARGET.zone - t.zoneShare),
    x.zone ? sign(x.noSignalZone) * (TURN_TARGET.noSignal - t.noSignalShare) : 0,
    sign(x.lead) * (TURN_TARGET.lead - t.leadShare),
    x.noSignalZone ? Math.min(SINCE_CAP, t.sinceNoSignal) / SINCE_CAP : 0,
    x.track === 'auto' ? 1 : 0,
    x.sameLevel ? 1 : 0,
    x.levelOpens ? 1 : 0,
    x.master ? 1 : 0,
    x.zoneCourse ? 1 : 0,
    Math.min(SINCE_CAP, t.sinceZoneCourse) / SINCE_CAP,
  );
  return row;
}

export interface RecommendModel {
  kind: 'recommend-mlp';
  names: readonly string[];
  mean: readonly number[];
  std: readonly number[];
  W1: ReadonlyArray<readonly number[]>;
  b1: readonly number[];
  /** 출력은 점수 하나 — 후보끼리 소프트맥스로 견준다 */
  w2: readonly number[];
  b2: number;
  /** 차례 신경망 — 이번 판의 갈래를 뽑는다 (위 TURN_CLASSES) */
  turn?: TurnNet;
  meta: { trained: boolean; [k: string]: unknown };
}

const MODEL = trained as unknown as RecommendModel;

/** 학습한 모델이 있고 특징 이름이 지금 코드와 같은가 (추천 · 차례 둘 다) — 아니면 로컬은 프로그램 점수로 고른다 */
export const recommendModelReady = (model: RecommendModel = MODEL): boolean =>
  model.meta?.trained === true &&
  model.names.length === REC_FEATURES.length &&
  model.names.every((n, i) => n === REC_FEATURES[i]) &&
  turnReady(model.turn);

const standardize = (x: readonly number[], model: RecommendModel): number[] =>
  x.map((v, j) => (v - model.mean[j]) / (model.std[j] || 1));

/** 표준화한 입력 하나의 점수 */
function scoreZ(z: readonly number[], model: RecommendModel): number {
  let out = model.b2;
  for (let i = 0; i < model.W1.length; i += 1) {
    const row = model.W1[i];
    let s = model.b1[i];
    for (let j = 0; j < row.length; j += 1) s += row[j] * z[j];
    out += model.w2[i] * Math.tanh(s);
  }
  return out;
}

/** 후보마다의 점수 — 클수록 이 학습자에게 맞는 판 */
export function scoreCourses(rows: ReadonlyArray<readonly number[]>, model: RecommendModel = MODEL): number[] {
  return rows.map((x) => scoreZ(standardize(x, model), model));
}

/** 설명에 쓰는 특징 무리 — 이름의 앞부분으로 고른다 */
export type ReasonGroup = 'habit' | 'weak' | 'fit' | 'novel' | 'review' | 'turn';
const GROUPS: Record<ReasonGroup, (name: string) => boolean> = {
  habit: (n) => n === 'targetHit' || n === 'habitHits',
  weak: (n) => n.startsWith('gap:') || n.startsWith('p:') || n === 'info' || n === 'weak',
  fit: (n) => n === 'success' || n === 'clean' || n === 'zpd' || n === 'levelDiff' || n === 'cost',
  novel: (n) => n === 'novelty' || n === 'repeat',
  review: (n) => n === 'review',
  // 최근 판의 차례를 맞추는 쪽인가 — 보호구역 · 무신호 · 앞차가 한동안 없었으면 그 판
  turn: (n) => n.endsWith('Balance') || n === 'noSignalDue',
};

/**
 * **왜 이 판인가 — 가려 보기(occlusion).** 고른 판의 특징 무리를 하나씩 후보들의 평균으로 바꿔 점수가 얼마나
 * 떨어지는지 잰다. 가장 많이 떨어지는 무리가 신경망이 이 판을 고른 가장 큰 근거다. 떨어지는 무리가 없으면 null.
 */
export function explainPick(
  rows: ReadonlyArray<readonly number[]>,
  chosen: number,
  model: RecommendModel = MODEL,
): { group: ReasonGroup; drop: number } | null {
  const zs = rows.map((x) => standardize(x, model));
  const avg = model.names.map((_, j) => zs.reduce((s, z) => s + z[j], 0) / zs.length);
  const base = scoreZ(zs[chosen], model);
  let best: { group: ReasonGroup; drop: number } | null = null;
  for (const group of Object.keys(GROUPS) as ReasonGroup[]) {
    const z = zs[chosen].map((v, j) => (GROUPS[group](model.names[j]) ? avg[j] : v));
    const drop = base - scoreZ(z, model);
    if (drop > 0 && (!best || drop > best.drop)) best = { group, drop };
  }
  return best;
}
