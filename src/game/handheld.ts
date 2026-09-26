/**
 * **손에 든 화면 판별** — 화면 규칙(index.html 의 '손에 든 세로 화면' · '손에 든 가로 화면')과 **같은 조건**이다.
 *
 * 조건이 갈라지면 화면의 규칙과 게임의 판단이 어긋난다 — 창을 접었는데 카메라는 넓게 보거나, 시점은 고정했는데
 * 버튼은 남는 식이다. 그래서 조건은 여기 한 곳에만 적고, 게임 쪽(카메라 · 시야 창 · 시점 · main)은 이것을 부른다.
 *
 * `matches` 는 부를 때마다 지금 값을 준다 — 휴대폰을 돌리면 다음 판단부터 바뀐다. MediaQueryList 는 한 번만 만든다
 * (프레임마다 부르는 곳이 있다 — CameraRig).
 */
const PORTRAIT = '(orientation: portrait) and (pointer: coarse) and (max-width: 720px)';
const LANDSCAPE = '(orientation: landscape) and (pointer: coarse) and (max-height: 540px)';

const queries = new Map<string, MediaQueryList | null>();

function matches(query: string): boolean {
  let q = queries.get(query);
  if (q === undefined) {
    q =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query)
        : null;
    queries.set(query, q);
  }
  return q?.matches === true;
}

/** 손에 든 세로 화면 */
export const isHandheldPortrait = (): boolean => matches(PORTRAIT);
/** 손에 든 가로 화면 */
export const isHandheldLandscape = (): boolean => matches(LANDSCAPE);
/** 손에 든 화면 — 세로든 가로든 */
export const isHandheld = (): boolean => isHandheldPortrait() || isHandheldLandscape();
