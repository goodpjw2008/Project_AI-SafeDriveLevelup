/**
 * recommendPrompt.mjs 의 타입 (coachPrompt.d.mts 와 같은 이유로 손으로 적는다).
 * tests/recommend.test.ts 가 이 선언과 실제 값이 어긋나지 않는지 확인한다.
 */

export declare const SYSTEM_PROMPT: string;
export declare function buildUserPrompt(req: unknown): string;

/** 습관이 풀리는 데 필요한 무위반 판 수 — src/coach/badHabits.ts 와 같은 값이어야 한다 */
export declare const HABIT_CLEARED_AFTER: number;
