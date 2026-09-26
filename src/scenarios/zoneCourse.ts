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
 * 사용자가 정한 대로 **길은 두 가지뿐이고, 보행자가 변수**다.
 *
 *  1. 무신호 → **신호(단속 카메라)** → 신호
 *  2. 신호 → **신호(단속 카메라)** → 무신호
 *
 * 횡단보도 셋은 이렇게 부른다.
 *
 *  - **S** — 첫 번째 횡단보도 (진입로 자리)
 *  - **A** — 두 번째 횡단보도. **어느 길에서든 신호등이 있고**, 30km/h 과속 단속 카메라가 그 신호 지주에
 *    함께 선다 (game/Game.ts 의 buildZoneSpeedCamera) — 실물의 '신호 과속단속장비' 다
 *  - **B** — 세 번째 횡단보도. A 와 같은 신호기를 쓴다 (rules/lawRules.ts 의 signalCrosswalk)
 *
 * 변수는 **보행자 셋**이다 — 있고 없음 · 오는 쪽 · 사람 수.
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
 * **도로 두 가지** — 사용자가 정했다.
 *
 *  1. 무신호 → **신호(단속 카메라)** → 신호
 *  2. 신호 → **신호(단속 카메라)** → 무신호
 *
 * 어느 쪽이든 **가운데 횡단보도에는 신호등이 있다.** 거기에 30km/h 과속 단속 카메라가 같은 지주에
 * 함께 서고(game/Game.ts 의 buildZoneSpeedCamera), 명판도 실물처럼 '신호 과속단속장비' 다.
 *
 * ## 왜 둘로 줄였는가
 *
 * 앞서는 신호기 조합 일곱 가지를 모두 돌렸다. 그랬더니 **신호등이 하나도 없는 길**과 **셋 다 있는 길**이
 * 같은 무게로 섞여, 정작 배워야 할 것 — *한 길 안에 무신호 횡단보도와 신호 횡단보도가 섞여 있을 때
 * 규칙을 갈아타는 것* — 이 묻혔다. 둘로 줄이면 **모든 판이 그 갈아타기를 묻는다.** 그리고 둘이 서로
 * 뒤집힌 배치라, 첫 곳이 무신호였다고 다음도 그런 것이 아님을 판을 거듭하며 몸으로 알게 된다.
 *
 * 줄어든 자리는 **보행자 쪽으로 옮겼다** — 사용자가 정한 변수 셋(있고 없음 · 오는 쪽 · 사람 수)이 채운다.
 */
const ROADS: ReadonlyArray<readonly ('S' | 'A' | 'B')[]> = [
  ['A', 'B'], // 1) 무신호 → 신호(단속) → 신호
  ['S', 'A'], // 2) 신호 → 신호(단속) → 무신호
];

/**
 * 횡단보도마다 사람이 어떻게 있는가.
 *
 *  - `none` — 아무도 없다. **무신호 횡단보도에서는 이것이 핵심이다** (제27조 제7항 — 사람이 없어도 선다)
 *  - `waiting` — 연석에서 건너려고 서 있다 (신호기 없는 곳에서만)
 *  - `crossing` — 이미 건너고 있다
 *  - `jaywalk` — 보행 적색인데 건넌다 (신호기가 있는 곳에서만 '무단횡단' 이라는 말이 성립한다)
 */
const PEDS = ['none', 'waiting', 'crossing', 'jaywalk', 'bikeRide', 'bikePush'] as const;

/**
 * **자전거** — 사용자가 실제 도로 사진을 주며 넣자고 했다: "횡단보도 끝에 저렇게 나와 있는 곳은 자전거를
 * 타고 통행이 가능해. 반대로 하얀색 선에서는 자전거를 끌고 가야 해."
 *
 *  - `bikeRide` 옆에 **자전거횡단도**가 있어 타고 건넌다 — 걸음의 두 배 넘게 빠르고, 제15조의2 제3항의
 *    **일시정지 대상**이다
 *  - `bikePush` 자전거횡단도가 없어 **내려서 끌고** 건넌다 (제13조의2 제6항) — 그 사람은 보행자다
 *
 * **신호기 없는 횡단보도에만 둔다.** 그 자리가 이 코스의 핵심(제27조 제7항 — 사람이 없어도 선다)이고,
 * 자전거횡단도의 일시정지 의무와 한 장면에서 만난다. 신호 있는 자리에 두면 "신호를 보면 되는 판" 이
 * 되어 자전거를 알아보는 일이 묻힌다.
 */
