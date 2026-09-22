/**
 * 메뉴 · 차량 선택 · 브리핑 · 디브리핑 · 도움말 · 설정 화면.
 *
 * 디브리핑이 이 게임의 핵심 화면이다. 위반 하나하나에 조문 원문을 붙여 보여줘서
 * "감으로 아는 것"을 "근거로 아는 것"으로 바꾸는 것이 목표다.
 */

import {
  APP_AUTHOR,
  APP_CONTACT,
  APP_COPYRIGHT_YEAR,
  APP_NAME_PARTS,
  APP_TAGLINE,
  APP_TAGLINE_PARTS,
  APP_USAGE,
} from '../brand';
import robotNormal from '../assets/airobot/normal.webp';
import robotStop from '../assets/airobot/stop.webp';
import robotTurn from '../assets/airobot/turnlight.webp';
import { fetchCoaching, fetchHabitReport, toCoachRequest } from '../coach/client';
import { MIN_RUNS, summarize, weakestPoint, type HabitSummary } from '../coach/habits';
import { CARS_BY_LEVEL, getCar, isCarUnlocked, type CarSpec } from '../economy/cars';
import { hasProgress, type SaveData } from '../economy/save';
import { GRADE_TEXT, type JudgeResult } from '../rules/lawRules';
import { VIOLATIONS, fineOf, penaltyPointsOf, type ViolationCode } from '../rules/violations';
import type { ViewMode } from '../game/CameraRig';
import { CAR_MODEL_CREDITS } from '../game/carModel';
import {
  BLINKER_SOUNDS,
  DEFAULT_SOUNDS,
  ENGINE_SOUNDS,
  HORN_SOUNDS,
  SOUND_CREDITS,
  type SoundChoice,
  type SoundSelection,
} from '../game/soundAssets';
import { carThumbnail, releaseCarThumbRenderer } from '../game/carThumb';
import { carPhotoUrl } from '../economy/carPhotos';
import {
  FRAME_CAP_CHOICES,
  PERIPHERAL_LABEL,
  RESOLUTION_CHOICES,
  TIER_LABEL,
  matchedPreset,
  presetDiff,
  type GraphicsSettings,
  type QualityTier,
} from '../game/quality';
import { SCENARIOS, stageLabel, type ScenarioSpec } from '../scenarios/scenarios';
import { libraryEntryByNumber, libraryNumber } from '../scenarios/library';
import { CHALLENGES, DEFAULT_CHALLENGE, challengeRule, type Challenge } from '../scenarios/challenge';
import type { GeneratedScenario } from '../scenarios/generate';
import {
  LEVELS,
  MAX_LEVEL,
  courseTitle,
  levelLabel,
  levelTier,
  unlockedLevel,
  xpToNext,
  type CurriculumState,
  type Difficulty,
  type XpStep,
} from '../scenarios/curriculum';
import { levelBadge, masterBadge } from './badges';
import { playerCard } from './playerCard';
import { badgeCollection, badgeStrip, badgeSummary } from './badgeArt';
import type { BadgeEvent } from '../economy/badges';
import { AI_BADGE_HTML, BRAND_CHIPS_HTML, withAiBadge } from './brandName';
import type { SiteStats } from '../siteStats';
import { advisedBy } from './pickedBy';
import type { Picker } from '../scenarios/recommend';
import {
  HABIT_CLEARED_AFTER,
  habitTitle,
  runsToClear,
  type BadHabit,
  type HabitChange,
} from '../coach/badHabits';
import { drawRunMap } from './RunMap';
import { icon } from './icons';

export type ScreenId =
  | 'menu'
  | 'shop'
  | 'debrief'
  | 'help'
  | 'credits'
  | 'about'
  | 'settings'
  | 'report'
  | 'trial'
  | 'badges'
  | 'none';

const $ = (id: string) => document.getElementById(id)!;

/**
 * 등록 사진을 줄여 넣을 최대 크기 — 카드가 4:3 으로 보여 주므로 이 비율로 자른다.
 *
 * 예전에는 localStorage 한도 때문에 640×480 이었다. 사진이 서버 파일로 옮겨 가면서
 * (economy/carPhotos.ts) 그 제약이 없어져, 훈련 화면의 373px 칸이 레티나에서도 또렷한
 * 1280×960 으로 올렸다.
 */
const PHOTO_MAX = { w: 1280, h: 960 };

/**
 * 고른 이미지를 **카드 크기에 맞게 줄여** JPEG data URL 로 만든다.
 *
 * 원본을 그대로 올리지 않는 이유: 요즘 사진은 한 장에 3~8MB 라 전시관을 열 때마다 아홉 장을
 * 그대로 받게 된다. 1280×960 JPEG 로 줄이면 한 장에 수백 KB 다.
 *
 * 4:3 로 잘라 넣는 이유는 카드가 그 비율로 보여 주기 때문이다 — 여기서 잘라 두지 않으면
 * 세로 사진이 카드에서 가운데만 크게 잘려 무슨 차인지 안 보인다.
 */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = PHOTO_MAX.w;
      canvas.height = PHOTO_MAX.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas'));
        return;
      }
      // 비율을 지키며 가득 채우고 넘치는 쪽을 잘라 낸다 (object-fit: cover 와 같은 규칙)
      const scale = Math.max(PHOTO_MAX.w / img.width, PHOTO_MAX.h / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (PHOTO_MAX.w - w) / 2, (PHOTO_MAX.h - h) / 2, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    img.src = url;
  });
}

/**
 * 프리셋이 하나도 켜지지 않았을 때 오른쪽에 적는 말 — **무엇이 어긋났는지까지** 말한다.
 *
 * "사용자 지정" 한 마디로는, 네 항목이 '낮음' 인데 해상도 하나 때문에 풀린 것인지 정말 섞어 고른 것인지 알 수 없다.
 * 어긋난 항목 이름은 아래 줄들의 이름과 같아서 바로 찾아 고칠 수 있다 (quality.ts 의 presetDiff).
 */
