import { test, expect, Page } from '@playwright/test';
import { openApp, cardAction, personModal } from './helpers.js';

/**
 * Where an entry stands, as the app shows it (spec 075 §2, §4): the source
 * viewer's Book / Entry rows (an older source's Location) with the page's
 * link or the sentence without one, the record date and reliability alone
 * under the title; the sources manager's row on a computer and on a phone;
 * a citation chip's three-line tooltip. Invented data only.
 */

type Rec = Record<string, unknown>;

const NEW: Rec = {
    title: 'Křest – Anna Vzorková, 1834', repository: 'Zemský archiv Vzorov', callNumber: 'N 7', folio: 'fol. 12v', image: '34',
    reference: 'no. 5', recordDate: '1834-05-03', quality: 3, url: 'https://archive.example/vzorov/n7/34',
};
const OLD: Rec = { title: 'Oddací matrika Pokusov 1820–1835', repository: 'Zemský archiv Vzorov', reference: 'fol. 31 recto, image 3, no. 2' };
const PARTIAL: Rec = { title: 'Taufe – Johanna Mustermannová', repository: 'Zemský archiv Vzorov', image: '57–58' };

/** Research fields on, one person "Anna" citing the given sources. */
async function tree(page: Page, sources: Record<string, Rec>, width = 1440): Promise<void> {
    await page.setViewportSize({ width, height: width < 641 ? 844 : 900 });
    await openApp(page);
    await page.evaluate(async (sources) => {
        window.Strom.SettingsManager.setAdvancedFields(true);
        const all: Record<string, unknown> = {};
        for (const [id, s] of Object.entries(sources)) all[id] = { id, ...s };
        await window.Strom.DataManager.importAsNewTree({
            persons: { anna: { id: 'anna', firstName: 'Anna', lastName: 'Vzorková', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], birthDate: '1834', sourceIds: Object.keys(sources) } },
            partnerships: {}, sources: all,
        } as never, 'Prameny');
    }, sources);
}

const viewer = (page: Page) => page.locator('#source-viewer-modal');
const catalog = (page: Page) => page.locator('#sources-modal');

async function openViewer(page: Page, title: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    await catalog(page).locator('.source-row-open', { hasText: title }).click();
    await expect(viewer(page)).toBeVisible();
}

const rows = (page: Page) => viewer(page).locator('.viewer-place').evaluate(dl =>
    [...dl.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling?.textContent]));

test.describe('the source viewer', () => {
    test('a source with fields: the date and reliability under the title, Book and Entry under the excerpts, the page link under them', async ({ page }) => {
        await tree(page, { s1: NEW });
        await openViewer(page, 'Křest');
        await expect(viewer(page).locator('#source-viewer-meta')).toHaveText('recorded 3 May 1834 · Original');
        expect(await rows(page)).toEqual([['Book', 'Zemský archiv Vzorov · N 7'], ['Entry', 'fol. 12v · image 34 · no. 5']]);
        const block = viewer(page).locator('.viewer-place-block');
        await expect(block.locator('a.viewer-open-page')).toHaveAttribute('href', 'https://archive.example/vzorov/n7/34');
        await expect(block.locator('.viewer-no-url')).toHaveCount(0);
    });

    test('an older source: Book and its whole Location; without a link a sentence says how the entry is found', async ({ page }) => {
        await tree(page, { s1: OLD, s2: PARTIAL, s3: { title: 'Holý pramen' } });
        await openViewer(page, 'Oddací');
        expect(await rows(page)).toEqual([['Book', 'Zemský archiv Vzorov'], ['Location', 'fol. 31 recto, image 3, no. 2']]);
        await expect(viewer(page).locator('.viewer-no-url')).toHaveText('No link. The entry is found by its book and entry details.');
        await expect(viewer(page).locator('a.viewer-open-page')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await openViewer(page, 'Taufe');
        expect(await rows(page)).toEqual([['Book', 'Zemský archiv Vzorov'], ['Entry', 'image 57–58']]);
        await page.keyboard.press('Escape');

        // Nothing of the place known: no rows and no sentence.
        await openViewer(page, 'Holý');
        await expect(viewer(page).locator('.viewer-place, .viewer-no-url')).toHaveCount(0);
        // Neither date nor reliability: no empty line under the title.
        await expect(viewer(page).locator('#source-viewer-meta')).toBeHidden();
    });
});

test.describe('the sources manager', () => {
    test('a row names archive · call number · folio · image short; an older one archive · location', async ({ page }) => {
        await tree(page, { s1: NEW, s2: OLD });
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        const row = (t: string) => catalog(page).locator('.source-row', { hasText: t }).locator('.source-meta');
        await expect(row('Křest')).toHaveText('— Zemský archiv Vzorov · N 7 · fol. 12v · img. 34');
        await expect(row('Oddací')).toHaveText('— Zemský archiv Vzorov · fol. 31 recto, image 3, no. 2');
        // The search finds the call number and the folio.
        await page.evaluate(() => {
            for (let i = 0; i < 10; i++) window.Strom.DataManager.addSource({ title: `Pramen ${i}` });
            window.Strom.UI.renderSourcesList();
        });
        await catalog(page).locator('#sources-search').fill('12v');
        await expect(catalog(page).locator('.source-row')).toHaveCount(1);
        await expect(catalog(page).locator('.source-row .source-title')).toHaveText('Křest – Anna Vzorková, 1834');
    });

    test('on a phone the archive gives way to the call number, the line wraps and nothing runs over', async ({ page }) => {
        await tree(page, { s1: { ...NEW, title: 'Křest – Anna Vzorková, Pokusov u Vzorova, 1834', repository: 'Zemský archiv Vzorov, pobočka Pokusov' }, s2: OLD }, 390);
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        const row = (t: string) => catalog(page).locator('.source-row', { hasText: t }).locator('.source-meta');
        await expect(row('Křest')).toHaveText('— N 7 · fol. 12v · img. 34');
        await expect(row('Oddací')).toHaveText('— Zemský archiv Vzorov · fol. 31 recto, image 3, no. 2');
        const over = await catalog(page).locator('.source-row').evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).length);
        expect(over).toBe(0);
    });
});

