import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Linked in the view only, its look: the people of a shown family are ghosts
 * (hatched, a solid 1.5px border in a cool tone, no shadow, no "outside the
 * tree" caption, the same box as any card), the line that links them is
 * hollow (two strokes) and labelled "unproven · H0022 B" — a button that
 * opens the hypothesis in the person's research; the research edge's stub and
 * "+ family" pill step aside while the family is shown. Invented data only
 * (e2e/fixtures/research-hypothesis-links.ged).
 */

const GED = readFileSync('e2e/fixtures/research-hypothesis-links.ged', 'utf-8');

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'research-hypothesis-links.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

type Rec = { hypo: string; variant: string; kind: string; anchor: string; island: string[]; on?: boolean };
const B: Rec = { hypo: 'H0022', variant: 'B', kind: 'child', anchor: 'P0010', island: ['P0125', 'P0126'] };
const PARTNER: Rec = { hypo: 'H0024', variant: 'A', kind: 'partners', anchor: 'P0011', island: ['P0140'] };

/** Store the records "linked in the view only" and focus `focus` (Karel), which draws them. */
async function show(page: Page, records: Rec[], focus = 'P0001'): Promise<void> {
    await page.evaluate(({ records, focus }) => {
        const S = window.Strom;
        const treeId = S.DataManager.getCurrentTreeId()!;
        const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)!.id;
        const links = records.map((r, i) => ({
            hypo: r.hypo, variant: r.variant, kind: r.kind, anchorId: byRefn(r.anchor),
            islandIds: r.island.map(byRefn), on: r.on ?? true, addedAt: i + 1,
        }));
        localStorage.setItem(`strom-view-links:${treeId}`, JSON.stringify(links));
        S.TreeRenderer.setFocus(byRefn(focus));
    }, { records, focus });
}

/**
 * Václav's edge an ordinary one (not searched) joining the family of Jakub by
 * variant B: a stub with "+ family · 5" (a `named` stub has no pill).
 */
const GED_PILL = GED.replace(/2 _END named\n/, '2 _END unsearched\n')
    .replace(/3 _JOIN P0126\n3 _JOIN P0125\n3 _JOIN P0127\n3 _JOIN P0128\n3 _JOIN P0129\n3 _JOIN P0130\n3 _VAR B\n3 _VAR C\n/, '3 _JOIN P0125\n3 _VAR B\n');

async function setup(page: Page, width = 1440, height = 900, ged = GED): Promise<void> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await dropFile(page, ged);
    await expect(card(page, 'Karel').first()).toBeVisible();
}

const idOf = (page: Page, refn: string) => page.evaluate((r) => window.Strom.DataManager.getAllPersons().find(p => p.refn === r)!.id, refn);

