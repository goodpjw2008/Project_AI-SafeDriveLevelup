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

/** 이 브라우저 · GPU 조합이 검은 띠가 나는 조합인가 — 삼성 인터넷 · 안드로이드 WebView 안에서는 아니다 */
export function vulkanXclipseChrome(gpu: string, userAgent: string): boolean {
  if (!/Xclipse/i.test(gpu) || !/on Vulkan/i.test(gpu)) return false;
  if (!/Chrome\//.test(userAgent)) return false;
  // 삼성 인터넷 · 앱 안의 WebView · 다른 크로미움 브라우저는 크롬의 Vulkan 실험을 타지 않는다
  return !/SamsungBrowser|; wv\)|EdgA\/|Whale\/|NAVER\(/.test(userAgent);
}

/**
 * 같은 주소를 **삼성 인터넷에서 여는** 안드로이드 intent 링크 — 크롬에서 사용자가 누르면 삼성 인터넷이 뜬다.
 * 삼성 인터넷이 없는 기기에서는 fallback 주소(같은 페이지)로 돌아온다.
 */
export function samsungInternetIntent(url: URL): string {
  const scheme = url.protocol.replace(':', '');
  return (
    `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};` +
    `package=com.sec.android.app.sbrowser;S.browser_fallback_url=${encodeURIComponent(url.href)};end`
  );
}
