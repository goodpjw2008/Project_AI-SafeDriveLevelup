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
} from '../src/scenarios/zoneCourse';
import { scenarioLibrary, libraryNumber } from '../src/scenarios/library';
import { validateScenario } from '../src/scenarios/validate';

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
  **전수 검증.** 라이브러리와 같은 잣대로 본다 — 규정대로 몰면 위반 없이 통과하고(모범 운전자),
  막 몰면 걸리고(가르칠 것이 있다), 제한시간 안에 끝난다.

  직진 코스에는 우회전 코스에 없는 함정이 있었다: 판정이 교차로에 들어서기만 하면 대회전과
  방향지시등을 채점해, **규정대로 몬 주행이 전부 위반**이 됐다 (rules/lawRules.ts 의 DriveMode).
*/
describe('보호구역 직진 코스 전수 검증', () => {
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
