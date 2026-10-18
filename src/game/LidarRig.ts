/**
 * **지붕 위 LiDAR 센서** — AI 자율주행 중에만 내 차 지붕에 뜬다.
 *
 * 사용자가 정했다 (2026-10-17): *"AI 자율주행 모드일 경우에는 이미지와 같이 차량 위에 라이더 센서가 보이게 해줘"* — 그리고
 * 웨이모 시험차 사진(지붕 위 흰 받침 · 검은 원통 LiDAR · 앞쪽 카메라 함). 화면 오른쪽의 LiDAR 화면이 **이 센서가 본
 * 세계**라는 것이 차 위에서도 보이게 한다.
 *
 * 모양 — 흰 받침(지붕 받이) 위에 앞쪽 카메라 함(검은 유리) · 양옆 작은 센서 · 가운데 받침대와 **도는 검은 원통**. 원통에는
 * 파란 빛 띠와 세로 창 하나가 있어 도는 것이 보인다(1초에 1.2바퀴 — 실제 10바퀴는 눈에 멎어 보인다). 켜는 순간 지붕에서
 * 솟아오르고(0.35초), 끄면 가라앉는다.
 *
 * 자리 — 차 모델마다 지붕 높이가 다르다(모델은 차 **길이**에 맞춰 키우므로 같은 전고라도 지붕이 다르다 — carModel.ts 의
 * eye 주석). 그래서 모델이 오면 지붕을 **직접 잰다** (fitRoof). 모델이 없으면 제원의 전고에 둔다.
 *
 * 재질은 장면의 다른 물건과 같은 MeshStandardMaterial 만 쓴다 — 셰이더가 이미 컴파일되어 있어, 처음 켜는 순간 멈칫하지
 * 않는다 (Game.ts 의 warmUp 주석과 같은 이유).
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { CarSpec } from '../economy/cars';

/** 도는 빠르기 (바퀴/초) · 솟아오르는 시간 (초) */
const SPIN_HZ = 1.2;
const RISE_SECONDS = 0.35;
/** 받침의 앞뒤 길이 (m) — 지붕이 짧은 차는 fitRoof 가 줄인다 */
const RACK_LENGTH = 0.78;
/** 오픈카 덮개 위의 받침 (m) — 양옆 지느러미 사이에 들어가게 좁고 짧다 */
const MOUNT_RACK = { length: 0.45, width: 0.5 } as const;

export class LidarRig {
  /** 내 차 그룹(CarModel.group)에 붙인다 — 차와 함께 움직인다 */
  readonly group = new THREE.Group();
  private readonly lift = new THREE.Group();
  private readonly spinner = new THREE.Group();
  /** 받침 · 앞쪽 카메라 함 · 양옆 센서 — 지붕 길이에 맞춰 받침을 줄일 때 함께 옮긴다 */
  private rack: THREE.Mesh | null = null;
  private frontCam: THREE.Mesh | null = null;
  private pods: THREE.Mesh[] = [];
  /** 받침 폭 (m) — 차 폭의 절반 남짓, 오픈카 덮개 위에서는 좁힌다 */
  private rackWidth = 0.8;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private active = false;
  /** 솟은 정도 0(가라앉음) → 1(다 솟음) */
  private shown = 0;

  constructor(spec: CarSpec) {
    // 모델이 와도 숨기지 않는다 (CarMesh 의 useModel 은 userData.keep 이 아닌 것을 모두 끈다)
    this.group.userData.keep = true;
    this.group.name = 'lidar-rig';
    // 모델이 오기 전 · 모델이 없을 때의 자리 — 제원의 전고, 차 한가운데
    this.group.position.set(0, spec.dims.height, 0.05);
    this.group.add(this.lift);
    this.build(spec.dims.width);
    this.group.visible = false;
    this.lift.scale.y = 0.001;
  }

