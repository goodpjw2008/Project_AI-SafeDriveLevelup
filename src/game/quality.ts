/**
 * 화질 설정 — **무엇을 낮추면 무엇이 빨라지는가를 한 곳에 적는다.**
 *
 * 손잡이를 고를 때 지킨 원칙: **실제로 듣는 것만 넣는다.**
 *
 * 이 게임은 재 보면 GPU 가 아니라 **드로우콜(CPU)** 에 묶여 있다. 프레임마다 400여 번
 * 그리기 명령을 보내는데, 화면 픽셀을 2.5배로 늘려도(1080p → 레티나 1440p) 프레임이
 * 그대로였고 CPU 만 1/6 로 조이자 곧바로 절반으로 떨어졌다.
 *
 * 그래서 흔한 '저사양 모드'가 건드리는 **해상도·픽셀 배율은 넣지 않았다** — 이 게임에서는
 * 화면만 흐려지고 빨라지지는 않는다. 아무 일도 하지 않는 손잡이는 없느니만 못하다.
 *
 * **실측값** (M3 Max, 주행 중 프레임당 드로우콜 400~450 기준). 항목을 끄고 켜며 잰
 * 차이지, 짐작이 아니다.
 *
 *   좌·우·후방 시야 창   약 47 콜 (10~12%)
 *   그림자 맵           약 42~78 콜 (10~19%)
 *   둘 다 끄기          약 136 콜 (34%)
 *
 * 처음에는 시야 창이 40% 라고 봤다 — 렌더 패스별 드로우콜을 세면서 같은 크기(171)의
 * 패스가 여러 개 보이길래 '메인 + 시야 창' 이라고 읽었는데, 실제로는 **여러 프레임의
 * 메인 패스**였다. 시야 창 카메라는 좁은 화각으로 옆·뒤를 보므로 시야 절두체 밖이
 * 대부분 잘려 나가, 같은 장면이라도 훨씬 적게 그린다. 켜고 끄며 직접 재서 바로잡았다.
 *
 * ## "고성능 PC 에서는 쾌적한데 일반 PC 에서는 설정을 다 꺼도 느리다" (2026-09)
 *
 * 위 측정은 M3 Max 에서 한 것이라 **GPU 가 넉넉한 기기**의 이야기였다. 사용자가 일반 PC 에서 설정을 다 꺼도 느리다고
 * 해서 다시 쟀다 — CPU 를 4배 느리게 한 것과, GPU 를 4K 로 몰아붙여 픽셀에 묶이게 한 것(약한 GPU 의 1080p 와 닮았다).
 * 설정으로 끌 수 없던 비용이 넷 나왔다.
 *
 *   차 모델의 투과(transmission) 유리   장면을 매 프레임 한 번 더 그림 · 셰이더 재선택   → 불러올 때 없앤다 (carModel.ts)
 *   배경 차에 원본 모델                 한 대 7만~66만 면, 한 판 157만 면                → 가벼운 모델 (build-lod-models.mjs)
 *   SF90 모델 부품 1254조각              내 차 한 대에 그리기 1250번                       → 조각 합치기 (join-fragments.mjs)
 *   신호등 등화마다 점광원 7개           GPU 시간의 약 25% (꺼진 등도 계산한다)             → 반사 '높음' 이상에서만 (아래)
 *
 * 그리고 **해상도는 GPU 가 약한 기기에서 듣는다** — 4K 에서 픽셀을 1/4 로 줄이니 프레임 시간이 25% 줄었다. 위에서
 * "해상도는 넣지 않았다" 고 적은 것은 M3 Max 기준이었다. 그래서 해상도 항목을 두고, 기본은 느릴 때만 스스로 낮추는
 * '자동' 이다 (아래 AutoResolution).
 */

import * as THREE from 'three';

/** 네 단계짜리 항목이 쓰는 값 */
export type QualityTier = 'ultra' | 'high' | 'medium' | 'low';

/** 좌·우·후방 시야 창을 언제 그릴 것인가 */
export type PeripheralMode = 'always' | 'driverOnly' | 'off';

