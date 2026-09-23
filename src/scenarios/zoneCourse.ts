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
  /*
    **신호기가 있는 횡단보도에서는 무단횡단자만 나와 마주친다.**

    직진 코스에서 내가 지나는 횡단보도(A · B)의 보행신호는 **내 정면이 적색일 때만 녹색**이다 —
    신호를 지키는 사람은 내가 서 있는 동안 건너고, 내가 갈 때는 연석에 서 있다. 그래서 신호기가 있는
    자리에 '건너는 중' · '건너려고 서 있음' 을 두면 **아무 일도 일어나지 않는 판**이 된다
    (플레이테스트가 잡았다 — 50106번은 건너편에 어린이를 세워 두고도 그 아이가 끝내 나서지 않았다).

    진입로 보호구역 횡단보도(S)도 같다 — 거기 신호기가 있으면 그 사람의 녹색은 내 적색이다.

    예외는 **교차로 앞 횡단보도(A)에 내 정면이 적색일 때**다. 그때는 내가 정지선에 서 있고 사람은
    제 녹색에 건넌다 — 신호가 바뀌어도 **다 건널 때까지 기다려야 한다**는 것이 그 판의 배울 거리다.
  */
  if (t.sPed !== 'none' && t.sPed !== 'jaywalk' && t.sSignal === 'signal') return false;
  if (t.bPed !== 'none' && t.bPed !== 'jaywalk' && t.abSignal === 'yes') return false;
  /*
    **교차로 앞 횡단보도(A)의 사람은 신호기가 없을 때만 둔다.**

    신호기가 있으면 그 사람의 녹색은 **내 적색과 겹친다** — 내가 정지선에 서 있는 동안 건너고,
    그들의 녹색이 끝나는 25초에 마지막으로 나서도 내 녹색(30초)에는 이미 다 건넌 뒤다. 실제로
    달려 보니 0.1초 차이로 스쳐, 보행자를 보지 않는 운전자조차 걸리지 않았다 (50125번).
    **아무 일도 일어나지 않는 판**이므로 조합에서 뺀다 — 신호기 없는 A 에서는 언제든 건너므로 역할이 있다.
  */
  if (t.aPed === 'crossing' && t.abSignal === 'yes') return false;
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
  /*
    **'정면 녹색' 판은 녹색이 막 시작한 자리에서 만난다.**

    녹색은 34초뿐인데 보호구역 진입로를 지나 정지선까지 20~25초가 걸리고, 그 사이 보행자를 보내면
    녹색이 끝난다 — 규정대로 몬 운전자가 **사람을 다 보내고 나서 30초를 더 서 있는** 판이 나왔다
    (플레이테스트가 잡았다 — 50028번, 한 자리에서 30초 · 전체 80초). 적색에서 시작해 15초쯤 녹색이
    되게 하면, 내가 닿을 때 갓 켜진 녹색이라 사람을 보내고도 여유가 남는다.
  */
  green: { startPhase: 5, startPhaseElapsed: 10 },
  /*
    적색 판은 **도착할 즈음 적색이고 곧 녹색이 되는 자리**에서 시작한다. 주기가 64초라 아무 데서나
    적색을 만나면 30초 가까이 서 있게 되는데, 그러면 배우는 것 없이 기다리기만 하는 판이 된다.

    도착 시각은 진입로 신호기가 있는지에 따라 갈린다 — 있으면 그 신호를 한 번 더 기다리므로 10초쯤 늦다.
    그래서 **두 자리를 따로 둔다**. 실제로 달려 보고 맞춘 값이다 (자율 주행 전수 측정).
  */
  red: { startPhase: 3, startPhaseElapsed: 0 },
  redAfterZoneSignal: { startPhase: 2, startPhaseElapsed: 4 },
} as const;

