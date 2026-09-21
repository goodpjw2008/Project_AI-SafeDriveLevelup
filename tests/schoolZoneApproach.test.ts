/**
 * **진입부 어린이보호구역** — 교차로에 닿기 전, 오는 길에 지나는 구간.
 *
 * 제목이 `우회전과 어린이보호구역 레벨업` 이 된 만큼 보호구역이 교차로 안에만 있어서는
 * 안 됐다. 여기서 지키려는 것은 셋이다.
 *
 *  - **신호기가 없으면 보행자 유무와 무관하게 일시정지** (제27조 제7항).
 *    이 게임이 교정하려는 세 오해 중 하나가 정확히 이 자리다
 *  - **신호기가 있으면 적색에 선다.** 교차로 적색과 달리 여기서는 *서고 나서 가는 것*이
 *    아니라 **서서 기다리는 것**이라, 위반 코드를 갈라 두었다 (SCHOOL_ZONE_RED)
 *  - **30km/h 이하** (제12조 제1항)
 */

import { describe, expect, it } from 'vitest';
import { simulate, type WorldConfig } from '../src/scenarios/driveSim';
import { SCHOOL_ZONE_PROGRAM, phaseAt, spawnZ } from '../src/scenarios/scenarios';
import {
  APPROACH_ZONE_FAR_Z,
  CROSSWALK_S_OUTER,
  SPAWN_Z,
  SPAWN_Z_SCHOOL_ZONE,
  STOP_LINE,
  STOP_LINE_S,
} from '../src/layout';
import { ROAD_Z_MAX_APPROACH } from '../src/game/Intersection';
import { Vehicle, SCHOOL_ZONE_KMH, ROAD_KMH, CRUISE_KMH } from '../src/game/Vehicle';
import type { LightColor } from '../src/rules/lawRules';

/** 보호구역은 있는데 신호기가 없는 길 — 이 게임에서 가장 중요한 상황 */
const noSignal = (): WorldConfig => ({
  vehicleLight: 'green',
  approachZone: () => null,
  isSchoolZone: false,
});

/** 신호기가 있는 길. `light` 로 그 순간의 등화를 고정한다 */
const withSignal = (light: LightColor): WorldConfig => ({
  vehicleLight: 'green',
  approachZone: () => light,
  isSchoolZone: false,
});

/** 보호구역 판의 출발 자리에서 굴린다 */
const drive = (world: WorldConfig, driver = {}) =>
  simulate(world, { startZ: SPAWN_Z_SCHOOL_ZONE, turnSignal: 'always', ...driver });

const codes = (r: ReturnType<typeof simulate>): string[] => r.violations.map((v) => v.code);

describe('출발 자리', () => {
  it('보호구역이 있으면 뒤로 물린다 — 보고 판단할 틈을 준다', () => {
    expect(spawnZ({ approachSchoolZone: undefined })).toBe(SPAWN_Z);
    expect(spawnZ({ approachSchoolZone: { signal: false } })).toBe(SPAWN_Z_SCHOOL_ZONE);
  });

  /*
    **출발 지점이 노면 텍스처 밖이면 안 된다.** 밖에서 출발하면 발밑이 밋밋한 회색
    바닥이고 저만치 앞에서야 차선이 그려진 노면이 시작된다 — 출발하자마자 도로가 두
    색으로 갈려 보인다 (game/Intersection.ts 의 TEX_HALF 주석).

    처음에 이 값을 92 로 두었을 때 실제로 그랬다. 텍스처가 ±76m 였다.
  */
  it('출발 지점이 노면 텍스처 안에 있다', () => {
    expect(SPAWN_Z_SCHOOL_ZONE).toBeLessThan(ROAD_Z_MAX_APPROACH);
  });

  /*
    **차가 그 자리에서 출발하는가.**

    `spawnZ` 를 만들어 놓고 `Vehicle` 에 넘기는 것을 잊은 적이 있다. 차는 필드
    기본값(68m)에서 출발했고 — 그 자리는 보호구역 **안**이며 횡단보도까지 16m 라 —
    출발하자마자 서야 하는 판이 됐다. 검증기는 164m 에서 시뮬레이션하고 있었으므로
    **검증과 화면이 서로 다른 판을 보고 있었다.**

    지금은 생성자가 받으므로 갈릴 수 없지만, 기본값이 다시 새어 들어오지 않게 못 박는다.
  */
  it('차가 판이 정한 자리에서 출발한다', () => {
    const plain = new Vehicle(4.7, false, false, spawnZ({ approachSchoolZone: undefined }));
    expect(plain.z).toBe(SPAWN_Z);

    const zone = new Vehicle(4.7, false, true, spawnZ({ approachSchoolZone: { signal: false } }));
    expect(zone.z).toBe(SPAWN_Z_SCHOOL_ZONE);
  });

  it('출발 자리는 보호구역 **밖**이다 — 들어서는 것이 사건이어야 한다', () => {
    expect(SPAWN_Z_SCHOOL_ZONE).toBeGreaterThan(APPROACH_ZONE_FAR_Z);
  });
});

