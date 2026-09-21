/**
 * **AI 의 평가를 목록으로 그린다** (ui/Screens.ts 의 coachLines).
 *
 * 코치는 개조식으로 답한다 — `- ` 로 시작하는 2~4줄 (server/coachPrompt.mjs). 사용자가 줄글을 보고 말했다:
 * "눈에 띄지가 않아. 개조식으로 작성해 줘."
 *
 * 여기서 못 박는 것은 **모델이 형식을 안 지켜도 화면이 멀쩡한가**다. 답의 모양은 늘 어긋날 수 있고,
 * 그때 빈 칸이 뜨거나 태그가 글자로 보이면 안 된다.
 */
import { describe, expect, it } from 'vitest';

import { coachLines } from '../src/ui/Screens';

describe('코치 답 그리기', () => {
  it('`- ` 줄을 목록으로 옮긴다', () => {
    const html = coachLines('- 정지선 완전정지 — 정확히 지켰습니다\n- 다음 판 — 3초만 세면 됩니다!');
    expect(html).toContain('<ul class="coach-list">');
    expect(html).toContain('<li>정지선 완전정지 — 정확히 지켰습니다</li>');
    expect(html).toContain('<li>다음 판 — 3초만 세면 됩니다!</li>');
  });

  it('말머리가 빠진 줄도 버리지 않는다 — 모델이 형식을 반만 지켜도 말은 다 보인다', () => {
    const html = coachLines('- 정지선 완전정지 — 정확했습니다\n\n오늘 주행 — 최고예요!');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('<li>오늘 주행 — 최고예요!</li>');
  });

  it('빈 줄과 앞뒤 공백을 걷어낸다', () => {
    const html = coachLines('\n  - 첫 줄  \n\n  - 둘째 줄\n\n');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('<li>첫 줄</li>');
  });

  it('줄글로 답해도 그대로 보여 준다 — 형식을 안 지켰다고 빈 칸이 되면 안 된다', () => {
    const html = coachLines('정지선을 잘 지키셨습니다. 다음에도 그렇게 해 주세요.');
    expect(html).not.toContain('<ul');
    expect(html).toContain('정지선을 잘 지키셨습니다.');
  });

  it('HTML 은 이스케이프한다 — 모델의 답은 남의 글이다', () => {
    expect(coachLines('- <script>alert(1)</script>')).toContain('&lt;script&gt;');
    expect(coachLines('<b>굵게</b>')).toContain('&lt;b&gt;');
  });
});
