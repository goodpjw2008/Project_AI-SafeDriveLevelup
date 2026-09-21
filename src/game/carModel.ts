/**
 * 차량 3D 모델 — 실내와 외장을 모두 이 모델로 그린다.
 *
 * `public/models/<차 id>.glb` 가 있으면 절차적 차체를 대체하고, 없으면 지금까지의
 * 절차적 차체로 그대로 돌아간다. 모델을 넣고 빼도 게임이 멈추지 않아야 하고,
 * 오프라인 단일 파일 빌드에서는 애초에 이 경로가 막힌다.
 *
 * **부품을 실내/외장으로 갈라 레이어를 나누는 것이 이 파일의 핵심이다.**
 * 운전석 시점에서는 실내만, 후방·탑다운 시점에서는 외장만 보여야 한다
 * (실내와 외장이 같이 보이면 좌석이 차체를 뚫고 나온다).
 *
 * 판정에 쓰는 치수(dims)는 그대로다 — 모델을 **차 길이에 맞춰** 스케일하므로
 * 앞범퍼 위치가 곧 판정 기준점이 된다.
 *
 * 알려진 한계: 코롤라 모델의 바퀴 네 개는 메시 두 개(림·타이어)로 합쳐져 있어 각각 돌릴 수
 * 없다. 그래서 모델을 쓰면 바퀴가 구르지도 꺾이지도 않는다. 절차적 바퀴를 대신 남기면
 * 휠하우스와 어긋나 더 나빠 보여서, 정지한 바퀴 쪽을 택했다 — 운전석 시점에서는 어차피
 * 보이지 않고, 후방·탑다운 시점에서만 드러난다.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneModel } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { INTERIOR_LAYER, PLAYER_CAR_LAYER, driverEyeLocal } from './CarMesh';
import type { CarSpec } from '../economy/cars';

export interface CarModelCredit {
  /** 차 id — 어느 차의 모델인지 크레딧에 함께 적는다 */
  carId: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
}

/**
 * 배포에 들어가는 3D 모델의 표기 정보 — 크레딧 화면에 나온다.
 *
 * **모델마다 한 줄이다.** CC-BY 는 저작물마다 제작자 표기가 의무이고, 이 프로젝트는
 * glb 를 저장소와 단일 파일 빌드에 함께 실어 재배포하기 때문이다. 예전에는 한 대만 적을 수
 * 있는 단일 객체였고, 그래서 두 번째 차부터는 표기가 빠졌다 — 라이선스 위반이다.
 * `public/models/` 에 파일을 넣으면 여기에도 한 줄 넣는다.
 */
export const CAR_MODEL_CREDITS: CarModelCredit[] = [
  {
    carId: 'corolla',
    title: '2014 Toyota Corolla E180 EU (with interior)',
    author: 'Armored Wave',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl:
      'https://sketchfab.com/3d-models/2014-toyota-corolla-e180-eu-with-interior-36f95efb0585464cae43a25a3b3392e8',
  },
  {
    carId: 'corvette',
    title: '2020 Chevrolet Corvette C8 Stingray Convertible',
    author: 'Ddiaz Design',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl:
      'https://sketchfab.com/3d-models/2020-chevrolet-corvette-c8-stingray-convertible-01d63aa7013347acbfa62bc00e0b2df6',
  },
  {
    carId: 'k5',
    title: 'Kia K5 MX HQ interior 2016',
    author: 'Nieve5677',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl:
      'https://sketchfab.com/3d-models/kia-k5-mx-hq-interior-2016-6b745e6c63924c82b92d680cbc5fee6a',
  },
  {
    carId: 'avante',
    title: '2024 Hyundai Elantra N',
    author: 'Ddiaz Design',
    // 이 모델만 비상업(NC) 조건이다. 상업적으로 쓰려면 이 차를 카탈로그에서 빼야 한다.
    license: 'CC BY-NC 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
    sourceUrl:
      'https://sketchfab.com/3d-models/2024-hyundai-elantra-n-4ba1b1b0eb844e318cc708ada1f2f51f',
  },
  {
    carId: 'm8',
    title: '2020 BMW M8 Competition Convertible',
    author: 'Ddiaz Design',
    license: 'CC BY-NC-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    sourceUrl:
      'https://sketchfab.com/3d-models/2020-bmw-m8-competition-convertible-f7c1401ee5724e969db890c207fb099f',
  },
  {
    carId: 'sf90',
    title: '2021 Ferrari SF90 Spider',
    author: 'Ddiaz Design',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://sketchfab.com/3d-models/2021-ferrari-sf90-spider-8f8ef613e39746668b4f0268a3176dde',
  },
  {
    carId: 'm5',
    title: '2022 BMW M5 CS',
    author: 'Ddiaz Design',
    // 아반떼 N 과 같은 제작자지만 이쪽은 SA 까지 붙는다 (아래 SL63 주석 참조)
    license: 'CC BY-NC-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    sourceUrl: 'https://sketchfab.com/3d-models/2022-bmw-m5-cs-dc34c3fd9056460da48317ce0ff6b998',
  },
  {
    carId: 'sl63',
    title: 'Mercedes-Benz SL63 Mansory',
    author: 'VTX',
    /*
      NC(비상업)에 더해 **SA(동일조건변경허락)** 다. 이 모델을 손본 결과물(우리가 굽는
      public/models/sl63.glb 가 그렇다)은 같은 조건으로만 배포할 수 있다.
      상업적으로 쓰거나 라이선스를 단순하게 유지해야 하면 이 차부터 뺀다.
    */
    license: 'CC BY-NC-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    sourceUrl:
      'https://sketchfab.com/3d-models/mercedes-benz-sl63-mansory-669099d7d4374d3bbbd86c62f5d66507',
  },
  {
    carId: 'sorento',
    title: '2022 Kia Sorento PHEV Executive Line',
    author: 'twr422',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl:
      'https://sketchfab.com/3d-models/2022-kia-sorento-phev-executive-line-340ded1d34c149a095b3281a1232494a',
  },
];

/**
 * 차종별 모델 경로 — **파일 이름이 곧 차 id 다.**
 *
 * Sketchfab 원본을 `assets/cars/<id>/` 에 풀고 `npm run assets` 를 돌리면
 * `public/models/<id>.glb` 가 나온다. 카탈로그(cars.ts)에 같은 id 로 항목을 넣으면
 * 그것으로 끝이다 — 코드를 고칠 곳이 없다.
 */
const modelUrl = (id: string, lod = false) => `models/${id}${lod ? '.lod' : ''}.glb`;

/**
 * 부품을 이름으로 찾을 때 쓰는 문자열 — 메시 이름 + 부모 이름 + **재질 이름**.
 *
 * 재질 이름을 넣는 것이 요점이다. Sketchfab 모델의 절반쯤은 부품 이름이 `Object_12` 처럼
 * 아무 뜻이 없는데(OBJ 로 한 번 거쳐 오면 그렇게 된다), 그런 모델도 **재질 이름은 살아 있다** —
 * K5 가 그렇다: 부품은 전부 `Object_N` 이지만 재질이 `carpaint`·`windowglass`·`interior` 다.
 * 재질까지 보면 이런 모델도 자동으로 잰다. (예전에는 이런 차를 만나면 cars.ts 에 좌표를
 * 손으로 적는 수밖에 없었다 — 콜벳이 그 경우다)
 *
 * 붙이는 순서는 이름이 먼저다. DROP_PARTS 처럼 **앞을 고정해 검사하는 규칙**이 있어서,
 * 재질 이름이 앞에 오면 엉뚱한 부품이 걸린다.
 */
