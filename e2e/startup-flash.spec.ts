import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/** Record, every frame from the first paint, whether the welcome is visible. */
const WATCH_WELCOME = () => {
    const w = window as unknown as { __welcomeSeen?: boolean };
    w.__welcomeSeen = false;
    const tick = () => {
        const el = document.getElementById('empty-state');
        if (el) {
            const cs = getComputedStyle(el);
            if (cs.display !== 'none' && cs.visibility !== 'hidden') w.__welcomeSeen = true;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};

test('opening a tree with people never flashes the welcome screen', async ({ page }) => {
    await openApp(page);
    await page.locator('#file-input').setInputFiles('test/comprehensive.json');
    await page.getByRole('button', { name: 'Continue with warnings' }).click();
    const d = page.locator('#import-tree-modal');
    await d.locator('#import-tree-name').fill('Flash');
    await d.getByRole('button', { name: 'Import' }).click();
    await expect(page.locator('.person-card').first()).toBeVisible();

    await page.addInitScript(WATCH_WELCOME);
    await page.reload();
    await expect(page.locator('.person-card').first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __welcomeSeen?: boolean }).__welcomeSeen)).toBe(false);
});

// An empty app still shows the welcome once loaded: smoke.spec.ts.
