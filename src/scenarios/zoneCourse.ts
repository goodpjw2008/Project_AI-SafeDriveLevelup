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
 * 방향지시등은 묻지 않고(돌지 않으므로), **속도는 학습자가 0 · 10 · 20 · 30km/h 로 고른다**
 * (game/Controls.ts). 교차로 코스에서는 지금처럼 차가 알아서 맞춘다.
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

/** 진입로 보호구역 횡단보도(S)에 신호기가 있는가 */
const S_SIGNALS = ['noSignal', 'signal'] as const;
/** 교차로 횡단보도(A·B)에 보행신호기가 있는가 */
const AB_SIGNALS = ['no', 'yes'] as const;
/** 교차로에 닿을 때의 정면 차량신호 */
const STARTS = ['green', 'red'] as const;
/**
 * 횡단보도마다 사람이 어떻게 있는가.
 *
 *  - `none` — 아무도 없다. **무신호 횡단보도에서는 이것이 핵심이다** (제27조 제7항 — 사람이 없어도 선다)
 *  - `waiting` — 연석에서 건너려고 서 있다 (신호기 없는 곳에서만)
 *  - `crossing` — 이미 건너고 있다
 *  - `jaywalk` — 보행 적색인데 건넌다 (신호기가 있는 곳에서만 '무단횡단' 이라는 말이 성립한다)
 */
const PEDS = ['none', 'waiting', 'crossing', 'jaywalk'] as const;
const A_PEDS = ['none', 'crossing'] as const;
const KINDS = ['child', 'adult', 'elder'] as const;

export interface ZoneTags {
  sSignal: (typeof S_SIGNALS)[number];
  abSignal: (typeof AB_SIGNALS)[number];
  start: (typeof STARTS)[number];
  sPed: (typeof PEDS)[number];
  aPed: (typeof A_PEDS)[number];
  bPed: (typeof PEDS)[number];
  kind: (typeof KINDS)[number];
}

/**
 * 성립하는 조합인가 — **판의 글이 거짓말이 되는 조합**을 여기서 뺀다 (library.ts 의 combinationAllowed 와 같은 자리).
 */
export function zoneCombinationAllowed(t: ZoneTags): boolean {
  // '무단횡단' 은 지킬 신호가 있을 때만 성립한다
  if (t.sPed === 'jaywalk' && t.sSignal !== 'signal') return false;
  if (t.bPed === 'jaywalk' && t.abSignal !== 'yes') return false;
  // 신호기가 있는 횡단보도에서 '연석에서 기다림' 은 신호를 기다리는 것이라 판이 달라진다 — 무신호에서만 쓴다
  if (t.sPed === 'waiting' && t.sSignal === 'signal') return false;
  if (t.bPed === 'waiting' && t.abSignal === 'yes') return false;
  /*
    **A 를 건너는 사람은 내 차량신호가 적색일 때다.** 신호기가 있으면 A 의 보행신호는 내 정면이
    적색일 때 녹색이다 — 녹색에 건너는 사람을 두면 그 사람은 무단횡단자가 되어 제목과 어긋난다.
  */
  if (t.aPed === 'crossing' && t.abSignal === 'yes' && t.start !== 'red') return false;
  // 사람이 아무도 없으면 나이는 아무 뜻이 없다 — 같은 판을 셋으로 늘리지 않는다
  if (t.sPed === 'none' && t.aPed === 'none' && t.bPed === 'none' && t.kind !== 'child') return false;
  return true;
}

const allCombinations = (): ZoneTags[] => {
  const out: ZoneTags[] = [];
  for (const sSignal of S_SIGNALS)
    for (const abSignal of AB_SIGNALS)
      for (const start of STARTS)
        for (const sPed of PEDS)
          for (const aPed of A_PEDS)
            for (const bPed of PEDS)
              for (const kind of KINDS) {
                const t = { sSignal, abSignal, start, sPed, aPed, bPed, kind };
                if (zoneCombinationAllowed(t)) out.push(t);
              }
  return out;
};

export const zoneId = (i: number): number => ZONE_ID_BASE + i;

/**
 * **신호 주기 안에서 어디쯤 출발할까.**
 *
 * 직진은 적색에 갈 수 없으므로(rules/violations.ts 의 STRAIGHT_RED) 적색 판은 **기다리는 시간**이
 * 곧 판의 길이가 된다. 보호구역 진입로가 174m 라 거기서만 이미 20초가 걸리므로, 적색은
 * **곧 녹색이 되는 자리**에서 만나게 한다 — 100초 제한 안에 들어오고, 기다림도 배움으로 남는다.
 */
const PHASE = {
  green: { startPhase: 0, startPhaseElapsed: 2 },
  red: { startPhase: 5, startPhaseElapsed: 14 },
} as const;

const pedOf = (
  crosswalk: PedSpawn['crosswalk'],
  how: (typeof PEDS)[number] | (typeof A_PEDS)[number],
  kind: ZoneTags['kind'],
  startWithin: number,
): PedSpawn[] => {
  if (how === 'none') return [];
  const base = { crosswalk, from: 'right' as const, kind, startWithin };
  /*
    `at` 은 거리 방아쇠와 **함께** 걸린다 (scenarios.ts 의 PedSpawn) — 시각이 지나고 거리도 가까워야
    나선다. 여기서는 거리로만 연출하고 싶으므로 시각은 일찍 열어 둔다.
  */
  if (how === 'waiting') return [{ ...base, at: 2 }];
  if (how === 'crossing') return [{ ...base, at: 1, startWithin: startWithin + 6 }];
  // 무단횡단 — 지킬 신호가 있는데 지키지 않는다
  return [{ ...base, at: 2, obeysSignal: false }];
};

