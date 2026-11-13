import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, personModal } from './helpers.js';

/**
 * A part at another's event recorded as an own event too (spec 085 §6,
 * K2.2): from the ⋯ of a derived row and from the menu of a linked
 * participant's chip ("in the tree ▾") in the baptism's editor and the
 * wedding witnesses' dialog, a prefilled editor of a new godparent / wedding
 * witness event (the date, the place, the same source, "For the baptism"
 * read only) is created only on Save; its line "for the baptism: …" in the
 * list, the derived row gone; Cancel creates nothing. A phone's chip is an
 * icon of 44 px; German at 1440/1024/390, light and dark, long names.
 * Invented data, a fixed clock.
 */

const SHOTS = process.env.STROM_SHOTS_DIR;

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
                    events: [{ id: 'ev_bap', type: 'baptism', date: '1890-04-03', place: long ? 'Zvonov u Lhoty pod Dubinou' : 'Zvonov',
                        sourceIds: ['s1'], citationQuay: { sourceIds: { s1: 3 } },
                        participants: [
                            { id: 'g1', role: 'godparent', name: 'Hostivít Mrákota', personId: 'p_hm' },
                            { id: 'g2', role: 'other', note: 'Midwife', name: 'Ludmila Kvapilová' },
                        ] }] }),
                p_do: p('p_do', 'Dobrohost', 'Ořešník', 'male', { birthDate: '1865', deathDate: '1930', partnerships: ['u1'] }),
                p_rp: p('p_rp', 'Radmila', 'Pšeničná', 'female', { birthDate: '1868', deathDate: '1940', partnerships: ['u1'] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_do', person2Id: 'p_rp', childIds: [], status: 'married', startDate: '1888-06-10', startPlace: 'Zvonov',
                    sourceIds: ['s2'], participants: [{ id: 'w1', role: 'witness', personId: 'p_hm' }] },
            },
            sources: {
                s1: { id: 's1', title: long ? 'Matrika narozených Zvonov u Lhoty pod Dubinou 1880–1895' : 'Matrika N Zvonov' },
                s2: { id: 's2', title: 'Matrika O Zvonov' },
            },
        } as never, long ? 'Rodokmen Pšeničných ze Zvonova 1850' : 'Zvonov');
    }, !!opts.long);
}

const editor = (page: Page) => page.locator('#event-editor-modal');
const menu = (page: Page) => page.locator('#shared-event-menu');
/** The newest Undo toast. */
const toast = (page: Page) => page.locator('.undo-toast .undo-toast-msg').last();
const eventsOf = (page: Page, id: string) => page.evaluate(pid =>
    window.Strom.DataManager.getPerson(pid as never)?.events ?? [], id);

