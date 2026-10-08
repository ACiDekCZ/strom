import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Marriage order (T13): a man with three wives — data order 1908, undated,
 * 1866 — in the expanded view. Each wife's card carries a pill on its top
 * edge at the corner pointing to him ("1st ∞ 1866", "2nd ∞ 1908", "3rd ∞"),
 * he has none, a couple of one marriage has none; the wives on one side
 * stand in the order of the marriages. Zoomed out the pill shortens, then
 * hides; the image export draws it whole; a mouse shows its bubble.
 * Invented data.
 */

async function setup(page: Page, width = 1440, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await page.evaluate(async () => {
        const p = (id: string, extra: Record<string, unknown>) => ({
            id, gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
        });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                j: p('j', { firstName: 'Josef', lastName: 'Víšek', gender: 'male', birthDate: '1841',
                    partnerships: ['u2', 'u3', 'u1'], childIds: ['k', 'h', 'r'] }),
                a: p('a', { firstName: 'Anna', lastName: 'Králová', birthDate: '1845', partnerships: ['u1'], childIds: ['k'] }),
                m: p('m', { firstName: 'Marie', lastName: 'Nováková', birthDate: '1870', partnerships: ['u2'], childIds: ['h'] }),
                e: p('e', { firstName: 'Eva', lastName: 'Malá', birthDate: '1850', partnerships: ['u3'], childIds: ['r'] }),
                k: p('k', { firstName: 'Karel', lastName: 'Víšek', gender: 'male', birthDate: '1867',
                    partnerships: ['u4'], parentIds: ['j', 'a'] }),
                l: p('l', { firstName: 'Ludmila', lastName: 'Víšková', birthDate: '1870', partnerships: ['u4'] }),
                h: p('h', { firstName: 'Hana', lastName: 'Víšková', birthDate: '1909', parentIds: ['j', 'm'] }),
                r: p('r', { firstName: 'Rudolf', lastName: 'Víšek', gender: 'male', birthDate: '1885', parentIds: ['j', 'e'] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'j', person2Id: 'a', status: 'married', childIds: ['k'], startDate: '1866-02-14', startPlace: 'Dolní Lhota' },
                u2: { id: 'u2', person1Id: 'j', person2Id: 'm', status: 'married', childIds: ['h'], startDate: '1908', startPlace: 'Praha' },
                u3: { id: 'u3', person1Id: 'j', person2Id: 'e', status: 'married', childIds: ['r'] },
                u4: { id: 'u4', person1Id: 'k', person2Id: 'l', status: 'married', childIds: [], startDate: '1890' },
            },
        } as never, 'Víškovi');
        window.Strom.TreeRenderer.setFocus('j' as never);
    });
    await expect(card(page, 'Marie')).toBeVisible();
    await expect(card(page, 'Eva')).toBeVisible();
}

const pill = (page: Page, name: string) => card(page, name).locator('.union-order-pill');

/** The pill's visible text: its number, glyph and year (the bubble left out). */
async function pillText(page: Page, name: string): Promise<string> {
    return pill(page, name).evaluate(el => [...el.querySelectorAll('.uo-num, .uo-glyph, .uo-year')]
        .filter(s => getComputedStyle(s).display !== 'none').map(s => s.textContent).join(' '));
}

async function zoomTo(page: Page, scale: number): Promise<void> {
    await page.evaluate(s => window.Strom.ZoomPan.glideToPerson('j' as never, s, 0), scale);
    await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(scale, 2);
}

