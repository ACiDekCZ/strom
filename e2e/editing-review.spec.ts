import { test, expect, Page } from '@playwright/test';
import {
    openApp, createFirstPerson, card, cardAction, personModal, addRelation, fillPerson,
} from './helpers.js';

/**
 * Editing fixes from the 2026-09-22 review (V8–V12, S1–S3, S9), driven through
 * the real UI:
 *   - the relationships dialog is staged as a whole (status + relation type +
 *     witness roll back together; Save keeps them as ONE undo step),
 *   - "add child" to a single person (child + placeholder partner) is one step,
 *   - Escape asks before discarding the person / event / source editors,
 *   - no third parent and no ancestry cycle can be linked,
 *   - an emptied event / source field stays empty,
 *   - "Deceased" on create is saved; Save without changes records nothing,
 *   - the family wizard keeps the anchor's existing parent,
 *   - first person + child can be added from the keyboard alone.
 * dialogs-keyboard.spec.ts covers the single relation-type rollback and the
 * add-event / add-source questions; these tests extend, not repeat, them.
 */

interface P {
    id: string; firstName: string; lastName: string; isPlaceholder?: boolean;
    parentIds: string[]; childIds: string[]; isDeceased?: boolean; notes?: string;
    parentRelTypes?: Record<string, string>;
    events?: Array<{ id: string; type: string; place?: string; date?: string }>;
}

const persons = (page: Page): Promise<P[]> =>
    page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons) as P[]);

const byName = async (page: Page, name: string): Promise<P> => {
    const p = (await persons(page)).find(x => x.firstName === name);
    if (!p) throw new Error(`no person ${name}`);
    return p;
};

const partnerships = (page: Page) =>
    page.evaluate(() => Object.values(window.Strom.DataManager.getData().partnerships) as Array<{
        id: string; person1Id: string; person2Id: string; status?: string;
        participants?: Array<{ name?: string }>;
    }>);

const undoDescription = (page: Page): Promise<string | null> =>
    page.evaluate(() => window.Strom.DataManager.lastUndoDescription());

async function dismissFamilyOffer(page: Page): Promise<void> {
    const close = page.locator('.family-offer-close');
    if (await close.isVisible().catch(() => false)) await close.click();
}

test.describe('relationships dialog is staged as a whole (S9)', () => {
    /** Jan + Marie with their son Petr; witnesses visible (advanced fields). */
    async function setup(page: Page) {
        await openApp(page);
        await page.evaluate(() => window.Strom.SettingsManager.setAdvancedFields(true));
        await createFirstPerson(page, 'Jan', 'Novak');
        await dismissFamilyOffer(page);
        await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
        await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
        return (await byName(page, 'Jan')).id;
    }

    /** Status → divorced, Petr's link → adoptive, one witness added. */
    async function makeThreeChanges(page: Page) {
        const panel = page.locator('#relationships-modal');
        await panel.locator('.rel-status-select').first().selectOption('divorced');
        // Jan has no parents, so the only relation-type select is Petr's row.
        await panel.locator('.parent-rel-type-select').first().selectOption('adoptive');
        await panel.locator('.partnership-witness-btn').first().click();
        const prompt = page.locator('#confirmation-modal');
        await expect(prompt.locator('#prompt-input')).toBeVisible();
        await prompt.locator('#prompt-input').fill('Tomas Witness');
        await prompt.locator('#confirm-ok-btn').click();
        await expect(panel.locator('.partnership-witnesses')).toContainText('Tomas Witness');
        // The refresh after the witness keeps the still-pending status.
        await expect(panel.locator('.rel-status-select').first()).toHaveValue('divorced');
    }

    async function state(page: Page) {
        const ps = await partnerships(page);
        const jan = await byName(page, 'Jan');
        const petr = await byName(page, 'Petr');
        return {
            status: ps[0].status ?? 'married',
            witnesses: (ps[0].participants ?? []).map(w => w.name),
            relType: petr.parentRelTypes?.[jan.id] ?? 'biological',
        };
    }

    test('Cancel → Discard rolls back status, relation type and witness', async ({ page }) => {
        const janId = await setup(page);
        const panel = page.locator('#relationships-modal');
        const before = await state(page);
        const undoBefore = await undoDescription(page);

        await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), janId);
        await expect(panel).toBeVisible();
        await makeThreeChanges(page);

        await panel.getByRole('button', { name: 'Cancel' }).click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm.locator('#confirm-discard-btn')).toBeVisible();
        await confirm.locator('#confirm-discard-btn').click();
        await expect(panel).toBeHidden();

        expect(await state(page)).toEqual(before);
        expect(await undoDescription(page)).toBe(undoBefore);

        // Reopened, the dialog shows the untouched state and closes quietly.
        await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), janId);
        await expect(panel.locator('.rel-status-select').first()).toHaveValue('married');
        await expect(panel.locator('.parent-rel-type-select').first()).toHaveValue('biological');
        await expect(panel.locator('.partnership-witnesses')).not.toContainText('Tomas Witness');
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(confirm).toBeHidden();
    });

    test('Save applies all three changes as one undo step', async ({ page }) => {
        const janId = await setup(page);
        const panel = page.locator('#relationships-modal');
        const before = await state(page);
        const undoBefore = await undoDescription(page);

        await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), janId);
        await makeThreeChanges(page);
        await panel.getByRole('button', { name: 'Save' }).click();
        await expect(panel).toBeHidden();

        expect(await state(page)).toEqual({ status: 'divorced', witnesses: ['Tomas Witness'], relType: 'adoptive' });
        expect(await undoDescription(page)).not.toBe(undoBefore);

        // Reopen: the dialog reflects all of it.
        await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), janId);
        await expect(panel.locator('.rel-status-select').first()).toHaveValue('divorced');
        await expect(panel.locator('.parent-rel-type-select').first()).toHaveValue('adoptive');
        await expect(panel.locator('.partnership-witnesses')).toContainText('Tomas Witness');
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();

        // ONE Ctrl+Z reverts the whole dialog and lands on the previous step.
        await page.locator('#tree-container').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Control+z');
        await expect.poll(() => state(page)).toEqual(before);
        expect(await undoDescription(page)).toBe(undoBefore);
    });
});

