/**
 * **앞을 내다보는 교사 — 가치 신경망 + 한 판 미리 달려 보기** (학습에만 쓴다 · 게임에서는 돌지 않는다).
 *
 * 다음 판 추천 신경망이 따라 배울 정답을 내는 교사다. 예전 프로그램(recommendSim.ts 의 programPick)을 그대로 따라 배우면
 * 신경망이 프로그램보다 나을 수 없고, 강화학습(PPO)은 한 판의 고르기가 60판 끝의 아는 개념 수를 0.05 쯤 바꾸는데 운전자의
 * 운이 2 개념쯤 흔들어 신호가 잡음에 묻혔다 (2026-11-01, 네 번 해 봐 모두 프로그램보다 익힌 개념 0.1 남짓 적었다). 그래서
 * 정책 반복(approximate policy iteration — AlphaZero 의 '탐색으로 더 나은 정답을 만들고 신경망이 따라 배운다' 와 같은 짜임)을 쓴다:
 *
 * 1. **가치 신경망** — 프로그램이 가상 운전자 2만 명을 60판씩 가르친 자료(scripts/value-rollout.ts)로, 지금 상태에서 끝까지
 *    가면 **더 알게 될 개념 수 · 더 나아갈 레벨**을 맞힌다 (scripts/train-value.py, GPU). 상태는 가상 운전자의 **속**(개념마다 아는지 ·
 *    기억의 세기 · 지금 떠올릴 확률 · 익히는 빠르기)과 게임의 과정(레벨 · 경험치 · 습관 · 학습자 모델)이다 — 시뮬레이터 안이라서만
 *    볼 수 있는 것이고, 그래서 교사만 쓴다. 신경망(게임)은 브라우저가 아는 것만 본다.
 * 2. **교사** — 고를 차례마다 후보(프로그램이 추린 최종 후보)를 하나씩 **같은 운(공통 난수)으로 R 번** 한 판 달려 보고,
 *    (그 판에서 더 알게 된 개념의 기댓값 + λ × 레벨 나아감) + 가치 신경망이 본 그 뒤의 값이 가장 큰 판을 고른다.
 *
 * 한 판 앞만 보는 교사(이번 판에 가장 많이 가르칠 판)는 익힌 개념을 늘리는 만큼 레벨을 잃었다 — 배움은 어기는 판에서 일어나는데
 * 어긴 판은 레벨을 막는다. 가치 신경망이 '어겨서 생긴 습관이 몇 판 뒤 레벨을 막는 값' 까지 보므로 이 교사는 그 맞바꿈을 벗어난다:
 * 처음 보는 가상 운전자 800명에서 λ 0.3 이면 프로그램보다 익힌 개념 +0.07 · 레벨 +0.62, λ 0.1 이면 +0.13 · 레벨 같음 (2026-11-02).
 */
import { SKILL_ORDER, effectiveMastery, wasTested } from '../src/ai/knowledge';
import { runsToClear } from '../src/coach/badHabits';
import { challengeRule } from '../src/scenarios/challenge';
import { xpToNext } from '../src/scenarios/curriculum';
import type { LibraryEntry } from '../src/scenarios/library';
import { cloneEpisode, knownCount, play, programPick, rng, seedGame, type Decision, type Episode } from './recommendSim';

/** 한 사람이 밟는 판 수 — 가치 신경망은 '남은 판' 을 입력으로 본다 */
export const VALUE_RUNS = 60;
const TRACKS = ['auto', 'turn', 'zone', 'both'];

/** 과정의 나아감 — 레벨 + 경험치 몫 + 마스터 (recommendSim.ts 의 rewardWorth 와 같은 자) */
export function progressOf(ep: Episode): number {
  const c = ep.save.curriculum;
  const need = xpToNext(c.level, challengeRule(ep.save.settings.difficulty));
  return c.level + Math.min(1, (c.xp ?? 0) / need) + (c.mastered ? 1 : 0);
}

