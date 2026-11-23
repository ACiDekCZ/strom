import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCurrentStep, mergeDone, mergeWrite } from './helpers.js';

/**
 * Step 6 of the import guide, What happened (spec 134 §9, K7.1, K7.3,
 * K8.5): after the write the guide stays open with when it was written,
 * the totals and the actions; Save as a list of people keeps the people the
 * merge added; Done closes it with the toast "{n} added to the tree {t} ·
 * Undo · What happened" and no What next card; Show in the tree closes it
 * and highlights the people added; the toast's Undo takes the write back.
 * On a phone Done stays on the screen. The tree Modřínovi
 * (e2e/fixtures/modrinovi.json) and the file rodokmen-jilmovi.ged
 * (Kvido as in the tree, Amos, Elvíra and Kasián Jilm new) are invented.
 */

const PHONE = { width: 390, height: 844 };
const WRITTEN = new Date(2026, 10, 22, 15, 41);

/** Modřínovi open, rodokmen-jilmovi.ged compared in the guide; the clock fixed at the write's minute. */
async function openGuide(page: Page): Promise<Locator> {
    await page.clock.setFixedTime(WRITTEN);
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    return wizard;
}

/** The open tree's people (first names), placeholders aside. */
const openPeople = (page: Page): Promise<string[]> => page.evaluate(() =>
    Object.values(window.Strom.DataManager.getData().persons).filter((p: any) => !p.isPlaceholder).map((p: any) => p.firstName).sort());

const act = (wizard: Locator, name: string): Locator => wizard.locator(`.merge-s6-act[data-act="${name}"]`);
const toast = (page: Page): Locator => page.locator('.toast.show', { hasText: 'added to the tree Modřínovi' });

test('written into Modřínovi: step 6 says when, the totals and the backup, offers its actions with the list read only; the steps before are closed', async ({ page }) => {
    const wizard = await openGuide(page);
    await mergeWrite(wizard, 'tree');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    await expect(wizard.locator('[data-step-title="6"]')).toHaveText('Written into the tree Modřínovi');
    await expect(wizard.locator('.merge-s6-at')).toHaveText(/^11\/22\/2026 3:41\sPM$/);
    await expect(wizard.locator('.merge-s6-totals')).toHaveText(
        'The totals match: 4 people in the import = 1 joined + 3 new + 0 not added. No broken links. The backup “Before merge” is in Backups.');
    await expect(wizard.locator('.merge-s6-act')).toHaveText(['Show in the tree', 'Save as a list of people', 'Check the tree', 'Undo the merge…']);
    await expect(wizard.locator('.merge-s6-note').first()).toContainText('merge history');
    // Step 5's list read only: no ticks, its search still finds.
    const list = wizard.locator('.merge-s6-list');
    await expect(list.locator('input.merge-s5-cb')).toHaveCount(0);
    await list.locator('.merge-s5-search').fill('kasian');
    await expect(list.locator('.merge-s5-row[data-key^="p:"]')).toHaveText([/Kasián Jilm/]);
    // Written: no step before opens any more.
    await expect(wizard.locator('#merge-progress button.merge-step')).toHaveCount(0);
    await expect(wizard.locator('#merge-next')).toHaveText('Done');

    // Check the tree opens the tree's check above the guide, which stays.
    await act(wizard, 'check').click();
    const check = page.locator('#tree-validation-modal');
    await expect(check).toBeVisible();
    await check.locator('.close-btn').first().click();
    await expect(check).toBeHidden();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
});

test('Save as a list of people: a list of the three people the merge added, the button then done', async ({ page }) => {
    const wizard = await openGuide(page);
    await mergeWrite(wizard, 'tree');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    await act(wizard, 'list').click();
    await expect(act(wizard, 'list')).toBeDisabled();
    const lists = await page.evaluate(() => window.Strom.DataManager.getPersonLists().map((l: any) => ({
        name: l.name as string,
        people: ((l.personIds ?? []) as string[]).map(id => window.Strom.DataManager.getData().persons[id]?.firstName).sort(),
    })));
    const saved = lists.filter(l => l.name.startsWith('From rodokmen-jilmovi'));
    expect(saved).toHaveLength(1);
    expect(saved[0].people).toEqual(['Amos', 'Elvíra', 'Kasián']);
});

