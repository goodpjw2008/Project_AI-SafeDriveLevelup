/**
 * 앱 컨트롤러. 화면 전환, 저장 데이터, 게임 인스턴스의 수명을 관리한다.
 */

import { GameAudio } from './game/Audio';
import robotNormal from './assets/airobot/normal.webp';
import { Controls, leaveToBrowser } from './game/Controls';
import { Game, type GameSnapshot } from './game/Game';
import type { ViewMode } from './game/CameraRig';
import { setPedestrianAlerts } from './game/Pedestrian';
import { setStopBands } from './game/StopMarkers';
import { setClusterStopCue } from './game/ClusterPanel';
import { AUTO_DRIVE_RULE, challengeRule } from './scenarios/challenge';
import { MenuScene } from './game/MenuScene';
import { SeatPreview } from './game/SeatPreview';
import { loadCarModel, trimCarModelCache, playerLod } from './game/carModel';
import { isHandheld, isHandheldLandscape } from './game/handheld';
import { icon } from './ui/icons';
import { NPC_PREWARM_CAR_ID } from './game/npcVehicles';
import { gpuName, setMsaaPreference, sharedRenderer } from './game/renderer';
import {
  CHROME_PLAY_STORE_URL,
  chromeFixedFrom,
  chromeFullVersion,
  chromeMajor,
  needsChromeUpdateNotice,
  vulkanXclipseChrome,
} from './game/browserQuirk';
import { presetGraphics, usesLampLights } from './game/quality';
import { setLampLights } from './game/TrafficLight';
import { bakeEnvironment } from './game/environment';
import { carForLevel, getCar } from './economy/cars';
import { ensureCarPhotos, hasCarPhoto, loadCarPhotos, uploadCarPhoto } from './economy/carPhotos';
import { settle } from './economy/reward';
import { load, save as persist, pushHistory, reset as resetSave, type SaveData } from './economy/save';
import { updateBadges } from './economy/badges';
import type { JudgeResult } from './rules/lawRules';
import {
  GENERATED_ID_BASE,
  getScenario,
  prepareScenario,
  rollLeadTurn,
  rollSchoolZoneTurn,
  rollZoneNoSignalTurn,
  SCENARIOS,
  stageLabel,
  type ScenarioSpec,
} from './scenarios/scenarios';
import {
  habitsTestedBy,
  libraryEntry,
  scenarioLibrary,
} from './scenarios/library';
import { zoneCourse } from './scenarios/zoneCourse';
import { offlineCourses } from './scenarios/offlineCourse';
import { scenarioByCode, scenarioCode } from './scenarios/scenarioCode';
import { practiceTrack } from './scenarios/trackPick';
import { generateScenario, type GeneratedScenario } from './scenarios/generate';
import {
  masterPick,
  noSignalZoneDue,
  priorityHabits,
  recommendScenario,
  type Picker,
  type RecentRun,
} from './scenarios/recommend';
import { advance, currentTarget, levelLabel, recordHabits, xpToNext } from './scenarios/curriculum';
import { abilityPriorFor, difficultyOf } from './ai/difficulty';
import { riskOf } from './ai/risk';
import { modelStep } from './ai/report';
import { OUTCOME_MODEL, learnerVector, predictOutcome } from './ai/outcome';
import { costOf } from './scenarios/difficulty';
import { summarize } from './coach/habits';
import { Hud } from './ui/Hud';
import { Screens, type AiTrainingState, type CourseStep } from './ui/Screens';
import { AiPickOverlay } from './ui/AiPick';
import { habitTitle } from './coach/badHabits';
import { nav } from './ui/nav';
import { beginRun, cachedSiteStats, endRun, loadSiteStats, outcomeOf } from './siteStats';

// index.html 의 file:// 안내 가드가 "스크립트가 실제로 실행됐는지"를 이 플래그로 판단한다.
// 단일 파일 빌드는 file:// 로 열려도 정상 동작하므로 안내가 뜨면 안 된다.
(window as unknown as { __TURN_RIGHT_BOOTED__?: boolean }).__TURN_RIGHT_BOOTED__ = true;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
// 시트 바깥을 누르면 한 칸 되돌아간다 — 어디로 돌아가는지는 히스토리가 안다
const screens = new Screens({ onDismiss: () => nav.back() });
/** AI 가 코스를 고르는 장면 — 분석 연출 → 추천 결과 (ui/AiPick.ts) */
const aiPick = new AiPickOverlay();
const hud = new Hud();
const audio = new GameAudio();

let saveData: SaveData = load();
let game: Game | null = null;
/**
 * 첫 화면 뒤에서 도는 배경 장면.
 *
 * 화면 레이어가 반투명이라(index.html 의 `.screen`) 메뉴·전시관·도움말을 보는 동안
 * 이것이 뒤에서 흐릿하게 돈다. 주행이나 좌석 맞추기가 시작되면 버린다 — 캔버스가
 * 하나뿐이라 두 곳에서 그리면 서로의 그림을 덮어쓴다.
 */
let menuScene: MenuScene | null = null;
/**
 * 좌석 맞추기 화면이 떠 있는 동안만 값이 있다.
 *
 * 주행용 단축키(R·Esc)는 Controls 의 enabled 와 무관하게 항상 동작한다. 좌석을 맞추는
 * 중에 R 이 주행을 시작해 버리면 안 되므로 이 값으로 막는다.
 */
let seatPreview: SeatPreview | null = null;
/**
 * 열려 있는 좌석 화면을 치우는 함수 (renderSeatPreview 가 넣어 둔다).
 *
 * 뒤로가기로 이 화면을 떠나면 다음 화면의 `enter` 가 곧바로 불리는데, 그때 좌석 화면이
 * 그대로 살아 있으면 같은 캔버스를 두 곳에서 그린다. 바깥에서도 치울 수 있어야 한다.
 */
let seatTeardown: ((save: boolean) => void) | null = null;
let currentScenario: ScenarioSpec | null = null;
let paused = false;
/**
 * AI 자율 주행 중인가.
 *
 * 켜져 있으면 사람 입력 대신 AutoDriver 가 운전하고(Game 의 autoDrive 옵션), 판이
 * 끝나면 **자동 넘김 설정과 무관하게** 다음 Stage 로 이어 간다 — 08번까지 한 번에
 * 보여 주는 것이 이 기능이다. 첫 화면으로 나가면 꺼진다.
 */
let aiDriving = false;

/**
 * AI 맞춤 훈련 — 만들어 둔 판과 그 상태.
 *
 * **저장하지 않는다.** 판을 만드는 근거가 "지금까지의 주행 기록" 이라, 다음에 열었을 때는
 * 기록이 달라져 있고 그때는 그때의 약점으로 새로 만드는 편이 맞다. 지난번에 만든 판을
 * 다시 보여 주면 이미 고친 습관을 계속 연습하게 된다.
 */
const aiTraining: AiTrainingState = {
  made: [],
  busy: false,
  unavailable: false,
  error: null,
  curriculum: saveData.curriculum,
};

/**
 * AI 주행 중인가 — 판이 끝나면 **다음 판을 이어서 만들지** 정한다.
 *
 * 수동 주행과 갈라 두는 이유는 같은 판이라도 끝난 뒤 할 일이 다르기 때문이다.
 * 수동은 다음 Stage 로 넘어가고, AI 는 방금 결과로 단계를 올리거나 내린 뒤 그에 맞는
 * 판을 새로 만든다.
 */
let aiCourse = false;
/** 이번 접속에서 무위반으로 통과한 판 — AI 가 새로 만든 판의 '다시 통과' 를 가린다 (finishRun 의 clearedBefore) */
const clearedThisSession = new Set<number>();

/**
 * **맵 체험 중인가** — 첫 화면에서 시나리오 번호를 넣어 고른 판 (Screens 의 맵 체험하기).
 *
 * 사용자가 부탁했다: "시나리오 번호를 넣으면 그 맵을 체험하는 거야. 그러면 네가 수정한 것을 실제 환경에서
 * 테스트할 수 있을 것 같아." 고친 판을 **골라서 곧바로** 달려 보는 자리다.
 *
 * **학습자의 기록이 아니다.** 레벨 · 경험치 · 나쁜 운전 습관 · 주행 기록 · 통계에 하나도 남기지 않는다 —
 * 시범 주행(`aiDriving`)과 같은 규칙이다. 남기면 특정 판을 되풀이해 시험한 것이 AI 추천의 근거(습관 ·
 * 경험 커버리지 · 최근 판)로 섞여, 다음 판을 고르는 판단이 흐려진다. 그리고 AI 가 고른 판이 아니므로
 * 화면에서 'AI 추천' 이라고 부르지 않는다.
 */
let mapTrial = false;

/** 방금 끝난 판으로 안전운전 마스터가 됐는가 — 결과 화면이 한 번 축하하고 끈다 */
let justMastered = false;

/**
 * **AI 자율 주행 시범**에서 돌 코스 (scenarios/offlineCourse.ts 의 `offlineCourses`) — 앞에서부터 하나씩 꺼낸다.
 * 비어 있으면 시범이 아니다.
 */
let demoQueue: number[] = [];

/**
 * **결과 화면에서 이어 달리는 중인가** — 그러면 새 주행이 그 자리를 넘겨받는다 (goRun 의 `replace`).
 *
 * 첫 화면에서 누르면 새 칸이고, 결과 화면의 '다음 판' 에서 오면 그 자리다. 이걸 구분하지 않아 AI 과정의
 * 판마다 칸이 하나씩 쌓였고, 그래서 '홈으로' 가 **지나온 결과 화면**으로 갔다 (goHome 주석).
 */
const continuing = (): boolean => nav.current !== 'menu';

/**
 * 지금 단계에 맞는 판을 하나 만들어 태운다.
 *
 * 만들어진 판은 **검증기와 난이도 검사를 통과한 것만** 돌아온다 (scenarios/generate.ts).
 * 그래서 여기서는 결과를 그대로 목록에 넣고 바로 태운다 — 실행해도 되는지는 이미 확인된 뒤다.
 */
