/**
 * **"보행자가 건너려는 것 같아요"** 를 언제 말하는가 (game/pedCue.ts).
 *
 * 규정의 "통행하려고 하는 때"(제27조 제1항)를 화면이 짚어 주는 자리다. 판정과 같은 값을
 * 보므로, 여기서 어긋나면 코치가 판정과 다른 말을 하게 된다.
 */

import { describe, expect, it } from 'vitest';

import { pedCueAt, PED_CUE_RANGE } from '../src/game/pedCue';
import { CROSSWALK_OUTER, CROSSWALK_S_OUTER, STOP_LINE } from '../src/layout';
import type { PedestrianSample } from '../src/rules/lawRules';

const waiting = (crosswalk: 'A' | 'C' | 'S', intends = true): PedestrianSample => ({
  crosswalk,
  intendsToCross: intends,
  onConflictPath: true,
  state: 'waiting',
  active: true,
});
const crossing = (crosswalk: 'A' | 'C' | 'S'): PedestrianSample => ({
  crosswalk,
  intendsToCross: true,
  onConflictPath: true,
  state: 'crossing',
  active: true,
});

/** 정지선 20m 앞 — 아직 다가가는 중이다 */
const approaching = { frontX: 6.8, frontZ: STOP_LINE + 20 };
/** 정지선 5m 앞 — A 가 코앞이다 */
const nearLine = { frontX: 6.8, frontZ: STOP_LINE + 5 };
/** 정지선 앞에 섰다 — 우회전을 준비하는 자리 */
const atLine = { frontX: 6.8, frontZ: STOP_LINE + 1.5 };
/** 교차로에 들어서 우회전하는 중 — 이제 C 가 앞이다 */
const turning = { frontX: 9.5, frontZ: 9 };

describe('보행자 움직임 알림', () => {
  it('우회전하는 중에 C 에 건너려는 사람이 있으면 "건너려는 것 같다"', () => {
    expect(pedCueAt({ ...turning, pedestrians: [waiting('C')] }, false)).toMatchObject({
      crosswalk: 'C',
      kind: 'intending',
    });
  });

  /*
    정지선에 다가가는 동안에는 C 이야기를 하지 않는다 — 그때 봐야 할 것은 정면 신호와
    정지선이다. 아직 돌지도 않은 길 너머의 사람 이야기가 먼저 나오면 너무 이르다.
  */
  it('정지선에 다가가는 동안에는 우회전 후 횡단보도(C)를 말하지 않는다', () => {
    expect(pedCueAt({ ...approaching, pedestrians: [waiting('C'), crossing('C')] }, false)).toBeNull();
  });

  /*
    교차로에 들어선 뒤에야 알렸더니 반응할 시간이 모자랐다 — 정지선에 서서 우회전을 준비할
    때 이미 알고 있어야 한다. 적색에 서서 기다리는 동안에도 떠 있다.
  */
  it('정지선에 다가가 서기 시작할 즈음 우회전 후 횡단보도(C)를 미리 말한다', () => {
    const near = { frontX: 6.8, frontZ: STOP_LINE + 10 };
    expect(pedCueAt({ ...near, pedestrians: [waiting('C')] }, false)?.crosswalk).toBe('C');
  });

  it('정지선 앞에 서 있는 동안에도 말한다', () => {
    expect(pedCueAt({ ...atLine, pedestrians: [waiting('C')] }, false)).toMatchObject({
      crosswalk: 'C',
      kind: 'intending',
    });
  });

  it('진입 횡단보도(A)는 정지선에 다가갈 때 말한다', () => {
    expect(pedCueAt({ ...nearLine, pedestrians: [waiting('A')] }, false)).toMatchObject({
      crosswalk: 'A',
      kind: 'intending',
    });
  });

  it('보행신호를 지키느라 서 있기만 하는 사람에게는 말하지 않는다 — 건널 뜻이 없다', () => {
    expect(pedCueAt({ ...turning, pedestrians: [waiting('C', false)] }, false)).toBeNull();
  });

  it('건너는 중인 사람이 건너려는 사람보다 먼저다', () => {
    expect(pedCueAt({ ...nearLine, pedestrians: [waiting('A'), crossing('A')] }, false)?.kind).toBe(
      'crossing',
    );
  });

  it('이미 지나온 횡단보도의 사람은 말하지 않는다', () => {
    expect(pedCueAt({ ...turning, pedestrians: [crossing('A')] }, false)).toBeNull();
  });

  it('아직 먼 횡단보도는 말하지 않는다', () => {
    const far = { frontX: 6.8, frontZ: CROSSWALK_OUTER + PED_CUE_RANGE + 10, pedestrians: [waiting('A')] };
    expect(pedCueAt(far, false)).toBeNull();
  });

  it('진입부 보호구역이 없는 판에서는 S 를 보지 않는다', () => {
    // S 횡단보도 10m 앞 — 숫자로 적어 두었더니 S 를 옮길 때 이미 지나온 자리가 되어 있었다
    const onApproach = { frontX: 6.8, frontZ: CROSSWALK_S_OUTER + 10, pedestrians: [waiting('S')] };
    expect(pedCueAt(onApproach, false)).toBeNull();
    expect(pedCueAt(onApproach, true)).toMatchObject({ crosswalk: 'S', kind: 'intending' });
  });
});

describe('등장 시각 전의 "건너려는" 사람', () => {
  /*
    시각으로 나서는 사람은 등장 시각(`at`) 전까지 `active` 가 꺼져 있다(결과 지도용 값).
    그 동안에도 연석에 나와 건널 뜻을 보이는데, 그걸 거르면 알림이 발을 뗀 뒤에야 떴다.
  */
  it('active 가 꺼져 있어도 건너려는 뜻이 있으면 말한다', () => {
    const early: PedestrianSample = { ...waiting('C'), active: false };
    expect(pedCueAt({ ...atLine, pedestrians: [early] }, false)).toMatchObject({
      crosswalk: 'C',
      kind: 'intending',
    });
  });
});

describe('건너편 보행자', () => {
  /*
    건너편 사람은 멀어서 작게 보여 흘려 보기 쉽다 — 그 사람이 건너오면 결국 내 앞길을 지난다.
    C 는 동서 도로라 z < 0 (북쪽 절반)이 건너편이다. 나는 남쪽 진출 차로로 나간다.
  */
  it('C 의 북쪽 절반에서 건너오는 사람은 "건너편" 이다', () => {
    const far = { ...crossing('C'), z: -5, x: 16.8 };
    expect(pedCueAt({ ...turning, pedestrians: [far] }, false)).toEqual({
      crosswalk: 'C',
      kind: 'crossing',
      far: true,
    });
  });

  it('내 차로 쪽 절반의 사람은 건너편이 아니다', () => {
    const near = { ...crossing('C'), z: 5, x: 16.8 };
    expect(pedCueAt({ ...turning, pedestrians: [near] }, false)?.far).toBe(false);
  });

  it('둘 다 있으면 가까운 쪽 사람을 먼저 말한다 — 더 급하다', () => {
    const far = { ...crossing('C'), z: -5, x: 16.8 };
    const near = { ...crossing('C'), z: 5, x: 16.8 };
    expect(pedCueAt({ ...turning, pedestrians: [far, near] }, false)?.far).toBe(false);
  });
});
