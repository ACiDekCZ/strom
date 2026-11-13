import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * The ancestors' path to one person on the map (Migration over time with a
 * chosen person): the bar's "Path to a person…" button, the choice of the
 * person, the chip in the scope's place, the coloured lines, the target and
 * the bar's range. Tiles are stubbed and coordinates set directly on the tree,
 * so nothing reaches OpenStreetMap or a geocoder.
 */

async function stubTiles(page: Page): Promise<void> {
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
    );
    await page.route('**://tile.openstreetmap.org/**', route =>
        route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await page.addInitScript(() => {
        const raw = localStorage.getItem('strom-settings');
        const settings = raw ? JSON.parse(raw) : {};
        settings.mapTiles = true;
        localStorage.setItem('strom-settings', JSON.stringify(settings));
    });
}

/**
 * Three generations above Tamsin (born Zeta 1950):
 *   parents      Orrin Quillfen (Eta 1920), Maelis Ostrowbek (Theta 1922)
 *   grandparents Corwen Quillfen (Iota 1890), Ysolde Zandmeer (Kappa 1893)
 *   great-grand  Ansel Quillfen (Lambda 1860) → quarter 0, Ivar Zandmeer (Mu 1865) → quarter 1
 * Bram Pellwick (Zeta 1960) has no ancestors at all; Elowen Yarrowby has no
 * place of her own, her father Fennick (Eta 1900) has one.
 * The path to Tamsin therefore runs 1860 → 1950. `extra` adds or replaces people.
 */
async function seedPathTree(page: Page, extra: Record<string, SeedPerson> = {}): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        tamsin: { firstName: 'Tamsin', lastName: 'Quillfen', gender: 'female', birthDate: '1950', birthPlace: 'Zeta', parents: ['orrin', 'maelis'] },
        orrin: { firstName: 'Orrin', lastName: 'Quillfen', gender: 'male', birthDate: '1920', birthPlace: 'Eta', parents: ['corwen', 'ysolde'], partners: ['maelis'] },
        maelis: { firstName: 'Maelis', lastName: 'Ostrowbek', gender: 'female', birthDate: '1922', birthPlace: 'Theta' },
        corwen: { firstName: 'Corwen', lastName: 'Quillfen', gender: 'male', birthDate: '1890', birthPlace: 'Iota', parents: ['ansel'], partners: ['ysolde'] },
        ysolde: { firstName: 'Ysolde', lastName: 'Zandmeer', gender: 'female', birthDate: '1893', birthPlace: 'Kappa', parents: ['ivar'] },
        ansel: { firstName: 'Ansel', lastName: 'Quillfen', gender: 'male', birthDate: '1860', birthPlace: 'Lambda' },
        ivar: { firstName: 'Ivar', lastName: 'Zandmeer', gender: 'male', birthDate: '1865', birthPlace: 'Mu' },
        bram: { firstName: 'Bram', lastName: 'Pellwick', gender: 'male', birthDate: '1960', birthPlace: 'Zeta' },
        elowen: { firstName: 'Elowen', lastName: 'Yarrowby', gender: 'female', birthDate: '1930', parents: ['fennick'] },
        fennick: { firstName: 'Fennick', lastName: 'Yarrowby', gender: 'male', birthDate: '1900', birthPlace: 'Eta' },
        ...extra,
    });

    await page.evaluate(() => {
        window.Strom.DataManager.getData().places = {
            zeta: { lat: 50.0, lon: 14.0 },
            eta: { lat: 49.5, lon: 15.0 },
            theta: { lat: 50.4, lon: 13.0 },
            iota: { lat: 49.0, lon: 16.0 },
            kappa: { lat: 48.8, lon: 14.5 },
            lambda: { lat: 48.5, lon: 17.0 },
            mu: { lat: 48.2, lon: 13.5 },
        };
        window.Strom.TreeRenderer.render();
    });

    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
    await page.getByRole('button', { name: 'Whole tree' }).click();
    await expect(page.locator('.map-marker').first()).toBeVisible();
    await page.getByRole('button', { name: 'Migration over time' }).click();
    await expect(page.locator('#map-timebar')).toBeVisible();
}

