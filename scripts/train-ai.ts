/**
 * **AI 모델 학습 — 빌드 때 시뮬레이터로.**
 *
 *   npx vite-node scripts/train-ai.ts            # 기본: 라이브러리의 1/18 을 레벨마다 무작위로 (~760판) × 운전자 18 + 가상 학습자 12, 8분 남짓
 *   npx vite-node scripts/train-ai.ts --step 40  # 판을 덜 뽑아 빨리 (검증용)
 *
 * 시뮬레이터(src/scenarios/playSim.ts)의 **사람 운전자**를 반응 시간 × 브레이크 세기(난이도 설정)로 열두 가지 능력으로
 * 만들어 라이브러리 판을 달리게 한다. 판마다 주행 결과 데이터(src/ai/telemetry.ts)와 위반 여부가 나온다. 그것으로
 *
 *  1. **위험도 모델** (src/ai/models/risk.json) — 요약 숫자 → "위험했던 판" 확률. 이름표는 *위반이 났거나, 위반은 없었지만
 *     반응이 0.4초만 늦었어도 위반이었을 판* (같은 판을 한 단계 느린 운전자로 달린 결과가 그것을 말해 준다).
 *  2. **난이도 모델** (src/ai/models/difficulty.json) — 판의 특징 → 난이도 b (로짓). 운전자 능력 a 와 함께 맞춘다:
 *     logit P(통과) = a_운전자 − (w·x_판 + b0). 배포되는 것은 w · b0 뿐이다.
 *  3. **결과 예측 모델** (src/ai/models/outcome.json) — 판 × 학습자(개념별 숙달) → 어느 위반이 날까, 개념마다 로지스틱
 *     (다중 레이블). 숙달 벡터를 뽑은 가상 학습자가 개념을 모르는 채(playSim 의 blind) 달린 결과로 맞춘다.
 *
 * 둘 다 로지스틱 회귀이고 여기서 경사하강으로 맞춘다 — 의존이 없다. 결과 파일은 저장소에 커밋한다 (브라우저는 학습하지
 * 않고 읽기만 한다). 순수 함수만 부르므로 화면 없이 돈다.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { DIFFICULTY_FEATURES, scenarioFeatures } from '../src/ai/difficulty';
import { SKILL_ORDER } from '../src/ai/knowledge';
import { OUTCOME_FEATURES, outcomeFeatures } from '../src/ai/outcome';
import type { ViolationCode } from '../src/rules/violations';
import { featureVector } from '../src/ai/risk';
import type { RunFeatures } from '../src/ai/telemetry';
import { challengeRule } from '../src/scenarios/challenge';
import { costOf } from '../src/scenarios/difficulty';
import { habitsTestedBy, scenarioLibrary } from '../src/scenarios/library';
import { playScenario } from '../src/scenarios/playSim';
import type { ScenarioSpec } from '../src/scenarios/scenarios';
import { zoneCourses } from '../src/scenarios/zoneCourse';
import { stratifiedSample } from '../src/ai/sample';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const STEP = arg('step', 18);
/*
  2,000 회 — 600 회로는 결과 예측 모델이 덜 수렴해 숙달 0.95 인 학습자의 보행자 양보 위반 확률이 0.30 으로 나왔다(참값은 0.05 근처).
  2,000 회면 그 값이 기준 아래로 내려오고 위험도의 무위반 AUC 도 0.983 → 0.987 로 오른다. 학습 시간은 20초쯤 더 든다 (2026-09-27).
*/
const EPOCHS = arg('epochs', 2000);
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/ai/models');

// ── 판 표본 — 레벨마다 비율대로, 씨앗을 고정한 무작위 (src/ai/sample.ts 의 까닭 참고: 일정 간격은 환경 축이 통째로 빠졌다) ──
interface Item {
  spec: ScenarioSpec;
  targets: string[];
  cost: number;
  level: number;
}
const lib = scenarioLibrary();
const zone = zoneCourses();
const all: Item[] = [
  ...lib.map((e) => ({ spec: e.spec, targets: e.targets, cost: e.cost, level: e.level })),
  ...zone.map((spec) => ({ spec, targets: [...habitsTestedBy(spec)], cost: costOf(spec).total, level: 0 })),
];
const items: Item[] = stratifiedSample(all, { share: 1 / STEP, min: 40 });
{
  const env = (k: string) => items.filter((it) => (it.spec.timeOfDay === 'night' ? 'night' : it.spec.weather !== 'clear' ? 'rain' : 'day') === k).length;
  console.log(`표본 ${items.length}판 (라이브러리 ${lib.length} + 보호구역 ${zone.length}) · 낮 ${env('day')} · 밤 ${env('night')} · 비 ${env('rain')}`);
}

