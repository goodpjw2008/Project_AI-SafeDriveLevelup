/**
 * 사운드. **녹음본과 합성을 섞어 쓴다.**
 *
 * 예전에는 전부 WebAudio 합성이었다. 라이선스 걱정이 없고 차종별 엔진음을 파라미터로
 * 바꿀 수 있어서였는데, 톱니파 오실레이터는 아무리 다듬어도 **엔진이 아니라 부저**로
 * 들렸다. 그래서 CC0 녹음본을 넣었다 (soundAssets.ts · scripts/build-sounds.mjs).
 *
 * ## 방향지시등은 한 번 통째로 걷어냈다가 되살렸다
 *
 * 처음 넣은 CC0 실차 녹음 다섯 벌은 **그 차의 실내 울림**을 함께 담고 있어 이 게임의
 * 음향 공간과 겉돌았고, 그 뒤 만든 합성 아홉 벌(톤 셋 · 공명 여섯)도 기계음을 벗어나지
 * 못했다. 이 소리는 한 판에 서른 번쯤 나므로, 어설픈 딸깍이 반복되는 것보다 없는 편이
 * 낫다고 보고 전부 지웠다.
 *
 * 지금 있는 것은 그 뒤에 새로 구한 음원에서 뽑은 것이다 — 깜빡이가 47초 동안 도는
 * 녹음이라 클릭이 113개 들어 있고, 그중 **둘 다 세고 서로 균형이 맞는 쌍**을 골랐다.
 *
 * ## 무엇이 어느 쪽인가
 *
 *  - **엔진음 · 크락션 · 방향지시등** — 녹음본. 못 읽으면 합성으로 떨어진다
 *  - **충돌음 · 결과 알림음** — 합성. 짧고 추상적이라 녹음본을 쓸 이유가 없다
 *
 * 부르는 쪽(Game.ts)은 이 구분을 모른다.
 *
 * 브라우저 정책상 사용자 제스처 이전에는 소리를 낼 수 없으므로 `resume()`을 클릭 시 호출한다.
 */

import { DEFAULT_SOUNDS, soundUrls, type SoundId, type SoundSelection } from './soundAssets';
import { CRUISE_KMH, SLOW_KMH } from './Vehicle';
import type { CarSpec } from '../economy/cars';

/** 엔진음 회전수 매핑의 기준 속도 (km/h). 주행 속도가 고정이므로 상수로 둔다. */
const REFERENCE_TOP_KMH = 50;

/*
  공회전 루프의 음높이 폭.

  **잰 값이다.** 원본에서 기본파를 재면 공회전 28.3Hz(약 850rpm), 순항 33Hz(약 990rpm) —
  1.17배뿐이다. 캐시카이는 CVT 라 속도가 붙어도 회전수를 붙들어 둔다.

  예전에는 0.78~1.52(거의 한 옥타브)를 썼는데, 그것은 이 녹음에 **없는 변화를 지어내는**
  것이었다. 테이프를 빨리 감는 소리로 들린 이유다. 속도감은 노면음이 만든다.
*/
/**
 * ## 이 게임에 있는 속도는 셋뿐이다
 *
 * 정지(0) · 서행(12) · 주행(25~40). 시나리오가 어떻게 흘러도 이 셋을 오갈 뿐이다 —
 * 주행으로 들어와 정지선에 서고, 서행으로 교차로를 돌고, 다시 서고, 횡단보도를
 * 빠져나오며 주행으로 돌아간다 (Vehicle.ts 의 SLOW_KMH · APPROACH_KMH · CRUISE_KMH).
 *
 * 그래서 매끄러운 곡선(`속도^0.6`)으로 만들지 않고 **그 셋에 값을 직접 박는다.**
 * 곡선은 어디에도 없는 중간 속도까지 그럴듯하게 만드느라 정작 실제로 나는 세 소리의
 * 간격을 우리가 정하지 못하게 한다. 표로 두면 "서행일 때 이만큼" 을 그냥 고칠 수 있다.
 *
 * 사이는 직선으로 잇는다 — 가·감속 중에는 그 사이를 지나가므로 값이 튀면 안 된다.
 *
 * ## 값은 어디서 왔는가
 *
 * 원본에서 잰 구간별 크기(80Hz 위 합계)는 공회전 20.2 · 느림 34.5 · 빠름 42.2dB 다.
 * **느림 → 빠름의 +7.7dB 를 노면음 게인비로 그대로 옮겼다** (0.14 → 0.33 은 +7.4dB).
 *
 * 공회전 → 느림의 +14.3dB 는 옮기지 않는다. 공회전 쪽 에너지가 30Hz 언저리에 몰려 있어
 * (행사장 노트북이 못 내는 대역) 물리대로 맞추면 서 있을 때 아무 소리도 안 나는 것처럼
 * 들린다. 대신 노면음이 **0 에서** 올라오는 것이 그 자리를 대신한다.
 */
