import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCurrentStep, mergeDone, mergeWrite, openTreeActions, reloadApp } from './helpers.js';

/**
 * The tree's merges after the write (spec 134 §9, §10): Merge history… in
 * Actions › Tree and in Manage trees (only for a tree with a merge), Open
 * the list from the record after a reload and in a copy exported as JSON,
 * the undo right after the write (the tree as before), with an edit since
 * (Stays because it changed since, Keep preselected), Redo the merge, the
 * state in the history, a locked tree (no undo) and the undo from step 6.
 * The tree Modřínovi (e2e/fixtures/modrinovi.json) and the file
 * rodokmen-jilmovi.ged (Kvido as in the tree, Amos, Elvíra and Kasián Jilm
 * new) are invented.
 */

const PHONE = { width: 390, height: 844 };
/** The clock starts here and runs (a fixed one would hold every toast after the first one waiting for its 3 s). */
const WRITTEN = new Date(2026, 10, 22, 15, 41);

/** Modřínovi open with rodokmen-jilmovi.ged merged into it (step 6 left with Done). Resolves with its tree state before the merge. */
async function mergedTree(page: Page, done = true): Promise<{ before: string; wizard: Locator }> {
    await page.clock.install({ time: WRITTEN });
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    const before = await treeState(page);
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    await mergeWrite(wizard, 'tree');
    if (done) await mergeDone(wizard);
    return { before, wizard };
}

/** The open tree's people and couples as stored, without the merge history (the undo leaves its record). */
const treeState = (page: Page): Promise<string> => page.evaluate(() => {
    const d = window.Strom.DataManager.getData();
    const sort = (o: Record<string, unknown>) => Object.keys(o).sort().map(k => [k, o[k]]);
    return JSON.stringify({ persons: sort(d.persons), partnerships: sort(d.partnerships) });
});

const openPeople = (page: Page): Promise<string[]> => page.evaluate(() =>
    Object.values(window.Strom.DataManager.getData().persons).filter((p: any) => !p.isPlaceholder).map((p: any) => p.firstName).sort());

const history = (page: Page): Locator => page.locator('#merge-history-modal');
const undoDialog = (page: Page): Locator => page.locator('#merge-undo-modal');

/** Merge history… from Actions › Tree. */
async function openHistory(page: Page): Promise<Locator> {
    const sub = await openTreeActions(page);
    await sub.locator('[data-action="mergeHistory"]').click();
    await expect(history(page)).toHaveClass(/active/);
    return history(page);
}

