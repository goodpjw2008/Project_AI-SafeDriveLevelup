/**
 * 3D 모델 최적화 파이프라인.
 *
 *   assets/cars/<차 id>/**\/(scene.gltf|*.glb)  →  public/models/<차 id>.glb
 *
 * **폴더 이름이 곧 차 id 다.** Sketchfab 에서 받은 압축을 `assets/cars/<id>/` 에 풀고
 * 이 스크립트를 돌린 뒤, `src/economy/cars.ts` 에 같은 id 로 한 항목만 추가하면 된다.
 *
 * 원본 glTF 는 웹에 그대로 올리기엔 무겁다(텍스처 PNG 수 MB + 비압축 지오메트리).
 * Meshopt 로 지오메트리를 줄이고 텍스처를 webp 로 다시 굽는다 — 보통 1/5~1/10 이 된다.
 * Draco 대신 Meshopt 를 쓰는 이유는 디코딩이 빨라 저사양 기기에서 유리해서다.
 *
 * 원본은 assets/ 에만 두고 배포에는 포함하지 않는다. 결과물만 public/models/ 로 나간다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { removeRoomMirror } from './remove-room-mirror.mjs';
import { removeViewBlockers } from './remove-view-blockers.mjs';
import { clearWindshield } from './clear-windshield.mjs';

const SRC_DIR = 'assets/cars';
const OUT_DIR = 'public/models';

/**
 * 차종별 추가 옵션.
 *
 * K5 는 원본이 311만 면(코롤라의 37배)이다. 기본 설정으로는 103만 면·5.1MB 까지밖에
 * 안 줄어들어 오차를 키워 더 깎는다. 다만 **얼마나 키울지는 형상이 정한다.**
 *
 *   오차     삼각형    용량    결과
 *   기본     1,027,738  5.1MB
 *   0.001      344,180  2.4MB  실내가 온전하다
 *   0.002      315,568  2.2MB
 *   0.004      302,756  2.5MB  **핸들·에어벤트가 파편으로 부서진다**
 *
 * 0.004(차 길이의 0.4% ≒ 2cm)는 핸들 림보다 큰 오차라 얇은 실내 부품이 통째로 무너지는데,
 * 그렇게 망가뜨리고도 0.001 보다 삼각형이 12% 줄 뿐이다 — 단순화가 이미 바닥(속성 이음매·
 * 경계선)에 닿아 있어서 오차만 더 줘 봐야 형상만 상한다. 그래서 0.001(5mm)에서 멈춘다.
 */
const EXTRA_OPTIONS = {
  k5: ['--simplify-error', '0.001'],
};

/** 폴더에서 첫 번째 glTF/GLB 를 찾는다 (하위 폴더 포함) */
function findModel(dir) {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const found = findModel(p);
      if (found) return found;
    } else if (['.glb', '.gltf'].includes(extname(name).toLowerCase())) {
      return p;
    }
  }
  return null;
}

mkdirSync(OUT_DIR, { recursive: true });

const ids = existsSync(SRC_DIR)
  ? readdirSync(SRC_DIR).filter((n) => statSync(join(SRC_DIR, n)).isDirectory())
  : [];

let done = 0;
for (const id of ids) {
  const src = findModel(join(SRC_DIR, id));
  if (!src) {
    console.log(`· ${id} — glTF 를 찾지 못했습니다 (건너뜀)`);
    continue;
  }
  const dst = join(OUT_DIR, `${id}.glb`);
  console.log(`· ${src} → ${dst}`);

  execFileSync(
    'npx',
    [
      'gltf-transform',
      'optimize',
      src,
      dst,
      '--compress',
      'meshopt',
      '--texture-compress',
      'webp',
      // 1024 면 실내 재질에서 차이를 못 느끼면서 용량이 1/4 로 준다 (2048 은 11MB)
      '--texture-size',
      '1024',
      /*
        팔레트를 **끈다.** 이 기능은 단색 재질 여러 개를 팔레트 텍스처 한 장으로 합쳐 드로콜을
        줄이는데, 그 과정에서 **재질 이름이 사라진다** (전부 PaletteMaterial001 이 된다).
        그러면 이름이 같아진 메시들끼리 join 까지 되어 부품 구분도 함께 없어진다.

        게임은 이름으로 부품을 찾는다 — 눈높이는 앞유리에서, 크기 기준은 차체에서 잰다
        (carModel.ts). K5 는 부품 이름이 `Object_12` 처럼 무의미하고 **재질 이름만 살아 있어서**
        (carpaint·windowglass·interior) 팔레트를 켜면 183개 메시가 2개로 뭉개져 아무것도 못 잰다.
        드로콜 몇 개보다 이쪽이 훨씬 중요하다.
      */
      '--palette',
      'false',
      ...(EXTRA_OPTIONS[id] ?? []),
    ],
    { stdio: 'inherit' },
  );
  /*
    룸미러를 잘라낸다. **여기서 하지 않으면 모델을 다시 구울 때마다 룸미러가 되살아난다.**
    (원본 glTF 를 건드리지 않고 구운 결과물에서 빼는 방식이라 이 순서가 강제된다)
  */
  await removeRoomMirror(dst, id);
  await removeViewBlockers(dst, id);
  await clearWindshield(dst, id);
  /*
    **성능** — 조각난 부품을 합치고(SF90 은 바퀴 · 캘리퍼가 1254조각이었다), 배경 차용 가벼운 모델(<id>.lod.glb)을 굽는다.
    둘 다 여기서 하지 않으면 모델을 다시 구울 때마다 사라진다 (scripts/join-fragments.mjs · build-lod-models.mjs).
  */
  execFileSync('node', ['scripts/join-fragments.mjs', id], { stdio: 'inherit' });
  execFileSync('node', ['scripts/build-lod-models.mjs', id], { stdio: 'inherit' });

  const kb = Math.round(statSync(dst).size / 1024);
  console.log(`  완료: ${id}.glb — ${kb}KB`);
  done++;
}

if (done === 0) {
  console.log('\n최적화할 모델이 없습니다. assets/cars/README.md 를 참고하세요.');
} else {
  console.log(`\n${done}종 완료. cars.ts 의 id 와 파일 이름이 같아야 주행 화면에 나옵니다.`);
}
