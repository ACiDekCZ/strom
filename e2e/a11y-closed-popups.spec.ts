import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, personModal } from './helpers.js';
import { axDialogsAndMenus, domExposedPopups } from './a11y.js';

/**
 * Closed dialogs and menus are out of the accessibility tree (spec 063 K1.3,
 * A1), and a bottom sheet hits nothing while it slides in (A3). A closed
 * dialog used to be only `display: none` by a class: a page reader walking the
 * DOM still found its buttons ("Cancel" twenty times). Now a closed one
 * carries `hidden` or `aria-hidden`: after a dialog or a menu opens there is
 * exactly one, after it closes none — in the browser's accessibility tree and
 * in the DOM alike.
 */

/** Dialogs and menus in the accessibility tree, as "role" strings. */
async function axRoles(page: Page): Promise<string[]> {
    return (await axDialogsAndMenus(page)).map(i => i.role);
}

/** Nothing open: no dialog or menu in either tree. */
async function noneExposed(page: Page, when: string): Promise<void> {
    await expect.poll(() => domExposedPopups(page), { message: `DOM: ${when}` }).toEqual([]);
    await expect.poll(() => axRoles(page), { message: `accessibility tree: ${when}` }).toEqual([]);
}

test.describe('computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a dialog, a nested dialog, the person menu and the Actions menu: one while open, none after closing', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await noneExposed(page, 'the tree, nothing open');

        // A dialog: one, then none; focus goes back to where it came from.
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        await expect(modal).toBeVisible();
        await expect.poll(() => domExposedPopups(page)).toEqual(['div#person-modal.modal-overlay.active']);
        await expect.poll(() => axRoles(page)).toEqual(['dialog']);
        await expect(page.getByRole('dialog')).toHaveCount(1);

        // A dialog over a dialog: two, then one again.
        await modal.locator('#btn-add-event').click();
        await expect(page.locator('#event-editor-modal')).toBeVisible();
        await expect.poll(() => axRoles(page)).toEqual(['dialog', 'dialog']);
        await expect(page.getByRole('dialog')).toHaveCount(2);
        await page.keyboard.press('Escape');
        await expect(page.locator('#event-editor-modal')).toBeHidden();
        await expect.poll(() => axRoles(page)).toEqual(['dialog']);
        await expect(modal.locator('#btn-add-event'), 'focus back on the opener').toBeFocused();

        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();
        await expect(modal).toHaveAttribute('hidden', '');
        await noneExposed(page, 'after the form closed');
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // The person menu (built per open).
        await card(page, 'Jan').click();
        await expect(page.locator('.context-menu:not(.context-submenu)')).toBeVisible();
        await expect.poll(() => axRoles(page)).toEqual(['menu']);
        await expect(page.getByRole('menu')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('.context-menu')).toHaveCount(0);
        await noneExposed(page, 'after the person menu closed');

        // The Actions menu (always in the page; its submenus open on hover).
        await page.locator('.actions-menu-btn').click();
        const actions = page.locator('#actions-menu-dropdown');
        await expect(actions).toBeVisible();
        await expect.poll(() => domExposedPopups(page)).toEqual([expect.stringMatching(/^div#actions-menu-dropdown\./)]);
        await expect.poll(() => axRoles(page)).toEqual(['menu']);
        await expect(page.getByRole('menu')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(actions).toBeHidden();
        await noneExposed(page, 'after the Actions menu closed');
    });

    test('the settings dialog: hidden while closed, shown while open, hidden again', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        const settings = page.locator('#settings-modal');
        await expect(settings).toHaveAttribute('hidden', '');
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(settings).toBeVisible();
        await expect(settings).not.toHaveAttribute('hidden');
        await expect.poll(() => axRoles(page)).toEqual(['dialog']);
        await page.keyboard.press('Escape');
        await expect(settings).toBeHidden();
        await noneExposed(page, 'after the settings closed');
    });
});

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the More sheet: one menu while open, none after closing', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await noneExposed(page, 'the tree on a phone');
        await page.locator('#bb-view-more').tap();
        await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
        await expect.poll(() => axRoles(page)).toEqual(['menu']);
        await page.keyboard.press('Escape');
        await expect(page.locator('.bottom-sheet-overlay')).toHaveCount(0);
        await noneExposed(page, 'after the sheet closed');
    });

    test('a sheet sliding in is inert: a tap hits nothing; after the slide it works', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        // A long slide, so the tap surely lands while the sheet still moves.
        await page.addStyleTag({ content: '.bottom-sheet { transition-duration: 3s !important; }' });

        await page.locator('#bb-view-more').tap();
        const overlay = page.locator('.bottom-sheet-overlay');
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(overlay).toHaveAttribute('data-sliding', '');
        expect(await sheet.evaluate(el => (el as HTMLElement).inert)).toBe(true);

        // Tap the Settings tile where it is at this moment.
        const tile = sheet.locator('#sheet-settings');
        const box = (await tile.boundingBox())!;
        await page.touchscreen.tap(box.x + box.width / 2, Math.min(box.y + box.height / 2, 843));
        // The backdrop under the finger would have closed the sheet, a row acted.
        await expect(overlay).not.toHaveAttribute('data-sliding', '', { timeout: 6000 });
        expect(await sheet.evaluate(el => (el as HTMLElement).inert)).toBe(false);
        await expect(sheet).toBeVisible();
        await expect(page.locator('#settings-modal')).toBeHidden();

        // Slid in: the same tile works.
        await tile.tap();
        await expect(page.locator('#settings-modal')).toBeVisible();
    });

    test('reduced motion: the sheet stands in place at once and is never inert', async ({ page }) => {
        // The suite's default (playwright.config): prefers-reduced-motion: reduce.
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.locator('#bb-view-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        const state = await sheet.evaluate(el => ({
            inert: (el as HTMLElement).inert,
            sliding: el.closest('.bottom-sheet-overlay')!.hasAttribute('data-sliding'),
            transition: getComputedStyle(el).transitionDuration,
        }));
        expect(state).toEqual({ inert: false, sliding: false, transition: '0s' });
        await sheet.locator('#sheet-settings').tap();
        await expect(page.locator('#settings-modal')).toBeVisible();
    });
});
