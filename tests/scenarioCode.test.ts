/**
 * **시나리오 번호 — 갈래 한 글자 + 다섯 자리** (scenarios/scenarioCode.ts).
 *
 * 사용자가 정한 체계다: "앞에 코드를 붙여서 관리하면 좋을 것 같아. C 어린이보호구역 · L 우회전 ·
 * M 어린이보호구역+우회전." 까닭도 함께 정했다 — "포트폴리오에는 우회전 전용 시나리오 몇 개,
 * 어린이보호구역 시나리오 몇 개, 복합 시나리오 몇 개 이런 식으로 작성할 거야."
 *
 * 그래서 여기서 못 박는 것은 셋이다.
 *
 *  1. **마지막 번호가 곧 그 갈래의 판 수다** — 번호를 보고 개수를 읽을 수 있어야 한다
 *  2. **한 번호는 한 판만 가리킨다** — 갈래마다 1번부터 세므로 글자를 빠뜨리면 겹친다
 *  3. **글자가 갈래와 어긋나지 않는다** — 첫 화면에서 고른 갈래와 번호의 글자가 같아야 한다
 */

import { describe, expect, it } from 'vitest';
import {
  CODE_DIGITS,
  CODE_LETTERS,
  normalizeCode,
  scenarioByCode,
  scenarioCode,
  scenarioCounts,
} from '../src/scenarios/scenarioCode';
import { scenarioLibrary } from '../src/scenarios/library';
import { trackOf } from '../src/scenarios/tracks';
import { zoneCourses } from '../src/scenarios/zoneCourse';

const counts = scenarioCounts();

describe('갈래별 번호', () => {
  it('모든 판에 번호가 있고, 한 번호는 한 판만 가리킨다', () => {
    const specs = [...zoneCourses(), ...scenarioLibrary().map((e) => e.spec)];
    const seen = new Set<string>();
    for (const s of specs) {
      const code = scenarioCode(s.id);
      expect(code, s.title).toBeDefined();
      expect(seen.has(code!), `${code} 가 두 판을 가리킨다`).toBe(false);
      seen.add(code!);
      expect(scenarioByCode(code!)?.id, code).toBe(s.id);
    }
    expect(seen.size).toBe(specs.length);
  });

  /* 포트폴리오가 읽는 수 — 마지막 번호가 곧 개수라, 번호만 보고도 몇 판인지 안다 */
  it('마지막 번호가 그 갈래의 판 수와 같다', () => {
    for (const letter of CODE_LETTERS) {
      const last = `${letter}${String(counts[letter]).padStart(CODE_DIGITS, '0')}`;
      expect(scenarioByCode(last), `${last} 가 있어야 한다`).toBeDefined();
      const past = `${letter}${String(counts[letter] + 1).padStart(CODE_DIGITS, '0')}`;
      expect(scenarioByCode(past), `${past} 는 없어야 한다`).toBeUndefined();
    }
    expect(counts.C).toBe(zoneCourses().length);
    expect(counts.L + counts.M).toBe(scenarioLibrary().length);
  });

  it('글자가 갈래와 같다 — C 보호구역 전용 · L 우회전 전용 · M 복합', () => {
    for (const s of zoneCourses()) expect(scenarioCode(s.id)![0], s.title).toBe('C');
    for (const e of scenarioLibrary()) {
      expect(scenarioCode(e.spec.id)![0], e.spec.title).toBe(trackOf(e.tags) === 'turn' ? 'L' : 'M');
    }
  });

  /*
    **갈래마다 넉넉히 있다.** 한 갈래가 몇 판뿐이면 그 갈래를 고른 학습자가 같은 판을 되풀이한다
    (첫 화면의 '무엇을 연습할까' — scenarios/tracks.ts).
  */
  it('세 갈래 모두 판이 넉넉하다', () => {
    expect(counts.C).toBeGreaterThan(100);
    expect(counts.L).toBeGreaterThan(500);
    expect(counts.M).toBeGreaterThan(1000);
  });
});

describe('사람이 적은 번호 읽기', () => {
  it('대소문자 · 앞의 0 · 공백을 가리지 않는다', () => {
    for (const text of ['L00057', 'l00057', 'L57', ' l 57 ', 'L0057']) {
      expect(normalizeCode(text), text).toBe('L00057');
    }
  });

  /*
    **글자 없는 숫자는 받지 않는다.** 예전 번호(1~11,754 · 50001~)와 새 번호가 섞이면 같은 숫자가
    두 판을 가리켜 **엉뚱한 판이 조용히 열린다** — 그럴 바엔 없다고 말하는 편이 낫다.
  */
  it('글자 없는 숫자와 이상한 글자는 받지 않는다', () => {
    for (const text of ['4927', '', 'X00001', 'L', 'L0', 'LL1', '50001']) {
      expect(normalizeCode(text), text).toBeNull();
    }
  });
});
