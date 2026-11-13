import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, cardAction, personModal } from './helpers.js';

/**
 * Data quality's lead "<event> <date>, <place> – recorded separately for N
 * people" with Join into one event (spec 085 K1.6 b): one event named in the
 * trace, several summed up with Review one by one (Join, Later, Back); the
 * join gives one shared event (each age kept, the Life line and the editor's
 * banner), one Undo takes it back; a differing source opens Make copies
 * match; a phone at 390 with 44 px buttons; German at 1440/1024/390, light
 * and dark, with long names and a long place. Invented data, a fixed clock.
 */

const SHOTS = process.env.SNIMKY_DIR;
const shot = async (page: Page, name: string) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/S3-${name}.png` });
};

const DOBROSLAV = 'p_dobroslav';
const MSTISLAVA = 'p_mstislava';
const HOSTIVIT = 'p_hostivit';
const BOLESLAVA = 'p_boleslava';

/**
 * Dobroslav's household: the census of 1921 written at him, Mstislava and
 * Hostivít separately (each with an age); `residence`: Hostivít's and
 * Boleslava's residence of 1930 separately too. `otherSource`: Hostivít's
 * census cites another source. `long`: long names and place.
 */
async function household(page: Page, opts: { width?: number; height?: number; long?: boolean; residence?: boolean; otherSource?: boolean } = {}): Promise<string> {
    await page.clock.setFixedTime(new Date('2026-11-13T10:30:00Z'));
    await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
    await openApp(page);
    return page.evaluate(async ({ long, residence, otherSource }) => {
        const p = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        const place = long ? 'Horní Vymyšlenice nad Bezděkovským potokem' : 'Horní Vymyšlenice';
        const census = (id: string, age: string, extra: Record<string, unknown> = {}) =>
            ({ id, type: 'census', date: '1921-02-15', place, address: 'č. 7', age, sourceIds: ['s1'], ...extra });
        const home = (id: string) => ({ id, type: 'residence', date: '1930-05-01', place: 'Bezděkovice' });
        const S = window.Strom;
        await S.DataManager.importAsNewTree({
            persons: {
                [`p_dobroslav`]: p('p_dobroslav', long ? 'Dobroslav Smiloslav Bořivoj' : 'Dobroslav', long ? 'Drahoňovský-Vymyšlenický' : 'Drahoňovský', 'male', {
                    birthDate: '1877', deathDate: '1950', partnerships: ['u1'], childIds: ['p_hostivit', 'p_boleslava'], events: [census('c_d', '44')] }),
                [`p_mstislava`]: p('p_mstislava', long ? 'Mstislava Zbyslava Ctibora' : 'Mstislava', long ? 'Drahoňovská-Vymyšlenická' : 'Drahoňovská', 'female', {
                    birthDate: '1881', deathDate: '1955', partnerships: ['u1'], childIds: ['p_hostivit', 'p_boleslava'], events: [census('c_m', '40')] }),
                [`p_hostivit`]: p('p_hostivit', 'Hostivít', 'Drahoňovský', 'male', {
                    birthDate: '1909', deathDate: '1980', parentIds: ['p_dobroslav', 'p_mstislava'],
                    events: [census('c_h', '12', otherSource ? { sourceIds: ['s2'] } : {}), ...(residence ? [home('r_h')] : [])] }),
                [`p_boleslava`]: p('p_boleslava', 'Boleslava', 'Drahoňovská', 'female', {
                    birthDate: '1912', deathDate: '1990', parentIds: ['p_dobroslav', 'p_mstislava'], events: residence ? [home('r_b')] : [] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_dobroslav', person2Id: 'p_mstislava', childIds: ['p_hostivit', 'p_boleslava'], status: 'married' },
            },
            sources: { s1: { id: 's1', title: 'Sčítání lidu 1921' }, s2: { id: 's2', title: 'Domovská matrika' } },
        } as never, long ? 'Rodokmen Drahoňovských z Horních Vymyšlenic 1877–1990' : 'Drahoňovský');
        S.UI.updateTreeSwitcher?.();
        await S.TreeRenderer.renderAsync();
        return S.DataManager.getCurrentTreeId() as string;
    }, { long: !!opts.long, residence: !!opts.residence, otherSource: !!opts.otherSource });
}

type Ev = { id: string; type: string; age?: string; shareId?: string; sourceIds?: string[] };
const censuses = (page: Page, pid: string) => page.evaluate((id) =>
    ((window.Strom.DataManager.getData().persons as unknown as Record<string, { events?: Ev[] }>)[id]!.events ?? [])
        .filter(e => e.type === 'census'), pid);
const persons = (page: Page) => page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons));

async function openQuality(page: Page, treeId: string): Promise<Locator> {
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);
    const modal = page.locator('#tree-validation-modal');
    await expect(modal).toBeVisible();
    return modal;
}
const trace = (modal: Locator) => modal.locator('.vq-samejoin');

/** The dialog's content and the page never scroll sideways. */
async function noOverflow(scope: Locator): Promise<void> {
    const over = await scope.evaluate(el => {
        const content = (el.querySelector('.modal-content') ?? el) as HTMLElement;
        return Math.max(content.scrollWidth - content.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    });
    expect(over).toBe(0);
}

/** Each box lies inside the dialog's content. */
async function inside(scope: Locator, items: Locator): Promise<void> {
    const c = await scope.locator('.modal-content').boundingBox();
    for (const box of await items.all()) {
        const b = await box.boundingBox();
        if (!b) continue;
        expect(b.x).toBeGreaterThanOrEqual(c!.x - 0.5);
        expect(b.x + b.width).toBeLessThanOrEqual(c!.x + c!.width + 0.5);
    }
}

test.describe('the same event recorded separately (K1.6 b)', () => {
    test('one event: the trace names it, Join gives one shared event with every age, the Life line and the banner; one Undo', async ({ page }) => {
        const treeId = await household(page);
        const before = await persons(page);
        const modal = await openQuality(page, treeId);
        await expect(trace(modal).locator('.vq-samejoin-lead-text'))
            .toHaveText('Census 15 Feb 1921, Horní Vymyšlenice, č. 7 – recorded separately for 3 people.');
        await expect(trace(modal).locator('.vq-samejoin-where')).toHaveText('Dobroslav Drahoňovský, Mstislava Drahoňovská and Hostivít Drahoňovský');
        await shot(page, 'trace-en-1440');
        await trace(modal).getByRole('button', { name: 'Join into one event' }).click();
        await expect(trace(modal)).toHaveCount(0);
        await expect(page.locator('#shared-unify-modal')).not.toHaveClass(/active/);

        const shareId = (await censuses(page, DOBROSLAV))[0].shareId;
        expect(shareId).toBeTruthy();
        for (const [pid, id, age] of [[DOBROSLAV, 'c_d', '44'], [MSTISLAVA, 'c_m', '40'], [HOSTIVIT, 'c_h', '12']]) {
            const list = await censuses(page, pid);
            expect(list).toHaveLength(1);
            expect(list[0]).toMatchObject({ id, age, shareId });
        }
        // The undo pill names the join.
        const pill = page.locator('.undo-toast');
        await expect(pill.locator('.undo-toast-msg').last()).toHaveText('Census 1921: joined into one event for 3 people.');

        // The Life: one census with the others named; its editor says it is shared by 3.
        await page.evaluate(() => window.Strom.UI.closeTreeValidationDialog());
        await cardAction(page, 'Dobroslav', 'edit');
        const pm = personModal(page);
        const rows = pm.locator('#events-list .event-row', { hasText: 'Census' });
        await expect(rows).toHaveCount(1);
        await expect(rows.locator('.shared-line')).toHaveText('with Mstislava, Hostivít');
        await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_dobroslav' as never, 'c_d'));
        const editor = page.locator('#event-editor-modal');
        await expect(editor.locator('#event-shared-banner .shared-banner-text')).toHaveText('Shared by 3 people – changes apply to everyone');
        await shot(page, 'joined-editor-en-1440');
        await page.evaluate(() => window.Strom.UI.forceCloseEventEditor());
        await page.evaluate(() => window.Strom.UI.closeModal());

        // One Undo: the three records separate again, as stored before.
        await page.evaluate(() => window.Strom.DataManager.undo());
        expect(await persons(page)).toBe(before);
    });

    test('several events: Review one by one with Join, Later and Back', async ({ page }) => {
        const treeId = await household(page, { residence: true });
        const modal = await openQuality(page, treeId);
        await expect(trace(modal).locator('.vq-samejoin-lead-text')).toHaveText('2 events are recorded separately for several people.');
        await expect(trace(modal).getByRole('button', { name: 'Join into one event' })).toHaveCount(0);
        await trace(modal).getByRole('button', { name: 'Review one by one' }).click();

        const items = modal.locator('.vq-samejoin-item');
        await expect(modal.locator('.vq-samejoin-title')).toHaveText('Events recorded separately for several people · 2');
        await expect(items.locator('.vq-samejoin-name')).toHaveText([
            'Census 15 Feb 1921, Horní Vymyšlenice, č. 7 – recorded separately for 3 people.',
            'Residence 1 May 1930, Bezděkovice – recorded separately for 2 people.',
        ]);
        await expect(items.nth(1).locator('.vq-samejoin-where')).toHaveText('Hostivít Drahoňovský and Boleslava Drahoňovská');
        await shot(page, 'list-en-1440');

        // Later: hidden until the dialog closes.
        await items.nth(0).getByRole('button', { name: 'Later' }).click();
        await expect(modal.locator('.vq-samejoin-title')).toHaveText('Events recorded separately for several people · 1');
        await expect(items.locator('.vq-samejoin-name')).toHaveText(['Residence 1 May 1930, Bezděkovice – recorded separately for 2 people.']);
        // Join: saved at once, the list goes on.
        await items.nth(0).getByRole('button', { name: 'Join into one event' }).click();
        await expect(items).toHaveCount(0);
        const homes = await page.evaluate(() => ['p_hostivit', 'p_boleslava'].map(id =>
            ((window.Strom.DataManager.getData().persons as unknown as Record<string, { events?: Ev[] }>)[id]!.events ?? [])
                .filter(e => e.type === 'residence').map(e => e.shareId)));
        expect(homes[0]).toHaveLength(1);
        expect(homes[0][0]).toBeTruthy();
        expect(homes[1]).toEqual(homes[0]);
        expect((await censuses(page, DOBROSLAV))[0].shareId).toBeUndefined();

        // Back: the census is left (put off only in the list), named in the trace.
        await modal.getByRole('button', { name: /Back/ }).click();
        await expect(trace(modal).locator('.vq-samejoin-lead-text'))
            .toHaveText('Census 15 Feb 1921, Horní Vymyšlenice, č. 7 – recorded separately for 3 people.');
    });

    test('a share there already: the separate record joins it', async ({ page }) => {
        const treeId = await household(page);
        await page.evaluate(() => {
            const d = window.Strom.DataManager.getData().persons as unknown as Record<string, { events?: Ev[] }>;
            d.p_dobroslav.events![0].shareId = 'shDra1';
            d.p_mstislava.events![0].shareId = 'shDra1';
        });
        const modal = await openQuality(page, treeId);
        await expect(trace(modal).locator('.vq-samejoin-where'))
            .toHaveText('Dobroslav Drahoňovský, Mstislava Drahoňovská and Hostivít Drahoňovský · Joins the shared event of 2 people.');
        await trace(modal).getByRole('button', { name: 'Join into one event' }).click();
        await expect(trace(modal)).toHaveCount(0);
        expect((await censuses(page, HOSTIVIT))[0]).toMatchObject({ shareId: 'shDra1', age: '12' });
    });

    test('a differing source: nothing overwritten, Make copies match opens', async ({ page }) => {
        const treeId = await household(page, { otherSource: true });
        const modal = await openQuality(page, treeId);
        await trace(modal).getByRole('button', { name: 'Join into one event' }).click();
        const unify = page.locator('#shared-unify-modal');
        await expect(unify).toHaveClass(/active/);
        await expect(unify.locator('#shared-unify-title')).toContainText('Census 1921');
        expect((await censuses(page, HOSTIVIT))[0].sourceIds).toEqual(['s2']);
        expect((await censuses(page, DOBROSLAV))[0].sourceIds).toEqual(['s1']);
        expect((await censuses(page, HOSTIVIT))[0].shareId).toBe((await censuses(page, DOBROSLAV))[0].shareId);
        await shot(page, 'unify-en-1440');
    });

    test('a phone: the trace\'s and the list\'s buttons span them, 44 px', async ({ page }) => {
        const treeId = await household(page, { width: 390, height: 844, residence: true });
        const modal = await openQuality(page, treeId);
        await trace(modal).scrollIntoViewIfNeeded();
        const review = trace(modal).getByRole('button', { name: 'Review one by one' });
        const box = await trace(modal).boundingBox();
        const b = await review.boundingBox();
        expect(Math.round(b!.height)).toBeGreaterThanOrEqual(44);
        expect(b!.width).toBeGreaterThan(box!.width - 30);
        await noOverflow(modal);
        await shot(page, 'trace-en-390');
        await review.click();
        const item = modal.locator('.vq-samejoin-item').first();
        const ib = await item.boundingBox();
        for (const btn of await item.getByRole('button').all()) {
            const bb = await btn.boundingBox();
            expect(Math.round(bb!.height)).toBeGreaterThanOrEqual(44);
            expect(bb!.width).toBeGreaterThan(ib!.width - 30);
        }
        await noOverflow(modal);
        await shot(page, 'list-en-390');
    });

    test('a phone held sideways: 44 px buttons', async ({ page }) => {
        const treeId = await household(page, { width: 844, height: 390, residence: true });
        const modal = await openQuality(page, treeId);
        await trace(modal).getByRole('button', { name: 'Review one by one' }).click();
        for (const btn of await modal.locator('.vq-samejoin-item').first().getByRole('button').all()) {
            expect(Math.round((await btn.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        }
        await noOverflow(modal);
    });

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark, long names and place: the trace and the list without overflow`, async ({ page }) => {
            const treeId = await household(page, { width, height: width === 390 ? 844 : 900, long: true, residence: true });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                const modal = await openQuality(page, treeId);
                await expect(trace(modal).locator('.vq-samejoin-lead-text')).toHaveText('2 Ereignisse sind bei mehreren Personen getrennt eingetragen.');
                await trace(modal).scrollIntoViewIfNeeded();
                await noOverflow(modal);
                await inside(modal, trace(modal).locator('button'));
                await shot(page, `trace-de-${width}-${scheme}`);
                await trace(modal).getByRole('button', { name: 'Einzeln durchgehen' }).click();
                const items = modal.locator('.vq-samejoin-item');
                await expect(items.first().locator('.vq-samejoin-name'))
                    .toHaveText('Volkszählung 15.2.1921, Horní Vymyšlenice nad Bezděkovským potokem, č. 7 – bei 3 Personen getrennt eingetragen.');
                await expect(items.first().getByRole('button')).toHaveText(['Zu einem Ereignis verbinden', 'Später']);
                await noOverflow(modal);
                await inside(modal, modal.locator('.vq-samejoin-item, .vq-samejoin-item button'));
                await shot(page, `list-de-${width}-${scheme}`);
                await page.evaluate(() => window.Strom.UI.closeTreeValidationDialog());
            }
        });
    }
});
