/**
 * **앞차 차례를 모델이 어겼을 때 어떻게 되는가** (scenarios/generate.ts 의 `Plan.lead`).
 *
 * 비율은 여러 판에 걸쳐 나타나는 성질이라 판 하나를 만드는 모델이 맞출 수 있는 것이 아니다.
 * 그래서 브라우저가 굴려 정하고, 어긴 판은 **사유를 붙여 돌려보낸다** — 보호구역과 같은 방식이다.
 * 여기서 확인하는 것은 그 되돌려보내기가 실제로 걸리는가, 그리고 마지막 시도에서는 봐주는가다.
 * (모델 대신 가짜 서버가 답한다 — 이 검사에 필요한 것은 우리 쪽 판단이라 실제 호출은 하지 않는다)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateScenario } from '../src/scenarios/generate';
import { getScenario, leadSpecFor, type LeadPlan } from '../src/scenarios/scenarios';
import type { HabitSummary } from '../src/coach/habits';

const habits: HabitSummary = {
  runs: 6,
  stagesPlayed: 3,
  grades: { PASS: 4, VIOLATION: 2 },
  byCode: [{ code: 'RED_NO_STOP', count: 2 }],
  points: [],
  trend: null,
  mostRetried: null,
  cleanRuns: 4,
};

/** 모델이 늘 이 판을 뱉는다고 치고 서버를 흉내 낸다 */
function fakeServer(lead: ReturnType<typeof leadSpecFor> | undefined): void {
  const base = structuredClone(getScenario(2));
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          spec: {
            ...base,
            title: '정면신호 적색 - 앞차',
            why: '테스트',
            ...(lead ? { leadCar: lead } : {}),
          },
        }),
    } as unknown as Response),
  );
}

const plan = (lead: LeadPlan | null) =>
  ({ level: 10, target: null, badHabits: [], schoolZone: false, lead }) as const;

afterEach(() => vi.unstubAllGlobals());

describe('앞차 차례 — 모델이 어겼을 때', () => {
  it('차례가 아닌데 앞차를 넣어 오면 사유를 붙여 돌려보낸다', async () => {
    fakeServer(leadSpecFor('rolling'));
    const out = await generateScenario(habits, [], plan(null));
    const said = out.rejected.flatMap((r) => r.issues.map((i) => i.message)).join('\n');
    expect(said).toContain('앞차가 나올 차례가 아닙니다');
  });

  it('종류가 다르면 어떤 앞차여야 하는지 적어 돌려보낸다', async () => {
    fakeServer(leadSpecFor('lawful'));
    const out = await generateScenario(habits, [], plan('straight'));
    const said = out.rejected.flatMap((r) => r.issues.map((i) => i.message)).join('\n');
    expect(said).toContain('직진 대기');
    expect(said).toContain('"path":"straight"');
  });

  it('앞차를 빠뜨려도 돌려보낸다', async () => {
    fakeServer(undefined);
    const out = await generateScenario(habits, [], plan('rolling'));
    const said = out.rejected.flatMap((r) => r.issues.map((i) => i.message)).join('\n');
    expect(said).toContain('앞차');
  });

  it('시킨 대로 만들어 오면 그대로 통과한다 — 한 번 만에', async () => {
    fakeServer(leadSpecFor('rolling'));
    const out = await generateScenario(habits, [], plan('rolling'));
    expect(out.scenario?.leadCar).toEqual(leadSpecFor('rolling'));
    expect(out.tries).toBe(1);
    expect(out.rejected).toEqual([]);
  });

  /*
    **마지막 시도에서는 봐준다.** 옳고 그름이 아니라 비율의 문제라, 판 하나를 못 만들어
    학습자를 빈 메뉴로 돌려보내는 것보다 앞차가 한 번 더 나오는 편이 낫다.
  */
  it('세 번째 시도에서도 어기면 그대로 받아 준다 — 판이 없는 것보다 낫다', async () => {
    fakeServer(leadSpecFor('lawful'));
    const out = await generateScenario(habits, [], plan(null));
    expect(out.scenario, '판은 나온다').not.toBeNull();
    expect(out.tries).toBe(3);
  });
});

/**
 * **"다음 판을 만드는 중…" 에서 멈추지 않는가.**
 *
 * 모델이 `pedestrians` 를 빼먹은 판을 돌려주자, 예산을 재는 코드가 검증보다 먼저 돌다
 * 예외를 냈고 판 만들기가 통째로 멈췄다 — 버튼은 "만드는 중" 인 채로 굳었다.
 * 모양이 깨진 판은 예외 없이 **사유를 붙여 돌려보내야** 한다.
 */
describe('모양이 깨진 판', () => {
  it('보행자 배열이 없는 판이 와도 예외 없이 돌려보낸다', async () => {
    const base = structuredClone(getScenario(2)) as unknown as Record<string, unknown>;
    delete base.pedestrians;
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ spec: { ...base, why: '테스트' } }),
      } as unknown as Response),
    );
    const out = await generateScenario(habits, [], plan('straight'));
    expect(out.scenario).toBeNull();
    expect(out.reason).toBe('invalid');
    const said = out.rejected.flatMap((r) => r.issues.map((i) => i.message)).join('\n');
    expect(said).toContain('pedestrians');
  });
});
