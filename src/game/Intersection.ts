/**
 * 교차로 지오메트리.
 *
 * 노면(차선·횡단보도·정지선·노면표시)은 이미지 에셋 없이 캔버스에 절차적으로 그려
 * 텍스처로 굽는다. 덕분에 layout.ts의 치수를 바꾸면 그림도 같이 따라간다.
 */

import * as THREE from 'three';
import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  LANE_1_OFFSET,
  LANE_WIDTH,
  PLAYER_APPROACH_X,
  ROAD_HALF_WIDTH,
  SIDEWALK_OUTER,
  STOP_LINE,
  APPROACH_ZONE_FAR_Z,
  APPROACH_ZONE_NEAR_Z,
  CROSSWALK_S_INNER,
  CROSSWALK_WIDTH,
  STOP_LINE_S,
} from '../layout';

/**
 * 노면 텍스처가 덮는 **세계 범위**.
 *
 * ## 정사각형이 아니다
 *
 * 한때 원점을 중심으로 한 정사각형(±76m)이었다. 진입부 어린이보호구역이 생기면서
 * 출발 지점이 남쪽으로 멀어졌는데, 정사각형이라 **플레이어가 가지도 않는 북쪽까지
 * 같은 만큼 넓혀야** 했다 — 남쪽 300m 를 담으려면 북쪽 300m 도 함께 그리는 셈이다.
 * 그렇게 넓힌 만큼 미터당 픽셀이 떨어져 정지선과 횡단보도가 흐려졌다.
 *
 * 지금은 **필요한 쪽만** 넓힌다. 플레이어는 남(+z)에서 와서 동(+x)으로 나가므로
 * 북쪽은 배경으로 보이는 만큼만 있으면 된다.
 *
 * ## 등방이다
 *
 * 가로세로 미터당 픽셀이 같다 — `toPx` 하나가 두 축에 함께 쓰이기 때문이다
 * (가로 0.5m 짜리 횡단보도 띠와 세로 0.4m 짜리 정지선을 같은 함수로 그린다).
 * 축마다 다른 배율을 주려면 그 함수를 둘로 가르고 호출 자리를 전부 손봐야 하는데,
 * 얻는 것에 비해 어긋날 자리가 너무 많다.
 *
 * ## 출발 지점을 반드시 품어야 한다
 *
 * 60m 였을 때는 차가 텍스처 밖에서 출발해, 발밑이 밋밋한 회색 바닥(지평선용 판)이고
 * 8m 앞에서야 차선이 그려진 노면이 시작됐다 — 출발하자마자 도로가 두 색으로 갈려 보였다.
 */
interface RoadExtent {
  /** x ∈ [-xHalf, xHalf] */
  xHalf: number;
  /** z ∈ [zMin, zMax] — zMax 가 남쪽(플레이어가 오는 쪽)이다 */
  zMin: number;
  zMax: number;
  /** 미터당 픽셀 */
  pxPerM: number;
}

/** 진입부 보호구역이 없는 판 — 예전 그대로 ±76m · 16.8px/m */
const EXTENT_DEFAULT: RoadExtent = { xHalf: 76, zMin: -76, zMax: 76, pxPerM: 2560 / 152 };

/**
 * 진입부 보호구역이 있는 판.
 *
 * 남쪽으로 출발 지점(SPAWN_Z_SCHOOL_ZONE)보다 조금 더 나가야 하고, 북쪽은 배경으로
 * 보이는 만큼(76m)이면 된다. **긴 쪽 픽셀이 4096 을 넘지 않게** 잡는다 — 그 위부터는
 * 지원하지 않는 기기가 나온다.
 */
const EXTENT_APPROACH: RoadExtent = {
  xHalf: 76,
  zMin: -76,
  zMax: 190,
  pxPerM: 4096 / (190 + 76),
};

