/**
 * 보행자가 판정 엔진에 넘기는 표본 검증.
 *
 * 특히 **"통행하려고 하는 때"의 경계**를 지킨다. 보행신호가 적색이라 보도에 서 있는 사람은
 * 건널 생각이 없고 건너서도 안 되므로 여기에 해당하지 않는다. 이걸 구분하지 않으면
 * 내 차량신호가 녹색인데 보도에 사람이 서 있다는 이유만으로 횡단 방해가 잡힌다
 * (녹색일 때 그쪽 보행신호는 항상 적색이라, 사실상 늘 걸린다).
 */

import { describe, expect, it } from 'vitest';
import type { PedSpawn } from '../src/scenarios/scenarios';
import * as THREE from 'three';
import { Pedestrian } from '../src/game/Pedestrian';
import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  PLAYER_EXIT_Z,
  ROAD_HALF_WIDTH,
} from '../src/layout';
import {
  AFTER_LEAD_DELAY,
  CURB,
  curbHoldSeconds,
  IMMINENT_DISTANCE,
  INTENT_LEAD,
  PedWalk,
  RED_BEAT,
  SIGNAL_HOLD_CAP,
  STEP_OFF_LATEST,
  WALK_SPEED_SCALE,
} from '../src/game/pedWalk';
import { CROSSWALK_OUTER as CROSSWALK_OUTER_Z } from '../src/layout';
import { WAIT_SETBACK } from '../src/game/Pedestrian';

/** 횡단보도 A 한가운데 — 차가 '이미 횡단보도 안'인 지점 (치수가 바뀌어도 따라간다) */
const INSIDE_CROSSWALK_A_Z = (CROSSWALK_INNER + CROSSWALK_OUTER) / 2;

/** 차는 멀리 있는 상태로 한 프레임 돌린다 */
const step = (p: Pedestrian, t: number, signal: 'green' | 'greenFlash' | 'red' | null) =>
  p.update(t, 1 / 60, signal, { x: 0, z: 60 }, true);

/** 화면에 선 자리의 x — 연석까지 나섰는지 보는 데 쓴다 */
const axisX = (p: Pedestrian): number => p.sample().x ?? NaN;

const make = (obeysSignal = true) =>
  new Pedestrian({ crosswalk: 'A', at: 1, from: 'left', obeysSignal, kind: 'adult' });

