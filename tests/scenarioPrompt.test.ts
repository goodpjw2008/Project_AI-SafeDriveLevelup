/**
 * 서버 프롬프트가 **게임과 어긋나지 않는지** 지킨다.
 *
 * `server/scenarioPrompt.mjs` 는 신호 프로그램과 위반 코드를 모델이 읽을 말로 옮겨 적어
 * 두고 있다. 원본은 각각 `src/scenarios/scenarios.ts` 와 `src/rules/violations.ts` 다.
 *
 * 복사본을 두는 이유는 서버가 .mjs 라 TS 를 그대로 가져올 수 없어서인데, **복사본은
 * 반드시 낡는다.** 신호 구간을 하나 쪼개거나 위반 코드를 늘리면 모델은 없는 구간을
 * 고르고, 그렇게 만들어진 판은 의도와 다른 것이 된다.
 *
 * tests/coachPrompt.test.ts 가 VIOLATION_BRIEF 를 지키는 것과 같은 방식이다.
 */

import { describe, expect, it } from 'vitest';
import { COST_TABLE } from '../src/scenarios/difficulty';
import { checkSchema } from '../src/scenarios/validate';
import { CODE_BRIEF, PHASE_BRIEF, SYSTEM_PROMPT, buildUserPrompt } from '../server/scenarioPrompt.mjs';
import { STANDARD_PROGRAM } from '../src/scenarios/scenarios';
import { VIOLATIONS } from '../src/rules/violations';

describe('신호 프로그램 요약', () => {
  it('구간 수가 실제 프로그램과 같다', () => {
    expect(PHASE_BRIEF).toHaveLength(STANDARD_PROGRAM.length);
  });

  it('구간마다 등화와 길이가 실제와 같다', () => {
    STANDARD_PROGRAM.forEach((real, i) => {
      const brief = PHASE_BRIEF[i];
      expect(brief.vehicle, `구간 ${i}`).toBe(real.vehicle);
      expect(brief.pedA, `구간 ${i}`).toBe(real.pedA);
      expect(brief.pedC, `구간 ${i}`).toBe(real.pedC);
      expect(brief.duration, `구간 ${i}`).toBe(real.duration);
    });
  });

  it('프롬프트에 구간 번호가 전부 실린다', () => {
    for (let i = 0; i < STANDARD_PROGRAM.length; i++) {
      expect(SYSTEM_PROMPT).toContain(`  ${i}. `);
    }
  });
});

describe('위반 코드 요약', () => {
  it('실제 위반 코드와 짝이 맞는다', () => {
    expect(Object.keys(CODE_BRIEF).sort()).toEqual(Object.keys(VIOLATIONS).sort());
  });
});

describe('사용자 프롬프트', () => {
  const req = {
    runs: 7,
    byCode: [{ code: 'PEDESTRIAN_BLOCKED', count: 3 }],
    points: [{ label: '우회전 후 횡단보도', kept: 1, total: 4, rate: 0.25 }],
    recentTitles: ['정면신호 녹색 - 보행자 없음'],
  };

  it('약점을 사람 말로 옮겨 싣는다', () => {
    const p = buildUserPrompt(req);
    expect(p).toContain('총 7판');
    expect(p).toContain('횡단보도 보행자의 통행을 방해');
    expect(p).toContain('3회');
    expect(p).toContain('25%');
  });

  it('이미 만든 제목을 실어 중복을 막는다', () => {
    expect(buildUserPrompt(req)).toContain('정면신호 녹색 - 보행자 없음');
  });

  /*
    **보호구역은 네 판에 한 판이다** (src/scenarios/scenarios.ts 의 SCHOOL_ZONE_CHANCE).

    브라우저가 공짜 묶음과 바꿀 축에서 이미 걸렀지만, 모델은 약점을 시험하라는 지시를
    받은 터라 아무도 시키지 않아도 보호구역을 만들어 온다. 이 문장이 마지막 울타리다.
  */
  it('차례가 아니면 보호구역을 넣지 말라고 이른다', () => {
    const p = buildUserPrompt({ ...req, schoolZone: false });
    expect(p).toContain('어린이보호구역을 넣지 마십시오');
    expect(p, '어느 필드를 어떻게 두라는 것까지 적는다').toContain('approachSchoolZone');
  });

  it('차례면 아무 말도 하지 않는다 — 넣을지는 모델이 정한다', () => {
    expect(buildUserPrompt({ ...req, schoolZone: true })).not.toContain('넣지 마십시오');
  });

  it('커리큘럼 밖의 요청은 제한하지 않는다', () => {
    expect(buildUserPrompt(req)).not.toContain('넣지 마십시오');
  });

  it('위반 기록이 없어도 프롬프트가 성립한다', () => {
    const p = buildUserPrompt({ ...req, byCode: [], points: [], recentTitles: [] });
    expect(p).toContain('아직 위반이 없습니다');
  });
});

/*
  **모델이 필드를 지어내지 않게 하는 자리.**

  예산제로 옮기면서 옛 "레벨별 고정값" 목록이 사라졌는데, 그 목록이 JSON 모양을
  못 박고 있었다는 것을 뒤늦게 알았다. 이름과 값만 적은 비용표를 보낸 동안 모델은
  `pedSignalInstalled: false` 를 넣어 왔고(객체 자리에 불리언), 그 판은 스키마
  검사에서 통째로 버려졌다.

  실제 호출로 재현했다 — 최초 시도 3번 중 1번, 그리고 **되먹임을 받은 재시도는 3번 모두**
  틀렸다. 그래서 첫 요청이 세 번을 다 쓰고 실패하고, 다시 누르면 되는 증상이 나왔다.
*/
describe('비용표는 건드릴 필드를 함께 말한다', () => {
  it('모든 조건에 필드 모양이 적혀 있다', () => {
    for (const c of COST_TABLE) {
      expect(c.field, `${c.key} 에 필드가 없다`).toBeTruthy();
      expect(c.note, `${c.key} 에 값이 없다`).toBeTruthy();
    }
  });

  it('객체를 받는 필드는 그 모양을 예시로 보여 준다', () => {
    const inst = COST_TABLE.find((c) => c.key === 'missingPedSignal');
    expect(inst?.field).toContain('"A"');
    expect(inst?.field).toContain('"C"');
  });

  it('프롬프트에 필드가 그대로 실린다', () => {
    const body = buildUserPrompt({
      runs: 0,
      byCode: [],
      points: [],
      recentTitles: [],
      difficulty: { level: 5, budget: 7, costs: [...COST_TABLE], free: [] },
    });
    for (const c of COST_TABLE) expect(body, c.key).toContain(c.field);
  });
});

/*
  **반려 사유는 무엇이 틀렸는지가 아니라 무엇이 맞는지를 말해야 한다.**

  이 문장은 그대로 다음 요청에 실려 나간다(generate.ts 의 retryOf). "없습니다" 만
  적었더니 모델이 필드가 빠진 줄 알고 불리언을 채워 왔고, 재시도가 같은 실수를
  반복했다 — 되먹임이 오히려 틀린 쪽으로 몰았다.
*/
describe('스키마 반려 사유는 맞는 모양을 알려 준다', () => {
  it('pedSignalInstalled 가 객체가 아니면 예시를 붙인다', () => {
    const [msg] = checkSchema({ pedSignalInstalled: false }).filter((i) =>
      i.message.includes('pedSignalInstalled'),
    );
    expect(msg.message).toContain('객체');
    expect(msg.message).toContain('"A": true');
    expect(msg.message, '받은 값도 보여 준다').toContain('false');
  });
});
