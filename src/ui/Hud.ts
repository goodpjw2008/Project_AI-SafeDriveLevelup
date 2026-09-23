/**
 * 주행 중 HUD. GameSnapshot을 받아 DOM 표시를 갱신한다.
 *
 * 신호 상태 패널을 굳이 두는 이유: 운전자 시점에서는 신호등이 시야 밖으로 나가는 순간이 있는데,
 * 이 게임의 목적은 "신호를 못 봐서 틀리는 것"이 아니라 "신호를 알고도 잘못 판단하는 것"을
 * 교정하는 데 있기 때문이다.
 *
 * 우하단에 있던 **미니맵은 뺐다.** 그 자리는 계기판(일시정지 게이지·속도계·방향지시등)이 쓴다.
 * 주행 중에 탑다운 그림을 읽을 여유는 없고, "어디서 잘못했는가"는 주행이 끝난 뒤
 * 디브리핑의 주행 지도(RunMap.ts)가 훨씬 자세히 보여 준다.
 */

import type { GameSnapshot } from '../game/Game';
import { isSignalWait } from '../game/stopReason';
import { playerCard, type PlayerInfo } from './playerCard';
import { withAiBadge } from './brandName';
import { pickedByHud } from './pickedBy';
import type { Picker } from '../scenarios/recommend';
import robotNormal from '../assets/airobot/normal.webp';
import robotStop from '../assets/airobot/stop.webp';
import robotTurn from '../assets/airobot/turnlight.webp';
import robotCaution from '../assets/airobot/yello.webp';

/**
 * AI 의 얼굴 — 원본은 `assets/airobot/`, 굽는 법은 scripts/build-airobot.mjs.
 *
 *  - `normal` — 평소. 웃는 얼굴, 신호등은 초록
 *  - `stop`    — 일시정지 · 보행자 확인. 얼굴에 느낌표, 신호등은 빨간 손바닥
 *  - `caution` — 가도 되지만 주의하며 서행. 신호등은 노랑 (일시정지와 주행의 중간)
 *  - `turn`   — 지금 우회전할 차례. 얼굴과 신호등에 우회전 화살표
 */
const ROBOT = { normal: robotNormal, stop: robotStop, caution: robotCaution, turn: robotTurn } as const;
type RobotMood = keyof typeof ROBOT;

/** 이보다 긴 제목은 글씨를 줄인다 (`.scenario.long`) */
const LONG_TITLE_CHARS = 26;
/** 판 이름 + 제목이 이보다 길면 한 단계 더 줄인다 (`.scenario.xlong`) */
const XLONG_TITLE_CHARS = 44;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** 판 이름·제목을 마크업에 끼워 넣으므로 이스케이프한다 (시나리오 제목은 데이터다) */
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * 주행 중 판단 표시.
 *
 * 말은 `download/우회전_운전방법_정리.md` 를 따른다 — 멈추라는 지시는 **일시정지**,
 * 가라는 지시는 **서행**이다. 예전에는 '정지'·'진행 가능'이었는데, 그러면 화면이
 * 쓰는 말과 도움말·결과 화면이 쓰는 말이 달라 같은 동작을 두 이름으로 배우게 된다.
 */
/**
 * 횡단보도를 사람의 말로 — 화면에는 A·C·S 같은 내부 이름을 쓰지 않는다.
 * 결과 화면의 위치 이름(lawRules.ts 의 placeLabel)과 같은 말을 쓴다.
 */
const CROSSWALK_NAME = {
  S: '보호구역 횡단보도',
  A: '앞 횡단보도',
  C: '우회전 후 횡단보도',
} as const;

const ADVICE_TEXT = {
  stop: '일시정지',
  yield: '보행자 통행 확인',
  go: '서행 진행',
} as const;

/**
 * **신호 칩** — 상공 시점에서만 띄운다.
 *
 * 상공에서는 신호등을 76m 위에서 내려다보게 되는데, 등화는 운전자 쪽(수평)을 향하고 있어
 * 위에서는 하우징 뒷면만 보인다. 신호를 읽을 수 없는 화면에서 신호 판단을 시키면
 * 이 게임이 가르치려는 것이 통째로 무너진다. 그 한 경우를 메우는 장치다.
 *
 * **후방 시점에서는 띄우지 않는다.** 한때 운전자 시점만 빼고 띄웠는데, 차 뒤에서 보는
 * 화면에는 정면 신호등이 그대로 보인다 — 읽을 수 있는데도 답을 적어 주면 신호를 보는
 * 연습이 되지 않는다. 운전자 시점과 같은 이유다.
 */
