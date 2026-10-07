import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedSetting, cardBoxesMatchLayout } from './helpers.js';

/**
 * The "Custom" card's height "by content" (U02 V3, the default): every card is
 * as tall as its own details, top-aligned in its generation's band; a band is
 * as tall as its tallest card; the partner line runs 25px below the top of
 * every card; a single parent's line starts at the bottom of its own card;
 * the generation labels, the hit boxes and the image export follow each
 * card's height. Invented data.
 */

const LONG_PLACE = 'Nové Město na Moravě, okres Žďár nad Sázavou, Kraj Vysočina';

/**
 * Jan (three details) + Marie (one) → Anna (a long birth place) and Karel.
 * Anna + Petr → Eva; Karel alone → Ota (a single parent).
 */
function ged(): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 1862', '2 PLAC Horní Lhota', '1 DEAT', '2 DATE 1919', '2 PLAC Brno',
        '1 OCCU mlynář', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Marie /Dvořáková/', '1 SEX F', '1 BIRT', '2 DATE 1869', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME Anna /Vlková/', '1 SEX F',
        '1 BIRT', '2 DATE 1890', '2 PLAC ' + LONG_PLACE, '1 DEAT', '2 DATE 1950', '2 PLAC Brno',
        '1 FAMC @F1@', '1 FAMS @F2@',
        '0 @I4@ INDI', '1 NAME Petr /Novák/', '1 SEX M', '1 BIRT', '2 DATE 1888', '1 FAMS @F2@',
        '0 @I5@ INDI', '1 NAME Karel /Vlk/', '1 SEX M', '1 BIRT', '2 DATE 1892', '1 FAMC @F1@', '1 FAMS @F3@',
        '0 @I6@ INDI', '1 NAME Eva /Nováková/', '1 SEX F', '1 BIRT', '2 DATE 1915', '1 FAMC @F2@',
        '0 @I7@ INDI', '1 NAME Ota /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 1920', '2 PLAC Brno', '1 DEAT', '2 DATE 1990', '2 PLAC Praha', '1 FAMC @F3@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 CHIL @I5@',
        '0 @F2@ FAM', '1 HUSB @I4@', '1 WIFE @I3@', '1 CHIL @I6@',
        '0 @F3@ FAM', '1 HUSB @I5@', '1 CHIL @I7@',
        '0 TRLR',
    ].join('\n');
}

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'vlkovi.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

/** The custom card in its default (no saved choices), the tree imported, Anna in focus, the cards measured. */
async function setup(page: Page, width = 1440): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await seedSetting(page, 'cardDensity', 'custom');
    await openApp(page);
    await dropFile(page, ged());
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, 'Ota')).toBeVisible();
    await page.evaluate(() => {
        const anna = window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Anna')!;
        window.Strom.TreeRenderer.setFocus(anna.id);
    });
    await expect(page.locator('#tree-canvas .person-card.focused .name-text')).toHaveText(/Anna/);
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
}

interface Drawn {
    name: string; id: string; x: number; y: number; height: number; width: number; own: number | null;
    /** The "+ partner" pill's middle from the card's top (unscaled). */
    pill: number | null;
}

/** Every drawn card: its layout position, its box, its own height in the layout. */
async function drawn(page: Page): Promise<Drawn[]> {
    return page.evaluate(() => {
        const r = window.Strom.TreeRenderer as unknown as {
            positions: Map<string, { x: number; y: number }>; config: { personHeights?: Map<string, number> };
        };
        return [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')].map(el => {
            const id = el.dataset.id!;
            const pos = r.positions.get(id)!;
            const c = el.getBoundingClientRect();
            const scale = c.width / el.offsetWidth;
            const pill = el.querySelector<HTMLElement>('.edge-right-center')?.getBoundingClientRect();
            return {
                name: el.querySelector('.name-text')?.textContent ?? '', id, x: pos.x, y: pos.y,
                height: el.offsetHeight, width: el.offsetWidth, own: r.config.personHeights?.get(id) ?? null,
                pill: pill ? ((pill.top + pill.bottom) / 2 - c.top) / scale : null,
            };
        });
    });
}

const byName = (cards: Drawn[], first: string) => cards.find(c => c.name.startsWith(first))!;

interface Geometry {
    bands: { generation: number; top: number; height: number }[];
    spouseLines: { y: number; person1Id: string; person2Id: string }[];
    connections: { stemTopY: number; stemPersonId?: string; branchY: number; drops: { personId: string }[] }[];
    labels: { label: string; rowCenterY: number; bandTopY: number; bandBottomY: number }[];
}

