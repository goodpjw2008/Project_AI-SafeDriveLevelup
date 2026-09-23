/**
 * **어린이보호구역 직진 연습편** — 우회전 없이 보호구역 도로를 곧장 통과하는 판들.
 *
 * ## 왜 따로 만드는가
 *
 * 지금까지의 라이브러리(library.ts)는 8,958판 전부가 **교차로에서 우회전한다.** 사용자가
 * 연습을 셋으로 나누자고 했고(우회전 전용 · 보호구역 전용 · 둘 다), 보호구역 전용은
 * "우회전이 없는" 코스라 기존 라이브러리의 조합으로는 하나도 만들 수 없다.
 *
 * **번호 체계를 섞지 않는다.** 기존 라이브러리의 번호는 축 배열 순서에서 나오므로
 * (library.ts 의 `numberedTags`), 여기에 새 축을 끼우면 사용자가 부르던 번호가 통째로 밀린다
 * ("4927번 맵"). 그래서 이 코스는 **자기 id 와 자기 번호**를 갖는다 — 번호는 50001 부터라
 * 기존 번호(1~8,958)와 겹칠 일이 없다.
 *
 * ## 이 코스가 묻는 것
 *
 * 사용자가 정한 대로 **횡단보도 셋을 지나며 보행자만 변수**다.
 *
 *  - **S** — 진입로 보호구역 횡단보도. 신호기가 **있는 판과 없는 판**이 섞인다
 *  - **A** — 교차로 앞 횡단보도. 정면 차량신호를 따라간다 (적색이면 서서 기다린다 — 우회전과 다르다)
 *  - **B** — 교차로 건너편 횡단보도. A 와 같은 신호기를 쓴다 (rules/lawRules.ts 의 signalCrosswalk)
 *
 * **조작은 우회전 코스와 같다** (사용자가 정했다: "어린이 보호구역에서만 키제어 방법이 다르면 헷갈릴 것
 * 같아") — ↑ 출발 · ↓ 정지이고 속도는 차가 알아서 맞춘다. 보호구역에 들어서면 30km/h 이하로 스스로
 * 조인다 (game/Vehicle.ts 의 zoneTargetKmh). 방향지시등은 돌지 않으므로 묻지 않는다.
 */

import type { ScenarioSpec, PedSpawn } from './scenarios';
import type { ViolationCode } from '../rules/violations';
import { LEVEL_SHARE, type LibraryEntry, type LibraryTags } from './library';
import type { Difficulty } from './curriculum';

/** 이 코스 판의 id 는 여기서부터 — 라이브러리 id(1000 + 12자리)와 겹치지 않는 자리다 */
export const ZONE_ID_BASE = 2_000_000_000_000;

/**
 * 화면에서 부르는 번호의 시작 — `보호구역 50001번`.
 *
 * 라이브러리가 아무리 늘어도(지금 8,958) 닿지 않을 만큼 띄워 둔다. 겹치면 같은 번호가
 * 두 판을 가리키게 되어, 사용자가 번호로 판을 부르는 방식 자체가 깨진다 (tests/zoneCourse.test.ts).
 */
export const ZONE_NUMBER_BASE = 50_001;

/**
 * **신호기가 어디에 있는가** — 사거리가 없는 도로라 횡단보도마다 따로 정한다.
 *
 * 사용자가 정했다: "중간에 신호등 있는 횡단보도와 신호등 없는 횡단보도가 섞여 나오게." 그래서
 * 셋 중 **하나만** 있는 경우와 **둘**이 있는 경우를 함께 둔다 — 셋 다 없는 길(가장 흔한 보호구역)도,
 * 셋 다 있는 길(신호를 계속 보는 길)도 나온다.
 */
const SIGNAL_SETS = [
  [],
  ['S'],
  ['A'],
  ['B'],
  ['S', 'B'],
  ['A', 'B'],
  ['S', 'A', 'B'],
] as const;
/**
 * 횡단보도마다 사람이 어떻게 있는가.
 *
 *  - `none` — 아무도 없다. **무신호 횡단보도에서는 이것이 핵심이다** (제27조 제7항 — 사람이 없어도 선다)
 *  - `waiting` — 연석에서 건너려고 서 있다 (신호기 없는 곳에서만)
 *  - `crossing` — 이미 건너고 있다
 *  - `jaywalk` — 보행 적색인데 건넌다 (신호기가 있는 곳에서만 '무단횡단' 이라는 말이 성립한다)
 */
