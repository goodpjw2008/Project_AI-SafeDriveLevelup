/**
 * **다음 판의 계획** — AI 가 다음 판을 고르기 전에 정하는 것들 (scenarios/generate.ts 의 Plan).
 *
 * 게임(main.ts 의 makeAiScenario)과 추천 신경망의 학습(scripts/train-recommend.ts)이 **같은 함수**를 부른다.
 * 학습은 가상 운전자에게 이 계획대로 판을 골라 주며 배우므로, 두 곳이 따로 셈하면 신경망이 게임에서 만나지
 * 않는 계획으로 배우게 된다. 차례(보호구역 · 앞차 · 신호기)는 `Math.random` 으로 굴린다 — 학습은 씨앗을 고정한
 * 난수로 갈아 끼워 재현한다.
 */

import type { Challenge } from './challenge';
import { challengeRule } from './challenge';
import { currentTarget, xpToNext, type CurriculumState } from './curriculum';
import type { Plan } from './generate';
import { noSignalZoneDue } from './recommend';
import { rollLeadTurn, rollSchoolZoneTurn, rollZoneNoSignalTurn } from './scenarios';
import { practiceTrack } from './trackPick';
import type { TrackChoice } from './tracks';
import { abilityPriorFor } from '../ai/difficulty';

/** 계획을 세우는 데 읽는 것 — 저장본(economy/save.ts)의 일부. 가상 운전자도 이 모양만 갖추면 된다 */
export interface PlanSource {
  curriculum: CurriculumState;
  /** 실제로 탄 판 (오래된 것부터) — 판 번호만 읽는다 */
  history: ReadonlyArray<{ st: number }>;
  settings: { track: TrackChoice; difficulty: Challenge };
}

export function nextPlan(save: PlanSource): Plan {
  const c = save.curriculum;
  const zoneTurn = rollSchoolZoneTurn();
  /*
    **신호기 없는 보호구역이 몇 판째 없었으면 이번 판은 반드시 그 판이다** (recommend.ts 의 `noSignalZoneDue`).
    사용자가 "10판 넘게 했는데 한번도 나오지 않았어" 라고 짚었다 — 차례 확률과 고칠 습관 때문에 연달아 빠질 수 있었다.
  */
  const noSignalDue = noSignalZoneDue(save.history.map((r) => r.st));
  /*
    **무엇을 연습하는 갈래인가** (scenarios/tracks.ts) — 기본은 **자동**이고, AI 가 고칠 습관과 기록을
    보고 고른다. 우회전 전용이면 보호구역 차례를 아예 굴리지 않는다: 그 갈래에는 보호구역 판이 없어,
    차례만 서고 판은 안 나오면 "보호구역 차례인데 우회전 판" 이라는 어긋난 설명이 화면에 뜬다.
  */
  const track = practiceTrack(save).track;
  const zoneDueHere = noSignalDue && track !== 'turn';
  const rule = challengeRule(save.settings.difficulty);
  return {
    level: c.level,
    track,
    target: currentTarget(c),
    badHabits: c.badHabits,
    /*
      **보호구역은 네 판에 한 판이다** (scenarios.ts 의 `SCHOOL_ZONE_CHANCE`).

      AI 에게 고르기를 맡기기 **전에** 굴린다 — 비율은 여러 판에 걸쳐 나타나는 성질이라
      판 하나를 고르는 모델이 맞출 수 있는 것이 아니다.
    */
    schoolZone: track === 'turn' ? false : zoneTurn || zoneDueHere,
    /*
      **보호구역이 나올 차례면 신호기 유무도 여기서 굴린다** (scenarios.ts 의 `ZONE_NO_SIGNAL_CHANCE`).

      이 게임의 핵심은 제27조 제7항 — 신호기 없는 보호구역 횡단보도는 사람이 없어도 선다 — 인데,
      고르는 쪽이 보호구역을 불리언 하나로만 보아 절반이 신호 있는 판이었다 (사용자가 짚었다).

      **차례가 아닐 때도 굴린다.** 새 개념을 여는 레벨과 종합 레벨에서는 보호구역 차례가 아니어도
      보호구역 판이 섞여 들어오기 때문이다 (recommend.ts 의 `zoneOk` 예외).
    */
    zoneNoSignal: track === 'turn' ? undefined : zoneDueHere || rollZoneNoSignalTurn(),
    noSignalZoneDue: zoneDueHere,
    /* **앞차 차례도 여기서 굴린다** (scenarios.ts 의 `rollLeadTurn`) — 보호구역과 같은 이유다 */
    lead: rollLeadTurn(),
    /* 설정의 난이도 1~5 — 같은 레벨 안에서 얼마나 복잡한 코스를 고를지 (scenarios/challenge.ts) */
    challenge: save.settings.difficulty,
    // 필요한 양이 나중에 줄면(곡선 · 난이도를 바꿨을 때) 저장된 값이 넘친다 — AI 에게도 잘라서 준다 (ui/playerCard.ts)
    xp: Math.min(c.xp ?? 0, xpToNext(c.level, rule)),
    xpNeed: xpToNext(c.level, rule),
    cleanStreak: c.cleanStreak,
    missStreak: c.missStreak,
    // 학습자 모델 · 능력 (ai/knowledge.ts · ai/difficulty.ts) — 후보 점수와 AI 프롬프트가 읽는다
    skills: c.skills ?? {},
    ability: c.ability ?? abilityPriorFor(c.level),
    outcomeBias: c.outcomeBias,
  };
}
