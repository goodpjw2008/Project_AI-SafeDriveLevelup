/**
 * **시연용 마스터 상태** — 주소 `?demo=master` 로 열면 이 브라우저의 저장본을 마스터로 바꾼다 (main.ts 가 부른다).
 *
 * 사용자가 정했다 (2026-11-15): 발표자료 '시연 포함' 판은 오른쪽 휴대폰 틀 안에서 이 사이트를 띄우고, 발표하면서
 * '마스터 운행' 을 누른다. 그런데 다른 페이지 안(iframe)에서 열린 사이트에는 브라우저가 저장 공간을 따로 두어
 * (제3자 저장소 분리) 평소의 기록이 보이지 않고 Level 1 로 열린다. 이 주소가 그 저장 공간을 마스터 상태로 채운다.
 *
 * 저장본은 그 기기 · 그 화면에만 있고 서버로 가지 않는다 — 누가 써도 남의 기록에는 닿지 않는다.
 * 값은 발표자료의 장표 그림을 찍을 때 쓴 마스터 상태와 같다: 레벨 10 · 마스터 · 맨 위 차 · 뱃지.
 */
import { carForLevel } from './cars';
import { KEEP_IDS, SITUATIONS, type OnceBadgeId } from './badges';
import type { SaveData } from './save';

/** 한 번 얻으면 남는 뱃지 — 마스터가 되기까지 모두 얻는다 */
const ONCE: readonly OnceBadgeId[] = ['firstClean', 'schoolZoneFirst', 'leadJudge', 'master'];

export function demoMaster(save: SaveData): SaveData {
  const top = carForLevel(10);
  return {
    ...save,
    activeCarId: top?.id ?? save.activeCarId,
    curriculum: {
      ...save.curriculum,
      level: 10,
      bestLevel: 10,
      mastered: true,
      xp: 0,
      badHabits: [],
      cleanStreak: Math.max(save.curriculum.cleanStreak, 20),
      missStreak: 0,
    },
    badges: {
      ...save.badges,
      keep: Object.fromEntries(KEEP_IDS.map((k) => [k, 20])) as SaveData['badges']['keep'],
      keepBest: Object.fromEntries(KEEP_IDS.map((k) => [k, 1])) as SaveData['badges']['keepBest'],
      streak: 20,
      bestStreak: 20,
      fixed: 3,
      seen: SITUATIONS.map((s) => s.key),
      earned: [...ONCE],
    },
  };
}
