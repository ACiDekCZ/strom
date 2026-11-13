import { test, expect, Page, Locator } from '@playwright/test';
import { stubTiles, seedPathTree, setYear } from './map-path-fixture.js';

/**
 * The ancestors' path on a phone and a phone held sideways (spec 054 §5):
 * the "Family lines (N)" chip and its sheet, the list of the ancestors off
 * the timeline as a sheet, one sheet at a time, the offer of the mode across
 * the width; and long German names at 1440, 1024 and 390 px that overflow
 * nothing and overlap nothing.
 */

/** Two of the maternal grandfather's line's ancestors without a date or place (the list under the legend). */
const UNDATED = {
    maelis: { firstName: 'Maelis', lastName: 'Ostrowbek', gender: 'female' as const, birthDate: '1922', birthPlace: 'Theta', parents: ['tobrin', 'hesper'] },
    tobrin: { firstName: 'Tobrin', lastName: 'Ostrowbek', gender: 'male' as const, birthDate: '1895', partners: ['hesper'] },
    hesper: { firstName: 'Hesper', lastName: 'Corvith', gender: 'female' as const },
};

type Box = { x: number; y: number; width: number; height: number };
const box = async (l: Locator): Promise<Box> => (await l.boundingBox())!;
const apart = (a: Box, b: Box): boolean =>
    a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
const fits = (l: Locator): Promise<boolean> => l.evaluate(el => el.scrollWidth <= el.clientWidth);

async function choose(page: Page, id: string): Promise<void> {
    await page.evaluate(pid => window.Strom.UI.setMapPathTarget(pid as never), id);
    await expect(page.locator('.map-path-chip')).toBeVisible();
}