test('Merge history… only for a tree with a merge, in Actions › Tree and in Manage trees; a row says when, the state, the source and what it brought', async ({ page }) => {
    await page.clock.install({ time: WRITTEN });
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    const sub = await openTreeActions(page);
    await expect(sub.locator('[data-action="snapshots"]')).toBeVisible();
    await expect(sub.locator('[data-action="mergeHistory"]')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const wizard = page.locator('#merge-modal');
    await mergeCompare(wizard);
    await mergeWrite(wizard, 'tree');
    await mergeDone(wizard);

    const h = await openHistory(page);
    await expect(h.locator('#merge-history-title')).toHaveText('Merge history · Modřínovi');
    const row = h.locator('.merge-hist-row');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.merge-hist-at')).toHaveText(/^11\/22\/2026 3:41\sPM$/);
    await expect(row.locator('.merge-state-tag')).toHaveText('stands');
    await expect(row.locator('.merge-hist-what')).toContainText('rodokmen-jilmovi.ged');
    await expect(row.locator('.merge-hist-what')).toContainText('3 new · 1 joined');
    await expect(row.locator('button')).toHaveText(['Open the list', 'Undo…']);
    await expect(h.locator('.merge-hist-foot button:visible')).toHaveText(['Backups…', 'Close']);
    await page.keyboard.press('Escape');
    await expect(h).not.toHaveClass(/active/);

    // Manage trees: the tree's ⋯ has it too, Escape comes back to the manager.
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toHaveClass(/active/);
    const item = manager.locator('.tree-manager-item', { hasText: 'Modřínovi' });
    await item.locator('.tree-row-menu-btn').click();
    await item.locator('.tree-row-menu [data-action="mergeHistory"]').click();
    await expect(h).toHaveClass(/active/);
    await expect(manager).not.toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(h).not.toHaveClass(/active/);
    await expect(manager).toHaveClass(/active/);
});

test('Open the list: step 6 read from the record after a reload, and in a copy exported as JSON and imported', async ({ page }, testInfo) => {
    await mergedTree(page);
    await reloadApp(page);
    const h = await openHistory(page);
    await h.locator('.merge-hist-row button[data-act="open"]').click();
    const rec = page.locator('#merge-record-modal');
    await expect(rec).toHaveClass(/active/);
    await expect(h).not.toHaveClass(/active/);
    await expect(rec.locator('#merge-record-title')).toHaveText('Merge of 11/22/2026');
    await expect(rec.locator('[data-step-title="6"]')).toHaveText('Written into the tree Modřínovi');
    await expect(rec.locator('.merge-s6-head .merge-state-tag')).toHaveText('stands');
    await expect(rec.locator('.merge-s6-totals')).toContainText('4 people in the import = 1 joined + 3 new + 0 not added');
    await expect(rec.locator('.merge-s6-act')).toHaveText(['Show in the tree', 'Save as a list of people', 'Check the tree', 'Undo the merge…']);
    const list = rec.locator('.merge-s6-list');
    await expect(list.locator('input.merge-s5-cb')).toHaveCount(0);
    await expect(list.locator('.merge-s5-row[data-key^="p:"]')).toHaveText([/Amos Jilm/, /Elvíra Jilm/, /Kasián Jilm/]);
    await list.locator('.merge-s5-search').fill('kasian');
    await expect(list.locator('.merge-s5-row[data-key^="p:"]')).toHaveText([/Kasián Jilm/]);
    // Escape: back to the history.
    await page.keyboard.press('Escape');
    await expect(rec).not.toHaveClass(/active/);
    await expect(h).toHaveClass(/active/);
    await page.keyboard.press('Escape');

    // The tree exported as JSON and imported as another tree keeps its merge history.
    const download = page.waitForEvent('download');
    await page.evaluate(() => window.Strom.DataManager.exportJSON());
    const file = testInfo.outputPath('modrinovi-export.json');
    await (await download).saveAs(file);
    await importJsonAsNewTree(page, file, 'Modřínovi kopie');
    // The Jilms came without a link to the Modříns: the import says the file holds two families.
    const families = page.locator('#confirmation-modal');
    await expect(families).toContainText('2 families that nothing connects');
    await families.getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getTreeMetadata(window.Strom.TreeManager.getActiveTreeId())?.name)).toBe('Modřínovi kopie');
    const h2 = await openHistory(page);
    await expect(h2.locator('#merge-history-title')).toHaveText('Merge history · Modřínovi kopie');
    await h2.locator('.merge-hist-row button[data-act="open"]').click();
    await expect(rec.locator('.merge-s6-list .merge-s5-row[data-key^="p:"]')).toHaveText([/Amos Jilm/, /Elvíra Jilm/, /Kasián Jilm/]);
});

