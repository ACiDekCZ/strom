import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCount, mergeToStep5, mergeWrite } from './helpers.js';

/**
 * Step 5 of the import guide, What will happen (spec 134 §8): the whole plan
 * by groups, only what is ticked happens (a person unticked goes to Not
 * added "unticked (step 5)", a couple unticked is not written), the button
 * says the result, Save the list… downloads the plan; the write goes into
 * the tree itself (its research link kept, nothing of it lost). Into a new
 * tree: merge-wizard.spec.ts. The families Modřín (the tree) and Jilm (the
 * file) are invented.
 */

const RESEARCH = { id: '0f3c9a52-5b1e-4c55-9a8e-2d4f6b7c8e91', fingerprint: '', syncedAt: '2026-05-04T10:00:00.000Z' };

/** Modřínovi (with a research link when asked) open, rodokmen-jilmovi.ged in the guide, compared. */
async function openGuide(page: Page, research = false): Promise<Locator> {
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    if (research) {
        await page.evaluate((link) => window.Strom.TreeManager.setResearchLink(window.Strom.DataManager.getCurrentTreeId()!, link as never), RESEARCH);
    }
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    return wizard;
}

async function peopleOf(page: Page, name: string): Promise<string[]> {
    return page.evaluate(async (name) => {
        const TM = window.Strom.TreeManager;
        const id = TM.getTrees().find((t: { name: string }) => t.name === name)?.id;
        const d = id ? await TM.getTreeData(id) : null;
        return d ? Object.values(d.persons).filter((p: any) => !p.isPlaceholder).map((p: any) => p.firstName).sort() : [];
    }, name);
}

const row = (wizard: Locator, text: string): Locator => wizard.locator('.merge-s5-row').filter({ hasText: text });
const group = (wizard: Locator, key: string): Locator => wizard.locator(`.merge-s5-gh[data-group="${key}"]`);

test('the list by groups: unticking a person and a couple takes them out of the plan, the counts and the button follow; Save the list… downloads it', async ({ page }) => {
    const wizard = await openGuide(page);
    await mergeToStep5(wizard);
    await expect(wizard.locator('.merge-s5-sub')).toHaveText('only what is ticked');
    // Every group of the plan, Photos and files left out (no photos, 13d); New open, the rest closed.
    expect(await wizard.locator('.merge-s5-gh').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.group)))
        .toEqual(['new', 'joined', 'fields', 'links', 'sources', 'places', 'skipped']);
    await expect(group(wizard, 'new').locator('.merge-s5-gcount')).toHaveText('3');
    await expect(group(wizard, 'new').locator('.merge-s5-gsum')).toHaveText('Jilm 3');
    await expect(row(wizard, 'Kasián')).toBeVisible();
    await expect(row(wizard, 'Kvido')).toHaveCount(0);
    await expect(wizard.locator('#merge-next')).toHaveText('Add 3 people, change 0 details');

    // Kasián unticked: Not added "unticked (step 5)", the counts and the button follow.
    await row(wizard, 'Kasián').locator('input.merge-s5-cb').click();
    await expect(mergeCount(wizard, 'added')).toHaveText('2');
    await expect(mergeCount(wizard, 'skipped')).toHaveText('1');
    await expect(wizard.locator('#merge-next')).toHaveText('Add 2 people, change 0 details');
    await expect(group(wizard, 'skipped').locator('.merge-s5-gsum')).toHaveText('unticked (step 5) 1');
    await wizard.locator('[data-toggle="skipped"]').click();
    const out = row(wizard, 'Kasián');
    await expect(out).toContainText('unticked (step 5)');
    // Ticked again from Not added: back in the plan.
    await out.locator('input.merge-s5-cb').click();
    await expect(mergeCount(wizard, 'added')).toHaveText('3');
    await expect(wizard.locator('#merge-next')).toHaveText('Add 3 people, change 0 details');

    // The couple unticked: not written, the group says so.
    await wizard.locator('[data-toggle="links"]').click();
    await expect(group(wizard, 'links').locator('.merge-s5-gsum')).toHaveText('1 new couple, 2 new links');
    await row(wizard, 'Amos Jilm & Elvíra Jilmová').locator('input.merge-s5-cb').click();
    await expect(group(wizard, 'links').locator('.merge-s5-gsum')).toHaveText('0 new couples, 2 new links');
    await expect(row(wizard, 'Amos Jilm & Elvíra Jilmová').locator('input.merge-s5-cb')).not.toBeChecked();

    // The search opens the groups with what matches.
    await wizard.locator('.merge-s5-search').fill('kasian');
    await expect(wizard.locator('.merge-s5-row[data-key^="p:"]')).toHaveText([/Kasián Jilm/]);
    await expect(row(wizard, 'Amos Jilm & Elvíra Jilmová')).toHaveCount(0);
    await wizard.locator('.merge-s5-search').fill('');

    // Save the list…: the plan as .txt and .json; the guide stays open.
    const files: string[] = [];
    page.on('download', d => files.push(d.suggestedFilename()));
    await wizard.locator('.merge-s5-save').click();
    await expect.poll(() => files.sort()).toEqual(['rodokmen-jilmovi-plan.json', 'rodokmen-jilmovi-plan.txt']);
    await expect(wizard).toBeVisible();
});