test('"Add child" to a single person is one undo step, placeholder partner included (V12)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await dismissFamilyOffer(page);
    const cards = page.locator('.person-card');
    await expect(cards).toHaveCount(1);

    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await expect(card(page, 'Petr')).toBeVisible();
    // Jan, the "?" placeholder partner and Petr.
    await expect(cards).toHaveCount(3);
    expect((await persons(page)).filter(p => p.isPlaceholder)).toHaveLength(1);

    await page.locator('#tree-container').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect(cards).toHaveCount(1);
    await expect(card(page, 'Jan')).toBeVisible();
    const left = await persons(page);
    expect(left.map(p => p.firstName)).toEqual(['Jan']);
    expect(left[0].childIds).toEqual([]);
    expect(await partnerships(page)).toHaveLength(0);
});

test.describe('Escape asks before discarding edits (V9, S9)', () => {
    test('person edit: typed notes → Stay keeps them, Discard drops them', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await dismissFamilyOffer(page);
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        const confirm = page.locator('#confirmation-modal');
        await modal.locator('#input-notes').fill('Blacksmith in the village');

        await page.keyboard.press('Escape');
        await expect(confirm.locator('#confirm-stay-btn')).toBeVisible();
        await confirm.locator('#confirm-stay-btn').click();
        await expect(confirm).toBeHidden();
        await expect(modal).toBeVisible();
        await expect(modal.locator('#input-notes')).toHaveValue('Blacksmith in the village');

        await page.keyboard.press('Escape');
        await confirm.locator('#confirm-discard-btn').click();
        await expect(modal).toBeHidden();
        expect((await byName(page, 'Jan')).notes ?? '').toBe('');
        await cardAction(page, 'Jan', 'edit');
        await expect(modal.locator('#input-notes')).toHaveValue('');
    });

    test('event editor (editing an existing event): Stay keeps, Discard leaves the event unchanged', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await dismissFamilyOffer(page);
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        const editor = page.locator('#event-editor-modal');
        const confirm = page.locator('#confirmation-modal');
        await modal.locator('#btn-add-event').click();
        await editor.locator('#input-event-type').selectOption('occupation');
        await editor.locator('#input-event-place').fill('Kladno');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();

        await modal.locator('.event-edit-btn').first().click();
        await expect(editor).toBeVisible();
        await editor.locator('#input-event-place').fill('Beroun');
        await page.keyboard.press('Escape');
        await expect(confirm.locator('#confirm-stay-btn')).toBeVisible();
        await confirm.locator('#confirm-stay-btn').click();
        await expect(editor.locator('#input-event-place')).toHaveValue('Beroun');

        await page.keyboard.press('Escape');
        await confirm.locator('#confirm-discard-btn').click();
        await expect(editor).toBeHidden();
        await expect(modal).toBeVisible();
        const ev = (await byName(page, 'Jan')).events ?? [];
        expect(ev.map(e => e.place)).toEqual(['Kladno']);
    });

    test('source editor (editing an existing source): Stay keeps, Discard leaves it unchanged', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        const editor = page.locator('#source-editor-modal');
        const confirm = page.locator('#confirmation-modal');
        await editor.locator('#input-source-title').fill('Parish register');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();

        await page.locator('#sources-list .source-edit-btn').first().click();
        await expect(editor).toBeVisible();
        await editor.locator('#input-source-title').fill('Census 1921');
        await page.keyboard.press('Escape');
        await expect(confirm.locator('#confirm-stay-btn')).toBeVisible();
        await confirm.locator('#confirm-stay-btn').click();
        await expect(editor.locator('#input-source-title')).toHaveValue('Census 1921');

        await page.keyboard.press('Escape');
        await confirm.locator('#confirm-discard-btn').click();
        await expect(editor).toBeHidden();
        await expect(page.locator('#sources-list')).toContainText('Parish register');
        await expect(page.locator('#sources-list')).not.toContainText('Census 1921');
    });
});

