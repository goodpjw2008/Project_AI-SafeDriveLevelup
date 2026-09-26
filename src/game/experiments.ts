/**
 * **실험 스위치** — 주소 끝에 `?x=이름,이름` 을 붙여 켠다. 배포 한 번으로 여러 가설을 실기기에서 가려 보려는 장치다.
 *
 * 사용자 휴대폰(삼성 Xclipse 940 · ANGLE-Vulkan)의 검은 가로 띠는 헤드리스에서 재현되지 않고, 설정 손잡이를
 * 늘려 가며 배포하는 것은 Vercel 배포 한도(CHANGELOG)를 먹는다. 그래서 스위치는 코드에 남기고 주소로 켠다.
 * 같은 세션 안에서는 주소가 바뀌어도 남는다(sessionStorage) — `?x=off` 로 끈다. 진단 줄(fps 표시)에 켜진 것이 찍힌다.
 *
 *  · `shadowlag` — 그림자 맵을 두 장 번갈아 굽고 **지난 프레임 것**을 읽는다 (Game 의 renderShadowsLagged).
 *                  한 프레임 안에서 '렌더 타깃에 그리고 곧바로 읽는' 의존이 없어진다.
 *  · `finish`    — 프레임 끝에서 `gl.finish()` — CPU 가 GPU 를 다 기다린 뒤에 화면에 올린다.
 *  · `noscale`   — 렌더 해상도를 100% 로 고정 (자동 조절 · 설정 무시).
 *  · `noshadow`  — 그림자 패스를 아예 끈다 (설정 '낮음' 과 같다).
 */

const KEY = 'turn-right:experiments';

/** `?x=` 값 → 이름 목록. 빈 값 · `off` 는 모두 끔 */
export function parseExperiments(query: string | null): string[] {
  if (query === null) return [];
  const q = query.trim();
  if (q === '' || q === 'off') return [];
  return q
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

let active: Set<string> | null = null;

function load(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  let list: string[] | null = null;
  const q = new URLSearchParams(window.location.search).get('x');
  if (q !== null) {
    list = parseExperiments(q);
    try {
      window.sessionStorage.setItem(KEY, list.join(','));
    } catch {
      /* 저장 못 해도 이번 페이지에서는 켜진다 */
    }
  } else {
    try {
      const saved = window.sessionStorage.getItem(KEY);
      if (saved) list = parseExperiments(saved);
    } catch {
      /* 없음 */
    }
  }
  return new Set(list ?? []);
}

/** 이 이름의 실험이 켜져 있는가 */
export const experiment = (name: string): boolean => (active ??= load()).has(name);

/** 켜진 실험 이름들 — 진단 줄에 적는다 */
export const activeExperiments = (): string[] => [...(active ??= load())];
