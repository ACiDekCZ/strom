import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, card } from './helpers.js';

/**
 * The research in the Table view, live, exported, on a phone and read-only
 * (spec 073 §16.6, §16.7): a change of the research's signals redraws only
 * the cells it touches (no light, the rows keep their order and places, an
 * untouched row stays as it was drawn); a change of the data lights its row
 * and says so with Show, the row staying in place; the agent's bar on the
 * name runs in the arc's rhythm and stands still under reduced motion, ✓
 * once the agent is done; the CSV writes the research's words and counts,
 * the live-only columns empty while not following (and a toast says so); a
 * read-only copy has only the columns from the data; on a phone of 390 px
 * Research and Line come right after the name. Invented data
 * (e2e/fixtures/research-table.ged).
 */

const GED = readFileSync('e2e/fixtures/research-table.ged', 'utf8');
const UUID = '7d3f2a10-5c4b-4e8a-9b61-1f0e2d3c4b5a';
const BRIDGE = 'http://127.0.0.1:5981/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const NOW = new Date('2026-11-10T12:00:00Z');

interface Bridge {
    /** Whom the agent works on (REFN). */
    person: string;
    head: string;
    ged: string;
    /** The asks of the reconnect chain so far (/events, /status). */
    chain: number;
}

/** Follow the research's bridge; the app asks again every 250 ms, so a change of the bridge comes soon. */
async function follow(page: Page, size = { width: 1440, height: 900 }): Promise<Bridge> {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize(size);
    await page.addInitScript((links) => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    const bridge: Bridge = { person: 'P0003', head: 'h1', ged: GED, chain: 0 };
    const status = () => ({
        tree: { id: UUID, name: 'Výzkum Pivoňkovských' }, head: bridge.head, persons: 13,
        working: [{ who: 'agent-matriky', since: new Date(NOW.getTime() - 60_000).toISOString(), task: 'Hledat křest Josefa', person: bridge.person }],
        waiting: [], queue: [{ id: 'T0001', state: 'next', person: 'P0004', text: 'Úmrtí Rozálie' }], links: LINKS,
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status') || path.endsWith('/events')) bridge.chain++;
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: bridge.ged });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeAttached();
    await expect(card(page, 'Karel')).toBeVisible();
    return bridge;
}

async function dropGed(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'tree-strom.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

/** The research tree, not followed. */
async function openResearchTree(page: Page): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    await dropGed(page, GED);
    await expect(card(page, 'Karel')).toBeVisible();
}

async function openTable(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table'));
    await expect(page.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
}

async function openView(page: Page, id: string): Promise<void> {
    await page.evaluate((id) => window.Strom.UI.openTableView(id), id);
}

const rowKeyOf = (page: Page, refn: string) => page.evaluate((r) => `p:${Object.values(window.Strom.DataManager.getData().persons).find(p => p.refn === r)!.id}`, refn);
const rowAt = async (page: Page, refn: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${await rowKeyOf(page, refn)}"]`);
const nameOf = async (page: Page, refn: string) => (await rowAt(page, refn)).locator('.tv-name');

async function headOrder(page: Page): Promise<string[]> {
    return page.locator('#table-container .tv-headrow .tv-headcell').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
}

/** The body's rows: their keys and tops, in the order drawn. */
async function layout(page: Page): Promise<{ key: string; top: number }[]> {
    return page.locator('#table-container .tv-body .tv-row').evaluateAll(els => els.map(el => ({
        key: (el as HTMLElement).dataset.key ?? '', top: Math.round(el.getBoundingClientRect().top),
    })));
}

function csvOf(path: string): string[][] {
    const text = readFileSync(path, 'utf-8');
    return text.slice(1).split('\r\n').filter(Boolean).map(l => l.split(';'));
}

async function downloadCsv(page: Page): Promise<string[][]> {
    await page.locator('#table-container .tv-export-btn').click();
    const panel = page.locator('.tv-fpanel.tv-xpanel');
    await panel.locator('.tv-xfmt [data-fmt="csv"], .tv-xopt-pick', { hasText: 'CSV' }).first().click().catch(() => {});
    const [file] = await Promise.all([
        page.waitForEvent('download'),
        panel.locator('.tv-fpanel-apply', { hasText: 'Download CSV' }).click(),
    ]);
    return csvOf((await file.path())!);
}

test.describe('live (§16.6, 16s–16u)', () => {
    test('a change of the signals: only its cells, no light, no jump; a change of the data: lit, Show, in place', async ({ page }) => {
        const bridge = await follow(page);
        await openTable(page);
        await openView(page, 'r:research');
        await expect.poll(async () => (await headOrder(page)).slice(0, 2)).toEqual(['name', 'rSum']);
        const josef = await nameOf(page, 'P0003');
        await expect(josef.locator('.tv-agent-bar')).toHaveCount(1);
        const before = await layout(page);
        expect(before.length).toBeGreaterThan(2);
        // An untouched row (Marie: a conflict) keeps the very element drawn.
        const marie = await rowAt(page, 'P0006');
        await marie.evaluate(el => { (el as HTMLElement & { __kept?: boolean }).__kept = true; });

        // Signals: the agent leaves Josef (✓) for Matěj (the bar).
        bridge.person = 'P0005';
        await expect(josef.locator('.tv-rmark--done')).toHaveText('✓', { timeout: 10_000 });
        await expect(josef.locator('.tv-agent-bar')).toHaveCount(0);
        await expect(await nameOf(page, 'P0005')).toHaveCount(1);
        await expect((await nameOf(page, 'P0005')).locator('.tv-agent-bar')).toHaveCount(1);
        // The rows drawn before keep their order and places; Matěj, passing now, comes after them (§10.3).
        const after = await layout(page);
        expect(after.slice(0, before.length)).toEqual(before);
        expect(after.slice(before.length).map(r => r.key)).toEqual([await rowKeyOf(page, 'P0005')]);
        await expect(page.locator('#table-container .tv-row.is-flash')).toHaveCount(0);
        expect(await marie.evaluate(el => !!(el as HTMLElement & { __kept?: boolean }).__kept)).toBe(true);

        // Data: Marie's conflict decided and her birth changed; her row lit, a toast with Show, she stays in place.
        bridge.ged = GED.replace('2 TITL Rok narození Marie\n2 STAT open\n2 _STROM_TAKE Y', '2 TITL Rok narození Marie\n2 STAT decided')
            .replace('1 REFN P0006\n1 BIRT\n2 DATE 1853', '1 REFN P0006\n1 BIRT\n2 DATE 1854');
        bridge.head = 'h2';
        const marieAgain = await rowAt(page, 'P0006');
        await expect(marieAgain).toHaveClass(/\bis-flash\b/, { timeout: 10_000 });
        await expect(page.locator('.toast')).toContainText('Marie Pivoňkovská');
        await expect(page.locator('.toast .toast-action')).toHaveText('Show');
        expect((await layout(page)).map(r => r.key)).toEqual(after.map(r => r.key));
        // Rows not lit by the data stay unlit.
        await expect(page.locator('#table-container .tv-row.is-flash')).toHaveCount(1);
    });

    test('the agent\'s bar: 3 px on the name\'s left edge, running; still under reduced motion', async ({ page }) => {
        await follow(page);
        // The suite runs under reduced motion; the bar's run is seen without it first.
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await openTable(page);
        await openView(page, 'r:research');
        const bar = (await nameOf(page, 'P0003')).locator('.tv-agent-bar');
        await expect(bar).toBeVisible();
        const box = await bar.boundingBox();
        const cell = await (await nameOf(page, 'P0003')).boundingBox();
        expect(box!.width).toBeCloseTo(3, 0);
        expect(box!.x - cell!.x).toBeLessThanOrEqual(3);
        const run = bar.locator('.tv-agent-run');
        expect(await run.evaluate(el => getComputedStyle(el).animationName)).toBe('tvAgentRun');
        expect(await run.evaluate(el => getComputedStyle(el).animationDuration)).toBe('1.4s');
        expect(await run.evaluate(el => el.style.animationDelay)).toMatch(/ms$/);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await run.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
        // The segment stands at the top of the track.
        const still = await run.boundingBox();
        expect(Math.abs(still!.y - box!.y)).toBeLessThanOrEqual(1);
    });

    test('while following, the live card stands below the table\'s bar: Export takes a click; back in the Family view at the top (1110)', async ({ page }) => {
        await follow(page);
        const panel = page.locator('#live-panel');
        const atTop = (await panel.boundingBox())!.y;
        await openTable(page);
        const bar = page.locator('#table-container > .tv-bar');
        await expect.poll(async () => (await panel.boundingBox())!.y).toBeGreaterThanOrEqual((await bar.boundingBox())!.y + (await bar.boundingBox())!.height);
        const hit = await page.locator('#table-container .tv-export-btn').evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        });
        expect(hit).toBe(true);
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('family'));
        await expect.poll(async () => (await panel.boundingBox())!.y).toBe(atTop);
    });

    test('CSV while following: the agent and the tasks written as words and counts, no toast about them', async ({ page }) => {
        await follow(page);
        await openTable(page);
        await openView(page, 'r:research');
        const lines = await downloadCsv(page);
        const head = lines[0];
        const at = (col: string) => head.indexOf(col);
        const josef = lines.find(l => l[0] === 'Josef Pivoňkovský')!;
        expect(josef[at('Agent')]).toBe('working: Hledat křest Josefa');
        expect(josef[at('Research tasks')]).toBe('1: running now');
        const rozalie = lines.find(l => l[0] === 'Rozálie Hřebíčková')!;
        expect(rozalie[at('Research')]).toBe('queued');
        expect(rozalie[at('Research tasks')]).toBe('1: next no. 1 in the queue');
        const marie = lines.find(l => l[0] === 'Marie Pivoňkovská')!;
        expect(marie[at('Research')]).toBe('conflict (1)');
        expect(marie[at('Conflicts')]).toBe('1: birth');
        for (const l of lines.slice(1)) for (const f of l) expect(f).not.toMatch(/[≠✓]/u);
        await expect(page.locator('.toast').last()).not.toContainText('not being followed');
    });
});

