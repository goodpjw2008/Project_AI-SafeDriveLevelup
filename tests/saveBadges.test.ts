/**
 * **뱃지와 저장본** (economy/save.ts 의 v12) — 뱃지가 생기기 전의 저장본은 남은 주행 기록으로 채우고, 처음부터 다시
 * 시작하면 함께 지운다. 사용자가 정했다 — 이미 7레벨까지 온 사람이 뱃지 0개에서 시작하면 그동안 지킨 것이 없던 일이 된다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultSave, load, reset } from '../src/economy/save';
import { tiersOf } from '../src/economy/badges';
import { scenarioLibrary } from '../src/scenarios/library';

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

/** 정면 적색 · 우회전 후 무단횡단 — 적색 일시정지와 보행자 먼저를 시험한다 */
const red = scenarioLibrary().find(
  (e) => e.tags.signal === 'red' && e.tags.zone === 'no' && e.tags.approach === 'none' && e.tags.c === 'jaywalk' && e.tags.lead === 'none',
)!;

describe('뱃지가 생기기 전의 저장본', () => {
  it('남은 주행 기록으로 뱃지를 채운다', () => {
    const old = { ...defaultSave(), version: 11 } as Record<string, unknown>;
    delete old.badges;
    old.history = Array.from({ length: 4 }, () => ({ st: red.spec.id, g: 'PERFECT', v: [], sa: true, sc: true, sp: 12, sg: true }));
    store(JSON.stringify(old));
    const s = load();
    expect(s.badges.keep.redStop).toBe(4);
    expect(tiersOf(s.badges).redStop, '네 번 지켰으면 동').toBe(1);
    expect(tiersOf(s.badges).firstClean).toBe(1);
  });

  it('v12 저장본은 저장된 뱃지를 그대로 읽는다 — 기록으로 다시 세지 않는다', () => {
    const now = { ...defaultSave() };
    now.badges = { ...now.badges, keep: { ...now.badges.keep, schoolZoneStop: 11 } };
    now.history = [];
    store(JSON.stringify(now));
    expect(load().badges.keep.schoolZoneStop).toBe(11);
  });
});

describe('처음부터 다시 시작', () => {
  it('뱃지도 함께 지운다 — 다음 운전자가 앞 사람의 뱃지를 달고 시작하지 않게', () => {
    const played = defaultSave();
    played.badges = { ...played.badges, keep: { ...played.badges.keep, redStop: 30 }, earned: ['firstClean'] };
    const fresh = reset(played);
    expect(fresh.badges.keep.redStop).toBe(0);
    expect(fresh.badges.earned).toEqual([]);
  });
});

/*
  **AI 사용 설정** (save.ts 의 aiMode) — 기본은 로컬 신경망(어텐션)이다 (사용자가 정했다). 이 값이 없던 저장본도 그쪽으로 읽고, 모르는 값은
  서버에 묻는 쪽으로 새지 않게 기본으로 돌린다. 1.0.6 의 '다음판 추천 AI 설정'(recommendAi)에서 고른 값은 이어받는다.
*/
describe('AI 사용 설정', () => {
  it('새 저장본과 이 값이 없던 저장본은 어텐션이다', () => {
    expect(defaultSave().settings.aiMode).toBe('attention');
    const old = defaultSave() as unknown as { settings: Record<string, unknown> };
    delete old.settings.aiMode;
    store(JSON.stringify(old));
    expect(load().settings.aiMode).toBe('attention');
  });

  it('이미 고른 로컬 신경망(MLP)은 그대로 둔다 — 기본이 바뀌어도 고른 값을 덮지 않는다', () => {
    const saved = defaultSave();
    saved.settings.aiMode = 'local';
    store(JSON.stringify(saved));
    expect(load().settings.aiMode).toBe('local');
  });

  it('외부 LLM 을 고른 값은 남고, 모르는 값은 로컬이 된다', () => {
    const llm = defaultSave();
    llm.settings.aiMode = 'llm';
    store(JSON.stringify(llm));
    expect(load().settings.aiMode).toBe('llm');
    store(JSON.stringify({ ...defaultSave(), settings: { ...defaultSave().settings, aiMode: 'gpt' } }));
    expect(load().settings.aiMode).toBe('attention');
  });

  it('로컬 신경망 어텐션을 고른 값도 남는다 (세 가지 — 2026-11-02 사용자가 정함)', () => {
    const attention = defaultSave();
    attention.settings.aiMode = 'attention';
    store(JSON.stringify(attention));
    expect(load().settings.aiMode).toBe('attention');
  });

  it('1.0.6 의 다음판 추천 AI 설정에서 고른 외부 LLM 을 이어받는다', () => {
    const old = defaultSave() as unknown as { settings: Record<string, unknown> };
    delete old.settings.aiMode;
    old.settings.recommendAi = 'llm';
    store(JSON.stringify(old));
    expect(load().settings.aiMode).toBe('llm');
  });
});
