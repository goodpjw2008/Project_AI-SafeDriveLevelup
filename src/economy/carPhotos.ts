/**
 * 전시관 대표 사진 — **서버의 `car-photos/` 폴더에서 읽고, 등록하면 서버에 쓴다.**
 *
 * ## 왜 브라우저에 두지 않는가
 *
 * 예전에는 등록한 사진을 저장본(localStorage)에 data URL 로 넣었다. 그 저장소는
 * **브라우저 × 주소**마다 따로라서, 서버를 다른 장비로 옮기거나 다른 IP 로 접속하는
 * 순간 사진이 하나도 없는 것처럼 보였다. 소스를 통째로 복사해도 따라오지 않는다.
 * 게다가 5MB 한도를 진행 기록과 나눠 써서 사진을 640×480 으로 뭉개야 했다.
 *
 * 지금은 사진이 프로젝트의 `public/car-photos/<차 id>.jpg` 에 파일로 있다.
 * 어떤 차에 사진이 있는지는 `index.json`(차 id → 버전)이 말한다 — 파일을 하나씩 찔러
 * 보면 없는 차마다 404 가 콘솔에 찍힌다.
 *
 * ## 읽기와 쓰기
 *
 *  - 읽기: 켤 때 `loadCarPhotos()` 로 목록을 받고, 못 받았으면 첫 화면·전시관을 열 때
 *    다시 받는다(`ensureCarPhotos`). 정적 파일이라 개발 서버 ·
 *    `vite build` 결과물 어디서나 된다. 단일 파일 빌드(`file://`)에서는 받지 못하는데,
 *    그때는 사진이 없는 것으로 보고 구운 3D 그림(carThumb.ts)으로 간다.
 *  - 쓰기: `uploadCarPhoto()` 가 `/api/car-photo` 로 보낸다(server/carPhotoHandler.mjs).
 *    파일을 써야 하므로 **개발 서버에서만** 된다.
 *
 * 새 사진 파일을 손으로 넣었다면 index.json 에도 id 를 적어야 보인다 —
 * tests/carPhotos.test.ts 가 목록과 파일이 맞는지 본다.
 */

/** 사진 폴더 — 페이지 기준 상대 경로다 (vite 의 `base: './'`, 차 모델의 `models/` 와 같다) */
const PHOTO_DIR = 'car-photos';

/**
 * 목록을 기다리는 한도. 첫 화면은 이것을 기다렸다 그리므로, 서버가 멈춰 있으면 화면이
 * 같이 멈춘다. 넘기면 사진 없이 그린다.
 */
const LOAD_TIMEOUT_MS = 2000;

/** 다시 받을 때의 한도 — 화면이 이미 떠 있으므로 느린 원격 접속도 기다려 준다 */
const RETRY_TIMEOUT_MS = 8000;

/** 차 id → 버전(저장 시각 ms). 버전을 주소에 붙여, 사진을 바꾸면 캐시가 아닌 새 것을 받는다 */
let versions: Record<string, number> = {};

/**
 * 목록을 **실제로 받아 왔는가.**
 *
 * 켤 때 한 번만 받고 말았더니, 그 순간 서버가 재시작 중이었거나 원격 접속이 느려 한도 안에
 * 못 받으면 **"사진 없음" 으로 굳었다** — 새로고침하기 전까지 전시관에 사진이 안 나왔다.
 * 못 받았으면 화면을 열 때마다 다시 받는다 (`ensureCarPhotos`).
 */
let loaded = false;
let inflight: Promise<boolean> | null = null;

/** 목록 JSON 을 믿지 않고 거른다 — 손으로 고친 파일일 수 있다 */
export function parseManifest(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (/^[a-z0-9-]+$/.test(id) && typeof v === 'number' && Number.isFinite(v)) out[id] = v;
  }
  return out;
}

/**
 * 서버에서 사진 목록을 받는다. **받았으면 true.** 실패해도 던지지 않는다 — 사진이 없다고
 * 게임이 막히면 안 된다.
 *
 * @param timeoutMs 기다리는 한도. 켤 때는 첫 화면을 붙잡고 있으므로 짧게, 다시 받을 때는
 *                  화면이 이미 떠 있으므로 넉넉하게 준다.
 */
export async function loadCarPhotos(timeoutMs: number = LOAD_TIMEOUT_MS): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${PHOTO_DIR}/index.json`, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) return false;
      versions = parseManifest(await res.json());
      loaded = true;
      return true;
    } catch {
      /* 못 받았다 — 다음에 화면을 열 때 다시 받는다 */
      return false;
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * **아직 목록을 못 받았으면 다시 받는다.** 새로 받아 왔으면 `onLoaded` 를 불러 화면을
 * 다시 그리게 한다 — 이미 받아 두었으면 아무 일도 하지 않는다.
 */
export function ensureCarPhotos(onLoaded: () => void): void {
  if (loaded) return;
  void loadCarPhotos(RETRY_TIMEOUT_MS).then((ok) => {
    if (ok) onLoaded();
  });
}


/** 그 차의 사진 주소. 없으면 null */
export function carPhotoUrl(id: string): string | null {
  const v = versions[id];
  return v === undefined ? null : `${PHOTO_DIR}/${id}.jpg?v=${v}`;
}

export function hasCarPhoto(id: string): boolean {
  return versions[id] !== undefined;
}

/**
 * 사진을 서버에 저장한다. 실패하면 **사람이 읽을 이유**를 담아 던진다.
 *
 * 성공한 뒤에야 목록을 고친다 — 먼저 고치면 저장에 실패해도 화면에는 바뀐 것처럼 보이다가
 * 새로고침하면 사라진다.
 */
export async function uploadCarPhoto(id: string, dataUrl: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/car-photo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, dataUrl }),
    });
  } catch {
    throw new Error('서버에 연결하지 못했습니다.');
  }

  if (res.status === 404 || res.status === 405) {
    throw new Error('이 서버는 사진 저장을 지원하지 않습니다. 개발 서버(./manage.sh start)에서 등록해 주세요.');
  }
  const body = (await res.json().catch(() => null)) as
    | { version?: unknown; detail?: unknown }
    | null;
  if (!res.ok || typeof body?.version !== 'number') {
    const why = typeof body?.detail === 'string' ? ` (${body.detail})` : '';
    throw new Error(`서버가 사진을 저장하지 못했습니다${why}.`);
  }
  versions = { ...versions, [id]: body.version };
}
