/**
 * AI 시나리오 생성 — **받아서 바로 쓰지 않는다.**
 *
 * ```
 *   서버(LLM) ──▶ 검증기 ──▶ 통과? ──▶ 플레이
 *                    │          │
 *                    └── 실패 ──┴──▶ 다시 요청 (최대 MAX_TRIES 회)
 * ```
 *
 * ## 왜 검증을 브라우저에서 하는가
 *
 * 판정 엔진(rules/lawRules.ts)과 보행자 상태기계(game/pedWalk.ts)가 여기 있기 때문이다.
 * 서버로 옮겨 오면 게임과 두 벌이 되고, **두 벌이 되는 순간 검증은 거짓말을 시작한다** —
 * "통과 가능합니다" 라고 한 판이 실제로는 불가능해도 아무도 모른다.
 *
 * 검증이 여기 있으면 검증에 쓰는 코드와 실제로 플레이되는 코드가 **글자 그대로 같다.**
 *
 * ## 없으면 없는 대로 굴러간다
 *
 * 서버가 없는 배포(정적 호스팅 · 단일 파일)에서는 `/api/scenario` 가 아예 없다.
 * 그때는 `null` 이고, 화면은 AI 판 버튼을 감춘다 — 손으로 쓴 11개는 그대로 돌아간다.
 */

import {
  GENERATED_ID_BASE,
  fitRightArrowStart,
  fitStraightLeadWait,
  leadPlanOf,
  leadSpecFor,
  type LeadPlan,
  type ScenarioSpec,
} from './scenarios';
import {
  checkDifficulty,
  clampToLevel,
  describesRemoved,
  ruleFor,
  type Difficulty,
  type LevelRule,
} from './curriculum';
import type { ViolationCode } from '../rules/violations';
import { COST_TABLE, freeKitFor, type ConditionKey } from './difficulty';
import { checkSchema, describeIssues, validateScenario, type Issue } from './validate';
import { runsToClear, type BadHabit } from '../coach/badHabits';
import type { HabitSummary } from '../coach/habits';

/**
 * 몇 번까지 다시 물어보는가.
 *
 * **재시도가 공짜가 아니다.** 한 번이 2~5초라 세 번이면 사용자가 15초를 기다린다.
 * 3회에서 끊고 없는 것으로 치는 편이, 오래 기다리게 하고 결국 실패하는 것보다 낫다.
 */
const MAX_TRIES = 3;

/** 한 번 요청의 상한 — 코치(12초)보다 길게 잡는다. 생성이 더 무겁다 */
export const TIMEOUT_MS = 20_000;

/**
 * AI 가 만든 판. `ScenarioSpec` 에 **왜 이걸 만들었는지**가 붙는다.
 *
 * `why` 를 화면에 그대로 보여 주는 것이 이 기능의 절반이다 — "AI 가 만들었습니다" 보다
 * "당신이 여기서 세 번 무너져서 만들었습니다" 가 학습자를 움직인다.
 */
export interface GeneratedScenario extends ScenarioSpec {
  /** 학습자에게 그대로 보여지는 한 줄 */
  why: string;
  /** AI 가 만든 판임을 화면이 알아보는 표시 */
  generated: true;
  /** 몇 단계로 만든 판인가 (커리큘럼 밖에서 만들었으면 null) */
  level: Difficulty | null;
  /**
   * 시나리오 라이브러리에서 **추천받은** 판이면 누가 골랐는가 (recommend.ts).
   * `ai` — AI 가 습관을 보고 골랐다 · `rule` — AI 를 쓸 수 없어 코드가 골랐다.
   * 없으면 모델이 새로 만든 판이다.
   */
  recommended?: 'ai' | 'rule';
  /**
   * **누가 골랐는가** — 'gemini' · 'groq' · 'openai' · 'rule' · 'random' (scenarios/recommend.ts 의 Picker).
   * 준비 화면이 "Gemini 가 골라 줬습니다!" 라고 적는다 — 판을 다시 태울 때도 같은 말을 해야 해서 판에 싣는다.
   */
  picker?: string;
  /** 그 제공자의 **모델 이름** — 'gemini-3.1-flash-lite' (준비 화면이 그대로 적는다) */
  pickerModel?: string;
  /** AI 가 짚어 준 **이번 판에서 볼 것** 한 줄 (추천받은 판만) */
  focus?: string;
}

/** 생성 과정에서 무슨 일이 있었는지 — 개발 중 확인과 화면의 안내에 쓴다 */
export interface GenerateOutcome {
  scenario: GeneratedScenario | null;
  /** 몇 번 만에 됐는가 (실패면 시도 횟수) */
  tries: number;
  /** 검증에서 걸러진 것들 — 왜 버렸는지 */
  rejected: { try: number; issues: Issue[] }[];
  reason: 'ok' | 'no-server' | 'invalid' | 'timeout';
}