const BIKES: ReadonlySet<string> = new Set(['bikeRide', 'bikePush']);
const isBike = (p: string): boolean => BIKES.has(p);
const KINDS = ['child', 'adult', 'elder'] as const;

/**
 * **사람이 어느 쪽에서 어느 쪽으로 건너는가** — 사용자가 정한 난이도 축이다.
 *
 *  - `l2r` **건너편 → 차량쪽** : 반대 차로를 **먼저** 건너므로 내 차로에 닿기까지 3~5초가 더 있다.
 *    일찍 보이고 늦게 닿는다 — 보고 판단할 여유가 가장 크다.
 *  - `r2l` **차량쪽 → 건너편** : 발을 떼는 순간 이미 내 차로다. 여유가 없다.
 *  - `both` **양방향** : 양쪽에서 동시에 나온다. 한쪽만 보고 출발하면 걸린다 —
 *    "왼쪽을 봤으니 됐다" 가 통하지 않는 유일한 배치다.
 *
 * 이름은 **걷는 방향**으로 적는다 (`from` 은 출발한 연석이라 반대로 읽힌다).
 */
const DIRS = ['l2r', 'r2l', 'both'] as const;

/**
 * **한 횡단보도에 몇 사람인가** (1~3).
 *
 * 한 방향이면 그 쪽 연석에 나란히 서고, `both` 면 양쪽으로 나눈다 (둘이면 1+1, 셋이면 **차량쪽 2** + 건너편 1 —
 * 늘어나는 쪽을 내가 먼저 만나는 쪽에 둬야 사람이 는 것이 실제로 어려워진다).
 *
 * 사람 수를 방향과 **따로** 둔다. 한때 '둘 = 양쪽에서 하나씩' 으로 묶어 두었더니, 둘인 판에서는 방향 축이
 * 뜻을 잃어 **같은 장면이 두 판씩 실렸다** (48판이 그랬다). 축이 겹치면 판 수만 늘고 배우는 것은 늘지 않는다.
 */
const COUNTS = [1, 2, 3] as const;

export interface ZoneTags {
  /** 어느 길인가 (ROADS 의 몇 번째) */
  road: number;
  sPed: (typeof PEDS)[number];
  aPed: (typeof PEDS)[number];
  bPed: (typeof PEDS)[number];
  kind: (typeof KINDS)[number];
  dir: (typeof DIRS)[number];
  count: (typeof COUNTS)[number];
}

/** 그 횡단보도의 보행자 유형 */
const pedAt = (t: ZoneTags, at: 'S' | 'A' | 'B'): (typeof PEDS)[number] =>
  at === 'S' ? t.sPed : at === 'A' ? t.aPed : t.bPed;

/** 사람이 서 있는 횡단보도들 (오는 순서대로) */
const peopleAt = (t: ZoneTags): ('S' | 'A' | 'B')[] =>
  (['S', 'A', 'B'] as const).filter((at) => pedAt(t, at) !== 'none');

/** 이 판에서 그 횡단보도에 신호기가 있는가 */
export const hasSignal = (t: ZoneTags, at: 'S' | 'A' | 'B'): boolean => ROADS[t.road].includes(at);

/** **신호기가 없는 횡단보도** — 두 길 모두 한 곳뿐이다 (1번 길은 S, 2번 길은 B) */
export const plainAt = (t: ZoneTags): 'S' | 'A' | 'B' =>
  (['S', 'A', 'B'] as const).find((at) => !hasSignal(t, at))!;

/**
 * 성립하는 조합인가 — **판의 글이 거짓말이 되는 조합**과 **같은 장면이 두 번 실리는 조합**을 여기서 뺀다
 * (library.ts 의 combinationAllowed 와 같은 자리).
 */
