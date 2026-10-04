import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, focusViaSearch } from './helpers.js';

/**
 * The tree merge driven end to end through the real UI: tree manager row menu
 * → target picker → merge wizard (filters, decisions, conflict dialogs,
 * manual match) → execute → the merged tree. Plus save-for-later / resume /
 * discard, and the person merge of two persons who both have partnerships.
 *
 * Executing a tree merge never edits the two input trees: it writes a NEW
 * tree and offers to switch to it. The tests check both sides of that.
 */

type P = {
    id: string; firstName: string; lastName: string; gender: 'male' | 'female';
    birthDate?: string; birthPlace?: string; deathDate?: string; deathPlace?: string;
    partnerships?: string[]; parentIds?: string[]; childIds?: string[];
};
type U = { id: string; person1Id: string; person2Id: string; status: string; startDate?: string; startPlace?: string; childIds?: string[] };

function treeData(persons: P[], unions: U[] = []) {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, {
            isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p,
        }])),
        partnerships: Object.fromEntries(unions.map(u => [u.id, { childIds: [], ...u }])),
    };
}

/** Create the two input trees (createTree does not switch the active tree). */
async function seedTrees(
    page: Page,
    target: { name: string; data: ReturnType<typeof treeData> },
    source: { name: string; data: ReturnType<typeof treeData> },
): Promise<{ targetId: string; sourceId: string }> {
    return page.evaluate(([t, s]) => {
        const TM = window.Strom.TreeManager;
        const targetId = TM.createTree(t.name);
        TM.saveTreeData(targetId, t.data);
        const sourceId = TM.createTree(s.name);
        TM.saveTreeData(sourceId, s.data);
        return { targetId, sourceId };
    }, [target, source] as const);
}

/** Tree manager → source row "⋯" → "Merge into..." → pick target → Start: the wizard opens. */
async function startMergeFromManager(page: Page, sourceName: string, targetName: string): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();
    const row = manager.locator('.tree-manager-item:not(.pending-merge)', {
        has: page.locator('.tree-manager-item-name', { hasText: new RegExp(`^${sourceName}$`) }),
    });
    await row.locator('.tree-row-menu-btn').click();
    await row.locator('.tree-row-menu-item', { hasText: 'Merge into' }).click();

    const pick = page.locator('#merge-trees-modal');
    await expect(pick).toBeVisible();
    await pick.locator('.merge-trees-option', { hasText: targetName }).click();
    await expect(pick.locator('.merge-trees-option.selected')).toHaveCount(1);
    await pick.locator('#merge-trees-btn').click();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(pick).toBeHidden();
    return wizard;
}

/** A review row whose names contain `text`. */
function row(wizard: Locator, text: string): Locator {
    return wizard.locator('#merge-match-list .merge-item').filter({ hasText: text });
}

const confirmModal = (page: Page) => page.locator('#confirmation-modal.active');

/**
 * Click "Execute merge", name the new tree, and accept the "switch to the new
 * tree?" offer. Resolves once the merged tree is the active one.
 */
async function executeAndSwitch(page: Page, wizard: Locator, newName: string): Promise<string> {
    await wizard.locator('.merge-actions .primary').click();
    const prompt = page.locator('#confirmation-modal.active.dialog-prompt');
    await expect(prompt).toBeVisible();
    await prompt.locator('#prompt-input').fill(newName);
    await prompt.locator('#confirm-ok-btn').click();

    await expect(wizard).toBeHidden();
    await expect(page.locator('#confirm-title')).toHaveText('Merge complete');
    await expect(confirmModal(page)).toContainText('Switch to the new tree?');
    await confirmModal(page).locator('#confirm-ok-btn').click();
    await expect(confirmModal(page)).toBeHidden();
    await expect(page.locator('#tree-manager-modal')).toBeHidden();

    const newId = await page.evaluate((name) =>
        window.Strom.TreeManager.getTrees().find((t: { name: string }) => t.name === name)?.id, newName);
    expect(newId).toBeTruthy();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).toBe(newId);
    return newId as string;
}

type Person = { id: string; firstName: string; lastName: string; birthPlace?: string; deathDate?: string; deathPlace?: string; partnerships: string[]; parentIds: string[]; childIds: string[]; nameVariants?: string[] };
type Union = { id: string; person1Id: string; person2Id: string; startDate?: string; startPlace?: string; childIds: string[] };

/** The active tree's persons and unions, plus a lookup by first name. */
async function activeData(page: Page) {
    const data = await page.evaluate(() => {
        const d = window.Strom.DataManager.getData();
        return { persons: d.persons, partnerships: d.partnerships };
    }) as { persons: Record<string, Person>; partnerships: Record<string, Union> };
    const persons = Object.values(data.persons);
    const byFirst = (first: string): Person[] => persons.filter(p => p.firstName === first);
    const one = (first: string): Person => {
        const found = byFirst(first);
        expect(found, `exactly one "${first}"`).toHaveLength(1);
        return found[0];
    };
    return { persons, unions: Object.values(data.partnerships), byFirst, one };
}

