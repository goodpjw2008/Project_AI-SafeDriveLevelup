/**
 * **크롬 앱 + 삼성 Xclipse GPU (ANGLE-Vulkan)** — 주행 화면에 검은 가로 띠가 번쩍이는 조합.
 *
 * 사용자 휴대폰(갤럭시 S24 · 엑시노스 2400 · Xclipse 940)에서 확정했다 (CHANGELOG, 2026-09-26). 같은 페이지가 **크롬 앱에서만**
 * 깨진다 — 삼성 인터넷은 물론, 구글 앱 안의 WebView 는 GPU 문자열이 똑같이 "on Vulkan" 인데도 검은 프레임 0 이다. 즉 GPU 도
 * ANGLE 의 Vulkan 백엔드도 그 자체로는 문제가 아니고, 크롬 앱이 그 위에 얹는 것(합성기 쪽)이 문제다. 프레임의 가로 띠(화면
 * 전체 폭)가 통째로 그려지지 않는다 — 지우기조차 안 된 순검정. 우리 쪽에서 해 본 것(캔버스 크기 고정 · 바탕색 · 렌더 타깃
 * 복사 · preserveDrawingBuffer · gl.finish · 그림자 끄기 · 해상도 고정)은 모두 소용없었다. 그래서 앱은 이 조합을 알아보고
 * **삼성 인터넷으로 여는 길**을 안내한다.
 *
 * GPU 문자열은 WEBGL_debug_renderer_info 가 준다 — "ANGLE (Samsung Electronics Co. Ltd., ANGLE ((Samsung Xclipse 940)
 * on Vulkan 1.3.279), OpenGL ES 3.2)". 판별은 이 문자열 + 크롬 앱의 UA(삼성 인터넷 · WebView 제외)로 한다.
 */

/**
 * 크롬 주 버전 — UA 의 `Chrome/151.0…` 에서. 모르면 0.
 * 검은 띠는 크롬 151 에서 시작된 회귀로 크로미움에 등록돼 있고(crbug 547065826), ANGLE 의 완화가 크롬 154 부터 들어갔다
 * (ANGLE 6cac303f "disable robust buffer access on Xclipse GPUs", 크로미움 154.0.8014.0 롤). **사용자가 크롬을 올려 사라지는 것을
 * 확인했다** (2026-09-26, 151 → 최신). 그래서 안내는 151~153 에서만 띄우고, 업데이트를 첫째 손으로 권한다.
 */
export function chromeMajor(userAgent: string): number {
  const m = /Chrome\/(\d+)/.exec(userAgent);
  return m ? Number(m[1]) : 0;
}

/** 회귀가 시작된 크롬 · ANGLE 의 Xclipse 완화가 들어간 첫 크롬 */
export const CHROME_BUG_FIRST = 151;
export const CHROME_WITH_XCLIPSE_FIX = 154;

/** 이 크롬 버전이 검은 띠가 나는 버전인가 (151~153) */
export const chromeAffected = (major: number): boolean => major >= CHROME_BUG_FIRST && major < CHROME_WITH_XCLIPSE_FIX;

/** 안내를 띄울 것인가 — Xclipse GPU + Vulkan + 크롬 앱 + 151~153 (전부 맞아야 한다) */
export const needsChromeUpdateNotice = (gpu: string, userAgent: string): boolean =>
  vulkanXclipseChrome(gpu, userAgent) && chromeAffected(chromeMajor(userAgent));

/** 플레이 스토어의 크롬 — 업데이트 버튼이 여는 곳 */
export const CHROME_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.android.chrome';

/** 이 브라우저 · GPU 조합이 검은 띠가 나는 조합인가 — 삼성 인터넷 · 안드로이드 WebView 안에서는 아니다 */
export function vulkanXclipseChrome(gpu: string, userAgent: string): boolean {
  if (!/Xclipse/i.test(gpu) || !/on Vulkan/i.test(gpu)) return false;
  if (!/Chrome\//.test(userAgent)) return false;
  // 삼성 인터넷 · 앱 안의 WebView · 다른 크로미움 브라우저는 크롬의 Vulkan 실험을 타지 않는다
  return !/SamsungBrowser|; wv\)|EdgA\/|Whale\/|NAVER\(/.test(userAgent);
}
