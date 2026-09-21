/**
 * 좌·우·후방 시야 창의 노출 타이밍 검증.
 *
 * 이 창들은 "보행자가 저쪽에 남아 있나" 를 확인하는 창이라, **정지선 앞에 서서 판단하는
 * 순간에는 이미 완전히 드러나 있어야** 한다. 반투명한 창을 보고 판단하게 만들면
 * 이 게임이 가르치려는 확인 절차 자체가 성립하지 않는다.
 *
 * 예전에는 노출 구간이 교차로 중심에서의 절대 거리(34m/28m)로 박혀 있었다. 도로 폭을
 * 넓혀 정지선이 밖으로 밀려나자 정지선까지의 여유가 그만큼 줄어, **정지 구역 뒤쪽에
 * 세우면 창이 아예 안 보이는** 상태가 됐다. 치수를 바꿀 때마다 손으로 확인할 수는 없으므로
 * 규칙 자체를 여기에 못 박는다.
 */

import { describe, expect, it } from 'vitest';
import { Vehicle } from '../src/game/Vehicle';
import { panelStrengthAt } from '../src/game/PeripheralView';
import { PLAYER_APPROACH_X, SPAWN_Z, STOP_LINE } from '../src/layout';
import { STOP_ZONE_DEPTH } from '../src/rules/lawRules';

/** 화면 노출도가 목표값을 따라가는 속도 (PeripheralView.update 와 같은 계수) */
const FOLLOW_K = 5;

/**
 * 정지선 앞 gap 미터 지점에 세웠을 때, 차가 완전히 멈춘 순간의 실제 노출도.
 * 실제 Vehicle 의 속도 프로파일로 달리므로 "따라붙을 시간이 있었는가" 까지 함께 본다.
 */
function strengthWhenStoppedAt(gap: number): number {
  const v = new Vehicle(4.4);
  const dt = 1 / 60;
  let strength = 0;

  for (let step = 0; step < 60 * 60; step++) {
    const stop = v.front.z <= STOP_LINE + gap;
    v.update({ stop, steer: 0, rightSignal: true }, dt);

    const dist = Math.max(Math.abs(v.x), Math.abs(v.z));
    strength += (panelStrengthAt(dist) - strength) * Math.min(1, dt * FOLLOW_K);

    if (stop && v.speedKmh < 0.5) return strength;
  }
  throw new Error(`정지선 앞 ${gap}m 에서 멈추지 못했다`);
}

describe('주변 시야 창 노출', () => {
  it('적법한 정지 구역 어디에 세워도 멈춘 시점에는 완전히 드러나 있다', () => {
    // 정지선에 바짝 붙인 경우부터 구역 맨 뒤까지 훑는다
    for (let gap = 0; gap <= STOP_ZONE_DEPTH; gap += 3) {
      expect(strengthWhenStoppedAt(gap)).toBeGreaterThan(0.99);
    }
  });

  it('출발 지점에서는 접혀 있다 — 늘 띄워 두면 정작 봐야 할 때 눈이 가지 않는다', () => {
    expect(panelStrengthAt(Math.max(PLAYER_APPROACH_X, SPAWN_Z))).toBe(0);
  });

  it('교차로 안과 우회전 진출로에서는 계속 드러나 있다', () => {
    // 두 번째 횡단보도(C) 앞에서 보행자를 확인해야 하는 구간
    expect(panelStrengthAt(0)).toBe(1);
    expect(panelStrengthAt(STOP_LINE)).toBe(1);
  });
});
