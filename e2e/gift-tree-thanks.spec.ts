import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, card, cardAction } from './helpers.js';

/**
 * After a gift package is made (1127, Milan's "ano"): a quiet line at the
 * bottom of the done message thanks the author by a coffee, with the About
 * dialog's coffee link (same address, new tab). It slides in a moment after
 * the done message; with prefers-reduced-motion it is simply there. A
 * cancelled making shows no such line.
 */

const TODAY = new Date('2026-12-10T10:00:00');

async function reviewForDaniel(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(TODAY);
    await openApp(page);
    await page.evaluate(async () => {
        await window.Strom.UI.loadDemoTree();
        await window.Strom.TreeRenderer.setFocus('demo_daniel' as never);
    });
    await expect(card(page, 'Daniel')).toBeVisible();
    await cardAction(page, 'Daniel', 'gift-tree');
    const dialog = page.locator('#gift-modal');
    await expect(dialog).toHaveClass(/active/);
    await dialog.locator('#gift-nav [data-step="6"]').click();
    await expect(dialog.locator('.gift-review')).toBeVisible();
    return dialog;
}

/** Create package, its download, the done message. */
async function make(page: Page, dialog: Locator): Promise<void> {
    const downloaded = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.locator('#gift-next').click();
    await downloaded;
    await expect(dialog.locator('.gift-run[data-phase="done"] .gift-run-h')).toHaveText('The package is ready', { timeout: 60_000 });
}

test('a package made: the coffee line slides in under the done message with About\'s coffee link', async ({ page }) => {
    test.setTimeout(90_000);
    // The suite runs with reduced motion (playwright.config.ts); this test watches the slide-in.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const dialog = await reviewForDaniel(page);
    await expect(dialog.locator('[data-gk="thanks"]')).toHaveCount(0);
    await make(page, dialog);
    const line = dialog.locator('.gift-run [data-gk="thanks"]');
    await expect(line).toBeVisible();
    await expect(line.locator('.gift-thanks-t')).toHaveText('The author can be thanked by buying a coffee.');
    const coffee = line.locator('[data-gk="coffee"]');
    await expect(coffee).toHaveText('Coffee for Strom');
    const about = await page.locator('#about-modal .about-coffee, .about-coffee:not(.about-share)').first().getAttribute('href');
    expect(about).toMatch(/^https:\/\//);
    await expect(coffee).toHaveAttribute('href', about!);
    await expect(coffee).toHaveAttribute('target', '_blank');
    await expect(coffee).toHaveAttribute('rel', /noopener/);
    // The slide-in: an animation with a delay after the done message.
    const anim = await line.evaluate(e => { const s = getComputedStyle(e); return { name: s.animationName, delay: s.animationDelay }; });
    expect(anim.name).toBe('gift-thanks-in');
    expect(parseFloat(anim.delay)).toBeGreaterThan(0);
    // The last element of the done message, below the rest.
    await expect(dialog.locator('.gift-run > *').last()).toHaveAttribute('data-gk', 'thanks');
});

test('reduced motion: the coffee line is there without an animation', async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });  // as the suite runs, said here for the test's point
    const dialog = await reviewForDaniel(page);
    await make(page, dialog);
    const line = dialog.locator('.gift-run [data-gk="thanks"]');
    await expect(line).toBeVisible();
    expect(await line.evaluate(e => getComputedStyle(e).animationName)).toBe('none');
    expect(await line.evaluate(e => getComputedStyle(e).opacity)).toBe('1');
});

test('a cancelled making shows no coffee line', async ({ page }) => {
    const dialog = await reviewForDaniel(page);
    // The app's file waits until released: the making stays in its second step.
    await page.evaluate(() => {
        const w = window as unknown as { __giftRelease?: () => void };
        const exporter = window.Strom.AppExporter as unknown as { buildFocusAppBlob: () => Promise<Blob> };
        exporter.buildFocusAppBlob = () => new Promise<Blob>(resolve => { w.__giftRelease = () => resolve(new Blob(['app'])); });
    });
    await dialog.locator('#gift-next').click();
    await expect(dialog.locator('.gift-run[data-phase="making"] .prog-k')).toHaveText('step 2 of 7');
    await dialog.locator('[data-gk="run-cancel"]').click();
    await page.evaluate(() => (window as unknown as { __giftRelease?: () => void }).__giftRelease?.());
    await expect(dialog.locator('.gift-run[data-phase="cancelled"] .gift-run-h')).toHaveText('Cancelled');
    await expect(dialog.locator('[data-gk="thanks"]')).toHaveCount(0);
});