function labelOf(o: THREE.Object3D): string {
  const mat = (o as THREE.Mesh).material;
  const matName = Array.isArray(mat) ? mat.map((m) => m.name).join(' ') : (mat?.name ?? '');
  return `${o.name} ${o.parent?.name ?? ''} ${matName}`;
}

/**
 * 모델이 알려 주는 운전석 부착점.
 *
 * 핸들과 계기판은 우리가 코드로 그리지만, **자리는 모델이 정해야 한다.** 절차적 차체의
 * 공식(`clusterPanelLocal`)으로 잡으면 모델과 어긋난다 — 모델은 차 **길이**에 맞춰
 * 스케일되므로 실내 높이가 제원의 전고와 따로 놀기 때문이다. 실제로 티코(전장 3.34m)에서
 * 계기판이 대시보드보다 0.29m 위, 0.19m 앞에 떠 있었다.
 *
 * 그래서 모델을 실제로 재서 그 자리에 앉힌다. 좌표는 fitToCar 이후의 차량 로컬 좌표다.
 */
/** 앞유리의 아래끝(카울)과 위끝(헤더) — 차량 로컬 좌표의 (높이, 앞뒤) */
export interface Windshield {
  cowl: { y: number; z: number };
  header: { y: number; z: number };
}

export interface CarModelAnchors {
  /**
   * 핸들 중심·반지름·눕힌 각.
   *
   * 핸들 자체는 이제 모델의 것을 그대로 쓴다. 이 값은 **계기판 자리를 찾는 기준**으로만
   * 남아 있다 — 계기판은 핸들 림 너머로 읽는 물건이라 그 주변에서 찾는 것이 가장 정확하다.
   * (계기판 자리는 화면 HUD 가 아니라 카울 마개를 놓는 데 쓴다)
   */
  steering: { x: number; y: number; z: number; radius: number; rake: number } | null;
  /**
   * 계기판 자리 — x·y 는 중심, z 는 **운전자 쪽 면**이다 (판이 함몰부에 파묻히지 않게).
   * width 는 계기판 면의 폭이다. 우리 판을 여기 맞춰야 후드에 양 끝이 잘리지 않는다.
   */
  cluster: { x: number; y: number; z: number; width: number } | null;
  /**
   * 운전석 눈높이 (y).
   *
   * 제원의 전고로 잡은 눈높이는 모델과 맞지 않는다 — 모델은 차 **길이**에 맞춰
   * 스케일되므로, 짧은 차일수록 모델이 통째로 납작해진다. 티코(전장 3.34m)에서는
   * 스케일된 코롤라의 지붕이 0.99m 인데 눈높이는 1.13m 라, **눈이 지붕 위에** 있었다.
   * 그래서 대시보드가 화면 밖으로 밀려나 매번 내려다봐야 했다.
   */
  eye: { y: number } | null;
  /**
   * 앞유리 아래끝(카울)·위끝(헤더)의 자리 — 차고 화면이 **세로 시야각**을 계산하는 데 쓴다.
   *
   * 눈높이만으로는 시야를 알 수 없다. 같은 눈높이라도 앞유리가 누워 있으면(SF90) 헤더가
   * 멀어 시야가 좁고, 서 있으면(쏘렌토) 가까워 넓다. 좌석을 앞뒤로 움직일 때 시야가
   * 얼마나 달라지는지도 이 좌표가 있어야 나온다.
   * 손으로 눈높이를 적어 준 차(콜벳)는 앞유리를 재지 못했다는 뜻이므로 null 이다.
   */
  windshield: Windshield | null;
  /** 거울면 중심 — 우리 거울(실시간 렌더 텍스처)을 여기 앉힌다 */
  mirrors: {
    left: THREE.Vector3Like;
    right: THREE.Vector3Like;
    room: THREE.Vector3Like | null;
  } | null;
}

/**
 * 아예 버리는 부품 — **스튜디오 배경 판 하나뿐**이다.
 *
 * 코롤라 모델에 딸려 온 `Cube.*` 는 차가 아니라 촬영용 배경 판이다. 남겨 두면 바운딩
 * 박스가 부풀어 차 길이에 맞추는 스케일이 통째로 틀어진다 (높이 2.6m 짜리 차가 된다).
 *
 * 그 밖의 부품은 **하나도 버리지 않는다.** 예전에는 핸들·거울을 버리고 우리 것을 그렸고,
 * 실내/외장을 갈라 운전석에서 외장을 껐는데 — 그러려면 모델마다 부품 이름을 알아야 했고,
 * 이름이 안 맞는 모델에서는 대시보드가 통째로 꺼져 그 자리가 뚫렸다.
 * 다 넣으면 모델이 만들어진 그대로 보인다.
 */
const DROP_PARTS = /^Cube/i;

/**
 * 이 부품이 유리인가 — **부품 이름과 재질 이름 중 하나라도** 유리라고 하면 유리다.
 *
 * 둘 중 하나만 믿을 수 없다. 쏘렌토에서는 둘이 서로 어긋나고, 어느 쪽이 맞는지도 그때그때 다르다.
 *
 *  - `PolySurface0031_template_glasstinted_0` 의 재질은 `template_fabrics__carpet_3` 다.
 *    Sketchfab 이 내보내면서 성질이 비슷한 재질 여러 개를 한 통에 몰아넣은 탓인데,
 *    **부품 이름에는 원래 재질명이 남았다.** 이것이 옆·뒤 유리 안쪽 1cm 에 한 겹 더 있는
 *    유리 껍데기다 — 재질만 보면 카펫으로 읽혀 옆창이 하얗게 막힌다.
 *  - `PolySurface0129_template_blackpaint_0` 의 재질은 반대로 `template_glasstinted.003` 이다
 *    (이번엔 최적화의 dedup 이 성질이 같은 검정 재질 둘을 합쳤다). 이쪽은 **앞유리 안쪽 겹**이라
 *    부품 이름만 보면 앞이 새까맣게 막힌다.
 *
 * 그래서 둘 다 본다. 대신 재질은 아래에서 **그 부품 것만 복제**해 고치므로, 한 재질을
 * 유리와 유리 아닌 부품이 나눠 써도 엉뚱한 곳이 비치지 않는다.
 */
function isGlassPart(mesh: THREE.Mesh, mat: THREE.Material): boolean {
  return /glass|window|glazing/i.test(`${mesh.name} ${mesh.parent?.name ?? ''} ${mat.name}`);
}

