import { test, expect, Page } from '@playwright/test';
import { cardAction, personModal } from './helpers.js';
import { openResearch, openResearchMenu, editJan, poll, researchGed, dropFile, BRIDGE, UUID, HEAD, NEW_HEAD } from './research-bridge.js';

/**
 * Backward compatibility: this app with the bridge of Strom Research 1.11.0
 * (npm strom-research@1.11.0, git tag v1.11.0), the version users have when
 * they update only the app. That bridge:
 * - routes by path (a query such as `app=` is ignored);
 * - says nothing of `accepts`, `sends`, `inbox`, `batches`, `path`, `agent`;
 * - has no `/media` (and its preflight allows only GET, POST);
 * - answers `POST /sync` with `{ok, changes, file}` and nothing else (no 202 / 503);
 * - has `GET /adopt` → `{token, name, tree}`, `POST /adopt` → `{tree, head}`.
 * The app must work the old way with it: no automatic sends, no originals
 * queued, no loop, nothing lost. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const LINKS_1_11 = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research', 'new', 'update', 'sessions',
    'conflict', 'story', 'sync-undo', 'setup', 'live', 'direction', 'finish'];

interface OldBridge {
    requests: { method: string; path: string; app: string | null }[];
    syncPosts: string[];
    adoptToken: string | null;
}

/** The 1.11.0 bridge, as its `serveLive` answers (src/core/live.ts at v1.11.0). */
async function bridge111(page: Page): Promise<OldBridge> {
    const b: OldBridge = { requests: [], syncPosts: [], adoptToken: null };
    const origin = { 'access-control-allow-origin': '*', vary: 'Origin' };
    await page.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const what = url.pathname.split('/')[2] ?? '';
        b.requests.push({ method: req.method(), path: what, app: url.searchParams.get('app') });
        const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (req.method() === 'OPTIONS') {
            // Only GET and POST: a PUT never gets through the browser's preflight.
            return route.fulfill({ status: 204, headers: { ...origin, 'access-control-allow-methods': 'GET, POST',
                'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '' } });
        }
        if (req.method() === 'POST' && what === 'sync') {
            b.syncPosts.push(req.postData() ?? '');
            return json(200, { ok: true, changes: 3, file: 'strom-app-2026-10-03.ged' });
        }
        if (req.method() === 'POST' && what === 'cancel') return json(200, { ok: true, reason: 'cancelled' });
        if (req.method() === 'POST' && what === 'adopt') {
            return b.adoptToken ? json(200, { tree: UUID, head: HEAD }) : json(400, { error: 'this research waits for no tree' });
        }
        if (req.method() !== 'GET') return json(404, { error: 'not found' });
        if (what === 'adopt') {
            return b.adoptToken
                ? json(200, { token: b.adoptToken, name: 'Víškovi', tree: UUID })
                : json(404, { error: 'this research waits for no tree' });
        }
        if (what === 'status') {
            return json(200, {
                strom: '1.11.0', tree: { id: UUID, name: 'Víškovi', lang: 'cs' }, head: HEAD, headAt: '2026-09-30T10:12:00+02:00',
                persons: 3, families: 1, researches: [], working: [], open: [], waiting: [], links: LINKS_1_11,
                queue: [], queueMore: 0, spend: { month: '2026-10', sessions: 0, amount: 0, currency: 'USD' },
            });
        }
        if (what === 'tree.ged') {
            return route.fulfill({ status: 200, headers: { ...origin, 'content-type': 'text/plain; charset=utf-8', 'x-strom-head': HEAD }, body: researchGed() });
        }
        if (what === 'log') return json(200, []);
        return json(404, { error: 'not found' });
    });
    return b;
}

function queued(page: Page): Promise<unknown[]> {
    return page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('strom-originals');
        req.onsuccess = () => {
            const all = req.result.transaction('originals', 'readonly').objectStore('originals').getAll();
            all.onsuccess = () => { resolve(all.result as unknown[]); req.result.close(); };
        };
    }));
}

