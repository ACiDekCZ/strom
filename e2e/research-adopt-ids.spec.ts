import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * After "Start research with this tree": the copy in the app must name the
 * research's people (their REFN) in every later send, else the research reads
 * it as a second family tree (finding 23). Their numbers come from the
 * research's version loaded right after the hand-over, or from the hand-over's
 * answer (`ids`); without either nothing is sent until they come. The
 * research's bridge is answered by page.route. Invented data.
 */

const UUID = '5b7e2c10-3a4d-4f61-8e2b-9c0d1e2f3a4b';
const BRIDGE = 'http://127.0.0.1:5995/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const TOKEN_RE = /^strom-research:\/\/new\?app=([A-Za-z0-9_-]{43})$/;

/** The research's version of the tree it took: its own numbers, the same people. */
function researchVersion(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 3 OCT 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD abc1234', '1 CHAR UTF-8', '1 NOTE Test Win4',
        '0 @P0001@ INDI', '1 NAME 1 //', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME 2 //', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME 3 //', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 TRLR',
    ].join('\n');
}

/** Each person record of a GEDCOM: its name and REFN. */
function people(ged: string): { name: string; refn: string }[] {
    return ged.split(/\n(?=0 )/).filter(r => / INDI\b/.test(r.split('\n')[0]))
        .map(r => ({ name: /\n1 NAME ([^/\n]*)/.exec(r)?.[1].trim() ?? '', refn: /\n1 REFN (\S+)/.exec(r)?.[1] ?? '' }));
}

interface Bridge {
    /** `tree.ged` served (null: 404, as when it cannot be read yet). */
    treeGed: string | null;
    /** The hand-over's answer carries `ids` (Strom Research 1.12). */
    ids: boolean;
    /** The reply to the next sends (one per send; the last repeats). */
    syncReplies: { status: number; body: unknown }[];
    adopted: string[];
    posts: string[];
    gedAsks: number;
}

async function routeBridge(page: Page, token: string, init: Partial<Bridge> = {}): Promise<Bridge> {
    const b: Bridge = { treeGed: researchVersion(), ids: false, syncReplies: [{ status: 200, body: { ok: true, changes: 1, inbox: true } }],
        adopted: [], posts: [], gedAsks: 0, ...init };
    await page.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
        if (path.endsWith('/adopt') && req.method() === 'GET') return json(200, { token, name: 'Test Win4' });
        if (path.endsWith('/adopt') && req.method() === 'POST') {
            const ged = req.postData() ?? '';
            b.adopted.push(ged);
            // What each record of the file became: the research numbers them by name here.
            const persons: Record<string, string> = {};
            for (const rec of ged.split(/\n(?=0 )/)) {
                const m = /^0 (@I\d+@) INDI\n1 NAME (\d)/.exec(rec);
                if (m) persons[m[1]] = `P000${m[2]}`;
            }
            return json(200, { tree: UUID, head: 'abc1234', input: 'I0001', ...(b.ids ? { ids: { persons, sources: {} } } : {}) });
        }
        if (path.endsWith('/status')) {
            return json(200, { tree: { id: UUID, name: 'Test Win4' }, head: 'abc1234', links: ['send', 'open', 'new'],
                accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null }, inbox: { trees: [], material: 0 }, sends: [] });
        }
        if (path.endsWith('/tree.ged')) {
            b.gedAsks++;
            return b.treeGed === null
                ? route.fulfill({ status: 404, headers: cors, body: '' })
                : route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: b.treeGed });
        }
        if (path.endsWith('/sync') && req.method() === 'POST') {
            b.posts.push(req.postData() ?? '');
            const reply = b.syncReplies.length > 1 ? b.syncReplies.shift()! : b.syncReplies[0];
            return json(reply.status, reply.body);
        }
        if (path.endsWith('/cancel')) return json(200, {});
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    return b;
}

/** A new tree with "1", "2" and their child "3" (no dates), handed to the research; sending by hand. */
async function handOver(page: Page, init: Partial<Bridge> = {}): Promise<Bridge> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: ['new', 'send', 'open'], at: new Date().toISOString() }));
    });
    await openApp(page);
    await page.evaluate(async () => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
        const p = (id: string, firstName: string, gender: string, extra: Record<string, unknown> = {}) => ({
            id, firstName, lastName: '', gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
        });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                a: p('a', '1', 'male', { partnerships: ['u'], childIds: ['c'] }),
                b: p('b', '2', 'female', { partnerships: ['u'], childIds: ['c'] }),
                c: p('c', '3', 'male', { parentIds: ['a', 'b'] }),
            },
            partnerships: { u: { id: 'u', person1Id: 'a', person2Id: 'b', childIds: ['c'], status: 'married' } },
        }, 'Test Win4');
        window.Strom.UI.updateTreeSwitcher();
        window.Strom.UI.startResearchAdopt(window.Strom.DataManager.getCurrentTreeId());
    });
    const url = (await page.evaluate(() => (window as unknown as { __launched: string[] }).__launched))[0];
    const b = await routeBridge(page, url.match(TOKEN_RE)![1], init);
    await page.evaluate((base) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: base })), BRIDGE);
    await page.locator('#research-adopt-confirm').click();
    await expect(page.locator('.toast')).toContainText('Test Win4 is now linked to the research.');
    await page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        tm.patchResearchLink(tm.getActiveTreeId()!, { sendMode: 'manual' });
    });
    return b;
}

