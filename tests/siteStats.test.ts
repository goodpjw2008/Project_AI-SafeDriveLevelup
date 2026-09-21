/**
 * **사이트 전체의 안전운전 성공 · 실패 횟수** (server/statsHandler.mjs · statsStore.mjs · api/stats.js · src/siteStats.ts).
 *
 * 사용자가 짚은 것은 "외부에 올려놨기 때문에 트랜잭션 관리가 잘돼야 해" 다. 누구나 부를 수 있는 공개 엔드포인트로
 * 숫자가 오르므로, 여기서 못 박는 것은 넷이다.
 *  - **한 판은 정확히 한 번** — 같은 판 표를 다시 내도, 동시에 두 번 내도 하나만 센다
 *  - **동시에 끝난 판이 빠지지 않는다** — 더하기는 저장소가 한 덩어리로 한다
 *  - **달리지 않은 판은 세지 않는다** — 표 없이 · 너무 짧게 · 만료된 표로는 오르지 않는다
 *  - **배포 환경마다 따로 센다** — 로컬 개발 · 미리보기 배포의 판이 실제 사이트 숫자에 섞이지 않는다
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStatsRead, handleStatsWrite } from '../server/statsHandler.mjs';
import { FINISH_SCRIPT, MIN_RUN_MS, RUN_TTL_SEC, resetMemoryStore, upstashEnv } from '../server/statsStore.mjs';
import { resetRateLimit, type VercelLikeRequest } from '../server/vercelHandler.mjs';
import { outcomeOf } from '../src/siteStats';

/** 로컬 개발 서버와 같은 환경 — 저장소를 붙이지 않았으니 메모리로 센다 */
const DEV = {};
const T0 = 1_700_000_000_000;

async function start(env: Record<string, string | undefined> = DEV, now = T0): Promise<string> {
  const r = await handleStatsWrite({ action: 'start' }, env, now);
  expect(r.status).toBe(200);
  return r.body.ticket as string;
}
const finish = (ticket: string, outcome: string, now = T0 + 20_000, env: Record<string, string | undefined> = DEV) =>
  handleStatsWrite({ action: 'finish', ticket, outcome }, env, now);

beforeEach(() => {
  resetMemoryStore();
  resetRateLimit();
});
afterEach(() => vi.unstubAllGlobals());

describe('판 표로 센다', () => {
  it('처음은 0 · 0 이고, 판을 마치면 그 결과가 하나 오른다', async () => {
    expect((await handleStatsRead(DEV)).body).toEqual({ success: 0, fail: 0 });
    const t = await start();
    expect((await finish(t, 'success')).body).toEqual({ success: 1, fail: 0 });
    const u = await start();
    expect((await finish(u, 'fail')).body).toEqual({ success: 1, fail: 1 });
    expect((await handleStatsRead(DEV)).body).toEqual({ success: 1, fail: 1 });
  });

  it('같은 판 표를 두 번 내면 두 번째는 세지 않는다 (409)', async () => {
    const t = await start();
    expect((await finish(t, 'success')).status).toBe(200);
    const again = await finish(t, 'success');
    expect(again.status).toBe(409);
    expect((await handleStatsRead(DEV)).body).toEqual({ success: 1, fail: 0 });
  });

  /*
    **동시에 들어와도 정확히 한 번.** 두 탭에서 같은 결과가 동시에 가거나, 느린 망에서 다시 보낸 요청이 먼저 간
    요청과 겹치는 경우다. 표를 지우는 것과 숫자를 올리는 것이 한 덩어리라, 겹친 둘 중 하나만 센다.
  */
  it('판 10개의 표를 저마다 동시에 두 번씩 내도 정확히 10 이 오른다', async () => {
    const tickets = await Promise.all(Array.from({ length: 10 }, () => start()));
    const replies = await Promise.all(tickets.flatMap((t) => [finish(t, 'success'), finish(t, 'success')]));
    expect(replies.filter((r) => r.status === 200)).toHaveLength(10);
    expect(replies.filter((r) => r.status === 409)).toHaveLength(10);
    expect((await handleStatsRead(DEV)).body).toEqual({ success: 10, fail: 0 });
  });

  it('성공과 실패가 동시에 섞여 들어와도 하나도 빠지지 않는다', async () => {
    const tickets = await Promise.all(Array.from({ length: 30 }, () => start()));
    await Promise.all(tickets.map((t, i) => finish(t, i % 3 === 0 ? 'fail' : 'success')));
    expect((await handleStatsRead(DEV)).body).toEqual({ success: 20, fail: 10 });
  });

  it('받자마자 낸 표(너무 짧은 판)는 세지 않고, 그 표는 다시 쓸 수 없다', async () => {
    const t = await start();
    expect((await finish(t, 'success', T0 + MIN_RUN_MS - 1)).status).toBe(422);
    // 기다렸다 다시 내도 안 된다 — 짧다고 거절할 때 표도 지운다
    expect((await finish(t, 'success', T0 + 60_000)).status).toBe(409);
    expect((await handleStatsRead(DEV)).body).toEqual({ success: 0, fail: 0 });
  });

  it('만료된 표는 세지 않는다 — 판 도중 떠난 사람의 표는 저절로 사라진다', async () => {
    const t = await start();
    expect((await finish(t, 'success', T0 + RUN_TTL_SEC * 1000 + 1)).status).toBe(409);
  });

  it('받지 않은 표 · 엉뚱한 값은 거절한다', async () => {
    expect((await finish('00000000-0000-4000-8000-000000000000', 'success')).status).toBe(409);
    expect((await finish('stats:prod:totals', 'success')).status).toBe(400); // 저장소 이름을 끼워 넣으려는 값
    const t = await start();
    expect((await finish(t, 'perfect')).status).toBe(400);
    expect((await handleStatsWrite({ action: 'reset' }, DEV, T0)).status).toBe(400);
    expect((await handleStatsWrite(null, DEV, T0)).status).toBe(400);
    expect((await handleStatsRead(DEV)).body).toEqual({ success: 0, fail: 0 });
  });
});

