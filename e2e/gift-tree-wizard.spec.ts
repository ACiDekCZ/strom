import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, card, cardAction } from './helpers.js';

/**
 * Give a family tree… (spec 093 §2, §4, §9): the guide opened from the person
 * menu of the sample tree (Daniel Berg: his household is his wife Julia and
 * their children Adam and Nora), steps 1 → 3, an exception "in full" in step 3
 * changes the numbers, and the guide opened again starts from last time's
 * settings ("Last time …"). On a computer and on a phone (the list of steps as
 * a bottom sheet).
 */

const TODAY = new Date('2026-12-10T10:00:00');

async function openGuide(page: Page): Promise<Locator> {
    await cardAction(page, 'Daniel', 'gift-tree');
    const dialog = page.locator('#gift-modal');
    await expect(dialog).toHaveClass(/active/);
    return dialog;
}

async function sampleOnDaniel(page: Page): Promise<void> {
    await page.clock.setFixedTime(TODAY);
    await openApp(page);
    await page.evaluate(async () => {
        await window.Strom.UI.loadDemoTree();
        await window.Strom.TreeRenderer.setFocus('demo_daniel' as never);
    });
    await expect(card(page, 'Daniel')).toBeVisible();
}

/** Step 3's numbers: living, in full, shortened (the wide set). */
async function livingStats(dialog: Locator, phone = false): Promise<number[]> {
    const shown = dialog.locator(phone ? '.gift-stats .structure-stat:not(.gift-stat-wide) b' : '.gift-stats .structure-stat:not(.gift-stat-phone) b');
    return (await shown.allTextContents()).map(Number);
}

function livingRow(dialog: Locator, name: string): Locator {
    return dialog.locator('li.gift-lv-r', { hasText: name });
}

