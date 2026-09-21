import { fileURLToPath } from 'node:url';

import { defineConfig, loadEnv, type Plugin } from 'vite';

import { handleCarPhoto } from './server/carPhotoHandler.mjs';
import { handleCoach } from './server/coachHandler.mjs';
import { handleRecommend } from './server/recommendHandler.mjs';
import { handleReport } from './server/reportHandler.mjs';
import { handleScenario } from './server/scenarioHandler.mjs';
import { handleStatsRead, handleStatsWrite } from './server/statsHandler.mjs';
import { APP_DESCRIPTION, APP_ICON_SVG, APP_NAME, APP_TAGLINE } from './src/brand';
import { CARS } from './src/economy/cars';

/** 전시관 대표 사진을 저장하는 폴더 (server/carPhotoHandler.mjs) */
const CAR_PHOTO_DIR = fileURLToPath(new URL('./public/car-photos', import.meta.url));

/** 요청 본문 한도. 가장 큰 것이 사진(수백 KB)이다 — 이보다 크면 받지 않고 끊는다 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * HTML 안의 `{{APP_NAME}}` 같은 자리를 brand.ts 의 값으로 채운다.
 *
 * 이름은 한 곳(src/brand.ts)에서만 정하는데, 브라우저 탭 제목과 공유용 설명은
 * **자바스크립트가 돌기 전에** 정해져 있어야 한다 — 링크 미리보기를 만드는 쪽은
 * 스크립트를 돌리지 않으므로, 화면을 그린 뒤 `document.title` 을 바꿔치기하면
 * 빈 제목을 읽어 간다. 그래서 빌드 시점에 끼워 넣는다.
 *
 * **탭 아이콘도 여기서 넣는다.** 그림 파일을 그대로 가리키면 단일 파일 빌드에서
 * 깨지므로(그 파일은 바깥 것을 하나도 참조하지 않아야 한다) base64 로 심는다.
 * index.html 에 base64 를 손으로 적어 두지 않는 이유는, 로고를 바꿀 때마다 사람이
 * 그 긴 문자열을 다시 만들어 붙여야 하기 때문이다 — 파일만 갈아 끼우면 되게 한다.
 *
 * 개발 서버와 프로덕션 빌드 양쪽에서 똑같이 동작한다.
 */
function brandHtml(): Plugin {
  return {
    name: 'turn-right-brand-html',
    transformIndexHtml(html) {
      /*
        아이콘은 **그릴 때마다 읽는다.** 모듈을 불러올 때 한 번만 읽으면 개발 서버를
        띄워 둔 채 그림을 갈아 끼웠을 때 옛 아이콘이 계속 나온다.
      */
      const values: Record<string, string> = {
        APP_NAME,
        APP_TAGLINE,
        APP_DESCRIPTION,
        /*
          아이콘은 **SVG 를 그 자리에서 만든다** (brand.ts 의 APP_ICON_SVG) — 그림 파일을 읽던 때와 달리
          크기마다 흐려지지 않고, 색이 이름의 딱지와 늘 같다.

          **base64 로 싣는다.** 날것으로 넣으면 `<`, 따옴표, 공백이 섞여 브라우저가 data URI 를 읽지 못한다
          (실제로 그렇게 넣었더니 아이콘이 아예 안 그려졌다). base64 는 그런 글자가 없어 HTML 속성 안에서도
          그대로 살아남는다 — 500바이트 남짓이라 길이도 문제가 아니다.
        */
        APP_ICON: `data:image/svg+xml;base64,${Buffer.from(APP_ICON_SVG, 'utf8').toString('base64')}`,
      };
      return html.replace(
        /\{\{(APP_NAME|APP_TAGLINE|APP_DESCRIPTION|APP_ICON)\}\}/g,
        (_, key: string) => escapeHtml(values[key]),
      );
    },
  };
}