/**
 * **설 시간이 있는가.**
 *
 * 처음 만들었을 때 붉은 노면이 보이고 정지선까지 **3.1초**밖에 없었다. 보호구역을
 * 알아보고, 신호기가 있는지 보고, 설지 판단하는 데 3초는 모자란다 — 실제로 "일시정지가
 * 너무 빨리 나와서 하기가 어렵다" 는 말을 들었다.
 *
 * 견줄 기준은 **교차로 정지선**이다. 그쪽은 7.7초를 준다. 처음 만나는 정지가 그보다
 * 훨씬 급하면 배우기 전에 놓친다.
 */
describe('판단할 시간', () => {
  /** 스폰에서 목표 z 까지 굴리며 걸린 시간과, 보호구역에 들어선 시각을 잰다 */
  const runTo = (spawn: number, approach: boolean, target: number) => {
    const v = new Vehicle(4.7, false, approach, spawn);
    let t = 0;
    let enteredAt = -1;
    while (v.z > target && t < 60) {
      v.update({ stop: false, steer: 0, rightSignal: true }, 1 / 60);
      t += 1 / 60;
      if (enteredAt < 0 && approach && v.z <= APPROACH_ZONE_FAR_Z) enteredAt = t;
    }
    return { total: t, sinceZone: t - Math.max(0, enteredAt) };
  };

  it('붉은 노면을 보고 나서 정지선까지 5초 이상 남는다', () => {
    const r = runTo(SPAWN_Z_SCHOOL_ZONE, true, STOP_LINE_S);
    expect(r.sinceZone).toBeGreaterThan(5);
  });

  /*
    **판은 세 토막으로 읽혀야 한다** — 일반도로 → 보호구역 진입 → 횡단보도.

    처음에는 일반도로가 1.6초뿐이라 **출발하자마자 이미 보호구역 안**인 것처럼
    읽혔다. 차를 잡고 도로에 익숙해질 틈이 있어야 구간에 '들어서는' 것이 사건이 된다.
  */
  it('보호구역에 들어서기 전에 평범한 도로를 먼저 달린다', () => {
    const v = new Vehicle(4.7, false, true, SPAWN_Z_SCHOOL_ZONE);
    let t = 0;
    while (v.z > APPROACH_ZONE_FAR_Z && t < 30) {
      v.update({ stop: false, steer: 0, rightSignal: true }, 1 / 60);
      t += 1 / 60;
    }
    /*
      **너무 짧아도 너무 길어도 안 된다.**

      1.6초일 때는 출발하자마자 보호구역이라 구간이 갈리지 않았고, 19초일 때는 교차로가
      지평선의 점이 되어 "너무 멀다" 가 됐다. 아래위 모두 실제로 겪고 되돌아온 값이라
      한쪽만 막아 두면 다음에 또 넘어간다.

      울타리를 넉넉히 잡는다 — 여기서 재는 것은 "어느 쪽 벽에 부딪혔는가" 지
      지금 값이 몇 초인가가 아니다. 값을 손볼 때마다 이 숫자까지 고치게 두면
      울타리가 값을 따라다니느라 아무것도 막지 못한다.
    */
    expect(t, '일반도로가 너무 짧다 — 구간이 갈리지 않는다').toBeGreaterThan(3.5);
    expect(t, '일반도로가 너무 길다 — 교차로가 지평선의 점이 된다').toBeLessThan(12);
  });

  it('교차로 정지선이 주는 시간과 견줄 만하다', () => {
    const zone = runTo(SPAWN_Z_SCHOOL_ZONE, true, STOP_LINE_S);
    const crossing = runTo(SPAWN_Z, false, STOP_LINE);
    // 절반보다는 확실히 길어야 한다 — 처음에 3.1초 대 7.7초였다
    expect(zone.sinceZone).toBeGreaterThan(crossing.total * 0.7);
  });

  it('정지선에 닿을 때는 설 수 있는 속도다', () => {
    const v = new Vehicle(4.7, false, true, SPAWN_Z_SCHOOL_ZONE);
    while (v.z > STOP_LINE_S) v.update({ stop: false, steer: 0, rightSignal: true }, 1 / 60);
    expect(v.speedKmh).toBeLessThan(20);
  });
});

