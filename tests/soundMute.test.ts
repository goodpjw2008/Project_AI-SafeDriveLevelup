/**
 * **소리 끄기 · 켜기** — 휴대폰 주행 화면의 단추 하나 (사용자가 정했다, 2026-11-15: "모바일 화면에서 소리를 끄고 키는 기능을
 * 만들어줘. 버튼하나로 음소거가 되게"). 끈 값은 저장본(settings.muted)에 남고, 단추는 손가락 화면에서만 선다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultSave, load, reset } from '../src/economy/save';

const KEY = 'turn-right:save:v1';
const store = (raw: string) => {
  const m = new Map<string, string>([[KEY, raw]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
};
afterEach(() => vi.unstubAllGlobals());

const withSettings = (settings: Record<string, unknown>) => JSON.stringify({ ...defaultSave(), settings: { ...defaultSave().settings, ...settings } });

describe('저장본의 소리 끔 (settings.muted)', () => {
  it('처음에는 켜져 있다', () => {
    expect(defaultSave().settings.muted).toBe(false);
  });

  it('끈 값은 다음 방문에도 그대로 읽는다', () => {
    store(withSettings({ muted: true }));
    expect(load().settings.muted).toBe(true);
  });

  it('이 값이 생기기 전의 저장본 · 참 · 거짓이 아닌 값은 켜짐으로 읽는다', () => {
    const old = JSON.parse(withSettings({})) as { settings: Record<string, unknown> };
    delete old.settings.muted;
    store(JSON.stringify(old));
    expect(load().settings.muted).toBe(false);
    store(withSettings({ muted: 'yes' }));
    expect(load().settings.muted).toBe(false);
  });

  it('진행 초기화는 설정이라 남긴다 — 소리를 끈 채로 다시 시작한다', () => {
    const s = defaultSave();
    s.settings.muted = true;
    expect(reset(s).settings.muted).toBe(true);
  });
});

describe('주행 화면의 소리 단추 (index.html)', () => {
  const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');

  it('HUD 에 단추 하나 — 켜짐 · 꺼짐 그림이 함께 있다', () => {
    const hud = html.slice(html.indexOf('<div id="hud">'));
    expect(hud).toContain('id="btn-hud-sound"');
    expect(html.match(/id="btn-hud-sound"/g)).toHaveLength(1);
    expect(html).toContain('class="snd-on"');
    expect(html).toContain('class="snd-off"');
  });

  it('PC 에서는 감추고 손가락 화면에서만 세운다', () => {
    expect(html).toMatch(/\.hud-sound \{\s*display: none;/);
    expect(html).toMatch(/body\.touch \.hud-home\.hud-sound \{[^}]*display: inline-grid;/);
  });
});
