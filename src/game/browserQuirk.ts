/**
 * **크롬 앱 + 삼성 Xclipse GPU (ANGLE-Vulkan)** — 주행 화면에 검은 가로 띠가 번쩍이는 조합.
 *
 * 사용자 휴대폰(갤럭시 S24 · 엑시노스 2400 · Xclipse 940)에서 확정했다 (CHANGELOG, 2026-09-26). 같은 페이지가 **크롬 앱에서만**
 * 깨진다 — 삼성 인터넷은 물론, 구글 앱 안의 WebView 는 GPU 문자열이 똑같이 "on Vulkan" 인데도 검은 프레임 0 이다. 즉 GPU 도
 * ANGLE 의 Vulkan 백엔드도 그 자체로는 문제가 아니고, 크롬 앱이 그 위에 얹는 것이 문제다. 프레임의 가로 띠(화면 전체 폭)가
 * 통째로 그려지지 않는다 — 지우기조차 안 된 순검정. 우리 쪽에서 해 본 것(캔버스 크기 고정 · 바탕색 · 렌더 타깃 복사 ·
 * preserveDrawingBuffer · gl.finish · 그림자 끄기 · 해상도 고정)은 모두 소용없었다.
 *
 * GPU 문자열은 WEBGL_debug_renderer_info 가 준다 — "ANGLE (Samsung Electronics Co. Ltd., ANGLE ((Samsung Xclipse 940)
 * on Vulkan 1.3.279), OpenGL ES 3.2)". 바깥 ANGLE 은 크롬의 것(GL 백엔드), 안쪽 "ANGLE (…) on Vulkan" 은 삼성이 기기에 얹은
 * OpenGL ES 드라이버(그것도 ANGLE-Vulkan)다. 판별은 이 문자열 + 크롬 앱의 UA(삼성 인터넷 · WebView 제외) + 크롬 빌드로 한다.
 */

/**
 * ## 어느 크롬이 문제인가 — 커밋 이력으로 확정 (2026-09-26)
 *
 * 크로미움 버그 547065826 "WebGL applications performing instanced rendering are flickering on Xclipse GPUs when robust
 * buffer access is enabled. **This is a regression in Chrome 151**". 완화는 ANGLE `6cac303f`(2026-08-19, main) — 크롬의 ANGLE(GL
 * 백엔드)이 삼성 드라이버에 컨텍스트를 만들 때 `EGL_CONTEXT_OPENGL_ROBUST_ACCESS_EXT` 를 넣지 않는다(`IsSamsungXclipse()` =
 * `ro.soc.manufacturer=samsung` + `ro.hardware.egl=samsung`). 이 커밋이 **릴리스 가지에도 체리픽**됐다 — 각 크롬 릴리스가 DEPS 로
 * 고정한 ANGLE 판을 하나씩 확인했다(chromium.googlesource.com refs/tags/<버전>/DEPS 의 angle_revision):
 *
 *  | 크롬 | ANGLE 가지 | 완화 | 첫 완화 빌드 | 비고 |
 *  |---|---|---|---|---|
 *  | 151 | chromium/7922 | **없음** | — | 마지막 안정판 151.0.7922.175 (2026-08-27) 까지 미포함 |
 *  | 152 | chromium/7977 | 736ed80c75 [M152] (08-21) | **152.0.7977.64** (08-25) | .42 · .54 (08-12 · 08-19) 는 미포함 |
 *  | 153 | chromium/8010 | a6bc9eff84 [M153] (08-21) | **153.0.8010.18** (08-27) | 안정판 첫 빌드 .37 부터 모두 포함 |
 *  | 154 | chromium/8037 | main 커밋 그대로 | 154.0.8014.0 | 모든 안정판 포함 |
 *  | 155~ | | | | 모두 포함 |
 *
 * 사용자 휴대폰은 151 이었고(진단 줄 "Chrome 151"), 153.0.8010.53 으로 올린 뒤 사라졐다 — 표와 맞는다. 처음에는 "154 부터"
 * 라고 적었는데, 그것은 main 가지의 롤만 본 것이었다(chromiumdash fetch_commit 은 main 기준). 사용자가 "153 인데 고쳐졌다"
 * 고 해 릴리스 가지를 다시 봤다.
 *
 * ## 빌드 번호는 UA 에 없다
 *
 * 크롬은 UA 를 줄여 보낸다(User-Agent reduction) — `Chrome/153.0.0.0`. 주 버전만 남는다. 온전한 버전(153.0.8010.53)은
 * `navigator.userAgentData.getHighEntropyValues(['fullVersionList'])` 로 따로 묻는다(크롬 90+, 비동기). 못 얻으면 주 버전으로만
 * 판단한다 — 151 은 어느 빌드든 문제, 152~154 는 완화가 실린 빌드가 거의 전부라(153 · 154 는 안정판 전부) 문제 없음으로 본다.
 */
