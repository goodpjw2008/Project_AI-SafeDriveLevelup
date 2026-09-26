/**
 * **학습 표본** — 라이브러리에서 모델 학습에 쓸 판을 뽑는다 (scripts/train-ai.ts).
 *
 * ## 왜 '일정 간격' 이 아닌가
 *
 * 처음에는 18판마다 하나를 뽑았다. 그런데 라이브러리 id 는 열세 축의 자릿수라 **뒤 두 축(환경 3값 × 정체 2값 = 주기 6)**이
 * 가장 빠르게 돌고, 18 은 6 의 배수다 — 뽑힌 판이 전부 같은 환경(맑은 낮) · 같은 정체 값이었다. 밤 · 비 판을 한 번도 보지
 * 못한 모델이 밤 · 비의 가중치를 0 으로 배웠다. 레벨도 치우쳤다(L10 27% → 14%).
 *
 * 그래서 **씨앗을 고정한 무작위**로 레벨마다 비율대로 뽑는다(층화 표집). 같은 씨앗이면 같은 표본이라 학습 파일이 재현된다.
 * tests/aiSample.test.ts 가 표본이 축마다 라이브러리와 같은 비율인지 잰다.
 */

import type { Difficulty } from '../scenarios/curriculum';

/** 결정론적 난수 — 학습 스크립트와 테스트가 같은 표본을 본다 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 레벨마다 `share` 비율로(최소 `min` 판) 무작위로 뽑는다. 라이브러리 순서와 무관하게 축이 고루 섞인다.
 * 레벨이 없는 판(보호구역 전용 도로)은 `level` 이 0 이고 한 묶음으로 본다.
 */
export function stratifiedSample<T extends { level: number }>(
  items: readonly T[],
  opts: { share?: number; min?: number; seed?: number } = {},
): T[] {
  const share = opts.share ?? 0.06;
  const min = opts.min ?? 40;
  const rand = seededRandom(opts.seed ?? 20260927);
  const byLevel = new Map<number, T[]>();
  for (const it of items) {
    const arr = byLevel.get(it.level) ?? [];
    arr.push(it);
    byLevel.set(it.level, arr);
  }
  const out: T[] = [];
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const pool = [...byLevel.get(level)!];
    const n = Math.min(pool.length, Math.max(min, Math.round(pool.length * share)));
    // 피셔-예이츠 부분 섞기 — 앞 n 개가 표본
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rand() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.push(...pool.slice(0, n));
  }
  return out;
}

export type { Difficulty };
