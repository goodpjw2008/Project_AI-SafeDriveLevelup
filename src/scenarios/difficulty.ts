/**
 * **난이도 예산** — 한 판이 얼마나 어려운지를 점수로 잰다.
 *
 * ## 왜 금지 목록을 버렸는가
 *
 * 예전에는 레벨마다 불리언 열 개(`allowSchoolZone`·`allowJaywalker` …)로 **조건의 유무**를
 * 정했다. 난이도를 "이 조건이 존재하는가" 로만 재는 셈이라, 다음 일이 벌어졌다 —
 *
 * ```
 *   학습자: L3 · 최대 약점 = 어린이보호구역 일시정지 (4회)
 *      │
 *      ├─ 프롬프트: "이 습관이 다시 일어날 수밖에 없는 상황을 만드십시오"
 *      │            "단, 어린이보호구역이 아닙니다"          ← 모순
 *      │
 *      ├─ 모델: 보호구역 판을 만든다 (지시를 따르려고)
 *      └─ 코드: isSchoolZone = false                       ← 코드가 이긴다
 *
 *   결과: 이 학습자의 약점을 시험하지 못하는 판
 * ```
 *
 * 이 과정의 목적이 "AI 가 이 사람의 실수를 보고 판을 만든다" 인데, **울타리가 그 실수를
 * 막고 있었다.** 다섯 단계를 올라가야 자기 약점을 만나는 구조였다.
 *
 * ## 대신 무엇을 하는가
 *
 * 난이도를 **양**으로 잰다. 조건마다 비용이 있고, 레벨마다 쓸 수 있는 예산이 있다.
 * 무엇에 쓸지는 모델이 고른다 — 금지 목록은 모델을 집행자로 만들지만 예산은 설계자로
 * 만든다.
 *
 * 그리고 **학습자의 약점에 해당하는 조건은 공짜다**(`freeKitFor`). 그래서 예산이 0인
 * L1 에서도 자기 약점을 만난다 — 약점만 있고 나머지는 최대한 쉬운 판이 되는데,
 * 가르치는 판으로는 그게 정답이다.
 *
 * ## 값은 어디서 왔는가
 *
 * 옛 `LEVELS` 표가 각 조건을 **몇 번째 레벨에서 열어 주었는지**에서 뽑았다. 그래야 새
 * 체계가 옛 사다리를 재현하고, 옮겨 오면서 조용히 쉬워지거나 어려워지지 않는다.
 * (tests/difficulty.test.ts 가 그 재현을 검사한다)
 *
 * **순수 모듈이다** — Three.js 도 DOM 도 저장도 쓰지 않는다. 난이도 값이 이 게임의 학습
 * 설계 그 자체라, 테스트로 못 박으려면 다른 것이 섞이면 안 된다 (curriculum.ts 와 같은 원칙).
 */

import type { ScenarioSpec } from './scenarios';
import type { ViolationCode } from '../rules/violations';

/**
 * 난이도를 만드는 조건 하나 — **비용을 매길 수 있는 최소 단위.**
 *
 * `ScenarioSpec` 의 필드와 1:1 이 아니다. `schoolZone` 은 필드 하나지만
 * `lateStart` 는 보행자마다 다른 `startWithin` 을 하나로 묶은 것이고,
 * `lowVisibility` 는 `timeOfDay` 와 `weather` 둘을 함께 본다.
 */
/**
 * 이 보행자가 **지킬 신호를 두고** 무시하는가.
 *
 * 신호기가 없으면 `obeysSignal` 이 무시되므로(pedWalk.ts) 값을 매기면 없는 난이도를
 * 세게 된다. 횡단보도마다 신호기가 어디서 정해지는지가 달라 한 곳에 모아 둔다 —
 * 교차로(A·C)는 `pedSignalInstalled`, 진입부(S)는 `approachSchoolZone.signal` 이다.
 */
const jaywalks = (s: ScenarioSpec, p: ScenarioSpec['pedestrians'][number]): boolean => {
  if (p.obeysSignal !== false) return false;
  if (p.crosswalk === 'S') return s.approachSchoolZone?.signal === true;
  return s.pedSignalInstalled[p.crosswalk];
};

