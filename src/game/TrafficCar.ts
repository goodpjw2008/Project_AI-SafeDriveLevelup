/**
 * NPC 차량.
 *
 * 세 가지 역할이 있다.
 *  1) 교차 방향(동서) 통행 차량 — 적색에 우회전할 때 "정지 후 다른 차마의 통행을 방해하지 않고"
 *     라는 요건이 왜 있는지 몸으로 느끼게 한다.
 *  2) 뒷차 — 정지선에 서 있으면 경적을 울린다. 실제로 사람들이 법을 안 지키게 되는
 *     가장 큰 이유가 뒤차 눈치이므로, 그 압박을 재현하되 규칙은 규칙대로 채점한다.
 *  3) 정체 차량 — 꼬리물기 시나리오에서 진출로를 막는다.
 *  4) 앞차 — 내 앞에서 같은 길로 우회전한다. **움직임은 이 파일이 정하지 않는다** —
 *     게임과 검증기가 함께 쓰는 상태기계(leadDrive.ts)가 정하고, 여기는 그 자세를 받아 그린다.
 */

import * as THREE from 'three';
import { buildCar, type CarModel } from './CarMesh';
import type { CarSpec } from '../economy/cars';
import { loadCarModel } from './carModel';
import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  INTERSECTION_HALF,
  LANE_1_OFFSET,
  LANE_2_OFFSET,
  LANE_WIDTH,
  SPAWN_SPEED_KMH,
  CROSSWALK_S_OUTER,
  SPAWN_Z,
} from '../layout';


export type NpcRole = 'crossTraffic' | 'follower' | 'jam' | 'leader';

/*
  ── 뒷차 따라가기 ───────────────────────────────────────────────────────────

  예전에는 **켜고 끄기**였다 — 차간이 8.5m 를 넘으면 40km/h 로 달리고, 그 안에 들어오면
  목표 속도를 0 으로 떨어뜨렸다. 그래서 뒷차는 정지선에 선 내 차 뒤로 전속력으로 달려와
  급정거하고, 마지막에는 좌표를 6m 로 눌러 붙이니 **툭 하고 붙는 것처럼** 보였다.

  실제 운전자는 앞차와의 **거리와 속도차**를 함께 보고 미리 발을 뗀다. 그대로 옮긴다.

    원하는 차간 = 최소 간격 + 차간시간 x 지금 속도
    목표 속도   = 앞차 속도 + (실제 차간 - 원하는 차간) x 이득

  차간이 벌어지면 조금 빠르게, 좁혀지면 앞차보다 느리게 — 자연히 붙었다 떨어졌다 한다.
  여기에 **가감속 한계**를 걸어 사람이 밟는 정도로만 변하게 한다.
*/

/** 완전히 멈춰 섰을 때의 차간 (m, 차 중심 사이). 차 길이가 4.6m 이므로 앞뒤로 2m 쯤 뜬다 */
const FOLLOW_MIN_GAP = 6.6;
/** 차간시간 (초) — 속도가 붙을수록 더 벌어져야 한다 */
const FOLLOW_HEADWAY = 0.9;
/** 차간 오차 1m 를 속도 몇 m/s 로 바꿀 것인가 */
const FOLLOW_GAIN = 0.6;
/** 뒷차의 순항 속도 (m/s) */
const FOLLOW_CRUISE = 11;
/** 편안한 가속·감속 한계 (m/s²) */
const FOLLOW_ACCEL = 2.2;
const FOLLOW_DECEL = 3.4;
/** 최소 간격까지 좁혀졌을 때만 쓰는 급제동 (m/s²) */
const FOLLOW_HARD_DECEL = 6.5;

