import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Branch colours: a settings toggle adds a coloured stripe class to cards
 * (relative to the focus) and shows a legend; turning it off removes both.
 */
test('branch colours toggle adds card classes and a legend', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    // Colours default ON, the legend box defaults OFF (opt-in in settings).
    const legend = page.locator('#branch-legend');
    await expect(legend).toBeHidden();
    await page.evaluate(() => window.Strom.UI.toggleBranchLegend(true));
    await expect(legend).toBeVisible();
    // At least one card now carries a branch class (Johan has descendants/ancestors).
    await expect.poll(() =>
        page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').count()
    ).toBeGreaterThan(0);

    // Dark-mode smoke: stripes and legend still render under the dark theme.
    await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(legend).toBeVisible();
    await expect(page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').first()).toBeVisible();
    await page.evaluate(() => window.Strom.SettingsManager.setTheme('system'));

    // Disable → stripes and legend gone.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('#branch-colors-toggle').uncheck();
    await expect(legend).toBeHidden();
    await expect.poll(() =>
        page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').count()
    ).toBe(0);

    // Re-enable → they come back.
    await page.locator('#branch-colors-toggle').check();
    await expect(legend).toBeVisible();
});

test('the legend can be hidden separately while stripes stay on', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    const legend = page.locator('#branch-legend');
    await expect(legend).toBeHidden();   // default OFF
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('#branch-legend-toggle').check();
    await expect(legend).toBeVisible();
    await page.locator('#branch-legend-toggle').uncheck();
    await expect(legend).toBeHidden();
    // Stripes stay on throughout.
    await expect(page.locator('.person-card.branch-descendant').first()).toBeVisible();
});

test('the branch stripe follows the card\'s rounded corners, also on the focused card (T06)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    const striped = page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant');
    await expect.poll(() => striped.count()).toBeGreaterThan(0);

    // The stripe layer is the card's own border box with the card's rounding
    // (painted only on its left 4px), not a 4px bar whose corners the browser
    // shrinks to a different curve.
    const shapes = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>(
            '.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant'));
        const plain = cards.find(c => !c.classList.contains('focused'))!;
        // The focus card has no branch of its own: give a striped card the
        // focused look (2px border) to check that case too.
        const other = cards.find(c => c !== plain)!;
        other.classList.add('focused');
        const out = [plain, other].map(c => {
            const cs = getComputedStyle(c);
            const st = getComputedStyle(c, '::before');
            return {
                focused: c.classList.contains('focused'),
                radius: [st.borderTopLeftRadius, st.borderBottomLeftRadius].join(' ') === [cs.borderTopLeftRadius, cs.borderBottomLeftRadius].join(' '),
                // Border box: the stripe starts at the card's outer edge.
                left: parseFloat(st.left) === -parseFloat(cs.borderLeftWidth),
                width: Math.abs(parseFloat(st.width) - c.offsetWidth) < 0.01,
                height: Math.abs(parseFloat(st.height) - c.offsetHeight) < 0.01,
            };
        });
        other.classList.remove('focused');
        return out;
    });
    expect(shapes.length).toBe(2);
    for (const s of shapes) expect(s, s.focused ? 'focused card' : 'card').toMatchObject({ radius: true, left: true, width: true, height: true });
});
