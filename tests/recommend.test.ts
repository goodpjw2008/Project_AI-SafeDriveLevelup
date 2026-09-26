/**
 * **AI 코스 추천** (scenarios/recommend.ts · server/recommend*.mjs).
 *
 * AI 는 검증된 라이브러리 안에서만 고른다 — 이 테스트가 확인하는 것은 그 울타리다.
 *  - 후보가 레벨 예산 · 보호구역/앞차 차례 · 최근 판 빼기를 지키는가
 *  - AI 에게 보여 주는 후보 코스가 약점 코스 · 쉬운 코스 · 서로 다른 모양을 담는가
 *  - AI 가 후보 밖의 번호를 대면 버리는가
 *  - AI 가 없어도 판이 나오는가
 * 모델 대신 가짜 서버가 답한다 — 실제 호출은 하지 않는다.
 */

import { challengeRule } from '../src/scenarios/challenge';
import { SCHOOL_ZONE_CHANCE, ZONE_NO_SIGNAL_CHANCE } from '../src/scenarios/scenarios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildUserPrompt, HABIT_CLEARED_AFTER as PROMPT_HABIT_CLEARED } from '../server/recommendPrompt.mjs';
import { parseReply, sanitize } from '../server/recommendHandler.mjs';
import { HABIT_CLEARED_AFTER } from '../src/coach/badHabits';
import type { HabitSummary } from '../src/coach/habits';
import type { Plan } from '../src/scenarios/generate';
import type { Difficulty } from '../src/scenarios/curriculum';
import { libraryEntry } from '../src/scenarios/library';
import { isCombinedLevel, levelGuide } from '../src/scenarios/library';
import {
  candidatesFor,
  coursesByHabit,
  coverageOf,
  priorityHabits,
  recommendPayload,
  masterPick,
  noSignalZoneDue,
  NO_SIGNAL_ZONE_GAP,
  PICKER_LABEL,
  recommendScenario,
  rulePick,
  seenShapes,
  shortlist,
} from '../src/scenarios/recommend';
import { isNoSignalZone, scenarioLibrary, zoneKindOf, type LibraryEntry } from '../src/scenarios/library';

/*
  **마스터 운행** — L10 을 마치면 '처음부터 다시 시작' 전까지 L10 코스가 무작위로 이어진다 (masterPick).
  사용자가 "마스터 단계가 되고, 처음부터 다시 시작을 누르기 전까지는 랜덤으로 10 단계의 문제들이 계속 돌아가게" 라고 했다.
*/
/*
  **누가 골랐는지 화면이 그대로 말한다** — 사용자가 정했다: "Gemini가 골라줬습니다!!! Groq가 골라줬습니다!!!
  이런 식으로 나오면 더 재미있을 것 같아." 무료 AI 여러 곳을 돌아가며 쓰므로(server/llm.mjs) 판마다 다르다.
  **코드가 고른 판에 AI 이름을 쓰면 거짓말이 된다** — 그 경계를 여기서 못 박는다.
*/
describe('고른 쪽 이름', () => {
  it('이름표는 아는 값만 — 모르는 값이 화면에 나오지 않는다', () => {
    expect(Object.keys(PICKER_LABEL).sort()).toEqual([
      'cerebras',
      'gemini',
      'groq',
      'nvidia',
      'openai',
      'openrouter',
      'quota',
      'random',
      'rule',
    ]);
    expect(PICKER_LABEL.gemini).toBe('Gemini');
    expect(PICKER_LABEL.cerebras).toBe('Cerebras');
  });

  it('코드가 고른 판은 AI 이름을 쓰지 않는다 — 고르지도 않은 모델을 띄우면 거짓말이다', () => {
    expect(PICKER_LABEL.rule).not.toMatch(/Gemini|Groq|OpenAI/i);
    expect(PICKER_LABEL.random).not.toMatch(/Gemini|Groq|OpenAI/i);
  });

  /*
    **한도 초과와 'AI 가 아예 없음' 은 다른 말이다.** 서버가 마지막으로 두드린 곳의 상태(429)를 함께 보내고,
    브라우저가 그것을 보고 가른다 — 없는 것을 "다 썼다" 고 말하면 거짓말이다.
  */
  it('한도를 다 쓰면 그렇게 말한다 (429) — 서버가 없으면 그렇게 말하지 않는다', async () => {
    const plan = { level: 4, target: null, badHabits: [], schoolZone: false, lead: null, challenge: 3 } as never;
    const ask = (status: number, body: string) =>
      vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status, text: () => Promise.resolve(body) }));

    ask(502, JSON.stringify({ error: 'UPSTREAM_ERROR', status: 429 }));
    expect((await recommendScenario(plan, habits, [], [])).picker).toBe('quota');

    // 못 닿은 것은 한도 초과가 아니다
    ask(502, JSON.stringify({ error: 'UPSTREAM_UNREACHABLE', status: 0 }));
    expect((await recommendScenario(plan, habits, [], [])).picker).toBe('rule');

    // 서버·키가 없는 배포 (503) — 처음부터 AI 가 없다
    ask(503, '');
    expect((await recommendScenario(plan, habits, [], [])).picker).toBe('rule');
    vi.unstubAllGlobals();
  });

  it('마스터 운행은 무작위라고 말한다 — 고른 AI 가 없다', () => {
    const pick = masterPick([]);
    expect(pick.picker).toBe('random');
    expect(pick.scenario.picker).toBe('random');
  });
});

