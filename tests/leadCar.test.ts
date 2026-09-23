/**
 * 앞차 — **게임과 검증기가 함께 쓰는 한 벌**(game/leadDrive.ts)이 약속대로 움직이는가.
 *
 * 앞차가 가르치는 것은 둘이다. 규정대로 서는 앞차는 "제때 서지 않으면 추돌한다" 를,
 * 일시정지를 건너뛰는 앞차는 "앞차가 가도 나는 선다" 를. 둘 다 앞차가 **정확히 그렇게**
 * 움직일 때만 성립하고, 어긋나면 화면에서 보기 전까지 아무도 모른다.
 */

import { describe, expect, it } from 'vitest';

import { LEAD_HALF_LENGTH_MAX, LeadDrive, type LeadWorld } from '../src/game/leadDrive';
import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  INTERSECTION_HALF,
  LANE_WIDTH,
  SPAWN_Z,
  SPAWN_Z_SCHOOL_ZONE,
  STOP_LINE,
} from '../src/layout';
import { Vehicle } from '../src/game/Vehicle';
import type { PedestrianSample } from '../src/rules/lawRules';
import { DT, simulate } from '../src/scenarios/driveSim';
import {
  LEAD_CAR_CHANCE,
  SCENARIOS,
  STANDARD_PROGRAM,
  STRAIGHT_LEAD_WAIT,
  fitStraightLeadWait,
  phaseAt,
  spawnZ,
  getScenario,
  leadPlanOf,
  leadSpecFor,
  rollLeadTurn,
  type LeadPlan,
  type ScenarioSpec,
} from '../src/scenarios/scenarios';
import { CAR_HALF_LENGTH } from '../src/scenarios/turnPath';
import { validateScenario } from '../src/scenarios/validate';

const world = (over: Partial<LeadWorld> = {}): LeadWorld => ({
  vehicleLight: 'red',
  rightArrow: null,
  pedSignal: { A: 'red', B: 'red', C: 'red', S: null },
  approachZone: null,
  pedestrians: [],
  exitBlocked: false,
  isSchoolZone: false,
  ...over,
});

const make = (behavior: 'lawful' | 'rolling', headway = 2): LeadDrive =>
  new LeadDrive(
    { behavior, headway },
    {
      playerSpawnZ: SPAWN_Z,
      playerHalfLength: CAR_HALF_LENGTH,
      halfLength: LEAD_HALF_LENGTH_MAX,
      isSchoolZone: false,
      hasApproachZone: false,
    },
  );

/** 앞차만 굴려 본다 — 앞범퍼가 정지선을 지날 때까지의 최저 속도와 선 시간 */
function runToLine(lead: LeadDrive, w: (t: number) => LeadWorld) {
  let minSpeedBeforeLine = Infinity;
  let stoppedFor = 0;
  let t = 0;
  while (lead.pose().front.z > STOP_LINE - 1 && t < 60) {
    if (lead.pose().front.z > STOP_LINE - 0.2) {
      minSpeedBeforeLine = Math.min(minSpeedBeforeLine, lead.speedKmh);
      if (lead.speedKmh < 0.2) stoppedFor += DT;
    }
    lead.update(DT, w(t));
    t += DT;
  }
  return { minSpeedBeforeLine, stoppedFor, t, frontZ: lead.pose().front.z };
}

