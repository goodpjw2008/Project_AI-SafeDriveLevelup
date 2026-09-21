/**
 * 사운드 에셋 — 파일과 그 출처.
 *
 * **`src/assets/` 아래에 둔 것이 중요하다.** vite.config.ts 가 그 폴더의 파일을 크기와
 * 상관없이 번들 안에 데이터로 심으므로, 단일 파일 빌드(`build:standalone`)에서도 소리가
 * 그대로 난다 — HDRI 환경광이 그 빌드에서 빠지는 것과 반대다.
 *
 * 그래서 이 파일이 내보내는 것은 **경로가 아니라 데이터 URL** 이다. `fetch` 로 읽어
 * `decodeAudioData` 에 넘기면 되고, 네트워크도 로딩 실패도 없다.
 *
 * ## 왜 후보를 여럿 두는가
 *
 * **어떤 소리가 좋은지는 들어 봐야 안다.** 스펙트럼으로 알 수 있는 것은 성격뿐이고
 * (저역이 많으면 묵직하고 중역이 많으면 얇다), 그것이 이 게임에 어울리는지는 다른
 * 문제다. 그래서 고르지 않고 설정 화면에 내놓는다.
 *
 * 셋을 **따로** 고르게 한다 — 서로 성격이 다른 소리라, 한 벌로 묶어 두면
 * "엔진은 3번이 좋은데 경적은 2번" 을 만들 수 없다.
 *
 * 방향지시등도 마찬가지다 — 한때 합성 아홉 벌과 다른 CC0 녹음 다섯 벌을 시도했다가
 * 전부 걷어냈고, 지금 있는 것은 그 뒤에 새로 구한 음원에서 뽑은 것이다.
 *
 * 각 항목의 `character` 는 감으로 붙인 말이 아니라 잰 값이다. 원본을 어떻게 가공했는지는
 * scripts/build-sounds.mjs 에 있다 (`npm run sounds`).
 */

import blinker1Off from '../assets/sounds/blinker-1-off.mp3';
import blinker1On from '../assets/sounds/blinker-1-on.mp3';
import driveStopUrl from '../assets/sounds/drive-stop.mp3';
import driveSlowUrl from '../assets/sounds/drive-slow.mp3';
import driveCruiseUrl from '../assets/sounds/drive-cruise.mp3';
import engineStartUrl from '../assets/sounds/engine-start.mp3';
import hornSingleUrl from '../assets/sounds/horn-single.mp3';
import hornTripleUrl from '../assets/sounds/horn-triple.mp3';

/** 게임이 쓰는 소리의 이름 — Audio.ts 가 이 키로만 주고받는다 */
export type SoundId =
  | 'driveStop'
  | 'driveSlow'
  | 'driveCruise'
  | 'engineStart'
  | 'horn'
  | 'blinkerOn'
  | 'blinkerOff';

/** 고를 수 있는 소리 하나 — 화면이 이 셋만 보고 카드를 그린다 */
export interface SoundChoice {
  id: string;
  /** 설정 화면에 뜨는 이름 */
  name: string;
  /** 어떤 소리인지 — 재서 붙인 성격 */
  character: string;
}

/**
 * 엔진음은 **세 벌이 한 짝**이다 — 이 게임에 있는 속도가 셋뿐이기 때문이다.
 *
 * 하나를 재생 속도로 밀어 올려 나머지를 만들지 않는다. 그렇게 만든 소리는 실내에서
 * 실제로 일어나는 일(타이어·바람이 커지는 것)이 아니라 테이프를 빨리 감는 것이 된다.
 * 상태마다 **그 상태를 실제로 녹음한 것**을 쓴다 (Audio.ts 의 updateDriveStates 참고).
 */
