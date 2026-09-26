import { describe, expect, it } from 'vitest';
import {
  ABILITY_HEADROOM,
  DIFFICULTY_FEATURES,
  DIFFICULTY_MODEL,
  abilityPriorFor,
  difficultyOf,
  levelMeanDifficulty,
  scenarioFeatures,
  successProbability,
  updateAbility,
} from '../src/ai/difficulty';
import { libraryEntryByNumber, scenarioLibrary } from '../src/scenarios/library';
import { scenarioByCode } from '../src/scenarios/scenarioCode';

/*
  **난이도 모델(IRT)** — 판의 특징 → 난이도 b, 학습자 능력 θ, 통과 확률 σ(θ − b). 가중치는 scripts/train-ai.ts 가
  시뮬레이터로 맞춘다 (src/ai/models/difficulty.json).
*/
describe('난이도 모델', () => {
  const byCode = (code: string) => {
    const spec = scenarioByCode(code);
    if (!spec) throw new Error(code);
    const e = scenarioLibrary().find((x) => x.spec.id === spec.id);
    if (!e) throw new Error(code);
    return e;
  };

  it('학습된 모델이 실려 있다', () => {
    expect(DIFFICULTY_MODEL.meta.trained).toBe(true);
    expect(DIFFICULTY_MODEL.names.length).toBeGreaterThan(5);
    expect(DIFFICULTY_MODEL.w.length).toBe(DIFFICULTY_MODEL.names.length);
  });

  it('특징은 판의 값만으로 세고 순서가 고정이다', () => {
    const e = byCode('L00091');
    const x = scenarioFeatures(e.spec, e.targets, e.cost);
    expect(x.length).toBe(DIFFICULTY_FEATURES.length);
    expect(x[DIFFICULTY_FEATURES.indexOf('people')]).toBe(2);
    expect(x[DIFFICULTY_FEATURES.indexOf('red')]).toBe(0);
    expect(scenarioFeatures(byCode('L00271').spec, [], 1)[DIFFICULTY_FEATURES.indexOf('red')]).toBe(1);
  });

  it('보행자 없는 녹색 판보다 사람 · 자전거가 얽힌 판이 어렵다', () => {
    const easy = difficultyOf(byCode('L00001'));
    const hard = difficultyOf(byCode('M10519'));
    expect(hard).toBeGreaterThan(easy);
  });

  it('통과 확률은 능력이 난이도와 같을 때 절반이고, 능력이 오르면 오른다', () => {
    expect(successProbability(1, 1)).toBeCloseTo(0.5, 5);
    expect(successProbability(2, 1)).toBeGreaterThan(0.7);
    expect(successProbability(0, 1)).toBeLessThan(0.3);
  });

  it('Elo — 예상보다 잘하면 오르고 못하면 내리며, 뜻밖의 결과일수록 크게 움직인다', () => {
    const up = updateAbility(0, 0, true);
    const down = updateAbility(0, 0, false);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeLessThan(0);
    // 쉬운 판(예상 90%)을 틀리면 어려운 판을 틀린 것보다 많이 내려간다
    expect(Math.abs(updateAbility(2, 0, false))).toBeGreaterThan(Math.abs(updateAbility(0, 0, false)) - 2);
    expect(updateAbility(2, 0, false)).toBeLessThan(2);
  });

  it('처음 능력은 그 레벨의 평균 난이도보다 여유만큼 높다 — 보통 판을 열에 일곱쯤 통과하는 자리', () => {
    for (const level of [1, 5, 10] as const) {
      expect(abilityPriorFor(level)).toBeCloseTo(levelMeanDifficulty(level) + ABILITY_HEADROOM, 6);
      expect(successProbability(abilityPriorFor(level), levelMeanDifficulty(level))).toBeCloseTo(0.7, 1);
    }
  });

  it('레벨 10 의 판이 레벨 1 의 판보다 평균적으로 어렵다', () => {
    const mean = (level: number) => {
      const es = scenarioLibrary().filter((e) => e.level === level);
      return es.reduce((s, e) => s + difficultyOf(e), 0) / es.length;
    };
    expect(mean(10)).toBeGreaterThan(mean(1));
    expect(libraryEntryByNumber(1)).toBeDefined();
  });
});
