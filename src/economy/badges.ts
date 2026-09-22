/**
 * **뱃지** — 안전운전 습관을 하나씩 해낼 때마다 주고, 교통법규를 어기면 빼앗는다.
 *
 * 사용자가 캐글을 보고 제안했다 — "중간중간 뭔가를 달성할 때마다 뱃지를 줘 … 7레벨까지 해 보니 중간중간 배지를 주면
 * 더 흥미가 있을 것 같아. 그리고 교통법규를 위반하면 뱃지를 뺏기게 돼." 레벨은 여러 판을 모아야 오르므로 그 사이에
 * 손에 잡히는 보상이 없었다. 뱃지는 **그 판에서 무엇을 잘했는지**를 곧바로 돌려준다.
 *
 * ## 세 가지
 *
 *  - **법규 지킴** (5개 · 동 3번 · 은 10번 · 금 25번) — 그 법규를 **시험한 판**에서 지켜 낸 횟수로 준다(library.ts 의
 *    `habitsTestedBy` — 나쁜 습관을 '고쳤다' 고 셀 때와 같은 기준). 보행자가 없는 판을 "보행자 먼저" 로 세지 않는다.
 *    **그 법규를 어기면 한 단계 내려가고** 그 단계의 처음부터 다시 센다 (금 → 은 10번, 동 → 없음). 보행자와 부딪히면
 *    "보행자 먼저" 는 단계와 상관없이 다 잃는다 — 가장 무거운 사고다.
 *  - **무위반 연속** (5 · 10 · 20판) — 지금 이어 가는 연속 기록이다. 위반하거나 사고가 나면 잃는다.
 *  - **성장** (6개) — 한 번 해낸 일이라 **뺏지 않는다.** 뺏는 것은 "지금 이 사람이 그 법규를 지키는가" 를 뜻하는
 *    뱃지뿐이다 — 과거에 해낸 일까지 뺏으면 뱃지가 무엇을 뜻하는지 흐려진다.
 *
 * ## 넣지 않은 것
 *
 * 방향지시등 · 서행 · 작게 돌기는 게임이 저절로 해 주므로(깜빡이는 판을 시작하면 켜지고, 속도는 차가 줄인다) 뱃지로
 * 셀 것이 없다. 꼬리물기는 앞이 막혔는지가 애매한 장면이 있어 뺐다 — 셋 다 사용자가 뺐다.
 *
 * ## 무엇을 세는가
 *
 * 직접 운전한 판만 센다 — 자율 주행(AI 가 운전)과 맵 체험(기록이 남지 않음)은 세지 않는다 (main.ts 의 finishRun 이
 * 그 둘을 먼저 걸러 낸다). **이 파일은 순수 함수만 둔다** — 저장 · 화면은 부르는 쪽이 한다.
 */

import type { JudgeResult } from '../rules/lawRules';
import { VIOLATIONS, type ViolationCode } from '../rules/violations';
import type { ScenarioSpec } from '../scenarios/scenarios';

/** 법규 지킴 뱃지 */
export type KeepBadgeId = 'redStop' | 'greenArrow' | 'pedestrianFirst' | 'schoolZoneStop' | 'schoolZoneSignal';
/** 무위반 연속 뱃지 */
export type StreakBadgeId = 'streak5' | 'streak10' | 'streak20';
/** 한 번 해내면 남는 성장 뱃지 (단계가 없는 것) */
export type OnceBadgeId = 'firstClean' | 'schoolZoneFirst' | 'leadJudge' | 'master';
export type BadgeId = KeepBadgeId | StreakBadgeId | OnceBadgeId | 'habitFixer' | 'explorer';

/** 0 = 없음 · 1 = 동 · 2 = 은 · 3 = 금. 단계가 없는 뱃지는 0 · 1 뿐이다 */
export type Tier = 0 | 1 | 2 | 3;

/** 상황 탐험가가 세는 상황 — 모두 겪으면 뱃지다 */
export type Situation = 'night' | 'rain' | 'child' | 'elder' | 'lead' | 'honk';
export const SITUATIONS: readonly { key: Situation; name: string }[] = [
  { key: 'night', name: '밤' },
  { key: 'rain', name: '비' },
  { key: 'child', name: '어린이' },
  { key: 'elder', name: '노인' },
  { key: 'lead', name: '앞차' },
  { key: 'honk', name: '뒤차 경적' },
];

