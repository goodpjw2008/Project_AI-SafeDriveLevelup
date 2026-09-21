import { defineConfig } from 'vitest/config';

/**
 * 테스트 설정을 vite.config.ts 와 분리한다.
 * vite.config.ts 는 `root: 'src'` 로 잡혀 있어(빌드 템플릿이 src/index.html 이므로)
 * 그대로 두면 Vitest 가 src/ 아래에서만 테스트를 찾아 tests/ 를 놓친다.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