describe('보행자 표본 — 통행하려고 하는 때', () => {
  it('보행신호가 적색이면 보도에 서 있어도 통행 의사로 보지 않는다', () => {
    const p = make();
    step(p, 2, 'red');
    expect(p.sample().intendsToCross).toBe(false);
    p.dispose();
  });

  it('보행신호가 녹색점멸이어도 새로 건너지 않으므로 통행 의사가 아니다', () => {
    const p = make();
    step(p, 2, 'greenFlash');
    expect(p.sample().intendsToCross).toBe(false);
    p.dispose();
  });

  it('보행신호가 녹색이면 건너기 시작하므로 통행 의사가 있다', () => {
    const p = make();
    step(p, 2, 'green');
    /*
      **나설 조건이 풀린 뒤 연석에서 잠깐 더 선다** (pedWalk 의 `CURB_HOLD_SHARE`). 그동안에도
      '통행하려는 사람' 이라 양보 대상은 그대로다 — 걸음을 빠르게 하면서 이 시간을 두었기 때문에
      다 건너는 시각이 예전과 같고, 6천여 판의 장면이 어긋나지 않는다.
    */
    expect(p.sample().intendsToCross, '연석에서 기다리는 동안도 양보 대상').toBe(true);
    expect(p.sample().state).toBe('waiting');
    // 대기가 끝나면 빨간 느낌표가 뜨고(PedWalk 쪽에서 본다), 반 박자(RED_BEAT) 뒤에 발이 나간다
    step(p, 2 + curbHoldSeconds() - RED_BEAT, 'green');
    expect(p.sample().state, '빨강을 띄운 채 반 박자').toBe('waiting');
    step(p, 2 + curbHoldSeconds(), 'green');
    const s = p.sample();
    expect(s.intendsToCross).toBe(true);
    expect(s.state).toBe('crossing');
    p.dispose();
  });

  it('신호기가 없는 횡단보도에서는 대기 중이어도 통행 의사가 있다', () => {
    const p = make();
    step(p, 2, null);
    expect(p.sample().intendsToCross).toBe(true);
    p.dispose();
  });

  it('신호를 무시하는 보행자는 적색이어도 통행 의사가 있다', () => {
    const p = make(false);
    step(p, 2, 'red');
    expect(p.sample().intendsToCross).toBe(true);
    p.dispose();
  });

  it('등장 시각보다 한참 전에는 아무 의사도 없다', () => {
    const p = new Pedestrian({ crosswalk: 'A', at: 10, from: 'left', kind: 'adult' });
    step(p, 10 - INTENT_LEAD - 1, 'green');
    expect(p.sample().intendsToCross).toBe(false);
    p.dispose();
  });

  /*
    **뜻이 발보다 먼저다.** 시각으로 나서는 사람이 등장 시각에 뜻과 발을 같은 프레임에
    움직이면, 다가오던 배경 차에게 주는 예고가 0 이다 — 12m/s 로 달리는 차는 편안히
    서는 데 40m 가 필요한데 그때부터 줄이기 시작한다 (pedWalk.ts 의 INTENT_LEAD).
  */
  it('등장 시각 직전에는 아직 서 있지만 건널 뜻은 이미 있다', () => {
    const p = new Pedestrian({ crosswalk: 'A', at: 10, from: 'left', kind: 'adult' });
    step(p, 10 - INTENT_LEAD + 0.5, 'green');
    const s = p.sample();
    expect(s.state, '아직 발은 떼지 않았다').toBe('waiting');
    expect(s.intendsToCross, '뜻은 이미 드러났다').toBe(true);
    p.dispose();
  });

  /*
    **뜻은 화면에도 드러나야 한다.** 값만 켜 두면 배경 차가 왜 서는지 알 길이 없다 —
    사람은 판이 시작될 때부터 그 자리에 그러고 서 있었으니까. 건널 사람은 연석까지
    걸어 나와 서고, 건너지 않을 사람은 물러서 있다 (Pedestrian.ts 의 WAIT_SETBACK).
  */
  it('건널 뜻이 생기면 연석 쪽으로 걸어 나온다', () => {
    const p = new Pedestrian({ crosswalk: 'A', at: 10, from: 'left', kind: 'adult' });
    step(p, 0, 'red');
    const backX = axisX(p);

    // 뜻이 생기고 한 걸음 나설 시간을 준다
    for (let i = 0; i < 60; i++) step(p, 10 - INTENT_LEAD + 0.5, 'green');
    const curbX = axisX(p);

    expect(p.sample().state, '아직 발은 떼지 않았다').toBe('waiting');
    expect(curbX, '진행 방향(+x)으로 나와 섰다').toBeGreaterThan(backX);
    expect(curbX - backX).toBeCloseTo(WAIT_SETBACK, 1);
    p.dispose();
  });

  it('건널 뜻이 없는 사람은 연석에서 물러서 있다', () => {
    const p = make();
    for (let i = 0; i < 60; i++) step(p, 2, 'red');
    expect(p.sample().intendsToCross).toBe(false);
    // 물러선 자리는 차도에서 그만큼 더 멀다 (dir = +1 이므로 x 가 더 작다)
    expect(axisX(p)).toBeLessThan(-CURB);
    p.dispose();
  });

  it('차 앞으로 나서지 않고 기다리는 동안에는 통행 의사가 유지된다', () => {
    const p = make();
    // 차가 멀 때 건너려는 뜻을 보였다 (등장 시각 4초 전부터)
    p.update(-1, 1 / 60, 'green', { x: 0, z: 80 }, true, false, { carSpeedMs: 3.3 });
    expect(p.sample().intendsToCross).toBe(true);
    // 녹색이지만 차가 이미 횡단보도 A 안에 들어와 있어 출발하지 않는 상황 — 뜻은 거두지 않는다
    p.update(2, 1 / 60, 'green', { x: 0, z: INSIDE_CROSSWALK_A_Z }, true, false, { carSpeedMs: 3.3 });
    const s = p.sample();
    expect(s.state).toBe('waiting');
    expect(s.intendsToCross).toBe(true);
    p.dispose();
  });

  /*
    **설 수 없는 차 앞에서 새로 건너려 하지 않는다** (pedWalk.ts). 뜻이 막 드러나려는 순간 차가 코앞이면 그 차를 보내고
    드러낸다 — 판정은 뜻이 드러난 순간부터 양보 대상으로 보므로, 0.8m 앞에서 뜻을 드러내면 규정대로 모는 사람도 잡혔다.
  */
  it('설 수 없는 거리의 차 앞에서는 새로 뜻을 드러내지 않고, 차를 보낸 뒤 드러낸다', () => {
    const p = make();
    // 처음 보는 순간 차가 정지선 바로 앞에서 12km/h 로 달려오고 있다 — 설 수 없다
    p.update(2, 1 / 60, 'green', { x: 0, z: CROSSWALK_OUTER + 1 }, true, false, { carSpeedMs: 3.3 });
    expect(p.sample().intendsToCross).toBe(false);
    // 차가 서 있으면 드러낸다
    p.update(2.1, 1 / 60, 'green', { x: 0, z: CROSSWALK_OUTER + 1 }, false, false, { carSpeedMs: 0 });
    expect(p.sample().intendsToCross).toBe(true);
    p.dispose();
  });
});

