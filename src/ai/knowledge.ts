/**
 * **학습자 모델 — 베이즈 지식 추적 (Bayesian Knowledge Tracing, BKT).**
 *
 * 개념(=위반 코드 하나가 지키는 규칙)마다 "이 사람이 이 개념을 익혔을 확률" 하나를 둔다. 판이 끝날 때마다
 * 그 판이 **시험한** 개념(library.ts 의 habitsTestedBy)에 대해 지켰는가 · 어겼는가를 관측으로 넣어 베이즈 갱신을 한다.
 * 곱셈 몇 번이라 브라우저에서 판마다 돈다.
 *
 * ## 왜 '습관 목록' 위에 이것을 두는가
 *
 * 나쁜 습관 목록(coach/badHabits.ts)은 횟수와 연속 무위반 판 수다 — 증거의 장부다. 이 모델은 그 증거를 **확률**로
 * 옮긴다. 한 번 지키면 0.3 → 0.79, 두 번 이어 지키면 0.97 로 확신에 가까워지고, 한 번 어기면 크게 내려간다
 * (0.97 → 0.53, 0.79 → 0.26). 레벨업은 이 확률이 **이 판이 시험한 개념에서 기준(MASTERY_GATE)을 넘을 때**만 허락한다
 * (curriculum.ts 의 advance) — 한 판 지키면 넘는 기준이라 진급 속도는 그대로이고, **위험했던 판**만 넘지 못한다.
 *
 * ## 위험했던 판은 반쯤 지킨 것으로 본다
 *
 * 위반 없이 지났어도 위험도(ai/risk.ts)가 높았던 판 — 보행자를 보고 늦게 제동, 시간 여유가 거의 없음 — 은
 * "지켰다" 를 그대로 믿지 않는다. 지킨 관측과 어긴 관측의 사후확률을 위험도만큼 섞는다. 판정 엔진은 그대로
 * 위반 없음이지만, 모델은 겨우 지킨 것을 익힌 것으로 세지 않는다.
 *
 * 매개변수는 네 개다 — 처음 알 확률 L0, 한 판에 익힐 확률 T, 알면서 실수할 확률 S, 모르면서 맞힐 확률 G.
 * 학습자 수가 적어 개념마다 따로 맞추지 않고 하나로 둔다. 순수 모듈이다.
 */

import type { ViolationCode } from '../rules/violations';
import { recall } from './forgetting';

export interface SkillState {
  /** 익혔을 확률 0~1 */
  p: number;
  /** 관측 수 (시험된 판 수) */
  n: number;
  /** 지킨 · 어긴 횟수 */
  ok: number;
  miss: number;
  /** 마지막으로 시험된 때 (ms, Date.now) — 망각 모델이 읽는다 */
  last: number;
}

export type Knowledge = Partial<Record<ViolationCode, SkillState>>;

/**
 * BKT 매개변수 — L0 처음 알 확률 · T 한 판에 익힐 확률 · S 알면서 실수 · G 모르면서 맞힘.
 * S 와 G 를 흔한 값(0.1 · 0.2)보다 낮게 둔다 — 이 게임의 위반은 실수보다 **판단**이라, 한 번 어긴 것을 실수로 봐주면
 * (S 0.1 이면 0.94 가 0.72 로만, 0.05 여도 0.97 이 0.70 으로만 내려간다) 방금 어긴 개념이 약한 개념으로 드러나지 않는다.
 */
export const BKT = { L0: 0.3, T: 0.2, S: 0.02, G: 0.15 } as const;

/** 이 아래면 '약한 개념' — 추천이 먼저 시험하고 화면이 붉게 표시한다 */
export const WEAK_BELOW = 0.7;
/**
 * 레벨업 · 마스터를 허락하는 기준 — 이 판이 시험한 개념이 모두 이 이상이어야 한다. 한 판 지키면 0.79 라 넘고,
 * 위험했던 판(위험도 0.6 으로 누그러뜨린 관측)은 0.44 라 못 넘는다. 진급 속도(무위반 두 판)는 그대로 두고 위험한
 * 통과만 걸러내는 자리다.
 */
export const MASTERY_GATE = 0.7;
/** 위험도가 관측을 누그러뜨리는 최대치 — 위험해도 위반은 아니었으므로 반보다 조금 넘게만 */
const RISK_BLEND_MAX = 0.6;

/**
 * 화면과 프롬프트가 쓰는 개념 순서 — 레이더 차트의 축이기도 하다.
 * 방향지시등(NO_TURN_SIGNAL)은 없다 — 판을 시작하면 저절로 켜져 끌 수 없으므로 배울 것이 없다 (game/Controls.ts).
 */
export const SKILL_ORDER: readonly ViolationCode[] = [
  'RED_NO_STOP',
  'PEDESTRIAN_BLOCKED',
  'SCHOOL_ZONE_NO_STOP',
  'OVER_STOP_LINE',
  'NO_SLOW_DOWN',
  'BIKE_BLOCKED',
  'BLOCKING_INTERSECTION',
  'SCHOOL_ZONE_RED',
  'RIGHT_ARROW_RED',
  'WIDE_TURN',
  'STRAIGHT_RED',
];

