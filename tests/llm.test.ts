/**
 * **여러 무료 AI 를 돌아가며 쓴다** (server/llm.mjs).
 *
 * 사용자가 정한 방식이다 — "여러 무료 AI 가 추천해 주는 방식을 하면 다양하게 운전 습관이 골라질 것 같아."
 * 같은 기록을 줘도 모델마다 고르는 코스가 달라서, 한 모델의 버릇이 학습자의 하루가 되지 않는다. 덤으로 무료
 * 한도가 합쳐진다 (Gemini 1,000/일 + Groq 1,000/일 …).
 *
 * 여기서 못 박는 것은 넷이다.
 *  - 키가 있는 곳만 후보이고, 하나도 없으면 **에러가 아니라 '기능 없음'**(NO_KEY)
 *  - 요청마다 **시작점이 한 칸씩 밀린다** (한 곳에 몰리지 않는다)
 *  - 한도를 다 썼거나(429) 죽었으면(5xx · 못 닿음 · 빈 답) **다음 곳으로 넘어간다**
 *  - 우리 쪽 잘못(400 · 401)이면 넘어가지 않는다 — 다른 곳도 같을 테니 그대로 알린다
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BadInput, callModel, num, oneOf, order, providersFor, ratio, str } from '../server/llm.mjs';

type Env = Record<string, string | undefined>;

const ALL: Env = { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', OPENAI_API_KEY: 'o' };

/** 부른 주소를 기록하는 가짜 서버 — 주소별로 어떻게 답할지 정한다 */
function stub(reply: (url: string) => { status: number; body?: unknown }): { urls: string[]; bodies: any[] } {
  const urls: string[] = [];
  const bodies: any[] = [];
  vi.stubGlobal('fetch', (url: string, init: { body: string }) => {
    urls.push(url);
    bodies.push(JSON.parse(init.body));
    const r = reply(url);
    return Promise.resolve({
      ok: r.status === 200,
      status: r.status,
      json: () => Promise.resolve(r.body ?? { choices: [{ message: { content: '{"id":1}' } }] }),
      text: () => Promise.resolve('그쪽 에러 본문'),
    });
  });
  return { urls, bodies };
}

const ask = (env: Env) => callModel({ system: '시스템', user: '사용자', maxTokens: 300, json: true }, env);
const host = (url: string): string => new URL(url).host.split('.').slice(-2)[0];

afterEach(() => vi.unstubAllGlobals());

describe('제공자 고르기', () => {
  it('키가 있는 곳만 후보다', () => {
    expect(providersFor({}).length).toBe(0);
    expect(providersFor({ GROQ_API_KEY: 'q' }).map((p) => p.id)).toEqual(['groq']);
    expect(providersFor(ALL).map((p) => p.id)).toEqual(['gemini', 'groq', 'openai']);
  });

  /*
    **키 하나가 한 자리다.** 무료 한도는 키마다 세므로 키를 늘리면 그 제공자의 하루치가 그만큼 늘어난다 —
    사용자가 Gemini 키를 둘 넣어 두었다 (`GEMINI_API_KEY1` · `GEMINI_API_KEY2`).
  */
  it('한 제공자에 키를 여러 개 넣으면 그만큼 자리가 는다', () => {
    const slots = providersFor({ GEMINI_API_KEY1: 'a', GEMINI_API_KEY2: 'b', GROQ_API_KEY: 'q' });
    expect(slots.map((p) => `${p.id}#${p.slot}`)).toEqual(['gemini#1', 'gemini#2', 'groq#1']);
    expect(slots.map((p) => p.key)).toEqual(['a', 'b', 'q']);
  });

  it('번호 없는 키와 번호 키를 함께 쓴다 — 번호가 비어도 뒤엣것을 찾는다', () => {
    const slots = providersFor({ GEMINI_API_KEY: 'a', GEMINI_API_KEY3: 'c' });
    expect(slots.map((p) => p.key)).toEqual(['a', 'c']);
  });

  /*
    **빈 줄은 아무 일도 하지 않는다.** .env 에는 아직 안 받은 키 자리가 빈 채로 놓여 있다
    (CEREBRAS_API_KEY1= · OPENROUTER_API_KEY1= …). 그 자리가 차례에 끼면 매 판 한 번씩 헛걸음한다.
  */
  it('빈 키는 자리가 되지 않는다 — 채우기 전까지 없는 것과 같다', () => {
    const slots = providersFor({ GEMINI_API_KEY1: 'a', CEREBRAS_API_KEY1: '', OPENROUTER_API_KEY1: undefined });
    expect(slots.map((p) => p.id)).toEqual(['gemini']);
  });

  it('무료가 먼저, 유료가 맨 뒤다', () => {
    const slots = providersFor({
      GEMINI_API_KEY1: 'a',
      GROQ_API_KEY1: 'b',
      CEREBRAS_API_KEY1: 'c',
      OPENROUTER_API_KEY1: 'd',
      NVIDIA_API_KEY1: 'e',
      OPENAI_API_KEY: 'f',
    });
    expect(slots.map((p) => p.id)).toEqual(['gemini', 'groq', 'cerebras', 'openrouter', 'nvidia', 'openai']);
  });

  it('LLM_PROVIDER 로 하나만 못박는다 — 어느 모델이 무엇을 고르는지 견줄 때', () => {
    expect(providersFor({ ...ALL, LLM_PROVIDER: 'groq' }).map((p) => p.id)).toEqual(['groq']);
  });

  it('차례는 시작점부터 한 바퀴다 — 아무도 빠지지 않는다', () => {
    expect(order([1, 2, 3], 0)).toEqual([1, 2, 3]);
    expect(order([1, 2, 3], 1)).toEqual([2, 3, 1]);
    expect(order([1, 2, 3], 5)).toEqual([3, 1, 2]);
    expect(order([], 2)).toEqual([]);
  });
});