/**
 * **50 으로 달려오다 30 으로 줄어든다.**
 *
 * 보호구역을 40km/h(일반 순항)로 달려와 30 이 되면 계기판이 거의 움직이지 않는다 —
 * "여기서부터 다른 길" 이 몸에 남지 않는다. 구역 밖을 50(안전속도 5030 의 도시부
 * 일반도로 제한속도)으로 달리면 들어서며 눈에 보이게 줄어든다.
 *
 * **줄어드는 자리가 요점이다.** 구역에 들어서고 나서 밟으면 늦다 — 지켜야 하는 것은
 * 시작선을 넘을 때 이미 30 인 것이다.
 */
describe('일반도로 50 → 보호구역 30', () => {
  /** 스폰에서 굴리며 z 마다 속도를 재 둔다 */
  const run = () => {
    const v = new Vehicle(4.7, false, true, SPAWN_Z_SCHOOL_ZONE);
    const at: { z: number; kmh: number }[] = [];
    for (let i = 0; i < 6000 && v.z > STOP_LINE_S; i++) {
      at.push({ z: v.z, kmh: v.speedKmh });
      v.update({ stop: false, steer: 0, rightSignal: true }, 1 / 60);
    }
    return at;
  };

  it('출발부터 50km/h 다 — 세워 두고 밟게 하지 않는다', () => {
    const v = new Vehicle(4.7, false, true, SPAWN_Z_SCHOOL_ZONE);
    expect(v.speedKmh).toBeCloseTo(ROAD_KMH, 5);
  });

  it('보호구역 시작선에서 이미 30km/h 다 — 들어서고 나서 줄이지 않는다', () => {
    const at = run();
    // 시작선을 막 넘은 첫 프레임
    const entry = at.find((p) => p.z <= APPROACH_ZONE_FAR_Z);
    expect(entry, '시작선까지 굴러가지 못했다').toBeDefined();
    expect(entry!.kmh).toBeLessThanOrEqual(SCHOOL_ZONE_KMH + 0.5);
  });

  /*
    **50 을 잠깐 스치고 마는 것이 아니다.** 줄이기 시작하는 자리를 감속도에서 역산하므로
    (Vehicle.ts 의 `cruiseKmh`) 감속도나 구역 위치를 손보면 이 구간이 먼저 먹힌다.
    2초는 계기판을 보고 "50 이구나" 하기에 모자라지 않은 최소치다.
  */
  it('50km/h 로 달리는 구간이 2초는 된다', () => {
    const held = run().filter((p) => p.kmh > ROAD_KMH - 0.5).length / 60;
    expect(held).toBeGreaterThan(2);
  });

  it('줄어드는 것이 보인다 — 20km/h 가까이 떨어진다', () => {
    const at = run();
    const top = Math.max(...at.map((p) => p.kmh));
    const entry = at.find((p) => p.z <= APPROACH_ZONE_FAR_Z)!;
    // 설계상 50 → 30 이라 20 이지만, 시작선을 **넘은 뒤** 첫 프레임에서 재므로
    // 한 프레임(1/60초) 어치가 빠진다. 그 오차만큼만 늦춘다
    expect(top - entry.kmh).toBeGreaterThan(18);
  });

  it('보호구역이 없는 판은 그대로 40km/h 다 — 이 속도는 이 판의 것이다', () => {
    const v = new Vehicle(4.7, false, false, SPAWN_Z);
    expect(v.speedKmh).toBeCloseTo(CRUISE_KMH, 5);
  });

  it('보호구역 교차로 판은 처음부터 30km/h 다', () => {
    const v = new Vehicle(4.7, true, false, SPAWN_Z);
    expect(v.speedKmh).toBeCloseTo(SCHOOL_ZONE_KMH, 5);
  });
});