export type BadgeGroup = 'keep' | 'streak' | 'growth';

export interface BadgeDef {
  id: BadgeId;
  group: BadgeGroup;
  name: string;
  /** 어떻게 얻는가 — 모음 화면에 그대로 적는다 */
  how: string;
  /** 단계마다 필요한 수 (동 · 은 · 금). 단계가 없으면 하나 */
  steps: readonly number[];
}

/** 법규 지킴 뱃지의 단계 — 동 3번 · 은 10번 · 금 25번 */
export const KEEP_STEPS = [3, 10, 25] as const;
/** 습관 교정가의 단계 — 고친 나쁜 습관 1개 · 5개 · 10개 */
export const FIXER_STEPS = [1, 5, 10] as const;

/**
 * 법규 지킴 뱃지가 **무엇으로 시험되고 무엇으로 잃는가.**
 *
 * `tested` 는 그 판이 이 법규를 시험했는지 보는 위반 코드다 (library.ts 의 habitsTestedBy 가 돌려주는 값).
 * `loses` 는 이 뱃지를 한 단계 떨어뜨리는 위반이다 — 정지선 위반도 적색에서 정지선 앞에 서지 못한 것이라 함께 잃는다.
 */
export const KEEP_RULES: Readonly<Record<KeepBadgeId, { tested: ViolationCode; loses: readonly ViolationCode[] }>> = {
  redStop: { tested: 'RED_NO_STOP', loses: ['RED_NO_STOP', 'OVER_STOP_LINE'] },
  greenArrow: { tested: 'RIGHT_ARROW_RED', loses: ['RIGHT_ARROW_RED'] },
  pedestrianFirst: { tested: 'PEDESTRIAN_BLOCKED', loses: ['PEDESTRIAN_BLOCKED'] },
  schoolZoneStop: { tested: 'SCHOOL_ZONE_NO_STOP', loses: ['SCHOOL_ZONE_NO_STOP'] },
  schoolZoneSignal: { tested: 'SCHOOL_ZONE_RED', loses: ['SCHOOL_ZONE_RED'] },
};
export const KEEP_IDS = Object.keys(KEEP_RULES) as KeepBadgeId[];

/** 무위반 연속 뱃지 — 이만큼 이어 가는 동안 갖는다 */
export const STREAKS: Readonly<Record<StreakBadgeId, number>> = { streak5: 5, streak10: 10, streak20: 20 };

/** 모든 뱃지 — **이 차례로 화면에 늘어선다** (법규 지킴 → 연속 → 성장) */
export const BADGES: readonly BadgeDef[] = [
  { id: 'redStop', group: 'keep', name: '적색 일시정지 지킴이', how: '정면 신호가 적색일 때 정지선 앞에서 멈춘 뒤 우회전', steps: KEEP_STEPS },
  { id: 'greenArrow', group: 'keep', name: '녹색 화살표 지킴이', how: '우회전 신호등이 있으면 녹색 화살표일 때만 우회전', steps: KEEP_STEPS },
  { id: 'pedestrianFirst', group: 'keep', name: '보행자 먼저', how: '보행자가 건너거나 건너려 하면 횡단보도 앞에서 멈춤', steps: KEEP_STEPS },
  {
    id: 'schoolZoneStop',
    group: 'keep',
    name: '스쿨존 일시정지',
    how: '어린이보호구역 신호 없는 횡단보도에서는 사람이 없어도 일시정지',
    steps: KEEP_STEPS,
  },
  { id: 'schoolZoneSignal', group: 'keep', name: '스쿨존 신호 지킴이', how: '어린이보호구역 횡단보도 신호가 적색이면 녹색까지 기다림', steps: KEEP_STEPS },
  { id: 'streak5', group: 'streak', name: '안전운전 5연속', how: '위반 없이 5판 연속 — 위반하면 잃습니다', steps: [5] },
  { id: 'streak10', group: 'streak', name: '안전운전 10연속', how: '위반 없이 10판 연속 — 위반하면 잃습니다', steps: [10] },
  { id: 'streak20', group: 'streak', name: '안전운전 20연속', how: '위반 없이 20판 연속 — 위반하면 잃습니다', steps: [20] },
  { id: 'firstClean', group: 'growth', name: '첫 걸음', how: '처음으로 위반 없이 통과', steps: [1] },
  { id: 'habitFixer', group: 'growth', name: '습관 교정가', how: 'AI 가 찾아낸 나쁜 운전 습관을 고침 (1개 · 5개 · 10개)', steps: FIXER_STEPS },
  { id: 'schoolZoneFirst', group: 'growth', name: '스쿨존 첫 완주', how: '어린이보호구역 신호 없는 횡단보도 코스를 처음으로 위반 없이 통과', steps: [1] },
  { id: 'explorer', group: 'growth', name: '상황 탐험가', how: '밤 · 비 · 어린이 · 노인 · 앞차 · 뒤차 경적을 모두 겪음', steps: [SITUATIONS.length] },
  { id: 'leadJudge', group: 'growth', name: '앞차 판단가', how: '앞차가 일시정지를 무시하고 가도 따라가지 않고 규정대로 통과', steps: [1] },
  { id: 'master', group: 'growth', name: '우회전 마스터', how: '레벨 10 을 마치고 우회전 마스터가 됨', steps: [1] },
];

