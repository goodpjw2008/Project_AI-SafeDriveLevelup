/**
 * **뱃지** (economy/badges.ts) — 안전운전 습관을 해낼 때마다 주고, 교통법규를 어기면 빼앗는다.
 *
 * 사용자가 캐글을 보고 제안했고, 설계를 보고 정했다: 방향지시등 · 서행 · 작은 회전 · 꼬리물기는 빼고, 위반하면 그 법규의
 * 뱃지만 **한 단계** 떨어지며, 성장 뱃지는 뺏지 않고, 지금까지의 기록으로 채워 준다.
 */
import { describe, expect, it } from 'vitest';

import {
  BADGES,
  KEEP_STEPS,
  badgesFromHistory,
  dropOneTier,
  freshBadges,
  heldCount,
  normalizeBadges,
  progressOf,
  tiersOf,
  updateBadges,
  type BadgeRun,
  type BadgeState,
} from '../src/economy/badges';
import { habitsTestedBy, libraryEntry, scenarioLibrary } from '../src/scenarios/library';
import type { JudgeResult } from '../src/rules/lawRules';
import type { ViolationCode } from '../src/rules/violations';
import type { ScenarioSpec } from '../src/scenarios/scenarios';

const lib = scenarioLibrary();
/** 정면 적색 · 보행자 · 보호구역 없음 · 앞차 없음 · 낮 — 적색 일시정지와 보행자 먼저를 시험한다 */
const redWithPed = lib.find(
  (e) =>
    e.tags.signal === 'red' &&
    e.tags.zone === 'no' &&
    e.tags.approach === 'none' &&
    e.tags.a === 'none' &&
    e.tags.c === 'jaywalk' &&
    e.tags.lead === 'none' &&
    e.tags.env === 'day',
)!;
/** 정면 녹색 · 보행자 없음 · 보호구역 없음 — 적색도 보행자도 시험하지 않는다 */
const plainGreen = lib.find(
  (e) => e.tags.signal === 'green' && e.tags.zone === 'no' && e.tags.approach === 'none' && e.tags.a === 'none' && e.tags.c === 'none' && e.tags.lead === 'none',
)!;
/** 신호 없는 보호구역 */
const noSignalZone = lib.find((e) => e.tags.approach === 'noSignal' && e.tags.a === 'none' && e.tags.c === 'none' && e.tags.lead === 'none')!;

const run = (spec: ScenarioSpec, codes: ViolationCode[] = [], over: Partial<BadgeRun> = {}): BadgeRun => ({
  result: { violations: codes.map((code) => ({ code })) as unknown as JudgeResult['violations'], failReason: null },
  spec,
  tested: habitsTestedBy(spec),
  habitsFixed: 0,
  mastered: false,
  ...over,
});
const play = (s: BadgeState, r: BadgeRun, times = 1): BadgeState => {
  for (let i = 0; i < times; i++) s = updateBadges(s, r).next;
  return s;
};

describe('뱃지 목록', () => {
  it('열네 개 — 사용자가 뺀 넷(방향지시등 · 서행 · 작은 회전 · 꼬리물기)은 없다', () => {
    expect(BADGES).toHaveLength(14);
    const names = BADGES.map((b) => b.name).join(' ');
    for (const gone of ['방향지시등', '서행', '꼬리물기']) expect(names).not.toContain(gone);
  });
});

describe('법규 지킴 — 동 3 · 은 10 · 금 25, 어기면 한 단계', () => {
  it('그 법규를 시험한 판에서 지킨 횟수로 오른다', () => {
    let s = freshBadges();
    const r = updateBadges(s, run(redWithPed.spec));
    expect(r.next.keep.redStop).toBe(1);
    expect(r.next.keep.pedestrianFirst).toBe(1);
    s = play(s, run(redWithPed.spec), 3);
    expect(tiersOf(s).redStop, '세 번이면 동').toBe(1);
    const up = updateBadges({ ...s, keep: { ...s.keep, redStop: 9 } }, run(redWithPed.spec));
    expect(up.events.find((e) => e.id === 'redStop')).toMatchObject({ kind: 'up', from: 1, to: 2 });
  });

  it('시험하지 않은 판은 세지 않는다 — 보행자 없는 녹색 판은 보행자 먼저도 적색도 아니다', () => {
    const s = play(freshBadges(), run(plainGreen.spec), 5);
    expect(s.keep.redStop).toBe(0);
    expect(s.keep.pedestrianFirst).toBe(0);
  });

  it('어기면 그 뱃지만 한 단계 내려가고, 까닭을 말한다', () => {
    const s: BadgeState = { ...freshBadges(), keep: { ...freshBadges().keep, redStop: 27, pedestrianFirst: 12 } };
    const r = updateBadges(s, run(redWithPed.spec, ['RED_NO_STOP']));
    expect(r.next.keep.redStop, '금 → 은의 시작').toBe(10);
    expect(r.next.keep.pedestrianFirst, '보행자는 지켰다 — 그대로 오른다').toBe(13);
    const ev = r.events.find((e) => e.id === 'redStop')!;
    expect(ev).toMatchObject({ kind: 'down', from: 3, to: 2 });
    expect(ev.reason).toContain('신호·지시 위반');
    expect(r.events.some((e) => e.id === 'pedestrianFirst' && e.to < e.from)).toBe(false);
  });

  it('동에서 어기면 잃는다 · 아직 동이 아니면 처음부터', () => {
    expect(dropOneTier(25)).toBe(10);
    expect(dropOneTier(12)).toBe(KEEP_STEPS[0]);
    expect(dropOneTier(4)).toBe(0);
    expect(dropOneTier(2)).toBe(0);
    const s: BadgeState = { ...freshBadges(), keep: { ...freshBadges().keep, redStop: 4 } };
    expect(updateBadges(s, run(redWithPed.spec, ['OVER_STOP_LINE'])).events.find((e) => e.id === 'redStop')).toMatchObject({
      kind: 'lost',
      reason: '정지선 위반',
    });
  });

  it('보행자와 부딪히면 보행자 먼저는 단계와 상관없이 다 잃는다', () => {
    const s: BadgeState = { ...freshBadges(), keep: { ...freshBadges().keep, pedestrianFirst: 30 } };
    const r = updateBadges(s, run(redWithPed.spec, [], { result: { violations: [], failReason: 'PEDESTRIAN_HIT' } as never }));
    expect(r.next.keep.pedestrianFirst).toBe(0);
    expect(r.events.find((e) => e.id === 'pedestrianFirst')).toMatchObject({ kind: 'lost', reason: '보행자와 부딪혔습니다' });
  });

  it('스쿨존 일시정지는 신호 없는 보호구역에서 센다', () => {
    const s = play(freshBadges(), run(noSignalZone.spec), 3);
    expect(tiersOf(s).schoolZoneStop).toBe(1);
  });
});

