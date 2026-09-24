/**
 * **시나리오 번호 — 갈래 한 글자 + 다섯 자리.**
 *
 * 사용자가 정했다: "시나리오가 아래와 같이 나뉘어져 있어. 앞에 코드를 붙여서 관리하면 좋을 것 같아.
 * 1. 어린이보호구역 → C  2. 우회전 → L  3. 어린이보호구역+우회전 → M."
 *
 * ## 왜 갈래마다 1번부터 다시 세는가
 *
 * 예전에는 한 줄로 이어 번호를 매기고, 보호구역 전용 도로만 50001번부터 띄워 두었다. 그랬더니
 * **번호에서 개수를 읽을 수 없었다** — 사용자가 짚었다: "지금 어린이보호구역 시나리오 번호가 너무
 * 커서 개수를 유추하기 힘들어. 포트폴리오에는 우회전 전용 시나리오 몇 개, 어린이보호구역 시나리오
 * 몇 개, 복합 시나리오 몇 개 이런 식으로 작성할 거야."
 *
 * 갈래마다 1번부터 세면 **마지막 번호가 곧 그 갈래의 개수**다. `M08400` 을 보면 복합 시나리오가
 * 8,400개라는 것이 그 자리에서 읽힌다.
 *
 * ## 갈래는 태그가 정한다
 *
 *  - **C** 어린이보호구역 전용 — 사거리가 없는 전용 도로 (scenarios/zoneCourse.ts)
 *  - **L** 우회전 전용 — 보호구역이 없는 사거리 판
 *  - **M** 복합 — 사거리에서 우회전하면서 보호구역도 지나는 판
 *
 * L · M 을 가르는 것은 `trackOf` 다 (scenarios/tracks.ts) — 첫 화면의 '무엇을 연습할까' 가 쓰는
 * 바로 그 갈래라, 고른 갈래와 번호의 글자가 늘 같다.
 *
 * ## 번호가 밀리지 않는 까닭
 *
 * 갈래 안의 차례는 **라이브러리 차례 그대로**다. 라이브러리는 새 판을 늘 뒤에 붙이므로
 * (library.ts 의 `ADDED_LATER` 세대), 판을 더해도 이미 있던 판의 번호는 그대로이고 새 판이
 * 그 갈래의 마지막 번호를 이어받는다.
 */

import type { ScenarioSpec } from './scenarios';
import { scenarioLibrary } from './library';
import { trackOf } from './tracks';
import { zoneCourses } from './zoneCourse';

/** 갈래 한 글자 */
export const CODE_LETTERS = ['C', 'L', 'M'] as const;
export type CodeLetter = (typeof CODE_LETTERS)[number];

/** 글자 뒤의 자리 수 — `M08400` 처럼 늘 다섯 자리로 적어 번호를 세로로 줄 세웠을 때 자릿수가 흔들리지 않는다 */
export const CODE_DIGITS = 5;

export const CODE_NAME: Record<CodeLetter, string> = {
  C: '어린이보호구역 전용',
  L: '우회전 전용',
  M: '우회전 + 어린이보호구역',
};

interface CodeTable {
  byId: Map<number, string>;
  byCode: Map<string, ScenarioSpec>;
  counts: Record<CodeLetter, number>;
}

let table: CodeTable | null = null;

function build(): CodeTable {
  const byId = new Map<number, string>();
  const byCode = new Map<string, ScenarioSpec>();
  const counts: Record<CodeLetter, number> = { C: 0, L: 0, M: 0 };

  const add = (letter: CodeLetter, spec: ScenarioSpec): void => {
    const code = `${letter}${String(++counts[letter]).padStart(CODE_DIGITS, '0')}`;
    byId.set(spec.id, code);
    byCode.set(code, spec);
  };

  for (const spec of zoneCourses()) add('C', spec);
  for (const e of scenarioLibrary()) add(trackOf(e.tags) === 'turn' ? 'L' : 'M', e.spec);

  return { byId, byCode, counts };
}

const load = (): CodeTable => (table ??= build());

/** 이 판의 번호 — 라이브러리 밖의 판(AI 가 그 자리에서 만든 판)이면 `undefined` */
export const scenarioCode = (id: number): string | undefined => load().byId.get(id);

/** 번호로 판 찾기 — 없는 번호면 `undefined` */
export const scenarioByCode = (code: string): ScenarioSpec | undefined =>
  load().byCode.get(normalizeCode(code) ?? '');

/** 갈래마다 몇 판인가 — 포트폴리오가 그대로 읽는 수 */
export const scenarioCounts = (): Record<CodeLetter, number> => ({ ...load().counts });

/**
 * 사람이 적은 것을 번호 꼴로 다듬는다 — `l57` · `L 57` · `l00057` 이 모두 `L00057` 이 된다.
 *
 * **글자 없는 숫자는 받지 않는다.** 예전 번호(1~11,754 · 50001~)와 새 번호가 섞이면 같은 숫자가
 * 두 판을 가리켜, 엉뚱한 판이 조용히 열린다.
 */
export function normalizeCode(text: string): string | null {
  const m = /^\s*([clmCLM])\s*0*(\d{1,6})\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[2]);
  if (n < 1) return null;
  return `${m[1].toUpperCase()}${String(n).padStart(CODE_DIGITS, '0')}`;
}