const pedOf = (
  crosswalk: PedSpawn['crosswalk'],
  how: (typeof PEDS)[number] | (typeof A_PEDS)[number],
  kind: ZoneTags['kind'],
  startWithin: number,
  /**
   * **나서는 때**(초). 거리 방아쇠와 함께 걸린다 — 시각이 지나고 거리도 가까워야 나선다.
   *
   * 적색 판의 교차로 앞 보행자에게 늦은 시각을 준다. 적색에는 **누구나 정지선에 서 있으므로**,
   * 그 사이에 다 건너 버리면 그 사람은 아무 역할이 없다 (플레이테스트가 잡았다 — 50060번).
   * 녹색이 될 즈음 나서면 "신호가 바뀌어도 아직 건너는 사람이 있으면 기다린다" 를 배우게 된다.
   */
  at = 2,
): PedSpawn[] => {
  if (how === 'none') return [];
  const base = { crosswalk, from: 'right' as const, kind, startWithin, at };
  /*
    `at` 은 거리 방아쇠와 **함께** 걸린다 (scenarios.ts 의 PedSpawn) — 시각이 지나고 거리도 가까워야
    나선다. 여기서는 거리로만 연출하고 싶으므로 시각은 일찍 열어 둔다.
  */
  if (how === 'waiting') return [base];
  if (how === 'crossing') return [{ ...base, startWithin: startWithin + 6 }];
  // 무단횡단 — 지킬 신호가 있는데 지키지 않는다
  return [{ ...base, obeysSignal: false }];
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
    ...PHASE[t.start === 'red' ? (t.sSignal === 'signal' ? 'redAfterZoneSignal' : 'red') : 'green'],
    // C 는 이 코스에서 지나지 않는다 — 값은 두되 판정이 보지 않는다 (drive: 'straight')
    pedSignalInstalled: { A: t.abSignal === 'yes', C: true },
    /*
      **신호기가 있는 진입로는 적색으로 맞이한다.**

      `signalElapsed` 가 6 일 때는 도착(9초쯤)에 늘 녹색이라, '보호구역 횡단보도의 적색은 서서 기다리는
      것' 을 한 번도 못 가르쳤다 (플레이테스트가 잡았다 — 50155번). 주기(녹18 · 황3 · 적18)에서
      **적색 구간의 4초째**(25 = 18+3+4)에서 시작하면, 도착할 즈음 적색이고 14초쯤 녹색이 된다.
    */
    approachSchoolZone: { signal: t.sSignal === 'signal', signalElapsed: 25 },
    pedestrians: [
      /*
        **신호기가 있는 진입로의 무단횡단자는 내가 출발할 즈음 나선다.** 적색에 맞이하는 판이라
        (아래 approachSchoolZone) 내가 서 있는 동안 건너면 아무 역할이 없다 — 녹색이 되는 14초쯤에
        나서야 "신호가 녹색이어도 사람이 있으면 선다" 를 배운다 (플레이테스트가 잡았다 — 50171번).
      */
      ...pedOf('S', t.sPed, t.kind, 12, t.sSignal === 'signal' ? 15 : 2),
      /*
        **교차로 앞 횡단보도의 사람은 내 신호가 녹색이 될 즈음 건넌다** (위 pedOf 의 `at`).

        적색에는 누구나 정지선에 서 있으므로, 그 사이에 다 건너면 아무 역할이 없다. 그래서 **내 녹색이
        켜지기 4초쯤 전**에 나서게 한다 — 늦게 건너는 사람이 실제로 가장 위험한 장면이다.

        내 녹색이 언제 켜지는지는 **진입로 신호기가 있느냐**에 달렸다. 있으면 그 신호를 한 번 더 기다리느라
        10초쯤 늦게 도착하므로 시작 위상도 그만큼 뒤에 두었다(아래 PHASE) — 녹색이 30초가 아니라 40초에 온다.
      */
      ...pedOf('A', t.aPed, t.kind, 12, t.start === 'red' ? (t.sSignal === 'signal' ? 36 : 26) : 2),
      ...pedOf('B', t.bPed, t.kind, 12),
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

/**
 * **오프라인 교육 시범에 넣을 보호구역 직진 코스 셋.**
 *
 * 우회전 시범(library.ts 의 demoCourses)에 없는 세 장면을 맡는다 — **사람이 없어도 서는 무신호
 * 횡단보도**, **적색에는 직진이 아예 안 된다**(우회전과 정반대다), **교차로를 지난 뒤의 횡단보도도
 * 보호구역이다**. 합치는 일은 부르는 쪽이 한다 (main.ts) — 라이브러리와 서로를 부르지 않게.
 */
export function zoneDemoCourses(): LibraryEntry[] {
  const want: Partial<ZoneTags>[] = [
    { sSignal: 'noSignal', start: 'green', sPed: 'none', aPed: 'none', bPed: 'none' },
    { sSignal: 'noSignal', start: 'red', sPed: 'none', aPed: 'none', bPed: 'none' },
    { sSignal: 'noSignal', start: 'green', sPed: 'waiting', aPed: 'none', bPed: 'crossing', kind: 'child' },
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
