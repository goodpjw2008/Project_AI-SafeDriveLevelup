/**
 * 시나리오 카드의 미니 지도 — **판을 고르기 전에 무엇이 다른지 보여 준다.**
 *
 * 예전 목록은 번호와 제목뿐이었다. 여덟 장이 글 여덟 줄이라 화면이 허전했고, 그보다
 * 나쁜 것은 **무엇이 다른 판인지 제목을 다 읽어야 알 수 있었다**는 점이다. 이 게임이
 * 겨루는 두 축(정면 신호색 · 보행자)은 그림 한 장이면 한눈에 갈린다.
 *
 * 디브리핑의 주행 지도(RunMap.ts)와 **같은 시선·같은 색**으로 그린다. 고르는 화면에서
 * 본 그림과 끝나고 본 그림이 다르면 같은 교차로라는 것을 매번 다시 알아봐야 한다.
 *
 * 좌표는 layout.ts 를 그대로 쓴다 — 교차로 치수를 바꾸면 이 그림도 따라간다.
 */

import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  INTERSECTION_HALF,
  LANE_2_OFFSET,
  LANE_WIDTH,
  ROAD_HALF_WIDTH,
  SIDEWALK_OUTER,
  STOP_LINE,
} from '../layout';
import { STANDARD_PROGRAM, type ScenarioSpec } from '../scenarios/scenarios';

/**
 * 담는 범위 (m). 카드가 3:2 라 가로 63m · 세로 42m 다.
 *
 * **세로를 줄일 때는 가로를 늘린다.** 위아래는 담을 것이 정해져 있다 — 위쪽 끝은
 * 정면 신호등, 아래쪽 끝은 정지선 앞에 선 내 차다. 그 둘을 자르면 이 판이 무엇을
 * 묻는지가 그림에서 사라진다. 그래서 카드를 납작하게 만들 때 z 를 깎지 않고 x 를
 * 넓혔다 — 우회전해서 빠져나가는 쪽(+X)이 넉넉해지는 편이라 손해가 없다.
 */
const VIEW = { x0: -18, x1: 45, z0: -16, z1: 26 };

/** 시간대별 바탕색 — 낮/황혼/밤이 카드에서도 구분돼야 한다 */
const SKIN = {
  day: { bg: '#0b0f16', road: '#232935', walk: '#161b25', zebra: 'rgba(236,240,247,0.5)' },
  dusk: { bg: '#120e14', road: '#2a2530', walk: '#1c1720', zebra: 'rgba(247,232,220,0.42)' },
  night: { bg: '#070a11', road: '#1a1f29', walk: '#12161e', zebra: 'rgba(210,222,240,0.34)' },
} as const;

/** 등화 색 — 3D 신호등·HUD 와 같은 값 */
const LIGHT = { red: '#ff3b2f', yellow: '#ffc400', green: '#2ee06a' } as const;

const lightColor = (c: string): string =>
  c === 'green' || c === 'greenFlash' || c === 'greenArrow'
    ? LIGHT.green
    : c === 'yellow' || c === 'yellowArrow'
      ? LIGHT.yellow
      : LIGHT.red;

/**
 * 카드에 그린다.
 *
 * **판마다 조건이 바뀌는 08번(randomized)은 물음표로 그린다.** 매번 다르게 뽑히는 판을
 * 특정한 한 가지 모습으로 그려 두면, 그 그림이 곧 거짓말이 된다.
 */
