/**
 * 입력. 키보드 + 마우스 시선 + 모바일 터치 컨트롤을 하나의 VehicleInput으로 모은다.
 */

import type { VehicleInput } from './Vehicle';

export interface ControlCallbacks {
  onGlance(dir: -1 | 0 | 1): void;
  onToggleView(): void;
  onToggleSignal(): void;
  onRestart(): void;
  onPause(): void;
  onLook(dx: number, dy: number): void;
  onRecenter(): void;
  /** 정지 · 출발 상태가 바뀌었다 — 터치 방향키의 ↑ · ↓ 불을 맞춘다 (키보드로 바꿔도 알린다) */
  onStopChange?(stopped: boolean): void;
}

/**
 * 화면 안내에는 화살표키만 적는다. WASD·Space 는 손에 익은 사람을 위한 별칭이라
 * 같이 적으면 안내가 두 배로 길어지고, 정작 처음 잡는 사람이 뭘 눌러야 할지 헷갈린다.
 */
const KEYMAP: Record<string, keyof PressedKeys> = {
  ArrowUp: 'go',
  KeyW: 'go',
  ArrowDown: 'stop',
  KeyS: 'stop',
  Space: 'stop',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyZ: 'glanceLeft',
  KeyX: 'glanceRight',
};

/**
 * 이 키 입력을 **브라우저에게 넘길 것인가.**
 *
 * ## 왜 필요한가
 *
 * 조작 키 처리기는 `window` 에 걸려 있고 게임이 켜져 있는 동안 늘 살아 있다. 그런데
 * `KeyC`(시점 바꾸기)에서 `preventDefault` 를 부르는 탓에 **Ctrl+C · ⌘C 가 통째로
 * 먹혔다** — 화면의 글을 골라 복사할 수가 없었다. `KeyR` 은 새로고침(Ctrl+R)을,
 * 조향 키인 `KeyA` 는 전체 선택(Ctrl+A)을 같은 식으로 막고 있었다.
 *
 * 이 화면은 3D 위에 덮여 있어 문서처럼 안 보이지만, **적힌 것은 대부분 읽으라고 쓴
 * 글이다** — 규정 요약, 조문 원문, 습관 리포트, 저작권. 옮겨 적으려는 사람이 있다.
 *
 * ## 규칙은 둘뿐이다
 *
 *  - **조합키가 하나라도 눌려 있으면 넘긴다.** 운전 조작에 조합키를 쓰는 것이 하나도
 *    없으므로, 눌려 있다는 것은 브라우저에게 하는 말이라는 뜻이다.
 *  - **글을 쓰는 칸에서는 물러난다.** 지금은 그런 칸이 없지만(사진은 파일 선택이다),
 *    생기는 날 이 처리기가 타이핑을 먹는다. 그때 원인을 찾기는 어렵다.
 *
 * 순수 함수라 브라우저 없이 검사한다 (tests/keyGuard.test.ts).
 */
export function leaveToBrowser(e: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /*
    `EventTarget` 이 아니라 **읽을 것만** 받는다 — 브라우저 없이 검사할 수 있게.
    `EventTarget` 자체에는 이 두 속성이 없어서 `unknown` 을 거쳐 좁힌다.
  */
  target?: unknown;
}): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;

  const el = e.target as { isContentEditable?: boolean; tagName?: string } | null | undefined;
  if (!el) return false;
  return Boolean(el.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? '');
}

interface PressedKeys {
  go: boolean;
  stop: boolean;
  left: boolean;
  right: boolean;
  /** 고개를 좌/우로 돌려 횡단보도 끝까지 확인 */
  glanceLeft: boolean;
  glanceRight: boolean;
}

export class Controls {
  private keys: PressedKeys = {
    go: false,
    stop: false,
    left: false,
    right: false,
    glanceLeft: false,
    glanceRight: false,
  };

  /**
   * 정지 상태 래치.
   * 신호나 보행자를 기다리는 동안 키를 계속 누르고 있게 하면 손이 아프고 학습에도 방해된다.
   * 그래서 정지는 '한 번 누르면 유지', 출발은 '한 번 누르면 해제'로 만든다.
   */
  private stopped = false;

