/**
 * **로컬 코치 — 결과 화면의 '주행결과 분석' 과 습관 리포트의 '습관 진단' 을 브라우저 안의 신경망이 쓴다.**
 *
 * 설정 'AI 사용 설정' 이 로컬 신경망 기반(기본)이면 서버에 묻지 않고 이것이 쓴다. 외부 LLM 이면 서버의 AI 가 쓰고, 답이 없을 때
 * 이것이 대신한다 (사용자가 정했다, 2026-11-01: *"주행분석등 모든것을 신경망으로 동작 하거나 llm으로 동작하게"*).
 *
 * ## 무엇을 하는가 — 고르기
 *
 * 브라우저에서 돌릴 수 있는 크기의 모델로는 좋은 한국어 문장을 새로 지어낼 수 없다. 그래서 **외부 LLM 이 미리 쓴 문장 은행**
 * (models/coach.json 의 bank — 위반 · 자리마다, 칭찬 · 습관 진단의 자리마다 여러 가지)에서 이 판 · 이 기록에 맞는 문장을
 * 고른다. 무엇을 먼저 말할지(위반이 둘이면 어느 쪽), 같은 뜻의 여러 문장 가운데 무엇을, 한 줄을 더 붙일지를 **신경망이 정한다.**
 *
 * ## 어떻게 배웠나 — LLM 코치를 따라
 *
 * scripts/train-coach.ts 가 시뮬레이터로 가상 주행 수백 판과 가상 기록 수백 개를 만들고, 판마다 외부 LLM 에게 "이 판에 맞는
 * 문장을 은행에서 골라 순서대로" 묻는다. 신경망은 브라우저가 아는 것(판정 결과 · 집계)만 보고 그 고르기를 따라 배운다 —
 * 추천 신경망이 교사를 따라 배운 것과 같은 증류다.
 *
 * ## 거짓말을 하지 않게
 *
 * 문장은 **그 판에 실제로 있었던 위반 · 자리 · 조건의 것만** 후보에 오른다 — 신경망이 무엇을 골라도 일어나지 않은 위반을 말할 수
 * 없다. 습관 진단의 숫자는 문장의 빈칸(`{rate}` 같은 것)에 집계(coach/habits.ts)의 값을 그대로 넣는다 — 숫자는 신경망이 만들지 않는다.
 */

import type { HabitSummary } from '../coach/habits';
import type { JudgeResult } from '../rules/lawRules';
import type { ViolationCode } from '../rules/violations';
import type { LibraryTags } from '../scenarios/library';
import trained from './models/coach.json';

// ── 문장 은행의 자리 ───────────────────────────────────────────────────────

/** 위반 코드 — 은행의 자리 이름과 신경망 입력의 순서가 이것을 따른다 */
export const COACH_CODES: readonly ViolationCode[] = [
  'RED_NO_STOP',
  'RIGHT_ARROW_RED',
  'PEDESTRIAN_BLOCKED',
  'BIKE_BLOCKED',
  'SCHOOL_ZONE_NO_STOP',
  'NO_SLOW_DOWN',
  'WIDE_TURN',
  'BLOCKING_INTERSECTION',
  'NO_TURN_SIGNAL',
  'OVER_STOP_LINE',
  'SCHOOL_ZONE_RED',
  'STRAIGHT_RED',
];

/**
 * **자리를 나눠 말해야 하는 위반** — 같은 보행자 방해라도 교차로에 들어가기 전(정지선 · 진입 전 횡단보도 · 진입로 보호구역)과
 * 지난 뒤(우회전 후 · 건너편 횡단보도)는 고칠 것이 다르다. 뒤쪽이 "보행신호가 아니라 보행자가 기준" 이라는 오해의 자리다.
 */
const PLACED: ReadonlySet<ViolationCode> = new Set(['PEDESTRIAN_BLOCKED', 'BIKE_BLOCKED', 'SCHOOL_ZONE_NO_STOP']);