export type ConditionKey =
  | 'redStart'
  | 'crowd'
  | 'traffic'
  | 'missingPedSignal'
  | 'schoolZone'
  | 'lowVisibility'
  | 'exitBlocked'
  | 'rightArrow'
  | 'jaywalker'
  | 'chance'
  | 'lateStart'
  | 'approachZone'
  | 'leadCar';

/** 보행자가 이 거리 밖에서 나서면 값을 매기지 않는다 (옛 1레벨의 `minStartWithin`) */
const FREE_START_WITHIN = 20;

/**
 * 조건 하나의 비용과, 그것을 **한 단계 덜어내는 방법.**
 *
 * `relax` 가 있는 이유: 예산을 넘겼을 때 무엇을 어떻게 깎을지가 비용표와 같은 자리에
 * 있어야 한다. 따로 두면 조건을 하나 더할 때 한쪽만 고치게 된다.
 */
interface Condition {
  key: ConditionKey;
  /** 프롬프트와 반려 사유에 그대로 쓰이는 이름 */
  label: string;
  /** 이 판에서 이 조건이 얼마나 쓰였나. 0 이면 안 쓴 것이다 */
  cost: (s: ScenarioSpec) => number;
  /**
   * **한 단계 덜어낸다.** 반드시 `cost` 가 줄어드는 새 스펙을 돌려줘야 한다 —
   * 안 줄면 `trimToBudget` 이 제자리를 돈다.
   *
   * 켜고 끄는 조건은 한 번에 0 이 되고, 양으로 재는 조건(보행자 수·거리)은
   * 한 칸씩 준다. 판을 통째로 무르는 것보다 **가장 비싼 곁가지부터 깎는** 편이
   * 모델이 만든 판의 뜻을 덜 해친다.
   */
  relax: (s: ScenarioSpec) => ScenarioSpec;
}

/**
 * 비용표.
 *
 * | 조건 | 비용 | 근거 (옛 표에서 열리던 레벨) |
 * |---|---|---|
 * | 적색·황색 시작 | 1 | L2 |
 * | 보행자 (n−1)명 | n−1 | L3 에서 2명 · L10 에서 4명 |
 * | 교차 차량 (n−1)대 | n−1 | L1 에서 1대 · L10 에서 5대 |
 * | 신호기 없는 횡단보도 | 2 | L4 |
 * | 어린이보호구역 | 2 | L5 |
 * | 밤 또는 비 | 2 (둘 다면 3) | L7 |
 * | 꼬리물기 | 2 | L8 |
 * | 우회전 신호등 | 2 | L9 |
 * | 무단횡단 보행자 | 3 | L6 |
 * | 나올지 모르는 보행자 | 3 | L10 |
 * | 20m 안에서 나섬 | ⌈(20−d)/2⌉ | L1 20m → L10 10m |
 * | 앞차 (규정대로 섬) | 1 | 새 조건 — 추돌·시야 가림 |
 * | 앞차 (직진 대기) | 2 | 새 조건 — 우회전이 막혀 기다려야 한다 |
 * | 앞차 (일시정지 건너뜀) | 3 | 새 조건 — 무단횡단 보행자와 같은 "틀린 신호" |
 */