const LIGHT_TEXT = {
  red: '적색',
  yellow: '황색',
  green: '녹색',
  redFlash: '적색점멸',
} as const;

const ARROW_TEXT = {
  redArrow: '적색',
  yellowArrow: '황색',
  greenArrow: '녹색 ➜',
} as const;

/** 등화 색 → 칩에 찍는 색 (신호등 3D 와 같은 값) */
const DOT = { red: '#ff3b2f', yellow: '#ffc400', green: '#2ee06a' } as const;
const lightDot = (c: keyof typeof LIGHT_TEXT) => (c === 'green' ? DOT.green : c === 'yellow' ? DOT.yellow : DOT.red);
const arrowDot = (c: keyof typeof ARROW_TEXT) =>
  c === 'greenArrow' ? DOT.green : c === 'yellowArrow' ? DOT.yellow : DOT.red;

export class Hud {
  private root = $('hud');
  private scenarioTitle = $('hud-scenario');
  private stopDist = $('stopdist');
  private signalChip = $('signalchip');
  private advice = $('advice');
  private pedCueEl = $('ped-cue');
  private leadCueEl = $('lead-cue');
  /** 지금 떠 있는 보행자 알림 — 새로 뜰 때만 눈에 띄게 흔든다 */
  private lastCue = '';
  private coach = $('drive-coach');
  private robot = $<HTMLImageElement>('drive-coach-robot');
  /** 지금 걸려 있는 로봇 그림 — 같은 그림을 매 프레임 다시 걸지 않는다 */
  private mood: RobotMood | null = null;
  private fpsEl = $('fps');
  /** fps 를 화면에 띄울 것인가 (설정) */
  private showFps = false;
  private toastEl = $('toast');
  /** 내 레벨과 경험치 (setPlayer) */
  private player = $('hud-player');

  private toastTimer = 0;

  /**
   * 주행 화면을 켠다.
   *
   * 판 이름과 제목을 **따로 받는다.** 한 문자열로 받으면 `Stage01. 정면신호 녹색 …`
   * 전체가 한 덩어리라 색을 나눌 수 없다. 예전에는 그래서 제목까지 파랑이었는데,
   * 두 줄로 접히는 긴 제목이 통째로 색을 입으면 판 이름이 어디까지인지 알 수 없다.
   * 판 이름만 파랑으로 두고 제목은 본문색으로 읽는다.
   */
  /**
   * @param sep 판 이름과 제목 사이 — 라이브러리 판은 결과 화면과 같게 `AI 추천 시나리오 3700 - 제목` 으로 쓴다
   */
  show(stage: string, title: string, sep = ':', picked?: { picker?: Picker; model?: string }): void {
    this.root.classList.add('active');
    /*
      **첫 줄은 누가 이 맵을 골랐는지다** (ui/pickedBy.ts) — "Gemini gemini-3.1-flash-lite 모델이 운전자의
      운전 습관을 분석해서 추천해 준 맵이에요." AI 활용 공모전 작품이라 AI 가 한 일이 달리는 동안에도 보여야
      한다는 사용자 요청이다. 손으로 쓴 판과 시범 주행에는 고른 쪽이 없으므로 줄이 비고, 비면 CSS 가 감춘다.
    */
    $('hud-picked').innerHTML = pickedByHud(picked?.picker, picked?.model);
    const short = hudTitle(title);
    // 판 이름의 'AI' 도 이름표와 같은 배지로 (ui/brandName.ts) — 결과 화면과 같은 얼굴이어야 한다
    this.scenarioTitle.innerHTML =
      `<span class="stage">${withAiBadge(esc(stage))}</span><span class="sep">${esc(sep)}</span>${esc(short)}`;
    /*
      **긴 제목은 글씨를 줄여 한 줄에 담는다.** 라이브러리 판은 조건이 여럿이라
      "적색 - 보호구역 무신호 횡단보도 · 첫 횡단보도 보행자 · 야간" 처럼 길어, 원래 크기로는
      두 줄로 접혀 하늘과 전방 신호등을 가렸다.
    */
    // 판 이름("AI 추천 시나리오 2479")까지 합친 길이로 잰다 — 이름이 길어지며 제목만 재면 두 줄로 접혔다
    this.scenarioTitle.classList.toggle('long', stage.length + short.length > LONG_TITLE_CHARS);
    // 판 이름까지 합쳐 아주 길면(라이브러리 판 — "AI 추천 시나리오 3700 - …") 한 단계 더 줄인다
    this.scenarioTitle.classList.toggle('xlong', stage.length + short.length > XLONG_TITLE_CHARS);
  }

