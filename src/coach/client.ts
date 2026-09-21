/**
 * AI 코치 — 브라우저 쪽.
 *
 * 판정 결과를 `/api/coach` 에 보내고 코칭 문장 하나를 받는다. 프롬프트도 조문 근거도
 * 여기서 만들지 않는다 — 서버(server/coachPrompt.mjs)가 만든다. 브라우저가 프롬프트를
 * 통째로 보내면 그 엔드포인트가 누구나 쓸 수 있는 공짜 LLM이 되기 때문이다.
 *
 * **없으면 없는 대로 굴러가야 한다.** 이 게임은 서버 없이 정적 호스팅으로도, 파일
 * 하나(`build:standalone`)로도 배포된다. 그 두 경우에는 `/api/coach` 자체가 없으므로
 * 여기서 나는 실패는 전부 `null` 로 접어 화면이 코치 칸을 조용히 감춘다.
 * 화질 설정(game/quality.ts)이 안 되는 기능을 손잡이에서 빼는 것과 같은 사고다.
 */

import type { HabitSummary } from './habits';
import type { JudgeResult } from '../rules/lawRules';

/** 서버에 보내는 것 — 판정 엔진이 만든 값만 간다 (좌표·내부 식별자는 뺀다) */
interface CoachRequest {
  stage: number;
  title: string;
  grade: JudgeResult['grade'];
  failReason: JudgeResult['failReason'];
  violations: { code: string; atTime: number; place: string; inSchoolZone: boolean }[];
  stats: {
    cleanStopBeforeA: boolean;
    lateStopBeforeA: boolean;
    stopBeforeC: boolean;
    maxSpeedInIntersection: number;
    signalAt30m: boolean;
    elapsed: number;
  };
  log: { t: number; level: string; text: string }[];
  /**
   * 앞차 — 없던 판은 `null`. 코치가 "앞차가 서지 않았는데 따라갔다" 를 짚으려면
   * 앞차가 **실제로** 서지 않고 지나갔는지(`skippedStop`)까지 알아야 한다.
   */
  lead: { behavior: 'lawful' | 'rolling'; skippedStop: boolean; minGap: number } | null;
}

/**
 * 한 판이 끝나면 기다리는 시간의 상한.
 *
 * 디브리핑은 코치를 기다리는 화면이 아니다 — 지도와 위반 카드는 이미 떠 있고,
 * 코치는 그 위에 얹히는 것뿐이다. 오래 걸리면 그냥 없는 것으로 친다.
 */
export const TIMEOUT_MS = 12_000;

export function toCoachRequest(
  stage: number,
  title: string,
  result: JudgeResult,
): CoachRequest {
  return {
    stage,
    title,
    grade: result.grade,
    failReason: result.failReason,
    violations: result.violations.map((v) => ({
      code: v.code,
      atTime: v.atTime,
      place: v.place,
      inSchoolZone: v.inSchoolZone,
    })),
    stats: {
      cleanStopBeforeA: result.stats.cleanStopBeforeA,
      lateStopBeforeA: result.stats.lateStopBeforeA,
      stopBeforeC: result.stats.stopBeforeC,
      maxSpeedInIntersection: result.stats.maxSpeedInIntersection,
      signalAt30m: result.stats.signalAt30m,
      elapsed: result.stats.elapsed,
    },
    log: result.log.map((e) => ({ t: e.t, level: e.level, text: e.text })),
    lead: result.lead
      ? {
          behavior: result.lead.behavior,
          skippedStop: result.lead.skippedStops.length > 0,
          minGap: Math.round(result.lead.minGap * 10) / 10,
        }
      : null,
  };
}

/**
 * 코칭 문장을 받아 온다. **어떤 이유로든 안 되면 `null`** 이다.
 *
 * 실패를 구분해서 돌려주지 않는 이유: 화면이 할 수 있는 일이 하나뿐이다 — 칸을 감추는 것.
 * "AI 코치를 불러오지 못했습니다" 같은 안내는 학습자에게 아무 쓸모가 없고, 서버가 없는
 * 배포에서는 매번 뜬다. (원인이 궁금할 때는 개발자 도구 콘솔에 남는다)
 */
export async function fetchCoaching(req: CoachRequest): Promise<Advice | null> {
  return postForText('/api/coach', req);
}

/**
 * 습관 진단 문단을 받아 온다. 집계는 이미 끝났으므로 **그 결과를 그대로 보낸다** —
 * 서버는 세지 않고 문장만 쓴다 (habits.ts 참고).
 *
 * 실패하면 `null` 이고, 화면은 집계 지표만 보여 준다. 숫자는 AI 없이도 값어치가 있다.
 */
export async function fetchHabitReport(summary: HabitSummary): Promise<Advice | null> {
  return postForText('/api/report', summary);
}

/**
 * 받아 온 글과 **누가 썼는지**.
 *
 * 이름을 함께 받는 이유: 결과 화면이 "Gemini … 모델이 조언해 준 …" 이라고 밝힌다 (ui/pickedBy.ts 의 advisedBy).
 * 무료 AI 여러 곳을 돌아가며 쓰므로 판마다 다르다 (server/llm.mjs).
 */
export interface Advice {
  text: string;
  /** 'gemini' · 'groq' … (server/llm.mjs 의 provider). 예전 배포는 주지 않는다 */
  picker?: string;
  /** 그 제공자의 모델 이름 */
  model?: string;
}

async function postForText(path: string, payload: unknown): Promise<Advice | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });

    if (!res.ok) {
      // 503 NO_KEY 는 '키를 안 넣었다'는 정상적인 상태다 — 시끄럽게 굴 일이 아니다.
      if (res.status !== 503) console.warn('[coach]', path, res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as { text?: unknown; provider?: unknown; model?: unknown };
    if (typeof data.text !== 'string' || !data.text.trim()) return null;
    return {
      text: data.text.trim(),
      picker: typeof data.provider === 'string' ? data.provider : undefined,
      // 화면에 그대로 적히는 값이라 길이를 자른다
      model: typeof data.model === 'string' ? data.model.trim().slice(0, 40) : undefined,
    };
  } catch (e) {
    // 정적 배포·단일 파일에서는 여기로 온다 (엔드포인트가 아예 없다). 정상이다.
    console.warn('[coach]', path, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
