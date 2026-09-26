/**
 * **위험도 모델 — 로지스틱 회귀.** 한 판의 요약(ai/telemetry.ts)을 넣으면 "위반 직전이었을 확률" 을 낸다.
 *
 * 판정 엔진은 위반만 가른다. 이 모델은 그 앞의 회색 지대를 잰다 — 위반은 아니었지만 보행자를 보고 늦게 제동했고
 * 시간 여유가 거의 없던 판. 학습자 모델(ai/knowledge.ts)이 그런 판을 "겨우 지킨 관측" 으로 누그러뜨리고, 결과 화면과
 * AI 코치가 위험했던 순간을 말하는 근거다.
 *
 * ## 학습은 빌드 때 시뮬레이터로 한다
 *
 * 가중치는 `scripts/train-ai.ts` 가 만든다 — 시뮬레이터(scenarios/playSim.ts)의 사람 운전자를 반응 시간 · 브레이크 세기를
 * 바꿔 가며 수천 판 달리게 해, 같은 요약 숫자와 "위반이 났는가" 를 짝지어 로지스틱 회귀를 맞춘다. 배포되는 것은
 * 가중치 스무 개 남짓(models/risk.json)이고, 브라우저는 곱셈 몇 번으로 확률을 낸다. 학습 데이터가 가상 운전자라
 * 실제 사람과는 다르지만, "늦게 반응하면 위반에 가까워진다" 는 관계는 같은 물리에서 나온다.
 *
 * 모델 파일이 없거나 학습 전이면 손으로 둔 기본 가중치를 쓴다 — 반응 시간 · 시간 여유 · 지나침만 보는 단순한 것.
 */

import { NUMERIC_FEATURES, type RunFeatures } from './telemetry';
import trained from './models/risk.json';

export interface LogisticModel {
  /** 특징 이름 — `x` 의 순서 */
  names: readonly string[];
  /** 표준화에 쓰는 평균 · 표준편차 (특징 순서) */
  mean: readonly number[];
  std: readonly number[];
  /** 가중치 (특징 순서) · 절편 */
  w: readonly number[];
  b: number;
  /** 학습 정보 — 화면에는 안 나가고 장표 · 테스트가 읽는다 */
  meta: { trained: boolean; samples: number; auc?: number; date?: string };
}

/** 값이 없는 특징은 0 으로 두고 **없음 표시**를 따로 넣는다 — 상황이 없던 판과 값이 0 인 판을 가른다 */
export function featureVector(f: RunFeatures): { names: string[]; x: number[] } {
  const names: string[] = [];
  const x: number[] = [];
  for (const k of NUMERIC_FEATURES) {
    const v = f[k];
    const num = typeof v === 'number' && Number.isFinite(v) ? v : null;
    names.push(k);
    x.push(num ?? 0);
    if (k === 'react' || k === 'ttc' || k === 'gap' || k === 'brakeA' || k === 'stopA') {
      names.push(`${k}?`);
      x.push(num === null ? 1 : 0);
    }
  }
  names.push('redAt30');
  x.push(f.redAt30 ? 1 : 0);
  return { names, x };
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** 모델 하나로 확률을 낸다 — 이름으로 맞춰 넣으므로 특징이 늘어도 옛 모델이 깨지지 않는다 */
export function predict(model: LogisticModel, f: RunFeatures): number {
  const { names, x } = featureVector(f);
  const at = new Map(names.map((n, i) => [n, x[i]]));
  let z = model.b;
  model.names.forEach((n, i) => {
    const v = at.get(n);
    if (v === undefined) return;
    const std = model.std[i] || 1;
    z += model.w[i] * ((v - model.mean[i]) / std);
  });
  return sigmoid(z);
}

/** 학습된 모델이 없을 때의 손 가중치 — 표준화 없이 원값을 그대로 본다 */
const FALLBACK: LogisticModel = {
  names: ['react', 'react?', 'ttc', 'ttc?', 'passIntent', 'crossA', 'crossC', 'stopA'],
  mean: [0, 0, 0, 0, 0, 0, 0, 0],
  std: [1, 1, 1, 1, 1, 1, 1, 1],
  w: [1.2, -0.6, -0.9, 0.3, 1.6, 0.04, 0.04, -0.2],
  b: -1.0,
  meta: { trained: false, samples: 0 },
};

export const RISK_MODEL: LogisticModel = trained && (trained as LogisticModel).meta?.trained ? (trained as LogisticModel) : FALLBACK;

/**
 * 이 판의 위험도 0~1 — 요약 숫자만 본다. 위반이 난 판도 숫자로 잰다 — 학습자 모델이 그 판에서 **지킨 다른 개념**의 관측을
 * 이 값으로 누그러뜨리므로, 위반 하나로 나머지를 다 어긴 것처럼 세면 안 된다. "위험했던 판" 이라고 말하는 것은
 * 무위반 판에만 한다 (ai/report.ts).
 */
export function riskOf(f: RunFeatures, model: LogisticModel = RISK_MODEL): number {
  return predict(model, f);
}

/** 이 위험도면 결과 화면이 '위험했던 판' 이라고 말한다 */
export const RISKY_ABOVE = 0.5;