/** 이번 접속에서 몇 번째 AI 판인가 — id 는 `GENERATED_ID_BASE` 부터 하나씩 올라간다 */
let generatedCount = 0;
// 라이브러리(1000번대)와 겹치지 않게 900판마다 되감는다 — 한 접속에서 그만큼 만들 일은 없다
const nextId = (): number => GENERATED_ID_BASE + (generatedCount++ % 900);

/**
 * 이번 판에서 **반드시 바꿀 것** — 다양성을 부탁하지 않고 지정한다.
 *
 * ## 부탁으로는 안 됐다
 *
 * 프롬프트에 "앞서 만든 판과 조건이 최소 두 가지는 달라야 합니다" 를 넣고 조건까지 적어
 * 넘겼는데도, 다섯 판을 뽑으면 다섯 판 모두 **신호 4구간 · 보행자 1명 · 보호구역 없음**
 * 이었다. 제목만 달랐다.
 *
 * 모델은 학습자의 가장 큰 약점(보행자 방해) 하나에 붙들려 같은 상황을 되풀이한다.
 * 그것 자체는 잘못이 아니다 — 시킨 일을 한 것이다. 다만 **같은 상황을 다섯 번 하는 것은
 * 다섯 판이 아니다.**
 *
 * 그래서 무엇을 바꿀지를 우리가 고른다. 이건 창작이 아니라 **덮이지 않은 축을 세는 일**이라
 * 결정론적으로 하는 편이 낫고, 그래야 판이 늘어날수록 골고루 덮인다.
 */
interface Axis {
  key: string;
  /** 최근 판들이 이 축을 아직 안 덮었는가 */
  missing: (recent: ScenarioSpec[]) => boolean;
  /**
   * 이 축을 켜는 데 드는 조건들 (difficulty.ts 의 비용표).
   *
   * **예산에 안 들어오면 시키지 않는다.** 시켜 봐야 `trimToBudget` 이 도로 깎고,
   * 제목에 그 말이 남으면 `describesRemoved` 가 반려해 2~5초짜리 재시도만 는다.
   * 비어 있으면 공짜 축이다 (녹색 시작은 아무 값도 안 든다).
   */
  needs: ConditionKey[];
  /**
   * 이 축이 정면으로 시험하는 위반.
   *
   * 학습자의 가장 굳은 습관이 여기 걸리면 그 축을 먼저 고른다 — 다양성을 채우는 김에
   * **이 사람에게 필요한 다양성**부터 채운다.
   */
  codes: ViolationCode[];
  /** 앞차 축이면 어떤 앞차를 시키는 축인가 — 이번 판의 앞차와 다르면 뽑지 않는다 */
  lead?: LeadPlan;
  /**
   * 이 축과 **함께 설 수 없는** 조건. 이번 판에 그 조건이 반드시 켜져야 하면 이 축은 뽑지 않는다.
   *
   * 우회전 신호등은 녹색 화살표가 켜지는 0~2 구간에서 시작해야 하는데, 정지선 위반을 시험하는
   * 판(공짜 묶음의 `redStart`)이나 직진 대기·일시정지 건너뜀 앞차는 **정면 적색**에서 시작해야
   * 뜻이 있다. 둘을 함께 시켰더니 모델은 둘 다 지키려다 "우회전까지 47초를 기다리는 판" 을
   * 만들었고, 세 번 모두 버려져 판을 하나도 못 만들었다.
   */
  conflicts?: ConditionKey[];
  ask: string;
}

