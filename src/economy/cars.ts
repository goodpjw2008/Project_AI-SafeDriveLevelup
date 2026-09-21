/**
 * 차량 카탈로그.
 *
 * **3D 모델이 있는 차만 넣는다.** 차 id 가 곧 모델 파일 이름이다 —
 * `assets/cars/<id>/` 에 원본을 풀고 `npm run assets` 를 돌리면
 * `public/models/<id>.glb` 가 나오고, 여기 같은 id 로 한 항목만 추가하면 끝이다.
 * (모델이 없는 id 를 넣으면 그 차만 절차적 차체로 그려진다)
 *
 * 이 시뮬레이터는 신호 준수와 상황 판단을 가르치는 것이 목적이라 주행 속도는 고정이고,
 * 차종에 따라 가속·제동이 달라지지 않는다. 차량은 성능이 아니라 **안전운전의 보상**이다.
 * 그래서 차종별로 달라지는 것은 외형(치수·루프라인·색)과 엔진음뿐이다.
 *
 * 차량 선택 화면의 사진은 사용자가 직접 등록한 것뿐이다(저장 데이터에만 있다).
 * 주행 화면의 차체는 Sketchfab 모델(carModel.ts)이고, 모델을 읽기 전·못 읽었을 때만
 * CarMesh.ts 의 프로시저럴 메시로 그린다 — 아래 dims/색상 파라미터가 그 값이다.
 *
 * **전폭만 실차의 0.82배로 줄여 두었다.** 실차 전폭(1.4~1.97m)은 차로 폭 3.25m 의
 * 43~61% 라 법규상 아무 문제가 없지만, 게임에서는 우회전 궤적을 눈으로만 맞춰야 하는데
 * 운전석 시점의 넓은 화각(74°) 때문에 차폭 감각이 과장돼 차선을 넘기 쉽다.
 * 폭을 줄이면 차로 양쪽 여유가 0.6~0.9m → 0.8~1.05m 로 늘어 궤적을 잡을 여지가 생긴다.
 * (전장·전고는 실차 그대로다 — 폭만 줄여야 시점 높이와 보닛 길이 감각이 유지된다)
 */

import type { Difficulty } from '../scenarios/curriculum';

export interface CarSpec {
  id: string;
  /** 실제 차량명 (국문) */
  name: string;
  /** 영문 표기 — 이미지 검색 키워드로도 쓰인다 */
  nameEn: string;
  maker: string;
  /**
   * 이 차가 **열리는 레벨** (scenarios/curriculum.ts 의 LEVELS).
   *
   * 한때는 점수로 사는 가격이었다. 상점이 파는 것은 '탈 권리' 가 아니라 렌탈 딱지를 떼는
   * 일이었는데, 그래도 **점수를 모으는 화면**이 남아 있었다 — 규정을 익히러 온 사람이
   * 돈 모으기를 하게 되는 구조다.
   *
   * 그다음에는 계급 넷(초급·중급·고급·마스터)에 묶여 있었다. 그때는 **다섯 단계를
   * 올라가도 차가 안 바뀌는 구간**이 생겼다 — 계급이 세 단계에 한 번만 오르기 때문이다.
   *
   * 지금은 **레벨 하나에 차 한 대**다. 한 판을 무위반으로 통과하면 레벨이 오르고,
   * 오른 그 판에서 차가 바뀐다. 이 게임이 보상하려는 것과 화면이 보여 주는 것이
   * 그제야 같은 박자로 움직인다.
   *
   * 값은 **1~9** 다. 차가 아홉 대인데 레벨은 열이라 마지막 레벨에는 새 차가 없다 —
   * L9 의 차가 L10 까지 간다 (`carForLevel`). 마지막 레벨은 새 차를 받는 자리가 아니라
   * 경험치를 끝까지 채우고 나쁜 습관을 모두 고쳐 이 과정을 마치는 자리다.
   */
  level: Difficulty;
  /** 한 줄 소개 */
  tagline: string;
  /** 실차 제원 한 줄 요약 (표시용) */
  spec: string;

