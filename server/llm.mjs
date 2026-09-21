/**
 * 모델 호출 한 곳 — **여러 제공자를 돌아가며 쓴다.**
 *
 * 코치(`/api/coach`) · 습관 리포트(`/api/report`) · 코스 추천(`/api/recommend`) · 판 만들기(`/api/scenario`)가
 * **같은 배관**을 쓴다 — 키를 읽는 자리, 실패를 코드로 옮기는 방식, 응답에서 문장을 꺼내는 법이 네 벌이 되면
 * 한쪽만 고쳐지고 다른 쪽은 조용히 다르게 동작한다.
 *
 * **API 키를 읽는 것은 이 파일뿐이다.** 위쪽(핸들러)은 키를 보지 않고, 아래쪽(브라우저)으로는 애초에 내려가지 않는다.
 *
 * ## 왜 여러 곳인가
 *
 * 혼자 쓸 때는 유료 한 곳이면 됐지만, 사람이 늘면 그만큼 돈이 든다. 무료로 열려 있는 곳들(Google Gemini · Groq)은
 * 하루 요청 수로 한도를 세는데, **여러 곳을 번갈아 쓰면 한도가 합쳐진다.**
 *
 * 그리고 사용자가 짚은 것이 하나 더 있다 — "여러 무료 AI가 추천해 주는 방식을 하면 다양하게 운전 습관이 골라질 것
 * 같아." 맞는 말이다. 같은 기록을 줘도 모델마다 고르는 코스가 다르다. 한 모델만 쓰면 그 모델의 버릇(늘 같은 종류를
 * 고르는 성향)이 그대로 학습자의 하루가 된다. 돌아가며 쓰면 그 버릇이 섞인다.
 *
 * ## 어떻게 고르는가
 *
 *  1. **키가 있는 곳만** 후보다 (아래 PROVIDERS). 아무 키도 없으면 예전처럼 '기능 없음'(503 NO_KEY)이다.
 *     한 제공자에 **키를 여러 개** 넣을 수 있다 — `GEMINI_API_KEY` · `GEMINI_API_KEY1` · `GEMINI_API_KEY2` …
 *     무료 한도는 **키마다** 세므로, 키 둘이면 그 제공자의 하루치가 두 배다 (사용자가 그렇게 넣어 두었다).
 *     키 하나가 한 자리이고, 아래 차례에도 각각 들어간다.
 *  2. 요청마다 **시작점을 한 칸씩 민다**(`turn`) — 고르게 돌아간다.
 *  3. 그 자리에서 실패하면 **다음 곳으로 넘어간다.** 한도를 다 쓴 날(429)에도, 잠깐 죽은 날(5xx)에도 판은 돈다.
 *  4. 전부 실패하면 마지막 이유를 그대로 돌려준다 — 부르는 쪽은 그때 **코드로 고른다**
 *     (src/scenarios/recommend.ts 의 rulePick). 한도 초과는 **품질 저하이지 중단이 아니다.**
 *
 * ## 규격
 *
 * 세 곳 모두 **OpenAI 채팅 규격**을 받는다(Gemini 는 `/v1beta/openai/`, Groq 는 `/openai/v1/`). 그래서 이 파일은
 * 주소와 모델 이름만 갈아 끼우고 본문은 한 벌로 만든다. 모델 이름은 계속 바뀌므로 환경변수로 덮을 수 있게 둔다.
 */

/**
 * **브라우저가 보낸 것을 믿지 않는다** — 핸들러들이 입력을 좁힐 때 쓰는 도우미들.
 *
 * 이 파일에 함께 두는 이유는 callModel 과 같다: 네 핸들러(코치 · 리포트 · 추천 · 판 만들기)가 **같은 방식으로**
 * 걸러야 하기 때문이다. 각자 따로 쓰면 한쪽만 느슨해지고, 느슨한 쪽으로 이상한 값이 프롬프트에 실려 간다.
 *
 * 걸러 낸 이유는 `BadInput` 의 메시지로 그대로 나간다 (핸들러가 400 BAD_INPUT 의 `detail` 에 담는다) —
 * 어느 필드가 왜 틀렸는지 알 수 있어야 붙이는 쪽에서 고칠 수 있다.
 */