/** 위반 하나를 말하는 자리 — `issue:코드` · `issue:코드:before|after` · 앞차를 따라간 적색 무정지는 `issue:RED_NO_STOP:lead` */
export const ISSUE_KEYS: readonly string[] = COACH_CODES.flatMap((c) =>
  PLACED.has(c) ? [`issue:${c}:before`, `issue:${c}:after`] : c === 'RED_NO_STOP' ? [`issue:${c}`, `issue:${c}:lead`] : [`issue:${c}`],
);
export const FAILS = ['PEDESTRIAN_HIT', 'VEHICLE_COLLISION', 'OFF_ROAD', 'TIMEOUT'] as const;
/** 위반 없이 마친 판의 칭찬에 얹을 수 있는 조건 — 제목 · 판에 실제로 있던 것만 */
export const CONDS = ['rain', 'night', 'child', 'elder', 'zone', 'lead', 'honk'] as const;

/** 주행결과 분석의 자리 전부 */
export const COACH_KEYS: readonly string[] = [
  ...ISSUE_KEYS,
  ...COACH_CODES.map((c) => `next:${c}`),
  ...FAILS.map((f) => `fail:${f}`),
  'clean:general',
  ...CONDS.map((c) => `clean:${c}`),
];

/** 습관 진단이 보는 네 지점 — coach/habits.ts 의 points 순서 */
export const POINTS = 4;
/** 습관 진단의 오해 — 정면 적색 · 우회전 후 횡단보도 · 신호기 없는 보호구역 · 앞차, 그리고 특정한 오해가 보이지 않을 때 */
export const MISCONCEPTIONS = ['red', 'after', 'zone', 'lead', 'generic'] as const;

/** 습관 진단의 자리 전부 */
export const REPORT_KEYS: readonly string[] = [
  'r:strong',
  'r:start',
  ...Array.from({ length: POINTS }, (_, i) => `r:weak:${i}`),
  ...COACH_CODES.map((c) => `r:code:${c}`),
  ...MISCONCEPTIONS.map((m) => `r:why:${m}`),
  'r:trend:up',
  'r:trend:down',
  'r:trend:flat',
  ...Array.from({ length: POINTS }, (_, i) => `r:next:${i}`),
];

// ── 상황 ────────────────────────────────────────────────────────────────

/** 주행결과 분석이 보는 것 — 판정 결과와 그 판의 조건 */
export interface CoachSituation {
  /** 이 판의 자리들 (위반 · 실패 · 칭찬) — 은행에서 이 자리의 문장만 후보에 오른다 */
  keys: string[];
  /** 위반 코드 (나온 차례) */
  codes: ViolationCode[];
  fail: (typeof FAILS)[number] | null;
  clean: boolean;
  grade: JudgeResult['grade'];
  conds: Set<(typeof CONDS)[number]>;
  stats: { stopA: boolean; lateA: boolean; stopC: boolean; speeding: boolean; signalOff: boolean };
  drive: 'rightTurn' | 'straight' | 'zoneOnly';
}

/** 위반이 교차로를 지난 뒤에 났는가 — 판정이 붙인 자리 이름으로 가른다 (rules/lawRules.ts 의 placeLabel) */
const afterTurn = (place: string): boolean => /우회전 후|우회전 진출로|건너편|보호구역 진출로/.test(place);

/** 판정 결과 → 상황. `tags` 는 그 판의 라이브러리 태그 — 없으면(보호구역 전용 갈래 등) 칭찬에 조건을 얹지 않는다 */
export function coachSituation(
  result: Pick<JudgeResult, 'grade' | 'violations' | 'failReason' | 'stats' | 'lead'>,
  tags: LibraryTags | undefined,
  drive: CoachSituation['drive'] = 'rightTurn',
): CoachSituation {
  const keys: string[] = [];
  const codes: ViolationCode[] = [];
  const leadSkipped = !!result.lead && result.lead.behavior === 'rolling' && result.lead.skippedStops.length > 0;
  for (const v of result.violations) {
    if (!COACH_CODES.includes(v.code) || codes.includes(v.code)) continue;
    codes.push(v.code);
    const issue = PLACED.has(v.code)
      ? `issue:${v.code}:${afterTurn(v.place) ? 'after' : 'before'}`
      : v.code === 'RED_NO_STOP' && leadSkipped
        ? `issue:${v.code}:lead`
        : `issue:${v.code}`;
    keys.push(issue, `next:${v.code}`);
  }
  const fail = (result.failReason as CoachSituation['fail']) ?? null;
  if (fail) keys.push(`fail:${fail}`);
  const clean = !codes.length && !fail;
  const conds = new Set<(typeof CONDS)[number]>();
  if (tags) {
    if (tags.env === 'rain' || tags.env === 'night') conds.add(tags.env);
    if (tags.kind === 'child' || tags.kind === 'elder') conds.add(tags.kind);
    if (tags.zone === 'yes' || tags.approach !== 'none') conds.add('zone');
    if (tags.lead !== 'none') conds.add('lead');
    if (tags.pressure === 'honk') conds.add('honk');
  }
  if (clean) keys.push('clean:general', ...[...conds].map((c) => `clean:${c}`));
  const s = result.stats;
  return {
    keys,
    codes,
    fail,
    clean,
    grade: result.grade,
    conds,
    stats: {
      stopA: s.cleanStopBeforeA,
      lateA: s.lateStopBeforeA,
      stopC: s.stopBeforeC,
      speeding: s.maxSpeedInIntersection > 20,
      signalOff: !s.signalAt30m,
    },
    drive,
  };
}

