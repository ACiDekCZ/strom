import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Links into Strom Research (strom-research://): the research announces them
 * whenever it talks to the app from this computer; the app then offers
 * "send changes" in one click and excerpts at full quality — on a computer
 * only, for research trees only, unless switched off in Settings.
 * Launching a link is recorded instead of handed to the system.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const BRIDGE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 3f2a9c1e5b7d',
        '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @P0001@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research',
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

/** A research tree with one source S0042 carrying an excerpt; launches recorded. */
async function setup(page: Page): Promise<void> {
    await openApp(page);
    await dropFile(page, researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
    await page.evaluate((png) => {
        const DM = window.Strom.DataManager;
        const jan = DM.getAllPersons()[0] as { id: string };
        const src = DM.addSource({ title: 'Krest Jan', refn: 'S0042',
            excerpts: [{ id: 'e1', dataUrl: png, width: 1, height: 1, sizeBytes: 70 }] })!;
        DM.citePerson(jan.id, src.id);
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.launchResearchLink = (url: string) => { launched.push(url); };
    }, PNG);
}

const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

/** The research answers the bridge status — with or without its links. */
async function contact(page: Page, links: string[] | null): Promise<void> {
    await page.route(`${BRIDGE}/**`, (route) => {
        const url = route.request().url();
        if (url.endsWith('/status')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                body: JSON.stringify({ tree: UUID, name: 'Víškovi', ...(links ? { links } : {}) }) });
        }
        return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"ok":true}' });
    });
    // The send flow reads the status, then asks; Cancel sends nothing.
    const done = page.evaluate((b) => window.Strom.UI.sendChangesToResearch(b), BRIDGE);
    await page.locator('#confirmation-modal').getByRole('button', { name: 'Cancel' }).click();
    await done;
    await page.unrouteAll();
}

async function openSource(page: Page): Promise<void> {
    const id = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().sources)[0]);
    await page.evaluate((i) => window.Strom.UI.showSourceViewer(i, null), id);
    await expect(page.locator('#source-viewer-modal')).toBeVisible();
}

test('announced links: Send is one click and the excerpt opens at full quality', async ({ page }) => {
    await setup(page);
    // Before the research announced anything: the old way (explanation + GEDCOM).
    await openSource(page);
    await expect(page.locator('.viewer-full-quality')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await contact(page, ['send', 'excerpt']);
    await openSource(page);
    const full = page.locator('.viewer-full-quality');
    await expect(full).toHaveText('Full quality ↗');
    await full.click();
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((id) => window.Strom.UI.sendTreeToResearch(id), treeId);
    expect(await launched(page)).toEqual([
        `strom-research://excerpt?tree=${UUID}&source=S0042&n=1`,
        `strom-research://send?tree=${UUID}`,
    ]);
});

test('a later contact without links, or the Settings switch, hides the features', async ({ page }) => {
    await setup(page);
    await contact(page, ['send', 'excerpt']);

    // Settings → Data: the switch is there (announced) and turns them off.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const row = page.locator('#research-links-row');
    await expect(row).toBeVisible();
    await expect(page.locator('#research-links-toggle')).toBeChecked();
    await row.click();
    await expect(page.locator('#research-links-toggle')).not.toBeChecked();
    await page.keyboard.press('Escape');
    await openSource(page);
    await expect(page.locator('.viewer-full-quality')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.Strom.UI.toggleResearchLinks(true));

    // The research talks again without links (older / scheme removed): gone.
    await contact(page, null);
    await openSource(page);
    await expect(page.locator('.viewer-full-quality')).toHaveCount(0);
    await page.keyboard.press('Escape');
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    const help = page.evaluate((id) => window.Strom.UI.sendTreeToResearch(id), treeId);
    await expect(page.locator('#confirmation-modal')).toContainText('Add to the research');
    await page.locator('#confirmation-modal').getByRole('button', { name: 'Close' }).click();
    await help;
    expect(await launched(page)).toEqual([]);
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(page.locator('#research-links-row')).toBeHidden();
});

test('a phone (touch) never offers them', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
    const page = await context.newPage();
    await setup(page);
    await contact(page, ['send', 'excerpt']);
    await openSource(page);
    await expect(page.locator('.viewer-full-quality')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.UI.researchLinkAvailable('send'))).toBe(false);
    await context.close();
});