async function makeAiScenario(): Promise<void> {
  if (aiTraining.busy) return;
  aiTraining.busy = true;
  aiTraining.error = null;

  /*
    **덮개를 먼저 씌운다.** 모델 호출은 2~5초가 걸리는데, 그동안 메뉴가 그대로 보이면
    누른 것이 먹혔는지 알 수 없어 다시 누르게 된다. 판을 만들고 나서 곧바로 주행 준비
    덮개로 이어지므로(startRun) 그 사이가 끊기지도 않는다.

    `renderMenu()` 도 함께 부른다 — 만들다 실패해 돌아왔을 때 버튼이 '만드는 중' 인 채로
    남아 있으면 안 되기 때문이다.
  */
  const c = saveData.curriculum;
  /*
    **메뉴를 먼저 그리고 덮개를 나중에 씌운다.** renderMenu → disposeGame → hideLoading
    순으로 불려서, 순서를 바꾸면 방금 씌운 덮개가 그 자리에서 걷힌다.
  */
  renderMenu();
  const zoneTurn = rollSchoolZoneTurn();
  /*
    **신호기 없는 보호구역이 몇 판째 없었으면 이번 판은 반드시 그 판이다** (recommend.ts 의 `noSignalZoneDue`).
    사용자가 "10판 넘게 했는데 한번도 나오지 않았어" 라고 짚었다 — 차례 확률과 고칠 습관 때문에 연달아 빠질 수 있었다.
  */
  const noSignalDue = noSignalZoneDue(saveData.history.map((r) => r.st));
  /*
    **무엇을 연습하는 갈래인가** (scenarios/tracks.ts) — 기본은 **자동**이고, AI 가 고칠 습관과 기록을
    보고 고른다. 우회전 전용이면 보호구역 차례를 아예 굴리지 않는다: 그 갈래에는 보호구역 판이 없어,
    차례만 서고 판은 안 나오면 "보호구역 차례인데 우회전 판" 이라는 어긋난 설명이 화면에 뜬다.
  */
  const track = practiceTrack(saveData).track;
  const zoneDueHere = noSignalDue && track !== 'turn';
  const plan = {
    level: c.level,
    track,
    target: currentTarget(c),
    badHabits: c.badHabits,
    /*
      **보호구역은 네 판에 한 판이다** (scenarios.ts 의 `SCHOOL_ZONE_CHANCE`).

      AI 에게 고르기를 맡기기 **전에** 굴린다 — 비율은 여러 판에 걸쳐 나타나는 성질이라
      판 하나를 고르는 모델이 맞출 수 있는 것이 아니다.
    */
    schoolZone: track === 'turn' ? false : zoneTurn || zoneDueHere,
    /*
      **보호구역이 나올 차례면 신호기 유무도 여기서 굴린다** (scenarios.ts 의 `ZONE_NO_SIGNAL_CHANCE`).

      이 게임의 핵심은 제27조 제7항 — 신호기 없는 보호구역 횡단보도는 사람이 없어도 선다 — 인데,
      고르는 쪽이 보호구역을 불리언 하나로만 보아 절반이 신호 있는 판이었다 (사용자가 짚었다).

      **차례가 아닐 때도 굴린다.** 새 개념을 여는 레벨과 종합 레벨에서는 보호구역 차례가 아니어도
      보호구역 판이 섞여 들어오기 때문이다 (recommend.ts 의 `zoneOk` 예외).
    */
    zoneNoSignal: track === 'turn' ? undefined : zoneDueHere || rollZoneNoSignalTurn(),
    noSignalZoneDue: zoneDueHere,
    /* **앞차 차례도 여기서 굴린다** (scenarios.ts 의 `rollLeadTurn`) — 보호구역과 같은 이유다 */
    lead: rollLeadTurn(),
    /* 설정의 난이도 1~5 — 같은 레벨 안에서 얼마나 복잡한 코스를 고를지 (scenarios/challenge.ts) */
    challenge: saveData.settings.difficulty,
    // 필요한 양이 나중에 줄면(곡선 · 난이도를 바꿨을 때) 저장된 값이 넘친다 — AI 에게도 잘라서 준다 (ui/playerCard.ts)
    xp: Math.min(c.xp ?? 0, xpToNext(c.level, challengeRule(saveData.settings.difficulty))),
    xpNeed: xpToNext(c.level, challengeRule(saveData.settings.difficulty)),
    cleanStreak: c.cleanStreak,
    missStreak: c.missStreak,
    // 학습자 모델 · 능력 (ai/knowledge.ts · ai/difficulty.ts) — 후보 점수와 AI 프롬프트가 읽는다
    skills: c.skills ?? {},
    ability: c.ability ?? abilityPriorFor(c.level),
    outcomeBias: c.outcomeBias,
  };
  /*
    **AI 가 시나리오 라이브러리에서 고른다** (scenarios/recommend.ts).

    라이브러리의 1,200판은 모두 검증을 통과한 판이라, 고른 판은 그대로 태운다. AI 를 쓸 수
    없으면(서버 없음 · 응답 없음) 코드가 점수로 고른다 — 판이 없어서 멈추는 일은 없다.

    **무슨 일이 있어도 '고르는 중' 은 풀린다.** 예외가 나면 예전처럼 모델에게 판을 새로
    만들게 한다 (generate.ts) — 그마저 안 되면 메뉴로 돌아가 다시 누를 수 있게 한다.
  */
  let outcome: Awaited<ReturnType<typeof generateScenario>>;
  /*
    **마스터 운행** — L10 을 마치면 '처음부터 다시 시작' 을 누르기 전까지 L10 코스가 무작위로 이어진다 (recommend.ts 의
    masterPick). 고칠 습관도 오를 레벨도 없어 AI 분석 연출은 건너뛰고, 곧바로 고른 판의 카드를 띄운다(startRun).
  */
  if (c.mastered) {
    const recentIds = [...saveData.history.map((r) => r.st), ...aiTraining.made.map((s) => s.id)];
    // 마스터 운행 — 학습자 모델이 가장 옅어진 개념을 시험하는 코스에서 고른다 (recommend.ts)
    const pick = masterPick(recentIds, Math.random, c.skills);
    aiTraining.busy = false;
    aiTraining.made.push(pick.scenario);
    aiCourse = true;
    goRun(pick.scenario.id, continuing());
    return;
  }
  try {
    const history = saveData.history;
    const recent: RecentRun[] = history.slice(-8).map((r) => ({
      title: recordTitle(r.st),
      grade: r.g,
      violations: r.v,
    }));
    const recentIds = [...history.map((r) => r.st), ...aiTraining.made.map((s) => s.id)];
    /*
      **AI 가 하는 일을 순서대로 보여 준다** (ui/AiPick.ts) — 숫자와 습관 이름은 실제 값이다.
      마지막 단계는 AI 의 답이 올 때까지 돈다.
    */
    let counts = { candidates: 0, courses: 0 };
    /*
      마지막 인자는 **실제로 탄 판**이다 — `recentIds` 에는 추천만 되고 아직 안 탄 판이 섞여 있어
      (aiTraining.made), 경험 커버리지가 그것을 "겪었다" 로 세면 거짓이 된다 (recommend.ts 의 coverageOf).
    */
    const picking = recommendScenario(
      plan,
      summarize(history),
      recent,
      recentIds,
      (n) => (counts = n),
      history.map((r) => r.st),
    );
    /*
      **답이 오는 순간 분석 화면의 제목에 그 AI 이름을 띄운다** (ui/AiPick.ts 의 setAnalyst).
      시작할 때는 어느 자리가 받을지 알 수 없어서(server/llm.mjs 가 자리를 돌려 쓴다) 이렇게 뒤늦게 갈아 끼운다.
    */
    void picking.then((r) => aiPick.setAnalyst(r.picker, r.model)).catch(() => undefined);
    // 습관이 둘 이상이면 **먼저 고칠 습관을 AI 가 정한다** (recommend.ts 의 coursesByHabit) — 단계 글도 그렇게 말한다
    const many = priorityHabits(plan).length >= 2;
    const habitsText = c.badHabits.length
      ? c.badHabits.slice(0, 2).map((h) => habitTitle(h.code)).join(' · ') + (c.badHabits.length > 2 ? ' 외' : '')
      : '기록된 나쁜 습관 없음 — 다음 레벨 준비';
    await aiPick.analyze(
      [
        history.length ? `주행 기록 ${history.length}판을 읽는 중` : '첫 주행입니다 — 기본 판단부터 확인하는 중',
        `나쁜 운전 습관 분석 — ${habitsText}`,
        () =>
          many
            ? `시나리오 ${scenarioLibrary().length.toLocaleString()}개 중 습관 ${priorityHabits(plan).length}가지를 고칠 ${counts.candidates.toLocaleString()}개 추리기`
            : `시나리오 ${scenarioLibrary().length.toLocaleString()}개 중 ${levelLabel(c.level)}에 맞는 ${counts.candidates.toLocaleString()}개 추리기`,
        // 결과 예측 모델(ai/outcome.ts) — 후보마다 어길 확률과 표를 붙인다. 학습자 모델이 시험된 개념이 없는 첫 판에도 돈다
        () =>
          OUTCOME_MODEL
            ? `결과 예측 모델 — 후보 ${counts.courses}개마다 어길 확률과 표(약점 시험 · 근접 발달 · 복습 · 새로움)를 붙이는 중`
            : `난이도 모델 — 후보 ${counts.courses}개마다 예상 성공률을 세는 중`,
        () =>
          many
            ? `AI 가 먼저 고칠 습관을 정하고 후보 ${counts.courses}개 중 코스를 고르는 중`
            : `AI 가 후보 ${counts.courses}개 중 가장 필요한 코스를 고르는 중`,
      ],
      picking,
    );
    const rec = await picking;
    console.info(`[recommend] ${rec.source}:`, rec.scenario.title);
    aiPick.showResult({
      title: rec.scenario.title,
      code: scenarioCode(rec.scenario.id),
      why: rec.scenario.why,
      focus: rec.scenario.focus,
      // 어느 AI 의 어느 모델이 골랐는지 카드가 그대로 말한다 (ui/AiPick.ts · 무료 여러 곳을 돌아가며 쓴다)
      picker: rec.picker,
      model: rec.model,
      habit: rec.habit ? habitTitle(rec.habit) : undefined,
      habitByAi: rec.habitBy === 'ai',
      success: rec.scenario.success,
      predict: rec.scenario.predict,
    });
    outcome = { scenario: rec.scenario, tries: 1, rejected: [], reason: 'ok' };
  } catch (e) {
    console.error('[recommend] 추천 중 예외 — 판을 새로 만든다', e);
    aiPick.hide();
    showLoading('AI 가 맵을 새로 만드는 중', { title: 'AI가 운전습관을 분석해 맵을 만들고 있습니다…', immediate: true });
    try {
      outcome = await generateScenario(summarize(saveData.history), aiTraining.made, plan);
    } catch (e2) {
      console.error('[scenario] 판 만들기 중 예외', e2);
      outcome = { scenario: null, tries: 0, rejected: [], reason: 'invalid' };
    }
  } finally {
    aiTraining.busy = false;
  }

  if (outcome.scenario) {
    aiTraining.made.push(outcome.scenario);
    aiCourse = true;
    /*
      **여기서 메뉴를 다시 그리지 않는다.** renderMenu 는 hideLoading 을 부르는데,
      곧바로 주행 준비로 넘어가므로 그 사이 덮개가 한 번 걷혔다 다시 씌워진다 —
      화면이 깜빡인다. 목록은 나중에 메뉴로 돌아올 때 어차피 다시 그려진다.
    */
    goRun(outcome.scenario.id, continuing());
    return;
  }

  // 만들지 못했다 — 덮개를 걷고 메뉴로 돌려준다 (성공 시에는 startRun 이 이어받는다)
  hideLoading();
  aiPick.hide();

  if (outcome.reason === 'no-server') {
    /*
      서버가 없는 배포다 (정적 호스팅 · 단일 파일). 추천은 서버 없이도 코드가 고르므로
      (recommend.ts) 여기까지 오는 것은 그 추천마저 예외로 끝났을 때뿐이다. 과정을 감추지는
      않는다 — 그러면 첫 화면에 누를 것이 없어진다.
    */
    aiTraining.error = '코스를 준비하지 못했습니다. 잠시 뒤 다시 눌러 보세요.';
  } else {
    /*
      만들긴 했는데 **검증을 통과하지 못했다.** 이건 감출 일이 아니라 알릴 일이다 —
      "규정대로 몰면 통과할 수 있는 판" 을 못 만들었다는 뜻이고, 그 확인이 이 기능의
      핵심이기 때문이다. 걸러 냈다는 사실 자체가 사용자에게 알릴 값어치가 있다.
    */
    aiTraining.error = `쓸 만한 판을 만들지 못했습니다 (${outcome.tries}번 시도). 잠시 뒤 다시 눌러 보세요.`;
  }
  renderMenu();
}

/** AI 자율 주행을 끈다. 화면을 떠날 때마다 부른다. */
function stopAiDriving(): void {
  aiDriving = false;
  demoQueue = [];
  document.body.classList.remove('ai-drive');
}

/** 좌석 맞추기를 **저장하지 않고** 걷는다. 열려 있지 않으면 아무 일도 하지 않는다. */
function disposeSeatPreview(): void {
  seatTeardown?.(false);
}

// ── 자동 넘김 ──────────────────────────────────────────────────────────────

/**
 * 결과 화면에서 다음 Stage 까지 세는 시간 (초).
 *
 * **5초다.** 더 짧으면 등급과 점수를 읽기도 전에 넘어가고, 더 길면 "왜 안 넘어가지"
 * 하고 버튼을 찾게 된다. 읽을 것이 더 있는 사람은 체크를 끄면 그 자리에서 멈춘다.
 */
/*
  결과 화면을 읽을 틈 — **7초**. 한때 5초였는데, 화면 맨 위의 AI 주행결과 분석(개조식 2~4줄)을 읽고 나면
  다음 판으로 넘어가 버렸다 (사용자가 늘렸다).
*/
const AUTO_NEXT_SECONDS = 7;

let autoNextTimer = 0;
/** 남은 초. 멈췄다가 다시 이어 셀 때 이 값에서 계속한다. */
let autoNextLeft = 0;
/** 사람이 붙잡아 둔 상태인가 (이번 화면에만 해당 — 저장값은 건드리지 않는다) */
let autoNextHeld = false;
/** 다 세면 시작할 판 */
let autoNextTarget = 0;

/**
 * 남은 초를 세다가 다음 Stage 를 시작한다.
 *
 * `setInterval` 한 벌만 쓴다 — 화면에 그리는 것과 실제로 넘기는 것이 같은 시계를 봐야
 * "1" 을 보여 놓고 2초 뒤에 넘어가는 일이 없다.
 */
function startAutoNext(nextId: number): void {
  stopAutoNext();
  /*
    **결과 화면에 있을 때만 센다.** 세기 시작하는 때는 코치 문장이 도착한 뒤인데(onCoachReady), AI 가 답을 쓰는
    사이 '홈으로' 를 누르면 그 알림이 **첫 화면에 온 뒤에** 온다. 결과 화면은 감춰졌을 뿐 문서에 남아 있어 코치
    칸이 채워지고 알림도 그대로 온다 — 그때 세기 시작해 첫 화면에서 다음 판이 저절로 시작됐다 (사용자가 짚었다).
    첫 화면이 stopAutoNext 로 시계를 끄는 것만으로는 막을 수 없다 — 그보다 **나중에** 켜지기 때문이다.
  */
  if (nav.current !== 'debrief') return;
  autoNextTarget = nextId;
  autoNextLeft = AUTO_NEXT_SECONDS;
  autoNextHeld = false;
  screens.setAutoNextCountdown(autoNextLeft);
  runAutoNextClock();
}

/** 시계를 건다. 멈췄다 이어 셀 때도 이것을 다시 부른다. */
function runAutoNextClock(): void {
  if (autoNextTimer) window.clearInterval(autoNextTimer);
  autoNextTimer = window.setInterval(() => {
    // 결과 화면을 떠났는데 시계가 남아 있다 — 어느 길로 떠났든 넘기지 않는다 (위 startAutoNext 와 같은 까닭)
    if (nav.current !== 'debrief') {
      stopAutoNext();
      return;
    }
    autoNextLeft -= 1;
    if (autoNextLeft <= 0) {
      const next = autoNextTarget;
      stopAutoNext();
      /*
        AI 과정에서는 '다음' 이 **다음 번호의 판이 아니라 다음에 만들어질 판**이다.
        번호를 하나 올려 봐야 그런 판은 없다.
      */
      if (aiCourse) void makeAiScenario();
      else goRun(next, true);
      return;
    }
    screens.setAutoNextCountdown(autoNextLeft);
  }, 1000);
}

