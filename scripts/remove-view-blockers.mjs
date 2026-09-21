/**
 * 운전 시야를 가리는 실내 부품을 모델에서 잘라낸다 (룸미러 다음 단계).
 *
 * 룸미러를 지운 뒤에도 앞유리 위쪽에 **오버헤드 콘솔·지붕 앞 패널**이 남아 화면을 덮는 차가
 * 있다. 아반떼가 그렇다 — 운전석 눈에서 광선을 쏴 재 보면 앞유리 시야의 **35%** 가 불투명
 * 물체에 가려 있고, 그중 11.5% 가 이 두 부품이었다 (대시보드·A필러는 당연히 남겨야 한다).
 *
 * 실제 차에서는 이것들이 시야 위쪽에 있어 거슬리지 않는다. 이 게임의 화각이 74°로 넓어
 * 실제 운전자보다 훨씬 위까지 화면에 들어오기 때문에 생기는 문제다. 신호와 보행자를 보는 것이
 * 이 게임의 전부라, 가리는 쪽을 포기한다.
 *
 * ── 왜 목록으로 지정하는가
 *
 * 룸미러는 "지붕 아래 한가운데 뜬 넓고 얇은 판" 이라는 형상 규칙으로 찾을 수 있었지만,
 * 시야를 가리는 부품은 차마다 정체가 다르다(콘솔·선바이저·선루프 가림막·실내등).
 * 자동 규칙을 만들면 어느 차에서 무엇이 사라졌는지 알 수 없으므로, **차마다 눈으로 확인하고
 * 여기에 적는다.** 못 찾으면 조용히 넘어가지 않고 오류로 알린다.
 *
 * 좌표·크기는 **차 길이에 대한 비율**로 적는다. 모델마다 1 단위가 1m 이기도 1cm 이기도 하다.
 *
 * 실행: npm run assets (자동) 또는 node scripts/remove-view-blockers.mjs [--dry] <차id>
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { collectMeshes } from './skinning.mjs';

/**
 * 차종별로 잘라낼 부품.
 *
 *  mesh   — 메시 이름의 앞부분 (모델이 바뀌어 이름이 달라지면 못 찾고 오류가 난다)
 *  tris   — 그 연결 덩어리의 삼각형 수. 사실상 지문 역할을 한다.
 *  center — 덩어리 중심 (차 길이 대비 비율, 모델 좌표계 그대로)
 *  what   — 사람이 읽을 이름. 로그에 그대로 나온다.
 */