  /** 터치 컨트롤 상태 */
  private touch = { steer: 0 };

  /**
   * **속도를 직접 고르는 코스인가** — 어린이보호구역 직진 연습편 (사용자가 정했다).
   *
   * 우회전 코스에서는 차가 알아서 속도를 맞춘다 — 거기서 배우는 것은 '언제 서는가' 이지
   * '얼마나 밟는가' 가 아니다. 보호구역 코스는 **30km/h 이하로 스스로 줄이는 것**이 배울
   * 내용이라, 위/아래로 목표 속도를 올리고 내린다.
   */
  private stepped = false;

  /** 고를 수 있는 목표 속도 (km/h) — 맨 아래는 정지다 */
  private static readonly SPEED_STEPS = [0, 10, 20, 30] as const;
  /** 지금 고른 단계 — 시작은 30km/h (보호구역 제한속도) */
  private speedStep = Controls.SPEED_STEPS.length - 1;

  /**
   * 우측 방향지시등. 우회전 시나리오이므로 처음부터 켜진 상태로 시작한다.
   * 이 게임의 목적은 신호 준수와 상황 판단이지 깜빡이 조작 숙달이 아니다.
   * (Q 로 끌 수는 있고, 끈 채로 교차로에 들어가면 제38조 위반으로 잡힌다)
   *
   * **직진 코스에서는 꺼진 채로 시작한다** — 돌지 않으므로 켤 의무가 없고, 켜면 오히려
   * 틀린 신호다. 판정도 직진에서는 지시등을 묻지 않는다 (rules/lawRules.ts).
   */
  rightSignal = true;
  private enabled = true;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private disposers: Array<() => void> = [];

