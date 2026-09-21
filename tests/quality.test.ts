/**
 * **화질 설정** (game/quality.ts) — 사용자가 "고성능 PC 에서는 쾌적한데 일반 PC 에서는 설정을 다 꺼도 느리다" 고 했다.
 *
 * 여기서는 두 가지를 못 박는다.
 *  - **렌더 해상도 '자동'** 이 느릴 때만 낮추고, 낮춰도 빨라지지 않으면 되돌리며, 오르내림을 되풀이하지 않는가
 *  - 프리셋 '낮음' 이 정말로 가벼운가 — 신호등 조명까지 끄고 해상도를 낮추는가
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_RES_MIN,
  AutoResolution,
  defaultGraphics,
  graphicsFromSaved,
  learnedScale,
  matchedPreset,
  presetDiff,
  presetGraphics,
  startScale,
  usesLampLights,
  type GraphicsSettings,
} from '../src/game/quality';

/** 일정한 fps 로 `seconds` 초 동안 그린다 — 배율이 바뀔 때마다 기록하고, 바뀐 배율에 따라 fps 를 정하는 함수를 받는다 */
function drive(
  ctl: AutoResolution,
  fpsAt: (scale: number) => number,
  seconds: number,
  start = 0,
): { changes: number[]; end: number } {
  const changes: number[] = [];
  let t = start;
  const end = start + seconds * 1000;
  while (t < end) {
    t += 1000 / fpsAt(ctl.scale);
    const next = ctl.frame(t);
    if (next !== null) changes.push(next);
  }
  return { changes, end: t };
}

describe('렌더 해상도 자동 조절', () => {
  it('느리지 않으면 건드리지 않는다', () => {
    const ctl = new AutoResolution(60, 1, 0);
    expect(drive(ctl, () => 60, 30).changes).toEqual([]);
    expect(ctl.scale).toBe(1);
  });

  it('픽셀에 묶인 기기 — 느리면 한 단계씩 낮추고, 목표에 닿으면 멈춘다', () => {
    // 픽셀 수(배율²)에 비례해 느려지는 기기: 100% 에서 30fps, 70% 에서 약 61fps
    const ctl = new AutoResolution(60, 1, 0);
    const { changes, end } = drive(ctl, (s) => 30 / (s * s), 40);
    // 70% 에서 목표에 닿으면 한 번 85% 로 올려 보고, 다시 느려지면 되내린 뒤 거기서 멈춘다
    expect(changes).toEqual([0.85, 0.7, 0.85, 0.7]);
    expect(ctl.scale).toBe(0.7);
    expect(drive(ctl, (s) => 30 / (s * s), 60, end).changes).toEqual([]);
  });

  it('낮춰도 빨라지지 않으면(병목이 픽셀이 아니면) 되돌리고 더 건드리지 않는다', () => {
    // 절전 모드처럼 무엇을 해도 30fps 에 묶인 경우
    const ctl = new AutoResolution(60, 1, 0);
    const { changes } = drive(ctl, () => 30, 60);
    expect(changes).toEqual([0.85, 1]);
    expect(ctl.scale).toBe(1);
  });

  it('가장 낮게는 55% 다', () => {
    const ctl = new AutoResolution(60, 1, 0);
    drive(ctl, (s) => 12 / (s * s), 60);
    expect(ctl.scale).toBe(AUTO_RES_MIN);
  });

  it('여유가 생기면 올려 보고, 곧 다시 느려지면 되내린 뒤 멈춘다', () => {
    // 70% 에서 여유가 넉넉하다가(무거운 장면이 지나감), 85% 로 올리면 다시 느려지는 기기
    const ctl = new AutoResolution(60, 0.7, 0);
    const { changes } = drive(ctl, (s) => (s <= 0.7 ? 60 : 45), 60);
    expect(changes).toEqual([0.85, 0.7]);
    expect(ctl.scale).toBe(0.7);
    // 한 번 되내렸으면 다시 올리지 않는다 — 오르내림을 되풀이하면 화면이 번갈아 흐려진다
    expect(drive(ctl, (s) => (s <= 0.7 ? 60 : 45), 60, 60_000).changes).toEqual([]);
  });

  it('판을 막 시작한 3초는 재지 않는다 — 셰이더 컴파일로 잠깐 느리다', () => {
    const ctl = new AutoResolution(60, 1, 0);
    expect(drive(ctl, () => 20, 2.9).changes).toEqual([]);
  });

  it('프레임 상한 30 이면 30 을 목표로 본다', () => {
    const ctl = new AutoResolution(30, 1, 0);
    expect(drive(ctl, () => 30, 30).changes).toEqual([]);
  });

  it('찾은 배율은 다음 판의 시작값이 된다 (자동일 때만)', () => {
    const ctl = new AutoResolution(60, 1, 0);
    drive(ctl, (s) => 30 / (s * s), 40);
    expect(learnedScale()).toBe(0.7);
    expect(startScale('auto')).toBe(0.7);
    expect(startScale(75)).toBe(0.75);
    expect(startScale(100)).toBe(1);
  });
});

