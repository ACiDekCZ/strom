import { test, expect, Page } from '@playwright/test';
import { openApp, reloadApp, seedSetting, seedTree, SeedPerson } from './helpers.js';

/**
 * The fan's Appearance panel (spec 118 §1, §3, §10): the style, the family
 * lines' scope, the sectors' text and the portraits for the work until the
 * app is closed; "Save as default" keeps them on the device, "Back to
 * default" returns to it. On a phone the legend's sheet carries it as a tab.
 */

/** Fictional surnames: a new one for each woman's line (her father's line). */
const SURNAMES = ['Arvenko', 'Belmudr', 'Corvanek', 'Dresslin', 'Elvatch', 'Fornmeyr', 'Gallowik', 'Hestrand',
    'Ivoldt', 'Jarnwick', 'Kestrup', 'Lormacht', 'Mirvald', 'Norrgast', 'Ospreyk', 'Pellandt'];

/** Four rings of ancestors (Ahnentafel 1–31), sixteen family lines: more than the ten main ones. */
function ancestors(): Record<string, SeedPerson> {
    const surname = new Map<number, string>();
    let next = 0;
    const people: Record<string, SeedPerson> = {};
    for (let n = 1; n <= 31; n++) {
        surname.set(n, n === 1 || n % 2 === 1 ? SURNAMES[next++] : surname.get(n / 2)!);
        people[`a${n}`] = {
            firstName: n === 1 ? 'Centrus' : `Anc${n}`, lastName: surname.get(n)!,
            gender: n === 1 || n % 2 === 0 ? 'male' : 'female',
            ...(n < 16 ? { parents: [`a${2 * n}`, `a${2 * n + 1}`] } : {}),
            ...(n > 1 && n % 2 === 0 ? { partners: [`a${n + 1}`] } : {}),
        };
    }
    return people;
}

async function showFan(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
    await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
    await expect(page.locator('.fan-focus')).toContainText('Centrus');
}

async function openRodFan(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, ancestors(), 'Fan look', 'a1');
    await showFan(page);
    await page.evaluate(() => window.Strom.TreeRenderer.setFanColorMode('rod'));
    await expect(page.locator('#fan-legend-items .fan-legend-rods')).toBeAttached();
}

/** The sectors' fills, in the order drawn. */
function fills(page: Page): Promise<string[]> {
    return page.evaluate(() => [...document.querySelectorAll<SVGPathElement>('#fan-chart [data-fan-person] .fan-fill')]
        .map(p => getComputedStyle(p).fill));
}

function look(page: Page) {
    return page.evaluate(() => window.Strom.TreeRenderer.getFanLook());
}

