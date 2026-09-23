/**
 * **플레이어 칸** — 내 레벨과 경험치를 보여 주는 **단 하나의 모양**.
 *
 * ```
 * ⬢6  안전운전 Level6                150 / 500 XP
 *     ███████████░░░░░░░░░░░░░░░░░░░░░░░░░
 *     L7까지 350 XP · 새 맵 무위반 +100          (아랫줄은 있을 때만)
 * ```
 *
 * ## 왜 하나로 모았는가
 *
 * 레벨과 경험치가 세 화면에 서는데, 한때 셋이 제각각이었다 — 첫 화면은 큰 뱃지와 이름 아래에 "경험치" 라는
 * 머리를 단 막대, 결과 화면은 뱃지도 이름도 없이 막대만, 운전 화면은 작은 카드. 사용자가 짚었다 — "레벨과
 * 경험치 부분은 프로그램 전체적으로 일관적인 ui 로 나와서 사용자가 헷갈리지 않게 해줘." 같은 값을 화면마다
 * 다른 그림으로 그리면 **같은 것인지부터 다시 알아봐야 한다.**
 *
 * 그래서 모양은 여기 하나에서 만들고, 화면은 크기(`size`)만 고른다. 뱃지 · 호칭 · 숫자 · 막대가 늘 **같은
 * 자리**에 선다 — 숫자는 오른쪽 위, 막대는 그 아래, 설명은 막대 아래. 뱃지의 얻음/아직(점선)도 같은 규칙이다.
 *
 * ## 크기
 *
 *  - `lg`  — 첫 화면. 이 과정의 얼굴이라 가장 크다. 아랫줄 오른쪽에 레벨 길(`aside`)이 붙는다
 *  - `md`  — 결과 화면. 이번 판에 얻은 만큼(`gained`)을 막대 끝에 밝게 칠한다
 *  - `hud` — 운전 화면. 달리면서 읽으므로 글자는 크게, 아랫줄은 없다
 */

import { MAX_LEVEL, courseTitle, levelLabel, XP_PER_CLEAN_RUN, type Difficulty } from '../scenarios/curriculum';
import { levelBadge, masterBadge } from './badges';


export interface PlayerInfo {
  level: Difficulty;
  /** 지금 레벨에서 모은 경험치 */
  xp: number;
  /** 다음 레벨(L10 은 안전운전 마스터)까지 필요한 경험치 — 난이도가 곱해진 값 (curriculum.ts 의 xpToNext) */
  need: number;
  mastered: boolean;
  /** 남은 나쁜 운전 습관 수 — 막대가 찼는데 오르지 못한 이유를 아랫줄이 말한다 */
  habitsLeft?: number;
  /** 이번 판에 얻은 양 — 막대 끝의 그만큼을 밝게 칠한다 (결과 화면) */
  gained?: number;
}

export type PlayerSize = 'lg' | 'md' | 'hud';

/**
 * **모은 경험치는 필요한 양을 넘겨 보이지 않는다.** 판을 마칠 때 막대는 필요한 양에서 멈추지만(curriculum.ts 의 advance),
 * 필요한 양이 **나중에** 줄면 저장된 값이 넘친다 — 경험치 곡선을 줄였을 때(L6 500 → 300) "400 / 300 XP" 가 떴고,
 * 난이도를 쉽게 바꿔도 같다. 넘친 몫은 다음 판에서 어차피 잘리므로(advance 의 `before`) 보여 줄 때도 자른다.
 */
const withinNeed = (p: PlayerInfo): PlayerInfo => (p.xp > p.need ? { ...p, xp: p.need } : p);

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/*
  **호칭('안전운전 Level6')은 칠하지 않는다.** 호칭은 작품 이름이 아니라 **학습자가 키우는 능력의 이름**이다
  (brand.ts). 이름이 아닌 것에 이름의 딱지를 입히면, 화면에서 무엇이 이름인지 흐려진다.
*/
const branded = (text: string): string => esc(text);

