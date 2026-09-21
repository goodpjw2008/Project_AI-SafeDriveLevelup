/**
 * 환경광 (HDRI 기반 이미지 라이팅).
 *
 * 지금까지 조명은 태양광 하나와 반구광 하나뿐이었다. 그래서 차체 도장은 금속인데도
 * 반사할 것이 없어 플라스틱처럼 보이고, 유리도 그냥 어두운 판이었다.
 * **환경맵**을 넣으면 재질이 주변을 반사하기 시작한다 — 모델을 바꾸지 않고도
 * 화면 품질이 가장 크게 오르는 지점이다.
 *
 * 배경(하늘·건물)은 지금처럼 절차적으로 그린 것을 그대로 쓴다.
 * HDRI 사진을 배경으로 깔면 로우폴리 도시와 톤이 부딪힌다 — **조명으로만** 쓴다.
 *
 * 에셋: Poly Haven (CC0). 출처는 크레딧 화면에 표기한다.
 */

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { TimeOfDay } from '../scenarios/scenarios';
import { reflectionScale, type QualityTier } from './quality';

/** 시간대별 HDRI 파일과 출처 */
export const HDRI_ASSETS: Record<TimeOfDay, { file: string; name: string; author: string }> = {
  day: { file: 'wide_street_01', name: 'Wide Street 01', author: 'Sergej Majboroda' },
  dusk: { file: 'vatican_road', name: 'Vatican Road', author: 'Greg Zaal' },
  night: { file: 'shanghai_bund', name: 'Shanghai Bund', author: 'Greg Zaal' },
};

/*
  환경맵 세기.

  낮게 잡는다. 이 게임에서 환경맵의 값어치는 **금속·유리에 비치는 반사**이지 밝기가 아니다.
  세게 걸면 아스팔트까지 허옇게 떠서 노면표시 대비가 무너지고, 그림자도 묻힌다.
*/
const INTENSITY: Record<TimeOfDay, number> = { day: 0.3, dusk: 0.25, night: 0.26 };

/**
 * **푼 HDR 을 파일별로 기억한다.**
 *
 * 주행을 시작할 때마다 1.5MB 짜리 .hdr 을 다시 받아 다시 푸는 것이 로딩 지연의 큰 몫이었다
 * (10번 시나리오는 시간대가 매번 달라져 세 장을 번갈아 쓴다). 푼 결과는 CPU 쪽 데이터라
 * 렌더러가 바뀌어도 그대로 쓸 수 있다 — GPU 업로드만 다시 일어난다.
 *
 * 지우지 않는다. 세 장을 다 안고 있어도 수십 MB 수준이고, 한 판마다 다시 푸는 값이 더 크다.
 */
const hdrCache = new Map<string, THREE.DataTexture>();

/**
 * **구운 환경맵을 시간대별로 기억한다.**
 *
 * 예전에는 판마다 PMREMGenerator 를 새로 만들어 다시 구웠다. HDR 을 캐시해도 굽는 값은
 * 그대로 든다 — 셰이더를 컴파일하고(compileEquirectangularShader) 밉맵 여섯 단을 GPU 에서
 * 다시 그린다. 게다가 다 구운 텍스처를 판이 끝날 때 dispose 해 버려서, 같은 시간대를
 * 다시 골라도 처음부터였다.
 *
 * 굽는 결과는 시간대에만 달려 있으므로 한 번 구워 계속 쓴다. **지우지 않는다** —
 * 세 장을 다 안고 있어도 몇 MB 수준이고, 한 판마다 다시 굽는 값이 훨씬 크다.
 */
const envCache = new Map<TimeOfDay, THREE.Texture>();

/** 이미 구워 둔 환경맵 — 없으면 null. 첫 프레임 전에 쓸 수 있는지 판단하는 데 쓴다. */
export function cachedEnvironment(time: TimeOfDay): THREE.Texture | null {
  return envCache.get(time) ?? null;
}

/**
 * 장면에 환경맵을 건다.
 *
 * 세기는 **시간대 × 화질**이다. 시간대가 기본값을 정하고(밤이 낮보다 약하다), 화질
 * 설정이 그 위에 배수를 곱한다 — 반사를 낮추면 차체에 비치는 하늘이 옅어진다.
 * 0 이면 부르는 쪽에서 아예 걸지 않는다 (World.loadEnvironment).
 */
export function setEnvironment(
  scene: THREE.Scene,
  time: TimeOfDay,
  env: THREE.Texture,
  scale = 1,
): void {
  scene.environment = env;
  scene.environmentIntensity = INTENSITY[time] * scale;
}

