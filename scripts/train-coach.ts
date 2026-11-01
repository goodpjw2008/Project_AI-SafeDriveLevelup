/**
 * **로컬 코치 학습 — 외부 LLM 코치를 따라 배운다** (src/ai/localCoach.ts).
 *
 *   set -a && . ./.env && set +a && npm run train:coach
 *
 * 1. **문장 은행** — 외부 LLM 에게 자리마다(위반 · 자리 · 실패 · 칭찬 조건 · 습관 진단의 뼈대) 문장을 여러 가지 쓰게 한다. 결과
 *    화면의 AI 코치와 같은 말투 규칙(server/coachPrompt.mjs · reportPrompt.mjs)을 그대로 준다. 숫자 · 영어가 섞인 문장, 빈칸이 틀린
 *    문장은 버린다.
 * 2. **상황** — 시뮬레이터(scenarios/playSim.ts)로 라이브러리 판을 여러 운전자(개념 몇 개를 모르는 사람 · 보행자를 안 보는 사람 ·
 *    신호를 안 보는 사람 · 규정대로 모는 사람)로 달려 판정 결과를 모으고, 습관 집계는 가상 기록으로 만든다.
 * 3. **고르기** — 상황마다 외부 LLM 에게 실제 코치와 같은 입력(server/coachPrompt.mjs 의 buildUserPrompt)과 후보 문장을 주고
 *    "골라서 순서대로" 묻는다.
 * 4. **신경망** — 브라우저가 아는 것만 보고 그 고르기를 따라 배운다 (리스트 단위 교차 엔트로피). 열에 하나는 떼어 검증한다.
 *
 * 외부 LLM 은 server/llm.mjs 의 무료 자리(Gemini · Groq)를 돌려 쓰고, 다 막히면 Vertex(.env 의 GOOGLE_CLOUD_AGENT_PLATFORM_API_KEY)로
 * 부른다 — 사용자가 정했다 (2026-11-01). 배포 서버는 Vertex 를 쓰지 않는다. 답은 `.train-coach/cache` 에 남겨 다시 돌릴 때 묻지
 * 않는다. 결과(src/ai/models/coach.json)는 저장소에 커밋한다.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { callModel } from '../server/llm.mjs';
import { SYSTEM_PROMPT, VIOLATION_BRIEF, buildUserPrompt } from '../server/coachPrompt.mjs';
import { REPORT_SYSTEM_PROMPT, buildReportPrompt } from '../server/reportPrompt.mjs';
import {
  COACH_CODES,
  COACH_KEYS,
  COACH_SITUATION_FEATURES,
  REPORT_KEYS,
  REPORT_SITUATION_FEATURES,
  coachSituation,
  coachSituationFeatures,
  pickInput,
  pickScore,
  reportSituation,
  reportSituationFeatures,
  type BankLine,
  type CoachModel,
  type CoachSituation,
  type PickNet,
  type ReportSituation,
} from '../src/ai/localCoach';
import type { HabitSummary } from '../src/coach/habits';
import { toCoachRequest } from '../src/coach/client';
import { AUTO_DRIVE_RULE, challengeRule } from '../src/scenarios/challenge';
import { scenarioLibrary, type LibraryEntry } from '../src/scenarios/library';
import { playScenario, type PlayOptions } from '../src/scenarios/playSim';
import { zoneEntries } from '../src/scenarios/zoneCourse';
import type { ViolationCode } from '../src/rules/violations';

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const sarg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const here = dirname(fileURLToPath(import.meta.url));
const OUT = sarg('save') ?? resolve(here, '../src/ai/models/coach.json');
const WORK = sarg('work') ?? resolve(here, '../.train-coach');
/** 주행결과 분석 상황 수 · 습관 진단 상황 수 */
const COACH_N = arg('coach', 480);
const REPORT_N = arg('report', 220);
/** 한꺼번에 묻는 수 */
const CONCURRENCY = arg('jobs', 6);
const HIDDEN = arg('hidden', 24);
const EPOCHS = arg('epochs', 60);

const t0 = performance.now();
const secs = () => `${((performance.now() - t0) / 1000).toFixed(0)}초`;
const r4 = (v: number) => +v.toFixed(4);

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 외부 LLM (답을 남겨 둔다) ─────────────────────────────────────────────

mkdirSync(resolve(WORK, 'cache'), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let calls = { free: 0, vertex: 0, cached: 0 };

/** Vertex 의 Gemini — 무료 자리가 다 막혔을 때만 (키 값은 어디에도 찍지 않는다) */
async function vertex(system: string, user: string, maxTokens: number, json: boolean): Promise<string | null> {
  const key = process.env.GOOGLE_CLOUD_AGENT_PLATFORM_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7, ...(json ? { responseMimeType: 'application/json' } : {}) },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() || null;
  } catch {
    return null;
  }
}

/**
 * **Gemini 만 부른다** — 무료 자리 가운데 Groq 의 모델들이 쓴 한국어 문장은 뜻이 통하지 않거나("자신 느세요") 한자가 섞이거나
 * 법규와 거꾸로 말했다("보행신호를 확인 후" — 기준은 보행자다). 은행과 고르기는 게임에 그대로 남는 것이라 Gemini 의 무료 키만
 * 넘기고, 다 막히면 Vertex 의 같은 모델로 간다.
 */
const GEMINI_ENV: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.startsWith('GEMINI_')),
);

