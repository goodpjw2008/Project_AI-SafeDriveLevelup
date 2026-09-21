/**
 * 라이브러리 **전체 검증**을 나눠 돌리는 도우미 — tests/library.validate.*.test.ts 가 쓴다.
 *
 * 6천 판을 한 파일에서 검증하면 100초 가까이 걸린다. 파일을 넷으로 나누면 vitest 가 작업자
 * 여럿에서 **동시에** 돌려 전체 시간이 그만큼 준다. 판은 id 순서대로 번갈아 나눈다.
 */

import { describe, expect, it } from 'vitest';

import { challengeRule } from '../src/scenarios/challenge';
import { libraryNumber, scenarioLibrary } from '../src/scenarios/library';
import { playScenario } from '../src/scenarios/playSim';
import { describeIssues, validateScenario } from '../src/scenarios/validate';

export const SHARDS = 4;

export function validateShard(shard: number): void {
  describe(`시나리오 라이브러리 전체 검증 (${shard + 1}/${SHARDS})`, () => {
    it(
      '모든 판이 검증을 통과한다 — 치명도 경고도 없이',
      () => {
        const bad: string[] = [];
        scenarioLibrary().forEach((e, i) => {
          if (i % SHARDS !== shard) return;
          const r = validateScenario(e.spec);
          if (!r.ok || r.issues.length) bad.push(`${e.spec.id} ${e.spec.title}\n${describeIssues(r.issues)}`);
        });
        expect(bad, bad.slice(0, 5).join('\n')).toEqual([]);
      },
      180_000,
    );

    /*
      **실제 차로 달려 본다** (src/scenarios/playSim.ts — 게임과 같은 차 · 보행자 · 앞차 · 판정).

      검증기의 운전자는 이상적이라(속도가 순간에 바뀐다) 교차로에 실제보다 일찍 닿는다. 그래서 "정체가 풀린 뒤에야
      닿는다" · "보행신호가 바뀐 뒤에야 닿는다" · "앞차 바로 뒤라 사람이 나설 틈이 없다" 같은 것을 보지 못했다 —
      시나리오 플레이테스트(.claude/skills/scenario-playtest)가 실제 차로 달려 찾아냈다. 여기서는 그중 세 가지를 못 박는다.

      1. 규정대로 모는 사람(게임의 AI 자율 주행)은 위반 없이 끝낸다
      2. 1초 늦게 알아차리는 사람도 기본 난이도(3)에서 위반 없이 끝낸다 — 사람이 보고 설 수 있어야 한다
      3. **판에 선 보행자는 역할이 있다** — 신호는 지키지만 보행자를 보지 않는 사람은 보행자 위반으로 걸린다.
         4927번(우회전신호 적색 · 우회전 후 건너려는 어린이)에서 녹색 화살표를 기다리는 사이 어린이가 뜻을 접어 버린
         것을 사용자가 짚었고, 같은 까닭으로 역할이 없던 판이 앞차 판을 중심으로 1,500개 넘게 있었다.
    */
    it(
      '실제 차로 달려 보면 — 규정대로 통과하고, 사람도 설 수 있고, 보행자는 역할이 있다',
      () => {
        const easy = challengeRule(1);
        const normal = challengeRule(3);
        const bad: string[] = [];
        scenarioLibrary().forEach((e, i) => {
          if (i % SHARDS !== shard) return;
          const name = `#${libraryNumber(e.spec.id)} ${e.spec.title}`;
          const codes = (r: ReturnType<typeof playScenario>) => [
            ...r.result.violations.map((v) => v.code),
            ...(r.result.failReason ? [r.result.failReason] : []),
          ];
          const careful = playScenario(e.spec, { persona: 'careful', pace: easy.pace, stopZone: easy.stopZone, trace: false });
          if (codes(careful).length || !careful.result.completed) bad.push(`${name} — 규정대로: ${codes(careful).join(',') || '미완주'}`);
          const human = playScenario(e.spec, { persona: 'human', reaction: 1, pace: normal.pace, stopZone: normal.stopZone, trace: false });
          if (codes(human).length || !human.result.completed) bad.push(`${name} — 사람(난이도3): ${codes(human).join(',') || '미완주'}`);
          if (e.spec.pedestrians.some((p) => p.chance === undefined)) {
            const blind = playScenario(e.spec, { persona: 'pedBlind', pace: easy.pace, stopZone: easy.stopZone, trace: false });
            if (!codes(blind).some((c) => c === 'PEDESTRIAN_BLOCKED' || c === 'PEDESTRIAN_HIT')) bad.push(`${name} — 보행자 역할 없음`);
          }
        });
        expect(bad, bad.slice(0, 5).join('\n')).toEqual([]);
      },
      240_000,
    );
  });
}