async function personCountOf(page: Page, treeId: string): Promise<number> {
    return page.evaluate(async (id) => {
        const d = await window.Strom.TreeManager.getTreeData(id);
        // People, not the "?" stand-ins for unknown parents.
        return d ? Object.values(d.persons).filter((p: any) => !p.isPlaceholder).length : -1;
    }, treeId);
}

// ---------------------------------------------------------------------------

test('tree merge runs to completion: filters, confirm, execute — the new tree holds the union, inputs untouched', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    // Jan is in both trees. The target knows his father and birthplace, the
    // source his death date, wife and daughter.
    const { targetId, sourceId } = await seedTrees(page,
        {
            name: 'Novak Target',
            data: treeData([
                { id: 't_karel', firstName: 'Karel', lastName: 'Novak', gender: 'male', birthDate: '1910-01-05', childIds: ['t_jan'] },
                { id: 't_jan', firstName: 'Jan', lastName: 'Novak', gender: 'male', birthDate: '1940-03-12', birthPlace: 'Praha', parentIds: ['t_karel'] },
            ]),
        },
        {
            name: 'Novak Source',
            data: treeData([
                { id: 's_jan', firstName: 'Jan', lastName: 'Novak', gender: 'male', birthDate: '1940-03-12', deathDate: '2010-05-01', partnerships: ['s_u'], childIds: ['s_lucie'] },
                { id: 's_marta', firstName: 'Marta', lastName: 'Svobodova', gender: 'female', birthDate: '1944-08-08', partnerships: ['s_u'], childIds: ['s_lucie'] },
                { id: 's_lucie', firstName: 'Lucie', lastName: 'Novakova', gender: 'female', birthDate: '1972-02-02', parentIds: ['s_jan', 's_marta'] },
            ], [{ id: 's_u', person1Id: 's_jan', person2Id: 's_marta', status: 'married', startDate: '1968-09-01', childIds: ['s_lucie'] }]),
        });
    const treeCountBefore = await page.evaluate(() => window.Strom.TreeManager.getTrees().length);

    const wizard = await startMergeFromManager(page, 'Novak Source', 'Novak Target');
    await expect(wizard.locator('#merge-stat-import')).toHaveText('3');
    await expect(wizard.locator('#merge-stat-existing')).toHaveText('2');
    await expect(wizard.locator('#merge-stat-matches')).toHaveText('1');
    await expect(wizard.locator('#merge-stat-new')).toHaveText('2');

    // "New" filter: only the two persons the target does not know.
    await wizard.locator('.merge-tab[data-filter="unmatched"]').click();
    await expect(wizard.locator('.merge-tab[data-filter="unmatched"]')).toHaveClass(/active/);
    await expect(wizard.locator('#tab-count-unmatched')).toHaveText('2');
    await expect(wizard.locator('#merge-match-list .merge-item')).toHaveCount(2);
    await expect(row(wizard, 'Marta')).toHaveClass(/unmatched/);
    await expect(row(wizard, 'Lucie')).toHaveClass(/unmatched/);
    await expect(row(wizard, 'Jan Novak')).toHaveCount(0);

    // "High" filter: the shared Jan, and nothing else.
    await wizard.locator('.merge-tab[data-filter="high"]').click();
    await expect(wizard.locator('#merge-match-list .merge-item')).toHaveCount(1);
    const janRow = row(wizard, 'Jan Novak');
    await expect(janRow).toContainText('Jan Novak (*1940) ↔ Jan Novak (*1940)');

    // "Conflicts" filter: no field differs on both sides → empty list.
    await wizard.locator('.merge-tab[data-filter="conflicts"]').click();
    await expect(wizard.locator('#merge-match-list .merge-empty')).toBeVisible();

    // Back to "All", confirm the match explicitly.
    await wizard.locator('.merge-tab[data-filter="all"]').click();
    await expect(wizard.locator('#merge-match-list .merge-item')).toHaveCount(3);
    await janRow.locator('.merge-btn-confirm').click();
    await expect(janRow.locator('.merge-btn-confirm')).toHaveClass(/active/);
    await expect(janRow).toHaveClass(/confirmed/);

    const newId = await executeAndSwitch(page, wizard, 'Novak Merged');

    // The merged tree: Jan once, carrying both trees' facts and relations.
    const d = await activeData(page);
    // Four people; Karel came alone as Jan's parent, so beside him a "?" for the other one (one family).
    expect(d.persons.filter((p: any) => !p.isPlaceholder)).toHaveLength(4);
    expect(d.persons.filter((p: any) => p.isPlaceholder)).toHaveLength(1);
    const jan = d.one('Jan');
    const karel = d.one('Karel');
    const marta = d.one('Marta');
    const lucie = d.one('Lucie');
    expect(jan.birthPlace).toBe('Praha');
    expect(jan.deathDate).toBe('2010-05-01');
    expect(jan.parentIds[0]).toBe(karel.id);
    expect(jan.parentIds).toHaveLength(2);
    expect(karel.childIds).toEqual([jan.id]);
    const coupleUnions = d.unions.filter((u: any) => u.person1Id === jan.id || u.person2Id === jan.id);
    expect(coupleUnions).toHaveLength(1);
    const union = coupleUnions[0];
    expect([union.person1Id, union.person2Id].sort()).toEqual([jan.id, marta.id].sort());
    expect(union.startDate).toBe('1968-09-01');
    expect(union.childIds).toEqual([lucie.id]);
    expect(jan.partnerships).toEqual([union.id]);
    expect(marta.partnerships).toEqual([union.id]);
    expect(lucie.parentIds.sort()).toEqual([jan.id, marta.id].sort());

    // The merged tree is persisted, and the two inputs are left as they were.
    expect(await personCountOf(page, newId)).toBe(4);
    expect(await personCountOf(page, targetId)).toBe(2);
    expect(await personCountOf(page, sourceId)).toBe(3);
    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(treeCountBefore + 1);
    // No session lingers once the merge is done.
    expect(await page.evaluate(() => window.Strom.MergerUI.hasPendingMerges())).toBe(false);
});

