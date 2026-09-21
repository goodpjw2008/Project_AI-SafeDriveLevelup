/**
 * 주행 지도 — "어디서 잘못했는가"를 한 장으로 보여 준다.
 *
 * 디브리핑에서 위반 문구만 읽으면 "그래서 내가 어디서 그랬다는 거지?" 가 남는다.
 * 교차로를 위에서 내려다본 그림에 **내가 지나간 궤적**과 **위반이 확정된 지점**을 함께 찍으면
 * 그 질문이 사라진다. 번호는 위반 카드의 번호와 같다.
 *
 * 좌표는 layout.ts 를 그대로 쓴다 — 교차로 치수를 바꾸면 지도도 따라간다.
 */

import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  FINISH_X,
  INTERSECTION_HALF,
  LANE_WIDTH,
  ROAD_HALF_WIDTH,
  SIDEWALK_OUTER,
  STOP_LINE,
} from '../layout';
import type { Crumb, PedestrianTrack } from '../rules/lawRules';
import type { ViolationEvent } from '../rules/violations';

/**
 * 지도가 담는 월드 범위 (m). 접근로는 정지선 위쪽 조금까지만 보여 준다.
 *
 * 도로 폭·완주선에서 유도한다 — 고정값으로 두면 도로를 넓혔을 때 궤적의 끝(완주 지점)이
 * 지도 밖으로 잘려 나간다. 화면이 정사각이므로 x·z 범위를 같게 잡는다.
 */
const VIEW_MIN = -(ROAD_HALF_WIDTH + 6);
const VIEW_MAX = FINISH_X + 3;
const VIEW = { x0: VIEW_MIN, x1: VIEW_MAX, z0: VIEW_MIN, z1: VIEW_MAX };

