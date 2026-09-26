import { describe, expect, it } from 'vitest';
import { SIDES, inLibrary, libraryEntry, libraryId, scenarioLibrary, type LibraryEntry } from '../src/scenarios/library';
import type { ScenarioSpec } from '../src/scenarios/scenarios';

/*
  **건너는 방향 축** (사용자가 정했다, 2026-09-27: "방향(좌→우 · 우→좌 · 양방향)을 축으로 올릴지 → 꼭 필요함").
  한쪽에서만 오는 횡단보도가 있는 판마다 거울상 판이 하나 더 있고, 둘은 방향 말고는 정확히 같다.
*/
const lib = scenarioLibrary();
const flips = lib.filter((e) => e.tags.side === 'flip');
const twinOf = (e: LibraryEntry): LibraryEntry => libraryEntry(libraryId({ ...e.tags, side: 'auto' }))!;
const WALKERS = ['waiting', 'crossing', 'jaywalk', 'jaywalkWait'];

describe('건너는 방향 축 (SIDES)', () => {
  it('거울상 판은 쌍둥이와 방향만 다르다 — 환경 · 앞차 · 사람의 종류와 시각은 같다', () => {
    expect(flips.length).toBeGreaterThan(5000);
    const strip = (s: ScenarioSpec) => ({ ...s, id: 0, title: '', pedestrians: s.pedestrians.map((p) => ({ ...p, from: 'x' })) });
    for (const e of flips.filter((_, i) => i % 61 === 0)) {
      const twin = twinOf(e);
      expect(twin, String(e.spec.id)).toBeTruthy();
      expect(strip(e.spec)).toEqual(strip(twin.spec));
      // 옮긴 횡단보도는 쌍둥이에서 한쪽에서만 오던 곳이고, 거기의 사람은 **모두** 반대쪽이다
      const moved = new Set(e.spec.pedestrians.filter((p, i) => p.from !== twin.spec.pedestrians[i].from).map((p) => p.crosswalk));
      expect(moved.size, e.spec.title).toBeGreaterThan(0);
      for (const cw of moved) {
        const twinSides = new Set(twin.spec.pedestrians.filter((p) => p.crosswalk === cw).map((p) => p.from));
        expect(twinSides.size).toBe(1);
        const [side] = [...twinSides];
        for (const p of e.spec.pedestrians.filter((p) => p.crosswalk === cw)) expect(p.from).not.toBe(side);
      }
    }
  });

  it('양쪽에서 오는 횡단보도와 쪽이 설계로 박힌 사람은 뒤집지 않는다 — 그런 판만 있으면 거울상이 없다', () => {
    const only = (a: string, c: string) =>
      lib.filter((e) => e.tags.side === 'auto' && e.tags.a === a && e.tags.c === c && e.tags.approach === 'none' && e.tags.extra === 'none');
    for (const [a, c] of [['bothWays', 'none'], ['mixed', 'none'], ['none', 'group'], ['none', 'mixed'], ['none', 'late'], ['none', 'maybe'], ['none', 'none']]) {
      const es = only(a, c);
      expect(es.length, `${a}/${c}`).toBeGreaterThan(0);
      for (const e of es) expect(inLibrary({ ...e.tags, side: 'flip' }), e.spec.title).toBe(false);
    }
    // 다른 횡단보도 때문에 거울상이 생겨도 뛰어드는 사람은 가까운 쪽(오른쪽) 그대로다
    const lateFlips = flips.filter((e) => e.tags.c === 'late');
    expect(lateFlips.length).toBeGreaterThan(0);
    for (const e of lateFlips) expect(e.spec.pedestrians.find((p) => p.crosswalk === 'C' && p.speed)?.from).toBe('right');
  });

  it('한 사람 판은 두 방향을 다 겪는다 — 제목에 방향이 적힌다', () => {
    const autos = lib.filter(
      (e) => e.tags.side === 'auto' && e.tags.a === 'waiting' && e.tags.c === 'none' && e.tags.approach === 'none' && e.tags.extra === 'none' && e.tags.lead === 'none',
    );
    expect(autos.length).toBeGreaterThan(0);
    for (const e of autos) {
      const flip = libraryEntry(libraryId({ ...e.tags, side: 'flip' }));
      expect(flip, e.spec.title).toBeTruthy();
      const side = e.spec.pedestrians[0].from;
      expect(flip!.spec.pedestrians[0].from).toBe(side === 'left' ? 'right' : 'left');
      expect(e.spec.title).toContain(side === 'left' ? '첫 횡단보도 왼쪽에서' : '첫 횡단보도 오른쪽에서');
      expect(flip!.spec.title).toContain(side === 'left' ? '첫 횡단보도 오른쪽에서' : '첫 횡단보도 왼쪽에서');
    }
  });

  it('이미 있던 판의 id 는 그대로다 — 방향 축의 그대로(auto)가 0 이라 앞자리가 붙지 않는다', () => {
    expect(SIDES[0]).toBe('auto');
    for (const e of lib.filter((e) => e.tags.side === 'auto')) expect(e.spec.id).toBeLessThan(10 ** 13);
    for (const e of flips) expect(e.spec.id).toBeGreaterThanOrEqual(10 ** 13);
    // 오프라인 교육 첫 판(21000)은 방향 축 전의 판이다
    expect(libraryEntry(21000)?.tags.side).toBe('auto');
  });
});

/*
  **같은 쪽에서 한 사람 더** — "보행자 2명 · 1방향" (사용자의 변수 설계). 한 사람이 걸어서 서는 판에만 붙고, 같은 보도에서 뒤따른다.
*/
describe('같은 쪽에서 한 사람 더 (EXTRAS pair)', () => {
  it('한 사람이 걸어서 서는 판에만 붙고, 같은 보도에서 조금 뒤에 나선다', () => {
    const pairs = lib.filter((e) => e.tags.extra === 'pair');
    expect(pairs.length).toBe(1092);
    for (const e of pairs) {
      const cw = WALKERS.includes(e.tags.a) ? 'A' : 'C';
      expect(WALKERS.includes(cw === 'A' ? e.tags.a : e.tags.c)).toBe(true);
      const there = e.spec.pedestrians.filter((p) => p.crosswalk === cw && !p.bike);
      expect(there.length, e.spec.title).toBe(2);
      expect(there[0].from).toBe(there[1].from);
      expect(e.spec.title).toContain('같은 쪽에서 한 사람 더');
      expect(e.targets).toContain('PEDESTRIAN_BLOCKED');
    }
    // 걸어서 서는 사람이 없으면 붙일 자리가 없다
    expect(inLibrary({ ...pairs[0].tags, a: 'none', c: 'none' })).toBe(false);
    expect(inLibrary({ ...pairs[0].tags, a: 'bothWays', c: 'none' })).toBe(false);
  });
});