/**
 * 유리를 **불투명하게 내보낸 모델**을 고친다.
 *
 * 쏘렌토 모델의 유리 재질(`template_glasstinted`)은 baseColor 가 [0,0,0,**1**] 이고
 * alphaMode 도 없다 — 완전히 불투명한 검정이다. 운전석에서 앞이 새까맣게 막힌다.
 * 제작자가 Sketchfab 뷰어 쪽 투명 설정에 기대어 만든 모델이라 glTF 로 나오면서
 * 투명도가 빠진 것이다. 이런 모델이 드물지 않다.
 *
 * 이 게임에서 **밖이 보이는 것은 타협할 수 없다.** 보행자와 신호를 보고 판단하는 것이
 * 전부이기 때문이다. 그래서 유리로 이름 붙은 부품이 불투명하게 들어오면 투명하게 돌린다.
 * 이미 알파가 살아 있는 모델(코롤라·K5)은 건드리지 않는다.
 *
 * 남기는 불투명도 0.12 는 유리테와 반사를 알아볼 정도만 남기고 바깥은 거의 그대로
 * 보이게 하는 값이다. 깊이 기록(depthWrite)은 끈다 — 켜 두면 유리 뒤의 실내가 사라진다.
 *
 * 재질은 **이 부품 것만 복제해서** 고친다. 위에 적은 대로 한 재질을 유리와 유리가 아닌
 * 부품이 나눠 쓰는 모델이 있어서, 재질을 직접 고치면 엉뚱한 부품까지 비친다.
 */
function makeGlassSeeThrough(mesh: THREE.Mesh): void {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const fixed = mats.map((m) => {
    const mat = m as THREE.MeshStandardMaterial;
    if (!mat || mat.transparent || !isGlassPart(mesh, mat)) return mat;
    const glass = mat.clone();
    glass.transparent = true;
    glass.opacity = 0.12;
    glass.depthWrite = false;
    // 양면으로 그리면 같은 유리가 두 번 겹쳐 그만큼 더 어두워진다
    glass.side = THREE.FrontSide;
    return glass;
  });
  mesh.material = Array.isArray(mesh.material) ? fixed : fixed[0];
}

/**
 * **투과(transmission) 재질을 일반 반투명으로 바꾼다** — 성능 때문이다.
 *
 * 일부 모델(아반떼 N 의 창 · 후미등 렌즈 등)은 glTF 의 KHR_materials_transmission 으로 유리를 만든다. three 는 투과
 * 재질이 화면에 하나라도 있으면 **매 프레임 불투명한 장면 전체를 한 번 더 그려** 투과용 텍스처를 만들고(밉맵까지),
 * 양면 투과 재질을 그 패스에서 두 번씩 `needsUpdate` 시켜 **그 재질을 쓰는 모든 물체가 매 프레임 셰이더를 다시
 * 고른다**(getProgram). 사용자가 "고성능 PC 에서는 쾌적한데 일반 PC 에서는 설정을 다 꺼도 느리다" 고 했고, 재 보니
 * 설정과 무관하게 돌던 이 둘이 CPU 시간 1위였다. 화질 설정으로는 끌 수 없는 비용이라 불러올 때 없앤다.
 *
 * 보이는 차이는 작다 — 이 게임의 카메라 거리에서 유리 너머가 굴절되어 보이는 것은 알아보기 어렵다. 창유리는
 * 불투명도 0.12(makeGlassSeeThrough 와 같은 값 — 운전석에서 밖이 보여야 한다), 색이 있는 렌즈 따위는 색이 살도록
 * 0.45 이상으로 둔다.
 */
function dropTransmission(mesh: THREE.Mesh): void {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    const mat = m as THREE.MeshPhysicalMaterial;
    if (mat?.isMeshPhysicalMaterial && mat.transmission > 0) {
      mat.transmission = 0;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.opacity = isGlassPart(mesh, mat) && /window|windshield|glazing/i.test(`${mesh.name} ${mat.name}`)
        ? 0.12
        : Math.max(mat.opacity, 0.45);
    }
    /*
      **반투명 + 양면은 한 번에 그린다.** three 는 이런 재질을 뒷면 · 앞면 두 번에 나눠 그리면서 그때마다
      `needsUpdate` 를 켠다 — 물체를 두 번 그리고, 그 재질을 쓰는 물체가 매 프레임 셰이더를 다시 고른다(재 보니
      유리 · 엠블럼 재질 다섯 개가 한 프레임에 3번씩 버전이 올랐다). 유리 · 렌즈처럼 얇은 부품이라 한 번에 그려도
      겹침 순서가 달라 보이지 않는다.
    */
    if (mat?.transparent && mat.side === THREE.DoubleSide) mat.forceSinglePass = true;
  }
}

/**
 * **차종별** 캐시.
 *
 * 모델은 차 길이에 맞춰 스케일하고, 그 뒤에 부착점을 재고 지오메트리를 잘라 낸다.
 * 그래서 결과물이 차마다 다르다 — 차 id 를 키로 쓴다. (한 벌만 캐시했을 때는 차를 바꿔도
 * 처음 굽힌 그대로 나와, 앞범퍼 위치가 어긋났다. 정지선·횡단보도 판정의 기준점이다)
 *
 * 없는 모델은 null 로 기억해 두어 매번 404 를 때리지 않는다.
 */
const cache = new Map<string, THREE.Group | null>();

/**
 * **받는 중인 모델.**
 *
 * 캐시는 다 받은 뒤에야 채워지므로, 같은 차를 여러 대(무작위 시나리오는 NPC 가 최대
 * 아홉 대다) 동시에 만들면 **같은 파일을 그 수만큼 따로 받아 따로 푼다.** SL63(7.6MB)
 * 처럼 큰 모델에서는 그것만으로 몇 초가 날아간다. 받는 중인 약속을 나눠 쓰면 한 번만 푼다.
 */
const inflight = new Map<string, Promise<THREE.Group | null>>();

/** 캐시 키 — 배경 차용 가벼운 모델(LOD)은 원본과 따로 둔다 */
const cacheKey = (id: string, lod: boolean) => (lod ? `${id}:lod` : id);

/**
 * 이미 받아 둔(= 바로 쓸 수 있는) **배경 차용** 차 id 들 — NPC 배역을 고를 때 쓴다.
 * 배경 차는 가벼운 모델(LOD)로 그리므로, 그것이 받아져 있는 차를 센다.
 */
export function loadedCarIds(): string[] {
  return [...cache.entries()]
    .filter(([key, m]) => m && key.endsWith(':lod'))
    .map(([key]) => key.slice(0, -':lod'.length));
}

/**
 * 캐시본에서 한 벌 떠 온다.
 *
 * **`Object3D.clone()` 을 쓰면 안 된다.** 뼈대에 물린 모델(SL63)에서 복제본의 스킨 메시가
 * **원본의 뼈대를 그대로 가리키기** 때문이다. 스킨 메시는 자기 부모가 아니라 뼈를 따라
 * 그려지므로, 차를 옮겨도 차체는 캐시본이 놓인 자리(원점 = 교차로 한가운데)에 남고
 * 뼈대가 없는 부품(바퀴)만 따라온다 — 바퀴만 굴러다니는 그림이 그래서 나온다.
 *
 * SkeletonUtils.clone 은 복제한 뼈들로 뼈대를 다시 묶어 준다. 뼈대가 없는 모델에서는
 * 하는 일이 clone() 과 같다.
 */
