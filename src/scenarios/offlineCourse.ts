/**
 * **오프라인 교육(AI 자율 주행 시범) 열 판 — 사용자가 정한 차례 그대로.**
 *
 * 교차로 여덟 판(library.ts 의 demoCourses)과 보호구역 전용 도로 두 판(zoneCourse.ts 의 zoneDemoCourses)을 한 줄로 엮는다.
 * 예전에는 레벨 · 난이도 점수로 줄 세웠는데, 사용자가 열 판의 차례를 하나하나 정했다 (2026-09-26):
 *
 *   ① 우회전 적색 · 사람 없음        ② 우회전 녹색 · 사람 없음       ③ 보호구역 기본(전용 도로) · 사람 없음
 *   ④ 우회전 + 사람 둘(양쪽)         ⑤ 보호구역(전용 도로) + 사람 둘(양쪽)
 *   ⑥ 우회전+보호구역 중급 · 사람 둘  ⑦ 상급 · 자전거               ⑧ 최상급 · 사람 셋
 *   ⑨ 최상급2 · 진입로 보호구역 뒤 교차로 · 사람 넷   ⑩ 최상급3 · 같은 길 + 우회전 신호등 적색 · 사람 넷
 *
 * 라이브러리와 전용 도로가 서로를 부르지 않도록 합치는 일은 여기서 한다 (main.ts 가 부른다).
 */

import { demoCourses, type LibraryEntry } from './library';
import { zoneDemoCourses } from './zoneCourse';

export function offlineCourses(): LibraryEntry[] {
  const lm = demoCourses(); // ① ② ④ ⑥ ⑦ ⑧ ⑨ ⑩ (library.ts 의 DEMO 차례)
  const zone = zoneDemoCourses(); // ③ ⑤
  return [lm[0], lm[1], zone[0], lm[2], zone[1], lm[3], lm[4], lm[5], lm[6], lm[7]];
}
