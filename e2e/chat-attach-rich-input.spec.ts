import { test, expect, type Page } from '@playwright/test';

// Golden path of "Store owner shows the assistant something"
// (docs/journeys/chat-attach-rich-input.md), walked the way Ramesh would: land
// on the chat, tap the "+" beside the message box, pick a source, see what he
// attached sitting above the box. No seeded state, no API shortcuts — only what
// is on screen.
//
// The bug this exists to catch: the attach menu rendered with
// `position:absolute; bottom:calc(100% + 8px)` while being a SIBLING of the
// trigger, with no positioned ancestor on any composer. It resolved against the
// viewport and landed offscreen, so step 2 of the journey was unreachable on
// every surface and the whole feature was dead. A unit test cannot see that; a
// visibility assertion on the real DOM can.

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function openChat(page: Page) {
  await page.goto('/preview/app');
  // Ramesh lands on Home and opens the chat from the nav — same two taps he'd
  // make, no direct-URL shortcut.
  await page.getByRole('button', { name: /Chat$/ }).first().click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
}

function attachTrigger(page: Page) {
  return page.getByRole('button', { name: 'Add an attachment' });
}

test.describe('J-attach — show the assistant a photo, file, or barcode', () => {
  test('step 1→2: "+" opens a menu that is actually on screen', async ({ page }) => {
    await openChat(page);

    const trigger = attachTrigger(page);
    await expect(trigger).toBeVisible();

    const menu = page.getByRole('menu', { name: 'Attach' });
    await expect(menu).toBeHidden();

    await trigger.click();
    await expect(menu).toBeVisible();

    // Every documented source is offered, and the menu box sits inside the
    // viewport — the regression was a menu that existed but rendered offscreen.
    for (const label of ['Photo', 'File', 'Camera', 'Barcode']) {
      await expect(page.getByRole('menuitem', { name: label })).toBeVisible();
    }
    const box = await menu.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  });

  test('step 3: a picked file is staged above the box and can be removed', async ({ page }) => {
    await openChat(page);
    await attachTrigger(page).click();

    // Drive the real picker the menu opens (the browser's file dialog is the
    // one thing a spec cannot click, so we hand the chooser its file).
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Photo' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'shelf-tag.png', mimeType: 'image/png', buffer: PNG_1PX });

    // Success signal: what he attached is visible above the box, with a way out.
    const remove = page.getByRole('button', { name: 'Remove shelf-tag.png' });
    await expect(remove).toBeVisible();
    await expect(page.getByAltText('shelf-tag.png')).toBeVisible();

    // Every failure state recovers without support: removing puts him back.
    await remove.click();
    await expect(remove).toBeHidden();
  });

  test('an unsupported file is refused with a reason, not silence', async ({ page }) => {
    await openChat(page);
    await attachTrigger(page).click();

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'File' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'installer.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('installer.exe');
    await expect(alert).toContainText('not a supported type');
  });

  test('Escape closes the menu and returns focus to the "+"', async ({ page }) => {
    await openChat(page);
    const trigger = attachTrigger(page);
    await trigger.click();

    const menu = page.getByRole('menu', { name: 'Attach' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