async function noOverflow(scope: Locator): Promise<void> {
    const over = await scope.evaluate(el => {
        const content = (el.querySelector('.modal-content') ?? el) as HTMLElement;
        return Math.max(content.scrollWidth - content.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    });
    expect(over).toBe(0);
}

async function shot(page: Page, name: string): Promise<void> {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe('a part recorded as an own event', () => {
    test('⋯ of the derived row: the prefilled editor, Save makes the own event with the line, the derived row goes', async ({ page }) => {
        await village(page);
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_hm' as never));
        const modal = personModal(page);
        await modal.locator('.event-row.derived', { hasText: 'Godparent' }).locator('.derived-more').click();
        await expect(menu(page).locator('.sw-menu-label')).toHaveText(['Open baptism (Bolemír Pšeničný)', 'Also record as an own event']);
        await expect(menu(page).locator('.sw-menu-hint')).toHaveText(['Creates a godparent event linked to the baptism, with the same source.']);
        await menu(page).getByRole('menuitem', { name: /Also record/ }).click();

        const ed = editor(page);
        await expect(ed).toHaveClass(/active/);
        await expect(ed.locator('#event-prefill-bar')).toHaveText('Prefilled from the baptism. Later changes to the baptism are not carried over.');
        await expect(ed.locator('#input-event-type')).toHaveValue('godparent');
        await expect(ed.locator('#input-event-type')).toBeDisabled();
        await expect(ed.locator('#input-event-place')).toHaveValue('Zvonov');
        await expect(ed.locator('#event-roleat-label')).toHaveText('For the baptism');
        await expect(ed.locator('#event-roleat-value')).toContainText('Bolemír Pšeničný');
        await expect(ed.locator('#event-sources-chips .source-chip')).toHaveCount(1);
        await expect(ed.locator('#event-participants-section')).toBeHidden();
        await expect(ed.locator('#event-shared-section')).toBeHidden();
        await ed.getByRole('button', { name: 'Save' }).click();
        await expect(ed).not.toHaveClass(/active/);
        await expect(toast(page)).toHaveText('Godparent: saved for Hostivít Mrákota.');

        const own = (await eventsOf(page, 'p_hm')).find((e: { type: string }) => e.type === 'godparent');
        expect(own).toMatchObject({
            date: '1890-04-03', place: 'Zvonov', sourceIds: ['s1'], citationQuay: { sourceIds: { s1: 3 } },
            roleAt: { role: 'godparent', personId: 'p_bp', eventType: 'baptism', eventId: 'ev_bap' },
        });
        const rows = modal.locator('#events-list .event-row');
        await expect(rows.locator('.event-type, .derived-head')).toHaveText([
            'Birth', 'Witness · marriage: Dobrohost Ořešník and Radmila Pšeničná', 'Residence', 'Godparent', 'Death',
        ]);
        await expect(rows.filter({ hasText: 'Godparent' }).locator('.ref-line')).toHaveText('for the baptism: Bolemír Pšeničný');
        // Opened again: the field read only, no prefill bar, the type free.
        await rows.filter({ hasText: 'Godparent' }).locator('.event-edit-btn').click();
        await expect(ed.locator('#event-roleat-group')).toBeVisible();
        await expect(ed.locator('#event-roleat-value')).toContainText('Bolemír Pšeničný');
        await expect(ed.locator('#event-prefill-bar')).toBeHidden();
        await expect(ed.locator('#input-event-type')).toBeEnabled();
    });

    test('Cancel creates nothing, and the next new event is an ordinary one', async ({ page }) => {
        await village(page);
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_hm' as never));
        const modal = personModal(page);
        await modal.locator('.event-row.derived', { hasText: 'Godparent' }).locator('.derived-more').click();
        await menu(page).getByRole('menuitem', { name: /Also record/ }).click();
        const ed = editor(page);
        await expect(ed.locator('#event-prefill-bar')).toBeVisible();
        await ed.getByRole('button', { name: 'Cancel' }).click();
        await expect(ed).not.toHaveClass(/active/);
        await expect(page.locator('#unsaved-editor-modal.active, .unsaved-dialog.active')).toHaveCount(0);
        expect((await eventsOf(page, 'p_hm')).map((e: { id: string }) => e.id)).toEqual(['ev_res']);
        await expect(modal.locator('.event-row.derived', { hasText: 'Godparent' })).toHaveCount(1);
        await page.evaluate(() => window.Strom.UI.showAddEventModal());
        await expect(ed.locator('#event-prefill-bar')).toBeHidden();
        await expect(ed.locator('#event-roleat-group')).toBeHidden();
        await expect(ed.locator('#input-event-type')).toBeEnabled();
        await expect(ed.locator('#input-event-type')).toHaveValue('baptism');
    });

    test('the chip of a linked godparent in the baptism\'s editor: ▾ menu; record, unlink', async ({ page }) => {
        await village(page);
        await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_bp' as never, 'ev_bap'));
        const ed = editor(page);
        await expect(ed).toHaveClass(/active/);
        const rows = ed.locator('.participant-row');
        const chip = rows.first().locator('.participant-link');
        await expect(chip).toHaveText('in the tree▾');
        await expect(chip).toHaveAttribute('aria-haspopup', 'menu');
        // The midwife by name keeps the chain button that links.
        await expect(rows.nth(1).locator('.participant-link')).toHaveText('');
        await chip.click();
        await expect(chip).toHaveAttribute('aria-expanded', 'true');
        await expect(menu(page).locator('.sw-menu-title')).toHaveText('Hostivít Mrákota');
        await expect(menu(page).locator('.sw-menu-label')).toHaveText(['Open person', 'Also record as an own event', 'Unlink']);
        await shot(page, 'G2-chip-menu-en-1440');
        await menu(page).getByRole('menuitem', { name: 'Unlink' }).click();
        await expect(rows.first().locator('.participant-name')).toHaveValue('Hostivít Mrákota');
        await expect(rows.first().locator('.participant-name')).toBeEditable();
        await expect(rows.first().locator('.participant-link')).not.toHaveClass(/linked/);
        // Unlinked only in the editor: Cancel (and discard) keeps the link.
        await ed.getByRole('button', { name: 'Cancel' }).click();
        await page.getByRole('button', { name: /Discard|Don.t save/ }).click();
        await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_bp' as never, 'ev_bap'));
        await chip.click();
        await menu(page).getByRole('menuitem', { name: /Also record/ }).click();
        // The editor of a new event at Hostivít, over his dialog.
        await expect(ed.locator('#event-prefill-bar')).toBeVisible();
        await expect(personModal(page).locator('#events-list')).toContainText('Residence');
        await ed.getByRole('button', { name: 'Save' }).click();
        expect((await eventsOf(page, 'p_hm')).map((e: { type: string }) => e.type)).toEqual(['residence', 'godparent']);
        await expect(personModal(page).locator('.event-row.derived', { hasText: 'Godparent' })).toHaveCount(0);
    });

    test('the chip of a witness in the wedding witnesses\' dialog: record as a wedding witness event', async ({ page }) => {
        await village(page);
        await page.evaluate(() => { window.Strom.UI.showRelationshipsPanel('p_do' as never); window.Strom.UI.showWeddingWitnesses('u1' as never); });
        const dlg = page.locator('#wedding-witnesses-modal');
        await expect(dlg).toHaveClass(/active/);
        const chip = dlg.locator('.participant-link.linked');
        await chip.click();
        await expect(menu(page).locator('.sw-menu-label')).toHaveText(['Open person', 'Also record as an own event', 'Unlink']);
        await expect(menu(page).locator('.sw-menu-hint')).toHaveText(['Creates a wedding-witness event linked to the marriage, with the same source.']);
        await menu(page).getByRole('menuitem', { name: /Also record/ }).click();
        await expect(dlg).not.toHaveClass(/active/);
        await expect(page.locator('#relationships-modal')).not.toHaveClass(/active/);
        const ed = editor(page);
        await expect(ed.locator('#event-prefill-bar')).toHaveText('Prefilled from the marriage. Later changes to the marriage are not carried over.');
        await expect(ed.locator('#input-event-type')).toHaveValue('weddingWitness');
        await expect(ed.locator('#event-roleat-label')).toHaveText('For the marriage');
        await expect(ed.locator('#event-roleat-value')).toContainText('Dobrohost Ořešník and Radmila Pšeničná');
        await ed.getByRole('button', { name: 'Save' }).click();
        await expect(toast(page)).toHaveText('Wedding witness: saved for Hostivít Mrákota.');
        const row = personModal(page).locator('#events-list .event-row', { hasText: 'Wedding witness' });
        await expect(row.locator('.ref-line')).toHaveText('for the marriage: Dobrohost Ořešník and Radmila Pšeničná');
        await expect(personModal(page).locator('.event-row.derived', { hasText: 'Witness' })).toHaveCount(0);
    });

    test('a phone: the chip is an icon of 44 px and its menu spans the row', async ({ page }) => {
        await village(page, { width: 390, height: 844 });
        await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_bp' as never, 'ev_bap'));
        const ed = editor(page);
        const row = ed.locator('.participant-row').first();
        const chip = row.locator('.participant-link');
        await expect(chip.locator('.participant-link-text')).toBeHidden();
        const cb = await chip.boundingBox();
        expect(Math.round(cb!.width)).toBe(44);
        expect(Math.round(cb!.height)).toBe(44);
        await chip.click();
        const mb = await menu(page).boundingBox();
        const rb = await row.boundingBox();
        expect(Math.abs(mb!.width - rb!.width)).toBeLessThanOrEqual(1);
        await noOverflow(ed);
        await shot(page, 'G2-chip-menu-en-390');
    });

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark, long names: the chip, the prefilled editor and the line without overflow`, async ({ page }) => {
            await village(page, { width, height: width === 390 ? 844 : 900, long: true });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            const ed = editor(page);
            const modal = personModal(page);
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                // The chip's menu in the baptism's editor.
                await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_bp' as never, 'ev_bap'));
                const chip = ed.locator('.participant-link.linked');
                await chip.scrollIntoViewIfNeeded();
                await chip.click();
                await expect(menu(page).locator('.sw-menu-label')).toHaveText(['Person öffnen', 'Auch als eigenes Ereignis eintragen', 'Verknüpfung lösen']);
                const mb = await menu(page).boundingBox();
                expect(mb!.x).toBeGreaterThanOrEqual(0);
                expect(mb!.x + mb!.width).toBeLessThanOrEqual(width);
                await noOverflow(ed);
                await shot(page, `G2-chip-de-${width}-${scheme}`);
                // The prefilled editor.
                await menu(page).getByRole('menuitem', { name: /Auch als eigenes/ }).click();
                await expect(ed.locator('#event-prefill-bar')).toHaveText('Nach der Taufe vorausgefüllt. Spätere Änderungen der Taufe werden nicht übernommen.');
                await expect(ed.locator('#event-roleat-label')).toHaveText('Zur Taufe');
                await noOverflow(ed);
                const c = await ed.locator('.modal-content').boundingBox();
                for (const sel of ['#event-prefill-bar', '#event-roleat-value', '#event-sources-chips']) {
                    const b = await ed.locator(sel).boundingBox();
                    expect(b!.x + b!.width).toBeLessThanOrEqual(c!.x + c!.width + 0.5);
                }
                await shot(page, `G2-prefilled-de-${width}-${scheme}`);
                // Saved: the line in the list.
                await ed.getByRole('button', { name: 'Speichern' }).click();
                await expect(ed).not.toHaveClass(/active/);
                const own = modal.locator('#events-list .event-row', { hasText: 'Patenschaft' });
                await expect(own.locator('.ref-line')).toHaveText('zur Taufe: Bolemír Svatoboj Ctibor Pšeničný-Zvonovský');
                await own.scrollIntoViewIfNeeded();
                await noOverflow(modal);
                const lb = await own.locator('.ref-line').boundingBox();
                const rb = await own.boundingBox();
                expect(lb!.x + lb!.width).toBeLessThanOrEqual(rb!.x + rb!.width + 0.5);
                await shot(page, `G2-list-de-${width}-${scheme}`);
                // Recorded once: the chip no longer offers it; the record goes for the next round.
                await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_bp' as never, 'ev_bap'));
                await chip.click();
                await expect(menu(page).locator('.sw-menu-label')).toHaveText(['Person öffnen', 'Verknüpfung lösen']);
                await page.keyboard.press('Escape');
                await page.evaluate(() => {
                    window.Strom.UI.forceCloseEventEditor();
                    const dm = window.Strom.DataManager;
                    const ev = dm.getPerson('p_hm' as never)!.events!.find((e: { type: string }) => e.type === 'godparent')!;
                    dm.removeLifeEvent('p_hm' as never, ev.id);
                });
            }
            expect((await eventsOf(page, 'p_hm')).map((e: { id: string }) => e.id)).toEqual(['ev_res']);
        });
    }
});
