/**
 * 화면 이동 — **브라우저의 뒤로가기와 같은 것을 쓴다.**
 *
 * 예전에는 화면 전환이 클래스 토글뿐이라 `history` 에 아무것도 쌓이지 않았다. 그래서
 * 뒤로가기를 누르면(모바일에서는 화면 가장자리를 밀면) 전시관에서 첫 화면으로 가는 것이
 * 아니라 **게임을 통째로 나갔다.** 처음 쓰는 사람이 가장 크게 당황하는 지점이었다.
 *
 * 여기서 하는 일은 화면 하나를 히스토리 한 칸에 대응시키는 것뿐이다.
 *
 *   go()      새 화면으로 들어간다 — 히스토리가 한 칸 쌓인다
 *   replace() 같은 자리를 다시 그린다 — 설정에서 항목을 고르는 것처럼, 되돌아갈 곳이
 *             '고르기 전의 설정 화면'이면 뒤로가기를 여러 번 눌러야 나갈 수 있다
 *   back()    한 칸 되돌아간다 (뒤로 버튼 · Esc · 배경 클릭이 모두 이것을 부른다)
 *   reset()   첫 화면으로 되돌리고 쌓인 칸을 버린다
 *
 * **주소는 해시(#shop)로만 남긴다.** 경로(/shop)를 쓰면 그 주소로 새로고침했을 때 서버가
 * 404 를 주므로 정적 호스팅 설정이 필요해진다 — 이 게임은 `dist/` 를 그대로 올리는 것이
 * 배포의 전부여야 한다.
 */

export interface Route {
  /** 주소창 해시에 남는 이름. 화면 종류를 구분하기만 하면 된다. */
  name: string;
  /**
   * 이 자리로 들어올 때 화면을 그린다.
   *
   * **앞으로 갈 때든 뒤로 올 때든 똑같이 불린다.** 그래서 여러 번 불려도 같은 결과가
   * 나와야 한다 — 화면을 그리는 함수(goShop·goSettings…)는 원래 그렇게 되어 있다.
   */
  enter(): void;
}

interface HistoryState {
  /** stack 안에서의 자리 */
  i: number;
}

class Nav {
  private stack: Route[] = [];
  private index = -1;
  private started = false;

  /**
   * 첫 화면을 깐다. 쌓여 있던 칸은 버린다.
   *
   * 주행을 마치고 홈으로 돌아왔을 때처럼 "여기가 출발점"으로 되돌리는 자리다.
   * `replaceState` 라 브라우저의 뒤로가기 목록에는 새 칸이 생기지 않는다.
   */
  reset(route: Route): void {
    this.stack = [route];
    this.index = 0;
    history.replaceState({ i: 0 } satisfies HistoryState, '', `#${route.name}`);
    this.listen();
    route.enter();
  }

  /** 새 화면으로 들어간다 */
  go(route: Route): void {
    if (this.index < 0) {
      this.reset(route);
      return;
    }
    // 뒤로 왔다가 다른 곳으로 가면 앞쪽 칸은 버린다 — 브라우저 히스토리와 같은 규칙이다
    this.stack.length = this.index + 1;
    this.stack.push(route);
    this.index = this.stack.length - 1;
    history.pushState({ i: this.index } satisfies HistoryState, '', `#${route.name}`);
    route.enter();
  }

  /** 지금 자리를 새 화면으로 갈아 끼운다 (히스토리는 늘지 않는다) */
  replace(route: Route): void {
    if (this.index < 0) {
      this.reset(route);
      return;
    }
    this.stack[this.index] = route;
    history.replaceState({ i: this.index } satisfies HistoryState, '', `#${route.name}`);
    route.enter();
  }

  /** 한 칸 되돌아간다. 첫 화면이면 아무 일도 하지 않는다 (게임을 나가면 안 된다). */
  back(): void {
    if (this.index <= 0) return;
    history.back();
  }

  /** 되돌아갈 곳이 있는가 — 뒤로 버튼을 그릴지 판단하는 데 쓴다 */
  get canGoBack(): boolean {
    return this.index > 0;
  }

  /** 지금 화면의 이름 */
  get current(): string | null {
    return this.stack[this.index]?.name ?? null;
  }

  private listen(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('popstate', (e) => {
      const state = e.state as HistoryState | null;
      /*
        새로고침하면 히스토리 칸은 남아 있지만 stack 은 비어 있다. 그럴 때는 첫 화면으로
        떨어뜨린다 — 없는 자리로 들어가려다 빈 화면이 되는 것보다 낫다.
      */
      const i = state && Number.isInteger(state.i) ? state.i : 0;
      this.index = Math.max(0, Math.min(i, this.stack.length - 1));
      this.stack[this.index]?.enter();
    });
  }
}

export const nav = new Nav();
