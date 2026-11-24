import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCount, mergeCurrentStep, mergePair, mergeSetMode, runStructure } from './helpers.js';

/**
 * Step 1 of the import guide, What to do (spec 134 §3, §13): the target
 * tiles (a blocked tree shown with its reason, the keyboard), New tree from a
 * GEDCOM file, an encrypted locked target, Swap of two trees, Save as JSON,
 * an empty file, the line of what the tree does not take over, and the scope
 * a)–d) said on one person, on a phone c) and d) behind More options.
 * The families Modřín (the tree) and Jilm (the file) are invented.
 */

const PASSWORD = 'heslo-modrin-1921';

type P = { id: string; firstName: string; lastName: string; gender: 'male' | 'female'; birthDate?: string; birthPlace?: string; partnerships?: string[] };

function treeData(persons: P[]) {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, { isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p }])),
        partnerships: {},
    };
}

/** Two people of the tree Jilmovi: Kvido Modřín (also in Modřínovi) and Amos Jilm. */
const JILMOVI = treeData([
    { id: 'j_kvido', firstName: 'Kvido', lastName: 'Modřín', gender: 'male', birthDate: '1921', birthPlace: 'Křemenná' },
    { id: 'j_amos', firstName: 'Amos', lastName: 'Jilm', gender: 'male', birthDate: '1925', birthPlace: 'Mechová' },
]);

/** Create trees without switching to them; `locked` ones are locked in Manage trees. */
async function seedTrees(page: Page, trees: Array<{ name: string; data: ReturnType<typeof treeData>; locked?: boolean }>): Promise<void> {
    await page.evaluate((trees) => {
        const TM = window.Strom.TreeManager;
        for (const t of trees) {
            const id = TM.createTree(t.name);
            TM.saveTreeData(id, t.data);
            if (t.locked) TM.toggleTreeLock(id);
        }
    }, trees);
}

