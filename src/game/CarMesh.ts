/**
 * 차량 3D 메시를 절차적으로 만든다.
 *
 * 실제 차량 사진은 상표·저작권 문제로 주행 화면에 쓰지 않는다. 대신 CarSpec.dims의
 * 전장·전폭·전고·루프라인 비율만 실차를 참고해 재현한다.
 *
 * 차체는 상자를 쌓는 대신 **측면 실루엣을 압출(extrude)** 해서 만든다.
 * 보닛 경사·윈드실드 각도·리어 데크가 한 번에 잡혀 실루엣이 훨씬 차답게 나오고,
 * 세단·SUV·승합차를 파라미터만 바꿔 만들 수 있다.
 *
 * 로컬 좌표계: 전방 = -Z, 우측 = +X, 위 = +Y.
 */

import * as THREE from 'three';
import type { CarSpec } from '../economy/cars';

/**
 * 운전석 시점에서는 렌더하지 않을 부품을 올려 두는 레이어.
 * 사이드미러와 자기 차 유리는 실제로는 시야 밖이거나 신경 쓰이지 않는데,
 * 넓은 화각 때문에 화면 한가운데 떠 보여 전방 시야를 가린다.
 * 후방·탑다운 시점에서는 그대로 보인다.
 */
export const DRIVER_HIDDEN_LAYER = 1;

/**
 * 실내(바닥·도어 트림·시트·필러) 레이어.
 *
 * 실내는 **메인 화면에서만** 보여야 한다. 거울과 좌·우 시야 창의 카메라는 실내에 앉아 있어서,
 * 실내를 그리면 도어 트림과 필러가 화면을 가로막아 정작 봐야 할 도로가 안 보인다.
 * (거울·시야 창 카메라는 기본 레이어 0 만 보므로, 이 레이어에 두면 자동으로 빠진다)
 */
export const INTERIOR_LAYER = 2;

/**
 * **내 차** 레이어.
 *
 * 좌·우·후방 창의 카메라는 차 안에 앉아 있다. 부품을 전부 그리기로 한 뒤로는 그 카메라들이
 * 자기 차의 시트와 차체를 먼저 만나, 창이 뒷좌석으로 가득 찼다. 내 차를 이 레이어에 두고
 * **메인 카메라만** 켜면, 창에는 바깥 상황만 담긴다.
 */
export const PLAYER_CAR_LAYER = 3;


/** 차체 하단 지상고 (m) */
const GROUND_CLEARANCE = 0.18;

/** 외부에서도 쓰는 지상고 (실내 모델을 바닥에 앉힐 때) */
export const GROUND_GAP = GROUND_CLEARANCE;

/**
 * 차체 등화 — **절차적 차체에서만 눈에 보인다.**
 *
 * 3D 모델이 붙으면 등화 상자도 차체와 함께 숨는다. 우리가 그린 상자는 우리 공식이 잡은
 * 범퍼 좌표에 있고 모델의 램프는 제 자리에 따로 있어서, 둘이 어긋난 채 겹쳐 보였기 때문이다.
 * 그때부터 setBrake·setHeadlights 의 발광은 모델 위에서 보이지 않는다 —
 * 다만 setHeadlights 는 **스포트라이트**를 함께 켜므로 야간 노면 조명은 그대로 살아 있다.
 *
 * **방향지시등은 아예 없다.** 점멸하는 주황 상자가 가장 눈에 거슬렸고, 켜졌는지는
 * **계기판(ClusterPanel)의 화살표**와 소리가 알려 준다 — 실제 차에서도 운전자는 자기 차의
 * 바깥 깜빡이를 보지 못한다. 판정도 화면 표시가 아니라 입력 상태로 한다.
 */
export interface CarLights {
  setBrake(on: boolean): void;
  setHeadlights(on: boolean): void;
  /**
   * 우측 방향지시등 — **후방·상공 시점에서만 보인다.**
   *
   * 깜빡이는 주기는 여기서 만들지 않는다. 계기판 화살표·소리와 **같은 신호**로 켜고 꺼야
   * 셋이 어긋나지 않으므로, 이미 그 주기를 갖고 있는 Game 이 넘겨 준다.
   */
  setTurnSignal(on: boolean): void;
}

export interface CarModel {
  group: THREE.Group;
  lights: CarLights;
  /** 바퀴 — 주행 시 굴리기 */
  spinWheels(distanceMeters: number): void;
  /** 앞바퀴 조향각 표시 */
  setSteer(angleRad: number): void;
  /**
   * 3D 차량 모델로 갈아 끼운다 (절차적 차체는 숨긴다).
   * 모델이 없으면 호출되지 않고 절차적 차체가 그대로 남는다.
   */
  useModel(model: THREE.Object3D): void;
  /**
   * 모델이 도착할 때까지 차량을 통째로 감춘다.
   *
   * 모델은 비동기로 온다. 그동안 그리면 두 가지가 드러난다.
   *  - **절차적 차체와 실내** — 헤드라이너까지 있는 옛 프레임이 잠깐 보였다가 모델로 바뀐다
   *  - **핸들·거울·계기판** — 절차적 자리에 그렸다가 모델 자리로 옮겨 가며 눈에 띄게 튄다
   *
   * 자리가 정해질 때까지 감췄다가 한 번에 켜는 편이 낫다. 모델이 없거나 읽지 못해도
   * 마지막에 그대로 켜므로 절차적 차체가 온전히 나온다.
   */
  setSeatedVisible(on: boolean): void;
  dispose(): void;
}

