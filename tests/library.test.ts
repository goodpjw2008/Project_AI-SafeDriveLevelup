/**
 * **시나리오 라이브러리 — 무엇이 실려 있는가** (scenarios/library.ts).
 *
 * 전부 검증을 통과하는지는 tests/library.validate.*.test.ts 가 본다 (넷으로 나눠 동시에 돈다).
 * 여기서는 라이브러리의 **모양**을 본다 — 판 수, id, 축의 값이 모두 실렸는지, 제안한 경우의 수
 * (보호구역 × 첫/두번째 횡단보도 신호기, 앞차 있음/없음 …)가 빠짐없이 있는지.
 */

import { describe, expect, it } from 'vitest';

import {
  AXES,
  LIBRARY_ID_BASE,
  combinationAllowed,
  inLibrary,
  demoCourses,
  habitsTestedBy,
  libraryEntry,
  libraryId,
  scenarioLibrary,
  type LibraryTags,
  LEVEL_SHARE,
  conceptStage,
  layersOf,
  levelGuide,
  L1_EXCLUDES,
  zoneKindOf,
} from '../src/scenarios/library';
import { GENERATED_ID_BASE, SCENARIOS } from '../src/scenarios/scenarios';
import { challengeRule } from '../src/scenarios/challenge';
import { XP_PER_CLEAN_RUN, xpToNext, type Difficulty } from '../src/scenarios/curriculum';

const lib = scenarioLibrary();
const base: LibraryTags = {
  signal: 'green',
  zone: 'no',
  sigA: 'yes',
  sigC: 'yes',
  a: 'none',
  c: 'none',
  kind: 'adult',
  approach: 'none',
  lead: 'none',
  pressure: 'calm',
  env: 'day',
  jam: 'none',
};
const t = (over: Partial<LibraryTags>): LibraryTags => ({ ...base, ...over });

