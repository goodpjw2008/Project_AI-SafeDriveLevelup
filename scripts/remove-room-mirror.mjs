/**
 * 룸미러(실내 백미러)를 모델에서 **잘라낸다.**
 *
 * 운전석 시점에서 룸미러는 앞유리 한가운데 위쪽에 걸려 **전방 시야를 가린다.** 실제 차에서는
 * 눈이 두 개라 그 뒤가 보이지만, 화면은 외눈이라 그대로 검은 덩어리로 남는다. 게다가 이
 * 게임에서 룸미러의 기능(뒤차 확인)은 화면 위의 **후방 창**(PeripheralView)이 대신하고 있어,
 * 모델의 룸미러는 시야를 가리기만 하고 하는 일이 없다.
 *
 * **사이드미러는 남긴다.** 밖에 달려 있어 전방 시야를 가리지 않고, 차의 모양을 이룬다.
 *
 * ── 왜 빌드 시점인가
 *
 * 룸미러는 오브젝트 하나가 아니다. 거울면은 재질이 달라 별도 메시로 나오지만, **하우징·목·
 * 지지대는 실내 통짜 메시(코롤라 기준 19,047 삼각형)에 통째로 녹아 있다.** 런타임에서
 * 오브젝트 단위로는 뺄 수가 없고, 좌표 조건으로 삼각형을 고르면 조건을 넓힐 때 천장이
 * 뜯기고 좁히면 지지대가 남는다 (B필러에서 이미 겪었다 — split-pillar.mjs).
 *
 * ── 어떻게 고르는가
 *
 * 상자로 자르지 않고 **연결 덩어리(connected component)** 로 고른다. 삼각형이 꼭짓점을
 * 공유하며 이어진 덩어리를 형상 그대로 따라가므로, 잘린 단면이나 뜯긴 가장자리가 남지 않는다.
 *
 *   1. 덩어리를 **크기로 거른다** — 최장변(지붕 프레임·앞유리를 쳐냄)과 두 번째 변
 *      (오버헤드 콘솔을 쳐냄). 룸미러는 '넓고 납작한 판'이라는 것이 판별의 핵심이다.
 *   2. **거울면을 찾는다.** 이름에 mirror 가 있으면 그 메시에서 가운데 뭉치를 고르고
 *      (양 끝은 사이드미러다), 이름이 없으면 형상으로 찾는다 — 지붕 아래 한가운데에 뜬
 *      넓고 아주 얇은 판은 룸미러밖에 없다.
 *   3. 거울면 곁의 **가장 큰 덩어리**가 든 메시를 골라, 그 안에서만 거리로 이어 붙인다
 *      (하우징 → 목 → 지지대). 메시를 가르는 이유는 바로 위의 실내등·콘솔 때문이다.
 *   4. 다른 메시에서는 거울면에 **거의 닿은** 잔부품만 가져온다 (거울 아래 글자·버튼).
 *
 * 지운 것은 하나도 빠짐없이 크기와 함께 출력한다. 눈으로 확인하고 넘어가라는 뜻이다.
 *
 * 실행:
 *   npm run fix:mirror -- --dry <차id>   # 지우기 전에 무엇이 지워질지 본다
 *   npm run fix:mirror -- <차id>         # 실제로 지운다
 *   npm run assets                       # 모델을 다시 구울 때 자동으로 함께 돈다
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { collectMeshes } from './skinning.mjs';

/**
 * 룸미러를 잘라낼 차 — **한 종씩 눈으로 확인하고 늘린다.**
 *
 * 모델마다 룸미러가 어느 메시에 어떻게 들어 있는지가 다르다. 전 차종에 한꺼번에 돌리면
 * 어느 차에서 무엇이 잘못됐는지 알 수 없다. 확인한 차만 여기에 적는다.
 */
export const ROOM_MIRROR_CARS = new Set([
  'corolla', 'k5', 'avante', 'sorento', 'm5', 'm8', 'sf90', 'sl63', 'corvette',
]);

/**
 * **자동 탐지가 통하지 않는 차의 룸미러 부품 목록.**
 *
 * 쏘렌토가 그렇다. 부품 이름이 `PolySurface0.002` 처럼 무의미하고 재질도 `template_...`
 * 뿐이라 이름으로 못 찾고, 형상 규칙(넓고 얇은 판)도 엉뚱한 조각(5x14x371mm 짜리 긴 띠)을
 * 집었다. 그래서 눈으로 확인한 덩어리를 직접 적는다.
 *
 * 지정 방식은 remove-view-blockers.mjs 와 같다 — 메시 이름 앞부분 + 삼각형 수 + 중심 좌표
 * (차 길이 대비 비율). 하나도 못 찾거나 둘 이상 찾으면 오류로 알린다.
 */
