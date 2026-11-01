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

/** Rows of the search's results (names). */
async function results(page: Page): Promise<string[]> {
    return page.locator('#sp-results .sp-res-n').allTextContents();
}

test.describe('family pages file: the bar and the search (§3.1, §3.4)', () => {
    test('a prefix without diacritics, the form Fischek first, a birth surname; the living "eva" finds nothing; Escape brings the page back, the address unchanged', async ({ page }) => {
        await page.goto(`${url}#${rodFisek}`);
        await expect.poll(() => shown(page)).toEqual([rodFisek]);
        await page.evaluate(() => window.scrollTo(0, 400));
        const q = page.locator('.sp-fbar .sp-q');
        await expect(q).toBeVisible();
        await expect(page.locator('.sp-fbar-lupa')).toBeHidden();
        await expect(page.locator('.sp-fbar-nav a', { hasText: 'Rejstřík' })).toBeVisible();
        await expect(page.locator('.sp-fbar-nav a', { hasText: 'Mapa obcí' })).toHaveCount(0);
        await q.fill('fis');
        await expect(page.locator('#sp-results')).toBeVisible();
        await expect.poll(() => shown(page)).toEqual([]);
        expect(await results(page)).toContain('Jan Fíšek');
        expect((await results(page)).length).toBe(10);
        await expect(page.locator('#sp-results .sp-res-more')).toContainText('v rejstříku →');
        await q.fill('josef fisek');
        await expect.poll(() => results(page)).toContain('Josef Fíšek');
        await q.fill('fischek');
        await expect.poll(async () => (await results(page))[0]).toBe('Martin Fischek');
        await q.fill('vrbatkova');
        await expect.poll(() => results(page)).toContain('Terezie Lhotáková');
        await q.fill('eva');
        await expect(page.locator('#sp-results .sp-res-none-t')).toHaveText('Pro „eva“ se nic nenašlo.');
        await expect(page.locator('#sp-results .sp-res-hint')).toContainText('Jména žijících osob jsou chráněná.');
        await expect(page.locator('#sp-results a', { hasText: 'Rejstřík osob →' })).toHaveAttribute('href', '#rejstrik-osoby');
        expect(new URL(page.url()).hash).toBe(`#${rodFisek}`);
        await q.press('Escape');
        await expect(page.locator('#sp-results')).toBeHidden();
        await expect.poll(() => shown(page)).toEqual([rodFisek]);
        await expect(q).toHaveValue('');
        expect(await page.evaluate(() => window.scrollY)).toBe(400);
        expect(new URL(page.url()).hash).toBe(`#${rodFisek}`);
        // A result leads to the person's page and closes the search.
        await q.fill('martin fis');
        await page.locator('#sp-results a.sp-res-n', { hasText: 'Martin Fischek' }).click();
        await expect.poll(() => shown(page)).toEqual([set.personSlug.get('martin' as never)!]);
        await expect(page.locator('#sp-results')).toBeHidden();
        await expect(q).toHaveValue('');
    });

    test('a phone at 390 px: the name, the magnifier and Menu; the magnifier turns the bar into the field, Cancel back; Menu\'s panel leads to an index', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(url);
        const bar = page.locator('.sp-fbar');
        await expect(bar.locator('.sp-fbar-home')).toBeVisible();
        await expect(bar.locator('.sp-q')).toBeHidden();
        await expect(bar.locator('.sp-fbar-nav')).toBeHidden();
        const lupa = bar.locator('.sp-fbar-lupa');
        const box = (await lupa.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        await lupa.click();
        await expect(bar.locator('.sp-q')).toBeVisible();
        await expect(bar.locator('.sp-q')).toBeFocused();
        await expect(bar.locator('.sp-fbar-home')).toBeHidden();
        expect(await bar.locator('.sp-q').evaluate(e => getComputedStyle(e).fontSize)).toBe('16px');
        await bar.locator('.sp-q').fill('kvapil');
        await expect.poll(() => results(page)).toContain('Anna Kvapilová');
        await bar.locator('.sp-fbar-cancel').click();
        await expect(bar.locator('.sp-q')).toBeHidden();
        await expect(bar.locator('.sp-fbar-home')).toBeVisible();
        await expect.poll(() => shown(page)).toEqual(['uvod']);
        // Menu: the panel under the bar, rows of 48 px, no map while it is not drawn.
        const menuBtn = bar.locator('.sp-fbar-menu');
        await menuBtn.click();
        await expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
        const items = bar.locator('.sp-menu .sp-menu-a');
        await expect(items).toHaveText(['Úvod', 'Osoby', 'Rodiny', 'Příjmení', 'Obce']);
        expect((await items.first().boundingBox())!.height).toBeGreaterThanOrEqual(48);
        await expect(items.first()).toHaveAttribute('aria-current', 'page');
        await items.filter({ hasText: 'Obce' }).click();
        await expect.poll(() => shown(page)).toEqual(['rejstrik-obce']);
        await expect(bar.locator('.sp-menu')).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('a phone held sideways (844×390): the magnifier and Menu as on a phone', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        await page.goto(url);
        await expect(page.locator('.sp-fbar-lupa')).toBeVisible();
        await expect(page.locator('.sp-fbar-menu')).toBeVisible();
        await expect(page.locator('.sp-fbar .sp-q')).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('without the script no bar; in print neither the bar nor the results', async ({ browser, page }) => {
        const ctx = await browser.newContext({ javaScriptEnabled: false });
        const noJs = await ctx.newPage();
        await noJs.goto(url);
        await expect(noJs.locator('.sp-fbar')).toBeHidden();
        await ctx.close();
        await page.goto(url);
        await page.locator('.sp-fbar .sp-q').fill('fis');
        await page.emulateMedia({ media: 'print' });
        await expect(page.locator('.sp-fbar')).toBeHidden();
        await expect(page.locator('#sp-results')).toBeHidden();
    });
});

test.describe('family pages file: the indexes (§3.5)', () => {
    test('the tabs; the alphabet filters the people, the address unchanged; places unfold their people; the lineage header\'s place opens its row', async ({ page }) => {
        await page.goto(`${url}#rejstrik-osoby`);
        await expect.poll(() => shown(page)).toEqual(['rejstrik-osoby']);
        await expect(page.locator('.sp-fbar-nav a', { hasText: 'Rejstřík' })).toHaveAttribute('aria-current', 'page');
        const sec = page.locator('#rejstrik-osoby');
        await expect(sec.locator('.sp-tab')).toHaveText(['Osoby', 'Rodiny', 'Příjmení', 'Obce']);
        const groups = sec.locator('.sp-ix-group');
        const all = await groups.count();
        expect(all).toBeGreaterThan(3);
        await sec.locator('.sp-letter', { hasText: /^K$/ }).click();
        await expect(sec.locator('.sp-ix-group:visible')).toHaveCount(1);
        await expect(sec.locator('.sp-ix-group:visible .sp-ix-letter')).toHaveText('K');
        await expect(sec.locator('.sp-letter', { hasText: /^K$/ })).toHaveAttribute('aria-current', 'true');
        expect(new URL(page.url()).hash).toBe('#rejstrik-osoby');
        await sec.locator('.sp-letter', { hasText: 'Vše' }).click();
        await expect(sec.locator('.sp-ix-group:visible')).toHaveCount(all);
        // The protected by the protected name, without a link.
        await expect(sec.locator('.sp-ix-row a', { hasText: 'Eva' })).toHaveCount(0);
        // Families: only those with a page.
        await sec.locator('.sp-tab', { hasText: 'Rodiny' }).click();
        await expect.poll(() => shown(page)).toEqual(['rejstrik-rodiny']);
        await expect(page.locator(`#rejstrik-rodiny a[href="#${f9}"]`)).toHaveCount(1);
        // Places: folded; a row unfolds its people.
        await page.locator('#rejstrik-rodiny .sp-tab', { hasText: 'Obce' }).click();
        const capkov = page.locator('#rejstrik-obce--o-1');
        await expect(capkov.locator('.sp-ix-sum')).toContainText(/Čapkov · \d{4}–\d{4} · \d+ osob/);
        await expect(capkov).not.toHaveAttribute('open', '');
        await capkov.locator('.sp-ix-sum').click();
        await expect(capkov.locator('.sp-ix-sub a', { hasText: 'Josef Fíšek' }).first()).toBeVisible();
        await capkov.locator('.sp-ix-sum').click();
        // From the lineage's header: the places index with the place's row unfolded.
        await page.goto(`${url}#${rodFisek}`);
        await page.locator(`#${rodFisek} a.sp-place`, { hasText: 'Kvasín' }).click();
        await expect.poll(() => shown(page)).toEqual(['rejstrik-obce']);
        const row = page.locator(`#${new URL(page.url()).hash.slice(1)}`);
        await expect(row).toHaveAttribute('open', '');
        await expect(row.locator('.sp-ix-n')).toHaveText('Kvasín');
    });

    test('390 px and the dark scheme: the bar and the index on dark surfaces, no sideways scrolling', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(`${url}#rejstrik-osoby`);
        await expect.poll(() => shown(page)).toEqual(['rejstrik-osoby']);
        const lum = (rgb: string): number => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number); return (r + g + b) / 3; };
        expect(lum(await page.locator('.sp-fbar').evaluate(e => getComputedStyle(e).backgroundColor))).toBeLessThan(80);
        expect(lum(await page.locator('.sp-ix-letter').first().evaluate(e => getComputedStyle(e).color))).toBeGreaterThan(150);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        // The tabs scroll within their row on a narrow screen.
        const tabs = page.locator('#rejstrik-osoby .sp-tabs');
        expect(await tabs.evaluate(e => e.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
    });
});
