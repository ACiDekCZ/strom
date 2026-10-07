import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The person card's life timeline after the 3.10 tester round: a divorce as
 * its own row, the children's events behind the head's chip (T15). Invented
 * data.
 */

function ged(): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 1841', '2 PLAC Bystřice', '1 DEAT', '2 DATE 1922', '2 PLAC Bystřice', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Anna /Králová/', '1 SEX F', '1 BIRT', '2 DATE 1845', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME Marie /Vlková/', '1 SEX F', '1 BIRT', '2 DATE 1867', '1 FAMC @F1@', '1 FAMS @F2@',
        '0 @I4@ INDI', '1 NAME Václav /Vlk/', '1 SEX M', '1 BIRT', '2 DATE 1870',
        '1 DEAT', '2 DATE 1894', '2 PLAC Bystřice', '1 BURI', '2 DATE 1894', '2 PLAC Bystřice', '1 FAMC @F1@',
        '0 @I5@ INDI', '1 NAME Karel /Malý/', '1 SEX M', '1 FAMS @F2@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 CHIL @I4@',
        '1 MARR', '2 DATE 1866', '2 PLAC Dolní Lhota', '1 DIV', '2 DATE 1898',
        '0 @F2@ FAM', '1 HUSB @I5@', '1 WIFE @I3@', '1 MARR', '2 DATE 1889', '2 PLAC Praha', '1 DIV', '2 DATE 1912',
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

async function setup(page: Page, width = 1440, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await dropFile(page, ged());
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, 'Jan')).toBeVisible();
}

const idOf = (page: Page, first: string) => page.evaluate((first) =>
    window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === first)!.id, first);

async function openCard(page: Page, first: string): Promise<void> {
    const id = await idOf(page, first);
    await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
    await expect(page.locator('#pm-lifeline-section')).toBeVisible();
}

const rows = (page: Page) => page.locator('#pm-lifeline-body .pm-lifeline-row');

test.describe('T15: divorce and the children\'s events in the life timeline', () => {
    test('a divorce is its own row; the children\'s events wait behind the chip, which is remembered', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Jan');
        await expect(rows(page).filter({ hasText: 'Divorced Anna Králová' })).toHaveCount(1);
        await expect(rows(page).filter({ hasText: 'Divorced Anna Králová' }).locator('.pm-lifeline-year')).toHaveText('1898');

        const chip = page.locator('#pm-lifeline-child-toggle');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveText("Children's events");
        await expect(chip).toHaveAttribute('role', 'switch');
        await expect(chip).toHaveAttribute('aria-checked', 'false');
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row.k-childEvent')).toHaveCount(0);

        // The chip does not fold the section, and adds indented rows.
        await chip.click();
        await expect(page.locator('#pm-lifeline-section')).not.toHaveClass(/collapsed/);
        await expect(chip).toHaveAttribute('aria-checked', 'true');
        const child = page.locator('#pm-lifeline-body .pm-lifeline-row.k-childEvent');
        await expect(child.locator('.pm-lifeline-desc')).toHaveText([
            'Marie Vlková: marriage · Praha',
            'Václav Vlk: death · Bystřice',
            'Václav Vlk: burial · Bystřice',
            'Marie Vlková: divorce',
        ]);
        const own = await rows(page).first().evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
        const indented = await child.first().evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
        expect(indented - own).toBe(16);

        // One choice for everybody, kept over a reload.
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await openCard(page, 'Anna');
        await expect(page.locator('#pm-lifeline-child-toggle')).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row.k-childEvent')).toHaveCount(4);
    });

    test('no chip without any child event', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Marie');
        await expect(rows(page).filter({ hasText: 'Divorced Karel Malý' })).toHaveCount(1);
        await expect(page.locator('#pm-lifeline-child-toggle')).toBeHidden();
    });

    test('phone: the chip stays on the head row, 32 px high', async ({ page }) => {
        await setup(page, 360, 740);
        await openCard(page, 'Jan');
        const chip = page.locator('#pm-lifeline-child-toggle');
        await expect(chip).toBeVisible();
        const head = await page.locator('#pm-lifeline-head .pm-section-title').boundingBox();
        const box = await chip.boundingBox();
        expect(box!.height).toBe(32);
        // Same row: the chip's vertical middle within the title's line.
        expect(Math.abs((box!.y + box!.height / 2) - (head!.y + head!.height / 2))).toBeLessThan(4);
        expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    });
});