export const ROOM_MIRROR_PARTS = {
  /*
    콜벳 C8 컨버터블. **형상 자동탐지를 쓰면 안 되는 차다** — 이름에 mirror 가 없어 형상으로
    찾는데, 그렇게 고른 것(114 삼각형, 260 x 9 x 70mm)은 룸미러에서 **476mm 밖**에 있는
    엉뚱한 판이었다. 게다가 몸통은 하나도 못 찾아(0개) 거울면만 지우고 끝났을 것이다.

    게임에서 둘을 찍고(면#19011 = 차 색깔 셸, 면#6344 = 하우징) 둘레 21mm 를 훑어 나머지를
    모았다. 룸미러가 **두 메시에 걸쳐 있다** — 겉껍데기만 `Coloured`(차 색깔), 나머지는
    `interior`. SL63 에서 겪은 것과 같은 구조라, 하나만 지우면 나머지가 그대로 남는다.
  */
  corvette: [
    { what: '하우징', mesh: 'Mesh6_M', tris: 891, center: [0.3307, 0.2252, -0.5253] },
    { what: '마운트 암', mesh: 'Mesh6_M', tris: 342, center: [0.329, 0.2299, -0.5179] },
    { what: '겉껍데기 (차 색깔)', mesh: 'Mesh27_M', tris: 25, center: [0.3309, 0.2264, -0.5274] },
    /* 하우징에서 7~21mm 안에 붙은 잔부품 — 볼조인트·마운트 받침·버튼. 남기면 좁쌀처럼 뜬다 */
    { what: '볼조인트', mesh: 'Mesh6_M', tris: 10, center: [0.3293, 0.2223, -0.5206] },
    { what: '조작부', mesh: 'Mesh6_M', tris: 20, center: [0.3296, 0.219, -0.5217] },
    { what: '마운트 받침', mesh: 'Mesh6_M', tris: 36, center: [0.329, 0.2285, -0.5187] },
    { what: '마운트 판', mesh: 'Mesh6_M', tris: 42, center: [0.3289, 0.229, -0.518] },
  ],
  /*
    SL63. 자동 탐지는 거울면을 아예 못 찾았다 — 부품 이름이 `Object_26` 처럼 무의미하고
    재질도 `black` 뿐이라 이름 규칙에 안 걸리고, 형상 규칙(넓고 아주 얇은 판)에도 안 맞는다.
    게임에서 찍어(면#13 = 거울면, 면#10776 = 하우징) 특정하고 둘레를 훑어 나머지를 찾았다.

    **이 모델은 뼈대(스킨)가 걸려 있다** — 좌표를 바로잡기 전에는 룸미러 옆 부품이 780mm
    밖에 있는 것으로 나왔다 (skinning.mjs 참고). 아래 값은 전부 뼈대를 반영한 좌표다.

    다섯 덩어리가 세 메시에 흩어져 있다. 거울면(검정)만 지우면 **몸통이 차 색깔로 남는다** —
    사용자 화면에서 노란 덩어리로 보였던 것이 이 하우징이다.
  */
  sl63: [
    { what: '거울면', mesh: 'Object_26', tris: 19, center: [-0.0028, 0.1165, 0.0188] },
    { what: '하우징', mesh: 'Object_23', tris: 182, center: [-0.0029, 0.117, 0.0154] },
    { what: '목', mesh: 'Object_23', tris: 18, center: [-0.0022, 0.1242, 0.012] },
    /*
      앞유리에 붙는 마운트. 하우징에서 57~61mm 위·앞에 있고 폭이 258mm 로 거울보다 넓다.
      검정 판(Object_26)과 그 위를 덮는 커버(Object_156)가 겹쳐 있어 둘 다 지운다.
    */
    { what: '마운트 판', mesh: 'Object_26', tris: 8, center: [-0.0022, 0.1321, 0.0102] },
    { what: '마운트 커버', mesh: 'Object_156', tris: 20, center: [-0.0025, 0.1337, 0.0082] },
    /*
      마운트가 가리고 있던 **유리에 붙은 잔부품 넷** — 마운트를 지우니 드러났다.
      게임에서 둘을 찍고(면#10711 = 노란 사각, 면#232 = 검은 타원) 둘레 140mm 를 훑어
      나머지 둘을 찾았다. 다 20mm 안팎이라 지워도 자리가 비지 않는다.

      노란 사각과 검은 원은 10mm 거리에 겹쳐 있어 화면에서는 한 덩어리로 보인다.
    */
    { what: '유리에 붙은 사각 판 (차 색깔)', mesh: 'Object_23', tris: 2, center: [-0.0055, 0.131, -0.0027] },
    { what: '센서 렌즈 (원형)', mesh: 'Object_21', tris: 72, center: [-0.0055, 0.1311, -0.0029] },
    { what: '센서 몸체 (타원)', mesh: 'Object_21', tris: 22, center: [0.0146, 0.1296, -0.0107] },
    { what: '센서 받침 (원형)', mesh: 'Object_21', tris: 86, center: [0.0106, 0.1185, -0.0235] },
  ],
  /*
    SF90 스파이더. 아반떼·M5 와 같은 에셋 계열이라 부품이 `Coloured_`(거울·버튼)와
    `Interior_`(마운트)로 갈려 있다. 게임에서 찍어(면#14424) 본체를 잡고, 그 둘레
    60mm 안의 부속을 함께 넣었다. 100mm 밖의 좌우 대칭 조각들은 선바이저라 남긴다.
  */
  sf90: [
    { what: '거울 본체', mesh: 'Coloured_Geo', tris: 378, center: [0.0043, 0.2155, 0.0602] },
    { what: '조작부', mesh: 'Coloured_Geo', tris: 30, center: [0.0031, 0.206, 0.0622] },
    { what: '목', mesh: 'Coloured_Geo', tris: 16, center: [0.0008, 0.2181, 0.0682] },
    { what: '마운트', mesh: 'Interior_Geo', tris: 80, center: [0.0, 0.2231, 0.0683] },
  ],
  /*
    M8 컨버터블. 형상 자동탐지는 높이 72% 지점의 다른 판(234x12x68mm)을 거울로 집었다 —
    룸미러는 지붕 바로 아래(높이 91%)에 있다. 셋 다 실내 메시 하나에 들어 있다.
  */
  m8: [
    { what: '거울면', mesh: 'b:SM_Interior_0000_001', tris: 7, center: [0.0, 0.2545, 0.0229] },
    { what: '하우징', mesh: 'b:SM_Interior_0000_001', tris: 64, center: [0.0, 0.2572, 0.0484] },
    { what: '마운트', mesh: 'b:SM_Interior_0000_001', tris: 12, center: [0.0002, 0.245, 0.0606] },
    /*
      거울 몸체(뒷덮개). 하우징 바로 아래에 겹쳐 있어 처음에 놓쳤다 —
      게임에서 직접 찍어(면#11211) 특정했다.
    */
    { what: '거울 몸체', mesh: 'b:SM_Interior_0000_001', tris: 198, center: [0.0013, 0.2432, 0.0509] },
  ],
  /*
    M5 는 아반떼와 같은 에셋 계열(RewardRecycled)이라 부품이 메시 둘에 갈려 있다 —
    거울면·버튼은 `Coloured_`, 하우징·마운트는 `Textured_`. 형상 자동탐지는 뒷유리 쪽
    가로 띠(361x17x3mm)를 거울로 잘못 집어서 쓸 수 없었다.
  */
  m5: [
    { what: '거울면', mesh: 'Coloured_Geo', tris: 19, center: [0.0007, 0.2464, 0.0764] },
    { what: '하우징', mesh: 'Textured_Geo', tris: 358, center: [0.0006, 0.2465, 0.0818] },
    { what: '마운트·커버', mesh: 'Textured_Geo', tris: 231, center: [0.0, 0.2534, 0.0856] },
    { what: '조작부', mesh: 'Coloured_Geo', tris: 59, center: [0.0006, 0.2399, 0.0805] },
    { what: '버튼 좌', mesh: 'Coloured_Geo', tris: 15, center: [-0.005, 0.2401, 0.0794] },
    { what: '버튼 우', mesh: 'Coloured_Geo', tris: 13, center: [0.0061, 0.2401, 0.0798] },
    { what: '버튼 중', mesh: 'Coloured_Geo', tris: 10, center: [0.0006, 0.2399, 0.0796] },
  ],
  sorento: [
    { what: '거울면', mesh: 'PolySurface0.070', tris: 22, center: [0.0, 0.2828, -0.0955] },
    { what: '하우징', mesh: 'PolySurface0.002', tris: 716, center: [0.0, 0.2829, -0.0991] },
    { what: '목', mesh: 'PolySurface0.002', tris: 166, center: [0.0, 0.2836, -0.1022] },
    { what: '마운트', mesh: 'PolySurface0.002', tris: 168, center: [0.0023, 0.2869, -0.1054] },
    { what: '마운트 덮개', mesh: 'PolySurface0.002', tris: 80, center: [0.0, 0.2859, -0.107] },
    { what: '볼조인트', mesh: 'PolySurface0.002', tris: 48, center: [0.0, 0.2868, -0.1067] },
    /*
      미러 마운트 커버 (앞유리에 붙는 큰 덮개).
      하우징에서 86mm 떨어져 있어 처음에는 별개 부품으로 보고 남겼는데, 게임에서 직접
      찍어 보니(면#46507) 이것이 앞유리를 가리는 검은 덩어리였다. 실제 쏘렌토도 룸미러
      뿌리에 레인센서까지 감싸는 큰 커버가 붙어 있다.
    */
    { what: '마운트 커버', mesh: 'PolySurface0.002', tris: 362, center: [0.0072, 0.2908, -0.1136] },
    /*
      앞유리에 붙는 마운트 베이스 판. 다른 메시(알루미늄 트림)에 들어 있어 앞의 규칙으로는
      함께 잡히지 않았다. 이것도 게임에서 직접 찍어(면#840) 특정했다.
    */
    { what: '마운트 베이스', mesh: 'PolySurface0.020', tris: 86, center: [0.016, 0.2874, -0.1272] },
  ],
};

