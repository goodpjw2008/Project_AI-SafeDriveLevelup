/**
 * 보행자의 **상태기계만** 떼어 낸 것 — 메시도 three 도 없다.
 *
 * ## 왜 떼어 냈는가
 *
 * 이 로직은 두 곳에서 돌아야 한다.
 *
 *  - **게임** (Pedestrian.ts) — 이 상태를 몸에 붙여 화면에 그린다
 *  - **시나리오 검증기** (scenarios/validate.ts) — 3D 없이 판을 돌려 보고,
 *    "규정대로 몰면 통과하는가 · 대충 몰면 걸리는가" 를 확인한다
 *
 * 두 곳이 각자 구현하면 **어긋나는 순간 검증이 거짓말이 된다.** 검증기가 "이 시나리오는
 * 통과 가능합니다" 라고 했는데 실제로는 불가능한 판이 사용자에게 가는 것이 최악인데,
 * 그 최악은 조용히 일어난다 — 아무도 두 구현을 나란히 놓고 비교하지 않기 때문이다.
 *
 * 그래서 **한 벌만 둔다.** 화면에 그리는 쪽이 이 값을 읽어 쓰고, 검증하는 쪽도 같은 값을 읽는다.
 *
 * ## 판정 엔진이 쓰는 두 값
 *
 *  - `intendsToCross` — **보행자가 통행 또는 통행하려 할 때** (제27조 제1항)
 *  - `onConflictPath` — 아직 **통행이 종료되지 않은** 상태 (차도 위에 있다)
 */

import {
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_S_OUTER,
  PLAYER_EXIT_Z,
  ROAD_HALF_WIDTH,
} from '../layout';
import type { CrosswalkId, PedSignal } from '../rules/lawRules';
import type { PedSpawn } from '../scenarios/scenarios';

/** 보도 끝 — 차도 가장자리에서 1.4m 안쪽이 사람이 서는 자리다 */
export const CURB = ROAD_HALF_WIDTH + 1.4;

/**
 * 걸음 속도 배율.
 *
 * 실측 보행속도(어른 1.2 m/s)는 **현실에는 맞지만 이 게임에는 길다** — 규정대로 멈춘
 * 운전자가 화면 앞에서 십수 초를 서 있으면, 기다리는 것을 배우는 게임이 인내심 시험이 된다.
 *
 * 이 게임이 가르치는 것은 "얼마나 오래 기다리는가" 가 아니라 **"다 건널 때까지 기다린다"** 다.
 *
 * ## 2.1 → 3.0
 *
 * 2.1배(2.52 m/s)로도 **걷는 모습이 느려 보였다** (사용자가 "횡단보도 건너는 속도가 너무 느리다" 고 짚었다).
 * 사람을 실제 키의 2.0배로 그리기 때문이다(Pedestrian.ts 의 `SIZE_SCALE`) — 3.4m 짜리 몸이 2.52 m/s 로
 * 가면 **제 키로 환산해 초당 0.74키**라, 보는 눈에는 실제 사람이 1.26 m/s 로 걷는 것과 같다. 크게 그린
 * 만큼 빠르게 가야 같은 걸음으로 보인다.
 *
 * 3.0배(어른 3.6 m/s)면 차도 19.6m 를 5.4초에 건넌다 — 기다리는 시간이 판마다 3~4초다.
 * 다리를 흔드는 박자는 이 속도를 그대로 따라가므로(Pedestrian.update) 미끄러지듯 가지 않는다.
 *
 * **더 올리지 않는 이유**: 판마다 "보행자를 보지 않는 운전자" 를 달리게 해서 그 사람이 실제로 막히는지
 * 검사하는데(tests/libraryShard.ts 의 '보행자 역할 없음'), 너무 빠르면 차가 닿기 전에 다 건너 버려
 * **판의 보행자가 아무 역할도 하지 않게 된다.**
 */
export const WALK_SPEED_SCALE = 3.0;

/** 타고 건너는 자전거의 기준 속도 (m/s) — 어른 걸음(1.2)의 약 1.7배 (위 배율이 함께 걸린다) */
const BIKE_RIDE_SPEED = 2.0;

/**
 * **라이브러리가 맞춰져 있던 걸음 배율.**
 *
 * 판마다 보행자가 나서는 때(`at` · `startWithin`)는 모두 2.1배에서 **"내가 닿을 때 아직 건너고 있게"**
 * 맞춰 둔 값이다 (scenarios/library.ts 의 주석이 그 조정 과정을 그대로 적고 있다). 걸음만 빠르게 하면 그
 * 조정이 통째로 어긋난다 — 실제로 배율만 3.0 으로 올렸더니 **406개 판에서 보행자가 내가 닿기 전에 다 건너**
 * 아무 역할도 하지 않았다 (tests/libraryShard.ts 의 '보행자 역할 없음'). 이 값은 아래 `CURB_HOLD_SHARE`
 * 가 "얼마나 빨라졌는지" 를 재는 기준이다.
 */
const TRIGGER_TUNED_AT = 2.1;