const AXES: Axis[] = [
  {
    key: 'green',
    missing: (r) => !r.some((s) => s.startPhase <= 2),
    needs: [],
    conflicts: ['redStart'],
    codes: ['NO_SLOW_DOWN', 'PEDESTRIAN_BLOCKED'],
    ask: '이번에는 **정면 차량신호가 녹색인 구간(startPhase 0~2)** 에서 시작하십시오. 적색과는 판단이 전혀 다른 판이 됩니다.',
  },
  {
    key: 'red',
    missing: (r) => !r.some((s) => s.startPhase >= 3),
    needs: ['redStart'],
    codes: ['RED_NO_STOP', 'OVER_STOP_LINE'],
    ask: '이번에는 **정면 차량신호가 적색·황색인 구간(startPhase 3~7)** 에서 시작하십시오.',
  },
  {
    key: 'schoolZone',
    missing: (r) => !r.some((s) => s.isSchoolZone),
    needs: ['schoolZone', 'missingPedSignal'],
    codes: ['SCHOOL_ZONE_NO_STOP'],
    ask: '이번에는 **어린이보호구역(isSchoolZone: true)** 으로 만드십시오. 신호기 없는 횡단보도(pedSignalInstalled.C: false)를 함께 쓰면 제27조 제7항을 시험할 수 있습니다.',
  },
  {
    key: 'crowd',
    missing: (r) => !r.some((s) => s.pedestrians.length >= 2),
    needs: ['crowd'],
    codes: ['PEDESTRIAN_BLOCKED'],
    ask: '이번에는 **보행자를 2명 이상** 두고, `startWithin` 을 서로 달리 줘서(예: 24 · 16) 차례로 나서게 하십시오.',
  },
  {
    key: 'exitBlocked',
    missing: (r) => !r.some((s) => s.exitBlocked),
    needs: ['exitBlocked'],
    codes: ['BLOCKING_INTERSECTION'],
    ask: '이번에는 **진출로가 막힌 상황(exitBlocked: true)** 으로 만들어 꼬리물기를 시험하십시오.',
  },
  {
    key: 'rightArrow',
    missing: (r) => !r.some((s) => s.rightArrowInstalled),
    needs: ['rightArrow'],
    conflicts: ['redStart'],
    codes: ['RIGHT_ARROW_RED'],
    ask: '이번에는 **우회전 신호등이 설치된 교차로(rightArrowInstalled: true)** 로 만드십시오.',
  },
  {
    /*
      **오는 길의 보호구역.** 교차로 조건만 돌리면 판이 늘 "교차로에서 무엇을 하는가"
      하나만 묻는다. 이 축은 교차로에 닿기도 전에 한 번 더 서게 만든다.
    */
    key: 'approachZone',
    missing: (r) => !r.some((s) => s.approachSchoolZone !== undefined),
    needs: ['approachZone'],
    codes: ['SCHOOL_ZONE_RED', 'SCHOOL_ZONE_NO_STOP'],
    ask:
      '이번에는 **교차로에 닿기 전에 지나는 어린이보호구역**을 넣으십시오 ' +
      '(`"approachSchoolZone": { "signal": false }`). 신호기를 두지 않으면 보행자가 없어도 ' +
      '일시정지해야 하는 자리가 되어, 제27조 제7항을 정면으로 시험할 수 있습니다.',
  },
  {
    /*
      **앞차가 일시정지를 건너뛰는 판.** 적색 일시정지를 "아는" 사람도 앞차가 그냥 가면
      따라간다 — 규정을 모르는 것과 **남을 따라 하는 것**은 다른 약점이고, 이 축만이 뒤엣것을
      시험한다. 정지선 위반이 굳은 사람에게 가장 먼저 준다.
    */
    key: 'leadRolling',
    missing: (r) => !r.some((s) => s.leadCar?.behavior === 'rolling'),
    needs: ['redStart', 'leadCar'],
    lead: 'rolling',
    codes: ['RED_NO_STOP', 'SCHOOL_ZONE_NO_STOP'],
    ask:
      '이번에는 **앞차가 일시정지 없이 우회전해 나가는 판**으로 만드십시오 ' +
      '(`"leadCar": { "behavior": "rolling", "headway": 1.6 }` · 정면 적색 구간). ' +
      '앞차가 가도 학습자는 정지선에서 서야 합니다 — "앞차를 따라간다" 를 시험합니다.',
  },
  {
    /*
      **앞차가 직진 대기하는 판.** 우회전 차로가 따로 없는 교차로에서 우회전을 막는 가장
      현실적인 상황이다 — 적색에 우회전이 허용되는 나도 앞차가 직진 대기 중이면 기다려야 한다.
      그 차를 피해 옆으로 돌아 나가면 대회전이다.
    */
    key: 'leadStraight',
    missing: (r) => !r.some((s) => s.leadCar?.path === 'straight'),
    needs: ['redStart', 'leadCar'],
    lead: 'straight',
    codes: ['WIDE_TURN', 'BLOCKING_INTERSECTION'],
    ask:
      '이번에는 **앞차가 직진 대기하는 판**으로 만드십시오 ' +
      '(`"leadCar": { "behavior": "lawful", "path": "straight" }` · 정면 적색 구간). ' +
      '직진 앞차는 녹색이 될 때까지 정지선에서 기다리므로, 학습자는 우회전이 허용되는 적색인데도 ' +
      '그 뒤에서 기다려야 합니다.',
  },
  {
    /*
      **앞차가 규정대로 서는 판.** 보행자가 있는 C 앞에서 앞차가 서면 학습자는 그 뒤에 붙어
      사람이 **보이지 않는** 채로 판단해야 한다. 보행자 방해가 굳은 사람에게 준다.
    */
    key: 'leadLawful',
    missing: (r) => !r.some((s) => s.leadCar?.path !== 'straight' && s.leadCar?.behavior === 'lawful'),
    needs: ['leadCar'],
    lead: 'lawful',
    codes: ['PEDESTRIAN_BLOCKED'],
    ask:
      '이번에는 **규정대로 서는 앞차**를 두십시오 (`"leadCar": { "behavior": "lawful" }`). ' +
      '우회전 후 횡단보도에 보행자를 두면 앞차가 그 앞에서 서고, 학습자는 앞차에 가려 ' +
      '보행자가 보이지 않는 채로 판단하게 됩니다.',
  },
  {
    key: 'lowVisibility',
    missing: (r) => !r.some((s) => s.timeOfDay !== 'day' || s.weather !== 'clear'),
    needs: ['lowVisibility'],
    /* 시야가 나쁜 것은 특정 위반이 아니라 모든 판단을 늦춘다 — 짝지을 코드가 없다 */
    codes: [],
    ask: '이번에는 **밤이거나 비 오는 날**(timeOfDay: "night" 또는 weather: "rain")로 만드십시오. 보이는 거리가 줄어 판단이 어려워집니다.',
  },
];

