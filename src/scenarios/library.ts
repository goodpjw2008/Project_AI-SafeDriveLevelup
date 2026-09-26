/**
 * **시나리오 라이브러리** — 우회전 · 어린이보호구역에서 판단을 가르는 변수를 빠짐없이 조합한 판 모음.
 *
 * AI 가 학습자에게 맞는 판을 **고르려면** 고를 판이 충분히 많아야 한다(recommend.ts). 그래서 이 게임이
 * 가르치는 변수를 모두 곱해 판을 만들고, **검증을 통과한 조합만** 싣는다.
 *
 * ## 축
 *
 *  | 축 | 값 | 법규상 무엇이 갈리는가 |
 *  |---|---|---|
 *  | 전방 신호 `signal` | 정면 녹색 · 정면 적색 · 우회전신호 적색 · 우회전신호 녹색 | 적색은 정지 후 진행, 우회전 신호등은 그 등화만 따른다 |
 *  | 교차로 보호구역 `zone` | 아님 · 보호구역 | 30km/h, 신호기 없는 횡단보도 무조건 일시정지(제27조 제7항) |
 *  | 첫 횡단보도 신호기 `sigA` | 있음 · 없음 | 신호기 없는 보호구역 횡단보도는 사람이 없어도 선다 |
 *  | 우회전 후 횡단보도 신호기 `sigC` | 있음 · 없음 | 〃 |
 *  | 첫 횡단보도 보행자 `a` | 없음 · 건너려고 대기 · 건너는 중 · 무단횡단 | "통행하려고 하는 때" 도 정지(제27조 제1항) |
 *  | 우회전 후 보행자 `c` | 없음 · 건너려고 대기 · 건너는 중 · 무단횡단 · 여럿 · 돌 때 뛰어듦 · 나올 수도 있음 | 〃, 통행 종료까지 |
 *  | 보행자 종류 `kind` | 어른 · 어린이 · 노인 | 어린이는 빠르고 작다, 노인은 오래 건넌다 |
 *  | 진입로 보호구역 `approach` | 없음 · 신호 있음 · 신호 없음 | 교차로 전 보호구역 횡단보도(S) |
 *  | 앞차 `lead` | 없음 · 규정대로 우회전 · 일시정지 건너뜀 · 직진 대기 | "앞차가 가니까" 는 이유가 안 된다 |
 *  | 뒤차 재촉 `pressure` | 없음 · 경적 | 재촉을 받아도 선다 |
 *  | 환경 `env` | 낮 · 밤 · 비 | 보행자가 늦게 보인다 |
 *  | 진출로 정체 `jam` | 없음 · 꼬리물기 상황 | 막혔으면 들어가지 않는다(제25조 제5항) |
 *
 * 법규상 · 신호 구조상 **성립하지 않는 조합은 만들지 않는다** (`combinationAllowed`). 나머지는
 * **검증기(validate.ts)가 AI 판과 똑같이** 거른다 — 모범 운전자가 통과할 수 있고, 난폭 운전자가
 * 걸리는 판만 남는다 (tests/library.*.test.ts).
 *
 * ## id
 *
 * 조합에서 **계산한다** (`LIBRARY_ID_BASE` + 축 번호를 자리마다 적은 수). 주행 기록이 id 로
 * 묶이므로, 값을 더할 때는 **각 축 배열의 끝에만** 붙인다.
 *
 * **순수 모듈이다** — 화면·저장·네트워크를 쓰지 않는다. 같은 입력이면 늘 같은 라이브러리가 나온다.
 */

import type { CrosswalkId } from '../rules/lawRules';
import type { ViolationCode } from '../rules/violations';
import { costOf } from './difficulty';
import type { Difficulty } from './curriculum';
import {
  APPROACH_EXTRA,
  APPROACH_SIGNAL_ELAPSED,
  LIBRARY_ID_BASE,
  STANDARD_PROGRAM,
  fitStraightLeadWait,
  leadSpecFor,
  type LeadPlan,
  type PedSpawn,
  type ScenarioSpec,
  type TimeOfDay,
  type Weather,
} from './scenarios';

// ── 축 ──────────────────────────────────────────────────────────────────────

export const SIGNALS = ['green', 'red', 'arrowRed', 'arrowGreen'] as const;
export const ZONES = ['no', 'yes'] as const;
export const SIG_AS = ['yes', 'no'] as const;
export const SIG_CS = ['yes', 'no'] as const;
/*
  **보행자는 두 갈래다 — 신호를 지키는 사람과 무단횡단하는 사람.** 둘 다 실제 도로에 있고, 운전자는 누가 어느
  쪽인지 미리 알 수 없다. 처음에는 무단횡단이 한 가지(다가올 때 이미 건너는 중)뿐이었다. 지키는 사람에게 있는
  "건너려고 서 있음" 이 무단횡단에는 없었고, 둘이 한 보도에 함께 선 장면도 없었다. 그래서 뒤에 둘을 붙였다.
  - `jaywalkWait` 무단횡단하려는 사람 — 적색인데 연석까지 나와 건너려는 뜻을 보이다가, 내가 다가가면 나선다
  - `mixed` 신호를 지키는 사람 + 무단횡단하는 사람 — 적색이면 한 사람은 기다리고 한 사람만 나선다 (우회전신호 적색 판의
    C 는 지키는 사람이 녹색에 먼저 건너고, 무단횡단자는 녹색 화살표에 맞춰 적색에 나선다)
  **값은 끝에 붙인다** — id 의 자리 값이 곧 배열 순서라, 앞에 끼우면 이미 있던 판의 id 가 바뀐다.
*/
/*
  **자전거는 첫 횡단보도에 세운다.** 사용자가 실제 도로 사진을 주며 넣자고 했다 — "횡단보도 끝에 저렇게
  나와 있는 곳은 자전거를 타고 통행이 가능해. 반대로 하얀색 선에서는 자전거를 끌고 가야 해."

   - `bikeRide` — 옆에 **자전거횡단도**(붉은 띠 + 자전거 표시)가 있어 **타고** 건넌다. 걸음의 두 배 넘게
     빨라 멀리 있다고 먼저 지나가면 닿는다. 제15조의2 제3항의 **일시정지 대상**이다
   - `bikePush` — 자전거횡단도가 없어 **내려서 끌고** 건넌다 (제13조의2 제6항). 끌고 가는 사람은
     **보행자**이므로(제2조 제17호) 판정도 보행자 그대로다

  **우회전 후 횡단보도(C)가 아니라 첫 횡단보도(A)에 둔다.** id 는 축마다 한 자리를 쓰는데
  (`libraryId`) C 축은 이미 값이 열 개라 더 넣을 자리가 없다. A 축은 이 둘로 **정확히 열 개**가 된다 —
  여기에 더 붙이려면 id 체계부터 손봐야 한다 (tests/library.test.ts 가 울타리다).
*/
export const A_PEDS = [
  'none',
  'waiting',
  'crossing',
  'jaywalk',
  'jaywalkWait',
  'mixed',
  'bothWays',
  'crowd',
  'bikeRide',
  'bikePush',
] as const;
export const C_PEDS = ['none', 'waiting', 'crossing', 'jaywalk', 'group', 'late', 'maybe', 'jaywalkWait', 'mixed', 'crowd'] as const;

/*
  **건너는 방향과 사람 수도 판을 가른다** (사용자가 정했다: "우회전 맵에서도 아래 상황을 반영해 줘 —
  보행자 좌→우, 보행자 우→좌, 보행자 양방향, 보행자 명수").

  방향은 이미 판마다 갈린다 — `pedestriansAlone` 의 `side(k)` 가 판 번호로 좌우를 뒤집는다(첫 횡단보도는
  좌 39% · 우 40%). 없던 것은 **양방향**과 **셋 이상**이다. 첫 횡단보도에는 둘이 같이 건너는 장면 자체가
  없었고(`mixed` 는 한 사람이 서 있기만 한다), 어느 횡단보도에도 셋은 없었다.

   - `bothWays` (첫 횡단보도) — **양쪽 연석에서 한 사람씩 동시에** 건넌다. 한쪽을 보내고 출발하면 걸린다
   - `crowd` (양쪽 횡단보도) — **한쪽에서 셋**이 차례로 건넌다. 앞사람이 지나갔다고 끝이 아니다

  우회전 후 횡단보도의 `group` 이 이미 양방향 둘이라, 그쪽에는 `bothWays` 를 두지 않는다 — 같은 장면이
  두 값으로 갈리면 판만 늘고 배우는 것은 늘지 않는다 (보호구역 전용 도로에서 겪은 일이다).
*/

/*
  **더 복잡한 판 — 덧붙이는 사람들** (사용자가 정했다, 2026-09-26: "라이브러리에 새 축을 더해줘. 더 복잡한 케이스가 필요해").

  A · C 축은 값이 열 개로 꽉 차 있고, 자전거 판은 첫 횡단보도 하나로 끝내는 규칙이라(combinationAllowed) **자전거와 다른
  사람이 한 판에 서는 장면 · 타는 자전거와 끄는 자전거가 함께 있는 장면 · 다섯 사람**이 없었다. 그래서 열셋째 축을 둔다 —
  기본 조합 위에 **사람을 덧붙이는** 축이다.

   - `rideA` · `pushA` — 첫 횡단보도에 타고 건너는 자전거 · 끌고 건너는 사람이 **기존 사람들과 함께** 선다
   - `rideC` · `pushC` — 우회전 후 횡단보도에 같은 것 (자전거횡단도가 C 에 붙는다, layout 의 bikeLaneCenter('C'))
   - `rideApushC` — 첫 횡단보도 타는 자전거 + 우회전 후 끌고 가는 사람
   - `rideCpushC` — 우회전 후 횡단보도에 타는 자전거와 끌고 가는 사람이 함께
   - `pedS` — 진입로 보호구역 무신호 횡단보도의 어린이가 **첫 횡단보도에 사람이 있어도** 선다 (hasApproachPed 는 첫
     횡단보도가 비었을 때만 세운다 — 그 판과 겹치지 않게 첫 횡단보도에 사람이 있는 판에만 둔다)
   - `pedSrideCpushC` — 위의 둘을 겹친 것. 다섯 사람 + 자전거 둘까지 간다 (진입로 어린이 + 첫 횡단보도 둘 + 우회전 후 둘 + 자전거 둘)

  **id 의 맨 앞자리다** (AXES 의 첫 열쇠). 'none' 이 0 이라 이미 있던 판의 id 는 한 자리도 달라지지 않고, 번호는 ADDED_LATER 의
  마지막 세대라 맨 뒤에 선다. 값은 아홉이다 — 열 개까지 붙일 수 있고, 그 뒤는 축을 하나 더 두어야 한다.
  **맑은 낮의 조용한 판에만** 둔다 — 앞차 · 정체 · 경적 · 우회전 신호등 · 밤 · 비는 뺀다. 판이 묻는 것을 사람 쪽에 모으고
  (화살표 타이밍에 사람을 맞추는 규칙과 얽히지 않게), 라이브러리가 필요 이상 불어나지 않게 한다 — 처음 밤 · 비까지 두었더니
  5,721판이 더해져 레벨 뼈대(L1 의 몫)가 흔들렸다. 한 횡단보도에 걷는 사람(끌고 가는 사람 포함)은 셋까지다 — 타는 자전거는
  자전거횡단도 위라 세지 않는다.
*/
export const EXTRAS = [
  'none',
  'rideA',
  'pushA',
  'rideC',
  'pushC',
  'rideApushC',
  'rideCpushC',
  'pedS',
  'pedSrideCpushC',
  /*
    **같은 쪽에서 한 사람 더** (사용자가 변수 설계를 다시 보며 정했다, 2026-09-27: "보행자가 2명일 경우 — 좌→우 1방향,
    우→좌 1방향, 양방향"). 한 사람이 서는 판(건너려는 · 건너는 · 무단횡단 · 무단횡단하려는)에 **같은 보도에서** 한 사람이
    더 차례로 나선다 — 양방향(`bothWays` · `group`)과 한쪽 셋(`crowd`) 사이의 빈자리다. 첫 횡단보도에 한 사람이 있으면
    거기에, 아니면 우회전 후 횡단보도에 붙는다. EXTRAS 의 열 번째 값이라 이 축은 이제 꽉 찼다.
  */
  'pair',
] as const;

/** `extra` 값을 풀어 읽는다 — 어디에 무엇을 덧붙이는가 */
export function extrasOf(t: { extra: (typeof EXTRAS)[number] }): {
  rideA: boolean;
  pushA: boolean;
  rideC: boolean;
  pushC: boolean;
  pedS: boolean;
  pair: boolean;
} {
  const x = t.extra;
  return {
    rideA: x === 'rideA' || x === 'rideApushC',
    pushA: x === 'pushA',
    rideC: x === 'rideC' || x === 'rideCpushC' || x === 'pedSrideCpushC',
    pushC: x === 'pushC' || x === 'rideApushC' || x === 'rideCpushC' || x === 'pedSrideCpushC',
    pedS: x === 'pedS' || x === 'pedSrideCpushC',
    pair: x === 'pair',
  };
}
export const APPROACHES = ['none', 'signal', 'noSignal'] as const;
export const LEADS = ['none', 'lawful', 'rolling', 'straight'] as const;
export const PRESSURES = ['calm', 'honk'] as const;
export const ENVS = ['day', 'night', 'rain'] as const;
export const JAMS = ['none', 'jam'] as const;

/**
 * **나중에 붙인 값 — 붙인 차례(세대)대로 쌓는다.** 이 값을 쓰는 판은 라이브러리 뒤쪽에 서서, 이미 있던 판의
 * 번호가 밀리지 않는다 (numberedTags).
 *
 * **세대를 나누는 까닭.** 한때 하나의 집합이었다. 그런데 거기에 값을 더 붙이자 새 판이 **먼저 붙인 값의 판들
 * 사이사이에** 끼어들어(조합을 세는 순서대로 서므로) 3,084판의 번호가 밀렸다 — 사용자가 부르던 번호가 다른
 * 판을 가리키게 된다. 세대로 쌓으면 새 판은 **언제나 맨 뒤**에 서고, 앞 세대끼리의 차례는 그대로다.
 */
const ADDED_LATER: ReadonlyArray<{ [K in keyof LibraryTags]?: ReadonlySet<string> }> = [
  // 1세대 — 무단횡단하려는 사람 · 신호 지키는 사람과 함께 선 무단횡단자
  { a: new Set(['jaywalkWait', 'mixed']), c: new Set(['jaywalkWait', 'mixed']) },
  // 2세대 — 양방향 둘 · 한쪽에서 셋 (건너는 방향과 사람 수)
  { a: new Set(['bothWays', 'crowd']), c: new Set(['crowd']) },
  // 3세대 — 자전거 (타고 건넘 · 끌고 건넘)
  { a: new Set(['bikeRide', 'bikePush']) },
  // 4세대 — 덧붙이는 사람들 (EXTRAS). 'pair' 는 값 목록의 끝이라 같은 세대 안에서 뒤에 선다
  { extra: new Set(EXTRAS.filter((v) => v !== 'none')) },
  // 5세대 — 건너는 방향의 거울상 (SIDES)
  { side: new Set(['flip']) },
];
export const KINDS = ['adult', 'child', 'elder'] as const;

/*
  **건너는 방향 — 열넷째 축** (사용자가 정했다, 2026-09-27: "방향(좌→우 · 우→좌 · 양방향)을 축으로 올릴지 → 꼭 필요함").

  예전에는 사람이 어느 보도에서 오는지를 판 번호의 해시로 정했다 — 같은 모양은 늘 같은 쪽이었고, 반대쪽은 다른 모양의
  판에서나 만났다. 이제는 같은 모양을 **두 방향으로 다 겪는다**: `auto` 는 지금까지 그대로(해시가 정한 쪽), `flip` 은 그 판의
  **모든 사람을 반대쪽 보도로** 옮긴 거울상이다. 사람마다 새로 뽑지 않고 거울로 뒤집는 까닭은, 두 판이 방향 말고는 정확히
  같아야 "방향만 다르면 무엇이 달라지는가" 를 비교할 수 있기 때문이다 (환경 · 교차 차량도 쌍둥이 판의 값을 그대로 쓴다).

  **id 의 맨 앞자리다** — 'auto' 가 0 이라 이미 있던 판의 id 는 그대로이고, 번호는 ADDED_LATER 의 마지막 세대(5)라 맨 뒤에 선다.
  거울로 뒤집어도 같은 장면(사람이 없거나, 양쪽에 같은 사람이 서는 판)은 `flip` 을 만들지 않는다 (allCombinations 의 flipMatters)
  — 같은 판이 둘이면 판만 늘고 배우는 것은 늘지 않는다. 제목에는 실제 방향을 적는다 (titleOf 의 sidePhrases).
*/
export const SIDES = ['auto', 'flip'] as const;

export interface LibraryTags {
  /** 건너는 방향 — id 의 맨 앞자리 (SIDES 주석) */
  side: (typeof SIDES)[number];
  /** 덧붙이는 사람들 — id 의 둘째 자리 (EXTRAS 주석) */
  extra: (typeof EXTRAS)[number];
  signal: (typeof SIGNALS)[number];
  zone: (typeof ZONES)[number];
  sigA: (typeof SIG_AS)[number];
  sigC: (typeof SIG_CS)[number];
  a: (typeof A_PEDS)[number];
  c: (typeof C_PEDS)[number];
  kind: (typeof KINDS)[number];
  approach: (typeof APPROACHES)[number];
  lead: (typeof LEADS)[number];
  pressure: (typeof PRESSURES)[number];
  env: (typeof ENVS)[number];
  jam: (typeof JAMS)[number];
}

/** 축 이름 → 값 목록. **id 의 자리 순서이기도 하다** — 순서를 바꾸면 id 가 바뀐다 */
export const AXES: { [K in keyof LibraryTags]: readonly LibraryTags[K][] } = {
  // 맨 앞자리 — 'auto' 가 0 이라 이미 있던 열세 자리 id 가 그대로다
  side: SIDES,
  // 둘째 자리 — 'none' 이 0 이라 이미 있던 열두 자리 id 가 그대로다
  extra: EXTRAS,
  signal: SIGNALS,
  zone: ZONES,
  sigA: SIG_AS,
  sigC: SIG_CS,
  a: A_PEDS,
  c: C_PEDS,
  kind: KINDS,
  approach: APPROACHES,
  lead: LEADS,
  pressure: PRESSURES,
  env: ENVS,
  jam: JAMS,
};
const AXIS_KEYS = Object.keys(AXES) as (keyof LibraryTags)[];

