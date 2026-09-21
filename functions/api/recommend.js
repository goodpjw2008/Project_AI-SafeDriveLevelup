/**
 * 배포용 `/api/recommend` — AI 코스 추천 (Cloudflare Pages Functions).
 *
 * 개발 서버(vite.config.ts 의 coachApi)와 **같은 알맹이**를 쓴다. 여기는 껍데기뿐이라,
 * 로컬에서 되던 것이 배포에서 다르게 동작할 여지가 없다.
 *
 * ## 올리는 법
 *
 * `dist/` 를 Cloudflare Pages 에 올리면 이 폴더가 함께 배포되어 `/api/recommend` 가 열린다.
 * 키는 **대시보드**에 넣는다 — Settings → Environment variables.
 * (`.env` 는 로컬 전용이고 배포물에 포함되지 않는다)
 *
 * **여러 곳을 돌아가며 쓴다** (server/llm.mjs) — `GEMINI_API_KEY` · `GROQ_API_KEY`(무료) · `OPENAI_API_KEY`(유료).
 * 넣은 곳만 후보가 되고, 한 곳이 한도를 다 써도 다음 곳이 받는다. 하나도 없으면 AI 기능만 조용히 꺼진다.
 *
 * 모델을 바꾸려면 같은 자리에 `GEMINI_MODEL` · `GROQ_MODEL` · `OPENAI_MODEL` 을 추가한다.
 *
 * ## 반드시 함께 걸 것 — 호출 제한
 *
 * 이 엔드포인트는 인증이 없다. 그대로 두면 누구나 불러 크레딧을 태울 수 있다.
 * Cloudflare 대시보드의 **Security → WAF → Rate limiting rules** 에서
 * `/api/recommend` 경로에 IP당 분당 몇 회 정도로 걸어 둔다.
 * (입력 크기 제한은 server/recommendHandler.mjs 가 이미 하고 있다 — 남용 시도는 그쪽에서 걸린다)
 *
 * Netlify·Vercel 로 간다면 이 파일만 각자의 함수 규약에 맞게 바꾸면 된다
 * (`handleRecommend` 를 부르는 부분은 그대로다).
 */

import { handleRecommend } from '../../server/recommendHandler.mjs';

export async function onRequestPost({ request, env }) {
  let parsed = null;
  try {
    parsed = await request.json();
  } catch {
    /* handleRecommend 가 BAD_INPUT 으로 답한다 */
  }

  const { status, body } = await handleRecommend(parsed, env);
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
