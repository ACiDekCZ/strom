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
