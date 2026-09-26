/**
 * **내 앞 횡단보도의 보행자가 건너려는 움직임이 보이는가** — AI 코치 말풍선이 한 줄로 알린다.
 *
 * ## 왜 따로 알리는가
 *
 * 판정은 "통행하고 있거나 **통행하려고 하는** 때" 다(제27조 제1항). 뒤엣것이 이 게임에서
 * 가장 놓치기 쉽다 — 사람이 아직 차도에 발을 딛지 않았으니 "없다" 로 읽고 지나가 버린다.
 * 보행자는 건널 뜻이 생기면 연석까지 걸어 나와 발을 바꿔 딛는데(Pedestrian.ts), 그 작은
 * 움직임이 바로 규정이 말하는 "통행하려는 때" 다. 코치가 그 순간을 말로 짚고, 그 사람 머리
 * 위에는 느낌표가 뜬다.
 *
 * **판정과 같은 값을 본다** (`intendsToCross` · `state` · `onConflictPath`). 화면이 "건너려는
 * 것 같다" 고 했는데 판정은 아무렇지 않거나, 그 반대가 되면 안 된다.
 *
 * 순수 함수다 — 화면 없이 테스트한다 (tests/pedCue.test.ts).
 */

import {
  CROSSWALK_INNER,
  CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_S_OUTER,
  PLAYER_EXIT_Z,
  STOP_LINE,
} from '../layout';
import type { CrosswalkId, PedestrianSample, WorldSample } from '../rules/lawRules';

export interface PedCue {
  crosswalk: CrosswalkId;
  /** `intending` — 연석까지 나와 건너려는 것 같은 사람 · `crossing` — 차도 위를 건너는 중인 사람 */
  kind: 'intending' | 'crossing';
  /**
   * 그 사람이 **도로 건너편**(내 차로의 반대쪽 절반)에 있는가.
   *
   * 건너편 사람은 멀어서 작게 보이고, "아직 멀다" 로 읽혀 흘려 보기 쉽다. 그런데 그 사람이
   * 건너오면 결국 내 앞길을 지난다 — 코치가 "건너편" 이라고 짚어 준다.
   * 위치를 모르는 표본(검증기)에서는 `false`.
   */
  far: boolean;
}

/**
 * 표본의 위치가 **내 차로의 반대쪽 절반**인가.
 * A·S 는 남북 도로를 가로지르므로 x 로(나는 동쪽 차로), C 는 동서 도로를 가로지르므로 z 로
 * (나는 남쪽 진출 차로) 가른다.
 */
function isFarSide(id: CrosswalkId, p: PedestrianSample): boolean {
  if (id === 'C') return p.z !== undefined && p.z < 0;
  return p.x !== undefined && p.x < 0;
}

/**
 * 알려 주기 시작하는 거리 (m, 그 횡단보도까지).
 *
 * 정지선에서 우회전 뒤 횡단보도(C)까지가 약 22m 다. 정지선에 다가가며 C 쪽 사람까지 함께
 * 보이도록 그보다 조금 넉넉하게 잡는다. 더 멀리서 알리면 판단할 때쯤에는 이미 눈에 익어
 * 흘려 보게 된다.
 */
export const PED_CUE_RANGE = 35;

/**
 * 우회전 후 횡단보도(C)를 알리기 시작하는 자리 (앞범퍼 z) — **정지선 12m 앞**.
 *
 * 정지선 안내("정지선까지 12m")가 뜨는 바로 그 지점이다(Game 의 STOP_ADVICE_LEAD). 정지선에
 * 닿을 때(4m 앞)부터로 두었더니, 녹색이라 정지선에서 서지 않는 판에서는 알림이 뜨고 1초 만에
 * 사람이 차도로 나섰다 — 서행(12km/h)으로 8m 를 더 당기면 반응할 시간이 3초쯤 는다.
 */
export const C_CUE_FROM_Z = STOP_LINE + 12;

