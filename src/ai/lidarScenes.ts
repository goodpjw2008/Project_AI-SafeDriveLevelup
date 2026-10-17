/**
 * **LiDAR 분류기의 학습 장면** — 정답이 붙은 군집을 만든다 (scripts/train-lidar.ts · tests/lidarClassifier.test.ts).
 *
 * 시뮬레이터는 레이저 한 줄 한 줄이 **어느 물체를 맞혔는지** 안다 (lidarSensor.ts 의 `owners`). 그래서 장면을 무작위로
 * 지어 한 바퀴 쏘고, 인지와 똑같이 군집으로 나눈 뒤, 군집마다 가장 많이 맞은 물체의 갈래를 정답으로 붙인다. 사람이
 * 하나하나 이름표를 달 필요가 없다 — 실제 AI 자율주행 회사들이 시뮬레이션 데이터로 인지를 학습시키는 방식이다.
 *
 * ## 장면은 게임을 닮게 짓는다
 *
 *  - **몸은 게임과 같다** — 사람 · 자전거는 Pedestrian.ts 가 쓰는 personShapes 그대로, 차는 economy/cars.ts 의 치수 범위.
 *    어른(배율 2.0) · 어르신(1.84) · 어린이(1.32), 자전거는 타거나 끌고, 어린이도 탄다.
 *  - **자리와 방향** — 대부분 앞쪽 170° 안, 3~48m. 자전거는 횡단보도를 건너므로 대개 옆모습이고, 차는 대개 차로 방향이다.
 *  - **까다로운 경우를 일부러 넣는다** — 같은 보도에 1.15m 간격으로 선 무리(Pedestrian.ts 의 WAIT_SLOTS), 차 뒤에 가려진
 *    사람 · 자전거, 빗길(열 줄에 한 줄 남짓 손실).
 *
 * 순수 모듈이다 — 같은 씨앗이면 같은 장면이 나온다.
 */

import { LIDAR, personShapes, scanLidar, type LidarShape } from '../game/lidarSensor';
import { clusterFeatures, clusterGeometry, objectClusters, ruleClass, type ObjectClass } from './perception';

/** 정답 갈래 */
export type TrueClass = 'adult' | 'child' | 'bike' | 'car';

/** 정답이 붙은 군집 하나 */
export interface LabeledCluster {
  /** 특징 (perception.ts 의 LIDAR_FEATURES 차례) */
  x: number[];
  label: TrueClass;
  /** 손 규칙(ruleClass)이 가린 갈래 — 비교 기준 */
  rule: ObjectClass;
  /** 센서에서 군집까지 (m) */
  range: number;
  rain: boolean;
  /** 차 뒤에 일부러 숨긴 물체의 군집인가 */
  occluded: boolean;
  /** 군집의 점 가운데 정답 물체의 몫 — 1 보다 작으면 다른 물체와 붙어 한 덩어리로 잡힌 것이다 */
  purity: number;
}

/** 재현되는 난수 (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SceneObject {
  cls: TrueClass;
  shapes: LidarShape[];
  /**
   * 몸마다의 정답 — **실제로 맞은 몸**으로 붙인다. 자전거를 끌고 가는 사람은 사람과 자전거가 0.2m 떨어져 따로 잡히는데,
   * 그 사람 쪽 군집은 사람이다 (끌고 가면 보행자다 — 제2조 제17호). 타고 있으면 사람과 자전거가 한 몸이라 둘 다 자전거다.
   */
  shapeCls: TrueClass[];
  x: number;
  z: number;
  /** 겹침을 피하는 데 쓰는 반지름 */
  radius: number;
  occluded: boolean;
}

/** 사람의 배율 — Pedestrian.ts 의 kind × SIZE_SCALE */
const SCALE = { adult: 2.0, elder: 1.84, child: 1.32 } as const;

