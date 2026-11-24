import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card, openStructureDialog, runStructure } from './helpers.js';
import { syntheticTree } from '../src/__tests__/helpers/synthetic-tree';

/**
 * Splitting a tree into the families it holds (N3). Only families that nothing
 * connects are offered — splitting a connected tree would mean duplicating
 * whoever joins them.
 */
async function twoUnrelatedFamilies(page: import('@playwright/test').Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novakova', 'female');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    // A second family with no link at all to the first.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const josef = dm.createPerson({ firstName: 'Josef', lastName: 'Svoboda', gender: 'male' });
        const anna = dm.createPerson({ firstName: 'Anna', lastName: 'Svobodova', gender: 'female' });
        dm.createPartnership(josef.id, anna.id);
    });
}

test('a tree with two unrelated families can be split into two trees, the original left alone', async ({ page }) => {
    await openApp(page);
    await twoUnrelatedFamilies(page);

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await runStructure(page, 'split', page.locator('.tree-manager-item-actions').first());
    await expect(page.locator('#split-modal')).toBeVisible();

    // Both families are listed, biggest first, named after their surname.
    const rows = page.locator('.split-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Novak family');
    await expect(rows.first()).toContainText('3 people');
    await expect(rows.nth(1)).toContainText('Svoboda family');

    // Nothing selected yet: there is nothing to do.
    await expect(page.getByRole('button', { name: /Split off 0/ })).toBeDisabled();

    await rows.nth(1).locator('.split-check').check();
    await page.getByRole('button', { name: 'Split off 1' }).click();
    // 8b: the dialog says what was made; Close takes it away.
    await expect(page.locator('#split-modal .busy-prog-done')).toHaveText('1 tree created. The original is untouched.');
    await expect(page.locator('#split-go')).toBeDisabled();
    await page.locator('#split-close', { hasText: 'Close' }).click();
    await expect(page.locator('#split-modal')).toHaveCount(0);

    // The split copies, it does not move: the open tree still shows everyone.
    await expect(card(page, 'Jan')).toBeVisible();
    const trees = await page.evaluate(() => window.Strom.TreeManager.getTrees()
        .map((t: { name: string; personCount: number }) => [t.name, t.personCount]));
    // The new tree holds the Svobodas...
    expect(trees).toContainEqual(['Svoboda family', 2]);
    // ...and the original is untouched, both families still in it.
    expect(trees.find((t: [string, number]) => t[0] === 'My Family Tree')?.[1]).toBe(5);
});

test('a connected tree offers nothing to split', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novakova', 'female');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const structure = await openStructureDialog(page, page.locator('.tree-manager-item-actions').first());
    const parts = structure.locator('.menu-option[data-action="parts"]');

    // One family (spec 139 §2.4): the option is greyed and says why under it; choosing it opens nothing.
    await expect(parts).toHaveAttribute('aria-disabled', 'true');
    await expect(structure.locator('#structure-why-parts')).toHaveText('The whole tree is connected.');
    await expect(parts).toHaveAttribute('aria-describedby', 'structure-why-parts');
    await parts.click({ force: true });
    await expect(page.locator('#split-modal')).toBeHidden();
    await expect(structure).toHaveAttribute('data-step', 'options');
});

test('importing a file with several families offers to split it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });

    // A file holding two families that nothing connects — somebody's whole
    // account exported at once, which is how they usually arrive.
    const file = await page.evaluate(() => {
        const mk = (id: string, first: string, last: string) => ({
            id, firstName: first, lastName: last, gender: 'male',
            isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
        });
        return JSON.stringify({
            version: 5,
            persons: {
                a: { ...mk('a', 'Josef', 'Novak'), partnerships: ['u1'] },
                b: { ...mk('b', 'Marie', 'Novakova'), gender: 'female', partnerships: ['u1'] },
                x: { ...mk('x', 'Karel', 'Svoboda'), partnerships: ['u2'] },
                y: { ...mk('y', 'Anna', 'Svobodova'), gender: 'female', partnerships: ['u2'] },
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: [], status: 'married' },
                u2: { id: 'u2', person1Id: 'x', person2Id: 'y', childIds: [], status: 'married' },
            },
        });
    });

    await page.evaluate((json) => {
        const ui = window.Strom.UI as unknown as { importTreeData: unknown };
        ui.importTreeData = JSON.parse(json);
        window.Strom.UI.showImportTreeDialog(JSON.parse(json), 'Imported');
    }, file);
    await page.getByRole('button', { name: /Import|Create/ }).first().click();

    // The split has been in the tree manager all along; nobody goes looking for
    // a thing they do not know they need. This is the moment they think about it.
    await expect(page.getByText(/families that nothing connects/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Separate disconnected parts…' }).click();
    await expect(page.locator('#split-modal')).toBeVisible();
    await expect(page.locator('.split-row')).toHaveCount(2);
});

