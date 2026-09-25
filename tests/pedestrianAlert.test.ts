/**
 * **보행자 머리 위 느낌표는 둥글다** (game/Pedestrian.ts 의 alertTexture).
 *
 * 사용자의 휴대폰에서 이 표시가 **위와 왼쪽이 잘린 모양**으로 나왔다 — 두 번의 화면 캡처가
 * 똑같았는데, PC · 노트북 · 실제 GPU 어디서도 재현되지 않았다. 그림을 굽는 길에 기기마다
 * 달라지는 조각이 둘 있었기 때문이다: **브라우저의 캔버스 래스터라이저**와 **웹폰트**.
 * 둘을 걷어내고 숫자로 직접 굽는 것으로 바꿨다 — 그러면 어느 기기에서나 같은 그림이 나온다.
 *
 * 이 표시는 "저기 사람이 있다" 를 말하는 것이라 **한눈에 느낌표로 읽혀야** 한다. 아래는
 * 그때 깨졌던 것들을 하나씩 못 박는다 — 화면 없이(테스트에서) 그대로 잴 수 있다.
 */
import { describe, expect, it } from 'vitest';
import { alertTexture } from '../src/game/Pedestrian';

const N = 128;

/** 그림을 사람이 읽는 대로(맨 윗줄이 0) 읽는다 — 텍스처의 첫 줄은 아래다 */
function reader(kind: 'intending' | 'crossing') {
  const tex = alertTexture(kind);
  expect(tex, '화면(canvas)이 없어도 그림이 나와야 한다').not.toBeNull();
  const data = tex!.image.data as Uint8Array;
  const at = (row: number, col: number): [number, number, number, number] => {
    const i = ((N - 1 - row) * N + col) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  return { at, opaque: (row: number, col: number) => at(row, col)[3] > 128 };
}

describe('보행자 느낌표 그림', () => {
  it('좌우가 정확히 대칭이다 — 한쪽이 잘리면 여기서 걸린다', () => {
    const { opaque } = reader('crossing');
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N / 2; col++) {
        expect(opaque(row, col), `(${row}, ${col})`).toBe(opaque(row, N - 1 - col));
      }
    }
  });

  it('가로와 세로가 같다 — 원이지 타원이 아니다', () => {
    const { opaque } = reader('crossing');
    let wide = 0;
    let tall = 0;
    for (let k = 0; k < N; k++) {
      let w = 0;
      let h = 0;
      for (let j = 0; j < N; j++) {
        if (opaque(k, j)) w++;
        if (opaque(j, k)) h++;
      }
      wide = Math.max(wide, w);
      tall = Math.max(tall, h);
    }
    expect(wide).toBe(tall);
    // 테두리 밖으로 삐져나가지 않는다 — 가장자리에 닿으면 밉맵에서 번져 네모로 보인다
    expect(wide).toBeLessThan(N - 4);
  });

  it('그림 바깥 테두리는 비어 있다 — 가장자리에 닿으면 멀리서 네모로 뭉친다', () => {
    const { at } = reader('crossing');
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const dist = Math.hypot(col + 0.5 - N / 2, row + 0.5 - N / 2);
        if (dist > 61) expect(at(row, col)[3], `(${row}, ${col})`).toBe(0);
      }
    }
  });

  /*
    **점은 몸통 아래다.** 텍스처의 첫 줄은 그림의 아래(OpenGL 규약)라, 뒤집는 것을 잊으면
    점이 위로 올라가 **'i' 처럼** 보인다 — 실제로 한 번 그렇게 나왔다.
  */
  it("느낌표는 긴 몸통 아래에 점이 있다 — 뒤집히면 'i' 가 된다", () => {
    const { at } = reader('crossing');
    const ink = (row: number) => at(row, N / 2)[0] > 200 && at(row, N / 2)[1] > 200;
    const runs: Array<[number, number]> = [];
    let start = -1;
    for (let row = 0; row < N; row++) {
      if (ink(row) && start < 0) start = row;
      if (!ink(row) && start >= 0) {
        runs.push([start, row - 1]);
        start = -1;
      }
    }
    expect(runs.length, '몸통과 점, 둘로 끊겨야 한다').toBe(2);
    const [body, dot] = runs;
    expect(body[1] - body[0]).toBeGreaterThan((dot[1] - dot[0]) * 2);
    // 사이가 넉넉해야 멀리서도 한 막대로 뭉치지 않는다
    expect(dot[0] - body[1]).toBeGreaterThan(8);
  });

  it('두 가지 색이 따로 있고, 매번 새로 굽지 않는다', () => {
    const red = alertTexture('crossing')!;
    const amber = alertTexture('intending')!;
    expect(red).not.toBe(amber);
    expect(alertTexture('crossing')).toBe(red);
    // 건너는 중은 빨강, 건너려 함은 주황 — 가운데 위쪽 알맹이 색으로 확인한다
    const mid = (t: typeof red): number[] => {
      const d = t.image.data as Uint8Array;
      const i = ((N / 2) * N + 30) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    expect(mid(red)[0]).toBeGreaterThan(mid(red)[1] + 100);
    expect(mid(amber)[1]).toBeGreaterThan(mid(red)[1] + 60);
  });
});
