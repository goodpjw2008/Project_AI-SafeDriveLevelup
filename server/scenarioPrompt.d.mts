/**
 * scenarioPrompt.mjs 의 타입.
 *
 * 알맹이를 평범한 `.mjs` 로 두는 이유는 coachPrompt 와 같다 — **한 파일이 세 군데에서
 * 돌아야** 한다 (Vite 개발 서버 · Cloudflare Pages Functions · vitest).
 *
 * 타입은 여기서 손으로 적고, tests/scenarioPrompt.test.ts 가 이 파일의 내용이
 * 게임 쪽 원본(STANDARD_PROGRAM · VIOLATIONS)과 어긋나지 않는지 확인한다.
 */

/** 신호 한 구간의 요약 — src/scenarios/scenarios.ts 의 SignalPhase 에서 필요한 것만 */
export interface PhaseBrief {
  name: string;
  vehicle: string;
  pedA: string;
  pedC: string;
  duration: number;
}

/** 신호 프로그램 요약. 순서와 길이가 STANDARD_PROGRAM 과 같아야 한다 */
export declare const PHASE_BRIEF: PhaseBrief[];

/** 위반 코드 → 사람 말. 키는 VIOLATIONS 와 같아야 한다 */
export declare const CODE_BRIEF: Record<string, string>;

/** 설계 지침 + 스키마 설명 + 신호 프로그램 — 매 요청 동일하다 */
export declare const SYSTEM_PROMPT: string;

/** 학습자의 약점 — 브라우저가 보내고 scenarioHandler 가 좁혀 준 모양 */
export interface ScenarioRequest {
  runs: number;
  byCode: { code: string; count: number }[];
  points: { label: string; kept: number; total: number; rate: number }[];
  /** 이미 만든 판 — 제목 뒤에 조건이 붙는다 (generate.ts 의 describeSpec) */
  recentTitles: string[];
  /** 이번 판에서 반드시 바꿀 축. 브라우저가 골라 보낸다 */
  mustVary?: string | null;
  /**
   * 난이도 — **금지 목록이 아니라 예산이다** (src/scenarios/difficulty.ts).
   *
   * 비용표까지 함께 온다. 표가 두 벌이 되면 언젠가 어긋나고, 어긋나면 모델은 우리가
   * 세지 않는 값으로 예산을 맞춘다 — 브라우저가 원본을 갖고 여기서는 **받은 것을
   * 문장으로 옮기기만** 한다.
   */
  difficulty?: {
    level: number;
    /** 조건에 쓸 수 있는 점수 */
    budget: number;
    /**
     * 조건 하나가 몇 점인지, 그리고 **어느 JSON 필드를 어떤 모양으로 건드리는지.**
     * `field` 가 없으면 모델이 필드를 지어낸다 (difficulty.ts 의 COST_TABLE 주석).
     */
    costs: { key: string; label: string; note: string; field?: string }[];
    /**
     * **값을 받지 않을 조건들** — 이 학습자의 약점이다.
     *
     * 예산이 0인 1레벨에서도 자기 약점은 만난다는 뜻이고, 그것이 예산제로 바꾼 이유다.
     */
    free: string[];
  } | null;
  /** 나쁜 운전 습관 — 맨 위가 이번 판이 시험할 것 (src/coach/badHabits.ts) */
  badHabits?: { code: string; count: number; cleanRuns: number; toClear: number }[];
  /** 직전 시도가 검증에서 버려진 이유 (재시도일 때만) */
  retryOf?: string[];
  /** 이번 판이 노릴 위반 코드 */
  target?: string | null;
  /**
   * 이번 판이 **어린이보호구역을 낼 차례인가** — 네 판에 한 판
   * (src/scenarios/scenarios.ts 의 `SCHOOL_ZONE_CHANCE`).
   *
   * `false` 면 프롬프트가 대놓고 넣지 말라고 이른다. `null`·`undefined` 는 커리큘럼
   * 밖의 요청이라 제한하지 않는다.
   */
  schoolZone?: boolean | null;
}

export declare function buildUserPrompt(req: ScenarioRequest): string;