/** 가치 신경망의 입력 — 개념마다 일곱(속 넷 · 학습자 모델 둘 · 습관) + 과정 · 설정 */
export function valueState(ep: Episode, run: number): number[] {
  const l = ep.learner;
  const now = ep.clockMs / 3_600_000;
  const c = ep.save.curriculum;
  const k = c.skills ?? {};
  const habit: Record<string, number> = {};
  for (const h of c.badHabits) habit[h.code] = (habit[h.code] ?? 0) + h.count;
  const x: number[] = [];
  for (const code of SKILL_ORDER) {
    const hl = Math.min(24 * 60, l.halfLife * 2 ** (0.6 * Math.max(0, l.strength[code] - 1)));
    x.push(
      l.known[code] ? 1 : 0,
      Math.min(6, l.strength[code]) / 6,
      l.known[code] ? 2 ** (-Math.max(0, now - l.last[code]) / hl) : 0,
      l.learn[code] * 2,
      effectiveMastery(k, code, ep.clockMs),
      wasTested(k, code) ? 1 : 0,
      Math.min(3, habit[code] ?? 0) / 3,
    );
  }
  const need = xpToNext(c.level, challengeRule(ep.save.settings.difficulty));
  const debt = c.badHabits.reduce((s, h) => s + runsToClear(h, c.skills), 0);
  x.push(
    Math.log(l.halfLife) / 5,
    l.ability / 3,
    ep.sessionLeft / 15,
    c.level / 10,
    Math.min(1, (c.xp ?? 0) / need),
    c.mastered ? 1 : 0,
    Math.min(5, c.missStreak) / 5,
    Math.min(5, c.cleanStreak) / 5,
    c.badHabits.length / 3,
    Math.min(10, debt) / 10,
    knownCount(l) / SKILL_ORDER.length,
    (VALUE_RUNS - run) / VALUE_RUNS,
    ep.save.settings.difficulty / 5,
    ...TRACKS.map((t) => (ep.save.settings.track === t ? 1 : 0)),
  );
  return x;
}

/** 가치 신경망 (scripts/train-value.py 가 쓴 JSON) — 머리 둘: 끝까지 더 알게 될 개념 · 더 나아갈 레벨 */
export interface ValueNet {
  layers: { w: number[][]; b: number[] }[];
  mean: number[];
  std: number[];
}

export function valueOf(v: ValueNet, x: readonly number[]): [number, number] {
  // 학습 자료에서 늘 같던 입력(어느 후보도 묻지 않은 개념)이 낯선 값을 받아도 터지지 않게 ±6 표준편차에서 자른다
  let h = x.map((xi, i) => Math.max(-6, Math.min(6, (xi - v.mean[i]) / v.std[i])));
  v.layers.forEach((L, li) => {
    const out = new Array<number>(L.b.length);
    for (let j = 0; j < L.b.length; j++) {
      let s = L.b[j];
      const w = L.w[j];
      for (let i = 0; i < h.length; i++) s += w[i] * h[i];
      out[j] = li < v.layers.length - 1 ? Math.max(0, s) : s;
    }
    h = out;
  });
  return [h[0], h[1]];
}

export interface LookaheadOptions {
  value: ValueNet;
  /** 레벨 하나의 무게 — 개념 하나를 1 로 칠 때 */
  lambda: number;
  /** 후보마다 미리 달려 보는 횟수 */
  rollouts: number;
}

/**
 * **교사가 고르는 판** — 프로그램이 추린 최종 후보(마스터 운행이면 프로그램이 고른 한 판뿐)를 한 판씩 같은 운으로 달려 보고
 * 값이 가장 큰 판. `seed` 는 이 사람 · 이 차례의 운을 정한다 (후보끼리 같다). 끝나면 게임의 난수(Math.random)를 `seed` 로 다시 세운다.
 *
 * 후보를 탈 수 있는 판 전부로 넓히면(무작위 10판 더) 가치 신경망이 처음 보는 상태(프로그램이 고르지 않는 판 뒤)에서 크게 빗나가
 * 레벨이 1 ~ 2.7 떨어졌다 — 그래서 프로그램이 추린 후보 안에서만 고른다. 신경망은 그 고르기를 탈 수 있는 판 전부에서 찾도록 배운다.
 */
export function lookaheadPick(ep: Episode, d: Decision, run: number, seed: number, opt: LookaheadOptions): LibraryEntry {
  const prog = programPick(d);
  const cands: LibraryEntry[] = [prog];
  if (!d.plan.master) for (const e of d.courses) if (!cands.includes(e)) cands.push(e);
  const q = lookaheadValues(ep, cands, run, seed, opt);
  seedGame(seed * 13 + run);
  return cands[q.indexOf(Math.max(...q))];
}

/**
 * 후보마다 교사의 값 — 그 판을 같은 운으로 `rollouts` 번 달려 본 (그 판의 보상 + λ × 레벨 나아감 + 가치 신경망이 본 그 뒤의 값) 의 평균.
 * 게임의 난수(Math.random)를 건드리므로 부른 쪽이 다시 세운다.
 */
export function lookaheadValues(ep: Episode, cands: readonly LibraryEntry[], run: number, seed: number, opt: LookaheadOptions): number[] {
  return cands.map((e) => {
    let q = 0;
    for (let k = 0; k < opt.rollouts; k++) {
      const s = seed * 7919 + run * 613 + k * 104729;
      const sim = cloneEpisode(ep, rng(s + 1));
      seedGame(s + 2);
      const k0 = sim.expKnown;
      const p0 = progressOf(sim);
      play(sim, e);
      q += sim.expKnown - k0 + opt.lambda * (progressOf(sim) - p0);
      if (run + 1 < VALUE_RUNS) {
        const [vk, vp] = valueOf(opt.value, valueState(sim, run + 1));
        q += vk + opt.lambda * vp;
      }
    }
    return q / opt.rollouts;
  });
}