/**
 * **횡단을 마칠 때까지 양보 대상**인가.
 *
 * 예전에는 '내 차로를 지났는가' 로 봤다. 그러면 가까운 쪽에서 건너오는 사람은 몇 초 만에
 * 조건에서 빠져, 아직 횡단보도 한복판인데 그 앞으로 지나가도 위반이 아니었다 —
 * 03번 시나리오가 가르치겠다고 적어 둔 문장과 정반대다.
 */
describe('보행자 표본 — 횡단을 마칠 때까지', () => {
  /** 횡단보도 C 를 z+ 보도에서 z- 로 건너는 사람. 내 진출 차로(z+)를 먼저 지난다. */
  const crossingC = () =>
    new Pedestrian({ crosswalk: 'C', at: 0, from: 'right', obeysSignal: false, kind: 'adult' });

  /** 차는 멀리 둔 채 지정한 시간만큼 걷게 한다 — 조건이 맞으면 도중에 멈춘다 */
  const walk = (p: Pedestrian, seconds: number, until?: () => boolean): number => {
    const dt = 0.05;
    let t = 0;
    for (; t < seconds; t += dt) {
      if (until?.()) break;
      p.update(1 + t, dt, null, { x: 60, z: 60 }, true);
    }
    return t;
  };

  it('내 차로를 지났어도 차도 위에 있으면 여전히 양보 대상이다', () => {
    const p = crossingC();
    /*
      **내 차로를 막 지난 순간**을 잡는다. 예전에는 "6초 걷게 한다" 였는데, 걸음 속도를 올리자
      그 6초에 차도를 아예 벗어나 버려 장면이 달라졌다 (WALK_SPEED_SCALE 을 2.1 → 3.0 으로 올릴 때
      실제로 깨졌다). 이 테스트가 묻는 것은 '몇 초인가' 가 아니라 **'내 차로를 지난 뒤에도 양보
      대상인가'** 이므로, 시간이 아니라 그 지점으로 멈춘다.
    */
    walk(p, 20, () => (p.sample().z ?? 99) < PLAYER_EXIT_Z);
    const s = p.sample();
    // 내 차로는 이미 지났고
    expect(s.z!).toBeLessThan(PLAYER_EXIT_Z);
    // 아직 차도 위인데
    expect(Math.abs(s.z!)).toBeLessThan(ROAD_HALF_WIDTH);
    // 양보 대상이다
    expect(s.state).toBe('crossing');
    expect(s.onConflictPath).toBe(true);
    p.dispose();
  });

  it('차도를 벗어나면 양보 대상이 아니다', () => {
    const p = crossingC();
    // 다 건널 때까지 걷게 한다 (넉넉히)
    walk(p, 30);
    const s = p.sample();
    expect(Math.abs(s.z ?? ROAD_HALF_WIDTH + 1)).toBeGreaterThan(ROAD_HALF_WIDTH);
    expect(s.onConflictPath).toBe(false);
    p.dispose();
  });
});

/**
 * **거리 방아쇠** — 시각이 아니라 '내가 얼마나 다가왔는가' 로 나선다.
 *
 * 시각으로만 맞추면 접근 거리·주행 속도·도로 폭이 조금만 달라져도 내가 닿기 전에 다
 * 건너가 버려 "기다린다" 는 장면 자체가 사라진다 (실제로 도로 폭을 바꾸며 두 번 어긋났다).
 */
