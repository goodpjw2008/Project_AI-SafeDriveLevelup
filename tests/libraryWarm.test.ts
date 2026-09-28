import { describe, expect, it } from 'vitest';
import { allCombinations, AXES, libraryReady, scenarioLibrary, warmLibrary } from '../src/scenarios/library';

/**
 * **라이브러리를 나눠 만들어도 한 번에 만든 것과 같다** (library.ts 의 warmLibrary · stepWalk).
 *
 * 첫 화면이 뜬 뒤 30ms 씩 나눠 만들다가, 도중에 누가 동기로 scenarioLibrary() 를 불러도 같은 배열 하나로 끝나야 한다 —
 * 두 벌이 생기면 번호(libraryNumber)와 레벨이 어긋난다. 조합 걷기는 예전 재귀와 같은 차례(첫 축이 가장 느리게)여야
 * 번호가 그대로다 — 첫 조합은 모든 축이 0 번 값이고, 마지막 축이 먼저 돈다.
 */
describe('라이브러리 나눠 만들기', () => {
  it('warmLibrary 와 scenarioLibrary 는 같은 배열 하나를 준다', async () => {
    const warm = warmLibrary(); // 나눠 만들기 시작
    const sync = scenarioLibrary(); // 그 사이에 동기로 부른다 — 남은 것을 이어서 끝낸다
    expect(libraryReady()).toBe(true);
    const warmed = await warm;
    expect(warmed).toBe(sync);
    expect(sync.length).toBe(22818);
    expect(await warmLibrary()).toBe(sync);
  });

  it('조합 걷기의 차례 — 첫 축이 가장 느리게, 마지막 축이 가장 빠르게 돈다', () => {
    const all = allCombinations();
    const keys = (Object.keys(AXES) as (keyof typeof AXES)[]).filter((k) => k !== 'side');
    const first = all[0];
    for (const k of keys) expect(first[k]).toBe(AXES[k][0]);
    // 태그의 키 차례 — 열세 축 뒤에 side (예전 재귀 걷기와 같다, JSON 도 같다)
    expect(Object.keys(first)).toEqual([...keys, 'side']);
    // flip 은 auto 쌍둥이 바로 뒤에 선다
    for (let i = 0; i < all.length; i++) {
      if (all[i].side !== 'flip') continue;
      const twin = { ...all[i - 1], side: 'flip' };
      expect(all[i]).toEqual(twin);
    }
    // 같은 조합이 두 번 나오지 않는다
    expect(new Set(all.map((t) => JSON.stringify(t))).size).toBe(all.length);
  });
});
