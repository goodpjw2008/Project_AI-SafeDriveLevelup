import { describe, expect, it } from 'vitest';
import { CHROME_WITH_XCLIPSE_FIX, chromeAffected, chromeMajor, needsChromeUpdateNotice, vulkanXclipseChrome } from '../src/game/browserQuirk';

const GPU_VULKAN =
  'ANGLE (Samsung Electronics Co. Ltd., ANGLE ((Samsung Xclipse 940) on Vulkan 1.3.279), OpenGL ES 3.2)';
const GPU_GLES = 'ANGLE (Samsung Electronics Co. Ltd., Samsung Xclipse 940, OpenGL ES 3.2 v1.r39p0-01eac0)';
const CHROME =
  'Mozilla/5.0 (Linux; Android 15; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const SAMSUNG =
  'Mozilla/5.0 (Linux; Android 15; SAMSUNG SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36';
const WEBVIEW =
  'Mozilla/5.0 (Linux; Android 15; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36';

/*
  검은 띠 조합의 판별 — 사용자 폰에서 확정한 조합(크롬 + Xclipse + Vulkan)만 잡고, 정상인 곳(삼성 인터넷 · WebView ·
  OpenGL ES 로 도는 같은 GPU)은 잡지 않는다. 잘못 띄우면 멀쩡한 사용자를 다른 브라우저로 내보낸다.
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

describe('크롬 버전 — 151 회귀와 154 의 완화', () => {
  it('UA 에서 주 버전을 읽고, 모르면 0', () => {
    expect(chromeMajor(CHROME)).toBe(140);
    expect(chromeMajor(SAMSUNG)).toBe(130);
    expect(chromeMajor('Mozilla/5.0 (iPhone) Safari/604.1')).toBe(0);
  });
  it('완화가 들어간 크롬은 154 부터다 — 151~153 만 문제 버전이다', () => {
    expect(CHROME_WITH_XCLIPSE_FIX).toBe(154);
    expect(chromeAffected(150)).toBe(false);
    expect(chromeAffected(151)).toBe(true);
    expect(chromeAffected(153)).toBe(true);
    expect(chromeAffected(154)).toBe(false);
    expect(chromeAffected(0)).toBe(false);
  });
  it('안내는 Xclipse + Vulkan + 크롬 앱 + 151~153 이 전부 맞을 때만 뜬다 — 사용자가 크롬을 올린 뒤에는 뜨지 않는다', () => {
    const ua = (v: number) => CHROME.replace('Chrome/140', `Chrome/${v}`);
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(151))).toBe(true);
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(155))).toBe(false);
    expect(needsChromeUpdateNotice(GPU_VULKAN, ua(140))).toBe(false);
    expect(needsChromeUpdateNotice(GPU_GLES, ua(151))).toBe(false);
    expect(needsChromeUpdateNotice(GPU_VULKAN, SAMSUNG)).toBe(false);
  });
});