test('tree merge conflicts: the chosen value wins for a person field and for a union field', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    // Same couple and son in both trees; Petr's birth and death places and the
    // wedding date differ.
    await seedTrees(page,
        {
            name: 'Dvorak Target',
            data: treeData([
                { id: 't_petr', firstName: 'Petr', lastName: 'Dvorak', gender: 'male', birthDate: '1890-02-02', birthPlace: 'Brno', deathPlace: 'Brno', partnerships: ['t_u'], childIds: ['t_karel'] },
                { id: 't_anna', firstName: 'Anna', lastName: 'Dvorakova', gender: 'female', birthDate: '1895-07-07', partnerships: ['t_u'], childIds: ['t_karel'] },
                { id: 't_karel', firstName: 'Karel', lastName: 'Dvorak', gender: 'male', birthDate: '1920-04-04', parentIds: ['t_petr', 't_anna'] },
            ], [{ id: 't_u', person1Id: 't_petr', person2Id: 't_anna', status: 'married', startDate: '1915-06-01', startPlace: 'Brno', childIds: ['t_karel'] }]),
        },
        {
            name: 'Dvorak Source',
            data: treeData([
                { id: 's_petr', firstName: 'Petr', lastName: 'Dvorak', gender: 'male', birthDate: '1890-02-02', birthPlace: 'Olomouc', deathPlace: 'Zlin', partnerships: ['s_u'], childIds: ['s_karel'] },
                { id: 's_anna', firstName: 'Anna', lastName: 'Dvorakova', gender: 'female', birthDate: '1895-07-07', partnerships: ['s_u'], childIds: ['s_karel'] },
                { id: 's_karel', firstName: 'Karel', lastName: 'Dvorak', gender: 'male', birthDate: '1920-04-04', parentIds: ['s_petr', 's_anna'] },
            ], [{ id: 's_u', person1Id: 's_petr', person2Id: 's_anna', status: 'married', startDate: '1916-06-01', childIds: ['s_karel'] }]),
        });

    const wizard = await startMergeFromManager(page, 'Dvorak Source', 'Dvorak Target');
    await expect(wizard.locator('#merge-stat-matches')).toHaveText('3');
    await expect(wizard.locator('#merge-stat-new')).toHaveText('0');
    // One person with conflicts + one union with conflicts.
    await expect(wizard.locator('#merge-stat-conflicts')).toHaveText('2');
    await expect(wizard.locator('#merge-step-resolve')).toBeVisible();

    await wizard.locator('.merge-tab[data-filter="conflicts"]').click();
    await expect(wizard.locator('#tab-count-conflicts')).toHaveText('2');
    await expect(wizard.locator('#merge-match-list .merge-item')).toHaveCount(2);

    // Person conflict: take the imported birthplace, keep the existing death place.
    const petrRow = row(wizard, 'Petr Dvorak (*1890) ↔');
    await expect(petrRow.locator('.merge-item-conflicts')).toContainText('Brno → Olomouc');
    await petrRow.locator('.merge-btn-resolve').click();
    const dialog = page.locator('#merge-conflict-dialog');
    await expect(dialog).toHaveClass(/active/);
    await expect(dialog.locator('.modal-header h2')).toHaveText('Conflicts: Petr Dvorak');
    await expect(dialog.locator('.conflict-row')).toHaveCount(2);
    const birthRow = dialog.locator('.conflict-row[data-field="birthPlace"]');
    const deathRow = dialog.locator('.conflict-row[data-field="deathPlace"]');
    await expect(birthRow.locator('input[value="keep_existing"]')).toBeChecked();
    await birthRow.locator('.conflict-option', { hasText: 'Olomouc' }).click();
    await expect(birthRow.locator('input[value="use_incoming"]')).toBeChecked();
    await expect(deathRow.locator('input[value="keep_existing"]')).toBeChecked();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).not.toHaveClass(/active/);

    // Union conflict: take the imported wedding date.
    const unionRow = wizard.locator('#merge-match-list .merge-item.partnership-conflict');
    await expect(unionRow).toHaveClass(/pending/);
    await expect(unionRow).toContainText('1915-06-01 → 1916-06-01');
    await unionRow.locator('.merge-btn-resolve').click();
    await expect(dialog).toHaveClass(/active/);
    await expect(dialog.locator('.modal-header h2')).toContainText('Petr Dvorak');
    await expect(dialog.locator('.modal-header h2')).toContainText('Anna Dvorakova');
    await expect(dialog.locator('.conflict-row')).toHaveCount(1);
    await dialog.locator('.conflict-row[data-field="startDate"] .conflict-option', { hasText: '1916-06-01' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).not.toHaveClass(/active/);
    await expect(unionRow).toHaveClass(/confirmed/);

    // Re-opening the person dialog shows the saved answers.
    await row(wizard, 'Petr Dvorak (*1890) ↔').locator('.merge-btn-resolve').click();
    await expect(dialog.locator('.conflict-row[data-field="birthPlace"] input[value="use_incoming"]')).toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toHaveClass(/active/);

    await executeAndSwitch(page, wizard, 'Dvorak Merged');

    const d = await activeData(page);
    expect(d.persons).toHaveLength(3);
    const petr = d.one('Petr');
    expect(petr.birthPlace).toBe('Olomouc');   // chosen: imported
    expect(petr.deathPlace).toBe('Brno');      // chosen: existing
    expect(d.unions).toHaveLength(1);
    expect(d.unions[0].startDate).toBe('1916-06-01'); // chosen: imported
    expect(d.unions[0].startPlace).toBe('Brno');      // one-sided value kept
    expect(d.unions[0].childIds).toEqual([d.one('Karel').id]);
});

