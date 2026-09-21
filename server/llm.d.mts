/** llm.mjs 의 타입 (coachPrompt.d.mts 와 같은 이유로 손으로 적는다) */

export interface SlotModel {
  /** 부를 모델 이름 */
  id: string;
  /** JSON 모드를 걸지 않는다 (붙이면 400 으로 거절하는 모델이 있다) */
  json?: boolean;
  /** 답 예산의 바닥 — 생각을 먼저 뱉는 모델은 300 으로는 빈 답이 온다 */
  minOutput?: number;
  /** 그 모델에만 보내는 값 (`reasoning_effort` 등) */
  extra?: Record<string, unknown>;
}

export interface ProviderSlot {
  id: string;
  label: string;
  keyVar: string;
  /** 이 자리가 쓸 모델 — 키가 여럿이면 자리마다 목록을 돌려 쓴다 */
  model: SlotModel;
  /** 이 자리가 쓰는 키 */
  key: string;
  /** 같은 제공자 안에서 몇 번째 키인가 (1부터) */
  slot: number;
  /** 그 제공자에 넣어 둔 키 수 */
  keyCount: number;
}

/** 쓸 수 있는 자리들 — **키 하나가 한 자리**다. `LLM_PROVIDER` 로 한 제공자만 못박을 수 있다 */
export declare function providersFor(env: Record<string, string | undefined>): ProviderSlot[];
/** 이번 요청에서 시도할 차례 — `start` 부터 한 바퀴 */
export declare function order<T>(available: T[], start: number): T[];
/** 모델을 부르고 문장 하나를 돌려준다. 던지지 않고 값으로 돌려준다 */
export declare function callModel(
  prompt: { system: string; user: string; maxTokens: number; json?: boolean },
  env: Record<string, string | undefined>,
): Promise<{
  status: number;
  body: { text?: string; provider?: string; model?: string; error?: string; status?: number };
}>;

/** 걸러 낸 이유를 담은 예외 — 핸들러가 400 BAD_INPUT 의 detail 로 내보낸다 */
export declare class BadInput extends Error {}
/** 유한한 수 하나 (숫자꼴 문자열도 받는다) */
export declare function num(v: unknown, name: string): number;
/** 0~1 사이 비율 — 넘치면 자른다 */
export declare function ratio(v: unknown, name: string): number;
/** 문자열 하나 — 공백을 떼고 max 자로 자른다 */
export declare function str(v: unknown, max: number, name: string): string;
/** 정해 둔 값 중 하나 */
export declare function oneOf<T>(v: unknown, allowed: readonly T[], name: string): T;
