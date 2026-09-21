/** vercelHandler.mjs 의 타입 (coachPrompt.d.mts 와 같은 이유로 손으로 적는다) */

export const RATE_WINDOW_MS: number;
export const RATE_PER_WINDOW: number;

export function overLimit(key: string, now?: number): boolean;
export function resetRateLimit(): void;

/** Vercel 이 넘겨주는 요청 · 응답 중 여기서 쓰는 것만 */
export interface VercelLikeRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
}
export interface VercelLikeResponse {
  setHeader(name: string, value: string): void;
  status(code: number): VercelLikeResponse;
  json(body: unknown): void;
}

export function vercelHandler(
  name: string,
  handle: (body: unknown, env: Record<string, string | undefined>) => Promise<{ status: number; body: unknown }>,
): (req: VercelLikeRequest, res: VercelLikeResponse) => Promise<void>;