export interface LibraryEntry {
  spec: ScenarioSpec;
  tags: LibraryTags;
  /** 이 판이 **잡아낼 수 있는** 위반 — AI 추천이 약점과 맞춰 보는 값이다 */
  targets: ViolationCode[];
  /** 난이도 점수 (difficulty.ts 의 costOf, 약점 할인 없이) */
  cost: number;
  /** 이 판이 속한 레벨 — 쉬운 판부터 줄 세워 레벨마다 정원만큼 담은 자리 (`assignLevels`) */
  level: Difficulty;
}

/** 라이브러리 판의 id 는 여기서부터다 — 손으로 쓴 판(1~)·AI 가 만든 판(100~)과 겹치지 않는다 (값은 scenarios.ts) */
export { LIBRARY_ID_BASE };

export function libraryId(t: LibraryTags): number {
  // 축마다 한 자리(10)를 쓴다 — 값을 더해도 이미 있던 id 가 밀리지 않는다
  return LIBRARY_ID_BASE + AXIS_KEYS.reduce((n, k) => n * 10 + (AXES[k] as readonly string[]).indexOf(t[k]), 0);
}

export const isLibraryId = (id: number): boolean => id >= LIBRARY_ID_BASE;

// ── 조합 규칙 ────────────────────────────────────────────────────────────────

const hasArrow = (t: LibraryTags): boolean => t.signal === 'arrowRed' || t.signal === 'arrowGreen';
/** A 보행신호가 녹색인 구간인가 — 정면 적색(동서 직진)일 때뿐이다 */
const pedAGreen = (t: LibraryTags): boolean => t.signal === 'red';
/**
 * C 보행신호가 녹색인 구간인가 — 정면 녹색 · 우회전신호 적색(0·1번 구간)일 때뿐이다.
 *
 * **우회전신호 적색은 출발할 때만 녹색이다.** 정지선에서 녹색 화살표를 기다리는 동안 C 는 적색으로 바뀐다 —
 * 그래서 그 판의 C 보행자는 화살표에 맞춰 신호를 어기고 건너게 둔다 (pedestriansOf 의 arrowGreenAt).
 */
const pedCGreen = (t: LibraryTags): boolean => t.signal === 'green' || t.signal === 'arrowRed';
const hasPeds = (t: LibraryTags): boolean => t.a !== 'none' || t.c !== 'none';

/**
 * 법규상 · 신호 구조상 **성립하는** 조합인가.
 *
 * 여기서 빼는 것은 "검증기가 걸러 줄 것" 이 아니라 **판의 글이 거짓말이 되는** 조합이다.
 * 예컨대 신호기가 있는 첫 횡단보도에서 정면 녹색에 "보행자가 건너는 중" 은 없다 — 그때 A 보행신호는
 * 적색이라 그 사람은 끝내 건너지 않고, 판은 제목과 다른 것을 보여 준다.
 */
export function combinationAllowed(t: LibraryTags): boolean {
  /*
    ── 보행자와 신호기 ──
    신호기가 있으면 '건너려고 대기' · '건너는 중' 은 그 보행신호가 녹색일 때만 있고, '무단횡단' 은
    적색일 때만 있다. 신호기가 없으면 언제든 건너므로 '무단횡단' 이라는 말이 없다.
  */
  if ((t.a === 'waiting' || t.a === 'crossing') && t.sigA === 'yes' && !pedAGreen(t)) return false;
  /*
    **양방향 · 셋은 신호를 지키고 건넌다** — 규칙은 '건너려고 대기' · '건너는 중' 과 같다. 무단횡단으로 두면
    한 판에 여럿이 동시에 신호를 어겨, 무단횡단을 가르치는 판(`jaywalk` · `jaywalkWait`)과 장면이 겹친다.
  */
  if ((t.a === 'bothWays' || t.a === 'crowd') && t.sigA === 'yes' && !pedAGreen(t)) return false;
  if (t.c === 'crowd' && t.sigC === 'yes' && !pedCGreen(t)) return false;
  /*
    **한 횡단보도가 붐비는 판은 그 횡단보도 하나로 끝낸다.**

    첫 횡단보도에 양방향 둘 · 한쪽 셋을 세워 두고 우회전 후에도 사람을 두면, 규정대로 몰아도 두 번 길게
    서서 제한시간에 닿고 무엇을 배우는 판인지도 흐려진다 (앞차 판에 이미 같은 규칙이 있다). 그리고 이 판이
    묻는 것은 **한 횡단보도를 끝까지 보는 일**이라, 다른 곳에 사람을 더 두어도 배우는 것이 늘지 않는다.

    레벨 뼈대와도 맞물린다 — 여럿 판을 너무 많이 더하면 '보행자 여럿' 이 L7 이 아니라 L6 에서 열려
    개념이 차례로 열리는 뼈대가 한 칸 당겨진다 (levelGuide 의 OPENS_SHARE 주석).
  */
  /*
    **자전거는 신호를 지키고 건넌다** — 규칙은 '건너려고 대기' · '건너는 중' 과 같다. 이 판이 묻는 것은
    *자전거횡단도를 알아보는가* 와 *자전거는 걸음보다 빠르다* 이지 신호 위반이 아니다.
  */
  const bikeA = t.a === 'bikeRide' || t.a === 'bikePush';
  if (bikeA && t.sigA === 'yes' && !pedAGreen(t)) return false;
  /*
    **자전거 판은 첫 횡단보도 하나로 끝낸다.** 우회전 후에도 사람을 두면 한 판이 자전거와 보행자를
    함께 묻게 되어, 무엇을 배우는 판인지 흐려진다 (여럿 판에 이미 같은 규칙이 있다).
  */
  if (bikeA && t.c !== 'none') return false;

  const manyA = t.a === 'bothWays' || t.a === 'crowd';
  if (manyA && t.c !== 'none') return false;
  if (t.c === 'crowd' && (t.a === 'mixed' || manyA)) return false;
  if (t.a === 'jaywalk' && (t.sigA === 'no' || pedAGreen(t))) return false;
  /*
    무단횡단하려는 사람 · 기다리는 사람과 함께 선 무단횡단자도 **보행신호가 적색일 때만** 있다. 우회전신호 적색 판의
    A 는 뺀다 — 거기 무단횡단자는 녹색 화살표가 켜질 때 나서도록 맞춰 두어('jaywalk'), 건너려고 서 있다 나서는 것과
    장면이 같아진다.
  */
  if ((t.a === 'jaywalkWait' || t.a === 'mixed') && (t.sigA === 'no' || pedAGreen(t))) return false;
  if (t.a === 'jaywalkWait' && t.signal === 'arrowRed') return false;
  if ((t.c === 'waiting' || t.c === 'crossing') && t.sigC === 'yes' && !pedCGreen(t)) return false;
  if (t.c === 'jaywalk' && (t.sigC === 'no' || pedCGreen(t))) return false;
  /*
    C 도 같다. 다만 **우회전신호 적색은 기다리는 사이 C 가 적색이 되므로** 함께 선 장면(`mixed`)을 둔다 — 신호를
    지키는 사람은 녹색에 건너가고, 무단횡단자는 녹색 화살표에 맞춰 나선다. 무단횡단하려는 사람 하나는 그 판의
    '건너려는 사람'(화살표에 맞춰 적색에 건넌다)과 같아 뺀다.
  */
  if (t.c === 'jaywalkWait' && (t.sigC === 'no' || pedCGreen(t))) return false;
  if (t.c === 'mixed' && (t.sigC === 'no' || (pedCGreen(t) && t.signal !== 'arrowRed'))) return false;
  // '나올 수도 있음' 은 보호구역 신호기 없는 횡단보도의 무조건 일시정지를 가르치는 장치다 (07번)
  if (t.c === 'maybe' && !(t.zone === 'yes' && t.sigC === 'no')) return false;

  // 보행자가 없으면 종류가 뜻이 없다 — 어른 하나만 둔다. '나올 수도 있음' 만 있으면 늘 아이다
  if (!hasPeds(t) && t.kind !== 'adult') return false;
  if (t.c === 'maybe' && t.a === 'none' && t.kind !== 'child') return false;

  /*
    ── 신호기 없는 횡단보도 ──
    신호기 없는 교차로 횡단보도는 **보호구역에서 배우는 것**이다(무조건 일시정지). 보호구역이 아닌
    교차로에서는 신호기를 둔다 — 보호구역 밖 무신호 횡단보도는 "사람이 있으면 선다" 뿐이라, 이미
    다른 판들이 가르친다. 그리고 한 교차로에 신호기 없는 횡단보도는 하나만 둔다.
  */
  if (t.zone === 'no' && (t.sigA === 'no' || t.sigC === 'no')) return false;
  if (t.sigA === 'no' && t.sigC === 'no') return false;
  // 우회전 신호등은 두 보행신호와 맞물려 켜진다 — 신호기 없는 횡단보도와 함께 설 수 없다
  if (hasArrow(t) && (t.sigA === 'no' || t.sigC === 'no')) return false;

  /*
    **녹색 화살표 앞 첫 횡단보도의 노인 무단횡단은 두지 않는다.** 노인이 천천히 다 건너는 사이 14초짜리
    녹색 화살표가 꺼져, 규정대로 기다린 사람이 다음 주기(약 50초)를 또 기다려야 했다 — 검증기가
    "통과 불가능" · "제한시간에 너무 가깝다" 로 걸러 냈다 (48판 · 12판).
  */
  if (t.signal === 'arrowGreen' && t.a !== 'none' && t.kind === 'elder') return false;

  // ── 앞차 ──
  // 일시정지 건너뜀 · 직진 대기 앞차는 정면 적색에서만 뜻이 있다
  if ((t.lead === 'rolling' || t.lead === 'straight') && t.signal !== 'red') return false;
  /*
    앞차 · 우회전 신호등 · 진입로 보호구역, 셋을 한꺼번에 두지는 않는다 — 셋 다 나를 한 번 더 세우는
    장치라, 앞차가 화살표를 받아 먼저 돈 뒤 내 차례에 화살표가 꺼져 제한시간(100초)에 쫓겼다.
  */
  if (t.lead !== 'none' && hasArrow(t) && t.approach !== 'none') return false;
  /*
    앞차가 있는 판은 **사람을 한쪽 횡단보도에만** 둔다. 앞차가 양쪽에서 차례로 양보하는 동안 나도
    두 번 서면, 모범 운전에도 제한시간에 가까워지고 무엇을 배우는 판인지도 흐려진다.
  */
  if (t.lead !== 'none' && t.a !== 'none' && t.c !== 'none') return false;

  /*
    ── 진입로 보호구역 ──
    교차로가 이미 보호구역이면 진입로 보호구역은 겹치지 않는다 — 한 판의 보호구역은 하나의 주제다.
  */
  if (t.approach !== 'none' && t.zone === 'yes') return false;

  /*
    ── 꼬리물기 ──
    그 자체로 판 하나의 주제다. 사람·보호구역·우회전 신호등을 얹지 않는다. 앞차는 둔다 — "앞차가
    들어가니 따라 들어간다" 가 꼬리물기가 실제로 생기는 모습이다.
  */
  if (t.jam === 'jam' && (hasPeds(t) || t.zone === 'yes' || t.approach !== 'none' || hasArrow(t))) return false;

  /*
    ── 덧붙이는 사람들 (EXTRAS) ──
    맑고 조용한 판에만 · 우회전 신호등 판에는 두지 않는다. 자전거는 신호를 지키므로 그 횡단보도의 보행신호가 녹색인
    구간이거나 신호기가 없어야 한다 (위 자전거 규칙과 같다). 첫 횡단보도의 자전거는 기본 자전거 판(A 축)과 겹치지 않게
    다른 사람이 함께 있을 때만 — 첫 횡단보도가 비었으면 우회전 후에는 사람이 있어야 한다. 우회전 후 횡단보도의 자전거는
    거기 사람이 있을 때만이고('나올 수도' · '뛰어듦' 은 뺀다), 자전거횡단도는 한 판에 하나다.
  */
  if (t.extra !== 'none') {
    const x = extrasOf(t);
    if (t.lead !== 'none' || t.jam === 'jam' || t.pressure === 'honk' || t.env !== 'day' || hasArrow(t)) return false;
    if (x.rideA || x.pushA) {
      if (t.a === 'bikeRide' || t.a === 'bikePush') return false;
      if (t.a === 'none' && t.c === 'none') return false;
      if (t.sigA === 'yes' && !pedAGreen(t)) return false;
      // 걷는 사람은 한 횡단보도에 셋까지 — 셋이 이미 있으면 끌고 가는 사람을 더하지 않는다
      if (x.pushA && t.a === 'crowd') return false;
    }
    if (x.rideC || x.pushC) {
      if (t.c === 'none' || t.c === 'maybe' || t.c === 'late') return false;
      if (t.sigC === 'yes' && !pedCGreen(t)) return false;
      if (x.rideC && t.a === 'bikeRide') return false;
      if (x.pushC && t.c === 'crowd') return false;
    }
    if (x.pedS && (t.approach !== 'noSignal' || t.a === 'none')) return false;
    // 같은 쪽에서 한 사람 더 — 한 사람이 걸어서 서는 판에만 (첫 횡단보도든 우회전 후든)
    if (x.pair && !singleWalker(t.a) && !singleWalker(t.c)) return false;
  }
  return true;
}

/** 한 사람이 **걸어서** 서는 값인가 — 같은 쪽 동행(EXTRAS 의 pair)을 붙일 수 있는 자리 */
const singleWalker = (v: string): boolean => v === 'waiting' || v === 'crossing' || v === 'jaywalk' || v === 'jaywalkWait';

/** 반대쪽 보도 */
const mirrorSide = (s: 'left' | 'right'): 'left' | 'right' => (s === 'left' ? 'right' : 'left');

/**
 * **플레이테스트로 뺀 조합** — 법규 · 신호 구조로는 성립하지만, 실제 차로 달려 보니 운전자에게 가르칠 것이 없거나
 * 공정하지 않은 판 (시나리오 플레이테스트).
 *
 * `combinationAllowed` 와 따로 두는 까닭은 **번호**다. 판 번호(libraryNumber)는 라이브러리 순서라, 판을 빼면 그 뒤의
 * 번호가 모두 밀려 사용자가 부르던 "4927번" 이 다른 판이 된다. 여기서 뺀 판은 번호 자리만 비워 두고 싣지 않는다.
 */
export function playtestExcluded(t: LibraryTags): boolean {
  /*
    **우회전신호 적색에서 앞차가 있으면 사람을 두지 않는다.** 앞차가 적색 화살표 앞에 서고 나는 그 뒤에 줄을 섰다가,
    녹색 화살표에 둘이 함께 떠난다 — 앞차가 횡단보도를 지날 때 나는 3m 뒤라, 사람이 그 사이로 나서면 규정대로 모는
    사람도 설 수 없다(함정). 나서지 않게 두면 서 있는 그림이다. 앞차 뒤로 사람이 나서는 장면은 앞차와 간격이 벌어지는
    신호(녹색 · 정면 적색 · 녹색 화살표)에서 만든다.
  */
  if (t.signal === 'arrowRed' && t.lead !== 'none' && hasPeds(t)) return true;
  /*
    **직진 대기 앞차 뒤의 첫 횡단보도 사람도 두지 않는다.** 앞차가 녹색에 직진해 떠날 때 나는 그 바로 뒤라, 앞차가
    첫 횡단보도를 지날 때 이미 그 위에 있다 — 줄 선 채로 떠나는 것과 같다. (진출 횡단보도는 앞차가 지나지 않아 괜찮다)
  */
  if (t.lead === 'straight' && t.a !== 'none') return true;
  /*
    **녹색 화살표에서 앞차 뒤의 첫 횡단보도 사람도** 두지 않는다 — 앞차를 보낸 사람이 건너는 사이 14초짜리 녹색
    화살표가 꺼져, 규정대로 기다린 사람이 한 주기(약 50초)를 더 서 있었다.
  */
  if (t.signal === 'arrowGreen' && t.lead !== 'none' && t.a !== 'none') return true;
  /*
    **진출로 정체에 앞차를 두지 않는다.** "앞차가 들어가니 따라 들어간다" 를 보이려 했지만, 규정대로 모는 앞차는 막힌
    진출로에 들어가지 않는다 — 앞차가 정체가 풀릴 때까지 정지선에 서 있고 나는 그 뒤에 줄을 서서, 내 차례에는 정체가
    이미 풀려 있다. 막 몰아도 꼬리물기로 잡히지 않는 판이 됐다.
  */
  if (t.jam === 'jam' && t.lead !== 'none') return true;
  /*
    **녹색 화살표 판의 첫 횡단보도에 "차가 다가와야 나서는" 무단횡단자를 두지 않는다** (무단횡단하려는 사람 · 함께 선
    무단횡단자). 정지선 앞까지 와서야 나서 9초를 건너는 사이 14초짜리 녹색 화살표가 꺼져, 규정대로 기다린 사람이 한
    주기(57초)를 더 서 있었다. 이 신호에서 첫 횡단보도의 무단횡단은 다가올 때 이미 건너고 있는 사람('jaywalk')이 맡는다.
  */
  if (t.signal === 'arrowGreen' && (t.a === 'jaywalkWait' || t.a === 'mixed')) return true;
  return false;
}

/** 라이브러리에 실리는 조합인가 — 성립하고(combinationAllowed), 플레이테스트로 빼지 않았다 */
/** 이 조합의 판이 라이브러리에 있는가 — 성립하고, 빼지 않았고, 거울상이라면 뒤집을 사람이 있어야 한다 (flipMatters) */
export const inLibrary = (t: LibraryTags): boolean =>
  combinationAllowed(t) && !playtestExcluded(t) && (t.side !== 'flip' || flipMatters(t));

// ── 판 만들기 ────────────────────────────────────────────────────────────────

/** 정면 신호별 출발 자리 — 손으로 쓴 판에서 검증된 값이다 (01·02·05·06번) */
const SIGNAL_START: Record<LibraryTags['signal'], { phase: number; elapsed: number }> = {
  green: { phase: 0, elapsed: 2 },
  red: { phase: 5, elapsed: 3 },
  arrowRed: { phase: 0, elapsed: 5 },
  arrowGreen: { phase: 2, elapsed: 0 },
};

