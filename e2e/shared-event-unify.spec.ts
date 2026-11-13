import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * Copies of a shared event that went apart (spec 085 §4, 4a–4g): the Events
 * table's date cell writing every copy with its toast and the ages bubble;
 * the amber dot and the finding's bubble; Data quality's finding with Make
 * all match… (the Unify dialog, one Undo brings the difference back),
 * Separate the differing copy and Open; the event editor's amber bar with
 * Compare; a phone at 390 and German at 1440/1024/390, light and dark, with
 * a long tree name and long names. Invented data, a fixed clock.
 */

/**
 * Sudivoj's household at the census of 1921 (one share of four); Zbyhněv's
 * copy has the 16th, the others the 15th. `long`: long names and tree name.
 */
async function household(page: Page, opts: { width?: number; height?: number; long?: boolean } = {}): Promise<string> {
    await page.clock.setFixedTime(new Date('2026-11-13T10:30:00Z'));
    await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
    await openApp(page);
    return page.evaluate(async (long) => {
        const p = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        const census = (id: string, age: string, date = '1921-02-15') =>
            [{ id, type: 'census', date, place: 'Dolní Smyšlenice', address: 'č. 14', age, shareId: 'sh1921' }];
        const S = window.Strom;
        await S.DataManager.importAsNewTree({
            persons: {
                p_sudivoj: p('p_sudivoj', long ? 'Sudivoj Lutobor Radhost' : 'Sudivoj', long ? 'Hurdálek-Smyšlenický' : 'Hurdálek', 'male', {
                    birthDate: '1879', deathDate: '1950', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev'], events: census('c_s', '42') }),
                p_radegunda: p('p_radegunda', long ? 'Radegunda Hněvsa Slavibora' : 'Radegunda', long ? 'Hurdálková-Smyšlenická' : 'Hurdálková', 'female', {
                    birthDate: '1883', deathDate: '1955', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev'], events: census('c_r', '38') }),
                p_bohuchval: p('p_bohuchval', 'Bohuchval', 'Hurdálek', 'male', {
                    birthDate: '1906', deathDate: '1980', parentIds: ['p_sudivoj', 'p_radegunda'], events: census('c_b', '15') }),
                p_zbyhnev: p('p_zbyhnev', long ? 'Zbyhněv Mstivoj Prostivoj' : 'Zbyhněv', long ? 'Hurdálek-Smyšlenický' : 'Hurdálek', 'male', {
                    birthDate: '1910', deathDate: '1985', parentIds: ['p_sudivoj', 'p_radegunda'], events: census('c_z', '11', '1921-02-16') }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_sudivoj', person2Id: 'p_radegunda', childIds: ['p_bohuchval', 'p_zbyhnev'], status: 'married' },
            },
        } as never, long ? 'Rodokmen Hurdálků ze Smyšlenic a okolí 1879–1985' : 'Hurdálek');
        S.UI.updateTreeSwitcher?.();
        await S.TreeRenderer.renderAsync();
        return S.DataManager.getCurrentTreeId() as string;
    }, !!opts.long);
}

type Ev = { id: string; type: string; date?: string; note?: string; age?: string; shareId?: string };
const census = (page: Page, pid: string): Promise<Ev> => page.evaluate((id) =>
    ((window.Strom.DataManager.getData().persons as unknown as Record<string, { events?: Ev[] }>)[id]!.events ?? [])
        .find(e => e.type === 'census')!, pid);
const dates = async (page: Page) => Promise.all(['p_sudivoj', 'p_radegunda', 'p_bohuchval', 'p_zbyhnev'].map(async id => (await census(page, id)).date));

const shot = async (page: Page, name: string) => {
    if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/E-${name}.png` });
};

/** The page and a dialog's content never scroll sideways. */
async function noOverflow(page: Page, within?: Locator): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    if (within) expect(await within.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
}

async function openTableEvents(page: Page): Promise<Locator> {
    await page.locator('#view-mode-table').click();
    await expect(page.locator('#table-container .tv-grid')).toBeVisible();
    await page.locator('#table-container .tv-rowtype [data-rowtype="events"]').click();
    const row = page.locator('#table-container .tv-body .tv-row', { hasText: 'Census' });
    await expect(row).toHaveCount(1);
    return row;
}

/** A body cell of a row by its column's id (its position in the head). */
async function cell(page: Page, row: Locator, colId: string): Promise<Locator> {
    const head = page.locator('#table-container .tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return row.locator(`[aria-colindex="${index}"]`);
}

async function openValidation(page: Page, treeId: string): Promise<Locator> {
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);
    const modal = page.locator('#tree-validation-modal');
    await expect(modal).toBeVisible();
    return modal;
}

const sharedGroup = (modal: Locator) => modal.locator('.vq-group[data-type="sharedCopiesDiffer"]');
const sharedRow = (modal: Locator) => sharedGroup(modal).locator('.vq-row');

/** Data quality with the group Shared events open (a "to check" group starts closed). */
async function openShared(page: Page, treeId: string): Promise<Locator> {
    const modal = await openValidation(page, treeId);
    const head = sharedGroup(modal).locator('.vq-group-head');
    if (await head.getAttribute('aria-expanded') !== 'true') await head.click();
    await expect(sharedRow(modal)).toHaveCount(1);
    return modal;
}
const unifyModal = (page: Page) => page.locator('#shared-unify-modal');

test.describe('desktop (1440)', () => {
    test('the Table: the amber dot and the bubble\'s actions, a date cell for every copy with its toast, the ages bubble', async ({ page }) => {
        await household(page);
        const row = await openTableEvents(page);
        const date = await cell(page, row, 'evDate');
        await expect(date.locator('.tv-mark')).toHaveCount(1);
        await expect((await cell(page, row, 'evPlace')).locator('.tv-mark')).toHaveCount(0);

        await date.click();
        const bubble = page.locator('.tv-bubble--finding');
        await expect(bubble).toBeVisible();
        await expect(bubble.locator('.tv-bub-detail')).toHaveText('Census 1921 · Zbyhněv Hurdálek: date differs (16 Feb 1921; others 15 Feb 1921).');
        await expect(bubble.locator('[data-act="unify"]')).toHaveText('Make all match…');
        await expect(bubble.locator('[data-act="separate"]')).toHaveText('Separate the differing copy');
        await expect(bubble.locator('[data-act="open"]')).toHaveText('Open');
        await expect(bubble.locator('[data-act="dismiss"]')).toHaveCount(0);
        await shot(page, 'table-bubble-en-1440');
        // Make all match…: the dialog over the Table; Cancel leaves the copies as they are.
        await bubble.locator('[data-act="unify"]').click();
        await expect(unifyModal(page)).toBeVisible();
        await unifyModal(page).locator('.buttons [data-dismiss]').click();
        await expect(unifyModal(page)).toBeHidden();
        expect(await dates(page)).toEqual(['1921-02-15', '1921-02-15', '1921-02-15', '1921-02-16']);

        // The date cell writes every copy; a toast says for how many.
        await date.dblclick();
        const editor = page.locator('#table-container .tv-editor-input');
        await expect(editor).toBeFocused();
        await editor.fill('1921-02-16');
        await editor.press('Enter');
        await expect(editor).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: 'Date: changed for 4 people (Census 1921).' })).toHaveCount(1);
        expect(await dates(page)).toEqual(['1921-02-16', '1921-02-16', '1921-02-16', '1921-02-16']);
        await expect((await cell(page, row, 'evDate')).locator('.tv-mark')).toHaveCount(0);

        // The ages bubble: a field per person; Enter saves the changed one.
        await (await cell(page, row, 'evAge')).locator('.tv-ages').click();
        const ages = page.locator('.tv-bubble--ages');
        await expect(ages.locator('.tv-ages-name')).toHaveText(['Sudivoj Hurdálek', 'Radegunda Hurdálková', 'Bohuchval Hurdálek', 'Zbyhněv Hurdálek']);
        await expect(ages.locator('.tv-ages-input')).toHaveCount(4);
        await ages.locator('.tv-ages-input').nth(1).fill('37');
        await ages.locator('.tv-ages-input').nth(1).press('Enter');
        await expect(ages).toHaveCount(0);
        expect((await census(page, 'p_radegunda')).age).toBe('37');
        expect((await census(page, 'p_sudivoj')).age).toBe('42');
        await expect(await cell(page, row, 'evAge')).toContainText('42 · 37 · 15 · 11');
    });

    test('Data quality: Make all match… unifies, the finding goes, one Undo brings it back; Separate the differing copy', async ({ page }) => {
        const treeId = await household(page);
        const modal = await openShared(page, treeId);
        const finding = sharedRow(modal);
        await expect(finding).toHaveCount(1);
        await expect(finding.locator('.vq-shared-text')).toHaveText('Census 1921 · Zbyhněv Hurdálek: date differs (16 Feb 1921; others 15 Feb 1921).');
        await expect(finding.locator('[data-vq="separateShared"]')).toHaveText('Separate the differing copy');
        await expect(finding.locator('[data-vq="openShared"]')).toHaveText('Open');
        await shot(page, 'quality-en-1440');

        await finding.locator('[data-vq="unifyShared"]').click();
        const dlg = unifyModal(page);
        await expect(dlg).toBeVisible();
        await expect(dlg.locator('#shared-unify-title')).toHaveText('Make copies match · Census 1921');
        await expect(dlg.locator('.su-field')).toHaveCount(1);
        const opts = dlg.locator('.su-field[data-field="date"] .su-opt');
        await expect(opts.locator('.su-val')).toHaveText(['15 Feb 1921', '16 Feb 1921']);
        await expect(opts.locator('.su-who')).toHaveText(['Sudivoj Hurdálek, Radegunda Hurdálková, Bohuchval Hurdálek', 'Zbyhněv Hurdálek']);
        await expect(opts.first()).toHaveClass(/is-on/);
        await expect(opts.first().locator('input')).toBeFocused();
        await expect(dlg.locator('#shared-unify-take-all')).toHaveCount(0);
        await expect(dlg.locator('#shared-unify-go')).toHaveText('Make match for 4 people');
        // The picked card moves with the choice.
        await opts.nth(1).click();
        await expect(opts.nth(1)).toHaveClass(/is-on/);
        await opts.first().click();
        await shot(page, 'unify-en-1440');
        await dlg.locator('#shared-unify-go').click();
        await expect(dlg).toBeHidden();
        await expect(sharedRow(modal)).toHaveCount(0);
        expect(await dates(page)).toEqual(['1921-02-15', '1921-02-15', '1921-02-15', '1921-02-15']);
        // One Undo (the pill stays hidden under a dialog): the difference is back.
        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();
        const pill = page.locator('.undo-toast');
        await expect(pill.locator('.undo-toast-msg')).toContainText('Census 1921');
        await pill.locator('.undo-toast-btn').click();
        expect(await dates(page)).toEqual(['1921-02-15', '1921-02-15', '1921-02-15', '1921-02-16']);
        await openShared(page, treeId);

        // Separate the differing copy: Zbyhněv's census is his own again, the others stay shared.
        await sharedRow(modal).locator('[data-vq="separateShared"]').click();
        await expect(sharedRow(modal)).toHaveCount(0);
        const z = await census(page, 'p_zbyhnev');
        expect(z.shareId).toBeUndefined();
        expect(z.date).toBe('1921-02-16');
        expect((await census(page, 'p_sudivoj')).shareId).toBe('sh1921');
    });

    test('Open in Data quality: the event editor of the differing copy with its amber bar', async ({ page }) => {
        const treeId = await household(page);
        const modal = await openShared(page, treeId);
        await sharedRow(modal).locator('[data-vq="openShared"]').click();
        await expect(modal).toBeHidden();
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await expect(editor.locator('#event-editor-subtitle')).toContainText('Zbyhněv Hurdálek');
        await expect(editor.locator('#event-shared-diff')).toBeVisible();
    });

    test('the editor: the amber bar and frame; a saved note keeps the difference; Compare unifies over the editor', async ({ page }) => {
        await household(page);
        await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_zbyhnev' as never, 'c_z'));
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toHaveClass(/active/);
        const bar = editor.locator('#event-shared-diff');
        await expect(bar).toBeVisible();
        await expect(bar.locator('.shared-diff-msg')).toHaveText('Copy differs: Zbyhněv Hurdálek (date 16 Feb 1921).');
        await expect(editor.locator('#input-event-date')).toHaveClass(/is-shared-diff/);
        await expect(editor.locator('#input-event-place')).not.toHaveClass(/is-shared-diff/);
        await shot(page, 'editor-en-1440');

        // From the majority's side no field is framed; a changed note reaches all, the 16th stays.
        await page.keyboard.press('Escape');
        await expect(editor).not.toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_sudivoj' as never, 'c_s'));
        await expect(editor).toHaveClass(/active/);
        await expect(bar).toBeVisible();
        await expect(editor.locator('.is-shared-diff')).toHaveCount(0);
        await editor.locator('#input-event-note').fill('Soupis domu č. 14');
        await editor.locator('.buttons .primary').click();
        await expect(editor).not.toHaveClass(/active/);
        expect((await census(page, 'p_zbyhnev')).note).toBe('Soupis domu č. 14');
        expect(await dates(page)).toEqual(['1921-02-15', '1921-02-15', '1921-02-15', '1921-02-16']);

        // Compare: the dialog over the editor; Zbyhněv's date for all, the bar goes.
        await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_zbyhnev' as never, 'c_z'));
        await expect(editor).toHaveClass(/active/);
        await bar.locator('.shared-diff-link').click();
        const dlg = unifyModal(page);
        await expect(dlg).toBeVisible();
        await dlg.locator('.su-opt').nth(1).click();
        await dlg.locator('#shared-unify-go').click();
        await expect(dlg).toBeHidden();
        await expect(editor).toHaveClass(/active/);
        await expect(bar).toBeHidden();
        await expect(editor.locator('.is-shared-diff')).toHaveCount(0);
        expect(await dates(page)).toEqual(['1921-02-16', '1921-02-16', '1921-02-16', '1921-02-16']);
    });

    test('Escape closes the Unify dialog only, the dialog under it stays', async ({ page }) => {
        const treeId = await household(page);
        const modal = await openShared(page, treeId);
        await sharedRow(modal).locator('[data-vq="unifyShared"]').click();
        await expect(unifyModal(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(unifyModal(page)).toBeHidden();
        await expect(modal).toBeVisible();
        await expect(sharedRow(modal).locator('[data-vq="unifyShared"]')).toBeFocused();
    });
});

test.describe('phone (390)', () => {
    test.use({ hasTouch: true, isMobile: true });
    test('the Unify dialog fills the screen, fields above their 52 px options; the Table\'s sheet has the actions', async ({ page }) => {
        const treeId = await household(page, { width: 390, height: 844 });
        const modal = await openShared(page, treeId);
        await sharedRow(modal).locator('[data-vq="unifyShared"]').click();
        const dlg = unifyModal(page);
        await expect(dlg).toBeVisible();
        const content = dlg.locator('.modal-content');
        const box = await content.boundingBox();
        expect(Math.round(box!.width)).toBe(390);
        const field = dlg.locator('.su-field').first();
        const label = await field.locator('.su-label').boundingBox();
        const opt = await field.locator('.su-opt').first().boundingBox();
        expect(opt!.y).toBeGreaterThanOrEqual(label!.y + label!.height - 0.5);
        expect(opt!.height).toBeGreaterThanOrEqual(52);
        for (const b of await dlg.locator('.buttons button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await noOverflow(page, content);
        await shot(page, 'unify-en-390');
        await dlg.locator('#shared-unify-go').click();
        await expect(dlg).toBeHidden();
        await expect(sharedRow(modal)).toHaveCount(0);
    });

    test('the Table\'s finding on a phone: the sheet with Make all match…', async ({ page }) => {
        await household(page, { width: 390, height: 844 });
        await page.locator('#bb-view-table').tap();
        await expect(page.locator('#table-container .tv-grid')).toBeVisible();
        await page.locator('#table-container .tv-rowtype-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Events' }).tap();
        const row = page.locator('#table-container .tv-body .tv-row', { hasText: 'Census' });
        const date = await cell(page, row, 'evDate');
        await date.scrollIntoViewIfNeeded();
        await date.locator('.tv-mark').tap();
        const sheet = page.locator('.tv-bubble--sheet.tv-bubble--finding');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('[data-act="unify"]')).toBeVisible();
        await noOverflow(page);
        await shot(page, 'table-sheet-en-390');
    });
});

test.describe('touch: a tablet (1024) and a phone sideways (844×390)', () => {
    test.use({ hasTouch: true, isMobile: true });
    for (const [w, h] of [[1024, 768], [844, 390]] as const) {
        test(`${w}×${h}: options of 44 px, the dialog inside the screen`, async ({ page }) => {
            const treeId = await household(page, { width: w, height: h });
            const modal = await openShared(page, treeId);
            await sharedRow(modal).locator('[data-vq="unifyShared"]').click();
            const dlg = unifyModal(page);
            await expect(dlg).toBeVisible();
            const opt = await dlg.locator('.su-opt').first().boundingBox();
            expect(opt!.height).toBeGreaterThanOrEqual(44);
            const box = await dlg.locator('.modal-content').boundingBox();
            expect(box!.y).toBeGreaterThanOrEqual(0);
            expect(box!.y + box!.height).toBeLessThanOrEqual(h + 0.5);
            await noOverflow(page, dlg.locator('.modal-content'));
            await shot(page, `unify-en-${w}x${h}`);
        });
    }
});

test.describe('German, long names', () => {
    test.use({ locale: 'de-DE' });
    for (const width of [1440, 1024, 390]) {
        test(`at ${width}, light and dark: Data quality, the Unify dialog and the editor's bar without overflow`, async ({ page }) => {
            const treeId = await household(page, { width, height: width === 390 ? 844 : 900, long: true });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                const modal = await openShared(page, treeId);
                const finding = sharedRow(modal);
                await expect(finding.locator('.vq-shared-text')).toContainText('Zbyhněv Mstivoj Prostivoj Hurdálek-Smyšlenický');
                await finding.scrollIntoViewIfNeeded();
                await noOverflow(page, modal.locator('.modal-content'));
                await shot(page, `quality-de-${width}-${scheme}`);

                await finding.locator('[data-vq="unifyShared"]').click();
                const dlg = unifyModal(page);
                await expect(dlg).toBeVisible();
                await expect(dlg.locator('#shared-unify-go')).toHaveText('Bei 4 Personen angleichen');
                await noOverflow(page, dlg.locator('.modal-content'));
                for (const el of await dlg.locator('.su-opt, .buttons button').all()) {
                    expect(await el.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
                }
                await shot(page, `unify-de-${width}-${scheme}`);
                await page.keyboard.press('Escape');
                await expect(dlg).toBeHidden();
                await page.keyboard.press('Escape');
                await expect(modal).toBeHidden();

                await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_zbyhnev' as never, 'c_z'));
                const editor = page.locator('#event-editor-modal');
                await expect(editor).toHaveClass(/active/);
                const bar = editor.locator('#event-shared-diff');
                await expect(bar).toBeVisible();
                await noOverflow(page, editor.locator('.modal-content'));
                const bb = await bar.boundingBox();
                const eb = await editor.locator('.modal-content').boundingBox();
                expect(bb!.x + bb!.width).toBeLessThanOrEqual(eb!.x + eb!.width + 0.5);
                await shot(page, `editor-de-${width}-${scheme}`);
                await page.keyboard.press('Escape');
                await expect(editor).not.toHaveClass(/active/);
                await page.keyboard.press('Escape');
            }
        });
    }
});
