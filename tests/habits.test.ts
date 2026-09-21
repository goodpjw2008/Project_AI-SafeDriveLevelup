/**
 * 습관 집계 — **AI가 아니라 코드가 세는 부분**을 검증한다.
 *
 * 여기서 나온 숫자가 그대로 화면의 막대가 되고 진단 프롬프트의 재료가 된다.
 * 틀리면 AI 가 그 틀린 값을 그대로 인용하고, 문장이 그럴듯해서 아무도 눈치채지 못한다.
 * 그래서 세는 자리는 규칙이 맡고, 그 규칙을 여기서 못 박는다.
 */

import { describe, expect, it } from 'vitest';

import { buildReportPrompt } from '../server/reportPrompt.mjs';
import { MIN_RUNS, summarize, weakestPoint } from '../src/coach/habits';
import type { RunRecord } from '../src/economy/save';

/** 기본은 '전부 잘한 판'. 필요한 것만 갈아 끼워 쓴다 */
const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  st: 1,
  g: 'PERFECT',
  v: [],
  sa: true,
  sc: true,
  sp: 12,
  sg: true,
  ...over,
});

describe('summarize', () => {
  it('빈 이력에서 터지지 않는다', () => {
    const s = summarize([]);
    expect(s.runs).toBe(0);
    expect(s.trend).toBeNull();
    expect(s.mostRetried).toBeNull();
    // 0판에서 비율은 0 이다 (0/0 이 NaN 이 되면 화면에 NaN% 가 찍힌다)
    expect(s.points.every((p) => p.rate === 0)).toBe(true);
  });

  it('지점별로 따로 센다 — 정지선과 진출 횡단보도를 합치지 않는다', () => {
    const s = summarize([
      run({ sa: true, sc: false }),
      run({ sa: true, sc: false }),
      run({ sa: true, sc: true }),
      run({ sa: false, sc: true }),
    ]);
    const [stopLine, exitCrosswalk] = s.points;
    expect(stopLine.kept).toBe(3);
    expect(stopLine.rate).toBeCloseTo(0.75);
    expect(exitCrosswalk.kept).toBe(2);
    expect(exitCrosswalk.rate).toBeCloseTo(0.5);
  });

  it('서행은 20km/h 이하를 지킨 것으로 본다 (경계 포함)', () => {
    const s = summarize([run({ sp: 20 }), run({ sp: 20.1 }), run({ sp: 5 })]);
    expect(s.points[2].kept).toBe(2);
  });

  it('위반을 코드별로 세고 많은 순으로 준다', () => {
    const s = summarize([
      run({ v: ['PEDESTRIAN_BLOCKED'] }),
      run({ v: ['PEDESTRIAN_BLOCKED', 'NO_SLOW_DOWN'] }),
      run({ v: ['PEDESTRIAN_BLOCKED'] }),
      run({ v: ['NO_TURN_SIGNAL'] }),
    ]);
    expect(s.byCode[0]).toEqual({ code: 'PEDESTRIAN_BLOCKED', count: 3 });
    expect(s.byCode[1].count).toBe(1);
    expect(s.cleanRuns).toBe(0);
  });

  it('위반이 없는 판만 무위반으로 센다', () => {
    const s = summarize([run(), run({ v: ['NO_TURN_SIGNAL'] }), run()]);
    expect(s.cleanRuns).toBe(2);
  });

  describe('개선 추이', () => {
    it('판이 적으면 내지 않는다 — 한 판 차이로 결론이 뒤집힌다', () => {
      expect(summarize(Array.from({ length: 7 }, () => run())).trend).toBeNull();
    });

    it('8판부터 앞뒤 절반을 비교한다', () => {
      const s = summarize([
        ...Array.from({ length: 4 }, () => run({ v: ['NO_SLOW_DOWN'] })), // 초반: 전부 위반
        ...Array.from({ length: 4 }, () => run()), // 후반: 전부 깨끗
      ]);
      expect(s.trend).toEqual({ early: 0, late: 1 });
    });
  });

  describe('가장 많이 돈 판', () => {
    it('한 번씩만 돌았으면 내지 않는다', () => {
      const s = summarize([run({ st: 1 }), run({ st: 2 }), run({ st: 3 })]);
      expect(s.mostRetried).toBeNull();
    });

    it('두 번 이상 돈 판이 있으면 가장 많은 것을 준다', () => {
      const s = summarize([run({ st: 1 }), run({ st: 3 }), run({ st: 3 }), run({ st: 3 })]);
      expect(s.mostRetried).toEqual({ stage: 3, count: 3 });
      expect(s.stagesPlayed).toBe(2);
    });
  });
});

describe('weakestPoint', () => {
  it('준수율이 가장 낮은 지점을 고른다', () => {
    const s = summarize([
      run({ sa: true, sc: false, sp: 12, sg: true }),
      run({ sa: true, sc: false, sp: 12, sg: false }),
    ]);
    expect(weakestPoint(s)?.label).toContain('우회전 후 횡단보도');
  });

  it('같으면 뒤쪽 지점을 고른다 — 진출 쪽이 더 나쁜 신호다', () => {
    // 정지선 50% · 진출 횡단보도 50% — 둘이 같다
    const s = summarize([run({ sa: true, sc: false }), run({ sa: false, sc: true })]);
    expect(weakestPoint(s)?.label).toContain('우회전 후 횡단보도');
  });
});

describe('MIN_RUNS', () => {
  it('두세 판으로 습관을 말하지 않는다', () => {
    expect(MIN_RUNS).toBeGreaterThanOrEqual(5);
  });
});

/**
 * 집계(브라우저) → 프롬프트(서버)의 **계약**.
 *
 * 브라우저는 `summarize()` 결과를 그대로 `/api/report` 에 보내고, 서버는 그것을 받아
 * 프롬프트를 만든다. 두 파일이 다른 언어(TS / .mjs)라 컴파일러가 이어 주지 못하므로,
 * 필드 이름 하나만 바뀌어도 **런타임에서야** 드러난다 — 그때는 AI 가 빈 값을 그럴듯한
 * 문장으로 메워 버려서 아무도 눈치채지 못한다. 그래서 여기서 실제로 이어 본다.
 */
describe('집계 → 진단 프롬프트 계약', () => {
  const history = [
    ...Array.from({ length: 5 }, () => run({ st: 4, sc: false, v: ['PEDESTRIAN_BLOCKED'] })),
    ...Array.from({ length: 5 }, () => run({ st: 1 })),
  ];
  const text = buildReportPrompt(summarize(history));

  it('판 수와 무위반 판 수가 실린다', () => {
    expect(text).toContain('주행 10판');
    expect(text).toContain('위반 없이 마친 판: 5판');
  });

  it('지점별 준수율이 집계한 값 그대로 실린다', () => {
    // 진출 횡단보도는 10판 중 5판만 지켰다
    expect(text).toContain('우회전 후 횡단보도 앞 정지: 50% (5/10판)');
    expect(text).toContain('정지선 앞 완전정지: 100% (10/10판)');
  });

  it('위반이 조문 표기와 함께 실린다', () => {
    expect(text).toContain('횡단보도 보행자 횡단 방해');
    expect(text).toContain('도로교통법 제27조 제1항');
    expect(text).toContain('5회');
  });

  it('가장 많이 돈 판이 실린다', () => {
    expect(text).toContain('Stage 4');
  });

  it('추이가 없으면 "말하지 말라"고 명시해 넘긴다', () => {
    const short = buildReportPrompt(summarize(Array.from({ length: 6 }, () => run())));
    expect(short).toContain('나아지고 있는지 여부를 말하지 마십시오');
  });
});
