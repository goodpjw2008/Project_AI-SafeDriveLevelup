/**
 * **어린이보호구역 전용 도로** (scenarios/zoneCourse.ts).
 *
 * 사용자가 정한 코스다 — "어린이 보호구역 연습은 사거리가 나오지 말아야 해. 사거리 없는 상황에서만
 * 어린이 보호구역 주행 연습이 되도록 전용맵을 만들어줘." 길은 **두 가지**이고(무신호·신호·신호 /
 * 신호·신호·무신호), 가운데 신호 횡단보도에 30km/h 단속 카메라가 함께 선다. 그 위에
 * **보행자 셋 — 있고 없음 · 오는 쪽 · 사람 수 — 이 변수로 얹힌다.** 여기서 확인하는 것은 셋이다.
 *
 *  1. **판이 성립하는가** — 규정대로 몰면 위반 없이 통과하고, 막 몰면 걸린다 (검증기 전수)
 *  2. **번호가 겹치지 않는가** — 이 코스는 자기 번호(50001~)를 쓴다. 겹치면 한 번호가 두 판을 가리킨다
 *  3. **직진 코스의 규칙** — 방향지시등을 묻지 않고, 적색에는 갈 수 없고, 건너편 횡단보도를 본다
 */

import { describe, expect, it } from 'vitest';
import {
  ZONE_NUMBER_BASE,
  zoneCourse,
  zoneCourseByNumber,
  zoneCourseNumber,
  zoneCourses,
  zoneEntries,
} from '../src/scenarios/zoneCourse';
import { habitsTestedBy, scenarioLibrary, libraryNumber } from '../src/scenarios/library';
import { validateScenario } from '../src/scenarios/validate';
import { playScenario } from '../src/scenarios/playSim';

const courses = zoneCourses();