/**
 * 이번에 반드시 바꿀 축 하나. 다 나왔거나 예산에 안 들어오면 지정하지 않는다 —
 * 그때부터는 모델이 조합을 섞게 두는 편이 낫다.
 *
 * ## 고르는 순서
 *
 *  1. 아직 안 나온 축 중에서
 *  2. **예산에 들어오는 것**만 남기고 (안 들어오면 트리머가 도로 깎는다)
 *  3. 그중 **이 학습자의 가장 굳은 습관**을 시험하는 축이 있으면 그것을
 *  4. 없으면 배열 순서대로
 *
 * 3번이 이 함수를 결정론적 순환에서 벗어나게 한다. 예전에는 누가 하든 green → red →
 * schoolZone … 같은 순서로 돌았고, 그래서 "다양성" 이 모두에게 똑같은 모양이었다.
 *
 * **약점 묶음(`free`)은 값이 0이라 언제나 들어온다.** 예산이 0인 1레벨에서도 자기
 * 약점 축은 시킬 수 있다는 뜻이고, 그것이 예산제로 바꾼 이유다.
 */
export function pickVariation(
  recent: ScenarioSpec[],
  opts: {
    level?: LevelRule | null;
    habits?: readonly BadHabit[];
    free?: readonly ConditionKey[];
    /** 이번 판이 보호구역을 낼 차례인가. `false` 면 보호구역 축을 뽑지 않는다 */
    schoolZone?: boolean;
    /**
     * 이번 판의 앞차 종류. `null` 이면 앞차 축을 뽑지 않고, 종류가 정해져 있으면
     * **그 종류의 축만** 뽑는다 — 다양성을 채우자고 이번 판에 없을 앞차를 시킬 수는 없다.
     * `undefined` 는 커리큘럼 밖의 요청이라 제한하지 않는다.
     */
    lead?: LeadPlan | null;
  } = {},
): string | null {
  if (!recent.length) return null;

  const budget = opts.level?.budget ?? Infinity;
  const free = opts.free ?? [];
  /*
    축 하나를 켜는 값 — 공짜 묶음에 든 조건은 세지 않는다. 어림값이다(정확한 값은
    보행자 수와 거리에 따라 달라진다). 여기서 필요한 것은 "이 축을 시켜 볼 만한가"
    뿐이라, 대충 맞으면 된다 — 정확한 계산은 받아 온 뒤 costOf 가 한다.
  */
  const roughCost = (a: Axis): number =>
    a.needs.filter((k) => !free.includes(k)).reduce((n, k) => n + ROUGH_COST[k], 0);

  /*
    이번 판에 **반드시 켜야 하는** 조건 — 약점 묶음과, 적색에서만 뜻이 있는 앞차.
    여기 든 조건과 함께 설 수 없는 축은 뽑지 않는다 (Axis.conflicts).
  */
  const required = new Set<ConditionKey>(free);
  if (opts.lead === 'straight' || opts.lead === 'rolling') required.add('redStart');

  const open = AXES.filter(
    (a) =>
      a.missing(recent) &&
      !(a.conflicts ?? []).some((k) => required.has(k)) &&
      roughCost(a) <= budget &&
      // 보호구역 차례가 아니면 그 축은 아예 후보에서 뺀다 (Plan.schoolZone)
      (opts.schoolZone !== false || !a.needs.some((k) => SCHOOL_ZONE_KEYS.includes(k))) &&
      // 앞차도 마찬가지다 — 이번 판에 나올 앞차와 다른 축은 뽑지 않는다 (Plan.lead)
      (opts.lead === undefined || a.lead === undefined || a.lead === opts.lead),
  );
  if (!open.length) return null;

  const top = opts.habits?.length ? opts.habits[0].code : null;
  const matched = top ? open.find((a) => a.codes.includes(top)) : undefined;
  return (matched ?? open[0]).ask;
}

/** 축 하나가 대략 몇 점인가 — 위 `roughCost` 전용의 어림표 */
const ROUGH_COST: Record<ConditionKey, number> = {
  redStart: 1,
  crowd: 1,
  traffic: 1,
  missingPedSignal: 2,
  schoolZone: 2,
  lowVisibility: 2,
  exitBlocked: 2,
  rightArrow: 2,
  jaywalker: 3,
  chance: 3,
  lateStart: 2,
  approachZone: 3,
  leadCar: 2,
};