/**
 * 세던 것을 붙잡거나 놓아 준다 (결과 화면의 멈춤 버튼).
 *
 * **체크를 끄는 것과 다른 일이다.** 체크는 "앞으로도 자동으로 넘기지 마라"는 뜻이라
 * 저장되어 다음 판부터도 계속 꺼져 있고, 이쪽은 이번 화면만 붙잡아 둔다.
 * 남은 초는 그대로 두어, 다시 누르면 멈춘 자리에서 이어서 센다.
 */
function toggleAutoNextHold(): void {
  if (!autoNextLeft) return;
  autoNextHeld = !autoNextHeld;
  if (autoNextHeld) {
    window.clearInterval(autoNextTimer);
    autoNextTimer = 0;
  } else {
    runAutoNextClock();
  }
  screens.setAutoNextCountdown(autoNextLeft, autoNextHeld);
}

/**
 * 세던 것을 멈추고 표시도 지운다.
 *
 * **화면을 떠날 때마다 부른다.** 결과 화면을 벗어난 뒤에도 시계가 살아 있으면, 전시관을
 * 보고 있거나 이미 다른 판을 달리는 중에 갑자기 다음 Stage 가 시작된다.
 */
function stopAutoNext(): void {
  if (autoNextTimer) window.clearInterval(autoNextTimer);
  autoNextTimer = 0;
  autoNextLeft = 0;
  autoNextHeld = false;
  screens.setAutoNextCountdown(null);
}

// 터치 기기 판별 — 마우스가 없는 기기에만 터치 컨트롤을 띄운다
if (window.matchMedia('(pointer: coarse)').matches) {
  document.body.classList.add('touch');
}

/*
  ── 전체 화면 토글 (휴대폰) ──────────────────────────────────────────────

  브라우저의 주소창이 작은 화면을 더 좁힌다 (사용자가 짚었다: *"모바일 화면은 URL 주소 부분이 있어서 작은 화면을 보는 데
  효율적이지 못하다"*). 첫 화면 윗줄과 주행 HUD 에 **같은 버튼**이 하나씩 있다 — 누르면 전체 화면, 전체 화면에서는
  '주소창 보기' 가 되어 되돌아온다. 전체 화면은 화면을 오가도 유지되므로 첫 화면에서 켜고 달리면 그대로다.

  상태는 `fullscreenchange` 로 맞춘다 — 뒤로 제스처로 나가도 버튼 글이 따라간다. API 가 없는 브라우저(아이폰
  사파리)에서는 body 에 표시를 붙여 CSS 가 버튼을 감춘다 (index.html 의 .fs-toggle).
*/
function fullscreenSupported(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
}
function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  } else {
    void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  }
}
/**
 * 전체 화면으로 들어갈 때 **우리 말로 나가는 길을 알린다** (사용자가 글을 정했다 — 세로 · 가로가 다르다).
 * 크롬이 띄우는 흰 상자("상단에서 드래그한 후 뒤로 버튼을 터치하세요")는 브라우저의 것이라 페이지가 바꾸거나
 * 없앨 수 없다. 그래서 그 옆에 우리 상자를 한 번 더 띄운다 — 몇 초 뒤 사라지고, 전체 화면을 나가면 곧 걷는다.
 */
let fsNoticeTimer = 0;
/*
  **문제 크롬 빌드 + 삼성 Xclipse 안내** — 그 조합(game/browserQuirk.ts 의 needsChromeUpdateNotice: 151 전부 · 152.0.7977.64 앞)에서만, 세션에 한 번,
  첫 화면에 띄운다. 크롬을 올리면 사라지는 것을 사용자가 확인했다(2026-09-26). 손은 업데이트 하나다 (삼성 인터넷 대안은 뺐다).
  GPU 문자열은 렌더러가 있어야 읽을 수 있다 — 첫 화면의 배경 장면이 렌더러를 만든 뒤(renderMenu) 부른다.
*/
let gpuNoticeDecided = false;
function maybeShowGpuNotice(): void {
  if (gpuNoticeDecided) return;
  const el = document.getElementById('gpu-notice');
  if (!el) return;
  gpuNoticeDecided = true;
  const gpu = gpuName(sharedRenderer(canvas));
  const ua = navigator.userAgent;
  // GPU · 브라우저 조합이 아니면 여기서 끝 — 대부분의 기기는 Client Hints 를 묻지도 않는다
  if (!vulkanXclipseChrome(gpu, ua)) return;
  /*
    빌드 번호는 UA 에 없어(153.0.0.0 으로 줄어 있다) Client Hints 로 비동기로 묻는다. 153 은 안정판 전부에 완화가 들어 있어
    사용자 폰(153.0.8010.53)에는 뜨지 않아야 하고, 152 는 .64 앞의 빌드에만 뜬다 (browserQuirk.ts 의 표).
  */
  void chromeFullVersion().then((full) => {
    if (!needsChromeUpdateNotice(gpu, ua, full)) return;
    const major = chromeMajor(ua);
    const update = document.getElementById('gpu-notice-update') as HTMLAnchorElement | null;
    if (update) update.href = CHROME_PLAY_STORE_URL;
    const text = document.getElementById('gpu-notice-text');
    if (text) {
      text.textContent =
        `지금 크롬(${full ?? major})의 알려진 문제로, 크롬 ${chromeFixedFrom(major)} 부터 고쳐졌습니다. ` +
        '플레이 스토어에서 크롬을 업데이트해 주세요.';
    }
    document.getElementById('gpu-notice-close')?.addEventListener('click', () => el.classList.remove('show'));
    el.classList.add('show');
  });
}

function showFullscreenNotice(on: boolean): void {
  const el = document.getElementById('fs-notice');
  if (!el) return;
  window.clearTimeout(fsNoticeTimer);
  if (!on || !isHandheld()) {
    el.classList.remove('show');
    return;
  }
  el.textContent = isHandheldLandscape()
    ? '전체 화면을 종료하려면 상단에서 주소창 보기를 눌러주세요.'
    : '전체 화면을 종료하려면 우회전 옆의 전체화면/주소화면 전환 아이콘을 눌러주세요.';
  el.classList.add('show');
  fsNoticeTimer = window.setTimeout(() => el.classList.remove('show'), 5000);
}
function syncFullscreenButtons(): void {
  const on = !!document.fullscreenElement;
  showFullscreenNotice(on);
  const label = on ? '주소창 보기' : '전체 화면';
  for (const b of document.querySelectorAll<HTMLButtonElement>('.fs-toggle')) {
    b.title = label;
    b.setAttribute('aria-label', label);
    // HUD 알약은 두 조각으로 — 세로 화면에서 두 줄('주소창' / '보기')로 세운다 (index.html 의 세로 규칙). 가로는 한 줄 그대로
    if (b.classList.contains('hud-fullscreen')) {
      b.innerHTML = on ? '<span>주소창</span> <span>보기</span>' : '<span>전체</span> <span>화면</span>';
    }
    else b.innerHTML = icon(on ? 'fullscreenExit' : 'fullscreen');
  }
}
if (!fullscreenSupported()) document.body.classList.add('no-fullscreen-api');
document.addEventListener('fullscreenchange', syncFullscreenButtons);
/**
 * **주행을 누르면 저절로 전체 화면** (휴대폰만 — 사용자가 정했다). 전체 화면 요청은 **손가락이 닿은 그 처리 안에서**만
 * 받아들여지므로, 버튼의 클릭 처리에서 곧바로 부른다 — AI 가 판을 고르는 동안(비동기)을 지나면 늦다. 자동 넘김처럼
 * 손가락 없이 시작되는 판에서는 요청이 조용히 거절될 뿐이다. 이미 전체 화면이면 아무 일도 하지 않는다.
 */
function enterFullscreenOnHandheld(): void {
  if (!isHandheld() || !fullscreenSupported() || document.fullscreenElement) return;
  void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
}
document.getElementById('btn-hud-fullscreen')?.addEventListener('click', toggleFullscreen);

const controls = new Controls(canvas, {
  // 손에 든 화면은 시점을 바꾸지 않는다 — 후방 시점 고정 (아래 startViewOfRun)
  onToggleView: () => {
    if (!isHandheld()) game?.cycleView();
  },
  // 깜빡이는 판을 시작할 때 저절로 켜지고 끄는 조작이 없다 — 휴대폰으로 하는 게임이라 변수에서 뺐다 (사용자 결정 2026-09-27)
  onToggleSignal: () => void audio.resume(),
  onRestart: () => {
    if (seatPreview) return; // 좌석 맞추기 중에는 R 이 '기본 자리로'다
    if (currentScenario && screens.active === 'none') void startRun(currentScenario.id);
  },
  onPause: () => togglePause(),
  onLook: (dx, dy) => game?.look(dx, dy),
  onGlance: (dir) => game?.setGlance(dir),
  onRecenter: () => game?.recenterLook(),
  onStopChange: () => syncGoStop(),
});

for (const [id, action] of [
  ['t-left', 'left'],
  ['t-right', 'right'],
] as const) {
  const el = document.getElementById(id);
  if (el) controls.attachSteerButton(el, action);
}

/*
  **방향키 ↑ 출발 · ↓ 정지** — 키보드의 ↑ · ↓ 와 같다 (사용자 요청). 한 번 누르면 그 상태로 있으므로 신호를 기다리는
  동안 손가락을 계속 대고 있지 않아도 된다. 지금 상태의 버튼에 불이 들어온다 (index.html 의 #t-up.on · #t-down.on).
*/
function syncGoStop(): void {
  document.getElementById('t-up')?.classList.toggle('on', !controls.isStopped);
  document.getElementById('t-down')?.classList.toggle('on', controls.isStopped);
}
for (const [id, stop] of [
  ['t-up', false],
  ['t-down', true],
] as const) {
  document.getElementById(id)?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    void audio.resume();
    controls.setStopped(stop);
  });
}

// 주행 중 '홈으로' — 판을 버리고 첫 화면으로 돌아간다.
// HUD 안에 있는 정적 요소라 여기서 한 번만 붙인다 (goMenu 가 HUD 를 숨긴다).
document.getElementById('btn-hud-home')?.addEventListener('click', () => goHome());

window.addEventListener('resize', () => {
  // 주행 중이면 다음 그리기 직전으로 미룬다 — 그린 뒤에 캔버스를 바꾸면 빈 버퍼가 화면에 올라간다 (Game 의 requestResize)
  game?.requestResize();
  menuScene?.resize();
});

// ── 저장 ───────────────────────────────────────────────────────────────────

function commit(): void {
  persist(saveData);
}

// ── 화면 전환 ──────────────────────────────────────────────────────────────

/*
  화면 하나가 **히스토리 한 칸**이다 (nav.ts).

  아래 `render…` 함수들은 화면을 그리기만 한다 — 히스토리는 건드리지 않는다. 그래야
  같은 함수를 두 가지 목적에 쓸 수 있다.

    · 새 화면으로 **들어갈 때**       nav.go({ name, enter: renderShop })
    · 그 자리에서 **다시 그릴 때**     renderShop()      ← 히스토리가 늘지 않는다

  차를 갈아타거나 설정을 고르면 화면을 다시 그려야 하는데, 그때마다 히스토리가 쌓이면
  뒤로가기를 열 번 눌러야 전시관을 빠져나가게 된다.
*/

/** 첫 화면 배경 — 이미 돌고 있으면 그대로 둔다 */
function ensureMenuScene(): void {
  // 주행 중이거나 좌석을 맞추는 중이면 그쪽이 캔버스를 쓴다
  if (menuScene || game || seatPreview) return;
  menuScene = new MenuScene(canvas, getCar(saveData.activeCarId));
  menuScene.start();
}

function disposeMenuScene(): void {
  menuScene?.dispose();
  menuScene = null;
}

