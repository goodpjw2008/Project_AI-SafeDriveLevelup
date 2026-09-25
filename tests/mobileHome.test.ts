/**
 * 손에 든 세로 화면의 첫 화면 — **무엇을 접고, 무엇을 남기는가.**
 *
 * PC 에서는 첫 화면이 한 번에 들어오지만 세로 휴대폰에서는 연습 버튼까지 내려가야 했다.
 * 사용자가 정했다 — 세로 휴대폰에서는 *지금 할 것*(레벨 · 차 · 연습 버튼)만 남기고
 * 둘러보는 것들은 접는다. 그리고 **PC 는 건드리지 않는다.**
 *
 * 이 결정은 `src/index.html` 의 미디어 쿼리 한 덩어리에 들어 있다. 규칙이 흩어지거나
 * 조건이 느슨해지면(예: `pointer: coarse` 가 빠지면) **창을 좁힌 PC 에서도 메뉴가 사라진다.**
 * 그래서 소스에서 그 덩어리를 읽어 조건과 목록을 그대로 못 박는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');

/** 세로 휴대폰 전용 덩어리 — 여는 중괄호부터 짝이 맞는 닫는 중괄호까지 */
const mobileBlock = (): string => {
  const head = '@media (orientation: portrait) and (pointer: coarse) and (max-width: 720px) {';
  const at = html.indexOf(head);
  if (at < 0) throw new Error('세로 휴대폰 전용 미디어 쿼리를 찾지 못했다');
  let depth = 0;
  for (let i = at + head.length - 1; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(at, i + 1);
  }
  throw new Error('미디어 쿼리가 닫히지 않았다');
};

