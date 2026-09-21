/**
 * `/api/car-photo` — 전시관 대표 사진을 **서버 폴더에 저장한다.**
 *
 * 예전에는 사진을 브라우저 localStorage 에 넣었다. 그러면 사진이 **그 브라우저·그 주소에만**
 * 남는다 — 서버를 다른 장비로 옮기거나 다른 주소(IP)로 접속하면 전시관이 통째로 비어
 * 보인다. 실제로 맥에서 리눅스 장비로 옮기면서 그렇게 됐다.
 *
 * 지금은 `public/car-photos/<차 id>.jpg` 에 파일로 두고, 어떤 사진이 있는지는 같은 폴더의
 * `index.json`(차 id → 버전)이 말한다. 파일이 프로젝트 안에 있으므로 폴더째 옮기면 사진도
 * 따라가고, `vite build` 가 public/ 을 그대로 복사하므로 정적 배포에서도 보인다.
 *
 * **버전은 저장한 시각(ms)이다.** 같은 이름으로 덮어쓰면 브라우저가 캐시한 옛 사진을 계속
 * 보여 주므로, 클라이언트는 `<id>.jpg?v=<버전>` 으로 부른다.
 *
 * 받는 것은 브라우저가 줄여 놓은 JPEG data URL 이다(ui/Screens.ts 의 shrinkImage).
 * 저장은 개발 서버(vite.config.ts)에서만 된다 — 서버리스 배포에는 쓸 수 있는 디스크가 없다.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MANIFEST = 'index.json';

/** 줄인 사진은 수백 KB 다. 이보다 크면 우리가 보낸 것이 아니다 */
const MAX_BYTES = 4 * 1024 * 1024;

const DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;

/**
 * @param {unknown} body `{ id, dataUrl }`
 * @param {{ dir: string, ids: readonly string[] }} opts 저장 폴더 · 카탈로그의 차 id 목록
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleCarPhoto(body, { dir, ids }) {
  if (!body || typeof body !== 'object') return bad('본문이 없음');

  /*
    id 는 **카탈로그에 있는 것만** 받는다. 파일 이름이 되는 값이라, 아무 문자열이나 받으면
    `../` 로 폴더 밖에 쓸 수 있다.
  */
  const { id, dataUrl } = /** @type {{ id?: unknown, dataUrl?: unknown }} */ (body);
  if (typeof id !== 'string' || !ids.includes(id)) return bad('id: 없는 차');
  if (typeof dataUrl !== 'string') return bad('dataUrl: 문자열이 아님');

  const m = DATA_URL.exec(dataUrl);
  if (!m) return bad('dataUrl: JPEG data URL 이 아님');
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return bad('사진 크기가 범위를 벗어남');
  // 머리표(SOI)까지 본다 — 형식 표기만 jpeg 이고 속은 다른 것일 수 있다
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bad('JPEG 파일이 아님');

  try {
    await mkdir(dir, { recursive: true });
    await writeAtomic(join(dir, `${id}.jpg`), bytes);

    const manifest = await readManifest(dir);
    const version = Date.now();
    manifest[id] = version;
    await writeAtomic(join(dir, MANIFEST), `${JSON.stringify(sorted(manifest), null, 2)}\n`);

    return { status: 200, body: { id, version } };
  } catch (e) {
    return { status: 500, body: { error: 'WRITE_FAILED', detail: String(e?.message ?? e) } };
  }
}

/** 목록을 읽는다. 없거나 깨졌으면 빈 목록 — 사진 하나 올리는 일이 막히면 안 된다 */
export async function readManifest(dir) {
  try {
    const parsed = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 임시 파일에 다 쓴 뒤 이름을 바꾼다. 쓰는 도중에 누가 읽으면 반쯤 쓴 사진이나
 * 반쯤 쓴 JSON 을 받는데, 이름 바꾸기는 한 번에 일어난다.
 */
async function writeAtomic(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** 키 순서를 고정한다 — 저장할 때마다 순서가 바뀌면 파일 비교가 시끄럽다 */
function sorted(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

function bad(detail) {
  return { status: 400, body: { error: 'BAD_INPUT', detail } };
}