describe('앞차 상태기계', () => {
  it('규정대로 서는 앞차는 적색에 정지선 앞에서 완전히 섰다가 간다', () => {
    const lead = make('lawful');
    const r = runToLine(lead, () => world());
    expect(r.minSpeedBeforeLine).toBeLessThan(0.2);
    expect(r.stoppedFor, '따라오는 사람이 알아볼 만큼 버틴다').toBeGreaterThan(1.5);
    expect(r.t, '서고 나서 다시 간다').toBeLessThan(60);
    expect(lead.skippedStops).toEqual([]);
  });

  it('일시정지를 건너뛰는 앞차는 적색에도 서지 않고 지나가며, 그 사실이 기록된다', () => {
    const lead = make('rolling');
    const r = runToLine(lead, () => world());
    expect(r.minSpeedBeforeLine).toBeGreaterThan(5);
    expect(lead.skippedStops).toEqual(['A']);
  });

  it('녹색에서는 두 앞차 모두 서지 않는다', () => {
    for (const b of ['lawful', 'rolling'] as const) {
      const lead = make(b);
      const r = runToLine(lead, () => world({ vehicleLight: 'green' }));
      expect(r.minSpeedBeforeLine, b).toBeGreaterThan(5);
      expect(lead.skippedStops, b).toEqual([]);
    }
  });

  it('멀리서 녹색이었다가 다가가는 사이 적색이 되면, 규정대로 서는 앞차는 선다', () => {
    const lead = make('lawful');
    const r = runToLine(lead, (t) => world({ vehicleLight: t < 1 ? 'green' : 'red' }));
    expect(r.minSpeedBeforeLine).toBeLessThan(0.2);
  });

  it('두 앞차 모두 정지선을 밟고 서지 않는다', () => {
    const lead = make('lawful');
    const ped: PedestrianSample = { crosswalk: 'A', intendsToCross: true, onConflictPath: true };
    let minFront = Infinity;
    for (let t = 0; t < 20; t += DT) {
      lead.update(DT, world({ vehicleLight: 'green', pedestrians: [ped] }));
      minFront = Math.min(minFront, lead.pose().front.z);
    }
    expect(minFront).toBeGreaterThan(STOP_LINE);
  });

  it('성향과 무관하게 횡단보도의 보행자에게는 양보한다 — 앞차는 사람을 치지 않는다', () => {
    for (const b of ['lawful', 'rolling'] as const) {
      const lead = make(b);
      const ped: PedestrianSample = { crosswalk: 'C', intendsToCross: true, onConflictPath: true };
      let maxX = -Infinity;
      for (let t = 0; t < 30; t += DT) {
        lead.update(DT, world({ vehicleLight: 'green', pedestrians: [ped] }));
        maxX = Math.max(maxX, lead.pose().front.x);
      }
      expect(maxX, b).toBeLessThan(14.8);
    }
  });

  /*
    **내 차는 앞차를 따라가되, 앞차가 설 때는 대신 서 주지 않는다** (Vehicle.ts 의 followTarget).

    두 차가 같은 속도표만 따르면 서행에서 간격이 1m 남짓까지 붙었다 — 화면으로 보기 전까지
    아무 테스트도 못 잡았다. 반대로 끝까지 따라 서게 두면 "앞차가 서면 나도 선다" 는 판단이
    사라진다. 둘 다 잡는다.
  */
  const drive = (behavior: 'lawful' | 'rolling', zone: boolean, press: (gap: number) => boolean) => {
    const spawn = zone ? SPAWN_Z_SCHOOL_ZONE : SPAWN_Z;
    const me = new Vehicle(4.6, false, zone, spawn);
    const lead = new LeadDrive(
      { behavior, headway: 1.6 },
      { playerSpawnZ: spawn, playerHalfLength: 2.3, halfLength: 2.4, isSchoolZone: false, hasApproachZone: zone },
    );
    // 정면 적색 — 규정대로 서는 앞차는 정지선에서 선다. 보호구역 횡단보도는 신호기가 있고 녹색
    const w = world({ vehicleLight: 'red', approachZone: zone ? { light: 'green' } : null });
    let minGap = Infinity;
    for (let t = 0; t < 40 && me.z > INTERSECTION_HALF + 4; t += DT) {
      const gap = lead.gapFrom(me.front.x, me.front.z);
      me.update({ stop: press(gap), steer: 0, rightSignal: true }, DT, { gap, speedMs: lead.speedMs });
      lead.update(DT, w);
      minGap = Math.min(minGap, lead.gapFrom(me.front.x, me.front.z));
      if (minGap <= 0) break;
    }
    return minGap;
  };

  it('서지 않는 앞차를 따라갈 때는 아무것도 누르지 않아도 간격이 유지된다', () => {
    for (const zone of [false, true]) {
      expect(drive('rolling', zone, () => false), zone ? '보호구역 판' : '일반 판').toBeGreaterThan(2.5);
    }
  });

  it('앞차가 서면 내가 서지 않는 한 추돌한다 — 그 판단은 자동이 아니다', () => {
    expect(drive('lawful', false, () => false)).toBeLessThanOrEqual(0);
  });

  it('앞차가 서는 것을 보고 정지를 누르면 추돌하지 않는다', () => {
    expect(drive('lawful', false, (gap) => gap < 4.5)).toBeGreaterThan(0.5);
  });

  /*
    ── 직진하는 앞차 ─────────────────────────────────────────────────────────

    우회전 차로가 따로 없는 교차로에서 우회전을 막는 가장 현실적인 상황이다.
    **직진은 적색에 갈 수 없어서**(우회전만 "정지 후 진행") 앞차가 오래 서 있고,
    적색에 우회전이 허용되는 나도 그 뒤에서 기다릴 수밖에 없다.
  */
  const makeStraight = (headway = 2): LeadDrive =>
    new LeadDrive(
      { behavior: 'lawful', path: 'straight', headway },
      {
        playerSpawnZ: SPAWN_Z,
        playerHalfLength: CAR_HALF_LENGTH,
        halfLength: LEAD_HALF_LENGTH_MAX,
        isSchoolZone: false,
        hasApproachZone: false,
      },
    );

  it('직진 앞차는 적색이면 정지선을 넘지 않는다 — 우회전과 달리 "정지 후 진행" 이 없다', () => {
    const lead = makeStraight();
    for (let t = 0; t < 40; t += DT) lead.update(DT, world({ vehicleLight: 'red' }));
    expect(lead.pose().front.z).toBeGreaterThan(STOP_LINE);
    expect(lead.speedKmh).toBeLessThan(0.2);
  });

  it('직진 앞차는 녹색이 되면 교차로를 그대로 지나간다', () => {
    const lead = makeStraight();
    for (let t = 0; t < 30; t += DT) {
      lead.update(DT, world({ vehicleLight: t < 10 ? 'red' : 'green' }));
    }
    expect(lead.pose().center.z, '교차로를 지나 북쪽으로 갔다').toBeLessThan(-INTERSECTION_HALF);
    expect(lead.pose().center.x, '차로를 벗어나지 않는다').toBeCloseTo(6.825, 1);
  });

  it('직진 앞차 뒤에서는 적색에도 갈 수 없다 — 정지를 누르지 않으면 추돌한다', () => {
    const run = (press: (gap: number) => boolean): { minGap: number; myZ: number } => {
      const me = new Vehicle(4.6, false, false, SPAWN_Z);
      const lead = makeStraight(2);
      let minGap = Infinity;
      for (let t = 0; t < 30; t += DT) {
        const gap = lead.gapFrom(me.front.x, me.front.z);
        me.update({ stop: press(gap), steer: 0, rightSignal: true }, DT, { gap, speedMs: lead.speedMs });
        lead.update(DT, world({ vehicleLight: 'red' }));
        minGap = Math.min(minGap, lead.gapFrom(me.front.x, me.front.z));
        if (minGap <= 0) break;
      }
      return { minGap, myZ: me.front.z };
    };
    expect(run(() => false).minGap, '아무것도 누르지 않으면 들이받는다').toBeLessThanOrEqual(0);
    const kept = run((gap) => gap < 4.5);
    expect(kept.minGap, '보고 서면 추돌하지 않는다').toBeGreaterThan(0.5);
    expect(kept.myZ, '앞차 뒤라 정지선에도 닿지 못한다').toBeGreaterThan(STOP_LINE);
  });

  it('옆 차로로 비켜서면 더 이상 그 차 뒤가 아니다', () => {
    const lead = makeStraight();
    for (let t = 0; t < 12; t += DT) lead.update(DT, world({ vehicleLight: 'red' }));
    const behind = lead.gapFrom(6.825, STOP_LINE + 8);
    const beside = lead.gapFrom(6.825 - LANE_WIDTH, STOP_LINE + 8);
    expect(behind).toBeLessThan(10);
    expect(beside).toBe(Infinity);
  });

  /*
    ── 교착 ──────────────────────────────────────────────────────────────────

    **셋이 서로를 기다린 판이 실제로 나왔다.** 보행자는 내가 가까이 와야 발을 떼는데
    (PedSpawn.startWithin), 앞차가 그 사람에게 양보하느라 서면 나는 앞차에 막혀 다가가지
    못하고, 다가가지 못하니 사람은 영영 나서지 않고, 사람이 나서지 않으니 앞차도 가지 않는다.
    화면에서는 아무도 움직이지 않는데 검증기는 통과시켰다 — 내가 기다리는 시간은 제한시간
    안이었기 때문이다.
  */
  const waitingPed: PedestrianSample = {
    crosswalk: 'C',
    intendsToCross: true,
    onConflictPath: true,
    state: 'waiting',
  };
  const crossingPed: PedestrianSample = { ...waitingPed, state: 'crossing' };

  /** 앞차가 횡단보도 C 를 완전히 벗어나기까지 걸린 시간 (초). 못 벗어나면 Infinity */
  const secondsToClearC = (peds: PedestrianSample[]): number => {
    const lead = make('lawful');
    for (let t = 0; t < 40; t += DT) {
      lead.update(DT, world({ vehicleLight: 'green', pedestrians: peds }));
      if (lead.pose().rear.x > CROSSWALK_OUTER) return t;
    }
    return Infinity;
  };

  it('건너려고 서 있기만 하는 사람 앞에서는 한없이 기다리지 않는다 — 교착이 풀린다', () => {
    const t = secondsToClearC([waitingPed]);
    expect(t, '몇 초 기다려 보고 지나간다').toBeLessThan(25);
  });

  it('차도에 발을 디딘 사람에게는 통행이 끝날 때까지 기다린다 — 한도가 걸리지 않는다', () => {
    expect(secondsToClearC([crossingPed])).toBe(Infinity);
  });

  it('기다리다 사람이 실제로 건너기 시작하면 다시 붙잡힌다', () => {
    const lead = make('lawful');
    // 3초는 서 있기만 하다가 그 뒤로는 실제로 건넌다
    for (let t = 0; t < 40; t += DT) {
      lead.update(DT, world({ vehicleLight: 'green', pedestrians: [t < 3 ? waitingPed : crossingPed] }));
    }
    expect(lead.pose().front.x, '횡단보도를 넘지 않았다').toBeLessThan(CROSSWALK_INNER);
  });

  it('차간 시간으로 출발시킨다 — 서행 구간에서도 반응할 거리가 남는다', () => {
    const lead = make('lawful', 2);
    const gapAtStart = lead.gapFrom(6.825, SPAWN_Z - CAR_HALF_LENGTH);
    // 출발 속도 40km/h(11.1m/s) × 2초 ≒ 22m
    expect(gapAtStart).toBeGreaterThan(18);
    expect(gapAtStart).toBeLessThan(26);
  });
});