test.describe('no third parent, no ancestry cycle (V10)', () => {
    /** Otto → Jan (+Marie) → Petr; Karel is unrelated. */
    async function setup(page: Page) {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await dismissFamilyOffer(page);
        await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
        await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
        await addRelation(page, 'Jan', 'parent', 'Otto', 'Novak');
        await page.evaluate(() => window.Strom.UI.showAddPersonModal());
        await fillPerson(page, 'Karel', 'Svoboda');
        await expect(personModal(page)).toBeHidden();
    }

    async function pickerNames(page: Page, query: string): Promise<string[]> {
        const modal = page.locator('#relation-modal');
        await modal.locator('#toggle-link-mode').click();
        const input = modal.locator('#existing-person-picker .person-picker-input');
        await input.fill(query);
        const dd = modal.locator('#existing-person-picker .person-picker-dropdown');
        await expect(dd.locator('.person-picker-item, .person-picker-empty').first()).toBeVisible();
        return dd.locator('.person-picker-item').allTextContents();
    }

    test('a child with two parents offers nobody as a third parent', async ({ page }) => {
        await setup(page);
        const petr = await byName(page, 'Petr');
        expect(petr.parentIds).toHaveLength(2);

        // The card menu has no "Add parent" for a full parent slot.
        await card(page, 'Petr').click();
        const menu = page.locator('.context-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.context-menu-item[data-action="parent"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);

        // Even when the dialog is opened directly, linking lists nobody.
        await page.evaluate((id) => {
            window.Strom.UI.clearDialogStack();
            window.Strom.UI.pushDialog('relation-modal');
            window.Strom.UI.addRelation(id, 'parent');
        }, petr.id);
        await expect(page.locator('#relation-modal')).toBeVisible();
        expect(await pickerNames(page, 'Karel')).toEqual([]);

        // And the data layer refuses the link without touching anything.
        const refused = await page.evaluate(([k, p]) => window.Strom.DataManager.addParentChild(k, p),
            [(await byName(page, 'Karel')).id, petr.id]);
        expect(refused).toBe(false);
        expect((await byName(page, 'Petr')).parentIds).toEqual(petr.parentIds);
        expect((await byName(page, 'Karel')).childIds).toEqual([]);
    });

    test("one's own father is not offered as a child", async ({ page }) => {
        await setup(page);
        await cardAction(page, 'Jan', 'child');
        await expect(page.locator('#relation-modal')).toBeVisible();
        // Karel is a legal child (control); Otto would close a cycle.
        expect((await pickerNames(page, 'Karel')).join()).toContain('Karel');
        const input = page.locator('#existing-person-picker .person-picker-input');
        await input.fill('Otto');
        await expect(page.locator('#existing-person-picker .person-picker-empty')).toBeVisible();
        await expect(page.locator('#existing-person-picker .person-picker-item')).toHaveCount(0);

        const [jan, otto] = [await byName(page, 'Jan'), await byName(page, 'Otto')];
        const refused = await page.evaluate(([j, o]) => window.Strom.DataManager.addParentChild(j, o), [jan.id, otto.id]);
        expect(refused).toBe(false);
        expect((await byName(page, 'Otto')).parentIds).toEqual([]);
    });
});

test.describe('an emptied field stays empty (V8)', () => {
    test('event place cleared → saved → reopened empty', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await dismissFamilyOffer(page);
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        const editor = page.locator('#event-editor-modal');
        await modal.locator('#btn-add-event').click();
        await editor.locator('#input-event-type').selectOption('occupation');
        await editor.locator('#input-event-date').fill('1925');
        await editor.locator('#input-event-place').fill('Kladno');
        await editor.getByRole('button', { name: 'Save' }).click();
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(modal).toBeHidden();

        await cardAction(page, 'Jan', 'edit');
        await modal.locator('.event-edit-btn').first().click();
        await expect(editor.locator('#input-event-place')).toHaveValue('Kladno');
        await editor.locator('#input-event-place').fill('');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(modal).toBeHidden();

        const ev = (await byName(page, 'Jan')).events ?? [];
        expect(ev).toHaveLength(1);
        expect(ev[0].place ?? '').toBe('');
        await cardAction(page, 'Jan', 'edit');
        await expect(modal.locator('#events-list')).not.toContainText('Kladno');
        await modal.locator('.event-edit-btn').first().click();
        await expect(editor.locator('#input-event-place')).toHaveValue('');
        await expect(editor.locator('#input-event-date')).not.toHaveValue('');
    });

    test('source repository and URL cleared → saved → reopened empty', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        const editor = page.locator('#source-editor-modal');
        await editor.locator('#input-source-title').fill('Parish register');
        await editor.locator('#input-source-repository').fill('Regional Archive');
        await editor.locator('#input-source-url').fill('https://example.org/register/1');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();

        await page.locator('#sources-list .source-edit-btn').first().click();
        await expect(editor.locator('#input-source-repository')).toHaveValue('Regional Archive');
        await editor.locator('#input-source-repository').fill('');
        await editor.locator('#input-source-url').fill('');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();

        const src = await page.evaluate(() =>
            Object.values(window.Strom.DataManager.getData().sources ?? {})[0] as Record<string, unknown>);
        expect(src.title).toBe('Parish register');
        expect(src.repository ?? '').toBe('');
        expect(src.url ?? '').toBe('');
        await page.locator('#sources-list .source-edit-btn').first().click();
        await expect(editor.locator('#input-source-repository')).toHaveValue('');
        await expect(editor.locator('#input-source-url')).toHaveValue('');
        await expect(editor.locator('#input-source-title')).toHaveValue('Parish register');
    });
});

