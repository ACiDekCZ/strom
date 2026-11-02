import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, seedTree, seedSetting } from './helpers.js';
import { fakeBridge, fakeFixes, openResearch, poll, links } from './research-bridge.js';

/**
 * The Places dialog with towns and houses ("map kinds and houses" §4–§7): a
 * location by the town for a place with a house, the offer to use it for the
 * town's other house numbers, town groups, the rename preview and the split
 * into town and house (a tree of the app's own; a research tree links to its
 * research instead). The geocoder never leaves the test: Nominatim is answered
 * here. Invented places and people.
 */

const TOWN = 'Bělokamen';
const BIG_TOWN = 'Zálesí u Brodku nad Křemenným potokem';
/** Bělokamen's house places in natural order; the last two are numbers alone. */
const HOUSES = ['čp. 2', 'čp. 4', 'čp. 7', 'čp. 9', 'čp. 11', 'čp. 15', '16', 'čp. 23', '31', 'čp. 40'];

/** The tree's place key (placeKey): no accents, lowercase, no dots or commas. */
const key = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();

type Hit = { lat: string; lon: string; display_name: string; addresstype?: string };

/** Answer the geocoder by the query; anything else finds nothing. Returns what was asked. */
async function stubGeocoder(page: Page, answers: Record<string, Hit[]>): Promise<string[]> {
    const asked: string[] = [];
    await page.route('**://nominatim.openstreetmap.org/**', route => {
        const q = new URL(route.request().url()).searchParams.get('q') ?? '';
        asked.push(q);
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answers[q] ?? []) });
    });
    return asked;
}

const VILLAGE: Hit = { lat: '49.61', lon: '15.42', display_name: 'Bělokamen, Okres Testov, Kraj Testov, Česko', addresstype: 'village' };

/**
 * Zorbin born in Bělokamen (its own place, on the map) and dead in Hlinsko;
 * one person in each of Bělokamen's ten houses (none on the map); Quilla in
 * Kopřivná čp. 7 (a single house place: no group); Yarek born and dead in Hlinsko.
 */
async function seedTowns(page: Page): Promise<void> {
    await seedSetting(page, 'geocoding', true);
    await openApp(page);
    const people: Record<string, Record<string, unknown>> = {
        p0: { firstName: 'Zorbin', lastName: 'Tesk', birthPlace: TOWN, deathPlace: 'Hlinsko' },
        q: { firstName: 'Quilla', lastName: 'Tesk', gender: 'female', birthPlace: 'Kopřivná čp. 7' },
        y: { firstName: 'Yarek', lastName: 'Tesk', birthPlace: 'Hlinsko', deathPlace: 'Hlinsko' },
    };
    HOUSES.forEach((h, i) => { people[`h${i}`] = { firstName: `Ilvar${i + 1}`, lastName: 'Tesk', birthPlace: `${TOWN} ${h}` }; });
    await seedTree(page, people as never, 'Tesk');
    await page.evaluate(() => {
        const S = window.Strom;
        S.DataManager.getData().places = {
            belokamen: { lat: 49.61, lon: 15.42, label: 'Bělokamen' },
            hlinsko: { lat: 49.76, lon: 15.9, label: 'Hlinsko' },
        };
        S.TreeRenderer.render();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
    });
}

const modal = (page: Page): Locator => page.locator('#places-modal');
const row = (page: Page, k: string): Locator => modal(page).locator(`.place-row[data-key="${k}"]`);
const group = (page: Page, town = TOWN): Locator => modal(page).locator(`.place-group[data-town="${key(town)}"]`);
const open = (page: Page, focusKey?: string): Promise<void> =>
    page.evaluate((k) => window.Strom.UI.showPlacesManager(k, undefined, 'tree'), focusKey);
const geos = (page: Page): Promise<Record<string, { byTown?: string }>> =>
    page.evaluate(() => JSON.parse(JSON.stringify(window.Strom.DataManager.getData().places ?? {})));
const toast = (page: Page, text: string | RegExp): Locator => page.locator('.toast', { hasText: text });
const visibleSubKeys = (page: Page): Promise<string[]> => group(page).locator('.place-row-sub:visible')
    .evaluateAll(rows => rows.map(r => (r as HTMLElement).dataset.key ?? ''));

