/**
 * 위반 유형 · 범칙금 · 벌점 상수.
 *
 * 일반도로 금액은 도로교통법 시행령 [별표 8] "범칙행위 및 범칙금액(운전자)" 승용자동차등 기준,
 * 어린이보호구역 금액은 시행령 [별표 10] 승용자동차등 기준, 벌점은 시행규칙 [별표 28] 기준이다.
 *
 * 주의: [별표 10]은 모든 위반을 가중하지 않는다. 신호·지시 위반(제5조)과 횡단보도 보행자
 * 횡단 방해(제27조①②)만 12만원으로 올라가고, 서행의무·방향지시등·교차로 통행방법 위반 등은
 * 어린이보호구역에서도 일반도로와 같은 금액이다. 그래서 일괄 배수 대신 항목별 금액을 명시한다.
 */

import {
  CITATION_ART5,
  CITATION_ART25_1,
  CITATION_ART25_5,
  CITATION_ART27_1,
  CITATION_ART27_7,
  CITATION_ART38_1,
  CITATION_RED_LIGHT,
  CITATION_RIGHT_TURN_SIGNAL_PRIORITY,
  type LawCitation,
} from './lawCitations';

export type ViolationCode =
  /** 정면 차량신호등 적색인데 일시정지 없이 우회전 */
  | 'RED_NO_STOP'
  /** 우회전 신호등이 적색인데 우회전 진입 */
  | 'RIGHT_ARROW_RED'
  /** 보행자가 횡단 중이거나 횡단하려는데 일시정지하지 않음 */
  | 'PEDESTRIAN_BLOCKED'
  /** 어린이보호구역 신호기 없는 횡단보도 앞 무조건 일시정지 위반 */
  | 'SCHOOL_ZONE_NO_STOP'
  /** 교차로 우회전 중 서행 의무 위반 (과속 회전) */
  | 'NO_SLOW_DOWN'
  /** 우측 가장자리를 벗어난 대회전 */
  | 'WIDE_TURN'
  /** 꼬리물기 */
  | 'BLOCKING_INTERSECTION'
  /** 방향지시등 미점등 */
  | 'NO_TURN_SIGNAL'
  /** 정지선을 넘어서 정지 */
  | 'OVER_STOP_LINE'
  /** 진입부 어린이보호구역의 신호기 있는 횡단보도를 적색에 통과 */
  | 'SCHOOL_ZONE_RED'
  /** 직진으로 교차로를 통과하는데 정면 신호가 적색(또는 황색)이었다 — 어린이보호구역 연습편 */
  | 'STRAIGHT_RED';

export interface ViolationSpec {
  code: ViolationCode;
  /** 단속 명칭 (실제 통고서에 쓰이는 표현) */
  title: string;
  /** 플레이어에게 왜 위반인지 설명 */
  reason: string;
  /** 다음에 어떻게 해야 하는가 — 조문 설명만으로는 행동이 바뀌지 않는다 */
  fix: string;
  /** 일반도로 · 승용자동차 기준 범칙금(원) — 시행령 [별표 8] */
  fine: number;
  /** 벌점 — 시행규칙 [별표 28] */
  penaltyPoints: number;
  /**
   * 어린이보호구역 범칙금 — 시행령 [별표 10]. 가중 대상이 아니면 fine 과 같다.
   * **낮(오전 8시~오후 8시)에 위반한 경우에만** 적용된다 (시행령 제93조 제2항).
   */
  schoolZoneFine: number;
  /** 어린이보호구역 벌점 (가중 대상은 2배) — 시행규칙 [별표 28] (주)4, 역시 낮에만 */
  schoolZonePenaltyPoints: number;
  /** 근거 조문 */
  citations: LawCitation[];
}

