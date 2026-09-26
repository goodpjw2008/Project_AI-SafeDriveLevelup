import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
  **마스터 축하 창과 무지개 표시** — 사용자가 정했다: "마스터레벨이 되면 축하팝업을 띄워주고 확인을 누르면 초기화면으로 나오게
  해줘. 마스터 레벨은 무지개 색으로 표시가 되게 해줘." 글 세 줄과 확인 버튼, 무지개 규칙이 index.html 에 그대로 있는지 못 박는다.
*/
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

describe('마스터 축하 창(#ending)', () => {
  const ending = html.slice(html.indexOf('id="ending"'), html.indexOf('id="ending-ok"') + 40);
  it('사용자가 정한 세 줄이 그대로 있다', () => {
    expect(ending).toContain('축하합니다!!!');
    expect(ending).toContain('AI 안전운전 레벨업을 마스터 하셨습니다.');
    expect(ending).toContain('우회전과 어린이보호구역의 안전운전 마스터로 임명합니다.');
  });
  it('버튼은 확인 하나다', () => {
    expect(ending).toMatch(/id="ending-ok">확인<\/button>/);
    expect(ending).not.toContain('modal-cancel');
  });
  it('축하 글은 무지개 글자다', () => {
    expect(ending).toMatch(/id="ending-title" class="rainbow-text"/);
  });
});

describe('마스터는 무지개로 표시한다', () => {
  it('M 뱃지의 도형과 글자가 무지개 그라데이션을 가져다 쓴다 — 레벨 길의 M 칸과 플레이어 칸 둘 다', () => {
    expect(html).toContain('<linearGradient id="rainbow-grad"');
    expect(html).toMatch(/\.level-step\.master\.now \.level-badge-shape,\s*\.player\.mastered \.level-badge-wrap \.level-badge-shape \{[^}]*url\(#rainbow-grad\)/);
    expect(html).toMatch(/\.level-step\.master\.now \.level-badge-num,\s*\.player\.mastered \.level-badge-wrap \.level-badge-num \{[^}]*url\(#rainbow-grad\)/);
  });
  it('호칭과 MAX 도 무지개 글자다', () => {
    expect(html).toMatch(/\.player\.mastered \.player-name \{[^}]*var\(--rainbow\)/);
    expect(html).toMatch(/\.player\.mastered \.player-xp \{[^}]*var\(--rainbow\)/);
  });
  it('그라데이션 정의는 display:none 이 아니다 — 그러면 참조가 끊긴다', () => {
    const rule = html.slice(html.indexOf('.svg-defs {'), html.indexOf('}', html.indexOf('.svg-defs {')));
    expect(rule).not.toContain('display');
    expect(rule).toContain('width: 0');
  });
});