export interface EngineChoice extends SoundChoice {
  /** 정지 — 공회전. 서 있을 때 */
  stop: string;
  /** 출발 — 정지에서 떠나 서행하는 동안 */
  slow: string;
  /** 순항 — 25~40km/h */
  cruise: string;
}
export interface HornChoice extends SoundChoice {
  url: string;
}
export interface BlinkerChoice extends SoundChoice {
  /** 켤 때 · 끌 때 — 실제 릴레이가 두 소리다 */
  on: string;
  off: string;
}
/**
 * 엔진음.
 *
 * 실내 주행 녹음 한 벌이다 — 이 게임은 운전석 시점이라 밖에서 딴 소리는 자리가 맞지
 * 않는다. 목록으로 두는 것은 나중에 후보가 늘면 그대로 고를 수 있게 하기 위해서다
 * (하나뿐이면 설정에 뜨지 않는다).
 *
 * 성격에 적은 값은 잰 것이다 — 세 상태의 크기가 -30.3 / -22.8 / -13.4dB 로 벌어진다.
 * 이 게임의 속도감은 거기서 나온다 (scripts/build-sounds.mjs 참고).
 */
export const ENGINE_SOUNDS: EngineChoice[] = [
  {
    id: 'e1',
    name: '실내 주행음',
    character: '정지 · 출발 · 순항 세 벌 (+7.5 / +9.4dB) — 운전석에서 듣는 소리',
    stop: driveStopUrl,
    slow: driveSlowUrl,
    cruise: driveCruiseUrl,
  },
];

/**
 * 크락션 — **한 녹음에서 나온 두 벌이다.**
 *
 * 원본(알파로메오 MiTo)에는 경적이 네 번 들어 있는데, 앞의 하나는 단발이고 뒤의 셋은
 * 0.1초 간격으로 붙은 연타다. 게임에서 뒷차가 재촉하는 방식이 그 둘이라 갈라 두었다.
 *
 * **둘은 같은 소리다** — 402 + 502Hz 듀얼톤(장3도)에 배음 801 · 1000 · 1500Hz.
 * 갈리는 것은 성격이 아니라 **몇 번 울리느냐**이고, 그것이 곧 압박의 세기다.
 * 어느 쪽이 이 게임에 맞는지는 들어 봐야 아는 것이라 설정 화면에 내놓는다.
 */
export const HORN_SOUNDS: HornChoice[] = [
  { id: 'h1', name: '단발', character: '한 번 — 듀얼톤 402+502Hz, 0.48초', url: hornSingleUrl },
  { id: 'h2', name: '연타', character: '빵빵빵 — 같은 소리로 세 번, 0.68초', url: hornTripleUrl },
];

/**
 * 방향지시등.
 *
 * 한때 세 벌을 구워 놓고 골랐지만 지금은 **하나**다 — 들어 보고 가장 둔탁한 것을 골랐다.
 * 이 소리는 한 판에 서른 번쯤 나므로, 또렷한 쪽은 몇 초 만에 기계음으로 들린다.
 *
 * 원본은 The_Cri 의 'BMW Indicator' — 깜빡이가 47초 동안 도는 파일이라 클릭이 113개
 * 들어 있고, 그중 짝수 번째가 켤 때 홀수 번째가 끌 때다.
 *
 * 성격은 켤 때 / 끌 때 클릭의 스펙트럼 무게중심 — 높을수록 날카롭고 낮을수록 둔탁하다.
 */
export const BLINKER_SOUNDS: BlinkerChoice[] = [
  { id: 'b1', name: '사운드 1', character: '둔탁 — 443 / 134Hz', on: blinker1On, off: blinker1Off },
];

/**
 * 처음 켰을 때의 조합.
 *
 * **직접 듣고 고른 값**이다. 지금은 항목마다 후보가 하나뿐이라 고를 것이 없지만,
 * 예전에 저장해 둔 선택(예: 깜빡이 `b3`)이 남아 있을 수 있으므로 `pick` 이 여기로
 * 떨어뜨린다 — 없는 소리를 가리키는 설정 때문에 아무 소리도 안 나면 안 된다.
 */
export const DEFAULT_SOUNDS = { engine: 'e1', horn: 'h1', blinker: 'b1' } as const;

const pick = <T extends SoundChoice>(list: T[], id: string, fallback: string): T =>
  list.find((s) => s.id === id) ?? list.find((s) => s.id === fallback)!;