/** 명시 목록에서 중심이 이만큼(차 길이 대비) 안에 들면 같은 부품으로 본다 */
const PART_TOLERANCE = 0.004;

/** 거울면 메시를 찾는 이름 규칙 (부품 이름·재질 이름 모두 본다. miror 은 원본의 오타다) */
const MIRROR_NAME = /miror|mirror|rearview/i;

/**
 * 좌우 축에서 '가운데'로 볼 범위 — 반폭 대비 비율.
 * 사이드미러는 차 폭 끝(≒100%)에, 룸미러는 중앙(≒8%)에 있어 이 값 근처에서는 갈릴 일이 없다.
 */
const CENTER_FRAC = 0.4;

/**
 * 룸미러 몸체가 이어 붙는 거리 — 거울면 **가로 길이**에 대한 비율.
 *
 * 하우징·목·지지대는 거울면에 붙어 있거나 코앞에 있다(코롤라 1.5cm, K5 2.7단위).
 * 반면 그 위의 오버헤드 콘솔·실내등은 8단위 넘게 떨어져 있어 이 값에서 갈린다.
 *
 * 모델 단위가 미터가 아닐 수 있어(K5 는 1단위 ≒ 1cm, 코롤라는 ≒ 1m) 절대값으로 두지 않는다.
 */
