import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Responsive layout sweep over the breakpoint map (index.html, top of the
 * stylesheet): mobile ≤ 499, tablet 500–900, desktop ≥ 901, plus the toolbar
 * regime edges (1024, 1280). For every width, in the light and the dark theme,
 * on the demo tree:
 *   1. the document never scrolls horizontally,
 *   2. the visible toolbar controls do not overlap each other,
 *   3. the key dialogs (person edit, relationships, export, tree manager,
 *      settings) sit fully inside the viewport horizontally and have no
 *      horizontal scroll of their own.
 * One page per width: the demo loads once, both themes are probed on it.
 */

const WIDTHS = [360, 499, 550, 768, 900, 1024, 1280, 1440];
const HEIGHT = 800;

interface Dialog {
    name: string;
    id: string;
    open: (page: Page, focusId: string) => Promise<void>;
}

const DIALOGS: Dialog[] = [
    {
        name: 'person edit', id: 'person-modal',
        open: (page, id) => page.evaluate((pid) => window.Strom.UI.showEditPersonModal(pid), id),
    },
    {
        name: 'relationships', id: 'relationships-modal',
        open: (page, id) => page.evaluate((pid) => window.Strom.UI.showRelationshipsPanel(pid), id),
    },
    {
        name: 'export', id: 'export-modal',
        open: (page) => page.evaluate(() => window.Strom.UI.showExportDialog()),
    },
    {
        name: 'tree manager', id: 'tree-manager-modal',
        open: (page) => page.evaluate(() => window.Strom.UI.showTreeManagerDialog()),
    },
    {
        name: 'settings', id: 'settings-modal',
        open: (page) => page.evaluate(() => window.Strom.UI.showSettingsDialog()),
    },
];

/** Horizontal overflow of the whole document. */
function documentOverflow(page: Page) {
    return page.evaluate(() => {
        const de = document.documentElement;
        const body = document.body;
        return {
            html: { scroll: de.scrollWidth, client: de.clientWidth },
            body: { scroll: body.scrollWidth, client: body.clientWidth },
            inner: window.innerWidth,
        };
    });
}

/**
 * Visible interactive toolbar controls (buttons, inputs, selects, the tree
 * switcher) whose boxes intersect. Nested controls (a button inside a picker)
 * are compared only when neither contains the other.
 */
function toolbarOverlaps(page: Page) {
    return page.evaluate(() => {
        const tb = document.querySelector('.toolbar') as HTMLElement;
        const shown = (el: Element): boolean => {
            for (let e: Element | null = el; e && e !== tb.parentElement; e = e.parentElement) {
                const cs = getComputedStyle(e);
                if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
            }
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const controls = Array.from(tb.querySelectorAll<HTMLElement>('button, input, select, [role="button"]'))
            .filter(el => shown(el))
            // Controls inside an open-able dropdown are laid over the page by
            // design; only the bar itself is audited.
            .filter(el => !el.closest('.actions-menu-dropdown, .tree-switcher-dropdown, .person-picker-dropdown, [role="menu"]'));
        const label = (el: HTMLElement) => el.id || el.className || el.tagName;
        const hits: string[] = [];
        for (let i = 0; i < controls.length; i++) {
            for (let j = i + 1; j < controls.length; j++) {
                const a = controls[i], b = controls[j];
                if (a.contains(b) || b.contains(a)) continue;
                const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
                const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
                // 1px tolerance for sub-pixel rounding of adjacent borders.
                if (ix > 1 && iy > 1) hits.push(`${label(a)} × ${label(b)} (${ix.toFixed(1)}×${iy.toFixed(1)})`);
            }
        }
        return { count: controls.length, hits };
    });
}

/** Geometry of an open dialog's panel. */
function dialogBox(page: Page, id: string) {
    return page.evaluate((overlayId) => {
        const panel = document.querySelector(`#${overlayId} .modal`) as HTMLElement;
        const r = panel.getBoundingClientRect();
        const scrollers = [panel, ...Array.from(panel.querySelectorAll<HTMLElement>('.modal-content'))];
        const hScroll = scrollers
            .filter(el => el.scrollWidth > el.clientWidth + 1)
            .map(el => `${el.className}: ${el.scrollWidth} > ${el.clientWidth}`);
        return { left: r.left, right: r.right, width: r.width, inner: window.innerWidth, hScroll };
    }, id);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
    await page.evaluate((t) => window.Strom.SettingsManager.setTheme(t), theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function loadDemo(page: Page): Promise<string> {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.loadDemoTree());
    await expect(card(page, 'Henry VIII')).toBeVisible();
    // Dismiss the non-blocking tour offer / hint so nothing sits on the bar.
    await page.evaluate(() => document.querySelectorAll('.tour-offer, .toast').forEach(e => e.remove()));
    const id = await card(page, 'Henry VIII').getAttribute('data-id');
    if (!id) throw new Error('demo focus has no data-id');
    return id;
}

for (const width of WIDTHS) {
    test(`no horizontal overflow, toolbar overlap or dialog overflow @${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: HEIGHT });
        const focusId = await loadDemo(page);

        for (const theme of ['light', 'dark'] as const) {
            await setTheme(page, theme);
            const at = `@${width}px ${theme}`;

            const doc = await documentOverflow(page);
            expect(doc.html.scroll, `${at}: <html> scrolls horizontally`).toBeLessThanOrEqual(doc.html.client + 1);
            expect(doc.body.scroll, `${at}: <body> scrolls horizontally`).toBeLessThanOrEqual(doc.body.client + 1);

            const tb = await toolbarOverlaps(page);
            expect(tb.count, `${at}: toolbar has visible controls`).toBeGreaterThan(0);
            expect(tb.hits, `${at}: overlapping toolbar controls`).toEqual([]);

            for (const dlg of DIALOGS) {
                await dlg.open(page, focusId);
                const overlay = page.locator(`#${dlg.id}`);
                await expect(overlay).toHaveClass(/active/);
                const box = await dialogBox(page, dlg.id);
                const where = `${at} ${dlg.name}`;
                expect(box.width, `${where}: panel rendered`).toBeGreaterThan(0);
                expect(box.left, `${where}: panel starts inside the viewport`).toBeGreaterThanOrEqual(0);
                expect(box.right, `${where}: panel ends inside the viewport`).toBeLessThanOrEqual(box.inner);
                expect(box.hScroll, `${where}: no horizontal scroll inside the dialog`).toEqual([]);
                // Opening a dialog must not make the page itself scroll sideways.
                const d = await documentOverflow(page);
                expect(d.html.scroll, `${where}: <html> scrolls horizontally`).toBeLessThanOrEqual(d.html.client + 1);

                await page.keyboard.press('Escape');
                await expect(overlay).not.toHaveClass(/active/);
            }
        }
    });
}
