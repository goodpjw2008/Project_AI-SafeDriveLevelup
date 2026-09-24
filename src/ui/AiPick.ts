/**
 * **AI 가 코스를 고르는 장면** — 분석 연출과 추천 결과.
 *
 * "이어서 안전운전 연습" 을 누르면 AI 가 실제로 하는 일을 순서대로 보여 준다:
 *  ① 주행 기록 읽기 → ② 나쁜 운전 습관 분석 → ③ 6천여 시나리오에서 후보 추리기 → ④ AI 가 하나 고르기.
 * 단계의 숫자와 습관 이름은 **실제 값**이다 (recommend.ts 가 알려 준다). ④는 AI 의 답이 올 때까지 돈다 —
 * 연출이 AI 보다 먼저 끝나거나, 답이 왔는데 연출만 도는 일이 없게 한다.
 *
 * 연출이 끝나면 결과 카드로 바뀐다 — "AI 가 운전자분에게 추천 시나리오 「…」 - 3700번을 선택해
 * 줬습니다" 와 추천 사유. 그 뒤에서 맵을 준비하고, 준비가 끝나면(그리고 읽을 틈이 지나면) 걷힌다.
 *
 * 화면(DOM)만 다룬다. 언제 무엇을 띄울지는 main.ts 가 정한다.
 */

import robotCaution from '../assets/airobot/yello.webp';
import { type Picker } from '../scenarios/recommend';
import { analyzingBy, pickedByCard } from './pickedBy';
import robotNormal from '../assets/airobot/normal.webp';
import { withAiBadge } from './brandName';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 앞의 세 단계가 하나씩 켜지는 간격 (ms) — 읽을 수 있을 만큼, 기다린다고 느끼지 않을 만큼 */
const STEP_MS = 650;
/** 마지막 단계(AI 가 고르는 중)를 적어도 이만큼은 보여 준다 */
const PICK_MIN_MS = 900;
/** AI 이름이 제목에 뜬 뒤 적어도 이만큼은 보여 준다 — 답이 빨라도 읽고 넘어가게 */
const ANALYST_MIN_MS = 700;
/** 결과 카드를 적어도 이만큼은 보여 준다 — 추천 사유 두 줄을 읽는 시간 */
export const RESULT_MIN_MS = 4500;

export interface PickResult {
  title: string;
  /** 시나리오 번호 — 갈래 한 글자 + 다섯 자리 (scenarios/scenarioCode.ts). 없으면 번호 없이 적는다 */
  code?: string;
  why: string;
  focus?: string;
  /** 누가 골랐는가 (scenarios/recommend.ts 의 Picker) — 생략하면 그 줄을 비운다 */
  picker?: Picker;
  /** 그 제공자의 모델 이름 — 'gemini-3.1-flash-lite' (AI 가 고른 판만) */
  model?: string;
  /** 이번 판에서 고칠 습관의 이름 — 없으면 그 줄을 감춘다 */
  habit?: string;
  /** 그 습관을 **AI 가 정했는가** — 습관이 여럿일 때만 AI 가 정한다 (scenarios/recommend.ts 의 habitBy) */
  habitByAi?: boolean;
}