/**
 * 앞서 만든 판을 **조건까지 붙여** 한 줄로 적는다.
 *
 * 제목만 넘기면 모델이 제목만 바꾼다 — 실제로 그랬다. 무엇이 이미 나왔는지
 * **조건 수준에서** 알려 줘야 판단의 근거가 된다.
 */
export function describeSpec(s: ScenarioSpec): string {
  const bits = [
    `신호${s.startPhase}구간`,
    `보행자${s.pedestrians.length}명`,
    s.isSchoolZone ? '보호구역' : null,
    s.exitBlocked ? '꼬리물기' : null,
    s.rightArrowInstalled ? '우회전신호등' : null,
    s.pedSignalInstalled.C ? null : 'C신호기없음',
    s.approachSchoolZone
      ? `진입부보호구역${s.approachSchoolZone.signal ? '(신호기有)' : '(신호기無)'}`
      : null,
    s.leadCar
      ? `앞차(${
          s.leadCar.path === 'straight'
            ? '직진 대기'
            : s.leadCar.behavior === 'rolling'
              ? '일시정지 건너뜀'
              : '규정대로 우회전'
        })`
      : null,
    s.timeOfDay !== 'day' ? s.timeOfDay : null,
    s.weather !== 'clear' ? s.weather : null,
  ].filter(Boolean);
  return `${s.title} (${bits.join('·')})`;
}

/**
 * 약점 요약을 서버가 받을 모양으로 줄인다.
 *
 * **집계는 이미 끝나 있다** (coach/habits.ts). 서버는 세지 않고 읽기만 한다 —
 * 브라우저가 가진 것을 서버에서 다시 계산할 이유가 없고, 기록 전체를 넘기면
 * 넘기지 않아도 될 것까지 넘어간다.
 */
function toRequest(
  habits: HabitSummary,
  recent: ScenarioSpec[],
  plan?: Plan,
  retryOf: string[] = [],
): unknown {
  return {
    runs: habits.runs,
    byCode: habits.byCode.slice(0, 5),
    points: habits.points.map((p) => ({
      label: p.label,
      kept: p.kept,
      total: p.total,
      rate: p.rate,
    })),
    recentTitles: recent.map(describeSpec),
    mustVary: pickVariation(recent, {
      level: plan ? ruleFor(plan.level) : null,
      habits: plan?.badHabits,
      free: freeOf(plan),
      schoolZone: plan?.schoolZone,
      lead: plan ? plan.lead : undefined,
    }),
    /*
      **이번 판에 보호구역을 내도 되는가.** 서버는 이 한 값을 문장으로 옮기기만 한다
      (집계·비용표와 같은 원칙 — 판단은 브라우저가 한다).
    */
    schoolZone: plan ? plan.schoolZone : null,
    /* 이번 판의 앞차 — `null` 이면 앞차를 넣지 말라는 뜻이다 (Plan.lead) */
    lead: plan ? plan.lead : null,
    /*
      **난이도는 예산으로 넘긴다.**

      비용표까지 함께 실어 보내는 이유는 하나다 — 표가 두 벌이 되면 언젠가 어긋나고,
      어긋나면 모델은 우리가 세지 않는 값으로 예산을 맞춘다. 브라우저가 원본을 갖고
      서버는 **받은 것을 문장으로 옮기기만** 한다 (집계를 넘기는 것과 같은 원칙).
    */
    difficulty: plan
      ? {
          level: plan.level,
          budget: ruleFor(plan.level).budget,
          costs: COST_TABLE,
          /* 값을 받지 않을 조건 — 이 학습자의 약점이다 */
          free: freeOf(plan),
        }
      : null,
    target: plan?.target ?? null,
    badHabits: (plan?.badHabits ?? []).map((h) => ({
      code: h.code,
      count: h.count,
      cleanRuns: h.cleanRuns,
      toClear: runsToClear(h),
    })),
    retryOf,
  };
}

