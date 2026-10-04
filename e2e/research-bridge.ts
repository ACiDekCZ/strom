import { expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * A Strom Research bridge answered by page.route (a research that tells what
 * it has: `accepts`, `inbox`, `sends`), and a research tree opened from it —
 * shared by the research sync specs.
 */

export const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
export const HEAD = '3f2a9c1e5b7d';
export const NEW_HEAD = '9b8c7d6e5f40';
export const BRIDGE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };

export function researchGed(head = HEAD, extra: string[] = []): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 27 SEP 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
        ...extra,
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 @S0001@ SOUR', '1 TITL Oddací matrika Čáslav', '1 PAGE fol. 41', '1 REFN S0001', '1 TEXT Josef Víšek a Anna', '1 _STROM_READ research',
        '0 TRLR',
    ].join('\n');
}

export async function dropFile(page: Page, name: string, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle(({ name, content }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], name, { type: 'text/plain' }));
        return dt;
    }, { name, content });
    await page.dispatchEvent('#tree-container', 'dragenter', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'dragover', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'drop', { dataTransfer });
}

/** What the fake bridge says and what it got. */
export interface FakeBridge {
    head: string;
    accepts: unknown;
    inbox: { tree: string; at: string; changes: number; sent: string }[];
    sends: { intake: string; at: string; state: string; changes: number; tree: string; sent: string; decidedAt?: string; reason?: string }[];
    lastIntake: { id: string; at: string } | null;
    syncReply: { status: number; body: unknown };
    treeGed: string;
    down: boolean;
    links: string[];
    posts: string[];
    /** The bridge takes this long to answer a send (ms). */
    syncDelayMs?: number;
    /** A write at once (the research's reply has `inbox: false` and no `pending`): the version it makes. */
    onWrite?: (posted: string) => { head: string; ged: string };
    /** The sends asked to be written again (`POST /sync/<R…>/again`), by their marks. */
    againAsks?: string[];
    /** Originals it has (by SHA-256) and the id it gives them. */
    mediaKnown: Map<string, string>;
    /** Every `PUT /media/<sha>`: the hash, the headers it carried and the body's size. */
    mediaPuts: { sha: string; headers: Record<string, string>; bytes: number }[];
    /** Every `GET /media/<sha>` asked. */
    mediaAsks: string[];
    /** Status of a PUT (200 = taken). */
    mediaPutStatus: number;
    /** Files it can serve in full (`GET /media/<sha>?file=1`); others answer 410. */
    mediaFiles: Map<string, { type: string; body: Buffer }>;
    /** Busy (starting up): every request answers 503 with Retry-After. */
    busy?: boolean;
    /** Every request it got (path, method). */
    seen?: string[];
    /** Every `POST /batch/<id>/done`: the batch and its body. */
    batchDone?: { id: string; body: Record<string, unknown> }[];
    /** Batches it reports in `/status.batches`. */
    batches?: unknown[];
    /** A file it has, sent again with a person or a note: it adds them to its input (`added`, Strom Research 1.12). */
    knownAdds?: boolean;
    /** The research's version it says in `/status` (`strom`). */
    strom?: string;
    /** Tasks waiting for the user (`/status.waiting`). */
    waiting?: unknown[];
    /** What the bridge says it can do (`/status.features`, 1.12.0-rc.20). */
    features?: string[];
}

