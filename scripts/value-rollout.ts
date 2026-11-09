/**
 * **가치 신경망의 학습 자료** — 예전 프로그램(recommendSim.ts 의 programPick)이 가상 운전자를 60판씩 가르치며 고를 때마다
 * 그 상태(scripts/recommendValue.ts 의 valueState — 운전자의 속 + 게임의 과정)와 그 판의 보상 둘(더 알게 된 개념의 기댓값 ·
 * 레벨 나아감)을 적는다. scripts/train-value.py 가 GPU 로 읽어 '여기서 끝까지 가면 얼마나 더' 를 배운다.
 *
 *   node value-rollout.mjs --from 0 --n 1000 --out DIR/w0     # 일꾼 하나 (scripts/train-value.py 가 여럿 띄운다)
 */
import { writeFileSync } from 'node:fs';

import { TRAIN_KIND, decide, installSim, makeEpisode, play, programPick, seedGame } from './recommendSim';
import { VALUE_RUNS, progressOf, valueState } from './recommendValue';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'value';
const FROM = arg('from', 0);
const N = arg('n', 100);

installSim();
const xs: number[] = [];
const rk: number[] = [];
const rp: number[] = [];
const who: number[] = [];
for (let i = FROM; i < FROM + N; i++) {
  // 씨앗은 행동 복제(round × 10만)·견주기(100만 · 200만 · 900만)와 겹치지 않는 500만부터
  const seed = 5_000_000 + i;
  const ep = makeEpisode(seed, TRAIN_KIND);
  seedGame(seed);
  for (let run = 0; run < VALUE_RUNS; run++) {
    const d = decide(ep, false, true);
    if (!d.pool.length) break;
    xs.push(...valueState(ep, run));
    const k0 = ep.expKnown;
    const p0 = progressOf(ep);
    play(ep, programPick(d));
    rk.push(ep.expKnown - k0);
    rp.push(progressOf(ep) - p0);
    who.push(i);
  }
}
writeFileSync(`${OUT}-x.f32`, new Float32Array(xs));
writeFileSync(`${OUT}-rk.f32`, new Float32Array(rk));
writeFileSync(`${OUT}-rp.f32`, new Float32Array(rp));
writeFileSync(`${OUT}-ep.f32`, new Float32Array(who));
console.log(rk.length);