  /** 엔진음 기본 주파수 (Hz) — WebAudio 합성용 */
  engineNote: number;

  // ── 외형 (프로시저럴 메시 파라미터) ──
  dims: {
    /** 전장, 전폭, 전고 (m) */
    length: number;
    width: number;
    height: number;
    /** 루프 높이 비율 (0.3=슈퍼카처럼 낮음, 0.55=경차처럼 높음) */
    roofRatio: number;
    /** 루프 앞끝 위치 비율 (0=앞범퍼, 1=뒷범퍼) */
    cabinFront: number;
    cabinRear: number;
  };
  /** 차체 색상 (16진) */
  color: number;
  /** 지붕 표시등 (택시) */
  roofSign?: boolean;



  /** 이름으로 부품을 찾을 수 없는 모델의 **수동 부착점** (→ CarAnchors) */
  anchors?: CarAnchors;

  /**
   * 모델을 앞으로 향하게 돌리는 각 (rad). 기본은 180°.
   *
   * 모델이 어느 쪽을 보고 있는지는 계산으로 알 수 없어 렌더로 확인해 적는다.
   * 대부분 180° 면 맞지만 쏘렌토는 반대로 만들어져 있다(전조등이 +Z 에 있다).
   * 틀리면 차가 뒤로 달리는 것처럼 보인다 — 후진 등이 앞을 보고 대시보드가 뒤를 본다.
   */
  modelYaw?: number;
}

/**
 * 모델 부착점을 손으로 적어 주는 자리 (차량 로컬 좌표, fitToCar 이후 기준).
 *
 * 부품을 전부 그대로 쓰게 된 뒤로 **모델마다 필요한 값은 눈높이 하나뿐**이다.
 * 기본은 자동 측정이다 — 유리 메시(`window`/`glass`)에서 벨트라인과 캐빈 높이를 재는데,
 * 재질이 통합된 모델은 유리를 못 찾는다. 그런 차만 여기에 적는다.
 *
 * 눈높이는 없앨 수 없는 값이다. 카메라가 어디 앉을지는 모델을 봐야만 알 수 있고,
 * 틀리면 차 밖이나 지붕 위에 서게 된다.
 */
export interface CarAnchors {
  /** 핸들 중심·반지름·눕힌 각(rad, 음수가 뒤로 눕힘) */
  steering?: { x: number; y: number; z: number; radius: number; rake: number };
  /** 계기판 — x·y 는 중심, z 는 운전자 쪽 면, width 는 판 폭 */
  cluster?: { x: number; y: number; z: number; width: number };
  /** 운전석 눈높이 */
  eye?: { y: number };
  /** 거울면 중심 */
  mirrors?: {
    left: { x: number; y: number; z: number };
    right: { x: number; y: number; z: number };
    room: { x: number; y: number; z: number } | null;
  };
}

/**
 * 차 목록. **화면에 놓이는 순서는 이 배열이 아니라 `level` 이 정한다** (`CARS_BY_LEVEL`).
 *
 * 배열 순서는 이 파일을 읽는 사람을 위한 것이라 손대지 않는다 — 항목마다 모델의 실측치와
 * 좌표를 적어 둔 주석이 길어서, 순서를 바꾸려면 그 덩어리를 통째로 옮겨야 한다.
 * 레벨은 한 줄이므로 순서를 바꾸고 싶으면 그 숫자만 바꾸면 된다.
 *
 * 레벨 순서(L1→L9)는 **격이 올라가는 순서**다 — 준중형 세단에서 시작해 중형·SUV·수입
 * 고성능을 지나 슈퍼카로 간다. 한 판 올라갈 때마다 차가 눈에 띄게 달라져야 오른 것이
 * 보인다.
 *
 *   L1 아반떼 N · L2 코롤라 · L3 K5 · L4 쏘렌토 · L5 M5 CS
 *   L6 콜벳 C8 · L7 M8 컨버터블 · L8 SL63 · L9 SF90 (L10 까지 이 차)
 */