export const VIEW_BLOCKERS = {
  m8: [
    /*
      **앞유리 바로 위 지붕 앞단(헤더).** 게임에서 찍어(면#17471) 특정했다.

      실내 셸(대시보드·헤드라이너·도어트림이 한 덩어리, 10,495 삼각형)의 일부라 덩어리째로는
      못 다룬다. 그래서 **클릭 지점 둘레의 공 모양 범위**만 잘라 유리로 바꾼다.
      M5 에서 앞유리 전체를 훑다가 차체를 깨뜨렸던 것과 달리, 범위를 한 곳으로 못 박아
      번질 여지를 없앴다.
    */
    {
      what: '앞유리 위 지붕 앞단 → 유리로 전환',
      mesh: 'b:SM_Interior_0000_001',
      material: 'bint1',
      center: [0.0035, 0.2547, 0.1045],
      radiusFrac: 0.05,
      action: 'sphereCut',
    },
    /*
      바로 위(높이 96%)의 **안쪽 층.** 앞 층을 걷어내니 그 뒤가 드러났다 —
      실내 셸은 천장 부근이 두 겹이다. 화면에서 세 점을 찍어 그 셋을 다 덮는 구로 잡았다
      (세 점의 중심에서 최대 90mm, 반경은 여유를 둬 5%=243mm).
    */
    {
      what: '지붕 앞단 안쪽 층 → 유리로 전환',
      mesh: 'b:SM_Interior_0000_001',
      material: 'bint1',
      center: [-0.0013, 0.2677, 0.0947],
      radiusFrac: 0.05,
      action: 'sphereCut',
    },
  ],
  avante: [
    {
      what: '오버헤드 콘솔 (앞유리 시야의 6.0% 를 가림)',
      mesh: 'H:Interior_',
      tris: 152,
      center: [-0.0089, 0.2683, 0.0996],
    },
    {
      what: '지붕 앞 중앙 패널 (앞유리 시야의 5.5% 를 가림)',
      mesh: 'H:Grille7_',
      tris: 40,
      center: [0.0, 0.2734, 0.0452],
    },
    /*
      앞유리를 덮은 **불투명 레이어 두 겹**. 이것이 화면 우측 상단 검은 덩어리의 본체다.

      이 모델의 앞유리는 네 겹인데, 그중 두 겹(`H:WindowInside_`)만 이름에 'window' 가 있어
      게임의 유리 판정(`isGlassPart` — /glass|window|glazing/)에 걸린다. 나머지 두 겹은
      이름이 재질명뿐이라 **불투명하게 칠해진 채로 앞유리 위에 덮인다.**

      **지우지 않고 유리로 바꾼다.** 지워 봤더니 그 자리에 구멍이 나서 지붕 앞쪽으로 하늘이
      비쳤다 — 이 두 겹이 앞유리 위쪽의 유일한 면이었다. 유리로 바꾸면 밖에서 봐도 앞유리가
      그대로 있고, 운전석에서는 비쳐 보인다.
    */
    {
      what: '앞유리 불투명 레이어 1 (Coloured) → 유리로 전환',
      mesh: 'H:Coloured_',
      tris: 140,
      center: [0.0, 0.239, 0.1485],
      action: 'glass',
    },
    {
      what: '앞유리 불투명 레이어 2 (Base) → 유리로 전환',
      mesh: 'H:Base_',
      tris: 162,
      center: [0.0, 0.2425, 0.1453],
      action: 'glass',
    },
    /*
      **지붕 셸이 앞유리 위를 덮은 부분.** 화면 우측 상단의 큰 검은 덩어리가 이것이다.

      게임 안에서 그 지점을 직접 찍어(면#24530) 특정했다. 이 덩어리는 지붕·헤더·A필러가
      이어진 946 삼각형짜리 차체 셸이라 통째로 지우거나 투명하게 만들 수 없다.
      **앞유리에 겹친 삼각형만** 유리로 바꾼다.

      각도 조건(나란한 면)을 쓰지 않는 것이 요점이다. 이 셸은 앞유리 위로 휘어 넘어가는
      곡면이라 유리와 나란하지 않고, 그래서 '겹친 면' 규칙에서 계속 빠져나갔다.
    */
    {
      what: '지붕 셸이 앞유리를 덮은 부분 → 유리로 전환',
      mesh: 'H:Coloured_',
      tris: 1059,
      center: [0.0, 0.2429, -0.0841],
      action: 'glassOverlap',
    },
  ],
  /*
    SF90 스파이더. 룸미러를 지운 뒤에도 앞유리 한가운데 위쪽에 검은 덩어리가 남아 게임에서
    찍었다(면#10318 = 실내 셸, 면#976 = 앞유리를 덮은 Base 레이어).

    아반떼·M5 와 같은 에셋 계열(RewardRecycled)이라 **앞유리 자리에 불투명 레이어가 두 겹**
    (`Coloured_` 167, `Base_` 175 삼각형) 겹쳐 있다. 둘 다 바운딩 박스가 앞유리 유리면
    (29.8 x 6.6 x 17.2%)과 사실상 같아서, 덩어리째 유리로 바꿔도 다른 데 번지지 않는다.
  */
  sf90: [
    {
      what: '앞유리 불투명 레이어 1 (Coloured) → 유리로 전환',
      mesh: 'Coloured_Geo',
      tris: 167,
      center: [0, 0.2002, 0.1479],
      action: 'glass',
    },
    {
      what: '앞유리 불투명 레이어 2 (Base) → 유리로 전환',
      mesh: 'Base_Geo',
      tris: 175,
      center: [0, 0.2031, 0.1451],
      action: 'glass',
    },
    /*
      **앞유리 위 가운데를 덮은 실내 헤더.** 클릭 지점은 앞유리 높이의 73% — 시야 한복판이다.

      이것이 든 실내 셸은 대시보드·도어트림까지 한 덩어리(13,339 삼각형)라 덩어리째로는
      못 다루고, `glassOverlap`(앞유리 상자에 겹친 삼각형만) 도 쓸 수 없다. 상자 안 1,476개
      중 1,062개가 **대시보드 윗면**(아래 20% 구간)이고, 나머지도 좌우 가장자리를 따라
      A필러 트림이 줄지어 있어 함께 투명해지면 앞유리 테두리가 뜯긴다 (M5 에서 겪었다).

      그래서 M8 과 같이 **클릭 지점 둘레의 공 모양 범위**만 유리로 바꾼다. 반경 5%(235mm)면
      806 삼각형을 가져오는데, 높이가 앞유리의 71% 아래로는 내려가지 않아(y 0.0099~0.0109)
      대시보드에 닿지 않고, 좌우로도 ±127mm 라 ±280mm 에 선 A필러 트림에 못 미친다.

      처음에 3%(141mm)로 잡았다가 **뒤의 차체 셸을 뚫은 폭과 맞추려고** 넓혔다 — 두 겹의
      구멍 크기가 다르면 좁은 쪽이 그대로 시야를 막아 넓힌 보람이 없다.
    */
    {
      what: '앞유리 위 가운데 실내 헤더 → 유리로 전환',
      mesh: 'Interior_Geo',
      material: 'Ferrari_SF90SpiderRewardRecycled_2021InteriorA_Material',
      center: [0.007, 0.2189, 0.0763],
      radiusFrac: 0.05,
      action: 'sphereCut',
    },
    /*
      **실내 헤더 바로 뒤의 차체 셸(지붕 앞단).** 위의 실내 헤더를 유리로 바꾸니 그 뒤에서
      이것이 드러나 다시 검게 남았다. 게임에서 찍어(면#1198) 특정했다 — 앞유리 높이의 86%,
      좌우로는 차 중심(운전석 눈은 중심에서 왼쪽으로 450mm 치우쳐 있어 화면에서는 오른쪽에 보인다).

      이 덩어리는 **차체 셸 전체**(5,336 삼각형, 차 길이의 41.5 x 20.6 x 55.2%)라
      `glassOverlap` 을 쓸 수 없다. 앞유리 상자에 걸친 248개를 정면에서 찍어 보면 좌우
      가장자리를 따라 내려가는 **A필러 두 줄**과 아래쪽 카울 띠가 그 대부분이다 — 함께
      투명해지면 앞유리 테두리가 뜯긴다 (M5 에서 겪었다).

      그래서 여기도 구로 도려낸다. 반경 6%(282mm)가 가져오는 63개는 **전부 앞유리 높이
      85% 위**에 있어(지붕 앞단만) 필러·카울에는 닿지 않는다. 지붕 꼭대기(y 0.0114)까지
      살짝 걸치므로 밖에서 보면 지붕 앞에 작은 유리판이 생긴다 — M8 과 같은 처리다.
    */
    {
      what: '앞유리 위 지붕 앞단 (차체 셸) → 유리로 전환',
      mesh: 'Coloured_Geo',
      material: 'Ferrari_SF90SpiderRewardRecycled_2021Coloured_Material',
      center: [0.0027, 0.2254, 0.0977],
      radiusFrac: 0.06,
      action: 'sphereCut',
    },
  ],
  /*
    SL63 (마감이 노란 맨소리). 게임에서 찍어(면#12540 = 실내 트림, 면#326 = 검정 프레임,
    면#160 = 앞유리) 특정했다. 광선을 따라 **트림 → 프레임 → 유리** 순으로 세 겹이다.

    앞의 두 겹은 앞유리를 **테두리처럼 두른 틀**이다(가운데는 비어 있다). 정면에서 찍어 보면
    둘 다 같은 모양이다 — 위 가로대가 앞유리 높이의 64~100%, 옆기둥이 27~64%, 아래 가로대가
    5~18%. 즉 **위 가로대만으로 시야의 위 3분의 1이 막힌다.** 운전석 눈에서 재면 지금은
    위로 17°까지밖에 안 보이고, 이 가로대를 걷으면 유리 윗변인 28°까지 열린다.

    지붕이 열린 로드스터라 가로대 위는 하늘이다. 실제로도 이런 차는 창틀 너머가 보인다.

    **덩어리째 유리로 바꾸면 안 된다** — 아래 가로대(카울 트림)까지 투명해져 대시보드 앞이
    뚫린다. 그래서 `glassOverlap` 로 **앞유리 높이 62% 위**만 고른다.
  */
  sl63: [
    {
      what: '앞유리 틀 윗단 (실내 트림) → 유리로 전환',
      mesh: 'Object_23',
      tris: 213,
      center: [-0.0023, 0.1024, -0.045],
      action: 'glassOverlap',
      aboveFrac: 0.62,
    },
    {
      what: '앞유리 틀 윗단 (검정 프레임) → 유리로 전환',
      mesh: 'Object_21',
      tris: 192,
      center: [-0.0023, 0.0994, -0.0532],
      action: 'glassOverlap',
      aboveFrac: 0.62,
    },
  ],
  m5: [
    /*
      게임 안에서 검은 부분을 직접 찍어(Option+클릭) 특정한 것만 넣는다.

      **`glassOverlap`(덩어리 중 겹친 삼각형만 잘라내기)은 쓰지 않는다.** 차체 셸·실내 셸에
      써 봤더니 앞유리 **테두리**까지 함께 투명해져 지붕과 필러가 뜯겼다. 덩어리 하나를
      통째로 다루는 방식(삭제 또는 유리 전환)만 안전하다.
    */
    { what: '오버헤드 콘솔', mesh: 'Interior_Geo', tris: 174, center: [0.0, 0.2645, 0.0366] },
    {
      what: '앞유리를 덮은 불투명 레이어 → 유리로 전환',
      mesh: 'Base_Geo',
      tris: 150,
      center: [0.0, 0.2341, 0.1276],
      action: 'glass',
    },
  ],
  sorento: [
    /*
      **앞유리를 덮은 불투명 레이어.**

      게임 안에서 직접 찍어(면#101029) 특정했다. 실내 플라스틱 메시에 들어 있어 처음에는
      헤드라이너인 줄 알았는데, 크기를 재 보니 1522x475x872mm 로 **앞유리(1515x457x827mm)와
      거의 같다.** 앞유리 자리에 겹쳐 있는 불투명 판이다.

      지우지 않고 유리로 바꾼다 — 지우면 그 자리가 뚫린다 (아반떼에서 겪었다).
    */
    {
      what: '앞유리를 덮은 불투명 레이어 → 유리로 전환',
      mesh: 'PolySurface0.002',
      tris: 840,
      center: [0.0001, 0.2585, -0.1633],
      action: 'glassOverlap',
    },
  ],
};