test('a tree with one family and a few strays is not offered a split', async ({ page }) => {
    // 222 people plus four unconnected strays is not "five families" — nobody
    // wants a tree holding one person, they want to link them.
    await openApp(page);
    const file = await page.evaluate(() => JSON.stringify({
        version: 5,
        persons: {
            a: { id: 'a', firstName: 'Josef', lastName: 'Novak', gender: 'male', isPlaceholder: false, partnerships: ['u1'], parentIds: [], childIds: [] },
            b: { id: 'b', firstName: 'Marie', lastName: 'Novakova', gender: 'female', isPlaceholder: false, partnerships: ['u1'], parentIds: [], childIds: [] },
            lost: { id: 'lost', firstName: 'Kdo', lastName: 'Vi', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] },
        },
        partnerships: { u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: [], status: 'married' } },
    }));
    await page.evaluate((json) => {
        window.Strom.UI.showImportTreeDialog(JSON.parse(json), 'Imported');
    }, file);
    await page.getByRole('button', { name: /Import|Create/ }).first().click();
    // The import has finished: its dialog is closed and the new tree drawn. The
    // questions after an import are asked in the same turn (no data issue here,
    // so the split offer would be the first one).
    await expect(page.locator('#import-tree-modal')).not.toHaveClass(/active/);
    await expect(card(page, 'Josef')).toBeVisible();
    await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
    await expect(page.getByText(/families that nothing connects/i)).toHaveCount(0);
});

test('Split off works at once: the button says it is creating, a double click creates the tree once', async ({ page }) => {
    await openApp(page);
    await twoUnrelatedFamilies(page);
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await runStructure(page, 'split', page.locator('.tree-manager-item-actions').first());
    const rows = page.locator('.split-row');
    await expect(rows).toHaveCount(2);
    const before = await page.evaluate(() => window.Strom.TreeManager.getTrees().length);
    await rows.nth(1).locator('.split-check').check();
    // Heavy work: its state is seen at once (no 120 ms grace), and the second click does nothing.
    const busy = await page.locator('#split-go').evaluate((b: HTMLButtonElement) => {
        b.click();
        const at = b.getAttribute('aria-busy');
        b.click();
        return at;
    });
    expect(busy).toBe('true');
    await expect(page.locator('#split-modal .busy-prog-done')).toBeVisible();
    await page.locator('#split-close').click();
    await expect(page.locator('#split-modal')).toHaveCount(0);
    const trees = await page.evaluate(() => window.Strom.TreeManager.getTrees().map((t: { name: string }) => t.name));
    expect(trees.length).toBe(before + 1);
    expect(trees.filter((n: string) => n === 'Svoboda family')).toHaveLength(1);
});

test('splitting a tree from its menu finds the parts under the canvas overlay, "Finding the parts…" (B208, waiting buttons §8)', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const { data, rootId } = syntheticTree({ persons: 3200, seed: 5 });
    await page.evaluate(async ({ data, rootId }) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Synthetic');
        S.TreeRenderer.setFocus(rootId);
        await S.TreeRenderer.renderAsync();
    }, { data, rootId });
    await page.evaluate(() => {
        const w = window as unknown as { __said: string[] };
        w.__said = [];
        new MutationObserver(() => {
            const o = document.querySelector('#tree-container > .canvas-busy');
            if (o && !document.getElementById('split-modal')) w.__said.push(o.textContent ?? '');
        }).observe(document.getElementById('tree-container')!, { childList: true, subtree: true, characterData: true });
    });
    await page.evaluate(() => window.Strom.UI.showSplitDialog());
    await expect(page.locator('#split-modal')).toBeVisible({ timeout: 60_000 });
    const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
    expect(said.some(t => t.includes('Finding the parts…'))).toBe(true);
});