test('Undo right after the write: the tree as before, the toast Redo the merge brings it back; the history says undone, then stands', async ({ page }) => {
    const { before } = await mergedTree(page);
    expect(await openPeople(page)).toEqual(['Amos', 'Elvíra', 'Florentýna', 'Kasián', 'Kvido', 'Teofil']);
    const h = await openHistory(page);
    await h.locator('.merge-hist-row button[data-act="undo"]').click();
    const u = undoDialog(page);
    await expect(u).toHaveClass(/active/);
    await expect(u.locator('.merge-undo-lead')).toHaveText('Undoes the merge of rodokmen-jilmovi.ged of 11/22/2026. Work done after the merge stays.');
    await expect(u.locator('.merge-undo-grp[data-group="remove"] .merge-undo-gcount')).toHaveText('3');
    await expect(u.locator('.merge-undo-grp[data-group="unjoin"] .merge-undo-gcount')).toHaveText('1');
    await expect(u.locator('.merge-undo-keep')).toHaveCount(0);
    await expect(u.locator('.merge-undo-vs')).toContainText('Unlike restoring the backup');
    await expect(u.locator('[data-act="pick"]')).toHaveText('Choose only some…');
    await u.locator('[data-act="undo"]').click();
    await expect(u).not.toHaveClass(/active/);

    await expect.poll(() => treeState(page)).toBe(before);
    expect(await openPeople(page)).toEqual(['Florentýna', 'Kvido', 'Teofil']);
    await expect(h).toHaveClass(/active/);
    await expect(h.locator('.merge-hist-row .merge-state-tag')).toHaveText('undone');
    await expect(h.locator('.merge-hist-row button[data-act="undo"]')).toHaveCount(0);
    await page.keyboard.press('Escape');

    const toast = page.locator('.toast.show', { hasText: 'Merge undone: 3 people removed, 0 kept' });
    await expect(toast).toBeVisible();
    // The toast of Done ("3 people added…" · Undo · What happened) went with the merge.
    await expect(page.locator('.toast', { hasText: 'added to the tree' })).toHaveCount(0);
    await toast.getByRole('button', { name: 'Redo the merge' }).click();
    await expect.poll(() => openPeople(page)).toEqual(['Amos', 'Elvíra', 'Florentýna', 'Kasián', 'Kvido', 'Teofil']);
    await openHistory(page);
    await expect(h.locator('.merge-hist-row .merge-state-tag')).toHaveText('stands');
});

test('An edit since the merge: Stays because it changed since with Keep chosen; Undo of the segment counts the person; kept, the merge is partly undone', async ({ page }) => {
    await mergedTree(page);
    await page.evaluate(() => {
        const D = window.Strom.DataManager;
        const amos = Object.values(D.getData().persons).find((p: any) => p.firstName === 'Amos') as any;
        D.updatePerson(amos.id, { notes: 'Hajný v Jilmově.' });
    });
    const h = await openHistory(page);
    await h.locator('.merge-hist-row button[data-act="undo"]').click();
    const u = undoDialog(page);
    const keep = u.locator('.merge-undo-keep');
    await expect(keep.locator('.merge-undo-h')).toHaveText(/^Stays because it changed since \(\d+\)$/);
    const amos = keep.locator('.merge-undo-krow', { hasText: 'Amos Jilm' });
    await expect(amos.locator('.merge-undo-kwhy')).toContainText('edited after the merge');
    await expect(amos.locator('[data-v="keep"]')).toHaveAttribute('aria-checked', 'true');
    await expect(amos.locator('[data-v="undo"]')).toHaveAttribute('aria-checked', 'false');
    const primary = u.locator('[data-act="undo"]');
    await expect(primary).toHaveText('Remove 2 people');
    await amos.locator('[data-v="undo"]').click();
    await expect(primary).toHaveText('Remove 3 people');
    await amos.locator('[data-v="keep"]').click();
    await expect(primary).toHaveText('Remove 2 people');
    await primary.click();
    await expect(u).not.toHaveClass(/active/);
    await expect.poll(() => openPeople(page)).toEqual(['Amos', 'Florentýna', 'Kvido', 'Teofil']);
    await expect(page.locator('.toast.show', { hasText: /^Merge undone: 2 people removed, \d+ kept/ })).toBeVisible();
    await expect(h.locator('.merge-hist-row .merge-state-tag')).toHaveText('partly undone');
    // What is left can still be undone: the dialog says what went before.
    await h.locator('.merge-hist-row button[data-act="undo"]').click();
    await expect(u.locator('.merge-undo-partly')).toContainText('2 people already removed');
});

test('A locked tree: the undo says why and offers no removal', async ({ page }) => {
    await mergedTree(page);
    await page.evaluate(() => window.Strom.TreeManager.toggleTreeLock(window.Strom.DataManager.getCurrentTreeId()));
    const h = await openHistory(page);
    await h.locator('.merge-hist-row button[data-act="undo"]').click();
    const u = undoDialog(page);
    await expect(u.locator('.merge-undo-warn[data-why="locked"]')).toHaveText('The tree Modřínovi is locked: undo after unlocking in Manage trees.');
    await expect(u.locator('[data-act="undo"]')).toBeHidden();
    await expect(u.locator('[data-act="pick"]')).toBeHidden();
    await expect(u.locator('.merge-undo-foot button:visible')).toHaveText(['Cancel']);
});

