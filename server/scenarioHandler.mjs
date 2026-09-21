/**
 * `/api/scenario` — 학습자의 약점에 맞춘 시나리오 한 판을 생성한다.
 *
 * 개발 서버(vite.config.ts)와 배포 함수(functions/api/scenario.js)가 **같은 것**을 쓴다.
 *
 * ## 여기서 검증하지 않는다
 *
 * 모델이 뱉은 JSON 이 실제로 **플레이 가능한 판인지**는 브라우저가 판단한다
 * (src/scenarios/validate.ts). 판정 엔진과 보행자 상태기계가 거기 있기 때문이다 —
 * 서버로 옮겨 오면 게임과 두 벌이 되고, 두 벌이 되는 순간 검증은 거짓말을 시작한다.
 *
 * 그래서 이 핸들러가 하는 일은 **모양만 맞춰 돌려주는 것**까지다. 내용에 대한 책임은
 * 검증기가 진다.
 */

import { CODE_BRIEF, SYSTEM_PROMPT, buildUserPrompt } from './scenarioPrompt.mjs';
import { BadInput, callModel, num, ratio, str } from './llm.mjs';

/** 앞차 종류 — 브라우저가 굴린 값(scenarios.ts 의 LeadPlan)과 같아야 한다 */
const LEAD_PLANS = ['straight', 'rolling', 'lawful'];

const LIMIT = {
  codes: 9,
  points: 8,
  label: 60,
  titles: 12,
  title: 100,
  mustVary: 400,
  retryOf: 8,
  retryMsg: 200,
  outputTokens: 900,
};

/**
 * 브라우저가 보낸 것을 좁힌다.
 *
 * 이 엔드포인트는 **인증 없이 열려 있다.** 우리 게임이 보내는 값은 정해진 범위를
 * 넘지 않으므로, 넘어오면 우리가 보낸 것이 아니다 — 공짜 LLM 으로 쓰려는 시도다.
 */
function sanitize(body) {
  if (!body || typeof body !== 'object') throw new BadInput('본문이 없음');

  const byCode = Array.isArray(body.byCode) ? body.byCode : [];
  const points = Array.isArray(body.points) ? body.points : [];
  const recentTitles = Array.isArray(body.recentTitles) ? body.recentTitles : [];
  const retryOf = Array.isArray(body.retryOf) ? body.retryOf : [];
  const badHabits = Array.isArray(body.badHabits) ? body.badHabits : [];

  return {
    runs: Math.max(0, Math.min(9999, Math.round(num(body.runs ?? 0, 'runs')))),
    byCode: byCode
      .slice(0, LIMIT.codes)
      .filter((c) => c && Object.prototype.hasOwnProperty.call(CODE_BRIEF, c.code))
      .map((c) => ({
        code: c.code,
        count: Math.max(0, Math.min(9999, Math.round(num(c.count, 'byCode.count')))),
      })),
    points: points.slice(0, LIMIT.points).map((p) => ({
      label: str(p?.label ?? '', LIMIT.label, 'points.label'),
      kept: Math.max(0, Math.round(num(p?.kept ?? 0, 'points.kept'))),
      total: Math.max(0, Math.round(num(p?.total ?? 0, 'points.total'))),
      rate: ratio(p?.rate ?? 0, 'points.rate'),
    })),
    recentTitles: recentTitles
      .slice(0, LIMIT.titles)
      .map((t) => str(t ?? '', LIMIT.title, 'recentTitles')),
    /*
      브라우저가 "이번엔 이 축을 바꿔라" 를 지정해 보낸다. 문장이라 길이만 좁힌다 —
      내용은 우리 코드가 만든 고정 문구 중 하나다 (src/scenarios/generate.ts 의 AXES).
    */
    mustVary: body.mustVary == null ? null : str(body.mustVary, LIMIT.mustVary, 'mustVary'),
    /*
      난이도 울타리. **브라우저가 만든 고정 표(curriculum.ts 의 LEVELS)에서 온다** —
      값을 그대로 믿지 않고 모양만 좁힌다. 여기서 틀려도 브라우저가 받은 뒤 다시 재므로
      울타리를 속여 어려운 판을 얻어 갈 방법은 없다.
    */
    difficulty: body.difficulty == null ? null : sanitizeDifficulty(body.difficulty),
    target:
      body.target == null || !Object.prototype.hasOwnProperty.call(CODE_BRIEF, body.target)
        ? null
        : body.target,
    /*
      나쁜 운전 습관 목록 — 이 판을 만드는 근거다 (src/coach/badHabits.ts).
      모르는 코드는 버린다: 프롬프트에 무엇이 실릴지 알 수 없게 되면 안 된다.
    */
    badHabits: badHabits
      .slice(0, LIMIT.codes)
      .filter((h) => h && Object.prototype.hasOwnProperty.call(CODE_BRIEF, h.code))
      .map((h) => ({
        code: h.code,
        count: Math.max(0, Math.min(9999, Math.round(num(h.count ?? 0, 'badHabits.count')))),
        cleanRuns: Math.max(0, Math.min(99, Math.round(num(h.cleanRuns ?? 0, 'badHabits.cleanRuns')))),
        toClear: Math.max(0, Math.min(99, Math.round(num(h.toClear ?? 0, 'badHabits.toClear')))),
      })),
    /*
      **이번 판이 어린이보호구역을 낼 차례인가** (src/scenarios/scenarios.ts 의
      `SCHOOL_ZONE_CHANCE` — 네 판에 한 판). 브라우저가 굴려서 보내고, 여기서는
      불리언으로 좁히기만 한다. `null` 이면 커리큘럼 밖의 요청이라 제한하지 않는다.
    */
    schoolZone: body.schoolZone == null ? null : body.schoolZone === true,
    /*
      **이번 판의 앞차** (src/scenarios/scenarios.ts 의 `rollLeadTurn`). 브라우저가 굴려서
      보내고 여기서는 아는 값인지만 본다. `null` 은 "앞차를 넣지 말라" 는 뜻이다.
    */
    lead: LEAD_PLANS.includes(body.lead) ? body.lead : null,
    /* 직전 시도의 탈락 사유 — 브라우저의 검증기가 낸 말이다 */
    retryOf: retryOf.slice(0, LIMIT.retryOf).map((m) => str(m ?? '', LIMIT.retryMsg, 'retryOf')),
  };
}