/** 주행결과 분석 상황 → 신경망 입력 (자리 · 실패 · 등급 · 조건 · 지표) */
export const COACH_SITUATION_FEATURES: readonly string[] = [
  ...ISSUE_KEYS.map((k) => `has:${k}`),
  ...FAILS.map((f) => `fail:${f}`),
  'clean',
  ...(['PERFECT', 'PASS', 'VIOLATION', 'FAIL'] as const).map((g) => `grade:${g}`),
  ...CONDS.map((c) => `cond:${c}`),
  'stopA',
  'lateA',
  'stopC',
  'speeding',
  'signalOff',
  'violations',
  'straight',
  'zoneOnly',
];

export function coachSituationFeatures(s: CoachSituation): number[] {
  return [
    ...ISSUE_KEYS.map((k) => (s.keys.includes(k) ? 1 : 0)),
    ...FAILS.map((f) => (s.fail === f ? 1 : 0)),
    s.clean ? 1 : 0,
    ...(['PERFECT', 'PASS', 'VIOLATION', 'FAIL'] as const).map((g) => (s.grade === g ? 1 : 0)),
    ...CONDS.map((c) => (s.conds.has(c) ? 1 : 0)),
    s.stats.stopA ? 1 : 0,
    s.stats.lateA ? 1 : 0,
    s.stats.stopC ? 1 : 0,
    s.stats.speeding ? 1 : 0,
    s.stats.signalOff ? 1 : 0,
    Math.min(3, s.codes.length) / 3,
    s.drive === 'straight' ? 1 : 0,
    s.drive === 'zoneOnly' ? 1 : 0,
  ];
}

/** 습관 진단이 보는 것 — 집계(coach/habits.ts)와, 그것으로 정한 자리들 */
export interface ReportSituation {
  keys: string[];
  summary: HabitSummary;
  /** 준수율이 가장 높은 · 낮은 지점 (points 의 차례) */
  best: number;
  worst: number;
  trend: 'up' | 'down' | 'flat' | null;
}

/** 이 비율 넘게 지켰으면 '이미 익힌 것' 으로 말할 수 있다 */
const STRONG_RATE = 0.6;
/** 이 비율 아래면 '무너지는 자리' 로 말할 수 있다 */
const WEAK_RATE = 0.8;
/** 앞 절반 · 뒤 절반의 무위반율이 이만큼 넘게 달라야 '나아졌다 · 나빠졌다' */
const TREND_DELTA = 0.1;

/**
 * 집계 → 상황. 자리는 **집계가 말해 주는 것만** 연다 — 준수율이 높은 지점이 있어야 '이미 익힌 것', 낮은 지점 · 반복된 위반이
 * 있어야 '무너지는 자리', 그 지점 · 위반이 가리키는 오해만 '왜', 추이가 있어야 '나아졌다'. 마지막은 가장 낮은 지점에서 할 것이다 —
 * '가장 많이 다시 돈 판' 은 쓰지 않는다: 그 판의 번호는 화면의 맵 번호(M16350 같은 것)가 아니고, 은행의 문장이 그 판에서 무엇을
 * 틀렸는지를 지어내서 말했다.
 */
