import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

/**
 * The visible Undo affordances added in round 7: the bottom-centre "Undo" toast
 * raised after each single mutation, and the ⋯ actions-menu Undo / Redo rows
 * with their descriptions and disabled states.
 */

test('undo toast appears after adding a person; Undo reverts and confirms', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await expect(card(page, 'Jan')).toBeVisible();

    // Adding the person raised the paper-pill Undo toast with the description.
    const toast = page.locator('.undo-toast');
    await expect(toast).toBeVisible();
    await expect(toast.locator('.undo-toast-msg')).toContainText('Jan');

    // Clicking Undo runs the same path as Ctrl+Z: Jan is removed…
    await toast.locator('.undo-toast-btn').click();
    await expect(card(page, 'Jan')).toBeHidden();
    // …and a confirmation toast (no button) reports what was reverted.
    const confirm = page.locator('.toast');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Undone');
    // The undo toast itself is gone.
    await expect(page.locator('.undo-toast')).toBeHidden();
});

test('undo toast auto-dismisses on Escape', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await expect(page.locator('.undo-toast')).toBeVisible();
    await page.locator('#tree-container').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    await expect(page.locator('.undo-toast')).toBeHidden();
});

test('Undo / Redo live in the toolbar, not in the ⋯ menu: description and disabled states', async ({ page }) => {
    await openApp(page);
    const undo = page.locator('#toolbar-undo-btn');
    const redo = page.locator('#toolbar-redo-btn');
    // Nothing done yet: both visible and disabled.
    await expect(undo).toBeVisible();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('.actions-menu-btn').click();
    await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
    await expect(page.locator('#actions-menu-dropdown')).not.toContainText('Undo');
    await page.keyboard.press('Escape');

    // The toolbar Undo carries the last change and the platform shortcut;
    // Redo is disabled (nothing to replay yet).
    await expect(undo).toBeEnabled();
    await expect(undo).toHaveAttribute('title', /^Undo: .*Jan/);
    await expect(undo).toHaveAttribute('title', /Ctrl\+Z|⌘Z/);
    await expect(redo).toBeDisabled();

    // Undo: the stack is now empty, so Undo greys out and Redo becomes available.
    await undo.click();
    await expect(card(page, 'Jan')).toBeHidden();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();

    // Redo brings the person back and re-enables Undo.
    await redo.click();
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(undo).toBeEnabled();
});