async function setYear(page: Page, year: number): Promise<void> {
    await page.locator('.map-time-range').evaluate((el, val) => {
        const input = el as HTMLInputElement;
        input.value = String(val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, year);
}

async function choosePerson(page: Page, query: string, name: RegExp): Promise<void> {
    await page.locator('.map-path-btn').click();
    const picker = page.locator('.map-path-picker');
    await expect(picker).toBeVisible();
    await picker.locator('.path-picker-input').fill(query);
    await picker.locator('.path-picker-row', { hasText: name }).click();
    await expect(picker).toHaveCount(0);
}

test('a person chosen from the bar draws the coloured path, the chip replaces the scope and the bar runs from the first ancestor to the target', async ({ page }) => {
    await stubTiles(page);
    await seedPathTree(page);

    await expect(page.locator('.map-path-btn')).toBeVisible();
    await expect(page.locator('.map-path-chip')).toBeHidden();
    await choosePerson(page, 'Quillfen', /Tamsin/);

    // The chip with the person's name stands where the scope stood; the bar's button is gone.
    const chip = page.locator('.map-path-chip');
    await expect(chip).toBeVisible();
    await expect(chip.locator('.map-path-chip-name')).toHaveText(/Tamsin Quillfen/);
    await expect(page.locator('.map-scope')).toBeHidden();
    await expect(page.locator('.map-path-btn')).toBeHidden();

    // The bar spans the first ancestor's year to the target's and starts at its beginning.
    const range = page.locator('.map-time-range');
    await expect(range).toHaveAttribute('min', '1860');
    await expect(range).toHaveAttribute('max', '1950');
    await expect(page.locator('.map-time-year')).toHaveText('1860');

    // Before the end: the target is a faint dashed ring with its label.
    const target = page.locator('.map-path-target');
    await expect(target).toHaveCount(1);
    await expect(target).not.toHaveClass(/is-reached/);
    await expect(target.locator('.map-path-target-ring')).toHaveCSS('border-top-style', 'dashed');

    // At the end every line is drawn: the trunk and the great-grandparents' quarters in their colours, each on a casing.
    await setYear(page, 1950);
    await expect(target).toHaveClass(/is-reached/);
    await expect(target.locator('.map-path-target-ring')).toHaveCSS('border-top-style', 'solid');
    const lines = page.locator('path.map-path-line');
    await expect(lines).toHaveCount(6);
    await expect(page.locator('path.map-path-line[data-cls="trunk"]')).toHaveCount(4);
    await expect(page.locator('path.map-path-line[data-cls="q0"]')).toHaveAttribute('stroke', 'var(--line-q0)');
    await expect(page.locator('path.map-path-line[data-cls="q1"]')).toHaveAttribute('stroke', 'var(--line-q1)');
    await expect(page.locator('.map-path-casing path')).toHaveCount(6);
    await expect(page.locator('.map-lines line')).toHaveCount(0);

    // The ancestors' points: each place of the path is one point (Zeta is the target's).
    await expect(page.locator('.map-path-point')).toHaveCount(6);
    await expect(page.locator('.map-path-point[data-key="lambda"]')).toHaveAttribute('data-classes', 'q0');

    // The ×: the scope and the ordinary migration lines come back.
    await chip.locator('.map-path-chip-clear').click();
    await expect(chip).toBeHidden();
    await expect(page.locator('.map-scope')).toBeVisible();
    await expect(page.locator('.map-path-btn')).toBeVisible();
    await expect(page.locator('path.map-path-line')).toHaveCount(0);
    await expect(page.locator('.map-path-target')).toHaveCount(0);
});

test('the choice greys out a person without ancestors on the map and says how many each one has', async ({ page }) => {
    await stubTiles(page);
    await seedPathTree(page);

    await page.locator('.map-path-btn').click();
    const picker = page.locator('.map-path-picker');
    await expect(picker).toBeVisible();
    await expect(picker.locator('.path-picker-input')).toBeFocused();

    await picker.locator('.path-picker-input').fill('Pellwick');
    const bram = picker.locator('.path-picker-row', { hasText: /Bram/ });
    await expect(bram).toHaveAttribute('aria-disabled', 'true');
    await expect(bram).toContainText('ancestors have no places on the map yet');
    await bram.click({ force: true });
    await expect(picker).toBeVisible();
    await expect(page.locator('.map-path-chip')).toBeHidden();

    await picker.locator('.path-picker-input').fill('Tamsin');
    const tamsin = picker.locator('.path-picker-row', { hasText: /Tamsin/ });
    await expect(tamsin).toHaveAttribute('aria-disabled', 'false');
    await expect(tamsin).toContainText('6 ancestors on the map');

    // Escape closes the choice and leaves the map as it was.
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(page.locator('#map-timebar')).toBeVisible();
    await expect(page.locator('.map-scope')).toBeVisible();
});

test('a target without a place ends the path at its parents and says so; a target without ancestors on the map offers another person', async ({ page }) => {
    await stubTiles(page);
    await seedPathTree(page);

    await choosePerson(page, 'Yarrowby', /Elowen/);
    await expect(page.locator('.map-path-chip-name')).toHaveText(/Elowen Yarrowby/);
    await setYear(page, 1930);
    await expect(page.locator('.map-path-target')).toHaveCount(0);
    await expect(page.locator('.map-time-caption')).toContainText('Elowen Yarrowby has no place on the map.');

    // A person whose ancestors have no place (set from another window's state, say): no lines, the slider off, another person offered.
    await page.evaluate(() => window.Strom.UI.setMapPathTarget('bram' as never));
    await expect(page.locator('.map-path-chip-name')).toHaveText(/Bram Pellwick/);
    await expect(page.locator('path.map-path-line')).toHaveCount(0);
    await expect(page.locator('.map-time-range')).toBeDisabled();
    const caption = page.locator('.map-time-caption');
    await expect(caption).toContainText('No ancestor has a place on the map yet.');
    await caption.getByRole('button', { name: 'Choose another person' }).click();
    await expect(page.locator('.map-path-picker')).toBeVisible();
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the choice is a bottom sheet and the path button spans the bar', async ({ page }) => {
        await stubTiles(page);
        await seedPathTree(page);

        const btn = page.locator('.map-path-btn');
        await expect(btn).toBeVisible();
        const bar = await page.locator('#map-timebar').boundingBox();
        const box = await btn.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThan(bar!.width * 0.8);

        await btn.click();
        const picker = page.locator('.map-path-picker');
        await expect(picker).toHaveClass(/map-path-picker--sheet/);
        const sheet = await picker.boundingBox();
        expect(sheet!.x).toBeLessThanOrEqual(1);
        expect(Math.round(sheet!.x + sheet!.width)).toBeGreaterThanOrEqual(389);

        await picker.locator('.path-picker-input').fill('Tamsin');
        await picker.locator('.path-picker-row', { hasText: /Tamsin/ }).click();
        const chip = page.locator('.map-path-chip');
        await expect(chip).toBeVisible();
        const chipBox = await chip.boundingBox();
        expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(390);
        const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollW).toBeLessThanOrEqual(390);
    });
});

