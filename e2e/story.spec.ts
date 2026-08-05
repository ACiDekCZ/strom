import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal } from './helpers.js';

/**
 * The narrative: a long text written about a person, imported from GEDCOM
 * (_STORY) or typed here. It is research-side, so it follows the same rule as
 * the other research fields — out of the way until asked for, never hidden once
 * something is written.
 */

test('the story field is out of the way until asked for', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');
    await expect(personModal(page).locator('#pm-story-section')).toBeHidden();

    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await page.locator('#person-modal .modal-close, #person-modal').first().press('Escape');
    await cardAction(page, 'Jan', 'edit');
    await expect(personModal(page).locator('#pm-story-section')).toBeVisible();
});

test('a story is typed, saved and read back — and shows even with research fields off', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-story-title').fill('Nemanzelsky syn z cp. 22');
    await modal.locator('#input-story').fill('Prvni odstavec.\n\nDruhy odstavec.');
    await modal.locator('#btn-save').click();
    await expect(modal).toBeHidden();

    const saved = await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Jan');
        return (p as { story?: { title?: string; text: string; status?: string } }).story;
    });
    expect(saved?.title).toBe('Nemanzelsky syn z cp. 22');
    expect(saved?.text).toBe('Prvni odstavec.\n\nDruhy odstavec.');
    // draft/final is not editable in the app — it only travels with the file.
    expect(saved?.status).toBeUndefined();

    // Written data is never hidden by the research-fields switch.
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(false));
    await cardAction(page, 'Jan', 'edit');
    await expect(modal.locator('#pm-story-section')).toBeVisible();
    await expect(modal.locator('#input-story')).toHaveValue('Prvni odstavec.\n\nDruhy odstavec.');
});

test('a story imported from GEDCOM survives the form and the export', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak');
    // As the importer leaves it: facts and caveat belong to whoever wrote it.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        dm.updatePerson(jan.id, {
            story: {
                kind: 'vypraveni', title: 'Kapitola', status: 'final',
                text: 'Text z matrik.', facts: ['BIRT 5 MAY 1863 [K-04]'],
                note: 'Neni pramen.',
            },
        });
        window.Strom.TreeRenderer.render();
    });

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    // The facts and the caveat are shown, read-only, under the text.
    await expect(modal.locator('#story-facts')).toContainText('BIRT 5 MAY 1863 [K-04]');
    await expect(modal.locator('#story-facts')).toContainText('Neni pramen.');

    // Editing only the text keeps everything the file brought with it.
    await modal.locator('#input-story').fill('Prepsany text.');
    await modal.locator('#btn-save').click();
    await expect(modal).toBeHidden();

    const story = await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0] as {
            story?: { kind?: string; status?: string; text: string; facts?: string[]; note?: string };
        };
        return p.story;
    });
    // status among them: the app has no control for it, and it still comes back
    // out of the form exactly as the file wrote it.
    expect(story).toMatchObject({
        kind: 'vypraveni', status: 'final', text: 'Prepsany text.',
        facts: ['BIRT 5 MAY 1863 [K-04]'], note: 'Neni pramen.',
    });
});
