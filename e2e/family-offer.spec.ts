import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction } from './helpers.js';

/**
 * The "add the rest of the family?" offer floats above everything (z-index 250).
 * With a dialog open on a phone it landed on that dialog's buttons — and it is
 * an offer about the tree, so while a dialog is open it has nothing to say.
 */
test('the family offer gets out of the way of an open dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });

    // It shows on the canvas, where it belongs.
    await expect(page.locator('.family-offer')).toBeVisible();

    await cardAction(page, 'Jan', 'edit');
    await expect(page.locator('#person-modal')).toHaveClass(/active/);
    await expect(page.locator('.family-offer')).toBeHidden();

    // Every button of the dialog is actually reachable.
    for (const name of ['Save', 'Cancel']) {
        const btn = page.locator('#person-modal').getByRole('button', { name, exact: true });
        const box = await btn.boundingBox();
        const onTop = await page.evaluate(([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el?.className ?? '';
        }, [box!.x + box!.width / 2, box!.y + box!.height / 2]);
        expect(onTop, `${name} is covered by ${onTop}`).not.toContain('family-offer');
    }

    // Closing the dialog brings it back — the offer has not been used yet.
    await page.locator('#person-modal').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.family-offer')).toBeVisible();
});

test('a person added from the toolbar is offered relatives, not left floating', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.locator('.family-offer .family-offer-close').click();

    // Adding from the toolbar creates somebody with no relatives: the form has
    // no relationships section (there is nobody to relate until Save), so the
    // offer is what leads on. It used to appear for the first person only,
    // leaving everyone added later unconnected with no hint at all.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const modal = page.locator('#person-modal');
    await modal.locator('#input-firstname').fill('Marie');
    await modal.locator('#input-lastname').fill('Svobodova');
    await modal.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('.family-offer')).toBeVisible();
    await page.locator('.family-offer .family-offer-btn').click();
    // …and it opens the wizard around the person just added.
    await expect(page.locator('#family-wizard-modal')).toHaveClass(/active/);
    await expect(page.locator('#family-wizard-anchor')).toContainText('Marie');
});
