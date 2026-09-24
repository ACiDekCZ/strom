import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Opening a research from Strom Research: drag & drop, ?import-url=, the
 * installed app's file handler (launchQueue, simulated) and the ?live= bridge
 * (status, tree.ged and the event stream answered by page.route). The bridge
 * address is on 127.0.0.1 — the app accepts nothing else.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const BRIDGE = 'http://127.0.0.1:5999/0123456789abcdef0123456789abcdef';

function researchGed(opts: { extra?: boolean; tree?: string | null } = {}): string {
    const lines = [
        '0 HEAD',
        '1 SOUR STROM_RESEARCH',
        '2 NAME Strom Research',
        '1 DATE 23 SEP 2026',
        ...(opts.tree === null ? [] : [`1 _STROM_TREE ${opts.tree ?? UUID}`]),
        '1 CHAR UTF-8',
        '1 NOTE Víškovi',
        '2 CONT Rodokmen ze Strom Research',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 REFN P0003', '1 FAMC @F0001@',
    ];
    if (opts.extra) lines.push('0 @P0004@ INDI', '1 NAME Ludmila /Víšková/', '1 SEX F', '1 REFN P0004', '1 FAMC @F0001@');
    lines.push('0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@');
    if (opts.extra) lines.push('1 CHIL @P0004@');
    lines.push('0 TRLR');
    return lines.join('\n');
}

const PLAIN_GED = [
    '0 HEAD', '1 SOUR PAF', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Karel /Plain/', '1 SEX M',
    '0 TRLR',
].join('\n');

/** Drop a file onto the tree canvas the way a browser would. */
async function dropFile(page: Page, name: string, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle(({ name, content }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], name, { type: 'text/plain' }));
        return dt;
    }, { name, content });
    await page.dispatchEvent('#tree-container', 'dragenter', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'dragover', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'drop', { dataTransfer });
}

const treeNames = (page: Page) => page.evaluate(
    () => window.Strom.TreeManager.getTrees().map((t: { name: string }) => t.name) as string[]
);

const cors = { 'access-control-allow-origin': '*' };