describe('어린이보호구역 전용 도로', () => {
  it('판이 넉넉히 있고, 모두 사거리 없는 보호구역 도로다', () => {
    expect(courses.length).toBeGreaterThan(100);
    for (const s of courses) {
      expect(s.drive).toBe('zoneOnly');
      expect(s.isSchoolZone).toBe(true);
      // 교차로가 없으므로 교차로 신호기도 없다
      expect(s.pedSignalInstalled).toEqual({ A: false, C: false });
      expect(s.rightArrowInstalled).toBeUndefined();
      expect(s.leadCar).toBeUndefined();
      expect(s.crossTraffic).toBe(0);
      expect(s.exitBlocked).toBe(false);
    }
  });

  /* 보행자는 이 코스가 지나는 세 횡단보도에만 선다 — C(우회전 후)는 지나지 않는다 */
  it('보행자는 S · A · B 에만 있다', () => {
    for (const s of courses) {
      for (const p of s.pedestrians) expect(['S', 'A', 'B']).toContain(p.crosswalk);
    }
  });

  /*
    **사용자가 정한 길은 둘뿐이다.**

      1. 무신호 → 신호(단속 카메라) → 신호
      2. 신호 → 신호(단속 카메라) → 무신호

    둘 다 **무신호 한 곳 · 신호 두 곳**이라 모든 판이 '규칙 갈아타기' 를 묻고, 서로 뒤집힌 배치라
    **첫 곳이 어땠는지로 다음을 짐작할 수 없다.** 이 둘이 아닌 길이 한 판이라도 섞이면 그 뜻이 깨진다.
  */
  it('길은 두 가지뿐이다 — 무신호·신호·신호 / 신호·신호·무신호', () => {
    const shapes = new Map<string, number>();
    for (const s of courses) {
      const key = (['S', 'A', 'B'] as const)
        .map((at) => (s.zoneSignals?.[at] !== undefined ? '신호' : '무신호'))
        .join('·');
      shapes.set(key, (shapes.get(key) ?? 0) + 1);
    }
    expect([...shapes.keys()].sort()).toEqual(['무신호·신호·신호', '신호·신호·무신호']);
    // 두 길이 고르게 나온다 — 한쪽만 잔뜩이면 '섞인 길' 을 겪지 못한다
    for (const [shape, n] of shapes) expect(n, shape).toBeGreaterThan(courses.length / 3);
  });

  /*
    **가운데 횡단보도에는 어느 길에서든 신호등이 있다.** 30km/h 과속 단속 카메라가 그 신호 지주에
    함께 서기 때문이다 (game/Game.ts 의 buildZoneSpeedCamera) — 사용자가 사진을 주며 정한 자리다.
    신호가 없으면 카메라가 기댈 지주가 없어 홀로 서게 되고, 사진의 '신호 과속단속장비' 가 아니게 된다.
  */
  it('가운데 횡단보도에는 늘 신호등이 있다 — 단속 카메라가 함께 서는 자리다', () => {
    for (const s of courses) expect(s.zoneSignals?.A, s.title).toBeDefined();
  });

  /*
    **난이도는 보행자 두 축에서 나온다** — 사용자가 정했다: "사람의 서 있는 곳 왼쪽→오른쪽 보행,
    오른쪽→왼쪽 보행, 양방향 보행 / 사람의 숫자. 이 변수들로 난이도를 재설계해 줘."
    길은 두 가지뿐이므로, 이 둘이 한쪽으로 쏠리면 난이도 자체가 이름만 남는다.
  */
  it('건너는 방향 셋이 모두 나온다 — 건너편에서 · 차량쪽에서 · 양방향', () => {
    const side = (s: (typeof courses)[number], at: 'S' | 'A' | 'B') =>
      new Set(s.pedestrians.filter((p) => p.crosswalk === at).map((p) => p.from));
    const shapes = { l2r: 0, r2l: 0, both: 0 };
    for (const s of courses) {
      for (const at of ['S', 'A', 'B'] as const) {
        const sides = side(s, at);
        if (!sides.size) continue;
        if (sides.size === 2) shapes.both++;
        else if (sides.has('left')) shapes.l2r++;
        else shapes.r2l++;
      }
    }
    for (const [k, n] of Object.entries(shapes)) expect(n, k).toBeGreaterThan(20);
  });

  it('사람 수가 하나 · 둘 · 셋으로 갈린다', () => {
    const counts = new Map<number, number>();
    for (const s of courses) {
      for (const at of ['S', 'A', 'B'] as const) {
        const n = s.pedestrians.filter((p) => p.crosswalk === at).length;
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    for (const n of [1, 2, 3]) expect(counts.get(n) ?? 0, `${n}명`).toBeGreaterThan(10);
    // 넷 이상은 두지 않는다 — 길이 사람으로 막힌다
    expect([...counts.keys()].every((n) => n <= 3)).toBe(true);
    expect(courses.some((s) => s.pedestrians.length === 0)).toBe(true);
  });

  /*
    **같은 장면이 두 판으로 실리지 않는다.**

    한때 '둘 = 양쪽에서 하나씩' 으로 묶어 방향 축과 겹쳐 두었더니, 둘인 판에서 방향이 뜻을 잃어
    **48판(24쌍)이 완전히 같은 장면**이었다. 축이 겹치면 판 수만 늘고 배우는 것은 늘지 않는다.
  */
  it('완전히 같은 장면이 두 번 실리지 않는다', () => {
    const seen = new Map<string, string>();
    for (const s of courses) {
      const key = JSON.stringify([
        s.zoneSignals,
        s.pedestrians
          .map(
            (p) =>
              `${p.crosswalk}/${p.from}/${p.kind}/${p.at}/${p.startWithin}/${p.obeysSignal ?? true}/${p.bike ?? ''}`,
          )
          .sort(),
      ]);
      expect(seen.get(key), `${seen.get(key)} 와 같은 장면`).toBeUndefined();
      seen.set(key, s.title);
    }
  });

  /*
    **난이도가 레벨을 따라 실제로 올라간다.** 조건 점수가 촘촘하지 않으면 레벨이 두 칸 올라도
    같은 판이 나온다 — 예전에는 L3 · L4 · L5 가 전부 같은 4점이었다.
  */
  it('레벨이 오르면 어려워진다 — 레벨별 평균 조건 점수가 뒤로 가지 않는다', () => {
    const avg = (L: number) => {
      const g = zoneEntries().filter((e) => e.level === L);
      return g.reduce((n, e) => n + e.cost, 0) / g.length;
    };
    for (const L of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(avg(L), `L${L - 1} → L${L}`).toBeGreaterThanOrEqual(avg(L - 1));
    }
    // 가장 쉬운 판과 가장 어려운 판이 충분히 벌어져 있다
    const costs = zoneEntries().map((e) => e.cost);
    expect(Math.max(...costs) - Math.min(...costs)).toBeGreaterThanOrEqual(9);
  });

  it('번호가 우회전 라이브러리와 겹치지 않는다', () => {
    const maxLibrary = Math.max(...scenarioLibrary().map((e) => libraryNumber(e.spec.id) ?? 0));
    expect(maxLibrary).toBeLessThan(ZONE_NUMBER_BASE);
    expect(zoneCourseNumber(courses[0].id)).toBe(ZONE_NUMBER_BASE);
    expect(zoneCourseByNumber(ZONE_NUMBER_BASE)?.id).toBe(courses[0].id);
    // 라이브러리 번호로는 이 코스가 잡히지 않는다
    expect(zoneCourseByNumber(1)).toBeUndefined();
    expect(zoneCourse(1)).toBeUndefined();
  });

  it('번호와 id 가 한 줄로 이어진다', () => {
    for (let i = 0; i < courses.length; i += 37) {
      const no = ZONE_NUMBER_BASE + i;
      expect(zoneCourseByNumber(no)?.id).toBe(courses[i].id);
      expect(zoneCourseNumber(courses[i].id)).toBe(no);
    }
  });
});

/*
  **이 코스가 시험하는 습관.**

  직진 코스에는 우회전에만 있는 습관(방향지시등 · 대회전 · 교차로 서행)이 **없다.** 그것을 시험한다고
  적어 두면, 그 습관이 보호구역 판 몇 번으로 '고쳐졌다' 가 된다 (scenarios/library.ts 의 habitsTestedBy).
*/
describe('이 코스가 시험하는 습관', () => {
  it('우회전 습관은 시험하지 않는다', () => {
    for (const spec of courses) {
      const tested = habitsTestedBy(spec);
      for (const code of ['NO_TURN_SIGNAL', 'WIDE_TURN', 'NO_SLOW_DOWN'] as const) {
        expect(tested.has(code), `${spec.title} → ${code}`).toBe(false);
      }
    }
  });

  it('보호구역 일시정지 · 적색 대기 · 보행자 양보를 시험한다', () => {
    const all = courses.map((s) => habitsTestedBy(s));
    expect(all.some((t) => t.has('SCHOOL_ZONE_NO_STOP'))).toBe(true);
    expect(all.some((t) => t.has('SCHOOL_ZONE_RED'))).toBe(true);
    expect(all.some((t) => t.has('PEDESTRIAN_BLOCKED'))).toBe(true);
    // 교차로가 없으니 '적색 직진' 은 이 코스에서 일어날 수 없다
    expect(all.some((t) => t.has('STRAIGHT_RED'))).toBe(false);
    // 사람이 없는 판은 보행자 양보를 시험하지 않는다 — 그 판의 배울 것은 '사람이 없어도 선다' 다
    const empty = courses.find((s) => s.pedestrians.length === 0)!;
    expect(habitsTestedBy(empty).has('PEDESTRIAN_BLOCKED')).toBe(false);
  });

  /*
    **신호기가 있는 횡단보도에는 무단횡단자만 둔다** (플레이테스트가 잡았다).

    직진 코스에서 내가 지나는 횡단보도의 보행신호는 **내 정면이 적색일 때만 녹색**이다 — 신호를 지키는
    사람은 내가 서 있는 동안 건너고 내가 갈 때는 연석에 서 있다. '건너는 중' 을 두었더니 건너편에 아이를
    세워 두고도 그 아이가 끝내 나서지 않는, 아무 일도 일어나지 않는 판이 됐다 (50106번).
  */
  it('신호기가 있는 횡단보도에는 무단횡단자만 둔다', () => {
    for (const s of courses) {
      for (const p of s.pedestrians) {
        const signalled = s.zoneSignals?.[p.crosswalk as 'S' | 'A' | 'B'] !== undefined;
        if (signalled) expect(p.obeysSignal, `${s.title} · ${p.crosswalk}`).toBe(false);
      }
    }
  });

  /* 레벨은 학습자와 함께 쓰는 하나뿐이다 — 이 코스도 레벨 1~10 에 고루 있어야 한다 */
  it('레벨마다 판이 있다', () => {
    const per = new Map<number, number>();
    for (const e of zoneEntries()) per.set(e.level, (per.get(e.level) ?? 0) + 1);
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(per.get(level) ?? 0, `L${level}`).toBeGreaterThan(2);
    }
  });
});

/*
  **전수 검증.** 라이브러리와 같은 잣대로 본다 — 규정대로 몰면 위반 없이 통과하고(모범 운전자),
  막 몰면 걸리고(가르칠 것이 있다), 제한시간 안에 끝난다.

  직진 코스에는 우회전 코스에 없는 함정이 있었다: 판정이 교차로에 들어서기만 하면 대회전과
  방향지시등을 채점해, **규정대로 몬 주행이 전부 위반**이 됐다 (rules/lawRules.ts 의 DriveMode).
*/
/*
  **검증은 한 번만 돌린다.** 판마다 모범 운전자 · 막 모는 운전자를 다 태우는 일이라 한 판에 0.8초가
  든다 — 두 검사가 각자 돌리면 그만큼 두 배가 된다 (실제로 이 파일 하나가 5분이었다).
*/
const validated = courses.map((spec) => ({ spec, r: validateScenario(spec) }));

describe('어린이보호구역 전용 도로 전수 검증', () => {
  /*
    **AI 자율 주행이 전 판을 규정대로 몰 수 있어야 한다** — 오프라인 교육에서 이 코스를 시범으로
    보여 주기 때문이다 (game/AutoDriver.ts). 한 판이라도 위반이 나오면 "규정대로 모는 시범" 이 거짓말이 된다.

    처음 돌렸을 때 362판이 모두 걸렸다: 판정이 직진에도 대회전 · 방향지시등을 채점했고(playSim 이 코스를
    넘기지 않았다), 황색 딜레마 구간을 적색 직진으로 잡았다. 그 둘을 고치고 나서야 0판이 됐다.
  */
  it('AI 자율 주행이 모든 판을 위반 없이 완주한다', () => {
    const bad: string[] = [];
    for (const spec of courses) {
      const r = playScenario(spec, { persona: 'careful' }).result;
      if (r.violations.length || r.failReason) {
        bad.push(`${spec.title} — ${r.violations.map((v) => v.code).join(',') || r.failReason}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  }, 180_000);

  /*
    **보행자는 역할이 있다** — 보행자를 보지 않는 운전자가 걸려야 한다. 걸리지 않으면 그 사람은
    서 있는 그림이고, 학습자는 "보행자는 신경 안 써도 된다" 를 배운다.

    처음에는 39판이 이 검사에 걸렸다. 까닭은 **나서는 때**였다 — 적색 판에서는 누구나 정지선에 서 있어
    그 사이에 다 건너 버렸고, 무신호 보호구역 횡단보도에서도 의무 정지 동안 건너기를 마쳤다.
    내가 가려는 순간에 나서도록 시각을 맞춰 고쳤다 (scenarios/zoneCourse.ts 의 `at`).
  */
  it('보행자가 있는 판은 보행자를 보지 않으면 걸린다', () => {
    const bad: string[] = [];
    for (const spec of courses) {
      if (!spec.pedestrians.length) continue;
      const codes = playScenario(spec, { persona: 'pedBlind' }).result.violations.map((v) => v.code);
      /*
        **타고 건너는 자전거는 보행자가 아니다** — 그 판에서 걸리는 코드는 `BIKE_BLOCKED` 다
        (제15조의2 제3항). 끌고 건너는 사람은 보행자이므로 `PEDESTRIAN_BLOCKED` 그대로다.
      */
      if (!codes.includes('PEDESTRIAN_BLOCKED') && !codes.includes('BIKE_BLOCKED')) bad.push(spec.title);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  }, 180_000);

  /*
    **사람이 보고 설 수 있다** — 1초 늦게 알아차리는 사람이 위반 없이 끝나야 한다.
    어려움은 판단할 시간이 짧은 데서 와야지, 피할 수 없는 데서 오면 함정이다.
  */
  it('1초 늦게 알아차리는 사람도 위반 없이 끝낸다', () => {
    const bad: string[] = [];
    for (const spec of courses) {
      const r = playScenario(spec, { persona: 'human', reaction: 1.0 }).result;
      if (r.violations.length || r.failReason) bad.push(`${spec.title} — ${r.violations.map((v) => v.code).join(',')}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  }, 180_000);

  /* 시범으로 보여 주는 판이 100초 제한에 닿으면 보는 사람도 지친다 */
  it('AI 자율 주행이 제한시간 안에 넉넉히 끝난다', () => {
    const slow = courses
      .map((spec) => ({ spec, t: playScenario(spec, { persona: 'careful' }).result.stats.elapsed }))
      .filter((x) => x.t > 90)
      .map((x) => `${x.spec.title} ${x.t.toFixed(0)}초`);
    expect(slow.slice(0, 5)).toEqual([]);
  }, 180_000);

  it('모든 판이 검증을 통과한다 — 치명적 지적 없이', () => {
    const bad = validated
      .map(({ spec, r }) => ({ spec, fatal: r.issues.filter((i) => i.level === 'fatal') }))
      .filter((x) => x.fatal.length)
      .map((x) => `${x.spec.title}: ${x.fatal.map((f) => f.message).join(' / ')}`);
    expect(bad.slice(0, 5)).toEqual([]);
  }, 180_000);

  it('규정대로 몰면 제한시간에 여유가 있다', () => {
    // 100초가 제한이다. 모범 주행이 80초를 넘으면 사람이 조금만 망설여도 시간 초과가 된다
    const slow = validated
      .filter(({ r }) => (r.probes?.exemplary?.stats.elapsed ?? 0) > 80)
      .map(({ spec, r }) => `${spec.title} ${r.probes!.exemplary!.stats.elapsed.toFixed(0)}초`);
    expect(slow.slice(0, 5)).toEqual([]);
  }, 180_000);
});
