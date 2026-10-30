import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, openResearch, openResearchMenu, poll, links, UUID } from './research-bridge.js';

/**
 * Research tools: the Research menu's "Research tools ›" (under "Other actions")
 * opens a page in place with the research's own actions that have no place of
 * their own in the app, grouped Look / Assign work / Run the agent; each one
 * opens the research's terminal (`strom-research://<action>?tree=…`). Only what
 * the research announces in `links` shows: none, no item.
 */

const BASE_LINKS = ['send', 'open', 'live', 'app', 'setup'];

async function research(page: Page, extra: string[] = ['doctor']): Promise<void> {
    await fakeBridge(page, { links: [...BASE_LINKS, ...extra] });
    await openResearch(page);
    await poll(page);
}

const menu = (page: Page): Locator => page.locator('#research-menu');
const toolsItem = (page: Page): Locator => page.locator('#research-item-tools');
const doctor = (page: Page): Locator => page.locator('#research-tool-doctor');

test.describe('research tools', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('no announced tool: no item, nothing grey', async ({ page }) => {
        await research(page, []);
        await openResearchMenu(page, { expandMore: true });
        await expect(menu(page)).toBeVisible();
        await expect(page.locator('#research-item-more')).toHaveAttribute('aria-expanded', 'true');
        await expect(toolsItem(page)).toHaveCount(0);
        await expect(page.locator('.research-tool-item')).toHaveCount(0);
    });

    test('the page in place: back, the group with its heading, the tool with its description and mark, the footer; the tool opens the research', async ({ page }) => {
        await research(page);
        await openResearchMenu(page, { expandMore: true });
        await expect(toolsItem(page).locator('.research-item-label')).toHaveText('Research tools');
        await expect(toolsItem(page).locator('.research-item-chev')).toHaveText('›');
        await expect(toolsItem(page).locator('.research-open-mark')).toHaveCount(0);
        await expect(toolsItem(page)).toHaveAttribute('aria-haspopup', 'menu');

        await toolsItem(page).click();
        await expect(menu(page)).toBeVisible();
        await expect(menu(page).locator('.research-tools-heading .research-menu-title')).toHaveText('Research tools');
        await expect(menu(page).locator('.research-tools-group-title')).toHaveText(['Look']);
        await expect(doctor(page)).toBeFocused();
        await expect(doctor(page).locator('.research-tool-title')).toHaveText('Research check');
        await expect(doctor(page).locator('.research-tool-desc')).toBeVisible();
        await expect(doctor(page)).toHaveAttribute('aria-label', 'Research check, opens in the research');
        await expect(doctor(page)).toHaveAttribute('aria-description', 'Checks the installation and the data of the research (doctor).');
        await expect(doctor(page).locator('.research-open-mark')).toHaveCount(1);
        await expect(doctor(page).locator('.research-ai-badge')).toHaveCount(0);
        await expect(menu(page).locator('.research-tools-foot'))
            .toHaveText('Everything is confirmed in the research. For AI, the research shows the cost before it starts.');
        // The rest of the menu is not on this page.
        await expect(page.locator('#research-item-more')).toHaveCount(0);

        await doctor(page).click();
        expect(await links(page)).toEqual([`strom-research://doctor?tree=${UUID}`]);
        await expect(menu(page)).toBeHidden();

        // Opened again: the menu itself, not the tools page.
        await openResearchMenu(page);
        await expect(page.locator('#research-item-more')).toBeVisible();
        await expect(doctor(page)).toHaveCount(0);
    });

    test('back: "‹" and ← return to the menu, focus on "Research tools"; → opens the page', async ({ page }) => {
        await research(page);
        await openResearchMenu(page, { expandMore: true });
        await toolsItem(page).click();
        await expect(doctor(page)).toBeFocused();
        await menu(page).locator('.research-tools-back').click();
        await expect(menu(page)).toBeVisible();
        await expect(toolsItem(page)).toBeFocused();

        await page.keyboard.press('ArrowRight');
        await expect(doctor(page)).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(toolsItem(page)).toBeFocused();
        await expect(menu(page)).toBeVisible();
    });

    test('phone: the More sheet\'s research page opens the tools in the sheet, 48 px rows without the description', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await research(page);
        await openResearchMenu(page);
        const sheet = page.locator('#research-sheet-menu');
        await expect(sheet.locator('#research-item-tools')).toBeVisible();
        await sheet.locator('#research-item-tools').click();
        const row = sheet.locator('#research-tool-doctor');
        await expect(row).toBeVisible();
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(48);
        await expect(row.locator('.research-tool-desc')).toBeHidden();
        await expect(row).toHaveAttribute('aria-description', /doctor/);
        await sheet.locator('.research-tools-back').click();
        await expect(sheet.locator('#research-item-tools')).toBeVisible();
        await sheet.locator('#research-item-tools').click();
        await row.click();
        expect(await links(page)).toEqual([`strom-research://doctor?tree=${UUID}`]);
        await expect(sheet).toBeHidden();
    });
});
