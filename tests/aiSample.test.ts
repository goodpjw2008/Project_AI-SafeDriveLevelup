import { describe, expect, it } from 'vitest';
import { seededRandom, stratifiedSample } from '../src/ai/sample';
import { scenarioLibrary } from '../src/scenarios/library';

/*
  **학습 표본이 라이브러리를 대표하는가** — 처음의 '18판마다 하나' 는 id 의 자릿수 주기와 맞물려 밤 · 비 판을 한 판도
  뽑지 못했다. 층화 무작위 표본은 축마다 라이브러리와 같은 비율이어야 하고, 같은 씨앗이면 같은 표본이어야 한다.
*/
describe('학습 표본', () => {
  const lib = scenarioLibrary();
  const sample = stratifiedSample(lib, { share: 1 / 18, min: 40 });
  const share = (arr: readonly (typeof lib)[number][], f: (e: (typeof lib)[number]) => string, k: string) =>
    arr.filter((e) => f(e) === k).length / arr.length;

  it('축마다 라이브러리와 같은 비율이다 — 환경 · 정체 · 신호 · 사람 (±5%p)', () => {
    for (const [f, keys] of [
      [(e: (typeof lib)[number]) => e.tags.env, ['day', 'night', 'rain']],
      [(e: (typeof lib)[number]) => e.tags.jam, ['none', 'jam']],
      [(e: (typeof lib)[number]) => e.tags.signal, ['green', 'red', 'arrowRed', 'arrowGreen']],
      [(e: (typeof lib)[number]) => e.tags.lead, ['none', 'lawful', 'rolling', 'straight']],
    ] as const) {
      for (const k of keys) expect(Math.abs(share(sample, f, k) - share(lib, f, k)), k).toBeLessThan(0.05);
    }
    expect(sample.some((e) => e.tags.env === 'night')).toBe(true);
    expect(sample.some((e) => e.tags.env === 'rain')).toBe(true);
  });

  it('레벨마다 비율대로 뽑되 작은 레벨도 최소 40판이다', () => {
    for (let l = 1; l <= 10; l++) {
      const n = sample.filter((e) => e.level === l).length;
      const pool = lib.filter((e) => e.level === l).length;
      expect(n).toBeGreaterThanOrEqual(Math.min(pool, 40));
      expect(n).toBeLessThanOrEqual(Math.max(40, Math.round(pool / 18) + 1));
    }
  });

  it('같은 씨앗이면 같은 표본, 다른 씨앗이면 다르다', () => {
    const a = stratifiedSample(lib, { seed: 1 }).map((e) => e.spec.id);
    const b = stratifiedSample(lib, { seed: 1 }).map((e) => e.spec.id);
    const c = stratifiedSample(lib, { seed: 2 }).map((e) => e.spec.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const r = seededRandom(7);
    expect(r()).not.toBe(r());
  });
});