describe('돌아가며 부르기', () => {
  it('키가 하나도 없으면 기능 없음 — 게임은 그대로 돈다', async () => {
    const seen = stub(() => ({ status: 200 }));
    const res = await callModel({ system: 's', user: 'u', maxTokens: 10 }, {});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('NO_KEY');
    expect(seen.urls).toEqual([]); // 부르지도 않는다
  });

  it('세 번 부르면 세 곳이 한 번씩 — 한 곳에 몰리지 않는다', async () => {
    const seen = stub(() => ({ status: 200 }));
    for (let i = 0; i < 3; i++) await ask(ALL);
    expect(new Set(seen.urls.map(host)).size).toBe(3);
  });

  it('같은 제공자의 키 둘도 번갈아 쓴다 — 한 키만 한도를 태우지 않게', async () => {
    const keys: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init: { headers: Record<string, string> }) => {
      keys.push(init.headers.Authorization);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: '답' } }] }),
        text: () => Promise.resolve(''),
      });
    });
    for (let i = 0; i < 4; i++) await ask({ GEMINI_API_KEY1: 'a', GEMINI_API_KEY2: 'b' });
    expect(new Set(keys)).toEqual(new Set(['Bearer a', 'Bearer b']));
    // 네 번에 두 키가 두 번씩 — 한쪽으로 몰리지 않는다
    expect(keys.filter((k) => k === 'Bearer a').length).toBe(2);
  });

  it('한도를 다 썼으면(429) 다음 곳이 답한다', async () => {
    // 시작점은 무작위다 — 그래서 '몇 번 불렀나' 가 아니라 **어디서 답을 받았나** 로 본다
    const seen = stub((url) => ({ status: host(url) === 'openai' ? 200 : 429 }));
    const res = await ask(ALL);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('openai');
    expect(host(seen.urls[seen.urls.length - 1])).toBe('openai');
  });

  it('빈 답도 넘어갈 실패다 — 생각에 예산을 다 쓴 모델이 이렇게 답한다', async () => {
    let first = true;
    const seen = stub(() => {
      const empty = first;
      first = false;
      return { status: 200, body: { choices: [{ message: { content: empty ? '' : '답' } }] } };
    });
    const res = await ask(ALL);
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('답');
    expect(seen.urls.length).toBe(2);
  });

  it('400 · 404 도 넘어간다 — 제공자마다 되는 모델이 다르다', async () => {
    /*
      실제로 겪은 일이다: Groq 의 `gpt-oss` 계열은 우리 JSON 요청을 400(json_validate_failed)으로 거절하고,
      없는 모델 이름은 404 다. 그 제공자에서만 나는 실패라 다음 곳이 답할 수 있다.
    */
    const seen = stub((url) => ({ status: host(url) === 'gemini' ? 400 : 200 }));
    const res = await ask({ ...ALL, GEMINI_BASE_URL: 'https://x.gemini.test/v1/chat/completions' });
    expect(res.status).toBe(200);
    expect(seen.urls.length).toBeLessThanOrEqual(3);
  });

  it('모두 실패하면 마지막 이유를 그대로 — 부르는 쪽이 코드로 고른다', async () => {
    const seen = stub(() => ({ status: 429 }));
    const res = await ask(ALL);
    expect(res.status).toBe(502);
    expect(res.body.status).toBe(429);
    expect(seen.urls.length).toBe(3); // 세 곳을 다 두드려 봤다
  });
});