  /** 가벼운 화면 (Game.ts 의 setLite) — 그림자를 드리우지 않는다. 그림자 패스에서 메시 열 개 남짓을 덜어 낸다 */
  setLite(on: boolean): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = !on;
    });
  }

  /** 켜고 끈다. `instant` 면 솟는 움직임 없이 바로 (처음부터 AI 가 모는 판) */
  setActive(on: boolean, instant = false): void {
    this.active = on;
    if (instant) {
      this.shown = on ? 1 : 0;
      this.apply();
    }
  }

  update(dt: number): void {
    const target = this.active ? 1 : 0;
    if (this.shown !== target) {
      const step = dt / RISE_SECONDS;
      this.shown = target > this.shown ? Math.min(1, this.shown + step) : Math.max(0, this.shown - step);
      this.apply();
    }
    if (this.group.visible) this.spinner.rotation.y -= dt * SPIN_HZ * Math.PI * 2;
  }

  /**
   * **모델의 지붕을 재서 그 위에 앉힌다.**
   *
   * 지붕 높이는 **삼각형 면에서** 읽는다 — 차 그룹 좌표로 옮긴 모델의 면을, 좌우 네 줄(x ±0.2 · ±0.35m — 가운데 안테나 ·
   * 상어 지느러미 줄은 피한다) × 앞뒤 10cm 칸 24개(±1.2m)의 기둥에 내려 꽂아 가장 높은 면의 높이를 잡고, 칸마다 네 줄의
   * 가운뎃값을 지붕 높이로 쓴다(가운데 줄은 오픈카의 덮개를 잴 때만 — 아래). 정점만 세면 가벼운 모델(LOD)의 큰 지붕 면 한가운데에는 정점이 없어 지붕에 구멍이 났고,
   * 가장 높은 정점은 코롤라 유리의 튀어나간 잉여 정점(carModel.ts 의 measureWindshield 주석)에 끌려갈 수 있다.
   *
   * 그다음 가장 높은 칸에서 8cm 안쪽으로 **이어진** 칸들을 지붕 마루로 보고, 받침을 그 앞쪽(앞끝에서 10cm 뒤)에 둔다 —
   * 웨이모처럼 지붕 앞쪽이다. 마루가 짧은 차(SF90 — 지붕 40cm 남짓 뒤가 낮은 엔진 유리)는 받침을 마루 길이에 맞춰 줄이고
   * 가운데 둔다. 높이는 받침이 덮는 칸의 가장 높은 곳에서 2cm 묻는다.
   */
  fitRoof(model: THREE.Object3D, carGroup: THREE.Object3D, width: number, mount?: { z: number }): void {
    carGroup.updateMatrixWorld(true);
    const toCar = new THREE.Matrix4().copy(carGroup.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const Z0 = -1.2;
    const BIN = 0.1;
    const BINS = 24;
    // 좌우 네 줄 + 가운데 줄. 지붕은 가운데 줄을 빼고 읽는다(안테나 자리), 오픈카의 덮개는 가운데 줄까지 (아래 높이)
    const xs = [-0.35, -0.2, 0.2, 0.35, 0].map((x) => x * Math.min(1, width / 1.8));
    const xReach = Math.abs(xs[0]) + 0.01;
    /** 기둥마다 가장 높은 면 — [칸 * 5 + 줄] */
    const height = new Float32Array(BINS * xs.length).fill(-Infinity);

    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const geo = mesh.geometry;
      const pos = geo?.attributes?.position;
      if (!pos) return;
      m.multiplyMatrices(toCar, mesh.matrixWorld);
      // 정점을 한 번만 옮겨 둔다 — 면마다 옮기면 같은 정점을 여러 번 옮긴다
      const p = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        p[i * 3] = v.x;
        p[i * 3 + 1] = v.y;
        p[i * 3 + 2] = v.z;
      }
      const index = geo.index;
      const faces = index ? index.count / 3 : pos.count / 3;
      for (let f = 0; f < faces; f += 1) {
        const a = (index ? index.getX(f * 3) : f * 3) * 3;
        const b = (index ? index.getX(f * 3 + 1) : f * 3 + 1) * 3;
        const c = (index ? index.getX(f * 3 + 2) : f * 3 + 2) * 3;
        const ax = p[a], ay = p[a + 1], az = p[a + 2];
        const bx = p[b], by = p[b + 1], bz = p[b + 2];
        const cx = p[c], cy = p[c + 1], cz = p[c + 2];
        // 지붕 근처가 아닌 면은 바로 버린다 (거의 다)
        if (Math.max(ay, by, cy) < 0.5) continue;
        const minX = Math.min(ax, bx, cx);
        const maxX = Math.max(ax, bx, cx);
        const minZ = Math.min(az, bz, cz);
        const maxZ = Math.max(az, bz, cz);
        if (maxX < -xReach || minX > xReach || maxZ < Z0 || minZ > -Z0) continue;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue; // 위에서 보면 선 — 옆면
        const k0 = Math.max(0, Math.ceil((minZ - Z0) / BIN - 0.5));
        const k1 = Math.min(BINS - 1, Math.floor((maxZ - Z0) / BIN - 0.5));
        for (let j = 0; j < xs.length; j += 1) {
          const px = xs[j];
          if (px < minX || px > maxX) continue;
          for (let k = k0; k <= k1; k += 1) {
            const pz = Z0 + (k + 0.5) * BIN;
            const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
            const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
            const l3 = 1 - l1 - l2;
            if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
            const y = l1 * ay + l2 * by + l3 * cy;
            if (y > height[k * xs.length + j]) height[k * xs.length + j] = y;
          }
        }
      }
    });

    // 칸마다 좌우 네 줄의 가운뎃값 (가운데 줄은 뺀다)
    const top = Array.from({ length: BINS }, (_, k) => {
      const ys = Array.from(height.subarray(k * xs.length, k * xs.length + 4)).sort((a, b) => a - b);
      return (ys[1] + ys[2]) / 2;
    });
    let peakAt = 0;
    top.forEach((y, k) => {
      if (y > top[peakAt]) peakAt = k;
    });
    const peak = top[peakAt];
    if (!Number.isFinite(peak)) return;
    // 가장 높은 칸에서 이어진 마루
    let first = peakAt;
    let last = peakAt;
    while (first > 0 && top[first - 1] >= peak - 0.08) first -= 1;
    while (last < BINS - 1 && top[last + 1] >= peak - 0.08) last += 1;
    const front = Z0 + first * BIN;
    const run = (last - first + 1) * BIN;
    // 오픈카는 적어 둔 자리(운전석 뒤 덮개)에 작은 받침으로 — 재면 앞유리 윗변을 지붕으로 잡는다 (cars.ts 의 lidarMount)
    const rack = mount ? MOUNT_RACK.length : Math.min(RACK_LENGTH, Math.max(0.45, run - 0.1));
    const z = mount ? mount.z : run >= rack + 0.2 ? front + 0.1 + rack / 2 : front + run / 2;
    /*
      높이 — 받침이 덮는 칸들에서. 지붕은 칸의 가운뎃값(잉여 정점에 끌려가지 않게)이다. 오픈카의 덮개는 양옆이 지느러미처럼
      솟아(SF90 · 콜벳 실측: 가운데 덮개 1.02~1.04m, |x| 0.4~0.5m 의 지느러미 1.13~1.17m) 좁힌 받침이 그 사이 덮개에 앉도록
      가운데 · 안쪽 두 줄(x 0 · ±0.2m)의 가장 높은 면을 쓴다.
    */
    let y = -Infinity;
    for (let k = 0; k < BINS; k += 1) {
      const zc = Z0 + (k + 0.5) * BIN;
      if (Math.abs(zc - z) > rack / 2) continue;
      const at = (j: number) => height[k * xs.length + j];
      const here = mount ? Math.max(at(1), at(2), at(4)) : top[k];
      if (here > y) y = here;
    }
    this.group.position.set(0, (Number.isFinite(y) ? y : peak) - 0.02, z);
    this.setRackSize(rack, mount ? MOUNT_RACK.width : this.rackWidth);
  }

  /** 받침 크기를 바꾼다 — 받침만 늘이고 줄이며, 앞쪽 카메라 함 · 양옆 센서는 앞끝 · 양끝에 붙어 따라온다 */
  private setRackSize(length: number, width: number): void {
    if (this.rack) this.rack.scale.set(width / this.rackWidth, 1, length / RACK_LENGTH);
    if (this.frontCam) {
      this.frontCam.scale.x = width / this.rackWidth;
      this.frontCam.position.z = -(length / 2 - 0.04);
    }
    for (const pod of this.pods) {
      pod.position.x = Math.sign(pod.position.x) * (width / 2 - 0.03);
      pod.position.z = -(length / 2 - 0.15);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.removeFromParent();
    this.group.clear();
  }

  // ── 안 ─────────────────────────────────────────────────────────────

  private apply(): void {
    // 솟을 때는 살짝 넘쳤다가 앉는다 (ease-out-back)
    const t = this.shown;
    const c = 1.6;
    const e = t <= 0 ? 0 : 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    this.lift.scale.y = Math.max(0.001, e);
    this.group.visible = t > 0;
  }

  private build(carWidth: number): void {
    const mat = (color: number, roughness: number, metalness = 0, emissive = 0, emissiveIntensity = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
      this.disposables.push(m);
      return m;
    };
    const white = mat(0xf1f3f6, 0.35, 0.1);
    const gray = mat(0x2b3038, 0.5, 0.2);
    const black = mat(0x0d1014, 0.22, 0.5);
    const glass = mat(0x0b0e12, 0.1, 0.6);
    const glow = mat(0x0ea5e9, 0.4, 0, 0x38bdf8, 1.6);

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // 받침 — 지붕 위의 흰 판 (앞이 −z)
    const rackW = Math.min(0.95, Math.max(0.7, carWidth * 0.5));
    this.rackWidth = rackW;
    this.rack = add(this.lift, new RoundedBoxGeometry(rackW, 0.1, RACK_LENGTH, 3, 0.04), white, 0, 0.03, 0);
    // 앞쪽 카메라 함 — 검은 유리
    this.frontCam = add(this.lift, new RoundedBoxGeometry(rackW * 0.62, 0.085, 0.12, 2, 0.02), glass, 0, 0.1, 0);
    // 양옆 작은 센서
    this.pods = [-1, 1].map((side) =>
      add(this.lift, new RoundedBoxGeometry(0.1, 0.08, 0.14, 2, 0.02), glass, side * (rackW / 2 - 0.03), 0.1, 0),
    );
    this.setRackSize(RACK_LENGTH, rackW);
    // 가운데 받침대
    add(this.lift, new THREE.CylinderGeometry(0.12, 0.15, 0.06, 24), gray, 0, 0.11, -0.02);

    // 도는 원통 — 검은 몸통 · 위 뚜껑 · 파란 빛 띠 · 앞을 보는 세로 창 하나
    this.spinner.position.set(0, 0.14, -0.02);
    this.lift.add(this.spinner);
    add(this.spinner, new THREE.CylinderGeometry(0.135, 0.135, 0.17, 32), black, 0, 0.085, 0);
    add(this.spinner, new THREE.CylinderGeometry(0.145, 0.14, 0.03, 32), gray, 0, 0.185, 0);
    add(this.spinner, new THREE.CylinderGeometry(0.138, 0.138, 0.014, 32, 1, true), glow, 0, 0.05, 0).castShadow = false;
    add(this.spinner, new THREE.BoxGeometry(0.035, 0.11, 0.012), glow, 0, 0.1, -0.136).castShadow = false;
  }
}