const copyOf = (model: THREE.Group): THREE.Group => cloneModel(model) as THREE.Group;

/**
 * 내 차인지 NPC 인지에 따라 **레이어와 실내 조명**을 다르게 준다.
 *
 *  - 내 차 : PLAYER_CAR_LAYER. 좌·우·후방 창의 카메라는 차 안에 앉아 있어서 이 레이어를
 *    꺼 두는데, 그래야 창이 자기 차의 시트와 차체로 가득 차지 않는다. 실내 채움광도 넣는다.
 *  - NPC  : 기본 레이어. **창에도 보여야 한다** — 후방 창에 뒷차가 안 보이면 그 창을 둘
 *    이유가 없다. 실내 채움광은 넣지 않는다. 차 대수만큼 조명이 늘어나는데, 밖에서 보는
 *    차의 실내를 밝힐 이유도 없다.
 *
 * 캐시본은 이 처리를 하지 않은 상태로 두고 **복제한 뒤에** 적용한다. 같은 차종을 내 차와
 * NPC 가 함께 탈 수 있어서, 캐시본에 레이어를 구워 두면 먼저 받은 쪽 설정이 남는다.
 */
function applyRole(model: THREE.Object3D, forPlayer: boolean): void {
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.layers.set(forPlayer ? PLAYER_CAR_LAYER : DEFAULT_LAYER);
  });
  if (forPlayer) addCabinFill(model);
}

/**
 * **코앞의 차에 환경맵을 직접 건다** — 화질을 어디까지 낮춰도 이 차들만은 '높음' 처럼 비친다
 * (environment.ts 의 nearCarEnv).
 *
 * 내 차와 **앞차 · 뒷차**가 대상이다. 사용자가 둘 다 짚었다 — "모든 상태에서 내 차의 품질은 보장되는 거야",
 * "뒤차도 눈에 가장 많이 띄는 부분이야". 뒷차는 후방 시야 창에 늘 떠 있고, 앞차는 내 차 바로 앞에 선다.
 * 배경 차(교차 · 정체)는 스쳐 가므로 설정대로 둔다 — 대가는 그 차의 픽셀에서 든다.
 *
 * **장면 세기로는 안 된다.** three 는 재질에 envMap 이 없고 장면에 환경맵이 걸려 있으면 재질의 세기를 무시하고
 * `scene.environmentIntensity` 로 덮어쓴다 (WebGLRenderer 의 `material.envMap === null` 분기). 그래서 재질에
 * **직접** 걸어야 내 차만 다른 세기로 비칠 수 있다. '낮음' 은 장면에 환경맵이 아예 없으므로 더더욱 그렇다.
 *
 * **재질을 복제해서 건다.** 캐시해 둔 모델을 복제할 때(SkeletonUtils.clone) 재질은 **참조로 공유된다** —
 * 그대로 고치면 같은 차종을 타고 있는 NPC 와 다음에 뜨는 모든 복사본까지 같이 반사한다. 복제해도 텍스처는
 * 공유되므로 늘어나는 것은 재질 개체 스물몇 개뿐이다.
 *
 * 차고 · 전시관 미리보기에는 걸지 않는다 — 그쪽은 애초에 화질 설정을 들고 다니지 않아 늘 '높음' 으로 돈다
 * (World 의 graphics 기본값).
 */
export function dressCarEnv(model: THREE.Object3D, env: { map: THREE.Texture; intensity: number }): void {
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const put = (m: THREE.Material): THREE.Material => {
      const std = m as THREE.MeshStandardMaterial;
      // 환경맵을 받을 수 있는 재질만 (스프라이트 · 기본 재질은 건너뛴다)
      if (std.envMapIntensity === undefined) return m;
      const copy = std.clone();
      copy.envMap = env.map;
      // 모델이 정해 둔 제 몫은 지킨다 — 유리와 도장이 같은 세기로 비치면 안 된다
      copy.envMapIntensity = std.envMapIntensity * env.intensity;
      return copy;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(put) : put(mesh.material);
  });
}

/** three.js 의 기본 레이어. 어느 카메라에나 보인다. */
const DEFAULT_LAYER = 0;

/**
 * 차량 모델을 읽어 차량 로컬 좌표에 맞춰 돌려준다.
 * 없거나 읽지 못하면 null — 호출부는 절차적 차체를 그대로 쓰면 된다.
 *
 * `forPlayer` 가 false 면 NPC 용으로 나온다 (위 applyRole 참조).
 */
export async function loadCarModel(
  spec: CarSpec,
  /**
   * `lod` — **배경 차용 가벼운 모델**(`models/<id>.lod.glb`, scripts/build-lod-models.mjs)을 쓴다. 교차로를 스쳐 가는
   * 차와 앞차가 쓴다(TrafficCar). 원본은 삼각형 7만~66만 개라 배경 차 서너 대가 한 프레임에 100만 개를 넘겼다.
   * 내 차 · 차고 · 운전석 시야 계산은 원본을 쓴다 — 실내와 앞유리 좌표가 정확해야 한다.
   */
  opts: { forPlayer?: boolean; lod?: boolean } = {},
): Promise<THREE.Group | null> {
  const forPlayer = opts.forPlayer ?? true;
  const base = await baseModel(spec, opts.lod ?? false);
  if (!base) return null;
  const copy = copyOf(base);
  applyRole(copy, forPlayer);
  return copy;
}

/**
 * 차종별 **원본 한 벌**을 돌려준다 (캐시 · 동시 요청 합치기).
 * 호출부는 이것을 복제해서 쓴다 — 원본은 장면에 넣지 않는다.
 */
