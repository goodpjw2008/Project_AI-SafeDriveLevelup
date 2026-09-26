import { describe, expect, it } from 'vitest';
import { offlineCourses } from '../src/scenarios/offlineCourse';
import { scenarioCode } from '../src/scenarios/scenarioCode';

/*
  오프라인 교육 열 판 — 사용자가 정한 차례 그대로 (scenarios/offlineCourse.ts). 라이브러리에 없는 것(자전거 + 사람,
  타는 자전거 + 끄는 자전거, 다섯 사람)은 가장 가까운 판으로 맞췄다 — 그 결정은 library.ts 의 DEMO 주석에 있다.
*/
describe('오프라인 교육 열 판', () => {
  it('사용자가 정한 차례 그대로 열 판이다 — 전용 도로 둘이 ③ · ⑤ 자리에 선다', () => {
    expect(offlineCourses().map((e) => scenarioCode(e.spec.id))).toEqual([
      'L00271', 'L00001', 'C00001', 'L00091', 'C00086', 'M00625', 'M08413', 'M05401', 'M05179', 'M06763',
    ]);
  });
  it('같은 판이 두 번 나오지 않고, 모두 맑은 낮이다', () => {
    const ten = offlineCourses();
    expect(new Set(ten.map((e) => e.spec.id)).size).toBe(10);
    expect(ten.every((e) => e.spec.timeOfDay === 'day' && e.spec.weather === 'clear')).toBe(true);
  });
});
