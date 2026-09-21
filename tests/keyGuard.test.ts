/**
 * **화면의 글을 복사할 수 있는가** — 조작 키 처리기가 브라우저 단축키를 먹지 않는지.
 *
 * 조작 키 처리기는 `window` 에 걸려 있고 게임이 켜져 있는 동안 늘 살아 있다. 그런데
 * `KeyC`(시점 바꾸기)에서 `preventDefault` 를 부르는 탓에 **Ctrl+C · ⌘C 가 통째로
 * 먹혔다** — 첫 화면에서도, 도움말에서도, 저작권 화면에서도 글을 복사할 수 없었다.
 *
 * 이 화면은 3D 위에 덮여 있어 문서처럼 안 보이지만 적힌 것은 대부분 읽으라고 쓴 글이다.
 * 조작 키 하나를 늘릴 때마다 브라우저 단축키 하나를 먹을 수 있으므로 여기 못 박아 둔다.
 */

import { describe, expect, it } from 'vitest';
import { leaveToBrowser } from '../src/game/Controls';

describe('브라우저에게 넘길 입력', () => {
  it.each([
    ['Ctrl+C (복사)', { ctrlKey: true }],
    ['⌘C (복사 · macOS)', { metaKey: true }],
    ['Ctrl+R (새로고침)', { ctrlKey: true }],
    ['Ctrl+A (전체 선택)', { ctrlKey: true }],
    ['Alt+← (뒤로)', { altKey: true }],
  ])('%s 는 넘긴다', (_name, e) => {
    expect(leaveToBrowser(e)).toBe(true);
  });

  it('조합키 없는 조작 키는 우리가 받는다', () => {
    expect(leaveToBrowser({})).toBe(false);
    expect(leaveToBrowser({ ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });

  /*
    지금은 글을 쓰는 칸이 없다(사진은 파일 선택이다). 생기는 날 이 처리기가 타이핑을
    먹는데, 그때 원인을 찾기는 어렵다 — 미리 막아 둔다.
  */
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('%s 안에서는 물러난다', (tagName) => {
    expect(leaveToBrowser({ target: { tagName } })).toBe(true);
  });

  it('편집 가능한 곳에서도 물러난다', () => {
    expect(leaveToBrowser({ target: { isContentEditable: true, tagName: 'DIV' } })).toBe(true);
  });

  it('평범한 요소 위에서는 우리가 받는다', () => {
    expect(leaveToBrowser({ target: { tagName: 'DIV' } })).toBe(false);
    expect(leaveToBrowser({ target: { tagName: 'BUTTON' } })).toBe(false);
  });

  it('target 이 없어도 터지지 않는다', () => {
    expect(leaveToBrowser({ target: null })).toBe(false);
  });
});