test('Done: the guide closes with the toast and no What next card; the toast\'s Undo takes the write back whole', async ({ page }) => {
    const wizard = await openGuide(page);
    const before = await openPeople(page);
    await mergeWrite(wizard, 'tree');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    expect(await openPeople(page)).toEqual(['Amos', 'Elvíra', 'Florentýna', 'Kasián', 'Kvido', 'Teofil']);
    await mergeDone(wizard);

    const t = toast(page);
    await expect(t).toContainText('3 people added to the tree Modřínovi');
    await expect(t.locator('.toast-action')).toHaveText(['Undo', 'What happened']);
    // A merge into a tree that was there: no What next card after it.
    await expect(page.locator('#import-next-card')).toHaveCount(0);

    await t.locator('.toast-action', { hasText: 'Undo' }).click();
    await expect.poll(() => openPeople(page)).toEqual(before);
    expect(await page.evaluate(() => (window.Strom.DataManager.getData().merges ?? []).length)).toBe(0);
});

test('the toast\'s What happened opens step 6 again; Show in the tree closes the guide and highlights the people added', async ({ page }) => {
    const wizard = await openGuide(page);
    await mergeWrite(wizard, 'tree');
    await mergeDone(wizard);
    await toast(page).locator('.toast-action', { hasText: 'What happened' }).click();
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    await expect(wizard.locator('[data-step-title="6"]')).toHaveText('Written into the tree Modřínovi');

    await act(wizard, 'show').click();
    await expect(wizard).toBeHidden();
    await expect(page.locator('#evidence-pill .evidence-pill-label')).toContainText('3 people added to the tree Modřínovi');
    const added = await page.evaluate(() => {
        const ms = window.Strom.DataManager.getData().merges ?? [];
        return ms[ms.length - 1]?.added ?? [];
    });
    expect(added).toHaveLength(3);
    // Next › steps onto the people added: each one's card highlighted, nobody else's.
    await page.locator('#evidence-pill .evidence-pill-next').click();
    const hit = page.locator('.person-card.evidence-hit');
    await expect(hit.first()).toBeVisible();
    const ids = await hit.evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id));
    expect(ids.every(id => added.includes(id)), JSON.stringify(ids)).toBe(true);
});

test('a new tree: step 6 without Undo the merge…; Show in the tree opens the new tree', async ({ page }) => {
    const wizard = await openGuide(page);
    const before: string[] = await page.evaluate(() => window.Strom.TreeManager.getTrees().map((t: { id: string }) => t.id));
    await mergeWrite(wizard, 'new');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    await expect(wizard.locator('[data-step-title="6"]')).toHaveText('Written into the tree Modřínovi + rodokmen-jilmovi');
    await expect(wizard.locator('.merge-s6-act')).toHaveText(['Show in the tree', 'Save as a list of people', 'Check the tree']);
    await act(wizard, 'show').click();
    await expect(wizard).toBeHidden();
    const id = await page.evaluate((before) =>
        window.Strom.TreeManager.getTrees().find((t: { id: string }) => !before.includes(t.id))?.id, before);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).toBe(id);
});

test.describe('a phone held upright', () => {
    test.use({ viewport: PHONE });

    test('step 6: Done stays on the screen, the actions two by two', async ({ page }) => {
        const wizard = await openGuide(page);
        await mergeWrite(wizard, 'tree');
        await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
        await expect(wizard.locator('#merge-next')).toHaveText('Done');
        await expect(wizard.locator('#merge-next')).toBeInViewport();
        const boxes = await wizard.locator('.merge-s6-act').evaluateAll(bs => bs.map(b => {
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top) };
        }));
        expect(new Set(boxes.map(b => b.y)).size, JSON.stringify(boxes)).toBe(2);
        expect(new Set(boxes.map(b => b.x)).size, JSON.stringify(boxes)).toBe(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await mergeDone(wizard);
    });
});
