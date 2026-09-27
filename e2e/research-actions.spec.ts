import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The research's actions from the app (a Strom Research tree, on a computer):
 * Actions → Research, the "In the research" section of the person menu, the
 * "Review again" dialog, "Waiting for you" (live panel and last known state)
 * and "Find a source in the research". Every action is a strom-research://
 * link the research announced; handing it to the system is recorded instead.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const BRIDGE = 'http://127.0.0.1:5997/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const ALL = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research'];

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 3f2a9c1e5b7d',
        '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 DEAT', '2 DATE 1900',
        '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0012@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 DEAT', '2 DATE 1932',
        '1 REFN P0012', '1 FAMC @F0001@',
        '0 @P0013@ INDI', '1 NAME Eva /Víšková/', '1 SEX F', '1 BIRT', '2 DATE 1990', '1 REFN P0013', '1 FAMC @F0001@',
        '0 @I9@ INDI', '1 NAME Karel /Bez/', '1 SEX M', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@', '1 CHIL @I9@',
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

/** Links the research announced on this computer, and what it last said waits (before the app starts). */
async function seed(page: Page, links: string[], waiting: Array<{ id: string; what: string; at?: string }> = []): Promise<void> {
    await page.addInitScript(([links, waiting, uuid]) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        if ((links as string[]).length) localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        if ((waiting as unknown[]).length) {
            localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({ items: waiting, at: new Date(Date.now() - 3600_000).toISOString() }));
        }
    }, [links, waiting, UUID] as const);
}

/** A research tree on screen; launched links are recorded. */
async function setup(page: Page, links: string[] = ALL, waiting: Array<{ id: string; what: string; at?: string }> = []): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page, links, waiting);
    await openApp(page);
    await dropFile(page, researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
    await recordLaunches(page);
}

async function recordLaunches(page: Page): Promise<void> {
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}

const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);
const submenuItems = (page: Page) => page.locator('#actions-research-submenu .tree-switcher-action');

async function openResearchMenu(page: Page): Promise<void> {
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-research-row').click();
    await expect(page.locator('#actions-research-submenu')).toBeVisible();
}

async function personMenu(page: Page, name: string): Promise<string[]> {
    await card(page, name).click();
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    return menu.locator('[data-action]').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.action || ''));
}