function renderMenu(): void {
  stopAutoNext();
  stopAiDriving();
  // 첫 화면으로 돌아오면 맵 체험도 끝난다 — 다음에 누르는 'AI 안전운전 연습' 이 체험으로 이어지지 않게
  mapTrial = false;
  document.body.classList.remove('map-trial');
  disposeGame();
  // 추천 장면이 떠 있는 채로 첫 화면에 왔으면(준비 중에 뒤로 가기 등) 걷는다
  aiPick.hide();
  disposeSeatPreview();
  // 첫 화면의 배경 장면을 만들기 전 — 장면이 없는 이 순간에 모델 캐시를 상한까지 비운다 (carModel.ts 의 trimCarModelCache)
  trimCarModelCache([saveData.activeCarId]);
  // 주행 중에 나왔을 수 있다 — 키 입력을 끊지 않으면 메뉴에서 누른 방향키가 그대로 먹힌다
  controls.setEnabled(false);
  hud.hide();
  maybeShowGpuNotice();
  ensureMenuScene();
  screens.show('menu');
  // 사진 목록을 못 받은 채 켜졌으면 다시 받아, 받는 대로 '지금 타는 차' 사진을 채운다
  ensureCarPhotos(() => {
    if (nav.current === 'menu') renderMenu();
  });
  screens.renderMenu(saveData, {
    /*
      AI 자율 주행 시범 — 라이브러리의 **대표 코스**를 AI 가 차례로 규정대로 몬다.

      "규정대로 하면 이렇게 된다" 를 보여 주는 기능이라 레벨 · 잠금과 무관하게 돈다.
      적색 · 보행자 · 우회전 신호등 · 보호구역 · 앞차 · 꼬리물기를 한 바퀴에 모두 보여 준다.
    */
    onAiDrive: () => {
      aiDriving = true;
      aiCourse = false;
      // **열 판, 사용자가 정한 차례 그대로** (scenarios/offlineCourse.ts) — 교차로 여덟 + 보호구역 전용 도로 둘
      demoQueue = offlineCourses().map((e) => e.spec.id);
      goRun(demoQueue[0]);
    },
    onShop: () => nav.go({ name: 'shop', enter: renderShop }),
    onHelp: () => nav.go({ name: 'help', enter: renderHelp }),
    onZoneHelp: () => nav.go({ name: 'zone-help', enter: renderZoneHelp }),
    onCredits: () => nav.go({ name: 'credits', enter: renderCredits }),
    onAbout: () => nav.go({ name: 'about', enter: renderAbout }),
    onSettings: () => nav.go({ name: 'settings', enter: renderSettings }),
    onFullscreen: toggleFullscreen,
    onReport: () => nav.go({ name: 'report', enter: renderReport }),
    // 마스터면 L10 코스를 무작위로 이어 달린다 (makeAiScenario 의 마스터 운행)
    onGenerate: () => {
      enterFullscreenOnHandheld();
      void makeAiScenario();
    },
    onShowEnding: () => showEnding(),
    onResetCourse: () => void handleResetCourse(),
    // 맵 체험하기 — 시험용이라 첫 화면 본문이 아니라 따로 여는 창이다 (renderTrial)
    onTrial: () => nav.go({ name: 'trial', enter: renderTrial }),
    onBadges: () => nav.go({ name: 'badges', enter: renderBadges }),
  }, aiTraining);
  showSiteStatsOnMenu();
}

/**
 * **지금 시점을 문서에 적는다** (`body.view-driver` · `view-chase` · `view-top`). 휴대폰 가로 화면의 상단 과제 상자는
 * 운전석 시점에서만 좁힌다 — 그 시점에서만 위쪽 양 끝에 좌 · 우 시야 창이 선다 (index.html).
 */
function markView(v: ViewMode): void {
  for (const m of ['driver', 'chase', 'top'] as const) document.body.classList.toggle(`view-${m}`, m === v);
}

/**
 * 첫 화면 오른쪽 위의 **사이트 전체 안전운전 성공 · 실패 횟수** (siteStats.ts).
 *
 * 가지고 있던 숫자를 먼저 띄우고, 서버에서 새로 읽어 바꾼다 — 판을 마치고 돌아왔을 때 방금 센 숫자가 바로 보이고,
 * 읽는 동안 칸이 비었다 채워지며 깜빡이지 않는다. 읽는 사이 다른 화면으로 갔으면 그리지 않는다.
 */
function showSiteStatsOnMenu(): void {
  const cached = cachedSiteStats();
  if (cached) screens.showSiteStats(cached);
  void loadSiteStats().then((s) => {
    if (s && nav.current === 'menu') screens.showSiteStats(s);
  });
  // 첫 화면을 다시 그릴 때마다 전체 화면 버튼의 글을 지금 상태에 맞춘다
  syncFullscreenButtons();
}

/**
 * 처음부터 다시 시작 — **저장된 진행을 지우고 처음부터 다시 한다.**
 *
 * ## 왜 첫 화면에 있는가
 *
 * 이 게임의 목표는 짧다. 규정 몇 가지를 익히면 마스터까지 닿는다. 그래서 한 대를
 * 여러 운전자가 번갈아 앉는 것이 기본 쓰임이고 — 캠페인 부스든 교육장이든 —
 * 그때 앞 운전자의 나쁜 운전 습관이 남아 있으면 AI 가 **내 것이 아닌 판**을 만든다.
 * 처음 앉은 사람이 남의 약점을 연습하게 되는 것이라, 초기화는 부수 기능이 아니라
 * 이 과정에 들어오는 방법의 하나다.
 *
 * ## 세 가지를 한꺼번에 되돌린다
 *
 * 저장본만 지우면 화면과 저장이 어긋난다. **같은 자리에서 셋을 함께** 되돌린다.
 *
 *  1. `saveData` — 통째로 갈아 끼운다 (economy/save.ts 의 reset).
 *  2. `aiTraining` — 만들어 둔 판과 진행 참조. `curriculum` 은 **참조**라 새 객체로
 *     다시 걸어 주지 않으면 화면이 지워진 레벨을 계속 그린다. 만들어 둔 판도 버린다 —
 *     앞 운전자의 약점으로 만든 판이라 새로운 운전자에게는 근거가 없는 판이다.
 *  3. 첫 화면 배경 — 타던 차가 시작 차로 돌아가므로 장면을 다시 만든다. 그냥
 *     `renderMenu()` 만 부르면 `ensureMenuScene` 이 살아 있는 장면을 보고 그대로 두어,
 *     전시관에는 아반떼인데 배경에는 앞 운전자의 SF90 이 도는 상태가 된다.
 *
 * **되돌릴 수 없으므로 확인을 받는다.** 브라우저 `confirm()` 이 아니라 화면 안의
 * 확인 창을 쓴다(ui/Screens.ts 의 confirm) — 답을 기다리는 동안 화면이 멈추지 않으므로
 * 이 함수는 `async` 다.
 */
async function handleResetCourse(): Promise<void> {
  // 판을 만드는 중이면 덮개 뒤에서 눌린 것이다 — 만들던 것이 끝난 뒤 다시 누르면 된다
  if (aiTraining.busy) return;

  // 레벨이 사라진다는 것을 붉게 짚는다 (사용자가 정했다, 2026-09-26)
  const ok = await screens.confirm({
    title: '처음부터 다시 시작합니다.',
    lines: [[{ em: '기존 레벨이 초기화' }, '되고 운전 습관이 초기화 됩니다.'], '정말 계속하시겠습니까?'],
  });
  if (!ok) return;

  /*
    **답을 기다리는 동안 세상이 멈춰 있지 않았다.** confirm() 과 달리 이 창이 떠 있는
    사이에도 다른 일이 일어날 수 있으므로, 지우기 직전에 한 번 더 확인한다 — 판을
    만들기 시작했다면 그 결과가 방금 지운 진행 위에 얹힌다.
  */
  if (aiTraining.busy) return;

  saveData = resetSave(saveData);

  aiTraining.made = [];
  aiTraining.busy = false;
  aiTraining.error = null;
  aiTraining.curriculum = saveData.curriculum;
  aiCourse = false;

  // 타던 차가 시작 차로 돌아갔다 — 배경 장면을 버려야 새 차로 다시 선다
  disposeMenuScene();
  renderMenu();
}

/**
 * 습관 리포트.
 *
 * 도움말·저작권과 같은 모양이다 — 머무르며 읽는 화면이고, 뒤로가기는 첫 화면으로 돌아간다.
 */
function renderReport(): void {
  stopAutoNext();
  disposeSeatPreview();
  ensureMenuScene();
  screens.show('report');
  screens.renderReport(saveData, goHome);
}

/** 뱃지 모음 — 습관 리포트와 같은 모양이다 (Screens.renderBadges) */
function renderBadges(): void {
  stopAutoNext();
  disposeSeatPreview();
  ensureMenuScene();
  screens.show('badges');
  screens.renderBadges(saveData, goHome);
}

function renderHelp(): void {
  stopAutoNext();
  disposeSeatPreview();
  ensureMenuScene();
  screens.show('help');
  screens.renderHelp(() => nav.back());
}

/** 어린이보호구역 운전 방법 — 우회전 하는 방법과 같은 화면 틀을 쓴다 */
function renderZoneHelp(): void {
  stopAutoNext();
  disposeSeatPreview();
  ensureMenuScene();
  screens.show('help');
  screens.renderZoneHelp(() => nav.back());
}

/**
 * **맵 체험하기** — 번호로 판을 골라 바로 달린다. 기록은 남기지 않는다 (위 mapTrial).
 *
 * 시험용이라 첫 화면 본문이 아니라 About · 설정 옆의 조용한 문으로 연다 — 사용자가 "테스트용이기 때문에
 * 메인 페이지에는 넣지 말고 별도 메뉴로 만들어 줘" 라고 했다.
 */
function renderTrial(): void {
  stopAutoNext();
  disposeSeatPreview();
  ensureMenuScene();
  screens.show('trial');
  screens.renderTrial(
    () => nav.back(),
    (code) => {
      // 번호는 갈래 한 글자 + 다섯 자리다 — C 보호구역 전용 · L 우회전 전용 · M 복합 (scenarios/scenarioCode.ts)
      const spec = scenarioByCode(code);
      if (!spec) return;
      aiCourse = false;
      mapTrial = true;
      enterFullscreenOnHandheld();
      goRun(spec.id);
    },
  );
}

function renderCredits(): void {
  stopAutoNext();
  disposeSeatPreview();
  ensureMenuScene();
  screens.show('credits');
  screens.renderCredits(() => nav.back());
}

/** About — 만든 사람이 이 작품을 만든 이유 (저작권 창과 같은 시트) */
function renderAbout(): void {
  stopAutoNext();
  disposeSeatPreview();
  ensureMenuScene();
  screens.show('about');
  screens.renderAbout(() => nav.back());
}

/**
 * 설정 화면.
 *
 * 고른 즉시 저장하고 **그 자리에서 다시 그린다** — '사용 중' 표시가 바로 옮겨 가야
 * 눌린 것이 반영됐음을 알 수 있다. 다시 그리는 것은 히스토리를 늘리지 않는다.
 */
function renderSettings(): void {
  stopAutoNext();
  disposeSeatPreview();
  ensureMenuScene();
  screens.show('settings');
  screens.renderSettings(saveData, {
    onStartView: (view) => {
      saveData.settings.startView = view;
      commit();
      renderSettings();
    },
    // 운전자 시점 사용/미사용 — 끄면 시작 시점이 운전석이어도 후방으로 되돌린다 (고를 수 없는 값이 남지 않게)
    onDriverView: (on) => {
      saveData.settings.driverView = on;
      if (!on && saveData.settings.startView === 'driver') saveData.settings.startView = 'chase';
      commit();
      renderSettings();
    },
    /*
      **무엇을 연습할지 고른다** (scenarios/tracks.ts). 고른 값은 설정에 저장한다 — 초기화 버튼으로
      지워지지 않는 자리다(economy/save.ts). 기본은 '자동' 이고, 그러면 AI 가 고른다 (trackPick.ts).
    */
    onTrack: (track) => {
      saveData.settings.track = track;
      commit();
      renderSettings();
    },
    onDifficulty: (c) => {
      saveData.settings.difficulty = c;
      commit();
      renderSettings();
    },
    /*
      화질은 **고른 즉시 저장하고 그 자리에서 다시 그린다.** '적용' 버튼을 따로 두면
      누르지 않고 나가는 사람이 생긴다.

      다음 주행부터 반영되는 값이 대부분이지만(그림자·반사·시야 창은 장면을 만들 때
      정해진다), fps 표시는 지금 켜 두면 바로 보이는 편이 낫다.
    */
    onGraphics: (patch) => {
      saveData.settings.graphics = { ...saveData.settings.graphics, ...patch };
      commit();
      hud.setShowFps(saveData.settings.graphics.showFps);
      renderSettings();
    },
    onGraphicsPreset: (tier) => {
      saveData.settings.graphics = presetGraphics(tier, saveData.settings.graphics);
      commit();
      renderSettings();
    },
    /*
      소리는 **누른 자리에서 들려준다.** 어떤 소리가 좋은지는 들어 봐야 아는 것이라,
      고르고 나가서 주행을 시작해야 알 수 있으면 여러 개를 비교할 방법이 없다.

      `resume()` 을 먼저 부르는 이유: 설정 화면까지 한 번도 소리를 낸 적이 없으면
      오디오가 아직 안 켜져 있다. 이 클릭이 그 사용자 제스처가 된다.
    */
    onSound: (kind, id) => {
      saveData.settings.sounds = { ...saveData.settings.sounds, [kind]: id };
      commit();
      void audio.resume().then(() => audio.preview(kind, id));
      renderSettings();
    },
    onBack: () => nav.back(),
  });
}

/**
 * 자동차전시관 — 차에 관한 모든 것이 여기 모여 있다.
 *
 * 무엇을 하든 **그 자리에서 다시 그린다** — '운행 중' 표시가 옮겨 간 것을 바로
 * 보여 주어야 무엇이 일어났는지 알 수 있다.
 *
 * 돌아갈 곳은 여기서 정하지 않는다. 들어온 길을 히스토리가 알고 있다(nav.ts) —
 * 예전에는 `back` 을 인자로 들고 다니면서 부르는 쪽마다 다시 넘겨 줘야 했다.
 */
