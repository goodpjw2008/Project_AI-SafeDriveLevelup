/**
 * **'일시정지' 와 '신호 대기' 는 다른 말이다** (src/game/stopReason.ts).
 *
 * 화면이 이 구분을 잃고 있었다 — 진입로 어린이보호구역의 **신호 있는** 횡단보도에서 적색을 만나도
 * 말풍선이 '일시정지' 라고 적었다. 사용자가 화면을 보고 짚었다: "이 상황은 일시정지가 아니고 신호가
 * 끝날 때까지 기다리는 신호 대기 상황 아니야?"
 *
 * 조문이 다르다. 신호기 **없는** 보호구역 횡단보도는 보행자가 없어도 서고 **서고 나면 간다**
 * (제27조 제7항). 신호기 **있는** 횡단보도의 적색은 서는 것으로 끝나지 않고 **녹색까지 기다린다**
 * (제5조). 판정도 이것을 따로 세고 있었다 (lawRules 의 `SCHOOL_ZONE_RED`) — 화면만 뭉뚱그렸다.
 */

import { describe, expect, it } from 'vitest';
import { isSignalWait } from '../src/game/stopReason';

const at = (over: Partial<Parameters<typeof isSignalWait>[0]> = {}) =>
  isSignalWait({ target: 'zone', advice: 'stop', zoneLight: 'red', ...over });

describe('서는 까닭 — 일시정지인가 신호 대기인가', () => {
  it('신호기 있는 보호구역 횡단보도의 적색 · 황색은 신호 대기다', () => {
    expect(at({ zoneLight: 'red' }), '적색').toBe(true);
    expect(at({ zoneLight: 'yellow' }), '황색').toBe(true);
  });

  it('신호기가 없으면 일시정지다 — 보행자가 없어도 서지만, 서고 나면 간다 (제27조 제7항)', () => {
    expect(at({ zoneLight: null })).toBe(false);
  });

  it('녹색이면 신호 때문에 서는 것이 아니다 — 보행자 때문이라면 그것은 일시정지·양보다', () => {
    expect(at({ zoneLight: 'green' })).toBe(false);
  });

  it('교차로 정지선은 보호구역 신호와 무관하다 — 거기 적색은 "서고 나서 우회전" 이다', () => {
    expect(at({ target: 'line' })).toBe(false);
    expect(at({ target: 'crosswalk' })).toBe(false);
  });

  it('설 필요가 없으면 대기도 아니다', () => {
    expect(at({ advice: 'go' })).toBe(false);
    expect(at({ advice: 'yield' })).toBe(false);
  });
});
