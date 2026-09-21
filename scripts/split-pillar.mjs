/**
 * B필러 트림을 **별도 노드로 갈라낸다.**
 *
 * 이 모델의 실내는 통짜 메시 하나다(정점 15,215개). 그 안에 B필러 트림이 섞여 있는데,
 * 운전석 시점에서는 그것을 잡아 주는 지붕과 차체가 꺼지므로 필러만 좌석 옆에 세로로 선
 * 검은 프레임처럼 떠 보인다.
 *
 * 런타임에서 좌표 조건으로 삼각형을 골라 지워 봤지만, 조건을 넓히면 옆 트림이 톱니처럼
 * 뜯기고 좁히면 기둥이 남았다 — 통짜 메시라 필러만 골라낼 경계가 없기 때문이다.
 * 그래서 **빌드 시점에 한 번** 갈라 이름을 붙여 둔다. 런타임은 그 이름만 보면 된다.
 *
 * 정점 데이터는 그대로 두고 **인덱스만 둘로 나눈다.** 같은 정점 버퍼를 두 프리미티브가
 * 나눠 쓰므로 파일이 커지지 않는다.
 *
 * 실행: optimize-models.mjs 가 굽고 난 뒤 자동으로 불린다.
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** 갈라낸 노드에 붙일 이름 — 런타임(carModel.ts)의 DROP_PARTS 와 맞춰야 한다 */
export const PILLAR_NODE = 'b_pillar_trim';

/*
  필러 영역 (차량 로컬 좌표, 전장 3.34m 로 맞췄을 때).

  운전석 눈에서 광선을 쏴 재고, 실내 메시의 정점 분포로 확인한 값이다 —
  |x| 0.40~0.58 · z 0.10~0.30 에 정점 570개가 몰려 있고 그것이 B필러다.
  앞쪽(A필러·대시보드 옆면)과 뒤쪽(C필러)은 이 범위 밖이라 건드리지 않는다.

  **아래 경계(minY)가 특히 중요하다.** 0.609 로 잡았을 때 y 0.60~0.65 구간에서만
  삼각형 284개가 딸려 나갔는데, 그 띠는 필러가 아니라 **도어 트림 윗면**이다.
  그래서 왼쪽을 보면 트림이 톱니처럼 뜯겨 보였다. 필러만 있는 높이는 0.65 위다
  (0.65~0.90 에서는 이 열의 삼각형이 전부 필러다 — 100개).
*/
const REGION = { minAbsX: 0.391, minY: 0.65, minZ: 0.0, maxZ: 0.352 };

/** carModel.ts 의 fitToCar 와 같은 변환 — 재는 좌표계를 런타임과 맞춘다 */
const REF_LENGTH = 3.34;
const BODY_LENGTH = 4.3378; // 모델의 차체 길이 (실측)
const SCALE = REF_LENGTH / BODY_LENGTH;
const Y_OFFSET = 0.064; // 바닥을 y=0 으로 내리는 양 (스케일 후)

const mul = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const mulM = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
/** 모델 좌표 → 차량 로컬 좌표 (yaw 180° 회전 + 길이 기준 스케일 + 바닥 정렬) */
const toCarLocal = (p) => [-p[0] * SCALE, p[1] * SCALE - Y_OFFSET, -p[2] * SCALE];

const inRegion = (p) =>
  Math.abs(p[0]) > REGION.minAbsX && p[1] > REGION.minY && p[2] > REGION.minZ && p[2] < REGION.maxZ;

/**
 * 가장자리를 주워 담을 때 쓰는 조금 넓힌 영역 — 여기를 넘어서는 번지지 않는다.
 *
 * 7cm 로 잡고 4번 번지게 했더니 도어 트림과 지붕 쪽으로 계속 타고 들어가, 운전석에서
 * 왼쪽을 보면 **가장자리가 톱니처럼 뜯겨** 보였다. 붙어 있는 삼각형은 어차피 이어져
 * 있으므로 넓게 잡을 이유가 없다 — 딱 한 겹만 주워 담는다.
 */
const MARGIN = 0.02;
const GROW_PASSES = 1;
const nearRegion = (p) =>
  Math.abs(p[0]) > REGION.minAbsX - MARGIN &&
  p[1] > REGION.minY - MARGIN &&
  p[2] > REGION.minZ - MARGIN &&
  p[2] < REGION.maxZ + MARGIN;

