/**
 * 게임 루프. 시나리오 하나를 3D로 구성하고, 매 프레임 판정 엔진에 세계 상태를 먹인다.
 *
 * 렌더링·물리·AI는 여기서 조립하지만, "위반인가 아닌가"의 판단은 전부 rules/lawRules.ts가 한다.
 * 그래서 판정 규칙을 바꿀 때 3D 코드를 건드릴 필요가 없다.
 */

import * as THREE from 'three';
import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  FINISH_X,
  FINISH_Z,
  INTERSECTION_HALF,
  LANE_1_OFFSET,
  PLAYER_APPROACH_X,
  PLAYER_EXIT_Z,
  ROAD_HALF_WIDTH,
  STOP_LINE,
  CROSSWALK_S_INNER,
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  CROSSWALK_S_OUTER,
  STOP_LINE_S,
  APPROACH_ZONE_FAR_Z,
  SCHOOL_ZONE_FAR_Z,
} from '../layout';
import type { CarSpec } from '../economy/cars';
import type {
  CrosswalkId,
  JudgeResult,
  LeadReport,
  LightColor,
  RightArrowColor,
  WorldSample,
} from '../rules/lawRules';
import { RightTurnJudge, ZONE_ROAD_EDGES } from '../rules/lawRules';
import { pedSignalFor } from './pedSignalFor';
import { isSignalWait } from './stopReason';
import {
  JAM_CLEAR_SECONDS,
  SCHOOL_ZONE_PROGRAM,
  STANDARD_PROGRAM,
  phaseAt,
  spawnZ,
  type ScenarioSpec,
  type SchoolZonePhase,
  type SignalPhase,
} from '../scenarios/scenarios';
import { GameAudio } from './Audio';
import { buildCar, type CarModel } from './CarMesh';
import { AutoDriver, type AutoDriveState } from './AutoDriver';
import { FpsMeter } from './FpsMeter';
import { AutoResolution, defaultGraphics, startScale, type GraphicsSettings } from './quality';
import { CameraRig, type ViewMode } from './CameraRig';
import { Controls } from './Controls';
import { Intersection } from './Intersection';
import { ClusterPanel } from './ClusterPanel';
import {
  SEAT_RANGE,
  dressCarEnv,
  loadCarModel,
  loadedCarIds,
  seatForwardLimit,
  type CarModelAnchors,
} from './carModel';
import { PeripheralView } from './PeripheralView';
import { sharedRenderer } from './renderer';
import { Pedestrian } from './Pedestrian';
import { StopMarkers, type StopTarget } from './StopMarkers';
import {
  PED_SIGNAL_HALF_HEIGHT,
  PED_SIGNAL_POLE_HEIGHT,
  PED_SIGNAL_POLE_HEIGHT_NEAR,
  PED_SIGNAL_SCALE_NEAR,
  pedSignalHalfHeight,
  PedestrianSignal,
  RIGHT_SIGNAL_HALF_HEIGHT,
  RIGHT_SIGNAL_POLE_HEIGHT,
  RightTurnSignal,
  SIGNAL_ARM_Y,
  VEHICLE_SIGNAL_HALF_HEIGHT,
  VehicleSignal,
  ZONE_SIGNAL_HALF_HEIGHT,
  ZONE_SIGNAL_SCALE,
  makeSignalPole,
} from './TrafficLight';
import { TrafficCar } from './TrafficCar';
import { LeadDrive } from './leadDrive';
import { PlayerMarker } from './PlayerMarker';
import { pedCueAt, type PedCue } from './pedCue';
import { pickNpcRoster } from './npcVehicles';
import { SCHOOL_ZONE_KMH, Vehicle } from './Vehicle';
import type { DrivePace } from '../scenarios/challenge';
import { World } from './World';

const RUN_TIMEOUT = 100;

/**
 * 한 판에 등장하는 NPC **차종 수.**
 *
 * 둘이었는데 셋으로 늘렸다. 둘이면 도로 위 차가 두 종류뿐이라 눈에 띄고, 넷을 넘기면
 * 첫 판에서 받아야 할 모델이 늘어 출발이 늦는다. 셋이면 판마다 새로 받는 것은 한 대뿐이고
 * (pickNpcRoster 가 새 얼굴을 하나만 넣는다) 몇 판 지나면 그마저 없다.
 */
const NPC_ROSTER_SIZE = 3;

/**
 * 방향지시등 한 주기(켜짐 + 꺼짐)의 길이 (초).
 *
 * **0.9초였던 것을 0.64초로 당겼다.** 예전 값은 분당 67회로, 소리를 넣고 나니 실제
 * 깜빡이보다 눈에 띄게 느렸다 — 딸깍 소리를 들으면 주기가 귀에 걸리기 때문에 그림만
 * 있을 때는 몰랐던 것이 드러난다.
 *
 * 지금 값은 소리로 쓰는 녹음본(soundAssets.ts 의 The_Cri 'BMW Indicator')을 **재서**
 * 맞춘 것이다 — 그 파일의 클릭 간격이 0.319초라 한 주기가 0.639초, 분당 94회다.
 * 흔히 쓰이는 기준(분당 60~120회) 안에 들어온다.
 *
 * **한 곳에서만 정한다.** 이 값이 차체 등화·계기판 화살표·소리 셋을 함께 움직인다.
 */
const BLINK_PERIOD = 0.64;


/**
 * 정지 안내를 띄우기 시작하는 거리 (정지선 앞 m).
 *
 * 이 시점에는 차가 이미 서행(12km/h = 3.3m/s)으로 내려와 있다(Vehicle.SLOW_BEFORE_LINE).
 * 사람 반응 1.5초(5m) + 제동 1.2m ≒ 6.2m 면 서므로 12m 는 넉넉하다.
 * 반대로 너무 길면 한참 전에 멈춰 버려 정지선 앞 정지로 인정되지 않는다.
 */
const STOP_ADVICE_LEAD = 12;

/**
 * 두 번째 횡단보도(C) 정지 안내를 띄우기 시작하는 남은 거리 (m).
 * 코너를 도는 중이라 x 좌표만으로는 거리를 못 재므로, 남은 경로를
 * (가로 남은 거리 + 세로 남은 거리)로 근사한다.
 */
const EXIT_ADVICE_LEAD = 7;


/**
 * 진입부 보호구역 횡단보도 신호등의 가로암 높이 (m).
 *
 * 교차로 신호등(`SIGNAL_ARM_Y` = 7.2m)보다 낮다. 그쪽은 정지선에서 41m 앞이라
 * 높이 달아도 정면으로 들어오지만, 이 횡단보도는 **7.6m 앞**이다 — 같은 높이에 달면
 * 정지선에 선 운전자에게 40° 위가 되어 화면 밖으로 나간다.
 *
 * 2.2배 등화(높이 1.5m)를 이 아래에 매달면 가운데가 4.8m, 아랫변이 4.0m 에 온다.
 * 우회전신호등 지주(5.6m)와 같은 높이다.
 */
const ZONE_SIGNAL_ARM_Y = 5.6;

/** 방향을 가진 사각형(OBB) — 차체 충돌 판정용 */
interface Obb {
  x: number;
  z: number;
  yaw: number;
  halfL: number;
  halfW: number;
}

/** 전방·우측 단위벡터 (전방은 -Z 기준) */
function obbAxes(o: Obb): Array<{ x: number; z: number }> {
  const f = { x: -Math.sin(o.yaw), z: -Math.cos(o.yaw) };
  return [f, { x: -f.z, z: f.x }];
}

/** 주어진 축에 사각형을 투영했을 때의 반지름 */
function projectRadius(o: Obb, axis: { x: number; z: number }): number {
  const [f, r] = obbAxes(o);
  return (
    o.halfL * Math.abs(f.x * axis.x + f.z * axis.z) +
    o.halfW * Math.abs(r.x * axis.x + r.z * axis.z)
  );
}

/**
 * 분리축 정리(SAT)로 두 사각형이 겹치는지 판정한다.
 * 네 축(각 사각형의 전방·우측) 중 하나라도 둘을 갈라놓으면 겹치지 않은 것이다.
 */
function obbOverlap(a: Obb, b: Obb): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const axis of [...obbAxes(a), ...obbAxes(b)]) {
    const gap = Math.abs(dx * axis.x + dz * axis.z);
    if (gap > projectRadius(a, axis) + projectRadius(b, axis)) return false;
  }
  return true;
}

/** 지금 지켜야 할 정지 지점의 상태 — 이 게임의 핵심 지표 */
export interface StopStatus {
  /** 지금 멈춰야 하는가 */
  required: boolean;
  /** 이번 정지 지점에서 완전정지를 인정받았는가 */
  satisfied: boolean;
  /** 정지 지점까지 남은 거리(m). 이미 지났으면 음수. */
  distance: number;
  target: StopTarget;
  /** 노면 띠를 깔 자리 (StopMarkers.StopMarkerState 의 bandZ) */
  bandZ?: number;
}

export interface GameSnapshot {
  speedKmh: number;
  stop: StopStatus;
  phase: SignalPhase;
  rightSignalOn: boolean;
  blinkerVisible: boolean;
  view: ViewMode;
  /** 우회전신호등 등화. 미설치 교차로는 null. */
  rightArrow: RightArrowColor | null;
  /**
   * **진입로 어린이보호구역 횡단보도의 차량 등화.** 그 보호구역이 없거나 신호기가 없으면 `null`.
   *
   * 화면이 이것을 알아야 **"일시정지" 와 "신호 대기" 를 가려 말한다.** 신호기가 있는 보호구역
   * 횡단보도에서 적색이면 서는 까닭은 일시정지 의무가 아니라 **녹색까지 기다리는 것**이다
   * (제5조 — 적색은 정지, 신호기 없는 보호구역 횡단보도의 제27조 제7항과는 다른 조문이다).
   * 사용자가 화면을 보고 짚었다: "이 상황은 일시정지가 아니고 신호가 끝날 때까지 기다리는
   * 신호 대기 상황 아니야?"
   */
  zoneLight: LightColor | null;
  elapsed: number;
  /** 완전정지 유지 시간 (일시정지 게이지) */
  stopHold: number;
  /** 현재 조건에서 지금 진행해도 되는가 — 학습 보조 표시용 */
  advice: 'stop' | 'yield' | 'go';
  /**
   * **내 앞 횡단보도의 보행자가 보이는 움직임** — AI 코치가 한 줄로 알려 준다 (Hud).
   *
   *  - `intending` — 연석까지 걸어 나와 **건너려는 것 같은** 사람 (아직 차도 밖)
   *  - `crossing`  — 이미 차도 위를 **건너는 중인** 사람
   *
   * 없거나 아직 먼 횡단보도면 `null`. 만나는 순서(S → A → C)로 가장 먼저 만날 곳 하나만 준다.
   */
  pedCue: PedCue | null;
  /**
   * **앞차가 서야 할 자리를 서지 않고 지나갔고, 나는 아직 그 자리 전이다** — 그 자리가 어디인가.
   *
   * 일시정지를 건너뛰는 앞차(leadDrive.ts 의 `rolling`)는 "앞차가 가니까 따라간다" 를 시험하는
   * 나쁜 본보기다. 그런데 화면에서는 그 의도가 드러나지 않아 **앞차가 고장 난 것처럼** 보였다.
   * 코치가 그 순간 "앞차가 서지 않았다 — 따라가지 말라" 를 짚는다. 내가 그 자리를 지나면 끈다.
   */
  leadCue: 'S' | 'A' | null;
  /** 최근 1초 동안 실제로 그린 횟수 (설정에서 켰을 때만 화면에 뜬다) */
  fps: number;
  /** 렌더 해상도 배율 (1 = 100%) — fps 옆에 함께 띄운다 */
  renderScale: number;
}

export interface GameCallbacks {
  onSnapshot(s: GameSnapshot): void;
  onFinish(result: JudgeResult): void;
  onToast(message: string): void;
  onViewChange(view: ViewMode): void;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private world: World;
  private intersection: Intersection;
  private rig: CameraRig;
  private periph: PeripheralView;
  /** 계기판 — 화면 우측 상단의 HUD 캔버스 */
  private cluster: ClusterPanel;
  private stopMarkers = new StopMarkers();
  private vehicle: Vehicle;
  private carModel: CarModel;
  private judge: RightTurnJudge;
  /** 곧게 가는 코스인가 (교차로 직진 · 사거리 없는 보호구역 도로) — 우회전과 완주선 · 의무 · 조작이 다르다 */
  private readonly straight: boolean;
  /** 정지 안내를 띄우기 시작하는 거리 — 판정의 정지 구역보다 길면 안내를 보고 선 자리가 인정되지 않는다 */
  private stopAdviceLead = STOP_ADVICE_LEAD;
  /** 다가가는 속도와 브레이크 — 난이도가 정한다. 앞차도 이 속도로 달린다 */
  private pace: DrivePace | undefined;

  private vehicleSignal = new VehicleSignal();
  private pedSignals: Partial<Record<CrosswalkId, PedestrianSignal[]>> = {};
  /** 진입부 보호구역의 차량신호등. 신호기가 없는 판에서는 세우지 않는다 */
  private zoneSignal: VehicleSignal | null = null;
  /** 사거리 없는 보호구역 도로의 횡단보도별 신호등 (drive: 'zoneOnly') */
  private zoneRoadSignals: Partial<Record<CrosswalkId, VehicleSignal>> = {};

  /**
   * **신호 갠트리를 세운 자리** (횡단보도별 z).
   *
   * 과속 단속 카메라를 **그 지주에 같이 올리려고** 적어 둔다 — 사진의 '신호 과속단속장비' 가
   * 그렇게 생겼다 (buildZoneSpeedCamera).
   */
  private signalGantryZ: Partial<Record<CrosswalkId, number>> = {};
  /** 우회전신호등 — 설치된 시나리오에서만 만든다 */
  private rightSignal: RightTurnSignal | null = null;
  /** AI 자율 주행 중이면 값이 있다 — 사람 입력 대신 이쪽이 운전한다 */
  private auto: AutoDriver | null = null;
  /** 화질 설정 — 그림자·반사·시야 창·프레임 상한이 여기서 갈린다 */
  private graphics: GraphicsSettings;
  /** 프레임 상한을 지키려고 마지막으로 그린 시각 (0 = 제한 없음) */
  private lastDraw = 0;
  /** 실제로 그린 횟수 — 설정을 바꾼 효과를 화면에서 바로 보게 한다 */
  private fps = new FpsMeter();
  /**
   * **렌더 해상도 배율** — 화면 배율(최대 2)에 곱한다. 설정이 '자동' 이면 느릴 때만 스스로 낮춘다(quality.ts 의
   * AutoResolution). 약한 GPU 에서 가장 잘 듣는 손잡이다.
   */
  private renderScale = 1;
  private autoRes: AutoResolution | null = null;

