/**
 * 주행 이력 → 습관 집계.
 *
 * **세는 일은 전부 여기서 한다. AI 는 문장만 쓴다.**
 *
 * "정지선 준수율 90%" 는 세면 나오는 값이라 모델에게 시킬 이유가 없다 — 시키면
 * 100% 이던 정확도가 내려가고, 틀려도 아무도 모른다. 모델이 규칙보다 잘하는 것은
 * *"규정을 모르는 게 아니라 재촉받을 때 무너집니다"* 처럼 **여러 수치를 가로질러
 * 사람의 말로 옮기는 일**이고, 그 재료를 여기서 만들어 넘긴다.
 *
 * Three.js 도 DOM 도 쓰지 않는 순수 모듈이라 화면 없이 단위 테스트로 검증한다
 * (판정 엔진 rules/lawRules.ts 와 같은 원칙이다).
 */

import type { RunRecord } from '../economy/save';

/** 서행 판정 기준 — 판정 엔진의 SLOW_DOWN_LIMIT_KMH 와 같은 값이어야 한다 */
const SLOW_LIMIT_KMH = 20;

/** 이 아래로는 진단하지 않는다 — 두세 판으로 '습관'을 말하면 그건 점집이다 */
export const MIN_RUNS = 5;

export interface HabitPoint {
  /** 화면과 프롬프트가 함께 쓰는 이름 */
  label: string;
  /** 지킨 판 수 */
  kept: number;
  /** 전체 판 수 */
  total: number;
  /** 0~1 */
  rate: number;
}

export interface HabitSummary {
  runs: number;
  /** 서로 다른 Stage 를 몇 개나 돌았는가 */
  stagesPlayed: number;
  /** 등급별 판 수 */
  grades: Record<string, number>;
  /** 위반 코드별 횟수 — 많은 순 */
  byCode: { code: string; count: number }[];
  /** 지점별 준수율 — 어디서 무너지는지 */
  points: HabitPoint[];
  /**
   * 개선 추이 — 앞 절반과 뒤 절반의 무위반율.
   *
   * 판이 적으면 `null` 이다. 8판을 4:4 로 갈라 놓고 "나아지고 있습니다" 라고 말하면
   * 한 판 차이로 결론이 뒤집힌다.
   */
  trend: { early: number; late: number } | null;
  /** 가장 많이 다시 돈 판 — 어디서 막혔는지 */
  mostRetried: { stage: number; count: number } | null;
  /** 위반이 한 번도 없던 판 수 */
  cleanRuns: number;
}

const rate = (kept: number, total: number): number => (total ? kept / total : 0);

/** 추이를 말하려면 양쪽에 최소 이만큼씩은 있어야 한다 */
const TREND_MIN_HALF = 4;

export function summarize(history: RunRecord[]): HabitSummary {
  const runs = history.length;

  const grades: Record<string, number> = {};
  for (const r of history) grades[r.g] = (grades[r.g] ?? 0) + 1;

  const codeCount = new Map<string, number>();
  for (const r of history) {
    for (const c of r.v) codeCount.set(c, (codeCount.get(c) ?? 0) + 1);
  }
  const byCode = [...codeCount.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  /*
    네 지점을 따로 센다. 이 게임이 가르치는 것이 "우회전"이라는 한 동작이라도,
    사람이 무너지는 자리는 **정지선 앞**과 **진출 횡단보도 앞**으로 갈린다 —
    앞은 잘 서면서 뒤에서 성급한 사람이 가장 흔하고, 그 둘을 합쳐 놓으면
    "대체로 잘한다" 는 무의미한 하나의 숫자가 된다.
  */
  const points: HabitPoint[] = [
    {
      label: '정지선 앞 완전정지',
      kept: history.filter((r) => r.sa).length,
      total: runs,
      rate: 0,
    },
    {
      label: '우회전 후 횡단보도 앞 정지',
      kept: history.filter((r) => r.sc).length,
      total: runs,
      rate: 0,
    },
    {
      label: `교차로 내 서행 (${SLOW_LIMIT_KMH}km/h 이하)`,
      kept: history.filter((r) => r.sp <= SLOW_LIMIT_KMH).length,
      total: runs,
      rate: 0,
    },
    {
      label: '30m 전 방향지시등',
      kept: history.filter((r) => r.sg).length,
      total: runs,
      rate: 0,
    },
  ].map((p) => ({ ...p, rate: rate(p.kept, p.total) }));

  const clean = (r: RunRecord): boolean => r.v.length === 0;

  let trend: HabitSummary['trend'] = null;
  if (runs >= TREND_MIN_HALF * 2) {
    const half = Math.floor(runs / 2);
    const early = history.slice(0, half);
    const late = history.slice(runs - half); // 홀수면 가운데 한 판은 양쪽 다 빠진다
    trend = {
      early: rate(early.filter(clean).length, early.length),
      late: rate(late.filter(clean).length, late.length),
    };
  }

  const stageCount = new Map<number, number>();
  for (const r of history) stageCount.set(r.st, (stageCount.get(r.st) ?? 0) + 1);
  const retried = [...stageCount.entries()]
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count)[0];

  return {
    runs,
    stagesPlayed: stageCount.size,
    grades,
    byCode,
    points,
    trend,
    // 한 번씩만 돈 사람에게 "3번 판에서 막혔습니다" 라고 말할 수는 없다
    mostRetried: retried && retried.count >= 2 ? retried : null,
    cleanRuns: history.filter(clean).length,
  };
}

/**
 * 가장 약한 지점 — 화면이 강조하고 프롬프트가 먼저 언급한다.
 *
 * 준수율이 같으면 **뒤쪽 지점**을 고른다. 정지선과 진출 횡단보도가 똑같이 80%라면
 * 진출 쪽이 더 나쁜 신호다 — 그쪽이 이 게임이 교정하려는 오해에 직접 걸리고,
 * 실제 사고도 그 자리에서 난다.
 */
export function weakestPoint(s: HabitSummary): HabitPoint | null {
  if (!s.points.length) return null;
  return s.points.reduce((worst, p) => (p.rate <= worst.rate ? p : worst));
}
