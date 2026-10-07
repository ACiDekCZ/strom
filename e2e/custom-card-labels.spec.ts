import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedSetting, cardBoxesMatchLayout } from './helpers.js';

/**
 * The "Custom" card's labels style, the years under the name, a long name in
 * two rows and the presets (U02): the screen and the image export draw the
 * same rows and heights. Invented data.
 */

const LONG_PLACE = 'Nové Město na Moravě, okres Žďár nad Sázavou, Kraj Vysočina';
const CAUSE = 'náhlé zapálení mozkových blan';

function ged(childName = 'Anna /Vlková/'): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 3 FEB 1862', '2 PLAC Horní Lhota',
        '1 DEAT', '2 DATE 12 MAR 1919', '2 PLAC Brno', `2 CAUS ${CAUSE}`,
        '1 OCCU mlynář', '1 FAMS @F1@',
        // Marie: only a baptism and a burial, which stand in under their own words.
        '0 @I2@ INDI', '1 NAME Marie /Dvořáková/', '1 SEX F',
        '1 BAPM', '2 DATE 4 FEB 1869', '2 PLAC Dolní Lhota',
        '1 BURI', '2 DATE 15 MAR 1920', '2 PLAC Brno', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME ' + childName, '1 SEX F',
        '1 BIRT', '2 DATE 1890', '2 PLAC ' + LONG_PLACE,
        '1 DEAT', '2 DATE 1912', '2 PLAC Brno', '1 FAMC @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 14 FEB 1888', '2 PLAC Dolní Lhota', '1 CHIL @I3@',
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

/** The labels card of the register: every detail with its place, the cause, full dates, words. */
const LABELS = { style: 'labels', on: ['birth', 'death', 'occupation'], place: ['birth', 'death'], cause: true, fullDate: true };

async function setup(page: Page, fields: Record<string, unknown> | null, width = 1440, childName?: string): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await seedSetting(page, 'cardDensity', 'custom');
    if (fields) await seedSetting(page, 'cardFields', fields);
    await openApp(page);
    await dropFile(page, ged(childName));
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, (childName ?? 'Anna').split(' ')[0])).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe('custom');
    await page.evaluate(() => document.fonts.ready);
    await settled(page);
}

/** Every card's box is the layout's size (measured in the card fonts, laid out again). */
async function settled(page: Page): Promise<void> {
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
}

/** Per card: its height, its labels (text, unscaled width) and its value rows (text, x from the card, top). */
async function labelCards(page: Page) {
    return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')].map(cardEl => {
        const c = cardEl.getBoundingClientRect();
        const scale = c.width / cardEl.offsetWidth;
        return {
            name: cardEl.querySelector('.name-text')!.textContent ?? '',
            height: cardEl.offsetHeight,
            labels: [...cardEl.querySelectorAll<HTMLElement>('.card-line-label')].map(l => ({
                text: l.textContent ?? '', width: Math.round(l.getBoundingClientRect().width / scale * 10) / 10,
            })),
            lines: [...cardEl.querySelectorAll<HTMLElement>('.card-line')].map(line => ({
                label: line.querySelector('.card-line-label')?.textContent ?? '',
                rows: [...line.querySelectorAll<HTMLElement>('.card-line-row')].map(r => {
                    const b = r.getBoundingClientRect();
                    const range = document.createRange();
                    range.selectNodeContents(r);
                    return {
                        date: r.querySelector('.card-line-date')?.textContent ?? '',
                        text: r.querySelector('.card-line-text')?.textContent ?? '',
                        x: Math.round((b.left - c.left) / scale),
                        top: Math.round((b.top - c.top) / scale),
                        clipped: range.getBoundingClientRect().width > b.width + 0.01 * scale,
                    };
                }),
            })),
        };
    }));
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

