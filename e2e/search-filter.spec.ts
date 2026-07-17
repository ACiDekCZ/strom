import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, addRelation } from './helpers.js';

test('search filter highlights matching cards and dims the rest; clear resets', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await cardAction(page, 'Jan', 'focus');
    await addRelation(page, 'Jan', 'parent', 'Josef', 'Stary');
    await cardAction(page, 'Jan', 'focus');

    // Open the filter panel and filter by last name.
    await page.locator('#search-filter-toggle').click();
    const filters = page.locator('#search-filters');
    await expect(filters).toBeVisible();
    await page.locator('#filter-lastname').fill('Novak');

    // Novak cards are highlighted; the different surname is dimmed.
    await expect(card(page, 'Jan')).toHaveClass(/search-hit/);
    await expect(card(page, 'Marie')).toHaveClass(/search-hit/);
    await expect(card(page, 'Josef')).toHaveClass(/search-dim/);
    await expect(page.locator('#search-result-count')).not.toBeEmpty();

    // Clearing removes all highlight classes.
    await page.locator('#search-filters').getByRole('button', { name: 'Clear' }).click();
    await expect(card(page, 'Jan')).not.toHaveClass(/search-hit/);
    await expect(card(page, 'Josef')).not.toHaveClass(/search-dim/);
});

test('filter by birth-year range highlights only in-range persons', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Old', 'Person', { birthDate: '1850' });
    await addRelation(page, 'Old', 'child', 'Young', 'Person');
    await cardAction(page, 'Old', 'focus');
    // Give the child a modern birth year via the edit modal.
    await cardAction(page, 'Young', 'edit');
    await page.locator('#person-modal #input-birthdate').fill('1990');
    await page.locator('#person-modal').getByRole('button', { name: 'Save' }).click();

    await cardAction(page, 'Old', 'focus');
    await page.locator('#search-filter-toggle').click();
    await page.locator('#filter-year-from').fill('1800');
    await page.locator('#filter-year-to').fill('1900');

    await expect(card(page, 'Old')).toHaveClass(/search-hit/);
    await expect(card(page, 'Young')).toHaveClass(/search-dim/);
});

test('filter panel opens fully on screen below the toolbar and Escape closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 556 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#search-filter-toggle').click();
    const panel = page.locator('#search-filters');
    await expect(panel).toBeVisible();

    // Regression: the panel used to grow the search container in-flow; the
    // fixed-height toolbar then centered it half above the screen (y < 0).
    const box = (await panel.boundingBox())!;
    const searchRow = (await page.locator('#toolbar-search-picker').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);                       // fully on screen
    expect(box.y).toBeGreaterThan(searchRow.y + searchRow.height); // below the search row
    expect(box.y + box.height).toBeLessThanOrEqual(556);

    // Escape closes the panel (it is reachable even without the toggle).
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
});

test('the filter toggle stays visible when active (green fill, light icon)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const toggle = page.locator('#search-filter-toggle');

    // Resting: legible ghost (not white-on-cream).
    const restBg = await toggle.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(restBg).toBe('rgba(0, 0, 0, 0)');

    // Active: the green fill must actually apply (a later ghost rule used to
    // strip it, leaving a white icon on a transparent background).
    await toggle.click();
    await expect(toggle).toHaveClass(/active/);
    // The toolbar buttons animate background 0.2s — poll past the transition
    // (an immediate read at t=0 sees the interpolated transparent start).
    await expect.poll(() => toggle.evaluate(el => getComputedStyle(el).backgroundColor))
        .not.toBe('rgba(0, 0, 0, 0)');
});
