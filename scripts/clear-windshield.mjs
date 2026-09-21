/**
 * **운전석에서 앞유리를 가리는 면을 한 번에 찾아 유리로 바꾼다.**
 *
 * ── 왜 이게 필요한가
 *
 * 지금까지는 화면에서 검은 부분을 하나씩 찍어 그 덩어리를 목록에 적는 방식이었다. 그런데
 * 모델에 따라 앞유리 주변에 겹친 부품이 아주 많다 — M5 는 네 번을 찍어 네 개(차체 셸,
 * 실내 셸, 셸의 위끝, 오버헤드 콘솔)가 나왔고 그러고도 남았다. 한 개씩 쫓아가는 방식으로는
 * 끝이 안 난다.
 *
 * 그래서 **운전석 눈에서 광선을 촘촘히 쏴서** 앞유리를 통과하는 방향인데 그 앞을 가로막는
 * 불투명 면을 전부 찾아 한 번에 처리한다. 화면에 보이는 것과 같은 기준이므로 빠뜨림이 없다.
 *
 * ── 눈 위치
 *
 * 게임과 **똑같이** 잡는다 (CarMesh.driverEyeLocal + carModel.eyeHeightOf).
 *   좌우 : 차 폭의 -23% (운전석은 좌측)
 *   앞뒤 : 지붕 앞끝 + 캐빈 길이의 12%
 *   높이 : 앞유리 카울에서 헤더까지의 65% 지점 (모델에서 잰다)
 * 값이 어긋나면 엉뚱한 곳을 훑게 되므로, 게임 안에서 찍은 좌표로 검증한 뒤 쓴다.
 *
 * ── 지우지 않고 유리로 바꾸는 이유
 *
 * 지우면 그 자리가 뚫려 하늘이 비친다(아반떼에서 겪었다). 유리로 바꾸면 밖에서 볼 때
 * 차 모양이 그대로고 운전석에서는 비쳐 보인다. 대시보드가 딸려 가지 않도록 **앞유리
 * 아래쪽 일정 높이 밑은 건드리지 않는다.**
 *
 * 실행: node scripts/clear-windshield.mjs [--dry] <차id>
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/**
 * 차종별 설정 — **눈 위치를 잡는 데 필요한 제원**(cars.ts 와 같은 값)과 보호 높이.
 *
 * `keepBelow` : 앞유리 높이의 이 지점 **아래는 건드리지 않는다.** 대시보드 윗면이
 *               앞유리 아래쪽과 같은 높이에 있어서, 이 보호가 없으면 계기판 앞이 뚫린다.
 */
export const AUTO_CLEAR = {
  /*
    **지금은 비어 있다.** M5 에 써 봤다가 차체를 깨뜨렸다.

    이 방식의 한계: 앞유리 유리면은 **유리테·헤드라이너 아래까지 뻗어 있다.** 그래서
    "유리를 가리는 면"에는 앞유리 **테두리 자체**가 들어간다. 그걸 투명하게 만들면
    지붕과 필러에 구멍이 뚫린다. 판정을 좁히면(유리 통과 필수) 검은 조각을 놓치고,
    넓히면(각도 범위) 차체를 갉아먹는다 — 그 사이에 안전한 지점이 없었다.

    남겨 두는 이유는 접근 자체가 틀렸다기보다 **'가린다'의 정의가 더 필요해서**다.
    다시 시도한다면 '유리 실루엣 안쪽으로 N mm 들어온 곳만' 처럼 테두리를 빼는 조건이
    있어야 한다. 그때까지는 remove-view-blockers.mjs 의 **눈으로 확인한 목록**을 쓴다.
  */
};

/** 유리로 바꾼 면에 붙이는 재질 이름·불투명도 (remove-view-blockers.mjs 와 같은 규칙) */
const GLASS_MATERIAL_NAME = 'windshield_glass_converted';
const GLASS_ALPHA = 0.02;

/**
 * 앞유리 **너머** 이만큼(m)까지의 불투명 면도 '가리는 것'으로 본다.
 *
 * 차체 외판·후드 립처럼 유리 바깥에 있는 것도 운전석에서는 그대로 시야를 막는다.
 * 처음에 0.2m 로 잡았더니 0.64m 지점의 차체 셸이 아슬아슬하게 빠져나갔다.
 *
 * 넓게 잡아도 되는 이유: 모델 파일에는 **차 자신**만 들어 있어서 도로·건물은 애초에
 * 걸리지 않고, 정상적으로 보여야 하는 보닛은 높이 조건(keepBelow)이 따로 지킨다.
 */