/** Serve a blank PNG for every map tile and count the OSM notice as seen. */
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

const pmName = (page: Page) => page.locator('#person-modal #pm-name');
const link = (page: Page, text: string) =>
    page.locator('#pm-lifeline-body .pm-lifeline-link', { hasText: text }).first();

test.describe('T17: names and places in the life timeline are links', () => {
    test('a name opens that person\'s card; this card\'s own name is no link', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Jan');
        await expect(pmName(page)).toHaveText('Jan Vlk');
        await link(page, 'Anna Králová').click();
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(pmName(page)).toHaveText('Anna Králová');
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
        // On Anna's card, the partner is Jan — a link back.
        await link(page, 'Jan Vlk').click();
        await expect(pmName(page)).toHaveText('Jan Vlk');
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-link', { hasText: 'Jan Vlk' })).toHaveCount(0);
    });

    test('unsaved changes are asked about first: Stay keeps the card, Discard and Save go on', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Jan');
        await page.locator('#input-notes').fill('mlynář');
        await link(page, 'Marie Vlková').click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toHaveClass(/active/);
        await page.locator('#confirm-stay-btn').click();
        await expect(pmName(page)).toHaveText('Jan Vlk');
        await expect(page.locator('#input-notes')).toHaveValue('mlynář');

        await link(page, 'Marie Vlková').click();
        await page.locator('#confirm-discard-btn').click();
        await expect(pmName(page)).toHaveText('Marie Vlková');
        const notes = () => page.evaluate(() => window.Strom.DataManager.getAllPersons()
            .find((p: { firstName: string }) => p.firstName === 'Jan')!.notes ?? '');
        expect(await notes()).toBe('');

        await openCard(page, 'Jan');
        await expect(pmName(page)).toHaveText('Jan Vlk');
        await page.locator('#input-notes').fill('mlynář');
        await link(page, 'Václav Vlk').click();
        await page.locator('#confirm-save-btn').click();
        await expect(pmName(page)).toHaveText('Václav Vlk');
        expect(await notes()).toBe('mlynář');
    });

    test('a place with coordinates opens the map on it', async ({ page }) => {
        await stubTiles(page);
        await setup(page);
        await page.evaluate(() => window.Strom.DataManager.setPlaceGeos(new Map([['dolni lhota', { lat: 49.5, lon: 16.25 }]])));
        await openCard(page, 'Jan');
        await link(page, 'Dolní Lhota').click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        await expect(page.locator('#map-container')).toBeVisible();
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('map');
        expect(await page.evaluate(() => window.Strom.UI.mapCenter)).toEqual({ lat: 49.5, lon: 16.25 });
        await expect(page.locator('.map-popup')).toBeVisible();
        await expect(page.locator('.map-popup .map-popup-head strong')).toHaveText('Dolní Lhota');
    });

    test("a name inside a couple event's row opens the person, not the event", async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const u = Object.values(dm.getData().partnerships)[0] as { events?: unknown[] };
            const jan = dm.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Jan')!;
            if (!jan.partnerships.includes((u as { id: string }).id)) throw new Error('fixture');
            u.events = [{ id: 'ce1', type: 'banns', date: '1866' }];
        });
        await openCard(page, 'Jan');
        const row = page.locator('#pm-lifeline-body .pm-lifeline-row.is-link');
        await expect(row).toHaveCount(1);
        await row.locator('.pm-lifeline-link', { hasText: 'Anna Králová' }).click();
        await expect(pmName(page)).toHaveText('Anna Králová');
        await expect(page.locator('#event-editor-modal')).not.toHaveClass(/active/);
        // The keyboard too: Enter on the name is the name's, not the row's.
        await openCard(page, 'Jan');
        await row.locator('.pm-lifeline-link', { hasText: 'Anna Králová' }).focus();
        await page.keyboard.press('Enter');
        await expect(pmName(page)).toHaveText('Anna Králová');
        await expect(page.locator('#event-editor-modal')).not.toHaveClass(/active/);
    });

    test('a place without coordinates opens the places manager on its row', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Jan');
        await link(page, 'Bystřice').click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        const row = page.locator('#places-modal .place-row[data-key="bystrice"]');
        await expect(row).toBeVisible();
        await expect(row.locator('.place-search')).toBeVisible();
    });
});

/** Jan with places in his own life and thirty more people, one new place each:
 *  enough rows to overflow the places manager, Jan's death place sorting last. */