/** Freeze the page's clock (installed before the app loaded): from here on time moves only by runFor. */
async function pauseClock(page: Page): Promise<void> {
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 1000);
}

test('Play runs the path by its 24 s schedule, says what came onto the map, stops at the target and starts again from the beginning; the slider pauses it', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T10:00:00Z') });
    await stubTiles(page);
    await seedPathTree(page);
    await choosePerson(page, 'Quillfen', /Tamsin/);
    await pauseClock(page);

    const year = page.locator('.map-time-year');
    const play = page.locator('.map-time-play');
    const caption = page.locator('.map-time-caption');
    await expect(year).toHaveText('1860');
    await expect(caption).toHaveAttribute('aria-live', 'polite');
    await expect(caption).toContainText('1860 · Ansel Quillfen · Lambda');

    // 1860 → 1950 with seven years in which someone came (weight 5) and 84 empty ones (weight 1):
    // 1860 lasts ≈1008 ms, an empty year ≈202 ms, so after 2 s the bar stands at 1865.
    await play.click();
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await page.clock.runFor(2000);
    await expect(year).toHaveText('1865');
    await expect(caption).toContainText('1865 · Ivar Zandmeer · Mu');
    await expect(page.locator('.map-time-range')).toHaveAttribute('aria-valuetext', '1865 · Ivar Zandmeer · Mu');

    // The whole range takes 24 s: it ends at the target's year, stops and shows the target reached.
    await page.clock.runFor(24000);
    await expect(year).toHaveText('1950');
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await expect(page.locator('.map-path-target')).toHaveClass(/is-reached/);
    await expect(caption.locator('.map-time-added')).toHaveClass(/is-target/);
    await expect(caption).toContainText('1950 · Tamsin Quillfen · Eta → Zeta');
    await page.clock.runFor(2000);
    await expect(year).toHaveText('1950');

    // Play again: from the beginning.
    await play.click();
    await expect(year).toHaveText('1860');
    await page.clock.runFor(1500);
    await expect(year).not.toHaveText('1860');

    // Moving the slider pauses at the chosen year.
    await setYear(page, 1900);
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await page.clock.runFor(3000);
    await expect(year).toHaveText('1900');
    await expect(page.locator('.map-time-range')).toHaveAttribute('aria-valuetext', '1900 · 1893 · Ysolde Zandmeer · Mu → Kappa');
});

