import { test, expect } from '@playwright/test';

// Public seams of J8 — manage my account (docs/journeys/manage-my-account.md),
// walked on the no-auth shell preview (/preview/app), which renders the same
// profile-panel nav and section routing in demo mode. The authed save path
// goes straight to Supabase auth — covered by the browser step on beta.

test.describe('J8 — manage my account (public seams)', () => {
  test('avatar → Profile lands on /profile with its own page', async ({ page }) => {
    await page.goto('/preview/app');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: /^Pr Profile$/ }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByText('Account', { exact: true }).first()).toBeVisible();
  });

  test('Profile and Settings are distinct sections', async ({ page }) => {
    await page.goto('/preview/app');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: /Settings$/ }).first().click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('button', { name: /^Pr Profile$/ }).click();
    await expect(page).toHaveURL(/\/profile$/);
  });
});
