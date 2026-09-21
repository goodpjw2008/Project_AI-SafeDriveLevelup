/**
 * 자동차전시관 카드에 넣을 차 그림을 굽는다.
 *
 * 예전에는 사진을 등록하기 전까지 아홉 칸이 모두 "사진 없음" 이라는 회색 글자였다.
 * 파는 물건을 글자만으로 고르게 하는 화면이었던 셈이다.
 *
 * **3D 모델(glb)이 아니라 절차적 차체를 쓴다.** 모델은 한 대에 1~5MB 라 아홉 대를 다
 * 받으면 20MB가 넘는데, 그것도 목록을 한 번 보려고 받는 값이다. 절차적 차체는 카탈로그의
 * 치수·색(cars.ts 의 dims·color)으로 그 자리에서 빚으므로 **받을 것이 없고**, 차종마다
 * 길이·높이·루프라인·색이 달라 아홉 장이 서로 다르게 보인다.
 *
 * **렌더러는 따로 한 벌 만들고 다 굽고 나면 버린다.** 주행 화면의 렌더러(renderer.ts)를
 * 쓰면 보이는 캔버스에 차 그림이 한 장씩 찍혔다 지워진다. WebGL 컨텍스트는 브라우저마다
 * 한도가 있어(보통 16개) 남겨 두지 않는다.
 */

import * as THREE from 'three';

import type { CarSpec } from '../economy/cars';
import { buildCar } from './CarMesh';

/** 구운 그림 (data URL). 전시관을 여닫을 때마다 다시 굽지 않는다. */
const cache = new Map<string, string>();

/**
 * 카드가 4:3 으로 보여 주므로 그 비율로 굽는다.
 *
 * **720px 은 CSS 폭의 두 배 언저리를 노린 값이다.** 훈련 화면의 '지금 타는 차' 가
 * 373px 로 커지면서(index.html 의 `.ai-car-photo`) 480px 로는 레티나에서 물렁해졌다 —
 * 차종이 구별되라고 키운 그림이 흐리면 키운 뜻이 없다.
 *
 * 레티나가 요구하는 746px 에 26px 모자라지만 거기서 멈춘다. 960px 으로 올리면 메모리가
 * 1.8배가 되는데, 4% 를 메우자고 치를 값은 아니다.
 *
 * 굽는 값은 한 번뿐이고(아래 cache) 저장본에도 들어가지 않으므로 — 등록한 사진과
 * 달리 localStorage 를 건드리지 않는다 — 늘어나는 것은 그 탭이 살아 있는 동안의
 * 메모리뿐이다.
 */
const W = 720;
const H = 540;

/**
 * 그림 한 장을 굽는다. 같은 차를 다시 물으면 캐시를 준다.
 *
 * WebGL 을 쓸 수 없는 환경(컨텍스트 생성 실패)에서는 null 을 돌려준다 — 부르는 쪽이
 * 예전처럼 "사진 없음" 자리를 그대로 두면 된다. 그림이 없다고 전시관이 막히면 안 된다.
 */
export function carThumbnail(spec: CarSpec): string | null {
  const hit = cache.get(spec.id);
  if (hit) return hit;

  const renderer = acquire();
  if (!renderer) return null;

  const scene = new THREE.Scene();

  /*
    빛은 **세 개**다. 환경맵(HDRI)을 쓰면 그림이 훨씬 좋아지지만 1.5MB 를 받아 굽는
    값이라, 목록 그림 아홉 장을 위해 치를 값은 아니다.
      - 하늘/땅 빛으로 전체를 띄우고
      - 위 앞쪽에서 주광을 넣어 보닛과 지붕에 면을 만들고
      - 뒤쪽에서 약한 빛으로 윤곽을 떼어 배경과 붙지 않게 한다
  */
  scene.add(new THREE.HemisphereLight(0xc8dbff, 0x2a3040, 2.6));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(5, 7, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd6ff, 1.8);
  rim.position.set(-6, 3.5, -5);
  scene.add(rim);

  const car = buildCar(spec, { isPlayer: false });
  scene.add(car.group);

  /*
    **앞비스듬한 3/4 각.** 자동차 카탈로그가 쓰는 각이고, 앞얼굴과 옆 실루엣이 한 장에
    같이 들어오는 유일한 각이다 — 세단·SUV·슈퍼카가 한 줄에 놓였을 때 무엇이 다른지가
    이 각에서만 드러난다.

    차체는 로컬 -Z 를 향해 서 있다. 180° 돌리면 앞이 +Z 를 보고, 카메라가 (+X, +Z) 에
    있으므로 앞얼굴과 오른쪽 옆면이 함께 잡힌다. (옆에서만 찍으면 아홉 대가 다 비슷한
    길쭉한 덩어리가 된다 — 처음에 0.72π 로 두었다가 그렇게 나왔다)
  */
  car.group.rotation.y = Math.PI;

  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  // 거리는 차 길이에서 뽑는다 — 고정값으로 두면 긴 차는 잘리고 짧은 차는 작게 나온다
  const dist = spec.dims.length * 1.65 + 3.2;
  camera.position.set(dist * 0.62, spec.dims.height * 1.15 + 0.9, dist * 0.72);
  camera.lookAt(0, spec.dims.height * 0.45, 0);

  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');

  car.dispose();
  scene.clear();
  cache.set(spec.id, url);
  return url;
}

/**
 * 그림을 다 구웠으면 렌더러를 버린다.
 *
 * 전시관을 그린 직후에 부른다. 다음에 전시관을 열면 캐시가 있어 렌더러가 아예 필요 없고,
 * 캐시가 비어 있으면 그때 다시 한 벌 만든다.
 */
export function releaseCarThumbRenderer(): void {
  if (!shared) return;
  shared.dispose();
  shared.forceContextLoss();
  shared = null;
}

let shared: THREE.WebGLRenderer | null = null;
/** WebGL 을 쓸 수 없는 환경에서 매번 다시 시도하지 않도록 한 번만 판단한다 */
let unavailable = false;

function acquire(): THREE.WebGLRenderer | null {
  if (unavailable) return null;
  if (shared) return shared;
  try {
    shared = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    shared.setPixelRatio(1);
    shared.outputColorSpace = THREE.SRGBColorSpace;
    shared.toneMapping = THREE.ACESFilmicToneMapping;
    shared.toneMappingExposure = 1.15;
    return shared;
  } catch {
    unavailable = true;
    return null;
  }
}