/** A GEDCOM file built in the test, read through Import → GEDCOM. */
function gedFile(name: string, records: string[][]): { name: string; mimeType: string; buffer: Buffer } {
    const text = ['0 HEAD', '1 SOUR FICTIVE', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', ...records.flat(), '0 TRLR', ''].join('\n');
    return { name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf-8') };
}

/**
 * Kvido Modřín (as in the tree, plus a death date the tree lacks) with his
 * son Hostivít, who is not in the tree; two kinds of lines the tree does not take over (FOOX, QUUX).
 */
const KVIDO_FILE = gedFile('kvido-modrin.ged', [
    ['0 @I1@ INDI', '1 NAME Kvido /Modřín/', '1 SEX M', '1 BIRT', '2 DATE 1921', '2 PLAC Křemenná', '1 DEAT', '2 DATE 1990',
        '1 FOOX Pila v Mechové', '1 QUUX kovář v Křemenné', '1 FAMS @F1@'],
    ['0 @I2@ INDI', '1 NAME Hostivít /Modřín/', '1 SEX M', '1 BIRT', '2 DATE 1955', '2 PLAC Křemenná', '1 FOOX Pila', '1 FAMC @F1@'],
    ['0 @F1@ FAM', '1 HUSB @I1@', '1 CHIL @I2@'],
]);

/** The app with the tree Modřínovi open (3 people). */
async function openModrinovi(page: Page): Promise<void> {
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
}

/** A GEDCOM file read: the guide stands on step 1. */
async function readGed(page: Page, file: string | ReturnType<typeof gedFile>): Promise<Locator> {
    await page.locator('#gedcom-input').setInputFiles(file);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    return wizard;
}

/** The people (no "?" stand-ins) of the tree named `name`, sorted. */
async function peopleOf(page: Page, name: string): Promise<string[]> {
    return page.evaluate(async (name) => {
        const TM = window.Strom.TreeManager;
        const id = TM.getTrees().find((t: { name: string }) => t.name === name)?.id;
        const d = id ? await TM.getTreeData(id) : null;
        return d ? Object.values(d.persons).filter((p: any) => !p.isPlaceholder).map((p: any) => p.firstName).sort() : [];
    }, name);
}

const treeNames = (page: Page): Promise<string[]> =>
    page.evaluate(() => window.Strom.TreeManager.getTrees().map((t: { name: string }) => t.name).sort());

const target = (wizard: Locator, name: string): Locator =>
    wizard.locator('.merge-s1-target').filter({ has: wizard.page().locator('.merge-s1-tname', { hasText: new RegExp(`^${name}$`) }) });

test('target tiles: the open tree chosen, a locked tree said why and not choosable, arrow keys and Enter choose', async ({ page }) => {
    await openModrinovi(page);
    await seedTrees(page, [{ name: 'Jilmovi', data: JILMOVI }, { name: 'Archiv Křemenná', data: JILMOVI, locked: true }]);
    const wizard = await readGed(page, 'e2e/fixtures/rodokmen-jilmovi.ged');

    // Add to a tree is preset (the open tree can take it), the open tree first and chosen.
    await expect(wizard.locator('.merge-s1-modes [data-mode="add"]')).toHaveAttribute('aria-checked', 'true');
    await expect(wizard.locator('.merge-s1-modes [data-mode="new"]')).toHaveAttribute('aria-checked', 'false');
    const tiles = wizard.locator('.merge-s1-target');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.first().locator('.merge-s1-tname')).toHaveText('Modřínovi');
    await expect(target(wizard, 'Modřínovi').locator('input')).toBeChecked();
    await expect(target(wizard, 'Modřínovi').locator('.merge-s1-tline')).toContainText('3 people · open');
    await expect(wizard.locator('#merge-next')).toHaveText('Compare 4 people with the tree Modřínovi');
    // One row: the radio, the name, then the tree's line beside it.
    const open = target(wizard, 'Modřínovi');
    const [radio, tname, tline] = await Promise.all([open.locator('input'), open.locator('.merge-s1-tname'), open.locator('.merge-s1-tline')]
        .map(async l => (await l.boundingBox())!));
    expect(tname.x).toBeGreaterThan(radio.x + radio.width);
    expect(tline.x).toBeGreaterThan(tname.x + tname.width);
    expect(Math.abs((radio.y + radio.height / 2) - (tname.y + tname.height / 2))).toBeLessThan(4);

    // The locked tree stays in the list, said why, and cannot be chosen.
    const locked = target(wizard, 'Archiv Křemenná');
    await expect(locked).toHaveAttribute('aria-disabled', 'true');
    await expect(locked).toHaveAttribute('data-block', 'locked');
    await expect(locked.locator('.merge-s1-tline')).toContainText('The tree Archiv Křemenná is locked: it cannot be written to.');
    await expect(locked.locator('input')).toBeDisabled();
    await locked.click({ force: true });
    await expect(target(wizard, 'Modřínovi').locator('input')).toBeChecked();
    await expect(wizard.locator('#merge-route')).toHaveText('rodokmen-jilmovi.ged → Modřínovi');

    // Arrow keys move the choice and the focus stays on the chosen tree.
    await target(wizard, 'Modřínovi').locator('input').focus();
    await page.keyboard.press('ArrowDown');
    await expect(target(wizard, 'Jilmovi').locator('input')).toBeChecked();
    await expect(wizard.locator('#merge-route')).toHaveText('rodokmen-jilmovi.ged → Jilmovi');
    await expect(wizard.locator('#merge-next')).toHaveText('Compare 4 people with the tree Jilmovi');
    // The step drawn again with the new target: the focus is still on its radio.
    await expect(target(wizard, 'Jilmovi').locator('input')).toBeFocused();
    // The locked tree is passed over: on to the first one again.
    await page.keyboard.press('ArrowDown');
    await expect(target(wizard, 'Modřínovi').locator('input')).toBeChecked();
    await expect(locked.locator('input')).not.toBeChecked();

    // The mode by keyboard: Enter on New tree, Space on Add to a tree; the focus stays on the mode.
    const modeNew = wizard.locator('.merge-s1-modes [data-mode="new"]');
    await modeNew.focus();
    await page.keyboard.press('Enter');
    await expect(modeNew).toHaveAttribute('aria-checked', 'true');
    await expect(modeNew).toBeFocused();
    await expect(tiles).toHaveCount(0);
    await expect(wizard.locator('.merge-s1-desc')).toContainText('A new tree “rodokmen-jilmovi” with 4 people is created.');
    await page.keyboard.press('Tab');
    const modeAdd = wizard.locator('.merge-s1-modes [data-mode="add"]');
    await expect(modeAdd).toBeFocused();
    await page.keyboard.press('Space');
    await expect(modeAdd).toHaveAttribute('aria-checked', 'true');
    await expect(modeAdd).toBeFocused();
    await expect(tiles).toHaveCount(3);
    await expect(target(wizard, 'Modřínovi').locator('input')).toBeChecked();
});

test('New tree from a GEDCOM file: step 1 straight to What will happen (Who is who and Rules "new tree"), the tree named after the file', async ({ page }) => {
    await openModrinovi(page);
    const before = await treeNames(page);
    const wizard = await readGed(page, 'e2e/fixtures/rodokmen-jilmovi.ged');

    await mergeSetMode(wizard, 'new');
    await expect(wizard.locator('#merge-route')).toHaveText('rodokmen-jilmovi.ged');
    await expect(wizard.locator('.merge-s1-scope')).toHaveCount(0);
    // Steps 2 and 4 are passed over for a new tree.
    for (const s of ['2', '4']) {
        const step = wizard.locator(`#merge-progress .merge-step[data-step="${s}"]`);
        await expect(step).toHaveClass(/is-skipped/);
        await expect(step.locator('.merge-step-sub')).toHaveText('new tree');
    }
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '5');
    await expect(wizard.locator('#merge-progress button.merge-step[data-step="1"]')).toBeVisible();
    await expect(wizard.locator('#merge-progress button.merge-step[data-step="2"]')).toHaveCount(0);
    await wizard.locator('#merge-next').click();
    await expect(wizard).toBeHidden();

    expect(await treeNames(page)).toEqual([...before, 'rodokmen-jilmovi'].sort());
    await expect.poll(() => page.evaluate(() => {
        const TM = window.Strom.TreeManager;
        return TM.getTrees().find((t: { id: string }) => t.id === TM.getActiveTreeId())?.name;
    })).toBe('rodokmen-jilmovi');
    expect(await peopleOf(page, 'rodokmen-jilmovi')).toEqual(['Amos', 'Elvíra', 'Kasián', 'Kvido']);
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Florentýna', 'Kvido', 'Teofil']);
});

