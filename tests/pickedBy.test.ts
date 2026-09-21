/**
 * **누가 이 맵을 골랐는가** (ui/pickedBy.ts) — 추천 카드와 주행 화면이 같은 규칙으로 말한다.
 *
 * AI 활용 공모전 작품이라 AI 가 한 일은 고를 때만이 아니라 **달리는 동안에도** 보여야 한다는 사용자 요청으로
 * 주행 화면 첫 줄이 생겼다. 여기서 못 박는 것은 하나다 — **고르지도 않은 AI 의 이름을 띄우지 않는다.**
 */
import { describe, expect, it } from 'vitest';

import { advisedBy, analyzingBy, pickedByCard, pickedByHud } from '../src/ui/pickedBy';

describe('추천 카드의 한 줄', () => {
  it('AI 가 골랐으면 회사와 모델 이름을 적는다', () => {
    const line = pickedByCard('gemini', 'gemini-3.1-flash-lite');
    expect(line).toContain('Gemini');
    expect(line).toContain('gemini-3.1-flash-lite');
    expect(line).toContain('골라 줬어요');
  });

  it('한도를 다 썼으면 그렇게 말한다 — 모델 이름은 쓰지 않는다', () => {
    const line = pickedByCard('quota');
    expect(line).toContain('일일 사용량이 초과됐어요');
    expect(line).toContain('프로그램으로 추천했어요');
  });

  it('고른 쪽이 없으면 줄을 비운다 (손으로 쓴 판 · 시범 주행)', () => {
    expect(pickedByCard(undefined)).toBe('');
    expect(pickedByHud(undefined)).toBe('');
  });
});

describe('주행 화면 첫 줄', () => {
  it('무엇이 분석해서 추천했는지 짧게 적는다', () => {
    const line = pickedByHud('groq', 'qwen/qwen3.8-27b');
    expect(line).toContain('Groq');
    expect(line).toContain('qwen/qwen3.8-27b');
    expect(line).toContain('분석해서 추천해준 맵');
    // 달리면서 읽는 줄이라 문장이 아니라 한 토막이다
    expect(line).not.toContain('이에요');
  });

  it('코드가 고른 판에는 AI 이름도 모델 이름도 없다', () => {
    for (const picker of ['quota', 'rule', 'random'] as const) {
      const line = pickedByHud(picker, '있어서는 안 되는 모델');
      expect(line).not.toContain('있어서는 안 되는 모델');
      expect(line).not.toMatch(/Gemini|Groq|OpenAI|NVIDIA/i);
    }
  });

  it('이름표 클래스에 picker- 를 붙인다 — 앱의 다른 .rule 과 부딪히지 않게', () => {
    expect(pickedByHud('rule')).toContain('picker-chip picker-rule');
    expect(pickedByHud('gemini', 'm')).toContain('picker-chip picker-gemini');
  });

  it('모델 이름은 그대로 싣되 HTML 은 이스케이프한다', () => {
    expect(pickedByHud('gemini', '<script>')).toContain('&lt;script&gt;');
  });
});

/*
  **분석 화면의 제목** — 답이 오는 순간 "Gemini … 모델이 운전 습관을 분석하고 있습니다" 로 바뀐다
  (ui/AiPick.ts 의 setAnalyst). 시작할 때는 어느 자리가 받을지 알 수 없어서 뒤늦게 갈아 끼운다.
*/
describe('분석 화면 제목', () => {
  it('AI 가 답했으면 그 이름과 모델로 바꾼다', () => {
    const line = analyzingBy('gemini', 'gemini-3.1-flash-lite');
    expect(line).toContain('Gemini');
    expect(line).toContain('gemini-3.1-flash-lite');
    expect(line).toContain('운전 습관을 분석하고 있습니다');
  });

  it('코드가 고른 판이면 빈 문자열 — 제목을 건드리지 않는다', () => {
    // 분석한 AI 가 없는데 "분석하고 있습니다" 라고 적으면 거짓말이다
    for (const picker of ['quota', 'rule', 'random'] as const) expect(analyzingBy(picker)).toBe('');
    expect(analyzingBy(undefined)).toBe('');
  });
});

/*
  **결과 화면의 코치 글 · 습관 리포트** — 누가 쓴 글인지 글 아래에 밝힌다 (ui/Screens.ts 의 loadCoaching).
  코치 문장도 추천과 같은 배관을 지나므로 판마다 쓴 AI 가 다르다.
*/
describe('조언한 AI', () => {
  it('회사와 모델 이름을 적는다', () => {
    const line = advisedBy('gemini', 'gemini-3.1-flash-lite');
    expect(line).toContain('Gemini');
    expect(line).toContain('gemini-3.1-flash-lite');
    expect(line).toContain('조언해 준');
  });

  it('AI 가 쓰지 않은 글에는 줄을 붙이지 않는다', () => {
    // 코치 글은 AI 가 쓸 때만 뜨므로, 이름이 없으면 줄도 없다
    expect(advisedBy(undefined)).toBe('');
    for (const picker of ['quota', 'rule', 'random'] as const) expect(advisedBy(picker)).toBe('');
  });
});
