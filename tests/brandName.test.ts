import { describe, expect, it } from 'vitest';
import { AI_BADGE_HTML, BRAND_NAME_HTML, withAiBadge } from '../src/ui/brandName';
import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_NAME_PARTS,
  APP_SITE,
  APP_TAGLINE,
  APP_TAGLINE_PARTS,
} from '../src/brand';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { courseTitle } from '../src/scenarios/curriculum';

/*
  **제목은 여기가 무엇 하는 곳인지, 부제는 이번 편이 무엇을 다루는지** (brand.ts).
  '안전운전' 은 신호의 녹색 딱지, 'AI' 는 배지다 — AI 공모전 작품이라 'AI' 가 돋보여야 한다는 사용자 요청이 있었다.

  예전 이름은 'AI 우회전 참교육' 이었고 '우회전' 세 글자가 신호등 딱지 셋이었다. 같은 낱말을 쓴 다른 작품이
  먼저 알려져 이름을 바꿨는데(사용자 요청), **신호등 세 색은 제목의 녹색 하나와 부제의 노랑 둘 · 빨강 하나로 이어진다.**
*/
describe('이름', () => {
  it("제목은 'AI' 배지 + 녹색 '안전운전' + 칠하지 않은 '레벨업'", () => {
    expect(APP_NAME).toBe('AI 안전운전 레벨업');
    expect(APP_NAME_PARTS.filter((p) => p.tone).map((p) => `${p.text}:${p.tone}`)).toEqual([
      'AI:ai',
      '안전운전:green',
    ]);
  });

  /*
    **제목과 화면의 호칭이 같은 낱말이다** — 'AI 안전운전 레벨업' 과 '안전운전 Level6'(curriculum.ts 의 courseTitle).
    이름을 바꿀 때 호칭을 따라 바꾸지 않으면, 레벨이 무엇의 레벨인지부터 다시 알아봐야 한다.
  */
  it('제목의 낱말이 학습자 호칭과 같다', () => {
    expect(courseTitle({ level: 6, mastered: false })).toBe('안전운전 Level6');
    expect(APP_NAME).toContain('안전운전');
  });

  /*
    **제목에 '우회전' 을 두지 않는다.** 같은 낱말을 쓴 다른 작품과 겹쳐 보이기 때문이다 — 이 테스트가
    그 결정을 지킨다. 무엇을 다루는지는 바로 아래 부제가 말한다.
  */
  it("제목에는 '우회전' 이 없고, 부제가 그것을 말한다", () => {
    expect(APP_NAME).not.toContain('우회전');
    expect(APP_TAGLINE).toBe('우회전과 어린이보호구역 일시정지 연습편');
  });

  /* 사용자가 색까지 정했다 — '어디서'(우회전 · 어린이보호구역)는 노랑, '무엇을'(일시정지)은 정지 표지색 */
  it('부제는 낱말 셋을 딱지로 칠한다 — 어디서 둘은 노랑, 무엇을 하나는 빨강', () => {
    expect(APP_TAGLINE_PARTS.filter((p) => p.tone).map((p) => `${p.text}:${p.tone}`)).toEqual([
      '우회전:yellow',
      '어린이보호구역:yellow',
      '일시정지:stop',
    ]);
  });

  /* About 창이 이름을 통째로 적는다 — 제목과 같은 딱지를 쓴다 (ui/Screens.ts 의 renderAbout) */
  it('이름 한 줄은 조각에서 만든다 — 두 벌로 적어 두지 않는다', () => {
    expect(BRAND_NAME_HTML).toBe(`${AI_BADGE_HTML} <span class="brand-green">안전운전</span> 레벨업`);
  });
});

/*
  **이름이 아닌 곳의 'AI'** — 결과 화면 · 주행 화면의 판 이름("AI 추천 시나리오 2484")도 같은 배지를 쓴다.
  사용자가 짚었다: "여기의 AI 부분도 타이틀의 예쁜 AI 를 가져다 사용해 줘."

  이름이 바뀐 뒤로는 **말하는 이의 이름도 'AI' 하나**다 ("AI 가 운전 습관을 분석하고 있습니다") —
  새 이름에는 떼어 쓸 짧은 조각이 없다 (ui/brandName.ts).
*/
describe('홀로 선 AI 배지', () => {
  it('판 이름의 AI 를 배지로 바꾼다 — 나머지 글자는 그대로', () => {
    expect(withAiBadge('AI 추천 시나리오 2484')).toBe(`${AI_BADGE_HTML} 추천 시나리오 2484`);
    expect(withAiBadge('AI 시범')).toBe(`${AI_BADGE_HTML} 시범`);
  });

  it('말하는 이의 이름도 같은 배지다', () => {
    expect(withAiBadge('AI 가 후보 10개 중 가장 필요한 코스를 고르는 중')).toBe(
      `${AI_BADGE_HTML} 가 후보 10개 중 가장 필요한 코스를 고르는 중`,
    );
  });

  /* 호칭('안전운전 Level6')은 이름이 아니라 **학습자가 키우는 능력**이다 — 딱지도 배지도 붙지 않는다 */
  it("호칭의 '우회전' 은 칠하지 않는다", () => {
    expect(withAiBadge('안전운전 Level6')).toBe('안전운전 Level6');
    expect(withAiBadge('안전운전 마스터')).toBe('안전운전 마스터');
  });

  it('AI 가 없는 이름은 건드리지 않는다', () => {
    expect(withAiBadge('Stage 07')).toBe('Stage 07');
  });

  it('낱말 속의 AI 는 바꾸지 않는다 — 배지가 글 한가운데 튀어나오면 읽기 어렵다', () => {
    expect(withAiBadge('RAIN')).toBe('RAIN');
    expect(withAiBadge('AIR')).toBe('AIR');
  });
});

