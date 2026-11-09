/**
 * **다음 판 추천 — 어텐션 신경망** (설정 'AI 사용 설정' 의 '로컬 신경망 어텐션' — save.ts 의 aiMode `attention`).
 *
 * 지금의 추천 신경망(recommendNet.ts)은 판을 **하나씩 따로** 채점한다. 그런데 좋은 판인지는 다른 후보와 견줘야 알 때가 많다 —
 * 같은 모양의 판이 여럿이면 그중 이 사람에게 가장 맞는 하나, 한 종류가 후보를 독차지하지 않게. 하나씩 보는 신경망은 그것을
 * 볼 수 없어, 갈래 안 판 전부(평균 335판)를 채점하면 확률의 29% 가 예전 프로그램이 후보로도 올리지 않을 '비슷해 보이는' 판에
 * 실렸다 — 프로그램의 최종 후보 안에서만 고르게 하면 같은 신경망이 프로그램과 같았는데(익힌 개념 +0.01 ± 0.02), 다 채점하면
 * 0.1 남짓 뒤졌다 (2026-11-02, 가상 운전자 4,000명).
 *
 * 그래서 **후보들이 서로를 보게** 한다 — 트랜스포머(Vaswani 외, "Attention Is All You Need", 2017)의 셀프 어텐션을 문장의 낱말
 * 대신 후보 판들에 쓴다. 판에는 차례가 없으므로 자리 정보는 넣지 않는다 (Set Transformer — Lee 외, 2019). 추천 분야에서 후보
 * 목록을 트랜스포머로 다시 매기는 것(Alibaba 의 PRM, 2019)과 같은 짜임이다:
 *
 * 1. 판마다 — 입력(REC_FEATURES, 지금 신경망과 같다)을 은닉 64 로 읽어 **먼저 보는 점수** 하나와 **토큰**(폭 32)을 낸다.
 * 2. 먼저 보는 점수로 갈래마다 위 `perClass`(24) 판을 추린다 — 모든 갈래의 후보를 한 묶음으로 본다 (아래 `global`).
 * 3. 그 판들의 토큰이 **셀프 어텐션 2층**(머리 4 · 층 정규화를 앞에 · 잔차)으로 서로를 본다 — 판마다 '나와 닮은 판이 몇이고
 *    그중 내가 어디쯤인가' 가 토큰에 섞인다.
 * 4. 판마다 마지막 점수 = 먼저 보는 점수 + 어텐션 뒤 토큰에서 읽은 값. 점수를 확률로 바꿔 한 판을 뽑는다 (recommend.ts 의 aiCourses).
 *
 * **어떻게 배웠나** — 프로그램을 따라 배운 뒤(행동 복제) 강화학습으로 다듬고, 무신호 보호구역의 바닥과 갈래 비율을 벌점으로 맞췄다. 가상 운전자
 * 12,000명으로 프로그램과 견주면 익힌 개념 −0.016 ± 0.010, 레벨 +0.003 ± 0.023 으로 조금 낮거나 같고, 대신 고르는 판이 더 다양하다 (500명 60판:
 * 서로 다른 상황 36.4 → 37.3, 5판 안에 같은 상황 12.9% → 11.6%, 모두가 쓴 판 3,781 → 4,230). 사용자가 정한 쓰임이다 (2026-11-05: *"어텐션을 쓰는
 * 장점이 있어야해. 정확도는 조금 떨어지지만 상대적으로 다양성이 올라간다거나"*). 설정 '로컬 신경망' 을 스승으로 따라 배운 모델은 +0.006 · +0.032 로
 * 더 높았지만 어텐션이 확률을 0.2% 만 바꿔 설정 1번의 복사본이었다 — 쓰지 않는다 (tests/recommendAttention.test.ts 가 막는다).
 *
 * 학습은 scripts/train-recommend-attn.py (GPU) — 이 파일과 같은 계산을 torch 로 하고 가중치를 JSON 으로 쓴다. 브라우저는 학습하지
 * 않고 그 JSON 만 읽는다. 계산은 판과 판 사이에 한 번이라 가볍다 (판 2,000개에서 한 판을 고르는 데 이 컴퓨터로 50ms,
 * 설정 '로컬 신경망' 은 30ms). 라이브러리는 쓰지 않는다.
 */
