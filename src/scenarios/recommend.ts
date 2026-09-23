/**
 * **AI 코스 추천** — 시나리오 라이브러리(library.ts)에서 이 학습자에게 지금 필요한 판을 AI 가 고른다.
 *
 * ## 누가 무엇을 하는가
 *
 *  - **코드**: 이번 판에 **고를 수 있는 판**을 추린다 — 고칠 습관이 있으면 **그 습관을 시험하는 판만**,
 *    이 레벨까지 연 개념의 판(library.ts 의 levelOf), 보호구역·앞차 차례, 최근에 탄 판 빼기. 그중에서 서로 다른 **후보 코스 10개 안팎**을 뽑는다 (`shortlist`) —
 *    약점을 시험하는 것, 쉬운 것과 어려운 것, 신호·보행자·보호구역이 서로 다른 것이 섞이게.
 *  - **AI**(server/recommendPrompt.mjs): 습관 기록과 최근 주행을 읽고 **후보 중 하나를 고른다**.
 *    그리고 학습자에게 보여 줄 **추천 이유**와 **이번 판에서 볼 것**을 쓴다.
 *    나쁜 습관이 **여럿이면 먼저 고칠 습관도 AI 가 정한다** — 코드는 습관마다 후보를 따로 추려 두기만 한다
 *    (`coursesByHabit`). 예전에는 가장 많이 한 습관을 코드가 먼저로 정했는데, 사용자가 "분석 단계도 AI 가
 *    하게" 해 달라고 했다. 많이 한 순서만이 답이 아니다 — 최근에 이어 나오는지, 보행자 · 어린이가 걸린
 *    위험한 습관인지를 읽고 순서를 정하는 것은 판단이라 AI 에게 맞는다.
 *  - **코드**: 고른 번호가 후보에 있는지 확인한다. 학습자에게 나가는 것은 늘 검증을 통과한 판이다.
 *
 * 처음에는 AI 에게 **축마다 값을 고르게** 했다(신호 · 보행자 · 보호구역 …). 실제 모델로 돌려 보니
 * 약점이 "우회전 후 보행자" 인데 보행자 없는 조합을 고르거나, 라이브러리에 없는(법규상 성립하지
 * 않는) 조합을 골라 코드가 엉뚱한 판으로 바꿔야 했다. **구체적인 코스 몇 개 중에서 고르게** 하자
 * 약점과 맞는 판을 고르고, 이유도 그 코스를 두고 구체적으로 썼다.
 *
 * ## 서버가 없거나 AI 가 답하지 않으면
 *
 * 코드가 점수로 고른다 (`rulePick`) — 약점을 시험하는 판, 예산에 가까운(쉽지만은 않은) 판.
 * 추천 이유는 기록에서 만든 문장이 된다. 판이 없어서 멈추는 일은 없다.
 */

import type { BadHabit } from '../coach/badHabits';
import { habitTitle } from '../coach/badHabits';
import type { HabitSummary } from '../coach/habits';
import type { ViolationCode } from '../rules/violations';
import { MAX_LEVEL, levelLabel, levelTier, type Difficulty } from './curriculum';
import type { GeneratedScenario, Plan } from './generate';
import {
  ALWAYS_TESTED,
  L1_EXCLUDES,
  isCombinedLevel,
  isNoSignalZone,
  levelGuide,
  sideOf,
  zoneKindOf,
  libraryEntry,
  scenarioLibrary,
  type LibraryEntry,
} from './library';
import { inTrack } from './tracks';
import { zoneEntries } from './zoneCourse';
import { challengeRule } from './challenge';

/** AI 에게 보여 주는 후보 코스 수 */
const SHORTLIST_SIZE = 10;
/**
 * **먼저 고칠 습관을 AI 가 고르는 습관 수** — 많이 한 순서로 셋까지.
 * 습관마다 후보를 추리므로 셋이면 후보가 15개로, 서버가 한 번에 받는 양(recommendHandler.mjs 의 16) 안에 든다.
 */
const PRIORITY_HABITS = 3;
/** 습관이 여럿일 때 습관 하나에 담는 후보 수 — 둘이면 7개씩, 셋이면 5개씩 */
const perHabit = (n: number): number => (n <= 1 ? SHORTLIST_SIZE : n === 2 ? 7 : 5);
/** 후보 코스 중 한 축의 한 값(예: 우회전 후 무단횡단)이 차지할 수 있는 수 */
const PER_VALUE_MAX = 3;
/** 최근 이만큼 탄 판은 다시 고르지 않는다 */
const RECENT_EXCLUDE = 12;
/** AI 에게 보여 주는 최근 주행 수 */
const RECENT_SHOWN = 8;

/**
 * **최근에 나온 모양을 점수에서 깎는다** — 축마다 깎는 무게.
 *
 * ## 왜 필요한가
 *
 * 예전에는 "최근에 탄 **판 번호**" 만 피했다(`RECENT_EXCLUDE`). 그런데 6천 판 중에서 고르는데도 실제로
 * 만나는 장면은 늘 비슷했다 — 40판을 이어 달려 재 보니 **L4 에서 40판 중 26판의 두 번째 횡단보도가
 * 같은 유형(무단횡단하려는 사람)** 이었고, 첫 횡단보도는 31판이 '없음', 정면신호는 25판이 '우회전 녹색'
 * 이었다. 번호만 다를 뿐 **같은 판을 계속 탄 셈**이다 (사용자: "시나리오가 몇 천 개나 되는데 나오는 건
 * 고정된 느낌이야").
 *
 * 까닭은 점수(`scoreOf`)가 '이 레벨 · 조건이 많은 판' 을 좋게 치는데, 그 조건을 가장 잘 만족하는 모양이
 * 레벨마다 하나씩 있기 때문이다. 번호는 달라도 **모양이 같은 판**이 계속 1등을 한다.
 *
 * 그래서 최근에 나온 **축의 값**마다 점수를 깎는다. 두 번째 횡단보도를 가장 세게 깎는다 — 이 게임에서
 * 판단이 일어나는 자리이고, 사용자가 "항상 같은 사람만 나온다" 고 짚은 곳이다.
 */
const REPEAT_PENALTY = {
  c: 2.2,
  a: 1.4,
  signal: 1.4,
  /*
    **보호구역의 종류**도 센다 (library.ts 의 `zoneKindOf`). 넣기 전에는 신호 있는 보호구역이 연달아
    나와도 아무 감점이 없었다 — 사용자가 "신호있는 어린이보호구역 횡단보도가 많이 나왔어" 라고 짚은
    자리다. 보호구역이 아닌 차례에는 후보가 모두 `'none'` 이라 같은 감점을 받아 순위가 바뀌지 않는다.
  */
  zoneKind: 1.4,
  /** 보행자가 오는 쪽 — 태그에 없는 파생 축이라 판에서 읽는다 (사용자: "우측에만 사람이 있어") */
  sideC: 1.0,
  sideA: 0.8,
  lead: 0.8,
  kind: 0.6,
  env: 0.6,
} as const;

/** 되풀이 · 커버리지가 보는 축 하나의 값 — 태그의 축과 **파생 축**을 한 곳에서 읽는다 */
const axisValue = (e: LibraryEntry, axis: string): string =>
  axis === 'zoneKind'
    ? zoneKindOf(e.tags)
    : axis === 'sideA'
      ? sideOf(e.spec, 'A')
      : axis === 'sideC'
        ? sideOf(e.spec, 'C')
        : axis === 'sideS'
          ? sideOf(e.spec, 'S')
          : (e.tags as unknown as Record<string, string>)[axis];

