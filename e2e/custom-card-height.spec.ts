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

/**
 * The details these checks were written for: the custom card's default before
 * the age line (U03a) — birth, death, occupation.
 */
const PRE_AGE_ON = ['birth', 'death', 'occupation'];

/** The custom card in its default appearance (birth, death, occupation), the tree imported, Anna in focus, the cards measured. */
async function setup(page: Page, width = 1440): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await seedSetting(page, 'cardDensity', 'custom');
    await seedSetting(page, 'cardFields', { on: PRE_AGE_ON });
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

        await segment.getByRole('button', { name: 'By content', exact: true }).click();
        await expect.poll(async () => new Set((await drawn(page)).map(c => c.height)).size).toBeGreaterThan(2);
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

    test('the minimap draws every card with the view\'s width and its own height', async ({ page }) => {
        await setup(page);
        const cards = await drawn(page);
        for (let i = 0; i < 4; i++) await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
        await expect(page.locator('#minimap-panel')).toBeVisible();
        // The zoom glides, and the minimap's viewport frame follows it (a redraw
        // 30 ms after each step): probed before the last redraw, the moving
        // frame could cross the empty spot below a short card on a slow machine.
        await expect.poll(() => page.evaluate(() =>
            (window.Strom.ZoomPan as unknown as { animationFrame: number | null }).animationFrame === null
            && (window.Strom.UI as unknown as { minimapViewportTimer: unknown }).minimapViewportTimer == null)).toBe(true);
        // The box the minimap fits and steers in: the cards' own outline.
        const box = await page.evaluate(() => (window.Strom.UI as unknown as { minimapBox: object }).minimapBox);
        expect(box).toEqual({
            minX: Math.min(...cards.map(c => c.x)), minY: Math.min(...cards.map(c => c.y)),
            maxX: Math.max(...cards.map(c => c.x + c.width)), maxY: Math.max(...cards.map(c => c.y + c.height)),
        });
        // Each rectangle: painted near its card's own bottom and right edge, empty just below a short card.
        const painted = (wx: number, wy: number) => page.evaluate(({ wx, wy }) => {
            const t = (window.Strom.UI as unknown as { minimapTransform: { scale: number; offsetX: number; offsetY: number } }).minimapTransform;
            const ctx = (document.getElementById('minimap-canvas') as HTMLCanvasElement).getContext('2d')!;
            return ctx.getImageData(Math.floor(wx * t.scale + t.offsetX), Math.floor(wy * t.scale + t.offsetY), 1, 1).data[3] > 0;
        }, { wx, wy });
        const scale = await page.evaluate(() => (window.Strom.UI as unknown as { minimapTransform: { scale: number } }).minimapTransform.scale);
        const inset = 2 / scale;
        for (const c of cards) {
            expect(await painted(c.x + c.width - inset, c.y + c.height - inset), c.name).toBe(true);
        }
        const marie = byName(cards, 'Marie');
        const jan = byName(cards, 'Jan');
        expect(jan.height - marie.height).toBeGreaterThan(3 * inset);
        expect(await painted(marie.x + marie.width / 2, marie.y + marie.height + inset)).toBe(false);
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
            // In German the cards are measured again and every row stays inside its card; still no page scroll.
            await page.evaluate(() => window.Strom.UI.setLanguage('de'));
            await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
            const spill = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card .card-line-row, #tree-canvas .person-card .name-text')]
                .filter(el => el.scrollWidth > el.clientWidth + 0.5).map(el => el.textContent));
            expect(spill).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
            await page.evaluate(() => window.Strom.UI.setLanguage('en'));
        });
    }
});

