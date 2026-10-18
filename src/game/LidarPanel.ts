/**
 * **LiDAR 화면** — 센서로 찾은 물체를 테슬라 계기판처럼 그린다. 자리는 계기판(속도계) 위 여백이다.
 *
 * 사용자가 정했다 (2026-10-17): *"이 시뮬레이션으로 잡은 객체들은 테슬라 차의 대시보드에서 객체들이 보이듯이 …
 * 속도기 위 여백부분에 보여주면 좋겠어"* — 그리고 테슬라 화면 사진을 주며 *"약간 이런 느낌으로"*. 그래서 밝은 회색
 * 바탕에 음영 있는 회색 차와 붉은 후미등, 남색 내 차와 파란 빛 테두리, 작은 신호등, 내 차 뒤 위에서 내려다보는 시점이다.
 *
 * ## 그리는 것은 인지가 내놓은 것뿐이다
 *
 * 사람 · 자전거 · 차는 **ai/perception.ts 의 추적 결과(Track)** 로만 그린다 — 게임 속 보행자 · 차의 자리를 읽지 않는다.
 * 그래야 이 화면이 "AI 가 본 세계" 다. 가려서 못 본 사람은 여기에도 없고, 잘못 본 것은 잘못 본 대로 나온다.
 * 지도로 아는 것(도로 · 횡단보도)과 신호 정보, AI 가 갈 길 · 설 자리만 따로 받는다.
 *
 * ## 2D 캔버스에 손으로 원근 투영한다
 *
 * three.js 로 장면을 하나 더 그리면 휴대폰의 렌더 패스가 늘어난다. 물체가 열 개 남짓이라 면 몇십 장을 직접 투영해
 * 칠하는 쪽이 훨씬 가볍다. 볼록한 덩어리(차체 · 지붕)는 카메라를 향한 면만 칠하므로 면끼리 순서를 따질 필요가 없고,
 * 물체끼리는 먼 것부터 칠한다(화가 알고리즘).
 */

import {
  APPROACH_ZONE_FAR_Z,
  APPROACH_ZONE_NEAR_Z,
  BIKE_LANE_WIDTH,
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  INTERSECTION_HALF,
  LANE_WIDTH,
  ROAD_HALF_WIDTH,
  SCHOOL_ZONE_FAR_Z,
  STOP_LINE,
  STOP_LINE_S,
  bikeLaneCenter,
} from '../layout';
import { CLASS_SIZE, type Hazard, type Track } from '../ai/perception';
import type { CrosswalkId } from '../rules/lawRules';
import { cellPoint, type LidarScan } from './lidarSensor';

type V3 = { x: number; y: number; z: number };
type RGB = readonly [number, number, number];

/** 이 판의 도로 모양 — Intersection 을 지을 때와 같은 값 */
export interface LidarRoad {
  /** 사거리 없는 보호구역 도로 (drive: 'zoneOnly') */
  zoneOnly: boolean;
  /** 진입로 보호구역의 횡단보도(S)가 있는가 */
  approachZone: boolean;
  /** 교차로가 어린이보호구역인가 (scenario.isSchoolZone) */
  schoolZone: boolean;
  /** 자전거횡단도가 붙은 횡단보도 — 없으면 undefined */
  bikeLane?: CrosswalkId;
}

/** 화면에 세울 신호등 하나 */
export interface PanelSignal {
  x: number;
  z: number;
  /** 가로 팔에 매단 신호등이면 지주의 x — 없으면 제자리에 선 지주 */
  poleX?: number;
  color: 'red' | 'yellow' | 'green' | 'off';
  /**
   * 생김새 — 게임의 신호기와 같다 (TrafficLight.ts). 교차로 차량신호등은 **가로형 4색등**(적 · 황 · 좌회전 화살표 · 녹),
   * 교차로가 아닌 보호구역 횡단보도는 **가로형 3색등**(적 · 황 · 녹), 우회전신호등만 **세로형**(적 · 황 · 녹색 화살표)이다.
   */
  kind: 'vehicle4' | 'vehicle3' | 'rightArrow';
}

/** 사람 하나에 대한 의도 예측의 짐작 — 그리는 데 필요한 것만 */
export interface PanelIntent {
  /** 지금 건너려 할(양보할) 확률 · 2초 안에 차도에 들어설 확률 */
  yield: number;
  enter: number;
  /** 이미 차도 위에 있는가 */
  onRoadway: boolean;
  /** 건너는 축 위의 자리 · 차도 한가운데 쪽 방향(월드, 단위 벡터) */
  axis: number;
  dirX: number;
  dirZ: number;
}

/** 한 프레임에 그릴 것 */
export interface LidarFrame {
  /** 내 차 — 중심 · 방향 · 크기 */
  ego: { x: number; z: number; yaw: number; length: number; width: number; height: number };
  /**
   * 확정된 물체와 그 위험도 — 사람 · 자전거에는 **보행자 횡단 의도 예측**(ai/intent.ts)의 짐작이 붙는다(도움이 켜져 있을 때).
   * 화면은 그 짐작으로 2초 뒤를 점으로 깔고(PC 는 머리 위에 확률도), 위험 색은 assessHazard 가 그 짐작으로 정한 것이다.
   */
  tracks: ReadonlyArray<{ track: Track; hazard: Hazard; intent?: PanelIntent }>;
  /** 마지막 바퀴 — 점을 옅게 깐다 */
  scan: LidarScan | null;
  /** 마지막 바퀴 뒤로 흐른 시간 (초) — 움직이는 물체를 그만큼 앞으로 그린다 */
  scanAge: number;
  /** AI 가 갈 길 (내 차 자리부터) */
  route: ReadonlyArray<{ x: number; z: number }>;
  /** 서기로 한 자리 (앞범퍼에서 m) — 가는 중이면 null */
  stopAhead: number | null;
  signals: readonly PanelSignal[];
  /**
   * AI 가 모는 중인가 — 그러면 갈 길에 앞으로 흐르는 갈매기표를 띄우고, 내 차의 파란 빛이 숨 쉬며, 제목 옆에
   * 'AI 자율주행' 을 단다 (사용자가 짚었다: "자율주행 중인것을 시각적으로 더 구분이 되게 움직이게 해줘"). 사람이 몰 때의
   * 갈 길은 AI 의 제안일 뿐이라 옅은 띠로만 둔다.
   */
  autopilot?: boolean;
}

/**
 * 카메라 — 내 차 뒤 14m · 위 9.5m 에서 29° 내려다본다. 내 차가 화면 한가운데(50%)에 오고, **뒤로 9.5m 까지** 담겨
 * 뒤차가 보인다 (사용자가 짚었다: "후방차는 감지를 못하는데 의도된거니" — 감지는 했는데 예전 구도가 내 차 뒤 1.5m 까지만
 * 담아 그려지지 않았다). 옆으로는 내 차 자리에서 양쪽 10m, 지평선은 위 끝에 걸린다.
 *
 * `focal` · `cy` 는 캔버스 **높이**에 대한 비율이다 — 화면이 정사각형보다 좁으면 **양옆이 잘린다**(같은 높이에 같은 그림,
 * 옆만 덜 보인다). PC 는 화면 오른쪽 위에 세로로 긴 3:4 로 둔다 (사용자가 정했다: *"라이다 대시보드가 오른쪽 시야를 가려.
 * 우측 상단으로 올리고 크기에 맞게 대시보드의 사이드를 줄여서"*) — 그때 옆으로는 내 차 자리에서 양쪽 7.5m 다. 휴대폰은
 * 정사각형 그대로다.
 */
const CAM = { back: 14, height: 9.5, pitch: 0.5, focal: 0.8, cy: 0.42, near: 1.0 } as const;

/** 이만큼보다 먼 노면 표시는 그리지 않는다 (m) — 지평선 근처에서 한 점으로 뭉칠 뿐이다 */
const DRAW_REACH = 90;

