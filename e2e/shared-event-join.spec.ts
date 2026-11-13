import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * "Shared with → Add a person" for persons who have the same event written
 * separately already (spec 085 K1.6 a): the picker says their record joins,
 * the save joins it (their age and own fields stay, no second copy), a
 * different date gets a new copy, a different source opens Unify, one Undo
 * takes it all back. The picker's rows: a checkbox beside the name, nothing
 * overflowing at 1440/1024/390, German, light and dark, a long name.
 * Invented data, a fixed clock.
 */

const SUDIVOJ = 'p_sudivoj';
const RADEGUNDA = 'p_radegunda';
const BOHUCHVAL = 'p_bohuchval';
const ZBYHNEV = 'p_zbyhnev';
const SPYTIHNEV = 'p_spytihnev';

type Ev = { id: string; type: string; date?: string; shareId?: string; age?: string; note?: string; sourceIds?: string[] };

/** A household whose census of 1921 each has written separately (with an age); Spytihněv's has another day. */
async function tree(page: Page, opts: { width?: number; height?: number; long?: boolean; sameSource?: boolean } = {}): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-11-13T10:30:00Z'));
    await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
    await openApp(page);
    await page.evaluate(async ({ long, sameSource }) => {
        const p = (id: string, firstName: string, gender: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName: long && id === 'p_bohuchval' ? 'Vrbiňák-Smyšlenický z Dolní Lhoty' : 'Vrbiňák', gender,
                isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        const census = (id: string, age: string, extra: Record<string, unknown> = {}) =>
            ({ id, type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', address: 'č. 14', age, sourceIds: ['s1'], ...extra });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                p_sudivoj: p('p_sudivoj', 'Sudivoj', 'male', { birthDate: '1879', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev', 'p_spytihnev'],
                    events: [census('c_s', '42')] }),
                p_radegunda: p('p_radegunda', 'Radegunda', 'female', { birthDate: '1883', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev', 'p_spytihnev'],
                    events: [census('c_r', '38', sameSource ? {} : { sourceIds: ['s2'] })] }),
                p_bohuchval: p('p_bohuchval', long ? 'Bohuchval Drahoslav Bonifác' : 'Bohuchval', 'male', { birthDate: '1906', parentIds: ['p_sudivoj', 'p_radegunda'],
                    events: [census('c_b', '15')] }),
                p_zbyhnev: p('p_zbyhnev', 'Zbyhněv', 'male', { birthDate: '1910', parentIds: ['p_sudivoj', 'p_radegunda'],
                    events: [census('c_z', '11', { address: undefined })] }),
                p_spytihnev: p('p_spytihnev', 'Spytihněv', 'male', { birthDate: '1912', parentIds: ['p_sudivoj', 'p_radegunda'],
                    events: [census('c_y', '9', { date: '1921-02-16' })] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_sudivoj', person2Id: 'p_radegunda', childIds: ['p_bohuchval', 'p_zbyhnev', 'p_spytihnev'], status: 'married' },
            },
            sources: { s1: { id: 's1', title: 'Census 1921, Dolní Smyšlenice' }, s2: { id: 's2', title: 'Domovská matrika' } },
        } as never, 'Vrbiňák');
    }, { long: !!opts.long, sameSource: !!opts.sameSource });
}

const censuses = (page: Page, pid: string) => page.evaluate((id) =>
    ((window.Strom.DataManager.getData().persons as unknown as Record<string, { events?: Ev[] }>)[id]?.events ?? [])
        .filter(e => e.type === 'census'), pid);

/** The editor on Sudivoj's census, then the person picker. */
async function openPicker(page: Page): Promise<{ editor: Locator; picker: Locator }> {
    await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_sudivoj' as never, 'c_s'));
    const editor = page.locator('#event-editor-modal');
    await expect(editor).toHaveClass(/active/);
    await editor.locator('#event-shared-section .sw-add-link').click();
    const picker = page.locator('#shared-picker-modal');
    await expect(picker).toHaveClass(/active/);
    return { editor, picker };
}

const pickRow = (picker: Locator, pid: string) => picker.locator(`.spk-row[data-pid="${pid}"]`);

