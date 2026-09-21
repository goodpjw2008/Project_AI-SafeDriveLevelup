/**
 * 배포용 `/api/scenario` — Cloudflare Pages Functions.
 *
 * 개발 서버(vite.config.ts)와 **같은 알맹이**를 쓴다. 여기는 껍데기뿐이다.
 *
 * ## 호출 제한을 반드시 함께 걸 것
 *
 * 이 엔드포인트는 인증이 없고, 코치(`/api/coach`)보다 **출력 토큰이 두 배**다.
 * Cloudflare 대시보드 Security → WAF → Rate limiting rules 에서 `/api/scenario` 에
 * IP당 분당 몇 회로 걸어 둔다. 입력 크기 제한은 server/scenarioHandler.mjs 가 이미 한다.
 */

import { handleScenario } from '../../server/scenarioHandler.mjs';

export async function onRequestPost({ request, env }) {
  let parsed = null;
  try {
    parsed = await request.json();
  } catch {
    /* handleScenario 가 BAD_INPUT 으로 답한다 */
  }

  const { status, body } = await handleScenario(parsed, env);
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
