/**
 * The whole tree's pages fit their screens (1102): in the saved file on a
 * phone and held sideways the lines' filter of the introduction's rows stays
 * (only the bar's search waits behind the magnifier), the bar's controls are
 * touch targets of 44 px; in the window a long line name takes two lines at
 * most with the whole name on hover, the bar's and the rows' controls are
 * 44 px under touch; the dialog's selected people: the picker's rows are not
 * the dialog's labels, the chips' × centred and not over the next row, the
 * search 44 px under touch, the people without a page of their own named on
 * the state line. Invented names only (e2e/rods-fixture.ts and the unit
 * tests' fixtures).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPageSet } from '../src/family-pages';
import { buildPageSetHtml } from '../src/family-pages-html';
import { manyLinesFixture, TP_NOW } from '../src/__tests__/helpers/tree-pages-fixture';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

const dir = mkdtempSync(join(tmpdir(), 'strom-family-pages-fit-'));
const many = manyLinesFixture(60);
const rowsUrl = (() => {
    const file = join(dir, 'Tree.html');
    writeFileSync(file, buildPageSetHtml(buildPageSet(many, { kind: 'tree' }, { lang: 'en', now: TP_NOW }, { treeName: 'Sixty lines' })), 'utf-8');
    return pathToFileURL(file).href;
})();

async function setup(page: Page, data: object = rodsTree()): Promise<void> {
    await openApp(page);
    await page.evaluate(() => window.Strom.SettingsManager.setOnThisDay(false));
    await page.evaluate(async (d) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(d as never, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus((d as { defaultPersonId: never }).defaultPersonId);
        await S.TreeRenderer.renderAsync();
    }, data);
}

async function treePages(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showTreeOverview(window.Strom.DataManager.getCurrentTreeId() as never));
    await page.locator('#tree-overview-modal .tov-pages').click();
    const win = page.locator('#person-page-modal');
    await expect(win.locator('.pp-body section.sp-page--tree')).toBeVisible();
    return win;
}

async function height(l: Locator): Promise<number> {
    return (await l.boundingBox())!.height;
}

async function noSidewaysScroll(page: Page): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

for (const [name, viewport] of [['a phone at 390 px', { width: 390, height: 844 }], ['a phone held sideways (844×390)', { width: 844, height: 390 }]] as const) {
    test.describe(`the saved file of sixty lines on ${name}`, () => {
        test.use({ viewport, hasTouch: true, isMobile: true });

        test('the rows\' filter stays while the bar\'s search waits behind the magnifier; the bar\'s controls are 44 px', async ({ page }) => {
            await page.goto(rowsUrl);
            const filter = page.locator('.sp-rods-f label.sp-rods-s');
            await expect(filter).toBeVisible();
            expect(await height(filter.locator('.sp-q'))).toBeGreaterThanOrEqual(44);
            await expect(page.locator('.sp-fbar .sp-search')).toBeHidden();
            await filter.locator('.sp-q').fill('jalovec');
            await expect(page.locator('.sp-rrow:visible')).not.toHaveCount(0);
            for (const row of await page.locator('.sp-rrow:visible').allTextContents()) expect(row).toContain('Jalovec');
            const bar = page.locator('.sp-fbar');
            expect(await height(bar.locator('.sp-fbar-home'))).toBeGreaterThanOrEqual(44);
            const btn = bar.locator('.sp-rodpick-btn');
            expect(await height(btn)).toBeGreaterThanOrEqual(44);
            await btn.tap();
            expect(await height(bar.locator('.sp-rodpick-q'))).toBeGreaterThanOrEqual(44);
            await noSidewaysScroll(page);
        });
    });
}

test.describe('the window\'s header at 1024 px', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('a long line name takes two lines at most, ends with an ellipsis and is whole on hover', async ({ page }) => {
        const long = JSON.parse(JSON.stringify(rodsTree()).split('Brandvold').join('Brandvold-Ekhammar-Ostrander-Hasselgren-Tallqvist-Lindqvarn'));
        await setup(page, long);
        await page.evaluate(() => window.Strom.UI.showPersonPage('b12w' as never));
        const win = page.locator('#person-page-modal');
        const h2 = win.locator('#pp-title');
        // The person page's title has no hover text of its own.
        await expect(h2).not.toHaveAttribute('title', /.+/);
        await win.locator('.pp-facts [data-pp-rod]', { hasText: 'Brandvold' }).click();
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(h2).toContainText('Brandvold-Ekhammar-Ostrander-Hasselgren-Tallqvist-Lindqvarn');
        await expect(h2).toHaveAttribute('title', (await h2.textContent())!);
        const m = await h2.evaluate(el => ({
            h: el.clientHeight, sh: el.scrollHeight, lh: parseFloat(getComputedStyle(el).lineHeight),
            over: el.scrollWidth - el.clientWidth, right: el.getBoundingClientRect().right,
            next: Math.min(Infinity, ...[...el.closest('.pp-head')!.querySelectorAll('.pp-print, .pp-save, .pp-book')]
                .map(b => b.getBoundingClientRect()).filter(b => b.width > 0).map(b => b.left)),
        }));
        // Longer than two lines, cut to two.
        expect(m.sh).toBeGreaterThan(m.h + 4);
        expect(m.h).toBeLessThanOrEqual(2 * m.lh + 2);
        expect(m.over).toBeLessThanOrEqual(0);
        expect(m.right).toBeLessThanOrEqual(m.next);
    });
});

test.describe('the window on a touch phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the bar\'s name, the choice of a line and its field, the rows\' filter and the page above are 44 px', async ({ page }) => {
        const data = { ...many, defaultPersonId: Object.keys(many.persons)[0] };
        await setup(page, data);
        const win = await treePages(page);
        const bar = win.locator('.sp-fbar');
        expect(await height(bar.locator('.sp-fbar-home'))).toBeGreaterThanOrEqual(44);
        const filter = win.locator('.sp-rods-f .sp-q');
        await expect(filter).toBeVisible();
        expect(await height(filter)).toBeGreaterThanOrEqual(44);
        const btn = bar.locator('.sp-rodpick-btn');
        expect(await height(btn)).toBeGreaterThanOrEqual(44);
        await btn.tap();
        expect(await height(bar.locator('.sp-rodpick-q'))).toBeGreaterThanOrEqual(44);
        await bar.locator('.sp-rodpick-rod .sp-rodpick-a').first().tap();
        await expect(win.locator('.pp-body section.sp-page--rod')).toBeVisible();
        const back = win.locator('.pp-body .sp-crumb-back');
        await expect(back).toBeVisible();
        const box = (await back.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        await noSidewaysScroll(page);
    });
});

async function openSelected(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showBookDialog('pages'));
    const dialog = page.locator('#book-modal');
    await expect(dialog).toHaveClass(/active/);
    await dialog.locator('.book-kind[data-kind="persons"]').click();
    return dialog;
}

async function pick(dialog: Locator, name: string): Promise<void> {
    await dialog.locator('.book-sel-persons .ppm-search').fill(name);
    await dialog.locator('.book-sel-persons .ppm-row', { hasText: name }).first().click();
}

test.describe('the dialog\'s selected people', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the picker\'s rows are rows, not the dialog\'s labels; the chips\' × centred; the living without a page named', async ({ page }) => {
        await setup(page);
        const dialog = await openSelected(page);
        const sel = dialog.locator('.book-sel-persons');
        await sel.locator('.ppm-search').fill('Brandvold');
        const row = sel.locator('.ppm-row').first();
        await expect(row).toBeVisible();
        const r = await row.evaluate(el => {
            const cs = getComputedStyle(el);
            const box = el.querySelector('input')!.getBoundingClientRect();
            const name = el.querySelector('.ppm-name')!.getBoundingClientRect();
            const text = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
            const probe = document.createElement('span');
            probe.style.color = text;
            document.body.append(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            return { display: cs.display, margin: cs.marginBottom, color: cs.color === want, beside: box.right <= name.left && Math.abs(box.top - name.top) < 12 };
        });
        expect(r).toEqual({ display: 'flex', margin: '0px', color: true, beside: true });

        for (const name of ['Karl Brandvold', 'Axel Brandvold', 'Rut Hasselgren', 'Mikael Brandvold']) await pick(dialog, name);
        // Mikael is living: protected, no page of his own; the state line says so, the footer counts three.
        await expect(sel.locator('.book-sel-state')).toHaveText(/^4 people · .* · 1 of them without a page of their own \(living people protected\)$/);
        await expect(dialog.locator('.fp-est-d')).toContainText('3 people');
        for (const chip of await sel.locator('.ppm-chip:not(.ppm-chip--more)').all()) {
            const d = await chip.evaluate(el => {
                const c = el.getBoundingClientRect();
                const x = el.querySelector('.ppm-chip-x')!.getBoundingClientRect();
                return Math.abs((x.top + x.bottom) / 2 - (c.top + c.bottom) / 2);
            });
            expect(d).toBeLessThanOrEqual(1.5);
        }
    });
});

test.describe('the dialog\'s selected people on a touch phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the search is 44 px, the chips\' × do not cover the next row; the ancestors\' segment fits with 44 px buttons', async ({ page }) => {
        await setup(page);
        const dialog = await openSelected(page);
        await dialog.locator('.book-kind[data-kind="persons"] .book-kind-sum').click();
        const sel = dialog.locator('.book-sel-persons');
        expect(await height(sel.locator('.ppm-search'))).toBeGreaterThanOrEqual(44);
        for (const name of ['Karl Brandvold', 'Axel Brandvold', 'Rut Hasselgren', 'Viktor Brandvold', 'Dagny Ostrander']) await pick(dialog, name);
        const xs = await sel.locator('.ppm-chip-x').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(b => ({ top: b.top, bottom: b.bottom, left: b.left, right: b.right })));
        const chips = await sel.locator('.ppm-chip').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(b => ({ top: b.top, bottom: b.bottom, left: b.left, right: b.right })));
        expect(new Set(chips.map(c => Math.round(c.top))).size).toBeGreaterThan(1);
        for (const x of xs) {
            expect(x.bottom - x.top).toBeGreaterThanOrEqual(44);
            for (const c of chips) {
                if (c.top <= x.top + 20 && c.bottom >= x.top + 20) continue;
                const meet = x.left < c.right && c.left < x.right && x.top < c.bottom && c.top < x.bottom;
                expect(meet).toBe(false);
            }
        }
        await sel.locator('.book-sub-done').tap();
        await dialog.locator('.book-kind[data-kind="ancestors"]').click();
        await dialog.locator('.book-kind[data-kind="ancestors"] .book-kind-sum').click();
        const seg = dialog.locator('.book-anc-seg');
        await expect(seg.locator('[data-anc-gen="all"]')).toBeVisible();
        const segBox = (await seg.boundingBox())!;
        for (const b of await seg.locator('button:visible').all()) {
            const box = (await b.boundingBox())!;
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.x + box.width).toBeLessThanOrEqual(segBox.x + segBox.width + 0.5);
            expect(await b.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        }
        await noSidewaysScroll(page);
    });
});
