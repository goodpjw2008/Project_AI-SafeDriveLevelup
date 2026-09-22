/** recommendHandler.mjs 의 타입 (coachPrompt.d.mts 와 같은 이유로 손으로 적는다) */

export interface RecommendReply {
  /** 고른 후보 번호 — 보낸 후보 안에 있다 */
  id: number;
  why: string;
  focus: string;
  /** 먼저 고칠 습관 — 먼저 고칠 습관을 정하라고 했고, 고른 코스가 그 습관을 시험할 때만 */
  habit?: string;
  /** 어느 제공자가 골랐는가 — 'gemini' · 'groq' · 'openai' (llm.mjs) */
  picker?: string;
  /** 그 제공자의 어느 모델인가 — 'gemini-3.1-flash-lite' 처럼 화면에 그대로 적는다 */
  model?: string;
}

/** 브라우저가 보낸 것을 알려진 모양으로 좁힌다. 틀리면 던진다 */
export declare function sanitize(body: unknown): unknown;
/** 모델의 JSON 답에서 보낸 후보 번호와 글만 남긴다. 못 읽거나 후보 밖이면 null */
export declare function parseReply(
  text: string,
  ids: number[],
  habitOk?: (id: number, habit: string) => boolean,
): RecommendReply | null;
export declare function handleRecommend(
  body: unknown,
  env: Record<string, string | undefined>,
): Promise<{ status: number; body: object }>;
