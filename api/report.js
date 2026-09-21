/**
 * 배포용 `/api/report` — 내 습관 화면의 AI 리포트 (Vercel).
 *
 * 알맹이는 개발 서버 · Cloudflare(functions/api/report.js)와 **같은** `handleReport` 이고, 껍데기는
 * server/vercelHandler.mjs 하나를 함께 쓴다 (POST 만 받기 · 호출 제한 · 본문 넘기기).
 *
 * 키는 Vercel 대시보드의 **Settings → Environment Variables** 에 넣는다 (.env 는 로컬 전용이다).
 */

import { handleReport } from '../server/reportHandler.mjs';
import { vercelHandler } from '../server/vercelHandler.mjs';

export default vercelHandler('report', handleReport);
