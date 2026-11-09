import { test, expect, Page, Browser } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The card's ! ("Awaiting action … Click: answer") and the person menu's
 * "Answer · N waiting" do what they say (1109): one item opens its answer as
 * its row's Answer does (the task in the research by its link); two or more
 * open the panel at the person's items, first and lit; an item nothing
 * answers here gets its row lit with the line why — never nothing. With the
 * panel closed and open, by mouse and by touch, without following and while
 * following. Invented data only.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const BRIDGE = 'http://127.0.0.1:5993/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'app', 'open', 'task', 'live', 'story', 'conflict'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 3f2a9c1e5b7d',
    '1 CHAR UTF-8', '1 NOTE Fíškovi',
    '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 REFN P0001', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0012@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 REFN P0012', '1 FAMC @F0001@',
    '0 @P0013@ INDI', '1 NAME Eva /Fíšková/', '1 SEX F', '1 BIRT', '2 DATE 1868', '1 REFN P0013', '1 FAMC @F0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
    '0 TRLR',
].join('\n');

/**
 * Six of Josef's first (so the panel's five rows are full of them), then one
 * of Eva's and two of Jan's.
 */
const WAITING = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `T000${i + 1}`, what: `Josefův úkol ${i + 1}`, person: 'P0001' })),
    { id: 'T0007', what: 'Uložte snímek oddací matriky', person: 'P0013' },
    { id: 'T0008', what: 'Potvrďte otce Jana', person: 'P0012' },
    { id: 'T0009', what: 'Opište zápis o křtu Jana', person: 'P0012' },
];

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'tree-strom.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

/** Links the research takes are caught, not handed to the system. */
async function catchLinks(page: Page): Promise<void> {
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}

const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

/** The research tree, not followed; the research last said what waits (and, with `links`, that it takes its links here). */
async function idle(page: Page, links: string[] | null): Promise<void> {
    await page.addInitScript(({ uuid, waiting, links }) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({ items: waiting, at: new Date(Date.now() - 3600_000).toISOString() }));
        if (links) localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, { uuid: UUID, waiting: WAITING, links });
    await openApp(page);
    await dropFile(page, GED);
    await expect(card(page, 'Eva')).toBeVisible();
    await catchLinks(page);
}

const panel = (page: Page) => page.locator('#live-panel');
const lit = (page: Page) => panel(page).locator('.live-waiting-row.is-person-focus');

/** Jan's two items: first in the panel, lit, in view; nothing launched. */
async function expectJanLit(page: Page): Promise<void> {
    await expect(panel(page)).toBeVisible();
    await expect(lit(page)).toHaveCount(2);
    const rows = panel(page).locator('.live-waiting-row');
    await expect(rows.nth(0)).toHaveAttribute('data-waiting-id', 'T0008');
    await expect(rows.nth(1)).toHaveAttribute('data-waiting-id', 'T0009');
    await expect(lit(page).first()).toBeInViewport();
}