async function ask(system: string, user: string, maxTokens = 1200, json = true): Promise<string> {
  const file = resolve(WORK, 'cache', `${createHash('sha1').update(`${system}\n---\n${user}`).digest('hex')}.json`);
  if (existsSync(file)) {
    calls.cached += 1;
    return (JSON.parse(readFileSync(file, 'utf8')) as { text: string }).text;
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await callModel({ system, user, maxTokens, json }, GEMINI_ENV);
    let text = r.status === 200 ? (r.body.text ?? null) : null;
    if (text) calls.free += 1;
    if (!text) {
      text = await vertex(system, user, maxTokens, json);
      if (text) calls.vertex += 1;
    }
    if (text) {
      writeFileSync(file, JSON.stringify({ text }));
      return text;
    }
    await sleep(3000 * (attempt + 1));
  }
  throw new Error('외부 LLM 이 여섯 번 다 답하지 않았다');
}

/** 글 속의 `{…}` 하나를 꺼내 읽는다 — 무료 모델은 JSON 앞뒤로 말을 붙이기도 한다 */
function parseJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

/** 차례대로 묻되 한꺼번에 `CONCURRENCY` 개까지 */
async function pool<T, R>(items: readonly T[], fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// ── 1. 문장 은행 ──────────────────────────────────────────────────────────

const TITLE: Record<string, string> = Object.fromEntries(
  Object.entries(VIOLATION_BRIEF as Record<string, { title: string }>).map(([k, v]) => [k, v.title]),
);

/** 자리마다 무엇을 써야 하는가 — LLM 에게 그대로 준다 */
const WHAT: Record<string, string> = {
  RED_NO_STOP: '정면 차량신호가 적색인데 정지선 앞에서 일시정지하지 않고 우회전했다 (보행자가 없어도 서야 한다)',
  RIGHT_ARROW_RED: '우회전 신호등이 녹색 화살표가 아닌데(적색 · 황색) 우회전했다 (녹색 화살표가 켜질 때까지 기다린다)',
  PEDESTRIAN_BLOCKED: '횡단보도를 건너거나 건너려는 보행자가 있는데 서지 않고 지나갔다',
  BIKE_BLOCKED: '자전거횡단도를 건너는 자전거가 있는데 서지 않고 지나갔다',
  SCHOOL_ZONE_NO_STOP: '어린이보호구역의 신호기 없는 횡단보도 앞에서 일시정지하지 않았다 (보행자가 없어도 서야 한다)',
  NO_SLOW_DOWN: '교차로에서 우회전할 때 서행하지 않았다',
  WIDE_TURN: '우측 가장자리를 따라 돌지 않고 크게 돌았다',
  BLOCKING_INTERSECTION: '나갈 자리가 막혔는데 교차로에 들어가 갇혔다 (꼬리물기)',
  NO_TURN_SIGNAL: '우회전하기 30m 전에 방향지시등을 켜지 않았다',
  OVER_STOP_LINE: '정지선을 넘어서 정지했다 (정지선 앞에서 서야 한다)',
  SCHOOL_ZONE_RED: '어린이보호구역 횡단보도의 신호가 적색인데 녹색까지 기다리지 않고 지나갔다',
  STRAIGHT_RED: '직진 코스에서 정면 신호가 적색인데 직진했다 (직진은 적색에 갈 수 없다)',
};
const PLACE: Record<string, string> = {
  before: '교차로에 들어가기 전의 횡단보도(정지선 앞 · 진입로)에서',
  after: '우회전한 뒤(또는 교차로를 지나) 만나는 횡단보도에서 — 보행신호 색이 아니라 보행자가 기준이다',
  lead: '앞차가 서지 않고 먼저 우회전하자 그 차를 따라가다가 — 일시정지 의무는 앞차가 아니라 나에게 있다',
};
const FAIL_WHAT: Record<string, string> = {
  PEDESTRIAN_HIT: '보행자와 부딪혀 판이 끝났다',
  VEHICLE_COLLISION: '다른 차와 부딪혀 판이 끝났다',
  OFF_ROAD: '도로를 벗어나 판이 끝났다',
  TIMEOUT: '제한 시간 안에 끝내지 못했다',
};
const COND_WHAT: Record<string, string> = {
  rain: '빗길이었다',
  night: '밤이었다',
  child: '어린이 보행자가 있었다',
  elder: '노인 보행자가 있었다',
  zone: '어린이보호구역이었다',
  lead: '앞차가 있었다',
  honk: '뒤차가 경적으로 재촉했다',
};
const POINT_LABEL = ['정지선 앞 완전정지', '우회전 후 횡단보도 앞 정지', '교차로 내 서행 (20km/h 이하)', '30m 전 방향지시등'];
const WHY_WHAT: Record<string, string> = {
  red: '"적색 신호에서도 사람만 없으면 그냥 우회전해도 된다" 는 오해 (→ 보행자 유무와 무관하게 정지선 앞 일시정지 후 우회전)',
  after: '"우회전 후 횡단보도는 보행신호가 적색이면 그냥 간다" 는 오해 (→ 보행신호가 아니라 보행자의 통행 여부가 기준)',
  zone: '"어린이보호구역이어도 아이가 안 보이면 그냥 간다" 는 오해 (→ 신호기 없는 횡단보도는 보행자 유무와 무관하게 일시정지)',
  lead: '"앞차가 서지 않고 우회전하면 따라가도 된다" 는 오해 (→ 일시정지 의무는 앞차가 아니라 나에게 걸린다)',
  generic: '특정한 오해보다는 확인하는 순서가 서두르는 습관 (먼저 서고, 보고, 가는 순서를 몸에 익히기)',
};

interface BankSpec {
  key: string;
  /** 주행결과 분석이면 'coach', 습관 진단이면 'report' */
  part: 'coach' | 'report';
  what: string;
  n: number;
  /** 써도 되는 빈칸 (습관 진단만) — 빠지면 안 되는 빈칸은 `need` */
  slots?: string[];
  need?: string[];
}

function bankSpecs(): BankSpec[] {
  const out: BankSpec[] = [];
  for (const key of COACH_KEYS) {
    const [role, a, ctx] = key.split(':');
    if (role === 'issue') {
      const where = ctx ? ` — ${PLACE[ctx]}` : '';
      out.push({ key, part: 'coach', n: 6, what: `어긴 판의 첫 줄: '${TITLE[a]}'. ${WHAT[a]}${where}. 무엇을 어겼는지 짚는다.` });
    } else if (role === 'next') {
      out.push({ key, part: 'coach', n: 5, what: `'${TITLE[a]}'(${WHAT[a]})를 어긴 판의 마지막 줄: 반드시 "- 다음 판 — " 으로 시작해, 다음 판에서 할 한 동작을 주고 힘이 나는 한마디로 맺는다.` });
    } else if (role === 'fail') {
      out.push({ key, part: 'coach', n: 4, what: `완주하지 못한 판의 첫 줄: ${FAIL_WHAT[a]}. 무엇이 문제였는지 짚는다.` });
    } else if (key === 'clean:general') {
      out.push({ key, part: 'coach', n: 8, what: '위반 없이 마친 판의 첫 줄: 규정을 모두 지켰다는 확인과 칭찬. 어디서 무엇을 했는지 따지지 않는다.' });
    } else {
      out.push({ key, part: 'coach', n: 4, what: `위반 없이 마친 판의 둘째 줄: 이 판은 ${COND_WHAT[a]}. 그 조건을 한마디 얹어 칭찬한다.` });
    }
  }
  const pointSlots = ['{point}', '{rate}', '{kept}', '{total}'];
  for (const key of REPORT_KEYS) {
    const [, role, a] = key.split(':');
    if (role === 'strong') {
      out.push({ key, part: 'report', n: 6, slots: pointSlots, need: ['{point}', '{rate}'], what: '진단의 첫 문장 — 이미 익힌 것. 준수율이 가장 높은 지점 {point} 를 {rate}(지킨 판 {kept}/{total}판)와 함께 인정한다.' });
    } else if (role === 'start') {
      out.push({ key, part: 'report', n: 4, what: '진단의 첫 문장 — 아직 몸에 익은 지점이 없는 학습자. 숫자 없이 지금이 익힐 때라고 북돋는다.' });
    } else if (role === 'weak') {
      out.push({ key, part: 'report', n: 4, slots: ['{rate}', '{kept}', '{total}'], need: ['{rate}'], what: `진단의 둘째 문장 — 무너지는 자리. '${POINT_LABEL[Number(a)]}' 준수율이 {rate}({kept}/{total}판)로 가장 낮다고 짚는다.` });
    } else if (role === 'code') {
      out.push({ key, part: 'report', n: 3, slots: ['{count}'], need: ['{count}'], what: `진단의 둘째 문장 — 가장 자주 반복된 위반. '${TITLE[a]}'(${WHAT[a]})가 {count}회 반복됐다고 짚는다.` });
    } else if (role === 'why') {
      out.push({ key, part: 'report', n: 4, what: `진단의 셋째 문장 — 왜 그런가. 여러 판을 겹쳐 보면 ${WHY_WHAT[a]}에 걸려 있는 것 같다고 짚는다. 목록 번호로 부르지 않는다.` });
    } else if (role === 'trend') {
      const t = { up: '무위반율이 초반 {early}에서 후반 {late}로 올랐다', down: '무위반율이 초반 {early}에서 후반 {late}로 내려갔다', flat: '무위반율이 초반 {early} · 후반 {late}로 비슷하다' }[a as 'up' | 'down' | 'flat'];
      out.push({ key, part: 'report', n: 3, slots: ['{early}', '{late}'], need: ['{early}', '{late}'], what: `진단 중간의 한 문장 — 개선 추이. ${t}.` });
    } else if (role === 'next') {
      out.push({ key, part: 'report', n: 3, what: `진단의 마지막 문장 — 다음에 할 것. 다음 주행에서 '${POINT_LABEL[Number(a)]}' 를 의식하라고 구체적으로 말한다.` });
    }
  }
  return out;
}

const BANK_RULES_COACH = [
  '# 이번에 하는 일 — 문장 은행 쓰기',
  '판 하나의 코칭을 쓰는 대신, 아래 **자리 하나**에 들어갈 줄을 여러 가지 씁니다. 같은 뜻을 말투만 바꿔 쓰지 말고 짚는 각도를 달리합니다.',
  '- 각 줄은 위 규칙 그대로 `- ` 로 시작하는 한 줄, 45자 안팎, 존댓말, "행동 — 평가" 꼴.',
  '- **숫자를 쓰지 않습니다** (30m · 20km/h 처럼 규정 자체의 수는 됩니다). 시간 · 횟수 · 속도 같은 이 판만의 수는 쓰지 않습니다.',
  '- 자리 설명에 없는 조건(빗길 · 어린이 · 앞차 등)을 지어내지 않습니다.',
  '- JSON 하나로만 답합니다: {"lines": ["- …", "- …"]}',
].join('\n');
const BANK_RULES_REPORT = [
  '# 이번에 하는 일 — 문장 은행 쓰기',
  '진단 문단 전체 대신, 아래 **자리 하나**에 들어갈 문장을 여러 가지 씁니다. 같은 뜻을 말투만 바꿔 쓰지 말고 짚는 각도를 달리합니다.',
  '- 한 문장씩, 존댓말, 2인칭. 줄글 한 문장 (기호 · 번호 없음).',
  '- **숫자를 직접 쓰지 않습니다.** 수가 필요하면 주어진 빈칸({rate} 같은 것)을 그대로 씁니다 — 나중에 실제 값으로 채웁니다.',
  '- 주어진 빈칸 말고 다른 빈칸을 만들지 않습니다.',
  '- JSON 하나로만 답합니다: {"lines": ["…", "…"]}',
].join('\n');

/** 한자 · 가나 — 무료 모델이 한국어 문장에 섞어 넣었다 */
const FOREIGN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

/** 은행에 넣어도 되는 줄인가 — 형식 · 숫자 · 빈칸 · 자리에 맞는 꼴 */
function okLine(spec: BankSpec, text: string): string | null {
  let t = text.trim();
  if (FOREIGN.test(t)) return null;
  if (spec.part === 'coach') {
    if (!t.startsWith('- ')) t = `- ${t.replace(/^[-•·]\s*/, '')}`;
    const bare = t.replace(/30m|20km\/h|0\.5m/g, '');
    if (/\d/.test(bare) || /[A-Za-z]/.test(bare.replace(/km\/h/g, ''))) return null;
    if (t.length < 10 || t.length > 60) return null;
    // 어긴 것 · 실패 · 마지막 줄은 '행동 — 평가' 꼴 (칭찬은 줄글도 된다 — server/coachPrompt.mjs 의 보기)
    if (!spec.key.startsWith('clean:') && !t.includes(' — ')) return null;
    // 마지막 줄은 '다음 판 — 할 것, 한마디' 꼴만 · 다른 자리에는 그 꼴이 오면 안 된다
    const isNext = /^- 다음 판 — /.test(t);
    if (spec.key.startsWith('next:') !== isNext) return null;
    return t;
  }
  const slots = t.match(/\{[a-z]+\}/g) ?? [];
  if (slots.some((s) => !(spec.slots ?? []).includes(s))) return null;
  if ((spec.need ?? []).some((s) => !t.includes(s))) return null;
  const bare = t.replace(/\{[a-z]+\}/g, '').replace(/20km\/h|30m/g, '');
  if (/\d/.test(bare.replace(/Stage/g, '')) || /[A-Za-z]/.test(bare.replace(/Stage|km\/h/g, ''))) return null;
  if (t.length < 12 || t.length > 140) return null;
  return t;
}

const REVIEW_RULES = [
  '당신은 도로교통법 운전 교육 자료의 감수자입니다. 아래 "자리"에 들어갈 문장 후보들을 검토합니다.',
  '다음 가운데 하나라도 해당하는 문장의 번호를 모두 고릅니다.',
  '1. 도로교통법 내용이 틀렸거나 자리 설명과 반대로 말한다 (예: 우회전 후 횡단보도에서 "보행신호를 확인하라" — 기준은 보행자다).',
  '2. 한국어가 어색하거나 뜻이 통하지 않는다, 맞춤법이 틀렸다, 반말 · 명령조로 무례하다.',
  '3. 자리 설명에 없는 위반 · 조건 · 사실을 지어냈다.',
  '4. 자리의 역할과 다르다 (어긴 것을 짚는 자리에 칭찬, 마지막 줄 자리에 위반 설명 등).',
  'JSON 하나로만 답합니다: {"bad": [번호, …]} (없으면 빈 배열)',
].join('\n');

/** 감수 — 틀리거나 어색한 줄을 Gemini 가 고르고, 그 줄을 버린다 */
async function review(spec: BankSpec, lines: string[]): Promise<string[]> {
  if (!lines.length) return lines;
  const list = lines.map((l, i) => `[${i}] ${l}`).join('\n');
  const text = await ask(REVIEW_RULES, `# 자리\n${spec.what}\n\n# 후보\n${list}`, 300);
  const bad = new Set(((parseJson<{ bad?: unknown }>(text)?.bad ?? []) as unknown[]).map(Number));
  return lines.filter((_, i) => !bad.has(i));
}

async function buildBank(): Promise<BankLine[]> {
  const specs = bankSpecs();
  const got = await pool(specs, async (spec) => {
    const system = spec.part === 'coach' ? `${SYSTEM_PROMPT}\n\n${BANK_RULES_COACH}` : `${REPORT_SYSTEM_PROMPT}\n\n${BANK_RULES_REPORT}`;
    const slots = spec.slots?.length ? `\n쓸 수 있는 빈칸: ${spec.slots.join(' ')}${spec.need?.length ? ` (꼭 넣을 것: ${spec.need.join(' ')})` : ''}` : '';
    const user = `# 자리\n${spec.what}${slots}\n\n${spec.n}가지를 씁니다.`;
    let lines: string[] = [];
    for (let round = 0; round < 4 && lines.length < Math.min(4, spec.n); round++) {
      const text = await ask(system, round ? `${user}\n(다시 씁니다 ${round})` : user);
      const parsed = parseJson<{ lines?: unknown }>(text);
      const fresh: string[] = [];
      for (const l of Array.isArray(parsed?.lines) ? parsed!.lines : []) {
        const ok = typeof l === 'string' ? okLine(spec, l) : null;
        if (ok && !lines.includes(ok) && !fresh.includes(ok)) fresh.push(ok);
      }
      lines = [...lines, ...(await review(spec, fresh))];
    }
    return lines.slice(0, spec.n + 2).map((text) => ({ key: spec.key, text }));
  });
  const bank = got.flat();
  const missing = specs.filter((s) => !bank.some((b) => b.key === s.key)).map((s) => s.key);
  if (missing.length) throw new Error(`문장이 없는 자리: ${missing.join(', ')}`);
  return bank;
}

// ── 2. 상황 ───────────────────────────────────────────────────────────────

interface CoachCase {
  id: number;
  situation: CoachSituation;
  /** 실제 코치가 받는 입력 (server/coachPrompt.mjs 의 buildUserPrompt) */
  prompt: string;
}

/** 라이브러리 판을 여러 운전자로 달려 판정 결과를 모으고, 자리 조합이 고르게 섞이게 추린다 */
function coachCases(n: number): CoachCase[] {
  const r = rng(20261101);
  const lib = scenarioLibrary();
  const zone = zoneEntries();
  const human = { persona: 'human' as const, reaction: 1.0, pace: challengeRule(3).pace, stopZone: challengeRule(3).stopZone };
  const auto = { pace: AUTO_DRIVE_RULE.pace, stopZone: AUTO_DRIVE_RULE.stopZone };
  const bySig = new Map<string, CoachCase[]>();
  for (let i = 0; i < n * 8; i++) {
    const e: LibraryEntry = r() < 0.08 ? zone[Math.floor(r() * zone.length)] : lib[Math.floor(r() * lib.length)];
    const u = r();
    // 대부분은 개념 한두 개를 모르는 사람 — 실제 학습자처럼 한두 가지를 어긴다
    const blind = new Set<ViolationCode>();
    const pickable: ViolationCode[] = ['RED_NO_STOP', 'PEDESTRIAN_BLOCKED', 'SCHOOL_ZONE_NO_STOP', 'NO_TURN_SIGNAL', 'WIDE_TURN', 'OVER_STOP_LINE', 'BLOCKING_INTERSECTION', 'RIGHT_ARROW_RED', 'STRAIGHT_RED', 'SCHOOL_ZONE_RED'];
    const nb = u < 0.15 ? 0 : u < 0.75 ? 1 : 2;
    while (blind.size < nb) blind.add(pickable[Math.floor(r() * pickable.length)]);
    const v = r();
    const opts: PlayOptions =
      v < 0.06
        ? { persona: 'reckless', ...auto, trace: false }
        : v < 0.12
          ? { persona: 'pedBlind', ...auto, trace: false }
          : v < 0.18
            ? { persona: 'signalBlind', ...auto, trace: false }
            : { ...human, blind, trace: false };
    let played;
    try {
      played = playScenario(e.spec, opts);
    } catch {
      continue;
    }
    const result = played.result;
    const situation = coachSituation(result, e.tags, e.spec.drive ?? 'rightTurn');
    const sig = situation.keys.slice().sort().join('|');
    const list = bySig.get(sig) ?? [];
    if (list.length >= 6) continue;
    const prompt = buildUserPrompt(toCoachRequest(e.spec.id, e.spec.title, result));
    list.push({ id: 0, situation, prompt });
    bySig.set(sig, list);
  }
  // 조합마다 고르게 — 깨끗한 판은 조건 조합이 많아 그대로 두면 절반이 되므로 다섯에 하나까지만
  const all = [...bySig.values()];
  const out: CoachCase[] = [];
  const cleanMax = Math.round(n * 0.2);
  let cleanN = 0;
  for (let round = 0; out.length < n && round < 6; round++) {
    for (const list of all) {
      const c = list[round];
      if (!c || out.length >= n) continue;
      if (c.situation.clean) {
        if (cleanN >= cleanMax) continue;
        cleanN += 1;
      }
      out.push(c);
    }
  }
  out.forEach((c, i) => (c.id = i));
  return out;
}

interface ReportCase {
  id: number;
  situation: ReportSituation;
  prompt: string;
}

/** 가상 습관 집계 — 판 수 · 지점마다의 준수율 · 반복된 위반 · 추이 · 다시 돈 판을 고르게 섞는다 */
function reportCases(n: number): ReportCase[] {
  const r = rng(77);
  const out: ReportCase[] = [];
  const stages = scenarioLibrary().map((e) => e.spec.id);
  for (let i = 0; i < n; i++) {
    const runs = 5 + Math.floor(r() * r() * 56);
    const skill = r();
    const points = POINT_LABEL.map((label, k) => {
      // 지점마다 다르게 — 방향지시등 · 서행은 대개 높고, 우회전 후 횡단보도가 가장 자주 낮다
      const base = [0.75, 0.6, 0.9, 0.9][k];
      const p = Math.max(0, Math.min(1, base * (0.5 + skill) + (r() - 0.5) * 0.6));
      const kept = Math.round(p * runs);
      return { label, kept, total: runs, rate: runs ? kept / runs : 0 };
    });
    const codes = [...COACH_CODES].sort(() => r() - 0.5).slice(0, Math.floor(r() * 4));
    const byCode = codes
      .map((code) => ({ code, count: 1 + Math.floor(r() * Math.max(1, runs / 3)) }))
      .sort((a, b) => b.count - a.count);
    const violationRuns = Math.min(runs, byCode.reduce((s, c) => s + c.count, 0));
    const cleanRuns = runs - Math.max(byCode.length ? 1 : 0, Math.min(violationRuns, Math.round(runs * (1 - skill * 0.8))));
    const grades: Record<string, number> = { PERFECT: Math.round(cleanRuns * 0.6), PASS: cleanRuns - Math.round(cleanRuns * 0.6), VIOLATION: runs - cleanRuns };
    const trend =
      runs >= 8 ? { early: Math.max(0, Math.min(1, cleanRuns / runs + (r() - 0.5) * 0.5)), late: Math.max(0, Math.min(1, cleanRuns / runs + (r() - 0.3) * 0.5)) } : null;
    const summary: HabitSummary = {
      runs,
      stagesPlayed: Math.max(1, Math.round(runs * (0.5 + r() * 0.5))),
      grades,
      byCode,
      points,
      trend,
      mostRetried: r() < 0.4 ? { stage: stages[Math.floor(r() * stages.length)], count: 2 + Math.floor(r() * 4) } : null,
      cleanRuns,
    };
    out.push({ id: i, situation: reportSituation(summary), prompt: buildReportPrompt(summary) });
  }
  return out;
}

// ── 3. 고르기 ─────────────────────────────────────────────────────────────

const PICK_COACH = [
  '# 이번에 하는 일 — 문장 고르기',
  '코칭을 새로 쓰지 않고, 아래 "후보 문장" 가운데서 이 판에 맞는 줄을 골라 **놓을 차례대로** 적습니다.',
  '- 위반이 있으면: (실패가 있으면 그 줄) → 어긴 것 1~2줄(가장 중요한 것부터) → 다음 판에 할 것 1줄. 모두 2~4줄.',
  '- 위반이 없으면: 첫 줄 하나, 이 판의 조건을 얹은 칭찬이 어울리면 한 줄 더. 모두 1~2줄.',
  '- 같은 위반을 두 줄로 말하지 않습니다. 후보에 없는 번호를 쓰지 않습니다.',
  '- JSON 하나로만 답합니다: {"ids": [번호, …]}',
].join('\n');
const PICK_REPORT = [
  '# 이번에 하는 일 — 문장 고르기',
  '진단을 새로 쓰지 않고, 아래 "후보 문장" 가운데서 이 사람에게 맞는 문장을 골라 **놓을 차례대로** 적습니다.',
  '- 차례: 이미 익힌 것 1 → 무너지는 자리 1 → 왜 그런가 1 → (추이가 말할 만하면 1) → 다음에 할 것 1.',
  '- 후보에 없는 번호를 쓰지 않습니다.',
  '- JSON 하나로만 답합니다: {"ids": [번호, …]}',
].join('\n');

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** 습관 진단 후보를 실제 값으로 채워 보여 준다 — LLM 이 읽는 것은 학습자가 읽을 문장 그대로다 */
function fillPreview(text: string, s: ReportSituation, key: string): string {
  const sum = s.summary;
  const [, role, a] = key.split(':');
  const point = role === 'weak' ? Number(a) : role === 'strong' ? s.best : s.worst;
  const p = sum.points[point];
  const c = role === 'code' ? sum.byCode.find((x) => x.code === a) : undefined;
  return text
    .replace(/\{point\}/g, p.label)
    .replace(/\{rate\}/g, pct(p.rate))
    .replace(/\{kept\}/g, String(p.kept))
    .replace(/\{total\}/g, String(p.total))
    .replace(/\{count\}/g, String(c?.count ?? ''))
    .replace(/\{early\}/g, sum.trend ? pct(sum.trend.early) : '')
    .replace(/\{late\}/g, sum.trend ? pct(sum.trend.late) : '');
}

interface Labeled {
  part: 'coach' | 'report';
  id: number;
  x: number[];
  /** 후보 문장 (bank 번호) */
  cands: number[];
  /** LLM 이 고른 차례 */
  chosen: number[];
}

async function label(bank: BankLine[], coach: CoachCase[], report: ReportCase[]): Promise<Labeled[]> {
  const coachOut = await pool(coach, async (c) => {
    const cands = bank.map((b, i) => (c.situation.keys.includes(b.key) ? i : -1)).filter((i) => i >= 0);
    const list = cands.map((i) => `[${i}] ${bank[i].text}`).join('\n');
    const text = await ask(`${SYSTEM_PROMPT}\n\n${PICK_COACH}`, `${c.prompt}\n\n# 후보 문장\n${list}`, 400);
    const ids = (parseJson<{ ids?: unknown }>(text)?.ids ?? []) as unknown[];
    const chosen = [...new Set(ids.map(Number).filter((i) => cands.includes(i)))].slice(0, 4);
    return { part: 'coach' as const, id: c.id, x: coachSituationFeatures(c.situation), cands, chosen };
  });
  const reportOut = await pool(report, async (c) => {
    const cands = bank.map((b, i) => (c.situation.keys.includes(b.key) ? i : -1)).filter((i) => i >= 0);
    const list = cands.map((i) => `[${i}] ${fillPreview(bank[i].text, c.situation, bank[i].key)}`).join('\n');
    const text = await ask(`${REPORT_SYSTEM_PROMPT}\n\n${PICK_REPORT}`, `${c.prompt}\n\n# 후보 문장\n${list}`, 400);
    const ids = (parseJson<{ ids?: unknown }>(text)?.ids ?? []) as unknown[];
    const chosen = [...new Set(ids.map(Number).filter((i) => cands.includes(i)))].slice(0, 5);
    return { part: 'report' as const, id: c.id, x: reportSituationFeatures(c.situation), cands, chosen };
  });
  return [...coachOut, ...reportOut].filter((l) => l.chosen.length > 0);
}

// ── 4. 신경망 ─────────────────────────────────────────────────────────────

function softmax(xs: readonly number[]): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/**
 * 고른 차례를 분포로 — 앞에 놓은 줄일수록 무겁게. 고르지 않은 후보는 0 이다. 신경망은 후보끼리의 소프트맥스를 이 분포에 맞춘다.
 */
const target = (l: Labeled) => {
  const w = l.cands.map((c) => {
    const at = l.chosen.indexOf(c);
    return at < 0 ? 0 : 1 / (1 + 0.3 * at);
  });
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / s);
};

