/**
 * **주행 정책 신경망** (src/ai/drivePolicy.ts) — AI 자율주행의 핸들 · 관문 앞 제동 · 앞차 뒤 제동을 신경망이 한다 (사용자가 정했다,
 * 2026-11-01: *"교통법규 준수 등 정말 어쩔수 없는경우는 프로그램으로 남기고 나머지는 모두 AI 기법으로"*).
 *
 * 제동은 **늦게 밟으면 안 된다** — 촘촘한 격자 전부에서 예전 공식이 밟는 자리에서는 반드시 밟고, 공식보다 1.5m 넘게 일찍 밟지
 * 않음을 커밋마다 확인한다. 핸들은 처음 보는 차 자리에서 공식과의 차이를 잰다. 실제 주행은 22,818판 전수 검증이 본다
 * (tests/library.validate.*).
 */
import { describe, expect, it } from 'vitest';

import {
  GATE_FEATURES,
  GATE_RANGE,
  LEAD_FEATURES,
  LEAD_RANGE,
  STEER_FEATURES,
  driveModelReady,
  gateBrake,
  gateBrakeRule,
  leadBrake,
  leadBrakeRule,
  steerPolicy,
  steerRule,
  type DriveModel,
} from '../src/ai/drivePolicy';
import trained from '../src/ai/models/drive.json';
import { drivePath } from '../src/game/AutoDriver';

const model = trained as unknown as DriveModel;

describe('주행 정책 신경망', () => {
  it('학습한 모델이 있고 입력 이름이 지금 코드와 같다 — 바꾸면 npm run train:drive', () => {
    expect(model.steer.names).toEqual([...STEER_FEATURES]);
    expect(model.gate.names).toEqual([...GATE_FEATURES]);
    expect(model.lead.names).toEqual([...LEAD_FEATURES]);
    expect(driveModelReady()).toBe(true);
  });

  it('관문 앞 제동 — 격자 전부에서 공식보다 늦게 밟지 않고, 1.5m 넘게 일찍 밟지도 않는다', () => {
    let late = 0;
    let early = 0;
    for (let decel = GATE_RANGE.decel[0]; decel <= GATE_RANGE.decel[1] + 1e-9; decel += 0.1) {
      for (let sp = GATE_RANGE.speed[0]; sp <= GATE_RANGE.speed[1] + 1e-9; sp += 0.25) {
        const v = sp / 3.6;
        const edge = Math.max(3, (v * v) / (2 * decel) + 1.8);
        for (let d = GATE_RANGE.distance[0]; d <= GATE_RANGE.distance[1] + 1e-9; d += 0.05) {
          const brake = gateBrake(d, sp, decel);
          if (gateBrakeRule(d, sp, decel) && !brake) late += 1;
          if (d > edge + 1.5 && brake) early += 1;
        }
      }
    }
    expect(late).toBe(0);
    expect(early).toBe(0);
  });

  it('앞차 뒤 제동 — 격자 전부에서 공식보다 늦게 밟지 않고, 1.5m 넘게 일찍 밟지도 않는다', () => {
    let late = 0;
    let early = 0;
    for (let cl = LEAD_RANGE.closing[0]; cl <= LEAD_RANGE.closing[1] + 1e-9; cl += 0.25) {
      const v = cl / 3.6;
      const edge = 2.5 + (v * v) / (2 * 4.8);
      for (let gap = LEAD_RANGE.gap[0]; gap <= LEAD_RANGE.gap[1] + 1e-9; gap += 0.05) {
        const brake = leadBrake(gap, cl);
        if (leadBrakeRule(gap, cl) && !brake) late += 1;
        if (gap >= edge + 1.5 && brake) early += 1;
      }
    }
    expect(late).toBe(0);
    expect(early).toBe(0);
  });

  it('범위 밖은 답이 분명하다 — 멀면 아직, 넘어섰으면 밟는다', () => {
    expect(gateBrake(120, 30, 4.8)).toBe(false);
    expect(gateBrake(-20, 10, 4.8)).toBe(true);
    expect(leadBrake(80, 20)).toBe(false);
  });

  it('핸들 — 길 둘레의 처음 보는 차 자리 2만 곳에서 공식과 거의 같다', () => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const errs: number[] = [];
    for (let n = 0; n < 20_000; n++) {
      const path = drivePath(r() < 0.7 ? 'rightTurn' : 'straight');
      const i = Math.floor(r() * (path.length - 16));
      const a = path[i];
      const b = path[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const [tx, tz] = [(b.x - a.x) / len, (b.z - a.z) / len];
      const off = (r() * 2 - 1) * 1.0;
      const car = { x: a.x - tz * off, z: a.z + tx * off, yaw: Math.atan2(-tx, -tz) + ((r() * 2 - 1) * 10 * Math.PI) / 180 };
      const ahead = path.slice(i, i + 60);
      const speed = r() * 10;
      const wb = 2.2 + r() * 0.8;
      errs.push(Math.abs(steerPolicy(ahead, car, speed, wb) - steerRule(ahead, car, speed, wb)));
    }
    errs.sort((p, q) => p - q);
    const mean = errs.reduce((p, q) => p + q, 0) / errs.length;
    expect(mean).toBeLessThan(0.02);
    expect(errs[Math.floor(errs.length * 0.99)]).toBeLessThan(0.08);
  });
});
