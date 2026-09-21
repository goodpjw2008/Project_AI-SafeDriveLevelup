/**
 * 단일 HTML 파일 빌드.
 *
 * dist/ 결과물을 하나의 .html 로 합쳐 `file://` 로 열어도 그대로 돌아가게 만든다.
 * 브라우저는 file:// 에서 외부 모듈(<script src>)을 CORS로 막기 때문에 스크립트를
 * 인라인으로 넣는다. (인라인 module 스크립트는 file:// 에서도 정상 실행된다)
 *
 * 실행: npm run build:standalone  →  dist-standalone/turn-right.html
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
// 프로젝트 루트의 index.html 로 내보낸다.
// "루트의 index.html 을 연다"는 관례가 그대로 통해야 하고, 이 파일은 외부 파일을
// 하나도 참조하지 않으므로 file:// 로 더블클릭해도 그대로 실행된다.
const OUT_DIR = ROOT;
const OUT = resolve(OUT_DIR, 'index.html');

async function readDist(rel) {
  return readFile(resolve(DIST, rel), 'utf8');
}

/** 인라인 스크립트 안에서 HTML 파서를 깨뜨릴 수 있는 시퀀스를 막는다 */
function safeForInlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

async function main() {
  let html;
  try {
    html = await readDist('index.html');
  } catch {
    console.error('dist/ 가 없습니다. 먼저 `npm run build` 를 실행하세요.');
    process.exit(1);
  }

  // <script type="module" crossorigin src="./assets/index-XXXX.js"></script> 를 찾아 인라인으로 바꾼다
  const scriptTag = /<script\b[^>]*\bsrc=["']\.?\/?([^"']+\.js)["'][^>]*><\/script>/i;
  const match = html.match(scriptTag);
  if (!match) {
    console.error('dist/index.html 에서 번들 스크립트 태그를 찾지 못했습니다.');
    process.exit(1);
  }

  const bundle = await readDist(match[1]);
  console.log(`  번들 ${Math.round(bundle.length / 1024)}KB 인라인`);

  // 치환값은 반드시 함수로 넘긴다. 문자열로 넘기면 번들 안의 `$&` 같은 시퀀스를
  // replace가 치환 패턴으로 해석해 매치된 태그 전체를 그 자리에 끼워 넣어 HTML이 깨진다.
  const inlinedScript = `<script type="module">${safeForInlineScript(bundle)}</script>`;
  html = html.replace(scriptTag, () => inlinedScript);

  // 혹시 남아 있는 외부 스타일시트 링크도 인라인화 (현재는 <style> 인라인이라 보통 없다)
  //
  // **다른 서버를 가리키는 링크는 건너뛴다.** 글꼴(Pretendard) 처럼 CDN 을 가리키는 것은
  // dist/ 에 파일이 없어 읽을 수 없다 — 예전에는 여기서 그대로 읽으려다 빌드가 죽었다.
  // 남겨 두면 file:// 에서 조용히 실패하고 시스템 글꼴로 그려진다 (HDRI 와 같은 취급).
  const linkTag = /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+\.css)["'][^>]*>/gi;
  const links = [...html.matchAll(linkTag)];
  for (const link of links) {
    const href = link[1];
    if (/^(https?:)?\/\//i.test(href)) {
      console.log(`  외부 스타일시트는 그대로 둡니다: ${href}`);
      continue;
    }
    const css = await readDist(href.replace(/^\.?\//, ''));
    html = html.replace(link[0], () => `<style>${css}</style>`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, html);
  console.log(`\n완료: ${OUT}  (${Math.round(html.length / 1024 / 1024 * 10) / 10}MB)`);
  console.log('이 파일을 더블클릭하면 브라우저에서 바로 실행됩니다.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