test('from the person menu: steps 1 to 3, an exception in full changes the numbers, opened again it starts from last time', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sampleOnDaniel(page);
    const dialog = await openGuide(page);

    // Step 1: for whom — one person, Daniel, the summary on the side.
    await expect(dialog.locator('#gift-title')).toHaveText('Give a family tree');
    await expect(dialog.locator('#gift-sub')).toHaveText('step 1 of 6: For whom');
    await expect(dialog.locator('#gift-nav [data-step]')).toHaveCount(6);
    await expect(dialog.locator('#gift-nav [data-step="1"]')).toHaveAttribute('aria-current', 'step');
    await expect(dialog.locator('[role="radio"][data-mode="single"]')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('.gift-prow .gift-pname')).toHaveText('Daniel Berg');
    await expect(dialog.locator('.gift-sum-name')).toHaveText('Daniel Berg');
    await expect(dialog.locator('.gift-defaults .gift-h3')).toHaveText('Default settings');
    await expect(dialog.locator('.gift-last')).toHaveCount(0);
    await expect(dialog.locator('#gift-cancel')).toBeVisible();

    // Next → step 2 (step 1 done), Next → step 3.
    const next = dialog.locator('#gift-next');
    await next.click();
    await expect(dialog.locator('#gift-sub')).toHaveText('step 2 of 6: Who is in it');
    await expect(dialog.locator('#gift-nav [data-step="1"] .gift-ok')).toHaveCount(1);
    await next.click();
    await expect(dialog.locator('#gift-sub')).toHaveText('step 3 of 6: Living people');
    await expect(dialog.locator('#gift-prev')).toBeVisible();
    await expect(dialog.locator('#gift-cancel')).toBeHidden();

    // The household is in full and locked; the others are shortened.
    const [living, full, short] = await livingStats(dialog);
    expect(full).toBe(4);
    expect(living).toBe(full + short);
    expect(short).toBeGreaterThan(0);
    for (const name of ['Daniel Berg', 'Julia Novak', 'Adam Berg', 'Nora Berg']) {
        await expect(livingRow(dialog, name).locator('input')).toBeDisabled();
        await expect(livingRow(dialog, name).locator('input')).toBeChecked();
    }
    const sarah = livingRow(dialog, 'Sarah Walsh');
    await expect(sarah.locator('.gift-lv-v')).toHaveText('S. W., 1948');
    await expect(sarah.locator('input')).not.toBeChecked();

    // An exception: Sarah in full — one more in full, one fewer shortened.
    await sarah.locator('input').check();
    await expect.poll(() => livingStats(dialog)).toEqual([living, full + 1, short - 1]);
    await expect(livingRow(dialog, 'Sarah Walsh').locator('.gift-lv-v')).toHaveText('in full');
    await expect(dialog.locator('.gift-sum')).toContainText(`${living} living`);

    // Nothing overflows sideways.
    const wide = await dialog.locator('.modal').evaluate(m => [m, ...m.querySelectorAll('.gift-pane, .gift-lv-r, .gift-cols')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
    expect(wide).toEqual([]);

    // × makes nothing and remembers the settings.
    await dialog.locator('.modal-header .close-btn').click();
    await expect(dialog).not.toHaveClass(/active/);

    // Opened again: step 1 from last time's settings, every step done.
    await openGuide(page);
    await expect(dialog.locator('#gift-sub')).toHaveText('step 1 of 6: For whom');
    await expect(dialog.locator('.gift-last b')).toHaveText('Last time 12/10/2026 – same settings.');
    await expect(dialog.locator('.gift-last')).toContainText('Start over with defaults');
    await expect(dialog.locator('.gift-defaults .gift-h3')).toHaveText('Settings from last time');
    await expect(dialog.locator('#gift-nav .gift-ok')).toHaveCount(6);
    // The exception is kept.
    await dialog.locator('#gift-nav [data-step="3"]').click();
    await expect(dialog.locator('#gift-sub')).toHaveText('step 3 of 6: Living people');
    await expect(livingRow(dialog, 'Sarah Walsh').locator('input')).toBeChecked();

    // Start over with defaults: no exception, no "Last time".
    await dialog.locator('#gift-nav [data-step="1"]').click();
    await dialog.getByRole('button', { name: 'Start over with defaults' }).click();
    await expect(dialog.locator('.gift-last')).toHaveCount(0);
    await expect(dialog.locator('.gift-defaults .gift-h3')).toHaveText('Default settings');

    // Escape closes too.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveClass(/active/);
});

test('on a phone: the whole screen, the list of steps as a sheet, step 3 in one column, opened again from last time', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sampleOnDaniel(page);
    const dialog = await openGuide(page);
    const modal = dialog.locator('.modal');

    // The whole screen; the side tabs give way to the subtitle button.
    const box = (await modal.boundingBox())!;
    expect(box.width).toBe(390);
    await expect(dialog.locator('#gift-nav')).toBeHidden();
    const subBtn = dialog.locator('#gift-sub-btn');
    await expect(subBtn).toHaveText(/^Step 1 of 6 · For whom/);
    await expect(dialog.locator('#gift-foot-sum')).toContainText('people');
    // A list of people is made on a computer only.
    await expect(dialog.locator('[role="radio"][data-mode="list"]')).toHaveAttribute('aria-disabled', 'true');

    // The list of steps: six rows; step 3 from it.
    await subBtn.click();
    const sheet = page.locator('.gift-steps-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[id^="gift-sheet-step-"]')).toHaveCount(6);
    await sheet.locator('#gift-sheet-step-3').click();
    await expect(sheet).toBeHidden();
    await expect(subBtn).toHaveText(/^Step 3 of 6 · Living people/);

    // Step 3 in one column: the numbers (living, in full, shortened, people), the list.
    const [living, full, short] = await livingStats(dialog, true);
    expect(full).toBe(4);
    expect(living).toBe(full + short);
    const sarah = livingRow(dialog, 'Sarah Walsh');
    await sarah.locator('input').check();
    await expect.poll(async () => (await livingStats(dialog, true)).slice(0, 3)).toEqual([living, full + 1, short - 1]);
    const wide = await modal.evaluate(m => [m, ...m.querySelectorAll('.gift-pane, .gift-lv-r, .gift-cols')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
    expect(wide).toEqual([]);

    // × closes; opened again: last time's settings.
    await dialog.locator('.modal-header .close-btn').click();
    await expect(dialog).not.toHaveClass(/active/);
    await openGuide(page);
    await expect(dialog.locator('.gift-last b')).toHaveText('Last time 12/10/2026 – same settings.');
    await subBtn.click();
    await expect(sheet.locator('#gift-sheet-step-6')).toContainText('✓');
    await sheet.locator('#gift-sheet-step-3').click();
    await expect(livingRow(dialog, 'Sarah Walsh').locator('input')).toBeChecked();
    // ‹ goes a step back.
    await dialog.locator('#gift-back').click();
    await expect(subBtn).toHaveText(/^Step 2 of 6/);
});

test('step 2: the preview\'s counts cover no card, on a phone upright and sideways, a tablet and a computer, light and dark', async ({ page }) => {
    await sampleOnDaniel(page);
    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    for (const [w, h] of [[390, 844], [844, 390], [1024, 768], [1440, 900]] as const) {
        for (const theme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width: w, height: h });
            await page.evaluate(t => window.Strom.SettingsManager.setTheme(t), theme);
            await page.evaluate(() => window.Strom.UI.showGiftTree({ personId: 'demo_daniel' as never }));
            const dialog = page.locator('#gift-modal');
            await expect(dialog).toHaveClass(/active/);
            const nav = dialog.locator('#gift-nav');
            if (await nav.isVisible()) await nav.locator('[data-step="2"]').click();
            else {
                await dialog.locator('#gift-sub-btn').click();
                await page.locator('.gift-steps-sheet #gift-sheet-step-2').click();
            }
            const host = dialog.locator('.gift-prev-host:visible').first();
            const top = host.locator('.gift-prev-top');
            await expect(top).toContainText('Personen');
            const where = `${w}×${h} ${theme}`;
            const clash = await host.evaluate((hostEl) => {
                // The part of a card the stage shows (it clips the drawing) must stay clear of the counts.
                const t = hostEl.querySelector('.gift-prev-top')!.getBoundingClientRect();
                const stage = hostEl.querySelector('.gift-prev-stage')!.getBoundingClientRect();
                const cut = (a: DOMRect, b: DOMRect) => new DOMRect(Math.max(a.left, b.left), Math.max(a.top, b.top),
                    Math.min(a.right, b.right) - Math.max(a.left, b.left), Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
                const meet = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
                return [...hostEl.querySelectorAll<HTMLElement>('.gift-mc, .gift-stub')]
                    .map(c => ({ c, seen: cut(c.getBoundingClientRect(), stage) }))
                    .filter(({ seen }) => seen.width > 0 && seen.height > 0 && meet(seen, t))
                    .map(({ c }) => c.textContent);
            });
            expect(clash, where).toEqual([]);
            const wide = await dialog.locator('.modal').evaluate(m => [m, ...m.querySelectorAll('.gift-pane, .gift-prev-host')]
                .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
            expect(wide, where).toEqual([]);
            await dialog.locator('.modal-header .close-btn').click();
            await expect(dialog).not.toHaveClass(/active/);
        }
    }
});
