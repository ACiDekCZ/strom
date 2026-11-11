import { test, expect, Page } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * The Table view's Sources rows (spec 073 §14.2): the Rows switch gets
 * Sources with its count; the Unread chip; the web address is a link ↗ into
 * a new window; Open source and Edit open the sources manager on that
 * source. A tree without sources shows its empty state. On a phone the type
 * sheet and the row's sheet.
 */

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

const PERSONS = {
    a: person('a', 'Radovan', 'Želvíř', { birthDate: '1850-03-01', partnerships: ['u1'], childIds: ['c'], birthSourceIds: ['s1'] }),
    b: person('b', 'Ludmila', 'Krápalová', { gender: 'female', partnerships: ['u1'], childIds: ['c'], sourceIds: ['s2'] }),
    c: person('c', 'Kvido', 'Želvíř', { birthDate: '1880-01-04', parentIds: ['a', 'b'], birthSourceIds: ['s1'] }),
};
const PARTNERSHIPS = { u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: ['c'], status: 'married', sourceIds: ['s1'] } };
const SOURCES = {
    s1: {
        id: 's1', title: 'Kniha narozených Horní Lhotka', repository: 'Archiv Fiktivní', reference: 'fol. 12',
        url: 'https://example.org/kniha/12', readBy: 'both', transcript: 'Text zápisu',
    },
    s2: { id: 's2', title: 'Soupis obyvatel Horní Lhotka', url: 'https://example.org/soupis', readBy: 'research' },
    s3: { id: 's3', title: 'Oddací kniha Horní Lhotka', reference: 'str. 4' },
};

