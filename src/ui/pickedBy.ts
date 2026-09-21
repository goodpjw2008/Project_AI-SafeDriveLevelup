/**
 * **누가 이 맵을 골랐는가** — 추천 카드와 주행 화면이 같은 규칙으로 말하게 한다.
 *
 * 무료 AI 여러 곳을 돌아가며 쓰므로(server/llm.mjs) 판마다 고른 쪽이 다르고, 그 줄이 바뀌는 것 자체가 이 작품의
 * 구조를 설명한다. AI 활용 공모전 작품이라 **AI 가 한 일은 고를 때만이 아니라 달리는 동안에도 보여야 한다**
 * (사용자 요청: "주행 중에도 추천해 준 AI 를 표시해 줘").
 *
 * 말하는 자리가 둘이라 문장도 둘이다.
 *
 *  - `pickedByCard` — 추천 카드(ui/AiPick.ts). 고르는 순간이라 "골라 줬어요!"
 *  - `pickedByHud`  — 주행 화면 상단 첫 줄. 이미 달리는 중이라 "추천해 준 맵이에요."
 *
 * **코드가 고른 판에는 AI 이름을 쓰지 않는다.** 고르지도 않은 모델의 이름을 띄우면 거짓말이다. 그리고 코드가
 * 고르는 까닭이 둘이라(한도 초과 · AI 없음) 그것도 갈라 말한다 (scenarios/recommend.ts 의 Picker).
 */

import { PICKER_LABEL, type Picker } from '../scenarios/recommend';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * 고른 쪽의 이름표.
 *
 * 클래스 이름에 `picker-` 를 붙인다 — 접두사 없이 `rule` 만 쓰면 이 앱에 이미 있는 `.rule`(법규 카드,
 * display:flex)과 부딪혀 알약이 한 줄을 통째로 차지한다 (한도 소진 화면에서 실제로 그랬다).
 */
const chip = (picker: Picker): string =>
  `<span class="picker-chip picker-${picker}">${esc(PICKER_LABEL[picker])}</span>`;

/** 모델 이름 — AI 가 고른 판에만 있다 */
const modelName = (model: string): string => `<span class="picker-model">${esc(model)}</span>`;

/** 추천 카드의 한 줄 — 고르는 순간 */
export function pickedByCard(picker?: Picker, model?: string): string {
  if (!picker) return '';
  if (picker === 'quota') return `${chip(picker)} 일일 사용량이 초과됐어요. 아쉽지만 프로그램으로 추천했어요.`;
  if (picker === 'rule') return `${chip(picker)}이 운전자에 맞는 맵을 골라 줬어요!`;
  if (picker === 'random') return `${chip(picker)}가 운전자에 맞는 맵을 골라 줬어요!`;
  return `${chip(picker)}${model ? ` ${modelName(model)} 모델이` : '이'} 운전자에 맞는 맵을 골라 줬어요!`;
}

/**
 * 분석 화면의 제목 — **답이 오는 순간** 이 문장으로 바뀐다.
 *
 * 분석을 시작할 때는 어느 AI 가 받을지 알 수 없다. 자리를 돌려 쓰고(server/llm.mjs), 앞 자리가 한도를 다 썼으면
 * 다음 자리가 받기 때문이다 — **답이 와야 누가 했는지 안다.** 그래서 처음에는 'AI 어우참이 …' 로 두고, 답이
 * 오면 그 자리에서 이름을 갈아 끼운다. 미리 지어내 붙이면 결과 카드와 다른 이름이 뜰 수 있다.
 *
 * 코드가 고른 판(한도 초과 · AI 없음 · 무작위)에는 빈 문자열을 준다 — 부르는 쪽이 제목을 그대로 둔다.
 */
export function analyzingBy(picker?: Picker, model?: string): string {
  if (!picker || picker === 'quota' || picker === 'rule' || picker === 'random') return '';
  return `${chip(picker)}${
    model ? ` ${modelName(model)} 모델이` : '이'
  } 운전 습관을 분석하고 있습니다`;
}

/**
 * **결과 화면의 AI 코치 · 습관 리포트에 붙는 줄** — "Gemini gemini-3.1-flash-lite 모델이 조언해 준
 * AI 어우참의 코칭이에요."
 *
 * 코치 문장도 추천과 같은 배관을 지나므로(server/llm.mjs) 판마다 쓴 AI 가 다르다. AI 활용 공모전 작품이라
 * 그 사실이 글 옆에 보여야 한다는 사용자 요청이다 — **누가 쓴 글인지 밝히는 것**이기도 하다.
 *
 * 서버가 이름을 주지 않으면(예전 배포 · 정적 빌드) 빈 문자열이라 줄이 아예 뜨지 않는다.
 */
export function advisedBy(picker?: Picker, model?: string): string {
  if (!picker || picker === 'quota' || picker === 'rule' || picker === 'random') return '';
  return `${chip(picker)}${
    model ? ` ${modelName(model)} 모델이` : '이'
  } 조언해 준 AI 어우참의 코칭이에요`;
}

/**
 * 주행 화면 상단 첫 줄 — 이미 달리는 중.
 *
 * **짧게 적는다** (사용자가 두 번 줄였다): `Gemini : <모델> 모델이 분석해서 추천해준 맵`.
 * 달리면서 읽는 줄이라 한 번에 눈에 들어와야 하고, 판 이름이 바로 아래 줄에 또 있다.
 */
export function pickedByHud(picker?: Picker, model?: string): string {
  if (!picker) return '';
  const head = `${chip(picker)} : `;
  if (picker === 'quota') return `${head}일일 사용량 초과로 프로그램이 고른 맵`;
  if (picker === 'rule') return `${head}프로그램이 고른 맵`;
  if (picker === 'random') return `${head}무작위로 고른 마스터 운행 맵`;
  return `${head}${model ? `${modelName(model)} 모델이 ` : ''}분석해서 추천해준 맵`;
}
