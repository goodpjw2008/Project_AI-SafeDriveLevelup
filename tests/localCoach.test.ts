/**
 * **로컬 코치** (src/ai/localCoach.ts) — 'AI 사용 설정' 이 로컬이면 결과 화면의 주행결과 분석과 습관 진단을 브라우저 안의 신경망이
 * 쓴다 (사용자가 정했다, 2026-11-01). 외부 LLM 이 미리 쓴 문장 은행에서 신경망이 고른다.
 *
 * 여기서 못 박는 것은 **거짓말을 하지 않는다**는 약속이다 — 그 판에 없던 위반 · 조건의 문장은 나오지 않고, 습관 진단의 숫자는
 * 집계의 값 그대로다. 신경망이 무엇을 고르든 이 둘은 지켜져야 한다.
 */
import { describe, expect, it } from 'vitest';

import {
  COACH_CODES,
  COACH_SITUATION_FEATURES,
  REPORT_SITUATION_FEATURES,
  coachModelReady,
  coachSituation,
  localCoaching,
  localHabitReport,
  reportSituation,
  type CoachModel,
  type CoachSituation,
} from '../src/ai/localCoach';
import trained from '../src/ai/models/coach.json';
import type { HabitSummary } from '../src/coach/habits';
import type { JudgeResult } from '../src/rules/lawRules';
import type { ViolationCode } from '../src/rules/violations';
import { scenarioLibrary } from '../src/scenarios/library';

const model = trained as unknown as CoachModel;

const result = (
  violations: { code: ViolationCode; place: string }[],
  over: Partial<Pick<JudgeResult, 'failReason' | 'lead'>> = {},
): Pick<JudgeResult, 'grade' | 'violations' | 'failReason' | 'stats' | 'lead'> => ({
  grade: over.failReason ? 'FAIL' : violations.length ? 'VIOLATION' : 'PERFECT',
  violations: violations.map((v) => ({ ...v, atTime: 3, atPosition: { x: 0, z: 0 }, inSchoolZone: false, daytime: true })),
  failReason: over.failReason ?? null,
  stats: {
    cleanStopBeforeA: true,
    lateStopBeforeA: false,
    stopBeforeC: false,
    maxSpeedInIntersection: 14,
    signalAt30m: true,
    elapsed: 30,
  } as JudgeResult['stats'],
  lead: over.lead ?? undefined,
});

/** 이 줄은 은행의 어느 자리 것인가 */
const keyOf = (line: string): string | undefined => model.bank.find((b) => b.text === line)?.key;

describe('로컬 코치 — 모델', () => {
  it('학습한 모델이 있고 입력 이름이 지금 코드와 같다 — 바꾸면 npm run train:coach', () => {
    expect(model.coach.situation).toEqual([...COACH_SITUATION_FEATURES]);
    expect(model.report.situation).toEqual([...REPORT_SITUATION_FEATURES]);
    expect(coachModelReady()).toBe(true);
  });

  it('은행의 문장은 한국어 · 숫자 없음(규정의 수 빼고) · 자리마다 하나 이상', () => {
    for (const b of model.bank) {
      expect(b.text, b.text).not.toMatch(/[぀-ヿ一-鿿]/);
      if (!b.key.startsWith('r:')) expect(b.text.replace(/30m|20km\/h|0\.5m/g, ''), b.text).not.toMatch(/\d/);
    }
    const keys = new Set(model.bank.map((b) => b.key));
    for (const c of COACH_CODES) expect(keys.has(`next:${c}`), c).toBe(true);
    expect(keys.has('clean:general')).toBe(true);
  });
});