/** The SVG on a page of its own: per card its box and its texts by class. */
async function svgCards(page: Page, svg: string) {
    const view = await page.context().newPage();
    await view.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await view.evaluate(() => document.fonts.ready);
    const cards = await view.evaluate(() => [...document.querySelectorAll<SVGRectElement>('g.cards > rect[rx="8"]')].map(r => {
        const x = r.x.baseVal.value, y = r.y.baseVal.value, w = r.width.baseVal.value, h = r.height.baseVal.value;
        const texts = [...document.querySelectorAll<SVGTextElement>('g.cards text')].filter(t => {
            const tx = t.x.baseVal[0].value, ty = t.y.baseVal[0].value;
            return tx >= x && tx <= x + w && ty >= y && ty <= y + h;
        });
        const of = (cls: string) => texts.filter(t => t.classList.contains(cls)).map(t => {
            const b = t.getBBox();
            return { text: t.textContent ?? '', x: t.x.baseVal[0].value - x, y: t.y.baseVal[0].value - y, right: b.x + b.width - x };
        });
        return {
            width: w, height: h,
            nameRows: of('card-name-row'),
            name: texts.find(t => t.getAttribute('font-size') === '15' || (!t.classList.length && t.getAttribute('font-weight') === '600' && !t.hasAttribute('text-anchor')))?.textContent ?? '',
            years: of('card-years'), labels: of('card-line-label'), dates: of('card-line-date'), places: of('card-line-place'),
        };
    }));
    await view.close();
    return cards;
}

/** Where the couple's partner line runs from the top of the cards, and the middle of the "+ partner" pill. */
async function partnerLine(page: Page): Promise<{ line: number; pill: number }> {
    return page.evaluate(() => {
        const r = window.Strom.TreeRenderer as unknown as {
            spouseLines: { y: number; person1Id: string }[]; positions: Map<string, { y: number }>;
        };
        const sl = r.spouseLines[0];
        const cardEl = document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${sl.person1Id}"]`)!;
        const pill = cardEl.querySelector<HTMLElement>('.edge-right-center')!;
        const c = cardEl.getBoundingClientRect();
        const scale = c.width / cardEl.offsetWidth;
        const p = pill.getBoundingClientRect();
        return { line: sl.y - r.positions.get(sl.person1Id)!.y, pill: ((p.top + p.bottom) / 2 - c.top) / scale };
    });
}

const labelColumn = (page: Page) =>
    page.evaluate(() => parseFloat(getComputedStyle(document.body).getPropertyValue('--card-label-col')));