async function baseModel(spec: CarSpec, lod: boolean): Promise<THREE.Group | null> {
  const key = cacheKey(spec.id, lod);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const running = inflight.get(key);
  if (running) return running;

  const job = readModel(spec, lod).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function readModel(spec: CarSpec, lod: boolean): Promise<THREE.Group | null> {
  const key = cacheKey(spec.id, lod);
  try {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    /*
      가벼운 모델이 없으면(아직 굽지 않았거나 단일 파일 빌드) **원본으로 되돌아간다** — 느려질 뿐 차는 나온다.
      원본 캐시를 나눠 쓰므로 같은 파일을 두 번 받지 않는다.
    */
    const gltf = lod
      ? await loader.loadAsync(modelUrl(spec.id, true)).catch(() => null)
      : await loader.loadAsync(modelUrl(spec.id));
    if (!gltf) {
      const full = await baseModel(spec, false);
      cache.set(key, full);
      return full;
    }
    const root = gltf.scene;

    const drop = new Set<THREE.Object3D>();
    const steering: THREE.Object3D[] = [];
    const mirrors: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const name = labelOf(o);
      if (DROP_PARTS.test(name)) {
        drop.add(o);
        if (/steering/i.test(name)) steering.push(o);
        if (/miror|mirror/i.test(name)) mirrors.push(o as THREE.Mesh);
        return;
      }
      // 부품을 실내/외장으로 나누지 않는다 — 모델이 만들어진 그대로 보이는 것이 요점이다.
      // (레이어는 캐시본을 뜬 뒤 applyRole 이 정한다 — 내 차와 NPC 가 다르다)
      const mesh = o as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      makeGlassSeeThrough(mesh);
      dropTransmission(mesh);
      /*
        실내 트림을 **양면으로 그리지 않는다.**

        얇은 판의 뒷면이 잘려 구멍이 될까 봐 한때 양면으로 돌렸는데, 실제로 막힌 틈은
        없었고 대신 **뒷면이 평평한 검정 판으로 나타났다** — 조수석 옆에 세로로 서 있던
        그것이다. 뒷면은 노멀·탄젠트가 앞면 기준이라 빛을 제대로 못 받아 음영 없이
        새까맣게 찍힌다. 모델 시트에는 음영이 있는데 그 판만 완전히 평평했던 것이 단서였다.

        틈은 마개(addInteriorPlugs)로 막는 편이 확실하다 — 어디를 막는지 좌표로 알 수 있다.
      */
    });

    /*
      버릴 부품을 **아직 지우지 않는다.** 핸들이 계기판을 찾는 기준이기 때문이다.
      스케일·회전을 먼저 맞춰야 잰 값이 차량 로컬 좌표로 나오므로 순서는 fitToCar → 측정 → 제거다.
    */
    fitToCar(root, spec, drop);
    const anchors = measureAnchors(root, steering, mirrors, drop, spec);
    root.userData.anchors = anchors;
    for (const o of drop) o.removeFromParent();

    cache.set(key, root);
    return root;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/**
 * 핸들·계기판·눈높이·거울 자리를 정한다 (fitToCar 이후에 부를 것).
 *
 * **먼저 모델에서 재고, 못 재는 것만 카탈로그의 수동 좌표(spec.anchors)로 채운다.**
 *
 * 자동 측정의 출발점은 **핸들**이다. 계기판은 이름으로 찾을 수 없어서 — 코롤라는 계기판
 * 그룹과 대시보드 그룹 이름이 둘 다 'dashboard' 로 시작한다 — 핸들을 기준으로 고른다.
 * 계기판은 정의상 핸들 림 너머로 읽는 물건이라 핸들보다 앞에, 핸들 지름 안에, 핸들보다
 * 작게 있다.
 *
 * 그런데 Sketchfab 모델 중에는 부품이 재질별로 통합돼 있거나 이름이 `Mesh6` 처럼
 * 무의미해 핸들 자체를 못 찾는 것이 많다(콜벳이 그렇다). 그런 차는 cars.ts 에
 * 좌표를 적어 두고 그것을 쓴다.
 */
function measureAnchors(
  root: THREE.Object3D,
  steering: THREE.Object3D[],
  mirrors: THREE.Mesh[],
  dropped: Set<THREE.Object3D>,
  spec: CarSpec,
): CarModelAnchors | null {
  root.updateMatrixWorld(true);
  const manual = spec.anchors;

  /*
    핸들을 모델에서 잰다. 이것이 나머지를 재는 기준이다 —
    부품 이름이 없어 못 찾으면 카탈로그의 수동 좌표(spec.anchors)를 쓴다.
  */
  let auto: CarModelAnchors['steering'] | null = null;
  if (steering.length > 0) {
    const wheel = new THREE.Box3();
    for (const o of steering) wheel.union(new THREE.Box3().setFromObject(o));
    const center = wheel.getCenter(new THREE.Vector3());
    const size = wheel.getSize(new THREE.Vector3());
    const radius = size.x / 2;
    if (radius > 1e-3) {
      // 원판을 X축으로 θ 만큼 눕히면 바운딩 박스의 높이·깊이가 (2R·cosθ, 2R·sinθ) 가 된다
      auto = { x: center.x, y: center.y, z: center.z, radius, rake: -Math.atan2(size.z, size.y) };
    }
  }
  const wheelAt = manual?.steering ?? auto;

  /*
    계기판은 **핸들을 기준으로** 고른다 — 핸들보다 앞에, 핸들 지름 안에, 핸들보다 작은 메시.
    이름으로는 못 찾는다(이 모델은 계기판 그룹과 대시보드 그룹 이름이 둘 다 'dashboard' 다).
    자동으로 찾은 핸들이 있을 때만 의미가 있으므로, 수동 좌표를 쓰는 차는 계기판도 수동이다.
  */
  const box = new THREE.Box3();
  let found = false;
  if (auto) {
    const center = new THREE.Vector3(auto.x, auto.y, auto.z);
    root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh || dropped.has(o)) return;
      const b = new THREE.Box3().setFromObject(o);
      const c = b.getCenter(new THREE.Vector3());
      if (b.max.x - b.min.x > auto!.radius * 2.4) return; // 대시보드 전체처럼 넓은 판은 아니다
      if (c.z > center.z) return; // 핸들보다 운전자 쪽이면 아니다
      if (c.distanceTo(center) > auto!.radius * 2) return;
      box.union(b);
      found = true;
    });
  }

  const mirror = measureMirrors(mirrors);
  const windshield = measureWindshield(root, dropped, spec);

  return {
    steering: wheelAt,
    cluster:
      manual?.cluster ??
      (found
        ? {
            x: (box.min.x + box.max.x) / 2,
            y: (box.min.y + box.max.y) / 2,
            z: box.max.z,
            width: box.max.x - box.min.x,
          }
        : null),
    eye: manual?.eye ?? (windshield && { y: eyeHeightOf(windshield) }),
    windshield,
    mirrors: manual?.mirrors ?? (mirror && { left: mirror.left, right: mirror.right, room: mirror.room }),
  };
}

/**
 * 눈이 **앞유리 아래끝(카울)에서 위끝(헤더)까지의 몇 % 높이**에 오는가.
 *
 * 실제 차의 눈높이가 이 비율에 있다 — 코롤라(전고 1.455m)의 눈은 앞유리 아래끝보다
 * 0.10m 위, 위끝보다 0.23m 아래다. 콜벳 모델에 손으로 적어 둔 실측 눈높이(0.95)도
 * 이 규칙으로 계산하면 0.945 가 나온다. 서로 다른 두 차에서 맞으므로 규칙으로 쓸 만하다.
 */
const EYE_IN_WINDSHIELD = 0.52;

/**
 * 눈높이를 모델의 **앞유리**에서 잰다.
 *
 * 전에는 유리 메시 **전체의 바운딩 박스**를 쓰고 그 62% 를 눈높이로 삼았다. 이것이
 * 코롤라에서 눈을 천장에 처박았다 — 이 모델의 유리 메시에는 차 밖으로 튀어나간 잉여
 * 정점이 있어(fitToCar 뒤 y −0.18~2.05, 차 지붕은 1.37) 박스가 실제 유리의 세 배로
 * 부풀고, 그 62% 인 1.199 가 나왔다. 운전석 천장은 1.208 이다. 눈과 천장 사이가 1cm 라
 * 화면 위쪽 절반이 헤드라이너로 덮였다.
 *
 * 그래서 **앞유리만, 정점 단위로, 백분위로** 잰다.
 *  - 앞유리만 — 눈높이는 운전자가 내다보는 창이 정하는 값이다. 옆·뒤 유리는 상관없다.
 *  - 정점 단위 — 바운딩 박스는 메시 하나에 유리가 다 들어 있으면 가를 수 없다.
 *  - 백분위(2%·98%) — 잉여 정점 몇 개에 결과가 끌려가지 않는다.
 */
