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
    // The suggested name carries the birth year, so two same-named people stay
    // apart ("Emil Víšek (*1942)" vs "Emil Víšek (*1905)").
    await expect(rows.first().locator('.splitfam-name')).toHaveValue('Petr Novák (*1960) family');
});

test('every family row shows a non-empty tree thumbnail, and Preview opens a framed overlay Esc closes first', async ({ page }) => {
    await loadShallowView(page);
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());

    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();
    const rows = modal.locator('.splitfam-row');
    await expect(rows).toHaveCount(3);

    // Every row's thumbnail actually draws its mini-tree: one fitted SVG with a
    // node (rect) per person — not an empty box. (The old bug left every row but
    // the first as an empty black box.)
    const thumbs = modal.locator('.splitfam-thumb');
    const count = await thumbs.count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
        const nodes = await thumbs.nth(i).locator('.tree-thumb-svg .tree-thumb-card').count();
        expect(nodes, `thumbnail ${i} should have drawn nodes`).toBeGreaterThan(0);
    }

    // Preview opens inside its OWN framed modal surface (a bordered, rounded
    // panel on its own backdrop), not floating cards over the dimmed dialog.
    await modal.locator('.splitfam-preview-btn').first().click();
    const panel = page.locator('.tree-preview-panel');
    await expect(panel).toBeVisible();
    const frame = await panel.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { radius: parseFloat(cs.borderTopLeftRadius), border: parseFloat(cs.borderTopWidth) };
    });
    expect(frame.radius).toBeGreaterThan(0);
    expect(frame.border).toBeGreaterThan(0);
    await expect(page.locator('.tree-preview-card').first()).toBeVisible();

    // Escape closes the preview FIRST — the split dialog underneath stays open.
    await page.keyboard.press('Escape');
    await expect(page.locator('.tree-preview-overlay')).toHaveCount(0);
    await expect(modal).toBeVisible();
    // A second Escape then closes the dialog itself.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
});

test('closing with Escape resets fully — reopening starts from scratch, not a stale run', async ({ page }) => {
    await loadShallowView(page);
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    await expect(page.locator('#split-families-modal')).toBeVisible();

    // Escape must tear the dialog down completely, not just hide it: the element
    // is removed from the DOM and every field of the run is cleared.
    await page.keyboard.press('Escape');
    const afterEscape = await page.evaluate(() => ({
        domExists: !!document.getElementById('split-families-modal'),
        dataSet: !!window.Strom.UI.splitFamiliesData,
        comps: window.Strom.UI.splitFamiliesComponents.length,
        wysiwyg: window.Strom.UI.splitFamiliesWysiwyg,
    }));
    expect(afterEscape).toEqual({ domExists: false, dataSet: false, comps: 0, wysiwyg: false });

    // Reopening builds one fresh dialog (no leftover ghost element, no doubled rows).
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    await expect(page.locator('#split-families-modal')).toHaveCount(1);
    await expect(page.locator('#split-families-modal .splitfam-row')).toHaveCount(3);
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
    expect(names).toContain('Petr Novák (*1960) family');
    expect(names).toContain('Jan Novák (*1930) family');
    expect(names).not.toContain('Eva Nováková (*1962) family'); // unchecked → not created
    // The original is untouched: everyone still in it.
    expect(trees.find(t => t[0] === 'Rodina Novákových')?.[1]).toBe(before);

    // Jan's-parents tree opens on the connector (Jan) and holds him as the anchor.
    const janDefault = await page.evaluate(async () => {
        const meta = window.Strom.TreeManager.getTrees().find((t: { name: string }) => t.name === 'Jan Novák (*1930) family');
        const data = await window.Strom.TreeManager.getTreeData(meta!.id);
        return { def: data!.defaultPersonId, hasJan: !!data!.persons['dad'] };
    });
    expect(janDefault.def).toBe('dad');
    expect(janDefault.hasJan).toBe(true);

    // The shared connector (Jan) now matches across trees → the cross-tree badge.
    await page.evaluate(async () => { await window.Strom.TreeRenderer.renderAsync?.(); });
    await expect(page.locator('.cross-tree-badge').first()).toBeVisible({ timeout: 10000 });
});

test('tree manager row: split picks a starting person (prefilled) and splits a non-active tree', async ({ page }) => {
    await loadShallowView(page);   // imports the Novák tree (active), default person = me
    // A second tree makes the Novák tree NON-active — the split has no live view.
    await page.evaluate(() => window.Strom.DataManager.createNewTree('Jiný strom'));

    // Open the tree manager and the Novák row's ⋯ menu → "Split into families…".
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const row = page.locator('.tree-manager-item', { hasText: 'Rodina Novákových' });
    await row.locator('.tree-row-menu-btn').click();
    await row.locator('.tree-row-menu-item', { hasText: 'Split into families' }).click();

    // The person picker opens, prefilled with the tree's default person (Petr).
    const picker = page.locator('#split-fam-picker-modal');
    await expect(picker).toBeVisible();
    await expect(picker.locator('.person-picker-input')).toHaveValue(/Petr Novák/);

    // Continue → the components dialog runs against THAT tree at default 3/3.
    await picker.getByRole('button', { name: 'Continue' }).click();
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();
    // No live view here, so no "your current view" badge.
    await expect(modal).not.toContainText('Your current view');
    const rows = modal.locator('.splitfam-row');
    await expect(rows).toHaveCount(2);   // Petr's family + Eva's parents

    await page.getByRole('button', { name: 'Create 2 trees' }).click();
    await expect(modal).toBeHidden();

    const names = await page.evaluate(() => window.Strom.TreeManager.getTrees()
        .map((t: { name: string }) => t.name));
    expect(names).toContain('Petr Novák (*1960) family');
    expect(names).toContain('Eva Nováková (*1962) family');
    expect(names).toContain('Rodina Novákových');   // original untouched

    // The user stays on the tree they had active — the split did not switch it.
    const [active, other] = await page.evaluate(() => {
        const trees = window.Strom.TreeManager.getTrees();
        return [
            window.Strom.TreeManager.getActiveTreeId(),
            trees.find((t: { name: string }) => t.name === 'Jiný strom')?.id,
        ];
    });
    expect(active).toBe(other);
});