test('the marks above the slider jump to a line\'s earliest ancestor and to the target; keys move the year and the space bar plays and pauses', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T10:00:00Z') });
    await stubTiles(page);
    await seedPathTree(page);
    await choosePerson(page, 'Quillfen', /Tamsin/);
    await pauseClock(page);
    const year = page.locator('.map-time-year');
    const range = page.locator('.map-time-range');
    const play = page.locator('.map-time-play');

    // Two known quarters (the mother's parents are unknown) and the target.
    const marks = page.locator('.map-timebar-mark');
    await expect(marks).toHaveCount(3);
    const q0 = page.locator('.map-timebar-mark[data-mark="q0"]');
    const q1 = page.locator('.map-timebar-mark[data-mark="q1"]');
    const goal = page.locator('.map-timebar-mark[data-mark="target"]');
    await expect(q0).toHaveAttribute('title', 'Quillfen: earliest ancestor 1860');
    await expect(q1).toHaveAttribute('aria-label', 'Zandmeer: earliest ancestor 1865');
    await expect(goal).toHaveAttribute('title', '◎ Tamsin Quillfen · 1950');
    const [b0, b1, bg, br] = await Promise.all([q0.boundingBox(), q1.boundingBox(), goal.boundingBox(), range.boundingBox()]);
    expect(b0!.x).toBeLessThan(b1!.x);
    expect(b1!.x).toBeLessThan(bg!.x);
    expect(b0!.y + b0!.height).toBeLessThanOrEqual(br!.y + br!.height / 2);
    // The marks follow the thumb's travel: the first over the start, the target over the end.
    expect(Math.abs(b0!.x + b0!.width / 2 - (br!.x + 8))).toBeLessThanOrEqual(2);
    expect(Math.abs(bg!.x + bg!.width / 2 - (br!.x + br!.width - 8))).toBeLessThanOrEqual(2);

    // A mark pauses the playback and jumps.
    await play.click();
    await page.clock.runFor(500);
    await q1.click();
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await expect(year).toHaveText('1865');
    await goal.focus();
    await page.keyboard.press('Enter');
    await expect(year).toHaveText('1950');

    // Keys on the slider.
    await range.focus();
    await page.keyboard.press('Home');
    await expect(year).toHaveText('1860');
    await page.keyboard.press('PageUp');
    await expect(year).toHaveText('1870');
    await page.keyboard.press('ArrowRight');
    await expect(year).toHaveText('1871');
    await page.keyboard.press('PageDown');
    await expect(year).toHaveText('1861');
    await page.keyboard.press('ArrowLeft');
    await expect(year).toHaveText('1860');
    await page.keyboard.press('End');
    await expect(year).toHaveText('1950');
    await page.keyboard.press('Home');

    // The space bar on the map plays and pauses: on the slider and with nothing focused.
    await page.keyboard.press(' ');
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await page.keyboard.press(' ');
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(' ');
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await page.keyboard.press(' ');
    await expect(play).toHaveAttribute('aria-label', 'Play');

    // Escape lets a pinned line go.
    await page.evaluate(() => { window.Strom.UI.mapLineFocus = 1; window.Strom.UI.refreshMapPath(); });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.Strom.UI.mapLineFocus)).toBeNull();
});