/** 프레임 상한 (0 = 제한 없음) */
export type FrameCap = 0 | 60 | 30;

/**
 * 화면 깨짐 대응 — 휴대폰 GPU 드라이버가 프레임의 한 구역을 통째로 빠뜨리는 문제(삼성 Xclipse · ANGLE-Vulkan,
 * CHANGELOG)에 **그리는 길을 바꿔 보는 손잡이.** 사용자 휴대폰에서 진단 줄이 그림 버퍼 안의 순검정 띠를 잡았다 —
 * 우리 그리기 논리가 아니라 드라이버가 구역을 빠뜨리는 것이라, 드라이버가 다르게 움직이는 길을 골라 본다.
 *
 * · `copy` — 장면을 렌더 타깃에 그린 뒤 캔버스에는 한 장으로 옮긴다(CopyPass). 캔버스에 닿는 그리기가 백여 번에서
 *   한 번이 된다.
 * · `preserve` — 캔버스의 그림 버퍼를 프레임 사이에 버리지 않게 한다(preserveDrawingBuffer). 브라우저가 프레임마다
 *   버퍼를 '버려도 된다' 고 표시하는 길이 사라진다. 컨텍스트 속성이라 **다시 시작해야 적용**된다 (MSAA 와 같다).
 */
export type GlitchGuard = 'off' | 'copy' | 'preserve';
export const GLITCH_GUARD_LABEL: Record<GlitchGuard, string> = { off: '없음', copy: '복사', preserve: '버퍼 유지' };

export interface GraphicsSettings {
  /** 그림자 — 맵 크기와 필터가 함께 내려간다 */
  shadow: QualityTier;
  /** 반사 — HDRI 환경광 (차체에 비치는 하늘·건물) */
  reflection: QualityTier;
  /** 좌·우·후방 시야 창 */
  peripheral: PeripheralMode;
  /** 프레임 상한 */
  frameCap: FrameCap;
  /**
   * MSAA (다중 표본 앤티에일리어싱).
   *
   * **켜고 끄는 즉시 반영되지 않는다.** WebGL 컨텍스트를 만들 때 정해지는 속성이라
   * 바꾸려면 렌더러를 새로 만들어야 하는데, 이 프로젝트는 렌더러 한 벌을 계속 쓰는 것을
   * 원칙으로 한다(renderer.ts) — 새로 만들면 2.6~7.6MB 짜리 차량 모델을 전부 다시 올린다.
   * 그래서 다음에 켤 때 적용된다.
   */
  msaa: boolean;
  /** 화면 구석에 fps 를 띄운다 — 설정을 바꾼 효과를 직접 보게 하는 장치. 켜면 진단 줄이 된다 (Game 의 diagText) */
  showFps: boolean;
  /** 화면 깨짐 대응 (위 GlitchGuard) */
  glitchGuard: GlitchGuard;
  /**
   * 렌더 해상도 — 화면 배율(최대 2) 에 곱하는 비율. `auto` 는 느릴 때만 스스로 낮춘다 (AutoResolution).
   * 약한 GPU(노트북 내장 그래픽)에서 가장 잘 듣는 손잡이다 — 픽셀을 반으로 줄이면 픽셀 처리가 반이 된다.
   */
  resolution: RenderResolution;
}

/** 렌더 해상도 선택지 — `auto` 또는 퍼센트 */
export type RenderResolution = 'auto' | 100 | 75 | 50;

export const RESOLUTION_CHOICES: Array<[string, string]> = [
  ['auto', '자동'],
  ['100', '100%'],
  ['75', '75%'],
  ['50', '50%'],
];

/** 그림자 단계별 실제 값 */
const SHADOW: Record<QualityTier, { on: boolean; size: number; type: THREE.ShadowMapType }> = {
  ultra: { on: true, size: 2048, type: THREE.PCFSoftShadowMap },
  high: { on: true, size: 1024, type: THREE.PCFSoftShadowMap },
  medium: { on: true, size: 512, type: THREE.PCFShadowMap },
  // 끄면 그림자 패스가 통째로 사라진다 — 프레임당 드로우콜 42~78개
  low: { on: false, size: 512, type: THREE.BasicShadowMap },
};

