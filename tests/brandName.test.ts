import { describe, expect, it } from 'vitest';
import { AI_BADGE_HTML, BRAND_CHIPS_HTML, withAiBadge, withBrandChips } from '../src/ui/brandName';
import { APP_ICON_SVG, APP_NAME, APP_NAME_PARTS } from '../src/brand';

/*
  **이름은 어디서나 같은 모양이다** (ui/brandName.ts) — 'AI' 는 배지, '어우참' 은 신호등 딱지 셋.
  사용자가 분석 화면 · 추천 결과 · 말풍선의 '어우참' 도 신호등 색으로, 그리고 AI 공모전 작품이니 'AI' 가 돋보이게 해 달라고 했다.
*/
describe('이름 칠하기', () => {
  it("'AI 어우참' 은 AI 배지 + 딱지 셋", () => {
    expect(withBrandChips('AI 어우참이 후보 10개 중')).toBe(`${AI_BADGE_HTML} ${BRAND_CHIPS_HTML}이 후보 10개 중`);
  });

  it("홀로 선 '어우참' 은 딱지 셋만 — 호칭(어우참 L6)에 AI 배지가 붙지 않는다", () => {
    expect(withBrandChips('어우참 L6')).toBe(`${BRAND_CHIPS_HTML} L6`);
    expect(withBrandChips('어우참 L6')).not.toContain('brand-ai');
  });

  it('이름 조각의 AI 는 배지, 세 글자는 적 · 황 · 녹 차례다', () => {
    expect(APP_NAME).toBe('AI 어우참 안전운전');
    expect(APP_NAME_PARTS.filter((p) => p.tone).map((p) => `${p.text}:${p.tone}`)).toEqual([
      'AI:ai',
      '어:red',
      '우:yellow',
      '참:green',
    ]);
  });
});

/*
  **이름이 아닌 곳의 'AI'** — 결과 화면 · 주행 화면의 판 이름("AI 추천 시나리오 2484")도 같은 배지를 쓴다.
  사용자가 짚었다: "여기의 AI 부분도 타이틀의 예쁜 AI 를 가져다 사용해 줘."
*/
describe('홀로 선 AI 배지', () => {
  it('판 이름의 AI 를 배지로 바꾼다 — 나머지 글자는 그대로', () => {
    expect(withAiBadge('AI 추천 시나리오 2484')).toBe(`${AI_BADGE_HTML} 추천 시나리오 2484`);
    expect(withAiBadge('AI 시범')).toBe(`${AI_BADGE_HTML} 시범`);
  });

  it('AI 가 없는 이름은 건드리지 않는다', () => {
    expect(withAiBadge('Stage 07')).toBe('Stage 07');
  });

  it('낱말 속의 AI 는 바꾸지 않는다 — 배지가 글 한가운데 튀어나오면 읽기 어렵다', () => {
    expect(withAiBadge('RAIN')).toBe('RAIN');
    expect(withAiBadge('AIR')).toBe('AIR');
  });
});

/*
  **탭 아이콘** — 주황 바탕에 '우' 한 글자 (brand.ts 의 APP_ICON_SVG · 사용자가 정했다).
  이름 딱지의 가운데 글자이고, 색도 그 딱지와 같아야 탭과 화면이 같은 것으로 읽힌다.
*/
describe('탭 아이콘', () => {
  it("주황 바탕에 '우' 한 글자다", () => {
    expect(APP_ICON_SVG).toContain('>우<');
    // 딱지의 황색 (index.html 의 .brand-yellow) — 한 글자만 남기므로 그 색이 곧 아이콘의 색이다
    expect(APP_ICON_SVG).toContain('#f2a900');
    expect(APP_ICON_SVG).not.toContain('어');
    expect(APP_ICON_SVG).not.toContain('참');
  });

  it('크기를 타지 않는 SVG 다 — 탭 16px 부터 홈 화면 180px 까지', () => {
    expect(APP_ICON_SVG.startsWith('<svg')).toBe(true);
    expect(APP_ICON_SVG).toContain('viewBox="0 0 64 64"');
  });
});
