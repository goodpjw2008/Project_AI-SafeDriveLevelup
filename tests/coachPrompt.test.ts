/**
 * 코치 프롬프트 — 두 가지를 지킨다.
 *
 *  1. **서버가 아는 위반 코드가 판정 엔진의 것과 정확히 같은가.**
 *     server/coachPrompt.mjs 는 src/rules/violations.ts 를 import 할 수 없다 (Cloudflare
 *     Workers 에서도 돌아야 해서 TS 를 못 읽는다). 그래서 코드 목록이 두 곳에 있는데,
 *     새 위반을 추가하고 한쪽만 고치면 그 위반은 코치에게 **없는 일**이 된다.
 *
 *  2. **판정에 없는 것이 프롬프트에 실리지 않는가.** 좌표·내부 식별자는 코치가 문장을
 *     만드는 데 쓸 수 없고, 그 값이 문장에 나오면 학습자에게는 소음이다.
 */

import { describe, expect, it } from 'vitest';

import { VIOLATION_BRIEF, buildUserPrompt } from '../server/coachPrompt.mjs';
import { VIOLATIONS } from '../src/rules/violations';

describe('서버 위반 코드 ↔ 판정 엔진', () => {
  it('두 목록이 정확히 같다', () => {
    expect(Object.keys(VIOLATION_BRIEF).sort()).toEqual(Object.keys(VIOLATIONS).sort());
  });

  it('모든 코드에 위반명과 조문 표기가 있다', () => {
    for (const [code, brief] of Object.entries(VIOLATION_BRIEF)) {
      expect(brief.title, `${code}.title`).toBeTruthy();
      expect(brief.law, `${code}.law`).toBeTruthy();
    }
  });
});

const RUN = {
  stage: 4,
  title: '녹색 신호 우회전',
  grade: 'VIOLATION',
  failReason: null,
  violations: [
    {
      code: 'PEDESTRIAN_BLOCKED',
      atTime: 12.04,
      place: '우회전 후 횡단보도(C) 위',
      inSchoolZone: false,
    },
  ],
  stats: {
    cleanStopBeforeA: true,
    lateStopBeforeA: false,
    stopBeforeC: false,
    maxSpeedInIntersection: 14.2,
    signalAt30m: true,
    elapsed: 14.6,
  },
  log: [
    { t: 5.0, level: 'ok', text: '정지선 앞 일시정지 인정' },
    { t: 12.0, level: 'bad', text: '위반 확정: 횡단보도 보행자 횡단 방해' },
  ],
};

describe('buildUserPrompt', () => {
  const text = buildUserPrompt(RUN);

  it('위반을 조문 표기와 함께 싣는다', () => {
    expect(text).toContain('횡단보도 보행자 횡단 방해');
    expect(text).toContain('도로교통법 제27조 제1항');
  });

  it('되짚을 수 있는 위치 이름을 싣는다', () => {
    expect(text).toContain('우회전 후 횡단보도(C) 위');
  });

  it('주행 기록의 성격(잘함·위반)을 구분해 싣는다', () => {
    expect(text).toContain('[잘함]');
    expect(text).toContain('[위반]');
  });

  it('아슬아슬하게 봐준 것을 위반과 섞지 않는다', () => {
    const warned = buildUserPrompt({
      ...RUN,
      log: [{ t: 5.0, level: 'warn', text: '정지선을 0.33m 넘었지만 허용 오차 안' }],
    });
    expect(warned).toContain('[아슬아슬]');
    expect(warned).not.toContain('[위반]');
  });

  it('완주한 판에는 실패 사유를 붙이지 않는다', () => {
    expect(text).not.toContain('실패 사유');
  });
});