test.describe('marriage-order pill (T13)', () => {
    test('each wife has her number and year at the corner pointing to her husband; he and a single marriage have none', { tag: '@smoke' }, async ({ page }) => {
        await setup(page);
        await zoomTo(page, 1);
        expect(await pillText(page, 'Anna')).toBe('1st ∞ 1866');
        expect(await pillText(page, 'Marie')).toBe('2nd ∞ 1908');
        // Undated: the number only, after the dated marriages.
        expect(await pillText(page, 'Eva')).toBe('3rd ∞');
        await expect(card(page, 'Josef').locator('.union-order-pill')).toHaveCount(0);
        await expect(card(page, 'Karel').locator('.union-order-pill')).toHaveCount(0);
        await expect(card(page, 'Ludmila').locator('.union-order-pill')).toHaveCount(0);
        await expect(page.locator('.union-order-pill')).toHaveCount(3);

        // The wives on his left in the order of the marriages, the earliest
        // next to him; the newest (primary) marriage on his right.
        const x = async (name: string) => (await card(page, name).boundingBox())!.x;
        const [ex, ax, jx, mx] = [await x('Eva'), await x('Anna'), await x('Josef'), await x('Marie')];
        expect(ex).toBeLessThan(ax);
        expect(ax).toBeLessThan(jx);
        expect(jx).toBeLessThan(mx);

        // On the top edge, half over the border, 12px from the corner toward Josef.
        for (const [name, side] of [['Anna', 'right'], ['Eva', 'right'], ['Marie', 'left']] as const) {
            const c = (await card(page, name).boundingBox())!;
            const b = (await pill(page, name).boundingBox())!;
            expect(Math.abs(b.y + b.height / 2 - c.y)).toBeLessThanOrEqual(1.5);
            expect(b.height).toBeCloseTo(18, 0);
            if (side === 'right') expect(Math.abs(c.x + c.width - (b.x + b.width) - 12)).toBeLessThanOrEqual(1.5);
            else expect(Math.abs(b.x - c.x - 12)).toBeLessThanOrEqual(1.5);
        }
    });

    test('a mouse shows the bubble with the number, year and place; the card\'s hover card stays away', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 1);
        const tip = pill(page, 'Anna').locator('.uo-tip');
        await expect(tip).toBeHidden();
        await pill(page, 'Anna').hover();
        await expect(tip).toBeVisible();
        await expect(tip).toHaveText('1st marriage 1866, Dolní Lhota');
        await expect(card(page, 'Anna').locator('.card-tooltip')).not.toBeVisible();
        await expect(pill(page, 'Marie')).toHaveAttribute('aria-label', '2nd marriage 1908, Praha');
        await expect(pill(page, 'Anna')).toHaveCSS('cursor', 'default');
    });

    test('zoomed out it shows only the number in an 18px circle, below 40 % it hides', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 0.6);
        expect(await pillText(page, 'Anna')).toBe('1st ∞ 1866');
        await zoomTo(page, 0.5);
        expect(await pillText(page, 'Anna')).toBe('1st');
        expect(await pillText(page, 'Marie')).toBe('2nd');
        const w = await pill(page, 'Eva').evaluate(el => el.offsetWidth);
        expect(w).toBeLessThanOrEqual(24);
        expect(await pill(page, 'Eva').evaluate(el => el.offsetHeight)).toBe(18);
        await zoomTo(page, 0.39);
        await expect(pill(page, 'Anna')).toBeHidden();
        await expect(pill(page, 'Marie')).toBeHidden();
        await zoomTo(page, 1);
        await expect(pill(page, 'Anna')).toBeVisible();
    });

    test('the SVG export draws the pills whole', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 0.3);   // the screen's zoom does not shorten the export
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.locator('#export-modal .menu-option', { hasText: 'Poster' }).click();
        const poster = page.locator('#poster-modal');
        await expect(poster).toBeVisible();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            poster.locator('.menu-option', { hasText: 'SVG' }).click(),
        ]);
        const svg = readFileSync(await download.path(), 'utf-8');
        const pills = [...svg.matchAll(/<g class="union-order-pill" data-union-order="(\d+)" data-person="([^"]+)"[^>]*>(.*?)<\/g>/g)];
        expect(pills.map(m => `${m[2]}:${m[1]}`).sort()).toEqual(['a:1', 'e:3', 'm:2']);
        const anna = pills.find(m => m[2] === 'a')![3];
        expect(anna).toContain('>1st</text>');
        expect(anna).toContain('>∞</text>');
        expect(anna).toContain('>1866</text>');
        expect(svg).not.toMatch(/drop-shadow|<filter/);
    });

    test('the descendants view shows the pills too', async ({ page }) => {
        await setup(page);
        await page.locator('#view-mode-descendants').click();
        await expect(page.locator('#descendants-badge')).toBeVisible();
        await expect(card(page, 'Anna').locator('.union-order-pill')).toHaveCount(1);
        await expect(page.locator('.union-order-pill')).toHaveCount(3);
    });

    test('on a phone (360px) nothing overflows the page; dark theme draws the pill on the dark surface', async ({ page }) => {
        await setup(page, 360, 740);
        await expect(page.locator('.union-order-pill')).toHaveCount(3);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
        await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        const colours = await pill(page, 'Anna').evaluate(el => {
            const cs = getComputedStyle(el);
            const probe = document.createElement('div');
            probe.style.background = 'var(--surface)';
            probe.style.color = 'var(--accent)';
            document.body.appendChild(probe);
            const want = getComputedStyle(probe);
            const out = {
                bg: cs.backgroundColor, surface: want.backgroundColor,
                glyph: getComputedStyle(el.querySelector('.uo-glyph')!).color, accent: want.color,
            };
            probe.remove();
            return out;
        });
        expect(colours.bg).toBe(colours.surface);
        expect(colours.glyph).toBe(colours.accent);
        expect(colours.bg).not.toBe('rgb(255, 253, 248)');
        await page.evaluate(() => window.Strom.SettingsManager.setTheme('system'));
    });
});
