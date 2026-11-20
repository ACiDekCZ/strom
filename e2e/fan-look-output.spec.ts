import { readFileSync } from 'node:fs';
import { test, expect, Page } from '@playwright/test';
import { openApp, seedSetting, seedTree, SeedPerson } from './helpers.js';

/**
 * The fan's default look in Settings and the poster's own look (spec 118 §10):
 * Settings › Fan keeps the default on the device (the fan follows while it
 * showed the default); the poster dialog is prefilled from the screen and
 * changes the look for its output only.
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

async function openFan(page: Page, colorMode: 'rod' | 'gender' = 'rod'): Promise<void> {
    await openApp(page);
    await seedTree(page, ancestors(), 'Fan output', 'a1');
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
    await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
    await expect(page.locator('.fan-focus')).toContainText('Centrus');
    await page.evaluate((mode) => window.Strom.TreeRenderer.setFanColorMode(mode), colorMode);
}

function look(page: Page) {
    return page.evaluate(() => window.Strom.TreeRenderer.getFanLook());
}

/** What the device and the session keep of the look. */
function kept(page: Page) {
    return page.evaluate(() => ({
        style: localStorage.getItem('strom-fan-style'),
        scope: localStorage.getItem('strom-fan-rod-scope'),
        content: localStorage.getItem('strom-fan-content'),
        portraits: localStorage.getItem('strom-fan-portraits'),
        session: sessionStorage.getItem('strom-fan-look-session'),
    }));
}

/** The preview's SVG (the image's own URL), once it is drawn. */
async function previewSvg(page: Page): Promise<string> {
    await expect(page.locator('#poster-look-img')).toHaveAttribute('src', /^blob:/);
    return page.evaluate(async () => {
        const img = document.getElementById('poster-look-img') as HTMLImageElement;
        return (await fetch(img.src)).text();
    });
}

async function downloadSvg(page: Page): Promise<string> {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#poster-modal .menu-option', { hasText: 'SVG' }).click(),
    ]);
    return readFileSync(await download.path(), 'utf-8');
}

