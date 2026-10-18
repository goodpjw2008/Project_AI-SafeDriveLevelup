/**
 * **보행자 횡단 의도 예측** (ai/intent.ts · models/intent.json · scripts/train-intent.ts).
 *
 * AI 자율주행은 보행자의 속(`intendsToCross`)을 읽지 않고, 몸이 선 자리 · 움직임 · 보행신호를 보는 신경망의 짐작으로
 * 양보한다. 여기서는 그 신경망이 지금의 특징과 맞는지(특징을 바꾸고 다시 학습하지 않으면 걸린다), 손 규칙 · 예전 위협
 * 예측(등속)보다 나은지, AI 운전자가 정말로 속 대신 짐작을 쓰는지를 본다. 22,818판을 이 짐작으로 달려 보는 것은
 * 라이브러리 전수 검증(tests/library.validate.*)이 한다.
 */

import { describe, expect, it } from 'vitest';

import {
  INTENT_FEATURES,
  INTENT_OUTPUTS,
  IntentEstimator,
  crosswalkAt,
  routeCrosses,
  type IntentContext,
  type IntentModel,
} from '../src/ai/intent';
import trained from '../src/ai/models/intent.json';
import { AutoDriver, type AutoDriveState } from '../src/game/AutoDriver';
import { WAIT_SETBACK } from '../src/game/pedBody';
import { CURB } from '../src/game/pedWalk';
import { PLAYER_APPROACH_X, STOP_LINE } from '../src/layout';
import { AUTO_DRIVE_RULE } from '../src/scenarios/challenge';
import { scenarioLibrary } from '../src/scenarios/library';
import { playScenario } from '../src/scenarios/playSim';

const model = trained as unknown as IntentModel;
const meta = model.meta as unknown as {
  yield: Record<string, number>;
  enter: Record<string, number>;
};

describe('보행자 횡단 의도 예측 — 모델', () => {
  it('학습한 모델이다 — 특징 · 출력 이름과 차례가 지금의 것과 같다 (바꿨으면 npm run train:intent)', () => {
    expect(model.meta.trained).toBe(true);
    expect(model.kind).toBe('intent-mlp');
    expect(model.names).toEqual([...INTENT_FEATURES]);
    expect(model.outputs).toEqual([...INTENT_OUTPUTS]);
    expect(model.W1[0]).toHaveLength(INTENT_FEATURES.length);
    expect(model.W2).toHaveLength(INTENT_OUTPUTS.length);
    expect(model.threshold).toBeGreaterThan(0);
    expect(model.threshold).toBeLessThanOrEqual(0.5);
  });

  /*
    LiDAR 가 잰 자리로 배운다 — 몸의 자리를 그대로 볼 때(99.97%)보다 어렵다. 센서가 재는 자리가 흔들리고, 붙어 선 사람이 한
    덩어리로 잡히고, 자전거는 가운데가 어긋난다. 그래도 손 규칙보다 3%p 넘게 낫고, 문턱을 낮춰 99% 를 잡는다.
  */
  it('처음 보는 판에서 — LiDAR 로 본 사람의 뜻을 손 규칙(연석에 붙어 섰나)보다 잘 가리고, 문턱에서는 거의 놓치지 않는다', () => {
    expect(meta.yield.accuracyAt50).toBeGreaterThan(0.97);
    expect(meta.yield.accuracyAt50 - meta.yield.ruleAccuracy).toBeGreaterThan(0.03);
    expect(meta.yield.recall).toBeGreaterThanOrEqual(0.99);
    // 뜻이 생긴 뒤 양보로 바뀌기까지 — 대부분 그 바퀴 안, 늦어도 두 바퀴(0.2초)
    expect(meta.yield.lag95).toBeLessThanOrEqual(0.2);
  });

  it('2초 안에 차도에 들어설 사람을 예전 위협 예측(등속)보다 훨씬 일찍 · 많이 잡는다', () => {
    expect(meta.enter.accuracy).toBeGreaterThan(meta.enter.cvAccuracy);
    expect(meta.enter.recall).toBeGreaterThan(meta.enter.cvRecall + 0.5);
    expect(meta.enter.leadSeconds).toBeGreaterThan(meta.enter.cvLeadSeconds + 0.5);
  });
});

/** A 횡단보도(남쪽) 동쪽 보도에 선 사람을 1.5초 동안 60Hz 로 지켜본다 — `axisAt(t)` 가 그 사람의 x */
function watch(axisAt: (t: number) => number, signal: 'green' | 'red' | null): ReturnType<IntentEstimator['estimate']> {
  const est = new IntentEstimator();
  const ctx: IntentContext = {
    pedSignal: { A: signal, B: signal, C: null, S: null },
    front: { x: PLAYER_APPROACH_X, z: 50 },
    speedKmh: 25,
  };
  for (let t = 0; t <= 1.5; t += 1 / 60) {
    // LiDAR 가 0.1초마다 한 바퀴 — 어른 한 사람의 크기(분류기의 본래 크기 0.9m)로 잡힌다
    if (Math.abs(t * 10 - Math.round(t * 10)) < 1e-6) {
      est.update(t, [{ id: 0, crosswalk: 'A', x: axisAt(t), z: 16.8, length: 0.9, width: 0.9 }], ctx, true);
    }
  }
  return est.estimate(0);
}