export const shadowSpec = (t: QualityTier) => SHADOW[t];

/**
 * 반사(HDRI 환경광)의 세기 배수.
 *
 * '낮음'은 환경맵을 아예 걸지 않는다 — 재질마다 하던 환경 샘플링이 사라지고, 처음 켤 때
 * 받아서 굽던 HDR 세 장(4.5MB)도 건너뛴다. 차체 반사가 없어질 뿐 판정은 그대로다.
 */
const REFLECTION: Record<QualityTier, number> = {
  ultra: 1,
  high: 0.7,
  medium: 0.4,
  low: 0,
};

export const reflectionScale = (t: QualityTier) => REFLECTION[t];

/**
 * **신호등 등화의 점광원** 을 켤 것인가 — 반사(조명) '높음' 이상에서만.
 *
 * 등화마다 PointLight 가 하나씩(한 판에 7개 남짓) 붙어 렌즈 둘레의 기둥 · 노면을 등화 색으로 물들인다. 그런데 three 는
 * **꺼진 등(세기 0)도** 모든 재질이 픽셀마다 계산한다 — 4K 로 픽셀에 묶어 재 보니 GPU 시간의 약 25% 였다. 렌즈의 발광과
 * 빛번짐 스프라이트가 이미 '켜진 등' 을 그리므로, 끄면 사라지는 것은 둘레에 번지는 색뿐이다.
 */
export const usesLampLights = (t: QualityTier) => t === 'ultra' || t === 'high';

/** '낮음'이면 HDR 을 받지도 굽지도 않는다 */
export const usesEnvironment = (t: QualityTier) => REFLECTION[t] > 0;

/**
 * 기본값 — **'보통' 프리셋과 같다** (사용자가 그렇게 정했다: "초기 전체 프리셋 설정을 보통으로 해줘").
 *
 * 한때 기본은 '높음' 이었다. 처음 켜는 사람이 자기 기기에 무엇이 맞는지 알 수 없으니 무난한 쪽에 두자는 것이었는데,
 * **무난한 쪽이 '높음' 이 아니었다** — 사용자가 일반 PC 에서 느리다고 했고(2026-09), 처음 켠 사람은 느린 것이
 * 자기 기기 탓인지 설정 탓인지 모른 채 그냥 느리게 논다. 먼저 돌아가게 해 두고 좋은 화면을 원하는 사람이 올리는
 * 편이, 먼저 예쁘게 해 두고 느린 사람이 원인을 찾아 내리는 편보다 낫다.
 *
 * '보통' 은 그림자·반사를 한 단계 낮추고 신호등 조명을 끄며(usesLampLights) 60fps 로 묶는다. 해상도는 '자동'
 * 이라 느릴 때만 스스로 낮춘다 — 처음부터 흐리게 시작하지는 않는다. 판정에 쓰이는 것은 하나도 건드리지 않는다.
 *
 * 시야 창이 `driverOnly` 인 것은 **공짜로 얻는 절감**이라서다 — 후방·상공 시점에서는
 * 주변이 이미 화면에 다 보이므로 창이 필요 없다. 운전자 시점에서는 그대로 뜨므로
 * 학습 가치는 하나도 잃지 않는다.
 *
 * MSAA 는 프리셋이 건드리지 않는 값이라(presetGraphics) 여기서 기본을 정한다 — 켜 둔다.
 */
export function defaultGraphics(): GraphicsSettings {
  return {
    shadow: 'medium',
    reflection: 'medium',
    peripheral: 'driverOnly',
    frameCap: 60,
    msaa: true,
    showFps: false,
    glitchGuard: 'off',
    resolution: 'auto',
  };
}

/**
 * 프리셋 — 한 번에 네 단계를 맞춘다.
 *
 * `msaa` 와 `showFps` 는 건드리지 않는다. 앞의 것은 다시 시작해야 반영되는 값이라
 * 프리셋을 눌렀을 때 조용히 바뀌면 왜 안 바뀌는지 알 수 없고, 뒤의 것은 화질이 아니라
 * 보기 설정이다.
 */
