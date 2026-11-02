/**
 * A line's timeline (1102 §5): the saved file (the century segment zooms the
 * overview and opens its century, the chips filter the rows, without scripts
 * every century open and no controls, a phone without sideways scrolling,
 * the dark scheme's tokens, print without the controls) and the app's window
 * (the line page's link opens the timeline, the controls work, the dark theme).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPageSet } from '../src/family-pages';
import { buildPageSetHtml } from '../src/family-pages-html';
import { timelineFixture, TP_NOW } from '../src/__tests__/helpers/tree-pages-fixture';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

const dir = mkdtempSync(join(tmpdir(), 'strom-timeline-'));
const fx = timelineFixture();
const set = buildPageSet(fx.data, { kind: 'tree' }, {
    lang: 'cs', privacy: 'full', now: TP_NOW, timelines: true, history: { payload: fx.history },
}, { treeName: 'Rodokmen z Lopuchova' });
const file = join(dir, 'Rodokmen.html');
writeFileSync(file, buildPageSetHtml(set), 'utf-8');
const url = pathToFileURL(file).href;
const TL = 'casova-osa-lhotak-lopuchov';
const ROD = set.bySlug.get(TL)!.crumbs[1].slug!;

/** Slugs of the sections on the screen. */
async function shown(page: Page): Promise<string[]> {
    return page.locator('section.sp-page').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.id));
}

/** The centuries whose events are open. */
async function openCenturies(tl: Locator): Promise<string[]> {
    return tl.locator('details.sp-tl-c').evaluateAll(els => els.filter(e => (e as HTMLDetailsElement).open).map(e => e.getAttribute('data-c') ?? ''));
}

