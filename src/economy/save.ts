/**
 * 진행 상황 저장. localStorage 한 곳에 JSON으로 넣는다.
 * 스키마가 바뀔 가능성이 있으므로 version을 두고, 읽을 때 기본값과 병합한다.
 */

import { CARS, isCarUnlocked, STARTER_CAR_ID } from './cars';
import { SCENARIOS } from '../scenarios/scenarios';
import type { ViewMode } from '../game/CameraRig';
import { defaultGraphics, graphicsFromSaved, type GraphicsSettings } from '../game/quality';
import { DEFAULT_SOUNDS } from '../game/soundAssets';
import { freshCurriculum, unlockedLevel, type CurriculumState } from '../scenarios/curriculum';
import { DEFAULT_CHALLENGE, type Challenge } from '../scenarios/challenge';
import { habitsTestedBy, libraryEntry } from '../scenarios/library';
import { badgesFromHistory, freshBadges, normalizeBadges, type BadgeState } from './badges';

const KEY = 'turn-right:save:v1';

/**
 * 저장 스키마 버전.
 *
 * v2 — 우회전 신호등 시나리오(구 6·7)를 없애고 번호를 다시 매겼다.
 * v3 — **우회전신호등 시나리오 둘을 05·06 으로 넣으면서** 그 뒤 번호가 밀렸다
 *      (어린이보호구역 5 → 7, 조건 무작위 6 → 8).
 * v4 — 상점이 생기면서 `ownedCarIds` 의 뜻이 바뀌었다. 예전에는 **골라 탄 적이 있는 차**가
 *      전부 들어갔는데(차를 고르는 것만으로 목록에 담겼다), 이제는 **점수로 산 차**만 담긴다.
 *      그대로 두면 구경만 한 사람이 아홉 대를 공짜로 갖게 되므로 시작 차 하나로 되돌린다.
 * v5 — 주행 이력(`history`)이 생겼다. 없던 항목이라 예전 저장본은 빈 배열로 시작한다 —
 *      되돌릴 것이 없다.
 * v6 — AI 주행의 진행 상태(`curriculum`)가 생겼다. 이것도 없던 항목이라
 *      예전 저장본은 1단계부터 시작한다.
 * v7 — 그 안의 `mistakes`(줄지 않는 위반 횟수)가 **나쁜 운전 습관** 목록으로 바뀌었다.
 *      습관은 고치면 사라지므로 예전 숫자를 그대로 옮길 수 없다 — 빈 목록에서 시작한다.
 * v8 — 상점이 **자동차전시관**이 되면서 차를 사는 개념이 사라졌다. 차는 계급이 오르면
 *      열린다(economy/cars.ts). `ownedCarIds` 는 뜻을 잃어 지웠고, 예전에 산 차가 지금
 *      계급보다 높으면 **탈 수 없게 되므로** 타던 차도 확인해 되돌린다.
 * v9 — 계급 넷(초급·중급·고급·마스터)이 **레벨 열(L1~L10)** 로 바뀌었다. 저장하는 항목은
 *      그대로다 — `curriculum.level`·`bestLevel` 이 이미 1~10 이었고, 계급은 그 위에
 *      얹혀 있던 표시 층이었을 뿐이다. **되돌릴 것이 없다.**
 *
 *      차가 열리는 규칙만 달라졌는데(계급 → 레벨) 새 규칙이 옛 규칙보다 **너그럽다** —
 *      예전에는 계급이 세 단계에 한 번 올라 5단계 학습자가 두 대뿐이었지만 지금은
 *      다섯 대다. 그래서 옮겨 오면서 차를 빼앗기는 저장본이 없다.
 * v10 — AI 과정이 **5레벨에서 시작**한다(curriculum.ts 의 START_LEVEL). 저장 모양은
 *      그대로지만 `level` 의 뜻이 달라졌다 — 예전에는 올라와서 서 있는 자리였고
 *      지금은 **주어진 자리**다. 아래 `bestLevel` 보정이 그 차이를 안다.
 *
 * v11 — 화질에 **렌더 해상도** 항목이 생겼다. 없던 항목이라 예전 저장본은 기본값 '자동' 으로 채워지는데,
 *      '낮음' 프리셋은 75% 라 **네 항목이 낮음과 똑같은데도 프리셋이 풀린 채로** 설정이 열렸다. 사용자가
 *      세 번 물었다 — "전체 프리셋에 아무것도 설정되어 있지 않아." 그래서 v11 미만 저장본은 나머지 네
 *      항목이 가리키는 프리셋의 해상도를 따른다 (quality.ts 의 graphicsFromSaved).
 *
 *      **한 번만 한다.** 채워진 '자동' 과 사용자가 고른 '자동' 은 저장본에서 구별되지 않으므로, 버전으로
 *      한 번 되살린 뒤에는 고른 값을 그대로 둔다.
 *
 * v12 — **뱃지**(`badges`)가 생겼다 (economy/badges.ts). 없던 항목이라, 예전 저장본은 **남아 있는 주행 기록(최근 60판)
 *      으로 채운다** — 이미 7레벨까지 온 사람이 뱃지 0개에서 시작하면 그동안 지켜 온 것이 없던 일이 된다 (사용자가 정했다).
 *      기록에 없는 것(고친 습관 · 앞차가 실제로 섰는지)은 세지 않는다.
 *
 * **버전이 올랐다고 전부 버리지는 않는다.** 항목마다 언제부터 뜻이 달라졌는지가 다르므로
 * 저장본의 버전을 보고 해당 항목만 되돌린다 — 상점 때문에 최고 등급 기록까지 날릴 이유가 없다.
 */