function trainNet(part: 'coach' | 'report', data: Labeled[], bank: BankLine[]): PickNet {
  const keys = part === 'coach' ? COACH_KEYS : REPORT_KEYS;
  const lines = bank.map((b, i) => (keys.includes(b.key) ? i : -1)).filter((i) => i >= 0);
  const situation = part === 'coach' ? COACH_SITUATION_FEATURES : REPORT_SITUATION_FEATURES;
  const d = situation.length + keys.length + lines.length;
  const rand = rng(part === 'coach' ? 5 : 6);
  const net: { situation: readonly string[]; keys: readonly string[]; lines: number[]; W1: number[][]; b1: number[]; w2: number[]; b2: number } = {
    situation,
    keys,
    lines,
    W1: Array.from({ length: HIDDEN }, () => Array.from({ length: d }, () => (rand() * 2 - 1) * Math.sqrt(3 / 40))),
    b1: Array(HIDDEN).fill(0),
    w2: Array.from({ length: HIDDEN }, () => (rand() * 2 - 1) * Math.sqrt(3 / HIDDEN)),
    b2: 0,
  };
  const L2 = 1e-4;
  const idx = data.map((_, i) => i);
  for (let ep = 0; ep < EPOCHS; ep++) {
    const lr = 0.05 - (0.04 * ep) / Math.max(1, EPOCHS - 1);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    let loss = 0;
    for (const i of idx) {
      const l = data[i];
      const xs = l.cands.map((c) => pickInput(net, l.x, bank, c));
      const hs = xs.map((x) => net.W1.map((row, q) => Math.tanh(row.reduce((s, w, j) => s + w * x[j], net.b1[q]))));
      const p = softmax(hs.map((h) => h.reduce((s, v, q) => s + net.w2[q] * v, net.b2)));
      const t = target(l);
      for (let k = 0; k < p.length; k++) loss -= t[k] * Math.log(Math.max(1e-12, p[k]));
      for (let k = 0; k < p.length; k++) {
        const g = p[k] - t[k];
        if (Math.abs(g) < 1e-6) continue;
        const h = hs[k];
        const x = xs[k];
        for (let q = 0; q < HIDDEN; q++) {
          const gh = g * net.w2[q] * (1 - h[q] * h[q]);
          net.w2[q] -= lr * (g * h[q] + L2 * net.w2[q]);
          const row = net.W1[q];
          for (let j = 0; j < d; j++) if (x[j]) row[j] -= lr * (gh * x[j] + L2 * row[j]);
          net.b1[q] -= lr * gh;
        }
        net.b2 -= lr * g;
      }
    }
    if (ep % 20 === 0 || ep === EPOCHS - 1) console.log(`  ${part} ${ep} · 손실 ${(loss / data.length).toFixed(4)} · ${secs()}`);
  }
  return { ...net, W1: net.W1.map((r) => r.map(r4)), b1: net.b1.map(r4), w2: net.w2.map(r4), b2: r4(net.b2) };
}

