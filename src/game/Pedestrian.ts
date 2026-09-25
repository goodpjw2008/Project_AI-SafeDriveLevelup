/**
 * 보행자.
 *
 * 판정 엔진이 쓰는 두 값을 만들어내는 것이 핵심 역할이다.
 *  - intendsToCross : **보행자가 통행 또는 통행하려 할 때** (제27조 제1항)
 *  - onConflictPath : 아직 **통행이 종료되지 않은** 상태 (차도 위에 있다)
 *
 * 보행자는 차를 피해 주지 않는다. 차가 밀고 들어오면 그대로 부딪힌다.
 * 그래야 "사람이 있으면 멈춘다"를 몸으로 익히게 된다.
 * 다만 이미 횡단보도에 진입한 차 앞으로 새로 걸어 나오지는 않는다(불합리한 실패 방지).
 */

import * as THREE from 'three';
import { CROSSWALK_INNER, CROSSWALK_OUTER,
  CROSSWALK_S_INNER,
  CROSSWALK_B_INNER,
  CROSSWALK_B_OUTER,
  CROSSWALK_S_OUTER,
  bikeLaneCenter,
  BIKE_SLOT_SHRINK,
} from '../layout';
import { PedWalk, type CarFront, type PedWalkContext } from './pedWalk';
import type { CrosswalkId, PedSignal, PedestrianSample } from '../rules/lawRules';
import type { PedSpawn } from '../scenarios/scenarios';

const CROSSWALK_CENTER = (CROSSWALK_INNER + CROSSWALK_OUTER) / 2;
/** 진입부 보호구역 횡단보도의 한가운데 (z) */
const CROSSWALK_S_CENTER = (CROSSWALK_S_INNER + CROSSWALK_S_OUTER) / 2;
const CROSSWALK_B_CENTER = (CROSSWALK_B_INNER + CROSSWALK_B_OUTER) / 2;

/**
 * 같은 보도에 선 사람들이 서로 겹치지 않도록 **횡단보도 폭 안에서** 자리를 어긋나게 둔다.
 *
 * 처음부터 보이게 하면서 생긴 문제다 — 예전에는 등장 시각이 서로 달라 한 자리에 겹칠 일이
 * 없었는데, 이제는 시나리오의 세 사람이 출발 전까지 같은 지점에 서 있어 몸이 포개진다.
 * 횡단보도 반폭이 2.0m 이므로 1.8m 까지는 선 밖으로 나가지 않는다.
 *
 * 보행자를 2.0배로 키우면서(SIZE_SCALE) 간격도 넓혔다 — 어깨너비가 0.8m 가까이 되어 예전
 * 간격(0.95m)으로는 옆 사람과 팔이 겹쳤다.
 */
const WAIT_SLOTS = [0, -1.15, 1.15, -1.8, 1.8];

/**
 * 보행자 크기 배율.
 *
 * 실제 키(어른 1.7m)로 그리면 **판단해야 하는 거리에서 너무 작다.** 우회전 후 만나는
 * 횡단보도는 정지선에서 22m 밖이고, 상공 시점에서는 70m 위에서 내려다본다.
 * 신호등을 3.0배로 키운 것과 같은 이유다 — 이 게임에서 보행자는 배경이 아니라
 * **판단의 근거**라, 있는지 없는지가 한눈에 보여야 한다.
 *
 * 1.5배(어른 2.5m)로 두었다가 **2.0배(어른 3.4m)로 키웠다** — 후방 시점에서 우회전 후
 * 횡단보도의 사람이 여전히 작아 "있는지" 를 한 번 더 찾아봐야 했다. 차(전고 1.4~1.5m)의
 * 두 배를 넘어 노면 위에서 바로 눈에 띈다.
 * 충돌 판정 반지름도 이 배율을 함께 따라가므로, 보이는 크기와 부딪히는 크기가 어긋나지 않는다.
 */
const SIZE_SCALE = 2.0;

/**
 * **엉덩이 높이** (배율 1 기준, m) — 다리가 여기서 땅까지 내려온다.
 *
 * 한때 다리가 이 높이에서 0.47m 만 내려와 **발끝이 땅에서 0.39m 위**에 있었다. 배율 2.0 이면 어른이 0.77m 떠 있는
 * 셈이라, 사용자가 "사람이 횡단보도 위로 공중에 떠 있는 것처럼 보여" 라고 짚었다. 발밑 원(ring)은 땅에 그려지니 원과
 * 발이 따로 놀아 더 떠 보였다. 머리 · 몸통은 키 1.67m 사람에 맞춰져 있었으므로 **다리만 땅까지 늘렸다** — 엉덩이가
 * 키의 절반쯤(0.86 / 1.67)인 실제 사람 비율이다.
 */
const HIP_HEIGHT = 0.8;
/**
 * **다리 굵기** (반지름, 배율 1 기준).
 *
 * 0.065 였을 때 길이(0.86)의 1/13 이라 **가늘고 길어 죽마처럼 보였다** — 사용자가 "다리가 너무 얇고 길다,
 * 손 비율과 두께에 맞춰 달라" 고 했다. 팔(0.06)의 1.6배로 굵히고 엉덩이를 조금 낮춰 길이를 줄였다.
 * 사람 다리는 팔보다 굵다 — 그 차이가 보여야 다리로 읽힌다.
 */
