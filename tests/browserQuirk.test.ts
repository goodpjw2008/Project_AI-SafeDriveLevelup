import { describe, expect, it } from 'vitest';
import {
  CHROME_BUG_FIRST,
  CHROME_BUG_LAST_MAJOR,
  CHROME_FIXED_BUILDS,
  chromeAffected,
  chromeFixedFrom,
  chromeFullFromUA,
  chromeFullVersion,
  chromeMajor,
  compareVersions,
  needsChromeUpdateNotice,
  vulkanXclipseChrome,
} from '../src/game/browserQuirk';

const GPU_VULKAN =
  'ANGLE (Samsung Electronics Co. Ltd., ANGLE ((Samsung Xclipse 940) on Vulkan 1.3.279), OpenGL ES 3.2)';
const GPU_GLES = 'ANGLE (Samsung Electronics Co. Ltd., Samsung Xclipse 940, OpenGL ES 3.2 v1.r39p0-01eac0)';
const CHROME =
  'Mozilla/5.0 (Linux; Android 15; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const SAMSUNG =
  'Mozilla/5.0 (Linux; Android 15; SAMSUNG SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36';
const WEBVIEW =
  'Mozilla/5.0 (Linux; Android 15; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36';
const ua = (v: number) => CHROME.replace('Chrome/140', `Chrome/${v}`);

/*
  검은 띠 조합의 판별 — 사용자 폰에서 확정한 조합(크롬 + Xclipse + Vulkan)만 잡고, 정상인 곳(삼성 인터넷 · WebView ·
  OpenGL ES 로 도는 같은 GPU)은 잡지 않는다. 잘못 띄우면 멀쩡한 사용자에게 업데이트를 재촉한다.
*/
describe('크롬 · Xclipse · Vulkan 조합 판별', () => {
  it('사용자 폰의 조합을 잡는다', () => {
    expect(vulkanXclipseChrome(GPU_VULKAN, CHROME)).toBe(true);
  });
  it('삼성 인터넷 · 앱 안의 WebView 는 잡지 않는다', () => {
    expect(vulkanXclipseChrome(GPU_VULKAN, SAMSUNG)).toBe(false);
    expect(vulkanXclipseChrome(GPU_VULKAN, WEBVIEW)).toBe(false);
  });
  it('같은 GPU 라도 OpenGL ES 로 돌면 잡지 않고, 다른 GPU 는 잡지 않는다', () => {
    expect(vulkanXclipseChrome(GPU_GLES, CHROME)).toBe(false);
    expect(vulkanXclipseChrome('ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)', CHROME)).toBe(false);
    expect(vulkanXclipseChrome('', CHROME)).toBe(false);
  });
});

