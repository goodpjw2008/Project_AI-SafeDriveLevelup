/**
 * 카메라 시점 3종. C 키로 순환한다.
 *
 *  - driver : 운전석 눈높이. 본넷이 시야에 들어오고, 우측 횡단보도를 보려면
 *             실제처럼 고개를 돌려야(마우스/터치 드래그) 한다. 학습 효과가 가장 크다.
 *             후방 상황은 화면의 미러 패널로 확인한다(Mirrors.ts).
 *  - chase  : 차 뒤 상공. 차량 궤적과 정지선 관계를 보기 좋다.
 *  - top    : 교차로 전체 부감. 실패했을 때 무엇이 잘못됐는지 보여주기에 좋다.
 */

import * as THREE from 'three';
import { LANE_2_OFFSET, STOP_LINE, STOP_LINE_S } from '../layout';
import type { CarSpec } from '../economy/cars';
import { DRIVER_HIDDEN_LAYER, INTERIOR_LAYER, PLAYER_CAR_LAYER, driverEyeLocal } from './CarMesh';
import { clampSeatOffset } from './carModel';

export type ViewMode = 'driver' | 'chase' | 'top';

/**
 * 카메라가 차에서 읽는 값만 추린 것.
 *
 * 주행 중에는 Vehicle 이 그대로 들어오고, 좌석 맞추기 화면(SeatPreview)은 **세워 둔 차**를
 * 이 모양으로 만들어 넘긴다 — 그 화면에는 주행 물리가 없다.
 */
export interface CameraTarget {
  x: number;
  z: number;
  yaw: number;
  speedKmh: number;
  /** 회전 각속도 (rad/s) — 코너에서 시선을 미리 돌리는 데 쓴다 */
  yawRate: number;
  /** 전방 단위벡터 (전방이 -Z) */
  forward: { x: number; z: number };
}

const VIEW_ORDER: ViewMode[] = ['driver', 'chase', 'top'];

/**
 * 회전 각속도(rad/s) 1 당 시선이 회전 방향으로 돌아가는 각 (rad).
 *
 * 실제 운전자는 우회전하며 자연스럽게 오른쪽을 본다. 다만 이 시선을 **조향각**에
 * 물려 두면 화면이 출렁인다. 조향각은 키를 놓는 순간 되돌아오는 값이라
 *
 *   - 코너에서 핸들을 감았다 풀 때마다 시선이 좌우로 밀렸다 돌아오고
 *   - 바퀴를 꺾은 채 정지하면(횡단보도 C 앞) 시선이 돌아간 채 굳었다가 홱 되돌아온다
 *
 * 그래서 **실제 회전 각속도**에 물린다. 차가 서 있으면 각속도가 0이라 시선도 정면이고,
 * 각속도는 속도를 거쳐 나오는 값이라 그 자체로 부드럽다.
 *
 * 크기도 줄였다. 원래는 화각 밖(우 67°)의 횡단보도 끝을 이 회전으로 겨우 끌어오려 했는데,
 * 지금은 좌·우 시야 창(PeripheralView)이 그 역할을 하므로 시선은 코너링 느낌만 내면 된다.
 * 서행(12km/h) 최대 조향에서 각속도가 약 0.88rad/s 이므로 13° 남짓 돌아간다.
 */
const CORNER_LOOK_GAIN = 0.26;

/** 코너 시선의 최대 각 (rad ≒ 14°). 빠른 속도로 꺾어도 이 이상은 돌지 않는다. */
const CORNER_LOOK_MAX = 0.25;

/** 좌우 확인(글랜스) 키를 눌렀을 때 고개를 돌리는 각 (rad ≒ 54°) */
const GLANCE_ANGLE = 0.95;

/**
 * 기본 시선이 수평보다 내려가는 양 — 14m 앞에서의 높이차(m).
 *
 * 0.85m 면 약 3.5° 다. 값의 내력:
 *
 *   0.85m (3.5°) → 화각을 74°에서 90°로 넓히자 발밑 노면이 너무 많이 담겨 0.34m (1.4°) 로
 *   올렸다. 그런데 이번에는 **화면 위쪽을 차 천장(헤드라이너)이 덮었다** — 특히 실내가
 *   검은 차(M5 CS)에서 두드러졌다. 천장은 모델에서 잘라낼 수 없는 부품이라(잘라 보니
 *   지붕과 필러가 뜯겼다) 시선을 내려 화면 밖으로 밀어내는 편이 안전하다.
 *
 *   0.60m (2.5°) 를 거쳐 **0.85m 로 되돌렸다.** 발밑 노면이 조금 늘지만, 그 자리는
 *   대부분 보닛과 대시보드가 차지하고 있어 실제로 잃는 정보가 없다.
 *   반면 위쪽은 신호등·보행자가 있는 곳이라 트여야 한다.
 */