/** 검증 — LLM 이 맨 앞에 놓은 줄을 신경망도 1등으로 보는가 · 고른 줄들을 상위에 두는가 (무작위와 견준다) */
function check(net: PickNet, data: Labeled[], bank: BankLine[]) {
  let top1 = 0;
  let rand1 = 0;
  let recall = 0;
  let randRecall = 0;
  for (const l of data) {
    const s = l.cands.map((c) => pickScore(net, l.x, bank, c));
    const order = l.cands.map((c, i) => ({ c, s: s[i] })).sort((a, b) => b.s - a.s).map((o) => o.c);
    top1 += order[0] === l.chosen[0] ? 1 : 0;
    rand1 += 1 / l.cands.length;
    const k = l.chosen.length;
    recall += order.slice(0, k).filter((c) => l.chosen.includes(c)).length / k;
    randRecall += k / l.cands.length;
  }
  const n = data.length || 1;
  return { n: data.length, top1: top1 / n, rand1: rand1 / n, recall: recall / n, randRecall: randRecall / n };
}

/**
 * 한 줄을 더 붙일지의 문턱 — LLM 이 그 줄을 붙인 비율과 신경망이 붙이는 비율이 같아지는 점수 차. 비율을 맞추는 것이라 따로 고를
 * 무엇이 없다.
 */
