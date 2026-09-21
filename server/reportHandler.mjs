/**
 * `/api/report` — 여러 판을 가로지르는 습관 진단.
 *
 * `/api/coach` 와 같은 배관(llm.mjs)을 쓰고 프롬프트만 다르다.
 *
 * **집계는 브라우저가 이미 끝냈다.** 여기서 다시 세지 않고, 넘어온 숫자가 말이 되는
 * 범위인지만 확인한다 — 준수율 자리에 300% 가 오면 모델이 그대로 인용해 버린다.
 */

import { VIOLATION_BRIEF } from './coachPrompt.mjs';
import { BadInput, callModel, num, ratio, str } from './llm.mjs';
import { REPORT_SYSTEM_PROMPT, buildReportPrompt } from './reportPrompt.mjs';

const LIMIT = {
  /** 지점은 넷이지만 늘어날 여지를 둔다 */
  points: 10,
  pointLabel: 60,
  codes: 12,
  outputTokens: 600,
  /** 저장 이력의 한도(HISTORY_LIMIT)와 같다 — 그보다 큰 수는 우리가 보낸 것이 아니다 */
  runs: 60,
};

function sanitize(body) {
  if (!body || typeof body !== 'object') throw new BadInput('본문이 없음');

  const runs = Math.round(num(body.runs, 'runs'));
  if (runs < 1 || runs > LIMIT.runs) throw new BadInput('runs: 범위를 벗어남');

  const points = Array.isArray(body.points) ? body.points : [];
  const byCode = Array.isArray(body.byCode) ? body.byCode : [];
  const grades = body.grades && typeof body.grades === 'object' ? body.grades : {};

  /*
    등급 이름은 화이트리스트로 거른다. 자유 문자열을 그대로 실으면 프롬프트에 아무
    문장이나 끼워 넣을 수 있는 자리가 된다 (위반 코드도 같은 이유로 아래에서 거른다).
  */
  const gradeCounts = {};
  for (const g of ['PERFECT', 'PASS', 'VIOLATION', 'FAIL']) {
    if (grades[g] != null) gradeCounts[g] = Math.round(num(grades[g], `grades.${g}`));
  }

  return {
    runs,
    stagesPlayed: Math.round(num(body.stagesPlayed ?? 0, 'stagesPlayed')),
    cleanRuns: Math.min(runs, Math.round(num(body.cleanRuns ?? 0, 'cleanRuns'))),
    grades: gradeCounts,

    points: points.slice(0, LIMIT.points).map((p) => ({
      label: str(p?.label ?? '', LIMIT.pointLabel, 'point.label'),
      kept: Math.round(num(p?.kept ?? 0, 'point.kept')),
      total: Math.round(num(p?.total ?? 0, 'point.total')),
      rate: ratio(p?.rate ?? 0, 'point.rate'),
    })),

    // 모르는 코드는 **버린다** (에러가 아니다) — 위반 하나 때문에 리포트 전체가 막힐 일은 아니다
    byCode: byCode
      .slice(0, LIMIT.codes)
      .filter((c) => Object.prototype.hasOwnProperty.call(VIOLATION_BRIEF, c?.code))
      .map((c) => ({ code: c.code, count: Math.round(num(c?.count ?? 0, 'byCode.count')) })),

    trend:
      body.trend && typeof body.trend === 'object'
        ? {
            early: ratio(body.trend.early, 'trend.early'),
            late: ratio(body.trend.late, 'trend.late'),
          }
        : null,

    mostRetried:
      body.mostRetried && typeof body.mostRetried === 'object'
        ? {
            stage: Math.round(num(body.mostRetried.stage, 'mostRetried.stage')),
            count: Math.round(num(body.mostRetried.count, 'mostRetried.count')),
          }
        : null,
  };
}

/**
 * 습관 진단 문단을 만들어 돌려준다.
 *
 * @param {unknown} body  브라우저가 보낸 집계 결과 (src/coach/habits.ts 의 HabitSummary)
 * @param {{ OPENAI_API_KEY?: string, OPENAI_MODEL?: string }} env
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleReport(body, env) {
  let summary;
  try {
    summary = sanitize(body);
  } catch (e) {
    return { status: 400, body: { error: 'BAD_INPUT', detail: String(e.message ?? e) } };
  }

  return callModel(
    {
      system: REPORT_SYSTEM_PROMPT,
      user: buildReportPrompt(summary),
      maxTokens: LIMIT.outputTokens,
    },
    env,
  );
}