/*
  **사이트 아이콘** — 녹색 네모에 '안' 한 글자 (public/favicon.* · 사용자가 정했다).
  이름의 첫 글자이고, 바탕은 제목의 '안전운전' 딱지와 **같은 녹색**이다 — 탭에서 본 색이 화면을 열었을 때 제목에 있다.

  **주소로 내려받을 수 있는 파일**이어야 한다 — data URI 로 HTML 에 심었을 때 구글 · 네이버 검색 결과에 회색 지구본이 떴다
  (사용자가 짚었다, 2026-10-18). 글자는 외곽선이어야 한다 — 한글 글꼴이 없는 곳에서도 '안' 으로 그려지게.
*/
describe('사이트 아이콘', () => {
  const pub = (f: string) => fileURLToPath(new URL(`../public/${f}`, import.meta.url));
  const svg = readFileSync(pub('favicon.svg'), 'utf8');
  const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');

  it("녹색 네모에 '안' 한 글자다 — 글꼴이 없어도 그려지는 외곽선으로", () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('<title>안</title>');
    // 제목의 '안전운전' 딱지와 같은 녹색 (index.html 의 .brand-green)
    expect(svg).toContain('#117332');
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<text');
  });

  it('검색엔진이 내려받을 파일을 HTML 이 가리킨다 — ico(48px 포함) · svg · 96px png · 홈 화면 180px', () => {
    for (const tag of [
      '<link rel="icon" href="/favicon.ico"',
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg"',
      '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png"',
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"',
    ]) {
      expect(html).toContain(tag);
    }
    expect(html).not.toMatch(/rel="icon"[^>]*href="data:/);
    // PNG 의 가로 · 세로 (IHDR) — 구글은 48px 의 배수인 정사각형을 찾는다
    const size = (f: string) => {
      const b = readFileSync(pub(f));
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    expect(size('favicon-96x96.png')).toEqual([96, 96]);
    expect(size('apple-touch-icon.png')).toEqual([180, 180]);
    // ico 머리말 — 그림 수와 그 크기들 (0 은 256)
    const ico = readFileSync(pub('favicon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16]);
    expect(sizes).toContain(48);
    expect(sizes).toContain(16);
  });
});

/*
  **검색 결과와 공유 카드에 뜨는 글** — `<meta name="description">` 과 og / twitter 태그.

  구글이 우리 사이트를 보여 줄 때 첫 화면 본문("기록된 나쁜 운전 습관이 없습니다 …")을 뽑아 쓰고
  있었다. 그 줄은 **이미 들어온 사람에게 하는 말**이지, 아직 안 들어온 사람에게 할 말이 아니다.
  사용자가 직접 글을 적어 줬다 — 무엇을 하는 곳이고 무엇을 바라는가.

  글은 **한 곳**(brand.ts 의 APP_DESCRIPTION)에서 온다. 두 벌로 적으면 한쪽만 고쳐 놓고
  다른 쪽이 옛말을 하는 일이 생긴다 — 그래서 HTML 에는 자리표시자만 둔다.
*/
describe('검색 결과와 공유 카드', () => {
  const html = readFileSync(fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8');

  it('설명은 무엇을 하는 곳이고 무엇을 바라는지를 말한다', () => {
    expect(APP_DESCRIPTION).toContain('AI');
    expect(APP_DESCRIPTION).toContain('우회전');
    expect(APP_DESCRIPTION).toContain('어린이보호구역');
    expect(APP_DESCRIPTION).toContain('안전운전');
    // 검색 결과는 대략 이만큼까지 보인다 — 넘치면 뒷말이 잘린 채 뜬다
    expect(APP_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it('설명 · 공유 카드 · 대표 주소가 모두 한 곳에서 온다', () => {
    for (const tag of [
      '<meta name="description" content="{{APP_DESCRIPTION}}"',
      '<meta property="og:description" content="{{APP_DESCRIPTION}}"',
      '<meta name="twitter:description" content="{{APP_DESCRIPTION}}"',
      '<meta property="og:url" content="{{APP_SITE}}"',
      '<link rel="canonical" href="{{APP_SITE}}"',
    ]) {
      expect(html).toContain(tag);
    }
    // 글을 HTML 에 그대로 적어 두지 않는다 — 그러면 brand.ts 를 고쳐도 따라오지 않는다
    expect(html).not.toContain(APP_DESCRIPTION.slice(0, 20));
  });

  /* 자리표시자는 vite.config.ts 가 갈아 끼운다 — 목록에서 빠지면 `{{…}}` 가 그대로 배포된다 */
  it('자리표시자가 빌드에서 갈아 끼워진다', () => {
    const vite = readFileSync(fileURLToPath(new URL('../vite.config.ts', import.meta.url)), 'utf8');
    for (const key of ['APP_NAME', 'APP_TAGLINE', 'APP_DESCRIPTION', 'APP_SITE']) {
      expect(vite).toContain(key);
    }
    // HTML 이 쓰는 자리표시자가 하나라도 목록에 빠지면 `{{…}}` 가 그대로 배포된다
    const listed = vite.match(/\\\{\\\{\(([^)]+)\)\\\}\\\}/)![1].split('|');
    for (const used of new Set([...html.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))) {
      expect(listed, `${used} 가 치환 목록에 없다`).toContain(used);
    }
  });

  it('공개 주소는 https 한 벌이다 — 끝에 빗금을 두지 않는다', () => {
    expect(APP_SITE).toBe('https://safedrive.ai.kr');
  });
});