const PEDS = ['none', 'waiting', 'crossing', 'jaywalk'] as const;
const KINDS = ['child', 'adult', 'elder'] as const;

export interface ZoneTags {
  /** 신호기가 있는 횡단보도들 (SIGNAL_SETS 의 몇 번째인가) */
  signals: number;
  sPed: (typeof PEDS)[number];
  aPed: (typeof PEDS)[number];
  bPed: (typeof PEDS)[number];
  kind: (typeof KINDS)[number];
}

/** 이 판에서 그 횡단보도에 신호기가 있는가 */
export const hasSignal = (t: ZoneTags, at: 'S' | 'A' | 'B'): boolean =>
  (SIGNAL_SETS[t.signals] as readonly string[]).includes(at);

/**
 * 성립하는 조합인가 — **판의 글이 거짓말이 되는 조합**을 여기서 뺀다 (library.ts 의 combinationAllowed 와 같은 자리).
 */
export function zoneCombinationAllowed(t: ZoneTags): boolean {
  for (const at of ['S', 'A', 'B'] as const) {
    const ped = at === 'S' ? t.sPed : at === 'A' ? t.aPed : t.bPed;
    if (ped === 'none') continue;
    /*
      **'무단횡단' 은 지킬 신호가 있을 때만 성립한다.** 신호기가 없는 횡단보도에서는 언제 건너도
      규정을 어기는 것이 아니다 — 그런 사람을 '무단횡단' 이라 적으면 판의 글이 거짓말이 된다.
    */
    if (ped === 'jaywalk' && !hasSignal(t, at)) return false;
    /*
      **신호기가 있는 자리에는 무단횡단자만 둔다.**

      보행신호와 차량신호는 번갈아 켜진다 — 신호를 지키는 사람은 **내가 서 있는 동안** 건너고,
      내 신호가 녹색이 될 즈음에는 이미 다 건넌 뒤다. 보행 녹색이 끝나는 순간에 나서게 해 봐도
      내 녹색까지 0.1초가 남아, 보행자를 보지 않는 운전자조차 걸리지 않았다 (플레이테스트가 잡았다).
      **아무 일도 일어나지 않는 판**이므로 조합에서 뺀다 — 신호기 없는 자리에서는 언제든 건너므로 역할이 있다.
    */
    if (ped !== 'jaywalk' && hasSignal(t, at)) return false;
  }
  /*
    **나이는 한 사람이 나오는 판에서만 가른다.**

    아무도 없으면 나이는 뜻이 없고, 여럿이 나오는 판에서 셋을 다 돌리면 같은 장면이 세 벌씩 생긴다 —
    판이 세 배가 되고 전수 검증도 세 배 걸린다. 어른 · 노인을 따로 겪는 것은 한 사람 판으로 충분하다.
  */
  const people = [t.sPed, t.aPed, t.bPed].filter((x) => x !== 'none').length;
  if (people !== 1 && t.kind !== 'child') return false;
  return true;
}

const allCombinations = (): ZoneTags[] => {
  const out: ZoneTags[] = [];
  for (let signals = 0; signals < SIGNAL_SETS.length; signals++)
    for (const sPed of PEDS)
      for (const aPed of PEDS)
        for (const bPed of PEDS)
          for (const kind of KINDS) {
            const t = { signals, sPed, aPed, bPed, kind };
            if (zoneCombinationAllowed(t)) out.push(t);
          }
  return out;
};

export const zoneId = (i: number): number => ZONE_ID_BASE + i;

/**
 * **신호기가 있는 횡단보도의 주기 오프셋** (초).
 *
 * 보호구역 주기는 녹18 · 황3 · 적18 이다 (scenarios.ts 의 SCHOOL_ZONE_PROGRAM).
 *
 * **적색 구간이 도착 시각의 폭을 덮도록** 맞춘다. 도착이 앞 횡단보도에서 몇 초를 서느냐에 따라 10초 넘게
 * 흔들리는데, '곧 녹색이 되는 자리' 로만 맞추면 조금만 늦어도 녹색에 닿아 **적색을 한 번도 못 만난다**
 * (플레이테스트가 잡았다 — 세 번째 신호등 판이 그랬다). 그래서 적색 18초의 **앞쪽**에 닿게 한다:
 * 첫 번째는 5~23초, 두 번째는 16~34초, 세 번째는 28~46초가 적색이다.
 */
const ZONE_SIGNAL_OFFSET: Record<'S' | 'A' | 'B', number> = { S: 16, A: 5, B: 32 };

