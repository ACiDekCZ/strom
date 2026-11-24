import { test, expect, type Page, type Locator } from '@playwright/test';
import {
    openApp, seedTree, openTreeActions, openStructureDialog, mergeCompare, mergeCurrentStep, mergeWrite, mergeDone,
    type SeedPerson,
} from './helpers.js';

/**
 * Change structure… › Split and Join (spec 139 §5, §6): the split dialogs of
 * today opened from the dialog with "‹ Change structure" in their header;
 * every join into an existing tree through the merge guide — the whole tree,
 * a selection chosen in the step "who to take", and a Strom file added to
 * this tree (no longer a new tree). Names are invented.
 */

/** Jesenští: Vojtěch and Marie (née Kalinovská) with three children, Petr's three with Hana Ostrožná. */
const JESENSTI: Record<string, SeedPerson> = {
    vojtech: { firstName: 'Vojtěch', lastName: 'Jesenský', partners: ['marie'] },
    marie: { firstName: 'Marie', lastName: 'Kalinovská', gender: 'female', parents: ['ota'], partners: ['vojtech'] },
    ota: { firstName: 'Ota', lastName: 'Kalinovský' },
    petr: { firstName: 'Petr', lastName: 'Jesenský', parents: ['vojtech', 'marie'], partners: ['hana'] },
    anna: { firstName: 'Anna', lastName: 'Jesenská', gender: 'female', parents: ['vojtech', 'marie'] },
    karel: { firstName: 'Karel', lastName: 'Jesenský', parents: ['vojtech', 'marie'] },
    hana: { firstName: 'Hana', lastName: 'Ostrožná', gender: 'female', partners: ['petr'] },
    jakub: { firstName: 'Jakub', lastName: 'Jesenský', parents: ['petr', 'hana'] },
    eliska: { firstName: 'Eliška', lastName: 'Jesenská', gender: 'female', parents: ['petr', 'hana'] },
    tomas: { firstName: 'Tomáš', lastName: 'Jesenský', parents: ['petr', 'hana'] },
};

/** Jesenští and, with no tie to them, Kryštof Kalinovský and his son. */
const WITH_PART: Record<string, SeedPerson> = {
    ...JESENSTI,
    krystof: { firstName: 'Kryštof', lastName: 'Kalinovský' },
    vilem: { firstName: 'Vilém', lastName: 'Kalinovský', parents: ['krystof'] },
};

/** Rodina Kalinovských as a Strom file (.json): three people. */
const KALINOVSTI_FILE = {
    version: 1,
    persons: {
        k1: { id: 'k1', firstName: 'Bohumil', lastName: 'Kalinovský', gender: 'male', birthDate: '1871', isPlaceholder: false, partnerships: ['ku'], parentIds: [], childIds: ['k3'] },
        k2: { id: 'k2', firstName: 'Ludmila', lastName: 'Kalinovská', gender: 'female', birthDate: '1875', isPlaceholder: false, partnerships: ['ku'], parentIds: [], childIds: ['k3'] },
        k3: { id: 'k3', firstName: 'Radoslav', lastName: 'Kalinovský', gender: 'male', birthDate: '1902', isPlaceholder: false, partnerships: [], parentIds: ['k1', 'k2'], childIds: [] },
    },
    partnerships: { ku: { id: 'ku', person1Id: 'k1', person2Id: 'k2', childIds: ['k3'], status: 'married' } },
};

function option(dialog: Locator, key: string): Locator {
    return dialog.locator(`.menu-option[data-action="${key}"]`);
}

/** A second tree with one person: something to join into. */
async function secondTree(page: Page, name: string): Promise<void> {
    await page.evaluate(async (n) => {
        const TM = window.Strom.TreeManager;
        const id = TM.createTree(n);
        await TM.saveTreeData(id, {
            persons: { o1: { id: 'o1', firstName: 'Eva', lastName: 'Kalinovská', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } },
            partnerships: {},
        });
    }, name);
}