test('without a chosen person Play keeps its pace of a year every 120 ms and the bar has no marks or caption', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T10:00:00Z') });
    await stubTiles(page);
    await seedPathTree(page);
    await pauseClock(page);
    await expect(page.locator('.map-timebar-marks')).toBeHidden();
    await expect(page.locator('.map-time-caption')).toBeHidden();
    const year = page.locator('.map-time-year');
    const start = Number(await year.textContent());
    await page.locator('.map-time-play').click();
    await page.clock.runFor(1210);
    await expect(year).toHaveText(String(start + 10));
});

test.describe('the bar on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('with the path: ▶ alone at 44 px, the slider and the year in one row, what came onto the map under the slider', async ({ page }) => {
        await stubTiles(page);
        await seedPathTree(page);
        await page.evaluate(() => window.Strom.UI.setMapPathTarget('tamsin' as never));
        const play = page.locator('.map-time-play');
        const p = (await play.boundingBox())!;
        expect(Math.round(p.width)).toBe(44);
        expect(Math.round(p.height)).toBeGreaterThanOrEqual(44);
        await expect(play.locator('.map-time-play-text')).toBeHidden();
        const r = (await page.locator('.map-time-range').boundingBox())!;
        const y = (await page.locator('.map-time-year').boundingBox())!;
        const cap = page.locator('.map-time-caption');
        await expect(cap).toBeVisible();
        const c = (await cap.boundingBox())!;
        expect(r.x).toBeGreaterThan(p.x + p.width - 1);
        expect(y.x).toBeGreaterThan(r.x + r.width - 1);
        expect(c.y).toBeGreaterThanOrEqual(r.y + r.height - 1);
        await expect(page.locator('.map-timebar-mark')).toHaveCount(3);
        const mark = (await page.locator('.map-timebar-mark').first().boundingBox())!;
        expect(Math.round(mark.width)).toBe(10);
        const fits = await page.locator('#map-timebar').evaluate(el => el.scrollWidth <= el.clientWidth);
        expect(fits).toBe(true);
        // The unfolded legend is not a phone's (its chip and sheet come of their own).
        await expect(page.locator('.map-lines-legend')).toBeHidden();
    });
});

test.describe('the bar on a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('one row: ▶, the slider, the year; no caption line', async ({ page }) => {
        await stubTiles(page);
        await seedPathTree(page);
        await page.evaluate(() => window.Strom.UI.setMapPathTarget('tamsin' as never));
        const boxes = await Promise.all(['.map-time-play', '.map-time-range', '.map-time-year']
            .map(sel => page.locator(sel).boundingBox()));
        const mids = boxes.map(b => b!.y + b!.height / 2);
        for (const m of mids) expect(Math.abs(m - mids[0])).toBeLessThanOrEqual(4);
        await expect(page.locator('.map-time-caption')).toBeHidden();
        await expect(page.locator('.map-time-range')).toHaveAttribute('aria-valuetext', '1860 · Ansel Quillfen · Lambda');
        await expect(page.locator('.map-lines-legend')).toBeHidden();
    });
});

