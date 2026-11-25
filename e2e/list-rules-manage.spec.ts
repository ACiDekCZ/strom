/**
 * Managing lists of custom rules (spec 136 §8, §11, §15): the rule in words in
 * the overview and the detail (two lines, whole in the tooltip), where a list
 * came from (a template, the agent; nothing for one made by hand); a list
 * leading in a loop disabled in the choice of Another list with the loop's
 * path, a loop in the stored data said under the condition with Save
 * disabled; a person or list no longer in the tree drawn as its name with
 * "missing", "Choose another person…" first in the row's ⋯, the overview's
 * and the detail's warning; a list another list uses asks before it is
 * deleted, Undo brings the references back; a read-only tree shows the words
 * and the origin without actions; a slow count says "Counting…"; the phone's four lines and "Whole rule ›";
 * in another window (079): Show in the tree and the time of a change, which
 * the main window writes when it saves the window's edit.
 * Invented names only; the clock is fixed.
 */

import { test, expect, Page } from '@playwright/test';
import { card } from './helpers';
import { form, listRow, lists, openList, seedFamily, NOW } from './list-rules-seed';

const row = (page: Page, path: string) => form(page).locator(`.plr-row[data-path="${path}"]`);
const menu = (page: Page) => page.locator('.plr-menu');
const item = (page: Page, id: string) => menu(page).locator(`.pl-menu-item[data-id="${id}"]`);

const MILL_WORDS = 'Descendants: Arvid Quellmayer, up to 4 generations · and (birth 1800–1860 or (place Mlýnky within 10 km and women)) · except age at death up to 5 years';

