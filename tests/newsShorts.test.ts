/**
 * **발표용 뉴스 쇼츠 페이지** — `public/news-shorts.html` (사용자가 정했다, 2026-11-15).
 *
 * 발표자료 '시연 포함' 판의 휴대폰 칸은 1 ~ 2장에서 이 페이지를 열어 JTBC 뉴스 쇼츠를 보여 준다. 유튜브는 영상을 넣은 페이지의
 * 주소(Referer)가 없으면 '오류 153' 으로 재생을 막으므로, 파일로 연 발표자료 대신 이 https 페이지가 영상을 넣는다.
 * 그래서 주소를 지우는 설정(no-referrer)이 있으면 안 되고, 검색에는 싣지 않는다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../public/news-shorts.html', import.meta.url)), 'utf8');

describe('public/news-shorts.html — 발표용 뉴스 쇼츠', () => {
  it('그 쇼츠 하나만 유튜브 삽입 주소로 넣는다', () => {
    const srcs = [...html.matchAll(/<iframe[\s\S]*?src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toHaveLength(1);
    expect(srcs[0]).toMatch(/^https:\/\/www\.youtube\.com\/embed\/CQTDFGm2gnk\?/);
  });

  it('주소(Referer)를 지우지 않는다 — 지우면 유튜브가 오류 153 으로 막는다', () => {
    expect(html).not.toMatch(/no-referrer(?!-when)/);
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
  });

  it('검색에는 싣지 않는다', () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
  });
});
