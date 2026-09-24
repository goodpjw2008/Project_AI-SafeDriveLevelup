/**
 * **뱃지 그림과 뱃지 칸** — 결과 화면의 한 줄, 첫 화면의 요약, 모음 화면 (economy/badges.ts 의 규칙을 그린다).
 *
 * 그림 파일을 두지 않고 그 자리에서 SVG 로 그린다 — 레벨 뱃지(ui/badges.ts)와 같은 까닭이다. 열네 개 × 단계 셋을
 * 구우면 번들이 무거워지고, 단계는 **테두리 색 하나**만 다르다. 가운데 그림은 이 게임의 아이콘과 같은 선 굵기(2)로 그린다.
 *
 * 색: 법규 지킴 · 습관 교정가는 동 · 은 · 금, 무위반 연속은 불꽃색, 한 번 해내는 성장 뱃지는 보라. 아직 없는 뱃지는
 * 회색 점선 — 무엇을 하면 얻는지는 모음 화면이 글로 말한다 (캐글의 잠긴 뱃지처럼).
 */

import {
  BADGES,
  SITUATIONS,
  STREAKS,
  badgeDef,
  heldCount,
  progressOf,
  tiersOf,
  type BadgeDef,
  type BadgeEvent,
  type BadgeGroup,
  type BadgeId,
  type BadgeState,
  type KeepBadgeId,
  type Tier,
} from '../economy/badges';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** 가운데 그림 — 24×24 좌표계, 선만 그린다 */
const GLYPH: Record<BadgeId, string> = {
  // 멈춤 표지(팔각형)
  redStop: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M8 12h8"/>',
  // 우회전 화살표
  greenArrow: '<path d="M7 20v-7a4 4 0 0 1 4-4h7"/><path d="m14 5 4 4-4 4"/>',
  // 걷는 사람
  pedestrianFirst: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7.5v6l-3 7"/><path d="m12 13.5 3 7"/><path d="M8 11h8"/>',
  // 보호구역 표지(삼각형) 안의 어린이
  schoolZoneStop: '<path d="M12 3 2.5 20h19z"/><circle cx="12" cy="10.5" r="1.6"/><path d="M12 12.5v4"/><path d="M10 14.5h4"/>',
  // 신호등
  schoolZoneSignal:
    '<rect x="8" y="2" width="8" height="20" rx="3"/><circle cx="12" cy="7" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="17" r="1.5"/>',
  // 불꽃 — 이어 가는 연속
  streak5: '<path d="M12 22c4 0 7-2.8 7-6.7 0-3.8-2.6-5.6-3.8-8.8-1 1.9-2.1 2.9-3.7 2.9 0-2-1-4.3-2.8-6.4 0 4.2-5.7 6.9-5.7 12.3 0 3.9 5 6.7 9 6.7z"/>',
  streak10: '<path d="M12 22c4 0 7-2.8 7-6.7 0-3.8-2.6-5.6-3.8-8.8-1 1.9-2.1 2.9-3.7 2.9 0-2-1-4.3-2.8-6.4 0 4.2-5.7 6.9-5.7 12.3 0 3.9 5 6.7 9 6.7z"/>',
  streak20: '<path d="M12 22c4 0 7-2.8 7-6.7 0-3.8-2.6-5.6-3.8-8.8-1 1.9-2.1 2.9-3.7 2.9 0-2-1-4.3-2.8-6.4 0 4.2-5.7 6.9-5.7 12.3 0 3.9 5 6.7 9 6.7z"/>',
  // 체크
  firstClean: '<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/>',
  // 렌치 — 고침
  habitFixer:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  // 별
  schoolZoneFirst: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>',
  // 나침반
  explorer: '<circle cx="12" cy="12" r="9.5"/><path d="m15.8 8.2-2 5.6-5.6 2 2-5.6z"/>',
  // 앞차(자동차 앞모습)
  leadJudge: '<path d="M4 16v-4l2.2-5h11.6L20 12v4"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="13" r="1"/><circle cx="16.5" cy="13" r="1"/>',
  // 왕관
  master: '<path d="m3 18-1-11 5.5 4.5L12 4l4.5 7.5L22 7l-1 11z"/><path d="M4 21h16"/>',
};

