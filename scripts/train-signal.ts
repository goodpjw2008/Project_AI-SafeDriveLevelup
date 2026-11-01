/**
 * **신호 · 정지선 판단 신경망 학습** (src/ai/signalPolicy.ts).
 *
 *   npm run train:signal
 *
 * 나올 수 있는 관문 3만 720가지(`signalDomain`) 전부에 법규의 답(`signalRule`)을 붙여 신경망(은닉 16, tanh · 출력 둘)이 따라
 * 배운다. 일부를 떼어 검증하지 않는 것은 **떼어 둘 나머지가 없어서**다 — 경우가 모두 학습 자료에 있고, 끝난 뒤 저장한(넷째
 * 자리에서 반올림한) 가중치로 전부를 다시 맞춰 본다. 하나라도 틀리거나 확률이 0.5 에서 `MARGIN` 만큼 떨어지지 않으면 저장하지
 * 않고 실패로 끝난다.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SIGNAL_FEATURES,
  signalDomain,
  signalFeatures,
  signalProbs,
  signalRule,
  type SignalModel,
} from '../src/ai/signalPolicy';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const HIDDEN = arg('hidden', 16);
const EPOCHS = arg('epochs', 3000);
/** 확률이 0.5 에서 이만큼은 떨어져야 한다 — 반올림 · 부동소수 차이로 답이 뒤집히지 않게 */
const MARGIN = 0.4;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = args.includes('--save') ? args[args.indexOf('--save') + 1] : resolve(here, '../src/ai/models/signal.json');

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const domain = signalDomain();
const X = domain.map(signalFeatures);
const Y = domain.map((q) => {
  const r = signalRule(q);
  return [r.wait ? 1 : 0, r.hold ? 1 : 0];
});
const d = SIGNAL_FEATURES.length;
const n = X.length;
console.log(`관문 ${n}가지 · 입력 ${d} · 은닉 ${HIDDEN} — 기다림 ${Y.filter((y) => y[0]).length} · 일시정지 ${Y.filter((y) => y[1]).length}`);

const rand = rng(7);
const W1 = Array.from({ length: HIDDEN }, () => Array.from({ length: d }, () => (rand() * 2 - 1) * Math.sqrt(3 / d)));
const b1 = Array(HIDDEN).fill(0);
const W2 = Array.from({ length: 2 }, () => Array.from({ length: HIDDEN }, () => (rand() * 2 - 1) * Math.sqrt(3 / HIDDEN)));
const b2 = [0, 0];

// Adam — 전체를 한 묶음으로 (3만 가지라 한 번에 돌려도 가볍다)
const params = [W1, [b1], W2, [b2]];
const m = params.map((p) => p.map((r) => r.map(() => 0)));
const v = params.map((p) => p.map((r) => r.map(() => 0)));
const LR = 0.01;
const [B1, B2, EPS] = [0.9, 0.999, 1e-8];

const r4 = (x: number) => +x.toFixed(4);
const snapshot = (round: boolean): SignalModel => {
  const f = round ? r4 : (x: number) => x;
  return {
    kind: 'signal-mlp',
    names: [...SIGNAL_FEATURES],
    outputs: ['wait', 'hold'],
    W1: W1.map((r) => r.map(f)),
    b1: b1.map(f),
    W2: W2.map((r) => r.map(f)),
    b2: b2.map(f),
    meta: { trained: true },
  };
};
/** 틀린 수와 가장 아슬아슬한 확률의 0.5 와의 거리 */
const check = (model: SignalModel) => {
  let wrong = 0;
  let margin = 0.5;
  for (let i = 0; i < n; i++) {
    const p = signalProbs(X[i], model);
    for (let k = 0; k < 2; k++) {
      if (p[k] > 0.5 !== (Y[i][k] === 1)) wrong += 1;
      margin = Math.min(margin, Math.abs(p[k] - 0.5));
    }
  }
  return { wrong, margin };
};

const t0 = performance.now();
let epoch = 0;
for (; epoch < EPOCHS; epoch++) {
  const gW1 = W1.map((r) => r.map(() => 0));
  const gb1 = b1.map(() => 0);
  const gW2 = W2.map((r) => r.map(() => 0));
  const gb2 = [0, 0];
  let loss = 0;
  for (let i = 0; i < n; i++) {
    const x = X[i];
    const h = W1.map((row, q) => {
      let s = b1[q];
      for (let j = 0; j < d; j++) s += row[j] * x[j];
      return Math.tanh(s);
    });
    const go: number[] = [0, 0];
    for (let k = 0; k < 2; k++) {
      let s = b2[k];
      for (let q = 0; q < HIDDEN; q++) s += W2[k][q] * h[q];
      const p = 1 / (1 + Math.exp(-s));
      loss -= Y[i][k] ? Math.log(Math.max(1e-12, p)) : Math.log(Math.max(1e-12, 1 - p));
      go[k] = (p - Y[i][k]) / n;
      for (let q = 0; q < HIDDEN; q++) gW2[k][q] += go[k] * h[q];
      gb2[k] += go[k];
    }
    for (let q = 0; q < HIDDEN; q++) {
      const gh = (go[0] * W2[0][q] + go[1] * W2[1][q]) * (1 - h[q] * h[q]);
      if (gh === 0) continue;
      for (let j = 0; j < d; j++) if (x[j]) gW1[q][j] += gh * x[j];
      gb1[q] += gh;
    }
  }
  const grads = [gW1, [gb1], gW2, [gb2]];
  const t = epoch + 1;
  params.forEach((p, a) =>
    p.forEach((row, r) =>
      row.forEach((_, c) => {
        const g = grads[a][r][c];
        m[a][r][c] = B1 * m[a][r][c] + (1 - B1) * g;
        v[a][r][c] = B2 * v[a][r][c] + (1 - B2) * g * g;
        row[c] -= (LR * (m[a][r][c] / (1 - B1 ** t))) / (Math.sqrt(v[a][r][c] / (1 - B2 ** t)) + EPS);
      }),
    ),
  );
  if (epoch % 100 === 0 || epoch === EPOCHS - 1) {
    const c = check(snapshot(true));
    console.log(`  ${epoch} · 손실 ${(loss / n).toFixed(5)} · 틀림 ${c.wrong} · 여유 ${c.margin.toFixed(3)} · ${((performance.now() - t0) / 1000).toFixed(0)}초`);
    if (c.wrong === 0 && c.margin >= MARGIN) break;
  }
}

const model = snapshot(true);
const final = check(model);
if (final.wrong > 0 || final.margin < MARGIN) {
  console.error(`실패 — 틀림 ${final.wrong} · 여유 ${final.margin.toFixed(3)} (여유 ${MARGIN} 이상이어야 저장한다)`);
  process.exit(1);
}
model.meta = {
  trained: true,
  date: new Date().toISOString().slice(0, 10),
  cases: n,
  hidden: HIDDEN,
  epochs: epoch + 1,
  wrong: 0,
  margin: +final.margin.toFixed(4),
};
writeFileSync(OUT, JSON.stringify(model, null, 1));
console.log(`저장: ${OUT} — ${n}가지 모두 법규와 같음 · 가장 아슬아슬한 확률도 0.5 에서 ${final.margin.toFixed(3)} 떨어짐`);
