import { defineConfig } from '@playwright/test';

// Browser E2E for the golden journeys (docs/journeys/). Two modes:
// - Local (default): starts the real web app (frontend only) on a dedicated
//   port; specs mock /api/* at the network layer — no backend, no seeded state.
// - Deployed: set E2E_BASE_URL (plus E2E_EMAIL/E2E_PASSWORD for the live
//   journey specs) to walk a running surface; no local server is started.
const E2E_PORT = 5599;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || `http://localhost:${E2E_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // NOTE: no "--" separator — pnpm would pass it literally to vite,
        // which then ignores the port flags and serves on the config port.
        command: `pnpm --filter @aros/web dev --port ${E2E_PORT} --strictPort`,
        port: E2E_PORT,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          // Dummy public keys are fine here: specs never reach Supabase — the
          // client only needs non-empty values to construct.
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://e2e-local.supabase.co',
          VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'e2e-local-anon-key',
        },
      },
});