test('"Deceased" on create is saved; Save without changes adds no undo step (S2)', async ({ page }) => {
    await openApp(page);
    await page.locator('#empty-state button').first().click();
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await modal.locator('#input-firstname').fill('Vaclav');
    await modal.locator('#input-lastname').fill('Stary');
    await modal.locator('#expand-details').click();
    await modal.locator('#input-is-deceased').check();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    expect((await byName(page, 'Vaclav')).isDeceased).toBe(true);
    await expect(card(page, 'Vaclav')).toContainText('†');
    await dismissFamilyOffer(page);

    // Open and Save without touching anything: no new undo step.
    const undoBefore = await undoDescription(page);
    expect(await page.evaluate(() => window.Strom.DataManager.canUndo())).toBe(true);
    await cardAction(page, 'Vaclav', 'edit');
    await expect(modal.locator('#input-is-deceased')).toBeChecked();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    expect(await undoDescription(page)).toBe(undoBefore);
    expect((await byName(page, 'Vaclav')).isDeceased).toBe(true);
    // The top step is still the creation: one Ctrl+Z removes the person.
    await page.locator('#tree-container').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect(card(page, 'Vaclav')).toHaveCount(0);
});

test('family wizard keeps the existing mother and adds only the father (V11)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Ego', 'Root');
    await dismissFamilyOffer(page);
    await addRelation(page, 'Ego', 'parent', 'Marie', 'Root', 'female');
    const marie = await byName(page, 'Marie');

    await cardAction(page, 'Ego', 'add-family');
    const wizard = page.locator('#family-wizard-modal');
    await expect(wizard).toBeVisible();
    const motherRow = wizard.locator('.wiz-row[data-kind="mother"]');
    await expect(motherRow).toHaveAttribute('data-fixed', '1');
    await expect(motherRow).toHaveAttribute('data-existing-id', marie.id);
    await expect(motherRow.locator('.wiz-first')).toHaveValue('Marie');
    await expect(motherRow.locator('.wiz-first')).toHaveJSProperty('readOnly', true);
    const fatherRow = wizard.locator('.wiz-row[data-kind="father"]');
    await expect(fatherRow).not.toHaveAttribute('data-fixed', '1');

    await fatherRow.locator('.wiz-first').fill('Otec');
    await wizard.getByRole('button', { name: 'Add family' }).click();
    await expect(wizard).toBeHidden();

    const ego = await byName(page, 'Ego');
    const otec = await byName(page, 'Otec');
    expect(ego.parentIds).toHaveLength(2);
    expect([...ego.parentIds].sort()).toEqual([marie.id, otec.id].sort());
    // Exactly three people — the untouched sibling/child rows (surname
    // prefilled) add nobody — and the parents are each other's partner.
    expect((await persons(page)).map(p => p.firstName).sort()).toEqual(['Ego', 'Marie', 'Otec']);
    const unions = await partnerships(page);
    expect(unions).toHaveLength(1);
    expect([unions[0].person1Id, unions[0].person2Id].sort()).toEqual([marie.id, otec.id].sort());
});

