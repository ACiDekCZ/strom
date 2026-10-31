/**
 * "Edit family line…" (package 1031 §2): opened from the tree overview's
 * lineage detail and from the person card's ⋯ menu; every action is chosen
 * first, then "What will change" says what it does and nothing is stored
 * before the action's button; Undo and the change history follow each
 * change; a followed or locked tree keeps the controls disabled with a hint.
 * Invented names only (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers';
import { rodsTree, RodsTree } from './rods-fixture';

/**
 * The Brandvold tree. `forms`: Lisa Brandvold's son Ragnar (no father
 * recorded) and his son Tore write "Brandwold", joined to the line only by
 * the group of spellings. `relation`: the last five Brandvolds write
 * "Brandwold", joined by their parents instead.
 */
function tree(opts: { forms?: boolean; relation?: boolean } = {}): RodsTree & { surnameVariants?: string[][] } {
    const t: RodsTree & { surnameVariants?: string[][] } = rodsTree();
    if (opts.forms) {
        const add = (id: string, firstName: string, birthDate: string, parent: string): void => {
            t.persons[id] = {
                id, firstName, lastName: 'Brandwold', gender: 'male', isPlaceholder: false, birthDate, birthPlace: 'Ekeby',
                partnerships: [], parentIds: [parent], childIds: [],
            };
            (t.persons[parent].childIds as string[]).push(id);
        };
        add('w1', 'Ragnar', '1790', 'b7');
        add('w2', 'Tore', '1815', 'w1');
    }
    if (opts.relation) {
        for (const id of ['b12', 'b13', 'b14', 'b15', 'b16']) t.persons[id].lastName = 'Brandwold';
    }
    if (opts.forms || opts.relation) t.surnameVariants = [['Brandvold', 'Brandwold']];
    return t;
}

async function setup(page: Page, opts: { forms?: boolean; relation?: boolean; history?: boolean } = {}): Promise<string> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    if (opts.history) await enableHistoryInSettings(page);
    return page.evaluate(async (data) => {
        const S = window.Strom;
        const id = await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(data.defaultPersonId);
        await S.TreeRenderer.renderAsync();
        return id as string;
    }, tree(opts));
}

/** Turn the change history on through the Settings checkbox. */
async function enableHistoryInSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await settings.locator('#audit-log-toggle').check();
    await expect(settings.locator('#audit-log-status')).toHaveText('Change history enabled');
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
}

const rods = (page: Page): Locator => page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
const dialog = (page: Page): Locator => page.locator('#lineage-edit-modal');
const sec = (page: Page, name: 'founder' | 'forms' | 'split'): Locator => dialog(page).locator(`.le-sec[data-sec="${name}"]`);
const preview = (page: Page): Locator => dialog(page).locator('.le-preview');
const overrides = (page: Page): Promise<unknown> => page.evaluate(() => window.Strom.DataManager.getData().lineageOverrides ?? null);
const variants = (page: Page): Promise<unknown> => page.evaluate(() => window.Strom.DataManager.getData().surnameVariants ?? null);

/** The overview at "Family lines" with the first lineage (Brandvold) expanded. */
async function openBrandvoldDetail(page: Page, treeId: string): Promise<Locator> {
    await page.evaluate((id) => window.Strom.UI.showTreeOverview(id, { section: 'rods' }), treeId);
    await expect(rods(page)).toHaveAttribute('data-ready', 'true');
    await rods(page).locator('.tov-rod-row').first().click();
    const open = rods(page).locator('.tov-rod.is-open');
    await expect(open.locator('.tov-rod-label')).toHaveText('Brandvold');
    return open;
}

/** The edit dialog of the Brandvold line, from the overview's detail. */
async function openFromOverview(page: Page, treeId: string): Promise<void> {
    const open = await openBrandvoldDetail(page, treeId);
    await open.getByRole('button', { name: 'Edit family line…' }).click();
    await expect(dialog(page)).toHaveClass(/active/);
    await expect(dialog(page).locator('#lineage-edit-title')).toHaveText('Edit Brandvold family line');
}