export const badgeDef = (id: BadgeId): BadgeDef => BADGES.find((b) => b.id === id)!;

/** 저장본에 남는 뱃지 상태 */
export interface BadgeState {
  /** 법규 지킴 — 지킨 횟수 (어기면 한 단계 아래의 시작으로 되돌아간다) */
  keep: Record<KeepBadgeId, number>;
  /** 법규 지킴 — 한 번이라도 닿은 가장 높은 단계 (모음 화면이 "최고 금" 처럼 적는다) */
  keepBest: Record<KeepBadgeId, Tier>;
  /** 지금 이어 가는 무위반 연속 (직접 몬 판만) */
  streak: number;
  bestStreak: number;
  /** 고친 나쁜 운전 습관 수 */
  fixed: number;
  /** 겪은 상황 */
  seen: Situation[];
  /** 한 번 얻으면 남는 뱃지 */
  earned: OnceBadgeId[];
}

const zeros = <K extends string, V>(keys: readonly K[], v: V): Record<K, V> =>
  Object.fromEntries(keys.map((k) => [k, v])) as Record<K, V>;

export function freshBadges(): BadgeState {
  return {
    keep: zeros(KEEP_IDS, 0),
    keepBest: zeros(KEEP_IDS, 0 as Tier),
    streak: 0,
    bestStreak: 0,
    fixed: 0,
    seen: [],
    earned: [],
  };
}

/** 저장본에서 읽은 값을 지금 모양에 맞춘다 — 뱃지가 늘어도 예전 저장본이 깨지지 않게 항목마다 채운다 */
export function normalizeBadges(raw: Partial<BadgeState> | undefined): BadgeState {
  const base = freshBadges();
  if (!raw) return base;
  return {
    keep: { ...base.keep, ...(raw.keep ?? {}) },
    keepBest: { ...base.keepBest, ...(raw.keepBest ?? {}) },
    streak: raw.streak ?? 0,
    bestStreak: raw.bestStreak ?? 0,
    fixed: raw.fixed ?? 0,
    seen: (raw.seen ?? []).filter((s) => SITUATIONS.some((x) => x.key === s)),
    earned: (raw.earned ?? []).filter((id) => BADGES.some((b) => b.id === id)),
  };
}

/** 모은 수 → 단계 */
export const tierOf = (n: number, steps: readonly number[]): Tier =>
  (steps.filter((s) => n >= s).length as Tier);

/**
 * **어기면 한 단계 내려가고 그 단계의 처음부터 다시 센다** — 금(25번 이상)에서 어기면 은의 시작(10번), 은에서는 동의
 * 시작(3번), 동에서는 0(뱃지 없음). 아직 동에 못 닿았으면 0 부터 다시 센다.
 */
export function dropOneTier(n: number, steps: readonly number[] = KEEP_STEPS): number {
  const t = tierOf(n, steps);
  return t >= 2 ? steps[t - 2] : 0;
}

