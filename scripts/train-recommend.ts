/**
 * **다음 판 추천 신경망 학습 — 가상 운전자와 교사로.**
 *
 *   npm run train:recommend                                     # 기본: 세 차례 × 가상 운전자 600명 (씨앗 고정)
 *   npx vite-node scripts/train-recommend.ts --learners 60 --eval 40   # 빨리 (검증용)
 *
 * 1. **가상 운전자**(scripts/recommendSim.ts — 개념마다 진짜 실력 · 배우는 빠르기 · 잊는 빠르기가 다르다)에게 게임과 같은
 *    계획 · 후보 · 레벨 규칙으로 판을 골라 주며 과정을 밟게 한다. 첫 차례는 지금의 프로그램(가끔 무작위)으로 고른다.
 * 2. 고를 차례마다 절반쯤은 **교사**에게 묻는다 — 후보마다 "이 판을 골랐다면" 하고 복제한 운전자로 64번 달려 보고(같은
 *    운으로), 하루 뒤에도 남아 있을 진짜 실력 · 레벨 · 새로 겪은 상황이 얼마나 나아졌는지의 평균을 점수로 준다.
 * 3. 신경망(은닉 32, tanh · 출력 점수 하나)이 **브라우저가 아는 것만으로**(src/ai/recommendNet.ts 의 특징) 교사의 점수 순서를
 *    흉내 내도록 배운다 — 후보끼리 소프트맥스를 씌운 분포를 교사 점수의 소프트맥스에 맞춘다 (리스트 단위 교차 엔트로피).
 * 4. **둘째 차례부터**는 방금 배운 신경망이 직접 고르며 과정을 밟고(신경망이 실제로 만나는 상황), 교사가 다시 점수를 붙여
 *    앞 차례들과 합쳐 다시 배운다 (DAgger — 흉내 내는 쪽이 스스로 만든 상황에서 틀리는 것을 막는다).
 * 5. **처음 보는 운전자**로 무작위 · 지금의 프로그램 · 신경망을 견준다 — 같은 사람(같은 씨앗)을 셋이 따로 가르쳐 본다.
 *    학습에 쓴 종류의 운전자와, 더 느리게 익히고 더 빨리 잊는 **처음 보는 종류**의 운전자 둘 다.
 *
 * 병렬: 일을 나눠 같은 명령을 `--worker` 로 여럿 띄운다 (`--jobs`, 기본 코어 수 − 2).
 * 결과(src/ai/models/recommend.json)는 저장소에 커밋한다 — 브라우저는 학습하지 않고 가중치만 읽는다.
 * **특징을 바꾸면 다시 학습해야 한다** — tests/recommendNet.test.ts 가 이름이 어긋나면 잡는다.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REC_FEATURES, scoreCourses, type RecommendModel } from '../src/ai/recommendNet';
import { rulePick } from '../src/scenarios/recommend';
import {
  SHIFTED_KIND,
  TRAIN_KIND,
  decide,
  featureRows,
  installSim,
  knownCount,
  makeEpisode,
  play,
  rng,
  seedGame,
  teacherScores,
} from './recommendSim';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const sarg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
/** 한 차례에 과정을 밟는 가상 운전자 수 */
const LEARNERS = arg('learners', 600);
/** 한 사람이 밟는 판 수의 상한 */
const MAX_RUNS = arg('runs', 70);
/** 교사에게 묻는 비율 — 이웃한 차례는 비슷해서 다 물을 까닭이 적다 */
const LABEL_P = arg('label', 0.5);
const ROLLOUTS = arg('rollouts', 64);
const HORIZON = arg('horizon', 0);
/** 프로그램 · 신경망이 고를 때 이만큼은 무작위로 — 교사가 다양한 상황을 보게 */
const EXPLORE = arg('explore', 0.2);
const ROUNDS = arg('rounds', 3);
const EVAL = arg('eval', 400);
const EVAL_RUNS = arg('evalRuns', 60);
const EPOCHS = arg('epochs', 30);
const HIDDEN = arg('hidden', 32);
/** 교사 점수를 분포로 바꿀 때의 온도 — 점수 0.1 차이가 e 배쯤 */
const TAU = arg('tau', 0.1);
const JOBS = arg('jobs', Math.max(1, cpus().length - 2));
const here = dirname(fileURLToPath(import.meta.url));
const OUT = sarg('save') ?? resolve(here, '../src/ai/models/recommend.json');
const WORK = sarg('work') ?? resolve(here, '../.train-recommend');