const BEHIND_GLASS_M = 1.5;

/** 광선 격자 (가로 x 세로) — 촘촘할수록 작은 조각까지 잡지만 느려진다 */
const RAYS = { w: 260, h: 150 };

/**
 * 눈을 계산값보다 이만큼(m) **뒤로** 물려 놓는다.
 *
 * 눈 앞뒤 위치는 게임이 제원(spec.dims)으로 계산하는데, 모델을 앉히는 과정(차체 박스 기준
 * 스케일)에서 조금씩 어긋난다. M5 에서 게임 안 카메라를 직접 찍어 보니 계산값보다 **95mm
 * 뒤**에 있었다. 눈이 앞에 있으면 시야가 좁아 위쪽 가장자리를 놓치므로, 넉넉히 뒤로 물려
 * 실제보다 **넓게** 훑는다. 넓게 훑어 손해 볼 것은 없다 — 어차피 앞유리를 통과하는
 * 방향만 보고, 대시보드는 높이로 따로 보호한다.
 */
const EYE_BACK_M = 0.15;

/** 앞유리 각도 범위를 이 비율만큼 넓혀 훑는다 (가장자리 조각을 놓치지 않도록) */
const ANGLE_MARGIN = 0.02;

const mulM = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const mul = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const boundsOf = (pts) => ({
  min: [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))),
  max: [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))),
});

/**
 * Möller–Trumbore.
 *
 * @param twoSided 뒷면도 맞힐지. **기준 앞유리에는 반드시 켜야 한다** — 운전석에서 보면
 *   앞유리는 뒷면이라, 앞면만 맞히면 광선이 하나도 안 걸려 판정이 통째로 비어 버린다.
 *   가리는 물체 쪽은 앞면만 본다 (three.js 기본 FrontSide 와 같게).
 */
function hit(o, d, [a, b, c], twoSided = false) {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const h = cross(d, e2);
  const det = dot(e1, h);
  if (twoSided ? Math.abs(det) < 1e-12 : det < 1e-12) return null;
  const f = 1 / det;
  const s = sub(o, a);
  const u = f * dot(s, h);
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1);
  const v = f * dot(d, q);
  if (v < 0 || u + v > 1) return null;
  const t = f * dot(e2, q);
  return t > 1e-9 ? t : null;
}

