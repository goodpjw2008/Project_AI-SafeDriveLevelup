# Third-Party Notices

본 프로젝트는 제3자 3D 모델 · 소리 · 이미지 · 글꼴 · 소프트웨어를 사용합니다. 이 문서는 사용한 각 자산의 출처와 라이선스를 안내하기 위한 참고 자료입니다.

> **참고**: 본 프로젝트의 자체 작성 코드는 [MIT License](LICENSE)로 배포됩니다. 로봇 캐릭터 그림 · README 의 글과 그림은 [LICENSE-ASSETS](LICENSE-ASSETS) (CC BY 4.0)를 따릅니다. 아래의 제3자 자산은 **각 원작자의 라이선스**를 따르며, 위 두 라이선스가 적용되지 않습니다.
>
> 3D 자동차 모델 중 4종(아반떼 N · M8 · M5 · SL63)은 **비영리(NC)** 조건입니다. 이 모델이 들어 있는 배포 사이트(https://safeturn.vercel.app)는 비영리로만 운영합니다. 이 저장소를 상업적으로 쓰려면 해당 모델 파일과 그 차 사진을 빼야 합니다.

---

## 3D 자동차 모델

- **출처**: Sketchfab
- **위치**: `public/models/<이름>.glb` · `public/models/<이름>.lod.glb`
- **수정 사항**: 파일 크기를 줄이는 최적화(압축 · 저해상도 LOD 사본)와, 운전석 시야를 가리는 부품(룸미러 등) 정리 · 앞유리 투명도 조정 · 조각난 부품 합치기를 했습니다 (`scripts/` 의 스크립트)
- **차 사진**: 전시관의 대표 사진(`public/car-photos/<이름>.jpg`)은 이 3D 모델을 찍은 그림이라, 같은 모델의 라이선스를 따릅니다
- **CC BY-NC-SA 4.0 모델**: 수정본(위 최적화 · 정리한 파일)도 같은 CC BY-NC-SA 4.0 으로만 배포합니다

| 파일 | 모델 | 만든 사람 | 라이선스 |
|---|---|---|---|
| `corolla` | [2014 Toyota Corolla E180 EU (with interior)](https://sketchfab.com/3d-models/2014-toyota-corolla-e180-eu-with-interior-36f95efb0585464cae43a25a3b3392e8) | Armored Wave | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `corvette` | [2020 Chevrolet Corvette C8 Stingray Convertible](https://sketchfab.com/3d-models/2020-chevrolet-corvette-c8-stingray-convertible-01d63aa7013347acbfa62bc00e0b2df6) | Ddiaz Design | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `k5` | [Kia K5 MX HQ interior 2016](https://sketchfab.com/3d-models/kia-k5-mx-hq-interior-2016-6b745e6c63924c82b92d680cbc5fee6a) | Nieve5677 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `avante` | [2024 Hyundai Elantra N](https://sketchfab.com/3d-models/2024-hyundai-elantra-n-4ba1b1b0eb844e318cc708ada1f2f51f) | Ddiaz Design | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| `m8` | [2020 BMW M8 Competition Convertible](https://sketchfab.com/3d-models/2020-bmw-m8-competition-convertible-f7c1401ee5724e969db890c207fb099f) | Ddiaz Design | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| `sf90` | [2021 Ferrari SF90 Spider](https://sketchfab.com/3d-models/2021-ferrari-sf90-spider-8f8ef613e39746668b4f0268a3176dde) | Ddiaz Design | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `m5` | [2022 BMW M5 CS](https://sketchfab.com/3d-models/2022-bmw-m5-cs-dc34c3fd9056460da48317ce0ff6b998) | Ddiaz Design | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| `sl63` | [Mercedes-Benz SL63 Mansory](https://sketchfab.com/3d-models/mercedes-benz-sl63-mansory-669099d7d4374d3bbbd86c62f5d66507) | VTX | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| `sorento` | [2022 Kia Sorento PHEV Executive Line](https://sketchfab.com/3d-models/2022-kia-sorento-phev-executive-line-340ded1d34c149a095b3281a1232494a) | twr422 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

차 이름 · 로고 등 상표는 각 자동차 회사의 것입니다. 모델 라이선스는 상표 사용 권한을 주지 않습니다.

## 효과음

- **출처**: Freesound
- **라이선스**: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (퍼블릭 도메인)
- **위치**: `src/assets/sounds/`
- **수정 사항**: 게임에 맞게 자르고 이어 붙였습니다 (`scripts/build-sounds.mjs`)

| 소리 | 만든 사람 |
|---|---|
| [Car Internal - Idle to Fast](https://freesound.org/people/andrewfordham/sounds/848361/) | andrewfordham |
| [Car drive](https://freesound.org/people/NachtmahrTV/sounds/553185/) | NachtmahrTV |
| [Alfa Romeo MiTo honking car horn](https://freesound.org/people/boedie/sounds/457425/) | boedie |
| [BMW Indicator](https://freesound.org/people/The_Cri/sounds/545322/) | The_Cri |

## 환경광 (HDRI)

- **출처**: Poly Haven
- **라이선스**: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (퍼블릭 도메인)
- **위치**: `public/hdri/`

| 파일 | 이름 | 만든 사람 |
|---|---|---|
| `wide_street_01.hdr` | [Wide Street 01](https://polyhaven.com/a/wide_street_01) | Sergej Majboroda |
| `vatican_road.hdr` | [Vatican Road](https://polyhaven.com/a/vatican_road) | Greg Zaal |
| `shanghai_bund.hdr` | [Shanghai Bund](https://polyhaven.com/a/shanghai_bund) | Greg Zaal |

## 글꼴 · 아이콘

### Pretendard

- **소스**: https://github.com/orioncactus/pretendard
- **라이선스**: [SIL Open Font License 1.1](https://github.com/orioncactus/pretendard/blob/main/LICENSE)
- **사용처**: 화면의 모든 글자 (실행할 때 jsDelivr CDN 에서 받아 옵니다)

### Lucide

- **소스**: https://lucide.dev
- **라이선스**: [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE)
- **사용처**: 화면의 아이콘과 레벨 뱃지 도형 (`src/ui/icons.ts` · `src/ui/badges.ts`)

## 소프트웨어

### three.js (배포물에 포함)

- **소스**: https://threejs.org
- **라이선스**: MIT
- **용도**: 3D 렌더링

### 개발 도구 (배포물에 포함되지 않음)

| 도구 | 라이선스 | 용도 |
|---|---|---|
| [Vite](https://vite.dev) | MIT | 개발 서버 · 빌드 |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | 타입 검사 · 컴파일 |
| [Vitest](https://vitest.dev) | MIT | 테스트 |
| [glTF-Transform](https://gltf-transform.dev) | MIT | 3D 모델 최적화 |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) | MIT | 3D 모델 압축 |

## AI 서비스

- **Google Gemini** — 로봇 캐릭터 '안전이' 그림 생성, 그리고 실행 중 코스 추천 · 주행 코칭 문장 생성
- **Groq** — 실행 중 코스 추천 · 주행 코칭 문장 생성

AI 서비스는 코드에 포함되지 않으며, 각 서비스의 이용 약관을 따릅니다.