test('an encrypted locked target: the row says so, Compare waits, Unlock asks the password and the tree can be compared', async ({ page }) => {
    await openModrinovi(page);
    await seedTrees(page, [{ name: 'Jilmovi', data: JILMOVI }]);
    // Local encryption on, then the app reloaded and its unlock prompt cancelled: the trees are locked.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await settings.locator('#encryption-toggle').check();
    const setup = page.locator('#password-setup-modal');
    await setup.locator('#password-setup-input').fill(PASSWORD);
    await setup.locator('#password-setup-confirm').fill(PASSWORD);
    await setup.getByRole('button', { name: 'Save' }).click();
    await expect(settings.locator('#encryption-status')).toHaveText('Encryption enabled');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            const all = req.result.transaction('trees', 'readonly').objectStore('trees').getAll();
            all.onsuccess = () => {
                const text = JSON.stringify(all.result);
                resolve(text.includes('"encrypted":true') && !text.includes('Amos') && !text.includes('Teofil'));
            };
        };
    }))).toBe(true);
    await page.reload();
    const prompt = page.locator('#password-prompt-modal');
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Cancel' }).click();
    await expect(prompt).toBeHidden();

    const wizard = await readGed(page, 'e2e/fixtures/rodokmen-jilmovi.ged');
    await mergeSetMode(wizard, 'add');
    const chosen = wizard.locator('.merge-s1-target input:checked');
    await expect(chosen).toHaveCount(1);
    const name = await chosen.locator('xpath=..').locator('.merge-s1-tname').textContent();
    const row = wizard.locator('#merge-s1-enc');
    await expect(row).toContainText(`The tree ${name} is encrypted and locked.`);
    await expect(wizard.locator('#merge-next')).toBeDisabled();
    await expect(wizard.locator('#merge-next-why')).toHaveText(`The tree ${name} is encrypted and locked.`);

    await row.getByRole('button', { name: 'Unlock' }).click();
    await expect(prompt).toBeVisible();
    await prompt.locator('#password-prompt-input').fill(PASSWORD);
    await prompt.locator('#password-prompt-input').press('Enter');
    await expect(prompt).toBeHidden();
    await expect(row).toHaveCount(0);
    await expect(wizard.locator('#merge-next')).toBeEnabled();
    await mergeCompare(wizard);
    const counts = (await wizard.locator('#merge-counts .merge-stat .merge-stat-value').allTextContents()).map(Number);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
});