describe('화질 프리셋', () => {
  /*
    **처음 켠 화면은 어떤 프리셋과도 같아야 한다** — 사용자가 "전체 프리셋에 아무것도 설정되어 있지 않다" 고
    세 번 짚었다. 기본값이 프리셋 중 하나와 똑같지 않으면 처음부터 '사용자 지정' 으로 열린다.
  */
  it("기본은 '보통' — 프리셋 하나가 켜진 채로 열린다", () => {
    const g = defaultGraphics();
    expect(matchedPreset(g)).toBe('medium');
    // 해상도는 '자동' — 처음부터 흐리게 시작하지 않고, 느릴 때만 스스로 낮춘다
    expect(g.resolution).toBe('auto');
    expect(g.frameCap).toBe(60);
    // 보통은 신호등 조명을 끈다 (GPU −25%)
    expect(usesLampLights(g.reflection)).toBe(false);
  });

  it("'낮음' 은 정말 가볍다 — 신호등 조명을 끄고 해상도를 75% 로 시작한다", () => {
    const low = presetGraphics('low', defaultGraphics());
    expect(usesLampLights(low.reflection)).toBe(false);
    expect(low.resolution).toBe(75);
    expect(low.shadow).toBe('low');
    expect(low.peripheral).toBe('off');
    expect(matchedPreset(low)).toBe('low');
  });

  it("'보통' 도 신호등 조명을 끈다 — 약한 기기를 위한 단계다", () => {
    expect(usesLampLights(presetGraphics('medium', defaultGraphics()).reflection)).toBe(false);
  });

  it('해상도만 바꾸면 사용자 지정이 된다', () => {
    expect(matchedPreset({ ...defaultGraphics(), resolution: 50 })).toBeNull();
  });

  /*
    프리셋이 하나도 켜지지 않으면 **왜 그런지**를 화면이 말한다 — 사용자가 두 번 물었다: "전체 프리셋은 초기에
    설정이 되어 있지 않아. 왜 그런 거니?" 규칙대로여도 보이지 않으면 고장으로 읽힌다 (presetDiff).
  */
  it('어느 프리셋에서 무엇이 다른지 말한다', () => {
    expect(presetDiff({ ...defaultGraphics(), resolution: 50 })).toEqual({ tier: 'medium', fields: ['렌더 해상도'] });
    expect(presetDiff({ ...presetGraphics('low', defaultGraphics()), shadow: 'ultra' })).toEqual({
      tier: 'low',
      fields: ['그림자 품질'],
    });
    // 프리셋과 똑같으면 말할 것이 없다
    expect(presetDiff(defaultGraphics())).toBeNull();
  });
});

/*
  **나중에 생긴 항목이 예전 프리셋을 풀면 안 된다** — 사용자가 짚었다: "설정에서 전체 프리셋은 초기에 설정이 되어
  있지 않아. 왜 그런 거니?" 화질을 다 낮춰 두고 쓰던 저장본이 그랬다 (graphicsFromSaved).
*/
describe('저장본의 화질 읽기', () => {
  /** 렌더 해상도 항목이 생기기 전의 저장본 모양 */
  const old = (g: Partial<GraphicsSettings>): Partial<GraphicsSettings> => ({
    shadow: 'high',
    reflection: 'high',
    peripheral: 'driverOnly',
    frameCap: 0,
    msaa: true,
    showFps: false,
    ...g,
  });

  it("해상도가 없던 저장본에서 나머지가 '낮음' 이면 '낮음' 그대로 열린다", () => {
    const g = graphicsFromSaved(old({ shadow: 'low', reflection: 'low', peripheral: 'off', frameCap: 30 }));
    expect(g.resolution).toBe(75);
    expect(matchedPreset(g)).toBe('low');
  });

  it("'보통' · '아주 높음' 도 마찬가지다", () => {
    expect(
      matchedPreset(graphicsFromSaved(old({ shadow: 'medium', reflection: 'medium', frameCap: 60 }))),
    ).toBe('medium');
    expect(
      matchedPreset(graphicsFromSaved(old({ shadow: 'ultra', reflection: 'ultra', peripheral: 'always' }))),
    ).toBe('ultra');
  });

  it('정말로 사용자 지정이던 저장본은 건드리지 않는다 — 고른 적 없는 해상도를 들이밀지 않는다', () => {
    const g = graphicsFromSaved(old({ shadow: 'low', peripheral: 'always' }));
    expect(g.resolution).toBe('auto');
    expect(matchedPreset(g)).toBeNull();
  });

  it('해상도를 직접 고른 저장본은 그 값을 지킨다', () => {
    const g = graphicsFromSaved(old({ shadow: 'low', reflection: 'low', peripheral: 'off', frameCap: 30, resolution: 50 }));
    expect(g.resolution).toBe(50);
  });

  /*
    저장본이 **한 번이라도 저장된 뒤라면** 채워진 '자동' 이 그대로 적혀 있어 `undefined` 로는 가려낼 수 없다.
    사용자의 PC 가 그랬다 — 판이 끝날 때마다 저장되므로 거의 모든 저장본이 이 모양이다.
  */
  it("이미 '자동' 이 적혀 저장된 예전 저장본도 한 번은 되살린다 (v11 이전)", () => {
    const saved = old({ shadow: 'low', reflection: 'low', peripheral: 'off', frameCap: 30, resolution: 'auto' as const });
    // 버전으로 허락하지 않으면 고른 값으로 보고 그대로 둔다
    expect(matchedPreset(graphicsFromSaved(saved))).toBeNull();
    const revived = graphicsFromSaved(saved, true);
    expect(revived.resolution).toBe(75);
    expect(matchedPreset(revived)).toBe('low');
  });

  it("되살릴 때도 '자동' 이 맞는 프리셋은 그대로 둔다", () => {
    // '높음' 은 해상도가 자동이라 바뀔 것이 없다
    expect(graphicsFromSaved(old({}), true).resolution).toBe('auto');
  });

  it("저장본이 없으면 기본값 — '보통'", () => {
    expect(matchedPreset(graphicsFromSaved(undefined))).toBe('medium');
    // 고른 것 하나 없는 빈 저장본도 기본값 그대로다 (해상도를 넘겨짚지 않는다)
    expect(graphicsFromSaved({}).resolution).toBe('auto');
  });
});
