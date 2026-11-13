import { test, expect, Page } from '@playwright/test';
import { openApp, cardAction, personModal } from './helpers.js';

/**
 * A person's part at another's event in their own life (spec 085 §5): the
 * derived rows in the person dialog's list of events (among the own events
 * by date, ⋯ on the right) and in the life on the person page with the
 * summary "Godparent and witness for"; a row opens the event where it is
 * kept (the baptism at the child, the wedding in its witnesses' dialog);
 * German at 1440/1024/390, light and dark, with long names. Invented data,
 * a fixed clock.
 */

/** Hostivít stood godfather at Bolemír's baptism and witnessed the wedding of Dobrohost and Radmila. */
async function village(page: Page, opts: { width?: number; height?: number; long?: boolean } = {}): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-11-13T10:30:00Z'));
    await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
    await openApp(page);
    await page.evaluate(async (long) => {
        const p = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                p_hm: p('p_hm', long ? 'Hostivít Bonifác Drahoslav' : 'Hostivít', long ? 'Mrákota-Zvonovský' : 'Mrákota', 'male', {
                    birthDate: '1850', deathDate: '1920',
                    events: [{ id: 'ev_res', type: 'residence', date: '1889', place: 'Zvonov' }] }),
                p_bp: p('p_bp', long ? 'Bolemír Svatoboj Ctibor' : 'Bolemír', long ? 'Pšeničný-Zvonovský' : 'Pšeničný', 'male', {
                    birthDate: '1890-04-02', deathDate: '1950',
                    events: [{ id: 'ev_bap', type: 'baptism', date: '1890-04-03', place: 'Zvonov', participants: [
                        { id: 'g1', role: 'godparent', name: 'Hostivít Mrákota', personId: 'p_hm' },
                    ] }] }),
                p_do: p('p_do', 'Dobrohost', 'Ořešník', 'male', { birthDate: '1865', deathDate: '1930', partnerships: ['u1'] }),
                p_rp: p('p_rp', 'Radmila', 'Pšeničná', 'female', { birthDate: '1868', deathDate: '1940', partnerships: ['u1'] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_do', person2Id: 'p_rp', childIds: [], status: 'married', startDate: '1888-06-10', startPlace: 'Zvonov',
                    participants: [{ id: 'w1', role: 'witness', personId: 'p_hm' }] },
            },
        } as never, long ? 'Rodokmen Pšeničných ze Zvonova 1850' : 'Zvonov');
    }, !!opts.long);
}

