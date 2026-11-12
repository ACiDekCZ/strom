import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * The Table view's findings on the cells (spec 073 §7): computed after the
 * table is drawn, a finding's cell tinted with its mark, its bubble with
 * "Not an error" (the cell then unusual ☆, a toast with Undo) and "Data
 * quality ›" (the dialog open on that finding, warnings named "to check"),
 * the legend of the marks; on a phone the bubble is a sheet.
 */

const FAMILY: Record<string, SeedPerson> = {
    // Death recorded before the birth: an error on the dates and the age at death.
    g: { firstName: 'Garrick', lastName: 'Wrenhallow', birthDate: '1900-04-02', deathDate: '1890-01-05' },
    // Orla was 15 at Fenwick's birth: to check (Data quality only; Mother's age is not in the default columns).
    o: { firstName: 'Orla', lastName: 'Wrenhallow', gender: 'female', birthDate: '1880-03-01' },
    f: { firstName: 'Fenwick', lastName: 'Wrenhallow', birthDate: '1895-06-01', parents: ['o'] },
};

/** Fenwick married twice, so his unions are sub-rows under his row. */
const TWICE: Record<string, SeedPerson> = {
    ...FAMILY,
    f: { ...FAMILY.f, partners: ['i', 'q'] },
    i: { firstName: 'Isaura', lastName: 'Ťygvald', gender: 'female', birthDate: '1897-02-01', partners: ['f'] },
    q: { firstName: 'Quijany', lastName: 'Žopygra', gender: 'female', birthDate: '1899-09-01', partners: ['f'] },
};

