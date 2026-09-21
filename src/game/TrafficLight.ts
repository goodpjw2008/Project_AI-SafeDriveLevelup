/**
 * 신호등 4종.
 *
 *  - 차량신호등: 한국 표준 4색등(적 / 황 / 좌회전 녹색화살표 / 녹색) 가로형
 *  - 보행신호등: 적(서 있는 사람) / 녹(걷는 사람) 세로형
 *  - 우회전신호등: 적 원형 / 황 원형 / **녹색 우회전 화살표** 세로형
 *
 * 점등은 emissive 강도로 표현하고, 소등된 등은 어둡게 죽여 실제 신호등처럼 보이게 한다.
 */

import * as THREE from 'three';
import type { LightColor, PedSignal, RightArrowColor } from '../rules/lawRules';

const OFF_COLOR = 0x14151a;

/**
 * 등화 색 — **신호등 종류가 달라도 이 세 값만 쓴다.**
 *
 * 예전에는 차량신호등·우회전신호등이 한 벌(적 0xff2d20 · 녹 0x1fd45a), 보행신호등이
 * 또 한 벌(적 #ff3b2f · 녹 #2ee06a)을 갖고 있었다. 한 화면에 나란히 놓이는 등화들이라
 * **미묘하게 다른 빨강·초록이 그대로 눈에 띄었다** — 같은 색으로 읽혀야 같은 뜻으로 읽힌다.
 *
 * (색이 다르게 보이던 또 하나의 원인은 톤매핑이었다. 화살표 렌즈만 `toneMapped` 를 끄지
 * 않아 ACES 톤매핑을 한 번 더 거치면서 한 단계 죽었다 — ArrowLens 참고)
 */
const COLORS = {
  red: 0xff3b2f,
  yellow: 0xffc400,
  green: 0x2ee06a,
} as const;

/**
 * 보행신호등 픽토그램은 캔버스에 그리므로 색 문자열이 필요하다.
 * **값에서 유도한다** — 손으로 적어 두면 위 상수를 바꿀 때 한쪽만 바뀌어 다시 어긋난다.
 */
const cssOf = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
const CSS_RED = cssOf(COLORS.red);
const CSS_GREEN = cssOf(COLORS.green);

/**
 * 차량신호등 확대 배율.
 *
 * 실제 4색등은 렌즈 30cm·하우징 1.4m 인데, 정지선에서 **49m** 떨어져 있어
 * 실제 규격대로 그리면 화면에서 렌즈 하나가 4픽셀도 되지 않는다. 신호 색은 이 게임에서
 * 운전자가 판단하는 가장 중요한 정보라, 읽을 수 있는 크기까지 키운다.
 *
 * 도로를 넓히면서 신호등이 그만큼 멀어졌다(33m → 49m). 배율을 1.55 로 두면 거리에 반비례해
 * 화면상 크기가 2/3 로 줄어든다. 거리 증가분(1.46배)만 되돌리면 예전 크기로 돌아갈 뿐이고,
 * 폭 29.4m 도로 위에서는 그마저도 상대적으로 더 작아 보인다 — 도로 폭 대비 비율이
 * 예전 20%에서 17%로 떨어지기 때문이다.
 *
 * 그래서 도로를 넓힌 배율(2.1배)에 맞춰 **3.0배**까지 올렸다.
 * 렌즈 지름 96cm, 하우징 4.8m, 배면판 5.46m — 49m 밖에서 화면 가로의 8.6%를 차지한다.
 *
 * **그 뒤 도로를 다시 2/3(폭 19.6m)로 줄였다.** 신호등이 그만큼 가까워져(49m → 33m)
 * 화면에서 1.3배 커졌고, 좁아진 도로 위라 더 크게 보인다. 읽기에는 넉넉하지만
 * 과하다 싶으면 이 배율부터 내리면 된다 — 위치·거리는 layout.ts 에서 따라온다.
 */
const SIGNAL_SCALE = 3.0;