function renderShop(): void {
  stopAutoNext();
  disposeSeatPreview();
  ensureMenuScene();
  screens.show('shop');
  // 사진 목록을 못 받은 채 켜졌으면 다시 받아, 받는 대로 전시관을 다시 그린다
  ensureCarPhotos(() => {
    if (nav.current === 'shop') renderShop();
  });
  screens.renderShop(saveData, {
    onSelect: (id) => handleSelectCar(id),
    // 톱니바퀴 — 그 차로 갈아타고 운전석에 앉는다
    onAdjust: (id) => handleSelectCar(id, { adjust: true }),
    /*
      대표 사진 등록 — **서버의 car-photos/ 폴더에 저장한다** (economy/carPhotos.ts).

      **이미 사진이 있으면 덮어쓰기 전에 묻는다.** 지우는 기능을 따로 두지 않으므로
      한 번 덮으면 이전 사진은 돌아오지 않는다 — 되돌릴 수 없는 동작 앞에서는 확인을 받는다.

      **서버가 저장했다고 답한 뒤에 화면을 다시 그린다.** 먼저 그리면 저장에 실패해도
      사진이 바뀐 것처럼 보이다가 새로고침하면 사라진다. 실패하면 이유를 알린다.
    */
    onPhoto: (id, dataUrl) => {
      const replacing = hasCarPhoto(id);
      if (replacing && !confirm('사진이 변경됩니다. 정말로 변경하겠습니까?')) return;

      void uploadCarPhoto(id, dataUrl)
        .then(() => {
          // 처음 등록했을 때만 알린다 — 교체는 위에서 이미 확인을 받았다
          if (!replacing) alert('사진이 등록되었습니다.');
          // 올리는 동안 다른 화면으로 갔을 수 있다 — 그 화면 위에 전시관을 덮어 그리면 안 된다
          if (nav.current === 'shop') renderShop();
        })
        .catch((e: unknown) =>
          alert(`사진을 저장하지 못했습니다. ${e instanceof Error ? e.message : ''}`),
        );
    },
    onBack: () => nav.back(),
  });
}

/**
 * 좌석 맞추기 화면 — 세워 둔 차의 운전석에 앉아 위·아래(또는 휠)로 자리를 맞춘다.
 *
 * 주행 화면·배경 장면과 같은 캔버스를 쓰므로 그쪽을 먼저 정리한다.
 * 저장하면 그 차의 좌석 값이 남고, 취소하면 들어올 때의 값으로 되돌린다.
 *
 * **여기도 히스토리 한 칸이다.** 좌석을 맞추는 중에 뒤로가기를 누르면(모바일에서는
 * 화면을 밀면) 취소하고 전시관으로 돌아가야 한다 — 칸을 만들어 두지 않으면 그 동작이
 * 게임을 통째로 나가거나, 전시관을 그리면서 좌석 화면이 뒤에 그대로 살아 있게 된다.
 */
function renderSeatPreview(carId: string): void {
  stopAutoNext();
  disposeGame();
  disposeMenuScene();
  disposeSeatPreview();
  screens.hideAll();
  hud.hide();
  controls.setEnabled(false);

  const spec = getCar(carId);
  const before = saveData.seatOffsets[carId] ?? 0;
  const panel = document.getElementById('seat-hud');
  const readout = document.getElementById('seat-hud-text');
  const title = document.getElementById('seat-hud-title');
  panel?.classList.add('on');
  if (title) title.textContent = '좌석 맞추기';

  const preview = new SeatPreview(canvas, spec, before, {
    onChange: (_offset, text) => {
      if (readout) readout.textContent = text;
    },
  });
  seatPreview = preview;
  preview.start();

  const onSeatKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowUp') preview.nudge(1);
    else if (e.key === 'ArrowDown') preview.nudge(-1);
    else if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    else if (e.key.toLowerCase() === 'r') preview.reset();
    else return;
    e.preventDefault();
  };
  // 복사·새로고침 같은 조합키는 브라우저에게 넘긴다 (game/Controls.ts 의 leaveToBrowser)
  const onKey = (e: KeyboardEvent): void => {
    if (leaveToBrowser(e)) return;
    onSeatKey(e);
  };
  // 휠은 위로 굴리면 앞으로 — 지도·문서와 같은 방향감이다
  const onWheel = (e: WheelEvent): void => {
    preview.nudge(e.deltaY < 0 ? 1 : -1);
    e.preventDefault();
  };
  const onResize = (): void => preview.resize();

  /**
   * 좌석 화면을 걷는다 — **되돌아가지는 않는다.**
   *
   * 뒤로가기로 이 화면을 떠날 때는 이미 히스토리가 옮겨 간 뒤라, 여기서 또 되돌아가면
   * 두 칸이 움직인다. 그래서 '치우는 일'과 '되돌아가는 일'을 갈라 둔다.
   */
  function cleanup(save: boolean): void {
    window.removeEventListener('keydown', onKey);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', onResize);
    document.getElementById('seat-save')?.removeEventListener('click', onSave);
    document.getElementById('seat-cancel')?.removeEventListener('click', onCancel);
    if (save) {
      saveData.seatOffsets[carId] = preview.value;
      commit();
    }
    preview.dispose();
    seatPreview = null;
    seatTeardown = null;
    // 차고에서 여러 차를 둘러봤으면 캐시가 불어 있다 — 좌석 화면을 걷은 이 순간에 상한까지 비운다
    trimCarModelCache([saveData.activeCarId]);
    panel?.classList.remove('on');
  }
  seatTeardown = cleanup;

  /** 저장·취소 버튼과 Enter·Esc — 치우고 돌아간다 */
  function finish(save: boolean): void {
    cleanup(save);
    nav.back();
  }
  const onSave = (): void => finish(true);
  const onCancel = (): void => finish(false);

  window.addEventListener('keydown', onKey);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', onResize);
  document.getElementById('seat-save')?.addEventListener('click', onSave);
  document.getElementById('seat-cancel')?.addEventListener('click', onCancel);
}

/**
 * 차를 골라 탄다.
 *
 * **여기서는 무엇도 열지 않는다.** 무엇을 탈 수 있는지는 레벨이 정하고(economy/cars.ts 의
 * `level`), 전시관은 잠긴 차의 버튼을 아예 눌리지 않게 해 둔다 — 고르기는 열린 것 중에서
 * 지금 탈 차를 바꾸는 일뿐이다.
 */
function handleSelectCar(id: string, opts: { adjust?: boolean } = {}): void {
  saveData.activeCarId = id;
  commit();
  // 고른 차의 모델을 미리 받아 둔다 — 출발을 누른 첫 프레임부터 차가 자리에 있게
  void loadCarModel(getCar(id), { lod: playerLod() }).catch(() => undefined);
  // 좌석 맞추기는 운전자 시점을 쓸 때만 뜻이 있다 (전시관이 버튼을 감추지만, 여기서도 막는다)
  if (opts.adjust && saveData.settings.driverView) nav.go({ name: 'seat', enter: () => renderSeatPreview(id) });
  else renderShop();
}

// ── 주행 ───────────────────────────────────────────────────────────────────

/**
 * 주행을 히스토리 한 칸으로 시작한다.
 *
 * `replace` 는 **결과 화면에서 이어 달릴 때**다. '다시 운행'·'다음 시나리오'를 누를
 * 때마다 칸이 쌓이면, 홈으로 나가려고 뒤로가기를 누른 사람이 지나온 판을 하나씩
 * 거꾸로 되짚게 된다. 결과 화면 자리를 새 주행이 넘겨받으면 스택은 늘 두 칸이다.
 *
 *   첫 화면 ─ 주행 ⇄ 결과
 */
/**
 * id 로 시나리오를 찾는다 — **AI 가 만든 것까지 포함해서.**
 *
 * 시나리오 라이브러리(1000번대, scenarios/library.ts)도 여기서 찾는다.
 *
 * `getScenario` 는 손으로 쓴 `SCENARIOS` 만 본다. AI 판은 이번 접속에만 존재하고
 * 100번대 id 를 쓰므로 여기서 먼저 찾는다 (번호를 갈라 둔 이유는 저장된 기록이
 * stage id 로 묶이기 때문이다 — 겹치면 통계가 섞인다).
 */
function resolveScenario(id: number): ScenarioSpec {
  // 보호구역 직진 코스는 자기 id 대역을 쓴다 (scenarios/zoneCourse.ts) — 라이브러리 번호를 밀지 않으려고 따로 둔다
  return (
    aiTraining.made.find((s) => s.id === id) ?? zoneCourse(id) ?? libraryEntry(id)?.spec ?? getScenario(id)
  );
}

/**
 * 주행 기록의 판 이름 — AI 추천에 "최근에 무엇을 탔는지" 로 보낸다.
 * AI 가 새로 만든 판(100번대)은 그 접속에만 있어서 지난 접속의 것은 이름을 되찾을 수 없다.
 */
function recordTitle(id: number): string {
  const found = aiTraining.made.find((s) => s.id === id) ?? zoneCourse(id) ?? libraryEntry(id)?.spec;
  if (found) return found.title;
  return id < GENERATED_ID_BASE ? getScenario(id).title : 'AI 생성 판';
}

/**
 * **첫 화면으로 — 한 칸 뒤가 아니라 집으로.**
 *
 * 사용자가 짚었다: "홈을 눌렀을 때 가장 처음 홈으로 가야 하는데 이전 화면으로 돌아가는 경우들이 있어."
 * '홈으로' 라고 적힌 버튼(주행 중 · 결과 화면 · 습관 리포트)이 `nav.back()` 이었다 — 스택이 두 칸일 때는
 * 그것이 곧 첫 화면이라 맞아 보였지만, 한 칸이라도 더 쌓여 있으면(아래 goRun 주석의 규칙이 깨진 자리들)
 * **지나온 화면**이 나왔다.
 *
 * 글자가 약속하는 곳으로 간다 — 쌓인 칸은 버린다(nav.reset). 뒤로가기로 결과 화면에 되돌아갈 일은 없다.
 */
function goHome(): void {
  nav.reset({ name: 'menu', enter: renderMenu });
}

function goRun(id: number, replace = false): void {
  // 결과 화면의 '다시 운행' · '다음 판' 처럼 손가락으로 시작한 판도 전체 화면으로 (손가락 없이 온 호출은 조용히 거절된다)
  enterFullscreenOnHandheld();
  const route = { name: 'run', enter: () => void startRun(id) };
  if (replace) nav.replace(route);
  else nav.go(route);
}

function disposeGame(): void {
  game?.dispose();
  game = null;
  paused = false;
  // 준비 중에 나갔을 수 있다 — 덮개를 걷지 않으면 메뉴가 가려진 채로 남는다
  hideLoading();
}

/**
 * 주행 시작 — **준비가 다 끝난 뒤에 출발한다.**
 *
 * 예전에는 곧바로 달리기 시작하고 모델·환경맵은 도착하는 대로 붙였다. 그래서 붙는
 * 프레임마다 멈칫했고, 조건이 복잡한 판(08번 무작위)일수록 받아 올 것이 많아 심했다.
 * 하필 그 순간이 정지선 앞이면 판단해야 할 때 화면이 멈춘다.
 *
 * 지금은 화면을 덮고("도로 상황을 준비하는 중…") `game.prepare()` 를 기다린다.
 * 기다리는 값은 대부분 캐시라 두 번째 판부터는 눈에 띄지 않게 지나간다.
 *
 * **기다리는 동안 판이 바뀔 수 있다** — 준비 중에 홈으로 나가거나 R 로 다시 시작하면
 * 이전 게임은 dispose 된다. 그래서 준비가 끝난 뒤 내가 아직 그 게임인지 확인하고 출발한다.
 */
