/**
 * **'우회전' 을 신호등 딱지 셋으로** — 이름이 나오는 자리는 어디서나 이 모양이다.
 *
 * 첫 화면 제목의 이름을 적색 · 황색 · 녹색 딱지로 칠했더니(brand.ts · index.html 의 `.brand-red` ·
 * `.brand-yellow` · `.brand-green`), 사용자가 AI 분석 화면 · 추천 결과 · 주행 중 말풍선의 이름도 같은 색으로
 * 넣어 달라고 했다. 같은 이름이 어떤 자리에서는 딱지이고 어떤 자리에서는 맨 글자면, 로봇 'AI 우회전' 과 작품 이름이
 * 같은 것인지부터 다시 알아봐야 한다.
 *
 * 색은 여기서 정하지 않는다 — 클래스만 붙이고 값은 index.html 이 정한다. HTML 에 바로 적힌 자리(분석 제목 · 추천
 * 결과 문장 · 말풍선 이름 · 엔딩 이름)도 같은 마크업을 쓴다.
 */

/** 이름 — 로봇 이름('AI 우회전')과 학습자 호칭('우회전 Level6')이 이 낱말을 쓴다 */
export const BRAND_WORD = '우회전';

/** 세 딱지 — `.brand-chips` 가 셋을 한 덩어리로 묶어 줄 끝에서 갈라지지 않게 한다 */
export const BRAND_CHIPS_HTML =
  '<span class="brand-chips"><span class="brand-red">우</span><span class="brand-yellow">회</span>' +
  '<span class="brand-green">전</span></span>';

/**
 * **'AI' 배지** — 둥근 알약 모양 · 파랑→보라 그라데이션 · 반짝이(✦). AI 활용 공모전 작품이라 이름의 'AI' 가 돋보여야
 * 한다(사용자가 짚었다). 신호등 딱지와 모양 · 색을 달리해 넷째 등으로 읽히지 않게 한다 (index.html 의 `.brand-ai`).
 */
export const AI_BADGE_HTML = '<span class="brand-ai">AI</span>';

/**
 * **홀로 선 'AI' 를 배지로 칠한다** — 이름이 아닌 곳의 AI 다: 결과 화면과 주행 화면의 판 이름
 * (`AI 추천 시나리오 2484`, `AI 시범`).
 *
 * 사용자가 짚었다 — "주행 결과를 보여 줄 때 'AI 추천 시나리오 2484' 이렇게 나오는데, 여기의 AI 부분도
 * 타이틀의 예쁜 AI 를 가져다 써 줘." AI 활용 공모전 작품이라 AI 라는 글자는 어디에 있든 같은 얼굴이어야 한다.
 *
 * 'AI 우회전' 은 여기 말고 아래 withBrandChips 가 맡는다 — 배지 뒤에 신호등 딱지까지 붙여야 한다.
 *
 * **이스케이프한 뒤에 부른다** (withBrandChips 와 같은 이유).
 */
export function withAiBadge(escapedHtml: string): string {
  return escapedHtml.replace(/\bAI\b/g, AI_BADGE_HTML);
}

/**
 * 이미 이스케이프한 HTML 안의 **이름 자리만** 칠한다 — 'AI 우회전' 은 AI 배지 + 딱지 셋, **맨 앞에 선** '우회전'
 * (호칭 '우회전 Level6' · '우회전 마스터')은 딱지 셋.
 *
 * **보이는 '우회전' 을 모두 칠하지 않는다.** 예전 이름 '어우참' 은 만든 말이라 글 속에 달리 나올 일이 없었지만,
 * '우회전' 은 이 게임에서 가장 흔한 낱말이다 — 분석 단계의 습관 이름(`신호·지시 위반 (우회전 신호등)`)까지
 * 신호등 딱지가 되면 이름이 아닌 것이 이름처럼 보인다. 그래서 이름이 서는 두 자리만 본다.
 *
 * **이스케이프한 뒤에 부른다** — 딱지 마크업이 다시 이스케이프되면 태그가 글자로 보인다.
 */
export function withBrandChips(escapedHtml: string): string {
  return escapedHtml
    .split(`AI ${BRAND_WORD}`)
    .join(`${AI_BADGE_HTML} ${BRAND_CHIPS_HTML}`)
    .replace(new RegExp(`^${BRAND_WORD}(?= )`), BRAND_CHIPS_HTML);
}