const t0 = performance.now();
const secs = () => `${((performance.now() - t0) / 1000).toFixed(0)}초`;
const round4 = (v: number) => +v.toFixed(4);

// ── 일꾼 ─────────────────────────────────────────────────────────────────

interface Labeled {
  learner: number;
  level: number;
  rows: number[][];
  q: number[];
}

type Policy = 'random' | 'program' | 'net';

function choose(policy: Policy, d: NonNullable<ReturnType<typeof decide>>, model: RecommendModel | null, r: () => number): number {
  if (policy === 'random') return Math.floor(r() * d.courses.length);
  if (policy === 'net' && model) {
    const s = scoreCourses(featureRows(d), model);
    let best = 0;
    for (let i = 1; i < s.length; i++) if (s[i] > s[best]) best = i;
    return best;
  }
  const pick = rulePick(d.plan, d.courses, Math.random, d.seen, d.cover);
  return d.courses.indexOf(pick);
}

/** 과정을 밟으며 교사의 점수를 모은다 */
function collect(worker: number, round: number, model: RecommendModel | null): Labeled[] {
  const out: Labeled[] = [];
  for (let i = worker; i < LEARNERS; i += JOBS) {
    const seed = round * 100_000 + i;
    const ep = makeEpisode(seed, TRAIN_KIND);
    const r = rng(seed * 31 + 7);
    seedGame(seed);
    for (let run = 0; run < MAX_RUNS; run++) {
      const d = decide(ep);
      if (!d || !d.courses.length) break;
      if (d.courses.length > 1 && r() < LABEL_P) {
        const rows = featureRows(d);
        const q = teacherScores(ep, d.courses, seed * 1000 + run, { rollouts: ROLLOUTS, horizon: HORIZON });
        out.push({ learner: seed, level: d.plan.level, rows: rows.map((x) => x.map(round4)), q: q.map(round4) });
        seedGame(seed * 1000 + run + 1); // 교사가 쓴 난수 뒤에서 과정의 난수를 다시 세운다
      }
      const policy: Policy = r() < EXPLORE ? 'random' : model ? 'net' : 'program';
      play(ep, d.courses[choose(policy, d, model, r)]);
    }
  }
  return out;
}

interface EvalRow {
  kind: 'train' | 'shifted';
  seed: number;
  policy: Policy;
  /** 판 수마다 (EVAL_RUNS/2, EVAL_RUNS) */
  known: number[];
  level: number[];
  mastered: boolean;
  runs: number;
  violations: number;
  frustration: number;
  situations: number;
  known0: number;
}

function evaluate(worker: number, model: RecommendModel): EvalRow[] {
  const out: EvalRow[] = [];
  for (const kind of ['train', 'shifted'] as const) {
    for (let i = worker; i < EVAL; i += JOBS) {
      const seed = (kind === 'train' ? 1_000_000 : 2_000_000) + i;
      for (const policy of ['random', 'program', 'net'] as Policy[]) {
        const ep = makeEpisode(seed, kind === 'train' ? TRAIN_KIND : SHIFTED_KIND);
        const r = rng(seed * 17 + 3);
        seedGame(seed);
        const known0 = knownCount(ep.learner);
        const known: number[] = [];
        const level: number[] = [];
        for (let run = 0; run < EVAL_RUNS; run++) {
          const d = decide(ep);
          if (d && d.courses.length) play(ep, d.courses[choose(policy, d, model, r)]);
          if (run === EVAL_RUNS / 2 - 1 || run === EVAL_RUNS - 1) {
            known.push(knownCount(ep.learner));
            level.push(ep.save.curriculum.level + (ep.save.curriculum.mastered ? 1 : 0));
          }
        }
        out.push({
          kind,
          seed,
          policy,
          known,
          level,
          mastered: ep.save.curriculum.mastered,
          runs: ep.runs,
          violations: ep.violations,
          frustration: ep.frustration,
          situations: ep.seenKeys.size,
          known0,
        });
      }
    }
  }
  return out;
}

