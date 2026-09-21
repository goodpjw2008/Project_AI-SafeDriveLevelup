/**
 * 시나리오 검증기 자체를 검증한다.
 *
 * 검증기는 **두 방향으로** 맞아야 쓸모가 있다.
 *
 *  - **손으로 쓴 11개가 전부 통과해야 한다.** 하나라도 걸리면 검증기가 너무 빡빡한
 *    것이고, 그러면 AI 가 만든 멀쩡한 판도 버리게 된다.
 *  - **망가뜨린 판은 전부 걸려야 한다.** 안 걸리면 검증기가 있으나 마나다.
 *
 * 둘 중 하나만 만족하는 검증기는 흔하고, 그런 검증기는 조용히 해롭다.
 */

import { describe, expect, it } from 'vitest';
import { SCENARIOS, type ScenarioSpec } from '../src/scenarios/scenarios';
import {
  checkCoherence,
  checkSchema,
  describeIssues,
  validateScenario,
} from '../src/scenarios/validate';

/** 기준이 되는 멀쩡한 판 하나 — 망가뜨리기 전의 원본 */
const base = (): ScenarioSpec => structuredClone(SCENARIOS[0]);

describe('손으로 쓴 시나리오', () => {
  it.each(SCENARIOS.map((s) => [s.id, s.title, s] as const))(
    'Stage%02d %s 은 검증을 통과한다',
    (_id, _title, spec) => {
      const r = validateScenario(spec);
      // 실패하면 무엇이 걸렸는지 그대로 보여 준다 — 숫자만 보고는 고칠 수 없다
      expect(describeIssues(r.issues.filter((i) => i.level === 'fatal')), describeIssues(r.issues)).toBe(
        '문제 없음',
      );
      expect(r.ok).toBe(true);
    },
  );

  it('모든 판에 규정대로 통과하는 몰기가 실제로 존재한다', () => {
    for (const s of SCENARIOS) {
      if (s.randomized) continue;
      const r = validateScenario(s);
      expect(r.probes?.exemplary, `Stage${s.id}`).not.toBeNull();
      expect(r.probes?.exemplary?.violations, `Stage${s.id}`).toHaveLength(0);
    }
  });
});

/*
  **진입부 어린이보호구역이 붙어도 여전히 통과 가능한가.**

  `prepareScenario` 는 판이 아무 말도 안 했으면 그 구간을 **확률적으로 얹는다**
  (rollApproachZone). 그러면 손으로 쓴 판이 검증받은 모습과 달라진다 — 스폰이 24m
  뒤로 물리고, 정지가 한 번 늘고, 신호기가 있으면 최대 21초를 기다린다.

  그 얹은 판이 통과 불가능해지면 **검증을 통과한 판을 플레이어가 못 깨게 된다.**
  그래서 얹은 모습으로도 재 둔다. 여기가 깨지면 고칠 것은 시나리오가 아니라
  확률이나 구간 길이다.
*/
describe('진입부 보호구역을 얹어도 통과할 수 있다', () => {
  const withZone = (spec: (typeof SCENARIOS)[number], signal: boolean) => ({
    ...spec,
    approachSchoolZone: { signal, signalElapsed: 0 },
  });

  it.each(SCENARIOS.map((s) => [s.id, s.title, s] as const))(
    'Stage%i %s — 신호기 없음',
    (_id, _title, spec) => {
      const r = validateScenario(withZone(spec, false));
      expect(
        describeIssues(r.issues.filter((i) => i.level === 'fatal')),
        describeIssues(r.issues),
      ).toBe('문제 없음');
    },
  );

  it.each(SCENARIOS.map((s) => [s.id, s.title, s] as const))(
    'Stage%i %s — 신호기 있음',
    (_id, _title, spec) => {
      const r = validateScenario(withZone(spec, true));
      expect(
        describeIssues(r.issues.filter((i) => i.level === 'fatal')),
        describeIssues(r.issues),
      ).toBe('문제 없음');
    },
  );
});