describe('시나리오 라이브러리', () => {
  it('판이 충분히 많다 — AI 가 고를 거리가 있어야 한다', () => {
    expect(lib.length).toBeGreaterThanOrEqual(6000);
  });

  it('id 와 제목이 모두 다르고, 손으로 쓴 판 · AI 판과 번호가 겹치지 않는다', () => {
    const ids = lib.map((e) => e.spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(lib.map((e) => e.spec.title)).size).toBe(lib.length);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(LIBRARY_ID_BASE);
    expect(LIBRARY_ID_BASE).toBeGreaterThan(GENERATED_ID_BASE);
    expect(SCENARIOS.every((s) => s.id < GENERATED_ID_BASE)).toBe(true);
  });

  /*
    **id 는 조합에서 계산되고, 주행 기록이 id 로 묶인다.** 축 배열의 순서를 바꾸면 이미
    쌓인 기록이 다른 판의 것이 된다 — 값은 끝에만 붙여야 한다.
  */
  it('id 가 바뀌지 않는다 — 기록이 id 로 묶여 있다', () => {
    expect(libraryId(base)).toBe(LIBRARY_ID_BASE);
    // 자리 순서: 신호 · 보호구역 · A신호 · C신호 · A보행자 · C보행자 · 종류 · 진입로 · 앞차 · 재촉 · 환경 · 정체
    expect(libraryId(t({ signal: 'red', zone: 'yes', sigC: 'no', c: 'jaywalk', lead: 'lawful', env: 'night' }))).toBe(
      LIBRARY_ID_BASE + 110_103_001_010,
    );
  });

  it('id 로 다시 찾을 수 있다', () => {
    for (const e of lib.slice(0, 50)) expect(libraryEntry(e.spec.id)).toBe(e);
    expect(libraryEntry(1)).toBeUndefined();
  });

  it('축의 모든 값이 실제로 실려 있다', () => {
    for (const [k, vals] of Object.entries(AXES)) {
      for (const v of vals) expect(lib.some((e) => (e.tags as unknown as Record<string, string>)[k] === v), `${k}=${v}`).toBe(true);
    }
  });

  /*
    **어린이보호구역의 네 경우** — 첫 횡단보도 / 우회전 후 횡단보도 × 신호 있음 / 없음.
    (둘 다 신호가 없는 교차로는 두지 않는다 — 신호기 없는 횡단보도는 한 판에 하나)
  */
  it('보호구역에서 첫 · 두번째 횡단보도의 신호 유무가 모두 있다', () => {
    const inZone = lib.filter((e) => e.tags.zone === 'yes');
    const has = (sigA: string, sigC: string) => inZone.some((e) => e.tags.sigA === sigA && e.tags.sigC === sigC);
    expect(has('yes', 'yes'), '둘 다 신호 있음').toBe(true);
    expect(has('no', 'yes'), '첫 횡단보도 신호 없음').toBe(true);
    expect(has('yes', 'no'), '두번째 횡단보도 신호 없음').toBe(true);
    // 신호기 없는 첫 횡단보도에 건너려는 사람 · 건너는 사람이 모두 있다
    expect(inZone.some((e) => e.tags.sigA === 'no' && e.tags.a === 'waiting')).toBe(true);
    expect(inZone.some((e) => e.tags.sigA === 'no' && e.tags.a === 'crossing')).toBe(true);
    // 신호기 없는 첫 횡단보도는 판도 신호기를 달지 않는다
    for (const e of inZone.filter((x) => x.tags.sigA === 'no')) expect(e.spec.pedSignalInstalled.A).toBe(false);
  });

  it('고쳐야 할 습관마다 그것을 시험하는 판이 있다', () => {
    for (const code of [
      'RED_NO_STOP',
      'RIGHT_ARROW_RED',
      'PEDESTRIAN_BLOCKED',
      'SCHOOL_ZONE_NO_STOP',
      'SCHOOL_ZONE_RED',
      'OVER_STOP_LINE',
      'BLOCKING_INTERSECTION',
      'NO_SLOW_DOWN',
    ] as const) {
      expect(lib.some((e) => e.targets.includes(code)), code).toBe(true);
    }
  });

  /*
    **같은 상황을 앞차가 있을 때와 없을 때 모두 겪어 봐야 한다.** 예외는 규칙으로 뺀 것뿐이다 —
    우회전 신호등 + 진입로 보호구역, 양쪽 횡단보도에 모두 사람이 있을 때.
  */
  it('앞차 없는 상황마다 앞차 있는 판도 있다 (규칙으로 뺀 경우 말고)', () => {
    const key = (x: LibraryTags) => AXES && Object.entries(x).filter(([k]) => k !== 'lead').map(([, v]) => v).join('/');
    const withLead = new Set(lib.filter((e) => e.tags.lead !== 'none').map((e) => key(e.tags)));
    const unpaired = lib.filter(
      (e) => e.tags.lead === 'none' && !withLead.has(key(e.tags)) && inLibrary({ ...e.tags, lead: 'lawful' }),
    );
    expect(unpaired.map((e) => e.spec.title)).toEqual([]);
  });

  it('뒤차 재촉은 판에 그대로 실린다', () => {
    const honk = lib.find((e) => e.tags.pressure === 'honk')!;
    const calm = lib.find((e) => e.tags.pressure === 'calm')!;
    expect(honk.spec.rearHonk).toBe(true);
    expect(calm.spec.rearHonk).toBe(false);
  });

  it('성립하지 않는 조합은 싣지 않는다', () => {
    // 신호기가 있는 첫 횡단보도는 정면 녹색에 보행 적색이다 — '건너는 중' 이 없다
    expect(combinationAllowed(t({ a: 'crossing' }))).toBe(false);
    // 신호기가 없으면 '무단횡단' 이라는 말이 없다
    expect(combinationAllowed(t({ zone: 'yes', sigA: 'no', a: 'jaywalk' }))).toBe(false);
    // 우회전 신호등은 신호기 없는 횡단보도와 함께 설 수 없다
    expect(combinationAllowed(t({ signal: 'arrowRed', zone: 'yes', sigC: 'no' }))).toBe(false);
    // 직진 대기 앞차는 정면 적색에서만 뜻이 있다
    expect(combinationAllowed(t({ lead: 'straight' }))).toBe(false);
    // 보행자가 없으면 종류가 뜻이 없다
    expect(combinationAllowed(t({ kind: 'elder' }))).toBe(false);
  });
});