test.describe('export, read-only (§16.7, 16za, 16w)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('not following: Agent and Research tasks empty, the toast says so', async ({ page }) => {
        await openResearchTree(page);
        await openTable(page);
        await openView(page, 'r:research');
        const lines = await downloadCsv(page);
        const head = lines[0];
        expect(head).toEqual(['Full name', 'Research', 'Awaiting decision', 'Conflicts', 'Hypotheses', 'Agent', 'Research tasks', 'Birth date', 'Death date']);
        for (const l of lines.slice(1)) {
            expect(l[head.indexOf('Agent')]).toBe('');
            expect(l[head.indexOf('Research tasks')]).toBe('');
        }
        const marie = lines.find(l => l[0] === 'Marie Pivoňkovská')!;
        expect(marie[head.indexOf('Conflicts')]).toBe('1: birth');
        expect(marie[head.indexOf('Hypotheses')]).toBe('0');
        const toast = page.locator('.toast').last();
        await expect(toast).toContainText('Agent and Research tasks are empty: the research is not being followed.');
        await expect(toast).toContainText('Downloaded');
    });

    test('read-only: only the columns from the data, in the table and in the CSV', async ({ page }) => {
        await openResearchTree(page);
        await page.evaluate(() => { window.Strom.DataManager.isReadOnly = () => true; });
        await openTable(page);
        await openView(page, 'r:research');
        await expect.poll(() => headOrder(page)).toEqual(['name', 'rSum', 'rConf', 'rHyp', 'bDate', 'dDate']);
        const lines = await downloadCsv(page);
        expect(lines[0]).toEqual(['Full name', 'Research', 'Conflicts', 'Hypotheses', 'Birth date', 'Death date']);
        await expect(page.locator('.toast').last()).not.toContainText('not being followed');
    });
});

