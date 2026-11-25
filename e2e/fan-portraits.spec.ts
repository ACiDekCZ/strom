import { test, expect, Page } from '@playwright/test';
import { openApp, seedSetting, seedTree, SeedPerson } from './helpers.js';

/**
 * The fan's portraits (spec 118 K2.7, K2.8): in any ring, ancestors and
 * descendants with their partners, wherever a portrait is at least 32 px
 * across at the current zoom and the text still fits. Zooming in shows the
 * outer rings' photos, zooming out hides them again.
 */

const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Fictional surnames, one per family line. */
const SURNAMES = ['Arvenko', 'Belmudr', 'Corvanek', 'Dresslin', 'Elvatch', 'Fornmeyr', 'Gallowik', 'Hestrand',
    'Ivoldt', 'Jarnwick', 'Kestrup', 'Lormacht', 'Mirvald', 'Norrgast', 'Ospreyk', 'Pellandt'];

/** Seven rings of ancestors (Ahnentafel 1–255) and two generations of descendants with partners, all with a photo. */
function family(): Record<string, SeedPerson> {
    const people: Record<string, SeedPerson> = {};
    for (let n = 1; n <= 255; n++) {
        const g = Math.floor(Math.log2(n));
        const born = 1990 - 26 * g;
        people[`a${n}`] = {
            firstName: n === 1 ? 'Centrus' : `Anc${n}`, lastName: SURNAMES[n % SURNAMES.length],
            gender: n === 1 || n % 2 === 0 ? 'male' : 'female', photo: PHOTO,
            birthDate: String(born), ...(g > 0 ? { deathDate: String(born + 70) } : {}),
            ...(n < 128 ? { parents: [`a${2 * n}`, `a${2 * n + 1}`] } : {}),
            ...(n > 1 && n % 2 === 0 ? { partners: [`a${n + 1}`] } : {}),
        };
    }
    people.a1.partners = ['w1'];
    people.w1 = { firstName: 'Idalie', lastName: 'Quernova', gender: 'female', photo: PHOTO, birthDate: '1992' };
    for (const [id, first, born] of [['k1', 'Kamil', '2015'], ['k2', 'Klara', '2018']] as const) {
        people[id] = { firstName: first, lastName: SURNAMES[1], gender: id === 'k1' ? 'male' : 'female', photo: PHOTO, birthDate: born, parents: ['a1', 'w1'] };
    }
    people.k1.partners = ['w2'];
    people.w2 = { firstName: 'Evarine', lastName: 'Tollgrist', gender: 'female', photo: PHOTO, birthDate: '2016' };
    people.g1 = { firstName: 'Lio', lastName: SURNAMES[1], photo: PHOTO, birthDate: '2040', parents: ['k1', 'w2'] };
    return people;
}

async function openFan(page: Page, shape: 'half' | 'two'): Promise<void> {
    await openApp(page);
    await seedTree(page, family(), 'Fan portraits', 'a1');
    await page.evaluate((s) => {
        const R = window.Strom.TreeRenderer;
        R.setFanGenerations(7);
        R.setFanShape(s);
        if (s === 'two') R.setFanDescGenerations(2);
        R.setFanLook({ portraits: true });
        window.Strom.UI.setDisplayViewMode('fan');
    }, shape);
    await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
    await expect(page.locator('.fan-focus')).toContainText('Centrus');
}

interface Shot {
    /** The sectors (data-fan-key) with a portrait drawn. */
    keys: string[];
    /** The smallest portrait's diameter on screen, px (Infinity without one). */
    minPx: number;
    /** The portraits of descendants and partners. */
    desc: number;
}

function portraits(page: Page): Promise<Shot> {
    return page.evaluate(() => {
        const keys: string[] = [];
        let minPx = Infinity, desc = 0;
        for (const g of document.querySelectorAll<SVGGElement>('#fan-chart .fan-photo')) {
            const owner = g.closest('[data-fan-key]');
            const key = owner?.getAttribute('data-fan-key') ?? '?';
            keys.push(key);
            const kind = owner?.getAttribute('data-fan-kind');
            if (kind === 'desc' || kind === 'partner') desc++;
            const ring = g.querySelector('.fan-photo-ring')!.getBoundingClientRect();
            minPx = Math.min(minPx, ring.width, ring.height);
        }
        return { keys, minPx, desc };
    });
}

const viewBox = (page: Page) => page.locator('#fan-chart .fan-svg').getAttribute('viewBox');

/** Wait for the drawing to settle on its scale: the same viewBox over two looks. */
async function settle(page: Page): Promise<void> {
    let last = '';
    await expect.poll(async () => { const now = await viewBox(page); const same = now === last; last = now ?? ''; return same; }, { intervals: [150, 150, 150, 300] }).toBe(true);
}

/** Zoom in with the wheel over the fan's top (the outer rings), `n` notches. */
async function zoomAtTop(page: Page, n: number): Promise<void> {
    const box = (await page.locator('#fan-chart').boundingBox())!;
    const svg = (await page.locator('#fan-chart .fan-svg').boundingBox())!;
    await zoomAt(page, box.x + box.width / 2, Math.max(box.y, svg.y) + 24, n);
}

/** Zoom in with the wheel at a point of the page, `n` notches. */
async function zoomAt(page: Page, x: number, y: number, n: number): Promise<void> {
    await page.mouse.move(x, y);
    for (let i = 0; i < n; i++) {
        const before = await viewBox(page);
        await page.mouse.wheel(0, -240);
        // At the largest zoom a notch changes nothing: done.
        const moved = await expect.poll(() => viewBox(page), { timeout: 1500 }).not.toBe(before).then(() => true, () => false);
        if (!moved) break;
    }
    await settle(page);
}

