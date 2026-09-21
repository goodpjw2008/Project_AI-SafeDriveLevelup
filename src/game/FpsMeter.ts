/**
 * fps 표시.
 *
 * 화질 설정을 만들면서 같이 넣었다. **설명문 열 줄보다 이것 하나가 낫다** — 기기 성능은
 * 사람마다 다르고 화면에서 재 볼 방법이 없으니, 손잡이를 내렸을 때 숫자가 실제로 올라가는
 * 것을 보고 정하게 하는 편이 정확하다.
 *
 * **재는 것은 '그린 횟수'다.** 프레임 상한을 걸면 물리는 그대로 돌고 그리는 것만
 * 건너뛰는데(Game 의 루프), 그때 숫자가 안 내려가면 상한이 걸린 줄 알 수 없다.
 */
export class FpsMeter {
  private frames = 0;
  private windowStart = 0;
  /** 최근 1초 동안의 프레임 수 */
  private value = 0;

  sample(now: number): void {
    if (this.windowStart === 0) {
      this.windowStart = now;
      return;
    }
    this.frames += 1;
    const span = now - this.windowStart;
    if (span < 500) return;
    this.value = Math.round((this.frames * 1000) / span);
    this.frames = 0;
    this.windowStart = now;
  }

  get fps(): number {
    return this.value;
  }
}
