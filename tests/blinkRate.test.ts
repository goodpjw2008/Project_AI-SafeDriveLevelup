/**
 * 방향지시등 점멸 주기 — **두 곳에 나뉜 값이 어긋나지 않는지.**
 *
 *  - `Game.ts` 의 `BLINK_PERIOD` — 주행 중 차체 등화·계기판 화살표·소리를 함께 움직인다
 *  - `Audio.ts` 의 `BLINK_HALF_MS` — 설정 화면 미리듣기의 딸깍 간격
 *
 * 하나로 합치지 못하는 이유는 순환 참조다 — Game 이 Audio 를 쓰므로 Audio 가 Game 을
 * 가져올 수 없다. 그래서 값이 두 벌 있고, 어긋나면 **미리듣기와 실제 주행의 속도가
 * 달라진다.** 고르는 사람이 들은 것과 실제로 나는 것이 다르면 고른 뜻이 없다.
 *
 * 소스에서 상수를 읽어 비교한다 — 두 모듈 다 Three.js·DOM 에 얽혀 있어 그대로 import
 * 할 수 없기 때문이다. 값을 바꾸면 이 테스트가 먼저 잡는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const num = (src: string, name: string): number => {
  const m = src.match(new RegExp(`const ${name} = ([\\d.]+);`));
  if (!m) throw new Error(`${name} 을(를) 찾지 못했다 — 이름이 바뀌었으면 이 테스트도 고쳐야 한다`);
  return Number(m[1]);
};

const period = num(read('../src/game/Game.ts'), 'BLINK_PERIOD');
const halfMs = num(read('../src/game/Audio.ts'), 'BLINK_HALF_MS');

describe('점멸 주기', () => {
  it('미리듣기 간격이 주행 중 반주기와 같다', () => {
    expect(halfMs).toBe(Math.round((period / 2) * 1000));
  });

  /*
    분당 점멸 횟수. 흔히 쓰이는 기준은 60~120회다.

    예전 값(0.9초 = 67회)은 그 범위 안이긴 했지만 **아래쪽 끝**이라, 소리를 넣고 나니
    실제 깜빡이보다 느리게 들렸다. 지금 값은 소리로 쓰는 녹음본을 재서 맞춘 것이다.
  */
  it('분당 점멸 횟수가 통상 범위(60~120회) 안에 있다', () => {
    const perMinute = 60 / period;
    expect(perMinute).toBeGreaterThanOrEqual(60);
    expect(perMinute).toBeLessThanOrEqual(120);
  });

  it('음원의 클릭 간격(0.319초)에 맞춰져 있다', () => {
    // 녹음본과 주기가 다르면 딸깍이 실제 릴레이와 다른 속도로 들린다
    expect(period / 2).toBeCloseTo(0.319, 1);
  });
});
