import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * Empty states (round 14, N3): one pattern — serif heading, one sentence of
 * purpose (no italics, no emoji), the primary action when the dialog has one.
 * While the empty state carries that action, the footer copy hides so the
 * dialog still has a single primary button.
 */
async function styleOf(page: import('@playwright/test').Page, root: string) {
    return page.evaluate((sel) => {
        const block = document.querySelector(`${sel} .empty-block`) as HTMLElement;
        const title = block.querySelector('.empty-block-title') as HTMLElement;
        const text = block.querySelector('.empty-block-text') as HTMLElement | null;
        return {
            titleFont: getComputedStyle(title).fontFamily,
            titleSize: getComputedStyle(title).fontSize,
            textStyle: text ? getComputedStyle(text).fontStyle : 'normal',
            titleStyle: getComputedStyle(title).fontStyle,
            emoji: /\p{Extended_Pictographic}/u.test(block.textContent || ''),
        };
    }, root);
}

test('sources: empty state with its own Add source, footer hidden meanwhile', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    const modal = page.locator('#sources-modal');
    await expect(modal.locator('.empty-block-title')).toHaveText('No sources yet');
    await expect(modal.locator('.empty-block-text')).toContainText('register, document or book');
    const st = await styleOf(page, '#sources-modal');
    expect(st.titleFont).toMatch(/Serif|Georgia/);
    expect(st.titleSize).toBe('17px');
    expect(st.textStyle).toBe('normal');
    expect(st.titleStyle).toBe('normal');
    expect(st.emoji).toBe(false);

    // Exactly one visible "Add source" — the empty state's.
    await expect(modal.getByRole('button', { name: 'Add source' })).toHaveCount(1);
    await expect(modal.locator('.sources-footer')).toBeHidden();
    await modal.getByRole('button', { name: 'Add source' }).click();
    await expect(page.locator('#source-editor-modal')).toHaveClass(/active/);
});

test('backups: empty state, then the list with relative times and no small sizes', async ({ page }) => {
    await openApp(page);
    // A fresh app: no backups yet.
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    const modal = page.locator('#snapshots-modal');
    const rows = modal.locator('.snapshot-row');
    await expect(modal.locator('.empty-block-title')).toHaveText('No backups yet');
    await expect(modal.locator('.snapshots-footer')).toBeHidden();
    await expect(modal.getByRole('button', { name: 'Create backup now' })).toHaveCount(1);
    await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());

    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    await modal.getByRole('button', { name: 'Create backup now' }).first().click();
    await expect(rows.first()).toBeVisible();
    await expect(modal.locator('.snapshots-footer')).toBeVisible();
    // "today 14:36" — no seconds, no kB for a tiny tree.
    await expect(rows.first().locator('.snapshot-date')).toHaveText(/^today \d{1,2}:\d{2}(\s[AP]M)?$/);
    await expect(rows.first().locator('.snapshot-meta')).not.toContainText(/kB|KB| B$/);
    await expect(modal.locator('.snapshots-total')).toHaveText(/^\d+ backups?$/);
    // The storage note is a plain hint — no colored side bar.
    const border = await modal.locator('.snapshots-note').evaluate(el => getComputedStyle(el).borderLeftWidth);
    expect(border).toBe('0px');
    // Icon-only delete says what it does.
    await expect(rows.first().locator('.snapshot-delete')).toHaveAttribute('aria-label', 'Delete backup');
});

test('anniversaries: empty state without italics', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showAnniversariesDialog());
    const modal = page.locator('#anniversaries-modal');
    await expect(modal.locator('.empty-block-title')).toBeVisible();
    const st = await styleOf(page, '#anniversaries-modal');
    expect(st.textStyle).toBe('normal');
    expect(st.emoji).toBe(false);
});