/** 법규 지킴 — 예전 '금' 의 색을 그대로 쓴다 (다섯 개뿐이고 이 작품의 핵심이라 가장 눈에 띄는 색이다) */
const KEEP = '#f2b01e';
const FLAME = '#ff7a45';
const GROWTH = '#9d8cff';
const LOCKED = '#4a5361';

/**
 * 이 뱃지의 색 — **무리마다 다르다** (법규 지킴 · 무위반 연속 · 성장).
 *
 * 한때는 동 · 은 · 금 세 색이었다. 단계를 없애면서(economy/badges.ts 의 `Tier`) 색도 무리를
 * 가리키는 뜻으로 돌린다 — 같은 무리의 뱃지가 같은 색이라 모음 화면에서 무리가 한눈에 갈린다.
 */
function colorOf(def: BadgeDef, tier: Tier): string {
  if (tier === 0) return LOCKED;
  return def.group === 'streak' ? FLAME : def.group === 'keep' ? KEEP : GROWTH;
}



/** 뱃지 하나의 그림 — 둥근 메달에 단계 색 테두리 */
export function badgeMedal(id: BadgeId, tier: Tier, size = 48): string {
  const def = badgeDef(id);
  const c = colorOf(def, tier);
  const locked = tier === 0;
  return `<svg class="badge-medal${locked ? ' locked' : ''}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="21" fill="${c}" fill-opacity="${locked ? 0.06 : 0.18}" stroke="${c}" stroke-width="3"${
      locked ? ' stroke-dasharray="4 3"' : ''
    }/>
    <g transform="translate(12 12)" fill="none" stroke="${locked ? '#6b7584' : c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH[id]}</g>
  </svg>`;
}

/**
 * 결과 화면의 한 줄 — 얻거나 잃은 뱃지 하나.
 *
 * **'단계 올라감 · 내려감' 은 더 이상 나오지 않는다** — 단계를 없앴으므로(economy/badges.ts 의 `Tier`)
 * 뱃지는 받거나 잃거나 둘뿐이다. 가지는 남겨 둔다: 저장본에 남은 예전 기록이 그 꼴로 올라올 수 있다.
 */
function eventLine(ev: BadgeEvent): string {
  const def = badgeDef(ev.id);
  const shown: Tier = ev.to > 0 ? ev.to : ev.from;
  const text =
    ev.kind === 'gain' || ev.kind === 'up'
      ? `<b>새 뱃지</b> ${esc(def.name)}`
      : `<b>뱃지를 잃었습니다</b> ${esc(def.name)}`;
  return `<li class="badge-ev ${ev.kind}">
    ${badgeMedal(ev.id, ev.kind === 'lost' ? 0 : shown, 40)}
    <span class="badge-ev-text">${text}${ev.reason ? `<small>${esc(ev.reason)}</small>` : ''}</span>
  </li>`;
}

/**
 * 결과 화면의 **뱃지 줄** — 이번 판에 얻거나 잃은 뱃지. 없으면 그리지 않는다.
 * 잃은 것을 먼저 둔다 — 무엇을 어겨서 잃었는지가 이 판에서 가장 먼저 알아야 할 것이다.
 */
export function badgeStrip(events: readonly BadgeEvent[]): string {
  if (!events.length) return '';
  const order = { lost: 0, down: 1, gain: 2, up: 3 } as const;
  const sorted = [...events].sort((a, b) => order[a.kind] - order[b.kind]);
  return `<section class="badge-strip" aria-label="이번 판의 뱃지">
    <ul>${sorted.map(eventLine).join('')}</ul>
  </section>`;
}

/**
 * 첫 화면의 **뱃지 요약** — 몇 개를 가졌는지와 가진 뱃지 몇 개. 누르면 모음 화면이 열린다 (id `btn-badges`).
 * 높은 단계부터 늘어놓는다 — 금이 먼저 보여야 자랑이 된다.
 */
