import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Linked in the view only on every touch screen — a phone, a phone held
 * sideways and a tablet: the line's label, the pinned bubble, the
 * confirmation before unlinking what others hang on, the family's own button
 * and its menu, the hypotheses' switches and the list worked by taps; 44px
 * targets, everything inside the window, German texts fitting. And the dark
 * theme of what only the feature draws (the indicator, the list, the bubble's
 * button, the family's button, the confirmation). The desktop behaviour is in
 * the other view-links specs. Invented data only
 * (e2e/fixtures/research-hypothesis-links.ged).
 */

const GED = readFileSync('e2e/fixtures/research-hypothesis-links.ged', 'utf-8');

/** Václav's edge an ordinary one joining the family of Jakub by variant B: the "+ family · 5" pill. */
const GED_PILL = GED.replace(/2 _END named\n/, '2 _END unsearched\n')
    .replace(/3 _JOIN P0126\n3 _JOIN P0125\n3 _JOIN P0127\n3 _JOIN P0128\n3 _JOIN P0129\n3 _JOIN P0130\n3 _VAR B\n3 _VAR C\n/, '3 _JOIN P0125\n3 _VAR B\n');

type Rec = { hypo: string; variant: string; kind: string; anchor: string; island: string[]; on?: boolean };
const B: Rec = { hypo: 'H0022', variant: 'B', kind: 'child', anchor: 'P0010', island: ['P0125', 'P0126'] };
const MARTIN: Rec = { hypo: 'H0024', variant: 'A', kind: 'partners', anchor: 'P0011', island: ['P0140'] };
/** Hangs on B: Tomáš (one of B's family) with a parent of his own. */
const CHAINED: Rec = { hypo: 'H0030', variant: 'A', kind: 'child', anchor: 'P0128', island: ['P0150'] };

async function setup(page: Page, ged = GED): Promise<void> {
    await openApp(page);
    await page.evaluate((t) => window.Strom.UI.openGedcomText(t), ged);
    await expect(card(page, 'Karel').first()).toBeVisible();
}

/** Store records and focus a person (by research number), which draws them. */
async function store(page: Page, records: Rec[], focus = 'P0001'): Promise<void> {
    await page.evaluate(({ records, focus }) => {
        const S = window.Strom;
        const treeId = S.DataManager.getCurrentTreeId()!;
        const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)!.id;
        localStorage.setItem(`strom-view-links:${treeId}`, JSON.stringify(records.map((r, i) => ({
            hypo: r.hypo, variant: r.variant, kind: r.kind, anchorId: byRefn(r.anchor),
            islandIds: r.island.map(byRefn), on: r.on ?? true, addedAt: i + 1,
        }))));
        S.TreeRenderer.setFocus(byRefn(focus));
    }, { records, focus });
}

const ghosts = (page: Page) => page.locator('.person-card.view-ghost');
const bubble = (page: Page) => page.locator('#research-edge-bubble');
const panel = (page: Page) => page.locator('#view-links-panel');
const row = (page: Page, hypo: string) => panel(page).locator(`.view-links-row[data-hypo="${hypo}"]`);

type Box = { x: number; y: number; width: number; height: number };
const inside = (b: Box, w: number, h: number) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5;
function overlaps(a: Box, b: Box): boolean {
    return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}

/** What a tap at a point hits: the closest element matching `sel`, as its class. */
const hitAt = (page: Page, x: number, y: number, sel: string) => page.evaluate(({ x, y, sel }) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(sel)?.className ?? '', { x, y, sel });

/** Every leaf text of `scope` fits its box and the window (German is the longest). */
async function textsFit(scope: Locator): Promise<string[]> {
    return scope.evaluate(root => {
        const bad: string[] = [];
        for (const node of root.querySelectorAll<HTMLElement>('button, span, div, p')) {
            if (node.getClientRects().length === 0 || node.children.length > 0 || !node.textContent?.trim()) continue;
            if (getComputedStyle(node).webkitLineClamp !== 'none') continue;  // clamped on purpose (the whole text in its tooltip)
            if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflow !== 'visible') bad.push(node.textContent);
            const r = node.getBoundingClientRect();
            if (r.right > window.innerWidth + 0.5 || r.left < -0.5) bad.push(`off screen: ${node.textContent}`);
        }
        return bad;
    });
}

