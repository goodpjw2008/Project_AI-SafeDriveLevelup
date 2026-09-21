/**
 * **"내 차" 노면 표시가 차와 같이 도는가** (game/PlayerMarker.ts 의 `markerPose`).
 *
 * 회전 부호를 한 번 뒤집어 넣은 적이 있다. 직진할 때는 방향이 0 이라 드러나지 않다가,
 * 우회전하면 표시만 반대로 돌았고 90° 돈 뒤에는 거꾸로 서서 테두리가 차 **뒤**에 가 있었다.
 * 그래서 여기서는 three 가 실제로 적용하는 회전을 그대로 돌려, 그림의 위쪽(= 진행 방향으로
 * 그린 쪽)이 차의 전방을 가리키는지를 **모든 방향에서** 확인한다.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { markerPose } from '../src/game/PlayerMarker';

/** Vehicle 과 같은 약속 — 전방 = (-sin yaw, -cos yaw) */
const forward = (yaw: number) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));

describe('"내 차" 노면 표시', () => {
  const yaws = [0, -Math.PI / 4, -Math.PI / 2, -Math.PI * 0.75, Math.PI / 3, Math.PI];

  it('그림의 위쪽(진행 방향으로 그린 쪽)이 어느 방향에서나 차의 전방을 가리킨다', () => {
    for (const yaw of yaws) {
      const { rotation } = markerPose(0, 0, yaw);
      const o = new THREE.Object3D();
      o.rotation.set(rotation.x, rotation.y, rotation.z);
      o.updateMatrixWorld(true);
      // 평면의 +Y 가 텍스처의 위쪽이다
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(o.quaternion);
      const f = forward(yaw);
      expect(up.x, `yaw ${yaw.toFixed(2)}`).toBeCloseTo(f.x, 5);
      expect(up.z, `yaw ${yaw.toFixed(2)}`).toBeCloseTo(f.z, 5);
      expect(up.y).toBeCloseTo(0, 5);
    }
  });

  it('노면에 눕는다 — 평면의 앞면이 하늘을 본다', () => {
    for (const yaw of yaws) {
      const { rotation } = markerPose(0, 0, yaw);
      const o = new THREE.Object3D();
      o.rotation.set(rotation.x, rotation.y, rotation.z);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
      expect(normal.y, `yaw ${yaw.toFixed(2)}`).toBeCloseTo(1, 5);
    }
  });

  it('표시의 한가운데는 차의 뒤쪽에 있다 — 우회전 뒤에도', () => {
    for (const yaw of yaws) {
      const { position } = markerPose(10, 20, yaw);
      const toMarker = new THREE.Vector3(position.x - 10, 0, position.z - 20);
      expect(toMarker.dot(forward(yaw)), `yaw ${yaw.toFixed(2)}`).toBeLessThan(0);
    }
  });
});