test.describe('Add a person who has the event already (K1.6 a)', () => {
    test('their records join with their ages, another date gets a copy, a different source opens Unify, one Undo takes it back', async ({ page }) => {
        await tree(page);
        const before = await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons));
        const { editor, picker } = await openPicker(page);
        for (const pid of [RADEGUNDA, BOHUCHVAL, ZBYHNEV]) {
            await expect(pickRow(picker, pid).locator('.spk-joins')).toHaveText('already has Census 1921 – it will be joined');
        }
        await expect(pickRow(picker, SPYTIHNEV).locator('.spk-joins')).toHaveCount(0);
        for (const pid of [RADEGUNDA, BOHUCHVAL, ZBYHNEV, SPYTIHNEV]) await pickRow(picker, pid).locator('.spk-check').check();
        await picker.locator('#shared-picker-add').click();
        await expect(picker).not.toHaveClass(/active/);
        // The rows start with each record's own age.
        const age = (pid: string) => editor.locator(`.sw-row[data-pid="${pid}"] .sw-age-input`);
        await expect(age(RADEGUNDA)).toHaveValue('38');
        await expect(age(BOHUCHVAL)).toHaveValue('15');
        await expect(age(ZBYHNEV)).toHaveValue('11');
        await expect(age(SPYTIHNEV)).toHaveValue('');
        if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/S1-editor-pripojeni-1440.png` });

        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(editor).toBeHidden();
        // Radegunda's record cites another source: Unify, nothing overwritten.
        const unify = page.locator('#shared-unify-modal');
        await expect(unify).toHaveClass(/active/);
        await expect(unify.locator('#shared-unify-title')).toContainText('Census 1921');
        if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/S1-sjednotit-po-ulozeni-1440.png` });

        const shareId = (await censuses(page, SUDIVOJ))[0].shareId;
        expect(shareId).toBeTruthy();
        const radegunda = await censuses(page, RADEGUNDA);
        expect(radegunda.map(e => [e.id, e.shareId, e.age, e.sourceIds])).toEqual([['c_r', shareId, '38', ['s2']]]);
        expect((await censuses(page, BOHUCHVAL)).map(e => [e.id, e.shareId, e.age])).toEqual([['c_b', shareId, '15']]);
        expect((await censuses(page, ZBYHNEV)).map(e => [e.id, e.shareId, e.age])).toEqual([['c_z', shareId, '11']]);
        // Another day is another event: the own record stays, a new copy beside it.
        const spytihnev = await censuses(page, SPYTIHNEV);
        expect(spytihnev.map(e => [e.id === 'c_y', e.shareId ?? null, e.date])).toEqual([[true, null, '1921-02-16'], [false, shareId, '1921-02-15']]);

        // Closed without a choice: the difference stays for Data quality; one Undo restores everything.
        await page.keyboard.press('Escape');
        await expect(unify).not.toHaveClass(/active/);
        await page.keyboard.press('Escape');
        const pill = page.locator('.undo-toast');
        await expect(pill.locator('.undo-toast-msg').last()).toContainText('Census 1921');
        await pill.locator('.undo-toast-btn').last().click();
        expect(await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons))).toBe(before);
    });

    test('the same source and note: joined without Unify', async ({ page }) => {
        await tree(page, { sameSource: true });
        const { editor, picker } = await openPicker(page);
        await pickRow(picker, RADEGUNDA).locator('.spk-check').check();
        await picker.locator('#shared-picker-add').click();
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(editor).toBeHidden();
        await expect(page.locator('#shared-unify-modal')).not.toHaveClass(/active/);
        const shareId = (await censuses(page, SUDIVOJ))[0].shareId;
        expect((await censuses(page, RADEGUNDA)).map(e => [e.id, e.shareId, e.age])).toEqual([['c_r', shareId, '38']]);
    });
});

test.describe('the person picker\'s rows', () => {
    for (const width of [1440, 1024, 390]) {
        test(`German at ${width} px with a long name, light and dark: the checkbox beside the name, nothing overflows`, async ({ page }) => {
            await tree(page, { width, height: width === 390 ? 844 : 900, long: true });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                const { editor, picker } = await openPicker(page);
                await expect(pickRow(picker, BOHUCHVAL).locator('.spk-joins')).toHaveText('hat Volkszählung 1921 bereits – wird verbunden');
                for (const query of ['', 'Vrbi']) {
                    await picker.locator('#shared-picker-search').fill(query);
                    await expect(pickRow(picker, BOHUCHVAL)).toBeVisible();
                    const m = await picker.evaluate(el => {
                        const over = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)].map(x => x.scrollWidth - x.clientWidth);
                        const rows = [...el.querySelectorAll<HTMLElement>('.spk-row')].map(r => {
                            const box = r.querySelector('.spk-check')!.getBoundingClientRect();
                            const name = r.querySelector('.spk-name')!.getBoundingClientRect();
                            return {
                                display: getComputedStyle(r).display, height: r.getBoundingClientRect().height,
                                joins: !!r.querySelector('.spk-joins'),
                                beside: box.right <= name.left && box.top < name.bottom && box.bottom > name.top,
                            };
                        });
                        return { list: over('.spk-list'), group: over('.spk-group'), page: document.documentElement.scrollWidth - document.documentElement.clientWidth, rows };
                    });
                    expect(m.list.every(x => x <= 0), `list ${m.list}`).toBe(true);
                    expect(m.group.every(x => x <= 0), `group ${m.group}`).toBe(true);
                    expect(m.page).toBe(0);
                    expect(m.rows.length).toBeGreaterThan(0);
                    for (const r of m.rows) {
                        expect(r.display).toBe('flex');
                        expect(r.beside).toBe(true);
                        // One row of the name and its line: 48 px on a desktop (56 with a finger); the bug made it 64.
                        if (!r.joins) expect(r.height).toBeLessThanOrEqual(width === 390 ? 56 : 48);
                    }
                    if (process.env.SNIMKY_DIR) {
                        await page.screenshot({ path: `${process.env.SNIMKY_DIR}/S1-vyber-de-${width}-${scheme}${query ? '-hledani' : ''}.png` });
                    }
                }
                await picker.locator('.close-btn').click();
                await expect(picker).not.toHaveClass(/active/);
                await page.keyboard.press('Escape');
                await expect(editor).not.toHaveClass(/active/);
                await page.keyboard.press('Escape');
            }
        });
    }
});
