import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, personModal, addRelation } from './helpers.js';

/**
 * Review S9 / S37: the relationships dialog is staged as a whole, the event
 * and source editors ask before discarding edits, dialogs take and give back
 * focus, and the click-only controls work from the keyboard.
 */

const relType = (page: import('@playwright/test').Page, parentName: string) =>
    page.evaluate((name) => {
        const persons = Object.values(window.Strom.DataManager.getData().persons) as Array<{
            id: string; firstName: string; parentRelTypes?: Record<string, string>;
        }>;
        const parent = persons.find(p => p.firstName === name)!;
        const child = persons.find(p => p.firstName === 'Petr')!;
        return child.parentRelTypes?.[parent.id] ?? 'biological';
    }, parentName);

test('relationships dialog: an immediate change is rolled back without Save and is one undo step with it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    const janId = await card(page, 'Jan').getAttribute('data-id');
    const panel = page.locator('#relationships-modal');
    const confirm = page.locator('#confirmation-modal');

    // Change the relation type (applied live), then Escape → asked; Discard.
    await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), janId);
    await expect(panel).toBeVisible();
    await panel.locator('.parent-rel-type-select').first().selectOption('adoptive');
    expect(await relType(page, 'Jan')).toBe('adoptive');
    const undoBefore = await page.evaluate(() => window.Strom.DataManager.lastUndoDescription());
    await page.keyboard.press('Escape');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-discard-btn').click();
    await expect(panel).toBeHidden();
    expect(await relType(page, 'Jan')).toBe('biological');
    // A rollback records nothing.
    expect(await page.evaluate(() => window.Strom.DataManager.lastUndoDescription())).toBe(undoBefore);

    // Change again, then Save: kept, and one Undo reverts the whole dialog.
    await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), janId);
    await panel.locator('.parent-rel-type-select').first().selectOption('step');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel).toBeHidden();
    expect(await relType(page, 'Jan')).toBe('step');
    await page.evaluate(() => window.Strom.UI.performUndo());
    expect(await relType(page, 'Jan')).toBe('biological');
});

test('event editor asks before discarding edits; Stay keeps them', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#btn-add-event').click();
    const editor = page.locator('#event-editor-modal');
    const confirm = page.locator('#confirmation-modal');
    await expect(editor).toBeVisible();

    // Untouched: Escape closes without a question.
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(confirm).toBeHidden();
    await expect(modal).toBeVisible();

    await modal.locator('#btn-add-event').click();
    await editor.locator('#input-event-place').fill('Kladno');
    await page.keyboard.press('Escape');
    await expect(confirm).toBeVisible();
    // Escape on the question = stay.
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(editor.locator('#input-event-place')).toHaveValue('Kladno');
    // Cancel asks too; Discard closes without an event.
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-discard-btn').click();
    await expect(editor).toBeHidden();
    await expect(modal.locator('#events-list')).not.toContainText('Kladno');
});

test('source editor asks before discarding edits', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    await page.evaluate(() => window.Strom.UI.showAddSourceModal());
    const editor = page.locator('#source-editor-modal');
    const confirm = page.locator('#confirmation-modal');
    await expect(editor).toBeVisible();
    await editor.locator('#input-source-title').fill('Parish register');
    await page.keyboard.press('Escape');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-save-btn').click();
    await expect(editor).toBeHidden();
    await expect(page.locator('#sources-list')).toContainText('Parish register');
});

test('a dialog takes focus on open, traps Tab, and gives focus back on close', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const jan = card(page, 'Jan');
    await jan.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.context-menu-item').first()).toBeFocused();

    // Enter on "Edit" opens the person modal with focus in the first field.
    await page.keyboard.press('Enter');
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.locator('#input-firstname')).toBeFocused();

    // Shift+Tab from the first control wraps inside the dialog.
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.getElementById('person-modal')!.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    // The opener (a menu row) is gone; focus is not stuck inside a hidden dialog.
    expect(await page.evaluate(() => document.getElementById('person-modal')!.contains(document.activeElement))).toBe(false);
});

test('person card and actions menu work from the keyboard', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const jan = card(page, 'Jan');
    await expect(jan).toHaveAttribute('role', 'button');
    await expect(jan).toHaveAttribute('aria-label', 'Jan Novak');

    // Card: Enter opens the menu, arrows move, Escape returns to the card.
    await jan.focus();
    await page.keyboard.press('Enter');
    const items = page.locator('.context-menu .context-menu-item');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.context-menu')).toHaveCount(0);
    await expect(jan).toBeFocused();

    // Actions menu: ArrowUp from the trigger lands on the last row (Settings);
    // Enter activates it.
    const trigger = page.locator('.actions-menu-btn');
    await trigger.click();
    await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
    await trigger.focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#actions-menu-dropdown .actions-menu-settings.tree-switcher-action')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#settings-modal')).toBeVisible();

    // The logo is a button too.
    await page.keyboard.press('Escape');
    await page.locator('.app-logo').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#about-modal')).toBeVisible();
});