export class AiPickOverlay {
  private root = $('ai-pick');
  private stepsEl = $('ai-pick-steps');
  private bar = $('ai-pick-bar');
  private img = $('ai-pick-img') as HTMLImageElement;
  /**
   * **분석 화면의 원래 제목** ("AI 가 운전 습관을 분석하고 있습니다") — 처음 한 번 읽어 둔다.
   *
   * 답이 오면 `setAnalyst` 가 제목을 "Gemini … 모델이 분석하고 있습니다" 로 **갈아 끼우는데**, 다음 판의 분석을
   * 시작할 때 이것을 되돌리지 않아 **지난 판에 답한 AI 이름**이 그대로 남아 있었다. 그래서 새 판의 답이 올
   * 때까지 "Groq 가 분석 중" 이라고 적혀 있다가 결과 카드는 "Gemini 가 골라 줬어요" 라고 말했다 —
   * 사용자가 보고 물었다: "그록이 분석을 하고 gemini가 맵을 선택해 주고 있어. 이게 어떻게 동작하는 거니?"
   * 실제로는 한 판에 AI 한 곳이 분석과 선택을 함께 한다. 화면만 한 박자 늦게 바뀌고 있었다.
   *
   * 문구를 여기 다시 적지 않고 index.html 의 것을 읽는다 — 두 벌이면 한쪽만 고쳐지는 날이 온다.
   */
  private readonly titleDefault = $('ai-pick-title').innerHTML;
  private resultShownAt = 0;
  /** 연출을 새로 시작하면 앞의 것은 멈춘다 — 늦게 끝난 앞 연출이 새 화면을 건드리지 않게 */
  private run = 0;

  get showingResult(): boolean {
    return !this.root.hidden && this.root.classList.contains('result');
  }

  /** 분석 화면의 제목에 AI 이름이 뜬 시각 (0 이면 아직) */
  private analystAt = 0;

  /**
   * **누가 분석했는지 알게 된 순간** 제목을 갈아 끼운다 — "Gemini gemini-3.1-flash-lite 모델이 운전 습관을
   * 분석하고 있습니다" (ui/pickedBy.ts 의 analyzingBy).
   *
   * 부르는 쪽(main.ts)이 AI 의 답이 오는 대로 불러 준다. 코드가 고른 판이면 제목을 건드리지 않는다.
   */
  setAnalyst(picker?: Picker, model?: string): void {
    const line = analyzingBy(picker, model);
    if (!line || this.root.hidden || this.showingResult) return;
    const title = $('ai-pick-title');
    title.innerHTML = line;
    // 이름이 붙은 제목은 길다 — 한 줄에 담기게 한 단계 줄인다 (index.html 의 .ai-pick h2.named)
    title.classList.add('named');
    this.analystAt = performance.now();
  }

  /** 결과 카드가 떠 있은 시간 (ms) */
  get resultAge(): number {
    return performance.now() - this.resultShownAt;
  }

  /**
   * 분석 연출을 시작한다. 앞의 세 단계는 시간에 맞춰 켜고, 마지막 단계는 `picked` 가 풀릴 때까지 돈다.
   *
   * @param steps 네 단계의 글 — 함수면 그 단계가 켜지는 순간에 부른다(그때 알게 된 실제 숫자를 쓰려고)
   * @param picked AI 의 답 — 이것이 풀리고 최소 시간이 지나야 연출이 끝난다
   */
  async analyze(steps: (string | (() => string))[], picked: Promise<unknown>): Promise<void> {
    const run = ++this.run;
    this.analystAt = 0;
    this.img.src = robotNormal;
    this.root.classList.remove('result');
    this.root.hidden = false;
    /*
      지난 판에서 AI 이름을 붙여 둔 제목을 **글자까지** 원래대로 — 이번 판은 누가 받을지 아직 모른다
      (server/llm.mjs 가 자리를 돌려 쓴다). 답이 오면 setAnalyst 가 실제로 답한 이름을 다시 붙인다.
      예전에는 줄여 둔 크기(`named`)만 되돌려, 지난 판의 AI 이름이 새 판의 분석 화면에 남았다 (위 titleDefault).
    */
    const title = $('ai-pick-title');
    title.innerHTML = this.titleDefault;
    title.classList.remove('named');
    this.stepsEl.innerHTML = steps.map(() => '<li></li>').join('');
    const items = [...this.stepsEl.querySelectorAll('li')];
    this.bar.style.width = '0%';

    for (let i = 0; i < items.length; i++) {
      if (run !== this.run) return;
      const text = steps[i];
      // 'AI 가 …' 의 AI 는 배지로 — 제목 · 말풍선과 같은 모양 (brandName.ts)
      items[i].innerHTML = `<span class="mark"></span><span>${withAiBadge(
        esc(typeof text === 'function' ? text() : text),
      )}</span>`;
      items[i].className = 'on';
      this.bar.style.width = `${((i + 0.5) / items.length) * 100}%`;
      if (i < items.length - 1) {
        await sleep(STEP_MS);
      } else {
        // 마지막 — AI 가 답할 때까지 (그리고 적어도 PICK_MIN_MS)
        await Promise.all([picked.catch(() => undefined), sleep(PICK_MIN_MS)]);
        /*
          **이름이 뜬 뒤 읽을 틈을 준다.** 답이 빨리 오면(Groq 0.6초) 이름이 나타나자마자 결과 카드로 넘어가
          보지 못한다. 이미 흐른 시간은 빼고 모자란 만큼만 기다리므로, 느린 제공자에서는 더 기다리지 않는다.
        */
        if (this.analystAt) await sleep(Math.max(0, ANALYST_MIN_MS - (performance.now() - this.analystAt)));
      }
      if (run !== this.run) return;
      items[i].className = 'done';
    }
    this.bar.style.width = '100%';
    await sleep(350);
  }

