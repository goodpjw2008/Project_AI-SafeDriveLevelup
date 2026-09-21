/**
 * **Vercel 배포용 함수의 공통 껍데기** — `api/*.js` 네 개가 이것 하나를 부른다.
 *
 * 알맹이(`handleCoach` 등)는 개발 서버(vite.config.ts)와 Cloudflare(functions/api)가 쓰는 것과 **같다.**
 * 여기서 하는 일은 셋뿐이다 — POST 만 받고, 한 사람이 너무 자주 부르면 끊고, 받은 본문과 환경변수를 알맹이에 넘긴다.
 *
 * ## 왜 호출 제한을 코드에 두는가
 *
 * 이 엔드포인트들은 로그인이 없다. 그대로 두면 누구나 스크립트로 두드려 **무료 키의 하루 한도를 다 써 버릴 수**
 * 있고, 그러면 다른 사람들의 AI 추천이 그날 내내 꺼진다. Cloudflare 에서는 대시보드의 규칙으로 막으라고 적어
 * 두었는데(functions/api 의 주석), 배포처를 옮기면 그 규칙은 따라오지 않는다. 코드에 두면 따라온다.
 *
 * **완벽한 울타리는 아니다.** 세는 장부가 함수 인스턴스의 메모리라, 인스턴스가 여럿 뜨면 각자 센다. 그래도
 * 한 사람이 한 인스턴스에 몰아서 두드리는 가장 흔한 남용은 막는다. 정상적으로 노는 사람은 한 판(30~60초)에
 * 추천 · 코치를 한 번씩 부르므로 분당 10회에 닿지 않는다.
 *
 * **429 에 `status` 를 싣지 않는다.** 추천 화면은 본문의 `status: 429` 를 "AI 의 일일 사용량이 초과됐어요" 로
 * 읽는다(scenarios/recommend.ts 의 askAi). 여기서 끊은 것은 그게 아니므로, 그냥 실패로 읽혀 규칙 기반
 * 추천으로 조용히 넘어가게 둔다.
 */

/** 호출을 세는 창 (ms) */
export const RATE_WINDOW_MS = 60_000;
/** 한 창 안에서 한 IP 가 한 엔드포인트를 부를 수 있는 횟수 */
export const RATE_PER_WINDOW = 10;
/** 장부가 이보다 커지면 창 밖으로 나간 기록을 치운다 — 메모리가 끝없이 불지 않게 */
const LEDGER_PRUNE_AT = 5000;

/** `엔드포인트:IP` → 창 안에서 부른 시각들 */
const ledger = new Map();

/** 부른 사람의 IP — Vercel 은 앞단 프록시가 `x-forwarded-for` 첫 칸에 적어 준다 */
function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/** 이번 호출이 한도를 넘는가. 넘지 않으면 장부에 적는다 */
export function overLimit(key, now = Date.now()) {
  const recent = (ledger.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const over = recent.length >= RATE_PER_WINDOW;
  if (!over) recent.push(now);
  ledger.set(key, recent);
  if (ledger.size > LEDGER_PRUNE_AT) {
    for (const [k, times] of ledger) if (!times.some((t) => now - t < RATE_WINDOW_MS)) ledger.delete(k);
  }
  return over;
}

/** 테스트용 — 장부를 비운다 */
export function resetRateLimit() {
  ledger.clear();
}

/**
 * 알맹이 하나를 Vercel 함수로 감싼다.
 *
 * @param name   호출 제한을 엔드포인트마다 따로 세기 위한 이름
 * @param handle `(본문, 환경변수) → { status, body }` — server/*Handler.mjs
 */
export function vercelHandler(name, handle) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    if (overLimit(`${name}:${clientIp(req)}`)) {
      res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
      return;
    }
    /*
      Vercel 은 `req.body` 를 **읽는 순간** JSON 으로 푼다 — 깨진 JSON 이면 그때 던진다. 받아서 null 로 넘기면
      알맹이가 BAD_INPUT 으로 답한다 (Cloudflare 껍데기와 같은 흐름).
    */
    let parsed = null;
    try {
      parsed = req.body ?? null;
    } catch {
      /* 알맹이가 BAD_INPUT 으로 답한다 */
    }
    const { status, body } = await handle(parsed, process.env);
    res.status(status).json(body);
  };
}
