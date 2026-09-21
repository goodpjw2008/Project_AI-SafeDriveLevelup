/**
 * **사이트 전체의 안전운전 성공 · 실패 횟수를 담는 곳** — 첫 화면 오른쪽 위의 두 숫자 (사용자 요청).
 *
 * 배포(Vercel)의 함수는 요청이 끝나면 사라지고, 여러 개가 동시에 뜬다. 메모리에 두면 함수마다 다른 숫자를 세다가
 * 사라진다. 그래서 **바깥의 저장소**에 둔다 — Vercel 에서 무료로 붙는 **Upstash Redis** 다 (REST 로 부르므로 새 의존이
 * 없다). 로컬 개발 서버에서 저장소를 연결하지 않았으면 메모리로 센다 (다시 켜면 0 부터).
 *
 * ## 한 판은 정확히 한 번만 센다 — 판 표(ticket)
 *
 * 숫자가 **공개된 곳에서 누구나 부를 수 있는 엔드포인트**로 오르므로, "끝났다" 는 요청을 그대로 믿으면 같은 판이
 * 두 번 세어지거나(다시 보내기 · 두 탭) 판을 달리지도 않고 숫자만 올릴 수 있다. 그래서 두 단계로 센다.
 *
 *  1. **판을 시작할 때 표를 받는다** — 서버가 무작위 표를 만들어 시작 시각과 함께 저장소에 적는다 (15분 뒤 저절로 사라진다)
 *  2. **판을 마치면 표를 내고 센다** — 표를 **지우는 것과 숫자를 올리는 것이 한 번에** 일어난다 (Redis 의 Lua 스크립트는
 *     중간에 다른 명령이 끼어들 수 없다). 같은 표를 두 번 내도, 동시에 내도 **처음 하나만** 센다
 *
 * 숫자를 올리는 것도 저장소 안에서 한다(`HINCRBY`) — "읽고 → 1 더하고 → 쓰기" 를 함수에서 하면 동시에 끝난 두 판 중
 * 하나가 사라진다. 저장소가 하는 더하기는 몇 개가 동시에 와도 빠짐없이 쌓인다.
 */

import { randomUUID } from 'node:crypto';

/** 판 표가 살아 있는 시간 (초) — 한 판은 제한시간 100초에 결과 화면을 더해도 15분을 넘지 않는다 */
export const RUN_TTL_SEC = 15 * 60;

/**
 * **이보다 짧은 판은 세지 않는다** (ms) — 표를 받자마자 내는 스크립트를 막는다. 가장 빨리 끝나는 진짜 판(출발하자마자
 * 앞차에 부딪힘)도 몇 초는 걸리므로, 정상인 판이 걸리지 않게 넉넉히 짧게 둔다.
 */
export const MIN_RUN_MS = 3_000;

/** 저장소를 이만큼만 기다린다 (ms) — 첫 화면의 숫자 때문에 화면이 붙잡히지 않게 */
const STORE_TIMEOUT_MS = 4_000;

/**
 * 표를 내고 센다 — **한 덩어리로** 돈다 (Redis 는 스크립트를 도는 동안 다른 명령을 끼우지 않는다).
 *
 * KEYS[1] 판 표 · KEYS[2] 누적 숫자(해시) · ARGV[1] success | fail · ARGV[2] 지금(ms) · ARGV[3] 가장 짧은 판(ms)
 *
 * 너무 짧은 판도 **표는 지운다** — 남겨 두면 기다렸다가 다시 내서 셀 수 있다.
 */
export const FINISH_SCRIPT = `
local started = redis.call('GET', KEYS[1])
if not started then
  return {'gone'}
end
redis.call('DEL', KEYS[1])
if tonumber(ARGV[2]) - tonumber(started) < tonumber(ARGV[3]) then
  return {'short'}
end
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
local t = redis.call('HMGET', KEYS[2], 'success', 'fail')
return {'ok', t[1] or '0', t[2] or '0'}
`;