/**
 * 진입부 어린이보호구역 횡단보도 신호등의 확대 배율.
 *
 * 교차로 신호등(3.0배)만큼 키우지 않는다 — 우회전신호등을 1.8배로 둔 것과 같은 이유다.
 * 그쪽은 정지선에서 41m 앞이라 3.0배라야 읽히지만, 이 등화는 정지선에서 **7.6m** 앞이라
 * 같은 배율이면 서 있는 동안 화면 위쪽을 통째로 덮는다 (하우징만 4.8m — 차로보다 넓다).
 *
 * 그렇다고 우회전신호등만큼 줄일 수도 없다. 이 등화는 **보호구역에 들어서는 순간**
 * (50m 밖)부터 읽혀야 설지 판단할 시간이 생긴다. 그 두 거리 사이에서 잡은 값이다.
 */
export const ZONE_SIGNAL_SCALE = 2.2;

/**
 * 보행신호등 확대 배율.
 *
 * 차량신호등만큼 멀지는 않지만, 넓어진 도로에서는 건너편 신호등이 30m 밖에 선다.
 * 우회전 후 횡단보도(C)의 보행신호를 읽어야 하므로 함께 키운다.
 */
const PED_SIGNAL_SCALE = 2.0;

/**
 * **진입 전 횡단보도(A)의 보행신호등** 배율 — 먼 신호등보다 작게.
 *
 * 2.0배는 30m 밖의 우회전 후 횡단보도(C) 신호를 읽기 위한 값이다. A 신호등은 정지선 바로
 * 옆(몇 m)이라 그만큼 키울 이유가 없는데 같은 배율을 썼더니, 오른쪽 보도의 A 신호등이
 * **우회전 후 횡단보도의 보행자를 가렸다** — 내 차 뒤에서 보면 그 신호등이 정확히 C 쪽
 * 시선 위에 선다. 가까운 것은 작아도 잘 보인다.
 */
export const PED_SIGNAL_SCALE_NEAR = 1.2;

/** 보행신호등 하우징 높이의 절반 — 배율마다 다르다 */
export const pedSignalHalfHeight = (scale: number = PED_SIGNAL_SCALE): number => (0.86 * scale) / 2;

/** 배면판이 하우징 밖으로 나오는 테두리 폭 (m) — 배율을 따라간다 */
const backboardMargin = (scale: number): number => 0.22 * scale;

/**
 * 차량신호등 전체(배면판 포함) 높이의 절반.
 * 지주의 가로암 아래에 매달 때 이만큼 내려야 등화가 팔을 뚫지 않는다.
 *
 * **배율을 인자로 받는다.** 보호구역 등화가 더 작아지면서 상수 하나로는 부족해졌고,
 * 상수를 남겨 두면 작은 등화를 큰 등화 기준으로 매달아 팔에서 20cm 씩 떨어진다.
 */
export const vehicleSignalHalfHeight = (scale: number = SIGNAL_SCALE): number =>
  (0.46 * scale + backboardMargin(scale)) / 2;

/** 교차로 차량신호등(3.0배) 전체 높이의 절반 */
export const VEHICLE_SIGNAL_HALF_HEIGHT = vehicleSignalHalfHeight();

/** 진입부 보호구역 차량신호등(2.2배) 전체 높이의 절반 */
export const ZONE_SIGNAL_HALF_HEIGHT = vehicleSignalHalfHeight(ZONE_SIGNAL_SCALE);

/**
 * 점등 렌즈 주위의 발광 헤일로 텍스처.
 * 렌즈 자체를 아무리 밝게 해도 멀어지면 몇 픽셀로 줄어든다.
 * 실제 신호등도 빛번짐 때문에 렌즈보다 크게 보이므로, 그 효과를 넣어 준다.
 */
let glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

/**
 * **등화 둘레를 물들이는 점광원을 둘 것인가** — 반사(조명) '높음' 이상에서만 (quality.ts 의 usesLampLights).
 *
 * three 는 꺼진 등(세기 0)의 점광원도 모든 재질이 픽셀마다 계산한다 — 한 판에 7개 남짓이 GPU 시간의 약 25% 였다.
 * 판을 시작하기 전에 정해야 한다(main.ts) — 신호등은 Game 의 필드로 생성자보다 먼저 만들어진다.
 */
