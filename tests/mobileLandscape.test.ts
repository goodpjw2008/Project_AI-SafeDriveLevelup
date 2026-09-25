/**
 * 손에 든 **가로** 화면의 첫 화면 — 넓고 낮은 화면을 **두 칸으로** 편다.
 *
 * 가로로 들면 높이가 335px 남짓이다. 세로에서 쓰던 "위에서 아래로" 차례로는 정작 눌러야 할
 * 연습 버튼이 화면 두 배쯤 아래에 있었다 (사용자가 사진으로 짚었다: *"한참 내려야 보여"*).
 * 왼쪽은 *지금 나는 어디쯤인가*(레벨 · 차), 오른쪽은 *지금 할 것*(연습 버튼)이다.
 *
 * 이 결정도 `src/index.html` 의 미디어 쿼리 한 덩어리에 들어 있다. **조건이 느슨해지면
 * PC 와 세로 휴대폰이 휩쓸린다** — 사용자가 못 박은 것이 그것이다: *"PC, 모바일 세로 화면은
 * 절대로 수정하지 말고 가로 화면 상태만 수정해줘."* 그래서 소스에서 그 덩어리를 읽어
 * 조건과 목록, 그리고 **손대는 범위**까지 그대로 못 박는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');

const COND = '@media (orientation: landscape) and (pointer: coarse) and (max-height: 540px)';
/** 가장 넓은 가로 — 조건이 셋뿐인 덩어리 */
const HEAD = `${COND} {`;
/** 좁아질 때마다 한 단계씩 — 넓은 쪽 조건을 그대로 물려받고 폭 하나를 더 건다 */
const NARROW = `${COND} and (max-width: 860px) {`;
const TINY = `${COND} and (max-width: 760px) {`;
const ALL = [HEAD, NARROW, TINY];

/** 가로 휴대폰 전용 덩어리 — 여는 중괄호부터 짝이 맞는 닫는 중괄호까지 */
const block = (head = HEAD): string => {
  const at = html.indexOf(head);
  if (at < 0) throw new Error(`가로 휴대폰 전용 미디어 쿼리를 찾지 못했다: ${head}`);
  let depth = 0;
  for (let i = at + head.length - 1; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(at, i + 1);
  }
  throw new Error('미디어 쿼리가 닫히지 않았다');
};