describe('마스터 운행', () => {
  const l10 = () => scenarioLibrary().filter((e) => e.level === 10);

  it('늘 L10 코스를 고른다 — 고르게 무작위로', () => {
    const pool = l10();
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const pick = masterPick([]).scenario;
      expect(pool.some((e) => e.spec.id === pick.id), pick.title).toBe(true);
      expect(pick.level).toBe(10);
      seen.add(pick.id);
    }
    // 400번 뽑아 서로 다른 판이 넉넉히 나온다 (한 판에 몰리지 않는다)
    expect(seen.size).toBeGreaterThan(300);
  });

  it('난수의 양 끝에서도 L10 안에서 고른다', () => {
    const pool = l10();
    expect(masterPick([], () => 0).scenario.id).toBe(pool[0].spec.id);
    expect(masterPick([], () => 0.999999).scenario.id).toBe(pool[pool.length - 1].spec.id);
  });

  it('최근에 탄 판은 곧바로 다시 나오지 않는다', () => {
    const first = l10()[0].spec.id;
    expect(masterPick([first], () => 0).scenario.id).not.toBe(first);
  });

  it('왜 이 판인지 — 무작위라고 말한다', () => {
    expect(masterPick([]).scenario.why).toContain('무작위');
  });
});

const habits: HabitSummary = {
  runs: 9,
  stagesPlayed: 5,
  grades: { PASS: 6, VIOLATION: 3 },
  byCode: [{ code: 'RED_NO_STOP', count: 3 }],
  points: [{ label: '정지선 앞 완전정지', kept: 5, total: 9, rate: 5 / 9 }],
  trend: null,
  mostRetried: null,
  cleanRuns: 6,
};

const plan = (over: Partial<Plan> = {}): Plan => ({
  level: 5,
  target: 'RED_NO_STOP',
  badHabits: [{ code: 'RED_NO_STOP', count: 3, cleanRuns: 0, lastRun: 8 }],
  schoolZone: false,
  lead: null,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('후보 추리기', () => {
  it('이 레벨까지 연 개념의 판만 · 보호구역/앞차 차례를 지킨다', () => {
    // 새 개념을 여는 레벨 · 종합 레벨은 그 레벨의 판에 차례를 걸지 않으므로(candidatesFor), 여는 것이 없는 레벨에서 본다
    const quiet = ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).find((l) => l > 4 && !levelGuide(l).length && !isCombinedLevel(l))!;
    for (const p of [plan({ level: quiet }), plan({ level: quiet, schoolZone: true }), plan({ level: quiet, lead: 'lawful' }), plan({ level: quiet, target: null, badHabits: [] })]) {
      const cands = candidatesFor(p, []);
      expect(cands.length).toBeGreaterThan(0);
      for (const e of cands) {
        // 난이도가 허용한 만큼만 위 레벨 개념을 섞는다 (보통은 한 레벨 — challenge.ts 의 reach)
        expect(e.level).toBeLessThanOrEqual(p.level + challengeRule(p.challenge).reach);
        expect(e.tags.zone === 'yes' || e.tags.approach !== 'none').toBe(p.schoolZone);
        expect(e.tags.lead).toBe(p.lead ?? 'none');
      }
    }
  });

  it('최근에 탄 판은 빼고 고른다', () => {
    const all = candidatesFor(plan(), []);
    const recent = all.slice(0, 3).map((e) => e.spec.id);
    const cands = candidatesFor(plan(), recent);
    expect(cands.some((e) => recent.includes(e.spec.id))).toBe(false);
  });

  /*
    **고칠 습관이 있으면 후보가 모두 그 습관을 시험한다** — 습관이 남아 있는 동안은 레벨이 오르지
    않으므로, 그 습관을 만날 수 없는 판은 아무것도 나아가게 하지 않는다. 차례와 부딪히면 차례를 푼다.
  */
  it('고칠 습관이 있으면 후보가 모두 그 습관을 시험한다 — 차례와 부딪혀도', () => {
    for (const p of [
      plan(),
      plan({ lead: 'rolling', target: 'RIGHT_ARROW_RED', badHabits: [{ code: 'RIGHT_ARROW_RED', count: 2, cleanRuns: 0, lastRun: 3 }] }),
      plan({ schoolZone: false, target: 'SCHOOL_ZONE_NO_STOP', badHabits: [{ code: 'SCHOOL_ZONE_NO_STOP', count: 1, cleanRuns: 0, lastRun: 3 }] }),
      plan({ level: 1, target: 'PEDESTRIAN_BLOCKED', badHabits: [{ code: 'PEDESTRIAN_BLOCKED', count: 1, cleanRuns: 0, lastRun: 3 }] }),
    ]) {
      const cands = candidatesFor(p, []);
      expect(cands.length, String(p.target)).toBeGreaterThan(0);
      for (const e of cands) expect(e.targets, String(p.target)).toContain(p.target);
    }
  });

  /*
    **L1 에서 시작한다** — 가장 쉬운 판들이 후보다 (library.ts 의 assignLevels). 보호구역 · 앞차 · 여럿은 아직 없다.
  */
  it('L1 학습자에게는 야간 판을 주지 않는다 — 한두 레벨 위를 섞는 어려움 난이도에서도', () => {
    for (const challenge of [1, 3, 4, 5] as const) {
      for (const target of [null, 'RED_NO_STOP', 'PEDESTRIAN_BLOCKED', 'NO_SLOW_DOWN'] as const) {
        const p = plan({
          level: 1,
          challenge,
          target,
          badHabits: target ? [{ code: target, count: 3, cleanRuns: 0, lastRun: 8 }] : [],
        });
        const cands = candidatesFor(p, []);
        expect(cands.length, `난이도 ${challenge} · ${target}`).toBeGreaterThan(0);
        expect(cands.some((e) => e.tags.env === 'night'), `난이도 ${challenge} · ${target}`).toBe(false);
      }
    }
    // L2 부터는 야간 판이 나온다
    const l2 = candidatesFor(plan({ level: 2, target: null, badHabits: [] }), []);
    expect(l2.some((e) => e.tags.env === 'night')).toBe(true);
  });

  it('L1 후보는 가장 쉬운 판이다 — 보호구역 · 앞차 · 보행자 여럿 없음', () => {
    const cands = candidatesFor(plan({ level: 1, target: null, badHabits: [] }), []);
    expect(cands.length).toBeGreaterThanOrEqual(5);
    for (const e of cands) {
      expect(e.tags.zone).toBe('no');
      expect(e.tags.approach).toBe('none');
      expect(e.tags.lead).toBe('none');
      expect(e.tags.c === 'group' || e.tags.c === 'mixed' || (e.tags.a !== 'none' && e.tags.c !== 'none')).toBe(false);
    }
  });

  it('레벨이 오르면 그 레벨의 새 개념 코스를 먼저 올린다', () => {
    const zoneAt = ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).find((l) => levelGuide(l).includes('zone'))!;
    const p = plan({ level: zoneAt, target: null, badHabits: [] });
    const list = shortlist(p, candidatesFor(p, []), () => 0.5);
    const zones = list.filter((e) => e.tags.zone === 'yes' || e.tags.approach !== 'none');
    expect(zones.length, `L${zoneAt} — 어린이보호구역을 여는 레벨`).toBeGreaterThanOrEqual(2);
  });

  it('같은 레벨이면 판단할 것이 많은 판을 먼저 고른다 — 보행자 없는 판은 몸풀기로만', () => {
    const p = plan({ level: 1, target: null, badHabits: [] });
    let empty = 0;
    for (let i = 0; i < 20; i++) {
      const e = rulePick(p, candidatesFor(p, []), () => (i * 0.37) % 1);
      if (e.tags.a === 'none' && e.tags.c === 'none') empty++;
    }
    expect(empty, '스무 번 중 보행자 없는 판').toBeLessThanOrEqual(3);
  });

  it('1레벨에서도 약점을 시험하는 판이 후보에 있다', () => {
    const cands = candidatesFor(plan({ level: 1 }), []);
    expect(cands.some((e) => e.targets.includes('RED_NO_STOP'))).toBe(true);
  });
});

