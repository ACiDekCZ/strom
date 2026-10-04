import { test, expect, Page } from '@playwright/test';
import { openApp, card, openPersonSubmenu } from './helpers.js';

/**
 * Research actions, second wave: the Research submenu's update block, "Undo
 * last send" and "Research settings"; the live panel's "Up next", update
 * strip and spend; "What the research knows" (menu, dialog, edit form);
 * approving a draft story; "Start research with this tree" (G3); and "Where
 * evidence is missing" in tree health with its highlight in the tree.
 * Handing a strom-research:// link to the system is recorded instead.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const BRIDGE = 'http://127.0.0.1:5996/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const ALL = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research',
    'new', 'update', 'sessions', 'conflict', 'story', 'sync-undo', 'setup'];

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 3f2a9c1e5b7d',
        '1 _STROM_ASOF 2026-09-20', '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @S12@ SOUR', '1 TITL Křestní matrika Chlumy 1865', '1 REFN S0012',
        '0 @S31@ SOUR', '1 TITL Sčítání lidu 1880', '1 REFN S0031',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 DEAT', '2 DATE 1900',
        '1 REFN P0001', '1 FAMS @F0001@',
        '1 _STORY', '2 STAT hotovo', '2 TEXT Josef hospodařil na čp. 12.',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '1 _STROM_SEARCHED', '2 TITL Oddací matrika Chlumy', '2 DATE FROM 1860 TO 1864', '2 RESN none',
        '0 @P0012@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '2 SOUR @S12@', '1 DEAT', '2 DATE 1932',
        '1 REFN P0012', '1 FAMC @F0001@',
        '1 _STORY', '2 STAT navrh', '2 TEXT Jan se narodil v Chlumech.',
        '1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 VAL 3 FEB 1865', '3 SOUR @S12@', '2 VAL 1866', '3 SOUR @S31@',
        '1 _STROM_CONFLICT X0008', '2 TYPE DEAT', '2 STAT decided', '2 VAL 1931', '2 VAL 1932', '2 DECI 1932 (S0031)',
        '1 _STROM_CONFLICT X0009', '2 TYPE EVEN', '2 TITL Rok sňatku rodičů', '2 STAT open', '2 VAL 70 let při úmrtí 1937', '2 VAL 1890',
        '1 _STROM_HYPO', '2 TITL Otec: Josef, nebo Jan Víšek?', '2 NOTE Oba žili v Chlumech.',
        '1 _STROM_SEARCHED', '2 TITL Sčítání lidu 1880', '2 DATE 1880', '2 RESN found',
        '1 _STROM_SEARCHED', '2 TITL Křestní matrika Chlumy', '2 DATE FROM 1860 TO 1870', '2 RESN found',
        '0 @P0013@ INDI', '1 NAME Eva /Víšková/', '1 SEX F', '1 BIRT', '2 DATE 1990', '1 REFN P0013', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
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

/** Links the research announced on this computer, and what it last said (before the app starts). */
async function seed(page: Page, links: string[], stored: Record<string, unknown> | null = null): Promise<void> {
    await page.addInitScript(([links, stored, uuid]) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        if ((links as string[]).length) localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        if (stored) localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({ items: [], at: new Date(Date.now() - 3600_000).toISOString(), ...stored }));
    }, [links, stored, UUID] as const);
}

async function recordLaunches(page: Page): Promise<void> {
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}

const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

/** A research tree on screen; launched links are recorded. */
async function setup(page: Page, links: string[] = ALL, stored: Record<string, unknown> | null = null): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page, links, stored);
    await openApp(page);
    await dropFile(page, researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
    await recordLaunches(page);
}

async function openResearchMenu(page: Page): Promise<void> {
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-research-row').click();
    await expect(page.locator('#actions-research-submenu')).toBeVisible();
}

const personId = (page: Page, refn: string) => page.evaluate((refn) =>
    window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === refn)!.id, refn);

async function menuActions(page: Page, name: string): Promise<string[]> {
    await card(page, name).click();
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    return menu.locator('[data-action]').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.action || ''));
}