export function reportSituation(summary: HabitSummary): ReportSituation {
  const rates = summary.points.map((p) => p.rate);
  const best = rates.indexOf(Math.max(...rates));
  const worst = rates.indexOf(Math.min(...rates));
  const keys: string[] = [rates[best] >= STRONG_RATE ? 'r:strong' : 'r:start'];
  rates.forEach((r, i) => {
    if (r < WEAK_RATE) keys.push(`r:weak:${i}`);
  });
  const codes = summary.byCode.slice(0, 2).map((c) => c.code as ViolationCode).filter((c) => COACH_CODES.includes(c));
  for (const c of codes) keys.push(`r:code:${c}`);
  const has = (c: ViolationCode) => summary.byCode.some((x) => x.code === c);
  // 오해 — 그 지점이 낮거나 그 위반이 나왔을 때만 (정지선 = 0, 우회전 후 횡단보도 = 1)
  if (has('RED_NO_STOP') || rates[0] < WEAK_RATE) keys.push('r:why:red');
  if (rates[1] < WEAK_RATE || has('PEDESTRIAN_BLOCKED')) keys.push('r:why:after');
  if (has('SCHOOL_ZONE_NO_STOP')) keys.push('r:why:zone');
  keys.push('r:why:generic');
  let trend: ReportSituation['trend'] = null;
  if (summary.trend) {
    const d = summary.trend.late - summary.trend.early;
    trend = d > TREND_DELTA ? 'up' : d < -TREND_DELTA ? 'down' : 'flat';
    keys.push(`r:trend:${trend}`);
  }
  keys.push(`r:next:${worst}`);
  return { keys, summary, best, worst, trend };
}

export const REPORT_SITUATION_FEATURES: readonly string[] = [
  'runs',
  'cleanRate',
  ...Array.from({ length: POINTS }, (_, i) => `rate:${i}`),
  ...Array.from({ length: POINTS }, (_, i) => `worst:${i}`),
  ...COACH_CODES.map((c) => `top:${c}`),
  ...COACH_CODES.map((c) => `count:${c}`),
  'trend:up',
  'trend:down',
  'trend:flat',
];

export function reportSituationFeatures(s: ReportSituation): number[] {
  const sum = s.summary;
  const top = sum.byCode[0]?.code;
  const total = sum.byCode.reduce((a, c) => a + c.count, 0) || 1;
  return [
    Math.min(50, sum.runs) / 50,
    sum.runs ? sum.cleanRuns / sum.runs : 0,
    ...Array.from({ length: POINTS }, (_, i) => sum.points[i]?.rate ?? 1),
    ...Array.from({ length: POINTS }, (_, i) => (s.worst === i ? 1 : 0)),
    ...COACH_CODES.map((c) => (top === c ? 1 : 0)),
    ...COACH_CODES.map((c) => (sum.byCode.find((x) => x.code === c)?.count ?? 0) / total),
    s.trend === 'up' ? 1 : 0,
    s.trend === 'down' ? 1 : 0,
    s.trend === 'flat' ? 1 : 0,
  ];
}

// ── 모델 ────────────────────────────────────────────────────────────────

/** 문장 하나 — 자리 이름과 글 (습관 진단의 글에는 빈칸이 있다) */
export interface BankLine {
  key: string;
  text: string;
}

/**
 * 고르는 신경망 하나 — 입력은 [상황 ‖ 자리 원-핫 ‖ 문장 원-핫], 은닉층 하나(tanh), 점수 하나. 같은 상황에서 후보 문장끼리
 * 소프트맥스로 견준다. 문장 원-핫이 있어서 같은 자리의 여러 문장 가운데 LLM 이 더 자주 고른 말투를 배운다.
 */
export interface PickNet {
  situation: readonly string[];
  keys: readonly string[];
  /** 이 신경망이 다루는 문장 (bank 의 번호) */
  lines: readonly number[];
  W1: ReadonlyArray<readonly number[]>;
  b1: readonly number[];
  w2: readonly number[];
  b2: number;
}

