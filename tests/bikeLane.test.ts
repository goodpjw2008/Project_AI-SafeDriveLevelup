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
  CROSSWALK_INNER,
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

  it('우회전 후 횡단보도(C) — 줄무늬 바로 앞 (x 가 작은 쪽에서 만난다)', () => {
    expect(band('C')).toEqual([CROSSWALK_INNER - BIKE_LANE_WIDTH, CROSSWALK_INNER]);
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

  it('끌고 건너는 사람이 있는 판에는 띠가 없다 — 그래서 내려서 끄는 것이다', () => {
    for (const s of all) {
      if (s.pedestrians.some((p) => p.bike === 'push')) expect(s.bikeLane, s.title).toBeUndefined();
    }
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