test.describe('open a research', () => {
    test('drop a Strom Research file → its tree; drop again → the same tree is updated', async ({ page }) => {
        await openApp(page);
        await dropFile(page, 'tree-strom.ged', researchGed());
        await expect(page.locator('.toast')).toContainText('Opened the research Víškovi from Strom Research — 3 people, 1 family');
        await expect(card(page, 'Jan')).toBeVisible();
        expect(await treeNames(page)).toEqual(['Víškovi']);
        const meta = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata());
        expect(meta.research.id).toBe(UUID);

        await dropFile(page, 'tree-strom.ged', researchGed({ extra: true }));
        await expect(page.locator('.toast')).toContainText('Updated the research Víškovi from Strom Research — 4 people');
        await expect(card(page, 'Ludmila')).toBeVisible();
        // No duplicate: still exactly one tree.
        expect(await treeNames(page)).toEqual(['Víškovi']);
    });

    test('drop overlay appears while dragging a file and a non-GEDCOM file is refused', async ({ page }) => {
        await openApp(page);
        const dataTransfer = await page.evaluateHandle(() => {
            const dt = new DataTransfer();
            dt.items.add(new File(['{}'], 'notes.json', { type: 'application/json' }));
            return dt;
        });
        await page.dispatchEvent('#tree-container', 'dragenter', { dataTransfer });
        await expect(page.locator('#drop-overlay')).toBeVisible();
        await page.dispatchEvent('#tree-container', 'drop', { dataTransfer });
        await expect(page.locator('#drop-overlay')).toBeHidden();
        await expect(page.locator('.toast')).toContainText('Only GEDCOM files (.ged)');
    });

    test('a plain GEDCOM dropped in goes to the normal import dialog', async ({ page }) => {
        await openApp(page);
        await dropFile(page, 'family.ged', PLAIN_GED);
        await expect(page.locator('#gedcom-result-modal')).toBeVisible();
    });

    test('edited in the app → asks; "Open as new copy" keeps the edited tree untouched', async ({ page }) => {
        await openApp(page);
        await dropFile(page, 'tree-strom.ged', researchGed());
        await expect(card(page, 'Jan')).toBeVisible();
        // The user changes the tree in the app.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { firstName: 'Johann' });
        });
        expect(await page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons)
            .some((p: any) => p.firstName === 'Johann'))).toBe(true);

        await dropFile(page, 'tree-strom.ged', researchGed({ extra: true }));
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('was changed in this app');
        await dialog.getByRole('button', { name: 'Open as copy' }).click();
        await expect(page.locator('.toast')).toContainText('Opened the research Víškovi');
        await expect(card(page, 'Ludmila')).toBeVisible();

        const names = await treeNames(page);
        expect(names.length).toBe(2);
        expect(names[0]).toBe('Víškovi');
        expect(names[1]).toMatch(/^Víškovi \(/);
        // The copy carries the research link now; the edited tree keeps its edit.
        const trees = await page.evaluate(() => window.Strom.TreeManager.getTrees());
        expect(trees[0].research).toBeUndefined();
        expect(trees[1].research.id).toBe(UUID);
        const editedStill = await page.evaluate(async (id) => {
            const data = await window.Strom.TreeManager.getTreeData(id);
            return Object.values(data.persons).some((p: any) => p.firstName === 'Johann');
        }, trees[0].id);
        expect(editedStill).toBe(true);
    });

    test('edited in the app → "Update" overwrites that tree only (no duplicate)', async ({ page }) => {
        await openApp(page);
        await dropFile(page, 'tree-strom.ged', researchGed());
        await expect(card(page, 'Jan')).toBeVisible();
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { firstName: 'Johann' });
        });
        await dropFile(page, 'tree-strom.ged', researchGed({ extra: true }));
        const dialog = page.locator('#confirmation-modal');
        await dialog.getByRole('button', { name: 'Update' }).click();
        await expect(page.locator('.toast')).toContainText('Updated the research Víškovi');
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(card(page, 'Ludmila')).toBeVisible();
        expect(await treeNames(page)).toEqual(['Víškovi']);
    });

    test('?import-url= on 127.0.0.1 opens the research and leaves the address clean', async ({ page }) => {
        await page.route('http://127.0.0.1:5999/**', (route) => route.fulfill({
            status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: researchGed(),
        }));
        const url = `${BRIDGE}/tree-strom.ged`;
        await page.goto(`/strom.html?import-url=${encodeURIComponent(url)}`);
        await expect(page.locator('.toast')).toContainText('Opened the research Víškovi');
        await expect(card(page, 'Josef')).toBeVisible();
        expect(page.url()).not.toContain('import-url');
    });

    test('?import-url= keeps the canvas blank until the research is in; summary counts real people only', async ({ page }) => {
        // A single-parent family: the importer adds a "?" placeholder partner,
        // which the summary must not count as a person of the research.
        const ged = researchGed().replace('1 WIFE @P0002@\n', '')
            .replace('1 FAMS @F0001@\n0 @P0003@', '0 @P0003@');
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => { release = r; });
        await page.route('http://127.0.0.1:5999/**', async (route) => {
            await gate;
            await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: ged });
        });
        await page.goto(`/strom.html?import-url=${encodeURIComponent(`${BRIDGE}/tree-strom.ged`)}`);
        // While the file is on its way the last-opened tree is not flashed.
        await expect(page.locator('html')).toHaveClass(/external-opening/);
        await expect(page.locator('#tree-container')).toHaveCSS('visibility', 'hidden');
        release();
        await expect(page.locator('.toast')).toContainText('Opened the research Víškovi');
        await expect(page.locator('html')).not.toHaveClass(/external-opening/);
        await expect(page.locator('#tree-container')).toHaveCSS('visibility', 'visible');
        const counts = await page.evaluate(() => {
            const persons = Object.values(window.Strom.DataManager.getData().persons) as { isPlaceholder?: boolean }[];
            return { all: persons.length, real: persons.filter((p) => !p.isPlaceholder).length };
        });
        expect(counts.all).toBeGreaterThan(counts.real);
        await expect(page.locator('.toast')).toContainText(`${counts.real} people`);
    });

    test('?import-url= that cannot be fetched explains and offers the manual import', async ({ page }) => {
        await page.route('http://127.0.0.1:5999/**', (route) => route.abort('connectionrefused'));
        await page.goto(`/strom.html?import-url=${encodeURIComponent(`${BRIDGE}/tree-strom.ged`)}`);
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('did not let the app read the file');
        await expect(dialog.getByRole('button', { name: 'Import file…' })).toBeVisible();
    });

    test('in Safari a refused local connection says why and what works instead', async ({ browser }) => {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        });
        const page = await context.newPage();
        await page.route('http://127.0.0.1:5999/**', (route) => route.abort('blockedbyclient'));
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText('Safari does not let web pages connect to programs on this computer');
        await expect(dialog).toContainText('Chrome or Edge');
        await expect(dialog.getByRole('button', { name: 'Import file…' })).toBeVisible();
        await context.close();
    });

    test('?import-url= to another host is ignored without a request', async ({ page }) => {
        let requested = false;
        await page.route('**/evil.com/**', (route) => { requested = true; return route.abort(); });
        await page.route('http://127.0.0.1.evil.com/**', (route) => { requested = true; return route.abort(); });
        await page.goto(`/strom.html?import-url=${encodeURIComponent('http://127.0.0.1.evil.com/tree.ged')}`);
        await expect(page.locator('.toast')).toContainText('not on this computer');
        expect(requested).toBe(false);
        expect(page.url()).not.toContain('import-url');
    });

    test('file handler (launchQueue) opens the launched file', async ({ page }) => {
        const ged = researchGed();
        await page.addInitScript((content) => {
            // Chrome queues launch params until a consumer is set.
            // Chrome's own window.launchQueue is a read-only accessor: redefine it.
            Object.defineProperty(window, 'launchQueue', {
                configurable: true,
                value: {
                    setConsumer(consumer: (p: unknown) => void) {
                        consumer({ files: [{ getFile: async () => new File([content], 'tree-strom.ged') }] });
                    },
                },
            });
        }, ged);
        await page.goto('/strom.html?open=file');
        await expect(page.locator('.toast')).toContainText('Opened the research Víškovi');
        await expect(card(page, 'Anna')).toBeVisible();
        expect(page.url()).not.toContain('open=file');
    });
});