export async function fakeBridge(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    const b: FakeBridge = {
        head: HEAD,
        accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null },
        inbox: [], sends: [], lastIntake: null,
        syncReply: { status: 200, body: { ok: true, input: 'I0042', changes: 6, inbox: true } },
        treeGed: researchGed(),
        down: false,
        links: ['send', 'open', 'live', 'app', 'setup'],
        posts: [],
        mediaKnown: new Map(), mediaPuts: [], mediaAsks: [], mediaPutStatus: 200, mediaFiles: new Map(),
        ...init,
    };
    await page.route(`${BRIDGE}/**`, async (route) => {
        if (b.down) return route.abort('connectionrefused');
        const url = new URL(route.request().url());
        (b.seen ??= []).push(`${route.request().method()} ${url.pathname.replace(/^\/[^/]+/, '')}`);
        if (b.busy && route.request().method() !== 'OPTIONS') {
            return route.fulfill({ status: 503, headers: { ...cors, 'content-type': 'application/json', 'retry-after': '2' }, body: JSON.stringify({ error: 'busy' }) });
        }
        const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (route.request().method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, PUT, POST', 'access-control-allow-headers': '*' } });
        }
        const media = /\/media\/([0-9a-f]{64})$/.exec(url.pathname);
        if (media) {
            const sha = media[1];
            if (route.request().method() === 'PUT') {
                const body = route.request().postDataBuffer();
                b.mediaPuts.push({ sha, headers: route.request().headers(), bytes: body?.length ?? 0 });
                if (b.mediaPutStatus !== 200) return json(b.mediaPutStatus, { error: 'no' });
                // Content it has: said so (as the research does), nothing new.
                const prior = b.mediaKnown.get(sha);
                if (prior) {
                    const h = route.request().headers();
                    const added = b.knownAdds && (h['x-strom-person'] || h['x-strom-note'])
                        ? { added: { persons: h['x-strom-person'] ? [h['x-strom-person']] : [], note: !!h['x-strom-note'] } } : {};
                    return json(200, { known: prior, kind: 'input', ...added });
                }
                const id = `I${String(100 + b.mediaPuts.length).padStart(4, '0')}`;
                b.mediaKnown.set(sha, id);
                return json(200, { input: id });
            }
            if (url.searchParams.get('file') === '1') {
                const file = b.mediaFiles.get(sha);
                return file
                    ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': file.type, 'content-length': String(file.body.length) }, body: file.body })
                    : json(410, { error: 'gone' });
            }
            b.mediaAsks.push(sha);
            const known = b.mediaKnown.get(sha);
            return known ? json(200, { known }) : json(404, { error: 'unknown' });
        }
        if (url.pathname.endsWith('/status')) {
            return json(200, {
                tree: { id: UUID, name: 'Víškovi' }, head: b.head, links: b.links,
                accepts: b.accepts, inbox: { trees: b.inbox, material: 0 }, lastIntake: b.lastIntake,
                ...(b.batches ? { batches: b.batches } : {}),
                ...(b.strom ? { strom: b.strom } : {}),
                ...(b.waiting ? { waiting: b.waiting } : {}),
                ...(b.features ? { features: b.features } : {}),
                ...(b.accepts ? { sends: b.sends } : {}),
            });
        }
        // A send taken back, written again from what the research kept (1.12): like a write at once.
        const againPath = /\/sync\/([^/]+)\/again$/.exec(url.pathname);
        if (againPath && route.request().method() === 'POST') {
            const old = b.sends.find(r => r.intake === decodeURIComponent(againPath[1]));
            (b.againAsks ??= []).push(decodeURIComponent(againPath[1]));
            if (!old || old.state !== 'undone') return json(404, { error: 'no send taken back is kept here', code: 'send.none' });
            const intake = `R${Date.now()}-again`;
            const v = b.onWrite?.(old.sent);
            if (v) { b.head = v.head; b.treeGed = v.ged; }
            (old as { again?: string }).again = intake;
            b.sends.unshift({ intake, at: new Date().toISOString(), state: 'written', changes: 6, tree: old.tree, sent: old.sent, decidedAt: new Date().toISOString() });
            return json(200, { ok: true, inbox: false, changes: 6, applied: 6, intake, ...(v ? { head: v.head } : {}) });
        }
        if (url.pathname.endsWith('/sync') && route.request().method() === 'POST') {
            if (b.syncDelayMs) await new Promise(r => setTimeout(r, b.syncDelayMs));
            const body = route.request().postData() ?? '';
            b.posts.push(body);
            const sent = /1 _STROM_SENT (\S+)/.exec(body)?.[1] ?? '';
            const appTree = /1 _STROM_APP_TREE (\S+)/.exec(body)?.[1] ?? UUID;
            const intake = `R${Date.now()}-${b.posts.length}`;
            const reply = b.syncReply.body as { inbox?: boolean; pending?: boolean; head?: string };
            if (b.syncReply.status === 200 && reply.inbox === false && !reply.pending && b.onWrite) {
                // Written at once: the research has a new version, the reply names its commit.
                const v = b.onWrite(body);
                b.head = v.head;
                b.treeGed = v.ged;
                b.sends.unshift({ intake, at: new Date().toISOString(), state: 'written', changes: 6, tree: appTree, sent, decidedAt: new Date().toISOString() });
                return json(200, { ...reply, head: v.head, intake });
            }
            if (b.syncReply.status === 202 || reply.pending) {
                b.sends.unshift({ intake, at: new Date().toISOString(), state: 'pending', changes: 6, tree: appTree, sent });
            }
            if (b.syncReply.status === 200 && reply.inbox) {
                const at = new Date().toISOString();
                for (const rec of b.sends) if (rec.tree === appTree && rec.state === 'pending') rec.state = 'replaced';
                b.inbox = [{ tree: appTree, at, changes: 6, sent }];
                b.sends.unshift({ intake, at, state: 'pending', changes: 6, tree: appTree, sent });
            }
            return json(b.syncReply.status, b.syncReply.status < 300 ? { ...(b.syncReply.body as object), intake } : b.syncReply.body);
        }
        if (url.pathname.endsWith('/tree.ged')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: b.treeGed });
        }
        if (url.pathname.endsWith('/cancel')) return json(200, { ok: true });
        const done = /\/batch\/([^/]+)\/done$/.exec(url.pathname);
        if (done && route.request().method() === 'POST') {
            let body: Record<string, unknown> = {};
            try { body = JSON.parse(route.request().postData() ?? '{}'); } catch { /* keep empty */ }
            (b.batchDone ??= []).push({ id: decodeURIComponent(done[1]), body });
            const files = b.mediaPuts.filter(p => p.headers['x-strom-batch'] === decodeURIComponent(done[1])).length;
            return json(200, { batch: done[1], name: body.name, inputs: files, known: 0, refused: 0, nested: [], tasks: files ? ['T0101'] : [], head: b.head });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    return b;
}

