/**
 * **보행자 횡단 의도 예측 학습 — 시뮬레이터가 기록한 속과 미래로.**
 *
 *   npm run train:intent                                   # 기본: 판 3,000 × 운전자 둘, 6분 남짓 (재현된다 — 씨앗 고정)
 *   npx vite-node scripts/train-intent.ts --scenarios 600  # 빨리 (검증용)
 *
 * 1. 라이브러리의 판을 시뮬레이터(src/scenarios/playSim.ts)로 달린다 — 규정대로 모는 사람과 1초 늦게 보는 사람 둘이.
 *    운전자에 따라 보행자가 나서는 때가 달라져(차가 서 주면 건너고, 설 수 없는 차 앞에서는 뜻을 거둔다) 장면이 넓어진다.
 *    달리는 동안 **게임과 같은 LiDAR 인지**(센서 · 군집화 · 신경망 분류 · 추적)를 1초에 열 바퀴 돌린다.
 * 2. 바퀴마다, LiDAR 가 찾은 사람마다 **AI 가 보는 것**(ai/intent.ts 의 특징 열다섯 — 추적이 잰 자리로 셈한 선 자리 ·
 *    움직임과 보행신호 · 내 차)과 **정답**을 적는다. 추적은 몸끼리 2m 안의 실제 보행자와 짝을 지어 그 사람의 정답을 받고,
 *    짝이 없으면(헛것) '아무도 아님' 이다. 센서가 재는 자리의 흔들림 · 늦음까지 그대로 배운다. 정답은 둘이다.
 *    - `yield` 그 순간 양보할 사람이었는가 — 판정이 보는 보행자의 속 (`intendsToCross && onConflictPath`)
 *    - `enter` 그 뒤 2초 안에 실제로 차도에 들어섰는가 — 시뮬레이터가 기록한 미래
 * 3. 작은 신경망(은닉 32, tanh · 출력 둘 시그모이드)을 확률적 경사하강으로 맞춘다 — 의존이 없다.
 * 4. **처음 보는 판**(다른 판)으로 손 규칙과 견준다.
 *    - `yield` ↔ "연석에 붙어 서 있으면 건너려는 사람" (자리만 보는 규칙)
 *    - `enter` ↔ "지금 빠르기 그대로 2초 가면 차도" (등속 예측 — 예전 LiDAR 화면의 위협 예측)
 *    그리고 **얼마나 일찍 알아채는가** — 뜻이 생긴 뒤 몇 초 만에 양보로 바뀌는가, 차도에 발을 딛기 몇 초 전에 경보하는가.
 * 5. 양보 문턱은 **놓치는 쪽이 비싸므로** 낮게 잡는다 — 보도 위 '건너려는 사람' 을 99% 넘게 잡는 가장 높은 값.
 *    LiDAR 가 잰 자리는 흔들리므로 오경보가 조금 늘지만(멈출 까닭이 없는데 서는 것), 22,818판을 그 문턱으로 달려 시간이
 *    늘지 않음을 확인했다.
 *
 * 결과(src/ai/models/intent.json)는 저장소에 커밋한다 — 브라우저는 학습하지 않고 가중치만 읽는다.
 * **특징을 바꾸면 다시 학습해야 한다** — tests/intent.test.ts 가 이름이 어긋나면 잡는다. 문턱 · 모델을 바꾸면
 * 라이브러리 전수 검증(tests/library.validate.*)을 다시 돌린다 — AI 자율주행이 이 판단으로 22,818판을 달린다.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTENT_FEATURES, INTENT_OUTPUTS, IntentEstimator, intentProbs, type IntentModel } from '../src/ai/intent';
import { rng } from '../src/ai/lidarScenes';
import { AUTO_DRIVE_RULE, challengeRule } from '../src/scenarios/challenge';
import { scenarioLibrary } from '../src/scenarios/library';
import { playScenario, type PlayOptions } from '../src/scenarios/playSim';
import { CURB } from '../src/game/pedWalk';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const SCENARIOS = arg('scenarios', 3000);
// 40 에폭은 학습 손실은 더 내려가도 처음 보는 판에서 나빠졌다(보도 위 양보 98.2% → 97.4%) — 24 에서 멈춘다
const EPOCHS = arg('epochs', 24);
const HIDDEN = arg('hidden', 32);
/** 정답이 바뀌는 때의 앞뒤 이만큼(초)은 다 남긴다 — 알아채는 빠르기를 배우는 곳이다. 나머지는 KEEP 만큼만 */
const EDGE_WINDOW = 1.5;
const KEEP = 0.18;
/** 보도 위 '건너려는 사람' 을 이만큼 넘게 잡는 가장 높은 문턱 */
const TARGET_RECALL = arg('recall', 0.99);
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/ai/models/intent.json');