/**
 * 막대 아래 한 줄 — 다음 레벨까지 얼마나 남았는가.
 *
 * 막대가 찼는데 나쁜 습관이 남았으면 "습관을 고치면 오른다" 고 말한다 — 학습 루프(습관을 다 고쳐야 다음 레벨)가
 * 막대 바로 옆에 보여야, 잘했는데 왜 안 오르는지를 알 수 있다.
 */
export function playerFoot(given: PlayerInfo): string {
  const p = withinNeed(given);
  if (p.mastered) return `마스터 운행 — 처음부터 다시 시작하기 전까지 ${levelLabel(MAX_LEVEL)} 코스가 무작위로 이어집니다`;
  const target = p.level >= MAX_LEVEL ? '안전운전 마스터' : levelLabel((p.level + 1) as Difficulty);
  if (p.xp >= p.need) {
    return p.habitsLeft
      ? `경험치가 가득 찼습니다 — 나쁜 습관 ${p.habitsLeft}개를 고치면 ${target}`
      : `${target} 준비 완료`;
  }
  return `${target}까지 ${p.need - p.xp} XP · 새 맵 무위반 +${XP_PER_CLEAN_RUN}`;
}

/**
 * @param opts.foot  막대 아래 설명 줄 — 운전 화면(`hud`)은 기본으로 끈다
 * @param opts.aside 아랫줄 오른쪽에 붙일 것 (첫 화면의 레벨 길)
 */
export function playerCard(
  given: PlayerInfo,
  size: PlayerSize,
  opts: { foot?: boolean; aside?: string } = {},
): string {
  const p = withinNeed(given);
  const showFoot = opts.foot ?? size !== 'hud';
  const full = p.mastered || p.xp >= p.need;
  const pct = (v: number): number => (p.mastered ? 100 : Math.max(0, Math.min(100, (v / p.need) * 100)));
  const gained = p.mastered ? 0 : Math.max(0, Math.min(p.gained ?? 0, p.xp));
  /*
    L10 은 닿은 것과 해낸 것이 다르다 — 마스터 전까지는 뱃지에 점선을 두른다 (첫 화면의 레벨 뱃지와 같은 규칙).
    얻지 못한 것을 얻은 것처럼 그리면 그림이 뜻을 잃는다.
  */
  const earned = p.mastered || p.level < MAX_LEVEL;
  const title = courseTitle(p);
  const num = p.mastered ? 'MAX' : `<b>${p.xp}</b> / ${p.need} XP`;
  const label = p.mastered ? title : `${title} · 경험치 ${p.xp} / ${p.need}`;
  const foot = showFoot || opts.aside
    ? `<div class="player-foot">${showFoot ? `<span class="player-foot-text">${esc(playerFoot(p))}</span>` : ''}${
        opts.aside ?? ''
      }</div>`
    : '';
  return `
    <div class="player ${size} ${full ? 'full' : ''} ${p.mastered ? 'mastered' : ''}" role="group" aria-label="${esc(label)}">
      <span class="level-badge-wrap ${earned ? 'earned' : 'locked'}" aria-hidden="true">${
        // 마스터면 뱃지도 M — 첫 화면 레벨 길의 마지막 칸과 같은 그림이다
        p.mastered ? masterBadge({ labelled: false }) : levelBadge(p.level, { labelled: false })
      }</span>
      <div class="player-body">
        <div class="player-head">
          <span class="player-name">${branded(title)}</span>
          <span class="player-xp">${num}</span>
        </div>
        <div class="player-track" role="progressbar" aria-label="경험치" aria-valuemin="0"
          aria-valuemax="${p.need}" aria-valuenow="${p.mastered ? p.need : p.xp}">
          <div class="player-fill" style="width:${pct(p.xp - gained)}%"></div>
          ${gained > 0 ? `<div class="player-new" style="left:${pct(p.xp - gained)}%;width:${pct(gained)}%"></div>` : ''}
        </div>
        ${foot}
      </div>
    </div>`;
}