  private pedestrians: Pedestrian[] = [];
  private npcs: TrafficCar[] = [];
  /**
   * 앞차 — 움직임(상태기계)과 차체(TrafficCar 'leader')가 따로다.
   * 움직임은 검증기와 같은 것을 쓰고(leadDrive.ts), 차체는 그 자세를 받아 그리기만 한다.
   */
  private lead: LeadDrive | null = null;
  private leader: TrafficCar | null = null;
  /** 앞차와 가장 가까웠던 간격 (m) — 결과 기록 · 습관 분석에 쓴다 */
  private minLeadGap = Infinity;
  /** "앞차와 너무 가깝다" 는 한 판에 한 번만 알린다 */
  private leadWarned = false;
  /** 후방 시점에서 내 차 위에 뜨는 "내 차" 말풍선 (PlayerMarker.ts) */
  private myCarMarker: PlayerMarker;

  private elapsed = 0;
  private running = false;
  private finished = false;
  private rafId = 0;
  private lastFrame = 0;
  private blinkPhase = 0;
  private lastBlinkOn = false;
  private stopHold = 0;
  private disposed = false;
  /**
   * 주행을 시작하기 전에 끝나야 하는 준비 작업들 (모델 읽기 · 셰이더 굽기).
   * → prepare() 가 이것을 기다린다.
   */
  private pending: Array<Promise<unknown>> = [];
  /** 매 프레임 쓰는 임시 벡터 — 새로 만들지 않으려고 하나를 돌려 쓴다 */
  private scratch = new THREE.Vector3();

  constructor(
    private canvas: HTMLCanvasElement,
    private scenario: ScenarioSpec,
    private carSpec: CarSpec,
    private controls: Controls,
    private audio: GameAudio,
    private cb: GameCallbacks,
    opts: {
      /** 차고에서 정해 둔 좌석 앞뒤 조절값 (m, +가 앞) */
      seatOffset?: number;
      /**
       * 어느 시점으로 시작할지.
       *
       * **기본값은 설정(save.ts 의 settings.startView, 기본 후방 시점)이 정한다.** 여기 적힌
       * 'driver' 는 옵션을 아예 넘기지 않았을 때의 폴백일 뿐이다 (카메라 리그의 초기 모드).
       *
       * `setView()` 를 대신 부르지 않는 이유는 그 메서드가 **시점 변경 토스트를 띄우기**
       * 때문이다 — 주행을 시작할 때마다 "후방 시점" 이 뜨면 안내 문구를 덮는다.
       */
      startView?: ViewMode;
      /**
       * AI 자율 주행 — 사람 입력 대신 AutoDriver 가 운전한다.
       *
       * 차를 순간이동시키거나 판정을 건너뛰지 않는다. 같은 물리·같은 판정을 그대로
       * 통과하므로, 끝나고 뜨는 등급이 곧 "규정대로 하면 이렇게 된다" 는 증거다.
       */
      autoDrive?: boolean;
      /** 화질 설정 (game/quality.ts). 없으면 기본값(높음). */
      graphics?: GraphicsSettings;
      /** 교차로에 다가가는 속도와 브레이크 — 난이도가 정한다 (scenarios/challenge.ts). 없으면 쉬움(예전 값) */
      pace?: DrivePace;
      /** 정지선 앞 몇 m 안에서 서야 정지로 치는가 — 난이도가 정한다. 없으면 STOP_ZONE_DEPTH */
      stopZone?: number;
    } = {},
  ) {
    const { seatOffset = 0, startView = 'driver' } = opts;
    /*
      **이 판을 어떻게 빠져나가는가** (scenarios.ts 의 `drive`). 판정 · 완주선 · 조작이 모두 이 값을 본다.
      한 번 정해지면 판이 끝날 때까지 바뀌지 않으므로 필드에 담아 둔다.
    */
    this.straight = scenario.drive !== undefined && scenario.drive !== 'rightTurn';
    this.judge = new RightTurnJudge(opts.stopZone, scenario.drive ?? 'rightTurn');
    if (opts.stopZone !== undefined) this.stopAdviceLead = Math.min(STOP_ADVICE_LEAD, opts.stopZone);
    this.graphics = opts.graphics ?? defaultGraphics();
    // 자율 주행도 코스에 맞는 길을 따라간다 — 직진 코스면 돌지 않고 곧장 통과한다 (game/AutoDriver.ts)
    if (opts.autoDrive) this.auto = new AutoDriver(carSpec.dims.length * 0.58, undefined, scenario.drive ?? 'rightTurn');
    // 판마다 새로 만들지 않는다 — 모델의 텍스처·셰이더가 그대로 남는다 (renderer.ts)
    this.renderer = sharedRenderer(canvas);
    this.renderScale = startScale(this.graphics.resolution);

    this.world = new World(scenario.timeOfDay, scenario.weather, this.graphics);
    /*
      HDRI 환경광 — **첫 프레임 전에** 건다. 메뉴에 있는 동안 세 시간대를 다 구워 두므로
      (main.ts 의 boot) 보통은 캐시에서 꺼내는 것으로 끝난다. 굽지 못했으면 도착한 뒤에
      걸리고, 실패해도 기존 조명으로 그대로 진행한다.
    */
    this.pending.push(this.world.loadEnvironment(this.renderer));
    this.intersection = new Intersection({
      schoolZone: scenario.isSchoolZone,
      /*
        **사거리 없는 보호구역 도로**는 구간 표시를 진입로 방식으로 그린다 — 그 길 전체가 보호구역이고,
        첫 번째 횡단보도가 진입로의 그 자리다 (scenarios/zoneCourse.ts).

        **`drive` 를 적지 않은 판은 우회전 코스다.** 한때 `drive !== 'rightTurn'` 으로만 보았는데,
        라이브러리 판은 이 값을 적지 않아(undefined) **보호구역이 아닌 판까지 붉게 칠해지고 진입로
        횡단보도가 그려졌다.** 규칙은 그대로라 판정은 멀쩡했고, 화면만 거짓말을 했다.
      */
      approachZone: this.straight || Boolean(scenario.approachSchoolZone),
      zoneOnly: scenario.drive === 'zoneOnly',
      // 자전거횡단도 — 노면에 붉은 띠와 자전거 표시로 그린다 (Intersection.ts 의 drawBikeLane)
      bikeLane: scenario.bikeLane,
      night: scenario.timeOfDay === 'night',
    });
    this.world.scene.add(this.intersection.group);
    this.world.scene.add(this.stopMarkers.group);

    this.pace = opts.pace;
    this.vehicle = new Vehicle(
      carSpec.dims.length,
      scenario.isSchoolZone,
      Boolean(scenario.approachSchoolZone),
      spawnZ(scenario),
      opts.pace,
      scenario.drive === 'zoneOnly',
    );
    this.carModel = buildCar(carSpec, { isPlayer: true });
    this.myCarMarker = new PlayerMarker(carSpec);
    this.world.scene.add(this.myCarMarker.mesh);
    this.cluster = new ClusterPanel();
    this.world.scene.add(this.carModel.group);

    this.rig = new CameraRig(canvas.clientWidth / canvas.clientHeight, carSpec);
    // 횡단보도 양 끝은 화면 화각 밖(좌 78°·우 67°)이라 주변시야 창으로 보완한다
    this.periph = new PeripheralView(this.world.scene, carSpec);
    /*
      **시야 창도 같은 값을 안다** — 진입로 보호구역 횡단보도가 있는 판에서는 그 앞에서도
      창이 떠올라야 한다 (PeripheralView 의 setApproachZone). 장면을 지을 때 쓴 값과 같은
      식이어야 화면에 그려진 횡단보도와 창이 뜨는 자리가 어긋나지 않는다.
    */
    this.periph.setApproachZone(this.straight || Boolean(this.scenario.approachSchoolZone));
    this.setSeatOffset(seatOffset);
    // 시점은 조용히 맞춘다 (토스트 없이). 거울·시야 창은 운전석에서만 켜야 한다.
    this.rig.setMode(startView);
    this.setOverlaysVisible(startView);

    this.installPartProbe(canvas);

    /*
      3D 차량 모델이 있으면 절차적 차체를 대체한다 (없으면 그대로 둔다).

      모델은 비동기로 온다. 그동안 차량을 그리면 **절차적 차체**가 잠깐 보였다가 모델로
      바뀌고, 남겨 두는 핸들도 절차적 자리에 그려졌다가 모델 자리로 옮겨 가며 튄다.
      그래서 자리가 정해질 때까지 통째로 감춰 둔다.
      (모델이 없어 실패로 끝나도 마지막에 그대로 켜므로 절차적 차체가 온전히 나온다)
    */
    this.carModel.setSeatedVisible(false);
    this.pending.push(this.attachPlayerModel(carSpec).catch(() => undefined));

    this.buildSignals();
    this.buildPedestrians();
    this.buildTraffic();
    this.resize();
  }

  /** 3D 모델이 오면 절차적 차체를 대체한다 (위 생성자 주석 참고) */
  private async attachPlayerModel(carSpec: CarSpec): Promise<void> {
    const model = await loadCarModel(carSpec);
    /*
      **데우기 전에 환경맵을 건다** — 재질을 나중에 고치면 그 재질의 셰이더가 다시 컴파일되고, 그게 주행 중
      멈칫함이다 (warmUp 주석과 같은 이유). 화질을 낮춰도 내 차는 비친다 (carModel.ts 의 dressCarEnv).
    */
    if (model) {
      const env = this.world.nearCarEnv(this.renderer);
      if (env) dressCarEnv(model, env);
    }
    // 셰이더·텍스처를 미리 굽는다 — 안 하면 모델이 처음 그려지는 프레임에서 멈칫한다
    if (model) await this.warmUp(model);
    if (this.disposed) return;
    if (model) {
      this.carModel.useModel(model);
      // 눈높이만 모델에서 받는다 — 계기판·거울은 화면 HUD 로 옮겨 모델과 무관해졌다
      const anchors = model.userData.anchors as CarModelAnchors | null;
      if (anchors?.eye) {
        this.rig.setEyeHeight(anchors.eye.y);
        this.periph.setEyeHeight(anchors.eye.y);
      }
      // 이 차에서 좌석을 앞으로 당길 수 있는 한계는 앞유리를 재야 나온다
      this.seatLimit = seatForwardLimit(carSpec, anchors);
      this.applySeatOffset();
    }
    this.carModel.setSeatedVisible(true);
  }

  /**
   * 모델을 화면에 올리기 **전에** 셰이더와 텍스처를 GPU 에 올려 둔다.
   *
   * three 는 물체가 처음 그려지는 프레임에 그 재질의 셰이더를 컴파일한다. 차 한 대에 재질이
   * 수십 개라, 모델이 도착한 프레임에서 **수백 ms 가 한 번에 멈춘다** — "좋은 차를 고르면
   * 처음에 끊긴다" 가 이것이었다(콜벳·SL63 처럼 재질이 많은 모델일수록 심하다).
   *
   * `compileAsync` 는 컴파일을 프레임에 나눠 하고 끝날 때까지 기다려 준다. 아직 장면에
   * 넣지 않은 물체라도 **조명을 가져올 장면**을 함께 주면 실제와 같은 셰이더가 나온다.
   */
  private async warmUp(model: THREE.Object3D): Promise<void> {
    try {
      await this.renderer.compileAsync(model, this.rig.camera, this.world.scene);
    } catch {
      // 미리 굽기는 최적화일 뿐이다 — 실패해도 그냥 그리면 된다
    }
  }

  /** 차고에서 받은 좌석 조절값 (m). 모델이 오면 그 차의 한계로 한 번 더 조인다. */
  private seatOffset = 0;
  private seatLimit = SEAT_RANGE.max;

  /** 좌석 앞뒤 조절 — 메인 화면과 좌·우·후방 창이 같은 자리에서 봐야 한다 */
  setSeatOffset(meters: number): void {
    this.seatOffset = meters;
    this.applySeatOffset();
  }

  /**
   * 저장된 값이 이 차의 한계를 넘지 않게 조인다.
   *
   * 차고 슬라이더도 같은 한계로 좁혀 두지만, 저장본은 다른 차에서 쓰던 값일 수도 있고
   * 모델이 늦게 오면 그 사이에는 한계를 모른다. 카메라가 앞유리를 뚫는 것보다는
   * 조여 두는 편이 낫다.
   */
  private applySeatOffset(): void {
    const m = Math.min(this.seatOffset, this.seatLimit);
    this.rig.setSeatOffset(m);
    this.periph.setSeatOffset(m);
  }

