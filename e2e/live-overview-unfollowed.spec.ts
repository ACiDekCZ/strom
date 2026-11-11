import { test, expect, Page } from '@playwright/test';
import { BRIDGE, FakeBridge, HEAD, UUID, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * The Research overview without following (spec 057 §7, K1.8–K1.11): opened
 * from the Research menu (first item, "Follow live" second with no mark),
 * from its bridge with the tiles, the sections and the strip "Follow live"
 * while the tree stays the user's and editable; an agent who begins is said
 * in the strip, nothing switches by itself; "Follow live" there follows; the
 * bridge not answering: the state "not running · Turn on", Awaiting action
 * "as of" what was said last, the lines from the tree's file, nothing of the
 * agent's work; a phone of 390 px from the tree only. Invented data (the
 * Fíškovi of Čapkov); the bridge is answered by page.route; a fixed clock.
 */

const NOW = new Date('2026-11-10T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat'];
const WAITING = [{ id: 'T0001', what: 'Confirm the baptism of Jan Fíšek' }, { id: 'T0002', what: 'Which register of Čapkov?' }];
const AGENT = { who: 'agent-matriky', since: '2026-11-10T10:20:00Z', task: 'křest Jana Fíška, Čapkov 1862', person: 'P0003', research: 'G0001', session: 'N0132' };
const DIRECTIONS = [
    { id: 'G0001', name: 'Předci Josefa Fíška', state: 'active', direction: 'ancestors', focus: 'P0001', order: 1, tasks: 3, waiting: 0, working: false, since: '2026-11-01T08:00:00Z' },
    { id: 'G0002', name: 'Předci Anny Svobodové', state: 'active', direction: 'ancestors', focus: 'P0002', order: 2, tasks: 1, waiting: 0, working: false, since: '2026-11-02T08:00:00Z' },
];
const QUEUE = [{ id: 'T0101', text: 'Matriky Čapkov', state: 'next', research: 'G0001' }];

/** The research tree with one line in its file (HEAD `_STROM_DIRECTION`), Josef and Jan in it. */
const GED = researchGed()
    .replace('1 CHAR UTF-8', ['1 CHAR UTF-8', '1 _STROM_DIRECTIONS Y', '1 _STROM_DIRECTION G0001', '2 NAME Předci Josefa Fíška',
        '2 TYPE ancestors', '2 _FOCUS P0001', '2 STAT active'].join('\n'))
    .replace('1 REFN P0001\n2 TYPE strom-research\n', '1 REFN P0001\n2 TYPE strom-research\n1 _STROM_DIRECTION G0001\n2 TYPE line\n')
    .replace('1 REFN P0003\n2 TYPE strom-research\n', '1 REFN P0003\n2 TYPE strom-research\n1 _STROM_DIRECTION G0001\n2 TYPE line\n');

/** The research tree, its bridge known here and answering (nobody at work); not followed. */
async function researchTree(page: Page, opts: { size?: { width: number; height: number }; working?: unknown[] } = {}): Promise<FakeBridge> {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize(opts.size ?? { width: 1440, height: 900 });
    await openResearch(page, { ged: GED });
    const bridge = await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, waiting: WAITING, treeGed: GED,
        statusExtra: { working: opts.working ?? [], researches: DIRECTIONS, queue: QUEUE },
    });
    await poll(page);
    return bridge;
}

const ov = (page: Page) => page.locator('#research-overview');
const strip = (page: Page) => ov(page).locator('.research-overview__follow');
const following = (page: Page) => page.evaluate(() => window.Strom.UI.isFollowingActiveResearch());
const readOnly = (page: Page) => page.evaluate(() => window.Strom.DataManager.isReadOnly() || window.Strom.DataManager.isLiveFollowing());
const sectionTitles = (page: Page) => ov(page).locator('.research-overview__body .live-section__title').allTextContents();

