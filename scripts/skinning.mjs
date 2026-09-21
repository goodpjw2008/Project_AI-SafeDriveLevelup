/**
 * **뼈대(스킨)가 걸린 모델의 정점 좌표를 구한다.**
 *
 * ── 왜 필요한가
 *
 * SL63 은 메시 178개 중 **173개에 스킨이 걸려 있다.** 스킨 메시의 정점은 파일에 *바인드
 * 공간* 좌표로 들어 있고, 실제 자리는 조인트(뼈)의 월드행렬과 역바인드행렬이 정한다.
 * 노드 행렬만 곱하면 부품들이 원점 둘레에 겹쳐 쌓인 엉뚱한 좌표가 나온다 —
 * SL63 을 그렇게 읽었더니 차 크기가 2.06 x 1.99 x 5.07 (실제는 2.07 x 1.30 x 4.81),
 * 앞유리로 잡힌 것은 폭 140mm 짜리 판때기였고, 룸미러 옆에 있어야 할 부품이 780mm 밖에
 * 있는 것으로 나왔다. 좌표가 전부 틀리니 부품을 특정할 수도, 크기로 거를 수도 없다.
 *
 * ── 규칙
 *
 * glTF 스킨 정점의 자리는 `Σ wᵢ · (조인트ᵢ 월드행렬 × 역바인드행렬ᵢ) · v` 다.
 * 스킨이 걸린 메시는 **노드 자신의 행렬을 쓰지 않는다** (사양이 그렇게 정한다).
 *
 * 스킨이 없는 모델(나머지 차 전부)에서는 예전과 똑같이 노드 월드행렬만 곱한다.
 */

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** 열 우선 4x4 행렬 곱 (glTF 규약) */
export const mulM = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};

/** 점에 행렬 적용 */
export const mulP = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/**
 * 장면을 훑어 **메시를 든 노드**를 모은다.
 *
 * 각 항목의 `vertexAt(prim)` 은 정점 번호를 받아 실제 좌표를 돌려주는 함수다 —
 * 스킨이 있으면 뼈대를 따라 옮기고, 없으면 노드 월드행렬만 곱한다.
 * 같은 정점을 여러 삼각형이 나눠 쓰므로 결과를 캐시한다.
 */
export function collectMeshes(scene) {
  const worldOf = new Map();
  const walkWorld = (node, world) => {
    const m = mulM(world, node.getMatrix());
    worldOf.set(node, m);
    node.listChildren().forEach((c) => walkWorld(c, m));
  };
  scene.listChildren().forEach((n) => walkWorld(n, I4));

  /* 조인트별 (월드행렬 × 역바인드행렬) — 스킨마다 한 번만 만든다 */
  const skinCache = new Map();
  const skinMatrices = (skin) => {
    if (skinCache.has(skin)) return skinCache.get(skin);
    const ibm = skin.getInverseBindMatrices();
    const out = skin
      .listJoints()
      .map((joint, i) => mulM(worldOf.get(joint) ?? I4, ibm ? ibm.getElement(i, new Array(16).fill(0)) : I4));
    skinCache.set(skin, out);
    return out;
  };

  const out = [];
  const walkMesh = (node) => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = worldOf.get(node) ?? I4;
      out.push({
        node,
        mesh,
        world,
        vertexAt(prim) {
          const pos = prim.getAttribute('POSITION');
          const skin = node.getSkin();
          const joints = prim.getAttribute('JOINTS_0');
          const weights = prim.getAttribute('WEIGHTS_0');
          const cache = new Map();
          if (!skin || !joints || !weights) return (vi) => mulP(world, pos.getElement(vi, [0, 0, 0]));
          const mats = skinMatrices(skin);
          return (vi) => {
            const hit = cache.get(vi);
            if (hit) return hit;
            const v = pos.getElement(vi, [0, 0, 0]);
            const j = joints.getElement(vi, [0, 0, 0, 0]);
            const w = weights.getElement(vi, [0, 0, 0, 0]);
            const p = [0, 0, 0];
            let sum = 0;
            for (let k = 0; k < 4; k++) {
              const m = w[k] ? mats[j[k]] : null;
              if (!m) continue;
              const q = mulP(m, v);
              for (let i = 0; i < 3; i++) p[i] += q[i] * w[k];
              sum += w[k];
            }
            // 가중치 합이 1 이 아닌 모델이 있다 (양자화 오차) — 나눠서 맞춘다
            const r = sum > 0 ? p.map((c) => c / sum) : mulP(world, v);
            cache.set(vi, r);
            return r;
          };
        },
      });
    }
    node.listChildren().forEach(walkMesh);
  };
  scene.listChildren().forEach(walkMesh);
  return out;
}
