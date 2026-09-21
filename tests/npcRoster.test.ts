import { describe, expect, it } from 'vitest';
import { pickNpcRoster } from '../src/game/npcVehicles';
import { CARS } from '../src/economy/cars';

describe('NPC 배역표', () => {
  it('내 차는 배역에서 빠진다', () => {
    for (let i = 0; i < 50; i++) {
      const r = pickNpcRoster('avante', ['m8'], 3);
      expect(r.some((c) => c.id === 'avante')).toBe(false);
    }
  });

  it('서로 다른 차종으로 채운다', () => {
    for (let i = 0; i < 50; i++) {
      const r = pickNpcRoster('avante', ['m8'], 3);
      expect(r).toHaveLength(3);
      expect(new Set(r.map((c) => c.id)).size).toBe(3);
    }
  });

  /*
    예전 버그가 여기였다 — 받아 둔 차가 하나뿐이면 후보가 그 한 대로 붕괴해
    도로 위 차가 전부 같은 차가 됐다.
  */
  it('받아 둔 차가 하나뿐이어도 한 대로 붕괴하지 않는다', () => {
    const r = pickNpcRoster('avante', ['m8'], 3);
    expect(new Set(r.map((c) => c.id)).size).toBe(3);
  });

  it('판마다 새 얼굴이 하나씩 들어온다', () => {
    // 카탈로그가 다 데워질 때까지 캐시가 계속 늘어야 한다
    const loaded = new Set(['m8']);
    for (let i = 0; i < 12; i++) {
      const before = loaded.size;
      for (const c of pickNpcRoster('avante', [...loaded], 3)) loaded.add(c.id);
      if (before < CARS.length - 1) expect(loaded.size).toBeGreaterThan(before);
    }
    // 내 차를 뺀 나머지가 전부 돌았다
    expect(loaded.size).toBe(CARS.length - 1);
  });

  it('뽑을 수 있는 것보다 많이 달라고 하면 있는 만큼만 준다', () => {
    const r = pickNpcRoster('avante', [], 99);
    expect(r).toHaveLength(CARS.length - 1);
  });
});