test.describe('a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the chip "Family lines (N)" stands 8 px above the bar and opens the legend as a sheet; "List ›" opens the ancestors off the timeline as a sheet; one sheet at a time', async ({ page }) => {
        await stubTiles(page);
        await seedPathTree(page, UNDATED);
        await choose(page, 'tamsin');

        // No unfolded legend: the chip, left above the bar.
        await expect(page.locator('.map-lines-legend')).toHaveCount(0);
        const chip = page.locator('.map-lines-chip');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveClass(/is-phone/);
        await expect(chip.locator('.map-lines-chip-text')).toHaveText('Family lines (4)');
        await expect(chip.locator('.map-lines-chip-caret')).toHaveText('▴');
        const map = await box(page.locator('#map-container'));
        const cb = await box(chip);
        const bar = await box(page.locator('#map-timebar'));
        expect(Math.round(cb.x - map.x)).toBe(8);
        expect(Math.round(bar.y - (cb.y + cb.height))).toBe(8);
        // The person's chip ends before the column of the controls.
        expect(apart(await box(page.locator('.map-path-chip')), await box(page.locator('.map-controls')))).toBe(true);

        // The sheet: across the width along the bottom, above the bar; the chip gives way meanwhile.
        await chip.click();
        const sheet = page.getByRole('dialog', { name: 'Family lines' });
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveClass(/map-lines-legend--sheet/);
        await expect(sheet.locator('.map-lines-grip')).toBeVisible();
        await expect(chip).toBeHidden();
        const sb = await box(sheet);
        expect(Math.round(sb.x)).toBe(Math.round(map.x));
        expect(Math.round(sb.width)).toBe(Math.round(map.width));
        expect(Math.abs(sb.y + sb.height - (map.y + map.height))).toBeLessThanOrEqual(1);
        expect(sb.height).toBeLessThanOrEqual(map.height * 0.82 + 1);
        expect(Number(await sheet.evaluate(el => getComputedStyle(el).zIndex))).toBeGreaterThan(
            Number(await page.locator('#map-timebar').evaluate(el => getComputedStyle(el).zIndex)) || 0);
        await expect(sheet.locator('.map-lines-row[data-line="0"]')).toContainText('Quillfen');
        // A row pins its line in the sheet as in the panel.
        await sheet.locator('.map-lines-row[data-line="0"]').click();
        await expect(sheet.locator('.map-lines-row[data-line="0"]')).toHaveAttribute('aria-pressed', 'true');
        await sheet.locator('.map-lines-row[data-line="0"]').click();

        // × closes it, the focus back on the chip.
        const close = sheet.locator('.map-lines-collapse');
        await expect(close).toHaveAttribute('aria-label', 'Close');
        await close.click();
        await expect(sheet).toHaveCount(0);
        await expect(chip).toBeVisible();
        await expect(chip).toBeFocused();

        // "List ›": the list takes the sheet's place, as a sheet of its own.
        await chip.click();
        await sheet.getByRole('button', { name: 'List ›' }).click();
        await expect(sheet).toHaveCount(0);
        const list = page.getByRole('dialog', { name: 'Ancestors not on the timeline' });
        await expect(list).toBeVisible();
        await expect(list).toHaveClass(/is-sheet/);
        await expect(list.locator('.map-lines-und-row')).toHaveCount(2);
        const lb = await box(list);
        expect(Math.round(lb.width)).toBe(Math.round(map.width));
        expect(Math.abs(lb.y + lb.height - (map.y + map.height))).toBeLessThanOrEqual(1);
        expect(lb.height).toBeLessThanOrEqual(map.height * 0.8 + 1);
        await list.locator('.map-lines-und-close').click();
        await expect(list).toHaveCount(0);
        await expect(chip).toBeFocused();

        // Escape closes the sheet.
        await chip.click();
        await expect(sheet).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);

        // One sheet at a time: the bubble closes the legend's sheet, the legend's sheet the bubble,
        // the choice of a person the legend's sheet.
        await chip.click();
        await expect(sheet).toBeVisible();
        await page.evaluate(() => window.Strom.UI.showMapPlace('zeta'));
        const bubble = page.locator('.map-popup.map-popup--sheet');
        await expect(bubble).toBeVisible();
        await expect(sheet).toHaveCount(0);
        // (The bubble's sheet covers the chip: pressed from code.)
        await chip.evaluate(el => (el as HTMLElement).click());
        await expect(sheet).toBeVisible();
        await expect(bubble).toBeHidden();
        await page.locator('.map-path-chip-open').click();
        await expect(page.locator('.map-path-picker')).toBeVisible();
        await expect(sheet).toHaveCount(0);
    });

    test('the offer of the mode spans the width above the status bar', async ({ page }) => {
        await stubTiles(page);
        await seedPathTree(page, {}, { timeOn: false, mapTimeTip: true });
        const tip = page.locator('.map-time-tip');
        await expect(tip).toBeVisible();
        const map = await box(page.locator('#map-container'));
        const tb = await box(tip);
        expect(Math.round(tb.x - map.x)).toBe(12);
        expect(Math.round(map.x + map.width - (tb.x + tb.width))).toBe(12);
        const status = await box(page.locator('.map-status'));
        expect(tb.y + tb.height).toBeLessThanOrEqual(status.y);
        expect(await fits(tip)).toBe(true);
    });

    test('the toast back to the person page stands at the top under the chips', async ({ page }) => {
        await stubTiles(page);
        await seedPathTree(page, {
            tamsin: { firstName: 'Tamsin', lastName: 'Quillfen', gender: 'female', birthDate: '1950', birthPlace: 'Zeta', deathDate: '2010', deathPlace: 'Eta', parents: ['orrin', 'maelis'] },
        }, { timeOn: false });
        await page.evaluate(() => window.Strom.UI.showPersonPage('tamsin' as never));
        await page.locator('#person-page-modal .pp-map-path').click();
        const toast = page.locator('.toast[data-kind="map-path-back"]');
        await expect(toast).toBeVisible();
        await expect(page.locator('.map-path-chip-name')).toHaveText(/Tamsin Quillfen/);
        const top = await box(page.locator('.map-topleft'));
        // It slides in: where it comes to rest.
        await expect.poll(async () => Math.round((await box(toast)).y - (top.y + top.height))).toBe(10);
        const tb = await box(toast);
        const bar = await box(page.locator('#map-timebar'));
        expect(tb.y + tb.height).toBeLessThan(bar.y);
        expect(apart(tb, await box(page.locator('.map-lines-chip')))).toBe(true);
        expect(apart(tb, await box(page.locator('.map-controls')))).toBe(true);
    });
});