/** 이번 판을 어떤 단계로, 무엇을 노려 만들 것인가 (커리큘럼이 정한다) */
export interface Plan {
  level: Difficulty;
  /** 가장 많이 저지른 위반 코드 — 없으면 `null` */
  target: string | null;
  /** 나쁜 운전 습관 전부 — 프롬프트가 이것을 근거로 판을 만든다 */
  badHabits: readonly BadHabit[];
  /**
   * 이번 판이 **어린이보호구역을 낼 차례인가** (scenarios.ts 의 `rollSchoolZoneTurn`).
   *
   * 차례가 아니면 보호구역 조건은 공짜 묶음에서도 빠지고, 바꿀 축으로도 뽑히지 않고,
   * 프롬프트가 대놓고 넣지 말라고 이른다. 세 곳을 다 막는 이유는 **하나만 열려 있어도
   * 늘 나오기** 때문이다 — 예전에 늘 나온 것이 그중 첫 번째(공짜 묶음) 하나였다.
   */
  schoolZone: boolean;
  /**
   * 이번 판의 **앞차 차례와 종류** (scenarios.ts 의 `rollLeadTurn`). 차례가 아니면 `null`.
   *
   * 보호구역과 같은 이유로 **우리가 굴린다.** 비율은 여러 판에 걸쳐 나타나는 성질이라
   * 판 하나만 보고 만드는 모델이 맞출 수 있는 것이 아니다 — 앞차를 프롬프트에 설명하자
   * 모델은 거의 모든 판에 앞차를 넣었고 그중 대부분이 우회전이었다.
   */
  lead: LeadPlan | null;
  /**
   * 보호구역 차례일 때 **신호기 없는 횡단보도인가** (scenarios.ts 의 `rollZoneNoSignalTurn`).
   * 보호구역 차례가 아니거나 그 개념이 아직 안 열린 레벨이면 `undefined` — 그때는 걸지 않는다.
   */
  zoneNoSignal?: boolean;
  /**
   * **이번 판은 반드시 신호기 없는 보호구역 판이다** — 최근 몇 판 동안 한 번도 없었을 때 (recommend.ts 의 `noSignalZoneDue`).
   * 보호구역 차례(`schoolZone`)는 확률이라 여러 판 동안 안 나올 수 있고, 고칠 습관이 있으면 그 습관을 시험하지 못하는
   * 무신호 판은 후보에서 아예 빠졌다.
   */
  noSignalZoneDue?: boolean;
  /** 난이도 설정 1~5 (challenge.ts) — 같은 레벨 안에서 얼마나 어려운 코스를 고르는가. 없으면 3 */
  challenge?: 1 | 2 | 3 | 4 | 5;
  /** 지금 레벨에서 모은 경험치와 다음 레벨까지 필요한 양 (curriculum.ts) — AI 가 "얼마 남았는지" 를 말할 때 쓴다 */
  xp?: number;
  xpNeed?: number;
  /** 이어 온 무위반 · 이어 틀린 판 수 — AI 가 "요즘 흐름" 을 읽는다 */
  cleanStreak?: number;
  missStreak?: number;
}

/** 앞차 차례를 어겼을 때 다음 요청에 실어 보낼 말 — 검증기의 반려 사유와 같은 자리에 쓴다 */
function leadTurnIssues(want: LeadPlan | null, got: LeadPlan | null): string[] {
  if (want === got) return [];
  if (want === null) {
    return ['이번 판은 앞차가 나올 차례가 아닙니다 — `leadCar` 를 아예 적지 마십시오 (제목·설명에도 앞차를 언급하지 마십시오)'];
  }
  const shape = JSON.stringify(leadSpecFor(want));
  const name = LEAD_PLAN_LABEL[want];
  return [
    got === null
      ? `이번 판에는 **${name} 앞차**가 있어야 합니다 — \`"leadCar": ${shape}\` 를 넣으십시오`
      : `이번 판의 앞차는 **${name}** 입니다 — \`"leadCar": ${shape}\` 로 고치십시오 (지금은 ${LEAD_PLAN_LABEL[got]})`,
  ];
}

export const LEAD_PLAN_LABEL: Record<LeadPlan, string> = {
  straight: '직진 대기',
  rolling: '일시정지를 건너뛰고 우회전',
  lawful: '규정대로 우회전',
};

/** 어린이보호구역을 켜는 조건들 — 차례가 아닌 판에서 통째로 막는다 */
const SCHOOL_ZONE_KEYS: readonly ConditionKey[] = ['schoolZone', 'approachZone'];

/** 이 판에 어린이보호구역이 들어 있는가 — 교차로 자체든 오는 길이든 */
export const hasSchoolZone = (s: ScenarioSpec): boolean =>
  s.isSchoolZone || s.approachSchoolZone !== undefined;

/**
 * 이번 판에서 **값을 받지 않을 조건들** — 이 학습자의 약점이다.
 *
 * 예산이 0인 1레벨에서도 자기 약점은 만난다는 뜻이고, 그것이 예산제로 바꾼 이유다
 * (difficulty.ts 의 첫 주석).
 */
export const freeOf = (plan?: Plan): readonly ConditionKey[] => {
  const kit = freeKitFor((plan?.target as ViolationCode | null) ?? null);
  // 보호구역 차례가 아니면 약점이라도 이번 판에서는 켜지 않는다 (Plan.schoolZone)
  if (plan && !plan.schoolZone) return kit.filter((k) => !SCHOOL_ZONE_KEYS.includes(k));
  return kit;
};