describe('AI 에게 보여 주는 후보 코스', () => {
  const p = plan({ level: 8 });
  const cands = candidatesFor(p, []);
  const list = shortlist(p, cands, () => 0.5);

  it('10개 안팎이고, 서로 다른 판이며 모양(신호·보행자·보호구역·앞차)이 여럿 섞인다', () => {
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list.length).toBeLessThanOrEqual(10);
    expect(new Set(list.map((e) => e.spec.id)).size).toBe(list.length);
    const shapes = list.map((e) =>
      [e.tags.signal, e.tags.zone, e.tags.sigA, e.tags.sigC, e.tags.approach, e.tags.a, e.tags.c, e.tags.lead].join('/'),
    );
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(3);
  });

  it('약점을 시험하는 코스가 절반쯤 있고, 가장 쉬운 코스도 있다', () => {
    const hits = list.filter((e) => e.targets.includes('RED_NO_STOP')).length;
    expect(hits).toBeGreaterThanOrEqual(list.length / 2 - 1);
    const minLevel = Math.min(...cands.map((e) => e.level));
    expect(list.some((e) => e.level === minLevel), '가장 낮은 레벨(복습) 코스').toBe(true);
  });

  it('AI 없이 코드가 고르면 약점을 시험하는 판이다', () => {
    expect(rulePick(p, list, () => 0.5).targets).toContain('RED_NO_STOP');
  });
});

describe('recommendScenario — 가짜 서버', () => {
  const answer = (body: object, status = 200) =>
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: status === 200,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response),
    );

  it('AI 가 고른 판에 추천 이유와 볼 것이 붙는다', async () => {
    // 후보는 매번 조금씩 섞이므로, 보낸 후보 중 첫 번호를 그대로 돌려주는 서버를 흉내 낸다
    let sentId = 0;
    vi.stubGlobal('fetch', (_u: string, init: { body: string }) => {
      sentId = JSON.parse(init.body).courses[0].id;
      const body = { id: sentId, why: '정지선 앞 정지를 9판 중 4판 놓쳤습니다.', focus: '정지선에서 먼저 서세요.' };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response);
    });
    const out = await recommendScenario(plan(), habits, [], []);
    expect(out.source).toBe('ai');
    expect(out.scenario.id).toBe(sentId);
    expect(out.scenario.why).toContain('9판 중 4판');
    expect(out.scenario.focus).toBe('정지선에서 먼저 서세요.');
    expect(out.scenario.recommended).toBe('ai');
  });

  it('서버가 없으면 코드가 고른다 — 판은 늘 나온다', async () => {
    answer({ error: 'NO_KEY' }, 503);
    const out = await recommendScenario(plan(), habits, [], []);
    expect(out.source).toBe('rule');
    expect(libraryEntry(out.scenario.id)).toBeDefined();
    expect(out.scenario.why.length).toBeGreaterThan(0);
  });

  it('후보에 없는 번호를 대면 버리고 코드가 고른다', async () => {
    answer({ id: 1, why: 'x', focus: '' });
    const out = await recommendScenario(plan(), habits, [], []);
    expect(out.source).toBe('rule');
    expect(out.scenario.id).not.toBe(1);
  });
});

