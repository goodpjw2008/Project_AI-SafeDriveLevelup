import { describe, expect, it } from 'vitest';
import { parseExperiments } from '../src/game/experiments';

describe('실험 스위치 — 주소의 ?x=', () => {
  it('쉼표로 이은 이름을 소문자로 돌려준다', () => {
    expect(parseExperiments('shadowlag, Finish')).toEqual(['shadowlag', 'finish']);
  });
  it('없거나 비었거나 off 면 아무것도 켜지 않는다', () => {
    expect(parseExperiments(null)).toEqual([]);
    expect(parseExperiments('')).toEqual([]);
    expect(parseExperiments('off')).toEqual([]);
  });
});