  /**
   * 주행 중 도움의 양 (challenge.ts 의 hints) — `less` 는 로봇이 할 일 한마디만, `none` 은 로봇을 감춘다.
   * 판정은 그대로다 — 도움만 걷는다.
   */
  setHints(level: 'full' | 'less' | 'none'): void {
    this.root.classList.toggle('hints-less', level === 'less');
    this.root.classList.toggle('hints-none', level === 'none');
  }

  /**
   * **내 레벨과 경험치** — 게임에서 흔한 플레이어 칸(레벨 배지 · 호칭 · 경험치 바)을 왼쪽 아래에 둔다.
   *
   * 사용자가 부탁했다 — "운전화면에서도 내 레벨과 경험치를 볼 수 있게." 첫 화면과 결과 화면에만 있으면 달리는 동안
   * 이 판이 무엇을 향해 가는지가 안 보인다. 자리는 조작 안내 바로 위다 — 위쪽 양 끝은 운전석 시점의 좌우 시야 창,
   * 가운데 위는 과제 상자와 AI, 오른쪽 아래는 계기판이 쓴다.
   *
   * AI 과정의 판에서만 띄운다 (`null` 이면 감춘다) — 시범 주행은 내 기록이 아니다.
   */
  setPlayer(p: PlayerInfo | null): void {
    const el = this.player;
    if (!p) {
      el.hidden = true;
      return;
    }
    // 첫 화면 · 결과 화면과 같은 칸이다 — 크기만 운전 화면용 (ui/playerCard.ts)
    el.innerHTML = playerCard(p, 'hud');
    el.hidden = false;
  }

  hide(): void {
    this.root.classList.remove('active');
  }