export const VIOLATIONS: Record<ViolationCode, ViolationSpec> = {
  RED_NO_STOP: {
    code: 'RED_NO_STOP',
    title: '신호·지시 위반',
    reason:
      '정면 차량신호등이 적색일 때는 보행자가 있든 없든 정지선·횡단보도·교차로 직전에서 ' +
      '반드시 일시정지한 뒤에 우회전해야 합니다. 멈추지 않고 그대로 돌았습니다.',
    fix:
      '정지선 앞에서 바퀴가 완전히 멈추도록 서고, 0.5초 이상 정지한 뒤 출발하세요. 적색에서는 보행자가 없어도 마찬가지입니다.',
    fine: 60_000,
    penaltyPoints: 15,
    schoolZoneFine: 120_000,
    schoolZonePenaltyPoints: 30,
    citations: [CITATION_RED_LIGHT, CITATION_ART5],
  },
  RIGHT_ARROW_RED: {
    code: 'RIGHT_ARROW_RED',
    title: '신호·지시 위반 (우회전 신호등)',
    reason:
      '우회전 신호등이 적색이면 우회전 자체가 금지됩니다. 정면 차량신호등이 녹색이더라도 ' +
      '우회전 신호등이 설치된 곳에서는 그 등화를 따라야 합니다.',
    fix:
      '우회전 신호등이 녹색화살표로 바뀔 때까지 정지선 앞에서 기다리세요. ' +
      '정면 차량신호등이 녹색이어도 우회전 신호등이 우선입니다.',
    fine: 60_000,
    penaltyPoints: 15,
    schoolZoneFine: 120_000,
    schoolZonePenaltyPoints: 30,
    citations: [CITATION_RIGHT_TURN_SIGNAL_PRIORITY, CITATION_RED_LIGHT, CITATION_ART5],
  },
  PEDESTRIAN_BLOCKED: {
    code: 'PEDESTRIAN_BLOCKED',
    title: '횡단보도 보행자 횡단 방해',
    reason:
      '보행자가 통행 또는 통행하려 할 때에는 횡단보도 앞(정지선)에서 일시정지해야 합니다. ' +
      '보행신호와 상관없이 보행자의 통행 여부가 기준입니다.',
    fix:
      '보행자의 통행 종료 시까지 횡단보도 앞에서 정지하세요. 내 차로를 지나갔더라도 반대편 보도에 다 올라서기 전에는 통행이 끝난 것이 아닙니다.',
    fine: 60_000,
    penaltyPoints: 10,
    schoolZoneFine: 120_000,
    schoolZonePenaltyPoints: 20,
    citations: [CITATION_ART27_1],
  },
  SCHOOL_ZONE_NO_STOP: {
    code: 'SCHOOL_ZONE_NO_STOP',
    title: '어린이보호구역 횡단보도 일시정지 위반',
    reason:
      '어린이보호구역 안의 신호기 없는 횡단보도 앞에서는 보행자의 통행 여부와 관계없이 ' +
      '일시정지해야 합니다.',
    fix:
      '어린이보호구역의 신호기 없는 횡단보도 앞에서는 보행자가 보이지 않아도 일단 정지하세요. 아이는 차 뒤나 주차차량 사이에서 갑자기 나옵니다.',
    /*
      **가중 대상이 아니다.** 이 위반(제27조 제7항)은 정의상 어린이보호구역에서만 생기므로
      그 자체가 이미 어린이보호구역 규정이고, 법령도 여기에 2배를 얹지 않는다.
       · 시행령 [별표 8] 제11호 — "…어린이 보호구역에서의 일시정지 위반을 포함" · 승용 6만원
       · 시행령 [별표 10] 제2호 — 근거 법조문이 제27조 **제1항·제2항**뿐 (제7항 없음)
       · 시행규칙 [별표 28] (주)4-나 — 2배 대상에서 "법 제27조제7항은 제외한다"
      (예전에는 12만원·20점으로 두었다 — 실제의 두 배였다)
    */
    fine: 60_000,
    penaltyPoints: 10,
    schoolZoneFine: 60_000,
    schoolZonePenaltyPoints: 10,
    citations: [CITATION_ART27_7],
  },
  NO_SLOW_DOWN: {
    code: 'NO_SLOW_DOWN',
    title: '서행의무 위반',
    reason:
      '교차로에서 우회전할 때는 서행해야 합니다. 서행은 즉시 정지할 수 있는 느린 속도를 뜻하며, ' +
      '통상 시속 10~20km 이하로 봅니다.',
    fix:
      '교차로에 들어가기 전에 20km/h 아래로 줄이세요. 서행은 보행자를 보고 즉시 멈출 수 있는 속도를 뜻합니다.',
    fine: 30_000,
    penaltyPoints: 0,
    schoolZoneFine: 30_000,
    schoolZonePenaltyPoints: 0,
    citations: [CITATION_ART25_1],
  },
  WIDE_TURN: {
    code: 'WIDE_TURN',
    title: '교차로 통행방법 위반',
    reason:
      '우회전은 미리 도로의 우측 가장자리에 붙어서 해야 합니다. 바깥쪽으로 크게 돌면 ' +
      '옆 차로 차량과 충돌 위험이 있습니다.',
    fix:
      '교차로 안쪽 모서리에 붙어 2차로에서 2차로로 도세요. 부풀려 돌면 옆 차로 차량과 부딪힙니다.',
    fine: 40_000,
    penaltyPoints: 10,
    schoolZoneFine: 40_000,
    schoolZonePenaltyPoints: 10,
    citations: [CITATION_ART25_1],
  },
  BLOCKING_INTERSECTION: {
    code: 'BLOCKING_INTERSECTION',
    title: '교차로 통행방법 위반 (꼬리물기)',
    reason:
      '앞차 상황상 교차로 안에 갇힐 것이 뻔한데도 진입했습니다. 교차로 안에 정지하게 되어 ' +
      '다른 차의 통행을 방해할 우려가 있으면 진입해서는 안 됩니다.',
    fix:
      '진출로가 막혀 있으면 신호와 무관하게 정지선 앞에서 기다리세요. 교차로 안에 갇히면 교차 방향 통행을 막습니다.',
    fine: 40_000,
    penaltyPoints: 10,
    schoolZoneFine: 40_000,
    schoolZonePenaltyPoints: 10,
    citations: [CITATION_ART25_5],
  },
  NO_TURN_SIGNAL: {
    code: 'NO_TURN_SIGNAL',
    title: '방향전환 시 신호 불이행',
    reason: '교차로 가장자리에 이르기 30m 전부터 우측 방향지시등을 켜야 합니다. (Q 키)',
    fix:
      '교차로 가장자리 30m 전부터 우측 방향지시등을 켜고, 우회전을 마칠 때까지 유지하세요.',
    fine: 30_000,
    penaltyPoints: 0,
    schoolZoneFine: 30_000,
    schoolZonePenaltyPoints: 0,
    citations: [CITATION_ART38_1],
  },
  OVER_STOP_LINE: {
    code: 'OVER_STOP_LINE',
    title: '정지선 위반',
    reason:
      '정지는 정지선 앞에서 해야 합니다. 정지선을 넘어 횡단보도를 밟고 멈추면 ' +
      '보행자의 통행을 방해하게 되고, 무인 단속 카메라에도 위반으로 잡힙니다.',
    fix:
      '정지선 앞에서 멈추세요. 정지선을 조금 넘는 것까지는 봐주지만 횡단보도를 밟으면 침범입니다.',
    fine: 30_000,
    penaltyPoints: 0,
    schoolZoneFine: 30_000,
    schoolZonePenaltyPoints: 0,
    citations: [CITATION_RED_LIGHT, CITATION_ART27_1],
  },

  /*
    **진입부 어린이보호구역의 적색 통과.**

    교차로의 RED_NO_STOP 과 갈라 두는 이유는 **해야 할 일이 다르기** 때문이다.
    교차로 적색은 "서고 나서 우회전" 이지만(제27조 제7항 단서가 아니라 시행규칙
    [별표 2]), 단일 횡단보도의 적색은 **서서 기다리는 것**이다 — 서고 나서 가면 안 된다.

    한 코드로 묶으면 결과 화면의 설명이 둘 중 하나에는 반드시 틀린 말을 하게 된다.

    범칙금·벌점은 신호위반과 같고(제5조), 어린이보호구역이므로 가중된다
    (시행령 제93조 제2항 · 시행규칙 [별표 28] (주)4 — 낮에만).
  */
  SCHOOL_ZONE_RED: {
    code: 'SCHOOL_ZONE_RED',
    title: '신호·지시 위반 (어린이보호구역 횡단보도)',
    reason:
      '어린이보호구역 횡단보도의 차량신호등이 적색인데 멈추지 않고 통과했습니다. ' +
      '교차로 적색과 달리 이곳의 적색은 "일시정지 후 통행" 이 아니라 ' +
      '**녹색으로 바뀔 때까지 기다리라는 뜻**입니다.',
    fix:
      '정지선 앞에서 완전히 서고, 차량신호등이 녹색으로 바뀐 뒤에 출발하세요. ' +
      '보행자가 다 건넜더라도 적색인 동안에는 갈 수 없습니다.',
    fine: 60_000,
    penaltyPoints: 15,
    schoolZoneFine: 120_000,
    schoolZonePenaltyPoints: 30,
    citations: [CITATION_RED_LIGHT, CITATION_ART5],
  },

  /*
    **직진으로 지나는 교차로의 적색.**

    같은 적색인데도 우회전과 해야 할 일이 정반대다 — 우회전은 **서고 나서 갈 수 있지만**
    (시행규칙 [별표 2] 「적색의 등화」 제2호), 직진은 **녹색으로 바뀔 때까지 갈 수 없다**.
    RED_NO_STOP 과 한 코드로 묶으면 결과 화면이 둘 중 하나에는 반드시 틀린 말을 한다.

    **황색은 잡지 않는다** — 우회전의 황색을 잡지 않는 것과 같다. 정지선 앞 딜레마 구간에서는
    멈출 수도 지날 수도 있어서, 그 순간을 단속처럼 가르면 억울한 판정만 늘어난다.
  */
  STRAIGHT_RED: {
    code: 'STRAIGHT_RED',
    title: '신호·지시 위반 (적색 직진)',
    reason:
      '정면 차량신호등이 적색인데 교차로를 그대로 직진해 통과했습니다. ' +
      '우회전과 달리 직진은 **일시정지 후 통행이 허용되지 않습니다** — 녹색으로 바뀔 때까지 기다려야 합니다.',
    fix: '정지선 앞에서 서고, 정면 신호가 녹색으로 바뀐 뒤에 출발하세요.',
    fine: 60_000,
    penaltyPoints: 15,
    schoolZoneFine: 120_000,
    schoolZonePenaltyPoints: 30,
    citations: [CITATION_RED_LIGHT, CITATION_ART5],
  },
};

