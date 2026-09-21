/**
 * 배포용 `/api/coach` — 결과 화면의 AI 코치 한 마디 (Vercel).
 *
 * 알맹이는 개발 서버 · Cloudflare(functions/api/coach.js)와 **같은** `handleCoach` 이고, 껍데기는
 * server/vercelHandler.mjs 하나를 함께 쓴다 (POST 만 받기 · 호출 제한 · 본문 넘기기).
 *
 * 키는 Vercel 대시보드의 **Settings → Environment Variables** 에 넣는다 (.env 는 로컬 전용이다).
 */

import { handleCoach } from '../server/coachHandler.mjs';
import { vercelHandler } from '../server/vercelHandler.mjs';

export default vercelHandler('coach', handleCoach);