const NEAR_FRAC = 0.2;

/**
 * 다른 메시에서 주워 담을 때 쓰는 **더 좁은** 거리.
 *
 * 룸미러의 잔부품(K5 의 거울 아래 흰 글자·버튼 조각들)은 다른 메시에 들어 있는데,
 * 그것까지 놓치면 거울을 지운 자리에 좁쌀 같은 조각이 떠 있게 된다. 다만 다른 메시로
 * 넘어가는 순간 실내등·콘솔이 걸릴 위험이 커지므로, 거울면에 **거의 닿은 것만** 가져온다.
 */
const TOUCH_FRAC = 0.05;

/**
 * 룸미러 부품으로 인정할 최대 크기 — **차 길이**에 대한 비율.
 *
 * 이것이 첫 번째 안전장치다. 거리만으로 이어 붙이면 룸미러를 감싸고 지나가는 **지붕
 * 프레임·앞유리**가 딸려 온다 — 그것들의 바운딩 박스는 룸미러를 통째로 품고 있어 거리가 0 이다.
 * 룸미러는 아무리 커도 차 길이의 10% 를 넘지 않는다 (K5 하우징 5.8%, 코롤라 5.6%).
 */
const MAX_PART_FRAC = 0.12;

/**
 * 룸미러 부품의 **두 번째로 긴 변**의 상한 — 차 길이 대비.
 *
 * 룸미러는 '넓고 납작한 판'이다. 가로만 길고 나머지 두 변은 짧다 (코롤라 하우징
 * 5.6% x 1.9% x 1.8%, K5 5.8% x 1.6% x 1.4%). 반면 **오버헤드 콘솔·선글라스 홀더**는
 * 상자라서 두 번째 변도 길다 (아반떼 콘솔 5.3% x 3.8% x 1.9%).
 *
 * 아반떼에서는 그 콘솔이 거울면과 앞뒤로 겹쳐 있어 거리로는 절대 갈리지 않는다.
 * '납작한가'를 보는 이 조건만이 둘을 가른다.
 */
const FLAT_FRAC = 0.025;

/**
 * 삼각형 목록을 (월드 좌표 무게중심 + 위치 기반 꼭짓점 키) 로 만든다.
 *
 * @param vertexAt 정점 번호 → 실제 좌표 (스킨이 걸린 모델은 뼈대를 따라 옮긴다. skinning.mjs)
 * @param scale 좌표를 키로 반올림할 때 쓰는 배율 — **차 길이에 비례해야 한다.**
 */
function trianglesOf(prim, vertexAt, scale) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : pos.getCount();
  const at = (i) => vertexAt(idx ? idx.getScalar(i) : i);
  /*
    꼭짓점은 **번호가 아니라 위치**로 잇는다. 최적화를 거친 모델은 UV·노멀 이음매에서
    같은 자리의 정점이 여러 번호로 갈라져 있어, 번호로만 이으면 한 덩어리가 조각조각 난다.

    반올림 폭은 **차 길이에 대한 비율**이어야 한다. 예전에는 `v * 4000` 으로 절대 단위에
    고정돼 있었는데, 아반떼는 차 한 대가 0.047 단위밖에 안 돼서 **25mm 안의 정점이 전부
    한 점으로 뭉쳤다** — 실내가 통째로 덩어리 하나가 되어 룸미러를 분리할 수 없었다.
    (모델마다 1 단위가 1m 이기도 1cm 이기도 하다)
  */
  const key = (p) => p.map((v) => Math.round(v * scale)).join(',');
  const tris = [];
  for (let t = 0; t + 2 < count; t += 3) {
    const v = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
    const p = [at(t), at(t + 1), at(t + 2)];
    tris.push({
      v,
      k: p.map(key),
      c: [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3),
    });
  }
  return tris;
}

/** 꼭짓점을 공유하는 삼각형끼리 묶는다 */
function components(tris) {
  const byVert = new Map();
  tris.forEach((tri, i) =>
    tri.k.forEach((k) => {
      if (!byVert.has(k)) byVert.set(k, []);
      byVert.get(k).push(i);
    }),
  );
  const seen = new Set();
  const out = [];
  for (let i = 0; i < tris.length; i++) {
    if (seen.has(i)) continue;
    const comp = [i];
    seen.add(i);
    const queue = [i];
    while (queue.length) {
      const a = queue.pop();
      for (const k of tris[a].k)
        for (const b of byVert.get(k))
          if (!seen.has(b)) {
            seen.add(b);
            comp.push(b);
            queue.push(b);
          }
    }
    out.push(comp);
  }
  return out;
}

