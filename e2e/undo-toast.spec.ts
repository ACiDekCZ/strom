import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

/**
 * The visible Undo affordances added in round 7: the bottom-centre "Undo" toast
 * raised after each single mutation, and the ⋯ actions-menu Undo / Redo rows
 * with their descriptions and disabled states.
 */

test('undo toast appears after adding a person; Undo reverts and confirms', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await expect(card(page, 'Jan')).toBeVisible();

    // Adding the person raised the paper-pill Undo toast with the description.
    const toast = page.locator('.undo-toast');
    await expect(toast).toBeVisible();
    await expect(toast.locator('.undo-toast-msg')).toContainText('Jan');

    // Clicking Undo runs the same path as Ctrl+Z: Jan is removed…
    await toast.locator('.undo-toast-btn').click();
    await expect(card(page, 'Jan')).toBeHidden();
    // …and a confirmation toast (no button) reports what was reverted.
    const confirm = page.locator('.toast');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Undone');
    // The undo toast itself is gone.
    await expect(page.locator('.undo-toast')).toBeHidden();
});

test('undo toast auto-dismisses on Escape', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await expect(page.locator('.undo-toast')).toBeVisible();
    await page.locator('#tree-container').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    await expect(page.locator('.undo-toast')).toBeHidden();
});

test('Undo / Redo live in the toolbar, not in the ⋯ menu: description and disabled states', async ({ page }) => {
    await openApp(page);
    const undo = page.locator('#toolbar-undo-btn');
    const redo = page.locator('#toolbar-redo-btn');
    // Nothing done yet: both visible and disabled.
    await expect(undo).toBeVisible();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('.actions-menu-btn').click();
    await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
    await expect(page.locator('#actions-menu-dropdown')).not.toContainText('Undo');
    await page.keyboard.press('Escape');

    // The toolbar Undo carries the last change and the platform shortcut;
    // Redo is disabled (nothing to replay yet).
    await expect(undo).toBeEnabled();
    await expect(undo).toHaveAttribute('title', /^Undo: .*Jan/);
    await expect(undo).toHaveAttribute('title', /Ctrl\+Z|⌘Z/);
    await expect(redo).toBeDisabled();

    // Undo: the stack is now empty, so Undo greys out and Redo becomes available.
    await undo.click();
    await expect(card(page, 'Jan')).toBeHidden();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();

    // Redo brings the person back and re-enables Undo.
    await redo.click();
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(undo).toBeEnabled();
});

/**
 * One toast at a time (GitHub #4, round 6 §43): a message replaces the one
 * before it at the same place; the undo pill is a message as the others. A
 * message coming while the pill stands shows in its place and carries its
 * "Undo" for the pill's own time (6 s), then "Undo" goes and the message runs
 * its own time; a message gone sooner gives the pill back for the time left.
 * Invented names.
 */
