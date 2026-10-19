import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';

/**
 * Working lines in the live panel (spec 011): with two or more directions at
 * work "At work" has a row per direction (glyph, name, task, person · since),
 * a click selects one (pressed, its people lit up in the tree, Latest changes
 * and Up next narrowed to it, Awaiting action never), "All directions" or a
 * second click drops it, the overview's queue filter is the same choice, a
 * selected line that stops stays last, and one line keeps the panel as it
 * was. Invented data only.
 */

const UUID = '7c1e4b20-9a3d-4f61-8e2b-5d0a6c9f1b34';
const BRIDGE = 'http://127.0.0.1:5996/fedcba9876543210fedcba9876543210';
const cors = { 'access-control-allow-origin': '*' };
const ALL = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research',
    'new', 'update', 'sessions', 'conflict', 'story', 'sync-undo', 'setup', 'live', 'direction', 'finish'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Novákovi',
    '0 @P0001@ INDI', '1 NAME Josef /Novák/', '1 SEX M', '1 BIRT', '2 DATE 1842', '1 REFN P0001', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Anna /Horáková/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0012@ INDI', '1 NAME Jan /Novák/', '1 SEX M', '1 BIRT', '2 DATE 1870', '1 REFN P0012', '1 FAMC @F0001@', '1 FAMS @F0002@',
    '0 @P0013@ INDI', '1 NAME Marie /Nováková/', '1 SEX F', '1 BIRT', '2 DATE 1875', '1 REFN P0013', '1 FAMS @F0002@',
    '0 @P0020@ INDI', '1 NAME Karel /Novák/', '1 SEX M', '1 BIRT', '2 DATE 1903', '1 REFN P0020', '1 FAMC @F0002@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@',
    '0 @F0002@ FAM', '1 HUSB @P0012@', '1 WIFE @P0013@', '1 CHIL @P0020@',
    '0 TRLR',
].join('\n');

const ago = (min: number): string => new Date(Date.now() - min * 60_000).toISOString();

const UP = { id: 'G0001', name: 'Předci Jana Nováka', state: 'active', direction: 'ancestors', focus: 'P0012', tasks: 2, waiting: 1, working: true, since: ago(600) };
const DOWN = { id: 'G0002', name: 'Potomci Marie Novákové', state: 'active', direction: 'descendants', focus: 'P0013', tasks: 1, waiting: 1, working: true, since: ago(300) };
const AGENT_UP = { who: 'agent-matriky', since: ago(9), task: 'Křest Josefa Nováka 1842', person: 'P0001', research: 'G0001', session: 'N0132' };
const AGENT_DOWN = { who: 'agent-zapis', since: ago(3), task: 'Sňatek 1903', person: 'P0013', research: 'G0002', session: 'N0133' };

interface Bridge {
    working: Record<string, unknown>[];
    researches: Record<string, unknown>[];
}