test.describe('a part at another\'s event in one\'s own life', () => {
    test('the list of events: rows among the own events by date, the baptism opens at the child, the wedding its witnesses', async ({ page }) => {
        await village(page);
        await cardAction(page, 'Hostivít', 'edit');
        const modal = personModal(page);
        const rows = modal.locator('#events-list .event-row');
        await expect(rows.locator('.event-type, .derived-head')).toHaveText([
            'Birth', 'Witness · marriage: Dobrohost Ořešník and Radmila Pšeničná', 'Residence', 'Godparent · baptism: Bolemír Pšeničný', 'Death',
        ]);
        const bap = modal.locator('.event-row.derived', { hasText: 'Godparent' });
        await expect(bap.locator('.derived-meta')).toHaveText(/1890 · Zvonov/);
        await expect(bap.locator('.derived-mark svg')).toHaveCount(1);
        await expect(bap.locator('.fact-status')).toHaveCount(0);
        const more = bap.locator('.derived-more');
        const mb = await more.boundingBox();
        expect(mb!.width).toBeGreaterThanOrEqual(32);
        expect(mb!.height).toBeGreaterThanOrEqual(32);
        // ⋯: open the baptism.
        await more.click();
        const menu = page.locator('#shared-event-menu');
        await expect(menu.locator('.sw-menu-label')).toHaveText(['Open baptism (Bolemír Pšeničný)', 'Also record as an own event']);
        await menu.getByRole('menuitem').first().click();
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await expect(editor.locator('#event-editor-subtitle')).toHaveText('Bolemír Pšeničný · * 1890');
        await page.keyboard.press('Escape');
        await expect(editor).not.toHaveClass(/active/);

        // The wedding: its witnesses' dialog.
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_hm' as never));
        await modal.locator('.event-row.derived', { hasText: 'Witness' }).click();
        const witnesses = page.locator('#wedding-witnesses-modal');
        await expect(witnesses).toHaveClass(/active/);
        await expect(witnesses.locator('.participant-row')).toHaveCount(1);
    });

    test('the person page: the life\'s rows open the baptism at the child; the summary names each role', async ({ page }) => {
        await village(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('p_hm' as never));
        const w = page.locator('#person-page-modal');
        await expect(w).toBeVisible();
        await expect(w.locator('.pp-row--part .pp-t')).toHaveText([
            /^Witness · marriage: Dobrohost Ořešník and Radmila Pšeničná · Zvonov/,
            /^Godparent · baptism: Bolemír Pšeničný · Zvonov/,
        ]);
        const people = w.locator('.pp-people-row', { hasText: 'Godparent and witness for' });
        await expect(people.locator('li')).toHaveText([
            'Dobrohost Ořešník and Radmila Pšeničná · witness · marriage 1888',
            ' · Bolemír Pšeničný · godparent · baptism 1890',
        ]);
        await w.locator('.pp-part-open', { hasText: 'Godparent' }).click();
        await expect(w).toBeHidden();
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await expect(editor.locator('#event-editor-subtitle')).toHaveText('Bolemír Pšeničný · * 1890');
    });

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark, long names: no overflow`, async ({ page }) => {
            await village(page, { width, height: width === 390 ? 844 : 900, long: true });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_hm' as never));
                const modal = personModal(page);
                const row = modal.locator('.event-row.derived', { hasText: 'Pate' });
                await expect(row.locator('.derived-head')).toHaveText('Pate · Taufe: Bolemír Svatoboj Ctibor Pšeničný-Zvonovský');
                await row.scrollIntoViewIfNeeded();
                const over = await modal.evaluate(el => {
                    const content = el.querySelector('.modal-content') as HTMLElement;
                    return Math.max(content.scrollWidth - content.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth);
                });
                expect(over).toBe(0);
                const rb = await row.boundingBox();
                const more = await row.locator('.derived-more').boundingBox();
                const cb = await modal.locator('.modal-content').boundingBox();
                expect(rb!.x + rb!.width).toBeLessThanOrEqual(cb!.x + cb!.width + 0.5);
                // The ⋯ stays inside the row, clear of the text.
                const head = await row.locator('.derived-head').boundingBox();
                expect(more!.x).toBeGreaterThanOrEqual(head!.x + head!.width - 0.5);
                expect(more!.x + more!.width).toBeLessThanOrEqual(rb!.x + rb!.width + 0.5);
                if (width === 390) expect(more!.width).toBeGreaterThanOrEqual(44);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/G-events-de-${width}-${scheme}.png` });
                await page.keyboard.press('Escape');
                await expect(modal).toBeHidden();

                await page.evaluate(() => window.Strom.UI.showPersonPage('p_hm' as never));
                const w = page.locator('#person-page-modal');
                const part = w.locator('.pp-row--part', { hasText: 'Pate' });
                await expect(part).toBeVisible();
                await part.scrollIntoViewIfNeeded();
                expect(await part.evaluate(el => {
                    const art = el.closest('article.pp') as HTMLElement;
                    return Math.max(el.getBoundingClientRect().right - art.getBoundingClientRect().right, el.scrollWidth - el.clientWidth,
                        document.documentElement.scrollWidth - document.documentElement.clientWidth);
                })).toBeLessThanOrEqual(0);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/G-page-de-${width}-${scheme}.png` });
                const people = w.locator('.pp-people-row', { hasText: 'Pate und Zeuge bei' });
                await people.scrollIntoViewIfNeeded();
                expect(await people.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/G-people-de-${width}-${scheme}.png` });
                await page.keyboard.press('Escape');
                await expect(w).toBeHidden();
            }
        });
    }
});
