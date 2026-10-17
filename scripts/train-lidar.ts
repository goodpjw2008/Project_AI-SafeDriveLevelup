/**
 * **LiDAR 분류기 학습 — 시뮬레이터가 정답을 붙인 군집으로.**
 *
 *   npm run train:lidar                                   # 기본: 학습 장면 6,000 · 시험 장면 2,000, 2분 남짓
 *   npx vite-node scripts/train-lidar.ts --scenes 1500    # 빨리 (검증용)
 *
 * 1. 장면을 무작위로 지어 LiDAR 를 한 바퀴 쏘고, 인지와 똑같이 군집으로 나눈다. 군집마다 **가장 많이 맞은 몸의 갈래**가
 *    정답이다 (src/ai/lidarScenes.ts — 센서가 줄마다 어느 물체를 맞혔는지 안다).
 * 2. 군집의 특징 열여덟(src/ai/perception.ts 의 LIDAR_FEATURES)을 표준화하고 두 모델을 맞춘다 — 의존이 없다.
 *    - **다항 로지스틱 회귀(softmax)** — 전체 묶음 경사하강. 갈래마다 가중치 한 줄이라 무엇을 보는지 읽힌다.
 *    - **작은 신경망(MLP)** — 은닉 16 (tanh), 확률적 경사하강. 특징끼리의 조합을 배운다.
 * 3. **처음 보는 장면**(다른 씨앗)으로 손 규칙(ruleClass) · 로지스틱 · 신경망을 견준다 — 전체 · 갈래별 · 빗길 · 가림 · 먼 곳 ·
 *    붙어 잡힌 덩어리.
 *
 * 배포하는 것은 신경망이다 — 처음 견줬을 때(장면 1,500) 정확도 94.1% → 95.8%, 자전거 재현율 76% → 88% 로 로지스틱보다
 * 나았다. 자전거 조각(끌고 가는 사람이 가운데를 가린 자전거 · 정면에서 본 자전거)은 짧고 위층이 비어 어린이 몸과 닮았는데,
 * 그 '짧은데 위층이 빈' 조합을 선형 모델은 못 가른다.
 *
 * 결과(src/ai/models/lidar.json)는 저장소에 커밋한다 — 브라우저는 학습하지 않고 가중치만 읽는다.
 * **특징을 바꾸면 다시 학습해야 한다** — tests/lidarClassifier.test.ts 가 이름이 어긋나면 잡는다.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { labeledClusters, rng, type LabeledCluster, type TrueClass } from '../src/ai/lidarScenes';
import { CLASSES, LIDAR_FEATURES, classProbs, type LidarModel, type MlpModel, type SoftmaxModel } from '../src/ai/perception';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const SCENES = arg('scenes', 6000);
const TEST_SCENES = arg('test', Math.round(SCENES / 3));
const SOFTMAX_EPOCHS = arg('epochs', 1500);
const MLP_EPOCHS = arg('mlpEpochs', 60);
const HIDDEN = 16;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/ai/models/lidar.json');

const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)}초`;
const train = labeledClusters(SCENES, 20261017);
const test = labeledClusters(TEST_SCENES, 777);
console.log(`군집: 학습 ${train.length} · 시험 ${test.length} (장면 ${SCENES} · ${TEST_SCENES}) · ${secs()}`);
const share = (rows: LabeledCluster[]) =>
  CLASSES.map((c) => `${c} ${((100 * rows.filter((r) => r.label === c).length) / rows.length).toFixed(0)}%`).join(' · ');
console.log(`  정답 비율(학습): ${share(train)}`);

// ── 표준화 ──
const d = LIDAR_FEATURES.length;
const K = CLASSES.length;
const mean = Array(d).fill(0);
const std = Array(d).fill(0);
for (const r of train) r.x.forEach((v, k) => (mean[k] += v / train.length));
for (const r of train) r.x.forEach((v, k) => (std[k] += (v - mean[k]) ** 2 / train.length));
for (let k = 0; k < d; k++) std[k] = Math.sqrt(std[k]) || 1;
const Z = train.map((r) => r.x.map((v, k) => (v - mean[k]) / std[k]));
const y = train.map((r) => CLASSES.indexOf(r.label));
const base = { names: [...LIDAR_FEATURES], classes: [...CLASSES], mean, std, meta: { trained: true } };

const softmaxOf = (z: number[]): number[] => {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const sum = e.reduce((s, v) => s + v, 0);
  return e.map((v) => v / sum);
};

// ── 1. 다항 로지스틱 회귀 — 전체 묶음 경사하강 ──
console.log('\n로지스틱 회귀');
const W = Array.from({ length: K }, () => Array(d).fill(0));
const b = Array(K).fill(0);
for (let ep = 0; ep < SOFTMAX_EPOCHS; ep++) {
  const gW = Array.from({ length: K }, () => Array(d).fill(0));
  const gb = Array(K).fill(0);
  let loss = 0;
  for (let i = 0; i < Z.length; i++) {
    const p = softmaxOf(W.map((row, k) => row.reduce((s, w, j) => s + w * Z[i][j], b[k])));
    for (let k = 0; k < K; k++) {
      const g = p[k] - (y[i] === k ? 1 : 0);
      for (let j = 0; j < d; j++) gW[k][j] += g * Z[i][j];
      gb[k] += g;
    }
    loss -= Math.log(Math.max(1e-12, p[y[i]]));
  }
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < d; j++) W[k][j] -= 0.5 * (gW[k][j] / Z.length + 1e-4 * W[k][j]);
    b[k] -= 0.5 * (gb[k] / Z.length);
  }
  if (ep % 500 === 0 || ep === SOFTMAX_EPOCHS - 1) console.log(`  ${ep} · 손실 ${(loss / Z.length).toFixed(4)} · ${secs()}`);
}
const softmax: SoftmaxModel = { kind: 'softmax', ...base, W, b };

// ── 2. 작은 신경망 — 은닉 16 (tanh), 확률적 경사하강 ──
console.log('\n신경망');
const rand = rng(42);
const init = (rows: number, cols: number) =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rand() * 2 - 1) * Math.sqrt(3 / cols)));
const W1 = init(HIDDEN, d);
const b1 = Array(HIDDEN).fill(0);
const W2 = init(K, HIDDEN);
const b2 = Array(K).fill(0);
const L2 = 1e-5;
const order = Z.map((_, i) => i);
for (let ep = 0; ep < MLP_EPOCHS; ep++) {
  // 학습률은 0.05 에서 0.01 로 천천히 내린다
  const lr = 0.05 - (0.04 * ep) / Math.max(1, MLP_EPOCHS - 1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let loss = 0;
  for (const i of order) {
    const x = Z[i];
    const h = W1.map((row, q) => Math.tanh(row.reduce((s, w, j) => s + w * x[j], b1[q])));
    const p = softmaxOf(W2.map((row, k) => row.reduce((s, w, j) => s + w * h[j], b2[k])));
    loss -= Math.log(Math.max(1e-12, p[y[i]]));
    const go = p.map((v, k) => v - (y[i] === k ? 1 : 0));
    const gh = h.map((hv, q) => (1 - hv * hv) * go.reduce((s, g, k) => s + g * W2[k][q], 0));
    for (let k = 0; k < K; k++) {
      for (let q = 0; q < HIDDEN; q++) W2[k][q] -= lr * (go[k] * h[q] + L2 * W2[k][q]);
      b2[k] -= lr * go[k];
    }
    for (let q = 0; q < HIDDEN; q++) {
      for (let j = 0; j < d; j++) W1[q][j] -= lr * (gh[q] * x[j] + L2 * W1[q][j]);
      b1[q] -= lr * gh[q];
    }
  }
  if (ep % 10 === 0 || ep === MLP_EPOCHS - 1) console.log(`  ${ep} · 손실 ${(loss / Z.length).toFixed(4)} · ${secs()}`);
}
const mlp: MlpModel = { kind: 'mlp', ...base, W1, b1, W2, b2 };

// ── 3. 시험 — 처음 보는 장면으로 셋을 견준다 ──
const predictWith = (model: LidarModel) => (r: LabeledCluster): string => {
  const p = classProbs(r.x, model);
  return CLASSES[p.indexOf(Math.max(...p))];
};
const judges: Array<[string, (r: LabeledCluster) => string]> = [
  ['규칙', (r) => r.rule],
  ['로지스틱', predictWith(softmax)],
  ['신경망', predictWith(mlp)],
];
const acc = (rows: LabeledCluster[], pick: (r: LabeledCluster) => string): number =>
  rows.length ? rows.filter((r) => pick(r) === r.label).length / rows.length : NaN;
const pct = (v: number) => (Number.isFinite(v) ? `${(100 * v).toFixed(1)}%` : '-');
const round = (v: number) => +v.toFixed(4);

const slices: Array<[string, (r: LabeledCluster) => boolean]> = [
  ['전체', () => true],
  ['맑음', (r) => !r.rain],
  ['빗길', (r) => r.rain],
  ['차 뒤에 가림', (r) => r.occluded],
  ['가까움 (<20m)', (r) => r.range < 20],
  ['멂 (≥30m)', (r) => r.range >= 30],
  ['붙어 잡힘 (순도<0.9)', (r) => r.purity < 0.9],
];
console.log(`\n  ${'시험 조각'.padEnd(18)} ${'표본'.padStart(6)}   ${judges.map(([n]) => n.padStart(7)).join('  ')}`);
const bySlice: Record<string, Record<string, number>> = {};
for (const [name, f] of slices) {
  const rows = test.filter(f);
  bySlice[name] = { n: rows.length };
  const cells = judges.map(([jn, pick]) => {
    const a = acc(rows, pick);
    bySlice[name][jn] = round(a);
    return pct(a).padStart(7);
  });
  console.log(`  ${name.padEnd(18)} ${String(rows.length).padStart(6)}   ${cells.join('  ')}`);
}

const perClass: Record<string, Record<string, { recall: number; precision: number }>> = {};
console.log(`\n  ${'갈래'.padEnd(8)} 재현율 (${judges.map(([n]) => n).join(' → ')})        정밀도`);
for (const c of CLASSES) {
  perClass[c] = {};
  const parts = judges.map(([jn, pick]) => {
    const truth = test.filter((r) => r.label === c);
    const said = test.filter((r) => pick(r) === c);
    const recall = truth.filter((r) => pick(r) === c).length / truth.length;
    const precision = said.filter((r) => r.label === c).length / (said.length || 1);
    perClass[c][jn] = { recall: round(recall), precision: round(precision) };
    return { recall, precision };
  });
  console.log(
    `  ${c.padEnd(8)} ${parts.map((p) => pct(p.recall).padStart(6)).join(' → ')}   ${parts.map((p) => pct(p.precision).padStart(6)).join(' → ')}`,
  );
}

const mlpPick = predictWith(mlp);
const confusion = CLASSES.map((c) => CLASSES.map((p) => test.filter((r) => r.label === c && mlpPick(r) === p).length));
console.log('\n  신경망 혼동행렬 (행 정답 · 열 예측: ' + CLASSES.join(' ') + ')');
CLASSES.forEach((c, i) => console.log(`  ${c.padEnd(6)} ${confusion[i].map((v) => String(v).padStart(6)).join('')}`));

console.log('\n  로지스틱 — 갈래마다 가장 큰 가중치 (무엇을 보고 가르는가)');
CLASSES.forEach((c, k) => {
  const top = W[k]
    .map((w, j) => ({ n: LIDAR_FEATURES[j], w }))
    .sort((p, q) => Math.abs(q.w) - Math.abs(p.w))
    .slice(0, 4);
  console.log(`  ${c.padEnd(6)} ${top.map((t) => `${t.n} ${t.w >= 0 ? '+' : ''}${t.w.toFixed(2)}`).join(' · ')}`);
});

const label: Record<TrueClass, string> = { adult: '어른', child: '어린이', bike: '자전거', car: '차' };
writeFileSync(
  OUT,
  JSON.stringify(
    {
      kind: 'mlp',
      names: base.names,
      classes: base.classes,
      mean: mean.map(round),
      std: std.map(round),
      W1: W1.map((row) => row.map(round)),
      b1: b1.map(round),
      W2: W2.map((row) => row.map(round)),
      b2: b2.map(round),
      meta: {
        trained: true,
        samples: train.length,
        testSamples: test.length,
        accuracy: bySlice['전체']['신경망'],
        softmaxAccuracy: bySlice['전체']['로지스틱'],
        ruleAccuracy: bySlice['전체']['규칙'],
        slices: bySlice,
        perClass,
        confusion,
        classNames: CLASSES.map((c) => label[c]),
        date: new Date().toISOString().slice(0, 10),
      },
    },
    null,
    1,
  ),
);
console.log(`\n저장: ${OUT} · ${secs()}`);
