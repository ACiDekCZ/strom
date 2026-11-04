import { test, expect, type Page, type Request } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { openApp } from './helpers.js';

/**
 * The app against real research bridges, not a mock (1104): a quiet research
 * and one at work, measured (asks of /status and of its parts, their sizes and
 * times); a slow bridge (every answer held 5 s) never said not to respond; a
 * stuck one (its process stopped) said so after three asks, back once it runs;
 * a stopped one said not running at once.
 *
 * STROM_E2E_LIVE: a JSON file, a list of bridges in sandboxes of their own:
 * `{ name, url, pid, work?: string, stop: string }` — `work` a shell command
 * that writes in the research for the given seconds (appended), `stop` one
 * that ends its bridge. STROM_E2E_LIVE_MIN: minutes of each measured phase
 * (default 5). STROM_E2E_LIVE_OUT: where the numbers go (JSON). Not set (CI):
 * skipped.
 */

interface LiveBridge { name: string; url: string; pid: number; work?: string; stop: string }

const FILE = process.env.STROM_E2E_LIVE ?? '';
const BRIDGES: LiveBridge[] = FILE ? JSON.parse(fs.readFileSync(FILE, 'utf8')) as LiveBridge[] : [];
const PHASE_MS = Number(process.env.STROM_E2E_LIVE_MIN ?? '5') * 60_000;
const OUT = process.env.STROM_E2E_LIVE_OUT ?? '';

interface Ask { at: number; kind: 'full' | 'light' | 'part' | 'other'; path: string; size: number; ms: number }

function kindOf(path: string, query: string): Ask['kind'] {
    if (/\/status\/\w+$/.test(path)) return 'part';
    if (/\/status$/.test(path)) return /(^|&)parts=1/.test(query) ? 'light' : 'full';
    return 'other';
}

function pct(xs: number[], p: number): number {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))]);
}

function summary(asks: Ask[]): Record<string, unknown> {
    const status = asks.filter(a => a.kind === 'full' || a.kind === 'light');
    const parts = asks.filter(a => a.kind === 'part');
    const by: Record<string, number> = {};
    for (const p of parts) { const n = p.path.split('/').pop()!; by[n] = (by[n] ?? 0) + 1; }
    return {
        statusAsks: status.length, full: status.filter(a => a.kind === 'full').length, light: status.filter(a => a.kind === 'light').length,
        statusBytes: status.reduce((s, a) => s + a.size, 0), statusMedianSize: pct(status.map(a => a.size), 0.5),
        p50: pct(status.map(a => a.ms), 0.5), p95: pct(status.map(a => a.ms), 0.95), max: pct(status.map(a => a.ms), 1),
        partAsks: parts.length, partBytes: parts.reduce((s, a) => s + a.size, 0), parts: by,
        other: asks.filter(a => a.kind === 'other').length,
    };
}

async function note(page: Page, id: string): Promise<string | null> {
    return page.evaluate((rid) => window.Strom.UI.researchConnectionNote(rid)?.title ?? null, id);
}

const poll = (page: Page) => page.evaluate(() => window.Strom.UI.pollResearchBridge());