describe('환경', () => {
  it('배포 환경마다 따로 센다 — 로컬 개발의 판이 실제 사이트 숫자에 섞이지 않는다', async () => {
    const t = await start(DEV);
    await finish(t, 'success', T0 + 20_000, DEV);
    const prod = { VERCEL_ENV: 'production' };
    expect((await handleStatsRead(prod)).body).toEqual({ success: 0, fail: 0 });
    // 다른 환경의 표로는 셀 수 없다
    expect((await finish(await start(DEV), 'success', T0 + 20_000, prod)).status).toBe(409);
  });

  /*
    **배포에서 저장소를 붙이지 않았으면 숫자를 띄우지 않는다.** 메모리로 세면 함수 인스턴스마다 다른 숫자가 되고
    곧 사라진다 — 틀린 숫자보다 없는 숫자가 낫다. 첫 화면은 503 을 보고 칸을 감춘다.
  */
  it('Vercel 에서 저장소가 없으면 503', async () => {
    const vercel = { VERCEL: '1', VERCEL_ENV: 'production' };
    expect((await handleStatsRead(vercel)).status).toBe(503);
    expect((await handleStatsWrite({ action: 'start' }, vercel)).status).toBe(503);
  });
});

/*
  **Upstash Redis 로 보내는 명령** — 배포에서 실제로 쓰는 길. 저장소 안에서 한 덩어리로 돌아야 하는 것(표 지우기 +
  더하기)이 스크립트 하나(EVAL)로 가는지, 표를 적을 때 덮어쓰지 않고(NX) 만료를 거는지(EX) 본다.
*/
describe('Upstash 저장소', () => {
  const UP = { KV_REST_API_URL: 'https://example-redis.upstash.io', KV_REST_API_TOKEN: 'tok', VERCEL: '1', VERCEL_ENV: 'production' };

  function stubUpstash(reply: (cmd: unknown[]) => { status?: number; body: unknown }) {
    const sent: unknown[][] = [];
    vi.stubGlobal('fetch', (url: string, init: { body: string; headers: Record<string, string> }) => {
      expect(url).toBe(UP.KV_REST_API_URL);
      expect(init.headers.Authorization).toBe('Bearer tok');
      const cmd = JSON.parse(init.body) as unknown[];
      sent.push(cmd);
      const r = reply(cmd);
      return Promise.resolve({ ok: (r.status ?? 200) === 200, status: r.status ?? 200, json: () => Promise.resolve(r.body) });
    });
    return sent;
  }

  it('표는 덮어쓰지 않고(NX) 만료를 걸어(EX) 적는다', async () => {
    const sent = stubUpstash(() => ({ body: { result: 'OK' } }));
    const r = await handleStatsWrite({ action: 'start' }, UP, T0);
    expect(r.status).toBe(200);
    expect(sent[0]).toEqual(['SET', `stats:prod:run:${r.body.ticket}`, String(T0), 'NX', 'EX', String(RUN_TTL_SEC)]);
  });

  it('표 내기와 더하기는 스크립트 하나로 간다 — 저장소 안에서 한 덩어리', async () => {
    const sent = stubUpstash(() => ({ body: { result: ['ok', '12', '5'] } }));
    const ticket = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const r = await handleStatsWrite({ action: 'finish', ticket, outcome: 'success' }, UP, T0);
    expect(r).toEqual({ status: 200, body: { success: 12, fail: 5 } });
    expect(sent[0]).toEqual([
      'EVAL',
      FINISH_SCRIPT,
      '2',
      `stats:prod:run:${ticket}`,
      'stats:prod:totals',
      'success',
      String(T0),
      String(MIN_RUN_MS),
    ]);
    // 스크립트가 표를 지우고 나서 더한다 — 표가 없으면 더하지 않는다
    expect(FINISH_SCRIPT.indexOf("'DEL'")).toBeLessThan(FINISH_SCRIPT.indexOf("'HINCRBY'"));
    expect(FINISH_SCRIPT.indexOf("return {'gone'}")).toBeLessThan(FINISH_SCRIPT.indexOf("'HINCRBY'"));
  });

  it('이미 낸 표 · 짧은 판은 스크립트의 답대로 409 · 422', async () => {
    const ticket = '0f8fad5b-d9cb-469f-a165-70867728950e';
    stubUpstash(() => ({ body: { result: ['gone'] } }));
    expect((await handleStatsWrite({ action: 'finish', ticket, outcome: 'fail' }, UP, T0)).status).toBe(409);
    stubUpstash(() => ({ body: { result: ['short'] } }));
    expect((await handleStatsWrite({ action: 'finish', ticket, outcome: 'fail' }, UP, T0)).status).toBe(422);
  });

  it('읽기는 두 칸을 한 번에(HMGET) — 비어 있으면 0', async () => {
    const sent = stubUpstash(() => ({ body: { result: [null, '3'] } }));
    expect((await handleStatsRead(UP)).body).toEqual({ success: 0, fail: 3 });
    expect(sent[0]).toEqual(['HMGET', 'stats:prod:totals', 'success', 'fail']);
  });

  it('저장소가 오류를 내거나 닿지 않으면 502 — 숫자는 건드리지 않는다', async () => {
    stubUpstash(() => ({ status: 500, body: { error: 'ERR' } }));
    expect((await handleStatsRead(UP)).status).toBe(502);
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network')));
    expect((await handleStatsWrite({ action: 'start' }, UP, T0)).status).toBe(502);
  });

  /*
    **연결할 때 앞머리를 붙이면 이름이 달라진다** (`STORAGE_KV_REST_API_URL`). 그걸 못 찾으면 저장소를 연결하고도
    "저장소 없음" 이라 숫자가 뜨지 않는다 — 배포한 사이트에서만 숫자가 안 보이는 까닭을 찾기 어렵다.
  */
  it('앞머리가 붙은 환경변수 이름도 찾는다 — 읽기 전용 열쇠는 쓰지 않는다', () => {
    expect(upstashEnv({ STORAGE_KV_REST_API_URL: 'https://a.upstash.io', STORAGE_KV_REST_API_TOKEN: 'w' })).toEqual({
      url: 'https://a.upstash.io',
      token: 'w',
    });
    expect(upstashEnv({ X_KV_REST_API_URL: 'https://a.upstash.io', X_KV_REST_API_READ_ONLY_TOKEN: 'r' })).toBeNull();
    expect(upstashEnv({ KV_REST_API_URL: 'https://a', KV_REST_API_TOKEN: 't', Z_KV_REST_API_URL: 'https://z', Z_KV_REST_API_TOKEN: 'z' }))
      .toEqual({ url: 'https://a', token: 't' });
    expect(upstashEnv({ VERCEL: '1' })).toBeNull();
  });

  it('Upstash 가 주는 다른 이름의 환경변수도 받는다', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      sent.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result: ['1', '2'] }) });
    });
    const env = { UPSTASH_REDIS_REST_URL: 'https://other.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't', VERCEL: '1' };
    expect((await handleStatsRead(env)).body).toEqual({ success: 1, fail: 2 });
    expect(sent).toEqual(['https://other.upstash.io']);
  });
});

