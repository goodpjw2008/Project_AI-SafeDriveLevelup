/**
 * **연습 갈래(트랙)** (scenarios/tracks.ts) — 우회전만 · 어린이보호구역만 · 둘 다.
 *
 * 사용자가 셋으로 나누자고 했다: "우회전과 어린이보호구역을 고르게 연습하는 것이 좋을 것 같다."
 * 여기서 확인하는 것은 **갈래가 판을 정확히 가르는가**, 그리고 **고른 갈래 밖의 판이 추천에
 * 섞이지 않는가** 다 — 우회전만 고른 사람에게 보호구역 판이 한 판이라도 나오면 갈래가 거짓이 된다.
 */

import { describe, expect, it } from 'vitest';
import { scenarioLibrary } from '../src/scenarios/library';
import {
  inTrack,
  pickTrack,
  trackOf,
  TRACKS,
  TRACK_READY,
  ZONE_GAP,
  type TrackChoice,
} from '../src/scenarios/tracks';
import { practiceTrack } from '../src/scenarios/trackPick';
import { recentTracks, trackOfId } from '../src/scenarios/scenarioCode';
import { zoneCourses } from '../src/scenarios/zoneCourse';
import { defaultSave, migrateTrack, type SaveData } from '../src/economy/save';
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
    **보호구역 전용 판은 이 라이브러리에 없다** — 8,958판 모두가 교차로에서 우회전한다. 그 갈래는
    따로 만든 직진 코스가 맡는다 (scenarios/zoneCourse.ts). 여기서 확인하는 것은 **두 묶음이 섞이지
    않는다**는 것이다 — 우회전 라이브러리에서 'zone' 이 나오면 갈래를 고르는 기준이 흐려진다.
  */
  it("우회전 라이브러리에는 보호구역 전용 판이 없다 — 그 갈래는 직진 코스가 맡는다", () => {
    expect(lib.filter((e) => trackOf(e.tags) === 'zone')).toHaveLength(0);
    // 셋 다 달릴 수 있다 (사거리 없는 전용 도로 156판이 생기며 열렸다)
    expect(TRACK_READY).toEqual({ turn: true, zone: true, both: true });
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

  /*
    **보호구역 전용은 다른 판 묶음에서 고른다** (scenarios/zoneCourse.ts) — **사거리가 없는** 전용 도로다
    (사용자가 정했다: "어린이 보호구역 연습은 사거리가 나오지 말아야 해"). 기존 라이브러리에는 그런 판이
    하나도 없으므로, 거르는 것이 아니라 묶음을 갈아 끼운다.
  */
  it('어린이보호구역 전용은 사거리 없는 도로만 준다', () => {
    for (const level of [1, 5, 10] as const) {
      const cands = candidatesFor(plan({ level, track: 'zone' }), []);
      expect(cands.length, `L${level} 후보`).toBeGreaterThan(5);
      for (const e of cands) {
        expect(e.spec.drive).toBe('zoneOnly');
        expect(e.spec.isSchoolZone).toBe(true);
      }
    }
  });

  it('보호구역 전용에서도 고칠 습관을 겨냥한다', () => {
    const cands = candidatesFor(
      plan({
        level: 6,
        track: 'zone',
        target: 'SCHOOL_ZONE_NO_STOP',
        badHabits: [{ code: 'SCHOOL_ZONE_NO_STOP', count: 3, cleanRuns: 0, lastRun: 5 }],
      }),
      [],
    );
    expect(cands.length).toBeGreaterThan(10);
    for (const e of cands) expect(e.targets).toContain('SCHOOL_ZONE_NO_STOP');
  });

  it('갈래를 안 고르면 지금까지와 같다 — 보호구역 차례면 보호구역 판', () => {
    const cands = candidatesFor(plan({ level: 6, schoolZone: true }), []);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.some((e) => e.tags.zone === 'yes' || e.tags.approach !== 'none')).toBe(true);
  });
});