describe('이 판이 무엇을 시험했는가 — habitsTestedBy', () => {
  it('라이브러리 판은 태그대로, 우회전 기본 습관은 늘 시험한다', () => {
    const red = lib.find((e) => e.tags.signal === 'red' && e.tags.a === 'none' && e.tags.c === 'none')!;
    const green = lib.find((e) => e.tags.signal === 'green' && e.tags.a === 'none' && e.tags.c === 'none')!;
    expect(habitsTestedBy(red.spec).has('RED_NO_STOP')).toBe(true);
    expect(habitsTestedBy(green.spec).has('RED_NO_STOP'), '녹색 판은 적색 습관을 시험하지 않는다').toBe(false);
    expect(habitsTestedBy(green.spec).has('NO_TURN_SIGNAL')).toBe(true);
  });

  it('손으로 쓴 판도 같은 기준으로 읽는다', () => {
    const byId = (id: number) => habitsTestedBy(SCENARIOS.find((s) => s.id === id)!);
    expect(byId(2).has('RED_NO_STOP'), '02 정면 적색').toBe(true);
    expect(byId(1).has('RED_NO_STOP'), '01 정면 녹색').toBe(false);
    expect(byId(4).has('PEDESTRIAN_BLOCKED'), '04 보행자').toBe(true);
    expect(byId(6).has('RIGHT_ARROW_RED'), '06 우회전 신호 적색').toBe(true);
    expect(byId(7).has('SCHOOL_ZONE_NO_STOP'), '07 보호구역 무신호').toBe(true);
  });
});

describe('AI 자율 주행 시범 코스', () => {
  it('대표 코스가 모두 라이브러리에 있고, 가르치는 판단을 두루 담는다', () => {
    const demo = demoCourses();
    expect(demo.length).toBeGreaterThanOrEqual(8);
    expect(new Set(demo.map((e) => e.spec.id)).size).toBe(demo.length);
    const all = new Set(demo.flatMap((e) => e.targets));
    for (const code of ['RED_NO_STOP', 'RIGHT_ARROW_RED', 'PEDESTRIAN_BLOCKED', 'SCHOOL_ZONE_NO_STOP', 'BLOCKING_INTERSECTION'] as const) {
      expect(all.has(code), code).toBe(true);
    }
    expect(demo.every((e) => e.tags.env === 'day' && e.tags.pressure === 'calm')).toBe(true);
  });
});