/**
 * **빨라진 만큼 연석에서 더 기다렸다 나선다** — 줄어든 횡단 시간의 이 비율만큼.
 *
 * 판의 보행자가 제 역할을 하는지는 **"내가 그 횡단보도를 지나는 순간 이 사람이 아직 양보 대상인가"** 로
 * 갈린다. 그리고 양보 대상인 구간은 발을 뗀 뒤가 아니라 **연석에서 건너려고 서 있을 때부터** 다
 * (제27조 제1항의 "통행하려고 하는 때" — `sample()` 의 `intendsToCross` · `onConflictPath`).
 *
 * 그래서 걸음을 빠르게 하면서 **나서는 때를 그만큼 늦추면, 다 건너는 시각이 그대로**라 6천여 판의 장면이
 * 하나도 어긋나지 않는다. 사람은 연석에서 조금 더 기다렸다가 **성큼성큼 건넌다** — 기다리는 모습도
 * 건너는 모습도 실제 보행자에 가깝다.
 *
 * `1` 이면 다 건너는 시각이 정확히 예전과 같고, `0` 이면 나서는 때가 예전과 같은 대신 판마다 일찍 끝난다.
 * 그 사이에서 **판이 깨지지 않는 가장 작은 값**을 골랐다 — 운전자가 기다리는 시간도 그만큼 줄어든다
 * (배율을 내리며 실제로 재 본 값이다).
 */
const CURB_HOLD_SHARE = 1;

/**
 * 보행신호를 지키는 사람이 연석에서 더 기다리는 시간의 **상한** (초) — 아래 `holdFor`.
 *
 * 6천 판을 다 달려 보며 잰 값이다. 상한을 바꾸면 '보행자 역할 없음' 이 이렇게 움직였다:
 * **0.5초 → 94판 · 0.8 → 94 · 1.0 → 0 · 1.1 → 0 · 1.2 → 0 · 1.5 → 36 · 2.5 → 18 · 상한 없음 → 50.**
 * 너무 짧으면 빨라진 걸음을 못 따라잡고, 너무 길면 녹색을 놓친다. 1.0~1.2 의 가운데를 잡았다.
 *
 * 창이 좁으니 **숫자를 손으로 고치지 말고** 라이브러리 검증(tests/library.validate.*)을 다시 돌려야 한다 —
 * 그 테스트가 이 값을 지키는 울타리다.
 */
export const SIGNAL_HOLD_CAP = 1.1;

/**
 * **차가 이 거리 안까지 다가오면 기다림을 끝내고 나선다** (m) — 서 있든 달려오든.
 *
 * 연석 대기는 '내가 닿을 때 아직 건너고 있게' 하려는 것이지, **내가 다 온 뒤에 나서게** 하려는 것이 아니다.
 * 실제로 재 보니 두 번째 횡단보도의 사람이 **내 차 앞 1.7~2.6m** 에서 발을 떼고 있었다 — 그때 내 속도는
 * 1~6km/h 라, 운전자 눈에는 "서 있던 사람이 갑자기 나온" 것이 된다 (사용자: "너무 늦게 출발해서 운전자가
 * 예측할 수가 없어").
 *
 * 이 거리 안이면 **어차피 내가 닿기 전에 다 건널 수 없으므로**(건너는 데 6.3초) 기다림은 아무것도 지키지
 * 않는다. 멀리 신호 앞에 서 있는 판에서는 이 조건이 걸리지 않아 기다림이 그대로 산다.
 *
 * 12m 인 까닭은 재 봤기 때문이다 — **12m 면 6천 판이 모두 성립하고, 16m 부터 6개 판이 보행자를 잃는다.**
 *
 * 한때 8m 로 두었다. 그보다 넓히면 112개 판이 깨졌는데, 깨진 판을 들여다보니 **전부 앞차 뒤에서 뛰어드는
 * 사람**이었다 — 그쪽은 갑자기 나오는 것이 판의 요점이라 미리 나서면 장면이 사라진다. 그 사람들만 빼자
 * 12m 까지 넓어졌고, 두 번째 횡단보도의 발뗌 거리가 **중앙값 1.8m → 9.4m**, 그때 내 속도가
 * **1~6 → 11~14km/h** 로 바뀌었다 — 서 있는 차 앞에서 나오는 것이 아니라, 다가오는 차 앞에서 먼저 나선다.
 */
export const STEP_OFF_LATEST = 12;

/** 다 건너기까지 가는 거리 (m) — 반대편 연석을 0.4m 넘어서면 통행이 끝난다 (update 끝) */
const CROSS_DISTANCE = 2 * CURB + 0.4;

/**
 * 기준 걸음 `base` (m/s) 인 사람이 **연석에서 더 기다리는 시간** (초) — 위 `CURB_HOLD_SHARE`.
 *
 * 밖으로 내보내는 이유: 나서는 때를 보는 테스트가 "2.7초" 같은 숫자를 적어 두면, 배율을 다시 만질 때
 * 조용히 어긋난다. 값이 아니라 **같은 식**을 보게 한다.
 */
export function curbHoldSeconds(base = 1.2): number {
  const slow = CROSS_DISTANCE / (base * TRIGGER_TUNED_AT);
  const fast = CROSS_DISTANCE / (base * WALK_SPEED_SCALE);
  return Math.max(0, slow - fast) * CURB_HOLD_SHARE;
}

