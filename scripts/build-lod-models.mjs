/**
 * **배경 차용 가벼운 모델(LOD)** 을 굽는다.
 *
 *   public/models/<차 id>.glb  →  public/models/<차 id>.lod.glb
 *
 * ## 왜 필요한가
 *
 * 내 차는 운전석 시점에서 실내까지 보여야 하므로 모델을 그대로 쓴다. 그런데 **교차로를 스쳐 가는 배경 차와 앞차**에도
 * 같은 모델을 쓰고 있었다 — 모델 하나가 삼각형 7만~66만 개(SL63 66만 · 쏘렌토 45만 · K5 34만)라, 쏘렌토가 배경 차로
 * 세 대 뜬 판은 **한 프레임에 157만 개**를 그렸다(그림자를 켜면 그림자 패스에서 한 번 더). 사용자가 "고성능 PC 에서는
 * 쾌적한데 일반 PC 에서는 설정을 다 꺼도 느리다" 고 했는데, 화질 설정으로는 줄일 수 없는 비용이었다.
 *
 * ## 어떻게 줄이는가
 *
 *  1. **촬영용 배경 판(`Cube*`)을 먼저 지운다** — 게임도 버리는 부품이다(carModel.ts 의 DROP_PARTS). 아래 3번에서 다른
 *     부품과 합쳐지면 게임이 더는 골라 버릴 수 없다.
 *  2. weld(같은 자리 정점 합치기) → simplify(meshoptimizer — 메시 반지름의 1% 안에서 최대한). 오차가 **메시마다의
 *     반지름에 대한 비율**이라 차체처럼 큰 부품은 2cm 남짓까지 깎인다. 가까이서 보면 차체가 군데군데 찌그러져 보이므로
 *     **교차로를 지나가는 배경 차에만** 쓴다 — 바로 앞에 서는 앞차는 원본을 쓴다(TrafficCar). 단순화하면 모양이
 *     깨지는 차(K5)는 하지 않는다 (아래 NO_SIMPLIFY).
 *  3. **join — 같은 재질의 부품을 하나로 합친다.** 드로우콜이 준다(SL63 은 부품 174개 → 174콜이었다). 배경 차는 부품을
 *     따로 움직이지 않으므로 합쳐도 잃는 것이 없다. 유리는 유리 재질끼리만 합쳐져 carModel.ts 의 유리 처리가 그대로 돈다.
 *  4. **텍스처를 512² 로 줄인다** (원본은 1024²). 배경 차는 교차로를 스쳐 가는 거리에서만 보여 512 로도 구별되지
 *     않는데, 텍스처는 GPU 에서 가로×세로에 비례하므로 **한 대의 텍스처 메모리가 1/4** 이 된다 (코롤라 115MB → 29MB).
 *     캐시가 카탈로그를 다 담아도 휴대폰 GPU 가 버티게 하려는 것이다 — carModel.ts 의 캐시 상한과 한 짝이다.
 *  5. meshopt 압축 (원본과 같은 방식 — 풀기가 빠르다).
 *
 *   쏘렌토  정점 129만 → 6만 (1/21) · 4.2MB → 0.9MB
 *   SF90    그리기 1254 → 24 (부품이 1254개로 쪼개져 있었다)
 *
 * **meshoptimizer 1.0 이상이어야 한다** (package.json 의 devDependencies). `@types/three` 가 끌고 오는 0.18 로는 같은 설정에서
 * 40% 가까이 덜 줄었다(쏘렌토 9.7만).
 *
 * 게임은 이 파일이 없으면 원본으로 되돌아간다 (carModel.ts 의 readModel).
 *
 *   npm run assets:lod             # 전부
 *   npm run assets:lod -- sorento  # 하나만
 */

import { readdirSync, statSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const DIR = 'public/models';
/** 메시 반지름에 대한 오차 한계 — 0.005 는 덜 줄고(쏘렌토 9.8만), 0.02 는 더 줄지 않는다(6.4만) */
const ERROR = Number(process.env.LOD_ERROR ?? 0.01);
/**
 * **단순화하지 않는 차** — 부품 합치기만 한다(모습이 원본과 똑같다).
 *
 * 원본과 나란히 그려 보니 **K5 는 차체가 찌그러지고 뒷유리가 사라졌다.** 원본을 구울 때 이미 단순화가 바닥에 닿아 있던
 * 모델이라(optimize-models.mjs 의 K5 주석) 오차를 0.002 까지 낮춰도 같았고, 그러고도 40% 남짓밖에 안 줄었다. 다른 차는
 * 배경 차 거리에서 원본과 구별되지 않았다. 새 차를 넣으면 lodview 로 나란히 그려 보고 여기에 더한다.
 */
const NO_SIMPLIFY = new Set(['k5']);
/** 게임이 버리는 부품 (carModel.ts 의 DROP_PARTS 와 같다) */
const DROP_PARTS = /^Cube/i;
/** 배경 차 텍스처의 한 변 상한 (px) — 위 4번 */
const TEXTURE_MAX = Number(process.env.LOD_TEXTURE ?? 512);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const only = process.argv.slice(2);
const ids = readdirSync(DIR)
  .filter((n) => n.endsWith('.glb') && !n.endsWith('.lod.glb'))
  .map((n) => n.replace(/\.glb$/, ''))
  .filter((id) => only.length === 0 || only.includes(id));

/** 한 번 그릴 때 처리하는 정점 수 (삼각형 × 3) */
const renderVerts = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0), 0);
const drawCalls = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);

for (const id of ids) {
  const src = joinPath(DIR, `${id}.glb`);
  const dst = joinPath(DIR, `${id}.lod.glb`);
  const doc = await io.read(src);
  const before = { verts: renderVerts(doc), calls: drawCalls(doc) };

  for (const node of doc.getRoot().listNodes()) {
    if (DROP_PARTS.test(node.getName())) node.dispose();
  }
  // 값이 같은 재질 · 텍스처를 하나로 — 이름만 다른 재질이 부품마다 따로 있으면 아래 join 이 합치지 못한다
  await doc.transform(prune(), dedup());

  const simplified = !NO_SIMPLIFY.has(id);
  if (simplified) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: ERROR }));
  const out = doc;

  await out.transform(
    // 합치려면 부품들이 한 층에 있어야 한다 — 변환은 정점에 구워 넣는다
    flatten(),
    join(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_MAX, TEXTURE_MAX] }),
    meshopt({ encoder: MeshoptEncoder }),
  );
  await io.write(dst, out);

  const after = { verts: renderVerts(out), calls: drawCalls(out) };
  const kb = (p) => `${Math.round(statSync(p).size / 1024)}KB`;
  console.log(
    `· ${id}: 정점 ${before.verts.toLocaleString()} → ${after.verts.toLocaleString()} · ` +
      `그리기 ${before.calls} → ${after.calls} · ${kb(src)} → ${kb(dst)}` +
      (simplified ? '' : ' · 단순화 안 함 (모양이 깨진다 — NO_SIMPLIFY)'),
  );
}
console.log(`완료 — ${ids.length}대`);