  constructor(
    private canvas: HTMLElement,
    private cb: ControlCallbacks,
  ) {
    this.bindKeyboard();
    this.bindPointer();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.keys = {
        go: false,
        stop: false,
        left: false,
        right: false,
        glanceLeft: false,
        glanceRight: false,
      };
      this.touch = { steer: 0 };
      this.cb.onGlance(0);
    }
  }

  /**
   * **이 코스의 조작 방식을 정한다** — 직진(보호구역) 코스면 속도를 단계로 고르고 지시등은 끈 채로 둔다.
   * 판을 시작할 때 Game 이 한 번 부른다.
   */
  setStraight(on: boolean): void {
    this.stepped = on;
    this.rightSignal = !on;
    this.speedStep = Controls.SPEED_STEPS.length - 1;
  }

  /** 지금 고른 목표 속도 (km/h) — 단계 조작이 아닌 코스에서는 `null` */
  get targetKmh(): number | null {
    return this.stepped ? Controls.SPEED_STEPS[this.speedStep] : null;
  }

  reset(): void {
    this.rightSignal = !this.stepped;
    this.speedStep = Controls.SPEED_STEPS.length - 1;
    this.stopped = false;
    this.keys = {
      go: false,
      stop: false,
      left: false,
      right: false,
      glanceLeft: false,
      glanceRight: false,
    };
    this.touch = { steer: 0 };
    this.cb.onGlance(0);
  }

  private emitGlance(): void {
    const dir = this.keys.glanceRight ? 1 : this.keys.glanceLeft ? -1 : 0;
    this.cb.onGlance(dir);
  }

  /** 정지/진행 토글. 터치 버튼과 키보드가 함께 쓴다. */
  setStopped(on: boolean): void {
    this.stopped = on;
    this.cb.onStopChange?.(on);
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /**
   * 목표 속도를 한 칸 올리거나 내린다 (단계 코스).
   *
   * **0 칸은 정지와 같은 말이다** — 래치(`stopped`)도 함께 맞춰 둔다. 그래야 화면의 정지 표시,
   * 소리, AI 말풍선이 지금까지의 '정지' 와 같은 것을 보고 말한다.
   */
  /** 화면 버튼이 부르는 속도 조절 — 키보드의 ↑ · ↓ 와 같은 일을 한다 */
  nudgeSpeed(dir: 1 | -1): void {
    if (this.stepped) this.shiftSpeed(dir);
  }

  private shiftSpeed(dir: 1 | -1): void {
    const next = Math.max(0, Math.min(Controls.SPEED_STEPS.length - 1, this.speedStep + dir));
    if (next === this.speedStep) return;
    this.speedStep = next;
    /*
      **칸이 바뀔 때마다 알린다.** `setStopped` 은 멈춤 여부가 실제로 바뀔 때만 알리므로
      (30 → 20 처럼 가는 중의 변화는 조용하다), 화면의 목표 속도 표시가 따라오지 않았다.
    */
    this.setStopped(Controls.SPEED_STEPS[next] === 0);
    this.cb.onStopChange?.(this.stopped);
  }

  private bindKeyboard(): void {
    const down = (e: KeyboardEvent) => {
      /*
        **`up` 에는 이 검사를 걸지 않는다.** A 를 눌러 조향하다가 Ctrl 을 누른 채로 A 를
        떼면, 거기서도 걸러 버리면 그 키가 눌린 채로 남는다 — 차가 계속 돈다.
      */
      if (leaveToBrowser(e)) return;

      if (e.code === 'KeyQ') {
        e.preventDefault();
        this.rightSignal = !this.rightSignal;
        this.cb.onToggleSignal();
        return;
      }
      if (e.code === 'KeyC') {
        e.preventDefault();
        this.cb.onToggleView();
        return;
      }
      if (e.code === 'KeyR') {
        e.preventDefault();
        this.cb.onRestart();
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        this.cb.onPause();
        return;
      }
      if (e.code === 'KeyE') {
        e.preventDefault();
        this.cb.onRecenter();
        return;
      }
      const k = KEYMAP[e.code];
      if (k && this.enabled) {
        e.preventDefault();
        if (e.repeat) return;
        this.keys[k] = true;
        /*
          **단계 코스에서는 위/아래가 속도를 한 칸씩 옮긴다** (0 · 10 · 20 · 30km/h).
          맨 아래 칸이 정지라, 지금까지의 '아래 = 정지 · 위 = 출발' 과 손가락이 같은 자리에 있다.
        */
        if (this.stepped && (k === 'go' || k === 'stop')) this.shiftSpeed(k === 'go' ? 1 : -1);
        else if (k === 'stop') this.setStopped(true);
        else if (k === 'go') this.setStopped(false);
        if (k === 'glanceLeft' || k === 'glanceRight') this.emitGlance();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      this.keys[k] = false;
      if (k === 'glanceLeft' || k === 'glanceRight') this.emitGlance();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.disposers.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    });
  }

  /** 마우스/터치 드래그로 시선 돌리기 */
  private bindPointer(): void {
    const start = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = (e.clientX - this.lastPointer.x) / window.innerWidth;
      const dy = (e.clientY - this.lastPointer.y) / window.innerHeight;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.cb.onLook(-dx * 3.4, -dy * 2.2);
    };
    const end = (e: PointerEvent) => {
      this.dragging = false;
      this.canvas.releasePointerCapture?.(e.pointerId);
    };
    this.canvas.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    this.disposers.push(() => {
      this.canvas.removeEventListener('pointerdown', start);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    });
  }

  /** 모바일 조향 버튼과 연결한다 (정지/진행은 별도 토글 버튼) */
  attachSteerButton(el: HTMLElement, action: 'left' | 'right'): void {
    const on = (e: Event) => {
      e.preventDefault();
      this.touch.steer = action === 'left' ? -1 : 1;
    };
    const off = (e: Event) => {
      e.preventDefault();
      this.touch.steer = 0;
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
    this.disposers.push(() => {
      el.removeEventListener('pointerdown', on);
      el.removeEventListener('pointerup', off);
      el.removeEventListener('pointercancel', off);
      el.removeEventListener('pointerleave', off);
    });
  }

  read(): VehicleInput {
    if (!this.enabled) {
      return { stop: true, steer: 0, rightSignal: this.rightSignal };
    }
    let steer = 0;
    if (this.keys.left) steer -= 1;
    if (this.keys.right) steer += 1;
    if (steer === 0) steer = this.touch.steer;

    return {
      stop: this.stopped,
      steer,
      rightSignal: this.rightSignal,
      ...(this.stepped ? { targetKmh: Controls.SPEED_STEPS[this.speedStep] } : {}),
    };
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