/**
 * **사람이 나서는 때** (초).
 *
 * 신호기가 없는 자리에서는 일찍부터 뜻을 보이고 거리로 나선다(`startWithin`). 신호기가 있는 자리에는
 * **무단횡단자만** 서는데(zoneCombinationAllowed), 그 사람은 **내 신호가 녹색이 되기 2~3초 전**에
 * 나서야 역할이 있다 — 그보다 이르면 내가 서 있는 동안 다 건너고, 제 보행 녹색에 건너면 무단횡단이
 * 아니게 된다 (플레이테스트가 잡았다 — 50057번은 보행 녹색에 건너 '무단횡단' 이라는 제목과 어긋났다).
 *
 * 내 녹색은 위 오프셋에서 나온다 — 첫 번째 23초 · 두 번째 34초 · 세 번째 46초.
 */
const PED_AT: Record<'S' | 'A' | 'B', { signal: number; plain: number }> = {
  S: { signal: 20, plain: 2 },
  A: { signal: 31, plain: 2 },
  B: { signal: 43, plain: 2 },
};

const pedOf = (
  crosswalk: 'S' | 'A' | 'B',
  how: (typeof PEDS)[number],
  kind: ZoneTags['kind'],
  signalled: boolean,
): PedSpawn[] => {
  if (how === 'none') return [];
  const at = signalled ? PED_AT[crosswalk].signal : PED_AT[crosswalk].plain;
  const base = { crosswalk, from: 'right' as const, kind, startWithin: 12, at };
  if (how === 'waiting') return [base];
  if (how === 'crossing') return [{ ...base, startWithin: 18 }];
  // 무단횡단 — 지킬 신호가 있는데 지키지 않는다
  return [{ ...base, obeysSignal: false }];
};

const WHERE: Record<'S' | 'A' | 'B', string> = { S: '첫 번째', A: '두 번째', B: '세 번째' };

const titleOf = (t: ZoneTags): string => {
  const sig = SIGNAL_SETS[t.signals];
  const light = sig.length === 0 ? '신호등 없는 길' : `${sig.map((x) => WHERE[x]).join('·')} 신호등`;
  const who = { child: '어린이', adult: '어른', elder: '노인' }[t.kind];
  const people = (['S', 'A', 'B'] as const)
    .filter((at) => (at === 'S' ? t.sPed : at === 'A' ? t.aPed : t.bPed) !== 'none')
    .map((at) => WHERE[at]);
  return `어린이보호구역 - ${light} - ${people.length ? `${people.join('·')} 횡단보도 ${who}` : '보행자 없음'}`;
};

const briefOf = (t: ZoneTags): string => {
  const sig = SIGNAL_SETS[t.signals];
  return (
    '어린이보호구역 도로입니다. 교차로 없이 횡단보도 셋을 지납니다. ' +
    (sig.length === 0
      ? '세 곳 모두 신호기가 없습니다 — 보행자가 없어도 일시정지해야 합니다.'
      : `${sig.map((x) => WHERE[x]).join('·')} 횡단보도에만 신호기가 있습니다. 나머지는 신호기가 없어 보행자가 없어도 일시정지해야 합니다.`) +
    ' 보호구역에서는 차가 30km/h 이하로 스스로 줄입니다 — 언제 설지만 판단하세요.'
  );
};

const teachesOf = (t: ZoneTags): string => {
  const sig = SIGNAL_SETS[t.signals];
  const lines = [
    '신호기 없는 보호구역 횡단보도는 보행자의 통행 여부와 관계없이 일시정지합니다 (제27조 제7항).',
  ];
  if (sig.length) {
    lines.push('신호기가 있는 횡단보도의 적색은 서서 기다리는 것입니다 — 서고 나서 가는 것이 아닙니다.');
  }
  if (t.bPed !== 'none') lines.push('마지막 횡단보도까지가 보호구역입니다 — 다 왔다고 끝이 아닙니다.');
  return lines.join(' ');
};