import type { ReasonGroup, TurnNet } from './recommendNet';
import { REASON_GROUPS, REC_FEATURES, TURN_CLASSES, TURN_FEATURES, turnModelReady } from './recommendNet';
import trained from './models/recommend-attn.json';

type Mat = ReadonlyArray<readonly number[]>;
type Vec = readonly number[];

interface AttnLayer {
  /** 층 정규화 (어텐션 앞) */
  ln1: { g: Vec; b: Vec };
  /** 쿼리 · 키 · 값 · 출력 — [나가는 폭][들어오는 폭] (torch 의 Linear.weight 와 같은 꼴) */
  Wq: Mat;
  Wk: Mat;
  Wv: Mat;
  Wo: Mat;
  bo: Vec;
  /** 층 정규화 (앞먹임 앞) · 앞먹임 두 층 (ReLU) */
  ln2: { g: Vec; b: Vec };
  F1: Mat;
  f1: Vec;
  F2: Mat;
  f2: Vec;
}

export interface AttnModel {
  kind: 'recommend-attn';
  names: readonly string[];
  mean: Vec;
  std: Vec;
  /** 판마다 읽기 — 은닉 (tanh) */
  E1: Mat;
  e1: Vec;
  /** 먼저 보는 점수 */
  pw: Vec;
  pb: number;
  /** 토큰 = TW · 은닉 + tb + 먼저 보는 점수 × tu */
  TW: Mat;
  tb: Vec;
  tu: Vec;
  layers: readonly AttnLayer[];
  lnf: { g: Vec; b: Vec };
  /** 마지막 점수 = 먼저 보는 점수 + ow · 토큰 + ob */
  ow: Vec;
  ob: number;
  heads: number;
  /** 어텐션에 넣는 판 수 (갈래 안에서 고를 때) */
  k: number;
  /** 차례 신경망 — 이번 판의 갈래 (recommendNet.ts 의 TURN_CLASSES, 같은 꼴). 하나로 고르는 모델(`global`)에는 없다 */
  turn?: TurnNet;
  /**
   * **하나로 고른다** — 갈래 신경망 없이 모든 갈래의 후보를 한 묶음으로 본다. 갈래마다 먼저 보는 점수로 위 `perClass` 판을 추리고
   * (판이 많은 갈래가 묶음을 독차지하지 않게), 그 판들과 **상황 토큰**(차례 신경망이 보던 입력 — 최근 판의 갈래 · 오래 없던 갈래 ·
   * 탈 수 있는 갈래)이 서로를 본다. 상황 토큰은 점수를 받지 않는다.
   */
  global?: boolean;
  perClass?: number;
  ctx?: { names: readonly string[]; W1: Mat; b1: Vec; W2: Mat; b2: Vec };
  /**
   * **갈래 머리** (스승을 따라 배운 모델만 쓴다, 지금 앱 모델에는 없다) — 어텐션을 거친 상황 토큰이 갈래마다 점수(`cw · 토큰 + cb`)를 낸다. 먼저 보는 점수는 갈래 안에서만 뜻이 있어 갈래끼리는 크기가
   * 크게 다르므로, 판의 점수를 '그 갈래의 확률 × 갈래 안 확률' 꼴로 맞춘다 (없으면 예전처럼 먼저 보는 점수에 토큰 점수만 더한다).
   */
  cw?: Mat;
  cb?: Vec;
  meta: { trained: boolean; [k: string]: unknown };
}

const MODEL = trained as unknown as AttnModel;

/** 학습한 어텐션 모델이 있고 입력 이름이 지금 코드와 같은가 — 아니면 '로컬 신경망 어텐션' 도 지금 신경망으로 고른다 */
export const attentionModelReady = (model: AttnModel = MODEL): boolean =>
  model.meta?.trained === true &&
  model.kind === 'recommend-attn' &&
  model.names.length === REC_FEATURES.length &&
  model.names.every((n, i) => n === REC_FEATURES[i]) &&
  (model.global
    ? !!model.ctx && model.ctx.names.length === TURN_FEATURES.length && model.ctx.names.every((n, i) => n === TURN_FEATURES[i])
    : turnModelReady(model.turn));