/** 모양을 세는 구간 — 최근 이만큼의 판을 본다 (판 번호를 피하는 `RECENT_EXCLUDE` 와는 다른 자다) */
const REPEAT_WINDOW = 10;

/**
 * **'두 번째 횡단보도에 사람 없음' 은 두 배로 깎는다.**
 *
 * '없음' 도 하나의 모양이라 고르게 뽑히는데, 라이브러리에 그런 판이 많아 다양해진 대신 40판 중 18판에
 * 사람이 아예 없었다 — 다양해진 것이 아니라 심심해진 것이다. 대신 '사람 있는 판' 에 점수를 얹는 방법은
 * 쓰지 않았다: 그 보너스는 기록이 없는 첫 판에서도 걸려, **보호구역을 여는 레벨에서 보호구역 코스를 밀어냈다**
 * (tests/recommend.test.ts 가 잡았다). 되풀이를 깎는 것은 되풀이될 때만 걸리므로 다른 규칙을 건드리지 않는다.
 */
const NONE_EXTRA = (axis: string, e: LibraryEntry): number =>
  axis === 'c' && e.tags.c === 'none' ? 2 : 1;

/**
 * **신호기 없는 보호구역은 되풀이 감점을 절반만 받는다.**
 *
 * 신호 있음 · 없음의 비율은 이미 보호구역 차례가 정한다(scenarios.ts 의 `ZONE_NO_SIGNAL_CHANCE`). 여기서 또
 * 온전히 깎으면 두 번 거르는 셈인데, 보호구역 종류 셋 중 무신호가 가장 자주 나오니 늘 무신호만 깎였다. 보호구역
 * 판이 차례와 상관없이 섞이는 레벨(보호구역을 여는 L2 · 종합 L8~L10)에서 무신호 차례가 오면 보호구역이 아닌
 * 판에 밀려(L10: 신호 차례에 보호구역 93% · 무신호 차례에 57%), 무신호 비율이 51~56% 로 다른 레벨(58~68%)보다
 * 낮았다 — 사용자가 "각 레벨별로 어린이보호구역에 신호없는 횡단보도가 고르게 나오게" 해 달라고 했다.
 *
 * **0 이 아니라 절반이다.** 아예 빼 보니 반대로 L2 · L8~L10 이 71~76% 로 치솟고 종합 레벨의 보호구역 판이
 * 80~90% 가 되었다. 절반이면 레벨마다 58~67% 로 가장 고르다 (레벨마다 1,000판 모의 주행). 신호 있는 두 종류끼리의
 * 되풀이는 그대로 깎는다.
 */
const CORE_REPEAT = (axis: string, e: LibraryEntry): number =>
  axis === 'zoneKind' && zoneKindOf(e.tags) === 'noSignal' ? 0.5 : 1;

/** 최근에 나온 축 값의 수 — `axis=value` → 몇 번 (아래 `scoreOf` 가 깎는 근거) */
export type SeenShapes = ReadonlyMap<string, number>;

/** 빈 집계 — 최근 기록이 없을 때(첫 판)와 테스트에서 쓴다 */
const NO_SHAPES: SeenShapes = new Map();

/**
 * 최근에 탄 판의 모양을 센다. **가까운 판일수록 무겁게** — 바로 앞 판과 다른 것이 가장 중요하다.
 */
export function seenShapes(recentIds: readonly number[]): SeenShapes {
  const out = new Map<string, number>();
  const window = recentIds.slice(-REPEAT_WINDOW);
  window.forEach((id, i) => {
    const e = libraryEntry(id);
    if (!e) return;
    // 가장 최근 판이 1.0, 열 판 전이 0.1 — 오래된 것은 슬슬 잊는다
    const weight = (i + 1) / window.length;
    for (const axis of Object.keys(REPEAT_PENALTY)) {
      const key = `${axis}=${axisValue(e, axis)}`;
      out.set(key, (out.get(key) ?? 0) + weight);
    }
  });
  return out;
}
/**
 * **이 레벨에서 무엇을 겪어 봤는가** — 저장된 판 번호(save.ts 의 `RunRecord.st`)로 되찾는다.
 *
 * `seenShapes` 와 **자가 다르다.** 그쪽은 최근 10판을 감쇠 가중치로 보아 "바로 앞 판과 다르게" 를 묻고,
 * 이쪽은 이 레벨에서 탄 판 전부를 보아 **"이 레벨에서 처음 보는가"** 를 묻는다. 되풀이 감점만 있으면
 * "열한 판 전에 한 번 겪은 값" 과 "한 번도 안 겪은 값" 이 똑같이 0 점이라, 사용자가 말한
 * **"나쁜 운전습관이 없다하더라도 레벨에 맞는 다양한 상황을 사용자가 경험을 해야 해"** 를 할 수 없다.
 *
 * **저장 스키마는 한 글자도 바꾸지 않는다** — 기록에 남는 것은 판 번호뿐이지만, 번호가 12축을 자리마다
 * 적은 값이라(library.ts 의 `libraryId`) `libraryEntry` 로 모양을 통째로 되찾을 수 있다.
 */
export type Coverage = ReadonlyMap<string, number>;

/**
 * **겪음을 세는 축** — 되풀이 감점(`REPEAT_PENALTY`)보다 넓다.
 *
 * `shapeOf`(후보 중복 제거용 8축)가 보지 않는 `kind·env·pressure·jam` 과, 태그에 아예 없는 파생 축
 * (보호구역 종류 · 보행자가 오는 쪽)을 함께 센다. 사용자가 "우측에만 사람이 있다" 고 짚은 것이 정확히
 * 태그에 없는 값이라, 축으로 세지 않으면 추천이 그것을 고칠 방법이 없다.
 */
const COVER_AXES = [
  'signal',
  'a',
  'c',
  'zoneKind',
  'lead',
  'kind',
  'env',
  'pressure',
  'jam',
  'sideA',
  'sideC',
  'sideS',
] as const;

/**
 * **아직 안 겪어 본 축 값을 좋게 치는 무게.**
 *
 * ## 왜 이 보너스는 첫 판을 망치지 않는가
 *
 * 예전에 "사람 있는 판에 +점" 을 주었다가 **기록이 없는 첫 판에서도 걸려 보호구역을 여는 레벨에서
 * 보호구역 코스를 밀어냈다** (tests/recommend.test.ts 가 잡았다). 이 보너스는 그 함정에 빠지지 않는다 —
 * **축마다 하나씩** 걸리고 모든 판은 모든 축에 값이 하나씩 있으므로(사람이 없으면 `'none'` 이 그 값이다),
 * 기록이 없으면 **모든 후보가 똑같이 합계를 받아 순위가 조금도 바뀌지 않는다.**
 *
 * 그래서 위반 코드(targets) 커버리지는 여기 넣지 않는다 — 판마다 개수가 달라 첫 판의 순위를 바꾼다.
 * 그 일은 약점 겨냥(+6)과 AI 프롬프트의 메타가 이미 한다.
 */
const NEW_BONUS: Record<(typeof COVER_AXES)[number], number> = {
  c: 1.6,
  zoneKind: 1.2,
  a: 1.0,
  signal: 1.0,
  lead: 0.8,
  sideC: 0.8,
  sideA: 0.6,
  sideS: 0.5,
  kind: 0.4,
  env: 0.4,
  pressure: 0.3,
  jam: 0.3,
};