/**
 * 모델이 흘린 것을 조용히 바로잡는다.
 *
 * **보행신호기가 없는 횡단보도의 `obeysSignal`** 하나뿐이다. 지킬 신호가 없으면 이 값은
 * 어차피 무시되므로(pedWalk.ts), true 로 남겨 두면 스펙이 실제 동작과 다른 말을 하게 된다.
 * 판정이 달라지지 않는 자리라 고쳐도 안전하고, 그래서 고친다.
 *
 * **여기서 더 고치지 않는다.** 모델의 실수를 우리가 메워 주기 시작하면 무엇이 모델의
 * 실력인지 알 수 없게 되고, 프롬프트를 다듬을 근거도 사라진다. 나머지는 검증기가 버린다.
 */
function normalize(spec: Record<string, unknown>): Record<string, unknown> {
  const inst = spec.pedSignalInstalled as Record<string, boolean> | undefined;
  const peds = spec.pedestrians as Record<string, unknown>[] | undefined;
  if (!inst || !Array.isArray(peds)) return spec;

  return {
    ...spec,
    pedestrians: peds.map((p) =>
      p && inst[p.crosswalk as string] === false && p.obeysSignal !== false
        ? { ...p, obeysSignal: false }
        : p,
    ),
  };
}

/**
 * 한 판을 만들어 온다. **검증을 통과한 것만** 돌려준다.
 *
 * @param habits       coach/habits.ts 의 집계 결과
 * @param recentTitles 이미 만든 판 제목 (같은 것을 또 만들지 않게)
 */
