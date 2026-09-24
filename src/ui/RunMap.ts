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
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_S_OUTER,
  FINISH_X,
  FINISH_Z,
  INTERSECTION_HALF,
  LANE_WIDTH,
  ROAD_HALF_WIDTH,
  SIDEWALK_OUTER,
  SPAWN_Z_STRAIGHT,
  STOP_LINE,
  STOP_LINE_S,
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
  /**
   * **사거리 없는 보호구역 전용 도로인가** (scenarios.ts 의 `drive: 'zoneOnly'`).
   *
   * 그 코스에는 교차로가 없고 횡단보도 셋이 한 줄로 늘어선다. 사거리 지도를 그대로 쓰면 지나지도
   * 않은 동서 도로와 '횡단보도 C' 가 그려져, 결과 화면이 **달리지 않은 길**을 보여 준다 —
   * 사용자가 짚었다: "어린이보호구역 결과 분석인데 지도가 4거리 지도로 되어 있어."
   */
  zoneRoad?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function drawRunMap(canvas: HTMLCanvasElement, data: RunMapData): void {
  if (data.zoneRoad) {
    drawZoneRoadMap(canvas, data);
    return;
  }
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

/**
 * **사거리 없는 보호구역 전용 도로의 주행 지도** (scenarios/zoneCourse.ts).
 *
 * 곧게 뻗은 길에 횡단보도가 셋 늘어서 있다. 사거리 지도를 그대로 쓰면 지나지도 않은 동서 도로와
 * '횡단보도 C' 가 함께 그려져, **달리지 않은 길**을 결과로 보여 주게 된다.
 *
 * ## 가로세로 배율을 따로 쓴다
 *
 * 이 길은 세로 134m · 가로 42m 라, 같은 배율로 담으면 **가로가 손톱만 해져** 어느 차로였는지도,
 * 사람이 어느 쪽에서 왔는지도 보이지 않는다. 그래서 가로만 늘여 그린다 — 지도가 답하는 질문은
 * "**길의 어디에서** 무슨 일이 있었나" 이고, 그 답은 세로 위치가 말한다. 궤적이 직선이라
 * 가로를 늘여도 잘못 읽힐 여지가 없다.
 */
function drawZoneRoadMap(canvas: HTMLCanvasElement, data: RunMapData): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 420;
  const cssH = Math.round(cssW * 1.5);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const X0 = -SIDEWALK_OUTER;
  const X1 = SIDEWALK_OUTER;
  // 출발 자리부터 완주선 조금 너머까지 — 달린 구간이 모두 들어온다
  const Z0 = FINISH_Z - 6;
  const Z1 = SPAWN_Z_STRAIGHT + 4;
  const kx = cssW / (X1 - X0);
  const kz = cssH / (Z1 - Z0);
  const px = (x: number) => (x - X0) * kx;
  /*
    **사거리 지도와 같은 방향으로 둔다** — 그쪽은 z 가 클수록 화면 아래다(VIEW 그대로). 뒤집어
    그렸더니 한 결과 화면 안에서 어떤 판은 위에서 아래로, 어떤 판은 아래에서 위로 달린 것이 되어
    같은 그림을 두 가지로 읽게 됐다. 출발이 아래, 도착이 위다.
  */
  const pz = (z: number) => (z - Z0) * kz;
  const mx = (v: number) => v * kx;
  const mz = (v: number) => v * kz;

  ctx.fillStyle = '#0b0f16';
  ctx.fillRect(0, 0, cssW, cssH);

  // ── 보도 · 차도 ──
  ctx.fillStyle = '#161b25';
  ctx.fillRect(0, 0, mx(SIDEWALK_OUTER - ROAD_HALF_WIDTH), cssH);
  ctx.fillRect(px(ROAD_HALF_WIDTH), 0, mx(SIDEWALK_OUTER - ROAD_HALF_WIDTH), cssH);
  ctx.fillStyle = '#232935';
  ctx.fillRect(px(-ROAD_HALF_WIDTH), 0, mx(ROAD_HALF_WIDTH * 2), cssH);

  // 어린이보호구역 — 길 전체가 구역이다 (game/Intersection.ts 의 drawSchoolZonePavement)
  ctx.fillStyle = 'rgba(168,50,44,0.35)';
  ctx.fillRect(px(0.2), 0, mx(ROAD_HALF_WIDTH - 0.5), cssH);

  // 중앙선 · 차로 구분선
  ctx.strokeStyle = 'rgba(240,196,25,0.55)';
  ctx.lineWidth = 1.5;
  line(ctx, px(0), 0, px(0), cssH);
  ctx.strokeStyle = 'rgba(233,233,233,0.22)';
  ctx.setLineDash([mz(2.5), mz(3)]);
  for (const off of [-LANE_WIDTH, LANE_WIDTH]) line(ctx, px(off), 0, px(off), cssH);
  ctx.setLineDash([]);

  // ── 횡단보도 셋과 그 정지선 ──
  const marks = [
    { name: '첫 번째 횡단보도', near: CROSSWALK_S_OUTER, far: CROSSWALK_S_INNER, stop: STOP_LINE_S },
    { name: '두 번째 횡단보도', near: CROSSWALK_OUTER, far: CROSSWALK_INNER, stop: STOP_LINE },
    { name: '세 번째 횡단보도', near: CROSSWALK_B_INNER, far: CROSSWALK_B_OUTER, stop: CROSSWALK_B_INNER + 2 },
  ];
  for (const c of marks) {
    ctx.fillStyle = 'rgba(236,240,247,0.5)';
    drawZebra(
      ctx,
      px(-ROAD_HALF_WIDTH),
      pz(c.near),
      mx(ROAD_HALF_WIDTH * 2),
      mz(c.near - c.far),
      'vertical',
      kx,
    );
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(px(0.2), pz(c.stop), mx(ROAD_HALF_WIDTH - 0.4), Math.max(2, mz(0.6)));
  }

  drawTracks(ctx, data, px, pz, cssW, cssH);

  for (const c of marks) label(ctx, px(-ROAD_HALF_WIDTH) + 4, pz(c.near) - 6, c.name, '#8b96a8');
}

