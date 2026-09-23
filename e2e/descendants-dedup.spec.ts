import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, cardAction, card } from './helpers.js';

/**
 * ZADANI kolo 12 — "one bearer of the name" in the Descendants view.
 *
 * On the tablet band the focus moves into the toolbar as `.toolbar-focus`; the
 * descendants view also shows its own badge. Before this round both were
 * visible at once — the root name appeared twice. The descendants badge is now
 * the ONLY chrome bearer of the root name at every width, and it carries the
 * ↓ depth select (the chart forces ancestorDepth=0, so ↑ is not carried).
 */

// 360 (mobile), 500 (tablet-focus starts), 600 + 900 + 1024 (tablet toolbar
// band, where .toolbar-focus is shown in Family view), 1200 + 1440 (desktop).
const WIDTHS = [360, 500, 600, 900, 1024, 1200, 1440];

test('descendants view: exactly one chrome element bears the root name at every width', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 850 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await cardAction(page, 'Jan', 'focus');

    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('descendants'));
    await expect(page.locator('#descendants-badge')).toBeVisible();

    for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: 850 });
        await page.waitForTimeout(60);

        const bearers = await page.evaluate(() => {
            // Every chrome element that can print the focus/root NAME (not cards).
            const sels = ['.descendants-badge-name', '#toolbar-focus-name', '#focus-name'];
            const visibleWithName = (sel: string): boolean => {
                const el = document.querySelector(sel);
                if (!el) return false;
                if (!(el.textContent || '').includes('Jan')) return false;
                // Visible = itself and every ancestor rendered, with real box.
                if (!(el as HTMLElement).offsetParent && getComputedStyle(el).position !== 'fixed') return false;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return false;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            };
            return sels.filter(visibleWithName);
        });

        expect(bearers, `@${w}px: exactly one visible name bearer (got ${bearers.join(', ')})`).toEqual(['.descendants-badge-name']);
    }

    // Returning to Family view restores the toolbar focus purely via body class.
    await page.setViewportSize({ width: 900, height: 850 });
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('family'));
    await expect(page.locator('#descendants-badge')).toBeHidden();
    // On the tablet band the toolbar focus is the (now single) name bearer.
    await expect(page.locator('#toolbar-focus-name')).toBeVisible();
});

test('descendants badge: the ↓ depth stepper re-renders the chart', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await addRelation(page, 'Petr', 'child', 'Emil', 'Novak'); // grandchild
    await cardAction(page, 'Jan', 'focus');

    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('descendants'));
    await expect(page.locator('#descendants-badge')).toBeVisible();

    // The native select stays as the hidden source of truth; the visible
    // control is the "− n +" stepper.
    const stepper = page.locator('#descendants-badge .depth-stepper');
    await expect(stepper).toBeVisible();
    await expect(page.locator('#descendants-depth-down')).toBeHidden();
    const dec = stepper.locator('.depth-stepper-btn[data-step="-1"]');
    const inc = stepper.locator('.depth-stepper-btn[data-step="1"]');
    const value = stepper.locator('.depth-stepper-value');
    // Two generations down → range 1..2, defaulting to the max (2).
    await expect(value).toHaveText('2');
    await expect(inc).toBeDisabled();
    await expect(card(page, 'Emil')).toBeVisible();

    // Shrink the depth to 1 → the grandchild drops out and the state follows.
    await dec.click();
    await expect(value).toHaveText('1');
    await expect(dec).toBeDisabled();
    await expect(card(page, 'Emil')).toBeHidden();
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusDepthDown())).toBe(1);

    // Grow it back to 2 → the grandchild returns.
    await inc.click();
    await expect(value).toHaveText('2');
    await expect(card(page, 'Emil')).toBeVisible();
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusDepthDown())).toBe(2);
});
