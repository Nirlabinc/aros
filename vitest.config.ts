import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/__tests__/**/*.test.ts',
      'appfactory/**/__tests__/**/*.test.ts',
      // Pure onboarding-journey logic (framework-free, no DOM/JSX imports).
      'apps/web/src/onboarding/**/*.test.ts',
      // Pure shell logic (framework-free, no DOM/JSX imports).
      'apps/web/src/redesign/routes.test.ts',
      'apps/web/src/redesign/pages/connections/appsLogic.test.ts',
    ],
    globals: true,
  },
});
