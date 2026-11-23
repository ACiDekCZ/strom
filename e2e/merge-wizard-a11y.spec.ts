import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCurrentStep, mergeGroup, mergeRow, mergeTreeInto } from './helpers.js';
import { axDialogsAndMenus, unnamedControls } from './a11y.js';

/**
 * The import guide's edges (spec 134 §13, §14): what a page reader finds in
 * steps 1, 2 and 5 (every control named, one named dialog, the list of pairs
 * a listbox of options with no control inside), the whole guide by keys
 * (Tab order header → steps → body → footer, kept inside the window, Enter,
 * the decision letters, Space ticks a join, Esc), the step list under
 * 1100 px, the primary button on a phone in every step, and an import that is
 * a copy of its tree (13b). The families Modřín (the tree) and Jilm (the
 * file) are invented.
 */

async function openGuide(page: Page): Promise<Locator> {
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    return wizard;
}

/** What a page reader misses in the window: controls without a name. */
async function readerGaps(page: Page, step: string): Promise<void> {
    const unnamed = await unnamedControls(page);
    expect.soft(unnamed.map(u => `[${u.role}] "${u.name}" ${u.html}`), `step ${step}`).toEqual([]);
    const dialogs = (await axDialogsAndMenus(page)).filter(d => d.html.includes('merge-modal'));
    expect.soft(dialogs.map(d => d.name), `step ${step}`).toEqual(['Import a family tree']);
}

/** Which part of the window holds the focus. */
function focusPart(page: Page): Promise<string> {
    return page.evaluate(() => {
        const a = document.activeElement;
        if (!a || !a.closest('#merge-modal')) return 'outside';
        if (a.closest('.modal-header')) return 'header';
        if (a.closest('#merge-progress')) return 'steps';
        if (a.closest('#merge-step-body')) return 'body';
        if (a.closest('.merge-actions')) return 'footer';
        return 'other';
    });
}

test('a page reader finds every control of steps 1, 2 and 5 named, one named dialog, and the pairs as a listbox of options', async ({ page }) => {
    const wizard = await openGuide(page);
    await expect(wizard.locator('#merge-counts')).toHaveAttribute('role', 'status');
    await expect(wizard.locator('#merge-progress')).toHaveAttribute('aria-label', /.+/);
    await readerGaps(page, '1');

    await mergeCompare(wizard);
    await readerGaps(page, '2');
    const list = wizard.locator('#merge-match-list');
    await expect(list).toHaveAttribute('role', 'listbox');
    await expect(list.locator('[role="option"]').first()).toBeVisible();
    // No control inside an option (a reader cannot reach it), in any group.
    for (const g of ['same', 'new'] as const) {
        await mergeGroup(wizard, g);
        expect(await list.locator('[role="option"] :is(button, a, select, textarea, input:not([tabindex="-1"]))').count()).toBe(0);
    }
    await readerGaps(page, '2 (New)');

    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '5');
    await readerGaps(page, '5');
});