test.describe('the Places dialog with towns and houses', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the rename preview: what it rewrites, the new name live, Rename only once it differs, Escape, one undo', async ({ page }) => {
        await seedTowns(page);
        await open(page);
        const r = row(page, 'hlinsko');
        // No permanent name field any more: the rename opens on demand.
        await expect(r.locator('.place-new-name')).toBeHidden();
        await r.getByRole('button', { name: '✎ Rename…' }).click();
        const preview = r.locator('.place-rename-preview');
        await expect(preview).toBeVisible();
        await expect(preview.locator('.place-card-head')).toHaveText('Rewrites 3 entries for 2 people:');
        await expect(preview).toContainText('Can be undone: Undo.');
        const go = preview.locator('.place-rename-go');
        await expect(go).toHaveText('Rewrite 3 entries');
        await expect(go).toBeDisabled();

        const input = r.locator('.place-new-name');
        await input.fill('Hlinsko u Bělokamene');
        await expect(preview.locator('.place-rename-to')).toHaveText('Hlinsko u Bělokamene');
        await expect(go).toBeEnabled();
        await expect(preview.locator('.place-rename-merge')).toBeHidden();
        // The name of another place: the two become one.
        await input.fill('Kopřivná čp. 7');
        await expect(preview.locator('.place-rename-merge')).toBeVisible();
        // Back to the same name, or nothing: nothing to rename.
        await input.fill('Hlinsko');
        await expect(go).toBeDisabled();
        await input.fill('  ');
        await expect(go).toBeDisabled();

        // Escape: the rename goes, the dialog stays, nothing changed.
        await input.press('Escape');
        await expect(preview).toBeHidden();
        await expect(modal(page)).toBeVisible();
        await expect(r.locator('.place-title')).toHaveText('Hlinsko');

        await r.getByRole('button', { name: '✎ Rename…' }).click();
        await input.fill('Hlinsko u Bělokamene');
        await go.click();
        const t = toast(page, 'Renamed: 3 entries.');
        await expect(t).toBeVisible();
        const places = () => page.evaluate(() => window.Strom.DataManager.getAllPersons()
            .filter(p => p.firstName === 'Yarek' || p.firstName === 'Zorbin').map(p => [p.birthPlace, p.deathPlace]));
        expect(await places()).toEqual(expect.arrayContaining([['Hlinsko u Bělokamene', 'Hlinsko u Bělokamene'], [TOWN, 'Hlinsko u Bělokamene']]));
        await expect(row(page, key('Hlinsko u Bělokamene'))).toBeVisible();

        // One undo step brings every entry back.
        await t.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(places).toEqual(expect.arrayContaining([['Hlinsko', 'Hlinsko'], [TOWN, 'Hlinsko']]));
        await expect(row(page, 'hlinsko')).toBeVisible();
    });

    test('Find on the map: the attach note, the town when the house is not found, the offer for the other numbers, one undo', async ({ page }) => {
        const asked = await stubGeocoder(page, { [TOWN]: [VILLAGE] });
        await seedTowns(page);
        // Opened on a house of the group: the group opens and that row's search is ready.
        await open(page, key(`${TOWN} čp. 4`));
        const r = row(page, key(`${TOWN} čp. 4`));
        await expect(r.locator('.place-search')).toBeVisible();
        await expect(r.locator('.place-attach-note')).toContainText('Only the location is attached; the entry in the tree stays as it is.');
        await expect(r.locator('.place-query')).toHaveValue(`${TOWN} čp. 4`);
        await r.locator('.place-search-go').click();

        // Nothing under the whole name: the town is asked for and attached by the town.
        await expect(r.locator('.place-bytown')).toHaveText(`⌖ Located by the town of ${TOWN}`);
        expect(asked).toEqual([`${TOWN} čp. 4`, TOWN]);
        const offer = r.locator('.place-offer');
        await expect(offer).toContainText(`Location attached to ${TOWN} čp. 4, by town.`);
        await expect(offer.locator('.place-offer-go')).toHaveText(`Use for the other house numbers in ${TOWN} too (9)`);
        await expect(offer).toContainText('Only places in this town that are not on the map yet.');
        // A location by the town has no Remove (Change picks an exact point).
        await expect(r.locator('.place-remove')).toHaveCount(0);
        // The entry itself is untouched.
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Ilvar2')?.birthPlace))
            .toBe(`${TOWN} čp. 4`);

        await offer.locator('.place-offer-go').click();
        const t = toast(page, `Location attached to 9 more places in ${TOWN}, by town.`);
        await expect(t).toBeVisible();
        const byTown = async () => Object.entries(await geos(page)).filter(([, g]) => g.byTown === TOWN).map(([k]) => k).sort();
        expect(await byTown()).toEqual(HOUSES.map(h => key(`${TOWN} ${h}`)).sort());
        await expect(group(page).locator('.place-unplaced-tag')).toHaveCount(0);

        // One undo: the nine go, the first one (its own step) stays.
        await t.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(byTown).toEqual([key(`${TOWN} čp. 4`)]);
        await expect(group(page).locator('.place-unplaced-tag')).toHaveText('9 without location');
    });

    test('a hand search lists kind and region; a town for a single house place says so and the card goes by itself', async ({ page }) => {
        await stubGeocoder(page, {
            'Kopřivná': [
                { lat: '49.3', lon: '16.2', display_name: 'Kopřivná, Okres Testov, Kraj Testov, Česko', addresstype: 'village' },
                { lat: '49.31', lon: '16.21', display_name: 'Kopřivná, Malá Strana, Okres Testov, Česko', addresstype: 'road' },
            ],
        });
        await seedTowns(page);
        await open(page, key('Kopřivná čp. 7'));
        const r = row(page, key('Kopřivná čp. 7'));
        await r.locator('.place-query').fill('Kopřivná');
        await r.locator('.place-search-go').click();
        const hits = r.locator('.place-candidate');
        await expect(hits).toHaveCount(2);
        await expect(hits.nth(0).locator('strong')).toHaveText('Kopřivná');
        await expect(hits.nth(0).locator('.place-candidate-sub')).toHaveText('town · Okres Testov, Kraj Testov, Česko');
        await expect(hits.nth(1).locator('.place-candidate-sub')).toContainText('street');
        await hits.nth(0).click();

        await expect(r.locator('.place-bytown')).toHaveText('⌖ Located by the town of Kopřivná');
        // No other house of Kopřivná: only the first sentence, and it goes by itself.
        const offer = r.locator('.place-offer');
        await expect(offer).toHaveText('✓ Location attached to Kopřivná čp. 7, by town.');
        await expect(offer.locator('button')).toHaveCount(0);
        await expect(offer).toBeHidden({ timeout: 8000 });
    });

    test('a town group: the strip shows closed, ▸ opens the first 8, "Show all", the search and the "No location" chip', async ({ page }) => {
        await seedTowns(page);
        await page.evaluate(() => {
            const p = window.Strom.DataManager.getData().places!;
            p['belokamen cp 2'] = { lat: 49.611, lon: 15.421 };
            p['belokamen cp 4'] = { lat: 49.612, lon: 15.422 };
        });
        await open(page);
        const g = group(page);
        const head = g.locator('.place-group-head');
        await expect(head).toHaveAttribute('data-key', 'belokamen');
        await expect(head.locator('.place-count')).toContainText('10 house numbers');
        await expect(head.locator('.place-unplaced-tag')).toHaveText('8 without location');
        // Closed: the strip shows, the houses do not.
        await expect(g.locator('.place-group-strip')).toBeVisible();
        await expect(g.locator('.place-group-strip')).toContainText('The house numbers are part of the place name for now.');
        expect(await visibleSubKeys(page)).toEqual([]);
        // Kopřivná čp. 7 is one house only: a row of its own, with its own split.
        await expect(row(page, key('Kopřivná čp. 7')).locator('.place-split-one')).toHaveText('Split into town and house');

        const caret = head.locator('.place-caret');
        await expect(caret).toHaveAttribute('aria-expanded', 'false');
        await caret.click();
        await expect(caret).toHaveAttribute('aria-expanded', 'true');
        const natural = HOUSES.map(h => key(`${TOWN} ${h}`));
        await expect.poll(() => visibleSubKeys(page)).toEqual(natural.slice(0, 8));
        await g.getByRole('button', { name: 'Show all 10' }).click();
        await expect.poll(() => visibleSubKeys(page)).toEqual(natural);
        await expect(g.locator('.place-show-all')).toBeHidden();
        // Closed again: only the strip.
        await caret.click();
        await expect.poll(() => visibleSubKeys(page)).toEqual([]);

        // The search: a house shows that house under its town, opened; the town shows the group as it is.
        const search = modal(page).locator('#places-filter');
        await search.fill('31');
        await expect.poll(() => visibleSubKeys(page)).toEqual([key(`${TOWN} 31`)]);
        await expect(row(page, 'hlinsko')).toBeHidden();
        await search.fill('belok');
        await expect.poll(() => visibleSubKeys(page)).toEqual([]);
        await expect(head).toBeVisible();
        await search.fill('');

        // The chip: only the houses without a location, opened.
        await modal(page).locator('.places-chip[data-filter="none"]').click();
        await expect.poll(() => visibleSubKeys(page)).toEqual(natural.filter(k => k !== 'belokamen cp 2' && k !== 'belokamen cp 4'));
        await expect(row(page, 'hlinsko')).toBeHidden();
        await expect(row(page, key('Kopřivná čp. 7'))).toBeVisible();
    });

    test('opened on the town ("town:" key or the town\'s own place) the group is open', async ({ page }) => {
        await seedTowns(page);
        for (const focus of [`town:${key(TOWN)}`, key(TOWN)]) {
            await open(page, focus);
            await expect(group(page).locator('.place-caret')).toHaveAttribute('aria-expanded', 'true');
            await expect.poll(() => visibleSubKeys(page)).toHaveLength(8);
            await page.evaluate(() => window.Strom.UI.closePlacesManager());
        }
    });

    test('the split of a town: numbers alone ask first (No keeps all), Yes → preview → Split, one undo restores', async ({ page }) => {
        await seedTowns(page);
        await open(page);
        const strip = group(page).locator('.place-group-strip');
        const splitAll = strip.locator('.place-split-all');
        await expect(splitAll).toHaveText(`Split all numbers in ${TOWN} (10)…`);
        const before = await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons));

        await splitAll.click();
        const bare = strip.locator('.place-bare-card');
        await expect(bare).toContainText(`Are the numbers in ${TOWN} house numbers?`);
        await expect(bare.locator('.place-bare-examples span')).toHaveText([`${TOWN} 16`, `${TOWN} 31`]);
        await bare.getByRole('button', { name: 'No, leave them' }).click();
        await expect(bare).toHaveCount(0);
        await expect(splitAll).toBeVisible();
        expect(await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons))).toBe(before);

        await splitAll.click();
        await strip.getByRole('button', { name: 'Yes, they are house numbers' }).click();
        const preview = strip.locator('.place-split-preview');
        await expect(preview.locator('.place-card-head')).toHaveText(`Split 10 places in ${TOWN} into town and house`);
        await expect(preview).toContainText('10 entries for 10 people change');
        await expect(preview.locator('.place-split-examples s')).toHaveCount(3);
        await expect(preview).toContainText('Can be undone: Undo.');
        await expect(preview).not.toContainText('already have a different house');
        await preview.getByRole('button', { name: 'Split 10 entries' }).click();

        const t = toast(page, `Split 10 entries in ${TOWN} into town and house.`);
        await expect(t).toBeVisible();
        const ilvar = () => page.evaluate(() => window.Strom.DataManager.getAllPersons()
            .filter(p => p.firstName.startsWith('Ilvar')).map(p => [p.birthPlace, p.birthAddress ?? '']).sort());
        const split = await ilvar();
        expect(split.every(([place]) => place === 'Bělokamen')).toBe(true);
        expect(split.map(([, house]) => house)).toEqual(expect.arrayContaining(['4', '16']));
        // The group is gone; the town says how many houses its House field holds.
        await expect(group(page)).toHaveCount(0);
        await expect(row(page, 'belokamen').locator('.place-count')).toHaveText('11 people · 10 houses in the House field');

        await t.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons))).toBe(before);
        await expect(group(page)).toBeVisible();
    });

    test('a single house place splits from its row', async ({ page }) => {
        await seedTowns(page);
        await open(page);
        const r = row(page, key('Kopřivná čp. 7'));
        await r.locator('.place-split-one').click();
        const preview = r.locator('.place-split-preview');
        await expect(preview.locator('.place-split-examples')).toContainText('Kopřivná · 7');
        await preview.getByRole('button', { name: 'Split 1 entry' }).click();
        await expect(toast(page, 'Split 1 entry in Kopřivná into town and house.')).toBeVisible();
        expect(await page.evaluate(() => {
            const q = window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Quilla')!;
            return [q.birthPlace, q.birthAddress];
        })).toEqual(['Kopřivná', '7']);
    });

    test('the geocoding run attaches a house place by its town and its toast opens the places without a location', async ({ page }) => {
        await page.route('**://tile.openstreetmap.org/**', route => route.fulfill({
            status: 200, contentType: 'image/png',
            body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
        }));
        await seedSetting(page, 'mapTiles', true);
        await stubGeocoder(page, { [TOWN]: [VILLAGE] });
        await seedSetting(page, 'geocoding', true);
        await openApp(page);
        await seedTree(page, {
            a: { firstName: 'Zorbin', lastName: 'Tesk', birthPlace: `${TOWN} čp. 4` },
            b: { firstName: 'Quilla', lastName: 'Tesk', gender: 'female', birthPlace: 'Lhota u Nikde' },
        } as never, 'Tesk');
        await page.evaluate(() => {
            window.Strom.DataManager.getData().places = {};
            window.Strom.UI.setDisplayViewMode('map');
        });
        await page.locator('.map-scope button', { hasText: /^Whole tree$/ }).click();
        await page.evaluate(() => {
            window.Strom.UI.dismissUndoToast();
            document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
        });
        await page.getByRole('button', { name: 'Look up 2 places', exact: true }).click();

        const t = toast(page, 'Found 1 place, 1 of them by town. 1 place not found.');
        await expect(t).toBeVisible({ timeout: 15000 });
        expect((await geos(page))[key(`${TOWN} čp. 4`)]?.byTown).toBe(TOWN);
        await t.getByRole('button', { name: 'Places' }).click();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page).locator('.places-chip[data-filter="none"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(row(page, 'lhota u nikde')).toBeVisible();
        await expect(row(page, key(`${TOWN} čp. 4`))).toBeHidden();
    });
});

