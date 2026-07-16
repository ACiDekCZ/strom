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

    // ✕ returns to the family view (the badge also carries the
    // whole-families toggle, so target the close button explicitly).
    await badge.getByRole('button').last().click();
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

test('descendants view: hidden-relative badges are not rendered', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await cardAction(page, 'Jan', 'focus');
    await addRelation(page, 'Jan', 'parent', 'Josef', 'Novak');
    await cardAction(page, 'Jan', 'focus');

    // In the descendants chart Jan's parent Josef is hidden by design —
    // no ▲/◆/▼ branch tabs may appear (their action does nothing there).
    await page.locator('#view-mode-descendants').click();
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(page.locator('.person-card .branch-tab')).toHaveCount(0);
    await expect(page.locator('.person-card .hidden-partners-btn')).toHaveCount(0);

    // Back in family view the badges return where applicable.
    await page.locator('#view-mode-family').click();
    await expect(card(page, 'Josef')).toBeVisible();
});

test('descendants view: step-relatives hidden by default, badge toggle shows them dimmed', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Emil', 'Visek');
    await addRelation(page, 'Emil', 'child', 'Milan', 'Visek');
    await cardAction(page, 'Emil', 'focus');
    await addRelation(page, 'Milan', 'partner', 'Romana', 'Ditrichova');
    // Romana's child from a previous marriage (not Emil's blood).
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const romana = dm.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Romana')!;
        const ex = dm.createPerson({ firstName: 'Martin', lastName: 'Matejka', gender: 'male' });
        const union = dm.createPartnership(romana.id, ex.id);
        const step = dm.createPerson({ firstName: 'Lucie', lastName: 'Matejkova', gender: 'female' });
        dm.addParentChild(romana.id, step.id, union.id);
        dm.addParentChild(ex.id, step.id, union.id);
    });
    await cardAction(page, 'Emil', 'focus');

    await page.locator('#view-mode-descendants').click();
    await expect(page.locator('#descendants-badge')).toBeVisible();

    // Default: blood line + partners only; count = blood descendants (Milan).
    await expect(card(page, 'Milan')).toBeVisible();
    await expect(card(page, 'Romana')).toBeVisible();
    await expect(card(page, 'Lucie')).toBeHidden();
    await expect(page.locator('#descendants-badge-text')).toContainText('(1)');

    // Badge toggle: whole families appear, step-relatives de-emphasized.
    await page.locator('#descendants-families-toggle').click();
    await expect(card(page, 'Lucie')).toBeVisible();
    await expect(card(page, 'Lucie')).toHaveClass(/indirect/);
    await expect(card(page, 'Martin')).toHaveClass(/indirect/);
    await expect(card(page, 'Romana')).not.toHaveClass(/indirect/);
    await expect(page.locator('#descendants-badge-text')).toContainText('(1)');

    // Toggle back hides them again.
    await page.locator('#descendants-families-toggle').click();
    await expect(card(page, 'Lucie')).toBeHidden();
});

test('view switcher: the selected mode carries .active, the previous loses it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await cardAction(page, 'Jan', 'focus');

    const modes = ['family', 'descendants', 'timeline', 'fan', 'map'];
    for (const mode of modes) {
        await page.locator(`#view-mode-${mode}`).click();
        // Exactly the clicked segment is active.
        for (const other of modes) {
            const seg = page.locator(`#view-mode-${other}`);
            if (other === mode) await expect(seg).toHaveClass(/active/);
            else await expect(seg).not.toHaveClass(/active/);
        }
    }
    // Back to family so the shared app state is clean for later assertions.
    await page.locator('#view-mode-family').click();
});

test('view switcher: the selected segment is visibly highlighted in dark theme', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await cardAction(page, 'Jan', 'focus');

    await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.locator('#view-mode-descendants').click();
    // The active segment must not fall back to the generic dark button colour
    // (regression guard: the .active rule used to be overridden in dark theme
    // by the equal-specificity generic dark rule that came later in source).
    const bg = (sel: string) => page.locator(sel).evaluate(el => getComputedStyle(el).backgroundColor);
    const activeBg = await bg('#view-mode-descendants');
    const inactiveBg = await bg('#view-mode-family');
    expect(activeBg).not.toBe(inactiveBg);

    await page.evaluate(() => window.Strom.SettingsManager.setTheme('system'));
    await page.locator('#view-mode-family').click();
});

test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('descendants badge replaces the focus bar on mobile (no overlap)', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
        await cardAction(page, 'Jan', 'focus');
        await expect(page.locator('#focus-controls')).toBeVisible();

        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('descendants'));
        await expect(page.locator('#descendants-badge')).toBeVisible();
        await expect(page.locator('#focus-controls')).toBeHidden();

        // Exit restores the focus bar.
        await page.locator('#descendants-badge button').last().click();
        await expect(page.locator('#focus-controls')).toBeVisible();
    });

    test('mobile menu: the selected view row button carries .active', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await cardAction(page, 'Jan', 'focus');

        // Pick a mode, then reopen the menu (clicking a row also closes it).
        await page.locator('.hamburger-btn').click();
        await page.locator('#mm-view-timeline').click();
        await page.locator('.hamburger-btn').click();
        await expect(page.locator('#mm-view-timeline')).toHaveClass(/active/);
        await expect(page.locator('#mm-view-family')).not.toHaveClass(/active/);
    });
});