const GAZE_DROP = 0.85;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: ViewMode = 'driver';

  /** 고개 돌리기 (rad). 운전석 시점에서만 쓴다. */
  private lookYaw = 0;
  private lookPitch = 0;
  private targetLookYaw = 0;
  private targetLookPitch = 0;

  /** 조향·글랜스에 따른 시선 오프셋 (rad). 음수가 우측. */
  private lookLead = 0;
  /** -1 = 좌측 확인, +1 = 우측 확인, 0 = 정면 */
  private glance = 0;

  private smoothPos = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private initialized = false;
  private shake = 0;

  constructor(
    aspect: number,
    private spec: CarSpec,
  ) {
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.1, 900);
    this.applyLayers();
  }

  /**
   * 시점에 따라 차량의 어느 쪽을 그릴지 정한다. 둘은 정확히 반대다.
   *
   *  - 운전석 : 실내를 보고, 차체(보닛·범퍼·등화)는 뺀다
   *  - 후방·탑다운 : 차체를 보고, **실내는 뺀다** — 실내 모델은 눈높이에 맞춰 키워 둔 것이라
   *    밖에서 보면 차체보다 커서 껍데기를 뚫고 나온다
   */
  private applyLayers(): void {
    // 내 차는 어느 시점에서나 보여야 한다 (보조 창 카메라만 이 레이어를 끈다)
    this.camera.layers.enable(PLAYER_CAR_LAYER);
    const driver = this.mode === 'driver';
    if (driver) {
      this.camera.layers.disable(DRIVER_HIDDEN_LAYER);
      this.camera.layers.enable(INTERIOR_LAYER);
    } else {
      this.camera.layers.enable(DRIVER_HIDDEN_LAYER);
      this.camera.layers.disable(INTERIOR_LAYER);
    }
  }

  /**
   * **이 판의 첫 횡단보도가 진입로 보호구역(S)인가** — 세로 화면에서 카메라를 언제 올릴지에 쓴다.
   * S 는 교차로에서 한참 떨어진 z=70 근처라, 교차로까지의 거리만으로는 영영 올라가지 않는다.
   */
  private approachZone = false;

  setApproachZone(on: boolean): void {
    this.approachZone = on;
  }

  setCar(spec: CarSpec): void {
    this.spec = spec;
  }

  /**
   * 3D 모델이 알려 준 눈높이로 갈아 끼운다.
   *
   * 제원(전고)으로 잡은 눈높이는 모델과 맞지 않는다 — 모델은 차 길이에 맞춰 스케일되므로
   * 짧은 차일수록 통째로 납작해진다. 티코에서는 **눈이 모델 지붕 위에** 있었고(1.13m 대
   * 0.99m), 그래서 대시보드가 화면 아래로 밀려나 시작할 때마다 내려다봐야 했다.
   */
  setEyeHeight(y: number): void {
    this.eyeY = y;
  }

  /** 모델에서 잰 눈높이. null 이면 제원 공식을 쓴다 (절차적 차체일 때) */
  private eyeY: number | null = null;

  /**
   * 좌석 앞뒤 조절 (m, +가 앞). 차고에서 정해 저장해 둔 값이 주행에 그대로 들어온다.
   *
   * 차마다 앞유리 각도와 대시보드 깊이가 달라 기본 자리가 누구에게나 맞지는 않는다.
   * 앞으로 당기면 앞유리가 넓게 열리는 대신 계기판·핸들이 커지고, 뒤로 물리면 반대다.
   */
  private seatOffset = 0;

  setSeatOffset(meters: number): void {
    this.seatOffset = clampSeatOffset(meters);
  }

  /**
   * 운전석 시점의 기본 화각.
   *
   * three.js 의 `fov` 는 **세로** 화각이라, 그대로 상수로 두면 창이 좁아질수록 가로가 같이
   * 좁아진다. 그런데 이 게임에서 담아야 할 것은 가로 쪽이다 — 오른쪽 사이드미러가
   * 운전자 눈에서 **우 65°** 에 있어서, 가로 화각이 그만큼 안 되면 화면 밖으로 밀린다
   * (운전석이 좌측이라 오른쪽 거울이 차 폭만큼 더 멀다).
   *
   * 그래서 **가로를 목표로 잡고 세로를 역산한다.** 어떤 창 비율에서도 좌우로 담기는 범위가
   * 같아진다. 다만 좁고 높은 창에서는 역산한 세로 화각이 걷잡을 수 없이 커지므로
   * 상한을 둔다 — 그때는 오른쪽 거울이 잘리고 우측 시야 창(PeripheralView)이 그 역할을 한다.
   *
   * 하한 74° 는 이전까지 쓰던 값이다. 이보다 좁히면 횡단보도 양 끝이 빠진다.
   */
  private driverFov(): number {
    const targetHalf = (76 * Math.PI) / 180; // 우 65° 거울 + 여유 11° (거울 바깥 테두리까지)
    const vertical = 2 * Math.atan(Math.tan(targetHalf) / this.camera.aspect);
    // 세로로 긴 화면(휴대폰 세로)은 상한을 조금 더 연다 — 90° 로는 가로가 49° 밖에 안 담긴다 (아래 PORTRAIT_MAX_FOV)
    return clamp((vertical * 180) / Math.PI, 74, this.camera.aspect < 1 ? PORTRAIT_MAX_FOV : 90);
  }

  cycle(): ViewMode {
    const i = VIEW_ORDER.indexOf(this.mode);
    this.mode = VIEW_ORDER[(i + 1) % VIEW_ORDER.length];
    this.initialized = false;
    this.applyLayers();
    return this.mode;
  }

  setMode(mode: ViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.initialized = false;
    this.applyLayers();
  }

  /** 마우스/터치 드래그로 시선을 돌린다 */
  look(dx: number, dy: number): void {
    this.targetLookYaw = clamp(this.targetLookYaw + dx, -1.5, 1.5);
    this.targetLookPitch = clamp(this.targetLookPitch + dy, -0.5, 0.5);
  }

  /** 시선을 정면으로 되돌린다 */
  recenter(): void {
    this.targetLookYaw = 0;
    this.targetLookPitch = 0;
  }

  /** 좌우 확인. -1 좌측, +1 우측, 0 정면 */
  setGlance(dir: -1 | 0 | 1): void {
    this.glance = dir;
  }

  /** 급제동·요철 등으로 카메라를 흔든다 */
  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(vehicle: CameraTarget, dt: number): void {
    const { dims } = this.spec;
    const f = vehicle.forward;
    // 차체 우측 방향 (전방을 y축 기준 -90도 회전)
    const right = { x: -f.z, z: f.x };

    let pos: THREE.Vector3;
    let target: THREE.Vector3;
    let fov: number;

    if (this.mode === 'driver') {
      this.lookYaw += (this.targetLookYaw - this.lookYaw) * Math.min(1, dt * 9);
      this.lookPitch += (this.targetLookPitch - this.lookPitch) * Math.min(1, dt * 9);

      // 차체 메시와 동일한 공식으로 눈높이를 잡는다 (로컬 좌표 → 월드)
      const eye = driverEyeLocal(this.spec);
      const eyeY = this.eyeY ?? eye.y;
      // 앞이 -Z 이므로 좌석을 앞으로 당기면 z 가 줄어든다
      const eyeZ = eye.z - this.seatOffset;
      pos = new THREE.Vector3(
        vehicle.x + right.x * eye.x + f.x * -eyeZ,
        eyeY,
        vehicle.z + right.z * eye.x + f.z * -eyeZ,
      );

      // 회전하는 방향으로 시선을 미리 돌리고(코너 안쪽 보기), 글랜스 키를 더한다.
      // 우회전은 yaw 가 감소(각속도 음수)하고 우측을 보려면 yaw 가 작아져야 하므로 부호가 그대로 맞는다.
      const corner = clamp(vehicle.yawRate * CORNER_LOOK_GAIN, -CORNER_LOOK_MAX, CORNER_LOOK_MAX);
      const leadTarget = corner - this.glance * GLANCE_ANGLE;
      this.lookLead += (leadTarget - this.lookLead) * Math.min(1, dt * 4);

      const yaw = vehicle.yaw + this.lookYaw + this.lookLead;
      const lf = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      /*
        시선은 수평보다 **약 3.5° 아래**.
        실제 운전자는 전방 노면을 내려다보고, 계기판도 시선을 크게 내리지 않고 곁눈으로 읽는다.
        수평이나 그보다 위를 보면 계기판이 화면 밖으로 밀려나 매번 드래그해서 내려다봐야 한다.
        (신호등은 33m 앞 5.7m 높이라 이만큼 내려다봐도 화면 위쪽에 그대로 들어온다)
      */
      target = new THREE.Vector3(
        pos.x + lf.x * 14,
        eyeY - GAZE_DROP + this.lookPitch * 14,
        pos.z + lf.z * 14,
      );
      // 속도가 붙으면 조금 더 넓혀 속도감을 준다. 다만 총량은 묶는다 — 더 넓히면 어안처럼 휜다
      fov = Math.min(
        this.camera.aspect < 1 ? PORTRAIT_MAX_FOV + 2 : 92,
        this.driverFov() + Math.min(8, vehicle.speedKmh * 0.07),
      );
      // 운전석 시점은 지연 없이 붙는다 — 지연이 있으면 멀미가 난다
      this.smoothPos.copy(pos);
      this.smoothTarget.lerp(target, this.initialized ? Math.min(1, dt * 14) : 1);
    } else if (this.mode === 'chase') {
      /*
        **세로 화면에서는 조금 앞으로 당기고, 덜 넓게 본다** (사용자가 사진으로 짚었다:
        "너무 뒤에서 봐서 너무 광각으로 물체가 왜곡되어 보인다").

        세로 화면은 가로가 좁아 `fitHorizontal` 이 세로 화각을 108° 까지 밀어 올린다 — 그 화각에서는
        가장자리의 건물과 사람이 늘어날 뿐 아니라, 정작 봐야 할 신호등과 멀리 있는 보행자가 작아진다.
        그래서 달리는 동안에는 가로 화각의 하한을 낮추고, 그만큼 좁아진 화면을 차가 채우도록 앞으로 당긴다.
        넓게 봐야 하는 때는 횡단보도 앞뿐이고, 그때는 화각이 아니라 **카메라를 옮겨서** 넓힌다 (아래 `rise`).
      */
      const portrait = this.camera.aspect < 1;
      /*
        **횡단보도가 다가오면 카메라가 올라가 뒤로 물러난다** (세로 화면 전용, `rise` 0→1).

        좌·우 확장 시야 창을 걷어내면서 "횡단보도 저쪽 끝이 안 보인다" 가 남았다. 화각만 넓히면
        108° 까지 밀려 올라가 멀리 있는 신호등과 사람이 작아진다 — 그래서 **화각 대신 카메라를 옮긴다.**
        높이 올려 눕히면 같은 화각 안에 가로로 더 들어오고(내려다볼수록 바닥의 좌우가 가운데로 모인다),
        조금 뒤로 물러나면 횡단보도까지의 거리가 멀어져 벌어진 각이 줄어든다.

        **뒤로는 조금만 간다** — 더 물리면 뒤따라오는 차가 화면 아래를 채워 내 차가 주인공이 아니게 된다.
        모자라는 몫은 높이가 맡는다.

        **늘 올려 두지 않는 까닭**: 달릴 때는 낮고 좁은 편이 멀리 있는 신호등과 보행자를 크게 보여 준다.
        그래서 좌·우 창이 떠오르던 바로 그 구간에서만 올라갔다가, 지나가면 저절로 돌아온다.
      */
      const rise = portrait ? crosswalkRise(vehicle.x, vehicle.z, this.approachZone) : 0;
      const back = portrait ? dims.length * 1.45 + 2.5 + rise * 3.5 : dims.length * 1.9 + 3.2;
      pos = new THREE.Vector3(
        vehicle.x - f.x * back + right.x * 0.4,
        portrait ? dims.height * 1.45 + 1.25 + rise * 7 : dims.height * 1.55 + 1.4,
        vehicle.z - f.z * back + right.z * 0.4,
      );
      /*
        **세로 화면에서는 더 앞을 본다** (사용자가 정했다: "차를 기준으로 앞 시야를 조금 더").
        보는 지점을 앞으로 밀면 차가 화면 아래쪽으로 내려가고 그만큼 **앞 도로가 더 들어온다**.
        다만 카메라가 올라간 동안에는 보는 지점을 **당겨** 와야 한다 — 그래야 고개가 아래로 더 숙여져
        횡단보도가 화면 가운데에 놓인다. 멀리 밀어 두면 올라간 만큼 그냥 하늘을 본다.
      */
      const aim = portrait ? 15 - rise * 8 : 8;
      target = new THREE.Vector3(vehicle.x + f.x * aim, dims.height * 0.7, vehicle.z + f.z * aim);
      fov = fitHorizontal(
        66 + Math.min(12, vehicle.speedKmh * 0.11),
        this.camera.aspect,
        portrait
          ? CHASE_MIN_HFOV_PORTRAIT + rise * (CHASE_NEAR_HFOV_PORTRAIT - CHASE_MIN_HFOV_PORTRAIT)
          : CHASE_MIN_HFOV,
      );
      const k = this.initialized ? Math.min(1, dt * 6.5) : 1;
      this.smoothPos.lerp(pos, k);
      this.smoothTarget.lerp(target, k);
    } else {
      /*
        ── 상공 시점 ──────────────────────────────────────────────────────

        **내 차와 우회전 지점이 함께 보여야 한다.**

        예전에는 교차로에 고정돼 있었다(카메라 (6,46,20) → (4,0,4)). 그러면 출발 지점
        (z=68m)에서는 **내 차가 화면 밖**이라, 상공 시점으로 시작하도록 설정해 두면
        보이지도 않는 차를 조향하게 된다.

        그래서 **내 차와 우회전 지점의 가운데**를 보고, 둘 사이가 멀수록 높이 올라간다.
        출발 직후에는 넓게, 교차로에 다가갈수록 가까이 — 지도처럼 따라온다.
      */
      // 우회전이 일어나는 지점 (진입 차로와 진출 차로가 만나는 코너)
      const ax = LANE_2_OFFSET;
      const az = LANE_2_OFFSET;
      const fx = (vehicle.x + ax) / 2;
      const fz = (vehicle.z + az) / 2;
      const spread = Math.hypot(vehicle.x - ax, vehicle.z - az);
      /*
        높이. 세로 화각 55°(반각 27.5°)로 지상에서 담기는 세로 길이가 약 1.04×높이라,
        둘 사이 거리에 여유를 더해 잡는다. 계수를 0.75 로 둔 것은 기울기(아래 +14m) 때문에
        프레임이 한쪽으로 밀리는 몫까지 감안한 값이다 — 출발 순간 내 차가 시야 가장자리에서
        22.7°(한계 27.5°)에 들어온다.
      */
      const h = clamp(spread * 0.75 + 30, 34, 90);
      // 완전한 수직 부감은 차의 방향이 안 보인다. 남쪽으로 조금 물려 살짝 기울인다.
      pos = new THREE.Vector3(fx, h, fz + 14);
      target = new THREE.Vector3(fx, 0, fz);
      fov = fitHorizontal(55, this.camera.aspect, TOP_MIN_HFOV);
      const k = this.initialized ? Math.min(1, dt * 4) : 1;
      this.smoothPos.lerp(pos, k);
      this.smoothTarget.lerp(target, k);
    }

    this.initialized = true;

    /*
      속도·급제동에 따른 미세 흔들림.

      주행 중 상시로 걸리는 것은 속도 항이다. 원래 0.00022·상한 0.02 였는데 달리는 내내
      화면이 자잘하게 떨려 눈이 피로했다 — 절반으로 줄인다. 급제동 흔들림(shake)은
      그 순간에만 걸리는 피드백이라 그대로 둔다.
    */
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const jitter = this.shake * 0.09 + Math.min(0.01, vehicle.speedKmh * 0.00011);
    this.camera.position.set(
      this.smoothPos.x + (Math.random() - 0.5) * jitter,
      this.smoothPos.y + (Math.random() - 0.5) * jitter,
      this.smoothPos.z + (Math.random() - 0.5) * jitter,
    );
    this.camera.lookAt(this.smoothTarget);

    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
  }
}