const VERSION = 12;

/**
 * 주행 한 판의 기록 — **습관 진단에 쓰는 것만** 남긴다.
 *
 * 판정 결과(JudgeResult)를 통째로 넣지 않는 이유는 둘이다.
 *  - 궤적(path)과 보행자 경로는 한 판에 수백 점이라 localStorage(5MB 안팎)가 금세 찬다.
 *  - 진단이 보는 것은 "이 사람이 **어디서 반복해서** 무너지는가" 하나뿐이다.
 *    한 판 안의 시각·좌표는 그 판의 디브리핑이 이미 답했다.
 *
 * 필드 이름이 짧은 것도 같은 이유다 — 판마다 JSON 키가 통째로 다시 저장된다.
 *
 * **시각(timestamp)은 넣지 않는다.** 개선 추이는 배열 순서로 충분하고, 언제 플레이했는지는
 * 진단에 쓰이지 않으면서 개인정보의 성격만 띤다.
 */
export interface RunRecord {
  /** Stage 번호 */
  st: number;
  /** 등급 (Grade) */
  g: string;
  /** 위반 코드 목록 (ViolationCode) */
  v: string[];
  /** 정지선 앞에서 완전정지했는가 */
  sa: boolean;
  /** 우회전 후 횡단보도(C) 앞에서 정지했는가 */
  sc: boolean;
  /** 교차로 내 최고 속도 (km/h) */
  sp: number;
  /** 30m 전 방향지시등이 켜져 있었는가 */
  sg: boolean;
}

/**
 * 남겨 두는 주행 수.
 *
 * 60판이면 8판짜리 한 바퀴를 일곱 번 넘게 담는다 — 습관을 보기에 충분하고,
 * 한 판이 100바이트 남짓이라 저장 용량에도 부담이 없다.
 * 넘치면 **오래된 것부터 버린다** — 최근 습관이 지금의 습관이다.
 */
export const HISTORY_LIMIT = 60;