/**
 * 뒷차가 출발할 때 내 뒤에 서는 거리 (m).
 *
 * **내 출발 자리에서 잰다.** 예전에는 `z = 100` 이라고 절대 좌표로 적어 두었는데,
 * 그 값은 평소 출발 자리(68)에서 32m 뒤라는 뜻이었다. 진입부 보호구역 판은 뒤로
 * 물려 출발하므로(당시 154) 그 자리는 내 **앞** 54m 가 됐다 — 뒷차가 앞에 서고, 차간이
 * 음수라 목표 속도가 0 으로 눌려 그대로 멈춰 있고, 뒷차는 충돌 판정에서 빠져 있어
 * (Game.ts) 내 차가 그 차를 뚫고 지나갔다.
 */
const FOLLOW_SPAWN_GAP = 32;

/** 보행자를 보고 횡단보도 앞에 설 때의 감속도 (m/s²) — 편안한 제동 범위 */
const PED_YIELD_DECEL = 1.8;

/**
 * 보행자가 차도를 벗어난 뒤 **다시 움직이기까지 기다리는 시간** (초).
 *
 * 법으로는 통행이 끝난 그 순간부터 갈 수 있다. 그런데 사람이 연석에 발을 올리는 바로
 * 그 프레임에 배경 차가 튀어 나가면 **떠밀듯 지나가는 그림**이 되고, 이 게임은 하필
 * "다 건널 때까지 기다린다" 를 가르치는 화면이다. 배경 차가 먼저 그것을 어기는 것처럼
 * 보이면 안 된다.
 *
 * 0.7초는 실제 운전자가 발을 옮기는 시간이기도 하다.
 */
const PED_CLEAR_HOLD = 0.7;

/** 교차 통행 차량의 순항 속도 (m/s) — 43km/h */
const CROSS_CRUISE = 12;

/** 교차 통행 차량의 가감속 한계 (m/s²) */
const CROSS_ACCEL = 1.8;
const CROSS_DECEL = 3.2;

/**
 * 보행자에게 양보할 때 **앞범퍼**과 횡단보도 사이에 남기는 여유 (m).
 *
 * **차 중심이 아니라 앞범퍼 기준이다.** 예전에는 이 값을 차의 좌표(this.x·this.z)에
 * 그대로 더해 정지선을 잡았는데, 차체는 원점을 가운데 두고 만들어져 있어
 * (CarMesh 의 `frontZ = -L/2`) 좌표가 정지선에 정확히 서도 **앞범퍼는 전장의 절반만큼
 * 더 나가 있었다.** 카탈로그 차가 4.6~5.0m 라 2.3~2.5m 다 — 여유 1.6m 를 다 까먹고도
 * 0.7~0.9m 가 남아, 배경 차가 늘 횡단보도를 조금 밟은 채로 섰다.
 *
 * 눈에 잘 안 띄는 종류의 어긋남이었다. 판정에도 안 걸리고(배경 차는 위반 판정 대상이
 * 아니다) 테스트도 차 좌표만 봐서 통과했는데, 화면에서는 **정지선을 밟고 선 차**가
 * 매 판 보인다. 하필 "정지선 앞에 선다" 를 가르치는 화면이다.
 */
const PED_STOP_GAP = 1.6;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * **앞차 · 뒷차까지 가벼운 모델로 그릴 것인가** — 손에 든 화면(세로 · 가로)에서만 켠다 (Game 이 판을 만들기 전에 정한다).
 *
 * 레벨 5 부터는 앞차 · 뒷차 · 교차 차량이 함께 나오는 판이 늘어난다(curriculum.ts 의 budget). 앞차와 뒷차는 원본
 * 모델이라 한 대가 GPU 텍스처 100MB 를 넘기도 하는데(SL63 104MB · 코롤라 115MB), 배경 차의 가벼운 모델과 내 차까지
 * 더하면 **한 판 안에서** 휴대폰 GPU 가 다시 검은 줄을 냈다 — 판 사이에 캐시를 비워도 판 안의 몫은 그대로였다
 * (사용자가 짚었다: *"레벨이 5 이상 되면 다시 화면이 깨진다"*). 가벼운 모델은 텍스처가 1/4(512²)이고 면이 1/10 이라
 * 두 대 합쳐도 60MB 를 넘지 않는다. 휴대폰 화면에서는 2cm 남짓한 단순화 자국이 보이지 않는다. PC 는 원본 그대로다.
 */