test.describe('Actions → Research', () => {
    test('announced: the items in order, the AI label, the note, the waiting count and dot', async ({ page }) => {
        await setup(page, ALL, [{ id: 'T0001', what: 'Confirm the father of Jan' }, { id: 'T0002', what: 'Which Anna?' }]);
        await expect(page.locator('#actions-menu-dot')).toBeVisible();
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#research-menu-row')).toBeHidden();
        const row = page.locator('#actions-research-row');
        await expect(row.locator('#actions-research-badge')).toHaveText('2');
        await row.click();
        await expect(submenuItems(page).locator('.research-item-label'))
            .toHaveText(['Load new version', 'Waiting for you', 'Send changes', 'Open research', 'Continue with the agent']);
        const chat = page.locator('#research-item-chat');
        await expect(chat.locator('.research-ai-badge')).toHaveText('AI');
        await expect(chat).toHaveAttribute('aria-label', 'Continue with the agent, AI, opens in the research');
        await expect(page.locator('#research-item-open .research-item-ext')).toHaveText('↗');
        await expect(page.locator('#research-item-version .research-item-ext')).toHaveCount(0);
        await expect(page.locator('#actions-research-submenu .research-submenu-note')).toContainText('continues in the research on this computer');

        await page.locator('#research-item-open').click();
        await expect(page.locator('.toast')).toContainText('Opening the research…');
        await expect(page.locator('.toast')).toContainText('Continue in the terminal window.');
        await openResearchMenu(page);
        await page.locator('#research-item-chat').click();
        await expect(page.locator('.toast')).toContainText('Opening the agent…');
        await openResearchMenu(page);
        await page.locator('#research-item-send').click();
        expect(await launched(page)).toEqual([
            `strom-research://open?tree=${UUID}`,
            `strom-research://chat?tree=${UUID}`,
            `strom-research://send?tree=${UUID}`,
        ]);
    });

    test('an action the research did not announce is missing', async ({ page }) => {
        await setup(page, ['send', 'open']);
        await openResearchMenu(page);
        await expect(submenuItems(page).locator('.research-item-label')).toHaveText(['Send changes', 'Open research']);
        await expect(page.locator('#actions-research-badge')).toBeHidden();
    });

    test('"Load new version": a spinner until the version comes, else "did not answer" after 20 s', async ({ page }) => {
        await page.clock.install();
        await setup(page);
        await openResearchMenu(page);
        await page.locator('#research-item-version').click();
        expect(await launched(page)).toEqual([`strom-research://app?tree=${UUID}`]);
        await expect(page.locator('.toast .toast-spinner')).toBeVisible();
        await expect(page.locator('.toast')).toContainText('Waiting for the new version from the research…');
        await page.clock.fastForward(20_500);
        await expect(page.locator('.toast')).toHaveText('The research did not answer. Start it and try again.');

        // It came in time: the spinner goes, the import takes over.
        await openResearchMenu(page);
        await page.locator('#research-item-version').click();
        await expect(page.locator('.toast .toast-spinner')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.openExternalRequest(new URLSearchParams('import-url=https://example.com/x.ged')));
        await expect(page.locator('.toast .toast-spinner')).toHaveCount(0);
        await page.clock.fastForward(25_000);
        await expect(page.locator('.toast')).not.toContainText('did not answer');
    });

    test('"Load new version": the version opening in another tab (app in a browser) ends the wait here', async ({ page, context }) => {
        await setup(page);
        await openResearchMenu(page);
        await page.locator('#research-item-version').click();
        await expect(page.locator('.toast .toast-spinner')).toBeVisible();
        const other = await context.newPage();
        await other.goto(`/strom.html?import-url=${encodeURIComponent('http://127.0.0.1:5995/tree.ged')}`);
        await expect(page.locator('.toast .toast-spinner')).toHaveCount(0);
        await other.close();
    });

    test('"Waiting for you" without following: the last known state, no answer buttons, Esc closes', async ({ page }) => {
        await setup(page, ALL, [{ id: 'T0001', what: 'Confirm the father of Jan', at: new Date().toISOString() }]);
        await openResearchMenu(page);
        await page.locator('#research-item-waiting').click();
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        await expect(panel).toHaveClass(/idle/);
        await expect(panel.locator('.live-panel-heading-waiting')).toHaveText('Waiting for you · 1');
        await expect(panel.locator('.live-waiting')).toContainText('Confirm the father of Jan');
        await expect(panel.locator('.live-waiting-answer')).toHaveCount(0);
        await expect(panel).toContainText('The research is not running.');
        await panel.getByRole('button', { name: 'Open research ↗' }).click();
        expect(await launched(page)).toEqual([`strom-research://open?tree=${UUID}`]);
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
    });

    test('a week-old state is not shown', async ({ page }) => {
        await setup(page);
        await page.evaluate((uuid) => localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({
            items: [{ id: 'T0001', what: 'Old' }], at: new Date(Date.now() - 8 * 24 * 3600_000).toISOString(),
        })), UUID);
        await openResearchMenu(page);
        await expect(page.locator('#research-item-waiting')).toHaveCount(0);
    });

    test('nothing announced: only Send changes and What is Strom Research', async ({ page }) => {
        await setup(page, []);
        await openResearchMenu(page);
        await expect(submenuItems(page)).toHaveText(['Send changes', 'What is Strom Research']);
        await page.locator('#research-item-about').click();
        await expect(page.locator('#research-info-modal')).toBeVisible();
    });

    test('another tree keeps "AI ancestor research"', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seed(page, ALL);
        await openApp(page);
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#research-menu-row')).toBeVisible();
        await expect(page.locator('#actions-research-row')).toBeHidden();
    });

    test('a touch device: nothing of the research in the menus', async ({ browser }) => {
        const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        await seed(page, ALL, [{ id: 'T0001', what: 'Confirm the father of Jan' }]);
        await openApp(page);
        await dropFile(page, researchGed());
        await expect(card(page, 'Jan')).toBeVisible();
        expect(await page.evaluate(() => window.Strom.UI.researchMenuShown())).toBe(false);
        await expect(page.locator('#actions-research-wrap')).toBeHidden();
        expect(await page.evaluate(() => {
            const id = window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0012')!.id;
            return window.Strom.UI.getPersonMenuActions(id).map((a: { action: string }) => a.action);
        })).not.toContain('research-review');
        await context.close();
    });
});

test.describe('live research: Waiting for you', () => {
    test('above the changes, "Answer ↗" opens the task; the menu opens the panel at the section', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seed(page, ALL);
        await page.route(`${BRIDGE}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/status')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                    body: JSON.stringify({ tree: { id: UUID, name: 'Víškovi' }, head: 'h1', working: [], links: ALL,
                        waiting: [{ id: 'T0007', what: 'Confirm the father of Jan', on: 'user', at: new Date().toISOString() },
                            { id: 'x', what: 'Pick a register', on: 'user' }] }) });
            }
            if (path.endsWith('/tree.ged')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain' }, body: researchGed() });
            }
            return new Promise(() => {});
        });
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        await recordLaunches(page);
        // Order of the sections: at work → waiting → changes.
        const headings = await panel.locator('.live-panel-heading').allTextContents();
        expect(headings).toEqual(['At work', 'Waiting for you · 2', 'Latest changes']);
        await expect(panel.locator('.live-waiting .live-time').first()).toHaveText(/just now|min/);
        await expect(panel).toContainText('You answer in the research.');
        const answers = panel.locator('.live-waiting-answer');
        await expect(answers).toHaveCount(2);
        await answers.nth(0).click();
        await answers.nth(1).click();
        expect(await launched(page)).toEqual([
            `strom-research://task?tree=${UUID}&task=T0007`,
            // No task id the research accepts: the research itself.
            `strom-research://open?tree=${UUID}`,
        ]);

        // Collapsed panel; the menu count and dot; the menu opens it again.
        await panel.locator('.live-panel-toggle').click();
        await expect(panel).toHaveClass(/collapsed/);
        await expect(page.locator('#actions-menu-dot')).toBeVisible();
        await openResearchMenu(page);
        await expect(page.locator('#actions-research-badge')).toHaveText('2');
        await page.locator('#research-item-waiting').click();
        await expect(panel).not.toHaveClass(/collapsed/);
        await expect(panel.locator('.live-panel-heading-waiting')).toBeVisible();
    });
});

