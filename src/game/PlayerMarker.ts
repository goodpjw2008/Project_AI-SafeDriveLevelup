/**
 * **내 차 표시** — 후방 시점에서 도로 위의 어느 차가 내 차인지 알려 주는 **노면 표시**.
 *
 * ## 왜 생겼는가
 *
 * 앞차(leadDrive.ts)가 들어오면서 내 차 바로 앞에 같은 방향으로 가는 차가 생겼다. 배경 차는
 * 카탈로그에서 무작위로 뽑으므로(npcVehicles.ts) **내 차와 같은 차종이 앞에 설 수도 있고**,
 * 후방 시점은 두 차를 거의 같은 각도·같은 크기로 보여 준다. 그 순간 "지금 내가 모는 것이
 * 어느 쪽인가" 를 화면에서 알 방법이 없었다.
 *
 * ## 왜 공중에 띄우지 않는가 — 두 번 실패하고 노면으로 내렸다
 *
 *  1. 지붕 위 0.75m 에 말풍선을 띄웠다. 후방 시점은 비스듬히 내려다보는 각도라, 내 차보다
 *     높은 점은 화면에서 **앞차 위로 올라가 붙었다** — 내 차를 가리키려던 표시가 앞차를
 *     가리키는 그림이 됐다.
 *  2. 지붕에 딱 붙였다. 이번에는 자리가 맞았지만 **그 말풍선이 앞차를 가렸다.** 앞차가
 *     서는지 가는지를 보고 판단하는 판에서, 보라고 만든 표시가 봐야 할 것을 덮은 셈이다.
 *
 * 공중에 무엇을 띄우든 **내 차 뒤에서 보면 그 너머는 앞차 자리**다. 그래서 노면으로 내렸다 —
 * 차를 감싸는 테두리와, 차 **뒤쪽** 노면에 눕힌 글자. 둘 다 시선이 지나는 길 위에 없다.
 *
 * ## 후방 시점에서만 켠다
 *
 *  - **운전석 시점** — 내가 차 안에 앉아 있다. 헷갈릴 일이 없다.
 *  - **탑다운 시점** — 내 차가 화면 한가운데 고정이라 그것으로 이미 구분된다.
 *  - **후방 시점** — 여기서만 헷갈린다. 그래서 여기서만 띄운다.
 *
 * 레이어는 `PLAYER_CAR_LAYER` 다. 좌·우·후방 시야 창 카메라는 그 레이어를 꺼 두므로
 * (CameraRig 주석) 작은 창 안에 이 표시가 겹쳐 뜨지 않는다.
 */

import * as THREE from 'three';

import type { CarSpec } from '../economy/cars';
import { PLAYER_CAR_LAYER } from './CarMesh';

/** 노면 표시 한 장의 크기 (m) — 차를 감쌀 만큼의 폭과, 뒤쪽 글자까지 담을 길이 */
const PLANE_W = 3.2;
const PLANE_L = 8.0;

/** 그림 해상도 — 세로가 길다 (노면에 눕혀 놓고 뒤에서 본다) */
const TEX_W = 256;
const TEX_L = 640;

/**
 * 표시의 한가운데를 차 중심보다 **뒤로** 이만큼 민다 (m).
 *
 * 글자가 차 뒤쪽 노면에 놓이게 하는 값이다. 차체가 글자를 가리지 않으면서, 화면에서는
 * 차 바로 밑에 붙어 있는 것처럼 읽힌다.
 */
const BEHIND = 1.5;

/** 차 뒤 노면에 눕히는 글자 */
const LABEL = 'MY Car';
/** 그 글자의 크기 (텍스처 px) — 표시 폭 256px 중 절반 남짓을 차지한다 */
const LABEL_PX = 36;
/**
 * 글자를 진행 방향으로 늘이는 배율 — 낮은 시점에서 눌려 보이는 만큼 (아래 makeTexture).
 * 한때 1.9 였는데, 글자가 앞뒤로 1m 가까이 길어져 차 뒤로 멀리 뻗었다.
 */