let nearCarLod = false;
export function setNearCarLod(on: boolean): void {
  nearCarLod = on;
}

export class TrafficCar {
  readonly group: THREE.Group;
  /**
   * 3D 모델을 붙이는 일이 끝나면 resolve 된다 (모델이 없어도 resolve — 절차적 차체로 간다).
   *
   * 주행을 시작하기 전에 이것을 기다린다. 예전에는 그냥 흘려보냈는데, 그러면 모델이
   * 도착한 프레임에 차체가 바뀌면서 멈칫한다 — 하필 정지선에 닿기 직전에 걸렸다.
   */
  readonly ready: Promise<void>;
  readonly role: NpcRole;
  private model: CarModel;
  private x: number;
  private z: number;
  private yaw: number;
  private speed = 0;
  private targetSpeed: number;
  private honkCooldown = 0;
  /** 직전 프레임의 속도 — 감속 중인지 보고 브레이크등을 켠다 */
  private lastSpeed = 0;
  /** 모델이 도착하기 전에 판이 끝났는지 — 늦게 온 모델을 지워진 차에 붙이지 않는다 */
  private disposed = false;

  private dims: CarSpec['dims'];

  constructor(
    role: NpcRole,
    index: number,
    spec: CarSpec,
    private onHonk?: () => void,
    /**
     * 이 구간의 제한속도 (m/s). 어린이보호구역이면 30km/h 다.
     *
     * 배경 차가 어린이보호구역을 43km/h 로 달리면, 규정을 가르치는 화면에서 규정을 어기는
     * 그림이 된다 (보행자 앞에 서게 만든 것과 같은 이유다).
     */
    private speedLimit = Infinity,
    /**
     * 모델을 화면에 올리기 전에 불러 주는 준비 단계 (Game.warmUp — 셰이더 미리 굽기).
     * 없으면 그냥 붙인다.
     */
    prepare?: (model: THREE.Object3D) => Promise<void>,
    /** 내 차의 출발 자리 (z). 뒷차가 그 뒤에 선다 (scenarios.ts 의 `spawnZ`). */
    playerSpawnZ: number = SPAWN_Z,
  ) {
    this.role = role;
    this.dims = spec.dims;
    this.model = buildCar(spec);
    this.group = this.model.group;

    /*
      3D 모델이 오면 절차적 차체를 대체한다 — 내 차와 같은 절차다.

      **NPC 용으로 받는다**(forPlayer: false). 내 차 레이어에 들어가면 좌·우·후방 시야
      창에서 사라지는데, 뒷차가 후방 창에 안 보이면 그 창을 둘 이유가 없다.

      모델이 없거나 못 읽어도(오프라인 단일 파일 빌드) 절차적 차체가 그대로 남는다.
      차종별 캐시가 있어 같은 차가 여러 대 나와도 파일은 한 번만 읽는다.
    */
    /*
      지나가는 배경 차는 **가벼운 모델(LOD)** 로 그린다 — 원본은 한 대에 삼각형 7만~66만 개다 (carModel.ts 의 loadCarModel ·
      scripts/build-lod-models.mjs). **앞차와 뒷차만 원본이다** — 앞차는 내 차 바로 앞(후방 시점에서 5m 남짓)에 서고,
      뒷차는 **후방 시야 창에 늘 떠 있다**(사용자가 짚었다: "뒤차도 눈에 가장 많이 띄는 부분이야"). 둘 다 단순화로
      생긴 차체의 잔 찌그러짐이 보이는 거리다. 두 대라 값도 크지 않다.
    */
    const near = (role === 'leader' || role === 'follower') && !nearCarLod;
    this.ready = loadCarModel(spec, { forPlayer: false, lod: !near })
      .then(async (model) => {
        if (!model) return;
        // 셰이더를 미리 굽고 붙인다 — 안 그러면 이 차가 처음 그려지는 프레임에서 멈칫한다
        if (prepare) await prepare(model);
        if (!this.disposed) this.model.useModel(model);
      })
      .catch(() => undefined);

    switch (role) {
      case 'crossTraffic': {
        // 서쪽에서 동쪽으로 달리는 통과 차량.
        // 반드시 1차로(중앙선 쪽)에만 둔다. 플레이어가 우회전해 합류하는 차로는
        // 가장자리 2차로인데, 거기까지 통과 차량이 달리면 규정을 지켜 돌아도
        // 피할 수 없는 충돌이 나 버린다. 대신 신호를 무시하고 크게 도는 차량은
        // 교차로 깊숙이 들어오므로 여전히 이 차량들과 부딪힌다.
        this.x = -46 - index * 30;
        this.z = LANE_1_OFFSET;
        this.yaw = -Math.PI / 2; // 전방 -Z 를 +X 로 돌림
        this.targetSpeed = Math.min(CROSS_CRUISE, this.speedLimit);
        break;
      }
      case 'follower': {
        this.x = LANE_2_OFFSET;
        this.z = playerSpawnZ + FOLLOW_SPAWN_GAP;
        this.yaw = 0;
        this.targetSpeed = Math.min(FOLLOW_CRUISE, this.speedLimit);
        /*
          **이미 달리고 있는 상태로 시작한다.**
          0 에서 출발하면 내가 교차로에 닿을 때까지 뒤에서 따라붙느라 바쁘고, 그동안
          차간이 60m 까지 벌어졌다가 한꺼번에 좁혀진다. 나와 같은 속도로 시작하면
          처음부터 일정한 간격으로 따라온다.
        */
        this.speed = Math.min(SPAWN_SPEED_KMH / 3.6, this.speedLimit);
        break;
      }
      case 'leader': {
        // 자리는 첫 프레임 전에 setPose 가 잡는다 (Game.buildTraffic)
        this.x = LANE_2_OFFSET;
        this.z = playerSpawnZ;
        this.yaw = 0;
        this.targetSpeed = 0;
        break;
      }
      case 'jam': {
        // 동쪽 진출로에 정지해 있는 차량들 — 두 번째 횡단보도 바깥부터 줄지어 선다
        this.x = CROSSWALK_OUTER + 3 + index * 6.4;
        this.z = LANE_2_OFFSET;
        this.yaw = -Math.PI / 2;
        this.targetSpeed = 0;
        break;
      }
    }
    this.sync();
  }

