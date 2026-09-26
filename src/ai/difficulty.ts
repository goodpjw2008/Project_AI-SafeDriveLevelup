/**
 * **난이도 모델 — 문항 반응 이론(IRT, 라쉬 모형)과 Elo 갱신.**
 *
 * 판마다 **난이도 b**, 학습자마다 **능력 θ** 를 두고, 통과할 확률을 σ(θ − b) 로 본다. 조건 점수표(scenarios/difficulty.ts)가
 * 손으로 정한 값이라면, 이 모델은 **데이터로 배운 값**이다 — 판의 특징(사람 수 · 자전거 · 무단횡단 · 앞차 · 밤비 …)에
 * 가중치를 곱해 b 를 낸다.
 *
 * ## 학습은 빌드 때 시뮬레이터로, 보정은 판마다 브라우저에서
 *
 * 학습자 데이터는 사람마다 몇십 판이라 판 12,998개의 난이도를 학습자 결과만으로 맞출 수 없다. 그래서 `scripts/train-ai.ts`
 * 가 시뮬레이터의 사람 운전자(반응 시간 × 브레이크 세기 = 열두 가지 능력)로 판을 달리게 해 통과 · 실패를 모으고,
 * 능력 하나 · 특징 가중치 한 벌을 함께 맞춘다(joint logistic). 배포되는 것은 가중치 스무 개 남짓(models/difficulty.json)이라
 * 어떤 판이든(AI 가 새로 만든 판도) 특징만 세면 b 가 나온다.
 *
 * 학습자의 θ 는 브라우저에서 판마다 Elo 처럼 움직인다 — 예상보다 잘하면 오르고 못하면 내린다. 처음 값은 **그 레벨 판의
 * 평균 난이도**로 두어, 새 레벨에서 보통 판의 예상 성공률이 절반 근처에서 시작한다.
 *
 * 쓰임: 추천이 후보마다 **예상 성공률**을 셈해 근접 발달 영역(60~75%)의 판을 좋게 치고(recommend.ts), 화면이 그 값을
 * 보여 준다. 학습 전이면 조건 점수를 그대로 쓰는 손 가중치로 돈다. 순수 모듈이다.
 */

import type { Difficulty } from '../scenarios/curriculum';
import type { ViolationCode } from '../rules/violations';
import type { ScenarioSpec } from '../scenarios/scenarios';
import { STANDARD_PROGRAM, phaseAt } from '../scenarios/scenarios';
import type { LogisticModel } from './risk';
import trained from './models/difficulty.json';

/** 판의 특징 — 판의 값(spec)만으로 센다. 태그가 없는 판(AI 가 만든 판)도 같은 셈이다 */
export const DIFFICULTY_FEATURES = [
  'cost',
  'people',
  'children',
  'riders',
  'pushers',
  'chance',
  'jaywalk',
  'close',
  'lead',
  'rolling',
  'jam',
  'night',
  'rain',
  'honk',
  'zone',
  'approach',
  'approachNoSignal',
  'noSignalA',
  'noSignalC',
  'red',
  'arrow',
  'targets',
  'cross',
] as const;

export function scenarioFeatures(spec: ScenarioSpec, targets: readonly ViolationCode[], cost: number): number[] {
  const peds = spec.pedestrians;
  const startWithins = peds.map((p) => p.startWithin).filter((v): v is number => typeof v === 'number');
  const closest = startWithins.length ? Math.min(...startWithins) : 30;
  const red = spec.drive === 'zoneOnly' ? 0 : phaseAt(STANDARD_PROGRAM, spec.startPhase, spec.startPhaseElapsed, 0).vehicle === 'red' ? 1 : 0;
  const row: Record<(typeof DIFFICULTY_FEATURES)[number], number> = {
    cost: cost / 10,
    people: peds.length,
    children: peds.filter((p) => p.kind === 'child').length,
    riders: peds.filter((p) => p.bike === 'ride').length,
    pushers: peds.filter((p) => p.bike === 'push').length,
    chance: peds.filter((p) => p.chance !== undefined).length,
    jaywalk: peds.filter((p) => p.obeysSignal === false).length,
    // 가까이서 나설수록 어렵다 — 30m 밖은 0, 코앞은 1
    close: Math.max(0, Math.min(1, (30 - closest) / 30)),
    lead: spec.leadCar ? 1 : 0,
    rolling: spec.leadCar?.behavior === 'rolling' ? 1 : 0,
    jam: spec.exitBlocked ? 1 : 0,
    night: spec.timeOfDay === 'night' ? 1 : 0,
    rain: spec.weather !== 'clear' ? 1 : 0,
    honk: spec.rearHonk ? 1 : 0,
    zone: spec.isSchoolZone ? 1 : 0,
    approach: spec.approachSchoolZone ? 1 : 0,
    approachNoSignal: spec.approachSchoolZone && !spec.approachSchoolZone.signal ? 1 : 0,
    noSignalA: spec.pedSignalInstalled.A ? 0 : 1,
    noSignalC: spec.pedSignalInstalled.C ? 0 : 1,
    red,
    arrow: spec.rightArrowInstalled ? 1 : 0,
    targets: targets.length,
    cross: spec.crossTraffic,
  };
  return DIFFICULTY_FEATURES.map((k) => row[k]);
}