/** No element inside `root` is wider than its box, and the page does not scroll sideways. */
function overflows(page: Page, root: string): Promise<string[]> {
    return page.evaluate((sel) => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth}`);
        for (const el of document.querySelectorAll<HTMLElement>(`${sel}, ${sel} *`)) {
            if (el.getClientRects().length === 0 || el instanceof SVGElement || el instanceof HTMLSelectElement) continue;
            if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto') out.push(`${el.id || el.className || el.tagName}: ${el.scrollWidth} > ${el.clientWidth}`);
        }
        return out;
    }, root);
}

test('Settings › Fan: the default kept on the device, the fan follows while it showed the default (spec 118 §10)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFan(page);
    // The Appearance panel's link opens Settings at the group.
    await page.locator('#fan-look-btn').click();
    await page.locator('#fan-look-panel [data-fan-look-settings]').click();
    const settings = page.locator('#settings-modal');
    await expect(settings).toBeVisible();
    const group = settings.locator('section[aria-labelledby="settings-group-fan"]');
    await expect(group.locator('.settings-group-title')).toHaveText('Fan');
    await expect(group.locator('#fan-set-style legend .settings-name')).toBeInViewport();
    await expect(group.locator('input[name="fan-default-style"][value="color"]')).toBeChecked();
    await expect(group.locator('input[name="fan-default-scope"][value="all"]')).toBeChecked();
    await expect(group.locator('input[name="fan-default-content"][value="years"]')).toBeChecked();
    await expect(group.locator('#fan-default-portraits')).not.toBeChecked();
    // Each style's row carries its small fan.
    await expect(group.locator('.fan-set-prev svg.fan-look-prev')).toHaveCount(4);

    // The fan showed the default: it follows at once.
    await group.locator('label.fan-set-opt', { hasText: 'Pastel' }).click();
    await group.locator('label.settings-radio', { hasText: 'Main lines' }).click();
    expect(await kept(page)).toEqual({ style: 'pastel', scope: 'main', content: 'years', portraits: '0', session: null });
    expect(await look(page)).toEqual({ style: 'pastel', rodScope: 'main', content: 'years', portraits: false });
    await expect(page.locator('#fan-chart .fan-svg')).toHaveAttribute('data-fan-style', 'pastel');
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    // Changed in the panel: a later default leaves the screen's look as it is.
    await page.locator('#fan-look-btn').click();
    await page.locator('#fan-look-panel [data-fan-style="mono"]').click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await group.locator('label.settings-radio', { hasText: 'Names only' }).click();
    await group.locator('label', { has: page.locator('#fan-default-portraits') }).click();
    expect(await kept(page)).toMatchObject({ style: 'pastel', scope: 'main', content: 'names', portraits: '1' });
    expect(await look(page)).toEqual({ style: 'mono', rodScope: 'main', content: 'years', portraits: false });
    await expect(page.locator('#fan-chart .fan-svg')).toHaveAttribute('data-fan-style', 'mono');
});

test('the poster\'s own look: antique for the output only, the screen and the device unchanged, "As on screen" (spec 118 §10)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFan(page);
    const before = await kept(page);
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const modal = page.locator('#poster-modal');
    const box = modal.locator('#poster-look');
    await expect(box).toBeVisible();
    await expect(box.locator('.poster-look-h')).toHaveText('Poster appearance');
    await expect(box.locator('#poster-look-sum')).toBeHidden();
    await expect(box.locator('#poster-look-style')).toHaveValue('color');
    await expect(box.locator('#poster-look-scope')).toBeEnabled();
    await expect(box.locator('#poster-look-reset')).toBeHidden();
    expect(await previewSvg(page)).toContain('data-fan-style="color"');
    // The line of what prints: no bar at its left edge.
    expect(await modal.locator('.poster-view-line').evaluate(el => getComputedStyle(el).borderLeftWidth)).toBe('0px');

    await box.locator('#poster-look-style').selectOption('antique');
    await expect(box.locator('#poster-look-reset')).toBeVisible();
    await expect(box.locator('#poster-look-reset')).toHaveText('As on screen');
    await expect.poll(() => previewSvg(page)).toContain('data-fan-style="antique"');
    const preview = await previewSvg(page);
    expect(preview).toMatch(/<g class="fan-poster-legend" font-family="'Strom Serif'/);
    expect(await look(page)).toEqual({ style: 'color', rodScope: 'all', content: 'years', portraits: false });
    await expect(page.locator('#fan-chart .fan-svg')).toHaveAttribute('data-fan-style', 'color');

    // "As on screen" returns the choices; a change again, then the file.
    await box.locator('#poster-look-reset').click();
    await expect(box.locator('#poster-look-style')).toHaveValue('color');
    await expect(box.locator('#poster-look-reset')).toBeHidden();
    await expect.poll(() => previewSvg(page)).toContain('data-fan-style="color"');
    await box.locator('#poster-look-style').selectOption('antique');
    const svg = await downloadSvg(page);
    expect(svg).toContain('data-fan-style="antique"');
    expect(svg).toMatch(/<g class="fan-poster-legend" font-family="'Strom Serif'/);
    expect(await look(page)).toEqual({ style: 'color', rodScope: 'all', content: 'years', portraits: false });
    expect(await kept(page)).toEqual(before);

    // A new opening starts from the screen again.
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    await expect(box.locator('#poster-look-style')).toHaveValue('color');
});

test('the poster in the main lines: one "Other lines (N)" row and the subtitle says so (spec 118 §3, §10)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFan(page);
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const box = page.locator('#poster-look');
    await box.locator('#poster-look-scope').selectOption('main');
    const svg = await downloadSvg(page);
    expect(svg.match(/Other lines \(\d+\)/g)?.length).toBe(1);
    expect(svg).toContain('colours of the main lines');
    expect((await look(page)).rodScope).toBe('all');
});

test('the poster outside the family-line colours: the scope is inactive (spec 118 §10)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFan(page, 'gender');
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const scope = page.locator('#poster-look-scope');
    await expect(scope).toBeDisabled();
    await expect(scope).toHaveAttribute('title', 'Only for colours by family line.');
});

test('the poster\'s look on a phone: one folded row, a tap unfolds the preview and the choices (spec 118 §10)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFan(page);
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const box = page.locator('#poster-look');
    const sum = box.locator('#poster-look-sum');
    await expect(sum).toBeVisible();
    await expect(sum).toHaveAttribute('aria-expanded', 'false');
    await expect(box.locator('#poster-look-body')).toBeHidden();
    await expect(box.locator('#poster-look-sum-desc')).toHaveText('Colour · All lines · Name and years');
    await sum.click();
    await expect(sum).toHaveAttribute('aria-expanded', 'true');
    await expect(box.locator('#poster-look-body')).toBeVisible();
    await expect(box.locator('#poster-look-img')).toBeVisible();
    await box.locator('#poster-look-style').selectOption('mono');
    await expect(box.locator('#poster-look-sum-desc')).toHaveText('Black and white · All lines · Name and years · changed for this output only');
    expect(await overflows(page, '#poster-modal .modal')).toEqual([]);
});

for (const width of [1440, 1024, 390]) {
    test(`German at ${width}: the poster's look and Settings › Fan fit (spec 118 §10)`, async ({ page }) => {
        await seedSetting(page, 'language', 'de');
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await openFan(page);
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const box = page.locator('#poster-look');
        if (width === 390) await box.locator('#poster-look-sum').click();
        await expect(box.locator('#poster-look-body')).toBeVisible();
        expect(await overflows(page, '#poster-modal .modal')).toEqual([]);
        await page.evaluate(() => window.Strom.UI.closePosterDialog());

        await page.evaluate(() => window.Strom.UI.showSettingsDialog('fan'));
        const group = page.locator('#settings-modal section[aria-labelledby="settings-group-fan"]');
        await expect(group.locator('.settings-group-title')).toHaveText('Fächer');
        expect(await overflows(page, '#settings-modal section[aria-labelledby="settings-group-fan"]')).toEqual([]);
    });
}