export function presetGraphics(tier: QualityTier, current: GraphicsSettings): GraphicsSettings {
  const byTier: Record<QualityTier, Omit<GraphicsSettings, 'msaa' | 'showFps' | 'glitchGuard'>> = {
    ultra: { shadow: 'ultra', reflection: 'ultra', peripheral: 'always', frameCap: 0, resolution: 100 },
    high: { shadow: 'high', reflection: 'high', peripheral: 'driverOnly', frameCap: 0, resolution: 'auto' },
    medium: { shadow: 'medium', reflection: 'medium', peripheral: 'driverOnly', frameCap: 60, resolution: 'auto' },
    // 낮음은 처음부터 75% — 느린 기기에서 '자동' 이 낮출 때까지 기다리는 몇 초도 아깝다
    low: { shadow: 'low', reflection: 'low', peripheral: 'off', frameCap: 30, resolution: 75 },
  };
  return { ...byTier[tier], msaa: current.msaa, showFps: current.showFps, glitchGuard: current.glitchGuard };
}

/** 지금 설정이 어느 프리셋과 같은가 — 같은 것이 없으면 null (= 사용자 지정) */
export function matchedPreset(g: GraphicsSettings): QualityTier | null {
  for (const tier of ['ultra', 'high', 'medium', 'low'] as const) {
    const p = presetGraphics(tier, g);
    if (
      p.shadow === g.shadow &&
      p.reflection === g.reflection &&
      p.peripheral === g.peripheral &&
      p.frameCap === g.frameCap &&
      p.resolution === g.resolution
    ) {
      return tier;
    }
  }
  return null;
}

/**
 * **저장본의 화질을 지금 형식으로 읽는다** — 빠진 항목은 기본값으로 채우되, **나중에 생긴 항목 때문에 프리셋이
 * 풀리지 않게** 한다.
 *
 * 사용자가 짚었다 — "설정에서 전체 프리셋은 초기에 설정이 되어 있지 않아. 왜 그런 거니?" 화질을 다 낮춰 두고
 * 쓰던 저장본이 그랬다. 성능 작업 때 '렌더 해상도' 항목이 새로 생겼는데, 그 항목이 없던 저장본은 기본값인
 * '자동' 으로 채워진다. 그런데 '낮음' 프리셋은 75% 라, **나머지 네 항목이 낮음과 똑같은데도** 해상도 하나가
 * 달라 '사용자 지정' 으로 떨어졌다. 고른 적 없는 값 때문에 고른 적 있는 프리셋이 풀린 셈이다.
 *
 * 그래서 해상도가 없는 저장본은 **나머지 네 항목이 가리키는 프리셋의 해상도**를 따른다. 네 항목이 어떤 프리셋과도
 * 같지 않으면(정말로 사용자 지정이면) 기본값 '자동' 그대로다 — 고르지 않은 사람에게 75% 를 들이밀지 않는다.
 */
export function graphicsFromSaved(
  saved: Partial<GraphicsSettings> | undefined,
  /**
   * **'자동' 도 고른 값이 아닌 것으로 본다** — 해상도 항목이 생기기 전의 저장본이 한 번이라도 저장되면
   * (판이 끝날 때마다 저장된다) 채워진 기본값 '자동' 이 그대로 적혀 버려, 위의 `=== undefined` 로는 더 이상
   * 가려낼 수 없다. 그래서 저장본 버전으로 한 번만 되살린다 (save.ts 의 v11).
   */
  autoIsUnset = false,
): GraphicsSettings {
  const g = { ...defaultGraphics(), ...(saved ?? {}) };
  if (saved && (saved.resolution === undefined || (autoIsUnset && saved.resolution === 'auto'))) {
    const tier = (['ultra', 'high', 'medium', 'low'] as const).find((t) => {
      const p = presetGraphics(t, g);
      return (
        p.shadow === g.shadow &&
        p.reflection === g.reflection &&
        p.peripheral === g.peripheral &&
        p.frameCap === g.frameCap
      );
    });
    if (tier) g.resolution = presetGraphics(tier, g).resolution;
  }
  return g;
}