/**
 * 만나는 순서(S → A → C)로 **가장 먼저 만날** 횡단보도 하나의 움직임.
 *
 * 내가 **이미 지나온** 횡단보도와 **아직 먼**(PED_CUE_RANGE 밖) 횡단보도는 보지 않는다.
 * 건너는 사람이 건너려는 사람보다 먼저다 — 둘이 함께 있으면 더 급한 쪽을 말한다.
 */
export function pedCueAt(
  s: Pick<WorldSample, 'frontX' | 'frontZ' | 'pedestrians'>,
  hasApproachZone: boolean,
  /** 알리는 거리 — 낮에는 PED_CUE_RANGE, 밤에는 전조등 범위(scenarios/conditions.ts 의 sightRange)로 줄어든다 */
  range: number = PED_CUE_RANGE,
): PedCue | null {
  const ahead: { id: CrosswalkId; distance: number }[] = [];
  if (hasApproachZone && s.frontZ > CROSSWALK_S_INNER) {
    ahead.push({ id: 'S', distance: s.frontZ - CROSSWALK_S_OUTER });
  }
  if (s.frontZ > CROSSWALK_INNER) ahead.push({ id: 'A', distance: s.frontZ - CROSSWALK_OUTER });
  /*
    **우회전 후 횡단보도(C)는 정지선에 다가갈 때부터** 본다 (`C_CUE_FROM_Z` — 정지선 12m 앞).

    두 번 옮겨 여기에 왔다.
     1. C 까지 거리만 봤다(35m). 정지선에 다가가는 동안부터 떠 있어 **너무 이르다** 는 지적을
        받았다 — 그때 봐야 할 것은 정면 신호와 정지선이다.
     2. 교차로에 들어서 돌기 시작할 때부터로 늦췄다. 이번에는 **반응할 시간이 모자랐다** —
        코너에서 C 까지 5초 남짓인데, 그 사이 사람을 찾아보고 설 준비를 해야 했다.
     3. 정지선에 닿을 때(4m 앞)부터로 당겼다. 녹색이라 서지 않는 판에서는 여전히 1초뿐이었다.
    정지선 안내가 뜨는 12m 앞이 그 사이다 — 설지 말지를 판단하기 시작하는 순간이 곧 건너편
    사람을 봐야 하는 순간이고, 적색에 서 있는 동안에도 계속 떠 있어 미리 알고 출발할 수 있다.
  */
  if (s.frontZ <= C_CUE_FROM_Z && s.frontX < CROSSWALK_INNER) {
    ahead.push({
      id: 'C',
      // 코너 너머라 직선으로는 못 잰다 — 남은 가로 + 세로 (Game 의 진출 안내와 같은 근사)
      distance: Math.max(0, CROSSWALK_INNER - s.frontX) + Math.max(0, s.frontZ - PLAYER_EXIT_Z),
    });
  }

  for (const { id, distance } of ahead) {
    if (distance > range) continue;
    /*
      **`active` 는 보지 않는다.** 그 값은 등장 시각(`at`)이 지나야 켜지는 결과 지도용이라,
      연석에 나와 건널 뜻을 보이는 동안(pedWalk 의 INTENT_LEAD)에는 꺼져 있다. 그걸 거르면
      "건너려는 것 같아요" 가 **절대 뜰 수 없고**, 사람이 발을 뗀 뒤에야 "건너는 중" 이 떴다 —
      반응할 시간이 모자라다는 지적의 진짜 원인이었다. 판정도 이 값을 보지 않는다.
    */
    const here = s.pedestrians.filter((p) => p.crosswalk === id);
    /*
      여럿이면 **가까운 쪽 사람**을 먼저 말한다 — 더 급하다. 건너편 사람만 있을 때 "건너편" 이라 한다.
    */
    const pick = (list: PedestrianSample[]): PedestrianSample | undefined =>
      list.find((p) => !isFarSide(id, p)) ?? list[0];
    const crossing = pick(here.filter((p) => p.state === 'crossing' && p.onConflictPath));
    if (crossing) return { crosswalk: id, kind: 'crossing', far: isFarSide(id, crossing) };
    const intending = pick(here.filter((p) => p.state === 'waiting' && p.intendsToCross));
    if (intending) return { crosswalk: id, kind: 'intending', far: isFarSide(id, intending) };
  }
  return null;
}
