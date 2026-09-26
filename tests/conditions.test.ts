import { describe, expect, it } from 'vitest';
import { NIGHT_SIGHT_M, WET_BRAKE_FACTOR, afterLeadBrake, paceFor, seenPedestrians, sightRange } from '../src/scenarios/conditions';
import { AFTER_LEAD_BRAKE } from '../src/game/pedWalk';
import { challengeRule } from '../src/scenarios/challenge';
import { libraryEntryByNumber, scenarioLibrary } from '../src/scenarios/library';
import { playScenario } from '../src/scenarios/playSim';
import type { PedestrianSample } from '../src/rules/lawRules';

/*
  **환경은 물리다** (사용자가 정했다: "비 = 제동거리, 밤 = 시야"). 비는 브레이크를 무르게, 밤은 보행자를 늦게 보이게 한다.
  낮 · 맑음의 같은 판과 견줘 시뮬레이터에서 실제로 그렇게 되는지도 본다.
*/
describe('비와 밤', () => {
  it('빗길은 제동 감속도가 0.7 배 — 제동거리 1.4 배', () => {
    const dry = challengeRule(3).pace;
    const wet = paceFor(dry, 'rain');
    expect(wet.brakeDecel).toBeCloseTo(dry.brakeDecel * WET_BRAKE_FACTOR, 6);
    expect(wet.slowKmh).toBe(dry.slowKmh);
    expect(paceFor(dry, 'clear')).toEqual(dry);
  });

  it('빗길에서는 앞차 뒤로 나서는 사람의 안전장치도 젖은 브레이크로 잰다 — 1초 늦게 보는 사람이 설 수 있다', () => {
    expect(afterLeadBrake('clear')).toBe(AFTER_LEAD_BRAKE);
    expect(afterLeadBrake('rain')).toBeCloseTo(AFTER_LEAD_BRAKE * WET_BRAKE_FACTOR, 6);
    // 3465번 — 정면 적색 · 어린이보호구역 · 우회전 중 뛰어드는 노인 · 앞차 일시정지 무시 · 빗길. 마른 길 값으로 재던 때 걸렸다
    const e = libraryEntryByNumber(3465)!;
    expect(e.spec.weather).toBe('rain');
    expect(e.spec.leadCar).toBeTruthy();
    const normal = challengeRule(3);
    const r = playScenario(e.spec, { persona: 'human', reaction: 1, pace: normal.pace, stopZone: normal.stopZone, trace: false });
    expect(r.result.violations.map((v) => v.code)).toEqual([]);
    expect(r.result.completed).toBe(true);
  });

  it('밤에는 전조등 범위 안의 사람만 보이고, 차도 위의 사람은 거리와 상관없이 보인다', () => {
    expect(sightRange('day')).toBe(Infinity);
    expect(sightRange('night')).toBe(NIGHT_SIGHT_M);
    const far: PedestrianSample = { crosswalk: 'A', intendsToCross: true, onConflictPath: false };
    const near: PedestrianSample = { crosswalk: 'A', intendsToCross: true, onConflictPath: false };
    const onRoad: PedestrianSample = { crosswalk: 'A', intendsToCross: true, onConflictPath: true };
    // 첫 횡단보도 바깥 가장자리(18.8)에서 40m 앞 · 10m 앞
    expect(seenPedestrians([far, near, onRoad], { x: 0, z: 18.8 + 40 }, 'night')).toEqual([onRoad]);
    expect(seenPedestrians([far, near, onRoad], { x: 0, z: 18.8 + 10 }, 'night').length).toBe(3);
    expect(seenPedestrians([far, near, onRoad], { x: 0, z: 18.8 + 40 }, 'day').length).toBe(3);
  });

  it('같은 판이라도 빗길은 제동을 더 일찍 시작하고, 밤은 보행자를 더 늦게 본다', () => {
    const lib = scenarioLibrary();
    const twin = (e: (typeof lib)[number], env: 'rain' | 'night') =>
      lib.find((x) => x.tags.env === env && Object.entries(x.tags).every(([k, v]) => k === 'env' || v === (e.tags as never)[k]))!;
    // 정면 적색 · 보행자 없음 — 정지선 앞 제동 시작 거리를 견준다
    const dryRed = lib.find((e) => e.tags.signal === 'red' && e.tags.a === 'none' && e.tags.c === 'none' && e.tags.env === 'day' && e.tags.lead === 'none' && e.tags.zone === 'no' && e.tags.approach === 'none' && e.tags.extra === 'none' && e.tags.jam === 'none')!;
    const wetRed = twin(dryRed, 'rain');
    const run = (spec: (typeof lib)[number]['spec']) => playScenario(spec, { persona: 'careful', pace: challengeRule(3).pace, trace: false, telemetry: true }).result.features!;
    const dry = run(dryRed.spec);
    const wet = run(wetRed.spec);
    expect(wet.brakeA!).toBeGreaterThan(dry.brakeA!);
    expect(wet.viol).toBe(0);
    // 녹색 · 우회전 후 건너려는 사람 — 밤에는 사람을 늦게 보므로 제동이 필요해진 뒤 밟는 시간이 길거나 같다
    const dayPed = lib.find((e) => e.tags.signal === 'green' && e.tags.a === 'none' && e.tags.c === 'waiting' && e.tags.env === 'day' && e.tags.lead === 'none' && e.tags.zone === 'no' && e.tags.approach === 'none' && e.tags.extra === 'none')!;
    const nightPed = twin(dayPed, 'night');
    const day = playScenario(dayPed.spec, { persona: 'human', reaction: 1.0, pace: challengeRule(3).pace, trace: false, telemetry: true }).result.features!;
    const night = playScenario(nightPed.spec, { persona: 'human', reaction: 1.0, pace: challengeRule(3).pace, trace: false, telemetry: true }).result.features!;
    expect(night.viol).toBe(0);
    expect(night.reactMax ?? 0).toBeGreaterThanOrEqual(day.reactMax ?? 0);
  });
});
