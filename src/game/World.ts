/**
 * 씬 환경 — 하늘, 조명, 안개, 비.
 * 시간대(낮/황혼/야간)와 날씨(맑음/비)에 따라 분위기와 시야를 바꾼다.
 * 야간·우천은 실제로 우회전 사고가 잦은 조건이므로 난이도 요소이기도 하다.
 */

import * as THREE from 'three';
import { TONE_MAPPING_EXPOSURE } from './renderer';
import { applyEnvironment, cachedEnvironment, nearCarEnv as bakeNearCarEnv, setEnvironment } from './environment';
import {
  defaultGraphics,
  reflectionScale,
  shadowSpec,
  usesEnvironment,
  type GraphicsSettings,
} from './quality';
import type { TimeOfDay, Weather } from '../scenarios/scenarios';

interface Palette {
  skyTop: number;
  skyBottom: number;
  fog: number;
  sun: number;
  sunIntensity: number;
  ambient: number;
  ambientIntensity: number;
  fogDensity: number;
  sunPosition: [number, number, number];
}

const PALETTES: Record<TimeOfDay, Palette> = {
  day: {
    skyTop: 0x6ba2e0,
    skyBottom: 0xd3e4f5,
    fog: 0xc6d8ea,
    sun: 0xfff4e0,
    sunIntensity: 2.6,
    ambient: 0xb9cadd,
    ambientIntensity: 2.1,
    fogDensity: 0.0028,
    sunPosition: [50, 70, 30],
  },
  dusk: {
    skyTop: 0x32406b,
    skyBottom: 0xe8964c,
    fog: 0x8a6a68,
    sun: 0xffb166,
    sunIntensity: 1.7,
    ambient: 0x7b7896,
    ambientIntensity: 1.35,
    fogDensity: 0.0055,
    sunPosition: [-70, 22, -20],
  },
  /*
    **밤은 어둡되, 보이기는 해야 한다.**

    사용자가 야간 판을 보고 "너무 어두워서 시야 확보가 어렵다" 고 했다. 이 게임에서 밤이 어려운 까닭은
    **보행자가 늦게 보이는 것**이지 도로가 안 보이는 것이 아니다 — 아무것도 안 보이면 배울 것이 없고
    운이 된다. 그래서 달빛(sun)과 하늘빛(ambient)을 한 단계씩 올리고, 짙던 안개를 걷었다.
    밤의 성격(파란 기운 · 낮은 대비)은 그대로 두고 밝기만 올린 값이다.
  */
  night: {
    skyTop: 0x141d31,
    skyBottom: 0x27355c,
    fog: 0x1b2438,
    sun: 0x6679a8,
    sunIntensity: 0.75,
    ambient: 0x4a5a8c,
    ambientIntensity: 1.45,
    fogDensity: 0.006,
    sunPosition: [-40, 60, -40],
  },
};