if (args.includes('--worker')) {
  installSim();
  const worker = arg('worker', 0);
  const phase = sarg('phase');
  const modelPath = sarg('model');
  const model = modelPath ? (JSON.parse(readFileSync(modelPath, 'utf8')) as RecommendModel) : null;
  const data = phase === 'eval' ? evaluate(worker, model!) : collect(worker, arg('round', 0), model);
  writeFileSync(sarg('out')!, JSON.stringify(data));
  process.exit(0);
}

// ── 지휘 ─────────────────────────────────────────────────────────────────

/**
 * 같은 명령을 `--worker k` 로 여럿 띄워 나눠 돌리고 결과를 모은다. vite-node 로 돌 때도 그대로 된다 —
 * `process.argv` 를 통째로(실행기 · 스크립트 · 인자) 다시 쓰기 때문이다.
 */
async function fanOut<T>(phase: 'collect' | 'eval', extra: string[]): Promise<T[]> {
  mkdirSync(WORK, { recursive: true });
  const tag = extra.join('_').replace(/[^\w]/g, '');
  const files = Array.from({ length: JOBS }, (_, k) => resolve(WORK, `${phase}-${tag}-${k}.json`));
  await Promise.all(
    files.map(
      (file, k) =>
        new Promise<void>((done, fail) => {
          const child = spawn(
            process.execPath,
            [...process.execArgv, ...process.argv.slice(1), '--jobs', String(JOBS), '--worker', String(k), '--phase', phase, '--out', file, ...extra],
            { stdio: ['ignore', 'ignore', 'inherit'] },
          );
          child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`일꾼 ${k} 실패 (${code})`))));
        }),
    ),
  );
  return files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as T[]);
}

interface Split {
  train: Labeled[];
  val: Labeled[];
}
const splitByLearner = (data: Labeled[]): Split => {
  // 열에 하나는 검증용 — 사람 단위로 나눈다 (같은 사람의 이웃한 차례가 양쪽에 섞이지 않게)
  const val = (l: Labeled) => l.learner % 10 === 3;
  return { train: data.filter((l) => !val(l)), val: data.filter(val) };
};

function softmax(xs: readonly number[], tau = 1): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp((x - m) / tau));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

function train(data: Labeled[]): RecommendModel {
  const d = REC_FEATURES.length;
  const all = data.flatMap((l) => l.rows);
  const mean = Array(d).fill(0);
  const std = Array(d).fill(0);
  for (const x of all) for (let j = 0; j < d; j++) mean[j] += x[j] / all.length;
  for (const x of all) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / all.length;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  const Z = data.map((l) => l.rows.map((x) => x.map((v, j) => (v - mean[j]) / std[j])));
  const T = data.map((l) => softmax(l.q, TAU));

  const rand = rng(11);
  const W1 = Array.from({ length: HIDDEN }, () => Array.from({ length: d }, () => (rand() * 2 - 1) * Math.sqrt(3 / d)));
  const b1 = Array(HIDDEN).fill(0);
  const w2 = Array.from({ length: HIDDEN }, () => (rand() * 2 - 1) * Math.sqrt(3 / HIDDEN));
  let b2 = 0;
  const L2 = 1e-5;
  const idx = Z.map((_, i) => i);
  console.log(`\n신경망 (은닉 ${HIDDEN} · 점수 하나) — 고를 차례 ${Z.length} · 후보 ${all.length}`);
  for (let ep = 0; ep < EPOCHS; ep++) {
    const lr = 0.02 - (0.017 * ep) / Math.max(1, EPOCHS - 1);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    let loss = 0;
    for (const i of idx) {
      const xs = Z[i];
      const hs = xs.map((x) =>
        W1.map((row, q) => {
          let s = b1[q];
          for (let j = 0; j < d; j++) s += row[j] * x[j];
          return Math.tanh(s);
        }),
      );
      const scores = hs.map((h) => h.reduce((s, v, q) => s + w2[q] * v, b2));
      const p = softmax(scores);
      for (let k = 0; k < p.length; k++) loss -= T[i][k] * Math.log(Math.max(1e-12, p[k]));
      // 소프트맥스 교차 엔트로피의 기울기 — 후보마다 (p − t)
      for (let k = 0; k < xs.length; k++) {
        const g = p[k] - T[i][k];
        if (Math.abs(g) < 1e-6) continue;
        const h = hs[k];
        for (let q = 0; q < HIDDEN; q++) {
          const gh = g * w2[q] * (1 - h[q] * h[q]);
          w2[q] -= lr * (g * h[q] + L2 * w2[q]);
          const row = W1[q];
          const x = xs[k];
          for (let j = 0; j < d; j++) row[j] -= lr * (gh * x[j] + L2 * row[j]);
          b1[q] -= lr * gh;
        }
        b2 -= lr * g;
      }
    }
    if (ep % 5 === 0 || ep === EPOCHS - 1) console.log(`  ${ep} · 손실 ${(loss / Z.length).toFixed(4)} · ${secs()}`);
  }
  return {
    kind: 'recommend-mlp',
    names: [...REC_FEATURES],
    mean: mean.map(round4),
    std: std.map(round4),
    W1: W1.map((r) => r.map(round4)),
    b1: b1.map(round4),
    w2: w2.map(round4),
    b2: round4(b2),
    meta: { trained: true },
  };
}