export interface SaveData {
  version: number;
  /**
   * 누적 안전 운전 포인트.
   *
   * 저장 키 이름은 `money` 로 둔다 — 화면 표기만 포인트로 바꾼 것이라, 키를 갈면
   * 이미 저장된 사람들의 값이 통째로 0 이 된다. 이름값보다 그쪽이 훨씬 크다.
   */
  money: number;
  /** 현재 타고 있는 차량 id */
  activeCarId: string;
  /** 해금된 시나리오 번호(1부터). 최고 도달 번호를 저장한다. */
  unlockedScenario: number;
  /** 누적 벌점 */
  penaltyPoints: number;
  /** 시나리오별 최고 등급 */
  bestGrades: Record<string, string>;
  /**
   * 차종별 좌석 앞뒤 조절값 (m, +가 앞).
   *
   * 차마다 앞유리 각도와 대시보드 깊이가 달라 기본 자리가 누구에게나 맞지 않는다.
   * 차고에서 맞춰 두면 그 차로 주행할 때마다 그대로 적용된다. 없는 차는 0(기본 자리).
   */
  seatOffsets: Record<string, number>;
  /*
    전시관 대표 사진은 **저장본에 없다.** 서버의 car-photos/ 폴더에 파일로 있다
    (economy/carPhotos.ts). 예전 저장본에 남은 `carPhotos` 는 load() 가 버린다.
  */
  /**
   * 사용자 설정.
   *
   * 진행 상황(포인트·기록)과 달리 **초기화 버튼으로 지워지지 않는다** — 초기화는 "다시
   * 처음부터 해 보겠다"는 뜻이지 "화면 설정도 되돌려 달라"는 뜻이 아니다.
   */
  settings: {
    /**
     * 주행을 시작할 때의 시점.
     *
     * **기본은 후방 시점이다.** 운전자 시점은 이 게임의 목적지이지만 출발점으로는 어렵다 —
     * 처음 앉으면 차가 도로 어디에 있고 차폭이 얼마나 되는지 감이 없어 차로를 벗어난다.
     * 뒤에서 따라가는 화면은 차와 차로가 함께 보여 그 감을 먼저 잡게 해 준다.
     *
     * 시점은 주행 중에도 C 로 바꿀 수 있으니, 이 값은 **어디서 시작할지**만 정한다.
     */
    startView: ViewMode;
    /**
     * 판이 끝나면 다음 Stage 로 **자동으로 넘어가는가.**
     *
     * **기본은 켜짐이다.** 여덟 판을 이어 달리는 것이 이 게임의 기본 흐름이라, 판마다
     * 버튼을 찾아 누르게 하면 그 흐름이 매번 끊긴다.
     *
     * 결과 화면을 더 읽어야 하는 사람은 **체크를 끄면 그 자리에서 멈춘다** — 5초를
     * 세는 동안 체크가 버튼 바로 아래에 보이고, 끈 값은 다음 판부터도 그대로 남는다.
     * 실패한 판은 애초에 세지 않으므로(다시 해 봐야 한다) 틀린 채로 넘어가지 않는다.
     */
    autoNextStage: boolean;
    /**
     * 화질 — 무엇을 낮추면 무엇이 빨라지는지는 game/quality.ts 가 정한다.
     *
     * 기기 성능은 사람마다 다른데 화면에서 재 볼 방법이 없으므로, 값을 저장해 두고
     * 한 번 맞춰 놓으면 계속 쓰게 한다.
     */
    graphics: GraphicsSettings;
    /**
     * **난이도 설정 1~5** (scenarios/challenge.ts) — 같은 레벨 안에서 AI 가 얼마나 어려운 코스를 고르는가.
     * 기본 3. 레벨(학습 진도)과는 따로다.
     */
    difficulty: Challenge;
    /**
     * 고른 소리 (soundAssets.ts 의 각 목록에 있는 id).
     *
     * 후보를 여럿 두고 고르게 하는 이유는, **어떤 소리가 좋은지는 들어 봐야 알기**
     * 때문이다. 스펙트럼으로는 성격(묵직한가 얇은가)만 알 수 있고 그것이 이 게임에
     * 어울리는지는 다른 문제다.
     *
     * 셋을 **따로** 둔다 — "엔진은 3번인데 경적은 2번" 이 되어야 한다.
     * 모르는 id 가 들어와도 engineById 등이 기본값으로 되돌리므로 검증하지 않는다.
     */
    sounds: { engine: string; horn: string; blinker: string };
  };
  /** 통계 */
  stats: {
    attempts: number;
    perfects: number;
    violations: number;
    fails: number;
    /** 현재 연속 무위반 횟수 */
    streak: number;
    /** 최고 연속 무위반 횟수 */
    bestStreak: number;
  };
  /**
   * 주행 이력 — **오래된 것이 앞**이다 (시간순).
   *
   * 위 `stats` 는 총계라 "몇 번 위반했나"까지만 답한다. 습관 진단은 그것으로 안 된다 —
   * 같은 사람이 **어디서** 반복해서 무너지는지, 나아지고 있는지는 판별 기록이 있어야
   * 나온다. 그것을 담는 자리다.
   */
  history: RunRecord[];
  /**
   * AI 주행의 진행 상태.
   *
   * **저장한다.** 마스터는 한 자리에서 끝낼 수 있는 것이 아니고, 다음에 열었을 때
   * 1단계로 돌아가 있으면 이 과정 자체가 성립하지 않는다.
   *
   * 진행 상황이라 **초기화 버튼으로 지워진다** (설정과 달리).
   */
  curriculum: CurriculumState;
  /** 뱃지 — 법규 지킴 · 무위반 연속 · 성장 (economy/badges.ts). 처음부터 다시 시작하면 함께 지운다 */
  badges: BadgeState;
}