test.describe('Research submenu, second wave', () => {
    test('update block, "Undo last send" with its time, "Research settings"', async ({ page }) => {
        // Earlier today (just after midnight two hours back is yesterday: shown with its date).
        const sentAt = new Date(Math.max(Date.now() - 2 * 3600_000, new Date().setHours(0, 0, 1, 0)));
        await setup(page, ALL, { update: { version: '1.7.0' }, lastIntake: { id: 'I0042', at: sentAt.toISOString() } });
        await openResearchMenu(page);
        const block = page.locator('#research-update-block');
        await expect(block).toContainText('New Strom Research 1.7.0');
        await expect(page.locator('#research-item-update')).toHaveText('Update ↗');
        const hhmm = await page.evaluate((iso) => new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)), sentAt.toISOString());
        await expect(page.locator('#research-item-undo .research-item-sub')).toHaveText(`sent ${hhmm}`);
        await expect(page.locator('#actions-research-submenu .research-item-label'))
            .toContainText(['Load new version', 'Send changes', 'Undo last send', 'Open research', 'Continue with the agent', 'Research settings']);

        await page.locator('#research-item-update').click();
        await openResearchMenu(page);
        await page.locator('#research-item-undo').click();
        await openResearchMenu(page);
        await page.locator('#research-item-setup').click();
        expect(await launched(page)).toEqual([
            `strom-research://update?tree=${UUID}`,
            `strom-research://sync-undo?tree=${UUID}&intake=I0042`,
            `strom-research://setup?tree=${UUID}`,
        ]);
    });

    test('no intake (or an old one), no setup announced: neither row', async ({ page }) => {
        const old = new Date(Date.now() - 8 * 24 * 3600_000).toISOString();
        await setup(page, ALL.filter(a => a !== 'setup'), { lastIntake: { id: 'I0042', at: old } });
        await openResearchMenu(page);
        await expect(page.locator('#research-item-undo')).toHaveCount(0);
        await expect(page.locator('#research-item-setup')).toHaveCount(0);
        await expect(page.locator('#research-update-block')).toHaveCount(0);
    });
});

test.describe('Follow live from the app', () => {
    test('announced: "Follow live ↗" asks the research to open the tree live here', async ({ page }) => {
        await setup(page, [...ALL, 'live']);
        await openResearchMenu(page);
        const item = page.locator('#research-item-live');
        await expect(item).toContainText('Follow live');
        await expect(item).toContainText('↗');
        await item.click();
        expect(await launched(page)).toEqual([`strom-research://live?tree=${UUID}`]);
        await expect(page.locator('.toast')).toContainText('Opening the research');
    });

    test('not announced by the research: no item', async ({ page }) => {
        await setup(page, ALL);
        await openResearchMenu(page);
        await expect(page.locator('#research-item-live')).toHaveCount(0);
    });
});