const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)}초`;
const d = INTENT_FEATURES.length;

// ── 1 · 2. 판을 달려 표본을 모은다 — LiDAR 인지가 찾은 사람마다 ──
interface Rows {
  x: number[][];
  yYield: number[];
  yEnter: number[];
  /** 정답이 바뀌는 순간까지 남은 시간 같은 것을 재는 데 쓰는 덧붙임 */
  info: Array<{ run: number; ped: number; t: number; edge: number; vin: number }>;
}
const empty = (): Rows => ({ x: [], yYield: [], yEnter: [], info: [] });
const train = empty();
const test = empty();
/** 시험 판의 추적마다의 시간표 — 알아채는 빠르기를 잰다 */
const testSeries: Array<{ t: number[]; x: number[][]; yield: boolean[]; onRoad: boolean[] }> = [];
/** 추적과 실제 보행자의 짝 — 몸끼리 이만큼(m) 안이면 같은 사람이다. 없으면 정답은 '아무도 아님' */
const MATCH = 2.0;
let tracked = 0;
let unmatched = 0;

const lib = scenarioLibrary();
const pick = rng(20261018);
const order = lib.map((_, i) => i);
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(pick() * (i + 1));
  [order[i], order[j]] = [order[j], order[i]];
}
const chosen = order.slice(0, SCENARIOS).filter((i) => lib[i].spec.pedestrians.length > 0);
const easy = AUTO_DRIVE_RULE;
const normal = challengeRule(3);
const drivers: Array<Omit<PlayOptions, 'onScan'>> = [
  // 판단은 정답으로 — 학습 데이터의 운전자는 사람의 속을 아는 '모범 답안' 이다. LiDAR 인지는 따로 돌려(`lidar`) 그 결과로 배운다
  { persona: 'careful', pace: easy.pace, stopZone: easy.stopZone, trace: false, pedIntent: 'truth', lidar: true },
  { persona: 'human', reaction: 1, pace: normal.pace, stopZone: normal.stopZone, trace: false, pedIntent: 'truth', lidar: true },
];

let run = 0;
for (const [k, li] of chosen.entries()) {
  const isTest = k % 5 === 0;
  for (const drv of drivers) {
    run += 1;
    const est = new IntentEstimator(null);
    /** 추적마다 — 바퀴의 시각 · 특징 · 짝지은 보행자 */
    const series = new Map<number, { t: number[]; x: number[][]; walker: Array<number | null> }>();
    /** 보행자마다 — 바퀴의 시각 · 정답 */
    const truth = new Map<number, { t: number[]; yield: boolean[]; onRoad: boolean[] }>();
    playScenario(lib[li].spec, {
      ...drv,
      onScan: (scan) => {
        for (const w of scan.walkers) {
          let s = truth.get(w.id);
          if (!s) truth.set(w.id, (s = { t: [], yield: [], onRoad: [] }));
          s.t.push(scan.t);
          s.yield.push(w.yield);
          s.onRoad.push(w.onRoad);
        }
        est.update(scan.t, scan.people, scan.ctx, true);
        for (const p of scan.people) {
          const x = est.lastFeatures(p.id);
          if (!x) continue;
          let best: number | null = null;
          let bestD = MATCH;
          for (const w of scan.walkers) {
            const d = Math.hypot(w.x - p.x, w.z - p.z);
            if (d < bestD) {
              bestD = d;
              best = w.id;
            }
          }
          let s = series.get(p.id);
          if (!s) series.set(p.id, (s = { t: [], x: [], walker: [] }));
          s.t.push(scan.t);
          s.x.push([...x]);
          s.walker.push(best);
        }
      },
    });
    /** 그 보행자의 그 바퀴 정답 — 없으면(짝 없음) 아무도 아니다 */
    const labelAt = (w: number | null, t: number) => {
      const s = w === null ? undefined : truth.get(w);
      if (!s) return { yield: false, onRoad: false, enter: false };
      let i = s.t.findIndex((v) => Math.abs(v - t) < 1e-6);
      if (i < 0) i = s.t.length - 1;
      let enter = false;
      for (let j = i + 1; j < s.t.length && s.t[j] <= t + 2 + 1e-6; j++) if (s.onRoad[j]) enter = true;
      return { yield: s.yield[i], onRoad: s.onRoad[i], enter };
    };
    for (const [ped, s] of series) {
      const labels = s.t.map((t, i) => labelAt(s.walker[i], t));
      tracked += s.t.length;
      unmatched += s.walker.filter((w) => w === null).length;
      if (isTest) testSeries.push({ t: s.t, x: s.x, yield: labels.map((l) => l.yield), onRoad: labels.map((l) => l.onRoad) });
      const rows = isTest ? test : train;
      for (let i = 0; i < s.t.length; i++) {
        // 정답이 바뀌는 때의 앞뒤는 다 남기고, 나머지는 덜어 낸다 (시험은 다 남긴다)
        let near = false;
        for (let j = Math.max(1, i - 15); j < Math.min(s.t.length, i + 16) && !near; j++) {
          if (Math.abs(s.t[j] - s.t[i]) <= EDGE_WINDOW && labels[j].yield !== labels[j - 1].yield) near = true;
        }
        if (!isTest && !near && pick() > KEEP) continue;
        rows.x.push(s.x[i]);
        rows.yYield.push(labels[i].yield ? 1 : 0);
        rows.yEnter.push(labels[i].enter ? 1 : 0);
        rows.info.push({ run, ped, t: s.t[i], edge: s.x[i][0], vin: s.x[i][1] });
      }
    }
  }
  if ((k + 1) % 500 === 0) console.log(`  판 ${k + 1}/${chosen.length} · 표본 학습 ${train.x.length} · 시험 ${test.x.length} · ${secs()}`);
}
console.log(`  LiDAR 추적 ${tracked} 바퀴 중 실제 보행자와 짝이 없는 것 ${((100 * unmatched) / tracked).toFixed(2)}%`);
console.log(`표본: 학습 ${train.x.length} · 시험 ${test.x.length} (판 ${chosen.length} × 운전자 ${drivers.length}) · ${secs()}`);
const rate = (ys: number[]) => `${((100 * ys.reduce((a, b) => a + b, 0)) / ys.length).toFixed(1)}%`;
console.log(`  양성 비율(학습): 양보 ${rate(train.yYield)} · 2초 안 차도 ${rate(train.yEnter)}`);

// ── 3. 신경망 ──
const mean = Array(d).fill(0);
const std = Array(d).fill(0);
for (const r of train.x) r.forEach((v, k) => (mean[k] += v / train.x.length));
for (const r of train.x) r.forEach((v, k) => (std[k] += (v - mean[k]) ** 2 / train.x.length));
for (let k = 0; k < d; k++) std[k] = Math.sqrt(std[k]) || 1;
const Z = train.x.map((r) => r.map((v, k) => (v - mean[k]) / std[k]));
const Y = train.x.map((_, i) => [train.yYield[i], train.yEnter[i]]);
const K = INTENT_OUTPUTS.length;

const rand = rng(7);
const init = (rows: number, cols: number) =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rand() * 2 - 1) * Math.sqrt(3 / cols)));
const W1 = init(HIDDEN, d);
const b1 = Array(HIDDEN).fill(0);
const W2 = init(K, HIDDEN);
const b2 = Array(K).fill(0);
const L2 = 1e-5;
const idx = Z.map((_, i) => i);
console.log(`\n신경망 (은닉 ${HIDDEN} · 출력 둘)`);
for (let ep = 0; ep < EPOCHS; ep++) {
  const lr = 0.04 - (0.032 * ep) / Math.max(1, EPOCHS - 1);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  let loss = 0;
  for (const i of idx) {
    const x = Z[i];
    const h = W1.map((row, q) => {
      let s = b1[q];
      for (let j = 0; j < d; j++) s += row[j] * x[j];
      return Math.tanh(s);
    });
    const p = W2.map((row, k) => {
      let s = b2[k];
      for (let q = 0; q < HIDDEN; q++) s += row[q] * h[q];
      return 1 / (1 + Math.exp(-s));
    });
    const go = p.map((v, k) => v - Y[i][k]);
    for (let k = 0; k < K; k++) loss -= Y[i][k] ? Math.log(Math.max(1e-12, p[k])) : Math.log(Math.max(1e-12, 1 - p[k]));
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
  if (ep % 4 === 0 || ep === EPOCHS - 1) console.log(`  ${ep} · 손실 ${(loss / Z.length / K).toFixed(4)} · ${secs()}`);
}

const round = (v: number) => +v.toFixed(4);
const model: IntentModel = {
  kind: 'intent-mlp',
  names: [...INTENT_FEATURES],
  outputs: [...INTENT_OUTPUTS],
  mean: mean.map(round),
  std: std.map(round),
  W1: W1.map((r) => r.map(round)),
  b1: b1.map(round),
  W2: W2.map((r) => r.map(round)),
  b2: b2.map(round),
  threshold: 0.5,
  meta: { trained: true },
};

// ── 4 · 5. 시험 ──
const probs = test.x.map((x) => intentProbs(x, model));
// 차도 위는 규칙 안전장치가 맡는다 — 신경망이 답해야 하는 것은 보도 위 사람이다
const sidewalk = test.x.map((_, i) => test.info[i].edge >= 0);
const pos = probs.map((_, i) => i).filter((i) => sidewalk[i] && test.yYield[i] === 1);
const neg = probs.map((_, i) => i).filter((i) => sidewalk[i] && test.yYield[i] === 0);
const recallAt = (th: number) => pos.filter((i) => probs[i][0] >= th).length / pos.length;
const fprAt = (th: number) => neg.filter((i) => probs[i][0] >= th).length / neg.length;
let threshold = 0.5;
for (let th = 0.5; th >= 0.02; th -= 0.01) {
  threshold = +th.toFixed(2);
  if (recallAt(th) >= TARGET_RECALL) break;
}
model.threshold = threshold;
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;

// 손 규칙 — 연석에 붙어 서 있으면(물러선 거리의 절반 안) 건너려는 사람
const ruleYield = (i: number) => test.info[i].edge < 0.4;
const ruleAcc = (pos.filter(ruleYield).length + neg.filter((i) => !ruleYield(i)).length) / (pos.length + neg.length);
const nnAcc = (pos.filter((i) => probs[i][0] >= threshold).length + neg.filter((i) => probs[i][0] < threshold).length) / (pos.length + neg.length);
const nnAcc50 = (pos.filter((i) => probs[i][0] >= 0.5).length + neg.filter((i) => probs[i][0] < 0.5).length) / (pos.length + neg.length);
console.log(`\n  ${'양보할 사람 (보도 위)'.padEnd(22)} 표본 ${pos.length + neg.length} (건너려는 사람 ${pos.length})`);
console.log(`  손 규칙 (연석에 붙어 섰나)   정확도 ${pct(ruleAcc)} · 재현율 ${pct(pos.filter(ruleYield).length / pos.length)} · 오경보 ${pct(neg.filter(ruleYield).length / neg.length)}`);
console.log(`  신경망 (문턱 0.5)            정확도 ${pct(nnAcc50)} · 재현율 ${pct(recallAt(0.5))} · 오경보 ${pct(fprAt(0.5))}`);
console.log(`  신경망 (문턱 ${threshold})           정확도 ${pct(nnAcc)} · 재현율 ${pct(recallAt(threshold))} · 오경보 ${pct(fprAt(threshold))}`);

// 2초 안 차도 — 등속 예측과 견준다 (보도 위 사람만: 차도 위 사람은 이미 들어서 있다)
const eIdx = probs.map((_, i) => i).filter((i) => sidewalk[i]);
const cv = (i: number) => test.info[i].edge - Math.max(0, test.info[i].vin) * 2 < 0;
const eAcc = (f: (i: number) => boolean) => eIdx.filter((i) => f(i) === (test.yEnter[i] === 1)).length / eIdx.length;
const eRec = (f: (i: number) => boolean) => {
  const p = eIdx.filter((i) => test.yEnter[i] === 1);
  return p.filter(f).length / p.length;
};
const eFpr = (f: (i: number) => boolean) => {
  const n = eIdx.filter((i) => test.yEnter[i] === 0);
  return n.filter(f).length / n.length;
};
const nnEnter = (i: number) => probs[i][1] >= 0.5;
console.log(`\n  ${'2초 안에 차도에 들어서나'.padEnd(22)} 표본 ${eIdx.length} (들어선 사람 ${eIdx.filter((i) => test.yEnter[i] === 1).length})`);
console.log(`  등속 예측 (예전 위협 예측)   정확도 ${pct(eAcc(cv))} · 재현율 ${pct(eRec(cv))} · 오경보 ${pct(eFpr(cv))}`);
console.log(`  신경망                       정확도 ${pct(eAcc(nnEnter))} · 재현율 ${pct(eRec(nnEnter))} · 오경보 ${pct(eFpr(nnEnter))}`);

// 얼마나 일찍 — 뜻이 생긴 뒤 양보로 바뀌기까지, 차도에 들어서기 몇 초 전에 경보하는가
const lagYield: number[] = [];
const leadNN: number[] = [];
const leadCV: number[] = [];
const quant = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};
for (const s of testSeries) {
  const p = s.x.map((x) => intentProbs(x, model));
  for (let i = 1; i < s.t.length; i++) {
    if (s.yield[i] && !s.yield[i - 1] && s.x[i][0] >= 0) {
      let j = i;
      while (j < s.t.length && p[j][0] < threshold && s.x[j][0] >= 0) j++;
      if (j < s.t.length) lagYield.push(s.t[j] - s.t[i]);
    }
    if (s.onRoad[i] && !s.onRoad[i - 1]) {
      // 들어서기 전 2초 안에서 처음 경보한 때
      const from = s.t[i] - 2;
      let a: number | null = null;
      let b: number | null = null;
      for (let j = i - 1; j >= 0 && s.t[j] >= from - 1e-6; j--) {
        if (p[j][1] >= 0.5) a = s.t[i] - s.t[j];
        else if (a === null) break;
      }
      for (let j = i - 1; j >= 0 && s.t[j] >= from - 1e-6; j--) {
        const x = s.x[j];
        if (x[0] - Math.max(0, x[1]) * 2 < 0) b = s.t[i] - s.t[j];
        else if (b === null) break;
      }
      leadNN.push(a ?? 0);
      leadCV.push(b ?? 0);
    }
  }
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log(`\n  뜻이 생긴 뒤 양보로 바뀌기까지 — 중앙값 ${quant(lagYield, 0.5).toFixed(2)}초 · 95% ${quant(lagYield, 0.95).toFixed(2)}초 · 최대 ${quant(lagYield, 1).toFixed(2)}초 (${lagYield.length}번)`);
console.log(`  차도에 들어서기 전 경보 — 신경망 평균 ${avg(leadNN).toFixed(2)}초 · 등속 예측 평균 ${avg(leadCV).toFixed(2)}초 (${leadNN.length}번)`);

model.meta = {
  trained: true,
  samples: train.x.length,
  testSamples: test.x.length,
  scenarios: chosen.length,
  threshold,
  yield: {
    accuracy: round(nnAcc),
    accuracyAt50: round(nnAcc50),
    recallAt50: round(recallAt(0.5)),
    falseAlarmAt50: round(fprAt(0.5)),
    recall: round(recallAt(threshold)),
    falseAlarm: round(fprAt(threshold)),
    ruleAccuracy: round(ruleAcc),
    lagMedian: round(quant(lagYield, 0.5)),
    lag95: round(quant(lagYield, 0.95)),
  },
  enter: {
    accuracy: round(eAcc(nnEnter)),
    recall: round(eRec(nnEnter)),
    falseAlarm: round(eFpr(nnEnter)),
    cvAccuracy: round(eAcc(cv)),
    cvRecall: round(eRec(cv)),
    leadSeconds: round(avg(leadNN)),
    cvLeadSeconds: round(avg(leadCV)),
  },
  curb: CURB,
  date: new Date().toISOString().slice(0, 10),
};
writeFileSync(OUT, JSON.stringify(model, null, 1));
console.log(`\n저장: ${OUT} · 문턱 ${threshold} · ${secs()}`);
