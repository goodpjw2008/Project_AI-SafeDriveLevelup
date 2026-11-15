/**
 * 시연용 주소 `?demo=master` 의 저장본 (economy/demo.ts) — 발표자료 '시연 포함' 판의 휴대폰이 '마스터 운행' 으로 바로 열리는가.
 */
import { describe, expect, it } from 'vitest';
import { demoMaster } from '../src/economy/demo';
import { defaultSave } from '../src/economy/save';
import { carForLevel } from '../src/economy/cars';
import { KEEP_IDS, SITUATIONS } from '../src/economy/badges';

describe('시연용 마스터 상태', () => {
  it('새 저장본을 레벨 10 · 마스터 · 맨 위 차 · 뱃지로 채운다', () => {
    const s = demoMaster(defaultSave());
    expect(s.curriculum.level).toBe(10);
    expect(s.curriculum.bestLevel).toBe(10);
    expect(s.curriculum.mastered).toBe(true);
    expect(s.curriculum.badHabits).toEqual([]);
    expect(s.activeCarId).toBe(carForLevel(10)!.id);
    for (const k of KEEP_IDS) expect(s.badges.keepBest[k]).toBe(1);
    expect(s.badges.seen).toHaveLength(SITUATIONS.length);
    expect(s.badges.earned).toContain('master');
  });

  it('설정 · 다른 기록은 그대로 둔다', () => {
    const base = defaultSave();
    const s = demoMaster(base);
    expect(s.settings).toEqual(base.settings);
    expect(s.history).toEqual(base.history);
  });
});