const CONDITIONS: readonly Condition[] = [
  {
    key: 'redStart',
    label: '적색·황색 구간에서 시작',
    // 신호 구간 0~2 가 녹색이다 (scenarios.ts 의 STANDARD_PROGRAM)
    cost: (s) => (s.startPhase > 2 ? 1 : 0),
    relax: (s) => ({ ...s, startPhase: 0, startPhaseElapsed: 0 }),
  },
  {
    key: 'crowd',
    label: '보행자 여럿',
    cost: (s) => Math.max(0, s.pedestrians.length - 1),
    relax: (s) => ({ ...s, pedestrians: s.pedestrians.slice(0, -1) }),
  },
  {
    key: 'traffic',
    label: '교차 차량',
    cost: (s) => Math.max(0, s.crossTraffic - 1),
    relax: (s) => ({ ...s, crossTraffic: Math.max(1, s.crossTraffic - 1) }),
  },
  {
    key: 'missingPedSignal',
    label: '보행신호기 없는 횡단보도',
    cost: (s) => (s.pedSignalInstalled.A && s.pedSignalInstalled.C ? 0 : 2),
    relax: (s) => ({ ...s, pedSignalInstalled: { A: true, C: true } }),
  },
  {
    key: 'schoolZone',
    label: '어린이보호구역',
    cost: (s) => (s.isSchoolZone ? 2 : 0),
    relax: (s) => ({ ...s, isSchoolZone: false }),
  },
  {
    /*
      밤과 비는 **따로 세지 않는다.** 둘 다 "보이는 거리가 준다" 는 한 가지를 하고,
      각각 2점씩 매기면 밤비 판이 보호구역 두 개짜리보다 비싸진다. 겹치면 1점만 는다.
    */
    key: 'lowVisibility',
    label: '밤 · 비',
    cost: (s) => {
      const night = s.timeOfDay !== 'day';
      const rain = s.weather !== 'clear';
      return night && rain ? 3 : night || rain ? 2 : 0;
    },
    relax: (s) =>
      s.weather !== 'clear' ? { ...s, weather: 'clear' } : { ...s, timeOfDay: 'day' },
  },
  {
    key: 'exitBlocked',
    label: '꼬리물기 (진출로 막힘)',
    cost: (s) => (s.exitBlocked ? 2 : 0),
    relax: (s) => ({ ...s, exitBlocked: false }),
  },
  {
    key: 'rightArrow',
    label: '우회전 신호등',
    cost: (s) => (s.rightArrowInstalled ? 2 : 0),
    relax: (s) => ({ ...s, rightArrowInstalled: false }),
  },
  {
    /*
      **신호기가 있는 횡단보도에서만** 무단횡단이다. 신호기가 없으면 지킬 신호가 없어
      `obeysSignal` 이 무시되므로(pedWalk.ts), 거기에 값을 매기면 없는 난이도를 세게 된다.
    */
    key: 'jaywalker',
    label: '보행신호를 무시하는 보행자',
    cost: (s) => (s.pedestrians.some((p) => jaywalks(s, p)) ? 3 : 0),
    relax: (s) => ({
      ...s,
      pedestrians: s.pedestrians.map((p) => (jaywalks(s, p) ? { ...p, obeysSignal: true } : p)),
    }),
  },
  {
    key: 'chance',
    label: '나올지 모르는 보행자',
    cost: (s) => (s.pedestrians.some((p) => p.chance !== undefined) ? 3 : 0),
    relax: (s) => ({
      ...s,
      pedestrians: s.pedestrians.map((p) => {
        if (p.chance === undefined) return p;
        const q = { ...p };
        delete q.chance;
        return q;
      }),
    }),
  },
  {
    /*
      **진입부 어린이보호구역** — 오는 길에 하나 더 서야 하는 자리.

      값이 둘로 갈린다. 신호기가 **있으면** 적색에 서는 것이라 아는 사람은 그냥 한다.
      **없으면** 제27조 제7항이 걸린다 — 보행자가 안 보여도 서야 하고, 이 게임이
      교정하려는 세 오해 중 하나가 정확히 거기다. 그래서 없는 쪽이 더 비싸다.

      **깎을 때는 신호기를 먼저 달아 준다.** 구간을 통째로 없애는 것보다 그편이 판의
      뜻을 덜 해친다 — 보호구역을 지나는 것은 그대로고 판단만 쉬워진다.
    */
    key: 'approachZone',
    label: '진입부 어린이보호구역',
    cost: (s) => (!s.approachSchoolZone ? 0 : s.approachSchoolZone.signal ? 2 : 4),
    relax: (s) =>
      s.approachSchoolZone?.signal
        ? { ...s, approachSchoolZone: undefined }
        : { ...s, approachSchoolZone: { signal: true } },
  },
  {
    /*
      **앞차.** 성향에 따라 값이 크게 갈린다.

      규정대로 서는 앞차는 1점이다 — 제때 서야 하는 부담과 차체가 사람을 가리는 것이 더해질
      뿐, 앞차가 하는 일은 늘 옳다. 따라 하면 된다.

      일시정지를 건너뛰는 앞차는 3점이다. **틀린 본보기**를 눈앞에 두고 옳게 판단해야 한다는
      점에서 무단횡단 보행자(`jaywalker`)와 같은 종류의 어려움이다 — 보이는 신호가 규정과
      반대를 말한다. 깎을 때는 앞차를 없애기 전에 **규정대로 서는 앞차로 바꾼다.**
    */
    key: 'leadCar',
    label: '앞차',
    cost: (s) =>
      !s.leadCar ? 0 : s.leadCar.behavior === 'rolling' ? 3 : s.leadCar.path === 'straight' ? 2 : 1,
    /*
      깎는 순서는 **어려운 것부터 한 단계씩**이다.
      일시정지를 건너뛰는 앞차(3) → 직진 대기 앞차(2) → 규정대로 서는 앞차(1) → 없음(0).
    */
    relax: (s) =>
      !s.leadCar
        ? s
        : s.leadCar.behavior === 'rolling'
          ? { ...s, leadCar: { ...s.leadCar, behavior: 'lawful' } }
          : s.leadCar.path === 'straight'
            ? { ...s, leadCar: { ...s.leadCar, path: 'right' } }
            : { ...s, leadCar: undefined },
  },
  {
    /*
      **코앞에서 나서는 보행자.** 조건표에는 아무것도 안 걸리는데 실제로는 훨씬 어렵다 —
      판단할 시간 자체가 없기 때문이다. 난이도를 만드는 것은 조건의 유무만이 아니다.

      가장 가까이서 나서는 한 명으로 잰다. 여럿이 가까워도 어려워지는 것은 맞지만,
      그건 `crowd` 가 이미 세고 있다.
    */
    key: 'lateStart',
    label: '보행자가 코앞에서 나섬',
    cost: (s) => {
      const near = Math.min(
        FREE_START_WITHIN,
        ...s.pedestrians.map((p) => p.startWithin ?? FREE_START_WITHIN),
      );
      return Math.ceil(Math.max(0, FREE_START_WITHIN - near) / 2);
    },
    relax: (s) => {
      const near = Math.min(
        FREE_START_WITHIN,
        ...s.pedestrians.map((p) => p.startWithin ?? FREE_START_WITHIN),
      );
      // 가장 가까운 사람을 2m 물린다 — 그만큼 비용이 1점 준다
      const to = Math.min(FREE_START_WITHIN, near + 2);
      return {
        ...s,
        pedestrians: s.pedestrians.map((p) =>
          (p.startWithin ?? FREE_START_WITHIN) < to ? { ...p, startWithin: to } : p,
        ),
      };
    },
  },
];

