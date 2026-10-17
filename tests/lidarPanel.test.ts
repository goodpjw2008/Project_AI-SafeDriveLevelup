/**
 * **LiDAR 화면** (game/LidarPanel.ts) — 가짜 캔버스에 그려 본다.
 *
 * 그림이 맞는지는 눈으로 봐야 하지만, 여기서는 두 가지를 기계로 지킨다: ① 어떤 장면에서도(뒤로 돈 차, 카메라 뒤의 물체,
 * 빈 경로, 바로 앞의 정지) 좌표에 NaN · 무한대가 섞이지 않는다 ② 보호구역 노면 · 자전거횡단도는 그 판에서만 칠한다 —
 * 3D 화면이 붉은데 이 화면만 회색이면 보호구역에 들어선 것이 읽히지 않는다.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { LidarPanel, type LidarFrame, type LidarRoad } from '../src/game/LidarPanel';
import { personShapes, scanLidar } from '../src/game/lidarSensor';
import { Tracker, assessHazard, detect } from '../src/ai/perception';

const ZONE = '#e6c1bd';
const BIKE_LANE = '#d08e87';

let fills: unknown[] = [];
let bad: string[] = [];
/** 칠한 다각형마다 꼭짓점(화면 px) · 둥근 사각형(신호등 몸통)의 폭 · 높이 */
let paths: Array<Array<[number, number]>> = [];
let rects: Array<{ w: number; h: number }> = [];
/** 칠한 다각형과 그때의 색 · 쓴 글 */
let painted: Array<{ style: unknown; path: Array<[number, number]> }> = [];
let texts: string[] = [];
/** 번짐(shadowBlur)을 0 보다 크게 놓은 값들 */
let blurSets: number[] = [];
/** 캔버스 크기 (px) — 380 × 380 CSS 에 화소 비 2 */
const SIZE = 760;

/** 부르는 것을 모두 받아 숫자를 검사하는 가짜 2D 문맥 */
function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {};
  const gradient = { addColorStop: () => undefined };
  let path: Array<[number, number]> = [];
  return new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) bad.push(`${prop}(${args.join(', ')})`);
        if (prop === 'beginPath') path = [];
        if (prop === 'moveTo' || prop === 'lineTo') path.push([args[0] as number, args[1] as number]);
        if (prop === 'fill') {
          paths.push(path);
          painted.push({ style: target.fillStyle, path });
        }
        if (prop === 'fillText') texts.push(String(args[0]));
        if (prop === 'roundRect') rects.push({ w: args[2] as number, h: args[3] as number });
        return gradient;
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      if (prop === 'fillStyle') fills.push(value);
      if (prop === 'shadowBlur' && Number(value) > 0) blurSets.push(Number(value));
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  fills = [];
  bad = [];
  paths = [];
  rects = [];
  painted = [];
  texts = [];
  blurSets = [];
  const ctx = fakeContext();
  const canvas = { clientWidth: 380, clientHeight: 380, width: 0, height: 0, getContext: () => ctx, classList: { toggle: () => undefined }, setAttribute: () => undefined, querySelector: () => null };
  Object.assign(globalThis, {
    document: { getElementById: () => canvas, body: {} },
    getComputedStyle: () => ({ fontFamily: 'sans-serif' }),
    window: { devicePixelRatio: 2 },
  });
});

/** 북쪽으로 가는 길 */
const route = (x: number, z: number, n = 45) => Array.from({ length: n }, (_, i) => ({ x, z: z - i }));

function frame(over: Partial<LidarFrame> & { ego: LidarFrame['ego'] }): LidarFrame {
  const shapes = [
    ...personShapes({ x: 10.6, z: 16.8, facing: 0, scale: 2 }),
    ...personShapes({ x: 6.8, z: 40, facing: 0, scale: 1.32 }), // 내 차 뒤 — 카메라 뒤로 넘어간다
    ...personShapes({ x: -4, z: 18, facing: Math.PI / 2, scale: 2, bike: 'ride' }),
    { kind: 'box' as const, x: 6.8, z: 8, yaw: 0, halfL: 2.4, halfW: 0.78, height: 1.5 },
  ];
  const tracker = new Tracker();
  let scan = scanLidar({ x: over.ego.x, z: over.ego.z }, over.ego.yaw, shapes);
  for (let k = 0; k < 3; k++) {
    scan = scanLidar({ x: over.ego.x, z: over.ego.z }, over.ego.yaw, shapes, { frame: k });
    tracker.update(detect(scan), k / 10);
  }
  const r = over.route ?? route(over.ego.x, over.ego.z);
  return {
    tracks: tracker.confirmed.map((track) => ({ track, hazard: assessHazard(track, r) })),
    scan,
    scanAge: 0.05,
    route: r,
    stopAhead: 1.8,
    signals: [
      { x: 6.5, z: -20, poleX: -11.3, color: 'red', kind: 'vehicle4' },
      { x: 6.8, z: 64.4, poleX: 11.3, color: 'yellow', kind: 'vehicle3' },
      { x: 10.4, z: 12, color: 'green', kind: 'rightArrow' },
    ],
    ...over,
  };
}

