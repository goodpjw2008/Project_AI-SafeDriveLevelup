/**
 * 차가 언제 열리는가 — **레벨 하나에 차 한 대.**
 *
 * 이 게임이 주는 유일한 보상이라 규칙이 어긋나면 곧바로 보인다. 지키려는 것은 셋이다.
 *  - 레벨 1~9 에 차가 하나씩, 빠짐없이 겹침 없이 놓인다
 *  - 마지막 레벨(L10)에는 새 차가 없다 — L9 의 차가 거기까지 간다
 *  - 강등돼도 열린 차는 닫히지 않는다 (최고 기록이 기준이다)
 */

import { describe, expect, it } from 'vitest';
import {
  CARS,
  CARS_BY_LEVEL,
  STARTER_CAR_ID,
  carForLevel,
  getCar,
  isCarUnlocked,
} from '../src/economy/cars';
import { MAX_LEVEL, type Difficulty } from '../src/scenarios/curriculum';

/** 1 … MAX_LEVEL */
const ALL_LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => (i + 1) as Difficulty);

describe('차와 레벨의 짝', () => {
  it('레벨 1부터 차 수만큼, 하나씩 빠짐없이 놓인다', () => {
    const levels = CARS.map((c) => c.level).sort((a, b) => a - b);
    expect(levels).toEqual(Array.from({ length: CARS.length }, (_, i) => i + 1));
  });

  it('한 레벨에 두 대가 걸리지 않는다', () => {
    expect(new Set(CARS.map((c) => c.level)).size).toBe(CARS.length);
  });

  it('차는 레벨 수보다 하나 적다 — 마지막 레벨에는 새 차가 없다', () => {
    expect(CARS.length).toBe(MAX_LEVEL - 1);
  });

  it('전시관 목록은 레벨 순이다', () => {
    expect(CARS_BY_LEVEL.map((c) => c.level)).toEqual(
      [...CARS_BY_LEVEL.map((c) => c.level)].sort((a, b) => a - b),
    );
    expect(CARS_BY_LEVEL.length, '한 대도 빠지지 않는다').toBe(CARS.length);
  });

  it('시작 차는 L1 이다', () => {
    expect(getCar(STARTER_CAR_ID).level).toBe(1);
  });
});

describe('그 레벨에서 내주는 차 — carForLevel', () => {
  it('모든 레벨에 내줄 차가 있다', () => {
    for (const lv of ALL_LEVELS) expect(carForLevel(lv), `L${lv}`).toBeDefined();
  });

  it('레벨과 같은 번호의 차를 내준다 (마지막 레벨만 빼고)', () => {
    for (const lv of ALL_LEVELS) {
      if (lv >= MAX_LEVEL) continue;
      expect(carForLevel(lv)?.level, `L${lv}`).toBe(lv);
    }
  });

  /*
    **L10 은 새 차를 받는 자리가 아니다.** 여기서 다른 차를 내주면 카탈로그에 없는 차를
    가리키게 되고, 같은 차를 "새로 열렸다" 고 알리면 그 알림이 값어치를 잃는다
    (main.ts 가 직전 레벨의 차와 같은지 보고 걸러 낸다).
  */
  it('마지막 레벨은 그 앞 레벨의 차를 그대로 탄다', () => {
    expect(carForLevel(MAX_LEVEL)?.id).toBe(carForLevel((MAX_LEVEL - 1) as Difficulty)?.id);
  });

  it('내주는 차는 그 레벨에서 실제로 열려 있다', () => {
    for (const lv of ALL_LEVELS) {
      const car = carForLevel(lv);
      expect(car).toBeDefined();
      expect(isCarUnlocked(car!, lv), `L${lv}`).toBe(true);
    }
  });
});

describe('탈 수 있는가 — isCarUnlocked', () => {
  it('최고 기록이 그 차의 레벨 이상이면 탈 수 있다', () => {
    const l5 = CARS_BY_LEVEL[4];
    expect(l5.level).toBe(5);
    expect(isCarUnlocked(l5, 4)).toBe(false);
    expect(isCarUnlocked(l5, 5)).toBe(true);
    expect(isCarUnlocked(l5, 9)).toBe(true);
  });

  it('L1 에서는 첫 차 하나만 열려 있다', () => {
    expect(CARS.filter((c) => isCarUnlocked(c, 1))).toHaveLength(1);
  });

  it('최고 레벨에서는 아홉 대가 모두 열려 있다', () => {
    expect(CARS.filter((c) => isCarUnlocked(c, MAX_LEVEL))).toHaveLength(CARS.length);
  });

  /*
    **한 판 올라갈 때마다 정확히 한 대씩 는다.** 계급이던 시절에는 세 단계에 한 번만
    올라, 다섯 단계를 올라가도 차가 안 바뀌는 구간이 있었다 — 그게 이 시스템을 바꾼
    이유이므로 여기서 못 박아 둔다.
  */
  it('레벨이 하나 오를 때마다 열린 차가 하나 는다 (마지막 레벨만 빼고)', () => {
    const openAt = (lv: Difficulty): number => CARS.filter((c) => isCarUnlocked(c, lv)).length;
    for (const lv of ALL_LEVELS) {
      if (lv >= MAX_LEVEL) continue;
      expect(openAt(lv), `L${lv}`).toBe(lv);
    }
    expect(openAt(MAX_LEVEL), '마지막 레벨에는 새 차가 없다').toBe(MAX_LEVEL - 1);
  });
});