test('the legend lists the quarters with an unknown grandparent and the eighths, folds into its chip, pins a line and draws without line colours', async ({ page }) => {
    await stubTiles(page);
    await seedPathTree(page);
    await choosePerson(page, 'Quillfen', /Tamsin/);
    await setYear(page, 1950);

    // Right, under the column of controls (+ 12), as wide as 1280 px allows (320), down to the time bar at most.
    const legend = page.locator('.map-lines-legend');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.map-lines-title')).toHaveText('Family lines');
    const lb = (await legend.boundingBox())!;
    const cb = (await page.locator('.map-controls').boundingBox())!;
    const tb = (await page.locator('#map-timebar').boundingBox())!;
    expect(Math.round(lb.width)).toBe(320);
    expect(Math.abs(lb.y - (cb.y + cb.height + 12))).toBeLessThanOrEqual(1);
    expect(Math.abs(lb.x + lb.width - (cb.x + cb.width))).toBeLessThanOrEqual(1);
    expect(lb.y + lb.height).toBeLessThanOrEqual(tb.y);

    // Quarters: the two known grandparents' lines, the other two unknown, the trunk last.
    const rows = legend.locator('button.map-lines-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Quillfen');
    await expect(rows.nth(0)).toContainText("father's father");
    await expect(rows.nth(1)).toContainText('Zandmeer');
    await expect(rows.nth(1)).toContainText("father's mother");
    const unknown = legend.locator('.map-lines-row.is-unknown');
    await expect(unknown).toHaveText(["mother's father – unknown", "mother's mother – unknown"]);
    await expect(unknown.first().locator('.map-lines-swatch')).toHaveCSS('border-top-style', 'dashed');
    await expect(legend.locator('.map-lines-row').last()).toHaveText('Trunk: parents and grandparents');

    // Eighths (two are known): a heading per quarter, "1 · Quillfen" and "3 · Zandmeer", the lines coloured by their eighth.
    const eighths = legend.getByRole('button', { name: 'Eighths' });
    await expect(eighths).not.toHaveAttribute('aria-disabled', 'true');
    await eighths.click();
    await expect(legend.getByRole('button', { name: 'Eighths' })).toHaveAttribute('aria-pressed', 'true');
    await expect(legend.locator('.map-lines-group')).toHaveCount(4);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.map-lines-name')).toHaveText('1 · Quillfen');
    await expect(rows.nth(1).locator('.map-lines-name')).toHaveText('3 · Zandmeer');
    // An eighth's row: the count under the name, its relation only in the title and the label.
    await expect(rows.nth(0).locator('.map-lines-sub')).toHaveText('1 ancestor');
    await expect(rows.nth(0)).toHaveAttribute('title', "father's father's father");
    await expect(rows.nth(0)).toHaveAttribute('aria-label', "1 · Quillfen · father's father's father · 1 ancestor");
    await expect(legend.locator('.map-lines-row.is-unknown').first()).toHaveText("2 · father's father's mother – unknown");
    await expect(page.locator('path.map-path-line[data-cls="e0"]')).toHaveCount(1);
    await expect(page.locator('path.map-path-line[data-cls="e2"]')).toHaveCount(1);
    await legend.getByRole('button', { name: 'Quarters' }).click();
    await expect(page.locator('path.map-path-line[data-cls="q0"]')).toHaveCount(1);

    // Hovering a row highlights its line for a moment.
    const opacity = (cls: string) => page.locator(`path.map-path-line[data-cls="${cls}"]`).first().getAttribute('opacity').then(Number);
    const away = () => page.mouse.move(400, 400);
    await rows.nth(1).hover();
    await expect.poll(() => opacity('q0')).toBeLessThan(0.2);
    await expect(rows.nth(0)).toHaveClass(/is-dim/);
    await away();
    await expect.poll(() => opacity('q0')).toBeGreaterThan(0.5);
    await expect(rows.nth(0)).not.toHaveClass(/is-dim/);

    // A press pins a line: the others fade, its row stays; a second press or Escape lets go.
    await rows.nth(0).click();
    await away();
    await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(rows.nth(1)).toHaveClass(/is-dim/);
    expect(await opacity('q1')).toBeLessThan(0.2);
    expect(await opacity('q0')).toBeGreaterThan(0.5);
    await rows.nth(0).click();
    await away();
    await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'false');
    expect(await opacity('q1')).toBeGreaterThan(0.5);
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window.Strom.UI.mapLineFocus)).toBeNull();

    // ▴ folds the legend into its chip with the lines' colours; the chip unfolds it.
    const fold = legend.locator('.map-lines-collapse');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await fold.click();
    await expect(legend).toHaveCount(0);
    const chip = page.locator('.map-lines-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(chip).toContainText('Family lines (2)');
    await expect(chip.locator('.map-lines-chip-bars span')).toHaveCount(2);
    await expect(chip).toBeFocused();
    await chip.click();
    await expect(legend).toBeVisible();
    await expect(chip).toHaveCount(0);
    await expect(legend.locator('.map-lines-collapse')).toBeFocused();

    // No line colours: every line in the primary colour, the rows gone, the person stays.
    const off = legend.getByRole('checkbox', { name: 'No line colours' });
    await expect(off).toHaveAttribute('aria-checked', 'false');
    await off.click();
    await expect(legend.getByRole('checkbox', { name: 'No line colours' })).toHaveAttribute('aria-checked', 'true');
    await expect(legend.locator('.map-lines-row')).toHaveCount(0);
    const strokes = await page.locator('path.map-path-line').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('stroke')))]);
    expect(strokes).toEqual(['var(--primary)']);
    await expect(page.locator('.map-path-chip-name')).toHaveText(/Tamsin/);
    await legend.getByRole('checkbox', { name: 'No line colours' }).click();
    await expect(legend.locator('button.map-lines-row')).toHaveCount(2);

    // Without the path the legend goes.
    await page.locator('.map-path-chip-clear').click();
    await expect(page.locator('.map-lines-legend, .map-lines-chip')).toHaveCount(0);
});