test('the whole guide by keys: Tab runs header → steps → body → footer and stays in the window, Enter goes on, letters decide, Space ticks a join, Esc asks', async ({ page }) => {
    const wizard = await openGuide(page);
    // A new step: its heading holds the focus.
    await expect(wizard.locator('#merge-step-body .merge-step-title')).toBeFocused();

    // Tab from the heading through step 1 to the footer, then round to the header: never out of the window.
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        const part = await focusPart(page);
        if (seen[seen.length - 1] !== part) seen.push(part);
        if (part === 'header' && seen.includes('footer')) break;
    }
    expect(seen).toEqual(['body', 'footer', 'header']);

    // Enter on the primary compares: step 2, its heading focused.
    await wizard.locator('#merge-next').focus();
    await page.keyboard.press('Enter');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '2');
    await expect(wizard.locator('#merge-step-body .merge-step-title')).toBeFocused();

    // Tab order on step 2: header → the finished step 1 (a button) → body → footer.
    await wizard.locator('.modal-header .close-btn').focus();
    const order: string[] = ['header'];
    for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        const part = await focusPart(page);
        if (order[order.length - 1] !== part) order.push(part);
        if (part === 'footer') break;
    }
    expect(order).toEqual(['header', 'steps', 'body', 'footer']);

    // The same: Space on the focused row ticks its join, Undo the joins of the selected wakes up.
    await mergeGroup(wizard, 'same');
    const kvido = mergeRow(wizard, 'Kvido');
    await kvido.click();
    await expect(mergeRow(wizard, 'Kvido')).toBeFocused();
    await expect(mergeRow(wizard, 'Kvido')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press(' ');
    await expect(mergeRow(wizard, 'Kvido')).toHaveAttribute('aria-checked', 'true');
    await expect(mergeRow(wizard, 'Kvido').locator('.merge-item-check')).toBeChecked();
    await expect(wizard.locator('.merge-unjoin')).toBeEnabled();
    await page.keyboard.press(' ');
    await expect(mergeRow(wizard, 'Kvido')).toHaveAttribute('aria-checked', 'false');
    await expect(wizard.locator('.merge-unjoin')).toBeDisabled();

    // X on the pair: not added (the count of Not added follows).
    await page.keyboard.press('x');
    await expect(wizard.locator('#merge-counts [data-count="skipped"] .merge-stat-value')).toHaveText('1');

    // On to step 5 by Enter; Back by keys; the finished step 2 is a button Enter goes back to.
    await wizard.locator('#merge-next').focus();
    await page.keyboard.press('Enter');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '5');
    await expect(wizard.locator('#merge-step-body .merge-step-title')).toBeFocused();
    const step2 = wizard.locator('#merge-progress button.merge-step[data-step="2"]');
    await step2.focus();
    await page.keyboard.press('Enter');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '2');
    await expect(wizard.locator('#merge-step-body .merge-step-title')).toBeFocused();

    // Esc asks (1b); Esc there goes on with the merge, the window and the decision kept.
    await page.keyboard.press('Escape');
    const ask = page.locator('#merge-close-confirm');
    await expect(ask).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement?.closest('#merge-close-confirm'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(ask).toBeHidden();
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-counts [data-count="skipped"] .merge-stat-value')).toHaveText('1');
});

test.describe('a tablet', () => {
    test.use({ viewport: { width: 900, height: 800 } });
    test('under 1100 px only the current step keeps its second line, each step says all of itself in its title', async ({ page }) => {
        const wizard = await openGuide(page);
        await mergeCompare(wizard);
        const subs = wizard.locator('#merge-progress .merge-step-sub');
        await expect(wizard.locator('#merge-progress .merge-step.active .merge-step-sub')).toBeVisible();
        await expect(subs.filter({ visible: true })).toHaveCount(1);
        await expect(wizard.locator('#merge-progress .merge-step[data-step="1"]')).toHaveAttribute('title', /^1 What to do · Add · a\)$/);
        await expect(wizard.locator('#merge-progress .merge-step[data-step="4"]')).toHaveAttribute('title', /^4 Who is right · /);
        // Nothing of the step list is wider than its place.
        const spill = await wizard.locator('#merge-progress .merge-step').evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).length);
        expect(spill).toBe(0);
    });
});

test.describe('a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('the primary button is on the screen in steps 1, 2 and 5', async ({ page }) => {
        const wizard = await openGuide(page);
        const next = wizard.locator('#merge-next');
        await expect(next).toBeInViewport();
        await mergeCompare(wizard);
        await expect(next).toBeInViewport();
        await next.click();
        await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '5');
        await expect(next).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
});

test('an import that is a copy of its tree: after the comparison one sentence says so, Show the comparison shows the pairs, the primary only closes and nothing is written', async ({ page }) => {
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi kopie');
    const ids = await page.evaluate(() => Object.fromEntries(window.Strom.TreeManager.getTrees().map((t: { id: string; name: string }) => [t.name, t.id])));
    const before = await page.evaluate(() => window.Strom.TreeManager.getTrees().length);
    const wizard = await mergeTreeInto(page, ids['Modřínovi'], ids['Modřínovi kopie']);
    await mergeCompare(wizard);

    const note = wizard.locator('.merge-s2-copy');
    await expect(note).toContainText('All 3 people are already in the tree Modřínovi kopie and bring nothing new.');
    await expect(wizard.locator('#merge-match-list')).toHaveCount(0);
    await expect(wizard.locator('#merge-next')).toHaveText('Close');
    await expect(wizard.locator('#merge-next')).toBeEnabled();

    await note.getByRole('button', { name: 'Show the comparison' }).click();
    await expect(wizard.locator('#merge-match-list [role="option"]')).toHaveCount(3);
    await expect(wizard.locator('.merge-s2-copy-note')).toHaveText('All 3 people are already in the tree Modřínovi kopie and bring nothing new.');
    await expect(wizard.locator('#merge-next')).toHaveText('Close');

    await wizard.locator('#merge-next').click();
    await expect(wizard).toBeHidden();
    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(before);
});
