/**
 * 첫 화면 뒤에서 도는 배경 장면.
 *
 * 이 게임을 켜면 3D 운전 시뮬레이터인데 첫인상이 **글자만 있는 문서**였다. 화면 레이어가
 * 불투명해서 뒤의 캔버스가 완전히 가려져 있었고, 애초에 메뉴에서는 아무것도 그리지 않았다.
 *
 * 여기서 하는 일은 교차로에 차를 한 대 세워 두고 **카메라를 아주 천천히 돌리는 것**뿐이다.
 * 화면 덮개가 반투명·blur 라(index.html 의 `.screen`) 뒤에서 이것이 흐릿하게 움직인다.
 *
 * 지켜야 할 것이 셋 있다.
 *
 *  1. **주행 화면과 같은 렌더러 한 벌을 쓴다** (renderer.ts). 캔버스가 하나뿐이다.
 *  2. **주행·좌석 맞추기가 시작되면 즉시 버린다.** 같은 캔버스를 두 곳에서 그리면
 *     프레임마다 서로의 그림을 덮어써 화면이 깜빡인다.
 *  3. **무거운 것을 새로 받지 않는다.** 메뉴에 있는 동안은 main.ts 의 prewarm 이
 *     회선과 주 스레드를 쓰고 있다. 차 모델은 이미 캐시에 있을 때만 갈아 끼우고,
 *     환경광도 이미 구워진 것만 쓴다.
 */

import * as THREE from 'three';

import type { CarSpec } from '../economy/cars';
import { INTERSECTION_HALF, PLAYER_APPROACH_X, STOP_LINE } from '../layout';
import { buildCar, type CarModel } from './CarMesh';
import { Intersection } from './Intersection';
import { World } from './World';
import { loadCarModel, playerLod } from './carModel';
import { sharedRenderer } from './renderer';

/** 차를 세워 두는 자리 — 정지선 바로 앞. 신호등과 횡단보도가 한 화면에 들어온다. */
const PARK = { x: PLAYER_APPROACH_X, z: STOP_LINE + 1.2 };

/**
 * 한 바퀴 도는 데 걸리는 시간 (초).
 *
 * **아주 느려야 한다.** 배경이 눈에 띄게 움직이면 앞의 글자를 읽을 수 없다. 2분이면
 * 화면을 보는 동안 움직인다는 것은 알겠는데 시선을 빼앗기지는 않는 정도다.
 */
const ORBIT_PERIOD = 120;

/** 카메라가 도는 반지름·높이 (m) */
const ORBIT = { radius: 13.5, height: 4.6, lookY: 1.0 };

export class MenuScene {
  private renderer: THREE.WebGLRenderer;
  private world: World;
  private intersection: Intersection;
  private car: CarModel;
  private camera: THREE.PerspectiveCamera;

  private rafId = 0;
  private disposed = false;
  private t = 0;
  private lastFrame = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    spec: CarSpec,
  ) {
    this.renderer = sharedRenderer(canvas);

    // 맑은 낮으로 고정한다 — 첫 화면은 분위기를 고르는 자리가 아니다
    this.world = new World('day', 'clear');
    void this.world.loadEnvironment(this.renderer);
    this.intersection = new Intersection({ schoolZone: false, night: false });
    this.world.scene.add(this.intersection.group);

    this.car = buildCar(spec, { isPlayer: false });
    this.car.group.position.set(PARK.x, 0, PARK.z);
    this.world.scene.add(this.car.group);

    /*
      3D 모델은 **이미 받아 둔 것만** 쓴다. loadCarModel 은 캐시가 있으면 곧바로 주고
      없으면 받아 온다 — 메뉴에서 새로 받기 시작하면 곧 누를 '출발'이 그만큼 늦어진다.
      늦게 도착해도 그때 갈아 끼우면 되고, 안 와도 절차적 차체가 그대로 서 있다.
    */
    void loadCarModel(spec, { lod: playerLod() })
      .then((model) => {
        if (this.disposed || !model) return;
        this.car.useModel(model);
      })
      .catch(() => undefined);

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
    this.resize();
  }

  start(): void {
    if (this.disposed) return;
    this.lastFrame = performance.now();
    const loop = (now: number): void => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(loop);

      // 탭이 백그라운드에 있다가 돌아오면 dt 가 크게 튄다 — 한 프레임 몫으로 조인다
      const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
      this.lastFrame = now;
      this.t += dt;

      const a = (this.t / ORBIT_PERIOD) * Math.PI * 2;
      // 교차로 안쪽(우회전해서 나가는 쪽)을 중심으로 돈다
      const cx = PARK.x + Math.sin(a) * ORBIT.radius;
      const cz = PARK.z - INTERSECTION_HALF * 0.5 + Math.cos(a) * ORBIT.radius;
      this.camera.position.set(cx, ORBIT.height, cz);
      this.camera.lookAt(PARK.x, ORBIT.lookY, PARK.z - INTERSECTION_HALF * 0.5);

      this.world.update(dt, new THREE.Vector3(PARK.x, 0, PARK.z));
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.world.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.car.dispose();
    this.intersection.dispose();
    this.world.dispose();
    // 렌더러는 버리지 않는다 (renderer.ts — 주행 화면이 이어서 쓴다)
  }
}