const LABEL_STRETCH = 1.6;
/**
 * **뒷범퍼에서 글자 윗변까지** (m) — 글자를 범퍼에 바짝 붙인다.
 *
 * 한때 글자 한가운데가 뒷범퍼에서 0.9m 뒤였다 — 글자 끝이 차 뒤 1.35m 까지 나가, 사용자가 "바닥의 MY Car 부분이 너무
 * 차 뒤쪽으로 나와 있어" 라고 짚었다. 후방 시점은 차 뒤 위에서 내려다보므로 차 뒤의 노면이 실제보다 길게 펼쳐져 보이고,
 * 테두리의 앞쪽 절반은 차체가 가려 뒤쪽 끝만 드러난다 — 조금만 떨어져 있어도 "차 뒤로 빠져나온 표시" 로 읽힌다.
 * 0.6m 로 당긴 뒤에도 "더 범퍼 쪽에 붙어도 돼" 라고 해서 **윗변을 범퍼 바로 뒤**로 옮겼다.
 *
 * 더 당기지는 못한다 — 범퍼보다 앞(차 밑)의 노면은 후방 시점에서 차체에 가려, 글자 윗부분이 잘려 보인다.
 * 이 자리에서는 글자가 테두리 뒷선에 걸리므로, 글자 폭만큼 **뒷선을 끊어** 테두리에 달린 이름표처럼 보이게 한다
 * (액자의 제목처럼 — makeTexture). 글자 끝은 차 뒤 약 0.75m 다.
 */
const LABEL_TOP_GAP_M = 0.05;
/** 글자 외곽선 두께 (텍스처 px) — 밝은 노면 위에서도 글자가 읽히게 두르는 어두운 테 */
const LABEL_STROKE = 9;

/** 노면에서 살짝 띄운다 — 노면 텍스처와 z-fighting 이 나지 않을 만큼만 */
const HOVER = 0.02;

export class PlayerMarker {
  readonly mesh: THREE.Mesh;

  constructor(spec: CarSpec) {
    const map = makeTexture(spec);
    const material = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      /*
        **톤 매핑을 끈다.** 밤 시나리오에서는 장면 전체가 어둡게 눌리는데, 이 표시는 장면의
        일부가 아니라 화면이 해 주는 안내라 같이 어두워지면 정작 필요한 판에서 흐려진다.
      */
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_L), material);
    // 노면에 눕힌다 (평면의 기본 방향은 화면을 보는 쪽이다)
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.layers.set(PLAYER_CAR_LAYER);
    /*
      **그림자를 받지도 만들지도 않는다.** 노면 표시는 빛이 아니라 안내라, 차 그림자가
      그 위에 지면 무엇을 가리키는지 흐려진다.
    */
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /**
   * 차 밑에 깔아 둔다. `visible` 은 시점이 정한다 (후방 시점에서만 참).
   *
   * @param yaw 차의 방향 — 표시도 함께 돌아야 코너에서 차와 어긋나지 않는다
   */
  update(x: number, z: number, yaw: number, visible: boolean): void {
    this.mesh.visible = visible;
    if (!visible) return;
    const pose = markerPose(x, z, yaw);
    this.mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.mesh.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
  }

  dispose(): void {
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.mesh.geometry.dispose();
  }
}

/**
 * 차 자세 → 표시의 자리와 회전. **순수 함수**라 화면 없이 테스트한다 (tests/playerMarker.test.ts).
 *
 * - 자리: 차 중심에서 **뒤쪽**(진행 방향의 반대)으로 `BEHIND` 만큼. 전방은 (-sin yaw, -cos yaw) 다
 *   (Vehicle 과 같은 약속)
 * - 회전: 평면을 눕힌(x 축 -90°) 뒤 **차와 같은 방향**으로 돈다. 눕힌 뒤의 로컬 z 축 회전은
 *   월드 y 축 회전과 같은 방향이라, 차체(`group.rotation.y = yaw`)와 **같은 부호**를 넣는다.
 *
 * 처음에 회전 부호를 뒤집어 넣었다. 직진할 때는 yaw 가 0 이라 드러나지 않다가, 우회전하면
 * 표시만 왼쪽으로 돌았고 — 90° 돈 뒤에는 표시가 거꾸로 서서 테두리는 차 **뒤**에, 글자는
 * 차 밑에 깔렸다. 화면으로 우회전을 해 보기 전까지 아무도 몰랐다.
 */
export function markerPose(
  x: number,
  z: number,
  yaw: number,
): { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } } {
  return {
    position: { x: x + Math.sin(yaw) * BEHIND, y: HOVER, z: z + Math.cos(yaw) * BEHIND },
    rotation: { x: -Math.PI / 2, y: 0, z: yaw },
  };
}