test.describe('the app against real research bridges', () => {
    if (BRIDGES.length === 0) {
        test('a quiet, a busy, a slow, a stuck and a stopped real bridge', () => {
            test.skip(true, 'STROM_E2E_LIVE not set');
        });
        return;
    }

    const results: Record<string, unknown> = {};
    test.afterAll(() => {
        if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    });

    for (const bridge of BRIDGES) {
        test(`${bridge.name}: quiet, at work, slow, stuck, stopped`, async ({ page }) => {
            test.setTimeout(2 * PHASE_MS + 10 * 60_000);
            const asks: Ask[] = [];
            page.on('requestfinished', (req: Request) => {
                const u = new URL(req.url());
                if (!req.url().startsWith(bridge.url)) return;
                void req.response().then(async (res) => {
                    const size = res ? (await res.body().catch(() => Buffer.alloc(0))).length : 0;
                    asks.push({ at: Date.now(), kind: kindOf(u.pathname, u.search.slice(1)), path: u.pathname.slice(new URL(bridge.url).pathname.length),
                        size, ms: req.timing().responseEnd });
                });
            });
            const status = await (await fetch(`${bridge.url}/status`)).json() as { tree: { id: string }; features?: string[]; version?: string };
            const id = status.tree.id;
            const result: Record<string, unknown> = { version: status.version ?? null, parts: !!status.features?.includes('status.parts') };
            results[bridge.name] = result;

            await page.setViewportSize({ width: 1280, height: 900 });
            await openApp(page);
            await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ live: b })), bridge.url);
            // ?live= follows the research's tree at once (read-only), its bridge asked from then on.
            await expect.poll(() => page.evaluate((rid) => window.Strom.UI.researchBridgeAnswer(rid)?.up ?? null, id), { timeout: 60_000 }).toBe(true);
            await page.waitForTimeout(5000);

            // Quiet: nobody works in the research.
            let from = Date.now();
            await page.waitForTimeout(PHASE_MS);
            result.quiet = summary(asks.filter(a => a.at >= from));
            expect(await note(page, id)).toBeNull();

            // At work: writes every ~15 s, a session started and closed.
            if (bridge.work) {
                from = Date.now();
                const work = spawn('zsh', ['-c', `${bridge.work} ${Math.round(PHASE_MS / 1000)}`], { stdio: 'ignore' });
                const done = new Promise<void>(r => work.on('exit', () => r()));
                const notes = new Set<string>();
                const watch = setInterval(() => { void note(page, id).then(n => { if (n) notes.add(n); }).catch(() => {}); }, 2000);
                await Promise.race([done, page.waitForTimeout(PHASE_MS + 120_000)]);
                await page.waitForTimeout(20_000);
                clearInterval(watch);
                result.work = { ...summary(asks.filter(a => a.at >= from)), notesSeen: [...notes] };
                expect([...notes].filter(n => /respond/.test(n))).toEqual([]);
            }

            // Slow: every answer of the bridge held 5 s. Never "doesn't respond".
            from = Date.now();
            await page.route(`${bridge.url}/status**`, async (route) => {
                await new Promise(r => setTimeout(r, 5000));
                await route.continue();
            });
            const slow: number[] = [];
            for (let i = 0; i < 4; i++) {
                const t = Date.now();
                await poll(page);
                slow.push(Date.now() - t);
                expect(await note(page, id)).toBeNull();
            }
            await page.unroute(`${bridge.url}/status**`);
            result.slow = { pollMs: slow, note: await note(page, id) };

            // Stuck: the bridge's process stopped (it holds every connection). Said after three asks.
            process.kill(bridge.pid, 'SIGSTOP');
            const stuck: Array<{ ms: number; note: string | null }> = [];
            try {
                for (let i = 0; i < 3; i++) {
                    const t = Date.now();
                    await poll(page);
                    stuck.push({ ms: Date.now() - t, note: await note(page, id) });
                }
            } finally {
                process.kill(bridge.pid, 'SIGCONT');
            }
            result.stuck = stuck;
            expect(stuck.slice(0, 2).map(s => s.note)).toEqual([null, null]);
            expect(stuck[2].note).toBe("The research doesn't respond");
            // It runs again: up at the next ask.
            const back = Date.now();
            await expect.poll(async () => { await poll(page); return note(page, id); }, { timeout: 60_000 }).toBeNull();
            result.back = { ms: Date.now() - back };

            // Stopped: said at once.
            execFileSync('zsh', ['-c', bridge.stop], { timeout: 60_000 });
            const t = Date.now();
            await poll(page);
            result.stopped = { ms: Date.now() - t, note: await note(page, id) };
            expect(await note(page, id)).toBe("The research isn't running");
        });
    }
});
