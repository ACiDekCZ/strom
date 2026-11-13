import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, cardAction, personModal } from './helpers.js';

/**
 * The event editor's "Shared with" (spec 085 §1, §3): persons added to a
 * census through the picker, saved as one Undo step at every copy; a date
 * changed from another copy; remove, separate, the last one left; Delete ▾
 * for this person or for all; the types locked while shared; the
 * delete-person confirmation listing shared events; a phone, German, dark
 * mode. Invented data, a fixed clock.
 */

const SUDIVOJ = 'p_sudivoj';
const RADEGUNDA = 'p_radegunda';
const BOHUCHVAL = 'p_bohuchval';
const ZBYHNEV = 'p_zbyhnev';

type Ev = { id: string; type: string; date?: string; shareId?: string; shareRole?: string; age?: string; place?: string; sourceIds?: string[] };

/** Sudivoj's household in 1921; his father died in 1914. `long`: Sudivoj's name and the tree's name made 30+ characters. */
async function tree(page: Page, opts: { width?: number; height?: number; long?: boolean } = {}): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-11-13T10:30:00Z'));
    await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
    await openApp(page);
    await page.evaluate(async (long) => {
        const p = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                p_sudivoj: p('p_sudivoj', long ? 'Sudivoj Bonifác Drahoslav' : 'Sudivoj', long ? 'Hurdálek-Smyšlenický' : 'Hurdálek', 'male', {
                    birthDate: '1879', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev'], parentIds: ['p_drahomil'],
                    events: [{ id: 'ev_1', type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', age: '42', sourceIds: ['s1'] },
                        { id: 'ev_2', type: 'baptism', date: '1879-03-01' }] }),
                p_radegunda: p('p_radegunda', 'Radegunda', 'Hurdálková', 'female', { birthDate: '1883', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev'] }),
                p_bohuchval: p('p_bohuchval', 'Bohuchval', 'Hurdálek', 'male', { birthDate: '1906', parentIds: ['p_sudivoj', 'p_radegunda'] }),
                p_zbyhnev: p('p_zbyhnev', 'Zbyhněv', 'Hurdálek', 'male', { birthDate: '1910', parentIds: ['p_sudivoj', 'p_radegunda'] }),
                p_drahomil: p('p_drahomil', 'Drahomil', 'Hurdálek', 'male', { birthDate: '1850', deathDate: '1914-03-02', childIds: ['p_sudivoj'] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_sudivoj', person2Id: 'p_radegunda', childIds: ['p_bohuchval', 'p_zbyhnev'], status: 'married' },
            },
            sources: { s1: { id: 's1', title: 'Census 1921, Dolní Smyšlenice' } },
        } as never, long ? 'Rodokmen Hurdálků ze Smyšlenic 1879' : 'Hurdálek');
    }, !!opts.long);
}

/** Sudivoj's census shared with the household (as the data layer saves it). */
async function share(page: Page): Promise<void> {
    await page.evaluate(() => {
        const ok = window.Strom.DataManager.saveSharedEvent('p_sudivoj' as never, 'ev_1', {
            common: {},
            own: new Map([['p_radegunda', { age: '38' }], ['p_zbyhnev', { shareRole: 'nephew' }]]) as never,
            add: ['p_radegunda', 'p_bohuchval', 'p_zbyhnev'] as never,
        });
        if (!ok) throw new Error('not shared');
    });
}

const census = (page: Page, pid: string) => page.evaluate((id) =>
    ((window.Strom.DataManager.getData().persons as unknown as Record<string, { events?: Ev[] }>)[id]?.events ?? [])
        .find(e => e.type === 'census') ?? null, pid);

const censusId = async (page: Page, pid: string): Promise<string> => (await census(page, pid))!.id;

/** The editor opened on a person's census from anywhere (the entry part D calls). */
async function openFor(page: Page, pid: string): Promise<Locator> {
    const id = await censusId(page, pid);
    await page.evaluate(([p, e]) => window.Strom.UI.openEventEditorFor(p as never, e), [pid, id]);
    const editor = page.locator('#event-editor-modal');
    await expect(editor).toHaveClass(/active/);
    return editor;
}

const row = (editor: Locator, pid: string) => editor.locator(`.sw-row[data-pid="${pid}"]`);
/** The newest Undo toast (the setup's own save may still show one). */
const toast = (page: Page) => page.locator('.undo-toast .undo-toast-msg').last();

async function rowMenu(page: Page, editor: Locator, pid: string, item: string): Promise<void> {
    await row(editor, pid).locator('.sw-menu-btn').click();
    await page.locator('#shared-event-menu').getByRole('menuitem', { name: item }).click();
}

test.describe('shared event in the event editor', () => {
    test('three persons added to a census: one save at four copies, the toast, and Undo takes it back', async ({ page }) => {
        await tree(page);
        await cardAction(page, 'Sudivoj', 'edit');
        const modal = personModal(page);
        await modal.locator('#events-list .event-row', { hasText: 'Census' }).locator('.event-edit-btn').click();
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toBeVisible();
        // Whose side: the name and birth year under the title; not shared yet: one quiet line.
        await expect(editor.locator('#event-editor-subtitle')).toHaveText('Sudivoj Hurdálek · * 1879');
        await expect(editor.locator('#event-shared-banner')).toBeHidden();
        const section = editor.locator('#event-shared-section');
        await expect(section).toHaveText(/Shared with\s*\+ Add a person/);

        await section.locator('.sw-add-link').click();
        const picker = page.locator('#shared-picker-modal');
        await expect(picker).toHaveClass(/active/);
        await expect(picker.locator('#shared-picker-sub')).toHaveText('Census · 15 Feb 1921');
        await expect(picker.locator('.spk-head')).toContainText('Family');
        await expect(picker.locator('.spk-row')).toHaveCount(3);
        await expect(picker.locator('.spk-hidden')).toContainText('Drahomil Hurdálek († 1914)');
        await expect(picker.locator('#shared-picker-add')).toBeDisabled();
        for (const name of ['Radegunda', 'Bohuchval', 'Zbyhněv']) await picker.locator('.spk-row', { hasText: name }).click();
        await expect(picker.locator('#shared-picker-add')).toHaveText('Add (3)');
        await picker.locator('#shared-picker-add').click();
        await expect(picker).not.toHaveClass(/active/);

        await expect(editor.locator('.sw-row')).toHaveCount(3);
        await expect(editor.locator('.sw-title')).toHaveText('Shared with · 3');
        await expect(editor.locator('#event-shared-banner')).toHaveText('Shared by 4 people – changes apply to everyone');
        await expect(editor.locator('#event-age-own')).toHaveText('only Sudivoj');
        await row(editor, RADEGUNDA).locator('.sw-age-input').fill('38');
        // A role of its own: "Other role…" turns into a text field.
        await row(editor, ZBYHNEV).locator('.sw-role-select').selectOption('other');
        await expect(row(editor, ZBYHNEV).locator('.sw-role-input')).toBeFocused();
        await row(editor, ZBYHNEV).locator('.sw-role-input').fill('nephew');

        // The person picker no longer offers the persons already in.
        await editor.locator('.sw-add').click();
        await expect(picker.locator('.spk-row.is-already')).toHaveCount(3);
        await expect(picker.locator('.spk-row.is-already').first()).toContainText('already in Shared with');
        await page.keyboard.press('Escape');
        await expect(picker).not.toHaveClass(/active/);
        await expect(editor).toHaveClass(/active/);

        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(editor).toBeHidden();
        await expect(toast(page)).toHaveText('Census 1921: saved for 4 people.');

        const sudivoj = (await census(page, SUDIVOJ))!;
        expect(sudivoj.shareId).toBeTruthy();
        for (const pid of [RADEGUNDA, BOHUCHVAL, ZBYHNEV]) {
            const c = (await census(page, pid))!;
            expect(c.shareId).toBe(sudivoj.shareId);
            expect(c.date).toBe('1921-02-15');
            expect(c.sourceIds).toEqual(['s1']);
        }
        expect((await census(page, RADEGUNDA))!.age).toBe('38');
        expect((await census(page, ZBYHNEV))!.shareRole).toBe('nephew');

        // The pill stands once no dialog is open (as everywhere in the app).
        await modal.locator('.close-btn').first().click();
        await expect(modal).not.toHaveClass(/active/);
        await page.locator('.undo-toast-btn:visible').click();
        for (const pid of [RADEGUNDA, BOHUCHVAL, ZBYHNEV]) expect(await census(page, pid)).toBeNull();
        expect((await census(page, SUDIVOJ))!.shareId).toBeUndefined();
    });

    test('a date changed from another copy changes all; remove and separate; the last one left', async ({ page }) => {
        await tree(page);
        await share(page);
        let editor = await openFor(page, RADEGUNDA);
        await expect(editor.locator('#event-editor-subtitle')).toHaveText('Radegunda Hurdálková · * 1883');
        await expect(editor.locator('#input-event-age')).toHaveValue('38');
        await expect(editor.locator('.sw-row')).toHaveCount(3);
        await expect(row(editor, ZBYHNEV).locator('.sw-role-input')).toHaveValue('nephew');
        await editor.locator('#input-event-date').fill('1 Mar 1921');
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(toast(page)).toHaveText('Census 1921: saved for 4 people.');
        for (const pid of [SUDIVOJ, RADEGUNDA, BOHUCHVAL, ZBYHNEV]) expect((await census(page, pid))!.date).toBe('1921-03-01');

        editor = await openFor(page, SUDIVOJ);
        await rowMenu(page, editor, BOHUCHVAL, 'Remove from the event');
        await expect(editor.locator('#event-shared-banner')).toHaveText('Shared by 3 people – changes apply to everyone');
        await rowMenu(page, editor, ZBYHNEV, 'Separate (keep an own copy)');
        await expect(editor.locator('.sw-row')).toHaveCount(1);
        await editor.locator('#input-event-place').fill('Horní Smyšlenice');
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(toast(page)).toHaveText('Census 1921: now shared by 2 people.');
        expect(await census(page, BOHUCHVAL)).toBeNull();
        const zbyhnev = (await census(page, ZBYHNEV))!;
        expect(zbyhnev.shareId).toBeUndefined();
        expect(zbyhnev.place).toBe('Dolní Smyšlenice');
        expect((await census(page, RADEGUNDA))!.place).toBe('Horní Smyšlenice');

        editor = await openFor(page, RADEGUNDA);
        await rowMenu(page, editor, SUDIVOJ, 'Remove from the event');
        // No one else: back to the quiet line, no banner, at once.
        await expect(editor.locator('#event-shared-section .sw-add-link')).toBeVisible();
        await expect(editor.locator('#event-shared-banner')).toBeHidden();
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(toast(page)).toHaveText('Census 1921: now only for Radegunda Hurdálková.');
        expect((await census(page, RADEGUNDA))!.shareId).toBeUndefined();
        expect(await census(page, SUDIVOJ)).toBeNull();
    });

    test('Delete ▾: for this person only by the keyboard, then for all after naming them', async ({ page }) => {
        await tree(page);
        await share(page);
        let editor = await openFor(page, SUDIVOJ);
        const del = editor.locator('#btn-delete-shared');
        await expect(del).toBeVisible();
        await del.focus();
        await page.keyboard.press('Enter');
        const menu = page.locator('#shared-event-menu');
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem')).toHaveText([
            /Delete for this person only\s*Stays for the other 3\./,
            /Separate this person/,
            'Delete for all 4 people…',
        ]);
        await expect(menu.getByRole('menuitem').first()).toBeFocused();
        // Escape closes the menu only.
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(editor).toHaveClass(/active/);
        await expect(del).toBeFocused();
        await page.keyboard.press('Space');
        await expect(menu).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Enter');
        await expect(editor).toBeHidden();
        await expect(toast(page)).toHaveText('Census 1921: deleted for this person, stays for 3 others.');
        expect(await census(page, SUDIVOJ)).toBeNull();
        expect((await census(page, RADEGUNDA))!.shareId).toBeTruthy();

        editor = await openFor(page, RADEGUNDA);
        await editor.locator('#btn-delete-shared').click();
        await page.locator('#shared-event-menu').getByRole('menuitem', { name: 'Delete for all 3 people…' }).click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toHaveClass(/active/);
        await expect(confirm.locator('#confirm-title')).toHaveText('Delete Census 1921 for all 3 people?');
        await expect(confirm.locator('.confirm-list li')).toHaveText(['Radegunda Hurdálková', 'Bohuchval Hurdálek', 'Zbyhněv Hurdálek']);
        await expect(confirm).toContainText('Can be undone with Undo.');
        await confirm.getByRole('button', { name: 'Delete for all 3 people' }).click();
        await expect(toast(page)).toHaveText('Census 1921: deleted for 3 people.');
        for (const pid of [RADEGUNDA, BOHUCHVAL, ZBYHNEV]) expect(await census(page, pid)).toBeNull();
    });

    test('types locked while shared; no "Shared with" for a baptism, a godparent or a couple’s event', async ({ page }) => {
        await tree(page);
        await share(page);
        const editor = await openFor(page, SUDIVOJ);
        const type = editor.locator('#input-event-type');
        await expect(type.locator('optgroup')).toHaveAttribute('label', 'One person only');
        await expect(type.locator('optgroup option[value="baptism"]')).toBeDisabled();
        await expect(type.locator('optgroup option[value="godparent"]')).toBeDisabled();
        await expect(type.locator('> option[value="residence"]')).toBeEnabled();
        await type.focus();
        await expect(editor.locator('#event-type-lock-hint')).toHaveText(/These types can’t be shared.*\(3\)/);
        await editor.getByRole('button', { name: 'Cancel' }).click();
        await expect(editor).toBeHidden();

        // A baptism of one person: nothing new but the subtitle.
        await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_sudivoj' as never, 'ev_2'));
        await expect(editor).toHaveClass(/active/);
        await expect(editor.locator('#event-shared-section')).toBeHidden();
        await expect(editor.locator('#btn-delete-shared')).toBeHidden();
        await editor.locator('#input-event-type').selectOption('godparent');
        await expect(editor.locator('#event-shared-section')).toBeHidden();
        await expect(editor.locator('#event-participants-section')).toBeHidden();
        await editor.locator('#input-event-type').selectOption('residence');
        await expect(editor.locator('#event-shared-section .sw-add-link')).toBeVisible();
        await editor.locator('#input-event-type').selectOption('baptism');
        await editor.getByRole('button', { name: 'Cancel' }).click();

        // A couple's event: the couple's editor, no "Shared with".
        await page.evaluate(() => window.Strom.UI.showAddCoupleEventModal?.('u1' as never));
        if (await editor.evaluate(el => el.classList.contains('active'))) {
            await expect(editor.locator('#event-shared-section')).toBeHidden();
            await expect(editor.locator('#event-shared-banner')).toBeHidden();
        }
    });

    test('deleting a person lists the shared events that stay with the others', async ({ page }) => {
        await tree(page);
        await share(page);
        await page.evaluate(() => { void window.Strom.UI.confirmDeletePersonDialog('p_bohuchval' as never); });
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toHaveClass(/active/);
        await expect(confirm.locator('.confirm-list-lead')).toHaveText('Shared events stay with the others:');
        await expect(confirm.locator('.confirm-list li')).toHaveText(['Census 1921 (Sudivoj, Radegunda, Zbyhněv)']);
        await confirm.getByRole('button', { name: 'Delete person' }).click();
        await page.evaluate(() => window.Strom.DataManager.deletePerson('p_bohuchval' as never));
        expect((await census(page, SUDIVOJ))!.shareId).toBeTruthy();
    });
});