/** 겪은 횟수 → '새것' 값. 계단으로 둔다 — 한 번 겪은 것과 안 겪은 것의 차가 커야 한다 */
const novelty = (n: number): number => (n === 0 ? 1 : n < 1.5 ? 0.35 : 0);

/**
 * **고칠 습관이 있으면 새것을 덜 좋게 친다.** 습관이 남아 있는 동안은 레벨이 오르지 않으므로
 * (curriculum.ts) 그 습관을 고치는 것이 먼저다. 습관이 없을 때가 "레벨의 여러 상황을 고루" 의 자리다.
 */
const NOVELTY_GAIN = { withHabit: 0.6, clean: 1.4 } as const;

/** 빈 집계 — 첫 판과 테스트에서 쓴다 */
const NO_COVER: Coverage = new Map();

/**
 * 실제로 **탄** 판에서 이 레벨의 경험을 센다.
 *
 * `seenShapes` 와 달리 **추천만 되고 아직 안 탄 판은 넣지 않는다** — 되풀이를 피하는 데는 그것도 세는
 * 것이 맞지만(main.ts 의 `recentIds` 에는 섞여 있다), 커버리지는 "겪은 것" 이라 그러면 거짓이 된다.
 */
export function coverageOf(playedIds: readonly number[], level: Difficulty): Coverage {
  const out = new Map<string, number>();
  for (const id of playedIds) {
    const e = libraryEntry(id);
    if (!e) continue;
    // 이 레벨의 판은 1, 이웃 레벨은 0.5 — 아래 · 위에서 겪은 것도 경험이지만 지금 레벨의 경험만 못하다
    const w = e.level === level ? 1 : Math.abs(e.level - level) === 1 ? 0.5 : 0;
    if (!w) continue;
    for (const axis of COVER_AXES) {
      const k = `${axis}=${axisValue(e, axis)}`;
      out.set(k, (out.get(k) ?? 0) + w);
    }
  }
  return out;
}

/**
 * 후보마다 **이 학습자에게 처음인 축**을 적는다 — AI 프롬프트의 `새:` 가 이것을 쓴다.
 *
 * **모든 후보에 똑같이 붙는 축은 뺀다.** 기록이 적을 때는 거의 모든 축이 처음이라, 그대로 적으면 열 줄이
 * 같은 말을 달고 나와 고르는 데 아무 도움이 안 되면서 토큰만 먹는다. 남는 것은 **후보끼리 갈리는 축**이라,
 * 모델이 "이 코스에만 새로운 것" 을 곧바로 읽는다. 무게가 큰 축부터 적는다 (위 NEW_BONUS).
 */
export function freshAxesFor(courses: readonly LibraryEntry[], cover: Coverage): string[][] {
  const isNew = (e: LibraryEntry, axis: string): boolean =>
    (cover.get(`${axis}=${axisValue(e, axis)}`) ?? 0) === 0;
  const useful = COVER_AXES.filter((axis) => {
    const n = courses.filter((e) => isNew(e, axis)).length;
    return n > 0 && n < courses.length;
  });
  const byWeight = [...useful].sort((x, y) => NEW_BONUS[y] - NEW_BONUS[x]);
  return courses.map((e) => byWeight.filter((axis) => isNew(e, axis)));
}

/** 한 번 요청의 상한 — 넘기면 코드가 고른다 */
export const TIMEOUT_MS = 15_000;

/** 지난 주행 한 판 — AI 가 "무엇을 탔고 어떻게 됐는지" 를 본다 */
export interface RecentRun {
  title: string;
  grade: string;
  violations: string[];
}

export interface RecommendOutcome {
  scenario: GeneratedScenario;
  /** 누가 골랐는가 — `ai` 면 AI 가, `rule` 이면 서버가 없거나 답이 없어 코드가 골랐다 */
  source: 'ai' | 'rule';
  /**
   * **고른 쪽의 이름** — 화면이 그대로 말한다 ("Gemini 가 골라 줬습니다!").
   *
   * 사용자가 정했다: "Gemini가 골라줬습니다!!! Groq가 골라줬습니다!!! 이런 식으로 나오면 더 재미있을 것 같아."
   * 무료 AI 여러 곳을 돌아가며 쓰므로(server/llm.mjs) 판마다 고른 쪽이 다르다 — 그 사실이 화면에 보이면
   * '여러 AI 가 번갈아 봐 준다' 는 것이 저절로 드러난다.
   *
   * AI 가 못 고른 판은 **AI 이름을 쓰지 않는다** — 코드가 고른 판을 AI 가 골랐다고 말하면 그건 거짓말이다.
   */
  picker: Picker;
  /**
   * **고른 모델의 이름** — 'gemini-3.1-flash-lite' 처럼 그대로 적는다 (사용자 요청: "세부 모델명도 적어 줘").
   * 모델은 환경변수로 갈아 끼울 수 있으므로(server/llm.mjs) 코드가 아는 목록이 아니라 **서버가 말해 준 것**이다.
   * 코드가 고른 판에는 없다.
   */
  model?: string;
  /**
   * **이번 판에서 고칠 습관** — 습관이 없으면 `null`.
   *
   * 습관이 둘 이상이면 AI 가 정한 것이고(`habitBy: 'ai'`), 하나뿐이거나 AI 가 답하지 않았으면 가장 많이 한
   * 습관이다(`'rule'`). 결과 카드가 "먼저 고칠 습관 (AI 판단)" 이라고 적는 근거라, 코드가 정한 것을 AI 가
   * 정했다고 말하지 않게 둘을 나눠 둔다.
   */
  habit: ViolationCode | null;
  habitBy: 'ai' | 'rule';
}

/**
 * 고른 쪽 — AI 제공자들, **한도 초과**(`quota`), 코드(`rule`), 마스터 운행의 무작위(`random`).
 *
 * `quota` 와 `rule` 은 **둘 다 코드가 고른 판**이지만 까닭이 다르다. 화면이 다른 말을 해야 해서 나눈다 —
 * 한도를 다 쓴 것(429)은 "오늘 치를 다 썼다" 이고, 서버·키가 없는 배포는 처음부터 AI 가 없는 것이다.
 * 없는 것을 "다 썼다" 고 말하면 거짓말이 된다.
 */
export type Picker =
  | 'gemini'
  | 'groq'
  | 'cerebras'
  | 'openrouter'
  | 'nvidia'
  | 'openai'
  | 'quota'
  | 'rule'
  | 'random';

/** 화면에 적는 이름 */
export const PICKER_LABEL: Record<Picker, string> = {
  gemini: 'Gemini',
  groq: 'Groq',
  cerebras: 'Cerebras',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  quota: 'AI',
  rule: '우회전 규칙',
  random: '무작위 뽑기',
};

/** 화면에 적는 모델 이름의 최대 길이 */
const MODEL_NAME_MAX = 40;

/** 서버가 보낸 이름을 아는 값으로 좁힌다 — 모르는 이름이면 그냥 'AI' 로 뭉뚱그리지 않고 코드 취급한다 */
const asPicker = (v: unknown): Picker =>
  v === 'gemini' || v === 'groq' || v === 'cerebras' || v === 'openrouter' || v === 'nvidia' || v === 'openai'
    ? v
    : 'rule';

/**
 * **신호기 없는 보호구역이 열리는 레벨** — 라이브러리가 정한다 (library.ts 의 `levelGuide`).
 * 한 번 세고 기억한다 — 판 8,958개를 훑는 계산이라 판마다 다시 하지 않는다.
 */