/** Tree manager → the source row's ⋯ → Change structure → Merge into: the guide on step 1, the target chosen there. */
async function mergeTrees(page: Page, sourceName: string, targetName: string): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    const row = manager.locator('.tree-manager-item:not(.pending-merge)', {
        has: page.locator('.tree-manager-item-name', { hasText: new RegExp(`^${sourceName}$`) }),
    });
    await row.locator('.tree-row-menu-btn').click();
    await runStructure(page, 'mergeInto', row);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    await mergeSetMode(wizard, 'add');
    const tile = wizard.locator('.merge-s1-target', { has: page.locator('.merge-s1-tname', { hasText: new RegExp(`^${targetName}$`) }) });
    await tile.click();
    await expect(tile.locator('input')).toBeChecked();
    return wizard;
}

test('a file with a nameless "?" ancestor: the people tile and the sentence above it give the same number', async ({ page }) => {
    await openModrinovi(page);
    const wizard = await readGed(page, gedFile('jilmovi-otaznik.ged', [
        ['0 @I1@ INDI', '1 NAME Amos /Jilm/', '1 SEX M', '1 BIRT', '2 DATE 1925', '1 FAMC @F1@'],
        ['0 @I2@ INDI', '1 NAME Ludiše /Jilmová/', '1 SEX F', '1 BIRT', '2 DATE 1928', '1 FAMC @F1@'],
        ['0 @I3@ INDI', '1 NAME //', '1 SEX M', '1 FAMS @F1@'],
        ['0 @F1@ FAM', '1 HUSB @I3@', '1 CHIL @I1@', '1 CHIL @I2@'],
    ]));
    await expect(wizard.locator('#gedcom-stat-persons')).toHaveText('2');
    await expect(wizard.locator('#merge-next')).toHaveText('Compare 2 people with the tree Modřínovi');
});

test('Swap of two trees: the source and the target change places and the counts follow', async ({ page }) => {
    await openModrinovi(page);
    await seedTrees(page, [{ name: 'Jilmovi', data: JILMOVI }]);
    const wizard = await mergeTrees(page, 'Jilmovi', 'Modřínovi');

    const from = wizard.locator('.merge-s1-fromto .is-from');
    const to = wizard.locator('.merge-s1-fromto .is-to');
    await expect(from).toContainText('Jilmovi');
    await expect(from).toContainText('2 people');
    await expect(to).toContainText('Modřínovi');
    await expect(to).toContainText('3 people');
    await expect(wizard.locator('#merge-next')).toHaveText('Compare 2 people with the tree Modřínovi');

    // Compared first: Kvido joined, Amos new = the 2 people of Jilmovi.
    await mergeCompare(wizard);
    await expect(mergeCount(wizard, 'joined')).toHaveText('1');
    await expect(mergeCount(wizard, 'added')).toHaveText('1');

    // Back on step 1, Swap: Modřínovi → Jilmovi, compared again.
    await wizard.locator('#merge-progress button.merge-step[data-step="1"]').click();
    await wizard.locator('.merge-s1-swap').click();
    await expect(from).toContainText('Modřínovi');
    await expect(from).toContainText('3 people');
    await expect(to).toContainText('Jilmovi');
    await expect(to).toContainText('2 people');
    await expect(wizard.locator('#merge-route')).toHaveText('Modřínovi → Jilmovi');
    await expect(target(wizard, 'Jilmovi').locator('input')).toBeChecked();
    await expect(target(wizard, 'Modřínovi')).toHaveCount(0);
    await expect(wizard.locator('#merge-next')).toHaveText('Compare 3 people with the tree Jilmovi');
    await mergeCompare(wizard);
    await expect(mergeCount(wizard, 'joined')).toHaveText('1');
    await expect(mergeCount(wizard, 'added')).toHaveText('2');
    await mergePair(wizard, 'Teofil');
    // Nothing written by comparing.
    expect(await peopleOf(page, 'Jilmovi')).toEqual(['Amos', 'Kvido']);
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Florentýna', 'Kvido', 'Teofil']);
});