/** 학습 전의 손 가중치 — 조건 점수를 중심으로, 사람과 자전거를 조금 더 (로짓 단위) */
const FALLBACK: LogisticModel = {
  names: ['cost', 'people', 'riders', 'pushers', 'jaywalk', 'close', 'rolling', 'night', 'rain'],
  mean: [1.2, 1.2, 0, 0, 0, 0.3, 0, 0, 0],
  std: [0.7, 1.2, 1, 1, 1, 0.3, 1, 1, 1],
  w: [0.9, 0.4, 0.3, 0.2, 0.4, 0.5, 0.4, 0.2, 0.2],
  b: 0,
  meta: { trained: false, samples: 0 },
};

export const DIFFICULTY_MODEL: LogisticModel =
  trained && (trained as LogisticModel).meta?.trained ? (trained as LogisticModel) : FALLBACK;

/** 판의 난이도 b (로짓) — 모델의 특징 이름으로 맞춰 넣는다 */
export function difficultyOf(
  e: { spec: ScenarioSpec; targets: readonly ViolationCode[]; cost: number },
  model: LogisticModel = DIFFICULTY_MODEL,
): number {
  const x = scenarioFeatures(e.spec, e.targets, e.cost);
  const at = new Map(DIFFICULTY_FEATURES.map((n, i) => [n as string, x[i]]));
  let b = model.b;
  model.names.forEach((n, i) => {
    const v = at.get(n);
    if (v === undefined) return;
    b += model.w[i] * ((v - model.mean[i]) / (model.std[i] || 1));
  });
  return b;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** 통과할 확률 — σ(θ − b) */
export const successProbability = (ability: number, difficulty: number): number => sigmoid(ability - difficulty);

/**
 * **능력 갱신 (Elo)** — 예상과 결과의 차만큼 움직인다. K 는 한 판의 무게 — 0.35 면 예상 50% 판을 통과했을 때 +0.18,
 * 예상 80% 판을 틀렸을 때 −0.28. 학습자 능력이 몇십 판 안에 자리 잡을 만큼 크고, 한 판에 흔들리지 않을 만큼 작다.
 */
export const ELO_K = 0.35;
export function updateAbility(ability: number, difficulty: number, success: boolean, k = ELO_K): number {
  const p = successProbability(ability, difficulty);
  return ability + k * ((success ? 1 : 0) - p);
}

/**
 * 레벨마다의 **평균 난이도** — 학습 스크립트가 표본 판으로 재어 모델 파일에 적어 둔다 (meta.levelMean).
 * 학습 전이면 레벨에 비례하는 어림값이다.
 */
export function levelMeanDifficulty(level: Difficulty, model: LogisticModel = DIFFICULTY_MODEL): number {
  const table = (model.meta as { levelMean?: Record<string, number> }).levelMean;
  const v = table?.[String(level)];
  return typeof v === 'number' ? v : (level - 5) * 0.3;
}

/**
 * **그 레벨에 맞는 학습자는 보통 판을 열에 일곱쯤 통과한다** — 처음 능력 θ 를 평균 난이도 + 이만큼 위에 둔다.
 * 0 이면 예상 성공률이 절반에서 시작해 화면이 너무 비관적이고, 너무 크면 근접 발달 영역이 늘 쉬운 판을 가리킨다.
 */
export const ABILITY_HEADROOM = 0.85;

/** 능력이 아직 없는 학습자의 처음 값 — 그 레벨의 평균 난이도 + 여유 */
export function abilityPriorFor(level: Difficulty, model: LogisticModel = DIFFICULTY_MODEL): number {
  return levelMeanDifficulty(level, model) + ABILITY_HEADROOM;
}
