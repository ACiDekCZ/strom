import { test, expect, Page, Locator } from '@playwright/test';
import { card, cardAction } from './helpers.js';

/**
 * German UI smoke: with the system language set to German, the main dialogs
 * must be fully translated — no common English UI word may leak into their
 * visible text (or input placeholders), and <html lang> is "de".
 */
test.use({ locale: 'de-DE' });

/**
 * English words that never occur in German UI text. Whole-word, case-sensitive
 * matching; words that are identical in German (Export, Import, Name, Partner,
 * Download, Status, Details, Person…) are deliberately absent.
 */
const ENGLISH_WORDS = [
    'the', 'and', 'with', 'your', 'you', 'of', 'to', 'for', 'from', 'this', 'that', 'is', 'are',
    'Save', 'Cancel', 'Close', 'Delete', 'Edit', 'Add', 'Remove', 'Settings', 'Statistics',
    'Relationship', 'Relationships', 'Family', 'Children', 'Parents', 'Siblings', 'Birth', 'Death',
    'Born', 'Died', 'Date', 'Place', 'Notes', 'persons', 'people', 'Show', 'Hide',
    'Choose', 'Select', 'Yes', 'Back', 'Next', 'Search', 'Language', 'Open', 'Create', 'New',
    'Rename', 'Title', 'Generations', 'Chapters', 'Photos', 'Sources', 'Unknown', 'Male',
    'Female', 'Living', 'Privacy', 'Password', 'Tree', 'Trees', 'Book', 'Married', 'Divorced',
];

/** Product/format names that legitimately stay English in any language. */
const PRODUCT_NAMES = /FamilySearch|Google Sheets|Google|Excel|GEDCOM|MyHeritage|Ancestry|Geni|WikiTree/g;

async function visibleText(dialog: Locator): Promise<string> {
    return dialog.evaluate((root) => {
        const parts: string[] = [(root as HTMLElement).innerText];
        root.querySelectorAll('input, textarea').forEach((el) => {
            const input = el as HTMLInputElement;
            if (input.offsetParent !== null && input.placeholder) parts.push(input.placeholder);
        });
        return parts.join('\n');
    });
}

async function expectNoEnglish(dialog: Locator, what: string): Promise<void> {
    await expect(dialog).toBeVisible();
    const text = (await visibleText(dialog)).replace(PRODUCT_NAMES, ' ');
    const leaks = ENGLISH_WORDS.filter((w) => new RegExp(`(^|[^\\p{L}])${w}(?![\\p{L}])`, 'u').test(text));
    expect.soft(leaks, `${what} shows English words: ${leaks.join(', ')}\n---\n${text}`).toEqual([]);
}

/** Create Hans + Greta Müller with a child Karl (language-independent selectors). */
async function buildGermanFamily(page: Page): Promise<void> {
    await page.locator('#empty-state button').first().click();
    const modal = page.locator('#person-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#input-firstname').fill('Hans');
    await modal.locator('#input-lastname').fill('Müller');
    await modal.locator('#input-birthdate').fill('1950');
    await modal.locator('#btn-save').click();
    await expect(modal).toBeHidden();

    for (const [action, first, gender] of [['partner', 'Greta', 'female'], ['child', 'Karl', 'male']] as const) {
        await cardAction(page, 'Hans', action);
        const rel = page.locator('#relation-modal');
        await expect(rel).toBeVisible();
        await rel.locator('#rel-firstname').fill(first);
        await rel.locator('#rel-lastname').fill('Müller');
        if (gender === 'female') await rel.locator('#rel-gender').selectOption('female');
        await rel.locator('#rel-submit-btn').click();
        await expect(rel).toBeHidden();
    }
    await expect(card(page, 'Karl')).toBeVisible();
}

async function closeWithEscape(page: Page, dialog: Locator): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
}

test('German UI: html lang and the main dialogs are free of English words', async ({ page }) => {
    await page.goto('/strom.html');
    await expect(page.locator('.toolbar')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');

    await buildGermanFamily(page);
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());

    // Add person (empty form).
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const personModal = page.locator('#person-modal');
    await expectNoEnglish(personModal, 'Add person');
    await closeWithEscape(page, personModal);

    // Person edit.
    await cardAction(page, 'Hans', 'edit');
    await expectNoEnglish(personModal, 'Edit person');

    // Relationships panel (opened from the edit dialog).
    await personModal.locator('#link-relationships').click();
    const rels = page.locator('#relationships-modal');
    await expectNoEnglish(rels, 'Relationships panel');
    await closeWithEscape(page, rels);
    await closeWithEscape(page, personModal);

    // Export dialog.
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    const exportModal = page.locator('#export-modal');
    await expectNoEnglish(exportModal, 'Export dialog');
    // …and its password/privacy step (privacy mode options included).
    await exportModal.locator('.menu-option[onclick*="exportTargetTreeJSON"]').click();
    const pwd = page.locator('#export-password-modal');
    await expectNoEnglish(pwd, 'Export password/privacy dialog');
    await closeWithEscape(page, pwd);

    // Card context menu.
    await card(page, 'Hans').click();
    const menu = page.locator('.context-menu');
    await expectNoEnglish(menu, 'Context menu');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Anniversaries panel.
    await page.evaluate(() => window.Strom.UI.showAnniversariesDialog());
    const ann = page.locator('#anniversaries-modal');
    await expectNoEnglish(ann, 'Anniversaries');
    await closeWithEscape(page, ann);

    // Tree manager.
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    await expect(manager.locator('.tree-manager-item').first()).toBeVisible();
    await expectNoEnglish(manager, 'Tree manager');
    await closeWithEscape(page, manager);

    // Settings.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await expectNoEnglish(settings, 'Settings');
    await closeWithEscape(page, settings);

    // Tree statistics.
    await page.evaluate((id) => window.Strom.UI.showTreeStatsDialog(id), treeId);
    const stats = page.locator('#tree-stats-modal');
    await expect(stats).toContainText('3');
    await expectNoEnglish(stats, 'Statistics');
    await closeWithEscape(page, stats);

    // Kinship calculator with a result.
    await cardAction(page, 'Hans', 'relationship');
    const kin = page.locator('#kinship-modal');
    await expect(kin).toBeVisible();
    await kin.locator('.person-picker-input').fill('Karl');
    await kin.locator('.person-picker-item', { hasText: 'Karl' }).first().click();
    await expect(kin.locator('#kinship-result')).toBeVisible();
    await expectNoEnglish(kin, 'Kinship calculator');
    await closeWithEscape(page, kin);

    // Family book dialog.
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const book = page.locator('#book-modal');
    await expectNoEnglish(book, 'Book dialog');
    await closeWithEscape(page, book);
});
