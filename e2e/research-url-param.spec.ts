import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * `?research=<uuid>` (the macOS widget's link): among trees of one name the
 * one tied to that research opens, so the Research menu is there; the
 * parameter does not stay in the address.
 */

const UUID = '6a1d0e3c-2b4f-4a7e-9c58-1f0e2d3c4b5a';

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 OCT 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 3f2a9c1e5b7d',
        '1 CHAR UTF-8', '1 NOTE Fíškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 REFN P0001',
        '0 TRLR',
    ].join('\n');
}

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'tree-strom.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

test('?research= opens the research tree among trees of the same name', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const researchName = await test.step('a tree of its own first, then the research tree of the same name', async () => {
        await dropFile(page, researchGed());
        await expect(card(page, 'Josef')).toBeVisible();
        return page.evaluate(async () => {
            const { TreeManager, DataManager } = window.Strom;
            const research = TreeManager.getTreeMetadata(DataManager.getCurrentTreeId()!)!;
            const own = TreeManager.createTree(research.name);
            // The own tree first in the list: what a plain `?tree=<name>` finds.
            const index = (TreeManager as unknown as { index: { trees: Array<{ id: string }> } }).index;
            index.trees.sort((a, b) => (a.id === own ? -1 : b.id === own ? 1 : 0));
            (TreeManager as unknown as { saveIndex(): void }).saveIndex();
            await TreeManager.flush();
            return research.name;
        });
    });
    const slug = researchName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    await page.goto(`/strom.html?tree=${slug}`);
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await expect(page.locator('#research-menu-btn')).toBeHidden();

    await page.goto(`/strom.html?tree=${slug}&research=${UUID}`);
    await expect(card(page, 'Josef')).toBeVisible();
    await expect(page.locator('#research-menu-btn')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.has('research')).toBe(false);
    expect(new URL(page.url()).searchParams.get('tree')).toMatch(new RegExp(`^${slug}--`));
});