test.describe('live panel: up next, update, spend', () => {
    const status = (extra: Record<string, unknown>) => ({
        tree: { id: UUID, name: 'Víškovi' }, head: 'h1', working: [], waiting: [], links: ALL, ...extra,
    });

    async function follow(page: Page, extra: Record<string, unknown>): Promise<void> {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seed(page, ALL);
        await page.route(`${BRIDGE}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/status')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status(extra)) });
            }
            if (path.endsWith('/tree.ged')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain' }, body: researchGed() });
            }
            return new Promise(() => {});
        });
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        await expect(page.locator('#live-panel')).toBeVisible();
        await recordLaunches(page);
    }

    test('three next tasks, parked below, the rest as one link; ⋯ parks or drops in the research', async ({ page }) => {
        await follow(page, {
            queue: [
                { id: 'T0101', text: 'Matriky Chlumy 1860–1870', state: 'next' },
                { id: 'T0102', text: 'Sčítání 1880', state: 'next' },
                { id: 'T0103', text: 'Pozemková kniha', state: 'next' },
                { id: 'T0104', text: 'Čtvrtý úkol', state: 'next' },
                { id: 'T0105', text: 'Oddací matrika', state: 'parked' },
            ],
            queueMore: 8,
            update: { version: '1.7.0' },
            spend: { month: '2026-09', sessions: 4, amount: 3.2, currency: 'USD' },
        });
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-queue-toggle .live-section__title')).toHaveText('Up next');
        // The heading counts every next task and the rest (4 + 8).
        await expect(panel.locator('.live-queue-toggle .live-section__sum')).toHaveText('12 tasks');
        const rows = panel.locator('.live-queue-row');
        await expect(rows.locator('.live-queue-text')).toHaveText([
            'Matriky Chlumy 1860–1870', 'Sčítání 1880', 'Pozemková kniha', 'Parked: Oddací matrika',
        ]);
        await expect(panel.locator('.live-queue-num')).toHaveText(['1', '2', '3']);
        await expect(panel.locator('.live-queue-rest')).toHaveText('and 9 more in the research ↗');
        // Order: at work → latest changes → up next (nobody waits here).
        const headings = await panel.locator('.live-section__title').allTextContents();
        expect(headings.map(h => h.trim())).toEqual(['At work', 'Latest changes', 'Up next']);
        await expect(panel.locator('.live-panel-update')).toContainText('New Strom Research 1.7.0');
        await expect(panel.locator('.live-panel-spend')).toHaveText(/Agent this month: 4 sessions · \$3\.20/);

        // ⋯ → a small menu; Escape closes it (and only it).
        const more = panel.locator('.live-queue-more').first();
        await expect(more).toHaveAttribute('aria-label', 'Task options');
        await more.click();
        const menu = page.locator('#live-task-menu');
        await expect(menu.locator('.context-menu-item')).toHaveText(['Park ↗', 'Drop ↗']);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(panel).toBeVisible();
        await more.click();
        await menu.getByText('Park ↗').click();
        await panel.locator('.live-queue-more').nth(1).click();
        await page.locator('#live-task-menu').getByText('Drop ↗').click();
        await panel.locator('.live-queue-wake').click();
        await panel.locator('.live-queue-rest').click();
        await panel.locator('.live-panel-update-link').click();
        await panel.locator('.live-panel-spend-link').click();
        expect(await launched(page)).toEqual([
            `strom-research://task?tree=${UUID}&task=T0101&do=park`,
            `strom-research://task?tree=${UUID}&task=T0102&do=drop`,
            `strom-research://task?tree=${UUID}&task=T0105&do=wake`,
            `strom-research://open?tree=${UUID}`,
            `strom-research://update?tree=${UUID}`,
            `strom-research://sessions?tree=${UUID}`,
        ]);
        // Nothing changes here after an action: the next status tells.
        await expect(rows).toHaveCount(5);
    });

    test('without the fields: no queue, no update strip, no spend; the idle panel has no queue', async ({ page }) => {
        await follow(page, {});
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-queue-toggle')).toHaveCount(0);
        await expect(panel.locator('.live-panel-update')).toHaveCount(0);
        await expect(panel.locator('.live-panel-spend')).toHaveCount(0);
        await panel.getByRole('button', { name: 'Stop' }).click();
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        await expect(page.locator('#live-panel.idle')).toBeVisible();
        await expect(page.locator('#live-panel .live-queue-toggle')).toHaveCount(0);
    });
});