test.describe('one toast at a time, the undo pill a message as the others', () => {
    /** The toasts a person sees now (a message, the undo pill, the focus toast's box). */
    const toastsOnScreen = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body > .toast, body > .undo-toast, #focus-toast .focus-toast-box')]
        .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0;
        }).length);

    /** The bottom edge of the element once it has slid in. */
    const settledBottom = async (page: Page, sel: string): Promise<number> => {
        await expect.poll(() => page.evaluate(s => document.querySelector(s)?.getAnimations().length ?? -1, sel)).toBe(0);
        return page.evaluate(s => document.querySelector(s)!.getBoundingClientRect().bottom, sel);
    };

    const hasHaldewin = (page: Page) => page.evaluate(() =>
        window.Strom.DataManager.getAllPersons().some((p: { firstName: string }) => p.firstName === 'Haldewin'));

    /** Jan in the tree, his father Haldewin deleted: the undo pill for the deletion stands. */
    async function deleteWithPill(page: Page): Promise<void> {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Zwolbrack');
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = dm.getAllPersons()[0];
            const o = dm.createPerson({ firstName: 'Haldewin', lastName: 'Zwolbrack', gender: 'male' });
            dm.addParentChild(o.id, jan.id);
        });
        await page.evaluate(() => {
            const o = window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Haldewin');
            void window.Strom.UI.confirmDelete(o.id);
        });
        await page.locator('#confirm-ok-btn').click();
        expect(await hasHaldewin(page)).toBe(false);
        await expect(page.locator('body > .undo-toast.show .undo-toast-msg')).toContainText('Haldewin');
        await page.mouse.move(8, 300);
    }

    for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 800 }]) {
        test(`${size.width}: a message replaces the message before it at the same place`, async ({ page }) => {
            await page.setViewportSize(size);
            await openApp(page);
            await page.evaluate(() => window.Strom.UI.showToast('Alpha', 10000));
            const a = await settledBottom(page, 'body > .toast.show');
            await page.evaluate(() => window.Strom.UI.showToast('Beta', 10000));
            await expect(page.locator('body > .toast')).toHaveCount(1);
            await expect(page.locator('body > .toast')).toHaveText('Beta');
            expect(Math.abs(await settledBottom(page, 'body > .toast.show') - a)).toBeLessThanOrEqual(1);
            await expect.poll(() => toastsOnScreen(page)).toBe(1);
        });

        test(`${size.width}: a message while the undo pill stands shows in its place and carries "Undo", which works`, async ({ page }) => {
            await page.setViewportSize(size);
            await deleteWithPill(page);
            const pill = page.locator('body > .undo-toast.show');
            const pillBottom = await settledBottom(page, 'body > .undo-toast.show');
            await page.evaluate(() => window.Strom.UI.showToast('Copied', 10000));
            const message = page.locator('body > .toast');
            await expect(message).toContainText('Copied');
            const undo = message.getByRole('button', { name: 'Undo' });
            await expect(undo).toBeVisible();
            await expect(pill).toBeHidden();
            await expect.poll(() => toastsOnScreen(page)).toBe(1);
            // At the pill's place (its bottom edge)
            expect(Math.abs(await settledBottom(page, 'body > .toast.show') - pillBottom)).toBeLessThanOrEqual(1);
            await undo.click();
            await expect.poll(() => hasHaldewin(page)).toBe(true);
            await expect(page.locator('body > .toast')).toContainText('Undone');
            await expect(page.locator('body > .toast .undo-toast-btn')).toHaveCount(0);
            await expect.poll(() => toastsOnScreen(page)).toBe(1);
        });
    }

    test('"Undo" leaves the message when the pill\'s time runs out; the message runs its own time', async ({ page }) => {
        await deleteWithPill(page);
        await page.evaluate(() => window.Strom.UI.showToast('Copied', 10000));
        const message = page.locator('body > .toast');
        await expect(message.locator('.undo-toast-btn')).toHaveCount(1);
        await expect(message.locator('.undo-toast-btn')).toHaveCount(0, { timeout: 7000 });
        await expect(message).toBeVisible();
        await expect(message).toHaveText('Copied');
        await expect(page.locator('body > .undo-toast.show')).toHaveCount(0);
        expect(await hasHaldewin(page)).toBe(false);
    });

    test('a message gone before the pill\'s time gives the pill back with "Undo"', async ({ page }) => {
        await deleteWithPill(page);
        await page.evaluate(() => window.Strom.UI.showToast('Copied', 800));
        await expect(page.locator('body > .toast .undo-toast-btn')).toHaveCount(1);
        const pill = page.locator('body > .undo-toast.show');
        await expect(pill).toBeVisible({ timeout: 3000 });
        await expect(page.locator('body > .toast')).toHaveCount(0);
        await expect(pill.locator('.undo-toast-btn')).toBeVisible();
        await expect.poll(() => toastsOnScreen(page)).toBe(1);
        await pill.locator('.undo-toast-btn').click();
        await expect.poll(() => hasHaldewin(page)).toBe(true);
    });

    test('a pointer on the message carrying "Undo" holds the pill\'s time', async ({ page }) => {
        await deleteWithPill(page);
        await page.evaluate(() => window.Strom.UI.showToast('Copied', 20000));
        const message = page.locator('body > .toast');
        await expect(message.locator('.undo-toast-btn')).toHaveCount(1);
        await message.hover();
        await page.waitForTimeout(7000);
        await expect(message.locator('.undo-toast-btn')).toHaveCount(1);
        await page.mouse.move(8, 300);
        await expect(message.locator('.undo-toast-btn')).toHaveCount(0, { timeout: 7000 });
    });

    test('390: the undo pill coming while a message stands shows in the message\'s place; gone, the message comes back', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 800 });
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showToast('Copied', 30000));
        const at = await settledBottom(page, 'body > .toast.show');
        await createFirstPerson(page, 'Jan', 'Zwolbrack');
        const pill = page.locator('body > .undo-toast.show');
        await expect(pill).toBeVisible();
        await expect(page.locator('body > .toast')).toBeHidden();
        await expect.poll(() => toastsOnScreen(page)).toBe(1);
        expect(Math.abs(await settledBottom(page, 'body > .undo-toast.show') - at)).toBeLessThanOrEqual(1);
        await page.locator('#tree-container').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Escape');
        await expect(page.locator('body > .toast')).toBeVisible();
        await expect(page.locator('body > .toast')).toHaveText('Copied');
        await expect.poll(() => toastsOnScreen(page)).toBe(1);
    });
});

/**
 * A toast to be read stands 3 s at least (GitHub #4, round 7 §53): a message
 * with its own action or a notice, the undo pill and the focus confirmation
 * are not replaced sooner. An undo pill or a message coming sooner waits and
 * shows the moment those 3 s are over, with its own full time; a message
 * without an action is still replaced at once. Invented names.
 */
