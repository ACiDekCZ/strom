import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * The research's translation of a source's transcript (a "Překlad:" section of
 * the source's note in its GEDCOM): the source viewer shows it folded under the
 * transcript; a source without one looks as before; the note editor keeps the
 * note raw, so saving the source does not lose the translation. Invented data.
 */

async function importFixture(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await page.evaluate(() => window.Strom.UI.startGedcomImportPlain());
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/research-source-translation.ged');
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();
}

const openSource = (page: Page, ref: string) => page.evaluate((ref) => {
    const src = Object.values(window.Strom.DataManager.getData().sources ?? {}).find((s: { refn?: string }) => s.refn === ref) as { id: string };
    window.Strom.UI.showSourceViewer(src.id, null);
}, ref);

const viewer = (page: Page) => page.locator('#source-viewer-modal');

test.describe('translation of a transcript', () => {
    test('folded under the transcript; opens by click and keyboard; shows the text', async ({ page }) => {
        await importFixture(page);
        await openSource(page, 'S0001');
        const v = viewer(page);
        await expect(v).toBeVisible();
        await expect(v.locator('.viewer-transcript')).toHaveText('Родилась Вендула, дочь Цтибора Квапила\nи жены его Анны.');
        const block = v.locator('details.viewer-translation');
        await expect(block).toHaveCount(1);
        await expect(block).not.toHaveAttribute('open', '');
        const summary = block.locator('summary');
        await expect(summary).toHaveText('Translation of the transcript');
        await expect(block.locator('.viewer-translation-text')).toBeHidden();
        // In the transcript's section, after it.
        await expect(v.locator('section', { has: page.locator('.viewer-transcript') }).locator('details.viewer-translation')).toHaveCount(1);

        await summary.click();
        await expect(block).toHaveAttribute('open', '');
        await expect(block.locator('.viewer-translation-text')).toHaveText('Narodila se Vendula, dcera Ctibora Kvapila\na jeho manželky Anny.');
        // Keyboard: the summary takes focus and Enter folds it again.
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(block).not.toHaveAttribute('open', '');
        await page.keyboard.press(' ');
        await expect(block).toHaveAttribute('open', '');
    });

    test('a source without a translation has no block', async ({ page }) => {
        await importFixture(page);
        await openSource(page, 'S0002');
        const v = viewer(page);
        await expect(v).toBeVisible();
        await expect(v.locator('.viewer-transcript')).toHaveText('Zemřela Vendula Kvapilová');
        await expect(v.locator('.viewer-translation')).toHaveCount(0);
    });

    test('the note editor keeps the section raw; saving keeps the translation', async ({ page }) => {
        await importFixture(page);
        await openSource(page, 'S0001');
        await viewer(page).locator('#source-viewer-edit').click();
        const editor = page.locator('#source-editor-modal');
        await expect(editor).toBeVisible();
        await expect(editor.locator('#input-source-note')).toHaveValue(
            'Evidence: original, primary\n\nPřeklad:\nNarodila se Vendula, dcera Ctibora Kvapila\na jeho manželky Anny.');
        await editor.locator('#input-source-title').fill('Метрическая книга 1881');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(viewer(page)).toBeVisible();
        await expect(viewer(page).locator('#source-viewer-title')).toHaveText('Метрическая книга 1881');
        await viewer(page).locator('details.viewer-translation summary').click();
        await expect(viewer(page).locator('.viewer-translation-text')).toHaveText('Narodila se Vendula, dcera Ctibora Kvapila\na jeho manželky Anny.');
    });
});
