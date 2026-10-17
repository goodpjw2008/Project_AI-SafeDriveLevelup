/**
 * **지붕 위 LiDAR 센서** (game/LidarRig.ts) — AI 자율주행 중에만 솟아 돌고, 차 모델의 지붕 위에 앉는가.
 *
 * 사용자가 정했다: *"AI 자율주행 모드일 경우에는 이미지와 같이 차량 위에 라이더 센서가 보이게 해줘"*. 모델마다 지붕
 * 높이가 다르므로 지붕을 재서 앉히는데, 지붕 가운데의 안테나(상어 지느러미)를 지붕으로 잡으면 센서가 공중에 뜬다.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { LidarRig } from '../src/game/LidarRig';
import type { CarSpec } from '../src/economy/cars';

const spec = { dims: { length: 4.6, width: 1.8, height: 1.45 } } as unknown as CarSpec;

const box = (w: number, h: number, l: number, x: number, y: number, z: number): THREE.Mesh => {
  // 면이 큰 상자 하나 — 가벼운 모델(LOD)처럼 지붕 한가운데에 정점이 없다
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l));
  mesh.position.set(x, y, z);
  return mesh;
};

/** 상자 차 — 지붕 1.40m, 지붕 가운데 줄에 1.70m 짜리 안테나 */
function boxCar(): THREE.Group {
  const model = new THREE.Group();
  model.add(box(1.8, 1.4, 4.6, 0, 0.7, 0), box(0.05, 0.3, 0.12, 0, 1.55, 0.9));
  return model;
}

describe('지붕 위 LiDAR 센서', () => {
  it('모델의 지붕 위에 앉는다 — 가운데 안테나는 지붕으로 치지 않는다, 차가 어디서 어느 쪽을 보든', () => {
    const car = new THREE.Group();
    car.position.set(12, 0, -30);
    car.rotation.y = 0.7;
    const rig = new LidarRig(spec);
    const model = boxCar();
    car.add(model, rig.group);
    rig.fitRoof(model, car, spec.dims.width);
    expect(rig.group.position.y).toBeCloseTo(1.38, 2);
    // 지붕이 길면 앞쪽에 (웨이모처럼)
    expect(rig.group.position.z).toBeLessThan(-0.4);
    expect(rig.group.position.z).toBeGreaterThan(-1.0);
    expect(rig.group.position.x).toBe(0);
  });

  it('한 줄에 튀어나온 것(잉여 정점 · 장식)에 끌려 뜨지 않는다 — 네 줄의 가운뎃값', () => {
    const car = new THREE.Group();
    const model = boxCar();
    // 지붕 위 한 줄(x 0.35)에만 2.05m 까지 솟은 가는 판 — 코롤라 유리의 잉여 정점 같은 것
    model.add(box(0.04, 0.65, 2.0, 0.35, 1.72, -0.4));
    const rig = new LidarRig(spec);
    car.add(model, rig.group);
    rig.fitRoof(model, car, spec.dims.width);
    expect(rig.group.position.y).toBeCloseTo(1.38, 2);
  });

  it('지붕이 짧은 차(SF90 같은) — 받침을 줄여 지붕 위에만 앉는다, 뒤의 낮은 엔진 유리로 넘어가지 않는다', () => {
    const car = new THREE.Group();
    const model = new THREE.Group();
    // 차체(0.6m) · 짧은 지붕(z −0.6~0, 1.2m) · 낮은 엔진 유리(z 0~0.3) · 뒤 덮개(z 0.3~1.8, 1.15m)
    model.add(box(1.9, 0.6, 4.6, 0, 0.3, 0), box(1.3, 0.6, 0.6, 0, 0.9, -0.3), box(1.3, 0.55, 1.5, 0, 0.875, 1.05));
    const rig = new LidarRig(spec);
    car.add(model, rig.group);
    rig.fitRoof(model, car, spec.dims.width);
    expect(rig.group.position.y).toBeCloseTo(1.18, 2);
    expect(rig.group.position.z).toBeCloseTo(-0.3, 1);
    const rack = (rig.group.children[0].children[0] as THREE.Mesh).scale.z * 0.78;
    expect(rack).toBeLessThanOrEqual(0.6);
  });

  it('오픈카는 적어 둔 자리(운전석 뒤 덮개)에 좁은 받침으로 — 양옆 지느러미 사이 덮개 위에 앉는다', () => {
    const car = new THREE.Group();
    const model = new THREE.Group();
    // 차체 · 가운데 덮개(1.02m) · 양옆 지느러미(|x| 0.45, 1.15m)
    model.add(box(1.9, 0.8, 4.6, 0, 0.4, 0), box(0.7, 0.22, 1.2, 0, 0.91, 0.8));
    for (const side of [-1, 1]) model.add(box(0.15, 0.35, 1.2, side * 0.45, 0.975, 0.8));
    const rig = new LidarRig(spec);
    car.add(model, rig.group);
    rig.fitRoof(model, car, spec.dims.width, { z: 0.8 });
    expect(rig.group.position.z).toBe(0.8);
    expect(rig.group.position.y).toBeCloseTo(1.0, 2);
    const base = rig.group.children[0].children[0] as THREE.Mesh;
    base.geometry.computeBoundingBox();
    const width = (base.geometry.boundingBox!.max.x - base.geometry.boundingBox!.min.x) * base.scale.x;
    expect(width).toBeCloseTo(0.5, 5); // 지느러미(|x| 0.375~) 안쪽
  });

  it('AI 자율주행을 켜면 솟아 돌고, 끄면 가라앉아 사라진다', () => {
    const rig = new LidarRig(spec);
    const lift = rig.group.children[0];
    const spinOf = () => lift.children.find((c) => c.type === 'Group')!.rotation.y;
    expect(rig.group.visible).toBe(false);

    rig.setActive(true);
    rig.update(0.1);
    expect(rig.group.visible).toBe(true);
    expect(lift.scale.y).toBeLessThan(1); // 솟는 중
    for (let i = 0; i < 10; i += 1) rig.update(0.1);
    expect(lift.scale.y).toBeCloseTo(1, 5);
    const before = spinOf();
    rig.update(0.1);
    expect(spinOf()).not.toBe(before); // 돈다

    rig.setActive(false);
    for (let i = 0; i < 10; i += 1) rig.update(0.1);
    expect(rig.group.visible).toBe(false);
  });

  it('처음부터 AI 가 모는 판은 솟는 움직임 없이 바로 서 있다', () => {
    const rig = new LidarRig(spec);
    rig.setActive(true, true);
    expect(rig.group.visible).toBe(true);
    expect(rig.group.children[0].scale.y).toBeCloseTo(1, 5);
  });

  it('모델이 와도 숨지 않는다 — CarMesh 의 useModel 은 keep 이 아닌 것을 모두 끈다', () => {
    expect(new LidarRig(spec).group.userData.keep).toBe(true);
  });
});
