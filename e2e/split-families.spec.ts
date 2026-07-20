import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * "Split into families" (N4): break one tree into the branch-level families it
 * contains — the core family, then the in-law / ancestral branches that hang off
 * it. The partition is FOCUS-INVARIANT (carved from a reference lineage chosen
 * from the data; the same tree always splits the same way — the focus only
 * orders the list, pre-highlights, and picks the created tree's default person).
 * Each row's head-count is real people + unknowns, and its preview draws the
 * whole family. The original is never touched — the split copies.
 */

function mk(id: string, first: string, last: string, gender: string, birth: string,
    partnerships: string[], parentIds: string[], childIds: string[]) {
    return { id, firstName: first, lastName: last, gender, birthDate: birth,
        isPlaceholder: false, partnerships, parentIds, childIds };
}
function ph(id: string, gender: string, partnerships: string[], parentIds: string[], childIds: string[]) {
    return { id, firstName: '', lastName: '', gender, isPlaceholder: true, partnerships, parentIds, childIds };
}

// A three-generation core plus the wife's parents → a core family and one
// in-law branch. Old (the eldest) anchors the lineage the carve starts from.
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

async function loadTree(page: import('@playwright/test').Page): Promise<void> {
    await openApp(page);
    await page.evaluate(async (data) => {
        await window.Strom.DataManager.importAsNewTree(data, 'Rodina Novákových');
        window.Strom.TreeRenderer.restoreFromSession();
        window.Strom.TreeRenderer.setFocus('me', false);
    }, TREE);
    await expect(card(page, 'Petr')).toHaveClass(/focused/);
}

/** The proposed families as sorted person-id sets (order-independent). */
async function partition(page: import('@playwright/test').Page): Promise<string[]> {
    return await page.evaluate(() => (window.Strom.UI.splitFamiliesComponents as { personIds: string[] }[])
        .map(c => [...c.personIds].sort().join(',')).sort());
}

test('the split is the same whoever the focus is — only the order changes', async ({ page }) => {
    await loadTree(page);

    await page.evaluate(() => { window.Strom.TreeRenderer.setFocus('me', false); window.Strom.UI.showSplitFamiliesDialog(); });
    const fromMe = await partition(page);
    const firstFromMe = await page.evaluate(() => window.Strom.UI.splitFamiliesComponents[0].personIds.includes('me'));
    await page.keyboard.press('Escape');

    await page.evaluate(() => { window.Strom.TreeRenderer.setFocus('wdad', false); window.Strom.UI.showSplitFamiliesDialog(); });
    const fromWdad = await partition(page);
    const firstFromWdad = await page.evaluate(() => window.Strom.UI.splitFamiliesComponents[0].personIds.includes('wdad'));

    // Identical set of families from two very different vantage points…
    expect(fromWdad).toEqual(fromMe);
    // …but each lists the focus person's own family first.
    expect(firstFromMe).toBe(true);
    expect(firstFromWdad).toBe(true);
});

test('lists branch families, the focus family first and badged, with a head-count', async ({ page }) => {
    await loadTree(page);
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    // Core family + the wife's-parents branch (branch granularity, not nuclear).
    const rows = modal.locator('.splitfam-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Selected person');
    await expect(rows.first()).toContainText('8 people');
    // Named from the data (the lineage senior), not after the focus.
    await expect(rows.first().locator('.splitfam-name')).toHaveValue('Old Novák (*1900) family');
});

test('every family row shows a whole-family thumbnail; Preview opens a framed overlay Esc closes first', async ({ page }) => {
    await loadTree(page);
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    const thumbs = modal.locator('.splitfam-thumb');
    const count = await thumbs.count();
    expect(count).toBe(2);
    for (let i = 0; i < count; i++) {
        const nodes = await thumbs.nth(i).locator('.tree-thumb-svg .tree-thumb-card').count();
        expect(nodes, `thumbnail ${i} should have drawn nodes`).toBeGreaterThan(0);
    }

    await modal.locator('.splitfam-preview-btn').first().click();
    await expect(page.locator('.tree-preview-panel')).toBeVisible();
    await expect(page.locator('.tree-preview-card').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.tree-preview-overlay')).toHaveCount(0);
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
});

test('closing with Escape resets fully — reopening starts from scratch, not a stale run', async ({ page }) => {
    await loadTree(page);
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    await expect(page.locator('#split-families-modal')).toBeVisible();

    await page.keyboard.press('Escape');
    const afterEscape = await page.evaluate(() => ({
        domExists: !!document.getElementById('split-families-modal'),
        dataSet: !!window.Strom.UI.splitFamiliesData,
        comps: window.Strom.UI.splitFamiliesComponents.length,
        shown: window.Strom.UI.splitFamiliesShown.length,
    }));
    expect(afterEscape).toEqual({ domExists: false, dataSet: false, comps: 0, shown: 0 });

    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    await expect(page.locator('#split-families-modal')).toHaveCount(1);
    await expect(page.locator('#split-families-modal .splitfam-row')).toHaveCount(2);
});

test('creating the checked families copies them and leaves the original untouched', async ({ page }) => {
    await loadTree(page);
    const before = await page.evaluate(() => window.Strom.DataManager.getAllPersons().length);

    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create 2 trees' })).toBeEnabled();
    await page.getByRole('button', { name: 'Create 2 trees' }).click();
    await expect(modal).toBeHidden();

    const trees = await page.evaluate(() => window.Strom.TreeManager.getTrees()
        .map((t: { name: string; personCount: number }) => [t.name, t.personCount] as [string, number]));
    const names = trees.map(t => t[0]);
    expect(names).toContain('Rodina Novákových');
    expect(names).toContain('Old Novák (*1900) family');
    expect(names).toContain('Karel Svoboda (*1935) family');   // the wife's parents' family, named by its senior
    // The original is untouched: everyone still in it.
    expect(trees.find(t => t[0] === 'Rodina Novákových')?.[1]).toBe(before);
});

test('the count is real people + unknowns, never a big number of empty slots', async ({ page }) => {
    // Adam married an UNKNOWN woman and had unknown children — that placeholder
    // brood folds into a real family and is counted separately, never alone.
    const PH = {
        version: 5,
        defaultPersonId: 'me',
        persons: {
            gpa: mk('gpa', 'Old', 'Novák', 'male', '1900', ['u_g'], [], ['me']),
            gma: mk('gma', 'Stará', 'Nováková', 'female', '1902', ['u_g'], [], ['me']),
            me: mk('me', 'Petr', 'Novák', 'male', '1940', ['u_m'], ['gpa', 'gma'], ['kid']),
            wife: mk('wife', 'Eva', 'Nováková', 'female', '1942', ['u_m'], ['wdad', 'wmom'], ['kid']),
            wdad: mk('wdad', 'Karel', 'Svoboda', 'male', '1915', ['u_w'], [], ['wife']),
            wmom: mk('wmom', 'Anna', 'Svobodová', 'female', '1917', ['u_w'], [], ['wife']),
            kid: mk('kid', 'Adam', 'Novák', 'male', '1970', ['u_k'], ['me', 'wife'], ['gk1', 'gk2']),
            phw: ph('phw', 'female', ['u_k'], [], ['gk1', 'gk2']),
            gk1: ph('gk1', 'male', [], ['kid', 'phw'], []),
            gk2: ph('gk2', 'female', [], ['kid', 'phw'], []),
        },
        partnerships: {
            u_g: { id: 'u_g', person1Id: 'gpa', person2Id: 'gma', childIds: ['me'], status: 'married' },
            u_m: { id: 'u_m', person1Id: 'me', person2Id: 'wife', childIds: ['kid'], status: 'married' },
            u_w: { id: 'u_w', person1Id: 'wdad', person2Id: 'wmom', childIds: ['wife'], status: 'married' },
            u_k: { id: 'u_k', person1Id: 'kid', person2Id: 'phw', childIds: ['gk1', 'gk2'], status: 'married' },
        },
    };
    await openApp(page);
    await page.evaluate(async (data) => {
        await window.Strom.DataManager.importAsNewTree(data, 'Rodina PH');
        window.Strom.TreeRenderer.restoreFromSession();
        window.Strom.TreeRenderer.setFocus('me', false);
    }, PH);
    await expect(card(page, 'Petr')).toHaveClass(/focused/);

    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();
    // Unknowns stated separately; no row is placeholder-only.
    await expect(modal).toContainText('unknown');
    const thumbs = modal.locator('.splitfam-thumb');
    for (let i = 0; i < await thumbs.count(); i++) {
        expect(await thumbs.nth(i).locator('.tree-thumb-card').count()).toBeGreaterThan(0);
    }
});

test('the connector person appears in both created trees and links them', async ({ page }) => {
    // Eva belongs to the core family; her parents form the Svoboda branch. The
    // branch tree gets Eva glued back as the anchor card, so the two created
    // trees share her and the cross-tree badge forms.
    await loadTree(page);
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    // The branch row names its senior and reads its connection from the viewer:
    // Petr reaches the Svoboda parents through his wife Eva.
    const svoboda = modal.locator('.splitfam-row', { has: page.locator('.splitfam-name[value="Karel Svoboda (*1935) family"]') });
    await expect(svoboda.locator('.splitfam-crossref')).toContainText('connected through Eva Nováková (*1962)');

    await page.getByRole('button', { name: 'Create 2 trees' }).click();
    await expect(modal).toBeHidden();

    await page.evaluate(async () => { await window.Strom.TreeRenderer.renderAsync?.(); });
    await expect(page.locator('.cross-tree-badge').first()).toBeVisible({ timeout: 10000 });
});

test('tree manager row: split opens the proposals directly, even for a non-active tree', async ({ page }) => {
    await loadTree(page);
    await page.evaluate(() => window.Strom.DataManager.createNewTree('Jiný strom'));

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const row = page.locator('.tree-manager-item', { hasText: 'Rodina Novákových' });
    await row.locator('.tree-row-menu-btn').click();
    await row.locator('.tree-row-menu-item', { hasText: 'Split into families' }).click();

    // No starting-person picker — the partition never depends on one. The
    // proposals open straight away for the picked (non-active) tree.
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.splitfam-row')).toHaveCount(2);
    await expect(page.locator('#split-fam-picker-modal')).toHaveCount(0);
});
