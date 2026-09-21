/**
 * **내 차의 품질은 어느 화질에서도 보장된다** — 사용자가 정했다: "낮음 상태에서도 내 차의 품질은 보장되게 해줘.
 * 전체 프리셋 중에서 모든 상태에서 내 차의 품질은 보장되는 거야."
 *
 * 화면에서 가장 오래 보는 것이 자기 차라, 배경은 설정대로 가라앉아도 내 차는 늘 '높음' 처럼 비쳐야 한다.
 * 여기서 못 박는 것은 **내 차만 밝아지는가**다 — 캐시한 모델을 복제할 때 재질은 참조로 공유되므로, 복제 없이
 * 고치면 같은 차종을 타고 있는 NPC 와 다음 복사본까지 함께 반사한다 (carModel.ts 의 dressCarEnv).
 *
 * 세기가 '높음' 기준이라는 것과, 낮음에서 간이 하늘을 굽는다는 것은 environment.ts 쪽이다 — 굽기는 WebGL 이
 * 필요해 여기서 돌릴 수 없고, 실제 주행에서 재질 값을 읽어 확인했다 (README 의 화질 설정 절).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { dressCarEnv } from '../src/game/carModel';

const ENV = { map: new THREE.Texture(), intensity: 0.21 };

/** 재질 하나를 단 메시 하나짜리 모델 */
function model(material: THREE.Material | THREE.Material[]): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  return g;
}
const first = (g: THREE.Group): THREE.MeshStandardMaterial =>
  (g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;

describe('코앞 차에 환경맵 걸기', () => {
  it('환경맵을 걸고 세기를 곱하되 **재질을 복제해서** 건다 — NPC 가 같이 반사하면 안 된다', () => {
    const shared = new THREE.MeshStandardMaterial({ envMapIntensity: 1 });
    const mine = model(shared);
    dressCarEnv(mine, ENV);
    expect(first(mine).envMap).toBe(ENV.map);
    expect(first(mine).envMapIntensity).toBeCloseTo(0.21);
    // 공유하던 원본은 그대로다 (NPC · 다음 복사본이 쓰는 그것)
    expect(shared.envMap).toBeNull();
    expect(shared.envMapIntensity).toBe(1);
    expect(first(mine)).not.toBe(shared);
  });

  it('모델이 정해 둔 제 몫을 지킨다 — 유리와 도장이 같은 세기로 비치면 안 된다', () => {
    const mats = [
      new THREE.MeshStandardMaterial({ envMapIntensity: 1 }),
      new THREE.MeshStandardMaterial({ envMapIntensity: 0.5 }),
    ];
    const mine = model(mats);
    dressCarEnv(mine, ENV);
    const out = (mine.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[];
    expect(out.map((m) => m.envMapIntensity)).toEqual([0.21, 0.105]);
    expect(mats.map((m) => m.envMapIntensity)).toEqual([1, 0.5]);
  });

  it('환경맵을 받지 못하는 재질은 건너뛴다 — 그대로 둔다', () => {
    const basic = new THREE.MeshBasicMaterial();
    const mine = model(basic);
    dressCarEnv(mine, ENV);
    expect((mine.children[0] as THREE.Mesh).material).toBe(basic);
  });
});