/** 태그 하나를 판으로 — 화면 · 판정 · 검증기가 모두 이 스펙 하나를 본다 */
export function buildZoneSpec(t: ZoneTags, id: number): ScenarioSpec {
  const sig = SIGNAL_SETS[t.signals];
  const zoneSignals: Partial<Record<'S' | 'A' | 'B', number>> = {};
  for (const at of sig) zoneSignals[at] = ZONE_SIGNAL_OFFSET[at];
  return {
    id,
    drive: 'zoneOnly',
    title: titleOf(t),
    brief: briefOf(t),
    teaches: teachesOf(t),
    /*
      교차로가 없으므로 교차로 신호 주기는 쓰이지 않는다 — 값은 두되 판정도 화면도 보지 않는다
      (rules/lawRules.ts 의 trackZoneRoad · game/Intersection.ts 의 zoneOnly).
    */
    startPhase: 0,
    startPhaseElapsed: 0,
    pedSignalInstalled: { A: false, C: false },
    zoneSignals,
    pedestrians: [
      ...pedOf('S', t.sPed, t.kind, hasSignal(t, 'S')),
      ...pedOf('A', t.aPed, t.kind, hasSignal(t, 'A')),
      ...pedOf('B', t.bPed, t.kind, hasSignal(t, 'B')),
    ],
    crossTraffic: 0,
    exitBlocked: false,
    isSchoolZone: true,
    timeOfDay: 'day',
    weather: 'clear',
  };
}

let built: ScenarioSpec[] | null = null;

/** 이 코스의 모든 판 — 번호 순서(ZONE_NUMBER_BASE 부터)와 같다 */
export function zoneCourses(): ScenarioSpec[] {
  return (built ??= allCombinations().map((t, i) => buildZoneSpec(t, zoneId(i))));
}

export const isZoneCourseId = (id: number): boolean => id >= ZONE_ID_BASE;

/** id 로 찾기 — 이 코스의 판이 아니면 `undefined` */
export function zoneCourse(id: number): ScenarioSpec | undefined {
  return isZoneCourseId(id) ? zoneCourses()[id - ZONE_ID_BASE] : undefined;
}

/** 화면에서 부르는 번호 (50001~) */
export function zoneCourseNumber(id: number): number | undefined {
  return zoneCourse(id) ? ZONE_NUMBER_BASE + (id - ZONE_ID_BASE) : undefined;
}

/** 번호로 찾기 */
export function zoneCourseByNumber(no: number): ScenarioSpec | undefined {
  return zoneCourse(ZONE_ID_BASE + (no - ZONE_NUMBER_BASE));
}

// ── 추천이 고를 수 있게 ─────────────────────────────────────────────────────

/**
 * **이 판이 시험할 수 있는 위반** — 추천이 "이 습관을 고칠 판인가" 를 이것으로 본다.
 *
 * 우회전 코스의 `targets`(library.ts)와 같은 자리다. 직진 코스에는 **우회전에만 있는 습관이 없다** —
 * 방향지시등 · 대회전 · 교차로 서행은 여기서 일어날 수 없으므로 적지 않는다. 적어 두면 그 습관이
 * 보호구역 판 몇 번으로 '고쳐졌다' 가 된다.
 */
export function zoneTargets(t: ZoneTags): ViolationCode[] {
  const out = new Set<ViolationCode>();
  const sig = SIGNAL_SETS[t.signals];
  // 신호기 없는 횡단보도가 하나라도 있으면 '사람이 없어도 선다' 를 시험한다 (제27조 제7항)
  if (sig.length < 3) out.add('SCHOOL_ZONE_NO_STOP');
  // 신호기가 있으면 그 적색은 서서 기다리는 것이다
  if (sig.length > 0) out.add('SCHOOL_ZONE_RED');
  if (t.sPed !== 'none' || t.aPed !== 'none' || t.bPed !== 'none') out.add('PEDESTRIAN_BLOCKED');
  return [...out];
}

/**
 * **이 판이 얼마나 복잡한가** — 레벨을 매기는 기준. 겹친 조건의 수다 (difficulty.ts 의 costOf 와 같은 생각).
 */
function zoneCost(t: ZoneTags): number {
  let n = 0;
  // 신호기가 없는 자리마다 '사람이 없어도 선다' 를 스스로 판단해야 한다
  n += 3 - SIGNAL_SETS[t.signals].length;
  // 신호기가 있는 자리는 적색을 만날 수 있다
  n += SIGNAL_SETS[t.signals].length > 0 ? 1 : 0;
  for (const p of [t.sPed, t.aPed, t.bPed]) {
    if (p === 'none') continue;
    n += p === 'jaywalk' ? 2 : 1; // 무단횡단은 신호만 보고 가면 걸린다
  }
  if (t.kind !== 'adult') n += 1; // 어린이 · 노인은 걸음이 다르다
  return n;
}

