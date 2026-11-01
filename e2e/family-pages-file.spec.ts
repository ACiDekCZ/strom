/**
 * The family pages' saved file (spec 026 §0.2, §0.5, §8): built from the
 * fictional sample tree and opened as a file — the introduction without a
 * hash, a link shows its page alone, the browser's Back goes page by page,
 * an anchor inside a person page lands, without the script the contents of
 * the file and every page under the other, no sideways scrolling at 390 px,
 * the system's dark scheme and print of the shown page only; a family's page
 * (spec 026 §2): the person page's card, the other marriage and back, a
 * child's card to the child's family, no page and no names for a couple of
 * two protected living, the partners' cards under each other on a phone and
 * beside each other on a phone held sideways, the dark scheme; families as a
 * section only: no family page, the blocks on the person's page.
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

const { data, ids, unions } = familyPagesFixture();
const rodIds = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
const set = buildPageSet(data, { kind: 'rods', rods: rodIds }, { lang: 'cs', now: FP_NOW });
const url = saveSet('Rody.html', set);
const josef = set.personSlug.get(ids.josef)!;
const rodFisek = set.rodSlug.get(rodIds[0])!;
const f9 = set.familySlug.get(unions.f9)!;
const f10 = set.familySlug.get(unions.f10)!;
/** Jan (1847) and Rosálie: the family of Josef and Anna's eldest son. */
const janRosalie = set.familySlug.get(Object.values(data.partnerships).find(u => u.person1Id === 'jan1847')!.id)!;

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

/** The partners' cards of a family's page: their boxes. */
async function partnerBoxes(page: Page, slug: string): Promise<{ x: number; y: number; w: number; h: number }[]> {
    return page.locator(`#${slug} .sp-partner`).evaluateAll(els => els.map(e => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    }));
}

test.describe('family pages file: a family\'s page', () => {
    test('the person page\'s card opens the family; the other marriage and back; a child\'s card leads to the child\'s family', async ({ page }) => {
        await page.goto(`${url}#${josef}`);
        await expect.poll(() => shown(page)).toEqual([josef]);
        await page.locator(`#${josef} a.sp-famcard[href="#${f9}"]`).click();
        await expect.poll(() => shown(page)).toEqual([f9]);
        await expect(page).toHaveTitle('Josef Fíšek a Anna Kvapilová');
        await expect(page.locator(`#${f9} .sp-h1`)).toHaveText('Josef Fíšek ⚭ Anna Kvapilová');
        await expect(page.locator(`#${f9} .sp-partner`)).toHaveCount(2);
        await expect(page.locator(`#${f9} .sp-kid`)).toHaveCount(7);
        // Josef's second marriage and back.
        await page.locator(`#${f9} .sp-other a.pp-link[href="#${f10}"]`).click();
        await expect.poll(() => shown(page)).toEqual([f10]);
        await expect(page.locator(`#${f10} .sp-h1`)).toHaveText('Josef Fíšek ⚭ Terezie Lhotáková');
        await page.locator(`#${f10} .sp-other a.pp-link[href="#${f9}"]`).click();
        await expect.poll(() => shown(page)).toEqual([f9]);
        // The eldest son's card: his own family.
        const note = page.locator(`#${f9} .sp-kid-note a.pp-link[href="#${janRosalie}"]`);
        await expect(note).toHaveText('→ rodina Jan a Rosálie');
        await note.click();
        await expect.poll(() => shown(page)).toEqual([janRosalie]);
        await expect(page.locator(`#${janRosalie} .sp-h1`)).toHaveText('Jan Fíšek ⚭ Rosálie Hrabánková');
        await page.goBack();
        await expect.poll(() => shown(page)).toEqual([f9]);
    });

    test('a couple of two protected living: no page, no link to one and no names in the file', async ({ page }) => {
        expect(set.familySlug.has(unions.f24)).toBe(false);
        await page.goto(url);
        await expect.poll(() => shown(page)).toEqual(['uvod']);
        const text = await page.evaluate(() => document.body.textContent ?? '');
        expect(text).not.toMatch(/\bEva\b/);
        expect(text).not.toContain('Petr Řepík');
        // Jaroslav and Jana's page: Eva only under the protected name, without a link.
        const jj = set.familySlug.get(unions.jaroslavJana)!;
        await page.goto(`${url}#${jj}`);
        await expect.poll(() => shown(page)).toEqual([jj]);
        const kids = page.locator(`#${jj} .sp-kid`);
        await expect(kids).toHaveCount(2);
        await expect(kids.first().locator('a')).toHaveCount(0);
        expect(await page.locator('section.sp-page[id^="rodina-"]').evaluateAll(els => els.filter(e => /Petr|\bEva\b/.test(e.textContent ?? '')).length)).toBe(0);
    });

    test('a phone at 390 px: the partners\' cards under each other, no sideways scrolling', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        for (const slug of [f9, f10]) {
            await page.goto(`${url}#${slug}`);
            await expect.poll(() => shown(page)).toEqual([slug]);
            const [a, b] = await partnerBoxes(page, slug);
            expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
            expect(Math.abs(a.x - b.x)).toBeLessThan(1);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        }
    });

    test('a phone held sideways (844×390): the partners\' cards beside each other, no sideways scrolling', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        await page.goto(`${url}#${f9}`);
        await expect.poll(() => shown(page)).toEqual([f9]);
        const [a, b] = await partnerBoxes(page, f9);
        expect(Math.abs(a.y - b.y)).toBeLessThan(1);
        expect(b.x).toBeGreaterThanOrEqual(a.x + a.w);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
    });

    test('the system\'s dark scheme: the paper and the tinted child who died young darken', async ({ page }) => {
        const tint = () => page.locator(`#${f9} .sp-kid--young`).first().evaluate(e => getComputedStyle(e).backgroundColor);
        await page.goto(`${url}#${f9}`);
        await expect.poll(() => shown(page)).toEqual([f9]);
        const light = await tint();
        await page.emulateMedia({ colorScheme: 'dark' });
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(44, 42, 36)');
        const dark = await tint();
        expect(dark).not.toBe(light);
        const lum = (c: string) => c.match(/\d+/g)!.slice(0, 3).map(Number).reduce((x, y) => x + y, 0);
        expect(lum(dark)).toBeLessThan(lum(light));
    });

    test('families as a section only: no family page, no link to one; the person\'s page carries the blocks', async ({ page }) => {
        const sectionSet = buildPageSet(data, { kind: 'rods', rods: rodIds }, { lang: 'cs', now: FP_NOW, families: 'section' });
        const sectionUrl = saveSet('Rody-oddil.html', sectionSet);
        const slug = sectionSet.personSlug.get(ids.josef)!;
        await page.goto(`${sectionUrl}#${slug}`);
        await expect.poll(() => shown(page)).toEqual([slug]);
        await expect(page.locator('section.sp-page--family')).toHaveCount(0);
        await expect(page.locator('section.sp-page[id^="rodina-"]')).toHaveCount(0);
        await expect(page.locator('a[href^="#rodina-"]')).toHaveCount(0);
        await expect(page.locator(`#${slug} .sp-famcard`)).toHaveCount(0);
        // The parents and both marriages as blocks of Josef's page.
        await expect(page.locator(`#${slug} .sp-oddil`)).toHaveCount(3);
        await expect(page.locator(`#${slug} .sp-oddil-t`, { hasText: '⚭ 1876 Terezie Lhotáková' })).toBeVisible();
    });
});