export async function clearWindshield(path, id, opts = {}) {
  const conf = AUTO_CLEAR[id];
  if (!conf) return;
  const dry = opts.dry ?? false;

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const doc = await io.read(path);
  if (doc.getRoot().getExtras()?.windshieldCleared) {
    console.log(`  · ${id}: 이미 앞유리를 정리한 모델입니다 — 건너뜁니다`);
    return;
  }
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const meshes = [];
  const walk = (node, world) => {
    const m = mulM(world, node.getMatrix());
    if (node.getMesh()) meshes.push({ mesh: node.getMesh(), world: m });
    node.listChildren().forEach((c) => walk(c, m));
  };
  scene.listChildren().forEach((n) => walk(n, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));

  // ── 모델 좌표계 파악 ──────────────────────────────────────────────────────
  const allPts = [];
  for (const { mesh, world } of meshes)
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i += 5) allPts.push(mul(world, pos.getElement(i, [0, 0, 0])));
    }
  const whole = boundsOf(allPts);
  const ext = [0, 1, 2].map((i) => whole.max[i] - whole.min[i]);
  const order = [0, 1, 2].sort((a, b) => ext[b] - ext[a]);
  const [AL, AW, AU] = order; // 길이 · 좌우 · 높이
  const unit = conf.dims.length / ext[AL]; // 모델 1 단위 = 몇 m
  const midL = (whole.min[AL] + whole.max[AL]) / 2;
  const midW = (whole.min[AW] + whole.max[AW]) / 2;

  const isGlass = (mesh, prim) =>
    /glass|window|glazing/i.test(`${mesh.getName()} ${prim.getMaterial()?.getName() ?? ''}`);

  const trisOf = (world, prim) => {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const count = idx ? idx.getCount() : pos.getCount();
    const at = (i) => mul(world, pos.getElement(idx ? idx.getScalar(i) : i, [0, 0, 0]));
    const out = [];
    for (let t = 0; t + 2 < count; t += 3) {
      const v = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
      const p = [at(t), at(t + 1), at(t + 2)];
      out.push({ v, p, i: t / 3, c: [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3) });
    }
    return out;
  };

  // ── 앞유리 찾기 (유리 중 가장 넓은 연결 덩어리) ───────────────────────────
  const weld = 200000 / ext[AL];
  const key = (p) => p.map((x) => Math.round(x * weld)).join(',');
  let windshield = null;
  for (const { mesh, world } of meshes)
    for (const prim of mesh.listPrimitives()) {
      if (!isGlass(mesh, prim)) continue;
      const tris = trisOf(world, prim);
      const byVert = new Map();
      tris.forEach((t, i) =>
        t.p.map(key).forEach((k) => {
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
          for (const k of tris[a].p.map(key))
            for (const b of byVert.get(k))
              if (!seen.has(b)) {
                seen.add(b);
                comp.push(b);
                queue.push(b);
              }
        }
        const b = boundsOf(comp.flatMap((j) => tris[j].p));
        const d = [0, 1, 2].map((k) => b.max[k] - b.min[k]).sort((x, y) => y - x);
        /*
          앞유리는 **차 앞쪽**의 가장 넓은 유리다 (뒷유리와 넓이가 비슷해 구분이 필요하다).
          전방은 모델 길이축 **+** 쪽이다 — 게임이 모델을 180° 돌려 쓰므로
          차량 로컬 -Z(전방) 가 모델 +AL 이 된다. 눈도 같은 규칙으로 놓았다.
        */
        const front = ((b.min[AL] + b.max[AL]) / 2 - midL) * unit;
        if (front < 0) continue; // 차 뒤쪽 유리는 제외
        if (!windshield || d[0] * d[1] > windshield.area)
          windshield = { area: d[0] * d[1], b, tris: comp.map((j) => tris[j]) };
      }
    }
  if (!windshield) throw new Error(`${id}: 앞유리를 찾지 못했습니다`);

  // ── 눈 위치 (게임과 같은 계산) ────────────────────────────────────────────
  const L = conf.dims.length;
  const cowlZ = -L / 2 + L * conf.dims.cabinFront;
  const roofFrontZ = cowlZ + L * 0.13;
  const roofRearZ = -L / 2 + L * conf.dims.cabinRear - L * 0.06;
  const eyeLocalZ = roofFrontZ + (roofRearZ - roofFrontZ) * 0.12;
  const eyeLocalX = -conf.dims.width * 0.23;
  const wsLo = windshield.b.min[AU];
  const wsHi = windshield.b.max[AU];
  const eyeUp = wsLo + (wsHi - wsLo) * 0.65;

  const eye = [];
  eye[AW] = midW - eyeLocalX / unit; // 차량 로컬 x = -(모델 좌우) 이므로 부호를 뒤집는다
  eye[AU] = eyeUp;
  eye[AL] = midL - (eyeLocalZ + EYE_BACK_M) / unit; // 차량 로컬 z = -(모델 길이), 뒤로 물린다
  const fwd = [0, 0, 0];
  fwd[AL] = 1; // 전방 = 모델 길이축 +
  const up = [0, 0, 0];
  up[AU] = 1;
  const right = cross(fwd, up); // 화면 오른쪽

  console.log(
    `    눈(모델 mm) ${[AW, AU, AL].map((i) => ((eye[i] - (i === AU ? whole.min[AU] : i === AW ? midW : midL)) * unit * 1000).toFixed(0)).join(', ')} · 앞유리 ${windshield.tris.length}장`,
  );

  // ── 삼각형을 모아 격자에 담는다 ───────────────────────────────────────────
  const all = [];
  for (const { mesh, world } of meshes)
    for (const prim of mesh.listPrimitives()) {
      const g = isGlass(mesh, prim);
      for (const t of trisOf(world, prim)) {
        // 눈에서 6m 밖은 차가 아니다
        if (Math.hypot(...sub(t.c, eye)) * unit > 6) continue;
        /*
          재질이 **양면(doubleSided)** 이면 뒷면도 화면에 그려진다. 그런 면은 광선도 양면으로
          맞혀야 한다 — 앞면만 보면 뒤를 보이는 조각을 통째로 놓친다.
          (M5 는 재질 25개가 **전부** 양면이라, 앞면만 보던 동안 화면의 검은 조각이 계속 남았다)
        */
        all.push({ ...t, g, ws: false, mark: false, ds: prim.getMaterial()?.getDoubleSided() ?? false, mesh, prim });
      }
    }

  // 기준 앞유리 삼각형을 표시해 둔다 (판정 기준이 흔들리지 않게 고정한다)
  {
    const wsKey = new Set(windshield.tris.map((t) => t.p.map(key).join('|')));
    for (const t of all) if (t.g && wsKey.has(t.p.map(key).join('|'))) t.ws = true;
  }

  // 앞유리를 담는 각도 범위를 구해 그 안에서만 광선을 쏜다
  const ang = (p) => {
    const d = sub(p, eye);
    const f = dot(d, fwd);
    return f <= 1e-9 ? null : [dot(d, right) / f, dot(d, up) / f];
  };
  const wsAng = windshield.tris.flatMap((t) => t.p.map(ang)).filter(Boolean);
  const aLo = [0, 1].map((i) => Math.min(...wsAng.map((a) => a[i])));
  const aHi = [0, 1].map((i) => Math.max(...wsAng.map((a) => a[i])));
  const aMin = [0, 1].map((i) => aLo[i] - (aHi[i] - aLo[i]) * ANGLE_MARGIN);
  const aMax = [0, 1].map((i) => aHi[i] + (aHi[i] - aLo[i]) * ANGLE_MARGIN);

  const GX = 60;
  const GY = 40;
  const grid = Array.from({ length: GX * GY }, () => []);
  const cellOf = (a) => [
    Math.floor(((a[0] - aMin[0]) / (aMax[0] - aMin[0])) * GX),
    Math.floor(((a[1] - aMin[1]) / (aMax[1] - aMin[1])) * GY),
  ];
  for (const t of all) {
    const as = t.p.map(ang);
    if (as.some((a) => a === null)) {
      for (let i = 0; i < GX * GY; i++) grid[i].push(t);
      continue;
    }
    const c0 = cellOf([Math.min(...as.map((a) => a[0])), Math.min(...as.map((a) => a[1]))]);
    const c1 = cellOf([Math.max(...as.map((a) => a[0])), Math.max(...as.map((a) => a[1]))]);
    for (let y = Math.max(0, c0[1]); y <= Math.min(GY - 1, c1[1]); y++)
      for (let x = Math.max(0, c0[0]); x <= Math.min(GX - 1, c1[0]); x++) grid[y * GX + x].push(t);
  }

  /*
    ── 광선을 쏴 가리는 면을 모은다 ──────────────────────────────────────────

    **한 번으로는 끝나지 않는다.** 앞의 겹을 유리로 바꾸면 그 뒤에 있던 겹이 드러난다
    (M5 실측: 1차 233개를 처리하고 다시 재니 112개가 새로 나왔다). 그래서 더 나오지
    않을 때까지 되풀이한다. 기준 앞유리는 **처음 것으로 고정**한다 — 우리가 만든 유리를
    기준으로 삼으면 판정 범위가 매번 달라져 수렴하지 않는다.
  */
  const keepBelowY = wsLo + (wsHi - wsLo) * conf.keepBelow;
  const blockers = new Map(); // prim → Set(면 번호)
  let total = 0;
  let rays = 0;
  let blocked = 0;

  for (let pass = 1; pass <= 8; pass++) {
    const found = new Map();
    rays = 0;
    blocked = 0;
    for (let iy = 0; iy < RAYS.h; iy++)
      for (let ix = 0; ix < RAYS.w; ix++) {
        const ax = aMin[0] + ((aMax[0] - aMin[0]) * (ix + 0.5)) / RAYS.w;
        const ay = aMin[1] + ((aMax[1] - aMin[1]) * (iy + 0.5)) / RAYS.h;
        const d = [0, 1, 2].map((i) => fwd[i] + right[i] * ax + up[i] * ay);
        const n = Math.hypot(...d);
        const dir = d.map((v) => v / n);
        const gx = Math.min(GX - 1, Math.max(0, Math.floor(((ax - aMin[0]) / (aMax[0] - aMin[0])) * GX)));
        const gy = Math.min(GY - 1, Math.max(0, Math.floor(((ay - aMin[1]) / (aMax[1] - aMin[1])) * GY)));
        const cand = grid[gy * GX + gx];

        // 기준 앞유리(원래 유리)까지의 거리 — 매 패스 같은 값이라 판정이 흔들리지 않는다
        let tGlass = Infinity;
        for (const t of cand) {
          if (!t.ws) continue;
          const r = hit(eye, dir, t.p, true);
          if (r !== null && r < tGlass) tGlass = r;
        }
        /*
          **실제 앞유리를 통과하는 방향만 검사한다.**

          각도 범위(앞유리의 직사각형 바운딩 박스)만으로 판정을 넓혔더니 그 모서리에
          **A필러·지붕·유리테**가 들어와 차체가 갉여 나갔다. 유리를 실제로 맞히는지
          보면 판정 범위가 유리 **모양** 그대로로 제한된다.
        */
        if (tGlass === Infinity) continue;
        rays++;
        const limit = tGlass + BEHIND_GLASS_M / unit;
        let any = false;
        for (const t of cand) {
          if (t.g) continue; // 이미 유리이거나 이번에 유리가 된 것
          if (t.c[AU] < keepBelowY) continue; // 대시보드 보호
          const r = hit(eye, dir, t.p, t.ds);
          if (r === null || r > limit) continue;
          if (!found.has(t.prim)) found.set(t.prim, new Set());
          found.get(t.prim).add(t.i);
          t.mark = true;
          any = true;
        }
        if (any) blocked++;
      }

    let n = 0;
    for (const [prim, set] of found) {
      n += set.size;
      if (!blockers.has(prim)) blockers.set(prim, new Set());
      for (const i of set) blockers.get(prim).add(i);
    }
    // 이번에 찾은 것은 다음 패스에서 '유리'로 취급한다
    for (const t of all) if (t.mark) t.g = true;
    total += n;
    console.log(
      `      ${pass}차: 광선 ${rays}개 중 가려진 것 ${blocked}개 (${((blocked / rays) * 100).toFixed(1)}%) → ${n}개 전환`,
    );
    if (n === 0) break;
  }

  const perMesh = new Map();
  for (const [prim, set] of blockers) {
    const owner = meshes.find(({ mesh }) => mesh.listPrimitives().includes(prim));
    const nm = owner.mesh.getName().slice(0, 40);
    perMesh.set(nm, (perMesh.get(nm) ?? 0) + set.size);
  }
  for (const [k, v] of [...perMesh].sort((a, b) => b[1] - a[1]))
    console.log(`      ${k.padEnd(42)} ${v}개 삼각형`);

  if (dry) {
    console.log(`  [미리보기] 유리로 바꿀 면 ${total}개 — 파일은 그대로 둡니다`);
    return;
  }
  if (total === 0) {
    console.log(`  · ${id}: 가리는 면이 없습니다`);
    return;
  }

  // ── 유리로 바꾼다 (remove-view-blockers.mjs 와 같은 방식) ─────────────────
  const buffer = doc.getRoot().listBuffers()[0];
  for (const [prim, set] of blockers) {
    const owner = meshes.find(({ mesh }) => mesh.listPrimitives().includes(prim));
    const tris = trisOf(owner.world, prim);
    const keep = [];
    const move = [];
    tris.forEach((t, i) => (set.has(i) ? move.push(...t.v) : keep.push(...t.v)));
    const Indices = prim.getAttribute('POSITION').getCount() < 65536 ? Uint16Array : Uint32Array;
    prim.setIndices(doc.createAccessor().setArray(new Indices(keep)).setBuffer(buffer));

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
      .setIndices(doc.createAccessor().setArray(new Indices(move)).setBuffer(buffer));
    for (const name of prim.listSemantics()) split.setAttribute(name, prim.getAttribute(name));
    owner.mesh.addPrimitive(split);
  }

  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder }));
  doc.getRoot().setExtras({ ...(doc.getRoot().getExtras() ?? {}), windshieldCleared: true });
  await io.write(path, doc);
  console.log(`  앞유리 정리: ${total}개 삼각형을 유리로`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const ids = args.filter((a) => !a.startsWith('--'));
  for (const id of ids.length > 0 ? ids : Object.keys(AUTO_CLEAR)) {
    console.log(`· ${id}${dry ? ' (미리보기)' : ''}`);
    await clearWindshield(`public/models/${id}.glb`, id, { dry });
  }
}
