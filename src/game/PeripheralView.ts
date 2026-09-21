/**
 * 좌·우 주변시야 창 + 후방 창.
 *
 * 실제 운전자의 시야는 눈만으로도 좌우 100° 가까이 되고, 고개까지 돌리면 횡단보도
 * 양 끝이 한눈에 들어온다. 반면 모니터에 담기는 수평 화각은 100° 남짓이라
 * 횡단보도 끝은 화면 밖으로 밀려난다. 실측하면
 *
 *   - 정지선 A 에서 첫 횡단보도의 좌측 끝  : 좌 78°
 *   - 두 번째 횡단보도(C) 앞에서 우측 끝   : 우 67°
 *
 * 로 둘 다 화면 밖이다. 즉 "보행자의 통행이 끝났는지" 를 눈으로 확인할 방법이 없어지는데,
 * 그건 이 게임이 가르치려는 판단(제27조 보행자 보호) 자체를 못 하게 만든다.
 *
 * 그래서 사이드미러 패널과 같은 방식으로 — 실제 운전자가 얻는 정보량에 맞추기 위해 —
 * 차체 기준 좌·우 68° 방향을 보는 창을 화면 양옆에 띄운다. Z/X 로 고개를 돌리는
 * 조작은 그대로 두되, 돌리지 않아도 "저쪽에 사람이 남아 있다" 는 것은 알 수 있어야 한다.
 *
 * 좌·우 창은 거울이 아니므로 좌우 반전을 하지 않는다. **후방 창만** 반전한다 —
 * 룸미러를 대신하는 창이라, 반전하지 않으면 뒤차의 좌우가 뒤바뀌어 읽힌다.
 *
 * 셋 다 교차로에 다가갈 때 함께 떠오른다 — **정지선 앞에서 멈추기 한참 전에** 완전히
 * 드러난다(FULL_DIST 참조). 늘 띄워 두면 정작 봐야 할 때 눈이 가지 않고,
 * 화면 가운데의 도로에서 주의를 뺏는다.
 *
 * 후방 창을 여기에 둔 이유: 예전에는 차체에 붙인 3D 거울면에 실시간 텍스처를 입혔는데,
 * 그러려면 모델마다 거울이 어디 붙는지를 알아야 했다. Sketchfab 모델은 부품 이름이
 * 제각각이라 그 자리를 자동으로 찾을 수 없다. 화면 위의 창으로 옮기면 **모델을 받아
 * 그대로 쓸 수 있다.**
 */

import * as THREE from 'three';
import type { CarSpec } from '../economy/cars';
import { STOP_LINE } from '../layout';
import { STOP_ZONE_DEPTH } from '../rules/lawRules';
import { driverEyeLocal } from './CarMesh';
import { clampSeatOffset } from './carModel';
import {
  CAPTION_SIZE,
  HUD_BORDER_FRAC,
  borderBox,
  makeCaptionTexture,
  makeHudFrameTexture,
} from './overlayTextures';
import type { Vehicle } from './Vehicle';

/** 차체 정면 기준 창이 보는 방향 (rad ≒ 68°) */
const LOOK_YAW = 1.19;

/**
 * 창의 화각. 68° ± 30° = 38°~98° 를 담는다.
 * 메인 화면의 수평 반각(화면비에 따라 45°~53°)과 겹치므로 사이 구간이 비지 않는다.
 */
const PANEL_FOV = 60;

/**
 * 후방 창의 화각.
 *
 * 좌·우 창보다 **좁게** 잡는다. 좌·우는 "저쪽 끝에 사람이 남아 있나" 를 보는 창이라
 * 넓어야 하지만, 후방은 **뒤차가 얼마나 붙었나** 를 읽는 창이다. 넓으면 뒤차가 점으로
 * 보여 거리 감각이 안 잡힌다. 36° 면 같은 거리의 차가 60° 일 때의 두 배 가까이 커진다.
 */
const REAR_FOV = 36;