// A tree with the two shapes the real data exposed: a second marriage (a
// spouse-branch) and a subtree made only of GEDCOM placeholder slots.
const TREE2 = {
    version: 5,
    defaultPersonId: 'me',
    persons: {
        gma: mk('gma', 'Stará', 'Nováková', 'female', '1932', ['u_g', 'u_g2'], [], ['mom']),
        gpa: mk('gpa', 'Old', 'Novák', 'male', '1930', ['u_g'], [], ['mom']),
        step: mk('step', 'Josef', 'Dvořák', 'male', '1928', ['u_g2'], [], []),
        mom: mk('mom', 'Marie', 'Nováková', 'female', '1955', ['u_p'], ['gpa', 'gma'], ['me']),
        dad: mk('dad', 'Jan', 'Novák', 'male', '1953', ['u_p'], [], ['me']),
        me: mk('me', 'Petr', 'Novák', 'male', '1980', ['u_m'], ['dad', 'mom'], ['kid']),
        wife: mk('wife', 'Eva', 'Nováková', 'female', '1982', ['u_m'], [], ['kid']),
        kid: mk('kid', 'Adam', 'Novák', 'male', '2005', ['u_k'], ['me', 'wife'], ['phk1', 'phk2']),
        phw: ph('phw', 'female', ['u_k'], [], ['phk1', 'phk2']),
        phk1: ph('phk1', 'male', [], ['kid', 'phw'], []),
        phk2: ph('phk2', 'female', [], ['kid', 'phw'], []),
    },
    partnerships: {
        u_g: { id: 'u_g', person1Id: 'gpa', person2Id: 'gma', childIds: ['mom'], status: 'married' },
        u_g2: { id: 'u_g2', person1Id: 'step', person2Id: 'gma', childIds: [], status: 'married' },
        u_p: { id: 'u_p', person1Id: 'dad', person2Id: 'mom', childIds: ['me'], status: 'married' },
        u_m: { id: 'u_m', person1Id: 'me', person2Id: 'wife', childIds: ['kid'], status: 'married' },
        u_k: { id: 'u_k', person1Id: 'kid', person2Id: 'phw', childIds: ['phk1', 'phk2'], status: 'married' },
    },
};
function ph(id: string, gender: string, partnerships: string[], parentIds: string[], childIds: string[]) {
    return { id, firstName: '', lastName: '', gender, isPlaceholder: true, partnerships, parentIds, childIds };
}

test('a placeholder-only subtree is folded away, and a second marriage names its own spouse and cross-references', async ({ page }) => {
    await openApp(page);
    await page.evaluate(async (data) => {
        await window.Strom.DataManager.importAsNewTree(data, 'Rodina 2');
        window.Strom.TreeRenderer.restoreFromSession();
        window.Strom.TreeRenderer.setFocus('me', false);
        window.Strom.TreeRenderer.setFocusDepth(1, 1);
    }, TREE2);
    await expect(card(page, 'Petr')).toHaveClass(/focused/);

    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    // Three real families — the focus view, Marie's parents (gpa+gma), and
    // Stará's second husband. The three placeholder cards (Adam's unknown wife +
    // two children) never form a fourth, empty box; they are folded into the
    // family that owns Adam.
    const rows = modal.locator('.splitfam-row');
    await expect(rows).toHaveCount(3);

    // The second-marriage branch is named after its own real member (Josef),
    // not after the in-law it hangs off (Stará) — with the birth year.
    const names = await modal.locator('.splitfam-name').evaluateAll(
        els => (els as HTMLInputElement[]).map(e => e.value));
    expect(names).toContain('Josef Dvořák (*1928) family');

    // ...and it says where it connects, so it never looks unrelated.
    await expect(modal.locator('.splitfam-crossref')).toContainText('connects to Stará Nováková (*1932)');

    // Coverage still totals every person: the placeholders travel with Adam.
    const accounting = await page.evaluate(() => {
        const comps = window.Strom.UI.splitFamiliesComponents as { personIds: string[] }[];
        const all = comps.flatMap(c => c.personIds);
        const kidComp = comps.find(c => c.personIds.includes('kid'))!;
        return {
            total: all.length,
            distinct: new Set(all).size,
            placeholdersWithKid: ['phw', 'phk1', 'phk2'].every(p => kidComp.personIds.includes(p)),
        };
    });
    expect(accounting.total).toBe(11);
    expect(accounting.distinct).toBe(11);
    expect(accounting.placeholdersWithKid).toBe(true);
});