test.describe('the compact custom card (1 line, Equal) is drawn as in 3.10.0-beta.6 (N14)', () => {
    // Measured on 3.10.0-beta.6 (9435f50) with the sample tree, from each card's top-left
    // (1px border; the focused card's 2px border puts everything 1px further in).
    test('the name, the avatar and the rows sit where they were', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seedSetting(page, 'cardDensity', 'custom');
        await seedSetting(page, 'cardFields', { lines: 1, height: 'view', on: PRE_AGE_ON });
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
        const cards = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')].map(el => {
            const c = el.getBoundingClientRect();
            const s = c.width / el.offsetWidth;
            const rel = (r: DOMRect | undefined) => r ? [(r.x - c.x) / s, (r.y - c.y) / s, r.width / s, r.height / s].map(v => Math.round(v * 1000) / 1000) : null;
            const name = el.querySelector<HTMLElement>('.name-text')!;
            const ink = document.createRange();
            ink.selectNodeContents(name);
            return {
                name: name.textContent ?? '', focused: el.classList.contains('focused'), height: el.offsetHeight,
                lineHeight: getComputedStyle(name).lineHeight,
                avatar: rel(el.querySelector('.card-avatar')?.getBoundingClientRect()),
                nameBox: rel(name.getBoundingClientRect()), nameInkTop: rel(ink.getBoundingClientRect())![1],
                rows: [...el.querySelectorAll('.card-line')].map(l => rel(l.getBoundingClientRect())),
            };
        }));
        expect(cards.length).toBeGreaterThan(10);
        expect(cards.filter(c => c.focused)).toHaveLength(1);
        for (const c of cards) {
            const d = c.focused ? 1 : 0;
            expect(c.lineHeight, c.name).toBe('17.25px');
            expect(c.avatar, c.name).toEqual([13, 11 + d, 30, 30]);
            expect([c.nameBox![0], c.nameBox![1], c.nameBox![3]], c.name).toEqual([51, 17.375 + d, 17.25]);
            expect(c.nameInkTop, c.name).toBe(15.375 + d);
            c.rows.forEach((r, i) => expect(r, `${c.name} row ${i}`).toEqual([13, 47 + d + 17 * i, 174, 17]));
            expect(c.height, c.name).toBe(56 + 17 * 3);
        }
        // With the years under the name the name keeps its 19px row: 19 + 14 = the 33px header.
        await page.evaluate(() => {
            const st = window.Strom.SettingsManager;
            st.setCardFields({ ...st.getCardFields(), years: true });
            window.Strom.TreeRenderer.render();
        });
        const johan = card(page, 'Johan');
        await expect(johan.locator('.card-years')).toHaveCount(1);
        expect(await johan.locator('.name-text').evaluate(el => getComputedStyle(el).lineHeight)).toBe('19px');
        expect(await johan.locator('.card-head').evaluate(el => (el as HTMLElement).offsetHeight)).toBe(33);
    });
});

// ---------------------------------------------------------------------------
// U03a: pills on the bottom edge (∞ hidden partners, ⌂ hidden families on the
// left, ⇄ other trees on the right) on all five card types.
// ---------------------------------------------------------------------------