const refns = (page: Page) => page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons)
    .map((p: any) => `${p.firstName}:${p.refn ?? ''}`).sort());

async function renameOne(page: Page): Promise<void> {
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const one = Object.values(dm.getData().persons).find((p: any) => p.firstName === '1') as any;
        dm.updatePerson(one.id, { firstName: 'jedna' });
    });
}

const send = (page: Page) => page.evaluate(() => window.Strom.UI.researchSendNow());

const SENT_WITH_IDS = [{ name: 'jedna', refn: 'P0001' }, { name: '2', refn: 'P0002' }, { name: '3', refn: 'P0003' }];

test.describe('the research\'s numbers after a hand-over', () => {
    test('the sequence from Windows: the research\'s version back, a rename; the send names all three by REFN', async ({ page }) => {
        const b = await handOver(page);
        // The hand-over itself carries no numbers (a new tree).
        expect(people(b.adopted[0]).map(p => p.refn)).toEqual(['', '', '']);
        // Its version loaded right after the hand-over: the research's numbers here.
        expect(b.gedAsks).toBeGreaterThan(0);
        await expect.poll(() => refns(page)).toEqual(['1:P0001', '2:P0002', '3:P0003']);
        // The research opens its tree in the app too (?import-url=): nothing changes.
        await page.evaluate((u) => window.Strom.UI.openExternalRequest(new URLSearchParams({ 'import-url': u })), `${BRIDGE}/tree.ged`);
        await expect(page.locator('.toast')).toContainText('Test Win4');
        expect(await refns(page)).toEqual(['1:P0001', '2:P0002', '3:P0003']);
        await renameOne(page);
        await send(page);
        await expect.poll(() => b.posts.length).toBe(1);
        expect(people(b.posts[0])).toEqual(SENT_WITH_IDS);
        expect(b.posts[0]).toContain(`1 _STROM_TREE ${UUID}`);
    });

    test('its version cannot be read: the hand-over\'s ids number the people; the send names them', async ({ page }) => {
        const b = await handOver(page, { treeGed: null, ids: true });
        await expect.poll(() => refns(page)).toEqual(['1:P0001', '2:P0002', '3:P0003']);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.awaitingIds)).toBeUndefined();
        await renameOne(page);
        await send(page);
        await expect.poll(() => b.posts.length).toBe(1);
        expect(people(b.posts[0])).toEqual(SENT_WITH_IDS);
    });

    test('neither its version nor ids: nothing is sent, said why; "Load the research\'s version" numbers them, the rename kept, then it goes', async ({ page }) => {
        const b = await handOver(page, { treeGed: null });
        expect(await refns(page)).toEqual(['1:', '2:', '3:']);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.awaitingIds)).toBe(true);
        await renameOne(page);
        await send(page);
        const toast = page.locator('.toast', { hasText: 'Not sent.' });
        await expect(toast).toContainText('it would arrive there as a second family tree');
        expect(b.posts).toHaveLength(0);
        // The research's version can be read now.
        b.treeGed = researchVersion();
        await toast.getByRole('button', { name: "Load the research's version" }).click();
        await expect.poll(() => b.posts.length).toBe(1);
        expect(people(b.posts[0])).toEqual(SENT_WITH_IDS);
        expect(await refns(page)).toEqual(['2:P0002', '3:P0003', 'jedna:P0001']);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.awaitingIds)).toBeUndefined();
    });

    test('refused as a copy without the research\'s numbers (tree.no-ids): its version brings them, sent again once', async ({ page }) => {
        const b = await handOver(page, { syncReplies: [
            { status: 400, body: { error: 'tato kopie stromu nenese osoby výzkumu', code: 'tree.no-ids', text: 'This copy does not carry the research\'s people.' } },
            { status: 200, body: { ok: true, changes: 1, inbox: true } },
        ] });
        // As a copy handed over by beta.18 whose version never came: no numbers, nothing marked.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const data = structuredClone(dm.getData());
            for (const p of Object.values(data.persons) as any[]) { delete p.refn; delete p.refnType; }
            dm.replaceWithSourceData(data);
            const tm = window.Strom.TreeManager;
            tm.patchResearchLink(tm.getActiveTreeId()!, { fingerprint: 'x' });
        });
        await renameOne(page);
        await send(page);
        await expect.poll(() => b.posts.length).toBe(2);
        expect(people(b.posts[0]).map(p => p.refn)).toEqual(['', '', '']);
        expect(people(b.posts[1])).toEqual(SENT_WITH_IDS);
        await expect(page.locator('.toast')).toContainText('Sent to the research');
    });
});