/*
  한 판을 짓는 동안 고정인 값이라 모듈 변수로 둔다 — `cx`·`cy`·`toPx` 가 그리기 함수
  열댓 개에 흩어져 있어, 인자로 넘기려면 전부를 고쳐야 한다.

  **`setRoadExtent` 로 먼저 정한다.** 텍스처를 굽는 김에 정하게 두었더니 보도
  (buildSidewalks)와 판 크기가 그 뒤에 불리는 것에 기대게 됐다 — 생성자 순서를 바꾸는
  사람이 알 길이 없는 함정이다. 짓기 전에 대놓고 정한다.
*/
let EXT: RoadExtent = EXTENT_DEFAULT;
let TEX_W = Math.round(EXT.xHalf * 2 * EXT.pxPerM);
let TEX_H = Math.round((EXT.zMax - EXT.zMin) * EXT.pxPerM);

/** 이 판이 덮을 범위를 정한다. **무엇을 짓든 그 전에 부른다.** */
function setRoadExtent(approachZone: boolean): void {
  EXT = approachZone ? EXTENT_APPROACH : EXTENT_DEFAULT;
  TEX_W = Math.round(EXT.xHalf * 2 * EXT.pxPerM);
  TEX_H = Math.round((EXT.zMax - EXT.zMin) * EXT.pxPerM);
}

/** 진입부 보호구역 판의 노면이 남쪽으로 어디까지 그려지는가 — 출발 지점 검사에 쓴다 */
export const ROAD_Z_MAX_APPROACH = EXTENT_APPROACH.zMax;

/** 어린이보호구역 노면 문자·속도표시가 차지하는 z 구간 (진입 차로) */
const SCHOOL_MARK_Z: [number, number] = [30.0, 44.6];

const toPx = (meters: number) => meters * EXT.pxPerM;
/** 월드 x → 캔버스 x, 월드 z → 캔버스 y (플레인 회전까지 감안한 매핑) */
const cx = (x: number) => (x + EXT.xHalf) * EXT.pxPerM;
const cy = (z: number) => (z - EXT.zMin) * EXT.pxPerM;

