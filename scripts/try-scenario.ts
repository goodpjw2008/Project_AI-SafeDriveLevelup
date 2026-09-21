/**
 * AI 시나리오 생성을 **실제 모델로** 돌려 본다.
 *
 *   npx vite-node scripts/try-scenario.ts [횟수]
 *
 * 브라우저·서버를 띄우지 않고 핸들러를 직접 부른 뒤, 그 결과를 게임과 똑같은 검증기에
 * 통과시킨다. 확인하려는 것은 하나다 — **모델이 실제로 쓸 만한 판을 만드는가, 그리고
 * 못 만들 때 검증기가 잡아내는가.**
 *
 * `.env` 의 `OPENAI_API_KEY` 를 쓴다. 키가 없으면 그렇다고 말하고 끝낸다.
 * 판 하나에 900토큰 남짓이라 gpt-4o-mini 기준 1원이 안 된다.
 */

import { readFileSync } from 'node:fs';
import { handleScenario } from '../server/scenarioHandler.mjs';
import { describeSpec, pickVariation } from '../src/scenarios/generate';
import {
  checkDifficulty,
  clampToLevel,
  describesRemoved,
  ruleFor,
  type Difficulty,
} from '../src/scenarios/curriculum';
import { describeIssues, validateScenario } from '../src/scenarios/validate';
import type { ScenarioSpec } from '../src/scenarios/scenarios';
import type { HabitSummary } from '../src/coach/habits';

/** .env 를 읽는다 — vite 없이 도는 스크립트라 스스로 읽어야 한다 */
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* .env 가 없어도 환경변수로 줄 수 있다 */
  }
  return out;
}

/**
 * 시험용 학습자 — **우회전 후 횡단보도에서 반복해서 무너지는 사람.**
 * 이 게임이 교정하려는 오해 중 가장 흔한 것이다.
 */
const HABITS: Pick<HabitSummary, 'runs' | 'byCode' | 'points'> = {
  runs: 7,
  byCode: [
    { code: 'PEDESTRIAN_BLOCKED', count: 3 },
    { code: 'NO_SLOW_DOWN', count: 2 },
  ],
  points: [
    { label: '정지선 앞 일시정지', kept: 6, total: 7, rate: 6 / 7 },
    { label: '우회전 후 횡단보도', kept: 1, total: 7, rate: 1 / 7 },
    { label: '30m 전 방향지시등', kept: 5, total: 7, rate: 5 / 7 },
  ],
};

const env = loadEnv();
if (!env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY 가 없습니다 (.env 또는 환경변수).');
  process.exit(1);
}

const rounds = Number(process.argv[2] ?? 3);
const made: ScenarioSpec[] = [];
let ok = 0;

for (let i = 1; i <= rounds; i++) {
  process.stdout.write(`\n── ${i}/${rounds} ────────────────────────────────\n`);

  // 1~5단계를 차례로 — 커리큘럼이 실제로 부르는 방식 그대로
  const level = (Math.min(10, i) as Difficulty);
  const mustVary = pickVariation(made);
  console.log(`  단계   ${level} (${ruleFor(level).name})`);

  // 실제 generate.ts 와 같게 — 버려지면 그 이유를 실어 다시 요청한다
  let spec: Record<string, unknown> | null = null;
  let v: ReturnType<typeof validateScenario> | null = null;
  let off: string[] = [];
  let retryOf: string[] = [];
  let tries = 0;

  for (tries = 1; tries <= 3; tries++) {
    const res = await handleScenario(
      {
        ...HABITS,
        recentTitles: made.map(describeSpec),
        mustVary,
        level: ruleFor(level),
        target: 'PEDESTRIAN_BLOCKED',
        badHabits: [
          { code: 'PEDESTRIAN_BLOCKED', count: 3, cleanRuns: 0, toClear: 3 },
          { code: 'NO_SLOW_DOWN', count: 1, cleanRuns: 2, toClear: 1 },
        ],
        retryOf,
      },
      env,
    );
    if (res.status !== 200) {
      console.error('  생성 실패:', JSON.stringify(res.body).slice(0, 300));
      break;
    }
    // generate.ts 와 같은 순서 — 값은 울타리 안으로 밀어 넣고, 글이 어긋난 것만 반려
    spec = { ...(res.body as { spec: Record<string, unknown> }).spec, id: 100 + i };
    spec = { ...clampToLevel(spec as unknown as ScenarioSpec, level) } as Record<string, unknown>;
    v = validateScenario(spec);
    off = [
      ...checkDifficulty(spec as unknown as ScenarioSpec, level),
      ...describesRemoved(spec as unknown as ScenarioSpec, level),
    ];
    if (v.ok && !off.length) break;
    retryOf = [
      ...v.issues.filter((x) => x.level === 'fatal').map((x) => x.message),
      ...off,
    ];
  }
  if (!spec || !v) continue;

  console.log(`  제목   ${String(spec.title)}`);
  console.log(`  이유   ${String(spec.why ?? '(없음)')}`);
  console.log(
    `  조건   신호 ${String(spec.startPhase)}구간 +${String(spec.startPhaseElapsed)}초 · ` +
      `보행자 ${(spec.pedestrians as unknown[])?.length ?? 0}명 · ` +
      `보호구역 ${spec.isSchoolZone ? 'O' : 'X'} · 꼬리물기 ${spec.exitBlocked ? 'O' : 'X'}`,
  );
  console.log(`  검증   ${v.ok && !off.length ? `통과 (${tries}번째)` : '탈락'}`);
  if (v.issues.length) console.log(describeIssues(v.issues));
  for (const m of off) console.log(`  [난이도] ${m}`);

  if (v.probes?.exemplary) {
    const e = v.probes.exemplary;
    console.log(`  모범주행 ${e.grade} · ${e.stats.elapsed.toFixed(1)}초 · 위반 ${e.violations.length}건`);
  }
  if (v.probes?.reckless) {
    const r = v.probes.reckless;
    console.log(
      `  막주행   ${r.grade} · 위반 ${r.violations.length}건 ` +
        `[${r.violations.map((x) => x.code).join(', ')}]`,
    );
  }

  if (v.ok && !off.length) {
    ok++;
    made.push(spec as unknown as ScenarioSpec);
  }
}

console.log(`\n검증 통과 ${ok}/${rounds}`);