/**
 * **추천이 쓰는 꼴로 판을 내준다** — 라이브러리 판과 같은 모양(LibraryEntry)이라
 * 후보 추리기 · 점수 매기기 · AI 프롬프트가 그대로 돈다 (scenarios/recommend.ts).
 *
 * ## 태그는 '비슷한 자리' 로 옮겨 적는다
 *
 * 태그 어휘는 우회전 코스에서 자란 것이라 이 코스의 모든 것을 담지 못한다. 그래서 **뜻이 가장 가까운
 * 자리**에 넣는다 — `a` 는 내가 **처음 만나는 횡단보도**, `c` 는 **마지막 횡단보도**. 가운데 횡단보도의
 * 보행자는 태그에 자리가 없다 — 이 값들은 추천이 "비슷한 판이 이어지지 않게" 고르는 데만 쓰이므로,
 * 하나가 빠져도 판 자체는 정확하다.
 */
export function zoneEntries(): LibraryEntry[] {
  return (entries ??= (() => {
    const tags = allCombinations();
    const built = tags.map((t, i) => {
      const spec = zoneCourses()[i];
      const libTags: LibraryTags = {
        // 교차로가 없는 길이라 '정면 신호' 도 없다 — 추천이 모양을 가르는 데만 쓰는 값이다
        signal: 'green',
        zone: 'yes',
        sigA: hasSignal(t, 'A') ? 'yes' : 'no',
        sigC: hasSignal(t, 'B') ? 'yes' : 'no',
        a: t.sPed === 'jaywalk' ? 'jaywalk' : t.sPed,
        c: t.bPed === 'jaywalk' ? 'jaywalk' : t.bPed,
        kind: t.kind,
        approach: hasSignal(t, 'S') ? 'signal' : 'noSignal',
        lead: 'none',
        pressure: 'calm',
        env: 'day',
        jam: 'none',
      };
      return { spec, tags: libTags, targets: zoneTargets(t), cost: zoneCost(t), level: 1 as Difficulty };
    });
    /*
      **쉬운 판부터 줄 세워 레벨마다 정원만큼 담는다** (library.ts 의 assignLevels 와 같은 규칙 · 같은 정원).
      레벨은 학습자와 함께 쓰는 하나뿐이라(사용자가 정했다), 같은 레벨이면 두 코스의 판이 비슷하게 어려워야 한다.
    */
    const sorted = [...built].sort((p, q) => p.cost - q.cost || p.spec.id - q.spec.id);
    const total = Object.values(LEVEL_SHARE).reduce((n, x) => n + x, 0);
    let at = 0;
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const) {
      const take = level === 10 ? sorted.length - at : Math.round((sorted.length * LEVEL_SHARE[level]) / total);
      for (const e of sorted.slice(at, at + take)) e.level = level;
      at += take;
    }
    return built;
  })());
}

let entries: LibraryEntry[] | null = null;

/** id 로 추천용 판 찾기 */
export function zoneEntry(id: number): LibraryEntry | undefined {
  return isZoneCourseId(id) ? zoneEntries()[id - ZONE_ID_BASE] : undefined;
}

/**
 * **오프라인 교육 시범에 넣을 보호구역 직진 코스 셋.**
 *
 * 우회전 시범(library.ts 의 demoCourses)에 없는 세 장면을 맡는다 — **신호등이 하나도 없는 보호구역 길**,
 * **한 곳에만 신호등이 있는 길**(적색은 서서 기다린다), **세 곳을 지나며 사람을 만나는 길**.
 * 합치는 일은 부르는 쪽이 한다 (main.ts) — 라이브러리와 서로를 부르지 않게.
 */
export function zoneDemoCourses(): LibraryEntry[] {
  const want: Partial<ZoneTags>[] = [
    // 신호등이 하나도 없는 길 — 사람이 없어도 세 곳 모두에서 선다
    { signals: 0, sPed: 'none', aPed: 'none', bPed: 'none' },
    // 가운데만 신호등 — 적색은 서서 기다리고, 나머지 둘은 신호가 없어 스스로 선다
    { signals: 2, sPed: 'none', aPed: 'none', bPed: 'none' },
    // 사람이 있는 길 — 첫 곳에 기다리는 아이, 마지막 곳에 건너는 아이
    { signals: 0, sPed: 'waiting', aPed: 'none', bPed: 'crossing', kind: 'child' },
  ];
  const tags = allCombinations();
  const entries = zoneEntries();
  return want
    .map((w) => {
      const i = tags.findIndex((t) => (Object.keys(w) as (keyof ZoneTags)[]).every((k) => t[k] === w[k]));
      if (i < 0) throw new Error(`시범 코스가 없습니다: ${JSON.stringify(w)}`);
      return entries[i];
    })
    .sort((p, q) => p.level - q.level || p.cost - q.cost);
}
