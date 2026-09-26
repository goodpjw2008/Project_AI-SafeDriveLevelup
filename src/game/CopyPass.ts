/**
 * **한 번 더 복사해서 그리기** — 설정 '화면 깨짐 대응 · 복사' (quality.ts 의 GlitchGuard).
 *
 * 장면을 캔버스에 곧장 그리지 않고 같은 크기의 렌더 타깃에 그린 뒤, 캔버스에는 그 그림을 한 장으로 옮기는
 * 그리기 한 번만 한다. 사용자 휴대폰(삼성 Xclipse 940 · ANGLE-Vulkan)에서 캔버스 프레임의 한 구역이 통째로
 * 빠지는 드라이버 문제의 대응 후보다 — 캔버스에 닿는 그리기가 백여 번에서 한 번으로 줄고, 장면은 보통의
 * 텍스처에 그려진다. 프레임마다 화면 한 장을 더 쓰는 값이 든다. (캔버스의 MSAA 는 이 길에서는 쓰이지 않는다 —
 * 휴대폰은 화면 배율이 2 를 넘어 어차피 끄여 있다, renderer.ts)
 *
 * 렌더 타깃은 **캔버스와 똑같이** 그려져야 한다 — 톤매핑 · sRGB 인코딩 · 안개가 섞이는 색 공간까지. three 는 렌더
 * 타깃에 그릴 때 이것을 모두 건너뛰고(선형 저장) 나중에 하도록 되어 있는데, 8비트 선형 저장은 어두운 곳에 띠가
 * 지고 안개가 섞이는 공간이 달라져 보기가 달라진다. 그래서 WebXR 층(layer)의 규칙을 빌린다: `isXRRenderTarget`
 * 이 참인 타깃에는 three 가 캔버스와 같은 순서로 그려 넣고(WebGLPrograms · UniformsUtils), 저장 형식은 변환 없는
 * RGBA8 로 둔다(WebGLTextures 의 forceLinearTransfer). 옮기는 셰이더는 값을 손대지 않고 그대로 쓴다.
 * 헤드리스로 곧장 그린 화면과 견주어 같은 것을 확인했다.
 */

import * as THREE from 'three';

export class CopyPass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
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

  /** 장면을 타깃에 그리고 캔버스에 옮긴다 — `renderer.render(scene, camera)` 자리에 그대로 들어간다 */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
