/**
 * `/api/recommend` 의 프롬프트 — **AI 가 다음 코스를 고른다.**
 *
 * 고를 코스는 시나리오 라이브러리(src/scenarios/library.ts)에 이미 있고 전부 검증을 통과했다.
 * 브라우저가 이번 판에 맞는 후보를 10개 안팎으로 추려 보낸다 — 레벨 예산, 보호구역·앞차 차례,
 * 최근에 탄 판을 뺀 것이고, 약점을 시험하는 것 · 쉬운 것 · 모양이 다른 것이 섞여 있다
 * (src/scenarios/recommend.ts 의 shortlist).
 *
 * 모델이 하는 일은 그중 **하나를 고르는 것**과, 왜 골랐는지를 학습자에게 말하는 것이다.
 * 판의 모양(보행자 시각 · 신호 구간)은 모델이 만지지 않는다 — 검증된 값이다.
 */

/** 위반 코드의 뜻 — 습관 기록을 읽을 때 쓴다 */
const VIOLATION_TEXT = {
  RED_NO_STOP: '정면 적색인데 일시정지 없이 우회전',
  RIGHT_ARROW_RED: '우회전 신호등 적색인데 우회전',
  PEDESTRIAN_BLOCKED: '보행자가 건너거나 건너려는데 정지하지 않음',
  SCHOOL_ZONE_NO_STOP: '보호구역 신호기 없는 횡단보도 앞 일시정지 안 함',
  NO_SLOW_DOWN: '교차로에서 서행하지 않음',
  WIDE_TURN: '우측 가장자리를 벗어난 대회전',
  BLOCKING_INTERSECTION: '진출로가 막혔는데 진입(꼬리물기)',
  NO_TURN_SIGNAL: '방향지시등 안 켬',
  OVER_STOP_LINE: '정지선을 넘어서 정지',
  SCHOOL_ZONE_RED: '보호구역 신호 있는 횡단보도 적색 통과',
};

export const SYSTEM_PROMPT = [
  '당신은 한국 도로교통법의 **우회전과 어린이보호구역 안전운전**을 가르치는 운전 교육 코치입니다.',
  '학습자의 운전 기록을 읽고, 검증된 훈련 코스 후보 중에서 **지금 이 사람에게 가장 필요한 코스 하나**를 고릅니다.',
  '',
  '## 후보 코스 읽는 법',
  '`번호 Level레벨 난N 보호구역 A쪽 C쪽 새:… | 제목 | 시험할 위반 코드` 꼴입니다.',
  '- `난N` 은 **조건 점수**입니다 — 같은 레벨이어도 큰 쪽이 판단할 것이 많습니다. 연달아 틀렸다면 낮은 쪽을 고릅니다.',
  '- 보호구역: `무신호` 는 **신호기 없는 보호구역 횡단보도**(사람이 없어도 일시정지 — 제27조 제7항)로,',
  '  이 게임이 가르치려는 **핵심**입니다. `신호보호구역`(30km/h·보행자 먼저)과 `진입로신호`(적색이면 녹색까지 기다림)도',
  '  필요하지만, 고를 것이 비슷하면 `무신호` 를 먼저 봅니다. `-` 는 보호구역이 아닙니다.',
  '- `A우`·`C좌` 는 보행자가 **어느 보도에서 오는가**입니다 (우 = 내 차와 같은 쪽, 양 = 양쪽, 없 = 그 횡단보도에 사람 없음).',
  '  최근 주행과 **다른 쪽**을 섞으면 학습자가 한쪽만 보는 버릇이 생기지 않습니다.',
  '- `새:…` 는 **이 학습자가 이 레벨에서 아직 겪지 않은 것**입니다. 나쁜 습관이 없을 때는 이것이 가장 중요한 기준입니다.',
  '- 제목은 한국어로 그대로 읽으면 됩니다. "건너려는" 은 보도 끝에서 건너려고 서 있는 사람으로,',
  '  **발을 떼기 전에도 양보 대상**입니다(통행하려는 때 — 제27조 제1항). 어린이는 작고 빠르며 노인은 천천히 건넙니다.',
  '- **레벨은 화면에 적힌 대로 `Level6` 꼴로 씁니다** — 추천 이유에 `L6` 라고 적으면 학습자가 보는 말과 달라집니다.',
  '',
  '## 고르는 원칙',
  '1. **가장 굳은 나쁜 습관(목록의 첫째)을 시험하는 코스**를 먼저 봅니다.',
  '   지점별 준수율이 낮은 곳과 이어지는 코스면 더 좋습니다.',
  '2. **최근 주행을 봅니다.**',
  '   - 최근 두세 판을 연달아 틀렸다면 **레벨이 낮은**(복습) 코스로 자신감을 돌려줍니다.',
  '   - 그렇지 않으면 **지금 레벨에서 새로 연 개념**의 코스를 먼저 고릅니다 — 레벨이 오른 뜻이 거기 있습니다.',
  '   - 최근에 탄 것과 **같은 종류**(같은 신호 · 같은 보행자 상황)는 피합니다.',
  '3. 나쁜 습관 기록이 없으면 **`새:` 가 많은 코스**를 먼저 봅니다 — 레벨에 맞는 여러 상황을 고루 겪어야',
  '   다음 레벨로 갑니다. 그중에서도 이 게임이 교정하려는 흔한 오해(정면 적색 일시정지 · 우회전 후 횡단보도',
  '   보행자 · 보호구역 신호기 없는 횡단보도 일시정지)를 시험하는 코스를 앞에 둡니다.',
  '',
  '## 답',
  'JSON 하나로만 답합니다. 다른 글은 쓰지 않습니다.',
  '{"id": 후보 번호, "why": "…", "focus": "…"}',
  '- `id`: **반드시 후보 목록에 있는 번호**.',
  '- `why`: 학습자에게 그대로 보여 줄 **추천 이유** 1~2문장, 90자 안팎, 존댓말.',
  '  **기록의 구체적인 사실**(몇 번 틀렸는지, 어느 지점 준수율이 몇 %인지, 최근 결과)과',
  '  **이 코스에서 그것을 어떻게 연습하는지**를 잇습니다. "약점을 분석했습니다" 같은 빈말은 쓰지 않습니다.',
  '  **기록에 없는 사실은 쓰지 않습니다** — 위반 코드와 숫자는 위 기록에 있는 것만 씁니다. 기록이 없으면 없다고 말합니다.',
  '- `focus`: 이번 판에서 **볼 것** 한 문장, 40자 안팎. 예: "앞차가 가도 정지선에서 먼저 서세요."',
].join('\n');