interface DriveState {
  id: SoundId;
  /** 이 녹음이 담고 있는 속도 (km/h) */
  kmh: number;
  /** 그 속도에서의 크기 */
  gain: number;
  /**
   * 차종별 음높이를 얼마나 반영할지 (0~1).
   *
   * **정지에서만 온전히 준다.** 서 있을 때 들리는 것은 엔진뿐이라 음높이가 곧 그 차의
   * 목소리다. 반면 순항에서 들리는 것의 대부분은 타이어와 바람인데, 그것까지 40%
   * 밀어 올리면(아반떼 engineNote 140) 차가 바뀌는 게 아니라 테이프가 빨라진다.
   */
  voice: number;
}

/**
 * 세 상태 — 이 게임에 있는 속도가 셋뿐이라 녹음도 셋이다.
 *
 * 정지선에 서고, 서행으로 교차로를 돌고, 다시 서고, 횡단보도를 빠져나오며 순항으로
 * 돌아간다. 그 사이의 속도는 지나갈 뿐 머물지 않는다.
 *
 * ## 크기는 원본에서 잰 것이다
 *
 * 세 녹음의 실제 크기는 -30.3 / -22.8 / -13.4dB, 즉 **+7.5 / +9.4dB** 벌어져 있다.
 * 구운 파일은 셋 다 같은 라우드니스로 맞춰져 나오므로(build-sounds.mjs) 그 관계를
 * 여기서 되살렸다 — 다만 **출발점이지 최종 권위는 아니다.** 지금 값은 듣고 맞춘 것이고,
 * 잰 값에서 이만큼 벌어져 있다:
 *
 *     지금   정지 → 출발 +11.3dB · 출발 → 순항 +6.5dB
 *     원본   정지 → 출발  +7.5dB · 출발 → 순항 +9.4dB
 *
 * **출발 쪽이 잰 것보다 크다.** 그래도 되는 이유는, 원본의 '출발' 구간이 이 게임의
 * 12km/h 를 녹음한 것이 아니기 때문이다 — 정지에서 떠나 붙어 가는 구간이라 끝에서는
 * 이미 그보다 빠르다. 어느 크기가 12km/h 로 교차로를 도는 화면에 맞는지는 잰 값이
 * 답해 주지 않는다. 그건 듣고 정할 일이다.
 *
 * **정지는 물리값(0.047)보다 높은 0.06 이다.** 정지 상태 에너지가 대부분 30Hz 언저리에
 * 몰려 있어 — 행사장 노트북 스피커가 못 내는 대역이다 — 물리대로 두면 시동이 꺼진 것처럼
 * 들린다. 그러면 출발 키를 눌러야 하는지 헷갈린다.
 *
 * 순항의 실효 피크는 0.318 이다 (파일 피크 0.676 × 0.47). 경적(0.295)과 겹쳐도
 * 마스터(0.5)를 지나면 0.31 이라 넘치지 않는다.
 */
const DRIVE_STATES: readonly DriveState[] = [
  { id: 'driveStop', kmh: 0, gain: 0.06, voice: 1 },
  { id: 'driveSlow', kmh: SLOW_KMH, gain: 0.223, voice: 0.6 },
  { id: 'driveCruise', kmh: CRUISE_KMH, gain: 0.47, voice: 0.3 },
];

