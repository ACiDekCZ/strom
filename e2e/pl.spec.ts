import { test, expect, Page, Locator } from '@playwright/test';
import { card, cardAction, openApp } from './helpers.js';

/**
 * Polish UI smoke: a browser in Polish gets the Polish UI by itself
 * (<html lang="pl">), the main view and dialogs show no English or Czech UI
 * words, and the language can be switched to Polski in the Settings and back.
 */
test.use({ locale: 'pl-PL' });

/** English words that never occur in Polish UI text (whole words, case-sensitive; not "to", a Polish word too). */
const ENGLISH_WORDS = [
    'the', 'and', 'with', 'your', 'you', 'of', 'for', 'from', 'this', 'that', 'is', 'are',
    'Save', 'Cancel', 'Close', 'Delete', 'Edit', 'Add', 'Remove', 'Settings', 'Statistics',
    'Relationship', 'Relationships', 'Family', 'Children', 'Parents', 'Siblings', 'Birth', 'Death',
    'Born', 'Died', 'Date', 'Place', 'Notes', 'persons', 'people', 'Show', 'Hide',
    'Choose', 'Select', 'Yes', 'Back', 'Next', 'Search', 'Language', 'Open', 'Create', 'New',
    'Rename', 'Title', 'Generations', 'Photos', 'Sources', 'Unknown', 'Male',
    'Female', 'Living', 'Privacy', 'Password', 'Tree', 'Trees', 'Book', 'Married', 'Divorced',
];

/** Czech words that never occur in Polish UI text (the Polish texts were translated with the Czech ones beside them). */
const CZECH_WORDS = [
    'Uložit', 'Zrušit', 'Zavřít', 'Smazat', 'Upravit', 'Přidat', 'Nastavení', 'Hledat', 'narození', 'úmrtí',
    'sňatek', 'stromu', 'výzkum', 'rodiče', 'děti', 'který', 'není', 'jsou', 'také', 'osob', 'Jazyk',
];

const PRODUCT_NAMES = /FamilySearch|Google Sheets|Google|Excel|GEDCOM|MyHeritage|Ancestry|Geni|WikiTree/g;

async function visibleText(root: Locator): Promise<string> {
    return root.evaluate((el) => {
        const parts: string[] = [(el as HTMLElement).innerText];
        el.querySelectorAll('input, textarea').forEach((node) => {
            const input = node as HTMLInputElement;
            if (input.offsetParent !== null && input.placeholder) parts.push(input.placeholder);
        });
        return parts.join('\n');
    });
}

async function expectPolishOnly(root: Locator, what: string): Promise<void> {
    await expect(root).toBeVisible();
    const text = (await visibleText(root)).replace(PRODUCT_NAMES, ' ');
    const words = [...ENGLISH_WORDS, ...CZECH_WORDS];
    const leaks = words.filter((w) => new RegExp(`(^|[^\\p{L}])${w}(?![\\p{L}])`, 'u').test(text));
    expect.soft(leaks, `${what} shows English or Czech words: ${leaks.join(', ')}\n---\n${text}`).toEqual([]);
}

/** Wojciech + Bronisława Zaremba with a son Teofil (fictional; language-independent selectors). */
async function buildPolishFamily(page: Page): Promise<void> {
    await page.locator('#empty-state button').first().click();
    const modal = page.locator('#person-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#input-firstname').fill('Wojciech');
    await modal.locator('#input-lastname').fill('Zaremba');
    await modal.locator('#input-birthdate').fill('1950');
    await modal.locator('#btn-save').click();
    await expect(modal).toBeHidden();

    for (const [action, first, gender] of [['partner', 'Bronisława', 'female'], ['child', 'Teofil', 'male']] as const) {
        await cardAction(page, 'Wojciech', action);
        const rel = page.locator('#relation-modal');
        await expect(rel).toBeVisible();
        await rel.locator('#rel-firstname').fill(first);
        await rel.locator('#rel-lastname').fill('Zaremba');
        await rel.locator('#rel-gender').selectOption(gender);
        await rel.locator('#rel-submit-btn').click();
        await expect(rel).toBeHidden();
    }
    await expect(card(page, 'Teofil')).toBeVisible();
}

async function closeWithEscape(page: Page, dialog: Locator): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
}

test('Polish UI: a Polish browser gets Polish; the main view and dialogs speak Polish only', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/strom.html');
    await expect(page.locator('.toolbar')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('pl');
    await expectPolishOnly(page.locator('#empty-state'), 'Empty state');

    await buildPolishFamily(page);
    await expectPolishOnly(page.locator('.toolbar'), 'Toolbar');

    // Person edit with a plural count in the relationships panel.
    const personModal = page.locator('#person-modal');
    await cardAction(page, 'Wojciech', 'edit');
    await expectPolishOnly(personModal, 'Edit person');
    await closeWithEscape(page, personModal);

    // Card context menu.
    await card(page, 'Wojciech').click();
    const menu = page.locator('.context-menu');
    await expectPolishOnly(menu, 'Context menu');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Settings: the language row offers Polski, chosen by the system language.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await expectPolishOnly(settings, 'Settings');
    await expect(settings.locator('input[name="language"][value="pl"]')).toHaveCount(1);
    await expect(settings.locator('label.settings-radio', { hasText: 'Polski' })).toBeVisible();
    await closeWithEscape(page, settings);

    // Kinship in Polish: the son.
    await cardAction(page, 'Wojciech', 'relationship');
    const kin = page.locator('#kinship-modal');
    await expect(kin).toBeVisible();
    await kin.locator('.person-picker-input').fill('Teofil');
    await kin.locator('.person-picker-item', { hasText: 'Teofil' }).first().click();
    await expect(kin.locator('#kinship-result .kinship-term')).toHaveText(/syn/);
    await expectPolishOnly(kin, 'Kinship calculator');
    await closeWithEscape(page, kin);

    // Tree overview with every section expanded (counts with Polish plurals).
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((id) => window.Strom.UI.showTreeOverview(id), treeId);
    const overview = page.locator('#tree-overview-modal .modal.tov');
    await expect(overview.locator('.tov-nums')).toContainText('3');
    const closed = overview.locator('.tov-sec-head[aria-expanded="false"]');
    while (await closed.count() > 0) await closed.first().click();
    await expect(overview.locator('.tov-sec[data-ready="true"]')).toHaveCount(7);
    await expectPolishOnly(overview, 'Tree overview');
    await closeWithEscape(page, overview);
});

test('Polish UI: chosen in the Settings and back to English', async ({ page }) => {
    await page.context().clearCookies();
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.setLanguage('en'));
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');

    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await expect(settings).toBeVisible();
    await settings.locator('label.settings-radio', { hasText: 'Polski' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('pl');
    await expect(settings.locator('#settings-language-label')).toHaveText('Język');
    await expect(settings.locator('input[name="language"][value="pl"]')).toBeChecked();
    await closeWithEscape(page, settings);

    // The choice survives a reload.
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('pl');

    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await settings.locator('label.settings-radio', { hasText: 'English' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
    await expect(settings.locator('#settings-language-label')).toHaveText('Language');
});