/** No element of the panel (or the page) is wider than its box. */
function overflows(page: Page, root: string): Promise<string[]> {
    return page.evaluate((sel) => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth}`);
        for (const el of document.querySelectorAll<HTMLElement>(`${sel}, ${sel} *`)) {
            if (el.getClientRects().length === 0 || el instanceof SVGElement) continue;
            if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto') out.push(`${el.className || el.tagName}: ${el.scrollWidth} > ${el.clientWidth}`);
        }
        return out;
    }, root);
}

test('fan Appearance panel: the style and the main lines change the fan, the legend follows (spec 118 §1, §3)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRodFan(page);
    const btn = page.locator('#fan-look-btn');
    const panel = page.locator('#fan-look-panel');
    await expect(btn).toHaveAttribute('aria-label', 'Appearance');
    await expect(btn.locator('.fan-look-mark')).toBeHidden();
    await btn.click();
    await expect(panel).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.locator('[data-fan-style="color"]')).toBeFocused();
    await expect(panel.locator('[data-fan-look-settings]')).toHaveText('Settings');

    // Black and white: other fills.
    const before = await fills(page);
    await panel.locator('[data-fan-style="mono"]').click();
    await expect(panel.locator('[data-fan-style="mono"]')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await fills(page)).join()).not.toBe(before.join());
    // Differs from the default: the bullet, the button's name and the foot.
    await expect(btn.locator('.fan-look-mark')).toBeVisible();
    await expect(btn).toHaveAttribute('aria-label', 'Appearance, differs from the default');
    await expect(panel.locator('.fan-look-foot-state')).toHaveText('Differs from the default appearance.');
    await expect(panel.locator('[data-fan-look-save]')).toBeVisible();

    // Main lines: the six smaller lines grey under "Other lines (6)"; the legend's segment says the same.
    await panel.locator('[data-fan-scope="main"]').click();
    const other = page.locator('#fan-legend-items .fan-legend-other');
    await expect(other.locator('.fan-legend-label')).toHaveText('Other lines (6)');
    await expect(page.locator('#fan-legend-items .fan-legend-scope [data-fan-scope="main"]')).toHaveAttribute('aria-checked', 'true');
    // Esc closes the panel, the focus back on its button.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');

    // A grey line highlights as a coloured one: pressed, outlined.
    if (await other.getAttribute('aria-expanded') !== 'true') await other.click();
    const grey = page.locator('#fan-legend-items .fan-legend-sub[data-fan-rod]').first();
    await grey.click();
    await expect(grey).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.locator('#fan-chart .fan-hl-layer .fan-hl-edge').count()).toBeGreaterThan(0);
    // The highlight and the opened "Other" stay through a change of the look.
    await page.locator('#fan-legend-items .fan-legend-scope [data-fan-scope="all"]').click();
    await expect(page.locator('#fan-legend-items .fan-legend-scope [data-fan-scope="all"]')).toHaveAttribute('aria-checked', 'true');
    expect((await look(page)).rodScope).toBe('all');
    await page.locator('#fan-legend-items .fan-legend-scope [data-fan-scope="main"]').click();
    await expect(page.locator('#fan-legend-items .fan-legend-sub[data-fan-rod][aria-pressed="true"]')).toHaveCount(1);

    // A click outside closes the open panel.
    await btn.click();
    await expect(panel).toBeVisible();
    await page.locator('#fan-chart').click({ position: { x: 5, y: 5 } });
    await expect(panel).toBeHidden();
});

test('fan Appearance: the current look lives through a reload, "Save as default" keeps it, a new start begins with the default (spec 118 §10)', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRodFan(page);
    const btn = page.locator('#fan-look-btn');
    const panel = page.locator('#fan-look-panel');
    await btn.click();
    await panel.locator('[data-fan-style="antique"]').click();
    await panel.locator('[data-fan-content="names"]').click();
    expect(await look(page)).toEqual({ style: 'antique', rodScope: 'all', content: 'names', portraits: false });
    expect(await page.evaluate(() => localStorage.getItem('strom-fan-style'))).toBeNull();

    // A reload of the tab keeps the current look (sessionStorage).
    await reloadApp(page);
    await showFan(page);
    expect(await look(page)).toEqual({ style: 'antique', rodScope: 'all', content: 'names', portraits: false });
    await expect(btn.locator('.fan-look-mark')).toBeVisible();

    // "Save as default": kept on the device, the bullet gone, a short confirmation.
    await btn.click();
    await panel.locator('[data-fan-look-save]').click();
    await expect(page.locator('.toast')).toHaveText('Saved as the default fan appearance.');
    expect(await page.evaluate(() => [localStorage.getItem('strom-fan-style'), localStorage.getItem('strom-fan-content')])).toEqual(['antique', 'names']);
    await expect(btn.locator('.fan-look-mark')).toBeHidden();
    await expect(panel.locator('[data-fan-look-save]')).toHaveCount(0);
    await expect(panel.locator('[data-fan-look-settings]')).toBeVisible();

    // "Back to default" returns the fan to the saved default.
    await panel.locator('[data-fan-style="pastel"]').click();
    const pastel = await fills(page);
    await panel.locator('[data-fan-look-reset]').click();
    expect(await look(page)).toEqual({ style: 'antique', rodScope: 'all', content: 'names', portraits: false });
    await expect.poll(async () => (await fills(page)).join()).not.toBe(pastel.join());
    await expect(btn.locator('.fan-look-mark')).toBeHidden();

    // A change not saved ends with the app: a new start shows the default.
    await panel.locator('[data-fan-style="mono"]').click();
    expect((await look(page)).style).toBe('mono');
    await page.close();
    const next = await context.newPage();
    await next.setViewportSize({ width: 1440, height: 900 });
    await next.goto('/strom.html');
    await expect(next.locator('html')).not.toHaveClass(/app-loading/);
    expect(await look(next)).toEqual({ style: 'antique', rodScope: 'all', content: 'names', portraits: false });
});

test('fan Appearance on a phone: the sheet\'s second tab carries the panel (spec 118 §1)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRodFan(page);
    await expect(page.locator('#fan-look')).toBeHidden();
    await page.locator('#fan-legend-chip').click();
    const colorsTab = page.locator('#fan-sheet-tab-colors');
    const lookTab = page.locator('#fan-sheet-tab-look');
    await expect(colorsTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#fan-sheet-colors')).toBeVisible();
    // ← / → between the tabs.
    await colorsTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(lookTab).toBeFocused();
    await expect(lookTab).toHaveAttribute('aria-selected', 'true');
    const sheetLook = page.locator('#fan-sheet-look');
    await expect(sheetLook).toBeVisible();
    await expect(page.locator('#fan-sheet-colors')).toBeHidden();
    await expect(page.locator('.fan-sheet-panel')).toHaveAttribute('aria-labelledby', 'fan-sheet-tab-look');

    await sheetLook.locator('[data-fan-style="pastel"]').click();
    await expect(sheetLook.locator('[data-fan-style="pastel"]')).toHaveAttribute('aria-checked', 'true');
    await expect(lookTab.locator('.fan-look-mark')).toBeVisible();
    await expect(lookTab).toHaveAttribute('aria-label', 'Appearance, differs from the default');
    expect((await look(page)).style).toBe('pastel');
    await sheetLook.locator('label:has([data-fan-portraits])').click();
    expect((await look(page)).portraits).toBe(true);
    // Nobody here has a photo.
    await expect(sheetLook.locator('[data-fan-look-state]')).toHaveText('Nobody in the fan has a portrait yet.');
    expect(await overflows(page, '#fan-sheet-look')).toEqual([]);

    // The sheet opens again on the last tab.
    await page.keyboard.press('Escape');
    await expect(page.locator('#fan-sheet')).toBeHidden();
    await page.locator('#fan-legend-chip').click();
    await expect(lookTab).toHaveAttribute('aria-selected', 'true');
    await expect(sheetLook).toBeVisible();
});

test('fan Appearance at 1024 and in German: the icon button, nothing overflows (spec 118 §1)', async ({ page }) => {
    await seedSetting(page, 'language', 'de');
    await page.setViewportSize({ width: 1024, height: 768 });
    await openRodFan(page);
    const btn = page.locator('#fan-look-btn');
    await expect(btn).toBeVisible();
    const box = (await btn.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([34, 34]);
    await expect(btn.locator('.fan-look-label')).toBeHidden();
    await btn.click();
    const panel = page.locator('#fan-look-panel');
    await expect(panel).toBeVisible();
    const p = (await panel.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width).toBeLessThanOrEqual(1024);
    expect(await overflows(page, '#fan-look-panel')).toEqual([]);
    expect(await overflows(page, '#fan-legend-items .fan-legend-scope')).toEqual([]);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(btn.locator('.fan-look-label')).toHaveText('Darstellung');
    await expect(panel).toBeVisible();
    expect(await overflows(page, '#fan-look-panel')).toEqual([]);
    expect(await overflows(page, '#fan-toolbar')).toEqual([]);
});