/**
 * 노면 표시를 캔버스에 굽는다 — **차를 감싸는 테두리 + 뒤쪽 노면의 "MY Car"**.
 *
 * 초록은 이 게임이 "지금 이것" 을 가리킬 때 쓰는 색이다 (시나리오 카드의 주행 궤적,
 * 정지 안내의 '서행 진행').
 *
 * 글자는 **진행 방향으로 늘여서** 그린다. 노면 문자를 낮은 시점에서 보면 원근 때문에
 * 눌려 보이기 때문이고, 이 게임의 실제 노면 문자('어린이보호구역')가 쓰는 방법과 같다.
 */
function makeTexture(spec: CarSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_L;
  const ctx = canvas.getContext('2d')!;

  const pxPerM = TEX_L / PLANE_L;
  // 차 중심은 표시 한가운데보다 BEHIND 만큼 **앞**에 있다 (위쪽이 진행 방향)
  const carCenterY = TEX_L / 2 - BEHIND * pxPerM;
  const carL = spec.dims.length * pxPerM;
  const carW = spec.dims.width * (TEX_W / PLANE_W);

  // ── 차를 감싸는 테두리 ──
  const padX = 22;
  // 앞뒤 여백 — 뒤쪽이 차 밖으로 드러나는 부분이라 좁게 둔다 (0.125m. 한때 0.2m)
  const padY = 10;
  const w = carW + padX * 2;
  const h = carL + padY * 2;
  const x = (TEX_W - w) / 2;
  const y = carCenterY - h / 2;
  const r = 34;

  ctx.strokeStyle = 'rgba(46, 224, 106, 0.95)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.stroke();

  /*
    테두리 안쪽에 아주 옅은 초록을 깐다. 선만 두면 노면의 밝은 차선·횡단보도 위에서 선이
    묻히는데, 면이 있으면 "이 자리" 가 한눈에 잡힌다. 차체가 거의 다 덮으므로 진하면 안 된다.
  */
  ctx.fillStyle = 'rgba(46, 224, 106, 0.16)';
  ctx.fill();

  // ── 뒤쪽 노면의 글자 — 뒷범퍼 바로 뒤, 테두리 뒷선에 걸린 이름표 ──
  ctx.save();
  /*
    **글자는 테두리보다 작게 둔다.** 처음에는 62px 로 차 폭만큼 컸는데, 표시가 차보다
    눈에 띄어 정작 봐야 할 차와 앞차가 묻혔다. 차를 가리키는 꼬리표 정도면 충분하다.
  */
  ctx.font = `bold ${LABEL_PX}px "Pretendard Variable", Pretendard, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(LABEL);
  /*
    **폭에 맞춰 줄인다.** 영문은 글자 수가 많아 한글 두 글자보다 넓다 — 표시 폭을 넘으면
    양끝이 잘린다. 테두리 선 두께만큼 여유를 두고 넘칠 때만 가로로 줄인다.
  */
  const room = TEX_W - 24;
  const fit = Math.min(1, room / metrics.width);
  /*
    **글자 윗변을 재서 놓는다.** 한가운데를 거리로 두면 글꼴이 바뀔 때마다 윗변이 범퍼 밑(가려지는 자리)으로
    들어가거나 멀어진다. 실제 글자 높이(외곽선 포함)에 늘임 배율을 곱한 만큼 윗변 아래에 한가운데를 둔다.
  */
  const above = ((metrics.actualBoundingBoxAscent || LABEL_PX * 0.36) + LABEL_STROKE / 2) * LABEL_STRETCH;
  const textY = carCenterY + carL / 2 + LABEL_TOP_GAP_M * pxPerM + above;
  // 테두리 뒷선을 글자 폭만큼 끊는다 — 선이 글자 사이로 비치면 글자가 선에 긁혀 보인다
  const gapHalf = (metrics.width * fit) / 2 + 10;
  ctx.clearRect(TEX_W / 2 - gapHalf, y + h - 8, gapHalf * 2, 16);
  ctx.translate(TEX_W / 2, textY);
  // 낮은 시점에서 눌려 보이는 만큼 진행 방향으로 늘인다 (노면 문자와 같은 사고)
  ctx.scale(fit, LABEL_STRETCH);
  ctx.lineWidth = LABEL_STROKE;
  ctx.strokeStyle = 'rgba(8, 24, 14, 0.85)';
  ctx.strokeText(LABEL, 0, 0);
  ctx.fillStyle = 'rgba(46, 224, 106, 0.98)';
  ctx.fillText(LABEL, 0, 0);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