export function drawScenarioMap(canvas: HTMLCanvasElement, sc: ScenarioSpec): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 280;
  // 담는 범위와 같은 비율이어야 한다 — 어긋나면 교차로가 눌리거나 늘어난다
  const cssH = Math.round((cssW * 2) / 3);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const k = cssW / (VIEW.x1 - VIEW.x0);
  const px = (x: number) => (x - VIEW.x0) * k;
  const pz = (z: number) => (z - VIEW.z0) * k;
  const m = (v: number) => v * k;

  const skin = SKIN[sc.timeOfDay] ?? SKIN.day;
  const phase = STANDARD_PROGRAM[sc.startPhase] ?? STANDARD_PROGRAM[0];

  ctx.fillStyle = skin.bg;
  ctx.fillRect(0, 0, cssW, cssH);

  // ── 보도 (네 모서리) ──
  ctx.fillStyle = skin.walk;
  const walkW = SIDEWALK_OUTER - ROAD_HALF_WIDTH;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx > 0 ? ROAD_HALF_WIDTH : -SIDEWALK_OUTER;
      const z = sz > 0 ? ROAD_HALF_WIDTH : -SIDEWALK_OUTER;
      ctx.fillRect(px(x), pz(z), m(walkW), m(walkW));
    }
  }

  // ── 차도 ──
  ctx.fillStyle = skin.road;
  ctx.fillRect(px(-ROAD_HALF_WIDTH), 0, m(ROAD_HALF_WIDTH * 2), cssH);
  ctx.fillRect(0, pz(-ROAD_HALF_WIDTH), cssW, m(ROAD_HALF_WIDTH * 2));

  /*
    어린이보호구역은 **노면을 붉게 칠한다.** 실제 도로에서 그렇게 하기 때문이고,
    배지 한 줄보다 먼저 눈에 들어온다 — 이 게임에서 가장 무거운 조건이다.
  */
  if (sc.isSchoolZone) {
    ctx.fillStyle = 'rgba(196, 48, 40, 0.28)';
    ctx.fillRect(px(-ROAD_HALF_WIDTH), 0, m(ROAD_HALF_WIDTH * 2), cssH);
    ctx.fillRect(0, pz(-ROAD_HALF_WIDTH), cssW, m(ROAD_HALF_WIDTH * 2));
  }

  // 중앙선
  ctx.strokeStyle = 'rgba(240,196,25,0.5)';
  ctx.lineWidth = 1.2;
  line(ctx, px(0), 0, px(0), cssH);
  line(ctx, 0, pz(0), cssW, pz(0));

  // 차로 구분선
  ctx.strokeStyle = 'rgba(233,233,233,0.18)';
  ctx.setLineDash([m(2.5), m(3)]);
  for (const off of [-LANE_WIDTH, LANE_WIDTH]) {
    line(ctx, px(off), 0, px(off), cssH);
    line(ctx, 0, pz(off), cssW, pz(off));
  }
  ctx.setLineDash([]);

  // ── 횡단보도 A(진입 전, 남) · C(우회전 후, 동) ──
  ctx.fillStyle = skin.zebra;
  zebra(ctx, px(-ROAD_HALF_WIDTH), pz(CROSSWALK_INNER), m(ROAD_HALF_WIDTH * 2), m(CROSSWALK_OUTER - CROSSWALK_INNER), 'vertical', k);
  zebra(ctx, px(CROSSWALK_INNER), pz(-ROAD_HALF_WIDTH), m(CROSSWALK_OUTER - CROSSWALK_INNER), m(ROAD_HALF_WIDTH * 2), 'horizontal', k);

  // ── 정지선 ──
  ctx.fillStyle = 'rgba(242,242,242,0.9)';
  ctx.fillRect(px(0.2), pz(STOP_LINE), m(ROAD_HALF_WIDTH - 0.4), Math.max(1.5, m(0.4)));

  // ── 내가 갈 길 ──
  // 진입 차로를 따라 올라와 안쪽 코너를 돌아 나간다. 이 판이 '우회전'임을 말없이 알린다.
  drawTurnPath(ctx, px, pz, m);

  // ── 교차 방향 차량 ──
  if (sc.crossTraffic > 0) drawCrossTraffic(ctx, px, pz, m, sc.crossTraffic);

  // ── 진출로 정체 (꼬리물기 상황) ──
  if (sc.exitBlocked) drawJam(ctx, px, pz, m);

  // ── 앞차 ── 내 진입 차로, 정지선 바로 뒤에 한 대. 무엇을 할지는 그리지 않는다 (Screens 의 조건표)
  if (sc.leadCar) carMark(ctx, px(LANE_2_OFFSET), pz(STOP_LINE + 3), m, 'vertical', '#d9a441');

  // ── 보행자 ──
  // 있는 판과 없는 판이 이 게임의 두 축 중 하나다. 나올 확률이 1 미만이면 흐리게 그린다.
  for (const ped of sc.pedestrians) {
    /*
      **진입부 보호구역(S)의 보행자는 그리지 않는다.**

      이 그림은 교차로를 위에서 본 것이라 z ∈ [46, 50] 은 화면 밖이다. 억지로 넣으면
      교차로에서 한참 떨어진 자리에 사람이 서 있는 그림이 되고, 억지로 끌어당기면
      A 횡단보도의 보행자처럼 보인다 — 둘 다 판을 잘못 읽게 만든다.
      그 구간이 있다는 것은 카드의 조건표가 말한다 (Screens.ts 의 scenarioTags).
    */
    /*
      S(진입로 보호구역)는 이 그림의 바깥이라 건너뛴다. B(교차로 건너편)도 아직 그리지 않는다 —
      이 카드 그림은 우회전 코스를 위에서 본 것이라 북쪽이 잘려 있다 (직진 코스 그림은 나중에).
    */
    if (ped.crosswalk === 'S' || ped.crosswalk === 'B') continue;
    const chance = ped.chance ?? 1;
    ctx.globalAlpha = chance >= 1 ? 1 : 0.45;
    drawPedestrian(ctx, px, pz, m, ped.crosswalk, ped.from, ped.kind ?? 'adult');
    ctx.globalAlpha = 1;
  }

  // ── 신호등 ──
  // 정면 차량신호등은 정지선 건너편(교차로 북쪽)에, 우회전 신호등은 정지선 옆 보도에 선다.
  drawSignal(ctx, px(LANE_2_OFFSET), pz(-INTERSECTION_HALF - 3.2), m, lightColor(phase.vehicle));
  if (sc.rightArrowInstalled) {
    drawArrowSignal(ctx, px(SIDEWALK_OUTER - 1.2), pz(STOP_LINE - 1.5), m, lightColor(phase.rightArrow));
  }

  /*
    **신호기 없는 횡단보도**는 표시해 준다. 이 게임에서 가장 자주 틀리는 조건인데
    (신호기가 없으면 보행자 유무와 무관하게 일시정지 — 제27조 제7항) 그림만 보면
    있는 것과 없는 것이 구분되지 않기 때문이다.
  */
  if (!sc.pedSignalInstalled.C) {
    drawNoSignalMark(ctx, px(CROSSWALK_OUTER + 1.8), pz(ROAD_HALF_WIDTH + 3.4), m);
  }

  // 판마다 조건이 새로 뽑히는 판은 고정된 그림으로 약속할 수 없다
  if (sc.randomized) drawRandomBadge(ctx, cssW, cssH);
}