/** Vercel 의 응답 객체 흉내 */
function fakeRes() {
  const out: { status: number; body: unknown; headers: Record<string, string> } = { status: 0, body: undefined, headers: {} };
  const res = {
    setHeader(name: string, value: string) {
      out.headers[name] = value;
    },
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
    },
  };
  return { res, out };
}

describe('api/stats.js', () => {
  // 이름을 값으로 넘긴다 — 함수 파일은 타입 선언이 없는 배포용 JS 다 (vercelApi.test.ts 와 같은 방식)
  const name = 'stats';
  const load = async () =>
    ((await import(`../api/${name}.js`)) as { default: unknown }).default as (
      req: VercelLikeRequest,
      res: ReturnType<typeof fakeRes>['res'],
    ) => Promise<void>;

  it('GET 은 숫자를 주고 가장자리에 잠깐 담게 한다', async () => {
    const handler = await load();
    const { res, out } = fakeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: 0, fail: 0 });
    expect(out.headers['Cache-Control']).toContain('s-maxage=');
  });

  it('POST 는 한 IP 가 분당 30회까지 — 넘으면 429', async () => {
    const handler = await load();
    const req = { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: { action: 'start' } };
    for (let i = 0; i < 30; i++) {
      const { res, out } = fakeRes();
      await handler(req, res);
      expect(out.status).toBe(200);
    }
    const { res, out } = fakeRes();
    await handler(req, res);
    expect(out.status).toBe(429);
  });

  it('그 밖의 방법은 405', async () => {
    const handler = await load();
    const { res, out } = fakeRes();
    await handler({ method: 'DELETE', headers: {} }, res);
    expect(out.status).toBe(405);
  });
});

describe('성공 · 실패의 기준', () => {
  it('위반 없이 마치면 성공, 위반했거나 완주하지 못하면 실패 — 결과 화면의 초록 · 붉은 판정과 같은 선', () => {
    expect(outcomeOf('PERFECT')).toBe('success');
    expect(outcomeOf('PASS')).toBe('success');
    expect(outcomeOf('VIOLATION')).toBe('fail');
    expect(outcomeOf('FAIL')).toBe('fail');
  });
});