test.describe('Custom rules in the lists: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the rule in words, two lines with the whole in the tooltip, and where the list came from', async ({ page }) => {
        await seedFamily(page);
        await openList(page, 'l-mill');
        const d = lists(page);
        await expect(listRow(page, 'l-mill').locator('.pl-row-meta')).toHaveText(`automatic · ${MILL_WORDS}`);
        await expect(listRow(page, 'l-near').locator('.pl-row-meta')).toHaveText('automatic · List Mlýnky branch');
        await expect(listRow(page, 'l-agent').locator('.pl-row-meta')).toHaveText('fixed · changed Nov 14');
        await expect(listRow(page, 'l-mill').locator('.pl-row-meta')).not.toHaveClass(/is-warn/);

        const rule = d.locator('.pl-rule');
        await expect(rule.locator('.pl-rule-k')).toHaveText('Based on');
        await expect(rule.locator('.pl-rule-v')).toHaveText(MILL_WORDS);
        await expect(rule.locator('.pl-rule-t')).toHaveAttribute('title', MILL_WORDS);
        // At most two lines.
        const lines = await rule.locator('.pl-rule-t').evaluate(el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
        expect(lines).toBeLessThanOrEqual(2);
        await expect(rule.locator('.pl-rule-acts .pl-link')).toHaveText(['Edit rule…', 'Add condition…']);
        await expect(rule.locator('.pl-rule-whole')).toHaveCount(0);
        await expect(d.locator('.pl-origin')).toHaveText('From template “From a place and surroundings” · Nov 12, 2026');

        await listRow(page, 'l-agent').click();
        await expect(d.locator('.pl-origin')).toHaveText('Created by the agent · Nov 14, 2026');
        await expect(d.locator('.pl-rule')).toHaveCount(0);
        await listRow(page, 'l-plain').click();
        await expect(d.locator('.pl-origin')).toHaveCount(0);
    });

    test('a missing person: "missing" in the overview, the detail and the builder; Choose another person… first', async ({ page }) => {
        await seedFamily(page);
        await openList(page, 'l-look');
        const d = lists(page);
        const meta = listRow(page, 'l-look').locator('.pl-row-meta');
        await expect(meta).toHaveText('automatic · The rule refers to a missing person');
        await expect(meta).toHaveClass(/is-warn/);
        await expect(listRow(page, 'l-look').locator('.pl-row-count')).toHaveText('0');
        const note = d.locator('.pl-note--warn');
        await expect(note).toContainText('The rule refers to a missing person: Ilsa Quellmayerová – the condition counts as empty.');
        await expect(d.locator('.pl-rule-v')).toHaveText('Ancestors: Ilsa Quellmayerová – missing, all generations · and without a citation or source');
        await note.locator('[data-act="edit-rule"]').click();

        const f = form(page);
        await expect(f).toBeVisible();
        const gone = row(page, '0').locator('[data-pc="person"]');
        await expect(gone).toHaveClass(/plr-gone/);
        await expect(gone.locator('.plr-pick-t')).toHaveText('Ilsa Quellmayerová');
        await expect(gone.locator('.tag')).toHaveText('missing');
        await expect(row(page, '0').locator('> .plr-k')).toHaveText('0 people');
        await row(page, '0').locator('> .plr-d').click();
        await expect(menu(page).locator('.pl-menu-item').first()).toHaveText('Choose another person…');
        await item(page, 'other-person').click();
        await expect(page.locator('.tov-pop')).toBeVisible();
        await page.locator('.tov-pop .tov-pop-search').fill('Gustav');
        await page.locator('.tov-pop .tov-pop-row[data-id="g"]').click();
        await expect(gone).not.toHaveClass(/plr-gone/);
        await expect(row(page, '0').locator('[data-pc="person"] .plr-pick-t')).toHaveText('Gustav Quellmayer · * 1880');
    });

    test('Another list: a loop is disabled in the choice; a loop in the stored data is said and cannot be saved', async ({ page }) => {
        await seedFamily(page);
        await openList(page, 'l-mill');
        await lists(page).locator('.pl-rule [data-act="add-condition"]').click();
        const f = form(page);
        await expect(f).toBeVisible();
        await menu(page).locator('.pl-msearch').fill('another list');
        await item(page, 'list').click();
        // The choice opens at once: Neighbours uses Mlýnky branch, so it would make a loop.
        const near = item(page, 'l-near');
        await expect(near).toHaveAttribute('aria-disabled', 'true');
        await expect(near).toContainText('would make a loop: Mlýnky branch → Neighbours → Mlýnky branch');
        await expect(item(page, 'l-plain')).not.toHaveAttribute('aria-disabled', 'true');
        await expect(item(page, 'l-plain')).toContainText('2');
        await expect(item(page, 'l-mill')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        // Loop A uses Loop B, which uses Loop A: said under the condition, Save disabled.
        await page.evaluate(() => window.Strom.UI.closeNewPersonList());
        await openList(page, 'l-loopa');
        await lists(page).locator('.pl-rule [data-act="edit-rule"]').click();
        await expect(f).toBeVisible();
        await expect(row(page, '0').locator('.plr-cyc')).toHaveText('would make a loop: Loop A → Loop B → Loop A');
        await expect(row(page, '0').locator('> .plr-k')).toHaveText('–');
        await expect(f.locator('[data-act="create"]')).toBeDisabled();
        await expect(f.locator('.pln-total')).toHaveText('The rule cannot be saved like this');
    });

    test('a list another list uses asks before it is deleted; Undo brings the list and the references back', async ({ page }) => {
        await seedFamily(page);
        await openList(page, 'l-mill');
        const d = lists(page);
        // Neighbours has the people of Mlýnky branch.
        const n = await listRow(page, 'l-mill').locator('.pl-row-count').innerText();
        await expect(listRow(page, 'l-near').locator('.pl-row-count')).toHaveText(n);
        await d.locator('.pl-more').click();
        await d.locator('.pl-menu [data-run="delete"]').click();
        const ask = page.locator('#confirmation-modal');
        await expect(ask.locator('#confirm-title')).toHaveText('Delete the list “Mlýnky branch”?');
        await expect(ask).toContainText(`The list has ${n} people; the people stay in the tree.`);
        await expect(ask).toContainText('Used by: Neighbours. The “Another list” condition shows as “missing” there.');
        await expect(ask).toContainText('Deleting can be undone – the list and the references to it come back.');
        await ask.locator('#confirm-cancel-btn').click();
        await expect(listRow(page, 'l-mill')).toHaveCount(1);

        await d.locator('.pl-more').click();
        await d.locator('.pl-menu [data-run="delete"]').click();
        await ask.getByRole('button', { name: 'Delete' }).click();
        await expect(listRow(page, 'l-mill')).toHaveCount(0);
        await expect(listRow(page, 'l-near').locator('.pl-row-meta')).toHaveText('automatic · The rule refers to a missing list');
        await expect(listRow(page, 'l-near').locator('.pl-row-count')).toHaveText('0');
        const toast = page.locator('.undo-toast', { hasText: 'List “Mlýnky branch” deleted.' });
        await toast.locator('.undo-toast-btn').click();
        await expect(listRow(page, 'l-mill')).toHaveCount(1);
        await expect(listRow(page, 'l-near').locator('.pl-row-meta')).toHaveText('automatic · List Mlýnky branch');
        await expect(listRow(page, 'l-near').locator('.pl-row-count')).toHaveText(n);

        // A list nobody uses goes at once, as before.
        await listRow(page, 'l-plain').click();
        await d.locator('.pl-more').click();
        await d.locator('.pl-menu [data-run="delete"]').click();
        await expect(ask).toBeHidden();
        await expect(listRow(page, 'l-plain')).toHaveCount(0);
    });

    test('a slow count: "Counting…" with the total so far, the rows quiet, then the new count', async ({ page }) => {
        await seedFamily(page);
        await openList(page, 'l-mill');
        await lists(page).locator('.pl-rule [data-act="edit-rule"]').click();
        const f = form(page);
        await expect(f).toBeVisible();
        const total = f.locator('.pln-total');
        const before = await total.innerText();
        // Every count takes 300 ms from now on; the paint after "Counting…" waits until released.
        await page.evaluate(() => {
            const real = performance.now.bind(performance);
            let extra = 0;
            performance.now = () => real() + (extra += 300);
            const w = window as unknown as { __held: FrameRequestCallback[]; __raf: typeof requestAnimationFrame };
            w.__held = [];
            w.__raf = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = (cb) => { w.__held.push(cb); return 0; };
        });
        // The first change counts as before (the last count was quick) and learns it is slow now.
        await f.locator('.plr-top [data-op="any"]').click();
        await expect(total).not.toHaveText(before);
        const any = await total.innerText();
        // The next change: "Counting…" with the total so far, the rows' counts quiet.
        await f.locator('.plr-top [data-op="all"]').click();
        await expect(total).toHaveText(`Counting… ${any.replace(/ match$/, '').replace(/^/, 'so far ')}`);
        await expect(total).toHaveClass(/is-busy/);
        await expect(f.locator('.plr-row[data-path="0"] > .plr-k')).toHaveClass(/is-busy/);
        // The paint comes: the new count.
        await page.evaluate(() => {
            const w = window as unknown as { __held: FrameRequestCallback[]; __raf: typeof requestAnimationFrame };
            window.requestAnimationFrame = w.__raf;
            for (const cb of w.__held.splice(0)) cb(performance.now());
        });
        await expect(total).toHaveText(before);
        await expect(total).not.toHaveClass(/is-busy/);
    });

    test('a read-only tree: the words and the origin without actions', async ({ page }) => {
        await seedFamily(page);
        await page.evaluate(() => { (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true; });
        await openList(page, 'l-mill');
        const d = lists(page);
        await expect(d.locator('.pl-rule-v')).toHaveText(MILL_WORDS);
        await expect(d.locator('.pl-origin')).toHaveText('From template “From a place and surroundings” · Nov 12, 2026');
        await expect(d.locator('.pl-rule-acts')).toHaveCount(0);
        await expect(d.locator('.pl-more')).toHaveCount(0);
        await listRow(page, 'l-look').click();
        await expect(d.locator('.pl-note--warn')).toContainText('The rule refers to a missing person');
        await expect(d.locator('.pl-note--warn button')).toHaveCount(0);
    });
});

test.describe('Custom rules in the lists: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('four lines and Whole rule › (the dialog; unfolded in place in a read-only tree)', async ({ page }) => {
        await seedFamily(page);
        await openList(page, 'l-mill');
        const d = lists(page);
        const t = d.locator('.pl-rule-t');
        const lines = () => t.evaluate(el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
        const folded = await lines();
        expect(folded).toBeLessThanOrEqual(4);
        await expect(d.locator('.pl-origin')).toBeVisible();
        await d.locator('.pl-rule-whole').tap();
        await expect(form(page)).toBeVisible();
        await expect(form(page).locator('.plr-row')).not.toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeNewPersonList());

        await page.evaluate(() => { (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true; });
        await page.evaluate(() => window.Strom.UI.closePersonLists());
        await openList(page, 'l-mill');
        await expect(d.locator('.pl-rule-whole')).toHaveText('Whole rule ›');
        await d.locator('.pl-rule-whole').tap();
        await expect(d.locator('.pl-rule')).toHaveClass(/is-whole/);
        expect(await lines()).toBeGreaterThanOrEqual(folded);
        await expect(d.locator('.pl-rule-whole')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
});

test.describe('Custom rules in the lists: another window (079)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Show in the tree from a Family window; an edit there gets its change time in the main window', async ({ page, context }) => {
        await seedFamily(page);
        const treeId = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
        const sat = await context.newPage();
        await sat.clock.setFixedTime(NOW);
        await sat.goto(`/strom.html?okno=family&tree=${encodeURIComponent(treeId)}&w=lr01aa`);
        await expect(card(sat, 'Benedikt')).toBeVisible();
        expect(await sat.evaluate(() => window.Strom.DataManager.isWindowCopy())).toBe(true);

        await openList(sat, 'l-mill');
        await lists(sat).locator('.pl-rule [data-act="edit-rule"]').click();
        await expect(form(sat)).toBeVisible();
        const show = form(sat).locator('.pln-foot [data-act="show-tree"]');
        await show.click();
        const pill = sat.locator('#evidence-pill');
        await expect(pill).toBeVisible();
        await expect(form(sat)).toBeHidden();
        await expect(card(sat, 'Benedikt')).toHaveClass(/evidence-hit/);
        await pill.locator('.evidence-pill-back').click();
        await expect(form(sat)).toBeVisible();
        await expect(show).toBeFocused();
        await sat.evaluate(() => window.Strom.UI.closeNewPersonList());

        // A person edited in the window: the main window saves it with the time.
        await sat.evaluate(() => window.Strom.DataManager.updatePerson('g' as never, { birthPlace: 'Vrbatín' }));
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getPerson('g' as never)?.changedAt ?? null)).toBe(NOW.toISOString());
        expect(await page.evaluate(() => window.Strom.DataManager.getPerson('a' as never)?.changedAt ?? null)).toBeNull();
        await expect.poll(() => sat.evaluate(() => window.Strom.DataManager.getPerson('g' as never)?.changedAt ?? null)).toBe(NOW.toISOString());
        await sat.close();
    });
});
