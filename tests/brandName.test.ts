import { describe, expect, it } from 'vitest';
import { AI_BADGE_HTML, BRAND_CHIPS_HTML, withAiBadge, withBrandChips } from '../src/ui/brandName';
import { APP_ICON_SVG, APP_NAME, APP_NAME_PARTS, APP_TAGLINE, APP_TAGLINE_PARTS } from '../src/brand';

/*
  **이름은 어디서나 같은 모양이다** (ui/brandName.ts) — 'AI' 는 배지, '우회전' 은 신호등 딱지 셋.
  사용자가 분석 화면 · 추천 결과 · 말풍선의 이름도 신호등 색으로, 그리고 AI 공모전 작품이니 'AI' 가 돋보이게 해 달라고 했다.
  이름이 바뀌며 예전 이름의 딱지 셋을 '우회전' 에 그대로 옮겨 왔다 (사용자 요청).
*/
describe('이름 칠하기', () => {
  it("'AI 우회전' 은 AI 배지 + 딱지 셋", () => {
    expect(withBrandChips('AI 우회전이 후보 10개 중')).toBe(`${AI_BADGE_HTML} ${BRAND_CHIPS_HTML}이 후보 10개 중`);
  });

  it("맨 앞에 선 '우회전' 은 딱지 셋만 — 호칭(우회전 Level6)에 AI 배지가 붙지 않는다", () => {
    expect(withBrandChips('우회전 Level6')).toBe(`${BRAND_CHIPS_HTML} Level6`);
    expect(withBrandChips('우회전 마스터')).toBe(`${BRAND_CHIPS_HTML} 마스터`);
    expect(withBrandChips('우회전 Level6')).not.toContain('brand-ai');
  });

  /*
    **'우회전' 은 이름이기 전에 흔한 낱말이다.** 분석 단계에 습관 이름이 그대로 실린다 — 그 속의 '우회전' 까지
    딱지가 되면 이름이 아닌 것이 이름처럼 보인다.
  */
  it("글 속의 '우회전' 은 칠하지 않는다", () => {
    const habit = '나쁜 운전 습관 분석 — 신호·지시 위반 (우회전 신호등)';
    expect(withBrandChips(habit)).toBe(habit);
    expect(withBrandChips('정면 적색에서 우회전 전 일시정지')).toBe('정면 적색에서 우회전 전 일시정지');
  });

  it('이름 조각의 AI 는 배지, 세 글자는 적 · 황 · 녹 차례다', () => {
    expect(APP_NAME).toBe('AI 우회전 참교육');
    expect(APP_NAME_PARTS.filter((p) => p.tone).map((p) => `${p.text}:${p.tone}`)).toEqual([
      'AI:ai',
      '우:red',
      '회:yellow',
      '전:green',
    ]);
    expect(APP_TAGLINE).toBe('우회전과 어린이보호구역 안전운전 참교육');
  });

  /*
    **부제는 다루는 두 가지를 칠한다** (사용자 요청) — '우회전' 은 제목과 같은 신호등 딱지 셋, '어린이보호구역' 은
    보호구역 노면 색 딱지 하나. 나머지 낱말까지 칠하면 무엇이 주제인지 흐려진다.
  */
  it("부제의 '우회전' 은 신호등 딱지 셋, '어린이보호구역' 은 보호구역 딱지", () => {
    expect(APP_TAGLINE_PARTS.filter((p) => p.tone).map((p) => `${p.text}:${p.tone}`)).toEqual([
      '우:red',
      '회:yellow',
      '전:green',
      '어린이보호구역:zone',
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
  이름 '우회전' 의 첫 글자다. 색은 사용자가 정한 주황 그대로 둔다 (예전 이름 어·우·참 의 황색 딱지에서 왔다).
*/
describe('탭 아이콘', () => {
  it("주황 바탕에 '우' 한 글자다", () => {
    expect(APP_ICON_SVG).toContain('>우<');
    // 사용자가 정한 주황 (index.html 의 .brand-yellow 와 같은 값)
    expect(APP_ICON_SVG).toContain('#f2a900');
    expect(APP_ICON_SVG).not.toContain('회');
    expect(APP_ICON_SVG).not.toContain('전');
  });

  it('크기를 타지 않는 SVG 다 — 탭 16px 부터 홈 화면 180px 까지', () => {
    expect(APP_ICON_SVG.startsWith('<svg')).toBe(true);
    expect(APP_ICON_SVG).toContain('viewBox="0 0 64 64"');
  });
});