/** A colour token of the page, as the browser computes colours (rgb()). */
async function token(page: Page, name: string): Promise<string> {
    return page.evaluate((n) => {
        const el = document.createElement('div');
        el.style.color = `var(${n})`;
        document.body.appendChild(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
    }, name);
}

const TOKENS = {
    light: { '--ghost-line': 'rgb(122, 139, 157)', '--ghost-name': 'rgb(54, 67, 79)', '--ghost-text': 'rgb(71, 86, 102)', '--ghost-pill-bg': 'rgb(238, 240, 239)' },
    dark: { '--ghost-line': 'rgb(125, 144, 163)', '--ghost-name': 'rgb(201, 211, 221)', '--ghost-text': 'rgb(180, 193, 206)', '--ghost-pill-bg': 'rgb(42, 46, 51)' },
};

test.describe('linked in the view only: the look', () => {
    for (const theme of ['light', 'dark'] as const) {
        test(`ghost cards, ghost lines, the hollow line and its label (${theme})`, async ({ page }) => {
            await setup(page);
            if (theme === 'dark') {
                await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
                await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
            }
            await show(page, [B, PARTNER]);
            const t = TOKENS[theme];
            for (const [name, value] of Object.entries(t)) expect(await token(page, name)).toBe(value);
            const bg = await token(page, '--bg');

            // A ghost: hatch, a solid border, no shadow, the ghost's text colours.
            const jakub = card(page, 'Jakub');
            await expect(jakub).toHaveClass(/view-ghost/);
            const cs = await jakub.evaluate((el) => {
                const s = getComputedStyle(el);
                const name = el.querySelector('.name .name-text')!;
                const meta = el.querySelector('.birth-date');
                return {
                    image: s.backgroundImage, border: s.borderTopWidth, style: s.borderTopStyle, color: s.borderTopColor,
                    shadow: s.boxShadow, name: getComputedStyle(name).color, meta: meta ? getComputedStyle(meta).color : null,
                };
            });
            expect(cs.image).toContain('repeating-linear-gradient');
            // 1.5px solid: the 1px border and a half pixel ring inside it, no shadow around.
            expect(cs.border).toBe('1px');
            expect(cs.style).toBe('solid');
            expect(cs.color).toBe(t['--ghost-line']);
            expect(cs.shadow).toBe(`${t['--ghost-line']} 0px 0px 0px 0.5px inset`);
            expect(cs.name).toBe(t['--ghost-name']);
            expect(cs.meta).toBe(t['--ghost-text']);
            // A real card keeps its own look.
            const karel = await card(page, 'Karel').evaluate((el) => getComputedStyle(el).backgroundImage);
            expect(karel).toBe('none');

            // Inside the shown family: the tree's lines in the ghost's tone, 1.5px.
            const ghostLine = page.locator('#tree-lines line.view-ghost').first();
            await expect(ghostLine).toHaveCSS('stroke', t['--ghost-line']);
            await expect(ghostLine).toHaveCSS('stroke-width', '1.5px');

            // The linking lines: hollow — a 5px stroke under a 2px one in the canvas colour, same path, no dash.
            for (const hypo of ['H0022', 'H0024']) {
                const outer = page.locator(`#tree-lines path.view-virtual-outer[data-view-hypo="${hypo}"]`);
                const inner = page.locator(`#tree-lines path.view-virtual-inner[data-view-hypo="${hypo}"]`);
                await expect(outer).not.toHaveCount(0);
                expect(await inner.count()).toBe(await outer.count());
                expect(await inner.evaluateAll(els => els.map(e => e.getAttribute('d'))))
                    .toEqual(await outer.evaluateAll(els => els.map(e => e.getAttribute('d'))));
                await expect(outer.first()).toHaveCSS('stroke', t['--ghost-line']);
                await expect(outer.first()).toHaveCSS('stroke-width', '5px');
                await expect(outer.first()).toHaveCSS('stroke-linejoin', 'round');
                await expect(outer.first()).toHaveCSS('stroke-dasharray', 'none');
                await expect(inner.first()).toHaveCSS('stroke', bg);
                await expect(inner.first()).toHaveCSS('stroke-width', '2px');
                // Every narrow stroke over every wide one.
                const order = await page.locator('#tree-lines path.view-virtual').evaluateAll(els => els.map(e => e.getAttribute('data-view-part')));
                expect(order.indexOf('inner')).toBeGreaterThan(order.lastIndexOf('outer'));
            }
            // No plain line is left that exists only in the view.
            await expect(page.locator('#tree-lines line[data-view="virtual"]')).toHaveCount(0);

            // The labels: one per link, in the ghost's pill colours.
            const label = page.locator('.view-link-label[data-view-hypo="H0022"]');
            await expect(label).toHaveText('unproven · H0022 B');
            await expect(label).toHaveCSS('background-color', t['--ghost-pill-bg']);
            await expect(label).toHaveCSS('border-top-color', t['--ghost-line']);
            await expect(label).toHaveCSS('color', t['--ghost-name']);
            await expect(label).toHaveCSS('height', '24px');
            await expect(label).toHaveCSS('font-size', '11.5px');
            await expect(label).toHaveCSS('font-weight', '600');
            await expect(page.locator('.view-link-label[data-view-hypo="H0024"]')).toHaveText('unproven · H0024 A');
            await expect(page.locator('.view-link-label')).toHaveCount(2);
        });
    }

    test('a ghost: no caption, the tooltip row with its mark, the screen reader hears it last', async ({ page }) => {
        await setup(page);
        await show(page, [B]);
        const jakub = card(page, 'Jakub');
        await expect(jakub).toHaveClass(/view-ghost/);
        await expect(jakub.locator('.island-caption')).toHaveCount(0);
        const row = jakub.locator('.card-tooltip .tt-view-link');
        await expect(row).toHaveText('Linked in the view only (H0022, version B)');
        await expect(row.locator('.view-link-icon')).toHaveCount(1);
        // The ghost row is the tooltip's last row before the gesture hint.
        const rows = await jakub.locator('.card-tooltip .tt-body > *').evaluateAll(els => els.map(e => e.className));
        expect(rows[rows.length - 2]).toContain('tt-view-link');
        expect(await jakub.getAttribute('aria-label')).toMatch(/Jakub Horák.*\. Linked in the view only, unproven\.$/);
        // A real card says nothing of it.
        expect(await card(page, 'Karel').getAttribute('aria-label')).not.toContain('view only');
        await expect(card(page, 'Karel').locator('.tt-view-link')).toHaveCount(0);
    });

    test('a ghost keeps the card\'s signals: the evidence stripes and the action badge, as on the family\'s own cards', async ({ page }) => {
        // Jakub's birth with a source (a stripe) and an open question (the badge).
        const ged = GED.replace('1 REFN P0125\n2 TYPE strom-research\n1 BIRT\n2 DATE 1790\n',
            '1 REFN P0125\n2 TYPE strom-research\n1 BIRT\n2 DATE 1790\n2 SOUR @S0001@\n');
        expect(ged).not.toBe(GED);
        await setup(page, 1440, 900, ged);
        await page.evaluate(() => {
            const S = window.Strom;
            const jakub = S.DataManager.getAllPersons().find(p => p.refn === 'P0125')!;
            (jakub as { question?: string }).question = 'Kdy zemřel?';
        });
        const signals = () => card(page, 'Jakub').evaluate((el) => {
            const look = (sel: string) => {
                const node = el.querySelector<HTMLElement>(sel);
                if (!node) return null;
                const s = getComputedStyle(node);
                return { html: node.outerHTML, bg: s.backgroundColor, color: s.color, opacity: s.opacity, display: s.display };
            };
            return { stripes: el.querySelectorAll('.card-state .st-ev i').length, state: look('.card-state'), stripe: look('.card-state .st-ev i'), badge: look('.card-signal') };
        });
        // The family's own view (not linked): its cards.
        await show(page, [], 'P0125');
        await expect(card(page, 'Jakub')).toHaveClass(/research-island/);
        await expect(card(page, 'Jakub')).not.toHaveClass(/view-ghost/);
        const own = await signals();
        expect(own.stripes).toBeGreaterThan(0);
        expect(own.badge).not.toBeNull();
        // Shown as linked: a ghost, the same signals, drawn the same.
        await show(page, [B]);
        await expect(card(page, 'Jakub')).toHaveClass(/view-ghost/);
        expect(await signals()).toEqual(own);
    });

    test('the island caption is gone for a ghost of the shown family only', async ({ page }) => {
        await setup(page);
        // Without the link, the family shows under "+ family" (go to it): its cards carry the caption.
        await page.evaluate(() => {
            const S = window.Strom;
            S.TreeRenderer.setFocus(S.DataManager.getAllPersons().find(p => p.refn === 'P0125')!.id);
        });
        await expect(card(page, 'Jakub').locator('.island-caption')).toHaveCount(1);
        await show(page, [B]);
        await expect(card(page, 'Jakub')).toHaveClass(/view-ghost/);
        await expect(page.locator('.person-card.view-ghost .island-caption')).toHaveCount(0);
    });

    test('the label: a button with its name, Enter and a click open the hypothesis in the research', async ({ page }) => {
        await setup(page);
        await show(page, [B]);
        const label = page.getByRole('button', { name: 'Unproven, hypothesis H0022, version B. Open in the research.' });
        await expect(label).toHaveCount(1);
        await expect(label).toHaveAttribute('role', 'button');
        await expect(label).toHaveText('unproven · H0022 B');
        // 44px to aim at beyond its 24px.
        const hit = await label.evaluate((el) => parseFloat(getComputedStyle(el, '::before').height));
        expect(hit).toBe(44);

        await label.focus();
        await expect(label).toBeFocused();
        await page.keyboard.press('Enter');
        const dialog = page.locator('#person-research-modal .person-research-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('data-open-hypo', 'H0022');
        await expect(dialog).toHaveAttribute('data-open-variant', 'B');
        // The anchor's research (Václav's): the hypothesis is marked for its own section.
        await expect(page.locator('#person-research-modal .audit-log-subtitle')).toContainText('1818');
        await expect(dialog.locator('.person-research-hypo[data-hypo="H0022"]')).toHaveCount(1);
        // Closed (Esc, or its Close button): the keyboard is back on the label.
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(label).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(dialog).toBeVisible();
        await page.locator('#person-research-close').click();
        await expect(dialog).toHaveCount(0);
        await expect(label).toBeFocused();

        await label.click();
        await expect(dialog).toHaveAttribute('data-open-hypo', 'H0022');
    });

    test('far out the label goes, the hollow line and the hatch stay', async ({ page }) => {
        await setup(page);
        await show(page, [B]);
        const label = page.locator('.view-link-label');
        await expect(label).toBeVisible();
        await expect.poll(async () => {
            await page.evaluate(() => window.Strom.ZoomPan.zoomOut());
            await page.waitForTimeout(260);
            return page.evaluate(() => window.Strom.ZoomPan.getScale());
        }, { timeout: 10000 }).toBeLessThan(0.55);
        await expect(page.locator('#tree-canvas')).toHaveClass(/zoom-far/);
        await expect(label).toBeHidden();
        await expect(page.locator('#tree-lines path.view-virtual-outer').first()).toBeVisible();
        expect(await card(page, 'Jakub').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('repeating-linear-gradient');
        // Back in: the label is back.
        await expect.poll(async () => {
            await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
            await page.waitForTimeout(260);
            return page.evaluate(() => window.Strom.ZoomPan.getScale());
        }, { timeout: 10000 }).toBeGreaterThanOrEqual(0.55);
        await expect(label).toBeVisible();
    });

    test('the stub and the "+ family" pill step aside while the family is shown and come back after', async ({ page }) => {
        expect(GED_PILL).not.toContain('_END named');
        await setup(page, 1440, 900, GED_PILL);
        const vaclav = await idOf(page, 'P0010');
        const stub = card(page, 'Václav').locator('.research-edge');
        const pill = page.locator(`.edge-link-pill--family[data-edge-person="${vaclav}"]`);
        await expect(stub).toHaveCount(1);
        await expect(pill).toHaveCount(1);

        await show(page, [B]);
        await expect(page.locator('.view-link-label')).toHaveCount(1);
        await expect(stub).toHaveCount(0);
        await expect(pill).toHaveCount(0);
        await expect(page.locator('.edge-link-curve')).toHaveCount(0);

        // Turned off (the stored record, as the list's switch does): the stub and the pill are back.
        await show(page, [{ ...B, on: false }]);
        await expect(page.locator('.view-link-label')).toHaveCount(0);
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(0);
        await expect(stub).toHaveCount(1);
        await expect(pill).toHaveCount(1);
    });

    test('a ghost has the box of any card and the same room for its text, on every card type', async ({ page }) => {
        await setup(page);
        await show(page, [B]);
        for (const density of ['compact', 'normal', 'detailed', 'register', 'custom'] as const) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d), density);
            await expect(card(page, 'Jakub')).toHaveClass(/view-ghost/);
            const r = await page.evaluate(() => {
                const S = window.Strom;
                const box = S.TreeRenderer.getCardBox();
                const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)!.id;
                const measure = (refn: string) => {
                    const id = byRefn(refn);
                    const el = document.querySelector<HTMLElement>(`.person-card[data-id="${id}"]`)!;
                    const body = el.querySelector<HTMLElement>('.card-body')!;
                    return {
                        w: el.offsetWidth, h: el.offsetHeight,
                        boxW: box.cardWidth, boxH: box.personHeights?.get(id) ?? box.cardHeight,
                        body: body.getBoundingClientRect().width / (el.getBoundingClientRect().width / el.offsetWidth),
                    };
                };
                return { ghost: measure('P0125'), real: measure('P0010') };
            });
            // The layout's box, exactly.
            expect(r.ghost.w, density).toBe(r.ghost.boxW);
            expect(r.ghost.h, density).toBe(r.ghost.boxH);
            expect(r.real.w, density).toBe(r.real.boxW);
            // The same room for the text as a real card's.
            expect(r.ghost.body, density).toBeCloseTo(r.real.body, 3);
        }
    });

    test('a focused ghost keeps the green 2px border over the hatch', async ({ page }) => {
        await setup(page);
        await show(page, [B], 'P0125');
        const jakub = card(page, 'Jakub');
        await expect(jakub).toHaveClass(/focused/);
        await expect(jakub).toHaveClass(/view-ghost/);
        const primary = await token(page, '--primary');
        await expect(jakub).toHaveCSS('border-top-width', '2px');
        await expect(jakub).toHaveCSS('border-top-color', primary);
        expect(await jakub.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('repeating-linear-gradient');
    });

    test('the minimap draws a ghost as a framed hatch, a real card filled', async ({ page }) => {
        await setup(page);
        await show(page, [B]);
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(5);
        for (let i = 0; i < 4; i++) await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
        await expect(page.locator('#minimap-panel')).toBeVisible();
        const px = await page.evaluate(() => {
            const S = window.Strom;
            const ui = S.UI as unknown as { minimapTransform: { scale: number; offsetX: number; offsetY: number }; drawMinimap(): void };
            ui.drawMinimap();
            const t = ui.minimapTransform;
            const canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
            const ctx = canvas.getContext('2d')!;
            const box = S.TreeRenderer.getCardBox();
            const positions = S.TreeRenderer.getPosterLayout({ includeView: true }).positions;
            const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)!.id;
            const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)).join(',');
            const frame = (refn: string) => {
                const p = positions.get(byRefn(refn))!;
                const x = Math.round(p.x * t.scale + t.offsetX);
                const y = Math.round(p.y * t.scale + t.offsetY);
                const h = Math.max(2, Math.round(box.cardHeight * t.scale));
                return { left: at(x, y + Math.floor(h / 2)) };
            };
            const center = (refn: string) => {
                const p = positions.get(byRefn(refn))!;
                return at(Math.floor((p.x + box.cardWidth / 2) * t.scale + t.offsetX), Math.floor((p.y + box.cardHeight / 2) * t.scale + t.offsetY));
            };
            // The colours the minimap is meant to use.
            const probe = document.createElement('canvas').getContext('2d')!;
            const rgb = (c: string) => { probe.fillStyle = c; probe.fillRect(0, 0, 1, 1); return Array.from(probe.getImageData(0, 0, 1, 1).data.slice(0, 3)).join(','); };
            const root = getComputedStyle(document.documentElement);
            return {
                ghostFrame: frame('P0125').left,
                ghostLine: rgb(root.getPropertyValue('--ghost-line').trim()),
                realCenter: center('P0001'),
                male: rgb(root.getPropertyValue('--male').trim()),
            };
        });
        expect(px.ghostFrame).toBe(px.ghostLine);
        expect(px.realCenter).toBe(px.male);
    });
});

test.describe('linked in the view only: the label on touch', () => {
    test.use({ viewport: { width: 800, height: 1000 }, hasTouch: true, isMobile: true });

    test('28px high on a touch screen', async ({ page }) => {
        await openApp(page);
        await dropFile(page, GED);
        await expect(card(page, 'Karel').first()).toBeVisible();
        await show(page, [B]);
        const label = page.locator('.view-link-label');
        await expect(label).toHaveCount(1);
        await expect(label).toHaveCSS('height', '28px');
        expect(await label.evaluate((el) => parseFloat(getComputedStyle(el, '::before').height))).toBe(44);
    });
});