export class BadInput extends Error {}

/** 유한한 수 하나. 숫자꼴 문자열("3")도 받는다 — 붙이는 쪽 언어에 따라 그렇게 오기도 한다 */
export function num(v, name) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new BadInput(`${name}: 숫자가 아님`);
  return n;
}

/** 0~1 사이 비율 — 넘치면 자른다 (준수율 같은 값이라 범위 밖은 뜻이 없다) */
export function ratio(v, name) {
  return Math.max(0, Math.min(1, num(v, name)));
}

/** 문자열 하나. 앞뒤 공백을 떼고 `max` 자로 자른다 — 프롬프트가 길어지는 것을 여기서 막는다 */
export function str(v, max, name) {
  if (typeof v !== 'string') throw new BadInput(`${name}: 문자열이 아님`);
  return v.trim().slice(0, max);
}

/** 정해 둔 값 중 하나 — 모르는 값이 프롬프트에 실려 가지 않게 한다 */
export function oneOf(v, allowed, name) {
  if (!allowed.includes(v)) throw new BadInput(`${name}: 알 수 없는 값`);
  return v;
}

/**
 * **제공자 표 — 무료가 먼저다.**
 *
 * `models` 는 **여러 개를 적는다.** 키가 여러 개인 제공자는 자리마다 이 목록을 돌려 쓴다 — 같은 곳이라도
 * 자리마다 다른 모델이 고르게 되고, 그만큼 추천이 다양해진다 (사용자 요청: "Groq 에서 다른 모델을 쓸 수 있으면
 * 다양화해 보자"). 목록 항목은 이름 한 줄이거나, 그 모델에만 필요한 것을 붙인 객체다:
 *
 *   'qwen/qwen3.8-27b'                                   그냥 이름
 *   { id: 'openai/gpt-oss-20b', json: false, minOutput: 2000, extra: { reasoning_effort: 'low' } }
 *
 *  - `json: false` — **JSON 모드를 걸지 않는다.** Groq 의 `gpt-oss` 계열은 `response_format` 을 붙이면
 *    `json_validate_failed` 400 으로 거절한다(생각을 앞에 붙여 답하기 때문이다). 빼면 잘 답한다 — 어차피
 *    프롬프트가 "JSON 하나로만 답한다" 고 못 박고, 받는 쪽이 글 속의 `{…}` 를 꺼내 검증한다.
 *  - `minOutput` — 생각을 먼저 뱉는 모델의 **답 예산 바닥**. 300 토큰으로는 생각하다 끝나 빈 답이 온다.
 *  - `extra` — 그 모델에만 보내는 값. `gpt-oss` 는 생각을 **낮춰야** 본문이 나온다: 실제로 재 보니
 *    `medium` 은 생각에 6,782자를 쓰고 본문이 0자였고, `low` 는 1.2초에 제대로 답했다.
 *
 * 환경변수로 덮을 수 있다: `GROQ_MODEL` 은 모든 자리를, `GROQ_MODEL2` 는 둘째 자리만 바꾼다.
 *
 * `extra` 는 그 제공자 전체에 필요한 것: Gemini 는 생각(thinking)을 끈다. 켜 두면 `max_tokens`(300~900) 를
 * 생각하는 데 다 써 버리고 **빈 답**이 돌아온다.
 */