test('tree merge manual match: an unmatched person is paired by hand and lands on the chosen existing person', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    // Vaclav Kovar (source) is Wenzel Schmidt (target) under another spelling —
    // the auto-matcher cannot know. His son Ota must end up under Wenzel.
    await seedTrees(page,
        {
            name: 'Schmidt Target',
            data: treeData([
                { id: 't_wenzel', firstName: 'Wenzel', lastName: 'Schmidt', gender: 'male', birthDate: '1880-11-11', birthPlace: 'Wien' },
                { id: 't_berta', firstName: 'Berta', lastName: 'Lang', gender: 'female', birthDate: '1950-01-01' },
            ]),
        },
        {
            name: 'Kovar Source',
            data: treeData([
                { id: 's_vaclav', firstName: 'Vaclav', lastName: 'Kovar', gender: 'male', deathDate: '1944-02-02', childIds: ['s_ota'] },
                { id: 's_ota', firstName: 'Ota', lastName: 'Kovar', gender: 'male', birthDate: '1910-10-10', parentIds: ['s_vaclav'] },
            ]),
        });

    const wizard = await startMergeFromManager(page, 'Kovar Source', 'Schmidt Target');
    await expect(wizard.locator('#merge-stat-matches')).toHaveText('0');
    await expect(wizard.locator('#merge-stat-new')).toHaveText('2');

    // Cancel path first: open the dialog for Ota and close it unchanged.
    await row(wizard, 'Ota Kovar').locator('[data-action="manual"]').click();
    const manual = page.locator('#merge-manual-dialog');
    await expect(manual).toHaveClass(/active/);
    await expect(manual.locator('#merge-manual-incoming')).toHaveText('Ota Kovar (*1910)');
    // The list stays shut until asked for: it used to open with the dialog's
    // autofocus and cover Cancel / Save.
    await expect(manual.locator('#merge-manual-picker .person-picker-dropdown')).not.toHaveClass(/active/);
    await manual.locator('.buttons').getByRole('button', { name: 'Cancel' }).click();
    await expect(manual).not.toHaveClass(/active/);
    await expect(wizard.locator('#merge-stat-new')).toHaveText('2');

    await row(wizard, 'Vaclav Kovar').locator('[data-action="manual"]').click();
    await expect(manual).toHaveClass(/active/);
    await expect(manual.locator('#merge-manual-incoming')).toHaveText('Vaclav Kovar');

    // Pick Wenzel, compare the two side by side, then save the match.
    await manual.locator('#merge-manual-picker .person-picker-input').fill('Wenzel');
    await manual.locator('#merge-manual-picker .person-picker-item', { hasText: 'Wenzel' }).first().click();
    await manual.locator('#merge-manual-preview-btn').click();
    const compare = page.locator('.tree-compare-overlay');
    await expect(compare).toBeVisible();
    await expect(compare.locator('.tree-compare-pane[data-pane="left"] .pane-subtitle')).toHaveText('Wenzel Schmidt (*1880)');
    await expect(compare.locator('.tree-compare-pane[data-pane="right"] .pane-subtitle')).toHaveText('Vaclav Kovar');
    await compare.locator('.tree-preview-close').click();
    await expect(compare).toHaveCount(0);
    await expect(manual).toHaveClass(/active/);
    await manual.getByRole('button', { name: 'Save' }).click();
    await expect(manual).not.toHaveClass(/active/);

    // Vaclav is now a (manual, 100 %) match with Wenzel; only Ota stays new.
    const matchRow = row(wizard, 'Wenzel Schmidt (*1880) ↔ Vaclav Kovar');
    await expect(matchRow).toBeVisible();
    await expect(matchRow.locator('.merge-item-score')).toContainText('100 %');
    await expect(wizard.locator('#merge-stat-matches')).toHaveText('1');
    await expect(wizard.locator('#merge-stat-new')).toHaveText('1');

    await executeAndSwitch(page, wizard, 'Schmidt Merged');

    const d = await activeData(page);
    expect(d.persons.filter((p: any) => !p.isPlaceholder)).toHaveLength(3); // Wenzel, Berta, Ota — no separate Vaclav
    expect(d.byFirst('Vaclav')).toHaveLength(0);
    const wenzel = d.one('Wenzel');
    const ota = d.one('Ota');
    expect(wenzel.lastName).toBe('Schmidt');        // name conflict defaults to the existing spelling
    expect(wenzel.birthPlace).toBe('Wien');
    expect(wenzel.deathDate).toBe('1944-02-02');    // filled from the matched source person
    // Ota's known parent is Wenzel (his other parent a "?", as Vaclav came alone).
    expect(ota.parentIds[0]).toBe(wenzel.id);
    expect(wenzel.childIds).toEqual([ota.id]);
});