// ── 그리기 조각들 ──────────────────────────────────────────────────────────

type Proj = (v: number) => number;

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** 횡단보도 줄무늬 */
function zebra(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dir: 'vertical' | 'horizontal',
  k: number,
): void {
  const step = k * 1.4;
  const bar = step * 0.55;
  if (dir === 'vertical') {
    for (let sx = x + step * 0.3; sx < x + w - bar * 0.5; sx += step) {
      ctx.fillRect(sx, y, bar, h);
    }
  } else {
    for (let sy = y + step * 0.3; sy < y + h - bar * 0.5; sy += step) {
      ctx.fillRect(x, sy, w, bar);
    }
  }
}

/** 내 차가 갈 길 — 진입 차로 → 안쪽 코너 → 진출 차로 */
function drawTurnPath(ctx: CanvasRenderingContext2D, px: Proj, pz: Proj, m: Proj): void {
  const lane = LANE_2_OFFSET;
  ctx.strokeStyle = 'rgba(46,224,106,0.85)';
  ctx.lineWidth = Math.max(2, m(0.9));
  ctx.lineCap = 'round';
  ctx.setLineDash([m(2.2), m(1.8)]);
  ctx.beginPath();
  ctx.moveTo(px(lane), pz(STOP_LINE + 1));
  ctx.lineTo(px(lane), pz(INTERSECTION_HALF - 1));
  // 코너는 안쪽 모서리에 붙여 돈다 — '우측 가장자리 통행'(제25조 제1항)이 이 게임의 기본이다
  ctx.quadraticCurveTo(px(lane), pz(lane), px(INTERSECTION_HALF + 1), pz(lane));
  ctx.lineTo(px(VIEW.x1 - 2), pz(lane));
  ctx.stroke();
  ctx.setLineDash([]);

  // 진행 방향 화살촉
  const tipX = px(VIEW.x1 - 2);
  const tipY = pz(lane);
  const s = Math.max(4, m(1.5));
  ctx.fillStyle = 'rgba(46,224,106,0.95)';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - s * 1.5, tipY - s * 0.8);
  ctx.lineTo(tipX - s * 1.5, tipY + s * 0.8);
  ctx.closePath();
  ctx.fill();

  /*
    내 차 — **정지선 앞**. 그림이 던지는 질문("여기서 어떻게 할 것인가")의 시점이다.

    정지선에서 2.3m 뒤에 둔다. 차 길이가 4.4m 라 뒷범퍼가 z=25.4 이고, 담는 범위의
    아래 끝(26)까지 0.6m 가 남는다 — 3m 에 두었을 때는 뒷범퍼가 정확히 아래변에 닿아
    잘린 것처럼 보였다.
  */
  carMark(ctx, px(lane), pz(STOP_LINE + 2.3), m, 'vertical', '#4c8dff');
}

