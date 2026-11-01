/**
 * **주행 정책 신경망 학습** (src/ai/drivePolicy.ts) — AI 자율주행의 핸들 · 관문 앞 제동 · 앞차 뒤 제동.
 *
 *   npm run train:drive
 *
 * 시뮬레이터를 돌리지 않는다 — 셋 다 입력이 몇 개뿐이라 **나올 수 있는 값을 고르게 지어** 예전 공식의 답을 붙인다.
 *
 * 1. **핸들** — AI 자율주행이 따라가는 길(game/AutoDriver.ts 의 drivePath, 우회전 · 직진) 위의 아무 점을 골라, 그 둘레에 차를
 *    놓는다(옆으로 ±1.5m · 방향 ±20° · 속도 0~12m/s · 축간거리 2.0~3.2m). 길 위 내 자리는 게임처럼 가장 가까운 점이다. 정답은
 *    순수 추종 공식(steerRule). 은닉 48 · 출력 tanh, 제곱 오차. 따로 떼어 둔 10만 자리에서 차이를 잰다.
 * 2. **관문 앞 제동** · **앞차 뒤 제동** — 거리(간격) · 속도 · 제동력을 고르게, 그리고 공식의 경계 둘레를 더 촘촘히 짓는다.
 *    정답은 공식보다 **0.8m 이르게** 밟는 쪽이다 — 신경망의 경계가 조금 흔들려도 공식보다 늦게 밟지 않게(0.5m 로는 370만 곳 중
 *    8곳이 늦었다). 은닉 24 · 시그모이드.
 *    끝나면 촘촘한 격자 전부에서 ① 공식이 밟는 자리에서는 반드시 밟고 ② 공식보다 1.5m 넘게 일찍 밟지 않는지 확인하고, 하나라도
 *    어긋나면 더 배운다 (넷째 자리 반올림한 가중치로 확인한다 — 저장되는 그대로).
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GATE_FEATURES,
  GATE_RANGE,
  LEAD_FEATURES,
  LEAD_RANGE,
  STEER_FEATURES,
  gateBrakeRule,
  gateInput,
  leadBrakeRule,
  leadInput,
  netRaw,
  steerFeatures,
  steerRule,
  type DriveModel,
  type Point,
  type SmallNet,
} from '../src/ai/drivePolicy';
import { drivePath } from '../src/game/AutoDriver';

const args = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const OUT = args.includes('--save') ? args[args.indexOf('--save') + 1] : resolve(here, '../src/ai/models/drive.json');
const t0 = performance.now();
const secs = () => `${((performance.now() - t0) / 1000).toFixed(0)}초`;
const r4 = (v: number) => +v.toFixed(4);

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
const rand = rng(20261101);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── 작은 신경망과 Adam ───────────────────────────────────────────────────────

interface Net {
  W1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
}
function makeNet(d: number, hidden: number): Net {
  return {
    W1: Array.from({ length: hidden }, () => Array.from({ length: d }, () => gauss() * Math.sqrt(1 / d))),
    b1: Array.from({ length: hidden }, () => gauss() * 0.5),
    w2: Array.from({ length: hidden }, () => gauss() * Math.sqrt(1 / hidden)),
    b2: 0,
  };
}
const asSmall = (names: readonly string[], n: Net, round = true): SmallNet => {
  const f = round ? r4 : (v: number) => v;
  return { names: [...names], W1: n.W1.map((r) => r.map(f)), b1: n.b1.map(f), w2: n.w2.map(f), b2: f(n.b2) };
};

/**
 * 묶음 하나씩 Adam. `kind` 가 'tanh' 면 출력에 tanh 를 씌워 제곱 오차, 'logit' 이면 시그모이드 교차 엔트로피.
 * 입력 X 와 정답 Y 는 같은 차례의 배열이다.
 */
