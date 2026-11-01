/**
 * The family pages' saved file (spec 026 §0.2, §0.5, §8): built from the
 * fictional sample tree and opened as a file — the introduction without a
 * hash, a link shows its page alone, the browser's Back goes page by page,
 * an anchor inside a person page lands, without the script the contents of
 * the file and every page under the other, no sideways scrolling at 390 px,
 * the system's dark scheme and print of the shown page only.
 * Invented names only.
 */

import { test, expect, Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPageSet, PageSet } from '../src/family-pages';
import { buildPageSetHtml } from '../src/family-pages-html';
import { buildLineages, rods } from '../src/lineage';
import { familyPagesFixture, FP_NOW } from '../src/__tests__/helpers/family-pages-fixture';

const dir = mkdtempSync(join(tmpdir(), 'strom-family-pages-'));

function saveSet(name: string, set: PageSet): string {
    const file = join(dir, name);
    writeFileSync(file, buildPageSetHtml(set), 'utf-8');
    return pathToFileURL(file).href;
}

const { data, ids } = familyPagesFixture();
const rodIds = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
const set = buildPageSet(data, { kind: 'rods', rods: rodIds }, { lang: 'cs', now: FP_NOW });
const url = saveSet('Rody.html', set);
const josef = set.personSlug.get(ids.josef)!;
const rodFisek = set.rodSlug.get(rodIds[0])!;

/** Slugs of the sections on the screen. */
async function shown(page: Page): Promise<string[]> {
    return page.locator('section.sp-page').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.id));
}

test.describe('family pages file', () => {
    test('the introduction without a hash; a link shows its page alone; Back goes page by page; the title follows', async ({ page }) => {
        await page.goto(url);
        await expect.poll(() => shown(page)).toEqual(['uvod']);
        await expect(page).toHaveTitle('Rody Fíšek, Řepík a Kvapil');
        await expect(page.locator('nav.sp-toc-file')).toBeHidden();
        await page.locator(`#uvod a.sp-card[href="#${rodFisek}"]`).click();
        await expect.poll(() => shown(page)).toEqual([rodFisek]);
        await expect(page).toHaveTitle('Rod Fíšek');
        // The children of a union start folded with the script.
        expect(await page.locator(`#${rodFisek} details.sp-kids[open]`).count()).toBe(0);
        // Deep in the lineage, a person's link: the page from its top.
        const link = page.locator(`#${rodFisek} .sp-row-main a.pp-link[href="#${josef}"]`).first();
        await link.scrollIntoViewIfNeeded();
        await link.click();
        await expect.poll(() => shown(page)).toEqual([josef]);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        await page.goBack();
        await expect.poll(() => shown(page)).toEqual([rodFisek]);
        await page.goBack();
        await expect.poll(() => shown(page)).toEqual(['uvod']);
        expect(new URL(page.url()).hash).toBe('');
    });

    test('an anchor inside a person page opens the page and lands on it; an unknown hash is the introduction', async ({ page }) => {
        await page.goto(`${url}#${josef}--pp-sec-family`);
        await expect.poll(() => shown(page)).toEqual([josef]);
        await expect(page.locator(`[id="${josef}--pp-sec-family"]`)).toBeInViewport();
        await page.goto(`${url}#nothing-here`);
        await expect.poll(() => shown(page)).toEqual(['uvod']);
    });

    test('without the script: the contents of the file first, every page under the other, the folds open', async ({ browser }) => {
        const ctx = await browser.newContext({ javaScriptEnabled: false });
        const page = await ctx.newPage();
        await page.goto(url);
        await expect(page.locator('nav.sp-toc-file')).toBeVisible();
        await expect(page.locator(`nav.sp-toc-file a[href="#${josef}"]`)).toBeVisible();
        const all = await page.locator('section.sp-page').count();
        expect((await shown(page)).length).toBe(all);
        expect(await page.locator(`#${rodFisek} details.sp-kids:not([open])`).count()).toBe(0);
        await ctx.close();
    });

    test('a phone at 390 px: no sideways scrolling on the hub, a lineage and a person; the breadcrumb is "‹ the page above"', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        for (const slug of ['', rodFisek, josef]) {
            await page.goto(slug ? `${url}#${slug}` : url);
            await expect.poll(() => shown(page)).toEqual([slug || 'uvod']);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        }
        const crumbs = page.locator(`#${josef} nav.sp-crumbs`);
        await expect(crumbs.locator('.sp-crumb-back')).toBeVisible();
        await expect(crumbs.locator('[aria-current]')).toBeHidden();
    });

    test('the system\'s dark scheme darkens the paper; print shows the current page only, without breadcrumbs, with the file\'s footer', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(`${url}#${rodFisek}`);
        await expect.poll(() => shown(page)).toEqual([rodFisek]);
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(44, 42, 36)');
        await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
        expect(await shown(page)).toEqual([rodFisek]);
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
        await expect(page.locator(`#${rodFisek} nav.sp-crumbs`)).toBeHidden();
        await expect(page.locator('.sp-print-foot')).toBeVisible();
        await expect(page.locator('.sp-print-foot')).toHaveText('Rody-Fisek-Repik-Kvapil.html · vytištěna jen tato stránka');
    });
});