  private sync(): void {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.yaw;
  }

  /**
   * 횡단보도 C 앞 정지선 (동서 도로를 달리는 차 기준) — **차 좌표로 환산한 값**이다.
   *
   * 이 차가 여기 서면 앞범퍼가 횡단보도에서 PED_STOP_GAP 만큼 떨어진다.
   * 전장이 차마다 다르므로(4.6~5.0m) 상수가 아니라 차마다 다른 값이다.
   */
  private get pedStopX(): number {
    return CROSSWALK_INNER - PED_STOP_GAP - this.dims.length / 2;
  }

  /**
   * 횡단보도 A 앞 정지선 (남쪽에서 올라오는 뒷차 기준).
   *
   * 뒷차는 -Z 로 달리므로 횡단보도의 **바깥쪽 변**(z = 18.8)에 먼저 닿는다.
   * 부호만 반대일 뿐 교차 통행 차량과 같은 계산이다.
   */
  /**
   * 진입부 보호구역 횡단보도(S) 앞 정지선 — 차 좌표로 환산한 값.
   *
   * 앞범퍼 기준인 것은 A 와 같은 이유다 (pedStopZ 주석 참조).
   */
  private get pedStopZoneZ(): number {
    return CROSSWALK_S_OUTER + PED_STOP_GAP + this.dims.length / 2;
  }

  private get pedStopZ(): number {
    return CROSSWALK_OUTER + PED_STOP_GAP + this.dims.length / 2;
  }