test.describe('the labels style (U02)', () => {
    test('one label column for the view, the stand-ins\' own words, wrapped values under the value\'s start, the poster the same', async ({ page }) => {
        await setup(page, LABELS);
        const cards = await labelCards(page);
        const marie = cards.find(c => c.name.startsWith('Marie'))!;
        const jan = cards.find(c => c.name.startsWith('Jan'))!;
        const anna = cards.find(c => c.name.startsWith('Anna'))!;
        // Marie has no birth or death: the baptism and the burial stand in under their own words, no marks.
        expect(marie.lines.map(l => l.label)).toEqual(['Baptism', 'Burial']);
        expect(jan.lines.map(l => l.label)).toEqual(['Birth', 'Death', 'Occupation']);
        await expect(page.locator('#tree-canvas .card-line-mark')).toHaveCount(0);
        // Every label of the view is as wide as the longest one ("Occupation").
        const col = await labelColumn(page);
        expect(col).toBeGreaterThan(0);
        const widths = cards.flatMap(c => c.labels.map(l => l.width));
        expect(widths.length).toBe(7);
        for (const w of widths) expect(w).toBeCloseTo(col, 0);
        // Every value row starts 8px after the label column (1px border, 12px padding); nothing is cut.
        const rows = cards.flatMap(c => c.lines.flatMap(l => l.rows));
        for (const r of rows) {
            expect(r.x).toBe(Math.round(1 + 12 + col + 8));
            expect(r.clipped).toBe(false);
        }
        // Anna's long birth place: the date on the first row, the place after it and on under the value's start.
        const birth = anna.lines[0];
        expect(birth.rows.length).toBeGreaterThan(1);
        expect(birth.rows[0].date).toBe('1890');
        expect(birth.rows.slice(1).every(r => r.date === '')).toBe(true);
        expect(birth.rows.map(r => r.text).join(' ')).toBe(LONG_PLACE);
        birth.rows.forEach((r, i) => expect(r.top - birth.rows[0].top).toBe(17 * i));
        // Jan's death: the place after the date, the cause on a row of its own.
        expect(jan.lines[1].rows.map(r => [r.date, r.text])).toEqual([[expect.stringContaining('1919'), 'Brno'], ['', CAUSE]]);

        // The poster: the same heights, labels, dates and rows, every row at the value's start.
        const svg = await svgCards(page, await posterSvg(page));
        expect(svg).toHaveLength(cards.length);
        for (const d of cards) {
            const s = svg.find(x => d.name.startsWith(x.name || x.nameRows.map(r => r.text).join(' ')))!;
            expect(s, d.name).toBeTruthy();
            expect(s.height, d.name).toBe(d.height);
            expect(s.labels.map(l => l.text), d.name).toEqual(d.lines.map(l => l.label));
            const domRows = d.lines.flatMap(l => l.rows);
            expect(s.dates.map(x => x.text), d.name).toEqual(domRows.filter(r => r.date).map(r => r.date));
            expect(s.places.map(x => x.text), d.name).toEqual(domRows.filter(r => r.text).map(r => r.text));
            for (const p of s.places) expect(p.right, `${d.name}: ${p.text}`).toBeLessThanOrEqual(s.width - 12 + 0.5);
            for (const l of s.labels) expect(l.x).toBe(12);
            // A row without a date starts at the value's start.
            const valueX = 12 + col + 8;
            for (const p of s.places.filter(p => !s.dates.some(dt => dt.y === p.y))) expect(p.x).toBeCloseTo(valueX, 1);
            for (const dt of s.dates) expect(dt.x).toBeCloseTo(valueX, 1);
        }
    });

    test('the label column follows the language: German is wider than Czech', async ({ page }) => {
        await setup(page, { ...LABELS, on: ['birth', 'death'] });
        await page.evaluate(() => window.Strom.UI.setLanguage('cs'));
        await expect(page.locator('#tree-canvas .card-line-label', { hasText: 'Pohřeb' })).toHaveCount(1);
        await settled(page);
        const cs = await labelColumn(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('de'));
        await expect(page.locator('#tree-canvas .card-line-label', { hasText: 'Beerdigung' })).toHaveCount(1);
        await settled(page);
        const de = await labelColumn(page);
        expect(de).toBeGreaterThan(cs);
        // Still one column for every label of the view.
        const widths = (await labelCards(page)).flatMap(c => c.labels.map(l => l.width));
        for (const w of widths) expect(w).toBeCloseTo(de, 0);
        await page.evaluate(() => window.Strom.UI.setLanguage('en'));
    });
});