// ── 운전자 — 사람(반응 시간 × 난이도 설정) 열둘 + 규칙을 모르는 사람 여섯 ──
/*
  **규칙을 모르는 운전자도 섞는다** (playSim 의 pedBlind · signalBlind). 사람 운전자는 반응만 늦을 뿐 규칙은 다 알아서, 그들만
  으로 맞추면 난이도가 "앞차 · 코앞의 사람" 만 보게 된다. 실제 학습자는 규칙(적색 일시정지 · 보호구역 정지 · 보행자 양보)에서
  무너지므로, 그 규칙을 모르는 운전자가 실패하는 판이 곧 **규칙 판단이 필요한 어려운 판**이다. 위험도 모델의 이름표(반응
  사다리)는 사람 운전자 줄에서만 만든다.
*/
const REACTIONS = [0.5, 0.9, 1.3, 1.7];
const DIFFS = [1, 3, 5] as const;
type Who = 'human' | 'pedBlind' | 'signalBlind';
interface Config {
  id: string;
  who: Who;
  reaction: number;
  diff: 1 | 3 | 5;
}
const configs: Config[] = [];
for (const diff of DIFFS) for (const reaction of REACTIONS) configs.push({ id: `r${reaction}-d${diff}`, who: 'human', reaction, diff });
for (const diff of DIFFS) {
  configs.push({ id: `pedBlind-d${diff}`, who: 'pedBlind', reaction: 0, diff });
  configs.push({ id: `signalBlind-d${diff}`, who: 'signalBlind', reaction: 0, diff });
}