test.describe('a long title without spaces', () => {
    // 60 characters without a space (a file name typed as the title), wider than the viewer's header at 1440.
    const LONG = 'MATRIKA_VZOROV_N7_KRTY_ODDANI_ZEMRELI_1820_1835_SKENY_000123';
    for (const width of [390, 1440]) {
        test(`wraps in the sources manager's row and the viewer's header at ${width}, nothing runs over`, async ({ page }) => {
            expect(LONG).toHaveLength(60);
            await tree(page, { s1: { ...NEW, title: LONG }, s2: OLD }, width);
            await page.evaluate(() => window.Strom.UI.showSourcesDialog());
            const row = catalog(page).locator('.source-row', { hasText: LONG });
            await expect(row.locator('.source-title')).toHaveText(LONG);
            const over = (sel: string) => (els: Element[]) => els.filter(el => el.scrollWidth > el.clientWidth + 1)
                .map(el => `${sel} ${el.tagName}.${(el as HTMLElement).className}: ${el.scrollWidth} > ${el.clientWidth}`);
            expect(await catalog(page).locator('.source-row, .source-row *').evaluateAll(over('row'))).toEqual([]);
            const rowBox = (await row.boundingBox())!;
            const titleBox = (await row.locator('.source-title').boundingBox())!;
            expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
            await row.locator('.source-row-open').click();
            await expect(viewer(page)).toBeVisible();
            const h2 = viewer(page).locator('#source-viewer-title');
            await expect(h2).toHaveText(LONG);
            expect(await viewer(page).locator('.source-viewer-header, .source-viewer-header *').evaluateAll(over('header'))).toEqual([]);
            const head = (await viewer(page).locator('.source-viewer-header').boundingBox())!;
            const h2Box = (await h2.boundingBox())!;
            expect(h2Box.x + h2Box.width).toBeLessThanOrEqual(head.x + head.width + 0.5);
            expect(h2Box.x + h2Box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        });
    }
});

test.describe('a citation chip', () => {
    test('its tooltip has three lines: the title, the book, the entry (an older source: its location)', async ({ page }) => {
        await tree(page, { s1: NEW, s2: OLD, s3: { title: 'Holý pramen' } });
        await cardAction(page, 'Anna', 'edit');
        const chips = personModal(page).locator('#person-sources-chips .source-chip-open');
        await expect(chips).toHaveCount(3);
        await expect(chips.filter({ hasText: 'Křest' })).toHaveAttribute('title', 'Křest – Anna Vzorková, 1834\nZemský archiv Vzorov · N 7\nfol. 12v · image 34 · no. 5');
        await expect(chips.filter({ hasText: 'Oddací' })).toHaveAttribute('title', 'Oddací matrika Pokusov 1820–1835\nZemský archiv Vzorov\nfol. 31 recto, image 3, no. 2');
        await expect(chips.filter({ hasText: 'Holý' })).toHaveAttribute('title', 'Holý pramen');
        await expect(chips.filter({ hasText: 'Křest' })).toHaveAttribute('aria-label', /Křest – Anna Vzorková, 1834/);
        // A click opens the viewer as before.
        await chips.filter({ hasText: 'Křest' }).click();
        await expect(viewer(page)).toBeVisible();
        await expect(viewer(page).locator('#source-viewer-title')).toHaveText('Křest – Anna Vzorková, 1834');
    });
});