/** 검증 차례에서 — 교사 1등과 같은 판을 고른 비율, 교사 점수로 잰 손해(1등 점수 − 고른 판 점수) */
function offline(val: Labeled[], model: RecommendModel) {
  const programAt = REC_FEATURES.indexOf('program');
  let agreeNet = 0;
  let agreeProgram = 0;
  let regretNet = 0;
  let regretProgram = 0;
  let regretRandom = 0;
  for (const l of val) {
    const best = Math.max(...l.q);
    const s = scoreCourses(l.rows, model);
    const net = s.indexOf(Math.max(...s));
    const prog = l.rows.map((x) => x[programAt]);
    const pg = prog.indexOf(Math.max(...prog));
    // 같은 점수의 후보가 여럿이면 어느 것이든 1등이다
    agreeNet += l.q[net] >= best - 1e-9 ? 1 : 0;
    agreeProgram += l.q[pg] >= best - 1e-9 ? 1 : 0;
    regretNet += best - l.q[net];
    regretProgram += best - l.q[pg];
    regretRandom += best - l.q.reduce((a, b) => a + b, 0) / l.q.length;
  }
  const n = val.length || 1;
  return {
    decisions: val.length,
    agreeNet: agreeNet / n,
    agreeProgram: agreeProgram / n,
    regretNet: regretNet / n,
    regretProgram: regretProgram / n,
    regretRandom: regretRandom / n,
  };
}

/** 같은 사람을 신경망과 프로그램이 따로 가르쳤을 때의 차 — 평균과 표준오차 (짝지은 비교) */
function paired(rows: EvalRow[], kind: 'train' | 'shifted', f: (r: EvalRow) => number) {
  const by = new Map<number, Partial<Record<Policy, EvalRow>>>();
  for (const r of rows.filter((x) => x.kind === kind)) by.set(r.seed, { ...(by.get(r.seed) ?? {}), [r.policy]: r });
  const d = [...by.values()].filter((p) => p.net && p.program).map((p) => f(p.net!) - f(p.program!));
  const m = d.reduce((a, b) => a + b, 0) / (d.length || 1);
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, d.length - 1));
  return { mean: round4(m), se: round4(sd / Math.sqrt(d.length || 1)) };
}

function summarize(rows: EvalRow[]) {
  const out: Record<string, Record<string, Record<string, number> | { mean: number; se: number }>> = {};
  for (const kind of ['train', 'shifted'] as const) {
    out[kind] = {};
    for (const policy of ['random', 'program', 'net'] as Policy[]) {
      const rs = rows.filter((r) => r.kind === kind && r.policy === policy);
      const avg = (f: (r: EvalRow) => number) => rs.reduce((s, r) => s + f(r), 0) / (rs.length || 1);
      out[kind][policy] = {
        learners: rs.length,
        gainHalf: round4(avg((r) => r.known[0] - r.known0)),
        gain: round4(avg((r) => r.known[1] - r.known0)),
        knownEnd: round4(avg((r) => r.known[1])),
        levelHalf: round4(avg((r) => r.level[0])),
        level: round4(avg((r) => r.level[1])),
        mastered: round4(avg((r) => (r.mastered ? 1 : 0))),
        violationsPerRun: round4(avg((r) => r.violations / Math.max(1, r.runs))),
        frustration: round4(avg((r) => r.frustration)),
        situations: round4(avg((r) => r.situations)),
      };
    }
    out[kind].netMinusProgramGain = paired(rows, kind, (r) => r.known[1] - r.known0);
    out[kind].netMinusProgramLevel = paired(rows, kind, (r) => r.level[1]);
  }
  return out;
}

