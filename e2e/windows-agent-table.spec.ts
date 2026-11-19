import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * The Table of another window while it follows the agent (spec 097 §5, O4,
 * K1.2): the agent's row is tinted with a line in its Name cell; when the
 * agent moves on to a person whose row is not all seen, the attached window
 * scrolls it into the middle of the body, the active cell, the selection and
 * the focus staying; a row already seen does not move the Table. A wheel or
 * a press in the rows pauses the window: no scroll then, until Back to the
 * agent. A row the filter hides is not scrolled to: the status line says so
 * once, with Show for now (the row shown for now, spec 103 2b). The main
 * window's Table stays as it is (no tint, no note). Invented data only.
 */

const UUID = '7c3e1a90-2b4d-4e8f-9a61-0d5b7f2c3e48';
const BRIDGE_ORIGIN = 'http://127.0.0.1:5988';
const BRIDGE = `${BRIDGE_ORIGIN}/fedcba9876543210fedcba9876543210`;
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['open', 'chat', 'task', 'live'];

/** Sixty people (born 1800–1859, the Table's order by birth) between the first rows and the last two (Žofie and Zbyněk Žampachovi), so the Table scrolls. */
const FILLER = Array.from({ length: 60 }, (_, i) => {
    const n = String(100 + i).padStart(4, '0');
    return [`0 @P${n}@ INDI`, `1 NAME Klement${String.fromCharCode(65 + (i % 26))}${i} /Kmínek/`, '1 SEX M', '1 BIRT', `2 DATE ${1800 + i}`, `1 REFN P${n}`];
}).flat();

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Kmínkovi',
    '0 @P0001@ INDI', '1 NAME Amálie /Anýzová/', '1 SEX F', '1 BIRT', '2 DATE 1790', '1 REFN P0001',
    '0 @P0002@ INDI', '1 NAME Adolf /Anýz/', '1 SEX M', '1 BIRT', '2 DATE 1788', '1 REFN P0002',
    ...FILLER,
    '0 @P0300@ INDI', '1 NAME Žofie /Žampachová/', '1 SEX F', '1 BIRT', '2 DATE 1901', '1 REFN P0300',
    '0 @P0301@ INDI', '1 NAME Zbyněk /Žampach/', '1 SEX M', '1 BIRT', '2 DATE 1899', '1 REFN P0301',
    '0 TRLR',
].join('\n');

interface Bridge {
    person: string;
    chain: number;
}

const TIMINGS = { gap: 300, idle: 60000, retry: 150 };

async function routeBridge(context: BrowserContext): Promise<Bridge> {
    const bridge: Bridge = { person: 'P0001', chain: 0 };
    const status = () => ({
        tree: { id: UUID, name: 'Kmínkovi' }, head: 'h1', persons: 64,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 60_000).toISOString(), task: 'T0101 Matriky', person: bridge.person }],
        waiting: [], queue: [], links: LINKS,
    });
    await context.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status') || path.endsWith('/events')) bridge.chain++;
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    return bridge;
}

/** The main window follows the research live, ◎ on. */
async function follow(page: Page): Promise<string> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(([links, ms]) => {
        (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = ms;
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        localStorage.setItem('strom-live-follow', '1');
    }, [LINKS, TIMINGS] as const);
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    return page.evaluate(() => window.Strom.DataManager.getCurrentTreeId()!);
}