const boundsOf = (pts) => ({
  min: [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))),
  max: [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))),
});

/** 바운딩 박스의 세 변을 긴 것부터 */
const dimsOf = (b) => [0, 1, 2].map((i) => b.max[i] - b.min[i]).sort((x, y) => y - x);

/**
 * 차의 세 축을 형상에서 알아낸다.
 *
 * 이름에 기대지 않는다 — 모델마다 위가 Y 이기도 Z 이기도 하고(코롤라 Y-up, K5 Z-up),
 * 단위도 제각각이다. 차는 **길고, 그다음 넓고, 가장 낮다**. 이 순서는 어떤 세단에서도 같다.
 */
function axesOf(bounds) {
  const ext = [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]);
  const order = [0, 1, 2].sort((a, b) => ext[b] - ext[a]);
  return { length: order[0], lateral: order[1], up: order[2], ext };
}

/**
 * 거울면을 **형상으로** 찾는다 — 이름에 mirror 가 없는 모델(아반떼)용.
 *
 * 룸미러의 거울면은 어느 차에서나 같은 물건이다: 지붕 바로 아래, 좌우 한가운데에 떠 있는
 * **넓고 아주 얇은 판**. 폭·두께·위치를 모두 걸면 이 조건을 만족하는 다른 부품은 없다.
 */
function findGlassByShape(parts, axes, bounds, carLength) {
  const midLat = (bounds.min[axes.lateral] + bounds.max[axes.lateral]) / 2;
  const hits = parts.filter((p) => {
    const d = dimsOf(p.b);
    if (d[0] < carLength * 0.03 || d[0] > carLength * 0.08) return false; // 폭 14~38cm
    if (d[1] > carLength * 0.02) return false; // 세로가 짧다
    if (d[2] > carLength * 0.004) return false; // **아주 얇다** (거울면의 결정적 특징)
    const c = [0, 1, 2].map((i) => (p.b.min[i] + p.b.max[i]) / 2);
    if (Math.abs(c[axes.lateral] - midLat) > carLength * 0.02) return false; // 좌우 한가운데
    const h = (c[axes.up] - bounds.min[axes.up]) / axes.ext[axes.up];
    return h > 0.7; // 지붕 가까이
  });
  // 여럿이면 가장 넓은 것 — 룸미러보다 넓고 얇고 중앙에 뜬 실내 부품은 없다
  return hits.sort((a, b) => dimsOf(b.b)[0] - dimsOf(a.b)[0])[0] ?? null;
}

/** 인덱스를 새로 써서 고른 삼각형만 지운다 (정점 버퍼는 그대로 둔다) */
function dropTriangles(doc, prim, tris, drop) {
  const keep = [];
  tris.forEach((tri, i) => {
    if (!drop.has(i)) keep.push(...tri.v);
  });
  const pos = prim.getAttribute('POSITION');
  const Indices = pos.getCount() < 65536 ? Uint16Array : Uint32Array;
  const buffer = doc.getRoot().listBuffers()[0];
  prim.setIndices(doc.createAccessor().setArray(new Indices(keep)).setBuffer(buffer));
}

/**
 * @param {string} path  public/models/<id>.glb
 * @param {string} id    차 id
 * @param {{dry?: boolean, force?: boolean}} [opts]
 *   dry   — 무엇이 지워질지 출력만 하고 파일은 건드리지 않는다 (새 차종을 확인할 때)
 *   force — 목록(ROOM_MIRROR_CARS)에 없어도 실행한다 (미리보기용)
 */