describe('보행자 — 거리 방아쇠', () => {
  // 방아쇠(20m) 안이면서 '코앞'(STEP_OFF_LATEST) 밖 — 연석 대기가 그대로 걸리는 자리다
  const near = { x: CROSSWALK_INNER - (STEP_OFF_LATEST + 4), z: PLAYER_EXIT_Z };
  const far = { x: 0, z: 40 };

  it('차가 멀면 보도에서 기다린다', () => {
    const p = new Pedestrian({ crosswalk: 'C', at: 0, startWithin: 20, from: 'right', obeysSignal: false });
    p.update(1, 0.05, null, far, true);
    expect(p.sample().state).toBe('waiting');
    p.dispose();
  });

  it('지정한 거리 안으로 들어오면 건너기 시작한다', () => {
    const p = new Pedestrian({ crosswalk: 'C', at: 0, startWithin: 20, from: 'right', obeysSignal: false });
    p.update(1, 0.05, null, far, true);
    p.update(2, 0.05, null, near, true);
    // 방아쇠가 당겨진 뒤 연석에서 더 기다렸다 나선다 (pedWalk 의 CURB_HOLD_SHARE)
    expect(p.sample().state).toBe('waiting');
    p.update(2 + curbHoldSeconds() - RED_BEAT, 0.05, null, near, true);
    expect(p.sample().state, '빨강을 띄운 채 반 박자').toBe('waiting');
    p.update(2 + curbHoldSeconds(), 0.05, null, near, true);
    expect(p.sample().state).toBe('crossing');
    p.dispose();
  });
});

/**
 * **빨간 느낌표는 예보가 아니라 동작의 첫 박이다.**
 *
 * 예전에는 방아쇠 거리로 빨강을 **미리 점쳐** 켰다. 차가 줄이며 다가오면 점이 빗나가, 빨강이 뜨고도 사람이
 * 2~5초를 더 서 있었다 (사용자: "빨간색으로 변하고 너무 늦게 이동해서 문제가 생긴다"). 지금은 나설 조건이
 * 다 풀린 순간 빨강을 켜고 `RED_BEAT` 뒤에 발을 뗀다 — 어긋날 수가 없다.
 */
describe('빨간 느낌표 — 띄우면 곧바로 나선다', () => {
  const far = { x: 6.8, z: 200 };

  it('시각으로 나서는 사람 — 빨강은 발을 떼기 RED_BEAT 전에 켜진다', () => {
    const w = new PedWalk({ crosswalk: 'C', at: 10, from: 'left', obeysSignal: false });
    const dt = 1 / 120;
    let firstRed = -1;
    let stepped = -1;
    for (let t = 0; t < 20 && stepped < 0; t += dt) {
      w.update(t, dt, null, far, true);
      const s = w.sample();
      if (firstRed < 0 && s.imminent) firstRed = t;
      if (s.state === 'crossing') stepped = t;
    }
    expect(firstRed, '빨강이 켜진 때').toBeGreaterThan(0);
    const gap = stepped - firstRed;
    expect(gap, `빨강 → 발뗌 ${gap.toFixed(2)}초`).toBeGreaterThan(RED_BEAT - 0.1);
    expect(gap, `빨강 → 발뗌 ${gap.toFixed(2)}초`).toBeLessThan(RED_BEAT + 0.1);
  });

  it('뜻(노랑)은 훨씬 먼저다 — 빨강만 보고 반응하게 두지 않는다', () => {
    const w = new PedWalk({ crosswalk: 'C', at: 10, from: 'left', obeysSignal: false });
    w.update(10 - INTENT_LEAD + 0.2, 0.016, null, far, true);
    expect(w.sample().intendsToCross, '뜻은 이미 있다').toBe(true);
    expect(w.sample().imminent, '아직 빨강은 아니다').toBe(false);
  });

  it('나설 수 없게 되면 빨강도 거둔다 — 띄워 놓고 안 나서는 일이 없다', () => {
    const w = new PedWalk({ crosswalk: 'C', at: 0, from: 'left', obeysSignal: true });
    const dt = 1 / 120;
    // 녹색이면 곧 나선다 — 빨강이 켜진다
    for (let t = 0; t < 1; t += dt) w.update(t, dt, 'green', far, true);
    expect(w.sample().imminent, '녹색 — 곧 나선다').toBe(true);
    // 적색으로 바뀌면 나설 수 없다 — 빨강을 거둔다
    w.update(1.1, dt, 'red', far, true);
    expect(w.sample().imminent, '적색 — 거둔다').toBe(false);
    expect(w.sample().state).toBe('waiting');
  });

  it('보행신호를 지키느라 서 있는 사람은 "곧" 이 아니다', () => {
    const w = new PedWalk({ crosswalk: 'C', at: 1, from: 'left', obeysSignal: true });
    w.update(5, 0.016, 'red', far, true);
    expect(w.sample().imminent).toBe(false);
  });
});

