/**
 * 지나가는 차량(NPC) 배역.
 *
 * **3D 모델이 있는 카탈로그 차(economy/cars.ts)에서 무작위로 고른다.** 예전에는 아래
 * 절차적 실루엣(NPC_VEHICLES)을 돌려썼는데, 내 차만 실제 모델이고 주변 차는 각진 상자라
 * 장면이 따로 놀았다.
 *
 * 무작위로 뽑는 이유는 같은 판을 다시 해도 배경이 달라 보이게 하려는 것이다. 예전에는
 * index 로 결정론적으로 골랐는데, 그건 절차적 차체 시절 "같은 시나리오는 같은 구성"을
 * 위한 것이었다. 지금은 차종마다 생김새가 뚜렷해서 매번 같으면 오히려 눈에 띈다.
 */

import { CARS, type CarSpec } from '../economy/cars';

/**
 * NPC 한 대의 배역을 고른다.
 *
 * 플레이어가 탄 차는 뺀다 — 바로 앞에 내 차와 똑같은 차가 서 있으면 내 차인지 헷갈린다.
 * (카탈로그가 한 대뿐이면 어쩔 수 없이 같은 차가 나온다)
 *
 * `preferIds` 가 있으면 **그중에서 고른다.** 이미 받아 둔 모델을 다시 쓰라는 뜻이다 —
 * 한 판에 새 모델을 여러 개 받으면 받아 오는 동안 화면이 끊긴다. 무작위 시나리오는 NPC 가
 * 최대 아홉 대라, 배역을 그냥 뽑으면 큰 파일(SL63 7.6MB)이 대여섯 개씩 딸려 온다.
 */
/**
 * 메뉴에 있는 동안 **NPC 감으로 미리 받아 둘 차** (main.ts 의 prewarm).
 *
 * 첫 판에는 캐시가 내 차 한 대뿐인데 NPC 는 내 차를 피해서 뽑으므로(`excludeId`),
 * 미리 받은 것이 없으면 2~5MB 짜리 모델을 주행 중에 받아 풀게 된다. 한 대만 데워 두면
 * roster 가 그것을 집어 새로 받는 것이 없다.
 *
 * m8 을 고른 이유는 **카탈로그에서 가장 가볍기 때문**이다(1.1MB · 7만 9천 면).
 * 메뉴에서 미리 받는 것이니 가벼울수록 좋고, NPC 는 지나가는 배경이라 차종은 상관없다.
 * (기본 차량이 m8 로 바뀌면 이 값도 다른 차로 옮겨야 한다 — 내 차는 NPC 로 뽑히지 않는다)
 */
export const NPC_PREWARM_CAR_ID = 'm8';

export function pickNpcCar(excludeId?: string, preferIds: readonly string[] = []): CarSpec {
  const pool = CARS.filter((c) => c.id !== excludeId);
  const list = pool.length > 0 ? pool : CARS;
  const warm = list.filter((c) => preferIds.includes(c.id));
  const from = warm.length > 0 ? warm : list;
  return from[Math.floor(Math.random() * from.length)];
}

/** 제자리 섞기 — 배역은 매번 달라야 한다 */
function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 한 판에 세울 **배역표**를 짠다 (서로 다른 차종 `count` 대).
 *
 * ## 왜 한 대씩 뽑으면 안 되는가
 *
 * 예전에는 NPC 마다 `pickNpcCar` 를 불렀는데, 거기 넘기는 `preferIds`(이미 받아 둔 차)가
 * **후보를 한 대로 붕괴시켰다.** 첫 판에는 받아 둔 것이 미리 데워 둔 m8 하나뿐이라
 * (내 차는 배역에서 빠진다) 모든 NPC 가 m8 이 됐다 — 도로 위 차가 전부 같은 차였다.
 *
 * 받아 둔 것을 먼저 쓰려는 뜻 자체는 맞다. 한 판에 큰 모델을 대여섯 개 받으면 출발이
 * 늦고 받는 동안 화면이 끊긴다. 그래서 **뽑는 방식만 바꾼다.**
 *
 *  - 서로 다른 차종 `count` 대를 미리 정해 둔다 (그 안에서 NPC 가 나눠 쓴다)
 *  - **새 얼굴을 반드시 하나 넣는다** — 받아 둔 것만 쓰면 처음 받은 두세 대가 영영
 *    돌아가고, 판을 거듭해도 도로 풍경이 그대로다. 한 대씩 늘려 두면 몇 판 만에
 *    카탈로그가 다 데워지고 그 뒤로는 새로 받을 것이 없다.
 *  - 나머지는 받아 둔 것에서 채운다
 */