const row = (page: Page, key: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${key}"]`);

/** A body cell of a row by its column's id (its position in the head). */
async function cell(page: Page, key: string, colId: string) {
    const head = page.locator('#table-container .tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return row(page, key).locator(`[aria-colindex="${index}"]`);
}

async function openTable(page: Page, phone = false, family = FAMILY): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, family, 'Wrenhallow', 'f');
    if (phone) {
        await page.locator('#bb-view-table').tap();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(page.locator('#table-container .tv-grid')).toBeVisible();
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a finding on its cells, its bubble, Not an error and Undo, Data quality', async ({ page }) => {
        await openTable(page);
        const findings = await cell(page, 'p:g', 'nFind');
        // Computed after the first draw: then the count with the mark of the highest level.
        await expect(findings).not.toHaveText('…');
        await expect(findings.locator('.tv-mark--error')).toHaveCount(1);
        await expect(page.locator('#table-container .tv-status-checks')).toBeHidden();
        await expect(await cell(page, 'p:o', 'nFind')).toHaveText(/^\d/);

        const death = await cell(page, 'p:g', 'dDate');
        await expect(death).toHaveClass(/tv-cell--error/);
        await expect(death.locator('.tv-mark--error')).toHaveAttribute('aria-label', 'error: Death date is before birth date');
        await expect(await cell(page, 'p:g', 'bDate')).toHaveClass(/tv-cell--error/);
        await expect(await cell(page, 'p:f', 'bDate')).not.toHaveClass(/has-issue/);

        // The bubble: the level, the finding, Not an error and Data quality.
        await death.click();
        const bubble = page.locator('.tv-bubble--finding');
        await expect(bubble).toBeVisible();
        await expect(bubble.locator('.tv-bub-level')).toHaveText('error');
        await expect(bubble.locator('.tv-bub-msg')).toHaveText('Death date is before birth date');
        await expect(bubble.locator('[data-act="dismiss"]')).toHaveText('Not an error');
        await expect(bubble.locator('[data-act="quality"]')).toHaveText('Data quality ›');
        await expect(row(page, 'p:g')).toHaveAttribute('aria-selected', 'true');
        const box = await bubble.boundingBox();
        expect(Math.round(box!.width)).toBe(310);

        // Escape closes it, the focus back on the cell; Enter opens it again.
        await page.keyboard.press('Escape');
        await expect(bubble).toHaveCount(0);
        await expect(await cell(page, 'p:g', 'dDate')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(bubble).toBeVisible();

        // Not an error: the cell unusual (☆, no tint), out of Findings, a toast with Undo.
        await bubble.locator('[data-act="dismiss"]').click();
        await expect(bubble).toHaveCount(0);
        const marked = await cell(page, 'p:g', 'dDate');
        await expect(marked).toHaveClass(/tv-cell--unusual/);
        await expect(marked).not.toHaveClass(/tv-cell--error/);
        await expect(marked.locator('.tv-mark--unusual')).toHaveText('☆');
        const toast = page.locator('.toast', { hasText: 'Marked: not an error' });
        await expect(toast).toBeVisible();
        await expect(await cell(page, 'p:g', 'nFind')).not.toHaveClass(/tv-cell--error/);

        // Marked: the bubble says so and offers Report again.
        await marked.click();
        await expect(bubble.locator('.tv-bub-level')).toHaveText('Unusual, but checked');
        await expect(bubble.locator('[data-act="restore"]')).toHaveText('Report again');
        await page.keyboard.press('Escape');

        // Undo: reported again.
        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect(await cell(page, 'p:g', 'dDate')).toHaveClass(/tv-cell--error/);

        // Data quality ›: the dialog on this finding's group, warnings named "to check".
        await (await cell(page, 'p:g', 'dDate')).click();
        await bubble.locator('[data-act="quality"]').click();
        const modal = page.locator('#tree-validation-modal');
        await expect(modal).toHaveClass(/active/);
        await expect(modal.locator('.vq-summary-text')).toContainText('1 to check');
        const group = modal.locator('.vq-group[data-type="deathBeforeBirth"] .vq-group-head');
        await expect(group).toHaveAttribute('aria-expanded', 'true');
        await expect(modal.locator('.vq-group[data-type="motherTooYoung16"]')).toContainText('Mother younger than 16 at the birth');
    });

    test('Findings and Highest level open the list of the person\'s findings (T54)', async ({ page }) => {
        await openTable(page);
        const findings = await cell(page, 'p:g', 'nFind');
        await expect(findings).not.toHaveText('…');
        const n = parseInt((await findings.textContent())!, 10);
        expect(n).toBeGreaterThanOrEqual(1);
        await expect(findings).toHaveAttribute('aria-haspopup', 'dialog');
        await findings.click();
        const bubble = page.locator('.tv-bubble--finding');
        await expect(bubble).toBeVisible();
        await expect(row(page, 'p:g')).toHaveAttribute('aria-selected', 'true');
        // Each finding with its level, its text and whom it is about; the highest first.
        await expect(bubble.locator('.tv-bub-finding')).toHaveCount(n);
        await expect(bubble.locator('.tv-bub-level').first()).toHaveText('error');
        await expect(bubble.locator('.tv-bub-msg', { hasText: 'Death date is before birth date' })).toHaveCount(1);
        await expect(bubble.locator('.tv-bub-about').first()).toHaveText('Garrick Wrenhallow');
        await page.keyboard.press('Escape');
        await expect(bubble).toHaveCount(0);

        // Highest level by the keyboard; Fenwick's finding names his mother and him.
        await page.locator('#table-container .tv-cols-btn').click();
        const panel = page.getByRole('dialog', { name: 'Columns' });
        await panel.locator('.tv-cp-q').fill('Highest');
        await panel.getByRole('checkbox', { name: 'Highest level' }).check();
        await panel.getByRole('button', { name: 'Done' }).click();
        const top = await cell(page, 'p:f', 'topSev');
        await expect(top).toHaveText(/to check$/);
        await top.click();
        await expect(bubble).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(bubble).toHaveCount(0);
        await expect(await cell(page, 'p:f', 'topSev')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(bubble).toBeVisible();
        const young = bubble.locator('.tv-bub-finding', { hasText: 'Mother younger than 16 at the birth' });
        await expect(young.locator('.tv-bub-about')).toHaveText('Orla Wrenhallow, Fenwick Wrenhallow');
        await expect(young.locator('[data-act="dismiss"]')).toHaveText('Not an error');
    });

    test('a union\'s sub-rows carry no finding of the person (T54)', async ({ page }) => {
        await openTable(page, false, TWICE);
        await page.locator('#table-container .tv-cols-btn').click();
        const panel = page.getByRole('dialog', { name: 'Columns' });
        await panel.locator('.tv-cp-q').fill('Mother');
        await panel.getByRole('checkbox', { name: /^Mother.s age at (the )?birth$/ }).check();
        await panel.getByRole('button', { name: 'Done' }).click();
        await expect(row(page, 'p:f#u2')).toBeVisible();
        const own = await cell(page, 'p:f', 'mAge');
        await expect(own.locator('.tv-mark--warning')).toHaveCount(1);
        await expect(own).toHaveClass(/has-issue/);
        for (const sub of ['p:f#u1', 'p:f#u2']) {
            const c = await cell(page, sub, 'mAge');
            await expect(c.locator('.tv-mark')).toHaveCount(0);
            await expect(c).not.toHaveClass(/has-issue|tv-cell--warning/);
        }
        // No mark anywhere on the sub-rows: the person's findings stay on the person's row.
        await expect(page.locator('#table-container .tv-body .tv-row[data-key^="p:f#u"] .tv-mark')).toHaveCount(0);
    });

    test('the legend of the marks', async ({ page }) => {
        await openTable(page);
        const btn = page.locator('#table-container .tv-legend-btn');
        await expect(btn).toHaveText('Marks ⓘ');
        await btn.click();
        const legend = page.locator('.tv-bubble--legend');
        await expect(legend).toBeVisible();
        await expect(legend.locator('.tv-leg-row')).toHaveCount(9);
        await expect(legend.locator('.tv-leg-name').first()).toHaveText('error');
        await page.keyboard.press('Escape');
        await expect(legend).toHaveCount(0);
        await expect(btn).toBeFocused();
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a tap on a finding opens its sheet', async ({ page }) => {
        await openTable(page, true);
        const findings = await cell(page, 'p:g', 'nFind');
        await expect(findings).not.toHaveText('…');
        const birth = await cell(page, 'p:g', 'bDate');
        await expect(birth).toHaveClass(/tv-cell--error/);
        await birth.tap();
        const sheet = page.locator('.tv-bubble--sheet.tv-bubble--finding');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.tv-bub-sheet-title')).toHaveText('error');
        const dismiss = sheet.locator('[data-act="dismiss"]');
        await expect(dismiss).toHaveText('Not an error');
        expect(Math.round((await dismiss.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        await sheet.locator('.tv-bub-close').tap();
        await expect(sheet).toHaveCount(0);
    });

    test('a tap on Findings opens the sheet of the person\'s findings (T54)', async ({ page }) => {
        await openTable(page, true);
        const findings = await cell(page, 'p:g', 'nFind');
        await expect(findings).not.toHaveText('…');
        await findings.tap();
        const sheet = page.locator('.tv-bubble--sheet.tv-bubble--finding');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.tv-bub-sheet-title')).toHaveText('error');
        await expect(sheet.locator('.tv-bub-about').first()).toHaveText('Garrick Wrenhallow');
        await sheet.locator('.tv-bub-close').tap();
        await expect(sheet).toHaveCount(0);
    });
});