export function defaultSave(): SaveData {
  return {
    version: VERSION,
    money: 0,
    activeCarId: STARTER_CAR_ID,
    unlockedScenario: 1,
    penaltyPoints: 0,
    bestGrades: {},
    seatOffsets: {},
    settings: {
      startView: 'chase',
      autoNextStage: true,
      difficulty: DEFAULT_CHALLENGE,
      graphics: defaultGraphics(),
      sounds: { ...DEFAULT_SOUNDS },
    },
    stats: { attempts: 0, perfects: 0, violations: 0, fails: 0, streak: 0, bestStreak: 0 },
    history: [],
    curriculum: freshCurriculum(),
    badges: freshBadges(),
  };
}

/**
 * 판이 끝났을 때 이력에 한 줄 남긴다. **저장본을 바꿔서 돌려주지 않고 그 자리에서 민다** —
 * 부르는 쪽(main.ts 의 finishRun)이 이미 다른 필드를 고치고 한 번에 commit 하기 때문이다.
 */
export function pushHistory(data: SaveData, rec: RunRecord): void {
  data.history.push(rec);
  if (data.history.length > HISTORY_LIMIT) {
    data.history.splice(0, data.history.length - HISTORY_LIMIT);
  }
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    /*
      **예전 저장본의 사진(`carPhotos`)은 버린다.** 사진이 서버 파일로 옮겨 갔고
      (economy/carPhotos.ts), 남겨 두면 쓰지도 않는 data URL 이 localStorage 한도를
      계속 차지한다. 다음 저장 때 저장본에서 빠진다.
    */
    const { carPhotos: _legacyPhotos, ...parsed } = JSON.parse(raw) as Partial<SaveData> & {
      carPhotos?: unknown;
    };
    const base = defaultSave();
    const from = parsed.version ?? 0;

    const merged: SaveData = {
      ...base,
      ...parsed,
      version: VERSION,
      // v3 이전 저장본의 등급은 시나리오 번호가 바뀌어 다른 판을 가리킨다
      bestGrades: from < 3 ? {} : { ...base.bestGrades, ...(parsed.bestGrades ?? {}) },
      unlockedScenario: Math.min(
        Math.max(1, parsed.unlockedScenario ?? 1),
        SCENARIOS.length,
      ),
      // 좌석 조절값은 시나리오 번호와 무관하므로 구 버전 저장본에서도 이어받는다
      seatOffsets: { ...base.seatOffsets, ...(parsed.seatOffsets ?? {}) },
      settings: {
        ...base.settings,
        ...(parsed.settings ?? {}),
        /*
          화질은 **항목별로** 합친다 — 통째로 덮으면 새 항목이 undefined 로 들어온다. 나중에 생긴 항목을 기본값으로
          채우면 예전에 고른 프리셋이 풀릴 수 있어, 그 경우는 프리셋을 따라간다 (quality.ts 의 graphicsFromSaved).
        */
        graphics: graphicsFromSaved(parsed.settings?.graphics, from < 11),
        // 소리도 **항목별로** 합친다 — 통째로 덮으면 새로 생긴 항목이 undefined 로 들어온다
        sounds: { ...base.settings.sounds, ...(parsed.settings?.sounds ?? {}) },
      },
      stats: { ...base.stats, ...(parsed.stats ?? {}) },
      /*
        이력은 **길이를 믿지 않는다.** 저장본을 손으로 고친 경우 한도를 넘겨 들어올 수
        있고, 그러면 리포트 프롬프트가 통째로 부풀어 오른다. 읽는 자리에서 자른다.
      */
      history: Array.isArray(parsed.history) ? parsed.history.slice(-HISTORY_LIMIT) : [],
      /*
        AI 주행의 진행. **항목별로 합친다** — 통째로 덮으면 나중에 늘어난 항목이
        undefined 로 들어와 단계 계산이 NaN 이 된다.

        v7 이전 저장본의 습관 기록(`mistakes`)은 **버린다.** 줄어들지 않는 누적 횟수라
        지금의 "고치면 사라지는 습관" 으로 옮길 방법이 없다 — 이미 고친 것까지 되살아난다.
      */
      curriculum: {
        ...base.curriculum,
        ...(parsed.curriculum ?? {}),
        badHabits: from < 7 ? [] : (parsed.curriculum?.badHabits ?? []),
        /*
          **v10 이전 저장본에만 지금 레벨을 최고 기록으로 올려 준다.**

          v8 에서 `bestLevel` 이 생겼을 때는 없던 값을 메우는 일이었다 — 그때 5레벨에
          서 있다는 것은 거기까지 **올라왔다**는 뜻이었으므로, 그 레벨까지의 차는
          열려 있는 것이 맞았다.

          v10 부터는 그 셈이 거짓말이 된다. 새 저장본은 5레벨에서 **시작**하므로
          (START_LEVEL), 여기서 max 를 걸면 한 판도 안 몬 사람이 다음에 켤 때 차
          다섯 대를 갖게 된다 — 저장하고 새로고침하는 것만으로.

          그래서 버전을 보고 가른다. 옛 저장본은 메워 주고, v10 이후는 저장된 값을
          그대로 믿는다.
        */
        bestLevel: (from < 10
          ? Math.max(parsed.curriculum?.bestLevel ?? 1, parsed.curriculum?.level ?? 1)
          : (parsed.curriculum?.bestLevel ?? 1)) as CurriculumState['bestLevel'],
      },
    };

    /*
      **탈 수 없는 차를 타고 있을 수 있다.**

      v8 에서 차가 '산 것' 에서 '진행이 열어 준 것' 으로 바뀌었다. 예전에 점수로 사 둔
      슈퍼카는 지금 레벨로는 열리지 않으므로, 그대로 두면 전시관에는 잠겨 있는데
      주행은 그 차로 나가는 어긋난 상태가 된다. 열린 것 중 하나로 되돌린다.

      버전과 무관하게 **읽을 때마다 본다.** 저장본을 손으로 고쳤을 수도 있고, 차의
      레벨을 옮기면(cars.ts 의 한 줄) 예전 저장본이 그 자리에서 어긋나기 때문이다.
    */
    /*
      **뱃지** — v12 에서 생겼다. 그 전 저장본은 남은 주행 기록으로 채우고(위 v12), 그 뒤로는 항목별로 합친다 (뱃지가
      늘어도 예전 저장본이 깨지지 않게 — badges.ts 의 normalizeBadges).
    */
    merged.badges =
      from < 12
        ? badgesFromHistory(
            merged.history,
            (id) => libraryEntry(id)?.spec ?? SCENARIOS.find((s) => s.id === id),
            habitsTestedBy,
            merged.curriculum.mastered,
          )
        : normalizeBadges(parsed.badges);

    const active = CARS.find((c) => c.id === merged.activeCarId);
    if (!active || !isCarUnlocked(active, unlockedLevel(merged.curriculum))) {
      merged.activeCarId = STARTER_CAR_ID;
    }
    return merged;
  } catch {
    // 손상된 저장 데이터로 게임이 아예 안 켜지는 것보다는 초기화가 낫다.
    return defaultSave();
  }
}

