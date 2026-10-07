import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedSetting } from './helpers.js';

/**
 * The "Custom" card is as wide as the view's longest text (T04, T12): one
 * width for every card, 200–320px in 4px steps, the layout spaced by it and
 * the poster drawn with it. A line is a grid — mark, date, place — with one
 * date column for the view, so places of all cards start at one x (T05).
 * Invented data.
 */

function ged(childPlace: string): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 1862', '2 PLAC Horní Lhota',
        '1 DEAT', '2 DATE 1919', '2 PLAC Brno', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Marie /Dvořáková/', '1 SEX F',
        '1 BIRT', '2 DATE 1869', '2 PLAC Dolní Lhota',
        '1 DEAT', '2 DATE AFT 1919', '2 PLAC Brno', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME Anna /Vlková/', '1 SEX F',
        '1 BIRT', '2 DATE 1890', '2 PLAC ' + childPlace,
        '1 DEAT', '2 DATE 1912', '2 PLAC Brno', '1 FAMC @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@',
        '0 TRLR',
    ].join('\n');
}

/** Wide enough to widen the card, narrow enough to fit under 320px. */
const MEDIUM_PLACE = 'Horní Lhota u Bystřice nad Pernštejnem';
/** Wider than any card: shortened with an ellipsis. */
const LONG_PLACE = 'Nové Město na Moravě, okres Žďár nad Sázavou, Kraj Vysočina, Česká republika';

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'vlkovi.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

async function setup(page: Page, childPlace: string, width = 1440): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await seedSetting(page, 'cardDensity', 'custom');
    await openApp(page);
    await dropFile(page, ged(childPlace));
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, 'Anna')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe('custom');
    // Measured in the card fonts: once they are in, the boxes match the layout.
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(async () => {
        const { widths, layout } = await cardWidths(page);
        return widths.length > 0 && widths.every(w => w === layout);
    }).toBe(true);
}

/** Every card's box width (not as zoomed on screen) and the layout's card width. */
async function cardWidths(page: Page): Promise<{ widths: number[]; layout: number }> {
    return page.evaluate(() => ({
        widths: [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')].map(el => el.offsetWidth),
        layout: (window.Strom.TreeRenderer as unknown as { config: { cardWidth: number } }).config.cardWidth,
    }));
}

/** Per line of a card: date and place cells, where the place starts in the card, whether a cell is cut. */
async function lineCells(page: Page, first: string) {
    return card(page, first).locator('.card-line').evaluateAll(lines => lines.map(line => {
        const cardEl = line.closest('.person-card') as HTMLElement;
        const date = line.querySelector('.card-line-date') as HTMLElement | null;
        const rest = line.querySelector('.card-line-rest') as HTMLElement | null;
        // Unscaled offset of the place from the card's border box (the canvas may be zoomed).
        const scale = cardEl.getBoundingClientRect().width / cardEl.offsetWidth;
        return {
            date: date?.textContent ?? '',
            dateCut: date ? date.scrollWidth > date.clientWidth : false,
            place: rest?.textContent ?? '',
            placeCut: rest ? rest.scrollWidth > rest.clientWidth : false,
            placeX: rest ? Math.round((rest.getBoundingClientRect().left - cardEl.getBoundingClientRect().left) / scale) : -1,
        };
    }));
}

test.describe('the custom card width', () => {
    test('a long place widens every card of the view alike, in 4px steps, and the layout spaces by it', async ({ page }) => {
        await setup(page, MEDIUM_PLACE);
        const { widths, layout } = await cardWidths(page);
        expect(widths.length).toBe(3);
        const w = widths[0];
        expect(new Set(widths).size).toBe(1);
        expect(w).toBeGreaterThan(200);
        expect(w).toBeLessThanOrEqual(320);
        expect(w % 4).toBe(0);
        expect(layout).toBe(w);
        // The place that set the width is shown whole.
        const anna = await lineCells(page, 'Anna');
        expect(anna[0]).toMatchObject({ date: '1890', place: MEDIUM_PLACE, placeCut: false, dateCut: false });
        // Cards spaced for that width never overlap.
        const overlaps = await page.evaluate(() => {
            const r = [...document.querySelectorAll('#tree-canvas .person-card')].map(c => c.getBoundingClientRect());
            let n = 0;
            for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
                if (r[i].left < r[j].right - 1 && r[j].left < r[i].right - 1 && r[i].top < r[j].bottom - 1 && r[j].top < r[i].bottom - 1) n++;
            }
            return n;
        });
        expect(overlaps).toBe(0);
    });

    test('above 320px only the place shortens; dates stay whole and places start at one x', async ({ page }) => {
        await setup(page, LONG_PLACE);
        const { widths } = await cardWidths(page);
        expect(widths).toEqual([320, 320, 320]);
        const anna = await lineCells(page, 'Anna');
        expect(anna[0]).toMatchObject({ date: '1890', place: LONG_PLACE, placeCut: true, dateCut: false });
        // "after 1919" sets the date column; "1862" and "1890" leave it alone.
        const marie = await lineCells(page, 'Marie');
        const jan = await lineCells(page, 'Jan');
        expect(marie[1]).toMatchObject({ date: 'after 1919', dateCut: false, place: 'Brno', placeCut: false });
        const xs = [...jan, ...marie, ...anna].map(c => c.placeX);
        expect(new Set(xs).size).toBe(1);
        expect(xs[0]).toBeGreaterThan(0);
    });

    test('the poster draws the same width and the date and the place as two texts at the date column', async ({ page }) => {
        await setup(page, MEDIUM_PLACE);
        const { widths } = await cardWidths(page);
        const dateCol = await page.evaluate(() => parseFloat(getComputedStyle(document.body).getPropertyValue('--card-date-col')));
        expect(dateCol).toBeGreaterThan(0);
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#poster-modal .menu-option', { hasText: 'SVG' }).click(),
        ]);
        const { readFileSync } = await import('fs');
        const svg = readFileSync(await download.path(), 'utf-8');
        const rects = [...svg.matchAll(/<rect x="(-?[\d.]+)" y="-?[\d.]+" width="(\d+)" height="(\d+)" rx="8"/g)];
        expect(rects.length).toBe(3);
        for (const r of rects) expect(Number(r[2])).toBe(widths[0]);
        // Anna's birth line: the date and the place, each its own text.
        const date = svg.match(/<text class="card-line-date" x="([\d.-]+)" y="([\d.-]+)"[^>]*>1890<\/text>/);
        const place = svg.match(new RegExp(`<text class="card-line-place" x="([\\d.-]+)" y="([\\d.-]+)"[^>]*>${MEDIUM_PLACE}</text>`));
        expect(date).not.toBeNull();
        expect(place).not.toBeNull();
        expect(place![2]).toBe(date![2]);
        // place x = card left + 12 + 17 + date column + 6; the date at card left + 12 + 17.
        const annaRect = rects.find(r => Math.abs(Number(r[1]) + 29 - Number(date![1])) < 0.11);
        expect(annaRect).toBeTruthy();
        expect(Number(place![1])).toBeCloseTo(Number(annaRect![1]) + 12 + 17 + dateCol + 6, 1);
    });

    test('phone 360: the same width rule, no page scroll', async ({ page }) => {
        await setup(page, MEDIUM_PLACE, 360);
        const { widths, layout } = await cardWidths(page);
        expect(new Set(widths).size).toBe(1);
        expect(widths[0]).toBeGreaterThan(200);
        expect(widths[0] % 4).toBe(0);
        expect(layout).toBe(widths[0]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    });
});