/** The layout's bands, lines and the renderer's generation label bands. */
async function geometry(page: Page): Promise<Geometry> {
    return page.evaluate(() => {
        const r = window.Strom.TreeRenderer as unknown as Omit<Geometry, 'bands' | 'labels'> & {
            layoutBands: Geometry['bands']; getGenerationBands(): Geometry['labels'];
        };
        return {
            bands: r.layoutBands, spouseLines: r.spouseLines, connections: r.connections,
            labels: r.getGenerationBands().map(b => ({ label: b.label, rowCenterY: b.rowCenterY, bandTopY: b.bandTopY, bandBottomY: b.bandBottomY })),
        };
    });
}

async function posterSvg(page: Page): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#poster-modal .menu-option', { hasText: 'SVG' }).click(),
    ]);
    const { readFileSync } = await import('fs');
    return readFileSync(await download.path(), 'utf-8');
}

test.describe('card height by content (U02 V3)', () => {
    test('each card is as tall as its details, top-aligned in its band; the band is the tallest; the lines follow', async ({ page }) => {
        await setup(page);
        expect(await page.evaluate(() => window.Strom.SettingsManager.getCardFields().height)).toBe('content');
        const cards = await drawn(page);
        // Every card has its own height in the layout and is drawn with it.
        for (const c of cards) expect(c.height, c.name).toBe(c.own);
        const [jan, marie, anna, petr, karel, eva, ota] = ['Jan', 'Marie', 'Anna', 'Petr', 'Karel', 'Eva', 'Ota'].map(n => byName(cards, n));
        // Jan three details, Marie one; Anna's long place wraps; Petr and Karel one each.
        expect(jan.height).toBe(50 + 6 + 3 * 17 + 2 * 3);
        expect(marie.height).toBe(50 + 6 + 17);
        expect(anna.height).toBeGreaterThan(50 + 6 + 2 * 17 + 3);
        expect([petr.height, karel.height]).toEqual([73, 73]);
        expect(ota.height).toBe(93);
        // One width for all; one top per generation.
        expect(new Set(cards.map(c => c.width)).size).toBe(1);
        expect(jan.y).toBe(marie.y);
        expect(new Set([anna.y, petr.y, karel.y]).size).toBe(1);
        expect(eva.y).toBe(ota.y);

        const g = await geometry(page);
        const band = (gen: number) => g.bands.find(b => b.generation === gen)!;
        // A band is as tall as its tallest card, 80px between bands.
        expect(g.bands.map(b => b.generation)).toEqual([-1, 0, 1]);
        expect(band(-1)).toMatchObject({ top: jan.y, height: jan.height });
        expect(band(0)).toMatchObject({ top: anna.y, height: anna.height });
        expect(band(1)).toMatchObject({ top: eva.y, height: Math.max(eva.height, ota.height) });
        expect(band(0).top).toBe(band(-1).top + band(-1).height + 80);
        expect(band(1).top).toBe(band(0).top + band(0).height + 80);

        // The partner line 25px below the top of both partners' cards, the "+ partner" pill with it.
        expect(g.spouseLines).toHaveLength(2);
        for (const sl of g.spouseLines) {
            for (const id of [sl.person1Id, sl.person2Id]) {
                const c = cards.find(x => x.id === id)!;
                expect(sl.y - c.y, c.name).toBe(25);
            }
        }
        for (const c of [jan, marie, anna, petr]) expect(Math.abs(c.pill! - 25), c.name).toBeLessThanOrEqual(0.5);

        // The couple's line down from the partner line; the bus in the middle of the gap between the bands.
        const couple = g.connections.find(c => c.drops.some(d => d.personId === eva.id))!;
        expect(couple.stemPersonId).toBeUndefined();
        expect(couple.stemTopY).toBe(anna.y + 25);
        expect(couple.branchY).toBe(band(0).top + band(0).height + 40);
        const parents = g.connections.find(c => c.drops.some(d => d.personId === anna.id))!;
        expect(parents.branchY).toBe(band(-1).top + band(-1).height + 40);
        // Karel alone: his line starts at the bottom of his own (shorter) card, drawn so.
        const single = g.connections.find(c => c.drops.some(d => d.personId === ota.id))!;
        expect(single.stemPersonId).toBe(karel.id);
        expect(single.stemTopY).toBe(karel.y + karel.height);
        expect(single.stemTopY).toBeLessThan(band(0).top + band(0).height);
        const stems = await page.evaluate(y => [...document.querySelectorAll<SVGLineElement>('#tree-lines line.child-link')]
            .filter(l => Math.abs(l.y1.baseVal.value - y) < 0.01 && l.x1.baseVal.value === l.x2.baseVal.value).length, single.stemTopY);
        expect(stems).toBe(1);

        // The generation labels: one per band, named from the focus, centred on the band, the rule half the gap above it.
        expect(g.labels.map(l => l.label)).toEqual(['PARENTS', 'FOCUS GENERATION', 'CHILDREN']);
        g.labels.forEach((l, i) => {
            const b = g.bands[i];
            expect(l).toEqual({ label: l.label, rowCenterY: b.top + b.height / 2, bandTopY: b.top - 40, bandBottomY: b.top + b.height + 40 });
        });
        const rules = await page.evaluate(() => [...document.querySelectorAll<SVGLineElement>('#tree-lines line.gen-guide-line')].map(l => l.y1.baseVal.value));
        expect(rules).toEqual(g.bands.map(b => b.top - 40));
        // The label overlay's card boxes are the cards' own.
        const rects = await page.evaluate(() => window.Strom.TreeRenderer.getCardWorldRects().map(r => r.h).sort((a, b) => a - b));
        expect(rects).toEqual(cards.map(c => c.height).sort((a, b) => a - b));
    });

    test('Equal makes every card as tall as the tallest; By content brings each card its own height back', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const segment = page.locator('#card-fields-settings .card-look-height');
        await expect(segment).toHaveAttribute('role', 'group');
        await expect(segment.locator('.segment-btn')).toHaveText(['Equal', 'By content']);
        await expect(segment.locator('[aria-pressed="true"]')).toHaveText('By content');
        const tallest = Math.max(...(await drawn(page)).map(c => c.height));

        await segment.getByRole('button', { name: 'Equal', exact: true }).click();
        await expect(segment.getByRole('button', { name: 'Equal', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => new Set((await drawn(page)).map(c => c.height)).size).toBe(1);
        expect(await page.evaluate(() => window.Strom.SettingsManager.getCardFields().height)).toBe('view');
        const equal = await drawn(page);
        expect(equal[0].height).toBe(tallest);
        expect(equal.every(c => c.own === null)).toBe(true);
        // The details still wrap: the partner line stays at the header.
        const g = await geometry(page);
        for (const sl of g.spouseLines) expect(sl.y - equal.find(c => c.id === sl.person1Id)!.y).toBe(25);
        expect(g.bands.every(b => b.height === tallest)).toBe(true);
        // Brief no longer matches (its height is by content).
        await expect(page.locator('#card-fields-settings .card-preset-segment [aria-pressed="true"]')).toHaveCount(0);

        await segment.getByRole('button', { name: 'By content', exact: true }).click();
        await expect.poll(async () => new Set((await drawn(page)).map(c => c.height)).size).toBeGreaterThan(2);
        await expect(page.locator('#card-fields-settings .card-preset-segment [aria-pressed="true"]')).toHaveText('Brief');
    });

    test('one row a detail by content: each card 56 + 17 a detail, the partner line at the header', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const s = window.Strom.SettingsManager;
            s.setCardFields({ ...s.getCardFields(), lines: 1 });
            window.Strom.TreeRenderer.render();
        });
        await expect.poll(async () => byName(await drawn(page), 'Anna').height).toBe(50 + 6 + 2 * 17);
        await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
        const cards = await drawn(page);
        expect(byName(cards, 'Jan').height).toBe(50 + 6 + 3 * 17);
        expect(byName(cards, 'Marie').height).toBe(50 + 6 + 17);
        const g = await geometry(page);
        for (const sl of g.spouseLines) expect(sl.y - cards.find(c => c.id === sl.person2Id)!.y).toBe(25);
        for (const c of cards.filter(c => c.pill !== null)) expect(Math.abs(c.pill! - 25), c.name).toBeLessThanOrEqual(0.5);
    });

    test('the image export draws every card and its branch stripe with that card\'s own height', async ({ page }) => {
        await setup(page);
        const cards = await drawn(page);
        expect(new Set(cards.map(c => c.height)).size).toBeGreaterThan(2);
        const svg = await posterSvg(page);
        const rects = [...svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)" rx="8"[^>]*\/>(\s*<path class="branch-stripe" d="([^"]+)")?/g)]
            .map(m => ({ x: Number(m[1]), y: Number(m[2]), height: Number(m[4]), stripe: m[6] ?? null }));
        expect(rects).toHaveLength(cards.length);
        // Positions as laid out: each card's rect is its own height.
        for (const c of cards) {
            const r = rects.find(x => Math.abs(x.x - c.x) < 0.05 && Math.abs(x.y - c.y) < 0.05)!;
            expect(r, c.name).toBeTruthy();
            expect(r.height, c.name).toBe(c.height);
            if (r.stripe) {
                const ys = [...r.stripe.matchAll(/(?:M|L|0 0 0 )(-?[\d.]+) (-?[\d.]+)/g)].map(p => Number(p[2]));
                // From the outer edge of the border, its inner edge 1px into each corner arc.
                expect(Math.max(...ys) - Math.min(...ys), c.name).toBeCloseTo(c.height - 1, 1);
            }
        }
        // The stripe on the cards the screen tags with a branch.
        const tagged = await page.locator('#tree-canvas .person-card[class*="branch-"]').count();
        expect(tagged).toBeGreaterThan(1);
        expect(rects.filter(r => r.stripe).length).toBe(tagged);
        // The poster's size: the lowest card's own bottom.
        const height = Number(/<svg [^>]*height="(\d+)"/.exec(svg)![1]);
        const top = Math.min(...cards.map(c => c.y));
        const bottom = Math.max(...cards.map(c => c.y + c.height));
        expect(height).toBe(Math.round(bottom - top + 2 * 40 + 44));
    });

    test('the family book\'s tree page draws the custom cards the layout was made for', async ({ page, context }) => {
        await setup(page);
        const cards = await drawn(page);
        expect(new Set(cards.map(c => c.height)).size).toBeGreaterThan(2);
        await page.evaluate(() => window.Strom.UI.showBookDialog());
        const dialog = page.locator('#book-modal');
        await dialog.locator('#book-privacy-mode').selectOption('full');
        const [book] = await Promise.all([
            context.waitForEvent('page'),
            dialog.getByRole('button', { name: 'Open book' }).click(),
        ]);
        await book.waitForLoadState('domcontentloaded');
        const svg = await book.locator('.book-tree-wrap svg').evaluate(el => el.outerHTML);
        const rects = [...svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)" rx="8"/g)]
            .map(m => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) }));
        expect(rects).toHaveLength(cards.length);
        // Each card as wide and as tall as on screen (not the default 188x64 card).
        for (const c of cards) {
            const r = rects.find(x => Math.abs(x.x - c.x) < 0.05 && Math.abs(x.y - c.y) < 0.05)!;
            expect(r, c.name).toBeTruthy();
            expect([r.width, r.height], c.name).toEqual([c.width, c.height]);
        }
        // The custom card's details are drawn, in the fonts they were measured with.
        expect(svg).toContain('Horní Lhota');
        expect(svg).toContain('@font-face');
        // The partner line runs at the cards' header, 25px below their top (inside the cards).
        const anna = byName(cards, 'Anna');
        expect(svg).toMatch(new RegExp(`<line x1="[\\d.-]+" y1="${(anna.y + 25).toFixed(1)}"`));
    });

    for (const theme of ['light', 'dark'] as const) {
        test(`phone 360, ${theme}: the cards keep their own heights, the hit box is the card, no page scroll`, async ({ page }) => {
            await setup(page, 360);
            await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
            const cards = await drawn(page);
            for (const c of cards) expect(c.height, c.name).toBe(c.own);
            expect(new Set(cards.map(c => c.height)).size).toBeGreaterThan(2);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
            // The card's box takes the click at its own bottom edge (not the band's).
            const ota = byName(cards, 'Ota');
            await page.evaluate(({ x, y }) => window.Strom.ZoomPan.centerOnWorldPoint(x, y), { x: ota.x + ota.width / 2, y: ota.y + ota.height / 2 });
            await page.waitForTimeout(400);
            const box = (await card(page, 'Ota').boundingBox())!;
            const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.person-card')?.querySelector('.name-text')?.textContent ?? '',
                { x: box.x + box.width / 2, y: box.y + box.height - 2 });
            expect(hit).toContain('Ota');
            // The card's surface follows the theme.
            const bg = await card(page, 'Anna').evaluate(el => getComputedStyle(el).backgroundColor);
            const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
            expect(bg).not.toBe(pageBg);
            const dark = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b, 0) < 3 * 128;
            expect(dark(bg)).toBe(theme === 'dark');
        });
    }
});
