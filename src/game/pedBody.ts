/**
 * **보행자의 몸이 서는 자리** — 상태기계(pedWalk.ts)의 축 좌표에, 연석에서 물러선 만큼을 더한 것. three 없이.
 *
 * 상태기계의 축 좌표는 판정을 위한 값이라 기다리는 사람은 늘 연석(CURB)에 있다. 화면에서는 **건널 뜻이 있는 사람만
 * 연석까지 나와 서고**, 뜻이 없으면 0.8m 물러서 있다 (아래 WAIT_SETBACK). 운전자가 "저 사람이 나올까" 를 선 자리로
 * 읽게 하려는 것이다.
 *
 * 이 자리를 게임(Pedestrian.ts)과 시뮬레이터(scenarios/playSim.ts)가 **함께** 쓴다. AI 자율주행의 보행자 의도 예측
 * (ai/intent.ts)이 보는 것이 바로 이 몸의 자리라, 두 곳이 따로 셈하면 시뮬레이터에서 학습 · 검증한 것과 게임에서
 * 보는 것이 갈린다.
 */

import {
  BIKE_SLOT_SHRINK,
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_S_OUTER,
  bikeLaneCenter,
} from '../layout';
import type { CrosswalkId } from '../rules/lawRules';
import type { PedWalkSample } from './pedWalk';

/**
 * 건널 뜻이 없는 사람이 **연석에서 물러서 있는 거리** (m).
 *
 * 예전에는 모두 똑같이 연석에 붙어 서 있어, 운전자로서는 "저 사람이 나올까" 를 자세로 읽을 수 없었다.
 * 이제 **뜻이 있는 사람만 연석까지 나와 선다** (pedWalk.ts 의 `INTENT_LEAD`). 뜻이 생기는 순간 한 걸음 나서는
 * 동작이 보이고, 그 뒤로는 차도 가장자리에 붙어 서 있다. 멀리서 놓쳤더라도 **선 자리만으로** 읽히는 것이
 * 요점이다 — 그 순간의 동작을 보아야만 알 수 있는 신호는 하필 그때 다른 곳을 보고 있던 사람에게 아무것도 아니다.
 *
 * 0.8m 는 사람 어깨너비보다 넓어 나란히 선 둘 사이에서도 앞뒤가 갈린다.
 */
export const WAIT_SETBACK = 0.8;

/** 연석까지 한 걸음 나서는 데 걸리는 시간 (초) */
export const STEP_UP_TIME = 0.55;

/**
 * **몸의 배율** — 게임의 보행자 크기 배율(Pedestrian.ts 의 SIZE_SCALE, 2.0) × 나이(어린이 0.66 · 어르신 0.92). LiDAR 가 맞히는
 * 몸의 크기다 (lidarSensor.ts 의 personShapes) — 시뮬레이터가 쏘는 LiDAR 도 게임과 같은 몸을 맞혀야 한다.
 */
export function bodyScale(kind: 'adult' | 'child' | 'elder' = 'adult', sizeScale = 2.0): number {
  return (kind === 'child' ? 0.66 : kind === 'elder' ? 0.92 : 1) * sizeScale;
}

/** 몸이 돌아선 각 (three.js 의 rotation.y) — 건너는 쪽을 본다. S · A · B 는 x 축, C 는 z 축으로 건넌다 */
export function bodyFacing(id: CrosswalkId, dir: 1 | -1): number {
  if (id === 'C') return dir === 1 ? Math.PI : 0;
  return dir === 1 ? -Math.PI / 2 : Math.PI / 2;
}

/** 같은 보도에 선 사람끼리의 자리 — 횡단보도 폭 안에서의 좌우 어긋남 (m) */
export const WAIT_SLOTS = [0, -1.15, 1.15, -1.8, 1.8];

const CROSSWALK_CENTER = (CROSSWALK_INNER + CROSSWALK_OUTER) / 2;
const CROSSWALK_S_CENTER = (CROSSWALK_S_INNER + CROSSWALK_S_OUTER) / 2;
const CROSSWALK_B_CENTER = (CROSSWALK_B_INNER + CROSSWALK_B_OUTER) / 2;

/** 횡단보도마다 **줄무늬 한가운데** — 건너는 축과 직각인 좌표 */
export const crosswalkCenter = (id: CrosswalkId): number =>
  id === 'S' ? CROSSWALK_S_CENTER : id === 'B' ? CROSSWALK_B_CENTER : CROSSWALK_CENTER;

/**
 * **건너는 자리** (건너는 축과 직각인 좌표) — 보통은 횡단보도 줄무늬 한가운데에 자리 어긋남을 더한 곳이다.
 *
 * **타고 건너는 자전거만 자전거횡단도 위**로 간다 (제15조의2 제3항). 내려서 끌고 가는 사람은 보행자이므로
 * (제2조 제17호) 줄무늬 위로 건넌다.
 */
export function pedAcross(id: CrosswalkId, bike: 'ride' | 'push' | undefined, offset: number): number {
  if (bike === 'ride') return bikeLaneCenter(id) + offset * BIKE_SLOT_SHRINK;
  return crosswalkCenter(id) + offset;
}

/** 이번 스텝에 연석까지 나서야 하는가 — 건너는 중이거나 건널 뜻이 있으면 나선다 */
export const wantsCurb = (s: Pick<PedWalkSample, 'state' | 'intendsToCross'>): boolean =>
  s.state !== 'waiting' || s.intendsToCross;

/**
 * 물러선 정도(1 = 물러서 있음, 0 = 연석까지 나와 있음)를 한 스텝 옮긴다. **되돌아가기도 한다** — 보행신호가
 * 녹색점멸로 바뀌면 새로 건너지 않는 사람이 되므로(pedWalk 의 isVisiblyWaiting) 한 걸음 물러선다.
 */
export function stepSetback(setback: number, toCurb: boolean, dt: number): number {
  const step = dt / STEP_UP_TIME;
  return toCurb ? Math.max(0, setback - step) : Math.min(1, setback + step);
}

/**
 * 몸의 월드 자리. S · A · B 는 남북 도로를 가로질러 x 축으로, C 는 동서 도로를 가로질러 z 축으로 걷는다.
 *
 * 물러선 만큼 **진행 방향의 반대로** 민다. 상태기계의 축 좌표는 손대지 않는다 — 판정(통행 의사 · 차도 위인가)은
 * 그쪽이 만들고, 여기서 좌표를 바꾸면 검증기와 갈라진다. 나와 선 자리(setback = 0)가 곧 상태기계의 출발 자리라,
 * 걷기 시작하는 순간 이어 붙는 곳이 없다.
 */
export function bodyPosition(
  id: CrosswalkId,
  axis: number,
  dir: 1 | -1,
  setback: number,
  across: number,
): { x: number; z: number } {
  const a = axis - dir * WAIT_SETBACK * setback;
  return id === 'C' ? { x: across, z: a } : { x: a, z: across };
}