/**
 * 창이 **완전히** 드러나 있어야 하는 지점 (교차로 중심에서의 거리, m).
 *
 * 기준은 교차로가 아니라 **정지선**이다. 예전에는 "중심에서 34m 부터 떠올라 28m 에서 완전히"
 * 로 절대 거리를 박아 두었는데, 도로를 넓혀 정지선이 16.5m → 24.2m 로 밀려나자 정지선까지
 * 남은 여유가 17.5m → 7.6m 로 줄었다. 그래서 **정지선 앞에 세웠는데도 창이 반투명한** 상태가
 * 됐다 — 적법한 정지 구역(정지선 앞 12m) 맨 뒤에 서면 아예 보이지도 않았다.
 *
 * 그래서 정지 구역보다 8m 더 뒤에서 이미 100% 가 되게 잡는다. **어디에 세우든 좌·우·후방이
 * 다 보이는 상태에서 판단하게** 하는 것이 이 창의 목적이라, 여유는 넉넉해야 한다.
 */
const FULL_DIST = STOP_LINE + STOP_ZONE_DEPTH + 8;

/** 창이 떠오르기 시작하는 지점. 여기서 FULL_DIST 까지 8m 동안 서서히 나타난다. */
const FADE_DIST = FULL_DIST + 8;

/**
 * 교차로 중심에서 이만큼 떨어져 있을 때의 목표 노출도 (0~1).
 *
 * 창을 띄우는 판단은 렌더링과 무관한 순수 계산이라 따로 떼어 둔다 —
 * 브라우저 없이 테스트할 수 있어야 교차로 치수를 바꿀 때 이 규칙이 깨진 것을 바로 잡아낸다.
 * (실제로 도로 폭을 넓혔을 때 이 값이 조용히 망가졌다)
 */
export function panelStrengthAt(dist: number): number {
  return clamp01((FADE_DIST - dist) / (FADE_DIST - FULL_DIST));
}

/**
 * 렌더 타깃 해상도 — 사람이 있는지만 알면 되므로 낮게 잡는다.
 *
 * 384×240 에서 320×200 으로 내렸다. 화면에 그려지는 창은 화면 폭의 17% 라 이보다도 작고,
 * 이 창이 답하는 질문("저쪽에 사람이 남아 있나")에 해상도는 거의 영향이 없다.
 * 대신 픽셀이 30% 줄어 매 프레임 도는 비용이 그만큼 가벼워진다.
 */
const TARGET = { w: 320, h: 200 };

/** 패널 크기 (화면 폭 대비). 좁은 화면에서는 최소 픽셀 폭을 지킨다. */
const WIDTH_FRAC = 0.17;
const MIN_WIDTH_PX = 132;
const PANEL_ASPECT = 0.625;

/**
 * 좌·우 시야 창의 윗변 (화면 위에서 px).
 *
 * 화면 **맨 위**에 붙인다. 가운데는 앞유리(도로)이고 아래는 대시보드라, 창을 놓을 수 있는
 * 자리는 위쪽뿐이다. 지시문 카드가 가운데 위로 옮겨 가면서 좌우 끝이 비었다.
 *
 * 이름표는 창 **아래**에 붙는다 — 위에는 자리가 없다.
 */
const TOP_MARGIN_PX = 14;

/**
 * 후방 창의 세로 위치 (화면 높이 대비) — 계기판을 못 찾았을 때만 쓰는 대비책이다.
 * 평소에는 계기판 옆에 붙는다 (resize 참조).
 */
const REAR_VERTICAL_FRAC = 0.24;

/** 화면 가장자리 여백 (화면 폭 대비) */
const EDGE_MARGIN = 0.012;

interface Unit {
  /** -1 좌 · +1 우 · 0 후방 */
  side: -1 | 0 | 1;
  /** 거울처럼 좌우를 뒤집을지 (후방 창만) */
  mirrored: boolean;
  camera: THREE.PerspectiveCamera;
  target: THREE.WebGLRenderTarget;
  panel: THREE.Mesh;
  frame: THREE.Mesh;
  label: THREE.Mesh;
  panelMat: THREE.MeshBasicMaterial;
  frameMat: THREE.MeshBasicMaterial;
  labelMat: THREE.MeshBasicMaterial;
  /** 차체 로컬 기준 시선 방향 (전방이 -Z) */
  dir: { x: number; z: number };
}