const ego = { x: 6.825, z: 30, yaw: 0, length: 4.86, width: 1.53, height: 1.47 };
const road = (over: Partial<LidarRoad> = {}): LidarRoad => ({ zoneOnly: false, approachZone: false, schoolZone: false, ...over });
let now = 0;
const draw = (r: LidarRoad, f: LidarFrame) => new LidarPanel(r).draw(f, (now += 1000));

describe('LiDAR 화면', () => {
  it('어떤 장면에서도 좌표가 유한하다 — 도는 중 · 바로 앞 정지 · 빈 경로 · 카메라 뒤의 물체', () => {
    draw(road(), frame({ ego }));
    draw(road({ schoolZone: true, bikeLane: 'C' }), frame({ ego: { ...ego, x: 9, z: 11, yaw: -0.8 }, stopAhead: 0 }));
    draw(road({ zoneOnly: true, approachZone: true, bikeLane: 'A' }), frame({ ego, route: [], stopAhead: null }));
    draw(road(), frame({ ego: { ...ego, yaw: Math.PI }, route: route(ego.x, ego.z, 1) }));
    expect(bad).toEqual([]);
    expect(fills.length).toBeGreaterThan(50);
  });

  it('보호구역 노면은 보호구역 판에서만 붉다 — 교차로 · 진입로 · 전용 도로', () => {
    draw(road(), frame({ ego }));
    expect(fills).not.toContain(ZONE);
    for (const r of [road({ schoolZone: true }), road({ approachZone: true }), road({ zoneOnly: true, approachZone: true })]) {
      fills = [];
      draw(r, frame({ ego }));
      expect(fills).toContain(ZONE);
    }
  });

  it('뒤차가 화면 안에 그려진다 — 내 차 뒤 7.5m (정지선에 선 내 차 뒤에 붙은 차)', () => {
    const behind = {
      id: 1, x: ego.x, z: ego.z + 7.5, vx: 0, vz: 0, yaw: 0, length: 4.75, width: 1.55, height: 1.0,
      cls: 'car' as const, hits: 5, lastSeen: 0, confirmed: true,
    };
    const base = { ego, scan: null, route: [], stopAhead: null, signals: [] };
    draw(road(), { ...base, tracks: [], scanAge: 0 });
    const egoOnly = paths.length;
    paths = [];
    draw(road(), { ...base, tracks: [{ track: behind, hazard: 'none' }], scanAge: 0 });
    /*
      뒤차가 더한 면들 가운데 화면 안에 들어온 꼭짓점이 있어야 한다 (예전 구도에서는 화면 아래로 빠졌다). 그리는 차례는
      도로 → 먼 것(내 차) → 가까운 것(뒤차) → 글 이라, 뒤차의 면은 내 차 다음 · 마지막 글(점 하나) 앞에 끼어든다.
    */
    const added = paths.slice(egoOnly - 1, paths.length - 1).flat();
    const inside = added.filter(([x, y]) => x >= 0 && x <= SIZE && y >= 0 && y <= SIZE);
    expect(paths.length).toBeGreaterThan(egoOnly);
    expect(inside.length).toBeGreaterThan(10);
  });

  it('차량신호등은 가로, 우회전신호등은 세로로 그린다 (게임의 신호기 모양)', () => {
    const at = { x: ego.x - 0.3, z: ego.z - 30, poleX: -11.3, color: 'red' as const };
    for (const kind of ['vehicle4', 'vehicle3'] as const) {
      rects = [];
      draw(road(), { ...frame({ ego }), signals: [{ ...at, kind }] });
      expect(rects.at(-1)!.w).toBeGreaterThan(rects.at(-1)!.h);
    }
    rects = [];
    draw(road(), { ...frame({ ego }), signals: [{ x: 10.4, z: 12, color: 'green', kind: 'rightArrow' }] });
    expect(rects.at(-1)!.h).toBeGreaterThan(rects.at(-1)!.w);
  });

  /*
    사용자가 짚었다: "자율주행 중인것을 시각적으로 더 구분이 되게 움직이게 해줘". AI 가 모는 동안 갈 길 위로 흰 갈매기표(^,
    꼭짓점 여섯)가 앞으로 흐르고 'LiDAR' 옆에 'AI 자율주행' 표가 붙는다. 사람이 몰 때는 둘 다 없다.
  */
  it('AI 가 모는 동안만 갈 길에 갈매기표가 앞으로 흐르고, 제목 옆에 \'AI 자율주행\' 이 붙는다', () => {
    const f = frame({ ego, stopAhead: null });
    const chevrons = () =>
      painted.filter((p) => String(p.style).startsWith('rgba(255,255,255,') && p.path.length === 6).map((p) => p.path);

    new LidarPanel(road()).draw(f, 10_000);
    expect(chevrons()).toEqual([]);
    expect(texts).not.toContain('AI 자율주행');

    painted = [];
    texts = [];
    const panel = new LidarPanel(road());
    panel.draw({ ...f, autopilot: true }, 10_000);
    const first = chevrons();
    expect(first.length).toBeGreaterThan(3);
    expect(texts).toContain('AI 자율주행');

    // 0.1초 뒤 — 같은 갈매기표들이 앞(화면 위)으로 올라갔다. 꼭짓점 [1] 이 앞 끝이다
    painted = [];
    panel.draw({ ...f, autopilot: true }, 10_100);
    const later = chevrons();
    expect(later.length).toBe(first.length);
    later.forEach((path, i) => expect(path[1][1]).toBeLessThan(first[i][1][1]));
    expect(bad).toEqual([]);
  });

  it('갈매기표는 서기로 한 자리를 넘어 흐르지 않는다', () => {
    const near = frame({ ego, stopAhead: 0.5 });
    new LidarPanel(road()).draw({ ...near, autopilot: true }, 10_000);
    expect(painted.filter((p) => String(p.style).startsWith('rgba(255,255,255,') && p.path.length === 6)).toEqual([]);
  });

  /*
    **가벼운 화면** (setLite — 느린 기기에서 Game.ts 가 켠다). 그리는 간격 66ms(15fps), 화소 배율 1, LiDAR 점 · 번짐 없음.
    물체 · 길은 그대로 그린다.
  */
  it('가벼운 화면 — 15fps · 화소 배율 1 · LiDAR 점과 번짐을 빼고 물체는 그대로', () => {
    const POINT = 'rgba(37,99,235,0.42)';
    const f = frame({ ego });
    new LidarPanel(road()).draw(f, 10_000);
    expect(fills).toContain(POINT);
    const full = painted.length;

    expect(blurSets.length, '보통 화면은 번짐이 있다').toBeGreaterThan(0);

    fills = [];
    painted = [];
    blurSets = [];
    const panel = new LidarPanel(road());
    panel.setLite(true);
    const canvas = document.getElementById('lidar') as unknown as { width: number };
    panel.draw(f, 20_000);
    expect(fills).not.toContain(POINT);
    expect(painted.length, '물체 · 길은 그린다').toBeGreaterThan(full * 0.5);
    expect(canvas.width, '화소 배율 1 — CSS 폭 그대로').toBe(380);
    expect(blurSets, '번짐 없음').toEqual([]);

    // 66ms 안에는 다시 그리지 않고, 지나면 그린다
    painted = [];
    panel.draw(f, 20_050);
    expect(painted.length).toBe(0);
    panel.draw(f, 20_070);
    expect(painted.length).toBeGreaterThan(0);
  });

  it('자전거횡단도 띠는 그 판에서만 그린다', () => {
    draw(road(), frame({ ego }));
    expect(fills).not.toContain(BIKE_LANE);
    fills = [];
    draw(road({ bikeLane: 'A' }), frame({ ego }));
    expect(fills).toContain(BIKE_LANE);
  });
});
