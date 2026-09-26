/**
 * **연습 갈래(트랙)** — 이 교실에서 무엇을 연습할 것인가.
 *
 * 이름이 'AI 안전운전 레벨업' 이 되면서 사용자가 셋으로 나누자고 했다:
 *
 *  1. **우회전 전용** — 보호구역이 없는 교차로에서 우회전만
 *  2. **어린이보호구역 전용** — 우회전 없이 보호구역 도로를 직진으로 통과 (새 맵, 준비 중)
 *  3. **우회전 + 어린이보호구역** — 지금까지의 판 (둘이 겹친 자리)
 *
 * ## 왜 태그에서 갈라내는가
 *
 * 라이브러리는 태그 조합으로 만들어지고(library.ts), **판마다 트랙을 따로 적어 두면 두 벌이 된다** —
 * 태그를 고치는 날 한쪽만 바뀐다. 여기서는 태그만 보고 갈래를 **계산**한다. 갈래는 시나리오 번호의 앞 글자이기도 하다
 * (scenarios/scenarioCode.ts — L 우회전 전용 · M 복합). 그래서 `libraryNumber` 도,
 * 저장된 기록도 건드리지 않는다 — 트랙은 판에 새로 붙인 값이 아니라 **이미 있는 판을 보는 방법**이다.
 *
 * ## 갈래의 기준은 '보호구역을 지나는가' 하나다
 *
 * 보호구역은 두 자리에 올 수 있다 — 교차로 자체가 보호구역이거나(`zone`), 교차로로 가는 진입로에
 * 보호구역 횡단보도가 있거나(`approach`). 둘 중 하나라도 있으면 보호구역을 배우는 판이다.
 */

import type { LibraryTags } from './library';
import { levelGuide } from './library';
import type { ViolationCode } from '../rules/violations';

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
 * 셋 다 열렸다. `zone`(우회전 없는 보호구역 전용)은 사거리 없는 전용 도로 156판이 생기며 열렸다
 * (scenarios/zoneCourse.ts). 이 표를 남겨 두는 것은 **다음 편을 만드는 동안** 다시 쓰기 위해서다 —
 * 판이 없는 갈래를 버튼으로 내밀면 눌러도 아무 일이 없다.
 */
export const TRACK_READY: Record<PracticeTrack, boolean> = { turn: true, zone: true, both: true };

// ── 자동으로 고르기 ──────────────────────────────────────────────────────────

/**
 * **첫 화면에서 고르는 값** — 셋 중 하나이거나 **자동**이다.
 *
 * 사용자가 정했다: "3개 중 선택을 하게 되어 있어. 자동으로 선택이 되게 해 줘."
 * 무엇을 연습할지는 원래 **기록에 답이 있는 것**이다 — 지금 고칠 습관이 무엇이고 어느 갈래를
 * 오래 만나지 않았는지는 AI 가 이미 보고 있다. 처음 온 사람에게 셋 중 하나를 고르라고 하면
 * **무엇이 다른지 알아야 고를 수 있는** 질문을 먼저 던지는 셈이다.
 *
 * 손으로 고르는 자리는 남겨 둔다 — 한 갈래만 붙잡고 파고 싶을 때를 위한 것이고, 그것이 이
 * 고르기를 만든 까닭이다.
 */
export type TrackChoice = 'auto' | PracticeTrack;

/** 첫 화면의 단추 차례 — 자동이 앞이다 (기본값이다) */
export const TRACK_CHOICES = ['auto', ...TRACKS] as const;

export const CHOICE_LABEL: Record<TrackChoice, string> = { auto: '자동', ...TRACK_LABEL };

/**
 * **지금 고칠 습관이 어느 갈래의 것인가.**
 *
 * 보호구역 습관은 전용 도로가 한 판에 **횡단보도 셋**을 물어 되풀이가 가장 빠르고, 우회전 습관은
 * 보호구역이 섞이지 않은 판에서 그 하나만 보게 된다. 나머지(적색 일시정지 · 보행자 먼저 · 정지선 ·
 * 자전거)는 **어느 갈래에서나** 나오므로 갈래를 좁히지 않는다 — 좁혀 봤자 얻는 것이 없고 판만 줄어든다.
 */
const HABIT_TRACK: Partial<Record<ViolationCode, PracticeTrack>> = {
  SCHOOL_ZONE_NO_STOP: 'zone',
  SCHOOL_ZONE_RED: 'zone',
  STRAIGHT_RED: 'zone',
  RIGHT_ARROW_RED: 'turn',
  WIDE_TURN: 'turn',
  NO_SLOW_DOWN: 'turn',
  NO_TURN_SIGNAL: 'turn',
  BLOCKING_INTERSECTION: 'turn',
};

/**
 * **전용 도로를 이만큼 만나지 않았으면 한 번은 돌려준다.**
 *
 * 보호구역 전용 도로는 180판이고 나머지는 22,818판이다 — 그냥 두면 섞여 나오기를 기다리는 것이
 * 아니라 **영영 안 나온다.** 손으로 고를 때는 사용자가 직접 찾아갔지만, 자동은 그 자리를 대신해야 한다.
 */
export const ZONE_GAP = 5;

/** 어린이보호구역이 열리는 레벨 — 라이브러리가 정한다 (library.ts 의 levelGuide) */
const zoneOpensAt = (): number => {
  for (let l = 1; l <= 10; l++) if (levelGuide(l).includes('zone')) return l;
  return 1;
};

export interface TrackPick {
  track: PracticeTrack;
  /** 왜 이 갈래인지 — 첫 화면에 그대로 적는다. 고른 까닭을 말하지 않으면 '자동' 은 그냥 깜깜이다 */
  why: string;
}

/**
 * **이번 판의 갈래를 AI 가 고른다** (첫 화면이 '자동' 일 때).
 *
 * 무작위가 섞이지 않는다 — 첫 화면에 "이번 판은 …" 이라고 미리 적어 두고 그 판을 그대로 주기
 * 때문이다. 굴림이 들어가면 적어 둔 것과 실제로 나오는 판이 갈린다.
 */
export function pickTrack(input: {
  level: number;
  /** 지금 먼저 고칠 습관 (curriculum.ts 의 currentTarget — 위반 코드 문자열이다) */
  habit: string | null;
  /** 최근 판의 갈래 — **뒤가 최신**이다 */
  recent: readonly PracticeTrack[];
}): TrackPick {
  const { level, habit, recent } = input;

  // 보호구역이 아직 열리지 않은 레벨 — 줘 봐야 배울 차례가 아니다
  if (level < zoneOpensAt()) {
    return { track: 'turn', why: '아직 어린이보호구역을 배우기 전이라 우회전부터 봅니다' };
  }

  const last = recent.slice(-ZONE_GAP);
  if (last.length >= ZONE_GAP && !last.includes('zone')) {
    return { track: 'zone', why: `어린이보호구역 전용 도로를 ${ZONE_GAP}판째 만나지 않았습니다` };
  }

  const byHabit = habit ? HABIT_TRACK[habit as ViolationCode] : undefined;
  if (byHabit === 'zone') {
    return { track: 'zone', why: '고칠 습관이 보호구역 것이라 횡단보도 셋을 잇달아 묻습니다' };
  }
  if (byHabit === 'turn') {
    return { track: 'turn', why: '고칠 습관이 우회전 것이라 보호구역 없는 교차로만 봅니다' };
  }

  return {
    track: 'both',
    why: habit
      ? '어느 갈래에서나 나오는 습관이라 보호구역과 우회전을 섞어 봅니다'
      : '고칠 습관이 없어 보호구역과 우회전을 섞어 봅니다',
  };
}

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
