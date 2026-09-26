/**
 * **WebGL 렌더러는 한 벌만 만들어 계속 쓴다.**
 *
 * 예전에는 판을 시작할 때마다 `new THREE.WebGLRenderer` 를 만들고 끝날 때 버렸다.
 * 그러면 캐시해 둔 차량 모델이 아무 소용이 없다 — 지오메트리·텍스처·컴파일된 셰이더는
 * **렌더러(정확히는 GL 컨텍스트)에 딸린 것**이라, 렌더러를 새로 만들면 전부 다시 올라간다.
 * SL63(7.6MB) 처럼 큰 모델에서 판을 다시 시작할 때마다 눈에 띄게 멈칫하던 원인이다.
 *
 * 게다가 three 의 `renderer.dispose()` 는 자기 장부만 비우고 GPU 쪽 객체는 그대로 두므로,
 * 판을 거듭할수록 쓰지 않는 텍스처가 쌓이기만 했다.
 *
 * 한 벌을 계속 쓰면 두 번째 판부터는 **올릴 것도 컴파일할 것도 없다.**
 * 장면마다 만든 것(노면·차체 절차 메시·렌더 타깃)은 각자 dispose 하므로 새는 곳은 없다.
 *
 * 주행 화면(Game)과 좌석 맞추기(SeatPreview)가 같은 캔버스를 쓰므로 이 한 벌을 나눠 쓴다.
 * 캔버스가 바뀌는 일은 없지만, 바뀐다면 그때는 새로 만든다.
 */

import * as THREE from 'three';

let shared: THREE.WebGLRenderer | null = null;
let sharedCanvas: HTMLCanvasElement | null = null;

/**
 * MSAA 를 켤 것인가 — **첫 렌더러를 만들기 전에 정해져야 한다.**
 *
 * WebGL 컨텍스트를 만들 때 고정되는 속성이라 나중에 바꿀 수 없다. 그래서 설정 화면은
 * 이 값을 저장만 하고 "다시 시작 후 적용" 이라고 적는다. main.ts 가 부팅할 때 한 번
 * 넣어 준다.
 */
let msaaWanted = true;

export function setMsaaPreference(on: boolean): void {
  msaaWanted = on;
}

export function sharedRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  if (shared && sharedCanvas === canvas) {
    // 화면 배율은 창을 옮기면 달라진다 (외장 모니터 ↔ 노트북)
    shared.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    return shared;
  }
  shared?.dispose();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    /*
      배율이 2 이상이면 MSAA 를 켜지 않는다 — 픽셀이 이미 촘촘해 계단이 거의 안 보이는데
      값만 든다. 설정에서 끄면 어느 배율에서든 끈다.
    */
    antialias: msaaWanted && window.devicePixelRatio < 2,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  /*
    **그림자 맵을 render 마다 다시 굽지 않는다.**

    이 게임은 한 프레임에 두 번 그린다 — 좌·우·후방 시야 창(렌더 타깃) 한 장과 메인 화면.
    autoUpdate 를 켜 두면 2048×2048 그림자 패스가 그 두 번 모두 돈다. 그림자는 카메라가
    아니라 태양 기준이라 두 번 구울 이유가 없다.

    대신 **프레임마다 한 번은 반드시 켜 줘야 한다** — Game 의 루프가 첫 렌더 직전에
    `needsUpdate = true` 를 준다. 잊으면 그림자가 첫 프레임에서 얼어붙는다.
  */
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  shared = renderer;
  sharedCanvas = canvas;
  /*
    **컨텍스트를 잃은 횟수를 센다** — 휴대폰에서 화면이 검게 깨지는 문제의 진단 줄(Game 의 diag)에 적는다.
    three 가 'webglcontextlost' 에 preventDefault 를 걸어 복구가 가능하게 해 두므로 여기서는 세기만 한다.
  */
  canvas.addEventListener('webglcontextlost', () => {
    contextLost++;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextRestored++;
  });
  return renderer;
}

let contextLost = 0;
let contextRestored = 0;
/** 이 캔버스가 WebGL 컨텍스트를 잃은 · 되찾은 횟수 (진단 줄) */
export const contextLossCount = (): { lost: number; restored: number } => ({ lost: contextLost, restored: contextRestored });

/** GPU 이름 — 브라우저가 알려 주는 렌더러 문자열 (진단 줄). 못 얻으면 빈 글 */
export function gpuName(renderer: THREE.WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string);
    return String(name ?? '');
  } catch {
    return '';
  }
}