async function main() {
  const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
  let data: Labeled[] = [];
  let model: RecommendModel | null = null;
  const modelFile = resolve(WORK, 'model.json');
  const rounds: unknown[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    console.log(`\n${round + 1}차 — 가상 운전자 ${LEARNERS}명이 ${model ? '신경망' : '지금의 프로그램'}으로 과정을 밟고 교사가 점수를 붙인다 (일꾼 ${JOBS})`);
    const got = await fanOut<Labeled>('collect', ['--round', String(round), ...(model ? ['--model', modelFile] : [])]);
    console.log(`  고를 차례 ${got.length} · ${secs()}`);
    data = data.concat(got);
    const { train: tr, val } = splitByLearner(data);
    model = train(tr);
    writeFileSync(modelFile, JSON.stringify(model));
    const off = offline(val, model);
    rounds.push({ round: round + 1, total: data.length, ...off });
    console.log(
      `  검증 ${off.decisions}차례 — 교사 1등과 같은 판: 신경망 ${pct(off.agreeNet)} · 프로그램 ${pct(off.agreeProgram)}` +
        ` | 교사 점수로 잰 손해: 신경망 ${off.regretNet.toFixed(3)} · 프로그램 ${off.regretProgram.toFixed(3)} · 무작위 ${off.regretRandom.toFixed(3)}`,
    );
  }

  console.log(`\n견주기 — 처음 보는 운전자 ${EVAL}명 × 두 종류를 무작위 · 프로그램 · 신경망이 ${EVAL_RUNS}판씩 가르친다`);
  const rows = await fanOut<EvalRow>('eval', ['--model', modelFile]);
  const table = summarize(rows);
  for (const kind of ['train', 'shifted'] as const) {
    console.log(`\n  ${kind === 'train' ? '학습에 쓴 종류' : '처음 보는 종류 (더 느리게 익히고 더 빨리 잊는다)'}`);
    for (const policy of ['random', 'program', 'net'] as Policy[]) {
      const t = table[kind][policy] as Record<string, number>;
      console.log(
        `  ${({ random: '무작위', program: '프로그램', net: '신경망' } as const)[policy].padEnd(5)}` +
          ` 익힌 개념 +${t.gainHalf.toFixed(2)}(${EVAL_RUNS / 2}판) +${t.gain.toFixed(2)}(${EVAL_RUNS}판)` +
          ` · 레벨 ${t.levelHalf.toFixed(2)} → ${t.level.toFixed(2)} · 마스터 ${pct(t.mastered)}` +
          ` · 판당 위반 ${t.violationsPerRun.toFixed(2)} · 연속 셋 넘게 틀림 ${t.frustration.toFixed(1)}판 · 겪은 상황 ${t.situations.toFixed(0)}`,
      );
    }
    const g = table[kind].netMinusProgramGain as { mean: number; se: number };
    const l = table[kind].netMinusProgramLevel as { mean: number; se: number };
    console.log(`  같은 사람끼리 신경망 − 프로그램: 익힌 개념 ${g.mean >= 0 ? '+' : ''}${g.mean.toFixed(2)} ± ${g.se.toFixed(2)} · 레벨 ${l.mean >= 0 ? '+' : ''}${l.mean.toFixed(2)} ± ${l.se.toFixed(2)}`);
  }

  model!.meta = {
    trained: true,
    date: new Date().toISOString().slice(0, 10),
    learners: LEARNERS * ROUNDS,
    decisions: data.length,
    candidates: data.reduce((s, l) => s + l.rows.length, 0),
    teacher: { rollouts: ROLLOUTS, horizon: HORIZON, tau: TAU },
    rounds,
    eval: { learners: EVAL, runs: EVAL_RUNS, ...table },
  };
  writeFileSync(OUT, JSON.stringify(model, null, 1));
  console.log(`\n저장: ${OUT} · ${secs()}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