const LEG_RADIUS = 0.095;

/**
 * 아직 건널 뜻이 없는 사람이 **연석에서 물러서 있는** 거리 (m).
 *
 * ## 서 있는 자리가 곧 신호다
 *
 * 예전에는 건널 사람이나 아닌 사람이나 같은 자리(연석)에 같은 자세로 서 있었다. 그래서
 * 배경 차가 누군가를 보고 서면 **왜 서는지 화면에 아무 근거가 없었다** — 사람은 판이
 * 시작될 때부터 거기 그러고 서 있었으니까. 반대로 신호가 적색이라 건너지 않을 사람도
 * 똑같이 연석에 붙어 서 있어, 운전자로서는 "저 사람이 나올까" 를 자세로 읽을 수 없다.
 *
 * 이제 **뜻이 있는 사람만 연석까지 나와 선다** (pedWalk.ts 의 `INTENT_LEAD`). 뜻이
 * 생기는 순간 한 걸음 나서는 동작이 보이고, 그 뒤로는 차도 가장자리에 붙어 서 있다.
 * 멀리서 놓쳤더라도 **선 자리만으로** 읽히는 것이 요점이다 — 그 순간의 동작을 보아야만
 * 알 수 있는 신호는 하필 그때 다른 곳을 보고 있던 사람에게 아무것도 아니다.
 *
 * 0.8m 는 사람 어깨너비보다 넓어 나란히 선 둘 사이에서도 앞뒤가 갈린다.
 */
export const WAIT_SETBACK = 0.8;

/** 연석까지 한 걸음 나서는 데 걸리는 시간 (초) */
const STEP_UP_TIME = 0.55;

/*
  ── 머리 위 느낌표 ─────────────────────────────────────────────────────────

  **건너려는 사람 머리 위에 느낌표를 띄운다.** AI 코치의 말풍선이 "보행자가 건너려는 것
  같아요" 라고 말해도, 그게 **어느 사람인지**는 화면에서 다시 찾아야 했다. 사람 위에 바로
  표시가 뜨면 말과 대상이 한눈에 이어진다.

  판정과 **같은 값**으로 켠다 (`intendsToCross` · `state` · `onConflictPath`) —
    - 주황 `!` : 연석까지 나와 건너려는 사람 (제27조 제1항의 "통행하려고 하는 때")
    - 빨강 `!` : 이미 차도 위를 건너는 사람 (통행이 끝날 때까지 기다려야 한다)
  보행신호를 지키느라 서 있기만 하는 사람에게는 띄우지 않는다 — 그 사람은 지금 건널 뜻이
  없고, 그런 사람까지 표시하면 느낌표가 늘 떠 있어 아무것도 알려 주지 못한다.
*/

/**
 * 느낌표의 크기 — **화면 기준**이다 (거리에 따라 작아지지 않는다).
 *
 * 처음에는 0.7m 짜리를 세상에 두었다. 가까운 사람 위에서는 충분했지만, 우회전 후 횡단보도의
 * **건너편**(30m 넘게 떨어진 보도)에서 건너오는 사람 위에서는 점만 하게 줄어, 정작 가장 먼저
 * 알아야 할 사람을 놓쳤다. 화면 기준으로 두면 어디에 있든 같은 크기로 눈에 들어온다.
 *
 * 값은 **카메라에서 1m 떨어졌을 때의 크기(m)** 다 — `faceCamera` 가 거리에 비례해 키우므로
 * 화면에서는 어디서나 같은 크기(높이의 약 4%)로 맺힌다. 한때 three 의 스프라이트가 이 계산을
 * 대신 해 줬는데, 같은 값을 그대로 쓰도록 맞춰 두었다 (`faceCamera` 주석 참고).
 * (처음에 6% 로 두었더니 사람보다 느낌표가 커서 너무 크다는 말을 들었다)
 */
const ALERT_SIZE = 0.055;
/** 건너는 중(빨강)일 때 맥박처럼 커졌다 작아지는 폭 — 멈춰 선 그림보다 움직이는 것이 먼저 눈에 든다 */
const ALERT_PULSE = 0.22;
/** 발밑 원의 반지름 (m, 사람 배율 곱하기 전) — 사람이 작게 보이거나 일부 가려져도 자리가 보인다 */
const RING_RADIUS = 0.62;
/** 머리 꼭대기에서 띄우는 높이 (m) */
const ALERT_LIFT = 0.55;
/** 알림 색 — 주황: 건너려 함 · 빨강: 건너는 중 */
const ALERT_AMBER = '#ffcb5c';
const ALERT_RED = '#ff453a';

/** 느낌표 그림 — 모든 보행자가 나눠 쓴다 (한 판에 사람이 여럿이라 매번 굽지 않는다) */
/**
 * 머리 위 느낌표를 띄우는가 — 난이도 5(어려움)는 끈다 (challenge.ts 의 hints).
 * 끄면 보행자가 건너려는지를 **몸짓(연석으로 나옴 · 발을 뗌)으로 직접 읽어야** 한다.
 */
let alertsEnabled = true;
export function setPedestrianAlerts(on: boolean): void {
  alertsEnabled = on;
}


