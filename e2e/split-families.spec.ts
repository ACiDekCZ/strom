import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * "Split into families" (N4): break the whole tree into new trees from the
 * focused person. The first family is the current view; the rest branch off it.
 * The original is left untouched and the families stay linked across the person
 * they share (the cross-tree badge).
 */

// A connected tree three generations deep, plus the wife's parents, so that a
// shallow view around Petr leaves families to discover on both sides.
const TREE = {
    version: 5,
    defaultPersonId: 'me',
    persons: {
        gpa: mk('gpa', 'Old', 'Novák', 'male', '1900', ['u_g'], [], ['dad']),
        gma: mk('gma', 'Stará', 'Nováková', 'female', '1902', ['u_g'], [], ['dad']),
        dad: mk('dad', 'Jan', 'Novák', 'male', '1930', ['u_p'], ['gpa', 'gma'], ['me', 'bro']),
        mom: mk('mom', 'Marie', 'Nováková', 'female', '1932', ['u_p'], [], ['me', 'bro']),
        me: mk('me', 'Petr', 'Novák', 'male', '1960', ['u_m'], ['dad', 'mom'], ['kid']),
        bro: mk('bro', 'Josef', 'Novák', 'male', '1963', [], ['dad', 'mom'], []),
        wife: mk('wife', 'Eva', 'Nováková', 'female', '1962', ['u_m'], ['wdad', 'wmom'], ['kid']),
        kid: mk('kid', 'Adam', 'Novák', 'male', '1990', [], ['me', 'wife'], []),
        wdad: mk('wdad', 'Karel', 'Svoboda', 'male', '1935', ['u_w'], [], ['wife']),
        wmom: mk('wmom', 'Anna', 'Svobodová', 'female', '1937', ['u_w'], [], ['wife']),
    },
    partnerships: {
        u_g: { id: 'u_g', person1Id: 'gpa', person2Id: 'gma', childIds: ['dad'], status: 'married' },
        u_p: { id: 'u_p', person1Id: 'dad', person2Id: 'mom', childIds: ['me', 'bro'], status: 'married' },
        u_m: { id: 'u_m', person1Id: 'me', person2Id: 'wife', childIds: ['kid'], status: 'married' },
        u_w: { id: 'u_w', person1Id: 'wdad', person2Id: 'wmom', childIds: ['wife'], status: 'married' },
    },
};

function mk(id: string, first: string, last: string, gender: string, birth: string,
    partnerships: string[], parentIds: string[], childIds: string[]) {
    return { id, firstName: first, lastName: last, gender, birthDate: birth,
        isPlaceholder: false, partnerships, parentIds, childIds };
}

async function loadShallowView(page: import('@playwright/test').Page): Promise<void> {
    await openApp(page);
    await page.evaluate(async (data) => {
        await window.Strom.DataManager.importAsNewTree(data, 'Rodina Novákových');
        window.Strom.TreeRenderer.restoreFromSession();
        window.Strom.TreeRenderer.setFocus('me', false);
        window.Strom.TreeRenderer.setFocusDepth(1, 1); // only the near family is shown
    }, TREE);
    await expect(card(page, 'Petr')).toHaveClass(/focused/);
    // A shallow view: the grandparents and the wife's parents are off-screen.
    await expect(card(page, 'Old')).toHaveCount(0);
    await expect(card(page, 'Karel')).toHaveCount(0);
}

test('the dialog lists the focus family first, then the families that branch off', async ({ page }) => {
    await loadShallowView(page);
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());

    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    // Three families: Petr's current view + Jan's parents + Eva's parents.
    const rows = modal.locator('.splitfam-row');
    await expect(rows).toHaveCount(3);
    // The first is the current view, badged and named after the focus.
    await expect(rows.first()).toContainText('Your current view');
    await expect(rows.first().locator('.splitfam-name')).toHaveValue('Petr Novák family');
});

test('creating the checked families leaves the original alone and links them', async ({ page }) => {
    await loadShallowView(page);
    const before = await page.evaluate(() => window.Strom.DataManager.getAllPersons().length);

    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    // Uncheck the wife's-parents family; keep the focus family + Jan's parents.
    const checks = modal.locator('.splitfam-check');
    await expect(checks).toHaveCount(3);
    await checks.nth(2).uncheck();
    await expect(page.getByRole('button', { name: 'Create 2 trees' })).toBeEnabled();
    await page.getByRole('button', { name: 'Create 2 trees' }).click();
    await expect(modal).toBeHidden();

    // Two new trees were created next to the original — three in all.
    const trees = await page.evaluate(() => window.Strom.TreeManager.getTrees()
        .map((t: { name: string; personCount: number }) => [t.name, t.personCount] as [string, number]));
    const names = trees.map(t => t[0]);
    expect(names).toContain('Rodina Novákových');
    expect(names).toContain('Petr Novák family');
    expect(names).toContain('Jan Novák family');
    expect(names).not.toContain('Eva Nováková family'); // unchecked → not created
    // The original is untouched: everyone still in it.
    expect(trees.find(t => t[0] === 'Rodina Novákových')?.[1]).toBe(before);

    // Jan's-parents tree opens on the connector (Jan) and holds him as the anchor.
    const janDefault = await page.evaluate(async () => {
        const meta = window.Strom.TreeManager.getTrees().find((t: { name: string }) => t.name === 'Jan Novák family');
        const data = await window.Strom.TreeManager.getTreeData(meta!.id);
        return { def: data!.defaultPersonId, hasJan: !!data!.persons['dad'] };
    });
    expect(janDefault.def).toBe('dad');
    expect(janDefault.hasJan).toBe(true);

    // The shared connector (Jan) now matches across trees → the cross-tree badge.
    await page.evaluate(async () => { await window.Strom.TreeRenderer.renderAsync?.(); });
    await expect(page.locator('.cross-tree-badge').first()).toBeVisible({ timeout: 10000 });
});