export const CARS: CarSpec[] = [
  /*
    기본 차량 (STARTER_CAR_ID). 실내 텍스처가 있으면서 **가장 가벼운** 국산 모델이다(20만 면).

    치수는 2024년형 아반떼 N(CN7) 제원 4,710×1,825×1,415 에서 왔다(전폭만 0.82배).
    cabinFront 0.264 는 모델 실측과 맞는다 — 중앙선 단면에서 앞유리가 카울 z −1.11(y 1.02)
    에서 헤더 z −0.50(y 1.35) 까지 올라가는데, 절차적 공식이 잡는 카울(−1.111)·헤더(−0.5)가
    그대로 겹친다. 눈높이는 자동 측정이 1.234 로 나온다(수동 보정이 필요 없다).

    **이 모델만 CC BY-NC 다** — 비상업적 사용만 허용된다. carModel.ts 의 크레딧 참조.
  */
  {
    id: 'avante',
    name: '현대 아반떼 N',
    nameEn: 'Hyundai Elantra N',
    maker: '현대',
    level: 1,
    tagline: '국산 준중형 세단. 차가 짧아 우회전 궤적을 가장 작게 돌 수 있다.',
    spec: '준중형 세단 · 2,000cc 터보',
    engineNote: 120,
    dims: { length: 4.71, width: 1.5, height: 1.415, roofRatio: 0.45, cabinFront: 0.264, cabinRear: 0.8 },
    color: 0x0e3b8c,
  },
  /*
    국산 세단.

    부품 이름이 `Object_12` 처럼 무의미하고 **재질 이름만 살아 있는** 모델이다
    (carpaint·windowglass·interior). carModel.ts 가 재질 이름까지 보므로 눈높이·차체 크기는
    자동으로 잰다 — 앞유리가 y 0.778~1.206, 눈높이는 그 65% 인 1.056 으로 나온다.

    치수는 2016년형(JF) 제원 4,855×1,860×1,465 에서 왔다. 전폭만 관례대로 0.82배(1.53)다.
    루프 비율은 모델 실측에서 뽑았다 — 벨트라인이 지붕 아래 0.556m(전고 대비 0.43),
    앞유리 아래끝이 앞범퍼에서 1.35m(전장의 0.28) 지점이다.
  */
  {
    id: 'k5',
    name: '기아 K5',
    nameEn: 'Kia K5 (Optima)',
    maker: '기아',
    level: 3,
    tagline: '국산 중형 세단. 코롤라보다 길어 우회전 궤적이 더 크게 돈다.',
    spec: '중형 세단 · 2,000cc',
    engineNote: 112,
    dims: { length: 4.855, width: 1.53, height: 1.465, roofRatio: 0.43, cabinFront: 0.28, cabinRear: 0.8 },
    color: 0xb8bcc4,
  },
  /*
    국산 SUV. **실내 텍스처가 있는 유일한 국산차 계열**이라 골랐다.

    K5 모델은 텍스처가 한 장도 없어(재질 25개가 전부 단색) 실내가 회색 점토처럼 보인다.
    이 모델은 텍스처 26장에 가죽·카펫·바느질선까지 따로 있다 — 실내를 들여다보는
    이 게임에서는 폴리곤 수보다 이쪽이 중요하다.

    이 모델은 **앞뒤가 반대로** 만들어져 있어 modelYaw 를 0 으로 둔다(전조등이 +Z 에 있다).

    눈높이는 **손으로 적는다.** 자동 측정은 앞쪽 유리 정점의 백분위로 앞유리 위·아래를
    잡는데, 이 모델은 전조등 렌즈가 유리 재질(glasstinted)이면서 정점이 1만 개가 넘어
    (앞유리는 수천 개) 백분위가 통째로 전조등 쪽으로 끌려간다 — 1.20 이 나온다.
    중앙선 단면으로 실측한 앞유리는 카울 y 0.95(z −0.70) · 헤더 y 1.65(z −0.25) 이고,
    그 65% 지점이 1.40 이다. 실차 SUV 운전자 눈높이와도 맞는다.

    치수는 2022년형(MQ4) 제원 4,810×1,900×1,695 에서 왔다(전폭만 0.82배).
    cabinFront 는 모델의 카울 위치가 아니라 **눈이 헤더 뒤 0.16m 에 앉도록** 잡은 값이다 —
    이 모델은 앞유리 경사가 57° 로 가팔라서, 절차적 공식(카울에서 전장의 13% 앞이 헤더)이
    그대로 들어맞지 않는다.
  */
  {
    id: 'sorento',
    name: '기아 쏘렌토',
    nameEn: 'Kia Sorento PHEV',
    maker: '기아',
    level: 4,
    tagline: '국산 SUV. 눈높이가 높아 앞차 너머가 보이지만, 우측 사각지대는 그만큼 넓다.',
    spec: '중형 SUV · 1,598cc 하이브리드',
    engineNote: 98,
    dims: { length: 4.81, width: 1.56, height: 1.695, roofRatio: 0.5, cabinFront: 0.295, cabinRear: 0.96 },
    color: 0x2b3138,
    modelYaw: 0,
    anchors: { eye: { y: 1.4 } },
  },
  /*
    실내 비례의 기준이 되는 차.

    주행 화면의 3D 모델(public/models/corolla.glb)이 바로 이 차다. 모델은 **차 길이에 맞춰**
    스케일되므로, 기본 차량의 전장이 모델의 실제 전장과 가까울수록 실내 비례가 자연스럽다.
    전장 3.34m 의 경차를 기본으로 두었을 때는 코롤라가 0.77배로 눌려 눈높이·대시보드
    비례가 전부 어긋났다.
  */
  {
    id: 'corolla',
    name: '토요타 코롤라',
    nameEn: 'Toyota Corolla',
    maker: '토요타',
    level: 2,
    tagline: '첫 차. 세계에서 가장 많이 팔린 준중형 세단으로 우회전 습관을 만든다.',
    spec: '준중형 세단 · 1,798cc',
    engineNote: 106,
    dims: { length: 4.62, width: 1.46, height: 1.46, roofRatio: 0.47, cabinFront: 0.3, cabinRear: 0.82 },
    color: 0x1e2430,
  },
  /*
    수입 고성능 세단. **카탈로그에서 가장 길다**(4.975m) — 우회전 궤적이 그만큼 커진다.

    아반떼 N 과 같은 제작자(Ddiaz Design) 모델이라 손댈 것이 없었다. 부품·재질 이름이
    살아 있어(`...Window_Material`·`...InteriorA_Material`) 눈높이가 자동으로 잡히고
    (카울 1.049 · 헤더 1.386 → 1.268), 유리도 alphaMode BLEND 라 투명 처리가 필요 없다.
    앉힌 뒤 폭이 1.903 으로 실차 제원과 정확히 같게 나온다.

    치수는 2022년형 M5 CS(F90) 제원 4,975×1,903×1,463 에서 왔다(전폭만 0.82배).
    cabinFront 0.319 는 모델 실측 카울(z −0.90)과 맞는 값이다.
  */
  {
    id: 'm5',
    name: 'BMW M5 CS',
    nameEn: 'BMW M5 CS',
    maker: 'BMW',
    level: 5,
    tagline: '수입 고성능 세단. 카탈로그에서 가장 길어 우회전 궤적이 가장 크게 그려진다.',
    spec: '대형 세단 · 4,395cc V8 트윈터보',
    engineNote: 126,
    dims: { length: 4.975, width: 1.56, height: 1.463, roofRatio: 0.42, cabinFront: 0.319, cabinRear: 0.8 },
    color: 0x27302c,
  },
  /*
    오픈 그란투리스모. **카탈로그에서 가장 가볍다** — 7만 9천 면·1.1MB 로 코롤라보다도 가볍다.

    같은 Ddiaz Design 모델이지만 재질 이름 규칙이 다르다(`bMAT_Glass_025`·`bMAT_Details_INT1`).
    그래도 유리·실내·바퀴가 이름으로 다 걸린다.

    이 모델이 **차체 기준 박스 규칙**을 하나 만들게 했다. `MAT_Details_Chassis` 라는 재질이
    있는데 실제로는 두께 없는 밑판(0.018×0.001×0.047)이라, 그것에 맞춰 스케일하면 차가
    4% 길어진다(4.87m → 5.07m). carModel.ts 가 "길이의 15% 보다 낮은 박스는 차체가 아니다"
    로 걸러 낸다.

    치수는 2020년형 M8 컴페티션 컨버터블(F91) 제원 4,867×1,907×1,346 에서 왔다(전폭만 0.82배).
    cabinFront 0.305 로 계산한 헤더(z −0.317)가 모델 실측 헤더(z −0.30)와 거의 겹친다.
    **소프트톱이 닫힌 상태**로 만들어져 있어 지붕이 있다 (아래 tagline 참조).
  */
  {
    id: 'm8',
    name: 'BMW M8 컴페티션 컨버터블',
    nameEn: 'BMW M8 Competition Convertible',
    maker: 'BMW',
    level: 7,
    tagline: '오픈 그란투리스모. 슈퍼카보다 눈높이가 높아 시야는 세단에 가깝다.',
    spec: '대형 컨버터블 · 4,395cc V8 트윈터보',
    engineNote: 130,
    dims: { length: 4.867, width: 1.56, height: 1.346, roofRatio: 0.34, cabinFront: 0.305, cabinRear: 0.8 },
    color: 0x14335c,
    /*
      **눈높이를 자동값(앞유리에서 잰 1.11m)보다 조금 올린다.**

      이 차는 대시보드가 높아 노면이 그만큼 가려진다. 눈을 올리면 대시보드 너머로 앞 노면이
      더 들어온다 — 우회전 궤적과 정지선을 눈으로 맞춰야 하는 게임이라 그쪽이 중요하다.

      한때 반대로 1.05m 까지 내려 봤는데(천장이 화면을 덮어서), 그러면 노면이 더 가려졌다.
      천장 쪽은 모델에서 그 부분만 잘라내(remove-view-blockers.mjs 의 sphereCut) 해결했으므로
      눈은 노면이 잘 보이는 쪽으로 올린다.

      1.11 → 1.16 → **1.20m** 으로 두 번 올렸다. 앞유리 헤더가 1.26m 라 여기가 사실상
      상한이다 — 더 올리면 눈이 헤더에 붙어 위쪽이 다시 막힌다.
    */
    anchors: { eye: { y: 1.2 } },
  },
  /*
    슈퍼카. **눈높이가 가장 낮다**(1.01m) — 앞차 뒤에 서면 신호등도 안 보인다.

    미드십이라 실내가 앞쪽으로 치우쳐 있고(실내 z −2.17~1.24), 지붕을 접은 스파이더라
    앉힌 뒤 차 높이가 1.107 로 나온다. 앞유리가 카울 0.806(z −1.10) 에서 헤더 1.125(z −0.30)
    까지 눕는데, 절차적 공식(카울에서 전장의 13% 앞이 헤더)이 이렇게 누운 앞유리에는
    그대로 맞지 않는다. cabinFront 0.296 은 **헤더가 z −0.35 에 오도록** 맞춘 값이다.

    치수는 2021년형 SF90 스파이더 제원 4,704×1,973×1,236 에서 왔다(전폭만 0.82배).
    운전석은 좌측이 맞다 — 앞좌석 실내 정점이 좌 14,038 대 우 5,495 로 기운다(핸들·컬럼).
  */
  {
    id: 'sf90',
    name: '페라리 SF90 스파이더',
    nameEn: 'Ferrari SF90 Spider',
    maker: '페라리',
    level: 9,
    tagline: '슈퍼카. 눈높이가 1m로 가장 낮아 앞차 너머도, 높이 달린 신호등도 보기 어렵다.',
    spec: '미드십 스파이더 · 3,990cc V8 하이브리드',
    engineNote: 140,
    dims: { length: 4.704, width: 1.62, height: 1.236, roofRatio: 0.32, cabinFront: 0.296, cabinRear: 0.62 },
    color: 0xc8102e,
  },
  /*
    수입 로드스터. 카탈로그에서 **실내가 가장 촘촘한** 모델이다.

    재질만 89종이고 계기 눈금(script_rt_dials_race)·바느질선(stitchesopc)·카펫·스피커가
    따로 있다. 그만큼 무겁다 — 66만 면·7.5MB 로 카탈로그 최대다.

    **부품 하나하나가 본에 물린 스킨 모델이다**(178개 중 173개). 정점의 실제 자리를
    본 변환이 정하므로 carModel.ts 의 vertexWorld 를 거쳐야 제대로 잰다.

    modelYaw 0 — 기본값(180°)으로 두면 핸들이 오른쪽에 온다(우핸들 차가 된다).
    본 변환을 넣고 재면 핸들 x −0.46~−0.29(좌측 ✓), 계기판이 핸들 앞, 미등이 뒤에 온다.

    치수는 SL63(R232) 제원 4,705×1,915×1,359 에서 왔다(전폭만 0.82배). 이 모델은
    맨소리 킷을 씌워 낮춘 차라 실제 모델 높이는 1.274 로 나온다.
    cabinFront 0.351 은 모델 실측 카울(z −0.70)과 맞는 값이다.
  */
  {
    id: 'sl63',
    name: '메르세데스-벤츠 SL63 맨소리',
    nameEn: 'Mercedes-Benz SL63 Mansory',
    maker: '메르세데스-벤츠',
    level: 8,
    tagline: '오픈 로드스터. 눈높이가 1.0m 로 가장 낮아 앞차 너머가 전혀 안 보인다.',
    spec: '로드스터 · 4,000cc V8 트윈터보',
    engineNote: 138,
    dims: { length: 4.705, width: 1.57, height: 1.359, roofRatio: 0.38, cabinFront: 0.351, cabinRear: 0.62 },
    color: 0x1b1b1f,
    modelYaw: 0,
  },
  /*
    오픈카.

    이 모델은 부품이 재질별로 통합돼 있고 이름이 `Mesh6` 처럼 무의미해서, 핸들을 찾아
    나머지를 재는 자동 측정이 통하지 않는다. 그래서 부착점을 손으로 적었다.
    좌표는 모델을 전장 4.63m 로 맞춘 뒤(fitToCar) 실측한 캐빈 범위에서 잡은 값이다 —
    실내 재질이 y 0.15~1.19 · z −2.08~1.35, 콘솔·바닥(InteriorTilling)이
    x ±0.61 · y 0.26~0.68 · z −0.39~0.32 에 있다.
  */
  {
    id: 'corvette',
    name: '쉐보레 콜벳 C8 컨버터블',
    nameEn: 'Chevrolet Corvette C8 Stingray Convertible',
    maker: '쉐보레',
    level: 6,
    tagline: '오픈카. 지붕이 없어 시야는 트이지만, 눈높이가 낮아 앞차 너머가 안 보인다.',
    spec: '미드십 컨버터블 · 6,162cc',
    engineNote: 132,
    dims: { length: 4.63, width: 1.58, height: 1.23, roofRatio: 0.34, cabinFront: 0.26, cabinRear: 0.62 },
    color: 0x8d1b1b,
    // 유리 재질이 통합돼 눈높이를 자동으로 못 재므로 손으로 적는다 (캐빈 실측 y 0.15~1.19)
    anchors: { eye: { y: 0.95 } },
  },
];