describe('보내는 본문', () => {
  it('어느 곳이든 같은 대화를 보낸다 — 규격이 OpenAI 채팅 하나라서', async () => {
    const seen = stub(() => ({ status: 200 }));
    await ask({ GROQ_API_KEY: 'q' });
    expect(seen.bodies[0].messages).toEqual([
      { role: 'system', content: '시스템' },
      { role: 'user', content: '사용자' },
    ]);
    expect(seen.bodies[0].max_tokens).toBe(300);
    expect(seen.bodies[0].response_format).toEqual({ type: 'json_object' });
  });

  it('Cerebras · OpenRouter 는 기본 모델로 부른다 — 이름은 환경변수로 갈아 끼운다', async () => {
    const seen = stub(() => ({ status: 200 }));
    await ask({ CEREBRAS_API_KEY1: 'c' });
    expect(seen.urls[0]).toContain('api.cerebras.ai');
    await ask({ OPENROUTER_API_KEY1: 'o' });
    expect(seen.urls[1]).toContain('openrouter.ai');
    // 공짜는 이름이 :free 로 끝나는 것뿐이다
    expect(seen.bodies[1].model).toMatch(/:free$/);
  });

  /*
    **자리마다 다른 모델을 쓴다** — 사용자가 Groq 계정을 넷으로 늘리며 "다른 모델을 쓸 수 있으면 다양화해
    보자" 고 했다. 같은 곳이라도 자리마다 다른 모델이 고르면 추천이 그만큼 다양해진다.
  */
  it('키가 넷이면 모델도 넷 — 자리마다 목록을 돌려 쓴다', async () => {
    const seen = stub(() => ({ status: 200 }));
    for (let i = 0; i < 4; i++) {
      await ask({ GROQ_API_KEY1: 'a', GROQ_API_KEY2: 'b', GROQ_API_KEY3: 'c', GROQ_API_KEY4: 'd' });
    }
    expect(new Set(seen.bodies.map((b) => b.model)).size).toBe(4);
  });

  it('모델 이름을 덮을 수 있다 — 한 자리만도, 모든 자리도', async () => {
    const seen = stub(() => ({ status: 200 }));
    await ask({ GROQ_API_KEY1: 'a', GROQ_MODEL: '전체-덮기' });
    expect(seen.bodies[0].model).toBe('전체-덮기');
    // 자리 번호를 붙이면 그 자리만
    await ask({ GROQ_API_KEY2: 'b', GROQ_MODEL2: '둘째만' });
    expect(seen.bodies[1].model).toBe('둘째만');
  });

  /*
    **JSON 모드를 거절하는 모델이 있다.** Groq 의 gpt-oss 계열은 `response_format` 을 붙이면 400 이고,
    생각을 낮추지 않으면(`reasoning_effort: low`) 본문이 비어 온다 — 둘 다 실제로 겪어서 모델에 적어 두었다.
  */
  it('모델마다의 사정을 함께 적어 둔다 — JSON 모드 빼기 · 생각 낮추기 · 예산 바닥', () => {
    const oss = providersFor({ GROQ_API_KEY1: 'a', GROQ_API_KEY2: 'b' })[1].model;
    expect(oss.id).toBe('openai/gpt-oss-20b');
    expect(oss.json).toBe(false);
    expect(oss.minOutput).toBe(2000);
    expect(oss.extra).toEqual({ reasoning_effort: 'low' });
  });

  /*
    **생각을 먼저 뱉는 모델에는 예산을 넉넉히 준다.** 실제로 재 봤다 — OpenRouter 의 무료 모델들은 300 토큰
    예산으로는 생각하다 끝나 빈 답이 왔고, 2,000 을 주니 제대로 골랐다 (server/llm.mjs 의 minOutput).
  */
  it('모델이 요구하면 답 예산의 바닥을 높인다 — 다른 모델은 그대로다', async () => {
    const seen = stub(() => ({ status: 200 }));
    await ask({ OPENROUTER_API_KEY1: 'o' });
    expect(seen.bodies[0].max_tokens).toBe(2000);
    await ask({ GROQ_API_KEY1: 'q' });
    expect(seen.bodies[1].max_tokens).toBe(300);
    expect(seen.bodies[1].response_format).toEqual({ type: 'json_object' });
    // gpt-oss 자리는 JSON 모드를 빼고 생각을 낮춘다
    await ask({ GROQ_API_KEY1: 'q', GROQ_API_KEY2: 'r' });
    await ask({ GROQ_API_KEY1: 'q', GROQ_API_KEY2: 'r' });
    const oss = seen.bodies.find((b) => b.model === 'openai/gpt-oss-20b');
    expect(oss.response_format).toBeUndefined();
    expect(oss.reasoning_effort).toBe('low');
    expect(oss.max_tokens).toBe(2000);
  });

  it('Gemini 는 생각을 끈다 — 켜 두면 300토큰을 생각에 다 쓰고 빈 답이 온다', async () => {
    const seen = stub(() => ({ status: 200 }));
    await ask({ GEMINI_API_KEY: 'g' });
    expect(seen.bodies[0].reasoning_effort).toBe('none');
    expect(seen.bodies[0].model).toBe('gemini-3.1-flash-lite');
  });

  it('모델 이름은 환경변수로 덮는다 — 이름은 계속 바뀐다', async () => {
    const seen = stub(() => ({ status: 200 }));
    await ask({ GROQ_API_KEY: 'q', GROQ_MODEL: '새-모델' });
    expect(seen.bodies[0].model).toBe('새-모델');
  });

  it('어느 곳이 **어느 모델로** 답했는지 함께 돌려준다 — 화면이 그대로 적는다', async () => {
    stub(() => ({ status: 200 }));
    const res = await ask({ GEMINI_API_KEY: 'g' });
    expect(res.body.provider).toBe('gemini');
    expect(res.body.model).toBe('gemini-3.1-flash-lite');
    // 환경변수로 갈아 끼우면 그 이름이 나간다 — 화면에 적히는 값이라 실제로 부른 이름이어야 한다
    const other = await ask({ GROQ_API_KEY: 'q', GROQ_MODEL: 'qwen/무엇' });
    expect(other.body.model).toBe('qwen/무엇');
  });
});

