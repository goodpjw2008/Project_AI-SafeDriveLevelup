/**
 * **연습 갈래(트랙)** — 이 교실에서 무엇을 연습할 것인가.
 *
 * 이름이 'AI 안전운전 교실' 이 되면서 사용자가 셋으로 나누자고 했다:
 *
 *  1. **우회전 전용** — 보호구역이 없는 교차로에서 우회전만
 *  2. **어린이보호구역 전용** — 우회전 없이 보호구역 도로를 직진으로 통과 (새 맵, 준비 중)
 *  3. **우회전 + 어린이보호구역** — 지금까지의 판 (둘이 겹친 자리)
 *
 * ## 왜 태그에서 갈라내는가
 *
 * 라이브러리는 태그 조합으로 만들어지고(library.ts), **판마다 트랙을 따로 적어 두면 두 벌이 된다** —
 * 태그를 고치는 날 한쪽만 바뀐다. 여기서는 태그만 보고 갈래를 **계산**한다. 그래서 `libraryNumber` 도,
 * 저장된 기록도 건드리지 않는다 — 트랙은 판에 새로 붙인 값이 아니라 **이미 있는 판을 보는 방법**이다.
 *
 * ## 갈래의 기준은 '보호구역을 지나는가' 하나다
 *
 * 보호구역은 두 자리에 올 수 있다 — 교차로 자체가 보호구역이거나(`zone`), 교차로로 가는 진입로에
 * 보호구역 횡단보도가 있거나(`approach`). 둘 중 하나라도 있으면 보호구역을 배우는 판이다.
 */

import type { LibraryTags } from './library';

export const TRACKS = ['turn', 'zone', 'both'] as const;
export type PracticeTrack = (typeof TRACKS)[number];

/** 첫 화면에서 갈래를 고를 때 보이는 이름 */
export const TRACK_LABEL: Record<PracticeTrack, string> = {
  turn: '우회전',
  zone: '어린이보호구역',
  both: '우회전 + 어린이보호구역',
};

/** 그 갈래가 무엇을 시험하는지 — 이름 아래 한 줄 */
export const TRACK_BRIEF: Record<PracticeTrack, string> = {
  turn: '보호구역이 없는 교차로에서 우회전 하나만 봅니다',
  zone: '우회전 없이 보호구역 도로를 지나며 횡단보도만 봅니다',
  both: '보호구역을 지나 우회전까지 — 둘이 겹친 자리입니다',
};

/**
 * **지금 달릴 수 있는 갈래인가.**
 *
 * 셋 다 열렸다. `zone`(우회전 없는 보호구역 전용)은 사거리 없는 전용 도로 126판이 생기며 열렸다
 * (scenarios/zoneCourse.ts). 이 표를 남겨 두는 것은 **다음 편을 만드는 동안** 다시 쓰기 위해서다 —
 * 판이 없는 갈래를 버튼으로 내밀면 눌러도 아무 일이 없다.
 */
export const TRACK_READY: Record<PracticeTrack, boolean> = { turn: true, zone: true, both: true };

/**
 * **이 판은 어느 갈래인가.**
 *
 * 지금 라이브러리의 판은 전부 교차로에서 우회전한다. 그래서 여기서 나오는 값은 `turn` 아니면 `both` 다 —
 * `zone`(우회전 없는 보호구역 전용)은 **직진 통과 맵이 생기면** 그 판들이 받는다.
 */
export function trackOf(t: LibraryTags): PracticeTrack {
  const passesZone = t.zone === 'yes' || t.approach !== 'none';
  return passesZone ? 'both' : 'turn';
}

/**
 * **고른 갈래의 판인가** — 추천이 후보를 고를 때 쓰는 체(sieve).
 *
 * `both` 를 고르면 **전부**를 준다. 셋 중 하나를 고르는 것이 아니라 "보호구역까지 섞어서 연습한다" 는
 * 뜻이라, 우회전만 나오는 판을 빼면 그 갈래가 오히려 좁아진다.
 */
export function inTrack(t: LibraryTags, track: PracticeTrack): boolean {
  return track === 'both' ? true : trackOf(t) === track;
}