export class PeripheralView {
  private overlayScene = new THREE.Scene();
  private overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  private units: Unit[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private eye: { x: number; y: number; z: number };

  /** 시점이 운전석일 때만 쓴다 */
  private enabled = true;
  /** 표시 강도 0~1 — 교차로에 다가갈 때 서서히 떠오른다 */
  private strength = 0;
  private targetStrength = 0;
  /**
   * 이번 프레임에 구울 창 (좌·우 번갈아).
   *
   * 두 창을 한 프레임에 몰아 굽고 다음 프레임을 쉬면, 창 하나당 갱신율은 같으면서
   * 프레임 시간만 무겁고 가볍고를 반복한다. 그 주기적인 끊김이 회전 중에 특히 잘 보인다.
   * 한 프레임에 하나씩 돌아가며 구우면 비용이 매 프레임 일정하다.
   */
  private cursor = 0;

  constructor(
    private scene: THREE.Scene,
    spec: CarSpec,
  ) {
    this.eye = driverEyeLocal(spec);
    this.baseEyeZ = this.eye.z;
    this.addUnit(-1, '◀ 좌측 시야');
    this.addUnit(1, '우측 시야 ▶');
    // 후방은 거울을 대신하므로 좌우를 뒤집는다. 뜨는 시점은 좌·우 창과 같다
    this.addUnit(0, '후방 시야', { mirrored: true });
    this.overlayCamera.position.z = 5;
    /*
      처음 상태를 **반드시 한 번 적용한다.**

      좌·우 창은 교차로에 다가갈 때 떠올라야 하는데(strength 0 에서 시작), 이 호출이 없으면
      재질의 기본 불투명도(1)와 visible(true) 그대로 남아 출발하자마자 활짝 떠 있었다.
      예전에는 renderOverlay 가 strength 로 한 번 더 막아 줘서 드러나지 않았는데,
      후방 창을 늘 띄우려고 그 가드를 뺀 순간 좌·우 창까지 같이 나와 버렸다.
    */
    this.applyOpacity();
  }

  /**
   * 3D 모델이 알려 준 눈높이로 갈아 끼운다.
   * 메인 화면과 다른 높이에서 보면 같은 장면인데 창만 시점이 어긋나 보인다.
   */
  setEyeHeight(y: number): void {
    this.eye.y = y;
  }

  /**
   * 좌석 앞뒤 조절 (m, +가 앞) — 메인 화면(CameraRig)과 같은 값을 받는다.
   * 창의 시점만 제자리에 남으면 고개를 돌릴 때 창과 화면이 어긋난다.
   */
  setSeatOffset(meters: number): void {
    this.eye.z = this.baseEyeZ - clampSeatOffset(meters);
  }

  /** 조절 전의 기본 앞뒤 자리 — 조절값은 항상 여기서부터 잰다 */
  private baseEyeZ: number;

  private addUnit(side: -1 | 0 | 1, caption: string, opts: { mirrored?: boolean } = {}): void {
    const target = this.track(
      new THREE.WebGLRenderTarget(TARGET.w, TARGET.h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
      }),
    );
    target.texture.colorSpace = THREE.SRGBColorSpace;
    if (opts.mirrored) {
      // 카메라가 뒤를 보고 찍은 그림은 거울상과 좌우가 반대다
      target.texture.wrapS = THREE.ClampToEdgeWrapping;
      target.texture.repeat.x = -1;
      target.texture.offset.x = 1;
    }

    // far 는 하늘 구체(반지름 420)보다 멀어야 한다 — 짧으면 배경이 검게 잘린다
    const camera = new THREE.PerspectiveCamera(
      side === 0 ? REAR_FOV : PANEL_FOV,
      TARGET.w / TARGET.h,
      0.15,
      600,
    );

    const geo = this.track(new THREE.PlaneGeometry(1, 1));
    // 세 겹(테두리·영상·이름표) 모두 반투명으로 두어야 renderOrder 순서가 지켜진다.
    // 불투명과 반투명이 섞이면 Three.js 가 반투명을 나중에 그려 순서가 뒤집힌다.
    const panelMat = this.track(
      new THREE.MeshBasicMaterial({
        map: target.texture,
        depthTest: false,
        transparent: true,
        toneMapped: false,
      }),
    );
    const panel = new THREE.Mesh(geo, panelMat);
    panel.renderOrder = 2;

    // 거울이 아니라 계기 창이라는 신호 — 하우징 없이 얇은 선과 모서리 표식만 얹는다
    const frameMat = this.track(
      new THREE.MeshBasicMaterial({
        map: this.track(makeHudFrameTexture(PANEL_ASPECT)),
        depthTest: false,
        transparent: true,
        toneMapped: false,
      }),
    );
    const frame = new THREE.Mesh(geo, frameMat);
    frame.renderOrder = 3;

    const labelMat = this.track(
      new THREE.MeshBasicMaterial({
        map: this.track(makeCaptionTexture(caption)),
        depthTest: false,
        transparent: true,
        toneMapped: false,
      }),
    );
    const label = new THREE.Mesh(geo, labelMat);
    label.renderOrder = 4;

    this.overlayScene.add(panel, frame, label);
    this.units.push({
      side,
      mirrored: opts.mirrored ?? false,
      camera,
      target,
      panel,
      frame,
      label,
      panelMat,
      frameMat,
      labelMat,
      dir:
        side === 0
          ? { x: 0, z: 1 } // 정후방
          : { x: side * Math.sin(LOOK_YAW), z: -Math.cos(LOOK_YAW) },
    });
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  /** 운전석 시점에서만 띄운다 */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.strength = this.targetStrength = 0;
    this.applyOpacity();
  }