function customNote(g: GraphicsSettings): string {
  const diff = presetDiff(g);
  if (!diff) return '사용자 지정';
  return `사용자 지정 · '${TIER_LABEL[diff.tier]}'에서 ${diff.fields.join(' · ')} 다름`;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** 위반 번호를 지도 핀과 같은 모양으로 쓰기 위한 원문자 */
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

const FAIL_REASON: Record<string, string> = {
  PEDESTRIAN_HIT: '보행자를 치었습니다.',
  VEHICLE_COLLISION: '다른 차량과 충돌했습니다.',
  OFF_ROAD: '도로를 벗어났습니다.',
  TIMEOUT: '시간이 초과되었습니다.',
};

/** index.html 에 있는 화면 컨테이너 — 하나를 추가하면 여기에도 넣는다 */
/**
 * **AI 의 평가를 목록으로 그린다.**
 *
 * 코치는 개조식으로 답한다 — `- ` 로 시작하는 2~4줄 (server/coachPrompt.mjs). 줄글로 이어 붙이면 눈에 들어오지
 * 않는다는 사용자의 말이 이 형식의 이유다. 여기서는 그 줄들을 `<li>` 로 옮겨, 줄마다 점을 찍고 들여쓴다.
 *
 * **모델이 형식을 안 지켜도 깨지지 않는다.** `- ` 로 시작하는 줄이 하나도 없으면 문단 그대로 보여 준다 —
 * 모델의 답은 늘 그럴 수 있고, 그때 화면이 비어 보이면 안 된다.
 */
export function coachLines(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // 한 줄이라도 `- ` 로 시작하면 개조식으로 답한 것이다 — 그때는 **모든 줄**을 항목으로 옮긴다
  if (!lines.some((l) => l.startsWith('- '))) return esc(text);
  /*
    말머리가 빠진 줄도 버리지 않는다. 실제로 한 모델이 마지막 줄만 `- ` 없이 답했는데, 그 줄만 걸러 내니
    화면에서 통째로 사라졌다 — 모델이 형식을 반만 지켜도 **말은 다 보여야 한다.**
  */
  const items = lines.map((l) => (l.startsWith('- ') ? l.slice(2).trim() : l));
  return `<ul class="coach-list">${items.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
}

/**
 * **AI 코치의 답을 못 받았을 때 판정 기록으로 쓰는 코칭** — `- ` 로 시작하는 2~3줄 (coachLines 가 그대로 그린다).
 *
 * 예전에는 답을 못 받으면 칸을 통째로 지웠다. 그랬더니 사용자가 "AI 답변이 나오지 않고 카운트다운이 나왔어" 라고
 * 짚었다 — 늘 있던 칸이 말없이 사라지면 고장처럼 보인다. 그래서 칸을 남기고 **AI 글이 아니라고 밝힌 뒤**(loadCoaching)
 * 판정이 이미 아는 것으로 짧게 정리한다: 완주 못 한 까닭, 위반마다 고치는 법(violations.ts 의 `fix`), 잘한 것.
 */
export function fallbackCoach(result: JudgeResult): string {
  const lines: string[] = [];
  if (result.failReason) lines.push(`${FAIL_REASON[result.failReason] ?? '완주하지 못했습니다.'} 이번 판은 끝까지 가지 못했습니다.`);
  // 같은 위반이 여러 번이어도 고치는 법은 한 번만 — 세 가지까지
  const codes = [...new Set(result.violations.map((v) => v.code))].slice(0, 3);
  for (const code of codes) lines.push(`${VIOLATIONS[code].title} — ${VIOLATIONS[code].fix}`);
  if (!lines.length) {
    lines.push('오늘 주행 — 규정을 모두 지켰습니다.');
    if (result.stats.cleanStopBeforeA) lines.push('정지선 앞에서 완전히 멈췄다가 출발했습니다.');
    if (result.stats.signalAt30m) lines.push('교차로 30m 전에 우측 방향지시등을 켰습니다.');
  }
  return lines.map((l) => `- ${l}`).join('\n');
}

const SCREEN_IDS = ['menu', 'shop', 'debrief', 'help', 'credits', 'about', 'settings', 'report', 'trial', 'badges'] as const;

/** 뒤에 있던 화면 위에 뜨는 화면 — 바깥을 누르면 닫힌다 (index.html 의 `.sheet`) */
const SHEET_IDS: ReadonlySet<ScreenId> = new Set<ScreenId>(['settings', 'credits', 'about']);

/**
 * 시작 시점 선택지.
 *
 * **기본값을 맨 앞에 둔다.** 주행 중 C 로 도는 순서(CameraRig 의 VIEW_ORDER)와는 첫 항목만
 * 다른데, 고르는 화면에서는 "무엇이 기본인가" 가 먼저 보여야 하기 때문이다.
 */
const START_VIEWS: Array<{ id: ViewMode; name: string; isDefault?: boolean }> = [
  { id: 'chase', name: '후방 시점', isDefault: true },
  { id: 'driver', name: '운전자 시점' },
  { id: 'top', name: '상공 시점' },
];

/**
 * 전시관의 **사진 등록은 개발 서버에서만** 보인다.
 *
 * 사진은 서버의 폴더(public/car-photos)에 파일로 쓰는데, 공개 배포(Vercel 등)는 서버에 파일을 쓸 수 없다 —
 * 버튼을 두면 누구나 눌러 보고 "이 서버는 사진 저장을 지원하지 않습니다" 만 받는다. 쓸 수 있다 해도 공개
 * 사이트에서 아무나 대표 사진을 바꾸는 것은 기능이 아니라 구멍이다. 사진은 개발 서버에서 등록해 커밋한다.
 */
const CAN_UPLOAD_PHOTO = import.meta.env.DEV;

/**
 * 이 프로젝트가 쓰는 오픈소스 — package.json 의 dependencies·devDependencies 와 짝을 이룬다.
 *
 * **버전은 적지 않는다.** 여기 적어 두면 package.json 을 올릴 때마다 같이 고쳐야 하는데,
 * 실제로는 잊혀서 화면에만 옛 버전이 남는다. 라이선스는 메이저 버전이 바뀌어도 잘 변하지
 * 않으므로 이름·역할·라이선스만 밝히고, 정확한 버전은 저장소의 package.json 을 보면 된다.
 */
const OSS_LIBRARIES: Array<{ name: string; role: string; license: string; url: string }> = [
  {
    name: 'three.js',
    role: '3D 렌더링 — 게임에 함께 배포되는 유일한 라이브러리입니다',
    license: 'MIT',
    url: 'https://threejs.org',
  },
  {
    name: 'Vite',
    role: '개발 서버와 번들러 (빌드 도구)',
    license: 'MIT',
    url: 'https://vite.dev',
  },
  {
    name: 'TypeScript',
    role: '타입 검사와 컴파일 (빌드 도구)',
    license: 'Apache-2.0',
    url: 'https://www.typescriptlang.org',
  },
  {
    name: 'Vitest',
    role: '판정 규칙 테스트 (개발 도구)',
    license: 'MIT',
    url: 'https://vitest.dev',
  },
  {
    name: 'glTF-Transform',
    role: '차량 3D 모델 최적화 (개발 도구)',
    license: 'MIT',
    url: 'https://gltf-transform.dev',
  },
  /*
    아래 둘은 라이브러리가 아니라 **화면에 그대로 실려 나가는 저작물**이다.
    글꼴은 이용자의 브라우저가 받아 그리고, 아이콘 도형은 번들 안에 들어간다.
    라이선스가 요구하는 표기라 라이브러리와 같은 자리에 함께 적는다.
  */
  {
    name: 'Pretendard',
    license: 'OFL-1.1',
    role: '본문 글꼴 (인터넷이 없으면 시스템 글꼴로 대체됩니다)',
    url: 'https://github.com/orioncactus/pretendard',
  },
  {
    name: 'Lucide',
    license: 'ISC',
    role: '화면 아이콘 도형',
    url: 'https://lucide.dev',
  },
];


/**
 * AI 맞춤 훈련의 지금 상태. **main.ts 가 들고 있고 화면은 받아 그리기만 한다** —
 * 생성은 비동기라 화면이 상태를 쥐면 다시 그릴 때마다 잃어버린다.
 */
/**
 * **첫 화면 맨 아래의 저작권 줄** — 사이트에서 흔한 꼴: `Copyright © 해 만든 이 · 연락처 · 이용 조건`.
 *
 * 사용자가 "카피라이트를 첫 페이지 가장 하단에 일반적인 형태로" 적어 달라고 했다 — 만든 사람, 이메일, 비영리.
 * 이메일은 누르면 바로 메일을 쓰게 `mailto:` 로 둔다. 값은 brand.ts 한 곳에서 온다 (About 창과 같이 쓴다).
 */
function siteFooter(): string {
  return `
    <footer class="site-footer">
      <span>Copyright © ${APP_COPYRIGHT_YEAR} ${esc(APP_AUTHOR)}</span>
      <span class="dot" aria-hidden="true">·</span>
      <a href="mailto:${esc(APP_CONTACT)}">${esc(APP_CONTACT)}</a>
      <span class="dot" aria-hidden="true">·</span>
      <span>${esc(APP_USAGE)}</span>
    </footer>`;
}

/**
 * AI 과정에서 한 판을 마친 뒤 단계가 어떻게 움직였는가.
 *
 * 결과 화면이 **버튼 문구와 진행 표시**를 여기서 만든다. 올라갔는지 · 그대로인지 ·
 * 내려갔는지가 다르게 읽혀야 학습자가 자기 성적을 제대로 안다.
 */
export interface CourseStep {
  /** 이 판을 마친 뒤 남아 있는 나쁜 운전 습관 */
  habits: BadHabit[];
  /** 이번 판으로 습관이 어떻게 움직였는가 (생김 · 굳음 · 고쳐짐) */
  change: HabitChange;
  /** 레벨이 올라 **새로 열린 차** — 그 차로 갈아탄 뒤다. 없으면 `null` */
  unlockedCar: { id: string; name: string; level: Difficulty } | null;
  /** 이 판을 시작할 때의 단계 */
  prevLevel: Difficulty;
  /** 이 판을 마친 뒤의 단계 */
  level: Difficulty;
  mastered: boolean;
  /** 이번 판이 경험치를 어떻게 움직였는가 (curriculum.ts 의 advance) — 결과 화면의 경험치 바가 그대로 그린다 */
  xp: XpStep;
  /**
   * 이 판을 위반 없이 통과했는가.
   *
   * 단계만으로는 알 수 없다 — **최고 단계에서는 잘해도 단계가 그대로**이기 때문이다.
   * 그때 "같은 난이도 다시" 라고 적으면 잘하고 있는 사람에게 제자리라고 말하게 된다.
   */
  clean: boolean;
}

/** 첫 화면의 두 갈래 — AI 가 기본이다 */

export interface AiTrainingState {
  /** 이번 판에서 만들어 둔 것들 (검증을 통과한 것만) */
  made: GeneratedScenario[];
  /** 만드는 중 */
  busy: boolean;
  /** 서버가 없다고 확인됐다 — 손잡이를 통째로 감춘다 */
  unavailable: boolean;
  /** 만들지 못했을 때 보여 줄 한 줄 */
  error: string | null;
  /** 지금 진행 — 저장본에서 온다 */
  curriculum: CurriculumState;
}

export interface ScreensOptions {
  /**
   * 화면을 닫고 되돌아간다 — 시트의 **바깥을 눌렀을 때** 부른다.
   *
   * 어디로 돌아가는지는 여기서 정하지 않는다. 되돌아갈 곳을 아는 것은 히스토리(nav.ts)다.
   */
  onDismiss(): void;
}

/**
 * 결과 화면의 제목 — **두 줄**이다.
 *
 * 윗줄: 판 이름과 신호 (`AI 추천 시나리오 1234 - 정면신호 적색`). 아랫줄(작은 글씨): 나머지 조건
 * (`어린이보호구역 · 첫 횡단보도 어린이 · …`). 라이브러리 판은 조건이 여럿이라 한 줄에 다 적으면
 * 등급 배지를 밀어내고 세 줄로 접혔다. 판 제목은 늘 `신호 - 조건들` 꼴이라(scenarios.ts) 첫 ' - ' 에서 가른다.
 */
function debriefTitle(sc: ScenarioSpec): { stage: string; title: string } {
  const demo = document.body.classList.contains('ai-drive');
  // 첫 화면에서 번호로 고른 판 — AI 가 고른 것이 아니므로 'AI 추천' 이라 부르지 않는다 (main.ts 의 mapTrial)
  const trial = document.body.classList.contains('map-trial');
  const n = libraryNumber(sc.id);
  const stage = demo
    ? 'AI 시범'
    : n !== undefined
      ? trial
        ? `맵 체험 ${n}`
        : `AI 추천 시나리오 ${n}`
      : stageLabel(sc.id);
  /*
    **조건 줄(둘째 줄)은 적지 않는다.** "우회전 후 건너려는 어린이 · 빗길" 처럼 판의 조건을 작은 글씨로 달아
    두었는데, 사용자가 결과 화면을 줄이면서 뺐다 — 그 조건은 달리는 동안 주행 화면 상단에서 이미 읽었고,
    끝난 뒤에 알고 싶은 것은 **무엇을 잘했고 무엇을 틀렸나**(AI 분석 · 주행 기록)다.
  */
  const cut = sc.title.indexOf(' - ');
  return { stage, title: cut < 0 ? sc.title : ` - ${sc.title.slice(0, cut)}` };
}

export class Screens {
  private current: ScreenId = 'menu';

  constructor(private opts: ScreensOptions) {
    /*
      시트의 **바깥(어두운 배경)을 누르면 닫는다.** 모달에서 사람이 가장 먼저 시도하는
      동작이고, 눌러도 아무 일이 없으면 갇힌 것처럼 느낀다.

      `e.target === el` 로 거른다 — 시트 안쪽(.screen-inner)에서 올라온 클릭은
      버블링으로 여기까지 오지만 그것으로 닫으면 안 된다.
    */
    for (const id of SHEET_IDS) {
      const el = $(`screen-${id}`);
      el.addEventListener('click', (e) => {
        if (e.target === el) this.opts.onDismiss();
      });
    }
  }

  show(id: ScreenId): void {
    /*
      **시트는 뒤에 있던 화면을 끄지 않는다.** 그것이 시트인 이유다 — 설정을 열었을 때
      첫 화면이 사라지면 전체 화면을 갈아 끼운 것과 다를 바가 없고, 닫았을 때 어디로
      돌아왔는지를 다시 알아봐야 한다.
    */
    if (SHEET_IDS.has(id)) {
      const sheet = $(`screen-${id}`);
      sheet.classList.add('active');
      sheet.scrollTop = 0;
      this.current = id;
      return;
    }

    for (const s of SCREEN_IDS) {
      $(`screen-${s}`).classList.toggle('active', s === id);
    }
    this.current = id;
    if (id !== 'none') {
      const el = document.querySelector('.screen.active');
      if (el) el.scrollTop = 0;
    }
  }

  /**
   * 화면 머리 — **나가는 문은 늘 왼쪽 위 같은 자리에 있다.**
   *
   * 예전에는 화면마다 '뒤로'가 다른 자리에 있었다(설정·도움말은 제목 아래, 전시관은 그
   * 아래 폼 뒤, 결과 화면은 맨 아래 '홈으로'). 화면을 옮길 때마다 문을 새로 찾아야 했다.
   *
   * `id` 를 받는 이유: 화면 컨테이너 여섯 개가 DOM 에 **동시에 살아 있어서**,
   * 같은 id 의 버튼이 둘이면 getElementById 가 먼저 나온 쪽을 집는다.
   */
  private head(o: {
    /** 이 화면의 이름. 뒤로 버튼 id 를 여기서 만든다. */
    id: ScreenId;
    title: string;
    /**
     * 제목 앞에 붙는 판 이름 (`Stage01`).
     *
     * 제목과 **따로 받는다.** 한 문자열로 이으면 색을 나눌 수 없다 — 주행 화면과 같은
     * 규칙으로 판 이름만 파랑, 제목은 본문색이어야 두 화면이 같은 것으로 읽힌다.
     */
    stage?: string;
    /** 제목 아래 한 줄 (HTML 그대로 들어간다 — 부르는 쪽에서 이스케이프한다) */
    sub?: string;

    /** 오른쪽에 붙일 것 (점수 표시 등) */
    right?: string;
    /** 뒤로 버튼 글자. 기본은 '뒤로' */
    backLabel?: string;
  }): string {
    return `
      <div class="screen-head">
        <button class="back" id="btn-back-${o.id}">${icon('back')}<span>${esc(
          o.backLabel ?? '뒤로',
        )}</span></button>
        <div>
          <h1>${o.stage ? `<span class="stage">${withAiBadge(esc(o.stage))}</span>` : ''}${esc(o.title)}</h1>
          ${o.sub ? `<p class="lede">${o.sub}</p>` : ''}
        </div>
        <div class="screen-head-right">${o.right ?? ''}</div>
      </div>`;
  }

  /**
   * 소리 고르기 한 줄 — 엔진음·깜빡이·크락션이 같은 모양을 쓴다.
   *
   * `prefix` 로 버튼 id 를 만든다. 세 목록의 항목 id 가 서로 달라도(e1·b1·h1) 굳이
   * 접두사를 두는 이유는, 나중에 목록이 늘면서 같은 id 가 겹쳐도 조용히 깨지지 않게
   * 하기 위해서다 — getElementById 는 먼저 나온 쪽을 집는다.
   */
  /**
   * 소리 절 전체 — **고를 것이 하나도 없으면 제목까지 뺀다.**
   *
   * 항목마다 후보를 여럿 구워 놓고 들어 본 뒤 하나만 남겨 왔다. 지금은 셋 다 하나뿐이라
   * 카드가 한 장도 그려지지 않는데, 그때 제목과 "누르면 바로 들립니다" 만 남으면
   * **누를 것이 없는데 누르라고 하는 화면**이 된다.
   *
   * 나중에 후보가 다시 늘면 그대로 살아난다 — 조건이 목록 길이 하나뿐이라서다.
   *
   * 소리 자체는 그대로 난다. 여기서 빠지는 것은 **고르는 화면**이지 소리가 아니고,
   * 출처 표기도 '오픈소스 · 저작권' 화면에 그대로 있다.
   */
  private soundSection(snd: SoundSelection): string {
    const pickers = [
      this.soundPicker('엔진음', 'eng', ENGINE_SOUNDS, snd.engine, DEFAULT_SOUNDS.engine),
      this.soundPicker('깜빡이', 'blk', BLINKER_SOUNDS, snd.blinker, DEFAULT_SOUNDS.blinker),
      this.soundPicker('크락션', 'hrn', HORN_SOUNDS, snd.horn, DEFAULT_SOUNDS.horn),
    ].join('');
    if (!pickers) return '';
    return `
      <h3 class="settings-h">소리 <span class="settings-h-note">누르면 바로 들립니다 · CC0 녹음본</span></h3>
      ${pickers}
    `;
  }

  /*
    소리 하나 — **누르면 그 자리에서 들린다.** 어떤 소리가 좋은지는 들어 봐야 아는
    것이라, 고르고 나가서 주행을 시작해 봐야 알 수 있으면 비교가 안 된다.

    항목을 **따로** 고르게 한다. 한 벌로 묶어 두면 "엔진은 3번이 좋은데 경적은 2번"
    을 만들 수 없다. 설정 화면이 한 화면에 들어오도록 한 줄짜리 버튼 묶음으로 쓰고, 고른 소리의
    성격(잰 값 — soundAssets.ts)은 이름 아래 한 줄로 적는다.
  */
  private soundPicker(
    title: string,
    prefix: string,
    list: SoundChoice[],
    current: string,
    fallback: string,
  ): string {
    // 고를 것이 없으면 고르라고 하지 않는다 — 한 장짜리 선택지는 누를 이유가 없다
    if (list.length < 2) return '';
    const now = list.find((c) => c.id === current) ?? list[0];
    return `
      <div class="opt-row">
        <div class="opt-label">
          ${esc(title)}
          <span class="opt-hint">${esc(now.character)}</span>
        </div>
        <div class="opt-choices">
          ${list
            .map(
              (c) =>
                `<button class="opt ${c.id === current ? 'on' : ''}" id="${prefix}-${c.id}" title="${esc(
                  c.character,
                )}">${esc(c.name)}${c.id === fallback ? ' ·기본' : ''}</button>`,
            )
            .join('')}
        </div>
      </div>`;
  }

  /** head() 가 그린 뒤로 버튼에 동작을 붙인다 */
  private bindBack(id: ScreenId, onBack: () => void): void {
    $(`btn-back-${id}`).addEventListener('click', onBack);
  }

  // ── 확인 창 ──────────────────────────────────────────────────────────────

  /**
   * 되돌릴 수 없는 동작 앞에서 묻는다 — **브라우저 `confirm()` 을 대신한다.**
   *
   * ## 왜 직접 그리는가
   *
   * `confirm()` 이 띄우는 것은 운영체제의 창이라 이 화면의 색·글꼴과 아무 상관이 없고,
   * 제목 줄에 주소(localhost:5173)가 붙으며, 줄바꿈과 굵기를 쓸 수 없어 "무엇이
   * 지워지는가" 를 읽기 좋게 적을 수가 없다. 부스에 세워 둔 기기에서는 그 창 하나가
   * 지금 보고 있는 것이 게임이 아니라 웹페이지라는 사실을 드러내기도 한다.
   *
   * ## 답을 기다린다
   *
   * `confirm()` 과 달리 화면을 멈추지 않으므로 **Promise 로 답을 돌려준다.** 부르는 쪽은
   * `await` 한 뒤 예전 코드 그대로 이어 쓰면 된다.
   *
   * 닫는 길이 셋이다 — 두 버튼, Esc, 바깥 클릭. 셋 다 여기서 걸고 **닫을 때 전부 푼다.**
   * 하나라도 남으면 다음에 열었을 때 예전 창의 답이 같이 돌아온다.
   *
   * **처음 놓이는 손가락은 취소 쪽이다.** 되돌릴 수 없는 쪽이 기본이 되면 Enter 한 번에
   * 기록이 사라진다 — 그래서 Enter 를 따로 잡지 않는다(취소 버튼이 그대로 받는다).
   */
  confirm(opts: {
    /** 첫 줄 — 무엇을 하려는지 */
    title: string;
    /** 그 아래 줄들. 한 줄에 한 문장씩 놓인다 */
    lines: string[];
    /** 진행 버튼 글자 (기본 '계속') */
    ok?: string;
  }): Promise<boolean> {
    const root = $('modal') as HTMLElement;
    const okBtn = $('modal-ok') as HTMLButtonElement;
    const cancelBtn = $('modal-cancel') as HTMLButtonElement;

    $('modal-title').textContent = opts.title;
    $('modal-body').innerHTML = opts.lines.map((l) => `<div>${esc(l)}</div>`).join('');
    okBtn.textContent = opts.ok ?? '계속';

    root.hidden = false;
    cancelBtn.focus();

    return new Promise<boolean>((resolve) => {
      const close = (answer: boolean): void => {
        root.hidden = true;
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        root.removeEventListener('mousedown', onOutside);
        window.removeEventListener('keydown', onKey, true);
        resolve(answer);
      };
      const onOk = (): void => close(true);
      const onCancel = (): void => close(false);
      /*
        바깥(어두운 배경)을 누르면 취소다. `e.target === root` 로 거르는 이유는 창
        안쪽에서 올라온 클릭이 버블링으로 여기까지 오기 때문이다 — 시트와 같은 규칙.
      */
      const onOutside = (e: MouseEvent): void => {
        if (e.target === root) close(false);
      };
      /*
        `capture` 로 잡아 **뒤 화면까지 내려가지 않게 한다.** 확인 창이 떠 있는 동안
        Esc 는 이 창을 닫는 뜻이지 뒤 화면을 떠나는 뜻이 아니다.
      */
      const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        close(false);
      };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      root.addEventListener('mousedown', onOutside);
      window.addEventListener('keydown', onKey, true);
    });
  }

  hideAll(): void {
    for (const s of SCREEN_IDS) {
      $(`screen-${s}`).classList.remove('active');
    }
    this.current = 'none';
  }

  get active(): ScreenId {
    return this.current;
  }

  // ── 메인 메뉴 ────────────────────────────────────────────────────────────

  /**
   * 첫 화면 오른쪽 위의 **안전운전 성공 · 실패 횟수** — 성공은 녹색, 실패는 붉은색 (사용자가 정했다).
   * 첫 화면이 떠 있지 않으면(판이 끝나 숫자가 온 사이 다른 화면으로 갔으면) 아무 일도 하지 않는다.
   */
  showSiteStats(s: SiteStats): void {
    const el = document.getElementById('site-stats');
    if (!el) return;
    const n = (v: number): string => v.toLocaleString('ko-KR');
    el.innerHTML =
      `<span class="site-stat ok">전체 안전운전 성공 : <b>${n(s.success)}</b>회</span>` +
      `<span class="site-stat bad">전체 안전운전 실패 : <b>${n(s.fail)}</b>회</span>`;
    el.setAttribute('aria-label', `이 사이트 전체의 안전운전 성공 ${n(s.success)}회, 실패 ${n(s.fail)}회`);
    el.hidden = false;
  }

  renderMenu(
    save: SaveData,
    handlers: {
      /** AI 자율 주행 시범 — 라이브러리의 대표 코스를 AI 가 차례로 규정대로 몬다 */
      onAiDrive(): void;
      onShop(): void;
      onHelp(): void;
      /** 어린이보호구역 운전 방법 — 우회전 하는 방법과 같은 꼴의 규정 요약 */
      onZoneHelp(): void;
      onCredits(): void;
      /** 이 작품을 만든 이유 — 만든 사람의 글 (renderAbout) */
      onAbout(): void;
      onSettings(): void;
      /** 습관 리포트 — 판이 MIN_RUNS 이상 쌓였을 때만 버튼이 뜬다 */
      onReport(): void;
      /** 약점에 맞춘 판을 새로 만든다 (AI 절의 버튼) */
      onGenerate(): void;
      /** 처음부터 다시 시작 — 저장된 진행을 지우고 처음부터 다시 한다 */
      onResetCourse(): void;
      /** 게임을 마친 뒤 첫 화면에서 엔딩을 다시 본다 */
      onShowEnding(): void;
      /** 맵 체험하기 창을 연다 — 시나리오 번호로 그 판을 바로 달리는 **시험용** 메뉴 (renderTrial) */
      onTrial(): void;
      /** 뱃지 모음 화면을 연다 (renderBadges) */
      onBadges(): void;
    },
    /** AI 맞춤 훈련의 지금 상태 — main.ts 가 들고 있다 */
    ai: AiTrainingState,
  ): void {
    /*
      첫 화면에는 **누를 것이 하나**라는 것이 크기로 드러나야 한다.

      예전에는 '출발'·'우회전 하는 방법'·'오픈소스 · 저작권'이 같은 크기로 한 줄에
      나란히 있었다. 셋이 대등해 보이면 처음 온 사람은 무엇부터 눌러야 할지 글을 읽어
      판단해야 한다. 지금은 출발이 히어로 안에서 혼자 크고, 나머지는 그 아래 한 단계
      낮은 줄에 모여 있다.
    */
    $('menu-body').innerHTML = `
      <!--
        **이 사이트 전체의 안전운전 성공 · 실패 횟수** — 오른쪽 위 (사용자 요청 · siteStats.ts).
        숫자가 오기 전에는 감춰 둔다 — 서버가 없는 배포에서는 끝내 뜨지 않는다 (showSiteStats).
      -->
      <div class="site-stats" id="site-stats" hidden></div>
      <!--
        히어로에는 **이름과 출발뿐이다.**

        한때 이름 아래에 규정을 설명하는 한 줄이 있었다. 뺀 이유는 첫 화면에서 읽을
        것을 만들면 누를 것이 밀리기 때문이다 — 여기서 할 일은 출발을 누르는 것이고,
        규정 설명은 그 옆의 '우회전 하는 방법'과 판을 마친 뒤의 결과 화면이 맡는다.
        (탭 제목과 공유 카드에는 brand.ts 의 부제·설명이 그대로 붙는다)
      -->
      <div class="hero">
        <!--
          **이름뿐이다.** 한때 왼쪽에 로고 그림이 붙어 있었는데, 유명한 게임 로고를
          비튼 그림이라 이 게임이 무엇을 가르치는 물건인지와 상관이 없었다.
          이름이 길어진 지금은 그 자리를 이름이 쓴다.

          **'우회전' 세 글자가 신호등의 세 등이다** — 우 적색 · 회 황색 · 전 녹색 딱지. 부제에서도 '우회전' 은 같은
          딱지 셋이고, '어린이보호구역' 은 보호구역 노면과 같은 붉은 딱지다.
          어느 글자에 무슨 색인지는 brand.ts 가 정하고, 그 색이 실제로 무엇인지는 index.html 이 정한다.
        -->
        <div class="brand-wrap">
          <h1 class="brand">${APP_NAME_PARTS.map((p) =>
            p.tone ? `<span class="brand-${p.tone}">${esc(p.text)}</span>` : esc(p.text),
          ).join('')}</h1>
          <!-- 이름이 무엇을 다루는지 같은 줄에서 넓혀 말한다 — "이름 : 부제" -->
          <span class="brand-colon" aria-hidden="true">:</span>
          <p class="brand-sub">${APP_TAGLINE_PARTS.map((p) =>
            p.tone
              ? `<span class="brand-${p.tone}">${esc(p.text)}</span>`
              : p.keep
                ? `<span class="brand-keep">${esc(p.text)}</span>`
                : esc(p.text),
          ).join('')}</p>
        </div>
        <!--
          **연습은 하나다 — AI 우회전 연습.**

          한때 '수동 우회전 연습' 탭이 있어 손으로 쓴 11판을 순서대로 돌 수 있었다. AI 가
          6천여 코스 라이브러리에서 습관에 맞는 코스를 고르고, 습관을 고쳐야 레벨이 오르게
          되면서 11판짜리 길은 할 일이 없어졌다 — 같은 상황이 라이브러리에 모두 있다.
          그 탭의 'AI 자율 주행 시범' 만 AI 절로 옮겼다 (aiTrainingSection).
        -->
      </div>

      <div class="menu-links">
        <!--
          **우회전이 먼저다** — 부제 '우회전과 어린이보호구역' 의 차례와 같게, 사용자가 이 순서로 바꿔 달라고 했다.
          부제를 읽은 눈이 그 차례대로 버튼을 만난다. (예전 이름 시절에는 그 부제의 차례를 따라 보호구역이 먼저였다.)
        -->
        <button id="btn-help">${icon('guide')}우회전 방법</button>
        <button id="btn-zone-help">${icon('guide')}어린이보호구역 운전 방법</button>
        <!--
          **판이 쌓여야 나온다.** 세 판 돌고 "당신의 습관은" 이라고 말할 수는 없다.
          그 전에 버튼을 띄워 두면 눌렀을 때 "아직 모자랍니다" 만 뜨고, 그런 버튼은
          한 번 눌러 본 사람이 다시는 안 누른다.
        -->
        ${
          save.history.length >= MIN_RUNS
            ? `<button id="btn-report">${icon('info')}내 습관</button>`
            : ''
        }
        <button id="btn-shop">${icon('store')}자동차전시관</button>
        <!-- 만든 이유 — 오픈소스 · 저작권 앞에 둔다. 누가 왜 만들었는지가 무엇을 썼는지보다 먼저다 -->
        <button class="ghost" id="btn-about">${icon('about')}About</button>
        <button class="ghost" id="btn-credits">${icon('info')}오픈소스 · 저작권</button>
        <!--
          **맵 체험하기는 여기, 설정 옆이다** — 시험용이라 첫 화면 본문에 두지 않는다. 사용자가 짚었다:
          "테스트용이기 때문에 메인 페이지에는 넣지 말고 별도 메뉴로 만들어 줘." 본문은 학습자가 누를 것
          (이어서 안전운전 연습 · 시범 · 처음부터)만 두고, 고친 판을 골라 보는 문은 About · 설정과 같은 조용한 줄에 선다.
        -->
        <button class="ghost" id="btn-trial">${icon('play')}맵 체험</button>
        <button class="icon ghost" id="btn-settings" title="설정" aria-label="설정">${icon(
          'gear',
        )}</button>
        <!--
          **운전 점수는 두지 않는다.** 한때 여기에 "내 운전점수" 를 띄웠다 — 차를 점수로 사던 때의 지갑이었다.
          차가 레벨로 열리고 레벨이 경험치로 오르게 되자(curriculum.ts 의 XP_TO_NEXT) 점수는 쓰이는 곳 없이 숫자만
          늘어, 경험치 바와 두 가지 숫자가 나란히 "얼마나 잘했나" 를 말했다. 사용자가 없애자고 했다.
        -->
      </div>

      ${this.aiTrainingSection(ai, save)}

      ${siteFooter()}
    `;

    /*
      **탭에 따라 없는 버튼이 있다.** 그래서 전부 `getElementById` 로 찾아 있을 때만 묶는다 —
      `$()` 는 없으면 던지므로, 하나라도 없으면 그 아래 묶기가 통째로 멈춘다.
    */
    const on = (id: string, fn: () => void): void =>
      void document.getElementById(id)?.addEventListener('click', fn);

    on('btn-ai-drive', handlers.onAiDrive);
    $('btn-shop').addEventListener('click', handlers.onShop);
    $('btn-help').addEventListener('click', handlers.onHelp);
    $('btn-zone-help').addEventListener('click', handlers.onZoneHelp);
    $('btn-credits').addEventListener('click', handlers.onCredits);
    $('btn-about').addEventListener('click', handlers.onAbout);
    $('btn-settings').addEventListener('click', handlers.onSettings);
    // 판이 모자라면 버튼 자체가 없다 — getElementById 로 찾아 있을 때만 묶는다
    document.getElementById('btn-report')?.addEventListener('click', handlers.onReport);

    on('btn-generate', handlers.onGenerate);
    // 지울 진행이 없으면 버튼 자체가 없다 — on() 이 없을 때는 그냥 넘어간다
    on('btn-reset-course', handlers.onResetCourse);
    on('btn-ending', handlers.onShowEnding);
    on('btn-trial', handlers.onTrial);
    on('btn-badges', handlers.onBadges);

    /*
      '지금 타는 차' 그림을 구웠다면 **여기서 렌더러를 버린다** (전시관과 같은 규칙).
      첫 화면은 배경 3D 가 이미 컨텍스트 하나를 쓰고 있어, 한 장 굽자고 두 번째
      컨텍스트를 계속 붙들고 있을 이유가 없다. 그림은 캐시에 남으므로 다시 그릴 때
      렌더러가 아예 필요 없다.
    */
    releaseCarThumbRenderer();
  }

  /**
   * AI 맞춤 훈련 — **손으로 쓴 판을 다 푼 뒤에도 계속 배울 수 있게 한다.**
   *
   * Stage 는 11개뿐이라 다 풀면 끝이다. 여기서는 지금까지의 주행 기록에서 **이 사람이
   * 무너지는 지점**을 찾아 그 상황을 다시 만든다. 상황은 AI 가 만들고, 무엇이 위반인지는
   * 여전히 규칙 엔진이 정한다 — 만들어진 판은 사람에게 오기 전에 검증기가 실제로 돌려 보고
   * "규정대로 몰면 통과하는가 · 대충 몰면 걸리는가" 를 확인한다 (scenarios/validate.ts).
   *
   * **서버가 없으면 통째로 감춘다.** 정적 호스팅·단일 파일 배포에는 `/api/scenario` 가
   * 아예 없다. 한 번 눌러 보고 없다는 것을 알면 그때부터 버튼을 지운다 — 눌러도 아무 일도
   * 안 나는 손잡이를 남겨 두지 않는다 (화질 설정에서 '듣는 손잡이만 넣는다' 와 같은 사고다).
   */
  /**
   * 지금 타는 차 — **레벨이 무엇을 내주는지가 그림으로 보인다.**
   *
   * 레벨 뱃지와 숫자만으로는 "올라가면 뭐가 좋아지는가" 에 답하지 못한다.
   * 차는 이 과정이 주는 유일한 보상이라(economy/cars.ts 의 `level`), 지금 무엇을 타고
   * 있는지가 훈련 화면에 있어야 다음 레벨이 목표로 읽힌다 — 전시관까지 들어가서
   * 확인해야 하는 보상은 훈련하는 동안 잊힌다.
   *
   * 그림은 **등록한 사진 → 구운 3D → (둘 다 없으면) 안 그림** 순이다. 전시관 카드와
   * 같은 규칙이고 같은 캐시를 쓰므로(carThumb.ts), 두 화면이 같은 차를 다르게 보여
   * 주는 일이 없고 여기서 굽는 값이 따로 들지도 않는다.
   *
   * **그림과 이름뿐이다.** 한때 '지금 타는 차' 라는 이름표와 제원 한 줄, 다음에 열릴
   * 차 이름까지 달려 있었다. 넉 줄이 붙자 옆 칸(나쁜 운전 습관)과 무게가 같아져,
   * 훈련 화면이 차를 설명하는 화면처럼 읽혔다. 제원과 다음 차는 전시관이 이미 말한다 —
   * 여기서 답해야 할 것은 "지금 무엇을 타고 있는가" 하나뿐이다.
   *
   * 그림이 아예 없으면 **줄 전체를 그리지 않는다.** WebGL 을 못 쓰는 기기에서 "사진
   * 없음" 회색 칸이 훈련 카드 한복판에 남는 것보다 없는 편이 낫다 — 전시관과 달리
   * 여기서는 사진을 등록할 수도 없어 그 빈칸이 할 말이 없다.
   */
  private activeCarStrip(save: SaveData): string {
    const car = getCar(save.activeCarId);
    const src = carPhotoUrl(car.id) ?? carThumbnail(car);
    if (!src) return '';

    return `
      <div class="ai-car">
        <img class="ai-car-photo" src="${esc(src)}" alt="지금 타는 차" />
      </div>`;
  }

  /**
   * 처음부터 다시 시작 (예전 이름: 새로운 운전자로 시작)
   *
   * 지우는 것은 저장본 전체(main.ts 의 handleResetCourse)라 AI 과정만의 버튼이 아니다.
   * AI 절에만 두면 서버가 없는 배포에서 그 절이 통째로 감춰지는데, 그때 다음 운전자가
   * 앞 운전자의 기록을 지울 방법이 사라진다 — 정작 초기화가 가장 필요한 쪽은 부스처럼
   * 여러 운전자가 번갈아 앉는 자리다.
   *
   * 한 번에 한 탭만 보이므로 화면에는 언제나 하나뿐이다.
   */
  private resetCourseButton(save: SaveData): string {
    if (!hasProgress(save)) return '';
    return `<button class="btn ghost caution" id="btn-reset-course">${icon(
      'retry',
    )}처음부터 다시 시작</button>`;
  }

  private aiTrainingSection(ai: AiTrainingState, save: SaveData): string {
    const c = ai.curriculum;
    // 오르는 데 몇 판을 이어야 하는가 — 난이도 설정이 정한다 (challenge.ts)
    const rule = challengeRule(save.settings.difficulty);

    /*
      **레벨 길** — 이 과정이 어디서 시작해 어디로 가는지를 한 줄로 보여 준다.

      한때는 계급 뱃지 넷이었다. 그림이 넷뿐이라 한 칸이 세 단계를 덮었고, 무위반으로
      통과해도 칸이 안 움직이는 판이 셋 중 둘이었다 — 길인데 걸어도 제자리였다.

      지금은 **열 칸이고 한 판에 한 칸씩 간다.** 칸이 늘어난 만큼 이름은 뺐다(계급 이름은
      애초에 넷이라 붙일 수 있었던 것이다). 남은 것은 숫자뿐인데, 그 숫자가 곧 레벨이라
      아래 줄과 같은 말을 한다.

      **마지막 칸은 닿는 것과 해내는 것이 다르다** — L10 에 올라선 것만으로는 'done' 이
      아니고, 연속 무위반을 채워야 그 자리에 선 것이 된다.
    */
    const track = LEVELS.map((l) => {
      const state =
        l.level < c.level || (l.level === MAX_LEVEL && c.mastered)
          ? 'done'
          : l.level === c.level
            ? 'now'
            : 'todo';
      return `<div class="level-step ${state}" title="${esc(levelLabel(l.level))} · ${esc(
        levelTier(l.level),
      )} (조건 ${l.budget}점)">${levelBadge(l.level, { labelled: false })}</div>`;
    }).join('') +
      /*
        **마지막 칸은 M(마스터)** — 사용자가 "1~10 단계 이후에 M 을 추가해 줘" 라고 했다. L10 을 마치면 이 칸이 '지금'
        이 되고, 그때부터는 '처음부터 다시 시작' 전까지 L10 코스가 무작위로 이어진다 (recommend.ts 의 masterPick).
      */
      `<div class="level-step master ${c.mastered ? 'now' : 'todo'}" title="마스터 — ${esc(levelLabel(MAX_LEVEL))} 코스 무작위 운행">${masterBadge({
        labelled: false,
      })}</div>`;

    const button = ai.busy
      ? `<button class="btn" id="btn-generate" disabled>다음 판을 만드는 중…</button>`
      : c.mastered
        ? /*
            **마스터 운행** — L10 코스가 무작위로 이어진다(main.ts 의 makeAiScenario). 엔딩은 옆 버튼으로 다시 본다.
            '처음부터 다시 시작' 을 누르기 전까지 이 상태가 이어진다.
          */
          `<button class="btn primary" id="btn-generate">${icon('play')}마스터 운행</button>` +
          `<button class="btn" id="btn-ending">엔딩 다시 보기</button>`
        : `<button class="btn primary" id="btn-generate">${icon('play')}${c.runs ? '이어서 안전운전 연습' : '우회전 안전운전 연습'}</button>`;

    const resetButton = this.resetCourseButton(save);

    /*
      **처음부터 다시 시작** — 이 과정의 입구다.

      마스터까지는 짧다. 그래서 한 대를 여러 운전자가 번갈아 앉는 것이 이 게임의 기본
      쓰임이고, 그때 앞 운전자의 나쁜 운전 습관이 남아 있으면 AI 가 **내 것이 아닌 판**을
      만들어 낸다 — 처음 앉은 사람이 남의 약점을 연습하게 된다.

      **훈련 버튼 옆에 둔다.** 설정 화면 깊숙이 넣으면 다음 운전자가 찾지 못하고, 찾지
      못하면 그냥 앞 운전자의 기록 위에 앉는다. 초기화가 부수 기능이 아니라 시작 방법의
      하나라는 것이 자리로 드러나야 한다.

      **다만 primary 는 아니다.** 첫 화면에서 가장 크게 눌려야 하는 것은 여전히 훈련
      시작이고, 지우는 버튼이 그만큼 커지면 실수로 누르는 쪽이 더 무섭다.
      지울 진행이 없으면 아예 그리지 않는다 — 눌러도 아무 일이 없는 손잡이는 두지 않는다.
    */

    /*
      **상자 위에 설명문을 두지 않는다.**

      한때 상자 위에 넉 줄짜리 안내가 있었다 — AI 가 습관을 기록한다는 것, L5 에서
      시작한다는 것, 레벨이 오르내린다는 것, 만들어진 판을 먼저 검증한다는 것.

      전부 맞는 말이지만 **읽을 사람이 없었다.** 여기서 할 일은 출발을 누르는 것이고,
      그 아래 상자가 이미 같은 것을 보여 준다 — 레벨 길은 오르내림을, 습관 목록은
      AI 가 무엇을 근거로 만드는지를, 판마다 붙는 `why` 한 줄은 왜 이 판인지를.
      **보여 줄 수 있는 것을 설명하면 둘 다 안 읽힌다.**
    */
    return `
      <div class="ai-course">
        <!--
          **플레이어 칸이 먼저다** (ui/playerCard.ts) — 뱃지 · 호칭 · 경험치 숫자 · 막대 · 남은 양.
          운전 화면과 결과 화면도 **같은 칸**을 크기만 바꿔 쓴다. 사용자가 짚었다 — 레벨과 경험치가 화면마다
          다른 모양이면 같은 것인지부터 헷갈린다.

          한때 이름 아래에 부제("5 / 10레벨 · 어린이보호구역 …", "다음 판은 …을 시험합니다")가 있었다.
          둘 다 이미 화면에 있는 말이라 뺐다 — 몇 레벨인지는 뱃지와 레벨 길이, 무엇을 시험할지는 바로 아래
          나쁜 운전 습관 목록이 '다음 판이 시험' 딱지로 말한다.

          **레벨 길은 아랫줄 오른쪽이다.** 첫 화면에만 있는 것이라 칸의 모양(숫자는 오른쪽 위, 막대는 그 아래)을
          흔들지 않는 자리에 붙인다. 높은 레벨일수록 여러 판을 머무르므로, 길 그림만으로는 한 판을 잘해도 달라지는
          것이 없다 — 얼마나 찼는지는 막대가 말한다.
        -->
        ${playerCard(
          {
            level: c.level,
            xp: c.xp ?? 0,
            need: xpToNext(c.level, rule),
            mastered: c.mastered,
            habitsLeft: c.badHabits.length,
          },
          'lg',
          {
            aside: `<div class="level-track" aria-label="${esc(courseTitle(c))} · ${c.level} / ${MAX_LEVEL}레벨">${track}</div>`,
          },
        )}

        <!-- 뱃지 요약 — 레벨 칸 바로 아래. 누르면 모음 화면이 열린다 (ui/badgeArt.ts) -->
        ${badgeSummary(save.badges)}

        <!--
          **지금 타는 차와 나쁜 운전 습관이 나란히 선다.**

          위아래로 쌓았을 때는 카드가 세로로 길어져, 훈련 버튼을 보려면 스크롤해야 하는
          화면이 됐다. 그보다 나쁜 것은 둘의 관계가 안 보였다는 점이다 — 습관을 고치면
          레벨이 오르고, 레벨이 오르면 차가 바뀐다. 한눈에 같이 놓이면 그 둘이
          **원인과 결과**로 읽힌다.

          차 그림이 왼쪽인 이유는 눈이 왼쪽 위에서 시작하기 때문이다. 글보다 그림이 먼저
          잡히므로, 그림을 먼저 놓고 그 옆에서 "왜 아직 이 차인가" 를 읽는 순서가 된다.
        -->
        <div class="ai-split">
          ${this.activeCarStrip(save)}
          ${this.habitList(c.badHabits, c.level, c.mastered)}
        </div>

        <!--
          **AI 자율 주행 시범** — 규정대로 몰면 어떻게 되는지를 AI 가 대표 코스로 보여 준다.
          시연에서 가장 먼저 누르는 버튼이라 훈련 버튼 옆에 두되, primary 는 훈련에 남긴다.
        -->
        <div class="ai-course-actions">${button}<button class="btn" id="btn-ai-drive">${icon(
          'auto',
        )}자율 주행</button>${resetButton}</div>
        ${ai.error ? `<p class="ai-note" style="color:var(--amber)">${esc(ai.error)}</p>` : ''}

      </div>

    `;
  }

  /**
   * 맵 체험하기 칸 — 넣는 대로 **그 판의 이름**을 보여 주고, 판이 있을 때만 '체험' 을 누를 수 있게 한다.
   *
   * 번호는 결과 화면 · 주행 화면의 "AI 추천 시나리오 57" 그 번호다 (library.ts 의 `libraryNumber`).
   * 비어 있는 번호도 있다 — 플레이테스트로 뺀 판은 **번호 자리를 비워 두고** 싣지 않는다(뒤 번호가 밀리지
   * 않게). 그런 번호는 없다고 분명히 말한다 — 아무 반응이 없으면 눌러도 되는지 알 수 없다.
   */
  private bindMapTrial(onTry: (no: number) => void): void {
    const form = document.getElementById('map-trial') as HTMLFormElement | null;
    if (!form) return;
    const input = $('map-trial-no') as HTMLInputElement;
    const button = $('btn-map-trial') as HTMLButtonElement;
    const note = $('map-trial-note');
    const read = (): number | null => {
      const n = Number(input.value);
      return input.value.trim() && Number.isInteger(n) && n > 0 ? n : null;
    };
    const update = (): void => {
      const n = read();
      const entry = n === null ? undefined : libraryEntryByNumber(n);
      button.disabled = !entry;
      note.classList.toggle('bad', n !== null && !entry);
      note.classList.toggle('ok', Boolean(entry));
      note.innerHTML =
        n === null
          ? '번호를 넣으면 여기에 그 맵의 이름이 뜹니다'
          : entry
            ? `<b>${esc(levelLabel(entry.level))}</b> · ${esc(entry.spec.title)}`
            : `${n}번 맵은 없습니다 — 번호가 너무 크거나 점검으로 뺀 자리입니다`;
    };
    input.addEventListener('input', update);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const n = read();
      if (n !== null && libraryEntryByNumber(n)) onTry(n);
    });
    update();
  }

  /**
   * **Level up!!** — 레벨이 움직인 판에만 뜨는 배너.
   *
   * ## 왜 크게 띄우는가
   *
   * 이 과정에서 가장 큰 사건인데, 예전에는 결과 화면의 한 줄짜리 칩에 `L5 → L6` 이라고
   * 적혀 있었다. 등급과 감점 사이에 묻혀서 **올랐다는 것이 보이지 않았다.**
   *
   * 게임에서 레벨이 오를 때 그러듯 띄운다. 규정을 익히러 온 사람에게도 "올랐다" 는
   * 그 순간이 다음 판을 누르게 만드는 힘이고, 이 게임에서 레벨은 곧 차이기도 하다.
   *
   * ## 내려간 것도 숨기지 않는다
   *
   * **`Level down!!` 도 같은 크기로 띄운다.** 내려간 것을 작게 적으면 무슨 일이
   * 일어났는지 모른 채 다음 판이 갑자기 쉬워진다. 다만 색이 다르다 — 오르면 녹색,
   * 내리면 **붉은색**이다. 이 화면의 황색은 '잠깐 멈춰라'(초기화 버튼)에 이미 쓰고
   * 있어서, 레벨이 내려간 것과 뜻이 겹쳤다.
   *
   * ## 한 줄이다
   *
   * 처음에는 제목·뱃지·`L5 → L6`·안내문을 넉 줄로 쌓았는데, 결과 화면에서 **한 화면을
   * 통째로 차지했다.** 정작 읽어야 할 등급과 위반 목록이 스크롤 아래로 밀렸다.
   *
   * 남긴 것은 둘이다 — **무슨 일이 일어났는가(제목)** 와 **어디서 어디로(뱃지 둘)**.
   * `L5 → L6` 은 뱃지가 이미 그리고 있고, "한 레벨 낮춰 …" 같은 안내문은 규칙을 설명하는
   * 문장이라 매 판 같은 자리에서 같은 말을 하게 된다.
   */
  /**
   * **이번 판의 경험치** — 얻은(잃은) 양과 막대. 레벨이 올랐으면 새 레벨의 빈 막대를 보여 준다.
   * 막대가 찼는데 습관이 남아 오르지 못했으면 그렇게 말한다 — 잘했는데 왜 안 오르는지 알 수 있어야 한다.
   */
  private xpResult(course: CourseStep): string {
    /*
      **이번 판에 얻은 양은 따로 적지 않는다.** 한때 상자 맨 위에 "+100 XP · 무위반으로 통과했습니다" 한 줄을
      두었는데, 사용자가 결과 화면을 줄이면서 뺐다 — 바로 위 AI 주행결과 분석이 이미 그 판이 어땠는지 말하고,
      얼마나 얻었는지는 **막대의 밝은 칸**과 숫자(100 / 300 XP)가 보여 준다. 같은 말을 세 번 할 일은 아니다.
    */
    const x = course.xp;
    return `
      <div class="player-box">
      ${playerCard(
        {
          level: course.level,
          xp: x.after,
          need: x.need,
          mastered: course.mastered,
          habitsLeft: course.habits.length,
          gained: x.leveledUp ? 0 : Math.max(0, x.gained),
        },
        'md',
        /*
          **아랫줄("Level2까지 200 XP · 새 맵 무위반 +100")은 적지 않는다** — 사용자가 결과 화면을 줄이며 뺐다.
          얼마나 남았는지는 막대와 숫자(100 / 300 XP)가 보여 주고, 다음 판 버튼에도 "Level2까지 200 XP" 가 적혀
          있다.

          **딱 한 경우만 남긴다:** 막대가 가득 찼는데 나쁜 습관이 남아 못 오른 판. 그때는 가득 찬 막대만 보이고
          레벨은 그대로여서, 이유를 적지 않으면 "왜 안 오르지?" 로 남는다 (ui/playerCard.ts 의 playerFoot).
        */
        { foot: course.habits.length > 0 && x.after >= x.need },
      )}
      </div>`;
  }

  private levelChangeBanner(course: CourseStep): string {
    const up = course.level > course.prevLevel;
    return `
      <div class="level-change ${up ? 'up' : 'down'}">
        <span class="level-change-title">${up ? 'Level up!!' : 'Level down!!'}</span>
        <!--
          뱃지 셋은 **한 덩어리로 묶는다.** 바깥 줄만 접히게 해야, 좁은 화면에서
          화살표만 남고 도착한 뱃지가 다음 줄로 떨어지는 일이 없다.
        -->
        <span class="level-change-pair">
          <span class="level-badge-wrap sm from">${levelBadge(course.prevLevel, {
            labelled: false,
          })}</span>
          <span class="level-change-arrow" aria-hidden="true">→</span>
          <span class="level-badge-wrap sm earned to">${levelBadge(course.level, {
            labelled: false,
          })}</span>
        </span>
        <!-- 낭독기에는 뱃지 대신 이 한 줄이 읽힌다 (뱃지는 aria-hidden 이다) -->
        <span class="sr-only">${esc(levelLabel(course.prevLevel))} 에서 ${esc(
          levelLabel(course.level),
        )} 로</span>
      </div>`;
  }

  /**
   * **나쁜 운전 습관 목록** — 이 기능의 심장이다.
   *
   * AI 가 무엇을 근거로 판을 만드는지가 여기서 눈에 보인다. 그냥 "AI 가 만들었습니다" 가
   * 아니라 **"당신은 이것을 세 번 저질렀고, 두 판만 더 지키면 이 습관이 사라집니다"** 라고
   * 말해 주는 자리다.
   *
   * 맨 위 하나가 다음 판이 정면으로 시험할 것이다 (badHabits.ts 의 primaryHabit).
   *
   * **비어 있을 때도 제목을 단다.** 이 목록이 지금 타는 차와 나란히 서면서(.ai-split),
   * 제목 없는 문단 하나만 놓이면 오른쪽 칸이 무엇을 말하는 자리인지 알 수 없다 —
   * 습관이 없는 것은 이 칸의 **한 상태**이지 이 칸이 없다는 뜻이 아니다.
   */
  private habitList(habits: BadHabit[], level: Difficulty, mastered = false): string {
    const wrap = (body: string): string => `
      <div class="ai-habits">
        <div class="ai-habits-title">AI 가 기록한 나쁜 운전 습관</div>
        ${body}
      </div>`;

    // 마스터 — 오를 레벨은 없고, L10 코스가 무작위로 이어진다 (마스터 운행). 새로 생긴 습관은 아래처럼 그대로 보인다
    if (mastered && !habits.length) {
      return wrap(`<div class="ai-note"><b>나쁜 운전 습관을 모두 고쳤습니다.</b> 마스터 운행에서는 ${esc(
        levelLabel(MAX_LEVEL),
      )} 코스가 무작위로 이어집니다 — <b>처음부터 다시 시작</b>을 누르기 전까지 계속됩니다.</div>`);
    }
    if (!habits.length) {
      return wrap(`<div class="ai-note">기록된 <b>나쁜 운전 습관이 없습니다.</b>
        위반하지 않으면 경험치가 쌓여 다음 레벨로 올라갑니다. 위반하면 AI 가 분석을 해서 그 습관을 고치는 맵을 추천해 줍니다.</div>`);
    }

    const rows = habits
      .map((h, i) => {
        const left = runsToClear(h);
        // 고치기까지 남은 판을 칸으로 — 채워질수록 사라짐에 가까워진다
        const pips = Array.from({ length: HABIT_CLEARED_AFTER }, (_, k) =>
          k < h.cleanRuns ? '<span class="pip on"></span>' : '<span class="pip"></span>',
        ).join('');
        return `<li class="habit ${i === 0 ? 'target' : ''}">
            <div class="habit-name">
              ${esc(habitTitle(h.code))}
              ${i === 0 ? '<span class="habit-tag">다음 판이 시험</span>' : ''}
            </div>
            <div class="habit-meta">
              ${h.count}회 저지름 · 그 상황에서 <b>${left}판</b>만 더 지키면 사라집니다
              <span class="pips" aria-label="${h.cleanRuns}/${HABIT_CLEARED_AFTER}">${pips}</span>
            </div>
          </li>`;
      })
      .join('');

    /*
      **습관이 남아 있으면 레벨이 오르지 않는다** (curriculum.ts) — 그 사실을 목록 위에서 말한다.
      말하지 않으면 무위반으로 통과하고도 제자리인 이유를 결과 화면에서야 알게 된다.
    */
    const gate =
      level < MAX_LEVEL
        ? `모두 고치면 <b>${esc(levelLabel((level + 1) as Difficulty))}</b>로 올라갑니다. AI 가 첫 번째 습관을 시험하는 코스를 추천합니다.`
        : '모두 고쳐야 <b>우회전 마스터</b>가 됩니다. AI 가 첫 번째 습관을 시험하는 코스를 추천합니다.';
    return wrap(`<div class="ai-note">${gate}</div><ul class="habit-list">${rows}</ul>`);
  }

  // ── 설정 ────────────────────────────────────────────────────────────────

  /**
   * 설정 화면.
   *
   * **고르는 즉시 저장하고 그 자리에서 다시 그린다.** '적용' 버튼을 따로 두면 누르지 않고
   * 나가는 사람이 생기고, 무엇이 켜져 있는지도 알 수 없다. 항목이 하나뿐이라 더욱 그렇다.
   *
   * **차는 여기서 고르지 않는다.** 고르기·좌석 맞추기가 자동차전시관 한 곳에 모여 있다 —
   * 같은 차를 두 화면에서 다루면 어느 쪽이 진짜인지 매번 헷갈린다.
   */
  renderSettings(
    save: SaveData,
    handlers: {
      onStartView(view: ViewMode): void;
      /** 난이도 설정 1~5 (scenarios/challenge.ts) */
      onDifficulty(c: Challenge): void;
      /** 화질 항목 하나를 바꾼다 */
      onGraphics(patch: Partial<GraphicsSettings>): void;
      /** 프리셋 — 네 항목을 한 번에 맞춘다 */
      onGraphicsPreset(tier: QualityTier): void;
      /** 소리 — 누른 즉시 저장하고 미리 들려준다 */
      onSound(kind: 'engine' | 'horn' | 'blinker', id: string): void;
      onBack(): void;
    },
  ): void {
    const current = save.settings.startView;
    const g = save.settings.graphics;
    const preset = matchedPreset(g);
    const snd = save.settings.sounds;

    const diffNow = CHALLENGES.find((c) => c.id === save.settings.difficulty) ?? CHALLENGES[DEFAULT_CHALLENGE - 1];
    /*
      **한 화면에 다 보이게 두 칸으로 나눈다.** 예전에는 난이도 · 초기 화면 · 화질 · 소리가 760px 폭에
      위아래로 쌓여, 소리까지 가려면 스크롤을 내려야 했다. 왼쪽은 "어떻게 연습할까"(난이도 · 시점 · 소리),
      오른쪽은 "얼마나 부드럽게 돌까"(화질)다. 카드 대신 한 줄짜리 버튼 묶음으로 쓰고, 고른 것의 설명은
      이름 아래 한 줄로만 적는다. 좁은 화면에서는 한 칸으로 접힌다.
    */
    $('settings-body').innerHTML = `
      ${this.head({ id: 'settings', title: '설정', backLabel: '닫기' })}

      <div class="settings-cols">
        <section class="settings-col">
          <h3 class="settings-h">연습</h3>
          <!-- 난이도가 맨 위다 — 설정을 여는 가장 흔한 이유가 "너무 쉽다 · 어렵다" 다 -->
          <div class="opt-row">
            <div class="opt-label">
              난이도
              <span class="opt-hint">${esc(diffNow.desc)} · 다음 추천부터 반영</span>
            </div>
            <div class="opt-choices">
              ${CHALLENGES.map(
                (c) =>
                  `<button class="opt ${c.id === save.settings.difficulty ? 'on' : ''}" id="diff-${c.id}" title="${esc(
                    c.desc,
                  )}">${c.id} ${esc(c.name)}${c.id === DEFAULT_CHALLENGE ? ' ·기본' : ''}</button>`,
              ).join('')}
            </div>
          </div>
          <div class="opt-row">
            <div class="opt-label">
              초기 화면
              <span class="opt-hint">주행을 시작할 때의 시점 (주행 중 C 로 바꿈)</span>
            </div>
            <div class="opt-choices">
              ${START_VIEWS.map(
                (v) =>
                  `<button class="opt ${v.id === current ? 'on' : ''}" id="view-${v.id}">${esc(v.name)}${
                    v.isDefault ? ' ·기본' : ''
                  }</button>`,
              ).join('')}
            </div>
          </div>

          ${this.soundSection(snd)}
        </section>

        <section class="settings-col">
          <h3 class="settings-h">화질 <span class="settings-h-note">느리면 렌더 해상도 · 그림자부터 낮추세요</span></h3>
          <!-- 프리셋 — 네 항목을 한 번에. 지금 설정과 같은 것이 없으면 아무것도 선택되지 않는다 -->
          <div class="opt-row">
            <div class="opt-label">전체 프리셋</div>
            <div class="opt-choices">
              ${(['ultra', 'high', 'medium', 'low'] as const)
                .map(
                  (t) =>
                    `<button class="opt ${preset === t ? 'on' : ''}" id="gq-preset-${t}">${esc(
                      TIER_LABEL[t],
                    )}</button>`,
                )
                .join('')}
              ${preset === null ? `<span class="opt-note">${esc(customNote(g))}</span>` : ''}
            </div>
          </div>

          <!--
            **렌더 해상도가 맨 위다** — 노트북 내장 그래픽처럼 GPU 가 약한 기기에서 가장 잘 듣는다(픽셀을 반으로 줄이면
            픽셀 처리가 반). '자동' 은 느릴 때만 스스로 낮추고, 낮춰도 빨라지지 않으면 되돌린다 (quality.ts 의 AutoResolution).
          -->
          ${this.optionRow('gq-resolution', '렌더 해상도', RESOLUTION_CHOICES, String(g.resolution), {
            note: '약한 그래픽 카드에서 가장 잘 듣습니다 · 자동은 느릴 때만 낮춤',
          })}
          ${this.optionRow('gq-peripheral', '좌·우·후방 시야 창', Object.entries(PERIPHERAL_LABEL), g.peripheral, {
            note: '드로우콜 −10% 남짓',
          })}
          ${this.optionRow('gq-shadow', '그림자 품질', Object.entries(TIER_LABEL), g.shadow, {
            note: '끄면 드로우콜 −10~19%',
          })}
          ${this.optionRow('gq-reflection', '반사 품질', Object.entries(TIER_LABEL), g.reflection, {
            note: '보통 이하면 신호등 조명도 끔 (GPU −25%) · 끄면 첫 로딩 −4.5MB',
          })}
          ${this.optionRow('gq-frameCap', '프레임 상한', FRAME_CAP_CHOICES, String(g.frameCap), {
            note: '120Hz 화면에서 60이면 절반만 그립니다',
          })}

          <div class="opt-row">
            <div class="opt-label">
              안티에일리어싱 (MSAA)
              <span class="opt-hint">다시 시작해야 적용됩니다</span>
            </div>
            <div class="opt-choices">
              <button class="opt ${g.msaa ? 'on' : ''}" id="gq-msaa-on">켜기</button>
              <button class="opt ${g.msaa ? '' : 'on'}" id="gq-msaa-off">끄기</button>
            </div>
          </div>

          <div class="opt-row">
            <div class="opt-label">fps 표시</div>
            <div class="opt-choices">
              <button class="opt ${g.showFps ? 'on' : ''}" id="gq-fps-on">켜기</button>
              <button class="opt ${g.showFps ? '' : 'on'}" id="gq-fps-off">끄기</button>
            </div>
          </div>
        </section>
      </div>
    `;

    this.bindBack('settings', handlers.onBack);
    for (const [kind, prefix, list] of [
      ['engine', 'eng', ENGINE_SOUNDS],
      ['blinker', 'blk', BLINKER_SOUNDS],
      ['horn', 'hrn', HORN_SOUNDS],
    ] as const) {
      // 카드가 하나뿐인 항목은 그리지 않았다 — 없는 버튼을 찾아 묶지 않는다
      for (const c of list) {
        document
          .getElementById(`${prefix}-${c.id}`)
          ?.addEventListener('click', () => handlers.onSound(kind, c.id));
      }
    }
    for (const c of CHALLENGES) {
      $(`diff-${c.id}`).addEventListener('click', () => handlers.onDifficulty(c.id));
    }
    for (const v of START_VIEWS) {
      $(`view-${v.id}`).addEventListener('click', () => handlers.onStartView(v.id));
    }

    for (const t of ['ultra', 'high', 'medium', 'low'] as const) {
      $(`gq-preset-${t}`).addEventListener('click', () => handlers.onGraphicsPreset(t));
    }
    this.bindOptions('gq-resolution', RESOLUTION_CHOICES.map(([k]) => k), (v) =>
      handlers.onGraphics({ resolution: v === 'auto' ? 'auto' : (Number(v) as 100 | 75 | 50) }),
    );
    this.bindOptions('gq-peripheral', Object.keys(PERIPHERAL_LABEL), (v) =>
      handlers.onGraphics({ peripheral: v as GraphicsSettings['peripheral'] }),
    );
    this.bindOptions('gq-shadow', Object.keys(TIER_LABEL), (v) =>
      handlers.onGraphics({ shadow: v as QualityTier }),
    );
    this.bindOptions('gq-reflection', Object.keys(TIER_LABEL), (v) =>
      handlers.onGraphics({ reflection: v as QualityTier }),
    );
    this.bindOptions('gq-frameCap', FRAME_CAP_CHOICES.map(([k]) => k), (v) =>
      handlers.onGraphics({ frameCap: Number(v) as GraphicsSettings['frameCap'] }),
    );
    $('gq-msaa-on').addEventListener('click', () => handlers.onGraphics({ msaa: true }));
    $('gq-msaa-off').addEventListener('click', () => handlers.onGraphics({ msaa: false }));
    $('gq-fps-on').addEventListener('click', () => handlers.onGraphics({ showFps: true }));
    $('gq-fps-off').addEventListener('click', () => handlers.onGraphics({ showFps: false }));
  }

  /**
   * 화질 항목 한 줄 — 이름 왼쪽, 선택지 오른쪽.
   *
   * 드롭다운(`<select>`)이 아니라 **버튼을 늘어놓는다.** 선택지가 서넛뿐이라 펼치는 동작이
   * 한 번 더 드는 것이 손해이고, 지금 무엇이 골라져 있는지가 펼치지 않아도 보인다.
   */
  private optionRow(
    id: string,
    label: string,
    /** [값, 표시 이름] — **배열이다.** 순서를 그대로 지키려면 객체여서는 안 된다 */
    choices: Array<[string, string]>,
    value: string,
    opts: { note?: string } = {},
  ): string {
    return `
      <div class="opt-row">
        <div class="opt-label">
          ${esc(label)}
          ${opts.note ? `<span class="opt-hint">${esc(opts.note)}</span>` : ''}
        </div>
        <div class="opt-choices">
          ${choices
            .map(
              ([key, text]) =>
                `<button class="opt ${key === value ? 'on' : ''}" id="${id}-${key}">${esc(
                  text,
                )}</button>`,
            )
            .join('')}
        </div>
      </div>`;
  }

  private bindOptions(id: string, keys: string[], onPick: (value: string) => void): void {
    for (const key of keys) {
      document.getElementById(`${id}-${key}`)?.addEventListener('click', () => onPick(key));
    }
  }

  // ── 디브리핑 ─────────────────────────────────────────────────────────────

  renderDebrief(
    sc: ScenarioSpec,
    result: JudgeResult,
    unlockedNew: boolean,
    save: SaveData,
    handlers: {
      onRetry(): void;
      onNext(): void;
      onMenu(): void;
      /** 자동 넘김 체크를 켜고 끌 때 */
      onToggleAutoNext(on: boolean): void;
      /**
       * **AI 의 평가가 화면에 올라온 순간** (못 받았으면 그때) 한 번 부른다.
       *
       * 자동 넘김은 이때부터 센다 — 화면이 뜨자마자 세면 AI 가 답하는 1~4초가 읽을 시간에서 깎인다
       * (사용자가 "답을 받고 그 이후 7초" 라고 정했다).
       */
      onCoachReady?(): void;
      /** 세던 것을 멈추거나 다시 이어 셀 때 (이번 화면에만 해당 — 저장값은 그대로다) */
      onToggleAutoNextPause(): void;
    },
    /**
     * AI 우회전 주행이었다면 **이 판을 마친 뒤 단계가 어떻게 움직였는지.**
     * 수동 주행이면 `null` 이다.
     */
    course: CourseStep | null = null,
    /** 이번 판에 얻거나 잃은 뱃지 (economy/badges.ts) — 없으면 뱃지 줄을 그리지 않는다 */
    badgeEvents: readonly BadgeEvent[] = [],
    /** `coach: false` 면 AI 주행결과 분석 칸을 그리지도 부르지도 않는다 — 자율 주행 (main.ts 의 finishDemoRun) */
    options: { coach?: boolean } = {},
  ): void {
    // 등급 이름은 판정 엔진이 정한다 — 주행 기록도 같은 표를 쓴다 (lawRules.ts 의 GRADE_TEXT)
    const gradeLabel = GRADE_TEXT[result.grade] ?? result.grade;
    // AI 과정은 늘 다음 판이 있다 — 마스터가 된 뒤에도 마스터 운행(L10 무작위)이 이어진다
    const hasNext = course ? true : sc.id < SCENARIOS.length;
    /*
      자동 넘김은 **이어 달릴 수 있을 때만** 뜬다 — 다음 판이 있고, 실패하지 않았을 때.
      실패한 판을 자동으로 넘기면 방금 틀린 것을 다시 해 보지 않고 지나가게 된다.
      (같은 조건으로 다음 버튼도 뜬다 — 둘이 어긋나면 안 되므로 한 값을 쓴다)

      **AI 과정에서는 '다음 판' 이 늘 있다** — 만들면 되기 때문이다. 마스터한 뒤에만 멈춘다.
    */
    const canAdvance = hasNext && result.grade !== 'FAIL';

    /*
      다음으로 갈 곳의 이름.

      **AI 과정에서는 '더 어려운' 이 늘 맞지 않는다.** 무위반이면 올라가지만, 틀렸으면
      같은 단계에 머물고 두 번 이어 틀리면 내려간다 (curriculum.ts). 올라가지도 않았는데
      "더 어려운 난이도" 라고 적으면 학습자가 자기 성적을 잘못 읽는다 — 버튼 하나가
      방금 무슨 일이 있었는지를 말해 주는 자리다.
    */
    const nextLabel = !course
      ? '다음 Stage'
      : course.mastered
        ? '다음 판 · 마스터 운행'
        : course.level > course.prevLevel
        ? `${levelLabel(course.level)} 도전`
        : course.level < course.prevLevel
          ? `${levelLabel(course.level)} 로 낮춰서`
          : /*
              **최고 레벨에는 위가 없다.** 여기서 무위반은 진급이 아니라 마스터로 가는
              한 걸음이므로, 레벨이 그대로인 것을 '제자리' 로 읽히게 두면 안 된다.
            */
            course.clean && course.habits.length
            ? '습관 고치는 코스로'
            : course.clean
              ? // 경험치를 모으는 중 — 잘했는데 "다시 도전" 이라고 적으면 틀린 것처럼 읽힌다
                `다음 판 · ${course.level >= MAX_LEVEL ? '마스터' : levelLabel((course.level + 1) as Difficulty)}까지 ${Math.max(0, course.xp.need - course.xp.after)} XP`
              : `${levelLabel(course.level)} 다시 도전`;

    const autoLabel = course
      ? '다음 판 자동 넘어가기'
      : '다음 Stage 자동 넘어가기';

    /*
      **틀린 판에만 코치를 부른다.** 무위반으로 끝난 판에는 설명할 것이 없다 —
      등급과 감점 0 이 이미 결론이고, 거기에 문단을 더하면 그 결론이 흐려진다.
      완주하지 못한 판(사고·이탈)도 짚을 것이 있으므로 함께 부른다.
    */
    /*
      **모든 판에 AI 코치를 부른다.**

      한때는 틀린 판에만 불렀다 — 무위반으로 끝난 사람에게 읽을 것을 주면 그 판의 결론(무위반)이 흐려진다고
      봤다. 그런데 사용자가 결과 화면을 보고 말했다: "어떤 AI 가 의견을 써 준 건지, 어느 부분이 AI 의 의견인지
      알 수가 없어." 그 판이 PERFECT 라 코치 카드가 아예 없었고, 남은 파란 상자는 **AI 가 아니라 법규 설명**
      이었다. AI 활용 공모전 작품에서 잘 달린 판일수록 AI 가 사라지는 셈이라, 무위반 판에도 부른다 —
      프롬프트에 '위반이 없는 경우' 절이 이미 있어 잘한 판단을 짚어 준다 (server/coachPrompt.mjs).

      **자율 주행만은 부르지 않는다** (options.coach === false). AI 가 규정대로 몬 판이라 코치가 짚을 것이 없고 —
      사용자가 "자율주행일 때는 AI 분석결과가 필요없어" 라고 했다 — 부르면 무료 AI 한도만 쓴다.
    */
    const needsCoach = options.coach !== false;
    // 위반도 실패도 없었는가 — AI 평가 칸의 색과 로봇이 이걸 따른다 (아래 verdict)
    const clean = result.violations.length === 0 && result.failReason === null;

    const violationHtml = result.violations.length
      ? result.violations
          .map((v, i) => {
            const spec = VIOLATIONS[v.code];
            const fine = fineOf(v);
            const pts = penaltyPointsOf(v);
            return `
            <div class="violation">
              <h3>
                <span class="vnum">${i + 1}</span>${esc(spec.title)}
                <span class="cost">범칙금 ${fine.toLocaleString()}원${pts > 0 ? ` · 벌점 ${pts}점` : ''}${
                  v.inSchoolZone ? ' · 어린이보호구역 가중' : ''
                }</span>
              </h3>
              <p class="where">📍 ${esc(v.place)} · ${v.atTime.toFixed(1)}초 지점</p>
              <p class="why">${esc(spec.reason)}</p>
              <p class="fix"><b>이렇게 했어야 합니다</b><br />${esc(spec.fix)}</p>
              ${spec.citations
                .map(
                  (c) => `
                <div class="citation">
                  <div class="src">${esc(c.label)}</div>
                  <div class="body">${esc(c.text)}</div>
                </div>`,
                )
                .join('')}
            </div>`;
          })
          .join('')
      : '';

    const failHtml =
      result.grade === 'FAIL'
        ? `<div class="violation" style="border-left-color:var(--red)">
             <h3>운행 실패</h3>
             <p class="why">${esc(
               result.failReason
                 ? FAIL_REASON[result.failReason]
                 : '우회전을 완료하지 못했습니다.',
             )}</p>
           </div>`
        : '';

    // 주행 지도 — "어디서" 를 그림 한 장으로 답한다. 위반 번호는 카드 번호와 같다.
    const mapHtml = result.path.length
      ? `<div class="runmap-card">
           <div class="runmap-title">주행 지도 ${
             result.violations.length
               ? `— ${result.violations.map((_, i) => CIRCLED[i] ?? `${i + 1}`).join('')} 지점에서 위반`
               : '— 위반 없이 통과했습니다'
           }</div>
           <canvas id="runmap"></canvas>
           <div class="runmap-legend">
             <span><i class="sw path"></i>내 궤적</span>
             <span><i class="sw bad"></i>위반 지점</span>
             ${
               result.pedestrianPaths.length
                 ? // 지도 칸이 좁아져(2 : 3) 줄였다 — 긴 설명이면 '도착' 이 혼자 둘째 줄로 떨어졌다
                   '<span><i class="sw ped"></i>보행자 경로(● 위반 순간)</span>'
                 : ''
             }
             <span><i class="sw start"></i>진입</span>
             <span><i class="sw end"></i>도착</span>
           </div>
         </div>`
      : '';

    /*
      주행 기록 — "왜 이 판정이 나왔는가"를 시간순으로 되짚는다.

      **접지 않는다.** 예전에는 `<details>` 로 두고 위반이 있을 때만 펼쳤는데, 지도 옆
      자리로 옮기면서 접어 둘 이유가 없어졌다 — 옆 칸이 비어 있으면 오히려 허전하고,
      한 번 더 눌러야 보이는 정보는 결국 아무도 보지 않는다.
    */
    const logHtml = result.log.length
      ? `<div class="runlog">
           <div class="runlog-title">주행 기록 ${result.log.length}건 — 무엇이 언제 판정됐는지</div>
           <div class="runlog-body">
             ${result.log
               .map(
                 (e) => `<div class="runlog-row ${e.level}">
                   <span class="t">${e.t.toFixed(1)}초</span>
                   <span class="msg">${esc(e.text)}</span>
                 </div>`,
               )
               .join('')}
           </div>
         </div>`
      : '';


    $('debrief-body').innerHTML = `
      <!--
        나가는 문은 **다른 화면과 같은 자리**에 둔다. 예전에는 결과 화면만 '홈으로'가
        버튼 줄 끝에 섞여 있어서, 화면마다 나가는 법을 새로 찾아야 했다.
      -->
      ${this.head({
        id: 'debrief',
        // 주행 화면의 목표 상자와 **같은 모양**이다 — 판 이름은 파랑, 제목은 본문색
        ...debriefTitle(sc),
        backLabel: '홈으로',
        right: `<div class="grade ${result.grade}">${esc(gradeLabel)}</div>`,
      })}

      ${
        /*
          **AI 의 주행 평가 — 결과 화면 맨 위, 경험치 칸 바로 앞이다** (사용자가 자리를 정했다).

          한때는 버튼 아래에 긴 문단으로 두었다. 그랬더니 잘 달린 판에는 카드가 아예 없었고(그때는 틀린 판에만
          불렀다), 있어도 아래쪽이라 "어느 부분이 AI 의 의견인지 모르겠다" 는 말을 들었다. 지금은 **판이 끝나면
          가장 먼저 읽는 자리**에 로봇과 함께 둔다 — "완벽했으면 완벽했다고 칭찬을 받는 것도 기분이 좋다" 는
          사용자의 말이 이 자리의 이유다.

          글이 오기 전에는 회색 띠만 있다가 도착하면 채워진다 (loadCoaching). 못 받으면 AI 글이 아니라고 밝히고 판정
          기록으로 정리한 코칭을 넣는다 (fallbackCoach) — 늘 있던 칸이 말없이 사라지면 고장처럼 보인다.
        */
        needsCoach
          ? /*
              **판정에 따라 색과 로봇이 바뀐다** (사용자가 정했다).

               - 깨끗하게 통과 → 초록 · `turnlight.webp` (신호등을 들고 웃는 AI 우회전)
               - 규정을 어겼거나 완주 못 함 → 붉은색 · `stop.webp` (손을 들어 세우는 AI 우회전)

              같은 칸에 같은 색으로 칭찬과 지적을 담으면, 읽기 전에는 어느 쪽인지 알 수 없다. 색과 그림이
              먼저 말하고 글이 잇는다 — 위쪽 등급 배지(PERFECT · FAIL)와도 같은 편을 든다.
            */
            `<div class="verdict loading ${clean ? 'good' : 'bad'}" id="coach-card">
              <div class="verdict-head">${icon('guide')}<span id="coach-head">AI 주행결과 분석</span><span class="coach-by" id="coach-by"></span></div>
              <div class="verdict-row">
                <img class="verdict-robot" src="${clean ? robotTurn : robotStop}" alt="" aria-hidden="true" />
                <!--
                  **기다리는 동안 무슨 일이 일어나는지 말한다.** 회색 띠만 있으면 화면이 멈춘 것처럼 보인다 —
                  AI 는 1~4초가 걸리고, 그 사이 사용자는 이 칸이 무엇을 기다리는지 알 수 없었다 (사용자 요청).
                  글이 도착하면 이 칸을 통째로 갈아 끼운다 (loadCoaching).
                -->
                <div class="coach-body" id="coach-body">
                  <span class="coach-wait-text">AI 답변 작성중<i class="dots"><i>.</i><i>.</i><i>.</i></i></span>
                </div>
              </div>
            </div>`
          : ''
      }

      <!--
        **뱃지 줄 — AI 평가 바로 아래** (ui/badgeArt.ts). 이 판에서 얻은 뱃지와 잃은 뱃지를 까닭과 함께 보여 준다. 사용자가
        캐글처럼 "중간중간 뭔가를 달성할 때마다 뱃지를 주고, 교통법규를 위반하면 뱃지를 뺏기게" 해 달라고 했다 — 판을
        마치자마자 읽는 자리라야 잘한 것과 어긴 것이 곧바로 뱃지와 이어진다. 움직인 뱃지가 없으면 그리지 않는다.
      -->
      ${badgeStrip(badgeEvents)}

      <!--
        **경험치 칸과 버튼을 한 줄에 반반씩 둔다** (사용자 요청 — 공간 활용). 둘 다 "이 판이 어땠고 다음에
        무엇을 할까" 한 가지 일이라, 위아래로 쌓으면 화면만 길어지고 읽는 순서는 달라지지 않는다.
        좁은 화면에서는 예전처럼 두 줄로 내려간다 (index.html 의 .debrief-top).
      -->
      <div class="debrief-top">
      ${
        /*
          AI 과정의 진행 — **버튼 위에 둔다.** 다음으로 갈 곳을 누르기 전에 방금 무슨
          일이 있었는지(올라갔는가 · 그대로인가)를 먼저 읽어야 그 버튼이 뜻을 갖는다.

          **레벨이 움직인 판은 배너로 알린다.** 이 과정에서 가장 큰 사건인데 한 줄짜리
          칩에 적으면 등급·감점 사이에 묻혔다. 게임에서 레벨이 오를 때 그러듯 크게
          띄운다 — 규정을 익히러 온 사람에게도 "올랐다" 는 그 순간이 다음 판을 누르게
          만드는 힘이다.

          제자리인 판과 마스터한 판은 배너 없이 **플레이어 칸**(ui/playerCard.ts)만 선다 — 첫 화면 · 운전 화면과
          같은 칸이다. 배너를 매 판 띄우면 올라간 판의 배너가 값어치를 잃는다.
        */
        course && !course.mastered && course.level !== course.prevLevel
          ? this.levelChangeBanner(course) + this.xpResult(course)
          : course
            ? this.xpResult(course)
            : ''
      }

      ${
        /*
          레벨이 올라 새 차가 열렸다는 칸은 **두지 않는다** — 레벨업 배너가 이미 올랐다는 것을 말하고,
          전시관에서 확인할 수 있다. 결과 화면에서는 이번 판에 무엇을 지키고 어겼는지가 먼저다.
        */
        ''
      }

        <div class="btn-row">
        ${
          canAdvance
            ? `<button class="primary" id="btn-next">${icon('next')}${esc(
                nextLabel,
              )}<span class="count" id="auto-count" hidden></span></button>`
            : ''
        }
        ${
          /*
            세던 것을 멈추는 버튼 — **카운트다운 바로 옆**이다.

            체크를 끄는 것과는 다른 일이다. 체크는 "앞으로도 자동으로 넘기지 마라"는
            뜻이라 다음 판부터도 계속 꺼져 있고, 이 버튼은 **이번 화면만** 붙잡아
            둔다. 결과를 마저 읽고 다시 누르면 멈춘 초부터 이어서 센다.

            세고 있을 때만 보인다 (setAutoNextCountdown 이 켜고 끈다).
          */
          canAdvance
            ? `<button id="btn-auto-pause" class="icon" hidden
                       title="카운트다운 멈춤" aria-label="카운트다운 멈춤">${icon('pause')}</button>`
            : ''
        }
        <button ${canAdvance ? '' : 'class="primary"'} id="btn-retry">${icon(
          'retry',
        )}다시 운행</button>
        ${
          /*
            자동 넘김 — **버튼과 같은 줄 끝**에 둔다. 켜면 저 버튼이 스스로 눌린다는 뜻이라 버튼 곁에
            있어야 남은 초가 왜 세어지는지 알 수 있다. 한때 버튼 아래 줄에 따로 있었는데, 결과 화면
            윗부분이 두 줄을 차지해 정산 · 지도가 그만큼 밀려 내려갔다.
          */
          canAdvance
            ? `<label class="auto-next">
                 <input type="checkbox" id="chk-auto-next" ${
                   save.settings.autoNextStage ? 'checked' : ''
                 } />
                 <span>${esc(autoLabel)}</span>
               </label>`
            : ''
        }
      </div>
      </div>

      ${
        /*
          **AI 가 이번 판으로 기록을 어떻게 고쳤는가.**

          고쳐진 습관을 먼저 보여 준다 — 없어지는 것이 이 과정의 보상이라, 새로 생긴
          것보다 앞에 있어야 한다. 아무것도 안 바뀌었으면 아무 말도 하지 않는다.
        */
        course && (course.change.cleared.length || course.change.added.length)
          ? `<div class="habit-change">
              ${course.change.cleared
                .map(
                  (c2) =>
                    `<div class="hc cleared">${icon('info')} <b>${esc(
                      habitTitle(c2),
                    )}</b> 습관이 사라졌습니다 — ${HABIT_CLEARED_AFTER}판 연속으로 지켰습니다</div>`,
                )
                .join('')}
              ${course.change.added
                .map(
                  (c2) =>
                    `<div class="hc added">${icon('info')} <b>${esc(
                      habitTitle(c2),
                    )}</b> 를 나쁜 습관으로 기록했습니다 — 다음 판이 이 상황을 냅니다</div>`,
                )
                .join('')}
            </div>`
          : ''
      }

      <!--
        **점수 정산 칸은 두지 않는다** (최종 운전 점수 · 획득 · 감점). 이 판이 어땠는지는 위의 등급 · 경험치가, 무엇을
        어겼는지는 아래 위반 카드(범칙금 · 벌점)가 말한다 — 첫 화면의 "내 운전점수" 를 없애며 함께 뺐다.
      -->

      ${failHtml}

      <!--
        **지도와 기록을 나란히 둔다.** 둘은 같은 주행을 서로 다른 방식으로 되짚는 것이라
        (어디서 · 언제) 위아래로 쌓으면 한쪽을 보는 동안 다른 쪽이 화면 밖으로 나간다.
        옆에 두면 지도의 위반 지점을 짚으면서 그 시각의 기록을 함께 읽을 수 있다.
        좁은 화면에서는 한 줄로 무너져 예전처럼 위아래로 쌓인다.
      -->
      <div class="debrief-split">
        <div class="split-col">${mapHtml}</div>
        <div class="split-col">
          ${logHtml}
          ${
            /*
              **이건 AI 글이 아니다.** 코스마다 붙어 있는 도로교통법 설명(scenarios.ts 의 teaches)인데, 아무
              표시가 없어 AI 의 의견으로 읽혔다 (사용자가 짚었다). 제목을 달아 AI 코치 카드와 갈라 둔다.
            */
            result.violations.length === 0 && result.grade !== 'FAIL'
              ? `<div class="tip">
                  <div class="tip-title">${icon('guide')}도로교통법 설명<span class="tip-note">AI 글이 아니라 이 코스에 붙은 설명입니다</span></div>
                  ${esc(sc.teaches)}
                </div>`
              : ''
          }
          ${unlockedNew ? `<div class="tip">새 Stage가 열렸습니다.</div>` : ''}
        </div>
      </div>

      ${violationHtml}

    `;

    const mapCanvas = document.getElementById('runmap') as HTMLCanvasElement | null;
    if (mapCanvas) {
      drawRunMap(mapCanvas, {
        path: result.path,
        pedestrianPaths: result.pedestrianPaths,
        violations: result.violations,
      });
    }

    // 카드를 그리지 않았으면 부르지도 않는다 (위 needsCoach 주석 참고)
    if (needsCoach) this.loadCoaching(sc, result, handlers.onCoachReady);
    else handlers.onCoachReady?.();

    this.bindBack('debrief', handlers.onMenu);
    $('btn-retry').addEventListener('click', handlers.onRetry);

    if (canAdvance) {
      $('btn-next').addEventListener('click', handlers.onNext);
      const chk = $('chk-auto-next') as HTMLInputElement;
      chk.addEventListener('change', () => handlers.onToggleAutoNext(chk.checked));
      $('btn-auto-pause').addEventListener('click', handlers.onToggleAutoNextPause);
    }
  }

  /**
   * AI 코치 문장을 받아 채워 넣는다. 못 받아 오면 판정 기록으로 정리한 코칭을 넣고 AI 글이 아니라고 밝힌다.
   *
   * **이번 화면의 것이 맞는지 확인하고 그린다.** 자동 넘김이 켜져 있으면 응답이 오기
   * 전에 다음 판으로 넘어가는 일이 흔한데, 그때 늦게 도착한 문장을 그냥 그리면 새 판의
   * 결과 화면에 **직전 판의 코칭**이 붙는다 — 판정이 틀린 것보다 나쁜 종류의 거짓말이다.
   * 그래서 판을 그릴 때마다 번호를 올리고, 그 사이 화면이 다시 그려졌으면 버린다.
   */
  private coachRun = 0;

  private loadCoaching(sc: ScenarioSpec, result: JudgeResult, onReady?: () => void): void {
    const mine = ++this.coachRun;

    void fetchCoaching(toCoachRequest(sc.id, sc.title, result)).then((advice) => {
      if (mine !== this.coachRun) return; // 그 사이 다른 판이 그려졌다
      const card = document.getElementById('coach-card');
      const body = document.getElementById('coach-body');
      if (!card || !body) return; // 화면을 이미 떠났다

      /*
        **받았든 못 받았든 한 번은 알린다** (onReady) — 자동 넘김이 이때부터 센다. 못 받은 판에서 부르지 않으면
        카운트다운이 아예 시작되지 않아, 자동 넘김을 켜 둔 사람이 결과 화면에 갇힌다.
      */
      if (!advice) {
        /*
          **칸을 지우지 않고, AI 글이 아니라고 밝힌 뒤 판정 기록으로 채운다** (위 fallbackCoach). 제목에서 'AI' 를 빼고,
          누가 썼는지 적는 자리에 까닭을 적는다 — AI 가 쓰지 않은 글을 AI 이름으로 내보내면 거짓말이 된다.
        */
        card.classList.remove('loading');
        const head = document.getElementById('coach-head');
        if (head) head.textContent = '주행결과 정리';
        const by = document.getElementById('coach-by');
        if (by) by.textContent = 'AI 답변을 받지 못해 판정 기록으로 정리했어요';
        body.innerHTML = coachLines(fallbackCoach(result));
        onReady?.();
        return;
      }
      card.classList.remove('loading');
      body.innerHTML = coachLines(advice.text);
      // 누가 조언했는지 (ui/pickedBy.ts) — 판마다 쓴 AI 가 다르다
      const by = document.getElementById('coach-by');
      if (by) by.innerHTML = advisedBy(advice.picker as Picker | undefined, advice.model);
      onReady?.();
    });
  }

  // ── 습관 리포트 ───────────────────────────────────────────────────────────

  /**
   * 여러 판을 가로지르는 습관 진단.
   *
   * **숫자를 먼저 그리고 AI 문단은 나중에 채운다.** 준수율은 세면 나오는 값이라
   * (coach/habits.ts) 서버가 없어도 늘 맞고, 진단 문단은 그 위에 얹히는 해석이다.
   * 순서를 반대로 두면 정적 배포에서 이 화면이 텅 빈 것처럼 보인다.
   */
  /**
   * **뱃지 모음** — 가진 뱃지와 아직 없는 뱃지를 모두 늘어놓는다. 없는 뱃지는 회색이고 얻는 법과 남은 양을 적는다
   * (캐글의 뱃지 화면처럼). 습관 리포트와 같은 모양이다 — 머무르며 읽는 화면이고, 뒤로가기는 첫 화면으로 간다.
   */
  renderBadges(save: SaveData, onBack: () => void): void {
    $('badges-body').innerHTML = `
      ${this.head({
        id: 'badges',
        title: '내 뱃지',
        backLabel: '홈으로',
        sub: '안전운전 습관을 지킬 때마다 받고, 교통법규를 어기면 그 법규의 뱃지를 잃습니다.',
      })}
      ${badgeCollection(save.badges)}
    `;
    this.bindBack('badges', onBack);
  }

  renderReport(save: SaveData, onBack: () => void): void {
    const s = summarize(save.history);

    if (s.runs < MIN_RUNS) {
      $('report-body').innerHTML = `
        ${this.head({ id: 'report', title: '내 운전 습관', backLabel: '홈으로' })}
        <div class="habit-empty">
          아직 ${s.runs}판을 돌았습니다.<br />
          <b>${MIN_RUNS}판</b>부터 습관을 진단합니다 — 두세 판으로 버릇을 말하면 그건 점집입니다.
        </div>`;
      this.bindBack('report', onBack);
      return;
    }

    const worst = weakestPoint(s);
    const pct = (r: number) => Math.round(r * 100);

    const barsHtml = s.points
      .map((p) => {
        // 색은 세 단계로만 가른다 — 90% 위는 익힌 것, 70% 아래는 무너지는 자리
        const tier = p.rate >= 0.9 ? '' : p.rate >= 0.7 ? 'mid' : 'low';
        const isWorst = worst === p && p.rate < 1 ? 'worst' : '';
        return `
        <div class="habit-bar ${tier} ${isWorst}">
          <div class="k">${esc(p.label)}</div>
          <div class="v">${pct(p.rate)}%<small>${p.kept}/${p.total}판</small></div>
          <div class="track"><div class="fill" style="width:${pct(p.rate)}%"></div></div>
        </div>`;
      })
      .join('');

    const codesHtml = s.byCode.length
      ? `<h2>반복된 위반</h2>
         <div class="habit-codes">
           ${s.byCode
             .map(
               (c) => `<div class="row">
                 <span>${esc(VIOLATIONS[c.code as ViolationCode]?.title ?? c.code)}</span>
                 <b>${c.count}회</b>
               </div>`,
             )
             .join('')}
         </div>`
      : '';

    /*
      추이는 **낼 수 있을 때만** 보여 준다. 판이 적으면 한 판 차이로 "나아지고 있다"가
      "나빠지고 있다"로 뒤집히는데, 그 숫자를 보여 주면 사람은 그것을 믿는다.
    */
    const trendHtml = s.trend
      ? `<div class="cell">
           <div class="k">무위반율 추이</div>
           <div class="v">${pct(s.trend.early)}%<small>→</small>${pct(s.trend.late)}%</div>
         </div>`
      : '';

    $('report-body').innerHTML = `
      ${this.head({
        id: 'report',
        title: '내 운전 습관',
        sub: `최근 ${s.runs}판을 겹쳐 본 결과입니다.`,
        backLabel: '홈으로',
      })}

      <div class="habit-top">
        <div class="cell">
          <div class="k">주행</div>
          <div class="v">${s.runs}<small>판</small></div>
        </div>
        <div class="cell">
          <div class="k">위반 없이 마침</div>
          <div class="v">${s.cleanRuns}<small>/ ${s.runs}판</small></div>
        </div>
        ${trendHtml}
        ${
          s.mostRetried
            ? `<div class="cell">
                 <div class="k">가장 많이 돈 판</div>
                 <div class="v">Stage ${s.mostRetried.stage}<small>${s.mostRetried.count}회</small></div>
               </div>`
            : ''
        }
      </div>

      <!-- AI 진단은 숫자 **아래**다 — 숫자가 근거고 이것이 해석이다 -->
      <div class="coach loading" id="report-coach">
        <div class="coach-title">${icon('guide')}AI 습관 진단</div>
        <div class="coach-body" id="report-coach-body"></div>
        <div class="coach-by" id="report-coach-by"></div>
      </div>

      <h2>지점별 준수율</h2>
      <div class="habit-bars">${barsHtml}</div>

      ${codesHtml}
    `;

    this.bindBack('report', onBack);
    this.loadHabitReport(s);
  }

  /** 진단 문단 — 코치 카드와 같은 규칙이다 (늦게 오면 버리고, 못 받으면 지운다) */
  private reportRun = 0;

  private loadHabitReport(summary: HabitSummary): void {
    const mine = ++this.reportRun;

    void fetchHabitReport(summary).then((advice) => {
      if (mine !== this.reportRun) return;
      const card = document.getElementById('report-coach');
      const body = document.getElementById('report-coach-body');
      if (!card || !body) return;

      if (!advice) {
        card.remove();
        return;
      }
      card.classList.remove('loading');
      body.innerHTML = coachLines(advice.text);
      const by = document.getElementById('report-coach-by');
      if (by) by.innerHTML = advisedBy(advice.picker as Picker | undefined, advice.model);
    });
  }

  /**
   * 자동 넘김의 남은 초를 보여 준다. `null` 이면 지운다.
   *
   * 세는 일은 여기서 하지 않는다 — 시간을 세다가 판을 시작하는 것은 화면의 일이 아니라
   * 앱의 일이라(main.ts) 남은 숫자만 받아 그린다. 결과 화면이 떠 있지 않으면 그릴 곳이
   * 없으므로 조용히 넘어간다.
   *
   * `paused` 는 **멈춰 있지만 아직 이 화면에 있다**는 뜻이다 — 남은 초는 그대로 보여 준다.
   * 어디서 다시 이어질지 알아야 다시 누를지 말지를 정할 수 있다.
   */
  setAutoNextCountdown(seconds: number | null, paused = false): void {
    const el = document.getElementById('auto-count');
    const btn = document.getElementById('btn-auto-pause');
    if (!el) return;

    if (btn) {
      btn.hidden = seconds === null;
      const label = paused ? '카운트다운 이어서 세기' : '카운트다운 멈춤';
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.innerHTML = icon(paused ? 'play' : 'pause');
      btn.classList.toggle('on', paused);
    }

    if (seconds === null) {
      el.hidden = true;
      el.textContent = '';
      el.classList.remove('tick', 'paused');
      return;
    }
    el.hidden = false;
    el.innerHTML = `${seconds}<i>초</i>`;
    el.classList.toggle('paused', paused);
    /*
      숫자가 바뀔 때마다 **애니메이션을 다시 건다.**

      클래스를 그대로 두면 CSS 애니메이션은 처음 한 번만 돈다. 지웠다가 다시 붙이는
      사이에 브라우저가 레이아웃을 다시 계산하게 만들어야(offsetWidth 를 읽는 것이
      그 방법이다) 새 애니메이션으로 인식한다. 이것이 없으면 5 에서만 튀고 4·3·2·1 은
      조용히 바뀌어, 세고 있다는 것이 눈에 걸리지 않는다.

      멈춰 있을 때는 튀지 않는다 — 숫자가 안 바뀌는데 튀면 아직 세는 것처럼 보인다.
    */
    el.classList.remove('tick');
    if (!paused) {
      void el.offsetWidth;
      el.classList.add('tick');
    }
  }

  /**
   * 대표 사진 고르기 — 파일을 읽어 **줄인 뒤** 넘긴다.
   *
   * 파일 입력 요소는 카드마다 두지 않고 필요할 때 하나 만들어 쓰고 버린다. 카드가 아홉
   * 장이라 미리 아홉 개를 심어 둘 이유가 없고, 같은 파일을 다시 골랐을 때 change 가 안
   * 뜨는 문제(같은 값이면 이벤트가 없다)도 새로 만들면 저절로 없어진다.
   */
  private pickPhoto(car: CarSpec, onPhoto: (id: string, dataUrl: string) => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void shrinkImage(file)
        .then((dataUrl: string) => onPhoto(car.id, dataUrl))
        .catch(() => alert('이 파일은 이미지로 읽지 못했습니다.'));
    });
    input.click();
  }

  // ── 자동차전시관 ─────────────────────────────────────────────────────────

  /**
   * 자동차전시관 — **차에 관한 모든 것을 여기서 한다.** 고르기 · 좌석 맞추기 · 사진 등록.
   *
   * ## 사는 곳이 아니라 열리는 곳이다
   *
   * 한때 상점이었다. 점수로 차를 사고, 사지 않은 차로 달리면 '렌탈' 딱지가 붙었다.
   * 잠가 두지 않은 것은 옳았지만 — 배우려고 켠 사람이 우회전 연습 대신 점수 모으기를
   * 하면 안 되니까 — **점수를 모으는 화면이 남아 있는 한** 그 유혹도 남아 있었다.
   *
   * 지금은 **잘 몰면 열린다.** 레벨이 오르면 그 레벨의 차가 전시관에 들어온다.
   * 보상하려는 것(규정을 지키는 운전)과 화면이 보여 주는 것이 그제야 같아진다.
   *
   * 그래서 카드에서 **가격과 구매 버튼이 사라졌다.** 대신 잠긴 차에는 어느 레벨에서
   * 열리는지가 적힌다 — 못 타는 것을 감추지 않는 이유는, 다음에 무엇이 오는지가
   * 보여야 레벨이 목표로 읽히기 때문이다.
   *
   * ## 계급 머리가 사라졌다
   *
   * 계급이 넷일 때는 계급마다 머리를 두고 그 아래 차 두세 대를 묶었다. 레벨이 열이
   * 되면서 **한 레벨에 한 대**가 되어, 머리를 두면 차 아홉 대에 머리 아홉 개가 붙는다.
   * 지금은 카드 자체에 레벨 뱃지를 얹고 한 줄로 늘어놓는다 — 목록이 곧 레벨 순서다.
   */
  renderShop(
    save: SaveData,
    handlers: {
      /** 이 차로 갈아탄다 */
      onSelect(id: string): void;
      /** 톱니바퀴 — 그 차로 갈아타고 운전석에 앉아 좌석을 맞춘다 */
      onAdjust(id: string): void;
      /** 대표 사진 등록 — 줄여 놓은 JPEG data URL 이 온다. 서버에 올리는 것은 부르는 쪽이다 */
      onPhoto(id: string, dataUrl: string): void;
      onBack(): void;
    },
  ): void {
    const best = unlockedLevel(save.curriculum);

    $('shop-body').innerHTML = `
      ${this.head({
        id: 'shop',
        title: '자동차전시관',
        sub:
          '차는 <b>레벨이 오르면 한 대씩 열립니다</b>. ' +
          `<b>${esc(levelLabel(MAX_LEVEL))}</b>을 달성하면 전시관의 차량이 모두 열립니다. ` +
          '톱니바퀴를 누르면 그 차의 <b>운전석에 앉아 좌석 높이</b>를 설정할 수 있습니다.',
        right: `<div class="wallet-inline">지금 레벨 : <b>${esc(
          levelLabel(save.curriculum.level),
        )}</b></div>`,
      })}

      <div class="grid">
        ${CARS_BY_LEVEL.map((c) => this.shopCard(c, save, isCarUnlocked(c, best))).join('')}
      </div>
    `;

    /*
      그림은 다 굽고 나면 **렌더러를 버린다** (carThumb.ts). 전시관을 한 번 그리는 동안만
      필요한 것이라, WebGL 컨텍스트를 붙들고 있을 이유가 없다.
    */
    releaseCarThumbRenderer();

    this.bindBack('shop', handlers.onBack);
    for (const c of CARS_BY_LEVEL) {
      document.getElementById(`use-${c.id}`)?.addEventListener('click', () => handlers.onSelect(c.id));
      document.getElementById(`seat-${c.id}`)?.addEventListener('click', () => handlers.onAdjust(c.id));
      document
        .getElementById(`photo-${c.id}`)
        ?.addEventListener('click', () => this.pickPhoto(c, handlers.onPhoto));
    }
  }

  /**
   * @param open 이 레벨에 닿았는가. 잠긴 차는 **보이되 눌리지 않는다** —
   *             감추면 다음에 무엇이 오는지 알 수 없고, 그러면 레벨이 목표로 읽히지 않는다.
   */
  private shopCard(c: CarSpec, save: SaveData, open: boolean): string {
    const active = save.activeCarId === c.id;

    /*
      카드 그림은 **등록한 사진 → 구운 3D → (둘 다 없으면) 안내** 순으로 고른다.

      예전에는 사진을 등록하기 전까지 아홉 칸이 모두 "사진 없음" 이라는 회색 글자였다.
      지금은 카탈로그의 치수·색으로 빚은 차체를 그 자리에서 구워 넣는다(carThumb.ts) —
      받아 오는 것이 없으므로 목록을 여는 값이 늘지 않고, 아홉 대가 서로 다르게 보인다.

      그림 자체는 **누르는 곳이 아니다.** 카드에 누를 것이 이미 여럿이라, 그림까지
      눌리면 무엇이 일어날지 예측할 수 없다.
    */
    const src = carPhotoUrl(c.id);
    const thumb = src ? null : carThumbnail(c);
    const photo = src
      ? `<img class="car-photo" src="${esc(src)}" alt="" loading="lazy" />`
      : thumb
        ? `<img class="car-thumb" src="${esc(thumb)}" alt="" />`
        : `<div class="car-photo-missing">
             사진 없음${
               CAN_UPLOAD_PHOTO
                 ? `<br /><span style="font-size:11px">아래 <b>사진 등록</b>으로 넣을 수 있습니다</span>`
                 : ''
             }
           </div>`;

    /*
      잠긴 차는 **버튼을 지우지 않고 잠근 이유를 적는다.** 버튼이 사라지면 왜 못 타는지
      알 수 없고, 열려 있는 카드와 모양이 달라져 목록이 들쭉날쭉해진다.
    */
    const actions = open
      ? `<div class="car-actions">
          ${
            active
              ? `<button class="running" disabled>운행 중</button>`
              : `<button id="use-${esc(c.id)}">이 차로 운행</button>`
          }
          <button class="icon" id="seat-${esc(c.id)}"
                  title="운전석 좌석 맞추기"
                  aria-label="운전석 좌석 맞추기">${icon('gear')}</button>
        </div>
        ${
          CAN_UPLOAD_PHOTO
            ? `<div class="car-photo-tools">
                <button class="ghost" id="photo-${esc(c.id)}">${src ? '사진 바꾸기' : '사진 등록'}</button>
              </div>`
            : ''
        }`
      : `<div class="car-actions">
          <button disabled>${esc(levelLabel(c.level))} 달성 시 개방</button>
        </div>`;

    /*
      **레벨 뱃지를 그림 위에 얹는다.**

      계급이 넷일 때는 계급마다 머리를 두고 그 아래 차를 묶었는데, 한 레벨에 한 대가
      되면서 머리 아홉 개가 목록을 토막 냈다. 뱃지를 카드에 붙이면 목록이 한 덩어리로
      남으면서도 **어느 카드가 몇 번째인지**가 그림으로 읽힌다.
    */
    return `
      <div class="card car-card ${open ? '' : 'locked'}">
        <span class="car-level level-badge-wrap sm ${open ? 'earned' : 'locked'}">${levelBadge(
          c.level,
        )}</span>
        ${photo}
        <div class="car-body">
          <!-- 차 이름과 설명은 싣지 않는다 — 사진과 레벨 뱃지로 고른다 -->
          ${actions}
        </div>
      </div>`;
  }

  // ── 도움말 (규정 요약) ────────────────────────────────────────────────────

  /**
   * 우회전 하는 방법 (규정 요약).
   *
   * 캠페인 화면이라 **딱 두 가지**만 남긴다 — 정면 차량신호등과 보행자.
   * 조문·범칙금·예외를 늘어놓으면 정작 기억해야 할 두 가지가 묻힌다.
   * (자세한 근거는 위반이 났을 때 디브리핑에서 조문 원문과 함께 보여 준다)
   *
   * 두 항목의 구성과 표현은 `download/우회전_운전방법_정리.md` 의 1·2절을 따른다 —
   * 정면 차량신호등의 색으로 먼저 가르고(적색은 일시정지, 녹색은 서행), 그다음에
   * 보행자를 본다. 화면과 그 문서가 서로 다른 말을 하면 어느 쪽을 믿어야 할지
   * 알 수 없게 된다.
   */
  renderHelp(onBack: () => void): void {
    $('help-body').innerHTML = `
      ${this.head({
        id: 'help',
        title: '우회전 하는 방법',
        sub: '기억할 것은 <b>두 가지</b>입니다 — 정면 차량신호등의 색과 보행자.',
      })}

      <div class="rule stop">
        <div class="n">1</div>
        <div class="rule-body">
          <div class="rule-kicker">정면 차량신호등이 적색 신호</div>
          <h3>우회전 전에 반드시 일시정지</h3>
          <ul>
            <li><b>보행자가 없어도</b> 정지선 앞에서 일시정지합니다.</li>
            <li>보행자가 있으면 <b>완전히 횡단을 마칠 때까지</b> 기다립니다.</li>
            <li>보행자가 없으면 일시정지한 뒤 <b>서행으로</b> 우회전합니다.</li>
          </ul>
        </div>
      </div>

      <div class="rule go">
        <div class="n">2</div>
        <div class="rule-body">
          <div class="rule-kicker">정면 차량신호등이 녹색 신호</div>
          <h3>속도를 줄여 서행, 보행자가 있으면 일시정지</h3>
          <ul>
            <li>횡단보도에 보행자가 있으면 <b>반드시 일시정지</b>하고, 모두 지나간 뒤에 우회전합니다.</li>
            <li>보행자가 없으면 <b>서행으로 우회전할 수 있습니다.</b></li>
            <li>급하게 돌면 단속 대상이 될 수 있습니다.</li>
          </ul>
        </div>
      </div>

      <!--
        보행자 판단은 두 항목에 공통으로 걸리는 것이라 따로 뺀다.
        (문서 2절 — 보행자가 있는 경우 우회전 시 규정)
      -->
      <div class="rule care">
        <div class="n">3</div>
        <div class="rule-body">
          <div class="rule-kicker">보행자가 있는 경우</div>
          <h3>기준은 신호등 색이 아니라 보행자입니다</h3>
          <ul>
            <li><b>우측 횡단보도의 보행신호와 상관없이</b> 보행자의 통행 여부가 기준입니다.</li>
            <li>건너고 있으면 <b>완전히 건널 때까지</b> 정지합니다.</li>
            <li>횡단보도 앞에 <b>서 있기만 해도</b> 곧 건널 수 있으므로 정지하고 지켜봅니다.</li>
            <li><b>비보호 우회전</b>(별도 우회전 신호가 없는 곳)에서도 보행자 보호 의무는 그대로입니다.</li>
          </ul>
        </div>
      </div>
    `;
    this.bindBack('help', onBack);
  }

  /**
   * 어린이보호구역 운전 방법 — **횡단보도에 신호가 있을 때 · 없을 때**, 그리고 30km/h.
   *
   * 우회전 하는 방법과 같은 꼴(번호 카드)로 적는다. 우선은 이 게임이 판정하는 두 경우만 싣는다
   * (신호 있는 횡단보도 — `SCHOOL_ZONE_RED` · 보행자 보호, 신호 없는 횡단보도 — `SCHOOL_ZONE_NO_STOP`).
   *
   * **시간제 속도제한은 참고로만 싣는다.** 일부 보호구역에서 심야에 제한속도를 올리는 제도가 확대되는
   * 중이지만(2026년 8월 경찰청 발표 기준) 장소마다 다르고 아직 전체의 1% 남짓이라, "보호구역은 30km/h"
   * 라는 기본을 흐리지 않게 따로 둔다. 조사한 날짜와 출처를 함께 적는다 — 바뀌는 제도다.
   */
  renderZoneHelp(onBack: () => void): void {
    $('help-body').innerHTML = `
      ${this.head({
        id: 'help',
        title: '어린이보호구역 운전 방법',
        sub: '횡단보도에 <b>신호가 있는지 없는지</b>부터 봅니다. 그리고 속도는 <b>30km/h</b>.',
      })}

      <div class="rule care">
        <div class="n">1</div>
        <div class="rule-body">
          <div class="rule-kicker">횡단보도에 신호가 있을 때</div>
          <h3>신호를 지키고, 어린이가 있으면 녹색이어도 멈춥니다</h3>
          <ul>
            <li>차량 신호가 <b>적색이면 정지선 앞에서 정지</b>하고 녹색이 될 때까지 기다립니다.</li>
            <li>차량 신호가 녹색이어도 횡단보도에 <b>건너거나 건너려는 보행자가 있으면 일시정지</b>합니다 (제27조 제1항).</li>
            <li>신호가 바뀌어도 아직 건너는 어린이가 있으면 <b>다 건널 때까지</b> 기다립니다.</li>
            <li>교차로에서 우회전할 때는 <b>우회전 방법</b>의 규칙이 그대로 함께 걸립니다.</li>
          </ul>
        </div>
      </div>

      <div class="rule stop">
        <div class="n">2</div>
        <div class="rule-body">
          <div class="rule-kicker">횡단보도에 신호가 없을 때</div>
          <h3>보행자가 없어도 반드시 일시정지</h3>
          <ul>
            <li>신호기가 없는 횡단보도 앞에서는 <b>보행자가 있든 없든</b> 먼저 완전히 멈춥니다 (제27조 제7항, 2022년 7월 12일 시행).</li>
            <li>멈춘 뒤 좌우를 살피고, 아무도 없으면 <b>서행으로</b> 지나갑니다.</li>
            <li>어린이가 보이면 <b>다 건널 때까지</b> 기다립니다. 아이는 작아서 늦게 보이고, 주차된 차 사이에서 갑자기 나옵니다.</li>
          </ul>
        </div>
      </div>

      <div class="rule go">
        <div class="n">3</div>
        <div class="rule-body">
          <div class="rule-kicker">속도</div>
          <h3>어린이보호구역에서는 시속 30km 이하</h3>
          <ul>
            <li>어린이보호구역의 제한속도는 <b>대부분 시속 30km</b>입니다 (제12조 — 시장 등이 30km/h 이내로 제한). 노면의 붉은 포장과 <b>"30"</b> 표시, 표지판으로 알립니다.</li>
            <li><b>오전 8시 ~ 오후 8시</b>에는 보호구역에서의 신호위반 · 속도위반 · 보행자 보호 위반의 <b>범칙금과 벌점이 2배</b>로 가중됩니다.</li>
            <li>이 게임에서도 보호구역에 들어서면 차가 30km/h 로 속도를 묶습니다.</li>
          </ul>
        </div>
      </div>

      <!--
        참고 — 조사해 적은 것이라 날짜와 출처를 붙인다. 판정에는 쓰지 않는다 (게임은 늘 30km/h).
      -->
      <div class="rule-note">
        <div class="rule-kicker">참고 · 시간제 속도제한 (2026년 8월 경찰청 발표 기준)</div>
        <ul>
          <li>어린이 통행이 거의 없는 <b>심야에 일부 보호구역의 제한속도를 시속 40~50km로 올리는</b> 제도입니다. 2023년 9월 도입됐습니다.</li>
          <li>운영 시간은 <b>밤 12시 ~ 오전 6시</b>가 기본이며, 지역에 따라 달라집니다 (예: 오후 8시 ~ 오전 7시).</li>
          <li>전국 보호구역 1만 5,856곳 중 <b>84곳</b>(0.5%)에서 운영 중이고, 연말까지 약 160곳을 우선 운영할 계획입니다.</li>
          <li>운영하는 곳에는 <b>시간대별 제한속도 표지와 노면 표시</b>(또는 시간에 따라 바뀌는 LED 표지)가 있습니다. <b>표지가 없으면 언제나 30km/h</b>입니다.</li>
        </ul>
        <p class="rule-src">출처:
          <a href="https://www.seoul.co.kr/news/society/2026/08/27/20260827500155" target="_blank" rel="noopener">서울신문 (2026.8.27)</a> ·
          <a href="https://www.seoul.co.kr/news/society/2026/09/17/20260917500200" target="_blank" rel="noopener">서울신문 (2026.9.17, 대전)</a> ·
          <a href="https://www.kisnews.net/720959" target="_blank" rel="noopener">한국산업안전뉴스 (경찰청 발표)</a>
        </p>
      </div>
    `;
    this.bindBack('help', onBack);
  }

  // ── About ───────────────────────────────────────────────────────────────

  /**
   * **About — 만든 사람이 이 작품을 만든 이유.**
   *
   * 글은 만든 사람이 직접 쓴 것이다. 맞춤법 세 군데('헷갈리는' · '잘 지키고' · '있을 것')만 고치고 말투와 문장은 그대로
   * 둔다 — 공모전 심사자가 읽는 것은 다듬은 문장이 아니라 **왜 만들었는가**다. 마지막 한 줄은 이 작품의 바람이라 따로
   * 세운다. 옆에는 주행 중 곁을 지키는 AI 우회전(normal.webp)이 선다 — 글이 말하는 'AI 의 도움' 이 누구인지 보이게.
   */
  /**
   * **맵 체험하기** — 시나리오 번호를 넣으면 그 판을 바로 달린다 (main.ts 의 mapTrial).
   *
   * 사용자가 부탁했다: "시나리오 번호를 넣으면 그 맵을 체험하는 거야. 그러면 니가 수정한 것을 실제
   * 환경에서 테스트할 수 있을 것 같아." 처음에는 첫 화면 본문에 칸을 두었는데, **시험용이라 따로
   * 떼어 달라**고 했다 — 학습자가 보는 본문에 섞이면 어느 것을 눌러야 할지 흐려진다.
   */
  renderTrial(onBack: () => void, onTry: (no: number) => void): void {
    $('trial-body').innerHTML = `
      ${this.head({
        id: 'trial',
        title: '맵 체험하기',
        backLabel: '닫기',
        sub: '시나리오 번호를 넣으면 그 맵을 바로 달립니다 — 고친 판을 실제 화면에서 시험해 보는 자리입니다.',
      })}
      <!--
        **넣는 대로 그 판의 이름을 보여 준다.** 번호만 보고 출발하면 엉뚱한 판을 달린 뒤에야 알게 된다 —
        없는 번호나 뺀 번호도 여기서 말한다. 결과 화면 · 주행 화면의 "AI 추천 시나리오 57" 그 번호다.
      -->
      <form class="map-trial" id="map-trial" autocomplete="off">
        <label for="map-trial-no">시나리오 번호</label>
        <input id="map-trial-no" type="number" inputmode="numeric" min="1" placeholder="예: 57" />
        <button class="btn primary" id="btn-map-trial" type="submit" disabled>${icon('play')}체험</button>
        <p class="map-trial-note" id="map-trial-note" aria-live="polite"></p>
      </form>
      <ul class="map-trial-rules">
        <li><b>기록이 남지 않습니다</b> — 레벨 · 경험치 · 나쁜 운전 습관 · 주행 기록이 그대로입니다. 몇 번이든 되풀이해도 됩니다.</li>
        <li>화면에는 <b>맵 체험 57</b> 처럼 적힙니다 — AI 가 고른 판이 아니라서 'AI 추천' 이라 부르지 않습니다.</li>
        <li>끝나면 다음 판으로 넘어가지 않고 <b>다시 운행</b>만 둡니다. 다른 번호는 이 창에서 다시 넣습니다.</li>
      </ul>
    `;
    this.bindBack('trial', onBack);
    this.bindMapTrial(onTry);
    // 창을 열자마자 번호를 칠 수 있게 — 이 창에서 하는 일은 그것 하나다
    ($('map-trial-no') as HTMLInputElement).focus();
  }

  renderAbout(onBack: () => void): void {
    $('about-body').innerHTML = `
      ${this.head({
        id: 'about',
        title: 'About',
        backLabel: '닫기',
        // 이름(배지 + 딱지 + ' 참교육')과 부제 — 첫 화면 제목과 같은 말이다 (brand.ts)
        sub: `${AI_BADGE_HTML} ${BRAND_CHIPS_HTML} 참교육 — ${esc(APP_TAGLINE)}`,
      })}
      <div class="about-body">
        <img class="about-robot" src="${robotNormal}" alt="AI 우회전" />
        <div class="about-text">
          <p>이 프로그램은 교통법규 중 지키기 힘든 부분을 <b>AI의 도움을 받아서 훈련</b>을 하는 프로그램입니다.</p>
          <p>아빠 차를 타며 헷갈리는 상황들을 많이 봤었습니다. 그리고 AI를 활용해서 훈련하는 곳을 만들면 많은 사람들이
            교통법규도 잘 지키고 안전하게 운전을 할 수 있을 것 같아서 만들게 되었습니다.</p>
          <p class="about-wish">AI를 통해서 안전한 도로가 되었으면 좋겠습니다.</p>
        </div>
      </div>
      <div class="about-maker">
        <span>만든 사람 <b>${esc(APP_AUTHOR)}</b></span>
        <span class="dot" aria-hidden="true">·</span>
        <a href="mailto:${esc(APP_CONTACT)}">${esc(APP_CONTACT)}</a>
        <span class="dot" aria-hidden="true">·</span>
        <span>${esc(APP_USAGE)}</span>
      </div>
    `;
    this.bindBack('about', onBack);
  }

  // ── 오픈소스 · 저작권 ─────────────────────────────────────────────────────

  renderCredits(onBack: () => void): void {
    /*
      **조건별 대수는 세어서 쓴다.** 손으로 적어 두면 모델을 하나 갈아 끼울 때마다
      설명문과 목록이 어긋나는데, 라이선스 표기가 어긋나는 것은 오탈자와 급이 다르다.
      (`assets/cars/<id>/license.txt` — Sketchfab 이 모델과 함께 주는 원본 표기가 근거다)
    */
    const nonCommercialCount = CAR_MODEL_CREDITS.filter((c) => c.license.includes('NC')).length;
    const freeCount = CAR_MODEL_CREDITS.length - nonCommercialCount;

    // 라이선스 이름도 목록에서 뽑는다 — 라이브러리를 갈아 끼우면 설명문이 따라와야 한다
    const ossLicenses = [...new Set(OSS_LIBRARIES.map((l) => l.license))].join(' 와 ');

    $('credits-body').innerHTML = `
      <!--
        이용 조건은 제목 바로 아래 **한 문단**에서 밝힌다(.credit-lede). 예전에는 같은 말이 머리말과
        별도 안내 박스로 나뉘어 있어 화면 위쪽에서 두 번 읽혔다. 만든 이유는 About 창이 맡는다.
      -->
      ${this.head({
        id: 'credits',
        title: '오픈소스 · 저작권',
        backLabel: '닫기',
        /*
          한때 제목 아래에 "이 홈페이지는 우회전이 너무 어려워서 만들게 되었습니다 …" 가 있었다. 만든 이유는 About 창이
          맡게 되어(renderAbout) 사용자가 여기서는 빼 달라고 했다 — 이 창은 무엇을 썼는지만 말한다.
        */
      })}

      <!--
        **한 화면에 다 들어오게 정리했다.** 예전에는 760px 창에 카드가 두 장씩 서서 소프트웨어 · 차량 모델 · 소리를
        보려면 한참 내려야 했다 — 사용자가 "스크롤을 내려야 하는데 가로 길이를 늘려 주고 정리해 줘" 라고 했다.
        설정 창처럼 넓히고(1180px), 카드는 한 줄에 다섯 장 남짓 서는 작은 카드로, 각 절의 설명은 제목 옆 한 줄로 붙였다.
        표기하는 내용(이름 · 라이선스 · 출처 · 제작자)은 하나도 빼지 않았다 — 줄만 합쳤다.
      -->
      <p class="credit-lede">
        이 홈페이지는 <b>비상업적으로만 사용됩니다.</b> 오픈소스를 사용하여 저작권과 라이선스를
        지키며 만들었습니다. 실제로 사용된 각각의 라이선스를 아래에 모두 표기 합니다.
        문제가 되는 사항이 있을 경우 연락을 주시면 즉시 조치 하도록 하겠습니다.
      </p>

      <!--
        **두 칸 + 아래 한 줄이다** — 왼쪽 소프트웨어(7), 오른쪽 차량 모델(9), 그 아래 전체 폭에 소리(4)를 한 줄로.
        세 절을 위아래로 쌓으면 넓힌 창에서도 한 화면을 넘었고, 소리를 왼쪽 칸에 함께 두니 왼쪽만 길어졌다.
        좁은 화면(900px 아래)에서는 한 칸으로 접힌다.
      -->
      <div class="credit-cols">
        <div class="credit-col">
      <section class="credit-sec">
        <div class="credit-h">
          <h2>소프트웨어</h2>
          <p>${esc(ossLicenses)} 라이선스로 공개된 소프트웨어를 사용합니다.</p>
        </div>
        <div class="credit-grid">
          ${OSS_LIBRARIES.map(
            (l) => `
            <div class="credit-card">
              <div class="credit-name">${esc(l.name)}
                <span class="badge ${l.license === 'MIT' ? 'pass' : 'new'}">${esc(l.license)}</span></div>
              <div>${esc(l.role)}</div>
              <a class="credit-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(
                l.url.replace(/^https?:\/\//, ''),
              )}</a>
            </div>`,
          ).join('')}
        </div>
      </section>
        </div>
        <div class="credit-col">
      ${
        CAR_MODEL_CREDITS.length
          ? `<section class="credit-sec">
               <div class="credit-h">
                 <h2>차량 3D 모델</h2>
                 <p>Sketchfab 에 <b>크리에이티브 커먼즈(CC)</b>로 공개된 모델 — ${freeCount}대는 상업적 이용까지
                   허용되는 CC BY, ${nonCommercialCount}대는 비상업(NC) 조건입니다.</p>
               </div>
               <div class="credit-grid">
                 ${CAR_MODEL_CREDITS.map(
                   (c) => `
                 <div class="credit-card">
                   <div class="credit-name">${esc(getCar(c.carId).name)}
                     ${c.license.includes('NC') ? '<span class="badge nc">비상업</span>' : ''}</div>
                   <a class="credit-link" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">${esc(c.title)}</a>
                   <div>제작 ${esc(c.author)} · <a class="credit-lic" href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">${esc(
                     c.license,
                   )}</a></div>
                 </div>`,
                 ).join('')}
               </div>
             </section>`
          : ''
      }
        </div>
      </div>

      <!--
        소리도 표기한다. 넷 다 CC0(퍼블릭 도메인)이라 표기 **의무**는 없지만,
        깜빡이 음원의 배포자가 원저작자를 밝혀 달라고 남겨 두었고 — 무엇보다 이 화면이
        "실제로 사용된 각각의 라이선스를 아래에 모두 표기" 한다고 말하고 있다.
        소리만 빼면 그 말이 거짓이 된다.
      -->
      <section class="credit-sec credit-wide">
        <div class="credit-h">
          <h2>사운드</h2>
          <p><b>CC0(퍼블릭 도메인)</b> 녹음본을 게임에 맞게 자르고 이어 붙였습니다. 타이어 마찰음 · 충돌음 · 결과
            알림음은 코드로 합성합니다.</p>
        </div>
        <div class="credit-grid">
          ${SOUND_CREDITS.map(
            (c) => `
          <div class="credit-card">
            <div class="credit-name">${esc(c.use)}</div>
            <a class="credit-link" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">${esc(c.title)}</a>
            <div>제작 ${esc(c.author)} · <a class="credit-lic" href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">${esc(
              c.license,
            )}</a></div>
          </div>`,
          ).join('')}
        </div>
      </section>
    `;
    this.bindBack('credits', onBack);
  }
}