/** 지금 갖고 있는 단계 — 뱃지마다 */
export function tiersOf(s: BadgeState): Record<BadgeId, Tier> {
  const out = {} as Record<BadgeId, Tier>;
  for (const id of KEEP_IDS) out[id] = tierOf(s.keep[id], KEEP_STEPS);
  for (const [id, n] of Object.entries(STREAKS) as [StreakBadgeId, number][]) out[id] = s.streak >= n ? 1 : 0;
  for (const id of ['firstClean', 'schoolZoneFirst', 'leadJudge', 'master'] as const) out[id] = s.earned.includes(id) ? 1 : 0;
  out.habitFixer = tierOf(s.fixed, FIXER_STEPS);
  out.explorer = s.seen.length >= SITUATIONS.length ? 1 : 0;
  return out;
}

/** 이 판에서 겪은 상황 */
export function situationsOf(spec: ScenarioSpec): Situation[] {
  const out: Situation[] = [];
  if (spec.timeOfDay === 'night') out.push('night');
  if (spec.weather === 'rain') out.push('rain');
  if (spec.pedestrians.some((p) => p.kind === 'child')) out.push('child');
  if (spec.pedestrians.some((p) => p.kind === 'elder')) out.push('elder');
  if (spec.leadCar) out.push('lead');
  if (spec.rearHonk) out.push('honk');
  return out;
}

/** 뱃지가 한 판에서 어떻게 움직였는가 — 결과 화면이 이 차례로 보여 준다 */
export interface BadgeEvent {
  id: BadgeId;
  /** gain 처음 얻음 · up 단계가 오름 · down 단계가 내려감 · lost 잃음 */
  kind: 'gain' | 'up' | 'down' | 'lost';
  from: Tier;
  to: Tier;
  /** 잃거나 내려간 까닭 — 어느 위반 때문인지 (VIOLATIONS 의 이름) */
  reason?: string;
}

/** 한 판 — 뱃지가 보는 것 */
export interface BadgeRun {
  result: Pick<JudgeResult, 'violations' | 'failReason'> & { lead?: JudgeResult['lead'] };
  spec: ScenarioSpec;
  /** 이 판이 시험한 위반 (library.ts 의 habitsTestedBy) */
  tested: ReadonlySet<ViolationCode>;
  /** 이 판으로 고친 나쁜 습관 수 */
  habitsFixed: number;
  /** 이 판을 마친 뒤 우회전 마스터인가 */
  mastered: boolean;
}

/**
 * 한 판을 마친 뒤의 뱃지와 **얻고 잃은 것.** 순수 함수다.
 */