describe('서버 — 입력 · 답', () => {
  it('브라우저가 보낸 것을 그대로 받아 프롬프트를 만든다', () => {
    const p = plan({ level: 8, lead: 'straight' });
    const list = shortlist(p, candidatesFor(p, []));
    const payload = recommendPayload(
      p,
      habits,
      [{ title: '정면신호 적색 - 보행자 없음', grade: 'VIOLATION', violations: ['RED_NO_STOP'] }],
      list,
    );
    const req = sanitize(JSON.parse(JSON.stringify(payload)));
    const text = buildUserPrompt(req);
    expect(text).toContain('RED_NO_STOP');
    expect(text).toContain(String(list[0].spec.id));
    expect(text).toContain('앞차 직진 대기');
  });

  it('후보가 없으면 받지 않는다', () => {
    expect(() => sanitize({ level: 5, courses: [] })).toThrow();
  });

  it('모델의 답에서 보낸 후보 번호와 글만 남긴다', () => {
    expect(parseReply('{"id":1204,"why":"이유","focus":"볼 것"}', [1204])).toEqual({
      id: 1204,
      why: '이유',
      focus: '볼 것',
    });
    expect(parseReply('{"id":"1204","why":"이유"}', [1204])?.id).toBe(1204);
    expect(parseReply('{"id":999}', [1204]), '후보 밖 번호').toBeNull();
    expect(parseReply('답을 못 하겠습니다', [1204])).toBeNull();
  });
});

/*
  **난이도 설정 1~5** (scenarios/challenge.ts) — 같은 레벨 안에서 얼마나 복잡한 코스를 고르는가.
  레벨(학습 진도)은 그대로 두고, 5 만 다음 레벨의 개념을 미리 섞는다.
*/
describe('난이도 설정', () => {
  const avgCost = (challenge: 1 | 3 | 5) => {
    const p = plan({ level: 7, target: null, badHabits: [], challenge });
    let sum = 0;
    for (let i = 0; i < 30; i++) sum += rulePick(p, candidatesFor(p, []), () => (i * 0.61) % 1).cost;
    return sum / 30;
  };

  it('1 은 단순한 코스를, 5 는 복잡한 코스를 고른다', () => {
    const easy = avgCost(1);
    const normal = avgCost(3);
    const hard = avgCost(5);
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
  });

  /*
    L7 에서 잰다 — 앞차 차례가 아닌 이 계획(lead: null)은 앞차 없는 판만 받는데, 방향 축을 더한 뒤로 L6 은 전부 앞차 판이라
    (앞차 판이 여는 레벨) L4 에서 두 레벨 위를 재면 L6 이 비어 L5 로 보인다. L7 ~ L10 에는 레벨마다 앞차 없는 판이 있다.
  */
  it('보통은 한 레벨, 4 는 두 레벨, 5 는 세 레벨 위의 개념까지 후보에 넣는다', () => {
    const lv = (challenge: 1 | 3 | 4 | 5) =>
      Math.max(...candidatesFor(plan({ level: 7, target: null, badHabits: [], challenge }), []).map((e) => e.level));
    expect(lv(1)).toBe(7);
    expect(lv(3)).toBe(8);
    expect(lv(4)).toBe(9);
    expect(lv(5)).toBe(10);
  });

  it('4 부터 주행 중 도움을 걷는다 — 보통까지는 할 일 한마디 · 느낌표 · 정지 구역 띠를 남긴다', () => {
    expect([1, 2, 3].map((c) => challengeRule(c).hints)).toEqual(['less', 'less', 'less']);
    expect(challengeRule(4).hints).toBe('none');
    expect(challengeRule(5).hints).toBe('none');
  });

  it('설정이 없으면 3(보통)으로 본다', () => {
    const p = plan({ level: 7, target: null, badHabits: [] });
    const q = plan({ level: 7, target: null, badHabits: [], challenge: 3 });
    expect(rulePick(p, candidatesFor(p, []), () => 0.3).spec.id).toBe(rulePick(q, candidatesFor(q, []), () => 0.3).spec.id);
  });
});

/**
 * **번호만 다른 같은 판을 이어서 주지 않는다.**
 *
 * 6천 판 중에서 고르는데도 실제로 만나는 장면은 늘 비슷했다 — 40판을 이어 달려 재 보니 L4 에서 40판 중
 * 26판의 두 번째 횡단보도가 같은 유형이었다 (사용자: "시나리오가 몇 천 개나 되는데 나오는 건 고정된
 * 느낌이야"). 점수가 '이 레벨 · 조건이 많은 판' 을 좋게 치는데 그 조건을 가장 잘 만족하는 모양이 레벨마다
 * 하나씩 있어서, 번호는 달라도 **모양이 같은 판**이 계속 1등을 했다.
 *
 * 이제 최근에 나온 축의 값을 점수에서 깎는다(`seenShapes`). 여기서 그 효과를 못 박는다.
 */
describe('모양 되풀이 막기', () => {
  const p = plan({ level: 7 });
  const cands = candidatesFor(p, []);

  it('바로 앞 판과 같은 두 번째 횡단보도 유형은 밀린다', () => {
    // 두 번째 횡단보도가 'jaywalkWait' 인 판만 열 번 이어서 탔다고 하자
    const repeated = cands.filter((e) => e.tags.c === 'jaywalkWait').slice(0, 10);
    expect(repeated.length, '되풀이할 판이 있어야 한다').toBeGreaterThan(3);
    const seen = seenShapes(repeated.map((e) => e.spec.id));
    const picked = rulePick(p, cands, () => 0, seen);
    expect(picked.tags.c, '같은 유형이 또 나오지 않는다').not.toBe('jaywalkWait');
  });

  it('이어 달리면 만나는 유형이 여럿이 된다 — 40판에서 두 번째 횡단보도가 네 가지 이상', () => {
    // 흔들림은 고정한다 — 다양해지는 까닭이 운이 아니라 점수라는 것을 보이려고
    let seed = 1;
    const fixed = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const recent: number[] = [];
    const kinds = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const seen = seenShapes(recent);
      const list = shortlist(p, candidatesFor(p, recent), fixed, seen);
      const e = rulePick(p, list, fixed, seen);
      recent.push(e.spec.id);
      kinds.add(e.tags.c);
    }
    expect(kinds.size, `만난 유형 ${[...kinds].join(',')}`).toBeGreaterThanOrEqual(4);
    expect(new Set(recent).size, '서로 다른 판').toBeGreaterThanOrEqual(28);
  });
});