/**
 * 등장 시각 **이만큼 전부터** '건너려는 사람'으로 본다 (초).
 *
 * ## 왜 필요한가
 *
 * 예전에는 등장 시각에 뜻과 발이 **같은 프레임에** 움직였다. 시각으로 나서는 사람
 * (03번의 11.0초·13.5초)은 그 순간까지 아무 의사도 없다가 갑자기 차도로 걸어 나온다.
 * 다가오던 배경 차 입장에서는 예고가 0 이라 — 12m/s 면 편안히 서는 데 40m 가 필요한데 —
 * 그때부터 줄이기 시작한다. 화면에서는 **차와 사람이 동시에 애매해지는** 장면이 된다.
 *
 * 거리로 나서는 사람(`startWithin`)은 원래 이 문제가 없었다. 그쪽은 등장 시각이 0 이라
 * 판이 시작될 때부터 뜻이 서 있고 발만 나중에 떼기 때문이다. **시각 방아쇠도 같게 만든다.**
 *
 * ## 법으로도 이쪽이 맞다
 *
 * 제27조 제1항은 "통행하고 있거나 **통행하려고 하는 때**" 다. 연석 앞에서 건너려고
 * 기다리는 사람은 발을 떼기 전에도 양보 대상이다 — 발을 뗀 뒤에야 대상이 된다면
 * 그 조문의 뒤 절반은 아무 일도 하지 않는다.
 *
 * 화면에서도 이 시간 동안 **연석까지 걸어 나와 선다** (Pedestrian.ts 의 `WAIT_SETBACK`).
 * 뜻만 켜 두고 몸이 가만히 있으면 배경 차가 왜 서는지 알 길이 없다.
 *
 * ## 2초에서 4초로 늘렸다
 *
 * 이 예고가 곧 AI 의 "보행자가 건너려는 것 같아요" 와 머리 위 느낌표가 켜지는
 * 때다(둘 다 이 값을 본다). 2초였을 때는 알림이 뜨고 2초 만에 사람이 차도로 나와 **반응할
 * 시간이 모자랐다** — 알아보고, 판단하고, 제동하는 데 2초는 빠듯하다. 4초면 서행(12km/h)으로
 * 13m 를 가는 동안 알아차릴 수 있다. 발을 떼는 시각(`at`)은 그대로라 판의 장면은 같다.
 */
export const INTENT_LEAD = 4.0;

/**
 * **앞차 뒤로 나서는 사람**(PedSpawn.afterLead)이 앞차가 지나간 뒤 나서기로 정하기까지 (초) — **0, 곧바로다.**
 *
 * 앞차가 지나가자마자 **빨간 느낌표를 띄우고 반 박자(`RED_BEAT`) 뒤에 발을 뗀다.** 뒤따르는 운전자는 그 빨강을
 * 보고 선다 — 앞차 뒤에 4초 간격으로 따라오므로 그때 13m 쯤 뒤에 있고, 서행(14km/h)으로 편안히 서는 데 5m 남짓이면
 * 된다.
 *
 * ## 2초였고, 한동안은 4초였다
 *
 * 처음에는 2초를 두어 "노랑 0.5초 → 빨강 1.5초 → 발을 뗀다" 로 했다. 그런데 걸음을 빠르게 하며 연석 대기를
 * 얹자(위 `CURB_HOLD_SHARE`) 이 사람에게도 2.2초가 더 붙어, 앞차가 지나간 뒤 **노란 느낌표만 4.1초** 떠 있다가
 * 내가 1.8m 앞에 와서야 빨강이 떴다. 노랑을 "서라" 로 읽지 않은 운전자는 그대로 들어가 위반이 됐다 — 사용자가
 * 57번에서 짚었다: "보행자가 앞차가 지나가자마자 즉시 보행 의사를 바로 붉은색으로 밝히고 진입해야 운전자가
 * 인지하고 멈출 것 같아."
 *
 * 이 사람은 **앞차가 가린 자리에서 뛰어드는 장면**이 요점이라 뜸을 들일 까닭이 없다. 연석 대기도 받지 않는다
 * (아래 `holdFor`). 내가 설 수 없는 거리면 애초에 나서지 않는다는 안전장치는 그대로다 (`AFTER_LEAD_*`).
 */
export const AFTER_LEAD_DELAY = 0;

/**
 * 앞차 뒤로 나서는 사람은 **내가 설 수 있는 거리일 때만** 나선다 — 반응 시간(초) · 제동 감속도(m/s²) · 여유(m).
 *
 * 앞차 뒤에 6m 로 붙어 오던 차 앞으로 사람이 나서면, 규정대로 모는 사람도 피할 수 없다. 그것은 가르치는 것이
 * 아니라 함정이다. 반응 1초에 가장 무른 브레이크(난이도 5, challenge.ts)로 서는 거리 + 1m 보다 멀 때만 나서고,
 * 그보다 가까우면 나를 보내고 건넌다. **서 있는 차 앞으로는 언제든 나선다** — 앞차 뒤에 줄 서 있던 내가 앞차를
 * 따라 출발하려는 순간이 바로 이 장면이다.
 */
export const AFTER_LEAD_REACTION = 1.0;
export const AFTER_LEAD_BRAKE = 3.4;
export const AFTER_LEAD_MARGIN = 1.0;

/** 걸음 한 스텝에 함께 넘기는 주변 — 앞차 뒤로 나서는 사람(PedSpawn.afterLead)만 쓴다 */
export interface PedWalkContext {
  /** 앞차가 아직 이 횡단보도를 **다 지나지 않았는가** (LeadDrive.inWayOf) */
  leadInWay?: boolean;
  /** 내 차 속도 (m/s) — 설 수 있는 거리인지 잰다 */
  carSpeedMs?: number;
  /**
   * 설 수 있는 거리를 셀 때 쓰는 **가장 무른 브레이크** (m/s²). 비우면 마른 길의 값(AFTER_LEAD_BRAKE)이다.
   * 빗길은 브레이크가 0.7 배라(scenarios/conditions.ts 의 afterLeadBrake) 같은 거리에서 나서면 마른 길에서 설 수 있던
   * 사람이 서지 못한다 — 빗길 · 앞차 뒤 뛰어드는 사람 판 76개에서 1초 늦게 보는 운전자가 걸렸다 (전수 검증이 잡았다).
   */
  brakeDecel?: number;
}

export type PedState = 'waiting' | 'crossing' | 'done';