/*
  ── 세로로 긴 화면 (휴대폰 세로) ────────────────────────────────────────

  three.js 의 화각(`fov`)은 **세로**라, 화면이 세로로 길어지면 좌우로 담기는 범위가 그만큼 줄어든다. 후방 시점의
  세로 66° 는 가로로 긴 PC 화면(16:9)에서 가로 98° 를 담지만, 휴대폰 세로(390×844)에서는 **가로 33°** 뿐이라 내 차
  양옆의 횡단보도 · 보행자 · 신호등이 화면 밖으로 밀렸다 (사용자가 짚었다: "좌우 주변이 보이지 않아").

  그래서 세로로 긴 화면에서는 **가로가 적어도 이만큼은 담기게** 세로 화각을 넓힌다. 끝없이 넓히면 화면 위아래가
  어안렌즈처럼 늘어나므로 세로 화각의 상한을 둔다 — 휴대폰 세로에서 후방 시점의 가로가 33° → 약 65° 로 넓어진다.

  상한은 처음에 100° 였다(가로 58°). 사용자가 "좌우 시야를 조금만 더" 라고 해 108° 로 올렸다 — 110° 를 넘기면
  화면 가장자리의 건물이 눈에 띄게 기울어 보인다.
*/
/** 세로로 긴 화면에서 세로 화각을 이보다 넓히지 않는다 (°) — 더 넓히면 화면 위아래가 늘어나 보인다 */
export const PORTRAIT_MAX_FOV = 108;
/** 후방 시점이 적어도 담아야 할 가로 화각 (°) */
const CHASE_MIN_HFOV = 72;
/**
 * 세로 화면의 후방 시점 가로 화각 하한 — **달릴 때**.
 *
 * 72° 를 세로 화면(비율 0.53)에 맞추면 세로 화각이 108° 까지 벌어져 가장자리가 늘어나 보였다.
 * 좁게 두면 멀리 있는 신호등과 보행자가 그만큼 크게 보인다 — 달리는 동안 봐야 할 것이 그것이다.
 */