/*
  **어느 크롬이 문제인가** — 커밋 이력으로 확정한 표(browserQuirk.ts 주석). 회귀는 151, 완화는 152.0.7977.64 · 153.0.8010.18 ·
  154.0.8014.0 부터. 사용자 폰은 151 에서 깨졌고 153.0.8010.53 으로 올린 뒤 멀쩡했다 — 153 에 안내가 뜨면 틀린 것이다.
*/
describe('크롬 버전 — 151 회귀와 릴리스 가지마다의 완화', () => {
  it('UA 에서 주 버전을 읽고, 모르면 0', () => {
    expect(chromeMajor(CHROME)).toBe(140);
    expect(chromeMajor(SAMSUNG)).toBe(130);
    expect(chromeMajor('Mozilla/5.0 (iPhone) Safari/604.1')).toBe(0);
  });
  it('UA 의 버전은 줄어 있어(153.0.0.0) 빌드로 쓰지 않고, 줄어 있지 않으면 쓴다', () => {
    expect(chromeFullFromUA(ua(153))).toBeNull();
    expect(chromeFullFromUA(CHROME.replace('Chrome/140.0.0.0', 'Chrome/152.0.7977.54'))).toBe('152.0.7977.54');
    expect(chromeFullFromUA(SAMSUNG.replace('Chrome/130.0.0.0', 'Safari/537.36'))).toBeNull();
  });
  it('점 구분 버전 비교', () => {
    expect(compareVersions('152.0.7977.54', '152.0.7977.64')).toBeLessThan(0);
    expect(compareVersions('153.0.8010.53', '153.0.8010.18')).toBeGreaterThan(0);
    expect(compareVersions('154.0.8014.0', '154.0.8014.0')).toBe(0);
    expect(compareVersions('153.0.8010', '153.0.8010.0')).toBe(0);
  });
  it('회귀는 151 부터, 완화는 152 · 153 · 154 가지에 각각 실렸다', () => {
    expect(CHROME_BUG_FIRST).toBe(151);
    expect(CHROME_BUG_LAST_MAJOR).toBe(154);
    expect(CHROME_FIXED_BUILDS).toEqual({ 152: '152.0.7977.64', 153: '153.0.8010.18', 154: '154.0.8014.0' });
    expect(chromeFixedFrom(151)).toBe('152.0.7977.64');
    expect(chromeFixedFrom(152)).toBe('152.0.7977.64');
  });
  it('151 은 빌드와 상관없이 문제, 150 이하 · 155 이상은 아니다', () => {
    expect(chromeAffected(150)).toBe(false);
    expect(chromeAffected(151)).toBe(true);
    expect(chromeAffected(151, '151.0.7922.175')).toBe(true);
    expect(chromeAffected(155)).toBe(false);
    expect(chromeAffected(0)).toBe(false);
  });
  it('152 는 152.0.7977.64 앞의 빌드만 문제다', () => {
    expect(chromeAffected(152, '152.0.7977.54')).toBe(true);
    expect(chromeAffected(152, '152.0.7977.64')).toBe(false);
    expect(chromeAffected(152, '152.0.7977.84')).toBe(false);
  });
  it('사용자 폰의 153.0.8010.53 은 문제 아니다 — 153 · 154 안정판은 전부 완화가 들어 있다', () => {
    expect(chromeAffected(153, '153.0.8010.53')).toBe(false);
    expect(chromeAffected(153, '153.0.8010.37')).toBe(false);
    expect(chromeAffected(153, '153.0.8010.17')).toBe(true); // 개발판 — 안정판에는 없는 빌드
    expect(chromeAffected(154, '154.0.8037.58')).toBe(false);
  });
  it('빌드를 모르면 151 만 문제로 본다', () => {
    expect(chromeAffected(152)).toBe(false);
    expect(chromeAffected(153)).toBe(false);
    expect(chromeAffected(154)).toBe(false);
    expect(chromeAffected(153, '152.0.7977.54')).toBe(false); // 주 버전이 어긋난 빌드는 믿지 않는다
  });
  it('안내는 Xclipse + Vulkan + 크롬 앱 + 문제 빌드가 전부 맞을 때만 뜬다', () => {
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(151))).toBe(true);
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(152), '152.0.7977.54')).toBe(true);
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(152), '152.0.7977.84')).toBe(false);
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(153), '153.0.8010.53')).toBe(false);
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(153))).toBe(false);
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(155))).toBe(false);
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(140))).toBe(false);
    expect(needsChromeUpdateNotice(GPU_GLES, ua(151))).toBe(false);
    expect(needsChromeUpdateNotice(GPU_VULKAN, SAMSUNG)).toBe(false);
  });
  it('온전한 버전은 Client Hints 의 fullVersionList 에서 "Google Chrome" 을 고른다 — 없으면 UA 로', async () => {
    const nav = (list: { brand: string; version: string }[] | Error, userAgent = ua(153)) =>
      ({
        userAgent,
        userAgentData: {
          getHighEntropyValues: () => (list instanceof Error ? Promise.reject(list) : Promise.resolve({ fullVersionList: list })),
        },
      }) as unknown as Navigator;
    expect(
      await chromeFullVersion(
        nav([
          { brand: 'Not/A)Brand', version: '99.0.0.0' },
          { brand: 'Chromium', version: '153.0.8010.53' },
          { brand: 'Google Chrome', version: '153.0.8010.53' },
        ]),
      ),
    ).toBe('153.0.8010.53');
    expect(await chromeFullVersion(nav([{ brand: 'Chromium', version: '153.0.8010.53' }]))).toBe('153.0.8010.53');
    expect(await chromeFullVersion(nav(new Error('blocked')))).toBeNull();
    expect(await chromeFullVersion({ userAgent: ua(151) } as Navigator)).toBeNull();
    expect(
      await chromeFullVersion({ userAgent: CHROME.replace('Chrome/140.0.0.0', 'Chrome/152.0.7977.54') } as Navigator),
    ).toBe('152.0.7977.54');
  });
});