for (const width of [1440, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
        test(`fan portraits at ${width} (${scheme}): any ring as far as 32 px, more when zoomed in (spec 118 K2.8)`, async ({ page }) => {
            await page.setViewportSize({ width, height: width > 640 ? 900 : 844 });
            await page.emulateMedia({ colorScheme: scheme });
            await openFan(page, 'half');
            const fit = await portraits(page);
            expect(fit.minPx).toBeGreaterThanOrEqual(31.5);
            if (width > 640) {
                // The whole fan on a desktop: beyond the parents and grandparents already, not in the outer rings.
                expect(fit.keys).toContain('a2');
                expect(fit.keys.some(k => /^a\d+$/.test(k) && Number(k.slice(1)) >= 8)).toBe(true);
                expect(fit.keys.some(k => /^a\d+$/.test(k) && Number(k.slice(1)) >= 128)).toBe(false);
            } else {
                // The whole fan on a phone: every portrait would be under 32 px.
                expect(fit.keys).toEqual([]);
            }
            await zoomAtTop(page, 4);
            const near = await portraits(page);
            expect(near.keys.length).toBeGreaterThan(0);
            expect(near.minPx).toBeGreaterThanOrEqual(31.5);
            // Zoomed in: a sector of an outer ring shows the photo it had no room for before.
            const added = near.keys.filter(k => !fit.keys.includes(k));
            expect(added.length).toBeGreaterThan(0);
            expect(added.some(k => /^a\d+$/.test(k) && Number(k.slice(1)) >= 32), added.join()).toBe(true);
            await page.screenshot({ path: test.info().outputPath(`fan-portraits-${width}-${scheme}.png`) });
            // Back to the whole fan: the photos of the outer rings go again.
            await page.locator('[data-fan-zoom-act="fit"]').click();
            await expect.poll(async () => (await portraits(page)).keys.sort().join()).toBe(fit.keys.sort().join());
        });
    }
}

for (const width of [1440, 390]) {
    test(`two-way fan portraits at ${width}: the descendants and the partners too (spec 118 K2.7)`, async ({ page }) => {
        await page.setViewportSize({ width, height: width > 640 ? 900 : 844 });
        await openFan(page, 'two');
        // Over the son's sector (the children's ring, below the focus).
        const son = (await page.locator('#fan-chart [data-fan-kind="desc"][data-fan-person="k1"] .fan-fill').boundingBox())!;
        await zoomAt(page, son.x + son.width / 2, son.y + son.height / 2, width > 640 ? 4 : 6);
        await expect.poll(async () => (await portraits(page)).desc).toBeGreaterThan(0);
        const near = await portraits(page);
        expect(near.minPx).toBeGreaterThanOrEqual(31.5);
        // A child's portrait and a partner's (the band), within the visible part of the fan.
        const shown = await page.evaluate(() => {
            const chart = document.getElementById('fan-chart')!.getBoundingClientRect();
            return [...document.querySelectorAll('#fan-chart :is([data-fan-kind="desc"], [data-fan-kind="partner"]) .fan-photo')].filter(g => {
                const r = g.getBoundingClientRect();
                return r.left >= chart.left && r.right <= chart.right && r.top >= chart.top && r.bottom <= chart.bottom;
            }).map(g => `${g.closest('[data-fan-kind]')!.getAttribute('data-fan-kind')}:${g.closest('[data-fan-person]')!.getAttribute('data-fan-person')}`);
        });
        expect(shown.some(k => k.startsWith('desc:')), shown.join()).toBe(true);
        if (width > 640) expect(shown.some(k => k.startsWith('partner:')), shown.join()).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`fan-portraits-two-${width}.png`) });
    });
}

test('fan portraits in German: the switch\'s new line fits the panel, the phone\'s sheet and Settings (spec 118 K2.8)', async ({ page }) => {
    await seedSetting(page, 'language', 'de');
    await page.setViewportSize({ width: 390, height: 844 });
    await openFan(page, 'half');
    await page.locator('#fan-legend-chip').click();
    await page.locator('#fan-sheet-tab-look').click();
    const sheet = page.locator('#fan-sheet-look');
    await expect(sheet.locator('label:has([data-fan-portraits]) .fan-look-sub')).toContainText('Vorfahren und Nachkommen');
    const overflow = (sel: string) => page.evaluate((s) => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth}`);
        for (const el of document.querySelectorAll<HTMLElement>(`${s}, ${s} *`)) {
            if (el.getClientRects().length === 0 || el instanceof SVGElement) continue;
            if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto') out.push(`${el.className || el.tagName}: ${el.scrollWidth} > ${el.clientWidth}`);
        }
        return out;
    }, sel);
    expect(await overflow('#fan-sheet-look')).toEqual([]);
    await page.keyboard.press('Escape');
    for (const width of [1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const btn = page.locator('#fan-look-btn');
        if (!(await page.locator('#fan-look-panel').isVisible())) await btn.click();
        await expect(page.locator('#fan-look-panel label:has([data-fan-portraits]) .fan-look-sub')).toBeVisible();
        expect(await overflow('#fan-look-panel')).toEqual([]);
    }
    // Settings › Fan at a phone's width: the same line under the default's switch.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.Strom.UI.showSettingsDialog('fan'));
    const group = page.locator('#settings-modal section[aria-labelledby="settings-group-fan"]');
    const row = group.locator('label', { has: page.locator('#fan-default-portraits') });
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator('.settings-desc')).toHaveText('Vorfahren und Nachkommen, wo Platz ist; Vergrößern zeigt weitere');
    expect(await overflow('#settings-modal section[aria-labelledby="settings-group-fan"]')).toEqual([]);
});