let lampLights = true;
export function setLampLights(on: boolean): void {
  lampLights = on;
}

/** 렌즈 하나. 점등 시 렌즈 자체와 주위 헤일로가 함께 켜진다. */
class Lens {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private light: THREE.PointLight | null = null;
  private glow: THREE.Sprite | null = null;
  private glowMat: THREE.SpriteMaterial | null = null;

  constructor(color: number, radius = 0.16, glowScale = 0) {
    const geo = new THREE.CircleGeometry(radius, 28);
    this.mat = new THREE.MeshStandardMaterial({
      color: OFF_COLOR,
      emissive: OFF_COLOR,
      emissiveIntensity: 0,
      roughness: 0.4,
      // 톤매핑을 거치면 점등 색이 흰색으로 날아가 적/황/녹 구분이 흐려진다
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.userData.baseColor = color;

    if (lampLights) {
      this.light = new THREE.PointLight(color, 0, 6, 2);
      this.light.position.z = 0.25;
      this.mesh.add(this.light);
    }

    if (glowScale > 0) {
      this.glowMat = new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.glow = new THREE.Sprite(this.glowMat);
      this.glow.scale.setScalar(radius * 2 * glowScale);
      this.glow.position.z = 0.06;
      this.mesh.add(this.glow);
    }
  }

  set(on: boolean, dim = false): void {
    const color = this.mesh.userData.baseColor as number;
    if (on) {
      this.mat.color.setHex(color);
      this.mat.emissive.setHex(color);
      this.mat.emissiveIntensity = dim ? 0.8 : 2.6;
      if (this.light) this.light.intensity = dim ? 0.8 : 2.4;
      if (this.glowMat) this.glowMat.opacity = dim ? 0.3 : 0.85;
    } else {
      this.mat.color.setHex(OFF_COLOR);
      this.mat.emissive.setHex(OFF_COLOR);
      this.mat.emissiveIntensity = 0;
      if (this.light) this.light.intensity = 0;
      if (this.glowMat) this.glowMat.opacity = 0;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.glowMat?.dispose();
  }
}

/** 화살표 모양 렌즈 (차량신호등의 좌회전 녹색화살표용) */
function arrowShape(): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  // 오른쪽을 가리키는 화살표
  s.moveTo(-0.13, -0.05);
  s.lineTo(0.0, -0.05);
  s.lineTo(0.0, -0.13);
  s.lineTo(0.15, 0.0);
  s.lineTo(0.0, 0.13);
  s.lineTo(0.0, 0.05);
  s.lineTo(-0.13, 0.05);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

class ArrowLens {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private light: THREE.PointLight | null = null;

  constructor(color: number, rotation = 0) {
    const geo = arrowShape();
    geo.rotateZ(rotation);
    this.mat = new THREE.MeshStandardMaterial({
      color: OFF_COLOR,
      emissive: OFF_COLOR,
      emissiveIntensity: 0,
      roughness: 0.4,
      side: THREE.DoubleSide,
      // 원형 렌즈(Lens)와 같은 조건 — 톤매핑을 거치면 초록이 한 단계 죽는다
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.userData.baseColor = color;
    if (lampLights) {
      this.light = new THREE.PointLight(color, 0, 5, 2);
      this.light.position.z = 0.25;
      this.mesh.add(this.light);
    }
  }

  set(on: boolean): void {
    const color = this.mesh.userData.baseColor as number;
    if (on) {
      this.mat.color.setHex(color);
      this.mat.emissive.setHex(color);
      this.mat.emissiveIntensity = 2.6;
      if (this.light) this.light.intensity = 2.4;
    } else {
      this.mat.color.setHex(OFF_COLOR);
      this.mat.emissive.setHex(OFF_COLOR);
      this.mat.emissiveIntensity = 0;
      if (this.light) this.light.intensity = 0;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

function housingMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x22242b, roughness: 0.75, metalness: 0.3 });
}

/**
 * 차량신호등 (4색등).
 * 왼쪽부터 적 · 황 · 좌회전화살표 · 녹.
 */
export class VehicleSignal {
  readonly group = new THREE.Group();
  private red: Lens;
  private yellow: Lens;
  private leftArrow: ArrowLens;
  private green: Lens;
  private housingMat = housingMaterial();
  private backboardMat = new THREE.MeshStandardMaterial({ color: 0x0d0e12, roughness: 0.9 });
  private housingGeo: THREE.BoxGeometry;
  private backboardGeo: THREE.BoxGeometry;
  private hoodGeo: THREE.BoxGeometry;
  private blinkPhase = 0;

  /**
   * @param S 확대 배율. 교차로는 `SIGNAL_SCALE`(3.0), 진입부 보호구역은
   *          `ZONE_SIGNAL_SCALE`(2.2) — 등화까지의 거리가 다섯 배 넘게 차이난다.
   */
  constructor(S: number = SIGNAL_SCALE) {
    const W = 1.6 * S;
    const H = 0.46 * S;
    const margin = backboardMargin(S);

    // 배면판 — 실제 신호등에도 달려 있다. 하늘·건물을 배경으로 렌즈 색이
    // 묻히지 않게 해 주는 장치라, 시인성 개선의 절반은 여기서 나온다.
    // 테두리 폭도 배율을 따라간다 — 고정값으로 두면 크게 키웠을 때 테두리만 얇아진다.
    this.backboardGeo = new THREE.BoxGeometry(W + margin, H + margin, 0.06);
    const backboard = new THREE.Mesh(this.backboardGeo, this.backboardMat);
    backboard.position.z = -0.12;
    this.group.add(backboard);

    this.housingGeo = new THREE.BoxGeometry(W, H, 0.2);
    const housing = new THREE.Mesh(this.housingGeo, this.housingMat);
    this.group.add(housing);

    // 차양 (실제 신호등의 후드)
    this.hoodGeo = new THREE.BoxGeometry(W, 0.08 * S, 0.26 * S);
    const hood = new THREE.Mesh(this.hoodGeo, this.housingMat);
    hood.position.set(0, H / 2 + 0.02 * S, 0.11 * S);
    this.group.add(hood);

    const radius = 0.16 * S;
    // 헤일로는 렌즈 지름의 3배. 49m 밖에서도 색이 또렷하게 읽힌다.
    this.red = new Lens(COLORS.red, radius, 3);
    this.yellow = new Lens(COLORS.yellow, radius, 3);
    this.leftArrow = new ArrowLens(COLORS.green, Math.PI); // 왼쪽을 가리키도록 회전
    this.green = new Lens(COLORS.green, radius, 3);

    const xs = [-0.6 * S, -0.2 * S, 0.2 * S, 0.6 * S];
    const lenses = [this.red.mesh, this.yellow.mesh, this.leftArrow.mesh, this.green.mesh];
    lenses.forEach((m, i) => {
      m.position.set(xs[i], 0, 0.11);
      this.group.add(m);
    });
  }

  set(state: LightColor, dt: number): void {
    this.blinkPhase = (this.blinkPhase + dt) % 1.0;
    const blinkOn = this.blinkPhase < 0.5;

    this.red.set(state === 'red' || (state === 'redFlash' && blinkOn));
    this.yellow.set(state === 'yellow');
    this.green.set(state === 'green');
    this.leftArrow.set(false);
  }

  dispose(): void {
    this.red.dispose();
    this.yellow.dispose();
    this.leftArrow.dispose();
    this.green.dispose();
    this.housingGeo.dispose();
    this.backboardGeo.dispose();
    this.hoodGeo.dispose();
    this.housingMat.dispose();
    this.backboardMat.dispose();
  }
}

/**
 * 우회전신호등 확대 배율.
 *
 * 차량신호등(3.0배)만큼 키우지 않는다. 이 등화는 **정지선 바로 옆 보도**에 서 있어
 * 운전자에게서 10m 남짓이라, 같은 배율로 키우면 화면을 가득 채운다.
 *
 * **1.8 → 1.2.** 1.8배로도 컸다 — 운전석에서 보면 바로 옆 보행신호등보다 훨씬 큰 검은 기둥 머리가
 * 오른쪽 화면을 차지했다 (사용자: "우회전 전용 신호등이 너무 커, 크기를 줄여 줘"). 정지선에서 11m 앞이라
 * 1.2배(높이 1.8m)로도 등화 색은 또렷이 읽힌다. 지주 꼭대기(5.6m)에 매달리므로 등화는 3.8~5.6m 에 걸려,
 * 앞쪽 보행신호등(2.8~3.4m) 위로 여전히 올라온다 — 줄였다고 다시 가려지지 않는다 (아래 RIGHT_SIGNAL_POLE_HEIGHT).
 */
const RIGHT_SIGNAL_SCALE = 1.2;

/** 우회전신호등 전체 높이의 절반 — 지주에 매달 높이를 잡는 데 쓴다 */
export const RIGHT_SIGNAL_HALF_HEIGHT = (1.5 * RIGHT_SIGNAL_SCALE) / 2;

/**
 * 우회전신호등 지주 높이 (m).
 *
 * **보행신호등(지주 3.6m·등화 2.8~3.4m)보다 높아야 한다.** 4.2m 로 두었더니 등화가
 * 2.9~4.2m 에 걸려, 운전자 시선에서 앞쪽 보행신호등과 겹쳐 **완전히 가려졌다.**
 * 5.6m 면 등화가 3.5~5.6m 에 걸려 보행신호등 머리 위로 올라온다.
 */
export const RIGHT_SIGNAL_POLE_HEIGHT = 5.6;

/**
 * 모서리가 둥근 상자 — 우회전신호등 하우징·배면판용.
 *
 * 실물이 알약 모양이라 각진 상자로 그리면 다른 신호등과 구분이 안 된다.
 */
function roundedBoxGeometry(w: number, h: number, d: number, r: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const x = w / 2 - r;
  const y = h / 2 - r;
  s.absarc(x, y, r, 0, Math.PI / 2, false);
  s.absarc(-x, y, r, Math.PI / 2, Math.PI, false);
  s.absarc(-x, -y, r, Math.PI, Math.PI * 1.5, false);
  s.absarc(x, -y, r, Math.PI * 1.5, Math.PI * 2, false);
  const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  return geo;
}

/**
 * **우회전 신호등**.
 *
 * 모양은 실물 그대로 — 알약 모양 세로 하우징에 위에서부터
 * **적색 원형 · 황색 원형 · 녹색 우회전 화살표**.
 * (셋 다 화살표인 형식도 법령에는 있지만, 국내에 설치된 우회전신호등은 이 모양이다)
 *
 * 뜻은 시행규칙 [별표 2] 그대로다.
 *   · 녹색 화살표: 화살표시 방향으로 진행할 수 있다
 *   · 황색: 정지선·횡단보도 직전에 정지 (이미 진입했으면 신속히 통과)
 *   · 적색: 정지선·횡단보도 및 교차로 직전에서 정지
 *
 * 그리고 비고 제3호 — **"우회전하려는 차마는 우회전 신호등이 있는 경우 다른 신호등에도
 * 불구하고 이에 따라야 한다."** 정면 차량신호등이 녹색이어도 이 등화가 적색이면 우회전할 수
 * 없고, 반대로 정면이 적색이어도 이 등화가 녹색이면 서지 않고 우회전할 수 있다.
 */
export class RightTurnSignal {
  readonly group = new THREE.Group();
  /** 적·황은 **원형**, 녹색만 우회전 화살표 (실물 그대로) */
  private red: Lens;
  private yellow: Lens;
  private green: ArrowLens;
  private housingMat = housingMaterial();
  private backboardMat = new THREE.MeshStandardMaterial({ color: 0x0d0e12, roughness: 0.9 });
  private geos: THREE.BufferGeometry[] = [];

  constructor() {
    const S = RIGHT_SIGNAL_SCALE;
    const W = 0.52 * S;
    const H = 1.5 * S;

    // 알약 모양 — 반지름은 폭의 절반이라 위아래가 완전히 둥글다
    const backboardGeo = roundedBoxGeometry(W + 0.1 * S, H + 0.1 * S, 0.06, (W + 0.1 * S) / 2);
    this.geos.push(backboardGeo);
    const backboard = new THREE.Mesh(backboardGeo, this.backboardMat);
    backboard.position.z = -0.1;
    this.group.add(backboard);

    const housingGeo = roundedBoxGeometry(W, H, 0.2, W / 2);
    this.geos.push(housingGeo);
    this.group.add(new THREE.Mesh(housingGeo, this.housingMat));

    const radius = 0.19 * S;
    const ys = [0.46 * S, 0, -0.46 * S];
    // 위에서부터 적색 원형 · 황색 원형 · 녹색 우회전 화살표
    this.red = new Lens(COLORS.red, radius, 2.6);
    this.yellow = new Lens(COLORS.yellow, radius, 2.6);
    this.green = new ArrowLens(COLORS.green);
    this.red.mesh.position.set(0, ys[0], 0.11);
    this.yellow.mesh.position.set(0, ys[1], 0.11);
    this.green.mesh.scale.setScalar(S * 1.35);
    this.green.mesh.position.set(0, ys[2], 0.11);
    this.group.add(this.red.mesh, this.yellow.mesh, this.green.mesh);
  }

  set(state: RightArrowColor): void {
    this.red.set(state === 'redArrow');
    this.yellow.set(state === 'yellowArrow');
    this.green.set(state === 'greenArrow');
  }

  dispose(): void {
    this.red.dispose();
    this.yellow.dispose();
    this.green.dispose();
    for (const g of this.geos) g.dispose();
    this.housingMat.dispose();
    this.backboardMat.dispose();
  }
}

/** 보행신호등 — 사람 픽토그램을 캔버스로 그려 렌즈에 붙인다 */
function pedestrianLensTexture(walking: boolean, color: string): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0b0c10';
  ctx.fillRect(0, 0, S, S);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';

  // 머리
  ctx.beginPath();
  ctx.arc(S / 2, 30, 11, 0, Math.PI * 2);
  ctx.fill();
  // 몸통
  ctx.beginPath();
  ctx.moveTo(S / 2, 44);
  ctx.lineTo(S / 2, 76);
  ctx.stroke();

  if (walking) {
    // 걷는 자세
    ctx.beginPath();
    ctx.moveTo(S / 2, 76);
    ctx.lineTo(S / 2 - 18, 104);
    ctx.moveTo(S / 2, 76);
    ctx.lineTo(S / 2 + 16, 100);
    ctx.moveTo(S / 2, 52);
    ctx.lineTo(S / 2 + 20, 64);
    ctx.moveTo(S / 2, 52);
    ctx.lineTo(S / 2 - 18, 62);
    ctx.stroke();
  } else {
    // 서 있는 자세
    ctx.beginPath();
    ctx.moveTo(S / 2, 76);
    ctx.lineTo(S / 2 - 11, 104);
    ctx.moveTo(S / 2, 76);
    ctx.lineTo(S / 2 + 11, 104);
    ctx.moveTo(S / 2, 52);
    ctx.lineTo(S / 2 - 15, 72);
    ctx.moveTo(S / 2, 52);
    ctx.lineTo(S / 2 + 15, 72);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 보행신호등 하우징 높이의 절반 — 지주 길이를 여기에 맞춘다 */
export const PED_SIGNAL_HALF_HEIGHT = pedSignalHalfHeight();

/** 보행신호등 지주 높이 (m). 키운 등화가 보도 위로 충분히 떠 있도록 함께 올렸다. */
export const PED_SIGNAL_POLE_HEIGHT = 3.6;

/**
 * 진입 전 횡단보도(A) 보행신호등의 지주 높이 (m) — 등화를 줄인 만큼 함께 낮춘다.
 * 높게 두면 작은 등화가 허공에 떠 보이고, 낮을수록 너머의 보행자 머리를 덜 가린다.
 */
export const PED_SIGNAL_POLE_HEIGHT_NEAR = 3.0;

export class PedestrianSignal {
  readonly group = new THREE.Group();
  private redMat: THREE.MeshStandardMaterial;
  private greenMat: THREE.MeshStandardMaterial;
  private redTex: THREE.CanvasTexture;
  private greenTex: THREE.CanvasTexture;
  private housingMat = housingMaterial();
  private geos: THREE.BufferGeometry[] = [];
  private blinkPhase = 0;

  /** @param scale 확대 배율 — 기본은 먼 신호등(C·S)용, 가까운 A 는 `PED_SIGNAL_SCALE_NEAR` */
  constructor(scale: number = PED_SIGNAL_SCALE) {
    const S = scale;
    const housingGeo = new THREE.BoxGeometry(0.44 * S, 0.86 * S, 0.18 * S);
    this.geos.push(housingGeo);
    this.group.add(new THREE.Mesh(housingGeo, this.housingMat));

    this.redTex = pedestrianLensTexture(false, CSS_RED);
    this.greenTex = pedestrianLensTexture(true, CSS_GREEN);

    const lensGeo = new THREE.PlaneGeometry(0.32 * S, 0.32 * S);
    this.geos.push(lensGeo);

    this.redMat = new THREE.MeshStandardMaterial({
      map: this.redTex,
      emissiveMap: this.redTex,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      color: 0x2a2a2a,
    });
    this.greenMat = new THREE.MeshStandardMaterial({
      map: this.greenTex,
      emissiveMap: this.greenTex,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      color: 0x2a2a2a,
    });

    const red = new THREE.Mesh(lensGeo, this.redMat);
    red.position.set(0, 0.2 * S, 0.1 * S);
    const green = new THREE.Mesh(lensGeo, this.greenMat);
    green.position.set(0, -0.2 * S, 0.1 * S);
    this.group.add(red, green);
  }

  set(state: PedSignal, dt: number): void {
    this.blinkPhase = (this.blinkPhase + dt) % 0.8;
    const blinkOn = this.blinkPhase < 0.4;

    const redOn = state === 'red';
    const greenOn = state === 'green' || (state === 'greenFlash' && blinkOn);

    this.redMat.emissiveIntensity = redOn ? 1.8 : 0;
    this.redMat.color.setHex(redOn ? 0xffffff : 0x2a2a2a);
    this.greenMat.emissiveIntensity = greenOn ? 1.8 : 0;
    this.greenMat.color.setHex(greenOn ? 0xffffff : 0x2a2a2a);
  }

  dispose(): void {
    this.redMat.dispose();
    this.greenMat.dispose();
    this.redTex.dispose();
    this.greenTex.dispose();
    this.housingMat.dispose();
    for (const g of this.geos) g.dispose();
  }
}

/**
 * 가로암의 높이 (m).
 *
 * 확대한 등화(높이 1.6m)를 이 아래에 매달아도 도로면에서 4.5m 이상 떠 있어야 한다.
 * 실제 신호등의 설치 높이 기준(노면에서 4.5~5.5m)과 같은 조건이다.
 */
export const SIGNAL_ARM_Y = 7.2;

/** 신호등을 매다는 지주(폴) + 가로암 */
export function makeSignalPole(armLength: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4c5057, roughness: 0.6, metalness: 0.55 });

  const poleHeight = SIGNAL_ARM_Y + 0.1;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, poleHeight, 10), mat);
  pole.position.y = poleHeight / 2;
  pole.castShadow = true;
  g.add(pole);

  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, armLength, 8), mat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(armLength / 2, SIGNAL_ARM_Y, 0);
  arm.castShadow = true;
  g.add(arm);

  return g;
}