/*
  **입력 도우미** — 네 핸들러(코치 · 리포트 · 추천 · 판 만들기)가 브라우저가 보낸 것을 좁힐 때 같이 쓴다.
  여기서 못 박는 이유: 이 파일을 고치다 한 번 통째로 날려 먹었고(핸들러가 `num is not a function` 으로 터졌다),
  그때 이 테스트가 있었으면 바로 잡혔다.
*/
describe('입력 좁히기', () => {
  it('num — 수와 숫자꼴 문자열만', () => {
    expect(num(3, 'a')).toBe(3);
    expect(num('3.5', 'a')).toBe(3.5);
    expect(() => num('셋', 'level')).toThrow(BadInput);
    expect(() => num(undefined, 'level')).toThrow('level: 숫자가 아님');
    expect(() => num(Infinity, 'level')).toThrow(BadInput);
  });

  it('ratio — 0~1 로 자른다', () => {
    expect(ratio(0.42, 'r')).toBeCloseTo(0.42);
    expect(ratio(9, 'r')).toBe(1);
    expect(ratio(-1, 'r')).toBe(0);
  });

  it('str — 문자열만, 공백을 떼고 길이를 자른다', () => {
    expect(str('  안녕  ', 10, 's')).toBe('안녕');
    expect(str('가나다라', 2, 's')).toBe('가나');
    expect(() => str(7, 10, 'title')).toThrow('title: 문자열이 아님');
  });

  it('oneOf — 정해 둔 값만 프롬프트에 실린다', () => {
    expect(oneOf('PASS', ['PASS', 'FAIL'], 'grade')).toBe('PASS');
    expect(() => oneOf('무엇', ['PASS', 'FAIL'], 'grade')).toThrow('grade: 알 수 없는 값');
  });
});
