/**
 * 전시관 사진 — **서버 폴더의 파일과 목록(index.json)이 맞는가, 저장이 안전한가.**
 *
 * 사진은 브라우저 저장본이 아니라 `public/car-photos/` 에 있다(economy/carPhotos.ts).
 * 목록에 없는 파일은 화면에 안 나오고, 파일이 없는 목록 항목은 깨진 그림이 된다 —
 * 둘 다 전시관을 열어 봐야 드러나는 종류라 여기서 막는다.
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleCarPhoto, readManifest } from '../server/carPhotoHandler.mjs';
import { CARS } from '../src/economy/cars';
import { carPhotoUrl, ensureCarPhotos, loadCarPhotos, parseManifest } from '../src/economy/carPhotos';
import { load } from '../src/economy/save';

const DIR = join(__dirname, '..', 'public', 'car-photos');
const IDS = CARS.map((c) => c.id);

/** 가장 작은 JPEG 머리 — 핸들러는 SOI(FF D8)까지만 본다 */
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;

describe('public/car-photos — 목록과 파일', () => {
  it('목록의 모든 차에 사진 파일이 있고, 모든 사진 파일이 목록에 있다', async () => {
    const manifest = parseManifest(JSON.parse(await readFile(join(DIR, 'index.json'), 'utf8')));
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4));
    expect(Object.keys(manifest).sort()).toEqual(files.sort());
  });

  it('카탈로그의 아홉 대 모두 사진이 있다', async () => {
    const manifest = await readManifest(DIR);
    expect(Object.keys(manifest).sort()).toEqual([...IDS].sort());
  });
});

describe('parseManifest — 손으로 고친 목록을 거른다', () => {
  it('숫자 버전과 안전한 id 만 남긴다', () => {
    expect(parseManifest({ avante: 1, '../x': 2, k5: 'a', m5: Number.NaN })).toEqual({ avante: 1 });
  });

  it('객체가 아니면 빈 목록이다', () => {
    expect(parseManifest(null)).toEqual({});
    expect(parseManifest([1, 2])).toEqual({});
  });

  it('목록을 받기 전에는 어느 차에도 사진 주소가 없다', () => {
    expect(carPhotoUrl('avante')).toBeNull();
  });
});

describe('handleCarPhoto — 서버에 쓰기', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'car-photos-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('사진 파일을 쓰고 목록에 버전을 남긴다', async () => {
    const out = await handleCarPhoto({ id: 'avante', dataUrl: JPEG }, { dir, ids: IDS });
    expect(out.status).toBe(200);
    expect((await readFile(join(dir, 'avante.jpg')))[0]).toBe(0xff);
    const manifest = await readManifest(dir);
    expect(manifest.avante).toBe((out.body as { version: number }).version);
  });

  it('덮어쓰면 버전이 바뀐다 — 브라우저가 옛 사진을 캐시에서 꺼내면 안 된다', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      await handleCarPhoto({ id: 'k5', dataUrl: JPEG }, { dir, ids: IDS });
      vi.setSystemTime(2000);
      await handleCarPhoto({ id: 'k5', dataUrl: JPEG }, { dir, ids: IDS });
    } finally {
      vi.useRealTimers();
    }
    expect((await readManifest(dir)).k5).toBe(2000);
  });

  it('다른 차의 목록 항목을 지우지 않는다', async () => {
    await handleCarPhoto({ id: 'avante', dataUrl: JPEG }, { dir, ids: IDS });
    await handleCarPhoto({ id: 'm5', dataUrl: JPEG }, { dir, ids: IDS });
    expect(Object.keys(await readManifest(dir)).sort()).toEqual(['avante', 'm5']);
  });

  it('카탈로그에 없는 id 는 받지 않는다 — 파일 이름이 되는 값이다', async () => {
    for (const id of ['../../evil', 'nope', 42]) {
      const out = await handleCarPhoto({ id, dataUrl: JPEG }, { dir, ids: IDS });
      expect(out.status).toBe(400);
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('JPEG 이 아니면 받지 않는다', async () => {
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50]).toString('base64')}`;
    const fake = `data:image/jpeg;base64,${Buffer.from('hello').toString('base64')}`;
    for (const dataUrl of [png, fake, '', undefined]) {
      const out = await handleCarPhoto({ id: 'avante', dataUrl }, { dir, ids: IDS });
      expect(out.status).toBe(400);
    }
  });
});

describe('예전 저장본의 사진', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('load() 가 버린다 — 쓰지 않는 data URL 이 localStorage 를 차지하면 안 된다', () => {
    const stored = JSON.stringify({
      version: 10,
      money: 77,
      carPhotos: { avante: 'data:image/jpeg;base64,AAAA' },
    });
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: () => undefined });
    const out = load();
    // 저장본을 실제로 읽었는지부터 본다 — 읽다 실패하면 기본 저장본이 나와 아래가 저절로 참이 된다
    expect(out.money).toBe(77);
    expect('carPhotos' in out).toBe(false);
  });
});

/**
 * **켤 때 목록을 못 받았으면 다시 받는다.** 한 번만 받고 말았더니, 서버가 재시작 중이던
 * 순간에 켜진 탭은 새로고침하기 전까지 전시관에 사진이 하나도 나오지 않았다.
 */
describe('사진 목록 다시 받기', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('처음에 실패해도 화면을 열 때 다시 받아 사진을 채운다', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('서버 재시작 중'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ avante: 7 }) } as Response);
    });
    expect(await loadCarPhotos()).toBe(false);
    expect(carPhotoUrl('avante')).toBeNull();

    const redrawn = await new Promise<boolean>((resolve) => {
      ensureCarPhotos(() => resolve(true));
      setTimeout(() => resolve(false), 1000);
    });
    expect(redrawn, '받아 오면 화면을 다시 그리게 한다').toBe(true);
    expect(carPhotoUrl('avante')).toBe('car-photos/avante.jpg?v=7');
  });

  it('이미 받았으면 다시 받지 않는다', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });
    ensureCarPhotos(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });
});