/**
 * 속도가 두 상태 사이에 있을 때 어느 쪽을 얼마나 섞을지.
 *
 * **제곱근으로 섞는다(등출력).** 세 녹음은 서로 무관한 소리라, 진폭을 직선으로 섞으면
 * 중간에서 총 출력이 3dB 꺼진다 — 가속하다 말고 소리가 한 번 움푹 들어간다.
 * 제곱근을 쓰면 두 몫의 **제곱 합**이 1 이라 그 구덩이가 생기지 않고, 크기는 상태 사이를
 * 자연스럽게 건너간다.
 *
 * 이웃한 둘만 0 이 아니다 — 정지와 순항이 동시에 나는 일은 없다.
 */
const stateMix = (kmh: number): number[] => {
  const w = DRIVE_STATES.map(() => 0);
  const last = DRIVE_STATES.length - 1;
  if (kmh <= DRIVE_STATES[0].kmh) {
    w[0] = 1;
    return w;
  }
  for (let i = 1; i <= last; i++) {
    if (kmh > DRIVE_STATES[i].kmh) continue;
    const t =
      (kmh - DRIVE_STATES[i - 1].kmh) / (DRIVE_STATES[i].kmh - DRIVE_STATES[i - 1].kmh);
    w[i - 1] = Math.sqrt(1 - t);
    w[i] = Math.sqrt(t);
    return w;
  }
  w[last] = 1; // 기준 속도보다 빠르면 순항으로 물린다
  return w;
};

/**
 * 소리 크기의 서열.
 *
 * **딸깍은 RMS 가 아니라 피크로 들린다.** 이 값들을 처음 잡을 때 평균 크기로 따졌더니
 * 깜빡이가 계속 컸다 — 순간음은 짧아서 RMS 가 낮게 나오는데, 귀는 그 뾰족한 끝을 듣는다.
 *
 * 게다가 파일마다 정규화 방식이 달라 **같은 게인이 같은 크기를 뜻하지 않는다.**
 * 깜빡이는 파형을 살리려고 피크 정규화를 했고(피크 0.79) 나머지는 loudnorm 이라
 * 피크가 제각각이다 (경적 0.54 · 시동 0.56 · 주행음 0.68). 그래서 게인만 보고
 * 비교하면 틀린다 — 음원을 갈면 게인을 그대로 두어도 나는 크기가 달라진다.
 *
 * 아래 주석의 값은 **게인을 곱한 뒤 실제로 나는 피크**다. 이 서열이 실제 서열이다.
 *
 *     순항 0.318 > 경적 0.295 > 시동 0.195 > 출발 0.151 > 깜빡이 0.044 ≥ 정지 0.041
 *
 * 주행음은 이 표에 없다 (DRIVE_STATES). 상태에 따라 0.041 에서 0.318 까지 움직이므로
 * 한 값으로 적을 수 없다.
 */
const GAIN = {
  /**
   * 실효 피크 0.044 — 서 있을 때의 주행음(0.041)과 나란하다.
   *
   * 한 판에 서른 번쯤 나는 소리라 **켠 줄만 알면 된다.** 0.5(피크 0.42) → 0.2(0.16)
   * → 0.09(0.072) → 0.075(0.061) → 0.055 로 네 번 낮췄다. 두 번째까지 덜 줄어든 것처럼
   * 들린 이유는 위 주석에 있다 — 딸깍은 평균이 아니라 피크로 들린다.
   */
  blinker: 0.055,
  /**
   * 실효 피크 0.19 — 판 시작에 한 번.
   *
   * 0.5(피크 0.28) 에서 한 단계 낮췄다. 크랭킹이 시작하자마자 터져 나오는데,
   * 이 소리가 나는 동안 이미 엔진 루프가 올라와 있어(Game.start → 첫 프레임)
   * 둘이 겹친 채로 들린다 — 그 자리에서는 0.28 이 과했다.
   *
   * 경적(0.17)보다는 여전히 위에 둔다. 시동은 판이 시작됐다는 신호라
   * 놀랄 필요는 없어도 묻히면 안 된다.
   */
  engineStart: 0.35,
  /**
   * 실효 피크 0.295 — 뒷차의 압박. 이 게임에서 놀라야 하는 소리다.
   *
   * **게인은 그대로인데 실제로 나는 크기가 커졌다.** 음원을 BigSoundBank 단일톤에서
   * 알파로메오 듀얼톤으로 갈면서 파일 피크가 0.30 → 0.537 로 올라, 같은 0.55 가
   * 0.17 이 아니라 0.295 를 낸다. 순항 노면음(0.318)과 나란한 크기다 — 뒷차가 울리는
   * 경적이 달리는 소리에 묻히지 않으려면 이 언저리가 맞다고 보고 그대로 둔다.
   * 예전 크기로 되돌리려면 0.32 로 낮추면 된다.
   */
  horn: 0.55,
} as const;