/** 장면 하나 — 내 차는 원점에서 북쪽(−z)을 본다 */
export function makeScene(rand: () => number): { objects: SceneObject[]; rain: boolean } {
  const objects: SceneObject[] = [];
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const fits = (o: SceneObject): boolean =>
    Math.hypot(o.x, o.z) > o.radius + 2.5 &&
    objects.every((p) => Math.hypot(p.x - o.x, p.z - o.z) > p.radius + o.radius + 0.15);

  /** 거리 · 방위로 자리 — 방위 0 이 정면, 대부분 앞쪽 */
  const place = (): { x: number; z: number; b: number } => {
    const r = 3 + 45 * Math.pow(rand(), 1.25);
    const b = rand() < 0.8 ? (rand() * 2 - 1) * 1.5 : rand() * Math.PI * 2;
    return { x: -r * Math.sin(b), z: -r * Math.cos(b), b };
  };

  const personCls = (scale: number): TrueClass => (scale < 1.5 ? 'child' : 'adult');
  const person = (x: number, z: number, scale: number): SceneObject => ({
    cls: personCls(scale),
    shapes: personShapes({ x, z, facing: rand() * Math.PI * 2, scale }),
    shapeCls: [personCls(scale)],
    x,
    z,
    radius: 0.22 * scale,
    occluded: false,
  });

  const bike = (x: number, z: number): SceneObject => {
    const scale = rand() < 0.65 ? SCALE.adult : SCALE.child;
    // 시선과 직각(옆모습) · 도로 축 · 아무 방향 — 횡단보도를 건너는 자전거는 대개 옆모습이다
    const los = Math.atan2(x, z);
    const roll = rand();
    const facing =
      roll < 0.55
        ? los + Math.PI / 2 + (rand() - 0.5) * 0.7
        : roll < 0.8
          ? pick([0, Math.PI / 2, Math.PI, -Math.PI / 2])
          : rand() * Math.PI * 2;
    const ride = rand() < 0.6;
    return {
      cls: 'bike',
      shapes: personShapes({ x, z, facing, scale, bike: ride ? 'ride' : 'push' }),
      shapeCls: ride ? ['bike', 'bike'] : [personCls(scale), 'bike'],
      x,
      z,
      radius: 1.35 * scale,
      occluded: false,
    };
  };

  const car = (x: number, z: number, yawHint?: number): SceneObject => {
    const roll = rand();
    const yaw =
      yawHint ??
      (roll < 0.45
        ? pick([0, Math.PI]) + (rand() - 0.5) * 0.1
        : roll < 0.7
          ? pick([Math.PI / 2, -Math.PI / 2]) + (rand() - 0.5) * 0.1
          : rand() * Math.PI * 2);
    const halfL = (4.62 + rand() * 0.24) / 2;
    const halfW = (1.46 + rand() * 0.1) / 2;
    return {
      cls: 'car',
      shapes: [{ kind: 'box', x, z, yaw, halfL, halfW, height: 1.46 + rand() * 0.24 }],
      shapeCls: ['car'],
      x,
      z,
      radius: Math.hypot(halfL, halfW),
      occluded: false,
    };
  };

  const n = 2 + Math.floor(rand() * 6);
  for (let i = 0; i < n * 3 && objects.length < n; i += 1) {
    const { x, z } = place();
    const roll = rand();
    const o =
      roll < 0.22
        ? person(x, z, rand() < 0.25 ? SCALE.elder : SCALE.adult)
        : roll < 0.42
          ? person(x, z, SCALE.child)
          : roll < 0.66
            ? bike(x, z)
            : car(x, z);
    if (fits(o)) objects.push(o);
  }

  // 같은 보도에 나란히 선 무리 — 1.15m 간격 (Pedestrian.ts 의 WAIT_SLOTS)
  if (rand() < 0.3) {
    const { x, z } = place();
    const axis = rand() * Math.PI;
    const k = 2 + Math.floor(rand() * 2);
    const group: SceneObject[] = [];
    for (let j = 0; j < k; j += 1) {
      const off = (j - (k - 1) / 2) * 1.15;
      group.push(person(x + Math.cos(axis) * off, z + Math.sin(axis) * off, rand() < 0.5 ? SCALE.child : SCALE.adult));
    }
    if (group.every((g) => Math.hypot(g.x, g.z) > g.radius + 2.5 && objects.every((p) => Math.hypot(p.x - g.x, p.z - g.z) > p.radius + g.radius + 0.15))) {
      objects.push(...group);
    }
  }

  // 차 뒤에 숨은 사람 · 자전거 — 시선 위, 그 사이에 차를 세운다
  if (rand() < 0.35) {
    const targets = objects.filter((o) => o.cls !== 'car' && Math.hypot(o.x, o.z) > 12);
    if (targets.length) {
      const t = pick(targets);
      const f = 0.45 + rand() * 0.3;
      const side = (rand() - 0.5) * 1.2;
      const r = Math.hypot(t.x, t.z);
      const cx = t.x * f + (t.z / r) * side;
      const cz = t.z * f - (t.x / r) * side;
      const blocker = car(cx, cz, rand() < 0.5 ? undefined : Math.atan2(t.x, t.z) + Math.PI / 2);
      if (fits(blocker)) {
        objects.push(blocker);
        t.occluded = true;
      }
    }
  }

  return { objects, rain: rand() < 0.3 };
}

/** 장면 `count` 개를 지어 쏘고, 군집마다 정답을 붙인다 */
export function labeledClusters(count: number, seed: number): LabeledCluster[] {
  const rand = rng(seed);
  const out: LabeledCluster[] = [];
  for (let s = 0; s < count; s += 1) {
    const { objects, rain } = makeScene(rand);
    const shapes: LidarShape[] = [];
    const ownerOf: number[] = [];
    const clsOf: TrueClass[] = [];
    objects.forEach((o, oi) => {
      o.shapes.forEach((sh, k) => {
        shapes.push(sh);
        ownerOf.push(oi);
        clsOf.push(o.shapeCls[k]);
      });
    });
    // 줄의 시작 각을 조금씩 흔든다 — 물체와 줄 간격이 늘 같은 자리에 맞물리지 않게
    const heading = (rand() * 2 * Math.PI) / LIDAR.rays;
    const scan = scanLidar({ x: 0, z: 0 }, heading, shapes, {
      owners: true,
      dropout: rain ? 0.12 : 0,
      frame: Math.floor(rand() * 1e6),
    });
    const argmax = <K>(m: Map<K, number>): [K, number] => [...m].reduce((a, b) => (b[1] > a[1] ? b : a));
    // 인지와 같은 과정(차 조각 합치기 · 성긴 조각 버리기)을 거친 군집 — 학습한 것과 실제로 가리는 것이 같은 모양이게
    for (const cells of objectClusters(scan)) {
      // 정답은 군집의 점이 가장 많이 맞은 몸의 갈래, 가림 여부는 가장 많이 맞은 물체의 것
      const byCls = new Map<TrueClass, number>();
      const byObj = new Map<number, number>();
      for (const c of cells) {
        const sh = scan.owner![c];
        byCls.set(clsOf[sh], (byCls.get(clsOf[sh]) ?? 0) + 1);
        byObj.set(ownerOf[sh], (byObj.get(ownerOf[sh]) ?? 0) + 1);
      }
      const [label, n] = argmax(byCls);
      const geo = clusterGeometry(scan, cells);
      out.push({
        x: clusterFeatures(scan, geo),
        label,
        rule: ruleClass(geo),
        range: Math.hypot(geo.mx, geo.mz),
        rain,
        occluded: objects[argmax(byObj)[0]].occluded,
        purity: n / cells.length,
      });
    }
  }
  return out;
}