for (const [name, viewport] of [
    ['a phone', { width: 360, height: 740 }],
    ['a phone held sideways', { width: 740, height: 360 }],
    ['a tablet', { width: 820, height: 1180 }],
] as const) {
    test.describe(`linked in the view only on ${name} (touch)`, () => {
        test.use({ viewport, hasTouch: true, isMobile: true });

        test('the line\'s label: 28px high, a tap 21px off its middle still hits it, the tap opens the hypothesis', async ({ page }) => {
            await setup(page);
            await store(page, [B]);
            const label = page.locator('.view-link-label');
            await expect(label).toBeVisible();
            // At 100 % (the target scales with the tree), the label in the middle of the window.
            await page.evaluate(() => window.Strom.ZoomPan.reset());
            await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(1);
            await label.evaluate((el) => window.Strom.ZoomPan.centerOnWorldPoint(parseFloat(el.style.left), parseFloat(el.style.top)));
            await expect(label).toHaveCSS('height', '28px');
            const b = (await label.boundingBox())!;
            expect(inside(b, viewport.width, viewport.height)).toBe(true);
            for (const dy of [-21, 21]) expect(await hitAt(page, b.x + b.width / 2, b.y + b.height / 2 + dy, '.view-link-label, .person-card')).toBe('view-link-label');
            await label.tap();
            const dialog = page.locator('#person-research-modal .person-research-modal');
            await expect(dialog).toHaveAttribute('data-open-hypo', 'H0022');
            await expect(dialog).toHaveAttribute('data-open-variant', 'B');
        });

        test('the bubble: pinned at the first tap, inside the window, its buttons, "More" and × 44px targets; German fits', async ({ page }) => {
            await setup(page);
            await page.evaluate(() => window.Strom.UI.setLanguage('de'));
            await store(page, [], 'P0010');
            await card(page, 'Václav').locator('.research-edge').tap();
            const b = bubble(page);
            await expect(b).toHaveClass(/is-pinned/);
            expect(inside((await b.boundingBox())!, viewport.width, viewport.height)).toBe(true);
            await expect(b.locator('.reb-show')).toHaveText(['Als verbunden zeigen', 'Als verbunden zeigen']);
            for (const target of [b.locator('.reb-show').first(), b.locator('.reb-show').last(), b.locator('.reb-close')]) {
                const r = (await target.boundingBox())!;
                expect(r.height).toBeGreaterThanOrEqual(44);
                expect(r.width).toBeGreaterThanOrEqual(44);
            }
            await b.locator('.reb-more').scrollIntoViewIfNeeded();
            expect((await b.locator('.reb-more').boundingBox())!.height).toBeGreaterThanOrEqual(44);
            expect(await textsFit(b)).toEqual([]);
            await b.locator('.reb-variant[data-variant="B"] .reb-show').tap();
            await expect(ghosts(page)).toHaveCount(5);
        });

        test('unlinking what another hangs on: the confirmation stands inside the window, clear of the bottom bar, its buttons 44px; German fits', async ({ page }) => {
            await setup(page);
            await page.evaluate(() => window.Strom.UI.setLanguage('de'));
            await store(page, [B, CHAINED]);
            await expect(ghosts(page)).toHaveCount(6);
            void page.evaluate(() => window.Strom.UI.viewLinkUnlink('H0022'));
            const pop = page.getByRole('alertdialog');
            await expect(pop).toBeVisible();
            await expect(pop.getByRole('button', { name: 'Trennen' })).toBeFocused();
            const box = (await pop.boundingBox())!;
            expect(inside(box, viewport.width, viewport.height)).toBe(true);
            const bar = page.locator('.bottom-bar');
            if (await bar.isVisible()) expect(overlaps(box, (await bar.boundingBox())!)).toBe(false);
            for (const btn of await pop.getByRole('button').all()) {
                const r = (await btn.boundingBox())!;
                expect(r.height).toBeGreaterThanOrEqual(44);
                expect(r.width).toBeGreaterThanOrEqual(44);
            }
            expect(await textsFit(pop)).toEqual([]);
            await pop.getByRole('button', { name: 'Trennen' }).tap();
            await expect(ghosts(page)).toHaveCount(0);
        });

        test('"+ family · 5": a 44px target, its menu of two inside the window with 44px rows; German fits', async ({ page }) => {
            expect(GED_PILL).not.toContain('_END named');
            await setup(page, GED_PILL);
            await page.evaluate(() => window.Strom.UI.setLanguage('de'));
            await store(page, [], 'P0010');
            const pill = page.locator('.edge-link-pill--family');
            await expect(pill).toHaveCount(1);
            expect(await pill.evaluate((el) => parseFloat(getComputedStyle(el, '::before').height))).toBe(44);
            await pill.tap();
            const menu = page.getByRole('menu');
            await expect(menu).toBeVisible();
            expect(inside((await menu.boundingBox())!, viewport.width, viewport.height)).toBe(true);
            const items = menu.getByRole('menuitem');
            await expect(items).toHaveCount(2);
            for (const item of await items.all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await expect(items.first().locator('.view-link-menu__label')).toHaveText('Als verbunden zeigen');
            expect(await textsFit(menu)).toEqual([]);
            await items.first().tap();
            await expect(ghosts(page)).toHaveCount(5);
        });

        test('a ghost\'s sheet in German: its state, "Unlink" and what research knows fit, 44px rows', async ({ page }) => {
            await setup(page);
            await page.evaluate(() => window.Strom.UI.setLanguage('de'));
            await store(page, [B]);
            await expect(card(page, 'Jakub')).toHaveClass(/view-ghost/);
            await page.evaluate(() => {
                const S = window.Strom;
                S.ZoomPan.centerOnPerson(S.DataManager.getAllPersons().find(p => p.refn === 'P0125')!.id);
            });
            await card(page, 'Jakub').tap();
            const sheet = page.locator('.bottom-sheet-overlay.active .bottom-sheet-person');
            await expect(sheet).toBeVisible();
            const head = sheet.locator('.sheet-view-link-head');
            await expect(head.locator('.bottom-sheet-caption')).toHaveText('Nur in der Ansicht verbunden · H0022 B');
            await expect(head.locator('.bottom-sheet-item')).toHaveText(['Trennen', 'Was die Forschung zur Verbindung weiß']);
            for (const h of await head.locator('.bottom-sheet-item').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) {
                expect(h).toBeGreaterThanOrEqual(44);
            }
            expect(await textsFit(head)).toEqual([]);
        });

        test('the family\'s own button and its menu of versions: 44px targets inside the window', async ({ page }) => {
            await setup(page);
            await store(page, [], 'P0125');
            const btn = page.locator('.view-link-island-btn');
            await expect(btn).toHaveCount(1);
            expect(await btn.evaluate((el) => parseFloat(getComputedStyle(el, '::before').height))).toBe(44);
            await btn.scrollIntoViewIfNeeded();
            await btn.tap();
            const menu = page.getByRole('menu', { name: 'Versions to show' });
            await expect(menu).toBeVisible();
            expect(inside((await menu.boundingBox())!, viewport.width, viewport.height)).toBe(true);
            const items = menu.getByRole('menuitem');
            await expect(items).toHaveCount(2);
            for (const item of await items.all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await items.first().tap();
            await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0022"]')).toHaveCount(5);
        });

        test('the hypotheses\' switches: 44px targets, a tap shows the version and tints it', async ({ page }) => {
            await setup(page);
            await page.evaluate(() => {
                const S = window.Strom;
                S.UI.showPersonResearchDialog(S.DataManager.getAllPersons().find(p => p.refn === 'P0010')!.id as never);
            });
            const dialog = page.locator('#person-research-modal');
            const version = dialog.locator('.person-research-hypo[data-hypo="H0022"] .person-research-variant[data-variant="B"]');
            const sw = version.locator('.view-link-switch');
            await sw.scrollIntoViewIfNeeded();
            const r = (await sw.boundingBox())!;
            expect(r.height).toBeGreaterThanOrEqual(44);
            expect(r.x + r.width).toBeLessThanOrEqual(viewport.width);
            await sw.tap();
            await expect(sw).toHaveAttribute('aria-checked', 'true');
            await expect(version).toHaveClass(/is-shown/);
            await expect(ghosts(page)).toHaveCount(5);
        });

        test('the list by taps: a row\'s switch, the main switch, × with Undo in the panel above its footer', async ({ page }) => {
            await setup(page);
            await store(page, [B, MARTIN]);
            await expect(ghosts(page)).toHaveCount(6);
            await page.locator('#view-links-pill .view-links-pill__open').tap();
            await expect(panel(page)).toBeVisible();
            await row(page, 'H0022').getByRole('switch').tap();
            await expect(row(page, 'H0022').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
            await expect(row(page, 'H0022')).toBeVisible();
            await expect(ghosts(page)).toHaveCount(1);
            await row(page, 'H0022').getByRole('switch').tap();
            await expect(ghosts(page)).toHaveCount(6);
            const main = panel(page).locator('.view-links-panel__master-switch');
            await main.tap();
            await expect(main).toHaveAttribute('aria-checked', 'false');
            await expect(ghosts(page)).toHaveCount(0);
            await expect(page.locator('#view-links-pill')).toHaveCount(0);
            await main.tap();
            await expect(ghosts(page)).toHaveCount(6);
            await row(page, 'H0024').getByRole('button', { name: 'Remove: Partner of Rozálie Dvořáčková' }).tap();
            await expect(row(page, 'H0024')).toHaveCount(0);
            const toast = panel(page).locator('.view-links-panel__toast');
            await expect(toast).toContainText('Removed: partner of Rozálie Dvořáčková');
            const t = (await toast.boundingBox())!;
            expect(inside(t, viewport.width, viewport.height)).toBe(true);
            expect(overlaps(t, (await panel(page).locator('.view-links-panel__foot').boundingBox())!)).toBe(false);
            await toast.getByRole('button', { name: 'Undo' }).tap();
            await expect(row(page, 'H0024')).toBeVisible();
            await expect(ghosts(page)).toHaveCount(6);
        });
    });
}

test.describe('linked in the view only: the dark theme', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the indicator, the list, the bubble\'s button, the family\'s button and the confirmation take the dark tokens', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        const token = (name: string) => page.evaluate((n) => {
            const el = document.createElement('div');
            el.style.color = `var(${n})`;
            document.body.appendChild(el);
            const c = getComputedStyle(el).color;
            el.remove();
            return c;
        }, name);
        const [surface, border, primary, text] = await Promise.all(['--surface', '--border', '--primary', '--text'].map(token));
        expect(surface).not.toBe('rgb(255, 255, 255)');

        await store(page, [B, CHAINED]);
        const pill = page.locator('#view-links-pill');
        await expect(pill).toHaveCSS('background-color', surface);
        await expect(pill).toHaveCSS('border-top-color', border);
        await pill.locator('.view-links-pill__open').click();
        await expect(panel(page)).toHaveCSS('background-color', surface);
        await expect(panel(page).locator('.view-links-row__who').first()).toHaveCSS('color', text);
        await page.keyboard.press('Escape');

        void page.evaluate(() => window.Strom.UI.viewLinkUnlink('H0022'));
        const pop = page.getByRole('alertdialog');
        await expect(pop).toHaveCSS('background-color', surface);
        await expect(pop.getByRole('button', { name: 'Unlink' })).toHaveCSS('background-color', primary);
        await page.keyboard.press('Escape');

        await store(page, [], 'P0010');
        await card(page, 'Václav').locator('.research-edge').click();
        await expect(bubble(page).locator('.reb-show').first()).toHaveCSS('border-top-color', primary);
        await expect(bubble(page).locator('.reb-show').first()).toHaveCSS('color', primary);
        await page.keyboard.press('Escape');

        await store(page, [], 'P0125');
        const btn = page.locator('.view-link-island-btn');
        await expect(btn).toHaveCSS('background-color', surface);
        await expect(btn).toHaveCSS('border-top-color', primary);
    });
});
