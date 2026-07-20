import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * "Split into families" (N4): break one tree into the families it contains — one
 * nuclear family per couple and their children. The partition is FOCUS-INVARIANT
 * (the same tree always splits the same way; the focus only orders the list),
 * every real person lands in exactly one family, no family is placeholder-only,
 * and each row's head-count matches its preview exactly. The original is never
 * touched — the split copies.
 */

function mk(id: string, first: string, last: string, gender: string, birth: string,
    partnerships: string[], parentIds: string[], childIds: string[]) {
    return { id, firstName: first, lastName: last, gender, birthDate: birth,
        isPlaceholder: false, partnerships, parentIds, childIds };
}
function ph(id: string, gender: string, partnerships: string[], parentIds: string[], childIds: string[]) {
    return { id, firstName: '', lastName: '', gender, isPlaceholder: true, partnerships, parentIds, childIds };
}

// Three generations plus the wife's parents → four nuclear families:
// {Old+Stará}, {Jan+Marie+Josef}, {Petr+Eva+Adam}, {Karel+Anna Svoboda}.
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

test('lists the families the tree contains, the focus person\'s family first', async ({ page }) => {
    await loadTree(page);
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());

    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    // Four nuclear families; the focus (Petr) family is first and badged.
    const rows = modal.locator('.splitfam-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText('Selected person');
    // Named after its senior member, with the birth year (disambiguates namesakes).
    await expect(rows.first().locator('.splitfam-name')).toHaveValue('Petr Novák (*1960) family');

    // The same families appear whoever the focus is — only the order changes.
    const names = await modal.locator('.splitfam-name').evaluateAll(
        els => (els as HTMLInputElement[]).map(e => e.value).sort());
    expect(names).toEqual([
        'Jan Novák (*1930) family', 'Karel Svoboda (*1935) family',
        'Old Novák (*1900) family', 'Petr Novák (*1960) family',
    ]);
});

test('every family row shows a whole-family thumbnail; Preview opens a framed overlay Esc closes first', async ({ page }) => {
    await loadTree(page);
    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    const thumbs = modal.locator('.splitfam-thumb');
    const count = await thumbs.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
        const nodes = await thumbs.nth(i).locator('.tree-thumb-svg .tree-thumb-card').count();
        expect(nodes, `thumbnail ${i} should have drawn nodes`).toBeGreaterThan(0);
    }

    await modal.locator('.splitfam-preview-btn').first().click();
    const panel = page.locator('.tree-preview-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('.tree-preview-card').first()).toBeVisible();

    // Escape closes the preview FIRST — the split dialog underneath stays open.
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
    await expect(page.locator('#split-families-modal .splitfam-row')).toHaveCount(4);
});

test('creating the checked families copies them and leaves the original untouched', async ({ page }) => {
    await loadTree(page);
    const before = await page.evaluate(() => window.Strom.DataManager.getAllPersons().length);

    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    // Keep Petr's and Jan's families; drop the two grandparent families.
    const nameOf = async (i: number): Promise<string> =>
        await modal.locator('.splitfam-name').nth(i).inputValue();
    const checks = modal.locator('.splitfam-check');
    for (let i = 0; i < 4; i++) {
        const n = await nameOf(i);
        if (n.startsWith('Old ') || n.startsWith('Karel ')) await checks.nth(i).uncheck();
    }
    await page.getByRole('button', { name: 'Create 2 trees' }).click();
    await expect(modal).toBeHidden();

    const trees = await page.evaluate(() => window.Strom.TreeManager.getTrees()
        .map((t: { name: string; personCount: number }) => [t.name, t.personCount] as [string, number]));
    const names = trees.map(t => t[0]);
    expect(names).toContain('Rodina Novákových');
    expect(names).toContain('Petr Novák (*1960) family');
    expect(names).toContain('Jan Novák (*1930) family');
    expect(names).not.toContain('Old Novák (*1900) family'); // unchecked → not created
    // The original is untouched: everyone still in it.
    expect(trees.find(t => t[0] === 'Rodina Novákových')?.[1]).toBe(before);
});

// A tree with the shapes the real data exposed: a placeholder brood and a
// second marriage. Kid married an UNKNOWN woman with unknown children; Stará
// remarried Josef.
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