describe('신호기 없는 횡단보도 — 제27조 제7항', () => {
  /*
    **이 한 줄이 이 기능의 이유다.** 보행자가 하나도 없는데도 서야 한다.
    "아이가 안 보이면 그냥 간다" 가 이 게임이 교정하려는 오해다.
  */
  it('보행자가 없어도 안 서면 걸린다', () => {
    expect(codes(drive(noSignal(), { stopAtSchoolZoneLine: 0 }))).toContain(
      'SCHOOL_ZONE_NO_STOP',
    );
  });

  it('서면 통과한다', () => {
    expect(codes(drive(noSignal(), { stopAtSchoolZoneLine: 2, stopAtLine: 2 }))).not.toContain(
      'SCHOOL_ZONE_NO_STOP',
    );
  });

  it('구간이 아예 없으면 서지 않아도 걸리지 않는다', () => {
    const r = simulate(
      { vehicleLight: 'green', isSchoolZone: false },
      { startZ: SPAWN_Z, turnSignal: 'always', stopAtLine: 2 },
    );
    expect(codes(r)).not.toContain('SCHOOL_ZONE_NO_STOP');
  });
});

describe('신호기 있는 횡단보도', () => {
  it('녹색이면 서지 않아도 된다', () => {
    const r = drive(withSignal('green'), { stopAtSchoolZoneLine: 0, stopAtLine: 2 });
    expect(codes(r)).not.toContain('SCHOOL_ZONE_RED');
    expect(codes(r), '신호가 있으면 제27조 제7항은 걸리지 않는다').not.toContain(
      'SCHOOL_ZONE_NO_STOP',
    );
  });

  it('적색에 그냥 가면 걸린다', () => {
    expect(codes(drive(withSignal('red'), { stopAtSchoolZoneLine: 0 }))).toContain(
      'SCHOOL_ZONE_RED',
    );
  });

  it('황색도 잡는다 — 뒤에 빠져나갈 교차로가 없다', () => {
    expect(codes(drive(withSignal('yellow'), { stopAtSchoolZoneLine: 0 }))).toContain(
      'SCHOOL_ZONE_RED',
    );
  });

  /*
    **서서 기다린 차는 걸지 않는다.** 적색에 선 뒤 녹색을 기다리는 중인 차를 위반으로
    보면, 규정을 지킨 사람만 걸린다.
  */
  it('섰다면 적색이어도 걸리지 않는다', () => {
    expect(codes(drive(withSignal('red'), { stopAtSchoolZoneLine: 3 }))).not.toContain(
      'SCHOOL_ZONE_RED',
    );
  });

  it('교차로 적색(RED_NO_STOP)과 다른 코드다 — 해야 할 일이 다르다', () => {
    const r = drive(withSignal('red'), { stopAtSchoolZoneLine: 0 });
    expect(codes(r)).toContain('SCHOOL_ZONE_RED');
    expect(codes(r), '정면이 녹색이므로 교차로 쪽은 안 걸린다').not.toContain('RED_NO_STOP');
  });
});