export function pickNpcRoster(
  excludeId: string | undefined,
  preferIds: readonly string[],
  count: number,
): CarSpec[] {
  const pool = CARS.filter((c) => c.id !== excludeId);
  const list = pool.length > 0 ? pool : CARS;
  if (list.length <= count) return shuffled(list);

  const warm = shuffled(list.filter((c) => preferIds.includes(c.id)));
  const cold = shuffled(list.filter((c) => !preferIds.includes(c.id)));

  const out: CarSpec[] = [];
  // 새 얼굴 하나 — 판마다 캐시가 한 대씩 늘어 결국 카탈로그 전체가 돈다
  if (cold.length) out.push(cold.shift()!);
  while (out.length < count && warm.length) out.push(warm.shift()!);
  while (out.length < count && cold.length) out.push(cold.shift()!);
  return out;
}

function npc(
  id: string,
  color: number,
  dims: CarSpec['dims'],
  extra: Partial<CarSpec> = {},
): CarSpec {
  return {
    id,
    name: id,
    nameEn: id,
    maker: '',
    level: 1,
    tagline: '',
    spec: '',
    engineNote: 105,
    dims,
    color,
    ...extra,
  };
}

/** 세단 — 가장 흔한 실루엣 */
const SEDAN = { length: 4.75, width: 1.83, height: 1.44, roofRatio: 0.46, cabinFront: 0.31, cabinRear: 0.81 };
/** 해치백 — 짧은 뒷부분 */
const HATCH = { length: 4.0, width: 1.75, height: 1.5, roofRatio: 0.52, cabinFront: 0.28, cabinRear: 0.9 };
/** SUV — 높고 각진 지붕 */
const SUV = { length: 4.7, width: 1.89, height: 1.7, roofRatio: 0.52, cabinFront: 0.29, cabinRear: 0.88 };
/** 승합차 — 거의 상자 */
const VAN = { length: 5.15, width: 1.92, height: 1.95, roofRatio: 0.62, cabinFront: 0.16, cabinRear: 0.94 };

/**
 * 절차적 실루엣 카탈로그 — **지금은 쓰지 않는다.**
 *
 * NPC 가 실제 모델을 쓰기 전의 배역표다. 카탈로그 차 여덟 대에는 승합차도 택시도 없어서
 * 거리 풍경이 단조로워지는데, 그것들을 섞고 싶으면 여기서 꺼내 쓰면 된다
 * (택시는 지붕 표시등이 있어 멀리서도 바로 구분된다).
 */
export const NPC_VEHICLES: CarSpec[] = [
  npc('sedan-white', 0xeef0f3, SEDAN),
  npc('sedan-black', 0x1b1d22, SEDAN),
  npc('sedan-silver', 0x9aa1ab, SEDAN),
  npc('sedan-blue', 0x2c4a7a, SEDAN),
  npc('hatch-red', 0xb8483c, HATCH),
  npc('hatch-lime', 0x7fa63f, HATCH),
  npc('suv-gray', 0x555b64, SUV),
  npc('suv-white', 0xe4e7ec, SUV),
  npc('van-white', 0xf2f4f6, VAN),
  npc('van-silver', 0xb9bec6, VAN),
  // 택시 — 지붕 표시등이 있어 멀리서도 바로 구분된다
  npc('taxi', 0xf2a413, SEDAN, { roofSign: true }),
  npc('taxi-silver', 0xc9ced6, SEDAN, { roofSign: true }),
];