test.describe('the card\'s ! answers (1109)', () => {
    test('mouse, not following: one item opens its answer in the research, with the panel closed and open; two light the person\'s rows', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await idle(page, LINKS);
        await expect(panel(page)).toHaveCount(0);

        // Eva: one task — the research at that task, nothing else opens.
        await card(page, 'Eva').locator('.card-signal').click();
        await expect.poll(() => launched(page)).toEqual([expect.stringMatching(/:\/\/task\?tree=.*task=T0007/)]);
        await expect(page.locator('.context-menu')).toHaveCount(0);

        // Jan: two — the panel at them, first and lit, even though Josef's five came before.
        await card(page, 'Jan').locator('.card-signal').click();
        await expectJanLit(page);
        expect(await launched(page)).toHaveLength(1);

        // With the panel open, Eva's ! still answers.
        await card(page, 'Eva').locator('.card-signal').click();
        await expect.poll(async () => (await launched(page)).length).toBe(2);
        expect((await launched(page))[1]).toMatch(/task=T0007/);

        // The research menu's "Waiting for you" (everyone): the research's own order again, nothing lit.
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        await expect(lit(page)).toHaveCount(0);
        await expect(panel(page).locator('.live-waiting-row').first()).toHaveAttribute('data-waiting-id', 'T0001');
    });

    test('mouse: the person menu\'s "Answer · N waiting" does the same as the !', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await idle(page, LINKS);
        await card(page, 'Jan').locator('.name').click();
        const item = page.locator('.context-menu [data-action="signal-waiting"]');
        await expect(item).toHaveText(/Answer · 2 waiting/);
        await item.click();
        await expectJanLit(page);

        await card(page, 'Eva').locator('.name').click();
        await expect(item).toHaveText(/Answer · 1 waiting/);
        await item.click();
        await expect.poll(() => launched(page)).toEqual([expect.stringMatching(/task=T0007/)]);
    });

    test('mouse, the research not taking its links here: the item\'s row lit with why it cannot be answered here, never nothing', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await idle(page, null);
        await card(page, 'Eva').locator('.card-signal').click();
        await expect(panel(page)).toBeVisible();
        await expect(lit(page)).toHaveCount(1);
        await expect(lit(page)).toHaveAttribute('data-waiting-id', 'T0007');
        await expect(lit(page).locator('.live-waiting-why')).toHaveText(/Not answerable here/);
        await expect(lit(page)).toBeInViewport();
        expect(await launched(page)).toEqual([]);
    });

    async function touchPage(browser: Browser): Promise<Page> {
        const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false, locale: 'en-US' });
        return context.newPage();
    }

    async function tapBadge(page: Page, name: string): Promise<void> {
        const b = (await card(page, name).locator('.card-signal').boundingBox())!;
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        const act = page.locator('#status-tip .st-mark-action');
        await expect(act).toHaveCount(1);
        await act.tap();
    }

    test('touch: the bubble\'s button leads to the person\'s items, lit; one nothing answers on a touch screen says why', async ({ browser }) => {
        const page = await touchPage(browser);
        await idle(page, LINKS);
        await tapBadge(page, 'Eva');
        await expect(panel(page)).toBeVisible();
        await expect(lit(page)).toHaveCount(1);
        await expect(lit(page).locator('.live-waiting-why')).toBeVisible();
        await tapBadge(page, 'Jan');
        await expectJanLit(page);
        await page.context().close();
    });

    /** Following the research: its bridge says what waits and takes the links. */
    async function follow(page: Page, size = { width: 1440, height: 900 }): Promise<void> {
        await page.setViewportSize(size);
        await page.addInitScript((links) => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        }, LINKS);
        const status = () => ({
            tree: { id: UUID, name: 'Fíškovi' }, head: 'h1', persons: 4,
            working: [{ who: 'agent-matriky', since: new Date().toISOString(), task: 'T0101 Matriky', person: 'P0001' }],
            waiting: WAITING, queue: [], links: LINKS,
        });
        await page.route(`${BRIDGE}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
            if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
            if (path.endsWith('/events')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
            }
            return route.fulfill({ status: 404, headers: cors, body: '' });
        });
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        await expect(panel(page)).toBeAttached();
        await expect(card(page, 'Eva').locator('.card-signal')).toBeVisible();
        await catchLinks(page);
    }

    test('following: one item answers, two are lit in the open panel and in a folded one it unfolds', async ({ page }) => {
        await follow(page);
        await card(page, 'Eva').locator('.card-signal').click();
        await expect.poll(() => launched(page)).toEqual([expect.stringMatching(/task=T0007/)]);

        await card(page, 'Jan').locator('.card-signal').click();
        await expectJanLit(page);

        // The panel folded: the ! unfolds it at Jan's items.
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(panel(page)).toHaveClass(/collapsed/);
        await expect(lit(page)).toHaveCount(0);
        await card(page, 'Jan').locator('.card-signal').click();
        await expect(panel(page)).not.toHaveClass(/collapsed/);
        await expectJanLit(page);
    });

    test('following on a phone: the panel is a strip, so the overview opens at the person\'s items, lit', async ({ page }) => {
        await follow(page, { width: 390, height: 844 });
        await card(page, 'Jan').locator('.card-signal').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        const rows = ov.locator('.research-overview__waiting-item.is-person-focus');
        await expect(rows).toHaveCount(2);
        await expect(rows.first()).toBeInViewport();
        expect(await launched(page)).toEqual([]);
    });
});
