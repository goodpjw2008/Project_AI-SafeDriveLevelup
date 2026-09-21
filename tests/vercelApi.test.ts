/**
 * **Vercel 배포 껍데기** (server/vercelHandler.mjs · api/*.js).
 *
 * 알맹이는 다른 테스트가 본다. 여기서는 껍데기가 하는 세 가지 — POST 만 받기, 호출 제한, 본문과 환경변수
 * 넘기기 — 와, `api/` 의 네 파일이 모두 그 껍데기로 알맹이를 감싸고 있는지를 본다. 배포에서만 드러나는
 * 실수(함수 파일을 빠뜨림 · 알맹이 이름을 잘못 적음)는 로컬 개발 서버로는 절대 보이지 않는다.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  RATE_PER_WINDOW,
  RATE_WINDOW_MS,
  overLimit,
  resetRateLimit,
  vercelHandler,
  type VercelLikeRequest,
} from '../server/vercelHandler.mjs';

/** Vercel 의 응답 객체 흉내 — 무엇을 돌려줬는지만 적어 둔다 */
function fakeRes() {
  const out: { status: number; body: unknown; headers: Record<string, string> } = {
    status: 0,
    body: undefined,
    headers: {},
  };
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

const post = (body: unknown, ip = '1.2.3.4'): VercelLikeRequest => ({
  method: 'POST',
  headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
  body,
});

beforeEach(() => resetRateLimit());

describe('Vercel 껍데기', () => {
  it('받은 본문과 환경변수를 알맹이에 넘기고, 알맹이의 답을 그대로 돌려준다', async () => {
    let seen: { body: unknown; env: unknown } | null = null;
    const handler = vercelHandler('t', async (body, env) => {
      seen = { body, env };
      return { status: 201, body: { ok: true } };
    });
    const { res, out } = fakeRes();
    await handler(post({ a: 1 }), res);
    expect(seen).toEqual({ body: { a: 1 }, env: process.env });
    expect(out).toMatchObject({ status: 201, body: { ok: true } });
  });

  it('POST 가 아니면 알맹이를 부르지 않고 405', async () => {
    let called = false;
    const handler = vercelHandler('t', async () => {
      called = true;
      return { status: 200, body: {} };
    });
    const { res, out } = fakeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(called).toBe(false);
    expect(out.status).toBe(405);
    expect(out.headers.Allow).toBe('POST');
  });

  it('깨진 JSON 이면 null 을 넘긴다 — 알맹이가 BAD_INPUT 으로 답하게', async () => {
    let seen: unknown = 'untouched';
    const handler = vercelHandler('t', async (body) => {
      seen = body;
      return { status: 400, body: {} };
    });
    // Vercel 은 req.body 를 읽는 순간 JSON 을 푼다 — 깨졌으면 그때 던진다
    const req = {
      method: 'POST',
      headers: {},
      get body(): unknown {
        throw new Error('Invalid JSON');
      },
    };
    const { res } = fakeRes();
    await handler(req, res);
    expect(seen).toBeNull();
  });
});

describe('호출 제한', () => {
  it('한 IP 가 한 창에 정해진 횟수를 넘으면 429 — 알맹이는 부르지 않는다', async () => {
    let calls = 0;
    const handler = vercelHandler('t', async () => {
      calls++;
      return { status: 200, body: {} };
    });
    for (let i = 0; i < RATE_PER_WINDOW; i++) await handler(post({}), fakeRes().res);
    const { res, out } = fakeRes();
    await handler(post({}), res);
    expect(calls).toBe(RATE_PER_WINDOW);
    expect(out.status).toBe(429);
    /*
      본문에 `status: 429` 를 싣지 않는다 — 추천 화면은 그것을 "AI 의 일일 사용량 초과" 로 읽는다
      (scenarios/recommend.ts 의 askAi). 여기서 끊은 것은 그게 아니다.
    */
    expect(out.body).not.toHaveProperty('status');
  });

  it('다른 IP · 다른 엔드포인트는 따로 센다', async () => {
    const handler = vercelHandler('t', async () => ({ status: 200, body: {} }));
    const other = vercelHandler('u', async () => ({ status: 200, body: {} }));
    for (let i = 0; i < RATE_PER_WINDOW; i++) await handler(post({}), fakeRes().res);
    const a = fakeRes();
    await handler(post({}, '5.6.7.8'), a.res);
    const b = fakeRes();
    await other(post({}), b.res);
    expect(a.out.status).toBe(200);
    expect(b.out.status).toBe(200);
  });

  it('창이 지나면 다시 부를 수 있다', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_PER_WINDOW; i++) expect(overLimit('k', t0)).toBe(false);
    expect(overLimit('k', t0 + 1)).toBe(true);
    expect(overLimit('k', t0 + RATE_WINDOW_MS)).toBe(false);
  });
});

/*
  **`api/` 의 네 파일이 알맹이를 제대로 감쌌는가.** 함수 파일은 배포에서만 불리므로, 알맹이 이름을 잘못
  적거나 파일을 빠뜨려도 로컬에서는 아무것도 깨지지 않는다. 실제로 불러서 POST 가 아닌 요청에 405 가 오는지
  (= 껍데기가 붙어 있는지) 본다.
*/
describe('api/ 함수 파일', () => {
  for (const name of ['coach', 'recommend', 'report', 'scenario']) {
    it(`/api/${name} 이 껍데기로 감싼 함수를 내보낸다`, async () => {
      const mod = (await import(`../api/${name}.js`)) as { default: unknown };
      expect(typeof mod.default).toBe('function');
      const { res, out } = fakeRes();
      await (mod.default as (req: VercelLikeRequest, r: typeof res) => Promise<void>)(
        { method: 'GET', headers: {} },
        res,
      );
      expect(out.status).toBe(405);
    });
  }
});
