/**
 * **개념 레이더** — 학습자 모델(ai/knowledge.ts)의 개념별 실효 숙달을 한 장의 그림으로.
 *
 * 축은 시험된 개념만 세운다 — 시험되지 않은 개념을 0 으로 그리면 "못한다" 로 읽힌다. 축이 셋보다 적으면 그림 대신
 * 줄로 적는다 (다각형이 성립하지 않는다). SVG 라 어떤 크기로 놓아도 흐려지지 않고, 색은 CSS(index.html 의 .skill-radar)가 정한다.
 */

import type { ViolationCode } from '../rules/violations';

export interface RadarAxis {
  code: ViolationCode;
  label: string;
  /** 0~1. null 이면 시험되지 않은 개념 — 축에서 뺀다 */
  p: number | null;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** 축이 셋 이상이면 레이더 SVG, 아니면 빈 문자열 (부르는 쪽이 줄로 적는다) */
export function skillRadar(axes: readonly RadarAxis[], size = 220): string {
  const shown = axes.filter((a): a is RadarAxis & { p: number } => a.p !== null);
  if (shown.length < 3) return '';
  // 좌우 축의 글자('보행자 양보 21%')가 그림 밖으로 잘리지 않게 그림을 옆으로 넓힌다 — 반지름은 높이가 정한다
  const width = Math.round(size * 1.7);
  const cx = width / 2;
  const cy = size / 2;
  const r = size * 0.34;
  const n = shown.length;
  const angle = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, k: number): [number, number] => [cx + Math.cos(angle(i)) * r * k, cy + Math.sin(angle(i)) * r * k];
  const ring = (k: number): string => shown.map((_, i) => point(i, k).map((v) => v.toFixed(1)).join(',')).join(' ');
  const poly = shown.map((a, i) => point(i, Math.max(0.04, a.p)).map((v) => v.toFixed(1)).join(',')).join(' ');
  const spokes = shown
    .map((_, i) => {
      const [x, y] = point(i, 1);
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="radar-spoke" />`;
    })
    .join('');
  const labels = shown
    .map((a, i) => {
      const [x, y] = point(i, 1.32);
      const anchor = Math.abs(x - cx) < 4 ? 'middle' : x < cx ? 'end' : 'start';
      const weak = a.p < 0.7 ? ' weak' : '';
      return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" class="radar-label${weak}">${esc(a.label)} ${Math.round(a.p * 100)}%</text>`;
    })
    .join('');
  const dots = shown
    .map((a, i) => {
      const [x, y] = point(i, Math.max(0.04, a.p));
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="radar-dot${a.p < 0.7 ? ' weak' : ''}" />`;
    })
    .join('');
  return `<svg class="skill-radar" viewBox="0 0 ${width} ${size}" role="img" aria-label="개념별 숙달 레이더">
    <polygon points="${ring(1)}" class="radar-ring" /><polygon points="${ring(0.7)}" class="radar-ring gate" /><polygon points="${ring(0.4)}" class="radar-ring" />
    ${spokes}<polygon points="${poly}" class="radar-area" />${dots}${labels}
  </svg>`;
}
