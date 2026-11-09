/**
 * **견주기 — 같은 가상 운전자를 예전 프로그램과 어텐션 신경망이 따로 60판씩** (강화학습 · 교사 실험과 같은 사람들: 씨앗 900만부터).
 * 한 줄에 한 사람: [프로그램 — 익힌 개념 · 그 기댓값 · 레벨, 신경망 — 같은 셋]. 여러 개를 나눠 띄우고 합쳐 짝지은 차이를 본다.
 *
 *   node attn-eval.mjs --model recommend-attn.json --from 0 --n 200 [--pool 2000]
 */
import { readFileSync } from 'node:fs';

import type { AttnModel } from '../src/ai/recommendAttention';
import { attnPick } from './attnPolicy';
import { TRAIN_KIND, decide, installSim, knownCount, makeEpisode, play, programPick, rng, seedGame } from './recommendSim';

const args = process.argv.slice(2);
const sarg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = JSON.parse(readFileSync(sarg('model')!, 'utf8')) as AttnModel;
const FROM = Number(sarg('from') ?? 0);
const N = Number(sarg('n') ?? 200);
// 게임은 탈 수 있는 판에서 2,000판을 뽑아 그중 갈래의 판을 채점한다 (recommend.ts 의 AI_SAMPLE) — 갈래 안 판은 대개 그보다 적다
const POOL_N = Number(sarg('pool') ?? 2000);

installSim();
const out: number[][] = [];
for (let i = FROM; i < FROM + N; i++) {
  const seed = 9_000_000 + i;
  const row: number[] = [];
  for (const policy of ['program', 'net']) {
    // --noprog 1: 프로그램은 같은 씨앗이면 늘 같다 — 한 번 잰 값을 합칠 때 쓰고 다시 달리지 않는다
    if (policy === 'program' && sarg('noprog') === '1') {
      row.push(0, 0, 0);
      continue;
    }
    const ep = makeEpisode(seed, TRAIN_KIND);
    const r = rng(seed * 17 + 3);
    seedGame(seed);
    const k0 = knownCount(ep.learner);
    const e0 = ep.expKnown;
    for (let run = 0; run < 60; run++) {
      // 프로그램이 한 판이라도 고르면 최종 후보(coursesByHabit)를 세어 둔다
      const d = decide(ep, false, policy === 'program' || process.env.MASTERNET === '1' || process.env.MASTERPROG === '1');
      if (!d.pool.length) break;
      // 진단 — MASTERPROG=1 이면 마스터 운행만 프로그램(masterPick)이 고른다
      const useProg =
        policy === 'program' ||
        (process.env.MASTERPROG === '1' && d.plan.master) ||
        (process.env.MASTERNET === '1' && !d.plan.master);
      play(ep, useProg ? programPick(d) : attnPick(d, model, r, POOL_N));
    }
    row.push(knownCount(ep.learner) - k0, ep.expKnown - e0, ep.save.curriculum.level + (ep.save.curriculum.mastered ? 1 : 0));
  }
  out.push(row);
}
console.log(JSON.stringify(out));
