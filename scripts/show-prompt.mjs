/**
 * 지금 GPT 에게 실제로 무엇을 보내는지 그대로 찍어 본다.
 *
 *   node scripts/show-prompt.mjs
 *
 * 프롬프트는 눈으로 읽어 봐야 안다 — 값이 빠졌는지, 순서가 뒤집혔는지는
 * 코드를 읽어서는 잘 안 보인다.
 */
import { buildUserPrompt } from '../server/scenarioPrompt.mjs';

const prompt = buildUserPrompt({
  runs: 5,
  byCode: [],
  points: [],
  recentTitles: [],
  level: {
    level: 3, name: '둘 이상', summary: '보행자가 여럿이고 교차 차량이 시야를 가린다',
    maxPedestrians: 2, maxCrossTraffic: 3, minStartWithin: 18,
    allowRedStart: true, allowMissingPedSignal: false, allowSchoolZone: false,
    allowJaywalker: false, allowLowVisibility: false, allowExitBlocked: false,
    allowRightArrow: false, allowChance: false,
  },
  badHabits: [
    { code: 'PEDESTRIAN_BLOCKED', count: 3, cleanRuns: 0, toClear: 3 },
    { code: 'NO_SLOW_DOWN', count: 1, cleanRuns: 2, toClear: 1 },
  ],
});

const at = prompt.indexOf('# 이 학습자의 나쁜 운전 습관');
console.log(prompt.slice(at, at + 640));
