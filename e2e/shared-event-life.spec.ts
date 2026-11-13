import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, cardAction, personModal } from './helpers.js';

/**
 * A shared event in the life of each of its persons (spec 085 §2): the "with
 * …" line in the person dialog's list of events and life timeline and on
 * the person page; a given name leads to that person, the rest of the line
 * opens the event's editor from the side of the person whose life it is;
 * the family timeline's one mark; German at 1440/1024/390, light and dark,
 * with long names. Invented data, a fixed clock.
 */

/** Kvido's household at the census of 1921, shared by all four. `long`: Kvido's and Radegunda's names 30+ characters. */
async function household(page: Page, opts: { width?: number; height?: number; long?: boolean } = {}): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-11-13T10:30:00Z'));
    await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
    await openApp(page);
    await page.evaluate(async (long) => {
        const p = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                p_kvido: p('p_kvido', long ? 'Kvido Bonifác Drahoslav' : 'Kvido', long ? 'Hurdálek-Smyšlenický' : 'Hurdálek', 'male', {
                    birthDate: '1879', deathDate: '1950', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev'],
                    events: [{ id: 'ev_1', type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', address: 'č. 14', age: '42' }] }),
                p_radegunda: p('p_radegunda', long ? 'Radegunda Ludmila Bohuslava' : 'Radegunda', long ? 'Hurdálková-Smyšlenická' : 'Hurdálková', 'female', {
                    birthDate: '1883', deathDate: '1955', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev'] }),
                p_bohuchval: p('p_bohuchval', 'Bohuchval', 'Hurdálek', 'male', { birthDate: '1906', deathDate: '1980', parentIds: ['p_kvido', 'p_radegunda'] }),
                p_zbyhnev: p('p_zbyhnev', 'Zbyhněv', 'Hurdálek', 'male', { birthDate: '1910', deathDate: '1985', parentIds: ['p_kvido', 'p_radegunda'] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_kvido', person2Id: 'p_radegunda', childIds: ['p_bohuchval', 'p_zbyhnev'], status: 'married' },
            },
        } as never, long ? 'Rodokmen Hurdálků ze Smyšlenic 1879' : 'Hurdálek');
        const ok = window.Strom.DataManager.saveSharedEvent('p_kvido' as never, 'ev_1', {
            common: {},
            own: new Map([['p_radegunda', { age: '38' }], ['p_bohuchval', { age: '15' }], ['p_zbyhnev', { age: '11' }]]) as never,
            add: ['p_radegunda', 'p_bohuchval', 'p_zbyhnev'] as never,
        });
        if (!ok) throw new Error('not shared');
    }, !!opts.long);
}

const censusId = (page: Page, pid: string) => page.evaluate((id) =>
    ((window.Strom.DataManager.getData().persons as unknown as Record<string, { events?: { id: string; type: string }[] }>)[id]?.events ?? [])
        .find(e => e.type === 'census')!.id, pid);

const eventsLine = (modal: Locator) => modal.locator('#events-list .event-row', { hasText: /Census|Volkszählung/ }).locator('.shared-line');

test.describe('a shared event in each life', () => {
    test('the list of events: the line names the others, a name opens that person, the line opens the editor from that side', async ({ page }) => {
        await household(page);
        await cardAction(page, 'Kvido', 'edit');
        const modal = personModal(page);
        const line = eventsLine(modal);
        await expect(line).toHaveText('with Radegunda, Bohuchval, Zbyhněv');
        await expect(line.locator('.shared-line-mark svg')).toHaveCount(1);
        await expect(line.locator('.shared-line-name').first()).toHaveAttribute('title', 'Radegunda Hurdálková');
        // The life timeline has the same line.
        await expect(page.locator('#pm-lifeline-body .shared-line').first()).toHaveText('with Radegunda, Bohuchval, Zbyhněv');

        // A given name: that person's dialog.
        await line.getByRole('button', { name: 'Radegunda' }).click();
        await expect(modal.locator('#pm-name')).toContainText('Radegunda Hurdálková');
        const hers = eventsLine(modal);
        await expect(hers).toHaveText('with Kvido, Bohuchval, Zbyhněv');

        // The rest of the line: the editor from Radegunda's side.
        await hers.locator('.shared-line-text').click({ position: { x: 4, y: 6 } });
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await expect(editor.locator('#event-editor-subtitle')).toHaveText('Radegunda Hurdálková · * 1883');
    });

    test('four and more: the first two and "and N more"; the same given name twice: whole names', async ({ page }) => {
        await household(page);
        await page.evaluate(async () => {
            const dm = window.Strom.DataManager;
            const id = dm.createPerson({ firstName: 'Bohuchval', lastName: 'Mlčoch', gender: 'male', birthDate: '1870', deathDate: '1930' } as never).id;
            const kvidoEv = (dm.getData().persons as unknown as Record<string, { events?: { id: string; type: string }[] }>).p_kvido.events!.find(e => e.type === 'census')!.id;
            if (!dm.saveSharedEvent('p_kvido' as never, kvidoEv, { common: {}, own: new Map() as never, add: [id] as never })) throw new Error('not added');
        });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_kvido' as never));
        const line = eventsLine(personModal(page));
        await expect(line).toHaveText('with Radegunda, Bohuchval Hurdálek and 2 more');
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_zbyhnev' as never));
        await expect(eventsLine(personModal(page))).toHaveText('with Kvido, Radegunda and 2 more');
    });

    test('the person page: given names lead to the persons\' pages, the line opens the editor', async ({ page }) => {
        await household(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('p_kvido' as never));
        const w = page.locator('#person-page-modal');
        await expect(w).toBeVisible();
        const line = w.locator('.shared-line').first();
        await expect(line).toHaveText('with Radegunda, Bohuchval, Zbyhněv');
        await line.getByRole('button', { name: 'Bohuchval' }).click();
        await expect(w.locator('h1')).toContainText('Bohuchval Hurdálek');
        const his = w.locator('.shared-line').first();
        await expect(his).toHaveText('with Kvido, Radegunda, Zbyhněv');
        await his.locator('.shared-line-text').click({ position: { x: 4, y: 6 } });
        await expect(w).toBeHidden();
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await expect(editor.locator('#event-editor-subtitle')).toHaveText('Bohuchval Hurdálek · * 1906');
    });

    test('the family timeline: one mark across the four rows, no census dots', async ({ page }) => {
        await household(page);
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('timeline'));
        const tl = page.locator('#timeline-container');
        await expect(tl.locator('.tl-shared')).toHaveCount(1);
        await expect(tl.locator('.tl-shared-mark')).toHaveCount(1);
        await expect(tl.locator('.tl-shared-label')).toHaveText('Census 1921');
        await expect(tl.locator('.tl-dot title', { hasText: 'Census' })).toHaveCount(0);
        const box = await tl.locator('.tl-shared-mark').boundingBox();
        expect(box!.width).toBeCloseTo(14, 0);
        expect(box!.height).toBeGreaterThan(90);
    });

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark, long names: no overflow`, async ({ page }) => {
            await household(page, { width, height: width === 390 ? 844 : 900, long: true });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_bohuchval' as never));
                const modal = personModal(page);
                const line = eventsLine(modal);
                await expect(line).toHaveText('mit Kvido Bonifác Drahoslav, Radegunda Ludmila Bohuslava, Zbyhněv');
                await line.scrollIntoViewIfNeeded();
                const over = await modal.evaluate(el => {
                    const content = el.querySelector('.modal-content') as HTMLElement;
                    return Math.max(content.scrollWidth - content.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth);
                });
                expect(over).toBe(0);
                const lb = await line.boundingBox();
                const mb = await modal.locator('.modal-content').boundingBox();
                expect(lb!.x + lb!.width).toBeLessThanOrEqual(mb!.x + mb!.width + 0.5);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/D-events-de-${width}-${scheme}.png` });
                await page.keyboard.press('Escape');
                await expect(modal).toBeHidden();

                await page.evaluate(() => window.Strom.UI.showPersonPage('p_bohuchval' as never));
                const w = page.locator('#person-page-modal');
                const ppLine = w.locator('.shared-line').first();
                await expect(ppLine).toHaveText('mit Kvido Bonifác Drahoslav, Radegunda Ludmila Bohuslava, Zbyhněv');
                await ppLine.scrollIntoViewIfNeeded();
                // The line stays inside the page's column (the ancestors' fan has its own sideways room).
                expect(await ppLine.evaluate(el => {
                    const art = el.closest('article.pp') as HTMLElement;
                    return Math.max(el.getBoundingClientRect().right - art.getBoundingClientRect().right, el.scrollWidth - el.clientWidth,
                        document.documentElement.scrollWidth - document.documentElement.clientWidth);
                })).toBeLessThanOrEqual(0);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/D-page-de-${width}-${scheme}.png` });
                await page.keyboard.press('Escape');
                await expect(w).toBeHidden();

                if (width !== 390) {
                    await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('timeline'));
                    await expect(page.locator('#timeline-container .tl-shared-label')).toHaveText('Volkszählung 1921');
                    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
                    if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/D-timeline-de-${width}-${scheme}.png` });
                    await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('family'));
                }
            }
        });
    }
});
