/**
 * **자전거횡단도** — 띠가 깔린 자리와, 그 위를 타고 건너는 자전거의 자리.
 *
 * 타고 건너는 자전거는 횡단보도 줄무늬가 아니라 **옆의 붉은 띠**로 건넌다 (제15조의2 제3항).
 * 한때 노면의 띠와 사람의 자리를 따로 두어, 화면에서는 자전거가 **줄무늬 위로** 건넜다 —
 * 사용자가 짚었다: "조금 아래로 지나가면 자전거 통행 부분으로 지나갈 것 같아."
 * 지금은 둘 다 `layout.bikeLaneCenter` 하나를 본다.
 */
import { describe, expect, it } from 'vitest';

import {
  BIKE_LANE_WIDTH,
  BIKE_SLOT_SHRINK,
  CROSSWALK_B_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_OUTER,
  STOP_LINE,
  STOP_LINE_S,
  bikeLaneCenter,
} from '../src/layout';
import { scenarioLibrary } from '../src/scenarios/library';
import { zoneCourses } from '../src/scenarios/zoneCourse';
import type { ScenarioSpec } from '../src/scenarios/scenarios';

/** 띠가 차지하는 구간 — 한가운데에서 폭의 절반씩 */
const band = (at: 'S' | 'A' | 'B' | 'C'): [number, number] => {
  const c = bikeLaneCenter(at);
  const h = BIKE_LANE_WIDTH / 2;
  return [c - h, c + h];
};

describe('띠는 줄무늬 밖 · 정지선 안에 깔린다', () => {
  /*
    운전자가 **먼저 만나는 쪽**이라야 판단에 쓸 수 있다 — 횡단보도를 지나고 나서야 띠가
    나오면 이미 늦다. 그래서 정지선과 횡단보도 **사이**가 제자리다.
  */
  it('첫 횡단보도(A) — 횡단보도와 정지선 사이', () => {
    expect(band('A')).toEqual([CROSSWALK_OUTER, STOP_LINE]);
  });

  it('진입로 보호구역(S) — 횡단보도와 정지선 사이', () => {
    expect(band('S')).toEqual([CROSSWALK_S_OUTER, STOP_LINE_S]);
  });

  /*
    세 번째 횡단보도(B)는 한때 띠를 2m 더 물려 **정지선 뒤**에 깔았다 — A · S 는 정지선과
    횡단보도 사이인데 B 만 어긋나, 차가 정지선에 서면 띠가 차 밑에 들어갔다.
  */
  it('세 번째 횡단보도(B) — 횡단보도와 정지선 사이 (정지선 뒤가 아니다)', () => {
    const [near, far] = band('B');
    expect(near).toBe(CROSSWALK_B_INNER);
    expect(far).toBe(CROSSWALK_B_INNER + 2); // 전용 도로의 B 정지선
  });

  /*
    우회전 후 횡단보도(C)에는 정지선이 없어 운전자가 **줄무늬 가장자리 1m 앞**에 선다. 띠를 먼저 만나는
    쪽(x 가 작은 쪽)에 두었더니 규정대로 선 차가 바로 띠 위에 서서, 타고 건너는 자전거가 차를 들이받았다
    (전수 검증에서 판 84개 PEDESTRIAN_HIT). 그래서 C 만 줄무늬 **건너편**(x 가 큰 쪽)에 깐다 — 판정은
    자전거의 자리가 아니라 상태로 보므로 "자전거가 다 건널 때까지 선다" 는 그대로다 (layout.ts 주석).
  */
  it('우회전 후 횡단보도(C) — 줄무늬 건너편 (선 차가 띠를 밟지 않게)', () => {
    expect(band('C')).toEqual([CROSSWALK_OUTER, CROSSWALK_OUTER + BIKE_LANE_WIDTH]);
  });
});