function manyPlacesGed(): string {
    const lines = [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 1841', '2 PLAC Bystřice', '1 DEAT', '2 DATE 1922', '2 PLAC Zlín',
    ];
    for (let i = 1; i <= 30; i++) {
        const n = String(i).padStart(2, '0');
        lines.push(`0 @P${n}@ INDI`, `1 NAME Osoba${n} /Malý/`, '1 SEX M', '1 BIRT', `2 DATE 18${n}`, `2 PLAC Místo ${n}`);
    }
    lines.push('0 TRLR');
    return lines.join('\n');
}

async function setupMany(page: Page, width: number, height: number): Promise<void> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await dropFile(page, manyPlacesGed());
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, 'Jan')).toBeVisible();
}

test.describe('N9: the places manager opened from the life timeline shows the place\'s row', () => {
    for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]] as const) {
        test(`${label}: the row is in view and focus is in it`, async ({ page }) => {
            await setupMany(page, width, height);
            await openCard(page, 'Jan');
            await link(page, 'Zlín').click();
            const modal = page.locator('#places-modal');
            const row = modal.locator('.place-row[data-key="zlin"]');
            await expect(row.locator('.place-search')).toBeVisible();
            // The last of 32 rows: the list really overflows.
            await expect(modal.locator('.place-row').last()).toHaveAttribute('data-key', 'zlin');
            // Settle a frame so that any late focus/scroll has happened.
            await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
            const geom = await row.evaluate((el) => {
                let box: HTMLElement | null = el.parentElement;
                while (box && !(box.scrollHeight > box.clientHeight
                    && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
                if (!box) throw new Error('no scroll container');
                const r = el.getBoundingClientRect();
                const c = box.getBoundingClientRect();
                return {
                    row: { top: r.top, bottom: r.bottom }, box: { top: c.top, bottom: c.bottom },
                    scrolled: box.scrollTop,
                    focusInRow: el.contains(document.activeElement),
                    focusClass: (document.activeElement as HTMLElement | null)?.className ?? '',
                };
            });
            expect(geom.scrolled).toBeGreaterThan(0);
            expect(geom.row.top).toBeGreaterThanOrEqual(geom.box.top - 0.5);
            expect(geom.row.bottom).toBeLessThanOrEqual(geom.box.bottom + 0.5);
            expect(geom.row.top).toBeGreaterThanOrEqual(0);
            expect(geom.row.bottom).toBeLessThanOrEqual(height);
            expect(geom.focusInRow).toBe(true);
            expect(geom.focusClass).toContain('place-query');
        });
    }
});

/** The vertical extent around the element's middle where a tap lands on it. */
async function tapExtent(page: Page, selector: string): Promise<{ top: number; bottom: number; coarse: boolean }> {
    return page.evaluate((selector) => {
        const el = document.querySelector(selector) as HTMLElement;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const mid = r.top + r.height / 2;
        const hits = (y: number): boolean => {
            const at = document.elementFromPoint(x, y);
            return !!at && (at === el || el.contains(at));
        };
        let top = mid;
        while (hits(top - 0.5)) top -= 0.5;
        let bottom = mid;
        while (hits(bottom + 0.5)) bottom += 0.5;
        return { top, bottom, coarse: matchMedia('(pointer: coarse)').matches };
    }, selector);
}

test.describe('P3: the children\'s events chip is a full touch target', () => {
    for (const [label, width, height] of [['phone', 390, 844], ['tablet', 820, 1180]] as const) {
        test.describe(label, () => {
            test.use({ hasTouch: true, isMobile: true, viewport: { width, height } });
            test(`${label}: a tap lands on the chip over at least 44 px`, async ({ page }) => {
                await setup(page, width, height);
                await openCard(page, 'Jan');
                const chip = page.locator('#pm-lifeline-child-toggle');
                await chip.scrollIntoViewIfNeeded();
                await expect(chip).toBeVisible();
                const hit = await tapExtent(page, '#pm-lifeline-child-toggle');
                expect(hit.coarse).toBe(true);
                expect(hit.bottom - hit.top).toBeGreaterThanOrEqual(44);
                // The tap area does what the chip does.
                await page.touchscreen.tap((await chip.boundingBox())!.x + 20, hit.top + 1);
                await expect(chip).toHaveAttribute('aria-checked', 'true');
            });
        });
    }
});
