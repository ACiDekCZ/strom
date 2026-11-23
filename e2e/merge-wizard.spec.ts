import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCount, mergeCurrentStep, mergeDecide, mergeGroup, mergePair, mergeRow, mergeSetMode, mergeToStep5, mergeWriteAndSwitch } from './helpers.js';

/**
 * The import guide's frame (spec 134 §1): a GEDCOM file merged into the open
 * tree opens the six steps; the counts come from the plan and add up to the
 * file's people; Esc with decisions asks Discard / Save for later / Continue.
 * The families Modřín (the tree) and Jilm (the file) are invented.
 */
test('a GEDCOM file opens the six-step guide; Esc after the comparison asks with three buttons', async ({ page }) => {
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');

    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const result = page.locator('#merge-modal');
    await expect(result).toBeVisible();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-route')).toContainText('Modřínovi');

    // Six steps, the first one current, none of the others a button yet.
    const steps = wizard.locator('#merge-progress .merge-step');
    await expect(steps).toHaveCount(6);
    await expect(wizard.locator('#merge-progress [aria-current="step"]')).toHaveAttribute('data-step', '1');
    await expect(wizard.locator('#merge-progress button.merge-step')).toHaveCount(0);
    await expect(wizard.locator('#merge-step-body .merge-step-title')).toBeFocused();

    // Before the comparison: Cancel, no Back, the primary compares.
    await expect(wizard.locator('#merge-cancel')).toBeVisible();
    await expect(wizard.locator('#merge-back')).toBeHidden();
    await expect(wizard.locator('#merge-next')).toContainText('Modřínovi');
    await wizard.locator('#merge-next').click();

    // Step 2: step 1 is done (a button), the four counts add up to the file's 4 people.
    await expect(wizard.locator('#merge-progress [aria-current="step"]')).toHaveAttribute('data-step', '2');
    await expect(wizard.locator('#merge-progress button.merge-step[data-step="1"]')).toBeVisible();
    const counts = await wizard.locator('#merge-counts .merge-stat .merge-stat-value').allTextContents();
    expect(counts).toHaveLength(4);
    expect(counts.map(Number).reduce((a, b) => a + b, 0)).toBe(4);
    await mergePair(wizard, 'Kvido');
    await expect(wizard.locator('#merge-back')).toBeVisible();
    await expect(wizard.locator('#merge-save-later')).toBeVisible();

    // A decision, then Esc: the 1b question with its three buttons.
    await mergeDecide(wizard, 'Kasián', 'skip');
    await page.keyboard.press('Escape');
    const ask = page.locator('#merge-close-confirm');
    await expect(ask).toBeVisible();
    await expect(ask.locator('button')).toHaveCount(3);
    await expect(ask.locator('.merge-close-message')).toContainText('1');
});

/** The tree Modřínovi, the file of the Jilms merged into it: the guide on step 1. */
async function openGuide(page: Page): Promise<Locator> {
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const result = page.locator('#merge-modal');
    await expect(result).toBeVisible();
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    return wizard;
}

/** The people (no "?" stand-ins) of the tree named `name`. */
async function peopleOf(page: Page, name: string): Promise<string[]> {
    return page.evaluate(async (name) => {
        const TM = window.Strom.TreeManager;
        const id = TM.getTrees().find((t: { name: string }) => t.name === name)?.id;
        const d = id ? await TM.getTreeData(id) : null;
        return d ? Object.values(d.persons).filter((p: any) => !p.isPlaceholder).map((p: any) => p.firstName).sort() : [];
    }, name);
}

/** Kasián's row, a new person of the file (the group New shown). */
async function kasian(wizard: Locator): Promise<Locator> {
    return mergePair(wizard, 'Kasián', 'new');
}

// (A pair left to decide holding the write: unknown-name-merge.spec.ts and import-extra.spec.ts.)
test('Back keeps the decisions; step 5 writes a new tree named after both and the tree stays as it was', async ({ page }) => {
    const wizard = await openGuide(page);
    await mergeCompare(wizard);

    // Kvido is joined at once; Kasián is not to be added.
    await expect(mergeCount(wizard, 'joined')).toHaveText('1');
    await expect(mergeCount(wizard, 'added')).toHaveText('3');
    await mergeDecide(wizard, 'Kasián', 'skip', 'new');
    await expect(mergeCount(wizard, 'added')).toHaveText('2');
    await expect(mergeCount(wizard, 'skipped')).toHaveText('1');
    await expect(wizard.locator('#merge-next-why')).toBeHidden();
    // On to Whom to add (all new ticked), then past step 4 to What will happen.
    await expect(wizard.locator('#merge-next')).toHaveText('Continue: Whom to add');
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '3');
    await expect(wizard.locator('#merge-step-body .merge-s3-count')).toHaveText('2 of 2 new selected');
    await expect(wizard.locator('#merge-next')).toHaveText('Continue: What will happen');
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '5');
    await expect(wizard.locator('#merge-step-body .merge-step-title')).toHaveText('What will happen');
    await expect(wizard.locator('#merge-step-body')).toContainText('Modřínovi stays unchanged');
    await expect(wizard.locator('#merge-step-body')).toContainText('“Modřínovi + rodokmen-jilmovi”');
    await expect(wizard.locator('#merge-next')).toHaveText('Add 2 people, change 0 details');

    // Back to step 3 and step 2: the decision is still there.
    await wizard.locator('#merge-back').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '3');
    await wizard.locator('#merge-back').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '2');
    await expect(await kasian(wizard)).toHaveAttribute('data-fate', 'skipped');
    // Step 1 again (a done step is a button), and on without a new comparison.
    await wizard.locator('#merge-progress button.merge-step[data-step="1"]').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    await expect(wizard.locator('#merge-next')).toHaveText('Continue: Who is who');
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '2');
    await expect(await kasian(wizard)).toHaveAttribute('data-fate', 'skipped');
    await expect(mergeCount(wizard, 'skipped')).toHaveText('1');

    // The write: no question about the name, a new tree "{tree} + {file}".
    const merged = await mergeWriteAndSwitch(page, wizard);
    expect(merged.name).toBe('Modřínovi + rodokmen-jilmovi');
    expect(await peopleOf(page, merged.name)).toEqual(['Amos', 'Elvíra', 'Florentýna', 'Kvido', 'Teofil']);
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Florentýna', 'Kvido', 'Teofil']);
    expect(await page.evaluate(() => window.Strom.MergerUI.hasPendingMerges())).toBe(false);
});