/**
 * **궤적 · 보행자 · 위반 지점** — 두 지도가 나눠 쓴다.
 *
 * 그리는 것이 같은데 배율만 다르므로, 좌표 변환만 받아 한 벌로 둔다. 따로 적어 두면 한쪽만
 * 고쳐져 **같은 주행이 두 지도에서 다르게 보이는** 일이 생긴다.
 */
function drawTracks(
  ctx: CanvasRenderingContext2D,
  data: RunMapData,
  px: (x: number) => number,
  pz: (z: number) => number,
  cssW: number,
  cssH: number,
): void {
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
    const mid = Math.floor(pts.length / 2);
    if (mid + 1 < pts.length) {
      pedArrow(ctx, px(pts[mid].x), pz(pts[mid].z), px(pts[mid + 1].x), pz(pts[mid + 1].z));
    }
    dot(ctx, px(pts[0].x), pz(pts[0].z), 3.5, 'rgba(255,176,32,0.75)');
  }

  for (const v of data.violations) {
    for (const track of data.pedestrianPaths) {
      const at = nearestPoint(track.points, v.atTime);
      if (!at) continue;
      ctx.beginPath();
      ctx.arc(px(at.x), pz(at.z), 7, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb020';
      ctx.fill();
      ctx.strokeStyle = '#0b0f16';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  const path = data.path;
  if (path.length > 1) {
    ctx.strokeStyle = 'rgba(46,224,106,0.9)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))));
    ctx.stroke();
    for (const at of [0.35, 0.75]) {
      const i = Math.min(path.length - 2, Math.floor(path.length * at));
      arrowHead(ctx, px(path[i].x), pz(path[i].z), px(path[i + 1].x), pz(path[i + 1].z));
    }
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

  data.violations.forEach((v, i) => {
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