test('Save as JSON downloads the converted file and writes nothing to the trees', async ({ page }) => {
    await openModrinovi(page);
    const before = await treeNames(page);
    const wizard = await readGed(page, 'e2e/fixtures/rodokmen-jilmovi.ged');

    await mergeSetMode(wizard, 'json');
    await expect(wizard.locator('.merge-s1-desc')).toHaveText('Downloads the converted data as a .json file. Nothing is written to any tree.');
    await expect(wizard.locator('.merge-s1-target')).toHaveCount(0);
    await expect(wizard.locator('#merge-next')).toHaveText('Download JSON');
    const downloading = page.waitForEvent('download');
    await wizard.locator('#merge-next').click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    const data = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf-8'));
    const names = Object.values(data.persons as Record<string, { firstName: string; isPlaceholder?: boolean }>)
        .filter(p => !p.isPlaceholder).map(p => p.firstName).sort();
    expect(names).toEqual(['Amos', 'Elvíra', 'Kasián', 'Kvido']);
    await expect(wizard).toBeHidden();

    expect(await treeNames(page)).toEqual(before);
    expect(await peopleOf(page, 'Modřínovi')).toEqual(['Florentýna', 'Kvido', 'Teofil']);
    expect(await page.evaluate(() => window.Strom.MergerUI.hasPendingMerges())).toBe(false);
});

test('a file with nobody in it: the step says so and offers only Close', async ({ page }) => {
    await openModrinovi(page);
    const before = await treeNames(page);
    const wizard = await readGed(page, gedFile('prazdny.ged', []));

    await expect(wizard.locator('.merge-s1-empty')).toHaveText('The file contains no people. Nothing is written.');
    await expect(wizard.locator('.merge-s1-modes')).toHaveCount(0);
    await expect(wizard.locator('.merge-s1-target')).toHaveCount(0);
    await expect(wizard.locator('#merge-next')).toHaveText('Close');
    await expect(wizard.locator('#merge-next')).toBeEnabled();
    await expect(wizard.locator('#merge-cancel')).toBeHidden();
    await expect(wizard.locator('#merge-back')).toBeHidden();
    await expect(wizard.locator('#merge-save-later')).toBeHidden();
    await wizard.locator('#merge-next').click();
    await expect(wizard).toBeHidden();
    expect(await treeNames(page)).toEqual(before);
    expect(await page.evaluate(() => window.Strom.MergerUI.hasPendingMerges())).toBe(false);
});

