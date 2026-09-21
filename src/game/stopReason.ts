/**
 * **왜 서는가** — 화면이 '일시정지' 와 '신호 대기' 를 가려 말하게 하는 한 벌의 판단.
 *
 * 둘은 조문이 다르다.
 *
 *  - **일시정지** — 신호기가 **없는** 어린이보호구역 횡단보도. 보행자가 없어도 서고, 서고 나면 간다
 *    (제27조 제7항). 교차로의 원형 적색도 "서고 나서 우회전" 이라 같은 말을 쓴다.
 *  - **신호 대기** — 신호기가 **있는** 횡단보도의 적색 · 황색. 서는 것으로 끝나지 않고 **녹색이 될
 *    때까지 기다린다** (제5조). 판정도 이것을 따로 센다 (lawRules.ts 의 `SCHOOL_ZONE_RED` —
 *    "서고 나서 가도 위반이라 코드를 갈라 둔다").
 *
 * 화면은 이 구분을 잃고 있었다. 진입로 보호구역의 **신호 있는** 횡단보도 적색 앞에서도 말풍선이
 * '일시정지' 라고 적었다 — 사용자가 화면을 보고 짚었다: "이 상황은 일시정지가 아니고 신호가 끝날
 * 때까지 기다리는 신호 대기 상황 아니야?" 잠깐 섰다 가면 되는 자리로 읽히면, 이 판이 가르치려는
 * 것과 정반대를 가르치게 된다.
 *
 * **말풍선(ui/Hud.ts)과 계기판(ClusterPanel.ts)이 같은 함수를 본다** — 한 화면이 같은 상황을 두
 * 이름으로 부르지 않게. 우회전 신호등에는 이미 같은 구분이 있다 (Hud 의 `arrowHold`).
 */

import type { LightColor } from '../rules/lawRules';
import type { StopTarget } from './StopMarkers';

/** 이 판단에 필요한 것만 — 화면과 계기판이 같은 값으로 묻게 한다 */
export interface StopReasonInput {
  target: StopTarget;
  advice: 'stop' | 'yield' | 'go';
  /** 진입로 보호구역 횡단보도의 차량 등화. 그 보호구역이 없거나 신호기가 없으면 null */
  zoneLight: LightColor | null;
}

/** 지금 서는 까닭이 **신호**인가 (일시정지 의무가 아니라) */
export const isSignalWait = (s: StopReasonInput): boolean =>
  s.target === 'zone' && s.advice === 'stop' && s.zoneLight !== null && s.zoneLight !== 'green';