test.describe('the bridge of Strom Research 1.11.0', () => {
    test.use({ viewport: DESKTOP });

    test('a linked tree works the old way: no send by itself, no originals queued, no loop', { tag: '@smoke' }, async ({ page }) => {
        await page.clock.install();
        const b = await bridge111(page);
        // As after a ?live= from that research: its bridge remembered, it says nothing of what it accepts.
        await openResearch(page, { capable: false, auto: true });
        await poll(page);
        await editJan(page, 'Kolín');
        // Past the two quiet minutes several times over: nothing goes by itself.
        await page.clock.fastForward(10 * 60_000);
        expect(b.syncPosts).toEqual([]);

        // An attachment: only the preview, a quiet line, nothing kept in the browser.
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        await modal.locator('#input-attachment').setInputFiles('e2e/fixtures/avatar.png');
        await expect(modal.locator('#attachments-list .attachment-row')).toHaveCount(1);
        await expect(modal.locator('#attachments-older-research')).toBeVisible();
        await page.clock.fastForward(5 * 60_000);
        expect(await queued(page)).toEqual([]);
        expect(b.requests.filter(r => r.path === 'media')).toEqual([]);

        // Whatever was asked named the app's version, which the old bridge ignores.
        expect(b.requests.every(r => !!r.app)).toBe(true);
        // Asked once whether it was updated (it was not); never again unasked.
        expect(b.requests.filter(r => r.path === 'status').length).toBeLessThanOrEqual(1);
        // The data are as edited.
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons)
            .find((p: any) => p.firstName === 'Jan') as any).birthPlace)).toBe('Kolín');
    });

    test('updated to a research that says what it takes: the next open of the page asks once and goes on by itself', async ({ page }) => {
        await page.clock.install();
        // Opened from 1.11 (its bridge remembered, nothing said of what it takes), edited the old way.
        await openResearch(page, { capable: false, auto: true });
        await editJan(page, 'tkadlec');
        // The research is updated on the same port and token: its status now says what it takes.
        const { fakeBridge } = await import('./research-bridge.js');
        const b = await fakeBridge(page, { accepts: { sync: { auto: 'write' }, sources: true, verified: true, media: null },
            syncReply: { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042' } } });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await page.reload();
        await page.clock.fastForward(1000);
        // Asked once: it takes sends now, so the waiting edit goes after the quiet time.
        await expect.poll(async () => page.evaluate(() => (window.Strom.UI as any).researchSyncCapable(
            window.Strom.TreeManager.getActiveTreeMetadata()?.research?.id))).toBe(true);
        await page.clock.fastForward(3 * 60_000);
        await expect.poll(() => b.posts.length).toBeGreaterThan(0);
        expect(b.posts[0]).toContain('tkadlec');
    });

    test('the older version is said quietly, with how to update it; once updated, the line goes', async ({ page }) => {
        await bridge111(page);
        await openResearch(page, { capable: false });
        await poll(page);
        await openResearchMenu(page);
        const line = page.locator('#research-older-block');
        await expect(line).toContainText('The research has an older version (1.11.0)');
        await line.getByRole('button', { name: 'How to update…' }).click();
        const dialog = page.locator('#research-update-modal');
        await expect(dialog.locator('.install-line').nth(0)).toHaveText('strom update');
        await expect(dialog.locator('.install-line').nth(1)).toHaveText('npm install -g strom-research@latest');
        await expect(dialog).toContainText('paste the install line again');
        // Not updated yet: said so, the dialog stays.
        await dialog.getByRole('button', { name: 'Check again' }).click();
        await expect(dialog).toContainText('The research still has the older version (1.11.0)');
        // Updated (same port and token): it says what it takes now.
        const { fakeBridge } = await import('./research-bridge.js');
        await fakeBridge(page, { accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null } });
        await dialog.getByRole('button', { name: 'Check again' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.toast')).toContainText('The research is updated');
        await openResearchMenu(page);
        await expect(page.locator('#research-older-block')).toHaveCount(0);
    });

    test('?send= with its reply {ok, changes, file}: sent, said so', async ({ page }) => {
        const b = await bridge111(page);
        await openResearch(page, { capable: false, edit: true });
        const done = page.evaluate((u) => window.Strom.UI.sendChangesToResearch(u), BRIDGE);
        const dialog = page.locator('#confirmation-modal');
        await dialog.getByRole('button', { name: 'Send' }).click();
        await expect(dialog).toContainText('Sent.');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await done;
        expect(b.syncPosts).toHaveLength(1);
        expect(b.syncPosts[0]).toContain(`1 _STROM_TREE ${UUID}`);
    });

    test('a new version from it (it does not take the app\'s sources): the sources are not lost without a word', async ({ page }) => {
        await bridge111(page);
        await openResearch(page, { capable: false });
        // A source of the user's, cited on Jan's birth, sent the old way (1.11 keeps the send, takes no sources).
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            const src = dm.addSource({ title: 'Křestní matrika Čáslav', reference: 'fol. 112' });
            dm.updatePerson(jan.id, { birthSourceIds: [src.id] });
        });
        const done = page.evaluate((u) => window.Strom.UI.sendChangesToResearch(u), BRIDGE);
        const confirm = page.locator('#confirmation-modal');
        await confirm.getByRole('button', { name: 'Send' }).click();
        await confirm.getByRole('button', { name: 'OK' }).click();
        await done;

        // The research's next version, without that source (?import-url= / a dropped tree.ged).
        await dropFile(page, 'tree-strom.ged', researchGed(NEW_HEAD));
        const sources = () => page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources ?? {})
            .map((s: any) => s.title));
        // Either the source is still there, or the app asked before overwriting (and a copy keeps it).
        await expect.poll(async () => (await sources()).includes('Křestní matrika Čáslav')
            || await confirm.evaluate(el => el.classList.contains('active'))).toBe(true);
        if (await confirm.evaluate(el => el.classList.contains('active'))) {
            await expect(confirm).toContainText('Updating it replaces those changes with the research (a backup is kept first)');
            await expect(confirm.getByRole('button', { name: 'Open as copy' })).toBeVisible();
        }
    });

    test('?adopt= from it: the tree goes over and is linked; its status without accepts breaks nothing', async ({ page }) => {
        const b = await bridge111(page);
        await openResearch(page, { capable: false });
        // An app tree to hand over: unlink the research tree, start research with it.
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            tm.setResearchLink(tm.getActiveTreeId()!, undefined);
            localStorage.setItem('strom-research-links', JSON.stringify({ actions: ['new', 'send', 'open'], at: new Date().toISOString() }));
            (window.Strom.UI as any).startResearchAdopt(tm.getActiveTreeId());
        });
        b.adoptToken = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchAdoptToken?.token ?? null);
        expect(b.adoptToken).toBeTruthy();
        await page.evaluate((u) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: u })), BRIDGE);
        await page.locator('#research-adopt-confirm').click();
        await expect(page.locator('.toast')).toContainText('linked to the research');
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.id)).toBe(UUID);
        expect(b.requests.filter(r => r.method === 'POST' && r.path === 'adopt')).toHaveLength(1);
        // Its own version loaded right after (its numbers): the next send is the research's tree by its ids.
        expect(b.requests.some(r => r.path === 'tree.ged')).toBe(true);
        await expect.poll(() => page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons)
            .filter((p: any) => p.refn).length)).toBeGreaterThan(0);
    });

    test('Start research where the research was announced once (maybe uninstalled since): the way to install it again', async ({ page }) => {
        await bridge111(page);
        await openResearch(page, { capable: false });
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            tm.setResearchLink(tm.getActiveTreeId()!, undefined);
            localStorage.setItem('strom-research-links', JSON.stringify({ actions: ['new', 'send', 'open'], at: new Date().toISOString() }));
            window.Strom.UI.showResearchInfoDialog();
        });
        await page.locator('.research-info-install').click();
        await expect(page.locator('#research-info-modal .install-line').first()).toBeVisible();
    });
});

