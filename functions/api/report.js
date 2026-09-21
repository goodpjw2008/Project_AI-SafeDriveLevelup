/**
 * 배포용 `/api/report` — Cloudflare Pages Functions.
 *
 * 껍데기뿐이다. 알맹이는 server/reportHandler.mjs 에 있고, 개발 서버도 같은 것을 쓴다
 * (vite.config.ts 의 devApi).
 *
 * 배포·키·호출 제한은 같은 폴더의 coach.js 주석 참고 — **rate limiting 은 이 경로에도
 * 함께 걸어야 한다.** 리포트는 코칭보다 입력이 크고 출력도 길어 한 번 호출이 더 비싸다.
 */

import { handleReport } from '../../server/reportHandler.mjs';

export async function onRequestPost({ request, env }) {
  let parsed = null;
  try {
    parsed = await request.json();
  } catch {
    /* handleReport 가 BAD_INPUT 으로 답한다 */
  }

  const { status, body } = await handleReport(parsed, env);
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
