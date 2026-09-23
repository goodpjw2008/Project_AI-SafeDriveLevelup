/**
 * **어린이보호구역 직진 연습편** (scenarios/zoneCourse.ts).
 *
 * 사용자가 정한 코스다 — "어린이보호구역은 직진만 하고, 중간에 신호등 있는 횡단보도와 없는 횡단보도가
 * 섞여 나오게 하고, 보행자들만 변수로." 여기서 확인하는 것은 셋이다.
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

describe('보호구역 직진 코스', () => {
  it('판이 넉넉히 있고, 모두 직진 · 보호구역이다', () => {
    expect(courses.length).toBeGreaterThan(100);
    for (const s of courses) {
      expect(s.drive).toBe('straight');
      expect(s.isSchoolZone).toBe(true);
      expect(s.approachSchoolZone).toBeDefined();
    }
  });

  /* 보행자는 이 코스가 지나는 세 횡단보도에만 선다 — C(우회전 후)는 지나지 않는다 */
  it('보행자는 S · A · B 에만 있다', () => {
    for (const s of courses) {
      for (const p of s.pedestrians) expect(['S', 'A', 'B']).toContain(p.crosswalk);
    }
  });

  it('신호 있는 횡단보도와 없는 횡단보도가 섞여 있다', () => {
    const noSignal = courses.filter((s) => s.approachSchoolZone?.signal === false).length;
    const signal = courses.length - noSignal;
    expect(noSignal).toBeGreaterThan(20);
    expect(signal).toBeGreaterThan(20);
    // 교차로 횡단보도(A·B)의 보행신호기도 두 쪽이 다 있다
    expect(courses.some((s) => s.pedSignalInstalled.A)).toBe(true);
    expect(courses.some((s) => !s.pedSignalInstalled.A)).toBe(true);
  });

  /*
    **번호가 라이브러리와 겹치지 않는다.** 사용자는 판을 번호로 부른다("4927번 맵") — 한 번호가
    두 판을 가리키면 그 방식 자체가 깨진다. 라이브러리가 늘어도 닿지 않을 만큼 띄워 두었다.
  */
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
describe('직진 코스가 시험하는 습관', () => {
  it('우회전 습관은 시험하지 않는다', () => {
    for (const spec of courses) {
      const tested = habitsTestedBy(spec);
      for (const code of ['NO_TURN_SIGNAL', 'WIDE_TURN', 'NO_SLOW_DOWN'] as const) {
        expect(tested.has(code), `${spec.title} → ${code}`).toBe(false);
      }
    }
  });

  it('보호구역 일시정지 · 적색 직진 · 보행자 양보를 시험한다', () => {
    const all = courses.map((s) => habitsTestedBy(s));
    expect(all.some((t) => t.has('SCHOOL_ZONE_NO_STOP'))).toBe(true);
    expect(all.some((t) => t.has('SCHOOL_ZONE_RED'))).toBe(true);
    expect(all.some((t) => t.has('STRAIGHT_RED'))).toBe(true);
    expect(all.some((t) => t.has('PEDESTRIAN_BLOCKED'))).toBe(true);
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
  it('신호기가 있는 횡단보도에는 신호를 지키는 보행자를 두지 않는다', () => {
    for (const s of courses) {
      for (const p of s.pedestrians) {
        if (p.obeysSignal === false) continue; // 무단횡단자는 어디든 선다
        if (p.crosswalk === 'S') expect(s.approachSchoolZone?.signal, s.title).toBe(false);
        else expect(s.pedSignalInstalled.A, s.title).toBe(false);
      }
    }
  });

  /* 레벨은 학습자와 함께 쓰는 하나뿐이다 — 이 코스도 레벨 1~10 에 고루 있어야 한다 */
  it('레벨마다 판이 있다', () => {
    const per = new Map<number, number>();
    for (const e of zoneEntries()) per.set(e.level, (per.get(e.level) ?? 0) + 1);
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(per.get(level) ?? 0, `L${level}`).toBeGreaterThan(4);
    }
  });
});

/*
  **전수 검증.** 라이브러리와 같은 잣대로 본다 — 규정대로 몰면 위반 없이 통과하고(모범 운전자),
  막 몰면 걸리고(가르칠 것이 있다), 제한시간 안에 끝난다.

  직진 코스에는 우회전 코스에 없는 함정이 있었다: 판정이 교차로에 들어서기만 하면 대회전과
  방향지시등을 채점해, **규정대로 몬 주행이 전부 위반**이 됐다 (rules/lawRules.ts 의 DriveMode).
*/
describe('보호구역 직진 코스 전수 검증', () => {
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
      if (!codes.includes('PEDESTRIAN_BLOCKED')) bad.push(spec.title);
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
    const bad: string[] = [];
    for (const spec of courses) {
      const fatal = validateScenario(spec).issues.filter((i) => i.level === 'fatal');
      if (fatal.length) bad.push(`${spec.title}: ${fatal.map((f) => f.message).join(' / ')}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  }, 180_000);

  it('규정대로 몰면 제한시간에 여유가 있다', () => {
    const slow: string[] = [];
    for (const spec of courses) {
      const ex = validateScenario(spec).probes?.exemplary;
      // 100초가 제한이다. 모범 주행이 80초를 넘으면 사람이 조금만 망설여도 시간 초과가 된다
      if (ex && ex.stats.elapsed > 80) slow.push(`${spec.title} ${ex.stats.elapsed.toFixed(0)}초`);
    }
    expect(slow.slice(0, 5)).toEqual([]);
  }, 180_000);
});