function makeSkyTexture(top: number, bottom: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, `#${top.toString(16).padStart(6, '0')}`);
  g.addColorStop(0.62, `#${bottom.toString(16).padStart(6, '0')}`);
  g.addColorStop(1, `#${bottom.toString(16).padStart(6, '0')}`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * three 의 ACES 필름 톤매핑을 그대로 옮긴 것 (ShaderChunk/tonemapping_pars_fragment — 행렬은 열 순서로 적혀 있다).
 * 선형 색을 받아 선형 색을 돌려준다. 바탕색을 하늘과 같은 빛으로 맞추는 데만 쓴다 (아래 생성자).
 */
export function acesToneMapped(linear: THREE.Color, exposure: number): THREE.Color {
  const e = exposure / 0.6;
  const r = linear.r * e;
  const g = linear.g * e;
  const b = linear.b * e;
  const r1 = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const g1 = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const b1 = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const r2 = fit(r1);
  const g2 = fit(g1);
  const b2 = fit(b1);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return new THREE.Color(
    clamp(1.60475 * r2 - 0.53108 * g2 - 0.07367 * b2),
    clamp(-0.10208 * r2 + 1.10813 * g2 - 0.00605 * b2),
    clamp(-0.00327 * r2 - 0.07276 * g2 + 1.07602 * b2),
  );
}

/**
 * 하늘 텍스처의 **어느 고도의 색** — makeSkyTexture 의 그라데이션과 같은 셈이다. 캔버스 그라데이션은 sRGB 에서
 * 직선 보간하고, 위(skyTop)에서 0.62 지점까지 내려오며 skyBottom 이 된다. 구의 v 는 위 극이 1 · 지평선이 0.5 · 아래
 * 극이 0 이고(SphereGeometry 의 uv, 캔버스 텍스처는 flipY), 캔버스의 세로 위치는 1 - v 다. 그래서 눈에 보이는
 * 하늘(지평선 위)은 **skyBottom 이 아니라** 그 위쪽의 섞인 색이다 — 지평선에서 81%, 20° 위에서 65% 쯤 skyBottom 쪽.
 */
export function skyColorAt(top: number, bottom: number, elevationDeg: number): THREE.Color {
  const v = 0.5 + elevationDeg / 180;
  const t = Math.min(1, Math.max(0, (1 - v) / 0.62));
  const ch = (hex: number, shift: number) => (hex >> shift) & 0xff;
  const mix = (shift: number) => (ch(top, shift) + (ch(bottom, shift) - ch(top, shift)) * t) / 255;
  return new THREE.Color().setRGB(mix(16), mix(8), mix(0), THREE.SRGBColorSpace);
}

/** 바탕색이 맞추는 고도 — 눈에 보이는 하늘(지평선 ~ 20°)의 가운데쯤 (아래 생성자의 바탕색 주석) */
export const BACKGROUND_SKY_ELEVATION_DEG = 10;

export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly isNight: boolean;
  readonly isWet: boolean;

  private rain: THREE.Points | null = null;
  private rainVelocity: Float32Array | null = null;
  private disposables: Array<{ dispose(): void }> = [];
  /** 환경맵이 들어오면 세기를 낮춘다 — 둘 다 세면 그림자가 사라지고 화면이 허옇게 뜬다 */
  private hemi!: THREE.HemisphereLight;

  constructor(
    private timeOfDay: TimeOfDay,
    weather: Weather,
    /**
     * 화질 설정. 넘기지 않으면 기본값(높음)이다 — 좌석 맞추기·첫 화면 배경처럼
     * 설정을 들고 다니지 않는 곳에서 그대로 쓴다.
     */
    private graphics: GraphicsSettings = defaultGraphics(),
    /** 손에 든 화면인가 — 비 방울을 화면 크기로 키우지 않는다 (buildRain). 첫 화면 · 좌석 화면은 비가 없어 넘기지 않는다 */
    private handheld = false,
  ) {
    const p = PALETTES[timeOfDay];
    this.isNight = timeOfDay === 'night';
    this.isWet = weather === 'rain';

    // 비가 오면 시야가 더 나빠진다
    const fogDensity = p.fogDensity * (this.isWet ? 2.1 : 1);
    this.scene.fog = new THREE.FogExp2(p.fog, fogDensity);

    const skyTex = this.track(makeSkyTexture(p.skyTop, p.skyBottom));
    const skyGeo = this.track(new THREE.SphereGeometry(420, 24, 16));
    const skyMat = this.track(
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
    );
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
    /*
      **바탕색은 하늘의 아랫빛 — 검정이 아니다.**

      three 는 그리기 전에 바탕색으로 지우는데 기본이 검정이다. 하늘 구가 화면을 다 덮으니 정상이라면 바탕색이 보일
      일이 없다. 그런데 사용자 휴대폰(삼성 Xclipse 940 · ANGLE-Vulkan)에서는 드라이버가 프레임의 한 구역을 통째로
      빠뜨린다 — 진단 줄이 그림 버퍼 안의 순검정 띠로 잡았다(CHANGELOG). 구역이 빠지면 바탕색이 드러나므로,
      바탕색을 눈에 보이는 하늘빛으로 두면 그 띠가 하늘색에 가까워 훨씬 덜 보인다. 눈에 보이는 하늘은 지평선부터
      20° 남짓까지의 그라데이션이라 한 색으로 다 맞출 수는 없고, 그 가운데(10°)의 색을 잡는다(skyColorAt). 하늘 구는
      톤매핑을 거치지만 three 는 바탕색을 톤매핑하지 않으므로(WebGLBackground), 같은 톤매핑을 미리 거친 값을 준다 —
      헤드리스로 하늘을 감추고 잰 바탕이 10° 언저리의 하늘과 같았다.
    */
    this.scene.background = acesToneMapped(
      skyColorAt(p.skyTop, p.skyBottom, BACKGROUND_SKY_ELEVATION_DEG),
      TONE_MAPPING_EXPOSURE,
    );

    this.sun = new THREE.DirectionalLight(p.sun, p.sunIntensity);
    this.sun.position.set(...p.sunPosition);
    /*
      그림자 — 설정이 정한다 (game/quality.ts).

      '낮음'이면 `castShadow` 를 꺼서 **그림자 패스를 통째로 없앤다.** 맵 크기만 줄이면
      드로우콜은 그대로라, 이 게임의 병목(드로우콜)에는 거의 듣지 않는다.
      실측으로 이 패스가 프레임당 42~78콜, 전체의 10~19% 다.
    */
    const shadow = shadowSpec(this.graphics.shadow);
    this.sun.castShadow = shadow.on;
    this.sun.shadow.mapSize.set(shadow.size, shadow.size);
    const cam = this.sun.shadow.camera;
    cam.left = -60;
    cam.right = 60;
    cam.top = 60;
    cam.bottom = -60;
    cam.near = 1;
    cam.far = 220;
    this.sun.shadow.bias = -0.0006;
    // 조명은 모든 레이어를 비춘다. three 는 오브젝트와 조명의 레이어가 겹칠 때만 빛을 계산하므로,
    // 전용 레이어로 뺀 물체(예: 거울에서 제외한 차체 셸)가 새까맣게 렌더되는 것을 막는다.
    this.sun.layers.enableAll();
    this.scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(p.skyTop, p.ambient, p.ambientIntensity);
    this.hemi.layers.enableAll();
    this.scene.add(this.hemi);

    if (this.isWet) this.buildRain();
  }

  /**
   * HDRI 환경광을 입힌다. 렌더러가 필요하므로 생성 직후 따로 호출한다.
   *
   * **이미 구워 둔 것이 있으면 그 자리에서 건다.** 환경맵을 나중에 걸면 장면의 모든 재질이
   * 다시 컴파일된다 — 차 한 대에 재질이 수십 개라 그 프레임이 통째로 멈춘다. 첫 프레임
   * 전에 걸어 두면 컴파일이 한 번으로 끝난다(메뉴에서 미리 굽는다 → bakeEnvironment).
   *
   * 굽지 못한 시간대라면 비동기로 받아 나중에 건다 — 그때는 한 번 멈칫하지만, 환경광이
   * 아예 없는 것보다는 낫다.
   *
   * **환경맵은 dispose 하지 않는다.** 시간대별로 캐시가 들고 있어 다음 판에서도 그대로 쓴다.
   */
  loadEnvironment(renderer: THREE.WebGLRenderer): Promise<void> {
    /*
      반사 '낮음' 이면 환경맵을 **아예 걸지 않는다.**

      재질마다 하던 환경 샘플링이 사라지고, HDR 세 장(4.5MB)을 받아 굽는 일도 건너뛴다.
      차체 반사가 없어질 뿐 판정과 조명은 그대로다 — 반구광이 남아 있다.
    */
    if (!usesEnvironment(this.graphics.reflection)) return Promise.resolve();

    const ready = cachedEnvironment(this.timeOfDay);
    if (ready) {
      setEnvironment(this.scene, this.timeOfDay, ready, reflectionScale(this.graphics.reflection));
      this.dimHemi();
      return Promise.resolve();
    }
    return applyEnvironment(
      this.scene,
      renderer,
      this.timeOfDay,
      reflectionScale(this.graphics.reflection),
    ).then((env) => {
      if (env) this.dimHemi();
    });
  }

  /**
   * **코앞 차(내 차 · 앞차 · 뒷차)에 걸 환경맵** — 화질과 무관하게 늘 돌려준다 (environment.ts 의 nearCarEnv).
   *
   * 장면 전체의 환경맵(loadEnvironment)은 설정을 따른다. 이것은 따로다 — 배경은 '낮음' 대로 가라앉아도
   * 이 차들만은 비쳐야 하기 때문이다. 낮음에서는 이 하늘색으로 작은 환경맵을 그 자리에서 굽는다.
   */
  nearCarEnv(renderer: THREE.WebGLRenderer): { map: THREE.Texture; intensity: number } | null {
    const p = PALETTES[this.timeOfDay];
    return bakeNearCarEnv(
      renderer,
      this.timeOfDay,
      { top: p.skyTop, bottom: p.skyBottom },
      // '아주 높음' 에서는 그쪽이 더 좋다 — 보장은 하한이지 고정이 아니다
      this.graphics.reflection,
    );
  }

  /**
   * 기존 반구광은 환경맵이 없다는 전제로 맞춰 둔 값이다. 그대로 두면 주변광이 두 배가 되어
   * 아스팔트가 회색으로 뜨고 그림자가 묻힌다. (두 번 부르지 않도록 표시를 남긴다)
   */
  private hemiDimmed = false;
  private dimHemi(): void {
    if (this.hemiDimmed) return;
    this.hemiDimmed = true;
    this.hemi.intensity *= 0.8;
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private buildRain(): void {
    /*
      **손에 든 화면에서는 방울을 화면 픽셀 크기로 그린다** (sizeAttenuation 을 끈다).

      방울은 카메라 둘레 ±55m 에 흩어져 매 프레임 떨어지는데, 거리에 비례해 키우면 **카메라 코앞을 지나는 방울 하나가
      화면만 한 사각형**이 된다 — 잘라 내기도 끈 점(Points)이라 늘 그려진다. 타일 방식의 휴대폰 GPU 는 그런 원시
      도형에 약하다(보행자 느낌표 판에서 같은 일을 겪었다). 픽셀 크기로 고정하면 가장 큰 방울도 점 하나다.
      방울 수도 절반으로 — 낮은 화면이라 절반이어도 빗줄기로 읽힌다. PC 는 그대로다.
    */
    const COUNT = this.handheld ? 2200 : 4500;
    const positions = new Float32Array(COUNT * 3);
    this.rainVelocity = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 120;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 120;
      this.rainVelocity[i] = 22 + Math.random() * 14;
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = this.track(
      new THREE.PointsMaterial({
        color: 0xaac4dd,
        size: this.handheld ? 2 : 0.12,
        sizeAttenuation: !this.handheld,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    this.rain = new THREE.Points(geo, mat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  /** 비를 카메라 주변에 따라다니게 하고 낙하시킨다 */
  update(dt: number, focus: THREE.Vector3): void {
    // 그림자 카메라를 플레이어 주변으로 옮겨 해상도를 아낀다
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.position.set(focus.x + 50, 70, focus.z + 30);

    if (!this.rain || !this.rainVelocity) return;
    const attr = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.rainVelocity.length; i++) {
      arr[i * 3 + 1] -= this.rainVelocity[i] * dt;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3] = focus.x + (Math.random() - 0.5) * 110;
        arr[i * 3 + 1] = 34 + Math.random() * 12;
        arr[i * 3 + 2] = focus.z + (Math.random() - 0.5) * 110;
      }
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    /*
      **그림자 맵까지 버린다.** 조명은 track 목록에 없고 `scene.clear()` 는 붙어 있던 것을 떼어 낼 뿐이라, 태양이
      처음 그려질 때 만든 그림자 맵(렌더 타깃 — '보통' 512² 에 2MB · '아주 높음' 2048² 에 32MB)이 판마다, 그리고
      첫 화면의 World 마다 GPU 에 남았다. 렌더러 한 벌을 계속 쓰므로(renderer.ts) 스스로 사라지지 않는다 — 사용자
      휴대폰에서 판을 거듭하면 검은 줄이 생기던 누적의 하나다 (CHANGELOG).
    */
    this.sun.dispose();
    this.hemi.dispose();
    this.scene.clear();
  }
}
