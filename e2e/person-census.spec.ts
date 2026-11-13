import { test, expect, Page } from '@playwright/test';
import { openApp, cardAction, personModal } from './helpers.js';

/**
 * A census as a person's own event (spec 053 K1.1): chosen in the event
 * editor, with its date, place, house and age, a source with its picture cited
 * on it, kept in the person's life list and in the tree. Invented data.
 */

/** A one-pixel PNG standing in for the census sheet. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function tree(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async (png) => {
        window.Strom.SettingsManager.setAdvancedFields(true);
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                b: {
                    id: 'b', firstName: 'Bertolf', lastName: 'Quendrik', gender: 'male', birthDate: '1840', deathDate: '1912',
                    isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
                },
            },
            partnerships: {},
            sources: {
                s1: { id: 's1', title: 'Census Hollowmere 1880', excerpts: [{ id: 'x1', dataUrl: png, width: 1, height: 1, sizeBytes: 70 }] },
            },
        } as never, 'Quendrik');
    }, PNG);
}

const getData = (page: Page) => page.evaluate(() => window.Strom.DataManager.getData() as unknown as {
    persons: Record<string, { events?: Record<string, unknown>[] }>;
});

test.describe('census at a person', () => {
    test('added in the event editor with date, place, house, age and a cited source with its picture', async ({ page }) => {
        await tree(page);
        await cardAction(page, 'Bertolf', 'edit');
        const modal = personModal(page);
        await modal.locator('#btn-add-event').click();
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toBeVisible();

        const type = editor.locator('#input-event-type');
        await expect(type.locator('option[value="census"]')).toHaveText('Census');
        await type.selectOption('census');
        await editor.locator('#input-event-date').fill('31 Dec 1880');
        await editor.locator('#input-event-place').fill('Hollowmere');
        // A census lists the age and the house: both behind the quiet link.
        const more = editor.locator('.detail-more');
        await expect(more).toHaveText('+ age, address');
        await more.click();
        await editor.locator('#input-event-age').fill('40');
        await editor.locator('#input-event-address').fill('Mill Lane 12');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();

        // Its source, the census sheet with its picture: cited on the saved event.
        await modal.locator('#events-list .event-edit-btn').first().click();
        await expect(editor).toBeVisible();
        await expect(type).toHaveValue('census');
        await expect(editor.locator('#input-event-address')).toHaveValue('Mill Lane 12');
        await editor.locator('#btn-cite-event').click();
        const picker = page.locator('#source-picker-modal');
        await expect(picker).toHaveClass(/active/);
        await picker.locator('.source-picker-item', { hasText: 'Census Hollowmere 1880' }).click();
        await expect(picker).not.toHaveClass(/active/);
        await expect(editor.locator('#event-sources-chips .source-chip-label')).toHaveText('Census Hollowmere 1880');

        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();
        await expect(modal.locator('#events-list')).toContainText('Census');
        await expect(modal.locator('#events-list')).toContainText('Hollowmere');
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(modal).toBeHidden();

        const data = await getData(page);
        expect(data.persons.b.events).toHaveLength(1);
        expect(data.persons.b.events![0]).toMatchObject({
            type: 'census', date: '1880-12-31', place: 'Hollowmere', address: 'Mill Lane 12', age: '40', sourceIds: ['s1'],
        });
        expect(data.persons.b.events![0].customLabel).toBeUndefined();
    });

    test('named in the language of the app', async ({ page }) => {
        await tree(page);
        for (const [lang, name] of [['cs', 'Sčítání lidu'], ['de', 'Volkszählung'], ['pl', 'Spis ludności']] as const) {
            await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
            await cardAction(page, 'Bertolf', 'edit');
            await personModal(page).locator('#btn-add-event').click();
            const editor = page.locator('#event-editor-modal');
            await expect(editor.locator('#input-event-type option[value="census"]')).toHaveText(name);
            await page.keyboard.press('Escape');
            await expect(editor).toBeHidden();
            await page.keyboard.press('Escape');
            await expect(personModal(page)).toBeHidden();
        }
    });
});