test.describe('the header of the custom card (U02)', () => {
    test('years under the name on screen and in the poster, the partner line at the middle of the taller header', async ({ page }) => {
        await setup(page, { years: true });
        await expect(card(page, 'Jan').locator('.card-years')).toHaveText('1862 – 1919');
        await expect(card(page, 'Anna').locator('.card-years')).toHaveText('1890 – 1912');
        // Marie has no birth or death date: no years row.
        await expect(card(page, 'Marie').locator('.card-years')).toHaveCount(0);
        // Name 19 + years 14 = 33px beside the 30px avatar.
        const head = await card(page, 'Jan').locator('.card-head').evaluate(el => el.getBoundingClientRect().height
            / (el.closest('.person-card')!.getBoundingClientRect().width / (el.closest('.person-card') as HTMLElement).offsetWidth));
        expect(Math.round(head)).toBe(33);
        const { line, pill } = await partnerLine(page);
        expect(line).toBe(26.5);
        expect(Math.abs(pill - 26.5)).toBeLessThanOrEqual(0.5);
        const svgText = await posterSvg(page);
        const svg = await svgCards(page, svgText);
        expect(svg.flatMap(c => c.years.map(y => y.text)).sort()).toEqual(['1862 – 1919', '1890 – 1912']);
        const dom = await labelCards(page);
        for (const d of dom) expect(svg.find(s => s.height === d.height), d.name).toBeTruthy();
        // The years 10.5px into their row under the name's 19px row: 10 + 19 + 10.5 from the top.
        for (const c of svg) for (const y of c.years) expect(y.y).toBeCloseTo(39.5, 1);
        const spouseY = Number(/<g class="spouse-lines">\s*<line x1="[\d.-]+" y1="([\d.-]+)"/.exec(svgText)![1]);
        const tops = [...svgText.matchAll(/<rect x="-?[\d.]+" y="(-?[\d.]+)" width="\d+" height="\d+" rx="8"/g)].map(m => Number(m[1]));
        expect(tops.some(t => Math.abs(t + 26.5 - spouseY) < 0.05)).toBe(true);
    });

    test('a long name takes two rows on the narrow card, the same rows in the poster, inside the card', async ({ page }) => {
        const name = 'Kateřina Výšková-Hlavatá z Lipan';
        await setup(page, { widthCap: 240 }, 1440, 'Kateřina /Výšková-Hlavatá z Lipan/');
        const rows = await card(page, 'Kateřina').locator('.name-row').allTextContents();
        expect(rows).toHaveLength(2);
        expect(rows.join(' ').replace('- ', '-')).toBe(name);
        // Drawn as computed: not shrunk, not cut.
        const fit = await card(page, 'Kateřina').locator('.name').evaluate(el => ({
            classes: el.className, size: getComputedStyle(el.querySelector('.name-row')!).fontSize,
            clipped: [...el.querySelectorAll('.name-row')].some(r => r.scrollWidth > r.clientWidth),
        }));
        expect(fit).toEqual({ classes: 'name name--rows', size: '15px', clipped: false });
        const svg = await svgCards(page, await posterSvg(page));
        // Every name is drawn in its rows; only Kateřina's takes two.
        expect(svg.map(c => c.nameRows.length).sort()).toEqual([1, 1, 2]);
        const kat = svg.find(c => c.nameRows.length === 2)!;
        expect(kat.nameRows.map(r => r.text)).toEqual(rows);
        for (const r of kat.nameRows) expect(r.right).toBeLessThanOrEqual(kat.width - 12 + 0.5);
        const domHeight = await card(page, 'Kateřina').evaluate(el => (el as HTMLElement).offsetHeight);
        expect(kat.height).toBe(domHeight);
    });
});