let noSignalLevel: Difficulty | null = null;
function noSignalZoneLevel(): Difficulty {
  if (noSignalLevel === null) {
    noSignalLevel = (([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).find((l) =>
      levelGuide(l).includes('noSignalZone'),
    ) ?? 10) as Difficulty;
  }
  return noSignalLevel;
}

/**
 * **신호기 없는 보호구역을 이만큼 연달아 못 만났으면 이번 판은 반드시 그 판이다.**
 *
 * 사용자가 "10판 넘게 했는데 어린이보호구역 신호없는 횡단보도가 한번도 나오지 않았어" 라고 짚었다. 보호구역 차례는
 * 네 판에 한 판(확률)이라 여러 판 동안 안 나올 수 있는데, 더 큰 까닭은 **고칠 습관**이었다 — 습관이 남아 있으면 그
 * 습관을 시험하는 판만 후보에 오르고 레벨도 오르지 않는다. L1 의 무신호 판 셋은 모두 정면 녹색이라 "정면 적색에서
 * 안 섬" 같은 습관이 있는 사람에게는 **한 번도** 나오지 않았다(모의 주행 12판 × 40명, 0%). 이 게임의 핵심이
 * 제27조 제7항 — 신호기 없는 보호구역 횡단보도는 사람이 없어도 선다 — 이라, 확률에만 맡기지 않고 바닥을 둔다.
 */
export const NO_SIGNAL_ZONE_GAP = 3;

/** 실제로 탄 판 번호들 → 이번 판이 무신호 보호구역 차례인가 (최근 `NO_SIGNAL_ZONE_GAP` 판에 하나도 없었는가) */
export function noSignalZoneDue(playedIds: readonly number[]): boolean {
  if (playedIds.length < NO_SIGNAL_ZONE_GAP) return false;
  return !playedIds.slice(-NO_SIGNAL_ZONE_GAP).some((id) => {
    const e = libraryEntry(id);
    return !!e && isNoSignalZone(e.tags);
  });
}

// ── 1. 후보 추리기 ────────────────────────────────────────────────────────────

/**
 * 이번 판에 **고를 수 있는 판**.
 *
 * 조건을 하나씩 풀어 가며 찾는다 — 최근 판 빼기 → 앞차 차례 → 보호구역 차례 → 예산 순서로.
 * 뒤로 갈수록 이 게임이 지키려는 것이 크다(예산은 레벨 그 자체다). 라이브러리가 1,200판이라
 * 실제로 끝까지 풀리는 일은 없지만, 비었다고 판을 못 내는 일도 없게 한다.
 */
export function candidatesFor(plan: Plan, recentIds: readonly number[]): LibraryEntry[] {
  /*
    **L1 학습자에게는 야간 판을 주지 않는다** (library.ts 의 L1_EXCLUDES). L1 판에는 야간이 없지만, 난이도 4 · 5 는 한두
    레벨 위의 판을 미리 섞고(reach) 아래 단계들은 레벨을 넘어서라도 습관을 시험하는 판을 찾으므로 여기서 한 번 더 거른다.
  */
  /*
    **고른 갈래의 판만 본다** (scenarios/tracks.ts) — 우회전 전용을 고르면 보호구역이 섞인 판은 후보에
    들지 않는다. 맨 처음에 거르는 이유는, 아래 티어가 하나라도 걸리면 그대로 돌려주기 때문이다 —
    나중에 거르면 "이 티어에는 있었는데 갈래에 맞는 것이 하나도 없는" 빈손이 나온다.

    **레벨은 그대로 쓴다.** 갈래마다 레벨을 다시 매기지 않는다 (사용자가 레벨 · 경험치를 하나로 쓰기로 했다).
    다만 우회전 전용은 레벨마다 판 수가 고르지 않다 — L4 는 1판뿐이다(L1 149 · L2 104 · L3 17 · L4 1 ·
    L5 133 …). 그래도 `fits` 가 **그 레벨 이하**를 모두 받으므로 L4 에서도 271판 중에서 고른다.
  */
  const track = plan.track ?? 'both';
  /*
    **보호구역 전용 갈래는 다른 판 묶음에서 고른다** (scenarios/zoneCourse.ts) — 우회전 없이 보호구역을
    직진으로 통과하는 362판이다. 기존 라이브러리에는 그런 판이 하나도 없으므로 거르는 것이 아니라 **갈아 끼운다.**
  */
  const all =
    track === 'zone' ? zoneEntries() : scenarioLibrary().filter((e) => inTrack(e.tags, track));
  const lib = plan.level === 1 ? all.filter((e) => !L1_EXCLUDES(e.tags)) : all;
  const recent = new Set(recentIds.slice(-RECENT_EXCLUDE));

  // 이 레벨까지 연 개념만 쓰는 판 (library.ts 의 levelOf). 난이도 5 는 한 레벨 위까지 미리 섞는다
  const reach = challengeRule(plan.challenge).reach;
  const fits = (e: LibraryEntry) => e.level <= plan.level + reach;
  // 보호구역 차례면 교차로 보호구역이든 진입로 보호구역이든 하나는 있어야 하고, 아니면 둘 다 없어야 한다
  const inZone = (e: LibraryEntry) => e.tags.zone === 'yes' || e.tags.approach !== 'none';
  /*
    **새 개념을 여는 레벨에서는 그 레벨의 판에 차례를 걸지 않는다.** 보호구역(1/4) · 앞차(1/3) 차례는
    "늘 한 번 더 선다" 를 막으려는 비율인데, 보호구역을 여는 레벨에서 그 비율을 걸면 네 판 중 세 판이
    지난 레벨의 판이 되어 **레벨이 올라도 새 것을 못 만났다** (보호구역 · 앞차를 여는 레벨, 종합 레벨).
    그 레벨의 판(새 개념)만 풀고, 복습하는 아래 레벨의 판에는 비율을 그대로 건다.
  */
  // 이 레벨에서 무엇을 여는지는 라이브러리가 안다 (library.ts 의 levelGuide) — 종합 레벨은 둘 다 연 것으로 본다
  const opens = levelGuide(plan.level);
  const combined = isCombinedLevel(plan.level);
  const opensZone = combined || opens.includes('zone') || opens.includes('noSignalZone');
  const opensLead = combined || opens.includes('lead') || opens.includes('rolling');
  /*
    **한 갈래만 고른 사람에게는 보호구역 차례를 걸지 않는다.** 우회전 전용에는 보호구역 판이 없고,
    보호구역 전용에는 보호구역 아닌 판이 없다 — 어느 쪽이든 차례를 걸면 후보가 통째로 비거나 그대로다.
  */
  const zoneOk = (e: LibraryEntry) =>
    track !== 'both' || (opensZone && e.level === plan.level) || inZone(e) === plan.schoolZone;
  const leadOk = (e: LibraryEntry) =>
    (opensLead && e.level === plan.level) || (plan.lead ? e.tags.lead === plan.lead : e.tags.lead === 'none');
  const fresh = (e: LibraryEntry) => !recent.has(e.spec.id);
  /*
    **보호구역 차례 안에서 신호기 유무도 차례로 돌린다** (scenarios.ts 의 `ZONE_NO_SIGNAL_CHANCE`).

    보호구역 차례를 `inZone` 불리언 하나로만 보았더니 신호 있는 보호구역이 자주 나왔다 — 진입로
    보호구역만 해도 신호 1,632 · 무신호 1,632 로 반반이라, 차례가 와도 절반은 핵심이 아닌 판이었다
    (사용자가 짚었다). 이 게임의 핵심은 제27조 제7항, **신호기 없는 보호구역 횡단보도**다.

    **개념이 열린 뒤부터만 건다.** 무신호 보호구역은 보호구역과 함께 L2 에서 열리므로(library.ts 의
    conceptStage) L1 에는 걸지 않는다 — L1 에는 보호구역 판이 몇 개뿐이라 걸면 1·2 티어가 늘 빈다.
  */
  const opensNoSignalZone = combined || plan.level >= noSignalZoneLevel();
  /*
    **보호구역 차례가 아닐 때 들어온 보호구역 판에도 건다.** 새 개념을 여는 레벨과 종합 레벨에서는
    `zoneOk` 가 "이 레벨의 판이면 통과" 로 빠져나가므로(위), 차례와 무관하게 보호구역 판이 섞인다 —
    거기에 신호기 차례를 안 걸었더니 무신호 비율이 41% 에 머물렀다. 보호구역이 아닌 판은 이 차례와
    아무 상관이 없으므로 그냥 통과시킨다.
  */
  const zoneSigOk = (e: LibraryEntry) =>
    plan.zoneNoSignal === undefined || !opensNoSignalZone || zoneKindOf(e.tags) === 'none'
      ? true
      : isNoSignalZone(e.tags) === plan.zoneNoSignal;

  /*
    **고칠 습관이 있으면 그 습관을 시험하는 판만 후보에 올린다.** 습관이 남아 있는 동안은 레벨이
    오르지 않으므로(curriculum.ts), 그 습관을 만날 수 없는 판을 고르면 아무것도 나아가지 않는다.
    AI 가 약점과 무관한 판을 고를 여지를 없애고, 그 안에서 상황 · 난이도만 고르게 한다.

    차례(보호구역 · 앞차)와 부딪히면 **차례를 먼저 푼다** — 예컨대 "우회전 신호등 적색" 습관인데
    일시정지 건너뜀 앞차 차례면(그 앞차는 정면 적색에만 있다) 그 습관을 시험할 판이 없다.
    그럴 때는 앞차를, 그래도 없으면 보호구역 차례를 풀어서라도 습관을 시험한다.
  */
  const target = plan.target as ViolationCode | null;
  const tests = (e: LibraryEntry) =>
    !target || ALWAYS_TESTED.includes(target) || e.targets.includes(target);

  /*
    **무신호 보호구역 차례면 그 판만 고른다** (위 `noSignalZoneDue`). 습관을 함께 시험하는 판이 먼저이고, 이 레벨에
    없으면 무신호 보호구역이 열리는 레벨(L2)까지 올라가 찾는다 — L1 의 무신호 판은 모두 정면 녹색이라, 정면 적색
    습관이 있는 L1 학습자에게는 L2 의 적색 무신호 판(습관과 보호구역을 한 판에서 함께 시험)이 맞다. 그래도 습관을
    시험하는 무신호 판이 없으면 습관과 무관한 무신호 판이라도 준다 — 몇 판에 한 번뿐이고, 사용자가 이 판을 원했다.
  */
  /*
    **우회전 전용 갈래에서는 무신호 보호구역 차례를 걸지 않는다** — 그 갈래에는 보호구역 판이 하나도 없어
    여기서 걸면 후보가 빈손이 되고, 아래 티어로도 내려가지 못한다. 보호구역은 다른 두 갈래가 맡는다.
  */
  if (plan.noSignalZoneDue && track !== 'turn') {
    const upTo = Math.max(plan.level + reach, noSignalZoneLevel());
    const core = (e: LibraryEntry) => isNoSignalZone(e.tags) && e.level <= upTo;
    for (const ok of [
      (e: LibraryEntry) => core(e) && tests(e) && fresh(e),
      (e: LibraryEntry) => core(e) && tests(e),
      (e: LibraryEntry) => core(e) && fresh(e),
      core,
    ]) {
      const out = lib.filter(ok);
      if (out.length) return out;
    }
  }

  const tiers: ((e: LibraryEntry) => boolean)[] = [
    (e) => fits(e) && tests(e) && zoneOk(e) && zoneSigOk(e) && leadOk(e) && fresh(e),
    (e) => fits(e) && tests(e) && zoneOk(e) && zoneSigOk(e) && leadOk(e),
    // 3티어부터는 신호기 차례를 푼다 — 습관을 시험하는 것이 그보다 크다
    (e) => fits(e) && tests(e) && zoneOk(e) && leadOk(e) && fresh(e),
    (e) => fits(e) && tests(e) && zoneOk(e) && fresh(e),
    (e) => fits(e) && tests(e) && fresh(e),
    (e) => fits(e) && tests(e),
    /*
      이 레벨에는 그 습관을 시험할 판이 없다 — 위 레벨에서 생긴 습관을 안고 내려온 경우다.
      그 습관을 고치는 것이 먼저라, 레벨을 넘어서라도 시험하는 판을 준다 (점수가 가장 낮은 레벨을 고른다).
    */
    (e) => tests(e) && zoneOk(e) && fresh(e),
    (e) => tests(e),
    (e) => fits(e) && zoneOk(e) && leadOk(e) && fresh(e),
    (e) => fits(e) && zoneOk(e),
    (e) => fits(e),
  ];
  for (const ok of tiers) {
    const out = lib.filter(ok);
    if (out.length) return out;
  }
  // 이 레벨에 쓸 판이 하나도 없다 — L1 판을 준다 (L1 에는 늘 판이 있어 실제로 오지 않는다)
  return lib.filter((e) => e.level === 1);
}

/** 코스의 **모양** — 서로 다른 후보를 뽑을 때 같은 모양은 하나만 둔다 (보행자 종류·재촉·환경·정체는 보지 않는다) */
const shapeOf = (e: LibraryEntry): string =>
  [e.tags.signal, e.tags.zone, e.tags.sigA, e.tags.sigC, e.tags.approach, e.tags.a, e.tags.c, e.tags.lead].join('/');

/**
 * AI 에게 보여 줄 **후보 코스** — 서로 모양이 다른 것으로 `SHORTLIST_SIZE` 개 안팎.
 *
 * 점수(`scoreOf`) 순으로 모양마다 하나씩 담되, **약점을 시험하는 코스가 절반쯤** 되게 하고
 * 나머지는 다른 모양으로 채운다. 전부 약점 코스면 AI 가 고를 것이 없고(다 비슷하다),
 * 전부 점수 순이면 비슷한 어려운 판만 모인다. 가장 쉬운 코스도 하나 넣는다 — 연달아
 * 틀린 사람에게 쉬운 판을 고를 수 있어야 한다.
 */
export function shortlist(
  plan: Plan,
  candidates: readonly LibraryEntry[],
  random: () => number = Math.random,
  seen: SeenShapes = NO_SHAPES,
  cover: Coverage = NO_COVER,
  /** 담을 수 — 습관이 여럿일 때는 습관마다 조금씩 담는다 (`coursesByHabit`) */
  size: number = SHORTLIST_SIZE,
): LibraryEntry[] {
  const scored = candidates
    .map((e) => ({ e, s: scoreOf(plan, e, seen, cover) + random() * 1.5 }))
    .sort((x, y) => y.s - x.s);
  const out: LibraryEntry[] = [];
  const shapes = new Set<string>();
  /*
    **한 축의 한 값이 후보를 독차지하지 않게 한다.** 모양만 다르게 하자 실제 모델에 보낸
    10개 중 9개가 "우회전 중 뛰어드는 보행자" 였다 — 점수가 예산에 가까운 판을 좋게 쳐서
    비싼 값 하나로 몰린 것이다. 그러면 AI 가 골라도 늘 같은 종류가 나온다.
  */
  const used = new Map<string, number>();
  const key = (axis: string, v: string) => `${axis}=${v}`;
  const crowded = (e: LibraryEntry) =>
    (used.get(key('c', e.tags.c)) ?? 0) >= PER_VALUE_MAX ||
    (used.get(key('a', e.tags.a)) ?? 0) >= PER_VALUE_MAX + 1 ||
    (used.get(key('signal', e.tags.signal)) ?? 0) >= PER_VALUE_MAX + 1;
  /*
    `force` 면 독차지 제한과 **모양 중복**도 푼다 — 낮은 레벨은 모양이 몇 가지 없어(L1 은 넷) 모양마다
    하나씩만 담으면 후보가 너무 적다. 그때는 같은 모양이라도 보행자 종류 · 날씨 · 재촉이 다른 판으로 채운다.
  */
  const taken = new Set<number>();
  const take = (e: LibraryEntry, force = false) => {
    if (out.length >= size || taken.has(e.spec.id)) return;
    if (!force && (shapes.has(shapeOf(e)) || crowded(e))) return;
    taken.add(e.spec.id);
    shapes.add(shapeOf(e));
    for (const [axis, v] of [['c', e.tags.c], ['a', e.tags.a], ['signal', e.tags.signal]] as const) {
      used.set(key(axis, v), (used.get(key(axis, v)) ?? 0) + 1);
    }
    out.push(e);
  };
  const target = plan.target as ViolationCode | null;
  if (target) for (const { e } of scored) if (e.targets.includes(target) && out.length < size / 2) take(e);
  const easiest = [...candidates].sort((x, y) => x.level - y.level || x.cost - y.cost)[0];
  if (easiest) take(easiest, true);
  for (const { e } of scored) take(e);
  // 후보가 적은 판(앞차 차례 등)에서는 독차지 제한 때문에 모자랄 수 있다 — 그때는 풀어서 채운다
  for (const { e } of scored) take(e, true);
  return out;
}

/** 습관 하나를 고치는 후보 묶음 — `habit` 이 `null` 이면 고칠 습관이 없는 판 */
export interface HabitCourses {
  habit: ViolationCode | null;
  courses: LibraryEntry[];
}

/** AI 가 먼저 고칠 것을 고르는 습관들 — 많이 한 순서로 `PRIORITY_HABITS` 개까지, 같은 코드는 한 번 */
export function priorityHabits(plan: Plan): ViolationCode[] {
  const out: ViolationCode[] = [];
  for (const h of plan.badHabits) if (!out.includes(h.code)) out.push(h.code);
  return out.slice(0, PRIORITY_HABITS);
}

/** 이 코스가 그 습관을 시험하는가 — 늘 시험되는 위반(방향지시등 · 서행 · 대회전)은 어느 코스에서나 참 */
export const coursesTest = (e: LibraryEntry, habit: ViolationCode): boolean =>
  ALWAYS_TESTED.includes(habit) || e.targets.includes(habit);

/**
 * **습관마다 후보를 따로 추린다** — 먼저 고칠 습관은 AI 가 정한다.
 *
 * 습관이 하나 이하면 예전과 같다 — 가장 많이 한 습관(`plan.target`)의 후보 하나 묶음. 둘 이상이면 습관마다
 * `candidatesFor` · `shortlist` 를 따로 돌려 묶음을 만든다. 어느 묶음이든 그 습관을 시험하는 판뿐이라,
 * AI 가 어느 습관을 먼저로 정해도 "습관이 있으면 그 습관을 고치는 코스만" 이라는 약속이 지켜진다.
 * 두 습관을 함께 시험하는 판은 앞 묶음에만 담는다 — 같은 번호가 두 번 나가면 AI 가 헷갈린다.
 *
 * @returns 묶음들과, 분석 화면에 적을 **추린 판의 수**(묶음들의 후보를 합친 것)
 */
export function coursesByHabit(
  plan: Plan,
  recentIds: readonly number[],
  random: () => number = Math.random,
  seen: SeenShapes = NO_SHAPES,
  cover: Coverage = NO_COVER,
): { groups: HabitCourses[]; candidates: number } {
  const habits = priorityHabits(plan);
  if (habits.length < 2) {
    const candidates = candidatesFor(plan, recentIds);
    return {
      groups: [{ habit: (plan.target as ViolationCode | null) ?? null, courses: shortlist(plan, candidates, random, seen, cover) }],
      candidates: candidates.length,
    };
  }
  const size = perHabit(habits.length);
  const pooled = new Set<number>();
  const taken = new Set<number>();
  const groups: HabitCourses[] = [];
  for (const habit of habits) {
    const p = { ...plan, target: habit };
    const candidates = candidatesFor(p, recentIds);
    for (const e of candidates) pooled.add(e.spec.id);
    const courses = shortlist(p, candidates, random, seen, cover, size).filter((e) => !taken.has(e.spec.id));
    for (const e of courses) taken.add(e.spec.id);
    if (courses.length) groups.push({ habit, courses });
  }
  return { groups, candidates: pooled.size };
}

// ── 3. 코드가 고르기 (AI 가 없을 때) ─────────────────────────────────────────

/**
 * 코스 점수 — 약점을 시험하는가, 다른 습관도 걸리는가, **이 레벨에서 새로 연 개념인가**.
 *
 * 이 레벨의 판(새 개념)을 가장 좋게 친다 — 레벨이 올랐는데 지난 레벨의 판만 나오면 오른 것이 없다.
 * 아래 레벨의 판은 복습이라 조금 낮게, 위 레벨의 판(습관 때문에 넘어온 것)은 많이 낮게 친다.
 */
function scoreOf(
  plan: Plan,
  e: LibraryEntry,
  seen: SeenShapes = NO_SHAPES,
  cover: Coverage = NO_COVER,
): number {
  const habits = new Set(plan.badHabits.map((h) => h.code));
  let s = 0;
  // 최근에 나온 모양은 깎는다 (위 REPEAT_PENALTY) — 번호만 다른 같은 장면을 막는다
  for (const axis of Object.keys(REPEAT_PENALTY) as (keyof typeof REPEAT_PENALTY)[]) {
    s -= (seen.get(`${axis}=${axisValue(e, axis)}`) ?? 0) * REPEAT_PENALTY[axis] * NONE_EXTRA(axis, e) * CORE_REPEAT(axis, e);
  }
  if (plan.target && e.targets.includes(plan.target as ViolationCode)) s += 6;
  for (const t of e.targets) if (habits.has(t)) s += 1;
  const rule = challengeRule(plan.challenge);
  if (e.level === plan.level) s += 3;
  else if (e.level < plan.level) s -= (plan.level - e.level) * 0.6;
  // 위 레벨 — 난이도 4 · 5 가 미리 섞는 것은 조금만 낮게, 그 밖(습관 때문에 넘어온 것)은 많이 낮게
  else s -= (e.level - plan.level) * (e.level - plan.level <= rule.reach ? 0.5 : 2);
  /*
    **같은 레벨이면 판단할 것이 많은 판을 좋게 친다** (조건 점수 — difficulty.ts 의 costOf). 얼마나 좋게
    칠지는 **난이도 설정**이 정한다 (challenge.ts — 1 은 중간 정도를, 올라갈수록 더 복잡한 판을).
    예전에는 같은 레벨 안에서 고르게 뽑혀, "녹색 · 보행자 없음" 같은 판이 자주 나와 너무 쉽다는 말을 들었다.
    보행자도 조건도 없는 판은 몸풀기로만 가끔 나온다.
  */
  s +=
    rule.target !== undefined
      ? -Math.abs(Math.min(e.cost, rule.cap) - rule.target) * 0.3
      : Math.min(e.cost, rule.cap) * rule.complexity;
  if (rule.skipEmpty && e.tags.a === 'none' && e.tags.c === 'none' && e.cost === 0) s -= 2;
  /*
    **보행자를 판단하는 판을 어느 난이도에서나 좋게 친다** — 이 게임의 판단은 거의 보행자 앞에서 일어난다.
    쉬움은 "보행자가 없다" 가 아니라 "보행자 말고 겹친 조건이 적다" 여야 한다. 이 점수가 없을 때 쉬움 · 조금 쉬움은
    보행자 없는 판을 자주 골랐다.
  */
  if (e.tags.a !== 'none' || e.tags.c !== 'none') s += 2;
  /*
    **이 레벨에서 아직 안 겪어 본 것을 좋게 친다** (위 NEW_BONUS).

    되풀이 감점은 최근 10판만 보므로 "열한 판 전에 겪은 값" 을 다시 안 주는 데 그친다 — **한 번도 안
    겪은 값을 찾아 주지는 못한다.** 그 일을 여기서 한다. 고칠 습관이 있으면 덜 세게 친다 (NOVELTY_GAIN).
  */
  const gain = plan.badHabits.length || plan.target ? NOVELTY_GAIN.withHabit : NOVELTY_GAIN.clean;
  for (const axis of COVER_AXES) {
    s += NEW_BONUS[axis] * novelty(cover.get(`${axis}=${axisValue(e, axis)}`) ?? 0) * gain;
  }
  return s;
}

/** AI 를 쓸 수 없을 때 코드가 고른다 — 점수가 가장 높은 판. 동점은 `random` 으로 가른다 */
export function rulePick(
  plan: Plan,
  candidates: readonly LibraryEntry[],
  random: () => number = Math.random,
  seen: SeenShapes = NO_SHAPES,
  cover: Coverage = NO_COVER,
): LibraryEntry {
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const e of candidates) {
    const s = scoreOf(plan, e, seen, cover) + random() * 1.5;
    if (s > bestScore) {
      best = e;
      bestScore = s;
    }
  }
  return best;
}

