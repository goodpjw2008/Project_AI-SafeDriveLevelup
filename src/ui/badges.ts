/**
 * 레벨 뱃지 — **그림 파일이 아니라 그 자리에서 그리는 SVG 다.**
 *
 * ## 왜 그림을 버렸는가
 *
 * 계급이 넷이던 시절에는 뱃지도 넷이었고(`src/assets/badges/*.webp` — 지금은 지웠다), 넷이니까 구워
 * 두는 것이 맞았다. 레벨이 열이 되면서 셈이 뒤집혔다 —
 *
 *  - `src/assets/` 아래 그림은 크기와 상관없이 **번들에 base64 로 심긴다**
 *    (vite.config.ts 의 단일 파일 빌드). 개당 20KB 짜리 열 장이면 base64 로 260KB 다.
 *  - 열 장을 **손으로 그려야** 한다. 넷일 때는 각자 다른 계급이라 그림도 달라야 했지만,
 *    레벨은 숫자만 다르다 — 같은 도형 열 장을 굽는 것은 숫자를 그림으로 굽는 일이다.
 *
 * 지금은 도형 하나에 숫자를 얹어 그린다. 몇백 바이트고, 레벨을 늘려도 늘어나지 않으며,
 * 어떤 크기로 놓아도 흐려지지 않는다.
 *
 * ## 도형은 어디서 왔는가
 *
 * [Lucide](https://lucide.dev) 의 `hexagon` 이다 (**ISC**). 이 프로젝트가 이미 화면
 * 아이콘 전부를 여기서 가져오고 있고(ui/icons.ts), 저작권 화면에도 이미 적혀 있다
 * (Screens.ts 의 OSS_LIBRARIES). 새 의존을 들이지 않고 **획 굵기와 모서리 처리가 나머지
 * 아이콘과 한 벌로 맞는** 것이 육각형을 고른 이유다.
 *
 * 육각형인 이유는 숫자가 들어갈 자리 때문이다. 원은 두 자리 수(10)를 넣으면 좌우가
 * 답답하고, 방패(`shield`)는 아래가 뾰족해 숫자가 가운데서 위로 밀린다.
 *
 * ## 색은 지정하지 않는다
 *
 * 도형도 숫자도 `currentColor` 다 — 놓인 자리의 글자색을 그대로 따라간다. 지나온 레벨과
 * 지금 레벨과 아직 못 간 레벨을 CSS 한 곳에서 가를 수 있다 (index.html 의 `.level-badge`).
 */

import type { Difficulty } from '../scenarios/curriculum';

/** Lucide `hexagon` (ISC) — 24×24 좌표계 */
const HEXAGON =
  'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4' +
  'a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z';

/**
 * 레벨 뱃지 하나.
 *
 * **글자 크기는 자릿수를 보고 정한다.** 10 을 한 자리와 같은 크기로 넣으면 육각형의
 * 좌우 벽을 넘는다. 두 자리는 조금 줄이고 자간을 좁힌다.
 *
 * `aria-label` 은 부르는 쪽에서 끄게 해 두었다(`labelled: false`) — 뱃지 옆에 이미
 * 'L7' 이라고 적혀 있으면 낭독기가 같은 말을 두 번 읽는다.
 */
export function levelBadge(level: Difficulty | 'M', opts: { labelled?: boolean } = {}): string {
  const twoDigit = level !== 'M' && level >= 10;
  const label = opts.labelled === false
    ? 'aria-hidden="true"'
    : `role="img" aria-label="${level === 'M' ? '마스터' : `레벨 ${level}`}"`;

  return (
    `<svg class="level-badge" viewBox="0 0 24 24" ${label}>` +
    `<path class="level-badge-shape" d="${HEXAGON}" />` +
    `<text class="level-badge-num" x="12" y="12"` +
    // M 은 한 글자지만 폭이 넓어 한 자리 숫자보다 조금 줄인다
    ` font-size="${twoDigit ? 8.4 : level === 'M' ? 9.2 : 10.4}"` +
    ` letter-spacing="${twoDigit ? -0.6 : 0}">${level}</text>` +
    `</svg>`
  );
}

/**
 * **마스터 배지 'M'** — L10 을 마치면 레벨 길의 열한 번째 칸(M)이 켜지고, 플레이어 칸의 뱃지도 M 이 된다.
 * 사용자가 "첫 화면에서도 1~10 단계 이후에 M 을 추가해 줘" 라고 했다. 숫자 대신 M 을 얹을 뿐 같은 육각형이다.
 */
export const masterBadge = (opts: { labelled?: boolean } = {}): string => levelBadge('M', opts);