test.describe('a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('one top row: the person\'s chip without "Path to:", the "Family lines" chip and the kinds; the chip opens the sheet', async ({ page }) => {
        await stubTiles(page);
        await seedPathTree(page);
        await choose(page, 'tamsin');
        const pathChip = page.locator('.map-path-chip');
        const chip = page.locator('.map-topleft .map-lines-chip');
        const kinds = page.locator('.map-kinds-btn');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveClass(/is-inline/);
        await expect(pathChip.locator('.map-path-chip-pre')).toBeHidden();
        const [p, c, k] = await Promise.all([box(pathChip), box(chip), box(kinds)]);
        const mid = (b: Box): number => b.y + b.height / 2;
        expect(Math.abs(mid(c) - mid(p))).toBeLessThanOrEqual(4);
        expect(Math.abs(mid(k) - mid(p))).toBeLessThanOrEqual(4);
        expect(c.x).toBeGreaterThanOrEqual(p.x + p.width);
        expect(k.x).toBeGreaterThanOrEqual(c.x + c.width);
        const controls = await box(page.locator('.map-controls'));
        expect(k.x + k.width).toBeLessThanOrEqual(controls.x);
        // The bar keeps one row.
        await expect(page.locator('.map-time-caption')).toBeHidden();

        await chip.click();
        const sheet = page.getByRole('dialog', { name: 'Family lines' });
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveClass(/map-lines-legend--land/);
        const map = await box(page.locator('#map-container'));
        expect((await box(sheet)).height).toBeLessThanOrEqual(map.height * 0.96 + 1);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(chip).toBeFocused();
    });
});

/** Long names (de): the chosen person and the father's line. */
const LONG = {
    tamsin: { firstName: 'Ludmila', lastName: 'Vrbětická-Holubínská z Kamýčku', gender: 'female' as const, birthDate: '1950', birthPlace: 'Zeta', parents: ['orrin', 'maelis'] },
    orrin: { firstName: 'Bohuslav', lastName: 'Vrbětický-Holubínský z Kamýčku', gender: 'male' as const, birthDate: '1920', birthPlace: 'Eta', parents: ['corwen', 'ysolde'], partners: ['maelis'] },
    corwen: { firstName: 'Václav', lastName: 'Vrbětický-Holubínský z Kamýčku', gender: 'male' as const, birthDate: '1890', birthPlace: 'Iota', parents: ['ansel'], partners: ['ysolde'] },
    ansel: { firstName: 'Ludmila', lastName: 'Vrbětická-Holubínská z Kamýčku', gender: 'female' as const, birthDate: '1860', birthPlace: 'Lambda' },
    ...UNDATED,
};

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]] as const) {
    test.describe(`German with long names at ${width} px`, () => {
        test.use(width === 390
            ? { viewport: { width, height }, hasTouch: true, isMobile: true }
            : { viewport: { width, height } });

        test('the chip, the legend and the bar overflow nothing and overlap nothing', async ({ page }) => {
            await stubTiles(page);
            await seedPathTree(page, LONG);
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await choose(page, 'tamsin');
            await setYear(page, 1950);
            const pathChip = page.locator('.map-path-chip');
            const bar = page.locator('#map-timebar');
            await expect(pathChip.locator('.map-path-chip-name')).toHaveText(/Ludmila Vrbětická-Holubínská z Kamýčku/);
            expect(await fits(pathChip)).toBe(true);
            expect(await fits(bar)).toBe(true);
            const controls = await box(page.locator('.map-controls'));
            expect(apart(await box(pathChip), controls)).toBe(true);
            const barBox = await box(bar);

            if (width === 390) {
                const chip = page.locator('.map-lines-chip');
                await expect(chip.locator('.map-lines-chip-text')).toHaveText('Stammlinien (4)');
                expect(apart(await box(chip), barBox)).toBe(true);
                await chip.click();
                const sheet = page.getByRole('dialog', { name: 'Stammlinien' });
                await expect(sheet).toBeVisible();
                await expect(sheet.locator('.map-lines-row[data-line="0"]')).toContainText('Vrbětick');
                expect(await fits(sheet)).toBe(true);
                return;
            }
            const legend = page.locator('.map-lines-legend');
            await expect(legend).toBeVisible();
            await expect(legend.locator('.map-lines-row[data-line="0"]')).toContainText('Vrbětick');
            expect(await fits(legend)).toBe(true);
            const lb = await box(legend);
            expect(apart(lb, barBox)).toBe(true);
            expect(apart(lb, controls)).toBe(true);
            expect(apart(await box(pathChip), lb)).toBe(true);
        });
    });
}