/** 하나로 고르는 모델인가 — 그러면 갈래 신경망 없이 모든 갈래의 후보를 한꺼번에 넘긴다 (recommend.ts 의 aiCourses) */
export const attentionGlobal = (model: AttnModel = MODEL): boolean => model.global === true;

/** 어텐션에 넣는 판 수 — 분석 화면이 "위 N개를 서로 견주며" 라고 말한다. 하나로 고르는 모델은 갈래마다 위 `perClass` 판이다 */
export const attentionTopK = (model: AttnModel = MODEL): number =>
  model.global ? (model.perClass ?? 24) * TURN_CLASSES.length : (model.k ?? 64);

/** 어텐션 모델의 차례 신경망 — recommendNet.ts 의 turnProbs 에 넘긴다 */
export const attentionTurnModel = (model: AttnModel = MODEL): { turn?: TurnNet } => ({ turn: model.turn });

function matVec(W: Mat, x: Vec, b?: Vec): number[] {
  const out = new Array<number>(W.length);
  for (let i = 0; i < W.length; i += 1) {
    const row = W[i];
    let s = b ? b[i] : 0;
    for (let j = 0; j < x.length; j += 1) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
}

function layerNorm(x: Vec, p: { g: Vec; b: Vec }): number[] {
  const n = x.length;
  let m = 0;
  for (const v of x) m += v;
  m /= n;
  let s = 0;
  for (const v of x) s += (v - m) ** 2;
  const inv = 1 / Math.sqrt(s / n + 1e-5);
  return x.map((v, i) => (v - m) * inv * p.g[i] + p.b[i]);
}

/**
 * 후보마다의 점수 — `base` 는 판마다 따로 본 점수(모두), `final` 은 어텐션까지 거친 점수(추린 `k` 판만, 나머지는 −∞).
 * `final` 을 확률로 바꿔 뽑는다.
 */
export function attentionScores(
  rows: ReadonlyArray<readonly number[]>,
  model: AttnModel = MODEL,
  /** 하나로 고르는 모델(`global`)에만 — 판마다 갈래(TURN_CLASSES 의 번호) · 상황 입력(turnFeatures 와 탈 수 있는 갈래 일곱) */
  scene?: { classes: readonly number[]; ctx: readonly number[] },
): { base: number[]; final: number[] } {
  const hidden = rows.map((x) =>
    matVec(
      model.E1,
      x.map((v, j) => (v - model.mean[j]) / (model.std[j] || 1)),
      model.e1,
    ).map(Math.tanh),
  );
  const base = hidden.map((h) => h.reduce((s, v, q) => s + model.pw[q] * v, model.pb));
  const order = base.map((_, i) => i).sort((a, b) => base[b] - base[a]);
  let pick: number[];
  if (model.global && scene) {
    // 갈래마다 위 perClass 판 — 순서는 먼저 보는 점수 순 그대로 (학습과 같게)
    const taken = new Array<number>(TURN_CLASSES.length).fill(0);
    pick = order.filter((i) => taken[scene.classes[i]]++ < (model.perClass ?? 24));
  } else pick = order.slice(0, Math.min(model.k, rows.length));
  let t = pick.map((i) => matVec(model.TW, hidden[i], model.tb).map((v, c) => v + base[i] * model.tu[c]));
  // 상황 토큰 — 맨 뒤에 하나 (점수는 받지 않는다)
  if (model.global && scene && model.ctx) t.push(matVec(model.ctx.W2, matVec(model.ctx.W1, scene.ctx, model.ctx.b1).map(Math.tanh), model.ctx.b2));
  const D = model.tb.length;
  const H = model.heads;
  const dh = D / H;
  const scale = 1 / Math.sqrt(dh);
  for (const L of model.layers) {
    const a = t.map((x) => layerNorm(x, L.ln1));
    const q = a.map((x) => matVec(L.Wq, x));
    const k = a.map((x) => matVec(L.Wk, x));
    const v = a.map((x) => matVec(L.Wv, x));
    const mixed = t.map(() => new Array<number>(D).fill(0));
    for (let h = 0; h < H; h += 1) {
      const lo = h * dh;
      for (let i = 0; i < t.length; i += 1) {
        const w = new Array<number>(t.length);
        let top = -Infinity;
        for (let j = 0; j < t.length; j += 1) {
          let s = 0;
          for (let c = lo; c < lo + dh; c += 1) s += q[i][c] * k[j][c];
          w[j] = s * scale;
          if (w[j] > top) top = w[j];
        }
        let z = 0;
        for (let j = 0; j < t.length; j += 1) {
          w[j] = Math.exp(w[j] - top);
          z += w[j];
        }
        for (let j = 0; j < t.length; j += 1) {
          const p = w[j] / z;
          for (let c = lo; c < lo + dh; c += 1) mixed[i][c] += p * v[j][c];
        }
      }
    }
    t = t.map((x, i) => {
      const o = matVec(L.Wo, mixed[i], L.bo);
      const r = x.map((val, c) => val + o[c]);
      const f = matVec(L.F2, matVec(L.F1, layerNorm(r, L.ln2), L.f1).map((val) => Math.max(0, val)), L.f2);
      return r.map((val, c) => val + f[c]);
    });
  }
  // 갈래 머리 — 판마다 더할 값: 갈래의 로그 확률 − 그 갈래 판들의 먼저 보는 점수의 로그합
  const offset = new Array<number>(TURN_CLASSES.length).fill(0);
  if (model.cw && model.cb && scene) {
    const logits = matVec(model.cw, layerNorm(t[t.length - 1], model.lnf), model.cb);
    const present = [...new Set(pick.map((i) => scene.classes[i]))];
    const logSum = (xs: readonly number[]): number => {
      const top = Math.max(...xs);
      return top + Math.log(xs.reduce((s, v) => s + Math.exp(v - top), 0));
    };
    const z = logSum(present.map((c) => logits[c]));
    for (const c of present) offset[c] = logits[c] - z - logSum(pick.filter((i) => scene.classes[i] === c).map((i) => base[i]));
  }
  const final = rows.map(() => -Infinity);
  pick.forEach((i, n) => {
    const u = layerNorm(t[n], model.lnf);
    final[i] = base[i] + (scene ? offset[scene.classes[i]] : 0) + u.reduce((s, val, c) => s + model.ow[c] * val, model.ob);
  });
  return { base, final };
}

/**
 * **왜 이 판인가 — 가려 보기** (recommendNet.ts 의 explainPick 과 같은 방법 · 같은 무리). 고른 판의 특징 무리를 하나씩 후보들의
 * 평균으로 바꿔, 후보들을 함께 본 마지막 점수가 얼마나 떨어지는지 잰다. 가장 많이 떨어지는 무리가 근거다. 없으면 null.
 */
export function explainAttention(
  rows: ReadonlyArray<readonly number[]>,
  chosen: number,
  model: AttnModel = MODEL,
  scene?: { classes: readonly number[]; ctx: readonly number[] },
): { group: ReasonGroup; drop: number } | null {
  const avg = model.names.map((_, j) => rows.reduce((s, x) => s + x[j], 0) / rows.length);
  const base = attentionScores(rows, model, scene).final[chosen];
  let best: { group: ReasonGroup; drop: number } | null = null;
  for (const group of Object.keys(REASON_GROUPS) as ReasonGroup[]) {
    const swapped = rows.map((x, i) => (i === chosen ? x.map((v, j) => (REASON_GROUPS[group](model.names[j]) ? avg[j] : v)) : x));
    const after = attentionScores(swapped, model, scene).final[chosen];
    const drop = base - (Number.isFinite(after) ? after : base - 1e3);
    if (drop > 0 && (!best || drop > best.drop)) best = { group, drop };
  }
  return best;
}