/**
 * 습관이 풀리는 데 필요한 **무위반 판 수**.
 *
 * 원본은 `src/coach/badHabits.ts` 의 `HABIT_CLEARED_AFTER` 다 — 서버는 브라우저 코드를 가져다 쓰지
 * 않으므로 값을 옮겨 적는다(coachPrompt 의 `SLOW_KMH` 와 같은 사정). **어긋나면 프롬프트가 학습자
 * 화면과 다른 수를 말하므로**, `tests/recommend.test.ts` 가 둘이 같은지 본다.
 */
export const HABIT_CLEARED_AFTER = 2;

const pct = (kept, total) => (total ? `${Math.round((kept / total) * 100)}%` : '-');

/** 보호구역의 종류 → 사람이 읽는 말 (src/scenarios/library.ts 의 `zoneKindOf`) */
const ZONE_WORD = {
  none: '-',
  signalZone: '신호보호구역',
  approachSignal: '진입로신호',
  noSignal: '무신호',
};

/** 보행자가 오는 쪽 → 한 글자 (같은 파일의 `sideOf`) */
const SIDE_WORD = { none: '없', left: '좌', right: '우', both: '양' };

/**
 * 커버리지 축 이름 → 사람이 읽는 말.
 *
 * **브라우저는 축 이름(키)만 보내고 한국어는 여기서 붙인다** — 모델에게 가는 글은 우리가 쓴 것만이어야
 * 한다(server/recommendHandler.mjs 의 `COVER_AXES` 가 키를 좁힌다). 축 이름을 그대로 보내면
 * `sideC` 같은 영어가 추천 이유에 섞여 나온다.
 */
const FRESH_TEXT = {
  signal: '신호',
  a: '첫횡단',
  c: '우회전후',
  zoneKind: '보호구역',
  lead: '앞차',
  kind: '보행자종류',
  env: '날씨',
  pressure: '재촉',
  jam: '정체',
  sideA: '첫횡단방향',
  sideC: '우회전후방향',
  sideS: '진입로방향',
};

/**
 * 후보 한 줄.
 *
 * 예전에는 `제목 · 시험 · 레벨` 셋뿐이라 **모델이 코스에 대해 아는 모든 것이 한국어 제목 안에 압축돼**
 * 있었다. 그래서 시스템 프롬프트가 40줄 중 17줄을 "제목 읽는 법" 사전에 썼고, 제목에도 태그에도 없는
 * 값(보행자가 어느 보도에서 오는가)은 아예 알 길이 없었다 — 사용자가 "우측에만 사람이 있다" 고 짚은 값이다.
 *
 * 지금은 **구조화된 메타를 앞에 두고 사전을 걷어냈다.** 토큰 총량은 그대로다.
 */