/** 프리셋이 정하는 다섯 항목 — 화면의 줄 이름과 같은 말을 쓴다 (설정 화면에서 바로 찾아갈 수 있게) */
const PRESET_FIELDS: ReadonlyArray<[keyof GraphicsSettings, string]> = [
  ['resolution', '렌더 해상도'],
  ['peripheral', '좌·우·후방 시야 창'],
  ['shadow', '그림자 품질'],
  ['reflection', '반사 품질'],
  ['frameCap', '프레임 상한'],
];

/**
 * **가장 가까운 프리셋과, 어긋난 항목** — 아무 프리셋도 켜지지 않았을 때 왜 그런지 말해 주려고.
 *
 * 프리셋은 다섯 항목이 모두 같아야 켜진다. 하나만 달라도 넷은 '아주 높음' 인데 화면에는 아무것도 켜지지 않아,
 * 사용자가 두 번 물었다 — "전체 프리셋은 초기에 설정이 되어 있지 않아. 왜 그런 거니?" 규칙이 맞아도 **보이지 않으면
 * 고장으로 읽힌다.** 그래서 어긋난 항목을 화면이 직접 말한다.
 *
 * 같은 수만큼 어긋나면 **높은 쪽**을 고른다 — 목록 차례(아주 높음 → 낮음)가 그대로 우선순위다.
 */
export function presetDiff(g: GraphicsSettings): { tier: QualityTier; fields: string[] } | null {
  let best: { tier: QualityTier; fields: string[] } | null = null;
  for (const tier of ['ultra', 'high', 'medium', 'low'] as const) {
    const p = presetGraphics(tier, g);
    const fields = PRESET_FIELDS.filter(([k]) => p[k] !== g[k]).map(([, label]) => label);
    if (!best || fields.length < best.fields.length) best = { tier, fields };
  }
  return best && best.fields.length ? best : null;
}

/** 화면에 쓰는 이름 */
export const TIER_LABEL: Record<QualityTier, string> = {
  ultra: '아주 높음',
  high: '높음',
  medium: '보통',
  low: '낮음',
};

export const PERIPHERAL_LABEL: Record<PeripheralMode, string> = {
  always: '항상',
  driverOnly: '운전자 시점에서만',
  off: '끄기',
};

/**
 * 프레임 상한 선택지 — **순서를 배열로 적는다.**
 *
 * 객체로 두면 안 된다. 자바스크립트는 정수처럼 생긴 키('0'·'30'·'60')를 **오름차순으로
 * 다시 정렬**하므로, 적어 둔 순서(제한 없음 → 60 → 30)와 상관없이 0·30·60 으로 나온다.
 * 다른 항목이 전부 '높은 것 → 낮은 것' 순인데 여기만 뒤집혀 보였다.
 */
export const FRAME_CAP_CHOICES: Array<[string, string]> = [
  ['0', '제한 없음'],
  ['60', '60 fps'],
  ['30', '30 fps'],
];

/**
 * **렌더 해상도 자동 조절** — 느릴 때만 낮춘다. 순수 로직이라 화면 없이 테스트한다 (tests/quality.test.ts).
 *
 * 그린 프레임마다 `frame(now)` 를 부르면 1초마다 fps 를 재고, 배율을 바꿔야 할 때만 새 배율을 돌려준다.
 *
 *  - **낮춘다** — 목표(60, 또는 프레임 상한)의 85% 밑이 2초 이어지면 한 단계(15%) 낮춘다. 가장 낮게는 55%.
 *  - **효과가 없으면 되돌리고 멈춘다** — 낮춘 뒤 5% 도 빨라지지 않으면 해상도가 병목이 아니다(CPU 에 묶였거나, 절전
 *    모드처럼 브라우저가 프레임을 묶어 둔 경우). 화면만 흐려지므로 되돌리고 그 판은 더 건드리지 않는다.
 *  - **여유가 생기면 올려 본다** — 목표의 97% 이상이 10초 이어지면 한 단계 올리고, 곧 다시 느려지면 되내리고 거기서
 *    멈춘다(오르내림을 되풀이하면 화면이 번갈아 흐려진다).
 *  - 판을 막 시작한 3초와, 배율을 바꾼 뒤 2초는 재지 않는다 — 셰이더 컴파일 · 버퍼 재할당으로 잠깐 느리다.
 *  - 탭을 떠나 프레임이 끊기면(창 3초 넘게 빔) 그 창은 버린다.
 *
 * 찾은 배율은 **다음 판의 시작값**이 된다(`learnedScale`) — 같은 기기에서 매 판 처음부터 다시 찾지 않게.
 */