let alertTextures: { intending: THREE.DataTexture; crossing: THREE.DataTexture } | null = null;

/** 느낌표 그림의 한 변 (px). 2의 거듭제곱이라 어느 기기에서나 밉맵이 곱게 만들어진다 */
const ALERT_TEX = 128;

/** `#rrggbb` 를 0~255 세 값으로 */
function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 가장자리를 1px 에 걸쳐 부드럽게 — 거리(px)가 음수면 안, 양수면 밖이다.
 * 이것이 없으면 원 둘레가 계단처럼 보인다 (캔버스의 안티에일리어싱을 손으로 대신하는 것).
 */
function coverage(dist: number): number {
  return Math.min(1, Math.max(0, 0.5 - dist));
}

/** 세로 막대(끝이 둥근)까지의 거리 — 느낌표의 몸통을 그리는 데 쓴다 */
function barDist(x: number, y: number, cx: number, y0: number, y1: number, r: number): number {
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return Math.hypot(x - cx, dy) - r;
}

/**
 * 느낌표 그림 — **그림판(canvas)이 아니라 숫자로 직접 굽는다.**
 *
 * 예전에는 `document.createElement('canvas')` 에 `arc` 와 `fillText('!')` 로 그렸다.
 * 사용자의 휴대폰에서 이 표시가 **위와 왼쪽이 잘린 모양**으로 나왔는데(두 번의 화면 캡처가
 * 똑같았다), PC·노트북·실제 GPU 어디서도 재현되지 않았다. 캔버스로 굽는 길에는 기기마다
 * 달라지는 조각이 둘 있다 — **브라우저의 캔버스 래스터라이저**와 **웹폰트(`Pretendard Variable`)**.
 * 둘 다 걷어내면 원인을 못 찾아도 증상이 사라진다. 같은 판단을 이미 한 번 했다
 * (CarMesh 의 `makeGlowTexture` — "캔버스를 걷어내면서").
 *
 * 화면이 없는 곳(테스트)에서도 그대로 만들어진다 — 순수한 계산이라 `document` 가 필요 없다.
 * 예전에는 캔버스를 못 만들면 `null` 이었는데, 이제 그럴 일이 없다.
 */
export function alertTexture(kind: 'intending' | 'crossing'): THREE.DataTexture {
  if (!alertTextures) {
    const make = (fill: string, ink: string): THREE.DataTexture => {
      const N = ALERT_TEX;
      const half = N / 2;
      const [fr, fg, fb] = rgbOf(fill);
      const [ir, ig, ib] = rgbOf(ink);
      const data = new Uint8Array(N * N * 4);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          // 픽셀 중심에서 잰다 — 모서리에서 재면 그림이 반 픽셀 치우친다 (makeGlowTexture 와 같다)
          const px = x + 0.5;
          /*
            **세로는 뒤집어 잰다.** DataTexture 의 첫 줄은 그림의 **아래**다(OpenGL 규약) —
            캔버스와 반대라, 그대로 두면 느낌표의 점이 위로 올라가 'i' 처럼 보인다.
            여기서 한 번 뒤집어 두면 아래 좌표는 사람이 그림을 읽는 대로(위 → 아래) 쓸 수 있다.
          */
          const py = N - (y + 0.5);
          const rad = Math.hypot(px - half, py - half);
          // 바깥 테두리(어두운 띠) → 알맹이 → 느낌표 차례로 덮는다
          const outer = coverage(rad - 60);
          const inner = coverage(rad - 52);
          const stroke = Math.max(0, outer - inner);
          /*
            몸통과 점 사이를 넉넉히 띄운다 — 멀리 있는 사람 위에서는 그림이 128px → 40px 남짓으로
            줄어드는데, 사이가 좁으면 둘이 한 막대로 뭉쳐 느낌표로 읽히지 않는다.
          */
          const mark = Math.max(
            coverage(barDist(px, py, half, 32, 70, 6.5)),
            coverage(Math.hypot(px - half, py - 98) - 8.5),
          );
          let r = fr * inner + 10 * stroke;
          let g = fg * inner + 12 * stroke;
          let b = fb * inner + 18 * stroke;
          let a = inner + stroke * 0.85;
          // 느낌표는 알맹이 위에만 얹는다 — 테두리 밖으로 비어져 나가면 글자가 떠 보인다
          const m = mark * inner;
          r = r * (1 - m) + ir * m;
          g = g * (1 - m) + ig * m;
          b = b * (1 - m) + ib * m;
          a = Math.max(a, m);
          const i = (y * N + x) * 4;
          data[i] = Math.round(r);
          data[i + 1] = Math.round(g);
          data[i + 2] = Math.round(b);
          data[i + 3] = Math.round(Math.min(1, a) * 255);
        }
      }
      const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
      /*
        **필터를 손으로 정한다.** DataTexture 의 기본은 NearestFilter 라, 그대로 두면
        멀리 있는 사람 위에서 테두리가 지글거린다 (makeGlowTexture 와 같은 자리).
      */
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    };
    // 색은 AI 말풍선의 보행자 알림과 같다 (index.html 의 .ped-cue)
    alertTextures = { intending: make(ALERT_AMBER, '#1b1300'), crossing: make(ALERT_RED, '#ffffff') };
  }
  return alertTextures[kind];
}