const CYCLE = STANDARD_PROGRAM.reduce((n, p) => n + p.duration, 0);
const phaseOffset = (i: number): number =>
  STANDARD_PROGRAM.slice(0, i).reduce((n, p) => n + p.duration, 0);


function startOf(t: LibraryTags): { startPhase: number; startPhaseElapsed: number } {
  const base = SIGNAL_START[t.signal];
  let pos = phaseOffset(base.phase) + base.elapsed;
  /*
    **앞차가 있으면 녹색 화살표를 더 길게 남겨 둔다.** 앞차가 먼저 화살표를 받아 돌고 나서야 내
    차례가 오는데, 2번 구간 첫머리에서 출발하면 내 차례에 화살표가 황색으로 넘어가 다음 주기를
    기다려야 했다. 적색 화살표 끝자락(1번 구간 첫머리)에서 출발하면 두 차가 모두 화살표 안에 돈다.
  */
  if (t.signal === 'arrowGreen' && t.lead !== 'none') pos = phaseOffset(1);
  /*
    진입로 보호구역이 있으면 **교차로에 늦게 닿는다** (scenarios.ts 의 APPROACH_EXTRA). 그만큼 출발 자리를 앞당겨,
    교차로에 닿을 때의 신호가 진입로 보호구역이 없는 판과 같게 한다 — 우회전신호 적색도 마찬가지로 닿은 뒤 8초쯤
    기다리면 녹색 화살표가 켜진다. 한때 우회전신호 적색만 따로 마지막 전방향 적색(7번)에서 출발시켰는데, 교차로에
    닿기도 전에 화살표가 켜져 "적색 화살표에서 기다린다" 가 일어나지 않았다.
  */
  if (t.approach !== 'none') {
    // 앞차 판의 보호구역 신호는 녹색이라(buildLibrarySpec) 서지 않고 지난다
    const key = t.approach === 'signal' && t.lead !== 'none' ? 'signalGreen' : t.approach;
    pos = (((pos - APPROACH_EXTRA[key]) % CYCLE) + CYCLE) % CYCLE;
  }
  for (let i = 0; i < STANDARD_PROGRAM.length; i++) {
    const from = phaseOffset(i);
    if (pos < from + STANDARD_PROGRAM[i].duration) {
      return { startPhase: i, startPhaseElapsed: Math.round((pos - from) * 10) / 10 };
    }
  }
  return { startPhase: 0, startPhaseElapsed: 0 };
}

/** 조합마다 **정해진** 작은 난수 — 같은 판은 늘 같은 모습이 된다 */
function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000;
}

/**
 * 우회전신호 적색 판에서 **녹색 화살표가 켜지기까지** 몇 초인가 (출발부터). 그 밖의 판은 `null`.
 *
 * 이 판에서는 정지선에서 녹색 화살표를 기다렸다가 돈다. 기다리는 동안 C 보행신호는 녹색 → 점멸 → 적색으로
 * 바뀌어, 화살표가 켜질 때는 **이미 적색**이다 (STANDARD_PROGRAM 의 2번 구간).
 */
function arrowGreenAt(t: LibraryTags): number | null {
  if (t.signal !== 'arrowRed') return null;
  const { startPhase, startPhaseElapsed } = startOf(t);
  const pos = phaseOffset(startPhase) + startPhaseElapsed;
  return (((phaseOffset(2) - pos) % CYCLE) + CYCLE) % CYCLE;
}

/**
 * 판의 보행자.
 *
 * 앞차가 없는 판의 모양(`pedestriansAlone`)을 먼저 짓고, 앞차가 있으면 **앞차 뒤로 나서는 사람**으로 바꾼다
 * (`behindLead`).
 */
/**
 * **진입로 보호구역 횡단보도(S)에 아이를 세우는 판인가** — 태그만으로 정한다.
 *
 * 이 횡단보도는 지금까지 **한 명도 없었다.** 3,264판이 전부 "사람이 없어도 일시정지"(제27조 제7항)만
 * 시험하고 끝났다 — 그 규정이 있는 까닭(보호구역 횡단보도에 아이가 있다) 자체는 한 번도 안 나온 것이다.
 *
 * **판 번호가 아니라 태그로 가르는 까닭**: 제목 · 시험 목록 · 상황 설명이 모두 태그에서 만들어진다
 * (`titleOf` · `targetsOf` · `briefOf`). 판 번호로 가르면 그 셋에도 번호를 넘겨야 하고, 무엇보다
 * **제목이 판과 달라진다** — 제목에 없는 사람이 서 있게 된다.
 *
 * **첫 횡단보도(A)에 사람이 없는 판에만** 둔다. 한 판에서 세 번 서게 되면 제한시간(100초)에 쫓기고
 * 무엇을 배우는 판인지도 흐려진다 — 앞차 판에 사람을 한쪽에만 두는 것(`combinationAllowed`)과 같은 사고다.
 * 그래서 S 와 A 는 겹치지 않게 두고, 우회전 후(C)의 사람과는 **오는 길과 나가는 길**로 갈린다.
 *
 * **늘 어린이다.** 보호구역의 대표 장면이고, 이 조합에서 `kind` 태그는 `'adult'` 로 고정돼 있어
 * (`combinationAllowed` — 사람이 없으면 종류가 뜻이 없다) 태그에서 읽을 수 없다. `c === 'maybe'` 가
 * 같은 까닭으로 `kind: 'child'` 를 박아 둔 선례를 따른다.
 *
 * **무신호 진입로만.** 신호 있는 진입로는 내가 닿을 때 보행 녹색이라(`APPROACH_SIGNAL_ELAPSED`),
 * 신호를 지키는 사람은 내가 적색을 기다리는 사이 다 건너가 **역할을 잃는다** (4927번에서 짚은 것과 같은 모습).
 *
 * **앞차 판도 뺀다.** 앞차가 S 앞에서 먼저 서서 아이를 다 보내 주고, 뒤따르는 나는 그 아이와 한 번도 만나지
 * 않는다 — 실제로 넣어 보니 앞차 판에서만 역할을 잃었다. A · C 는 `behindLead` 가 "앞차가 지나간 뒤에
 * 나선다" 로 풀지만, S 는 교차로 **앞**이라 앞차가 아직 내 앞에 있어 같은 수를 쓸 수 없다.
 *
 * **우회전 신호등 판도 뺀다.** 녹색 화살표는 14초짜리라, S 에서 아이를 기다리는 사이 꺼져 버린다 —
 * 규정대로 몬 사람이 다음 주기를 또 기다리게 되어 검증기가 "규정대로 몰아도 통과할 수 없다" 로 잡았다.
 */
const hasApproachPed = (t: LibraryTags): boolean =>
  t.approach === 'noSignal' && t.a === 'none' && t.lead === 'none' && !hasArrow(t);

function pedestriansOf(t: LibraryTags, seed: number): PedSpawn[] {
  const auto = pedestriansAuto(t, seed);
  if (t.side !== 'flip') return auto;
  // 거울상 — 쌍둥이(auto) 판의 사람들 가운데 **한쪽에서만 오는 횡단보도**의 사람들을 반대쪽 보도로 옮긴다 (SIDES 주석)
  const cws: ReadonlySet<string> = mirrorableCrosswalks(t, auto);
  return auto.map((p) => (cws.has(p.crosswalk) ? { ...p, from: mirrorSide(p.from) } : p));
}

/**
 * **거울로 뒤집는 횡단보도** — 사람들이 한쪽에서만 오는 횡단보도. 양쪽에서 오는 판(`bothWays` · `group` · `mixed`)은 이미
 * 양방향이라 뒤집을 것이 없고, 뒤집으면 "건너편이 먼저 나선다" 같은 시각 설계까지 뒤집힌다. 쪽이 설계로 박힌 사람도 두지
 * 않는다 — 돌자마자 뛰어드는 사람(`late`)은 가까운 쪽이어야 장면이 성립하고, 나올까 말까(`maybe`)는 07번 판을 그대로 재현한다.
 * 제목의 방향 글귀(sidePhrases)도 같은 횡단보도만 적는다.
 */
function mirrorableCrosswalks(t: LibraryTags, peds: readonly PedSpawn[]): Set<'S' | 'A' | 'C'> {
  const out = new Set<'S' | 'A' | 'C'>();
  for (const cw of ['S', 'A', 'C'] as const) {
    if (cw === 'C' && (t.c === 'late' || t.c === 'maybe')) continue;
    const sides = new Set(peds.filter((p) => p.crosswalk === cw).map((p) => p.from));
    if (sides.size === 1) out.add(cw);
  }
  return out;
}

/** 방향을 뒤집기 전의 사람들 — 해시가 정한 쪽 그대로 */
function pedestriansAuto(t: LibraryTags, seed: number): PedSpawn[] {
  const alone = pedestriansAlone(t, seed);
  const out = t.lead === 'none' ? alone : behindLead(alone, t);
  if (!hasApproachPed(t)) return out;
  /*
    신호기가 없으면 지킬 신호가 없다 — `obeysSignal` 을 적지 않으면 검증기가 "무시됩니다" 경고를 낸다.
    쪽은 판 번호로 가른다 (위 `side` 와 같은 사고).
  */
  return [
    ...out,
    {
      crosswalk: 'S',
      at: 0,
      startWithin: 14,
      from: hash(seed + 30) < 0.5 ? 'left' : 'right',
      obeysSignal: false,
      kind: 'child',
    },
  ];
}

/**
 * **앞차가 있는 판 — 사람은 앞차가 지나간 뒤에 나선다** (PedSpawn.afterLead).
 *
 * 처음에는 앞차가 없는 판과 똑같이 두었다. 그러자 앞차가 먼저 서서 사람을 다 보내 주고, 뒤따르는 나는 그
 * 사람과 한 번도 만나지 않았다 — 신호만 지키고 보행자를 보지 않는 운전자가 앞차 판 1,500여 개를 **보행자 위반
 * 없이** 통과했다. 판의 가르침("앞차가 떠난 뒤에도 보행자의 통행이 끝났는지 직접 확인합니다")이 한 번도 일어나지
 * 않은 것이다.
 *
 * 이제는 앞차가 횡단보도를 다 지난 뒤 사람이 나선다 — 실제로 흔한 사고 장면이다. 두 사람이 나오는 판은 **앞사람은
 * 그대로** 두어 앞차가 서서 보내 주게 하고, 뒷사람만 앞차 뒤로 나서게 한다. 앞차 뒤에 줄 서 있던 내가 앞차를 따라
 * 출발하는 순간이 바로 그때다. 시각은 앞차가 정하므로 등장 시각은 0 으로 되돌리고, 거리 방아쇠는 넉넉히 둔다 —
 * 나서는 조건은 "앞차가 지나갔고 내가 설 수 있는 거리" 다 (pedWalk.ts 의 AFTER_LEAD_*).
 */
/** 앞차 뒤 첫 사람의 방아쇠 거리 (m) — 앞차가 지나간 뒤 내가 이만큼 다가오면 곧바로 빨강을 띄우고 나선다 (아래 주석) */
const AFTER_LEAD_TRIGGER = 12;

function behindLead(alone: PedSpawn[], t: LibraryTags): PedSpawn[] {
  const byCrosswalk = new Map<string, number>();
  return alone.map((p) => {
    // 내 차를 보내고 건너는 사람(신호를 기다리는 사람)은 그대로 둔다 — 앞차와 상관없이 내 차가 지나가길 기다린다
    if (p.letsCarPass) return p;
    const nth = byCrosswalk.get(p.crosswalk) ?? 0;
    byCrosswalk.set(p.crosswalk, nth + 1);
    /*
      **우회전 중 뛰어드는 사람은 제 방아쇠(9m)를 지킨다.** 앞차 뒤 사람은 앞차가 지나가자마자 빨강을 띄우고
      곧바로 나서는데(pedWalk.ts 의 AFTER_LEAD_DELAY), 이 사람까지 그러면 **내가 코너를 돌기 전에** 다 건너
      버린다 — 앞차가 서고 진입로 신호가 나를 더 붙잡는 판에서 36판이 그렇게 역할을 잃었다. 이 사람의 장면은
      "돌 때 코앞에서 뛰어든다" 라, 앞차가 지나간 뒤에도 **내가 가까이 와야** 나선다.
    */
    /*
      **빗길에는 12m 에서 나선다** — 브레이크가 0.7 배라(scenarios/conditions.ts) 15km/h 로 돌면서 1초 늦게 본 사람은 9m 안에서
      서지 못한다 (제동 3.3m + 반응 4.2m + 횡단보도 앞 여유). 환경을 물리로 바꾸자 이 모양 124판에서 그 운전자가 걸렸다
      (전수 검증이 잡았다). 다른 앞차 뒤 사람과 같은 거리(AFTER_LEAD_TRIGGER)라 "앞차가 가린 자리에서 나온다" 는 그대로다.

      **보호구역의 신호기 없는 우회전 후 횡단보도는 9m 그대로다** — 거기서는 사람이 없어도 서야 하므로(제27조 제7항) 늦게 본
      사람도 이미 서는 중이라 걸리지 않았고(124판에 하나도 없다), 12m 로 당기면 보행자를 안 보는 운전자가 의무 정지를 하는 동안
      사람이 다 건너 버려 역할을 잃었다 (12판, 전수 검증이 잡았다).
    */
    if (p.crosswalk === 'C' && t.c === 'late') {
      const mustStopAtC = t.zone === 'yes' && t.sigC === 'no';
      const within = t.env === 'rain' && !mustStopAtC ? AFTER_LEAD_TRIGGER : p.startWithin;
      return { ...p, at: 0, startWithin: within, afterLead: true, obeysSignal: false };
    }
    /*
      **타고 건너는 자전거도 제 방아쇠(6m)를 지킨다.** 걸음보다 빨라서(pedWalk.ts) 앞차 뒤 사람의
      방아쇠(12m)로 나서면 **내가 닿기 전에 다 건너** 버린다 — 앞차가 일시정지를 건너뛰는 판 넷이
      그렇게 역할을 잃었다 (전수 검증이 잡았다). 이 자전거의 장면은 "아직 서 있으니 먼저 가도
      되겠다" 를 하지 않는 것이라, 앞차가 지나간 뒤에도 **내가 가까이 와야** 나선다.
    */
    if (p.bike === 'ride') return { ...p, at: 0, afterLead: true, obeysSignal: false };
    /*
      - **모두 앞차 뒤로 나선다.** 한때 여럿이면 첫 사람은 앞차가 서서 보내 주게 두었는데, 그러면 앞차가 횡단보도 앞에
        서고 나는 그 바로 뒤에 줄을 서서, 앞차가 떠날 때 내가 곧장 따라 들어가 둘째 사람이 나설 틈(내가 설 수 있는
        거리)이 없었다. 여럿은 차례로 나선다 — 둘째 사람은 내가 더 다가와야(12m) 나선다.
      - **신호를 기다리지 않는다.** 앞차를 보낸 사람은 그 자리에서 곧 건넌다 — 보행신호가 막 점멸로 바뀌어도 그렇다
        (실제로 흔하다). 신호를 지키게 두었더니 앞차를 기다리는 사이 녹색이 끝나, 노란 느낌표를 띄웠다가 뜻을 접고 서
        있기만 했다 (플레이테스트가 잡았다). 사람이 신호를 어겨도 운전자는 서야 한다 — 그것이 이 판이 묻는 것이다.
    */
    /*
      방아쇠 거리는 **앞차가 지나간 뒤 내가 이만큼 다가오면 곧바로 빨강 → 나선다** 는 뜻이다 (pedWalk.ts).
      30m 에서 12m 로 당겼다 — 멀리서 나선 아이는 내가 닿기 전에 다 건넌다(아이는 22.8m 를 5.6초에 건넌다).
      재 보니 16m 에서는 무신호 C(내가 한 번 서야 하는 자리) 앞 어린이 판 24개가 역할을 잃었고, 12m · 10m 는
      모두 성립했다 — 더 멀리서 보이는 12m 를 골랐다.
    */
    return { ...p, at: 0, startWithin: nth === 0 ? AFTER_LEAD_TRIGGER : 12, afterLead: true, obeysSignal: false };
  });
}

/** 앞차가 없는 판의 보행자 */
/**
 * **곁에 선 사람의 나이.**
 *
 * 판이 정하는 나이(`t.kind`)는 **주인공 한 사람**의 것이고, 함께 나오는 사람은 그동안 늘 어른이었다
 * (`group` 의 둘째 · `mixed` 의 기다리는 사람 · `crowd` 의 뒷사람 · `bothWays` 의 반대쪽). 그래서
 * 어린이보호구역 판에서도 **사람 넷 중 하나만 아이**였다 (25%).
 *
 * 보호구역에서는 곁에 선 사람도 아이로 둔다 — 학교 앞에서 여럿이 함께 건너면 대개 아이들이고,
 * 사용자가 정했다: "어린이보호구역에는 어린이들이 많이 출현해야 해." 보호구역이 아닌 판은 그대로
 * 어른이다 (거기까지 아이로 채우면 '보호구역이라 아이가 많다' 가 흐려진다).
 */
const companion = (t: LibraryTags): PedSpawn['kind'] =>
  t.zone === 'yes' || t.approach !== 'none' ? 'child' : 'adult';

