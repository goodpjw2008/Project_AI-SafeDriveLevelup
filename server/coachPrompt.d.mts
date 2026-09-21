/**
 * coachPrompt.mjs 의 타입.
 *
 * 알맹이를 평범한 `.mjs` 로 두는 이유는 **한 파일이 세 군데에서 돌아야** 하기 때문이다 —
 * Vite 개발 서버(Node), Cloudflare Pages Functions, 그리고 vitest. TS 로 쓰면 Workers
 * 쪽에서 빌드 단계를 하나 더 끼워야 하고, 그러면 로컬과 배포가 어긋날 자리가 생긴다.
 *
 * 대신 타입은 여기서 손으로 적는다. tests/coachPrompt.test.ts 가 이 선언과 실제 동작이
 * 어긋나지 않는지 확인한다.
 */

export interface ViolationBrief {
  /** 위반명 — src/rules/violations.ts 의 title 과 같다 */
  title: string;
  /** 근거 조문 표기 (원문이 아니라 표기만) */
  law: string;
}

/** 위반 코드 → 코치가 아는 최소한. 키는 ViolationCode 와 같아야 한다 */
export declare const VIOLATION_BRIEF: Record<string, ViolationBrief>;

/** 지시사항 + 조문 표기 + 흔한 오해 — 매 요청 동일하다 */
export declare const SYSTEM_PROMPT: string;

/** 한 판의 판정 결과 — 브라우저가 보내고 coachHandler 가 좁혀 준 모양 */
export interface CoachRun {
  stage: number;
  title: string;
  grade: string;
  failReason: string | null;
  violations: { code: string; atTime: number; place: string; inSchoolZone: boolean }[];
  stats: {
    cleanStopBeforeA: boolean;
    lateStopBeforeA: boolean;
    stopBeforeC: boolean;
    maxSpeedInIntersection: number;
    signalAt30m: boolean;
    elapsed: number;
  };
  log: { t: number; level: string; text: string }[];
}

export declare function buildUserPrompt(run: CoachRun): string;