/**
 * **건널 뜻이 확실하다**(`ready`) 로 보기 시작하는 때 — 등장 시각 이만큼 전 (초).
 *
 * 한때는 화면의 빨간 느낌표가 이 값을 봤다. 지금 빨강은 `RED_BEAT` 이 맡고, 이 값은 **양보한 차 앞에서
 * 건너게 하는 판단**(`yieldedTo`)에만 쓴다 — 거기서는 넉넉해야 한다. 좁히면 방아쇠보다 일찍 선 차 앞에서
 * 사람이 영영 안 건너는 옛 버그가 되살아난다. 판정은 이 값을 쓰지 않는다 (기준은 `intendsToCross` 하나다).
 */
export const IMMINENT_LEAD = 1.5;

/**
 * **빨간 느낌표를 띄우고 발을 떼기까지의 박자** (초).
 *
 * 빨강은 점(占)이 아니라 **동작의 첫 박**이다 — 띄우는 순간 이미 나서기로 정해져 있고, 이만큼 뒤에 발이
 * 나간다. 0.5초면 운전자 눈에 "어, 나온다" 가 한 번 읽히고 곧바로 움직임이 이어진다. 더 길게 잡으면
 * 예전처럼 "빨강인데 안 나오는" 시간이 생기고, 0 으로 두면 느낌표가 한 프레임도 안 보인다.
 *
 * 이 박자만큼 연석 대기(`CURB_HOLD_SHARE`)에서 미리 빼므로 **다 건너는 시각은 달라지지 않는다.**
 */
export const RED_BEAT = 0.5;

/**
 * 거리로 나서는 사람(`startWithin`)이 **건널 뜻이 확실하다**(`ready`) 로 보이기 시작하는 여유 (m).
 * 서행(12km/h)이면 1.8초쯤 먼저다 — 시각으로 나서는 사람의 `IMMINENT_LEAD` 와 비슷하게 맞춘다.
 */
export const IMMINENT_DISTANCE = 6;

/** 상태기계가 밖으로 내보내는 것 — 화면도 검증기도 이것만 본다 */
export interface PedWalkSample {
  crosswalk: CrosswalkId;
  /** 자전거를 가진 사람인가 (PedSpawn.bike) — 판정이 보행자와 자전거를 가려 적는다 */
  bike?: 'ride' | 'push';
  intendsToCross: boolean;
  onConflictPath: boolean;
  /** 등장 시각이 지나 '상황에 참여한' 뒤인가 (결과 지도가 발자국을 그릴 구간) */
  active: boolean;
  /**
   * 건너려는 사람이 **곧 발을 뗀다** (IMMINENT_LEAD · IMMINENT_DISTANCE). 화면 표시 전용이다 —
   * 빨간 느낌표를 차도에 들어서기 조금 전부터 켜는 데 쓴다. 판정은 보지 않는다.
   */
  imminent: boolean;
  state: PedState;
  signal: PedSignal | null;
  /** 횡단보도를 가로지르는 축 위의 위치 (m). 부호는 진행 방향 기준 */
  axis: number;
}

/** 차 앞범퍼 위치 — 거리 방아쇠와 '이미 진입한 차' 판단에 쓴다 */
export interface CarFront {
  x: number;
  z: number;
}

/**
 * 보행자 한 명의 상태기계.
 *
 * `update()` 를 매 스텝 부르고 `sample()` 로 읽는다. 화면에 그리는 쪽은 `axis` 를 받아
 * 좌표로 옮기고, 검증하는 쪽은 판정 표본만 쓴다.
 */
export class PedWalk {
  readonly crosswalk: CrosswalkId;
  /** 자전거를 가진 사람인가 — 타고 건너면 `ride`, 끌고 건너면 `push` (PedSpawn.bike) */
  readonly bike?: 'ride' | 'push';
  readonly dir: 1 | -1;
  readonly speed: number;

  private state: PedState = 'waiting';
  /**
   * 등장 시각이 지났는가.
   *
   * **화면에 보이는 것과 다른 개념이다.** 보행자는 처음부터 보도에 서 있어(멀리서도 알아볼
   * 수 있어야 한다) 보이는지로는 "이제 건널 사람인가" 를 가릴 수 없다.
   */
  private arrived = false;
  /**
   * 건너려는 뜻이 드러났는가 — 등장 시각 `INTENT_LEAD` 초 전부터 참이다.
   *
   * `arrived`(발을 뗄 수 있는가)와 갈라 둔다. 뜻이 먼저고 발이 나중이라, 하나로 묶으면
   * 예고 없이 차도로 걸어 나오는 예전 동작으로 돌아간다.
   */
  private intending = false;
  private axisPos: number;
  private spawnAt: number;
  /** 플레이어가 이만큼(m) 앞까지 다가와야 나선다. null 이면 시각만 본다 */
  private startWithin: number | null;
  /** 나설 조건이 다 풀린 뒤 연석에서 더 기다리는 시간 (초) — 위 CURB_HOLD_SHARE */
  private readonly curbHold: number;
  /** 그 기다림이 끝나는 시각 (null 이면 아직 조건이 안 풀렸다) */
  private stepOffAt: number | null = null;
  /** 건널 뜻이 확실한가 — 일찍 선 차 앞에서도 건너게 하는 값 (화면의 빨간 느낌표와는 다르다) */
  private ready = false;
  /** 빨강을 띄운 뒤 실제로 발을 떼는 시각 (null 이면 아직 못 나선다) */
  private goAt: number | null = null;
  private obeysSignal: boolean;
  /** 마지막으로 본 보행신호 — '지금 건널 수 있는 사람인가' 를 표본에 담기 위해 기억한다 */
  private lastSignal: PedSignal | null = null;
  /** 곧 발을 뗄 사람인가 — update 가 매 스텝 정한다 (IMMINENT_LEAD) */
  private imminent = false;
  /** 건너려는 뜻을 한 번이라도 드러냈는가 — 드러낸 뒤에는 차가 다가와도 거두지 않는다 (update 의 '설 수 없는 차' 규칙) */
  private shownIntent = false;
  /** 내 차가 지나갈 때까지 기다리는 사람인가 (PedSpawn.letsCarPass) */
  private readonly letsCarPass: boolean;
  /** 앞차 뒤로 나서는 사람인가 (PedSpawn.afterLead) */
  private readonly afterLead: boolean;
  /** 앞차 뒤로 나서는 사람이 **나설 차례가 됐는가** — 앞차가 지나갔고 내가 설 수 있는 거리였다 */
  private released: boolean;