  /**
   * 교차로에서 멀 때는 볼 이유가 없으므로 접어 둔다.
   * 화면을 늘 가려 두면 정작 봐야 할 때 눈이 가지 않는다.
   */
  private setTargetStrength(v: number): void {
    this.targetStrength = v;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const sideW = Math.min(w * 0.3, Math.max(MIN_WIDTH_PX, w * WIDTH_FRAC));
    const margin = w * EDGE_MARGIN;
    const box = borderBox(PANEL_ASPECT, HUD_BORDER_FRAC);

    /*
      후방 창은 **계기판과 한 줄로** 놓는다 (계기판은 우측 하단, 좁은 화면에서는 좌측 하단).

      계기판은 DOM 캔버스(#cluster)라 크기를 CSS 가 정한다. 그 값을 여기에 베껴 두면
      한쪽만 고쳤을 때 두 개가 어긋나므로, 화면에서 실제 자리를 읽어 와 그 **옆에
      밑변을 맞춰** 붙인다. 계기판이 없으면(다른 화면) 예전처럼 혼자 우측 상단에 선다.
    */
    const clusterRect = document.getElementById('cluster')?.getBoundingClientRect();
    const rowGap = margin * 0.6;

    for (const u of this.units) {
      const pw = sideW;
      let cx: number;
      let cy: number;
      let labelBelow = false;

      if (u.side === 0 && clusterRect && clusterRect.width > 0) {
        /*
          후방 창은 좌·우 창과 **같은 크기**로 두고, 계기판 옆에 **밑변을 맞춰** 붙인다.
          셋이 같은 크기라야 창 안의 거리감을 서로 견줘 읽을 수 있다. 계기판보다 세로가
          길어 위로 더 올라가지만, 밑변이 맞아 있으면 한 줄로 읽힌다.

          붙는 쪽은 계기판이 어디 있느냐로 정한다 — 화면 왼쪽에 있으면(좁은 화면) 그
          오른쪽에, 아니면 왼쪽에. 한쪽으로 고정해 두면 좁은 화면에서 창이 화면 밖으로 나간다.
        */
        const clusterOnLeft = clusterRect.left + clusterRect.width / 2 < w / 2;
        const halfW = (pw * box.outerW) / 2;
        cx = clusterOnLeft ? clusterRect.right + rowGap + halfW : clusterRect.left - rowGap - halfW;
        cy = clusterRect.bottom - (pw * PANEL_ASPECT) / 2;
        // 아래쪽이 화면 끝이므로 이름표는 위에 붙인다
      } else if (u.side === 0) {
        cx = w - margin - (pw * box.outerW) / 2;
        cy = h * REAR_VERTICAL_FRAC;
      } else {
        cx = u.side < 0 ? margin + (pw * box.outerW) / 2 : w - margin - (pw * box.outerW) / 2;
        cy = TOP_MARGIN_PX + (pw * PANEL_ASPECT) / 2;
        labelBelow = true; // 창 위에는 자리가 없다
      }

      const ph = pw * PANEL_ASPECT;
      const hNdc = (ph / h) * 2;
      const xNdc = (cx / w) * 2 - 1;
      const yNdc = 1 - (cy / h) * 2;

      u.panel.scale.set((pw / w) * 2, hNdc, 1);
      u.panel.position.set(xNdc, yNdc, 0);

      u.frame.scale.set((pw * box.outerW / w) * 2, (pw * box.outerH / h) * 2, 1);
      u.frame.position.set(xNdc, yNdc, 0.01);

      // 이름표는 기본이 창 위 — 창이 상단 카드에 닿을 만큼 올라간 경우에만 아래로 내린다
      const lw = pw * 0.62;
      const lh = lw * (CAPTION_SIZE.h / CAPTION_SIZE.w);
      const off = hNdc / 2 + lh / h + (6 / h) * 2;
      u.label.scale.set((lw / w) * 2, (lh / h) * 2, 1);
      u.label.position.set(xNdc, yNdc + (labelBelow ? -off : off), 0.02);
    }
  }