export function chromeMajor(userAgent: string): number {
  const m = /Chrome\/(\d+)/.exec(userAgent);
  return m ? Number(m[1]) : 0;
}

/** UA 가 줄어 있지 않으면(뒤가 0.0.0 이 아니면) 그 온전한 버전. 줄어 있으면 null */
export function chromeFullFromUA(userAgent: string): string | null {
  const m = /Chrome\/(\d+\.\d+\.\d+\.\d+)/.exec(userAgent);
  if (!m) return null;
  return /^\d+\.0\.0\.0$/.test(m[1]) ? null : m[1];
}

/** 회귀가 시작된 크롬 — 이보다 앞은 문제 없다 */
export const CHROME_BUG_FIRST = 151;
/** 이 주 버전 뒤로는 완화가 든 채로 갈라져 나왔다 */
export const CHROME_BUG_LAST_MAJOR = 154;
/** 주 버전마다 완화가 처음 실린 빌드 — 151 은 없다(끝까지 미포함) */
export const CHROME_FIXED_BUILDS: Readonly<Record<number, string>> = {
  152: '152.0.7977.64',
  153: '153.0.8010.18',
  154: '154.0.8014.0',
};
/** 안내 문구에 적는 "여기부터 고쳐졌다" — 문제 주 버전에서 가장 가까운 완화 빌드 */
export const chromeFixedFrom = (major: number): string =>
  CHROME_FIXED_BUILDS[major] ?? CHROME_FIXED_BUILDS[CHROME_BUG_FIRST + 1];

/** "153.0.8010.53" 같은 점 구분 버전 비교 — a<b 면 음수 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * 이 크롬이 검은 띠가 나는 빌드인가.
 * `full` 은 온전한 버전(모르면 null) — 151 은 빌드와 상관없이 문제, 152~154 는 완화 빌드보다 앞일 때만 문제,
 * 빌드를 모르면 문제 없음으로 본다(위 주석).
 */
export function chromeAffected(major: number, full: string | null = null): boolean {
  if (major < CHROME_BUG_FIRST || major > CHROME_BUG_LAST_MAJOR) return false;
  const fixed = CHROME_FIXED_BUILDS[major];
  if (!fixed) return true;
  if (!full || chromeMajorOf(full) !== major) return false;
  return compareVersions(full, fixed) < 0;
}

const chromeMajorOf = (full: string): number => Number(full.split('.')[0]);

/** 온전한 크롬 버전 — Client Hints 로 묻는다. 크롬이 아니거나 못 얻으면 null */
export async function chromeFullVersion(nav: Navigator = navigator): Promise<string | null> {
  const uad = (nav as Navigator & { userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<unknown> } }).userAgentData;
  if (!uad?.getHighEntropyValues) return chromeFullFromUA(nav.userAgent);
  try {
    const r = (await uad.getHighEntropyValues(['fullVersionList'])) as {
      fullVersionList?: { brand: string; version: string }[];
    };
    const list = r.fullVersionList ?? [];
    const hit = list.find((b) => b.brand === 'Google Chrome') ?? list.find((b) => b.brand === 'Chromium');
    return hit?.version ?? chromeFullFromUA(nav.userAgent);
  } catch {
    return chromeFullFromUA(nav.userAgent);
  }
}

/** 안내를 띄울 것인가 — Xclipse GPU + Vulkan + 크롬 앱 + 문제 빌드 (전부 맞아야 한다) */
export const needsChromeUpdateNotice = (gpu: string, userAgent: string, full: string | null = null): boolean =>
  vulkanXclipseChrome(gpu, userAgent) && chromeAffected(chromeMajor(userAgent), full ?? chromeFullFromUA(userAgent));

/** 플레이 스토어의 크롬 — 업데이트 버튼이 여는 곳 */
export const CHROME_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.android.chrome';

/** 이 브라우저 · GPU 조합이 검은 띠가 나는 조합인가 — 삼성 인터넷 · 안드로이드 WebView 안에서는 아니다 */
export function vulkanXclipseChrome(gpu: string, userAgent: string): boolean {
  if (!/Xclipse/i.test(gpu) || !/on Vulkan/i.test(gpu)) return false;
  if (!/Chrome\//.test(userAgent)) return false;
  // 삼성 인터넷 · 앱 안의 WebView · 다른 크로미움 브라우저는 크롬 앱의 경로를 타지 않는다
  return !/SamsungBrowser|; wv\)|EdgA\/|Whale\/|NAVER\(/.test(userAgent);
}
