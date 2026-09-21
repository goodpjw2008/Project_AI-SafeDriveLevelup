/**
 * 진행 초기화 — **무엇이 지워지고 무엇이 남는가.**
 *
 * 이 경계가 이 기능의 전부다. 한 대를 여러 운전자가 번갈아 앉는 것이 기본 쓰임이라
 * 앞 운전자의 나쁜 운전 습관은 반드시 지워져야 하고, 몸에 맞춘 설정은 남아야 한다.
 * 둘 중 하나라도 어긋나면 조용히 나빠지는 종류의 버그다.
 * (전시관 사진은 저장본에 없다 — 서버 파일이다. tests/carPhotos.test.ts)
 *
 * localStorage 가 없는 환경에서 돈다 — save() 가 던지지 않고 false 를 돌려주므로
 * `reset()` 의 반환값만으로 검사할 수 있다.
 */

import { describe, it, expect } from 'vitest';
import { defaultSave, hasProgress, reset, type SaveData } from '../src/economy/save';
import { STARTER_CAR_ID } from '../src/economy/cars';
import { START_LEVEL } from '../src/scenarios/curriculum';

/** 한참 몰아 마스터까지 간 사람의 저장본 */
function playedSave(): SaveData {
  const s = defaultSave();
  s.money = 12_400;
  s.activeCarId = 'sf90';
  s.unlockedScenario = 7;
  s.penaltyPoints = 30;
  s.bestGrades = { '3': 'A' };
  s.stats = { ...s.stats, attempts: 22, perfects: 9, streak: 3, bestStreak: 5 };
  s.history = [{ st: 3, g: 'B', v: ['RED_NO_STOP'], sa: false, sc: true, sp: 21, sg: true }];
  s.curriculum = {
    ...s.curriculum,
    level: 10,
    bestLevel: 10,
    mastered: true,
    runs: 22,
    cleanStreak: 3,
    badHabits: [{ code: 'RED_NO_STOP', count: 4, cleanRuns: 1, lastRun: 20 }],
  };
  // 진행이 아닌 것들 — 초기화 뒤에도 남아야 한다
  s.settings.startView = 'driver';
  s.settings.autoNextStage = false;
  s.seatOffsets = { sf90: 0.12, avante: -0.05 };
  return s;
}

describe('진행 초기화 — 지우는 것', () => {
  const out = reset(playedSave());

  it('나쁜 운전 습관을 지운다 — 다음 운전자가 남의 약점을 연습하면 안 된다', () => {
    expect(out.curriculum.badHabits).toEqual([]);
  });

  /*
    **레벨은 1이 아니라 시작 레벨로 돌아간다.** 새 운전자도 처음 앉는 사람과 같은
    자리에서 시작해야 한다 — 거기서 실수해야 AI 가 그 사람의 판을 만들기 시작한다.
    다만 **통과 기록(bestLevel)은 1로 지워진다.** 앉은 자리는 얻은 자리가 아니다.
  */
  it('레벨을 시작 자리로 되돌리고 통과 기록은 지운다', () => {
    expect(out.curriculum.level).toBe(START_LEVEL);
    expect(out.curriculum.bestLevel, '차는 시작 차 하나만 남는다').toBe(1);
    expect(out.curriculum.mastered).toBe(false);
    expect(out.curriculum.runs).toBe(0);
    expect(out.curriculum.cleanStreak).toBe(0);
  });

  it('주행 기록·통계·점수를 지운다', () => {
    expect(out.history).toEqual([]);
    expect(out.stats.attempts).toBe(0);
    expect(out.stats.bestStreak).toBe(0);
    expect(out.money).toBe(0);
    expect(out.penaltyPoints).toBe(0);
    expect(out.bestGrades).toEqual({});
    expect(out.unlockedScenario).toBe(1);
  });

  it('계급으로 열렸던 차에서 내려 시작 차로 돌아간다', () => {
    expect(out.activeCarId).toBe(STARTER_CAR_ID);
  });
});

describe('진행 초기화 — 남기는 것', () => {
  const before = playedSave();
  const out = reset(before);

  it('화면 설정은 남는다 — 초기화는 "다시 해 보겠다"이지 "설정도 되돌려 달라"가 아니다', () => {
    expect(out.settings.startView).toBe('driver');
    expect(out.settings.autoNextStage).toBe(false);
  });

  it('좌석 위치는 남는다 — 진행이 아니라 몸에 맞춘 값이다', () => {
    expect(out.seatOffsets).toEqual(before.seatOffsets);
  });

  it('넘겨받은 저장본을 건드리지 않는다 (복사해서 담는다)', () => {
    out.seatOffsets['avante'] = 9;
    expect(before.seatOffsets['avante']).toBe(-0.05);
  });
});

describe('초기화 버튼을 띄울지 — hasProgress', () => {
  it('갓 켠 저장본에는 지울 것이 없다', () => {
    expect(hasProgress(defaultSave())).toBe(false);
  });

  it('초기화한 직후에도 지울 것이 없다 (버튼이 그대로 남아 있으면 안 된다)', () => {
    expect(hasProgress(reset(playedSave()))).toBe(false);
  });

  it('한 판만 돌아도 지울 것이 생긴다', () => {
    const s = defaultSave();
    s.stats.attempts = 1;
    expect(hasProgress(s)).toBe(true);
  });

  it('나쁜 운전 습관 하나만 있어도 지울 것이 있다', () => {
    const s = defaultSave();
    s.curriculum.badHabits = [{ code: 'RED_NO_STOP', count: 1, cleanRuns: 0, lastRun: 1 }];
    expect(hasProgress(s)).toBe(true);
  });

  it('차만 바꿔 본 사람에게는 지울 진행이 없다고 본다', () => {
    const s = defaultSave();
    s.activeCarId = 'corolla';
    expect(hasProgress(s)).toBe(false);
  });
});
