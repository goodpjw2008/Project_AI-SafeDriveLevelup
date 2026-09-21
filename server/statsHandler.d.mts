/** statsHandler.mjs 의 타입 (coachPrompt.d.mts 와 같은 이유로 손으로 적는다) */

type Env = Record<string, string | undefined>;
type Reply = { status: number; body: Record<string, unknown> };

export declare function handleStatsRead(env: Env): Promise<Reply>;
export declare function handleStatsWrite(body: unknown, env: Env, now?: number): Promise<Reply>;