export interface BuildCarOptions {
  /**
   * 플레이어 차량인가.
   * 운전석 시점에서 시야를 가리는 부품(사이드미러·자기 차 유리)을 숨기는 데 쓴다.
   * NPC 차량은 운전석 시점에서도 온전히 보여야 하므로 기본값은 false다.
   */
  isPlayer?: boolean;
}

/** 차체 주요 높이·위치를 한 곳에서 계산한다 (카메라·미러가 같은 값을 참조) */
function bodyMetrics(spec: CarSpec) {
  const { length: L, height: H, roofRatio, cabinFront, cabinRear } = spec.dims;
  // 전고 H 는 지면부터 지붕까지다. 지상고를 뺀 나머지를 차체와 캐빈이 나눠 갖는다.
  // (지상고를 빼지 않으면 차가 제원보다 0.18m 더 높아진다)
  const shellH = H - GROUND_CLEARANCE;
  const sill = shellH * (1 - roofRatio); // 벨트라인까지의 차체 높이
  const cabinH = shellH * roofRatio;
  const beltY = GROUND_CLEARANCE + sill;
  const roofY = H;
  const frontZ = -L / 2;
  const rearZ = L / 2;
  const cowlZ = frontZ + L * cabinFront; // 보닛 끝 = 윈드실드 아래
  const roofFrontZ = cowlZ + L * 0.13;
  const backlightZ = frontZ + L * cabinRear; // 리어 윈도 아래
  const roofRearZ = backlightZ - L * 0.06;
  const deckY = beltY + cabinH * 0.1; // 트렁크 리드 높이
  return {
    L,
    H,
    sill,
    cabinH,
    beltY,
    roofY,
    frontZ,
    rearZ,
    cowlZ,
    roofFrontZ,
    backlightZ,
    roofRearZ,
    deckY,
  };
}

/**
 * 눈이 **윈드실드 상단(루프 앞끝)에서 얼마나 뒤에** 앉는가 — 캐빈 길이에 대한 비율.
 *
 * 앞유리로 보이는 범위는 눈과 유리 사이의 거리가 정한다. 뒤로 앉을수록 같은 유리가
 * 작게 보이고, 그만큼 지붕 앞선(헤더)과 대시보드가 화면을 위아래에서 잠식한다.
 *
 * 0.3 이었을 때는 캐빈 길이(코롤라 1.52m)의 30% 인 0.46m 뒤 — 앞좌석과 뒷좌석 사이쯤에
 * 앉은 셈이라, 코롤라 기준 앞유리가 세로 55° 밖에 담기지 않았다(화각은 90°). 나머지
 * 35° 는 헤더와 대시보드였다. 실제 운전자의 눈은 헤더 바로 아래·조금 뒤에 있다.
 *
 * 0.12(0.18m 뒤)로 당기면 같은 유리가 세로 87° 로 벌어져 앞유리가 화면을 채운다.
 * 더 줄이면(0.05 이하) 눈이 헤더에 붙어 유리를 뚫고 나온 것처럼 보이고, 핸들이
 * 코앞까지 다가온다. 앞이 답답하면 이 값을 줄이고, 계기판·핸들이 너무 크면 늘린다.
 */
const EYE_BEHIND_HEADER = 0.12;

/**
 * 운전석 눈높이 위치 (차량 로컬 좌표).
 * 차체와 같은 공식을 쓰므로 카메라가 보닛에 파묻히거나 지붕을 뚫지 않는다.
 */
export function driverEyeLocal(spec: CarSpec): { x: number; y: number; z: number } {
  const m = bodyMetrics(spec);
  const cabinLen = m.roofRearZ - m.roofFrontZ;
  return {
    x: -spec.dims.width * 0.23, // 운전석은 좌측(한국은 좌핸들)
    // 눈은 사이드윈도 위쪽에 온다. 낮게 잡으면 보닛과 자기 차 바퀴가 화면을 덮는다.
    y: m.beltY + m.cabinH * 0.62,
    z: m.roofFrontZ + cabinLen * EYE_BEHIND_HEADER,
  };
}

/**
 * 계기판 패널 자리 (차량 로컬 좌표).
 * 대시보드·계기판 후드와 같은 수식에서 뽑아야 패널이 후드 위에 정확히 얹힌다.
 * (아래 buildCar 의 대시보드 배치와 같은 값을 쓴다)
 */