function pedestriansAlone(t: LibraryTags, seed: number): PedSpawn[] {
  const out: PedSpawn[] = [];
  /*
    **어느 쪽 보도에서 오는가** — 판 번호로 가른다 (같은 판은 늘 같은 쪽).

    예전에는 대부분 `'right'`(내 차와 같은 쪽 보도)로 박아 두었다. 그래서 첫 횡단보도는 보행자가 있는 판의
    **90%가 차량쪽 사람을 반드시** 가졌고(4,292/4,770), 두 번째도 78.5%였다 — 사용자가 두 번 짚었다:
    "첫번째 횡단보도에서는 우측에만 사람이 있고 두번째 횡단보도에도 우측에만 사람이 있어."

    반대편에서 오는 사람은 **내 차로에 닿기까지 시간이 더 걸린다** — 멀리서 보이지만 늦게 도착하므로
    "다 건널 때까지 기다린다" 를 시험하는 다른 장면이 된다. 유형마다 **다른 salt** 를 줘야 한 판 안의
    두 사람이 늘 같은 쪽으로 붙지 않는다 (쓰는 값: 아래 side(...) 호출과 environmentOf 의 11 · 13).
  */
  const side = (k: number): 'left' | 'right' => (hash(seed + k) < 0.5 ? 'left' : 'right');
  /** 그 반대쪽 — 두 사람이 나오는 판(`group` · `mixed`)에서 둘을 갈라 세운다 */
  const other = (s: 'left' | 'right'): 'left' | 'right' => (s === 'left' ? 'right' : 'left');
  const kind = t.kind;
  // 신호기가 없으면 지킬 신호가 없다 — `obeysSignal` 을 적지 않으면 검증기가 "무시됩니다" 경고를 낸다
  const freeA = t.sigA === 'no' ? { obeysSignal: false } : {};
  const freeC = t.sigC === 'no' ? { obeysSignal: false } : {};

  /*
    ── 첫 횡단보도(A) ──
    '건너려고 대기' 는 **가까운 보도 끝에 처음부터 서서** 건너려는 뜻을 보이다가, 내가 다가가면 발을 뗀다
    (startWithin 이 짧다). 서지 않고 지나가면 "통행하려고 하는 때" 의 방해다.

    **5m 였던 것을 12m 로 물렸다.** 5m 는 서행(12~14km/h) 중인 차가 편안히 서는 거리(반응 1초 + 제동 ≈ 5.3m)
    보다 짧아, 운전자 눈에는 서 있던 사람이 코앞에서 갑자기 나오는 장면이 됐다 — 실제로 재 보니 발을 떼는
    순간 내 차는 1.7~2.6m 앞이었고 이미 서 있거나 기어가는 중이었다 (사용자: "너무 늦게 출발해서 운전자가
    예측할 수가 없어"). 12m 면 3초 앞서 나서므로 **보고 판단해서 설 수 있다.** 그래도 내가 다 와서야
    나서는 것은 그대로라, 이 판이 묻는 것("서 있는 사람 앞을 지나갈 것인가")은 달라지지 않는다.
    (12m 는 pedWalk 의 `STEP_OFF_LATEST` 와 같은 값이다 — 둘 다 6천 판을 달려 보며 맞춘 벽이다.)
  */
  if (t.a === 'waiting') out.push({ crosswalk: 'A', at: 0, startWithin: 12, from: side(2), kind, ...freeA });
  if (t.a === 'crossing') out.push({ crosswalk: 'A', at: 0, startWithin: 20, from: side(1), kind, ...freeA });
  /*
    우회전신호 적색이면 **녹색 화살표가 켜지는 순간** 무단횡단한다. 다가오며 바로 나서게 두었더니, 정지선에서
    화살표를 기다리는 동안 다 건너가 버려 화살표를 받고 돌 때는 아무도 없었다 (아래 C 의 주석과 같은 까닭).
    A 는 정지선 바로 앞이라, 화살표만 보고 출발하는 사람 앞으로 나서게 된다.

    **앞차가 있으면 그대로 둔다.** 앞차가 화살표를 받자마자 나선 노인을 기다리느라 14초짜리 화살표를 놓쳐,
    한 주기를 더 기다려야 했다(모범 주행 95초). 앞차 판에서 보행자가 맡을 역할은 따로 정한다 (libraryShard.ts).
  */
  /*
    **화살표가 켜지기 3초 전에 나선다.** 처음에는 켜진 뒤(+0.5초)에 나서게 했는데, 노인은 다 건너는 데 13초가 걸려
    14초짜리 녹색 화살표를 거의 다 써 버렸다 — 규정대로 기다린 사람이 화살표 끝자락에 겨우 정지선을 지났다
    (플레이테스트가 잡았다). 3초 먼저 나서면 화살표가 켜질 때 **아직 건너는 중**이라 역할은 그대로다.
  */
  const arrowAtA = arrowGreenAt(t);
  const jaywalkAtA = arrowAtA !== null ? arrowAtA - 3 : 0;
  if (t.a === 'jaywalk') {
    out.push({ crosswalk: 'A', at: jaywalkAtA, startWithin: 18, from: side(3), obeysSignal: false, kind });
  }
  /*
    **무단횡단하려는 사람** — 적색인데 연석까지 나와 처음부터 건너려는 뜻을 보인다(노란 느낌표). 내가 정지선 근처까지
    오면 나선다. 신호를 믿고 "적색이니 안 건너겠지" 하고 가면 그 앞으로 걸어 나온다.
  */
  if (t.a === 'jaywalkWait') out.push({ crosswalk: 'A', at: 0, startWithin: 6, from: side(5), obeysSignal: false, kind });
  /*
    **신호를 기다리는 사람과 무단횡단하는 사람이 함께** 서 있다. 기다리는 사람은 적색이라 서 있고(느낌표 없음),
    다른 한 사람이 나선다 — 어느 쪽이 나설지는 미리 알 수 없어 둘 다 보고 있어야 한다.
  */
  if (t.a === 'mixed') {
    /*
      신호를 기다리는 사람은 **내 차가 지나갈 때까지** 가만히 서 있다 (PedSpawn.letsCarPass). 처음에는 출발부터 두었는데,
      진입로 보호구역 판은 교차로 신호를 앞당겨 두어 출발 무렵 그 보행신호가 녹색이라 노란 느낌표를 띄웠다가 점멸이 되자
      뜻을 접었다 — 4927번에서 짚은 것과 같은 모습이다 (플레이테스트가 잡았다).
    */
    // 둘은 **서로 다른 쪽**에서 온다 — 어느 쪽이 나설지 모르니 양쪽을 다 봐야 한다 (위 side · other)
    const waits = side(9);
    out.push({ crosswalk: 'A', at: 0, from: waits, kind: companion(t), letsCarPass: true });
    out.push({
      crosswalk: 'A',
      at: jaywalkAtA,
      startWithin: 6,
      from: other(waits),
      obeysSignal: false,
      kind,
    });
  }

  /*
    **양방향** — 양쪽 연석에서 한 사람씩 **둘 다** 건넌다. 한쪽을 보내고 출발하면 반대쪽 사람 앞을 지나가게 된다.

    건너편에서 오는 사람은 반대 차로를 먼저 건너 내 차로까지 시간이 더 걸리므로 **조금 일찍 나선다** —
    둘이 같은 거리에서 나서면 차량쪽 사람이 다 건넌 뒤에야 건너편 사람이 내 차로에 닿아, 두 번 서게 된다.
    어린이 · 노인이 어느 쪽에 서는지는 판마다 다르다 (위 side).
  */
  if (t.a === 'bothWays') {
    const special = side(16);
    // 건너편 사람이 먼저(12m) 나서고 차량쪽 사람이 뒤따른다(9m) — 건너편을 보고 "이제 가도 되겠다" 할 때 발밑에서 나온다
    out.push({ crosswalk: 'A', at: 0, startWithin: 12, from: 'left', kind: special === 'left' ? kind : 'adult', ...freeA });
    out.push({ crosswalk: 'A', at: 0, startWithin: 9, from: 'right', kind: special === 'right' ? kind : 'adult', ...freeA });
  }
  /*
    **셋** — 한쪽에서 차례로 건넌다. 방아쇠 거리를 벌려 **한 사람이 지나간 뒤 다음 사람이** 나서므로,
    앞사람만 보내고 출발하면 걸린다. 첫 사람이 가장 멀리서 나서고(20m) 뒤로 갈수록 가까워진다.
  */
  /*
    **자전거.** 연석의 자전거는 **처음부터 보인다** — 건너려는 뜻(노란 느낌표)도 함께 띄운다. 다만
    발을 떼는 것은 **늦다**(6m). 의무 정지로 잠깐 섰다가 다시 출발할 때 아직 건너는 중이라야 이 판이 성립한다 —
    10m 에서 나서게 했더니 그 정지 동안 다 건너 버렸다 (전수 검증이 잡았다). 멀리서 나서게 두면 걸음보다 빠른 만큼 내가 닿기 전에 다 건너 버려
    아무 일도 일어나지 않는 판이 된다 (전수 검증이 잡았다). 이 판이 묻는 것은 "자전거가 아직 서 있으니
    먼저 가도 되겠다" 를 하지 않는 것이다.
  */
  if (t.a === 'bikeRide') {
    out.push({ crosswalk: 'A', at: 0, startWithin: 6, from: side(19), kind, bike: 'ride', ...freeA });
  }
  if (t.a === 'bikePush') {
    out.push({ crosswalk: 'A', at: 0, startWithin: 12, from: side(20), kind, bike: 'push', ...freeA });
  }
  if (t.a === 'crowd') {
    const from = side(17);
    /*
      **12 · 9 · 6m** — 12m 보다 먼 값은 뜻이 없다. 연석에서 기다리는 사람은 차가 12m 안까지 오면 그 값과
      상관없이 나서기 때문이다 (pedWalk.ts 의 `STEP_OFF_LATEST`). 20 · 15 · 10 으로 두었더니 앞의 둘이 같은
      순간에 나서 "차례로" 가 사라졌다 (직접 달려 보고 고쳤다). 첫 사람은 다른 판과 같은 12m 라 보고 설 수
      있고, 뒤의 둘은 내가 이미 선 뒤에 나선다.
    */
    for (const [i, within] of [12, 9, 6].entries()) {
      out.push({ crosswalk: 'A', at: 0, startWithin: within, from, kind: i === 0 ? kind : 'adult', ...freeA });
    }
  }

  // ── 우회전 후 횡단보도(C) ──
  /*
    **우회전신호 적색 판은 C 의 사람을 화살표에 맞춘다.**

    처음에는 다른 판과 똑같이 출발부터 두었다. 그러자 사람은 기다리는 동안의 녹색 보행신호에 노란 느낌표를 띄웠다가,
    신호가 적색이 되자 뜻을 접었고(느낌표가 사라졌다), 녹색 화살표를 받고 돌 때는 보도에 가만히 서 있었다 —
    **판 제목에 있는 사람이 아무 역할도 하지 않았다** (사용자가 4927번에서 짚었다). 이 판이 "보행자 보호" 를
    시험한다고 적어 두고도 실제로는 시험하지 않으니, 그 습관이 이 판에서 '고쳐졌다' 고 세는 것도 거짓이 됐다.

    그래서 화살표가 켜질 무렵에 건너게 한다. 가르치려는 것은 **녹색 화살표여도 사람이 있으면 선다** 이다.
    - 건너려는 사람: 화살표가 켜지기 3초 전(점멸 중)에 노란 느낌표를 띄우고, 켜지고 1초 뒤 적색에 건넌다
    - 건너는 사람: 점멸 끝자락에 늦게 나서, 화살표를 받고 C 에 닿을 때 **아직 건너는 중**이다
    - 뛰어드는 사람: 화살표를 받고 돌 때 뛰어든다
    신호를 지키는 사람으로 두면 적색에 끝내 건너지 않으므로 신호를 어기는 사람으로 둔다.
  */
  const arrowAt = arrowGreenAt(t);
  if (arrowAt !== null && t.c !== 'none') {
    const late = { obeysSignal: false } as const;
    // 정지선에서 C 까지 약 23m — 24m 면 정지선에서 기다리는 차에도 나선다 (차가 다가오기를 기다리지 않는다)
    if (t.c === 'waiting') out.push({ crosswalk: 'C', at: arrowAt + 1, startWithin: 24, from: side(7), kind, ...late });
    // 점멸 끝자락(0.5초 전)에 나선다 — 3초 전에 나서게 했더니 어른 · 아이는 녹색 화살표를 받고 C 에 닿기 전에 다 건넜다
    if (t.c === 'crossing') out.push({ crosswalk: 'C', at: arrowAt - 0.5, startWithin: 24, from: side(4), kind, ...late });
    if (t.c === 'group') {
      // 둘은 서로 다른 쪽에서 온다 — 한 사람이 끝나도 다른 쪽에 아직 남아 있다 (위 side · other)
      const first = side(10);
      out.push({ crosswalk: 'C', at: arrowAt - 3, startWithin: 24, from: first, kind, ...late });
      out.push({ crosswalk: 'C', at: arrowAt + 1, startWithin: 16, from: other(first), kind: companion(t), ...late });
    }
    // 셋이 한쪽에서 차례로 — 화살표 앞뒤로 벌려, 화살표를 받고 돌 때도 아직 건너는 사람이 있다
    if (t.c === 'crowd') {
      const from = side(18);
      for (const [i, at] of [arrowAt - 3, arrowAt + 1, arrowAt + 4].entries()) {
        out.push({ crosswalk: 'C', at, startWithin: 24, from, kind: i === 0 ? kind : 'adult', ...late });
      }
    }
    // 뛰어드는 사람은 가까운 쪽에서만 뜻이 있다 (아래 t.c === 'late' 주석)
    if (t.c === 'late') out.push({ crosswalk: 'C', at: arrowAt, startWithin: 9, from: 'right', speed: 1.8, kind, ...late });
    if (t.c === 'mixed') {
      // 신호를 지키는 사람은 기다리는 동안의 녹색에 건너가고, 무단횡단자는 녹색 화살표에 맞춰 적색에 나선다
      const obeysSide = side(12);
      out.push({ crosswalk: 'C', at: 0, startWithin: 24, from: obeysSide, kind: companion(t) });
      out.push({ crosswalk: 'C', at: arrowAt + 1, startWithin: 24, from: other(obeysSide), kind, ...late });
    }
    return out;
  }
  /*
    **첫 횡단보도에서 늦어지는 판은 C 의 사람을 시각으로 나서게 한다.** 첫 횡단보도에 사람이 있거나(그 사람을 기다린다)
    보호구역 신호기 없는 첫 횡단보도라면(반드시 선다) 나는 C 에 5~10초 늦게 닿는다. C 에서 신호를 지키는 사람이 "내가
    다가오기를" 기다리게 두었더니, 그사이 보행신호가 점멸로 바뀌어 노란 느낌표를 띄웠다가 뜻을 접었다 — 4927번에서 짚은
    것과 같은 모습이다 (플레이테스트가 잡았다). 이런 판에서는 C 의 사람이 **녹색이 끝나기 전에(11초)** 스스로 나서, 내가
    닿을 때 아직 건너고 있게 한다.
  */
  const lateToC = t.a !== 'none' || (t.zone === 'yes' && t.sigA === 'no');
  const cSelfStart = lateToC && t.sigC === 'yes' && pedCGreen(t);
  const cAt = 11 + (t.approach === 'none' ? 0 : APPROACH_EXTRA[t.approach]);
  /*
    **어느 쪽 보도에서 건너오는지도 판마다 다르다.** 예전에는 C 의 '건너려고 대기' 와 '무단횡단하려고 대기'
    가 늘 `'right'`(내 차와 같은 쪽 보도)였다. 그래서 두 번째 횡단보도의 사람이 **65%가 차량쪽**이었고,
    실제로 40판을 달려 보면 그중 29판이 같은 쪽이었다 (사용자: "두 번째 횡단보도의 사람도 항상 차량쪽
    보행자만 나오는 것 같아").

    반대편에서 오는 사람은 **내 차로에 닿기까지 시간이 더 걸린다** — 멀리서 보이지만 늦게 도착하므로
    "다 건널 때까지 기다린다" 를 시험하는 장면이 된다. 판 번호(`seed`)로 가르므로 같은 판은 늘 같은 쪽이다.
  */
  if (t.c === 'waiting') {
    out.push(
      cSelfStart
        ? { crosswalk: 'C', at: cAt, from: side(7), kind }
        : { crosswalk: 'C', at: 0, startWithin: 12, from: side(7), kind, ...freeC },
    );
  }
  /*
    정면 적색이면 정지선에서 한 번 서고 간다. 정지선 앞 24m 에서 나서게 두었더니 서 있는 사이에 다 건너가,
    어른 · 아이는 C 에 닿을 때 아무도 없었다 — **정지선을 떠난 뒤**(C 앞 14m) 나서게 한다.
  */
  /*
    보호구역 신호기 없는 C 도 **반드시 한 번 서고** 가므로 같은 까닭으로 늦게(16m) 나선다 — 24m 에서 나선 어린이는 내가
    C 앞에서 1초 남짓 서는 사이 다 건너, 보행자를 안 보고 그 일시정지만 한 운전자도 걸리지 않았다 (플레이테스트가 잡았다).
  */
  if (t.c === 'crossing') {
    const within = t.signal === 'red' ? 14 : t.sigC === 'no' ? 16 : 24;
    out.push(
      // 첫 횡단보도에서 늦어지는 판은 시각으로 나선다 (위 cSelfStart) — 24m 에서 나선 아이는 내가 닿기 전에 다 건넜다
      cSelfStart
        ? { crosswalk: 'C', at: cAt, from: side(4), kind }
        : { crosswalk: 'C', at: 0, startWithin: within, from: side(4), kind, ...freeC },
    );
  }
  if (t.c === 'jaywalk') out.push({ crosswalk: 'C', at: 0, startWithin: 16, from: side(6), obeysSignal: false, kind });
  if (t.c === 'group') {
    // 차례로 나선다 — 한 사람이 끝나도 다음 사람이 남아 "통행 종료" 를 끝까지 확인하게 한다
    const obeys = t.sigC === 'no' || !pedCGreen(t) ? { obeysSignal: false } : {};
    // 둘은 서로 다른 쪽에서 온다 (위 side · other) — 어느 쪽이 먼저인지도 판마다 뒤집힌다
    const first = side(14);
    out.push({ crosswalk: 'C', at: 0, startWithin: 24, from: first, kind, ...obeys });
    // 둘째 사람도 늦어지는 판에서는 시각으로 나선다 (위 cSelfStart)
    out.push(
      cSelfStart
        ? { crosswalk: 'C', at: cAt + 1.5, from: other(first), kind: companion(t) }
        : { crosswalk: 'C', at: 0, startWithin: 16, from: other(first), kind: companion(t), ...obeys },
    );
  }
  /*
    **셋** — 한쪽에서 차례로 건넌다. `group`(양방향 둘)과 달리 **같은 쪽**이라, 다 건넌 줄 알고 출발하면
    뒤따르는 사람 앞을 지나가게 된다. 늦어지는 판에서는 시각으로 나선다 (위 cSelfStart).
  */
  if (t.c === 'crowd') {
    const from = side(18);
    const obeys = t.sigC === 'no' || !pedCGreen(t) ? { obeysSignal: false } : {};
    /*
      **셋이 다 건너야 한다.** 늦어지는 판은 시각으로 나서는데(cSelfStart), 둘이 나서던 자리(cAt · cAt+1.5)를
      셋에 그대로 쓰니 마지막 사람이 **C 보행녹색이 끝나는 순간**(14초)에 걸려 뜻을 접었다 — 제목은 "세 사람이
      차례로 건넌다" 인데 둘만 건너는 판이 180개였다 (플레이테스트가 잡았다).

      **한 사람 몫만큼 앞당기고 간격을 1초로 좁힌다** (cAt−1 · cAt · cAt+1). 셋 다 녹색 안에서 발을 떼고,
      가장 먼저 뗀 사람도 22.8m 를 건너는 데 6.3초가 걸려 내가 닿을 때 아직 차도 위에 있다. 간격을 좁혀도
      한 걸음이 3.6m 라 '차례로' 는 그대로 보인다.
    */
    for (const [i, within] of [24, 18, 12].entries()) {
      out.push(
        cSelfStart
          ? { crosswalk: 'C', at: cAt - 1 + i, from, kind: i === 0 ? kind : 'adult' }
          : { crosswalk: 'C', at: 0, startWithin: within, from, kind: i === 0 ? kind : 'adult', ...obeys },
      );
    }
  }
  if (t.c === 'late') {
    /*
      코너를 돌고 있을 때 **가까운 쪽에서** 뛰어든다 — 돌면서도 횡단보도를 보고 있었는가.
      여기만 `'right'` 를 그대로 둔다: 반대편에서 뛰어들면 내 차로에 닿기까지 시간이 남아
      "돌자마자 코앞" 이라는 이 판의 장면이 아예 사라진다.
    */
    out.push({ crosswalk: 'C', at: 0, startWithin: 9, from: 'right', obeysSignal: false, speed: 1.8, kind });
  }
  if (t.c === 'maybe') {
    // 나올 때도 안 나올 때도 있다 — 어느 쪽이든 서야 한다 (제27조 제7항). **07번을 그대로 재현하므로 쪽도 그대로다**
    out.push({ crosswalk: 'C', at: 0, startWithin: 16, from: 'left', obeysSignal: false, kind: 'child', chance: 0.5 });
  }
  // 무단횡단하려는 사람 — A 와 같다. C 는 코너 너머라 조금 더 멀리서(10m) 나선다. 쪽은 판마다 다르다 (위)
  if (t.c === 'jaywalkWait') out.push({ crosswalk: 'C', at: 0, startWithin: 10, from: side(8), obeysSignal: false, kind });
  if (t.c === 'mixed') {
    // 내 차를 보내는 사람과 무단횡단자는 서로 다른 쪽에서 온다 (위 side · other)
    const waits = side(15);
    out.push({ crosswalk: 'C', at: 0, from: waits, kind: companion(t), letsCarPass: true });
    out.push({ crosswalk: 'C', at: 0, startWithin: 10, from: other(waits), obeysSignal: false, kind });
  }

  /*
    ── 덧붙이는 사람들 (EXTRAS) ──
    자전거는 기본 자전거 판과 같은 방아쇠(타고 6m · 끌고 12m)를 쓴다 — 멀리서 나서면 내가 닿기 전에 다 건너 역할을 잃는다.
    함께 선 사람은 보호구역이면 아이다(companion). 진입로 횡단보도의 아이는 pedestriansOf 의 것과 같은 값이다.
  */
  const x = extrasOf(t);
  if (x.rideA) out.push({ crosswalk: 'A', at: 0, startWithin: 6, from: side(41), kind: companion(t), bike: 'ride', ...freeA });
  if (x.pushA) out.push({ crosswalk: 'A', at: 0, startWithin: 12, from: side(42), kind: companion(t), bike: 'push', ...freeA });
  /*
    우회전 후 횡단보도의 자전거 · 끄는 사람은 **기본 C 사람과 같은 시각 규칙**을 따른다 (위 cSelfStart) — 첫 횡단보도에서
    늦어지는 판에서 처음부터 서서 차를 기다리게 두었더니, 녹색이 점멸로 바뀌어 뜻을 접고 서 있기만 했다 (플레이테스트가 잡았다).
  */
  if (x.rideC) {
    // 자전거는 걸음의 두 배라 **먼저**(cAt−1) 나선다 — cAt+2 로 두었더니 녹색점멸에 걸려 뜻을 접었다 (플레이테스트가 잡았다).
    // 22.8m 를 9초에 건너므로 내가 우회전 후 횡단보도에 닿을 때(약 30초) 아직 차도 위에 있다
    out.push(
      cSelfStart
        ? { crosswalk: 'C', at: cAt - 1, from: side(43), kind: companion(t), bike: 'ride' }
        : { crosswalk: 'C', at: 0, startWithin: 6, from: side(43), kind: companion(t), bike: 'ride', ...freeC },
    );
  }
  if (x.pushC) {
    out.push(
      cSelfStart
        ? { crosswalk: 'C', at: cAt, from: side(44), kind: companion(t), bike: 'push' }
        : { crosswalk: 'C', at: 0, startWithin: 12, from: side(44), kind: companion(t), bike: 'push', ...freeC },
    );
  }
  if (x.pedS) out.push({ crosswalk: 'S', at: 0, startWithin: 14, from: side(45), obeysSignal: false, kind: 'child' });
  /*
    **같은 쪽에서 한 사람 더** — 첫 횡단보도(있으면) 아니면 우회전 후 횡단보도의 그 사람과 같은 보도에서, 조금 뒤에 나선다.
    거리로 나서는 사람은 4m 뒤에, 시각으로 나서는 사람은 1.5초 뒤에 — `crowd`(한쪽 셋)의 간격과 같은 사고다.
  */
  if (x.pair) {
    const at = singleWalker(t.a) ? 'A' : 'C';
    const first = out.find((p) => p.crosswalk === at && !p.bike && p.chance === undefined);
    if (first) {
      const follow: PedSpawn =
        first.startWithin !== undefined
          ? { ...first, startWithin: Math.max(3, first.startWithin - 4), kind: companion(t) }
          : { ...first, at: first.at + 1.5, kind: companion(t) };
      out.push(follow);
    }
  }
  return out;
}