/** 이름에 `&` 나 따옴표가 들어가도 마크업이 깨지지 않게 한다 (meta 속성 안에도 들어간다) */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * 개발 서버의 `/api/*` — 배포된 서버리스 함수와 **같은 일**을 한다.
 *
 * 로직은 server/ 아래 한 곳에 있고 여기는 껍데기다 (Node 의 req/res 를 벗겨 JSON 을
 * 꺼내고, 결과를 다시 씌운다). 배포 쪽 껍데기는 functions/api/*.js 다.
 *
 * **키는 `.env` 에서 읽고 브라우저로는 나가지 않는다.** `loadEnv` 를 접두사 없이(`''`)
 * 부르는 이유가 이것이다 — Vite 가 클라이언트 번들에 넣어 주는 것은 `VITE_` 로 시작하는
 * 변수뿐이라, 키(`GEMINI_API_KEY` · `GROQ_API_KEY` · `OPENAI_API_KEY`)는 이렇게 서버 쪽에서 직접 읽어야 한다.
 * 어느 곳을 쓸지는 server/llm.mjs 가 정한다 — 키를 넣은 곳을 돌아가며 부른다. 뒤집어 말하면
 * **이 변수 이름에 `VITE_` 를 붙이는 순간 키가 번들에 박힌다.**
 */
type ApiHandler = (
  body: unknown,
  env: Record<string, string>,
) => Promise<{ status: number; body: object }>;

function devApi(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '');
  const carIds = CARS.map((c) => c.id);
  const routes: Record<string, ApiHandler> = {
    '/api/coach': handleCoach,
    '/api/report': handleReport,
    '/api/scenario': handleScenario,
    '/api/recommend': handleRecommend,
    // 안전운전 성공 · 실패 횟수 — 판 표 받기 · 내기 (읽기는 아래 GET 이 따로 받는다)
    '/api/stats': (body) => handleStatsWrite(body, env),
    // 배포 쪽 껍데기가 없다 — 사진을 파일로 쓰는 일이라 디스크가 있는 이 서버에서만 된다
    '/api/car-photo': (body) => handleCarPhoto(body, { dir: CAR_PHOTO_DIR, ids: carIds }),
  };

  return {
    name: 'turn-right-dev-api',
    configureServer(server) {
      // 안전운전 횟수 읽기 — 이 하나만 GET 이다 (배포에서는 가장자리에 잠깐 담아 둔다 — api/stats.js)
      server.middlewares.use('/api/stats', (req, res, next) => {
        if (req.method !== 'GET') return next();
        void handleStatsRead(env).then(({ status, body }) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        });
      });
      for (const [path, handler] of Object.entries(routes)) {
        server.middlewares.use(path, (req, res, next) => {
          if (req.method !== 'POST') return next();

          const chunks: Buffer[] = [];
          let size = 0;
          req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) {
              res.statusCode = 413;
              res.end();
              req.destroy();
              return;
            }
            chunks.push(c);
          });
          req.on('end', () => {
            void (async () => {
              let parsed: unknown = null;
              try {
                parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              } catch {
                /* 핸들러가 BAD_INPUT 으로 답한다 */
              }
              const { status, body } = await handler(parsed, env);
              res.statusCode = status;
              res.setHeader('content-type', 'application/json; charset=utf-8');
              res.end(JSON.stringify(body));
            })();
          });
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [brandHtml(), devApi(mode)],
  // 빌드 원본(HTML 템플릿)은 src/index.html 이다.
  // 프로젝트 루트의 index.html 은 build:standalone 이 만들어 내는 '실행 가능한 게임 파일'이라,
  // 원본을 루트에 두면 서로 덮어쓰게 된다.
  root: 'src',
  publicDir: '../public',
  base: './',
  server: { host: true, port: 5173 },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    /*
      `src/assets/` 아래의 그림은 **크기와 상관없이 번들 안에 데이터로 넣는다.**

      단일 파일 빌드(index.html 하나로 `file://` 실행)가 이 프로젝트의 배포 방식 중
      하나다. 그 파일은 바깥 파일을 하나도 참조하지 않아야 하는데, 빌드 스크립트는
      스크립트만 인라인하므로 그림이 따로 떨어져 나가면 그 파일에서 깨진다.

      기본값(4KB)에 기대지 않는 이유: 로고를 조금 더 크게 굽는 순간 조용히 별도
      파일로 떨어져 나가고, 그 사실은 단일 파일을 열어 봐야 드러난다.

      `undefined` 를 돌려주면 그 밖의 것은 기본 규칙을 그대로 따른다.
      (Vite 5 에는 `?inline` 쿼리가 없다 — 6 부터다. 그래서 여기서 정한다)
    */
    assetsInlineLimit: (filePath) =>
      /[\\/]src[\\/]assets[\\/]/.test(filePath) ? true : undefined,
  },
}));
