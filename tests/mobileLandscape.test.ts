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

const HEAD = '@media (orientation: landscape) and (pointer: coarse) and (max-height: 540px) {';
/** 더 좁은 가로 화면 — 넓은 쪽 조건을 그대로 물려받고 폭 하나를 더 건다 */
const NARROW = `${HEAD.slice(0, -2)} and (max-width: 760px) {`;

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
    for (const head of [HEAD, NARROW]) {
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
    for (const cls of ['.badge-summary', '.ai-habits', '.level-track']) {
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
    const r = rules() + rules(NARROW);
    expect(r).not.toMatch(/#btn-generate[^{]*\{[^}]*display:\s*none/);
    expect(r).not.toMatch(/\.ai-car[^{]*\{[^}]*display:\s*none/);
    // 차 그림은 감추는 대신 줄인다 (사용자가 세로에서 "차량은 보여야 해" 라고 했다)
    expect(r).toMatch(/#screen-menu \.ai-car-photo \{\s*max-width:/);
  });

  /*
    **세 칸 — 레벨 | 자동차 | 연습** (사용자가 그림으로 정했다). 레벨 아래에 차를 두던 것을
    옆으로 옮겼다: 가로 화면에서 아까운 것은 높이이지 폭이 아니다. 셋이 한 줄이므로
    차례(1 · 2 · 3)가 뒤바뀌면 그림과 달라진다 — 그래서 칸 번호까지 못 박는다.
  */
  it('첫 화면 상자를 레벨 · 자동차 · 연습 세 칸으로 편다', () => {
    const r = rules();
    expect(r).toMatch(/#screen-menu \.ai-course \{[^}]*display:\s*grid/);
    expect(r).toMatch(/#screen-menu \.ai-course \{[^}]*grid-template-columns:[^;]*minmax[^;]*minmax[^;]*minmax/);
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
    const b = block(NARROW);
    expect(b).toContain('orientation: landscape');
    expect(b).toContain('pointer: coarse');
    expect(b).toContain('max-height: 540px');
    expect(rules(NARROW)).toMatch(/#screen-menu \.lv-word \{\s*display:\s*none/);
  });
});
