/**
 * **나쁜 운전 습관** — 이 사람이 반복해서 저지르는 위반의 기록.
 *
 * AI 우회전 주행의 판을 만드는 근거가 이것이다. 무엇을 가르칠지는 커리큘럼의 단계가
 * 정하고, **무엇을 시험할지는 이 목록이 정한다.**
 *
 * ## 왜 횟수만으로는 모자란가
 *
 * 처음에는 위반 코드별 횟수만 세었다. 그런데 그 숫자는 **줄지 않는다.** 정지선을 세 번
 * 넘긴 사람이 그 뒤 열 판을 완벽하게 몰아도 기록에는 여전히 "정지선 위반 3회" 가 남아,
 * AI 는 이미 고친 습관을 계속 시험하는 판을 만든다. 학습자 입장에서는 나아졌는데도
 * 같은 상황만 되풀이해서 나온다.
 *
 * 그래서 **고쳐지면 사라지게** 한다.
 *
 *  - 위반하면 그 습관이 생기거나 세어진다 (그리고 고친 기록은 0 으로 되돌아간다)
 *  - **그 위반이 일어날 수 있었던 판**에서 3번 지키면 목록에서 지운다 — 고쳤다고 본다.
 *    시험하지 않은 판(적색 습관에 녹색 판)과 끝내지 못한 판은 세지 않는다 (`tested` · `failed`)
 *
 * 목록이 비면 AI 는 이 게임이 교정하려는 흔한 오해 중 하나를 골라 시험한다.
 *
 * ## 2번인 이유
 *
 * 한 번은 운이다 — 그 판이 그 위반을 시험조차 하지 않았을 수 있다. 다섯 번은 길어서,
 * 고친 뒤에도 한참 같은 상황을 만나게 된다.
 *
 * **세 번이었다가 두 번으로 줄였다** (사용자가 정했다). 습관이 남아 있는 동안은 레벨이 오르지
 * 않으므로(curriculum.ts), 이 수가 곧 **고친 것이 화면에서 사라지기까지의 길이**다. 세 번이면
 * 한 습관을 떼는 데 최소 세 판이 들고, 습관이 둘이면 그동안 막대가 차 있어도 계속 기다리게 된다.
 * 두 번이면 "우연히 안 걸렸다" 는 여전히 걸러 내면서(한 번이 아니다) 고친 보람이 더 빨리 온다.
 */

import { VIOLATIONS, type ViolationCode } from '../rules/violations';

/** 이 횟수만큼 그 위반 없이 몰면 습관이 사라진다 */
export const HABIT_CLEARED_AFTER = 2;

/** 한 사람에게 동시에 붙어 있는 습관의 상한 — 많으면 무엇을 고쳐야 할지 흐려진다 */
const MAX_HABITS = 6;

export interface BadHabit {
  code: ViolationCode;
  /** 지금까지 몇 번 저질렀는가 (고쳐서 사라지기 전까지 누적) */
  count: number;
  /**
   * 이 위반 **없이** 지나온 연속 판 수.
   *
   * `HABIT_CLEARED_AFTER` 에 닿으면 목록에서 빠진다. 다시 저지르면 0 으로 돌아간다.
   */
  cleanRuns: number;
  /** 마지막으로 저지른 판 번호 (이 과정에서 몇 번째 판이었나) */
  lastRun: number;
}

/** 한 판을 치른 뒤 습관 목록에 일어난 일 — 결과 화면이 이것을 그대로 보여 준다 */
export interface HabitChange {
  /** 이번에 새로 생긴 습관 */
  added: ViolationCode[];
  /** 이번에 또 저질러 굳어진 습관 */
  repeated: ViolationCode[];
  /** 이번 판으로 **고쳐져 사라진** 습관 */
  cleared: ViolationCode[];
}

export const emptyChange = (): HabitChange => ({ added: [], repeated: [], cleared: [] });

/**
 * 한 판의 위반 목록을 받아 습관 기록을 갱신한다. **순수 함수다.**
 *
 * @param runIndex 이 과정에서 몇 번째 판인가 (기록용)
 */
export function updateHabits(
  habits: readonly BadHabit[],
  violated: readonly ViolationCode[],
  runIndex: number,
  /**
   * 이 판에서 **일어날 수 있었던** 위반 (library.ts 의 `habitsTestedBy`). 여기 없는 습관은
   * 지키지도 어기지도 않은 것이라 고친 판 수를 세지 않는다. 생략하면 모든 습관을 시험한 것으로 본다.
   */
  tested?: ReadonlySet<ViolationCode>,
  /** 사고 · 이탈 · 시간 초과로 **끝내지 못한 판** — 무엇을 지켰는지 알 수 없어 세지 않는다 */
  failed = false,
): { habits: BadHabit[]; change: HabitChange } {
  const hit = new Set(violated);
  const change = emptyChange();
  const out: BadHabit[] = [];

  for (const h of habits) {
    if (hit.has(h.code)) {
      // 또 저질렀다 — 고친 기록은 처음으로 돌아간다
      out.push({ ...h, count: h.count + 1, cleanRuns: 0, lastRun: runIndex });
      change.repeated.push(h.code);
      continue;
    }

    // 시험하지 않은 습관 · 끝내지 못한 판 — 고친 기록을 올리지도 되돌리지도 않는다
    if (failed || (tested && !tested.has(h.code))) {
      out.push(h);
      continue;
    }
    const cleanRuns = h.cleanRuns + 1;
    if (cleanRuns >= HABIT_CLEARED_AFTER) {
      change.cleared.push(h.code);
      continue; // 목록에서 빠진다
    }
    out.push({ ...h, cleanRuns });
  }

  // 처음 보는 위반은 새 습관이 된다
  for (const code of hit) {
    if (out.some((h) => h.code === code)) continue;
    if (!Object.prototype.hasOwnProperty.call(VIOLATIONS, code)) continue;
    out.push({ code, count: 1, cleanRuns: 0, lastRun: runIndex });
    change.added.push(code);
  }

  /*
    **많이 저지른 것부터 남긴다.** 상한을 두는 이유는 목록이 길어지면 AI 도 학습자도
    무엇을 먼저 고쳐야 할지 알 수 없기 때문이다. 잘려 나간 것은 다시 저지르면 돌아온다.
  */
  out.sort((a, b) => b.count - a.count || b.lastRun - a.lastRun);
  return { habits: out.slice(0, MAX_HABITS), change };
}

/**
 * AI 가 이번 판에서 **정면으로 시험할** 습관. 없으면 `null`.
 *
 * 가장 많이 저지른 것을 고른다 — 고쳐야 할 것이 여럿이면 가장 굳은 것부터다.
 */
export function primaryHabit(habits: readonly BadHabit[]): BadHabit | null {
  return habits.length ? habits[0] : null;
}

/** 화면과 프롬프트가 함께 쓰는 이름 */
export const habitTitle = (code: ViolationCode): string => VIOLATIONS[code]?.title ?? code;

/** 이 습관을 고치려면 앞으로 몇 판을 더 깨끗하게 몰아야 하는가 */
export const runsToClear = (h: BadHabit): number => Math.max(0, HABIT_CLEARED_AFTER - h.cleanRuns);