function measureWindshield(
  root: THREE.Object3D,
  dropped: Set<THREE.Object3D>,
  spec: CarSpec,
): Windshield | null {
  // 차 중심보다 앞쪽 유리만 — 앞유리 아래끝은 차 길이의 30% 쯤 앞이라 여유가 넉넉하다
  const frontCut = -spec.dims.length * 0.04;
  /*
    **차 중앙선만** 잰다 (기본값). 앞유리는 가운데를 지나지만 앞쪽 삼각창·사이드윈도 앞끝은
    가장자리에 있어서, 폭 전체를 재면 그것들이 '앞유리 아래끝'으로 잡힌다.
    아반떼가 그랬다 — 폭 전체로는 카울이 0.583 으로 나와 눈높이가 16cm 낮았고(1.078),
    중앙선만 재니 카울 1.020 · 헤더 1.350 으로 실측과 맞는 1.234 가 나왔다.
    (코롤라·K5 는 이 규칙으로도 1cm 남짓만 움직인다 — 원래 가운데가 대부분이던 모델이다)
  */
  const halfBand = spec.dims.width * 0.25;
  /*
    **y 만이 아니라 z 도 들고 온다.** 눈높이는 y 만 있으면 되지만, 차고 화면이 보여 주는
    세로 시야각은 눈에서 카울·헤더까지의 **거리**가 있어야 나온다 (앞유리가 눕느냐 서느냐로
    같은 높이라도 시야가 달라진다).
  */
  const collect = (re: RegExp, centerOnly: boolean): THREE.Vector2[] => {
    const pts: THREE.Vector2[] = [];
    const v = new THREE.Vector3();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || dropped.has(o)) return;
      if (!re.test(labelOf(o))) return;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        vertexWorld(mesh, i, v);
        if (v.z < frontCut && (!centerOnly || Math.abs(v.x) < halfBand)) {
          pts.push(new THREE.Vector2(v.y, v.z));
        }
      }
    });
    return pts;
  };

  /*
    **창유리(window)로 이름 붙은 것이 있으면 그것만 쓴다.** 없을 때만 유리 전체로 넓힌다.

    등화류가 섞이는 것을 막기 위해서다. K5 의 유리 재질은 windowglass(창) 말고도
    clearglass(전조등)·orangeglass(방향지시등)·redglass(후미등) 가 있는데, 전조등 렌즈는
    정점이 촘촘해서(앞쪽 유리 정점 3만 개 중 2만 9천 개) 백분위가 통째로 등화류 쪽으로
    끌려간다. 그렇게 재면 '앞유리 위끝'이 0.85 로 나온다 — 실제 헤더는 1.21 이다.
  */
  let pts = collect(/window/i, true);
  if (pts.length < 8) pts = collect(/glass|glazing/i, true);
  // 중앙선에 정점이 거의 없는 모델(파노라마 루프만 가운데 있는 경우 등)은 폭 전체로 물러선다
  if (pts.length < 8) pts = collect(/window|glass|glazing/i, false);
  // 앞유리는 사각형 몇 장이면 그려진다 — K5 는 중앙선 정점이 29개다. 8개면 위·아래를 가릴 수 있다.
  if (pts.length < 8) return null;

  pts.sort((a, b) => a.x - b.x); // Vector2 는 (y, z) 를 담고 있다 — x 가 높이다
  const at = (q: number) => pts[Math.min(pts.length - 1, Math.floor(pts.length * q))];
  const cowl = at(0.02);
  const header = at(0.98);
  if (header.x - cowl.x < 0.05) return null; // 앞유리로 볼 수 없는 형상이면 포기한다
  return {
    cowl: { y: cowl.x, z: cowl.y },
    header: { y: header.x, z: header.y },
  };
}

/**
 * 앞유리에서 잰 눈높이 — 카울에서 헤더까지의 EYE_IN_WINDSHIELD 지점.
 *
 * 0.65 → 0.58 → **0.52** 로 내렸다. 눈이 높으면 앞유리 윗변과 천장이 화면에 크게
 * 들어오는데, 천장은 지붕·필러와 한 덩어리라 모델에서 잘라낼 수 없다. 눈을 내리면 같은
 * 것이 화면 위로 빠진다.
 *
 * 여기가 하한이다 — 더 내리면 앞유리 아래쪽(카울)에 가까워져 보닛이 화면을 덮기 시작한다.
 */
function eyeHeightOf(ws: Windshield): number {
  return ws.cowl.y + (ws.header.y - ws.cowl.y) * EYE_IN_WINDSHIELD;
}

/**
 * 좌석을 앞뒤로 움직일 수 있는 범위 (m, +가 앞).
 *
 * 앞쪽 한계는 차마다 다시 계산한다(seatForwardLimit) — 이 값은 그 위에 씌우는 공통 상한이다.
 * 35cm 를 넘겨 봐야 대시보드 위로 몸을 던진 시점이라 앞유리 아래쪽만 크게 보인다.
 *
 * 뒤쪽은 **모델에서 잴 방법이 없어** 고정값이다. 뒤로 갈 때 걸리는 것은 시트 등받이인데,
 * 시트 재질 이름이 모델마다 제각각이라(seat_fabric·leather__seats·interiordfs·Interior…)
 * 앞유리처럼 자동으로 집어낼 수가 없다. 30cm 는 실제 시트 레일이 움직이는 범위 안이고,
 * 더 뒤로 가면 등받이 안으로 들어가는데 그건 화면에서 바로 보이므로 되돌리면 된다.
 */
export const SEAT_RANGE = { min: -0.3, max: 0.35 };

export const clampSeatOffset = (m: number): number =>
  Math.max(SEAT_RANGE.min, Math.min(SEAT_RANGE.max, Number.isFinite(m) ? m : 0));

/** 앞으로 당겨도 눈과 앞유리 사이에 남겨 둘 거리 (m) — 유리에 얼굴을 붙일 수는 없다 */
const SEAT_MIN_GLASS_GAP = 0.15;

/**
 * 눈높이에서 앞유리가 있는 z — 카울과 헤더를 잇는 선을 그 높이에서 자른다.
 *
 * 앞유리는 **아래로 갈수록 앞으로 기울어 있다.** 눈높이(카울에서 65% 지점)의 유리는
 * 위끝(헤더)보다 한참 앞에 있어서, 헤더까지의 거리로 한계를 잡으면 실제보다 2~3배 좁아진다.
 * 코롤라에서 헤더까지는 26cm 지만 눈높이의 유리까지는 58cm 다.
 */
