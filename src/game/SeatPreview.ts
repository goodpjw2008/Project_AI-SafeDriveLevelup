/**
 * 좌석 맞추기 화면.
 *
 * 차고에서 차 사진을 누르면 **그 차의 운전석에 앉은 화면**으로 바뀐다. 정지선 앞에 세워
 * 둔 채로 위·아래 화살표(또는 마우스 휠)로 좌석을 앞뒤로 옮기고, 저장하면 그 자리가
 * 다음 주행부터 그대로 쓰인다.
 *
 * 숫자로 고르게 하지 않는 이유는 간단하다 — **직접 봐야 안다.** 같은 "앞으로 8cm" 라도
 * 차마다 앞유리 각도와 대시보드 깊이가 달라 결과가 전혀 다르고, 신호등이 보이는지
 * 횡단보도 끝이 잘리는지는 그 자리에 앉아 봐야 판단할 수 있다.
 *
 * 주행 화면(Game)을 그대로 쓰지 않는 이유: 그쪽은 차가 달리고 판정이 돌고 시간이 흐른다.
 * 여기서는 세워 둔 차와 카메라만 있으면 되므로, 같은 부품(World·Intersection·CarMesh·
 * CameraRig)을 훨씬 얇게 조립한다.
 */

import * as THREE from 'three';
import { PLAYER_APPROACH_X, STOP_LINE } from '../layout';
import type { CarSpec } from '../economy/cars';
import { buildCar, type CarModel } from './CarMesh';
import { CameraRig } from './CameraRig';
import { Intersection } from './Intersection';
import { World } from './World';
import { sharedRenderer } from './renderer';
import {
  SEAT_RANGE,
  clampSeatOffset,
  driverView,
  loadCarModel,
  seatForwardLimit,
  type CarModelAnchors,
} from './carModel';

/** 화살표 한 번에 움직이는 거리 (m). 1cm 면 한 번 눌러 바뀐 것이 눈에 보인다. */
const STEP = 0.01;

/** 좌석을 세워 두는 자리 — 정지선 3m 앞. 신호등·횡단보도가 한눈에 들어오는 판단 위치다. */
const PARK = { x: PLAYER_APPROACH_X, z: STOP_LINE + 3 };

export interface SeatPreviewCallbacks {
  /** 값이 바뀔 때마다 (화면 표시용) */
  onChange(offset: number, text: string): void;
}

export class SeatPreview {
  private renderer: THREE.WebGLRenderer;
  private world: World;
  private intersection: Intersection;
  private rig: CameraRig;
  private carModel: CarModel;
  private anchors: CarModelAnchors | null = null;

  private offset: number;
  private limit = SEAT_RANGE.max;
  private rafId = 0;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private spec: CarSpec,
    offset: number,
    private cb: SeatPreviewCallbacks,
  ) {
    this.offset = clampSeatOffset(offset);

    // 주행 화면과 **같은 렌더러 한 벌**을 쓴다 (renderer.ts) — 캔버스가 하나뿐이고,
    // 새로 만들면 모델을 GPU 에 다시 올리게 된다
    this.renderer = sharedRenderer(canvas);

    // 맑은 낮으로 고정한다 — 좌석을 맞추는 화면이지 분위기를 보는 화면이 아니다
    this.world = new World('day', 'clear');
    void this.world.loadEnvironment(this.renderer);
    this.intersection = new Intersection({ schoolZone: false, night: false });
    this.world.scene.add(this.intersection.group);

    this.carModel = buildCar(spec, { isPlayer: true });
    this.carModel.group.position.set(PARK.x, 0, PARK.z);
    this.world.scene.add(this.carModel.group);

    this.rig = new CameraRig(canvas.clientWidth / canvas.clientHeight, spec);
    this.carModel.setSeatedVisible(false);
    void loadCarModel(spec).then((model) => {
      if (this.disposed) return;
      if (model) {
        this.carModel.useModel(model);
        this.anchors = (model.userData.anchors as CarModelAnchors | null) ?? null;
        if (this.anchors?.eye) this.rig.setEyeHeight(this.anchors.eye.y);
        this.limit = seatForwardLimit(spec, this.anchors);
      }
      this.carModel.setSeatedVisible(true);
      this.apply();
    });

    this.apply();
    this.resize();
  }

  /** 위·아래 화살표와 마우스 휠이 부르는 함수. +면 앞으로 */
  nudge(steps: number): void {
    this.offset = Math.max(SEAT_RANGE.min, Math.min(this.limit, this.offset + steps * STEP));
    this.apply();
  }

  reset(): void {
    this.offset = 0;
    this.apply();
  }

  get value(): number {
    return this.offset;
  }

  private apply(): void {
    /*
      한계는 모델이 와야 정해진다(앞유리를 재야 나온다). 그 전에 움직였거나 저장본이 다른
      차에서 쓰던 값이면 여기서 조인다 — 조이지 않으면 눈이 앞유리를 뚫는다.
    */
    this.offset = Math.max(SEAT_RANGE.min, Math.min(this.limit, this.offset));
    this.rig.setSeatOffset(this.offset);
    const cm = Math.round(this.offset * 100);
    const where = cm === 0 ? '기본 자리' : cm > 0 ? `앞으로 ${cm}cm` : `뒤로 ${-cm}cm`;
    const view = driverView(this.spec, this.anchors, this.offset);
    // 시야각은 앞유리를 잰 차만 나온다 (못 잰 차는 자리만 보여 준다)
    this.cb.onChange(
      this.offset,
      view ? `${where} · 앞유리 세로 시야 ${Math.round(view.angleDeg)}°` : where,
    );
  }

  start(): void {
    if (this.disposed) return;
    const loop = (): void => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(loop);
      // 차는 서 있다 — 카메라만 매 프레임 자리를 다시 잡는다(좌석을 옮기면 부드럽게 따라온다)
      this.rig.update(
        { x: PARK.x, z: PARK.z, yaw: 0, speedKmh: 0, yawRate: 0, forward: { x: 0, z: -1 } },
        1 / 60,
      );
      this.world.update(1 / 60, new THREE.Vector3(PARK.x, 0, PARK.z));
      // 그림자 맵은 자동 갱신을 꺼 두었다 (renderer.ts) — 프레임마다 직접 켜 준다
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.world.scene, this.rig.camera);
    };
    loop();
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w / h);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.carModel.dispose();
    this.intersection.dispose();
    this.world.dispose();
    // 렌더러는 버리지 않는다 (renderer.ts)
  }
}
