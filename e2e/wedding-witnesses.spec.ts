import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * Wedding witnesses edited like godparents at a baptism: a role, a name as
 * the register writes it or a link to someone in the tree, a note — in their
 * own dialog over the relationships panel, opened from "+ witness" or a
 * witness's chip. Cancel takes the rows back. Invented data.
 */

async function setup(page: Page): Promise<void> {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        const marie = dm.createPerson({ firstName: 'Marie', lastName: 'Novakova', gender: 'female' });
        dm.createPerson({ firstName: 'Frantisek', lastName: 'Kolar', gender: 'male' });
        dm.createPartnership(jan.id, marie.id);
        window.Strom.UI.showRelationshipsPanel(jan.id);
    });
}

const witnesses = (page: Page) => page.evaluate(() =>
    (Object.values(window.Strom.DataManager.getData().partnerships)[0].participants ?? [])
        .map((p: { role: string; name?: string; personId?: string; note?: string }) => ({
            role: p.role, name: p.name, linked: !!p.personId, note: p.note,
        })));

test.describe('wedding witnesses', () => {
    test('a witness linked to someone in the tree, another with a role and a note', async ({ page }) => {
        await setup(page);
        const panel = page.locator('#relationships-modal');
        await panel.locator('.partnership-witness-btn').click();
        const editor = page.locator('#wedding-witnesses-modal');
        await expect(editor).toBeVisible();

        // The first row: linked to Frantisek in the tree.
        const first = editor.locator('.participant-row').first();
        await expect(first.locator('.participant-role')).toHaveValue('witness');
        await first.locator('.participant-link').click();
        await expect(page.locator('#participant-picker-modal')).toHaveClass(/active/);
        await page.locator('#participant-picker input').fill('Frantisek');
        await page.locator('#participant-picker .person-picker-item, #participant-picker [data-person-id]').first().click();
        await expect(first.locator('.participant-name')).toHaveValue('Frantisek Kolar');
        await expect(editor).toBeVisible();

        // The second: the priest, typed as the register writes him, with a note.
        await editor.getByRole('button', { name: '+ Add' }).click();
        const second = editor.locator('.participant-row').last();
        await second.locator('.participant-role').selectOption('officiant');
        await second.locator('.participant-name').fill('P. Josef Rybka');
        await second.locator('.participant-note').fill('farář');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();

        expect(await witnesses(page)).toEqual([
            { role: 'witness', name: 'Frantisek Kolar', linked: true, note: undefined },
            { role: 'officiant', name: 'P. Josef Rybka', linked: false, note: 'farář' },
        ]);
        const chips = panel.locator('.partnership-witnesses .source-chip');
        await expect(chips).toHaveCount(2);
        await expect(chips.first()).toHaveClass(/is-linked/);
        await expect(chips.last()).toContainText('Officiant: P. Josef Rybka');

        // The panel's Save keeps them.
        await panel.getByRole('button', { name: 'Save' }).click();
        await expect(panel).toBeHidden();
        expect(await witnesses(page)).toHaveLength(2);
    });

    test('a chip opens the editor; Cancel asks and takes the rows back', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const u = Object.values(dm.getData().partnerships)[0] as { id: string };
            dm.addPartnershipParticipant(u.id as never, { name: 'Vaclav Sedlak' });
            window.Strom.UI.refreshRelationshipsPanel();
        });
        const panel = page.locator('#relationships-modal');
        await panel.locator('.partnership-witness-open').click();
        const editor = page.locator('#wedding-witnesses-modal');
        await expect(editor.locator('.participant-name')).toHaveValue('Vaclav Sedlak');
        await editor.locator('.participant-del').click();
        await expect(editor.locator('.participant-row')).toHaveCount(0);

        // Escape asks about the edited rows; discarding keeps the witness.
        await page.keyboard.press('Escape');
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toBeVisible();
        await confirm.locator('#confirm-discard-btn').click();
        await expect(editor).toBeHidden();
        await expect(panel).toBeVisible();
        expect(await witnesses(page)).toEqual([{ role: 'witness', name: 'Vaclav Sedlak', linked: false, note: undefined }]);
    });

    test('opened and closed untouched, nothing changes and nothing is asked', async ({ page }) => {
        await setup(page);
        const panel = page.locator('#relationships-modal');
        await panel.locator('.partnership-witness-btn').click();
        const editor = page.locator('#wedding-witnesses-modal');
        await expect(editor).toBeVisible();
        await editor.getByRole('button', { name: 'Cancel' }).click();
        await expect(editor).toBeHidden();
        await expect(page.locator('#confirmation-modal')).toBeHidden();
        expect(await witnesses(page)).toEqual([]);
    });
});