test('Write into Modřínovi: the open tree gets the new people at once, its research link stays, nothing of it is lost', async ({ page }) => {
    const wizard = await openGuide(page, true);
    const trees = await page.evaluate(() => window.Strom.TreeManager.getTrees().length);
    await mergeToStep5(wizard);
    await expect(wizard.locator('.merge-s5-into [data-into="tree"]')).toHaveText('Write into Modřínovi');
    await expect(wizard.locator('.merge-s5-backup')).toContainText('Before merge');
    await expect(wizard.locator('.merge-s5-research')).toBeVisible();
    await mergeWrite(wizard, 'tree');
    await expect(wizard).toBeHidden();
    await expect(page.locator('#confirm-title')).toHaveText('Merge complete');
    await expect(page.locator('#confirm-message')).toContainText('Written into the tree Modřínovi.');
    await page.locator('#confirmation-modal.active #confirm-ok-btn').click();

    // No new tree; Modřínovi itself has the import's people, its own all kept.
    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(trees);
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Amos', 'Elvíra', 'Florentýna', 'Kasián', 'Kvido', 'Teofil']);
    const open = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons).map((p: any) => p.firstName).sort());
    expect(open).toEqual(['Amos', 'Elvíra', 'Florentýna', 'Kasián', 'Kvido', 'Teofil']);
    expect(await page.evaluate(() => {
        const TM = window.Strom.TreeManager;
        return TM.getTreeMetadata(TM.getActiveTreeId())?.research?.id;
    })).toBe(RESEARCH.id);
    // The write is one step of Undo.
    expect(await page.evaluate(() => window.Strom.DataManager.canUndo())).toBe(true);
});

test('8d: the backup "Before merge" fails, so nothing is written; its state says why and what can be done, Try again writes', async ({ page }) => {
    const wizard = await openGuide(page);
    await mergeToStep5(wizard);
    // The browser's storage refuses the backup (a full disk).
    await page.evaluate(() => {
        const w = window as unknown as { __put?: typeof IDBObjectStore.prototype.put };
        w.__put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
            if (this.name === 'snapshots') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            return w.__put!.apply(this, args);
        };
    });
    await mergeWrite(wizard, 'tree');
    const status = wizard.locator('.merge-s5-status');
    await expect(status).toHaveAttribute('data-state', 'backupFailed');
    await expect(status.locator('.merge-s5-st-err')).toContainText('The backup failed, so nothing was written.');
    await expect(status.locator('.merge-s5-act')).toHaveText(['Free up space: Backups…', 'Save the tree Modřínovi to a file…', 'Try again']);
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-next')).toBeEnabled();
    // Nothing of the import in the tree.
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Florentýna', 'Kvido', 'Teofil']);

    // Room again: Try again writes.
    await page.evaluate(() => {
        const w = window as unknown as { __put?: typeof IDBObjectStore.prototype.put };
        IDBObjectStore.prototype.put = w.__put!;
    });
    await status.locator('[data-act="retry"]').click();
    await expect(wizard).toBeHidden();
    await expect(page.locator('#confirm-title')).toHaveText('Merge complete');
    await page.locator('#confirmation-modal.active #confirm-ok-btn').click();
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Amos', 'Elvíra', 'Florentýna', 'Kasián', 'Kvido', 'Teofil']);
});

test('8c: the tree changed since the comparison: nothing is written blindly, the list is recalculated and the next press writes', async ({ page }) => {
    const wizard = await openGuide(page);
    await mergeToStep5(wizard);
    // Another window adds a person to Modřínovi meanwhile.
    await page.evaluate(() => { window.Strom.DataManager.createPerson({ firstName: 'Lukrecie', lastName: 'Modřínová', gender: 'female' }); });
    await mergeWrite(wizard, 'tree');
    const status = wizard.locator('.merge-s5-status');
    await expect(status).toHaveAttribute('data-state', 'changed');
    await expect(status).toContainText(/The tree Modřínovi has changed meanwhile \(.+\): 1 new person\. The list has been recalculated\. Nothing was written blindly\./);
    await expect(wizard).toBeVisible();
    await expect.poll(() => peopleOf(page, 'Modřínovi')).toEqual(['Florentýna', 'Kvido', 'Lukrecie', 'Teofil']);
    await expect(wizard.locator('#merge-next')).toHaveText('Add 3 people, change 0 details');

    // Written over the tree as it is now: its new person kept.
    await wizard.locator('#merge-next').click();
    await expect(wizard).toBeHidden();
    await page.locator('#confirmation-modal.active #confirm-ok-btn').click();
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Amos', 'Elvíra', 'Florentýna', 'Kasián', 'Kvido', 'Lukrecie', 'Teofil']);
});