/** 개념의 짧은 이름 — 레이더 축과 결과 화면 한 줄에 쓴다 (긴 이름은 coach/badHabits.ts 의 habitTitle) */
export const SKILL_SHORT: Record<ViolationCode, string> = {
  RED_NO_STOP: '적색 일시정지',
  RIGHT_ARROW_RED: '우회전 신호등',
  PEDESTRIAN_BLOCKED: '보행자 양보',
  BIKE_BLOCKED: '자전거 양보',
  SCHOOL_ZONE_NO_STOP: '보호구역 정지',
  NO_SLOW_DOWN: '교차로 서행',
  WIDE_TURN: '우측 통행',
  BLOCKING_INTERSECTION: '꼬리물기',
  NO_TURN_SIGNAL: '방향지시등',
  OVER_STOP_LINE: '정지선 준수',
  SCHOOL_ZONE_RED: '보호구역 신호',
  STRAIGHT_RED: '적색 직진',
};

const fresh = (): SkillState => ({ p: BKT.L0, n: 0, ok: 0, miss: 0, last: 0 });

/** 익혔을 확률 — 한 번도 시험되지 않았으면 L0 */
export const mastery = (k: Knowledge, code: ViolationCode): number => k[code]?.p ?? BKT.L0;

/** 시험된 적이 있는가 */
export const wasTested = (k: Knowledge, code: ViolationCode): boolean => (k[code]?.n ?? 0) > 0;

/**
 * 관측 하나를 넣는다 — 그 개념을 지켰는가(correct). 새 객체를 돌려준다.
 *
 * @param risk 이 판의 위험도 0~1 (ai/risk.ts). 지킨 관측만 누그러뜨린다 — 어긴 것은 어긴 것이다.
 */
export function observe(
  k: Knowledge,
  code: ViolationCode,
  correct: boolean,
  opts: { risk?: number; now?: number } = {},
): Knowledge {
  const s = k[code] ?? fresh();
  const { S, G, T } = BKT;
  const p = s.p;
  const postCorrect = (p * (1 - S)) / (p * (1 - S) + (1 - p) * G);
  const postWrong = (p * S) / (p * S + (1 - p) * (1 - G));
  let post: number;
  if (correct) {
    const w = Math.min(RISK_BLEND_MAX, Math.max(0, opts.risk ?? 0));
    post = (1 - w) * postCorrect + w * postWrong;
  } else {
    post = postWrong;
  }
  const learned = post + (1 - post) * T;
  return {
    ...k,
    [code]: {
      p: clamp01(learned),
      n: s.n + 1,
      ok: s.ok + (correct ? 1 : 0),
      miss: s.miss + (correct ? 0 : 1),
      last: opts.now ?? Date.now(),
    },
  };
}

/** 한 판의 결과를 통째로 넣는다 — 시험한 개념마다 어겼으면 어김, 아니면 지킴 */
export function updateKnowledge(
  k: Knowledge,
  tested: Iterable<ViolationCode>,
  violated: Iterable<ViolationCode>,
  opts: { risk?: number; now?: number } = {},
): Knowledge {
  const bad = new Set(violated);
  let out = k;
  for (const code of new Set(tested)) out = observe(out, code, !bad.has(code), opts);
  return out;
}

/** 기억이 옅어진 만큼 깎은 **실효 숙달** — 숙달 × 회상 확률 (ai/forgetting.ts) */
export function effectiveMastery(k: Knowledge, code: ViolationCode, now = Date.now()): number {
  const s = k[code];
  if (!s) return BKT.L0;
  return s.p * recall(s, now);
}

/** 약한 개념 — 실효 숙달이 낮은 순 (시험된 것만) */
export function weakSkills(k: Knowledge, now = Date.now(), below = WEAK_BELOW): { code: ViolationCode; p: number }[] {
  return SKILL_ORDER.filter((c) => wasTested(k, c))
    .map((code) => ({ code, p: effectiveMastery(k, code, now) }))
    .filter((x) => x.p < below)
    .sort((a, b) => a.p - b.p);
}

/**
 * 레벨업을 **붙잡는 개념** — 시험된 적이 있는데 아직 기준(MASTERY_GATE)에 못 미친 것.
 * `among` 을 주면 그 개념들만 본다 (그 레벨이 여는 개념).
 */
export function heldBy(k: Knowledge, among?: Iterable<ViolationCode>): ViolationCode[] {
  const codes = among ? [...among] : SKILL_ORDER;
  return codes.filter((c) => wasTested(k, c) && mastery(k, c) < MASTERY_GATE);
}

/** 레이더 차트 한 벌 — 개념 순서대로 실효 숙달. 시험되지 않은 개념은 `null` */
export function skillProfile(k: Knowledge, now = Date.now()): { code: ViolationCode; label: string; p: number | null }[] {
  return SKILL_ORDER.map((code) => ({
    code,
    label: SKILL_SHORT[code],
    p: wasTested(k, code) ? effectiveMastery(k, code, now) : null,
  }));
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