  /** 차량 움직임에 맞춰 창의 시점을 옮긴다. 고개(글랜스) 회전은 따르지 않는다. */
  update(vehicle: Vehicle, dt: number): void {
    const f = vehicle.forward;
    const right = { x: -f.z, z: f.x };

    // 교차로 중심에서의 거리로 표시 여부를 정한다 (FADE_DIST 부터 떠올라 FULL_DIST 에서 완전히)
    const dist = Math.max(Math.abs(vehicle.x), Math.abs(vehicle.z));
    this.setTargetStrength(this.enabled ? panelStrengthAt(dist) : 0);

    const k = Math.min(1, dt * 5);
    if (Math.abs(this.targetStrength - this.strength) > 0.001) {
      this.strength += (this.targetStrength - this.strength) * k;
      this.applyOpacity();
    }

    for (const u of this.units) {
      /*
        카메라를 **그쪽 어깨 자리**에 둔다 — 좌측 창은 운전석, 우측 창은 그 대칭 자리.

        둘 다 운전석(좌측)에 두면 우측 창에서만 우측 사이드미러가 차 폭만큼 멀어져
        (0.64m 대 1.07m) 절반 크기로, 게다가 61° 비스듬히 잘려 보였다. 좌우 창이 같은
        상황을 다르게 보여 주면 어느 쪽이 정상인지 읽는 데 혼선이 생긴다.

        시점이 0.53m 옆으로 가는 것은 26m 앞을 보는 창에서 사실상 차이가 없고,
        원래 이 창은 화면 화각 밖(좌 78°·우 67°)을 보완하려고 만든 보조 창이지
        운전석 시야를 그대로 옮긴 것이 아니다.
      */
      // 후방 창은 룸미러 자리 — 차 가운데에서 뒤를 본다
      const ex = u.side === 0 ? 0 : u.side < 0 ? this.eye.x : -this.eye.x;
      const px = vehicle.x + right.x * ex + f.x * -this.eye.z;
      const pz = vehicle.z + right.z * ex + f.z * -this.eye.z;
      u.camera.position.set(px, this.eye.y, pz);

      const dx = right.x * u.dir.x + f.x * -u.dir.z;
      const dz = right.z * u.dir.x + f.z * -u.dir.z;
      // 보도에 서 있는 보행자의 발끝까지 담기도록 시선을 조금 내린다
      // 후방은 뒤차의 앞면을 봐야 하므로 거의 수평으로 둔다 (좌·우는 보도 발끝까지 담게 조금 내린다)
      u.camera.lookAt(px + dx * 26, this.eye.y - (u.side === 0 ? 0.5 : 1.1), pz + dz * 26);
    }
  }