function fit(net: Net, X: number[][], Y: number[], kind: 'tanh' | 'logit', epochs: number, lr0: number, label: string): void {
  const H = net.W1.length;
  const d = X[0].length;
  const params: number[][] = [...net.W1, net.b1, net.w2];
  const m = params.map((p) => p.map(() => 0));
  const v = params.map((p) => p.map(() => 0));
  let mb2 = 0;
  let vb2 = 0;
  let t = 0;
  const B = 256;
  const idx = X.map((_, i) => i);
  for (let ep = 0; ep < epochs; ep++) {
    const lr = lr0 * (1 - (0.9 * ep) / Math.max(1, epochs - 1));
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    let loss = 0;
    for (let s = 0; s < idx.length; s += B) {
      const gW1 = net.W1.map((r) => r.map(() => 0));
      const gb1 = Array(H).fill(0);
      const gw2 = Array(H).fill(0);
      let gb2 = 0;
      const end = Math.min(idx.length, s + B);
      for (let k = s; k < end; k++) {
        const x = X[idx[k]];
        const h = net.W1.map((row, q) => {
          let z = net.b1[q];
          for (let j = 0; j < d; j++) z += row[j] * x[j];
          return Math.tanh(z);
        });
        let o = net.b2;
        for (let q = 0; q < H; q++) o += net.w2[q] * h[q];
        let go: number;
        if (kind === 'tanh') {
          const y = Math.tanh(o);
          const e = y - Y[idx[k]];
          loss += e * e;
          go = 2 * e * (1 - y * y);
        } else {
          const p = 1 / (1 + Math.exp(-o));
          const y = Y[idx[k]];
          loss -= y ? Math.log(Math.max(1e-12, p)) : Math.log(Math.max(1e-12, 1 - p));
          go = p - y;
        }
        gb2 += go;
        for (let q = 0; q < H; q++) {
          gw2[q] += go * h[q];
          const gh = go * net.w2[q] * (1 - h[q] * h[q]);
          gb1[q] += gh;
          const row = gW1[q];
          for (let j = 0; j < d; j++) row[j] += gh * x[j];
        }
      }
      const n = end - s;
      const grads = [...gW1, gb1, gw2];
      t += 1;
      const c1 = 1 - 0.9 ** t;
      const c2 = 1 - 0.999 ** t;
      params.forEach((p, a) =>
        p.forEach((_, c) => {
          const g = grads[a][c] / n;
          m[a][c] = 0.9 * m[a][c] + 0.1 * g;
          v[a][c] = 0.999 * v[a][c] + 0.001 * g * g;
          p[c] -= (lr * (m[a][c] / c1)) / (Math.sqrt(v[a][c] / c2) + 1e-8);
        }),
      );
      const g = gb2 / n;
      mb2 = 0.9 * mb2 + 0.1 * g;
      vb2 = 0.999 * vb2 + 0.001 * g * g;
      net.b2 -= (lr * (mb2 / c1)) / (Math.sqrt(vb2 / c2) + 1e-8);
    }
    if (ep % 5 === 0 || ep === epochs - 1) console.log(`  ${label} ${ep} · 손실 ${(loss / X.length).toFixed(6)} · ${secs()}`);
  }
}

// ── 1. 핸들 ────────────────────────────────────────────────────────────────

/** 길 둘레의 차 하나 — 특징과 공식의 답 */
function steerSample(): { x: number[]; y: number } {
  const path = drivePath(rand() < 0.7 ? 'rightTurn' : 'straight');
  const i = Math.floor(rand() * (path.length - 16));
  const a = path[i];
  const b = path[Math.min(path.length - 1, i + 1)];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const tx = (b.x - a.x) / len;
  const tz = (b.z - a.z) / len;
  // 오른쪽 법선 — 차가 길에서 옆으로 벗어난 자리
  const off = clamp(gauss() * 0.5, -1.5, 1.5);
  const along = rand() * len;
  const car = {
    x: a.x + tx * along - tz * off,
    z: a.z + tz * along + tx * off,
    yaw: Math.atan2(-tx, -tz) + (clamp(gauss() * 6, -20, 20) * Math.PI) / 180,
  };
  // 길 위 내 자리 — 게임처럼 앞쪽에서 가장 가까운 점
  let best = i;
  let bestD = Infinity;
  for (let k = Math.max(0, i - 10); k < Math.min(path.length, i + 60); k++) {
    const dd = Math.hypot(path[k].x - car.x, path[k].z - car.z);
    if (dd < bestD) {
      bestD = dd;
      best = k;
    }
  }
  const ahead: Point[] = path.slice(best, best + 60);
  const speed = rand() * 12;
  const wb = 2 + rand() * 1.2;
  return { x: steerFeatures(ahead, car, speed, wb), y: steerRule(ahead, car, speed, wb) };
}

function trainSteer(): { net: SmallNet; eval: Record<string, number> } {
  console.log('1. 핸들 — 길 둘레 차 자리 40만 개, 순수 추종 공식을 따라');
  const train = Array.from({ length: 400_000 }, steerSample);
  const val = Array.from({ length: 100_000 }, steerSample);
  const net = makeNet(STEER_FEATURES.length, 48);
  fit(net, train.map((s) => s.x), train.map((s) => s.y), 'tanh', 60, 0.003, '핸들');
  const small = asSmall(STEER_FEATURES, net);
  const errs = val.map((s) => Math.abs(Math.tanh(netRaw(small, s.x)) - s.y)).sort((p, q) => p - q);
  const ev = {
    mean: r4(errs.reduce((p, q) => p + q, 0) / errs.length),
    p99: r4(errs[Math.floor(errs.length * 0.99)]),
    max: r4(errs[errs.length - 1]),
  };
  console.log(`  검증 10만 — 공식과의 차이(핸들 −1~1): 평균 ${ev.mean} · 99% ${ev.p99} · 최대 ${ev.max}`);
  return { net: small, eval: ev };
}

// ── 2. 제동 ────────────────────────────────────────────────────────────────

/** 공식이 밟기 시작하는 경계 — 관문 앞은 거리, 앞차 뒤는 간격 */
const gateEdge = (speedKmh: number, decel: number) => {
  const v = speedKmh / 3.6;
  return Math.max(3, (v * v) / (2 * decel) + 1.8);
};
const leadEdge = (closingKmh: number) => {
  const v = closingKmh / 3.6;
  return 2.5 + (v * v) / (2 * 4.8);
};
/** 공식보다 이만큼 이르게 밟도록 배운다 · 확인할 때는 이만큼 넘게 이르면 틀린 것으로 본다 */
const EARLY = 0.8;
const TOO_EARLY = 1.5;