/**
 * 유리로 바꿀 때 붙이는 재질 이름.
 * 런타임의 `isGlassPart` 가 /glass|window|glazing/ 를 보므로 이 이름이면 투명 처리된다.
 */
const GLASS_MATERIAL_NAME = 'windshield_glass_converted';

/**
 * 유리로 바꾼 겹의 불투명도.
 *
 * 원래 앞유리(WindowInside) 한 겹은 런타임이 0.12 로 그린다 — 그게 '유리다운' 농도다.
 * 여기서 덧대는 겹들은 그 위에 3~4장 더 쌓이므로 같은 값을 주면 그 자리만 진해져
 * **썬팅 얼룩**이 된다. 거의 안 보이는 값으로 두어 유리 농도는 원래 한 겹이 정하게 한다.
 */
const GLASS_ALPHA = 0.02;

/**
 * **앞유리 농도를 통일할 차** — 메시 이름 규칙.
 *
 * 아반떼의 앞유리는 원래 `WindowInside` 두 겹이고, 런타임이 각각 0.12 로 그려 합쳐 23% 농도가
 * 된다. 그런데 우리가 불투명 셸을 걷어낸 자리는 **원래 유리가 없던 곳**이라 우리 겹(0.02)만
 * 남아 거의 투명하다. 그 결과 한 앞유리 안에서 농도가 갈려 **썬팅이 벗겨진 자국**처럼 보인다.
 *
 * 그래서 원래 유리도 같은 값으로 내려 **앞유리 전체를 고르게** 만든다. 이 게임에서 앞유리는
 * 밖을 보는 창이지 감상 대상이 아니므로, 옅은 쪽으로 맞추는 것이 맞다.
 * (BLEND 로 내보내면 런타임의 `makeGlassSeeThrough` 가 건드리지 않는다)
 */