  constructor(spawn: PedSpawn) {
    this.crosswalk = spawn.crosswalk;
    this.bike = spawn.bike;
    this.dir = spawn.from === 'left' ? 1 : -1;
    this.axisPos = this.dir === 1 ? -CURB : CURB;
    this.spawnAt = spawn.at;
    this.startWithin = spawn.startWithin ?? null;
    this.obeysSignal = spawn.obeysSignal ?? true;
    this.afterLead = spawn.afterLead ?? false;
    this.letsCarPass = spawn.letsCarPass ?? false;
    this.released = !this.afterLead;

    const kind = spawn.kind ?? 'adult';
    // 시나리오가 속도를 지정한 경우에도 배율은 함께 적용한다 —
    // 한 화면에 선 사람들의 걸음이 서로 다른 기준으로 움직이면 어색하다.
    /*
      **타고 건너는 자전거는 걸음보다 빠르다** — 실측으로는 15km/h 쯤이라 어른 걸음의 3.5배지만,
      여기서는 **1.7배**로 둔다. 실제 비율로 두었더니 22.8m 를 2.4초에 건너, 내가 닿기 한참 전에
      다 지나가 버렸다 — 보행자를 아예 보지 않는 운전자조차 걸리지 않는 **아무 일도 일어나지 않는
      판**이 됐다 (전수 검증이 잡았다). 1.7배면 3.7초가 걸려, 내가 닿을 때 아직 건너는 중이다.
      그래도 걸음보다 확실히 빨라 "저 자전거는 아직 멀었다" 가 통하지 않는다.

      끌고 가는 사람(`push`)은 보행자이므로 걸음 그대로다 (제2조 제17호).
    */
    /*
      **탄 자전거의 속도는 나이를 따르지 않는다.** 걸음은 아이가 빠르고 노인이 느리지만, 페달을 밟는
      속도는 그렇게 갈리지 않는다 — 나이를 곱했더니 **아이가 어른보다 빨라져** 아이 자전거 판만
      내가 닿기 전에 다 건너 버렸다 (전수 검증이 잡았다). 어른 걸음의 약 1.7배로 고정한다.
    */
    const rides = spawn.bike === 'ride';
    const walk = kind === 'child' ? 1.35 : kind === 'elder' ? 0.85 : 1.2;
    const base = spawn.speed ?? (rides ? BIKE_RIDE_SPEED : walk);
    this.speed = base * WALK_SPEED_SCALE;
    // 빨라져서 줄어든 시간만큼 연석에서 더 기다린다 (위 CURB_HOLD_SHARE) — 사람마다 제 걸음으로 잰다
    // 박자(RED_BEAT)는 대기의 끝에 붙으므로 미리 빼 둔다 — 다 건너는 시각이 그대로다
    this.curbHold = Math.max(0, curbHoldSeconds(base) - RED_BEAT);
  }

  /** 지금 축 위치 — 화면 쪽이 좌표로 옮길 때 쓴다 */
  get axis(): number {
    return this.axisPos;
  }

  get done(): boolean {
    return this.state === 'done';
  }