function environmentOf(t: LibraryTags, seed: number): { timeOfDay: TimeOfDay; weather: Weather; crossTraffic: number } {
  const crossTraffic = Math.floor(hash(seed + 13) * 3);
  if (t.env === 'night') return { timeOfDay: 'night', weather: 'clear', crossTraffic };
  if (t.env === 'rain') return { timeOfDay: hash(seed + 11) < 0.5 ? 'day' : 'dusk', weather: 'rain', crossTraffic };
  return { timeOfDay: 'day', weather: 'clear', crossTraffic };
}

// ── 글 ──────────────────────────────────────────────────────────────────────

const SIGNAL_TITLE: Record<LibraryTags['signal'], string> = {
  green: '정면신호 녹색',
  red: '정면신호 적색',
  arrowRed: '우회전신호 적색',
  arrowGreen: '우회전신호 녹색',
};
const KIND_WORD: Record<LibraryTags['kind'], string> = { adult: '보행자', child: '어린이', elder: '노인' };

function titleOf(t: LibraryTags, peds: readonly PedSpawn[] = []): string {
  const who = KIND_WORD[t.kind];
  const parts: string[] = [];
  if (t.zone === 'yes') {
    parts.push(
      t.sigA === 'no' ? '보호구역 첫 횡단보도 무신호' : t.sigC === 'no' ? '보호구역 우회전 후 무신호' : '어린이보호구역',
    );
  }
  if (t.approach === 'signal') parts.push('진입로 보호구역 신호 횡단보도');
  if (t.approach === 'noSignal') parts.push('진입로 보호구역 무신호 횡단보도');
  // 그 횡단보도에 선 아이 — 판 번호가 아니라 태그로 갈리므로 제목이 판과 어긋나지 않는다 (hasApproachPed)
  if (hasApproachPed(t) || extrasOf(t).pedS) parts.push('진입로 횡단보도 어린이');
  if (t.a === 'waiting') parts.push(`첫 횡단보도 건너려는 ${who}`);
  if (t.a === 'crossing') parts.push(`첫 횡단보도 ${who}`);
  if (t.a === 'jaywalk') parts.push(`첫 횡단보도 무단횡단 ${who}`);
  if (t.a === 'jaywalkWait') parts.push(`첫 횡단보도 무단횡단하려는 ${who}`);
  if (t.a === 'mixed') parts.push(`첫 횡단보도 신호 지키는 사람 · 무단횡단 ${who}`);
  // 건너는 방향과 사람 수를 제목에 적는다 — 무엇을 봐야 하는 판인지가 제목에서 갈린다
  if (t.a === 'bothWays') parts.push(`첫 횡단보도 양방향 ${who} 둘`);
  if (t.a === 'crowd') parts.push(`첫 횡단보도 한쪽에서 ${who} 셋`);
  // 자전거 — 자전거횡단도가 있으면 타고, 없으면 끌고 건넌다 (사용자가 정한 장면)
  /*
    **타고 건너는 사람을 '보행자' 라고 부르지 않는다** (KIND_WORD 의 adult 는 '보행자' 다) —
    제2조 제17호상 보행자가 아니기 때문이다. 끌고 가는 사람은 보행자이므로 그대로 부른다.
  */
  const rider = { adult: '어른', child: '어린이', elder: '노인' }[t.kind];
  if (t.a === 'bikeRide') parts.push(`첫 횡단보도 자전거횡단도 · 타고 건너는 ${rider} 자전거`);
  if (t.a === 'bikePush') parts.push(`첫 횡단보도 자전거 끌고 건너는 ${who}`);
  // 사람이 한쪽에만 있으면 종류를 그쪽에 붙인다 (양쪽이면 첫 횡단보도에 이미 붙었다)
  const cWho = t.a === 'none' ? who : '보행자';
  if (t.c === 'waiting') parts.push(`우회전 후 건너려는 ${cWho}`);
  if (t.c === 'crossing') parts.push(`우회전 후 ${cWho}`);
  if (t.c === 'jaywalk') parts.push(`우회전 후 무단횡단 ${cWho}`);
  // `group` 은 양쪽에서 한 사람씩이다 (pedestriansAlone) — 제목에도 그렇게 적는다
  if (t.c === 'group') parts.push(t.a !== 'none' || t.kind === 'adult' ? '우회전 후 양방향 보행자 둘' : `우회전 후 양방향 ${who} 포함 둘`);
  if (t.c === 'crowd') parts.push(t.a !== 'none' || t.kind === 'adult' ? '우회전 후 한쪽에서 보행자 셋' : `우회전 후 한쪽에서 ${who} 포함 셋`);
  if (t.c === 'late') parts.push(`우회전 중 뛰어드는 ${cWho}`);
  if (t.c === 'maybe') parts.push('아이가 나올 수도 있음');
  if (t.c === 'jaywalkWait') parts.push(`우회전 후 무단횡단하려는 ${cWho}`);
  if (t.c === 'mixed') parts.push(`우회전 후 신호 지키는 사람 · 무단횡단 ${cWho}`);
  {
    // 덧붙이는 사람들 (EXTRAS) — 판마다 제목이 달라야 한다 (tests: 제목이 모두 다르다)
    const x = extrasOf(t);
    const rider = companion(t) === 'child' ? '어린이' : '어른';
    if (x.rideA) parts.push(`첫 횡단보도 자전거횡단도 · 함께 타고 건너는 ${rider} 자전거`);
    if (x.pushA) parts.push('첫 횡단보도 자전거 끌고 건너는 사람 함께');
    if (x.rideC) parts.push(`우회전 후 자전거횡단도 · 타고 건너는 ${rider} 자전거`);
    if (x.pushC) parts.push('우회전 후 자전거 끌고 건너는 사람');
    if (x.pair) parts.push('같은 쪽에서 한 사람 더');
  }
  // 건너는 방향 — 판의 실제 사람들에서 읽는다 (SIDES 축이 같은 모양을 두 방향으로 만든다)
  parts.push(...sidePhrases(t, peds));
  if (t.lead === 'lawful') parts.push('앞차 우회전');
  if (t.lead === 'rolling') parts.push('앞차 일시정지 무시');
  if (t.lead === 'straight') parts.push('앞차 직진 대기');
  if (t.jam === 'jam') parts.push('진출로 정체');
  const hasSubject = parts.length > 0;
  if (t.pressure === 'honk') parts.push('뒤차 경적');
  if (t.env === 'night') parts.push('야간');
  if (t.env === 'rain') parts.push('빗길');
  return `${SIGNAL_TITLE[t.signal]} - ${[...(hasSubject ? [] : ['보행자 없음']), ...parts].join(' · ')}`;
}

/**
 * 횡단보도마다 사람들이 **한쪽에서만** 오면 그 쪽을 적는다 — 운전자 기준 왼쪽(맞은편 보도) · 오른쪽(내 차 쪽 보도).
 * 양쪽에서 오면 제목이 이미 '양방향' 이라고 말하므로 적지 않는다.
 */
function sidePhrases(t: LibraryTags, peds: readonly PedSpawn[]): string[] {
  const name = { S: '진입로', A: '첫 횡단보도', C: '우회전 후' } as const;
  const out: string[] = [];
  for (const cw of mirrorableCrosswalks(t, peds)) {
    const from = peds.find((p) => p.crosswalk === cw)!.from;
    out.push(`${name[cw]} ${from === 'left' ? '왼쪽' : '오른쪽'}에서`);
  }
  return out;
}

function briefOf(t: LibraryTags): string {
  const s: string[] = [];
  if (t.approach === 'signal') s.push('교차로에 닿기 전 어린이보호구역의 신호 있는 횡단보도를 지납니다.');
  if (t.approach === 'noSignal') s.push('교차로에 닿기 전 어린이보호구역의 신호기 없는 횡단보도를 지납니다.');
  if (t.zone === 'yes') {
    s.push(
      t.sigA === 'no'
        ? '교차로가 어린이보호구역이고, 정지선 앞 첫 횡단보도에는 신호기가 없습니다.'
        : t.sigC === 'no'
          ? '교차로가 어린이보호구역이고, 우회전 후 횡단보도에는 신호기가 없습니다.'
          : '교차로가 어린이보호구역입니다. 두 횡단보도 모두 신호기가 있습니다.',
    );
  }
  s.push(
    {
      green: '정면 차량신호등은 녹색입니다.',
      red: '정면 차량신호등은 적색입니다.',
      arrowRed: '정지선 옆 우회전 신호등이 적색입니다. 정면 차량신호등은 녹색입니다.',
      arrowGreen: '정지선 옆 우회전 신호등이 녹색 화살표입니다.',
    }[t.signal],
  );
  const who = t.kind === 'adult' ? '사람' : KIND_WORD[t.kind];
  if (t.a === 'waiting') s.push(`첫 횡단보도 앞에 ${who}이(가) 건너려고 서 있습니다.`);
  else if (t.a === 'jaywalkWait') s.push(`첫 횡단보도 앞에 ${who}이(가) 보행신호가 적색인데도 건너려고 서 있습니다.`);
  else if (t.a === 'mixed') s.push(`첫 횡단보도에 신호를 지키는 사람과, 신호를 무시하려는 ${who}이(가) 함께 있습니다.`);
  else if (t.a === 'bothWays') s.push(`첫 횡단보도를 ${who}이(가) 양쪽에서 한 사람씩 건너려 합니다.`);
  else if (t.a === 'crowd') s.push(`첫 횡단보도를 ${who}을(를) 포함해 세 사람이 차례로 건너려 합니다.`);
  else if (t.a === 'bikeRide')
    s.push(
      `첫 횡단보도 옆에 자전거횡단도(붉은 띠에 자전거 표시)가 있고, ${{ adult: '어른', child: '어린이', elder: '노인' }[t.kind]}이(가) 자전거를 타고 건너려 합니다.`,
    );
  else if (t.a === 'bikePush') s.push('첫 횡단보도를 자전거에서 내려 끌고 건너려는 사람이 있습니다.');
  else if (t.a !== 'none') s.push(`정지선 앞 첫 횡단보도에 ${who}이(가) 있습니다.`);
  if (t.c === 'waiting') s.push('우회전해서 나가는 횡단보도 앞에 건너려는 사람이 서 있습니다.');
  else if (t.c === 'group') s.push('우회전해서 나가는 횡단보도를 양쪽에서 한 사람씩 건넙니다.');
  else if (t.c === 'crowd') s.push('우회전해서 나가는 횡단보도를 한쪽에서 세 사람이 차례로 건넙니다.');
  else if (t.c === 'late') s.push('우회전하는 동안 횡단보도를 계속 보세요.');
  else if (t.c === 'maybe') s.push('아이가 나올 때도, 나오지 않을 때도 있습니다.');
  else if (t.c === 'jaywalkWait') s.push('우회전해서 나가는 횡단보도 앞에 보행신호가 적색인데도 건너려는 사람이 서 있습니다.');
  else if (t.c === 'mixed') s.push('우회전해서 나가는 횡단보도에 신호를 지키는 사람과, 신호를 무시하려는 사람이 함께 있습니다.');
  else if (t.c !== 'none') s.push('우회전해서 나가는 횡단보도에 사람이 있습니다.');
  {
    const x = extrasOf(t);
    if (x.rideA) s.push('첫 횡단보도 옆 자전거횡단도로 자전거도 함께 건넙니다 — 걸음보다 빠릅니다.');
    if (x.pushA) s.push('첫 횡단보도를 자전거에서 내려 끌고 건너는 사람도 있습니다.');
    if (x.rideC) s.push('우회전해서 나가는 횡단보도 옆에도 자전거횡단도가 있어 자전거가 타고 건넙니다.');
    if (x.pushC) s.push('우회전해서 나가는 횡단보도를 자전거에서 내려 끌고 건너는 사람도 있습니다.');
    if (x.pedS) s.push('진입로 보호구역 횡단보도에도 아이가 서 있습니다.');
    if (x.pair) s.push('같은 보도에서 두 사람이 차례로 건넙니다 — 앞사람이 지나갔다고 끝이 아닙니다.');
  }
  if (t.lead !== 'none' && hasPeds(t)) s.push('앞차가 지나간 뒤에도 횡단보도를 보세요.');
  if (t.lead === 'lawful') s.push('앞차가 먼저 우회전합니다.');
  if (t.lead === 'rolling') s.push('앞차가 먼저 우회전하려 합니다. 앞차를 잘 보세요.');
  if (t.lead === 'straight') s.push('앞차가 정지선에서 직진하려고 기다립니다.');
  if (t.jam === 'jam') s.push('우회전해서 나가는 길이 막혀 있습니다.');
  if (t.pressure === 'honk') s.push('뒤차가 급합니다.');
  if (t.env === 'night') s.push('밤이라 보행자가 잘 보이지 않습니다.');
  if (t.env === 'rain') s.push('비가 와 노면이 미끄럽고 시야가 흐립니다.');
  return s.join(' ');
}