const CHASE_MIN_HFOV_PORTRAIT = 46;
/**
 * 횡단보도 앞에 다 왔을 때의 가로 화각 (°). 카메라가 올라가 뒤로 물러난 뒤라 **이만큼만 넓혀도**
 * 횡단보도가 통째로 들어온다 — 108° 로 밀어 올리지 않아 가장자리가 늘어나지 않는다.
 */
const CHASE_NEAR_HFOV_PORTRAIT = 60;
/**
 * 카메라가 올라가기 시작하는 · 다 올라가는 지점 — **교차로 중심에서의 거리(m)**.
 * 좌·우 시야 창이 떠오르던 구간(PeripheralView 의 FADE_DIST · FULL_DIST)과 같은 자리다.
 */
const RISE_FADE_DIST = STOP_LINE + 22;
const RISE_FULL_DIST = STOP_LINE + 8;
/** 상공 시점이 적어도 담아야 할 가로 화각 (°) — 교차로의 좌우 끝까지 */
const TOP_MIN_HFOV = 66;

/**
 * **횡단보도가 얼마나 가까운가** — 0(아직 멀다) ~ 1(코앞). 세로 화면의 후방 카메라가 이만큼 올라간다.
 *
 * 자는 좌·우 시야 창이 떠오르던 것과 같다: **교차로 중심에서의 거리.** 들어갈 때(첫 횡단보도)와
 * 나올 때(우회전 뒤 횡단보도)가 한 값으로 묶여, 교차로를 지나는 동안 내내 올라가 있다.
 *
 * @param approachZone 이 판의 첫 횡단보도가 진입로 보호구역(S)인가 — 교차로에서 한참 떨어져 있어
 *   교차로까지의 거리만으로는 영영 올라가지 않는다. 그 정지선까지 남은 거리를 같은 자로 잰다.
 */