function drawAsphalt(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#3a3a3e';
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // 아스팔트 입자감 — 균일한 회색은 3D에서 플라스틱처럼 보인다
  const img = ctx.getImageData(0, 0, TEX_W, TEX_H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** 도로 밖 구역(보도 안쪽 바닥)을 어둡게 깔아 도로 경계를 만든다 */
function drawOffRoad(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = '#5d5d61';
  /*
    네 모서리(도로가 아닌 구역). 텍스처가 정사각형이 아니라 **모서리마다 크기가 다르다** —
    남쪽은 출발 지점까지 길고 북쪽은 배경으로 보이는 만큼뿐이다.
  */
  const westW = EXT.xHalf - ROAD_HALF_WIDTH;
  const eastW = EXT.xHalf - ROAD_HALF_WIDTH;
  const northD = -ROAD_HALF_WIDTH - EXT.zMin;
  const southD = EXT.zMax - ROAD_HALF_WIDTH;
  for (const [x, z, w, d] of [
    [-EXT.xHalf, EXT.zMin, westW, northD],
    [ROAD_HALF_WIDTH, EXT.zMin, eastW, northD],
    [-EXT.xHalf, ROAD_HALF_WIDTH, westW, southD],
    [ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, eastW, southD],
  ] as Array<[number, number, number, number]>) {
    ctx.fillRect(cx(x), cy(z), toPx(w), toPx(d));
  }
  ctx.restore();
}

function drawLaneMarkings(ctx: CanvasRenderingContext2D, schoolZone: boolean): void {
  ctx.save();

  // 중앙선 (황색 실선 2줄) — 남북 도로
  ctx.strokeStyle = '#f0c419';
  ctx.lineWidth = toPx(0.15);
  for (const off of [-0.12, 0.12]) {
    for (const [z0, z1] of [
      [EXT.zMin, -ROAD_HALF_WIDTH],
      [ROAD_HALF_WIDTH, EXT.zMax],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx(off), cy(z0));
      ctx.lineTo(cx(off), cy(z1));
      ctx.stroke();
    }
  }
  // 중앙선 — 동서 도로
  for (const off of [-0.12, 0.12]) {
    for (const [x0, x1] of [
      [-EXT.xHalf, -ROAD_HALF_WIDTH],
      [ROAD_HALF_WIDTH, EXT.xHalf],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx(x0), cy(off));
      ctx.lineTo(cx(x1), cy(off));
      ctx.stroke();
    }
  }

  // 차로 구분선 (백색 점선)
  ctx.strokeStyle = '#e9e9e9';
  ctx.lineWidth = toPx(0.12);
  ctx.setLineDash([toPx(3), toPx(5)]);
  for (const off of [-LANE_WIDTH, LANE_WIDTH]) {
    // 노면 문자는 차도 폭을 가로로 채우므로 그 구간에서는 북행 차로 구분선을 끊는다.
    // 점선이 글자 한가운데를 세로로 관통하면 글자가 갈라져 읽히지 않는다.
    const zRanges =
      schoolZone && off > 0
        ? [
            [EXT.zMin, -ROAD_HALF_WIDTH],
            [ROAD_HALF_WIDTH, SCHOOL_MARK_Z[0]],
            [SCHOOL_MARK_Z[1], EXT.zMax],
          ]
        : [
            [EXT.zMin, -ROAD_HALF_WIDTH],
            [ROAD_HALF_WIDTH, EXT.zMax],
          ];
    for (const [z0, z1] of zRanges) {
      ctx.beginPath();
      ctx.moveTo(cx(off), cy(z0));
      ctx.lineTo(cx(off), cy(z1));
      ctx.stroke();
    }
    for (const [x0, x1] of [
      [-EXT.xHalf, -ROAD_HALF_WIDTH],
      [ROAD_HALF_WIDTH, EXT.xHalf],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx(x0), cy(off));
      ctx.lineTo(cx(x1), cy(off));
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // 도로 가장자리선 (백색 실선)
  ctx.strokeStyle = '#dedede';
  ctx.lineWidth = toPx(0.12);
  const edge = ROAD_HALF_WIDTH - 0.25;
  for (const off of [-edge, edge]) {
    for (const [z0, z1] of [
      [EXT.zMin, -ROAD_HALF_WIDTH],
      [ROAD_HALF_WIDTH, EXT.zMax],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx(off), cy(z0));
      ctx.lineTo(cx(off), cy(z1));
      ctx.stroke();
    }
    for (const [x0, x1] of [
      [-EXT.xHalf, -ROAD_HALF_WIDTH],
      [ROAD_HALF_WIDTH, EXT.xHalf],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx(x0), cy(off));
      ctx.lineTo(cx(x1), cy(off));
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * 횡단보도 4개. 실제 규격에 맞춰 폭 4m, 흰 띠 45cm, 간격 45cm로 그린다.
 * 띠는 도로를 가로지르는 방향으로 늘어선다.
 */
function drawCrosswalks(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = '#f2f2f2';
  const stripe = 0.45;
  const gap = 0.45;

  // 남·북 (남북 도로를 가로지름 — 띠가 z 방향으로 길다)
  for (const sign of [1, -1]) {
    const z0 = sign > 0 ? CROSSWALK_INNER : -CROSSWALK_OUTER;
    for (let x = -ROAD_HALF_WIDTH + 0.3; x < ROAD_HALF_WIDTH - 0.3; x += stripe + gap) {
      ctx.fillRect(cx(x), cy(z0), toPx(stripe), toPx(CROSSWALK_OUTER - CROSSWALK_INNER));
    }
  }
  // 동·서 (동서 도로를 가로지름 — 띠가 x 방향으로 길다)
  for (const sign of [1, -1]) {
    const x0 = sign > 0 ? CROSSWALK_INNER : -CROSSWALK_OUTER;
    for (let z = -ROAD_HALF_WIDTH + 0.3; z < ROAD_HALF_WIDTH - 0.3; z += stripe + gap) {
      ctx.fillRect(cx(x0), cy(z), toPx(CROSSWALK_OUTER - CROSSWALK_INNER), toPx(stripe));
    }
  }
  ctx.restore();
}

/** 정지선 — 진행 방향 차로 쪽에만 그린다 (폭 40cm) */
function drawStopLines(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = '#fbfbfb';
  const w = 0.6;

  // 남쪽 접근(북행 차로: x ∈ [0, ROAD_HALF])
  ctx.fillRect(cx(0.15), cy(STOP_LINE), toPx(ROAD_HALF_WIDTH - 0.4), toPx(w));
  // 북쪽 접근(남행 차로: x ∈ [-ROAD_HALF, 0])
  ctx.fillRect(cx(-ROAD_HALF_WIDTH + 0.25), cy(-STOP_LINE - w), toPx(ROAD_HALF_WIDTH - 0.4), toPx(w));
  // 서쪽 접근(동행 차로: z ∈ [0, ROAD_HALF])
  ctx.fillRect(cx(-STOP_LINE - w), cy(0.15), toPx(w), toPx(ROAD_HALF_WIDTH - 0.4));
  // 동쪽 접근(서행 차로: z ∈ [-ROAD_HALF, 0])
  ctx.fillRect(cx(STOP_LINE), cy(-ROAD_HALF_WIDTH + 0.25), toPx(w), toPx(ROAD_HALF_WIDTH - 0.4));
  ctx.restore();
}

/**
 * 노면 문자표시.
 *
 * 실제 도로표시는 **글자를 가로로 한 줄에 늘어놓고**(운전자가 왼→오른쪽으로 읽는다),
 * 대신 낮은 시점에서 납작하게 찌그러져 보이지 않도록 **진행 방향으로 길쭉하게** 늘려
 * 그린다. 위에서 내려다보면 세로로 늘어난 글자지만, 운전석 높이에서는 원근 때문에
 * 눌려서 정상 비율로 읽힌다.
 *
 * 글자를 진행 방향으로 한 자씩 쌓으면(예전 방식) 위에서 볼 때는 멀쩡해 보여도
 * 실제 도로에는 없는 표시가 되고, 운전자에게는 글자가 눕혀진 것처럼 보인다.
 *
 * 한 줄이 차도 폭(약 9.3m)을 넘지 않도록 글자 폭·간격을 잡는다. 일곱 글자짜리
 * '어린이보호구역'은 그래서 '어린이' / '보호구역' 두 줄로 나눈다.
 */
function drawRoadTextRow(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  z: number,
  charW = 1.32,
  charH = 3.2,
  gap = 0.15,
): void {
  const chars = [...text];
  const total = chars.length * charW + (chars.length - 1) * gap;
  const left = centerX - total / 2 + charW / 2;

  ctx.save();
  ctx.fillStyle = '#f4f4f4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${toPx(charW)}px sans-serif`;

  chars.forEach((ch, i) => {
    ctx.save();
    ctx.translate(cx(left + i * (charW + gap)), cy(z));
    ctx.scale(1, charH / charW); // 폭 기준 글꼴을 진행 방향으로 늘린다
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

/** 노면 화살표 — 플레이어 진입 차로(북행 2차로)에 우회전 표시 */
function drawRoadArrows(ctx: CanvasRenderingContext2D, schoolZone: boolean): void {
  ctx.save();
  ctx.fillStyle = '#ededed';

  const drawRightArrow = (worldX: number, worldZ: number) => {
    ctx.save();
    ctx.translate(cx(worldX), cy(worldZ));
    const s = EXT.pxPerM;
    // 세로 축 (아래에서 위로)
    ctx.fillRect(-0.22 * s, -1.6 * s, 0.44 * s, 3.2 * s);
    // 오른쪽으로 꺾이는 가로 축
    ctx.fillRect(-0.22 * s, -1.6 * s, 1.5 * s, 0.44 * s);
    // 화살촉
    ctx.beginPath();
    ctx.moveTo(1.28 * s, -2.35 * s);
    ctx.lineTo(2.35 * s, -1.38 * s);
    ctx.lineTo(1.28 * s, -0.42 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // 진입 차로에 두 번 반복해서 표시 (실제 도로처럼).
  // 어린이보호구역에서는 그 자리에 노면 문자가 들어가므로 앞쪽 하나만 남긴다.
  drawRightArrow(PLAYER_APPROACH_X, 18);
  if (!schoolZone) drawRightArrow(PLAYER_APPROACH_X, 30);

  // 직진 화살표 — 1차로
  const drawStraight = (worldX: number, worldZ: number) => {
    ctx.save();
    ctx.translate(cx(worldX), cy(worldZ));
    const s = EXT.pxPerM;
    ctx.fillRect(-0.22 * s, -1.6 * s, 0.44 * s, 3.2 * s);
    ctx.beginPath();
    ctx.moveTo(-0.95 * s, -1.3 * s);
    ctx.lineTo(0, -2.5 * s);
    ctx.lineTo(0.95 * s, -1.3 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  drawStraight(LANE_1_OFFSET, 18);
  if (!schoolZone) drawStraight(LANE_1_OFFSET, 30);

  ctx.restore();
}

/**
 * 속도제한 노면표시 — 흰 타원 안에 숫자.
 * 낮은 시점에서 정원(正圓)으로 보이도록 진행 방향으로 늘려 그린다.
 */
function drawSpeedLimitMark(
  ctx: CanvasRenderingContext2D,
  speed: number,
  x: number,
  z: number,
  diameter: number,
): void {
  ctx.save();
  ctx.translate(cx(x), cy(z));
  ctx.scale(1, 1.4);
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = toPx(0.24);
  ctx.beginPath();
  ctx.arc(0, 0, toPx(diameter / 2), 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4f4f4';
  ctx.font = `bold ${toPx(diameter * 0.58)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(speed), 0, 0);
  ctx.restore();
}

/**
 * 어린이보호구역 노면표시.
 *
 * 실제 표시를 그대로 따른다 — 적색 노면 포장 위에 '어린이' / '보호구역' 두 줄과
 * 흰 원 안의 속도제한 '30'. 세 표시를 진행 방향으로 나란히 놓고, 각 줄은 차도 폭에
 * 가로로 채운다. 운전자가 먼저 만나는 것이 첫 줄이다.
 */
/** 적색 포장이 덮는 북행 차도 (x: PAINT_X0 ~ PAINT_X0+PAINT_W) */
const PAINT_X0 = 0.2;
const PAINT_W = ROAD_HALF_WIDTH - 0.5;

/** 적색 노면 포장 — 차선보다 먼저 깔아야 차선이 그 위에 보인다 */
/**
 * 붉은 노면.
 *
 * **한 번에 칠한다.** 교차로 보호구역(`isSchoolZone`)과 진입부 보호구역(`approachZone`)이
 * 둘 다 켜지면 z 구간이 겹치는데, 따로 칠하면 겹친 자리만 두 번 얹혀 진해진다
 * (알파 0.58 이 두 겹이면 0.82). 그래서 **북행 차도는 두 구간의 합집합을 한 번** 칠한다.
 *
 * 진출 차도(우회전 뒤)는 교차로 보호구역일 때만이다 — 진입부 구간은 오는 길에 있고
 * 나가는 길과는 상관이 없다.
 */
function drawSchoolZonePavement(
  ctx: CanvasRenderingContext2D,
  schoolZone: boolean,
  approachZone: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = 0.58;
  ctx.fillStyle = '#a8322c';

  // 북행 차도 — 두 구간의 합집합 (z 가 큰 쪽이 남쪽 = 먼저 만나는 쪽)
  const far = Math.max(
    schoolZone ? STOP_LINE + 32 : -Infinity,
    approachZone ? APPROACH_ZONE_FAR_Z : -Infinity,
  );
  const near = Math.min(
    schoolZone ? STOP_LINE : Infinity,
    approachZone ? APPROACH_ZONE_NEAR_Z : Infinity,
  );
  if (Number.isFinite(far) && Number.isFinite(near)) {
    ctx.fillRect(cx(PAINT_X0), cy(near), toPx(PAINT_W), toPx(far - near));
  }

  // 진출 차도 — 교차로가 보호구역일 때만
  if (schoolZone) {
    ctx.fillRect(cx(CROSSWALK_OUTER), cy(PAINT_X0), toPx(32), toPx(PAINT_W));
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * 진입부 보호구역 — 노면 문자 · 정지선 · 횡단보도.
 *
 * 배치는 **운전석에서 읽히는 순서**다. z 가 클수록 남쪽(먼저 만난다)이므로
 * 문자(108 → 97) → 정지선(72) → 횡단보도(70~66) 로 내려온다.
 */
function drawApproachZone(ctx: CanvasRenderingContext2D): void {
  const MID_X = PAINT_X0 + PAINT_W / 2;
  /*
    구간에 들어서자마자 읽히도록 시작선 바로 뒤에 둔다 — 횡단보도까지 30m 가 남는다.
    **시작선에서 잰다.** 절대 좌표로 적어 두었더니 구간을 20m 옮길 때 글자만 제자리에 남아
    보호구역 밖 회색 노면에 '어린이' 가 찍힐 뻔했다.
  */
  drawRoadTextRow(ctx, '어린이', MID_X, APPROACH_ZONE_FAR_Z - 6.0);
  drawRoadTextRow(ctx, '보호구역', MID_X, APPROACH_ZONE_FAR_Z - 11.5);
  drawSpeedLimitMark(ctx, 30, MID_X, APPROACH_ZONE_FAR_Z - 17.0, 3.0);

  // 정지선 — 교차로 정지선과 같은 굵기·색
  ctx.fillStyle = '#f4f4f4';
  const w = 0.4;
  ctx.fillRect(cx(0.15), cy(STOP_LINE_S), toPx(ROAD_HALF_WIDTH - 0.4), toPx(w));

  // 횡단보도 — 남북 도로를 가로지르므로 A 와 같은 모양이다
  ctx.fillStyle = '#f2f2f2';
  const stripe = 0.5;
  const gap = 0.5;
  for (let x = -ROAD_HALF_WIDTH + 0.4; x < ROAD_HALF_WIDTH - 0.4; x += stripe + gap) {
    ctx.fillRect(cx(x), cy(CROSSWALK_S_INNER), toPx(stripe), toPx(CROSSWALK_WIDTH));
  }
}

/** 노면 문자와 속도표시 — 차선 위에 얹는다 */
function drawSchoolZoneMarks(ctx: CanvasRenderingContext2D): void {
  // 적색 포장의 한가운데를 기준으로 가로로 채운다.
  // (네 글자 '보호구역' = 5.7m 로, 포장 폭 9.3m 안에 들어간다)
  const MID_X = PAINT_X0 + PAINT_W / 2;

  // 배치 순서는 **운전석에서 보이는 순서**로 잡는다.
  // 운전자 시야에서는 먼 것이 위, 가까운 것이 아래에 놓이므로
  // 먼 쪽부터 '어린이' → '보호구역' → '30' 이라야 위에서 아래로 한 문장처럼 읽힌다.
  // (z 가 작을수록 멀다. 반대로 두면 화면에 '30 / 보호구역 / 어린이' 로 거꾸로 읽힌다)
  drawRoadTextRow(ctx, '어린이', MID_X, 32.5);
  drawRoadTextRow(ctx, '보호구역', MID_X, 38.0);
  drawSpeedLimitMark(ctx, 30, MID_X, 42.5, 3.0);
}

function makeRoadTexture(schoolZone: boolean, approachZone: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;

  drawAsphalt(ctx);
  drawOffRoad(ctx);
  if (schoolZone || approachZone) drawSchoolZonePavement(ctx, schoolZone, approachZone);
  drawLaneMarkings(ctx, schoolZone);
  if (schoolZone) drawSchoolZoneMarks(ctx);
  /*
    진입부 구간의 노면 문자·정지선·횡단보도. **구간에 들어서자마자 읽히도록** 문자를
    앞쪽(z 68~57)에 둔다 — 횡단보도(z 46~50)에 닿기 전에 "여기가 보호구역" 을 알아야
    한다. 교차로 쪽 문자(z 32~43)는 이미 그 안쪽에 있다.
  */
  if (approachZone) drawApproachZone(ctx);
  drawRoadArrows(ctx, schoolZone);
  drawCrosswalks(ctx);
  drawStopLines(ctx);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 창문 패턴이 있는 건물 텍스처 — 야간에 불이 켜진 느낌을 낸다 */
function makeBuildingTexture(night: boolean): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const base = night ? '#1a1c24' : '#8b8d96';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  const cols = 6;
  const rows = 16;
  const mw = W / cols;
  const mh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = Math.random() < (night ? 0.45 : 0.1);
      ctx.fillStyle = night
        ? lit
          ? `rgba(255, 226, 150, ${0.7 + Math.random() * 0.3})`
          : '#0e1016'
        : lit
          ? '#5a6070'
          : '#6f7480';
      ctx.fillRect(c * mw + mw * 0.18, r * mh + mh * 0.2, mw * 0.64, mh * 0.55);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface IntersectionOptions {
  schoolZone: boolean;
  /** 교차로에 닿기 전 지나는 어린이보호구역 구간이 있는가 */
  approachZone?: boolean;
  night: boolean;
}

export class Intersection {
  readonly group = new THREE.Group();
  private disposables: Array<{ dispose(): void }> = [];

  constructor(opts: IntersectionOptions) {
    /*
      **범위부터 정한다.** 노면·보도·판 크기가 모두 이 값을 따른다 — 진입부 보호구역이
      있는 판은 출발 지점이 112m 라 훨씬 넓게 덮어야 하고, 없는 판은 좁게 덮어 또렷하게 둔다.
    */
    setRoadExtent(opts.approachZone ?? false);
    this.buildRoad(opts.schoolZone, opts.approachZone ?? false);
    this.buildSidewalks();
    this.buildBuildings(opts.night);
    this.buildStreetFurniture();
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private buildRoad(schoolZone: boolean, approachZone: boolean): void {
    const tex = this.track(makeRoadTexture(schoolZone, approachZone));
    /*
      **판이 정사각형이 아니다.** 텍스처가 덮는 세계 범위를 그대로 따른다 —
      남쪽(플레이어가 오는 쪽)이 길고 북쪽은 배경으로 보이는 만큼뿐이다.
      원점 중심이 아니므로 판도 그만큼 남쪽으로 옮겨 놓는다.
    */
    const geo = this.track(
      new THREE.PlaneGeometry(EXT.xHalf * 2, EXT.zMax - EXT.zMin),
    );
    const mat = this.track(
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0 }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.z = (EXT.zMin + EXT.zMax) / 2;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    /*
      텍스처 범위 밖까지 이어지는 넓은 바닥 (지평선 처리).

      **노면보다 넉넉해야 한다.** 진입부 보호구역 판은 노면이 남쪽 320m 까지 가는데,
      600×600(±300) 으로 두면 그 끝이 바닥보다 튀어나와 뒤를 볼 때 허공이 보인다.
    */
    const farGeo = this.track(new THREE.PlaneGeometry(1000, 1000));
    const farMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 1 }));
    const far = new THREE.Mesh(farGeo, farMat);
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.02;
    // 노면과 같은 자리를 중심으로 — 노면이 남쪽으로 치우쳐 있다
    far.position.z = (EXT.zMin + EXT.zMax) / 2;
    this.group.add(far);
  }

  /** 보도 — 도로 가장자리보다 15cm 높은 연석 */
  private buildSidewalks(): void {
    const H = 0.15;
    const geo = this.track(new THREE.BoxGeometry(1, 1, 1));
    const mat = this.track(new THREE.MeshStandardMaterial({ color: 0xa9a9a4, roughness: 0.85 }));
    const curbMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xcfcfc8, roughness: 0.8 }),
    );

    const width = SIDEWALK_OUTER - ROAD_HALF_WIDTH;
    /*
      **팔 길이가 방향마다 다르다.** 노면이 정사각형이 아니게 되면서(EXT) 보도도 그
      끝까지 따라가야 한다 — 한 값으로 두면 남쪽 도로는 보도 없이 뻗고, 북쪽은 도로가
      끝난 자리에 보도만 떠 있게 된다.
    */
    const armX = EXT.xHalf - SIDEWALK_OUTER;
    const armZ = (sz: number): number =>
      (sz > 0 ? EXT.zMax : -EXT.zMin) - SIDEWALK_OUTER;

    // 네 모서리의 ㄱ자 보도 블록 + 도로를 따라 길게 뻗는 보도
    const place = (
      w: number,
      d: number,
      x: number,
      z: number,
      m: THREE.Material,
      h = H,
    ) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, h / 2, z);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };

    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        // 모서리 블록
        const cSize = SIDEWALK_OUTER;
        place(
          cSize - ROAD_HALF_WIDTH,
          cSize - ROAD_HALF_WIDTH,
          sx * (ROAD_HALF_WIDTH + width / 2),
          sz * (ROAD_HALF_WIDTH + width / 2),
          mat,
        );
        // 남북 도로를 따라가는 보도 — 남쪽이 길다
        place(
          width,
          armZ(sz),
          sx * (ROAD_HALF_WIDTH + width / 2),
          sz * (SIDEWALK_OUTER + armZ(sz) / 2),
          mat,
        );
        // 동서 도로를 따라가는 보도
        place(
          armX,
          width,
          sx * (SIDEWALK_OUTER + armX / 2),
          sz * (ROAD_HALF_WIDTH + width / 2),
          mat,
        );
      }
    }

    // 연석 라인 (보도 가장자리 밝은 띠)
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        place(
          0.25,
          armZ(sz) + 6,
          sx * ROAD_HALF_WIDTH,
          sz * (SIDEWALK_OUTER + armZ(sz) / 2 - 3),
          curbMat,
          H + 0.01,
        );
        place(
          armX + 6,
          0.25,
          sx * (SIDEWALK_OUTER + armX / 2 - 3),
          sz * ROAD_HALF_WIDTH,
          curbMat,
          H + 0.01,
        );
      }
    }
  }

  /** 배경 건물 — 운전 시점에서 거리감과 도심 느낌을 준다 */
  private buildBuildings(night: boolean): void {
    const tex = this.track(makeBuildingTexture(night));
    const geo = this.track(new THREE.BoxGeometry(1, 1, 1));
    const mat = this.track(
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.9,
        emissive: night ? 0x1b1a14 : 0x000000,
        emissiveMap: night ? tex : null,
        emissiveIntensity: night ? 1.1 : 0,
      }),
    );

    // 결정론적 난수 — 매 판마다 도시 모양이 달라지면 산만하다
    let seed = 20230122;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        for (let i = 0; i < 14; i++) {
          const w = 8 + rand() * 14;
          const d = 8 + rand() * 14;
          const h = 10 + rand() * 45;
          // 중심이 아니라 '가까운 면'이 보도 바깥에 오도록 배치한다.
          // 반폭을 더하지 않으면 큰 건물이 도로 위까지 밀고 들어온다.
          const x = sx * (SIDEWALK_OUTER + 3 + w / 2 + rand() * 44);
          const z = sz * (SIDEWALK_OUTER + 3 + d / 2 + rand() * 44);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.scale.set(w, h, d);
          mesh.position.set(x, h / 2, z);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);
        }
      }
    }
  }

  /** 가로등·가로수 — 야간 조명과 스케일감 */
  private buildStreetFurniture(): void {
    const poleGeo = this.track(new THREE.CylinderGeometry(0.09, 0.11, 8, 8));
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.6, metalness: 0.5 }));
    const armGeo = this.track(new THREE.BoxGeometry(2.2, 0.12, 0.12));
    const lampGeo = this.track(new THREE.BoxGeometry(0.9, 0.16, 0.4));
    const lampMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffe9b0, emissiveIntensity: 1.4 }),
    );

    const positions: Array<[number, number, number]> = [];
    for (const sx of [1, -1]) {
      for (const z of [20, 38, 56]) {
        positions.push([sx * (ROAD_HALF_WIDTH + 1.2), z, sx > 0 ? -1 : 1]);
        positions.push([sx * (ROAD_HALF_WIDTH + 1.2), -z, sx > 0 ? -1 : 1]);
      }
    }
    for (const [x, z, dir] of positions) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 4.15, z);
      this.group.add(pole);

      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.position.set(x + dir * 1.1, 8.0, z);
      this.group.add(arm);

      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x + dir * 2.1, 7.9, z);
      this.group.add(lamp);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.group.clear();
  }
}