describe('타고 건너는 자전거는 반드시 띠가 있는 횡단보도에 있다', () => {
  /** 이 판이 세우는 사람 중 '타고 건너는' 자전거가 선 횡단보도들 */
  const ridesIn = (s: ScenarioSpec): string[] =>
    s.pedestrians.filter((p) => p.bike === 'ride').map((p) => p.crosswalk);

  const all: ScenarioSpec[] = [...scenarioLibrary().map((e) => e.spec), ...zoneCourses()];
  const withRider = all.filter((s) => ridesIn(s).length > 0);

  it('판이 넉넉히 있다 — 검사가 빈 배열을 돌고 지나가지 않게', () => {
    expect(withRider.length).toBeGreaterThan(300);
  });

  /*
    **타고 건너는 것은 자전거횡단도가 있을 때만 허용된다** (없으면 내려서 끌어야 한다,
    제13조의2 제6항). 그림에서도 자전거는 띠 위로 지나가므로, 띠가 없는 횡단보도에 태워 두면
    **깔리지도 않은 띠 위**를 달리게 된다.
  */
  it('그 횡단보도에 띠가 깔려 있다', () => {
    for (const s of withRider) {
      for (const at of ridesIn(s)) expect(s.bikeLane, s.title).toBe(at);
    }
  });

  /*
    덧붙이는 사람들(library.ts 의 `extra`)이 생기며 끄는 사람과 띠가 한 판에 함께 있게 됐다 — 첫 횡단보도에 타는 자전거 ·
    우회전 후 횡단보도에 끄는 사람(rideApushC), 또는 한 횡단보도에 타는 자전거와 끄는 사람이 함께(rideCpushC — 사용자가
    정한 오프라인 교육 ⑧~⑩). 자전거횡단도가 있어도 내려서 줄무늬로 끌고 건너는 것은 보행자로서 적법하다. 그래서
    "끄는 사람이 있으면 띠가 없다" 가 아니라 **띠는 타는 자전거 때문에만 있다**로 본다 — 끄는 사람만 선 횡단보도에 띠가
    깔리면 그 사람은 띠를 두고 줄무늬로 끄는 셈이라 그림이 가르침("띠가 없으니 내려서 끈다")과 어긋난다.
  */
  it('끌고 건너는 사람만 있는 횡단보도에는 띠가 없다 — 띠는 타는 자전거 때문에만 깔린다', () => {
    for (const s of all) {
      const rides = new Set(ridesIn(s));
      for (const p of s.pedestrians) {
        if (p.bike === 'push' && !rides.has(p.crosswalk)) expect(s.bikeLane, s.title).not.toBe(p.crosswalk);
      }
    }
    // 검사가 실제로 무엇인가 보았는지 — 끄는 사람이 선 판 · 타는 자전거와 함께 선 판이 둘 다 있다
    expect(all.filter((s) => s.pedestrians.some((p) => p.bike === 'push')).length).toBeGreaterThan(100);
    expect(
      all.filter((s) => s.pedestrians.some((p) => p.bike === 'push' && ridesIn(s).includes(p.crosswalk))).length,
    ).toBeGreaterThan(0);
  });
});

describe('여럿이 타고 건너도 띠를 벗어나지 않는다', () => {
  /*
    같은 연석에 여럿이 서면 겹치지 않게 자리를 어긋내는데(Pedestrian 의 WAIT_SLOTS, 최대 1.8m),
    띠는 2m 뿐이라 그대로 쓰면 자전거가 띠 밖으로 나간다. BIKE_SLOT_SHRINK 로 줄여 담는다.
  */
  const WAIT_SLOTS = [0, -1.15, 1.15, -1.8, 1.8];

  it('자리를 가장 크게 어긋낸 사람도 띠 안에 있다', () => {
    const half = BIKE_LANE_WIDTH / 2;
    for (const at of ['S', 'A', 'B', 'C'] as const) {
      const [near, far] = band(at);
      for (const slot of WAIT_SLOTS) {
        const z = bikeLaneCenter(at) + slot * BIKE_SLOT_SHRINK;
        expect(Math.abs(z - bikeLaneCenter(at)), `${at} ${slot}`).toBeLessThan(half);
        expect(z).toBeGreaterThan(near);
        expect(z).toBeLessThan(far);
      }
    }
  });
});