/**
 * 저역통과 필터는 **쓰지 않는다.**
 *
 * 예전에는 속도에 따라 170 → 1000Hz 로 열었다. "부하가 걸리면 배음이 늘어 밝아진다" 는
 * 생각이었는데, 이 녹음을 재 보니 실내에서는 **거꾸로**였다 — 스펙트럼 무게중심이
 * 공회전 471Hz 에서 순항 429Hz 로 오히려 **내려간다.** 속도가 붙으면 저역의 노면음이
 * 커지기 때문이다.
 *
 * 느린 순항과 빠른 순항의 대역별 차이도 8.0 / 7.7 / 7.2 / 7.8dB 로 **모양이 같고 크기만
 * 다르다.** 음색을 손댈 근거가 재료에 없으므로 손대지 않는다.
 */

/**
 * 미리듣기에서 딸깍 사이의 간격 (ms) — 주행 중 한 주기의 절반이다.
 *
 * **Game.ts 의 BLINK_PERIOD 와 같은 값이어야 한다.** 여기서 다시 정의하는 이유는
 * Audio 가 Game 을 가져오면 서로를 참조하게 되기 때문이다 (Game 이 Audio 를 쓴다).
 * 값이 어긋나면 미리듣기와 주행의 속도가 달라지므로 tests/audioBlink.test.ts 가 맞춘다.
 */
