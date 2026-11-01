/**
 * **신호 · 정지선 판단 신경망** (src/ai/signalPolicy.ts) — AI 자율주행이 관문마다 기다릴지 · 한 번 설지를 신경망으로 정한다
 * (사용자가 정했다, 2026-11-01: *"모든걸 ai로 하고 싶어"*).
 *
 * 학습한 모델이 틀릴 수 있는 곳이 남아 있으면 AI 가 신호를 어긴다. 그래서 **나올 수 있는 경우 전부**(3만 720가지)에서 커밋된
 * 가중치가 법규와 같은 답을 내는지, 그리고 그 답이 0.5 근처에서 아슬아슬하지 않은지를 여기서 매번 확인한다.
 */
import { describe, expect, it } from 'vitest';

import {
  SIGNAL_FEATURES,
  signalDecision,
  signalDomain,
  signalFeatures,
  signalModelReady,
  signalProbs,
  signalRule,
  type SignalQuery,
} from '../src/ai/signalPolicy';
import trained from '../src/ai/models/signal.json';

const base: SignalQuery = {
  gate: 'line',
  drive: 'rightTurn',
  vehicleLight: 'green',
  rightArrow: null,
  approach: 'none',
  zoneLight: 'noSignal',
  schoolZone: false,
  crosswalkSignal: true,
  exitBlocked: false,
};

describe('신호 판단 신경망', () => {
  it('학습한 모델이 있고 입력 이름이 지금 코드와 같다 — 바꾸면 npm run train:signal', () => {
    expect((trained as { names: string[] }).names).toEqual([...SIGNAL_FEATURES]);
    expect(signalModelReady()).toBe(true);
  });

  it('나올 수 있는 모든 관문에서 법규와 같은 답을 낸다 — 전수 검증', () => {
    const domain = signalDomain();
    expect(domain).toHaveLength(30_720);
    let wrong = 0;
    let closest = 0.5;
    for (const q of domain) {
      const rule = signalRule(q);
      const net = signalDecision(q);
      if (net.wait !== rule.wait || net.hold !== rule.hold) wrong += 1;
      const [w, h] = signalProbs(signalFeatures(q));
      closest = Math.min(closest, Math.abs(w - 0.5), Math.abs(h - 0.5));
    }
    expect(wrong).toBe(0);
    // 가장 아슬아슬한 확률도 0.5 에서 넉넉히 떨어져 있다 — 반올림 · 부동소수 차이로 뒤집히지 않는다
    expect(closest).toBeGreaterThan(0.35);
  });

  it('이 게임이 가르치는 자리에서 신경망의 답 (법규의 답과 같다)', () => {
    // 정면 적색 우회전 — 서고 나서 간다 (별표 2 적색의 등화 제2호)
    expect(signalDecision({ ...base, vehicleLight: 'red' })).toEqual({ wait: false, hold: true });
    // 우회전 신호등 적색 화살표 — 우회전 금지, 기다린다
    expect(signalDecision({ ...base, rightArrow: 'redArrow' })).toEqual({ wait: true, hold: false });
    // 녹색 화살표면 정면이 적색이어도 일시정지 의무가 없다
    expect(signalDecision({ ...base, vehicleLight: 'red', rightArrow: 'greenArrow' })).toEqual({ wait: false, hold: false });
    // 신호기 없는 어린이보호구역 횡단보도 — 녹색이어도 한 번 선다 (제27조 제7항)
    expect(signalDecision({ ...base, schoolZone: true, crosswalkSignal: false })).toEqual({ wait: false, hold: true });
    // 직진은 적색에 갈 수 없다
    expect(signalDecision({ ...base, drive: 'straight', vehicleLight: 'red' }).wait).toBe(true);
    // 진입로 보호구역 — 신호기가 없으면 한 번 서고, 적색이면 녹색까지 기다린다
    expect(signalDecision({ ...base, gate: 'S', approach: 'noSignal' })).toEqual({ wait: false, hold: true });
    expect(signalDecision({ ...base, gate: 'S', approach: 'red' })).toEqual({ wait: true, hold: false });
    // 꼬리물기 — 나갈 자리가 막혔으면 녹색이어도 들어가지 않는다
    expect(signalDecision({ ...base, exitBlocked: true }).wait).toBe(true);
  });
});