const realPeople = (page: Page): Promise<number> => page.evaluate(() =>
    Object.values(window.Strom.DataManager.getData().persons).filter((p: { isPlaceholder?: boolean }) => !p.isPlaceholder).length);
const treeCount = (page: Page): Promise<number> => page.evaluate(() => window.Strom.TreeManager.getTrees().length);

test.describe('Split (§5)', () => {
    test('Into families… opens today\'s dialog; "‹ Change structure" and Escape bring the dialog back', async ({ page }) => {
        await openApp(page);
        await seedTree(page, JESENSTI, 'Jesenští', 'jakub');
        const dialog = await openStructureDialog(page, await openTreeActions(page));
        await option(dialog, 'families').click();
        const split = page.locator('#split-families-modal');
        await expect(split).toBeVisible();
        await expect(dialog).toBeHidden();
        const back = split.locator('.modal-header .modal-back');
        await expect(back).toHaveText('Change structure');
        await expect(back).toHaveAttribute('aria-label', 'Back: Change structure');
        await back.click();
        await expect(split).toHaveCount(0);
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('data-step', 'options');

        // Escape returns the same way.
        await option(dialog, 'families').click();
        await expect(split).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(split).toHaveCount(0);
        await expect(dialog).toBeVisible();
    });

    test('Separate disconnected parts… opens today\'s dialog with the way back; a part split off names the tree it came from', async ({ page }) => {
        await openApp(page);
        await seedTree(page, WITH_PART, 'Jesenští', 'vojtech');
        const trees = await treeCount(page);
        const dialog = await openStructureDialog(page, await openTreeActions(page));
        await expect(option(dialog, 'parts')).not.toHaveAttribute('aria-disabled', 'true');
        await option(dialog, 'parts').click();
        const split = page.locator('#split-modal');
        await expect(split).toBeVisible();
        await expect(dialog).toBeHidden();
        await split.locator('.modal-back').click();
        await expect(split).toHaveCount(0);
        await expect(dialog).toHaveAttribute('data-step', 'options');

        await option(dialog, 'parts').click();
        await expect(split.locator('.split-row')).toHaveCount(2);
        // The part of two people: Kryštof Kalinovský and his son.
        await split.locator('.split-row', { hasText: /\b2 people\b/ }).locator('.split-check').check();
        await split.locator('#split-go').click();
        await expect.poll(() => treeCount(page)).toBe(trees + 1);
        const made = await page.evaluate(() => {
            const all = window.Strom.TreeManager.getTrees() as Array<{ name: string; fromTree?: { name: string }; research?: unknown }>;
            return all[all.length - 1];
        });
        expect(made.fromTree?.name).toBe('Jesenští');
        expect(made.research).toBeUndefined();
    });

    test('opened without Change structure…: no way back is drawn', async ({ page }) => {
        await openApp(page);
        await seedTree(page, WITH_PART, 'Jesenští', 'vojtech');
        // Today's call without Change structure… as its parent: no "‹ Change structure".
        await page.evaluate(() => window.Strom.UI.showSplitDialog());
        const split = page.locator('#split-modal');
        await expect(split).toBeVisible();
        await expect(split.locator('.modal-back')).toHaveCount(0);
    });
});