async function startRun(id: number): Promise<void> {
  stopAutoNext();
  void audio.resume();
  /*
    덮개가 **이미 떠 있었는가** — AI 가 판을 만드는 동안 씌워 둔 것이 있을 수 있다.
    그 경우 준비 화면도 지연 없이 이어 붙여야 그 사이 메뉴가 번쩍이지 않는다.
    (disposeGame 이 덮개를 걷으므로 그 전에 봐 둔다)
  */
  const loadingWasUp = document.getElementById('loading')?.classList.contains('on') ?? false;
  disposeGame();
  // 캔버스는 하나뿐이다 — 배경 장면과 좌석 화면이 남아 있으면 서로의 그림을 덮어쓴다
  disposeMenuScene();
  disposeSeatPreview();

  currentScenario = prepareScenario(resolveScenario(id));
  const carSpec = getCar(saveData.activeCarId);
  // 장면이 하나도 없는 지금이 모델 캐시를 상한까지 비울 순간이다 — 내 차만 남긴다 (carModel.ts 의 trimCarModelCache)
  trimCarModelCache([carSpec.id]);
  audio.setCar(carSpec);
  // 설정에서 고른 소리 셋. 바뀐 것이 없으면 아무 일도 하지 않는다
  audio.setSounds(saveData.settings.sounds);
  /*
    **조작은 어느 코스에서나 같다** (사용자가 정했다: "어린이 보호구역에서만 키제어 방법이 다르면
    헷갈릴 것 같아"). ↑ 출발 · ↓ 정지이고 속도는 차가 알아서 맞춘다 — 보호구역에 들어서면 30km/h
    이하로 스스로 조인다 (game/Vehicle.ts 의 zoneTargetKmh).

    다른 것은 **방향지시등 기본값** 하나뿐이다 — 돌지 않는 코스에서는 꺼진 채로 시작한다.
    `reset` 보다 먼저 정해야 리셋이 그 방식대로 돌아간다.
  */
  controls.setNoTurn(currentScenario.drive !== undefined && currentScenario.drive !== 'rightTurn');
  controls.reset();
  /*
    자율 주행 중에는 **사람 입력을 받지 않는다.** 핸들이 두 곳에서 들어오면 AI 가
    그리는 선이 흔들려, 정답을 보여 준다는 이 기능의 뜻이 무너진다.
    (시점 전환 C·재시작 R·나가기 Esc 는 enabled 와 무관하게 그대로 동작한다)
  */
  controls.setEnabled(!aiDriving);
  document.body.classList.toggle('ai-drive', aiDriving);
  // 결과 화면의 제목이 이것을 본다 — 체험한 판을 'AI 추천' 이라 부르지 않게 (Screens 의 debriefTitle)
  document.body.classList.toggle('map-trial', mapTrial);
  /*
    **사이트 전체 안전운전 횟수의 판 표** (siteStats.ts) — 사람이 모는 판만 받는다. AI 자율 주행 시범은 AI 가 몬
    판이고, 맵 체험은 시험용이라 세지 않는다 (둘 다 finishRun 에서 기록을 남기지 않는 것과 같은 선).
  */
  if (!aiDriving && !mapTrial) beginRun();
  // 판은 가는 상태로 시작한다 (controls.reset) — ↑ 에 불을 켠다
  syncGoStop();

  screens.hideAll();
  /*
    **주행 중 상단은 한 줄 — "판 이름 : 상황".** AI 가 만든 판은 "AI 생성 상황" 이라고 부른다
    (목록의 짧은 이름표 'AI 맞춤' 과 달리, 달리는 동안에는 무엇이 만들어 준 판인지가 한눈에 읽혀야 한다).
  */
  /*
    라이브러리 판은 **결과 화면과 같은 이름**으로 부른다 — `AI 추천 시나리오 M03700 - 제목`
    (scenarios/scenarioCode.ts). 달리는 동안과 끝난 뒤의 이름이 같아야 "그 판" 이 이어진다.
  */
  // 번호는 갈래 한 글자 + 다섯 자리 (scenarios/scenarioCode.ts) — 맵 체험 · 결과 화면이 같은 이름으로 부른다
  const libNo = scenarioCode(currentScenario.id);
  hud.show(
    /*
      **자율 주행도 번호를 적는다** — `오프라인 교육 - 시나리오 M01363 - 제목`. 사용자가 "AI 가 추천하는 결과는 시나리오 ??
      시나리오 내용 이렇게 나왔잖아. 자율주행도 자율주행 - 시나리오 ??? 시나리오 상황 이렇게 나오게 해 줘" 라고 했다.
      번호가 있으면 맵 체험으로 같은 판을 직접 달려 볼 수 있다.
    */
    aiDriving
      ? `오프라인 교육 - 시나리오 ${libNo ?? ''}`.trim()
      : mapTrial && libNo !== undefined
      ? `맵 체험 ${libNo}`
      : libNo !== undefined
      ? `AI 추천 시나리오 ${libNo}`
      : currentScenario.id >= GENERATED_ID_BASE
        ? 'AI 생성 상황'
        : stageLabel(currentScenario.id),
    currentScenario.title,
    libNo !== undefined ? '-' : ':',
    // 누가 골라 준 맵인지 상단 첫 줄에 (ui/pickedBy.ts) — 추천 카드와 같은 값을 쓴다
    {
      picker: (currentScenario as Partial<GeneratedScenario>).picker as Picker | undefined,
      model: (currentScenario as Partial<GeneratedScenario>).pickerModel,
    },
  );
  /*
    **내 레벨과 경험치를 달리는 동안에도 보여 준다** (Hud.setPlayer). 경험치가 움직이는 AI 과정의 판에서만 —
    손으로 쓴 판과 시범 주행은 레벨을 바꾸지 않으니, 띄우면 이 판으로 경험치를 얻는 것처럼 읽힌다.
  */
  const cur = saveData.curriculum;
  hud.setPlayer(
    aiCourse && !aiDriving
      ? {
          level: cur.level,
          xp: cur.xp,
          need: xpToNext(cur.level, challengeRule(saveData.settings.difficulty)),
          mastered: cur.mastered,
        }
      : null,
  );
  /*
    **AI 가 고른 판이면 준비 화면에 왜 골랐는지를 띄운다** (recommend.ts).
    이 한두 줄이 이 기능의 절반이다 — "AI 가 골랐습니다" 보다 "여기서 세 번 무너져서
    골랐습니다" 가 학습자를 움직인다. 읽을 틈이 있게 최소 `RESULT_MIN_MS`(ui/AiPick.ts) 동안 둔다.
  */
  const rec = currentScenario as Partial<GeneratedScenario>;
  const reason = rec.recommended && rec.why ? rec.why + (rec.focus ? `\n👉 ${rec.focus}` : '') : '';
  if (reason) {
    /*
      **추천 결과 카드 뒤에서 맵을 준비한다** (ui/AiPick.ts). 방금 분석 연출에서 넘어왔으면 카드가 이미
      떠 있고, '다시 운행' 처럼 바로 들어왔으면 여기서 띄운다.
    */
    hideLoading();
    if (!aiPick.showingResult) {
      aiPick.showResult({
        title: currentScenario.title,
        code: libNo,
        why: rec.why ?? '',
        focus: rec.focus,
        picker: rec.picker as Picker | undefined,
        model: rec.pickerModel,
        success: rec.success,
        predict: rec.predict,
      });
    }
  } else {
    showLoading(currentScenario.title, { immediate: loadingWasUp });
  }

  /*
    **난이도가 주행을 바꾼다** (challenge.ts) — 도움의 양(hints), 다가가는 속도와 제동(pace), 정지 구역(stopZone).
    시범 주행은 보여 주는 판이라 쉬움으로 달린다 — 도움이 다 켜져 있고, AI 운전이 맞춰 둔 속도와 제동이다.
  */
  // 자율 주행은 난이도 설정과 상관없이 가장 친절한 시범 값으로 몬다 (challenge.ts 의 AUTO_DRIVE_RULE)
  const challenge = aiDriving ? AUTO_DRIVE_RULE : challengeRule(saveData.settings.difficulty);
  const hints = challenge.hints;
  hud.setHints(hints);
  setPedestrianAlerts(hints !== 'none');
  // 신호등 등화의 점광원 — 반사 '높음' 이상에서만 (quality.ts 의 usesLampLights · 약한 GPU 에서 픽셀 시간의 1/4)
  setLampLights(usesLampLights(saveData.settings.graphics.reflection));
  setStopBands(hints !== 'none');
  setClusterStopCue(hints !== 'none');

  /*
    시작 시점 — 자율 주행 중에는 후방 시점으로 고정한다 (아래 startView 주석).

    **손에 든 화면도 후방 시점으로 고정한다** (사용자가 정했다: *"모바일에서는 C 시점 전환을 쓰지 않는다.
    세로는 횡단보도 앞에서 카메라가 올라갔다 내려오는 후방 시점, 가로는 후방 시점 하나."*). 운전석 시점이
    끌고 오는 것(좌·우·후방 시야 창의 렌더 타깃과 그 패스)은 휴대폰에 가장 무거운 짐이라, 시점을 고정하면
    그것을 아예 만들지 않을 수 있다 (PeripheralView). 설정의 시작 시점은 PC 에서만 뜻이 있다.
  */
  const startViewOfRun: ViewMode =
    aiDriving || isHandheld() || (!saveData.settings.driverView && saveData.settings.startView === 'driver')
      ? 'chase'
      : saveData.settings.startView;
  markView(startViewOfRun);
  game = new Game(canvas, currentScenario, carSpec, controls, audio, {
    onSnapshot: (s: GameSnapshot) => {
      hud.update(s);
      // 개발 빌드에서만 노출한다. 브라우저 콘솔과 자동화 테스트에서 주행 상태를 들여다보기 위함.
      if (import.meta.env.DEV) {
        (window as unknown as { __turnRight?: GameSnapshot }).__turnRight = s;
      }
    },
    onFinish: (result) => finishRun(result),
    onToast: (msg) => hud.toast(msg),
    onViewChange: (v) => {
      markView(v);
      hud.toast(v === 'driver' ? '운전자 시점' : v === 'chase' ? '후방 시점' : '탑다운 시점');
    },
  },
  {
    // 차고에서 맞춰 둔 좌석 자리를 그대로 들고 들어간다
    seatOffset: saveData.seatOffsets[carSpec.id] ?? 0,
    /*
      시작 시점 — 자율 주행 중에는 **후방 시점**으로 고정한다.

      설정이 운전자 시점이면 자기 차 안에서 보게 되는데, 이 기능은 "어떻게 도는지"를
      보여 주는 것이라 차와 차로가 함께 보이는 화면이라야 한다. 주행 중 C 로 바꾸는
      것은 그대로 되므로, 운전석에서 보고 싶으면 그때 돌리면 된다.
    */
    startView: startViewOfRun,
    // 운전자 시점 미사용(기본)이면 시야 창을 만들지 않고 C 로 돌 때 운전석을 건너뛴다 (save.ts 의 driverView)
    driverView: saveData.settings.driverView,
    autoDrive: aiDriving,
    graphics: saveData.settings.graphics,
    // 난이도가 오르면 더 빨리 다가가고 브레이크가 무르며, 정지선에 더 붙여 서야 한다 (challenge.ts)
    pace: challenge.pace,
    stopZone: challenge.stopZone,
  });
  const started = game;
  started.resize();
  await started.prepare();
  // 기다리는 사이 다른 판이 시작됐거나 화면을 떠났으면 이 게임은 이미 버려진 것이다
  if (game !== started) return;
  if (reason) {
    // 맵은 준비됐다 — 추천 사유를 읽을 틈이 남았으면 기다린 뒤 카드를 걷는다
    await aiPick.finish();
    if (game !== started) return;
  }
  hideLoading();
  started.start();
}

/**
 * 준비 중 화면.
 *
 * **바로 띄우지 않는다.** 두 번째 판부터는 거의 다 캐시라 준비가 한 프레임 만에 끝나는데,
 * 그때마다 덮개가 번쩍이면 오히려 느려 보인다. 잠깐 기다려 보고 그래도 안 끝났을 때만
 * 띄운다 — 사람이 '멈췄나' 하고 느끼기 시작하는 지점이 그쯤이다.
 */
const LOADING_DELAY_MS = 150;
let loadingTimer = 0;

/** 준비 화면의 기본 제목 — 3D 자원을 받는 동안 */
const LOADING_TITLE = '도로 상황을 준비하는 중…';

/**
 * @param opts.title     덮개의 큰 글씨. 없으면 기본값
 * @param opts.immediate **기다리지 않고 바로 띄운다.** 몇 초가 걸릴 것을 이미 아는
 *                       일(모델 호출)에는 지연이 도움이 되지 않는다 — 그 사이 아무 일도
 *                       안 일어나는 것처럼 보이는 것이 이 덮개가 막으려던 바로 그 문제다.
 */
function showLoading(
  detail: string,
  opts: { title?: string; immediate?: boolean; reason?: boolean } = {},
): void {
  const title = document.getElementById('loading-text');
  if (title) title.textContent = opts.title ?? LOADING_TITLE;
  const sub = document.getElementById('loading-sub');
  if (sub) {
    sub.textContent = detail;
    // AI 추천 이유는 읽으라고 띄우는 글이다 — 진행 안내보다 크고 밝게
    sub.classList.toggle('reason', Boolean(opts.reason));
  }

  window.clearTimeout(loadingTimer);
  if (opts.immediate) {
    document.getElementById('loading')?.classList.add('on');
    return;
  }
  loadingTimer = window.setTimeout(() => {
    document.getElementById('loading')?.classList.add('on');
  }, LOADING_DELAY_MS);
}

function hideLoading(): void {
  window.clearTimeout(loadingTimer);
  document.getElementById('loading')?.classList.remove('on');
}

/**
 * `Esc` — **화면이 떠 있으면 뒤로, 달리는 중이면 일시정지.**
 *
 * 예전에는 주행 중에만 무언가를 했고 화면에서는 아무 일도 하지 않았다. 그런데 Esc 는
 * 모달과 하위 화면을 닫는 키라서, 설정을 열어 놓고 Esc 를 눌렀는데 아무 반응이 없으면
 * 닫는 법을 다시 찾아야 한다.
 */
function togglePause(): void {
  if (seatPreview) return; // 좌석 화면은 자기 Esc 를 따로 듣는다 (취소)
  if (screens.active !== 'none') {
    nav.back();
    return;
  }
  if (!game) return;
  paused = !paused;
  if (paused) {
    game.pause();
    controls.setEnabled(false);
    /*
      **'일시정지' 라고 하지 않는다.** 그 말은 이 게임에서 도로교통법의 일시정지
      (정지선 앞에서 완전히 서는 것)를 가리키는 말로 쓴다 — HUD 의 판단 표시가
      그것이다. 게임을 멈춘 것과 같은 이름으로 부르면 배우는 말이 흐려진다.
    */
    hud.toast('게임을 멈췄습니다 — Esc로 재개, R로 재시작');
  } else {
    controls.setEnabled(true);
    game.resumeRun();
  }
}

