/**
 * **이 횡단보도의 보행신호는 무엇인가** — 횡단보도마다 자기 신호를 본다.
 *
 * ## 왜 따로 떼어 두는가
 *
 * 이 게임에는 횡단보도가 셋이고(진입로 보호구역 S · 교차로 앞 A · 우회전 후 C), 신호기는 **두 벌**이
 * 따로 돈다 — 교차로 주기(STANDARD_PROGRAM)와 보호구역 주기(SCHOOL_ZONE_PROGRAM). 그런데 고르는
 * 자리가 화면 쪽(Game.ts)과 검증기 쪽(scenarios/playSim.ts)에 따로 있었고, 화면 쪽이 **'A 냐 아니냐'**
 * 둘로만 갈라 **S 보행자가 교차로의 C 신호를 보고 건넜다.**
 *
 * 조용히 어긋나는 종류였다 — 타입은 셋 다 `CrosswalkId` 라 오류가 나지 않고, 검증기는 처음부터
 * 제 신호를 보고 있어서 "검증은 통과하는데 게임에서만 다른 일이 일어나는" 상태가 됐다.
 * 그래서 규칙을 **한 곳에 글로 적고**, 테스트가 그 글을 지키게 한다.
 */

import type { CrosswalkId, PedSignal } from '../rules/lawRules';

export interface PedSignalSources {
  /** 교차로 신호기의 지금 등화 — A · C 가 쓴다 */
  intersection: { pedA: PedSignal; pedC: PedSignal };
  /** 그 횡단보도에 **신호기가 서 있는가** (시나리오가 정한다) */
  installed: { A: boolean; C: boolean };
  /** 진입로 보호구역 신호기의 지금 등화 — 신호기가 없는 구간이면 `null` */
  zonePed: PedSignal | null;
}

/**
 * 신호기가 **없는** 횡단보도는 `null` 이다 — "적색" 이 아니라 "신호가 없다" 는 뜻이라,
 * 보행자는 신호를 기다리지 않고 건널 때를 스스로 고른다 (game/pedWalk.ts 의 obeysSignal).
 */
export function pedSignalFor(crosswalk: CrosswalkId, src: PedSignalSources): PedSignal | null {
  if (crosswalk === 'S') return src.zonePed;
  if (crosswalk === 'A') return src.installed.A ? src.intersection.pedA : null;
  return src.installed.C ? src.intersection.pedC : null;
}