test.describe('phone (390): Research and Line right after the name (16x, 16zh)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    /** The column right after the pinned name, on screen without a scroll (whole when `whole`). */
    async function nextToName(page: Page, col: string, whole: boolean): Promise<void> {
        await expect.poll(async () => (await headOrder(page)).slice(0, 2)).toEqual(['name', col]);
        const head = page.locator(`#table-container .tv-headrow [data-col="${col}"]`);
        await expect(head).toBeVisible();
        // The head may be drawn anew between two reads (a box of a replaced cell is null): both boxes read again until they hold.
        await expect.poll(async () => {
            const name = await page.locator('#table-container .tv-headrow [data-col="name"]').boundingBox();
            const box = await head.boundingBox();
            if (!name || !box) return 'not drawn';
            if (Math.abs(box.x - (name.x + name.width)) > 1) return `gap ${box.x - (name.x + name.width)}`;
            if (box.x + (whole ? box.width : 60) > 390) return `past the edge ${box.x + (whole ? box.width : 60)}`;
            return 'next to the name';
        }).toBe('next to the name');
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over).toBeLessThanOrEqual(0);
    }

    test('not following, the Research view: its head keeps its name, the status line keeps the legend on the screen (1110)', async ({ page }) => {
        await openResearchTree(page);
        await openTable(page);
        await openView(page, 'r:research');
        await nextToName(page, 'rSum', true);
        const label = page.locator('#table-container .tv-headrow [data-col="rSum"] .tv-cell-text');
        expect(await label.evaluate(el => el.clientWidth > 0 && el.scrollWidth <= el.clientWidth)).toBe(true);
        // "Research: as of …" gives way with "…" before the legend leaves the line.
        await expect(page.locator('#table-container .tv-status-res')).toBeVisible();
        const legend = await page.locator('#table-container .tv-legend-btn').boundingBox();
        expect(legend!.x + legend!.width).toBeLessThanOrEqual(390);
        expect(await page.locator('#table-container .tv-status').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    });

    test('the Research view and a Line view while following, the agent\'s bar on the name', async ({ page }) => {
        await follow(page, { width: 390, height: 844 });
        await openTable(page);
        await openView(page, 'r:research');
        await nextToName(page, 'rSum', true);
        await expect((await nameOf(page, 'P0003')).locator('.tv-agent-bar')).toBeVisible();
        // Followed here: the status line says so.
        await expect(page.locator('#table-container .tv-status-res')).toHaveText('● Following the research live');
        await openView(page, 'r:line:G0001');
        await nextToName(page, 'rLine', true);
    });
});