/** 한 번 그린 뒤 이만큼은 다시 그리지 않는다 (ms) — 30fps 면 충분하고, 휴대폰의 프레임 시간을 아낀다 */
const DRAW_INTERVAL = 30;
/**
 * **가벼운 화면**의 간격 (ms) — 15fps (setLite). 느린 PC 에서 이 화면이 3D 장면의 프레임을 깎지 않게 한다 (quality.ts 의
 * LoadWatch). 물체는 바퀴 사이에 속도로 밀어 그리므로(scanAge) 15fps 에서도 미끄러지듯 움직인다.
 */
const LITE_DRAW_INTERVAL = 66;

/**
 * AI 가 모는 동안 갈 길 위를 흐르는 갈매기표 — 빠르기(m/s) · 간격 · 앞뒤 길이 · 굵기(m). 차가 서 있어도 흐른다: 차가 움직이는지가
 * 아니라 **AI 가 운전대를 잡고 있다**는 표시다. 숨 쉬는 빛(내 차 · 제목 옆 표)은 한 번에 `breath` ms.
 */
const FLOW = { speed: 8, gap: 3.4, len: 0.85, thick: 0.38, breath: 1600 } as const;

/** 색 — 사진의 밝은 테슬라 화면 */
const COLOR = {
  skyTop: '#f7f8fa',
  skyLow: '#eceef1',
  ground: '#e4e7eb',
  road: '#d3d7dc',
  /** 어린이보호구역 노면 — 밝은 화면에 맞춘 옅은 빨강 */
  zone: '#e6c1bd',
  /** 자전거횡단도 띠 */
  bikeLane: '#d08e87',
  line: 'rgba(255,255,255,0.95)',
  center: '#e9c45c',
  route: 'rgba(59,130,246,0.30)',
  routeEdge: 'rgba(59,130,246,0.65)',
  /** AI 가 모는 동안의 갈 길 — 더 짙게 */
  routeAuto: 'rgba(37,99,235,0.42)',
  /** 갈매기표 — 흰색, 끝으로 갈수록 옅어진다 (rgb 만 두고 알파는 그때그때) */
  chevron: '255,255,255',
  /** 제목 옆 'AI 자율주행' 표 */
  badge: '37,99,235',
  stop: '#ef4444',
  shadow: 'rgba(15,23,42,0.14)',
  shadowSoft: 'rgba(15,23,42,0.07)',
  tire: '#2a2e35',
  headlight: '#f4f7fb',
  point: 'rgba(37,99,235,0.42)',
  text: '#374151',
  textSub: '#6b7280',
  tail: '#e5484d',
  glow: '#3b82f6',
  bikeFrame: [96, 102, 110] as RGB,
} as const;

/** 지붕 LiDAR 센서의 칠 — 몸통 · 뚜껑 · 빛 띠 */
const SENSOR = { body: [22, 26, 32] as RGB, top: [52, 58, 66] as RGB, band: [56, 189, 248] as RGB } as const;

/** 사람의 칠 — 위험도마다 몸 · 팔다리 · 머리 */
const TONE = {
  none: { body: '#8a9099', limb: '#6c727b', head: '#a4aab1' },
  caution: { body: '#f59e0b', limb: '#d97706', head: '#fbbf24' },
  danger: { body: '#ef4444', limb: '#dc2626', head: '#f87171' },
} as const;

/*
  화면 이름 — **'LiDAR(광선 추적 시뮬레이션 기법)'** 과 그 설명(지도학습 · 신경망 · ※ 두 줄)은 그림 밖의 HTML 설명 칸
  (index.html 의 #lidar-cap)이 적는다 (사용자가 정했다, 2026-10-18 — 예전 이름 'LiDAR(가상)'). 그림 안에 그리면 줄을 바꾸지
  못하고, 휴대폰 화면(폭 150px 남짓)에서는 앞길 — 사람이 나타나는 자리 — 을 덮는다. 그림 안에는 스캔 점 · 찾은 물체 수 ·
  AI 자율주행 표만 남는다 (drawCaption).
*/

/** 이보다 가까운 신호등은 그리지 않는다 (카메라 깊이, m) */
const SIGNAL_MIN_DEPTH = 12;

/** 차의 칠 — 차체 · 문턱(아래) · 유리 · 지붕 */
interface CarPaint {
  body: RGB;
  lower: RGB;
  glass: RGB;
  roof: RGB;
}
/** 다른 차 — 밝은 회색, 유리는 진회색 (사진의 테슬라 화면). 유리를 검게 두면 차보다 유리 덩어리가 먼저 보인다 */
const NPC_PAINT: CarPaint = {
  body: [200, 204, 210],
  lower: [158, 163, 170],
  glass: [96, 102, 112],
  roof: [128, 134, 143],
};
/** 내 차 — 남색에 파란 빛 테두리 */
const EGO_PAINT: CarPaint = {
  body: [40, 64, 116],
  lower: [26, 42, 78],
  glass: [22, 32, 56],
  roof: [46, 68, 116],
};

/**
 * 차를 쌓는 고리 하나 — 차 기준(앞 +, 오른쪽 +, 위 +, m)의 모서리를 깎은 직사각형. 앞쪽 꼭짓점과 뒤쪽 꼭짓점의 높이를
 * 따로 두어 보닛은 낮고 트렁크는 높게 기울인다.
 */
interface CarRing {
  front: number;
  rear: number;
  half: number;
  cut: number;
  yFront: number;
  yRear: number;
}
/**
 * 고리의 여덟 꼭짓점 — 앞오른쪽 모서리부터 오른쪽 · 뒤 · 왼쪽 · 앞 차례. 옆면 i 는 꼭짓점 i → i+1 이라
 * 0 앞오른쪽 모서리 · 1 오른쪽 · 2 뒤오른쪽 모서리 · 3 뒤 · 4 뒤왼쪽 모서리 · 5 왼쪽 · 6 앞왼쪽 모서리 · 7 앞.
 */
function ringPoints(r: CarRing): Array<[number, number, number]> {
  const { front: f, rear: b, half: h, cut } = r;
  const c = Math.min(cut, h * 0.9, (f - b) * 0.45);
  return [
    [f, h - c, r.yFront],
    [f - c, h, r.yFront],
    [b + c, h, r.yRear],
    [b, h - c, r.yRear],
    [b, -h + c, r.yRear],
    [b + c, -h, r.yRear],
    [f - c, -h, r.yFront],
    [f, -h + c, r.yFront],
  ];
}
/** 뒤를 감싸는 면들(뒤 모서리 둘 + 뒤) · 앞 모서리 둘 */
const RING_REAR = [2, 3, 4] as const;
const RING_FRONT_CORNERS = [0, 6] as const;

const rgb = (c: RGB, k = 1): string =>
  `rgb(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))})`;

/** 가까운 면(카메라 앞 `near`)으로 다각형을 자른다 — 뒤로 넘어간 꼭짓점이 화면 반대편으로 튀지 않게 */
function clipNear(pts: readonly V3[]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ina = a.z >= CAM.near;
    const inb = b.z >= CAM.near;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (CAM.near - a.z) / (b.z - a.z);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: CAM.near });
    }
  }
  return out;
}

export class LidarPanel {
  private readonly canvas: HTMLCanvasElement | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private lastDraw = -Infinity;
  /** 이번 프레임의 시각 (ms) — 흐르는 갈매기표 · 숨 쉬는 빛이 읽는다 */
  private now = 0;
  /** 움직임을 줄이라는 설정이면 갈매기표 · 빛은 그대로 두고 멈춰 둔다 (index.html 의 같은 규칙과 맞춘다) */
  private readonly still: boolean;
  private readonly font: string;

  // 이번 프레임의 카메라 — 내 차 자리 · 앞 · 오른쪽
  private ex = 0;
  private ez = 0;
  private fx = 0;
  private fz = -1;
  private rx = 1;
  private rz = 0;
  private readonly cosP = Math.cos(CAM.pitch);
  private readonly sinP = Math.sin(CAM.pitch);
  private camPos: V3 = { x: 0, y: 0, z: 0 };
  /** 빛 — 내 차 뒤 왼쪽 위에서 (월드, 단위벡터) */
  private light: V3 = { x: 0, y: 1, z: 0 };

  /** 가벼운 화면 — 15fps · 화소 배율 1 · 내 차의 빛 번짐 없음 · LiDAR 점 생략 (setLite) */
  private lite = false;

