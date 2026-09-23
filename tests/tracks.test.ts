/**
 * **연습 갈래(트랙)** (scenarios/tracks.ts) — 우회전만 · 어린이보호구역만 · 둘 다.
 *
 * 사용자가 셋으로 나누자고 했다: "우회전과 어린이보호구역을 고르게 연습하는 것이 좋을 것 같다."
 * 여기서 확인하는 것은 **갈래가 판을 정확히 가르는가**, 그리고 **고른 갈래 밖의 판이 추천에
 * 섞이지 않는가** 다 — 우회전만 고른 사람에게 보호구역 판이 한 판이라도 나오면 갈래가 거짓이 된다.
 */

import { describe, expect, it } from 'vitest';
import { scenarioLibrary } from '../src/scenarios/library';
import { inTrack, trackOf, TRACKS, TRACK_READY } from '../src/scenarios/tracks';
import { candidatesFor } from '../src/scenarios/recommend';
import type { Plan } from '../src/scenarios/generate';

const lib = scenarioLibrary();
const plan = (over: Partial<Plan> = {}): Plan => ({
  level: 5,
  target: null,
  badHabits: [],
  schoolZone: false,
  lead: null,
  ...over,
});

describe('갈래 가르기', () => {
  /*
    보호구역은 두 자리에 올 수 있다 — 교차로 자체가 보호구역이거나(zone), 가는 길에 보호구역
    횡단보도가 있거나(approach). 둘 중 하나라도 있으면 '우회전 전용' 이 아니다.
  */
  it("보호구역을 지나면 'both', 아니면 'turn'", () => {
    for (const e of lib) {
      const passesZone = e.tags.zone === 'yes' || e.tags.approach !== 'none';
      expect(trackOf(e.tags)).toBe(passesZone ? 'both' : 'turn');
    }
  });

  /*
    **지금 라이브러리에는 보호구역 전용 판이 없다** — 8,958판 모두가 교차로에서 우회전한다.
    그래서 'zone' 갈래는 직진 통과 맵이 생기기 전까지 '준비 중' 이다. 이 테스트가 그 사실을 못 박는다:
    새 맵이 들어오면 여기가 깨지고, 그때 TRACK_READY 를 함께 열어야 한다.
  */
  it("보호구역 전용 판은 아직 없다 — 'zone' 은 준비 중", () => {
    expect(lib.filter((e) => trackOf(e.tags) === 'zone')).toHaveLength(0);
    expect(TRACK_READY.zone).toBe(false);
    expect(TRACK_READY.turn && TRACK_READY.both).toBe(true);
  });

  it('우회전 전용에도 레벨마다 판이 있다 — 그 레벨 이하까지 합쳐서', () => {
    const turn = lib.filter((e) => trackOf(e.tags) === 'turn');
    expect(turn.length).toBeGreaterThan(1_000);
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const) {
      // 추천은 '그 레벨 이하' 를 모두 후보로 보므로(candidatesFor 의 fits), 쌓아서 센다
      expect(turn.filter((e) => e.level <= level).length, `L${level}`).toBeGreaterThan(50);
    }
  });

  /* '둘 다' 는 고르는 것이 아니라 섞는 것이다 — 우회전만 나오는 판도 그대로 나와야 한다 */
  it("'both' 는 모든 판을 받는다", () => {
    expect(lib.every((e) => inTrack(e.tags, 'both'))).toBe(true);
    expect(TRACKS).toEqual(['turn', 'zone', 'both']);
  });
});

describe('추천이 갈래를 지킨다', () => {
  it("우회전 전용을 고르면 보호구역 판이 한 판도 안 나온다", () => {
    for (const level of [1, 3, 5, 8, 10] as const) {
      const cands = candidatesFor(plan({ level, track: 'turn' }), []);
      expect(cands.length, `L${level} 후보`).toBeGreaterThan(0);
      for (const e of cands) {
        expect(e.tags.zone, `L${level} · ${e.spec.id}`).toBe('no');
        expect(e.tags.approach, `L${level} · ${e.spec.id}`).toBe('none');
      }
    }
  });

  /*
    **무신호 보호구역 차례가 와도 우회전 전용은 흔들리지 않는다.** 그 차례는 보호구역 판을 강제로
    고르는 장치라(recommend.ts 의 noSignalZoneDue), 갈래를 거르지 않으면 후보가 빈손이 된다.
  */
  it('무신호 보호구역 차례여도 우회전 전용은 우회전 판만 준다', () => {
    const cands = candidatesFor(plan({ level: 6, track: 'turn', noSignalZoneDue: true, schoolZone: true }), []);
    expect(cands.length).toBeGreaterThan(0);
    for (const e of cands) expect(e.tags.zone === 'yes' || e.tags.approach !== 'none').toBe(false);
  });

  it('갈래를 안 고르면 지금까지와 같다 — 보호구역 차례면 보호구역 판', () => {
    const cands = candidatesFor(plan({ level: 6, schoolZone: true }), []);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.some((e) => e.tags.zone === 'yes' || e.tags.approach !== 'none')).toBe(true);
  });
});