test.describe('person menu: In the research', () => {
    test('at the end with its heading, AI label at "Ask the agent"; none without REFN', async ({ page }) => {
        await setup(page);
        const actions = await personMenu(page, 'Jan');
        expect(actions.slice(-3)).toEqual(['research-review', 'research-ancestors', 'research-ask']);
        const menu = page.locator('.context-menu');
        await expect(menu.locator('.menu-section-header')).toHaveText('In the research');
        const ask = menu.locator('[data-action="research-ask"]');
        await expect(ask.locator('.research-ai-badge')).toHaveText('AI');
        await expect(ask).toHaveAttribute('aria-label', 'Ask the agent, AI, opens in the research');
        await menu.locator('[data-action="research-ancestors"]').click();
        await personMenu(page, 'Jan');
        await page.locator('.context-menu [data-action="research-ask"]').click();
        await expect(page.locator('.toast')).toContainText('Opening the agent…');
        expect(await launched(page)).toEqual([
            `strom-research://research?tree=${UUID}&person=P0012&direction=ancestors`,
            `strom-research://chat?tree=${UUID}&person=P0012`,
        ]);
        await page.keyboard.press('Escape');

        expect(await personMenu(page, 'Karel')).not.toContain('research-review');
        await expect(page.locator('.context-menu .menu-section-header')).toHaveCount(0);
    });

    test('"Review again": person by default, the choice is remembered, the link carries the scope', async ({ page }) => {
        await setup(page);
        await personMenu(page, 'Jan');
        await page.locator('.context-menu [data-action="research-review"]').click();
        const dialog = page.locator('#research-review-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.modal')).toHaveAttribute('data-dialog-kind', 'choice');
        await expect(dialog).toContainText('Jan Víšek · 1865–1932');
        await expect(dialog.getByRole('radio', { name: 'Only this person' })).toBeChecked();
        await expect(dialog.locator('.research-review-living')).toHaveCount(0);
        await dialog.getByText('With family').click();
        await dialog.getByRole('button', { name: 'Add in the research ↗' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.toast')).toContainText('Opening the research…');

        await personMenu(page, 'Jan');
        await page.locator('.context-menu [data-action="research-review"]').click();
        await expect(dialog.getByRole('radio', { name: /With family/ })).toBeChecked();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toHaveCount(0);
        expect(await launched(page)).toEqual([`strom-research://review?tree=${UUID}&person=P0012&scope=family`]);

        // Someone who may be living: the research asks first — said here.
        await personMenu(page, 'Eva');
        await page.locator('.context-menu [data-action="research-review"]').click();
        await expect(dialog.locator('.research-review-living')).toHaveText('This person may be living. The research will ask first.');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    });
});

test.describe('person sources: Find a source in the research', () => {
    test('no source + review announced → the link (dialog stays); a source → none', async ({ page }) => {
        await setup(page);
        const idOf = (refn: string) => page.evaluate((r) =>
            window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === r)!.id, refn);
        const jan = await idOf('P0012');
        await page.evaluate((id) => { window.Strom.UI.pushDialog('person-sources-modal'); window.Strom.UI.showPersonSourcesDialog(id); }, jan);
        const dialog = page.locator('#person-sources-modal');
        const find = dialog.getByRole('button', { name: 'Find a source in the research ↗' });
        await expect(find).toBeVisible();
        await find.click();
        await expect(dialog).toBeVisible();
        expect(await launched(page)).toEqual([`strom-research://review?tree=${UUID}&person=P0012&scope=person`]);
        await page.keyboard.press('Escape');

        await page.evaluate((id) => {
            const DM = window.Strom.DataManager;
            const src = DM.addSource({ title: 'Krest Jan' })!;
            DM.citePerson(id, src.id);
            window.Strom.UI.pushDialog('person-sources-modal');
            window.Strom.UI.showPersonSourcesDialog(id);
        }, jan);
        await expect(dialog.locator('.person-source-row')).toHaveCount(1);
        await expect(find).toBeHidden();
    });

    test('not announced: no link', async ({ page }) => {
        await setup(page, ['send']);
        const jan = await page.evaluate(() =>
            window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0012')!.id);
        await page.evaluate((id) => window.Strom.UI.showPersonSourcesDialog(id), jan);
        await expect(page.locator('#person-sources-modal')).toBeVisible();
        await expect(page.locator('#person-sources-find')).toBeHidden();
    });
});
