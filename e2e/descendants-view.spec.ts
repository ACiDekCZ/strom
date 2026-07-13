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

test('descendants view recenters — cards stay visible after prior pan/zoom', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await cardAction(page, 'Jan', 'focus');

    // Pan far away and zoom — the old view-mode switch kept this transform,
    // leaving the smaller descendants layout entirely off-screen.
    const box = (await page.locator('#tree-container').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y + box.height - 40, { steps: 5 });
    await page.mouse.up();
    await page.evaluate(() => window.Strom.ZoomPan.zoomIn());

    await page.locator('#view-mode-descendants').click();
    await expect(page.locator('#descendants-badge')).toBeVisible();
    // At least the root card must be inside the viewport.
    await expect.poll(async () => {
        return page.evaluate(() => {
            const cont = document.getElementById('tree-container')!.getBoundingClientRect();
            let visible = 0;
            document.querySelectorAll('.person-card').forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.right > cont.left && r.left < cont.right && r.bottom > cont.top && r.top < cont.bottom) visible++;
            });
            return visible;
        });
    }).toBeGreaterThan(0);
});