/** 주석을 걷어낸 규칙만 */
const rules = (head?: string): string => block(head).replace(/\/\*[\s\S]*?\*\//g, '');

/** 덩어리 안의 선택자들 — `{` 앞에 오는 줄들 */
const selectors = (head: string = HEAD): string[] =>
  rules(head)
    .slice(head.length)
    .split('{')
    .slice(0, -1)
    .flatMap((chunk) => chunk.split('}').at(-1)!.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

describe('가로 휴대폰의 첫 화면', () => {
  /*
    **셋이 모두 맞을 때만 걸린다** — 가로 · 손가락 · 낮은 화면.
    `pointer: coarse` 가 PC 를 지킨다(창을 아무리 낮춰도 마우스는 coarse 가 아니다).
    `orientation: landscape` 가 세로 휴대폰을 지킨다. 높이 자는 태블릿 가로를 그대로 둔다 —
    주행 화면의 가로 규칙과 **같은 자(540px)** 를 쓴다.
  */
  it('조건이 셋 다 붙어 있다 — 하나라도 빠지면 PC 나 세로가 휩쓸린다', () => {
    const b = block();
    expect(b).toContain('orientation: landscape');
    expect(b).toContain('pointer: coarse');
    expect(b).toContain('max-height: 540px');
    expect(b).not.toContain('orientation: portrait');
    // 주행 화면의 가로 규칙과 같은 자를 쓴다
    expect(html).toContain('@media (orientation: landscape) and (max-height: 540px) {');
  });

  /*
    **손대는 곳은 첫 화면뿐이다.** 규칙 하나라도 `#screen-menu` 밖으로 나가면 주행 화면 ·
    결과 화면 · 설정까지 가로에서 달라진다. 사용자가 고쳐 달라고 한 것은 첫 화면이다.
  */
  it('모든 규칙이 첫 화면 안에만 걸린다', () => {
    for (const head of ALL) {
      for (const sel of selectors(head)) {
        expect(sel.startsWith('#screen-menu'), `${sel} 가 첫 화면 밖으로 나갔다`).toBe(true);
      }
    }
  });

  /*
    **접는 것** — 세로 화면과 같은 기준이다. 여기서 할 일은 연습을 누르는 것이고,
    전시관 · About · 저작권 · 맵 체험 · 뱃지 요약 · 습관 문단 · 오프라인 교육은 그 다음 일이다.
    레벨 길(11칸)은 반쪽 칸에 들어가지 않아 옆 칸으로 비어져 나갔다.
  */
  it('둘러보는 것들을 접는다 — 설정 톱니는 남긴다', () => {
    const r = rules();
    for (const id of ['#btn-shop', '#btn-about', '#btn-credits', '#btn-trial']) {
      expect(r).toContain(`#screen-menu ${id}`);
    }
    for (const cls of ['.badge-summary', '.ai-habits']) {
      expect(r).toContain(`#screen-menu ${cls}`);
    }
    expect(r).toContain('#screen-menu .mode-split > .mode-group:nth-child(2)');
    // 설정 톱니와 규정 안내 둘은 남는다 — 접는 목록에 없어야 한다
    expect(r).not.toContain('#btn-settings');
    expect(r).not.toContain('#btn-help');
    expect(r).not.toContain('#btn-zone-help');
  });

  /*
    **연습 버튼은 어떤 규칙으로도 감추지 않는다.** 이 화면에서 누를 것은 이것 하나다 —
    접는 목록이 늘어나다 여기까지 번지면 첫 화면이 아무 쓸모가 없어진다.
  */
  it('연습 버튼과 차 그림은 남는다', () => {
    const r = ALL.map((h) => rules(h)).join('\n');
    expect(r).not.toMatch(/#btn-generate[^{]*\{[^}]*display:\s*none/);
    expect(r).not.toMatch(/\.ai-car[^{]*\{[^}]*display:\s*none/);
    // 차 그림은 감추는 대신 줄인다 (사용자가 세로에서 "차량은 보여야 해" 라고 했다)
    expect(rules(NARROW)).toMatch(/#screen-menu \.ai-car-photo \{\s*height:/);
  });

  /*
    **세 칸 — 레벨 | 자동차 | 연습** (사용자가 그림으로 정했다). 레벨 아래에 차를 두던 것을
    옆으로 옮겼다: 가로 화면에서 아까운 것은 높이이지 폭이 아니다. 셋이 한 줄이므로
    차례(1 · 2 · 3)가 뒤바뀌면 그림과 달라진다 — 그래서 칸 번호까지 못 박는다.
  */
  it('첫 화면 상자를 레벨 · 자동차 · 연습 세 칸으로 편다', () => {
    const r = rules();
    expect(r).toMatch(/#screen-menu \.ai-course \{[^}]*display:\s*grid/);
    expect(r).toMatch(/grid-template-columns:\s*minmax\(min-content, 1fr\) auto minmax\(0, 340px\)/);
    expect(r).toMatch(/#screen-menu \.ai-course > \.player \{[^}]*grid-column:\s*1/);
    expect(r).toMatch(/#screen-menu \.ai-split \{[^}]*grid-column:\s*2/);
    expect(r).toMatch(/#screen-menu \.mode-split \{[^}]*grid-column:\s*3/);
    // 셋이 한 줄이다 — 한 칸이라도 아래로 내려가면 상자가 한 줄만큼 높아진다
    for (const sel of ['\\.ai-course > \\.player', '\\.ai-split', '\\.mode-split']) {
      expect(r).toMatch(new RegExp(`#screen-menu ${sel} \\{[^}]*grid-row:\\s*1`));
    }
  });

  /*
    **길 안내 버튼은 맨 윗줄에서 성공 · 실패와 한 줄을 나눠 쓴다** (사용자가 정했다).
    혼자 한 줄을 쓰던 것을 걷어내 그만큼을 이름과 연습 버튼에 돌려준다. 글에서의 차례가
    화면과 다르므로(성공 · 실패가 먼저 적혀 있다) 자리를 칸으로 직접 짚어야 한다.
  */
  it('길 안내 버튼과 성공 · 실패가 맨 윗줄을 나눠 쓴다', () => {
    const r = rules();
    expect(r).toMatch(/#screen-menu \.screen-inner \{[^}]*display:\s*grid/);
    expect(r).toMatch(/#screen-menu \.menu-links \{[^}]*grid-row:\s*1;[^}]*grid-column:\s*1/);
    expect(r).toMatch(/#screen-menu \.site-stats \{[^}]*grid-row:\s*1;[^}]*grid-column:\s*2/);
    // 이름 · 상자 · 저작권은 그 아래로 차례대로 — 자리를 안 주면 첫 줄 옆에 끼어든다
    expect(r).toMatch(/#screen-menu \.hero \{[^}]*grid-row:\s*2/);
    expect(r).toMatch(/#screen-menu \.ai-course \{[^}]*grid-row:\s*3/);
    expect(r).toMatch(/#screen-menu \.site-footer \{[^}]*grid-row:\s*4/);
  });

  /*
    **작아진 버튼에서는 아이콘을 뺀다** (사용자가 정했다) — 다만 **글자가 없는 버튼**
    (설정 톱니)에서 빼면 빈 상자만 남는다. 실제로 한 번 그렇게 나왔다.
  */
  it('길 안내 버튼의 아이콘은 빼되 톱니는 남긴다', () => {
    expect(rules()).toMatch(/#screen-menu \.menu-links button:not\(\.icon\) svg \{\s*display:\s*none/);
  });

  /*
    **더 좁은 가로 화면**(작은 휴대폰)에서는 레벨 줄이 두 줄로 꺾여 버튼 아래가 잘렸다.
    호칭을 `안전운전 L1` 로 줄인다 — 세로 화면에서 쓰는 것과 같은 수법(.lv-word)이다.
  */
  it('좁은 가로 화면은 호칭을 줄인다 — 조건은 넓은 쪽을 그대로 물려받는다', () => {
    // 좁아지는 단계마다 셋을 그대로 물려받는다 — 하나라도 빠지면 그 단계에서 PC 가 휩쓸린다
    for (const head of ALL) {
      const b = block(head);
      expect(b).toContain('orientation: landscape');
      expect(b).toContain('pointer: coarse');
      expect(b).toContain('max-height: 540px');
    }
    expect(rules(NARROW)).toMatch(/#screen-menu \.lv-word \{\s*display:\s*none/);
  });

  /*
    **레벨 칸은 글이 잘리지 않는다.** 좁은 화면에서 세 칸이 폭을 다투면 `0 / 200 XP` 가
    차 그림 뒤로 잘렸다 — 실제로 한 번 그렇게 나왔다. 레벨 칸이 적어도 `min-content` 는
    받게 해 두면, 모자라는 몫은 연습 칸에서 먼저 나온다.
  */
  it('레벨 칸은 글이 다 들어가는 만큼은 받는다', () => {
    expect(rules()).toMatch(
      /#screen-menu \.ai-course \{[^}]*grid-template-columns:\s*minmax\(min-content, 1fr\)/,
    );
  });

  /*
    **첫 줄의 버튼은 성공 · 실패 알약과 같은 키다** (사용자가 정했다). 늘어나게 두면
    가장 키 큰 버튼(톱니)에 맞춰 줄 전체가 두꺼워진다 — 실제로 44px 이 되어 있었다.
  */
  it('첫 줄 버튼은 성공 · 실패와 같은 키로, 그 옆에 붙는다', () => {
    const r = rules();
    expect(r).toMatch(/#screen-menu \.menu-links \{[^}]*justify-self:\s*end/);
    expect(r).toMatch(/#screen-menu \.menu-links \{[^}]*align-items:\s*center/);
    // 알약과 같은 여백 · 글자 크기 (index.html 의 .site-stat — 5px 12px · 13px)
    expect(r).toMatch(/#screen-menu \.menu-links button \{[^}]*padding:\s*5px 11px/);
    expect(r).toMatch(/#screen-menu \.menu-links button \{[^}]*font-size:\s*13px/);
    expect(r).toMatch(/#screen-menu \.menu-links button\.icon \{/);
  });

  /*
    **이름은 세로 화면과 같은 크기다** (사용자가 정했다) — 한 작품의 이름이 기기를 돌렸다고
    커졌다 작아지면 같은 물건으로 읽히지 않는다. 세로에서 쓰는 값은 26 · 22 · 18px 이다.
    아주 좁은 화면(700px 미만)만 예외다 — 거기서는 한 줄에 들어가지 못해 통째로 꺾인다.
  */
  it('이름은 세로 화면과 같은 크기다', () => {
    const r = rules();
    expect(r).toMatch(/#screen-menu \.brand \{\s*font-size:\s*26px/);
    expect(r).toMatch(/#screen-menu \.brand-colon \{\s*font-size:\s*22px/);
    expect(r).toMatch(/#screen-menu \.brand-sub \{\s*font-size:\s*18px/);
    // 줄이는 곳은 아주 좁은 단계뿐이다
    expect(rules(NARROW)).not.toContain('.brand');
    expect(rules(TINY)).toMatch(/#screen-menu \.brand \{\s*font-size:/);
  });

  /*
    **레벨 길(①②③…M)은 세로 화면처럼 이름 아래에 남는다** (사용자가 정했다).
    한때 접었었다 — 두 칸이던 시절 반쪽 칸에 열한 칸이 들어가지 않았기 때문이다. 지금은
    레벨 칸이 남는 폭을 모두 가져가므로 자리가 난다. **아주 좁은 화면에서만** 접는다:
    거기서는 길이 차지한 만큼 연습 버튼의 글이 두 줄로 꺾여 화면 하나를 넘겼다.
  */
  it('레벨 길은 이름 아래에 남고, 아주 좁은 화면에서만 접는다', () => {
    expect(rules()).not.toMatch(/#screen-menu \.level-track[^{]*\{[^}]*display:\s*none/);
    // 칸을 줄여야 들어간다 — 기본 크기(30px) 그대로면 옆 칸으로 비어져 나간다
    expect(rules()).toMatch(/#screen-menu \.player-foot \.level-step \{[^}]*width:\s*\d+px/);
    expect(rules(TINY)).toMatch(/#screen-menu \.level-track \{\s*display:\s*none/);
  });

  /*
    **저작권 줄은 세로 화면과 같은 글이다** (사용자가 정했다) —
    `Copyright © 2026 · goodpjw2008 · 비영리 목적 사용`. 메일은 앞부분만 보이지만
    **링크는 그대로**라 눌러서 메일을 쓸 수 있다.
  */
  it('저작권 줄은 세로 화면과 같은 글이다', () => {
    const r = rules();
    expect(r).toMatch(/#screen-menu \.site-footer \.usage-long \{\s*display:\s*none/);
    expect(r).toMatch(/#screen-menu \.site-footer \.usage-short \{\s*display:\s*inline/);
    expect(r).toMatch(/#screen-menu \.site-footer \.mail-host \{\s*display:\s*none/);
  });

  /*
    **차는 폭이 아니라 높이로 잰다** (사용자가 정했다: *"남은 공간 높이에 꽉 맞게"*).
    높이로 재야 4:3 비율대로 커지고, 칸 폭(`auto`)도 그림을 따라 저절로 정해진다.
  */
  it('차 그림은 높이로 재서 줄을 채운다', () => {
    expect(rules()).toMatch(/#screen-menu \.ai-car-photo \{[^}]*height:\s*\d+px/);
    expect(rules()).toMatch(/#screen-menu \.ai-car-photo \{[^}]*max-width:\s*none/);
  });
});