test.describe('live research (?live=)', () => {
    test('follows the bridge: read-only tree, panel, refresh + highlight on change, ended state', async ({ page }) => {
        const state = { down: false, gedCalls: 0, eventCalls: 0 };
        const working = (head: string) => head === 'h1'
            ? [{ who: 'agent-matriky', since: new Date().toISOString(), task: 'Lučice births' }]
            : [{ who: 'agent-2', since: new Date().toISOString(), task: 'Sčítání 1921' }];
        const status = (head: string) => ({
            strom: '1.0.0',
            tree: { id: UUID, name: 'Víškovi', lang: 'cs' },
            head,
            persons: 3,
            families: 1,
            researches: [],
            working: working(head),
            open: [],
            waiting: [{ id: 'T1', what: 'Confirm the father of <b>Jan</b><img src=x>', on: 'user' }],
        });
        await page.route(`${BRIDGE}/**`, async (route) => {
            if (state.down) return route.abort('connectionrefused');
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/status')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                    body: JSON.stringify(status(state.gedCalls > 1 ? 'h2' : 'h1')) });
            }
            if (path.endsWith('/tree.ged')) {
                state.gedCalls++;
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' },
                    body: researchGed({ extra: state.gedCalls > 1 }) });
            }
            if (path.endsWith('/events')) {
                state.eventCalls++;
                const body =
                    `event: hello\ndata: ${JSON.stringify(status(state.gedCalls > 1 ? 'h2' : 'h1'))}\n\n` +
                    `event: change\ndata: ${JSON.stringify({ head: 'h2', what: ['+P0004 Ludmila /Víšková/ ← S0001'], at: new Date().toISOString() })}\n\n` +
                    `event: working\ndata: ${JSON.stringify(working('h2'))}\n\n`;
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
            }
            return route.fulfill({ status: 404, headers: cors, body: '' });
        });

        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        expect(page.url()).not.toContain('live=');
        // Untrusted text is shown as text, never parsed as HTML.
        await expect(panel.locator('.live-waiting')).toContainText('Confirm the father of <b>Jan</b>');
        expect(await panel.locator('b, img').count()).toBe(0);

        // The change arrives: Ludmila appears, glows, is listed.
        await expect(card(page, 'Ludmila')).toBeVisible();
        await expect(card(page, 'Ludmila')).toHaveClass(/live-changed/);
        await expect(panel.locator('.live-changes')).toContainText('New person: Ludmila Víšková');
        await expect(panel.locator('.live-working')).toContainText('agent-2');
        await expect(panel.locator('.live-working')).toContainText('Sčítání 1921');
        await expect(panel.locator('.live-waiting')).toContainText('waiting on: user');

        // Read-only while following.
        await expect(page.locator('body')).toHaveClass(/tree-locked/);
        expect(await treeNames(page)).toEqual(['Víškovi']);

        // The bridge goes away → "following ended", last state kept, editable again.
        state.down = true;
        await expect(panel).toHaveClass(/ended/, { timeout: 15000 });
        await expect(panel).toContainText('Following ended');
        // Who was working is stale once following ended — not shown any more.
        await expect(panel.locator('.live-working')).toHaveCount(0);
        await expect(panel.locator('.live-changes')).toContainText('New person: Ludmila Víšková');
        await expect(card(page, 'Ludmila')).toBeVisible();
        await expect(page.locator('body')).not.toHaveClass(/tree-locked/);
        await panel.getByRole('button', { name: 'Close' }).click();
        await expect(panel).toHaveCount(0);
    });

    test('stop following lifts read-only and removes the panel', async ({ page }) => {
        await page.route(`${BRIDGE}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/status')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                    body: JSON.stringify({ tree: { id: UUID, name: 'Víškovi' }, head: 'h1', working: [], waiting: [] }) });
            }
            if (path.endsWith('/tree.ged')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain' }, body: researchGed() });
            }
            // Keep the stream "open" by never answering.
            return new Promise(() => {});
        });
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        await expect(panel.locator('.live-working')).toContainText('Nobody is working');
        await expect(page.locator('body')).toHaveClass(/tree-locked/);
        await panel.getByRole('button', { name: 'Stop following' }).click();
        await expect(panel).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/tree-locked/);
    });
});

test.describe('live research survives a reload', () => {
    /** A bridge that answers while `up.value` is true; the event stream stays open. */
    async function routeBridge(page: Page, up: { value: boolean }): Promise<void> {
        await page.route(`${BRIDGE}/**`, async (route) => {
            if (!up.value) return route.abort('connectionrefused');
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/status')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                    body: JSON.stringify({ tree: { id: UUID, name: 'Víškovi' }, head: 'h1', working: [], waiting: [] }) });
            }
            if (path.endsWith('/tree.ged')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain' }, body: researchGed() });
            }
            return new Promise(() => {});
        });
    }

    test('a reload keeps following the same bridge, into the same tree', async ({ page }) => {
        await routeBridge(page, { value: true });
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        expect(page.url()).not.toContain('live=');
        // The token stays out of the address and of anything lasting.
        expect(await page.evaluate(() => localStorage.getItem('strom.live'))).toBeNull();

        await page.reload();
        await expect(panel).toBeVisible();
        await expect(page.locator('body')).toHaveClass(/tree-locked/);
        await expect(card(page, 'Jan')).toBeVisible();
        expect(page.url()).not.toContain('live=');
        expect((await treeNames(page)).filter(n => n === 'Víškovi')).toHaveLength(1);
    });

    test('after "Stop following" a reload does not follow again', async ({ page }) => {
        const requests: string[] = [];
        page.on('request', r => { if (r.url().startsWith(BRIDGE)) requests.push(r.url()); });
        await routeBridge(page, { value: true });
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        await panel.getByRole('button', { name: 'Stop following' }).click();
        await expect(panel).toHaveCount(0);

        requests.length = 0;
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(panel).toHaveCount(0);
        expect(requests).toEqual([]);
    });

    test('a bridge gone meanwhile: a short note, no error, no import offer', async ({ page }) => {
        const up = { value: true };
        await routeBridge(page, up);
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        await expect(page.locator('#live-panel')).toBeVisible();

        up.value = false;
        await page.reload();
        await expect(page.locator('.toast')).toContainText('Following ended');
        await expect(page.locator('#confirmation-modal')).not.toBeVisible();
        await expect(page.locator('#live-panel')).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/tree-locked/);
        expect(await page.evaluate(() => sessionStorage.getItem('strom.live'))).toBeNull();
    });
});

test.describe('without the APIs (mobile, other browsers)', () => {
    test('no launchQueue / EventSource, phone viewport, bogus ?live= and ?import-url=: app starts cleanly', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(() => {
            Object.defineProperty(window, 'EventSource', { value: undefined, configurable: true, writable: true });
            Object.defineProperty(window, 'launchQueue', { value: undefined, configurable: true, writable: true });
        });
        await page.goto(`${test.info().project.use.baseURL}?live=` + encodeURIComponent('http://evil.com/tok')
            + '&import-url=' + encodeURIComponent('http://localhost@evil.com/x.ged'));
        await expect(page.locator('.toolbar')).toBeVisible();
        await expect(page.locator('.toast')).toContainText('not on this computer');
        expect(page.url()).not.toContain('live=');
        expect(page.url()).not.toContain('import-url=');
        expect(errors).toEqual([]);
        await context.close();
    });

    test('a valid ?live= without EventSource still opens the research (polling fallback)', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(() => {
            Object.defineProperty(window, 'EventSource', { value: undefined, configurable: true, writable: true });
        });
        await page.route(`${BRIDGE}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/status')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                    body: JSON.stringify({ tree: { id: UUID, name: 'Víškovi' }, head: 'h1', working: [], waiting: [] }) });
            }
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain' }, body: researchGed() });
        });
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        await expect(page.locator('#live-panel')).toBeVisible();
        await expect(card(page, 'Jan')).toBeVisible();
        expect(errors).toEqual([]);
    });
});