test('"The tree will not take over": the line, Show all lists every kind, Save list… downloads a .txt', async ({ page }) => {
    await openModrinovi(page);
    const wizard = await readGed(page, KVIDO_FILE);

    const line = wizard.locator('.merge-not-taken-line');
    await expect(line).toContainText('The tree will not take over: FOOX (2×, e.g. “Kvido Modřín: Pila v Mechové”)');
    await expect(line).toContainText('QUUX (1×');

    await wizard.locator('[data-s1="not-taken-all"]').click();
    const dialog = page.locator('#merge-not-taken-modal');
    await expect(dialog).toBeVisible();
    const items = dialog.locator('#merge-not-taken-list li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('FOOX');
    await expect(items.nth(0)).toContainText('2×');
    await expect(items.nth(0)).toContainText('Kvido Modřín: Pila v Mechové');
    await expect(items.nth(1)).toContainText('QUUX');
    await expect(items.nth(1)).toContainText('kovář v Křemenné');

    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Save list…' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('kvido-modrin-not-taken.txt');
    const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf-8');
    expect(text.split('\n')[0]).toBe('Not taken over: kvido-modrin.ged');
    expect(text).toContain('FOOX (2×, e.g. “Kvido Modřín: Pila v Mechové”)');
    expect(text).toContain('QUUX (1×');

    // Escape closes only the list; the guide stays on step 1, the focus back on Show all.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    await expect(wizard.locator('[data-s1="not-taken-all"]')).toBeFocused();
});

test('scope a)–d) said on a person of the tree; the chosen scope stays', async ({ page }) => {
    await openModrinovi(page);
    const wizard = await readGed(page, KVIDO_FILE);

    const scope = (s: string) => wizard.locator(`.merge-s1-scope[data-scope="${s}"]`);
    await expect(wizard.locator('.merge-s1-scope')).toHaveCount(4);
    await expect(scope('a').locator('input')).toBeChecked();
    for (const s of ['a', 'b', 'c', 'd']) await expect(scope(s)).toBeVisible();
    await expect(wizard.locator('.merge-s1-more')).toBeHidden();
    await expect(scope('a').locator('.merge-s1-scope-desc')).toHaveText('Kvido Modřín stays as is; Hostivít Modřín is added.');
    await expect(scope('a').locator('.merge-s1-scope-desc')).toHaveClass(/is-example/);
    await expect(scope('b').locator('.merge-s1-scope-desc')).toContainText('Kvido Modřín gets Died 1990');
    await expect(scope('d').locator('.merge-s1-scope-desc')).toHaveText('Kvido Modřín is enriched as set in step 4; Hostivít Modřín is not added.');
    // The tile's title holds the option's description and its example.
    await expect(scope('a')).toHaveAttribute('title', 'Existing people stay unchanged. Kvido Modřín stays as is; Hostivít Modřín is added.');
    // The radio beside the option's words, not above them.
    const radio = (await scope('a').locator('input').boundingBox())!;
    const words = (await scope('a').locator('.merge-s1-scope-text').boundingBox())!;
    expect(words.x).toBeGreaterThan(radio.x + radio.width);

    await scope('b').click();
    await expect(scope('b').locator('input')).toBeChecked();
    await expect(mergeCurrentStep(wizard).locator('.merge-step-sub')).toHaveText('Add · b)');
    await mergeCompare(wizard);
    await wizard.locator('#merge-progress button.merge-step[data-step="1"]').click();
    await expect(scope('b').locator('input')).toBeChecked();
});

test.describe('on a phone (390 px)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('scope c) and d) wait behind More options; every tile fits the screen', async ({ page }) => {
        await openModrinovi(page);
        const wizard = await readGed(page, KVIDO_FILE);

        const scope = (s: string) => wizard.locator(`.merge-s1-scope[data-scope="${s}"]`);
        const more = wizard.locator('.merge-s1-more');
        await expect(scope('a')).toBeVisible();
        await expect(scope('b')).toBeVisible();
        await expect(scope('c')).toBeHidden();
        await expect(scope('d')).toBeHidden();
        await expect(more).toBeVisible();
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await more.click();
        await expect(more).toHaveAttribute('aria-expanded', 'true');

        // (More options steps aside once c) and d) are shown.)
        const all = [...['a', 'b', 'c', 'd'].map(scope), wizard.locator('.merge-s1-sumline'), ...await wizard.locator('.merge-s1-target').all(),
            ...await wizard.locator('.merge-s1-modes [data-mode]').all(), wizard.locator('#merge-next')];
        for (const el of all) {
            await el.scrollIntoViewIfNeeded();
            await expect(el).toBeInViewport();
            // Whole across the screen (no sideways overflow); top and bottom are the scroll's.
            const box = (await el.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(390);
        }
        // A scope behind More options chosen stays shown.
        await scope('d').click();
        await expect(scope('d').locator('input')).toBeChecked();
        await expect(scope('d')).toBeVisible();
        await expect(scope('c')).toBeVisible();
    });
});