function courseLine(c) {
  const bits = [
    String(c.id),
    `Level${c.level}`,
    `난${c.cost ?? 0}`,
    ZONE_WORD[c.zoneKind] ?? '-',
    `A${SIDE_WORD[c.sideA] ?? '없'}`,
    `C${SIDE_WORD[c.sideC] ?? '없'}`,
  ];
  const fresh = (c.fresh ?? []).map((k) => FRESH_TEXT[k]).filter(Boolean);
  if (fresh.length) bits.push(`새:${fresh.join(',')}`);
  return `- ${bits.join(' ')} | ${c.title} | ${c.tests.length ? c.tests.join(',') : '기본 조작'}`;
}

/** 판마다 달라지는 값 — 사용자 메시지 */
export function buildUserPrompt(req) {
  const lines = [];
  lines.push(`## 학습자`);
  const streak = req.missStreak > 1 ? ` · **이어 ${req.missStreak}판 틀림**` : req.cleanStreak > 2 ? ` · 이어 ${req.cleanStreak}판 무위반` : '';
  lines.push(`- 지금 레벨: Level${req.level} (${req.tier}) · 지금까지 ${req.runs}판${streak}`);
  const CH = [
    '',
    '1 쉬움 — 중간 정도로 복잡한 코스',
    '2 조금 쉬움 — 판단할 것이 많은 코스',
    '3 보통 — 조건이 겹친 코스',
    '4 조금 어려움 — 복잡한 코스 · 한 레벨 위 개념까지 · 주행 중 도움 없음',
    '5 어려움 — 가장 복잡한 코스 · 두 레벨 위 개념까지 · 주행 중 도움 없음',
  ];
  lines.push(`- 학습자가 고른 난이도: ${CH[req.challenge] ?? '3 보통'} — 이 난이도에 맞는 코스를 고르십시오`);
  if (req.badHabits.length) {
    lines.push(
      '- **지금은 습관을 고치는 단계입니다** — 나쁜 습관이 모두 풀려야 다음 레벨로 올라갑니다. 습관은 그 위반이',
    );
    lines.push(`  일어날 수 있는 코스에서 ${HABIT_CLEARED_AFTER}번 지켜야 풀립니다. 후보는 모두 첫째 습관을 시험하는 코스입니다.`);
    lines.push('- 나쁜 운전 습관 (많이 한 순서, 첫째가 가장 굳은 것, "지킨 판" 은 풀리기까지 센 수):');
    for (const h of req.badHabits) {
      lines.push(
        `  - ${h.code} (${VIOLATION_TEXT[h.code] ?? h.code}): ${h.count}회 · 그 뒤 지킨 판 ${h.cleanRuns}/${HABIT_CLEARED_AFTER}`,
      );
    }
  } else {
    const need = req.xpNeed ?? 0;
    lines.push(
      need > 0
        ? `- 기록된 나쁜 운전 습관: 없음 — **다음 레벨을 준비하는 단계**입니다. 경험치 ${req.xp ?? 0}/${need} (새 맵 무위반 +100).`
        : '- 기록된 나쁜 운전 습관: 없음 — **다음 레벨을 준비하는 단계**입니다. 무위반이면 경험치가 쌓여 올라갑니다.',
    );
  }
  if (req.points.length) {
    lines.push(`- 지점별 준수율: ${req.points.map((p) => `${p.label} ${pct(p.kept, p.total)}(${p.kept}/${p.total})`).join(' · ')}`);
  }
  if (req.trend) {
    lines.push(`- 추이: 앞 절반 무위반율 ${Math.round(req.trend.early * 100)}% → 뒤 절반 ${Math.round(req.trend.late * 100)}%`);
  }
  lines.push('');
  lines.push('## 최근 주행 (오래된 것부터)');
  if (req.recent.length) {
    for (const r of req.recent) {
      lines.push(`- "${r.title}" → ${r.grade}${r.violations.length ? ` · 위반 ${r.violations.join(', ')}` : ''}`);
    }
  } else {
    lines.push('- 없음 (첫 판)');
  }
  lines.push('');
  lines.push('## 후보 코스 (하나를 고르십시오)');
  for (const c of req.courses) {
    lines.push(courseLine(c));
  }
  return lines.join('\n');
}