test('keyboard only: first person, then a child, from the empty state', async ({ page }) => {
    await openApp(page);
    const activeIs = (sel: string) => page.evaluate((s) => !!document.activeElement?.matches(s), sel);

    // Tab to the empty state's "add first person" button.
    const addFirst = '#empty-state button';
    for (let i = 0; i < 60 && !(await activeIs(addFirst)); i++) await page.keyboard.press('Tab');
    expect(await activeIs(addFirst)).toBe(true);
    const label = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(label).not.toMatch(/sample/i);
    await page.keyboard.press('Enter');

    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.locator('#input-firstname')).toBeFocused();
    await page.keyboard.type('Jan');
    await page.keyboard.press('Tab');
    await expect(modal.locator('#input-lastname')).toBeFocused();
    await page.keyboard.type('Novak');
    // Enter walks the form fields and submits after the last one.
    for (let i = 0; i < 10 && await modal.isVisible(); i++) await page.keyboard.press('Enter');
    await expect(modal).toBeHidden();
    await expect(card(page, 'Jan')).toBeVisible();

    // Tab to Jan's card, open its menu, arrow to "Add child".
    const janCard = '.person-card[aria-label="Jan Novak"]';
    for (let i = 0; i < 80 && !(await activeIs(janCard)); i++) await page.keyboard.press('Tab');
    expect(await activeIs(janCard)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('.context-menu')).toBeVisible();
    const childItem = '.context-menu-item[data-action="child"]';
    for (let i = 0; i < 20 && !(await activeIs(childItem)); i++) await page.keyboard.press('ArrowDown');
    expect(await activeIs(childItem)).toBe(true);
    await page.keyboard.press('Enter');

    const rel = page.locator('#relation-modal');
    await expect(rel).toBeVisible();
    // Focus lands on the first field you type into (the name), not on the
    // other-parent select above it.
    await expect(rel.locator('#rel-firstname')).toBeFocused();
    await page.keyboard.type('Petr');
    for (let i = 0; i < 10 && await rel.isVisible(); i++) await page.keyboard.press('Enter');
    await expect(rel).toBeHidden();
    await expect(card(page, 'Petr')).toBeVisible();

    const jan = await byName(page, 'Jan');
    const petr = await byName(page, 'Petr');
    expect(petr.parentIds).toContain(jan.id);
});