function teachesOf(t: LibraryTags): string {
  const s: string[] = [];
  /*
    **자전거는 두 얼굴이다.** 운전자가 알아봐야 하는 것은 노면의 붉은 띠다 — 있으면 타고 건너는
    자전거가 오고(제15조의2 제3항 일시정지), 없으면 내려서 끌고 건너는 사람이 오며 그 사람은 보행자다
    (제13조의2 제6항 · 제2조 제17호).
  */
  if (t.a === 'bikeRide' || extrasOf(t).rideA || extrasOf(t).rideC) {
    s.push(
      '횡단보도 옆의 붉은 띠에 자전거 표시가 있으면 자전거횡단도입니다 — 자전거가 타고 건널 수 있는 곳이고, 그 앞에서 일시정지해야 합니다(제15조의2 제3항).',
    );
    s.push('타고 건너는 자전거는 걸어오는 사람보다 두 배 넘게 빠릅니다 — 멀리 있다고 먼저 지나가지 마세요.');
  }
  if (t.a === 'bikePush' || extrasOf(t).pushA || extrasOf(t).pushC) {
    s.push(
      '자전거횡단도가 없는 횡단보도에서는 자전거에서 내려 끌고 건너야 합니다(제13조의2 제6항). 그렇게 끌고 가는 사람은 보행자입니다(제2조 제17호) — 보행자 보호 의무가 그대로 걸립니다.',
    );
  }
  if (t.signal === 'red') {
    s.push('정면 차량신호등이 적색이면 보행자가 없어도 정지선 앞에서 반드시 일시정지한 뒤 우회전합니다.');
  }
  if (t.signal === 'green') {
    s.push('정면 신호가 녹색이어도 횡단보도를 통과할 권리가 생기는 것은 아닙니다 — 보행자의 통행 여부가 기준입니다.');
  }
  if (t.signal === 'arrowRed') {
    s.push('우회전 신호등이 있으면 다른 신호에도 불구하고 그 등화를 따릅니다(시행규칙 [별표 2] 비고 제3호). 적색 화살표에는 우회전할 수 없고, 녹색 화살표를 기다립니다.');
    if (hasPeds(t)) {
      s.push('녹색 화살표가 켜져도 횡단보도에 사람이 있으면 섭니다 — 보행신호가 바뀐 뒤에 늦게 건너거나 무단횡단하는 사람도 보호해야 합니다.');
    }
  }
  if (t.signal === 'arrowGreen') {
    s.push('우회전 신호등의 녹색 화살표는 정지 의무 없이 우회전할 수 있다는 뜻입니다. 그래도 횡단보도의 보행자는 늘 확인합니다.');
  }
  if ([t.a, t.c].some((p) => p === 'jaywalk' || p === 'jaywalkWait' || p === 'mixed')) {
    s.push('보행신호가 적색이어도 횡단보도에 건너려는 사람이 있으면 섭니다 — 사람이 신호를 어겼다고 그 앞을 지나가도 되는 것은 아닙니다.');
  }
  if (t.a === 'mixed' || t.c === 'mixed') {
    s.push('보도에 선 사람이 모두 신호를 지키는 것은 아닙니다 — 서 있는 사람을 끝까지 보고, 한 사람이라도 나서면 섭니다.');
  }
  if (t.lead !== 'none' && hasPeds(t)) {
    s.push('앞차가 지나간 바로 뒤로 사람이 나설 수 있습니다 — 앞차만 보고 따라가지 말고 횡단보도를 직접 봅니다.');
  }
  if (t.a === 'waiting' || t.c === 'waiting') {
    s.push('보행자가 건너려고 서 있기만 해도 "통행하려고 하는 때" 입니다 — 횡단보도 앞에서 정지합니다(제27조 제1항).');
  } else if (t.a === 'bikeRide') {
    // 타고 건너는 자전거는 보행자가 아니다 — 제27조 제1항을 여기에 적으면 틀린 것을 가르친다
  } else if (hasPeds(t)) {
    s.push('보행자가 통행하거나 통행하려 하면, 보행신호와 관계없이 통행이 끝날 때까지 횡단보도 앞에서 정지합니다(제27조 제1항).');
  }
  if (t.kind === 'elder' && hasPeds(t)) s.push('노인은 천천히 건넙니다 — 다 건널 때까지 기다립니다.');
  if (t.kind === 'child' && hasPeds(t)) s.push('어린이는 작아서 늦게 보이고, 갑자기 뛰어듭니다.');
  if ((t.zone === 'yes' && (t.sigA === 'no' || t.sigC === 'no')) || t.approach === 'noSignal') {
    s.push('어린이보호구역 안의 신호기 없는 횡단보도 앞에서는 보행자가 없어도 일시정지합니다(제27조 제7항).');
  }
  if (t.zone === 'yes' && t.sigA === 'yes' && t.sigC === 'yes') {
    s.push('어린이보호구역에서는 30km/h 이하로 달리고, 신호가 있는 횡단보도에서도 보행자를 먼저 확인합니다.');
  }
  if (t.approach === 'signal') {
    s.push('어린이보호구역의 신호 있는 횡단보도가 적색이면 녹색이 될 때까지 기다립니다. 보호구역에서는 30km/h 이하로 달립니다.');
  }
  if (t.lead === 'rolling') s.push('앞차가 일시정지 없이 가도, 규정은 운전하는 나에게 걸립니다 — "앞차가 가니까" 는 이유가 되지 않습니다.');
  if (t.lead === 'lawful') s.push('앞차가 서면 나도 섭니다. 앞차가 떠난 뒤에도 보행자의 통행이 끝났는지 직접 확인합니다.');
  if (t.lead === 'straight') s.push('직진 대기 차량 뒤에서는 기다립니다 — 옆으로 비켜 돌아 나가면 대회전(제25조 제1항)입니다. 앞차 뒤에서 선 것은 정지선 일시정지가 아닙니다.');
  if (t.jam === 'jam') s.push('진출로가 막혀 있으면 신호와 관계없이 교차로에 들어가지 않고 정체가 풀리기를 기다립니다(제25조 제5항).');
  if (t.pressure === 'honk') s.push('뒤차가 경적을 울려도 서야 할 곳에서는 섭니다 — 재촉은 위반의 이유가 되지 않습니다.');
  if (t.env !== 'day') s.push('밤이나 빗길에는 보행자가 늦게 보이므로 더 천천히 접근합니다.');
  return s.join(' ');
}

/** 이 판이 잡아낼 수 있는 위반 — 대회전·방향지시등은 어느 판에서나 잡혀 적지 않는다 */
function targetsOf(t: LibraryTags): ViolationCode[] {
  const out = new Set<ViolationCode>();
  if (t.signal === 'red') {
    out.add('RED_NO_STOP');
    out.add('OVER_STOP_LINE');
  }
  /*
    **앞차가 먼저 기다려 주는 신호는 내가 어길 수 없다.** 적색 화살표 · 진입로 보호구역 적색 앞에서 앞차가 서면 나는
    그 뒤에 줄을 서고, 앞차는 녹색에 떠난다 — 나는 녹색에만 그 자리에 닿는다. 그런데도 이 위반을 시험한다고 적어 두면
    그 습관이 앞차 판 몇 번으로 '고쳐졌다' 가 된다 (플레이테스트가 잡았다). 앞차를 비켜 돌아 나가면 어길 수는 있지만,
    그때 잡히는 것은 대회전이다.
  */
  if (t.signal === 'arrowRed' && t.lead === 'none') out.add('RIGHT_ARROW_RED');
  /*
    사람이 있어야 보행자 위반이 난다. 예전에는 앞차가 규정대로 도는 판에도 붙였는데, 사람이 없는 판에서는 일어날 수
    없는 위반이라 그 판을 몇 번 무사히 지나도 "보행자 습관을 고쳤다" 로 셌다 (플레이테스트가 잡았다).
  */
  /*
    **타고 건너는 자전거는 보행자가 아니다** — 그 판이 시험하는 것은 `BIKE_BLOCKED` 다 (제15조의2 제3항).
    끌고 건너는 사람은 보행자이므로 `PEDESTRIAN_BLOCKED` 그대로다 (제2조 제17호).
  */
  const x = extrasOf(t);
  /*
    **덧붙인 자전거는 첫 횡단보도가 비었을 때만 시험한다.** 걷는 사람과 함께 선 자전거는 그 사람에게 가려 — 안 보는 운전자는
    사람 앞에서 먼저 걸리고 자전거는 그 뒤에 나선다 — 판이 자전거 위반을 잡지 못했다 (플레이테스트가 잡았다: 시험못함).
    시험하지 못하는 위반을 적어 두면 그 판 몇 번으로 습관이 '고쳐졌다' 가 된다.
  */
  if (t.a === 'bikeRide' || (x.rideA && t.a === 'none')) out.add('BIKE_BLOCKED');
  if ((t.a !== 'bikeRide' && hasPeds(t)) || hasApproachPed(t) || x.pushA || x.pushC || x.pedS || x.pair) out.add('PEDESTRIAN_BLOCKED');
  if ((t.zone === 'yes' && (t.sigA === 'no' || t.sigC === 'no')) || t.approach === 'noSignal') out.add('SCHOOL_ZONE_NO_STOP');
  if (t.approach === 'signal' && t.lead === 'none') out.add('SCHOOL_ZONE_RED');
  if (t.lead === 'rolling') out.add('RED_NO_STOP');
  if (t.lead === 'straight') out.add('WIDE_TURN');
  if (t.jam === 'jam') out.add('BLOCKING_INTERSECTION');
  if (t.env !== 'day' || t.c === 'late') out.add('NO_SLOW_DOWN');
  return [...out];
}

/** 태그 → 판. 조합 규칙을 통과한 것만 부른다 */
export function buildLibrarySpec(t: LibraryTags): ScenarioSpec {
  const id = libraryId(t);
  // 거울상 판은 환경 · 교차 차량 · 사람의 종류와 시각을 쌍둥이(auto) 판에서 그대로 가져온다 — 방향만 다르다 (SIDES 주석)
  const seed = t.side === 'flip' ? libraryId({ ...t, side: 'auto' }) : id;
  const env = environmentOf(t, seed);
  const leadKind: LeadPlan | null = t.lead === 'none' ? null : t.lead;
  const pedestrians = pedestriansOf(t, seed);
  const spec: ScenarioSpec = {
    id,
    title: titleOf(t, pedestrians),
    brief: briefOf(t),
    teaches: teachesOf(t),
    ...startOf(t),
    pedSignalInstalled: { A: t.sigA === 'yes', C: t.sigC === 'yes' },
    /*
      **자전거횡단도는 타고 건너는 판에만 그린다.** 끌고 건너는 판에 그려 두면 판의 글이 거짓말이 된다 —
      거기서는 타고 건너도 되는데 굳이 내려서 끄는 셈이 되기 때문이다 (제13조의2 제6항).
    */
    ...(t.a === 'bikeRide' || extrasOf(t).rideA
      ? { bikeLane: 'A' as const }
      : extrasOf(t).rideC
        ? { bikeLane: 'C' as const }
        : {}),
    ...(hasArrow(t) ? { rightArrowInstalled: true } : {}),
    ...(t.approach === 'signal'
      ? {
          /*
            앞차가 있으면 보호구역 신호는 **녹색**이다. 적색이면 앞차가 서고 나는 그 뒤에 줄을 서서, 둘이 함께 떠난 뒤
            교차로까지 3m 간격으로 붙어 가 앞차 뒤로 사람이 나설 틈이 없었다. 앞차 판에서 이 신호는 시험하지 않는다
            (targetsOf — 앞차가 먼저 서 주는 신호는 내가 어길 수 없다).
          */
          approachSchoolZone: { signal: true, signalElapsed: t.lead === 'none' ? APPROACH_SIGNAL_ELAPSED : 0 },
        }
      : t.approach === 'noSignal'
        ? { approachSchoolZone: { signal: false } }
        : {}),
    /*
      **사람이 있는 앞차 판은 앞차와 간격을 넉넉히(4초, LEAD_HEADWAY_MAX)** 둔다. 사람이 앞차 뒤로 나서는데(behindLead), 2초 간격
      (서행에서 6~7m)이면 규정대로 모는 사람도 설 수 없는 거리라 그 사람이 끝내 나서지 못했다.
    */
    ...(leadKind ? { leadCar: leadSpecFor(leadKind, hasPeds(t) ? 4.0 : leadKind === 'rolling' ? 1.6 : 2.0) } : {}),
    pedestrians,
    rearHonk: t.pressure === 'honk',
    crossTraffic: env.crossTraffic,
    exitBlocked: t.jam === 'jam',
    isSchoolZone: t.zone === 'yes',
    timeOfDay: env.timeOfDay,
    weather: env.weather,
  };
  return fitStraightLeadWait(spec);
}

/**
 * **개념 단계** — 판이 쓰는 개념 중 가장 늦게 배우는 것 (0 = 기본). 레벨을 매길 때 줄을 세우는 첫째 기준이다.
 *
 * | 단계 | 개념 |
 * |---|---|
 * | 0 | 정면 녹색 · 적색 + 보행자 한 쪽 (건너는 중 · 대기 · 무단횡단 · 무단횡단하려는) |
 * | 1 | 우회전 신호등 |
 * | 2 | 어린이보호구역 — 신호 있는 횡단보도 · 진입로 보호구역(신호) · **신호기 없는 횡단보도 · 진입로 무신호 · 아이가 나올 수도** |
 * | 4 | 앞차 (규정대로 우회전 · 직진 대기) · 꼬리물기 |
 * | 5 | 앞차 일시정지 무시 |
 * | 6 | 보행자 여럿 · 돌 때 뛰어듦 · 양쪽 횡단보도 · 신호 지키는 사람 + 무단횡단 |
 *
 * **밤 · 비 · 뒤차 경적은 개념 단계가 아니다** — 조건(겹)으로만 센다. 예전에는 이 둘을 L6 · L7 개념으로 두었는데, 밤 · 비는
 * 판의 67%, 경적은 50% 에 들어 있어 이것이 하나라도 들어간 판은 모두 L6 이상으로 밀렸다 — 라이브러리의 85% 가 L9 · L10
 * 이었다 (사용자가 짚었다). 밤 · 비 · 재촉은 규칙이 아니라 **같은 규칙을 더 어렵게 만드는 조건**이라, 어느 레벨에나 나오되
 * 판을 조금 더 뒤로 세운다.
 */
export function conceptStage(t: LibraryTags): number {
  let s = 0;
  const up = (n: number): void => {
    if (n > s) s = n;
  };
  if (hasArrow(t)) up(1);
  /*
    **신호 있는 보호구역과 신호기 없는 보호구역은 같은 단계다.** 예전에는 신호기 없는 쪽을 한 단계 뒤(3)에 두어,
    줄을 세우면 같은 조건의 신호 있는 판보다 늘 두 칸 뒤에 섰다 — 낮은 레벨의 보호구역 판은 거의 다 신호 있는
    판이었다 (보호구역 판 중 무신호 L2 3% · L3 18% · L5 85%). 사용자가 "각 레벨별로 어린이보호구역에 신호없는
    횡단보도가 고르게 나오게" 해 달라고 했다. 같은 단계로 두면 두 판이 조건 수대로 섞여 줄을 서, 레벨마다
    보호구역 판의 절반 남짓(49~58%)이 무신호가 된다. 신호기 없는 보호구역은 이 게임의 핵심이라 보호구역을
    처음 여는 L2 에서 함께 연다.
  */
  if (t.zone === 'yes' || t.approach !== 'none' || t.c === 'maybe') up(2);
  if (t.lead === 'lawful' || t.lead === 'straight' || t.jam === 'jam') up(4);
  if (t.lead === 'rolling') up(5);
  if (severalPeople(t) || t.extra !== 'none') up(6);
  /*
    **한 횡단보도에 둘 이상**은 '보행자 여럿' 의 맨 끝이다 — 양쪽에서 동시에, 또는 한쪽에서 셋이 차례로.
    여럿을 이미 겪은 뒤에 만나야 하므로 그 위의 단계에 둔다. (이 단계에는 `LEVEL_CONCEPTS` 의 열쇠가 없다 —
    새로 여는 개념이 아니라 **같은 개념의 가장 어려운 모습**이라, 레벨 안내에 한 줄 더 적을 것이 없다.)
  */
  /*
    **덧붙인 사람이 둘 이상**(rideApushC · rideCpushC · pedSrideCpushC — 타는 자전거와 끄는 사람, 거기에 진입로 어린이)도
    같은 자리다 — 기본 판의 어느 장면보다 사람이 많다(다섯~일곱). 덧붙인 판을 모두 6 에 두었더니 줄을 세우는 key 가 같아
    일곱 사람 판(M10519)이 세 사람 판(M09020)과 같은 레벨 후보가 되었다.
  */
  if (manyAtOneCrosswalk(t) || extraCount(t) >= 2) up(7);
  return s;
}

/** 덧붙인 사람의 수 — 타는 자전거 · 끄는 사람 · 진입로 어린이를 하나씩 센다 (0~3) */
const extraCount = (t: LibraryTags): number => Object.values(extrasOf(t)).filter(Boolean).length;

/** 보행자 여럿 — 한 판에서 누가 나설지 가려 봐야 하는 판 (여럿 · 돌 때 뛰어듦 · 양쪽 · 신호 지키는 사람 + 무단횡단) */
const severalPeople = (t: LibraryTags): boolean =>
  t.c === 'group' ||
  t.c === 'late' ||
  t.a === 'mixed' ||
  t.c === 'mixed' ||
  manyAtOneCrosswalk(t) ||
  (t.a !== 'none' && t.c !== 'none');

/** 한 횡단보도에 **둘 이상** — 양쪽에서 동시에(`bothWays`) 또는 한쪽에서 셋(`crowd`) */
const manyAtOneCrosswalk = (t: LibraryTags): boolean =>
  t.a === 'bothWays' || t.a === 'crowd' || t.c === 'crowd';