export function zoneCombinationAllowed(t: ZoneTags): boolean {
  for (const at of ['S', 'A', 'B'] as const) {
    const ped = pedAt(t, at);
    if (ped === 'none') continue;
    /*
      **자전거는 신호기 없는 횡단보도에만 둔다** (위 BIKES). 그 자리가 이 코스의 핵심이고,
      자전거횡단도의 일시정지 의무와 한 장면에서 만난다.
    */
    if (isBike(ped) && hasSignal(t, at)) return false;
    /*
      **'무단횡단' 은 지킬 신호가 있을 때만 성립한다.** 신호기가 없는 횡단보도에서는 언제 건너도
      규정을 어기는 것이 아니다 — 그런 사람을 '무단횡단' 이라 적으면 판의 글이 거짓말이 된다.
    */
    if (ped === 'jaywalk' && !hasSignal(t, at)) return false;
    /*
      **신호기가 있는 자리에는 무단횡단자만 둔다.**

      보행신호와 차량신호는 번갈아 켜진다 — 신호를 지키는 사람은 **내가 서 있는 동안** 건너고,
      내 신호가 녹색이 될 즈음에는 이미 다 건넌 뒤다. 아무 일도 일어나지 않는 판이므로 뺀다
      (플레이테스트가 잡았다).
    */
    if (ped !== 'jaywalk' && hasSignal(t, at)) return false;
  }

  /*
    **자전거는 한 대뿐이고, 그 횡단보도 하나로 끝낸다.** 여럿이 몰려 건너는 장면은 보행자가 이미
    맡고 있고(양방향 · 셋), 이 판이 묻는 것은 *노면의 붉은 띠를 알아보는가* 하나다.
  */
  const bikes = (['S', 'A', 'B'] as const).filter((at) => isBike(pedAt(t, at)));
  if (bikes.length) {
    if (t.count !== 1 || t.dir === 'both') return false;
    if (peopleAt(t).length !== 1) return false;
  }

  /* **양방향은 둘 이상이라야 성립한다** — 한 사람은 한 방향으로만 건넌다 */
  if (t.dir === 'both' && t.count < 2) return false;

  const places = peopleAt(t).length;
  /* 아무도 없으면 방향도 사람 수도 나이도 뜻이 없다 — 같은 판이 여러 벌로 불어난다 */
  if (places === 0) return t.dir === 'r2l' && t.count === 1 && t.kind === 'child';

  /*
    **나이는 한 곳에 한 사람인 판에서만 가른다.** 어른 · 노인을 따로 겪는 것은 그 판으로 충분하고,
    여럿이 걷는 판까지 셋을 돌리면 같은 장면이 세 벌씩 생긴다.
  */
  if ((places !== 1 || t.count !== 1) && t.kind !== 'child') return false;

  /*
    **사람이 여러 횡단보도에 있으면 수를 줄인다.** 세 곳에 셋씩이면 한 길에 아홉 명이라 길이
    사람으로 막힌다 — 두 곳이면 둘까지, 세 곳이면 하나씩이다.
  */
  if (places === 2 && t.count > 2) return false;
  if (places === 3 && t.count > 1) return false;
  return true;
}

/**
 * **나중에 붙인 값은 맨 뒤에 선다** — 이미 있던 판의 번호(C00001~)가 밀리지 않게.
 * 우회전 라이브러리의 `ADDED_LATER` 와 같은 장치다 (library.ts).
 */
const zoneGenerationOf = (t: ZoneTags): number =>
  (['S', 'A', 'B'] as const).some((at) => isBike(pedAt(t, at))) ? 1 : 0;

