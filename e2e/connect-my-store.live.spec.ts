import { test, expect } from '@playwright/test';

// Live golden-path walk for J2 (docs/journeys/connect-my-store.md) against a
// DEPLOYED surface — the journey-gate E2E. Runs only when E2E_BASE_URL,
// E2E_EMAIL and E2E_PASSWORD are set (a beta test account); it never saves a
// connector, so it is read-only against the environment. Deepest step (a real
// POS connect with test-store credentials) is deliberately not automated yet —
// see docs/journeys/WALK-FINDINGS.md.
const BASE = process.env.E2E_BASE_URL;
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

// No trace retention in this file: a failure trace would snapshot the filled
// password field — a credential-bearing artifact.
test.use({ trace: 'off' });

test.describe('J2 — connect my store (live surface)', () => {
  test.skip(!BASE || !EMAIL || !PASSWORD, 'set E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD to run');

  test('Ramesh signs in and every credential field explains itself', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-email').fill(EMAIL!);
    await page.locator('#login-password').fill(PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });

    await page.goto('/connect');
    // Step 1: his POS by name, not "connector types". Role-scoped — the same
    // label also appears in the "Your connections" list on seasoned accounts.
    await expect(page.getByRole('button', { name: 'RapidRMS POS' }).first()).toBeVisible();
    await expect(page.getByText('Not sure which one?')).toBeVisible();

    // Step 2: each field explained in one line, tied to its input (a11y).
    const clientId = page.locator('#conn-clientId');
    await expect(clientId).toBeVisible();
    await expect(clientId).toHaveAttribute('aria-describedby', 'conn-clientId-hint');
    await expect(page.locator('#conn-clientId-hint')).toBeVisible();
  });
});
