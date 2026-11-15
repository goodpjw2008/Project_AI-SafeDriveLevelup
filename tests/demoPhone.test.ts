/**
 * 시연 휴대폰 (demoPhone.ts) — 마우스 화면의 미디어 조건을 휴대폰(손가락 화면) 쪽으로 바꿔 읽는가. 크기 · 방향 조건은 그대로인가.
 */
import { describe, expect, it } from 'vitest';
import { asPhoneQuery } from '../src/demoPhone';

describe('시연 휴대폰의 미디어 조건', () => {
  it('손가락 조건은 늘 참, 마우스 조건은 늘 거짓으로', () => {
    expect(asPhoneQuery('(pointer: coarse)')).toBe('(min-width: 0px)');
    expect(asPhoneQuery('(hover: hover)')).toBe('(max-width: 0px)');
    expect(asPhoneQuery('(pointer:fine)')).toBe('(max-width: 0px)');
    expect(asPhoneQuery('(hover: none)')).toBe('(min-width: 0px)');
  });

  it('휴대폰 규칙의 크기 · 방향 조건은 남긴다 — 세로 · 가로 휴대폰 규칙이 그대로 갈린다', () => {
    expect(asPhoneQuery('(orientation: portrait) and (pointer: coarse) and (max-width: 720px)')).toBe(
      '(orientation: portrait) and (min-width: 0px) and (max-width: 720px)',
    );
    expect(asPhoneQuery('(prefers-reduced-motion: reduce)')).toBe('(prefers-reduced-motion: reduce)');
  });
});