/**
 * 처음 시작하는 차 — **목록 순서와 분리해 이름으로 못 박는다.**
 *
 * 예전에는 `CARS[0].id` 였는데, 목록을 보기 좋은 순서로 바꾸면 기본 차량이 조용히 따라
 * 바뀐다. 어느 차로 시작할지는 순서와 별개로 정하는 편이 맞다.
 *
 * 국산 준중형 세단이라 처음 배우는 사람에게 가장 익숙하고, 카탈로그에서 가장 짧아
 * 우회전 궤적을 잡기도 쉽다. 다만 **이 모델은 CC BY-NC** 라 비상업적 사용만 허용된다 —
 * 상업 배포로 방향이 바뀌면 여기부터 코롤라로 되돌려야 한다.
 */
export const STARTER_CAR_ID = 'avante';

export function getCar(id: string): CarSpec {
  return CARS.find((c) => c.id === id) ?? CARS.find((c) => c.id === STARTER_CAR_ID) ?? CARS[0];
}

/** 레벨 순으로 늘어놓은 목록 — 전시관이 이 순서로 놓는다 */
export const CARS_BY_LEVEL: readonly CarSpec[] = [...CARS].sort((a, b) => a.level - b.level);

/**
 * 안전 운전 포인트 표기.
 *
 * 예전에는 원화(`formatWon`)였고 만·억 단위로 줄여 썼다. 점수로 바꾸면서 그 축약을
 * 없앤다 — '3만'은 돈의 어법이고, 점수는 **자리수 그대로** 읽는 편이 쌓이는 맛이 난다.
 */