  private applyOpacity(): void {
    const a = this.strength;
    const on = a > 0.02;
    for (const u of this.units) {
      u.panelMat.opacity = a;
      u.frameMat.opacity = a * 0.9;
      u.labelMat.opacity = a;
      u.panel.visible = on;
      u.frame.visible = on;
      u.label.visible = on;
    }
  }

  /**
   * 창을 **미리 한 번 그려 둔다** (주행 시작 전에 한 번).
   *
   * 창은 교차로에 다가갈 때 떠오르는데, 바로 그 프레임에 멈칫하는 원인이 셋이었다.
   *
   *   1. 렌더 타깃(프레임버퍼) 세 개가 **처음 쓸 때** 할당된다.
   *   2. 렌더 타깃에 그리는 셰이더는 화면에 그리는 것과 **다른 프로그램**이다 — 색공간과
   *      톤매핑이 다르기 때문이다. 그래서 장면의 모든 재질이 그 순간 한 번 더 컴파일된다.
   *   3. 창 자체(테두리·이름표)의 재질도 그때 처음 그려진다.
   *
   * 셋 다 여기서 미리 치른다. 강도를 잠깐 1 로 올려 두는 이유는 three 가 **보이는 것만**
   * 컴파일하기 때문이다(traverseVisible) — 투명하거나 숨긴 것은 건너뛴다.
   */
  prewarm(renderer: THREE.WebGLRenderer): void {
    const before = { enabled: this.enabled, strength: this.strength, target: this.targetStrength };
    this.enabled = true;
    this.strength = 1;
    this.applyOpacity();

    const prev = renderer.getRenderTarget();
    for (const u of this.units) {
      renderer.setRenderTarget(u.target);
      renderer.render(this.scene, u.camera);
    }
    renderer.setRenderTarget(prev);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.overlayScene, this.overlayCamera);
    renderer.autoClear = prevAutoClear;

    this.enabled = before.enabled;
    this.strength = before.strength;
    this.targetStrength = before.target;
    this.applyOpacity();
  }

  /**
   * 메인 화면을 그리기 전에 호출.
   *
   * **창이 접혀 있어도 계속 굽는다.** 예전에는 떠오를 때부터 구웠는데, 그 순간 한 프레임에
   * 그리는 횟수가 한 번에서 두 번으로 뛴다 — 미리 컴파일을 다 해 두어도 **비용 자체가
   * 두 배가 되는 지점**이라 거기서 한 번 멈칫했다. 하필 그 자리가 첫 정지선을 향해 가는
   * 중간이라, 판단을 시작할 무렵에 화면이 걸리는 셈이었다.
   *
   * 처음부터 계속 구우면 프레임 비용이 내내 일정해서 튀는 곳이 없다. 대신 창이 보이지
   * 않는 동안에도 한 장씩 그리게 되는데, 320×200 짜리 한 장이라 그 값이 훨씬 싸다.
   * (해상도를 내린 이유가 이것이다 — 위 TARGET 주석)
   */
  renderTargets(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled) return;

    const u = this.units[this.cursor];
    this.cursor = (this.cursor + 1) % this.units.length;

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(u.target);
    renderer.render(this.scene, u.camera);
    renderer.setRenderTarget(prev);
  }

  /**
   * 메인 화면을 그린 뒤에 호출.
   *
   * 이쪽도 강도로 막지 않는다 — 접혀 있으면 창 세 장이 `visible = false` 라 그릴 것이
   * 없어서 값이 사실상 0 이고, 막아 두면 떠오르는 순간 렌더 호출이 하나 늘어난다.
   */
  renderOverlay(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.overlayScene, this.overlayCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.overlayScene.clear();
    this.units = [];
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
