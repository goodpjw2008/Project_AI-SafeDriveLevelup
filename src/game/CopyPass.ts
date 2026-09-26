/**
 * **렌더 해상도를 낮출 때의 그리기 길** — 캔버스 크기는 그대로 두고, 장면을 **작은 렌더 타깃**에 그린 뒤 캔버스에
 * 한 장으로 올린다.
 *
 * 예전에는 배율을 낮추면 캔버스의 그림 버퍼 자체를 줄였다(`setPixelRatio` × 배율). 그러면 버퍼가 915×422 같은
 * **어중간한 크기**가 되는데, 사용자 휴대폰(삼성 Xclipse 940 · ANGLE-Vulkan)의 드라이버는 그런 크기에서 프레임의
 * 가로 띠(여러 줄 × 화면 전체 폭)를 통째로 빠뜨렸다 — 지우기조차 되지 않은 순검정으로. 화면 크기 그대로인
 * 1664×768 에서는 멀쩡했다. 진단 줄이 잡은 검은 프레임은 모두 배율이 55% 로 내려간 뒤였고, 새로고침(배율 1 로
 * 되돌아감)하면 한동안 괜찮다가 자동 조절이 다시 낮추면 재발하던 것이 이것이다 (CHANGELOG).
 *
 * 그래서 캔버스는 화면 크기 그대로 두고, 배율은 렌더 타깃의 크기로 낸다. 타깃은 가로·세로를 **32 의 배수**로 맞춘다 —
 * 어중간한 크기를 피하려는 것이고, 타깃의 가로세로비는 화면과 조금 달라도 된다(카메라는 화면 비율로 그리고,
 * 타깃을 화면에 늘여 올리므로 그림이 찌그러지지 않는다). 올릴 때는 선형 보간이라 브라우저가 작은 캔버스를 늘일
 * 때와 같은 정도로 부드럽다. 프레임마다 화면 한 장을 더 쓰는 값이 들지만, 배율을 낮췄다는 것은 픽셀이 병목이라는
 * 뜻이라 줄인 픽셀에 비하면 작다.
 *
 * 렌더 타깃은 **캔버스와 똑같이** 그려져야 한다 — 톤매핑 · sRGB 인코딩 · 안개가 섞이는 색 공간까지. three 는 렌더
 * 타깃에 그릴 때 이것을 모두 건너뛰고(선형 저장) 나중에 하도록 되어 있는데, 8비트 선형 저장은 어두운 곳에 띠가
 * 지고 안개가 섞이는 공간이 달라져 보기가 달라진다. 그래서 WebXR 층(layer)의 규칙을 빌린다: `isXRRenderTarget`
 * 이 참인 타깃에는 three 가 캔버스와 같은 순서로 그려 넣고(WebGLPrograms · UniformsUtils), 저장 형식은 변환 없는
 * RGBA8 로 둔다(WebGLTextures 의 forceLinearTransfer). 올리는 셰이더는 값을 손대지 않는다 — 같은 크기로 곧장 그린
 * 화면과 견주어 ±1 이내였다.
 */

import * as THREE from 'three';

/** 타깃 가로·세로의 배수 — 어중간한 크기를 피한다 (위 주석) */
const ALIGN = 32;
const aligned = (v: number) => Math.max(ALIGN, Math.round(v / ALIGN) * ALIGN);

export class CopyPass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(ALIGN, ALIGN, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
    });
    (this.target as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: { tex: { value: this.target.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tex; varying vec2 vUv; void main() { gl_FragColor = texture2D(tex, vUv); }',
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** 지금 타깃 크기 — 진단 줄에 적는다 */
  get size(): { width: number; height: number } {
    return { width: this.target.width, height: this.target.height };
  }

  /** 장면을 캔버스 크기 × 배율(32 의 배수로 맞춤)의 타깃에 그린다. 뒤에 `present` 로 올린다 */
  renderScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, scale: number): void {
    const gl = renderer.getContext();
    const w = aligned(gl.drawingBufferWidth * scale);
    const h = aligned(gl.drawingBufferHeight * scale);
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
  }

  /** 타깃을 캔버스에 한 장으로 올린다 */
  present(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