test.describe('a line\'s timeline: the saved file', () => {
    test('the line page\'s link opens it; the segment zooms and opens one century; the chips filter the rows', async ({ page }) => {
        await page.goto(`${url}#${ROD}`);
        await expect.poll(() => shown(page)).toEqual([ROD]);
        await page.locator(`#${ROD} .sp-tl-go a`).click();
        await expect.poll(() => shown(page)).toEqual([TL]);
        const tl = page.locator(`#${TL} .sp-tl`);
        // Opened on the whole period with the century of the most events open.
        await expect(tl.locator('[data-tl-c=""]')).toHaveAttribute('aria-checked', 'true');
        expect(await openCenturies(tl)).toEqual(['19']);
        await expect(tl.locator('.sp-tl-ticks span')).toHaveText(['1800', '1900', '2000']);
        // The 20th century: the overview zoomed to 1890–2010, only its events open.
        await tl.locator('[data-tl-c="20"]').click();
        await expect(tl.locator('[data-tl-c="20"]')).toHaveAttribute('aria-checked', 'true');
        expect(await openCenturies(tl)).toEqual(['20']);
        await expect(tl.locator('.sp-tl-ticks span')).toHaveText(['1900', '1950', '2000']);
        // Births off: no birth row on screen; History off: no band either.
        const births = tl.locator('details[data-c="20"] .sp-tl-row[data-k="birth"]');
        await expect(births.first()).toBeVisible();
        await tl.locator('[data-tl-k="birth"]').click();
        await expect(tl.locator('[data-tl-k="birth"]')).toHaveAttribute('aria-pressed', 'false');
        expect(await births.evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').length)).toBe(0);
        await expect(tl.locator('details[data-c="20"] .sp-tl-row[data-k="death"]').first()).toBeVisible();
        await tl.locator('[data-tl-k="hist"]').click();
        expect(await tl.locator('.sp-tl-band').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').length)).toBe(0);
        // All: back to the whole period.
        await tl.locator('[data-tl-c=""]').click();
        expect(await openCenturies(tl)).toEqual(['19']);
    });

    test('without the script: every century open, no controls', async ({ browser }) => {
        const ctx = await browser.newContext({ javaScriptEnabled: false });
        const page = await ctx.newPage();
        await page.goto(url);
        const tl = page.locator(`#${TL} .sp-tl`);
        expect(await openCenturies(tl)).toEqual(['19', '20', '21']);
        await expect(tl.locator('.sp-tl-ctl')).toBeHidden();
        await expect(tl.locator('.sp-tl-row').first()).toBeVisible();
        await ctx.close();
    });

    test('a phone at 390 px and held sideways: no sideways scrolling; the generations as roman numbers only', async ({ page }) => {
        for (const [w, h] of [[390, 844], [844, 390]] as const) {
            await page.setViewportSize({ width: w, height: h });
            await page.goto(`${url}#${TL}`);
            await expect.poll(() => shown(page)).toEqual([TL]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth), `${w}×${h}`).toBeLessThanOrEqual(w);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${url}#${TL}`);
        await expect(page.locator(`#${TL} .sp-tl-lab-n`).first()).toBeHidden();
    });

    test('the dark scheme\'s tokens; print without the controls', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(`${url}#${TL}`);
        await expect.poll(() => shown(page)).toEqual([TL]);
        const tl = page.locator(`#${TL} .sp-tl`);
        expect(await tl.evaluate(e => getComputedStyle(e).getPropertyValue('--hist').trim())).toBe('#4d3d2a');
        await page.emulateMedia({ media: 'print', colorScheme: 'light' });
        await expect(tl.locator('.sp-tl-ctl')).toBeHidden();
        await expect(tl.locator('details[data-c="21"] .sp-tl-row').first()).toBeVisible();
    });
});

test.describe('a line\'s timeline: the window', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the line page\'s link opens the timeline in the window; the controls work; the dark theme\'s tokens', async ({ page }) => {
        await openApp(page);
        await page.evaluate(async (data) => {
            const S = window.Strom;
            await S.DataManager.importAsNewTree(data, 'Brandvold');
            S.UI.updateTreeSwitcher?.();
            S.TreeRenderer.setFocus(data.defaultPersonId);
            await S.TreeRenderer.renderAsync();
        }, rodsTree());
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const treeId = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
        await page.evaluate((id) => window.Strom.UI.showTreeOverview(id as never, { section: 'rods' }), treeId);
        const sec = page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
        await expect(sec).toHaveAttribute('data-ready', 'true');
        await sec.locator('.tov-rod[data-rod]', { hasText: 'Tallqvist' }).locator('.tov-rod-row').click();
        await sec.locator('.tov-rod.is-open').getByRole('button', { name: 'Family line page' }).click();
        const win = page.locator('#person-page-modal');
        await expect(win.locator('.pp-body section.sp-page--rod')).toBeVisible();
        await win.locator('.pp-body .sp-tl-go button').click();
        const tl = win.locator('.pp-body section.sp-page--rodTimeline .sp-tl');
        await expect(tl).toBeVisible();
        await expect(win.locator('#pp-title')).toContainText('Tallqvist');
        // No history without the research: no History chip.
        await expect(tl.locator('[data-tl-k="hist"]')).toHaveCount(0);
        await expect(tl.locator('[data-tl-k]')).toHaveText(['Births', 'Marriages', 'Deaths', 'Moves']);
        const centuries = await tl.locator('[data-tl-c]').count();
        expect(centuries).toBeGreaterThan(2);
        expect((await openCenturies(tl)).length).toBe(1);
        const c = await tl.locator('[data-tl-c]').nth(1).getAttribute('data-tl-c');
        await tl.locator(`[data-tl-c="${c}"]`).click();
        expect(await openCenturies(tl)).toEqual([c]);
        await tl.locator('[data-tl-k="death"]').click();
        expect(await tl.locator('.sp-tl-row[data-k="death"]').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').length)).toBe(0);
        expect(await tl.evaluate(e => getComputedStyle(e).getPropertyValue('--hist').trim())).toBe('#4d3d2a');
        // Back returns to the line page.
        await win.locator('.pp-back').click();
        await expect(win.locator('.pp-body section.sp-page--rod')).toBeVisible();
    });
});