describe('보행자 횡단 의도 예측 — 보이는 것으로 짐작한다', () => {
  it('한 걸음 물러서 가만히 선 사람(건널 뜻 없음)에게는 양보하지 않는다', () => {
    const e = watch(() => CURB + WAIT_SETBACK, 'red');
    expect(e?.onRoadway).toBe(false);
    expect(e?.yields).toBe(false);
    expect(e?.enter).toBeLessThan(0.5);
  });

  it('연석까지 한 걸음 나와 선 사람(건너려는 사람)에게는 양보한다', () => {
    // 0.3초부터 0.55초 동안 0.8m 나선다 (game/pedBody.ts 의 STEP_UP_TIME)
    const e = watch((t) => CURB + WAIT_SETBACK * (1 - Math.min(1, Math.max(0, (t - 0.3) / 0.55))), 'green');
    expect(e?.yields).toBe(true);
    expect(e?.yield).toBeGreaterThan(0.9);
  });

  it('차도 위에 있는 사람에게는 신경망과 상관없이 양보한다 — 규칙 안전장치', () => {
    const e = watch(() => 6, 'red');
    expect(e?.onRoadway).toBe(true);
    expect(e?.yields).toBe(true);
  });

  it('지도에서 선 횡단보도를 찾고, 갈 길이 그 횡단보도를 지나는지 안다', () => {
    expect(crosswalkAt(CURB + 0.4, 16.8)).toBe('A');
    expect(crosswalkAt(16.8, -CURB - 0.4)).toBe('C');
    expect(crosswalkAt(0, 0)).toBe(null);
    const north = Array.from({ length: 30 }, (_, i) => ({ x: PLAYER_APPROACH_X, z: 30 - i }));
    expect(routeCrosses('A', north)).toBe(true);
    expect(routeCrosses('C', north)).toBe(false);
  });
});

describe('AI 운전자는 보행자의 속 대신 LiDAR 로 본 사람의 짐작을 쓴다', () => {
  /** A 정지선 2m 앞을 서행으로 다가가는 차 · 녹색 · 횡단보도 A 에 '건너려는' 사람 하나 */
  const state = (pedYield?: ReadonlyMap<number, boolean>): AutoDriveState => ({
    x: PLAYER_APPROACH_X,
    z: STOP_LINE + 4.4,
    yaw: 0,
    frontX: PLAYER_APPROACH_X,
    frontZ: STOP_LINE + 2,
    speedKmh: 12,
    stopHold: 0,
    vehicleLight: 'green',
    rightArrow: null,
    pedSignal: { A: 'green', B: 'green', C: null, S: null },
    pedestrians: [{ id: 0, crosswalk: 'A', intendsToCross: true, onConflictPath: true }],
    exitBlocked: false,
    isSchoolZone: false,
    approachZone: null,
    lead: null,
    ...(pedYield ? { pedYield } : {}),
  });

  it('짐작이 없으면(사람 운전자 흉내) 판정과 같은 값을 보고 선다', () => {
    expect(new AutoDriver(2.8).decide(state()).stop).toBe(true);
  });

  it('짐작이 "양보" 면 서고, "아님" 이면 사람의 속이 어떻든 선다고 보지 않는다', () => {
    expect(new AutoDriver(2.8).decide(state(new Map([[0, true]]))).stop).toBe(true);
    expect(new AutoDriver(2.8).decide(state(new Map([[0, false]]))).stop).toBe(false);
  });

  it('처음 보는 판을 LiDAR 로만 보고 달려도 — 위반 없이 끝나고, 다가간 횡단보도의 건너려는 사람을 놓치지 않는다', () => {
    const lib = scenarioLibrary().filter((e) => e.spec.pedestrians.length > 0);
    let wanted = 0;
    let caught = 0;
    for (let i = 7; i < lib.length; i += Math.floor(lib.length / 40)) {
      // 시뮬레이터 안의 AI 와 같은 것을 같은 바퀴로 돌린다 — 그 짐작이 실제 보행자의 속과 맞는지 본다
      const est = new IntentEstimator();
      const r = playScenario(lib[i].spec, {
        persona: 'careful',
        pace: AUTO_DRIVE_RULE.pace,
        stopZone: AUTO_DRIVE_RULE.stopZone,
        trace: false,
        onScan: (scan) => {
          est.update(scan.t, scan.people, scan.ctx, true);
          for (const w of scan.walkers) {
            // 내 차 앞 25m 안 — 서야 할지 정할 거리 — 의 건너려는 사람
            if (!w.yield || Math.hypot(w.x - scan.ctx.front.x, w.z - scan.ctx.front.z) > 25) continue;
            wanted += 1;
            if (scan.people.some((p) => Math.hypot(p.x - w.x, p.z - w.z) < 2 && est.estimate(p.id)?.yields)) caught += 1;
          }
        },
      });
      expect(r.result.violations.map((v) => v.code), `#${lib[i].spec.id}`).toEqual([]);
      expect(r.result.completed, `#${lib[i].spec.id}`).toBe(true);
    }
    expect(wanted).toBeGreaterThan(2000);
    expect(caught / wanted).toBeGreaterThan(0.97);
  });
});