export function badgeSummary(s: BadgeState): string {
  const tiers = tiersOf(s);
  const held = BADGES.filter((b) => tiers[b.id] > 0).sort((a, b) => tiers[b.id] - tiers[a.id]);
  const medals = held.slice(0, 6).map((b) => badgeMedal(b.id, tiers[b.id], 30)).join('');
  return `<button class="badge-summary" id="btn-badges" type="button" aria-label="내 뱃지 ${held.length}개 — 모두 보기">
    <span class="badge-summary-count">뱃지 <b>${heldCount(s)}</b> / ${BADGES.length}</span>
    <span class="badge-summary-medals">${medals || '<span class="badge-summary-empty">아직 없습니다 — 위반 없이 달리면 첫 뱃지를 받습니다</span>'}</span>
    <span class="badge-summary-more">모두 보기 ›</span>
  </button>`;
}

/** 모음 화면의 한 칸 아래 줄 — 지금 어디쯤인가 */
function progressText(s: BadgeState, def: BadgeDef, tier: Tier): string {
  const { now, next } = progressOf(s, def.id);
  if (def.group === 'keep') {
    // 잃은 적이 있으면 그 사실을 적는다 — 다시 받을 수 있다는 뜻이다
    const bestNote = s.keepBest[def.id as KeepBadgeId] > tier ? ' · 받은 적 있음' : '';
    if (next === null) return `지킨 횟수 ${now}번${bestNote}`;
    return `지킨 횟수 ${now}번 · ${next - now}번 더${bestNote}`;
  }
  if (def.group === 'streak') {
    const need = STREAKS[def.id as keyof typeof STREAKS];
    return tier > 0 ? `지금 ${s.streak}연속 — 이어 가는 중` : `지금 ${s.streak}연속 · ${need - s.streak}판 더`;
  }
  if (def.id === 'habitFixer') {
    return next === null ? `고친 습관 ${now}개` : `고친 습관 ${now}개 · ${next - now}개 더`;
  }
  if (def.id === 'explorer') {
    const left = SITUATIONS.filter((x) => !s.seen.includes(x.key)).map((x) => x.name);
    return left.length ? `겪은 상황 ${s.seen.length} / ${SITUATIONS.length} · 남은 것: ${left.join(' · ')}` : '모든 상황을 겪었습니다';
  }
  return tier > 0 ? '달성' : '아직';
}

const GROUP_TEXT: Record<BadgeGroup, { title: string; note: string }> = {
  keep: {
    title: '법규 지킴',
    note: '그 법규를 시험한 판에서 세 번 지키면 받습니다. 어기면 잃고 처음부터 다시 셉니다.',
  },
  streak: { title: '무위반 연속', note: '위반 없이 이어 가는 동안 갖습니다. 위반하거나 사고가 나면 잃습니다.' },
  growth: { title: '성장', note: '한 번 해낸 일이라 위반해도 잃지 않습니다.' },
};

/** 모음 화면의 본문 — 세 묶음, 뱃지마다 그림 · 이름 · 얻는 법 · 지금 어디쯤인가 */
export function badgeCollection(s: BadgeState): string {
  const tiers = tiersOf(s);
  const group = (g: BadgeGroup): string => {
    const cards = BADGES.filter((b) => b.group === g)
      .map((def) => {
        const tier = tiers[def.id];
        return `<li class="badge-card${tier ? ' held' : ''}">
          ${badgeMedal(def.id, tier, 56)}
          <div class="badge-card-text">
            <h3>${esc(def.name)}</h3>
            <p class="badge-how">${esc(def.how)}</p>
            <p class="badge-progress">${esc(progressText(s, def, tier))}</p>
          </div>
        </li>`;
      })
      .join('');
    const extra = g === 'streak' && s.bestStreak > 0 ? ` <span class="badge-best">최고 ${s.bestStreak}연속</span>` : '';
    return `<section class="badge-group">
      <h2>${GROUP_TEXT[g].title}${extra}</h2>
      <p class="badge-group-note">${esc(GROUP_TEXT[g].note)}</p>
      <ul class="badge-grid">${cards}</ul>
    </section>`;
  };
  return `${group('keep')}${group('streak')}${group('growth')}`;
}
