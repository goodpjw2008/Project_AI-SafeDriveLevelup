import { describe, expect, it } from 'vitest';
import {
  BKT,
  MASTERY_GATE,
  effectiveMastery,
  heldBy,
  mastery,
  observe,
  skillProfile,
  updateKnowledge,
  weakSkills,
  type Knowledge,
} from '../src/ai/knowledge';
import { HLR, halfLifeHours, recall, reviewDue } from '../src/ai/forgetting';

/*
  **학습자 모델(BKT)** — 개념마다 익혔을 확률. 한 번 지켰다고 익힌 것이 아니고 두세 번 이어 지켜야 확신에 가까워지며,
  한 번 어기면 크게 내려간다. 위험했던 판은 반쯤 지킨 것으로 본다.
*/
describe('베이즈 지식 추적', () => {
  it('처음에는 L0 이고, 지킬수록 오르고, 어기면 내려간다', () => {
    let k: Knowledge = {};
    expect(mastery(k, 'RED_NO_STOP')).toBe(BKT.L0);
    k = observe(k, 'RED_NO_STOP', true, { now: 1 });
    const one = mastery(k, 'RED_NO_STOP');
    expect(one).toBeGreaterThan(0.7);
    expect(one).toBeLessThan(0.8);
    k = observe(k, 'RED_NO_STOP', true, { now: 2 });
    expect(mastery(k, 'RED_NO_STOP')).toBeGreaterThan(0.9);
    k = observe(k, 'RED_NO_STOP', false, { now: 3 });
    expect(mastery(k, 'RED_NO_STOP')).toBeLessThan(0.7);
    expect(k.RED_NO_STOP?.n).toBe(3);
    expect(k.RED_NO_STOP?.miss).toBe(1);
  });

  it('위험했던 판의 지킴은 반쯤만 친다 — 한 판으로 기준을 못 넘는다', () => {
    const safe = observe({}, 'PEDESTRIAN_BLOCKED', true, { risk: 0.1, now: 1 });
    const risky = observe({}, 'PEDESTRIAN_BLOCKED', true, { risk: 0.9, now: 1 });
    expect(mastery(risky, 'PEDESTRIAN_BLOCKED')).toBeLessThan(mastery(safe, 'PEDESTRIAN_BLOCKED'));
    expect(mastery(safe, 'PEDESTRIAN_BLOCKED')).toBeGreaterThanOrEqual(MASTERY_GATE);
    expect(mastery(risky, 'PEDESTRIAN_BLOCKED')).toBeLessThan(MASTERY_GATE);
    // 어긴 것은 위험도와 상관없이 어긴 것이다
    expect(mastery(observe({}, 'PEDESTRIAN_BLOCKED', false, { risk: 0 }), 'PEDESTRIAN_BLOCKED')).toBeLessThan(0.5);
  });

  it('한 판의 결과를 통째로 넣는다 — 시험한 개념마다 지킴 · 어김', () => {
    const k = updateKnowledge({}, ['RED_NO_STOP', 'NO_SLOW_DOWN'], ['RED_NO_STOP'], { now: 5 });
    expect(mastery(k, 'RED_NO_STOP')).toBeLessThan(0.5);
    expect(mastery(k, 'NO_SLOW_DOWN')).toBeGreaterThan(0.7);
    expect(mastery(k, 'WIDE_TURN')).toBe(BKT.L0); // 시험하지 않은 개념은 그대로
  });

  it('붙잡는 개념은 시험된 것 가운데 기준 미만인 것뿐이다', () => {
    const k = updateKnowledge({}, ['RED_NO_STOP', 'NO_SLOW_DOWN'], [], { risk: 0.9, now: 1 });
    expect(heldBy(k, ['RED_NO_STOP', 'NO_SLOW_DOWN', 'WIDE_TURN'])).toEqual(['RED_NO_STOP', 'NO_SLOW_DOWN']);
    const k2 = updateKnowledge(k, ['RED_NO_STOP', 'NO_SLOW_DOWN'], [], { risk: 0, now: 2 });
    expect(heldBy(k2, ['RED_NO_STOP', 'NO_SLOW_DOWN'])).toEqual([]);
  });

  it('약한 개념과 레이더 — 시험된 개념만', () => {
    const k = updateKnowledge({}, ['RED_NO_STOP', 'PEDESTRIAN_BLOCKED'], ['PEDESTRIAN_BLOCKED'], { now: Date.now() });
    expect(weakSkills(k).map((w) => w.code)).toEqual(['PEDESTRIAN_BLOCKED']);
    const profile = skillProfile(k);
    expect(profile.find((a) => a.code === 'RED_NO_STOP')?.p).toBeGreaterThan(0.7);
    expect(profile.find((a) => a.code === 'WIDE_TURN')?.p).toBeNull();
  });
});

describe('망각 모델 (반감기 회귀)', () => {
  it('지킬수록 반감기가 길고 어길수록 짧다 — 한도 안에서', () => {
    expect(halfLifeHours(0, 0)).toBe(HLR.baseHours);
    expect(halfLifeHours(3, 0)).toBeGreaterThan(halfLifeHours(1, 0));
    expect(halfLifeHours(1, 2)).toBeLessThan(halfLifeHours(1, 0));
    expect(halfLifeHours(50, 0)).toBe(HLR.maxHours);
    expect(halfLifeHours(0, 50)).toBe(HLR.minHours);
  });

  it('시험되지 않은 개념은 잊을 것이 없고, 시간이 지나면 회상이 줄어 실효 숙달이 내려간다', () => {
    const now = 1_000_000_000_000;
    expect(recall(undefined, now)).toBe(1);
    const k = updateKnowledge({}, ['RED_NO_STOP'], [], { now });
    expect(effectiveMastery(k, 'RED_NO_STOP', now)).toBeCloseTo(mastery(k, 'RED_NO_STOP'), 5);
    const dayLater = now + 24 * 3_600_000 * 2 ** HLR.perOk; // 반감기 하나 뒤
    expect(effectiveMastery(k, 'RED_NO_STOP', dayLater)).toBeCloseTo(mastery(k, 'RED_NO_STOP') / 2, 2);
    expect(reviewDue(k, dayLater).map((r) => r.code)).toEqual(['RED_NO_STOP']);
    expect(reviewDue(k, now)).toEqual([]);
  });
});