/** `faceCamera` 가 그릴 때마다 쓰는 자리 — 매번 새로 만들면 쓰레기가 쌓인다 */
const FORWARD = new THREE.Vector3();
const WORLD = new THREE.Vector3();
const CAM_POS = new THREE.Vector3();
const CAM_Q = new THREE.Quaternion();

const SKIN = [0xf0c8a0, 0xd9a066, 0xa8703c, 0xf5d5b8];
const CLOTHES = [0x2f4f8f, 0xb3453a, 0x2e6b4f, 0x6b4a8f, 0x333940, 0xc9752b];

/**
 * 화면에 서는 보행자.
 *
 * **판단 로직은 여기 없다** — pedWalk.ts 의 `PedWalk` 이 상태를 굴리고, 이 클래스는 그
 * 상태를 몸에 입혀 그린다. 시나리오 검증기(scenarios/validate.ts)가 3D 없이 같은 상태기계를
 * 돌려야 하는데, 두 구현이 갈라지면 **검증이 조용히 거짓말을 하기** 때문이다.
 */
export class Pedestrian {
  readonly group = new THREE.Group();
  readonly crosswalk: CrosswalkId;
  /** 자전거를 가진 사람인가 (scenarios.ts 의 `PedSpawn.bike`) — 그리는 모습과 다리 흔들림이 달라진다 */
  private readonly bike?: 'ride' | 'push';

  /** 상태기계 — 화면과 검증기가 나눠 쓰는 한 벌 */
  private readonly walk: PedWalk;

  /** 횡단보도 폭 안에서의 좌우 어긋남 (m) — 같은 보도에 선 사람끼리 겹치지 않게 */
  private offset: number;
  private scale: number;
  private walkPhase = 0;
  /** 연석에서 물러선 정도 (1 = 물러서 있음, 0 = 연석까지 나와 있음) */
  private setback = 1;
  /**
   * 머리 위 느낌표 — 건너려 하거나 건너는 동안만 뜬다.
   *
   * **스프라이트가 아니라 판 하나다.** 아래 `faceCamera` 가 직접 카메라 쪽으로 돌려세우고
   * 거리에 맞춰 키운다 (그 까닭은 거기 주석에 적었다).
   */
  private alert: THREE.Mesh | null = null;
  /** 이번 프레임의 맥박 배율 — 크기는 `faceCamera` 가 거리를 알아야 정할 수 있다 */
  private alertBeat = 1;
  /** 발밑 원 — 느낌표와 같이 켜지고 같은 색이다 */
  private ring: THREE.Mesh | null = null;
  private alertKind: 'intending' | 'crossing' | null = null;
  private alertPhase = Math.random() * Math.PI * 2;
  /** 몸 전체 — 걸을 때 다리를 벌린 만큼 내려 발이 땅에 붙게 한다 (poseLimbs). 느낌표 · 발밑 원은 여기 밖이다 */
  private readonly body = new THREE.Group();
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private disposables: Array<{ dispose(): void }> = [];

  /**
   * @param slot 같은 보도에서 몇 번째로 서는 사람인가 (자리를 어긋나게 두는 데만 쓴다)
   */
  constructor(spawn: PedSpawn, slot = 0) {
    this.walk = new PedWalk(spawn);
    this.offset = WAIT_SLOTS[slot % WAIT_SLOTS.length];
    this.crosswalk = spawn.crosswalk;

    this.bike = spawn.bike;
    const kind = spawn.kind ?? 'adult';
    this.scale = (kind === 'child' ? 0.66 : kind === 'elder' ? 0.92 : 1) * SIZE_SCALE;

    this.build();
    /*
      **처음부터 보이게 둔다.** 예전에는 등장 시각까지 숨겨 두었는데, 그러면 우회전을
      시작하는 순간 사람이 허공에서 튀어나온다 — 멀리서 미리 알아보고 판단할 기회가 없다.
      실제 도로에서도 보행자는 신호를 기다리며 **보도에 서 있는 모습으로 먼저 보인다.**
      등장 시각(spawn.at)은 이제 '나타나는 때'가 아니라 **건너기 시작하는 때**다.
    */
    this.group.visible = true;
    this.syncTransform();
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private build(): void {
    const clothes = this.track(
      new THREE.MeshStandardMaterial({
        color: CLOTHES[Math.floor(Math.random() * CLOTHES.length)],
        roughness: 0.85,
      }),
    );
    const skin = this.track(
      new THREE.MeshStandardMaterial({
        color: SKIN[Math.floor(Math.random() * SKIN.length)],
        roughness: 0.9,
      }),
    );
    const pants = this.track(new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.9 }));

    const s = this.scale;
    this.group.add(this.body);

    // 엉덩이를 낮춘 만큼 몸통을 아래로 늘린다 — 안 그러면 허리에 틈이 생긴다 (위 HIP_HEIGHT)
    const torso = new THREE.Mesh(
      this.track(new THREE.CapsuleGeometry(0.16 * s, 0.46 * s, 4, 10)),
      clothes,
    );
    torso.position.y = 1.13 * s;
    torso.castShadow = true;
    this.body.add(torso);