  /** 화면을 담은 상자 (index.html 의 #lidar-box) */
  private readonly box: HTMLElement | null;

  /** 이번 프레임에 단 확률 딱지의 자리 — 붙어 선 사람끼리 딱지가 겹치지 않게 (drawIntentLabel) */
  private labels: Array<[number, number, number, number]> = [];

  constructor(private readonly road: LidarRoad) {
    this.canvas = document.getElementById('lidar') as HTMLCanvasElement | null;
    this.ctx = this.canvas?.getContext('2d') ?? null;
    this.box = document.getElementById('lidar-box');
    this.font = (typeof getComputedStyle === 'function' && getComputedStyle(document.body).fontFamily) || 'sans-serif';
    this.still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** 주행 중에만 상자를 띄운다 (결과 화면 · 첫 화면에서는 숨는다) */
  setVisible(on: boolean): void {
    this.box?.classList.toggle('on', on);
  }

  /**
   * **가벼운 화면으로 바꾼다** (Game.ts — 느린 기기에서 fps 가 떨어지면). 그리는 횟수를 반으로(15fps), 화소를 4분의 1로(화소
   * 배율 1), 가장 비싼 칠 — 내 차 둘레 · 켜진 신호등 렌즈의 번짐(shadowBlur)과 바닥에 찍는 LiDAR 점(한 번에 수백 개) — 을 뺀다. 물체 · 길 ·
   * 신호 · 정지선은 그대로다.
   */
  setLite(on: boolean): void {
    this.lite = on;
  }

  dispose(): void {
    this.setVisible(false);
    this.ctx?.clearRect(0, 0, this.w, this.h);
  }

  /** 한 프레임 — 너무 잦으면 건너뛴다 */
  draw(frame: LidarFrame, now = performance.now()): void {
    const { canvas, ctx } = this;
    if (!canvas || !ctx) return;
    if (now - this.lastDraw < (this.lite ? LITE_DRAW_INTERVAL : DRAW_INTERVAL)) return;
    if (!this.fit(canvas)) return;
    this.lastDraw = now;
    this.now = now;
    this.labels = [];

    this.aim(frame.ego);
    this.drawBackground(ctx);
    this.drawRoad(ctx);
    this.drawRoute(ctx, frame);

    // 땅에 깔리는 것 — LiDAR 가 맞힌 점(바닥에 눌러 찍는다) · 위험 고리 · 앞차 표시
    if (frame.scan && !this.lite) this.drawPoints(ctx, frame.scan);
    for (const { track, hazard } of frame.tracks) this.drawGroundMark(ctx, track, hazard, frame.scanAge);
    // AI 가 짐작한 2초 뒤 — 땅에 깐 점 (보행자 횡단 의도 예측)
    for (const { track, hazard, intent } of frame.tracks) {
      if (intent) this.drawForecast(ctx, track, hazard, intent, frame.scanAge);
    }

    // 서 있는 것 — 먼 것부터
    const items: Array<{ depth: number; paint: () => void }> = [];
    for (const { track, hazard, intent } of frame.tracks) {
      const x = track.x + track.vx * frame.scanAge;
      const z = track.z + track.vz * frame.scanAge;
      items.push({
        depth: this.cam({ x, y: 0, z }).z,
        paint: () => {
          this.drawObject(ctx, track, hazard, x, z);
          if (intent) this.drawIntentLabel(ctx, track, hazard, intent, x, z);
        },
      });
    }
    for (const sig of frame.signals) {
      items.push({ depth: this.cam({ x: sig.x, y: 0, z: sig.z }).z, paint: () => this.drawSignal(ctx, sig) });
    }
    const { ego } = frame;
    // 내 차의 파란 빛 — AI 가 모는 동안은 숨 쉬듯 커졌다 작아진다
    // 가벼운 화면에서는 번짐(shadowBlur — 2D 캔버스에서 가장 비싼 칠)을 뺀다
    const glow = this.lite ? 0 : frame.autopilot ? 12 + 12 * this.breath() : 12;
    items.push({
      depth: this.cam({ x: ego.x, y: 0, z: ego.z }).z,
      // AI 가 모는 동안은 지붕에 LiDAR 센서를 얹는다 — 3D 화면의 내 차와 같다 (LidarRig.ts)
      paint: () =>
        this.drawCar(ctx, ego.x, ego.z, ego.yaw, ego.length, ego.width, ego.height, EGO_PAINT, glow, frame.autopilot === true),
    });
    items.sort((a, b) => b.depth - a.depth);
    for (const it of items) it.paint();

    this.drawCaption(ctx, frame);
  }

  /** 숨 쉬는 빛의 세기 0 → 1 → 0 (FLOW.breath 한 번에) */
  private breath(): number {
    if (this.still) return 1;
    return 0.5 - 0.5 * Math.cos((this.now / FLOW.breath) * Math.PI * 2);
  }

  // ── 준비 ───────────────────────────────────────────────────────────────

  /** 캔버스 크기를 화면 크기에 맞춘다 — 보이지 않으면 false */
  private fit(canvas: HTMLCanvasElement): boolean {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw === 0 || ch === 0) return false;
    const dpr = this.lite ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cw * dpr);
    const h = Math.round(ch * dpr);
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
    }
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    return true;
  }

  private aim(ego: LidarFrame['ego']): void {
    this.ex = ego.x;
    this.ez = ego.z;
    this.fx = -Math.sin(ego.yaw);
    this.fz = -Math.cos(ego.yaw);
    this.rx = -this.fz;
    this.rz = this.fx;
    this.camPos = { x: ego.x - this.fx * CAM.back, y: CAM.height, z: ego.z - this.fz * CAM.back };
    const lx = -this.fx * 0.35 - this.rx * 0.45;
    const lz = -this.fz * 0.35 - this.rz * 0.45;
    const n = Math.hypot(lx, 0.82, lz);
    this.light = { x: lx / n, y: 0.82 / n, z: lz / n };
  }

  /** 월드 → 카메라 (x 오른쪽 · y 위 · z 깊이) */
  private cam(p: V3): V3 {
    const dx = p.x - this.ex;
    const dz = p.z - this.ez;
    const fwd = dx * this.fx + dz * this.fz;
    const right = dx * this.rx + dz * this.rz;
    const dzc = fwd + CAM.back;
    const dyc = p.y - CAM.height;
    return { x: right, y: dzc * this.sinP + dyc * this.cosP, z: dzc * this.cosP - dyc * this.sinP };
  }

  /** 카메라 → 화면 (px) */
  private screen(c: V3): [number, number] {
    const f = this.h * CAM.focal;
    return [this.w / 2 + (f * c.x) / c.z, this.h * CAM.cy - (f * c.y) / c.z];
  }

  /** 그 깊이에서 1m 가 몇 px 인가 */
  private pxPerM(depth: number): number {
    return (this.h * CAM.focal) / depth;
  }

  /** 다각형 하나를 칠한다. `seal` 이면 같은 색으로 테두리를 한 번 더 그어 이웃 면과의 틈(안티에일리어싱 실금)을 메운다 */
  private poly(ctx: CanvasRenderingContext2D, pts: readonly V3[], fill: string, seal = false): void {
    const cs = clipNear(pts.map((p) => this.cam(p)));
    if (cs.length < 3) return;
    ctx.beginPath();
    cs.forEach((c, i) => {
      const [sx, sy] = this.screen(c);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (seal) {
      ctx.strokeStyle = fill;
      ctx.lineWidth = 0.8 * this.dpr;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  /** 노면 위 축 정렬 사각형 */
  private groundRect(ctx: CanvasRenderingContext2D, x0: number, z0: number, x1: number, z1: number, fill: string): void {
    this.poly(
      ctx,
      [
        { x: x0, y: 0, z: z0 },
        { x: x1, y: 0, z: z0 },
        { x: x1, y: 0, z: z1 },
        { x: x0, y: 0, z: z1 },
      ],
      fill,
    );
  }

  /** 내 차에서 너무 먼 노면 표시인가 */
  private far(x: number, z: number): boolean {
    return Math.hypot(x - this.ex, z - this.ez) > DRAW_REACH;
  }

  // ── 바탕 · 도로 ────────────────────────────────────────────────────────

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const horizon = this.h * CAM.cy - this.h * CAM.focal * Math.tan(CAM.pitch);
    ctx.fillStyle = COLOR.ground;
    ctx.fillRect(0, 0, this.w, this.h);
    if (horizon > 0) {
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, COLOR.skyTop);
      sky.addColorStop(1, COLOR.skyLow);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, this.w, horizon);
    }
  }

  private drawRoad(ctx: CanvasRenderingContext2D): void {
    const { zoneOnly, approachZone } = this.road;
    const L = 400;
    const half = ROAD_HALF_WIDTH;

    // 노면 — 남북 도로, 사거리면 동서 도로
    this.groundRect(ctx, -half, -L, half, L, COLOR.road);
    if (!zoneOnly) this.groundRect(ctx, -L, -half, L, half, COLOR.road);
    this.drawSchoolZone(ctx);

    const inJunction = (t: number): boolean => !zoneOnly && Math.abs(t) < INTERSECTION_HALF;

    // 남북 도로의 선 — 중앙선(노랑 두 줄) · 차로 경계(흰 점선) · 가장자리(흰 실선)
    const z0 = Math.floor((this.ez - DRAW_REACH) / 8) * 8;
    for (let z = z0; z < this.ez + DRAW_REACH; z += 8) {
      if (inJunction(z) || inJunction(z + 8)) continue;
      for (const s of [-1, 1]) {
        this.groundRect(ctx, s * 0.12, z, s * 0.3, z + 8, COLOR.center);
        this.groundRect(ctx, s * LANE_WIDTH - 0.08, z, s * LANE_WIDTH + 0.08, z + 3, COLOR.line);
        this.groundRect(ctx, s * (half - 0.35), z, s * (half - 0.2), z + 8, COLOR.line);
      }
    }
    // 동서 도로의 선
    if (!zoneOnly) {
      const x0 = Math.floor((this.ex - DRAW_REACH) / 8) * 8;
      for (let x = x0; x < this.ex + DRAW_REACH; x += 8) {
        if (inJunction(x) || inJunction(x + 8)) continue;
        for (const s of [-1, 1]) {
          this.groundRect(ctx, x, s * 0.12, x + 8, s * 0.3, COLOR.center);
          this.groundRect(ctx, x, s * LANE_WIDTH - 0.08, x + 3, s * LANE_WIDTH + 0.08, COLOR.line);
          this.groundRect(ctx, x, s * (half - 0.35), x + 8, s * (half - 0.2), COLOR.line);
        }
      }
    }

    // 횡단보도 — 남북 도로를 가로지르는 것(줄무늬가 z 로 길다)
    const acrossNS = [CROSSWALK_INNER, zoneOnly ? CROSSWALK_B_OUTER : -CROSSWALK_OUTER];
    if (approachZone) acrossNS.push(CROSSWALK_S_INNER);
    for (const zc of acrossNS) {
      if (this.far(this.ex, zc)) continue;
      for (let x = -half + 0.3; x < half - 0.3; x += 0.9) {
        this.groundRect(ctx, x, zc, x + 0.45, zc + (CROSSWALK_OUTER - CROSSWALK_INNER), COLOR.line);
      }
    }
    // 동서 도로를 가로지르는 것(줄무늬가 x 로 길다)
    if (!zoneOnly) {
      for (const xc of [CROSSWALK_INNER, -CROSSWALK_OUTER]) {
        if (this.far(xc, this.ez)) continue;
        for (let z = -half + 0.3; z < half - 0.3; z += 0.9) {
          this.groundRect(ctx, xc, z, xc + (CROSSWALK_OUTER - CROSSWALK_INNER), z + 0.45, COLOR.line);
        }
      }
    }

    // 자전거횡단도 — 횡단보도 바깥 가장자리의 붉은 띠 (Intersection.ts 의 drawBikeLane)
    const lane = this.road.bikeLane;
    if (lane) {
      const c = bikeLaneCenter(lane);
      const h = BIKE_LANE_WIDTH / 2;
      if (lane === 'C') this.groundRect(ctx, c - h, -half + 0.3, c + h, half - 0.3, COLOR.bikeLane);
      else this.groundRect(ctx, -half + 0.3, c - h, half - 0.3, c + h, COLOR.bikeLane);
    }

    // 정지선 — 내 차로 쪽만 (Intersection.ts 의 drawStopLines)
    const stopLines = [STOP_LINE];
    if (zoneOnly) stopLines.push(CROSSWALK_B_INNER + 2);
    if (approachZone) stopLines.push(STOP_LINE_S);
    for (const z of stopLines) this.groundRect(ctx, 0.15, z, half - 0.25, z + 0.6, COLOR.line);
  }

  /**
   * **어린이보호구역의 붉은 노면** — 게임 노면과 같은 범위다 (Intersection.ts 의 drawSchoolZonePavement). 보호구역에
   * 들어섰는지가 이 앱에서 가장 먼저 읽혀야 하는 것이라, 3D 화면이 붉은데 이 화면만 회색이면 안 된다.
   * 불투명한 색으로 칠한다 — 반투명으로 겹쳐 칠하면 교차로 안처럼 두 띠가 겹친 자리만 진해진다.
   */
  private drawSchoolZone(ctx: CanvasRenderingContext2D): void {
    const { zoneOnly, approachZone, schoolZone } = this.road;
    const x = ROAD_HALF_WIDTH - 0.5;
    const far = Math.max(schoolZone ? SCHOOL_ZONE_FAR_Z : -Infinity, approachZone ? APPROACH_ZONE_FAR_Z : -Infinity);
    // 전용 도로는 길 끝까지 보호구역이다
    const near = zoneOnly
      ? -400
      : Math.min(schoolZone ? STOP_LINE : Infinity, approachZone ? APPROACH_ZONE_NEAR_Z : Infinity);
    if (Number.isFinite(far) && Number.isFinite(near)) this.groundRect(ctx, -x, near, x, far, COLOR.zone);
    // 교차로가 보호구역이면 교차로 안과 네 진출입로를 십자로
    if (schoolZone && !zoneOnly) {
      this.groundRect(ctx, -x, -SCHOOL_ZONE_FAR_Z, x, SCHOOL_ZONE_FAR_Z, COLOR.zone);
      this.groundRect(ctx, -SCHOOL_ZONE_FAR_Z, -x, SCHOOL_ZONE_FAR_Z, x, COLOR.zone);
    }
  }

  /** AI 가 갈 길 — 파란 띠. 서기로 했으면 그 자리에서 끊고 붉은 정지선을 긋는다 */
  private drawRoute(ctx: CanvasRenderingContext2D, frame: LidarFrame): void {
    const route = frame.route;
    if (route.length < 2) return;
    const halfW = frame.ego.width / 2;
    const cut = frame.stopAhead === null ? Infinity : frame.ego.length / 2 + frame.stopAhead;

    const left: V3[] = [];
    const right: V3[] = [];
    let walked = 0;
    let end: { x: number; z: number; nx: number; nz: number } | null = null;
    for (let i = 0; i < route.length; i += 1) {
      const a = route[Math.max(0, i - 1)];
      const b = route[Math.min(route.length - 1, i + 1)];
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      // 진행 방향의 왼쪽 법선
      const nx = tz / tl;
      const nz = -tx / tl;
      let p = route[i];
      if (i > 0) {
        const seg = Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
        if (walked + seg >= cut) {
          const t = (cut - walked) / (seg || 1);
          p = { x: route[i - 1].x + (route[i].x - route[i - 1].x) * t, z: route[i - 1].z + (route[i].z - route[i - 1].z) * t };
          end = { x: p.x, z: p.z, nx, nz };
        }
        walked += seg;
      }
      left.push({ x: p.x + nx * halfW, y: 0.02, z: p.z + nz * halfW });
      right.push({ x: p.x - nx * halfW, y: 0.02, z: p.z - nz * halfW });
      if (end) break;
    }
    this.poly(ctx, [...left, ...right.reverse()], frame.autopilot ? COLOR.routeAuto : COLOR.route);
    if (frame.autopilot) this.drawFlow(ctx, route, Math.min(cut, walked), halfW);

    if (end) {
      // 차 폭보다 넉넉히 — 내 차가 가운데를 덮어도 양 끝이 보이게
      const w = halfW + 0.9;
      const tx = -end.nz;
      const tz = end.nx;
      this.poly(
        ctx,
        [
          { x: end.x + end.nx * w, y: 0.03, z: end.z + end.nz * w },
          { x: end.x - end.nx * w, y: 0.03, z: end.z - end.nz * w },
          { x: end.x - end.nx * w + tx * 0.45, y: 0.03, z: end.z - end.nz * w + tz * 0.45 },
          { x: end.x + end.nx * w + tx * 0.45, y: 0.03, z: end.z + end.nz * w + tz * 0.45 },
        ],
        COLOR.stop,
      );
    }
  }

  /**
   * 갈 길 위를 앞으로 흐르는 갈매기표(^) — AI 가 모는 동안만. 길을 따라 `FLOW.gap` 마다 하나씩, 시각에 따라 앞으로 밀려
   * 간다. 서기로 한 자리(`limit`, 내 차 자리에서 m) 앞에서 옅어지며 사라진다 — 붉은 정지선을 넘어 흐르지 않는다.
   */
  private drawFlow(ctx: CanvasRenderingContext2D, route: LidarFrame['route'], limit: number, halfW: number): void {
    const reach = Math.min(limit, 40);
    if (!(reach > FLOW.len)) return;
    // 길의 누적 길이 — 한 자리(s m)의 점과 진행 방향을 찾는 데 쓴다
    const cum = [0];
    for (let i = 1; i < route.length; i += 1) {
      cum.push(cum[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z));
    }
    const at = (s: number): { x: number; z: number; tx: number; tz: number } => {
      let i = 1;
      while (i < route.length - 1 && cum[i] < s) i += 1;
      const a = route[i - 1];
      const b = route[i];
      const seg = cum[i] - cum[i - 1] || 1;
      const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx, tz };
    };
    const arm = halfW * 0.62;
    const shift = this.still ? FLOW.gap / 2 : ((this.now / 1000) * FLOW.speed) % FLOW.gap;
    for (let s = shift; s + FLOW.len + FLOW.thick < reach; s += FLOW.gap) {
      const base = at(s);
      const tip = at(s + FLOW.len);
      // 진행 방향의 왼쪽 법선 (drawRoute 와 같은 셈)
      const nx = base.tz;
      const nz = -base.tx;
      const fx = tip.tx * FLOW.thick;
      const fz = tip.tz * FLOW.thick;
      // 끝에 가까울수록 옅게 — 정지선 · 먼 끝에서 뚝 끊기지 않게
      const alpha = 0.9 * Math.min(1, (reach - s - FLOW.len) / 4);
      const L = { x: base.x + nx * arm, y: 0.03, z: base.z + nz * arm };
      const R = { x: base.x - nx * arm, y: 0.03, z: base.z - nz * arm };
      const A = { x: tip.x, y: 0.03, z: tip.z };
      this.poly(
        ctx,
        [L, A, R, { x: R.x + fx, y: 0.03, z: R.z + fz }, { x: A.x + fx, y: 0.03, z: A.z + fz }, { x: L.x + fx, y: 0.03, z: L.z + fz }],
        `rgba(${COLOR.chevron},${alpha.toFixed(3)})`,
      );
    }
  }

  // ── 물체 ───────────────────────────────────────────────────────────────

  /** 사람 발밑의 고리 · 앞차 밑의 파란 판 */
  private drawGroundMark(ctx: CanvasRenderingContext2D, tr: Track, hazard: Hazard, age: number): void {
    const x = tr.x + tr.vx * age;
    const z = tr.z + tr.vz * age;
    if (hazard === 'lead') {
      const f = { x: -Math.sin(tr.yaw), z: -Math.cos(tr.yaw) };
      const r = { x: -f.z, z: f.x };
      const hl = tr.length / 2 + 0.5;
      const hw = tr.width / 2 + 0.4;
      this.poly(
        ctx,
        [
          { x: x + f.x * hl + r.x * hw, y: 0.02, z: z + f.z * hl + r.z * hw },
          { x: x + f.x * hl - r.x * hw, y: 0.02, z: z + f.z * hl - r.z * hw },
          { x: x - f.x * hl - r.x * hw, y: 0.02, z: z - f.z * hl - r.z * hw },
          { x: x - f.x * hl + r.x * hw, y: 0.02, z: z - f.z * hl + r.z * hw },
        ],
        'rgba(59,130,246,0.22)',
      );
      return;
    }
    if (hazard !== 'caution' && hazard !== 'danger') return;
    const radius = hazard === 'danger' ? 1.3 : 1.0;
    const pts: V3[] = [];
    for (let i = 0; i < 20; i += 1) {
      const a = (i / 20) * Math.PI * 2;
      pts.push({ x: x + Math.cos(a) * radius, y: 0.03, z: z + Math.sin(a) * radius });
    }
    this.poly(ctx, pts, hazard === 'danger' ? 'rgba(239,68,68,0.28)' : 'rgba(245,158,11,0.26)');
  }

  /**
   * **AI 가 짐작한 2초 뒤** — 의도 예측이 "곧 차도에 들어선다" 고 본 사람 앞에, 건너는 쪽으로 0.4초 간격의 점 다섯을 깐다.
   * 점의 짙기가 그 확률이다(25% 밑이면 그리지 않는다). 이미 건너는 사람은 지금 걸음 그대로 앞으로 — 반대편 연석까지만.
   * 예전의 위협 예측(2초 등속)은 서 있는 사람을 늘 '안 움직인다' 로 봤다 — 발을 떼기 전에 미리 보여 주는 것이 이 점이다.
   */
  private drawForecast(ctx: CanvasRenderingContext2D, tr: Track, hazard: Hazard, it: PanelIntent, age: number): void {
    if (it.enter < 0.25) return;
    const x0 = tr.x + tr.vx * age;
    const z0 = tr.z + tr.vz * age;
    const moving = Math.hypot(tr.vx, tr.vz) > 0.8;
    // 서 있는 사람은 건너는 쪽으로 걸음(어른 3.6m/s — 게임의 걸음 배율, pedWalk.ts), 자전거는 그보다 빠르게
    const pace = tr.cls === 'bike' ? 6 : 3.6;
    const vx = it.onRoadway && moving ? tr.vx : it.dirX * pace;
    const vz = it.onRoadway && moving ? tr.vz : it.dirZ * pace;
    // 건너는 축 방향 성분 — 반대편 연석(CURB 11.2m + 0.6)을 넘는 점은 그리지 않는다
    const along = vx * (it.dirX !== 0 ? 1 : 0) + vz * (it.dirZ !== 0 ? 1 : 0);
    const rgb = hazard === 'danger' ? '239,68,68' : hazard === 'caution' ? '245,158,11' : '59,130,246';
    for (let k = 1; k <= 5; k += 1) {
      const t = k * 0.4;
      if (Math.abs(it.axis + along * t) > 11.8) break;
      const cx = x0 + vx * t;
      const cz = z0 + vz * t;
      const a = Math.min(1, it.enter) * (0.9 - 0.13 * (k - 1));
      const pts: V3[] = [];
      for (let i = 0; i < 12; i += 1) {
        const ang = (i / 12) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(ang) * 0.36, y: 0.03, z: cz + Math.sin(ang) * 0.36 });
      }
      this.poly(ctx, pts, `rgba(${rgb},${a.toFixed(3)})`);
    }
  }

  /**
   * **머리 위의 확률** — 의도 예측이 짐작한 '건너려 할 확률'. 보도 위에 선 사람만(차도 위 사람은 이미 건너는 중이다),
   * 10% 넘을 때만, **넓은 화면(PC)에서만** 단다 — 휴대폰의 작은 그림에서는 사람을 가린다. 신경망의 확률은 1 에 붙어도
   * 확신이 아니므로 99% 까지만 적는다. 붙어 선 사람의 딱지와 겹치면 한 칸 위로 올리고, 그래도 겹치면 달지 않는다.
   */
  private drawIntentLabel(
    ctx: CanvasRenderingContext2D,
    tr: Track,
    hazard: Hazard,
    it: PanelIntent,
    x: number,
    z: number,
  ): void {
    if (it.onRoadway || it.yield < 0.1 || this.w / this.dpr < 200) return;
    const h = tr.cls === 'child' ? CLASS_SIZE.child.height : tr.cls === 'bike' ? CLASS_SIZE.bike.height : CLASS_SIZE.adult.height;
    const p = this.cam({ x, y: h + 0.55, z });
    if (p.z < CAM.near) return;
    const [sx, sy] = this.screen(p);
    const size = Math.round(9.5 * this.dpr);
    const label = `건널 ${Math.min(99, Math.round(it.yield * 100))}%`;
    ctx.font = `800 ${size}px ${this.font}`;
    const tw = ctx.measureText(label).width;
    const w = (Number.isFinite(tw) ? tw : size * 3.6) + size * 0.9;
    const bh = size * 1.45;
    const hit = (y: number) =>
      this.labels.some(([x0, y0, x1, y1]) => sx - w / 2 < x1 && sx + w / 2 > x0 && y - bh < y1 && y > y0);
    let y = sy;
    if (hit(y)) y -= bh + 2 * this.dpr;
    if (hit(y)) return;
    this.labels.push([sx - w / 2, y - bh, sx + w / 2, y]);
    ctx.fillStyle = hazard === 'danger' ? 'rgba(220,38,38,0.92)' : hazard === 'caution' ? 'rgba(217,119,6,0.92)' : 'rgba(71,85,105,0.82)';
    ctx.beginPath();
    ctx.roundRect(sx - w / 2, y - bh, w, bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, sx, y - bh / 2 + size * 0.05);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  private drawObject(ctx: CanvasRenderingContext2D, tr: Track, hazard: Hazard, x: number, z: number): void {
    if (tr.cls === 'car') {
      this.drawCar(ctx, x, z, tr.yaw, tr.length, tr.width, CLASS_SIZE.car.height, NPC_PAINT, 0);
      return;
    }
    const tint = hazard === 'danger' ? 'danger' : hazard === 'caution' ? 'caution' : 'none';
    if (tr.cls === 'bike') {
      this.drawBike(ctx, x, z, tr.yaw, tr.length, tint);
      return;
    }
    const h = tr.cls === 'child' ? CLASS_SIZE.child.height : tr.cls === 'adult' ? CLASS_SIZE.adult.height : 1.2;
    this.drawPerson(ctx, x, z, h, 0, tint);
  }

  /**
   * 볼록한 덩어리 하나 — 아래 고리와 위 고리(꼭짓점 수가 같다)를 옆면으로 잇고, `withTop` 이면 위 고리로 뚜껑을 덮는다.
   * 카메라 쪽 면만 칠하므로 면끼리 순서를 따질 필요가 없다(볼록하므로 보이는 면은 서로 겹치지 않는다).
   * `color` 는 옆면 번호(아래 고리의 i → i+1) 또는 'top' 마다 색을 고른다. 옆면마다 보였는지를 돌려준다 — 등화를 그 위에 얹는다.
   */
  private loft(
    ctx: CanvasRenderingContext2D,
    bottom: readonly V3[],
    top: readonly V3[],
    color: (face: number | 'top') => RGB,
    withTop: boolean,
  ): boolean[] {
    const n = bottom.length;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of [...bottom, ...top]) {
      cx += p.x / (2 * n);
      cy += p.y / (2 * n);
      cz += p.z / (2 * n);
    }
    const paint = (q: readonly V3[], base: RGB): boolean => {
      // 면의 법선 (뉴웰) — 덩어리 중심에서 바깥쪽으로 맞춘다
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (let i = 0; i < q.length; i += 1) {
        const a = q[i];
        const b = q[(i + 1) % q.length];
        nx += (a.y - b.y) * (a.z + b.z);
        ny += (a.z - b.z) * (a.x + b.x);
        nz += (a.x - b.x) * (a.y + b.y);
        mx += a.x / q.length;
        my += a.y / q.length;
        mz += a.z / q.length;
      }
      if (nx * (mx - cx) + ny * (my - cy) + nz * (mz - cz) < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      if (nx * (this.camPos.x - mx) + ny * (this.camPos.y - my) + nz * (this.camPos.z - mz) <= 0) return false;
      const lit = Math.max(0, (nx * this.light.x + ny * this.light.y + nz * this.light.z) / nl);
      // 아래를 보는 면(문턱 아래쪽)은 그늘이다
      const under = ny / nl < -0.2 ? 0.78 : 1;
      this.poly(ctx, q, rgb(base, (0.64 + 0.4 * lit) * under), true);
      return true;
    };
    const visible: boolean[] = [];
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      visible.push(paint([bottom[i], bottom[j], top[j], top[i]], color(i)));
    }
    if (withTop) paint(top, color('top'));
    return visible;
  }

  /**
   * 차 — 테슬라 화면의 차처럼 둥글고 낮게. 모서리를 깎은 여덟모 고리를 쌓는다:
   * 문턱(아래) → 어깨(가장 불룩한 곳) → 허리선(보닛 · 트렁크 면) → 유리 지붕. 앞유리와 뒷유리는 눕히고, 바퀴 넷이 옆구리 아래로
   * 보이며, 뒤는 감싸는 붉은 등 띠, 앞 모서리에 헤드램프, 지붕에 광택. 그림자는 두 겹으로 번지게 깐다.
   * 사용자가 짚었다: "대시보드 차가 너무 못생김. 이쁘게 바꿔줘" — 예전에는 상자 위에 상자를 얹어 승합차처럼 보였다.
   */
  private drawCar(
    ctx: CanvasRenderingContext2D,
    x: number,
    z: number,
    yaw: number,
    length: number,
    width: number,
    height: number,
    paint: CarPaint,
    /** 차체 둘레의 파란 빛 번짐 (CSS px) — 0 이면 없다 */
    glow: number,
    /** 지붕 위 LiDAR 센서 (AI 자율주행 중인 내 차) */
    sensor = false,
  ): void {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    const P = (fw: number, rt: number, y: number): V3 => ({ x: x + fx * fw + rx * rt, y, z: z + fz * fw + rz * rt });
    const hl = length / 2;
    const hw = width / 2;
    const H = height;
    const ring = (r: CarRing): V3[] => ringPoints(r).map(([fw, rt, y]) => P(fw, rt, y));

    // 그림자 — 넓고 옅게 한 겹, 좁고 진하게 한 겹
    this.poly(ctx, ring({ front: hl + 0.45, rear: -hl - 0.45, half: hw + 0.4, cut: 1.0, yFront: 0.01, yRear: 0.01 }), COLOR.shadowSoft);
    this.poly(ctx, ring({ front: hl + 0.1, rear: -hl - 0.1, half: hw + 0.08, cut: 0.7, yFront: 0.012, yRear: 0.012 }), COLOR.shadow);

    // 바퀴 — 옆구리 아래로 반쯤 보인다 (차체가 위를 덮는다)
    const R = 0.23 * H;
    for (const fw of [0.62 * hl, -0.62 * hl]) {
      for (const side of [-1, 1]) {
        const pts: V3[] = [];
        for (let k = 0; k < 14; k += 1) {
          const a = (k / 14) * Math.PI * 2;
          pts.push(P(fw + Math.cos(a) * R, side * (hw - 0.12), R + Math.sin(a) * R));
        }
        this.poly(ctx, pts, COLOR.tire);
      }
    }

    // 모서리는 조금만 깎는다 — 많이 깎으면 앞뒤가 뾰족한 캡슐이 된다
    const sill: CarRing = { front: hl - 0.12, rear: -hl + 0.14, half: hw - 0.08, cut: 0.3, yFront: 0.24, yRear: 0.24 };
    // 허리선은 높게 — 유리 띠가 얇아야 낮고 날렵해 보인다 (낮으면 껑충한 승합차가 된다)
    const shoulder: CarRing = { front: hl, rear: -hl, half: hw, cut: 0.34, yFront: 0.44 * H, yRear: 0.5 * H };
    const belt: CarRing = { front: hl - 0.2, rear: -hl + 0.08, half: hw - 0.08, cut: 0.4, yFront: 0.6 * H, yRear: 0.69 * H };

    if (glow > 0) {
      ctx.save();
      ctx.shadowColor = COLOR.glow;
      ctx.shadowBlur = glow * this.dpr;
    }
    this.loft(ctx, ring(sill), ring(shoulder), () => paint.lower, false);
    const S = ring(shoulder);
    const B = ring(belt);
    const upper = this.loft(ctx, S, B, () => paint.body, true);
    if (glow > 0) ctx.restore();

    // 등화 — 어깨와 허리선 사이의 띠. 뒤는 모서리까지 감싸는 붉은 띠, 앞은 두 모서리의 헤드램프
    const band = (face: number, t0: number, t1: number, color: string): void => {
      if (!upper[face]) return;
      const j = (face + 1) % S.length;
      const at = (i: number, t: number): V3 => ({
        x: S[i].x + (B[i].x - S[i].x) * t,
        y: S[i].y + (B[i].y - S[i].y) * t,
        z: S[i].z + (B[i].z - S[i].z) * t,
      });
      this.poly(ctx, [at(face, t0), at(j, t0), at(j, t1), at(face, t1)], color);
    };
    for (const face of RING_REAR) band(face, 0.3, 0.62, COLOR.tail);
    for (const face of RING_FRONT_CORNERS) band(face, 0.38, 0.7, COLOR.headlight);

    // 실내 — 허리선 위의 유리 덩어리. 앞유리 · 뒷유리는 눕고, 위는 유리 지붕
    const beltY = (fw: number): number =>
      belt.yRear + ((belt.yFront - belt.yRear) * (fw - belt.rear)) / (belt.front - belt.rear);
    const base: CarRing = { front: hl * 0.38, rear: -hl * 0.72, half: hw - 0.14, cut: 0.3, yFront: beltY(hl * 0.38), yRear: beltY(-hl * 0.72) };
    const roof: CarRing = { front: hl * 0.08, rear: -hl * 0.5, half: hw - 0.3, cut: 0.26, yFront: H - 0.02, yRear: H - 0.07 };
    this.loft(ctx, ring(base), ring(roof), (f) => (f === 'top' ? paint.roof : paint.glass), true);

    if (sensor) {
      // 지붕 가운데의 검은 원통 · 파란 빛 띠 (3D 의 LidarRig 를 줄여 그린 것)
      const c = (roof.front + roof.rear) / 2;
      const yb = (roof.yFront + roof.yRear) / 2 - 0.03;
      const puck = (half: number, y: number): CarRing => ({ front: c + half, rear: c - half, half, cut: half * 0.6, yFront: y, yRear: y });
      this.loft(ctx, ring(puck(0.17, yb)), ring(puck(0.17, yb + 0.26)), (f) => (f === 'top' ? SENSOR.top : SENSOR.body), true);
      this.loft(ctx, ring(puck(0.18, yb + 0.08)), ring(puck(0.18, yb + 0.12)), () => SENSOR.band, false);
    }
  }

  /**
   * 사람 — 다리 둘 · 몸통 · 팔 둘 · 머리. 화면을 향해 세운 판처럼 그린다(어느 쪽에서 봐도 같은 모습).
   * `lift` 만큼 띄우면(자전거 안장) 탄 사람이라 다리를 페달 쪽으로 내린다.
   */
  private drawPerson(
    ctx: CanvasRenderingContext2D,
    x: number,
    z: number,
    height: number,
    lift: number,
    tint: 'none' | 'caution' | 'danger',
  ): void {
    const s = height / 1.67;
    const tone = TONE[tint];
    const base = this.cam({ x, y: lift, z });
    if (base.z < CAM.near) return;
    const ppm = this.pxPerM(base.z);
    /** 몸 기준 옆으로 dx m · 높이 y m 의 화면 자리 */
    const pt = (dx: number, y: number): [number, number] => {
      const [sx, sy] = this.screen(this.cam({ x, y: lift + y, z }));
      return [sx + dx * ppm, sy];
    };

    if (lift === 0) {
      const pts: V3[] = [];
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        pts.push({ x: x + Math.cos(a) * 0.34 * s, y: 0.01, z: z + Math.sin(a) * 0.34 * s });
      }
      this.poly(ctx, pts, COLOR.shadow);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const stroke = (pts: Array<[number, number]>, width: number, color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2 * this.dpr, width * ppm);
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
    };
    for (const side of [-1, 1]) {
      const foot = lift === 0 ? pt(side * 0.11 * s, 0.09 * s) : pt(side * 0.14 * s, -0.3 * s);
      stroke([foot, pt(side * 0.08 * s, 0.84 * s)], 0.16 * s, tone.limb);
    }
    stroke([pt(0, 0.92 * s), pt(0, 1.3 * s)], 0.4 * s, tone.body);
    for (const side of [-1, 1]) {
      stroke([pt(side * 0.23 * s, 1.3 * s), pt(side * 0.28 * s, 0.92 * s)], 0.11 * s, tone.body);
    }
    const [hx, hy] = pt(0, 1.56 * s);
    ctx.fillStyle = tone.head;
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(1.5 * this.dpr, 0.15 * s * ppm), 0, Math.PI * 2);
    ctx.fill();
  }

  /** 자전거 — 바퀴 둘 · 차체 선 · 탄 사람. 바퀴는 보는 각도만큼 눌린 타원이다 */
  private drawBike(
    ctx: CanvasRenderingContext2D,
    x: number,
    z: number,
    yaw: number,
    length: number,
    tint: 'none' | 'caution' | 'danger',
  ): void {
    const s = Math.min(2.4, Math.max(0.6, length / 1.72));
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const at = (fw: number, y: number): V3 => ({ x: x + fx * fw, y, z: z + fz * fw });
    const base = this.cam(at(0, 0));
    if (base.z < CAM.near) return;
    const ppm = this.pxPerM(base.z);
    const R = 0.34 * s;
    // 바퀴가 눌려 보이는 정도 — 자전거 축이 카메라 옆 방향과 이루는 각
    const squash = Math.max(0.2, Math.abs(fx * this.rx + fz * this.rz));

    // 그림자 — 자전거 길이 · 폭 0.5m 의 띠 (옆 방향은 (−fz, fx))
    const side = (fw: number, rt: number): V3 => ({ x: x + fx * fw - fz * rt, y: 0.01, z: z + fz * fw + fx * rt });
    this.poly(ctx, [side(0.86 * s, 0.25), side(0.86 * s, -0.25), side(-0.86 * s, -0.25), side(-0.86 * s, 0.25)], COLOR.shadow);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgb(COLOR.bikeFrame, 0.7);
    ctx.lineWidth = Math.max(1.2 * this.dpr, 0.09 * s * ppm);
    for (const fw of [-0.52 * s, 0.52 * s]) {
      const [cx, cy] = this.screen(this.cam(at(fw, R)));
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * ppm * squash, R * ppm, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 차체 — 뒷바퀴 · 안장 · 핸들 · 앞바퀴, 안장에서 페달까지
    const frame = [at(-0.52 * s, R), at(-0.12 * s, 0.95 * s), at(0.45 * s, 1.05 * s), at(0.52 * s, R)];
    ctx.strokeStyle = rgb(COLOR.bikeFrame);
    ctx.lineWidth = Math.max(1.2 * this.dpr, 0.07 * s * ppm);
    ctx.beginPath();
    frame.forEach((p, i) => {
      const [px, py] = this.screen(this.cam(p));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    const [bx, by] = this.screen(this.cam(at(0, 0.4 * s)));
    const [sx, sy] = this.screen(this.cam(at(-0.12 * s, 0.95 * s)));
    ctx.moveTo(sx, sy);
    ctx.lineTo(bx, by);
    ctx.stroke();

    this.drawPerson(ctx, x - fx * 0.1 * s, z - fz * 0.1 * s, 1.67 * s, 0.52 * s, tint);
  }

  /** 신호등 — 지주(또는 가로 팔)에 매단 세 등. 켜진 등만 밝다 */
  private drawSignal(ctx: CanvasRenderingContext2D, sig: PanelSignal): void {
    const topY = 5.2;
    const line = (a: V3, b: V3, width: number, color: string): void => {
      const ca = this.cam(a);
      const cb = this.cam(b);
      if (ca.z < CAM.near || cb.z < CAM.near) return;
      const [ax, ay] = this.screen(ca);
      const [bx, by] = this.screen(cb);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, width * this.pxPerM((ca.z + cb.z) / 2));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    // 머리 위 · 바로 옆의 신호등은 그리지 않는다 — 가까울수록 커져서 화면을 가린다
    const head = this.cam({ x: sig.x, y: topY - 0.6, z: sig.z });
    if (head.z < SIGNAL_MIN_DEPTH) return;
    const pole = '#9aa0a8';
    if (sig.poleX !== undefined) {
      line({ x: sig.poleX, y: 0, z: sig.z }, { x: sig.poleX, y: topY + 0.3, z: sig.z }, 0.22, pole);
      line({ x: sig.poleX, y: topY + 0.3, z: sig.z }, { x: sig.x, y: topY + 0.3, z: sig.z }, 0.14, pole);
    } else {
      line({ x: sig.x, y: 0, z: sig.z }, { x: sig.x, y: topY - 1.2, z: sig.z }, 0.2, pole);
    }

    /*
      등 — 화면을 향해 세운 판. 멀어도 읽히고 가까워도 가리지 않게 렌즈 크기를 묶는다. 차량신호등은 **가로로** 늘어서고
      (사용자가 짚었다: "화면은 운전자신호가 가로인데 대시보드에는 세로로 표시됨"), 우회전신호등만 세로다.
    */
    const [sx, sy] = this.screen(head);
    const lens = Math.min(5 * this.dpr, Math.max(2.4 * this.dpr, 0.3 * 1.6 * this.pxPerM(head.z)));
    const pitch = lens * 2.5;
    const vertical = sig.kind === 'rightArrow';
    const n = sig.kind === 'vehicle4' ? 4 : 3;
    const long = pitch * n + lens * 0.4;
    const short = pitch + lens * 0.2;
    ctx.fillStyle = '#3f444b';
    ctx.beginPath();
    if (vertical) ctx.roundRect(sx - short / 2, sy - long / 2, short, long, short * 0.45);
    else ctx.roundRect(sx - long / 2, sy - short / 2, long, short, short * 0.3);
    ctx.fill();

    // 렌즈의 차례 — 4색등은 셋째가 좌회전 화살표(이 게임에서는 늘 꺼져 있다), 녹색은 늘 마지막
    const colors = ['#ef4444', '#f59e0b', ...(n === 4 ? ['#22c55e'] : []), '#22c55e'];
    const lit = sig.color === 'red' ? 0 : sig.color === 'yellow' ? 1 : sig.color === 'green' ? n - 1 : -1;
    for (let i = 0; i < n; i += 1) {
      const off = (i - (n - 1) / 2) * pitch;
      const lx = vertical ? sx : sx + off;
      const ly = vertical ? sy + off : sy;
      ctx.save();
      // 켜진 렌즈의 번짐 — 가벼운 화면에서는 뺀다 (setLite)
      if (i === lit && !this.lite) {
        ctx.shadowColor = colors[i];
        ctx.shadowBlur = 8 * this.dpr;
      }
      ctx.fillStyle = i === lit ? colors[i] : '#5c626a';
      ctx.beginPath();
      ctx.arc(lx, ly, lens, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // 화살표 렌즈 — 4색등의 좌회전(꺼짐), 우회전신호등의 녹색(켜지면 흰 화살표)
      const glyph = n === 4 && i === 2 ? '←' : vertical && i === n - 1 ? '→' : '';
      if (glyph) {
        ctx.fillStyle = i === lit ? '#ffffff' : '#8a9099';
        ctx.font = `700 ${Math.max(6, lens * 1.5)}px ${this.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph, lx, ly + lens * 0.05);
      }
    }
  }

  // ── 점 · 글 ────────────────────────────────────────────────────────────

  /**
   * LiDAR 가 맞힌 점 — **바닥에 눌러** 옅게 찍는다. 물체 앞에 반달 모양으로 깔려, 이 화면이 센서로 본 것이라는 표시가
   * 된다. 맞은 높이 그대로 찍으면 사람 몸에 가로줄이 그어져 줄무늬 말뚝처럼 보였다.
   */
  private drawPoints(ctx: CanvasRenderingContext2D, scan: LidarScan): void {
    ctx.fillStyle = COLOR.point;
    const size = 1.8 * this.dpr;
    for (let cell = 0; cell < scan.range.length; cell += 1) {
      if (scan.range[cell] === Infinity) continue;
      const p = cellPoint(scan, cell);
      const c = this.cam({ x: p.x, y: 0.02, z: p.z });
      if (c.z < CAM.near) continue;
      const [sx, sy] = this.screen(c);
      if (sx < 0 || sy < 0 || sx > this.w || sy > this.h) continue;
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    }
  }

  /** 왼쪽 위 — 스캔 점 · 찾은 물체 수 · (AI 자율주행 중이면) 파란 표. 이름과 설명은 그림 밖 HTML(#lidar-cap)이 적는다 */
  private drawCaption(ctx: CanvasRenderingContext2D, frame: LidarFrame): void {
    const pad = 10 * this.dpr;
    // 글자 크기는 CSS px 로 11~15 (화면 폭의 26분의 1) — 좁은 세로 화면 · 작은 휴대폰 화면에서도 읽히게
    const big = Math.round(Math.max(11, Math.min(15, this.w / this.dpr / 26)) * this.dpr);
    const small = Math.round(big * 0.78);
    let people = 0;
    let bikes = 0;
    let cars = 0;
    for (const { track } of frame.tracks) {
      if (track.cls === 'adult' || track.cls === 'child') people += 1;
      else if (track.cls === 'bike') bikes += 1;
      else if (track.cls === 'car') cars += 1;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    // 바퀴마다 깜빡이는 점 — 센서가 돌고 있다는 표시
    const pulse = Math.max(0.35, 1 - frame.scanAge * 6);
    ctx.fillStyle = `rgba(59,130,246,${pulse})`;
    ctx.beginPath();
    ctx.arc(pad + big * 0.32, pad + big * 0.55, big * 0.26, 0, Math.PI * 2);
    ctx.fill();
    // 찾은 물체 수 — 신경망 분류기가 가려낸 결과다 (ai/perception.ts)
    const counts = [`사람 ${people}`, `자전거 ${bikes}`, `차 ${cars}`].join(' · ');
    const countSize = Math.round(big * 0.9);
    ctx.fillStyle = COLOR.text;
    ctx.font = `700 ${countSize}px ${this.font}`;
    const cx = pad + big * 0.8;
    ctx.fillText(counts, cx, pad + (big - countSize) * 0.5);
    if (frame.autopilot) {
      // 물체 수 옆 파란 표 — 숨 쉬듯 짙어졌다 옅어진다. **자리가 모자라면(휴대폰) 그리지 않는다** — 둘레의 파란 빛과 모드 카드가
      // 이미 AI 자율주행 중임을 말한다. 글자 폭을 못 재면(가짜 캔버스) 어림값
      const measured = ctx.measureText(counts).width;
      const x = cx + (Number.isFinite(measured) ? measured : countSize * 9) + big * 0.45;
      const label = 'AI 자율주행';
      ctx.font = `800 ${small}px ${this.font}`;
      const tw = ctx.measureText(label).width;
      const w = (Number.isFinite(tw) ? tw : small * 5.2) + small * 1.9;
      if (x + w <= this.w - pad) {
        const h = big * 1.12;
        const y = pad - big * 0.06;
        ctx.fillStyle = `rgba(${COLOR.badge},${(0.78 + 0.22 * this.breath()).toFixed(3)})`;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${(0.55 + 0.45 * this.breath()).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x + small * 0.75, y + h / 2, small * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + small * 1.25, y + h / 2 + small * 0.04);
        ctx.textBaseline = 'top';
      }
    }
  }
}