  /** 결과 카드 — "Gemini 가 골라 줬습니다!" + "AI 가 … 를 선택해 줬습니다" */
  showResult(r: PickResult): void {
    this.run++;
    this.img.src = robotCaution;
    // 누가 골랐는지 먼저 말한다 — 주행 화면 첫 줄과 같은 규칙이다 (ui/pickedBy.ts)
    $('ai-pick-picked').innerHTML = pickedByCard(r.picker, r.model);
    $('ai-pick-name').innerHTML =
      `「${esc(r.title)}」${r.code !== undefined ? ` - ${esc(r.code)}` : ''}`;
    // "… 3131번을" — 번호가 없으면 제목이 」 로 끝나 받침을 알 수 없다
    $('ai-pick-josa').textContent = r.code !== undefined ? '을' : '을(를)';
    /*
      **먼저 고칠 습관** — AI 가 정한 것만 "AI 판단" 이라고 적는다. 습관이 하나뿐이면 고를 것이 없었으므로
      그냥 "고칠 습관" 이다. 코드가 정한 것을 AI 가 정했다고 말하면 거짓말이다.
    */
    const habit = $('ai-pick-habit');
    habit.innerHTML = r.habit
      ? `${r.habitByAi ? '먼저 고칠 습관' : '고칠 습관'} : <b>${esc(r.habit)}</b>${r.habitByAi ? '<span class="by">AI 판단</span>' : ''}`
      : '';
    habit.hidden = !r.habit;
    $('ai-pick-why').textContent = r.why;
    const focus = $('ai-pick-focus');
    focus.textContent = r.focus ? `👉 ${r.focus}` : '';
    focus.hidden = !r.focus;
    $('ai-pick-status').textContent = '맵을 준비하고 있습니다';
    // 준비 중 — 점 셋이 차례로 튄다 (index.html 의 .ai-pick-status)
    $('ai-pick-statusbox').classList.remove('go');
    this.root.classList.add('result');
    this.root.hidden = false;
    this.resultShownAt = performance.now();
  }

  /** 맵 준비가 끝났다 — 읽을 틈이 남았으면 그만큼 기다린 뒤 걷는다 */
  async finish(): Promise<void> {
    $('ai-pick-status').textContent = '출발합니다';
    // **기다림이 끝났다** — 글자만 바꾸면 그 전환을 놓친다. 초록으로 차오르며 ▶ 로 바뀐다
    $('ai-pick-statusbox').classList.add('go');
    const wait = RESULT_MIN_MS - this.resultAge;
    if (wait > 0) await sleep(wait);
    this.hide();
  }

  hide(): void {
    this.run++;
    this.root.hidden = true;
    this.root.classList.remove('result');
  }
}
