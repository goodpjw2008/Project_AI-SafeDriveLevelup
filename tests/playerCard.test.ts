import { describe, expect, it } from 'vitest';
import { playerCard, playerFoot } from '../src/ui/playerCard';

/*
  **레벨과 경험치는 어느 화면에서나 같은 칸이다** (ui/playerCard.ts) — 첫 화면(lg) · 결과 화면(md) · 운전 화면(hud).
  사용자가 "헷갈리지 않게 일관된 ui 로" 라고 해서 셋을 하나로 모았다. 크기만 다르고 뼈대(뱃지 · 호칭 · 숫자 · 막대)는 같아야 한다.
*/
describe('플레이어 칸', () => {
  const base = { level: 6 as const, xp: 150, need: 400, mastered: false, habitsLeft: 0 };

  it('세 크기가 같은 뼈대를 쓴다', () => {
    for (const size of ['lg', 'md', 'hud'] as const) {
      const html = playerCard(base, size);
      expect(html).toContain(`class="player ${size}`);
      expect(html).toContain('level-badge-wrap earned');
      // 호칭은 이름이 아니라 학습자가 키우는 능력이다 — 이름 딱지를 입히지 않는다 (ui/playerCard.ts)
      expect(html).toContain('<span class="player-name">안전운전 Level6</span>');
      expect(html).not.toContain('brand-');
      expect(html).toContain('<b>150</b> / 400 XP');
      expect(html).toContain('width:37.5%');
    }
  });

  it('운전 화면은 아랫줄을 두지 않는다 — 달리면서 읽을 것만', () => {
    expect(playerCard(base, 'hud')).not.toContain('player-foot');
    expect(playerCard(base, 'md')).toContain('Level7까지 250 XP');
  });

  it('이번 판에 얻은 만큼을 막대 끝에 따로 칠한다', () => {
    const html = playerCard({ ...base, xp: 250, gained: 100 }, 'md');
    expect(html).toContain('class="player-fill" style="width:37.5%"');
    expect(html).toContain('class="player-new" style="left:37.5%;width:25%"');
  });

  it('막대가 찼는데 습관이 남았으면 습관을 고치라고 말한다', () => {
    expect(playerFoot({ ...base, xp: 400, habitsLeft: 2 })).toBe('경험치가 가득 찼습니다 — 나쁜 습관 2개를 고치면 Level7');
    expect(playerCard({ ...base, xp: 400 }, 'lg')).toContain('class="player lg full');
  });

  it('Level10 은 마스터 전까지 뱃지에 점선 — 마스터면 MAX', () => {
    const l10 = { ...base, level: 10 as const, need: 1000 };
    expect(playerCard(l10, 'lg')).toContain('level-badge-wrap locked');
    expect(playerCard(l10, 'lg')).toContain('Level10 도전');
    const done = playerCard({ ...l10, mastered: true }, 'md');
    expect(done).toContain('level-badge-wrap earned');
    expect(done).toContain('>MAX<');
    expect(done).toContain('>안전운전 마스터<');
    // 마스터의 뱃지는 숫자 10 이 아니라 M — 첫 화면 레벨 길의 마지막 칸과 같은 그림이다
    expect(done).toContain('>M</text>');
    expect(done).not.toContain('>10</text>');
    expect(playerFoot({ ...l10, mastered: true })).toContain('Level10 코스가 무작위로');
  });
});

/*
  **결과 화면에서는 아랫줄을 끈다** (ui/Screens.ts 의 xpResult) — 사용자가 화면을 줄이며 뺐다.
  다만 막대가 가득 찼는데 습관 때문에 못 오른 판은 예외다: 이유를 적지 않으면 "왜 안 오르지?" 로 남는다.
*/
describe('아랫줄 끄기', () => {
  const base = { level: 6 as const, xp: 250, need: 500, mastered: false };

  it('끄면 아랫줄이 없다', () => {
    expect(playerCard(base, 'md', { foot: false })).not.toContain('player-foot-text');
    expect(playerCard(base, 'md')).toContain('player-foot-text');
  });

  it('켜면 습관 때문에 못 오른 이유가 그대로 보인다', () => {
    const stuck = { ...base, xp: 500, habitsLeft: 2 };
    expect(playerCard(stuck, 'md', { foot: true })).toContain('나쁜 습관 2개를 고치면');
  });

  /*
    **필요한 양이 나중에 줄어도 넘쳐 보이지 않는다** — 경험치 곡선을 줄였을 때(L6 500 → 300) 저장된 400 이 "400 / 300 XP" 로
    보일 뻔했다. 난이도를 쉽게 바꿔도 같다.
  */
  it('모은 경험치가 필요한 양을 넘으면 필요한 양까지만 보인다', () => {
    const over = { ...base, xp: 400, need: 300 };
    const html = playerCard(over, 'md');
    expect(html).toContain('<b>300</b> / 300 XP');
    expect(html).not.toContain('<b>400</b>');
    expect(playerFoot(over)).toContain('준비 완료');
  });
});