/** 격자 전부에서 확인 — 늦게 밟은 자리 · 너무 일찍 밟은 자리의 수 */
function checkGate(net: SmallNet) {
  let late = 0;
  let early = 0;
  let n = 0;
  for (let decel = GATE_RANGE.decel[0]; decel <= GATE_RANGE.decel[1] + 1e-9; decel += 0.1) {
    for (let sp = GATE_RANGE.speed[0]; sp <= GATE_RANGE.speed[1] + 1e-9; sp += 0.25) {
      const edge = gateEdge(sp, decel);
      for (let dist = GATE_RANGE.distance[0]; dist <= GATE_RANGE.distance[1] + 1e-9; dist += 0.05) {
        const brake = netRaw(net, gateInput(dist, sp, decel)) > 0;
        if (gateBrakeRule(dist, sp, decel) && !brake) late += 1;
        if (dist > edge + TOO_EARLY && brake) early += 1;
        n += 1;
      }
    }
  }
  return { n, late, early };
}
function checkLead(net: SmallNet) {
  let late = 0;
  let early = 0;
  let n = 0;
  for (let cl = LEAD_RANGE.closing[0]; cl <= LEAD_RANGE.closing[1] + 1e-9; cl += 0.25) {
    const edge = leadEdge(cl);
    for (let gap = LEAD_RANGE.gap[0]; gap <= LEAD_RANGE.gap[1] + 1e-9; gap += 0.05) {
      const brake = netRaw(net, leadInput(gap, cl)) > 0;
      if (leadBrakeRule(gap, cl) && !brake) late += 1;
      if (gap >= edge + TOO_EARLY && brake) early += 1;
      n += 1;
    }
  }
  return { n, late, early };
}

function trainBrake(
  kind: 'gate' | 'lead',
): { net: SmallNet; eval: Record<string, number> } {
  console.log(`2. ${kind === 'gate' ? '관문 앞' : '앞차 뒤'} 제동 — 공식보다 ${EARLY}m 이르게`);
  const sample = (): { x: number[]; y: number } => {
    if (kind === 'gate') {
      const decel = GATE_RANGE.decel[0] + rand() * (GATE_RANGE.decel[1] - GATE_RANGE.decel[0]);
      const sp = rand() * GATE_RANGE.speed[1];
      const edge = gateEdge(sp, decel) + EARLY;
      // 절반은 고르게, 절반은 경계 둘레 ±3m
      const dist = rand() < 0.5 ? GATE_RANGE.distance[0] + rand() * 45 : edge + (rand() * 2 - 1) * 3;
      return { x: gateInput(dist, sp, decel), y: dist <= edge ? 1 : 0 };
    }
    const cl = rand() * LEAD_RANGE.closing[1];
    const edge = leadEdge(cl) + EARLY;
    const gap = rand() < 0.5 ? rand() * 40 : Math.max(0, edge + (rand() * 2 - 1) * 3);
    return { x: leadInput(gap, cl), y: gap < edge ? 1 : 0 };
  };
  const data = Array.from({ length: 300_000 }, sample);
  const net = makeNet(kind === 'gate' ? GATE_FEATURES.length : LEAD_FEATURES.length, 24);
  const names = kind === 'gate' ? GATE_FEATURES : LEAD_FEATURES;
  const check = kind === 'gate' ? checkGate : checkLead;
  let small = asSmall(names, net);
  let c = { n: 0, late: 1, early: 1 };
  for (let round = 0; round < 12; round++) {
    fit(net, data.map((s) => s.x), data.map((s) => s.y), 'logit', 15, round ? 0.002 : 0.01, `${kind} ${round}`);
    small = asSmall(names, net);
    c = check(small);
    console.log(`  격자 ${c.n.toLocaleString()}곳 — 공식보다 늦게 밟음 ${c.late} · ${TOO_EARLY}m 넘게 일찍 밟음 ${c.early}`);
    if (!c.late && !c.early) break;
  }
  if (c.late || c.early) throw new Error(`${kind} 제동이 격자 확인을 넘지 못했다 — 늦음 ${c.late} · 너무 이름 ${c.early}`);
  return { net: small, eval: { grid: c.n, late: 0, early: 0 } };
}

// ── 지휘 ─────────────────────────────────────────────────────────────────

const steer = trainSteer();
const gate = trainBrake('gate');
const lead = trainBrake('lead');
const model: DriveModel = {
  kind: 'drive-mlp',
  steer: steer.net,
  gate: gate.net,
  lead: lead.net,
  meta: {
    trained: true,
    date: new Date().toISOString().slice(0, 10),
    steer: steer.eval,
    gate: gate.eval,
    lead: lead.eval,
    early: EARLY,
    tooEarly: TOO_EARLY,
  },
};
writeFileSync(OUT, JSON.stringify(model));
console.log(`저장: ${OUT} · ${secs()}`);
