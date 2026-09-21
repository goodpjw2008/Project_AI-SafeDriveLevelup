/**
 * carPhotoHandler.mjs 의 타입 — tests/ 가 TypeScript 에서 부르기 위해 둔다.
 */

export declare const MANIFEST: string;

export declare function handleCarPhoto(
  body: unknown,
  opts: { dir: string; ids: readonly string[] },
): Promise<{ status: number; body: object }>;

export declare function readManifest(dir: string): Promise<Record<string, number>>;
