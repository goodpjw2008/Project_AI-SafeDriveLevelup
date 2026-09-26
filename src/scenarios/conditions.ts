/**
 * **환경이 물리를 바꾼다 — 비는 제동거리, 밤은 시야.**
 *
 * 한때 밤 · 비는 그림과 난이도 점수에만 있었다. 브레이크도 같고 보행자가 보이는 거리도 같아, 시뮬레이터로 학습한 모델이
 * 비와 밤을 오히려 조금 쉬운 쪽으로 배웠다. 사용자가 변수 설계를 다시 보며 정했다 (2026-09-27): "비 = 제동거리, 밤 = 시야 —
 * 꼭 필요함." 여기서 한 곳에 두고 게임(game/Game.ts) · 시뮬레이터(scenarios/playSim.ts) · 보행자 안내(game/pedCue.ts)가
 * 같은 값을 쓴다 — 셋이 어긋나면 "규정대로 했는데 위반" 이 나온다.
 *
 *  - **빗길** — 제동 감속도를 `WET_BRAKE_FACTOR` 배로 줄인다. 젖은 아스팔트의 마찰이 마른 길의 0.7 배쯤이라 제동거리가
 *    1.4 배로 는다 (v²/2a). 자율 주행 운전자도 같은 감속도로 서는 거리를 세므로 제동을 그만큼 일찍 시작한다.
 *  - **밤** — 보행자의 뜻을 알아보는 거리를 `NIGHT_SIGHT_M` 으로 줄인다. 전조등이 비추는 거리다. 낮에는 제한이 없다.
 *    운전자(AI · 시뮬레이터의 사람)가 보는 보행자 목록과 화면의 느낌표 안내 거리가 함께 줄어, 밤에는 같은 사람이 더
 *    가까이 와서야 보인다 — 그만큼 판단할 시간이 짧다.
 *
 * 판정(rules/lawRules.ts)은 바뀌지 않는다 — 법은 밤에도 같다. 순수 모듈이다.
 */

import { crosswalkDistance } from '../ai/telemetry';
import { AFTER_LEAD_BRAKE } from '../game/pedWalk';
import type { PedestrianSample } from '../rules/lawRules';
import type { DrivePace } from './challenge';
import type { TimeOfDay, Weather } from './scenarios';

/** 빗길의 제동 감속도 배율 — 제동거리 ≈ 1 / 0.7 = 1.4 배 */
export const WET_BRAKE_FACTOR = 0.7;

/** 밤에 보행자의 뜻을 알아보는 거리 (m) — 전조등 범위. 낮은 Infinity */
export const NIGHT_SIGHT_M = 26;

/** 날씨에 맞춘 주행 값 — 비면 브레이크가 무르다 */
export function paceFor(pace: DrivePace, weather: Weather): DrivePace {
  return weather === 'rain' ? { ...pace, brakeDecel: pace.brakeDecel * WET_BRAKE_FACTOR } : pace;
}

/**
 * 앞차 뒤로 나서는 사람이 "내가 설 수 있는 거리" 를 셀 때의 브레이크 (game/pedWalk.ts 의 AFTER_LEAD_*) — 빗길이면
 * 그만큼 무르게 잰다. 안전장치가 마른 길 값으로 재면 빗길에서는 같은 거리가 함정이 된다.
 */
export function afterLeadBrake(weather: Weather): number {
  return weather === 'rain' ? AFTER_LEAD_BRAKE * WET_BRAKE_FACTOR : AFTER_LEAD_BRAKE;
}

/** 보행자를 알아보는 거리 — 밤에는 전조등 범위, 낮에는 제한 없음 */
export function sightRange(timeOfDay: TimeOfDay): number {
  return timeOfDay === 'night' ? NIGHT_SIGHT_M : Infinity;
}

/**
 * 운전자가 **알아보는** 보행자만 남긴다 — 그 사람이 선 횡단보도까지의 거리가 시야 안일 때.
 * 이미 차도 위에 있어 부딪힐 수 있는 사람(onConflictPath)은 거리와 상관없이 본다 — 시야가 짧아도 코앞의 사람을 못 본다고
 * 두면 판이 아니라 함정이 된다.
 */
export function seenPedestrians<T extends PedestrianSample>(
  peds: readonly T[],
  front: { x: number; z: number },
  timeOfDay: TimeOfDay,
): T[] {
  const range = sightRange(timeOfDay);
  if (!Number.isFinite(range)) return [...peds];
  return peds.filter((p) => p.onConflictPath || crosswalkDistance(p.crosswalk, front) <= range);
}