/** The research opened in the app; its bridge remembered (as after a ?live= / ?send=); optionally changed. */
export async function openResearch(page: Page, opts: { edit?: boolean; bridge?: boolean; capable?: boolean; auto?: boolean; media?: boolean } = {}): Promise<void> {
    await openApp(page);
    await page.evaluate(() => {
        // Opening links in the system is not testable: record them instead.
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
    });
    await dropFile(page, 'tree-strom.ged', researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
    if (opts.bridge !== false) {
        // As after a ?live= / ?send= from a research that says what it takes.
        await page.evaluate(({ uuid, base, accepts }) => {
            localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, ...(accepts ? { accepts } : {}) }));
        }, { uuid: UUID, base: BRIDGE, accepts: opts.capable === false ? null : { sync: { auto: 'off' }, sources: true, verified: true, ...(opts.media ? { media: { max: 500 * 1024 * 1024, region: true } } : {}) } });
    }
    // These tests are about sending by hand (sending by itself: research-auto-send.spec.ts).
    if (!opts.auto) {
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            tm.patchResearchLink(tm.getActiveTreeId()!, { sendMode: 'manual' });
        });
    }
    if (opts.edit) await editJan(page);
}

export async function editJan(page: Page, place = 'Praha'): Promise<void> {
    await page.evaluate((place) => {
        const dm = window.Strom.DataManager;
        const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
        dm.updatePerson(jan.id, { birthPlace: place });
    }, place);
}

export const poll = (page: Page) => page.evaluate(() => window.Strom.UI.pollResearchBridge());
export const links = (page: Page) => page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links);

export async function openResearchMenu(page: Page): Promise<void> {
    await page.evaluate(() => {
        if (!document.getElementById('actions-menu-dropdown')?.classList.contains('active')) window.Strom.UI.toggleActionsMenu();
        window.Strom.UI.openActionsResearchSubmenu();
    });
}

export const block = (page: Page) => page.locator('#research-sync-block');
export const dot = (page: Page) => page.locator('#actions-menu-dot');