export const AUTO_RES_STEP = 0.15;
export const AUTO_RES_MIN = 0.55;
let learned = 1;

export class AutoResolution {
  scale: number;
  private windowStart = -1;
  private frames = 0;
  private quietUntil: number;
  private slow = 0;
  private fast = 0;
  /** 방금 낮췄다 — 다음 창에서 효과를 본다 */
  private dropCheck: { from: number; fps: number } | null = null;
  /** 방금 올렸다 — 곧 다시 느려지면 되내린다 */
  private raiseCheck: { from: number; windows: number } | null = null;
  /** 더는 바꾸지 않는다 (효과가 없었거나 오르내림이 한 번 되풀이됐다) */
  private locked = false;
  private noRaise = false;

  constructor(
    private targetFps: number,
    start: number,
    /** 이번 판을 시작한 시각 (performance.now) */
    now: number,
  ) {
    this.scale = start;
    this.quietUntil = now + 3000;
  }

  /** 그린 프레임마다 부른다. 배율을 바꿔야 하면 새 배율, 아니면 null */
  frame(now: number): number | null {
    if (this.windowStart < 0 || now - this.windowStart > 3000) {
      this.windowStart = now;
      this.frames = 0;
      return null;
    }
    this.frames++;
    const span = now - this.windowStart;
    if (span < 1000) return null;
    const fps = (this.frames * 1000) / span;
    this.windowStart = now;
    this.frames = 0;
    if (now < this.quietUntil || this.locked) return null;

    const slowNow = fps < this.targetFps * 0.85;
    const fastNow = fps >= this.targetFps * 0.97;

    if (this.dropCheck) {
      const { from, fps: before } = this.dropCheck;
      this.dropCheck = null;
      if (fps < before * 1.05) {
        this.locked = true;
        return this.set(from, now);
      }
    }
    if (this.raiseCheck) {
      this.raiseCheck.windows++;
      if (slowNow) {
        const back = this.raiseCheck.from;
        this.raiseCheck = null;
        this.noRaise = true;
        return this.set(back, now);
      }
      if (this.raiseCheck.windows >= 3) this.raiseCheck = null;
    }

    this.slow = slowNow ? this.slow + 1 : 0;
    this.fast = fastNow ? this.fast + 1 : 0;

    if (this.slow >= 2 && this.scale > AUTO_RES_MIN) {
      this.dropCheck = { from: this.scale, fps };
      return this.set(Math.max(AUTO_RES_MIN, round2(this.scale - AUTO_RES_STEP)), now);
    }
    if (this.fast >= 10 && this.scale < 1 && !this.noRaise) {
      this.raiseCheck = { from: this.scale, windows: 0 };
      return this.set(Math.min(1, round2(this.scale + AUTO_RES_STEP)), now);
    }
    return null;
  }

  private set(scale: number, now: number): number {
    this.scale = scale;
    this.slow = 0;
    this.fast = 0;
    this.quietUntil = now + 2000;
    learned = scale;
    return scale;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 지난 판에서 찾은 배율 — 다음 판의 시작값 (새로고침하면 1 로 돌아간다) */
export const learnedScale = (): number => learned;

/** 설정값 → 이 판의 시작 배율 */
export function startScale(r: RenderResolution): number {
  return r === 'auto' ? learned : r / 100;
}
