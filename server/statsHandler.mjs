/**
 * `/api/stats` — **사이트 전체의 안전운전 성공 · 실패 횟수** (첫 화면 오른쪽 위).
 *
 *  - 읽기(GET) — `{ success, fail }`
 *  - 판 시작(POST `{ action: 'start' }`) — `{ ticket }`
 *  - 판 끝(POST `{ action: 'finish', ticket, outcome: 'success' | 'fail' }`) — 올린 뒤의 `{ success, fail }`
 *
 * 한 판을 정확히 한 번만 세는 방법(판 표)과 동시에 들어와도 숫자가 빠지지 않는 이유는 statsStore.mjs 에 있다.
 * 개발 서버(vite.config.ts)와 배포(api/stats.js)가 이 알맹이를 같이 쓴다.
 *
 * **개인정보는 남기지 않는다** — 저장소에는 두 숫자와, 15분 뒤 사라지는 무작위 판 표뿐이다.
 */

import { namespaceOf, newTicket, runKey, storeFor, totalsKey } from './statsStore.mjs';

const OUTCOMES = ['success', 'fail'];
/** randomUUID 가 만드는 모양만 받는다 — 저장소 이름에 엉뚱한 글자가 끼지 않게 */
const TICKET_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const noStore = () => ({ status: 503, body: { error: 'NO_STORE' } });
const unreachable = () => ({ status: 502, body: { error: 'STORE_UNREACHABLE' } });

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleStatsRead(env) {
  const store = storeFor(env);
  if (!store) return noStore();
  try {
    return { status: 200, body: await store.totals(totalsKey(namespaceOf(env))) };
  } catch {
    return unreachable();
  }
}

/**
 * @param {unknown} body
 * @param {Record<string, string | undefined>} env
 * @param {number} [now] 테스트가 시계를 넘긴다
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleStatsWrite(body, env, now = Date.now()) {
  const store = storeFor(env);
  if (!store) return noStore();
  const ns = namespaceOf(env);
  const req = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {};

  try {
    if (req.action === 'start') {
      const ticket = newTicket();
      if (!(await store.begin(runKey(ns, ticket), now))) return { status: 500, body: { error: 'TICKET_CLASH' } };
      return { status: 200, body: { ticket } };
    }

    if (req.action === 'finish') {
      if (typeof req.ticket !== 'string' || !TICKET_RE.test(req.ticket)) {
        return { status: 400, body: { error: 'BAD_INPUT', detail: 'ticket' } };
      }
      if (typeof req.outcome !== 'string' || !OUTCOMES.includes(req.outcome)) {
        return { status: 400, body: { error: 'BAD_INPUT', detail: 'outcome' } };
      }
      const r = await store.finish(runKey(ns, req.ticket), totalsKey(ns), req.outcome, now);
      // 이미 센 판 · 사라진 표 — 다시 보낸 것이다. 숫자는 그대로 둔다
      if (r.state === 'gone') return { status: 409, body: { error: 'TICKET_USED_OR_EXPIRED' } };
      if (r.state === 'short') return { status: 422, body: { error: 'RUN_TOO_SHORT' } };
      return { status: 200, body: { success: r.success, fail: r.fail } };
    }
  } catch {
    return unreachable();
  }
  return { status: 400, body: { error: 'BAD_INPUT', detail: 'action' } };
}