test('tree merge save for later → resume from the tree manager keeps the decisions → execute', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    const { targetId, sourceId } = await seedTrees(page,
        { name: 'Target', data: treeData([{ id: 't_anna', firstName: 'Anna', lastName: 'Sdilena', gender: 'female', birthDate: '1900-01-01' }]) },
        {
            name: 'Source',
            data: treeData([
                { id: 's_anna', firstName: 'Anna', lastName: 'Sdilena', gender: 'female', birthDate: '1900-01-01', birthPlace: 'Tabor' },
                { id: 's_bob', firstName: 'Bob', lastName: 'Novy', gender: 'male', birthDate: '1930-01-01' },
                { id: 's_cyril', firstName: 'Cyril', lastName: 'Treti', gender: 'male', birthDate: '1931-01-01' },
            ]),
        });

    let wizard = await startMergeFromManager(page, 'Source', 'Target');
    // Decide something worth saving: Bob is skipped.
    await row(wizard, 'Bob Novy').locator('.merge-btn-skip').click();
    await expect(wizard.locator('#merge-stat-skipped')).toHaveText('1');
    await expect(wizard.locator('#merge-stat-new')).toHaveText('1');

    // Save for later: the wizard closes and the tree manager lists the session.
    await wizard.getByRole('button', { name: 'Save for later' }).click();
    await expect(wizard).toBeHidden();
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();
    const pending = manager.locator('.tree-manager-item.pending-merge');
    await expect(pending).toHaveCount(1);
    await expect(pending.locator('.tree-manager-item-name')).toHaveText('Target + Source');
    await expect(pending).toContainText('Source → Target');
    // Nothing was written yet.
    expect(await personCountOf(page, targetId)).toBe(1);

    // Survives a reload.
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await expect(pending).toHaveCount(1);

    // Resume: the decision (Bob skipped) is still there.
    await pending.locator('.tree-open-btn').click();
    wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(manager).toBeHidden();
    await expect(wizard.locator('#merge-stat-skipped')).toHaveText('1');
    await expect(row(wizard, 'Bob Novy')).toHaveClass(/skipped/);
    await expect(wizard.locator('#merge-stat-new')).toHaveText('1');
    // Resuming consumed the saved session.
    await expect.poll(() => page.evaluate(async () =>
        (await window.Strom.MergerUI.getPendingMergeInfo()).saved.length)).toBe(0);

    await executeAndSwitch(page, wizard, 'Target + Source');

    const d = await activeData(page);
    expect(d.persons.map(p => p.firstName).sort()).toEqual(['Anna', 'Cyril']); // Bob skipped
    expect(d.one('Anna').birthPlace).toBe('Tabor');
    expect(await personCountOf(page, targetId)).toBe(1);
    expect(await personCountOf(page, sourceId)).toBe(3);
});