/**
 * 이 판이 그 조건을 쓰고 있는가.
 *
 * 깎기 전후를 견주는 데 쓴다 (curriculum.ts 의 `describesRemoved`) — 있던 것이
 * 없어졌는지를 알아야 "글이 아직 그 말을 하고 있다" 를 판단할 수 있다.
 */
export const hasCondition = (spec: ScenarioSpec, key: ConditionKey): boolean =>
  (CONDITIONS.find((c) => c.key === key)?.cost(spec) ?? 0) > 0;

/**
 * 비용표를 프롬프트에 실어 보낼 모양 — 서버는 세지 않고 **읽기만 한다**.
 *
 * ## `field` 가 왜 필요한가
 *
 * 처음에는 이름과 값만 적었다(`보행신호기 없는 횡단보도 — 2점`). 그랬더니 모델이
 * **필드 이름을 지어냈다** — `pedSignalInstalled: false` 처럼 객체 자리에 불리언을
 * 넣어 왔고, 그 판은 스키마 검사에서 통째로 버려졌다.
 *
 * 옛 프롬프트에는 레벨별 고정값 목록이 있어서(`"pedSignalInstalled": { "A": true, "C": true }`)
 * 모양이 저절로 못 박혔는데, 예산제로 바꾸면서 그 자리가 사라진 것이다.
 * **비용표가 그 자리를 대신한다** — 조건마다 어느 필드를 어떤 모양으로 건드리는지 적는다.
 */