/**
 * 교차 방향에서 오는 차.
 *
 * **동쪽 진입로에 세운다.** 서쪽에 두면 화면 왼쪽 끝에 걸려 반만 나온다(담는 범위가
 * 우회전해서 빠져나가는 쪽으로 치우쳐 있다). 동쪽 서행 차로는 내 진출 차로와 반대편이라
 * 초록 궤적과 겹치지도 않는다.
 */
function drawCrossTraffic(ctx: CanvasRenderingContext2D, px: Proj, pz: Proj, m: Proj, n: number): void {
  for (let i = 0; i < Math.min(n, 3); i += 1) {
    carMark(ctx, px(21 + i * 6.5), pz(-LANE_2_OFFSET), m, 'horizontal', '#8794ad');
  }
}

/** 진출로 정체 — 우회전해서 나갈 자리가 막혀 있다 */
function drawJam(ctx: CanvasRenderingContext2D, px: Proj, pz: Proj, m: Proj): void {
  for (let i = 0; i < 3; i += 1) {
    carMark(ctx, px(CROSSWALK_OUTER + 4 + i * 6), pz(LANE_2_OFFSET), m, 'horizontal', '#c2703f');
  }
}

/** 차 한 대 — 위에서 본 네모 */
function carMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  m: Proj,
  dir: 'vertical' | 'horizontal',
  color: string,
): void {
  const long = Math.max(6, m(4.4));
  const wide = Math.max(3.5, m(1.9));
  const w = dir === 'vertical' ? wide : long;
  const h = dir === 'vertical' ? long : wide;
  ctx.fillStyle = color;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.32);
  ctx.fill();
}

