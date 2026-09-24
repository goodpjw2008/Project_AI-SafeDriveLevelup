/**
 * 손에 든 세로 화면의 첫 화면 — **무엇을 접고, 무엇을 남기는가.**
 *
 * PC 에서는 첫 화면이 한 번에 들어오지만 세로 휴대폰에서는 연습 버튼까지 내려가야 했다.
 * 사용자가 정했다 — 세로 휴대폰에서는 *지금 할 것*(레벨 · 차 · 연습 버튼)만 남기고
 * 둘러보는 것들은 접는다. 그리고 **PC 는 건드리지 않는다.**
 *
 * 이 결정은 `src/index.html` 의 미디어 쿼리 한 덩어리에 들어 있다. 규칙이 흩어지거나
 * 조건이 느슨해지면(예: `pointer: coarse` 가 빠지면) **창을 좁힌 PC 에서도 메뉴가 사라진다.**
 * 그래서 소스에서 그 덩어리를 읽어 조건과 목록을 그대로 못 박는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');

/** 세로 휴대폰 전용 덩어리 — 여는 중괄호부터 짝이 맞는 닫는 중괄호까지 */
const mobileBlock = (): string => {
  const head = '@media (orientation: portrait) and (pointer: coarse) and (max-width: 720px) {';
  const at = html.indexOf(head);
  if (at < 0) throw new Error('세로 휴대폰 전용 미디어 쿼리를 찾지 못했다');
  let depth = 0;
  for (let i = at + head.length - 1; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(at, i + 1);
  }
  throw new Error('미디어 쿼리가 닫히지 않았다');
};

/** 주석을 걷어낸 규칙만 — 주석에 적은 설명("차 그림(.ai-car)은 남긴다")이 검사에 걸리면 안 된다 */
const rulesOnly = (): string => mobileBlock().replace(/\/\*[\s\S]*?\*\//g, '');

describe('세로 휴대폰의 첫 화면', () => {
  /*
    **세 가지가 모두 맞을 때만 걸린다** — 세로 · 손가락 · 좁은 화면.
    `pointer: coarse` 가 PC 를 지켜 준다: 창을 아무리 좁혀도 마우스는 coarse 가 아니다.
  */
  it('조건이 셋 다 붙어 있다 — 하나라도 빠지면 PC 가 휩쓸린다', () => {
    const block = mobileBlock();
    expect(block).toContain('orientation: portrait');
    expect(block).toContain('pointer: coarse');
    expect(block).toContain('max-width: 720px');
  });

  it('둘러보는 메뉴 넷을 접는다', () => {
    const block = mobileBlock();
    for (const id of ['#btn-shop', '#btn-about', '#btn-credits', '#btn-trial']) {
      expect(block).toContain(`.menu-links ${id}`);
    }
  });

  /* 배우는 글 둘과 설정은 남는다 — 여기서 규칙을 확인하고, 설정으로 갈래를 고른다 */
  it('배우는 글과 설정은 접지 않는다', () => {
    const block = rulesOnly();
    for (const id of ['#btn-help', '#btn-zone-help', '#btn-settings']) {
      expect(block).not.toContain(id);
    }
  });

  it('뱃지 요약 · 나쁜 운전 습관 · 오프라인 교육 활용을 접는다', () => {
    const block = mobileBlock();
    expect(block).toContain('.badge-summary');
    expect(block).toContain('.ai-habits');
    expect(block).toContain('.mode-split > .mode-group:nth-child(2)');
  });

  /*
    **차 그림은 남긴다.** 차가 레벨의 얼굴이라, 습관 칸을 접으면서 차까지 접으면
    "왜 레벨을 올리는가" 가 화면에서 사라진다 (사용자가 짚었다: "차량은 보여야 해").
  */
  it('차 그림과 온라인 연습은 남긴다', () => {
    const block = rulesOnly();
    expect(block).not.toContain('.ai-car');
    expect(block).not.toContain('nth-child(1)');
  });

  /* 좁은 폭에서 오른쪽에 붙으면 한쪽만 차 보인다 — 가운데로 모은다 */
  it('사이트 전체 성공 · 실패는 가운데로 모은다', () => {
    expect(mobileBlock()).toMatch(/\.site-stats\s*\{\s*justify-content:\s*center;/);
  });

  /*
    **덩어리는 스타일의 맨 뒤에 선다.** `.badge-summary` 처럼 기본 규칙이 뒤쪽에 있는 칸이
    있어서, 앞에 두면 우선순위가 같아 순서로 져 접히지 않는다 — 실제로 한 번 그랬다.
  */
  it('스타일시트의 맨 뒤에 있다 — 앞에 두면 뒤쪽 기본 규칙에 진다', () => {
    const at = html.indexOf('@media (orientation: portrait) and (pointer: coarse)');
    expect(html.slice(at).indexOf('.badge-summary {')).toBeGreaterThan(-1);
    // 이 덩어리 뒤로는 다른 규칙이 남아 있지 않다
    const after = html.slice(at + mobileBlock().length, html.indexOf('</style>', at));
    expect(after.trim()).toBe('');
  });
});