/*
  **레벨마다 판 수는 오래 머무는 레벨일수록 많다** (library.ts 의 LEVEL_SHARE).
  사용자가 "분포가 L9 · L10 에 너무 몰렸다" 고 짚었고(예전에는 85%), 레벨업을 경험치로 바꾸며 "각 레벨의 시나리오 개수는
  거기에 맞게" 라고 했다. 곡선을 올린 뒤로는 딱 비례하지 않는다 — 비례시키면 보호구역이 L1 으로 넘어와 개념 순서가
  무너진다. 대신 **머무는 동안 같은 판을 되풀이하지 않을 만큼 많은지**를 가장 어려운 난이도로 잰다.
*/
describe('레벨별 판 수 — 경험치 곡선을 따른다', () => {
  it('레벨마다 정원만큼 — 오래 머무는 레벨일수록 많다', () => {
    const lib = scenarioLibrary();
    const count = (l: number) => lib.filter((e) => e.level === l).length;
    const total = Object.values(LEVEL_SHARE).reduce((n, x) => n + x, 0);
    // L1 은 정원에서 야간 판을 뺀 만큼이고(L1_EXCLUDES), 덜어 낸 만큼을 L2 ~ L10 이 정원 비율대로 나눠 받는다
    expect(count(1)).toBeLessThan((lib.length * LEVEL_SHARE[1]) / total);
    const upperShare = total - LEVEL_SHARE[1];
    for (let l = 2; l <= 10; l++) {
      const want = ((lib.length - count(1)) * LEVEL_SHARE[l as 1]) / upperShare;
      // 반올림 나머지는 L10 이 받는다
      expect(Math.abs(count(l) - want), `L${l}`).toBeLessThanOrEqual(5);
    }
    expect((count(9) + count(10)) / lib.length, 'L9 · L10 이 절반을 넘지 않는다').toBeLessThan(0.5);
  });

  it('머무는 동안 같은 판을 되풀이하지 않을 만큼 많다 — 어려움 난이도로 재도 한 판에 30판 이상', () => {
    const lib = scenarioLibrary();
    const hardest = challengeRule(5);
    for (let l = 1; l <= 10; l++) {
      const runs = Math.ceil(xpToNext(l as Difficulty, hardest) / XP_PER_CLEAN_RUN);
      const maps = lib.filter((e) => e.level === l).length;
      expect(maps / runs, `L${l}: ${maps}판 / ${runs}판 머묾`).toBeGreaterThanOrEqual(30);
    }
  });

  it('쉬운 판이 낮은 레벨에 선다 — 개념은 차례로 열린다', () => {
    const at = (key: string) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((l) => levelGuide(l).includes(key))!;
    expect(at('arrow')).toBeLessThan(at('zone'));
    // 신호기 없는 보호구역은 보호구역과 함께 연다 — 이 게임의 핵심이라 뒤로 미루지 않는다 (conceptStage)
    expect(at('noSignalZone')).toBe(at('zone'));
    expect(at('noSignalZone')).toBeLessThan(at('lead'));
    expect(at('lead')).toBeLessThanOrEqual(at('rolling'));
    expect(at('lead')).toBeLessThanOrEqual(at('several'));
    /*
      같은 레벨 안의 판보다 한 레벨 위의 판이 (개념 · 조건으로 잰) 더 어렵거나 같다 — **같은 환경끼리.** 야간 판은 따로
      줄 세워 레벨마다 같은 비율로 나눠 담으므로(assignLevels), 야간 판끼리 · 나머지 판끼리 잰다.
    */
    const lib = scenarioLibrary();
    const score = (e: (typeof lib)[number]) => conceptStage(e.tags) * 2 + layersOf(e.tags);
    for (const night of [false, true]) {
      const pool = lib.filter((e) => L1_EXCLUDES(e.tags) === night);
      const levels = [...new Set(pool.map((e) => e.level))].sort((a, b) => a - b);
      for (let i = 0; i + 1 < levels.length; i++) {
        const max = Math.max(...pool.filter((e) => e.level === levels[i]).map(score));
        const min = Math.min(...pool.filter((e) => e.level === levels[i + 1]).map(score));
        expect(min, `${night ? '야간' : '그 밖'} L${levels[i]} → L${levels[i + 1]}`).toBeGreaterThanOrEqual(max);
      }
    }
  });

  /*
    **L1 에는 야간 판이 없다** — 사용자가 "레벨 1 에는 야간 운전은 나오지 않게 해 줘" 라고 했다. 빈자리를 다음 차례의
    판으로 채우지 않고 야간 판만 L2 로 옮긴다(채웠더니 보호구역 판이 끌려와 보호구역이 L1 에서 열렸다).
  */
  it('L1 에는 야간 판이 없다 — 비는 둔다, 보호구역은 여전히 L2 에서 연다', () => {
    const lib = scenarioLibrary();
    const l1 = lib.filter((e) => e.level === 1);
    expect(l1.some((e) => e.tags.env === 'night')).toBe(false);
    expect(l1.some((e) => e.tags.env === 'rain'), '비는 둔다').toBe(true);
    expect(l1.length).toBeGreaterThan(100);
    expect(levelGuide(1)).not.toContain('zone');
    expect(levelGuide(2)).toContain('zone');
  });

  /*
    **야간 판은 L2 ~ L10 에 고르게** — 사용자가 "야간 판을 레벨 2 ~ 레벨 10 까지 고르게 분포시켜 줘" 라고 했다. 레벨마다
    판 수가 다르므로(L2 220 · L10 2,201) 개수가 아니라 **비율**을 같게 둔다. 한 줄로 세우던 때는 23%(L7) ~ 44%(L10) 였다.
  */
  it('L2 ~ L10 의 야간 비율이 모두 같다 (1%p 안)', () => {
    const lib = scenarioLibrary();
    const upper = lib.filter((e) => e.level >= 2);
    const overall = upper.filter((e) => e.tags.env === 'night').length / upper.length;
    for (let l = 2; l <= 10; l++) {
      const es = lib.filter((e) => e.level === l);
      const ratio = es.filter((e) => e.tags.env === 'night').length / es.length;
      expect(Math.abs(ratio - overall), `L${l} ${(ratio * 100).toFixed(1)}%`).toBeLessThan(0.01);
    }
  });

  /*
    **보호구역 판 중 신호기 없는 판이 레벨마다 고르게** — 사용자가 "각 레벨별로 어린이보호구역에 신호없는 횡단보도가
    고르게 나오게" 해 달라고 했다. 신호기 없는 쪽을 한 단계 늦은 개념으로 줄 세우던 때는 L2 3% · L3 18% · L5 85% 였다.
    보호구역이 열리는 L2 부터 본다 (L1 의 보호구역 판은 몇 개뿐이라 비율이 뜻이 없다).
  */
  it('보호구역 판 중 신호기 없는 판의 비율이 L2 ~ L10 에서 고르다', () => {
    const lib = scenarioLibrary();
    const ratios: number[] = [];
    for (let l = 2; l <= 10; l++) {
      const zone = lib.filter((e) => e.level === l && zoneKindOf(e.tags) !== 'none');
      const ratio = zone.filter((e) => zoneKindOf(e.tags) === 'noSignal').length / zone.length;
      expect(zone.length, `L${l} 보호구역 판`).toBeGreaterThan(20);
      expect(ratio, `L${l} 무신호 ${(ratio * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(0.45);
      ratios.push(ratio);
    }
    expect(Math.max(...ratios) - Math.min(...ratios), '가장 높은 레벨과 낮은 레벨의 차').toBeLessThan(0.12);
  });
});

/**
 * **보행자가 어느 보도에서 오는가.**
 *
 * 사용자가 두 번 짚었다 — "첫번째 횡단보도에서는 우측에만 사람이 있고 두번째 횡단보도에도 우측에만".
 * 재 보니 A 는 보행자가 있는 판의 **90%가 차량쪽 사람을 반드시** 가졌고(4,292/4,770), C 도 78.5%였다.
 * 대부분 `from: 'right'` 하드코딩 탓이었다 (판 번호로 가르는 `side(k)` 는 실측 47~52% 로 멀쩡했다).
 *
 * **사람 수 비율만으로는 사용자가 본 것을 못 잰다.** 사용자가 본 것은 "이 판의 그 횡단보도에 사람이
 * 전부 우측에 있다" 는 **장면**이라, 판 단위 비율을 함께 본다.
 */
describe('보행자가 오는 쪽', () => {
  const lib = scenarioLibrary();
  const at = (id: 'A' | 'C' | 'S') => {
    let left = 0;
    let right = 0;
    let onlyRight = 0;
    let maps = 0;
    for (const e of lib) {
      const ps = e.spec.pedestrians.filter((p) => p.crosswalk === id);
      if (!ps.length) continue;
      maps++;
      for (const p of ps) (p.from === 'left' ? (left += 1) : (right += 1));
      if (!ps.some((p) => p.from === 'left')) onlyRight++;
    }
    return { left, right, maps, onlyRight, share: right / (left + right), only: onlyRight / maps };
  };

  it('첫 횡단보도 — 사람 수도, 사람이 한쪽에만 선 판도 한쪽으로 쏠리지 않는다', () => {
    const a = at('A');
    expect(a.share, `차량쪽 ${(a.share * 100).toFixed(1)}%`).toBeGreaterThan(0.4);
    expect(a.share, `차량쪽 ${(a.share * 100).toFixed(1)}%`).toBeLessThan(0.6);
    expect(a.only, `사람이 전부 차량쪽인 판 ${(a.only * 100).toFixed(0)}%`).toBeLessThan(0.55);
  });

  it('우회전 후 횡단보도 — 같은 두 자로 본다', () => {
    const c = at('C');
    // '우회전 중 뛰어드는 사람' 은 가까운 쪽이어야 장면이 되므로(library.ts) 완전한 반반은 될 수 없다
    expect(c.share, `차량쪽 ${(c.share * 100).toFixed(1)}%`).toBeLessThan(0.62);
    expect(c.only, `사람이 전부 차량쪽인 판 ${(c.only * 100).toFixed(0)}%`).toBeLessThan(0.55);
  });

  it('앞차 판도 같이 다양하다 — behindLead 가 오는 쪽을 물려받는다', () => {
    const lead = lib.filter((e) => e.tags.lead !== 'none' && e.spec.pedestrians.length);
    const left = lead.filter((e) => e.spec.pedestrians.some((p) => p.from === 'left')).length;
    expect(left / lead.length, '앞차 판 중 반대편 사람이 있는 판').toBeGreaterThan(0.3);
  });
});

/**
 * **진입로 어린이보호구역 횡단보도(S)에도 사람이 선다.**
 *
 * 이 횡단보도는 8,958판 내내 **한 명도 없었다** — 3,264판이 전부 "사람이 없어도 일시정지"(제27조 제7항)만
 * 시험하고 끝났다. 검증기가 S 보행자를 아예 거부하고 있었던 것도 한몫했다 (validate.ts 의 CROSSWALKS).
 */
describe('진입로 보호구역 횡단보도의 보행자', () => {
  const lib = scenarioLibrary();
  const withS = lib.filter((e) => e.spec.pedestrians.some((p) => p.crosswalk === 'S'));

  it('무신호 진입로 판 일부에 어린이가 선다', () => {
    expect(withS.length, `${withS.length}판`).toBeGreaterThan(100);
    for (const e of withS) {
      expect(e.tags.approach, e.spec.title).toBe('noSignal');
      expect(e.spec.pedestrians.filter((p) => p.crosswalk === 'S')[0].kind).toBe('child');
    }
  });

  it('그 판은 보행자 위반을 시험한다고 적는다 — 아니면 "습관을 고쳤다" 가 거짓이 된다', () => {
    for (const e of withS) expect(e.targets, e.spec.title).toContain('PEDESTRIAN_BLOCKED');
  });

  it('제목이 판과 어긋나지 않는다 — 제목에도 그 아이가 있다', () => {
    for (const e of withS) expect(e.spec.title, e.spec.title).toContain('진입로 횡단보도 어린이');
  });

  it('앞차 · 우회전 신호등 판에는 두지 않는다 — 앞차가 먼저 보내 주고, 화살표는 꺼진다', () => {
    for (const e of withS) {
      expect(e.tags.lead, e.spec.title).toBe('none');
      expect(['arrowRed', 'arrowGreen'], e.spec.title).not.toContain(e.tags.signal);
    }
  });
});