  /** fps 표시를 켜고 끈다 (설정에서 바꾸면 그 자리에서 반영된다) */
  setShowFps(on: boolean): void {
    this.showFps = on;
    this.fpsEl.classList.toggle('on', on);
    if (!on) this.fpsEl.textContent = '';
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  update(s: GameSnapshot): void {

    this.updateStopIndicators(s);

    // 진행 판단 보조
    if (this.showFps) {
      // 해상도를 낮춰 그리고 있으면 함께 적는다 — 흐려진 이유를 알 수 있게 (설정의 '렌더 해상도')
      this.fpsEl.textContent = `${s.fps} fps${s.renderScale < 1 ? ` · 해상도 ${Math.round(s.renderScale * 100)}%` : ''}`;
      // 30 아래면 색을 바꾼다 — 숫자를 읽지 않아도 느려졌다는 것이 보인다
      this.fpsEl.classList.toggle('slow', s.fps > 0 && s.fps < 30);
    }
    const mood = robotMood(s);
    // 주의 얼굴이면 테두리도 노랑 — 얼굴과 테두리가 다른 말을 하면 안 된다
    this.coach.className = `drive-coach show ${s.advice}${mood === 'caution' ? ' caution' : ''}`;
    /*
      **우회전 신호등이 적색 · 황색이면 그렇게 말한다.** 예전에는 정면 적색과 같은 "일시정지" 에
      "일시정지 완료 — 통행 종료 후 출발" 이 떠, 서고 나면 가도 되는 것처럼 읽혔다. 우회전 신호등은
      다른 신호에 앞서므로(시행규칙 [별표 2] 비고 제3호) 적색 화살표에는 **녹색 화살표가 켜질 때까지**
      서 있어야 한다 — 일시정지 후 진행이 아니다.
    */
    this.advice.textContent = arrowHold(s)
      ? '우회전 신호 대기'
      : zoneSignalHold(s)
        ? '보호구역 신호 대기'
        : ADVICE_TEXT[s.advice];
    this.setMood(mood);
    this.updatePedCue(s);
    this.updateLeadCue(s);

    // 신호 칩 — **상공 시점에서만** (위 LIGHT_TEXT 주석 참고)
    const showChip = s.view === 'top';
    this.signalChip.classList.toggle('show', showChip);
    if (showChip) {
      const dot = (color: string) => `<i class="sig-dot" style="background:${color}"></i>`;
      const parts = [
        `${dot(lightDot(s.phase.vehicle))}정면 ${LIGHT_TEXT[s.phase.vehicle]}`,
      ];
      if (s.rightArrow) {
        parts.push(`${dot(arrowDot(s.rightArrow))}우회전 ${ARROW_TEXT[s.rightArrow]}`);
      }
      this.signalChip.innerHTML = parts.join('<span class="sig-sep"></span>');
    }
  }

  /**
   * **보행자가 건너려는 것 같다** 는 한 줄 (GameSnapshot.pedCue).
   *
   * 새로 뜬 순간에만 한 번 흔든다 — 계속 흔들면 눈이 거기에 붙어 정작 사람을 안 본다.
   */
  private updatePedCue(s: GameSnapshot): void {
    const cue = s.pedCue;
    /*
      **건너편 사람이면 그렇게 말한다.** 멀어서 작게 보이는 사람은 "아직 멀다" 로 읽혀 흘려
      보기 쉬운데, 그 사람이 건너오면 결국 내 앞길을 지난다.
    */
    const where = cue ? CROSSWALK_NAME[cue.crosswalk] : '';
    const text = !cue
      ? ''
      : cue.kind === 'intending'
        ? cue.far
          ? `${where} 건너편에 보행자가 건너려는 것 같아요`
          : `${where}에 보행자가 건너려는 것 같아요`
        : cue.far
          ? `${where}를 건너편 보행자가 건너오는 중이에요`
          : `${where}를 보행자가 건너는 중이에요`;
    if (text === this.lastCue) return;
    this.lastCue = text;
    this.pedCueEl.textContent = text;
    this.pedCueEl.classList.toggle('show', Boolean(text));
    this.pedCueEl.classList.toggle('crossing', cue?.kind === 'crossing');
    if (text) {
      // 애니메이션을 처음부터 다시 돌린다 (클래스를 떼었다 붙인다)
      this.pedCueEl.classList.remove('pulse');
      void this.pedCueEl.offsetWidth;
      this.pedCueEl.classList.add('pulse');
    }
  }

  /**
   * **앞차가 서지 않았다** 는 한 줄 (GameSnapshot.leadCue) — 일시정지를 건너뛰는 앞차가 나쁜
   * 본보기라는 것을 그 자리에서 짚는다. 없으면 앞차가 고장 난 것처럼 보인다.
   */
  private updateLeadCue(s: GameSnapshot): void {
    const text =
      s.leadCue === 'A'
        ? '앞차가 적색에 서지 않고 우회전했어요 — 따라가지 말고 정지선에서 멈춰요'
        : s.leadCue === 'S'
          ? '앞차가 보호구역 횡단보도에서 서지 않았어요 — 따라가지 말고 멈춰요'
          : '';
    if (this.leadCueEl.textContent === text) return;
    this.leadCueEl.textContent = text;
    this.leadCueEl.classList.toggle('show', Boolean(text));
    if (text) {
      this.leadCueEl.classList.remove('pulse');
      void this.leadCueEl.offsetWidth;
      this.leadCueEl.classList.add('pulse');
    }
  }

  /** 로봇 그림을 바꾼다. 바뀔 때만 건드린다 — 매 프레임 src 를 다시 걸면 깜빡일 수 있다 */
  private setMood(mood: RobotMood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.robot.src = ROBOT[mood];
  }

  /**
   * 일시정지 관련 표시.
   * 이 게임의 채점 기준이므로 "멈춰야 하는지 / 얼마나 남았는지 / 인정됐는지"를
   * 한눈에 알 수 있어야 한다.
   */
  private updateStopIndicators(s: GameSnapshot): void {
    const arrow = arrowLine(s);
    if (arrow) {
      this.stopDist.classList.add('show');
      this.stopDist.classList.toggle('done', arrow.ok);
      this.stopDist.textContent = arrow.text;
      return;
    }
    const done = s.stop.satisfied;
    // 정지 지점까지 남은 거리
    const label =
      s.stop.target === 'line' ? '정지선' : s.stop.target === 'zone' ? '보호구역 정지선' : '횡단보도';
    const show = (s.stop.required || done) && s.stop.distance > -2;
    this.stopDist.classList.toggle('show', show);
    this.stopDist.classList.toggle('done', done);
    if (show) {
      /*
        **신호를 기다리는 자리에서는 '완료' 가 없다** (위 zoneSignalHold). 적색 앞에서 멈춘 것은
        의무를 마친 것이 아니라 이제부터 기다리는 것이라, '일시정지 완료' 라고 적으면 곧 출발해도
        되는 줄로 읽힌다.
      */
      const waiting = zoneSignalHold(s);
      this.stopDist.textContent = waiting
        ? s.stop.distance <= 0.4
          ? '녹색이 될 때까지 대기'
          : `보호구역 정지선까지 ${s.stop.distance.toFixed(0)}m`
        : done
          ? `일시정지 완료 — 통행 종료 후 출발`
          : s.stop.distance <= 0.4
            ? `${label} 앞 — 완전히 멈추세요`
            : `${label}까지 ${s.stop.distance.toFixed(0)}m`;
    }
  }

}

/**
 * **우회전 신호등 앞에서 서 있어야 하는가** — 적색 · 황색 화살표이고, 아직 정지선 쪽에 있다.
 * 진행 판단(Game.advise)도 이때 '정지' 다.
 */
function arrowHold(s: GameSnapshot): boolean {
  return s.rightArrow !== null && s.rightArrow !== 'greenArrow' && s.advice === 'stop' && s.stop.target === 'line';
}

/** 진입로 보호구역 횡단보도에서 **신호를 기다리는가** — 계기판과 같은 함수를 본다 (game/stopReason.ts) */
const zoneSignalHold = (s: GameSnapshot): boolean =>
  isSignalWait({ target: s.stop.target, advice: s.advice, zoneLight: s.zoneLight });

/**
 * 우회전 신호등이 있는 교차로에서 말풍선 둘째 줄에 쓸 말. 해당이 없으면 null.
 *
 *  - 적색 · 황색 화살표 — 정지선까지 거리, 서 있으면 "녹색 화살표가 켜질 때까지 대기"
 *  - 녹색 화살표 (정지선에 닿기 전) — "녹색 화살표 — 보행자 확인 후 서행 우회전"
 */
function arrowLine(s: GameSnapshot): { text: string; ok: boolean } | null {
  if (s.rightArrow === null || s.stop.target !== 'line' || s.stop.distance < -2) return null;
  if (arrowHold(s)) {
    const color = s.rightArrow === 'yellowArrow' ? '황색' : '적색';
    if (s.stop.distance > 0.4 && s.speedKmh > 0.5) {
      return { text: `우회전 신호등 ${color} — 정지선까지 ${s.stop.distance.toFixed(0)}m`, ok: false };
    }
    return { text: `우회전 신호등 ${color} — 녹색 화살표가 켜질 때까지 대기`, ok: false };
  }
  if (s.rightArrow === 'greenArrow' && s.stop.distance > 0) {
    return { text: '녹색 화살표 — 보행자 확인 후 서행 우회전', ok: true };
  }
  return null;
}

/**
 * 지금 로봇이 **어떤 얼굴**이어야 하는가.
 *
 *  - 서라는 판단(일시정지)이면 `stop`
 *  - **살피며 가야 하는** 때면 `caution` — 보행자 통행 확인(일시정지는 마쳤다), 보행자가 건너려 하거나 건너는 중,
 *    또는 앞차가 일시정지를 건너뛰고 지나갔다. 서라는 말은 아니므로 `stop` 얼굴은 과하다
 *  - 가라는 판단인데 **지금이 우회전하는 순간**이면 `turn` — 정지선에서 일시정지를 마쳤거나,
 *    이미 교차로에 들어서 진출 횡단보도를 향해 도는 중이다
 *  - 그 밖(아직 교차로로 달려가는 중 · 우회전을 다 마친 뒤)은 `normal`
 *
 * 우회전 얼굴을 **아무 때나 띄우지 않는다.** 교차로에서 한참 먼 직선에서 화살표를 보여
 * 주면 "지금 돌아라" 로 읽힌다 — 이 게임은 바로 그 성급함을 고치려는 게임이다.
 */
function robotMood(s: GameSnapshot): RobotMood {
  if (s.advice === 'stop') return 'stop';
  // 보행자 통행 확인 — 일시정지는 이미 마쳤고, 이제 살피며 출발할 차례다
  if (s.advice === 'yield') return 'caution';
  // 보행자가 건너려 하거나 건너는 중이면, 아직 가도 되는 자리라도 주의하며 가는 얼굴이다
  if (s.pedCue) return 'caution';
  // 앞차가 서지 않고 지나갔으면 — 따라가지 말고 살피라는 얼굴이다
  if (s.leadCue) return 'caution';
  const turning =
    (s.stop.target === 'crosswalk' && s.stop.distance >= 0) ||
    (s.stop.target === 'line' && s.stop.satisfied);
  return turning ? 'turn' : 'normal';
}

/**
 * 주행 중 상단에 쓰는 **짧은 제목** — 앞의 "정면신호 " 를 뗀다.
 *
 * 판 제목은 `정면신호 적색 - 우회전 후 보행자` 꼴이라 목록과 결과 화면에서는 그대로가 맞다
 * (무엇이 다른지가 제목만으로 드러나야 한다). 주행 중에는 한 줄에 들어오는 편이 낫고,
 * 신호등은 화면에 이미 보이므로 "적색 - 우회전 후 보행자" 로 충분하다.
 */
export const hudTitle = (title: string): string => title.replace(/^정면\s*신호\s+/, '');
