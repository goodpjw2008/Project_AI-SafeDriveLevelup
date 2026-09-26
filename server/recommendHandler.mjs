/**
 * `/api/recommend` — AI 가 시나리오 라이브러리에서 다음 코스를 고른다.
 *
 * 개발 서버(vite.config.ts)와 배포 함수(functions/api/recommend.js)가 같은 것을 쓴다.
 * 프롬프트는 recommendPrompt.mjs, 모델 호출과 입력 검증 도구는 llm.mjs 에 있다.
 *
 * **모델의 답은 믿지 않는다.** 고른 번호가 보낸 후보에 있을 때만 넘기고, 글은 길이를 자른다.
 * 브라우저도 한 번 더 본다 (recommend.ts).
 */

import { SYSTEM_PROMPT, buildUserPrompt } from './recommendPrompt.mjs';
import { BadInput, callModel, num, oneOf, str } from './llm.mjs';

const LIMIT = {
  habits: 6,
  courses: 16,
  points: 8,
  recent: 8,
  title: 100,
  violations: 6,
  label: 60,
  /** 후보 한 줄에 적는 '아직 안 겪은 축' 수 — 셋이면 충분하고 토큰도 아낀다 */
  fresh: 3,
  cost: 40,
  outputTokens: 300,
  why: 200,
  focus: 100,
  /** 학습자 모델의 개념 수 · 복습 개념 수 */
  mastery: 12,
  review: 6,
  /** 후보 한 줄의 결과 예측 수 */
  predict: 3,
};
/** 후보에 붙는 표 (src/ai/outcome.ts 의 CandidateLabel) */
const LABELS = ['weak', 'zpd', 'review', 'novel'];

