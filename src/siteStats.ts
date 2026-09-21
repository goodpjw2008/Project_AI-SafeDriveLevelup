/**
 * **사이트 전체의 안전운전 성공 · 실패 횟수** — 첫 화면 오른쪽 위 (사용자 요청).
 *
 * 이 사이트에서 누가 달렸든 한 판이 끝날 때마다 하나씩 오르는 숫자다. 서버의 저장소에 있다
 * (server/statsStore.mjs) — 내 기록(economy/save.ts)은 이 브라우저에만 있지만, 이 숫자는 모두가 같은 것을 본다.
 *
 * ## 한 판에 두 번 부른다
 *
 * 판을 시작할 때 **판 표**를 받고(`beginRun`), 마치면 그 표를 내며 결과를 알린다(`endRun`). 서버는 표 하나에 한 번만
 * 센다 — 같은 판을 두 번 알려도(두 탭 · 다시 보내기) 숫자는 하나만 오른다. 판 도중에 첫 화면으로 나가면 표를 내지
 * 않으므로 세지 않는다 (끝나지 않은 판은 성공도 실패도 아니다).
 *
 * **무엇을 세지 않는가** — AI 자율 주행 시범(사람이 몬 판이 아니다)과 맵 체험(시험용)은 부르는 쪽(main.ts)이 뺀다.
 *
 * **실패해도 조용하다.** 서버가 없는 배포(정적 호스팅 · 단일 파일)나 저장소를 붙이지 않은 배포에서는 숫자 칸이
 * 아예 뜨지 않을 뿐, 게임은 그대로 돈다.
 */

import type { Grade } from './rules/lawRules';

export interface SiteStats {
  success: number;
  fail: number;
}

export type RunOutcome = 'success' | 'fail';

/** 서버를 이만큼만 기다린다 — 첫 화면의 숫자 때문에 아무것도 붙잡히지 않게 */
export const STATS_TIMEOUT_MS = 5_000;

/**
 * 판의 등급 → 안전운전 성공 · 실패. **위반 없이 마쳤으면 성공**(PERFECT · SUCCESS), 위반했거나 완주하지 못했으면
 * 실패(VIOLATION · FAIL)다 — 결과 화면의 초록 · 붉은 판정과 같은 선이다.
 */
export const outcomeOf = (grade: Grade): RunOutcome => (grade === 'PERFECT' || grade === 'PASS' ? 'success' : 'fail');

/** 지금까지 받은 숫자 중 가장 새것 */
let latest: SiteStats | null = null;
/** 이번 판의 표 — 받는 중이면 약속, 못 받았으면 null */
let ticket: Promise<string | null> | null = null;

/**
 * **두 숫자는 줄지 않는다** — 둘 중 큰 쪽이 새것이다. 첫 화면의 읽기는 가장자리(CDN)에 몇 초 담긴 값이라, 방금 끝낸
 * 판의 답(올린 뒤의 숫자)보다 작을 수 있다. 그때 작은 숫자로 되돌아가 보이면 내 판이 안 세어진 것처럼 읽힌다.
 */
function keepNewest(next: SiteStats): SiteStats {
  latest = latest
    ? { success: Math.max(latest.success, next.success), fail: Math.max(latest.fail, next.fail) }
    : next;
  return latest;
}

const isStats = (v: unknown): v is SiteStats =>
  typeof v === 'object' &&
  v !== null &&
  Number.isFinite((v as SiteStats).success) &&
  Number.isFinite((v as SiteStats).fail);

async function call(init?: RequestInit): Promise<unknown> {
  const res = await fetch('/api/stats', { ...init, signal: AbortSignal.timeout(STATS_TIMEOUT_MS) });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

const post = (body: object): Promise<unknown> =>
  call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** 가장 최근에 받은 숫자 — 첫 화면을 그릴 때 먼저 쓰고, 새 숫자가 오면 바꾼다 */
export const cachedSiteStats = (): SiteStats | null => latest;

/** 서버에서 숫자를 읽는다. 못 읽으면 가지고 있던 것(없으면 null) */
export async function loadSiteStats(): Promise<SiteStats | null> {
  try {
    const body = await call();
    return isStats(body) ? keepNewest(body) : latest;
  } catch {
    return latest;
  }
}

/** 판을 시작한다 — 표를 받아 둔다 (기다리지 않는다) */
export function beginRun(): void {
  ticket = post({ action: 'start' })
    .then((b) => (b && typeof (b as { ticket?: unknown }).ticket === 'string' ? (b as { ticket: string }).ticket : null))
    .catch(() => null);
}

/** 판을 마쳤다 — 표를 내고 센다. 올린 뒤의 숫자를 돌려준다 (못 셌으면 null) */
export async function endRun(outcome: RunOutcome): Promise<SiteStats | null> {
  const pending = ticket;
  // 표는 한 번만 낸다 — 같은 판의 결과 화면이 다시 그려져도 두 번 보내지 않게
  ticket = null;
  const t = pending ? await pending : null;
  if (!t) return null;
  try {
    const body = await post({ action: 'finish', ticket: t, outcome });
    return isStats(body) ? keepNewest(body) : null;
  } catch {
    return null;
  }
}