export async function splitPillar(path) {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const doc = await io.read(path);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];

  // 실내 메시를 찾는다 (이름에 interior 가 들어가는 것 중 가장 큰 것)
  let target = null;
  const walk = (node, world) => {
    const m = mulM(world, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh && /interior/i.test(mesh.getName())) {
      const n = mesh.listPrimitives().reduce((s, p) => s + p.getAttribute('POSITION').getCount(), 0);
      if (!target || n > target.count) target = { node, mesh, world: m, count: n };
    }
    node.listChildren().forEach((c) => walk(c, m));
  };
  scene.listChildren().forEach((n) => walk(n, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));

  if (!target) {
    console.log('  · 실내 메시를 찾지 못했습니다 — B필러 분리를 건너뜁니다');
    return;
  }

  const pillarMesh = doc.createMesh(PILLAR_NODE);
  let moved = 0;

  for (const prim of target.mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const count = idx ? idx.getCount() : pos.getCount();
    const at = (i) => toCarLocal(mul(target.world, pos.getElement(idx ? idx.getScalar(i) : i, [0, 0, 0])));

    /*
      **두 단계로 고른다.**

      1) 세 꼭짓점이 모두 영역 안인 삼각형 — 기둥의 몸통
      2) 거기에 **면을 맞대고 있으면서**(꼭짓점 2개 공유) 조금 넓힌 영역 안에 있는 삼각형
         — 경계에 걸친 가장자리

      1단계만 하면 경계 삼각형이 남아 가는 검은 조각으로 붙어 있고, 그렇다고 "한 꼭짓점만
      걸쳐도" 로 하면 영역 밖으로 뻗은 삼각형까지 딸려 나가 옆 트림이 톱니처럼 뜯긴다.
      연결 관계로 번지되 넓힌 영역을 넘지 않게 하면 둘 다 피할 수 있다.
    */
    const tris = [];
    for (let t = 0; t + 2 < count; t += 3) {
      const v = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
      tris.push({ v, p: [at(t), at(t + 1), at(t + 2)], take: false });
    }

    const seedVerts = new Set();
    for (const tri of tris) {
      if (!tri.p.every(inRegion)) continue;
      tri.take = true;
      for (const i of tri.v) seedVerts.add(i);
    }
    for (let pass = 0; pass < GROW_PASSES; pass++) {
      let grew = false;
      for (const tri of tris) {
        if (tri.take) continue;
        if (!tri.p.every(nearRegion)) continue;
        if (tri.v.filter((i) => seedVerts.has(i)).length < 2) continue;
        tri.take = true;
        for (const i of tri.v) seedVerts.add(i);
        grew = true;
      }
      if (!grew) break;
    }

    const keep = [];
    const take = [];
    for (const tri of tris) (tri.take ? take : keep).push(...tri.v);
    if (take.length === 0) continue;
    moved += take.length / 3;
    // 정점이 65,536 미만이면 u16 으로 둔다 — u32 로 굳히면 인덱스 버퍼가 두 배가 된다
    const Indices = pos.getCount() < 65536 ? Uint16Array : Uint32Array;

    /*
      정점 버퍼는 건드리지 않고 **인덱스만** 새로 만든다.
      두 프리미티브가 같은 POSITION/NORMAL/UV 접근자를 가리키므로 용량이 늘지 않는다.
      (쓰지 않는 정점은 gltf-transform 이 다음 최적화 때 정리한다)
    */
    const buffer = doc.getRoot().listBuffers()[0];
    const split = doc
      .createPrimitive()
      .setMaterial(prim.getMaterial())
      .setMode(prim.getMode())
      .setIndices(doc.createAccessor().setArray(new Indices(take)).setBuffer(buffer));
    for (const name of prim.listSemantics()) split.setAttribute(name, prim.getAttribute(name));
    pillarMesh.addPrimitive(split);

    prim.setIndices(doc.createAccessor().setArray(new Indices(keep)).setBuffer(buffer));
  }

  if (moved === 0) {
    console.log('  · B필러 영역에 삼각형이 없습니다 — 모델이 바뀌었는지 확인하세요');
    pillarMesh.dispose();
    return;
  }

  // 원래 노드와 같은 부모·같은 변환으로 붙여야 자리가 어긋나지 않는다
  const node = doc.createNode(PILLAR_NODE).setMesh(pillarMesh);
  node.setMatrix(target.node.getMatrix());
  const parents = target.node.listParents().filter((p) => p.propertyType === 'Node');
  if (parents.length > 0) parents[0].addChild(node);
  else scene.addChild(node);

  await io.write(path, doc);
  console.log(`  B필러 분리: 삼각형 ${moved}개 → 노드 '${PILLAR_NODE}'`);
}