export const COST_TABLE: readonly {
  key: ConditionKey;
  label: string;
  note: string;
  /** 이 조건을 켤 때 건드리는 JSON 필드와 그 모양 */
  field: string;
}[] = [
  {
    key: 'redStart',
    label: '적색·황색 구간에서 시작',
    note: '1점',
    field: '"startPhase": 3~7 중 하나 (0~2 는 녹색이라 0점)',
  },
  { key: 'crowd', label: '보행자', note: '(인원−1)점', field: '"pedestrians" 배열의 길이' },
  { key: 'traffic', label: '교차 차량', note: '(대수−1)점', field: '"crossTraffic": 정수' },
  {
    key: 'missingPedSignal',
    label: '보행신호기 없는 횡단보도',
    note: '2점',
    field: '"pedSignalInstalled": { "A": true, "C": false } — **반드시 A·C 를 가진 객체**',
  },
  { key: 'schoolZone', label: '어린이보호구역', note: '2점', field: '"isSchoolZone": true' },
  {
    key: 'lowVisibility',
    label: '밤 또는 비',
    note: '2점 (둘 다면 3점)',
    field: '"timeOfDay": "night" · "weather": "rain"',
  },
  { key: 'exitBlocked', label: '꼬리물기', note: '2점', field: '"exitBlocked": true' },
  {
    key: 'rightArrow',
    label: '우회전 신호등',
    note: '2점',
    field: '"rightArrowInstalled": true (달면 startPhase 는 0~2)',
  },
  {
    key: 'jaywalker',
    label: '보행신호를 무시하는 보행자',
    note: '3점',
    field: '보행자의 "obeysSignal": false (신호기가 있는 횡단보도에서만 값이 붙는다)',
  },
  {
    key: 'chance',
    label: '나올지 모르는 보행자',
    note: '3점',
    field: '보행자의 "chance": 0~1',
  },
  {
    key: 'lateStart',
    label: '보행자가 20m 안에서 나섬',
    note: '올림((20−거리)÷2)점 — 16m 면 2점, 10m 면 5점',
    field: '보행자의 "startWithin": 미터',
  },
  {
    key: 'leadCar',
    label: '앞차 (내 앞에서 먼저 가는 차)',
    note: '규정대로 우회전 1점 · 직진 대기 2점 · 일시정지를 건너뛰고 우회전 3점',
    field:
      '"leadCar": { "behavior": "lawful" | "rolling", "path": "right" | "straight", "headway": 1.4~4.0 (초, 생략하면 2) }',
  },
  {
    key: 'approachZone',
    label: '진입부 어린이보호구역 (교차로에 닿기 전 지나는 구간)',
    note: '신호기 있으면 2점 · 없으면 4점',
    field:
      '"approachSchoolZone": { "signal": true } — 그 횡단보도의 보행자는 "crosswalk": "S"',
  },
];

export interface CostItem {
  key: ConditionKey;
  label: string;
  /** 실제로 치른 값 (공짜 묶음이면 0) */
  cost: number;
  /** 공짜가 아니었다면 얼마였나 — 반려 사유에 쓴다 */
  listPrice: number;
  free: boolean;
}

export interface CostBreakdown {
  items: CostItem[];
  /** 공짜를 뺀 합계 */
  total: number;
}

/**
 * 이 판이 쓴 점수.
 *
 * @param free 값을 받지 않을 조건들 (`freeKitFor`) — 이 학습자의 약점이다
 */
export function costOf(spec: ScenarioSpec, free: readonly ConditionKey[] = []): CostBreakdown {
  const items: CostItem[] = [];
  let total = 0;

  for (const c of CONDITIONS) {
    const listPrice = c.cost(spec);
    if (listPrice === 0) continue;
    const isFree = free.includes(c.key);
    const cost = isFree ? 0 : listPrice;
    items.push({ key: c.key, label: c.label, cost, listPrice, free: isFree });
    total += cost;
  }

  // 비싼 것이 앞 — 반려 사유도 트리머도 이 순서를 그대로 쓴다
  items.sort((a, b) => b.cost - a.cost);
  return { items, total };
}

