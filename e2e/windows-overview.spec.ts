import { test, expect, Page, Request } from '@playwright/test';
import { fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';
import { card } from './helpers.js';
import { CAPS, followManaged } from './live-directions-bridge.js';

/**
 * The Research overview in a window of its own (spec 079 K3, §6): opened from
 * ⧉ in the overview's head or from the ⧉ menu, drawn from the main window's
 * snapshot in two columns from 1100 px and one below; its actions (Show in
 * tree, an answer to Awaiting action, Stop) are done by the main window;
 * while it is open the main window opens no overview of its own (⤢ brings the
 * window to the front); once it closes the main window behaves as before. The
 * window itself never asks the research's bridge. Its states (§6 states 3–5):
 * the research not running (what the tree holds, the answers greyed, "not
 * running · Turn on" with Turn on done by the main window), the main window
 * on a tree without research (the window says so, and draws the overview
 * again back on the research's tree), the main window closed (the strip, the
 * last state frozen "as of", every action greyed and nothing sent; a new main
 * window: live again), the tree deleted in the main window ("The tree no
 * longer exists", Close window) or locked there ("The tree is locked", Go to
 * the main window, nothing of the research kept; unlocked: the overview
 * again); a task's place in the queue set from the window is written by the
 * main window. Invented data only.
 */

const UUID = '7c2e4a1b-3d5f-4e6a-8b9c-1d2e3f4a5b6c';
const BRIDGE = 'http://127.0.0.1:5997/a1b2c3d4e5f60718293a4b5c6d7e8f90';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research', 'live'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 2 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Brezinovi',
    '0 @P0001@ INDI', '1 NAME Ondřej /Březina/', '1 SEX M', '1 BIRT', '2 DATE 1871', '1 REFN P0001',
    '0 @P0002@ INDI', '1 NAME Libuše /Kordová/', '1 SEX F', '1 BIRT', '2 DATE 1875', '1 REFN P0002',
    '0 TRLR',
].join('\n');

interface Bridge {
    waiting: Record<string, unknown>[];
    writes: { path: string; body: Record<string, unknown> }[];
}

const DESKTOP = { width: 1440, height: 900 };

/** The main window follows a research whose bridge answers (routed for every page of the context). */
async function follow(page: Page): Promise<Bridge> {
    await page.setViewportSize(DESKTOP);
    await page.context().addInitScript((links) => {
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const bridge: Bridge = {
        waiting: [
            { id: 'T0001', what: 'Ověřit datum sňatku v oddací matrice', kind: 'web', section: 'web', at, order: 0, person: 'P0001',
              group: { key: 'host:farnost.example', name: 'farnost.example', kind: 'web' }, url: 'https://farnost.example/matriky', actions: ['answer'] },
        ],
        writes: [],
    };
    const status = () => ({
        tree: { id: UUID, name: 'Březinovi' }, head: 'h1', persons: 2, links: LINKS, queue: [],
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 12 * 60_000).toISOString(), task: 'Sčítání 1910', person: 'P0002' }],
        waiting: bridge.waiting, features: ['waiting.groups', 'waiting.answer'],
    });
    const json = (s: number, body: unknown) => ({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // On the context: a window that asked the bridge would be answered (and seen by the test).
    await page.context().route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, PUT', 'access-control-allow-headers': '*' } });
        }
        if (path.endsWith('/status')) return route.fulfill(json(200, status()));
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        const write = /\/waiting\/(T\d+)$/.exec(path);
        if (write && req.method() === 'POST') {
            bridge.writes.push({ path: write[1], body: JSON.parse(req.postData() || '{}') as Record<string, unknown> });
            const i = bridge.waiting.findIndex(w => w.id === write[1]);
            if (i >= 0) bridge.waiting.splice(i, 1);
            return route.fulfill(json(200, { task: write[1], head: '' }));
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel .live-panel-expand')).toBeVisible();
    return bridge;
}

/** Requests to the bridge made by any page but the main window. */
function bridgeRequestsOutsideMain(page: Page): string[] {
    const out: string[] = [];
    page.context().on('request', (req: Request) => {
        if (!req.url().startsWith('http://127.0.0.1:5997/')) return;
        let from: Page | null = null;
        try { from = req.frame().page(); } catch { /* a service worker's */ }
        if (from !== page) out.push(req.url());
    });
    return out;
}

/** The main window's calls of a few of its functions (what the window's actions reach). */
async function spyMain(page: Page): Promise<void> {
    await page.evaluate(() => {
        const ui = window.Strom.UI as unknown as Record<string, (...a: unknown[]) => unknown>;
        const calls: { fn: string; args: unknown[] }[] = [];
        (window as unknown as { __calls: typeof calls }).__calls = calls;
        for (const fn of ['overviewShowPerson']) {
            const orig = ui[fn];
            ui[fn] = function (this: unknown, ...args: unknown[]) {
                calls.push({ fn, args });
                return orig.apply(this, args);
            };
        }
        const reg = window.Strom.Windows as unknown as { focusWindow(id: string): Promise<boolean> };
        const focus = reg.focusWindow.bind(reg);
        reg.focusWindow = (id: string) => {
            calls.push({ fn: 'focusWindow', args: [id] });
            return focus(id);
        };
    });
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: { fn: string; args: unknown[] }[] }).__calls);