const BLINK_HALF_MS = 320;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  /**
   * 녹음본. 비어 있으면 합성으로 돈다.
   *
   * 디코딩이 끝나기 전에도 게임은 시작되므로, 처음 몇 초는 합성음이 나다가 조용히
   * 녹음본으로 바뀔 수 있다. 소리가 끊기는 것보다 낫고, 실제로는 40KB 라 눈치채기 어렵다.
   */
  private samples = new Map<SoundId, AudioBuffer>();

  /**
   * 상태 세 벌이 **동시에 돈다.** 들리는 것은 속도에 맞는 하나(또는 이웃한 둘)뿐이고,
   * 나머지는 게인 0 으로 돌아간다.
   *
   * 필요할 때만 켜지 않는 이유는, `AudioBufferSourceNode` 는 한 번 `stop()` 하면 다시
   * 쓸 수 없어서 상태가 바뀔 때마다 새로 만들어야 하고, 그러면 **루프의 위상이 매번
   * 처음으로 돌아가기** 때문이다. 같은 자리에서 다시 시작하는 잡음은 그 순간이 들린다.
   * 계속 돌려 두면 서로 다른 자리를 지나고 있어 건너가는 것이 매끄럽다.
   */
  private driveSrc: AudioBufferSourceNode[] = [];
  private driveGain: GainNode[] = [];

  private spec: CarSpec | null = null;
  private muted = false;

  /** 고른 소리 셋 (soundAssets.ts) — 엔진음·크락션·깜빡이를 따로 고른다 */
  private sel: SoundSelection = { ...DEFAULT_SOUNDS };

  get enabled(): boolean {
    return this.ctx !== null && !this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  /** 사용자 제스처 안에서 호출해야 한다 */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.buildEngine();
      // 기다리지 않는다 — 다 받을 때까지 게임을 붙잡아 둘 이유가 없다
      void this.loadSamples();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /**
   * 녹음본을 받아 디코딩한다. **하나라도 실패하면 그것만 빠진다** —
   * 경적 디코딩이 안 된다고 엔진음까지 합성으로 돌릴 이유는 없다.
   *
   * 데이터 URL 이라 네트워크를 타지 않는다 (soundAssets.ts 참고).
   */
  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;

    await Promise.all(
      (Object.entries(soundUrls(this.sel)) as [SoundId, string][]).filter(([, url]) => url).map(async ([id, url]) => {
        try {
          const bytes = await (await fetch(url)).arrayBuffer();
          this.samples.set(id, await ctx.decodeAudioData(bytes));
        } catch (e) {
          // mp3 를 못 읽는 브라우저 — 이 소리만 합성으로 난다
          console.warn('[audio]', id, e);
        }
      }),
    );
  }

  /** 짧은 소리 한 번. 녹음본이 없으면 `false` 를 돌려주고, 부르는 쪽이 합성으로 넘어간다 */
  private playOnce(id: SoundId, gain: number): boolean {
    const buf = this.samples.get(id);
    if (!buf || !this.ctx || !this.master) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }

  /**
   * 시동음 — 판을 시작할 때 한 번.
   *
   * 크랭킹에서 공회전까지가 담겨 있고 뒤가 재워져 있어(scripts/build-sounds.mjs),
   * 그 사이에 엔진 루프가 올라오며 자연스럽게 이어진다. 그래서 여기서는 타이밍을
   * 맞추지 않는다 — 루프는 첫 프레임부터 제 속도로 올라오면 된다.
   *
   * **아직 못 받았으면 아무 일도 하지 않는다.** 시동음이 없다고 합성으로 흉내 내지
   * 않는 이유는, 이 소리는 있으면 좋은 것이지 없으면 판정이 달라지는 것이 아니기 때문이다.
   */
  engineStart(): void {
    this.playOnce('engineStart', GAIN.engineStart);
  }

  setCar(spec: CarSpec): void {
    this.spec = spec;
  }

  /**
   * 고른 소리를 갈아 끼운다 (셋 중 바뀐 것만 넘겨도 된다).
   *
   * 바뀐 것의 버퍼만 버리고 다시 받는다 — 경적을 바꿨다고 엔진 루프까지 다시 받으면
   * 돌고 있던 소리가 끊긴다. 엔진이 바뀐 경우에만 루프를 끊어 새 버퍼로 다시 시작한다.
   *
   * 아직 오디오를 켜기 전(사용자 제스처 이전)이면 고른 값만 기억해 둔다.
   */
  setSounds(patch: Partial<SoundSelection>): void {
    const next = { ...this.sel, ...patch };
    const engineChanged = next.engine !== this.sel.engine;
    const hornChanged = next.horn !== this.sel.horn;
    const blinkerChanged = next.blinker !== this.sel.blinker;
    if (!engineChanged && !hornChanged && !blinkerChanged) return;

    this.sel = next;
    if (!this.ctx) return;

    if (engineChanged) {
      for (const s of DRIVE_STATES) this.samples.delete(s.id);
      this.stopEngineSample();
    }
    if (hornChanged) this.samples.delete('horn');
    if (blinkerChanged) {
      this.samples.delete('blinkerOn');
      this.samples.delete('blinkerOff');
    }
    void this.loadSamples();
  }

  /** 돌고 있는 녹음본 루프를 끊는다. `stop()` 한 소스는 다시 못 쓰므로 참조도 비운다 */
  private stopEngineSample(): void {
    if (!this.ctx) return;
    for (const s of this.driveSrc) s.stop();
    this.driveSrc = [];
    this.driveGain = [];
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 700;
    this.engineFilter.Q.value = 3;

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 90;

    // 한 옥타브 아래를 겹쳐 배기음의 두께를 만든다
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = 45;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;

    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(subGain).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master!);

    this.engineOsc.start();
    this.engineSub.start();
  }


  /**
   * 매 프레임 호출 — 속도에 따라 엔진음을 바꾼다.
   *
   * **타이어 마찰음(스키드)은 내지 않는다.** 예전에는 25km/h 위에서 브레이크를 잡으면
   * 대역통과 노이즈를 깔았는데, 이 게임에서 브레이크는 **정답을 밟는 동작**이다 —
   * 정지선 앞에서 서라고 가르쳐 놓고 설 때마다 사고 날 것 같은 소리를 내면 배우는 것과
   * 들리는 것이 어긋난다. 급제동이 아니라 서행·정지가 이 게임의 기본 동작이기도 하다.
   *
   * `braking` 을 계속 받는 이유는 부르는 쪽(Game.ts)의 모양을 바꾸지 않기 위해서다.
   */
  updateEngine(speedKmh: number, accelerating: boolean, _braking: boolean): void {
    if (!this.ctx) return;

    if (DRIVE_STATES.every((s) => this.samples.has(s.id))) {
      this.updateDriveStates(speedKmh, accelerating);
      return;
    }
    this.updateEngineSynth(speedKmh, accelerating);
  }

  /**
   * 녹음본 주행음 — **상태 세 벌을 건너다닌다.**
   *
   * ## 왜 한 벌을 밀어 올리지 않는가
   *
   * 예전에는 주행 루프 하나를 깔고 재생 속도와 저역통과 필터로 속도를 흉내 냈다.
   * 아무리 다듬어도 **테이프를 빨리 감는 소리**를 벗어나지 못했는데, 원본을 재 보고
   * 이유를 알았다 — **속도를 만드는 것이 엔진이 아니었다.**
   *
   *  - 기본파는 공회전 28.3Hz → 순항 33Hz. **1.17배**뿐이다 (캐시카이는 CVT 라
   *    회전수를 붙들어 둔다). 재생 속도를 0.78~1.52 로 벌리던 것은 없는 변화를 지어낸 것이다.
   *  - 반면 80Hz 위 에너지는 **+20.9dB** 오른다. 전 대역이 함께 오르고 무게중심은
   *    오히려 471 → 429Hz 로 내려간다. 실내에서 속도로 들리는 것은 **타이어와 바람**이고,
   *    그것은 음높이가 아니라 크기로 나타난다.
   *
   * 그래서 만들어 내지 않고, 상태마다 **그 상태를 실제로 녹음한 것**을 쓴다. 이 게임에
   * 있는 속도가 셋뿐(정지 · 서행 12 · 순항 25~40)이라 녹음도 셋이면 충분하다.
   *
   * 셋은 늘 함께 돌고 게인만 오간다 (`stateMix` 의 등출력 크로스페이드). 속도가 상태에
   * 정확히 걸치면 그 하나만, 사이에 있으면 이웃한 둘만 들린다.
   *
   * ## 시정수 0.18초
   *
   * 정지선 앞에서 브레이크를 밟아 설 때 소리가 **뚝 끊기면** 그 자리에서 잘린 것으로
   * 들린다. 실제로도 타이어 소리는 차가 서고 나서 잦아든다. 반대로 너무 느리면 출발이
   * 굼떠 보인다.
   *
   * `accelerating` 은 받지만 쓰지 않는다. 밟는 것이 소리로 나타나는 몫은 이미 속도가
   * 오르면서 상태를 건너가는 것으로 들어가 있고, 거기에 게인을 더 얹으면 같은 원인이
   * 두 번 반영된다. 부르는 쪽(Game.ts)의 모양을 바꾸지 않으려고 받기만 한다.
   */
  private updateDriveStates(speedKmh: number, _accelerating: boolean): void {
    const ctx = this.ctx!;

    if (!this.driveSrc.length) {
      // 합성 엔진이 돌고 있었으면 재운다 — 둘이 겹치면 소리가 두 겹이 된다
      this.engineGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.08);

      for (const st of DRIVE_STATES) {
        const g = ctx.createGain();
        g.gain.value = 0;
        const src = ctx.createBufferSource();
        src.buffer = this.samples.get(st.id)!;
        src.loop = true;
        /*
          음높이는 **한 번 정하고 두지 않는다.** 상태마다 차종을 반영하는 몫이 다른데
          (DriveState.voice), 그 몫은 속도가 아니라 어느 녹음이냐에 따라 정해지므로
          매 프레임 다시 만들 값이 아니다.
        */
        src.playbackRate.value = 1 + (((this.spec?.engineNote ?? 100) / 100 - 1) * st.voice);
        src.connect(g).connect(this.master!);
        src.start();
        this.driveSrc.push(src);
        this.driveGain.push(g);
      }
    }

    const now = ctx.currentTime;
    const mix = stateMix(speedKmh);
    DRIVE_STATES.forEach((st, i) => {
      this.driveGain[i].gain.setTargetAtTime(mix[i] * st.gain, now, 0.18);
    });
  }

  /** 합성 엔진 — 녹음본을 못 읽었을 때만 돈다 (마찰음은 updateEngine 이 이미 처리했다) */
  private updateEngineSynth(speedKmh: number, accelerating: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineFilter) return;
    const base = this.spec?.engineNote ?? 100;
    // 주행 속도가 고정이므로 기준 최고속도도 고정값을 쓴다
    const top = REFERENCE_TOP_KMH;
    const throttle = accelerating ? 1 : 0;

    // 기어를 밟고 올라가는 느낌: 속도를 4단으로 나눠 회전수를 되감는다
    const norm = Math.min(1, speedKmh / top);
    const gear = Math.min(3, Math.floor(norm * 4));
    const inGear = norm * 4 - gear;
    const rpm = 0.35 + inGear * 0.65;

    const freq = base * (0.7 + rpm * 1.5);
    const now = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(freq, now, 0.06);
    this.engineSub!.frequency.setTargetAtTime(freq / 2, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(500 + rpm * 2200 + throttle * 900, now, 0.08);
    this.engineGain.gain.setTargetAtTime(0.035 + throttle * 0.05 + norm * 0.03, now, 0.1);
  }

  /** 뒷차 경적 */
  horn(): void {
    if (this.playOnce('horn', GAIN.horn)) return;
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.setValueAtTime(0.18, now + 0.42);
    gain.gain.linearRampToValueAtTime(0, now + 0.5);
    gain.connect(this.master);

    // 실제 경적은 두 음의 화음이다
    for (const f of [420, 505]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.52);
    }
  }

  /** 결과 알림음. ok=true면 상승음, false면 하강음. */
  chime(ok: boolean): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = ok ? [523, 659, 784] : [392, 330];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const t = now + i * 0.11;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  /** 충돌음 */
  crash(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.45);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.45;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
  }

  /**
   * 방향지시등 딸깍.
   *
   * **켤 때와 끌 때가 다른 소리다.** 실제 릴레이가 그렇고, 이 게임은 깜빡이를 켜는 것을
   * 가르치므로 이 소리를 한 판에 서른 번쯤 듣게 된다 — 같은 소리를 두 번 내면 몇 초 만에
   * 기계음으로 들린다. Game.ts 가 등화 상태가 바뀔 때마다 부르므로 그 상태를 그대로 받는다.
   *
   * 아직 못 받았으면 아무 소리도 내지 않는다. 몇백 밀리초 뒤면 준비된다.
   */
  blinkerTick(on: boolean): void {
    this.playOnce(on ? 'blinkerOn' : 'blinkerOff', GAIN.blinker);
  }

  silenceEngine(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.engineGain?.gain.setTargetAtTime(0, now, 0.1);
    /*
      녹음본 루프는 **재우고 끊는다.** 게인만 0 으로 두면 소리는 안 나지만 소스가 계속
      돌아 다음 판에서 이어지고, 판마다 하나씩 쌓인다. `stop()` 한 소스는 다시 못 쓰므로
      참조도 비워 다음 주행에서 새로 만들게 한다.
    */
    for (const g of this.driveGain) g.gain.setTargetAtTime(0, now, 0.1);
    for (const s of this.driveSrc) s.stop(now + 0.4);
    this.driveSrc = [];
    this.driveGain = [];
  }

  /**
   * 설정 화면에서 **미리 듣기.** 주행 중이 아니어도 고른 소리를 바로 들려준다.
   *
   * 어떤 소리가 좋은지는 들어 봐야 아는 것이라, 고르고 나가서 주행을 시작해야 알 수
   * 있으면 여러 개를 비교할 방법이 없다.
   *
   * 갈아 끼운 직후에는 아직 받는 중일 수 있으므로 **다 받고 나서** 낸다.
   */
  preview(kind: keyof SoundSelection, id: string): void {
    this.setSounds({ [kind]: id });
    if (!this.ctx || !this.master) return;

    const play = (): void => {
      if (kind === 'engine') this.previewEngineLoop();
      else if (kind === 'horn') this.playOnce('horn', GAIN.horn);
      else this.previewBlinker();
    };

    // 엔진은 상태 세 벌이라 **전부** 있어야 한다 — 하나만 보고 내면 조각만 들린다
    const need: SoundId[] =
      kind === 'engine'
        ? DRIVE_STATES.map((s) => s.id)
        : kind === 'horn'
          ? ['horn']
          : ['blinkerOn'];
    if (need.every((k) => this.samples.has(k))) play();
    else void this.loadSamples().then(play);
  }

  /**
   * 깜빡이는 **한 번 눌러서는 성격을 알 수 없다.** 켤 때와 끌 때가 다른 소리이고,
   * 주행 중에는 그 둘이 번갈아 들린다. 주행과 **같은 주기**로 네 번 돌려 준다 —
   * 미리듣기가 실제보다 느리거나 빠르면 고른 뜻이 없다.
   */
  private previewBlinker(): void {
    for (let i = 0; i < 4; i++) {
      window.setTimeout(() => this.blinkerTick(i % 2 === 0), i * BLINK_HALF_MS);
    }
  }

  /**
   * 엔진 미리듣기 — **주행에 실제로 있는 세 상태를 그대로 들려준다.**
   *
   * 한 상태만 들려주면 고를 수가 없다. 정지 상태의 소리만 듣고 고르면 정작 달릴 때
   * 어떻게 들리는지는 모르는 채로 정하게 된다.
   *
   * 그래서 정지 → 출발 → 순항 → 정지로 한 번 오갔다 온다. 게인은 주행 중과
   * **같은 표·같은 크로스페이드**(`DRIVE_STATES` · `stateMix`)에서 꺼낸다 —
   * 미리듣기가 실제와 다르면 고른 뜻이 없다.
   *
   * 상태마다 **머무는 시간**을 준다. 쉬지 않고 훑으면 크로스페이드만 들리고 정작 각
   * 상태가 어떤 소리인지는 안 들린다.
   */
  private previewEngineLoop(): void {
    if (!this.ctx || !this.master) return;
    if (!DRIVE_STATES.every((s) => this.samples.has(s.id))) return;
    this.stopEngineSample();

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const END = 4.2;

    const gains = DRIVE_STATES.map((st) => {
      const src = ctx.createBufferSource();
      src.buffer = this.samples.get(st.id)!;
      src.loop = true;
      src.playbackRate.value = 1 + (((this.spec?.engineNote ?? 100) / 100 - 1) * st.voice);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      src.connect(g).connect(this.master!);
      src.start(now);
      src.stop(now + END);
      return g;
    });

    /** 그 속도의 배합을 t 초 지점에 찍는다 */
    const at = (t: number, kmh: number): void => {
      const mix = stateMix(kmh);
      DRIVE_STATES.forEach((st, i) => {
        gains[i].gain.linearRampToValueAtTime(mix[i] * st.gain, now + t);
      });
    };
    at(0.15, 0); // 정지에서 올라오고
    at(1.1, 0); //   머문다
    at(1.6, SLOW_KMH); // 출발해서
    at(2.4, SLOW_KMH); //   머문다
    at(2.9, CRUISE_KMH); // 순항으로 붙었다가
    at(3.7, CRUISE_KMH); //   머물고
    at(4.05, 0); // 다시 선다
    for (const g of gains) g.gain.linearRampToValueAtTime(0, now + END);
  }

}