export interface CoachModel {
  kind: 'coach-pick';
  bank: readonly BankLine[];
  coach: PickNet;
  report: PickNet;
  /**
   * 한 줄을 더 붙일지의 문턱 — 그 자리의 가장 좋은 문장 점수가 첫 줄 점수보다 이만큼 넘게 낮지 않으면 붙인다. 학습 스크립트가
   * LLM 이 그 줄을 붙인 비율에 맞춰 정한다.
   */
  extra: { secondIssue: number; cond: number; trend: number };
  meta: { trained: boolean; [k: string]: unknown };
}

const MODEL = trained as unknown as CoachModel;

/** 학습한 모델이 있고 입력 이름이 지금 코드와 같은가 */
export const coachModelReady = (model: CoachModel = MODEL): boolean =>
  model.meta?.trained === true &&
  model.coach?.situation.length === COACH_SITUATION_FEATURES.length &&
  model.coach.situation.every((n, i) => n === COACH_SITUATION_FEATURES[i]) &&
  model.report?.situation.length === REPORT_SITUATION_FEATURES.length &&
  model.report.situation.every((n, i) => n === REPORT_SITUATION_FEATURES[i]);

/** 상황 하나와 문장 하나의 입력 */
export function pickInput(net: PickNet, situation: readonly number[], bank: readonly BankLine[], line: number): number[] {
  const key = bank[line].key;
  return [...situation, ...net.keys.map((k) => (k === key ? 1 : 0)), ...net.lines.map((l) => (l === line ? 1 : 0))];
}

/** 점수 — 입력의 앞부분(상황 · 자리)은 빽빽하고 뒤(문장 원-핫)는 하나만 켜져 있어 그 칸만 더한다 */
export function pickScore(net: PickNet, situation: readonly number[], bank: readonly BankLine[], line: number): number {
  const keyAt = net.keys.indexOf(bank[line].key);
  const lineAt = net.lines.indexOf(line);
  const s0 = situation.length;
  let out = net.b2;
  for (let q = 0; q < net.W1.length; q += 1) {
    const row = net.W1[q];
    let s = net.b1[q];
    for (let j = 0; j < s0; j += 1) s += row[j] * situation[j];
    if (keyAt >= 0) s += row[s0 + keyAt];
    if (lineAt >= 0) s += row[s0 + net.keys.length + lineAt];
    out += net.w2[q] * Math.tanh(s);
  }
  return out;
}

/** 자리마다 가장 좋은 문장 — 같은 점수 근처의 문장 가운데서는 `random` 으로 하나 (판마다 같은 말이 되풀이되지 않게) */
function bestOf(
  net: PickNet,
  bank: readonly BankLine[],
  situation: readonly number[],
  key: string,
  random: () => number,
): { line: number; score: number } | null {
  const scored = net.lines
    .filter((l) => bank[l].key === key)
    .map((l) => ({ line: l, score: pickScore(net, situation, bank, l) }))
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  // 1등과 0.5 안쪽의 문장은 비슷하게 좋다 — 그 가운데 고르게
  const near = scored.filter((x) => x.score >= scored[0].score - 0.5);
  return near[Math.min(near.length - 1, Math.floor(random() * near.length))];
}

/** 신경망이 고른 줄들 — `- ` 로 시작하는 2~4줄 (ui/Screens.ts 의 coachLines 가 그대로 그린다). 모델이 없으면 null */
export function localCoaching(
  situation: CoachSituation,
  random: () => number = Math.random,
  model: CoachModel = MODEL,
): string | null {
  if (!coachModelReady(model)) return null;
  const net = model.coach;
  const x = coachSituationFeatures(situation);
  const pick = (key: string) => bestOf(net, model.bank, x, key, random);
  const lines: string[] = [];
  if (situation.clean) {
    // 위반 없이 마친 판 — 짧게 칭찬하고, 이 판의 조건 하나를 얹을 만하면 얹는다
    const head = pick('clean:general');
    if (head) lines.push(model.bank[head.line].text);
    const cond = situation.keys
      .filter((k) => k.startsWith('clean:') && k !== 'clean:general')
      .map(pick)
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => b.score - a.score)[0];
    if (cond && head && cond.score >= head.score - model.extra.cond) lines.push(model.bank[cond.line].text);
  } else {
    if (situation.fail) {
      const f = pick(`fail:${situation.fail}`);
      if (f) lines.push(model.bank[f.line].text);
    }
    // 어긴 것 — 신경망 점수가 높은 위반부터, 많아야 둘
    const issues = situation.keys
      .filter((k) => k.startsWith('issue:'))
      .map((k) => ({ key: k, best: pick(k) }))
      .filter((i): i is { key: string; best: { line: number; score: number } } => !!i.best)
      .sort((a, b) => b.best.score - a.best.score);
    if (issues[0]) lines.push(model.bank[issues[0].best.line].text);
    if (issues[1] && lines.length < 3 && issues[1].best.score >= issues[0].best.score - model.extra.secondIssue) {
      lines.push(model.bank[issues[1].best.line].text);
    }
    // 다음 판에 할 한 동작 — 첫째로 말한 위반의 것
    const primary = issues[0]?.key.split(':')[1];
    const next = primary ? pick(`next:${primary}`) : null;
    if (next) lines.push(model.bank[next.line].text);
  }
  return lines.length ? lines.join('\n') : null;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** 빈칸 채우기 — 숫자는 모두 집계의 값이다 */