/**
 * 예산 안으로 **깎아 넣는다.**
 *
 * 가장 비싼 조건부터 한 단계씩 던다. **공짜 묶음은 절대 깎지 않는다** — 그것을 깎으면
 * 이 판을 만든 이유가 사라진다. 예산이 0인데 공짜 묶음이 4점어치라면 그대로 통과시킨다.
 *
 * 옛 `clampToLevel` 은 "금지된 것을 전부 끈다" 였다. 지금은 **가장 비싼 곁가지부터
 * 판을 깎는다** — 모델이 만든 판의 뜻을 덜 해치는 쪽이다.
 */
export function trimToBudget(
  spec: ScenarioSpec,
  budget: number,
  free: readonly ConditionKey[] = [],
): ScenarioSpec {
  let out = spec;

  /*
    한 번 돌 때마다 합계가 **반드시** 준다(`relax` 의 계약). 그래도 상한을 둔다 —
    비용표를 잘못 고쳐 relax 가 값을 안 줄이면 여기서 브라우저가 멈추기 때문이다.
    조건 열하나에 가장 비싼 것이 5점이라 60이면 넉넉하다.
  */
  for (let guard = 0; guard < 60; guard++) {
    const { items, total } = costOf(out, free);
    if (total <= budget) break;

    const target = items.find((i) => !i.free && i.cost > 0);
    if (!target) break; // 남은 것이 전부 공짜다 — 더 깎을 수 없고, 깎아서도 안 된다

    const cond = CONDITIONS.find((c) => c.key === target.key);
    if (!cond) break;
    out = cond.relax(out);
  }

  return out;
}

/**
 * 예산을 넘었는가 — 넘었으면 **사람이 읽을 사유**로 돌려준다.
 *
 * `trimToBudget` 뒤에는 통과하는 것이 정상이다. 그래도 재는 이유는 옛
 * `checkDifficulty` 와 같다 — 값을 깎는 코드와 재는 코드가 갈라지면 언젠가 어긋난다.
 */
export function checkBudget(
  spec: ScenarioSpec,
  budget: number,
  free: readonly ConditionKey[] = [],
): string[] {
  const { items, total } = costOf(spec, free);
  if (total <= budget) return [];

  const spent = items
    .filter((i) => !i.free)
    .map((i) => `${i.label} ${i.cost}점`)
    .join(' · ');
  return [`조건이 예산 ${budget}점을 넘습니다 (${total}점: ${spent})`];
}

/**
 * 그 습관을 시험하려면 **반드시 켜야 하는 조건들.**
 *
 * `SCHOOL_ZONE_NO_STOP` 이 둘인 것이 중요하다 — 제27조 제7항은 *보호구역의 신호기 없는
 * 횡단보도*에 걸리므로, 둘 중 하나만으로는 그 판단을 물을 수 없다.
 *
 * 비어 있는 습관(서행·대회전·방향지시등)은 **어느 판에서나 시험된다.** 조건을 켜서
 * 만들어 내는 상황이 아니라 운전하는 방식의 문제라, 공짜로 줄 것이 없다.
 */
export const TARGET_KIT: Readonly<Record<ViolationCode, readonly ConditionKey[]>> = {
  SCHOOL_ZONE_NO_STOP: ['schoolZone', 'missingPedSignal'],
  RED_NO_STOP: ['redStart'],
  OVER_STOP_LINE: ['redStart'],
  RIGHT_ARROW_RED: ['rightArrow'],
  BLOCKING_INTERSECTION: ['exitBlocked'],
  PEDESTRIAN_BLOCKED: ['lateStart'],
  SCHOOL_ZONE_RED: ['approachZone'],
  NO_SLOW_DOWN: [],
  WIDE_TURN: [],
  NO_TURN_SIGNAL: [],
};

/**
 * 이번 판에서 **값을 받지 않을 조건들.**
 *
 * 가장 굳은 습관 하나만 본다. 둘을 공짜로 주면 낮은 레벨에서 어려운 조건 둘이 겹쳐,
 * "약점만 있고 나머지는 쉬운 판" 이라는 이 설계의 뜻이 무너진다.
 */
export const freeKitFor = (top: ViolationCode | null): readonly ConditionKey[] =>
  top ? (TARGET_KIT[top] ?? []) : [];