describe('앞차가 있는 판 — 검증기', () => {
  const withLead = (base: number, behavior: 'lawful' | 'rolling'): ScenarioSpec => ({
    ...structuredClone(getScenario(base)),
    leadCar: { behavior, headway: 2 },
  });

  it('손으로 쓴 앞차 판은 규정대로 몰면 통과할 수 있다', () => {
    for (const s of SCENARIOS.filter((x) => x.leadCar)) {
      const r = validateScenario(s);
      expect(r.ok, `${s.id}: ${r.issues.map((i) => i.message).join(' / ')}`).toBe(true);
    }
  });

  it('09번 — 앞차를 따라 막 몰면 적색 일시정지 위반이 잡힌다 (추돌이 아니라)', () => {
    const r = validateScenario(getScenario(9));
    expect(r.probes?.reckless.failReason).toBeFalsy();
    expect(r.probes?.reckless.violations.map((v) => v.code)).toContain('RED_NO_STOP');
  });

  it('간격을 지키지 않으면 서는 앞차를 들이받는다', () => {
    const spec = withLead(2, 'lawful');
    const r = validateScenario(spec);
    expect(r.ok).toBe(true);
    // 검증기 밖에서 같은 세계를 '간격 무시' 로 한 번 더 몬다
    const hit = simulate(
      {
        vehicleLight: 'red',
        lead: (() => {
          const lead = new LeadDrive(spec.leadCar!, {
            playerSpawnZ: SPAWN_Z,
            playerHalfLength: CAR_HALF_LENGTH,
            halfLength: LEAD_HALF_LENGTH_MAX,
            isSchoolZone: false,
            hasApproachZone: false,
          });
          return (_t, car) => {
            lead.update(DT, world());
            return { gap: lead.gapFrom(car.frontX, car.frontZ), speedKmh: lead.speedKmh };
          };
        })(),
      },
      { keepsDistance: false },
    );
    expect(hit.failReason).toBe('VEHICLE_COLLISION');
  });

  it('직진 앞차에 "일시정지 건너뜀" 을 붙이면 버린다 — 건너뛸 의무가 없다', () => {
    const bad = { ...withLead(2, 'rolling'), leadCar: { behavior: 'rolling', path: 'straight' } };
    const r = validateScenario(bad);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('직진'))).toBe(true);
  });

  it('11번 — 직진 대기 앞차 뒤에서 규정대로 몰면 통과할 수 있고, 막 몰면 걸린다', () => {
    const r = validateScenario(getScenario(11));
    expect(r.ok, r.issues.map((i) => i.message).join(' / ')).toBe(true);
    expect(
      (r.probes?.reckless.violations.length ?? 0) > 0 || r.probes?.reckless.failReason,
      '앞차를 피해 막 돌아 나가면 무언가는 잡힌다',
    ).toBeTruthy();
  });

  it('앞차 스키마 — 모르는 성향과 범위 밖 간격은 버린다', () => {
    const bad1 = { ...withLead(2, 'lawful'), leadCar: { behavior: 'crazy' } };
    const bad2 = { ...withLead(2, 'lawful'), leadCar: { behavior: 'lawful', headway: 0.3 } };
    expect(validateScenario(bad1).ok).toBe(false);
    expect(validateScenario(bad2).ok).toBe(false);
  });

  it('녹색 · 적색 · 보호구역 판 어디에 앞차를 얹어도 통과 가능하다', () => {
    for (const id of [1, 2, 3, 4, 7]) {
      for (const b of ['lawful', 'rolling'] as const) {
        const r = validateScenario(withLead(id, b));
        expect(r.ok, `${id}/${b}: ${r.issues.map((i) => i.message).join(' / ')}`).toBe(true);
      }
    }
  });
});