test('Step 6: Undo the merge… opens the undo over the guide, Cancel comes back; the undo closes the guide', async ({ page }) => {
    const { wizard } = await mergedTree(page, false);
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    await wizard.locator('.merge-s6-act[data-act="undo"]').click();
    const u = undoDialog(page);
    await expect(u).toHaveClass(/active/);
    await expect(wizard).toBeHidden();
    await u.locator('[data-dismiss]').click();
    await expect(u).not.toHaveClass(/active/);
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');

    await wizard.locator('.merge-s6-act[data-act="undo"]').click();
    await u.locator('[data-act="undo"]').click();
    await expect(u).not.toHaveClass(/active/);
    await expect(wizard).toBeHidden();
    await expect.poll(() => openPeople(page)).toEqual(['Florentýna', 'Kvido', 'Teofil']);
    await expect(page.locator('.toast.show', { hasText: 'Merge undone: 3 people removed, 0 kept' })).toBeVisible();
});

test.describe('on a phone', () => {
    test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    test('the undo fills the screen, its groups closed, the Keep | Undo segment 44 px high', async ({ page }) => {
        await mergedTree(page);
        await page.evaluate(() => {
            const D = window.Strom.DataManager;
            const amos = Object.values(D.getData().persons).find((p: any) => p.firstName === 'Amos') as any;
            D.updatePerson(amos.id, { notes: 'Hajný v Jilmově.' });
            window.Strom.UI.showUndoMerge(D.getCurrentTreeId(), D.getData().merges[0].id);
        });
        const u = undoDialog(page);
        await expect(u).toHaveClass(/active/);
        const box = await u.locator('.modal').boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(PHONE.width - 1);
        expect(box!.height).toBeGreaterThanOrEqual(PHONE.height - 1);
        await expect(u.locator('.merge-undo-grp[open]')).toHaveCount(0);
        const seg = await u.locator('.merge-undo-krow', { hasText: 'Amos Jilm' }).locator('[data-v="keep"]').boundingBox();
        expect(seg!.height).toBeGreaterThanOrEqual(44);
    });
});

/** Nothing of the page or of the open dialog scrolls sideways. */
async function noSideways(page: Page, dialog: Locator): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const over = await dialog.locator('.modal').evaluate(m => [m, ...m.querySelectorAll('*')]
        .filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible' && getComputedStyle(e).textOverflow !== 'ellipsis')
        .map(e => `${e.tagName}.${(e as HTMLElement).className}`));
    expect(over).toEqual([]);
}

for (const vp of [
    { name: 'a phone held upright', viewport: PHONE },
    { name: 'a tablet', viewport: { width: 1024, height: 768 } },
    { name: 'a phone held sideways', viewport: { width: 844, height: 390 } },
]) {
    test.describe(vp.name, () => {
        test.use({ viewport: vp.viewport });

        test('step 6, the Merge history, a merge\'s list and the undo: the primary button on the screen, nothing scrolls sideways', async ({ page }) => {
            const { wizard } = await mergedTree(page, false);
            await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
            await expect(wizard.locator('#merge-next')).toBeInViewport();
            await noSideways(page, wizard);
            await mergeDone(wizard);

            await page.evaluate(() => window.Strom.UI.showMergeHistory(window.Strom.DataManager.getCurrentTreeId()));
            const h = history(page);
            await expect(h).toHaveClass(/active/);
            await expect(h.locator('.merge-hist-foot [data-dismiss]')).toBeInViewport();
            await noSideways(page, h);

            await h.locator('.merge-hist-row button[data-act="open"]').click();
            const rec = page.locator('#merge-record-modal');
            await expect(rec).toHaveClass(/active/);
            await expect(rec.locator('.merge-hist-foot [data-dismiss]')).toBeInViewport();
            await noSideways(page, rec);
            await rec.locator('.merge-hist-foot [data-dismiss]').click();
            await expect(rec).not.toHaveClass(/active/);

            await expect(h).toHaveClass(/active/);
            await h.locator('.merge-hist-row button[data-act="undo"]').click();
            const u = undoDialog(page);
            await expect(u).toHaveClass(/active/);
            await expect(u.locator('[data-act="undo"]')).toBeInViewport();
            await noSideways(page, u);
        });
    });
}
