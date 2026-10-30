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

    // Every button of the dialog is actually reachable: Save in the footer and
    // the × that closes it (a phone footer has no Cancel, T24).
    const buttons = {
        Save: page.locator('#person-modal').getByRole('button', { name: 'Save', exact: true }),
        close: page.locator('#person-modal .pm-header .close-btn'),
    };
    for (const [name, btn] of Object.entries(buttons)) {
        const box = await btn.boundingBox();
        const onTop = await page.evaluate(([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el?.className ?? '';
        }, [box!.x + box!.width / 2, box!.y + box!.height / 2]);
        expect(onTop, `${name} is covered by ${onTop}`).not.toContain('family-offer');
    }

    // Closing the dialog brings it back — the offer has not been used yet.
    await buttons.close.click();
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

/**
 * A message toast stands where the offer stands (bottom centre), under it:
 * "Undone: adding …" sat hidden under the offer. While a message shows the
 * offer steps aside (its time does not run), and it is back after; an offer
 * for a person whose adding was undone goes with the person.
 */
for (const width of [1440, 390]) {
    test(`a message toast is never under the family offer (${width})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
        const offer = page.locator('.family-offer-pill');
        await expect(offer).toBeVisible();

        await page.evaluate(() => window.Strom.UI.showToast('A message for the tree', 2500));
        const toast = page.locator('body > .toast.show');
        await expect(toast).toBeVisible();
        await expect(offer).toBeHidden();
        const box = (await toast.boundingBox())!;
        const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.toast'),
            [box.x + box.width / 2, box.y + box.height / 2]);
        expect(onTop).toBe(true);
        // Once the message is gone the offer is back.
        await expect(toast).toHaveCount(0, { timeout: 8000 });
        await expect(offer).toBeVisible();
    });
}

test('undoing the adding takes the offer for that person away', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await expect(page.locator('.family-offer-pill')).toBeVisible();
    await page.locator('body > .undo-toast .undo-toast-btn').click();
    await expect(page.locator('body > .toast.show')).toContainText('Undone');
    await expect(page.locator('.family-offer')).toHaveCount(0);
});

test('the offer speaks the UI language chosen while it shows', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    const pill = page.locator('.family-offer-pill');
    await expect(pill).toContainText('Continue with the rest of the family?');
    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await expect(pill).toContainText('Mit dem Rest der Familie fortfahren?');
    await expect(pill.locator('.family-offer-btn')).toHaveText('Familie hinzufügen');
    await expect(pill.locator('.family-offer-close')).toHaveAttribute('aria-label', 'Schließen');
    await page.evaluate(() => window.Strom.UI.setLanguage('cs' as never));
    await expect(pill).toContainText('Pokračovat zbytkem rodiny?');
});