test.describe('What the research knows', () => {
    test('first in "Research ›" only with data, its conflict tag on the row too; Find descendants under Find ancestors', async ({ page }) => {
        await setup(page);
        const actions = await menuActions(page, 'Jan');
        expect(actions).not.toContain('research-knows');
        const row = page.locator('.context-menu [data-menu="research"]');
        await expect(row.locator('.menu-item-tag')).toHaveText('2 conflicts');
        await expect(row).toHaveAttribute('aria-label', 'Research, 2 conflicts');
        const sub = await openPersonSubmenu(page, 'research');
        expect(await sub.locator('[data-action]').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.action)))
            .toEqual(['research-knows', 'research-review', 'research-ancestors', 'research-descendants', 'research-ask']);
        const knows = sub.locator('[data-action="research-knows"]');
        await expect(knows.locator('.menu-item-tag')).toHaveText('2 conflicts');
        await expect(knows).toHaveAttribute('aria-label', 'What the research knows, 2 conflicts');
        await sub.locator('[data-action="research-descendants"]').click();
        expect(await launched(page)).toEqual([`strom-research://research?tree=${UUID}&person=P0012&direction=descendants`]);

        // Anna: searched only — no tag. Eva: nothing — not in the submenu.
        await menuActions(page, 'Anna');
        await expect(page.locator('.context-menu [data-menu="research"] .menu-item-tag')).toHaveCount(0);
        await openPersonSubmenu(page, 'research');
        await expect(page.locator('.context-submenu [data-action="research-knows"] .menu-item-tag')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await menuActions(page, 'Eva');
        await openPersonSubmenu(page, 'research');
        await expect(page.locator('.context-submenu [data-action="research-knows"]')).toHaveCount(0);
    });

    test('the dialog: open conflict card, decided row, hypotheses, searched by year; links, source viewer', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0012');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'research-knows'), jan);
        const dialog = page.locator('#person-research-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.audit-log-subtitle')).toHaveText(/^Jan Víšek · 1865–1932 · as of \S*2026$/);
        await expect(dialog.locator('.menu-section-header')).toHaveText(['Conflicts', 'Hypotheses', 'Searched']);
        const conflict = dialog.locator('.person-research-conflict');
        await expect(conflict.locator('.person-research-fact')).toHaveText(['Birth', 'Rok sňatku rodičů']);
        // A claim in words stays as written.
        await expect(conflict.nth(1).locator('tbody td:first-child')).toHaveText(['70 let při úmrtí 1937', '1890']);
        await expect(conflict.first().locator('.person-research-open-tag')).toHaveText('Open');
        // The research's GEDCOM date reads in the app's date style.
        await expect(conflict.first().locator('tbody td:first-child')).toHaveText([/^(?!3 FEB).*1865$/, '1866']);
        await expect(dialog.locator('.person-research-decided')).toContainText('Death: 1931 vs. 1932');
        await expect(dialog.locator('.person-research-decision')).toHaveText('decided: 1932 (S0031)');
        await expect(dialog.locator('.person-research-hypo-title')).toHaveText('Otec: Josef, nebo Jan Víšek?');
        await expect(dialog.locator('.person-research-searched tbody td:first-child')).toHaveText(['Křestní matrika Chlumy', 'Sčítání lidu 1880']);
        await expect(dialog.locator('.person-research-years')).toHaveText(['1860–1870', '1880']);
        await expect(dialog.locator('.person-research-result--found')).toHaveText(['found', 'found']);

        await dialog.locator('[data-do="decide"]').first().click();
        await dialog.locator('[data-do="agent"]').first().click();
        await expect(page.locator('.toast')).toContainText('Opening the agent…');
        expect(await launched(page)).toEqual([
            `strom-research://conflict?tree=${UUID}&id=X0007&do=decide`,
            `strom-research://conflict?tree=${UUID}&id=X0007&do=agent`,
        ]);

        await dialog.locator('.person-research-source').first().click();
        await expect(page.locator('#source-viewer-modal')).toBeVisible();
        await expect(page.locator('#source-viewer-title')).toHaveText('Křestní matrika Chlumy 1865');
        await page.keyboard.press('Escape');
        await expect(page.locator('#source-viewer-modal')).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);

        // Anna: only what was searched — the other sections are not there.
        const anna = await personId(page, 'P0002');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'research-knows'), anna);
        await expect(page.locator('#person-research-modal .menu-section-header')).toHaveText(['Searched']);
    });

    test('links only when announced: the content stays', async ({ page }) => {
        await setup(page, ['send', 'open']);
        const jan = await personId(page, 'P0012');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'research-knows'), jan);
        const dialog = page.locator('#person-research-modal');
        await expect(dialog.locator('.person-research-conflict')).toHaveCount(2);
        await expect(dialog.locator('[data-conflict]')).toHaveCount(0);
    });

    test('edit form: "conflict ›" at the birth date opens the dialog above the form', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0012');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'edit'), jan);
        const tag = page.locator('#person-modal label[for="input-birthdate"] .pm-conflict-tag');
        await expect(tag).toHaveText('conflict ›');
        await expect(page.locator('#person-modal .pm-conflict-tag')).toHaveCount(1);
        await tag.click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
    });

    test('phone (360 px): the item in the bottom sheet too', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        await seed(page, ALL);
        await openApp(page);
        await dropFile(page, researchGed());
        await expect(card(page, 'Jan')).toBeVisible();
        await card(page, 'Jan').click();
        // No research links on a phone: "What the research knows" alone stays on the first level.
        await expect(page.locator('.bottom-sheet [data-menu="research"]')).toHaveCount(0);
        const item = page.locator('.bottom-sheet [data-action="research-knows"]');
        await expect(item).toBeVisible();
        await expect(item.locator('.menu-item-tag')).toHaveText('2 conflicts');
        await item.click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        // No research links on a phone, the content is there.
        await expect(page.locator('#person-research-modal [data-conflict]')).toHaveCount(0);
        await context.close();
    });
});

test.describe('approve a draft story', () => {
    test('draft + story announced: "Approve in the research ↗"; an approved story: none', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0012');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), jan);
        const approve = page.locator('#person-story-approve');
        await expect(approve).toHaveText('Approve in the research ↗');
        await approve.click();
        expect(await launched(page)).toEqual([`strom-research://story?tree=${UUID}&person=P0012&do=final`]);
        await page.keyboard.press('Escape');
        const josef = await personId(page, 'P0001');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), josef);
        await expect(page.locator('#person-story-modal')).toBeVisible();
        await expect(page.locator('#person-story-approve')).toHaveCount(0);
    });
});