export async function removeRoomMirror(path, id, opts = {}) {
  if (!ROOM_MIRROR_CARS.has(id) && !opts.force) return;
  const dry = opts.dry ?? false;

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const doc = await io.read(path);

  /*
    **이미 지웠으면 손대지 않는다.**

    형상으로 거울면을 찾는 모델(아반떼)에서는 룸미러가 사라진 뒤에도 그 조건에 얼추 맞는
    다른 판(햇빛가리개 등)이 남아 있어, 두 번째 실행이 **엉뚱한 부품을 지웠다.**
    "찾았으면 지운다" 는 방식은 멱등이 될 수 없으므로, 지웠다는 사실을 파일에 남긴다.
  */
  const marked = doc.getRoot().getExtras()?.roomMirrorRemoved;
  if (marked) {
    console.log(`  · ${id}: 이미 룸미러를 지운 모델입니다 — 건너뜁니다`);
    return;
  }

  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];

  /*
    **뼈대(스킨)가 걸린 모델은 정점 자리가 노드 행렬로 정해지지 않는다** (skinning.mjs 참고).
    SL63 이 그렇다 — 173개 메시가 스킨이라, 뼈대를 따라 옮기지 않으면 좌표가 전부 어긋난다.
  */
  const meshes = collectMeshes(scene);
  const vertexAt = new Map();
  const atOf = (entry, prim) => {
    if (!vertexAt.has(prim)) vertexAt.set(prim, entry.vertexAt(prim));
    return vertexAt.get(prim);
  };

  /*
    지운 덩어리의 크기를 **차 길이에 대한 비율**로 적기 위해 모델 전체의 최장변을 잰다.
    glTF 의 단위는 모델마다 달라서(이 코롤라는 1 단위 ≒ 1.07m) 그대로 적으면 크기가 안 잡힌다.
  */
  const allPts = [];
  for (const entry of meshes)
    for (const prim of entry.mesh.listPrimitives()) {
      const at = atOf(entry, prim);
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i += 7) allPts.push(at(i));
    }
  const whole = boundsOf(allPts);
  const carLength = Math.max(...[0, 1, 2].map((i) => whole.max[i] - whole.min[i]));
  const axes = axesOf(whole);

  /*
    ── 1. 후보 덩어리를 모은다 ────────────────────────────────────────────────

    **크기로 먼저 거르는 것이 두 겹의 안전장치다.**
     · 최장변 — 룸미러를 감싸고 지나가는 지붕 프레임·앞유리를 쳐낸다. 그것들의 바운딩
       박스는 룸미러를 통째로 품고 있어 거리로는 '0' 이라 절대 안 갈린다.
     · 두 번째 변 — 오버헤드 콘솔·선글라스 홀더를 쳐낸다. 룸미러는 납작한 판이지만
       콘솔은 상자다. 아반떼에서는 그 콘솔이 거울면과 앞뒤로 겹쳐 있어 이 조건만이 둘을 가른다.
  */
  /*
    이음매로 갈라진 정점을 잇는 반올림 폭 — 차 길이의 1/200000 (4.7m 차에서 0.024mm).
    meshopt 양자화 간격(차 길이/16384 ≒ 0.29mm)보다 10배 넘게 촘촘해, 같은 자리의 정점은
    반드시 같은 키가 되면서 서로 다른 부품이 실수로 붙지는 않는다.
  */
  const weldScale = 200000 / carLength;

  const maxPart = carLength * MAX_PART_FRAC;
  const maxFlat = carLength * FLAT_FRAC;
  const allParts = [];
  for (const entry of meshes) {
    const mesh = entry.mesh;
    for (const prim of mesh.listPrimitives()) {
      const tris = trianglesOf(prim, atOf(entry, prim), weldScale);
      if (tris.length === 0) continue;
      for (const comp of components(tris)) {
        const b = boundsOf(comp.map((i) => tris[i].c));
        const d = dimsOf(b);
        // small — 룸미러 몸체로 이어 붙일 자격. 거울면을 **찾는** 데에는 쓰지 않는다:
        // 코롤라 사이드미러는 9.2x9.5cm 로 거의 정사각이라 이 조건에서 탈락하는데,
        // 그것까지 걸러 버리면 '가운데 = 룸미러 / 양끝 = 사이드미러' 를 가를 기준이 사라진다.
        const small = d[0] <= maxPart && d[1] <= maxFlat;
        allParts.push({ mesh, prim, tris, comp, b, small, taken: false });
      }
    }
  }
  const parts = allParts.filter((p) => p.small);

  /*
    ── 2. 거울면을 찾는다 ────────────────────────────────────────────────────

    먼저 이름으로 찾는다(코롤라 `miror`, K5 `mirror`). 이름이 없는 모델(아반떼)은 형상으로
    찾는다 — 지붕 아래 한가운데에 뜬 넓고 아주 얇은 판은 룸미러밖에 없다.
  */
  /*
    **명시 목록이 있으면 그것만 쓴다.** 자동 탐지가 통하지 않는 모델(쏘렌토)용이다.
    이름·형상 어느 쪽도 못 믿는 상황에서 추측으로 지우면 무엇이 사라졌는지 알 수 없다.
  */
  const listed = ROOM_MIRROR_PARTS[id];
  if (listed) {
    const byPrim = new Map();
    let total = 0;
    for (const want of listed) {
      const hit = allParts.filter((p) => {
        if (!p.mesh.getName().startsWith(want.mesh)) return false;
        if (p.comp.length !== want.tris) return false;
        const c = [0, 1, 2].map((i) => (p.b.min[i] + p.b.max[i]) / 2 / carLength);
        return [0, 1, 2].every((i) => Math.abs(c[i] - want.center[i]) < PART_TOLERANCE);
      });
      if (hit.length !== 1) {
        throw new Error(
          `${id}: 룸미러 '${want.what}' 를 ${hit.length}개 찾았습니다 (1개여야 함). ` +
            `모델이 바뀌었다면 ROOM_MIRROR_PARTS 의 값을 다시 재세요.`,
        );
      }
      const p = hit[0];
      const size = [0, 1, 2].map((i) => (((p.b.max[i] - p.b.min[i]) / carLength) * 100).toFixed(1));
      console.log(`    ${want.what} — ${p.mesh.getName().slice(0, 26)} ${p.comp.length}개 삼각형 (차 길이의 ${size.join(' x ')}%)`);
      if (!byPrim.has(p.prim)) byPrim.set(p.prim, { tris: p.tris, drop: new Set() });
      for (const i of p.comp) byPrim.get(p.prim).drop.add(i);
      total += p.comp.length;
    }
    if (dry) {
      console.log(`  [미리보기] 지울 것: 부품 ${listed.length}개 · 삼각형 ${total}개 — 파일은 그대로 둡니다`);
      return;
    }
    for (const [prim, { tris, drop }] of byPrim) dropTriangles(doc, prim, tris, drop);
    await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder }));
    doc.getRoot().setExtras({ ...(doc.getRoot().getExtras() ?? {}), roomMirrorRemoved: true });
    await io.write(path, doc);
    console.log(`  룸미러 제거: 부품 ${listed.length}개 · 삼각형 ${total}개`);
    return;
  }

  const named = meshes.find(({ mesh }) =>
    mesh.listPrimitives().some((p) => MIRROR_NAME.test(`${mesh.getName()} ${p.getMaterial()?.getName() ?? ''}`)),
  );

  let glassParts = [];
  if (named) {
    // 그 메시에는 좌·우 사이드미러도 함께 들어 있다. 좌우로 가장 넓은 축에서 가운데인 것만 고른다.
    const own = allParts.filter((p) => p.mesh === named.mesh);
    const span = boundsOf(own.flatMap((p) => [p.b.min, p.b.max]));
    const lat = [0, 1, 2].reduce(
      (best, i) => (span.max[i] - span.min[i] > span.max[best] - span.min[best] ? i : best),
      0,
    );
    const mid = (span.max[lat] + span.min[lat]) / 2;
    const half = (span.max[lat] - span.min[lat]) / 2;
    glassParts = own.filter((p) => Math.abs((p.b.min[lat] + p.b.max[lat]) / 2 - mid) < half * CENTER_FRAC);
    // 전부 가운데면 사이드미러와 못 가른 것이다 (사이드미러가 따로 있는 모델을 전제한다)
    if (glassParts.length === own.length) glassParts = [];
  }
  /*
    형상으로 찾는 것은 **이름난 거울 메시가 아예 없는 모델에서만** 한다.
    거울 메시가 있는데 가운데 뭉치가 없다면 그것은 "룸미러가 이미 없다" 는 뜻이지,
    다른 데서 찾아보라는 뜻이 아니다. (여기서 폴백을 돌렸다가 코롤라의 엉뚱한 판을 지웠다)
  */
  if (glassParts.length === 0 && !named) {
    const found = findGlassByShape(allParts, axes, whole, carLength);
    if (found) glassParts = [found];
  }
  if (glassParts.length === 0) {
    console.log(`  · ${id}: 거울면을 찾지 못했습니다 (이미 지웠거나 룸미러가 없는 모델)`);
    return;
  }

  const glassMesh = glassParts[0].mesh;
  const box = boundsOf(glassParts.flatMap((p) => [p.b.min, p.b.max]));
  box.width = Math.max(...dimsOf(box).slice(0, 1));
  let glassRemoved = 0;
  for (const p of glassParts) {
    p.taken = true;
    glassRemoved += p.comp.length;
  }
  {
    const sideKept = allParts
      .filter((p) => p.mesh === glassMesh && !p.taken)
      .reduce((s, p) => s + p.comp.length, 0);
    const size = [0, 1, 2].map((i) => `${(((box.max[i] - box.min[i]) / carLength) * 100).toFixed(1)}%`);
    console.log(
      `    거울면 ${glassRemoved}개 삼각형 (차 길이의 ${size.join(' x ')})` +
        (named ? ` — 같은 메시의 사이드미러 ${sideKept}개는 유지` : ' — 이름 없이 형상으로 찾음'),
    );
  }

  /** 두 상자가 모든 축에서 gap 이내로 가까운가 (겹치면 0) */
  const near = (a, b, gap) =>
    [0, 1, 2].every((i) => Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i]) <= gap);

  /*
    ── 3. 거울면에 매달린 몸체(하우징·목·지지대)를 이어 붙인다 ────────────────

    **거울면이 박힌 메시**를 정한다 — 거울면과 겹치거나 가장 가까운 덩어리가 있는 메시다.
    코롤라는 실내 통짜 메시, K5 는 검정 플라스틱 메시, 아반떼는 Interior 메시가 여기 해당한다.
    이 메시 안에서만 거리로 이어 붙이므로, 바로 위의 실내등(다른 메시)이 딸려 오지 않는다.
  */
  const nearGap = box.width * NEAR_FRAC;
  const gapTo = (p) => Math.max(...[0, 1, 2].map((i) => Math.max(0, p.b.min[i] - box.max[i], box.min[i] - p.b.max[i])));

  /*
    거울면 곁의 덩어리 중 **가장 큰 것 하나**가 든 메시를 host 로 삼는다. 그것이 하우징이다.

    두 가지를 하면 안 된다.
     · "가장 가까운 덩어리의 메시" — 거울면에 겹치는 덩어리는 여러 메시에 동시에 있어
       (거리가 모두 0) 정렬 순서에 따라 엉뚱한 메시가 뽑힌다. 아반떼에서 이 때문에
       하우징(250 삼각형)을 통째로 놓쳤다.
     · "삼각형이 가장 많은 메시" — K5 는 거울 아래 글자 조각(677 삼각형, 잘게 쪼개짐)이
       하우징이 든 메시(247)보다 많아서, 글자 메시가 host 가 되고 목·지지대를 놓쳤다.

    하우징은 룸미러에서 **가장 큰 단일 부품**이다. 이 기준은 세 모델에서 모두 흔들리지 않는다.
  */
  const host = parts
    .filter((p) => !p.taken && p.mesh !== glassMesh && gapTo(p) <= nearGap)
    .sort((a, b) => b.comp.length - a.comp.length)[0]?.mesh;

  // (a) 거울면이 박힌 메시 안에서 거리로 이어 붙인다 (하우징 → 목 → 지지대 순으로 번진다)
  let grew = true;
  const region = { min: [...box.min], max: [...box.max] };
  while (grew) {
    grew = false;
    for (const p of parts) {
      if (p.taken || p.mesh !== host) continue;
      if (!near(p.b, region, nearGap)) continue;
      p.taken = true;
      grew = true;
      for (const i of [0, 1, 2]) {
        region.min[i] = Math.min(region.min[i], p.b.min[i]);
        region.max[i] = Math.max(region.max[i], p.b.max[i]);
      }
    }
  }

  // (b) 다른 메시에서는 거울면에 **거의 닿은** 잔부품만 가져온다 (거울 아래 글자·버튼 등)
  const touchGap = box.width * TOUCH_FRAC;
  for (const p of parts) {
    if (p.taken || p.mesh === glassMesh) continue;
    if (near(p.b, box, touchGap)) p.taken = true;
  }

  let partsRemoved = 0;
  let trisRemoved = 0;
  const byPrim = new Map();
  const isGlass = new Set(glassParts);
  for (const p of parts) {
    if (!p.taken) continue;
    if (!byPrim.has(p.prim)) byPrim.set(p.prim, { tris: p.tris, drop: new Set() });
    for (const i of p.comp) byPrim.get(p.prim).drop.add(i);
    trisRemoved += p.comp.length;
    if (isGlass.has(p)) continue; // 거울면은 위에서 이미 알렸다
    // 모델 단위는 미터가 아닐 수 있다. 차 길이에 대한 비율로 적어야 크기가 눈에 들어온다.
    const size = [0, 1, 2].map((i) => `${(((p.b.max[i] - p.b.min[i]) / carLength) * 100).toFixed(1)}%`);
    console.log(
      `    ${p.mesh.getName().slice(0, 34).padEnd(34)} 덩어리 ${String(p.comp.length).padStart(5)}개 삼각형 (차 길이의 ${size.join(' x ')})`,
    );
    partsRemoved++;
  }
  const total = trisRemoved;
  if (dry) {
    console.log(`  [미리보기] 지울 것: 거울면 + 부품 ${partsRemoved}개 · 삼각형 ${total}개 — 파일은 그대로 둡니다`);
    return;
  }

  for (const [prim, { tris, drop }] of byPrim) dropTriangles(doc, prim, tris, drop);

  /*
    **다시 압축해서 내보낸다.**

    인덱스를 새로 쓰면 그 접근자만 meshopt 압축이 풀린 채로 남는다. K5(삼각형 34만 개)에서는
    그 인덱스 버퍼 하나 때문에 파일이 2.42MB → 3.06MB(+23%)로 불었다. 로딩 시간에 그대로
    얹히는 양이라 그냥 둘 수 없다.

    prune 은 삼각형이 빠지면서 아무도 참조하지 않게 된 정점을 정리한다.
  */
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder }));

  // 지웠다는 표시를 남긴다 — 다시 돌려도 건드리지 않게 (위의 marked 검사 참조)
  doc.getRoot().setExtras({ ...(doc.getRoot().getExtras() ?? {}), roomMirrorRemoved: true });

  await io.write(path, doc);
  console.log(
    `  룸미러 제거: 거울면 + 부품 ${partsRemoved}개 · 삼각형 ${total}개 (거울면 ${glassRemoved} + 몸체 ${total - glassRemoved})`,
  );
}

/*
  단독 실행:
    node scripts/remove-room-mirror.mjs                # 목록에 있는 차 전부
    node scripts/remove-room-mirror.mjs avante         # 한 대만
    node scripts/remove-room-mirror.mjs --dry avante   # 지우지 않고 무엇이 지워질지만 본다

  --dry 는 **새 차종을 목록에 넣기 전에** 쓴다. 모델마다 룸미러가 어떻게 들어 있는지가 달라,
  눈으로 확인하지 않고 목록에 넣으면 엉뚱한 부품이 사라진 것을 한참 뒤에 발견하게 된다.
*/
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const ids = args.filter((a) => !a.startsWith('--'));
  const targets = ids.length > 0 ? ids : [...ROOM_MIRROR_CARS];
  for (const id of targets) {
    console.log(`· ${id}${dry ? ' (미리보기)' : ''}`);
    await removeRoomMirror(`public/models/${id}.glb`, id, { dry, force: dry });
  }
}