const allCombinations = (): ZoneTags[] => {
  const out: ZoneTags[] = [];
  for (let road = 0; road < ROADS.length; road++)
    for (const sPed of PEDS)
      for (const aPed of PEDS)
        for (const bPed of PEDS)
          for (const kind of KINDS)
            for (const dir of DIRS)
              for (const count of COUNTS) {
                const t = { road, sPed, aPed, bPed, kind, dir, count };
                if (zoneCombinationAllowed(t)) out.push(t);
              }
  return out
    .map((t, i) => ({ t, i, gen: zoneGenerationOf(t) }))
    .sort((p, q) => p.gen - q.gen || p.i - q.i)
    .map((x) => x.t);
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
  dir: ZoneTags['dir'],
  count: ZoneTags['count'],
): PedSpawn[] => {
  if (how === 'none') return [];
  const at = signalled ? PED_AT[crosswalk].signal : PED_AT[crosswalk].plain;
  /** 걷는 방향 → 출발한 연석 (PedSpawn.from 은 **출발한 쪽**이라 이름이 반대로 읽힌다) */
  const one = (walk: 'l2r' | 'r2l'): PedSpawn => ({
    crosswalk,
    from: walk === 'l2r' ? 'left' : 'right',
    kind,
    at,
    /*
      '건너는 중' 은 조금 더 멀리서 발을 뗀다 — 내가 닿을 때 이미 차도 위에 있어야 한다.
      **타고 건너는 자전거는 늦게**(6m) 발을 뗀다 — 걸음보다 빨라(pedWalk.ts) 멀리서 나서면 내가
      닿기 전에 다 건너 버린다. 연석에 서 있는 모습과 건너려는 뜻은 처음부터 보이므로, 묻는 것은
      "자전거가 아직 서 있으니 먼저 가도 되겠다" 를 하지 않는 것이다.
    */
    startWithin: how === 'bikeRide' ? 6 : how === 'crossing' ? 18 : 12,
    // 무단횡단 — 지킬 신호가 있는데 지키지 않는다
    ...(how === 'jaywalk' ? { obeysSignal: false } : null),
    ...(how === 'bikeRide' ? { bike: 'ride' as const } : null),
    ...(how === 'bikePush' ? { bike: 'push' as const } : null),
  });
  if (dir !== 'both') return Array.from({ length: count }, () => one(dir));
  /*
    **양방향은 차량쪽을 더 채운다.** 셋이면 차량쪽 2 · 건너편 1 이다 — 늘어나는 쪽이 내가 **먼저
    만나는 쪽**이라야 사람이 는 것이 실제로 어려워진다. 건너편만 늘리면 내 차로에 닿기 전에
    이미 다 지나가 버려 수가 늘어도 판이 달라지지 않는다.
  */
  const near = Math.ceil(count / 2);
  return [
    ...Array.from({ length: near }, () => one('r2l')),
    ...Array.from({ length: count - near }, () => one('l2r')),
  ];
};

const WHERE: Record<'S' | 'A' | 'B', string> = { S: '첫 번째', A: '두 번째', B: '세 번째' };

/** 길의 생김새 한 마디 — 제목에 그대로 들어간다 */
const ROAD_LABEL = ['무신호·신호·신호', '신호·신호·무신호'] as const;
const KIND_TEXT = { child: '어린이', adult: '어른', elder: '노인' } as const;
/** 건너는 방향 — 운전석에서 본 말로 적는다 */
const DIR_TEXT = { l2r: '건너편에서', r2l: '차량쪽에서', both: '양쪽에서' } as const;
/** 사람 수 */
const COUNT_TEXT = { 1: '', 2: ' 둘', 3: ' 셋' } as const;
/** 그 횡단보도에서 사람이 무엇을 하고 있는가 */
const PED_TEXT = {
  none: '',
  waiting: '건너려는',
  crossing: '건너는',
  jaywalk: '무단횡단',
  bikeRide: '자전거횡단도를 타고 건너는',
  bikePush: '자전거를 끌고 건너는',
} as const;

const titleOf = (t: ZoneTags): string => {
  const places = peopleAt(t);
  if (!places.length) return `어린이보호구역 - ${ROAD_LABEL[t.road]} - 보행자 없음`;
  /*
    **횡단보도마다 무엇을 하고 있는지 적는다.** 예전에는 자리만 적어(“첫 번째 횡단보도 어린이”)
    기다리는 사람과 건너는 사람과 무단횡단자가 **같은 제목**으로 보였다 — 제목만 보고는 다른 판인지
    알 수 없었다. 방향과 사람 수는 온 판에 같이 걸리므로 끝에 한 번만 적는다.
  */
  const where = places.map((at) => `${WHERE[at]} ${PED_TEXT[pedAt(t, at)]}`).join(' · ');
  return `어린이보호구역 - ${ROAD_LABEL[t.road]} - ${where} ${KIND_TEXT[t.kind]}${COUNT_TEXT[t.count]} (${DIR_TEXT[t.dir]})`;
};