/** 판정된 위반 1건. 어느 시점·어느 위치에서 발생했는지까지 담아 리플레이 마커로 쓴다. */
export interface ViolationEvent {
  code: ViolationCode;
  /** 시나리오 시작으로부터 경과 시간(초) */
  atTime: number;
  /** 발생 위치 (탑다운 지도 마커용) */
  atPosition: { x: number; z: number 
};
  /** 발생 지점의 사람이 읽는 이름 — "어디서 걸렸는가" */
  place: string;
  /** 어린이보호구역에서 발생했는가 */
  inSchoolZone: boolean;
  /**
   * 낮(오전 8시~오후 8시)에 발생했는가.
   *
   * 어린이보호구역 가중은 **이 시간대에 한정**된다 — 시행령 제93조 제2항, 시행규칙
   * [별표 28] (주)4. 밤에는 같은 위반이라도 일반도로와 같은 금액·벌점이다.
   */
  daytime: boolean;
}

/** 어린이보호구역 가중이 붙는 조건 — 구역 안 + 낮(08~20시) */
const aggravated = (event: ViolationEvent): boolean => event.inSchoolZone && event.daytime;

export function fineOf(event: ViolationEvent): number {
  const spec = VIOLATIONS[event.code];
  return aggravated(event) ? spec.schoolZoneFine : spec.fine;
}

export function penaltyPointsOf(event: ViolationEvent): number {
  const spec = VIOLATIONS[event.code];
  return aggravated(event) ? spec.schoolZonePenaltyPoints : spec.penaltyPoints;
}

export function totalFine(events: ViolationEvent[]): number {
  return events.reduce((sum, e) => sum + fineOf(e), 0);
}

export function totalPenaltyPoints(events: ViolationEvent[]): number {
  return events.reduce((sum, e) => sum + penaltyPointsOf(e), 0);
}