describe('구조 검사', () => {
  it('객체가 아니면 걸린다', () => {
    expect(checkSchema(null).length).toBeGreaterThan(0);
    expect(checkSchema('스테이지')).toHaveLength(1);
  });

  it('신호 페이즈가 범위를 벗어나면 걸린다', () => {
    const s = { ...base(), startPhase: 99 };
    expect(validateScenario(s).ok).toBe(false);
  });

  it('보행자 필드가 깨지면 걸린다', () => {
    const s = base();
    (s.pedestrians as unknown[])[0] = { crosswalk: 'B', at: -1, from: '위' };
    const issues = checkSchema(s);
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('없는 시간대·날씨는 걸린다', () => {
    expect(validateScenario({ ...base(), timeOfDay: '새벽' }).ok).toBe(false);
    expect(validateScenario({ ...base(), weather: '눈' }).ok).toBe(false);
  });
});

describe('정합성 검사', () => {
  it('신호기 없는 횡단보도에 신호를 지키는 보행자를 두면 경고한다', () => {
    const s = base();
    s.pedSignalInstalled = { ...s.pedSignalInstalled, C: false };
    s.pedestrians = [{ crosswalk: 'C', at: 1, from: 'left', obeysSignal: true }];
    const issues = checkCoherence(s);
    expect(issues.some((i) => i.message.includes('obeysSignal'))).toBe(true);
  });

  it('제한시간 뒤에 나오는 보행자는 치명적으로 걸린다', () => {
    const s = base();
    s.pedestrians = [{ crosswalk: 'C', at: 500, from: 'left' }];
    expect(validateScenario(s).ok).toBe(false);
  });
});

describe('플레이 가능성 — 이 검증기의 값어치', () => {
  /*
    **통과 불가능한 판을 만들어 낸다.**

    횡단보도 C 에 신호기를 없애고 아주 느린 보행자를 판 끝까지 줄줄이 내보내면, 규정대로
    다 건널 때까지 기다리는 운전자는 **제한시간 안에 끝낼 수 없다.**

    이 판이 위험한 이유는 위반이 나서가 아니다 — 규정을 완벽히 지켰는데 시간 초과로
    실패한다는 점이다. 사람에게 가면 "규정을 지키면 못 깬다" 를 가르치게 된다.
  */
  it('규정대로 몰아도 제한시간 안에 못 깨는 판은 치명적으로 걸린다', () => {
    const s = base();
    s.pedSignalInstalled = { A: true, C: false };
    s.pedestrians = Array.from({ length: 6 }, (_, i) => ({
      crosswalk: 'C' as const,
      at: i * 16,
      startWithin: 30,
      from: (i % 2 ? 'left' : 'right') as 'left' | 'right',
      obeysSignal: false,
      speed: 0.3,
    }));
    const r = validateScenario(s);
    expect(r.ok, describeIssues(r.issues)).toBe(false);
    expect(r.issues.some((i) => i.stage === 'playable' && i.level === 'fatal')).toBe(true);
  });

  it('아무렇게나 몰아도 아무 일 없는 판은 경고한다', () => {
    /*
      보행자도 없고 어린이보호구역도 아니고 꼬리물기도 없는 판을, 정면이 계속 녹색인
      구간에서 시작하게 두면 — 막 몰아도 걸릴 것이 사실상 없다.
    */
    const s = base();
    s.pedestrians = [];
    s.isSchoolZone = false;
    s.exitBlocked = false;
    const r = validateScenario(s);
    const noLesson = r.issues.some((i) => i.message.includes('가르칠 상황이 없습니다'));
    // 서행·지시등 위반은 여전히 잡히므로 경고가 안 뜰 수도 있다.
    // 뜬다면 그 문구여야 하고, 안 뜬다면 최소한 막 모는 쪽이 위반에 걸려야 한다.
    if (!noLesson) expect(r.probes!.reckless.violations.length).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
  });

  /*
    꼬리물기 판은 **기다리면 통과할 수 있다.** 게임이 JAM_CLEAR_SECONDS 뒤에 정체를
    풀어 주기 때문이다 (그렇지 않으면 "진입하지 않는 것"이 정답인데 판을 끝낼 수 없다).

    처음에는 검증기가 정체를 정적인 것으로 보고 이런 판을 전부 "통과 불가능"으로
    버렸다 — AI 가 만든 멀쩡한 판 두 개가 그렇게 사라졌다. 검증기가 게임보다
    빡빡하면 조용히 해롭다는 것을 보여 준 자리라, 회귀로 남긴다.
  */
  it('진출로가 막힌 판도 기다리면 통과할 수 있다', () => {
    const s = base();
    s.exitBlocked = true;
    const r = validateScenario(s);
    expect(describeIssues(r.issues.filter((i) => i.level === 'fatal'))).toBe('문제 없음');
    expect(r.ok).toBe(true);
    // 그리고 그냥 들어가면 꼬리물기로 걸려야 한다 — 가르칠 것이 있는 판이다
    expect(r.probes!.reckless.violations.some((v) => v.code === 'BLOCKING_INTERSECTION')).toBe(true);
  });

  it('막 모는 운전은 손으로 쓴 판 전부에서 위반에 걸린다', () => {
    for (const s of SCENARIOS) {
      if (s.randomized) continue;
      const r = validateScenario(s);
      const caught = r.probes!.reckless;
      expect(
        caught.violations.length > 0 || caught.failReason !== null,
        `Stage${s.id} 은 막 몰아도 아무 일이 없다`,
      ).toBe(true);
    }
  });
});