async function follow(page: Page, working: Record<string, unknown>[] = [AGENT_UP, AGENT_DOWN],
    size = { width: 1440, height: 900 }): Promise<Bridge> {
    await page.setViewportSize(size);
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, ALL);
    // An event stream that stays open: hello with the status once, then only what the test sends.
    await page.addInitScript(() => {
        class FakeEventSource {
            url: string;
            readyState = 1;
            onerror: ((e: Event) => void) | null = null;
            private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
            constructor(url: string) {
                this.url = url;
                (window as unknown as { __es: FakeEventSource }).__es = this;
                void fetch(url.replace(/\/events(\?.*)?$/, '/status')).then(r => r.json()).then(st => this.emit('hello', st));
            }
            addEventListener(type: string, fn: (e: MessageEvent) => void): void { (this.listeners[type] ??= []).push(fn); }
            removeEventListener(): void { /* not needed */ }
            close(): void { this.readyState = 2; }
            emit(type: string, data: unknown): void {
                for (const fn of this.listeners[type] ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
            }
        }
        Object.defineProperty(window, 'EventSource', { value: FakeEventSource, configurable: true, writable: true });
    });
    const bridge: Bridge = { working, researches: [UP, DOWN] };
    const status = () => ({
        tree: { id: UUID, name: 'Novákovi z Kolína' }, head: 'h3', persons: 5,
        working: bridge.working,
        waiting: [
            { id: 'T0004', what: 'Potvrďte otce Josefa', person: 'P0001', research: 'G0001', at: ago(5) },
            { id: 'T0005', what: 'Oddací list 1903', person: 'P0013', research: 'G0002', at: ago(6) },
        ],
        queue: [
            { id: 'T0101', text: 'Matriky Kolín', state: 'next', research: 'G0001' },
            { id: 'T0102', text: 'Pozemková kniha', state: 'next', research: 'G0001' },
            { id: 'T0103', text: 'Děti Karla', state: 'next', research: 'G0002' },
        ],
        links: ALL,
        researches: bridge.researches,
    });
    const log = { entries: [
        { head: 'h3', at: ago(2), what: ['P0001 +BIRT'], text: ['Zapsáno: křest Josefa Nováka, Kolín 1842 [P0001]'], task: 'Křest Josefa Nováka 1842', research: 'G0001' },
        { head: 'h2', at: ago(4), what: ['+S0040 Oddací matrika'], text: ['Hledáno: oddací matrika Kolín 1900–1905'], task: 'Sňatek 1903', research: 'G0002' },
        { head: 'h1', at: ago(9), what: ['N0132 opened'], text: ['Agent začal: Křest Josefa Nováka 1842'], task: 'Křest Josefa Nováka 1842', research: 'G0001' },
    ] };
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (path.endsWith('/status')) return json(status());
        if (path.endsWith('/log')) return json(log);
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    await expect(page.locator('#live-panel .live-changes li')).toHaveCount(3);
    await unfold(page);
    return bridge;
}

const panel = (page: Page) => page.locator('#live-panel');
const line = (page: Page, id: string) => panel(page).locator(`.live-line[data-direction="${id}"]`);
const sectionTitle = (page: Page, controls: string) => panel(page).locator(`[aria-controls="${controls}"] .live-section__title`);
const sectionSum = (page: Page, controls: string) => panel(page).locator(`[aria-controls="${controls}"] .live-section__sum`);

/** Unfold the panel's sections (a tall panel folds Up next, Changes and At work by itself; a choice stays). */
async function unfold(page: Page, keys: string[] = ['working', 'changes', 'queue']): Promise<void> {
    for (const key of keys) {
        const head = panel(page).locator(`[aria-controls="live-sec-${key}"]`);
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        await expect(head).toHaveAttribute('aria-expanded', 'true');
    }
}

/** The agent on G0001 is done: the bridge says who works now (the stream stays open). */
async function stopUp(page: Page, bridge: Bridge): Promise<void> {
    bridge.working = [AGENT_DOWN];
    bridge.researches = [{ ...UP, working: false }, DOWN];
    await page.evaluate((w) => {
        (window as unknown as { __es: { emit(t: string, d: unknown): void } }).__es.emit('working', w);
    }, [AGENT_DOWN]);
}