function windshieldZAtEye(ws: Windshield, eyeY: number): number {
  const span = ws.header.y - ws.cowl.y;
  const t = span > 1e-4 ? (eyeY - ws.cowl.y) / span : 0;
  return ws.cowl.z + (ws.header.z - ws.cowl.z) * Math.max(0, Math.min(1, t));
}

/**
 * **이 차에서** 좌석을 앞으로 당길 수 있는 한계 (m).
 *
 * 기본 자리에서 눈과 앞유리 사이가 차마다 23~94cm 로 제각각이다. 범위를 하나로 두면
 * 여유가 짧은 차는 눈이 유리를 뚫고, 넉넉한 차는 갈 수 있는데도 막힌다.
 * 앞유리를 잰 차는 그 좌표로 한계를 정하고, 못 잰 차는 공통 상한을 쓴다.
 */
export function seatForwardLimit(spec: CarSpec, anchors: CarModelAnchors | null): number {
  const ws = anchors?.windshield;
  if (!ws) return SEAT_RANGE.max;
  const local = driverEyeLocal(spec);
  const room = local.z - windshieldZAtEye(ws, anchors?.eye?.y ?? local.y);
  return Math.max(0, Math.min(SEAT_RANGE.max, room - SEAT_MIN_GLASS_GAP));
}

/** 운전석에서 본 시야 — 차고 화면이 보여 주는 값이다 */
export interface DriverView {
  /** 지면에서 눈까지 (m) */
  eyeY: number;
  /** 앞유리로 열리는 **세로 시야각** (도) */
  angleDeg: number;
  /** 눈에서 앞유리 위끝까지의 앞뒤 거리 (m) — 0 에 가까우면 유리에 얼굴을 붙인 셈이다 */
  headerGap: number;
}

/**
 * 좌석을 `seatOffset` 만큼 앞으로 당겼을 때의 시야를 계산한다.
 *
 * 세로 시야각은 **눈에서 앞유리 위끝(헤더)까지의 올려본각 + 아래끝(카울)까지의 내려본각**이다.
 * 눈높이만으로는 알 수 없는 값이라 앞유리 좌표(anchors.windshield)가 필요하다 —
 * 같은 눈높이라도 앞유리가 누워 있으면 헤더가 멀어 좁고, 서 있으면 가까워 넓다.
 *
 * 앞유리를 재지 못한 모델(손으로 눈높이를 적은 콜벳)이나 모델이 아직 안 온 경우에는 null.
 */
export function driverView(
  spec: CarSpec,
  anchors: CarModelAnchors | null,
  seatOffset: number,
): DriverView | null {
  /*
    **눈높이를 손으로 적어 둔 차는 각도를 내지 않는다.**

    손으로 적었다는 것은 그 차의 앞유리 자동 측정을 믿을 수 없다고 이미 판정했다는 뜻이다
    (쏘렌토는 전조등 렌즈가 유리 재질이라 앞유리 아래끝이 0.42 로, 콜벳도 같은 이유로
    어긋난다). 그런 좌표로 각도를 내면 쏘렌토 81°·콜벳 97° 처럼 그럴듯한 거짓말이 나온다.
    조절 자체는 되므로 슬라이더는 그대로 쓴다.
  */
  if (spec.anchors?.eye) return null;
  const ws = anchors?.windshield;
  if (!ws) return null;
  const local = driverEyeLocal(spec);
  const eyeY = anchors?.eye?.y ?? local.y;
  // 앞이 -Z 이므로 앞으로 당기면 z 가 줄어든다
  const eyeZ = local.z - clampSeatOffset(seatOffset);

  const headerGap = eyeZ - ws.header.z;
  const cowlGap = eyeZ - ws.cowl.z;
  // 눈이 헤더보다 앞으로 나가면 각도가 뒤집힌다 — 그 전에 멈춘 값으로 본다
  const up = Math.atan2(ws.header.y - eyeY, Math.max(0.02, headerGap));
  const down = Math.atan2(eyeY - ws.cowl.y, Math.max(0.02, cowlGap));
  return {
    eyeY,
    angleDeg: ((up + down) * 180) / Math.PI,
    headerGap,
  };
}

/**
 * 차고 화면용 — 모델을 받아(캐시되어 있으면 바로) 시야를 계산한다.
 * 모델이 없거나 앞유리를 못 재면 null 이다.
 */
export async function driverViewOf(spec: CarSpec, seatOffset: number): Promise<DriverView | null> {
  const model = await loadCarModel(spec, { forPlayer: false });
  const anchors = (model?.userData.anchors as CarModelAnchors | null) ?? null;
  return driverView(spec, anchors, seatOffset);
}

/**
 * 좌·우 사이드미러와 룸미러의 거울면 중심을 잰다.
 *
 * 거울면 셋이 **한 메시로 합쳐져** 들어온다 (재질이 같아서 굽는 과정에서 합쳐진다).
 * 그래서 바운딩 박스로는 못 가르고 정점을 x 로 나눠야 한다. 다행히 셋의 x 는
 * 확실히 떨어져 있다 — 사이드미러는 차 폭 끝, 룸미러는 중앙이다.
 */
function measureMirrors(
  meshes: THREE.Mesh[],
): (NonNullable<CarModelAnchors['mirrors']> & { roomBox: THREE.Box3 | null }) | null {
  const pts: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) continue;
    for (let i = 0; i < pos.count; i++) {
      pts.push(vertexWorld(mesh, i, v).clone());
    }
  }
  if (pts.length === 0) return null;

  const half = Math.max(...pts.map((p) => Math.abs(p.x)));
  // 바깥 40% 밖이면 사이드미러, 안쪽이면 룸미러. 실측에서는 ±0.69 대 ±0.09 로 갈린다
  const edge = half * 0.4;
  const boxOf = (group: THREE.Vector3[]): THREE.Box3 | null =>
    group.length === 0 ? null : new THREE.Box3().setFromPoints(group);

  const left = boxOf(pts.filter((p) => p.x < -edge));
  const right = boxOf(pts.filter((p) => p.x > edge));
  if (!left || !right) return null;
  const roomBox = boxOf(pts.filter((p) => Math.abs(p.x) <= edge));
  return {
    left: left.getCenter(new THREE.Vector3()),
    right: right.getCenter(new THREE.Vector3()),
    room: roomBox ? roomBox.getCenter(new THREE.Vector3()) : null,
    roomBox,
  };
}

/**
 * 실내 채움광.
 *
 * 실제 차 안은 지붕에 가려 태양광이 거의 들지 않는다. 그대로 두면 대시보드가 새까매져
 * 계기판 말고는 아무것도 안 보인다. 실내 레이어만 비추는 약한 조명을 하나 넣어
 * 형태가 읽힐 만큼만 올린다 — 바깥 노면 밝기에는 영향을 주지 않는다.
 */
function addCabinFill(root: THREE.Object3D): void {
  const fill = new THREE.HemisphereLight(0xdfe6f2, 0x252a33, 2.2);
  fill.layers.set(INTERIOR_LAYER);
  fill.position.set(0, 0.6, 0);
  root.add(fill);
}