describe('무위반 연속 — 끊기면 잃는다', () => {
  it('5판이면 얻고, 한 번 어기면 잃는다 — 최고 기록은 남는다', () => {
    let s = play(freshBadges(), run(plainGreen.spec), 5);
    expect(tiersOf(s).streak5).toBe(1);
    const r = updateBadges(s, run(redWithPed.spec, ['PEDESTRIAN_BLOCKED']));
    expect(r.events.find((e) => e.id === 'streak5')).toMatchObject({ kind: 'lost' });
    s = r.next;
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(5);
  });
});

describe('성장 — 뺏지 않는다', () => {
  it('첫 걸음 · 스쿨존 첫 완주는 어겨도 남는다', () => {
    let s = play(freshBadges(), run(noSignalZone.spec));
    expect(tiersOf(s).firstClean).toBe(1);
    expect(tiersOf(s).schoolZoneFirst).toBe(1);
    s = play(s, run(redWithPed.spec, ['RED_NO_STOP', 'PEDESTRIAN_BLOCKED']));
    expect(tiersOf(s).firstClean).toBe(1);
    expect(tiersOf(s).schoolZoneFirst).toBe(1);
  });

  it('습관 교정가는 고친 습관 수로 오른다', () => {
    const s = play(freshBadges(), run(plainGreen.spec, [], { habitsFixed: 1 }));
    expect(tiersOf(s).habitFixer).toBe(1);
    expect(progressOf(s, 'habitFixer')).toEqual({ now: 1, next: 5 });
  });

  it('앞차 판단가 — 앞차가 실제로 일시정지를 건너뛰었는데 위반 없이 통과', () => {
    const lead = { behavior: 'rolling' as const, skippedStops: ['A' as const], minGap: 5 };
    const s = play(freshBadges(), run(redWithPed.spec, [], { result: { violations: [], failReason: null, lead } as never }));
    expect(tiersOf(s).leadJudge).toBe(1);
  });

  it('상황 탐험가 — 여섯 상황을 모두 겪어야', () => {
    const s: BadgeState = { ...freshBadges(), seen: ['night', 'rain', 'child', 'elder', 'lead'] };
    expect(tiersOf(s).explorer).toBe(0);
    const honk = lib.find((e) => e.tags.pressure === 'honk')!;
    expect(tiersOf(play(s, run(honk.spec))).explorer).toBe(1);
  });
});

describe('지금까지의 기록으로 채운다', () => {
  it('기록에 남은 판을 차례로 다시 센다 — 알 수 없는 판은 건너뛴다', () => {
    const history = [
      ...Array.from({ length: 4 }, () => ({ st: redWithPed.spec.id, g: 'PERFECT', v: [] as string[] })),
      { st: 999_999, g: 'PERFECT', v: [] },
      { st: redWithPed.spec.id, g: 'VIOLATION', v: ['PEDESTRIAN_BLOCKED'] },
    ];
    const s = badgesFromHistory(history, (id) => libraryEntry(id)?.spec, habitsTestedBy, true);
    expect(s.keep.redStop, '마지막 판은 보행자만 어겼다 — 적색 정지는 지켰다').toBe(5);
    expect(s.keep.pedestrianFirst, '동(4)에서 어겨 잃었다').toBe(0);
    expect(s.streak).toBe(0);
    expect(s.earned).toContain('firstClean');
    expect(s.earned).toContain('master');
    expect(heldCount(s)).toBeGreaterThanOrEqual(3);
  });

  it('예전 저장본의 빈 값도 받아 준다', () => {
    const s = normalizeBadges({ keep: { redStop: 5 } } as never);
    expect(s.keep.redStop).toBe(5);
    expect(s.keep.schoolZoneStop).toBe(0);
    expect(s.seen).toEqual([]);
  });
});