/**
 * **앞차가 나오는 비율은 우리가 정한다** (scenarios.ts 의 `rollLeadTurn`).
 *
 * 처음에는 모델에게 맡겼다 — 프롬프트에 앞차를 설명하자 거의 모든 판에 앞차가 나왔고
 * 그중 대부분이 우회전이었다. 비율은 **여러 판에 걸쳐** 나타나는 성질이라, 판 하나를
 * 보고 만드는 모델이 맞출 수 있는 것이 아니다. 보호구역에서 겪은 것과 같은 일이다.
 */
describe('앞차 비율', () => {
  const roll = (n: number): Record<string, number> => {
    const count: Record<string, number> = { none: 0, straight: 0, rolling: 0, lawful: 0 };
    for (let i = 0; i < n; i++) count[rollLeadTurn() ?? 'none'] += 1;
    return count;
  };

  it('세 판에 한 판쯤만 앞차가 나온다', () => {
    const c = roll(4000);
    const rate = (4000 - c.none) / 4000;
    expect(rate).toBeGreaterThan(LEAD_CAR_CHANCE - 0.05);
    expect(rate).toBeLessThan(LEAD_CAR_CHANCE + 0.05);
  });

  it('앞차가 나오면 직진 대기가 가장 흔하다 — 우회전만 나오면 안 된다', () => {
    const c = roll(4000);
    const leads = c.straight + c.rolling + c.lawful;
    expect(c.straight / leads, '직진 대기').toBeGreaterThan(0.35);
    expect(c.rolling / leads, '일시정지 건너뜀').toBeGreaterThan(0.25);
    expect(c.lawful / leads, '규정대로 우회전').toBeGreaterThan(0.1);
    // 우회전(건너뜀 + 규정대로)이 전부를 차지하지 않는다
    expect((c.rolling + c.lawful) / leads).toBeLessThan(0.7);
  });

  it('굴린 종류와 시나리오에 적히는 값이 서로를 되짚는다', () => {
    for (const kind of ['straight', 'rolling', 'lawful'] as LeadPlan[]) {
      const spec = { ...getScenario(1), leadCar: leadSpecFor(kind) };
      expect(leadPlanOf(spec), kind).toBe(kind);
    }
    expect(leadPlanOf(getScenario(1)), '앞차가 없는 판').toBeNull();
  });
});

