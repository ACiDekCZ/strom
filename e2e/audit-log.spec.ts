import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, createFirstPerson, card, addRelation } from './helpers.js';

/**
 * Change history (audit log): switched on in Settings, read through
 * ⋯ → Tree: → Change history, grouped under day headers, exported as text and
 * cleared after a confirmation.
 */

/** Turn the change history on through the Settings checkbox. */
async function enableHistoryInSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await expect(settings).toBeVisible();
    const toggle = settings.locator('#audit-log-toggle');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(settings.locator('#audit-log-status')).toHaveText('Change history enabled');
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
}

/** ⋯ → Tree: → Change history. */
async function openHistoryFromMenu(page: Page): Promise<void> {
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-tree-row').hover();
    await page.locator('#actions-tree-audit-row').click();
    await expect(page.locator('#audit-log-modal')).toBeVisible();
}

test('history is grouped under Today / Yesterday / a date, newest first', async ({ page }) => {
    // Only the clock is faked (timers keep running): three edits on three days.
    await page.clock.setFixedTime(new Date('2025-03-10T10:00:00'));
    await openApp(page);
    await enableHistoryInSettings(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.clock.setFixedTime(new Date('2026-09-30T10:00:00'));
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await page.clock.setFixedTime(new Date('2026-10-01T10:00:00'));
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');

    await openHistoryFromMenu(page);
    const modal = page.locator('#audit-log-modal');
    await expect(modal.locator('#audit-log-count')).toContainText('3 entries');
    // An older year carries the year; this year's dates would not.
    await expect(modal.locator('.audit-log-day')).toHaveText(['Today', 'Yesterday', 'March 10, 2025']);
    await expect(modal.locator('.audit-log-desc')).toHaveText([
        'Added child: Jan Novak → Petr Novak',
        'Added partner: Jan Novak & Marie Novak',
        'Created person: Jan Novak',
    ]);
});

test('"Export TXT" downloads the history as text with the logged actions', async ({ page }, testInfo) => {
    await openApp(page);
    await enableHistoryInSettings(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    const treeName = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata().name);

    await openHistoryFromMenu(page);
    const modal = page.locator('#audit-log-modal');
    await expect(modal.locator('.audit-log-entry')).toHaveCount(2);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        modal.locator('#audit-log-export').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^audit-log-.+\.txt$/);
    const file = testInfo.outputPath('audit.txt');
    await download.saveAs(file);
    const lines = (await readFile(file, 'utf8')).split('\n');
    expect(lines[0]).toBe(`Change history — ${treeName}`);
    expect(lines[1]).toBe('2 entries');
    // Chronological (oldest first), one line per entry ending with its text.
    expect(lines.slice(3)).toHaveLength(2);
    expect(lines[3]).toMatch(/ {2}Created person: Jan Novak$/);
    expect(lines[4]).toMatch(/ {2}Added partner: Jan Novak & Marie Novak$/);
});

test('"Clear history" empties the log only after confirmation; the tree stays', async ({ page }) => {
    await openApp(page);
    await enableHistoryInSettings(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');

    await openHistoryFromMenu(page);
    const modal = page.locator('#audit-log-modal');
    await expect(modal.locator('.audit-log-entry')).toHaveCount(2);

    // Cancel keeps every entry.
    await modal.locator('#audit-log-clear').click();
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await expect(confirm.locator('#confirm-title')).toHaveText('Clear change history?');
    await confirm.locator('#confirm-cancel-btn').click();
    await expect(confirm).toBeHidden();
    await expect(modal.locator('.audit-log-entry')).toHaveCount(2);

    // Confirm empties it; export / clear have nothing left to act on.
    await modal.locator('#audit-log-clear').click();
    await expect(confirm.locator('#confirm-ok-btn')).toHaveText('Clear history');
    await confirm.locator('#confirm-ok-btn').click();
    await expect(modal.locator('.audit-log-entry')).toHaveCount(0);
    await expect(modal.locator('.audit-log-empty')).toHaveText('No entries recorded yet.');
    await expect(modal.locator('#audit-log-count')).toContainText('0 entries');
    await expect(modal.locator('#audit-log-clear')).toBeDisabled();
    await expect(modal.locator('#audit-log-export')).toBeDisabled();

    // The persons are untouched, and the cleared log stays empty after a reload.
    await page.evaluate(() => window.Strom.UI.closeAuditLogDialog());
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();
    await page.reload();
    await expect(card(page, 'Jan')).toBeVisible();
    await openHistoryFromMenu(page);
    await expect(modal.locator('.audit-log-empty')).toBeVisible();
    await expect(modal.locator('.audit-log-entry')).toHaveCount(0);
});