const briefOf = (t: ZoneTags): string =>
  '어린이보호구역 도로입니다. 교차로 없이 횡단보도 셋을 지납니다. ' +
  `${WHERE[plainAt(t)]} 횡단보도에는 신호기가 없어 보행자가 없어도 일시정지해야 하고, 나머지 두 곳은 신호를 따릅니다. ` +
  '두 번째 횡단보도에는 30km/h 과속 단속 카메라가 신호등과 함께 서 있습니다. ' +
  '보호구역에서는 차가 30km/h 이하로 스스로 줄입니다 — 언제 설지만 판단하세요.';

const teachesOf = (t: ZoneTags): string => {
  const lines = [
    '신호기 없는 보호구역 횡단보도는 보행자의 통행 여부와 관계없이 일시정지합니다 (제27조 제7항).',
    '신호기가 있는 횡단보도의 적색은 서서 기다리는 것입니다 — 서고 나서 가는 것이 아닙니다.',
    '한 길 안에서도 횡단보도마다 규칙이 다릅니다 — 앞의 횡단보도가 어땠는지가 아니라 지금 이곳을 보세요.',
  ];
  const bikeAt = peopleAt(t).find((at) => isBike(pedAt(t, at)));
  if (bikeAt && pedAt(t, bikeAt) === 'bikeRide') {
    lines.push(
      '횡단보도 옆의 붉은 띠에 자전거 표시가 있으면 자전거횡단도입니다 — 자전거가 타고 건널 수 있는 곳이고, 그 앞에서 일시정지해야 합니다(제15조의2 제3항). 타고 오는 자전거는 걸어오는 사람보다 두 배 넘게 빠릅니다.',
    );
  }
  if (bikeAt && pedAt(t, bikeAt) === 'bikePush') {
    lines.push(
      '자전거횡단도가 없는 횡단보도에서는 자전거에서 내려 끌고 건너야 합니다(제13조의2 제6항). 끌고 가는 사람은 보행자입니다(제2조 제17호).',
    );
  }
  if (t.dir === 'both') lines.push('한쪽만 보고 출발하지 마세요 — 반대쪽에서도 사람이 옵니다.');
  if (t.dir === 'l2r') lines.push('건너편에서 오는 사람은 늦게 닿습니다 — 먼저 보인다고 먼저 지나간 것이 아닙니다.');
  if (t.dir === 'r2l') lines.push('차량쪽 연석의 사람은 발을 떼는 순간 이미 내 차로입니다.');
  if (t.count > 1) lines.push('한 사람이 지나갔다고 끝이 아닙니다 — 뒤따르는 사람까지 보내고 출발하세요.');
  if (pedAt(t, 'B') !== 'none') lines.push('마지막 횡단보도까지가 보호구역입니다 — 다 왔다고 끝이 아닙니다.');
  return lines.join(' ');
};

