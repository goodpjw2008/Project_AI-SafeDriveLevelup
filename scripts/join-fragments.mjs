/**
 * **조각난 부품을 합친다** — 원본 모델(내 차가 쓰는 것)의 드로우콜을 줄인다.
 *
 *   public/models/<차 id>.glb  →  (같은 자리에 덮어쓴다)
 *
 * SF90 모델은 부품이 **1251개**였다 — 바퀴가 799조각, 브레이크 캘리퍼가 430조각으로 쪼개져 있었다(다른 차는 19~48개).
 * 조각 하나가 그리기 명령 하나라, SF90 을 타면 차 한 대에 매 프레임 1250번을 그렸다. 사용자가 "일반 PC 에서는 설정을
 * 다 꺼도 느리다" 고 했고, 화질 설정으로는 줄일 수 없는 비용이었다.
 *
 * 조각들은 **저마다 다른 부모 노드** 밑에 있어(glTF 의 join 은 형제끼리만 합친다) 그대로는 하나도 합쳐지지 않았다.
 * 그래서 조각 노드만 월드 위치를 그대로 둔 채 장면 바로 밑으로 옮긴 뒤(clearNodeParent) 합친다.
 *
 * **한 재질이 20조각 넘게 쪼개진 것만** 합친다. 내 차 모델은 carModel.ts 가 부품 이름으로 핸들 · 거울 · 유리 · 바퀴를
 * 찾으므로(labelOf) 부품을 통째로 합칠 수 없다. 옮기고 합치는 것은 **그 재질만 쓰는 조각 노드**뿐이고, 합친 뒤에도
 * 재질 이름('…Wheel1A…')이 남아 바퀴로 지면 높이를 재는 처리(partBox)가 그대로 돈다. 나머지 부품은 부모 · 이름을 그대로
 * 둔다(모델 전체를 flatten 하지 않는다 — 부모 이름으로 유리를 가르는 모델이 있다).
 *
 * 여러 번 돌려도 된다 — 이미 합쳐진 모델은 바뀌지 않는다. optimize-models.mjs 가 굽고 난 뒤에 부른다.
 *
 *   node scripts/join-fragments.mjs          # 전부
 *   node scripts/join-fragments.mjs sf90     # 하나만
 */

import { readdirSync, statSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { clearNodeParent, join, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const DIR = 'public/models';
/** 한 재질이 이보다 많은 조각으로 쪼개져 있으면 합친다 */
const FRAGMENTS = 20;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const only = process.argv.slice(2);
const ids = readdirSync(DIR)
  .filter((n) => n.endsWith('.glb') && !n.endsWith('.lod.glb'))
  .map((n) => n.replace(/\.glb$/, ''))
  .filter((id) => only.length === 0 || only.includes(id));

const drawCalls = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);

for (const id of ids) {
  const path = joinPath(DIR, `${id}.glb`);
  const doc = await io.read(path);
  const before = drawCalls(doc);

  const count = new Map();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat) count.set(mat, (count.get(mat) ?? 0) + 1);
    }
  }
  const fragmented = new Set([...count].filter(([, n]) => n > FRAGMENTS).map(([m]) => m));
  if (fragmented.size === 0) {
    console.log(`· ${id}: 조각난 재질 없음 (그리기 ${before})`);
    continue;
  }
  // 그 재질만 쓰는 조각 노드 — 핸들 · 거울 · 유리 같은 부품은 이름과 자리를 그대로 둔다
  const isFragment = (node) => {
    const prims = node.getMesh()?.listPrimitives() ?? [];
    return prims.length > 0 && prims.every((p) => fragmented.has(p.getMaterial()));
  };
  for (const node of doc.getRoot().listNodes()) {
    if (isFragment(node) && node.getParentNode()) clearNodeParent(node);
  }
  await doc.transform(
    join({
      filter: isFragment,
    }),
    meshopt({ encoder: MeshoptEncoder }),
  );
  await io.write(path, doc);
  console.log(`· ${id}: 그리기 ${before} → ${drawCalls(doc)} · ${Math.round(statSync(path).size / 1024)}KB`);
}