  /**
   * 한 스텝 진행한다.
   *
   * `trafficBusy` — 내 횡단보도를 **코앞에 두고 달려오는 NPC 차**가 있는가. 있으면 한 발
   * 기다렸다 건넌다. 실제 보행자도 코앞의 차는 보내고 건너고, 무엇보다 이 게임은
   * "사람이 있으면 선다" 를 가르치는 화면이라 배경 차가 사람 사이로 지나가는 그림이
   * 나오면 안 된다 — 그 차는 이미 설 수 없는 거리에 있다.
   */
  update(
    t: number,
    dt: number,
    signal: PedSignal | null,
    carFront: CarFront,
    carMoving: boolean,
    trafficBusy = false,
    ctx: PedWalkContext = {},
  ): void {
    if (this.state === 'done') return;
    this.lastSignal = signal;

    // 내 차를 보내는 사람 (PedSpawn.letsCarPass) — 내 차가 이 횡단보도를 지나기 전에는 뜻도 발도 없다
    if (this.state === 'waiting' && this.letsCarPass && !this.carHasPassed(carFront)) {
      this.intending = false;
      this.imminent = false;
      return;
    }

    if (this.state === 'waiting' && !this.released) {
      /*
        **앞차 뒤로 나서는 사람** (PedSpawn.afterLead) — 앞차가 지나가기 전에는 건너려는 뜻도 보이지 않는다.
        뜻을 보이면 앞차가 서서 보내 주고, 그러면 뒤따르는 나는 이 사람과 만날 일이 없다.
      */
      this.intending = false;
      this.imminent = false;
      if (ctx.leadInWay) return;
      const d = this.playerDistance(carFront);
      /*
        **내가 다가와야 나선다** — 앞차가 지나간 **몇 초 뒤**가 아니라, 앞차가 지나갔고 **내가 방아쇠 거리 안에
        들어왔을 때** 곧바로 빨강을 띄우고 나선다.

        바로 뒤따르던 운전자(57번 — 앞차가 지나갈 때 13m 뒤)에게는 즉시다. 그런데 앞차가 일시정지를 건너뛰고
        지나간 사이 **나는 보호구역 앞에서 서느라 한참 뒤에 있는** 판에서는, 곧바로 나선 아이가 내가 닿기 전에
        다 건너 버렸다(실제로 넣어 보니 그런 판이 역할을 잃었다). 시간이 아니라 거리로 걸면 두 경우 모두 "내가
        볼 수 있을 때 나온다" 가 된다. 그 전에는 뜻도 드러내지 않는다 — 노랑만 오래 떠 있는 것이 사용자가 짚은
        문제였다.
      */
      if (this.startWithin !== null && d > this.startWithin) return;
      const v = ctx.carSpeedMs ?? 0;
      const canStop = d >= v * AFTER_LEAD_REACTION + (v * v) / (2 * (ctx.brakeDecel ?? AFTER_LEAD_BRAKE)) + AFTER_LEAD_MARGIN;
      /*
        서 있는 차 앞으로는 나선다. 이미 코앞이면(설 수 없다) **나를 다 보낸 뒤에** 건넌다 — 내 차가 횡단보도에
        걸쳐 있는 동안 뜻을 드러내면, 설 수 없던 나를 "통행하려는 사람을 두고 지나갔다" 로 잡게 된다.
      */
      if (carMoving && !canStop && !this.carHasPassed(carFront)) return;
      this.released = true;
      this.spawnAt = Math.max(this.spawnAt, t + AFTER_LEAD_DELAY);
    }

    if (this.state === 'waiting') {
      // 발을 떼기 전에 뜻이 먼저 드러난다 — 그동안 연석까지 걸어 나와 선다 (INTENT_LEAD)
      this.intending = t >= this.spawnAt - INTENT_LEAD;
      /*
        **설 수 없는 차 앞에서 새로 건너려 하지 않는다.** 뜻이 막 드러나려는 순간(시각이 되었거나 보행신호가 녹색으로
        바뀌었다) 차가 이미 코앞이라 설 수 없으면, 그 차를 보내고 나서 뜻을 드러낸다. 실제 보행자도 그렇게 하고, 무엇보다
        판정은 뜻이 드러난 순간부터 "통행하려는 사람" 으로 본다 — 0.8m 앞에서 뜻을 드러낸 사람 앞을 지나간 운전자를
        위반으로 잡았다 (플레이테스트가 잡았다: 무단횡단자를 기다린 뒤 출발하는 순간 옆 사람의 보행신호가 녹색이 되었다).
        이미 뜻을 보이던 사람은 그대로다 — 그 사람을 보고 서는 것이 운전자의 몫이다.
      */
      if (this.intending && !this.shownIntent && carMoving && !this.carHasPassed(carFront)) {
        const signalLetsGo = !this.obeysSignal || signal === null || signal === 'green';
        const d = this.playerDistance(carFront);
        const v = ctx.carSpeedMs ?? 0;
        const canStop = d >= v * AFTER_LEAD_REACTION + (v * v) / (2 * (ctx.brakeDecel ?? AFTER_LEAD_BRAKE)) + AFTER_LEAD_MARGIN;
        if (signalLetsGo && !canStop) {
          // 뜻도 발도 거둔다 — 차를 보낸 뒤 다시 본다
          this.intending = false;
          this.imminent = false;
          return;
        }
      }
      if (this.isVisiblyWaiting()) this.shownIntent = true;
      /*
        **건널 뜻이 확실하다** (`ready`) — 시각과 거리 방아쇠가 둘 다 코앞이다. 이것은 화면용이 아니라
        아래 `yieldedTo` 가 쓰는 값이다: 양보하려고 방아쇠보다 조금 일찍 선 운전자 앞에서도 사람이 건너게
        한다. 여기를 좁히면 일찍 선 차 앞에서 사람이 영영 안 건너는 옛 버그가 되살아난다.
      */
      this.ready =
        this.isVisiblyWaiting() &&
        t >= this.spawnAt - IMMINENT_LEAD &&
        (this.startWithin === null ||
          this.playerDistance(carFront) <= this.startWithin + IMMINENT_DISTANCE);
      // 등장 시각 전에는 보도에 **서 있는 채로** 기다린다 (숨기지 않는다)
      if (t < this.spawnAt) return this.notYet();
      this.arrived = true;

      /*
        거리 방아쇠 — 차가 아직 멀면 보도에서 기다린다 (PedSpawn.startWithin 참고).

        **다만 건널 뜻이 확실한 사람(`ready`) 앞에 차가 서 있으면 건넌다.** `ready` 는 방아쇠보다
        `IMMINENT_DISTANCE` 만큼 먼저 서는데, 운전자가 그 사이에서 — 양보하려고 조금 일찍 — 서면
        차가 더 다가오지 않아 방아쇠가 영영 당겨지지 않았다. 사람은 건널 듯한 몸짓으로 보도에 서 있고,
        운전자는 기다리다 지쳐 출발하거나 판이 멈췄다. 차가 서서 기다려 주면 사람은 건넌다 — 실제
        보행자가 그렇게 한다.
      */
      if (this.startWithin !== null && this.playerDistance(carFront) > this.startWithin) {
        const yieldedTo = this.ready && !carMoving;
        if (!yieldedTo) return this.notYet();
      }

      // 신호를 지키는 보행자는 녹색에만 출발한다. 신호기가 없으면 그냥 건넌다.
      if (this.obeysSignal && signal !== null && signal !== 'green') return this.notYet();

      // 이미 횡단보도에 진입해 달리고 있는 차 앞으로는 걸어 나오지 않는다
      if (carMoving && this.carIsInsideMyCrosswalk(carFront)) return this.notYet();

      // 설 수 없는 거리까지 다가온 NPC 앞으로도 나서지 않는다
      if (trafficBusy) return this.notYet();

      /*
        **나설 조건이 다 풀린 뒤에도 잠깐 더 선다** (위 CURB_HOLD_SHARE). 이 동안에도 연석에 나와 선
        '통행하려는 사람' 이라 양보 대상은 그대로고, 빨간 느낌표도 떠 있다 — 운전자가 보는 신호는 오히려
        더 길어진다. 조건이 도로 닫히면 위에서 먼저 돌아가므로, 기다림이 끝났다고 해서 설 수 없는 차
        앞으로 나서는 일은 없다.

        한때 "내 앞에 선 차가 1.5초 넘게 기다려 주면 대기를 끊는다" 는 규칙도 두었다. 그런데 뒤이어
        **차가 12m 안에 오면 서 있든 달려오든 대기를 끊는** 규칙(아래 `STEP_OFF_LATEST`)이 생기고, 앞차 뒤
        사람은 대기를 아예 받지 않게 되면서(`holdFor`) 그 규칙이 결과를 바꾸는 경우가 **하나도 남지 않아**
        걷어냈다 — 두 규칙이 같은 12m 를 보고 있었다.
      */
      if (this.stepOffAt === null) this.stepOffAt = t + this.holdFor(signal);
      const near = this.playerDistance(carFront);
      /*
        **앞차 뒤에서 뛰어드는 사람은 예외다** (PedSpawn.afterLead). 그 판이 가르치려는 것이 바로 "앞차가
        가린 자리에서 사람이 나온다" 이므로, 미리 나서 버리면 장면 자체가 사라진다 — 거리를 12m 로 넓혀
        재 보니 역할을 잃은 112개 판이 **전부** 이쪽이었다. 대신 그 사람들에게는 따로 안전장치가 있다
        (위 `AFTER_LEAD_*` — 내가 설 수 있는 거리일 때만 나선다).
      */
      const tooClose = !this.afterLead && near <= STEP_OFF_LATEST;
      if (t < this.stepOffAt && !tooClose) return this.notYet();

      /*
        **빨강을 띄우고 반 박자 뒤에 나선다** (RED_BEAT).

        예전에는 빨간 느낌표를 방아쇠 거리로 **미리 점쳐** 켰다. 그런데 차가 줄이며 다가오면 점이 빗나가,
        빨강이 뜨고도 사람이 2~5초를 더 서 있었다 — 운전자는 빨강을 보고 섰는데 사람이 안 나오니 무엇을
        기다리는지 알 수 없다 (사용자: "빨간색으로 변하고 너무 늦게 이동해서 문제가 생긴다. 느낌표를
        띄우고 바로 움직이게 해 달라").

        그래서 **점치지 않고 순서를 고정한다.** 나설 조건이 다 풀린 바로 그 순간 빨강을 켜고, 반 박자 뒤에
        발을 뗀다. 빨강은 이제 "곧 나온다" 는 예보가 아니라 **"지금 나간다" 는 신호**이고, 어긋날 수가 없다.
        조건이 도로 닫히면 `notYet()` 이 빨강과 박자를 함께 거둔다.
      */
      this.imminent = true;
      if (this.goAt === null) this.goAt = t + RED_BEAT;
      if (t < this.goAt) return;

      this.state = 'crossing';
    }

    this.axisPos += this.dir * this.speed * dt;
    if (Math.abs(this.axisPos) > CURB + 0.4) this.state = 'done';
  }

