import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedSetting } from './helpers.js';

/**
 * The "Custom" card is as wide as the view's longest text (T04, T12): one
 * width for every card, 200–320px in 4px steps, the layout spaced by it and
 * the poster drawn with it. A line is a grid — mark, date, place — with one
 * date column for the view, so places of all cards start at one x (T05).
 * Invented data.
 */

function ged(childPlace: string, childName = 'Anna /Vlková/'): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 1862', '2 PLAC Horní Lhota',
        '1 DEAT', '2 DATE 1919', '2 PLAC Brno', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Marie /Dvořáková/', '1 SEX F',
        '1 BIRT', '2 DATE 1869', '2 PLAC Dolní Lhota',
        '1 DEAT', '2 DATE AFT 1919', '2 PLAC Brno', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME ' + childName, '1 SEX F',
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

async function setup(page: Page, childPlace: string, width = 1440, childName?: string): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await seedSetting(page, 'cardDensity', 'custom');
    await openApp(page);
    await dropFile(page, ged(childPlace, childName));
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, (childName ?? 'Anna').split(' ')[0])).toBeVisible();
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
            // Cut by any fraction of a pixel (an ellipsis is drawn), which scrollWidth rounds away.
            placeClipped: rest ? (() => {
                const range = document.createRange();
                range.selectNodeContents(rest);
                return range.getBoundingClientRect().width > rest.getBoundingClientRect().width + 0.01 * scale;
            })() : false,
            placeTitle: rest?.getAttribute('title') ?? null,
            placeX: rest ? Math.round((rest.getBoundingClientRect().left - cardEl.getBoundingClientRect().left) / scale) : -1,
        };
    }));
}

/** The poster's SVG, downloaded from the poster dialog. */
async function posterSvg(page: Page): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#poster-modal .menu-option', { hasText: 'SVG' }).click(),
    ]);
    const { readFileSync } = await import('fs');
    return readFileSync(await download.path(), 'utf-8');
}

/** The SVG without its embedded faces and every family replaced by a wide fallback (monospace). */
function withoutAppFonts(svg: string): string {
    return svg.replace(/<defs><style>[\s\S]*?<\/style><\/defs>/, '').replace(/font-family="[^"]*"/g, 'font-family="monospace"');
}

/**
 * The SVG set on a page of its own (no app, no app fonts but what it carries).
 * Per card: its box and the drawn boxes of its name, dates, places; and the
 * faces the page loaded.
 */