describe('로컬 코치 — 주행결과 분석', () => {
  it('자리를 가른다 — 우회전 후 횡단보도의 보행자 방해, 앞차를 따라간 적색 무정지', () => {
    const after = coachSituation(result([{ code: 'PEDESTRIAN_BLOCKED', place: '우회전 후 횡단보도(C) 위' }]), undefined);
    expect(after.keys).toContain('issue:PEDESTRIAN_BLOCKED:after');
    const before = coachSituation(result([{ code: 'PEDESTRIAN_BLOCKED', place: '횡단보도 A 위' }]), undefined);
    expect(before.keys).toContain('issue:PEDESTRIAN_BLOCKED:before');
    const lead = coachSituation(
      result([{ code: 'RED_NO_STOP', place: '정지선 위' }], {
        lead: { behavior: 'rolling', skippedStops: [{ at: 'A', t: 3 }], minGap: 4 } as unknown as JudgeResult['lead'],
      }),
      undefined,
    );
    expect(lead.keys).toContain('issue:RED_NO_STOP:lead');
  });

  /*
    **그 판에 없던 위반을 말하지 않는다** — 위반 조합 여러 가지를 백 번씩 돌려, 나온 줄이 모두 그 판의 자리 것인지 본다.
  */
  it('나온 줄은 모두 그 판에 있었던 위반 · 실패의 자리 것이다', () => {
    const cases: CoachSituation[] = [
      coachSituation(result([{ code: 'RED_NO_STOP', place: '정지선 위' }]), undefined),
      coachSituation(result([{ code: 'PEDESTRIAN_BLOCKED', place: '우회전 후 횡단보도(C) 위' }, { code: 'NO_TURN_SIGNAL', place: '접근로' }]), undefined),
      coachSituation(result([{ code: 'SCHOOL_ZONE_NO_STOP', place: '횡단보도 A 위' }], { failReason: 'PEDESTRIAN_HIT' }), undefined),
      coachSituation(result([], { failReason: 'TIMEOUT' }), undefined),
    ];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const s of cases) {
      for (let i = 0; i < 100; i++) {
        const text = localCoaching(s, rnd)!;
        const lines = text.split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines.length).toBeLessThanOrEqual(4);
        for (const l of lines) expect(s.keys, l).toContain(keyOf(l));
        // 위반이 있으면 마지막은 '다음 판' 줄이다
        if (s.codes.length) expect(lines[lines.length - 1]).toMatch(/^- 다음 판 — /);
      }
    }
  });

  it('위반 없이 마친 판은 칭찬 한두 줄 — 그 판에 있던 조건만 얹는다', () => {
    const rain = scenarioLibrary().find((e) => e.tags.env === 'rain' && e.tags.lead === 'none')!;
    const s = coachSituation(result([]), rain.tags);
    expect(s.clean).toBe(true);
    for (let i = 0; i < 50; i++) {
      const lines = localCoaching(s)!.split('\n');
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const l of lines) expect(s.keys, l).toContain(keyOf(l));
      expect(lines.join(' ')).not.toMatch(/앞차/);
    }
  });
});

describe('로컬 코치 — 습관 진단', () => {
  const summary = (over: Partial<HabitSummary> = {}): HabitSummary => ({
    runs: 12,
    stagesPlayed: 9,
    grades: { PERFECT: 4, PASS: 2, VIOLATION: 6 },
    byCode: [
      { code: 'PEDESTRIAN_BLOCKED', count: 4 },
      { code: 'RED_NO_STOP', count: 2 },
    ],
    points: [
      { label: '정지선 앞 완전정지', kept: 11, total: 12, rate: 11 / 12 },
      { label: '우회전 후 횡단보도 앞 정지', kept: 3, total: 12, rate: 3 / 12 },
      { label: '교차로 내 서행 (20km/h 이하)', kept: 12, total: 12, rate: 1 },
      { label: '30m 전 방향지시등', kept: 12, total: 12, rate: 1 },
    ],
    trend: { early: 0.33, late: 0.67 },
    mostRetried: null,
    cleanRuns: 6,
    ...over,
  });

  it('빈칸은 모두 채워지고, 숫자는 집계의 값만 나온다', () => {
    const s = summary();
    const allowed = new Set(['12', '11', '3', '4', '2', '92', '25', '100', '33', '67', '30', '20']);
    for (let i = 0; i < 100; i++) {
      const text = localHabitReport(reportSituation(s))!;
      expect(text).not.toMatch(/\{[a-z]+\}/);
      for (const n of text.match(/\d+/g) ?? []) expect(allowed, `${n} — ${text}`).toContain(n);
    }
  });

  it('추이가 없으면 나아졌다 · 나빠졌다를 말하지 않는다', () => {
    const s = reportSituation(summary({ trend: null }));
    expect(s.keys.some((k) => k.startsWith('r:trend:'))).toBe(false);
    for (let i = 0; i < 30; i++) expect(localHabitReport(s)!).not.toMatch(/초반|후반/);
  });
});