test('the ancestors off the timeline are counted under the legend and listed with what is missing and their person page', async ({ page }) => {
    await stubTiles(page);
    await seedPathTree(page, {
        maelis: { firstName: 'Maelis', lastName: 'Ostrowbek', gender: 'female', birthDate: '1922', birthPlace: 'Theta', parents: ['tobrin', 'hesper'] },
        tobrin: { firstName: 'Tobrin', lastName: 'Ostrowbek', gender: 'male', birthDate: '1895', partners: ['hesper'] },
        hesper: { firstName: 'Hesper', lastName: 'Corvith', gender: 'female' },
    });
    await choosePerson(page, 'Quillfen', /Tamsin/);
    const legend = page.locator('.map-lines-legend');
    await expect(legend.locator('.map-lines-undated')).toContainText('2 ancestors without a date or place are not on the timeline.');

    const list = legend.getByRole('button', { name: 'List ›' });
    await list.click();
    const pop = page.getByRole('dialog', { name: 'Ancestors not on the timeline' });
    await expect(pop).toBeVisible();
    await expect(list).toHaveAttribute('aria-expanded', 'true');
    const items = pop.locator('.map-lines-und-row');
    await expect(items).toHaveCount(2);
    await expect(pop.locator('.map-lines-und-row', { hasText: 'Tobrin Ostrowbek' })).toContainText('no place');
    await expect(pop.locator('.map-lines-und-row', { hasText: 'Hesper Corvith' })).toContainText('no date or place');
    await expect(items.first().getByRole('button', { name: 'Person page ›' })).toBeVisible();
    await expect(pop.locator('.map-lines-und-foot')).toContainText('Locations of places are added in Places ›');
    // Left of the legend, at its top.
    const pb = (await pop.boundingBox())!;
    const lb = (await legend.boundingBox())!;
    expect(pb.x + pb.width).toBeLessThanOrEqual(lb.x);
    expect(Math.abs(pb.y - lb.y)).toBeLessThanOrEqual(1);

    // Escape closes it and gives the focus back to "List ›".
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(list).toBeFocused();
    await expect(page.locator('.map-path-chip')).toBeVisible();

    // A person page from the list.
    await list.click();
    await pop.locator('.map-lines-und-row', { hasText: 'Hesper Corvith' }).getByRole('button', { name: 'Person page ›' }).click();
    await expect(page.locator('#person-page-modal')).toBeVisible();
    await expect(page.locator('#person-page-modal')).toContainText('Hesper Corvith');
});