export interface RunMapData {
  path: Crumb[];
  pedestrianPaths: PedestrianTrack[];
  violations: ViolationEvent[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function drawRunMap(canvas: HTMLCanvasElement, data: RunMapData): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 420;
  const cssH = cssW; // 담는 범위가 정사각이라 화면도 정사각
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const k = cssW / (VIEW.x1 - VIEW.x0);
  const px = (x: number) => (x - VIEW.x0) * k;
  const pz = (z: number) => (z - VIEW.z0) * k;
  const m = (v: number) => v * k;

  ctx.fillStyle = '#0b0f16';
  ctx.fillRect(0, 0, cssW, cssH);

  // ── 보도 ──
  ctx.fillStyle = '#161b25';
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx > 0 ? ROAD_HALF_WIDTH : -SIDEWALK_OUTER;
      const z = sz > 0 ? ROAD_HALF_WIDTH : -SIDEWALK_OUTER;
      ctx.fillRect(px(x), pz(z), m(SIDEWALK_OUTER - ROAD_HALF_WIDTH), m(SIDEWALK_OUTER - ROAD_HALF_WIDTH));
    }
  }

  // ── 차도 ──
  ctx.fillStyle = '#232935';
  ctx.fillRect(px(-ROAD_HALF_WIDTH), 0, m(ROAD_HALF_WIDTH * 2), cssH);
  ctx.fillRect(0, pz(-ROAD_HALF_WIDTH), cssW, m(ROAD_HALF_WIDTH * 2));

  // 중앙선
  ctx.strokeStyle = 'rgba(240,196,25,0.55)';
  ctx.lineWidth = 1.5;
  line(ctx, px(0), 0, px(0), cssH);
  line(ctx, 0, pz(0), cssW, pz(0));

  // 차로 구분선
  ctx.strokeStyle = 'rgba(233,233,233,0.22)';
  ctx.setLineDash([m(2.5), m(3)]);
  for (const off of [-LANE_WIDTH, LANE_WIDTH]) {
    line(ctx, px(off), 0, px(off), cssH);
    line(ctx, 0, pz(off), cssW, pz(off));
  }
  ctx.setLineDash([]);

  // ── 횡단보도 A(남) · C(동) ──
  ctx.fillStyle = 'rgba(236,240,247,0.5)';
  drawZebra(ctx, px(-ROAD_HALF_WIDTH), pz(CROSSWALK_INNER), m(ROAD_HALF_WIDTH * 2), m(CROSSWALK_OUTER - CROSSWALK_INNER), 'vertical', k);
  drawZebra(ctx, px(CROSSWALK_INNER), pz(-ROAD_HALF_WIDTH), m(CROSSWALK_OUTER - CROSSWALK_INNER), m(ROAD_HALF_WIDTH * 2), 'horizontal', k);

  // ── 정지선 ──
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(px(0.2), pz(STOP_LINE), m(ROAD_HALF_WIDTH - 0.4), Math.max(2, m(0.4)));

  // ── 교차로 박스 ──
  ctx.strokeStyle = 'rgba(76,141,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px(-INTERSECTION_HALF), pz(-INTERSECTION_HALF), m(INTERSECTION_HALF * 2), m(INTERSECTION_HALF * 2));

  // ── 보행자 궤적 ──
  // 내 궤적보다 먼저 그려 아래에 깔리게 한다. 판단의 대상이지 주인공은 아니다.
  for (const track of data.pedestrianPaths) {
    const pts = track.points;
    if (pts.length < 2) continue;
    ctx.strokeStyle = 'rgba(255,176,32,0.65)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))));
    ctx.stroke();
    ctx.setLineDash([]);

    // 어느 쪽으로 걸어갔는지
    const mid = Math.floor(pts.length / 2);
    if (mid + 1 < pts.length) {
      pedArrow(ctx, px(pts[mid].x), pz(pts[mid].z), px(pts[mid + 1].x), pz(pts[mid + 1].z));
    }
    dot(ctx, px(pts[0].x), pz(pts[0].z), 3.5, 'rgba(255,176,32,0.75)');
  }

  // ── 위반 순간의 보행자 위치 ──
  // "그때 저 사람은 어디 있었나" — 이게 없으면 판정을 되짚을 수 없다.
  for (const v of data.violations) {
    for (const track of data.pedestrianPaths) {
      const at = nearestPoint(track.points, v.atTime);
      if (!at) continue;
      const x = px(at.x);
      const y = pz(at.z);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb020';
      ctx.fill();
      ctx.strokeStyle = '#0b0f16';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ── 주행 궤적 ──
  // 스폰 지점(z=68)까지 담으면 교차로가 손톱만 해진다. 지도에 들어오는 구간만 그린다.
  const path = data.path.filter((p) => p.z <= VIEW.z1);
  if (path.length > 1) {
    ctx.strokeStyle = 'rgba(46,224,106,0.9)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))));
    ctx.stroke();

    // 진행 방향 화살촉 — 어느 쪽으로 갔는지 헷갈리지 않게
    for (const at of [0.35, 0.75]) {
      const i = Math.min(path.length - 2, Math.floor(path.length * at));
      arrowHead(ctx, px(path[i].x), pz(path[i].z), px(path[i + 1].x), pz(path[i + 1].z));
    }

    // 시작·끝 지점은 지도 밖으로 나가더라도 가장자리에 붙여 보이게 한다
    const sx = clamp(px(path[0].x), 10, cssW - 10);
    const sz = clamp(pz(path[0].z), 10, cssH - 10);
    dot(ctx, sx, sz, 5, '#2ee06a');
    label(ctx, sx + 9, sz - 4, '진입', '#8bd6a4');

    const last = path[path.length - 1];
    const ex = clamp(px(last.x), 10, cssW - 10);
    const ez = clamp(pz(last.z), 10, cssH - 10);
    dot(ctx, ex, ez, 5, '#4c8dff');
    label(ctx, ex - 34, ez - 10, '도착', '#9ec2ff');
  }

  // ── 위반 지점 ──
  data.violations.forEach((v, i) => {
    // 지도 밖에서 확정된 위반(예: 진출 후 집계)도 가장자리에 붙여 반드시 보이게 한다
    const x = clamp(px(v.atPosition.x), 16, cssW - 16);
    const z = clamp(pz(v.atPosition.z), 16, cssH - 16);
    ctx.beginPath();
    ctx.arc(x, z, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,69,58,0.22)';
    ctx.fill();
    dot(ctx, x, z, 9, '#ff453a');
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, z + 0.5);
  });

  // ── 지명 ──
  label(ctx, px(-ROAD_HALF_WIDTH) + 4, pz(CROSSWALK_INNER) - 6, '횡단보도 A', '#8b96a8');
  label(ctx, px(CROSSWALK_INNER) - 2, pz(-ROAD_HALF_WIDTH) - 6, '횡단보도 C', '#8b96a8');
  label(ctx, px(0.6), pz(STOP_LINE) + 14, '정지선', '#8b96a8');
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  ctx.fillStyle = color;
  ctx.font = '600 11px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function arrowHead(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const s = 7;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - s * Math.cos(a - 0.4), y1 - s * Math.sin(a - 0.4));
  ctx.lineTo(x1 - s * Math.cos(a + 0.4), y1 - s * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fillStyle = 'rgba(46,224,106,0.95)';
  ctx.fill();
}

/** 해당 시각에 가장 가까운 발자국. 시각 차가 크면(이미 사라진 뒤) 없는 것으로 본다. */
function nearestPoint(points: Crumb[], t: number): Crumb | null {
  let best: Crumb | null = null;
  let bestGap = Infinity;
  for (const p of points) {
    const gap = Math.abs(p.t - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  return bestGap <= 0.3 ? best : null;
}

function pedArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const s = 6;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - s * Math.cos(a - 0.45), y1 - s * Math.sin(a - 0.45));
  ctx.lineTo(x1 - s * Math.cos(a + 0.45), y1 - s * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,176,32,0.85)';
  ctx.fill();
}

/** 횡단보도 흰 띠 */
function drawZebra(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dir: 'vertical' | 'horizontal',
  k: number,
): void {
  const stripe = k * 0.45;
  const gap = k * 0.45;
  if (dir === 'vertical') {
    for (let sx = x + gap; sx < x + w - stripe; sx += stripe + gap) ctx.fillRect(sx, y, stripe, h);
  } else {
    for (let sy = y + gap; sy < y + h - stripe; sy += stripe + gap) ctx.fillRect(x, sy, w, stripe);
  }
}
