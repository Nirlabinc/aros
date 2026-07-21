import { test, expect } from '@playwright/test';

// Public seams of J7 — install an app from the Marketplace
// (docs/journeys/install-an-app-from-marketplace.md), walked on the no-auth
// shell preview (/preview/app), which renders the same nav + section routing
// in demo mode (demo treats every in-shell app as installed). The authed
// install/gate path needs a session — covered by scripts/journey-walk.mjs
// seams + the browser step on beta.

test.describe('J7 — install an app from the Marketplace (public seams)', () => {
  test('sidebar reaches Marketplace, Connectors, and Plugins', async ({ page }) => {
    await page.goto('/preview/app');
    for (const label of ['Marketplace', 'Connectors', 'Plugins']) {
      await expect(page.getByRole('button', { name: new RegExp(`${label}$`) }).first()).toBeVisible();
    }
    await page.getByRole('button', { name: /Marketplace$/ }).first().click();
    await expect(page).toHaveURL(/\/marketplace$/);
    await expect(page.getByText('Marketplace', { exact: true }).first()).toBeVisible();
  });

  test('Connectors and Plugins get real URLs of their own', async ({ page }) => {
    await page.goto('/preview/app');
    await page.getByRole('button', { name: /Connectors$/ }).first().click();
    await expect(page).toHaveURL(/\/connectors$/);
    await page.getByRole('button', { name: /Plugins$/ }).first().click();
    await expect(page).toHaveURL(/\/plugins$/);
  });

  test('installed in-shell apps appear in the profile Workspace nav', async ({ page }) => {
    await page.goto('/preview/app');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    // Demo mode = every embedded app installed, so both must be present.
    await expect(page.getByRole('button', { name: /Documents$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /EDI Invoices$/ })).toBeVisible();
  });
});
