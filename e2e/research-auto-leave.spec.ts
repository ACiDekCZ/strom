import { test, expect, Page, BrowserContext } from '@playwright/test';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { openApp, card } from './helpers.js';
import { UUID, HEAD, dropFile, editJan, poll, researchGed } from './research-bridge.js';

/**
 * Sending by itself when the page is left (audit 017 a-D1): the tab closed or
 * another address opened right after an edit — the changes reach the research
 * on the way out, and the page opened again does not send them a second time.
 *
 * The bridge here is a real local HTTP server, not page.route: a request
 * that outlives its page (keepalive) is not seen by the page's routes.
 */

interface RealBridge {
    base: string;
    posts: string[];
    sends: { intake: string; at: string; state: string; changes: number; tree: string; sent: string; decidedAt: string }[];
    head: string;
    /** Stopped: every request is refused (the socket is destroyed). */
    down: boolean;
    close(): Promise<void>;
}

const TOKEN = '0123456789abcdef0123456789abcdef';

async function realBridge(): Promise<RealBridge> {
    const b = { posts: [] as string[], sends: [] as RealBridge['sends'], head: HEAD, down: false } as RealBridge;
    const cors = { 'access-control-allow-origin': '*' };
    const json = (res: ServerResponse, status: number, body: unknown) => {
        res.writeHead(status, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
    };
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (b.down) { req.socket.destroy(); return; }
        const path = (req.url ?? '').split('?')[0];
        if (req.method === 'OPTIONS') {
            res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, PUT, POST', 'access-control-allow-headers': '*' });
            res.end();
            return;
        }
        if (!path.startsWith(`/${TOKEN}/`)) { res.writeHead(404, cors); res.end(); return; }
        if (path.endsWith('/status')) {
            json(res, 200, {
                tree: { id: UUID, name: 'Fíškovi' }, head: b.head, links: ['send', 'open', 'live', 'app', 'setup'],
                accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null },
                inbox: { trees: [], material: 0 }, lastIntake: null, sends: b.sends,
            });
            return;
        }
        if (path.endsWith('/sync') && req.method === 'POST') {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                b.posts.push(body);
                const sent = /1 _STROM_SENT (\S+)/.exec(body)?.[1] ?? '';
                const tree = /1 _STROM_APP_TREE (\S+)/.exec(body)?.[1] ?? UUID;
                const intake = `R${Date.now()}-${b.posts.length}`;
                const at = new Date().toISOString();
                b.head = `ab${b.posts.length}0cd${b.posts.length}0ef`;
                b.sends.unshift({ intake, at, state: 'written', changes: 1, tree, sent, decidedAt: at });
                json(res, 200, { ok: true, inbox: false, changes: 1, applied: 1, intake, head: b.head });
            });
            return;
        }
        if (path.endsWith('/tree.ged')) {
            res.writeHead(200, { ...cors, 'content-type': 'text/plain; charset=utf-8' });
            res.end(researchGed(b.head, ['1 BIRT', '2 PLAC Praha']));
            return;
        }
        res.writeHead(404, cors);
        res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    b.base = `http://127.0.0.1:${port}/${TOKEN}`;
    b.close = () => new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
    });
    return b;
}

/** A research tree that sends by itself, its bridge (the real one) asked once. */
async function autoTreeOn(page: Page, bridge: RealBridge): Promise<void> {
    await openApp(page);
    await dropFile(page, 'tree-strom.ged', researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
    await page.evaluate(({ uuid, base }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts: { sync: { auto: 'write' }, sources: true, verified: true } }));
        localStorage.setItem('strom-research-auto-intro-seen', '1');
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        tm.patchResearchLink(id, { sendMode: 'auto' });
        localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify({ modeAsked: true, skipPreview: true, firstSendBackup: true }));
    }, { uuid: UUID, base: bridge.base });
    await poll(page);
}

/** The app opened again in a new tab of the same browser (same storage); its bridge asked. */
async function openAgain(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    await page.goto('/strom.html');
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await expect(card(page, 'Jan')).toBeVisible();
    await poll(page);
    return page;
}

const sentState = (page: Page) => page.evaluate(() => {
    const tm = window.Strom.TreeManager;
    const link = tm.getTreeMetadata(tm.getActiveTreeId()!)?.research;
    return { state: link?.sent?.state ?? '', fingerprint: link?.sent?.fingerprint ?? '' };
});

let bridge: RealBridge;
test.beforeEach(async () => { bridge = await realBridge(); });
test.afterEach(async () => { await bridge.close(); });

test.describe('sending by itself when the page is left (audit 017 a-D1)', () => {
    test('the tab closed right after an edit: the changes reach the research; opened again, nothing goes a second time', async ({ page, context }) => {
        await autoTreeOn(page, bridge);
        await editJan(page, 'Kolín');
        await page.close({ runBeforeUnload: true });
        await expect.poll(() => bridge.posts.length, { timeout: 5000 }).toBe(1);
        expect(bridge.posts[0]).toContain('2 PLAC Kolín');
        // Back: the send the research wrote is this tree's last one — not sent again.
        const again = await openAgain(context);
        await expect.poll(() => sentState(again)).toMatchObject({ state: 'written' });
        await again.waitForTimeout(1500);
        await poll(again);
        expect(bridge.posts).toHaveLength(1);
        await expect(again.locator('#research-sync-mark')).not.toHaveAttribute('aria-label', "Changes the research doesn't have");
    });

    test('another address opened in the same tab right after an edit: the changes reach the research', async ({ page }) => {
        await autoTreeOn(page, bridge);
        await editJan(page, 'Brno');
        await page.goto('about:blank');
        await expect.poll(() => bridge.posts.length, { timeout: 5000 }).toBe(1);
        expect(bridge.posts[0]).toContain('2 PLAC Brno');
    });

    test('the bridge not asked for a while (not fresh) when the tab closes: the changes go all the same, without asking it first', async ({ page }) => {
        await autoTreeOn(page, bridge);
        // The last answer is older than the freshness window (as after a quiet spell in another window).
        await page.evaluate(() => {
            const now = Date.now();
            Date.now = () => now + 10 * 60_000;
        });
        await editJan(page, 'Tábor');
        await page.close({ runBeforeUnload: true });
        await expect.poll(() => bridge.posts.length, { timeout: 5000 }).toBe(1);
        expect(bridge.posts[0]).toContain('2 PLAC Tábor');
    });

    test('the bridge not running when the tab closes: nothing lost — opened again with the bridge back, the changes go once', async ({ page, context }) => {
        await autoTreeOn(page, bridge);
        bridge.down = true;
        await editJan(page, 'Písek');
        await page.close({ runBeforeUnload: true });
        await new Promise(r => setTimeout(r, 1000));
        expect(bridge.posts).toHaveLength(0);
        bridge.down = false;
        const again = await openAgain(context);
        // Waiting changes go once the bridge answers (the quiet time, or at once when the research is newer).
        await again.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
        await expect.poll(() => bridge.posts.length, { timeout: 5000 }).toBe(1);
        expect(bridge.posts[0]).toContain('2 PLAC Písek');
        await poll(again);
        await again.waitForTimeout(1000);
        expect(bridge.posts).toHaveLength(1);
    });
});