function finishRun(result: JudgeResult): void {
  if (!currentScenario) return;
  const sc = currentScenario;

  const payout = settle(result, saveData.stats.streak);

  /*
    **시범 주행은 학습자의 기록이 아니다.** AI 가 몬 판이라 통계 · 주행 기록 · 습관 ·
    레벨에 하나도 남기지 않는다 — 남기면 시범을 한 바퀴 본 사람의 습관 진단이 AI 의 운전으로
    채워진다. 결과 화면만 잠깐 보여 주고 다음 교육 코스로 넘어간다.
  */
  if (aiDriving) {
    finishDemoRun(sc, result);
    return;
  }
  // 맵 체험도 기록하지 않는다 — 고친 판을 시험해 보는 자리다 (위 mapTrial)
  if (mapTrial) {
    finishTrialRun(sc, result);
    return;
  }

  // 사이트 전체 안전운전 횟수 — 이 판의 표를 내고 센다 (siteStats.ts). 기다리지 않는다 — 결과 화면은 바로 뜬다
  void endRun(outcomeOf(result.grade));

  // 운전 점수(save.money)는 더 모으지 않는다 — 화면에서 없앴다 (Screens.ts). 벌점 · 연속 기록은 통계로 남긴다
  saveData.penaltyPoints += payout.penaltyPoints;
  saveData.stats.attempts += 1;
  saveData.stats.streak = payout.streak;
  saveData.stats.bestStreak = Math.max(saveData.stats.bestStreak, payout.streak);
  if (result.grade === 'PERFECT') saveData.stats.perfects += 1;
  if (result.grade === 'VIOLATION') saveData.stats.violations += 1;
  if (result.grade === 'FAIL') saveData.stats.fails += 1;

  const key = String(sc.id);
  /*
    **이 맵을 이미 무위반으로 통과했는가** — 그러면 이번 무위반은 경험치가 절반이다 (curriculum.ts 의 XP_REPLAY).
    최고 등급을 고치기 **전에** 읽는다. 라이브러리 맵은 번호가 고정이라 저장된 최고 등급으로 알 수 있지만, AI 가 새로
    만든 판은 접속할 때마다 번호를 다시 매겨(generate.ts 의 nextId) 지난 접속의 다른 판과 번호가 겹친다 — 그 판은
    이번 접속에서 통과한 것만 센다.
  */
  const clearedBefore =
    scenarioCode(sc.id) !== undefined
      ? saveData.bestGrades[key] === 'PERFECT' || saveData.bestGrades[key] === 'PASS'
      : clearedThisSession.has(sc.id);
  if (result.violations.length === 0 && !result.failReason) clearedThisSession.add(sc.id);
  if (isBetter(result.grade, saveData.bestGrades[key])) saveData.bestGrades[key] = result.grade;

  /*
    습관 진단용 이력 한 줄. **총계(stats)와 따로 남긴다** — 총계는 "몇 번 위반했나"
    까지만 답하지만, 진단이 알아야 하는 것은 **어디서 반복해서** 무너지는가다.
    (한 판 안의 시각·좌표는 그 판의 디브리핑이 이미 답했으므로 남기지 않는다)
  */
  pushHistory(saveData, {
    st: sc.id,
    g: result.grade,
    v: result.violations.map((v) => v.code),
    sa: result.stats.cleanStopBeforeA,
    sc: result.stats.stopBeforeC,
    sp: result.stats.maxSpeedInIntersection,
    sg: result.stats.signalAt30m,
    // 주행 결과 데이터 — 요약 한 줄 (ai/telemetry.ts). 학습자 모델 · 위험도 모델 · AI 코치의 재료다
    f: result.features,
  });
  /*
    **모델에 넣을 값** — 이 판의 위험도(ai/risk.ts, 무위반이어도 아슬아슬했으면 높다), 난이도(ai/difficulty.ts), 시각(망각 모델).
    시험한 개념은 습관과 같은 표(library.ts 의 habitsTestedBy)다.
  */
  const tested = habitsTestedBy(sc);
  const risk = result.features ? riskOf(result.features) : undefined;
  const now = Date.now();
  // 결과 예측 모델이 **판 전의** 학습자로 낸 예측 — 실제와의 차로 학습자 안의 절편을 보정한다 (ai/outcome.ts)
  const predicted = predictOutcome(
    { spec: sc, targets: [...tested], cost: costOf(sc).total },
    learnerVector(saveData.curriculum.skills ?? {}, now),
    saveData.curriculum.outcomeBias ?? {},
  );

  /*
    **AI 주행이면 여기서 단계가 움직인다.**

    무위반이면 올라가고, 이어서 두 번 틀리면 내려간다. 위반 코드는 그대로 메모되어
    다음 판이 그 상황을 다시 낸다 (scenarios/curriculum.ts).

    수동 주행 결과로는 레벨을 움직이지 않는다 — 손으로 쓴 판은 난이도 표와 무관하게
    만들어져 있어, 그 결과로 AI 과정의 레벨을 올리면 4레벨 학습자가 1레벨 판을 통과한
    것으로 진급하게 된다.

    **다만 나쁜 운전 습관은 어느 판에서든 쌓는다** (recordHabits). 우회전을 어디서
    못하는지는 어느 판에서 못했든 같은 사실이고, 이것을 AI 주행에서만 세면 AI 과정에
    처음 들어온 사람의 프롬프트가 "습관 기록 없음" 과 "위반 7회" 를 동시에 말하게 된다.
  */
  let courseStep: CourseStep | null = null;
  // 이 판 전에 남아 있던 나쁜 습관 — 판을 마친 뒤와 견줘 고친 수를 센다 (아래 뱃지의 습관 교정가)
  const habitsBefore = saveData.curriculum.badHabits.map((h) => h.code);
  if (aiCourse) {
    const before = saveData.curriculum;
    // 이 판이 무엇을 시험했는가 — 습관은 시험한 판에서만 '고쳤다' 고 센다 (library.ts)
    // 몇 판을 이어야 오르고 몇 번 틀리면 내려가는가 — 난이도 설정이 정한다 (challenge.ts)
    const rule = challengeRule(saveData.settings.difficulty);
    const { next, change, xp } = advance(before, result, tested, rule, {
      replay: clearedBefore,
      risk,
      now,
      difficulty: difficultyOf({ spec: sc, targets: [...tested], cost: costOf(sc).total }),
      abilityPrior: abilityPriorFor(before.level),
      predicted,
    });
    // 이 판으로 마스터가 됐다 — 결과 화면 위에 엔딩을 띄운다 (showEnding)
    justMastered = !before.mastered && next.mastered;
    saveData.curriculum = next;
    aiTraining.curriculum = next;
    courseStep = {
      prevLevel: before.level,
      level: next.level,
      mastered: next.mastered,
      xp,
      clean: result.violations.length === 0 && !result.failReason,
      /* 이번 판으로 습관이 어떻게 움직였는가 — 결과 화면이 그대로 보여 준다 */
      habits: next.badHabits,
      change,
      unlockedCar: null,
      // 학습자 모델이 이 판으로 어떻게 움직였는가 · 위험했던 순간 · 반사실 (ai/report.ts) — 결과 화면이 보여 준다
      model: modelStep(before.skills ?? {}, next.skills ?? {}, tested, result),
    };

    /*
      **레벨이 오르면 그 레벨의 차를 내준다.**

      전시관에 새 차가 들어왔다는 것만 알리고 말면, 학습자는 메뉴 → 전시관 → 고르기를
      거쳐야 그 차를 만난다. 그 사이에 보상이 식는다. 대표 차로 바로 갈아태우고 결과
      화면에서 보여 주면, **다음 판을 그 차로 출발**하게 된다.

      고른 차를 존중하지 않는 것처럼 보일 수 있으나, 전시관에서 언제든 되돌릴 수 있고
      갈아타는 것은 레벨이 오른 판에서 한 번뿐이다.

      **레벨이 올랐는지가 아니라 최고 기록이 올랐는지를 본다.** 강등됐다가 같은 레벨로
      돌아온 판에서는 새로 열린 차가 없다 — 그때도 갈아태우면 이미 받은 차를 다시 받은
      것처럼 알리게 된다.

      마지막 레벨(L10)에는 새 차가 없다(economy/cars.ts 의 carForLevel). 그래서 `car` 가
      직전 레벨의 차와 같으면 아무 일도 하지 않는다 — 타던 차를 "새로 열렸다" 고 알리면
      그 알림이 한 번에 값어치를 잃는다.
    */
    const car = next.bestLevel > before.bestLevel ? carForLevel(next.bestLevel) : undefined;
    if (car && car.id !== carForLevel(before.bestLevel)?.id) {
      saveData.activeCarId = car.id;
      void loadCarModel(car, { lod: playerLod() }).catch(() => undefined);
      courseStep.unlockedCar = { id: car.id, name: car.name, level: car.level };
    }
  } else {
    // 수동 주행 — 레벨·판 수는 그대로 두고 습관 기록만 갱신한다
    saveData.curriculum = recordHabits(saveData.curriculum, result, tested, { risk, now, predicted });
    aiTraining.curriculum = saveData.curriculum;
  }

  /*
    **뱃지** (economy/badges.ts) — 이 판에서 지킨 법규는 오르고, 어긴 법규는 한 단계 내려간다. 자율 주행 · 맵 체험은 위에서
    이미 걸러 냈다 — 직접 운전한 판만 센다. 얻고 잃은 것은 결과 화면이 곧바로 보여 준다 (renderDebrief).
  */
  const habitsAfter = new Set(saveData.curriculum.badHabits.map((h) => h.code));
  const badgeStep = updateBadges(saveData.badges, {
    result,
    spec: sc,
    tested: habitsTestedBy(sc),
    habitsFixed: habitsBefore.filter((code) => !habitsAfter.has(code)).length,
    mastered: saveData.curriculum.mastered,
  });
  saveData.badges = badgeStep.next;
  const badgeEvents = badgeStep.events;

  // 실패가 아니면 다음 시나리오를 연다 — 위반해도 배웠으니 진행은 시킨다
  let unlockedNew = false;
  if (result.grade !== 'FAIL' && sc.id === saveData.unlockedScenario && sc.id < SCENARIOS.length) {
    saveData.unlockedScenario = sc.id + 1;
    unlockedNew = true;
  }
  commit();

  controls.setEnabled(false);
  game?.showTopView();
  hud.hide();

  /*
    결과 화면은 **주행이 있던 자리를 넘겨받는다** (replace). 그래야 여기서 뒤로가기를
    누른 사람이 방금 끝낸 판을 다시 시작하는 것이 아니라 첫 화면으로 나간다.

    `enter` 를 클로저로 두는 이유: 뒤로 갔다가 다시 앞으로 와도 **같은 결과**를 그려야
    한다. 판정 결과는 이미 나온 값이라 다시 계산할 수 없다.
  */
  /*
    자동 넘김은 **이어 달릴 수 있을 때만** 센다 — 다음 판이 있고, 실패하지 않았을 때.
    실패한 판을 자동으로 넘기면 방금 틀린 것을 다시 해 보지 않고 지나가게 된다.
    (결과 화면이 '다음 Stage' 버튼을 띄우는 조건과 같아야 한다)
  */
  const nextId = sc.id + 1;
  /*
    AI 과정에서는 **다음 판이 늘 있다** — 만들면 되기 때문이다. 마스터가 된 뒤에도 마스터 운행(L10 무작위)이 이어진다.
    **마스터가 된 그 판만은** 자동으로 넘기지 않는다 — 엔딩이 결과 화면 위에 뜨는 자리라서다.
  */
  const canAdvance = aiCourse
    ? !justMastered && result.grade !== 'FAIL'
    : nextId <= SCENARIOS.length && result.grade !== 'FAIL';

  nav.replace({
    name: 'debrief',
    enter: () => {
      screens.show('debrief');
      screens.renderDebrief(sc, result, unlockedNew, saveData, {
        onRetry: () => goRun(sc.id, true),
        /*
          AI 과정에서는 '다음' 이 **다음 Stage 가 아니라 다음에 만들어질 판**이다.
          단계는 방금 위에서 움직였으므로, 여기서 만들면 그 단계에 맞는 판이 나온다.
        */
        onNext: () => (aiCourse ? void makeAiScenario() : goRun(nextId, true)),
        onMenu: goHome,
        onCoachReady: () => {
          if (saveData.settings.autoNextStage && canAdvance) startAutoNext(nextId);
        },
        onToggleAutoNext: (on) => {
          saveData.settings.autoNextStage = on;
          commit();
          // 켠 그 자리에서 세기 시작하고, 끄면 그 자리에서 멈춘다
          if (on && canAdvance) startAutoNext(nextId);
          else stopAutoNext();
        },
        onToggleAutoNextPause: () => toggleAutoNextHold(),
      }, courseStep, badgeEvents);
      /*
        **마스터를 해낸 그 판이면 엔딩으로 간다** (showEnding). 한 번만 띄운다 — 뒤로 갔다 돌아와도 다시 뜨지 않는다.
        첫 화면의 "엔딩 다시 보기" 로 다시 볼 수 있다.
      */
      if (justMastered) {
        justMastered = false;
        showEnding();
        return;
      }
      // 뒤로 갔다가 다시 이 화면으로 돌아와도 같은 규칙으로 다시 센다
      /*
        **자동 넘김은 AI 의 평가가 올라온 뒤부터 센다** (아래 onCoachReady). 화면이 뜨자마자 세면 AI 가
        답하는 1~4초가 읽을 시간에서 깎인다 — 사용자가 "답을 받고 그 이후 7초" 라고 정했다.
        뒤로 갔다가 다시 이 화면으로 돌아와도 같은 규칙이다 (renderDebrief 가 다시 불린다).
      */
    },
  });
}