async function renderStandalone(page: Page, svg: string) {
    const view = await page.context().newPage();
    await view.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await view.evaluate(() => document.fonts.ready);
    const loaded = await view.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family.replace(/"/g, '')} ${f.weight}`).sort());
    const cards = await view.evaluate(() => {
        const box = (el: SVGGraphicsElement) => { const b = el.getBBox(); return { left: b.x, right: b.x + b.width }; };
        return [...document.querySelectorAll<SVGRectElement>('g.cards > rect[rx="8"]')].map(r => {
            const x = r.x.baseVal.value, y = r.y.baseVal.value, w = r.width.baseVal.value, h = r.height.baseVal.value;
            const inCard = (t: SVGTextElement) => {
                const tx = t.x.baseVal[0].value, ty = t.y.baseVal[0].value;
                return tx >= x && tx <= x + w && ty >= y && ty <= y + h;
            };
            const texts = [...document.querySelectorAll<SVGTextElement>('g.cards text')].filter(inCard);
            return {
                left: x, right: x + w,
                name: texts.filter(t => t.getAttribute('font-size') !== '12' && t.getAttribute('font-weight') === '600' && !t.hasAttribute('text-anchor'))
                    .map(t => ({ text: t.textContent ?? '', ...box(t) }))[0],
                lines: texts.filter(t => t.classList.contains('card-line-date') || t.classList.contains('card-line-place'))
                    .map(t => ({ kind: t.classList.contains('card-line-date') ? 'date' : 'place', y: t.y.baseVal[0].value, text: t.textContent ?? '', ...box(t) })),
            };
        });
    });
    await view.close();
    return { cards, loaded };
}

/** A card's lines in pairs: the date and the place drawn on one row. */
function rows(lines: { kind: string; y: number; text: string; left: number; right: number }[]) {
    const ys = [...new Set(lines.map(l => l.y))];
    return ys.map(y => ({ date: lines.find(l => l.y === y && l.kind === 'date'), place: lines.find(l => l.y === y && l.kind === 'place') }));
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
        // A native tooltip says a place in full exactly when the card cuts it (U02).
        for (const c of [...anna, ...await lineCells(page, 'Jan'), ...await lineCells(page, 'Marie')]) {
            expect(c.placeTitle).toBe(c.placeClipped ? c.place : null);
        }
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
        // The shortened place is said in full in a native tooltip (U02); whole places carry none.
        expect(anna[0].placeTitle).toBe(LONG_PLACE);
        // "after 1919" sets the date column; "1862" and "1890" leave it alone.
        const marie = await lineCells(page, 'Marie');
        const jan = await lineCells(page, 'Jan');
        expect(marie[1]).toMatchObject({ date: 'after 1919', dateCut: false, place: 'Brno', placeCut: false, placeTitle: null });
        expect([...jan, ...marie, ...anna.slice(1)].every(c => !c.placeClipped && c.placeTitle === null)).toBe(true);
        const xs = [...jan, ...marie, ...anna].map(c => c.placeX);
        expect(new Set(xs).size).toBe(1);
        expect(xs[0]).toBeGreaterThan(0);
    });

    test('a shortened place with quotes, angle brackets and an ampersand is said in full in its tooltip (U02)', async ({ page }) => {
        const place = 'Nové Město "na" Moravě <okres> Žďár & Sázava, Kraj Vysočina, Česká republika, Evropa';
        await setup(page, place);
        const anna = await lineCells(page, 'Anna');
        expect(anna[0]).toMatchObject({ place, placeCut: true, placeTitle: place });
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

    test('in the poster a long name stays inside its card also in a wider font than the screen\'s (T12)', async ({ page }) => {
        const name = 'Bartoloměj Wolfensteiner';
        await setup(page, 'Brno', 1440, `${name.split(' ')[0]} /${name.split(' ')[1]}/`);
        const { cards } = await renderStandalone(page, withoutAppFonts(await posterSvg(page)));
        const bart = cards.find(c => c.name?.text === name);
        expect(bart).toBeTruthy();
        // The name sets the card width; drawn in monospace it ran ~25px past without the fix.
        expect(bart!.name.right).toBeLessThanOrEqual(bart!.right - 12 + 0.5);
        for (const c of cards) expect(c.name.right).toBeLessThanOrEqual(c.right - 12 + 0.5);
    });

    test('the poster carries the app\'s fonts; the date ends 6px before the place and a shortened place stays in the card in any font (T05)', async ({ page }) => {
        await setup(page, LONG_PLACE);
        const svg = await posterSvg(page);
        const faces = [...svg.matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)";[^}]*font-weight:\s*(\d+);[^}]*src:\s*url\("data:font\/woff2;base64,/g)]
            .map(m => `${m[1]} ${m[2]}`).sort();
        expect(faces).toEqual(['Instrument Sans 400', 'Instrument Sans 500', 'Source Serif 4 400', 'Source Serif 4 600']);
        const dateCol = await page.evaluate(() => parseFloat(getComputedStyle(document.body).getPropertyValue('--card-date-col')));
        for (const [variant, text] of [['app fonts', svg], ['fallback', withoutAppFonts(svg)]] as const) {
            const { cards, loaded } = await renderStandalone(page, text);
            if (variant === 'app fonts') {
                // The faces the cards are set in came with the file.
                expect(loaded).toEqual(expect.arrayContaining(['Instrument Sans 400', 'Instrument Sans 500', 'Source Serif 4 600']));
            }
            let cut = 0;
            for (const c of cards) {
                for (const { date, place } of rows(c.lines)) {
                    if (date && place) {
                        expect(date.right + 6, `${variant}: ${date.text} | ${place.text}`).toBeLessThanOrEqual(place.left + 0.5);
                        expect(place.left - (c.left + 12 + 17), variant).toBeCloseTo(dateCol + 6, 0);
                    }
                    if (place) {
                        expect(place.right, `${variant}: ${place.text}`).toBeLessThanOrEqual(c.right - 12 + 0.5);
                        if (place.text.includes('…')) cut++;
                    }
                }
            }
            expect(cut, variant).toBe(1);
        }
    });

    test('the PNG is drawn in the app\'s fonts the SVG carries (T05)', async ({ page }) => {
        await setup(page, MEDIUM_PLACE);
        const svg = await posterSvg(page);
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#poster-modal .menu-option', { hasText: 'PNG' }).click(),
        ]);
        const { readFileSync } = await import('fs');
        const png = `data:image/png;base64,${readFileSync(await download.path()).toString('base64')}`;
        // The downloaded PNG against the same SVG rasterised with its fonts and without them.
        const same = await page.evaluate(async ({ png, svg }) => {
            const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
                const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src;
            });
            const shot = await load(png);
            const pixels = async (src: string) => {
                const img = await load(src);
                const c = document.createElement('canvas'); c.width = shot.naturalWidth; c.height = shot.naturalHeight;
                const ctx = c.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                return ctx.getImageData(0, 0, c.width, c.height).data;
            };
            const toUrl = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
            const [got, withFonts, without] = await Promise.all([pixels(png), pixels(toUrl(svg)),
                pixels(toUrl(svg.replace(/<defs><style>[\s\S]*?<\/style><\/defs>/, '')))]);
            const differ = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.some((v, i) => v !== b[i]);
            return { asWithFonts: !differ(got, withFonts), asWithout: !differ(got, without) };
        }, { png, svg });
        expect(same).toEqual({ asWithFonts: true, asWithout: false });
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