/*
  **빨간 느낌표가 떠 있고 차가 서 있으면 건넌다.**

  빨간 느낌표(imminent)는 거리 방아쇠보다 IMMINENT_DISTANCE 만큼 먼저 켜진다. 운전자가 양보하려고 그
  사이에서 조금 일찍 서면 차가 더 다가오지 않아, 사람은 "곧 건넌다" 를 띄운 채 보도에 영영 서 있었다.
*/
describe('빨간 느낌표 — 차가 서서 기다려 주면 건넌다', () => {
  const at = (z: number) => ({ x: 6.8, z });
  // 첫 횡단보도에서 5m 안으로 오면 나서는 사람 (라이브러리의 '건너려고 대기')
  const make = () => new PedWalk({ crosswalk: 'A', at: 0, startWithin: 5, from: 'right' });

  it('방아쇠 밖(8m)에서 서면 — 빨간 느낌표가 뜨고, 곧 건너기 시작한다', () => {
    const w = make();
    const front = at(CROSSWALK_OUTER_Z + 8); // 방아쇠 5m 밖, 건널 뜻이 확실한 거리(5+6m) 안
    let t = 0;
    // 다가오는 동안에는 아직 건너지 않는다 (방아쇠 밖이다)
    w.update(t, 0.05, null, front, true);
    expect(w.sample().state).toBe('waiting');
    // 그 자리에 서서 기다려 주면 건넌다 (연석에서 더 서는 시간까지 기다려 준다)
    for (t = 0.05; t < 2 + curbHoldSeconds(); t += 0.05) w.update(t, 0.05, null, front, false);
    expect(w.sample().state).toBe('crossing');
  });

  it('차가 움직이는 중이면 방아쇠 거리까지 기다린다 — 달려오는 차 앞으로 나서지 않는다', () => {
    const w = make();
    const front = at(CROSSWALK_OUTER_Z + 8);
    for (let t = 0; t < 2; t += 0.05) w.update(t, 0.05, null, front, true);
    expect(w.sample().state).toBe('waiting');
  });

  it('빨간 느낌표 거리보다 먼 곳에서 선 차는 기다리지 않는다', () => {
    const w = make();
    const front = at(CROSSWALK_OUTER_Z + 5 + IMMINENT_DISTANCE + 3);
    for (let t = 0; t < 2; t += 0.05) w.update(t, 0.05, null, front, false);
    expect(w.sample().imminent).toBe(false);
    expect(w.sample().state).toBe('waiting');
  });
});

/*
  **보행자는 땅에 서 있다.** 한때 다리가 엉덩이(0.86)에서 0.47 만 내려와 발끝이 땅에서 0.39 위에 있었다 — 배율 2.0 이면
  어른이 0.77m 떠 있었고, 사용자가 "사람이 횡단보도 위로 공중에 떠 있는 것처럼 보여" 라고 짚었다 (Pedestrian.ts 의 HIP_HEIGHT).
  걷는 동안에도 떠서는 안 된다 — 다리를 벌리면 두 발이 함께 들리므로 그만큼 몸을 내린다 (poseLimbs).
*/
describe('보행자는 땅에 서 있다', () => {
  const lowest = (p: Pedestrian): number => {
    p.group.updateMatrixWorld(true);
    // 발밑 원(ring)과 느낌표는 몸이 아니다 — 몸(첫 자식)만, 기울어진 다리의 상자 모서리가 아니라 꼭짓점으로 잰다
    return new THREE.Box3().setFromObject(p.group.children[0], true).min.y;
  };

  it('어른 · 아이 · 노인 모두 발이 땅에 닿는다', () => {
    for (const kind of ['adult', 'child', 'elder'] as const) {
      const p = new Pedestrian({ crosswalk: 'A', at: 1, from: 'left', kind });
      expect(Math.abs(lowest(p)), kind).toBeLessThan(0.02);
    }
  });

  it('걷는 동안에도 발이 땅에서 뜨지 않는다', () => {
    const p = new Pedestrian({ crosswalk: 'A', at: 0, from: 'left', obeysSignal: false, kind: 'adult' });
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      step(p, i / 30, 'green');
      worst = Math.max(worst, Math.abs(lowest(p)));
    }
    expect(p.sample().state, '실제로 걸었다').not.toBe('waiting');
    expect(worst).toBeLessThan(0.05);
  });
});

/**
 * **다리가 팔보다 굵어야 다리로 읽힌다.**
 *
 * 발을 땅에 붙이려고 다리만 늘렸더니 굵기는 그대로라 죽마처럼 보였다 — 사용자가 "다리가 너무 얇고 길다,
 * 손 비율과 두께에 맞춰 달라" 고 짚었다. 숫자 하나(`LEG_RADIUS`)를 고쳐 맞춘 비율이라, 나중에 키나 몸통을
 * 손볼 때 조용히 어긋날 수 있다. 사람 몸의 비율이니 값이 아니라 **관계**로 못 박는다.
 */
