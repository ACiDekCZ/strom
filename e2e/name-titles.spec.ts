import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal, card } from './helpers.js';
import { expectFits } from './mobile-screens.js';

/**
 * Titles of the name (T07): "Title before name" / "Title after name" under the
 * name fields, behind the quiet "+ title" link while empty; the card, the
 * dialog's header and the lists show "Ing. Jan Novák ml." while Settings →
 * "Show titles" is on. Invented data.
 */

/**
 * The card's name: the whole name in its title (the text may break into a
 * given-name line and a surname line on a narrow card), and the two lines.
 */
async function expectCardName(page: Page, first: string, given: string, surname: string): Promise<void> {
    const name = card(page, first).locator('.name-text');
    await expect(name).toHaveAttribute('title', `${given} ${surname}`);
    await expect(name).toHaveAttribute('data-given', given);
    await expect(name).toHaveAttribute('data-surname', surname);
}

async function addTitles(page: Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novák', { birthDate: '1901' });
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    const more = modal.locator('#name-details .detail-more');
    await expect(modal.locator('#input-title-before')).toBeHidden();
    await expect(more).toHaveText('+ title');
    await more.click();
    await expect(modal.locator('#input-title-before')).toBeFocused();
    await modal.locator('#input-title-before').fill('Ing.');
    await modal.locator('#input-title-after').fill('ml.');
    // The header follows the form as it is typed.
    await expect(modal.locator('#pm-name')).toHaveText('Ing. Jan Novák ml.');
}

test('titles are entered in the person dialog and shown on the card, the setting hides them', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await addTitles(page);
    const modal = personModal(page);
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    expect(await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        return [p.firstName, p.lastName, p.titleBefore, p.titleAfter];
    })).toEqual(['Jan', 'Novák', 'Ing.', 'ml.']);
    await expectCardName(page, 'Jan', 'Ing. Jan', 'Novák ml.');
    // The avatar's initials come from the name, never from a title.
    await expect(card(page, 'Jan').locator('.avatar-initials')).toHaveText('JN');
    // A title is not searched.
    expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Ing').length)).toBe(0);

    // Reopened: filled titles show without the link.
    await cardAction(page, 'Jan', 'edit');
    await expect(modal.locator('#input-title-before')).toBeVisible();
    await expect(modal.locator('#input-title-before')).toHaveValue('Ing.');
    await expect(modal.locator('#input-title-after')).toHaveValue('ml.');
    await expect(modal.locator('#name-details .detail-more')).toBeHidden();
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();

    // Settings → Show titles (on by default) hides them and brings them back.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const toggle = page.locator('#show-titles-toggle');
    await expect(toggle).toBeChecked();
    await expect(page.locator('#settings-modal')).toContainText('Show titles');
    await toggle.uncheck();
    await expectCardName(page, 'Jan', 'Jan', 'Novák');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').showTitles)).toBe(false);
    await toggle.check();
    await expectCardName(page, 'Jan', 'Ing. Jan', 'Novák ml.');
});

test('a title cleared in the dialog is gone from the card and the data', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await addTitles(page);
    const modal = personModal(page);
    await modal.getByRole('button', { name: 'Save' }).click();
    await cardAction(page, 'Jan', 'edit');
    await modal.locator('#input-title-before').fill('');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expectCardName(page, 'Jan', 'Jan', 'Novák ml.');
    expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons()[0].titleBefore)).toBeUndefined();
});

test.describe('on a 360 px phone', () => {
    test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

    test('the two titles sit side by side under the name and fit the screen', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showAddPersonModal());
        const modal = personModal(page);
        await expect(modal).toBeVisible();
        const more = modal.locator('#name-details .detail-more');
        await expect(more).toBeVisible();
        // A finger's target, not a hairline of text.
        expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await more.tap();
        const before = (await modal.locator('#input-title-before').boundingBox())!;
        const after = (await modal.locator('#input-title-after').boundingBox())!;
        expect(Math.abs(before.y - after.y)).toBeLessThan(2);
        expect(after.x).toBeGreaterThan(before.x + before.width - 1);
        await expectFits(page, 'person form with titles');

        await modal.locator('#input-firstname').fill('Marie');
        await modal.locator('#input-lastname').fill('Svobodová');
        await modal.locator('#input-title-before').fill('MUDr.');
        await modal.getByRole('button', { name: 'Save' }).click();
        await expectCardName(page, 'Marie', 'MUDr. Marie', 'Svobodová');
    });
});

test('the undo toast, the duplicate hint and the timeline name a person with the titles', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'Petr', 'Dvořák');
    // A new person entered with the titles: the undo step says the name as the card does.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const modal = personModal(page);
    await modal.locator('#input-firstname').fill('Jan');
    await modal.locator('#input-lastname').fill('Novák');
    await modal.locator('#input-birthdate').fill('1901');
    await modal.locator('#name-details .detail-more').click();
    await modal.locator('#input-title-before').fill('Ing.');
    await modal.locator('#input-title-after').fill('ml.');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    await expect(page.locator('.undo-toast .undo-toast-msg').last()).toHaveText('adding Ing. Jan Novák ml.');

    // Typing the bare name of a new person offers him, with the titles.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await modal.locator('#input-firstname').fill('Jan');
    await modal.locator('#input-lastname').fill('Novák');
    await modal.locator('#input-birthdate').fill('1901');
    const panel = page.locator('#duplicate-suggest-person');
    await expect(panel.locator('.duplicate-suggest-name')).toHaveText('Ing. Jan Novák ml.');
    await panel.getByRole('button', { name: 'Go to person' }).click();
    await expect(modal).toBeHidden();

    // The timeline view's row.
    await page.locator('#view-mode-timeline').click();
    await expect(page.locator('#timeline-container .tl-name')).toHaveText(['Ing. Jan Novák ml. 1901–?']);
});

test('a research conflict about a title is named in words and marks the title\'s field', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await addTitles(page);
    const modal = personModal(page);
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    // What Strom Research writes (_STROM_CONFLICT, TYPE NPFX / NSFX), already read onto the person.
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        p.research = {
            conflicts: [
                { id: 'X0001', fact: 'NPFX', status: 'open', values: [{ value: 'Ing.' }, { value: '—' }] },
                { id: 'X0002', fact: 'NSFX', status: 'open', values: [{ value: 'ml.' }, { value: 'st.' }] },
            ],
        };
    });
    await cardAction(page, 'Jan', 'edit');
    const before = modal.locator('label[for="input-title-before"] .pm-conflict-tag');
    await expect(before).toHaveText('conflict ›');
    await expect(before).toHaveAttribute('aria-label', /^Title before name: /);
    await expect(modal.locator('label[for="input-title-after"] .pm-conflict-tag')).toHaveAttribute('aria-label', /^Title after name: /);
    await before.click();
    const dialog = page.locator('#person-research-modal');
    await expect(dialog.locator('.person-research-fact')).toHaveText(['Title before name', 'Title after name']);
    await expect(dialog).not.toContainText('NPFX');
    await expect(dialog).not.toContainText('NSFX');
    await page.keyboard.press('Escape');
    await modal.getByRole('button', { name: 'Cancel' }).click();

    // With no title left (the field folded behind "+ title"), the given name carries the mark.
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        delete p.titleBefore;
        delete p.titleAfter;
    });
    await cardAction(page, 'Jan', 'edit');
    await expect(modal.locator('#input-title-before')).toBeHidden();
    await expect(modal.locator('label[for="input-firstname"] .pm-conflict-tag')).toHaveCount(1);
});
