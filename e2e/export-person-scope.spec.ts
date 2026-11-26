import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Export's scope "Person's family tree…" (spec 093 §10): the person in focus
 * and the depth of the ancestors' families; every format takes that cut of
 * the tree, the whole gift package is one click away, and "Current view only"
 * offers every format too. The book and the pages take a person's family tree
 * as their choice.
 */

const TODAY = new Date('2026-12-10T10:00:00');

async function sampleOnDaniel(page: Page): Promise<void> {
    await page.clock.setFixedTime(TODAY);
    await openApp(page);
    await page.evaluate(async () => {
        await window.Strom.UI.loadDemoTree();
        await window.Strom.TreeRenderer.setFocus('demo_daniel' as never);
    });
    await expect(card(page, 'Daniel')).toBeVisible();
}

const exportModal = (page: Page) => page.locator('#export-modal');
const peopleIn = (text: string): number => Number(/([\d,]+) (?:person|people)/.exec(text)?.[1].replace(/,/g, '') ?? NaN);

async function gedcomOf(page: Page): Promise<{ name: string; text: string }> {
    await exportModal(page).locator('#export-gedcom-btn').click();
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
    return { name: download.suggestedFilename(), text: readFileSync((await download.path())!, 'utf8') };
}

test('the person scope: the focus, the depth, every format, GEDCOM with the cut only, the whole gift package', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sampleOnDaniel(page);
    const total = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length);

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    const m = exportModal(page);
    await expect(m).toHaveClass(/active/);
    await expect(m.locator('#export-person-pick')).toBeHidden();
    await m.locator('#export-scope-person').click();
    await expect(m.locator('#export-scope-person')).toHaveAttribute('aria-checked', 'true');
    await expect(m.locator('#export-person-pick')).toBeVisible();
    await expect(m.locator('#export-person-btn .export-person-name')).toHaveText('Daniel Berg');
    await expect(m.locator('#export-person-from')).toHaveText('Relationships and generations in the output are counted from Daniel Berg.');
    await expect(m.locator('#export-person-depth')).toHaveValue('2');

    // Every format takes the cut; each says so.
    for (const b of await m.locator('.menu-option[data-person-ok]').all()) await expect(b).toBeEnabled();
    await expect(m.locator('#export-gedcom-btn .option-desc:visible')).toHaveText('The people of the family tree and the families between them');

    // The depth narrows the cut; the count follows.
    const deep = peopleIn(await m.locator('#export-person-count').innerText());
    await m.locator('#export-person-depth').selectOption('0');
    const shallow = peopleIn(await m.locator('#export-person-count').innerText());
    expect(shallow).toBeGreaterThan(1);
    expect(shallow).toBeLessThanOrEqual(deep);
    expect(deep).toBeLessThan(total);

    // GEDCOM: only the cut's people, named after the person.
    const ged = await gedcomOf(page);
    expect(ged.name).toMatch(/-daniel-berg\.ged$/i);
    expect((ged.text.match(/^0 @[^@]+@ INDI/gm) ?? []).length).toBe(shallow);
    expect(ged.text).toContain('Daniel');

    // The whole gift package: the guide for the person, the Export dialog closed.
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await expect(m.locator('#export-scope-person')).toHaveAttribute('aria-checked', 'true');
    await m.locator('#export-person-full').click();
    await expect(m).not.toHaveClass(/active/);
    const guide = page.locator('#gift-modal');
    await expect(guide).toHaveClass(/active/);
    await expect(guide.locator('.gift-prow .gift-pname').first()).toHaveText('Daniel Berg');
    await page.evaluate(() => window.Strom.UI.closeGiftTree());

    // The family book: the tile Person's family tree with the person and the depth.
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await m.locator('.menu-option[onclick*="bookFromExportDialog(\'book\')"]').click();
    const book = page.locator('#book-modal');
    await expect(book).toBeVisible();
    await expect(book.locator('.book-kind[data-kind="gift"]')).toHaveClass(/is-on/);
    await expect(book.locator('.book-kind[data-kind="gift"] .book-kind-t')).toHaveText('Person’s family tree');
    await expect(book.locator('.book-kind[data-kind="gift"] .book-sum-v')).toContainText('Daniel Berg');
    await expect(book.locator('.book-kind[data-kind="persons"]')).toHaveCount(0);
});

test('Current view only: every format; the book of the view\'s people', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sampleOnDaniel(page);
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    const m = exportModal(page);
    await m.locator('#export-scope-view').click();
    await expect(m.locator('#export-scope-view')).toHaveAttribute('aria-checked', 'true');
    for (const b of await m.locator('.menu-option[data-view-ok]').all()) await expect(b).toBeEnabled();
    // Only Save to file (the whole tree's file) stays out.
    await expect(m.locator('.menu-option[data-view-ok] .option-scope-note:visible')).toHaveCount(0);
    await m.locator('.menu-option[onclick*="bookFromExportDialog(\'book\')"]').click();
    const book = page.locator('#book-modal');
    await expect(book).toBeVisible();
    await expect(book.locator('.book-kind[data-kind="persons"]')).toHaveClass(/is-on/);
    await expect(book.locator('.book-sel-moved')).toBeHidden();
});

test('the book from For the family: the tile Person\'s family tree, the depth chosen in it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sampleOnDaniel(page);
    await page.evaluate(() => window.Strom.UI.openBookDialog({ kind: 'menu' }));
    const book = page.locator('#book-modal');
    await expect(book).toBeVisible();
    await expect(book.locator('.book-kind[data-kind="persons"]')).toHaveCount(0);
    await book.locator('.book-kind[data-kind="gift"] .book-kind-t').click();
    await expect(book.locator('.book-kind[data-kind="gift"]')).toHaveClass(/is-on/);
    const line = book.locator('.book-gift-line');
    await expect(line).toBeVisible();
    await expect(book.locator('.book-gens')).toBeHidden();
    await expect(book.locator('.book-person-name')).toHaveText(/^Daniel Berg/);
    const n = async () => peopleIn(`· ${await book.locator('.book-gift-n').innerText()}`);
    const at2 = await n();
    await book.locator('#book-gift-depth').selectOption('all');
    expect(await n()).toBeGreaterThanOrEqual(at2);
    await expect(book.locator('#book-title-input')).toHaveValue(/Family tree of Daniel Berg|^$/);
});

test('on a phone: the scope as a grid, the person row fits', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sampleOnDaniel(page);
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    const m = exportModal(page);
    await m.locator('#export-scope-person').click();
    await expect(m.locator('#export-person-pick')).toBeVisible();
    const boxes = await m.locator('#export-scope .segment-btn:visible').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height, right: r.right })));
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const b of boxes) { expect(b.h).toBeGreaterThanOrEqual(44); expect(b.right).toBeLessThanOrEqual(390); }
    expect(new Set(boxes.map(b => Math.round(b.y))).size).toBeGreaterThan(1);
    const over = await m.locator('#export-person-pick').evaluate(el => el.scrollWidth - el.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
