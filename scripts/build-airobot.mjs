/**
 * AI 코치 로봇 '안전이' 굽기 — 원본 PNG → 주행 화면에 쓰는 작은 webp.
 *
 *   npm run airobot
 *
 * 원본은 `assets/airobot/` 에 둔다 (normal · stop · turnlight — 평소 · 일시정지 · 우회전).
 * **배경을 지운 투명 PNG** 여야 한다 — 로봇이 틀 없이 말풍선 옆에 서기 때문이다.
 * (배경이 있던 첫 원본은 `assets/airobot/opaque-original/` 에 남겨 두었다)
 * 결과는 `src/assets/airobot/` 에 둔다.
 *
 * ## 왜 줄이는가
 *
 * `src/assets/` 아래의 그림은 **크기와 상관없이 번들에 base64 로 심긴다** (vite.config.ts —
 * 단일 파일 빌드를 위해서다). 원본은 한 장에 1.7MB 라 셋이면 번들이 7MB 가까이 불어난다.
 * 화면에는 100px 남짓으로 나오므로 그렇게 클 이유가 없다.
 *
 * ## 무엇을 잘라 내는가
 *
 * **투명한 여백만** 잘라 낸다(`trim`). 처음에는 배경이 있는 원본에서 자리를 못 박아
 * 잘랐는데, 배경을 지운 원본이 들어오면서 그 좌표가 뜻을 잃었다 — 그림마다 크기가 달라도
 * 내용이 있는 자리까지만 남기는 편이 원본이 바뀌어도 그대로 맞는다.
 *
 * `sharp` 를 쓴다 — 배지 스크립트가 쓰는 `cwebp` 는 이 장비에 없고, sharp 는 모델 최적화
 * 도구(@gltf-transform)가 이미 끌어와 node_modules 에 있다.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'assets/airobot');
const OUT = join(ROOT, 'src/assets/airobot');

/** 결과 높이 (px). 화면에는 최대 150px 남짓으로 나오므로 두 배면 고해상도 화면에서도 충분하다 */
const HEIGHT = 300;
const QUALITY = 88;

if (!existsSync(SRC)) {
  console.error(`원본이 없습니다: ${SRC}`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => /\.png$/i.test(f)).sort();
if (!files.length) {
  console.error(`${SRC} 에 그림이 없습니다.`);
  process.exit(1);
}

console.log('구운 결과:');
for (const f of files) {
  const out = join(OUT, f.replace(/\.png$/i, '.webp'));
  /*
    **세 장을 같은 높이로 맞춘다.** 여백을 잘라 낸 크기가 그림마다 조금씩 달라, 폭으로
    맞추면 상태가 바뀔 때마다 로봇이 커졌다 작아졌다 한다.
  */
  const trimmed = await sharp(join(SRC, f)).trim().toBuffer();
  await sharp(trimmed)
    .resize({ height: HEIGHT })
    .webp({ quality: QUALITY, alphaQuality: 90 })
    .toFile(out);
  const kb = (statSync(out).size / 1024).toFixed(1);
  const before = (statSync(join(SRC, f)).size / 1024).toFixed(0);
  console.log(`  ${f.padEnd(16)} ${before}KB → ${kb}KB`);
}
