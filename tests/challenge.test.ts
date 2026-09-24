/**
 * **난이도 설정 1~5** (scenarios/challenge.ts) — 코스 · 도움 · 주행 · 진급이 함께 어려워지는가.
 *
 * "가장 어렵게 해도 쉽다" 는 말을 두 번 들었다. 코스만 조였을 때 한 번, 도움을 걷었을 때 한 번.
 * 그래서 여기서는 **다섯 단계가 모든 축에서 한 방향으로 어려워지는지**를 못 박는다 — 어느 한 축이라도
 * 뒤집히면 "4 가 5 보다 어렵다" 같은 말이 나온다.
 */

import { describe, expect, it } from 'vitest';
import { AUTO_DRIVE_RULE, CHALLENGES, challengeRule } from '../src/scenarios/challenge';
import { advance, freshCurriculum, MAX_LEVEL, type CurriculumState } from '../src/scenarios/curriculum';
import { DEFAULT_PACE, Vehicle, zoneTargetKmh } from '../src/game/Vehicle';
import { SLOW_DOWN_LIMIT_KMH, STOP_ZONE_DEPTH, type JudgeResult } from '../src/rules/lawRules';
import { PLAYER_APPROACH_X, STOP_LINE } from '../src/layout';
import { simulate } from './simulate';

const nonDecreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);
const nonIncreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x <= xs[i - 1]);
const pick = <K extends keyof (typeof CHALLENGES)[number]>(k: K) => CHALLENGES.map((c) => c[k]);

describe('다섯 단계가 모든 축에서 한 방향으로 어려워진다', () => {
  it('코스 — 복잡함을 더 좋게 치고, 더 위 레벨까지 섞는다', () => {
    expect(nonDecreasing(pick('complexity') as number[])).toBe(true);
    expect(nonDecreasing(pick('reach') as number[])).toBe(true);
  });

  it('도움 — 전부 → 할 일만 → 없음 순으로 줄어든다', () => {
    const order = { full: 0, less: 1, none: 2 } as const;
    expect(nonDecreasing(CHALLENGES.map((c) => order[c.hints]))).toBe(true);
    expect(challengeRule(1).hints).toBe('less');
    expect(challengeRule(5).hints).toBe('none');
    // 보통까지는 말풍선 · 느낌표 · 정지 구역 띠를 남긴다 — 이 작품이 보여 주는 AI 기능이다
    expect(challengeRule(3).hints).toBe('less');
  });

  it('주행 — 더 빨리 다가가고, 브레이크가 무르고, 정지선에 더 붙여 서야 한다', () => {
    expect(nonDecreasing(CHALLENGES.map((c) => c.pace.slowKmh))).toBe(true);
    expect(nonDecreasing(CHALLENGES.map((c) => c.pace.approachKmh))).toBe(true);
    expect(nonIncreasing(CHALLENGES.map((c) => c.pace.brakeDecel))).toBe(true);
    expect(nonIncreasing(pick('stopZone') as number[])).toBe(true);
    // 가장 어려운 것은 가장 쉬운 것보다 확실히 어렵다
    expect(challengeRule(5).pace.slowKmh).toBeGreaterThan(challengeRule(1).pace.slowKmh);
    expect(challengeRule(5).stopZone).toBeLessThan(challengeRule(1).stopZone);
  });

  it('경험치 — 레벨업에 더 많이 들고, 위반하면 더 많이 잃는다', () => {
    expect(nonDecreasing(pick('xpScale') as number[])).toBe(true);
    expect(nonDecreasing(pick('missPenalty') as number[])).toBe(true);
    expect(challengeRule(5).xpScale).toBeGreaterThan(challengeRule(1).xpScale);
    expect(challengeRule(3).xpScale, '보통이 경험치 곡선의 기준이다').toBe(1);
  });

  /*
    **한 칸씩 올렸다** — 사용자: "현재 3. 보통을 쉬움으로 하고 난이도를 다시 기획해서 전체적으로 올려 줘."
    예전 보통(서행 14 · 접근 28 · 제동 4.2 · 정지 구역 12m · 위반 −20)이 지금의 쉬움이다.
  */
  it('1(쉬움)은 예전의 보통 그대로다', () => {
    const easy = challengeRule(1);
    expect(easy.pace).toEqual({ slowKmh: 14, approachKmh: 28, brakeDecel: 4.2 });
    expect(easy.stopZone).toBe(12);
    expect(easy.hints).toBe('less');
    expect(easy.missPenalty).toBe(20);
  });

  it('자율 주행은 예전 쉬움 그대로다 — 도움 전부 · 가장 느린 차 · 정지 구역 12m', () => {
    expect(AUTO_DRIVE_RULE.pace).toEqual(DEFAULT_PACE);
    expect(AUTO_DRIVE_RULE.stopZone).toBe(STOP_ZONE_DEPTH);
    expect(AUTO_DRIVE_RULE.hints).toBe('full');
  });
});

describe('어느 난이도든 법을 지키는 주행이다', () => {
  it('차가 알아서 모는 서행 속도가 서행 판정 상한을 넘지 않는다', () => {
    for (const c of CHALLENGES) expect(c.pace.slowKmh).toBeLessThan(SLOW_DOWN_LIMIT_KMH);
  });

  it('보호구역에서는 어느 난이도든 30km/h 로 묶인다', () => {
    for (const c of CHALLENGES) {
      expect(zoneTargetKmh(PLAYER_APPROACH_X, STOP_LINE + 25, true, false, c.pace)).toBeLessThanOrEqual(30);
    }
  });

  /*
    **사람이 설 수 있어야 한다.** 정지 구역이 좁아지고 차가 빨라져도, 서행 속도에서 반응 1초 + 제동 거리가
    정지 구역 안에 들어와야 "보고 눌러서" 설 수 있다. 이것이 어긋나면 어려운 것이 아니라 불가능한 것이다.
  */
  it('서행에서 반응 1초 + 제동 거리가 정지 구역보다 짧다', () => {
    for (const c of CHALLENGES) {
      const v = c.pace.slowKmh / 3.6;
      const needed = v * 1.0 + (v * v) / (2 * c.pace.brakeDecel);
      expect(needed).toBeLessThan(c.stopZone);
    }
  });
});