describe('보행자 몸 비율 — 다리는 팔보다 굵고, 키의 절반쯤이다', () => {
  /** 몸(첫 자식) 안의 캡슐들을 몸통 · 팔 · 다리로 가른다 — 팔다리는 흔들리려고 피벗 그룹 안에 있다 */
  const limbs = (p: Pedestrian) => {
    const body = p.group.children[0];
    const caps: THREE.Mesh[] = [];
    body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'CapsuleGeometry') {
        caps.push(o as THREE.Mesh);
      }
    });
    // 캡슐이 만들어질 때 받은 치수 — 정점을 다시 재는 것보다 정확하다
    const dims = (m: THREE.Mesh) => (m.geometry as THREE.CapsuleGeometry).parameters;
    const radius = (m: THREE.Mesh) => dims(m).radius;
    const full = (m: THREE.Mesh) => dims(m).length + 2 * dims(m).radius;
    const arms = caps.filter((m) => m.parent !== body);
    // 바지 색으로 다리를 가린다 — 팔 · 몸통은 옷 색을 나눠 쓴다
    const legs = arms.filter((m) => (m.material as THREE.MeshStandardMaterial).color.getHex() === 0x2b3038);
    return { arm: arms.find((m) => !legs.includes(m))!, leg: legs[0], radius, full };
  };

  it('다리 굵기가 팔의 1.4 ~ 2.0 배다', () => {
    const { arm, leg, radius } = limbs(new Pedestrian({ crosswalk: 'A', at: 1, from: 'left', kind: 'adult' }));
    const ratio = radius(leg) / radius(arm);
    expect(ratio, `다리/팔 = ${ratio.toFixed(2)}`).toBeGreaterThan(1.4);
    expect(ratio, `다리/팔 = ${ratio.toFixed(2)}`).toBeLessThan(2.0);
  });

  it('다리 길이가 키의 0.44 ~ 0.52 다 — 실제 사람의 다리 비율', () => {
    for (const kind of ['adult', 'child', 'elder'] as const) {
      const p = new Pedestrian({ crosswalk: 'A', at: 1, from: 'left', kind });
      const { leg, full } = limbs(p);
      p.group.updateMatrixWorld(true);
      const height = new THREE.Box3().setFromObject(p.group.children[0], true).max.y;
      // 배율은 그룹이 아니라 지오메트리에 들어 있다 — 잰 길이가 곧 화면 길이다 (Pedestrian.build 의 s)
      const share = full(leg) / height;
      expect(share, `${kind} 다리/키 = ${share.toFixed(2)}`).toBeGreaterThan(0.44);
      expect(share, `${kind} 다리/키 = ${share.toFixed(2)}`).toBeLessThan(0.52);
    }
  });
});

/**
 * **걸음은 빨라지고, 다 건너는 시각은 그대로다.**
 *
 * 사용자가 "횡단보도 건너는 속도가 너무 느리다" 고 해서 걸음 배율을 2.1 → 3.0 으로 올렸다. 그런데 판마다
 * 보행자가 나서는 때는 2.1 에 맞춰 둔 값이라, 걸음만 빠르게 하면 **406개 판에서 내가 닿기 전에 다 건너**
 * 보행자가 아무 역할도 하지 않았다. 그래서 빨라진 만큼 **연석에서 더 기다렸다 나선다** — 기다리는 동안에도
 * 양보 대상이라(제27조 제1항의 "통행하려고 하는 때") 판의 장면이 하나도 어긋나지 않는다.
 *
 * 이 관계가 깨지면 6천 판이 조용히 헐거워지므로, 두 끝을 여기서 못 박는다.
 */