function margin(diffs: number[], rate: number): number {
  if (!diffs.length) return 0;
  const sorted = [...diffs].sort((a, b) => a - b);
  const k = Math.max(0, Math.min(sorted.length - 1, Math.round(rate * sorted.length) - 1));
  return r4(Math.max(0, sorted[k]));
}

// ── 지휘 ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('1. 문장 은행 — 외부 LLM 이 자리마다 쓴다');
  /*
    **은행은 한 번 쓰고 사람이 읽어 고친 것을 이어 쓴다** — 다시 쓰게 하면 감수를 지난 줄이라도 처음 보는 문장이 섞인다. 차례는
    작업 폴더의 bank.json → 저장된 모델(models/coach.json)의 은행 → 새로 쓰기(`--newBank` 면 늘 새로).
  */
  const bankFile = resolve(WORK, 'bank.json');
  const saved = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Partial<CoachModel>) : null;
  const bank: BankLine[] = args.includes('--newBank')
    ? await buildBank()
    : existsSync(bankFile)
      ? JSON.parse(readFileSync(bankFile, 'utf8'))
      : saved?.meta?.trained && saved.bank?.length
        ? [...saved.bank]
        : await buildBank();
  writeFileSync(bankFile, JSON.stringify(bank, null, 1));
  console.log(`  ${bank.length}줄 · 자리 ${new Set(bank.map((b) => b.key)).size}개 · ${secs()} (무료 ${calls.free} · Vertex ${calls.vertex} · 남겨 둔 답 ${calls.cached})`);
  // 은행만 만들고 멈춘다 — 사람이 읽어 보고 고칠 줄을 bank.json 에서 지운 뒤 다시 돌리면 그 은행으로 이어 간다
  if (args.includes('--bankOnly')) return;

  console.log('2. 상황 — 시뮬레이터 판정 결과와 가상 습관 집계');
  const coach = coachCases(COACH_N);
  const report = reportCases(REPORT_N);
  console.log(`  주행결과 ${coach.length} (깨끗한 판 ${coach.filter((c) => c.situation.clean).length}) · 습관 진단 ${report.length} · ${secs()}`);

  console.log('3. 고르기 — 상황마다 외부 LLM 이 후보에서 고른다');
  const data = await label(bank, coach, report);
  writeFileSync(resolve(WORK, 'labels.json'), JSON.stringify(data));
  console.log(`  ${data.length}개 · ${secs()} (무료 ${calls.free} · Vertex ${calls.vertex} · 남겨 둔 답 ${calls.cached})`);

  console.log('4. 신경망 — 열에 하나는 떼어 검증');
  const isVal = (l: Labeled) => l.id % 10 === 3;
  const nets: Record<'coach' | 'report', PickNet> = {} as never;
  const evals: Record<string, unknown> = {};
  for (const part of ['coach', 'report'] as const) {
    const all = data.filter((l) => l.part === part);
    nets[part] = trainNet(part, all.filter((l) => !isVal(l)), bank);
    const v = check(nets[part], all.filter(isVal), bank);
    evals[part] = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r4(x)]));
    console.log(
      `  ${part} 검증 ${v.n} — LLM 이 맨 앞에 놓은 줄을 1등으로: 신경망 ${pct(v.top1)} · 무작위 ${pct(v.rand1)} | 고른 줄을 위에: 신경망 ${pct(v.recall)} · 무작위 ${pct(v.randRecall)}`,
    );
  }

  // 한 줄을 더 붙이는 비율 — LLM 이 정한 만큼
  const coachData = data.filter((l) => l.part === 'coach');
  const keyOf = (i: number) => bank[i].key;
  const second: number[] = [];
  let secondRate = 0;
  let secondN = 0;
  const cond: number[] = [];
  let condRate = 0;
  let condN = 0;
  for (const l of coachData) {
    const s = new Map(l.cands.map((c) => [c, pickScore(nets.coach, l.x, bank, c)]));
    const issueKeys = [...new Set(l.cands.map(keyOf).filter((k) => k.startsWith('issue:')))];
    if (issueKeys.length >= 2) {
      const best = issueKeys.map((k) => Math.max(...l.cands.filter((c) => keyOf(c) === k).map((c) => s.get(c)!))).sort((a, b) => b - a);
      second.push(best[0] - best[1]);
      secondN += 1;
      secondRate += new Set(l.chosen.map(keyOf).filter((k) => k.startsWith('issue:'))).size >= 2 ? 1 : 0;
    }
    const conds = l.cands.filter((c) => keyOf(c).startsWith('clean:') && keyOf(c) !== 'clean:general');
    const general = l.cands.filter((c) => keyOf(c) === 'clean:general');
    if (conds.length && general.length) {
      cond.push(Math.max(...general.map((c) => s.get(c)!)) - Math.max(...conds.map((c) => s.get(c)!)));
      condN += 1;
      condRate += l.chosen.some((c) => conds.includes(c)) ? 1 : 0;
    }
  }
  const trendDiffs: number[] = [];
  let trendRate = 0;
  let trendN = 0;
  for (const l of data.filter((x) => x.part === 'report')) {
    const s = new Map(l.cands.map((c) => [c, pickScore(nets.report, l.x, bank, c)]));
    const t = l.cands.filter((c) => keyOf(c).startsWith('r:trend:'));
    const w = l.cands.filter((c) => keyOf(c).startsWith('r:why:'));
    if (t.length && w.length) {
      trendDiffs.push(Math.max(...w.map((c) => s.get(c)!)) - Math.max(...t.map((c) => s.get(c)!)));
      trendN += 1;
      trendRate += l.chosen.some((c) => t.includes(c)) ? 1 : 0;
    }
  }
  const extra = {
    secondIssue: margin(second, secondN ? secondRate / secondN : 0),
    cond: margin(cond, condN ? condRate / condN : 0),
    trend: margin(trendDiffs, trendN ? trendRate / trendN : 0),
  };
  console.log(
    `  한 줄 더 — 둘째 위반 ${pct(secondN ? secondRate / secondN : 0)} · 칭찬에 조건 ${pct(condN ? condRate / condN : 0)} · 추이 ${pct(trendN ? trendRate / trendN : 0)} (LLM 이 붙인 비율)`,
  );

  const model: CoachModel = {
    kind: 'coach-pick',
    bank,
    coach: nets.coach,
    report: nets.report,
    extra,
    meta: {
      trained: true,
      date: new Date().toISOString().slice(0, 10),
      bank: bank.length,
      coachCases: coachData.length,
      reportCases: data.length - coachData.length,
      eval: evals,
      teacher: 'gemini-3.1-flash-lite · groq (server/llm.mjs) · Vertex',
    },
  };
  writeFileSync(OUT, JSON.stringify(model));
  console.log(`저장: ${OUT} · ${secs()} (외부 LLM 무료 ${calls.free}번 · Vertex ${calls.vertex}번 · 남겨 둔 답 ${calls.cached}번)`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