  /**
   * **신호를 보고 건너는 사람은 오래 지체하지 못한다** — 그 사람의 기다림에만 상한을 둔다.
   *
   * 보행신호의 녹색은 유한하다. 다 기다리게 두었더니 1401번에서 **14.0초에 녹색점멸로 바뀌는 신호를
   * 14.83초에 나서려던 노인**이 그대로 놓쳐, 판이 시작될 때부터 서 있던 사람이 끝까지 보도에 서 있었다
   * (같은 이유로 50개 판이 보행자를 잃었다). 반대로 기다림을 아예 없애 보았더니 이번에는 **148개 판**이
   * 역할을 잃었다 — 신호를 지키는 사람이 라이브러리 보행자의 대부분이라, 그쪽에도 기다림이 필요하다.
   *
   * 그래서 **상한만 둔다.** 녹색을 놓치지 않을 만큼만 지체하고, 그 이상은 그냥 건넌다.
   * 신호기 없는 횡단보도에서는 언제 건널지가 차를 보고 정해지므로 상한이 없다.
   */
  /** 아직 나설 수 없다 — 빨강과 박자를 함께 거둔다 (조건이 다시 풀리면 처음부터 센다) */
  private notYet(): void {
    this.imminent = false;
    this.goAt = null;
  }

  private holdFor(signal: PedSignal | null): number {
    // 앞차 뒤에서 뛰어드는 사람은 뜸을 들이지 않는다 — 앞차가 가린 자리에서 곧바로 나오는 것이 그 장면이다 (위 AFTER_LEAD_DELAY)
    if (this.afterLead) return 0;
    const onSignal = this.obeysSignal && signal !== null;
    // 상한은 '나서기로 정해진 뒤 실제로 발이 나가기까지' 의 전체다 — 박자(RED_BEAT)도 그 안에 든다
    return onSignal ? Math.min(this.curbHold, SIGNAL_HOLD_CAP - RED_BEAT) : this.curbHold;
  }