/** 주석을 걷어낸 규칙만 — 주석에 적은 설명("차 그림(.ai-car)은 남긴다")이 검사에 걸리면 안 된다 */
const rulesOnly = (): string => mobileBlock().replace(/\/\*[\s\S]*?\*\//g, '');

describe('세로 휴대폰의 첫 화면', () => {
  /*
    **세 가지가 모두 맞을 때만 걸린다** — 세로 · 손가락 · 좁은 화면.
    `pointer: coarse` 가 PC 를 지켜 준다: 창을 아무리 좁혀도 마우스는 coarse 가 아니다.
  */
  it('조건이 셋 다 붙어 있다 — 하나라도 빠지면 PC 가 휩쓸린다', () => {
    const block = mobileBlock();
    expect(block).toContain('orientation: portrait');
    expect(block).toContain('pointer: coarse');
    expect(block).toContain('max-width: 720px');
  });

  it('둘러보는 메뉴 넷을 접는다', () => {
    const block = mobileBlock();
    for (const id of ['#btn-shop', '#btn-about', '#btn-credits', '#btn-trial']) {
      expect(block).toContain(`.menu-links ${id}`);
    }
  });

  /* 배우는 글 둘과 설정은 남는다 — 여기서 규칙을 확인하고, 설정으로 갈래를 고른다 */
  it('배우는 글과 설정은 접지 않는다', () => {
    const block = rulesOnly();
    for (const id of ['#btn-help', '#btn-zone-help', '#btn-settings']) {
      expect(block).not.toContain(id);
    }
  });

  it('뱃지 요약 · 나쁜 운전 습관 · 오프라인 교육 활용을 접는다', () => {
    const block = mobileBlock();
    expect(block).toContain('.badge-summary');
    expect(block).toContain('.ai-habits');
    expect(block).toContain('.mode-split > .mode-group:nth-child(2)');
  });

  /*
    **차 그림은 남긴다.** 차가 레벨의 얼굴이라, 습관 칸을 접으면서 차까지 접으면
    "왜 레벨을 올리는가" 가 화면에서 사라진다 (사용자가 짚었다: "차량은 보여야 해").
  */
  it('차 그림과 온라인 연습은 남긴다', () => {
    const block = rulesOnly();
    expect(block).not.toContain('.ai-car');
    expect(block).not.toContain('nth-child(1)');
  });

  /*
    **첫 화면에서 더 걷어낸 둘** — 부제의 '연습편' 과 레벨 칸 아래 안내 줄.
    둘 다 바로 옆이 같은 말을 하고 있다: 무엇을 연습하는지는 앞의 세 낱말이, 얼마나 남았는지는
    바로 위의 막대와 숫자가. 레벨 길(1~10 · M)은 남긴다 — 그건 어디까지 왔는지를 말하는 유일한 줄이다.
  */
  it("부제의 '연습편' 과 레벨 칸 아래 안내 줄을 접는다 — 첫 화면에서만", () => {
    const block = rulesOnly();
    expect(block).toContain('#screen-menu .brand-keep');
    expect(block).toContain('#screen-menu .player-foot-text');
  });

  /* AI 가 맵을 고르는 창 — 좁은 화면에서 카드가 두 배로 길어지던 줄 */
  it("AI 고르는 창의 '추천 사유' 를 접는다", () => {
    expect(rulesOnly()).toContain('.ai-pick-why');
  });

  /*
    **판 이름은 번호까지만.** "AI 추천 시나리오 L01311 - 적색 - 우회전 후 무단횡단하려는 보행자 · …" 에서
    뒤의 조건 나열이 세로 화면에서 두세 줄로 접혀 하늘과 전방 신호등을 가렸다. 감추려면 글자 마디가 아니라
    **span 으로 감싸져 있어야 한다** — 그래서 Hud.ts 와 Screens.ts 에 `.scn-title` · `.head-title` 을 두었다.
  */
  it('주행 중과 결과 화면의 판 이름을 번호까지만 둔다', () => {
    const block = rulesOnly();
    expect(block).toContain('#hud-scenario .sep');
    expect(block).toContain('#hud-scenario .scn-title');
    expect(block).toContain('#screen-debrief .screen-head h1 .head-title');
  });

  /* 감출 손잡이가 실제로 붙어 있는가 — 마디로 두면 CSS 가 잡지 못한다 */
  it('감출 제목이 span 으로 감싸져 있다', () => {
    const hud = readFileSync(fileURLToPath(new URL('../src/ui/Hud.ts', import.meta.url)), 'utf8');
    const screens = readFileSync(fileURLToPath(new URL('../src/ui/Screens.ts', import.meta.url)), 'utf8');
    expect(hud).toContain('class="scn-title"');
    expect(screens).toContain('class="head-title"');
  });

  /*
    **남은 메뉴 넷은 한 줄에 선다** (사용자가 정했다). 접고 남은 넷이 두 줄로 갈라져 톱니만
    아랫줄에 홀로 있었다. 글자 앞 아이콘을 빼면 360px 폭에서도 한 줄에 들어간다.
    **톱니는 예외다** — 그 버튼에는 글자가 없어 아이콘이 이름이다.
  */
  it('메뉴는 한 줄에 서고, 글자 버튼의 아이콘만 뺀다', () => {
    const block = rulesOnly();
    expect(block).toContain('flex-wrap: nowrap');
    expect(block).toContain('#screen-menu .menu-links button:not(.icon) svg');
    // 톱니(.icon)까지 함께 지우는 선택자가 아니어야 한다
    expect(block).not.toMatch(/\.menu-links button svg\s*\{/);
  });

  it('이름 · 부제 · 메뉴 · 온라인 연습 줄을 같은 가운데 축에 놓는다', () => {
    const block = rulesOnly();
    expect(block).toContain('#screen-menu .brand-wrap');
    expect(block).toContain('#screen-menu .mode-label');
    // 메뉴 줄도 같은 축이다 (사용자가 정했다) — 한 줄로 만든 규칙 안에 가운데 맞춤이 들어 있다
    expect(block).toMatch(/#screen-menu \.menu-links \{[^}]*justify-content: center;/);
    expect(block).toMatch(/#screen-menu \.brand,\s*#screen-menu \.brand-sub \{\s*text-align: center;/);
  });

  /*
    **저작권 줄까지 한 화면에 들어온다.** 휴대폰 브라우저는 주소창과 내비게이션 바가 화면을 먹어
    보이는 높이가 770px 안팎이다 — 접고 나서도 마지막 줄이 잘렸다 (사용자가 사진으로 짚었다).

    **줄이는 것은 여백뿐이다.** 손가락으로 누르는 화면에서 버튼을 줄이면 못 누르고 글자를 줄이면
    못 읽는다. 그래서 글자 크기(`font-size`)와 버튼 크기는 이 덩어리에서 건드리지 않는다.
  */
  it('첫 화면은 여백을 줄여 자리를 만든다 — 글자를 깎지 않는다', () => {
    const block = rulesOnly();
    for (const sel of ['#screen-menu .screen-inner', '#screen-menu .hero', '#screen-menu .site-footer']) {
      expect(block).toContain(sel);
    }
    /*
      첫 화면(`#screen-menu`) 규칙만 모아서 본다 — 결과 화면은 글자를 한 단계 줄이는 것이
      바로 그 일이라(제목을 한 줄에 세운다) 함께 재면 늘 걸린다.
    */
    const homeRules = [...block.matchAll(/#screen-menu[^{]*\{[^}]*\}/g)].map((m) => m[0]).join('\n');
    expect(homeRules).not.toContain('font-size');
    expect(homeRules).not.toContain('transform: scale');
  });

  /*
    **호칭은 `안전운전 L1`** — 호칭과 경험치 숫자가 한 줄에 들어가지 않아 두 줄로 접혔다
    (사용자가 사진으로 짚었다). `Level` 의 'evel' 만 감춘다 — 값(curriculum.ts 의 courseTitle)은
    그대로라 읽어 주는 글과 저장된 것은 바뀌지 않는다. 번 자리는 연습 버튼이 가져간다.
  */
  it("호칭을 '안전운전 L1' 로 줄이고 그 자리를 연습 버튼에 준다", () => {
    const block = rulesOnly();
    expect(block).toMatch(/#screen-menu \.lv-word \{\s*display: none;/);
    expect(block).toMatch(/#screen-menu \.mode-split \.ai-course-actions button \{\s*min-height:/);
    const card = readFileSync(fileURLToPath(new URL('../src/ui/playerCard.ts', import.meta.url)), 'utf8');
    expect(card).toContain('class="lv-word"');
  });

  /* 새 뱃지 줄 — 글 칸이 세로 flex 라 '새 뱃지' 와 이름이 위아래로 갈라져 있었다 */
  it('새 뱃지는 한 줄로 적는다 — 까닭 줄만 아랫줄', () => {
    const block = rulesOnly();
    expect(block).toMatch(/#screen-debrief \.badge-ev-text \{[^}]*flex-direction: row;/);
    expect(block).toMatch(/#screen-debrief \.badge-ev small \{\s*flex-basis: 100%;/);
  });

  /* 좁은 화면에서 로봇이 왼쪽을 차지해 코칭 문장이 두세 글자씩 끊겼다 — 이 칸은 글이 주인공이다 */
  it('결과 화면의 로봇을 접어 글에 자리를 준다', () => {
    expect(rulesOnly()).toMatch(/#screen-debrief \.verdict \.verdict-robot \{\s*display: none;/);
  });

  /* 레벨이 오른 순간이 구석에서 일어난 것처럼 보이면 안 된다 — 상자도 내용도 가운데 */
  it('레벨업 배너는 상자도 내용도 가운데에 둔다', () => {
    const block = rulesOnly();
    expect(block).toMatch(/#screen-debrief \.level-change \{[^}]*flex-basis: 100%;/);
    expect(block).toMatch(/#screen-debrief \.level-change \{[^}]*margin-left: auto;/);
  });

  /*
    **손에 든 세로 화면에서는 시간이 조금 천천히 흐른다** (사용자가 정했다). 화면의 화살표 버튼은
    키보드보다 뭉툭해 같은 판이 휴대폰에서 훨씬 어려웠다. 판을 쉽게 만드는 대신 시간을 늦춘다 —
    보고 판단할 틈은 벌어지되 **무엇이 위반인지는 그대로다.**

    늦추는 정도는 사용자가 직접 몰아 보며 두 번 올렸다 (0.5 → 2/3 → 0.8). 너무 느리면
    그것대로 실제 도로와 멀어진다.

    한 곳(`dt`)에서만 곱해야 차 · 보행자 · 앞차 · 신호 · 제한시간이 **같은 비율로** 느려진다.
    화면 규칙과 조건이 같아야 가로로 돌렸을 때 곧바로 제 속도로 돌아온다.
  */
  it('세로 휴대폰에서는 판이 조금 천천히 흐른다 — 조건은 화면 규칙과 같다', () => {
    const game = readFileSync(fileURLToPath(new URL('../src/game/Game.ts', import.meta.url)), 'utf8');
    expect(game).toContain('(orientation: portrait) and (pointer: coarse) and (max-width: 720px)');
    expect(game).toMatch(/matches \? 0\.8 : 1/);
    // dt 한 곳에서만 곱한다 — 두 곳에서 곱하면 판정이 어긋난다
    expect([...game.matchAll(/paceScale\(\)/g)].length).toBe(2);
  });

  /*
    **세로 휴대폰에서는 경적 안내를 띄우지 않는다** (사용자가 정했다) — 좁은 화면에서 안내 상자가
    도로 한가운데를 덮어 정작 봐야 할 신호와 보행자를 가렸다.
    **경적 소리는 그대로 울린다** — 재촉의 압박을 만드는 것은 소리이지 글이 아니다.
  */
  it('손에 든 화면에서는 뒤차 경적 안내를 띄우지 않는다 — 소리는 그대로', () => {
    const game = readFileSync(fileURLToPath(new URL('../src/game/Game.ts', import.meta.url)), 'utf8');
    const honk = game.slice(game.indexOf('this.audio.horn();'), game.indexOf('뒷차가 경적을 울립니다') + 40);
    expect(honk).toContain('this.audio.horn();');
    /*
      **세로만이 아니라 가로도 막는다.** 이 경적은 서 있는 동안 3.5~6.5초마다 되풀이되는데
      (TrafficCar 의 honkCooldown), 가로에서만 상자가 떠서 신호를 기다리는 내내 떴다 사라지기를
      반복했다 — 사용자가 "주행 중 가만히 둬도 화면이 자꾸 깜빡거린다" 고 한 것이 이것이었다.
    */
    expect(honk).toContain('!this.smallScreen?.matches');
    expect(honk).not.toContain('!this.handheld?.matches');
    // 소리를 끄는 것이 아니다 — 소리 줄은 조건 밖에 있어야 한다
    expect(honk.indexOf('this.audio.horn();')).toBeLessThan(honk.indexOf('!this.smallScreen?.matches'));
  });

  /*
    **'손에 든 화면' 은 세로 · 가로 두 덩어리를 합친 것이다** — 화면 규칙(index.html)과 같은 자다.
    조건이 느슨해지면 PC 에서도 안내가 사라진다: `pointer: coarse` 가 그것을 막는다.
  */
  it('손에 든 화면 조건은 화면 규칙 두 덩어리를 그대로 합친 것이다', () => {
    const game = readFileSync(fileURLToPath(new URL('../src/game/Game.ts', import.meta.url)), 'utf8');
    // 쓰는 곳이 파일 앞쪽에 있으므로 **선언**을 집어서 읽는다
    const at = game.indexOf('private readonly smallScreen');
    const block = game.slice(at, at + 400);
    expect(block).toContain('(orientation: portrait) and (pointer: coarse) and (max-width: 720px)');
    expect(block).toContain('(orientation: landscape) and (pointer: coarse) and (max-height: 540px)');
    // 판이 흐르는 속도는 세로에서만 늦춘다 — 가로까지 늦추면 사용자가 정하지 않은 난이도가 바뀐다
    expect(game).toMatch(/this\.handheld\?\.matches \? 0\.8 : 1/);
  });

  /*
    **세로 휴대폰에서는 좌·우·후방 시야 창을 시점도 화질도 가리지 않고 켠다** (사용자가 정했다).

    이 창이 풀려던 문제 — 횡단보도 양 끝이 화면 밖으로 밀려난다(PeripheralView.ts 의 실측
    좌 78° · 우 67°) — 는 좁은 세로 화면에서 **더 심하다.** 게다가 휴대폰에는 시점 전환 버튼이
    없어 운전석 시점으로 갈 방법이 없고, 화질이 낮게 잡히면 아예 꺼진다. 그대로 두면
    "저쪽에 사람이 남아 있나" 를 확인할 길이 없어진다 — **프레임보다 판단이 먼저다.**
  */
  it('세로 휴대폰에서는 시야 창을 늘 켠다 — 위에서 보는 시점만 뺀다', () => {
    const game = readFileSync(fileURLToPath(new URL('../src/game/Game.ts', import.meta.url)), 'utf8');
    const fn = game.slice(game.indexOf('private setOverlaysVisible'), game.indexOf('this.periph.setEnabled(want)'));
    expect(fn).toContain("this.handheld?.matches === true && mode !== 'top'");
    // PC 의 판단은 그대로 남아 있어야 한다
    expect(fn).toContain("this.graphics.peripheral === 'always'");
    expect(fn).toContain("this.graphics.peripheral === 'driverOnly' && mode === 'driver'");
  });

  /* 화면을 돌리면 다시 판단한다 — 세로일 때만 켜는 규칙이라 가로의 판단이 남아 있으면 안 된다 */
  it('화면 크기가 바뀌면 시야 창을 다시 판단한다', () => {
    const game = readFileSync(fileURLToPath(new URL('../src/game/Game.ts', import.meta.url)), 'utf8');
    const resize = game.slice(game.indexOf('  resize(): void {'), game.indexOf('showTopView'));
    expect(resize).toContain('this.setOverlaysVisible(this.rig.mode)');
  });

  /* 누가 골랐는지 · 조언했는지의 짧은 꼴 — 이름표는 그대로 두고 설명만 줄인다 */
  it('AI 이름표 줄은 짧은 꼴로 바뀐다', () => {
    const block = rulesOnly();
    expect(block).toMatch(/\.pick-long \{\s*display: none;/);
    expect(block).toMatch(/\.pick-short \{\s*display: inline;/);
    const picked = readFileSync(fileURLToPath(new URL('../src/ui/pickedBy.ts', import.meta.url)), 'utf8');
    expect(picked).toContain('class="pick-short"');
  });

  /*
    **결과 화면의 머리는 한 줄** — `← 홈` 과 판 이름이 두 줄로 접히면 등급 배지와 AI 분석이
    그만큼 밀려 내려간다 (사용자가 사진으로 짚었다). 등급은 제 줄에서 가운데.
  */
  it('결과 화면의 머리를 한 줄로 줄이고 등급을 가운데로 둔다', () => {
    const block = rulesOnly();
    expect(block).toContain('#screen-debrief .back-short');
    expect(block).toMatch(/#screen-debrief \.screen-head h1 \{\s*font-size: 20px;/);
    expect(block).toMatch(/#screen-debrief \.screen-head-right \{\s*justify-content: center;/);
  });

  /*
    **뒤로 버튼과 판 이름은 같은 선에 선다** (사용자가 짚었다). 머리는 기본이 `align-items: start`
    이고 뒤로 버튼에는 3px 을 내려 둔 값이 있어, 제목을 20px 로 줄이자 버튼이 제목보다 내려앉았다.
  */
  it('뒤로 버튼과 판 이름이 같은 선에 선다', () => {
    const block = rulesOnly();
    expect(block).toMatch(/#screen-debrief \.screen-head \{\s*align-items: center;/);
    expect(block).toMatch(/#screen-debrief button\.back \{\s*margin-top: 0;/);
  });

  /* 버튼 줄도 위의 등급 · 레벨 칸과 같은 가운데 축에 놓는다 */
  it('결과 화면의 버튼 줄을 가운데로 모은다', () => {
    expect(rulesOnly()).toMatch(/#screen-debrief \.btn-row \{\s*justify-content: center;/);
  });

  /*
    **레벨 칸과 '다시 운행' 은 버튼이 하나뿐인 판에서만 반반이다** (`.solo`). 다음 판으로 갈 수 있는
    판은 버튼이 넷이라(다음 판 · 멈춤 · 다시 운행 · 자동 넘어가기) 반쪽에 넣으면 서로 겹친다 —
    실제로 그렇게 됐고, 그래서 `solo` 표시를 두었다.
  */
  it("레벨 칸과 '다시 운행' 은 solo 일 때만 반반이다", () => {
    const block = rulesOnly();
    expect(block).toContain('#screen-debrief .debrief-top.solo > .player-box');
    expect(block).not.toMatch(/\.debrief-top > \.player-box \{\s*flex: 1 1 0/);
    const screens = readFileSync(fileURLToPath(new URL('../src/ui/Screens.ts', import.meta.url)), 'utf8');
    expect(screens).toContain("canAdvance ? '' : ' solo'");
  });

  /*
    **저작권 줄은 짧은 꼴로 두 줄** (사용자가 정했다) — `Copyright © 2026 goodpjw2008` / `비영리 목적 사용`.
    글은 CSS 로 바꿀 수 없어 두 벌을 두고 화면이 고르게 한다. 메일은 뒷부분만 감추므로
    **`mailto:` 링크는 그대로다** — 눌러서 메일을 쓸 수 있어야 연락처를 적은 뜻이 산다.
  */
  it('저작권 줄은 짧은 꼴로, 늘 두 줄로 선다', () => {
    const block = rulesOnly();
    expect(block).toContain('#screen-menu .site-footer .mail-host');
    expect(block).toContain('#screen-menu .site-footer .usage-long');
    // 둘째 줄을 못 박는 것은 flex-basis 다 — 폭이 넓어져도 한 줄로 붙지 않는다
    expect(block).toMatch(/\.usage-short \{[^}]*flex-basis: 100%;/);
  });

  /* 링크는 통째로 두 벌 두지 않는다 — 주소가 어긋나면 눌러도 다른 곳으로 간다 */
  it('메일 링크는 한 벌뿐이고 뒷부분만 감싼다', () => {
    const screens = readFileSync(fileURLToPath(new URL('../src/ui/Screens.ts', import.meta.url)), 'utf8');
    expect(screens).toContain('class="mail-host"');
    expect(screens).toContain('mailto:${esc(APP_CONTACT)}');
  });

  /* 좁은 폭에서 오른쪽에 붙으면 한쪽만 차 보인다 — 가운데로 모은다 */
  it('사이트 전체 성공 · 실패는 가운데로 모은다', () => {
    expect(mobileBlock()).toMatch(/\.site-stats\s*\{\s*justify-content:\s*center;/);
  });

  /*
    **덩어리는 스타일의 맨 뒤에 선다.** `.badge-summary` 처럼 기본 규칙이 뒤쪽에 있는 칸이
    있어서, 앞에 두면 우선순위가 같아 순서로 져 접히지 않는다 — 실제로 한 번 그랬다.
  */
  it('스타일시트의 맨 뒤에 있다 — 앞에 두면 뒤쪽 기본 규칙에 진다', () => {
    const at = html.indexOf('@media (orientation: portrait) and (pointer: coarse)');
    expect(html.slice(at).indexOf('.badge-summary {')).toBeGreaterThan(-1);
    // 이 덩어리 뒤로는 다른 규칙이 남아 있지 않다
    const after = html.slice(at + mobileBlock().length, html.indexOf('</style>', at));
    expect(after.trim()).toBe('');
  });
});

/*
  **손에 든 화면의 주행 HUD 는 뒤를 흐리지 않는다** (index.html 의 `@media (pointer: coarse)`).

  사용자가 화면 사진 둘로 짚었다 — *"주행 중 가만히 둬도 깜빡거린다. 모바일에서만."* 찍힌 프레임을
  재 보니 3D 그림의 일부만 그려지고 나머지가 검게 남아 있었고, 그 경계가 **화면 폭의 정확히 절반**
  이었다. 그리다 만 것이 아니라 **합성하다 만** 모양이다 (fps 는 56~60 으로 멀쩡했다).

  남는 원인은 이 상자들이 **살아 움직이는 3D 위에서 매 프레임 뒤를 다시 흐리는 것**이다.
  PC 에서는 나지 않으므로(사용자 확인) `pointer: coarse` 로 손가락 화면에서만 끈다 —
  조건이 느슨해지면 PC 의 흐림까지 사라진다.
*/
describe('손에 든 화면의 주행 HUD', () => {
  const head = '@media (pointer: coarse) {';
  const block = (): string => {
    const at = html.indexOf(head);
    if (at < 0) throw new Error('손가락 화면 전용 미디어 쿼리를 찾지 못했다');
    let depth = 0;
    for (let i = at + head.length - 1; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}' && --depth === 0) return html.slice(at, i + 1);
    }
    throw new Error('미디어 쿼리가 닫히지 않았다');
  };

  it('3D 위에 뜨는 상자들의 흐림을 끈다', () => {
    const b = block();
    for (const sel of [
      '.hud-objective',
      '.hud-home',
      '.keyhints',
      '.hud-player',
      '.hud-auto',
      '.fps',
      '.signal-chip',
      '.drive-coach-bubble',
      '.tbtn',
    ]) {
      expect(b, `${sel} 이 빠졌다`).toContain(sel);
    }
    expect(b).toContain('backdrop-filter: none');
    // 웹킷 접두사도 함께 — 사파리 · 안드로이드 웹뷰가 그쪽을 본다
    expect(b).toContain('-webkit-backdrop-filter: none');
  });

  /*
    **흐림이 맡던 가독성은 바탕이 대신한다.** 흐림만 끄면 달리는 도로 위에서 글이 묻힌다 —
    이미 0.72 였던 것들을 0.9 언저리로 올려 둔다.
  */
  it('흐림을 끈 만큼 바탕을 더 채운다', () => {
    const b = block().replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of b.matchAll(/background:\s*rgba\([^)]*?,\s*([\d.]+)\)/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0.88);
    }
    expect([...b.matchAll(/background:/g)].length).toBeGreaterThanOrEqual(3);
  });

  /* PC 는 그대로다 — 조건에 `pointer: coarse` 가 있어야 마우스 화면이 휩쓸리지 않는다 */
  it('마우스 화면은 흐림을 그대로 쓴다', () => {
    expect(block().startsWith('@media (pointer: coarse) {')).toBe(true);
    // 기본 규칙에는 흐림이 그대로 남아 있어야 한다
    expect(html).toContain('backdrop-filter: blur(10px)');
  });
});