describe('연석에서 기다렸다 성큼성큼 — 다 건너는 시각은 예전과 같다', () => {
  /** 차를 멀리 둔 채 다 건널 때까지 돌리고, 나선 때와 끝난 때를 돌려준다 */
  const run = (spawn: PedSpawn, signal: 'green' | null) => {
    const w = new PedWalk(spawn);
    const dt = 1 / 120;
    let stepped = -1;
    let done = -1;
    for (let t = 0; t < 60 && done < 0; t += dt) {
      w.update(t, dt, signal, { x: 300, z: 300 }, false);
      const s = w.sample();
      if (stepped < 0 && s.state === 'crossing') stepped = t;
      if (s.state === 'done') done = t;
    }
    return { stepped, done };
  };

  it('신호기 없는 횡단보도 — 어른 · 아이 · 노인 모두 예전 걸음으로 걸었을 때와 같은 때에 끝난다', () => {
    const base = { adult: 1.2, child: 1.35, elder: 0.85 };
    for (const kind of ['adult', 'child', 'elder'] as const) {
      const { done } = run({ crosswalk: 'C', at: 0, from: 'right', obeysSignal: false, kind }, null);
      // 예전 배율(2.1)로 곧장 건넜을 때의 시각 — 연석 대기가 그 차이를 메운다
      const before = (2 * CURB + 0.4) / (base[kind] * 2.1);
      expect(done, `${kind}: ${done.toFixed(2)}초 vs 예전 ${before.toFixed(2)}초`).toBeGreaterThan(before - 0.2);
      expect(done, `${kind}: ${done.toFixed(2)}초 vs 예전 ${before.toFixed(2)}초`).toBeLessThan(before + 0.2);
    }
  });

  it('걸음 자체는 빨라졌다 — 발을 뗀 뒤 건너는 데 걸리는 시간이 줄었다', () => {
    const { stepped, done } = run({ crosswalk: 'C', at: 0, from: 'right', obeysSignal: false, kind: 'adult' }, null);
    const crossing = done - stepped;
    const before = (2 * CURB + 0.4) / (1.2 * 2.1);
    expect(crossing, `건너는 데 ${crossing.toFixed(2)}초`).toBeLessThan(before * 0.8);
    expect(WALK_SPEED_SCALE).toBeGreaterThan(2.1);
  });

  it('보행신호를 지키는 사람은 상한만큼만 기다린다 — 녹색을 놓치면 아예 건너지 못한다', () => {
    const { stepped } = run({ crosswalk: 'C', at: 0, from: 'right', kind: 'elder' }, 'green');
    // 노인의 제 대기(3.8초)보다 훨씬 짧다 — 녹색이 끝나기 전에 나서야 한다
    expect(curbHoldSeconds(0.85)).toBeGreaterThan(SIGNAL_HOLD_CAP);
    expect(stepped, `나선 때 ${stepped.toFixed(2)}초`).toBeLessThan(SIGNAL_HOLD_CAP + 0.1);
  });
});

/**
 * **앞차 뒤에서 나오는 사람은 앞차가 지나가자마자 빨강을 띄우고 곧바로 나선다.**
 *
 * 57번에서 사용자가 짚었다 — 앞차가 지나간 뒤 이 사람이 **노란 느낌표만 4.1초** 띄우고 서 있다가, 내가 1.8m
 * 앞에 와서야 빨강을 띄웠다. 노랑을 "서라" 로 읽지 않은 운전자는 그대로 들어가 위반이 됐다: "보행자가 앞차가
 * 지나가자마자 즉시 보행 의사를 바로 붉은색으로 밝히고 진입해야 운전자가 인지하고 멈출 것 같아."
 *
 * 다만 **시간이 아니라 거리로** 건다 — 앞차가 지나갔고 **내가 방아쇠 거리 안에 들어왔을 때**다. 바로 뒤따르던
 * 운전자에게는 즉시고, 보호구역에서 서느라 한참 뒤에 있는 운전자에게는 다가올 때다. 시간으로 걸었더니 뒤에
 * 붙잡혀 있던 운전자가 닿기 전에 아이가 다 건너 버렸다.
 */
