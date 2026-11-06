import { test, expect, Page } from '@playwright/test';
import { openApp, card, openPersonSubmenu, seedSetting } from './helpers.js';
import { BRIDGE, openResearchMenu } from './research-bridge.js';
import { setupConflict } from './research-conflict.js';
import { unnamedControls } from './a11y.js';

/**
 * Icon controls have a name (spec 063 K1.1, A2): on the main screens, no
 * button, link, menu item or tab in the accessibility tree is without a
 * readable name — not one of symbols only ("×", "⤢", "+"), not one from a
 * title alone (a tooltip, which page readers often skip). A screen reader
 * and a browser agent reading the page get the same tree. Invented data only.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'review', 'research', 'chat', 'task', 'conflict'];

/** No control of the screen without a name; the screen's name says where (all screens are checked). */
async function allNamed(page: Page, screen: string): Promise<void> {
    const unnamed = await unnamedControls(page);
    expect.soft(unnamed.map(u => `[${u.role}] "${u.name}" ${u.html}`), screen).toEqual([]);
}

/** A scan-like strip as a JPEG data URL. */
function jpeg(page: Page): Promise<string> {
    return page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 600; c.height = 120;
        const g = c.getContext('2d')!;
        g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, 600, 120);
        g.fillStyle = '#333'; g.fillRect(10, 40, 300, 20);
        return c.toDataURL('image/jpeg', 0.8);
    });
}

/** A research tree (Jan with a conflict) whose bridge answers; its actions announced on this computer. */
async function research(page: Page): Promise<void> {
    await page.addInitScript((links) => {
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    await setupConflict(page, { opened: { links: LINKS } });
}

async function closeTop(page: Page, selector: string): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(page.locator(selector)).toBeHidden();
}

test.describe('computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the tree, the person menu, the person page, the form, a source with its scan, What the research knows, the Research menu', async ({ page }) => {
        await research(page);
        const scan = await jpeg(page);
        const sourceId = await page.evaluate((dataUrl) => {
            const dm = window.Strom.DataManager;
            const jan = dm.getAllPersons().find(p => p.firstName === 'Jan')!;
            const src = dm.addSource({ title: 'Křest Jana', reference: 'fol. 45',
                excerpts: [{ id: 'e1', dataUrl, width: 600, height: 120, sizeBytes: 900, caption: 'levá strana' }] } as never);
            dm.citePerson(jan.id, src.id);
            return src.id as string;
        }, scan);
        await allNamed(page, 'tree');

        await card(page, 'Jan').click();
        await expect(page.locator('.context-menu:not(.context-submenu)')).toBeVisible();
        await allNamed(page, 'person menu');
        await openPersonSubmenu(page, 'research');
        await allNamed(page, 'person menu: Research');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(page.locator('.context-menu')).toHaveCount(0);

        await card(page, 'Jan').click();
        await page.locator('.context-menu .context-menu-header--page').click();
        await expect(page.locator('#person-page-modal')).toBeVisible();
        await allNamed(page, 'person page');
        await closeTop(page, '#person-page-modal');

        await page.evaluate(() => {
            const jan = window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!;
            window.Strom.UI.runPersonMenuAction(jan.id, 'edit');
        });
        await expect(page.locator('#person-modal')).toBeVisible();
        await allNamed(page, 'person form');
        await closeTop(page, '#person-modal');

        await page.evaluate((id) => window.Strom.UI.showSourceViewer(id, null), sourceId);
        const viewer = page.locator('#source-viewer-modal');
        await expect(viewer.locator('.viewer-excerpt img')).toHaveCount(1);
        await allNamed(page, 'source viewer');
        await viewer.locator('.viewer-zoom').click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
        await allNamed(page, 'scan viewer');
        await page.keyboard.press('Escape');
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
        await closeTop(page, '#source-viewer-modal');

        await page.evaluate(() => {
            const jan = window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!;
            window.Strom.UI.runPersonMenuAction(jan.id, 'research-knows');
        });
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await allNamed(page, 'What the research knows');
        await closeTop(page, '#person-research-modal');

        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-menu')).toBeVisible();
        await allNamed(page, 'Research menu');
        await page.keyboard.press('Escape');
    });

    test('following the research: the live panel and the research overview', async ({ page }) => {
        await research(page);
        await page.route(`${BRIDGE}/events`, () => new Promise<void>(() => { /* never answers */ }));
        await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
        await expect(page.locator('#live-panel')).toBeVisible();
        await allNamed(page, 'live panel');
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        await expect(page.locator('#research-overview')).toBeVisible();
        await allNamed(page, 'research overview');
    });

    test('the sample tree, its fan and its map', async ({ page }) => {
        await page.route('**://tile.openstreetmap.org/**', route => route.fulfill({ status: 404, body: '' }));
        await page.route('**://nominatim.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
        await seedSetting(page, 'mapTiles', true);
        await openApp(page);
        await allNamed(page, 'empty start');
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        await allNamed(page, 'sample tree');

        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
        await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
        await allNamed(page, 'fan');

        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('tree'));
        await page.getByRole('button', { name: 'Map', exact: true }).click();
        await page.getByRole('button', { name: 'Whole tree' }).click();
        await expect(page.locator('.map-marker').first()).toBeVisible();
        await allNamed(page, 'map');
        await page.locator('.map-marker').first().click();
        await allNamed(page, 'map: a place');
    });
});

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the tree, the person sheet and its pages', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        await allNamed(page, 'phone tree');
        await card(page, 'Johan').tap();
        await expect(page.locator('.bottom-sheet-person')).toBeVisible();
        await allNamed(page, 'person sheet');
        await openPersonSubmenu(page, 'more');
        await allNamed(page, 'person sheet: More');
    });
});

test.describe('tablet', () => {
    test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

    test('the tree and the person sheet', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        await allNamed(page, 'tablet tree');
        await card(page, 'Johan').tap();
        await expect(page.locator('.bottom-sheet-person')).toBeVisible();
        await allNamed(page, 'tablet person sheet');
    });
});