test.describe('Start research with this tree (G3)', () => {
    const TOKEN_RE = /^strom-research:\/\/new\?app=([A-Za-z0-9_-]{43})$/;

    async function appTree(page: Page, links: string[]): Promise<void> {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seed(page, links);
        await openApp(page);
        await page.evaluate(async () => {
            const p = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
                id, firstName, lastName: 'Dvořák', gender: 'male', isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [], ...extra,
            });
            await window.Strom.DataManager.importAsNewTree({
                persons: { a: p('a', 'Karel', { childIds: ['b'] }), b: p('b', 'Petr', { parentIds: ['a'] }) },
                partnerships: {},
            }, 'Dvořákovi');
            window.Strom.UI.updateTreeSwitcher();
        });
        await expect(card(page, 'Karel')).toBeVisible();
        await recordLaunches(page);
    }

    test('the explanation dialog offers "Start research ↗" only when the research announced `new`', async ({ page }) => {
        await appTree(page, ['send']);
        await page.evaluate(() => window.Strom.UI.showResearchInfoDialog());
        await expect(page.locator('#research-info-modal')).toBeVisible();
        await expect(page.locator('#research-adopt-start')).toHaveCount(0);
        // Not announced: the way to install it.
        await expect(page.locator('#research-info-modal .research-install-dialog')).toBeVisible();
        await page.keyboard.press('Escape');

        // Research here, `new` not announced: the menu item (a way to the website) is gone.
        await page.evaluate(() => window.Strom.UI.refreshResearchPromo());
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#research-menu-row')).toBeHidden();
        await page.keyboard.press('Escape');

        await page.evaluate(() => localStorage.setItem('strom-research-links', JSON.stringify({ actions: ['new'], at: new Date().toISOString() })));
        // `new` announced: the item is back, named for what it does now, and it hands the tree over.
        await page.evaluate(() => window.Strom.UI.refreshResearchPromo());
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#research-menu-row')).toBeVisible();
        await expect(page.locator('#research-menu-row .research-menu-label')).toHaveText('Start research with this tree');
        await expect(page.locator('#research-menu-row .research-new-badge')).toBeHidden();
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.Strom.UI.showResearchInfoDialog());
        const dialog = page.locator('#research-info-modal');
        await expect(dialog.locator('.research-info-lead')).toContainText('can take over your tree Dvořákovi');
        await expect(dialog.locator('.research-info-need')).toHaveCount(0);
        await expect(dialog.locator('.research-info-step')).toHaveCount(3);
        await expect(dialog.locator('.research-info-about')).toContainText('What is Strom Research');
        await dialog.locator('#research-adopt-start').click();
        await expect(dialog).toHaveCount(0);
        const [url] = await launched(page);
        expect(url).toMatch(TOKEN_RE);
        await expect(page.locator('.toast .toast-spinner')).toBeVisible();
        await expect(page.locator('.toast')).toContainText('Waiting for the research… Finish setting up in the terminal.');
        const stored = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchAdoptToken?.token);
        expect(stored).toBe(url.match(TOKEN_RE)![1]);
        // Closing the toast keeps the token.
        await page.locator('.toast-close').click();
        await expect(page.locator('.toast')).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchAdoptToken?.token)).toBe(stored);
    });

    async function routeBridge(page: Page, token: string, calls: { cancel: string[]; posted: string[] }): Promise<void> {
        await page.route(`${BRIDGE}/**`, async (route) => {
            const req = route.request();
            const path = new URL(req.url()).pathname;
            if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
            if (path.endsWith('/adopt') && req.method() === 'GET') {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                    body: JSON.stringify({ token, name: 'Dvořákovi – výzkum' }) });
            }
            if (path.endsWith('/adopt') && req.method() === 'POST') {
                calls.posted.push(req.postData() ?? '');
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                    body: JSON.stringify({ tree: UUID, head: 'abc1234' }) });
            }
            if (path.endsWith('/cancel')) {
                calls.cancel.push(req.postData() ?? '');
                return route.fulfill({ status: 200, headers: cors, body: '{}' });
            }
            return route.fulfill({ status: 404, headers: cors, body: '' });
        });
    }

    test('?adopt= with the token: "Hand the tree to the research?" → linked, Research menu shown', async ({ page }) => {
        await appTree(page, ALL);
        await page.evaluate(() => window.Strom.UI.startResearchAdopt(window.Strom.DataManager.getCurrentTreeId()));
        const token = (await launched(page))[0].match(TOKEN_RE)![1];
        const calls = { cancel: [] as string[], posted: [] as string[] };
        await routeBridge(page, token, calls);
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), BRIDGE);
        const dialog = page.locator('#research-adopt-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.close-btn')).toHaveCount(0);
        await expect(dialog.locator('.audit-log-subtitle')).toHaveText('Dvořákovi → research “Dvořákovi – výzkum”');
        // What goes over, as tiles; "trial" beside the title, the backup said by the buttons.
        await expect(dialog.locator('.research-adopt-tile')).toHaveText(['2people', '0families', '0sources']);
        await expect(dialog.locator('.research-trial-tag')).toHaveText('trial');
        await expect(dialog.locator('.research-send-dialog-note')).toHaveText('A backup is saved before handing over.');
        await expect(dialog.locator('#research-adopt-images')).toHaveCount(0);
        await dialog.locator('#research-adopt-confirm').click();
        await expect(page.locator('.toast')).toContainText('Dvořákovi is now linked to the research.');
        expect(calls.posted[0]).toContain('1 NAME Karel /Dvořák/');
        // As the dialog said: a backup before handing over.
        const reasons = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
            const req = indexedDB.open('strom-db');
            req.onsuccess = () => {
                const all = req.result.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
                all.onsuccess = () => resolve(all.result.filter((x: { meta?: { reason: string } }) => x.meta).map((x: { meta: { reason: string } }) => x.meta.reason));
                all.onerror = () => reject(all.error);
            };
            req.onerror = () => reject(req.error);
        }));
        expect(reasons).toContain('pre-first-send');
        const research = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata());
        expect(research?.research).toMatchObject({ id: UUID, head: 'abc1234' });
        expect(research?.researchAdoptToken).toBeUndefined();
        await expect(page.locator('#actions-research-wrap')).toBeAttached();
        expect(await page.evaluate(() => window.Strom.UI.researchMenuShown())).toBe(true);
        expect(calls.cancel).toEqual([]);
    });

    /** Adopt the Dvořákovi tree with a photo on Karel and an attachment on Petr. */
    async function adoptWithImages(page: Page): Promise<{ img: string; att: string }> {
        await appTree(page, ALL);
        const { img, att } = await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const url = `data:image/jpeg;base64,${'A'.repeat(3000)}`;
            dm.updatePerson('a', { photo: url });
            const added = dm.addAttachment('b', { name: 'page.jpg', mimeType: 'image/jpeg', dataUrl: url, sizeBytes: 2250 });
            return { img: url, att: added.id as string };
        });
        await page.evaluate(() => window.Strom.UI.startResearchAdopt(window.Strom.DataManager.getCurrentTreeId()));
        const token = (await launched(page))[0].match(TOKEN_RE)![1];
        const calls = { cancel: [] as string[], posted: [] as string[] };
        await routeBridge(page, token, calls);
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), BRIDGE);
        await page.locator('#research-adopt-confirm').click();
        await expect(page.locator('.toast')).toContainText('Dvořákovi is now linked to the research.');
        // The research never got the images.
        expect(calls.posted[0]).not.toContain('AAAA');
        return { img, att };
    }

    /** The research's next version of the adopted tree: its own numbers, no images. */
    const adoptedGed = (extra = false): string => [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 3 OCT 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Dvořákovi',
        '0 @P0001@ INDI', '1 NAME Karel /Dvořák/', '1 SEX M', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Petr /Dvořák/', '1 SEX M', '1 REFN P0002', '1 FAMC @F0001@',
        ...(extra ? ['0 @P0003@ INDI', '1 NAME Marie /Dvořáková/', '1 SEX F', '1 REFN P0003', '1 FAMS @F0001@'] : []),
        '0 @F0001@ FAM', '1 HUSB @P0001@', ...(extra ? ['1 WIFE @P0003@'] : []), '1 CHIL @P0002@',
        '0 TRLR',
    ].join('\n');

    const media = (page: Page) => page.evaluate(() => {
        const persons = Object.values(window.Strom.DataManager.getData().persons) as any[];
        const by = (n: string) => persons.find(p => p.firstName === n);
        return { karel: by('Karel')?.photo ?? null, petr: (by('Petr')?.attachments ?? []).map((a: any) => a.id) };
    });

    test('adopted tree: "load the new version" without edits keeps the photos and attachments', async ({ page }) => {
        const { img, att } = await adoptWithImages(page);
        await dropFile(page, adoptedGed(true));
        await expect(page.locator('.toast')).toContainText('Updated the research');
        await expect(page.locator('#confirmation-modal')).toBeHidden();
        await expect(card(page, 'Marie')).toBeVisible();
        expect(await media(page)).toEqual({ karel: img, petr: [att] });
        // And again (now matched by the research's numbers).
        await dropFile(page, adoptedGed(true));
        await expect(page.locator('#confirmation-modal')).toBeHidden();
        await expect.poll(() => media(page)).toEqual({ karel: img, petr: [att] });
    });

    test('adopted tree, a photo added in the app: the dialog says images stay, "Update" keeps them', async ({ page }) => {
        const { img, att } = await adoptWithImages(page);
        await dropFile(page, adoptedGed());
        await expect(page.locator('.toast')).toContainText('Updated the research');
        const other = await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const petr = (Object.values(dm.getData().persons) as any[]).find(p => p.firstName === 'Petr');
            const url = `data:image/jpeg;base64,${'B'.repeat(3000)}`;
            dm.updatePerson(petr.id, { photo: url });
            return url;
        });
        await dropFile(page, adoptedGed(true));
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText('was changed in this app');
        await expect(dialog).toContainText('Photos, attachments and excerpts you added in the app stay');
        await dialog.getByRole('button', { name: 'Update' }).click();
        await expect(page.locator('.toast')).toContainText('Updated the research');
        await expect(card(page, 'Marie')).toBeVisible();
        expect(await media(page)).toEqual({ karel: img, petr: [att] });
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[])
            .find(p => p.firstName === 'Petr').photo)).toBe(other);
    });

    test('the research dropped a person with a photo: never silently, a dialog warns', async ({ page }) => {
        await adoptWithImages(page);
        await dropFile(page, adoptedGed());
        await expect(page.locator('.toast')).toContainText('Updated the research');
        const onlyPetr = adoptedGed().replace(/0 @P0001@ INDI[\s\S]*?(?=0 @P0002@)/, '').replace('1 HUSB @P0001@\n', '');
        await dropFile(page, onlyPetr);
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText('Images would be removed');
        await expect(dialog).toContainText('carry 1 image');
        await dialog.getByRole('button', { name: 'Open as copy' }).click();
        await expect(page.locator('.toast')).toContainText('Opened the research');
        expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(2);
    });

    test('an unknown token: a toast, no dialog, the research is told', async ({ page }) => {
        await appTree(page, ALL);
        const calls = { cancel: [] as string[], posted: [] as string[] };
        await routeBridge(page, 'x'.repeat(43), calls);
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), BRIDGE);
        await expect(page.locator('.toast')).toContainText('The research asked for a tree that is not here.');
        await expect(page.locator('#research-adopt-modal')).toHaveCount(0);
        await expect.poll(() => calls.cancel).toEqual([JSON.stringify({ reason: 'no-tree' })]);
    });

    test('"Don\'t hand over": the research is told, the tree stays unlinked', async ({ page }) => {
        await appTree(page, ALL);
        await page.evaluate(() => window.Strom.UI.startResearchAdopt(window.Strom.DataManager.getCurrentTreeId()));
        const token = (await launched(page))[0].match(TOKEN_RE)![1];
        const calls = { cancel: [] as string[], posted: [] as string[] };
        await routeBridge(page, token, calls);
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), BRIDGE);
        await page.locator('#research-adopt-cancel').click();
        await expect(page.locator('#research-adopt-modal')).toHaveCount(0);
        await expect.poll(() => calls.cancel).toEqual([JSON.stringify({ reason: 'cancelled' })]);
        expect(calls.posted).toEqual([]);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research)).toBeUndefined();
    });

    test('a person just added to a new tree: the open tree can go over at once', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seed(page, ALL);
        await openApp(page);
        const before = await page.evaluate(async () => {
            const id = await window.Strom.TreeManager.createTree('Nový');
            await window.Strom.DataManager.switchTree(id);
            const empty = window.Strom.UI.researchAdoptActiveAvailable();
            window.Strom.DataManager.createPerson({ firstName: 'Jan', lastName: 'Nový', gender: 'male' });
            return { empty, now: window.Strom.UI.researchAdoptActiveAvailable() };
        });
        expect(before).toEqual({ empty: false, now: true });
    });

    test('tree manager: "Start research with this tree ↗" in the row menu of an app tree', async ({ page }) => {
        await appTree(page, ALL);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const item = page.locator('.tree-manager-item', { hasText: 'Dvořákovi' }).locator('.tree-row-menu-item', { hasText: 'Start research with this tree ↗' });
        await expect(item).toHaveCount(1);
    });
});