test.describe('pills on the bottom edge (U03a)', () => {
    /**
     * Václav married twice: Anna (drawn) and Rozálie with a son (not drawn: ∞ 1, ⌂ 1).
     * Their son Jan + Marie → Josef (the focus) → Ota, Josef's son alone (a
     * single parent's line from the bottom of Josef's card). The tree is
     * imported twice, so every card carries ⇄ 1 too.
     */
    async function pillTree(page: Page): Promise<void> {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(async () => {
            const P = (id: string, o: Record<string, unknown>) => ({ id, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...o });
            const persons = {
                g1: P('g1', { firstName: 'Václav', lastName: 'Vlk', birthDate: '1800', birthPlace: 'Horní Lhota', deathDate: '1870', deathPlace: 'Horní Lhota',
                    partnerships: ['u1', 'u2'], childIds: ['p1', 'x1'], birthSourceIds: ['s1'] }),
                g2: P('g2', { firstName: 'Anna', lastName: 'Vlková', gender: 'female', birthDate: '1805', partnerships: ['u1'], childIds: ['p1'],
                    story: { text: 'Hospodařila.', status: 'final' } }),
                gx: P('gx', { firstName: 'Rozálie', lastName: 'Dvořáková', gender: 'female', birthDate: '1810', partnerships: ['u2'], childIds: ['x1'] }),
                x1: P('x1', { firstName: 'Matěj', lastName: 'Vlk', birthDate: '1835', parentIds: ['g1', 'gx'] }),
                p1: P('p1', { firstName: 'Jan', lastName: 'Vlk', birthDate: '1830', birthPlace: 'Horní Lhota', deathDate: '1890', deathPlace: 'Dolní Lhota',
                    parentIds: ['g1', 'g2'], partnerships: ['u3'], childIds: ['f'], question: 'Kdy zemřel?',
                    events: [{ id: 'e1', type: 'occupation', note: 'mlynář' }, { id: 'e2', type: 'baptism', date: '1830-03-02', place: 'Horní Lhota' }] }),
                p2: P('p2', { firstName: 'Marie', lastName: 'Nová', gender: 'female', birthDate: '1835', partnerships: ['u3'], childIds: ['f'] }),
                f: P('f', { firstName: 'Josef', lastName: 'Vlk', birthDate: '1860', deathDate: '1931', deathPlace: 'Brno',
                    parentIds: ['p1', 'p2'], childIds: ['o'] }),
                o: P('o', { firstName: 'Ota', lastName: 'Vlk', birthDate: '1890', parentIds: ['f'] }),
            };
            const partnerships = {
                u1: { id: 'u1', person1Id: 'g1', person2Id: 'g2', childIds: ['p1'], status: 'married', isPrimary: true },
                u2: { id: 'u2', person1Id: 'g1', person2Id: 'gx', childIds: ['x1'], status: 'married' },
                u3: { id: 'u3', person1Id: 'p1', person2Id: 'p2', childIds: ['f'], status: 'married', startDate: '1858' },
            };
            const sources = { s1: { id: 's1', title: 'Matrika' } };
            const dm = window.Strom.DataManager;
            await dm.importAsNewTree({ persons, partnerships, sources } as never, 'Vlkovi A');
            await dm.importAsNewTree({ persons, partnerships, sources } as never, 'Vlkovi B');
            window.Strom.TreeRenderer.setFocus('f' as never);
        });
        await expect(card(page, 'Václav')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
    }

    type Rect = { l: number; t: number; r: number; b: number };
    const hit = (a: Rect, b: Rect) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

    /** Per card: its pills, its text (each text run), its stripes; all in screen pixels. */
    async function cardParts(page: Page) {
        return page.evaluate(() => {
            const box = (r: DOMRect) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
            return [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')].map(el => {
                const texts: { text: string; rect: ReturnType<typeof box> }[] = [];
                const walker = document.createTreeWalker(el.querySelector('.card-body')!, NodeFilter.SHOW_TEXT);
                for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                    if (!n.textContent?.trim()) continue;
                    const range = document.createRange();
                    range.selectNodeContents(n);
                    for (const r of range.getClientRects()) texts.push({ text: n.textContent.trim(), rect: box(r) });
                }
                const pills = [...el.querySelectorAll<HTMLElement>('.hidden-partners-btn, .hidden-families-btn, .cross-tree-badge')]
                    .map(p => ({ kind: p.className, rect: box(p.getBoundingClientRect()) }));
                const state = el.querySelector(':scope > .card-state');
                return {
                    id: el.dataset.id!, name: el.querySelector('.name-text')?.textContent ?? '', card: box(el.getBoundingClientRect()),
                    height: el.offsetHeight, classes: el.className, texts, pills, state: state ? box(state.getBoundingClientRect()) : null,
                };
            });
        });
    }

    for (const density of ['compact', 'normal', 'detailed', 'register', 'custom'] as const) {
        test(`${density}: ⌂ ∞ ⇄ at once cover no text, no stripes and no other pill; cards of details grow 12px and keep clear of each other and the lines`, async ({ page }) => {
            await pillTree(page);
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d), density);
            await expect(page.locator('body')).toHaveAttribute('data-card-density', density);
            await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
            const vaclav = card(page, 'Václav');
            await expect(vaclav.locator('.hidden-partners-btn')).toBeVisible();
            await expect(vaclav.locator('.hidden-families-btn')).toBeVisible();
            await expect(vaclav.locator('.cross-tree-badge')).toBeVisible();
            await expect(vaclav).toHaveClass(/has-edge-bl/);
            await expect(vaclav).toHaveClass(/has-edge-br/);
            const fields = density === 'detailed' || density === 'register' || density === 'custom';

            const parts = await cardParts(page);
            for (const c of parts) {
                expect(c.pills.length, c.name).toBeGreaterThan(0);
                for (const p of c.pills) {
                    for (const t of c.texts) expect(hit(p.rect, t.rect), `${c.name}: ${p.kind} over "${t.text}"`).toBe(false);
                    if (c.state) expect(hit(p.rect, c.state), `${c.name}: ${p.kind} over the stripes`).toBe(false);
                    for (const q of c.pills) if (q !== p) expect(hit(p.rect, q.rect), `${c.name}: ${p.kind} over ${q.kind}`).toBe(false);
                }
                // A card of details as tall as its content keeps the pills' room; the fixed cards do not change.
                expect(c.classes.includes('has-edge-room'), c.name).toBe(fields);
            }
            // No two cards overlap; no line runs through a card (in the layout's own
            // coordinates: the focused card is drawn a little larger on purpose).
            const geo = await page.evaluate(() => {
                const r = window.Strom.TreeRenderer as unknown as {
                    positions: Map<string, { x: number; y: number }>;
                    config: { cardWidth: number; cardHeight: number; personHeights?: Map<string, number> };
                };
                const n = (l: SVGLineElement, k: 'x1' | 'x2' | 'y1' | 'y2') => l[k].baseVal.value;
                return {
                    cards: [...r.positions.entries()].map(([id, p]) => ({ id, l: p.x, t: p.y, r: p.x + r.config.cardWidth,
                        b: p.y + (r.config.personHeights?.get(id) ?? r.config.cardHeight) })),
                    lines: [...document.querySelectorAll<SVGLineElement>('#tree-lines line')].map(l => ({
                        l: Math.min(n(l, 'x1'), n(l, 'x2')), r: Math.max(n(l, 'x1'), n(l, 'x2')),
                        t: Math.min(n(l, 'y1'), n(l, 'y2')), b: Math.max(n(l, 'y1'), n(l, 'y2')) })),
                };
            });
            expect(geo.cards).toHaveLength(parts.length);
            for (let i = 0; i < geo.cards.length; i++) {
                for (let j = i + 1; j < geo.cards.length; j++) expect(hit(geo.cards[i], geo.cards[j]), `${geo.cards[i].id} / ${geo.cards[j].id}`).toBe(false);
            }
            expect(geo.lines.length).toBeGreaterThan(3);
            for (const l of geo.lines) for (const c of geo.cards) expect(hit(l, c), `a line through ${c.id}`).toBe(false);

            if (!fields) return;
            // 12px taller with the pills (padding 10 → 22): the ⇄ pill off, Josef (⇄ only) loses them, Václav keeps ⌂ ∞.
            const before = Object.fromEntries(parts.map(c => [c.name, c.height]));
            await page.evaluate(() => window.Strom.UI.toggleCrossTreeBadges(false));
            await expect(card(page, 'Josef').locator('.cross-tree-badge')).toHaveCount(0);
            await expect(card(page, 'Josef')).not.toHaveClass(/has-edge-room/);
            await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
            const after = Object.fromEntries((await cardParts(page)).map(c => [c.name, c.height]));
            expect(before['Josef Vlk'] - after['Josef Vlk']).toBe(12);
            expect(before['Václav Vlk'] - after['Václav Vlk']).toBe(0);
            await expect(vaclav).toHaveClass(/has-edge-room/);
            await expect(vaclav).toHaveCSS('padding-bottom', '22px');
            await expect(card(page, 'Josef')).toHaveCSS('padding-bottom', '10px');
        });
    }

    test('the image export draws no pills and leaves their room out; a single parent\'s line starts at the card it draws', async ({ page }) => {
        await pillTree(page);
        await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));
        await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
        const cards = await drawn(page);
        const josef = byName(cards, 'Josef');
        const roomy = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card.has-edge-room')].map(el => el.dataset.id));
        expect(roomy).toContain(josef.id);
        const svg = await posterSvg(page);
        expect(svg).not.toContain('cross-tree');
        const rects = [...svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)" rx="8"/g)]
            .map(m => ({ x: Number(m[1]), y: Number(m[2]), height: Number(m[4]) }));
        expect(rects).toHaveLength(cards.length);
        for (const c of cards) {
            const r = rects.find(x => Math.abs(x.x - c.x) < 0.05 && Math.abs(x.y - c.y) < 0.05)!;
            expect(r.height, c.name).toBe(c.height - (roomy.includes(c.id) ? 12 : 0));
        }
        // Josef alone → Ota: the stem starts at the bottom of Josef's card as the poster draws it.
        const stemX = josef.x + josef.width / 2;
        const bottom = josef.y + josef.height - 12;
        const stems = [...svg.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"/g)]
            .map(m => m.slice(1, 5).map(Number)).filter(([x1, , x2]) => Math.abs(x1 - stemX) < 0.1 && Math.abs(x2 - stemX) < 0.1);
        expect(stems.some(([, y1, , y2]) => Math.abs(Math.min(y1, y2) - bottom) < 0.1), JSON.stringify(stems)).toBe(true);
        // The age line is drawn as on screen.
        expect(svg).toMatch(/>age \d+</);
    });
});
