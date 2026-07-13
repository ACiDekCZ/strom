import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, addRelation } from './helpers.js';

test('descendants view: root stays, ancestors hidden, badge shows, ✕ returns', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await cardAction(page, 'Jan', 'focus');
    await addRelation(page, 'Jan', 'parent', 'Josef', 'Novak');
    await cardAction(page, 'Jan', 'focus');

    // In family mode all three are visible.
    await expect(card(page, 'Josef')).toBeVisible(); // ancestor
    await expect(card(page, 'Petr')).toBeVisible();  // descendant

    // Switch to the descendants view via the toolbar segment.
    await page.locator('#view-mode-descendants').click();

    // The badge appears and names the root.
    const badge = page.locator('#descendants-badge');
    await expect(badge).toBeVisible();
    await expect(page.locator('#descendants-badge-text')).toContainText('Jan');

    // The root and its descendant stay; the ancestor is gone.
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Petr')).toBeVisible();
    await expect(card(page, 'Josef')).toBeHidden();

    // ✕ returns to the family view.
    await badge.getByRole('button').click();
    await expect(badge).toBeHidden();
    await expect(card(page, 'Josef')).toBeVisible();
});

test('descendants view: context-menu "Show descendants" enters the mode', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await cardAction(page, 'Jan', 'focus');

    await cardAction(page, 'Jan', 'descendants');
    await expect(page.locator('#descendants-badge')).toBeVisible();
    await expect(page.locator('#view-mode-descendants')).toHaveClass(/active/);
});