describe('앞차 뒤 사람 — 앞차가 지나가자마자 빨강 → 곧바로 나선다', () => {
  const dt = 1 / 120;
  /** 앞차 뒤로 나서는 사람 — 라이브러리의 behindLead 와 같은 모양 */
  const ped = (startWithin = 12) =>
    new PedWalk({ crosswalk: 'C', at: 0, startWithin, from: 'right', obeysSignal: false, afterLead: true, kind: 'adult' });
  /** 횡단보도 C 를 m 앞둔 내 차 */
  const carAt = (m: number) => ({ x: CROSSWALK_INNER - m, z: PLAYER_EXIT_Z });

  it('앞차가 가리고 있는 동안에는 아무 뜻도 보이지 않는다', () => {
    const w = ped();
    for (let t = 0; t < 2; t += dt) w.update(t, dt, null, carAt(10), true, false, { leadInWay: true, carSpeedMs: 3.9 });
    expect(w.sample().intendsToCross).toBe(false);
    expect(w.sample().imminent).toBe(false);
  });

  it('앞차가 지나간 순간 내가 가까우면 — 곧바로 빨강, 반 박자 뒤 발을 뗀다', () => {
    const w = ped();
    let red = -1;
    let stepped = -1;
    for (let t = 0; t < 4 && stepped < 0; t += dt) {
      // 1초까지는 앞차가 가리고, 그 뒤 지나간다. 나는 10m 앞 — 방아쇠(12m) 안이다
      w.update(t, dt, null, carAt(10), true, false, { leadInWay: t < 1, carSpeedMs: 1 });
      if (red < 0 && w.sample().imminent) red = t;
      if (w.sample().state === 'crossing') stepped = t;
    }
    expect(red - 1, `앞차가 지나간 뒤 빨강까지 ${(red - 1).toFixed(2)}초`).toBeLessThan(0.1);
    expect(stepped - red, `빨강 → 발뗌 ${(stepped - red).toFixed(2)}초`).toBeLessThan(RED_BEAT + 0.05);
  });

  it('내가 멀리 있으면 — 노랑도 빨강도 없이 기다리다, 다가오면 그때 곧바로 빨강', () => {
    const w = ped(12);
    // 앞차는 지나갔고 나는 30m 뒤(보호구역 앞에서 서 있다)
    for (let t = 0; t < 2; t += dt) w.update(t, dt, null, carAt(30), false, false, { leadInWay: false });
    expect(w.sample().intendsToCross, '멀 때는 뜻도 안 보인다 — 노랑만 오래 떠 있지 않게').toBe(false);
    expect(w.sample().imminent).toBe(false);
    // 다가와서 방아쇠 안(10m)에 들어온다
    let red = -1;
    for (let t = 2; t < 3 && red < 0; t += dt) {
      w.update(t, dt, null, carAt(10), true, false, { leadInWay: false, carSpeedMs: 1 });
      if (w.sample().imminent) red = t;
    }
    expect(red - 2, `다가온 뒤 빨강까지 ${(red - 2).toFixed(2)}초`).toBeLessThan(0.1);
  });

  it('연석 대기를 받지 않는다 — 뜸을 들이면 노랑만 떠 있는 시간이 다시 생긴다', () => {
    expect(AFTER_LEAD_DELAY).toBe(0);
  });
});

/**
 * **내가 다 온 뒤에 나서지 않는다.**
 *
 * 연석 대기(위)는 '아직 먼 차' 앞에서 뜸을 들이는 것이다. 그런데 기다리는 동안 차가 코앞까지 오면, 운전자
 * 눈에는 **서 있던 사람이 갑자기 나오는** 장면이 된다 — 실제로 두 번째 횡단보도에서 발을 떼는 순간 내 차는
 * 중앙값 1.8m 앞이었다 (사용자: "너무 늦게 출발해서 운전자가 예측할 수가 없어"). 그래서 차가 `STEP_OFF_LATEST`
 * 안까지 오면 기다림을 끝내고 나선다.
 */
describe('다가오는 차 앞에서 먼저 나선다 — 코앞에서 튀어나오지 않는다', () => {
  it('차가 달려오면 — 연석 대기가 남았어도 STEP_OFF_LATEST 앞에서는 나선다', () => {
    // 16m 에서 나서기로 된 사람 — 그대로 두면 연석 대기 2.7초 뒤(6.5m 앞)에야 발을 뗀다
    const w = new PedWalk({ crosswalk: 'C', at: 0, startWithin: 16, from: 'right', obeysSignal: false, kind: 'adult' });
    const dt = 1 / 120;
    const speed = 3.5; // 서행 12.6km/h — 횡단보도 앞에서 실제로 내는 속도
    let stepOffDistance = -1;
    for (let t = 0, d = 30; t < 12 && d > 0; t += dt) {
      d -= speed * dt;
      w.update(t, dt, null, { x: CROSSWALK_INNER - d, z: PLAYER_EXIT_Z }, true, false, { carSpeedMs: speed });
      if (w.sample().state === 'crossing') { stepOffDistance = d; break; }
    }
    expect(stepOffDistance, `발을 뗀 곳 ${stepOffDistance.toFixed(1)}m 앞`).toBeGreaterThan(0);
    expect(stepOffDistance).toBeLessThan(STEP_OFF_LATEST + 0.5);
    // 서행 중인 차가 편안히 서는 거리(반응 1초 + 제동 ≈ 5.3m)보다는 멀다 — 보고 설 수 있다
    expect(stepOffDistance, `발을 뗀 곳 ${stepOffDistance.toFixed(1)}m 앞`).toBeGreaterThan(5.3);
  });
});