/**
 * **엔딩** — L10 을 마치고 안전운전 마스터가 되면 AI 가 축하한다. 그 뒤로는 **마스터 운행**이 이어진다.
 *
 * 한때 엔딩에서 게임이 끝났다(첫 화면에 '엔딩 다시 보기' 만 남음). 그 뒤 사용자가 "마스터 단계가 되고, 처음부터 다시
 * 시작을 누르기 전까지는 랜덤으로 10 단계의 문제들이 계속 돌아가게 해 줘" 라고 해서, 첫 화면의 '마스터 운행' 으로 L10
 * 코스를 무작위로 이어 달린다 (makeAiScenario · recommend.ts 의 masterPick).
 *
 * 예전에는 작은 축하 창을 띄우고 첫 화면으로 보낸 뒤 "한 판 더" 로 계속 달릴 수 있었다 — 과정이 끝났다는 것이
 * 드러나지 않았다. 사용자가 짚었다: "레벨 10 이후에는 마스터를 하며 게임의 엔딩이 되는 거야. AI 로봇이 normal.webp
 * 이미지를 보여 주면서 축하해 줘. 그리고 게임이 끝나는 거야." 누르면 **엔딩을 마친 첫 화면**으로 돌아가고, 쌓인
 * 화면 기록은 버린다 (거기서 뒤로가기로 결과 화면에 돌아갈 까닭이 없다). 다시 하려면 '처음부터 다시 시작' 이다.
 *
 * 글은 index.html 의 #ending 에 고정돼 있다 — 사용자가 정한 세 줄("축하합니다!!! / AI 안전운전 레벨업을 마스터 하셨습니다. /
 * 우회전과 어린이보호구역의 안전운전 마스터로 임명합니다.")과 확인 버튼. 한때 달린 판 수를 적는 통계 줄이 있었는데 그때 뺐다.
 */
function showEnding(): void {
  const root = document.getElementById('ending');
  const ok = document.getElementById('ending-ok');
  const robot = document.getElementById('ending-robot') as HTMLImageElement | null;
  if (!root || !ok) return;
  if (robot) robot.src = robotNormal;
  stopAutoNext();
  root.hidden = false;
  ok.focus();
  ok.addEventListener(
    'click',
    () => {
      root.hidden = true;
      nav.reset({ name: 'menu', enter: renderMenu });
    },
    { once: true },
  );
}

/**
 * 시범 코스 하나가 끝났다 — 결과 화면을 잠깐 보여 주고 다음 코스로. **마지막 코스 뒤에는 끝났다는 창**을 띄우고,
 * 확인을 누르면 첫 화면으로 간다.
 *
 * 결과 화면을 건너뛰지 않는 이유: 규정대로 돌면 어떤 등급이 나오는지가 이 기능이 말하려는
 * 것이라, 그 배지를 보고 넘어가야 뜻이 산다.
 *
 * 마지막 코스는 카운트다운을 세지 않는다. 한때 같은 카운트다운으로 세어 첫 화면으로 보냈는데, 사용자가 "카운트다운이
 * 계속되고 초기 화면으로 간다 — 팝업으로 '끝났습니다. 감사합니다' 를 띄우고 확인을 누르면 초기 화면으로" 라고 정했다.
 * 부스에서 열 판을 다 본 사람에게 끝났다는 것을 분명히 알리는 자리다.
 */
function finishDemoRun(sc: ScenarioSpec, result: JudgeResult): void {
  const at = demoQueue.indexOf(sc.id);
  const nextId = at >= 0 ? demoQueue[at + 1] : undefined;
  const last = nextId === undefined;

  controls.setEnabled(false);
  game?.showTopView();
  hud.hide();

  nav.replace({
    name: 'debrief',
    enter: () => {
      screens.show('debrief');
      screens.renderDebrief(
        sc,
        result,
        false,
        saveData,
        {
          onRetry: () => goRun(sc.id, true),
          onNext: () => (nextId !== undefined ? goRun(nextId, true) : goHome()),
          onMenu: goHome,
          onToggleAutoNext: () => undefined,
          onToggleAutoNextPause: () => toggleAutoNextHold(),
        },
        null,
        [],
        /*
          **자율 주행(오프라인 교육)** — AI 분석 칸은 두되 AI 에게 묻지 않고 까닭을 적는다, 다음 교육 코스(마지막이면 첫 화면)로 가는
          버튼과 카운트다운은 일반 판과 같은 자리에 둔다 (사용자 요청 — Screens.renderDebrief 의 options.demo).
        */
        { demo: { nextLabel: last ? '첫 화면으로' : '다음 교육 코스' } },
      );
      if (!last) {
        startAutoNext(nextId);
        return;
      }
      // 마지막 교육 코스 — 카운트다운 없이 끝났다는 창. 어느 길로 닫든 확인이라(Screens.confirm 의 single) 첫 화면으로 간다
      void screens
        .confirm({ title: '안전운행 자율주행이 끝났습니다.', lines: ['감사합니다.'], ok: '확인', single: true })
        .then(() => {
          // 창이 떠 있는 사이 다른 길로 결과 화면을 떠났으면(첫 화면 등) 그대로 둔다
          if (nav.current === 'debrief') goHome();
        });
    },
  });
}

/**
 * **맵 체험을 마쳤다** — 결과만 보여 주고 아무것도 남기지 않는다 (위 mapTrial).
 *
 * 다음 판으로 저절로 넘어가지 않는다. 체험은 **그 판 하나**를 보려고 고른 것이라, 다음으로 넘어가면
 * 방금 본 것을 다시 달려 볼 틈이 없다 — '다시 운행' 으로 같은 판을 되풀이하고, 다른 번호는 첫 화면에서 넣는다.
 */
function finishTrialRun(sc: ScenarioSpec, result: JudgeResult): void {
  controls.setEnabled(false);
  game?.showTopView();
  hud.hide();

  nav.replace({
    name: 'debrief',
    enter: () => {
      screens.show('debrief');
      screens.renderDebrief(
        sc,
        result,
        false,
        saveData,
        {
          onRetry: () => goRun(sc.id, true),
          onNext: goHome,
          onMenu: goHome,
          onToggleAutoNext: () => undefined,
          onToggleAutoNextPause: () => toggleAutoNextHold(),
        },
        null,
      );
    },
  });
}

const GRADE_RANK: Record<string, number> = { FAIL: 0, VIOLATION: 1, PASS: 2, PERFECT: 3 };
function isBetter(next: string, prev: string | undefined): boolean {
  if (!prev) return true;
  return (GRADE_RANK[next] ?? 0) > (GRADE_RANK[prev] ?? 0);
}

// ── 부팅 ───────────────────────────────────────────────────────────────────

function boot(): void {
  /*
    MSAA 는 **첫 렌더러를 만들기 전에** 정해져야 한다 — WebGL 컨텍스트 속성이라
    나중에 바꿀 수 없다. 그래서 설정 화면은 값을 저장만 하고 "다시 시작 후 적용" 이라고
    적는다. 여기가 그 '다시 시작' 이다.
  */
  setMsaaPreference(saveData.settings.graphics.msaa);
  hud.setShowFps(saveData.settings.graphics.showFps);

  /*
    차량 모델을 **메뉴에 있는 동안 미리 받아 둔다.**

    모델은 2.2MB 라 받는 데 시간이 걸린다. 주행이 시작된 뒤에 받으면 그동안 차가 없어
    화면 아래가 도로만 보이다가 차가 툭 나타난다. 메뉴를 보는 동안 받아 두면 캐시가
    더워져 있어, 출발을 누른 첫 프레임부터 차가 자리에 있다.

    실패해도 그냥 넘어간다 — 주행 시작 때 다시 시도하고, 그때도 없으면 절차적 차체로 간다.
  */
  // 휴대폰은 주행이 쓰는 가벼운 모델을 받아 둔다 — 원본을 받으면 쓰지도 않을 것이 캐시에 남는다 (carModel.ts 의 playerLod)
  void loadCarModel(getCar(saveData.activeCarId), { lod: playerLod() }).catch(() => undefined);
  void prewarm();

  /*
    첫 화면이 히스토리의 **바닥**이다. 여기서 뒤로가기를 누르면 게임 밖으로 나가는데,
    그것이 맞다 — 첫 화면은 들어온 곳이지 되돌아갈 곳이 아니다.

    `#shop` 같은 주소로 새로고침해도 첫 화면으로 연다. 화면 상태(어느 레벨까지 올라왔는지·
    어떤 판을 열었는지)는 저장 데이터에 있고 주소에는 없어서, 주소만 보고 그 화면을 복원하면
    빈 전시관이나 남의 결과 화면이 뜬다.
  */
  nav.reset({ name: 'menu', enter: renderMenu });

  /*
    **검증용 — 주소의 `?ai=번호` 로 그 판을 자율 주행으로 바로 달린다** (예 `?ai=M02601` · `?ai=110005203020`).
    판의 사람 · 앞차 움직임을 고친 뒤 브라우저에서도 시뮬레이터와 같은지 볼 때 쓴다 — 오프라인 교육은 정해진 열 판만 돌아
    다른 판을 자율 주행으로 볼 길이 없었다 (2026-09-27, 빗길 앞차 뒤 뛰어드는 사람의 방아쇠를 고치며). 오프라인 교육과 같은
    길을 타되 한 판만 달리고, 끝나면 그 안내창으로 첫 화면에 돌아온다. 저장본에는 여느 자율 주행처럼 남는다.
  */
  const aiParam = new URLSearchParams(location.search).get('ai');
  if (aiParam) {
    const id = Number(aiParam);
    const spec = scenarioByCode(aiParam) ?? (Number.isInteger(id) ? (libraryEntry(id)?.spec ?? zoneCourse(id)) : undefined);
    if (spec) {
      aiDriving = true;
      aiCourse = false;
      demoQueue = [spec.id];
      goRun(spec.id);
    }
  }
}

/**
 * 메뉴에 있는 동안 **무거운 것을 미리 굽는다.**
 *
 * 08번(조건 무작위)이 판마다 시간대와 주변 차종을 새로 뽑는데, 그때 처음 만나는 것을
 * 주행 중에 받으면 그대로 끊긴다. 실제로 첫 판에서 두 번 멈칫했다 —
 *
 *   1. HDRI: 낮 것만 미리 받아 두어서 황혼·밤이 뽑히면 1.5MB 를 받아 풀고(주 스레드)
 *      환경맵으로 구웠다. 게다가 환경맵을 나중에 걸면 **장면의 모든 재질이 다시 컴파일된다.**
 *   2. 주변 차 모델: 첫 판에는 캐시가 내 차 한 대뿐인데 NPC 는 내 차를 피해서 뽑으므로,
 *      2~5MB 짜리 모델을 주행 중에 받아 풀었다.
 *
 * 그래서 세 시간대를 다 굽고, 가장 가벼운 모델(m8, 1.1MB) 하나를 NPC 감으로 받아 둔다.
 *
 * **하나씩 차례로 한다.** 한꺼번에 걸면 메뉴가 버벅이고 회선도 나눠 쓴다. 순서는 만날
 * 확률이 높은 것부터다 — 낮 → 황혼 → 밤 → NPC 감.
 *
 * 실패는 무시한다. 미리 굽기는 최적화일 뿐이고, 없으면 예전처럼 그때 받으면 된다.
 */
async function prewarm(): Promise<void> {
  const renderer = sharedRenderer(canvas);
  for (const time of ['day', 'dusk', 'night'] as const) {
    await bakeEnvironment(renderer, time).catch(() => null);
  }
  // 배경 차는 가벼운 모델(LOD), 앞차는 원본으로 그리므로 둘 다 데워 둔다 (TrafficCar · carModel.ts 의 loadCarModel)
  await loadCarModel(getCar(NPC_PREWARM_CAR_ID), { forPlayer: false, lod: true }).catch(() => undefined);
  // 휴대폰은 앞차 · 뒷차도 가벼운 모델이라(Game 의 setNearCarLod) 원본을 받을 일이 없다
  if (!isHandheld()) await loadCarModel(getCar(NPC_PREWARM_CAR_ID), { forPlayer: false }).catch(() => undefined);
}

/*
  **사진 목록을 받은 뒤에 첫 화면을 그린다.** 첫 화면의 '지금 타는 차' 칸이 사진을 쓰는데,
  목록보다 먼저 그리면 구운 3D 그림이 잠깐 나왔다 사진으로 바뀐다. 목록은 작은 JSON 하나이고,
  받지 못해도(단일 파일 빌드·서버 멈춤) 던지지 않고 한도 시간 안에 끝난다.
*/
void loadCarPhotos().finally(boot);