/**
 * 저장. **성공 여부를 돌려준다.**
 *
 * 시크릿 모드 등에서 저장이 막혀도 플레이 자체는 계속되어야 하므로 던지지는 않는다.
 * 다만 "저장이 목적인" 동작은 실패를 알려야 할 수 있어 결과를 반환한다.
 */
export function save(data: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/**
 * 지울 진행이 있는가 — **초기화 버튼을 띄울지 정한다.**
 *
 * 갓 켠 저장본에도 버튼이 보이면 눌러도 아무 일이 안 난다. 이 게임은 그런 손잡이를
 * 남기지 않는다(화질 설정의 '듣는 손잡이만 넣는다' 와 같은 사고다).
 *
 * `activeCarId` 는 보지 않는다 — 계급이 초기화되면 어차피 시작 차로 돌아가므로,
 * 차만 바꿔 본 사람에게 "지울 진행이 있다" 고 말할 이유가 없다.
 */
export function hasProgress(s: SaveData): boolean {
  return (
    s.money > 0 ||
    s.history.length > 0 ||
    s.stats.attempts > 0 ||
    s.unlockedScenario > 1 ||
    Object.keys(s.bestGrades).length > 0 ||
    s.curriculum.runs > 0 ||
    /*
      **`level` 이 아니라 `bestLevel` 이다.** AI 과정은 5레벨에서 시작하므로
      (curriculum.ts 의 START_LEVEL) `level > 1` 은 갓 켠 저장본에서도 참이다.
      올라간 자리(bestLevel)는 통과해야만 오른다.
    */
    s.curriculum.bestLevel > 1 ||
    s.curriculum.mastered ||
    s.curriculum.badHabits.length > 0
  );
}

/**
 * 진행 상황 초기화 — **다음 운전자가 빈 손으로 앉는다.**
 *
 * 이 게임은 한 운전자가 몇 달을 붙드는 물건이 아니라 **짧은 시간에 우회전 마스터까지
 * 가 보는** 체험이다. 캠페인 부스의 한 대를 여러 운전자가 번갈아 앉는 것이 기본 쓰임이라,
 * 앞 운전자의 나쁜 운전 습관을 물려받으면 AI 가 내 것이 아닌 판을 만들어 낸다 —
 * 그 순간 이 과정의 전제가 무너진다. 그래서 초기화는 부수 기능이 아니라 **입구**다.
 *
 * ## 지우는 것과 남기는 것
 *
 * **지운다** — 계급·단계·나쁜 운전 습관(curriculum), 주행 기록(history), 통계, 운전점수,
 * 최고 등급, 열어 둔 시나리오, 타던 차. 전부 "이 사람이 어떻게 몰았는가" 다.
 *
 * **남긴다** — 두 가지이고, 이유가 저마다 다르다.
 *  - `settings` — 초기화는 "다시 처음부터 해 보겠다" 는 뜻이지 "화면 설정도 되돌려
 *    달라" 는 뜻이 아니다. 부스에서는 그 기기에 맞춰 맞춰 둔 화질이기도 하다.
 *  - `seatOffsets` — 앉은키에 맞춘 값이라 진행이 아니라 몸에 붙은 설정에 가깝다.
 *    남겨 둬도 다음 운전자가 그 차에서 다시 맞추면 그만이고, 지우면 매번 다시 맞춰야 한다.
 *
 * 전시관 사진은 저장본에 없으므로(서버 파일, economy/carPhotos.ts) 초기화와 무관하게 남는다.
 */
export function reset(current?: SaveData): SaveData {
  const fresh = defaultSave();
  if (current) {
    fresh.settings = { ...fresh.settings, ...current.settings };
    fresh.seatOffsets = { ...current.seatOffsets };
  }
  save(fresh);
  return fresh;
}