test.describe('Where evidence is missing (tree health)', () => {
    async function tree(page: Page): Promise<void> {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(async () => {
            const p = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
                id, firstName, lastName: 'Horák', gender: 'male', isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [], ...extra,
            });
            await window.Strom.DataManager.importAsNewTree({
                persons: {
                    gp: p('gp', 'Václav', { partnerships: ['u1'], childIds: ['f'] }),
                    gm: p('gm', 'Marie', { gender: 'female', partnerships: ['u1'], childIds: ['f'] }),
                    f: p('f', 'Tomáš', { parentIds: ['gp', 'gm'], childIds: ['s'], birthSourceIds: ['s1'], birthDate: '1900' }),
                    s: p('s', 'Ondřej', { parentIds: ['f'], birthDate: '1930' }),
                },
                partnerships: { u1: { id: 'u1', person1Id: 'gp', person2Id: 'gm', childIds: ['f'], status: 'married', sourceIds: ['s1'] } },
                sources: { s1: { id: 's1', title: 'Matrika' } },
                defaultPersonId: 's',
            }, 'Horákovi');
            window.Strom.UI.updateTreeSwitcher();
        });
        await expect(card(page, 'Ondřej')).toBeVisible();
    }

    test('counts (a marriage citation counts), Show in tree, Next, Escape', async ({ page }) => {
        await tree(page);
        await page.evaluate(() => window.Strom.UI.showTreeHealthDialog(window.Strom.DataManager.getCurrentTreeId()));
        const block = page.locator('#tree-health-content .health-evidence');
        await expect(block.locator('.health-block-title')).toHaveText('Where evidence is missing');
        await expect(block.locator('.health-evidence-label')).toHaveText(['People without a source', 'Births without a source', 'Line ends (no parents)', 'Evidence in tree']);
        await expect(block.locator('.health-evidence-count')).toHaveText(['1 of 4', '1', '2']);

        await block.locator('[data-evidence="lineEnds"]').click();
        await expect(page.locator('#tree-health-modal')).toBeHidden();
        const pill = page.locator('#evidence-pill');
        await expect(pill).toContainText('Line ends (no parents) · 2');
        await expect(card(page, 'Václav')).toHaveClass(/evidence-hit/);
        await expect(card(page, 'Ondřej')).toHaveClass(/evidence-dim/);
        await expect(pill.locator('.evidence-pill-next')).toHaveText('Next person ›');
        await pill.locator('.evidence-pill-next').click();
        // Going through them says where you are.
        await expect(pill).toContainText('Line ends (no parents) · 1 / 2');
        await expect(card(page, 'Marie').or(card(page, 'Václav')).first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(pill).toHaveCount(0);
        await expect(page.locator('.person-card.evidence-dim')).toHaveCount(0);
    });

    test('citing the last person ends the highlight with a toast', async ({ page }) => {
        await tree(page);
        await page.evaluate(() => window.Strom.UI.showTreeHealthDialog(window.Strom.DataManager.getCurrentTreeId()));
        await page.locator('[data-evidence="noSource"]').click();
        await expect(page.locator('#evidence-pill')).toContainText('People without a source · 1');
        await expect(card(page, 'Ondřej')).toHaveClass(/evidence-hit/);
        await page.evaluate(() => window.Strom.DataManager.citePerson('s' as never, 's1'));
        await expect(page.locator('.toast')).toContainText('Done, no one left in this selection.');
        await expect(page.locator('#evidence-pill')).toHaveCount(0);
    });

    test('all documented: one sentence', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(async () => {
            await window.Strom.DataManager.importAsNewTree({
                persons: { a: { id: 'a', firstName: 'Jiří', lastName: 'Malý', gender: 'male', isPlaceholder: false,
                    partnerships: [], parentIds: [], childIds: [], sourceIds: ['s1'] } },
                partnerships: {}, sources: { s1: { id: 's1', title: 'Matrika' } },
            }, 'Malí');
        });
        await page.evaluate(() => window.Strom.UI.showTreeHealthDialog(window.Strom.DataManager.getCurrentTreeId()));
        await expect(page.locator('.health-evidence-good')).toHaveText('Everyone has a source and parents.');
    });
});
