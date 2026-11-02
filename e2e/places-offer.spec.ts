import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakePlaces, openResearch, poll, researchGed, HEAD, FakeBridge } from './research-bridge.js';

/**
 * The offer after a tree came from a research or was linked with one (spec
 * 034 U5 point 7): "N places not on the map – look them up in the research?"
 * as a toast once its research here looks up places (`places.identify`),
 * once per tree, only with a place to look up. Its action opens Places with
 * the preview of "Look up all not on the map". Invented places and people
 * (the Vorlan family).
 */

/** One person of the research born and dying in places the tree has no location for. */
function person(id: string, first: string, birth: string, death: string): string[] {
    return [
        `0 @${id}@ INDI`, `1 NAME ${first} /Vorlan/`, '1 SEX M', `1 REFN ${id}`, '2 TYPE strom-research',
        '1 BIRT', '2 DATE 1860', `2 PLAC ${birth}`, '1 DEAT', '2 DATE 1910', `2 PLAC ${death}`,
    ];
}

const GED = researchGed(HEAD, [
    ...person('P0004', 'Teodor', 'Kvelín', 'Brodnice'),
    ...person('P0005', 'Osvald', 'Kvelín', 'Zálesná Ves'),
]);

/** The research's tree, its bridge taking places or not; the offer kept armed as after opening the research. */
async function research(page: Page, opts: { features?: string[]; reply?: Record<string, unknown> } = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, {
        features: opts.features ?? ['places.identify'],
        treeGed: GED,
        places: fakePlaces(opts.reply ? { reply: opts.reply } : {}),
    });
    await openResearch(page, { ged: GED, placesOffer: true });
    return b;
}

const offer = (page: Page): Locator => page.locator('.toast[data-kind="places-offer"]');
const offerState = (page: Page): Promise<string | undefined> => page.evaluate(() => {
    const id = window.Strom.TreeManager.getActiveTreeId();
    return JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}').placesOffer;
});

test.describe('the offer of the places not on the map after opening a research', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the research takes places: the toast counts them; Look up opens Places with the preview of looking them all up; once per tree', async ({ page }) => {
        const b = await research(page);
        expect(await offerState(page)).toBe('armed');
        await poll(page);
        // Kvelín, Brodnice and Zálesná Ves: none on the map.
        await expect(offer(page)).toContainText('3 places not on the map – look them up in the research?');
        expect(await offerState(page)).toBe('done');
        await offer(page).locator('.toast-action').click();
        const modal = page.locator('#places-modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('.places-bulk[data-bulk="look"]')).toBeVisible();
        await expect(modal.locator('.places-bulk-go')).toBeFocused();
        await expect(modal.locator('.places-chip[data-filter="none"]')).toHaveAttribute('aria-pressed', 'true');
        expect(b.places!.identify).toEqual([]);
        await modal.locator('.places-bulk-go').click();
        await expect.poll(() => b.places!.identify).toEqual([{ do: 'queue', all: 'offmap' }]);
        // Never again for this tree.
        await page.evaluate(() => window.Strom.UI.closePlacesManager());
        await expect(modal).toBeHidden();
        await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
        await poll(page);
        await page.waitForTimeout(300);
        await expect(offer(page)).toHaveCount(0);
    });

    test('closed with ×: not offered again; the research\'s own count in German, one place', async ({ page }) => {
        await research(page, { reply: { rev: 'p1', places: {}, forms: {}, counts: { offMap: 1, placed: 2 } } });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await poll(page);
        await expect(offer(page)).toContainText('1 Ort nicht auf der Karte – in der Forschung suchen?');
        await expect(offer(page).locator('.toast-action')).toHaveText('Suchen');
        await offer(page).locator('.toast-close').click();
        await expect(offer(page)).toHaveCount(0);
        await poll(page);
        await page.waitForTimeout(300);
        await expect(offer(page)).toHaveCount(0);
        expect(await offerState(page)).toBe('done');
    });

    test('no offer when nothing is off the map', async ({ page }) => {
        await research(page, { reply: { rev: 'p1', places: {}, forms: {}, counts: { offMap: 0, placed: 3 } } });
        await poll(page);
        await expect.poll(() => offerState(page)).toBe('done');
        await expect(offer(page)).toHaveCount(0);
    });

    test('no offer from a research without places.identify; it is not kept for later', async ({ page }) => {
        await research(page, { features: [] });
        await poll(page);
        await expect.poll(() => offerState(page)).toBe('done');
        await expect(offer(page)).toHaveCount(0);
    });
});