/** **겹친 조건의 수** (0~7) — 신호 · 보행자 · 보호구역 · 앞차 · 여럿 · 밤비 · 재촉. 레벨을 매길 때 줄을 세우는 둘째 기준이다 */
export function layersOf(t: LibraryTags): number {
  return [
    t.signal !== 'green',
    t.a !== 'none' || t.c !== 'none',
    t.zone === 'yes' || t.approach !== 'none',
    t.lead !== 'none',
    severalPeople(t),
    t.env !== 'day',
    t.pressure === 'honk',
    // 덧붙인 사람들은 한 겹 더 — 같은 개념의 가장 복잡한 모습이라 뒤에 선다
    t.extra !== 'none',
  ].filter(Boolean).length;
}

/**
 * **레벨마다 판을 몇 개 두는가** — 오래 머무는 레벨일수록 많다 (L1~L3 218판 … L10 2,187판).
 *
 * 사용자가 레벨업을 경험치로 바꾸며 함께 부탁했다 — "각 레벨의 시나리오 개수는 거기에 맞게 분포를 하게 해줘."
 * 열 판을 머무는 L10 은 같은 판을 되풀이하지 않을 만큼 많아야 하고, 금방 지나가는 레벨에 수천 판이 있을 까닭은 없다.
 *
 * ## 경험치 곡선에 딱 비례하지는 않는다
 *
 * 처음에는 머무는 판 수(XP_TO_NEXT ÷ 한 판의 경험치)에 그대로 비례했다 — 곡선이 1 · 1 · 1 · 2 · 3 · 4 · 5 · 6 · 8 · 10판이던
 * 때의 값이 아래 표다. 그 뒤 "저랩에서 너무 쉽게 올라간다" 는 말에 곡선을 3 · 3 · 4 · 4 · 5 · 5 · 6 · 7 · 8 · 10판으로 올렸는데,
 * 새 곡선에 비례시키면 L1 이 489판이 된다. **기본 개념(정면 신호 · 우회전 신호등)만 쓰는 판은 270개뿐이라** 나머지를 보호구역
 * 판이 채워, 보호구역이 L1 에서 열리고 앞차가 L3, 보행자 여럿이 L5 로 당겨졌다 — 개념이 차례로 열리는 뼈대가 무너졌다.
 *
 * 판 수가 지켜야 할 것은 비례가 아니라 **머무는 동안 같은 판을 되풀이하지 않을 만큼 많은가**다. 이 표로도 가장 빠듯한
 * L3 가 네 판에 218판이다 (tests/library.test.ts 가 어려움 난이도의 판 수로 못 박는다). 그래서 개념 순서를 지키는 이 표를 둔다.
 */
export const LEVEL_SHARE: Readonly<Record<Difficulty, number>> = {
  1: 1,
  2: 1,
  3: 1,
  4: 2,
  5: 3,
  6: 4,
  7: 5,
  8: 6,
  9: 8,
  10: 10,
};

/**
 * **판의 레벨을 매긴다** — 쉬운 판부터 줄을 세우고, 레벨마다 정원(LEVEL_SHARE)만큼 잘라 담는다.
 *
 * 줄을 세우는 기준은 **개념 단계 × 2 + 겹친 조건의 수**다(같으면 난이도 점수 · id 순). 개념이 늦을수록, 조건이 많이
 * 겹칠수록 뒤에 선다. 그래서 개념은 대체로 차례대로 열리고(우회전 신호등 L1 → 보호구역(신호 있음 · 없음) L2 →
 * 앞차 → 일시정지 무시 앞차 · 보행자 여럿 → 종합), 같은 개념도 밤 · 비 · 재촉이 겹친 판은 더 높은 레벨에 선다.
 * 어느 레벨에서 무엇이 열리는지는 `levelGuide` 가 라이브러리에서 읽는다.
 *
 * ## 한때는 "가장 늦게 배우는 개념" 이 곧 레벨이었다
 *
 * L1 에 기본 규칙만, L2 에 우회전 신호등만 … 하나씩 열었다. 그런데 흔한 조건(밤 · 비 67%, 보행자 여럿 64%)이 늦은 레벨의
 * 개념이라, 그것이 든 판은 모두 뒤로 밀려 **라이브러리의 85% 가 L9 · L10** 이었다. 레벨 L1 · L2 는 20판 남짓이었다.
 */
