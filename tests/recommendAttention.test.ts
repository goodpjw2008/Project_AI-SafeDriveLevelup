import { describe, expect, it } from 'vitest';

import trained from '../src/ai/models/recommend-attn.json';
import { attentionModelReady, attentionScores, type AttnModel } from '../src/ai/recommendAttention';
import { TURN_CLASSES, recommendFeatures, turnFeatures } from '../src/ai/recommendNet';
import type { Difficulty } from '../src/scenarios/curriculum';
import type { Plan } from '../src/scenarios/generate';
import {
  courseInputs,
  coverageOf,
  eligibleFor,
  recentSet,
  seenShapes,
  turnClassOf,
  turnContext,
  turnInputs,
  verdictsFor,
} from '../src/scenarios/recommend';

/*
  **어텐션은 실제로 고르기를 바꿔야 한다** — 사용자가 정했다 (2026-11-05: *"어텐션을 쓰는 장점이 있어야해"*). 설정 '로컬 신경망' 을 스승으로
  따라 배운 모델은 숫자가 더 좋았지만 어텐션을 빼도 1등 판이 한 번도 바뀌지 않아, 구조만 어텐션이고 동작은 설정 1번의 복사본이었다.
  그런 모델이 다시 들어오면 설정을 나눈 뜻이 없어지므로 여기서 걸린다 (넣어 둔 모델은 84% 자리에서 1등 판이 바뀐다).
*/
describe.runIf(attentionModelReady())('어텐션이 고르기를 바꾼다', () => {
  const model = trained as unknown as AttnModel;
  const noToken: AttnModel = { ...model, ow: model.ow.map(() => 0), ob: 0 };
  const top = (v: readonly number[]) => v.indexOf(Math.max(...v));

  it('어텐션의 점수를 빼면 1등 판이 달라지는 자리가 절반이 넘는다', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let spots = 0;
    let changed = 0;
    for (const level of [2, 3, 4, 5, 6, 7, 8, 9, 10] as Difficulty[]) {
      for (const runs of [6, 12, 18]) {
        const plan = { level, target: null, badHabits: [], schoolZone: false, zoneNoSignal: false, noSignalZoneDue: false, lead: null } as unknown as Plan;
        const first = eligibleFor(plan, []);
        const played = Array.from({ length: runs }, () => first[Math.floor(rnd() * first.length)].spec.id);
        const eligible = eligibleFor(plan, played);
        const pool = Array.from({ length: Math.min(400, eligible.length) }, () => eligible[Math.floor(rnd() * eligible.length)]);
        const seen = seenShapes(played);
        const cover = coverageOf(played, level);
        const turns = turnContext(played);
        const verdict = verdictsFor(plan, cover);
        const recent = recentSet(played);
        const rows = pool.map((e) => recommendFeatures(courseInputs(plan, e, seen, cover, verdict, turns, recent)));
        const have = new Set(eligible.map(turnClassOf));
        const scene = {
          classes: pool.map((e) => TURN_CLASSES.indexOf(turnClassOf(e))),
          ctx: [...turnFeatures(turnInputs(plan, turns, cover)), ...TURN_CLASSES.map((c) => (have.has(c) ? 1 : 0))],
        };
        spots += 1;
        if (top(attentionScores(rows, model, scene).final) !== top(attentionScores(rows, noToken, scene).final)) changed += 1;
      }
    }
    expect(changed / spots).toBeGreaterThan(0.5);
  });
});