test('Save for later keeps the decision and the step; the merge goes on from Manage trees', async ({ page }) => {
    const wizard = await openGuide(page);
    await mergeCompare(wizard);
    await mergeDecide(wizard, 'Kasián', 'skip', 'new');
    await expect(mergeCount(wizard, 'skipped')).toHaveText('1');

    await wizard.locator('#merge-save-later').click();
    await expect(wizard).toBeHidden();
    // The toast says where it waits (13j).
    await expect(page.locator('.toast')).toHaveText('Saved for later · rodokmen-jilmovi.ged → Modřínovi · step 2 · in Manage trees under Unfinished merges');
    await expect.poll(() => page.evaluate(async () =>
        (await window.Strom.MergerUI.getPendingMergeInfo()).saved.length)).toBe(1);
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const pending = page.locator('#tree-manager-modal .tree-manager-item.pending-merge');
    await expect(pending).toHaveCount(1);
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Florentýna', 'Kvido', 'Teofil']);

    await pending.locator('.tree-open-btn').click();
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '2');
    await expect(await kasian(wizard)).toHaveAttribute('data-fate', 'skipped');
    await expect(mergeCount(wizard, 'skipped')).toHaveText('1');
});

test('Only compare: the same steps, step 5 says Done and nothing is written', async ({ page }) => {
    const wizard = await openGuide(page);
    const treesBefore = await page.evaluate(() => window.Strom.TreeManager.getTrees().length);
    await mergeSetMode(wizard, 'compare');
    await expect(wizard.locator('#merge-title')).toHaveText('Comparison (nothing is written)');
    await mergeCompare(wizard);
    await mergeToStep5(wizard);
    await expect(wizard.locator('#merge-counts')).toContainText('Nothing has been written yet.');
    await expect(wizard.locator('#merge-next')).toHaveText('Done');
    await wizard.locator('#merge-next').click();
    await expect(wizard).toBeHidden();

    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(treesBefore);
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Florentýna', 'Kvido', 'Teofil']);
});

test('step 2 by keys: ↑ ↓ choose the pair, the letters decide, a letter typed into the search is the search\'s', async ({ page }) => {
    const wizard = await openGuide(page);
    await mergeCompare(wizard);
    // Nothing only offered: The same first, Kvido's pair with its grid and keys.
    await expect(wizard.locator('.merge-tab[data-group="same"]')).toHaveAttribute('aria-selected', 'true');
    await expect(wizard.locator('#merge-pair .pair')).toContainText('Kvido');
    await expect(wizard.locator('#merge-pair .merge-dec .kbd')).toHaveText(['S', 'N', 'A', 'X']);

    // New: the first row chosen; ↓ the next one, X leaves it out (the focus stays on the list).
    await mergeGroup(wizard, 'new');
    const rows = wizard.locator('#merge-match-list .merge-item');
    await expect(rows).toHaveCount(3);
    await rows.first().click();
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(1)).toBeFocused();
    const name = (await rows.nth(1).locator('.merge-item-name .merge-pn').textContent())!;
    await page.keyboard.press('x');
    await expect(mergeRow(wizard, name)).toHaveAttribute('data-fate', 'skipped');
    await expect(mergeCount(wizard, 'skipped')).toHaveText('1');
    // N makes it a new person again.
    await mergePair(wizard, name, 'new');
    await page.keyboard.press('n');
    await expect(mergeRow(wizard, name)).toHaveAttribute('data-fate', 'added');
    await expect(mergeCount(wizard, 'skipped')).toHaveText('0');

    // In the search a letter is typed, nothing is decided.
    const search = wizard.locator('.merge-s2-q');
    await search.fill('');
    await search.pressSequentially('kas');
    await expect(search).toHaveValue('kas');
    await expect(rows).toHaveCount(1);
    await page.keyboard.press('x');
    await expect(search).toHaveValue('kasx');
    await expect(mergeCount(wizard, 'skipped')).toHaveText('0');
});
