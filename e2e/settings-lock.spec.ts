import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, addRelation } from './helpers.js';

function activeTreeId(page: Page): Promise<string> {
    return page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
}

test('locking the tree hides editing controls; unlocking restores them', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const tid = await activeTreeId(page);
    await page.evaluate((id) => window.Strom.UI.toggleTreeLock(id), tid);
    await expect(page.locator('body')).toHaveClass(/tree-locked/);
    expect(await page.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(true);
    // Adding a person is blocked while locked (the add modal does not open).
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await expect(page.locator('#person-modal')).toBeHidden();

    await page.evaluate((id) => window.Strom.UI.toggleTreeLock(id), tid);
    await expect(page.locator('body')).not.toHaveClass(/tree-locked/);
    expect(await page.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(false);
    // Adding a person works again once unlocked.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await expect(page.locator('#person-modal')).toBeVisible();
});

test('switching the UI language at runtime updates the interface', async ({ page }) => {
    await openApp(page);

    // Switch to Czech via the settings dialog radios.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await expect(settings).toBeVisible();
    await settings.locator('input[name="language"][value="cs"]').check();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    // The about dialog now shows Czech labels.
    await page.locator('.app-logo').click();
    const about = page.locator('#about-modal');
    await expect(about).toBeVisible();
    await expect(about).toContainText('Vytvořil');
    await page.keyboard.press('Escape');

    // Switch back to English.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await settings.locator('input[name="language"][value="en"]').check();
    await page.keyboard.press('Escape');
    await page.locator('.app-logo').click();
    await expect(about).toContainText('Created by');
});

test('tree stats dialog shows the person count', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');

    await page.evaluate(() => window.Strom.UI.showActiveTreeStats());
    const modal = page.locator('#tree-stats-modal');
    await expect(modal).toBeVisible();
    const content = modal.locator('#tree-stats-content');
    await expect(content).toBeVisible();
    // Two real persons are reported.
    await expect(content).toContainText('2');
});

test('audit log records a mutation when enabled', async ({ page }) => {
    await openApp(page);
    // Enable audit logging before mutating.
    await page.evaluate(() => window.Strom.UI.toggleAuditLog(true));
    await createFirstPerson(page, 'Jan', 'Novak');

    const tid = await activeTreeId(page);
    await page.evaluate((id) => window.Strom.UI.showAuditLogDialog(id), tid);
    const modal = page.locator('#audit-log-modal');
    await expect(modal).toBeVisible();
    // At least one entry was recorded.
    await expect(modal.locator('#audit-log-list .audit-log-entry, #audit-log-list li').first()).toBeVisible();
});