const GLASS_UNIFORM = { avante: /WindowInside/i };

/**
 * **유리에 겹쳐 있는 불투명 면**을 유리로 바꿀 차 목록.
 *
 * 아반떼가 이 경우다. 유리가 여러 겹으로 쌓여 있는데 이름에 'window' 가 든 겹만 게임이
 * 투명하게 만들고, 나머지는 불투명하게 남아 앞유리를 덮는다. 덩어리 단위로 잡으려 했지만
 * 그중 하나는 **지붕까지 이어진 차체 셸의 일부**(1,059 삼각형 중 163개만 앞유리에 걸침)라
 * 덩어리로는 떼어낼 수 없었다.
 *
 * 그래서 삼각형 단위로, **유리에 바싹 붙어 있고(거리) 유리와 나란한(각도)** 면만 고른다.
 * 두 조건을 모두 걸어야 유리에 스치는 와이퍼·A필러 가장자리가 함께 투명해지지 않는다.
 */
const GLASS_COINCIDENT_CARS = new Set(['avante']);

/** 유리 면에서 이 거리(차 길이 대비) 안에 있으면 '겹쳐 있다'고 본다 — 4.7m 차에서 28mm */
const COINCIDENT_DIST = 0.006;

/** 유리 면과 이 각도 안에서 나란하면 '같은 면'으로 본다 */
const COINCIDENT_ANGLE_COS = Math.cos((25 * Math.PI) / 180);

/** 중심 좌표가 이만큼(차 길이 대비) 안에 들면 같은 부품으로 본다 */
const CENTER_TOLERANCE = 0.01;

const boundsOf = (pts) => ({
  min: [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))),
  max: [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))),
});