test('tree merge close → save → pending-merge dialog resume, then discard leaves both trees intact', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    const { targetId, sourceId } = await seedTrees(page,
        { name: 'Target', data: treeData([{ id: 't_anna', firstName: 'Anna', lastName: 'Sdilena', gender: 'female', birthDate: '1900-01-01' }]) },
        {
            name: 'Source',
            data: treeData([
                { id: 's_anna', firstName: 'Anna', lastName: 'Sdilena', gender: 'female', birthDate: '1900-01-01' },
                { id: 's_bob', firstName: 'Bob', lastName: 'Novy', gender: 'male', birthDate: '1930-01-01' },
            ]),
        });
    const treeCountBefore = await page.evaluate(() => window.Strom.TreeManager.getTrees().length);

    let wizard = await startMergeFromManager(page, 'Source', 'Target');
    await row(wizard, 'Anna Sdilena (*1900) ↔').locator('.merge-btn-reject').click();
    await expect(row(wizard, 'Anna Sdilena (*1900) ↔')).toHaveClass(/rejected/);

    // Closing with an unsaved decision asks; "Continue merging" keeps the wizard.
    const closeConfirm = page.locator('#merge-close-confirm');
    await wizard.locator('.modal-header .close-btn').click();
    await expect(closeConfirm).toHaveClass(/active/);
    await closeConfirm.getByRole('button', { name: 'Continue merging' }).click();
    await expect(closeConfirm).not.toHaveClass(/active/);
    await expect(wizard).toBeVisible();

    // Close again → "Save for later".
    await wizard.getByRole('button', { name: 'Cancel' }).click();
    await expect(closeConfirm).toHaveClass(/active/);
    await closeConfirm.getByRole('button', { name: 'Save for later' }).click();
    await expect(wizard).toBeHidden();
    await expect(page.locator('#tree-manager-modal .tree-manager-item.pending-merge')).toHaveCount(1);
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog());

    // The pending-merge dialog lists the session; Resume reopens it with the
    // rejection kept. (The app never opens this dialog by itself — see report.)
    await page.evaluate(() => window.Strom.UI.showPendingMergeDialog());
    const pendingDialog = page.locator('#pending-merge-modal');
    await expect(pendingDialog).toHaveClass(/active/);
    const item = pendingDialog.locator('.pending-merge-item');
    await expect(item).toHaveCount(1);
    await expect(item.locator('.pending-merge-name')).toHaveText('Target + Source');
    await expect(item.locator('.pending-merge-meta')).toContainText('1/2');
    await item.locator('.btn-resume').click();
    await expect(pendingDialog).not.toHaveClass(/active/);
    wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(row(wizard, 'Anna Sdilena (*1900) ↔')).toHaveClass(/rejected/);

    // Save it once more, then discard it from the pending-merge dialog.
    await wizard.getByRole('button', { name: 'Save for later' }).click();
    await expect(wizard).toBeHidden();
    await expect.poll(() => page.evaluate(async () =>
        (await window.Strom.MergerUI.getPendingMergeInfo()).saved.length)).toBe(1);
    await page.evaluate(() => window.Strom.UI.showPendingMergeDialog());
    await expect(pendingDialog).toHaveClass(/active/);
    await pendingDialog.locator('.pending-merge-item .btn-discard').click();
    await expect(pendingDialog).not.toHaveClass(/active/);
    expect(await page.evaluate(() => window.Strom.MergerUI.hasPendingMerges())).toBe(false);

    // A second round discarded via the close confirmation: nothing is saved.
    wizard = await startMergeFromManager(page, 'Source', 'Target');
    await row(wizard, 'Bob Novy').locator('.merge-btn-skip').click();
    await page.keyboard.press('Escape');
    await expect(closeConfirm).toHaveClass(/active/);
    await closeConfirm.getByRole('button', { name: 'Discard changes' }).click();
    await expect(wizard).toBeHidden();
    expect(await page.evaluate(() => window.Strom.MergerUI.hasPendingMerges())).toBe(false);

    // A third round discarded from the tree manager (danger confirm).
    wizard = await startMergeFromManager(page, 'Source', 'Target');
    await wizard.getByRole('button', { name: 'Save for later' }).click();
    const pending = page.locator('#tree-manager-modal .tree-manager-item.pending-merge');
    await expect(pending).toHaveCount(1);
    await pending.locator('.pending-merge-discard').click();
    await expect(confirmModal(page)).toHaveClass(/dialog-danger/);
    await confirmModal(page).locator('#confirm-ok-btn').click();
    await expect(pending).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.MergerUI.hasPendingMerges())).toBe(false);

    // Nothing was merged anywhere: both trees as seeded, no extra tree.
    expect(await personCountOf(page, targetId)).toBe(1);
    expect(await personCountOf(page, sourceId)).toBe(2);
    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(treeCountBefore);
});

/**
 * Jan and Honza are the same man, each recorded with Marie (one child each);
 * Honza also has a second wife, Eva. Imports the tree, opens Jan's edit form →
 * Merge, previews, picks Honza, and checks the preview: two field conflicts
 * and ONE partnership conflict (Marie — Eva is not shared). Returns the open
 * person-merge modal.
 */