export function formatPoints(amount: number): string {
  return `${Math.round(amount).toLocaleString()} 점`;
}

/**
 * 이 차를 탈 수 있는가 — **지금까지 올라간 가장 높은 레벨**이 정한다.
 *
 * `bestLevel` 을 넘기는 것이지 지금 레벨이 아니다(scenarios/curriculum.ts 의
 * `unlockedLevel`). 강등돼도 이미 열린 차는 닫히지 않는다 — 얻은 것을 도로 빼앗는 것은
 * 이 게임이 하려는 일이 아니고, 차를 잃지 않으려고 쉬운 판만 고르게 만들 이유도 없다.
 */
export const isCarUnlocked = (car: CarSpec, bestLevel: Difficulty): boolean =>
  car.level <= bestLevel;

/**
 * 카탈로그에서 **가장 높은 레벨의 차**. 지금은 L9(SF90)다.
 *
 * `MAX_LEVEL - 1` 로 적지 않는 이유: 그러면 "차 수 = 레벨 수 − 1" 이라는 약속이
 * 코드에 숨는다. 열째 차를 넣는 날 이 값이 저절로 따라오고, 여덟 대로 줄여도 그렇다.
 */
const TOP_CAR_LEVEL = Math.max(...CARS.map((c) => c.level));

/**
 * 그 레벨에서 **내주는 차** — 레벨이 오르면 이 차로 갈아탄다.
 *
 * **마지막 레벨에는 새 차가 없다.** 차가 아홉 대인데 레벨은 열이라, L10 은 L9 의 차를
 * 그대로 탄다. 그 자리는 새 차를 받는 곳이 아니라 이 과정을 마치는 곳이다.
 */
export const carForLevel = (level: Difficulty): CarSpec | undefined =>
  CARS.find((c) => c.level === Math.min(level, TOP_CAR_LEVEL));

