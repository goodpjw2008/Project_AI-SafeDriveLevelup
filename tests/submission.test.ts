/**
 * **공모전 제출 전 기능 점검** — 사용자가 정했다 (2026-11-15: *"1.1.0으로 버전을 올려주고 공모전 제출전 최종 버전으로 해줘.
 * 공모전 제출전 기능 테스트를 추가해줘"*).
 *
 * 제출본(1.1.0)이 발표자료 · README 가 말하는 것과 어긋나지 않는지 **한 곳에서** 본다 — 버전, 시나리오 수, AI 모델 열 개가 모두
 * 학습된 값인지, AI 사용 설정 세 가지와 기본값, 후원 페이지(준비중 · 도와주신 분), 사이트 주소와 검색 등록 파일, 공개 저장소의
 * 규칙(API 키 · 학습용 키). 기능마다의 자세한 동작은 그 기능의 테스트가 맡고, 여기서는 '제출할 때 빠지거나
 * 바뀐 것이 없는가' 만 본다. 숫자를 바꿀 일이 생기면 발표자료와 README 도 함께 고친다.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { APP_SITE, APP_VERSION } from '../src/brand';
import { defaultSave } from '../src/economy/save';
import { scenarioLibrary } from '../src/scenarios/library';
import { zoneCourses } from '../src/scenarios/zoneCourse';
import { scenarioCounts } from '../src/scenarios/scenarioCode';
import { attentionModelReady } from '../src/ai/recommendAttention';
import { recommendModelReady } from '../src/ai/recommendNet';
import { coachModelReady } from '../src/ai/localCoach';
import { driveModelReady } from '../src/ai/drivePolicy';
import { signalModelReady } from '../src/ai/signalPolicy';
import { intentModelReady } from '../src/ai/intent';
import { SUPPORT_DONATE, SUPPORT_HELPERS, SUPPORT_NEWS, SUPPORT_SPONSORS } from '../src/support';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

describe('공모전 제출 전 기능 점검 — 1.1.0', () => {
  it('버전 — package.json · 설정 창의 버전 · CHANGELOG 맨 위가 모두 1.1.0 이고, 제출 전 최종 버전이라고 적혀 있다', () => {
    expect(JSON.parse(read('package.json')).version).toBe('1.1.0');
    expect(APP_VERSION).toBe('1.1.0');
    const log = read('CHANGELOG.md');
    const first = log.split('\n').find((l) => l.startsWith('## ['));
    expect(first).toMatch(/^## \[1\.1\.0\] - \d{4}-\d{2}-\d{2}$/);
    expect(log.slice(log.indexOf(first!), log.indexOf('## [', log.indexOf(first!) + 4))).toContain('공모전 제출 전 최종 버전');
    expect(log).toContain('[1.1.0]: https://github.com/goodpjw2008/Project_AI-SafeDriveLevelup/compare/v1.0.8...v1.1.0');
  });

  it(
    '시나리오 — 라이브러리 22,818판 = 우회전 3,985 + 복합 18,833, 따로 보호구역 전용 도로 180판 (발표자료 6 · 8장의 숫자)',
    () => {
      expect(scenarioLibrary().length).toBe(22818);
      expect(zoneCourses().length).toBe(180);
      expect(scenarioCounts()).toEqual({ C: 180, L: 3985, M: 18833 });
    },
    600_000,
  );

  it('AI 모델 — 열 개가 모두 학습된 값이고, 앱이 그 모델을 쓴다(학습 전 대체 경로가 아니다)', () => {
    const dir = join(ROOT, 'src/ai/models');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.sort()).toEqual(
      ['coach', 'difficulty', 'drive', 'intent', 'lidar', 'outcome', 'recommend-attn', 'recommend', 'risk', 'signal'].map((n) => `${n}.json`).sort(),
    );
    for (const f of files) expect(JSON.parse(readFileSync(join(dir, f), 'utf8')).meta?.trained, f).toBe(true);
    expect(attentionModelReady(), '로컬 신경망(어텐션)').toBe(true);
    expect(recommendModelReady(), '로컬 신경망(MLP)').toBe(true);
    expect(coachModelReady(), '로컬 코치').toBe(true);
    expect(driveModelReady(), 'AI 자율주행 핸들 · 브레이크').toBe(true);
    expect(signalModelReady(), 'AI 자율주행 신호 판단').toBe(true);
    expect(intentModelReady(), '보행자 의도 예측').toBe(true);
  });

  it("AI 사용 설정 — 세 가지 이름이 발표자료와 같고, 새로 시작하면 '로컬 신경망(어텐션)' 이다", () => {
    expect(defaultSave().settings.aiMode).toBe('attention');
    const screens = read('src/ui/Screens.ts');
    for (const name of ["'로컬 신경망(어텐션) ·기본'", "'로컬 신경망(MLP)'", "'로컬 신경망(MLP) + 외부 LLM'"]) expect(screens, name).toContain(name);
    expect(screens).not.toContain("'로컬 신경망 + 외부 LLM'");
  });

  it("후원 — '후원(준비중)' 세 곳, 준비 중 안내, 도와주신 분 안산단원경찰서, 후원사 · 후원 창구는 아직 비어 있다", () => {
    expect(SUPPORT_HELPERS).toEqual(['안산단원경찰서']);
    expect(SUPPORT_SPONSORS).toHaveLength(0);
    expect(SUPPORT_DONATE.url).toBe('');
    expect(SUPPORT_NEWS.url.startsWith('https://www.hani.co.kr/')).toBe(true);
    const screens = read('src/ui/Screens.ts');
    // 첫 화면 버튼 · 휴대폰 설정 창의 버튼 · 후원 창의 제목
    expect(screens.match(/후원\(준비중\)<\/button>|title: '후원\(준비중\)'/g)?.length).toBe(3);
    expect(screens).toContain('후원을 준비하고 있습니다.');
    expect(screens).toContain('현재 저는 고등학생입니다.');
    expect(screens).toContain('서비스의 최소 운영비용으로');
    expect(screens).toContain('교통안전을 지키는 비용으로 사용');
  });

  it('사이트 — 주소는 safedrive.ai.kr, 검색 등록 파일(robots · sitemap)과 공유 그림이 있다', () => {
    expect(APP_SITE).toBe('https://safedrive.ai.kr');
    expect(read('public/robots.txt')).toContain('Sitemap: https://safedrive.ai.kr/sitemap.xml');
    expect(read('public/sitemap.xml')).toContain('<loc>https://safedrive.ai.kr/</loc>');
    expect(existsSync(join(ROOT, 'public/og-image.png'))).toBe(true);
  });

  it('공개 저장소 규칙 — 배포되는 코드에 API 키 · 학습용 Vertex 키 이름이 없다', () => {
    const TEXT = new Set(['.ts', '.mts', '.js', '.mjs', '.html', '.css', '.json', '.md', '.txt', '.xml', '.svg']);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const p = join(dir, name);
        const st = statSync(join(ROOT, p));
        if (st.isDirectory()) walk(p);
        else if (TEXT.has(extname(name)) && st.size < 8_000_000) files.push(p);
      }
    };
    for (const d of ['src', 'server', 'api', 'public']) walk(d);
    files.push('README.md', 'CHANGELOG.md');
    const KEY = /AIza[0-9A-Za-z_-]{30,}|gsk_[0-9A-Za-z]{20,}/; // Gemini · Groq 키의 꼴
    const bad: string[] = [];
    for (const f of files) {
      const text = read(f);
      if (KEY.test(text)) bad.push(`${f}: API 키처럼 보이는 값`);
      if (!f.endsWith('.md') && text.includes('GOOGLE_CLOUD_AGENT_PLATFORM')) bad.push(`${f}: 학습용 Vertex 키 이름`);
    }
    expect(bad).toEqual([]);
    expect(files.length).toBeGreaterThan(100);
  });
});