/** 태그 하나를 판으로 — 화면 · 판정 · 검증기가 모두 이 스펙 하나를 본다 */
export function buildZoneSpec(t: ZoneTags, id: number): ScenarioSpec {
  const zoneSignals: Partial<Record<'S' | 'A' | 'B', number>> = {};
  for (const at of ROADS[t.road]) zoneSignals[at] = ZONE_SIGNAL_OFFSET[at];
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
    /*
      **자전거횡단도는 타고 건너는 판에만 그린다.** 끌고 건너는 판에 그려 두면 판의 글이 거짓말이 된다 —
      거기서는 타고 건너도 되는데 굳이 내려서 끄는 셈이 되기 때문이다 (제13조의2 제6항).
    */
    ...(pedAt(t, plainAt(t)) === 'bikeRide' ? { bikeLane: plainAt(t) } : {}),
    zoneSignals,
    pedestrians: [
      ...pedOf('S', t.sPed, t.kind, hasSignal(t, 'S'), t.dir, t.count),
      ...pedOf('A', t.aPed, t.kind, hasSignal(t, 'A'), t.dir, t.count),
      ...pedOf('B', t.bPed, t.kind, hasSignal(t, 'B'), t.dir, t.count),
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

/**
 * 전용 도로 판의 id 인가 — **범위를 닫는다.** 라이브러리 id 는 열세 자리(library.ts 의 EXTRAS 가 맨 앞자리)라
 * 2조를 넘는 값이 있다 — `>= ZONE_ID_BASE` 만 보면 그 판들이 전용 도로로 읽힌다. 전용 도로는 156판이라 1,000 안에 다 든다.
 */
export const isZoneCourseId = (id: number): boolean => id >= ZONE_ID_BASE && id < ZONE_ID_BASE + 1000;

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
  // 두 길 모두 **무신호 횡단보도가 한 곳**이다 — '사람이 없어도 선다' 를 늘 시험한다 (제27조 제7항)
  out.add('SCHOOL_ZONE_NO_STOP');
  // 그리고 **신호 횡단보도가 두 곳** — 그 적색은 서서 기다리는 것이다
  out.add('SCHOOL_ZONE_RED');
  /*
    **타고 건너는 자전거는 보행자가 아니다** — 그 판이 시험하는 것은 `BIKE_BLOCKED` 다 (제15조의2 제3항).
    끌고 건너는 사람은 보행자이므로 `PEDESTRIAN_BLOCKED` 그대로다 (제2조 제17호).
  */
  const rides = peopleAt(t).some((at) => pedAt(t, at) === 'bikeRide');
  if (rides) out.add('BIKE_BLOCKED');
  else if (peopleAt(t).length) out.add('PEDESTRIAN_BLOCKED');
  return [...out];
}

/**
 * **이 판이 얼마나 어려운가** — 레벨을 매기는 기준 (difficulty.ts 의 costOf 와 같은 생각).
 *
 * ## 무엇으로 어려워지는가
 *
 * 이 코스는 길이 **두 가지뿐**이고 사실상 보행자만 변수다. 그래서 난이도는 사용자가 정한 두 축 —
 * **건너는 방향**과 **사람 수** — 에서 나온다. 둘 다 "내 차로에 사람이 들어오기까지 내게 얼마나 시간이
 * 있는가" 와 "몇 번을 다시 확인해야 하는가" 를 바꾼다.
 *
 * | | 점수 | 까닭 |
 * |---|---|---|
 * | 건너편 → 차량쪽 | +0 | 반대 차로를 먼저 건넌다 — 보고 판단할 여유가 가장 크다 |
 * | 차량쪽 → 건너편 | +1 | 발을 떼는 순간 이미 내 차로다 |
 * | 양방향 | +2 | 한쪽만 보고 출발하면 걸린다 — 두 번 확인해야 한다 |
 * | 한 사람 · 둘 · 셋 | +0 · +1 · +2 | 앞사람이 지나가도 끝이 아니다 |
 *
 * 여기에 **어디에** 있는가(신호 없는 곳이면 일시정지 의무, 있는 곳이면 무단횡단)와 **누구**인가(어린이 ·
 * 노인은 걸음이 다르다), **몇 곳에** 있는가가 더해진다.
 *
 * ## 왜 방향과 사람 수를 따로 세는가
 *
 * 한때 '둘 = 양쪽에서 하나씩' 으로 묶고 방향에는 점수를 주지 않았다. 그랬더니 (1) 둘인 판에서 방향 축이
 * 뜻을 잃어 **같은 장면이 두 판씩** 실렸고, (2) 점수 단계가 2~9 의 여덟 칸뿐이라 **L3 · L4 · L5 가 전부
 * 같은 4점** 이 됐다 — 레벨이 두 칸 올라도 실제로는 어려워지지 않았다. 두 축을 갈라 점수를 주면 계단이
 * 그만큼 촘촘해진다.
 */
function zoneCost(t: ZoneTags): number {
  // 무신호 한 곳 + 신호 두 곳 — 두 길이 같다
  let n = 2;
  /*
    **무신호가 마지막에 있는 길이 더 어렵다.** 신호 둘을 지키고 나면 "이 길은 신호를 보는 길" 로
    굳어져, 마지막에서 사람이 없으면 그냥 지나가게 된다 (teachesOf 의 '다 왔다고 끝이 아닙니다').
  */
  if (plainAt(t) === 'B') n += 1;

  const places = peopleAt(t);
  for (const at of places) {
    const p = pedAt(t, at);
    // 무단횡단은 신호만 보고 가면 걸리고, 타고 건너는 자전거는 걸음의 두 배 넘게 빨라 판단할 틈이 짧다
    n += p === 'jaywalk' || p === 'bikeRide' ? 2 : 1;
  }
  if (!places.length) return n;

  // ── 사용자가 정한 두 축
  n += { l2r: 0, r2l: 1, both: 2 }[t.dir];
  n += t.count - 1;

  if (places.length > 1) n += 1; // 한 곳을 보내고 나서도 긴장을 이어야 한다
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
/** 자전거를 태그 어휘(LibraryTags)의 가장 가까운 값으로 옮긴다 — 추천이 모양을 가르는 데만 쓴다 */
const libPed = (p: (typeof PEDS)[number]): 'none' | 'waiting' | 'crossing' | 'jaywalk' =>
  p === 'bikeRide' ? 'crossing' : p === 'bikePush' ? 'waiting' : p;

export function zoneEntries(): LibraryEntry[] {
  return (entries ??= (() => {
    const tags = allCombinations();
    const built = tags.map((t, i) => {
      const spec = zoneCourses()[i];
      const libTags: LibraryTags = {
        // 교차로가 없는 길이라 '정면 신호' 도 없다 — 추천이 모양을 가르는 데만 쓰는 값이다
        side: 'auto', extra: 'none', signal: 'green',
        zone: 'yes',
        sigA: hasSignal(t, 'A') ? 'yes' : 'no',
        sigC: hasSignal(t, 'B') ? 'yes' : 'no',
        /*
          태그 어휘에는 자전거가 없다 — 추천이 "비슷한 판이 이어지지 않게" 고르는 데만 쓰는 값이라,
          타고 건너는 자전거는 '건너는 중', 끌고 건너는 사람은 '건너려는' 으로 옮겨 적는다.
        */
        a: libPed(t.sPed),
        c: libPed(t.bPed),
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
 * **오프라인 교육 시범에 넣을 보호구역 전용 도로 두 판** — 사용자가 정한 열 판(library.ts 의 DEMO 주석)의 ③ · ⑤ 다.
 *
 *  - ③ **기본** — 무신호 → 신호(단속) → 신호(ROADS[0]), 사람 없음 (C00001). 사람이 없어도 서는 무신호 횡단보도 · 30km/h · 단속 카메라
 *  - ⑤ **사람 둘** — 신호 → 신호(단속) → 무신호(ROADS[1]), 마지막 무신호 횡단보도에 양쪽에서 한 명씩 건너려는 아이 (C00086)
 *
 * 합치는 일은 offlineCourse.ts 가 한다 — 라이브러리와 서로를 부르지 않게. **차례는 여기 적힌 순서다.**
 */
export function zoneDemoCourses(): LibraryEntry[] {
  const want: Partial<ZoneTags>[] = [
    { road: 0, sPed: 'none', aPed: 'none', bPed: 'none' },
    { road: 1, sPed: 'none', aPed: 'none', bPed: 'waiting', kind: 'child', dir: 'both', count: 2 },
  ];
  const tags = allCombinations();
  const entries = zoneEntries();
  return want.map((w) => {
    const i = tags.findIndex((t) => (Object.keys(w) as (keyof ZoneTags)[]).every((k) => t[k] === w[k]));
    if (i < 0) throw new Error(`시범 코스가 없습니다: ${JSON.stringify(w)}`);
    return entries[i];
  });
}