/** A Table window of the main window's tree, 1000 × 620 (some 12 rows seen). */
async function openTableWindow(context: BrowserContext, treeId: string, reducedMotion = false): Promise<Page> {
    const sat = await context.newPage();
    await sat.setViewportSize({ width: 1000, height: 620 });
    if (reducedMotion) await sat.emulateMedia({ reducedMotion: 'reduce' });
    await sat.addInitScript((ms) => {
        (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = ms;
    }, TIMINGS);
    await sat.goto(`/strom.html?okno=table&tree=${encodeURIComponent(treeId)}&w=at1a2b3c`);
    await expect(sat.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
    await expect(sat.locator('.sat-strip .sat-strip-text')).toHaveText('Following the agent · read-only');
    return sat;
}

async function nextStatus(bridge: Bridge): Promise<void> {
    const n = bridge.chain;
    await expect.poll(() => bridge.chain, { timeout: 10000 }).toBeGreaterThanOrEqual(n + 2);
}

const keyOf = (page: Page, refn: string) => page.evaluate((r) => `p:${Object.values(window.Strom.DataManager.getData().persons).find(p => p.refn === r)!.id}`, refn);
const rowOf = async (page: Page, refn: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${await keyOf(page, refn)}"]`);
const grid = (page: Page) => page.locator('#table-container .tv-grid');
const scrollTop = (page: Page) => grid(page).evaluate(el => el.scrollTop);
const stripText = (page: Page) => page.locator('.sat-strip .sat-strip-text');
const note = (page: Page) => page.locator('#table-container .tv-status-agent');

/**
 * Where a row stands in the body (under the head and its pinned rows):
 * 'all' all seen, 'out' not all seen; its centre's distance from the body's
 * middle in px.
 */
async function rowPlace(page: Page, refn: string): Promise<{ seen: 'all' | 'out'; offMiddle: number }> {
    const key = await keyOf(page, refn);
    return page.evaluate((key) => {
        const g = document.querySelector<HTMLElement>('#table-container .tv-grid')!;
        const head = g.querySelector<HTMLElement>('.tv-head')!;
        const box = g.getBoundingClientRect();
        const top = box.top + head.offsetHeight;
        const bottom = box.top + g.clientHeight;
        const row = g.querySelector<HTMLElement>(`:scope > .tv-body .tv-row[data-key="${key}"]`);
        if (!row) return { seen: 'out' as const, offMiddle: Infinity };
        const r = row.getBoundingClientRect();
        const seen = r.top >= top - 0.5 && r.bottom <= bottom + 0.5 ? 'all' as const : 'out' as const;
        return { seen, offMiddle: Math.abs((r.top + r.bottom) / 2 - (top + bottom) / 2) };
    }, key);
}

/** The agent moves on to `refn` (the main window hears it, then the window's mirror). */
async function agentTo(bridge: Bridge, page: Page, refn: string): Promise<void> {
    bridge.person = refn;
    await nextStatus(bridge);
    await expect.poll(() => page.evaluate(() => {
        const t = window.Strom.UI.liveFollowTarget();
        return t ? window.Strom.DataManager.getPerson(t)?.refn ?? null : null;
    })).toBe(refn);
}

/** Wait until the Table's scroll stands still (a glide is over). */
async function settled(page: Page): Promise<number> {
    let last = -1;
    await expect.poll(async () => {
        const now = await scrollTop(page);
        const still = now === last;
        last = now;
        return still;
    }, { intervals: [120, 120, 120, 200, 300] }).toBe(true);
    return last;
}

test.describe('desktop', () => {
    test('attached: the agent\'s row tinted, scrolled into the middle only when not seen, the selection and the focus stay', async ({ page, context }) => {
        const bridge = await routeBridge(context);
        const treeId = await follow(page);
        const sat = await openTableWindow(context, treeId);

        // The agent at the first rows: the row tinted with the line in its Name cell, the Table at the top.
        const first = await rowOf(sat, 'P0001');
        await expect(first).toHaveClass(/\bis-agent\b/);
        const look = await first.evaluate((row) => {
            const probe = document.createElement('div');
            probe.style.background = 'var(--follow-c1-soft)';
            document.body.appendChild(probe);
            const soft = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return { bg: getComputedStyle(row).backgroundColor, soft, line: getComputedStyle(row.querySelector('.tv-name')!).boxShadow };
        });
        expect(look.bg).toBe(look.soft);
        expect(look.line).toContain('inset');
        expect(await scrollTop(sat)).toBe(0);
        await expect(note(sat)).toBeHidden();

        // A cell focused (without a press: still attached), another row selected by the main window's choice.
        const focusCell = (await rowOf(sat, 'P0002')).locator('[aria-colindex="1"]');
        await focusCell.evaluate(el => (el as HTMLElement).focus());
        await expect(focusCell).toBeFocused();
        const selectedBefore = await sat.locator('#table-container .tv-body .tv-row[aria-selected="true"]').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.key));

        // The agent moves on to a row far below: the window glides there, the row in the middle of the body.
        await agentTo(bridge, sat, 'P0140');
        await expect.poll(async () => (await rowPlace(sat, 'P0140')).seen).toBe('all');
        await settled(sat);
        const rowH = await (await rowOf(sat, 'P0140')).evaluate(el => el.getBoundingClientRect().height);
        expect((await rowPlace(sat, 'P0140')).offMiddle).toBeLessThanOrEqual(rowH);
        await expect(await rowOf(sat, 'P0140')).toHaveClass(/\bis-agent\b/);
        await expect(sat.locator('#table-container .tv-body .tv-row.is-agent')).toHaveCount(1);
        // The focused row stays drawn out of view (its cell keeps the focus).
        await expect(await rowOf(sat, 'P0002')).toHaveClass(/\bis-kept\b/);
        // Neither the focus nor the selection moved; the window is still attached.
        await expect(focusCell).toBeFocused();
        expect(await sat.locator('#table-container .tv-body .tv-row[aria-selected="true"]').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.key))).toEqual(selectedBefore);
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        expect(await sat.evaluate(() => window.scrollY)).toBe(0);

        // The next person's row is seen already: the Table does not move.
        const at = await scrollTop(sat);
        await agentTo(bridge, sat, 'P0141');
        await expect(await rowOf(sat, 'P0141')).toHaveClass(/\bis-agent\b/);
        await sat.waitForTimeout(400);
        expect(await scrollTop(sat)).toBe(at);

        // The main window's Table stays as it is: no tint, no note.
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table'));
        await expect(page.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
        await expect(page.locator('#table-container .tv-body .tv-row.is-agent')).toHaveCount(0);
        await expect(note(page)).toBeHidden();
        await sat.close();
    });

    test('a wheel over the rows pauses the window: no scroll after the agent; Back to the agent scrolls to its row', async ({ page, context }) => {
        const bridge = await routeBridge(context);
        const treeId = await follow(page);
        const sat = await openTableWindow(context, treeId);
        await expect(await rowOf(sat, 'P0001')).toHaveClass(/\bis-agent\b/);

        // The wheel over the rows: paused here (the Table's own scroll is the user's).
        const box = (await grid(sat).boundingBox())!;
        await sat.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await sat.mouse.wheel(0, 120);
        await expect(stripText(sat)).toHaveText('Following paused · read-only');
        const at = await settled(sat);

        // The agent moves on to the last rows: the paused window stays where it is.
        await agentTo(bridge, sat, 'P0300');
        await sat.waitForTimeout(400);
        expect(await scrollTop(sat)).toBe(at);
        expect((await rowPlace(sat, 'P0300')).seen).toBe('out');

        // Back to the agent: the row in the middle.
        await sat.locator('.sat-strip').getByRole('button', { name: 'Back to the agent' }).click();
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        await expect.poll(async () => (await rowPlace(sat, 'P0300')).seen).toBe('all');

        // A key that moves in the rows pauses too (a focus alone does not).
        const back = sat.locator('.sat-strip').getByRole('button', { name: 'Back to the agent' });
        const cell = (await rowOf(sat, 'P0300')).locator('[aria-colindex="2"]');
        await cell.evaluate(el => (el as HTMLElement).focus());
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        await sat.keyboard.press('PageUp');
        await expect(stripText(sat)).toHaveText('Following paused · read-only');

        // A press in a cell pauses too; a press in the bar above the rows does not.
        await back.click();
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        await sat.locator('#table-container .tv-search-q').click();
        await sat.waitForTimeout(200);
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        await expect.poll(async () => (await rowPlace(sat, 'P0300')).seen).toBe('all');
        await (await rowOf(sat, 'P0300')).locator('[aria-colindex="2"]').click();
        await expect(stripText(sat)).toHaveText('Following paused · read-only');
        await sat.close();
    });

    test('the agent\'s row hidden by the filter: not scrolled to, the note once with Show for now (the row shown for now)', async ({ page, context }) => {
        const bridge = await routeBridge(context);
        const treeId = await follow(page);
        const sat = await openTableWindow(context, treeId, true);
        await expect(await rowOf(sat, 'P0001')).toHaveClass(/\bis-agent\b/);
        // The agent on a Kmínek seen near the top (no scroll), so the search below keeps the agent's row.
        await agentTo(bridge, sat, 'P0100');
        await expect(await rowOf(sat, 'P0100')).toHaveClass(/\bis-agent\b/);

        // The search keeps the Kmíneks only (the window's own filter: no pause).
        await sat.locator('#table-container .tv-search-q').fill('Kmínek');
        // The search lands after its delay: wait for it (the match count, the first rows gone) before the agent
        // moves on, else the agent's row is still in the rows and scrolled to before the filter hides it.
        await expect(sat.locator('#table-container .tv-matches')).toHaveText('60 matches');
        await expect(await rowOf(sat, 'P0001')).toHaveCount(0);
        await expect(await rowOf(sat, 'P0100')).toHaveClass(/\bis-agent\b/);
        await expect(note(sat)).toBeHidden();
        const at = await settled(sat);

        // The agent on a person the filter hides: no scroll, the note in the status line.
        await agentTo(bridge, sat, 'P0300');
        await expect(note(sat)).toBeVisible();
        await expect(note(sat).locator('.tv-status-agent-text')).toHaveText('The agent’s row is hidden by the filter');
        await expect(note(sat).locator('.tv-status-agent-text')).toHaveAttribute('aria-live', 'polite');
        expect(await scrollTop(sat)).toBe(at);
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        expect(await sat.locator('#table-container .tv-status').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        // The note's sentence whole: the research's state and the read-only sentence (the strip says both) give way.
        const noteCut = () => note(sat).locator('.tv-status-agent-text').evaluate(el => el.scrollWidth - el.clientWidth);
        expect(await noteCut()).toBeLessThanOrEqual(0);
        await expect(sat.locator('#table-container .tv-status-ro')).toBeHidden();
        await expect(sat.locator('#table-container .tv-status-res')).toBeHidden();
        // A narrow window (390): the note takes the sort's place, the count's and the legend's, Show for now still within the line.
        await sat.setViewportSize({ width: 390, height: 700 });
        await expect(sat.locator('#table-container .tv-status-sort')).toBeHidden();
        await expect(note(sat).getByRole('button', { name: 'Show for now' })).toBeVisible();
        const right = await note(sat).getByRole('button', { name: 'Show for now' }).evaluate(el => el.getBoundingClientRect().right);
        expect(right).toBeLessThanOrEqual(390);
        expect(await noteCut()).toBeLessThanOrEqual(0);
        await sat.setViewportSize({ width: 1000, height: 620 });

        // Show for now: the row shown for now outside the filter, scrolled to; the note goes.
        await note(sat).getByRole('button', { name: 'Show for now' }).click();
        const temp = await rowOf(sat, 'P0300');
        await expect(temp).toHaveClass(/\bis-temp\b/);
        await expect(temp).toHaveClass(/\bis-agent\b/);
        await expect.poll(async () => (await rowPlace(sat, 'P0300')).seen).toBe('all');
        await expect(note(sat)).toBeHidden();
        // The note gone: the read-only sentence is back.
        await expect(sat.locator('#table-container .tv-status-ro')).toBeVisible();
        await sat.close();
    });
});
