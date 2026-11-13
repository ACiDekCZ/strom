import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, personModal } from './helpers.js';

/**
 * A godparent or a witness recorded by name who is probably someone in the
 * tree (spec 085 §6, K1.4): in the baptism's editor a grey bar under the row
 * (one candidate: Link · Not this person; two, a father and a son of the same
 * name: both with Link and None of them), a rejection kept after reopening,
 * Link keeping the written name and giving the person the derived row; the
 * same in the wedding witnesses' dialog; the trace of Data quality with its
 * list (Link, Not this person, Later, the rejected count). A phone at 390,
 * German at 1440/1024/390, light and dark, long names. Invented data, a
 * fixed clock.
 */

const SHOTS = process.env.SNIMKY_DIR;

/**
 * Vojmír's baptism (1895) names Radslav Křemínek — the father (1838) and the
 * son (1866) are both in the tree, the grandson (1890) too young — and
 * Zdislava Bělohoubková, once in the tree; she is also named a witness at
 * the wedding of Ctislav and Zbyhněva (1893).
 */
async function village(page: Page, opts: { width?: number; height?: number; long?: boolean } = {}): Promise<string> {
    await page.clock.setFixedTime(new Date('2026-11-13T10:30:00Z'));
    await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
    await openApp(page);
    return page.evaluate(async (long) => {
        const p = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        const rk = long ? ['Radslav Bořivoj Ctimír', 'Křemínek-Zvonovský'] : ['Radslav', 'Křemínek'];
        const zb = long ? ['Zdislava Dobroslava', 'Bělohoubková-Lánská'] : ['Zdislava', 'Bělohoubková'];
        const place = long ? 'Zvonov u Lhoty pod Dubinou' : 'Zvonov';
        const S = window.Strom;
        const id = await S.DataManager.importAsNewTree({
            persons: {
                p_vu: p('p_vu', long ? 'Vojmír Svatoboj' : 'Vojmír', long ? 'Úlehla-Zvonovský' : 'Úlehla', 'male', {
                    birthDate: '1895-03-10', deathDate: '1960', parentIds: ['p_cu', 'p_zl'],
                    events: [{ id: 'ev_bap', type: 'baptism', date: '1895-03-12', place,
                        participants: [
                            { id: 'g1', role: 'godparent', name: rk.join(' ') },
                            { id: 'g2', role: 'godparent', name: zb.join(' ') },
                        ] }] }),
                p_rk1: p('p_rk1', rk[0], rk[1], 'male', { birthDate: '1838', deathDate: '1910', birthPlace: place, birthAddress: 'č. 9' }),
                p_rk2: p('p_rk2', rk[0], rk[1], 'male', { birthDate: '1866', deathDate: '1930', birthPlace: place, birthAddress: 'č. 9' }),
                p_rk3: p('p_rk3', rk[0], rk[1], 'male', { birthDate: '1890', deathDate: '1970' }),
                p_zb: p('p_zb', zb[0], zb[1], 'female', { birthDate: '1860', deathDate: '1925', birthPlace: place, birthAddress: 'č. 14' }),
                p_cu: p('p_cu', 'Ctislav', 'Úlehla', 'male', { birthDate: '1862', deathDate: '1931', partnerships: ['u1'], childIds: ['p_vu'] }),
                p_zl: p('p_zl', 'Zbyhněva', 'Lánská', 'female', { birthDate: '1868', deathDate: '1940', partnerships: ['u1'], childIds: ['p_vu'] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_cu', person2Id: 'p_zl', childIds: ['p_vu'], status: 'married', startDate: '1893-05-20', startPlace: place,
                    participants: [{ id: 'w1', role: 'witness', name: zb.join(' ') }] },
            },
        } as never, long ? 'Rodokmen Úlehlů ze Zvonova u Lhoty 1830' : 'Zvonov');
        S.UI.updateTreeSwitcher?.();
        await S.TreeRenderer.renderAsync();
        return id as string;
    }, !!opts.long);
}

const editor = (page: Page) => page.locator('#event-editor-modal');
const witnessesDialog = (page: Page) => page.locator('#wedding-witnesses-modal');
const quality = (page: Page) => page.locator('#tree-validation-modal');
const toast = (page: Page) => page.locator('.toast').last();
const participantsOf = (page: Page) => page.evaluate(() =>
    window.Strom.DataManager.getPerson('p_vu' as never)!.events!.find((e: { id: string }) => e.id === 'ev_bap')!.participants);
const witnessesOf = (page: Page) => page.evaluate(() =>
    window.Strom.DataManager.getPartnership('u1' as never)!.participants);

async function noOverflow(scope: Locator): Promise<void> {
    const over = await scope.evaluate(el => {
        const content = (el.querySelector('.modal-content') ?? el) as HTMLElement;
        return Math.max(content.scrollWidth - content.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    });
    expect(over).toBe(0);
}

/** Each box lies inside the dialog's content (nothing sticks out on the right). */
async function inside(scope: Locator, items: Locator): Promise<void> {
    const c = await scope.locator('.modal-content').boundingBox();
    for (const box of await items.all()) {
        const b = await box.boundingBox();
        if (!b) continue;
        expect(b.x).toBeGreaterThanOrEqual(c!.x - 0.5);
        expect(b.x + b.width).toBeLessThanOrEqual(c!.x + c!.width + 0.5);
    }
}

async function shot(page: Page, name: string): Promise<void> {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openBaptism(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_vu' as never, 'ev_bap'));
    const ed = editor(page);
    await expect(ed).toHaveClass(/active/);
    return ed;
}

async function openWitnesses(page: Page): Promise<Locator> {
    await page.evaluate(() => { window.Strom.UI.showRelationshipsPanel('p_cu' as never); window.Strom.UI.showWeddingWitnesses('u1' as never); });
    const dlg = witnessesDialog(page);
    await expect(dlg).toHaveClass(/active/);
    return dlg;
}

async function openQuality(page: Page, treeId: string): Promise<Locator> {
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);
    const modal = quality(page);
    await expect(modal).toBeVisible();
    return modal;
}

test.describe('link a participant recorded by name', () => {
    test('the baptism\'s editor: two candidates and one, Not this person kept after reopening, Link keeps the name', async ({ page }) => {
        await village(page);
        const ed = await openBaptism(page);
        const rows = ed.locator('.participant-row');
        const many = rows.nth(0).locator('.participant-offer');
        const one = rows.nth(1).locator('.participant-offer');

        // Two of the same name (the grandson too young then), the elder first.
        await expect(many).toHaveClass(/is-many/);
        await expect(many.locator('.participant-offer-text')).toHaveText('2 people named Radslav Křemínek are in the tree – link?');
        await expect(many.locator('.participant-offer-cand .participant-offer-meta')).toHaveText(['* 1838 · Zvonov č. 9', '* 1866 · Zvonov č. 9']);
        await expect(many.locator('.participant-offer-none')).toHaveText('None of them');
        // One: Link · Not this person.
        await expect(one.locator('.participant-offer-text')).toHaveText('Zdislava Bělohoubková (* 1860, Zvonov č. 14) is in the tree – link?');
        await expect(one.getByRole('button')).toHaveText(['Link', 'Not this person']);
        await shot(page, 'G3-editor-en-1440');

        await one.getByRole('button', { name: 'Not this person' }).click();
        await expect(one).toHaveCount(0);
        await expect(rows.nth(1).locator('.participant-name')).toHaveValue('Zdislava Bělohoubková');
        // Link the son: the row is linked, the written name stays in the record.
        await many.getByRole('button', { name: 'Link: Radslav Křemínek * 1866 · Zvonov č. 9' }).click();
        await expect(toast(page)).toHaveText('Linked: Radslav Křemínek.');
        await expect(rows.nth(0).locator('.participant-link')).toHaveClass(/linked/);
        await expect(rows.nth(0).locator('.participant-offer')).toHaveCount(0);
        // Nothing is stored before Save.
        expect((await participantsOf(page))!.map((x: { personId?: string }) => x.personId ?? null)).toEqual([null, null]);
        await ed.getByRole('button', { name: 'Save' }).click();
        await expect(ed).not.toHaveClass(/active/);
        expect(await participantsOf(page)).toEqual([
            { id: 'g1', role: 'godparent', name: 'Radslav Křemínek', personId: 'p_rk2' },
            { id: 'g2', role: 'godparent', name: 'Zdislava Bělohoubková', linkRejected: ['p_zb'] },
        ]);

        // Opened again: no offer for the rejected one.
        await openBaptism(page);
        await expect(ed.locator('.participant-offer')).toHaveCount(0);
        // A row typed now: folded diacritics, the one linked in the event left out.
        await ed.getByRole('button', { name: '+ Add', exact: true }).click();
        const typed = rows.last();
        await typed.locator('.participant-name').fill('radslav kreminek');
        await expect(typed.locator('.participant-offer-text')).toHaveText('Radslav Křemínek (* 1838, Zvonov č. 9) is in the tree – link?');
        await typed.locator('.participant-name').fill('Radslav');
        await expect(typed.locator('.participant-offer')).toHaveCount(0);
        await ed.getByRole('button', { name: 'Cancel' }).click();
        await page.getByRole('button', { name: /Discard|Don.t save/ }).click();

        // The son has the derived row in his life.
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_rk2' as never));
        await expect(personModal(page).locator('.event-row.derived .derived-head')).toHaveText(['Godparent · baptism: Vojmír Úlehla']);
    });

    test('the wedding witnesses\' dialog: one candidate, Link, the derived row', async ({ page }) => {
        await village(page);
        const dlg = await openWitnesses(page);
        const offer = dlg.locator('.participant-row').first().locator('.participant-offer');
        await expect(offer.locator('.participant-offer-text')).toHaveText('Zdislava Bělohoubková (* 1860, Zvonov č. 14) is in the tree – link?');
        await shot(page, 'G3-witnesses-en-1440');
        await offer.getByRole('button', { name: 'Link' }).click();
        await expect(toast(page)).toHaveText('Linked: Zdislava Bělohoubková.');
        await expect(dlg.locator('.participant-link.linked')).toHaveCount(1);
        await dlg.getByRole('button', { name: 'Save' }).click();
        await expect(dlg).toBeHidden();
        await page.locator('#relationships-modal').getByRole('button', { name: 'Save' }).click();
        expect(await witnessesOf(page)).toEqual([{ id: 'w1', role: 'witness', name: 'Zdislava Bělohoubková', personId: 'p_zb' }]);
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_zb' as never));
        await expect(personModal(page).locator('.event-row.derived .derived-head'))
            .toHaveText(['Witness · marriage: Ctislav Úlehla and Zbyhněva Lánská']);
    });

    test('Data quality: the trace, the list with Later, Link and Not this person, the rejected count', async ({ page }) => {
        const treeId = await village(page);
        let modal = await openQuality(page, treeId);
        const trace = modal.locator('.vq-namelink');
        await expect(trace.locator('.vq-namelink-lead-text')).toHaveText('3 godparents and witnesses recorded by name match a person in the tree.');
        await shot(page, 'G3-quality-trace-en-1440');
        await trace.getByRole('button', { name: 'Review one by one' }).click();

        const items = modal.locator('.vq-namelink-item');
        await expect(modal.locator('.vq-namelink-title')).toHaveText('Godparents and witnesses by name who are probably in the tree · 3');
        await expect(items.locator('.vq-namelink-name')).toHaveText(['Radslav Křemínek', 'Zdislava Bělohoubková', 'Zdislava Bělohoubková']);
        await expect(items.nth(0).locator('.vq-namelink-where')).toHaveText('Godparent · baptism: Vojmír Úlehla, 12 Mar 1895');
        await expect(items.nth(2).locator('.vq-namelink-where')).toHaveText('Witness · marriage: Ctislav Úlehla and Zbyhněva Lánská, 20 May 1893');
        await expect(items.nth(0).locator('.vq-namelink-reject')).toHaveText('None of them');
        await expect(items.nth(1).locator('.vq-namelink-reject')).toHaveText('Not this person');
        await expect(modal.locator('.vq-namelink-rejected')).toHaveCount(0);
        await shot(page, 'G3-quality-list-en-1440');

        // Later: hidden until the dialog closes.
        await items.nth(0).getByRole('button', { name: 'Later' }).click();
        await expect(modal.locator('.vq-namelink-title')).toHaveText('Godparents and witnesses by name who are probably in the tree · 2');
        // Link the wedding's witness: saved at once, the name kept.
        await items.nth(1).getByRole('button', { name: /^Link/ }).click();
        await expect(items).toHaveCount(1);
        expect(await witnessesOf(page)).toEqual([{ id: 'w1', role: 'witness', name: 'Zdislava Bělohoubková', personId: 'p_zb' }]);
        // Not this person: kept, counted below, not offered again.
        await items.nth(0).getByRole('button', { name: 'Not this person' }).click();
        await expect(items).toHaveCount(0);
        await expect(modal.locator('.vq-namelink-rejected')).toHaveText('Rejected ones are not offered again (1).');
        expect((await participantsOf(page))![1]).toMatchObject({ linkRejected: ['p_zb'] });

        // Back: one left (the one put off), the count with the other findings.
        await modal.getByRole('button', { name: /Back/ }).click();
        await expect(trace.locator('.vq-namelink-lead-text')).toHaveText('1 godparent or witness recorded by name matches a person in the tree.');
        // Reopened: Later is forgotten.
        await page.evaluate(() => window.Strom.UI.closeTreeValidationDialog());
        modal = await openQuality(page, treeId);
        await modal.locator('.vq-namelink').getByRole('button', { name: 'Review one by one' }).click();
        await expect(modal.locator('.vq-namelink-item .vq-namelink-name')).toHaveText(['Radslav Křemínek']);
        await expect(modal.locator('.vq-namelink-rejected')).toHaveText('Rejected ones are not offered again (1).');
    });

    test('a phone: the bar\'s buttons span it, 44 px; the list too', async ({ page }) => {
        const treeId = await village(page, { width: 390, height: 844 });
        const ed = await openBaptism(page);
        const one = ed.locator('.participant-row').nth(1).locator('.participant-offer');
        await one.scrollIntoViewIfNeeded();
        const bar = await one.boundingBox();
        for (const btn of await one.getByRole('button').all()) {
            const b = await btn.boundingBox();
            expect(Math.round(b!.height)).toBeGreaterThanOrEqual(44);
            expect(b!.width).toBeGreaterThan(bar!.width - 24);
        }
        await noOverflow(ed);
        await shot(page, 'G3-editor-en-390');
        await page.evaluate(() => window.Strom.UI.forceCloseEventEditor());

        const modal = await openQuality(page, treeId);
        await modal.locator('.vq-namelink').getByRole('button', { name: 'Review one by one' }).click();
        const item = modal.locator('.vq-namelink-item').first();
        for (const btn of await item.getByRole('button').all()) {
            const b = await btn.boundingBox();
            expect(Math.round(b!.height)).toBeGreaterThanOrEqual(44);
        }
        await noOverflow(modal);
        await shot(page, 'G3-quality-list-en-390');
    });

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark, long names: the bar, the witnesses and the list without overflow`, async ({ page }) => {
            const treeId = await village(page, { width, height: width === 390 ? 844 : 900, long: true });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                const ed = await openBaptism(page);
                const offers = ed.locator('.participant-offer');
                await expect(offers).toHaveCount(2);
                await expect(offers.first().locator('.participant-offer-text'))
                    .toHaveText('2 Personen namens Radslav Bořivoj Ctimír Křemínek-Zvonovský sind im Stammbaum – verknüpfen?');
                await expect(offers.nth(1).getByRole('button')).toHaveText(['Verknüpfen', 'Nicht diese Person']);
                await offers.first().scrollIntoViewIfNeeded();
                await noOverflow(ed);
                await inside(ed, ed.locator('.participant-offer, .participant-offer button'));
                await shot(page, `G3-editor-de-${width}-${scheme}`);
                await page.evaluate(() => window.Strom.UI.forceCloseEventEditor());

                const dlg = await openWitnesses(page);
                await expect(dlg.locator('.participant-offer')).toHaveCount(1);
                await noOverflow(dlg);
                await inside(dlg, dlg.locator('.participant-offer, .participant-offer button'));
                await shot(page, `G3-witnesses-de-${width}-${scheme}`);
                await page.evaluate(() => { window.Strom.UI.forceCloseWeddingWitnesses(); window.Strom.UI.closeRelationshipsPanel(); });

                const modal = await openQuality(page, treeId);
                await expect(modal.locator('.vq-namelink-lead-text')).toHaveText('3 namentlich eingetragene Paten und Zeugen entsprechen einer Person im Stammbaum.');
                await noOverflow(modal);
                await shot(page, `G3-quality-trace-de-${width}-${scheme}`);
                await modal.getByRole('button', { name: 'Einzeln durchgehen' }).click();
                await expect(modal.locator('.vq-namelink-item')).toHaveCount(3);
                await expect(modal.locator('.vq-namelink-later').first()).toHaveText('Später');
                await noOverflow(modal);
                await inside(modal, modal.locator('.vq-namelink-item, .vq-namelink-item button'));
                await shot(page, `G3-quality-list-de-${width}-${scheme}`);
                await page.evaluate(() => window.Strom.UI.closeTreeValidationDialog());
            }
        });
    }
});