/**
 * 난이도 — **예산과 비용표.**
 *
 * 표를 브라우저에서 받는 이유는 두 벌이 되면 어긋나기 때문이다(prompt 의 주석).
 * 다만 받는다고 그대로 믿지는 않는다 — 길이와 개수를 여기서 자른다.
 * 이 핸들러의 다른 값들과 같은 규칙이다.
 */
function sanitizeDifficulty(v) {
  if (!v || typeof v !== 'object') throw new BadInput('difficulty: 객체가 아님');
  const costs = Array.isArray(v.costs) ? v.costs : [];
  const free = Array.isArray(v.free) ? v.free : [];
  return {
    level: Math.max(1, Math.min(20, Math.round(num(v.level, 'difficulty.level')))),
    budget: Math.max(0, Math.min(99, Math.round(num(v.budget ?? 0, 'difficulty.budget')))),
    costs: costs.slice(0, 20).map((c) => ({
      key: str(c?.key ?? '', 40, 'difficulty.costs.key'),
      label: str(c?.label ?? '', 80, 'difficulty.costs.label'),
      note: str(c?.note ?? '', 80, 'difficulty.costs.note'),
      field: str(c?.field ?? '', 160, 'difficulty.costs.field'),
    })),
    free: free.slice(0, 6).map((k) => str(k, 40, 'difficulty.free')),
  };
}

/**
 * 시나리오 JSON 을 만들어 돌려준다.
 *
 * `callModel` 은 문장을 `text` 로 돌려주므로, 여기서 **파싱까지 해서** `spec` 으로 준다.
 * 모델이 JSON 모드에서도 깨진 것을 뱉을 수 있어서다 — 그때는 브라우저가 다시 요청한다.
 *
 * @param {unknown} body
 * @param {{ OPENAI_API_KEY?: string, OPENAI_MODEL?: string }} env
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleScenario(body, env) {
  let req;
  try {
    req = sanitize(body);
  } catch (e) {
    return { status: 400, body: { error: 'BAD_INPUT', detail: String(e.message ?? e) } };
  }

  const res = await callModel(
    {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(req),
      maxTokens: LIMIT.outputTokens,
      json: true,
    },
    env,
  );
  if (res.status !== 200) return res;

  let spec;
  try {
    spec = JSON.parse(res.body.text);
  } catch {
    return { status: 502, body: { error: 'BAD_JSON' } };
  }

  return { status: 200, body: { spec } };
}
