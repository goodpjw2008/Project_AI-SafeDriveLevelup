/**
 * **이번 판의 연습 갈래** — 저장본을 보고 하나로 정한다 (scenarios/tracks.ts 의 `pickTrack`).
 *
 * 셈을 여기 한 곳에 두는 까닭은 **첫 화면과 실제 판이 같아야** 하기 때문이다. 첫 화면은
 * "이번 판은 어린이보호구역입니다" 라고 미리 적어 두고, 판을 만드는 자리(main.ts)는 그 값으로
 * 후보를 거른다 — 두 곳이 따로 셈하면 적힌 것과 나오는 것이 갈린다.
 */

import type { SaveData } from '../economy/save';
import { currentTarget } from './curriculum';
import { recentTracks } from './scenarioCode';
import { pickTrack, TRACK_BRIEF, type TrackPick } from './tracks';

export interface ChosenTrack extends TrackPick {
  /** AI 가 골랐는가 — 손으로 고른 갈래면 거짓이다 */
  auto: boolean;
}

export function practiceTrack(save: SaveData): ChosenTrack {
  const choice = save.settings.track;
  // 손으로 고른 갈래는 그대로 쓴다 — 고른 사람의 뜻이 AI 의 판단보다 앞선다
  if (choice !== 'auto') return { track: choice, why: TRACK_BRIEF[choice], auto: false };
  return {
    ...pickTrack({
      level: save.curriculum.level,
      habit: currentTarget(save.curriculum),
      recent: recentTracks(save.history.map((r) => r.st)),
    }),
    auto: true,
  };
}
