import { test, expect, type Page } from '@playwright/test';

// Public seams of the golden journeys (docs/journeys/), walked the way a
// stranger would: from the entry route, reading only what's on screen. All
// /api/* traffic is mocked at the network layer — no backend, no seeded state.
// The authenticated golden path lives in connect-my-store.live.spec.ts.

async function fillSignup(page: Page) {
  await page.getByPlaceholder('Dana Reyes').fill('Ramesh Patel');
  await page.getByPlaceholder('dana@fivepointsmarket.com').fill('ramesh@cornerliquor.com');
  await page.getByPlaceholder('Create a strong password').fill('Corner!Liquor#2026');
  await page.getByPlaceholder('Five Points Market').fill('Corner Liquor');
  // Intent picker: the only type="button" tiles inside the form.
  await page.locator('form button[type="button"]').first().click();
}

test.describe('J1 — sign up and see value (public seams)', () => {
  test('landing page offers a way in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href="/signup"]').first()).toBeVisible();
  });

  test('signup golden path hands off to login', async ({ page }) => {
    await page.route('**/api/signup', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );
    await page.goto('/signup');
    await fillSignup(page);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/login\?registered=true/);
  });

  test('failed signup surfaces the error AND keeps the typed draft (get-unstuck)', async ({ page }) => {
    await page.route('**/api/signup', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Signup hiccup — try again' }) }),
    );
    await page.goto('/signup');
    await fillSignup(page);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('.aros-auth__error')).toBeVisible();
    // Draft-safety invariant: a failed submit must never destroy typed input.
    await expect(page.getByPlaceholder('Dana Reyes')).toHaveValue('Ramesh Patel');
    await expect(page.getByPlaceholder('Five Points Market')).toHaveValue('Corner Liquor');
  });
});

test.describe('Fail-closed seams', () => {
  test('a stranger asking for /connect lands on login, not the connect form', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.locator('#login-email')).toBeVisible();
  });

  test('login page renders its form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