async function openPersonMergeWithSharedPartner(page: Page): Promise<Locator> {
    await openApp(page);
    const json = {
        version: 11,
        ...treeData([
            { id: 'jan', firstName: 'Jan', lastName: 'Novak', gender: 'male', birthDate: '1900-05-05', birthPlace: 'Brno', partnerships: ['u1'], childIds: ['petr'] },
            { id: 'honza', firstName: 'Honza', lastName: 'Novak', gender: 'male', birthDate: '1900-05-05', birthPlace: 'Praha', partnerships: ['u2', 'u3'], childIds: ['pavel', 'olga'] },
            { id: 'marie', firstName: 'Marie', lastName: 'Novakova', gender: 'female', birthDate: '1902-02-02', partnerships: ['u1', 'u2'], childIds: ['petr', 'pavel'] },
            { id: 'eva', firstName: 'Eva', lastName: 'Druha', gender: 'female', birthDate: '1910-01-01', partnerships: ['u3'], childIds: ['olga'] },
            { id: 'petr', firstName: 'Petr', lastName: 'Novak', gender: 'male', birthDate: '1925-01-01', parentIds: ['jan', 'marie'] },
            { id: 'pavel', firstName: 'Pavel', lastName: 'Novak', gender: 'male', birthDate: '1927-01-01', parentIds: ['honza', 'marie'] },
            { id: 'olga', firstName: 'Olga', lastName: 'Novakova', gender: 'female', birthDate: '1940-01-01', parentIds: ['honza', 'eva'] },
        ], [
            { id: 'u1', person1Id: 'jan', person2Id: 'marie', status: 'married', startDate: '1924-04-04', childIds: ['petr'] },
            { id: 'u2', person1Id: 'honza', person2Id: 'marie', status: 'married', startPlace: 'Kolin', childIds: ['pavel'] },
            { id: 'u3', person1Id: 'honza', person2Id: 'eva', status: 'married', childIds: ['olga'] },
        ]),
    };
    await page.locator('#file-input').setInputFiles({
        name: 'duplicates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)),
    });
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    await focusViaSearch(page, 'Jan');
    await cardAction(page, 'Jan', 'edit');
    await page.locator('#person-modal #btn-merge').click();
    const modal = page.locator('#person-merge-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#person-merge-keep')).toHaveText('Jan Novak (*1900)');

    // Preview with only the kept person picked: a single tree preview.
    await modal.locator('.merge-btn-preview-wide').click();
    const preview = page.locator('.tree-preview-overlay');
    await expect(preview).toBeVisible();
    await preview.locator('.tree-preview-close').click();
    await expect(preview).toHaveCount(0);

    await modal.locator('#person-merge-picker .person-picker-input').fill('Honza');
    await modal.locator('#person-merge-picker .person-picker-item', { hasText: 'Honza' }).first().click();
    await expect(modal.locator('#person-merge-other')).toHaveText('Honza Novak (*1900)');
    await expect(modal.locator('#person-merge-delete-info')).toContainText('"Honza Novak"');

    // Field conflicts: first name and birthplace.
    const fields = modal.locator('#person-merge-conflicts');
    await expect(fields).toBeVisible();
    await expect(fields.locator('.person-merge-conflict-row')).toHaveCount(2);
    // Partnership conflict: both are married to Marie; Eva is not a conflict.
    const unions = modal.locator('#person-merge-partnership-conflicts');
    await expect(unions).toBeVisible();
    await expect(unions.locator('.person-merge-conflict-row')).toHaveCount(1);
    await expect(unions.locator('.person-merge-conflict-row')).toContainText('Marie Novakova');
    await expect(unions.locator('input[value="merge"]')).toBeChecked();
    await expect(modal.locator('#person-merge-no-conflicts')).toBeHidden();

    // Both picked: the preview compares the two side by side.
    await modal.locator('.merge-btn-preview-wide').click();
    const compare = page.locator('.tree-compare-overlay');
    await expect(compare).toBeVisible();
    await expect(compare.locator('.pane-subtitle')).toHaveText(['Jan Novak (*1900)', 'Honza Novak (*1900)']);
    await compare.locator('.tree-preview-close').click();
    await expect(compare).toHaveCount(0);

    // Take Honza's birthplace; keep Jan's first name.
    const birthRow = fields.locator('.person-merge-conflict-row[data-field="birthPlace"]');
    await birthRow.locator('.person-merge-conflict-option[data-value="other"]').click();
    await expect(birthRow.locator('.person-merge-conflict-option[data-value="other"]')).toHaveClass(/selected/);
    return modal;
}

/** Shared checks after merging Honza into Jan: nobody lost, every link points at Jan. */
async function checkPersonMergeResult(page: Page) {
    const d = await activeData(page);
    expect(d.persons).toHaveLength(6);
    expect(d.byFirst('Honza')).toHaveLength(0);
    const jan = d.one('Jan');
    const marie = d.one('Marie');
    const eva = d.one('Eva');
    expect(jan.birthPlace).toBe('Praha');      // chosen: the other person's value
    expect(jan.firstName).toBe('Jan');         // default: keep
    const withMarie = d.unions.filter(u => [u.person1Id, u.person2Id].includes(jan.id) && [u.person1Id, u.person2Id].includes(marie.id));
    // Jan & Eva: Honza's other union moved over intact.
    const withEva = d.unions.filter(u => [u.person1Id, u.person2Id].includes(eva.id));
    expect(withEva).toHaveLength(1);
    expect([withEva[0].person1Id, withEva[0].person2Id]).toContain(jan.id);
    expect(withEva[0].childIds).toEqual([d.one('Olga').id]);
    expect(d.one('Olga').parentIds.sort()).toEqual([jan.id, eva.id].sort());
    expect(d.one('Pavel').parentIds.sort()).toEqual([jan.id, marie.id].sort());
    expect(d.one('Petr').parentIds.sort()).toEqual([jan.id, marie.id].sort());
    expect(jan.childIds.sort()).toEqual([d.one('Olga').id, d.one('Pavel').id, d.one('Petr').id].sort());
    expect(d.unions.every(u => u.person1Id !== 'honza' && u.person2Id !== 'honza')).toBe(true);
    return { d, jan, marie, withMarie, withEva };
}