  /**
   * 앞차의 자세를 받는다 (`leader` 전용).
   *
   * 이 차는 스스로 움직이지 않는다 — 검증기가 굴린 것과 **같은 상태기계**의 값을 그대로
   * 옮겨 그린다. 여기서 다시 속도를 계산하면 검증과 화면이 두 벌이 된다.
   */
  setPose(x: number, z: number, yaw: number, speedMs: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = speedMs;
  }

  /** 지금 위치·속도 — 같은 방향 차끼리 간격을 재는 데 쓴다 */
  get posX(): number {
    return this.x;
  }
  get speedMs(): number {
    return this.speed;
  }

  /**
   * 지금 **횡단보도 C 를 코앞에 두고 달리는 중**인가.
   * 보행자가 이 차 앞으로 걸어 나오지 않게 하는 데 쓴다 (Pedestrian.update 의 trafficBusy).
   */
  get blocksExitCrosswalk(): boolean {
    if (this.role !== 'crossTraffic' || this.speed < 1) return false;
    const remain = this.pedStopX - this.x;
    if (remain < -6) return false; // 이미 지나갔다
    /*
      **편안한 제동으로 설 수 있는 거리 안인가.** 12m/s 로 달리는 차는 40m 가 필요하다 —
      그 안에 들어온 차 앞으로 사람이 나서면 어떤 규칙을 넣어도 아슬아슬해진다.
      속도로 계산하므로 이미 서행 중인 차는 사람을 막지 않는다.
    */
    return remain < (this.speed * this.speed) / (2 * PED_YIELD_DECEL) + 2;
  }

  /**
   * 보행자가 차도를 벗어난 뒤 남은 대기 시간 (초).
   *
   * 사람이 지나가는 **동안** 계속 채워지고, 벗어난 뒤 이만큼 더 세고 나서야 출발한다
   * (PED_CLEAR_HOLD 주석 참고).
   */
  private pedHold = 0;
  /** 보행자에게 양보를 걸어 둔 상태인가 — 정지선을 스쳐도 풀리지 않는다 */
  private yieldingToPed = false;

  /** 충돌 판정용 차체 사각형 */
  get obb(): { x: number; z: number; yaw: number; halfL: number; halfW: number } {
    return {
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      halfL: this.dims.length / 2,
      halfW: this.dims.width / 2,
    };
  }

