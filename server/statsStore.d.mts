/** statsStore.mjs 의 타입 (coachPrompt.d.mts 와 같은 이유로 손으로 적는다) */

type Env = Record<string, string | undefined>;

export interface StatsStore {
  persistent: boolean;
  begin(key: string, now: number): Promise<boolean>;
  finish(
    key: string,
    totals: string,
    outcome: 'success' | 'fail',
    now: number,
  ): Promise<{ state: 'ok'; success: number; fail: number } | { state: 'gone' | 'short' }>;
  totals(totals: string): Promise<{ success: number; fail: number }>;
}

export declare const RUN_TTL_SEC: number;
export declare const MIN_RUN_MS: number;
export declare const FINISH_SCRIPT: string;
export declare function storeFor(env: Env): StatsStore | null;
export declare function namespaceOf(env: Env): string;
export declare function totalsKey(ns: string): string;
export declare function runKey(ns: string, ticket: string): string;
export declare function newTicket(): string;
export declare function resetMemoryStore(): void;