const PROVIDERS = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    env: 'GEMINI',
    url: (env) => env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: ['gemini-3.1-flash-lite'],
    extra: (env) => ({ reasoning_effort: env.GEMINI_REASONING || 'none' }),
  },
  {
    id: 'groq',
    label: 'Groq',
    env: 'GROQ',
    url: (env) => env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions',
    /*
      **넷을 돌려 쓴다.** 그 계정에서 열려 있는 대화형 모델을 모두 불러 보고 우리 일을 해낸 것만 남겼다:
      qwen 0.6초 · gpt-oss-20b 1.2초 · gpt-oss-120b 1.1초 · compound 4.3초 (compound-mini 5.6초는 느려서 뺐다).
      `allam-2-7b` 은 문맥이 작아 우리 프롬프트를 못 받는다(400).
    */
    models: [
      'qwen/qwen3.8-27b',
      { id: 'openai/gpt-oss-20b', json: false, minOutput: 2000, extra: { reasoning_effort: 'low' } },
      { id: 'openai/gpt-oss-120b', json: false, minOutput: 2000, extra: { reasoning_effort: 'low' } },
      'groq/compound',
    ],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    env: 'CEREBRAS',
    url: (env) => env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1/chat/completions',
    /*
      무료 한도가 후보 중 가장 크지만(하루 100만 토큰), 실제로 불러 보니 계정의 무료 한도가 열려 있지 않아
      402 였다 (.env 참고). 입력은 8,192 토큰까지 — 우리 요청 3~5천은 들어간다.
      **모델 이름은 키를 받은 뒤 `/v1/models` 로 확인하고 맞춘다.**
    */
    models: ['qwen-3.8-27b'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    env: 'OPENROUTER',
    url: (env) => env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions',
    /*
      **이름 끝의 `:free` 가 공짜라는 뜻이다.** 무료 22종을 한 번씩 불러 봤더니 이것만 우리 일을 해냈고
      (나머지는 상류 혼잡 429 · 빈 답 · 후보 밖 번호), 그마저 7~10초로 느리다.
    */
    models: [{ id: 'dots-studio/dots-3-note-preview:free', minOutput: 2000 }],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    env: 'NVIDIA',
    url: (env) => env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions',
    /*
      모델 100여 종에 분당 40회지만, 대화형 열 개를 불러 보니 목록에 있는데 404 이거나(Function … not found)
      18~85초가 걸렸다. 우리 화면은 15초에 끊으므로 그 안에 들어오지 못한다 (.env 참고).
    */
    models: ['nvidia/nemotron-3-super-120b-a12b'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    env: 'OPENAI',
    url: (env) => env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o-mini'],
  },
];

/** 목록 항목을 한 모양으로 — 이름만 적은 것도 객체로 편다 */
const asModel = (m) => (typeof m === 'string' ? { id: m } : m);

/** 돌아가며 쓰기 위한 시작점. 첫 요청이 늘 같은 곳으로 가지 않게 무작위에서 출발한다. */
let turn = Math.floor(Math.random() * PROVIDERS.length);

/**
 * 이번 요청에서 **시도할 차례**를 만든다.
 *
 * @param {Array<object>} available 키가 있는 제공자들
 * @param {number} start 시작점 (몇 번째부터 돌릴지)
 * @returns {Array<object>} 시작점부터 한 바퀴
 */
export function order(available, start) {
  if (available.length === 0) return [];
  const at = ((start % available.length) + available.length) % available.length;
  return [...available.slice(at), ...available.slice(0, at)];
}

/** 한 제공자에서 찾아볼 키 번호의 끝 — `GEMINI_API_KEY9` 까지 */
const MAX_KEYS = 9;

/**
 * 한 제공자의 **키들** — `GEMINI_API_KEY` 와 `GEMINI_API_KEY1` … `GEMINI_API_KEY9` 중 채워진 것.
 *
 * 무료 한도는 키마다 세므로 키를 늘리면 하루치가 그만큼 늘어난다. 번호는 **비어 있어도 건너뛰고 끝까지 본다** —
 * 2번만 지웠다고 3번이 묻히면 왜 안 쓰이는지 알 길이 없다.
 */
function keysOf(provider, env) {
  const keyVar = `${provider.env}_API_KEY`;
  const found = [];
  if (env[keyVar]) found.push({ key: env[keyVar], n: 0 });
  for (let i = 1; i <= MAX_KEYS; i++) {
    const v = env[`${keyVar}${i}`];
    if (v) found.push({ key: v, n: i });
  }
  return found;
}

/**
 * 이 자리가 쓸 **모델** — 자리마다 목록을 돌려 쓴다 (첫째 자리는 목록의 첫 모델, 둘째 자리는 둘째 …).
 *
 * 환경변수가 이깁니다: `GROQ_MODEL2` 는 둘째 자리만, `GROQ_MODEL` 은 모든 자리를 덮는다.
 */
function modelOf(provider, env, slot, n) {
  const named = env[`${provider.env}_MODEL${n}`] || env[`${provider.env}_MODEL`];
  if (named) return { id: named };
  return asModel(provider.models[(slot - 1) % provider.models.length]);
}

/**
 * 이 환경에서 쓸 수 있는 **자리들** — 키 하나가 한 자리다 (키가 둘이면 그 제공자는 두 자리).
 *
 * `LLM_PROVIDER` 로 한 제공자만 못박을 수 있다(`gemini` · `groq` · `openai`). 어느 모델이 무엇을 고르는지 견줘 볼 때와,
 * 한 곳이 이상하게 답할 때 범인을 가릴 때 쓴다.
 */
export function providersFor(env) {
  const only = (env.LLM_PROVIDER || '').trim();
  const slots = [];
  for (const p of PROVIDERS) {
    if (only && p.id !== only) continue;
    const keys = keysOf(p, env);
    keys.forEach(({ key, n }, i) =>
      slots.push({
        ...p,
        keyVar: `${p.env}_API_KEY`,
        key,
        slot: i + 1,
        keyCount: keys.length,
        model: modelOf(p, env, i + 1, n),
      }),
    );
  }
  return slots;
}

/**
 * **한 곳을 이만큼만 기다린다** (ms) — 넘으면 끊고 다음 곳으로 간다.
 *
 * 처음에는 기다림에 끝이 없었다. 배포(Vercel)에서 한 제공자가 답을 쥔 채 멈추자, 다음 곳으로 넘어가지 못하고
 * 함수가 통째로 30초 동안 붙잡혀 있다가 `FUNCTION_INVOCATION_TIMEOUT` 으로 잘렸다. 그 사이 브라우저는 15초에
 * 먼저 포기해 규칙 추천으로 넘어갔다 — **다른 두 곳이 멀쩡히 살아 있는데도** AI 추천이 빠진 것이다.
 *
 * 정상이면 2~3초에 온다 (배포판에서 잰 값). 5초면 느린 모델도 대개 넘기고, 멈춘 곳 하나를 버리고도 다음 곳을
 * 물어볼 시간이 남는다.
 */
export const ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * **한 요청 전체의 예산** (ms) — 여러 곳을 돌아도 이 안에서 끝낸다.
 *
 * 브라우저가 가장 먼저 포기하는 곳(코치 · 리포트 12초 — coach/client.ts)보다 **짧아야** 한다. 그래야 모두 실패해도
 * 서버가 먼저 "실패" 를 돌려주고, 브라우저는 끊긴 연결이 아니라 답을 받아 제 길(규칙 추천 · 코치 없음)로 간다.
 * 남는 1초는 오가는 길(연결 · 함수 기동)에 쓴다.
 */
export const TOTAL_BUDGET_MS = 11_000;

/**
 * 모델을 부르고 문장 하나를 돌려준다.
 *
 * 던지지 않고 **상태 코드와 본문을 값으로** 돌려준다 — 부르는 쪽(Vite 미들웨어 · Cloudflare Workers)의 응답 만드는
 * 방식이 서로 달라서, 여기서 Response 를 만들면 한쪽에서 못 쓴다.
 *
 * `json` 을 켜면 모델이 **JSON 객체**를 뱉게 한다 (추천 · 시나리오 생성이 쓴다). 다만 이것만 믿지 않는다 — Gemini 의
 * OpenAI 호환 창구는 이 값을 조용히 무시하기도 한다. 그래서 프롬프트가 "JSON 하나로만 답한다" 고 못 박고
 * (server/recommendPrompt.mjs), 받는 쪽이 글 속의 `{…}` 를 꺼내 검증한다 (parseReply · src/scenarios/validate.ts).
 *
 * @param {{ system: string, user: string, maxTokens: number, json?: boolean }} prompt
 * @param {Record<string, string|undefined>} env
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function callModel({ system, user, maxTokens, json = false }, env) {
  const available = providersFor(env);
  /*
    키가 없으면 **에러가 아니라 '기능 없음'** 으로 답한다. 키 없이 개발하는 사람도 게임 전체는 그대로 돌아가야 하고,
    브라우저는 이 코드를 보고 조용히 칸을 감춘다.
  */
  if (available.length === 0) return { status: 503, body: { error: 'NO_KEY' } };

  const queue = order(available, turn++);
  let last = { status: 502, body: { error: 'UPSTREAM_UNREACHABLE' } };

  /*
    **어떤 실패든 다음 곳을 본다.** 한때 400 은 '우리 쪽 잘못이니 다른 곳도 같다' 고 보고 멈췄는데, 실제로
    불러 보니 아니었다 — Groq 의 `gpt-oss` 계열은 우리 JSON 요청을 400(json_validate_failed)으로 거절하고,
    없는 모델 이름은 404 다. 둘 다 **그 제공자에서만** 나는 실패다. 보낸 것이 정말 틀렸으면 세 곳이 모두
    같은 이유로 실패하고, 마지막 이유가 그대로 올라간다 (입력 자체는 핸들러가 이미 걸렀다).
  */
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (const provider of queue) {
    const left = deadline - Date.now();
    // 남은 예산으로는 한 곳도 제대로 물어볼 수 없다 — 붙잡고 있지 말고 지금까지의 실패를 돌려준다
    if (left < 1_000) break;
    const res = await once(provider, { system, user, maxTokens, json }, env, Math.min(ATTEMPT_TIMEOUT_MS, left));
    if (res.status === 200) return res;
    last = res;
  }
  return last;
}

