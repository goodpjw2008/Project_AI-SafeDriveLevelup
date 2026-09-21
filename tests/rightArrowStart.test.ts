/**
 * **우회전 신호등 판이 적색에서 출발해 47초를 서 있게 되지 않는가** (scenarios.ts 의 `fitRightArrowStart`).
 *
 * 약점이 `RIGHT_ARROW_RED` 인 학습자에게 모델은 우회전 신호등을 달고 정면 적색(4번)에서
 * 출발하는 판을 세 번 내리 만들었고, 검증기가 셋 다 반려해 L9 에서 판이 만들어지지 않았다.
 */

import { describe, expect, it } from 'vitest';

import { fitRightArrowStart, getScenario } from '../src/scenarios/scenarios';
import { validateScenario } from '../src/scenarios/validate';

const arrowOnRed = () => ({
  ...structuredClone(getScenario(2)),
  title: '정면신호 적색 - 보행자 횡단',
  rightArrowInstalled: true,
  startPhase: 4,
  startPhaseElapsed: 0,
  pedSignalInstalled: { A: true, C: false },
});

describe('fitRightArrowStart', () => {
  it('맞추기 전에는 검증기가 반려한다 — 고치려는 바로 그 판이다', () => {
    const said = validateScenario(arrowOnRed()).issues.map((i) => i.message).join('\n');
    expect(said).toContain('우회전이 허용되기까지');
  });

  it('녹색 구간 첫머리로 옮기고, C 보행신호를 달고, 제목의 색을 화살표로 고친다', () => {
    const out = fitRightArrowStart(arrowOnRed());
    expect(out.startPhase).toBe(0);
    expect(out.startPhaseElapsed).toBe(0);
    expect(out.pedSignalInstalled.C).toBe(true);
    expect(out.title).toBe('우회전신호 적색 - 보행자 횡단');
    const said = validateScenario(out).issues.map((i) => i.message).join('\n');
    expect(said).not.toContain('우회전이 허용되기까지');
  });

  it('이미 녹색 화살표 가까이에서 출발하거나 우회전 신호등이 없으면 그대로 둔다', () => {
    const near = { ...arrowOnRed(), startPhase: 1 };
    expect(fitRightArrowStart(near)).toBe(near);
    const none = { ...arrowOnRed(), rightArrowInstalled: false };
    expect(fitRightArrowStart(none)).toBe(none);
  });
});