test.describe('edit family line', () => {
    test('change the founder: preview, nothing stored before Apply, the overview follows, Undo restores @smoke', async ({ page }) => {
        const treeId = await setup(page);
        await openFromOverview(page, treeId);
        await expect(dialog(page).locator('#lineage-edit-sub')).toHaveText('1702–1999 · 16 members · 8 married in · 9 generations');
        const founder = sec(page, 'founder');
        await expect(founder.locator('.le-founder')).toHaveText('Arvid Brandvold (c. 1702, Ekeby) · set automatically');

        await founder.getByRole('button', { name: 'Change…' }).click();
        // The members by generation; the founder greyed "now"; the search filters them.
        const search = founder.locator('.le-search');
        await expect(search).toBeFocused();
        await expect(founder.locator('[data-le="pick"][data-id="b1"]')).toBeDisabled();
        await expect(founder.locator('[data-le="pick"][data-id="b1"]')).toContainText('· now');
        await search.fill('nils');
        await expect(founder.locator('[data-le="pick"]')).toHaveCount(1);
        await founder.locator('[data-le="pick"][data-id="b2"]').click();
        await expect(founder.locator('[data-le="pick"][data-id="b2"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(preview(page).locator('.le-preview-title')).toHaveText('What will change');
        await expect(preview(page).locator('p')).toHaveText([
            'The line will begin with Nils Brandvold (1735): 13 members, 7 married in.',
            'Arvid Brandvold, Per Brandvold and Karin Brandvold (3 people) will move to Other families.',
            'The book of the whole tree keeps every person.',
        ]);
        // Chosen and previewed: nothing is stored yet.
        expect(await overrides(page)).toBeNull();
        await expect(rods(page).locator('.tov-rod.is-open [data-fact="founder"]')).toContainText('Arvid Brandvold');

        await dialog(page).locator('[data-le="apply"]').click();
        // The dialog stays with the new state.
        await expect(founder.locator('.le-founder-name')).toHaveText('Nils Brandvold (1735, Ekeby)');
        await expect(founder.locator('.le-chip')).toHaveText('set manually');
        await expect(founder.getByRole('button', { name: 'Restore automatic' })).toBeVisible();
        await expect(preview(page)).toHaveCount(0);
        expect(await overrides(page)).toEqual({ notCarriers: ['b1'] });
        await expect(page.locator('.toast[data-kind="lineage-edit"]')).toContainText('Family line Brandvold begins with Nils Brandvold.');
        // The overview behind follows the lineage (a new founder, a new id).
        const detail = rods(page).locator('.tov-rod.is-open');
        await expect(detail.locator('[data-fact="founder"]')).toContainText('Nils Brandvold (1735, Ekeby)');
        await expect(detail.locator('.tov-rod-manual')).toHaveText('set manually');

        // Undo (riding in the toast over the dialog) restores the computed line.
        await page.locator('.undo-toast-btn').click();
        await expect(founder.locator('.le-founder')).toHaveText('Arvid Brandvold (c. 1702, Ekeby) · set automatically');
        expect(await overrides(page)).toBeNull();
        await expect(rods(page).locator('.tov-rod.is-open [data-fact="founder"]')).toContainText('Arvid Brandvold (c. 1702, Ekeby) · set automatically');

        // Escape: a choice first, then the dialog (the overview stays).
        await founder.getByRole('button', { name: 'Change…' }).click();
        await page.keyboard.press('Escape');
        await expect(founder.locator('.le-panel')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).not.toHaveClass(/active/);
        await expect(page.locator('#tree-overview-modal')).toBeVisible();
    });

    test('Czech: the dialog, its preview and the manual founder in the overview', async ({ page }) => {
        const treeId = await setup(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('cs'));
        const open = await openBrandvoldDetail(page, treeId);
        await open.getByRole('button', { name: 'Upravit rod…' }).click();
        await expect(dialog(page).locator('#lineage-edit-title')).toHaveText('Upravit rod Brandvold');
        const founder = sec(page, 'founder');
        await expect(founder.locator('.le-founder')).toHaveText('Arvid Brandvold (asi 1702, Ekeby) · určeno automaticky');
        await founder.getByRole('button', { name: 'Změnit…' }).click();
        await founder.locator('[data-le="pick"][data-id="b2"]').click();
        await expect(preview(page).locator('.le-preview-title')).toHaveText('Co se stane');
        await expect(preview(page).locator('p').first()).toHaveText('Rod bude začínat osobou Nils Brandvold (1735): 13 členů, 7 přivdaných.');
        await dialog(page).locator('[data-le="apply"]', { hasText: 'Použít' }).click();
        await expect(founder.locator('.le-chip')).toHaveText('určeno ručně');
        await expect(rods(page).locator('.tov-rod.is-open .tov-rod-manual')).toHaveText('určeno ručně');
        await expect(dialog(page).locator('.le-undo-note')).toHaveText('Každou změnu jde vrátit (Zpět, Historie změn).');
    });

    test('restore automatic: from the overview, with its preview', async ({ page }) => {
        const treeId = await setup(page);
        await openFromOverview(page, treeId);
        const founder = sec(page, 'founder');
        await founder.getByRole('button', { name: 'Change…' }).click();
        await founder.locator('[data-le="pick"][data-id="b2"]').click();
        await dialog(page).locator('[data-le="apply"]').click();
        await expect(founder.locator('.le-chip')).toHaveText('set manually');
        await dialog(page).locator('.buttons').getByRole('button', { name: 'Close' }).click();
        await expect(dialog(page)).not.toHaveClass(/active/);

        // The overview's "Restore automatic" opens the dialog at the preview.
        await rods(page).locator('.tov-rod.is-open').getByRole('button', { name: 'Restore automatic' }).click();
        await expect(dialog(page)).toHaveClass(/active/);
        await expect(dialog(page).locator('.le-panel[data-panel="revert"]')).toBeVisible();
        await expect(preview(page).locator('p')).toHaveText([
            'The Brandvold line will be as computed again: 16 members, 8 married in.',
            'The book of the whole tree keeps every person.',
        ]);
        expect(await overrides(page)).toEqual({ notCarriers: ['b1'] });
        // Cancel keeps the manual founder; the dialog's own link opens the preview again.
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(preview(page)).toHaveCount(0);
        await founder.getByRole('button', { name: 'Restore automatic' }).click();
        await dialog(page).locator('[data-le="apply"]', { hasText: 'Restore' }).click();
        await expect(founder.locator('.le-founder')).toHaveText('Arvid Brandvold (c. 1702, Ekeby) · set automatically');
        expect(await overrides(page)).toBeNull();
        await expect(rods(page).locator('.tov-rod.is-open .tov-rod-manual')).toHaveCount(0);
    });

    test('start a line from a person: in the dialog and from the person card ⋯ menu', async ({ page }) => {
        const treeId = await setup(page);
        await openFromOverview(page, treeId);
        const split = sec(page, 'split');
        await expect(split.locator('.le-hint')).toHaveText('A branch that should be its own line (e.g. a son who moved away).');
        await split.getByRole('button', { name: 'Start a line from a person…' }).click();
        // The founder is not offered.
        await expect(split.locator('[data-le="pick"][data-id="b1"]')).toHaveCount(0);
        await split.locator('.le-search').fill('Nils');
        await split.locator('.le-search').press('Enter');
        await expect(split.locator('[data-le="pick"][data-id="b2"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(preview(page).locator('p')).toHaveText([
            'A new family line Brandvold will begin with Nils Brandvold (1735): 13 members, 7 married in.',
            /^Nils Brandvold and his descendants will move to the new line\. In the parents’ family he stays as a son with a link to the new line\. The Brandvold \(1702\) line will have 3 members and 1 married in\.$/,
        ]);
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(preview(page)).toHaveCount(0);
        expect(await overrides(page)).toBeNull();
        await page.keyboard.press('Escape');
        await expect(dialog(page)).not.toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);

        // The person card: ⋯ → Start a family line from this person… → the dialog with Olof chosen.
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('b5' as never));
        const row = page.locator('#pm-rod');
        await row.locator('.pm-rod-more-btn').click();
        await row.locator('.pm-rod-menu').getByRole('menuitem', { name: 'Start a family line from this person…' }).click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        await expect(dialog(page)).toHaveClass(/active/);
        await expect(dialog(page).locator('#lineage-edit-title')).toHaveText('Edit Brandvold family line');
        await expect(sec(page, 'split').locator('[data-le="pick"][data-id="b5"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(preview(page).locator('p').first()).toHaveText(/^A new family line Brandvold \(\d{4}\) will begin with Olof Brandvold \(1765\): \d+ members?/);
        const start = dialog(page).locator('[data-le="apply"]');
        await expect(start).toHaveText('Start the line');
        await expect(start).toBeFocused();
        expect(await overrides(page)).toBeNull();
        await start.click();
        expect(await overrides(page)).toEqual({ founders: ['b5'] });
        await expect(page.locator('.toast[data-kind="lineage-edit"]')).toContainText('started from Olof Brandvold');
        // The dialog stays on the line it showed, now without Olof's branch.
        await expect(dialog(page).locator('#lineage-edit-sub')).not.toContainText('16 members');
        await page.keyboard.press('Escape');

        // Olof's card: his own line now.
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('b5' as never));
        await expect(page.locator('#pm-rod .pm-rod-value')).toHaveText(/^Brandvold \(1765\)/);
        // The founder of a line: the same menu item opens the dialog of his line, no choice open.
        await row.locator('.pm-rod-more-btn').click();
        await row.locator('.pm-rod-menu').getByRole('menuitem', { name: 'Start a family line from this person…' }).click();
        await expect(dialog(page)).toHaveClass(/active/);
        await expect(sec(page, 'founder').locator('.le-founder-name')).toHaveText('Olof Brandvold (1765, Ekeby)');
        await expect(sec(page, 'founder').locator('.le-chip')).toHaveText('set manually');
        await expect(dialog(page).locator('.le-panel')).toHaveCount(0);
    });

    test('name forms: × with its preview, Undo, + form merges the lines again', async ({ page }) => {
        await setup(page, { forms: true });
        await page.evaluate(() => window.Strom.UI.openLineageSplitFrom('b1' as never));
        await expect(dialog(page)).toHaveClass(/active/);
        const sub = dialog(page).locator('#lineage-edit-sub');
        await expect(sub).toContainText('18 members');
        const forms = sec(page, 'forms');
        await expect(forms.locator('.le-pill[data-form]')).toHaveText([/^Brandvold\s+main$/, /^Brandwold\s+×$/]);
        // The main form has no ×.
        await expect(forms.locator('.le-pill[data-form="Brandvold"] .le-x')).toHaveCount(0);
        const x = forms.locator('.le-pill[data-form="Brandwold"] .le-x');
        await expect(x).toHaveAttribute('aria-label', 'Remove the form Brandwold');
        await x.click();
        await expect(forms.locator('.le-pill[data-form="Brandwold"]')).toHaveClass(/is-chosen/);
        await expect(preview(page).locator('p')).toHaveText([
            'The line splits: Brandvold 18 → 16 members, new line Brandwold (from Ragnar Brandwold, 1790): 2 members.',
            'The group of forms Brandvold · Brandwold ends (only one form would be left).',
        ]);
        const remove = forms.locator('[data-le="apply"]');
        await expect(remove).toHaveText('Remove the form');
        await expect(remove).toBeFocused();
        expect(await variants(page)).toEqual([['Brandvold', 'Brandwold']]);
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(preview(page)).toHaveCount(0);
        expect(await variants(page)).toEqual([['Brandvold', 'Brandwold']]);

        // Remove: the line splits; Undo brings the form back.
        await x.click();
        await remove.click();
        await expect(forms.locator('.le-pill[data-form="Brandwold"]')).toHaveCount(0);
        await expect(sub).toContainText('16 members');
        expect(await variants(page)).toBeNull();
        await expect(page.locator('.toast[data-kind="lineage-edit"]')).toContainText('Form Brandwold taken out of the spellings Brandvold · Brandwold.');
        await page.locator('.undo-toast-btn').click();
        await expect(forms.locator('.le-pill[data-form="Brandwold"]')).toBeVisible();
        await expect(sub).toContainText('18 members');
        expect(await variants(page)).toEqual([['Brandvold', 'Brandwold']]);

        // Removed again, then + form: the tree's spellings with their counts and lines.
        await x.click();
        await remove.click();
        await expect(forms.locator('.le-pill[data-form="Brandwold"]')).toHaveCount(0);
        await forms.getByRole('button', { name: '+ form' }).click();
        await expect(forms.locator('.le-panel-title')).toHaveText('Add a form to the Brandvold family line');
        const input = forms.locator('.le-addform-input');
        await expect(input).toBeFocused();
        await expect(forms.locator('[data-le="form-pick"][data-form="Tallqvist"]')).toHaveText('Tallqvist · 5 people · Tallqvist line');
        // A spelling not in the tree: "Use …".
        await input.fill('Brandvoll');
        await expect(forms.locator('[data-le="form-pick"]')).toHaveText(['Use “Brandvoll”']);
        await input.fill('Brandw');
        // The spelling found first (a family too small to be a line names none), the typed text after it.
        await expect(forms.locator('[data-le="form-pick"]')).toHaveText(['Brandwold · 2 people', 'Use “Brandw”']);
        await input.press('Enter');
        await expect(preview(page).locator('p')).toHaveText([
            'Linking the forms merges the Brandvold and Brandwold lines (16 + 2 people). The Brandwold line ends.',
            'The form applies to the whole tree: search, merging people and the research see it too.',
        ]);
        expect(await variants(page)).toBeNull();
        await forms.locator('[data-le="apply"]', { hasText: 'Link the forms' }).click();
        await expect(forms.locator('.le-pill[data-form="Brandwold"]')).toBeVisible();
        await expect(sub).toContainText('18 members');
        expect(await variants(page)).toEqual([['Brandvold', 'Brandwold']]);
    });

    test('a form carried along a parent–child link: the preview says so and offers a line of its own', async ({ page }) => {
        await setup(page, { relation: true });
        await page.evaluate(() => window.Strom.UI.openLineageSplitFrom('b1' as never));
        const forms = sec(page, 'forms');
        await forms.locator('.le-pill[data-form="Brandwold"] .le-x').click();
        await expect(preview(page).locator('p')).toHaveText([
            'The lines are joined by a parent–child link, not by the form.',
            'The group of forms Brandvold · Brandwold ends (only one form would be left).',
        ]);
        // "Start a line from a person…": its first carrier (Viktor) chosen.
        await forms.locator('[data-le="relation-split"]').click();
        await expect(sec(page, 'split').locator('[data-le="pick"].is-chosen')).toHaveAttribute('data-id', 'b12');
        await expect(preview(page).locator('p').first()).toHaveText(/^A new family line Brandwold will begin with Viktor Brandwold \(1860\)/);
        expect(await overrides(page)).toBeNull();
    });

    test('Surname spellings: × removes a form after its preview, also over the edit dialog', async ({ page }) => {
        await setup(page, { forms: true });
        await page.evaluate(() => window.Strom.UI.openLineageSplitFrom('b1' as never));
        await sec(page, 'forms').getByRole('button', { name: 'Surname spellings…' }).click();
        const surnames = page.locator('#surnames-modal');
        await expect(surnames).toBeVisible();
        await surnames.locator('.surname-form-x[data-form="Brandwold"]').click();
        const spv = surnames.locator('.surname-form-preview[data-form="Brandwold"]');
        await expect(spv).toContainText('What will change');
        await expect(spv).toContainText('The line splits: Brandvold 18 → 16 members, new line Brandwold (from Ragnar Brandwold, 1790): 2 members.');
        await expect(spv).toContainText('The group of forms Brandvold · Brandwold ends (only one form would be left).');
        await expect(spv.locator('.surname-form-remove')).toBeFocused();
        expect(await variants(page)).toEqual([['Brandvold', 'Brandwold']]);
        // Cancel: nothing stored, the × gets the keyboard back.
        await spv.locator('.surname-form-cancel').click();
        await expect(spv).toHaveCount(0);
        await expect(surnames.locator('.surname-form-x[data-form="Brandwold"]')).toBeFocused();
        await surnames.locator('.surname-form-x[data-form="Brandwold"]').click();
        await spv.locator('.surname-form-remove').click();
        await expect(surnames.locator('.surname-form-x[data-form="Brandwold"]')).toHaveCount(0);
        expect(await variants(page)).toBeNull();
        // Back in the edit dialog: the form is gone there too.
        await page.keyboard.press('Escape');
        await expect(surnames).toBeHidden();
        await expect(dialog(page)).toHaveClass(/active/);
        await expect(sec(page, 'forms').locator('.le-pill[data-form="Brandwold"]')).toHaveCount(0);
        await expect(dialog(page).locator('#lineage-edit-sub')).toContainText('16 members');
    });

    test('a followed tree, a locked tree: controls disabled with the hint, nothing changes', async ({ page }) => {
        const treeId = await setup(page);
        await page.evaluate(() => window.Strom.DataManager.setLiveTree(window.Strom.DataManager.getCurrentTreeId()));
        await openFromOverview(page, treeId);
        const hint = 'A followed tree is read-only. The line can be viewed, not changed.';
        const bar = dialog(page).locator('.le-bar');
        await expect(bar).toHaveAttribute('data-state', 'followed');
        await expect(bar).toHaveText(hint);
        const locked = dialog(page).locator('[data-locked]');
        // Change…, + form and Start a line…
        await expect(locked).toHaveCount(3);
        for (const el of await locked.all()) {
            await expect(el).toHaveAttribute('aria-disabled', 'true');
            await expect(el).toHaveAttribute('title', hint);
        }
        // A disabled control does nothing; Surname spellings is plain text.
        await sec(page, 'founder').getByRole('button', { name: 'Change…' }).click({ force: true });
        await sec(page, 'forms').locator('[data-le="add-form"]').click({ force: true });
        await expect(dialog(page).locator('.le-panel')).toHaveCount(0);
        await expect(sec(page, 'forms').getByRole('button', { name: 'Surname spellings…' })).toHaveCount(0);
        // Close still works.
        await dialog(page).locator('.buttons').getByRole('button', { name: 'Close' }).click();
        await expect(dialog(page)).not.toHaveClass(/active/);

        // A locked tree: read-only the same way.
        await page.evaluate(() => {
            const S = window.Strom;
            S.DataManager.setLiveTree(null);
            S.TreeManager.toggleTreeLock(S.DataManager.getCurrentTreeId());
        });
        await rods(page).locator('.tov-rod.is-open').getByRole('button', { name: 'Edit family line…' }).click();
        await expect(bar).toHaveAttribute('data-state', 'readOnly');
        await expect(bar).toHaveText('The tree is read-only. The line can be viewed, not changed.');
        await expect(dialog(page).locator('[data-locked]')).toHaveCount(3);
        expect(await overrides(page)).toBeNull();
    });

    test('change history: the lineage records; Undo goes back step by step', async ({ page }) => {
        const treeId = await setup(page, { forms: true, history: true });
        await openFromOverview(page, treeId);
        const founder = sec(page, 'founder');
        await founder.getByRole('button', { name: 'Change…' }).click();
        await founder.locator('[data-le="pick"][data-id="b2"]').click();
        await dialog(page).locator('[data-le="apply"]').click();
        await expect(founder.locator('.le-chip')).toHaveText('set manually');

        const split = sec(page, 'split');
        await split.getByRole('button', { name: 'Start a line from a person…' }).click();
        await split.locator('[data-le="pick"][data-id="b8"]').click();
        await dialog(page).locator('[data-le="apply"]').click();
        await expect(split.locator('.le-panel')).toHaveCount(0);

        const forms = sec(page, 'forms');
        await forms.locator('.le-pill[data-form="Brandwold"] .le-x').click();
        await forms.locator('[data-le="apply"]').click();
        await expect(forms.locator('.le-pill[data-form="Brandwold"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);

        await page.evaluate(() => window.Strom.UI.showAuditLogDialog());
        const log = page.locator('#audit-log-modal');
        await expect(log).toBeVisible();
        await expect(log.locator('.audit-log-desc')).toContainText([
            'Form Brandwold taken out of the spellings Brandvold · Brandwold',
            /^Family line Brandvold.* started from Johan Brandvold$/,
            'Family line Brandvold begins with Nils Brandvold',
        ]);
        await page.keyboard.press('Escape');
        await expect(log).toBeHidden();

        // Undo, step by step: the form, the line, the founder.
        const undo = page.locator('#toolbar-undo-btn');
        await undo.click();
        await expect.poll(() => variants(page)).toEqual([['Brandvold', 'Brandwold']]);
        expect(await overrides(page)).toEqual({ notCarriers: ['b1'], founders: ['b8'] });
        await undo.click();
        await expect.poll(() => overrides(page)).toEqual({ notCarriers: ['b1'] });
        await undo.click();
        await expect.poll(() => overrides(page)).toBeNull();
    });
});