/** The overview from the Research menu's first item. */
async function openFromMenu(page: Page): Promise<void> {
    await page.locator('#research-menu-btn').click();
    const first = page.locator('#research-menu > .research-menu-group > .tree-switcher-action').first();
    await expect(first).toHaveAttribute('id', 'research-item-overview');
    await first.click();
    await expect(ov(page)).toBeVisible();
}

/** The status says someone is at work (or nobody), and the regular ask takes it in. */
async function setWorking(page: Page, bridge: FakeBridge, working: unknown[]): Promise<void> {
    bridge.statusExtra = { ...bridge.statusExtra, working };
    await poll(page);
}

test.describe('the Research overview without following', () => {
    test('the menu: Research overview first, Follow live second with no mark', async ({ page }) => {
        await researchTree(page);
        await page.locator('#research-menu-btn').click();
        const items = page.locator('#research-menu > .research-menu-group > .tree-switcher-action');
        await expect(items.nth(0)).toHaveAttribute('id', 'research-item-overview');
        await expect(items.nth(0)).toContainText('Research overview');
        await expect(items.nth(1)).toHaveAttribute('id', 'research-item-live');
        await expect(items.nth(1).locator('.research-open-mark, .ai-badge')).toHaveCount(0);
    });

    test('from its bridge: the tiles, the sections and the strip, the tree editable, refreshed when', async ({ page }) => {
        const bridge = await researchTree(page);
        await openFromMenu(page);
        // Not followed: the tree stays the user's (nothing loaded, nothing locked).
        expect(await following(page)).toBe(false);
        expect(await readOnly(page)).toBe(false);
        // The head: no Stop, no follow switch; the strip under it.
        await expect(ov(page).locator('.research-overview__head .live-panel-action')).toHaveCount(0);
        await expect(ov(page).locator('.live-follow-btn')).toHaveCount(0);
        await expect(strip(page)).toBeVisible();
        await expect(strip(page).locator('.research-overview__follow-note')).toHaveText('The tree switches to the research version and cannot be edited.');
        const btn = strip(page).locator('.research-overview__follow-live');
        await expect(btn).toHaveText('Follow live');
        await expect(btn).not.toHaveClass(/is-filled/);
        await expect(strip(page).locator('.research-overview__agent-started')).toHaveCount(0);
        // The state with when the bridge last answered; the 24 h tile beside it.
        const cells = ov(page).locator('.research-overview__summary .research-overview__cell');
        await expect(cells.first().locator('.research-overview__cell-sub')).toContainText('refreshed');
        await expect(ov(page).locator('.research-overview__summary')).toHaveClass(/research-overview__summary--n2|research-overview__summary--n3/);
        // The sections as when following: Awaiting action with its tasks, the directions, the queue.
        await expect(ov(page)).toContainText('Confirm the baptism of Jan Fíšek');
        await expect(ov(page).locator('.research-direction[data-direction="G0001"]')).toBeVisible();
        expect(await sectionTitles(page)).toEqual(['Now', 'Awaiting action · 2', 'Directions · 2 active', 'Progress', 'Queue']);
        // No line about turning it on (the research runs).
        await expect(ov(page).locator('.research-overview__after-on')).toHaveCount(0);
        // The tree can be edited meanwhile.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { birthPlace: 'Čapkov' });
        });
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Jan').birthPlace)).toBe('Čapkov');
        // The bridge was asked; nothing of following (no stream, no research tree loaded).
        expect((bridge.seen ?? []).some(s => s.endsWith('/events') || s.endsWith('/tree.ged'))).toBe(false);
        // × closes it; the tree as it was.
        await ov(page).locator('.research-overview__close').click();
        await expect(ov(page)).toHaveCount(0);
        expect(await readOnly(page)).toBe(false);
    });

    test('the queue says a task\'s kind (story, history) with a small tag; a task without it has none', async ({ page }) => {
        const bridge = await researchTree(page);
        bridge.statusExtra = {
            ...bridge.statusExtra, queue: [
                { id: 'T0101', text: 'Matriky Čapkov', state: 'next', research: 'G0001' },
                { id: 'T0102', text: 'Příběh Jana Fíška', state: 'next', research: 'G0001', kind: 'story' },
                { id: 'T0103', text: 'Požár Čapkova 1874', state: 'next', research: 'G0001', kind: 'history' },
            ],
        };
        await poll(page);
        await openFromMenu(page);
        const rows = ov(page).locator('.live-queue-row[data-task]');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0).locator('.live-queue-kind')).toHaveCount(0);
        await expect(rows.nth(1).locator('.live-queue-kind')).toHaveText('story');
        await expect(rows.nth(2).locator('.live-queue-kind')).toHaveText('history');
        // Quiet: the row's light text colour, a hairline frame.
        const look = await rows.nth(1).locator('.live-queue-kind').evaluate(el => {
            const cs = getComputedStyle(el);
            return { size: parseFloat(cs.fontSize), border: cs.borderTopStyle };
        });
        expect(look.size).toBeLessThanOrEqual(12);
        expect(look.border).toBe('solid');
    });

    test('an agent begins while it is open: said in the strip, the button filled, nothing switches or locks', async ({ page }) => {
        const bridge = await researchTree(page);
        await openFromMenu(page);
        await setWorking(page, bridge, [AGENT]);
        const said = strip(page).locator('.research-overview__agent-started');
        await expect(said).toHaveText('The agent started');
        await expect(said).toHaveAttribute('role', 'status');
        await expect(strip(page).locator('.research-overview__follow-live')).toHaveClass(/is-filled/);
        // The work is seen in Now; following has not begun.
        await expect(ov(page)).toContainText('agent-matriky');
        expect(await following(page)).toBe(false);
        expect(await readOnly(page)).toBe(false);
        // The agent stops: the strip as before.
        await setWorking(page, bridge, []);
        await expect(said).toHaveCount(0);
        await expect(strip(page).locator('.research-overview__follow-live')).not.toHaveClass(/is-filled/);
    });

    test('an agent already at work when it opens is not news', async ({ page }) => {
        await researchTree(page, { working: [AGENT] });
        await openFromMenu(page);
        await expect(strip(page)).toBeVisible();
        await expect(strip(page).locator('.research-overview__agent-started')).toHaveCount(0);
    });

    test('"Follow live" in the strip follows the research through its bridge; the overview stays open, now followed', async ({ page }) => {
        const bridge = await researchTree(page);
        // The research's stream: its hello says what the status does.
        await page.route(`${BRIDGE}/events*`, route => route.fulfill({
            status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream' },
            body: `event: hello\ndata: ${JSON.stringify({ tree: { id: UUID, name: 'Fíškovi' }, head: HEAD, links: LINKS, accepts: ACCEPTS, working: [], waiting: WAITING, queue: QUEUE, researches: DIRECTIONS })}\n\n`,
        }));
        await openFromMenu(page);
        await strip(page).locator('.research-overview__follow-live').click();
        await expect.poll(() => following(page), { timeout: 10000 }).toBe(true);
        expect((bridge.seen ?? []).some(s => s.endsWith('/tree.ged'))).toBe(true);
        // Followed now: the overview open, Stop in its head, no strip.
        await expect(ov(page)).toBeVisible();
        await expect(ov(page).locator('.research-overview__head .live-panel-action')).toHaveText('Stop following');
        await expect(strip(page)).toHaveCount(0);
        // The menu: the overview first, Stop following second.
        await page.locator('#research-menu-btn').click();
        const items = page.locator('#research-menu > .research-menu-group > .tree-switcher-action');
        await expect(items.nth(0)).toHaveAttribute('id', 'research-item-overview');
        await expect(items.nth(1)).toHaveAttribute('id', 'research-item-stop');
        await expect(page.locator('#research-item-live')).toHaveCount(0);
    });

    test('the bridge not answering: not running · Turn on, Awaiting action as of then, the lines from the file, nothing of the agent', async ({ page }) => {
        const bridge = await researchTree(page);
        // What the research said is remembered on this device; then it stops answering.
        bridge.down = true;
        await poll(page);
        await openFromMenu(page);
        expect(await readOnly(page)).toBe(false);
        await expect(ov(page).locator('.research-overview__head .live-dot')).toHaveClass(/live-dot--off/);
        await expect(strip(page)).toHaveCount(0);
        const summary = ov(page).locator('.research-overview__summary');
        await expect(summary).toHaveClass(/research-overview__summary--n1/);
        await expect(summary.locator('.research-overview__cell')).toHaveCount(1);
        await expect(summary).toContainText('The research is not running');
        // Awaiting action from memory, with when it was said.
        await expect(ov(page)).toContainText('Confirm the baptism of Jan Fíšek');
        await expect(ov(page).locator('.research-overview__as-of').first()).toContainText('as of');
        // The lines as the tree's file says them: the name and its people.
        const line = ov(page).locator('.research-overview__line[data-direction="G0001"]');
        await expect(line.locator('.research-overview__line-name')).toHaveText('Předci Josefa Fíška');
        await expect(line.locator('.research-overview__line-meta')).toHaveText('2 people');
        // No Now, Progress or Queue: one line names them.
        const titles = await sectionTitles(page);
        expect(titles).not.toContain('Queue');
        expect(titles).not.toContain('Now');
        await expect(ov(page).locator('.research-overview__after-on')).toHaveText(/^.+: once the research is on\.$/);
        await expect(ov(page).locator('.research-overview__after-on')).toContainText('Queue');
        // It answers again: the overview takes it in by itself.
        bridge.down = false;
        await poll(page);
        await expect(strip(page)).toBeVisible();
        await expect(ov(page).locator('.research-overview__after-on')).toHaveCount(0);
    });
});

