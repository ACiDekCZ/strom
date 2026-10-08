import { test, expect, Page } from '@playwright/test';
import { card, openPersonSubmenu } from './helpers.js';

/**
 * Research directions in the Research overview: the Directions section after
 * Now (two or more only), order and the folded "Paused and ended", an empty
 * direction with End ↗, the ⋯ menu by state, one detail at a time
 * (generations for ancestors, Work on it ↗, Show in tree), an older research
 * without the new fields, the direction named beside tasks and the queue
 * filter, Finish and stop ↗, the person menu naming an existing direction,
 * and the phone sheet. Invented data only.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const BRIDGE = 'http://127.0.0.1:5996/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const ALL = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research',
    'new', 'update', 'sessions', 'conflict', 'story', 'sync-undo', 'setup', 'live', 'direction', 'finish'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Víškovi',
    '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 REFN P0001', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0012@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 REFN P0012', '1 FAMC @F0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@',
    '0 TRLR',
].join('\n');

const ago = (min: number): string => new Date(Date.now() - min * 60_000).toISOString();

const DIRECTIONS = [
    { id: 'G0003', name: 'Revize Anny', state: 'active', direction: 'person', focus: 'P0002', tasks: 0, waiting: 0, working: false, since: ago(60) },
    { id: 'G0002', name: 'Potomci: Josef', state: 'active', direction: 'descendants', focus: 'P0001', tasks: 1, waiting: 0, working: false, since: ago(30) },
    { id: 'G0001', name: 'Předci: Jan', state: 'active', direction: 'ancestors', focus: 'P0012', tasks: 2, waiting: 1, working: true, since: ago(600),
        generations: [2, 1, 0], last: { at: ago(120), text: 'sňatek rodičů nalezen' } },
    { id: 'G0004', name: 'Předci: Anna', state: 'paused', direction: 'ancestors', focus: 'P0002', reason: 'matriky ještě nejsou online', since: ago(1440) },
    { id: 'G0005', name: 'Kdo byl kmotr?', state: 'done', direction: 'question', since: ago(2880) },
];

interface Bridge { researches: Record<string, unknown>[] }

async function follow(page: Page, researches: Record<string, unknown>[] = DIRECTIONS,
    size = { width: 1440, height: 900 }): Promise<Bridge> {
    await page.setViewportSize(size);
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, ALL);
    const bridge: Bridge = { researches };
    const status = () => ({
        tree: { id: UUID, name: 'Víškovi' }, head: 'h1', persons: 3,
        working: [{ who: 'agent-matriky', since: ago(16), task: 'T0101 Matriky Chlumy', person: 'P0012', research: 'G0001', session: 'N0132' }],
        waiting: [{ id: 'T0004', what: 'Potvrďte otce Jana', person: 'P0012', research: 'G0001', at: ago(5) }],
        queue: [
            { id: 'T0101', text: 'Matriky Chlumy', state: 'next', research: 'G0001' },
            { id: 'T0102', text: 'Pozemková kniha', state: 'next', research: 'G0001' },
            { id: 'T0103', text: 'Děti Josefa', state: 'next', research: 'G0002' },
        ],
        links: ALL,
        researches: bridge.researches,
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
    await expect(page.locator('#live-panel')).toBeVisible();
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
    return bridge;
}

const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

async function openOverview(page: Page): Promise<void> {
    await page.locator('#live-panel .live-panel-expand').click();
    await expect(page.locator('#research-overview')).toBeVisible();
}

const ov = (page: Page) => page.locator('#research-overview');
const row = (page: Page, id: string) => ov(page).locator(`.research-direction[data-direction="${id}"]`);

test.describe('research directions', () => {
    test('one direction: no section, tasks name none, no queue filter', async ({ page }) => {
        await follow(page, [DIRECTIONS[2]]);
        await openOverview(page);
        await expect(ov(page).locator('.research-directions')).toHaveCount(0);
        await expect(ov(page).locator('.research-overview__dir')).toHaveCount(0);
        await ov(page).locator('.live-queue-toggle').click();
        await expect(ov(page).locator('.research-overview__queue-filters')).toHaveCount(0);
    });

    test('three running, two paused: the one worked on first, the rest folded', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        const sec = ov(page).locator('.research-directions');
        await expect(ov(page).locator('.live-section__title', { hasText: 'Directions' })).toHaveText('Directions · 3 running');
        await expect(sec.locator('.research-direction__name')).toHaveText(['Předci: Jan', 'Potomci: Josef', 'Revize Anny']);
        await expect(row(page, 'G0001').locator('.research-direction__icon')).toHaveText('↑');
        await expect(row(page, 'G0001').locator('.agent-mark--spin')).toHaveCount(1);
        await expect(row(page, 'G0001').locator('.research-direction__meta')).toHaveText(/Jan Víšek.*2 tasks.*1 awaiting an answer/);
        // Directions sit right after Now.
        const titles = await ov(page).locator('.live-section__title').allTextContents();
        expect(titles.indexOf('Directions · 3 running')).toBe(titles.indexOf('Now') + 1);
        const inactive = sec.locator('.research-directions__inactive');
        await expect(inactive).toHaveText('▸Paused and ended · 2');
        await inactive.click();
        await expect(row(page, 'G0004').locator('.research-direction__chip')).toHaveText('paused');
        await expect(row(page, 'G0004').locator('.research-direction__meta')).toContainText('“matriky ještě nejsou online” · since');
        await row(page, 'G0004').locator('.research-direction__do').click();
        expect(await launched(page)).toEqual([`strom-research://direction?tree=${UUID}&id=G0004&do=resume`]);
    });

    test('an empty direction: the sentence and End ↗ on its row', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        const empty = row(page, 'G0003');
        await expect(empty.locator('.research-direction__empty')).toHaveText('Nothing to do, it can be ended.');
        await empty.locator('.research-direction__do').click();
        expect(await launched(page)).toEqual([`strom-research://direction?tree=${UUID}&id=G0003&do=done`]);
    });

    test('⋯: pause or end a running one, each with what happens', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        await row(page, 'G0002').locator('.research-direction__more').click();
        const menu = page.locator('#live-direction-menu');
        await expect(menu.locator('.research-direction-menu__label')).toHaveText(['Pause ↗', 'End ↗']);
        await expect(menu.locator('.research-direction-menu__hint').first()).toHaveText('Tasks leave the queue, nothing is deleted');
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await row(page, 'G0002').locator('.research-direction__more').click();
        await menu.locator('[data-do="pause"]').click();
        expect(await launched(page)).toEqual([`strom-research://direction?tree=${UUID}&id=G0002&do=pause`]);
    });

    test('⋯ closed at once (Escape, a redraw) leaves the next menu working: Pause ↗ is not lost', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        const more = row(page, 'G0002').locator('.research-direction__more');
        // Opened and closed in one go, before its press-outside guard is armed.
        await more.evaluate((b: HTMLElement) => { b.click(); b.click(); });
        await expect(page.locator('#live-direction-menu')).toHaveCount(0);
        await more.click();
        await page.locator('#live-direction-menu [data-do="pause"]').click();
        expect(await launched(page)).toEqual([`strom-research://direction?tree=${UUID}&id=G0002&do=pause`]);
    });

    test('detail: one at a time; generations for ancestors; Work on it ↗; Show in tree', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        await row(page, 'G0001').locator('.research-direction__head').click();
        const detail = row(page, 'G0001').locator('.research-direction__detail');
        await expect(detail.locator('.research-direction__gen-text')).toHaveText(['2/2 parents', '1/4 grandparents', '0/8 gen. 3']);
        await expect(detail.locator('.research-direction__last')).toContainText('sňatek rodičů nalezen');
        await row(page, 'G0002').locator('.research-direction__head').click();
        await expect(ov(page).locator('.research-direction__detail')).toHaveCount(1);
        await expect(row(page, 'G0002').locator('.research-direction__gens')).toHaveCount(0);
        await row(page, 'G0002').locator('[data-do="work"]').click();
        expect(await launched(page)).toEqual([`strom-research://chat?tree=${UUID}&research=G0002`]);
        // Jan's ancestors: Jan, Josef and Anna.
        await row(page, 'G0002').locator('.research-direction__head').click();
        await row(page, 'G0001').locator('.research-direction__head').click();
        await row(page, 'G0001').locator('[data-do="show"]').click();
        await expect(page.locator('#evidence-pill')).toContainText('Předci: Jan');
        await expect(page.locator('#evidence-pill')).toContainText('3');
    });

    test('an older research: the name and the state only', async ({ page }) => {
        await follow(page, [{ id: 'G0001', name: 'Předci: Jan', state: 'active' }, { id: 'G0002', name: 'Revize Anny', state: 'active' }]);
        await openOverview(page);
        await expect(row(page, 'G0001').locator('.research-direction__icon')).toHaveClass(/is-blank/);
        await expect(row(page, 'G0001').locator('.research-direction__meta')).toHaveCount(0);
        await expect(row(page, 'G0001').locator('.research-direction__do')).toHaveCount(0);
    });

    test('two or more running: tasks name their direction, the queue filters by it', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        await expect(ov(page).locator('.research-overview__now-row .research-overview__dir')).toHaveText(' · Předci: Jan');
        await ov(page).locator('.live-queue-toggle').click();
        const pills = ov(page).locator('.research-overview__queue-filters .research-overview__filter');
        await expect(pills).toHaveText(['All 3', 'Předci: Jan 2', 'Potomci: Josef 1', 'Revize Anny 0']);
        await pills.nth(2).click();
        await expect(ov(page).locator('.live-queue-row:not(.live-queue-row--more) .live-queue-text')).toHaveText(['Děti Josefa · Potomci: Josef']);
    });

    test('Now: Finish and stop ↗ with the session', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        const finish = ov(page).locator('.research-overview__finish');
        await expect(finish).toHaveAttribute('title', 'The agent writes up findings and closes the session');
        await finish.click();
        expect(await launched(page)).toEqual([`strom-research://finish?tree=${UUID}&session=N0132`]);
    });

    test('person menu: a running direction says so and opens it; a paused one restarts', async ({ page }) => {
        await follow(page);
        await card(page, 'Jan').click();
        await openPersonSubmenu(page, 'research');
        const item = page.locator('.context-submenu [data-action="research-ancestors"]');
        await expect(item.locator('.menu-item-state')).toHaveText('already running');
        await item.click();
        await expect(row(page, 'G0001').locator('.research-direction__detail')).toBeVisible();
        await page.keyboard.press('Escape');
        await card(page, 'Anna').click();
        await openPersonSubmenu(page, 'research');
        const anna = page.locator('.context-submenu [data-action="research-ancestors"]');
        await expect(anna.locator('.menu-item-note')).toHaveText('Paused · restart');
        await anna.click();
        expect(await launched(page)).toEqual([`strom-research://direction?tree=${UUID}&id=G0004&do=resume`]);
    });

    test('phone: no ⋯ and no ↗; a tap lights the direction up in the tree', async ({ page }) => {
        await follow(page, DIRECTIONS, { width: 360, height: 740 });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(ov(page)).toBeVisible();
        await expect(ov(page).locator('.research-direction__more')).toHaveCount(0);
        await expect(ov(page).locator('.research-direction__do')).toHaveCount(0);
        await expect(row(page, 'G0003').locator('.research-direction__empty')).toHaveText('Nothing to do · it can be ended in the research on the computer');
        const box = await row(page, 'G0001').boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        await row(page, 'G0002').locator('.research-direction__head').click();
        await expect(ov(page)).toHaveCount(0);
        await expect(page.locator('#evidence-pill')).toContainText('Potomci: Josef');
    });

    test('reduced motion: the arc of the direction worked on stands still', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await follow(page);
        await openOverview(page);
        await expect(row(page, 'G0001').locator('.agent-mark--spin')).toHaveCSS('animation-name', 'none');
    });
});