test('a research tree: no split, the link to the research\'s fix only on the towns it names', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const b = await fakeBridge(page, {
        features: ['fixes.list', 'fixes.towns'],
        links: ['send', 'open', 'live', 'app', 'setup', 'fixes'],
        fixes: fakeFixes({ fixes: [{
            id: 'street-places', title: { en: 'Streets in places' }, summary: { en: 'Moves streets out of place names.' },
            unit: 'fact', count: 3, state: 'pending', undoable: false, paid: false,
            towns: [{ town: TOWN, key: key(TOWN), count: 3, places: [`${TOWN} čp. 4`, `${TOWN} čp. 9`, `${TOWN} čp. 15`] }],
        }] }),
    });
    await openResearch(page);
    await poll(page);
    await expect.poll(() => b.fixes!.asks).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => !!window.Strom.UI.streetPlacesFixNow().fix)).toBe(true);
    await page.evaluate((town) => {
        const dm = window.Strom.DataManager;
        const by = (n: string) => dm.getAllPersons().find(p => p.firstName === n)!.id;
        dm.updatePerson(by('Josef'), { birthPlace: `${town} čp. 4`, deathPlace: `${town} čp. 9` });
        dm.updatePerson(by('Anna'), { birthPlace: `${town} čp. 15` });
        dm.updatePerson(by('Jan'), { birthPlace: 'Kopřivná čp. 7' });
    }, TOWN);
    await open(page);

    await expect(modal(page).locator('.place-split-all, .place-split-one')).toHaveCount(0);
    const strip = group(page).locator('.place-group-strip');
    await expect(strip.locator('.place-research-note')).toContainText('This tree is linked to a research.');
    await expect(strip.locator('.place-research-link')).toHaveText('Fix in the research (Tree fixes) ↗');
    await expect(strip.locator('.place-research-count')).toHaveText('the research reports 3 places');
    // Kopřivná is not among the research's towns: no link on its row.
    await expect(row(page, key('Kopřivná čp. 7')).locator('.place-research-link')).toHaveCount(0);

    await strip.locator('.place-research-link').click();
    await expect.poll(() => links(page)).toEqual([expect.stringMatching(/^strom-research:\/\/fixes\?.*id=street-places/)]);
});

