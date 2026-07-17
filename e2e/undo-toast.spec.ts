import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

/**
 * The visible Undo affordances added in round 7: the bottom-centre "Undo" toast
 * raised after each single mutation, and the ⋯ actions-menu Undo / Redo rows
 * with their descriptions and disabled states.
 */

test('undo toast appears after adding a person; Undo reverts and confirms', async ({ page }) => {
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

test('actions menu shows Undo with description and correct disabled states', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const undoRow = page.locator('#actions-undo-row');
    const undoLabel = page.locator('#actions-undo-label');
    const redoRow = page.locator('#actions-redo-row');

    // Open the ⋯ menu: Undo carries the last change; Redo is disabled (nothing
    // to replay yet).
    await page.locator('.actions-menu-btn').click();
    await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
    await expect(undoLabel).toContainText('Undo:');
    await expect(undoLabel).toContainText('Jan');
    await expect(undoRow).not.toHaveClass(/menu-row-disabled/);
    await expect(redoRow).toHaveClass(/menu-row-disabled/);
    await expect(page.locator('#actions-undo-hint')).toHaveText(/Z$/);

    // Undo from the menu; reopen: the stack is now empty, so Undo greys out
    // (label without a description) and Redo becomes available.
    await undoRow.click();
    await expect(card(page, 'Jan')).toBeHidden();
    await page.locator('.actions-menu-btn').click();
    await expect(undoLabel).toHaveText('Undo');
    await expect(undoRow).toHaveClass(/menu-row-disabled/);
    await expect(redoRow).not.toHaveClass(/menu-row-disabled/);
});