test.describe('a toast to be read stands 3 s at least', () => {
    /** Milliseconds since the page's own clock read `t0`. */
    const since = (page: Page, t0: number) => page.evaluate(t => performance.now() - t, t0);
    const now = (page: Page) => page.evaluate(() => performance.now());

    test('the undo pill coming 1 s after a message with an action waits until that message has stood 3 s, then stands its own 6 s', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Zwolbrack');
        await page.locator('#tree-container').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Escape');
        await expect(page.locator('body > .undo-toast')).toHaveCount(0);
        const t0 = await now(page);
        await page.evaluate(() => window.Strom.UI.showToast('Older copy of the tree', 8000, { action: { label: 'Open', run: () => {} } }));
        await expect(page.locator('body > .toast.show')).toBeVisible();
        await page.waitForTimeout(1000);
        await page.evaluate(() => window.Strom.UI.showUndoToast('adding Wolfbrecht'));
        // Not yet: the message with its action stands, the pill is not there
        await page.waitForTimeout(1200);
        await expect(page.locator('body > .undo-toast')).toHaveCount(0);
        await expect(page.locator('body > .toast')).toContainText('Older copy of the tree');
        // Its 3 s over: the pill shows in its place, the message waits under it
        const pill = page.locator('body > .undo-toast.show');
        await expect(pill).toBeVisible({ timeout: 2000 });
        const shownAfter = await since(page, t0);
        expect(shownAfter).toBeGreaterThanOrEqual(2900);
        expect(shownAfter).toBeLessThan(4200);
        await expect(pill.locator('.undo-toast-btn')).toBeVisible();
        // Its own full time: still there 5 s after it came
        await page.waitForTimeout(5000);
        await expect(page.locator('body > .undo-toast.show')).toHaveCount(1);
    });

    test('a message without an action coming 1 s after a notice waits for the notice\'s 3 s; one after a plain message replaces it at once', async ({ page }) => {
        await openApp(page);
        const t0 = await now(page);
        await page.evaluate(() => window.Strom.UI.showToast('This is an older copy of the tree', 8000, { notice: true }));
        await page.waitForTimeout(1000);
        await page.evaluate(() => window.Strom.UI.showToast('Copied', 8000));
        await page.waitForTimeout(1200);
        await expect(page.locator('body > .toast')).toHaveText('This is an older copy of the tree');
        await expect(page.locator('body > .toast')).toHaveText('Copied', { timeout: 2000 });
        expect(await since(page, t0)).toBeGreaterThanOrEqual(2900);
        await expect(page.locator('body > .toast')).toHaveCount(1);
        // A plain message: the next one at once
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 8000));
        await expect(page.locator('body > .toast')).toHaveText('Saved', { timeout: 500 });
    });

    test('the waiting message shows at once when the toast to be read goes sooner (its action used)', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showToast('Assigned', 8000, { action: { label: 'Open', run: () => {} } }));
        await expect(page.locator('body > .toast.show .toast-action')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.showToast('Copied', 8000));
        await expect(page.locator('body > .toast')).toHaveText('AssignedOpen');
        await page.locator('body > .toast .toast-action').click();
        await expect(page.locator('body > .toast.show')).toHaveText('Copied', { timeout: 1000 });
    });

    test('a newer undo pill replaces the pill standing at once (its "Undo" would undo the newer change)', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showUndoToast('adding Wolfbrecht'));
        await expect(page.locator('body > .undo-toast.show')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.showUndoToast('adding Sigwulf'));
        await expect(page.locator('body > .undo-toast.show .undo-toast-msg')).toHaveText('adding Sigwulf', { timeout: 1000 });
    });
});

test('a change of the UI language closes the undo pill and the "Undone: …" message said in the old one', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const pill = page.locator('body > .undo-toast');
    await expect(pill).toBeVisible();
    await expect(pill.locator('.undo-toast-btn')).toHaveText('Undo');
    // The pill's sentence was made in English when the change was: it cannot be said in Czech, so it goes.
    await page.evaluate(() => window.Strom.UI.setLanguage('cs' as never));
    await expect(pill).toHaveCount(0, { timeout: 1500 });
    // The change itself can still be undone (Czech now); its "Vráceno: …" goes on the next change of language.
    await page.evaluate(() => window.Strom.UI.performUndo());
    const done = page.locator('body > .toast.show');
    await expect(done).toContainText('Vráceno:');
    await page.evaluate(() => window.Strom.UI.setLanguage('en' as never));
    await expect(page.locator('body > .toast')).toHaveCount(0, { timeout: 1500 });
    // The same language chosen again changes nothing: a pill standing stays.
    await page.evaluate(() => window.Strom.UI.showUndoToast('adding Wolfbrecht'));
    await expect(pill).toBeVisible();
    await page.evaluate(() => window.Strom.UI.setLanguage('en' as never));
    await page.waitForTimeout(400);
    await expect(pill).toBeVisible();
});