export async function generateScenario(
  habits: HabitSummary,
  recent: ScenarioSpec[] = [],
  plan?: Plan,
): Promise<GenerateOutcome> {
  const rejected: GenerateOutcome['rejected'] = [];
  /*
    **직전 시도가 왜 버려졌는지를 다음 요청에 실어 보낸다.**

    예산을 프롬프트에 아무리 적어도 열 판에 서넛은 넘었다 — 어려운 판을 만들라는
    지시와 예산이 부딪히면 모델은 어려운 쪽을 고른다. 그런데 "방금 이것 때문에
    버렸습니다" 를 붙이면 다음 시도에서 거의 고쳐 온다.

    검증기가 모델을 가르치는 셈이다. 프롬프트를 더 길게 쓰는 것보다 이쪽이 잘 듣는다.
  */
  let retryOf: string[] = [];

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const raw = await requestSpec(toRequest(habits, recent, plan, retryOf));
    if (raw === null) {
      // 서버가 없거나(정적 배포) 키가 없다 — 다시 물어봐야 달라질 것이 없다
      return { scenario: null, tries: attempt, rejected, reason: 'no-server' };
    }

    /*
      **id 는 우리가 붙인다.** 모델에게 맡기면 손으로 쓴 판과 겹칠 수 있고, 겹치면
      저장된 기록이 섞인다. 모델이 id 를 뱉었더라도 여기서 덮어쓴다.
    */
    let candidate = { ...normalize(raw as Record<string, unknown>), id: nextId() };

    /*
      **예산을 넘긴 만큼 우리가 깎는다.** 프롬프트에 예산을 적고 비용표까지 넘겨도
      모델의 산수는 자주 틀린다. 값은 판정에 쓰이는 것이라 확실히 정할 수 있으므로,
      모델이 세 번 더 틀리기를 기다리는 대신 여기서 맞춘다 (curriculum.ts 의 clampToLevel).

      **깎기 전 판을 들고 있어야 한다** — 무엇이 사라졌는지는 전후를 견줘야 알 수 있다.
    */
    const beforeTrim = candidate as unknown as ScenarioSpec;
    /*
      **모양이 깨진 판은 깎지도 맞추지도 않는다.** 예산을 재는 코드는 필드가 다 있다고
      믿는다(보행자 배열의 길이 등). 모델이 `pedestrians` 를 빼먹고 오자 거기서 예외가 났고,
      그 예외가 판 만들기를 통째로 멈춰 **"다음 판을 만드는 중…" 이 영원히 풀리지 않았다.**
      모양부터 보고, 깨졌으면 아래 검증기가 사유를 붙여 돌려보내게 둔다.
    */
    const wellFormed = !checkSchema(candidate).some((i) => i.level === 'fatal');
    if (plan && wellFormed) {
      candidate = { ...clampToLevel(beforeTrim, plan.level, freeOf(plan)) };
    }
    /*
      **직진 대기 앞차의 기다림을 줄여 둔 채로 검증한다.** 주행 직전에 prepareScenario 가
      같은 조정을 하므로, 여기서 먼저 해 두어야 검증한 판과 실제로 달리는 판이 같다.
    */
    if (wellFormed) candidate = { ...fitStraightLeadWait(candidate as unknown as ScenarioSpec) };
    /*
      **적색 출발 + 우회전 신호등이면 녹색 구간으로 옮긴다** (scenarios.ts 의 fitRightArrowStart).
      모델은 반려 사유를 받고도 같은 출발 자리를 세 번 골랐다 — 판이 끝내 안 만들어졌다.
    */
    if (wellFormed) candidate = { ...fitRightArrowStart(candidate as unknown as ScenarioSpec) };

    const result = validateScenario(candidate);

    /*
      **값을 깎았어도 글은 못 고친다.** "어린이보호구역 - …" 이라고 적힌 판이 실제로는
      평범한 교차로면 학습자가 화면과 다른 것을 배운다. 그런 판만 되돌려보낸다.
      (clampToLevel 뒤라 checkDifficulty 는 통과하는 것이 정상이지만, 혹시 남는 것이
      있으면 함께 잡는다)
    */
    /*
      **차례가 아닌데 보호구역을 만들어 왔으면 돌려보낸다.**

      프롬프트로 이르는 것만으로는 가끔 새어 나온다 — 약점을 시험하라는 지시와 부딪히면
      모델은 약점 쪽을 고른다 (예산에서 겪은 것과 같은 일이다). 여기서 빼 버릴 수는 없다:
      제목과 설명이 그대로 남아 판이 거짓말을 한다 (`describesRemoved` 가 그래서 있다).

      **마지막 시도에서는 봐준다.** 이건 옳고 그름이 아니라 **비율**의 문제라, 판 하나를
      못 만들어 학습자를 메뉴로 돌려보내는 것보다 보호구역이 한 번 더 나오는 편이 낫다.
    */
    const outOfTurn =
      plan && !plan.schoolZone && attempt < MAX_TRIES && hasSchoolZone(candidate as unknown as ScenarioSpec)
        ? ['이번 판은 어린이보호구역 차례가 아닙니다 — isSchoolZone 을 false 로 두고 approachSchoolZone 을 빼십시오']
        : [];

    /*
      **앞차도 차례가 있다** (Plan.lead · scenarios.ts 의 `rollLeadTurn`).

      보호구역과 똑같이 돌려보낸다 — 여기서 값만 빼 버리면 제목과 설명이 그대로 남아
      판이 거짓말을 한다. 마지막 시도에서는 봐준다: 비율의 문제일 뿐이라, 판을 못 만들어
      학습자를 메뉴로 돌려보내는 것보다 앞차가 한 번 더 나오는 편이 낫다.
    */
    const leadOutOfTurn =
      plan && wellFormed && attempt < MAX_TRIES
        ? leadTurnIssues(plan.lead, leadPlanOf(candidate as unknown as ScenarioSpec))
        : [];

    // 모양이 깨졌으면 예산·글 검사도 건너뛴다 — 둘 다 필드가 다 있다고 믿는다 (위 wellFormed)
    const offLevel = plan && wellFormed
      ? [
          ...checkDifficulty(candidate as unknown as ScenarioSpec, plan.level, freeOf(plan)),
          ...describesRemoved(beforeTrim, candidate as unknown as ScenarioSpec),
          ...outOfTurn,
          ...leadOutOfTurn,
        ]
      : [];
    const levelIssues: Issue[] = offLevel.map((m) => ({
      level: 'fatal',
      stage: 'coherence',
      message: m,
    }));

    if (result.ok && !levelIssues.length) {
      const spec = candidate as unknown as ScenarioSpec;
      return {
        scenario: {
          ...spec,
          why: typeof (raw as { why?: unknown }).why === 'string' ? (raw as { why: string }).why : '',
          generated: true,
          level: plan?.level ?? null,
        },
        tries: attempt,
        rejected,
        reason: 'ok',
      };
    }

    const issues = [...result.issues, ...levelIssues];
    rejected.push({ try: attempt, issues });
    // 다음 시도에 그대로 넘긴다 — 치명적인 것만, 우리가 다시 풀어쓰지 않고
    retryOf = issues.filter((i) => i.level === 'fatal').map((i) => i.message);
    // 개발 중에 왜 버려졌는지 보이게 남긴다 — 프롬프트를 다듬는 근거가 된다
    console.warn(
      `[scenario] ${attempt}번째 생성 폐기:\n${describeIssues([...result.issues, ...levelIssues])}`,
    );
  }

  return { scenario: null, tries: MAX_TRIES, rejected, reason: 'invalid' };
}

/** 서버에 한 번 물어본다. 어떤 이유로든 안 되면 `null` */
async function requestSpec(payload: unknown): Promise<unknown | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('/api/scenario', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });

    if (!res.ok) {
      // 503 NO_KEY 는 '키를 안 넣었다'는 정상적인 상태다 — 시끄럽게 굴 일이 아니다
      if (res.status !== 503) console.warn('[scenario]', res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as { spec?: unknown };
    return data.spec ?? null;
  } catch (e) {
    // 정적 배포·단일 파일에서는 여기로 온다 (엔드포인트가 아예 없다). 정상이다.
    console.warn('[scenario]', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