/** 코드가 골랐을 때의 추천 이유 — 기록에서 만든다 */
function ruleWhy(plan: Plan, e: LibraryEntry): string {
  const top = plan.badHabits[0];
  if (top && e.targets.includes(top.code)) {
    return `'${habitTitle(top.code)}' 을(를) ${top.count}번 했습니다. 그 상황을 다시 연습하는 코스입니다.`;
  }
  return `L${plan.level} ${levelTier(plan.level)} 단계에 맞춘 코스입니다.`;
}

// ── 4. 서버에 묻기 ───────────────────────────────────────────────────────────

interface AiReply {
  id: number;
  why: string;
  focus: string;
  /** AI 가 정한 **먼저 고칠 습관** — 습관이 여럿일 때만 온다. 받는 쪽이 한 번 더 확인한다 */
  habit?: string;
  /** 어느 제공자가 골랐는가 (server/recommendHandler.mjs) */
  picker: Picker;
  /** 그 제공자의 어느 모델인가 */
  model?: string;
}

async function askAi(payload: unknown): Promise<AiReply | 'no-server' | 'quota' | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });
    // 서버가 없는 배포(정적 호스팅) · 키가 없는 개발 환경
    if (res.status === 404 || res.status === 405 || res.status === 503) return 'no-server';
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[recommend]', res.status, body);
      /*
        **한도를 다 쓴 것인지 가린다.** 서버는 마지막으로 두드린 곳의 상태를 함께 보낸다
        (server/llm.mjs · 429 = 한도). 화면이 "일일 사용량이 초과됐어요" 라고 말하려면 이 구분이 있어야 한다 —
        다른 까닭(못 닿음 · 형식 오류)에까지 그렇게 적으면 거짓말이다.
      */
      try {
        if ((JSON.parse(body) as { status?: unknown }).status === 429) return 'quota';
      } catch {
        /* 본문이 JSON 이 아니면 그냥 실패로 본다 */
      }
      return null;
    }
    const body = (await res.json()) as {
      id?: unknown;
      why?: unknown;
      focus?: unknown;
      habit?: unknown;
      picker?: unknown;
      model?: unknown;
    };
    if (typeof body.id !== 'number') return null;
    return {
      id: body.id,
      why: typeof body.why === 'string' ? body.why.trim() : '',
      focus: typeof body.focus === 'string' ? body.focus.trim() : '',
      habit: typeof body.habit === 'string' ? body.habit : undefined,
      picker: asPicker(body.picker),
      // 화면에 그대로 적히는 값이라 길이를 자른다 — 서버가 준 것이지만 화면을 밀어내게 두지는 않는다
      model: typeof body.model === 'string' ? body.model.trim().slice(0, MODEL_NAME_MAX) : undefined,
    };
  } catch (e) {
    console.warn('[recommend]', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 서버에 보내는 것 — 집계는 이미 끝난 값만 간다 (세는 일은 코드가 한다, habits.ts) */
export function recommendPayload(
  plan: Plan,
  habits: HabitSummary,
  recent: readonly RecentRun[],
  courses: readonly LibraryEntry[],
  /** 이 레벨에서 겪은 것 — 후보마다 '아직 안 겪은 축' 을 적는 데 쓴다 (위 coverageOf) */
  cover: Coverage = NO_COVER,
  /** 후보가 어느 습관의 묶음인가 (위 coursesByHabit) — 둘 이상이면 먼저 고칠 습관을 AI 가 정한다 */
  habitOf: ReadonlyMap<number, ViolationCode> = new Map(),
) {
  const fresh = freshAxesFor(courses, cover);
  const priority = new Set(habitOf.values()).size >= 2;
  return {
    level: plan.level,
    tier: levelTier(plan.level),
    challenge: challengeRule(plan.challenge).id,
    // 경험치가 얼마나 찼는가 — 추천 이유가 "얼마 남았는지" 를 틀리지 않게 (curriculum.ts 의 XP_TO_NEXT)
    xp: plan.xp ?? 0,
    xpNeed: plan.xpNeed ?? 0,
    cleanStreak: plan.cleanStreak ?? 0,
    missStreak: plan.missStreak ?? 0,
    target: plan.target,
    badHabits: plan.badHabits.slice(0, 6).map((h: BadHabit) => ({
      code: h.code,
      count: h.count,
      cleanRuns: h.cleanRuns,
    })),
    runs: habits.runs,
    points: habits.points.map((p) => ({ label: p.label, kept: p.kept, total: p.total })),
    trend: habits.trend,
    recent: recent.slice(-RECENT_SHOWN).map((r) => ({
      title: r.title,
      grade: r.grade,
      violations: r.violations.slice(0, 6),
    })),
    turn: { schoolZone: plan.schoolZone, lead: plan.lead },
    // **먼저 고칠 습관을 AI 가 정하는 판인가** — 습관마다 후보를 따로 추렸을 때만
    priority,
    /*
      **후보마다 구조화된 메타를 함께 보낸다.** 예전에는 제목 · 시험 · 레벨 셋뿐이라, 모델이 코스에 대해
      아는 모든 것이 한국어 제목 문자열 안에 압축돼 있었다 — 그래서 시스템 프롬프트가 40줄 중 17줄을
      "제목 읽는 법" 사전에 썼다. 제목에도 태그에도 없는 값(보행자가 오는 쪽)은 아예 알 길이 없었다.

      `fresh` 는 **이 학습자가 이 레벨에서 아직 안 겪은 축**이다 — 사용자의 "나쁜 습관이 없어도 레벨에
      맞는 다양한 상황을 경험해야 한다" 가 모델에게 닿는 유일한 통로다. 축 이름(키)만 보내고 한국어는
      서버가 붙인다 (server/recommendPrompt.mjs) — 모델에게 가는 글은 우리가 쓴 것만이어야 한다.
    */
    courses: courses.map((e, i) => ({
      id: e.spec.id,
      title: e.spec.title,
      tests: e.targets,
      level: e.level,
      cost: e.cost,
      zoneKind: zoneKindOf(e.tags),
      sideA: sideOf(e.spec, 'A'),
      sideC: sideOf(e.spec, 'C'),
      fresh: fresh[i].slice(0, 3),
      ...(priority && habitOf.has(e.spec.id) ? { habit: habitOf.get(e.spec.id) } : {}),
    })),
  };
}

// ── 전체 ────────────────────────────────────────────────────────────────────

/**
 * 다음 판을 추천받는다. **늘 판을 돌려준다** — AI 가 안 되면 코드가 고른다.
 *
 * @param recentIds 최근에 탄 판 id (오래된 것부터). 다시 고르지 않는다
 */
export async function recommendScenario(
  plan: Plan,
  habits: HabitSummary,
  recent: readonly RecentRun[],
  recentIds: readonly number[],
  /** 후보를 추린 직후 부른다 — 분석 연출(ui/AiPick.ts)이 실제 숫자를 보여 주려고 */
  onCandidates?: (n: { candidates: number; courses: number }) => void,
  /**
   * **실제로 탄** 판 번호 (save.ts 의 history). 경험 커버리지는 이것만 센다 — `recentIds` 에는
   * 추천만 되고 아직 안 탄 판이 섞여 있어(main.ts), 그것을 "겪었다" 로 세면 거짓이 된다.
   */
  playedIds: readonly number[] = recentIds,
): Promise<RecommendOutcome> {
  // 최근에 나온 모양을 깎아 **번호만 다른 같은 장면**이 이어지지 않게 한다 (위 REPEAT_PENALTY)
  const seen = seenShapes(recentIds);
  // 이 레벨에서 **실제로 탄** 판만 세어, 아직 안 겪은 상황을 좋게 친다 (위 coverageOf)
  const cover = coverageOf(playedIds, plan.level);
  // 습관이 여럿이면 습관마다 후보를 따로 추린다 — 먼저 고칠 습관은 AI 가 정한다 (위 coursesByHabit)
  const byHabit = coursesByHabit(plan, recentIds, Math.random, seen, cover);
  const courses = byHabit.groups.flatMap((g) => g.courses);
  const habitOf = new Map<number, ViolationCode>();
  for (const g of byHabit.groups) if (g.habit) for (const e of g.courses) habitOf.set(e.spec.id, g.habit);
  const priority = byHabit.groups.length >= 2;
  onCandidates?.({ candidates: byHabit.candidates, courses: courses.length });
  const reply = await askAi(recommendPayload(plan, habits, recent, courses, cover, priority ? habitOf : undefined));

  // **고른 번호가 후보에 있을 때만** 받는다 — 모델이 지어낸 번호는 버리고 코드가 고른다
  const answer = reply && reply !== 'no-server' && reply !== 'quota' ? reply : null;
  const chosen = answer ? courses.find((e) => e.spec.id === answer.id) : undefined;
  if (chosen && answer) {
    /*
      **AI 가 정한 습관은 두 가지를 확인한 뒤에만 받는다** — 학습자에게 실제로 있는 습관인가, 고른 코스가 그
      습관을 시험하는가. 어긋나면 고른 코스가 들어 있던 묶음의 습관으로 본다 (그 코스는 그 습관을 고치려고
      추린 것이다). 습관이 하나 이하인 판은 AI 가 정한 것이 아니므로 그렇게 말하지 않는다.
    */
    const told = answer.habit as ViolationCode | undefined;
    const aiHabit =
      priority && told && priorityHabits(plan).includes(told) && coursesTest(chosen, told) ? told : undefined;
    const habit = aiHabit ?? habitOf.get(chosen.spec.id) ?? (plan.target as ViolationCode | null) ?? null;
    return {
      scenario: toScenario(
        chosen,
        plan.level,
        answer.why || ruleWhy(plan, chosen),
        answer.focus,
        'ai',
        answer.picker,
        answer.model,
      ),
      source: 'ai',
      picker: answer.picker,
      model: answer.model,
      habit,
      habitBy: aiHabit ? 'ai' : 'rule',
    };
  }
  const entry = rulePick(plan, courses.length ? courses : candidatesFor(plan, recentIds), Math.random, seen, cover);
  // 한도를 다 써서 코드가 고른 판은 그렇게 말한다 (위 Picker 주석)
  const why: Picker = reply === 'quota' ? 'quota' : 'rule';
  return {
    scenario: toScenario(entry, plan.level, ruleWhy(plan, entry), '', 'rule', why),
    source: 'rule',
    picker: why,
    // AI 가 답하지 않았다 — 코드가 고른 코스의 묶음 습관 (rulePick 은 가장 많이 한 습관의 코스를 좋게 친다)
    habit: habitOf.get(entry.spec.id) ?? (plan.target as ViolationCode | null) ?? null,
    habitBy: 'rule',
  };
}

/**
 * **마스터 운행** — L10 코스를 무작위로 하나 고른다.
 *
 * 사용자가 "10 단계를 끝내면 마스터 단계가 되고, 처음부터 다시 시작을 누르기 전까지는 랜덤으로 10 단계의 문제들이
 * 계속 돌아가게 해 줘" 라고 했다. 마스터에게는 고칠 습관도 오를 레벨도 없으므로 AI 에게 고르게 하지 않고, L10 코스
 * 전체에서 **고르게 무작위로** 뽑는다(최근에 탄 판은 뺀다 — 같은 판이 곧바로 다시 나오지 않게).
 */
export function masterPick(recentIds: readonly number[], random: () => number = Math.random): RecommendOutcome {
  const pool = scenarioLibrary().filter((e) => e.level === MAX_LEVEL);
  const recent = new Set(recentIds.slice(-RECENT_EXCLUDE));
  const fresh = pool.filter((e) => !recent.has(e.spec.id));
  const from = fresh.length ? fresh : pool;
  const entry = from[Math.min(from.length - 1, Math.floor(random() * from.length))];
  const why = `안전운전 마스터 — ${levelLabel(MAX_LEVEL)} 코스 ${pool.length.toLocaleString()}개 중에서 무작위로 골랐습니다.`;
  return {
    scenario: toScenario(entry, MAX_LEVEL, why, '처음부터 다시 시작하기 전까지 마스터 운행이 이어집니다', 'rule', 'random'),
    source: 'rule',
    picker: 'random',
    habit: null,
    habitBy: 'rule',
  };
}

function toScenario(
  e: LibraryEntry,
  level: Difficulty,
  why: string,
  focus: string,
  source: 'ai' | 'rule',
  picker: Picker,
  model?: string,
): GeneratedScenario {
  return {
    ...structuredClone(e.spec),
    why,
    generated: true,
    level,
    recommended: source,
    // 고른 쪽을 판에 싣는다 — '다시 운행' 으로 같은 판을 태울 때도 카드가 같은 말을 해야 한다
    picker,
    ...(model ? { pickerModel: model } : {}),
    ...(focus ? { focus } : {}),
  };
}