/**
 * **두 번째 횡단보도의 사람이 늘 차량쪽에서만 오지 않는다.**
 *
 * '건너려고 대기' · '무단횡단하려고 대기' 가 늘 `'right'`(내 차와 같은 쪽 보도)여서, C 보행자의 65%가
 * 차량쪽이었다 (사용자: "항상 차량쪽 보행자만 나오는 것 같아"). 판 번호로 쪽을 가르므로 같은 판은 늘
 * 같은 쪽이고, 라이브러리 전체로는 고르게 섞인다.
 */
describe('두 번째 횡단보도 보행자가 오는 쪽', () => {
  it('두 쪽이 고르게 섞인다 — 한쪽이 65%를 넘지 않는다', () => {
    let left = 0;
    let right = 0;
    for (const e of scenarioLibrary()) {
      for (const ped of e.spec.pedestrians) {
        if (ped.crosswalk !== 'C') continue;
        if (ped.from === 'left') left++;
        else right++;
      }
    }
    const share = right / (left + right);
    expect(share, `차량쪽 ${(share * 100).toFixed(1)}%`).toBeLessThan(0.65);
    expect(share, `차량쪽 ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.35);
  });
});

/**
 * **이어 달리면 정말로 다양해지는가** — 실제 흐름(main.ts)대로 판마다 차례를 굴려 본다.
 *
 * 지금까지의 40판 테스트는 `plan` 하나를 그대로 40번 썼다. 그래서 `schoolZone: false, lead: null` 로
 * 고정돼 **보호구역도 앞차도 한 번도 나오지 않았고**, 사용자가 짚은 "신호 있는 보호구역이 많이 나온다" 를
 * 구조적으로 잡을 수 없었다. 여기서는 보호구역(25%) · 신호기 유무(65%) · 앞차(1/3)를 판마다 굴린다.
 *
 * 흔들림은 고정 난수로 둔다 — **다양해지는 까닭이 운이 아니라 점수라는 것**을 보이려는 것이다.
 */
describe('이어 달리면 다양해진다 — 고칠 습관이 없어도', () => {
  const fixed = () => {
    let seed = 7;
    return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  };

  /** 실제 흐름대로 n 판을 이어 달린다 (main.ts 의 plan 만들기와 같은 순서) */
  const run = (level: Difficulty, n: number) => {
    const rnd = fixed();
    const played: number[] = [];
    const out: LibraryEntry[] = [];
    for (let i = 0; i < n; i++) {
      const zoneTurn = rnd() < SCHOOL_ZONE_CHANCE;
      const p = plan({
        level,
        target: null,
        badHabits: [],
        schoolZone: zoneTurn,
        zoneNoSignal: rnd() < ZONE_NO_SIGNAL_CHANCE,
        lead: rnd() < 1 / 3 ? (['lawful', 'rolling', 'straight'] as const)[Math.floor(rnd() * 3)] : null,
      });
      const seen = seenShapes(played);
      const cover = coverageOf(played, level);
      const list = shortlist(p, candidatesFor(p, played), rnd, seen, cover);
      const e = rulePick(p, list.length ? list : candidatesFor(p, played), rnd, seen, cover);
      played.push(e.spec.id);
      out.push(e);
    }
    return out;
  };

  it('40판에서 두 횡단보도의 상황이 모두 여러 가지다', () => {
    const runs = run(7, 40);
    expect(new Set(runs.map((e) => e.tags.c)).size, '우회전 후').toBeGreaterThanOrEqual(5);
    expect(new Set(runs.map((e) => e.tags.a)).size, '첫 횡단보도').toBeGreaterThanOrEqual(4);
    expect(new Set(runs.map((e) => e.spec.id)).size, '서로 다른 판').toBeGreaterThanOrEqual(28);
  });

  it('보행자 종류 · 날씨 · 앞차가 모두 섞인다 — 모양(shapeOf)이 보지 않는 축들', () => {
    const runs = run(7, 40);
    expect(new Set(runs.map((e) => e.tags.kind)).size, '어른 · 어린이 · 노인').toBe(3);
    expect(new Set(runs.map((e) => e.tags.env)).size, '낮 · 밤 · 비').toBe(3);
    expect(new Set(runs.map((e) => e.tags.lead)).size, '앞차').toBeGreaterThanOrEqual(3);
  });

  it('보행자가 오는 쪽이 한쪽으로 몰리지 않는다', () => {
    const runs = run(7, 40);
    for (const id of ['A', 'C'] as const) {
      const ps = runs.flatMap((e) => e.spec.pedestrians.filter((p) => p.crosswalk === id));
      const right = ps.filter((p) => p.from === 'right').length / ps.length;
      expect(right, `${id} 차량쪽 ${(right * 100).toFixed(0)}%`).toBeLessThan(0.7);
      expect(right, `${id} 차량쪽 ${(right * 100).toFixed(0)}%`).toBeGreaterThan(0.3);
    }
  });

  /*
    **보호구역은 신호기 없는 쪽이 핵심이다** (제27조 제7항 — 사람이 없어도 일시정지).
    사용자: "어린이보호구역에서 신호없는 횡단보도가 핵심인데 신호있는 어린이보호구역 횡단보도가 많이 나왔어."
  */
  it('보호구역 판의 절반 이상이 신호기 없는 횡단보도다', () => {
    const runs = run(8, 120);
    const zone = runs.filter((e) => zoneKindOf(e.tags) !== 'none');
    expect(zone.length, '보호구역 판이 나오긴 한다').toBeGreaterThanOrEqual(15);
    const noSig = zone.filter((e) => zoneKindOf(e.tags) === 'noSignal').length / zone.length;
    expect(noSig, `무신호 ${(noSig * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(0.5);
    /*
      **1 이 아니다.** 신호 있는 보호구역도 가르치는 것이 있다 — 진입로 보호구역 신호 횡단보도는
      `SCHOOL_ZONE_RED`(적색이면 녹색까지 기다림)를 시험하는 유일한 판이고, 교차로 보호구역 신호 판은
      "신호가 있어도 보행자가 먼저" 를 가르친다. 무신호만 나오면 "보호구역 = 무조건 선다" 를 외운다.
    */
    expect(noSig, `무신호 ${(noSig * 100).toFixed(0)}%`).toBeLessThanOrEqual(0.9);
    const kinds = new Set(zone.map((e) => zoneKindOf(e.tags)));
    expect(kinds.has('noSignal'), '무신호를 겪는다').toBe(true);
    expect(kinds.size, `겪은 보호구역 종류 ${[...kinds].join(',')}`).toBeGreaterThanOrEqual(2);
  });

  /*
    **레벨마다 고르게** — 사용자가 "각 레벨별로 어린이보호구역에 신호없는 횡단보도가 고르게 나오게" 해 달라고 했다.
    고치기 전(레벨마다 300판 모의 주행)은 L1 · L2 0% · L3 30% · L5 73% 였다. 신호기 없는 보호구역을 보호구역과 같은
    개념 단계로 두고(library.ts 의 conceptStage), 되풀이 감점을 절반만 걸어(CORE_REPEAT) 레벨마다 60% 안팎이 되었다.
    보호구역이 열리는 L2 부터 본다.
  */
  it('보호구역 판 중 신호기 없는 판의 비율이 L2 ~ L10 에서 고르다', () => {
    const ratios = ([2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((level) => {
      const zone = run(level, 400).filter((e) => zoneKindOf(e.tags) !== 'none');
      return zone.filter((e) => zoneKindOf(e.tags) === 'noSignal').length / zone.length;
    });
    const shown = ratios.map((r, i) => `L${i + 2} ${(r * 100).toFixed(0)}%`).join(' · ');
    for (const r of ratios) {
      expect(r, shown).toBeGreaterThanOrEqual(0.5);
      expect(r, shown).toBeLessThanOrEqual(0.8);
    }
    /*
      **표본을 160 → 400판으로 늘렸다.** 160판이면 한 레벨에서 보호구역 판이 35판 남짓뿐이라 비율이 ±10%p 씩
      튀었다 — 실제로 라이브러리에 판을 더하자 같은 L5 가 한 번은 85%, 한 번은 46% 로 나와 위아래 문턱을
      번갈아 넘었다. 레벨마다 1,000판으로 재면 L2 ~ L10 이 **61 ~ 69%** 로 고르다(고른 것은 추천이지 표본이
      아니다). 400판이면 그 흔들림이 문턱 안에 든다.
    */
    expect(Math.max(...ratios) - Math.min(...ratios), shown).toBeLessThan(0.25);
  });

  /*
    **커버리지 그 자체를 잰다** — 40판을 달린 뒤 이 레벨에서 "한 번도 안 겪은 축 값" 이 몇이나 남는가.
    사용자의 "나쁜 운전습관이 없다하더라도 레벨에 맞는 다양한 상황을 경험해야 해" 를 가장 곧바로 재는 자다.
  */
  it('40판이면 이 레벨의 상황을 고루 겪는다 — 못 겪은 축 값이 적다', () => {
    const runs = run(7, 40);
    const cover = coverageOf(runs.map((e) => e.spec.id), 7);
    const axes = ['signal', 'a', 'c', 'kind', 'env', 'pressure'] as const;
    const pool = scenarioLibrary().filter((e) => e.level === 7);
    const missed: string[] = [];
    for (const axis of axes) {
      for (const v of new Set(pool.map((e) => String(e.tags[axis])))) {
        if (!cover.has(`${axis}=${v}`)) missed.push(`${axis}=${v}`);
      }
    }
    expect(missed.length, `못 겪은 것 ${missed.join(',')}`).toBeLessThanOrEqual(3);
  });
});

/**
 * **프롬프트가 학습자 화면과 다른 수를 말하면 안 된다.**
 *
 * 습관이 풀리는 데 필요한 판 수는 `src/coach/badHabits.ts` 가 원본인데, 서버는 브라우저 코드를
 * 가져다 쓰지 않아 값을 옮겨 적는다. 한쪽만 고치면 화면은 "2판 남음" 이라 적고 AI 는 "3번 지켜야
 * 풀린다" 고 말하게 된다 — 그 어긋남을 여기서 잡는다.
 */
describe('습관이 풀리는 판 수 — 화면과 프롬프트가 같은 수를 말한다', () => {
  it('서버가 옮겨 적은 값이 원본과 같다', () => {
    expect(PROMPT_HABIT_CLEARED).toBe(HABIT_CLEARED_AFTER);
  });

  it('프롬프트에 그 수가 그대로 실린다', () => {
    const p = plan({ badHabits: [{ code: 'RED_NO_STOP', count: 3, cleanRuns: 1, lastRun: 8 }] });
    const text = buildUserPrompt(
      sanitize(JSON.parse(JSON.stringify(recommendPayload(p, habits, [], shortlist(p, candidatesFor(p, []), () => 0.5))))),
    );
    expect(text).toContain(`${HABIT_CLEARED_AFTER}번 지켜야 풀립니다`);
    expect(text).toContain(`지킨 판 1/${HABIT_CLEARED_AFTER}`);
  });
});

/*
  **먼저 고칠 습관은 AI 가 정한다** (recommend.ts 의 coursesByHabit · server/recommendPrompt.mjs).

  사용자가 "분석 단계(③)도 AI 가 하게" 해 달라고 했다. 습관이 둘 이상이면 코드는 습관마다 후보를 따로 추리기만 하고,
  어느 습관부터 고칠지는 모델이 정한다. 다만 **울타리는 그대로다** — 어느 묶음이든 그 습관을 시험하는 판뿐이고,
  모델이 댄 습관은 학습자에게 있고 고른 코스가 그 습관을 시험할 때만 받는다.
*/
describe('먼저 고칠 습관 — AI 가 정한다', () => {
  const two = (over: Partial<Plan> = {}) =>
    plan({
      level: 5,
      target: 'RED_NO_STOP',
      badHabits: [
        { code: 'RED_NO_STOP', count: 4, cleanRuns: 0, lastRun: 8 },
        { code: 'PEDESTRIAN_BLOCKED', count: 2, cleanRuns: 0, lastRun: 9 },
      ],
      ...over,
    });

  it('습관이 하나면 예전처럼 한 묶음 — AI 가 습관을 고르지 않는다', () => {
    const { groups } = coursesByHabit(plan(), [], () => 0.5);
    expect(groups.length).toBe(1);
    expect(groups[0].habit).toBe('RED_NO_STOP');
  });

  it('습관이 둘이면 습관마다 묶음이 있고, 묶음의 판은 모두 그 습관을 시험한다', () => {
    const { groups, candidates } = coursesByHabit(two(), [], () => 0.5);
    expect(groups.map((g) => g.habit)).toEqual(['RED_NO_STOP', 'PEDESTRIAN_BLOCKED']);
    const ids = groups.flatMap((g) => g.courses.map((e) => e.spec.id));
    expect(new Set(ids).size, '같은 번호가 두 묶음에 나가지 않는다').toBe(ids.length);
    expect(ids.length, '서버가 한 번에 받는 16개 안').toBeLessThanOrEqual(16);
    for (const g of groups) for (const e of g.courses) expect(e.targets, String(g.habit)).toContain(g.habit);
    expect(candidates).toBeGreaterThanOrEqual(ids.length);
  });

  it('습관은 셋까지만 — 넷이어도 묶음은 셋이다', () => {
    const p = plan({
      level: 8,
      badHabits: [
        { code: 'RED_NO_STOP', count: 5, cleanRuns: 0, lastRun: 8 },
        { code: 'PEDESTRIAN_BLOCKED', count: 4, cleanRuns: 0, lastRun: 8 },
        { code: 'RIGHT_ARROW_RED', count: 3, cleanRuns: 0, lastRun: 8 },
        { code: 'OVER_STOP_LINE', count: 2, cleanRuns: 0, lastRun: 8 },
      ],
    });
    expect(priorityHabits(p)).toEqual(['RED_NO_STOP', 'PEDESTRIAN_BLOCKED', 'RIGHT_ARROW_RED']);
    expect(coursesByHabit(p, [], () => 0.5).groups.length).toBeLessThanOrEqual(3);
  });

  it('프롬프트가 먼저 고칠 습관을 정하라고 하고, 후보 줄마다 어느 습관의 묶음인지 적는다', () => {
    const p = two();
    const { groups } = coursesByHabit(p, [], () => 0.5);
    const habitOf = new Map(groups.flatMap((g) => g.courses.map((e) => [e.spec.id, g.habit!] as const)));
    const courses = groups.flatMap((g) => g.courses);
    const req = sanitize(JSON.parse(JSON.stringify(recommendPayload(p, habits, [], courses, undefined, habitOf)))) as {
      priority: boolean;
    };
    expect(req.priority).toBe(true);
    const text = buildUserPrompt(req);
    expect(text).toContain('먼저 고칠 습관을 정하십시오');
    expect(text).toContain('[PEDESTRIAN_BLOCKED]');
    expect(text).toContain('[RED_NO_STOP]');
  });

  it('습관이 하나면 프롬프트는 정하라고 하지 않고 묶음 표시도 없다', () => {
    const p = plan();
    const text = buildUserPrompt(
      sanitize(JSON.parse(JSON.stringify(recommendPayload(p, habits, [], shortlist(p, candidatesFor(p, []), () => 0.5))))),
    );
    expect(text).not.toContain('먼저 고칠 습관을 정하십시오');
    expect(text).not.toContain('[RED_NO_STOP]');
  });

  it('서버는 학습자에게 있고 고른 코스가 시험하는 습관만 넘긴다', () => {
    const ok = (id: number, habit: string) => id === 7 && habit === 'PEDESTRIAN_BLOCKED';
    expect(parseReply('{"habit":"PEDESTRIAN_BLOCKED","id":7,"why":"이유"}', [7], ok)?.habit).toBe('PEDESTRIAN_BLOCKED');
    expect(parseReply('{"habit":"RED_NO_STOP","id":7,"why":"이유"}', [7], ok)?.habit, '그 코스가 시험하지 않는 습관').toBeUndefined();
    expect(parseReply('{"habit":"지어낸 코드","id":7}', [7], () => true)?.habit, '모르는 코드').toBeUndefined();
    // 습관을 댔는지와 무관하게 번호가 맞으면 판은 받는다
    expect(parseReply('{"habit":"RED_NO_STOP","id":7}', [7], ok)?.id).toBe(7);
  });

  it('AI 가 둘째 습관을 먼저로 정하면 그 습관 · 그 코스로 간다 — 카드가 "AI 판단" 이라고 적는다', async () => {
    let sent: { habit?: string; id: number }[] = [];
    vi.stubGlobal('fetch', (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      sent = body.courses;
      const pick = sent.find((c) => c.habit === 'PEDESTRIAN_BLOCKED')!;
      const reply = { habit: 'PEDESTRIAN_BLOCKED', id: pick.id, why: '최근 두 판 연속 보행자 앞에서 서지 않았습니다.', focus: '' };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) } as unknown as Response);
    });
    const out = await recommendScenario(two(), habits, [], []);
    expect(out.source).toBe('ai');
    expect(out.habit).toBe('PEDESTRIAN_BLOCKED');
    expect(out.habitBy).toBe('ai');
    expect(libraryEntry(out.scenario.id)!.targets).toContain('PEDESTRIAN_BLOCKED');
  });

  it('AI 가 댄 습관이 고른 코스와 맞지 않으면 그 코스의 묶음 습관으로 보고, AI 판단이라고 하지 않는다', async () => {
    vi.stubGlobal('fetch', (_u: string, init: { body: string }) => {
      const courses = JSON.parse(init.body).courses as { habit?: string; id: number }[];
      // 보행자 묶음의 코스를 골라 놓고 습관은 엉뚱한 것(학습자에게 없는 것)을 댄다
      const pick = courses.find((c) => c.habit === 'PEDESTRIAN_BLOCKED')!;
      const reply = { habit: 'SCHOOL_ZONE_RED', id: pick.id, why: '이유', focus: '' };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) } as unknown as Response);
    });
    const out = await recommendScenario(two(), habits, [], []);
    expect(out.habit).toBe('PEDESTRIAN_BLOCKED');
    expect(out.habitBy).toBe('rule');
  });

  it('AI 가 없으면 코드가 고르고, 가장 많이 한 습관의 코스를 먼저 본다', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('{}') } as unknown as Response),
    );
    const out = await recommendScenario(two(), habits, [], []);
    expect(out.source).toBe('rule');
    expect(out.habitBy).toBe('rule');
    expect(libraryEntry(out.scenario.id)!.targets).toContain(out.habit);
  });
});