export function clusterPanelLocal(spec: CarSpec): {
  x: number;
  y: number;
  z: number;
  tilt: number;
} {
  const eye = driverEyeLocal(spec);
  // 핸들과 같은 축 위, 바로 뒤(앞유리 쪽)에 놓아 **핸들 살 사이로 보이게** 한다.
  // 실제 차의 계기판이 딱 이 자리다 — 운전자는 림 위쪽 빈 공간으로 눈금을 읽는다.
  return {
    x: eye.x,
    // 핸들 중심보다 위 — 대시보드 윗면 위로 올라와야 판이 대시보드에 파묻히지 않는다
    /*
      핸들 **뒤쪽**(앞유리 쪽)에, 림 위쪽 빈 공간에 들어가도록 놓는다.
      운전자 쪽으로 당기면 핸들 앞으로 튀어나와 계기판이 핸들에 얹힌 것처럼 보이고,
      너무 내리면 림이 왼쪽 게이지를 가린다. 핸들 중심보다 0.18m 위가 두 게이지가
      모두 드러나는 자리다 (림 반지름 0.25m).
    */
    y: eye.y - 0.22,
    z: eye.z - 0.78,
    tilt: -1.05,
  };
}

/** 측면 실루엣. 앞범퍼 → 보닛 → 윈드실드 → 루프 → 리어 윈도 → 트렁크 → 뒷범퍼 */
function sideProfile(spec: CarSpec): THREE.Shape {
  const m = bodyMetrics(spec);
  const g = GROUND_CLEARANCE;
  const noseY = g + m.sill * 0.74;
  const cowlY = g + m.sill * 0.98;

  const s = new THREE.Shape();
  s.moveTo(m.frontZ + 0.1, g);
  s.lineTo(m.frontZ, g + m.sill * 0.34); // 앞범퍼
  s.lineTo(m.frontZ + 0.06, noseY);
  s.lineTo(m.cowlZ, cowlY); // 보닛
  s.lineTo(m.roofFrontZ, m.roofY); // 윈드실드
  s.lineTo(m.roofRearZ, m.roofY); // 루프
  s.lineTo(m.backlightZ, m.deckY); // 리어 윈도
  s.lineTo(m.rearZ - 0.06, m.deckY - m.sill * 0.06); // 트렁크
  s.lineTo(m.rearZ, g + m.sill * 0.34); // 뒷범퍼
  s.lineTo(m.rearZ - 0.1, g);
  s.closePath();
  return s;
}

