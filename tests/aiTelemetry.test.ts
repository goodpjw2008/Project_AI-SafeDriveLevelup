import { describe, expect, it } from 'vitest';
import { modelStep } from '../src/ai/report';
import { RISK_MODEL, riskOf } from '../src/ai/risk';
import { counterfactual, riskNotes, type RunFeatures } from '../src/ai/telemetry';
import { habitsTestedBy, scenarioLibrary } from '../src/scenarios/library';
import { playScenario } from '../src/scenarios/playSim';
import { scenarioByCode } from '../src/scenarios/scenarioCode';
import { challengeRule } from '../src/scenarios/challenge';

/*
  **주행 결과 데이터** — 시뮬레이터로 한 판을 달려 요약 한 줄이 채워지는지, 위험도 모델이 늦은 반응을 더 위험하게 보는지,
  반사실이 이 판의 숫자로 말하는지.
*/
const spec = (code: string) => {
  const s = scenarioByCode(code);
  if (!s) throw new Error(code);
  return s;
};
const play = (code: string, persona: 'careful' | 'human' | 'pedBlind' | 'signalBlind', reaction = 1.0) =>
  playScenario(spec(code), { persona, reaction, pace: challengeRule(3).pace, trace: false, telemetry: true });

describe('요약 한 줄', () => {
  it('정면 적색 판 — 제동 시작 · 정지 자리 · 정지 유지 시간이 찍힌다', () => {
    const f = play('L00271', 'careful').result.features!;
    expect(f.brakeA).not.toBeNull();
    expect(f.stopA).not.toBeNull();
    expect(f.stopA!).toBeGreaterThan(0);
    expect(f.stopA!).toBeLessThan(6);
    expect(f.holdA).toBeGreaterThan(0.5);
    expect(f.redAt30).toBe(true);
    expect(f.sigDist).not.toBeNull();
    expect(f.viol).toBe(0);
    expect(f.peds).toBe(0);
    expect(f.react).toBeNull();
  });

  it('보행자 판 — 반응 시간(제동이 필요해진 뒤 늦은 만큼)이 찍히고, 늦게 보는 사람이 더 늦다', () => {
    const careful = play('L00091', 'careful').result.features!;
    expect(careful.peds).toBeGreaterThan(0);
    expect(careful.react).not.toBeNull();
    expect(careful.reactMax!).toBeLessThan(0.5);
    expect(careful.gap === null || careful.gap >= 0).toBe(true);
    /*
      멀리서 보이는 사람에게는 늦게 보는 사람도 '필요해진 때' 에 밟으므로 반응 시간이 같다 — 차이는 **빠르게 다가가는
      난이도(5)에서 코앞에 나서는 사람**이 있는 판에서 난다. 사람이 있는 판 48개를 고르게 뽑아 0.5초 · 1.7초 늦게 보는
      사람을 견주면, 몇 판에서 늦게 보는 쪽이 더 늦게 밟고(위반이 나고) 합도 크다. 위험도 모델이 배운 것이 바로 이 차이다.
    */
    const withPeds = scenarioLibrary().filter((e) => e.tags.a !== 'none' || e.tags.c !== 'none');
    const sample = withPeds.filter((_, i) => i % 250 === 0).slice(0, 48);
    const rule = challengeRule(5);
    let slower = 0;
    let quickSum = 0;
    let slowSum = 0;
    for (const e of sample) {
      const opts = { pace: rule.pace, stopZone: rule.stopZone, trace: false, telemetry: true } as const;
      const quick = playScenario(e.spec, { persona: 'human', reaction: 0.5, ...opts }).result.features!;
      const slow = playScenario(e.spec, { persona: 'human', reaction: 1.7, ...opts }).result.features!;
      quickSum += quick.reactMax ?? 0;
      slowSum += slow.reactMax ?? 0;
      if ((slow.reactMax ?? 0) > (quick.reactMax ?? 0)) slower += 1;
    }
    expect(sample.length).toBe(48);
    expect(slower).toBeGreaterThanOrEqual(3);
    expect(slowSum).toBeGreaterThan(quickSum);
  });

  it('진입로 보호구역 판 — S 횡단보도의 값도 찍힌다', () => {
    const f = play('M10266', 'careful').result.features!;
    expect(f.stopS).not.toBeNull();
    expect(f.holdS).toBeGreaterThan(0);
  });
});

describe('위험도 모델', () => {
  it('학습된 모델이 실려 있고 0~1 을 낸다', () => {
    expect(RISK_MODEL.meta.trained).toBe(true);
    const f = play('L00091', 'careful').result.features!;
    const r = riskOf(f);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  it('보행자를 안 보는 운전자의 판은 위험하고, 늦게 반응한 판은 빨리 반응한 판보다 위험하다', () => {
    const blind = play('L00091', 'pedBlind').result.features!;
    expect(blind.viol).toBeGreaterThan(0);
    const careful = play('L00091', 'careful').result.features!;
    expect(riskOf(blind)).toBeGreaterThan(riskOf(careful));
    const fast = play('L00091', 'human', 0.5).result.features!;
    const slow = play('L00091', 'human', 1.7).result.features!;
    expect(riskOf(slow)).toBeGreaterThanOrEqual(riskOf(fast));
  });
});

describe('위험했던 순간 · 반사실', () => {
  const base: RunFeatures = {
    brakeA: 8, stopA: 1.5, holdA: 1.2, spdA30: 28, minA: 0, crossA: 12, brakeS: null, stopS: null, holdS: 0, crossS: null,
    inter: 15, crossC: 14, stopC: true, peds: 1, react: 1.9, reactMax: 1.9, gap: 6, ttc: 1.1, passIntent: 0,
    intentD: 14, intentV: 24, sigDist: 35, decel: 3, turn: 2, redAt30: false, elapsed: 30, viol: 0, fail: false,
  };
  it('늦은 반응과 짧은 시간 여유를 말한다', () => {
    const notes = riskNotes(base);
    expect(notes.some((n) => n.includes('1.9초'))).toBe(true);
    expect(notes.some((n) => n.includes('시간 여유'))).toBe(true);
    expect(riskNotes({ ...base, react: 0.4, reactMax: 0.4, ttc: 3 })).toEqual([]);
  });
  it('보행자 위반의 반사실은 이 판의 거리 · 속도로 "몇 초 안에 제동했으면" 을 센다', () => {
    const text = counterfactual('PEDESTRIAN_BLOCKED', { ...base, viol: 1 });
    expect(text).toContain('14m 앞');
    expect(text).toContain('초');
    expect(counterfactual('RED_NO_STOP', base)).toContain('30m 앞');
    expect(counterfactual('WIDE_TURN', base)).toBeNull();
  });
  it('모델 요약 — 시험한 개념의 숙달 변화와 위험 여부를 한 벌로 묶는다', () => {
    const r = play('L00091', 'careful');
    const tested = habitsTestedBy(spec('L00091'));
    const after = { PEDESTRIAN_BLOCKED: { p: 0.73, n: 1, ok: 1, miss: 0, last: 1 } };
    const step = modelStep({}, after, tested, r.result);
    expect(step.measured).toBe(true);
    expect(step.skills.find((s) => s.code === 'PEDESTRIAN_BLOCKED')?.after).toBeCloseTo(0.73, 5);
    expect(step.counterfactuals).toEqual([]);
  });
});