export function crosswalkRise(x: number, z: number, approachZone = false): number {
  const span = RISE_FADE_DIST - RISE_FULL_DIST;
  const dist = Math.max(Math.abs(x), Math.abs(z));
  let rise = clamp((RISE_FADE_DIST - dist) / span, 0, 1);
  if (approachZone) {
    const gapS = Math.abs(Math.abs(z) - STOP_LINE_S);
    rise = Math.max(rise, clamp((RISE_FADE_DIST - STOP_LINE - gapS) / span, 0, 1));
  }
  return rise;
}

/**
 * 가로 화각이 `minHorizontal` 이상 되도록 세로 화각을 넓힌다 (`PORTRAIT_MAX_FOV` 까지). 가로로 긴 화면에서는
 * 이미 넉넉하므로 `vertical` 을 그대로 돌려준다 — PC 화면은 달라지지 않는다.
 */
export function fitHorizontal(vertical: number, aspect: number, minHorizontal: number): number {
  const half = (minHorizontal * Math.PI) / 360;
  const needed = (2 * Math.atan(Math.tan(half) / aspect) * 180) / Math.PI;
  if (needed <= vertical) return vertical;
  return Math.min(needed, Math.max(vertical, PORTRAIT_MAX_FOV));
}

/** 세로 화각 · 화면 비율 → 가로 화각 (°) */
export function horizontalFov(vertical: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((vertical * Math.PI) / 360) * aspect) * 180) / Math.PI;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