interface Row {
  item: number;
  config: number;
  f: RunFeatures;
  violated: boolean;
}
const rows: Row[] = [];
const t0 = Date.now();
console.log(`판 ${items.length} × 운전자 ${configs.length} = ${items.length * configs.length}판 달리는 중…`);
items.forEach((it, i) => {
  configs.forEach((c, j) => {
    const rule = challengeRule(c.diff);
    const r = playScenario(it.spec, {
      persona: c.who,
      reaction: c.reaction,
      pace: rule.pace,
      stopZone: rule.stopZone,
      trace: false,
      telemetry: true,
    });
    const f = r.result.features!;
    rows.push({ item: i, config: j, f, violated: f.viol > 0 || f.fail });
  });
  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${items.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
});
console.log(`달렸다: ${rows.length}판 · ${((Date.now() - t0) / 1000).toFixed(0)}초 · 위반율 ${(100 * rows.filter((r) => r.violated).length / rows.length).toFixed(1)}%`);

// ── 공통: 표준화 · 로지스틱 회귀 ──
function standardize(X: number[][]): { mean: number[]; std: number[]; Z: number[][] } {
  const d = X[0].length;
  const mean = Array(d).fill(0);
  const std = Array(d).fill(0);
  for (const x of X) x.forEach((v, k) => (mean[k] += v / X.length));
  for (const x of X) x.forEach((v, k) => (std[k] += (v - mean[k]) ** 2 / X.length));
  for (let k = 0; k < d; k++) std[k] = Math.sqrt(std[k]) || 1;
  const Z = X.map((x) => x.map((v, k) => (v - mean[k]) / std[k]));
  return { mean, std, Z };
}
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** 로지스틱 회귀 — 경사하강. `groups` 를 주면 행마다 따로 절편(운전자 능력)을 둔다 */
function fitLogistic(Z: number[][], y: number[], opts: { groups?: number[]; nGroups?: number; l2?: number; lr?: number } = {}) {
  const d = Z[0].length;
  const w = Array(d).fill(0);
  let b = 0;
  const a = Array(opts.nGroups ?? 0).fill(0);
  const l2 = opts.l2 ?? 1e-3;
  const lr = opts.lr ?? 0.1;
  for (let ep = 0; ep < EPOCHS; ep++) {
    const gw = Array(d).fill(0);
    let gb = 0;
    const ga = Array(a.length).fill(0);
    for (let i = 0; i < Z.length; i++) {
      const g = opts.groups ? opts.groups[i] : -1;
      let z = b + (g >= 0 ? a[g] : 0);
      for (let k = 0; k < d; k++) z += w[k] * Z[i][k];
      const err = sigmoid(z) - y[i];
      for (let k = 0; k < d; k++) gw[k] += err * Z[i][k];
      gb += err;
      if (g >= 0) ga[g] += err;
    }
    for (let k = 0; k < d; k++) w[k] -= lr * (gw[k] / Z.length + l2 * w[k]);
    b -= lr * (gb / Z.length);
    for (let g = 0; g < a.length; g++) a[g] -= lr * ((ga[g] / Z.length) * (a.length || 1) + l2 * a[g]);
  }
  return { w, b, a };
}
function auc(scores: number[], y: number[]): number {
  const pos = scores.filter((_, i) => y[i] === 1);
  const neg = scores.filter((_, i) => y[i] === 0);
  if (!pos.length || !neg.length) return NaN;
  let win = 0;
  for (const p of pos) for (const n of neg) win += p > n ? 1 : p === n ? 0.5 : 0;
  return win / (pos.length * neg.length);
}
const holdout = (i: number): boolean => i % 5 === 0;

// ── 1. 위험도 모델 ──
{
  // 이름표: 위반이 났거나, 한 단계 느린 반응(+0.4초)의 같은 판이 위반이었으면 '위험했던 판'
  const byKey = new Map<string, Row>();
  for (const r of rows) byKey.set(`${r.item}:${r.config}`, r);
  const label = (r: Row): number => {
    if (r.violated) return 1;
    const c = configs[r.config];
    const slower = configs.findIndex((x) => x.diff === c.diff && x.reaction === c.reaction + 0.4);
    const s = slower >= 0 ? byKey.get(`${r.item}:${slower}`) : undefined;
    return s?.violated ? 1 : 0;
  };
  const human = rows.filter((r) => configs[r.config].who === 'human');
  const vecs = human.map((r) => featureVector(r.f));
  const names = vecs[0].names;
  const { mean, std, Z } = standardize(vecs.map((v) => v.x));
  const y = human.map(label);
  const train = Z.map((_, i) => i).filter((i) => !holdout(human[i].item));
  const test = Z.map((_, i) => i).filter((i) => holdout(human[i].item));
  const m = fitLogistic(train.map((i) => Z[i]), train.map((i) => y[i]), { lr: 0.2, l2: 2e-3 });
  const score = (i: number): number => sigmoid(m.b + Z[i].reduce((s, v, k) => s + m.w[k] * v, 0));
  const a = auc(test.map(score), test.map((i) => y[i]));
  // 무위반 판만 두고도 갈라 보는가 — 실제로 쓰이는 자리는 여기다
  const clean = test.filter((i) => !human[i].violated);
  const aClean = auc(clean.map(score), clean.map((i) => y[i]));
  console.log(`위험도 모델: 표본 ${human.length} · 위험 비율 ${(100 * y.reduce((s, v) => s + v, 0) / y.length).toFixed(1)}% · AUC ${a.toFixed(3)} · 무위반 판만 AUC ${Number.isFinite(aClean) ? aClean.toFixed(3) : '-'}`);
  const top = m.w.map((w, k) => ({ n: names[k], w })).sort((p, q) => Math.abs(q.w) - Math.abs(p.w)).slice(0, 8);
  console.log('  큰 가중치:', top.map((t) => `${t.n} ${t.w.toFixed(2)}`).join(' · '));
  writeFileSync(
    resolve(OUT, 'risk.json'),
    JSON.stringify(
      {
        names,
        mean: mean.map((v) => +v.toFixed(4)),
        std: std.map((v) => +v.toFixed(4)),
        w: m.w.map((v) => +v.toFixed(4)),
        b: +m.b.toFixed(4),
        meta: { trained: true, samples: human.length, auc: +a.toFixed(3), aucClean: Number.isFinite(aClean) ? +aClean.toFixed(3) : null, date: new Date().toISOString().slice(0, 10), label: 'violated or would-violate at +0.4s reaction' },
      },
      null,
      1,
    ),
  );
}

// ── 2. 난이도 모델 ──
{
  const X = items.map((it) => scenarioFeatures(it.spec, it.targets as never, it.cost));
  const { mean, std, Z: Zs } = standardize(X);
  // 행마다 판의 특징 · 운전자 묶음 — 통과(1)/실패(0)
  const Z = rows.map((r) => Zs[r.item].map((v) => -v)); // b 를 빼는 꼴이라 부호를 뒤집어 넣는다
  const y = rows.map((r) => (r.violated ? 0 : 1));
  const groups = rows.map((r) => r.config);
  const train = rows.map((_, i) => i).filter((i) => !holdout(rows[i].item));
  const test = rows.map((_, i) => i).filter((i) => holdout(rows[i].item));
  const m = fitLogistic(train.map((i) => Z[i]), train.map((i) => y[i]), { groups: train.map((i) => groups[i]), nGroups: configs.length, lr: 0.2, l2: 1e-3 });
  // 난이도 b = w·x + b0 (부호를 되돌린다) · 운전자 능력 a
  const wDiff = m.w;
  const b0 = -m.b;
  const score = (i: number): number => sigmoid(m.a[groups[i]] + m.b + Z[i].reduce((s, v, k) => s + m.w[k] * v, 0));
  const a = auc(test.map(score), test.map((i) => y[i]));
  const ll = test.reduce((s, i) => s - Math.log(Math.max(1e-6, y[i] ? score(i) : 1 - score(i))), 0) / test.length;
  console.log(`난이도 모델: AUC ${a.toFixed(3)} · 로그손실 ${ll.toFixed(3)}`);
  console.log('  운전자 능력 a:', configs.map((c, j) => `${c.id} ${m.a[j].toFixed(2)}`).join(' · '));
  const top = wDiff.map((w, k) => ({ n: DIFFICULTY_FEATURES[k], w })).sort((p, q) => Math.abs(q.w) - Math.abs(p.w)).slice(0, 10);
  console.log('  큰 가중치:', top.map((t) => `${t.n} ${t.w.toFixed(2)}`).join(' · '));
  // 레벨마다 평균 난이도 — 학습자의 처음 능력이 여기서 시작한다 (ai/difficulty.ts 의 abilityFor)
  const bOf = (i: number): number => b0 + Zs[i].reduce((s, v, k) => s + wDiff[k] * v, 0);
  const levels: Record<string, number> = {};
  for (let l = 1; l <= 10; l++) {
    const idx = items.map((it, i) => (it.level === l ? i : -1)).filter((i) => i >= 0);
    levels[l] = idx.length ? +(idx.reduce((s, i) => s + bOf(i), 0) / idx.length).toFixed(3) : 0;
  }
  console.log('  레벨별 평균 난이도:', Object.entries(levels).map(([l, b]) => `L${l} ${b}`).join(' · '));
  writeFileSync(
    resolve(OUT, 'difficulty.json'),
    JSON.stringify(
      {
        names: [...DIFFICULTY_FEATURES],
        mean: mean.map((v) => +v.toFixed(4)),
        std: std.map((v) => +v.toFixed(4)),
        w: wDiff.map((v) => +v.toFixed(4)),
        b: +b0.toFixed(4),
        meta: {
          trained: true,
          samples: rows.length,
          auc: +a.toFixed(3),
          date: new Date().toISOString().slice(0, 10),
          drivers: Object.fromEntries(configs.map((c, j) => [c.id, +m.a[j].toFixed(3)])),
          levelMean: levels,
        },
      },
      null,
      1,
    ),
  );
}
// ── 3. 결과 예측 모델 — 가상 학습자(숙달 벡터)로 다중 레이블 분류 ──
{
  /*
    **가상 학습자**: 개념마다 숙달 m_c 를 뽑고, 확률 1−m_c 로 그 개념을 모르는 채(playSim 의 blind) 달린다. 반응 시간과
    난이도 설정도 섞는다. 입력은 판의 특징 · 시험 개념 · 숙달 · 시험 개념의 미숙달 · 반응 시간, 레이블은 실제로 난 위반이다.
    씨앗을 고정해 다시 돌려도 같은 파일이 나오게 한다.
  */
  let seed = 20260926;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const LEARNERS_PER_ITEM = 12;
  const REACT = [0.6, 1.0, 1.4];
  const SIMULABLE = SKILL_ORDER.filter((c) => c !== 'NO_SLOW_DOWN');
  const X: number[][] = [];
  const Y: number[][] = [];
  const t1 = Date.now();
  items.forEach((it, i) => {
    for (let k = 0; k < LEARNERS_PER_ITEM; k++) {
      const mastery = {} as Record<ViolationCode, number>;
      for (const c of SKILL_ORDER) mastery[c] = 0.05 + 0.93 * rand();
      const blind = new Set<ViolationCode>();
      for (const c of SIMULABLE) if (rand() > mastery[c]) blind.add(c);
      const reaction = REACT[Math.floor(rand() * REACT.length)];
      const diff = DIFFS[Math.floor(rand() * DIFFS.length)];
      const rule = challengeRule(diff);
      const r = playScenario(it.spec, { persona: 'human', reaction, pace: rule.pace, stopZone: rule.stopZone, trace: false, blind });
      const got = new Set(r.result.violations.map((v) => v.code));
      X.push(outcomeFeatures({ spec: it.spec, targets: it.targets as ViolationCode[], cost: it.cost }, { mastery, reaction }));
      Y.push(SKILL_ORDER.map((c) => (got.has(c) ? 1 : 0)));
    }
    if ((i + 1) % 150 === 0) console.log(`  학습자 ${i + 1}/${items.length} · ${((Date.now() - t1) / 1000).toFixed(0)}s`);
  });
  console.log(`가상 학습자: ${X.length}판 · ${((Date.now() - t1) / 1000).toFixed(0)}초`);
  const { mean, std, Z } = standardize(X);
  const train = Z.map((_, i) => i).filter((i) => !holdout(Math.floor(i / LEARNERS_PER_ITEM)));
  const test = Z.map((_, i) => i).filter((i) => holdout(Math.floor(i / LEARNERS_PER_ITEM)));
  const labels = SKILL_ORDER.map((code, li) => {
    const y = Y.map((row) => row[li]);
    const positives = y.reduce((s, v) => s + v, 0);
    const base = positives / y.length;
    if (positives < 30 || !SIMULABLE.includes(code)) {
      console.log(`  ${code}: 양성 ${positives} — 기본율 ${(base * 100).toFixed(1)}% 만`);
      return { code, w: [], b: 0, base: +base.toFixed(4), trained: false, auc: null };
    }
    const m = fitLogistic(train.map((i) => Z[i]), train.map((i) => y[i]), { lr: 0.2, l2: 2e-3 });
    const score = (i: number): number => sigmoid(m.b + Z[i].reduce((s, v, k) => s + m.w[k] * v, 0));
    const a = auc(test.map(score), test.map((i) => y[i]));
    console.log(`  ${code}: 양성 ${positives} (${(base * 100).toFixed(1)}%) · AUC ${Number.isFinite(a) ? a.toFixed(3) : '-'}`);
    return { code, w: m.w.map((v) => +v.toFixed(4)), b: +m.b.toFixed(4), base: +base.toFixed(4), trained: true, auc: Number.isFinite(a) ? +a.toFixed(3) : null };
  });
  writeFileSync(
    resolve(OUT, 'outcome.json'),
    JSON.stringify(
      {
        names: [...OUTCOME_FEATURES],
        mean: mean.map((v) => +v.toFixed(4)),
        std: std.map((v) => +v.toFixed(4)),
        labels,
        meta: { trained: true, samples: X.length, date: new Date().toISOString().slice(0, 10), learnersPerScenario: LEARNERS_PER_ITEM },
      },
      null,
      1,
    ),
  );
}
console.log('저장:', OUT);
