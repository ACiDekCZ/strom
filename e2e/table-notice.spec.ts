import { test, expect } from '@playwright/test';
import { openApp, stubPersistence } from './helpers.js';

/**
 * A storage notice ("changes only in this browser tab") in the Table view
 * stands below the table's bar and column heads, never over them: under the
 * top bar it covered Scope ▾ until it was closed (P1a, verification of
 * 3.30.0). Every display mode, in German (the widest bar); back under the top
 * bar in the other views.
 */
test.use({ locale: 'de-DE' });

const SIZES: Array<[number, number]> = [[1440, 900], [1024, 768], [390, 844], [844, 390]];
for (const [width, height] of SIZES) {
    test(`the Table's controls stay free of the notice (@${width}x${height})`, async ({ page }) => {
        // A fixed start; the page's clock then runs on (the notice's "once a day" reads it).
        await page.clock.install({ time: new Date('2026-11-19T10:30:00Z') });
        await page.setViewportSize({ width, height });
        await stubPersistence(page, false);
        await openApp(page, { fileCopyReminders: true });
        await page.evaluate(() => window.Strom.UI.loadDemoTree());
        await expect(page.locator('.person-card').first()).toBeVisible();
        // An edit the tree's file does not hold: the notice.
        await page.evaluate(async () => {
            const dm = window.Strom.DataManager;
            const id = dm.getData().focusPersonId ?? Object.keys(dm.getData().persons)[0];
            dm.updatePerson(id as never, { firstName: 'Maximiliane Theresia', lastName: 'Hohenzollern-Sigmar' });
            await (window.Strom.UI as unknown as { refreshUnsavedIndicator(): Promise<void> }).refreshUnsavedIndicator();
        });
        const notice = page.locator('#file-copy-notice');
        await expect(notice).toBeVisible();

        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table'));
        await expect(page.locator('#table-container .tv-head')).toBeVisible();
        const scope = page.locator('#table-container .tv-scope-btn');
        await expect.poll(() => page.evaluate(() => {
            const n = document.getElementById('file-copy-notice')!.getBoundingClientRect();
            const covered = [...document.querySelectorAll<HTMLElement>('#table-container > .tv-bar, #table-container .tv-head')]
                .map(e => e.getBoundingClientRect())
                .filter(b => b.height > 0 && b.left < n.right && n.left < b.right && b.top < n.bottom && n.top < b.bottom);
            return covered.length;
        }), 'the notice covers neither the bar nor the column heads').toBe(0);
        // Scope ▾ takes the click while the notice shows.
        if (await scope.isVisible()) {
            const hit = await scope.evaluate((btn) => {
                const r = btn.getBoundingClientRect();
                return btn.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
            });
            expect(hit, 'Scope ▾ is not under the notice').toBe(true);
        }
        await expect(notice).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

        // Another view: the notice is back where CSS puts it.
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('family'));
        await expect.poll(() => notice.evaluate(el => el.style.top)).toBe('');
    });
}