const toCount = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/**
 * 어느 저장소를 쓰는가.
 *
 * Vercel 대시보드에서 Upstash Redis 를 붙이면 `KV_REST_API_URL` · `KV_REST_API_TOKEN` 이 들어온다 (연결 방식에 따라
 * `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` 일 수도 있어 둘 다 본다). **배포에서 저장소가 없으면 `null`**
 * — 메모리로 세면 함수마다 다른 숫자가 되므로, 차라리 숫자를 띄우지 않는다.
 *
 * @param {Record<string, string | undefined>} env
 */
export function storeFor(env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstashStore(url, token);
  if (env.VERCEL) return null;
  return memoryStore;
}

/**
 * 저장소 안의 이름 앞머리 — **배포 환경마다 따로 센다.** 로컬 개발이나 미리보기 배포에서 달린 판이 실제 사이트의
 * 숫자에 섞이지 않게 한다 (같은 저장소를 써도 이름이 다르다).
 */
export function namespaceOf(env) {
  const ns = env.STATS_NAMESPACE || (env.VERCEL_ENV === 'production' ? 'prod' : env.VERCEL_ENV || 'dev');
  return String(ns).replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'dev';
}

export const totalsKey = (ns) => `stats:${ns}:totals`;
export const runKey = (ns, ticket) => `stats:${ns}:run:${ticket}`;

/** 새 판 표 — 추측할 수 없는 무작위 값 */
export const newTicket = () => randomUUID();

/** Upstash Redis — REST 로 명령 하나씩 보낸다 */
function upstashStore(url, token) {
  async function call(command) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error(`저장소 오류 ${res.status} ${data?.error ?? ''}`.trim());
    return data.result;
  }
  return {
    persistent: true,
    /** 판 표를 적는다 — 이미 있으면(같은 값이 우연히 나오면) 덮지 않는다 */
    async begin(key, now) {
      return (await call(['SET', key, String(now), 'NX', 'EX', String(RUN_TTL_SEC)])) === 'OK';
    },
    async finish(key, totals, outcome, now) {
      const r = await call(['EVAL', FINISH_SCRIPT, '2', key, totals, outcome, String(now), String(MIN_RUN_MS)]);
      if (!Array.isArray(r)) throw new Error('저장소가 알 수 없는 답을 했다');
      if (r[0] !== 'ok') return { state: r[0] === 'short' ? 'short' : 'gone' };
      return { state: 'ok', success: toCount(r[1]), fail: toCount(r[2]) };
    },
    async totals(totals) {
      const r = await call(['HMGET', totals, 'success', 'fail']);
      return { success: toCount(r?.[0]), fail: toCount(r?.[1]) };
    },
  };
}

/*
  **메모리 저장소** — 로컬 개발 서버와 테스트용. 자바스크립트는 한 번에 한 줄기로 돌므로 아래 각 동작이 중간에
  끊기지 않는다 (await 가 없다) — Redis 스크립트와 같은 "한 덩어리" 성질을 그대로 갖는다.
*/
const memRuns = new Map();
const memTotals = new Map();
const memoryStore = {
  persistent: false,
  async begin(key, now) {
    const old = memRuns.get(key);
    if (old && old.expires > now) return false;
    memRuns.set(key, { started: now, expires: now + RUN_TTL_SEC * 1000 });
    return true;
  },
  async finish(key, totals, outcome, now) {
    const run = memRuns.get(key);
    memRuns.delete(key);
    if (!run || run.expires <= now) return { state: 'gone' };
    if (now - run.started < MIN_RUN_MS) return { state: 'short' };
    const t = memTotals.get(totals) ?? { success: 0, fail: 0 };
    t[outcome] += 1;
    memTotals.set(totals, t);
    return { state: 'ok', success: t.success, fail: t.fail };
  },
  async totals(totals) {
    const t = memTotals.get(totals) ?? { success: 0, fail: 0 };
    return { success: t.success, fail: t.fail };
  },
};

/** 테스트용 — 메모리 저장소를 비운다 */
export function resetMemoryStore() {
  memRuns.clear();
  memTotals.clear();
}
