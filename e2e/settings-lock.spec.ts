import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card, controlCardComesBack } from './helpers.js';

function activeTreeId(page: Page): Promise<string> {
    return page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
}

test('locking the tree hides editing controls; unlocking restores them', { tag: '@smoke' }, async ({ page }) => {
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

// B16-2: the control block is a card around the minimap and the zoom buttons;
// with the buttons off and no minimap it must not stay as an empty circle.
for (const vp of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 800, height: 1000 },
    { name: 'phone', width: 390, height: 844 },
    { name: 'phone sideways', width: 844, height: 390 },
]) {
    test(`B16-2: with the zoom buttons off and no minimap no empty control card stays (${vp.name})`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        const block = page.locator('.control-block');
        await expect(page.locator('.zoom-controls')).toBeVisible();
        await expect(page.locator('#minimap-panel')).toBeHidden();

        await page.evaluate(() => window.Strom.UI.toggleZoomControls(false));
        await expect(page.locator('.zoom-controls')).toBeHidden();
        // No box at all: not a 16 px card with a background and a shadow.
        await expect(block).toBeHidden();
        expect(await block.evaluate(el => { const r = el.getBoundingClientRect(); return r.width * r.height; })).toBe(0);

        await page.evaluate(() => window.Strom.UI.toggleZoomControls(true));
        await expect(page.locator('.zoom-controls')).toBeVisible();
    });
}

test('B16-2: with the zoom buttons off the control card follows the minimap', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    // Zoomed in until the tree overflows: the minimap shows.
    for (let i = 0; i < 4; i++) await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
    await expect(page.locator('#minimap-panel')).toBeVisible();
    // The zoom buttons off: the card stays for the minimap.
    await page.evaluate(() => window.Strom.UI.toggleZoomControls(false));
    await expect(page.locator('.zoom-controls')).toBeHidden();
    await expect(page.locator('.control-block')).toBeVisible();
    // The minimap off too: nothing left, no card.
    await page.evaluate(() => window.Strom.UI.toggleMinimap(false));
    await expect(page.locator('#minimap-panel')).toBeHidden();
    await expect(page.locator('.control-block')).toBeHidden();
    // The minimap back on: the card returns with it.
    await page.evaluate(() => window.Strom.UI.toggleMinimap(true));
    await expect(page.locator('#minimap-panel')).toBeVisible();
    await expect(page.locator('.control-block')).toBeVisible();
});

// B17-1: the card hidden as empty comes back (the same scenario runs in
// WebKit in mobile-webkit.spec.ts, where the bug was).
test('B17-1: with the zoom buttons off the minimap and its card come back after the tree fitted', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await controlCardComesBack(page);
});

test('floating zoom buttons can be turned off in settings', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const zoomControls = page.locator('.zoom-controls');
    await expect(zoomControls).toBeVisible();

    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    const toggle = settings.locator('#zoom-controls-toggle');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(zoomControls).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(zoomControls).toBeHidden();

    // Turning it back on restores the buttons.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await toggle.check();
    await expect(zoomControls).toBeVisible();
});