async function popupOf(page: Page, click: () => Promise<void>): Promise<Page> {
    const [popup] = await Promise.all([page.waitForEvent('popup'), click()]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toContain('okno=overview');
    await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
    return popup;
}

const mainOverview = (page: Page) => page.locator('#research-overview');
const expand = (page: Page) => page.locator('#live-panel .live-panel-expand');

test.describe('the Research overview in a window of its own', () => {
    test.use({ viewport: DESKTOP });

    test('from ⧉ in the overview\'s head: two columns at 1440; Show in tree and an answer are done by the main window; ⤢ brings the window forward; closed, all as before', async ({ page }) => {
        const bridge = await follow(page);
        const outside = bridgeRequestsOutsideMain(page);
        await expand(page).click();
        await expect(mainOverview(page)).toBeVisible();
        // Today's overview: one status dot in its head.
        await expect(mainOverview(page).locator('.research-overview__head > .live-dot')).toHaveCount(1);
        const winBtn = mainOverview(page).locator('.research-overview__window');
        await expect(winBtn).toHaveAccessibleName('Open in a new window');

        const popup = await popupOf(page, () => winBtn.click());
        await spyMain(page);
        // The docked overview closes here; the small panel stays.
        await expect(mainOverview(page)).toBeHidden();
        await expect(page.locator('#live-panel')).toBeVisible();

        await popup.setViewportSize(DESKTOP);
        const ov = popup.locator('#research-overview');
        // The window's head: the dot, "{tree} · Research overview", the research's name, ◎, Stop, ⋯; no ⤡ or ⧉.
        const head = ov.locator('.research-overview__head--window');
        await expect(head.locator('.live-dot')).toHaveCount(1);
        await expect(head.locator('.research-overview__title')).toHaveText(/ · Research overview$/);
        await expect(head.locator('.research-overview__stop')).toHaveText('Stop following');
        await expect(head.locator('.live-follow-btn')).toBeVisible();
        await expect(head.locator('.research-overview__more')).toBeVisible();
        await expect(ov.locator('.research-overview__close, .research-overview__window')).toHaveCount(0);
        // Two columns: Now and Awaiting action left, the rest right.
        await expect(ov).toHaveClass(/research-overview--cols/);
        const left = ov.locator('.research-overview__col--left');
        await expect(left.locator('.live-section__title').first()).toHaveText(/^Now/);
        await expect(left.locator('.live-section__title').nth(1)).toHaveText(/^Awaiting action/);
        const boxes = await ov.locator('.research-overview__col').evaluateAll(cols => cols.map(c => c.getBoundingClientRect().left));
        expect(boxes).toHaveLength(2);
        expect(boxes[1]).toBeGreaterThan(boxes[0] + 300);

        // Show in tree: the main window centres the person.
        await ov.locator('.research-overview__now-row .link-button', { hasText: 'Show in tree' }).click();
        await expect.poll(async () => (await calls(page)).filter(c => c.fn === 'overviewShowPerson').length).toBe(1);
        const shown = (await calls(page)).find(c => c.fn === 'overviewShowPerson')!;
        expect(await page.evaluate((id) => window.Strom.DataManager.getPerson(id as never)?.firstName, shown.args[0])).toBe('Libuše');

        // An answer to Awaiting action: written to the bridge by the main window; the row goes in the window.
        const group = ov.locator('.research-overview__waiting-group');
        if (await group.count() > 0 && await group.first().getAttribute('aria-expanded') === 'false') await group.first().click();
        const item = ov.locator('.research-overview__waiting-item[data-id="T0001"]');
        await item.locator('.research-overview__waiting-row').click();
        await item.locator('.waiting-actions [data-action="answer"]').click();
        await item.locator('.waiting-answer textarea').fill('Sňatek je zapsán 12. 2. 1898.');
        await item.locator('.waiting-answer__send').click();
        await expect.poll(() => bridge.writes.length).toBe(1);
        expect(bridge.writes[0]).toMatchObject({ path: 'T0001', body: { do: 'answer', text: 'Sňatek je zapsán 12. 2. 1898.' } });
        await expect(ov.locator('.research-overview__waiting-item[data-id="T0001"]')).toHaveCount(0);

        // ⤢ in the main window: no overview here, the window comes forward; its title says so.
        await expect(expand(page)).toHaveAttribute('title', 'The research overview is in a separate window · click brings it to the front');
        const before = (await calls(page)).filter(c => c.fn === 'focusWindow').length;
        await expand(page).click();
        await expect.poll(async () => (await calls(page)).filter(c => c.fn === 'focusWindow').length).toBe(before + 1);
        await expect(mainOverview(page)).toBeHidden();
        // The ⧉ menu's item brings it forward too, no second window.
        await page.locator('#view-window-btn').click();
        const menuItem = page.locator('#view-window-menu [data-view="overview"]');
        await expect(menuItem).toHaveAttribute('title', 'The research overview is in a separate window · click brings it to the front');
        await menuItem.click();
        await expect.poll(async () => (await calls(page)).filter(c => c.fn === 'focusWindow').length).toBe(before + 2);
        await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(1);

        // The window asked the bridge nothing.
        expect(outside).toEqual([]);

        // Closed: ⤢ opens the overview here again, as before.
        await popup.close();
        await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(0);
        await expect(expand(page)).not.toHaveAttribute('title', /separate window/);
        await expand(page).click();
        await expect(mainOverview(page)).toBeVisible();
        await expect(mainOverview(page).locator('.research-overview__head > .live-dot')).toHaveCount(1);
        await expect(mainOverview(page).locator('.research-overview__window')).toBeVisible();
    });

    test('from the ⧉ menu: one column at 900; Stop ends following in the main window and the window shows the research without following', async ({ page }) => {
        await follow(page);
        const outside = bridgeRequestsOutsideMain(page);
        await page.locator('#view-window-btn').click();
        const menuItem = page.locator('#view-window-menu [data-view="overview"]');
        await expect(menuItem).toHaveText('Research overview');
        const popup = await popupOf(page, () => menuItem.click());
        await expect(mainOverview(page)).toBeHidden();

        await popup.setViewportSize({ width: 900, height: 900 });
        const ov = popup.locator('#research-overview');
        await expect(ov).not.toHaveClass(/research-overview--cols/);
        await expect(ov.locator('.research-overview__col')).toHaveCount(0);
        // Wider again: two columns.
        await popup.setViewportSize(DESKTOP);
        await expect(ov).toHaveClass(/research-overview--cols/);
        await popup.setViewportSize({ width: 900, height: 900 });
        await expect(ov).not.toHaveClass(/research-overview--cols/);

        // A section hidden in the main window (Settings, its panel): the window draws without it.
        await expect(ov.locator('.live-section__title', { hasText: /^Now/ })).toHaveCount(1);
        await page.evaluate(() => localStorage.setItem('strom-live-section-prefs', JSON.stringify({ v: 2, s: { working: 'hidden' } })));
        await expect(ov.locator('.live-section__title', { hasText: /^Now/ })).toHaveCount(0);

        // Stop: the main window stops following; the window draws the research viewed through its bridge.
        await ov.locator('.research-overview__stop').click();
        await expect.poll(() => page.evaluate(() => window.Strom.UI.isFollowingActiveResearch())).toBe(false);
        await expect(ov.locator('.research-overview__stop')).toHaveCount(0);
        await expect(ov.locator('.research-overview__head--window .live-dot')).toHaveClass(/live-dot--off/);
        await expect(mainOverview(page)).toBeHidden();

        expect(outside).toEqual([]);
        await popup.close();
    });
});

/** What the window posts to the main window as research actions (recorded in the window). */
async function spyPosted(popup: Page): Promise<void> {
    await popup.evaluate(() => {
        const posted: unknown[] = [];
        (window as unknown as { __posted: unknown[] }).__posted = posted;
        const orig = BroadcastChannel.prototype.postMessage;
        BroadcastChannel.prototype.postMessage = function (this: BroadcastChannel, m: unknown) {
            if ((m as { type?: string } | null)?.type === 'research-action') posted.push(m);
            return orig.call(this, m);
        };
    });
}
const posted = (popup: Page) => popup.evaluate(() => (window as unknown as { __posted: { action: string; args?: unknown }[] }).__posted);

/** The overview window from the ⧉ menu (the open tree has a research). */
async function openFromMenu(page: Page): Promise<Page> {
    await page.locator('#view-window-btn').click();
    return popupOf(page, () => page.locator('#view-window-menu [data-view="overview"]').click());
}

test.describe('the overview window\'s states', () => {
    test.use({ viewport: DESKTOP });
    const WAITING = [{ id: 'T0001', what: 'Confirm the baptism of Jan Fíšek', actions: ['answer'] }];
    const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };

    test('state 3: the bridge stops: what the tree holds, Awaiting action as said with its answers greyed, "not running · Turn on" done by the main window', async ({ page }) => {
        await openResearch(page, { ged: researchGed() });
        const bridge = await fakeBridge(page, { accepts: ACCEPTS, links: ['send', 'open', 'live', 'app', 'setup', 'chat'], waiting: WAITING });
        await poll(page);
        const popup = await openFromMenu(page);
        const ov = popup.locator('#research-overview');
        // Through the bridge first: no frame.
        await expect(ov.locator('.research-overview__follow-live--head')).toBeVisible();
        await expect(ov.locator('.research-overview__off-frame')).toHaveCount(0);
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as Record<string, unknown>;
            const calls: unknown[] = [];
            (window as unknown as { __turnOn: unknown[] }).__turnOn = calls;
            ui.toggleResearchLive = async (id: unknown) => { calls.push(id); };
        });

        // It stops answering.
        bridge.down = true;
        await poll(page);
        await expect(ov.locator('.research-overview__head--window .live-dot')).toHaveClass(/live-dot--off/);
        await expect(ov.locator('.research-overview__summary')).toContainText('The research is not running');
        // The tile has no Turn on of its own: the frame under the tiles says it.
        await expect(ov.locator('.research-overview__summary .research-overview__turn-on')).toHaveCount(0);
        const frame = ov.locator('.research-overview__off-frame');
        await expect(frame.locator('.research-overview__off-text')).toHaveText('The research is not running · showing what is in the tree');
        const turnOn = frame.getByRole('button', { name: 'Turn on' });
        await expect(turnOn).toBeVisible();
        // The bridge without a terminal: no mark.
        await expect(frame.locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        // Awaiting action as said last, its answers greyed (readable, not done).
        await expect(ov.locator('#ov-sec-waiting')).toContainText('Confirm the baptism of Jan Fíšek');
        await expect(ov.locator('.research-overview__as-of').first()).toContainText('as of');
        const row = ov.locator('.research-overview__waiting-item[data-id="T0001"] .research-overview__waiting-row');
        if (await row.count() > 0 && await row.getAttribute('aria-expanded') === 'false') await row.click();
        const greyed = ov.locator('#ov-sec-waiting [data-greyed]');
        await expect.poll(() => greyed.count()).toBeGreaterThan(0);
        for (const g of await greyed.all()) await expect(g).toHaveAttribute('aria-disabled', 'true');

        // Turn on: done by the main window for its tree.
        await spyPosted(popup);
        await turnOn.click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __turnOn: unknown[] }).__turnOn.length)).toBe(1);
        expect((await posted(popup)).map(m => m.action)).toEqual(['turn-on']);
        await popup.close();
    });

    test('state 4: the main window on a tree without research: the window says so; back on the research\'s tree, the overview again', async ({ page }) => {
        await openResearch(page, { ged: researchGed() });
        await fakeBridge(page, { accepts: ACCEPTS, links: ['send', 'open', 'live', 'app', 'setup', 'chat'], waiting: WAITING });
        await poll(page);
        const researchTree = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
        const popup = await openFromMenu(page);
        const plain = await page.evaluate(async () => {
            const dm = window.Strom.DataManager;
            await dm.importAsNewTree({ persons: {
                q1: { id: 'q1', firstName: 'Kvido', lastName: 'Pastiňák', gender: 'male', partnerships: [], parentIds: [], childIds: [] },
            }, partnerships: {} } as never, 'Pastiňákovi');
            return dm.getCurrentTreeId() as string;
        });
        await page.evaluate((id) => window.Strom.UI.switchToTree(id as never), plain);
        const state = popup.locator('#overview-window-state');
        await expect(state.locator('.sat-empty')).toBeVisible();
        await expect(state.getByRole('heading', { name: 'This tree has no research' })).toBeVisible();
        await expect(state.locator('.sat-empty-note')).toHaveText('The main window switched to Pastiňákovi, which has no research.');
        await expect(state.getByRole('button', { name: 'Close window' })).toBeVisible();
        await expect(state.locator('.research-overview__title')).toHaveText('Pastiňákovi · Research overview');
        await expect(popup.locator('#research-overview')).toHaveCount(0);

        // Back: the overview draws itself again.
        await page.evaluate((id) => window.Strom.UI.switchToTree(id as never), researchTree);
        await expect(popup.locator('#research-overview')).toBeVisible();
        await expect(popup.locator('#research-overview #ov-sec-waiting')).toContainText('Confirm the baptism of Jan Fíšek');
        await expect(state).toHaveCount(0);
        await popup.close();
    });

    test('the tree deleted in the main window: "The tree no longer exists" with Close window, the next tree\'s overview not drawn', async ({ page }) => {
        await openResearch(page, { ged: researchGed() });
        await fakeBridge(page, { accepts: ACCEPTS, links: ['send', 'open', 'live', 'app', 'setup', 'chat'], waiting: WAITING });
        await poll(page);
        const researchTree = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
        // Another tree the main window goes to after the deletion.
        const other = await page.evaluate(async () => {
            const dm = window.Strom.DataManager;
            await dm.importAsNewTree({ persons: {
                q1: { id: 'q1', firstName: 'Kvido', lastName: 'Pastiňák', gender: 'male', partnerships: [], parentIds: [], childIds: [] },
            }, partnerships: {} } as never, 'Pastiňákovi');
            return dm.getCurrentTreeId() as string;
        });
        await page.evaluate((id) => window.Strom.UI.switchToTree(id as never), researchTree);
        const popup = await openFromMenu(page);
        await expect(popup.locator('#research-overview #ov-sec-waiting')).toContainText('Confirm the baptism of Jan Fíšek');

        await page.evaluate(async ({ id, next }) => {
            const { TreeManager, DataManager } = window.Strom;
            await TreeManager.deleteTree(id as never);
            await DataManager.switchTree(next as never);
        }, { id: researchTree, next: other });
        const state = popup.locator('#overview-window-state');
        await expect(state.getByRole('heading', { name: 'The tree no longer exists' })).toBeVisible();
        await expect(state.locator('.sat-empty-note')).toHaveText('It was deleted in the main window.');
        // The head without the tree; nothing of the overview, nor the next tree's "no research".
        await expect(state.locator('.research-overview__title')).toHaveText('Research overview');
        await expect(popup.locator('#research-overview')).toHaveCount(0);
        await expect(popup.getByText('This tree has no research')).toHaveCount(0);
        await expect(popup.getByText('Confirm the baptism of Jan Fíšek')).toHaveCount(0);
        const closed = popup.waitForEvent('close');
        await state.getByRole('button', { name: 'Close window' }).click();
        await closed;
    });

    test('the tree locked in the main window: "The tree is locked" with Go to the main window, nothing of the research kept; unlocked, the overview again', async ({ page }) => {
        const PASSWORD = 'linden-tree-42';
        await openResearch(page, { ged: researchGed() });
        await fakeBridge(page, { accepts: ACCEPTS, links: ['send', 'open', 'live', 'app', 'setup', 'chat'], waiting: WAITING });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#settings-modal');
        await settings.locator('#encryption-toggle').check();
        const setup = page.locator('#password-setup-modal');
        await setup.locator('#password-setup-input').fill(PASSWORD);
        await setup.locator('#password-setup-confirm').fill(PASSWORD);
        await setup.getByRole('button', { name: 'Save' }).click();
        await expect(settings.locator('#encryption-status')).toHaveText('Encryption enabled');
        await page.evaluate(() => window.Strom.TreeManager.flush());
        await page.keyboard.press('Escape');
        const popup = await openFromMenu(page);
        const ov = popup.locator('#research-overview');
        await expect(ov.locator('#ov-sec-waiting')).toContainText('Confirm the baptism of Jan Fíšek');

        // The main window reloads and the password is not entered.
        await page.reload();
        const prompt = page.locator('#password-prompt-modal');
        await expect(prompt).toBeVisible();
        await prompt.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.locator('#locked-data-notice')).toBeVisible();

        const state = popup.locator('#overview-window-state');
        await expect(state.getByRole('heading', { name: 'The tree is locked' })).toBeVisible();
        await expect(state.locator('.sat-empty-note')).toHaveText('The password is entered in the main window.');
        await expect(state.getByRole('button', { name: 'Go to the main window' })).toBeVisible();
        await expect(ov).toHaveCount(0);
        await expect(popup.getByText('Confirm the baptism of Jan Fíšek')).toHaveCount(0);
        await expect(popup.locator('.research-overview__strip')).toHaveCount(0);
        // It stays so (the main window's locked state does not draw the research back).
        await popup.waitForTimeout(1500);
        await expect(ov).toHaveCount(0);

        // Unlocked: the overview of the research again.
        await page.locator('#locked-data-notice').getByRole('button', { name: 'Unlock' }).click();
        await prompt.locator('#password-prompt-input').fill(PASSWORD);
        await prompt.locator('#password-prompt-input').press('Enter');
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(ov).toBeVisible();
        await expect(state).toHaveCount(0);
        await popup.close();
    });

    test('state 5: the main window closed: the strip, the last state frozen as of then, every action greyed and nothing sent; Open Strom: live again', async ({ page }) => {
        await follow(page);
        const popup = await openFromMenu(page);
        const ov = popup.locator('#research-overview');
        await expect(ov.locator('.research-overview__stop')).toBeEnabled();
        await expect(ov.locator('.research-overview__strip')).toHaveCount(0);
        await spyPosted(popup);

        await page.close();
        const strip = ov.locator('.research-overview__strip');
        await expect(strip).toBeVisible({ timeout: 6000 });
        await expect(strip.locator('.sat-strip-text')).toHaveText(/^The main window is closed · as of .+, read-only$/);
        await expect(strip.getByRole('button', { name: 'Make this the main window' })).toBeVisible();
        // What was shown stays, each section as of then; the head's dot off.
        await expect(ov.locator('#ov-sec-waiting')).toContainText('Ověřit datum sňatku v oddací matrice');
        await expect(ov.locator('.live-section__head .research-overview__frozen-at').first()).toHaveText(/^as of /);
        await expect(ov.locator('.research-overview__head--window .live-dot')).toHaveClass(/live-dot--off/);
        // Every action greyed: Stop, ◎, Show in tree.
        await expect(ov.locator('.research-overview__stop')).toBeDisabled();
        await expect(ov.locator('.research-overview__head--window .live-follow-btn')).toBeDisabled();
        await expect(ov.locator('.research-overview__now-row .link-button', { hasText: 'Show in tree' })).toBeDisabled();
        // A fold of this window's own still folds.
        const foldHead = ov.locator('.live-section__head[aria-controls="ov-sec-knows"]');
        if (await foldHead.count() > 0) {
            const was = await foldHead.getAttribute('aria-expanded');
            await foldHead.click();
            await expect(ov.locator('.live-section__head[aria-controls="ov-sec-knows"]')).not.toHaveAttribute('aria-expanded', was ?? '');
        }
        // An action that slips through is not sent.
        await popup.evaluate(async () => {
            const ui = window.Strom.UI as unknown as Record<string, (...a: unknown[]) => unknown>;
            ui.stopLiveFollow();
            ui.overviewShowPerson('P0001');
            await ui.toggleResearchLive('x');
        });
        expect(await posted(popup)).toEqual([]);

        // Open Strom: a main window again; the window is live (the research viewed through its bridge there).
        const [main] = await Promise.all([popup.context().waitForEvent('page'), strip.getByRole('button', { name: 'Open Strom' }).click()]);
        await main.waitForLoadState('domcontentloaded');
        await expect(ov.locator('.research-overview__strip')).toHaveCount(0, { timeout: 10_000 });
        await expect(ov.locator('[data-greyed]')).toHaveCount(0);
        await expect(ov.locator('.research-overview__frozen-at')).toHaveCount(0);
        await popup.close();
        await main.close();
    });

    test('a task\'s place in the queue set from the window is written by the main window', async ({ page }) => {
        const b = await followManaged(page, { caps: { ...CAPS, offLineBranches: true }, features: ['queue.own'] });
        const popup = await openFromMenu(page);
        const ov = popup.locator('#research-overview');
        const queue = ov.locator('.live-queue');
        if (await ov.locator('.live-queue-toggle').count() > 0) await ov.locator('.live-queue-toggle').click();
        await queue.locator('.live-queue-more[data-task="T0101"]').click();
        const menu = popup.locator('#live-task-menu');
        await expect(menu.locator('[data-order]')).toHaveText(['Do nextComes up next', 'To the endAfter everything else in the queue']);
        await menu.locator('[data-order="next"]').click();
        await expect(menu).toHaveCount(0);
        // Written by the main window (its bridge, its toast with Undo); the window shows the place set.
        await expect.poll(() => b.writes.filter(w => w.method === 'POST').map(w => [w.path, w.body])).toEqual([['queue/T0101', { do: 'next' }]]);
        await expect(page.locator('.toast[data-kind="direction"]')).toContainText('Saved');
        await expect(queue.locator('.live-queue-row', { hasText: 'Matriky Smrkov' }).locator('.live-queue-why')).toHaveText('set by hand: next');
        await popup.close();
    });
});