test('the count is real people + unknowns, and the preview draws exactly that set', async ({ page }) => {
    await openApp(page);
    await page.evaluate(async (data) => {
        await window.Strom.DataManager.importAsNewTree(data, 'Rodina 2');
        window.Strom.TreeRenderer.restoreFromSession();
        window.Strom.TreeRenderer.setFocus('me', false);
    }, TREE2);
    await expect(card(page, 'Petr')).toHaveClass(/focused/);

    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();

    // No family is placeholder-only; Adam's family is one real person plus his
    // three unknown relatives, counted separately — never "4 people".
    const adamRow = modal.locator('.splitfam-row', { has: page.locator('.splitfam-name[value="Adam Novák (*2005) family"]') });
    await expect(adamRow.locator('.splitfam-row-meta')).toContainText('1 person + 3 unknown');
    // The preview draws that same set: one real + three placeholder cards = four.
    await adamRow.locator('.splitfam-preview-btn').click();
    await expect(page.locator('.tree-preview-panel')).toBeVisible();
    await expect(page.locator('.tree-preview-card')).toHaveCount(4);
    await page.keyboard.press('Escape');

    // A second marriage is its own family, named after its own spouse (Josef,
    // not the in-law Stará), and says where it connects.
    const josef = modal.locator('.splitfam-row', { has: page.locator('.splitfam-name[value="Josef Dvořák (*1928) family"]') });
    await expect(josef.locator('.splitfam-crossref')).toContainText('connects to Stará Nováková (*1932)');
});

test('two families that share a person (a remarriage) link across trees', async ({ page }) => {
    // Anna married Johann (son Karl), then Fritz as her primary. Anna is owned by
    // Fritz's family; Johann's family keeps Karl and glues Anna back as the
    // mother — so the two created trees share Anna and the cross-tree badge forms.
    const CROSS = {
        version: 5,
        defaultPersonId: 'johann',
        persons: {
            johann: mk('johann', 'Johann', 'Voigt', 'male', '1870', ['u1'], [], ['son']),
            anna: mk('anna', 'Anna', 'Bredlow', 'female', '1875', ['u1', 'u2'], [], ['son']),
            son: mk('son', 'Karl', 'Voigt', 'male', '1905', [], ['johann', 'anna'], []),
            fritz: mk('fritz', 'Fritz', 'Gregorius', 'male', '1872', ['u2'], [], []),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'johann', person2Id: 'anna', childIds: ['son'], status: 'married' },
            u2: { id: 'u2', person1Id: 'fritz', person2Id: 'anna', childIds: [], status: 'married', isPrimary: true },
        },
    };
    await openApp(page);
    await page.evaluate(async (data) => {
        await window.Strom.DataManager.importAsNewTree(data, 'Voigt');
        window.Strom.TreeRenderer.restoreFromSession();
        window.Strom.TreeRenderer.setFocus('johann', false);
    }, CROSS);
    await expect(card(page, 'Johann')).toHaveClass(/focused/);

    await page.evaluate(() => window.Strom.UI.showSplitFamiliesDialog());
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.splitfam-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Create 2 trees' }).click();
    await expect(modal).toBeHidden();

    // Both new trees contain Anna → the cross-tree badge ties them together.
    await page.evaluate(async () => { await window.Strom.TreeRenderer.renderAsync?.(); });
    await expect(page.locator('.cross-tree-badge').first()).toBeVisible({ timeout: 10000 });
});

test('tree manager row: split picks a starting person (prefilled) and splits a non-active tree', async ({ page }) => {
    await loadTree(page);   // imports the Novák tree (active), default person = me
    await page.evaluate(() => window.Strom.DataManager.createNewTree('Jiný strom'));

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const row = page.locator('.tree-manager-item', { hasText: 'Rodina Novákových' });
    await row.locator('.tree-row-menu-btn').click();
    await row.locator('.tree-row-menu-item', { hasText: 'Split into families' }).click();

    const picker = page.locator('#split-fam-picker-modal');
    await expect(picker).toBeVisible();
    await expect(picker.locator('.person-picker-input')).toHaveValue(/Petr Novák/);

    await picker.getByRole('button', { name: 'Continue' }).click();
    const modal = page.locator('#split-families-modal');
    await expect(modal).toBeVisible();
    const rows = modal.locator('.splitfam-row');
    await expect(rows).toHaveCount(4);

    await page.getByRole('button', { name: 'Create 4 trees' }).click();
    await expect(modal).toBeHidden();

    const names = await page.evaluate(() => window.Strom.TreeManager.getTrees()
        .map((t: { name: string }) => t.name));
    expect(names).toContain('Petr Novák (*1960) family');
    expect(names).toContain('Jan Novák (*1930) family');
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