/** 보행자 — 횡단보도 위의 점. 출발한 쪽에 찍어 어디서 어디로 건너는지 보이게 한다. */
function drawPedestrian(
  ctx: CanvasRenderingContext2D,
  px: Proj,
  pz: Proj,
  m: Proj,
  crosswalk: 'A' | 'C',
  from: 'left' | 'right',
  kind: 'adult' | 'child' | 'elder',
): void {
  const mid = (CROSSWALK_INNER + CROSSWALK_OUTER) / 2;
  // A 는 남북 도로를 가로지르고(동서로 걷는다), C 는 동서 도로를 가로지른다(남북으로 걷는다)
  const x = crosswalk === 'A' ? (from === 'left' ? -ROAD_HALF_WIDTH + 2 : ROAD_HALF_WIDTH - 2) : mid;
  const z = crosswalk === 'A' ? mid : from === 'left' ? -ROAD_HALF_WIDTH + 2 : ROAD_HALF_WIDTH - 2;

  const r = Math.max(2.6, m(kind === 'child' ? 0.85 : 1.05));
  const cx = px(x);
  const cy = pz(z);

  ctx.fillStyle = '#ffb020';
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.9, r * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.5, r * 0.62, r * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // 건너가는 방향
  ctx.strokeStyle = 'rgba(255,176,32,0.75)';
  ctx.lineWidth = Math.max(1.2, m(0.28));
  ctx.setLineDash([m(1.1), m(1.1)]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  if (crosswalk === 'A') ctx.lineTo(px(from === 'left' ? ROAD_HALF_WIDTH - 2 : -ROAD_HALF_WIDTH + 2), cy);
  else ctx.lineTo(cx, pz(from === 'left' ? ROAD_HALF_WIDTH - 2 : -ROAD_HALF_WIDTH + 2));
  ctx.stroke();
  ctx.setLineDash([]);
}

/** 정면 차량신호등등 — 세로로 세운 3등화. 지금 켜진 등만 색을 준다. */
function drawSignal(ctx: CanvasRenderingContext2D, x: number, y: number, m: Proj, on: string): void {
  const r = Math.max(2.4, m(0.95));
  const w = r * 6.6;
  const h = r * 3.2;

  ctx.fillStyle = 'rgba(10,13,19,0.92)';
  roundRect(ctx, x - w / 2, y - h / 2, w, h, r * 0.9);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const slots: Array<[string, number]> = [
    [LIGHT.red, -1],
    [LIGHT.yellow, 0],
    [LIGHT.green, 1],
  ];
  for (const [color, i] of slots) {
    const cx = x + i * (r * 2.1);
    ctx.beginPath();
    ctx.arc(cx, y, r * 0.78, 0, Math.PI * 2);
    if (color === on) {
      ctx.fillStyle = color;
      ctx.fill();
      // 켜진 등은 번져 보여야 꺼진 등과 확실히 갈린다
      ctx.shadowColor = color;
      ctx.shadowBlur = r * 2.6;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fill();
    }
  }
}

/** 우회전 신호등 — 있는 교차로에서만 그린다 */
function drawArrowSignal(ctx: CanvasRenderingContext2D, x: number, y: number, m: Proj, on: string): void {
  const r = Math.max(2.2, m(0.85));
  ctx.fillStyle = 'rgba(10,13,19,0.92)';
  roundRect(ctx, x - r * 1.5, y - r * 3.4, r * 3, r * 6.8, r * 0.8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y + r * 2, r * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = on;
  ctx.fill();
  ctx.shadowColor = on;
  ctx.shadowBlur = r * 2.4;
  ctx.fill();
  ctx.shadowBlur = 0;
}

/** 신호기 없는 횡단보도 표시 — 이 게임에서 가장 자주 틀리는 조건 */
function drawNoSignalMark(ctx: CanvasRenderingContext2D, x: number, y: number, m: Proj): void {
  const r = Math.max(6, m(2.4));
  ctx.fillStyle = 'rgba(255,176,32,0.16)';
  ctx.strokeStyle = 'rgba(255,176,32,0.8)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,176,32,0.9)';
  ctx.lineWidth = Math.max(1.4, r * 0.16);
  const d = r * 0.5;
  line(ctx, x - d, y - d, x + d, y + d);
  line(ctx, x + d, y - d, x - d, y + d);
}

/** 조건이 판마다 새로 뽑히는 판 */
function drawRandomBadge(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = 'rgba(6,9,14,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(232,236,242,0.92)';
  ctx.font = `800 ${Math.round(h * 0.3)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', w / 2, h * 0.46);
  ctx.font = `700 ${Math.round(h * 0.085)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(151,162,181,0.95)';
  ctx.fillText('조건이 매번 바뀝니다', w / 2, h * 0.74);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