function fill(text: string, s: ReportSituation, point: number, code?: ViolationCode): string {
  const sum = s.summary;
  const p = sum.points[point];
  const c = code ? sum.byCode.find((x) => x.code === code) : undefined;
  return text
    .replace(/\{point\}/g, p?.label ?? '')
    .replace(/\{rate\}/g, p ? pct(p.rate) : '')
    .replace(/\{kept\}/g, String(p?.kept ?? ''))
    .replace(/\{total\}/g, String(p?.total ?? ''))
    .replace(/\{count\}/g, String(c?.count ?? ''))
    .replace(/\{early\}/g, sum.trend ? pct(sum.trend.early) : '')
    .replace(/\{late\}/g, sum.trend ? pct(sum.trend.late) : '')
    .replace(/\{runs\}/g, String(sum.runs));
}

/** 신경망이 고른 습관 진단 — 한 문단. 모델이 없으면 null */
export function localHabitReport(
  situation: ReportSituation,
  random: () => number = Math.random,
  model: CoachModel = MODEL,
): string | null {
  if (!coachModelReady(model)) return null;
  const net = model.report;
  const x = reportSituationFeatures(situation);
  const pick = (key: string) => bestOf(net, model.bank, x, key, random);
  const out: string[] = [];
  const keys = situation.keys;
  // 1. 이미 익힌 것 (없으면 시작하는 말)
  const strongKey = keys.includes('r:strong') ? 'r:strong' : 'r:start';
  const strong = pick(strongKey);
  if (strong) out.push(fill(model.bank[strong.line].text, situation, situation.best));
  // 2. 무너지는 자리 — 낮은 지점과 반복된 위반 가운데 신경망이 고른 것
  const weak = keys
    .filter((k) => k.startsWith('r:weak:') || k.startsWith('r:code:'))
    .map((k) => ({ key: k, best: pick(k) }))
    .filter((w): w is { key: string; best: { line: number; score: number } } => !!w.best)
    .sort((a, b) => b.best.score - a.best.score)[0];
  if (weak) {
    const [, kind, arg] = weak.key.split(':');
    out.push(
      kind === 'weak'
        ? fill(model.bank[weak.best.line].text, situation, Number(arg))
        : fill(model.bank[weak.best.line].text, situation, situation.worst, arg as ViolationCode),
    );
  }
  // 3. 왜 그런가 — 집계가 가리키는 오해 가운데 신경망이 고른 것
  const why = keys
    .filter((k) => k.startsWith('r:why:'))
    .map(pick)
    .filter((w): w is NonNullable<typeof w> => !!w)
    .sort((a, b) => b.score - a.score)[0];
  if (why) out.push(fill(model.bank[why.line].text, situation, situation.worst));
  // 추이 — 있고, 말할 만하면
  if (situation.trend) {
    const t = pick(`r:trend:${situation.trend}`);
    if (t && why && t.score >= why.score - model.extra.trend) out.push(fill(model.bank[t.line].text, situation, situation.worst));
  }
  // 4. 다음에 할 것
  const nextKey = keys.find((k) => k.startsWith('r:next:'));
  const next = nextKey ? pick(nextKey) : null;
  if (next) out.push(fill(model.bank[next.line].text, situation, situation.worst));
  return out.length ? out.join(' ') : null;
}
