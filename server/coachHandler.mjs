/**
 * `/api/coach` — 한 판이 끝난 직후의 코칭.
 *
 * 개발 서버와 배포 함수가 **같은 것**을 쓴다. 여기 있는 것은 `handleCoach` 하나뿐이라,
 * 무엇이 부르는지는 신경 쓰지 않는다.
 *  - 개발: vite.config.ts 의 미들웨어
 *  - 배포: functions/api/coach.js (Cloudflare Pages Functions)
 *
 * 두 곳에 같은 로직을 복사해 두면 로컬에서 잘 되던 것이 배포에서 다르게 동작한다.
 * 모델 호출과 입력 검증 도구는 llm.mjs 가, 습관 리포트는 reportHandler.mjs 가 맡는다.
 */

import { SYSTEM_PROMPT, VIOLATION_BRIEF, buildUserPrompt } from './coachPrompt.mjs';
import { BadInput, callModel, num, oneOf, str } from './llm.mjs';

const LIMIT = {
  title: 100,
  logRows: 60,
  logRowChars: 240,
  violations: 12,
  place: 80,
  outputTokens: 400,
};

const GRADES = ['PERFECT', 'PASS', 'VIOLATION', 'FAIL'];
const FAIL_REASONS = ['PEDESTRIAN_HIT', 'VEHICLE_COLLISION', 'OFF_ROAD', 'TIMEOUT'];
const LEVELS = ['ok', 'info', 'warn', 'bad'];

/**
 * 브라우저가 보낸 것을 판정 엔진이 만들 수 있는 모양으로만 좁힌다.
 *
 * 모르는 필드는 **버린다** — 통째로 넘기면 프롬프트에 무엇이 실릴지 알 수 없다.
 */
function sanitize(body) {
  if (!body || typeof body !== 'object') throw new BadInput('본문이 없음');

  const violations = Array.isArray(body.violations) ? body.violations : [];
  const log = Array.isArray(body.log) ? body.log : [];
  const stats = body.stats && typeof body.stats === 'object' ? body.stats : {};

  return {
    stage: Math.max(1, Math.min(99, Math.round(num(body.stage, 'stage')))),
    title: str(body.title, LIMIT.title, 'title'),
    grade: oneOf(body.grade, GRADES, 'grade'),
    failReason:
      body.failReason == null ? null : oneOf(body.failReason, FAIL_REASONS, 'failReason'),

    violations: violations.slice(0, LIMIT.violations).map((v) => ({
      code: oneOf(v?.code, Object.keys(VIOLATION_BRIEF), 'violation.code'),
      atTime: num(v?.atTime, 'violation.atTime'),
      place: str(v?.place ?? '', LIMIT.place, 'violation.place'),
      inSchoolZone: Boolean(v?.inSchoolZone),
    })),

    stats: {
      cleanStopBeforeA: Boolean(stats.cleanStopBeforeA),
      lateStopBeforeA: Boolean(stats.lateStopBeforeA),
      stopBeforeC: Boolean(stats.stopBeforeC),
      maxSpeedInIntersection: num(stats.maxSpeedInIntersection ?? 0, 'stats.maxSpeed'),
      signalAt30m: Boolean(stats.signalAt30m),
      elapsed: num(stats.elapsed ?? 0, 'stats.elapsed'),
    },

    lead:
      body.lead == null || typeof body.lead !== 'object'
        ? null
        : {
            behavior: oneOf(body.lead.behavior, ['lawful', 'rolling'], 'lead.behavior'),
            skippedStop: Boolean(body.lead.skippedStop),
            minGap: Math.max(-1, Math.min(200, num(body.lead.minGap ?? -1, 'lead.minGap'))),
          },

    log: log.slice(0, LIMIT.logRows).map((e) => ({
      t: num(e?.t, 'log.t'),
      level: oneOf(e?.level, LEVELS, 'log.level'),
      text: str(e?.text ?? '', LIMIT.logRowChars, 'log.text'),
    })),
  };
}

/**
 * 코칭 문장을 만들어 돌려준다.
 *
 * @param {unknown} body  브라우저가 보낸 JSON
 * @param {{ OPENAI_API_KEY?: string, OPENAI_MODEL?: string }} env
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleCoach(body, env) {
  let run;
  try {
    run = sanitize(body);
  } catch (e) {
    return { status: 400, body: { error: 'BAD_INPUT', detail: String(e.message ?? e) } };
  }

  return callModel(
    { system: SYSTEM_PROMPT, user: buildUserPrompt(run), maxTokens: LIMIT.outputTokens },
    env,
  );
}