const titleOf = (t: ZoneTags): string => {
  const where: string[] = [];
  if (t.sPed !== 'none') where.push('진입로');
  if (t.aPed !== 'none') where.push('교차로 앞');
  if (t.bPed !== 'none') where.push('건너편');
  const who = { child: '어린이', adult: '어른', elder: '노인' }[t.kind];
  const sig = t.sSignal === 'noSignal' ? '진입로 무신호' : '진입로 신호';
  const light = t.start === 'red' ? '정면 적색' : '정면 녹색';
  const people = where.length ? `${where.join('·')} ${who}` : '보행자 없음';
  return `보호구역 직진 - ${sig} · ${light} - ${people}`;
};

const briefOf = (t: ZoneTags): string =>
  '어린이보호구역입니다. 우회전하지 않고 곧장 통과하세요. ' +
  (t.sSignal === 'noSignal'
    ? '진입로 횡단보도에는 신호기가 없습니다 — 보행자가 없어도 일시정지해야 합니다.'
    : '진입로 횡단보도의 신호를 확인하세요.') +
  ' 속도는 ↑ · ↓ 로 직접 고릅니다 (최대 30km/h).';

const teachesOf = (t: ZoneTags): string => {
  const lines = [
    t.sSignal === 'noSignal'
      ? '신호기 없는 보호구역 횡단보도는 보행자의 통행 여부와 관계없이 일시정지합니다 (제27조 제7항).'
      : '보호구역 횡단보도의 차량신호가 적색이면 서서 기다립니다 — 서고 나서 가는 것이 아닙니다.',
  ];
  if (t.start === 'red') {
    lines.push('직진은 적색에 통과할 수 없습니다. 우회전과 달리 일시정지 후 통행이 허용되지 않습니다.');
  }
  if (t.bPed !== 'none') {
    lines.push('교차로를 지난 뒤의 횡단보도도 같은 보호구역입니다 — 통과했다고 끝이 아닙니다.');
  }
  return lines.join(' ');
};

/** 태그 하나를 판으로 — 화면 · 판정 · 검증기가 모두 이 스펙 하나를 본다 */
export function buildZoneSpec(t: ZoneTags, id: number): ScenarioSpec {
  return {
    id,
    drive: 'straight',
    title: titleOf(t),
    brief: briefOf(t),
    teaches: teachesOf(t),
    ...PHASE[t.start],
    // C 는 이 코스에서 지나지 않는다 — 값은 두되 판정이 보지 않는다 (drive: 'straight')
    pedSignalInstalled: { A: t.abSignal === 'yes', C: true },
    approachSchoolZone: { signal: t.sSignal === 'signal', signalElapsed: 6 },
    pedestrians: [
      ...pedOf('S', t.sPed, t.kind, 16),
      ...pedOf('A', t.aPed, t.kind, 14),
      ...pedOf('B', t.bPed, t.kind, 14),
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
  // 신호기 없는 보호구역 횡단보도 — 진입로든 교차로든 (제27조 제7항)
  if (t.sSignal === 'noSignal' || t.abSignal === 'no') out.add('SCHOOL_ZONE_NO_STOP');
  // 신호기 있는 진입로 횡단보도의 적색 — 서서 기다려야 한다
  if (t.sSignal === 'signal') out.add('SCHOOL_ZONE_RED');
  // 직진은 적색에 갈 수 없다
  if (t.start === 'red') out.add('STRAIGHT_RED');
  if (t.sPed !== 'none' || t.aPed !== 'none' || t.bPed !== 'none') out.add('PEDESTRIAN_BLOCKED');
  return [...out];
}

/**
 * **이 판이 얼마나 복잡한가** — 레벨을 매기는 기준. 겹친 조건의 수다 (difficulty.ts 의 costOf 와 같은 생각).
 */
function zoneCost(t: ZoneTags): number {
  let n = 0;
  if (t.sSignal === 'noSignal') n += 1; // 사람이 없어도 서야 하는 자리
  if (t.abSignal === 'no') n += 1;
  if (t.start === 'red') n += 1;
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
 * 자리**에 넣는다 — `a` 는 내가 **처음 만나는 횡단보도**(여기서는 진입로 S), `c` 는 **마지막 횡단보도**
 * (여기서는 교차로 건너편 B). 교차로 앞 횡단보도(A)의 보행자는 태그에 자리가 없다 — 이 값들은 추천이
 * "비슷한 판이 이어지지 않게" 고르는 데만 쓰이므로, 하나가 빠져도 판 자체는 정확하다.
 */
export function zoneEntries(): LibraryEntry[] {
  return (entries ??= (() => {
    const tags = allCombinations();
    const built = tags.map((t, i) => {
      const spec = zoneCourses()[i];
      const libTags: LibraryTags = {
        signal: t.start === 'red' ? 'red' : 'green',
        zone: 'yes',
        sigA: t.abSignal,
        sigC: t.abSignal,
        a: t.sPed === 'jaywalk' ? 'jaywalk' : t.sPed,
        c: t.bPed === 'jaywalk' ? 'jaywalk' : t.bPed,
        kind: t.kind,
        approach: t.sSignal === 'signal' ? 'signal' : 'noSignal',
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