  /*
    ── 부품 찍어보기 (임시 진단용) ────────────────────────────────────────────

    화면의 어떤 부분이 무슨 부품인지 **게임에게 직접 묻는다.** Alt(Option) 을 누른 채
    화면을 클릭하면 그 방향으로 광선을 쏴, 맞은 물체의 이름·재질·거리를 화면에 띄운다.

    모델 파일을 밖에서 분석해 추측하는 방식은 카메라 위치·화각·좌석 위치를 똑같이
    재현해야 맞아떨어지는데, 그게 어긋나면 엉뚱한 부품을 지목하게 된다(실제로 그랬다).
    화면에서 직접 찍는 편이 확실하다.

    진단이 끝나면 이 메서드와 호출부를 지운다.
  */
  private installPartProbe(canvas: HTMLCanvasElement): void {
    const raycaster = new THREE.Raycaster();
    // 실내는 전용 레이어에 있어 기본 광선에 안 잡힌다 — 모든 레이어를 본다
    raycaster.layers.enableAll();
    canvas.addEventListener('pointerdown', (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, this.rig.camera);
      const hits = raycaster.intersectObject(this.world.scene, true);
      const seen = new Set<string>();
      const lines: string[] = [];
      for (const h of hits) {
        const mesh = h.object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) continue;
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const name = `${mesh.name || '(이름없음)'} / ${mat?.name || '(재질없음)'}`;
        if (seen.has(name)) continue;
        seen.add(name);
        const transparent = (mat as THREE.MeshStandardMaterial)?.transparent ? '투명' : '불투명';
        /*
          **면 번호(faceIndex)** 를 함께 알린다. 이름만으로는 통짜 메시 안의 어느 부품인지
          알 수 없는데, 면 번호가 있으면 모델 파일에서 그 삼각형이 속한 덩어리를 정확히
          집어낼 수 있다. 이름·거리만으로 추측하다 여러 번 헛짚었다.
        */
        const face = h.faceIndex ?? -1;
        const p = h.point;
        lines.push(
          `${h.distance.toFixed(2)}m · ${transparent} · 면#${face} · ` +
            `점(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) · ${name}`,
        );
        if (lines.length >= 2) break;
      }
      const c = this.rig.camera;
      lines.push(
        `차종 ${this.carSpec.id} · 카메라(${c.position.x.toFixed(2)}, ${c.position.y.toFixed(2)}, ${c.position.z.toFixed(2)}) fov=${(c as THREE.PerspectiveCamera).fov.toFixed(0)}`,
      );
      const msg = lines.length > 0 ? lines.join('  ||  ') : '아무것도 맞지 않았습니다 (바깥이 보이는 방향)';
      console.log('[부품 찍기]', msg);

      /*
        **클립보드에 바로 넣는다.** 화면의 토스트를 눈으로 옮겨 적는 것보다 정확하고 빠르다
        (면 번호가 한 자리만 틀려도 엉뚱한 덩어리를 짚게 된다).
        클릭은 사용자 제스처라 권한 문제가 없고, localhost 는 보안 컨텍스트로 취급된다.
      */
      void navigator.clipboard
        .writeText(msg)
        .then(() => this.cb.onToast?.(`📋 복사됨 — ${msg}`))
        .catch(() => this.cb.onToast?.(`(복사 실패, 아래 내용을 직접 복사하세요) ${msg}`));
    });
  }

  // ── 구성 ─────────────────────────────────────────────────────────────────

  private buildSignals(): void {
    /*
      **보호구역 표지판과 단속 카메라는 코스와 상관없이 먼저 세운다.**

      예전에는 이 블록이 함수 끝에 있었는데, 사거리 없는 도로는 그 위에서 일찍 빠져나가(아래) **표지판도
      카메라도 세워지지 않았다** — 정작 보호구역만 달리는 코스에서 보호구역 표지가 없었다.
    */
    if (this.scenario.isSchoolZone || this.scenario.approachSchoolZone) this.buildSchoolZoneSigns();

    /*
      **사거리가 없는 보호구역 도로**는 교차로 신호등이 없다 — 지나는 횡단보도마다 자기 신호등이
      서거나(그 판이 정한 자리), 아예 서지 않는다. 신호기가 **없다는 사실 자체**가 이 판이 묻는
      것이므로(제27조 제7항), 없는 자리에는 아무것도 세우지 않는다.
    */
    if (this.scenario.drive === 'zoneOnly') {
      this.buildZoneRoadSignals();
      this.buildZoneSpeedCamera();
      return;
    }
    // 플레이어(남행 접근) 차량신호등 — 교차로 건너편(북측)에 지주를 세우고 팔을 도로 위로 뻗는다.
    // 등화는 플레이어 진입 차로(북행 2차로) 위에 오게 하고, 팔은 지주에서 거기까지 닿을 만큼 뻗는다.
    // (도로 폭이 바뀌면 둘 다 따라가야 한다 — 고정 길이로 두면 팔이 등화에 닿지 않는다)
    const poleX = -(ROAD_HALF_WIDTH + 1.5);
    const signalX = PLAYER_APPROACH_X - 0.3;
    const pole = makeSignalPole(signalX - poleX);
    pole.position.set(poleX, 0, -(CROSSWALK_OUTER + 1.2));
    this.world.scene.add(pole);

    // 렌즈는 로컬 +Z를 향하므로, 남쪽(+Z)에서 오는 플레이어가 보려면 회전을 주지 않아야 한다.
    // 이 상태에서 렌즈 순서(적·황·좌회전·녹)도 운전자 기준 왼쪽부터로 맞는다.
    //
    // 높이는 가로암 바로 아래에 매다는 방식으로 잡는다. 고정값(5.7m)으로 두면 등화를 키웠을 때
    // 배면판 윗변이 팔을 뚫고 올라간다 — 등화 크기가 바뀌어도 늘 팔에 매달려 있게 한다.
    const signalY = SIGNAL_ARM_Y - 0.09 - VEHICLE_SIGNAL_HALF_HEIGHT;
    this.vehicleSignal.group.position.set(signalX, signalY, -(CROSSWALK_OUTER + 1.2));
    this.world.scene.add(this.vehicleSignal.group);

    // 보행신호등. 설치되지 않은 횡단보도(어린이보호구역 시나리오)에는 아예 세우지 않는다.
    // 등화 아래에 지주가 보이도록, 하우징 절반 높이만큼 띄워 단다.
    const mid = (CROSSWALK_INNER + CROSSWALK_OUTER) / 2;
    const pedY = PED_SIGNAL_POLE_HEIGHT - PED_SIGNAL_HALF_HEIGHT * 0.55;
    if (this.scenario.pedSignalInstalled.A) {
      this.pedSignals.A = [];
      /*
        **A 신호등은 작게 단다** (TrafficLight.ts 의 PED_SIGNAL_SCALE_NEAR). 정지선 바로 옆이라
        크게 키울 이유가 없고, 먼 신호등과 같은 크기로 두었더니 오른쪽 A 신호등이 우회전 후
        횡단보도의 보행자를 가렸다.
      */
      const pedYNear =
        PED_SIGNAL_POLE_HEIGHT_NEAR - pedSignalHalfHeight(PED_SIGNAL_SCALE_NEAR) * 0.55;
      for (const sx of [1, -1]) {
        const s = new PedestrianSignal(PED_SIGNAL_SCALE_NEAR);
        s.group.position.set(sx * (ROAD_HALF_WIDTH + 1.0), pedYNear, mid);
        // 기본은 횡단보도 반대편 보행자를 향하고, 남쪽에서 오는 운전자도 읽을 수 있도록
        // +Z 쪽으로 조금 틀어 준다.
        s.group.rotation.y = sx > 0 ? -Math.PI / 2 + 0.55 : Math.PI / 2 - 0.55;
        this.world.scene.add(
          s.group,
          this.smallPole(sx * (ROAD_HALF_WIDTH + 1.0), mid, PED_SIGNAL_POLE_HEIGHT_NEAR),
        );
        this.pedSignals.A.push(s);
      }
    }
    /*
      **진입부 보호구역의 신호등.** 신호기가 있는 판에서만 세운다 — 없는 판에서는
      그 자리에 아무것도 없어야 한다. 신호기가 없다는 사실 자체가 이 판이 묻는
      것이기 때문이다 (제27조 제7항).

      차량신호등은 **횡단보도 건너편**(북쪽)에 세운다. 남쪽에서 오는 운전자가
      횡단보도 너머로 보게 되는 자리이고, 실제 단일 횡단보도 신호기도 그렇게 선다.
    */
    if (this.scenario.approachSchoolZone?.signal) {
      const zoneMid = (CROSSWALK_S_INNER + CROSSWALK_S_OUTER) / 2;
      /*
        **지주는 도로 밖에 세우고 등화만 차도 위로 내민다.**

        예전에는 지주를 등화 바로 아래(x = 8.4)에 세웠다 — 그 자리는 도로 안쪽,
        내가 달려오는 차로 위다. 3.6m 짜리 지주가 **차도 한복판에 박힌 것처럼** 보였고
        (등화가 2m 라 지주 끝이 등화 안에 묻혀, 등화만 노면에 떠 있는 것처럼도 보였다)
        차는 그 지주를 뚫고 지나갔다.

        교차로 신호등과 같은 방식으로 고친다 — 보도(11.3)에 지주를 세우고 **가로암**으로
        차로 위까지 뻗는다. 등화는 **2.2배**로 줄였다 (교차로는 3.0배 — TrafficLight.ts 의
        `ZONE_SIGNAL_SCALE`). 3.0배는 정지선에서 7.6m 앞인 이 자리에서 화면 위쪽을
        통째로 덮었다.

        **높이는 교차로를 따르지 않는다.** 교차로 신호등의 가로암은 7.2m 인데 정지선에서
        41m 앞이라 정면으로 들어온다. 이 횡단보도는 7.6m 앞이라 같은 높이에 달면 정지선에
        선 운전자에게 40° 위가 되어 화면 밖으로 나간다 (`ZONE_SIGNAL_ARM_Y` = 5.6m,
        등화 가운데 4.8m).
      */
      const zoneSignalZ = CROSSWALK_S_INNER - 1.6;
      /*
        등화는 **내가 달려오는 차로 위**에 온다 (교차로 신호등과 같은 자리 잡기).
        예전 자리(x = 8.4)는 차로의 오른쪽 끝이었는데, 배면판까지 4m 인 물건이라
        오른쪽 변이 보도까지 뻗어 **지주를 세울 자리가 없었다.**
      */
      const zoneSignalX = PLAYER_APPROACH_X;
      // 길 중간의 횡단보도라 좌회전할 곳이 없다 — 좌회전화살표 없는 3색등 (TrafficLight.ts)
      this.zoneSignal = new VehicleSignal(ZONE_SIGNAL_SCALE, false);
      this.zoneSignal.group.position.set(
        zoneSignalX,
        ZONE_SIGNAL_ARM_Y - 0.09 - ZONE_SIGNAL_HALF_HEIGHT,
        zoneSignalZ,
      );
      this.world.scene.add(
        this.zoneSignal.group,
        this.cantileverPole(ROAD_HALF_WIDTH + 1.5, zoneSignalZ, zoneSignalX, ZONE_SIGNAL_ARM_Y),
      );
      this.signalGantryZ.S = zoneSignalZ;

      this.pedSignals.S = [];
      for (const sx of [1, -1]) {
        const s = new PedestrianSignal();
        s.group.position.set(sx * (ROAD_HALF_WIDTH + 1.0), pedY, zoneMid);
        s.group.rotation.y = sx > 0 ? -Math.PI / 2 + 0.55 : Math.PI / 2 - 0.55;
        this.world.scene.add(s.group, this.smallPole(sx * (ROAD_HALF_WIDTH + 1.0), zoneMid));
        this.pedSignals.S.push(s);
      }
    }

    if (this.scenario.pedSignalInstalled.C) {
      this.pedSignals.C = [];
      for (const sz of [1, -1]) {
        const s = new PedestrianSignal();
        s.group.position.set(mid, pedY, sz * (ROAD_HALF_WIDTH + 1.0));
        s.group.rotation.y = sz > 0 ? Math.PI + 0.55 : -0.55;
        this.world.scene.add(s.group, this.smallPole(mid, sz * (ROAD_HALF_WIDTH + 1.0)));
        this.pedSignals.C.push(s);
      }
    }

    /*
      우회전신호등 — **정지선 옆 보도**에 세운다 (실물이 그 자리에 선다).

      건너편 가로등처럼 멀리 달면 운전자가 정면 차량신호등과 헷갈린다. 우회전을 판단하는
      바로 그 지점(정지선)에 서 있어야 "이 등화를 보고 우회전한다"가 성립한다.
    */
    if (this.scenario.rightArrowInstalled) {
      this.rightSignal = new RightTurnSignal();
      /*
        자리는 **교차로 앞 오른쪽 모서리 보도** — 실물이 서 있는 자리이면서, 정지선에
        멈춘 운전자가 고개를 돌리지 않고 볼 수 있는 유일한 자리다.
        정지선 바로 옆(z = 정지선 + 1m)에 세워 봤더니 멈춘 순간 **거의 90° 오른쪽**이라
        화면 밖으로 나갔다. 여기라면 정지선에서 11m 앞·오른쪽 20° 로 들어온다.

        **횡단보도 A 의 보행신호등(10.8, 16.8)과 시선이 겹친다.** 운전자에게서 보면 둘이
        거의 한 줄에 서므로, 가까운 보행신호등이 우회전신호등을 통째로 가렸다.
        그래서 지주를 5.6m 로 높여(보행신호등 3.6m) 그 머리 위로 올리고, 차도 쪽으로
        조금 당겨 각도도 벌린다.
      */
      const rx = ROAD_HALF_WIDTH + 0.6;
      const rz = ROAD_HALF_WIDTH + 2.2;
      this.rightSignal.group.position.set(rx, RIGHT_SIGNAL_POLE_HEIGHT - RIGHT_SIGNAL_HALF_HEIGHT, rz);
      // 렌즈는 로컬 +Z 를 보므로, 남쪽(+Z)에서 오는 운전자를 향하려면 그대로 두고
      // 도로 안쪽으로 조금만 틀어 준다
      this.rightSignal.group.rotation.y = 0.28;
      this.world.scene.add(this.rightSignal.group, this.smallPole(rx, rz, RIGHT_SIGNAL_POLE_HEIGHT));
    }

    this.buildZoneSpeedCamera();
  }

  /**
   * **과속 단속 카메라를 어디에 세울 것인가.**
   *
   * 카메라가 지키는 자리는 **보호구역 횡단보도**다 — 오는 길이 보호구역이면 그 길의 횡단보도(S),
   * 아니면 교차로 앞 횡단보도(A)이고, 사거리 없는 전용 도로에서는 그 자리가 가운데 횡단보도다.
   *
   * **그 횡단보도에 신호기가 서 있으면 같은 지주에 올린다** — 사용자가 실제 도로 사진을 주며
   * "사진처럼 단속카메라를 신호등과 같이 넣어 줘" 라고 했다. 실물의 이름부터가 그렇다:
   * 명판에 '**신호** 과속단속장비' 라고 적혀 있고, 신호위반과 과속을 한 장비가 함께 잰다.
   * 신호기가 없는 횡단보도에서는 잴 신호가 없으므로 '과속 단속장비' 한 대가 홀로 서고,
   * 자리도 정지선 10m 앞이다 (신호 갠트리는 횡단보도 건너편에 서기 때문에 기댈 지주가 없다).
   */
  private buildZoneSpeedCamera(): void {
    if (!this.scenario.isSchoolZone && !this.scenario.approachSchoolZone) return;
    const at: CrosswalkId = this.scenario.approachSchoolZone ? 'S' : 'A';
    const onSignal = this.signalGantryZ[at];
    if (onSignal !== undefined) {
      /*
        신호 갠트리와 **같은 지주 · 같은 자리**에 세우고, 팔만 신호 팔 위로 올린다.
        카메라 지주(굵은 각기둥)가 신호 지주(가는 원기둥)를 품어 하나로 보인다.
      */
      this.buildSpeedCamera(onSignal, {
        poleX: ROAD_HALF_WIDTH + 1.5,
        armY: ZONE_SIGNAL_ARM_Y + 1.5,
        withSignal: true,
      });
      return;
    }
    this.buildSpeedCamera((at === 'S' ? STOP_LINE_S : STOP_LINE) + 10);
  }

  /**
   * 짧은 가로암이 달린 지주 — 보도(`x`)에 세우고 팔을 차도 쪽(`reachX`)으로 뻗는다.
   *
   * 교차로 신호등의 `makeSignalPole` 과 같은 물건이지만, 그쪽은 도로를 통째로 건너는
   * 7.2m 짜리 가로등형이다. 진입부 보호구역의 단일 횡단보도에 그것을 세우면 실물보다
   * 크고, 정지선에서 7.6m 앞이라 서 있는 운전자의 화면 위로 벗어난다.
   */
  private cantileverPole(x: number, z: number, reachX: number, armY: number): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4c5057, roughness: 0.6, metalness: 0.5 });

    const height = armY + 0.1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, height, 8), mat);
    pole.position.set(x, height / 2, z);
    g.add(pole);

    // 팔은 지주에서 등화 자리까지 — 길이를 좌표에서 뽑는다.
    // 고정 길이로 두면 도로 폭이나 등화 자리가 바뀔 때 팔이 등화에 닿지 않는다
    const reach = x - reachX;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, reach, 8), mat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(x - reach / 2, armY, z);
    g.add(arm);

    return g;
  }

  /**
   * **사거리 없는 보호구역 도로의 신호등** — 횡단보도 셋 가운데 신호기가 있는 자리에만 세운다.
   *
   * 모양은 진입로 보호구역 신호등과 같다 (보도에 지주 · 가로암으로 차로 위까지 · 좌회전 없는 3색등) —
   * 실제 단일 횡단보도 신호기가 그렇게 서고, 학습자가 이미 그 모양을 안다. 신호기가 **없는 자리에는
   * 아무것도 세우지 않는다** — 없다는 사실 자체가 그 판이 묻는 것이다 (제27조 제7항).
   */
  private buildZoneRoadSignals(): void {
    const pedY = PED_SIGNAL_POLE_HEIGHT - PED_SIGNAL_HALF_HEIGHT * 0.55;
    for (const [id, near, far] of [
      ['S', CROSSWALK_S_OUTER, CROSSWALK_S_INNER],
      ['A', CROSSWALK_OUTER, CROSSWALK_INNER],
      ['B', CROSSWALK_B_INNER, CROSSWALK_B_OUTER],
    ] as const) {
      if (this.scenario.zoneSignals?.[id] === undefined) continue;
      const mid = (near + far) / 2;
      // 차량신호등은 **횡단보도 건너편**에 — 남쪽에서 오는 운전자가 횡단보도 너머로 보는 자리다
      const signalZ = far - 1.6;
      const signal = new VehicleSignal(ZONE_SIGNAL_SCALE, false);
      signal.group.position.set(
        PLAYER_APPROACH_X,
        ZONE_SIGNAL_ARM_Y - 0.09 - ZONE_SIGNAL_HALF_HEIGHT,
        signalZ,
      );
      this.world.scene.add(
        signal.group,
        this.cantileverPole(ROAD_HALF_WIDTH + 1.5, signalZ, PLAYER_APPROACH_X, ZONE_SIGNAL_ARM_Y),
      );
      this.zoneRoadSignals[id] = signal;
      this.signalGantryZ[id] = signalZ;

      this.pedSignals[id] = [];
      for (const sx of [1, -1]) {
        const p = new PedestrianSignal();
        p.group.position.set(sx * (ROAD_HALF_WIDTH + 1.0), pedY, mid);
        p.group.rotation.y = sx > 0 ? -Math.PI / 2 + 0.55 : Math.PI / 2 - 0.55;
        this.world.scene.add(p.group, this.smallPole(sx * (ROAD_HALF_WIDTH + 1.0), mid));
        this.pedSignals[id]!.push(p);
      }
    }
  }

  private smallPole(x: number, z: number, height = PED_SIGNAL_POLE_HEIGHT): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, height, 8),
      new THREE.MeshStandardMaterial({ color: 0x4c5057, roughness: 0.6, metalness: 0.5 }),
    );
    mesh.position.set(x, height / 2, z);
    return mesh;
  }

  /**
   * **과속 단속 카메라** — 어린이보호구역 횡단보도 앞에 선 주황색 갠트리.
   *
   * 사용자가 실제 사진을 주며 "사진과 같은 30km 단속 카메라도 달아서 실감나게 해 줘" 라고 했다.
   * 실물의 구성을 그대로 따른다 — 주황 지주 + 가로암, 노란 '과속 단속장비' 표지, 카메라 두 대,
   * 붉은 테 원형 30 표지와 파란 사각 30 표지, 그리고 태양광 패널.
   *
   * ## 왜 이것이 교육에 보탬이 되는가
   *
   * 보호구역의 30km/h 는 **단속이 실제로 따라붙는** 규정이다. 표지만 서 있는 길과 카메라가 달린 길은
   * 운전자가 받는 압박이 다르고, 그 압박이 현실의 보호구역에서 속도를 줄이게 만드는 것이기도 하다.
   * 이 게임에서 속도는 차가 알아서 조이므로(Vehicle.zoneTargetKmh) 카메라가 판정을 바꾸지는 않는다 —
   * **여기가 그런 구간이라는 것**을 눈으로 알리는 물건이다.
   *
   * 자리는 **보호구역 횡단보도 앞**이다 — 실물도 구간 아무 데나가 아니라 건너는 자리를 잰다.
   * 정지선 10m 앞이라 다가가면서 보면 횡단보도와 한 덩어리로 보이고, 정지선에 섰을 때는
   * 머리 위가 아니라 앞쪽 위에 있어 신호와 보행자를 가리지 않는다.
   */
  private buildSpeedCamera(
    z: number,
    mount: { poleX?: number; armY?: number; withSignal?: boolean } = {},
  ): void {
    const g = new THREE.Group();
    const orange = new THREE.MeshStandardMaterial({ color: 0xe0651f, roughness: 0.55, metalness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.5, metalness: 0.4 });
    const pale = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.5, metalness: 0.3 });
    /** 운전자를 향한 면 — 표지는 모두 이 면에 붙는다 (운전자는 +Z 쪽에서 온다) */
    const face = (w: number, h: number, tex: THREE.Texture): THREE.Mesh =>
      new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, side: THREE.DoubleSide }),
      );

    /*
      ── 지주와 가로암.

      사진에서 팔은 **네모난 굵은 보**다 — 가는 원기둥으로 뽑았더니 표지와 카메라를 붙일 면이
      없어 물건들이 허공에 뜬 것처럼 보였다. 지주도 보보다 굵다.
    */
    const poleX = mount.poleX ?? ROAD_HALF_WIDTH + 1.1;
    const armY = mount.armY ?? 5.4;
    const armDepth = 0.46;
    const armH = 0.56;
    /*
      팔은 **북행 두 차로를 모두 덮는다** (실물 갠트리가 그렇다). 짧게 뽑았더니 표지 둘과
      카메라와 명판이 한 자리에서 서로 겹쳐, 사진처럼 **왼쪽부터 카메라 · 명판 · 30 표지**로
      늘어놓을 길이가 나오지 않았다.
    */
    const armEndX = LANE_1_OFFSET - 1.1;
    const armLen = poleX - armEndX;
    const armMidX = (poleX + armEndX) / 2;

    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.44, armY + 0.7, 0.44), orange);
    pole.position.set(poleX, (armY + 0.7) / 2, z);
    g.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, armH, armDepth), orange);
    arm.position.set(armMidX, armY, z);
    g.add(arm);
    // 지주와 팔이 만나는 곳의 삼각 보강재 (사진의 사선 브래킷)
    const brace = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.12), orange);
    brace.position.set(poleX - 0.62, armY - 0.62, z);
    brace.rotation.z = Math.PI / 4;
    g.add(brace);

    /*
      ── 표지 둘은 **지주 쪽 끝**에 붙는다 (사진 그대로) — 붉은 테 원형 30 과 파란 사각 30.
      팔 높이만큼 크다. 앞면(+Z)에 살짝 띄워 붙여 보에 묻히지 않게 한다.
    */
    const signZ = z + armDepth / 2 + 0.03;
    const square = face(1.22, 1.22, this.speedSignTexture(true));
    square.position.set(poleX - 0.95, armY - 0.1, signZ);
    const round = face(1.34, 1.34, this.speedSignTexture(false));
    round.position.set(poleX - 2.4, armY + 0.05, signZ);
    g.add(square, round);

    /*
      ── 노란 명판 — 팔 앞면에 **붙어 있다** (매달린 것이 아니다).

      신호 갠트리에 같이 올린 것은 '**신호** 과속단속장비' 다 — 신호위반과 과속을 한 장비가
      함께 재기 때문이고, 실물 명판에도 그렇게 적혀 있다. 홀로 선 것은 '과속 단속장비' 다.
    */
    const plate = face(2.7, 0.46, this.gantryPlateTexture(mount.withSignal ?? false));
    plate.position.set(armEndX + 1.55, armY, signZ);
    g.add(plate);

    /*
      ── 카메라는 팔 **위에** 올라앉아 다가오는 차를 내려다본다. 사진에는 큰 단속 카메라와
      작은 보조 장비가 섞여 있으므로 크기를 달리해 둘·하나로 얹는다.
    */
    const camAt = (cx: number, s: number, mat: THREE.Material): void => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 0.34 * s, 0.7 * s), mat);
      body.position.set(cx, armY + armH / 2 + 0.17 * s, z);
      body.rotation.x = 0.3;
      // 햇빛 가리개 — 렌즈 위로 내민 차양
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.46 * s, 0.06 * s, 0.5 * s), mat);
      hood.position.set(cx, armY + armH / 2 + 0.33 * s, z + 0.2 * s);
      hood.rotation.x = 0.3;
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.14 * s, 0.24 * s, 12), dark);
      lens.rotation.x = Math.PI / 2 + 0.3;
      lens.position.set(cx, armY + armH / 2 + 0.11 * s, z + 0.4 * s);
      // 팔과 카메라를 잇는 짧은 목
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.16 * s, 0.1 * s), dark);
      neck.position.set(cx, armY + armH / 2 + 0.06 * s, z);
      g.add(body, hood, lens, neck);
    };
    // 왼쪽부터: 큰 단속 카메라 · (명판) · 보조 카메라 · 작은 장비 — 사진의 늘어선 차례 그대로
    camAt(armEndX + 0.35, 1.15, dark);
    camAt(poleX - 4.1, 0.95, pale);
    camAt(poleX - 3.35, 0.62, pale);

    /*
      ── 태양광 패널 — 사진에서는 지주 가까운 팔 위에 짧은 기둥으로 서서 남쪽(운전자 쪽)을
      보고 비스듬히 눕는다. 전원이 따로 없는 길에도 세울 수 있게 하는 물건이라, 이것이
      있어야 "길가에 세운 장비" 로 보인다.
    */
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), dark);
    mast.position.set(poleX - 0.55, armY + armH / 2 + 0.3, z);
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.05, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x1b2a4a, roughness: 0.32, metalness: 0.55 }),
    );
    panel.position.set(poleX - 0.55, armY + armH / 2 + 0.66, z + 0.06);
    panel.rotation.x = -0.5;
    g.add(mast, panel);

    this.world.scene.add(g);
  }

  /** 노란 단속장비 명판 — 팔 앞면에 붙는 가로 띠 */
  private gantryPlateTexture(withSignal: boolean): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 88;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f2c200';
    ctx.fillRect(0, 0, 512, 88);
    ctx.strokeStyle = '#6b3a12';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 506, 82);
    ctx.fillStyle = '#4a1d12';
    ctx.font = 'bold 58px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(withSignal ? '신호 과속단속장비' : '과속 단속장비', 256, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * 30 제한속도 표지 — 붉은 테 원형(법정 제한속도)과, 그것을 담은 파란 사각(보호구역 표시).
   * 사진에 둘이 나란히 붙어 있다: 둥근 것이 "여기 제한은 30", 파란 것이 "어린이보호구역이라 30".
   */
  private speedSignTexture(boxed: boolean): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const r = boxed ? 92 : 122;
    if (boxed) {
      ctx.fillStyle = '#12418f';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 8;
      ctx.strokeRect(6, 6, 244, 244);
    } else {
      ctx.clearRect(0, 0, 256, 256);
    }
    ctx.fillStyle = '#fbfbfb';
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d0342c';
    ctx.lineWidth = r * 0.26;
    ctx.beginPath();
    ctx.arc(128, 128, r * 0.87, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#17181a';
    ctx.font = `bold ${Math.round(r * 1.08)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('30', 128, 134);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  /** 어린이보호구역 표지판 — 시각적으로 바로 알 수 있어야 한다 */
  private buildSchoolZoneSigns(): void {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f5c518';
    ctx.beginPath();
    ctx.moveTo(128, 16);
    ctx.lineTo(240, 128);
    ctx.lineTo(128, 240);
    ctx.lineTo(16, 128);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#c8322a';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('어린이', 128, 118);
    ctx.fillText('보호구역', 128, 166);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(1.5, 1.5);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8 });

    /*
      **표지판은 구간이 시작하는 자리에 선다.**

      교차로가 보호구역이면 구역 경계(SCHOOL_ZONE_FAR_Z)와 우회전해 나가는 길에, 오는 길이
      보호구역이면 그 구간이 시작하는 자리(APPROACH_ZONE_FAR_Z)에 세운다.

      진입부 표지판을 빠뜨렸더니 **구간에 들어선 것을 알 방법이 노면 색뿐**이었다.
      운전석 시점에서 노면 색이 바뀌는 것은 발밑에서 일어나는 일이라, 앞을 보고 달리는
      사람에게는 어느 순간 이미 안에 들어와 있는 것으로 읽힌다 — "출발하자마자
      보호구역" 처럼 느껴진 이유의 절반이 이것이었다.

      구간이 시작하기 **2m 앞**에 세운다. 실물도 구역 경계에 서고, 표지판을 지나는 순간
      노면이 붉어지면 둘이 한 사건으로 읽힌다.
    */
    /*
      **표지판 앞면은 다가오는 운전자(+Z 쪽)를 본다 — 회전 없음.**

      한때 반 바퀴(π) 돌려 달아 앞면이 운전자 반대쪽을 봤다. 앞면만 그리는 재질이라 운전자에게는 **표지판 없이 기둥만**
      보였고, 그 기둥이 첫 횡단보도 모서리(z 26)에 서 있어 사용자가 짚었다: "보행자 신호등이 없을 때는 기둥도 없애 줘.
      기둥은 남아 있어서 보행자 신호등과 헷갈려." 기둥의 주인은 신호등이 아니라 이 표지판이었다. 이제 앞면이 운전자를
      보고, 뒤에서 볼 때는 회색 뒷판이 보인다 — 어느 쪽에서도 **빈 기둥**으로 읽히지 않는다.
    */
    /*
      **교차로 보호구역의 표지판도 구역이 시작하는 자리로 옮겼다.**

      교차로 양옆(z ±26)에 세웠을 때는 **구역 안 27m 지점**이었다. 노면은 z 52.8 에서 이미 붉어지는데
      표지판은 한참 뒤에 나타나, 운전자가 표지를 보고 들어가는 것이 아니라 들어온 뒤에 표지를 만났다.
      진입부 보호구역이 이미 쓰고 있는 규칙(구간 시작 2m 앞)을 여기에도 그대로 쓴다.

      북쪽(z -26) 표지판은 없앴다. 앞면이 +Z 를 보게 달려 있어 우회전하는 운전자에게도, 그대로 지나가는
      운전자에게도 **뒷판(회색)만** 보였다 — 서 있을 뿐 아무에게도 읽히지 않았다.
    */
    const spots: Array<[number, number, number]> = [];
    if (this.scenario.isSchoolZone) {
      spots.push([ROAD_HALF_WIDTH + 1.2, SCHOOL_ZONE_FAR_Z + 2, 0]);
      /*
        **우회전해 나가는 길에도 한 장.** 두 번째 횡단보도(제27조 제1항의 판단 자리)는 코너를 돈 뒤에
        있는데, 그쪽을 보는 표지판이 하나도 없었다. 동쪽으로 달리는 운전자의 오른쪽 보도에 세우고
        앞면이 -X(다가오는 운전자)를 보게 돌린다. 횡단보도 너머·끝선(FINISH_X) 앞이라 코너를 돌며
        횡단보도와 함께 눈에 들어온다.
      */
      spots.push([CROSSWALK_OUTER + 7.0, ROAD_HALF_WIDTH + 1.2, -Math.PI / 2]);
    }
    if (this.scenario.approachSchoolZone) {
      // 진입 차로 쪽(오른쪽 보도)에만 — 운전자가 보는 쪽이다
      spots.push([ROAD_HALF_WIDTH + 1.2, APPROACH_ZONE_FAR_Z + 2, 0]);
    }

    // 뒷판 — 마름모(텍스처 속 마름모와 같은 크기)를 회색으로. 실물 표지판도 뒤는 무늬 없는 금속판이다
    const backGeo = new THREE.PlaneGeometry(0.93, 0.93);
    const backMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.7, metalness: 0.3 });
    /*
      **표지판은 기둥보다 앞(운전자 쪽)에 단다.**

      표지판과 기둥을 같은 z 에 두었더니, 기둥(반지름 0.09m)이 표지판 한가운데를 세로로
      가려 '어린이 / 보호구역' 글자가 잘렸다 — 사용자가 짚은 그대로다. 실물 표지판도
      기둥에 브래킷으로 **앞으로 내밀어** 달린다. 뒷판은 그 사이에 끼워 뒤에서 볼 때도
      빈 기둥으로 보이지 않게 한다.
    */
    const SIGN_AHEAD = 0.16;
    /*
      **표지판 윗변이 기둥 꼭대기를 덮는 높이.** 2.8m 에 달았더니 마름모 꼭짓점이 3.46m 라 기둥
      (PED_SIGNAL_POLE_HEIGHT = 3.6m)이 그 위로 삐죽 나왔다 — 사용자가 짚었다: "표지판을 조금만
      위로 올려서 기둥을 가려 줘." 실물도 기둥이 표지판 뒤에서 끝난다.
    */
    const SIGN_Y = 3.0;
    for (const [x, z, rotY] of spots) {
      // 표지판을 '운전자 쪽으로 내미는' 방향도 표지판이 보는 방향을 따라간다
      const ax = Math.sin(rotY) * SIGN_AHEAD;
      const az = Math.cos(rotY) * SIGN_AHEAD;
      const sign = new THREE.Mesh(geo, mat);
      sign.position.set(x + ax, SIGN_Y, z + az);
      sign.rotation.y = rotY;
      const back = new THREE.Mesh(backGeo, backMat);
      back.position.set(x + ax * 0.875, SIGN_Y, z + az * 0.875);
      back.rotation.set(0, rotY + Math.PI, Math.PI / 4);
      this.world.scene.add(sign, back, this.smallPole(x, z));
    }
  }

  private buildPedestrians(): void {
    /*
      **같은 보도에 서는 사람에게는 서로 다른 자리를 준다.**

      보행자를 처음부터 보이게 두면서 필요해졌다 — 한 시나리오에서 같은 쪽 보도에 세 사람이
      서면 출발 전까지 몸이 포개진다. 어느 쪽 보도(crosswalk + from)인지로 묶어 순번을 센다.
    */
    const taken = new Map<string, number>();
    for (const spawn of this.scenario.pedestrians) {
      const curb = `${spawn.crosswalk}:${spawn.from}`;
      const slot = taken.get(curb) ?? 0;
      taken.set(curb, slot + 1);
      const p = new Pedestrian(spawn, slot);
      this.pedestrians.push(p);
      this.world.scene.add(p.group);
    }
  }

  private buildTraffic(): void {
    /*
      주변 차는 카탈로그 차 중에서 무작위로 뽑는다 (내가 탄 차는 뺀다 — npcVehicles.ts).

      다만 **한 판에 등장하는 차종을 몇 종으로 묶는다.** 무작위 시나리오는 NPC 가 최대
      아홉 대인데(교차 4 + 뒷차 1 + 정체 4) 전부 따로 뽑으면 큰 모델(SL63 7.6MB)을
      대여섯 개 받게 되어 출발이 늦고 받아 오는 동안 끊긴다.

      배역표를 짜는 규칙은 npcVehicles.ts 의 pickNpcRoster 에 있다 — 받아 둔 것을 먼저
      쓰되 **새 얼굴을 판마다 하나씩** 넣는다.
    */
    // 어린이보호구역이면 배경 차도 30km/h 이하로 다닌다 (제12조 제1항)
    const speedLimit = this.scenario.isSchoolZone ? SCHOOL_ZONE_KMH / 3.6 : Infinity;
    const roster = pickNpcRoster(this.carSpec.id, loadedCarIds(), NPC_ROSTER_SIZE);
    const cast = (): CarSpec => roster[Math.floor(Math.random() * roster.length)];

    const warm = (m: THREE.Object3D): Promise<void> => this.warmUp(m);
    /*
      **앞차와 뒷차는 코앞에 선다** — 앞차는 내 차 바로 앞, 뒷차는 후방 시야 창에 늘 떠 있다. 사용자가 짚었다:
      "뒤차도 눈에 가장 많이 띄는 부분이야. 내 뒤차의 품질도 모든 프리셋에서 좋게 해줘." 그래서 이 둘은 내 차와
      같이 화질 설정과 무관하게 반사를 보장한다 (carModel.ts 의 dressCarEnv). 스쳐 가는 배경 차는 설정대로 둔다.
    */
    const warmNear = async (m: THREE.Object3D): Promise<void> => {
      const env = this.world.nearCarEnv(this.renderer);
      if (env) dressCarEnv(m, env);
      await this.warmUp(m);
    };

    for (let i = 0; i < this.scenario.crossTraffic; i++) {
      const car = new TrafficCar('crossTraffic', i, cast(), undefined, speedLimit, warm);
      this.npcs.push(car);
      this.pending.push(car.ready);
      this.world.scene.add(car.group);
    }
    /*
      뒷차는 항상 한 대 — 정지선을 지킬 때의 심리적 압박을 재현한다.
      **경적은 판이 정한다** (`rearHonk`, 생략하면 울린다) — 재촉이 없는 판에서는 조용히 따라온다.
    */
    const follower = new TrafficCar(
      'follower',
      7,
      cast(),
      this.scenario.rearHonk === false
        ? undefined
        : () => {
            this.audio.horn();
            /*
              **세로 휴대폰에서는 글을 띄우지 않는다** (사용자가 정했다) — 좁은 화면에서 안내 상자가
              도로 한가운데를 덮어 정작 봐야 할 신호와 보행자를 가렸다. **경적 소리는 그대로 울린다** —
              재촉의 압박을 만드는 것은 소리이지 글이 아니다.
            */
            if (!this.handheld?.matches) {
              this.cb.onToast('뒷차가 경적을 울립니다. 그래도 규칙은 규칙입니다.');
            }
          },
      speedLimit,
      warmNear,
      spawnZ(this.scenario),
    );
    this.npcs.push(follower);
    this.pending.push(follower.ready);
    this.world.scene.add(follower.group);

    /*
      **앞차.** 차종은 다른 배경 차처럼 배역표에서 뽑는다. 출발 자리는 상태기계가 내 차의
      차간 시간으로 정하므로(leadDrive.ts 의 headway) 차 길이를 함께 넘긴다.
    */
    if (this.scenario.leadCar) {
      const spec = cast();
      this.lead = new LeadDrive(this.scenario.leadCar, {
        playerSpawnZ: spawnZ(this.scenario),
        playerHalfLength: this.carSpec.dims.length / 2,
        halfLength: spec.dims.length / 2,
        isSchoolZone: this.scenario.isSchoolZone,
        hasApproachZone: this.scenario.approachSchoolZone !== undefined,
        // 앞차는 내 차와 같은 속도표로 달린다 — 난이도가 올라도 간격이 그대로다 (leadDrive.ts 의 opts.pace)
        pace: this.pace,
      });
      this.leader = new TrafficCar('leader', 0, spec, undefined, speedLimit, warmNear);
      const pose = this.lead.pose();
      this.leader.setPose(pose.center.x, pose.center.z, pose.yaw, this.lead.speedMs);
      this.npcs.push(this.leader);
      this.pending.push(this.leader.ready);
      this.world.scene.add(this.leader.group);
    }

    if (this.scenario.exitBlocked) {
      for (let i = 0; i < 4; i++) {
        const jam = new TrafficCar('jam', i + 2, cast(), undefined, speedLimit, warm);
        this.npcs.push(jam);
        this.pending.push(jam.ready);
        this.world.scene.add(jam.group);
      }
    }
  }

  // ── 루프 ─────────────────────────────────────────────────────────────────

  /**
   * **모든 준비가 끝날 때까지 기다린다.** 주행을 시작하기 전에 한 번 부른다.
   *
   * 예전에는 준비를 흘려보내고 바로 달렸다. 그래서 모델이나 환경맵이 도착하는 프레임마다
   * 멈칫했는데, 하필 그 시점이 정지선 앞이면 판단해야 할 순간에 화면이 멈춘다.
   * 조건이 복잡한 판(08번)일수록 받아 올 것이 많아 더 심했다.
   *
   * 마지막의 통째 컴파일이 요점이다. 모델 하나하나는 warmUp 이 미리 구웠지만, 노면·신호등·
   * 보행자·빗줄기처럼 **장면을 만들면서 생긴 재질**은 아무도 굽지 않았다. 시나리오마다
   * 구성이 달라(비·야간·어린이보호구역) 그 조합의 셰이더는 그 판에서 처음 나온다.
   *
   * 실패는 삼킨다 — 준비는 최적화일 뿐이라, 못 받은 것이 있어도 절차적 차체와 기본 조명으로
   * 주행은 그대로 된다.
   */
  async prepare(): Promise<void> {
    await Promise.allSettled(this.pending);
    this.pending = [];
    if (this.disposed) return;
    try {
      /*
        **숨어 있는 것까지 굽는다.**

        three 의 compile 은 `traverseVisible` 로 훑는다 — 지금 보이지 않는 물체는 건너뛴다.
        그런데 이 게임에서 나중에 나타나는 것들(정지선 안내 띠, 좌·우·후방 시야 창)이야말로
        주행 중에 처음 그려지는 것들이라, 그대로 두면 나타나는 프레임에서 멈칫한다.
        (실제로 교차로에 다가가 시야 창이 떠오르는 지점에서 한 번 끊겼다)

        그래서 잠깐 전부 켜 두고 구운 뒤 원래대로 되돌린다. 루프가 아직 돌지 않으므로
        화면에 보이지는 않는다.
      */
      const hidden: THREE.Object3D[] = [];
      this.world.scene.traverse((o) => {
        if (!o.visible) {
          hidden.push(o);
          o.visible = true;
        }
      });
      await this.renderer.compileAsync(this.world.scene, this.rig.camera);
      // 시야 창은 렌더 타깃에 그리므로 셰이더가 한 벌 더 필요하다 — 그것까지 미리 굽는다
      this.periph.prewarm(this.renderer);
      for (const o of hidden) o.visible = false;
    } catch {
      // 미리 굽기는 최적화일 뿐이다
    }
  }

  start(): void {
    if (this.disposed) return;
    this.cluster.setVisible(true);
    // 계기판이 화면에 자리를 잡은 뒤라야 후방 창을 그 옆에 붙일 수 있다
    this.resize();
    /*
      시동음은 **여기서** 낸다 — 판이 실제로 시작되는 순간이다. 준비 화면(prepare)
      에서 내면 모델을 읽는 동안 소리만 먼저 나고, 일시정지에서 풀 때(resumeRun)
      내면 판마다 여러 번 시동이 걸린다.
    */
    this.audio.engineStart();
    this.running = true;
    // 해상도 '자동' — 재는 것은 판이 실제로 시작된 뒤부터다 (준비하는 동안의 느림은 모델 읽기 때문이다)
    if (this.graphics.resolution === 'auto') {
      const target = this.graphics.frameCap > 0 ? this.graphics.frameCap : 60;
      this.autoRes = new AutoResolution(target, this.renderScale, performance.now());
    }
    this.lastFrame = performance.now();
    this.loop();
  }

  pause(): void {
    this.running = false;
    this.audio.silenceEngine();
  }

  resumeRun(): void {
    if (this.finished || this.disposed) return;
    this.running = true;
    this.lastFrame = performance.now();
  }

  /**
   * **손에 든 세로 화면에서는 시간이 절반으로 흐른다** (사용자가 정했다).
   *
   * 화면의 화살표 버튼은 키보드보다 느리고 뭉툭하다 — 같은 판이 휴대폰에서는 훨씬 어려웠다.
   * 판을 쉽게 만드는 대신 **시간을 늦춘다**: 보고 판단할 틈이 두 배가 되지만, 무엇을 봐야 하는지와
   * 무엇이 위반인지는 그대로다. 쉬운 판을 따로 만들면 휴대폰으로 익힌 습관이 실제 도로와 달라진다.
   *
   * 한 곳(`dt`)에서만 곱한다 — 차 · 보행자 · 앞차 · 신호 · 제한시간이 모두 `dt` 를 따라가므로
   * 여기만 줄이면 **모두 같은 비율로** 느려진다. 어느 하나만 늦추면 판정이 어긋난다.
   *
   * **계기판의 숫자는 그대로다** (사용자가 정했다) — 차가 느려지는 것이 아니라 시간이 천천히 흐른다.
   *
   * 조건은 화면 규칙(index.html 의 '손에 든 세로 화면')과 **같다.** 가로로 돌리면 곧바로 제 속도로
   * 돌아온다 — `matches` 는 볼 때마다 지금 값을 준다.
   */
  private readonly handheld =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(orientation: portrait) and (pointer: coarse) and (max-width: 720px)')
      : null;

  /**
   * 늦추는 정도는 **3분의 1**이다 — 원래 속도의 2/3.
   *
   * 처음에는 절반(0.5)으로 뒀는데 사용자가 직접 몰아 보고 "너무 느리다" 고 했다.
   * 판단할 틈은 벌어지되 **달리는 맛이 남아야** 한다 — 너무 느리면 그것대로 실제 도로와 멀어진다.
   */
  private paceScale(): number {
    return this.handheld?.matches ? 2 / 3 : 1;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    // 탭 전환 등으로 프레임이 크게 벌어지면 물리가 튀므로 상한을 둔다
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000) * this.paceScale();
    this.lastFrame = now;

    if (this.running && !this.finished) this.step(dt);

    /*
      **프레임 상한.**

      `requestAnimationFrame` 은 화면 주사율을 따라간다 — 120Hz 화면에서는 초당 120번
      그린다. 이 게임은 60fps 면 충분한데 두 배를 그리는 셈이라, 발열과 배터리를 그만큼
      쓴다. 상한을 걸면 물리(step)는 그대로 돌고 **그리는 것만** 건너뛴다.
      (물리까지 건너뛰면 판정이 프레임 수에 따라 달라진다)
    */
    if (this.graphics.frameCap > 0) {
      const interval = 1000 / this.graphics.frameCap;
      /*
        **10% 여유를 둔다.** 딱 맞춰 재면 화면 주사율의 눈금과 어긋나 한 번씩 더 걸러진다 —
        120Hz 에서 60 으로 묶었더니 57 이 나왔다. rAF 는 8.33ms 눈금으로만 오므로,
        문턱을 조금 낮춰 두 번째 눈금(16.67ms)이 확실히 통과하게 한다.
      */
      if (now - this.lastDraw < interval * 0.9) return;
      this.lastDraw = now;
    }
    this.fps.sample(now);

    /*
      **그림자는 한 프레임에 한 번만 굽는다.**

      three 는 `render()` 를 부를 때마다 그림자 맵을 다시 그린다. 그런데 이 게임은 한
      프레임에 두 번 그린다 — 시야 창(렌더 타깃) 한 장, 그리고 메인 화면. 그대로 두면
      2048×2048 그림자 패스가 두 번 돈다.

      **시야 창이 떠오르는 순간 프레임 비용이 갑자기 두 배가 되는 것**이 남아 있던 멈칫함의
      정체다. 그림자 맵은 카메라와 무관하게 태양 기준으로 구우므로 두 번 구울 이유가 없다 —
      프레임의 첫 렌더에서 한 번 굽고, 나머지 렌더는 그것을 그대로 쓴다.
      (autoUpdate 를 끄고 needsUpdate 로 직접 정한다. 켜 두면 render 마다 다시 굽는다)
    */
    this.renderer.shadowMap.needsUpdate = true;
    this.periph.renderTargets(this.renderer);
    this.renderer.render(this.world.scene, this.rig.camera);
    this.periph.renderOverlay(this.renderer);

    // 해상도 '자동' — 느린 것이 이어지면 한 단계 낮춘다 (그린 프레임으로 잰다)
    const next = this.autoRes?.frame(now);
    if (next != null && next !== this.renderScale) {
      this.renderScale = next;
      this.resize();
    }
  };

  /**
   * AI 가 볼 세계 — **판정 엔진에 넘기는 것과 같은 출처의 값**만 담는다.
   *
   * 여기서만 알 수 있는 정보(다음 신호가 언제 바뀌는지 등)를 넘기지 않는다. 사람이
   * 화면을 보고 알 수 있는 것만으로 운전해야 '정답 주행'이 될 수 있다.
   *
   * 보행자 표본은 이 프레임의 갱신(아래 `p.update`) 전 값이라 한 프레임 뒤처지는데,
   * 16ms 라 판단이 달라지지 않는다.
   */
  private autoState(phase: SignalPhase, exitBlocked: boolean): AutoDriveState {
    const front = this.vehicle.front;
    return {
      x: this.vehicle.x,
      z: this.vehicle.z,
      yaw: this.vehicle.yaw,
      frontX: front.x,
      frontZ: front.z,
      speedKmh: this.vehicle.speedKmh,
      stopHold: this.stopHold,
      vehicleLight: phase.vehicle,
      rightArrow: this.scenario.rightArrowInstalled ? phase.rightArrow : null,
      pedSignal: {
        A: this.scenario.pedSignalInstalled.A ? phase.pedA : null,
        // B 는 A 와 같은 도로를 가로지른다 — 같은 등화, 같은 설치 여부 (lawRules.ts 의 signalCrosswalk)
        B: this.scenario.pedSignalInstalled.A ? phase.pedA : null,
        C: this.scenario.pedSignalInstalled.C ? phase.pedC : null,
        S: this.schoolZonePhase()?.ped ?? null,
      },
      approachZone: this.scenario.approachSchoolZone
        ? { light: this.schoolZonePhase()?.vehicle ?? null }
        : null,
      /*
        **사거리 없는 보호구역 도로의 횡단보도별 등화** (drive: 'zoneOnly') — 운전자(AI)와 판정이
        같은 값을 본다. 자리가 없으면 그 횡단보도에는 신호기가 없다.
      */
      ...(this.scenario.drive === 'zoneOnly'
        ? {
            zoneLights: Object.fromEntries(
              Object.entries(this.zoneRoadPhases()).map(([id, ph]) => [id, ph.vehicle]),
            ) as Partial<Record<CrosswalkId, LightColor>>,
          }
        : {}),
      pedestrians: this.pedestrians.map((p) => p.sample()),
      exitBlocked,
      isSchoolZone: this.scenario.isSchoolZone,
      lead:
        this.lead && !this.lead.gone
          ? { gap: this.lead.gapFrom(front.x, front.z), speedKmh: this.lead.speedKmh }
          : null,
    };
  }

  /**
   * **진입부 어린이보호구역의 지금 등화.** 구간이 없거나 신호기가 없으면 `null`.
   *
   * 교차로 주기와 따로 돈다 (scenarios.ts 의 SCHOOL_ZONE_PROGRAM). `null` 은 두 가지를
   * 함께 뜻하는데 — 구간 자체가 없거나, 있는데 신호기가 없거나 — 부르는 쪽이 그 둘을
   * `approachSchoolZone` 의 유무로 이미 가르므로 여기서는 하나로 둔다.
   */
  private schoolZonePhase(): SchoolZonePhase | null {
    const zone = this.scenario.approachSchoolZone;
    if (!zone?.signal) return null;
    return phaseAt(SCHOOL_ZONE_PROGRAM, 0, zone.signalElapsed ?? 0, this.elapsed);
  }

  /**
   * **사거리 없는 보호구역 도로의 횡단보도별 등화** (drive: 'zoneOnly').
   *
   * 자리마다 주기가 따로 돈다 (scenarios.ts 의 zoneSignals) — 신호기가 없는 자리는 값이 없고,
   * 그 '없음' 이 곧 제27조 제7항의 자리다.
   */
  private zoneRoadPhases(): Partial<Record<CrosswalkId, SchoolZonePhase>> {
    const out: Partial<Record<CrosswalkId, SchoolZonePhase>> = {};
    for (const [id, offset] of Object.entries(this.scenario.zoneSignals ?? {})) {
      out[id as CrosswalkId] = phaseAt(SCHOOL_ZONE_PROGRAM, 0, offset, this.elapsed);
    }
    return out;
  }

  private currentPhase(): SignalPhase {
    return phaseAt(
      STANDARD_PROGRAM,
      this.scenario.startPhase,
      this.scenario.startPhaseElapsed,
      this.elapsed,
    );
  }

  private step(dt: number): void {
    this.elapsed += dt;
    const phase = this.currentPhase();
    /*
      진출로 정체는 **입력을 정하기 전에** 알아야 한다 — AI 가 꼬리물기를 피하려면
      정지선에 닿기 전에 막혀 있는지를 봐야 하기 때문이다. (아래 NPC 갱신도 같은 값을 쓴다)
    */
    const exitBlocked = this.scenario.exitBlocked && this.elapsed < JAM_CLEAR_SECONDS;
    const input = this.auto ? this.auto.decide(this.autoState(phase, exitBlocked)) : this.controls.read();

    // ── 차량 ──
    // 앞차 간격은 **지난 프레임** 앞차 자리로 잰다 — 앞차는 아래에서 보행자를 본 뒤에 움직인다
    const leadNow =
      this.lead && !this.lead.gone
        ? {
            gap: this.lead.gapFrom(this.vehicle.front.x, this.vehicle.front.z),
            speedMs: this.lead.speedMs,
          }
        : null;
    this.vehicle.update(input, dt, leadNow);
    this.carModel.group.position.set(this.vehicle.x, 0, this.vehicle.z);
    this.carModel.group.rotation.y = this.vehicle.yaw;
    this.carModel.spinWheels(this.vehicle.travel(dt));
    this.carModel.setSteer(-this.vehicle.steerAngle);

    // ── 등화 ──
    this.blinkPhase = (this.blinkPhase + dt) % BLINK_PERIOD;
    const blinkOn = input.rightSignal && this.blinkPhase < BLINK_PERIOD / 2;
    if (blinkOn !== this.lastBlinkOn) {
      if (input.rightSignal) this.audio.blinkerTick(blinkOn);
      this.lastBlinkOn = blinkOn;
    }
    /*
      깜빡이는 주기를 **한 곳에서 만들어 셋에 나눠 준다** — 차체 등화·계기판 화살표·소리.
      각자 세면 같은 순간에 서로 다른 상태가 되어 화면과 소리가 어긋난다.
      (차체 등화는 후방·상공 시점에서만 보인다 — CarMesh 의 setTurnSignal 주석 참고)
    */
    this.carModel.lights.setTurnSignal(blinkOn);
    this.carModel.lights.setBrake(this.vehicle.braking);
    const headlightsOn = this.world.isNight || this.world.isWet;
    this.carModel.lights.setHeadlights(headlightsOn);

    // ── 신호등 ──
    /*
      **사거리 없는 보호구역 도로는 횡단보도마다 자기 주기를 돈다** (drive: 'zoneOnly').
      교차로 신호등은 세우지도 않았으므로 건드리지 않는다.
    */
    const roadPhases = this.scenario.drive === 'zoneOnly' ? this.zoneRoadPhases() : null;
    if (roadPhases) {
      for (const [id, ph] of Object.entries(roadPhases) as [CrosswalkId, SchoolZonePhase][]) {
        this.zoneRoadSignals[id]?.set(ph.vehicle, dt);
        for (const p of this.pedSignals[id] ?? []) p.set(ph.ped, dt);
      }
    } else {
      this.vehicleSignal.set(phase.vehicle, dt);
      for (const s of this.pedSignals.A ?? []) s.set(phase.pedA, dt);
      for (const s of this.pedSignals.C ?? []) s.set(phase.pedC, dt);
    }
    // 진입부 보호구역은 자기 주기를 돈다 (교차로 주기와 무관하다)
    const zone = this.schoolZonePhase();
    if (zone) {
      this.zoneSignal?.set(zone.vehicle, dt);
      for (const s of this.pedSignals.S ?? []) s.set(zone.ped, dt);
    }
    this.rightSignal?.set(phase.rightArrow);

    // ── 보행자 ──
    const front = this.vehicle.front;
    const carMoving = this.vehicle.speedKmh > 1.5;
    const zonePhase = this.schoolZonePhase();
    const roadPhasesNow = this.scenario.drive === 'zoneOnly' ? this.zoneRoadPhases() : null;
    for (const p of this.pedestrians) {
      /*
        **횡단보도마다 자기 신호를 본다.**

        예전에는 'A 냐 아니냐' 둘로만 갈라, **진입로 보호구역 횡단보도(S)의 사람이 교차로의 C
        보행신호를 보고** 건널지 말지를 정했다. 그 둘은 아예 다른 신호기다 — S 는 교차로 주기와
        따로 도는 보호구역 신호기이고(SCHOOL_ZONE_PROGRAM), 교차로에서 한참 앞에 있다.

        조용히 어긋나는 종류의 버그였다: 타입은 맞고(셋 다 CrosswalkId), 화면 없이 달려 보는
        검증기는 **처음부터 제 신호를 보고 있어서**(scenarios/playSim.ts 의 pedSignal) 검증은
        통과하는데 실제 게임에서만 사람이 엉뚱한 때에 건넜다.
      */
      // 사거리 없는 도로에서는 그 횡단보도의 보호구역 신호를 본다 (위 zoneRoadPhases)
      const signal = roadPhasesNow
        ? (roadPhasesNow[p.crosswalk]?.ped ?? null)
        : pedSignalFor(p.crosswalk, {
            intersection: { pedA: phase.pedA, pedC: phase.pedC },
            installed: this.scenario.pedSignalInstalled,
            zonePed: zonePhase?.ped ?? null,
          });
      /*
        코앞까지 온 교차 통행 차량이 있으면 그 사람은 한 발 기다린다 (TrafficCar 주석 참고).

        **A 에는 이 규칙을 두지 않는다.** A 를 가로지르는 배경 차는 뒷차 하나뿐인데, 뒷차는
        내 바로 뒤에 붙어 오므로 거의 늘 '코앞'에 있다. 여기서 기다리게 하면 보행자가 내가
        지나갈 때까지 보도에 서 있게 되어, 03·04번처럼 **A 를 건너는 사람을 보여 주는 것이
        목적인 시나리오가 통째로 성립하지 않는다.** 뒷차 쪽에서 서는 것으로 충분하다
        (TrafficCar 의 pedOnEntryCrosswalk).
      */
      /*
        **앞차는 어느 횡단보도에서나 센다.** 교차 통행 차량과 달리 앞차는 A 도 C 도 지나가고,
        내 바로 뒤에 붙는 뒷차와 달리 사람이 그 앞으로 나서면 실제로 부딪힌다.
      */
      const trafficBusy =
        (p.crosswalk === 'C' && this.npcs.some((n) => n.blocksExitCrosswalk)) ||
        (this.lead?.blocksCrosswalk(p.crosswalk) ?? false);
      p.update(this.elapsed, dt, signal, front, carMoving, trafficBusy, {
        leadInWay: this.lead?.inWayOf(p.crosswalk) ?? false,
        carSpeedMs: this.vehicle.speedKmh / 3.6,
      });
    }

    // ── NPC ──
    // 플레이어가 적색일 때 교차 방향(동서)에 통행권이 있다
    const crossHasGreen = phase.vehicle === 'red' && phase.name.startsWith('동서');
    /*
      **횡단보도 C 위에 사람이 있으면 교차 통행 차량도 선다.**

      동서 도로를 달리는 차는 교차로를 지난 뒤 횡단보도 C 를 가로지른다. 03번처럼 보행자가
      신호와 무관하게 건너는 판에서는 그 사람들 사이로 NPC 가 아슬아슬하게 지나갔다 —
      "사람이 있으면 선다" 를 가르치는 화면에서 배경 차가 그러고 있으면 안 된다.

      **기준은 플레이어가 판정받는 것과 글자 그대로 같다** — `intendsToCross`,
      즉 제27조 제1항의 "통행하고 있거나 **통행하려고 하는** 때" 다.

      한때는 `state === 'crossing'`(이미 차도에 발을 디딘 사람)만 봤다. 그러면 배경 차가
      **사람이 내려서고 나서야** 감속을 시작한다 — 12m/s 로 달리는 차는 편안히 서는 데
      40m 가 필요한데 그때는 이미 코앞이라, 보행자 바로 앞에서 급정거하는 그림이 됐다.
      보도에서 건너려고 서 있는 사람을 보고 미리 줄이는 것이 실제 운전이고 법이다.

      **서로 기다리는 교착은 나지 않는다.** 보행자가 차 앞으로 나서지 않는 조건
      (TrafficCar 의 blocksExitCrosswalk)은 **달리는 차**만 세므로, 차가 서면 사람이 건넌다.
    */
    const pedOnExitCrosswalk = this.pedestrians.some((p) => {
      const s = p.sample();
      return s.crosswalk === 'C' && s.intendsToCross && s.onConflictPath;
    });
    /*
      **횡단보도 A 위에 사람이 있으면 뒷차도 선다.**

      뒷차는 내 뒤를 따라오다가 내가 지나간 뒤 같은 횡단보도를 건넌다. 앞차(나)만 보고
      달리면, 내가 지나간 다음에 걸어 나온 사람은 아무도 보지 않는 셈이 된다 —
      08번처럼 신호를 지키지 않는 보행자가 나오는 판에서 그대로 밀고 갔다.
      기준은 교차 통행 차량과 같다: **건너는 중이고 아직 차도 위에 있는 사람.**
    */
    const pedOnEntryCrosswalk = this.pedestrians.some((p) => {
      const s = p.sample();
      return s.crosswalk === 'A' && s.intendsToCross && s.onConflictPath;
    });
    /* 진입부 보호구역 횡단보도도 같은 기준으로 본다 — 뒷차가 그 길을 지난다 */
    const pedOnSchoolZoneCrosswalk = this.pedestrians.some((p) => {
      const s = p.sample();
      return s.crosswalk === 'S' && s.intendsToCross && s.onConflictPath;
    });
    // ── 앞차 ── 판정에 넘기는 것과 같은 출처의 값으로 굴린다 (검증기와 같은 상태기계)
    if (this.lead && this.leader) {
      this.lead.update(dt, {
        vehicleLight: phase.vehicle,
        rightArrow: this.scenario.rightArrowInstalled ? phase.rightArrow : null,
        pedSignal: {
          A: this.scenario.pedSignalInstalled.A ? phase.pedA : null,
          B: this.scenario.pedSignalInstalled.A ? phase.pedA : null,
          C: this.scenario.pedSignalInstalled.C ? phase.pedC : null,
          S: zone?.ped ?? null,
        },
        approachZone: this.scenario.approachSchoolZone ? { light: zone?.vehicle ?? null } : null,
        pedestrians: this.pedestrians.map((p) => p.sample()),
        exitBlocked,
        isSchoolZone: this.scenario.isSchoolZone,
      });
      const pose = this.lead.pose();
      this.leader.setPose(pose.center.x, pose.center.z, pose.yaw, this.lead.speedMs);
      // 진출로 끝까지 빠져나간 앞차는 감춘다 (충돌 판정도 그 자리에서 멀어 걸리지 않는다)
      this.leader.group.visible = !this.lead.gone;

      const gap = this.lead.gapFrom(front.x, front.z);
      if (Number.isFinite(gap) && gap > -this.carSpec.dims.length) {
        this.minLeadGap = Math.min(this.minLeadGap, gap);
        /*
          **추돌하기 전에 한 번 알린다.** 이 게임에서 속도는 자동이라 사람이 하는 일은
          "언제 설 것인가" 뿐인데, 앞차 뒤에서는 그 판단의 근거가 신호가 아니라 앞차다.
          처음 겪는 사람은 신호등만 보다 추돌한다 — 한 번은 말해 준다. 두 번째부터는 스스로 본다.
        */
        const closing = this.vehicle.speedKmh - this.lead.speedKmh;
        if (!this.leadWarned && gap < 3.5 && closing > 3 && this.vehicle.speedKmh > 5) {
          this.leadWarned = true;
          this.cb.onToast('앞차와 너무 가깝습니다. 앞차가 서면 나도 서야 합니다.');
        }
      }
    }

    const crossCars = this.npcs.filter((n) => n.role === 'crossTraffic');
    for (const npc of this.npcs) {
      // 같은 방향 앞차 — 보행자 앞에 설 때 한 자리에 겹치지 않게 (TrafficCar 주석 참고)
      let aheadGap = Infinity;
      let aheadSpeed = 0;
      if (npc.role === 'crossTraffic') {
        for (const other of crossCars) {
          const gap = other.posX - npc.posX;
          if (gap > 0 && gap < aheadGap) {
            aheadGap = gap;
            aheadSpeed = other.speedMs;
          }
        }
      }
      npc.update(dt, {
        crossHasGreen,
        jamCleared: !exitBlocked,
        pedOnExitCrosswalk,
        pedOnEntryCrosswalk,
        pedOnSchoolZoneCrosswalk,
        aheadGap,
        aheadSpeed,
        player: { x: this.vehicle.x, z: this.vehicle.z, speedKmh: this.vehicle.speedKmh },
        headlightsOn,
      });
    }

    // ── 판정 ──
    if (this.vehicle.speedKmh <= 0.5) this.stopHold += dt;
    else this.stopHold = 0;

    const sample: WorldSample = {
      t: this.elapsed,
      frontX: front.x,
      frontZ: front.z,
      centerX: this.vehicle.x,
      centerZ: this.vehicle.z,
      speedKmh: this.vehicle.speedKmh,
      rightSignalOn: input.rightSignal,
      vehicleLight: phase.vehicle,
      // 우회전 신호등은 국내 설치가 드물어 시나리오에서 쓰지 않는다.
      // 판정 엔진에는 규정이 남아 있어 필요하면 다시 켤 수 있다.
      // 우회전신호등은 설치된 시나리오에서만 값을 준다 (미설치는 null)
      rightArrow: this.scenario.rightArrowInstalled ? phase.rightArrow : null,
      pedSignal: {
        A: this.scenario.pedSignalInstalled.A ? phase.pedA : null,
        // B 는 A 와 같은 도로를 가로지른다 — 같은 등화, 같은 설치 여부 (lawRules.ts 의 signalCrosswalk)
        B: this.scenario.pedSignalInstalled.A ? phase.pedA : null,
        C: this.scenario.pedSignalInstalled.C ? phase.pedC : null,
        S: this.schoolZonePhase()?.ped ?? null,
      },
      approachZone: this.scenario.approachSchoolZone
        ? { light: this.schoolZonePhase()?.vehicle ?? null }
        : null,
      /*
        **사거리 없는 보호구역 도로의 횡단보도별 등화** (drive: 'zoneOnly') — 운전자(AI)와 판정이
        같은 값을 본다. 자리가 없으면 그 횡단보도에는 신호기가 없다.
      */
      ...(this.scenario.drive === 'zoneOnly'
        ? {
            zoneLights: Object.fromEntries(
              Object.entries(this.zoneRoadPhases()).map(([id, ph]) => [id, ph.vehicle]),
            ) as Partial<Record<CrosswalkId, LightColor>>,
          }
        : {}),
      // id 는 배열 순서 — 판정기가 같은 보행자의 발자국을 이어 붙이는 데 쓴다
      pedestrians: this.pedestrians.map((p, i) => ({ ...p.sample(), id: i })),
      exitBlocked,
      isSchoolZone: this.scenario.isSchoolZone,
      // 자전거횡단도가 있는 횡단보도 — 판정이 조문을 가르는 데 쓴다 (rules/lawRules.ts)
      bikeLane: this.scenario.bikeLane,
      // 어린이보호구역 가중은 낮(08~20시)에만 붙는다 — 밤 시나리오는 일반도로와 같다
      isDaytime: this.scenario.timeOfDay !== 'night',
      // 앞차 뒤에 줄 서서 선 것은 정지선 일시정지로 치지 않는다 (lawRules.ts)
      queuedBehind: this.lead?.queuesAhead(front.x, front.z) ?? false,
    };
    this.judge.update(sample, dt);

    this.checkCollisions();
    this.checkEnd(front);

    /*
      **내 차 표시** — 앞차와 헷갈리는 것은 후방 시점뿐이라 거기서만 켠다 (PlayerMarker.ts).
    */
    this.myCarMarker.update(
      this.vehicle.x,
      this.vehicle.z,
      this.vehicle.yaw,
      this.rig.mode === 'chase',
    );

    // ── 연출 ──
    if (this.vehicle.braking && this.vehicle.speedKmh > 25) this.rig.addShake(dt * 1.2);
    this.audio.updateEngine(this.vehicle.speedKmh, !this.vehicle.braking, this.vehicle.braking);
    this.rig.update(this.vehicle, dt);
    this.periph.update(this.vehicle, dt);
    // 벡터를 재사용한다 — 매 프레임 새로 만들면 그 쓰레기를 치우느라 언젠가 한 번 멈칫한다
    this.world.update(dt, this.scratch.set(this.vehicle.x, 0, this.vehicle.z));

    const snapshot = this.buildSnapshot(phase, input.rightSignal, blinkOn, sample);
    // 계기판은 HUD 와 같은 값을 쓴다 — 화면 표시와 계기가 어긋나면 안 된다
    this.cluster.update({
      speedKmh: snapshot.speedKmh,
      blinkerOn: snapshot.blinkerVisible,
      stopHold: snapshot.stopHold,
      stopDone: snapshot.stop.satisfied,
      stopRequired: snapshot.stop.required,
      // 말풍선과 같은 함수를 본다 — 한 화면이 같은 상황을 두 이름으로 부르지 않게 (stopReason.ts)
      signalWait: isSignalWait({
        target: snapshot.stop.target,
        advice: snapshot.advice,
        zoneLight: snapshot.zoneLight,
      }),
    });
    this.stopMarkers.update(snapshot.stop, dt);
    this.cb.onSnapshot(snapshot);
  }

  /**
   * 이번 판의 앞차 — 결과 화면 · AI 코치 · 습관 기록이 쓴다. 앞차가 없는 판은 `null`.
   *
   *  - `skippedStops` — 앞차가 **서지 않고 지나간** 일시정지 자리 (나쁜 본보기가 실제로 나왔는가)
   *  - `minGap` — 내 앞범퍼와 앞차 뒷범퍼가 가장 가까웠던 간격 (m)
   */
  get leadReport(): LeadReport | null {
    if (!this.lead) return null;
    return {
      behavior: this.lead.behavior,
      skippedStops: [...this.lead.skippedStops],
      minGap: Number.isFinite(this.minLeadGap) ? this.minLeadGap : -1,
    };
  }

  /** 플레이어 차체 사각형 */
  private get playerObb(): Obb {
    return {
      x: this.vehicle.x,
      z: this.vehicle.z,
      yaw: this.vehicle.yaw,
      halfL: this.carSpec.dims.length / 2,
      halfW: this.carSpec.dims.width / 2,
    };
  }

  /** 차량 로컬 좌표계로 옮겨 직사각형 판정을 한다 (원 판정보다 훨씬 정확하다) */
  private toCarLocal(px: number, pz: number): { x: number; z: number } {
    const dx = px - this.vehicle.x;
    const dz = pz - this.vehicle.z;
    const c = Math.cos(-this.vehicle.yaw);
    const s = Math.sin(-this.vehicle.yaw);
    return { x: dx * c + dz * s, z: -dx * s + dz * c };
  }

  private checkCollisions(): void {
    const { length: L, width: W } = this.carSpec.dims;

    for (const p of this.pedestrians) {
      if (!p.group.visible) continue;
      const local = this.toCarLocal(p.group.position.x, p.group.position.z);
      if (Math.abs(local.x) < W / 2 + 0.28 && Math.abs(local.z) < L / 2 + 0.22) {
        this.audio.crash();
        this.judge.fail('PEDESTRIAN_HIT');
        this.end();
        return;
      }
    }

    // 차량끼리는 두 차체 사각형이 실제로 겹칠 때만 충돌로 본다.
    // NPC를 원으로 근사하면 5m 길이의 차가 반지름 1.2m 원이 되어,
    // 옆 차로를 나란히 지나가는 것만으로도 충돌 판정이 나 버린다.
    const me = this.playerObb;
    for (const npc of this.npcs) {
      if (npc.role === 'follower') continue; // 뒷차는 알아서 간격을 유지한다
      if (obbOverlap(me, npc.obb)) {
        this.audio.crash();
        this.judge.fail('VEHICLE_COLLISION');
        this.end();
        return;
      }
    }
  }

  private checkEnd(front: { x: number; z: number }): void {
    /*
      **코스마다 빠져나가는 쪽이 다르다** (scenarios.ts 의 `drive`).

       - 우회전 코스 — 동쪽으로 빠져나가면 완주, 북쪽으로 지나쳐 버리면 "우회전하지 않았다"
       - 직진 코스(어린이보호구역 연습편) — 북쪽으로 빠져나가면 완주, 동쪽으로 돌면 "직진 코스다"

      두 코스가 서로의 **완주 조건과 실패 조건을 정확히 맞바꾼 꼴**이라, 한쪽만 고치면
      직진 코스가 완주하는 순간 "우회전하지 않았습니다" 로 끝나 버린다.
    */
    if (this.straight) {
      if (front.z < FINISH_Z) {
        this.judge.markCompleted();
        this.end();
        return;
      }
      if (front.x > CROSSWALK_OUTER + 14) {
        this.cb.onToast('우회전했습니다. 이 코스는 어린이보호구역 직진 연습입니다.');
        this.end();
        return;
      }
    } else {
      if (front.x > FINISH_X) {
        this.judge.markCompleted();
        this.end();
        return;
      }
      // 직진해서 교차로를 지나쳐 버린 경우
      if (front.z < -(CROSSWALK_OUTER + 22)) {
        this.cb.onToast('우회전하지 않고 직진했습니다.');
        this.end();
        return;
      }
    }
    // 좌회전해 버린 경우
    if (front.x < -(CROSSWALK_OUTER + 14)) {
      this.cb.onToast(
        this.straight
          ? '좌회전했습니다. 이 코스는 어린이보호구역 직진 연습입니다.'
          : '좌회전했습니다. 이 시나리오는 우회전 연습입니다.',
      );
      this.end();
      return;
    }
    // 두 도로 회랑(남북·동서) 어느 쪽에도 속하지 않으면 도로를 벗어난 것이다.
    // 연석을 살짝 물고 가는 정도는 봐준다.
    const TOLERANCE = 1.5;
    const onNorthSouth = Math.abs(this.vehicle.x) <= ROAD_HALF_WIDTH + TOLERANCE;
    const onEastWest = Math.abs(this.vehicle.z) <= ROAD_HALF_WIDTH + TOLERANCE;
    if (!onNorthSouth && !onEastWest) {
      this.judge.fail('OFF_ROAD');
      this.end();
      return;
    }
    if (this.elapsed > RUN_TIMEOUT) {
      this.judge.fail('TIMEOUT');
      this.end();
    }
  }

  private end(): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    this.audio.silenceEngine();
    const result = this.judge.finish();
    const lead = this.leadReport;
    if (lead) result.lead = lead;
    this.audio.chime(result.grade === 'PERFECT' || result.grade === 'PASS');
    this.cb.onFinish(result);
  }

  private buildSnapshot(
    phase: SignalPhase,
    rightSignalOn: boolean,
    blinkOn: boolean,
    sample: WorldSample,
  ): GameSnapshot {
    return {
      speedKmh: this.vehicle.speedKmh,
      stop: this.stopStatus(sample),
      phase,
      rightSignalOn,
      blinkerVisible: blinkOn,
      view: this.rig.mode,
      rightArrow: this.scenario.rightArrowInstalled ? phase.rightArrow : null,
      // 신호기가 있는 진입로 보호구역 횡단보도의 등화 — 화면이 '신호 대기' 와 '일시정지' 를 가려 말한다
      zoneLight: this.currentZoneLight(),
      elapsed: this.elapsed,
      stopHold: this.stopHold,
      advice: this.advise(sample),
      pedCue: this.pedCue(sample),
      leadCue: this.leadCue(),
      fps: this.fps.fps,
      renderScale: this.renderScale,
    };
  }

  /**
   * **지금 겨누는 보호구역 횡단보도의 차량 등화** — 화면이 '신호 대기' 와 '일시정지' 를 가려 말하는 데 쓴다
   * (game/stopReason.ts). 신호기가 없으면 null 이고, 그때가 일시정지 의무 자리다 (제27조 제7항).
   */
  private currentZoneLight(): LightColor | null {
    if (this.scenario.drive === 'zoneOnly') {
      const at = this.nextZoneCrosswalk();
      return at ? (this.zoneRoadPhases()[at]?.vehicle ?? null) : null;
    }
    return this.scenario.approachSchoolZone?.signal ? (this.schoolZonePhase()?.vehicle ?? null) : null;
  }

  /** 앞차가 건너뛴 일시정지 자리 중 내가 아직 지나지 않은 곳 (GameSnapshot.leadCue) */
  private leadCue(): GameSnapshot['leadCue'] {
    if (!this.lead) return null;
    const skipped = this.lead.skippedStops;
    const prog = this.judge.progress;
    if (skipped.includes('S') && !prog.enteredCrosswalkS) return 'S';
    if (skipped.includes('A') && !prog.enteredCrosswalkA) return 'A';
    return null;
  }

  /** 내 앞 횡단보도의 보행자 움직임 — 판단은 pedCue.ts 가 한다 (화면 없이 테스트하려고 떼어 냈다) */
  private pedCue(s: WorldSample): GameSnapshot['pedCue'] {
    return pedCueAt(s, this.scenario.approachSchoolZone !== undefined);
  }

  /**
   * **사거리 없는 보호구역 도로에서 지금 겨누는 횡단보도** — 아직 들어서지 않은 첫 곳.
   *
   * 판정(lawRules.ts 의 trackZoneRoad)이 세는 것과 같은 값을 본다. 화면이 따로 세면 판정은
   * 세 번째를 보는데 화면은 두 번째를 말하는 어긋남이 생긴다.
   */
  private nextZoneCrosswalk(): 'S' | 'A' | 'B' | null {
    const entered = this.judge.progress.zoneEntered;
    return (['S', 'A', 'B'] as const).find((id) => !entered[id]) ?? null;
  }

  /**
   * 지금 지켜야 할 정지 지점과 그 이행 여부.
   * 이 게임의 채점 기준이라 화면(HUD·노면 표시)에서 가장 눈에 띄어야 한다.
   */
  private stopStatus(s: WorldSample): StopStatus {
    const prog = this.judge.progress;
    const advice = this.advise(s);
    const beforeIntersection = s.frontZ > INTERSECTION_HALF;

    /*
      **사거리 없는 보호구역 도로는 횡단보도 셋을 차례로 겨눈다** (scenarios/zoneCourse.ts).

      아래 가지들은 사거리 맵을 기준으로 쓰여 있다 — 진입로(S) · 교차로 정지선(A) · 우회전 후(C).
      전용 도로에 그대로 대면 첫 번째와 세 번째가 어느 가지에도 걸리지 않아, **노면 띠가 뜨지 않고**
      말풍선도 엉뚱한 신호를 보고 말한다. 두 번째만 정지선 좌표가 우연히 같아 맞았을 뿐이다.
    */
    if (this.scenario.drive === 'zoneOnly') {
      const at = this.nextZoneCrosswalk();
      if (!at) return { required: false, satisfied: false, distance: -1, target: 'zone' };
      const stopLine = ZONE_ROAD_EDGES[at].stopLine;
      return {
        required: advice === 'stop',
        satisfied: prog.zoneStopped[at],
        distance: s.frontZ - stopLine,
        target: 'zone',
        bandZ: stopLine,
      };
    }

    // 진입부 보호구역 횡단보도(S) 앞 — 교차로 정지선보다 먼저 만난다 (advise 와 같은 경계)
    if (s.approachZone && !prog.enteredCrosswalkS && s.frontZ > CROSSWALK_S_OUTER) {
      return {
        required: advice === 'stop',
        satisfied: prog.stoppedBeforeS,
        distance: s.frontZ - STOP_LINE_S,
        target: 'zone',
      };
    }

    if (beforeIntersection) {
      return {
        required: advice === 'stop',
        satisfied: prog.stoppedBeforeA,
        distance: s.frontZ - STOP_LINE,
        target: 'line',
      };
    }
    // 코너를 도는 중에는 x 좌표만으로 거리를 못 재므로 가로·세로 합으로 근사한다
    const remaining =
      Math.max(0, CROSSWALK_INNER - s.frontX) + Math.max(0, s.frontZ - PLAYER_EXIT_Z);
    return {
      required: advice === 'stop',
      satisfied: prog.stoppedBeforeC,
      distance: prog.enteredCrosswalkC ? -1 : remaining,
      target: 'crosswalk',
    };
  }

  /**
   * 지금 진행해도 되는지에 대한 힌트. 정답을 알려주는 것이 목적이 아니라,
   * 디브리핑에서 "왜 그때 멈춰야 했나"를 되짚을 수 있게 하는 학습 보조 표시다.
   */
  private advise(s: WorldSample): 'stop' | 'yield' | 'go' {
    const prog = this.judge.progress;
    const pedBlocking = (id: CrosswalkId) =>
      s.pedestrians.some((p) => p.crosswalk === id && p.intendsToCross && p.onConflictPath);

    /*
      **진입부 어린이보호구역 횡단보도(S)가 먼저다** — 교차로보다 앞(z 46~50)에 있다.

      예전에는 이 판단이 교차로 정지선과 우회전 후 횡단보도만 봤다. 그래서 보호구역
      빨간불 앞에 서 있는데도 "서행 진행" 이 떠 있었다 — 작은 알약일 때는 눈에 덜 띄었는데,
      AI 코치가 말풍선으로 크게 말하게 되자 곧바로 드러났다.

      규칙은 판정(lawRules.ts)과 같다 — 신호기가 있으면 **녹색이 될 때까지 서서 기다리고**
      (적색은 "정지 후 진행" 이 아니다), 없으면 보행자 유무와 무관하게 **일시정지**한다
      (제27조 제7항). 건너려는 사람이 있으면 어느 쪽이든 선다.
    */
    /*
      **사거리 없는 보호구역 도로** — 지금 겨누는 횡단보도 하나만 보고 말한다 (stopStatus 와 같은 가지).
      규칙은 판정(lawRules.ts 의 trackZoneRoad)과 같다: 신호기가 있으면 **녹색이 될 때까지 기다리고**,
      없으면 보행자 유무와 무관하게 **일시정지**한다 (제27조 제7항). 건너려는 사람이 있으면 어느 쪽이든 선다.
    */
    if (this.scenario.drive === 'zoneOnly') {
      const at = this.nextZoneCrosswalk();
      if (!at) return 'go';
      if (s.frontZ > ZONE_ROAD_EDGES[at].stopLine + this.stopAdviceLead) return 'go';
      if (pedBlocking(at)) return 'stop';
      const light = s.zoneLights?.[at] ?? null;
      if (light !== null) return light === 'green' ? 'go' : 'stop';
      return prog.zoneStopped[at] ? 'go' : 'stop';
    }

    if (s.approachZone && !prog.enteredCrosswalkS && s.frontZ > CROSSWALK_S_OUTER) {
      const nearLineS = s.frontZ <= STOP_LINE_S + this.stopAdviceLead;
      if (nearLineS) {
        if (pedBlocking('S')) return 'stop';
        const light = s.approachZone.light;
        if (light !== null && light !== 'green') return 'stop';
        if (light === null && !prog.stoppedBeforeS) return 'stop';
      }
      return 'go';
    }

    if (s.frontZ > INTERSECTION_HALF) {
      // 정지 안내는 정지선에 다가왔을 때만 띄운다.
      // 적색이라고 50m 전부터 "정지"를 띄우면 실제 운전과 어긋나고,
      // 그 자리에 멈춰 봐야 정지선 앞 정지로 인정되지도 않는다.
      const nearStopLine = s.frontZ <= STOP_LINE + this.stopAdviceLead;

      if (nearStopLine && pedBlocking('A')) return 'stop';
      // 제25조 제5항 — 진출로가 막혀 있으면 신호와 무관하게 진입하지 않는다
      if (nearStopLine && s.exitBlocked && !prog.enteredIntersection) return 'stop';
      /*
        **우회전 신호등이 있으면 그것이 정면 차량신호등을 대체한다** (시행규칙 [별표 2] 비고 제3호).

        적색 화살표는 원형 적색과 달리 **정지 후 진행이 아니라 진행 불가**다 — 녹색 화살표가
        될 때까지 안내를 풀지 않는다. 다만 이미 횡단보도에 들어가 버렸다면(위반은 이미
        기록됐다) 안내를 풀어 준다. 그러지 않으면 차가 멈춘 채 판이 끝나지 않는다.
      */
      if (s.rightArrow !== null) {
        if (!nearStopLine) return 'go';
        if (s.rightArrow === 'greenArrow') return 'go';
        return prog.enteredCrosswalkA ? 'go' : 'stop';
      }
      if (s.vehicleLight === 'red' || s.vehicleLight === 'redFlash') {
        if (!nearStopLine) return 'go';
        return prog.stoppedBeforeA ? 'go' : 'stop';
      }
      // 이미 횡단보도에 진입해 버렸다면 정지 기회는 지나갔다. 계속 '정지'로 붙잡아 두면
      // 안내가 영원히 풀리지 않아 차가 멈춰 선 채 갇힌다. 위반은 이미 판정에 기록돼 있다.
      if (
        nearStopLine &&
        s.isSchoolZone &&
        s.pedSignal.A === null &&
        !prog.stoppedBeforeA &&
        !prog.enteredCrosswalkA
      ) {
        return 'stop';
      }
      return 'go';
    }

    // 여기까지 왔다면 이미 교차로 안이고, 다음에 만날 것은 횡단보도 C다.
    // 코너를 도는 중이므로 남은 거리를 가로·세로 합으로 근사해, 횡단보도에
    // 다가왔을 때 안내가 뜨도록 한다. 교차로에 들어서자마자 띄우면
    // 횡단보도에서 13m 떨어진 곳에 멈춰 버린다.
    const remainingToC =
      Math.max(0, CROSSWALK_INNER - s.frontX) + Math.max(0, s.frontZ - PLAYER_EXIT_Z);
    if (
      prog.enteredIntersection &&
      s.frontX < CROSSWALK_OUTER &&
      remainingToC <= EXIT_ADVICE_LEAD
    ) {
      if (pedBlocking('C')) return 'stop';
      if (
        s.isSchoolZone &&
        s.pedSignal.C === null &&
        !prog.stoppedBeforeC &&
        !prog.enteredCrosswalkC
      ) {
        return 'stop';
      }
      return 'yield';
    }
    return 'go';
  }

  // ── 외부 조작 ─────────────────────────────────────────────────────────────

  cycleView(): void {
    const mode = this.rig.cycle();
    this.setOverlaysVisible(mode);
    this.cb.onViewChange(mode);
  }

  setView(mode: ViewMode): void {
    this.rig.setMode(mode);
    this.setOverlaysVisible(mode);
    this.cb.onViewChange(mode);
  }

  /**
   * 화면 위에 얹는 보조 표시 — **시점과 무관하게 늘 켠다.**
   *
   * 예전에는 좌·우·후방 창과 계기판을 운전석 시점 전용으로 뒀다. 운전석에 앉아야 의미가
   * 있는 장치라고 봤기 때문인데, 실제로는 반대였다 — 이 창들이 답하는 질문(저쪽 끝에
   * 사람이 남아 있나 · 뒤차가 얼마나 붙었나 · 지금 깜빡이가 켜져 있나)은 **어느 시점에서
   * 보든 똑같이 필요한 판정 정보**다. 시점을 바꿨다고 사라지면 그걸 확인할 방법이 없어진다.
   *
   * 창은 화면 좌표에 붙는 오버레이(전용 직교 카메라)라 주 카메라가 어디에 있든 같은 자리에
   * 나온다. 뜨고 지는 조건도 그대로다 — 교차로에 다가갈 때만 떠오른다(panelStrengthAt).
   *
   * **다만 화질 설정이 이것을 되돌릴 수 있다.** 시야 창은 렌더 타깃 한 장을 더 그리는
   * 일이라, 켜고 끄며 재 보면 프레임당 드로우콜의 **약 10~12%(47콜)** 다.
   *
   *   항상            지금까지의 동작 — 어느 시점에서나
   *   운전자 시점에서만  기본값. 후방·상공에서는 주변이 이미 화면에 다 보이므로,
   *                   **학습 가치를 하나도 잃지 않고** 그 시점에서만 아낀다
   *   끄기            어디서도 그리지 않는다
   *
   * **세로 휴대폰은 예외다 — 시점도 화질도 가리지 않고 켠다** (사용자가 정했다).
   *
   * 손에 든 세로 화면은 가로 화각이 더 좁아, 이 창이 풀려던 문제(횡단보도 양 끝이 화면
   * 밖으로 밀려난다 — PeripheralView.ts 의 실측 좌 78° · 우 67°)가 **PC 보다 심하다.**
   * 게다가 휴대폰에는 시점 전환 버튼이 없어 운전석 시점으로 갈 방법이 없고, 화질이 낮게
   * 잡히면 아예 꺼진다. 그대로 두면 "저쪽에 사람이 남아 있나" 를 확인할 길이 없어져,
   * 이 게임이 가르치려는 판단(제27조 보행자 보호) 자체를 못 하게 된다 —
   * **프레임보다 판단이 먼저다.**
   *
   * 위에서 내려다보는 시점(`top`)만 뺀다. 거기서는 주변이 이미 화면에 다 보인다.
   */
  private setOverlaysVisible(mode: ViewMode): void {
    const want =
      this.graphics.peripheral === 'always' ||
      (this.graphics.peripheral === 'driverOnly' && mode === 'driver') ||
      (this.handheld?.matches === true && mode !== 'top');
    this.periph.setEnabled(want);
    this.cluster.setVisible(true);
  }

  look(dx: number, dy: number): void {
    this.rig.look(dx, dy);
  }

  recenterLook(): void {
    this.rig.recenter();
  }

  /** 좌우 확인 — 고개를 돌려 횡단보도 끝까지 본다 */
  setGlance(dir: -1 | 0 | 1): void {
    this.rig.setGlance(dir);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    // 화면 배율(최대 2) × 렌더 해상도 — 창을 옮기면(외장 모니터 ↔ 노트북) 화면 배율이 달라지므로 매번 다시 잰다
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
    this.renderer.setSize(w, h, false);
    this.rig.resize(w / h);
    this.periph.resize(w, h);
    /*
      **화면을 돌리면 시야 창도 다시 판단한다.** 세로일 때만 켜는 규칙이 생겼으므로,
      가로로 돌렸는데 세로의 판단이 그대로 남아 있으면 안 된다 (그 반대도 같다).
    */
    this.setOverlaysVisible(this.rig.mode);
  }

  /** 결과 화면에서 교차로 전체를 보여주기 위해 */
  showTopView(): void {
    this.cluster.setVisible(false);
    this.rig.setMode('top');
    this.periph.setEnabled(false);
  }

  get scenarioSpec(): ScenarioSpec {
    return this.scenario;
  }

  /**
   * 출발 자리 — 차를 만들 때 쓴 것과 **같은 값**이다.
   *
   * 한때 이 게터만 있고 아무도 부르지 않았다. 차는 `Vehicle` 의 필드 기본값(68m)에서
   * 출발했고, 진입부 보호구역 판에서 뒤로 물린 자리가 화면에 반영되지 않았다 —
   * 지금은 생성자가 이 값을 받으므로 갈릴 수가 없다.
   */
  get spawnInfo(): { x: number; z: number } {
    return { x: PLAYER_APPROACH_X, z: spawnZ(this.scenario) };
  }

  get exitLaneZ(): number {
    return PLAYER_EXIT_Z;
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    for (const p of this.pedestrians) p.dispose();
    for (const n of this.npcs) n.dispose();
    this.vehicleSignal.dispose();
    for (const list of Object.values(this.pedSignals)) {
      for (const s of list ?? []) s.dispose();
    }
    this.rightSignal?.dispose();
    this.stopMarkers.dispose();
    this.myCarMarker.dispose();
    this.periph.dispose();
    this.cluster.dispose();
    this.carModel.dispose();
    this.intersection.dispose();
    this.world.dispose();
    // 렌더러는 버리지 않는다 — 다음 판이 그대로 이어 쓴다 (renderer.ts)
  }
}