export async function removeViewBlockers(path, id, opts = {}) {
  const wanted = VIEW_BLOCKERS[id];
  if (!wanted) return;
  const dry = opts.dry ?? false;

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const doc = await io.read(path);
  if (doc.getRoot().getExtras()?.viewBlockersRemoved) {
    console.log(`  · ${id}: 이미 시야 가림 부품을 지운 모델입니다 — 건너뜁니다`);
    return;
  }

  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  /*
    **뼈대(스킨)가 걸린 모델은 정점 자리가 노드 행렬로 정해지지 않는다** (skinning.mjs 참고).
    SL63 이 그렇다 — 이걸 반영하지 않으면 차 크기도 앞유리도 전부 엉뚱하게 잡힌다.
  */
  const meshes = collectMeshes(scene);
  const vertexFns = new Map();
  const atOf = (entry, prim) => {
    if (!vertexFns.has(prim)) vertexFns.set(prim, entry.vertexAt(prim));
    return vertexFns.get(prim);
  };
  const entryOf = (prim) => meshes.find((e) => e.mesh.listPrimitives().includes(prim));

  const allPts = [];
  for (const entry of meshes)
    for (const prim of entry.mesh.listPrimitives()) {
      const at = atOf(entry, prim);
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i += 7) allPts.push(at(i));
    }
  const whole = boundsOf(allPts);
  const carLength = Math.max(...[0, 1, 2].map((i) => whole.max[i] - whole.min[i]));
  const weldScale = 200000 / carLength;

  // 연결 덩어리로 나눈다 (remove-room-mirror.mjs 와 같은 방식)
  const parts = [];
  for (const entry of meshes) {
    const mesh = entry.mesh;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const vertexAt = atOf(entry, prim);
      const at = (i) => vertexAt(idx ? idx.getScalar(i) : i);
      const key = (p) => p.map((v) => Math.round(v * weldScale)).join(',');
      const tris = [];
      for (let t = 0; t + 2 < count; t += 3) {
        const v = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
        const p = [at(t), at(t + 1), at(t + 2)];
        tris.push({ v, k: p.map(key), c: [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3) });
      }
      const byVert = new Map();
      tris.forEach((tri, i) =>
        tri.k.forEach((k) => {
          if (!byVert.has(k)) byVert.set(k, []);
          byVert.get(k).push(i);
        }),
      );
      const seen = new Set();
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
        const b = boundsOf(comp.map((j) => tris[j].c));
        parts.push({ mesh, prim, tris, comp, b });
      }
    }
  }

  const byPrim = new Map();
  const overlapTargets = [];
  let removed = 0;

  /*
    ── 공 모양 범위 잘라내기 ─────────────────────────────────────────────────
    통짜 메시 안의 한 곳만 도려내야 할 때 쓴다. 연결 덩어리로는 못 가르고(전체가 하나),
    상자로 자르면 축에 나란한 면이 길게 잘려 티가 난다. 공 모양이 가장 눈에 안 띈다.
  */
  for (const want of wanted.filter((w) => w.action === 'sphereCut')) {
    const owner = meshes.find(
      ({ mesh }) =>
        mesh.getName().startsWith(want.mesh) &&
        mesh.listPrimitives().some((p) => p.getMaterial()?.getName() === want.material),
    );
    if (!owner) throw new Error(`${id}: '${want.what}' 의 메시/재질을 찾지 못했습니다`);
    const prim = owner.mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === want.material);
    const tris = [];
    {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const vertexAt = atOf(owner, prim);
      const at = (i) => vertexAt(idx ? idx.getScalar(i) : i);
      for (let t = 0; t + 2 < count; t += 3) {
        const v = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
        const p = [at(t), at(t + 1), at(t + 2)];
        tris.push({ v, p, c: [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3) });
      }
    }
    const ctr = want.center.map((v) => v * carLength);
    const R = want.radiusFrac * carLength;
    /*
      **무게중심만 보면 안 된다.** 지붕 삼각형은 한 장이 커서, 화면에서는 구 안에 걸쳐
      보이는데 무게중심은 구 밖인 것들이 남는다 (M8 에서 실제로 그랬다).
      꼭짓점 하나라도 구 안이면 함께 가져온다.
    */
    const inside = (q) => Math.hypot(...[0, 1, 2].map((k) => q[k] - ctr[k])) <= R;
    const pick = [];
    tris.forEach((t, i) => {
      if (inside(t.c) || t.p.some(inside)) pick.push(i);
    });
    if (pick.length === 0) throw new Error(`${id}: '${want.what}' 범위에 삼각형이 없습니다`);
    if (!byPrim.has(prim)) byPrim.set(prim, { tris, drop: new Set(), glass: [] });
    const slot = byPrim.get(prim);
    for (const i of pick) {
      slot.drop.add(i);
      slot.glass.push(i);
    }
    removed += pick.length;
    console.log(
      `    ${want.what} — ${pick.length}개 삼각형 (반경 ${((R / carLength) * 100).toFixed(1)}% = ${(want.radiusFrac * 4867).toFixed(0)}mm)`,
    );
  }

  for (const want of wanted) {
    if (want.action === 'sphereCut') continue;
    const hit = parts.filter((p) => {
      if (!p.mesh.getName().startsWith(want.mesh)) return false;
      if (p.comp.length !== want.tris) return false;
      const c = [0, 1, 2].map((i) => (p.b.min[i] + p.b.max[i]) / 2 / carLength);
      return [0, 1, 2].every((i) => Math.abs(c[i] - want.center[i]) < CENTER_TOLERANCE);
    });
    if (hit.length !== 1) {
      throw new Error(
        `${id}: '${want.what}' 를 ${hit.length}개 찾았습니다 (1개여야 함). ` +
          `모델이 바뀌었다면 VIEW_BLOCKERS 의 좌표·삼각형 수를 다시 재세요.`,
      );
    }
    const p = hit[0];
    const size = [0, 1, 2].map((i) => ((p.b.max[i] - p.b.min[i]) / carLength * 100).toFixed(1));
    console.log(`    ${want.what} — ${p.mesh.getName().slice(0, 24)} ${p.comp.length}개 삼각형 (차 길이의 ${size.join(' x ')}%)`);
    // 앞유리에 겹친 부분만 골라야 하는 것은 유리 기준을 잡은 뒤에 처리한다
    if (want.action === 'glassOverlap') {
      overlapTargets.push({ want, part: p });
      continue;
    }
    if (!byPrim.has(p.prim)) byPrim.set(p.prim, { tris: p.tris, drop: new Set(), glass: [] });
    const slot = byPrim.get(p.prim);
    for (const i of p.comp) slot.drop.add(i);
    // 유리로 바꿀 것은 원래 프리미티브에서 빼내되, 지우지 않고 따로 모아 둔다
    if (want.action === 'glass') slot.glass.push(...p.comp);
    removed += p.comp.length;
  }

  /*
    ── 유리에 겹친 불투명 면을 유리로 ────────────────────────────────────────

    먼저 **유리 면**을 모아 격자에 담고(면마다 무게중심과 법선), 그다음 모든 불투명 삼각형을
    훑어 가까우면서 나란한 것을 고른다. 격자가 없으면 삼각형 20만 개 × 유리 면 수천 개라
    끝나지 않는다.
  */
  if (GLASS_COINCIDENT_CARS.has(id) || overlapTargets.length > 0) {
    const norm = (p) => {
      const u = [0, 1, 2].map((i) => p[1][i] - p[0][i]);
      const v = [0, 1, 2].map((i) => p[2][i] - p[0][i]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(...n) || 1;
      return n.map((c) => c / len);
    };
    const R = carLength * COINCIDENT_DIST;
    const cell = (c) => c.map((v) => Math.floor(v / R)).join(',');
    const grid = new Map();

    /*
      점에서 삼각형까지의 **실제 최단거리**.

      처음에는 무게중심끼리 재서 겹침을 판별했는데, 앞유리는 삼각형 122개로 1.4m 를 덮어
      한 장이 10cm 가 넘는다. 그래서 면이 10mm 붙어 있어도 무게중심은 한참 떨어져 있어
      **바로 뒤에 붙은 겹을 놓쳤다.** 면까지의 거리로 재야 한다.
    */
    const closestDist = (p, tri) => {
      const [a, b, c] = tri;
      const sub3 = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
      const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      const ab = sub3(b, a);
      const ac = sub3(c, a);
      const ap = sub3(p, a);
      const d1 = dot3(ab, ap);
      const d2 = dot3(ac, ap);
      if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
      const bp = sub3(p, b);
      const d3 = dot3(ab, bp);
      const d4 = dot3(ac, bp);
      if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return Math.hypot(...sub3(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]));
      }
      const cp = sub3(p, c);
      const d5 = dot3(ab, cp);
      const d6 = dot3(ac, cp);
      if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
      const vb = d5 * d2 - d1 * d6;
      if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return Math.hypot(...sub3(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]));
      }
      const va = d3 * d6 - d5 * d4;
      if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        return Math.hypot(...sub3(p, [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]));
      }
      const denom = 1 / (va + vb + vc);
      const v = vb * denom;
      const w = vc * denom;
      return Math.hypot(...sub3(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
    };
    const isGlassLabel = (mesh, prim) =>
      /glass|window|glazing/i.test(`${mesh.getName()} ${prim.getMaterial()?.getName() ?? ''}`);

    const trisOf = (entry, prim) => {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const vertexAt = atOf(entry, prim);
      const at = (i) => vertexAt(idx ? idx.getScalar(i) : i);
      const out = [];
      for (let t = 0; t + 2 < count; t += 3) {
        const v = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
        const p = [at(t), at(t + 1), at(t + 2)];
        out.push({
          v,
          p,
          // 위치 기반 꼭짓점 키 — 번호로 이으면 이음매에서 한 장이 여러 조각으로 갈린다
          k: p.map((q) => q.map((x) => Math.round(x * weldScale)).join(',')),
          c: [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3),
          n: norm(p),
        });
      }
      return out;
    };

    /*
      기준으로 삼을 유리는 **앞유리 한 장뿐**이다.

      처음에는 유리로 이름 붙은 면을 전부 기준으로 썼는데, 전조등 렌즈도 유리라서 그 뒤의
      **램프 내부 4,746 삼각형이 통째로 투명해졌다.** 옆창·뒷창도 마찬가지 위험이 있다.
      앞유리는 유리 중 가장 넓은 면이므로 그것만 고른다.
    */
    const glassParts = [];
    for (const entry of meshes)
      for (const prim of entry.mesh.listPrimitives()) {
        if (!isGlassLabel(entry.mesh, prim)) continue;
        const tris = trisOf(entry, prim);
        if (tris.length === 0) continue;
        /*
          **프리미티브가 아니라 연결 덩어리 단위로** 나눠야 한다. 유리는 한 프리미티브에
          앞유리·옆창·뒷창·등화 렌즈가 함께 들어 있어, 프리미티브째 기준으로 삼으면
          전조등 뒤의 램프 내부까지 '유리에 겹쳤다'고 잡힌다 (실제로 3,657개가 잡혔다).
        */
        /*
          **위치로 잇는다.** 번호(`t.v`)로 이으면 최적화 과정에서 갈라진 이음매 때문에
          앞유리 한 장이 여러 조각으로 쪼개져, '가장 큰 유리'가 실제 앞유리보다 작게 잡힌다
          (M5 에서 1404mm 짜리 앞유리가 1168mm 조각으로 잡혔다).
        */
        const byVert = new Map();
        tris.forEach((t, i) =>
          t.k.forEach((k) => {
            if (!byVert.has(k)) byVert.set(k, []);
            byVert.get(k).push(i);
          }),
        );
        const seen = new Set();
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
          const ct = comp.map((j) => tris[j]);
          /*
            크기는 **꼭짓점**으로 잰다. 무게중심으로 재면 삼각형이 적은 큰 판이 실제보다
            작게 나와, M5 에서 앞유리(1404mm) 대신 뒷유리(1186mm)가 기준으로 뽑혔다.
          */
          const b = boundsOf(ct.flatMap((t) => t.p));
          const d = [0, 1, 2].map((k) => b.max[k] - b.min[k]).sort((x, y) => y - x);
          glassParts.push({ tris: ct, area: d[0] * d[1], b });
        }
      }
    const windshield = glassParts.sort((a, b) => b.area - a.area)[0];
    if (!windshield) throw new Error(`${id}: 유리를 찾지 못해 겹친 면을 판별할 수 없습니다`);
    console.log(
      `    기준 앞유리: ${windshield.tris.length}개 삼각형 ` +
        `(차 길이의 ${[0, 1, 2].map((i) => (((windshield.b.max[i] - windshield.b.min[i]) / carLength) * 100).toFixed(1)).join(' x ')}%)`,
    );
    /*
      유리 삼각형은 **바운딩 박스가 걸치는 모든 칸**에 담는다. 무게중심이 있는 칸에만 담으면
      큰 삼각형(앞유리는 한 장이 10cm 가 넘는다)의 가장자리 근처를 조회할 때 찾지 못한다.
    */
    for (const t of windshield.tris) {
      const b = boundsOf(t.p);
      const lo = b.min.map((v) => Math.floor((v - R) / R));
      const hi = b.max.map((v) => Math.floor((v + R) / R));
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const k = `${x},${y},${z}`;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(t);
          }
    }
    void cell;

    /*
      ── 지정한 덩어리에서 '앞유리에 겹친 삼각형'만 유리로 ──────────────────────
      각도는 보지 않는다. 지붕 셸처럼 유리 위로 휘어 넘어가는 곡면을 잡아야 하기 때문이다.
      대신 대상 덩어리를 **미리 지정**했으므로 엉뚱한 부품이 걸릴 일이 없다.
    */
    /*
      기준은 유리 **표면까지의 거리**가 아니라 **앞유리가 차지하는 상자 안인가**다.

      지붕 셸은 앞유리보다 80mm 앞으로 나와 있어(바깥쪽으로 부풀어 있다) 표면 거리로는
      걸러지지 않았다. 운전자가 보는 것은 '앞유리가 뚫려 있어야 할 자리를 무엇이 막고
      있는가' 이므로, 그 자리(=앞유리 바운딩 박스) 안에 들어온 면을 고르는 것이 맞다.
      상자 밖의 지붕·A필러는 그대로 불투명하게 남는다.
    */
    const wsBox = boundsOf(windshield.tris.flatMap((t) => t.p));
    for (const { want, part } of overlapTargets) {
      const tris = trisOf(entryOf(part.prim), part.prim);
      const inComp = new Set(part.comp);
      /*
        `aboveFrac` — 앞유리 높이의 이 지점 **위쪽만** 고른다.

        실내 셸처럼 대시보드까지 한 덩어리인 부품에 필요하다. 앞유리 상자는 축에 나란한
        직육면체라 아래로는 카울까지 내려오는데, 그 구간에는 **대시보드 윗면**이 들어 있다
        (M5 실측: 상자 안 1,593개 중 1,341개가 아래 20% 구간 = 대시보드).
        그것까지 투명하게 만들면 계기판 앞이 뻥 뚫린다.
      */
      // 높이 축 = 차에서 가장 짧은 축 (모델마다 위가 Y 이기도 Z 이기도 하다)
      const ext = [0, 1, 2].map((i) => whole.max[i] - whole.min[i]);
      const up = [0, 1, 2].sort((a, b) => ext[a] - ext[b])[0];
      const floor = want.aboveFrac
        ? wsBox.min[up] + (wsBox.max[up] - wsBox.min[up]) * want.aboveFrac
        : -Infinity;
      /*
        `padUpFrac` — 앞유리 상자를 **위로만** 이만큼(앞유리 높이 대비) 넓힌다.

        차체 셸은 앞유리 윗변을 살짝 넘어 걸치는 경우가 있다. M5 에서 화면에 남은 조각이
        상자 위끝보다 **7mm** 위에 있어 빠져나갔다. 아래·좌우로는 넓히지 않는다 —
        아래로 넓히면 대시보드가, 옆으로 넓히면 A필러가 딸려 온다.
      */
      const hUp = (wsBox.max[up] - wsBox.min[up]) * (want.padUpFrac ?? 0);
      const inBox = (p) =>
        [0, 1, 2].every((i) => p[i] >= wsBox.min[i] && p[i] <= wsBox.max[i] + (i === up ? hUp : 0)) &&
        p[up] >= floor;
      const pick = [];
      for (const i of inComp) {
        if (inBox(tris[i].c)) pick.push(i);
      }
      if (pick.length === 0) {
        throw new Error(`${id}: '${want.what}' — 앞유리에 겹친 삼각형을 찾지 못했습니다`);
      }
      if (!byPrim.has(part.prim)) byPrim.set(part.prim, { tris, drop: new Set(), glass: [] });
      const slot = byPrim.get(part.prim);
      for (const i of pick) {
        slot.drop.add(i);
        slot.glass.push(i);
      }
      removed += pick.length;
      console.log(`    ${want.what} — 덩어리 ${part.comp.length}개 중 ${pick.length}개를 유리로`);
    }

    let converted = 0;
    // '유리에 겹친 면' 자동 전환은 지정한 차에서만 돈다 (지정 덩어리 처리와는 별개다)
    if (GLASS_COINCIDENT_CARS.has(id))
    for (const entry of meshes)
      for (const prim of entry.mesh.listPrimitives()) {
        if (isGlassLabel(entry.mesh, prim)) continue;
        const mesh = entry.mesh;
        const tris = trisOf(entry, prim);
        const pick = [];
        tris.forEach((t, i) => {
          const [cx, cy, cz] = t.c.map((v) => Math.floor(v / R));
          for (const g of grid.get(`${cx},${cy},${cz}`) ?? []) {
            if (closestDist(t.c, g.p) > R) continue;
            if (Math.abs([0, 1, 2].reduce((s, k) => s + t.n[k] * g.n[k], 0)) < COINCIDENT_ANGLE_COS) continue;
            pick.push(i);
            return;
          }
        });
        if (pick.length === 0) continue;
        if (!byPrim.has(prim)) byPrim.set(prim, { tris, drop: new Set(), glass: [] });
        const slot = byPrim.get(prim);
        for (const i of pick) {
          slot.drop.add(i);
          slot.glass.push(i);
        }
        converted += pick.length;
        console.log(`    유리에 겹친 면 → 유리: ${mesh.getName().slice(0, 30)} ${pick.length}개 삼각형`);
      }
    removed += converted;
  }

  /*
    미리보기는 **겹침 처리까지 끝난 뒤** 알려야 한다. 예전에는 이 검사가 앞에 있어
    '앞유리에 겹친 부분' 처리 결과가 빠진 채 0개로 나왔다.
  */
  if (dry) {
    console.log(`  [미리보기] 지울 것: 부품 ${wanted.length}개 · 삼각형 ${removed}개 — 파일은 그대로 둡니다`);
    return;
  }

  const buffer = doc.getRoot().listBuffers()[0];
  for (const [prim, { tris, drop, glass }] of byPrim) {
    const keep = [];
    tris.forEach((tri, i) => {
      if (!drop.has(i)) keep.push(...tri.v);
    });
    const Indices = prim.getAttribute('POSITION').getCount() < 65536 ? Uint16Array : Uint32Array;
    prim.setIndices(doc.createAccessor().setArray(new Indices(keep)).setBuffer(buffer));

    /*
      유리로 바꿀 삼각형은 **같은 정점 버퍼를 가리키는 새 프리미티브**로 옮기고, 재질만
      복제해 이름에 glass 를 넣는다.
      (재질을 그대로 쓰면 그 재질을 나눠 쓰는 차체 외판까지 투명해진다)

      투명도는 **여기서 직접 정한다.** 런타임의 `makeGlassSeeThrough` 는 이미 투명한 재질은
      건드리지 않으므로(`mat.transparent` 검사), BLEND 로 내보내면 이 값이 그대로 쓰인다.
      런타임에 맡기면 불투명도 0.12 가 붙는데, 여기서 만든 겹이 3~4장 겹치는 자리는
      그만큼 진해져 **썬팅한 것처럼 얼룩**이 진다. 원래 앞유리 한 겹은 그대로 0.12 로
      남으므로, 덧댄 겹은 거의 보이지 않게 두는 편이 맞다.

      바탕색과 텍스처도 지운다. 원본 재질은 차체 도장(검정·유색)이라 그대로 두면
      옅게라도 색이 배어 나온다.
    */
    const glassUnique = [...new Set(glass)];
    if (glassUnique.length === 0) continue;
    const mat = prim.getMaterial()?.clone().setName(GLASS_MATERIAL_NAME) ?? null;
    if (mat) {
      mat.setAlphaMode('BLEND');
      mat.setBaseColorFactor([1, 1, 1, GLASS_ALPHA]);
      mat.setBaseColorTexture(null);
      mat.setMetallicFactor(0);
      mat.setRoughnessFactor(1);
      mat.setEmissiveFactor([0, 0, 0]);
      mat.setEmissiveTexture(null);
    }
    const split = doc
      .createPrimitive()
      .setMaterial(mat)
      .setMode(prim.getMode())
      .setIndices(doc.createAccessor().setArray(new Indices(glassUnique.flatMap((i) => tris[i].v))).setBuffer(buffer));
    for (const name of prim.listSemantics()) split.setAttribute(name, prim.getAttribute(name));
    // 같은 메시에 붙여야 자리가 어긋나지 않는다
    for (const { mesh } of meshes) {
      if (mesh.listPrimitives().includes(prim)) {
        mesh.addPrimitive(split);
        break;
      }
    }
  }

  /*
    앞유리 원래 유리도 같은 농도로 내려 **한 장처럼 보이게** 한다 (GLASS_UNIFORM 설명 참조).
    재질은 복제해서 바꾼다 — 이 재질을 다른 부품이 나눠 쓰고 있을 수 있다.
  */
  const uniform = GLASS_UNIFORM[id];
  if (uniform) {
    const done = new Map();
    let n = 0;
    for (const { mesh } of meshes) {
      if (!uniform.test(mesh.getName())) continue;
      for (const prim of mesh.listPrimitives()) {
        const src = prim.getMaterial();
        if (!src || src.getName() === GLASS_MATERIAL_NAME) continue;
        let clone = done.get(src);
        if (!clone) {
          clone = src.clone().setName(`${src.getName()}_glass_uniform`);
          clone.setAlphaMode('BLEND');
          const c = clone.getBaseColorFactor();
          clone.setBaseColorFactor([c[0], c[1], c[2], GLASS_ALPHA]);
          done.set(src, clone);
        }
        prim.setMaterial(clone);
        n += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
      }
    }
    if (n > 0) console.log(`    앞유리 농도 통일: ${n}개 삼각형을 불투명도 ${GLASS_ALPHA} 로`);
  }

  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder }));
  doc.getRoot().setExtras({ ...(doc.getRoot().getExtras() ?? {}), viewBlockersRemoved: true });
  await io.write(path, doc);
  console.log(`  시야 가림 부품 제거: ${wanted.length}개 · 삼각형 ${removed}개`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const ids = args.filter((a) => !a.startsWith('--'));
  for (const id of ids.length > 0 ? ids : Object.keys(VIEW_BLOCKERS)) {
    console.log(`· ${id}${dry ? ' (미리보기)' : ''}`);
    await removeViewBlockers(`public/models/${id}.glb`, id, { dry });
  }
}