/**
 * 한 곳에 한 번 물어본다 — `waitMs` 가 지나면 끊는다. **본문을 받는 동안에도** 끊는다 (머리만 보내고 본문을 끄는 곳이 있다).
 *
 * 끊겨서 실패한 것은 `UPSTREAM_TIMEOUT` 으로 가려 적는다. 본문의 `status` 는 429 가 아니어야 한다 — 브라우저가
 * 그 값을 "AI 의 일일 사용량 초과" 로 읽는다 (scenarios/recommend.ts 의 askAi).
 */
async function once(provider, prompt, env, waitMs) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), waitMs);
  try {
    const res = await request(provider, prompt, env, abort.signal);
    if (res.status !== 200 && abort.signal.aborted) {
      return { status: 504, body: { error: 'UPSTREAM_TIMEOUT', provider: provider.id, model: provider.model.id, status: 0 } };
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** 한 곳에 보내고 받은 것을 값으로 돌려준다 (끊는 것은 `once` 가 한다) */
async function request(provider, { system, user, maxTokens, json }, env, signal) {
  // 모델 이름도 함께 돌려준다 — 화면이 "Gemini gemini-3.1-flash-lite 모델이 골라 줬어요!" 라고 적는다 (사용자 요청)
  const model = provider.model.id;
  // 생각을 먼저 뱉는 모델은 예산이 모자라면 빈 답이 온다 — 그런 모델만 바닥을 높인다 (위 minOutput)
  const budget = Math.max(maxTokens, provider.model.minOutput ?? 0);
  // JSON 모드를 거절하는 모델이 있다 — 그때는 빼고 프롬프트에 맡긴다 (위 json: false)
  const useJson = json && provider.model.json !== false;
  let res;
  try {
    res = await fetch(provider.url(env), {
      signal,
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: budget,
        ...(useJson ? { response_format: { type: 'json_object' } } : {}),
        ...(provider.extra ? provider.extra(env) : {}),
        ...(provider.model.extra ?? {}),
        messages: [
          /*
            지시사항과 조문 근거는 **앞에** 둔다. 매 요청 똑같은 내용이라 캐시가 듣는 자리이고, 판마다 달라지는
            값은 뒤로 보낸다.
          */
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch {
    return { status: 502, body: { error: 'UPSTREAM_UNREACHABLE', provider: provider.id, model, status: 0 } };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return {
      status: 502,
      body: { error: 'UPSTREAM_ERROR', provider: provider.id, model, status: res.status, detail: detail.slice(0, 400) },
    };
  }

  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content?.trim();
  // 빈 답도 **다음 곳으로 넘어갈 실패**다 — 생각에 예산을 다 쓴 모델이 이렇게 답한다 (위 extra 주석)
  if (!text) return { status: 502, body: { error: 'EMPTY_RESPONSE', provider: provider.id, model, status: 502 } };

  return { status: 200, body: { text, provider: provider.id, model } };
}