/**
 * Layout self-check in German (the longest texts) at three sizes, light and
 * dark, with a long town: the rows, the group strip, the offer card and the
 * previews stay inside their boxes.
 */
for (const theme of ['light', 'dark'] as const) {
    for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
        test(`the Places dialog in German at ${size.width}px, ${theme}: nothing overflows`, async ({ browser }) => {
            const touch = size.width < 1024;
            const context = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, locale: 'de-DE' });
            const page = await context.newPage();
            try {
                await seedSetting(page, 'language', 'de');
                await seedSetting(page, 'theme', theme);
                await openApp(page);
                const houses = ['čp. 1', 'čp. 2', 'čp. 3', 'čp. 12'];
                const people: Record<string, Record<string, unknown>> = {};
                houses.forEach((h, i) => { people[`h${i}`] = { firstName: `Ilvar${i + 1}`, lastName: 'Tesk', birthPlace: `${BIG_TOWN} ${h}`, deathPlace: `${BIG_TOWN} ${h}` }; });
                await seedTree(page, people as never, 'Tesk');
                const k = (h: string) => key(`${BIG_TOWN} ${h}`);
                await page.evaluate(({ first, town }) => {
                    window.Strom.DataManager.getData().places = { [first]: { lat: 49.6, lon: 15.4, label: town, byTown: town, townChoices: 2 } };
                    window.Strom.TreeRenderer.render();
                    window.Strom.UI.dismissUndoToast();
                    document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
                }, { first: k('čp. 1'), town: BIG_TOWN });
                await open(page, `town:${key(BIG_TOWN)}`);
                await expect(modal(page).locator('.place-nearest')).toBeVisible();

                // The offer card (as after a hand search found the town).
                await page.evaluate(({ k2, town }) => {
                    (window.Strom.UI as unknown as { attachPlaceByTown(k: string, g: unknown, t: string): void })
                        .attachPlaceByTown(k2, { lat: 49.6, lon: 15.4, label: town, byTown: town }, town);
                }, { k2: k('čp. 2'), town: BIG_TOWN });
                await expect(row(page, k('čp. 2')).locator('.place-offer-go')).toBeVisible();
                // The split preview in the strip, the rename preview in a row.
                await group(page, BIG_TOWN).locator('.place-split-all').click();
                await expect(group(page, BIG_TOWN).locator('.place-split-preview')).toBeVisible();
                await row(page, k('čp. 12')).locator('.place-rename-open').click();
                await expect(row(page, k('čp. 12')).locator('.place-rename-preview')).toBeVisible();

                const over = await page.evaluate(() => {
                    const out: string[] = [];
                    const sel = ['.places-modal', '.place-row', '.place-group-strip', '.place-offer', '.place-split-preview',
                        '.place-rename-preview', '.place-pin', '.place-head'];
                    for (const s of sel) {
                        for (const e of document.querySelectorAll<HTMLElement>(`#places-modal ${s}`)) {
                            if (!e.offsetParent) continue;
                            if (e.scrollWidth - e.clientWidth > 0) out.push(`${s} ${e.closest<HTMLElement>('[data-key]')?.dataset.key ?? ''}: ${e.scrollWidth} > ${e.clientWidth}`);
                        }
                    }
                    const m = document.querySelector('#places-modal .places-modal')!.getBoundingClientRect();
                    if (m.left < -0.5 || m.right > window.innerWidth + 0.5) out.push(`dialog ${m.left}..${m.right} of ${window.innerWidth}`);
                    return out;
                });
                expect(over).toEqual([]);
            } finally {
                await context.close();
            }
        });
    }
}