test('person merge with partnerships on both sides: preview shows the partnership conflict; "keep both" keeps two unions', async ({ page }) => {
    const modal = await openPersonMergeWithSharedPartner(page);
    const unionRow = modal.locator('#person-merge-partnership-list .person-merge-conflict-row');
    await unionRow.locator('.person-merge-conflict-option[data-value="keep_both"]').click();
    await expect(unionRow.locator('.person-merge-conflict-option[data-value="keep_both"]')).toHaveClass(/selected/);
    await modal.locator('#person-merge-btn').click();
    await expect(modal).toBeHidden();
    await expect(page.locator('#person-modal')).toBeHidden();

    const { jan, marie, withMarie, withEva } = await checkPersonMergeResult(page);
    // Keep both: Jan and Marie keep two separate unions, one child each.
    expect(withMarie).toHaveLength(2);
    expect(withMarie.map(u => u.childIds.length)).toEqual([1, 1]);
    expect(marie.partnerships.sort()).toEqual(withMarie.map(u => u.id).sort());
    expect(jan.partnerships.sort()).toEqual([...withMarie, ...withEva].map(u => u.id).sort());
});

// Regression: the dialog keys its partnership answer by the KEPT person's
// union, mergePersons looked it up by the REMOVED one's — the default "Merge"
// silently behaved like "Keep both" and left the couple with two unions.
test('person merge with partnerships on both sides: the default "Merge" answer collapses the shared union into one', async ({ page }) => {
    const modal = await openPersonMergeWithSharedPartner(page);
    await expect(modal.locator('#person-merge-partnership-list input[value="merge"]')).toBeChecked();
    await modal.locator('#person-merge-btn').click();
    await expect(modal).toBeHidden();

    const { d, jan, marie, withMarie, withEva } = await checkPersonMergeResult(page);
    // ONE union for Jan & Marie, carrying both children and both unions' facts.
    expect(withMarie).toHaveLength(1);
    expect(withMarie[0].childIds.sort()).toEqual([d.one('Pavel').id, d.one('Petr').id].sort());
    expect(withMarie[0].startDate).toBe('1924-04-04');
    expect(withMarie[0].startPlace).toBe('Kolin');
    expect(marie.partnerships).toEqual([withMarie[0].id]);
    expect(jan.partnerships.sort()).toEqual([withMarie[0].id, withEva[0].id].sort());
});

// Regression: the wizard's capture-phase Escape handler stopped the key and
// left the comparison overlay to a handler it no longer has, so Escape did
// nothing there.
test('tree merge: Escape closes the side-by-side comparison opened from a review row', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    const anna = { id: 'x', firstName: 'Anna', lastName: 'Sdilena', gender: 'female' as const, birthDate: '1900-01-01' };
    await seedTrees(page,
        { name: 'Target', data: treeData([{ ...anna, id: 't_anna' }]) },
        { name: 'Source', data: treeData([{ ...anna, id: 's_anna' }]) });
    const wizard = await startMergeFromManager(page, 'Source', 'Target');
    await row(wizard, 'Anna Sdilena (*1900) ↔').locator('.merge-btn-preview').click();
    const compare = page.locator('.tree-compare-overlay');
    await expect(compare).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(compare).toHaveCount(0);
    await expect(wizard).toBeVisible();
});

// Regression: the wizard auto-saves the merge in progress (2 s after each
// decision) for crash recovery, but nothing offered it back after a reload —
// the startup check that opens "Pending merges" had no caller.
test('tree merge: a merge auto-saved mid-review is offered again after a reload', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await seedTrees(page,
        { name: 'Target', data: treeData([{ id: 't_anna', firstName: 'Anna', lastName: 'Sdilena', gender: 'female', birthDate: '1900-01-01' }]) },
        {
            name: 'Source',
            data: treeData([
                { id: 's_anna', firstName: 'Anna', lastName: 'Sdilena', gender: 'female', birthDate: '1900-01-01' },
                { id: 's_bob', firstName: 'Bob', lastName: 'Novy', gender: 'male', birthDate: '1930-01-01' },
            ]),
        });
    const wizard = await startMergeFromManager(page, 'Source', 'Target');
    await row(wizard, 'Bob Novy').locator('.merge-btn-skip').click();
    // Wait for the debounced auto-save to land.
    await expect.poll(() => page.evaluate(async () =>
        (await window.Strom.MergerUI.getPendingMergeInfo()).current !== null), { timeout: 10_000 }).toBe(true);

    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    const pendingDialog = page.locator('#pending-merge-modal');
    await expect(pendingDialog).toHaveClass(/active/);
    await pendingDialog.locator('.pending-merge-item[data-session-id="current"] .btn-resume').click();
    await expect(page.locator('#merge-modal')).toBeVisible();
    await expect(row(page.locator('#merge-modal'), 'Bob Novy')).toHaveClass(/skipped/);
});
