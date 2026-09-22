/**
 * **AI 코치의 답을 못 받았을 때** (coach/client.ts 의 fetchCoaching · ui/Screens.ts 의 fallbackCoach).
 *
 * 사용자가 "AI 답변이 나오지 않고 화면과 같이 나오고 카운트다운이 나왔어" 라고 짚었다. 무료 AI 가 잠깐 한도 · 혼잡으로
 * 거절하자 결과 화면이 코치 칸을 **말없이 지웠다.** 이제는 빨리 실패하면 한 번 더 묻고, 그래도 못 받으면 칸을 남긴 채
 * AI 글이 아니라고 밝히고 판정 기록으로 정리한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCoaching, toCoachRequest } from '../src/coach/client';
import type { JudgeResult } from '../src/rules/lawRules';
import { VIOLATIONS } from '../src/rules/violations';
import { coachLines, fallbackCoach } from '../src/ui/Screens';

const result = (over: Partial<JudgeResult> = {}): JudgeResult =>
  ({
    grade: 'PERFECT',
    failReason: null,
    violations: [],
    stats: {
      cleanStopBeforeA: true,
      lateStopBeforeA: false,
      stopBeforeC: false,
      maxSpeedInIntersection: 14,
      signalAt30m: true,
      elapsed: 21.9,
    },
    log: [],
    lead: null,
    ...over,
  }) as unknown as JudgeResult;

afterEach(() => vi.unstubAllGlobals());

describe('판정 기록으로 정리한 코칭', () => {
  it('규정을 지킨 판은 지킨 것을 짚는다 — 목록으로 그려진다', () => {
    const text = fallbackCoach(result());
    expect(text).toContain('규정을 모두 지켰습니다');
    expect(text).toContain('정지선 앞에서 완전히 멈췄다가 출발했습니다');
    expect(coachLines(text)).toContain('<ul class="coach-list">');
  });

  it('위반마다 고치는 법을 한 번씩 — 같은 위반이 두 번이어도 한 줄', () => {
    const v = { code: 'RED_NO_STOP', atTime: 6, place: '정지선', inSchoolZone: false };
    const text = fallbackCoach(result({ grade: 'VIOLATION', violations: [v, { ...v, atTime: 9 }] } as never));
    expect(text.split('\n')).toHaveLength(1);
    expect(text).toContain(VIOLATIONS.RED_NO_STOP.title);
    expect(text).toContain(VIOLATIONS.RED_NO_STOP.fix);
    expect(text).not.toContain('규정을 모두 지켰습니다');
  });

  it('완주 못 한 판은 그 까닭부터', () => {
    const text = fallbackCoach(result({ grade: 'FAIL', failReason: 'PEDESTRIAN_HIT' } as never));
    expect(text.split('\n')[0]).toContain('보행자를 치었습니다');
  });
});

describe('코치에게 한 번 더 묻기', () => {
  const req = toCoachRequest(1, '정면신호 적색', result());
  const ok = { ok: true, status: 200, json: () => Promise.resolve({ text: '- 좋았습니다', provider: 'groq', model: 'm' }) };
  const busy = { ok: false, status: 502, text: () => Promise.resolve('{"error":"UPSTREAM_ERROR","status":429}') };

  it('빨리 실패하면 다시 물어 받는다', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(busy).mockResolvedValueOnce(ok);
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const advice = await fetchCoaching(req);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(advice?.text).toBe('- 좋았습니다');
  });

  it('늦게 실패한 것은 다시 묻지 않는다 — 결과 화면이 더 오래 기다리지 않게', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(0).mockReturnValue(10_000);
    const fetch = vi.fn().mockResolvedValue(busy);
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await fetchCoaching(req)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });
});
