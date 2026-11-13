import { test, expect, Page } from '@playwright/test';
import { openApp, seedSetting } from './helpers.js';

/**
 * A shared event on the map (spec 085 §2f, 2g): one row of a place's bubble
 * with the given names as links, the number on the marker counting the
 * bubble's rows, Migration over time counting it once; the person page's
 * places list naming the others under the place's row. German at
 * 1440/1024/390, light and dark, with long names. Tiles stubbed, every
 * coordinate from the tree's own `places`. Invented data, a fixed clock.
 */

/** Tiles: one neutral grey pixel (no network). */
async function stubTiles(page: Page): Promise<void> {
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4ceUMAAUAAnkYCiyNAAAAAElFTkSuQmCC',
        'base64',
    );
    await page.route('**://tile.openstreetmap.org/**', route =>
        route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await page.route('**://nominatim.openstreetmap.org/**', route => route.abort());
    await seedSetting(page, 'mapTiles', true);
}

/**
 * Svatobor's household: the census of 1921 at Dolní Smyšlenice No. 14 shared
 * by all four, Svatobor born at Dolní Smyšlenice; the sons' residence of 1930
 * at Nová Ves shared by the two of them, Radegunda born there. `long`: the
 * parents' names 30+ characters.
 */
async function household(page: Page, opts: { width?: number; height?: number; long?: boolean } = {}): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-11-13T10:30:00Z'));
    await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
    await stubTiles(page);
    await openApp(page);
    await page.evaluate(async (long) => {
        const p = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        const census = (id: string, age: string) =>
            ({ id: `ev_c_${id}`, type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', address: 'č. 14', age, shareId: 'cens1921' });
        const residence = (id: string) => ({ id: `ev_r_${id}`, type: 'residence', date: '1930', place: 'Nová Ves u Smyšlenic', shareId: 'resi1930' });
        await window.Strom.DataManager.importAsNewTree({
            version: 20,
            persons: {
                p_svatobor: p('p_svatobor', long ? 'Svatobor Bonifác Drahoslav' : 'Svatobor', long ? 'Hurdálek-Smyšlenický' : 'Hurdálek', 'male', {
                    birthDate: '1879', birthPlace: 'Dolní Smyšlenice', deathDate: '1950', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev'],
                    events: [census('p_svatobor', '42')] }),
                p_radegunda: p('p_radegunda', long ? 'Radegunda Ctibora Dobroslava' : 'Radegunda', long ? 'Hurdálková-Smyšlenická' : 'Hurdálková', 'female', {
                    birthDate: '1883', birthPlace: 'Nová Ves u Smyšlenic', deathDate: '1955', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev'],
                    events: [census('p_radegunda', '38')] }),
                p_bohuchval: p('p_bohuchval', 'Bohuchval', 'Hurdálek', 'male', {
                    birthDate: '1906', deathDate: '1980', parentIds: ['p_svatobor', 'p_radegunda'],
                    events: [census('p_bohuchval', '15'), residence('p_bohuchval')] }),
                p_zbyhnev: p('p_zbyhnev', 'Zbyhněv', 'Hurdálek', 'male', {
                    birthDate: '1910', deathDate: '1985', parentIds: ['p_svatobor', 'p_radegunda'],
                    events: [census('p_zbyhnev', '11'), residence('p_zbyhnev')] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'p_svatobor', person2Id: 'p_radegunda', childIds: ['p_bohuchval', 'p_zbyhnev'], status: 'married' },
            },
            places: {
                'dolni smyslenice': { lat: 49.62, lon: 15.31 },
                'nova ves u smyslenic': { lat: 49.48, lon: 15.62 },
            },
        } as never, long ? 'Rodokmen Hurdálků ze Smyšlenic 1879' : 'Hurdálek');
    }, !!opts.long);
}

async function openMap(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
    await page.locator('.map-scope button', { hasText: /^(Whole tree|Ganzer Stammbaum)$/ }).click();
    await expect(page.locator('.map-marker').first()).toBeVisible();
    await page.evaluate(() => {
        window.Strom.UI.dismissUndoToast();
        document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
    });
}

/** Move the time slider and fire its input event (Playwright fill is unreliable on ranges). */
async function setYear(page: Page, year: number): Promise<void> {
    await page.locator('.map-time-range').evaluate((el, val) => {
        const input = el as HTMLInputElement;
        input.value = String(val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, year);
}

const TOWN = '.map-marker[data-key="dolni smyslenice"]';
const VES = '.map-marker[data-key="nova ves u smyslenic"]';

test.describe('a shared event on the map', () => {
    test('one row with the given names as links, the marker counting the rows', async ({ page }) => {
        await household(page);
        await openMap(page);
        // The town: Svatobor's birth and the census at No. 14 — two rows, not five.
        await expect(page.locator(`${TOWN} .map-marker-dot`)).toHaveText('2');
        await expect(page.locator(`${VES} .map-marker-dot`)).toHaveText('2');

        await page.locator(`${TOWN} .map-marker-dot`).click();
        const popup = page.locator('.map-popup');
        await expect(popup).toBeVisible();
        const house = popup.locator('.map-popup-house', { hasText: 'č. 14' });
        const row = house.locator('.map-popup-share');
        await expect(row).toHaveCount(1);
        await expect(row).toHaveText(/1921\s*Census · Svatobor, Radegunda, Bohuchval, Zbyhněv/);
        await expect(row.locator('.map-popup-share-name')).toHaveCount(4);
        await expect(row.getByRole('button', { name: 'Radegunda' })).toHaveAttribute('title', 'Radegunda Hurdálková');
        // Nobody of the census has a row of their own at the house; Svatobor's birth stays his.
        await expect(house.locator('.map-popup-person')).toHaveCount(0);
        await expect(popup.locator('.map-popup-nohouse .map-popup-person')).toHaveText(['Svatobor Hurdálek'].map(n => new RegExp(n)));

        // A given name leads to that person in the family view.
        await row.getByRole('button', { name: 'Zbyhněv' }).click();
        await expect(page.locator('#map-container')).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId?.() ?? null)).toBe('p_zbyhnev');
    });

    test('a place: the person\'s own row and the shared event\'s row', async ({ page }) => {
        await household(page);
        await openMap(page);
        await page.locator(`${VES} .map-marker-dot`).click();
        const popup = page.locator('.map-popup');
        await expect(popup.locator('.map-popup-person')).toHaveCount(1);
        await expect(popup.locator('.map-popup-person')).toContainText('Radegunda');
        await expect(popup.locator('.map-popup-share')).toHaveText(/1930\s*Residence · Bohuchval, Zbyhněv/);
    });

    test('Migration over time counts the shared event once', async ({ page }) => {
        await household(page);
        await openMap(page);
        await page.getByRole('button', { name: 'Migration over time' }).click();
        await setYear(page, 1925);
        // 1925: Svatobor's birth and the census at the town; at Nová Ves only Radegunda's birth so far.
        await expect(page.locator(`${TOWN} .map-marker-dot`)).toHaveText('2');
        await expect(page.locator(`${VES} .map-marker-dot`)).toHaveText('1');
        await setYear(page, 1935);
        await expect(page.locator(`${VES} .map-marker-dot`)).toHaveText('2');
        // The bubble in time: the same one row.
        await page.locator(`${VES} .map-marker-dot`).click();
        await expect(page.locator('.map-popup .map-popup-share')).toHaveText(/1930\s*Residence · Bohuchval, Zbyhněv/);
    });

    test('the person page: the person\'s own point, the place\'s row names the others', async ({ page }) => {
        await household(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('p_bohuchval' as never));
        const w = page.locator('#person-page-modal');
        await expect(w).toBeVisible();
        const row = w.locator('.pp-map-row[data-pp-map-place="dolni smyslenice"]');
        await expect(row.locator('.pp-map-with .shared-line')).toHaveText('with Svatobor, Radegunda, Zbyhněv');
        await expect(w.locator('.pp-map-row[data-pp-map-place="nova ves u smyslenic"] .pp-map-with')).toHaveText('with Zbyhněv');
        // One point for the town on the map, not one per person of the census.
        await expect(w.locator('.pp-places button.pp-map-pt[data-pp-map-place*="dolni smyslenice"]')).toHaveCount(1);
        // A name opens that person's page (the row is not selected by it).
        await row.getByRole('button', { name: 'Radegunda' }).click();
        await expect(w.locator('h1')).toContainText('Radegunda Hurdálková');
    });

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark, long names: no overflow`, async ({ page }) => {
            await household(page, { width, height: width === 390 ? 844 : 900, long: true });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await openMap(page);
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                await page.locator(`${TOWN} .map-marker-dot`).click();
                const popup = page.locator('.map-popup');
                const row = popup.locator('.map-popup-share');
                await expect(row).toHaveText(/1921\s*Volkszählung · Svatobor Bonifác Drahoslav, Radegunda Ctibora Dobroslava, Bohuchval, Zbyhněv/);
                const over = await popup.evaluate(el => {
                    const share = el.querySelector('.map-popup-share') as HTMLElement;
                    const r = el.getBoundingClientRect();
                    const names = [...share.querySelectorAll('.map-popup-share-name')].map(n => n.getBoundingClientRect().right - r.right);
                    return Math.max(el.scrollWidth - el.clientWidth, share.scrollWidth - share.clientWidth, ...names,
                        document.documentElement.scrollWidth - document.documentElement.clientWidth);
                });
                expect(over).toBeLessThanOrEqual(0);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/E3-map-de-${width}-${scheme}.png` });
                await popup.locator('.map-popup-close').click();
                await expect(popup).toBeHidden();
            }
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                await page.evaluate(() => window.Strom.UI.showPersonPage('p_bohuchval' as never));
                const w = page.locator('#person-page-modal');
                const line = w.locator('.pp-map-row[data-pp-map-place="dolni smyslenice"] .pp-map-with .shared-line');
                await expect(line).toHaveText('mit Svatobor Bonifác Drahoslav, Radegunda Ctibora Dobroslava, Zbyhněv');
                await line.scrollIntoViewIfNeeded();
                expect(await line.evaluate(el => {
                    const list = el.closest('.pp-map-list') as HTMLElement;
                    return Math.max(el.getBoundingClientRect().right - list.getBoundingClientRect().right, el.scrollWidth - el.clientWidth,
                        document.documentElement.scrollWidth - document.documentElement.clientWidth);
                })).toBeLessThanOrEqual(0);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/E3-page-de-${width}-${scheme}.png` });
                await page.keyboard.press('Escape');
                await expect(w).toBeHidden();
            }
        });
    }
});