/*
  **갈래를 AI 가 고른다** (tracks.ts 의 `pickTrack` · trackPick.ts). 사용자가 정했다:
  "3개 중 선택을 하게 되어 있어. 자동으로 선택이 되게 해 줘."

  여기서 못 박는 것은 **고른 까닭이 실제로 작동하는가** 다. 자동이 늘 같은 갈래만 주면
  손으로 고르던 때보다 오히려 좁아지고, 전용 도로(180판)는 영영 안 나온다.
*/
describe('자동으로 갈래 고르기', () => {
  const pick = (over: Partial<Parameters<typeof pickTrack>[0]> = {}) =>
    pickTrack({ level: 5, habit: null, recent: [], ...over });

  it('보호구역을 배우기 전(L1)에는 우회전부터', () => {
    expect(pick({ level: 1 }).track).toBe('turn');
    // 보호구역은 L2 에서 열린다 (library.ts 의 levelGuide) — 그 뒤로는 갈래가 갈린다
    expect(pick({ level: 2 }).track).not.toBe('turn');
  });

  it('전용 도로를 다섯 판째 못 만났으면 전용 도로를 준다', () => {
    const noZone = Array.from({ length: ZONE_GAP }, () => 'both' as const);
    expect(pick({ recent: noZone }).track).toBe('zone');
    // 그 안에 한 번이라도 있었으면 차례가 아니다
    expect(pick({ recent: [...noZone.slice(1), 'zone'] }).track).not.toBe('zone');
  });

  it('기록이 아직 다섯 판이 안 되면 차례를 세지 않는다 — 처음 온 사람에게 전용 도로부터 주지 않는다', () => {
    expect(pick({ recent: ['both', 'both'] }).track).toBe('both');
  });

  it('고칠 습관이 보호구역 것이면 전용 도로 — 한 판에 횡단보도 셋을 묻는다', () => {
    for (const h of ['SCHOOL_ZONE_NO_STOP', 'SCHOOL_ZONE_RED', 'STRAIGHT_RED']) {
      expect(pick({ habit: h }).track, h).toBe('zone');
    }
  });

  it('고칠 습관이 우회전 것이면 보호구역 없는 교차로', () => {
    for (const h of ['WIDE_TURN', 'NO_TURN_SIGNAL', 'NO_SLOW_DOWN', 'RIGHT_ARROW_RED', 'BLOCKING_INTERSECTION']) {
      expect(pick({ habit: h }).track, h).toBe('turn');
    }
  });

  /*
    적색 일시정지 · 보행자 먼저 · 정지선 · 자전거는 **어느 갈래에서나** 나온다. 갈래를 좁혀 봤자
    얻는 것이 없고 고를 수 있는 판만 줄어든다.
  */
  it('어느 갈래에서나 나오는 습관이면 좁히지 않는다', () => {
    for (const h of ['RED_NO_STOP', 'PEDESTRIAN_BLOCKED', 'OVER_STOP_LINE', 'BIKE_BLOCKED']) {
      expect(pick({ habit: h }).track, h).toBe('both');
    }
  });

  it('고른 까닭을 반드시 말한다 — 말하지 않으면 자동은 깜깜이다', () => {
    for (const p of [pick(), pick({ level: 1 }), pick({ habit: 'WIDE_TURN' }), pick({ recent: Array(ZONE_GAP).fill('both') })]) {
      expect(p.why.length).toBeGreaterThan(5);
    }
  });

  it('굴림이 섞이지 않는다 — 첫 화면에 적어 둔 것과 실제 판이 같아야 한다', () => {
    const input = { level: 7, habit: 'PEDESTRIAN_BLOCKED', recent: ['both', 'zone', 'turn'] as const };
    const first = pickTrack({ ...input, recent: [...input.recent] });
    for (let i = 0; i < 20; i++) {
      expect(pickTrack({ ...input, recent: [...input.recent] })).toEqual(first);
    }
  });
});

describe('판 번호로 갈래를 되찾는다', () => {
  it('C 는 보호구역 전용 · L 은 우회전 전용 · M 은 복합', () => {
    for (const e of lib) expect(trackOfId(e.spec.id)).toBe(trackOf(e.tags));
    for (const s of zoneCourses()) expect(trackOfId(s.id)).toBe('zone');
  });

  it('모르는 번호는 세지 않는다 — 손으로 만든 옛 판이 기록에 남아 있다', () => {
    expect(trackOfId(999_999_999)).toBeUndefined();
    expect(recentTracks([999_999_999, lib[0].spec.id])).toEqual([trackOf(lib[0].tags)]);
  });
});

describe('손으로 고른 갈래가 AI 보다 앞선다', () => {
  const saveWith = (track: TrackChoice): SaveData => {
    const s = defaultSave();
    s.settings.track = track;
    return s;
  };

  it("'자동' 이면 AI 가 고르고, 고른 것임을 알린다", () => {
    const chosen = practiceTrack(saveWith('auto'));
    expect(chosen.auto).toBe(true);
    expect(TRACKS).toContain(chosen.track);
  });

  it('갈래를 고른 사람에게는 그 갈래 그대로', () => {
    for (const t of TRACKS) {
      const chosen = practiceTrack(saveWith(t));
      expect(chosen.track).toBe(t);
      expect(chosen.auto).toBe(false);
    }
  });

  /*
    v12 까지의 기본값은 '둘 다' 였다 — **고른 것이 아니라 고르지 않으면 되던 값**이다.
    자동이 기본이 된 마당에 그것만 남겨 두면 지금까지 쓰던 사람만 자동을 못 만난다.
  */
  it("예전 저장본의 '둘 다' 는 자동으로 옮기고, 손으로 고른 것은 그대로 둔다", () => {
    expect(migrateTrack('both', 12)).toBe('auto');
    expect(migrateTrack('turn', 12)).toBe('turn');
    expect(migrateTrack('zone', 12)).toBe('zone');
    // v13 뒤에 고른 '둘 다' 는 고른 것이므로 지킨다
    expect(migrateTrack('both', 13)).toBe('both');
    // 모르는 값 · 없는 값
    expect(migrateTrack('구버전이름', 13)).toBe('auto');
    expect(migrateTrack(undefined, 13)).toBe('auto');
  });
});