const CODES = [
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
const LEAD_TURNS = ['straight', 'rolling', 'lawful'];
/** 보호구역의 종류 (src/scenarios/library.ts 의 `zoneKindOf`) */
const ZONE_KINDS = ['none', 'signalZone', 'approachSignal', 'noSignal'];
/** 보행자가 오는 쪽 (같은 파일의 `sideOf`) */
const SIDES = ['none', 'left', 'right', 'both'];
/**
 * 경험 커버리지의 축 이름 (src/scenarios/recommend.ts 의 `COVER_AXES`).
 *
 * **키만 받고 한국어는 프롬프트가 붙인다** — 모델에게 가는 글은 우리가 쓴 것만이어야 한다.
 */
const COVER_AXES = [
  'signal',
  'a',
  'c',
  'zoneKind',
  'lead',
  'kind',
  'env',
  'pressure',
  'jam',
  'sideA',
  'sideC',
  'sideS',
];

/** 브라우저가 보낸 것을 알려진 모양으로만 좁힌다 — 모르는 필드는 버린다 */
export function sanitize(body) {
  if (!body || typeof body !== 'object') throw new BadInput('본문이 없음');
  const level = Math.round(num(body.level, 'level'));
  if (level < 1 || level > 10) throw new BadInput('level: 1~10 이 아님');

  const courses = (Array.isArray(body.courses) ? body.courses : []).slice(0, LIMIT.courses).map((c) => ({
    id: Math.round(num(c?.id, 'courses.id')),
    title: str(c?.title ?? '', LIMIT.title, 'courses.title'),
    tests: (Array.isArray(c?.tests) ? c.tests : []).filter((v) => CODES.includes(v)),
    level: Math.min(10, Math.max(1, Math.round(num(c?.level ?? 1, 'courses.level')))),
    // 아래 넷은 **제목에도 태그에도 없어 모델이 알 길이 없던 값**이다 (src/scenarios/recommend.ts 의 courses)
    cost: Math.min(LIMIT.cost, Math.max(0, Math.round(num(c?.cost ?? 0, 'courses.cost')))),
    zoneKind: c?.zoneKind == null ? 'none' : oneOf(c.zoneKind, ZONE_KINDS, 'courses.zoneKind'),
    sideA: c?.sideA == null ? 'none' : oneOf(c.sideA, SIDES, 'courses.sideA'),
    sideC: c?.sideC == null ? 'none' : oneOf(c.sideC, SIDES, 'courses.sideC'),
    fresh: (Array.isArray(c?.fresh) ? c.fresh : []).filter((v) => COVER_AXES.includes(v)).slice(0, LIMIT.fresh),
    // 이 후보가 **어느 습관을 고치려고 추린 것인가** (src/scenarios/recommend.ts 의 coursesByHabit)
    habit: c?.habit == null ? null : oneOf(c.habit, CODES, 'courses.habit'),
    // **예상 성공률** 0~100 (src/ai/difficulty.ts) — 없으면 null (난이도 모델을 못 쓴 판)
    success: c?.success == null ? null : Math.min(100, Math.max(0, Math.round(num(c.success, 'courses.success')))),
    // **결과 예측** (src/ai/outcome.ts) — 이 학습자가 이 판에서 어길 확률이 높은 개념(0~100)과 후보에 붙은 표
    predict: (Array.isArray(c?.predict) ? c.predict : [])
      .filter((x) => x && CODES.includes(x.code))
      .slice(0, LIMIT.predict)
      .map((x) => ({ code: x.code, p: Math.min(100, Math.max(0, Math.round(num(x.p, 'courses.predict.p')))) })),
    labels: (Array.isArray(c?.labels) ? c.labels : []).filter((v) => LABELS.includes(v)),
  }));
  if (!courses.length) throw new BadInput('courses: 후보가 없음');

  const turn = body.turn && typeof body.turn === 'object' ? body.turn : {};
  const badHabits = (Array.isArray(body.badHabits) ? body.badHabits : []).slice(0, LIMIT.habits).map((h) => ({
    code: oneOf(h?.code, CODES, 'badHabits.code'),
    count: Math.max(0, Math.round(num(h?.count, 'badHabits.count'))),
    cleanRuns: Math.max(0, Math.round(num(h?.cleanRuns ?? 0, 'badHabits.cleanRuns'))),
  }));
  /*
    **먼저 고칠 습관을 모델이 정하는 판인가.** 브라우저가 습관마다 후보를 따로 추렸을 때만 켠다 — 그래도
    습관이 둘 이상이고 후보에 두 습관 이상의 묶음이 실제로 있어야 한다. 하나뿐인데 "정하라" 고 하면 고를 것이 없다.
  */
  const groups = new Set(courses.map((c) => c.habit).filter(Boolean));
  const priority = Boolean(body.priority) && badHabits.length >= 2 && groups.size >= 2;
  return {
    level,
    tier: str(body.tier ?? '', 20, 'tier'),
    challenge: Math.min(5, Math.max(1, Math.round(num(body.challenge ?? 3, 'challenge')))),
    target: body.target == null ? null : oneOf(body.target, CODES, 'target'),
    /*
      **경험치와 이어 틀린 판 수.** 브라우저가 줄곧 보내고 있었는데 여기서 통째로 버려서,
      프롬프트의 `req.xpNeed ?? 0` 이 늘 0 이었다 — "경험치 120/300" 줄이 **한 번도 실린 적이 없다.**
      `missStreak` 은 시스템 프롬프트의 원칙 2번("연달아 틀렸다면 낮은 코스로")이 직접 요구하는 값인데
      모델이 최근 주행 여덟 줄을 세어 추론해야 했다.
    */
    xp: Math.max(0, Math.round(num(body.xp ?? 0, 'xp'))),
    xpNeed: Math.max(0, Math.round(num(body.xpNeed ?? 0, 'xpNeed'))),
    cleanStreak: Math.max(0, Math.round(num(body.cleanStreak ?? 0, 'cleanStreak'))),
    missStreak: Math.max(0, Math.round(num(body.missStreak ?? 0, 'missStreak'))),
    runs: Math.max(0, Math.round(num(body.runs ?? 0, 'runs'))),
    badHabits,
    priority,
    points: (Array.isArray(body.points) ? body.points : []).slice(0, LIMIT.points).map((p) => ({
      label: str(p?.label ?? '', LIMIT.label, 'points.label'),
      kept: Math.max(0, Math.round(num(p?.kept ?? 0, 'points.kept'))),
      total: Math.max(0, Math.round(num(p?.total ?? 0, 'points.total'))),
    })),
    trend:
      body.trend && typeof body.trend === 'object'
        ? { early: num(body.trend.early, 'trend.early'), late: num(body.trend.late, 'trend.late') }
        : null,
    recent: (Array.isArray(body.recent) ? body.recent : []).slice(-LIMIT.recent).map((r) => ({
      title: str(r?.title ?? '', LIMIT.title, 'recent.title'),
      grade: oneOf(r?.grade, ['PERFECT', 'PASS', 'VIOLATION', 'FAIL'], 'recent.grade'),
      violations: (Array.isArray(r?.violations) ? r.violations : [])
        .slice(0, LIMIT.violations)
        .filter((v) => CODES.includes(v)),
    })),
    turn: {
      schoolZone: Boolean(turn.schoolZone),
      lead: turn.lead == null ? null : oneOf(turn.lead, LEAD_TURNS, 'turn.lead'),
    },
    /*
      **학습자 모델** (src/ai/knowledge.ts) — 개념별 실효 숙달(0~100)과 복습이 필요한 개념. 모델이 이유에 숫자를 쓰는 근거다.
    */
    mastery: (Array.isArray(body.mastery) ? body.mastery : []).slice(0, LIMIT.mastery).map((m) => ({
      code: oneOf(m?.code, CODES, 'mastery.code'),
      p: Math.min(100, Math.max(0, Math.round(num(m?.p, 'mastery.p')))),
    })),
    review: (Array.isArray(body.review) ? body.review : []).filter((v) => CODES.includes(v)).slice(0, LIMIT.review),
    // 먼저 고칠 습관을 정하지 않는 판에서는 묶음 표시를 지운다 — 모델이 쓰지도 않는 코드가 줄마다 붙지 않게
    courses: priority ? courses : courses.map((c) => ({ ...c, habit: null })),
  };
}

/**
 * 모델의 JSON 답에서 **보낸 후보 번호** 와 글만 남긴다. 못 읽거나 번호가 후보 밖이면 null.
 *
 * `habit`(먼저 고칠 습관)은 `habitOk(id, habit)` 이 참일 때만 남긴다 — 학습자에게 있는 습관이고, 고른
 * 코스가 그 습관을 시험해야 한다. 아니면 빼고 넘긴다 (브라우저가 고른 코스의 묶음 습관으로 본다).
 *
 * @param {string} text 모델의 답
 * @param {number[]} ids 보낸 후보 번호
 * @param {(id: number, habit: string) => boolean} [habitOk]
 */
export function parseReply(text, ids, habitOk = () => false) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    try {
      raw = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? Number(raw.id) : raw.id;
  if (typeof id !== 'number' || !ids.includes(id)) return null;
  const habit = typeof raw.habit === 'string' ? raw.habit.trim() : '';
  return {
    id,
    why: typeof raw.why === 'string' ? raw.why.trim().slice(0, LIMIT.why) : '',
    focus: typeof raw.focus === 'string' ? raw.focus.trim().slice(0, LIMIT.focus) : '',
    ...(habit && CODES.includes(habit) && habitOk(id, habit) ? { habit } : {}),
  };
}

/** 늘 시험되는 위반 (src/scenarios/library.ts 의 `ALWAYS_TESTED`) — 어느 코스에서나 그 습관을 고칠 수 있다 */
const ALWAYS_TESTED = ['NO_SLOW_DOWN', 'WIDE_TURN']; // 방향지시등은 저절로 켜져 시험하지 않는다 (src/scenarios/library.ts)

/**
 * @param {unknown} body 브라우저가 보낸 JSON (src/scenarios/recommend.ts 의 recommendPayload)
 * @param {{ OPENAI_API_KEY?: string, OPENAI_MODEL?: string }} env
 */
export async function handleRecommend(body, env) {
  let req;
  try {
    req = sanitize(body);
  } catch (e) {
    return { status: 400, body: { error: 'BAD_INPUT', detail: String(e.message ?? e) } };
  }

  const res = await callModel(
    { system: SYSTEM_PROMPT, user: buildUserPrompt(req), maxTokens: LIMIT.outputTokens, json: true },
    env,
  );
  if (res.status !== 200) return res;

  const habits = req.badHabits.map((h) => h.code);
  const byId = new Map(req.courses.map((c) => [c.id, c]));
  const reply = parseReply(
    res.body.text,
    req.courses.map((c) => c.id),
    (id, habit) =>
      req.priority &&
      habits.includes(habit) &&
      (ALWAYS_TESTED.includes(habit) || byId.get(id)?.tests.includes(habit) || byId.get(id)?.habit === habit),
  );
  if (!reply) return { status: 502, body: { error: 'BAD_REPLY' } };
  /*
    **누가 골랐는지 함께 돌려준다** (llm.mjs 의 provider — 'gemini' · 'groq' · 'openai').
    사용자가 정했다: "Gemini가 골라줬습니다!!! Groq가 골라줬습니다!!! 이런 식으로 나오면 더 재미있을 것 같아."
    여러 곳을 돌아가며 쓰므로 판마다 고른 쪽이 다르고, 그것을 화면이 그대로 말한다 (ui/AiPick.ts).
  */
  return { status: 200, body: { ...reply, picker: res.body.provider, model: res.body.model } };
}