test.describe('the Research overview on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a phone of 390 px: from the tree only, full width, no line about turning it on', async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await openResearch(page, { ged: GED, bridge: false });
        expect(await page.evaluate(() => window.Strom.UI.canOpenResearchOverview())).toBe(true);
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        await expect(ov(page)).toBeVisible();
        await expect(ov(page)).toHaveClass(/research-overview--sheet/);
        const summary = ov(page).locator('.research-overview__summary');
        await expect(summary).toContainText('From the tree only');
        await expect(summary).toContainText("The agent's work is visible on the computer with the research.");
        const [sBox, oBox] = await Promise.all([summary.boundingBox(), ov(page).boundingBox()]);
        expect(Math.round(sBox!.width)).toBe(Math.round(oBox!.width));
        await expect(ov(page).locator('.research-overview__line[data-direction="G0001"]')).toBeVisible();
        await expect(ov(page).locator('.research-overview__after-on')).toHaveCount(0);
        await expect(strip(page)).toHaveCount(0);
        // No horizontal scroll.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await readOnly(page)).toBe(false);
    });

    test('a phone: the tree actions sheet opens it from its Research group', async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await openResearch(page, { ged: GED, bridge: false });
        // Its first row: the overview of the open tree's research.
        const first = await page.evaluate(async () => {
            const ui = window.Strom.UI as unknown as { treeActionGroups(id: string, source: string): Promise<{ key: string; rows: { key: string; run(): void }[] }[]> };
            const id = window.Strom.TreeManager.getActiveTreeId()!;
            const row = (await ui.treeActionGroups(id, 'more')).find(x => x.key === 'research')?.rows[0];
            row?.run();
            return row?.key;
        });
        expect(first).toBe('researchOverview');
        await expect(ov(page)).toBeVisible();
        await expect(ov(page).locator('.research-overview__summary')).toContainText('From the tree only');
    });
});