export const engineById = (id: string): EngineChoice =>
  pick(ENGINE_SOUNDS, id, DEFAULT_SOUNDS.engine);
export const hornById = (id: string): HornChoice => pick(HORN_SOUNDS, id, DEFAULT_SOUNDS.horn);
export const blinkerById = (id: string): BlinkerChoice =>
  pick(BLINKER_SOUNDS, id, DEFAULT_SOUNDS.blinker);

/** 고른 셋으로 한 벌을 만든다 */
export interface SoundSelection {
  engine: string;
  horn: string;
  blinker: string;
}

/** 받아야 할 파일 목록 */
export const soundUrls = (sel: SoundSelection): Record<SoundId, string> => {
  const b = blinkerById(sel.blinker);
  const e = engineById(sel.engine);
  return {
    driveStop: e.stop,
    driveSlow: e.slow,
    driveCruise: e.cruise,
    /*
      시동음은 **고르지 않는다.** 판을 시작할 때 한 번 나고 끝나는 소리라 성격을 비교할
      일이 없고, 엔진 루프와 달리 계속 듣게 되지도 않는다.
    */
    engineStart: engineStartUrl,
    horn: hornById(sel.horn).url,
    blinkerOn: b.on,
    blinkerOff: b.off,
  };
};

/**
 * 음원 출처 — 크레딧 화면이 이 목록을 그대로 그린다.
 *
 * 전부 CC0(퍼블릭 도메인)이라 표기 **의무**는 없다. 그래도 적는 이유는, 이 프로젝트가
 * 차량 모델·소프트웨어를 이미 전부 표기하고 있기 때문이다 — 소리만 빼면
 * "표기한 것이 전부" 라는 크레딧 화면의 말이 거짓이 된다.
 *
 * **받는 곳은 Freesound 하나다.** 한때 크락션만 BigSoundBank 였는데, 출처가 둘이면
 * 크레딧도 두 벌이고 원본 폴더도 두 개다. 소리가 여덟 개뿐인 프로젝트에서 그럴 이유가
 * 없어 크락션도 Freesound 것으로 갈았다 (겸사겸사 단일톤 → 듀얼톤이 되었다).
 */
export interface SoundCredit {
  /** 게임에서 어디에 쓰이는가 */
  use: string;
  title: string;
  sourceUrl: string;
  /** 원저작자 — 배포자가 아니라 녹음한 사람 */
  author: string;
  license: string;
  licenseUrl: string;
}

const CC0 = {
  license: 'CC0 1.0 (퍼블릭 도메인)',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
} as const;

export const SOUND_CREDITS: SoundCredit[] = [
  /*
    엔진음과 시동음이 **다른 차**다. 시동 녹음이 붙어 있는 음원과 회전수·노면음이
    쓸 만한 음원이 같지 않았다 — 848361 은 이미 걸린 채로 시작해 시동 구간이 없다.
    시동음 뒤가 재워지고 그 자리에 조용한 공회전이 올라오므로 이어 붙는 자리에서
    차가 바뀌는 것은 들리지 않는다.
  */
  {
    use: '주행음 (정지 · 출발 · 순항)',
    title: 'Car Internal - Idle to Fast (닛산 캐시카이 · 실내 녹음)',
    sourceUrl: 'https://freesound.org/people/andrewfordham/sounds/848361/',
    author: 'andrewfordham (Freesound)',
    ...CC0,
  },
  {
    use: '시동음',
    title: 'Car drive (아우디 · 실내 녹음)',
    sourceUrl: 'https://freesound.org/people/NachtmahrTV/sounds/553185/',
    author: 'NachtmahrTV (Freesound)',
    ...CC0,
  },
  {
    use: '크락션 (단발 · 연타)',
    title: 'Alfa Romeo MiTo honking car horn',
    sourceUrl: 'https://freesound.org/people/boedie/sounds/457425/',
    author: 'boedie (Freesound)',
    ...CC0,
  },
  {
    use: '방향지시등',
    title: 'BMW Indicator',
    sourceUrl: 'https://freesound.org/people/The_Cri/sounds/545322/',
    author: 'The_Cri (Freesound)',
    ...CC0,
  },
];