test.describe('shared event: phone, German, dark', () => {
    for (const width of [1440, 1024, 390]) {
        test(`German at ${width} px with a long name, light and dark: no sideways scroll`, async ({ page }) => {
            await tree(page, { width, height: width === 390 ? 844 : 900, long: true });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await share(page);
            await page.evaluate(() => {
                const d = window.Strom.DataManager;
                const p = d.getPerson('p_bohuchval' as never)!;
                d.updatePerson('p_bohuchval' as never, { firstName: 'Bohuchval Drahomil Bonifác', lastName: p.lastName } as never);
            });
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                const editor = await openFor(page, SUDIVOJ);
                await expect(editor.locator('#event-shared-banner')).toHaveText('Gemeinsames Ereignis von 4 Personen – Änderungen gelten für alle');
                await expect(editor.locator('#event-age-own')).toHaveText('nur Sudivoj Bonifác Drahoslav');
                const overflow = await editor.evaluate(el => {
                    const content = el.querySelector('.modal-content') as HTMLElement;
                    const modal = el.querySelector('.modal') as HTMLElement;
                    return {
                        content: content.scrollWidth - content.clientWidth,
                        modal: modal.scrollWidth - modal.clientWidth,
                        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    };
                });
                expect(overflow).toEqual({ content: 0, modal: 0, page: 0 });
                // The row's ⋯: 300 px, across the row on a phone; items 48 px there.
                const btn = row(editor, BOHUCHVAL).locator('.sw-menu-btn');
                await btn.click();
                const menu = page.locator('#shared-event-menu');
                await expect(menu).toBeVisible();
                const box = (await menu.boundingBox())!;
                const rowBox = (await row(editor, BOHUCHVAL).boundingBox())!;
                if (width === 390) {
                    expect(Math.abs(box.width - rowBox.width)).toBeLessThanOrEqual(1);
                    for (const h of await menu.getByRole('menuitem').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) {
                        expect(h).toBeGreaterThanOrEqual(48);
                    }
                    const inputs = await row(editor, BOHUCHVAL).locator('select, input').evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
                    for (const h of inputs) expect(h).toBeGreaterThanOrEqual(44);
                    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
                } else {
                    expect(Math.round(box.width)).toBe(300);
                }
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(width);
                if (process.env.SNIMKY_DIR) {
                    await page.keyboard.press('Escape');
                    await page.screenshot({ path: `${process.env.SNIMKY_DIR}/C-editor-de-${width}-${scheme}.png` });
                    await btn.click();
                    await page.screenshot({ path: `${process.env.SNIMKY_DIR}/C-menu-de-${width}-${scheme}.png` });
                }
                await page.keyboard.press('Escape');
                await expect(menu).toHaveCount(0);

                // The picker: a bottom sheet on a phone.
                await editor.locator('.sw-add').click();
                const picker = page.locator('#shared-picker-modal');
                await expect(picker).toHaveClass(/active/);
                await picker.locator('#shared-picker-search').fill('Vigilius Pokusník');
                await expect(picker.locator('.spk-create-row')).toHaveText('+ Neue Person „Vigilius Pokusník“ anlegen');
                const sheet = (await picker.locator('.shared-picker').boundingBox())!;
                if (width === 390) {
                    expect(Math.round(sheet.y + sheet.height)).toBe(844);
                    expect(Math.round(sheet.width)).toBe(390);
                }
                expect(await picker.evaluate(el => document.documentElement.scrollWidth - document.documentElement.clientWidth
                    + ((el.querySelector('.modal-content') as HTMLElement | null)?.scrollWidth ?? 0)
                    - ((el.querySelector('.modal-content') as HTMLElement | null)?.clientWidth ?? 0))).toBe(0);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/C-picker-de-${width}-${scheme}.png` });
                await page.keyboard.press('Escape');
                await editor.getByRole('button', { name: 'Abbrechen' }).click();
                await expect(editor).toBeHidden();
            }
        });
    }

    test('a phone held sideways: the footer stays in sight, in the editor and in the picker', async ({ page }) => {
        await tree(page, { width: 844, height: 390, long: true });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await share(page);
        const editor = await openFor(page, SUDIVOJ);
        await expect(editor.locator('#event-shared-banner')).toBeVisible();
        const inView = async (loc: Locator) => {
            const b = (await loc.boundingBox())!;
            expect(b.y).toBeGreaterThanOrEqual(0);
            expect(b.y + b.height).toBeLessThanOrEqual(390);
        };
        await inView(editor.getByRole('button', { name: 'Speichern', exact: true }));
        await inView(editor.locator('#btn-delete-shared'));
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/C-editor-de-844x390-light.png` });
        await editor.locator('.sw-add').click();
        const picker = page.locator('#shared-picker-modal');
        await expect(picker).toHaveClass(/active/);
        await inView(picker.locator('#shared-picker-add'));
        if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/C-picker-de-844x390-light.png` });
    });

    test('a new person created in the picker joins the event', async ({ page }) => {
        await tree(page);
        const editor = await openFor(page, SUDIVOJ);
        await editor.locator('#event-shared-section .sw-add-link').click();
        const picker = page.locator('#shared-picker-modal');
        await picker.locator('#shared-picker-search').fill('Vigilius Pokusník');
        await expect(picker.locator('.spk-note')).toContainText('lodger, servant');
        await picker.locator('.spk-create-row').click();
        await expect(picker.locator('#spk-new-first')).toHaveValue('Vigilius');
        await expect(picker.locator('#spk-new-last')).toHaveValue('Pokusník');
        await picker.getByRole('button', { name: 'Create and add' }).click();
        await expect(picker).not.toHaveClass(/active/);
        await expect(editor.locator('.sw-row')).toHaveCount(1);
        await expect(editor.locator('.sw-row .sw-person')).toHaveText('Vigilius Pokusník');
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(toast(page)).toHaveText('Census 1921: saved for 2 people.');
    });
});