test('a person row in the bubble of Migration over time unfolds the person page and the path to that person; with a path the bubble shows its lines', async ({ page }) => {
    await stubTiles(page);
    await seedPathTree(page);
    await setYear(page, 1960);
    await page.locator('.map-marker[data-key="zeta"]').click();
    const popup = page.locator('.map-popup');
    await expect(popup).toBeVisible();
    const tamsin = popup.locator('.map-popup-person', { hasText: 'Tamsin Quillfen' });
    const bram = popup.locator('.map-popup-person', { hasText: 'Bram Pellwick' });
    await expect(tamsin).toHaveAttribute('aria-expanded', 'false');
    await expect(tamsin).toContainText('* 1950');

    // Bram has no ancestor on the map: his page only. Tamsin has: her page and her path; one row open at a time.
    await bram.click();
    await expect(bram).toHaveAttribute('aria-expanded', 'true');
    const acts = popup.locator('.map-popup-person-acts');
    await expect(acts).toHaveCount(1);
    await expect(acts.getByRole('button')).toHaveText(['Person page ›']);
    await tamsin.click();
    await expect(bram).toHaveAttribute('aria-expanded', 'false');
    await expect(tamsin).toHaveAttribute('aria-expanded', 'true');
    await expect(acts).toHaveCount(1);
    await expect(acts.getByRole('button')).toHaveText(['Person page ›', '◎ Path to this person']);

    // The path to her: the chip, the bubble closed, the bar from 1860.
    await acts.getByRole('button', { name: '◎ Path to this person' }).click();
    await expect(page.locator('.map-path-chip-name')).toHaveText(/Tamsin Quillfen/);
    await expect(popup).toBeHidden();
    await expect(page.locator('.map-time-year')).toHaveText('1860');

    // With the path: Lambda's bubble shows the line met there, Ansel with its dot and year; no path to him (none of his ancestors is on the map).
    await setYear(page, 1950);
    await page.locator('.map-path-point[data-key="lambda"]').click();
    await expect(popup).toBeVisible();
    await expect(popup.locator('.map-popup-line')).toHaveText(["Quillfen · father's father"]);
    const ansel = popup.locator('.map-popup-person', { hasText: 'Ansel Quillfen' });
    await expect(ansel).toContainText('* 1860');
    await expect(ansel.locator('.map-popup-dot')).toHaveCount(1);
    await ansel.click();
    await expect(popup.locator('.map-popup-person-acts').getByRole('button')).toHaveText(['Person page ›']);
    // The bubble stays left of the legend.
    const pb = (await popup.boundingBox())!;
    const lb = (await page.locator('.map-lines-legend').boundingBox())!;
    expect(pb.x + pb.width).toBeLessThanOrEqual(lb.x);

    // The target's own place: the target is listed and is not offered again.
    await page.keyboard.press('Escape');
    await page.locator('.map-path-target').evaluate(el => el.getAttribute('data-key')).then(k => expect(k).toBe('zeta'));
    await page.evaluate(() => window.Strom.UI.showMapPlace('zeta'));
    const goal = popup.locator('.map-popup-person', { hasText: 'Tamsin Quillfen' });
    await expect(goal).toBeVisible();
    await goal.click();
    await expect(popup.locator('.map-popup-person-acts').getByRole('button')).toHaveText(['Person page ›']);
});