/*
  **신호기 없는 보호구역의 바닥** — 사용자가 "10판 넘게 했는데 어린이보호구역 신호없는 횡단보도가 한번도 나오지 않았어"
  라고 짚었다. 고칠 습관이 남은 사람은 그 습관을 시험하는 판만 받는데, L1 의 무신호 판은 모두 정면 녹색이라 "정면 적색
  미정지" 습관이 있으면 L1 에서 한 번도 나오지 않았다 (0%). 최근 NO_SIGNAL_ZONE_GAP 판에 없었으면 이번 판은 반드시 그 판이다.
*/
describe('신호기 없는 보호구역 — 몇 판째 없으면 반드시 나온다', () => {
  const lib = scenarioLibrary();
  const noSig = lib.find((e) => isNoSignalZone(e.tags))!;
  const plain = lib.filter((e) => zoneKindOf(e.tags) === 'none').slice(0, 5).map((e) => e.spec.id);

  it('최근 판에 없었을 때만 차례가 된다', () => {
    expect(noSignalZoneDue([]), '기록이 짧으면 확률에 맡긴다').toBe(false);
    expect(noSignalZoneDue(plain.slice(0, NO_SIGNAL_ZONE_GAP - 1))).toBe(false);
    expect(noSignalZoneDue(plain.slice(0, NO_SIGNAL_ZONE_GAP))).toBe(true);
    expect(noSignalZoneDue([...plain.slice(0, 2), noSig.spec.id, ...plain.slice(2, NO_SIGNAL_ZONE_GAP)].slice(-NO_SIGNAL_ZONE_GAP))).toBe(false);
  });

  it('차례면 후보가 모두 무신호 보호구역이고, 고칠 습관도 함께 시험한다 — L1 의 정면 적색 습관이어도', () => {
    const p = plan({ level: 1, target: 'RED_NO_STOP', noSignalZoneDue: true, schoolZone: true, zoneNoSignal: true });
    const cands = candidatesFor(p, []);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((e) => isNoSignalZone(e.tags))).toBe(true);
    expect(cands.every((e) => e.targets.includes('RED_NO_STOP'))).toBe(true);
    expect(cands.every((e) => e.tags.env !== 'night'), 'L1 에는 야간을 주지 않는다').toBe(true);
    // 습관이 둘이어도 습관마다 추린 후보가 모두 무신호 보호구역이다
    const two = plan({
      level: 3,
      target: 'RED_NO_STOP',
      badHabits: [
        { code: 'RED_NO_STOP', count: 3, cleanRuns: 0, lastRun: 8 },
        { code: 'PEDESTRIAN_BLOCKED', count: 2, cleanRuns: 0, lastRun: 7 },
      ],
      noSignalZoneDue: true,
    });
    const { groups } = coursesByHabit(two, [], () => 0.5);
    expect(groups.flatMap((g) => g.courses).every((e) => isNoSignalZone(e.tags))).toBe(true);
  });

  it('습관이 남아 L1 에 머물러도 네 판에 한 번은 만난다', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const played: number[] = [];
    let gap = 0;
    let longest = 0;
    let hits = 0;
    for (let i = 0; i < 16; i++) {
      const due = noSignalZoneDue(played);
      const p = plan({
        level: 1,
        target: 'RED_NO_STOP',
        schoolZone: rnd() < SCHOOL_ZONE_CHANCE || due,
        zoneNoSignal: rnd() < ZONE_NO_SIGNAL_CHANCE || due,
        noSignalZoneDue: due,
      });
      const e = rulePick(p, candidatesFor(p, played), rnd);
      played.push(e.spec.id);
      if (isNoSignalZone(e.tags)) {
        hits++;
        gap = 0;
      } else longest = Math.max(longest, ++gap);
    }
    expect(longest, '연달아 빠진 판').toBeLessThanOrEqual(NO_SIGNAL_ZONE_GAP);
    expect(hits, '16판 중').toBeGreaterThanOrEqual(4);
  });
});