test.describe('card presets (U02)', () => {
    const fieldsOf = (page: Page) => page.evaluate(() => window.Strom.SettingsManager.getCardFields());

    test('a new user starts on Brief; Register sets every value of its row and shows pressed; a change of one\'s own presses none', async ({ page }) => {
        await setup(page, null);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const presets = page.locator('#card-fields-settings .card-preset-segment');
        await expect(presets).toHaveAttribute('role', 'group');
        await expect(presets.locator('.segment-btn')).toHaveText(['Brief', 'Register', 'All']);
        await expect(presets.locator('[aria-pressed="true"]')).toHaveText('Brief');
        // The preset comes first, then the details, then the appearance.
        const order = await page.evaluate(() => ['.card-preset', '.card-fields-list', '.card-look'].map(sel =>
            document.querySelector(`#card-fields-settings ${sel}`)!.getBoundingClientRect().top));
        expect(order[0]).toBeLessThan(order[1]);
        expect(order[1]).toBeLessThan(order[2]);

        await presets.getByRole('button', { name: 'Register', exact: true }).click();
        await expect(presets.locator('[aria-pressed="true"]')).toHaveText('Register');
        const reg = await fieldsOf(page);
        expect(reg.order.slice(0, 5)).toEqual(['birth', 'baptism', 'marriage', 'death', 'burial']);
        expect(reg.on).toEqual(['birth', 'baptism', 'marriage', 'death', 'burial']);
        expect([...reg.place].sort()).toEqual(['baptism', 'birth', 'burial', 'death', 'divorce', 'marriage']);
        expect(reg).toMatchObject({ cause: true, fullDate: true, style: 'labels', lines: 0, height: 'content', widthCap: 320, years: false });
        // The segments say it too, and the diagram draws labels.
        await expect(page.locator('#card-fields-settings .card-look-style [aria-pressed="true"]')).toHaveText('Labels');
        await expect(page.locator('#card-fields-settings .card-look-lines [aria-pressed="true"]')).toHaveText('Full');
        await expect(page.locator('#card-fields-settings .card-look-height [aria-pressed="true"]')).toHaveText('By content');
        await expect(page.locator('#card-fields-settings .card-fields-date [aria-pressed="true"]')).toHaveText('Full date');
        await expect(page.locator('#card-fields-settings .card-look-years')).not.toBeChecked();
        await expect(page.locator('#tree-canvas .card-line--label').first()).toBeVisible();
        await expect(page.locator('#tree-canvas .card-line-label', { hasText: 'Marriage' }).first()).toBeVisible();

        // A change of one's own: no preset is pressed.
        await page.locator('#card-fields-settings .card-look-style').getByRole('button', { name: 'Symbols', exact: true }).click();
        await expect(presets.locator('[aria-pressed="true"]')).toHaveCount(0);
        await expect(page.locator('#tree-canvas .card-line--label')).toHaveCount(0);
        await page.locator('#card-fields-settings .card-look-years').check();
        await expect(presets.locator('[aria-pressed="true"]')).toHaveCount(0);
        expect((await fieldsOf(page)).years).toBe(true);

        // All: the wide card with every detail; Brief brings the default back.
        await presets.getByRole('button', { name: 'All', exact: true }).click();
        await expect(presets.locator('[aria-pressed="true"]')).toHaveText('All');
        expect(await fieldsOf(page)).toMatchObject({ widthCap: 400, style: 'labels', years: false });
        expect((await fieldsOf(page)).on).toHaveLength(7);
        await presets.getByRole('button', { name: 'Brief', exact: true }).click();
        await expect(presets.locator('[aria-pressed="true"]')).toHaveText('Brief');
        expect(await fieldsOf(page)).toMatchObject({ on: ['birth', 'death', 'occupation'], style: 'marks', lines: 0, widthCap: 320, fullDate: false, cause: false });
    });

    for (const theme of ['light', 'dark'] as const) {
        test(`phone 360, ${theme}: the preset and style segments span the panel at 44px, German words fit, no page scroll`, async ({ page }) => {
            await setup(page, null, 360);
            await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
            await page.evaluate(() => window.Strom.UI.setLanguage('de'));
            await page.evaluate(() => window.Strom.UI.showSettingsDialog());
            const host = page.locator('#card-fields-settings');
            await expect(host.locator('.card-preset-segment .segment-btn')).toHaveText(['Kurz', 'Matrikel', 'Alles']);
            await expect(host.locator('.card-look-style .segment-btn')).toHaveText(['Symbole', 'Beschriftung']);
            await expect(host.locator('.card-look-check')).toContainText('Jahre unter dem Namen');
            // The panel's content width: the details list spans it.
            const panel = (await host.locator('.card-fields-list').boundingBox())!;
            for (const sel of ['.card-preset-segment', '.card-look-style', '.card-look-lines', '.card-look-height', '.card-look-width']) {
                const seg = host.locator(sel);
                await seg.scrollIntoViewIfNeeded();
                expect(Math.abs((await seg.boundingBox())!.width - panel.width), sel).toBeLessThan(1);
                for (const b of await seg.locator('.segment-btn').all()) {
                    expect(Math.round((await b.boundingBox())!.height), sel).toBeGreaterThanOrEqual(44);
                    expect(await b.evaluate(el => el.scrollWidth <= el.clientWidth), sel).toBe(true);
                }
            }
            // The preset's title above its segment.
            const title = (await host.locator('.card-preset-title').boundingBox())!;
            expect(title.y + title.height).toBeLessThanOrEqual((await host.locator('.card-preset-segment').boundingBox())!.y + 0.5);
            expect(Math.round((await host.locator('.card-look-check').boundingBox())!.height)).toBeGreaterThanOrEqual(44);
            // The pressed preset stands out from the others in either theme.
            const bg = await host.locator('.card-preset-segment .segment-btn').evaluateAll(bs => bs.map(b => getComputedStyle(b).backgroundColor));
            expect(bg[0]).not.toBe(bg[1]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
            expect(await page.locator('#settings-modal .modal').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            await page.evaluate(() => window.Strom.UI.setLanguage('en'));
        });
    }
});