describe('신호 주기', () => {
  it('한 바퀴 안에 차량 녹색과 적색이 모두 있다 — 어느 쪽으로도 시작할 수 있다', () => {
    const lights = new Set(SCHOOL_ZONE_PROGRAM.map((p) => p.vehicle));
    expect(lights.has('green')).toBe(true);
    expect(lights.has('red')).toBe(true);
  });

  it('차량 적색과 보행 녹색이 겹친다 — 한 횡단보도뿐이라 갈릴 일이 없다', () => {
    for (const p of SCHOOL_ZONE_PROGRAM) {
      if (p.ped === 'green') expect(p.vehicle, p.name).toBe('red');
      if (p.vehicle === 'green') expect(p.ped, p.name).toBe('red');
    }
  });

  /*
    **두 등화가 같은 순간에 바뀐다.** 한 횡단보도뿐이라 차량등과 보행등이 한눈에 함께
    들어오는 자리다 — 보행등이 붉어지고 나서 차량등이 뒤늦게 녹색이 되면 "끝났는데 왜
    못 가지" 가 된다. 예전에 전적색 2초가 그 자리에 있었다.
  */
  it('양쪽이 함께 적색인 페이즈가 없다', () => {
    for (const p of SCHOOL_ZONE_PROGRAM) {
      expect(p.vehicle === 'red' && p.ped === 'red', p.name).toBe(false);
    }
  });

  it('보행등이 붉어지는 그 순간 차량등이 녹색이 된다', () => {
    const n = SCHOOL_ZONE_PROGRAM.length;
    for (let i = 0; i < n; i++) {
      const prev = SCHOOL_ZONE_PROGRAM[(i + n - 1) % n];
      const cur = SCHOOL_ZONE_PROGRAM[i];
      if (cur.ped === 'red' && prev.ped !== 'red') expect(cur.vehicle, cur.name).toBe('green');
    }
  });

  it('보행자에게 주는 경고(점멸) 시간이 줄지 않았다 — 전적색을 여기로 옮겼다', () => {
    const flash = SCHOOL_ZONE_PROGRAM.find((p) => p.ped === 'greenFlash')!;
    expect(flash.duration).toBeGreaterThanOrEqual(6);
  });

  it('적색을 기다리는 시간이 모범 운전의 대기(25초) 안에 들어온다', () => {
    const red = SCHOOL_ZONE_PROGRAM.filter((p) => p.vehicle !== 'green').reduce(
      (n, p) => n + p.duration,
      0,
    );
    expect(red).toBeLessThan(25);
  });

  it('주기가 시각을 따라 돈다', () => {
    const first = phaseAt(SCHOOL_ZONE_PROGRAM, 0, 0, 0);
    expect(first.vehicle).toBe('green');
    // 차량 녹색 18초가 지나면 황색
    expect(phaseAt(SCHOOL_ZONE_PROGRAM, 0, 0, 19).vehicle).toBe('yellow');
  });
});

describe('속도 — 제12조 제1항', () => {
  /**
   * 스폰에서 굴리며 z 구간 [`from`, `to`] 안의 최고 속도를 돌려준다.
   *
   * **구간에 들어선 그 순간을 재지 않는다.** 차는 서서히 줄이므로 경계를 막 넘은
   * 몇 프레임은 아직 이전 속도다 — 거기를 재면 감속기의 지연을 위반으로 읽게 된다.
   */
  const topSpeedBetween = (approachZone: boolean, from: number, to: number): number => {
    const v = new Vehicle(4.7, false, approachZone, SPAWN_Z_SCHOOL_ZONE);
    let top = 0;
    for (let i = 0; i < 6000 && v.z > from; i++) {
      v.update({ stop: false, steer: 0, rightSignal: true }, 1 / 60);
      if (v.z <= to && v.z >= from) top = Math.max(top, v.speedKmh);
    }
    return top;
  };

  /*
    구간에 들어서고 **12m 를 지난 뒤부터** 잰다.

    차는 서서히 줄인다 — 표지판을 보고 브레이크를 밟는 것과 같다. 실측하면
    40km/h 로 들어와 10m 안에 30 아래로 내려오고, 정지선 앞에서는 16km/h 까지 떨어진다.
    경계를 막 넘은 자리를 재면 감속기의 지연을 위반으로 읽게 된다.
  */
  const SETTLED = APPROACH_ZONE_FAR_Z - 12;

  it('구간에 들어서면 30km/h 아래로 내려온다', () => {
    expect(topSpeedBetween(true, CROSSWALK_S_OUTER, SETTLED)).toBeLessThanOrEqual(
      SCHOOL_ZONE_KMH + 0.5,
    );
  });

  it('구간이 없으면 조이지 않는다', () => {
    expect(topSpeedBetween(false, CROSSWALK_S_OUTER, SETTLED)).toBeGreaterThan(SCHOOL_ZONE_KMH);
  });

  /* 구간을 벗어나면 다시 원래 속도로 — 보호구역은 그 구간에서만이다 */
  it('구간에 들어서면 줄이고, 들어서기 전에는 그대로다', () => {
    const before = topSpeedBetween(true, APPROACH_ZONE_FAR_Z, SPAWN_Z_SCHOOL_ZONE);
    expect(before, '구간 밖에서는 조이지 않는다').toBeGreaterThan(SCHOOL_ZONE_KMH);
  });

  it('횡단보도에 닿을 때는 훨씬 더 줄어 있다 — 서야 하는 자리다', () => {
    const v = new Vehicle(4.7, false, true, SPAWN_Z_SCHOOL_ZONE);
    for (let i = 0; i < 6000 && v.z > CROSSWALK_S_OUTER; i++) {
      v.update({ stop: false, steer: 0, rightSignal: true }, 1 / 60);
    }
    expect(v.speedKmh).toBeLessThan(20);
  });
});
