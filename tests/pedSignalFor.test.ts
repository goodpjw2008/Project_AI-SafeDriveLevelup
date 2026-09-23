/**
 * **횡단보도마다 자기 신호를 본다** (game/pedSignalFor.ts).
 *
 * 이 게임에는 신호기가 두 벌이 따로 돈다 — 교차로 주기와 진입로 보호구역 주기. 화면 쪽 코드가
 * 'A 냐 아니냐' 둘로만 갈라, **진입로 보호구역 횡단보도(S)의 보행자가 교차로의 C 신호를 보고**
 * 건널지 말지를 정하고 있었다. 검증기(scenarios/playSim.ts)는 처음부터 제 신호를 보고 있어서
 * 검증은 통과하는데 **게임에서만 사람이 엉뚱한 때에 건너는** 상태였다.
 *
 * 타입으로는 잡히지 않는 어긋남이라(셋 다 CrosswalkId), 이 테스트가 울타리다.
 */

import { describe, expect, it } from 'vitest';
import { pedSignalFor } from '../src/game/pedSignalFor';

const src = {
  intersection: { pedA: 'red', pedC: 'green' },
  installed: { A: true, C: true },
  zonePed: 'red',
} as const;

describe('보행신호 고르기', () => {
  it('진입로 보호구역(S)은 보호구역 신호기를 본다 — 교차로의 C 가 녹색이어도', () => {
    expect(pedSignalFor('S', src)).toBe('red');
    expect(pedSignalFor('S', { ...src, zonePed: 'green' })).toBe('green');
  });

  it('S 는 신호기가 없으면 null — 교차로 신호기 유무와 무관하다', () => {
    expect(pedSignalFor('S', { ...src, zonePed: null })).toBeNull();
    expect(pedSignalFor('S', { ...src, zonePed: null, installed: { A: true, C: true } })).toBeNull();
  });

  it('A 와 C 는 교차로 신호기를 본다', () => {
    expect(pedSignalFor('A', src)).toBe('red');
    expect(pedSignalFor('C', src)).toBe('green');
  });

  /* 신호기가 없는 횡단보도는 '적색' 이 아니라 '신호가 없다' — 보행자가 건널 때를 스스로 고른다 */
  it('신호기가 안 선 횡단보도는 null', () => {
    expect(pedSignalFor('A', { ...src, installed: { A: false, C: true } })).toBeNull();
    expect(pedSignalFor('C', { ...src, installed: { A: true, C: false } })).toBeNull();
  });
});