  /** 판정 엔진에 넘길 표본 */
  sample(): PedWalkSample {
    if (this.state === 'done') {
      return {
        crosswalk: this.crosswalk,
        intendsToCross: false,
        onConflictPath: false,
        bike: this.bike,
        active: false,
        imminent: false,
        state: this.state,
        signal: this.lastSignal,
        axis: this.axisPos,
      };
    }

    /*
      **통행이 종료될 때까지 양보 대상이다.**

      예전에는 '내 차로를 지났는가'(차로 중심 + 1.6m)로 봤다. 그런데 가까운 쪽에서 건너오는
      보행자는 내 차로를 4~6초 만에 지나므로, **아직 횡단보도 한복판에 있는데도** 그 앞으로
      지나가는 것이 위반이 아니게 된다.

      **통행 종료 = 반대편 보도에 다 올라섬**이다.

      한때는 "반대편 도로 가장자리(±9.8m)에 닿는 순간" 을 종료로 봤다. 그런데 그 자리는 발이
      아직 횡단보도 끝에 걸쳐 있고(보행자를 두 배 크기로 그려 몸은 더 걸친다), 보도의 연석까지
      1.4m 가 남아 있다. 그 사이에 출발한 주행이 **위반으로 잡히지 않았다** — 학습자가 본 것은
      "아직 다 건너지 않았는데 출발했다" 였다. 이 게임이 가르치는 것은 "다 건넌 것을 확인하고
      출발한다" 라, 반대편 연석(±CURB)에 닿을 때까지를 통행 중으로 본다.

      이 한 값을 판정 · 화면 알림 · AI 자율 주행 · 앞차가 함께 쓰므로 모두 같이 움직인다.
    */
    const onConflictPath = this.dir === 1 ? this.axisPos < CURB : this.axisPos > -CURB;

    return {
      crosswalk: this.crosswalk,
      // 보도에서 대기 중이어도 지금 건널 수 있으면 '통행하려 할 때'에 해당한다
      intendsToCross: this.state === 'crossing' || this.isVisiblyWaiting(),
      onConflictPath,
      bike: this.bike,
      active: this.arrived,
      imminent: this.state === 'waiting' && this.imminent,
      state: this.state,
      signal: this.lastSignal,
      axis: this.axisPos,
    };
  }

  /**
   * 플레이어가 내 횡단보도까지 남긴 거리 (m).
   *
   * C 는 우회전 뒤라 직선 거리로는 잴 수 없다 — 남은 경로를 (가로 + 세로)로 근사한다.
   * 화면의 진출 안내(Game.ts)가 쓰는 것과 같은 방식이라 표시와 동작이 어긋나지 않는다.
   */
  private playerDistance(carFront: CarFront): number {
    // S · A · B 는 남북 도로를 가로지른다 — 남은 거리가 곧 z 차이다
    if (this.crosswalk === 'S') return carFront.z - CROSSWALK_S_OUTER;
    if (this.crosswalk === 'A') return carFront.z - CROSSWALK_OUTER;
    // B 는 교차로 **건너편**이라 내가 먼저 닿는 가장자리가 INNER 다 (z 가 줄어드는 방향)
    if (this.crosswalk === 'B') return carFront.z - CROSSWALK_B_INNER;
    return Math.max(0, CROSSWALK_INNER - carFront.x) + Math.max(0, carFront.z - PLAYER_EXIT_Z);
  }

  /** 내 차가 이 횡단보도를 **차 한 대 길이 넘게** 지나갔는가 — 뒤로 건너도 부딪힐 일이 없다 */
  private carHasPassed(carFront: CarFront): boolean {
    if (this.crosswalk === 'S') return carFront.z < CROSSWALK_S_INNER - 5;
    if (this.crosswalk === 'A') return carFront.z < CROSSWALK_INNER - 5;
    if (this.crosswalk === 'B') return carFront.z < CROSSWALK_B_OUTER - 5;
    return carFront.x > CROSSWALK_OUTER + 5;
  }

  private carIsInsideMyCrosswalk(carFront: CarFront): boolean {
    if (this.crosswalk === 'S') {
      return carFront.z >= CROSSWALK_S_INNER && carFront.z <= CROSSWALK_S_OUTER;
    }
    /*
      A · B 는 z, C 는 x 로 잰다. **절댓값으로 재는 이유** — B 는 교차로 건너편이라 z 가 음수다
      (z ∈ [-18.8, -14.8]). A 와 크기가 같고 부호만 반대라 절댓값 하나로 둘 다 걸린다.
    */
    const v = this.crosswalk === 'A' || this.crosswalk === 'B' ? carFront.z : carFront.x;
    return Math.abs(v) >= CROSSWALK_INNER && Math.abs(v) <= CROSSWALK_OUTER;
  }

  /**
   * 등장 시각이 지나 횡단보도 앞에 서 있고, **지금 통행하려는** 상태인가.
   *
   * 보행신호가 적색이라 서 있는 사람은 '통행하려 할 때' 가 아니다. 그 사람은 지금 건널
   * 생각이 없고, 건너서도 안 된다. 이걸 구분하지 않으면 **내 차량신호가 녹색인데 보도에
   * 사람이 서 있다는 이유만으로** 횡단 방해가 잡힌다 (녹색일 때 그쪽 보행신호는 항상
   * 적색이므로, 사실상 늘 걸린다).
   *
   * 판단 기준은 `update()` 의 출발 조건과 같아야 한다 — 지금 출발할 사람이면 '통행하려는 때' 다.
   * 다만 **등장 시각보다 `INTENT_LEAD` 초 먼저** 켜진다 (그 상수 주석 참고).
   */
  private isVisiblyWaiting(): boolean {
    if (this.state !== 'waiting' || !this.intending) return false;
    // 신호를 지키는 보행자인데 녹색이 아니면 건너지 않는다 (신호기가 없으면 언제든 건넌다)
    if (this.obeysSignal && this.lastSignal !== null && this.lastSignal !== 'green') return false;
    return true;
  }
}
