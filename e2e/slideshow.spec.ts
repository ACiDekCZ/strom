import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The longest stop: a story's 8 s plus the 1.7 s flight (STOP_STORY, FLIGHT_MS
 * in src/ui/slideshow.ts), and a little more. Run on Playwright's clock.
 */
const PAST_ONE_STOP_MS = 10_000;

/** Slideshow / TV mode: hands-off flight through the tree. */
test('slideshow spotlights each stop, hides the chrome and is keyboard driven', async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.startSlideshow());
    await expect(page.locator('body')).toHaveClass(/slideshow-mode/);
    // The tree's chrome steps aside; the caption takes over.
    await expect(page.locator('.toolbar')).toBeHidden();
    await expect(page.locator('.zoom-controls')).toBeHidden();
    await expect(page.locator('#slideshow-caption')).toBeVisible();
    // Exactly one card is spotlighted.
    await expect.poll(() => page.locator('.person-card.slideshow-current').count()).toBe(1);
    const first = await page.locator('#slideshow-caption .slideshow-name').textContent();

    // Arrow keys move the show and the spotlight follows.
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.locator('#slideshow-caption .slideshow-name').textContent()).not.toBe(first);
    await expect(page.locator('.person-card.slideshow-current')).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => page.locator('#slideshow-caption .slideshow-name').textContent()).toBe(first);

    // Playing, a stop's time moves the show on by itself.
    await page.clock.fastForward(PAST_ONE_STOP_MS);
    await expect.poll(() => page.locator('#slideshow-caption .slideshow-name').textContent()).not.toBe(first);

    // Space pauses (no auto-advance while paused, for longer than any stop).
    await page.keyboard.press(' ');
    await expect(page.locator('body')).toHaveClass(/slideshow-paused/);
    const held = await page.locator('#slideshow-caption .slideshow-name').textContent();
    await page.clock.fastForward(PAST_ONE_STOP_MS);
    await expect(page.locator('#slideshow-caption .slideshow-name')).toHaveText(held!);

    // Esc leaves and restores the app; the spotlight is cleaned up.
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/slideshow-mode/);
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('.person-card.slideshow-current')).toHaveCount(0);
});

test('slideshow started from the fan view runs in Family and restores the fan on exit', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    // Enter a standalone view (fan) — it draws into its own container and the
    // tree canvas (with the person cards) is hidden.
    await page.locator('#view-mode-fan').click();
    await expect(page.locator('#fan-container .fan-svg')).toBeVisible();
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('fan');

    // Starting the show from the fan view switches to Family (so it has cards
    // to fly to) and tells the user with a toast.
    await page.evaluate(() => window.Strom.UI.startSlideshow());
    await expect(page.locator('.toast')).toContainText(/Family view/i);
    await expect(page.locator('body')).toHaveClass(/slideshow-mode/);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('family');
    // The show actually plays: exactly one card is spotlighted.
    await expect.poll(() => page.locator('.person-card.slideshow-current').count()).toBe(1);

    // Leaving restores the fan view the user came from.
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/slideshow-mode/);
    await expect(page.locator('#fan-container .fan-svg')).toBeVisible();
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('fan');
});

test('slideshow needs at least two visible people', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await page.locator('#input-firstname').fill('Solo');
    await page.locator('#input-lastname').fill('Person');
    await page.locator('#person-modal').getByRole('button', { name: 'Save' }).click();
    await expect(card(page, 'Solo')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.startSlideshow());
    await expect(page.locator('.toast')).toContainText(/more people/i);
    await expect(page.locator('body')).not.toHaveClass(/slideshow-mode/);
});
