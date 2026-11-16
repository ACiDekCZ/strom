import { test, expect, Page } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * The Table view's Sources rows (spec 073 §14.2): the Rows switch gets
 * Sources with its count; the Unread chip; the web address is a link ↗ into
 * a new window; Open source opens the source itself (its viewer), Edit its
 * editor, and closed the table is where it was; a locked tree shows the
 * source only. A tree without sources shows its empty state. On a phone the
 * type sheet and the row's sheet.
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
const head = (page: Page, id: string) => page.locator(`#table-container .tv-headrow [data-col="${id}"]`);

/** The cell of a row in the column with this id (found by its head's column index). */
async function cellIn(page: Page, key: string, id: string) {
    const index = await head(page, id).getAttribute('aria-colindex');
    expect(index).not.toBeNull();
    return col(page, key, Number(index));
}

async function headOrder(page: Page): Promise<string[]> {
    return page.locator('#table-container .tv-headrow .tv-headcell').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
}

async function openTable(page: Page, phone = false, sources: Record<string, unknown> = SOURCES): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await page.evaluate(async ({ persons, partnerships, sources }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, sources } as never, 'Želvíř');
        await window.Strom.TreeRenderer.setFocus('c' as never);
    }, { persons: PERSONS, partnerships: PARTNERSHIPS, sources });
    await expect(card(page, 'Kvido')).toBeVisible();
    if (phone) {
        await page.locator('#bb-view-table').tap();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(status(page)).toHaveText('3 of 3 people');
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Sources segment, the Unread chip, the link into a new window, Open source shows the source, Edit its editor', async ({ page }) => {
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
        // The default columns (spec 075 U3 §3): where the entry stands field by field; read and transcript only in the panel.
        expect(await headOrder(page)).toEqual(['srcTitle', 'srcRepo', 'srcSig', 'srcFolio', 'srcImageNo', 'srcRef', 'srcUrl', 'srcPersons', 'srcFacts']);
        // People and facts.
        await expect(await cellIn(page, 's:s1', 'srcPersons')).toHaveText('3');
        await expect(await cellIn(page, 's:s1', 'srcFacts')).toHaveText('3');
        // The readers' pill, its column shown from the panel.
        await page.locator('#table-container .tv-cols-btn').click();
        const panel = page.getByRole('dialog', { name: 'Columns' });
        await panel.locator('.tv-cp-q').fill('Read by');
        await panel.getByRole('checkbox', { name: 'Read by the research', exact: true }).check();
        await page.keyboard.press('Escape');
        await expect((await cellIn(page, 's:s1', 'srcRead')).locator('.fact-status .fs-dots i.on')).toHaveCount(2);
        await expect(await cellIn(page, 's:s1', 'srcRead')).toContainText('2 readers');
        await expect(await cellIn(page, 's:s3', 'srcRead')).toHaveText('no');

        // The web address: a link ↗ into a new window.
        const link = (await cellIn(page, 's:s2', 'srcUrl')).locator('a.tv-link');
        await expect(link).toHaveAttribute('href', 'https://example.org/soupis');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(link).toContainText('example.org/soupis ↗');
        await expect((await cellIn(page, 's:s3', 'srcUrl')).locator('a')).toHaveCount(0);

        // Unread: the source no research read.
        await page.locator('#table-container .tv-chips .tv-chip[data-chip="srcUnread"]').click();
        await expect(status(page)).toHaveText('1 of 3 sources');
        await expect(page.locator('#table-container .tv-body .tv-row')).toHaveAttribute('data-key', 's:s3');
        await page.locator('#table-container .tv-chips .tv-chip[data-chip="srcUnread"]').click();
        await expect(status(page)).toHaveText('3 of 3 sources');

        // Open source: the source itself (its viewer, Edit in it); no "Show in tree" on a source.
        await col(page, 's:s2', 2).click();
        await expect(row(page, 's:s2').locator('.tv-act')).toHaveCount(2);
        await expect(row(page, 's:s2').locator('.tv-act[data-act="tree"]')).toHaveCount(0);
        await row(page, 's:s2').locator('.tv-act[data-act="open"]').click();
        const viewer = page.locator('#source-viewer-modal');
        await expect(viewer).toHaveClass(/active/);
        await expect(viewer.locator('#source-viewer-title')).toHaveText('Soupis obyvatel Horní Lhotka');
        await expect(viewer.locator('#source-viewer-edit')).toBeVisible();
        await expect(page.locator('#sources-modal')).not.toHaveClass(/active/);
        // Closed: back in the table, the same row selected and its cell focused.
        await page.keyboard.press('Escape');
        await expect(viewer).not.toHaveClass(/active/);
        await expect(row(page, 's:s2')).toHaveAttribute('aria-selected', 'true');
        await expect(col(page, 's:s2', 2)).toBeFocused();

        // Edit (double click): straight the source's editor, the form of the manager's Edit.
        await col(page, 's:s3', 3).dblclick();
        const editor = page.locator('#source-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await expect(editor.locator('#source-editor-title')).toHaveText('Edit source');
        await expect(editor.locator('#input-source-title')).toHaveValue('Oddací kniha Horní Lhotka');
        await expect(page.locator('#sources-modal')).not.toHaveClass(/active/);
        await expect(viewer).not.toHaveClass(/active/);

        // Saved: back in the table, the row shows it, lit, with "Saved: {title}".
        await editor.locator('#input-source-title').fill('Oddací kniha Dolní Lhotka');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();
        await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
        await expect(col(page, 's:s3', 1)).toContainText('Oddací kniha Dolní Lhotka');
        await expect(page.locator('.toast').filter({ hasText: 'Saved: Oddací kniha Dolní Lhotka' })).toHaveCount(1);
        await expect(row(page, 's:s3')).toHaveAttribute('aria-selected', 'true');
        await expect(col(page, 's:s3', 3)).toBeFocused();
    });

    test('Open source, then Edit in the source: saved, back to the source, then to the table at its place', async ({ page }) => {
        const many: Record<string, unknown> = { ...SOURCES };
        for (let i = 10; i < 70; i++) many[`s${i}`] = { id: `s${i}`, title: `Matrika ${i}` };
        await openTable(page, false, many);
        await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
        await expect(status(page)).toHaveText('63 of 63 sources');
        // A row far down: scrolled to, selected.
        const body = page.locator('#table-container .tv-grid');
        await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
        // The last rows by title: … Matrika 69, Oddací kniha, Soupis obyvatel.
        await expect(row(page, 's:s2')).toBeVisible();
        const key = 's:s60';
        await row(page, key).locator('[aria-colindex="2"]').click();
        await expect(row(page, key)).toHaveAttribute('aria-selected', 'true');
        const top = await body.evaluate(el => el.scrollTop);
        expect(top).toBeGreaterThan(0);

        await row(page, key).locator('.tv-act[data-act="open"]').click();
        const viewer = page.locator('#source-viewer-modal');
        await expect(viewer).toHaveClass(/active/);
        await viewer.locator('#source-viewer-edit').click();
        const editor = page.locator('#source-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await editor.locator('#input-source-repository').fill('Archiv Fiktivní');
        await editor.getByRole('button', { name: 'Save' }).click();
        // Back to the source (refreshed), then Escape: the table where it was.
        await expect(viewer).toHaveClass(/active/);
        await expect(viewer).toContainText('Archiv Fiktivní');
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
        await expect(row(page, key)).toHaveAttribute('aria-selected', 'true');
        await expect(row(page, key).locator('[aria-colindex="2"]')).toBeFocused();
        expect(Math.abs(await body.evaluate(el => el.scrollTop) - top)).toBeLessThanOrEqual(2);
        await expect(await cellIn(page, key, 'srcRepo')).toHaveText('Archiv Fiktivní');
    });

    test('a locked tree: Open source and Edit show the source only, no editor', async ({ page }) => {
        await openTable(page);
        await page.evaluate(() => window.Strom.UI.toggleTreeLock(window.Strom.DataManager.getCurrentTreeId()!));
        await expect(page.locator('body')).toHaveClass(/tree-locked/);
        await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
        await expect(status(page)).toHaveText('3 of 3 sources');
        const viewer = page.locator('#source-viewer-modal');
        const editor = page.locator('#source-editor-modal');

        await col(page, 's:s1', 2).click();
        await row(page, 's:s1').locator('.tv-act[data-act="open"]').click();
        await expect(viewer).toHaveClass(/active/);
        await expect(viewer.locator('#source-viewer-title')).toHaveText('Kniha narozených Horní Lhotka');
        await expect(viewer.locator('#source-viewer-edit')).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(viewer).not.toHaveClass(/active/);

        await col(page, 's:s3', 3).dblclick();
        await expect(viewer).toHaveClass(/active/);
        await expect(viewer.locator('#source-viewer-title')).toHaveText('Oddací kniha Horní Lhotka');
        await expect(viewer.locator('#source-viewer-edit')).toBeHidden();
        await expect(editor).not.toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await expect(viewer).not.toHaveClass(/active/);
        await expect(col(page, 's:s3', 3)).toBeFocused();
    });

    test('Online: web addresses written without "https://" pass the chip, as the Online column links them (T54)', async ({ page }) => {
        await openTable(page, false, {
            s1: { id: 's1', title: 'Matrika Horní Lhotka', repository: 'Archiv Fiktivní', reference: 'Kniha 98', url: 'www.example.org/lhotka' },
            s2: { id: 's2', title: 'Matrika Dolní Lhotka', repository: 'Archiv Druhý', reference: '234567', url: 'www.example.net' },
            s3: { id: 's3', title: 'Oddací kniha Horní Lhotka', reference: 'str. 4' },
        });
        await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
        await expect(status(page)).toHaveText('3 of 3 sources');
        await expect((await cellIn(page, 's:s1', 'srcUrl')).locator('a.tv-link')).toHaveAttribute('href', 'https://www.example.org/lhotka');
        await expect((await cellIn(page, 's:s2', 'srcUrl')).locator('a.tv-link')).toHaveAttribute('href', 'https://www.example.net/');
        const chip = page.locator('#table-container .tv-chips .tv-chip[data-chip="srcOnline"]');
        await chip.click();
        await expect(status(page)).toHaveText('2 of 3 sources');
        await expect(page.locator('#table-container .tv-body .tv-row')).toHaveCount(2);
        await expect(row(page, 's:s3')).toHaveCount(0);
        await expect(page.locator('#table-container .tv-empty')).toBeHidden();
    });

    test('where the entry stands in columns of its own: natural sort of the images, an older source only its location, German heads whole (spec 075 U3 §3)', async ({ page }) => {
        const A = 'Zemský archiv Vzorov';
        await openTable(page, false, {
            s1: { id: 's1', title: 'Křest – Karel Vzorek, 1852', repository: A, callNumber: 'N 7', folio: 'fol. 2', image: '9', reference: 'č. 8, sloupec 2' },
            s2: { id: 's2', title: 'Křest – Josefa Vzorková, 1850', repository: A, callNumber: 'N 7', folio: 'fol. 3r', image: '10', reference: 'č. 3' },
            s3: { id: 's3', title: 'Oddací matrika Pokusov 1820–1835', repository: A, reference: 'N 9, fol. 44v, sn. 102' },
            s4: { id: 's4', title: 'Taufe – Johanna Mustermannová', repository: A, folio: 'S. 15', image: '57–58' },
            s5: { id: 's5', title: 'Křest – Anna Vzorková, 1834', repository: A, callNumber: 'N 7', folio: 'fol. 12v', image: '34', reference: 'č. 5' },
        });
        await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
        await expect(status(page)).toHaveText('5 of 5 sources');
        expect(await headOrder(page)).toEqual(['srcTitle', 'srcRepo', 'srcSig', 'srcFolio', 'srcImageNo', 'srcRef', 'srcUrl', 'srcPersons', 'srcFacts']);
        await expect(head(page, 'srcImageNo')).toHaveText(/^Image/);
        await expect(head(page, 'srcRef')).toHaveText(/^Other location/);
        const texts = async (id: string) => {
            const index = await head(page, id).getAttribute('aria-colindex');
            return page.locator(`#table-container .tv-body .tv-row [aria-colindex="${index}"]`).allInnerTexts();
        };
        expect(await texts('srcSig')).toEqual(['N 7', 'N 7', 'N 7', '', '']);
        // An older source: its whole location as the other location, call number, folio and image empty.
        await expect(await cellIn(page, 's:s3', 'srcRef')).toHaveText('N 9, fol. 44v, sn. 102');
        await expect(await cellIn(page, 's:s3', 'srcFolio')).toHaveText('');

        // Sorted by the image: 9 before 10, 57–58 after 34, the older source last both ways.
        await head(page, 'srcImageNo').click();
        await expect(page.locator('#table-container .tv-status-sort')).toHaveText('Sort: Image ↑');
        expect((await texts('srcImageNo')).map(t => t.trim())).toEqual(['9', '10', '34', '57–58', '']);
        await head(page, 'srcImageNo').click();
        await expect(page.locator('#table-container .tv-status-sort')).toHaveText('Sort: Image ↓');
        expect((await texts('srcImageNo')).map(t => t.trim())).toEqual(['57–58', '34', '10', '9', '']);

        // German: the heads whole on one line, nothing cut.
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await expect(head(page, 'srcRef')).toHaveText(/^Weitere Fundstelle/);
        // The heads may be drawn again after the language change, so a measurement
        // of a head that has just left the page (no style) is taken again.
        for (const id of ['srcRepo', 'srcSig', 'srcFolio', 'srcImageNo', 'srcRef']) {
            await expect.poll(() => head(page, id).locator('.tv-cell-text').evaluate(el => {
                if (!el.isConnected) return null;
                const cs = getComputedStyle(el);
                // "normal" line height has no number; the font's usual 1.2 stands in.
                const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
                return { clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight + 1, lines: Math.round(el.getBoundingClientRect().height / line) };
            }).catch(() => null), { message: id }).toEqual({ clipped: false, lines: 1 });
        }
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
        // The source itself, on top: the row's sheet gone, nothing of it hidden under the table.
        const viewer = page.locator('#source-viewer-modal');
        await expect(viewer).toHaveClass(/active/);
        await expect(sheet).toBeHidden();
        await expect(viewer.locator('#source-viewer-title')).toHaveText('Soupis obyvatel Horní Lhotka');
        const onTop = (sel: string) => page.evaluate((sel) => {
            const box = document.querySelector(`${sel} .modal`)?.getBoundingClientRect()
                ?? document.querySelector(sel)!.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 40));
            return !!hit && !!hit.closest(sel);
        }, sel);
        expect(await onTop('#source-viewer-modal')).toBe(true);
        await page.keyboard.press('Escape');
        await expect(viewer).not.toHaveClass(/active/);

        // Edit…: straight the source's editor, on top.
        await col(page, 's:s2', 1).tap();
        await expect(sheet).toBeVisible();
        await items.nth(1).tap();
        const editor = page.locator('#source-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await expect(sheet).toBeHidden();
        await expect(editor.locator('#input-source-title')).toHaveValue('Soupis obyvatel Horní Lhotka');
        expect(await onTop('#source-editor-modal')).toBe(true);
        await page.keyboard.press('Escape');
        await expect(editor).not.toHaveClass(/active/);
        await expect(page.locator('#sources-modal')).not.toHaveClass(/active/);

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
