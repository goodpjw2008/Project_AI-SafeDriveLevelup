/**
 * 화면 위에 겹치는 패널들의 테두리 텍스처.
 *
 * 좌·우 시야 창은 화면에 겹치는 계기다. 3D 차체에 붙은 거울과 성격이 다르다는 것이
 * 생김새로 드러나야 한다.
 *
 *  - 시야 창 : 계기처럼 **얇은 밝은 테두리와 모서리 표식**만.
 *              거울은 3D 차체에 실제로 붙어 있으므로(CarMesh), 이 창이 거울처럼 보이면 안 된다.
 *
 * 모두 캔버스에 그려 텍스처로 굽는다. 가운데는 뚫어 두므로(destination-out) 영상 위에 얹으면
 * 테두리만 보인다.
 */

import * as THREE from 'three';

/** 시야 창 테두리 두께 (패널 세로 크기 대비) — 거울보다 훨씬 얇다 */
export const HUD_BORDER_FRAC = 0.035;

type Radii = { tl: number; tr: number; br: number; bl: number };

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: Radii,
): void {
  const lim = Math.min(w, h) / 2;
  const tl = Math.min(r.tl, lim);
  const tr = Math.min(r.tr, lim);
  const br = Math.min(r.br, lim);
  const bl = Math.min(r.bl, lim);
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * 패널 바깥 상자의 크기를 구한다.
 * 테두리는 패널 세로 크기에 비례하므로, 가로세로 어느 쪽에도 같은 두께로 둘러진다.
 */
export function borderBox(panelAspect: number, borderFrac: number): {
  /** 테두리 두께 (패널 가로 크기 대비) */
  thickness: number;
  /** 바깥 상자 가로 (패널 가로 대비) */
  outerW: number;
  /** 바깥 상자 세로 (패널 가로 대비) */
  outerH: number;
} {
  const thickness = borderFrac * panelAspect;
  return {
    thickness,
    outerW: 1 + thickness * 2,
    outerH: panelAspect + thickness * 2,
  };
}

/**
 * 좌·우 시야 창의 테두리.
 * 거울과 달리 하우징이 없다 — 얇은 밝은 선과 모서리 표식만 있는 계기 창이다.
 */
export function makeHudFrameTexture(panelAspect: number): THREE.CanvasTexture {
  const box = borderBox(panelAspect, HUD_BORDER_FRAC);
  const W = 640;
  const H = Math.max(2, Math.round((W * box.outerH) / box.outerW));
  const b = (W * box.thickness) / box.outerW;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const r: Radii = { tl: b * 2.2, tr: b * 2.2, br: b * 2.2, bl: b * 2.2 };
  const x = b / 2;
  const y = b / 2;
  const w = W - b;
  const h = H - b;

  // 밝은 배경 위에서도 선이 보이도록 어두운 선을 깔고 그 위에 밝은 선을 얹는다
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = b * 1.9;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(196,212,236,0.62)';
  ctx.lineWidth = b;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();

  // 모서리 표식 — 계기 창이라는 신호
  ctx.strokeStyle = 'rgba(150,190,255,0.95)';
  ctx.lineWidth = b * 1.7;
  ctx.lineCap = 'round';
  const len = W * 0.075;
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const cxp = sx > 0 ? x + r.tl * 0.5 : x + w - r.tl * 0.5;
      const cyp = sy > 0 ? y + r.tl * 0.5 : y + h - r.tl * 0.5;
      ctx.beginPath();
      ctx.moveTo(cxp + sx * len, cyp);
      ctx.lineTo(cxp, cyp);
      ctx.lineTo(cxp, cyp + sy * len);
      ctx.stroke();
    }
  }

  return texture(canvas);
}

/** 패널 이름표 — 이게 무슨 화면인지 모르면 보지 않는다 */
export const CAPTION_SIZE = { w: 256, h: 56 };

export function makeCaptionTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CAPTION_SIZE.w;
  canvas.height = CAPTION_SIZE.h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(11, 13, 18, 0.85)';
  roundRectPath(ctx, 0, 0, canvas.width, canvas.height, {
    tl: 14,
    tr: 14,
    br: 14,
    bl: 14,
  });
  ctx.fill();
  ctx.fillStyle = '#c9d3e4';
  ctx.font = '700 30px system-ui, -apple-system, "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  return texture(canvas);
}