test.describe('working lines in the live panel', () => {
    test('two lines: a row each with glyph, name, task and person · since; changes and tasks name their line', async ({ page }) => {
        await follow(page);
        await expect(sectionTitle(page, 'live-sec-working')).toHaveText('At work · 2 directions');
        await expect(panel(page).locator('.live-line')).toHaveCount(2);
        await expect(panel(page).locator('.live-line__name')).toHaveText(['Předci Jana Nováka', 'Potomci Marie Novákové']);
        await expect(line(page, 'G0001').locator('.live-line__glyph')).toHaveText('↑');
        await expect(line(page, 'G0002').locator('.live-line__glyph')).toHaveText('↓');
        await expect(line(page, 'G0001').locator('.live-line__task')).toHaveText('Křest Josefa Nováka 1842');
        await expect(line(page, 'G0001').locator('.live-line__meta')).toHaveText(/^Josef Novák · since \d{1,2}:\d{2}( [AP]M)? · 9 min$/);
        // The agent is in the row's tooltip; none is selected.
        await expect(line(page, 'G0001')).toHaveAttribute('title', 'agent-matriky');
        await expect(line(page, 'G0001')).toHaveAttribute('aria-pressed', 'false');
        await expect(line(page, 'G0001').locator('.live-line__sr')).toHaveText(/^Direction Předci Jana Nováka\. Selecting/);
        // The old list is not drawn beside it.
        await expect(panel(page).locator('.live-working')).toHaveCount(0);
        // Changes: their line before the time.
        await expect(panel(page).locator('.live-changes .live-change-dir')).toHaveText(['↑', '↓', '↑']);
        // Up next: the line first.
        await expect(panel(page).locator('.live-queue-row .live-queue-text').first()).toHaveText('↑ Matriky Kolín');
    });

    test('a line selected: pressed, its people lit up, changes and tasks narrowed, Awaiting action not; All directions drops it', async ({ page }) => {
        await follow(page);
        await expect(panel(page).locator('.live-waiting-row')).toHaveCount(2);
        await line(page, 'G0001').click();
        await expect(line(page, 'G0001')).toHaveAttribute('aria-pressed', 'true');
        await expect(line(page, 'G0002')).toHaveAttribute('aria-pressed', 'false');
        // The tree: the ancestors of Jan lit up (Jan, Josef, Anna), the rest dimmed.
        await expect(page.locator('#evidence-pill')).toContainText('Předci Jana Nováka');
        await expect(card(page, 'Josef')).toHaveClass(/evidence-hit/);
        await expect(card(page, 'Karel')).toHaveClass(/evidence-dim/);
        // Latest changes: only the line's, without glyphs.
        await expect(sectionSum(page, 'live-sec-changes')).toHaveText('only ↑ Předci Jana Nováka');
        await expect(panel(page).locator('.live-changes li')).toHaveCount(2);
        await expect(panel(page).locator('.live-changes')).not.toContainText('oddací matrika');
        await expect(panel(page).locator('.live-change-dir')).toHaveCount(0);
        // Up next: 2 of 3, its tasks only.
        await expect(sectionSum(page, 'live-sec-queue')).toHaveText('2 of 3 · ↑');
        await expect(panel(page).locator('.live-queue-row .live-queue-text')).toHaveText(['Matriky Kolín', 'Pozemková kniha']);
        // Awaiting action is never narrowed.
        await expect(panel(page).locator('.live-waiting-row')).toHaveCount(2);
        // All directions: back to everything, the light ends.
        await panel(page).locator('.live-lines-all').click();
        await expect(line(page, 'G0001')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#evidence-pill')).toHaveCount(0);
        await expect(card(page, 'Karel')).not.toHaveClass(/evidence-dim/);
        await expect(panel(page).locator('.live-changes li')).toHaveCount(3);
        await expect(panel(page).locator('.live-lines-all')).toHaveCount(0);
    });

    test('a second click drops the selection; folded, the section says what is selected', async ({ page }) => {
        await follow(page);
        await sectionTitle(page, 'live-sec-working').click();
        await expect(sectionSum(page, 'live-sec-working')).toHaveText('↑ ↓ · 2 directions at work');
        await sectionTitle(page, 'live-sec-working').click();
        await line(page, 'G0002').click();
        await expect(line(page, 'G0002')).toHaveAttribute('aria-pressed', 'true');
        await sectionTitle(page, 'live-sec-working').click();
        await expect(sectionSum(page, 'live-sec-working')).toHaveText('selected: ↓ Potomci Marie Novákové');
        await sectionTitle(page, 'live-sec-working').click();
        await line(page, 'G0002').click();
        await expect(line(page, 'G0002')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#evidence-pill')).toHaveCount(0);
    });

    test('the overview: Now by line, and its queue filter is the same choice', async ({ page }) => {
        await follow(page);
        await line(page, 'G0001').click();
        await panel(page).locator('.live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        await expect(ov.locator('.live-section__title').first()).toHaveText('Now · 2 directions');
        const rows = ov.locator('.research-overview__now-row--line');
        await expect(rows).toHaveCount(2);
        await expect(rows.first()).toHaveClass(/is-selected/);
        await expect(rows.first()).toContainText('Předci Jana Nováka — Křest Josefa Nováka 1842');
        await expect(rows.first().locator('.research-overview__now-meta')).toHaveText(/^agent-matriky · Josef Novák · since /);
        await ov.locator('.live-queue-toggle').click();
        const pills = ov.locator('.research-overview__queue-filters .research-overview__filter');
        await expect(pills.and(page.locator('[data-direction="G0001"]'))).toHaveAttribute('aria-checked', 'true');
        // All in the overview drops the panel's selection too.
        await pills.and(page.locator('[data-direction="all"]')).click();
        await expect(rows.first()).not.toHaveClass(/is-selected/);
        await page.keyboard.press('Escape');
        await expect(ov).toBeHidden();
        await expect(line(page, 'G0001')).toHaveAttribute('aria-pressed', 'false');
        // A pill selects the line in the panel.
        await panel(page).locator('.live-panel-expand').click();
        await ov.locator('.research-overview__queue-filters .research-overview__filter[data-direction="G0002"]').click();
        await page.keyboard.press('Escape');
        await expect(line(page, 'G0002')).toHaveAttribute('aria-pressed', 'true');
    });

    test('the selected line stops: it stays selected and last, saying since when it does not work', async ({ page }) => {
        const bridge = await follow(page);
        await line(page, 'G0001').click();
        await stopUp(page, bridge);
        await expect(panel(page).locator('.live-line')).toHaveCount(2);
        await expect(panel(page).locator('.live-line__name')).toHaveText(['Potomci Marie Novákové', 'Předci Jana Nováka']);
        await expect(line(page, 'G0001')).toHaveAttribute('aria-pressed', 'true');
        await expect(line(page, 'G0001')).toHaveClass(/is-idle/);
        await expect(line(page, 'G0001').locator('.live-line__meta')).toHaveText(/^Not at work now · last \d{1,2}:\d{2}/);
        await expect(sectionSum(page, 'live-sec-changes')).toHaveText('only ↑ Předci Jana Nováka');
        // A click drops it: one line at work, the panel as it always was.
        await line(page, 'G0001').click();
        await expect(panel(page).locator('.live-line')).toHaveCount(0);
        await expect(panel(page).locator('.live-working li')).toHaveCount(1);
        await expect(sectionTitle(page, 'live-sec-working')).toHaveText('At work');
    });

    test('one line at work: the panel as before, no rows to select, no glyphs', async ({ page }) => {
        await follow(page, [AGENT_UP]);
        await expect(sectionTitle(page, 'live-sec-working')).toHaveText('At work');
        await expect(panel(page).locator('.live-line')).toHaveCount(0);
        await expect(panel(page).locator('.live-working li')).toHaveCount(1);
        await expect(panel(page).locator('.live-working li')).toContainText('agent-matriky — Křest Josefa Nováka 1842');
        await expect(panel(page).locator('.live-change-dir')).toHaveCount(0);
        await expect(panel(page).locator('.live-queue-dir')).toHaveCount(0);
        await expect(sectionSum(page, 'live-sec-queue')).toHaveText('3 tasks');
    });

    test('another tree opened drops the selection and its light; back, nothing is selected', async ({ page }) => {
        await follow(page);
        await line(page, 'G0001').click();
        await expect(page.locator('#evidence-pill')).toBeVisible();
        const research = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
        await page.evaluate(() => window.Strom.DataManager.createNewTree('Jiný'));
        await expect(page.locator('#evidence-pill')).toHaveCount(0);
        await page.evaluate((id) => window.Strom.UI.switchToTree(id as string), research);
        await expect(line(page, 'G0001')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#evidence-pill')).toHaveCount(0);
    });

    test('stopping following drops the selection and its light', async ({ page }) => {
        await follow(page);
        await line(page, 'G0001').click();
        await expect(page.locator('#evidence-pill')).toBeVisible();
        await panel(page).locator('.live-panel-action').click();
        await expect(page.locator('#evidence-pill')).toHaveCount(0);
        await expect(card(page, 'Karel')).not.toHaveClass(/evidence-dim/);
    });
});