export function updateBadges(state: BadgeState, run: BadgeRun): { next: BadgeState; events: BadgeEvent[] } {
  const codes = new Set(run.result.violations.map((v) => v.code as ViolationCode));
  const finished = !run.result.failReason;
  const clean = finished && codes.size === 0;
  const pedestrianHit = run.result.failReason === 'PEDESTRIAN_HIT';

  const keep = { ...state.keep };
  const reasons: Partial<Record<BadgeId, string>> = {};
  for (const id of KEEP_IDS) {
    const rule = KEEP_RULES[id];
    const broke = rule.loses.find((c) => codes.has(c));
    if (id === 'pedestrianFirst' && pedestrianHit) {
      // 보행자와 부딪혔다 — 단계와 상관없이 다 잃는다
      keep[id] = 0;
      reasons[id] = '보행자와 부딪혔습니다';
    } else if (broke) {
      keep[id] = dropOneTier(keep[id]);
      reasons[id] = VIOLATIONS[broke].title;
    } else if (finished && run.tested.has(rule.tested)) {
      // 끝까지 달려 그 자리를 지나갔고 어기지 않았다 — 지켜 낸 것이다
      keep[id] += 1;
    }
  }

  const streak = clean ? state.streak + 1 : 0;
  if (!clean) {
    const why = run.result.failReason
      ? '끝까지 가지 못해 연속이 끊겼습니다'
      : `연속이 끊겼습니다 — ${VIOLATIONS[[...codes][0]].title}`;
    for (const id of Object.keys(STREAKS) as StreakBadgeId[]) reasons[id] = why;
  }

  const earned = new Set(state.earned);
  if (clean) earned.add('firstClean');
  if (clean && run.tested.has('SCHOOL_ZONE_NO_STOP')) earned.add('schoolZoneFirst');
  if (clean && run.result.lead?.behavior === 'rolling' && run.result.lead.skippedStops.length > 0) earned.add('leadJudge');
  if (run.mastered) earned.add('master');

  const seen = new Set(state.seen);
  if (finished) for (const s of situationsOf(run.spec)) seen.add(s);

  const keepBest = { ...state.keepBest };
  for (const id of KEEP_IDS) keepBest[id] = Math.max(keepBest[id], tierOf(keep[id], KEEP_STEPS)) as Tier;

  const next: BadgeState = {
    keep,
    keepBest,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    fixed: state.fixed + run.habitsFixed,
    // 화면에 늘어선 차례대로 둔다 — 저장본을 열어 봐도 읽기 쉽게
    seen: SITUATIONS.map((s) => s.key).filter((k) => seen.has(k)),
    earned: BADGES.map((b) => b.id).filter((id): id is OnceBadgeId => earned.has(id as OnceBadgeId)),
  };

  const before = tiersOf(state);
  const after = tiersOf(next);
  const events: BadgeEvent[] = [];
  for (const b of BADGES) {
    const from = before[b.id];
    const to = after[b.id];
    if (from === to) continue;
    const kind = to > from ? (from === 0 ? 'gain' : 'up') : to === 0 ? 'lost' : 'down';
    events.push({ id: b.id, kind, from, to, ...(to < from && reasons[b.id] ? { reason: reasons[b.id] } : {}) });
  }
  return { next, events };
}

/**
 * 지금까지의 **주행 기록으로 뱃지를 채운다** — 뱃지가 생기기 전에 달린 사람이 0개에서 시작하지 않게 (save.ts 의 v12).
 *
 * 기록(RunRecord)에는 위반 코드와 등급만 있어 **알 수 없는 것은 세지 않는다** — 앞차가 실제로 서지 않았는지(앞차 판단가),
 * 어떤 습관을 고쳤는지(습관 교정가), 무엇에 부딪혀 끝났는지(보행자 먼저를 다 잃는가)는 기록에 없다.
 */
export function badgesFromHistory(
  history: readonly { st: number; g: string; v: string[] }[],
  specOf: (id: number) => ScenarioSpec | undefined,
  testedBy: (spec: ScenarioSpec) => ReadonlySet<ViolationCode>,
  mastered: boolean,
): BadgeState {
  let s = freshBadges();
  for (const r of history) {
    const spec = specOf(r.st);
    if (!spec) continue;
    s = updateBadges(s, {
      result: {
        violations: r.v.map((code) => ({ code })) as unknown as JudgeResult['violations'],
        // 무엇으로 끝났는지는 기록에 없다 — '끝까지 못 감' 으로만 친다 (보행자 먼저를 다 잃게 하지 않는다)
        failReason: (r.g === 'FAIL' ? 'UNKNOWN' : null) as JudgeResult['failReason'],
      },
      spec,
      tested: testedBy(spec),
      habitsFixed: 0,
      mastered: false,
    }).next;
  }
  if (mastered) s = { ...s, earned: [...new Set([...s.earned, 'master' as const])] };
  return s;
}

/** 모음 화면의 한 줄 — 다음 단계까지 얼마나 남았는가 */
export function progressOf(s: BadgeState, id: BadgeId): { now: number; next: number | null } {
  const def = badgeDef(id);
  const now =
    def.group === 'keep'
      ? s.keep[id as KeepBadgeId]
      : def.group === 'streak'
        ? s.streak
        : id === 'habitFixer'
          ? s.fixed
          : id === 'explorer'
            ? s.seen.length
            : s.earned.includes(id as OnceBadgeId)
              ? 1
              : 0;
  const next = def.steps.find((x) => now < x) ?? null;
  return { now, next };
}

/** 가진 뱃지 수 (단계가 있는 뱃지도 하나로 센다) */
export const heldCount = (s: BadgeState): number => Object.values(tiersOf(s)).filter((t) => t > 0).length;
