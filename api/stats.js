/**
 * 배포용 `/api/stats` — **사이트 전체의 안전운전 성공 · 실패 횟수** (Vercel).
 *
 * 알맹이는 개발 서버와 같은 server/statsHandler.mjs 다. 저장소는 Vercel 대시보드에서 붙인 Upstash Redis 이고
 * (Storage → Upstash for Redis → 이 프로젝트에 연결), 붙이지 않았으면 503 이라 첫 화면이 숫자 칸을 감춘다.
 *
 *  - **GET 은 가장자리(CDN)에 5초 담아 둔다** — 첫 화면을 여는 사람마다 저장소를 부르지 않게. 막 끝낸 판의 숫자는
 *    그 판의 POST 답으로 이미 받으므로 5초 늦은 숫자를 볼 일이 없다 (src/siteStats.ts 가 둘 중 큰 쪽을 쓴다)
 *  - **POST 는 IP 당 분당 30회** — 한 판에 두 번(시작 · 끝) 부르므로 추천 · 코치(10회)보다 넉넉하다
 */

import { handleStatsRead, handleStatsWrite } from '../server/statsHandler.mjs';
import { clientIp, overLimit } from '../server/vercelHandler.mjs';

/** 한 IP 가 1분에 판 표를 받고 낼 수 있는 횟수 */
const STATS_PER_WINDOW = 30;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { status, body } = await handleStatsRead(process.env);
    if (status === 200) res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=25');
    res.status(status).json(body);
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (overLimit(`stats:${clientIp(req)}`, Date.now(), STATS_PER_WINDOW)) {
    res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
    return;
  }
  let parsed = null;
  try {
    parsed = req.body ?? null;
  } catch {
    /* 알맹이가 BAD_INPUT 으로 답한다 */
  }
  const { status, body } = await handleStatsWrite(parsed, process.env);
  res.status(status).json(body);
}