/** 실루엣을 차폭만큼 압출해 차체 셸을 만든다 */
function extrudeBody(spec: CarSpec): THREE.BufferGeometry {
  const W = spec.dims.width;
  const bevel = Math.min(0.05, W * 0.03);
  const geo = new THREE.ExtrudeGeometry(sideProfile(spec), {
    depth: W - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  // 압출 축(shape Z) → 차폭(X), shape X → 차 길이(Z)
  geo.rotateY(-Math.PI / 2);
  geo.translate((W - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 빛 번짐의 감쇠 곡선 — 중심에서의 거리(0~1) → 밝기(0~1).
 *
 * 예전에 캔버스 그라디언트의 색 정지점으로 적어 두었던 값 그대로다.
 */
const GLOW_STOPS: [at: number, alpha: number][] = [
  [0, 1],
  [0.25, 0.85],
  [0.55, 0.28],
  [1, 0],
];

/** 정지점 사이를 선형으로 잇는다 — 캔버스 그라디언트가 하던 것과 같은 계산이다 */
function glowAlphaAt(d: number): number {
  for (let i = 1; i < GLOW_STOPS.length; i++) {
    const [x1, a1] = GLOW_STOPS[i];
    if (d > x1) continue;
    const [x0, a0] = GLOW_STOPS[i - 1];
    return a0 + ((a1 - a0) * (d - x0)) / (x1 - x0);
  }
  return 0;
}

/**
 * 켜진 등화의 **빛 번짐** 텍스처 — 가운데가 하얗게 밝고 가장자리로 갈수록 사라진다.
 *
 * 방향지시등이 이것을 쓴다. 상자로 그리면 가장자리가 뚜렷해 3D 모델의 실제 램프 자리와
 * 몇 cm만 어긋나도 붙여 놓은 티가 나는데, 번지는 빛에는 가장자리가 없어 그 문제가 없다.
 *
 * 흰 중심을 두는 이유: 스프라이트에 색(주황)을 입혀 쓰므로, 텍스처까지 주황이면
 * 두 번 곱해져 탁해진다. 밝기만 담고 색은 재질이 정한다.
 *
 * ── 캔버스로 굽지 않는다
 *
 * 예전에는 `document.createElement('canvas')` 에 방사형 그라디언트를 그려 썼다.
 * 그 한 줄 때문에 **차체를 만드는 일 전체가 DOM 을 요구했고**, 브라우저 없이 도는
 * 단위 테스트에서 배경 차를 만들 수 없었다 — 배경 차가 보행자를 치지 않는지 검증하는
 * 것은 그림이 아니라 주행 로직인데도 그렇다.
 *
 * 픽셀을 직접 계산하면 그 의존이 사라진다. 결과 이미지는 같다 — 색은 흰색으로 고정이고
 * 알파만 변하므로, 캔버스가 정지점 사이를 선형 보간하던 것을 그대로 옮기면 된다.
 */
function makeGlowTexture(): THREE.DataTexture {
  const size = 64;
  const half = size / 2;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 픽셀 중심(+0.5)에서 잰다 — 모서리에서 재면 그림이 반 픽셀 치우친다
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const d = Math.min(1, Math.hypot(dx, dy) / half);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(glowAlphaAt(d) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  /*
    **필터를 손으로 정한다.** DataTexture 의 기본은 NearestFilter 라 그대로 두면
    64px 텍스처를 화면 가득 늘렸을 때 계단이 보인다 — CanvasTexture 의 기본(Linear)과
    달라서, 캔버스를 걷어내면서 조용히 그림이 나빠질 뻔한 자리다.
  */
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function emissiveMat(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
  });
}

export function buildCar(spec: CarSpec, opts: BuildCarOptions = {}): CarModel {
  const { width: W } = spec.dims;
  const m = bodyMetrics(spec);
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };
  /** 운전석 시점에서 돌아가는 스티어링 휠 (플레이어 차량에만 만든다) */
  /** 거울 유닛과 그 안에서 거울면이 어디 붙어 있는지 — 모델 자리로 옮길 때 이 오프셋을 뺀다 */
  /** 절차적 실내. 3D 모델이 들어오면 통째로 교체한다. */
  let interiorGroup: THREE.Group | null = null;

  /** 플레이어 차량의 유리·거울은 운전 시야를 가리므로 별도 레이어로 뺀다 */
  const hideFromDriver = (o: THREE.Object3D) => {
    if (opts.isPlayer) o.layers.set(DRIVER_HIDDEN_LAYER);
  };

  const bodyMat = track(
    new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.28, metalness: 0.5 }),
  );
  const darkMat = track(
    new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.7, metalness: 0.3 }),
  );
  const glassMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1b2430,
      roughness: 0.06,
      metalness: 0.35,
      transparent: true,
      opacity: 0.72,
    }),
  );
  const tireMat = track(new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.95 }));
  const rimMat = track(
    new THREE.MeshStandardMaterial({ color: 0xc3c7cd, roughness: 0.25, metalness: 0.9 }),
  );

  // ── 차체 셸 ──────────────────────────────────────────────────────────────
  const shell = new THREE.Mesh(track(extrudeBody(spec)), bodyMat);
  shell.castShadow = true;
  shell.receiveShadow = true;
  // 운전석 시점에서는 차체 셸을 통째로 뺀다. 보닛이 화면 아래를 크게 먹고,
  // 룸미러에는 트렁크 윗면이 잡힌다 — 실제 차는 뒷유리 구멍으로 도로만 보이지만
  // 이 차체는 유리를 얹은 통짜 셸이라 창 구멍이 없어 기하로는 해결되지 않는다.
  // (후방·탑다운 시점에서는 그대로 보인다)
  hideFromDriver(shell);
  group.add(shell);

  // ── 유리 ─────────────────────────────────────────────────────────────────
  // 실루엣의 각 구간 위에 평면을 얹어 윈드실드·리어윈도·사이드윈도를 만든다.
  const addSlantGlass = (z1: number, y1: number, z2: number, y2: number, width: number) => {
    const dz = z2 - z1;
    const dy = y2 - y1;
    const geo = track(new THREE.PlaneGeometry(width, Math.hypot(dz, dy)));
    const mesh = new THREE.Mesh(geo, glassMat);
    // +Y 를 구간 방향에 맞추면 법선이 자연스럽게 바깥을 향한다
    mesh.rotation.x = Math.atan2(dz, dy);
    mesh.position.set(0, (y1 + y2) / 2, (z1 + z2) / 2);
    hideFromDriver(mesh);
    group.add(mesh);
  };

  // 윈드실드 (루프 → 보닛 방향으로 잡아 법선이 앞쪽 위를 향하게)
  addSlantGlass(m.roofFrontZ, m.roofY - 0.01, m.cowlZ, m.beltY + m.cabinH * 0.06, W * 0.8);
  // 리어 윈도
  addSlantGlass(m.backlightZ, m.deckY + 0.01, m.roofRearZ, m.roofY - 0.01, W * 0.78);
  // 사이드 윈도 — 벨트라인 위, 필러를 남기고 차폭보다 아주 살짝 바깥에 둔다
  const sideWinGeo = track(
    new THREE.PlaneGeometry(m.roofRearZ - m.roofFrontZ + 0.35, m.cabinH * 0.62),
  );
  for (const side of [-1, 1]) {
    const win = new THREE.Mesh(sideWinGeo, glassMat);
    win.rotation.y = (side * Math.PI) / 2;
    win.position.set(
      side * (W / 2 + 0.005),
      m.beltY + m.cabinH * 0.42,
      (m.roofFrontZ + m.roofRearZ) / 2,
    );
    hideFromDriver(win);
    group.add(win);
  }

  // ── 바퀴 ─────────────────────────────────────────────────────────────────
  const wheelR = Math.max(0.28, spec.dims.height * 0.25);
  const wheelW = W * 0.12;
  const tireGeo = track(new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 20));
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = track(
    new THREE.CylinderGeometry(wheelR * 0.62, wheelR * 0.62, wheelW * 1.02, 16),
  );
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = track(new THREE.BoxGeometry(wheelW * 1.04, wheelR * 1.05, wheelR * 0.14));
  const hubGeo = track(new THREE.CylinderGeometry(wheelR * 0.2, wheelR * 0.2, wheelW * 1.06, 10));
  hubGeo.rotateZ(Math.PI / 2);

  const axleFront = m.frontZ + m.L * 0.19;
  const axleRear = m.rearZ - m.L * 0.19;
  const wheels: THREE.Group[] = [];
  const frontPivots: THREE.Group[] = [];

  for (const [zPos, isFront] of [
    [axleFront, true],
    [axleRear, false],
  ] as Array<[number, boolean]>) {
    for (const side of [-1, 1]) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      wheel.add(tire, new THREE.Mesh(rimGeo, rimMat), new THREE.Mesh(hubGeo, rimMat));
      // 스포크 — 바퀴가 도는 것이 눈에 보이게 한다
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        spoke.rotation.x = (i * Math.PI) / 5;
        wheel.add(spoke);
      }

      const pivot = new THREE.Group();
      pivot.position.set(side * (W / 2 - wheelW * 0.42), wheelR, zPos);
      pivot.add(wheel);
      // 실내 모델이 없어 바퀴가 캐빈을 뚫고 올라온다. 운전석 시점에서는 뺀다.
      hideFromDriver(pivot);
      wheel.traverse(hideFromDriver);
      group.add(pivot);

      wheels.push(wheel);
      if (isFront) frontPivots.push(pivot);
    }
  }

  // ── 그릴 · 범퍼 · 번호판 ──────────────────────────────────────────────────
  const boxGeo = track(new THREE.BoxGeometry(1, 1, 1));
  const addBox = (
    mat: THREE.Material,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const b = new THREE.Mesh(boxGeo, mat);
    b.scale.set(sx, sy, sz);
    b.position.set(x, y, z);
    group.add(b);
    return b;
  };

  /*
    앞쪽 부착물(범퍼·그릴·번호판·헤드램프·방향지시등)은 **운전석 시점에서 뺀다.**
    보닛을 숨기면서 차체 셸이 사라졌기 때문에, 이것들만 남으면 도로 위에 흰 상자와
    주황 상자가 둥둥 떠 있는 것처럼 보인다. 실제 운전석에서도 보이지 않는 부품들이다.
    (후방·탑다운 시점에서는 그대로 보인다 — 등화 상태를 확인하는 데 필요하다)
  */
  const bumperY = GROUND_CLEARANCE + m.sill * 0.3;
  hideFromDriver(addBox(darkMat, W * 0.96, m.sill * 0.2, 0.1, 0, bumperY, m.frontZ + 0.02));
  // 뒤 범퍼·번호판은 룸미러 카메라(실내에서 뒤를 본다) 화면 아래를 가로막는다.
  // 실제 룸미러에 자기 차 뒤 범퍼가 보일 리 없으므로 등화와 같은 레이어로 뺀다.
  hideFromDriver(addBox(darkMat, W * 0.96, m.sill * 0.2, 0.1, 0, bumperY, m.rearZ - 0.02));
  hideFromDriver(addBox(darkMat, W * 0.5, m.sill * 0.16, 0.06, 0, GROUND_CLEARANCE + m.sill * 0.62, m.frontZ + 0.01));

  const plateMat = track(new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.6 }));
  hideFromDriver(addBox(plateMat, W * 0.28, m.sill * 0.13, 0.03, 0, bumperY, m.frontZ - 0.03));
  hideFromDriver(addBox(plateMat, W * 0.28, m.sill * 0.13, 0.03, 0, bumperY, m.rearZ + 0.03));

  // ── 운전석 실내 (플레이어 전용) ───────────────────────────────────────────
  // 보닛 아래쪽은 원래 대시보드가 채우는 자리다. 실내가 없으면 그 부분이
  // 차 바닥까지 뻥 뚫려 보여, 보닛이 반만 있는 것처럼 잘려 보인다.
  if (opts.isPlayer) {
    const eye = driverEyeLocal(spec);
    const cowlY = GROUND_CLEARANCE + m.sill * 0.98; // 윈드실드 아래 = 대시보드 윗면
    // 대시보드는 윈드실드 아래부터 운전자 앞 0.45m 까지. 눈 기준으로 잡아야
    // 차종이 달라져도 운전자와의 거리가 일정하다.
    const dashRearZ = eye.z - 0.45;
    const dashDepth = Math.max(0.35, dashRearZ - m.cowlZ);

    const dashMat = track(new THREE.MeshStandardMaterial({ color: 0x32363f, roughness: 0.95 }));
    const dashTopMat = track(
      // 윈드실드에 면한 윗면은 빛을 받아 조금 밝다. 단색이면 빈 공간처럼 보인다.
      new THREE.MeshStandardMaterial({ color: 0x434855, roughness: 0.98 }),
    );
    /*
      대시보드도 **실내 그룹에 넣는다.** 3D 실내 모델이 들어오면 대시보드까지 함께 빠져야
      두 겹으로 겹치지 않는다. (핸들·계기판·거울은 그룹 밖이라 그대로 남는다 —
      크기와 각도를 계속 조정해야 하고, 거울은 실시간 텍스처를 받는다)
    */
    interiorGroup = new THREE.Group();
    group.add(interiorGroup);
    const intoInterior = (b: THREE.Mesh) => {
      interiorGroup!.attach(b);
      return b;
    };

    // 대시보드 윗면을 보닛 끝과 같은 높이로 맞춰 이음매가 생기지 않게 한다
    intoInterior(addBox(dashMat, W * 0.96, 0.42, dashDepth, 0, cowlY - 0.21, m.cowlZ + dashDepth / 2));
    intoInterior(
      addBox(dashTopMat, W * 0.96, 0.02, dashDepth * 0.55, 0, cowlY + 0.005, m.cowlZ + dashDepth * 0.3),
    );

    // 계기판 후드 — 운전석 쪽에만
    intoInterior(addBox(dashMat, W * 0.34, 0.12, 0.26, eye.x, cowlY + 0.03, dashRearZ - 0.06));

    /*
      실내.

      보닛을 숨기려고 차체 셸을 통째로 뺐더니, 시선을 내리면 대시보드 판만 허공에 떠 있고
      그 아래로 도로가 그대로 보였다. 실제로 앉아 있는 자리라면 **바닥과 도어와 필러**가
      둘러싸고 있어야 한다. 화려할 필요는 없고, 시선을 어디로 돌려도 '차 안'이면 된다.

      전용 레이어(INTERIOR_LAYER)에 두는 이유는 거울·시야 창 카메라가 실내에 앉아 있기 때문이다.
      거기까지 실내가 보이면 도어 트림이 후방 시야를 가로막는다.
    */
    function buildInterior(): void {
      const trimMat = track(new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.95 }));
      const carpetMat = track(new THREE.MeshStandardMaterial({ color: 0x1b1e25, roughness: 1 }));
      const seatMat = track(new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.95 }));

      const floorY = GROUND_CLEARANCE + m.sill * 0.34;
      const cabinFrontZ = m.cowlZ;
      const cabinRearZ = m.roofRearZ;
      const cabinLen = Math.max(0.6, cabinRearZ - cabinFrontZ);
      const cabinMidZ = (cabinFrontZ + cabinRearZ) / 2;

      const put = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
        const b = addBox(mat, sx, sy, sz, x, y, z);
        b.layers.set(INTERIOR_LAYER);
        interiorGroup!.attach(b);
        return b;
      };

      // 바닥
      put(carpetMat, W * 0.94, 0.03, cabinLen, 0, floorY, cabinMidZ);
      // 센터 콘솔 — 가운데가 비어 있으면 바닥이 뻥 뚫려 보인다
      put(trimMat, W * 0.2, 0.24, cabinLen * 0.7, 0, floorY + 0.12, cabinMidZ + 0.05);
      // 도어 트림 (벨트라인 아래)
      for (const side of [-1, 1] as const) {
        put(trimMat, 0.05, m.beltY - floorY, cabinLen, side * (W / 2 - 0.03), (m.beltY + floorY) / 2, cabinMidZ);
      }
      // 앞좌석 등받이 — 뒤를 돌아봤을 때 허공이 아니어야 한다
      for (const side of [-1, 1] as const) {
        put(seatMat, W * 0.36, 0.62, 0.12, side * W * 0.23, floorY + 0.31, eye.z + 0.5);
      }
      // 뒷좌석 등받이 겸 파셀 선반
      put(seatMat, W * 0.9, 0.5, 0.12, 0, floorY + 0.25, cabinRearZ - 0.12);
      /*
        A 필러와 헤더 — 앞유리 테두리.

        실차 필러는 폭 8cm 지만 운전자 눈에서 40cm 거리라 화면에서는 손가락처럼 두껍게 보인다.
        실제 운전에서도 필러 사각지대는 사고 원인이지만, 이 게임은 **보행자를 보는 것**이
        목적이라 시야를 가리면 곤란하다. 그래서 3cm 로 얇게 두어 '틀'로만 읽히게 했다.
      */
      for (const side of [-1, 1] as const) {
        const pillar = put(trimMat, 1, 1, 1, side * (W / 2 - 0.02), (cowlY + m.roofY) / 2, (m.cowlZ + m.roofFrontZ) / 2);
        pillar.scale.set(0.03, Math.hypot(m.roofY - cowlY, m.roofFrontZ - m.cowlZ), 0.04);
        pillar.rotation.x = -Math.atan2(m.roofFrontZ - m.cowlZ, m.roofY - cowlY);
      }
      put(trimMat, W * 0.98, 0.05, 0.1, 0, m.roofY - 0.02, m.roofFrontZ);
      // 헤드라이너
      put(trimMat, W * 0.94, 0.03, cabinLen * 0.9, 0, m.roofY - 0.02, cabinMidZ);
    }

    buildInterior();

    /*
      스티어링 휠은 **그리지 않는다.**

      예전에는 조향에 맞춰 도는 핸들을 코드로 그리고, 모델의 핸들은 버렸다. 그러려면
      모델마다 핸들이 어디 붙는지 알아야 했는데 — Sketchfab 모델은 부품 이름이 제각각이라
      그 자리를 자동으로 못 찾는다. 모델의 핸들을 그대로 두면 돌지는 않지만, **어떤 모델도
      받아서 그대로 쓸 수 있다.** 조향은 앞바퀴가 꺾이는 것으로 보인다.
    */
  }

  // ── 등화 ─────────────────────────────────────────────────────────────────
  /*
    등화 상자는 **절차적 차체 전용이다.** 3D 모델이 오면 차체와 함께 사라진다(keep 을 주지 않는다).

    예전에는 모델 위에도 남겼다 — 모델의 램프는 구워진 텍스처라 켜고 끌 수 없으니
    우리 것으로 점등을 표현하려던 것이다. 그런데 상자 자리는 우리 공식이 잡은 범퍼
    좌표이고 모델의 램프는 제 자리에 따로 있어서, **두 개가 어긋난 채 겹쳐 보였다**
    (흰 상자가 앞 범퍼에, 빨간 상자가 뒤 범퍼에 붙어 있던 것이 이것이다).

    점등 표현을 잃는 대신 얻는 것이 더 크다. 방향지시등은 계기판 화살표가, 야간 조명은
    아래 스포트라이트가 대신한다 — 스포트라이트는 보이는 물체가 아니라 모델 위에서도
    그대로 남는다.
  */
  const lamp = (o: THREE.Object3D) => {
    hideFromDriver(o);
  };

  const headMat = track(emissiveMat(0xfff4d6, 0));
  const tailMat = track(emissiveMat(0xff2418, 0.25));

  const lampY = GROUND_CLEARANCE + m.sill * 0.68;
  lamp(addBox(headMat, W * 0.2, m.sill * 0.17, 0.06, -W * 0.34, lampY, m.frontZ - 0.02));
  lamp(addBox(headMat, W * 0.2, m.sill * 0.17, 0.06, W * 0.34, lampY, m.frontZ - 0.02));
  /*
    뒤 등화는 운전자 시점 계열 카메라에서 뺀다.

    룸미러 카메라는 실내에서 뒤를 보므로 **자기 차의 뒤 등화가 화면 안쪽에 그대로 잡힌다.**
    실제 룸미러에는 뒷유리와 뒤 도로만 보이지 자기 미등은 보이지 않는다.
    (후방·탑다운 시점에서는 그대로 보인다 — 그쪽은 이 레이어를 켠다)
  */
  lamp(addBox(tailMat, W * 0.22, m.sill * 0.16, 0.06, -W * 0.34, lampY, m.rearZ + 0.02));
  lamp(addBox(tailMat, W * 0.22, m.sill * 0.16, 0.06, W * 0.34, lampY, m.rearZ + 0.02));
  /*
    ── 우측 방향지시등 ──────────────────────────────────────────────────────

    **상자가 아니라 빛 번짐(스프라이트)으로 그린다.**

    예전에는 주황 상자 셋(앞·뒤·사이드리피터)이었는데, 3D 모델 위에 얹히니 모델의
    실제 램프 자리와 어긋나 **붙여 놓은 티**가 났다. 그래서 통째로 없앴었다.

    가장자리가 뚜렷한 물체라서 어긋남이 드러난 것이다. 번지는 빛에는 가장자리가 없어
    몇 cm 어긋나도 눈에 걸리지 않는다 — 실제로도 켜진 방향지시등은 램프의 모양이 아니라
    번진 빛으로 보인다. 그래서 이것만 `userData.keep` 으로 모델 위에도 남긴다.

    **운전자 시점 계열에서는 뺀다** (hideFromDriver). 실제 운전석에서 자기 차의 바깥
    깜빡이는 보이지 않고, 룸미러·시야 창 카메라는 실내에 앉아 있어 켜 두면 차체를 뚫고
    비친다. 뒤 등화와 같은 처리다 — 후방·상공 시점에서만 보인다.
  */
  const blinkerTex = track(makeGlowTexture());
  const blinkerMat = track(
    new THREE.SpriteMaterial({
      map: blinkerTex,
      color: 0xffa524,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      /*
        **화면에서 늘 같은 크기로 그린다** (거리에 따라 줄어들지 않는다).

        실제 크기(0.9m)로 두면 후방 시점에서는 알맞은데 상공 시점에서는 76m 위에서
        내려다보므로 6px 남짓으로 뭉개져, 깜빡이는지 아닌지 알 수 없었다. 등화는
        '얼마나 큰 물체인가'가 아니라 '켜졌는가'만 보이면 되는 것이라 화면 크기를
        고정하는 편이 맞다. 가려짐(차체 뒤에 있으면 안 보임)은 그대로 동작한다.
      */
      sizeAttenuation: false,
    }),
  );
  /*
    앞·뒤 두 곳. 후방 시점에서는 뒤쪽만 보이고(차체가 앞쪽을 가린다), 상공 시점에서는
    둘 다 보여 어느 쪽으로 도는지가 드러난다.

    크기는 **화면 높이의 4%** 다 (sizeAttenuation 을 껐으므로 미터가 아니다).
    등화 하나가 30px 남짓이라, 후방 시점에서 과하지 않으면서 상공 시점에서도
    깜빡이는 것이 그대로 보인다.
  */
  const blinkerSize = 0.04;
  /*
    높이는 전조등·미등(`lampY`, 차체 높이의 0.68)보다 **조금 위**다.

    후방 시점에서 같은 높이에 두었더니 범퍼 아래·바퀴 근처에 붙어 보였다. 실차의 뒤
    방향지시등은 미등보다 위, 트렁크 리드에 가까운 자리에 있다. 차체 높이에서 뽑으므로
    (고정값이 아니라) 낮은 슈퍼카와 높은 SUV 가 각자 제 자리를 갖는다.

    **0.92 가 위쪽 한계다.** 1.0 은 벨트라인(유리가 시작되는 선)이라, 그보다 위로 올리면
    빛이 차체가 아니라 유리창에 붙은 것처럼 보인다.
  */
  const blinkerY = GROUND_CLEARANCE + m.sill * 0.92;
  for (const z of [m.frontZ + 0.15, m.rearZ - 0.15]) {
    const glow = new THREE.Sprite(blinkerMat);
    glow.position.set(W * 0.52, blinkerY, z);
    glow.scale.setScalar(blinkerSize);
    glow.userData.keep = true;
    hideFromDriver(glow);
    group.add(glow);
  }

  // ── 지붕 표시등 (택시) ────────────────────────────────────────────────────
  if (spec.roofSign) {
    const signMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xf6d34a,
        emissive: 0xf6d34a,
        emissiveIntensity: 0.8,
        roughness: 0.5,
      }),
    );
    // 지붕 표시등도 모델에 없는 것이라 남긴다 (택시는 이게 없으면 택시로 안 보인다)
    addBox(signMat, W * 0.34, 0.13, 0.3, 0, m.roofY + 0.07, (m.roofFrontZ + m.roofRearZ) / 2).userData.keep =
      true;
  }

  /*
    거울은 **더 이상 3D 로 그리지 않는다.**

    예전에는 차체에 거울면을 붙이고 실시간 렌더 텍스처를 입혔는데, 그러려면 모델마다
    거울이 어디 붙는지 알아야 했다. Sketchfab 모델은 부품 이름이 제각각이라 그 자리를
    자동으로 못 찾고, 차마다 좌표를 손으로 적어야 했다.

    - 사이드미러 : 없앴다. 좌·우 시야 창(PeripheralView)이 같은 정보를 더 크게 준다
    - 룸미러     : 화면 우측 상단의 **후방 창**으로 옮겼다 (PeripheralView)

    덕분에 모델을 받아 그대로 쓸 수 있다.
  */

  // 헤드램프 스포트라이트 (야간용)
  const headlightBeam = new THREE.SpotLight(0xfff0cc, 0, 45, Math.PI / 5.5, 0.45, 1.4);
  headlightBeam.position.set(0, lampY, m.frontZ);
  headlightBeam.target.position.set(0, 0, m.frontZ - 30);
  // 3D 모델로 바뀌어도 이 빛은 남아야 한다 — 야간 시나리오에서 노면을 비추는 유일한 광원이다
  headlightBeam.userData.keep = true;
  headlightBeam.target.userData.keep = true;
  group.add(headlightBeam, headlightBeam.target);

  const lights: CarLights = {
    setBrake(on) {
      tailMat.emissiveIntensity = on ? 2.6 : 0.25;
    },
    setHeadlights(on) {
      headMat.emissiveIntensity = on ? 2.2 : 0;
      headlightBeam.intensity = on ? 120 : 0;
    },
    setTurnSignal(on) {
      // 재질을 둘이 나눠 쓰므로 한 번만 바꾸면 앞·뒤가 함께 켜지고 꺼진다
      blinkerMat.opacity = on ? 1 : 0;
    },
  };

  let wheelAngle = 0;
  return {
    group,
    lights,
    spinWheels(distance) {
      wheelAngle -= distance / wheelR;
      for (const w of wheels) w.rotation.x = wheelAngle;
    },
    useModel(model) {
      /*
        3D 모델이 도착하면 절차적 차체를 **등화 상자까지 통째로** 숨긴다.

        남기는 것(userData.keep)은 두 가지뿐이다.
         - 헤드램프 **스포트라이트** — 보이는 물체가 아니라 야간에 노면을 비추는 빛이다.
           모델에는 이런 광원이 없으므로 이것까지 끄면 밤 시나리오가 캄캄해진다.
         - 택시 **지붕 표시등** — 모델에 없는 물건이고, 없으면 택시로 안 보인다.

        상자 등화를 남겼더니 모델의 실제 램프와 자리가 어긋나 붙여 놓은 티가 났다.
      */
      for (const child of group.children) {
        if (!child.userData.keep) child.visible = false;
      }
      group.add(model);
    },
    setSeatedVisible(on) {
      // 그룹 하나만 끄면 절차적 차체와 실내가 함께 감춰진다
      group.visible = on;
    },
    setSteer(angle) {
      for (const p of frontPivots) p.rotation.y = angle;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