/**
 * 모델을 차량 좌표계에 맞춘다.
 *
 * 기준은 **차 길이**다. 앞범퍼 위치가 정지선·횡단보도 판정의 기준점이므로,
 * 눈에 보이는 차와 판정에 쓰는 치수가 어긋나면 안 된다.
 *
 * 앞뒤 방향(180° 뒤집힘)은 계산으로 알 수 없어 렌더로 확인해 적는다. 대부분 이 기본값이
 * 맞지만 반대로 만들어진 모델도 있어서, 차마다 `spec.modelYaw` 로 덮어쓸 수 있다.
 */
const MODEL_YAW = Math.PI;

/**
 * 크기의 기준은 **차체(body) 메시**다.
 *
 * 모델 전체의 바운딩 박스를 쓰면 안 된다 — 이 모델에는 유리·시트 메시에 떠 있는
 * 잉여 정점이 있어 박스가 높이 2.65m 까지 부풀고(실제 차는 1.46m), 그대로 스케일하면
 * 차가 절반 크기로 쪼그라든다. 눈에 보이는 형상은 멀쩡하므로 차체만 재면 된다.
 */
/**
 * 정점 하나의 **월드 좌표** — 뼈대에 물린 모델까지 제대로 읽는다.
 *
 * 게임 차량 모델 중에는 부품 하나하나가 본에 물린 **스킨 메시**가 있다(SL63 은 178개 중
 * 173개가 그렇다 — GTA 계열 모델이 대개 이렇다). 이런 모델은 정점이 지오메트리에
 * ±1 로 정규화되어 들어 있고 **실제 자리는 본 변환이 정한다.** 그래서 정점을 그대로 읽어
 * 노드 행렬만 곱하면 차 모양이 아니라 원점 주변의 막대기가 나온다 — 앞유리를 재면
 * 카울이 0.339, 헤더가 1.531 처럼 지붕(1.274)을 뚫는 값이 나왔다.
 *
 * 뼈대가 없는 모델(나머지 다섯 대)에서는 이 함수가 하는 일이 없다.
 */
function vertexWorld(mesh: THREE.Mesh, index: number, out: THREE.Vector3): THREE.Vector3 {
  out.fromBufferAttribute(mesh.geometry.getAttribute('position'), index);
  const skinned = mesh as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh) skinned.applyBoneTransform(index, out);
  return out.applyMatrix4(mesh.matrixWorld);
}

/** 이름(부품·재질)이 맞는 부품들의 바운딩 박스. 하나도 없으면 null */
function partBox(
  root: THREE.Object3D,
  dropped: Set<THREE.Object3D>,
  re: RegExp,
): THREE.Box3 | null {
  const box = new THREE.Box3();
  let found = false;
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || dropped.has(o) || !re.test(labelOf(o))) return;
    box.union(new THREE.Box3().setFromObject(o));
    found = true;
  });
  return found ? box : null;
}

/**
 * 차체로 볼 수 있는 최소 비율 — 길이의 15% 보다는 높아야 한다.
 *
 * 승용차는 가장 납작한 슈퍼카도 길이의 23% 쯤 높다(SF90 1.24/4.70). 이보다 한참 낮으면
 * 차체가 아니라 **판때기**를 잡은 것이다. M8 컨버터블 모델의 `MAT_Details_Chassis` 가
 * 그랬다 — 이름은 섀시인데 실제로는 차 밑을 덮는 두께 없는 밑판이라(0.018×0.001×0.047),
 * 그것에 맞춰 스케일하면 차가 4% 길어져(4.87m → 5.07m) 앞범퍼가 정지선 판정보다 앞서 나간다.
 */
const BODY_MIN_HEIGHT_RATIO = 0.15;

function referenceBox(root: THREE.Object3D, dropped: Set<THREE.Object3D>): THREE.Box3 {
  const whole = partBox(root, dropped, /(?:)/) ?? new THREE.Box3().setFromObject(root);
  // carpaint 는 재질 이름이다 — 부품 이름이 없는 모델(K5)은 도장 재질이 곧 차체다
  const named = partBox(root, dropped, /body|chassis|exterior|carpaint/i);
  if (!named) return whole;
  const size = named.getSize(new THREE.Vector3());
  return size.y < size.z * BODY_MIN_HEIGHT_RATIO ? whole : named;
}

function fitToCar(root: THREE.Object3D, spec: CarSpec, dropped: Set<THREE.Object3D>): void {
  root.updateMatrixWorld(true);
  const box = referenceBox(root, dropped);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.x < 1e-3 || size.z < 1e-3) return;

  /*
    **Z-up 모델을 눕힌다.**

    승용차는 길이 > 폭 > 높이다. 그러니 가장 긴 축이 Y(위) 로 나온 모델은 Y 가 위가 아니라
    길이라는 뜻이다 — Z-up 으로 만들어 놓고 변환 없이 내보낸 것이다(K5 가 그렇다:
    기준 박스가 212×488×128). 그대로 앉히면 차가 세로로 서서 높이 11m 가 된다.

    회전 순서를 YXZ 로 바꾸는 것이 핵심이다. 기본값(XYZ) 이면 앞뒤 돌리기(Y) 가 눕히기(X)
    **앞에** 적용되어 — 아직 길이축인 Y 를 중심으로 도는 셈이라 — 차가 뒤집힌다.
    YXZ 는 눕힌 **뒤에** 돌린다.
  */
  if (size.y > size.x && size.y > size.z) {
    root.rotation.order = 'YXZ';
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    referenceBox(root, dropped).getSize(size);
  }

  // 긴 가로 축이 차 길이다. 그 축을 Z(전후)에 맞춘다.
  if (size.x > size.z) root.rotation.y = Math.PI / 2;
  root.rotation.y += spec.modelYaw ?? MODEL_YAW;
  root.updateMatrixWorld(true);

  const box1 = referenceBox(root, dropped);
  const size1 = new THREE.Vector3();
  box1.getSize(size1);
  root.scale.setScalar(spec.dims.length / size1.z);
  root.updateMatrixWorld(true);

  /*
    바퀴가 지면에 닿고 차 중심이 원점에 오도록 앉힌다.

    바닥은 **차체 바닥과 바퀴 바닥 중 더 낮은 쪽**이다. 차체 박스만 쓰면 그보다 아래로
    내려온 타이어가 노면에 묻힌다 — K5 가 19cm, 코롤라가 9cm 잠겨 있었다.
    모델 전체 박스를 쓸 수는 없다. 코롤라 시트 메시에 지면 아래 0.58m 까지 떠 있는
    잉여 정점이 있어서 차가 통째로 떠오른다.

    둘 중 낮은 쪽을 고르는 것이라, 바퀴를 못 찾거나 엉뚱한 것(핸들은 이름에 wheel 이
    들어간다)을 집어도 차체 바닥으로 되돌아간다.
  */
  const box2 = referenceBox(root, dropped);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  const wheels = partBox(root, dropped, /tire|tyre|wheel/i);
  const groundY = Math.min(box2.min.y, wheels ? wheels.min.y : Infinity);
  root.position.set(-center.x, -groundY, -center.z);
}