test.describe('Join (§6)', () => {
    test('The whole tree: the guide, step 1 without this tree among the targets', async ({ page }) => {
        await openApp(page);
        await seedTree(page, JESENSTI, 'Jesenští', 'vojtech');
        await secondTree(page, 'Rodina Kalinovských');
        const dialog = await openStructureDialog(page, await openTreeActions(page));
        await option(dialog, 'into').click();
        await dialog.locator('[data-join="whole"]').click();
        await dialog.locator('[data-action="continue"]').click();
        const wizard = page.locator('#merge-modal');
        await expect(wizard).toBeVisible();
        await expect(dialog).toBeHidden();
        await expect(wizard.locator('.merge-s1-target', { hasText: 'Rodina Kalinovských' })).toHaveCount(1);
        await expect(wizard.locator('.merge-s1-target', { hasText: 'Jesenští' })).toHaveCount(0);
    });

    test('A selection › Rod: who to take, then the guide with the source "{tree} — {the line}"', async ({ page }) => {
        await openApp(page);
        await seedTree(page, JESENSTI, 'Jesenští', 'vojtech');
        await secondTree(page, 'Rodina Kalinovských');
        const dialog = await openStructureDialog(page, await openTreeActions(page));
        await option(dialog, 'into').click();
        await dialog.locator('[data-join="selection"]').click();
        await dialog.locator('[data-action="continue"]').click();
        await expect(dialog).toHaveAttribute('data-step', 'who');
        const go = dialog.locator('#structure-footer [data-action="continue"]');
        await expect(go).toHaveText('Continue to the guide');
        await dialog.locator('#structure-who-tab-rod').click();
        const row = dialog.locator('li.sp-rodpick-rod', { hasText: 'Jesensk' }).first();
        await row.locator('button').click();
        await expect(go).toBeEnabled();
        await go.click();
        const wizard = page.locator('#merge-modal');
        await expect(wizard).toBeVisible();
        await expect(dialog).toBeHidden();
        await expect(wizard.locator('.merge-s1-name')).toHaveText(/^Jesenští — .*Jesensk.* line$/);
        await expect(wizard.locator('.merge-s1-target', { hasText: 'Jesenští' })).toHaveCount(0);
        await expect(wizard.locator('.merge-s1-target', { hasText: 'Rodina Kalinovských' })).toHaveCount(1);
    });

    test('Add from a file › Strom file: the guide (no new tree); written, the people are in this tree and Undo takes them back', async ({ page }) => {
        await openApp(page);
        await seedTree(page, JESENSTI, 'Jesenští', 'vojtech');
        const trees = await treeCount(page);
        const before = await realPeople(page);
        const dialog = await openStructureDialog(page, await openTreeActions(page));
        await option(dialog, 'file').click();
        await expect(dialog).toHaveAttribute('data-step', 'file');
        const json = dialog.locator('.menu-option[data-action="json"]');
        await expect(json).toContainText('Strom file (.json)');
        await expect(json).toContainText('An export from Strom, for example from a relative.');
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), json.click()]);
        await chooser.setFiles({ name: 'kalinovsti.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(KALINOVSTI_FILE)) });

        const wizard = page.locator('#merge-modal');
        await expect(wizard).toBeVisible();
        await expect(page.locator('#import-tree-modal')).toBeHidden();
        await expect(wizard.locator('.merge-s1-name')).toHaveText('kalinovsti.json');
        await mergeCompare(wizard);
        await mergeWrite(wizard, 'tree');
        await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
        await mergeDone(wizard);
        expect(await treeCount(page)).toBe(trees);
        await expect.poll(() => realPeople(page)).toBe(before + 3);

        const toast = page.locator('.toast.show', { hasText: 'added to the tree Jesenští' });
        await toast.locator('.toast-action', { hasText: 'Undo' }).click();
        await expect.poll(() => realPeople(page)).toBe(before);
        expect(await treeCount(page)).toBe(trees);
    });

    test('Import… of a Strom file still makes a new tree, also after the file of Add from a file was not chosen', async ({ page }) => {
        await openApp(page);
        await seedTree(page, JESENSTI, 'Jesenští', 'vojtech');
        const dialog = await openStructureDialog(page, await openTreeActions(page));
        await option(dialog, 'file').click();
        // The system dialog closed without a file: the intent is gone with it.
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dialog.locator('.menu-option[data-action="json"]').click()]);
        await chooser.element().dispatchEvent('cancel');
        await page.locator('#file-input').setInputFiles({ name: 'kalinovsti.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(KALINOVSTI_FILE)) });
        await expect(page.locator('#import-tree-modal')).toBeVisible();
        await expect(page.locator('#merge-modal')).toBeHidden();
    });
});
