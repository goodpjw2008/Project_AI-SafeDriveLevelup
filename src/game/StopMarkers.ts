/**
 * 정지선과 정지 구역 표시.
 *
 * 이 게임의 채점 기준은 결국 "정지선 앞에서 제대로 멈췄는가"다.
 * 그런데 노면 텍스처에 그린 정지선은 멀리서 보면 몇 픽셀로 뭉개져 어디서 멈춰야 할지
 * 알아볼 수 없다. 그래서 정지선만은 별도 메시로 띄워 해상도와 무관하게 또렷하게 그리고,
 * 멈춰야 하는 순간에는 노면을 물들여 정지 위치를 눈에 박히게 한다.
 *
 * 색으로 상태를 구분한다.
 *   호박색 점멸 = 여기서 멈춰야 함 (아직 정지 안 함)
 *   초록색      = 완전정지 인정됨. 이제 출발해도 됨
 */

import * as THREE from 'three';
import {
  CROSSWALK_INNER,
  PLAYER_EXIT_Z,
  ROAD_HALF_WIDTH,
  STOP_LINE,
} from '../layout';

/** 정지선 폭 (m). 도로교통법 시행규칙 [별표 6] 정지선은 30~60cm — 상한을 쓴다. */
const LINE_WIDTH = 0.6;

/** 정지 구역 밴드의 길이 (m) — 정지선 앞쪽으로 이만큼 물들인다 */
const BAND_DEPTH = 4.0;

/**
 * 정지선과 밴드 사이의 간격 (m).
 * 밴드를 선에 붙이면 둘이 한 덩어리로 보여 정작 "어디가 정지선인지" 알 수 없다.
 */
const BAND_GAP = 1.2;

/** 진행 방향 차로가 차지하는 폭 */
const LANE_SPAN = ROAD_HALF_WIDTH - 0.5;

/**
 * 멈출 자리를 노면에 물들이는가 — 난이도 5(어려움)는 끈다 (challenge.ts 의 hints).
 * 정지선 자체는 그대로 또렷하게 그린다. "여기서 서라" 는 알림만 걷는다.
 */
let bandsEnabled = true;
export function setStopBands(on: boolean): void {
  bandsEnabled = on;
}

const AMBER = 0xffb020;
const GREEN = 0x2ee06a;

/**
 * 지금 겨누는 정지 지점. `zone` 은 진입부 어린이보호구역 횡단보도(S)의 정지선이다 —
 * 그 자리에는 노면에 따로 그린 정지선이 있어 여기서 띠를 얹지 않는다 (HUD 글자만 안내한다).
 */
export type StopTarget = 'line' | 'crosswalk' | 'zone';

export interface StopMarkerState {
  /** 지금 멈춰야 하는가 */
  required: boolean;
  /** 이번 정지 지점에서 이미 완전정지를 인정받았는가 */
  satisfied: boolean;
  target: StopTarget;
}

export class StopMarkers {
  readonly group = new THREE.Group();

  private lineMat: THREE.MeshBasicMaterial;
  private bandMatA: THREE.MeshBasicMaterial;
  private bandMatC: THREE.MeshBasicMaterial;
  private bandA: THREE.Mesh;
  private bandC: THREE.Mesh;
  private disposables: Array<{ dispose(): void }> = [];
  private pulse = 0;

  constructor() {
    const track = <T extends { dispose(): void }>(o: T): T => {
      this.disposables.push(o);
      return o;
    };

    // ── 정지선 (흰색) ────────────────────────────────────────────────────────
    // 노면 텍스처 위에 살짝 띄워 해상도와 무관하게 가장자리가 날카롭게 나오게 한다.
    // 조명 계산을 받지 않는 재질을 쓴다. 표준 재질은 그림자에 들어가면 회색이 되어
    // 정작 차가 다가와 그림자가 지는 순간 정지선이 흐려진다.
    // 실제 노면표시도 재귀반사 도료라 어두운 곳에서 더 또렷하게 보인다.
    this.lineMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    const lineGeo = track(new THREE.PlaneGeometry(LANE_SPAN, LINE_WIDTH));
    const line = new THREE.Mesh(lineGeo, this.lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(LANE_SPAN / 2 + 0.25, 0.015, STOP_LINE + LINE_WIDTH / 2);
    this.group.add(line);

    // ── 정지 구역 밴드 ───────────────────────────────────────────────────────
    // 가산 혼합으로 그려야 어두운 아스팔트 위에서 '빛을 비춘 것'처럼 보인다.
    // 일반 혼합이면 호박색이 노면 회색과 섞여 탁한 카키색이 된다.
    this.bandMatA = track(
      new THREE.MeshBasicMaterial({
        color: AMBER,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    const bandGeoA = track(new THREE.PlaneGeometry(LANE_SPAN, BAND_DEPTH));
    this.bandA = new THREE.Mesh(bandGeoA, this.bandMatA);
    this.bandA.rotation.x = -Math.PI / 2;
    this.bandA.position.set(
      LANE_SPAN / 2 + 0.25,
      0.012,
      STOP_LINE + LINE_WIDTH + BAND_GAP + BAND_DEPTH / 2,
    );
    this.group.add(this.bandA);

    // 우회전 후 횡단보도에는 정지선이 없다. 대신 멈춰야 할 구간을 물들인다.
    this.bandMatC = track(
      new THREE.MeshBasicMaterial({
        color: AMBER,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    const bandGeoC = track(new THREE.PlaneGeometry(BAND_DEPTH, LANE_SPAN));
    this.bandC = new THREE.Mesh(bandGeoC, this.bandMatC);
    this.bandC.rotation.x = -Math.PI / 2;
    this.bandC.position.set(
      CROSSWALK_INNER - BAND_GAP - BAND_DEPTH / 2,
      0.012,
      PLAYER_EXIT_Z + 0.4,
    );
    this.group.add(this.bandC);
  }

  update(state: StopMarkerState, dt: number): void {
    this.pulse = (this.pulse + dt) % 1.0;

    if (state.target === 'zone' || !bandsEnabled) {
      this.bandMatA.opacity = 0;
      this.bandMatC.opacity = 0;
      return;
    }
    const active = state.required || state.satisfied;
    const mat = state.target === 'line' ? this.bandMatA : this.bandMatC;
    const other = state.target === 'line' ? this.bandMatC : this.bandMatA;
    other.opacity = 0;

    if (!active) {
      mat.opacity = 0;
      return;
    }

    if (state.satisfied) {
      mat.color.setHex(GREEN);
      mat.opacity = 0.26;
    } else {
      // 점멸시켜 "여기서 멈춰라"를 놓치지 않게 한다
      const wave = 0.5 + 0.5 * Math.sin(this.pulse * Math.PI * 2);
      mat.color.setHex(AMBER);
      mat.opacity = 0.18 + wave * 0.24;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.group.clear();
  }
}