    const head = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.125 * s, 14, 12)), skin);
    head.position.y = 1.54 * s;
    head.castShadow = true;
    this.body.add(head);

    const armGeo = this.track(new THREE.CapsuleGeometry(0.06 * s, 0.36 * s, 3, 8));
    // 다리는 엉덩이에서 **땅까지** — 캡슐의 둥근 양 끝을 합쳐 길이가 엉덩이 높이와 같다 (위 HIP_HEIGHT)
    const legGeo = this.track(
      new THREE.CapsuleGeometry(LEG_RADIUS * s, (HIP_HEIGHT - 2 * LEG_RADIUS) * s, 3, 8),
    );
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      // 굵어진 만큼 두 다리를 조금 벌린다 — 붙여 두면 한 덩어리로 보인다
      pivot.position.set(side * 0.105 * s, HIP_HEIGHT * s, 0);
      const leg = new THREE.Mesh(legGeo, pants);
      leg.position.y = -(HIP_HEIGHT / 2) * s;
      leg.castShadow = true;
      pivot.add(leg);
      this.body.add(pivot);
      this.legs.push(pivot);

      const armPivot = new THREE.Group();
      armPivot.position.set(side * 0.2 * s, 1.3 * s, 0);
      const arm = new THREE.Mesh(armGeo, clothes);
      arm.position.y = -0.22 * s;
      armPivot.add(arm);
      this.body.add(armPivot);
      this.arms.push(armPivot);
    }

    if (this.bike) this.buildBike();
  }

  /**
   * **자전거** — 타고 건너는 사람(`ride`)과 끌고 건너는 사람(`push`) 모두 자전거를 가졌다.
   *
   * 운전자가 **한눈에 자전거인지 알아봐야** 이 판이 성립한다 — 타고 건너는 자전거는 걸음의 두 배 넘게
   * 빠르고(pedWalk.ts), 끌고 가는 사람은 보행자라 판정이 다르다. 그래서 크게, 그리고 **몸과 다른
   * 색**으로 그린다.
   *
   * 자리도 둘이 다르다. 타고 있으면 자전거가 **몸 아래**에 있고, 끌고 있으면 **옆에** 있다 —
   * 멀리서도 그 차이가 보이도록 옆으로 뺀 거리를 넉넉히 준다.
   */
  private buildBike(): void {
    const s = this.scale;
    const metal = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1f6fb5, roughness: 0.45, metalness: 0.5 }),
    );
    const tyre = this.track(new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.85 }));
    const g = new THREE.Group();
    const R = 0.34 * s;

    // 바퀴 둘 — 진행 방향(x축)으로 굴러가므로 원판을 세워 z축을 축으로 둔다
    const wheelGeo = this.track(new THREE.TorusGeometry(R, 0.05 * s, 8, 20));
    for (const dx of [-0.52 * s, 0.52 * s]) {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.position.set(dx, R, 0);
      g.add(w);
    }
    // 프레임 — 두 바퀴를 잇는 대각선 둘과 안장 기둥
    const barGeo = this.track(new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 1.0 * s, 6));
    for (const [y, rot] of [
      [0.62 * s, Math.PI / 2 - 0.35],
      [0.42 * s, Math.PI / 2 + 0.2],
    ] as const) {
      const bar = new THREE.Mesh(barGeo, metal);
      bar.position.set(0, y, 0);
      bar.rotation.z = rot;
      g.add(bar);
    }
    const post = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.04 * s, 0.04 * s, 0.5 * s, 6)),
      metal,
    );
    post.position.set(-0.3 * s, 0.72 * s, 0);
    g.add(post);
    // 핸들 — 앞바퀴 위로 가로지른다
    const bar = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.46 * s, 6)),
      metal,
    );
    bar.position.set(0.52 * s, 0.92 * s, 0);
    bar.rotation.x = Math.PI / 2;
    g.add(bar);

    /*
      **자전거는 사람이 걷는 방향으로 굴러간다.**

      바퀴를 x 축으로 늘어놓고 그렸는데, 사람 모형의 **앞은 local +z** 다 (syncTransform 이 그 축으로
      돌려 세운다). 그대로 두었더니 자전거가 걷는 방향과 90° 어긋나 **뒤에서 보는 모습**이 됐다 —
      사용자가 짚었다: "처음에는 옆면이 보여서 끌고 가는 것처럼 보였는데 사람이 움직일수록 뒷면으로
      바뀌어서 끌고 가는 것처럼 보이지 않아."

      -90° 로 돌리면 앞바퀴(x+)가 앞(z+)으로 간다 — 핸들도 사람 앞에 온다.
    */
    g.rotation.y = -Math.PI / 2;
    if (this.bike === 'ride') {
      /*
        **타고 있으면 자전거가 몸 아래에 있다.** 몸통을 안장 높이까지 올리고 다리는 흔들지 않는다
        (poseLimbs — 탄 사람은 걷지 않는다). 몸을 앞으로 조금 숙여 '달리는 중' 으로 보이게 한다.
      */
      this.body.position.y = 0.52 * s;
      this.body.rotation.z = -0.12;
    } else {
      // 끌고 있으면 **옆에** 세워 잡고 간다 — 걷는 방향과 직각인 쪽(local x)으로 뺀다
      g.position.x = 0.45 * s;
    }
    this.group.add(g);
  }

  /** 상태기계의 축 좌표를 실제 3D 위치로 반영 */
  private syncTransform(): void {
    /*
      **물러선 만큼 진행 방향의 반대로 민다.** 상태기계의 축 좌표는 손대지 않는다 —
      판정(통행 의사·차도 위인가)은 그쪽이 만들고, 여기서 좌표를 바꾸면 검증기와 갈라진다.
      나와 선 자리(setback = 0)가 곧 상태기계의 출발 자리라, 걷기 시작하는 순간
      이어 붙는 곳이 없다.
    */
    const axis = this.walk.axis - this.walk.dir * WAIT_SETBACK * this.setback;
    const dir = this.walk.dir;
    /*
      **S · B 는 A 와 같은 방향으로 걷는다** — 셋 다 남북 도로를 가로지르므로 x 축으로 간다.
      다른 것은 자리 하나뿐이다 (layout.ts 의 CROSSWALK_* — S 68 · A 16.8 · B -38).
    */
    const across = this.across();
    if (this.crosswalk === 'S' || this.crosswalk === 'A' || this.crosswalk === 'B') {
      // 남북 도로를 가로지름 — x축으로 이동
      this.group.position.set(axis, 0, across);
      this.group.rotation.y = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      // 동서 도로를 가로지름 — z축으로 이동
      this.group.position.set(across, 0, axis);
      this.group.rotation.y = dir === 1 ? Math.PI : 0;
    }
  }

  /**
   * **건너는 자리** (건너는 축과 직각인 좌표) — 보통은 횡단보도 줄무늬 한가운데다.
   *
   * **타고 건너는 자전거만 자전거횡단도 위**로 간다 (제15조의2 제3항). 내려서 끌고 가는 사람은
   * 보행자이므로(제2조 제17호) 줄무늬 위로 건넌다 — 두 사람이 **다른 자리로 건너는 것**이 곧
   * 이 판이 가르치는 규칙이라, 그림에서 갈라져야 말이 된다.
   *
   * 자리를 여기 한 곳에서 내는 까닭은 **부딪힘 검사도 같은 값을 봐야** 하기 때문이다
   * (scenarios/playSim.ts 에 같은 셈이 있다 — 한쪽만 옮기면 보이는 자리와 부딪히는 자리가 갈린다).
   */
  private across(): number {
    if (this.bike === 'ride') {
      return bikeLaneCenter(this.crosswalk) + this.offset * BIKE_SLOT_SHRINK;
    }
    const center =
      this.crosswalk === 'S'
        ? CROSSWALK_S_CENTER
        : this.crosswalk === 'B'
          ? CROSSWALK_B_CENTER
          : CROSSWALK_CENTER;
    return center + this.offset;
  }

  /**
   * 한 프레임. **판단은 `PedWalk` 이 하고, 여기서는 그 결과를 그린다.**
   *
   * `trafficBusy` — 내 횡단보도를 코앞에 두고 달려오는 NPC 차가 있는가 (pedWalk.ts 참고).
   */
  update(
    t: number,
    dt: number,
    signal: PedSignal | null,
    carFront: CarFront,
    carMoving: boolean,
    trafficBusy = false,
    ctx: PedWalkContext = {},
  ): void {
    if (this.walk.done) return;

    this.walk.update(t, dt, signal, carFront, carMoving, trafficBusy, ctx);

    const s = this.walk.sample();
    /*
      **건널 뜻이 있으면 연석까지 나선다.** 되돌아가기도 한다 — 보행신호가 녹색점멸로
      바뀌면 새로 건너지 않는 사람이 되므로(pedWalk 의 isVisiblyWaiting) 한 걸음 물러선다.
    */
    const wantsCurb = s.state !== 'waiting' || s.intendsToCross;
    const before = this.setback;
    const step = dt / STEP_UP_TIME;
    this.setback = wantsCurb
      ? Math.max(0, this.setback - step)
      : Math.min(1, this.setback + step);

    if (s.state === 'crossing') {
      // 걷는 동작 — 상태기계가 실제로 나아간 뒤에만 팔다리를 흔든다
      this.walkPhase += dt * this.walk.speed * 4.5;
      this.poseLimbs(Math.sin(this.walkPhase) * 0.5);
    } else if (this.setback !== before) {
      // 연석으로 나서는(또는 물러서는) 한 걸음 — 실제로 움직이는 동안만 흔든다
      this.walkPhase += dt * 7;
      this.poseLimbs(Math.sin(this.walkPhase) * 0.35);
    } else if (s.imminent) {
      /*
        **빨간 느낌표가 뜨면 몸이 먼저 움직인다.** 빨강은 반 박자 뒤에 발이 나간다는 신호인데(pedWalk 의
        `RED_BEAT`), 머리 위 표시만 바뀌고 몸이 그대로면 운전자는 그 반 박자를 읽지 못한다. 발을 크게
        바꿔 디뎌 **나설 채비**가 보이게 한다 — 걷는 동작(0.5)보다는 작아 "이미 건너는 중" 으로 읽히지 않는다.
      */
      this.walkPhase += dt * 5;
      this.poseLimbs(Math.sin(this.walkPhase) * 0.22);
    } else if (s.intendsToCross) {
      /*
        **나와 선 뒤에는 발을 바꿔 딛는다.** 가만히 서 있으면 멀리서는 표지판과 다를 바가
        없다. 크게 흔들면 걷는 것으로 보여 "이미 건너는 중" 으로 읽히므로 작게만 준다.
      */
      this.walkPhase += dt * 2.4;
      this.poseLimbs(Math.sin(this.walkPhase) * 0.09);
    } else {
      this.poseLimbs(0);
    }

    /*
      **빨강은 "곧 발을 뗀다" 부터다** (pedWalk.ts 의 IMMINENT_LEAD). 차도에 들어선 뒤에야
      빨강이 되면 이미 늦다 — 운전자에게 필요한 것은 "곧 나온다" 는 예고다.
    */
    this.updateAlert(
      (s.state === 'crossing' && s.onConflictPath) || s.imminent
        ? 'crossing'
        : s.state === 'waiting' && s.intendsToCross
          ? 'intending'
          : null,
      dt,
    );

    if (this.walk.done) this.group.visible = false;
    this.syncTransform();
  }

  /** 머리 위 느낌표를 켜고 끈다 (위 `ALERT_SIZE` 주석) */
  private updateAlert(kind: 'intending' | 'crossing' | null, dt: number): void {
    const map = kind && alertsEnabled ? alertTexture(kind) : null;
    if (!kind || !map) {
      if (this.alert) this.alert.visible = false;
      if (this.ring) this.ring.visible = false;
      this.alertKind = null;
      return;
    }
    if (!this.alert) {
      this.alert = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(1, 1)),
        this.track(
          new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            // 앞의 차·기둥에 가려져도 보이게 — 이 표시는 "저기 사람이 있다" 를 말하는 것이다
            depthTest: false,
            toneMapped: false,
          }),
        ),
      );
      this.alert.renderOrder = 6;
      /*
        크기를 그리기 직전에 정하므로, 잘라 낼지 말지를 재는 **지난 프레임 크기**로는 판단이
        어긋난다 — 표시는 몇 개 안 되니 잘라 내지 않는다.
      */
      this.alert.frustumCulled = false;
      this.alert.onBeforeRender = (_r, _s, camera) => this.faceCamera(camera);
      this.group.add(this.alert);

      /*
        **발밑 원.** 느낌표는 머리 위라 사람과 조금 떨어져 있다 — 멀리서는 느낌표와 사람이
        이어져 보이지 않을 때가 있다. 발밑에 같은 색 원이 있으면 "이 사람" 이 한눈에 묶인다.
      */
      const r = RING_RADIUS * this.scale;
      this.ring = new THREE.Mesh(
        this.track(new THREE.RingGeometry(r * 0.72, r, 32)),
        this.track(
          new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
          }),
        ),
      );
      this.ring.rotation.x = -Math.PI / 2;
      this.ring.position.y = 0.04;
      this.ring.renderOrder = 5;
      this.group.add(this.ring);
    }
    if (kind !== this.alertKind) {
      (this.alert.material as THREE.MeshBasicMaterial).map = map;
      (this.alert.material as THREE.MeshBasicMaterial).needsUpdate = true;
      (this.ring!.material as THREE.MeshBasicMaterial).color.set(
        kind === 'crossing' ? ALERT_RED : ALERT_AMBER,
      );
      this.alertKind = kind;
    }
    this.alert.visible = true;
    this.ring!.visible = true;

    /*
      살짝 들썩이고, **건너는 중이면 맥박처럼 커졌다 작아진다.** 멈춰 선 그림보다 움직이는 것이
      먼저 눈에 든다 — 빨강은 지금 내 앞길로 걸어오고 있다는 뜻이라 더 급하다.
    */
    this.alertPhase += dt * 5;
    const head = (1.54 + 0.125) * this.scale;
    this.alert.position.y = head + ALERT_LIFT + Math.sin(this.alertPhase) * 0.06;
    this.alertBeat =
      kind === 'crossing' ? 1 + ALERT_PULSE * (0.5 + 0.5 * Math.sin(this.alertPhase * 1.6)) : 1;
    (this.ring!.material as THREE.MeshBasicMaterial).opacity =
      0.55 + 0.35 * (0.5 + 0.5 * Math.sin(this.alertPhase * 1.6));
  }

  /**
   * **머리 위 느낌표를 카메라 쪽으로 돌려세우고, 거리에 맞춰 키운다.**
   *
   * 예전에는 three 의 `Sprite`(`sizeAttenuation: false`)가 이 둘을 대신 해 줬다. 그런데
   * 사용자의 휴대폰에서만 이 표시가 **세로로 늘어진 방패 모양**으로 나왔다 — 세 번의 화면 캡처가
   * 같은 모양이었고, PC · 노트북 · 실제 GPU 어디서도 재현되지 않았다. 그림을 캔버스에서 숫자
   * 계산으로 바꿔도 그대로였으니, 남은 것은 **스프라이트를 그리는 길**뿐이었다.
   *
   * 그래서 그 길을 걷어냈다. 판 하나를 놓고 카메라의 방향을 그대로 베껴 돌려세우면 늘 정면으로
   * 맺히고, 거리에 비례해 키우면 화면에서 **늘 같은 크기**가 된다 (멀리 있는 사람 위에서도 점만
   * 해지지 않게 하려고 스프라이트를 쓴 까닭이 이것이었다 — `ALERT_SIZE` 주석 참고).
   *
   * **그리기 직전에, 그리는 카메라마다 따로** 한다 (`onBeforeRender`). 한 판을 그리는 카메라는
   * 하나가 아니다 — 본 화면 · 거울 · 시야 창이 저마다 다른 자리에서 본다. 한 번만 맞춰 두면
   * 나머지 창에서는 비스듬히 서 버린다.
   */
  private faceCamera(camera: THREE.Camera): void {
    const mark = this.alert;
    if (!mark) return;
    CAM_POS.setFromMatrixPosition(camera.matrixWorld);
    CAM_Q.setFromRotationMatrix(camera.matrixWorld);
    /*
      **어미(this.group)의 회전을 되돌린 뒤 카메라 방향을 얹는다.** 사람은 건너는 쪽을 보고
      서 있어서 어미가 이미 돌아가 있다 — 그대로 넣으면 그만큼 어긋난다.
      (어미는 장면에 바로 붙으므로 어미의 회전이 곧 세상에서의 회전이다.)
    */
    mark.quaternion.copy(this.group.quaternion).invert().multiply(CAM_Q);
    /*
      **카메라 정면 축으로 잰 거리**에 비례해 키운다. 눈에서의 직선 거리로 재면 화면 가장자리에
      있는 사람의 표시가 가운데 있는 사람보다 커져, 멀고 가까움이 거꾸로 읽힌다.
    */
    FORWARD.set(0, 0, -1).applyQuaternion(CAM_Q);
    WORLD.set(this.group.position.x, mark.position.y, this.group.position.z).sub(CAM_POS);
    const size = ALERT_SIZE * Math.max(0.01, WORLD.dot(FORWARD)) * this.alertBeat;
    mark.scale.set(size, size, 1);
    /*
      **손으로 행렬을 다시 맞춘다.** `onBeforeRender` 는 장면의 행렬이 이미 계산된 뒤에 불린다 —
      여기서 바꾼 것을 알려 주지 않으면 지난 프레임 값으로 그려진다.
    */
    mark.updateMatrix();
    if (mark.parent) mark.matrixWorld.multiplyMatrices(mark.parent.matrixWorld, mark.matrix);
  }

  /** 팔다리를 한 자세로 맞춘다 — 걷기·한 걸음·발 바꿔 딛기가 모두 이 한 곳을 지난다 */
  private poseLimbs(swing: number): void {
    /*
      **타고 있는 사람은 걷지 않는다** — 페달을 밟는 다리는 앞뒤가 아니라 위아래로 움직이므로,
      걷는 자세를 그대로 쓰면 안장 위에서 다리가 허공을 젓는다. 발을 페달에 얹은 한 자세로 둔다.
    */
    if (this.bike === 'ride') {
      this.legs[0].rotation.x = 0.5;
      this.legs[1].rotation.x = -0.2;
      this.arms[0].rotation.x = -0.7;
      this.arms[1].rotation.x = -0.7;
      return;
    }
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.7;
    this.arms[1].rotation.x = swing * 0.7;
    /*
      **다리를 벌린 만큼 몸을 내린다.** 두 다리가 엉덩이에서 같은 각도로 앞뒤로 벌어지면 두 발이 함께 들려(걸을 때
      최대 0.5rad 면 배율 2.0 에서 0.2m) 걷는 동안 다시 떠 보인다. 그만큼 내리면 발이 늘 땅에 닿고, 걸음마다 몸이
      살짝 오르내리는 것도 실제 걸음과 같다.
    */
    this.body.position.y = -HIP_HEIGHT * this.scale * (1 - Math.cos(swing));
  }

  /**
   * 판정 엔진에 넘길 표본.
   *
   * 판정에 쓰이는 두 값(`intendsToCross` · `onConflictPath`)은 **상태기계가 만든 것을
   * 그대로 넘긴다.** 여기서 다시 계산하면 검증기와 갈라진다.
   *
   * 나머지는 화면용이다 — `state`·`signal` 은 주행 기록에 "왜 이 사람이 걸렸는지" 를
   * 적기 위한 것이고, `active`·`x`·`z` 는 결과 화면 지도에 발자국을 그리기 위한 것이다.
   */
  sample(): PedestrianSample {
    const s = this.walk.sample();
    return {
      crosswalk: s.crosswalk,
      bike: s.bike,
      intendsToCross: s.intendsToCross,
      onConflictPath: s.onConflictPath,
      state: s.state,
      signal: s.signal,
      // 결과 지도에 그리는 것은 '상황에 참여한 뒤'의 발자국이다 — 서서 기다리는 동안은 뺀다
      active: s.active && this.group.visible,
      x: this.group.position.x,
      z: this.group.position.z,
    };
  }

  /** 차량과의 충돌 판정 (원-원 근사) */
  hits(carX: number, carZ: number, radius: number): boolean {
    if (!this.group.visible || this.walk.done) return false;
    const p = this.group.position;
    return Math.hypot(p.x - carX, p.z - carZ) < radius + 0.35 * this.scale;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