describe('주행 — 차가 난이도대로 달린다', () => {
  it('어려울수록 정지선 앞에서 더 빨리 다가간다', () => {
    const at = (c: 1 | 5) => zoneTargetKmh(PLAYER_APPROACH_X, STOP_LINE + 10, false, false, challengeRule(c).pace);
    expect(at(1)).toBe(14);
    expect(at(5)).toBeGreaterThan(at(1));
  });

  it('어려울수록 브레이크가 물러 서는 데 더 걸린다', () => {
    const stopDistance = (c: 1 | 5) => {
      const pace = challengeRule(c).pace;
      const car = new Vehicle(4.6, false, false, STOP_LINE + 10, pace);
      const z0 = car.z;
      for (let i = 0; i < 600 && car.speed > 0; i++) car.update({ stop: true, steer: 0, rightSignal: true }, 1 / 60);
      return z0 - car.z;
    };
    expect(stopDistance(5)).toBeGreaterThan(stopDistance(1));
  });
});

describe('정지 구역 — 정지선에 붙여 서야 한다', () => {
  const codes = (r: JudgeResult) => r.violations.map((v) => v.code);

  it('쉬움에서는 정지선 10m 앞에서 서도 인정된다', () => {
    const r = simulate({ vehicleLight: 'red', stopZone: challengeRule(1).stopZone }, { stopAtLine: 1, lineGap: 10 });
    expect(codes(r)).not.toContain('RED_NO_STOP');
  });

  it('어려움에서는 10m 앞에서 선 것은 정지선 앞 정지가 아니다 — 그리고 왜 아닌지 적힌다', () => {
    const r = simulate({ vehicleLight: 'red', stopZone: challengeRule(5).stopZone }, { stopAtLine: 1, lineGap: 10 });
    expect(codes(r)).toContain('RED_NO_STOP');
    expect(r.log.some((e) => e.text.includes('너무 멀어'))).toBe(true);
  });

  it('어려움에서도 정지선에 붙여 서면 인정된다', () => {
    const r = simulate({ vehicleLight: 'red', stopZone: challengeRule(5).stopZone }, { stopAtLine: 1, lineGap: 2 });
    expect(codes(r)).not.toContain('RED_NO_STOP');
  });
});

describe('경험치 — 난이도에 따라 오르는 속도가 다르다', () => {
  const clean = { violations: [], failReason: null } as unknown as JudgeResult;
  const miss = {
    violations: [{ code: 'RED_NO_STOP' }],
    failReason: null,
  } as unknown as JudgeResult;
  const at = (level: number): CurriculumState => ({ ...freshCurriculum(), level: level as CurriculumState['level'] });
  const runsToLevelUp = (level: number, c: 1 | 3 | 5): number => {
    let s = at(level);
    let n = 0;
    while (s.level === level && n < 50) {
      s = advance(s, clean, undefined, challengeRule(c)).next;
      n++;
    }
    return n;
  };

  /*
    **레벨업은 어느 난이도에서도 무위반 두 판이다** (curriculum.ts 의 XP_MAX). 사용자가 정했다:
    "각 단계의 레벨을 200점을 맥스로 해 줘 … 레벨이 쉽게 올라야 사용자들이 체감하기 좋을 것 같아."

    그래서 난이도가 **판 수**로 어려워지지 않는다 — 판을 더 많이 달리게 하는 것은 어려움이 아니라
    시간이 더 드는 것뿐이다. 어려움이 갈리는 자리는 **감점**(아래)과 코스 · 주행 · 도움이다.
  */
  it('레벨업은 어느 난이도에서도 무위반 두 판이다', () => {
    for (const c of [1, 3, 5] as const) expect(runsToLevelUp(6, c), `난이도 ${c}`).toBe(2);
  });

  it('어려움(5)은 위반한 판에서 80 을, 쉬움(1)은 20 을 잃는다', () => {
    const s = { ...at(6), xp: 100 };
    expect(advance(s, miss, undefined, challengeRule(5)).next.xp).toBe(20);
    expect(advance(s, miss, undefined, challengeRule(1)).next.xp).toBe(80);
  });

  it('경험치가 차도 레벨을 올리기 전에는 그 레벨의 차가 열리지 않는다', () => {
    const s = advance({ ...at(6), bestLevel: 5 }, clean, undefined, challengeRule(5)).next;
    expect(s.level).toBe(6);
    expect(s.bestLevel).toBe(5);
  });

  it('L10 에서 마스터도 무위반 두 판이다', () => {
    const until = (c: 1 | 5): number => {
      let s = at(MAX_LEVEL);
      let n = 0;
      while (!s.mastered && n < 50) {
        s = advance(s, clean, undefined, challengeRule(c)).next;
        n++;
      }
      return n;
    };
    // 막대의 최대치가 200 이라 어느 난이도든 두 판이다 (curriculum.ts 의 XP_MAX)
    expect(until(1)).toBe(2);
    expect(until(5)).toBe(2);
  });
});