  update(
    dt: number,
    ctx: {
      /** 교차 방향에 통행권이 있는가 (플레이어가 적색일 때) */
      crossHasGreen: boolean;
      /** 진출로 정체가 풀렸는가 */
      jamCleared: boolean;
      /** 횡단보도 C 를 건너는 사람이 있는가 — 동서 통행 차량이 가로지르는 자리다 */
      pedOnExitCrosswalk: boolean;
      /**
       * 횡단보도 A 를 건너는 사람이 있는가 — **뒷차**가 가로지르는 자리다.
       *
       * 뒷차는 내 뒤를 따라오다가 내가 지나간 뒤 같은 횡단보도를 건넌다. 예전에는 앞차(나)만
       * 보고 달려서, 내가 지나간 뒤에 걸어 나온 사람을 그대로 밀고 갔다. 규정을 가르치는
       * 화면에서 배경 차가 사람을 치고 있으면 안 된다.
       */
      pedOnEntryCrosswalk: boolean;
      /**
       * 진입부 보호구역 횡단보도(S)에 사람이 있는가.
       *
       * 뒷차는 내 뒤에서 같은 길을 따라오므로 **그 횡단보도도 지난다.** A 만 보게
       * 두면, 규정을 가르치는 화면에서 배경 차가 보호구역 횡단보도를 밀고 지나간다.
       */
      pedOnSchoolZoneCrosswalk: boolean;
      /**
       * 같은 방향 앞차와의 간격과 그 차의 속도 (없으면 Infinity).
       *
       * 없으면 **모두가 같은 정지선을 목표로 삼아 한 자리에 겹쳐 선다** — 보행자 앞에서
       * 서게 만들자마자 드러난 문제다. 뒷차와 같은 따라가기 모형을 축약해 쓴다.
       */
      aheadGap: number;
      aheadSpeed: number;
      player: { x: number; z: number; speedKmh: number };
      headlightsOn: boolean;
    },
  ): void {
    this.model.lights.setHeadlights(ctx.headlightsOn);

    if (this.role === 'crossTraffic') {
      // 통행권이 없으면 교차로 앞에서 멈춘다
      const approaching = this.x < -INTERSECTION_HALF;
      const cruise = Math.min(CROSS_CRUISE, this.speedLimit);
      this.targetSpeed = ctx.crossHasGreen || !approaching ? cruise : 0;
      if (!ctx.crossHasGreen && approaching && this.x > -INTERSECTION_HALF - 12) {
        this.targetSpeed = 0;
      }

      /*
        **횡단보도 C 앞에서 선다.** 동서 도로를 달리는 차는 교차로를 지난 뒤 이 횡단보도를
        가로지르므로, 사람이 건너는 동안 그대로 달리면 사람 사이로 지나가게 된다.

        남은 거리에 맞춰 속도를 낮춘다(√(2·a·거리)) — 목표 속도를 0 으로 떨궈 놓고 1차
        지연으로 따라가게 하면 코앞에서 급정거하는 것처럼 보인다. 뒷차와 같은 방식이다.
      */
      /*
        **정지선 앞이면 양보를 건다.** 이미 횡단보도에 들어선 차는 걸지 않는다 — 그 차는
        사람 위에서 멈추는 것보다 빠져나가는 편이 낫고, 애초에 그런 거리까지 온 차 앞으로는
        보행자가 나서지 않는다 (blocksExitCrosswalk).
      */
      if (ctx.pedOnExitCrosswalk && this.x < this.pedStopX) this.yieldingToPed = true;

      if (this.yieldingToPed) {
        if (ctx.pedOnExitCrosswalk) this.pedHold = PED_CLEAR_HOLD;
        else this.pedHold = Math.max(0, this.pedHold - dt);
        if (this.pedHold <= 0) this.yieldingToPed = false;
      }

      /*
        **한번 걸리면 0 으로 붙잡는다.**

        예전에는 `x < pedStopX` 일 때만 √(2·a·거리) 로 줄였다. 그 식은 거리가 0 에
        가까워지면 목표를 0 으로 보내지만, 목표를 1차 지연으로 쫓는 탓에 차는 완전히 서지
        못하고 **정지선을 조금씩 기어 넘는다.** 넘고 나면 조건이 풀려 그대로 가속했다 —
        사람이 건너는 중인데 배경 차가 횡단보도를 통과했다.
        (기존 테스트가 10초까지만 봐서 못 잡았다. 12.5초에 넘어간다)
      */
      if (this.yieldingToPed) {
        const remain = this.pedStopX - this.x;
        this.targetSpeed = Math.min(
          this.targetSpeed,
          remain > 0 ? Math.sqrt(2 * PED_YIELD_DECEL * remain) : 0,
        );
      }

      // 앞차 뒤에 선다 (겹쳐 서지 않게)
      if (Number.isFinite(ctx.aheadGap)) {
        const desired = FOLLOW_MIN_GAP + FOLLOW_HEADWAY * this.speed;
        const wanted = ctx.aheadSpeed + (ctx.aheadGap - desired) * FOLLOW_GAIN;
        this.targetSpeed = Math.min(
          this.targetSpeed,
          clamp(wanted, 0, Math.min(FOLLOW_CRUISE, this.speedLimit)),
        );
      }

      // 우회전해 같은 차로로 합류한 차량에는 감속해 준다.
      // 단 교차로에 진입한 뒤부터만 배려하므로, 교차로를 옆으로 가로질러 오는
      // 신호위반 차량은 여전히 피하지 못한다 — 그래야 적색 무시가 사고로 이어진다.
      const sameLane = Math.abs(ctx.player.z - this.z) < LANE_WIDTH * 0.75;
      const merged = ctx.player.x > this.x && ctx.player.x - this.x < 16;
      if (sameLane && merged && this.x > -INTERSECTION_HALF) {
        this.targetSpeed = Math.min(this.targetSpeed, ctx.player.speedKmh / 3.6);
      }

      // 뒷차와 같은 방식 — 목표를 1차 지연으로 쫓으면 코앞에서 급정거하는 것처럼 보인다
      {
        const dv = this.targetSpeed - this.speed;
        const step = (dv > 0 ? CROSS_ACCEL : CROSS_DECEL) * dt;
        this.speed = Math.max(0, this.speed + clamp(dv, -step, step));
      }

      /*
        **정지선을 넘지 않는다** — 위 감속이 늦었을 때의 마지막 선이다 (뒷차와 같은 규칙).

        목표 속도를 0 으로 붙잡아도 1차 지연으로 쫓는 탓에 차는 정지선을 몇십 cm 씩
        기어 넘는다. 그 몇십 cm 가 곧 횡단보도를 밟은 그림이라 여기서 잘라 낸다.

        **아직 정지선 앞일 때만** 건다. 이미 지나간 차에까지 걸면 사람이 뒤늦게 걸어
        나온 순간 차가 뒤로 끌려간다.
      */
      const beforeStop = this.x <= this.pedStopX;
      this.x += this.speed * dt;
      if (this.yieldingToPed && beforeStop) this.x = Math.min(this.pedStopX, this.x);
      if (this.x > 90) this.x = -110;
    } else if (this.role === 'follower') {
      // 앞차(플레이어)와의 거리·속도차를 함께 보고 미리 발을 뗀다 (위 상수 주석 참고)
      const gap = this.z - ctx.player.z;
      const lead = ctx.player.speedKmh / 3.6;
      const desired = FOLLOW_MIN_GAP + FOLLOW_HEADWAY * this.speed;
      this.targetSpeed = clamp(
        lead + (gap - desired) * FOLLOW_GAIN,
        0,
        Math.min(FOLLOW_CRUISE, this.speedLimit),
      );

      const dv = this.targetSpeed - this.speed;
      // 너무 붙었으면 그때만 세게 밟는다 — 평소에는 사람이 밟는 정도로만 변한다
      const decel = gap < FOLLOW_MIN_GAP ? FOLLOW_HARD_DECEL : FOLLOW_DECEL;
      const step = (dv > 0 ? FOLLOW_ACCEL : decel) * dt;
      this.speed = Math.max(0, this.speed + clamp(dv, -step, step));

      /*
        **횡단보도 A 앞에서 선다.** 앞차(나)를 쫓는 것만으로는 사람을 피하지 못한다 —
        내가 이미 지나간 뒤라면 앞이 비어 있어 그대로 밀고 들어간다.
        남은 거리에 맞춰 속도를 낮추는 방식은 교차 통행 차량과 같다.
      */
      /*
        **진입부 보호구역 횡단보도가 먼저다** (z 50 이 정지선 A 의 20.8 보다 남쪽).
        A 와 같은 방식으로 남은 거리에 맞춰 줄이고, 넘지 않게 잘라 낸다.
      */
      if (ctx.pedOnSchoolZoneCrosswalk && this.z >= this.pedStopZoneZ) {
        const remain = Math.max(0, this.z - this.pedStopZoneZ);
        this.targetSpeed = Math.min(this.targetSpeed, Math.sqrt(2 * PED_YIELD_DECEL * remain));
        const dv3 = this.targetSpeed - this.speed;
        const step3 = (dv3 > 0 ? FOLLOW_ACCEL : FOLLOW_HARD_DECEL) * dt;
        this.speed = Math.max(0, this.speed + clamp(dv3, -step3, step3));
      }

      if (ctx.pedOnEntryCrosswalk && this.z >= this.pedStopZ) {
        const remain = Math.max(0, this.z - this.pedStopZ);
        this.targetSpeed = Math.min(this.targetSpeed, Math.sqrt(2 * PED_YIELD_DECEL * remain));
        const dv2 = this.targetSpeed - this.speed;
        const step2 = (dv2 > 0 ? FOLLOW_ACCEL : FOLLOW_HARD_DECEL) * dt;
        this.speed = Math.max(0, this.speed + clamp(dv2, -step2, step2));
      }

      /*
        사람이 건너는 동안에는 횡단보도를 넘지 않는다 — 위 감속이 늦었을 때의 마지막 선이다.

        **아직 횡단보도 앞에 있을 때만** 건다. 이미 지나간 차에까지 걸면 사람이 뒤늦게
        걸어 나온 순간 차가 뒤로 끌려간다.

        **경계에서 `>=` 다.** `>` 로 두면 정지선에 정확히 닿은 그 프레임부터 위 감속도
        이 클램프도 풀려, 세워 둔 차가 그대로 가속해 횡단보도를 통과한다 — 교차 통행
        차량이 겪었던 것과 같은 어긋남이고(위 `x < pedStopX` 주석), 여기서는 클램프가
        z 를 정지선에 정확히 붙여 놓기 때문에 **반드시** 걸린다.
        (10초만 보던 기존 검사는 못 잡았다. 그 안에는 아직 닿지 못한다)
      */
      /*
        **두 래치 모두 움직이기 전에 잰다.** 뒤에서 재면 한 프레임에 정지선을 넘어선
        자리가 되어(60fps 에 0.19m) 래치가 false 가 되고, 클램프가 걸리지 않은 채로
        그대로 지나간다 — 실제로 뒷차가 보호구역 횡단보도를 밀고 갔다.
      */
      const beforeCrosswalk = this.z >= this.pedStopZ;
      const beforeZoneCrosswalk = this.z >= this.pedStopZoneZ;
      this.z -= this.speed * dt;
      if (ctx.pedOnEntryCrosswalk && beforeCrosswalk) this.z = Math.max(this.pedStopZ, this.z);
      if (ctx.pedOnSchoolZoneCrosswalk && beforeZoneCrosswalk) {
        this.z = Math.max(this.pedStopZoneZ, this.z);
      }
      // 마지막 안전장치. 위 모형이 제대로 돌면 여기까지 오지 않는다
      // (뒷차는 충돌 판정에서 빠져 있으므로, 겹쳐 보이는 것만 막으면 된다)
      this.z = Math.max(ctx.player.z + 5.2, this.z);

      // 플레이어가 정지선 부근에 오래 서 있으면 경적
      this.honkCooldown -= dt;
      if (ctx.player.speedKmh < 1 && gap < 10 && this.honkCooldown <= 0) {
        this.honkCooldown = 3.5 + Math.random() * 3;
        this.onHonk?.();
      }
    } else if (this.role === 'leader') {
      // 움직임은 setPose 가 이미 반영했다 — 등화와 바퀴만 아래에서 맞춘다
    } else if (this.role === 'jam') {
      // 정체가 풀리면 앞차부터 순서대로 빠져나간다 (index가 클수록 앞쪽)
      this.targetSpeed = ctx.jamCleared ? Math.min(10, this.speedLimit) : 0;
      this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 0.9);
      this.x += this.speed * dt;
    }

    /*
      **브레이크등은 속도가 줄어드는 동안 켠다.**
      예전에는 '거의 멈췄을 때'만 켰는데, 그러면 뒷차가 감속하는 내내 등이 꺼져 있어
      후방 창으로 보면 아무 예고 없이 붙어 서는 것처럼 보인다.
    */
    this.model.lights.setBrake(this.speed < 0.4 || this.speed < this.lastSpeed - dt * 0.6);
    this.lastSpeed = this.speed;
    this.model.spinWheels(this.speed * dt);
    this.sync();
  }

  dispose(): void {
    this.disposed = true;
    this.model.dispose();
  }
}