/**
 * **직진 대기 앞차가 너무 오래 서 있지 않는가** (scenarios.ts 의 `fitStraightLeadWait`).
 *
 * 적색 구간이 한 주기에 최대 30초라, 앞차가 적색 초입에 닿으면 20초 넘게 서 있었다 —
 * 그 뒤의 나도 그만큼 선다. 신호 주기는 그대로 두고 **출발 자리만** 옮겨 줄인다.
 * 여기서는 그렇게 옮긴 판에서 앞차가 **실제로** 몇 초 서 있는지를 같은 상태기계로 잰다.
 */
describe('직진 대기 앞차의 기다림', () => {
  /** 앞차가 정지선에서 녹색을 기다리며 서 있던 시간 (초) */
  const waitAtLine = (spec: ScenarioSpec): number => {
    const lead = new LeadDrive(spec.leadCar!, {
      playerSpawnZ: spawnZ(spec),
      playerHalfLength: CAR_HALF_LENGTH,
      halfLength: LEAD_HALF_LENGTH_MAX,
      isSchoolZone: spec.isSchoolZone,
      hasApproachZone: spec.approachSchoolZone !== undefined,
    });
    let stopped = 0;
    for (let t = 0; t < 90; t += DT) {
      const phase = phaseAt(STANDARD_PROGRAM, spec.startPhase, spec.startPhaseElapsed, t);
      lead.update(DT, world({ vehicleLight: phase.vehicle, approachZone: spec.approachSchoolZone ? { light: 'green' } : null }));
      if (lead.speedKmh < 0.2 && lead.pose().front.z < STOP_LINE + 3) stopped += DT;
      if (lead.pose().front.z < STOP_LINE - 5) break;
    }
    return stopped;
  };

  const straight = (startPhase: number, startPhaseElapsed: number, zone = false): ScenarioSpec => ({
    ...structuredClone(getScenario(2)),
    startPhase,
    startPhaseElapsed,
    leadCar: { behavior: 'lawful', path: 'straight', headway: 2 },
    ...(zone ? { approachSchoolZone: { signal: true, signalElapsed: 0 } } : {}),
  });

  it('주기의 어느 자리에서 출발하든 앞차는 오래 서 있지 않다', () => {
    // 적색 구간의 모든 자리를 1초 간격으로 훑는다 — 보호구역 판(앞차가 늦게 닿는다)까지
    for (const zone of [false, true]) {
      for (const [phase, len] of [[3, 3], [4, 2], [5, 20], [6, 3], [7, 2]] as const) {
        for (let e = 0; e < len; e += 1) {
          const fitted = fitStraightLeadWait(straight(phase, e, zone));
          const w = waitAtLine(fitted);
          expect(w, `${zone ? '보호구역 · ' : ''}${phase}구간 ${e}초`).toBeLessThan(STRAIGHT_LEAD_WAIT + 1.5);
        }
      }
    }
  });

  it('맞춘 뒤에도 출발은 여전히 정면 적색이다 — 판의 제목이 "정면신호 적색" 이다', () => {
    for (let e = 0; e < 20; e += 2) {
      const fitted = fitStraightLeadWait(straight(5, e));
      expect(STANDARD_PROGRAM[fitted.startPhase].vehicle, `5구간 ${e}초`).not.toBe('green');
    }
  });

  it('직진 앞차가 없는 판은 건드리지 않는다', () => {
    for (const s of SCENARIOS.filter((x) => x.leadCar?.path !== 'straight')) {
      expect(fitStraightLeadWait(s)).toBe(s);
    }
  });

  it('맞춘 11번도 규정대로 몰면 통과할 수 있다', () => {
    const r = validateScenario(fitStraightLeadWait(getScenario(11)));
    expect(r.ok, r.issues.map((i) => i.message).join(' / ')).toBe(true);
  });
});