/**
 * **코앞 차 전용 환경맵** — 화질을 어디까지 낮춰도 내 차 · 앞차 · 뒷차는 비친다.
 *
 * 사용자가 정했다: "전체 프리셋 중에서 모든 상태에서 내 차의 품질은 보장되는 거야", "뒤차도 눈에 가장 많이
 * 띄는 부분이야". 화면에서 가장 오래 보는 것이 이 세 대이고, 차체가 반사할 것이 없으면 금속 도장이
 * 플라스틱처럼 보인다 — 이 파일 맨 위에 적어 둔, 환경맵을 들인 바로 그 이유다.
 *
 * 그런데 **'낮음' 은 장면에 환경맵을 걸지 않는다** (HDR 4.5MB 를 받지도 굽지도 않는다). 그래서 낮음에서는
 * 하늘색 두 가지로 **작은 환경맵을 그 자리에서 굽는다**(64×32). 받을 것이 없고 굽는 값도 무시할 만하며,
 * 비치는 것은 하늘과 땅뿐이라 로우폴리 도시와도 부딪히지 않는다. 이미 HDRI 가 구워져 있으면(보통 이상,
 * 또는 낮음으로 내리기 전에 구워 둔 것) 그것을 그대로 쓴다 — 더 좋은 것이 있는데 흉내를 낼 이유가 없다.
 *
 * 세기는 **'높음' 을 바닥으로 둔다** — 설정이 그보다 좋으면(아주 높음) 그쪽을 따른다. 보장은 하한이지 고정이
 * 아니다. 장면 전체의 세기(scene.environmentIntensity)와
 * 따로 노는 값인데, three 는 **재질에 envMap 이 직접 걸려 있으면 재질의 세기를 쓰기** 때문이다
 * (WebGLRenderer 의 `material.envMap === null` 분기). 그래서 배경은 설정대로 가라앉고 내 차만 그대로다.
 */
export function nearCarEnv(
  renderer: THREE.WebGLRenderer,
  time: TimeOfDay,
  /** 낮음에서 구울 하늘색 — World 의 팔레트를 그대로 받는다 (배경과 같은 하늘을 비춘다) */
  sky: { top: number; bottom: number },
  /** 지금 화질의 반사 단계 — 이보다 낮아지지 않게만 한다 */
  tier: QualityTier = 'high',
): { map: THREE.Texture; intensity: number } | null {
  const map = envCache.get(time) ?? cheapSky(renderer, time, sky);
  if (!map) return null;
  const scale = Math.max(reflectionScale(tier), reflectionScale('high'));
  return { map, intensity: INTENSITY[time] * scale };
}

/** 낮음용 간이 환경맵 — 시간대마다 한 번만 굽는다 */
const cheapCache = new Map<TimeOfDay, THREE.Texture>();

function cheapSky(
  renderer: THREE.WebGLRenderer,
  time: TimeOfDay,
  sky: { top: number; bottom: number },
): THREE.Texture | null {
  const done = cheapCache.get(time);
  if (done) return done;
  try {
    const c = document.createElement('canvas');
    // 위아래로만 변하는 그림이라 가로는 몇 픽셀이면 된다 — 구울 때 구면으로 퍼진다
    c.width = 64;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, hex(sky.top));
    // 지평선 아래는 노면이다 — 하늘만 비치면 차 아랫면이 떠 보인다
    g.addColorStop(0.5, hex(sky.bottom));
    g.addColorStop(0.52, '#2a2d33');
    g.addColorStop(1, '#15171a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    tex.dispose();
    cheapCache.set(time, env);
    return env;
  } catch {
    // 반사는 있으면 좋은 것이지 없으면 안 되는 것이 아니다 (이 파일의 다른 곳과 같은 원칙)
    return null;
  }
}

/**
 * HDR 을 받아 환경맵으로 **굽기만** 한다 (장면에는 걸지 않는다).
 *
 * 메뉴에 있는 동안 미리 불러 두는 용도다. 여기서 다 해 두면 주행을 시작할 때는 캐시에서
 * 꺼내 거는 것으로 끝난다 — 그래야 첫 프레임부터 환경맵이 걸린 상태로 셰이더가 컴파일된다.
 * (환경맵을 나중에 걸면 **장면의 모든 재질이 다시 컴파일된다** — 그게 주행 중 끊김이었다)
 */
export async function bakeEnvironment(
  renderer: THREE.WebGLRenderer,
  time: TimeOfDay,
): Promise<THREE.Texture | null> {
  const done = envCache.get(time);
  if (done) return done;

  const asset = HDRI_ASSETS[time];
  try {
    let hdr = hdrCache.get(asset.file);
    if (!hdr) {
      hdr = await new RGBELoader().setPath('hdri/').loadAsync(`${asset.file}.hdr`);
      hdrCache.set(asset.file, hdr);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromEquirectangular(hdr).texture;
    // hdr 은 캐시가 들고 있으므로 지우지 않는다
    pmrem.dispose();
    envCache.set(time, env);
    return env;
  } catch {
    // 환경맵은 있으면 좋은 것이지 없으면 안 되는 것이 아니다
    return null;
  }
}

/**
 * HDRI 를 받아 환경맵으로 굽고 장면에 건다.
 *
 * 실패해도 게임은 그대로 돌아간다 — 단일 파일 빌드를 file:// 로 열면 fetch 가 막히는데,
 * 그때는 환경광 없이 기존 조명만으로 렌더된다.
 */
export async function applyEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  time: TimeOfDay,
  scale = 1,
): Promise<THREE.Texture | null> {
  const env = await bakeEnvironment(renderer, time);
  if (env) setEnvironment(scene, time, env, scale);
  return env;
}
