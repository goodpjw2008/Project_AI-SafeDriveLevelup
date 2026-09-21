/**
 * reportPrompt.mjs 의 타입.
 *
 * 알맹이를 평범한 `.mjs` 로 두는 이유는 coachPrompt.d.mts 와 같다 — 한 파일이 Vite 개발
 * 서버(Node)·Cloudflare Pages Functions·vitest 세 군데에서 돌아야 한다.
 *
 * `HabitSummary` 를 그대로 받는다. src/coach/habits.ts 가 만든 것이 여기로 오므로,
 * 두 쪽이 어긋나면 tests/habits.test.ts 의 계약 검증이 잡는다.
 */

export interface ReportSummary {
  runs: number;
  stagesPlayed: number;
  cleanRuns: number;
  grades: Record<string, number>;
  points: { label: string; kept: number; total: number; rate: number }[];
  byCode: { code: string; count: number }[];
  trend: { early: number; late: number } | null;
  mostRetried: { stage: number; count: number } | null;
}

/** 지시사항 + 진단의 뼈대 + 흔한 오해 — 매 요청 동일하다 */
export declare const REPORT_SYSTEM_PROMPT: string;

export declare function buildReportPrompt(summary: ReportSummary): string;