/**
 * **앞차 뒤에서 선 것은 정지선 일시정지가 아니다.**
 *
 * 적색 우회전의 일시정지는 "정지선 직전" 에서 한다. 앞차 뒤에 줄 서서 한 번 서고, 앞차가
 * 떠난 뒤 정지선을 그냥 지나갔는데 "통과" 가 나왔다 — 판정이 정지선 앞 12m 안에서 서기만
 * 하면 인정했기 때문이다. 앞차가 떠난 뒤 정지선에서 **한 번 더** 서야 한다.
 */
describe('앞차 뒤에서 선 것', () => {
  const spec: ScenarioSpec = {
    ...structuredClone(getScenario(2)),
    leadCar: { behavior: 'lawful', headway: 2 },
  };
  /** 정면 적색 · 규정대로 서는 앞차 — 검증기와 같은 세계를 몬다 */
  const drive = (stopAtLine: number) => {
    const lead = new LeadDrive(spec.leadCar!, {
      playerSpawnZ: SPAWN_Z,
      playerHalfLength: CAR_HALF_LENGTH,
      halfLength: LEAD_HALF_LENGTH_MAX,
      isSchoolZone: false,
      hasApproachZone: false,
    });
    return simulate(
      {
        vehicleLight: 'red',
        lead: (_t, car) => {
          lead.update(DT, world());
          return {
            gap: lead.gapFrom(car.frontX, car.frontZ),
            speedKmh: lead.speedKmh,
            queued: lead.queuesAhead(car.frontX, car.frontZ),
          };
        },
      },
      { stopAtLine, turnKmh: 12 },
    );
  };

  it('앞차 뒤에서만 서고 정지선에서 다시 서지 않으면 적색 일시정지 위반이다', () => {
    const r = drive(0);
    expect(r.violations.map((v) => v.code)).toContain('RED_NO_STOP');
    expect(r.log.some((e) => e.text.includes('앞차 뒤에서 정지'))).toBe(true);
  });

  it('앞차가 떠난 뒤 정지선에서 다시 서면 위반이 아니다', () => {
    const r = drive(2);
    expect(r.violations.map((v) => v.code)).not.toContain('RED_NO_STOP');
  });

  it('앞차가 있는 적색 판도 규정대로 몰면 통과할 수 있다', () => {
    const r = validateScenario(spec);
    expect(r.ok, r.issues.map((i) => i.message).join(' / ')).toBe(true);
  });
});
