/**
 * **시연 휴대폰 — 마우스 화면에서도 휴대폰(손가락 화면)처럼 그린다.** 주소 `?demo=…,phone` 으로 열 때만 (main.ts).
 *
 * 사용자가 정했다 (2026-11-15): 발표자료 '시연 포함' 판의 오른쪽 휴대폰 틀 안에서 도는 사이트가 **실제 휴대폰 화면과 같아야** 한다.
 * 그런데 휴대폰과 PC 를 가르는 규칙은 화면 크기만이 아니라 **손가락 화면인가**(`pointer: coarse`)다 (index.html 의 '손에 든 세로 화면',
 * game/handheld.ts). PC 의 발표 화면 안(iframe)에서는 크기가 휴대폰이어도 마우스라서 PC 쪽 규칙이 섰다 — 위쪽 판 설명이 길고,
 * LiDAR 설명 상자가 크고, 'AI 자율주행' 카드 위에 레벨 카드가 겹쳤다.
 *
 * 그래서 이 화면에서만 **손가락 조건을 참으로, 마우스 조건을 거짓으로** 바꿔 읽는다:
 *  - CSS — 문서의 @media 규칙 글을 고친다 (`(pointer: coarse)` → 늘 참, `(hover: hover)` · `(pointer: fine)` → 늘 거짓).
 *  - JS — `matchMedia` 가 같은 글을 고친 뒤 묻게 한다 (handheld.ts · Game · carModel · main 의 body.touch 가 모두 이것을 부른다).
 * 규칙을 새로 쓰지 않으므로 휴대폰 화면이 바뀌면 시연 화면도 저절로 따라간다. 다른 출처의 CSS(글꼴)는 읽을 수 없어 건너뛴다.
 */
const SWAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/\(\s*pointer\s*:\s*coarse\s*\)/g, '(min-width: 0px)'],
  [/\(\s*hover\s*:\s*none\s*\)/g, '(min-width: 0px)'],
  [/\(\s*pointer\s*:\s*fine\s*\)/g, '(max-width: 0px)'],
  [/\(\s*hover\s*:\s*hover\s*\)/g, '(max-width: 0px)'],
];

/** 미디어 조건 글을 휴대폰(손가락 화면) 쪽으로 바꾼다 — 크기 · 방향 조건은 그대로 둔다 */
export function asPhoneQuery(query: string): string {
  return SWAP.reduce((q, [re, to]) => q.replace(re, to), query);
}

function rewriteRules(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSMediaRule) {
      const now = rule.media.mediaText;
      const next = asPhoneQuery(now);
      if (next !== now) rule.media.mediaText = next;
    }
    if ('cssRules' in rule) rewriteRules((rule as CSSGroupingRule).cssRules);
  }
}

/** 이 화면을 휴대폰처럼 — 다른 코드가 matchMedia 를 처음 부르기 전에 한 번 */
export function forcePhoneLayout(): void {
  const native = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => native(asPhoneQuery(query));
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      rewriteRules(sheet.cssRules);
    } catch {
      // 다른 출처의 CSS(jsDelivr 의 글꼴)는 규칙을 읽을 수 없다 — 손가락 조건이 없는 파일이라 건너뛴다
    }
  }
  document.documentElement.classList.add('demo-phone');
}