function assignLevels(entries: LibraryEntry[]): void {
  const key = (e: LibraryEntry): number[] => [conceptStage(e.tags) * 2 + layersOf(e.tags), e.cost, e.spec.id];
  const byKey = (p: LibraryEntry, q: LibraryEntry): number => {
    const a = key(p);
    const b = key(q);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  const sorted = [...entries].sort(byKey);
  const total = Object.values(LEVEL_SHARE).reduce((n, x) => n + x, 0);

  /*
    **L1 — 줄의 맨 앞 몫에서 야간 판만 뺀다** (L1_EXCLUDES). 빈자리를 다음 차례의 판으로 채우지 않는다 — 채웠더니 쉬운
    낮 판이 모자라 어린이보호구역 판이 끌려 들어와, 보호구역이 L2 가 아니라 L1 에서 열렸다. 그래서 L1 은 정원(218)보다
    적은 153판이다. L1 은 머무는 판(난이도 5 로도 다섯 판)보다 서른 배 넘게 많아 모자라지 않는다 (tests/library.test.ts).
  */
  /*
    **L1 은 기본 개념 판만 받는다** (conceptStage 0 · 1 — 정면 신호와 우회전 신호등). 정원만으로 자르면
    라이브러리가 커질 때 L1 의 몫도 함께 커져 줄 뒤쪽의 **어린이보호구역 판이 끌려 들어온다** — 실제로
    보행자 축에 값을 더해 판이 8,958 → 11,154 로 늘자 보호구역이 L2 가 아니라 L1 에서 열렸다.
    개념으로 막아 두면 판 수가 얼마가 되든 여는 차례가 흔들리지 않는다.
  */
  /*
    **L1 의 몫은 기본 판(덧붙인 사람 없음)으로 잰다.** 덧붙인 판(EXTRAS)은 모두 어려운 판이라 줄의 뒤에 서는데, 그 수만큼
    L1 의 몫을 키우면 줄 앞쪽의 기본 개념 판을 더 깊이 퍼 가 **한 레벨 위(L2)의 판보다 어려운 판이 L1 에 든다**
    (tests/library.test.ts 가 레벨 사이의 어려움 순서로 못 박는다). 그래서 L1 은 덧붙인 판이 없던 때와 같은 수다.
  */
  /*
    **덧붙인 판(EXTRAS)은 정원 밖의 덤이다.** 기본 판만으로 지금까지와 똑같이 레벨을 매기고(정원 · 야간 비율 · 개념 차례가
    그대로다), 덧붙인 판은 그 어려움(key)이 드는 레벨에 얹는다 — 레벨의 key 범위는 기본 판이 만든 것이라 "한 레벨 위의
    판이 더 어렵거나 같다" 가 그대로 지켜진다. 처음에 덧붙인 판을 기본 판과 함께 줄 세워 정원대로 잘랐더니, 덤의 수만큼
    아래 레벨의 몫이 커져 '보행자 여럿' 이 L7 이 아니라 L6 에서 열렸다 (tests/recommend.test.ts 가 잡았다).
  */
  const base = entries.filter((e) => e.tags.extra === 'none');
  const extras = entries.filter((e) => e.tags.extra !== 'none');
  const l1Count = Math.round((base.length * LEVEL_SHARE[1]) / total);
  const sortedBase = sorted.filter((e) => e.tags.extra === 'none');
  const l1 = new Set(
    sortedBase.slice(0, l1Count).filter((e) => !L1_EXCLUDES(e.tags) && conceptStage(e.tags) <= 1),
  );
  for (const e of l1) e.level = 1;
  /*
    **L2 ~ L10 — 야간 판을 같은 비율로 나눠 담는다.** 사용자가 "야간 판을 레벨 2 ~ 레벨 10 까지 고르게 분포시켜 줘" 라고
    했다. 한 줄로 세우면 밤이 겹친 조건 하나(+1)로 세어져 레벨마다 야간 비율이 23%(L7) ~ 44%(L10)로 들쭉날쭉했고, L1 에서
    옮긴 65판이 몰린 L2 는 41% 였다. 그래서 **야간 판과 나머지 판을 따로 줄 세우고**, 레벨마다 두 줄에서 같은 비율(약 34%
    — 야간 2,986판 ÷ L2 ~ L10 8,805판)로 떠서 담는다. 줄마다 쉬운 판이 앞에 서므로, 같은 환경끼리는 쉬운 판이 낮은 레벨에
    서는 원칙이 그대로다. 레벨의 판 수는 L1 이 덜어 낸 만큼을 L2 ~ L10 이 정원 비율대로 나눠 받는다.
  */
  const rest = sortedBase.filter((e) => !l1.has(e));
  const nights = rest.filter((e) => L1_EXCLUDES(e.tags));
  const others = rest.filter((e) => !L1_EXCLUDES(e.tags));
  const upper = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
  const upperShare = upper.reduce((n, l) => n + LEVEL_SHARE[l], 0);
  let takenNight = 0;
  let takenOther = 0;
  let placed = 0;
  for (const level of upper) {
    const last = level === 10;
    // 앞 레벨까지의 누적 목표에서 빼서 정한다 — 반올림 오차가 뒤로 쌓이지 않는다
    placed += (rest.length * LEVEL_SHARE[level]) / upperShare;
    const nightTo = last ? nights.length : Math.round((placed * nights.length) / rest.length);
    const otherTo = last ? others.length : Math.round(placed) - nightTo;
    for (; takenNight < nightTo; takenNight++) nights[takenNight].level = level;
    for (; takenOther < otherTo; takenOther++) others[takenOther].level = level;
  }
  /*
    **덧붙인 판(EXTRAS) — '보행자 여럿' 이 열린 레벨부터, 어려움 차례로, 정원 비율로 얹는다.**

    덧붙인 판은 모두 사람이 더 선 판이라 '보행자 여럿'(conceptStage 6)이 열리기 전에는 나오지 않는다 — 처음에는 key
    범위만 보고 L6 에도 여덟 판을 두었는데, L6 은 아직 여럿을 열지 않은 레벨이다.

    같은 key 안에서는 **난이도 점수(cost) 순**으로 아래 레벨부터 채운다. 처음에는 key 가 같은 판을 정원이 덜 찬 레벨에
    번갈아 넣었는데, 그러면 같은 key(16)인 판 중 사람 셋 · 13점(M09020)이 L9 에, 사람 일곱 · 21점(M10519)이 L7 에 서는
    식으로 **어려운 판이 쉬운 판보다 낮은 레벨에** 갔다 — 사용자가 "난이도에 맞는 맵을 전체적으로 재검토" 하라고 했다.
    기본 판이 줄을 서는 기준([key, cost, id])과 같은 차례로 세우고, 정원(LEVEL_SHARE)만큼 차면 다음 레벨로 넘어간다.

    다만 **레벨의 key 범위를 벗어나지 않는다** — 범위는 맑은 낮 줄의 기본 판(위 others)이 만든 것이고, tests/library.test.ts
    가 "한 레벨 위의 판은 더 어렵거나 같다" 를 모든 판으로 잰다. 그래서 판마다 key 가 드는 레벨들(여럿을 연 레벨 이상)
    가운데 정원이 남은 가장 낮은 레벨에 두고, 모두 찼으면 그중 가장 높은 레벨에 둔다. 범위 밖(더 어려운) 것은 L10 에 간다.
  */
  const keyOf = (e: LibraryEntry): number => conceptStage(e.tags) * 2 + layersOf(e.tags);
  const range = new Map<number, { min: number; max: number }>();
  for (const e of others) {
    const k = keyOf(e);
    const r = range.get(e.level) ?? { min: k, max: k };
    range.set(e.level, { min: Math.min(r.min, k), max: Math.max(r.max, k) });
  }
  // 여럿이 처음 서는 레벨 — 기본 판 가운데 conceptStage 6 이상(보행자 여럿)이 처음 나오는 레벨 (levelGuide 의 'several' 은 몫이 OPENS_SHARE 를 넘는 레벨이라 한 칸 뒤일 수 있다)
  const firstSeveral = Math.min(...others.filter((e) => conceptStage(e.tags) >= 6).map((e) => e.level));
  const extraLevels = upper.filter((l) => l >= firstSeveral);
  const extraShare = extraLevels.reduce((n, l) => n + LEVEL_SHARE[l], 0);
  const quota = new Map(extraLevels.map((l) => [l, (extras.length * LEVEL_SHARE[l]) / extraShare]));
  const given = new Map<number, number>();
  for (const e of [...extras].sort(byKey)) {
    const k = keyOf(e);
    const fits = extraLevels.filter((l) => {
      const r = range.get(l);
      return r !== undefined && k >= r.min && k <= r.max;
    });
    const open = fits.filter((l) => (given.get(l) ?? 0) < (quota.get(l) ?? 0));
    const pick = open.length ? open[0] : fits.length ? fits[fits.length - 1] : k > (range.get(10)?.max ?? 0) ? 10 : firstSeveral;
    given.set(pick, (given.get(pick) ?? 0) + 1);
    e.level = pick as Difficulty;
  }
  void base;
}

/**
 * **L1 에 두지 않는 판 — 야간.**
 *
 * 사용자가 "레벨 1 에는 야간 운전은 나오지 않게 해 줘" 라고 했다. L1 은 처음 앉은 사람이 적색 일시정지 · 보행자 보호 ·
 * 우회전 신호등이라는 기본 규칙을 처음 익히는 자리다. 밤에는 보행자가 늦게 보여 **규칙을 모르는 것과 못 본 것이 섞이고**,
 * 첫 판부터 어두운 화면이면 무엇을 봐야 하는지부터 헤맨다. 한때 L1 218판 중 65판이 야간이었다.
 *
 * 옮겨 간 야간 판(65판)은 L2 에 선다 — 규칙은 L1 과 같고 어둡기만 한 판이라, L1 을 마친 바로 다음이 맞는 자리다.
 * 비는 두었다 — 낮이라 화면이 밝고, "빗길에는 더 천천히" 는 L1 에서 익혀도 좋은 습관이다. AI 추천도 같은 규칙을 따른다
 * (recommend.ts 의 candidatesFor — 난이도 4 · 5 가 한두 레벨 위의 판을 섞어도 L1 학습자에게는 야간 판을 주지 않는다).
 */
export const L1_EXCLUDES = (t: LibraryTags): boolean => t.env === 'night';

/** 이 판의 레벨 — 라이브러리에서 매긴 값 (assignLevels). 라이브러리 밖의 조합이면 `undefined` */
export function levelOf(t: LibraryTags): Difficulty | undefined {
  return libraryEntry(libraryId(t))?.level;
}

/** 레벨 안내에 쓰는 개념 — 이름과 판별식 */
/**
 * **신호기 없는 보호구역 횡단보도인가** — 이 게임이 가르치려는 핵심이다.
 *
 * 제27조 제7항: 어린이보호구역 안에 **신호기가 없는 횡단보도**는 보행자가 있든 없든 일시정지한다.
 * 다른 판들은 "사람이 있으면 선다" 를 가르치지만, 이 판만 "사람이 없어도 선다" 를 묻는다.
 *
 * 레벨을 매기는 데만 쓰던 판정식인데 **추천도 이것을 본다** — 사용자가 "어린이보호구역에서 신호 없는
 * 횡단보도가 핵심인데 신호 있는 보호구역 횡단보도가 많이 나왔다" 고 짚었다. 보호구역 차례가 와도
 * 진입로 보호구역은 신호 1,632 / 무신호 1,632 로 반반이라, 절반은 핵심이 아닌 판이 나오고 있었다.
 */
export const isNoSignalZone = (t: LibraryTags): boolean =>
  (t.zone === 'yes' && (t.sigA === 'no' || t.sigC === 'no')) || t.approach === 'noSignal' || t.c === 'maybe';

/**
 * **보호구역의 종류** — 추천이 "신호 있는 보호구역만 이어 나오는" 것을 막는 데 쓴다.
 *
 * 지금까지 고르는 쪽은 `zone === 'yes' || approach !== 'none'` 이라는 **불리언 하나**로만 보호구역을
 * 가렸다(recommend.ts 의 `inZone`). 그래서 신호 있는 보호구역이 연달아 나와도 막을 자가 없었다 —
 * 라이브러리 자체는 무신호 53% · 신호 47% 로 거의 반반인데도 그랬다.
 *
 * **셋을 가르는 까닭**: 신호 있는 보호구역도 가르치는 것이 다르다. `approachSignal` 은 `SCHOOL_ZONE_RED`
 * (적색이면 녹색까지 기다린다)를 시험하는 **유일한** 판이고, `signalZone` 은 "신호가 있어도 보행자가
 * 먼저" 를 가르친다. 무신호만 나오면 학습자가 "보호구역 = 무조건 선다" 를 외워 신호 있는 보호구역에서
 * 잘못 판단한다. 없애는 것이 아니라 **비율**로 다뤄야 한다.
 */
export type ZoneKind = 'none' | 'signalZone' | 'approachSignal' | 'noSignal';

export const zoneKindOf = (t: LibraryTags): ZoneKind =>
  isNoSignalZone(t)
    ? 'noSignal'
    : t.approach === 'signal'
      ? 'approachSignal'
      : t.zone === 'yes'
        ? 'signalZone'
        : 'none';

/**
 * 그 횡단보도의 보행자가 **어느 보도에서 오는가** — 태그에 없는 값이라 판(spec)에서 읽는다.
 *
 * 사용자가 "우측에만 사람이 있다" 고 짚은 것이 바로 이 값인데, 12축 어디에도 없어서 추천이 그것을
 * 고칠 방법이 없었다. 되풀이 감점과 경험 커버리지가 이 파생 축을 함께 본다 (recommend.ts).
 */
export const sideOf = (spec: ScenarioSpec, id: CrosswalkId): 'none' | 'left' | 'right' | 'both' => {
  const ps = spec.pedestrians.filter((p) => p.crosswalk === id);
  if (!ps.length) return 'none';
  const left = ps.some((p) => p.from === 'left');
  const right = ps.some((p) => p.from === 'right');
  return left && right ? 'both' : left ? 'left' : 'right';
};

export const LEVEL_CONCEPTS: readonly { key: string; name: string; has: (t: LibraryTags) => boolean }[] = [
  { key: 'arrow', name: '우회전 신호등', has: hasArrow },
  { key: 'zone', name: '어린이보호구역', has: (t) => t.zone === 'yes' || t.approach === 'signal' },
  { key: 'noSignalZone', name: '신호기 없는 보호구역', has: isNoSignalZone },
  { key: 'lead', name: '앞차 · 꼬리물기', has: (t) => t.lead === 'lawful' || t.lead === 'straight' || t.jam === 'jam' },
  { key: 'rolling', name: '앞차 일시정지 무시', has: (t) => t.lead === 'rolling' },
  { key: 'several', name: '보행자 여럿', has: severalPeople },
];

/**
 * **그 개념이 레벨 판의 이만큼을 차지하면 "열었다"** 고 본다.
 *
 * 한때 10% 였다. 그 값은 **라이브러리 크기에 흔들린다** — 보행자 축에 값을 더해 판이 8,958 → 11,154 로 늘자
 * 레벨의 몫도 함께 커져, '보행자 여럿' 이 L6 에서 10.8% 로 문턱을 살짝 넘어 **여는 레벨이 L7 에서 L6 으로 당겨졌다.**
 * 정작 L7 은 79.6% 라, 개념이 실제로 열리는 자리는 누가 봐도 L7 이다 (L6 10.8% → L7 79.6%).
 *
 * 문턱을 15% 로 올리면 그 잡음이 걸러지고, 판 수가 얼마가 되든 **개념이 실제로 자리 잡는 레벨**을 가리킨다.
 * 이 값이 흔들리면 AI 추천의 '새 개념 먼저' 와 '보호구역 · 앞차 차례' 가 함께 흔들린다 (recommend.ts).
 */
const OPENS_SHARE = 0.15;

let guide: Map<number, string[]> | null = null;

/**
 * **이 레벨에서 새로 여는 개념** — 라이브러리에서 읽는다. 그 개념이 레벨 판의 `OPENS_SHARE` 이상을 처음 차지하는
 * 레벨이 그 개념을 여는 레벨이다 (몇 판 섞여 든 것으로는 "열었다" 고 하지 않는다). 없으면 빈 목록 — 앞서 연 것을
 * 더 겹쳐 보는 레벨이다.
 *
 * AI 추천(recommend.ts)이 "이 레벨의 새 개념을 먼저" 에 쓰고, 화면과 설명서가 레벨 안내에 쓴다.
 */
export function levelGuide(level: number): readonly string[] {
  if (!guide) {
    guide = new Map();
    const lib = scenarioLibrary();
    const perLevel = new Map<number, LibraryEntry[]>();
    for (const e of lib) perLevel.set(e.level, [...(perLevel.get(e.level) ?? []), e]);
    for (const c of LEVEL_CONCEPTS) {
      for (let l = 1; l <= 10; l++) {
        const es = perLevel.get(l) ?? [];
        if (es.length && es.filter((e) => c.has(e.tags)).length >= es.length * OPENS_SHARE) {
          guide.set(l, [...(guide.get(l) ?? []), c.key]);
          break;
        }
      }
    }
  }
  return guide.get(level) ?? [];
}

/** 모든 개념이 열린 뒤의 레벨인가 — 앞서 연 것을 겹쳐 보는 종합 레벨 */
export function isCombinedLevel(level: number): boolean {
  let last = 0;
  for (let l = 1; l <= 10; l++) if (levelGuide(l).length) last = l;
  return level > last;
}

/** 조합 규칙을 통과하는 **모든** 태그 — 검증 전 후보다 */
export function allCombinations(): LibraryTags[] {
  const out: LibraryTags[] = [];
  /*
    **방향(side)은 곱하지 않고 뒤에 붙인다.** 열세 축을 곱한 조합마다 성립하면 `auto` 를 넣고, 거울로 뒤집어 다른 장면이
    되면 `flip` 을 바로 뒤에 넣는다 — 축을 곱하면 성립 검사가 두 배가 되고, 뒤집어도 같은 판(사람 없음 · 양쪽 대칭)까지 생긴다.
  */
  const keys = AXIS_KEYS.filter((k) => k !== 'side');
  const walk = (i: number, acc: Partial<LibraryTags>): void => {
    if (i === keys.length) {
      const t = { ...acc, side: 'auto' } as LibraryTags;
      if (!combinationAllowed(t)) return;
      out.push(t);
      if (flipMatters(t)) out.push({ ...t, side: 'flip' });
      return;
    }
    const k = keys[i];
    for (const v of AXES[k]) walk(i + 1, { ...acc, [k]: v });
  };
  walk(0, {});
  return out;
}

/** 거울로 뒤집으면 **다른 장면**이 되는가 — 한쪽에서만 오는 횡단보도가 하나라도 있을 때 (mirrorableCrosswalks) */
function flipMatters(t: LibraryTags): boolean {
  return mirrorableCrosswalks(t, pedestriansAuto(t, libraryId(t))).size > 0;
}

export function entryFor(t: LibraryTags): LibraryEntry {
  const spec = buildLibrarySpec(t);
  const cost = costOf(spec).total;
  // 레벨은 라이브러리 전체를 줄 세운 뒤에 매긴다 (assignLevels)
  return { spec, tags: t, targets: targetsOf(t), cost, level: 1 };
}

// ── 라이브러리 ──────────────────────────────────────────────────────────────

let cache: LibraryEntry[] | null = null;
let byId: Map<number, LibraryEntry> | null = null;

/**
 * **라이브러리 전체** — 처음 부를 때 한 번 만든다.
 *
 * 여기서는 검증하지 않는다 — 검증은 한 판에 수십 ms 라 브라우저에서 매번 돌릴 값이 아니다.
 * 대신 tests/library.*.test.ts 가 **전부** 검증을 통과하는지 못 박는다.
 */
export function scenarioLibrary(): readonly LibraryEntry[] {
  if (!cache) {
    cache = numberedTags()
      .filter((t) => !playtestExcluded(t))
      .map(entryFor);
    assignLevels(cache);
  }
  return cache;
}

let numbered: LibraryTags[] | null = null;

/**
 * **번호를 매기는 순서** — 성립하는 모든 조합(플레이테스트로 뺀 것도 자리는 센다).
 *
 * 나중에 붙인 값을 쓰는 판은 뒤로 보낸다 (ADDED_LATER). 번호(libraryNumber)가 이 순서라, 축 순서대로 곱해 두면 새 판이
 * 사이사이 끼어 이미 있던 판의 번호가 모두 밀린다 — "4927번" 이 다른 판이 된다. 정렬은 안정 정렬이라 같은 무리 안의
 * 순서는 그대로다.
 */
function numberedTags(): LibraryTags[] {
  return (numbered ??= allCombinations()
    .map((t, i) => ({ t, i, gen: generationOf(t) }))
    .sort((p, q) => p.gen - q.gen || p.i - q.i)
    .map((x) => x.t));
}

/** 이 판이 **몇 세대**인가 — 쓰는 값 중 가장 나중에 붙은 것을 따른다 (0 = 처음부터 있던 값만 쓴다) */
const generationOf = (t: LibraryTags): number => {
  for (let g = ADDED_LATER.length - 1; g >= 0; g--) {
    const set = ADDED_LATER[g];
    if ((Object.keys(set) as (keyof LibraryTags)[]).some((k) => set[k]?.has(t[k]) ?? false)) return g + 1;
  }
  return 0;
};

let numberById: Map<number, number> | null = null;

/**
 * **시나리오 번호** — 라이브러리에서 몇 번째 판인가 (1 부터). 결과 화면에 "AI 추천 시나리오 1234" 로 적는다.
 *
 * id 는 축 번호를 자리마다 적은 12자리 수라 사람이 읽고 부르기 어렵다. 번호는 라이브러리 순서(축 배열
 * 순서대로 곱한 순서)라 축에 값을 **끝에** 붙이면 뒤쪽 번호가 밀릴 수 있다 — 기록은 id 로 묶이고, 번호는
 * 화면에서 "이 판" 을 가리켜 부르는 이름일 뿐이다. 라이브러리 밖의 판이면 `undefined`.
 */
export function libraryNumber(id: number): number | undefined {
  // 플레이테스트로 뺀 판도 자리를 센다 — 남은 판의 번호가 밀리지 않는다 (numberedTags)
  numberById ??= new Map(numberedTags().map((t, i) => [libraryId(t), i + 1]));
  return libraryEntry(id) ? numberById.get(id) : undefined;
}

/** 번호로 라이브러리 판을 찾는다 — 빈 자리(플레이테스트로 뺀 판)나 없는 번호면 `undefined` */
export function libraryEntryByNumber(no: number): LibraryEntry | undefined {
  const t = numberedTags()[no - 1];
  return t ? libraryEntry(libraryId(t)) : undefined;
}

/** id 로 라이브러리 판을 찾는다. 없으면 `undefined` */
export function libraryEntry(id: number): LibraryEntry | undefined {
  byId ??= new Map(scenarioLibrary().map((e) => [e.spec.id, e]));
  return byId.get(id);
}

// ── 이 판이 무엇을 시험했는가 ─────────────────────────────────────────────

/**
 * **어느 판에서든 시험되는 습관** — 우회전은 매 판 하기 때문이다 (지시등 · 서행 · 우측 가장자리).
 */
/*
  **방향지시등은 더 이상 시험하지 않는다.** 판을 시작하면 저절로 켜지고 끌 수 없다 (game/Controls.ts) — 사용자가 "휴대폰에서
  제어하므로 깜빡이까지 조작하기는 힘들다, 고정하고 변수에서 빼 달라" 고 정했다. 판정 코드는 남아 있지만 일어날 수 없으므로
  '시험하는 위반' 에서 뺀다 — 넣어 두면 학습자 모델이 매 판 '지켰다' 를 배워 아무 뜻 없는 숙달이 된다.
*/
export const ALWAYS_TESTED: readonly ViolationCode[] = ['NO_SLOW_DOWN', 'WIDE_TURN'];

/**
 * 이 판에서 **그 위반이 일어날 수 있었는가** — 습관이 "고쳐졌는지" 는 이런 판에서만 센다.
 *
 * 예전에는 어떤 판이든 그 위반 없이 3판을 지나면 습관이 풀렸다. 그래서 "적색 일시정지" 습관이
 * **녹색 신호 판만 세 번** 타고 사라졌다 — 적색을 한 번도 만나지 않았는데 "고쳤다" 고 한 것이다.
 *
 * 라이브러리 판은 태그로 정확히 안다(`targets`). 손으로 쓴 판 · 모델이 만든 판은 판의 값에서
 * 같은 기준으로 읽는다 — 주행 직전에 굴린 값(`prepareScenario`)이 들어오므로, 나오지 않은 확률
 * 보행자는 이미 빠져 있다.
 */
export function habitsTestedBy(spec: ScenarioSpec): Set<ViolationCode> {
  /*
    **곧게 가는 코스는 우회전 습관을 시험하지 않는다** (scenarios/zoneCourse.ts). 방향지시등 · 대회전 ·
    교차로 서행은 돌 때의 의무라 여기서는 일어날 수 없다 — 적어 두면 그 습관이 보호구역 판 몇 번으로
    '고쳐졌다' 가 된다. 이 코스가 시험하는 것은 보호구역 일시정지 · 적색 직진 · 보행자 양보다.
  */
  if (spec.drive !== undefined && spec.drive !== 'rightTurn') {
    const zone = new Set<ViolationCode>();
    if (spec.drive === 'zoneOnly') {
      /*
        **사거리 없는 보호구역 도로** — 지나는 횡단보도 셋이 전부다. 신호기가 없는 자리가 하나라도
        있으면 '사람이 없어도 선다' 를, 있는 자리가 하나라도 있으면 '적색은 서서 기다린다' 를 시험한다.
      */
      const signalled = Object.keys(spec.zoneSignals ?? {}).length;
      if (signalled < 3) zone.add('SCHOOL_ZONE_NO_STOP');
      if (signalled > 0) zone.add('SCHOOL_ZONE_RED');
      if (spec.pedestrians.length) zone.add('PEDESTRIAN_BLOCKED');
      return zone;
    }
    const noSignalCrosswalk = spec.approachSchoolZone?.signal === false || !spec.pedSignalInstalled.A;
    if (noSignalCrosswalk) zone.add('SCHOOL_ZONE_NO_STOP');
    if (spec.approachSchoolZone?.signal === true) zone.add('SCHOOL_ZONE_RED');
    if ((STANDARD_PROGRAM[spec.startPhase] ?? STANDARD_PROGRAM[0]).vehicle !== 'green') zone.add('STRAIGHT_RED');
    if (spec.pedestrians.length) zone.add('PEDESTRIAN_BLOCKED');
    return zone;
  }
  const out = new Set<ViolationCode>(ALWAYS_TESTED);
  const entry = libraryEntry(spec.id);
  if (entry) {
    for (const t of entry.targets) out.add(t);
    return out;
  }
  const phase = STANDARD_PROGRAM[spec.startPhase] ?? STANDARD_PROGRAM[0];
  if (spec.rightArrowInstalled) {
    if (phase.rightArrow !== 'greenArrow') out.add('RIGHT_ARROW_RED');
  } else if (phase.vehicle !== 'green') {
    out.add('RED_NO_STOP');
    out.add('OVER_STOP_LINE');
  }
  if (spec.leadCar?.behavior === 'rolling') out.add('RED_NO_STOP');
  if (spec.pedestrians.length || (spec.leadCar && spec.leadCar.path !== 'straight')) out.add('PEDESTRIAN_BLOCKED');
  const unsignaled = !spec.pedSignalInstalled.A || !spec.pedSignalInstalled.C;
  if ((spec.isSchoolZone && unsignaled) || spec.approachSchoolZone?.signal === false) out.add('SCHOOL_ZONE_NO_STOP');
  if (spec.approachSchoolZone?.signal === true) out.add('SCHOOL_ZONE_RED');
  if (spec.exitBlocked) out.add('BLOCKING_INTERSECTION');
  return out;
}

// ── AI 자율 주행 시범 ──────────────────────────────────────────────────────

/**
 * **AI 자율 주행 시범(오프라인 교육)**에서 돌 교차로 판 **여덟** — 보호구역 전용 도로 두 판(scenarios/zoneCourse.ts 의
 * zoneDemoCourses)과 사용자가 정한 차례로 엮어 **열 판**이 한 차례다 (scenarios/offlineCourse.ts).
 *
 * 사용자가 열 판을 하나하나 정했다 (2026-09-26): ① 우회전 적색 · 사람 없음 ② 우회전 녹색 · 사람 없음 ③ 보호구역 기본
 * ④ 우회전 + 사람 둘(양쪽에서) ⑤ 보호구역 + 사람 둘(양쪽에서) ⑥ 우회전+보호구역 중급(사람 둘) ⑦ 상급(사람 둘 + 자전거)
 * ⑧ 최상급(사람 셋 + 자전거 둘) ⑨ 최상급2(보호구역 진입로 뒤 교차로 · 사람 넷 + 자전거 둘) ⑩ 최상급3(같은 길 · 사람 다섯 + 자전거 둘).
 *
 * 처음에는 라이브러리에 없는 것(자전거 + 사람 · 타는 자전거 + 끄는 자전거 · 다섯 사람)을 가장 가까운 판으로 맞췄는데, 사용자가
 * "라이브러리에 새 축을 더해줘" 라고 해 열셋째 축(EXTRAS)을 두었다 — 이제 ⑦~⑩ 이 정한 그대로다.
 *
 * 밤 · 비 · 재촉 · 앞차는 넣지 않는다 — 보여 줄 것은 판단이지 시야가 아니다. **차례는 여기 적힌 순서다** (사용자가 정한 차례).
 */
const DEMO: readonly Partial<LibraryTags>[] = [
  // ① 우회전 차량신호 적색 · 보행자 없음 (L00271)
  { signal: 'red' },
  // ② 우회전 차량신호 녹색 · 보행자 없음 (L00001)
  { signal: 'green' },
  // ④ 우회전 + 보행자 둘 — 우회전 후 횡단보도 양쪽에서 한 사람씩 (L00091)
  { signal: 'green', c: 'group' },
  // ⑥ 중급 — 어린이보호구역 교차로 · 우회전 후 양방향 어린이 둘 (M00625)
  { signal: 'green', zone: 'yes', c: 'group', kind: 'child' },
  // ⑦ 상급 — 보호구역 · 우회전 후 양방향 어린이 둘 + 첫 횡단보도(무신호) 자전거횡단도를 타고 건너는 어린이 자전거 (EXTRAS)
  { signal: 'green', zone: 'yes', sigA: 'no', c: 'group', kind: 'child', extra: 'rideA' },
  // ⑧ 최상급 — 첫 횡단보도 건너는 아이 + 우회전 후 양방향 둘(셋이 저마다 다른 쪽) + 타는 자전거(A) + 끌고 가는 사람(C)
  { signal: 'green', zone: 'yes', sigA: 'no', a: 'crossing', c: 'group', kind: 'child', extra: 'rideApushC' },
  // ⑨ 최상급2 — 진입로 보호구역 무신호 횡단보도를 지나 교차로 · 사람 넷(첫 횡단보도 둘 + 우회전 후 양방향 둘) + 우회전 후 자전거 둘(타고 · 끌고)
  { signal: 'green', approach: 'noSignal', a: 'mixed', c: 'group', kind: 'child', extra: 'rideCpushC' },
  // ⑩ 최상급3 — 같은 길 · 진입로 횡단보도의 아이까지 다섯 사람 + 자전거 둘
  { signal: 'green', approach: 'noSignal', a: 'mixed', c: 'group', kind: 'child', extra: 'pedSrideCpushC' },
];

/** 시범 코스 — 맑은 낮 · 재촉 없음 · 나머지는 가장 단순한 값으로 채운 판. **DEMO 에 적힌 차례 그대로** */
export function demoCourses(): LibraryEntry[] {
  const plain: Partial<LibraryTags> = {
    side: 'auto', extra: 'none', zone: 'no', sigA: 'yes', sigC: 'yes', a: 'none', c: 'none', kind: 'adult',
    approach: 'none', lead: 'none', pressure: 'calm', env: 'day', jam: 'none',
  };
  return DEMO.map((want) => {
    const t = { ...plain, ...want };
    const hit = scenarioLibrary().find((e) => AXIS_KEYS.every((k) => t[k] === undefined || e.tags[k] === t[k]));
    if (!hit) throw new Error(`시범 코스가 라이브러리에 없습니다: ${JSON.stringify(want)}`);
    return hit;
  });
}