const row = (page: Page, key: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${key}"]`);
const status = (page: Page) => page.locator('#table-container .tv-status-count');
const col = (page: Page, key: string, i: number) => row(page, key).locator(`[aria-colindex="${i}"]`);

async function openTable(page: Page, phone = false, sources: Record<string, unknown> = SOURCES): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await page.evaluate(async ({ persons, partnerships, sources }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, sources } as never, 'Želvíř');
        await window.Strom.TreeRenderer.setFocus('c' as never);
    }, { persons: PERSONS, partnerships: PARTNERSHIPS, sources });
    await expect(card(page, 'Kvido')).toBeVisible();
    if (phone) {
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Table' }).tap();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(status(page)).toHaveText('3 of 3 people');
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Sources segment, the Unread chip, the link into a new window, Open source on that source', async ({ page }) => {
        await openTable(page);
        const seg = page.locator('#table-container .tv-rowtype [data-rowtype="sources"]');
        await expect(seg).toHaveAttribute('aria-label', 'Sources, 3');
        await seg.click();
        await expect(seg).toHaveAttribute('aria-checked', 'true');
        await expect(status(page)).toHaveText('3 of 3 sources');
        // Sorted by title; the title pinned first.
        await expect(page.locator('#table-container .tv-body .tv-row')).toHaveCount(3);
        await expect(page.locator('#table-container .tv-body .tv-row').first()).toHaveAttribute('data-key', 's:s1');
        await expect(col(page, 's:s1', 1)).toContainText('Kniha narozených Horní Lhotka');
        // People and facts; the readers' pill.
        await expect(col(page, 's:s1', 5)).toHaveText('3');
        await expect(col(page, 's:s1', 6)).toHaveText('3');
        await expect(col(page, 's:s1', 7).locator('.fact-status .fs-dots i.on')).toHaveCount(2);
        await expect(col(page, 's:s1', 7)).toContainText('2 readers');
        await expect(col(page, 's:s3', 7)).toHaveText('no');

        // The web address: a link ↗ into a new window.
        const link = col(page, 's:s2', 4).locator('a.tv-link');
        await expect(link).toHaveAttribute('href', 'https://example.org/soupis');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(link).toContainText('example.org/soupis ↗');
        await expect(col(page, 's:s3', 4).locator('a')).toHaveCount(0);

        // Unread: the source no research read.
        await page.locator('#table-container .tv-chips .tv-chip[data-chip="srcUnread"]').click();
        await expect(status(page)).toHaveText('1 of 3 sources');
        await expect(page.locator('#table-container .tv-body .tv-row')).toHaveAttribute('data-key', 's:s3');
        await page.locator('#table-container .tv-chips .tv-chip[data-chip="srcUnread"]').click();
        await expect(status(page)).toHaveText('3 of 3 sources');

        // Open source: the manager on that source; no "Show in tree" on a source.
        await col(page, 's:s2', 2).click();
        await expect(row(page, 's:s2').locator('.tv-act')).toHaveCount(2);
        await expect(row(page, 's:s2').locator('.tv-act[data-act="tree"]')).toHaveCount(0);
        await row(page, 's:s2').locator('.tv-act[data-act="open"]').click();
        const modal = page.locator('#sources-modal');
        await expect(modal).toHaveClass(/active/);
        const target = modal.locator('.source-row.is-target');
        await expect(target).toHaveCount(1);
        await expect(target.locator('.source-title')).toHaveText('Soupis obyvatel Horní Lhotka');
        await expect(target.locator('.source-row-open')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);

        // Edit (double click) opens the same manager on that source.
        await col(page, 's:s3', 3).dblclick();
        await expect(modal).toHaveClass(/active/);
        await expect(modal.locator('.source-row.is-target .source-title')).toHaveText('Oddací kniha Horní Lhotka');

        // A change in the manager: the row shows it, lit, with "Saved: {title}".
        const editor = page.locator('#source-editor-modal');
        await modal.locator('.source-row.is-target .source-edit-btn').click();
        await editor.locator('#input-source-title').fill('Oddací kniha Dolní Lhotka');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);
        await expect(col(page, 's:s3', 1)).toContainText('Oddací kniha Dolní Lhotka');
        // Its toast (it may wait under the manager's own message: one toast shows at a time).
        await expect(page.locator('.toast').filter({ hasText: 'Saved: Oddací kniha Dolní Lhotka' })).toHaveCount(1);
    });

    test('Online: web addresses written without "https://" pass the chip, as the Online column links them (T54)', async ({ page }) => {
        await openTable(page, false, {
            s1: { id: 's1', title: 'Matrika Horní Lhotka', repository: 'Archiv Fiktivní', reference: 'Kniha 98', url: 'www.example.org/lhotka' },
            s2: { id: 's2', title: 'Matrika Dolní Lhotka', repository: 'Archiv Druhý', reference: '234567', url: 'www.example.net' },
            s3: { id: 's3', title: 'Oddací kniha Horní Lhotka', reference: 'str. 4' },
        });
        await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
        await expect(status(page)).toHaveText('3 of 3 sources');
        await expect(col(page, 's:s1', 4).locator('a.tv-link')).toHaveAttribute('href', 'https://www.example.org/lhotka');
        await expect(col(page, 's:s2', 4).locator('a.tv-link')).toHaveAttribute('href', 'https://www.example.net/');
        const chip = page.locator('#table-container .tv-chips .tv-chip[data-chip="srcOnline"]');
        await chip.click();
        await expect(status(page)).toHaveText('2 of 3 sources');
        await expect(page.locator('#table-container .tv-body .tv-row')).toHaveCount(2);
        await expect(row(page, 's:s3')).toHaveCount(0);
        await expect(page.locator('#table-container .tv-empty')).toBeHidden();
    });

    test('a tree without sources: the empty Sources table', async ({ page }) => {
        await openTable(page, false, {});
        const seg = page.locator('#table-container .tv-rowtype [data-rowtype="sources"]');
        await expect(seg).toHaveAttribute('aria-label', 'Sources, 0');
        await seg.click();
        await expect(page.locator('#table-container')).toHaveAttribute('data-empty', 'noSources');
        await expect(page.locator('#table-container .tv-empty')).toContainText('There is no source in the tree');
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('Sources from the type sheet; a row\'s sheet opens the source; nothing overflows', async ({ page }) => {
        await openTable(page, true);
        await page.locator('#table-container .tv-rowtype-btn').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await sheet.locator('.bottom-sheet-item', { hasText: 'Sources' }).tap();
        await expect(page.locator('#table-container .tv-rowtype-btn')).toHaveText('Sources · 3 ▾');
        await expect(status(page)).toHaveText('3 of 3 sources');

        await col(page, 's:s2', 1).tap();
        await expect(sheet).toBeVisible();
        const items = sheet.locator('.bottom-sheet-item');
        await expect(items.locator('.bottom-sheet-label')).toHaveText(['Open source', 'Edit…']);
        expect((await items.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await items.first().tap();
        const modal = page.locator('#sources-modal');
        await expect(modal).toHaveClass(/active/);
        await expect(modal.locator('.source-row.is-target .source-title')).toHaveText('Soupis obyvatel Horní Lhotka');
        await page.keyboard.press('Escape');

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});

test.describe('phone held sideways (844 × 390)', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('Sources from the type sheet; their quick filters in the Filters sheet; XLSX from ⋯; nothing overflows', async ({ page }) => {
        await openTable(page, true);
        await page.locator('#table-container .tv-rowtype-btn').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await sheet.locator('.bottom-sheet-item', { hasText: 'Sources' }).tap();
        await expect(page.locator('#table-container .tv-rowtype-btn')).toHaveText('Sources · 3 ▾');
        expect(Math.round((await page.locator('#table-container .tv-bar-row1').boundingBox())!.height)).toBe(50);

        // The quick filters of Sources in the sheet.
        await page.locator('#table-container .tv-filters-btn').tap();
        const fs = page.locator('.tv-fsheet');
        await expect(fs.locator('.tv-fs-row:has(.tv-cp-check[data-chip]) .tv-fs-label')).toHaveText(['No person', 'Unread', 'With transcript', 'Online']);
        await fs.locator('.tv-cp-check[data-chip="srcUnread"]').tap();
        await expect(fs.locator('.tv-fs-show')).toHaveText(/^Show 1 source/);
        await fs.locator('.tv-fs-show').tap();
        await expect(status(page)).toHaveText('1 of 3 sources');

        // ⋯: Columns, Export, Coverage row (no unions for Sources); Export with XLSX.
        await page.locator('#table-container .tv-more-menu-btn').tap();
        await expect(sheet.locator('.bottom-sheet-item .bottom-sheet-label')).toHaveText(['Columns', 'Export', 'Coverage row']);
        await sheet.locator('.bottom-sheet-item', { hasText: 'Export' }).tap();
        const xs = page.locator('.tv-fsheet.tv-xpanel');
        await expect(xs).toBeVisible();
        await xs.locator('.tv-xopt-pick').nth(1).tap();
        await expect(xs.locator('.tv-fs-apply')).toHaveText('Download XLSX');
        await expect(xs.locator('.tv-xfile')).toContainText('.xlsx');
        const box = (await xs.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(844);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
});
