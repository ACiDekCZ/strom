import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';

/**
 * Following a research live: every section of the small panel folds on its
 * own (remembered, folded by itself when short of room, "Awaiting action"
 * never, and a new task unfolds it), the panel lists the last five changes;
 * the Research overview (⤢) beside the tree: the tree narrows, a summary,
 * Waiting cards with the person, Progress with filters, hover and "Show
 * changed in tree", Escape back to the panel. Tablet: over the tree; phone:
 * a strip that opens a sheet. Invented data only.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const BRIDGE = 'http://127.0.0.1:5996/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const ALL = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research',
    'new', 'update', 'sessions', 'conflict', 'story', 'sync-undo', 'setup', 'live'];

function ged(extra: boolean): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @S12@ SOUR', '1 TITL Křestní matrika Chlumy 1865', '1 REFN S0012',
        ...(extra ? ['0 @S31@ SOUR', '1 TITL Sčítání lidu 1880', '1 REFN S0031'] : []),
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0012@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '2 SOUR @S12@', '1 REFN P0012', '1 FAMC @F0001@',
        '1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 VAL 3 FEB 1865', '2 VAL 1866',
        ...(extra ? [
            '0 @P0004@ INDI', '1 NAME Ludmila /Víšková/', '1 SEX F', '1 REFN P0004', '1 FAMC @F0001@',
            '0 @P0005@ INDI', '1 NAME Marie /Víšková/', '1 SEX F', '1 REFN P0005', '1 FAMC @F0001@',
            '0 @P0006@ INDI', '1 NAME Karel /Víšek/', '1 SEX M', '1 REFN P0006', '1 FAMC @F0001@',
        ] : []),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@',
        ...(extra ? ['1 CHIL @P0004@', '1 CHIL @P0005@', '1 CHIL @P0006@'] : []),
        '0 TRLR',
    ].join('\n');
}

const CHANGE = [
    '+P0004 Ludmila /Víšková/ · E0006 BIRT 1868 [lead]',
    '+P0005 Marie /Víšková/',
    '+P0006 Karel /Víšek/',
    '+S0031 Sčítání lidu 1880',
    'P0012 _STORY navrh',
    'F0001 +child P0006',
];

/** A write to the bridge from "Awaiting action" (variant B). */
interface Write { method: string; path: string; body: string; headers: Record<string, string> }
interface Bridge {
    waiting: Record<string, unknown>[]; gedCalls: number; log: Record<string, unknown> | null; events: boolean; paused: Record<string, unknown> | null;
    workPerson: string; workDone: boolean; changeEntries: Record<string, unknown>[] | null; features?: string[]; recent?: Record<string, unknown>;
    spend?: Record<string, unknown>; accepts?: Record<string, unknown>;
    /** Every write it got (POST waiting / group, GET group note, PUT media). */
    writes: Write[];
    /** Refuse the writes so (a status and its code), or 'abort': no answer. */
    refuse?: { status: number; code: string } | 'abort';
    /** The text of a place's queries. */
    note?: Record<string, unknown>;
}

/** A bridge that sends one change of six lines, then keeps quiet. */
async function follow(page: Page, size: { width: number; height: number } = { width: 1440, height: 900 },
    setup: (b: Bridge) => void = () => {}): Promise<Bridge> {
    await page.setViewportSize(size);
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, ALL);
    const bridge: Bridge = {
        waiting: [
            { id: 'T0004', what: 'Uložte snímek oddací matriky', person: 'P0012', at: new Date().toISOString() },
            { id: 'T0005', what: 'Potvrďte otce Jana', at: new Date().toISOString() },
        ],
        gedCalls: 0,
        log: null,
        events: true,
        paused: null,
        workPerson: 'P0012',
        workDone: false,
        changeEntries: null,
        writes: [],
    };
    setup(bridge);
    const status = () => ({
        tree: { id: UUID, name: 'Víškovi' }, head: bridge.gedCalls > 1 ? 'h2' : 'h1', persons: 3,
        working: bridge.workDone ? [] : [{ who: 'agent-matriky', since: new Date(Date.now() - 16 * 60_000).toISOString(), ...(bridge.paused ? { paused: bridge.paused } : { task: 'Sčítání 1921', person: bridge.workPerson }) }],
        waiting: bridge.waiting, links: ALL,
        queue: [{ id: 'T0101', text: 'Matriky Chlumy', state: 'next', person: 'P0001' }, { id: 'T0102', text: 'Pozemková kniha', state: 'next' }],
        queueMore: 3,
        spend: bridge.spend ?? { month: '2026-09', sessions: 4, amount: 3.2, currency: 'USD' },
        ...(bridge.features ? { features: bridge.features } : {}),
        ...(bridge.recent ? { recent: bridge.recent } : {}),
        ...(bridge.accepts ? { accepts: bridge.accepts } : {}),
    });
    const json = (status: number, body: unknown) => ({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const sendable = (w: Record<string, unknown>) => w.phase !== 'sent' && ['letter', 'family', 'other'].includes(String(w.kind));
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        }
        if (path.endsWith('/tree.ged')) {
            bridge.gedCalls++;
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: ged(bridge.gedCalls > 1) });
        }
        if (path.endsWith('/log') && bridge.log) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(bridge.log) });
        }
        if (path.endsWith('/events')) {
            if (!bridge.events) return new Promise(() => {});
            const body = `event: hello\ndata: ${JSON.stringify(status())}\n\n`
                + `event: change\ndata: ${JSON.stringify({ head: 'h2', what: CHANGE, at: new Date().toISOString(), ...(bridge.changeEntries ? { entries: bridge.changeEntries } : {}) })}\n\n`;
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
        }
        // "Awaiting action" written through the bridge (variant B): what came is kept, the list follows.
        const req = route.request();
        if (req.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, PUT', 'access-control-allow-headers': '*' } });
        }
        const write = /\/(waiting\/T\d+|group\/[^/]+(?:\/note)?|media\/[0-9a-f]{64})$/.exec(path);
        if (write) {
            bridge.writes.push({ method: req.method(), path: write[1], body: req.postData() ?? '', headers: req.headers() });
            if (bridge.refuse === 'abort') return route.abort('connectionrefused');
            if (bridge.refuse) return route.fulfill(json(bridge.refuse.status, { error: 'refused', code: bridge.refuse.code }));
            if (write[1].startsWith('media/')) return route.fulfill(json(200, { input: 'I0042' }));
            if (write[1].endsWith('/note')) return route.fulfill(json(200, bridge.note ?? { text: '' }));
            const what = (JSON.parse(req.postData() || '{}') as { do?: string }).do;
            const at = new Date().toISOString();
            if (write[1].startsWith('waiting/')) {
                const w = bridge.waiting.find(x => x.id === write[1].slice('waiting/'.length));
                if (!w) return route.fulfill(json(404, { error: 'not waiting', code: 'waiting.none' }));
                if (what === 'sent') Object.assign(w, { phase: 'sent', sentAt: at });
                else { delete w.phase; delete w.sentAt; }
                return route.fulfill(json(200, { sent: [w.id] }));
            }
            const key = decodeURIComponent(write[1].slice('group/'.length));
            const marked = bridge.waiting.filter(w => (w.group as { key?: string } | undefined)?.key === key && sendable(w));
            for (const w of marked) Object.assign(w, { phase: 'sent', sentAt: at });
            return route.fulfill(json(200, { sent: marked.map(w => w.id) }));
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    return bridge;
}

const head = (page: Page, root: string, title: string) =>
    page.locator(`${root} .live-section__head`).filter({ has: page.locator('.live-section__title', { hasText: title }) });

test.describe('small live panel', () => {
    test('each section folds, the choice survives a reload; five changes and a way to all', async ({ page }) => {
        await follow(page);
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-changes li')).toHaveCount(5);
        // Newest first; the people in a change are links.
        await expect(panel.locator('.live-change-text .live-person-link').first()).toHaveText('Karel Víšek');
        await expect(panel.locator('.live-section__title')).toHaveText(['At work', 'Awaiting action · 2', 'Latest changes', 'Up next']);
        await expect(head(page, '#live-panel', 'At work').locator('.live-section__sum')).toHaveText(/agent-matriky · 1[67] min/);
        await expect(panel.locator('.live-working .live-time')).toHaveText(/^since (?:\S+ )?\d{1,2}:\d{2}.* · 1[67] min$/);   // a date before the time across midnight
        await expect(head(page, '#live-panel', 'Up next').locator('.live-section__sum')).toHaveText('5 tasks');

        // Folded for lack of room or not, Changes unfolds on a click; all changes are in the overview.
        const changes = head(page, '#live-panel', 'Latest changes');
        if (await changes.getAttribute('aria-expanded') === 'false') await changes.click();
        await expect(changes).toHaveAttribute('aria-expanded', 'true');
        await panel.locator('.live-all-changes').click();
        await expect(page.locator('#research-overview')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel).toBeVisible();

        // A click flips a section (folded by the panel itself or not) and is remembered.
        const work = head(page, '#live-panel', 'At work');
        const was = await work.getAttribute('aria-expanded');
        const now = was === 'true' ? 'false' : 'true';
        await work.click();
        await expect(work).toHaveAttribute('aria-expanded', now);
        await expect(page.locator(`#${await work.getAttribute('aria-controls')}`)).toBeVisible({ visible: now === 'true' });
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-live-sections') ?? '{}'))).toMatchObject({ working: now === 'false', changes: false });
        await page.reload();
        await expect(head(page, '#live-panel', 'At work')).toHaveAttribute('aria-expanded', now);
        await expect(head(page, '#live-panel', 'Awaiting action · 2')).toHaveAttribute('aria-expanded', 'true');
    });

    test('short of room: Up next, then Changes fold by themselves, Waiting never; a new task unfolds Waiting', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 520 });
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-changes li').first()).toBeAttached();
        await expect(head(page, '#live-panel', 'Up next')).toHaveAttribute('aria-expanded', 'false');
        await expect(head(page, '#live-panel', 'Awaiting action · 2')).toHaveAttribute('aria-expanded', 'true');
        // Folding by itself is not remembered.
        expect(await page.evaluate(() => localStorage.getItem('strom-live-sections'))).toBeNull();

        await head(page, '#live-panel', 'Awaiting action · 2').click();
        await expect(head(page, '#live-panel', 'Awaiting action · 2')).toHaveAttribute('aria-expanded', 'false');
        bridge.waiting = [...bridge.waiting, { id: 'T0009', what: 'Nový úkol', at: new Date().toISOString() }];
        await expect(head(page, '#live-panel', 'Awaiting action · 3')).toHaveAttribute('aria-expanded', 'true', { timeout: 15000 });
    });
});

test.describe('the research history (/log)', () => {
    test('opening the app shows what really happened, not only what came while watching', async ({ page }) => {
        const hour = 3600_000;
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.events = false;
            b.log = { entries: [
                { head: 'h2', at: new Date(Date.now() - 4 * 60_000).toISOString(), what: ['N0007 closed: T0134: hotovo'], task: '' },
                { head: 'h1', at: new Date(Date.now() - 5 * 60_000).toISOString(), what: ['+S0031 Sčítání lidu 1880', 'P0012 _STORY navrh'], task: 'T0134 Úmrtí Václava' },
                { head: 'h0', at: new Date(Date.now() - 30 * hour).toISOString(), what: ['+P0099 Starý /Záznam/'], task: '' },
            ] };
        });
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-changes li')).toHaveCount(4);
        // Newest first; within one version its last line first (as the changes that come live).
        await expect(panel.locator('.live-changes li')).toContainText(['N0007 closed', 'Jan Víšek', 'Sčítání lidu 1880', 'Starý Záznam']);
        // The history is not news: no "N new".
        await expect(panel.locator('.live-section__sum--new')).toHaveCount(0);
        await panel.locator('.live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__cell-label').nth(1)).toHaveText('Last 24 h');
        await expect(ov.locator('.research-overview__cell-value').nth(1)).toHaveText('+0 people');
        await expect(ov.locator('.research-overview__cell-sub').nth(1)).toHaveText('+1 source');
        await expect(ov.locator('.research-overview__cell-sub').first()).toHaveText(/^last change 4 min/);
        await expect(ov.locator('.research-overview__group-title').first()).toHaveText('T0134 Úmrtí Václava');
        // A preview of the last 24 hours: the older change is left to the research.
        // The session's closing line (no task of its own) joins the task it names.
        await expect(ov.locator('.research-overview__group-head')).toHaveCount(1);
        // A task nobody works on now is done: folded; a click opens it.
        await expect(ov.locator('.research-overview__group-head')).toHaveAttribute('aria-expanded', 'false');
        await expect(ov.locator('.research-overview__row')).toHaveCount(0);
        await ov.locator('.research-overview__group-head').click();
        await expect(ov.locator('.research-overview__row')).toHaveCount(3);
        await ov.locator('.research-overview__group-head').click();
        // A filter opens the groups: what it found is to be seen.
        await ov.locator('.research-overview__filter[data-filter="stories"]').click();
        await expect(ov.locator('.research-overview__row')).toHaveCount(1);
        await ov.locator('.research-overview__filter[data-filter="all"]').click();
        await expect(ov.locator('.research-overview__row')).toHaveCount(0);
        await expect(ov.locator('.research-overview__older')).toContainText('Older changes are in the research');
        // From the research's history the highlight says its window, not "while watching".
        await ov.locator('.research-overview__show-changed').click();
        await expect(page.locator('#evidence-pill')).toContainText('Changed people in the progress · 1');
    });

    // A busy research makes more commits in 24 hours than /log gives (500): the bridge counts them itself.
    const RECENT = {
        hours: 24, since: new Date(Date.now() - 24 * 3600_000).toISOString(), from: 'a0a0a0a0a0a0a0a0', head: 'b2b2b2b2b2b2b2b2',
        at: new Date(Date.now() - 2 * 60_000).toISOString(), commits: 978,
        persons: { added: 17, ids: ['P0102', 'P0103'] }, sources: { added: 4, ids: ['S0031'] },
    };
    const recentLog = () => ({ entries: [
        { head: 'c3c3c3c3c3c3c3c3', at: new Date(Date.now() - 60_000).toISOString(), what: ['+P0006 Karel /Víšek/'], task: '' },
        { head: 'b2b2b2b2b2b2b2b2', at: new Date(Date.now() - 3 * 60_000).toISOString(), what: ['+S0031 Sčítání lidu 1880', '+P0005 Marie /Víšková/'], task: '' },
        { head: 'a1a1a1a1a1a1a1a1', at: new Date(Date.now() - 5 * 60_000).toISOString(), what: ['+P0004 Ludmila /Víšková/'], task: '' },
    ] });

    test('last 24 hours: the bridge count, plus what came after it', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.events = false;
            b.features = ['status.recent'];
            b.recent = RECENT;
            b.log = recentLog();
        });
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__cell-label').nth(1)).toHaveText('Last 24 h');
        // 17 counted at b2…, and Karel came after it; the source of b2… is in the 4.
        await expect(ov.locator('.research-overview__cell-value').nth(1)).toHaveText('+18 people');
        await expect(ov.locator('.research-overview__cell-sub').nth(1)).toHaveText('+4 sources');
    });

    test('last 24 hours without the status.recent feature: counted from the history', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.events = false;
            b.recent = RECENT;
            b.log = recentLog();
        });
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__cell-label').nth(1)).toHaveText('Last 24 h');
        await expect(ov.locator('.research-overview__cell-value').nth(1)).toHaveText('+3 people');
        await expect(ov.locator('.research-overview__cell-sub').nth(1)).toHaveText('+1 source');
    });

    const READERS_SPEND = { month: '2026-10', sessions: 14, amount: 63.4, readers: 41.2, currency: 'USD' };

    test('this month: the scan readers part of the cost, from a bridge that counts them', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.events = false;
            b.features = ['spend.readers'];
            b.spend = READERS_SPEND;
        });
        await page.locator('#live-panel .live-panel-expand').click();
        const month = page.locator('#research-overview .research-overview__cell').filter({ hasText: 'This month' });
        await expect(month.locator('.research-overview__cell-value')).toHaveText('$63.40');
        await expect(month.locator('.research-overview__readers')).toHaveText('of it scan readers $41.20');
    });

    test('this month from an older bridge: the cost alone, no readers line', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.events = false;
            b.spend = READERS_SPEND;
        });
        await page.locator('#live-panel .live-panel-expand').click();
        const month = page.locator('#research-overview .research-overview__cell').filter({ hasText: 'This month' });
        await expect(month.locator('.research-overview__cell-value')).toHaveText('$63.40');
        await expect(month.locator('.research-overview__cell-sub')).toHaveCount(1);
        await expect(month.locator('.research-overview__readers')).toHaveCount(0);
    });

    test('the overview previews at most 20 steps, the rest is in the research', async ({ page }) => {
        const min = 60_000;
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.events = false;
            b.log = { entries: Array.from({ length: 25 }, (_, i) => ({
                head: `h${i}`, at: new Date(Date.now() - (i + 1) * 20 * min).toISOString(), what: [`+S${String(100 + i).padStart(4, '0')} Zdroj ${i}`], task: `T${1000 + i} Úkol ${i}`,
            })) };
        });
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__group-head')).toHaveCount(20);
        await expect(ov.locator('.research-overview__older')).toHaveCount(1);
    });
});

test.describe('the research says it in its language (text)', () => {
    test('the history shows the text, hides a commit with nothing to say, links the people', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.events = false;
            b.log = { entries: [
                { head: 'h3', at: new Date(Date.now() - 2 * 60_000).toISOString(), what: ['N0010 closed: T0200 · output/tree.ged'], task: 'T0200 Křty', text: [] },
                { head: 'h2', at: new Date(Date.now() - 3 * 60_000).toISOString(), what: ['+P0004 Ludmila /Víšková/'], task: 'T0200 Křty', text: ['Nová osoba: Jan Víšek (*1865) [P0012]'] },
            ] };
        });
        const rows = page.locator('#live-panel .live-changes li');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Nová osoba: Jan Víšek (*1865)');
        await expect(rows.first()).not.toContainText('[P0012]');
        await expect(rows.first().locator('.live-person-link')).toHaveText('Jan Víšek');
        await page.locator('#live-panel .live-panel-expand').click();
        // The count comes from what the commit added ("+P…"), not from the words.
        await expect(page.locator('#research-overview .research-overview__cell-value').nth(1)).toHaveText('+1 person');
    });

    test('a live change groups by the task of each of its commits', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.changeEntries = [
                { head: 'h2', at: new Date().toISOString(), what: ['+S0031 Sčítání lidu 1880'], task: 'T0300 Sčítání', text: ['Záznam z pramene: Sčítání lidu 1880'] },
                { head: 'h1b', at: new Date(Date.now() - 60_000).toISOString(), what: ['N0020 closed: T0299'], task: 'T0299 Matriky', text: ['Hotovo: Matriky'] },
            ];
        });
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__group-title')).toHaveText(['T0300 Sčítání', 'T0299 Matriky']);
    });
});

test.describe('back from another tree', () => {
    test('the overview open: the small panel stays hidden', async ({ page }) => {
        await follow(page);
        await page.locator('#live-panel .live-panel-expand').click();
        await expect(page.locator('#research-overview')).toBeVisible();
        await expect(page.locator('#live-panel')).toBeHidden();
        const research = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
        await page.evaluate(() => window.Strom.DataManager.createNewTree('Jiný'));
        await expect(page.locator('#research-overview')).toHaveCount(0);
        await page.evaluate((id) => window.Strom.UI.switchToTree(id as string), research);
        await expect(page.locator('#research-overview')).toBeVisible();
        await expect(page.locator('#live-panel')).toBeHidden();
    });
});

test.describe('the agent at work', () => {
    test('an arc circles the avatar of whom it works on now; its queue only in the tooltip', async ({ page }) => {
        // The arc's turning itself is checked here.
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        // Anna (no conflict of her own, which would come first) is worked on; Josef is only queued.
        await follow(page, { width: 1440, height: 900 }, (b) => { b.waiting = []; b.workPerson = 'P0002'; });
        const anna = card(page, 'Anna');
        const arc = anna.locator('.card-avatar-wrap .card-agent');
        await expect(arc).toHaveCount(1);
        await expect(arc).toHaveCSS('animation-name', 'agSpin');
        await expect(anna.locator('.card-signal')).toHaveCount(0);
        await expect(anna).toHaveAttribute('aria-label', /research is working on this person$/);
        await expect(anna.locator('.card-tooltip .tt-agent')).toHaveText('Research working: Sčítání 1921');
        const josef = card(page, 'Josef');
        await expect(josef.locator('.card-agent')).toHaveCount(0);
        await expect(josef.locator('.card-tooltip .tt-agent')).toHaveText('Queued: Matriky Chlumy');
        // Every arc turns in the same phase: the delay comes from one clock.
        expect(await arc.evaluate(el => (el as HTMLElement).style.animationDelay)).toMatch(/^-\d+ms$/);
    });

    test('the amber badge comes first: no arc, the agent in the tooltip', async ({ page }) => {
        // Jan has an open conflict.
        await follow(page, { width: 1440, height: 900 }, (b) => { b.waiting = []; });
        const jan = card(page, 'Jan');
        await expect(jan.locator('.card-tooltip .tt-agent')).toHaveText('Research working: Sčítání 1921');
        await expect(jan.locator('.card-signal')).toHaveText('≠');
        await expect(jan.locator('.card-agent')).toHaveCount(0);
    });

    test('reduced motion: the arc stands still but stays', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await follow(page, { width: 1440, height: 900 }, (b) => { b.waiting = []; b.workPerson = 'P0002'; });
        const arc = card(page, 'Anna').locator('.card-agent');
        await expect(arc).toBeVisible();
        await expect(arc).toHaveCSS('animation-name', 'none');
    });

    test('done: a check for a few seconds, then gone; none after a reload', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, (b) => { b.waiting = []; b.workPerson = 'P0002'; });
        const anna = card(page, 'Anna');
        await expect(anna.locator('.card-agent')).toHaveCount(1);
        bridge.workDone = true;
        const check = anna.locator('.card-signal.card-done');
        await expect(check).toHaveText('✓', { timeout: 6000 });
        await expect(anna.locator('.card-agent')).toHaveCount(0);
        await expect(check).toHaveCount(0, { timeout: 7000 });
        await page.reload();
        await expect(page.locator('#live-panel')).toBeVisible();
        await expect(card(page, 'Anna')).toBeVisible();
        await page.waitForTimeout(500);
        await expect(page.locator('.card-done')).toHaveCount(0);
    });

    test('done with a question for the user: straight to the amber badge', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, (b) => { b.waiting = []; b.workPerson = 'P0002'; });
        const anna = card(page, 'Anna');
        await expect(anna.locator('.card-agent')).toHaveCount(1);
        bridge.waiting = [{ id: 'T0009', what: 'Potvrďte Annin rok narození', person: 'P0002', at: new Date().toISOString() }];
        bridge.workDone = true;
        await expect(anna.locator('.card-signal')).toHaveText('!', { timeout: 6000 });
        await expect(anna.locator('.card-done')).toHaveCount(0);
    });

    test('compact and far zoom: a ring on the card corner, at least 8px on screen', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => { b.waiting = []; b.workPerson = 'P0002'; });
        await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
        const ring = card(page, 'Anna').locator('.card-agent-dot');
        await expect(ring).toBeVisible();
        // (Its own box: the turning ring's bounding box grows with the rotation.)
        const onScreen = () => ring.evaluate(el => (el as HTMLElement).offsetWidth * window.Strom.ZoomPan.getScale());
        // (Polled: a redraw may swap the card between two reads.)
        await expect.poll(() => ring.evaluate(el => (el as HTMLElement).offsetWidth)).toBe(12);
        await page.evaluate(() => window.Strom.UI.setCardDensity('normal'));
        await expect.poll(async () => {
            await page.evaluate(() => window.Strom.ZoomPan.zoomOut());
            await page.waitForTimeout(260);
            return page.evaluate(() => window.Strom.ZoomPan.getScale());
        }, { timeout: 10000 }).toBeLessThan(0.55);
        await expect(card(page, 'Anna').locator('.card-agent')).toBeHidden();
        await expect(ring).toBeVisible();
        await expect.poll(onScreen).toBeGreaterThanOrEqual(7.9);
    });
});

test.describe('a run waiting for its gate', () => {
    test('is paused, not working: when it goes on, and no agent arc (a queued person gets none either)', async ({ page }) => {
        const until = new Date(Date.now() + 90 * 60_000);
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.waiting = [];
            b.paused = { until: until.toISOString(), reason: 'Claude usage 92 %' };
        });
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-paused')).toContainText('Paused · Claude usage 92 % · resumes at');
        await panel.locator('.live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__cell').first()).toHaveClass(/is-paused/);
        await expect(ov.locator('.research-overview__cell-value').first()).toHaveText('Paused');
        await expect(ov.locator('.research-overview__cell-sub').first()).toHaveText(/^resumes at /);
        await expect(page.locator('.person-card .card-agent')).toHaveCount(0);
        await expect(page.locator('.person-card .card-done')).toHaveCount(0);
    });
});

test.describe('Research overview', () => {
    test('desktop: beside a narrower tree; summary, waiting, progress, filters, hover, changed, Escape', async ({ page }) => {
        await follow(page);
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-changes li')).toHaveCount(5);
        const before = await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width);
        const midBefore = await page.evaluate(() => {
            const { width, height } = window.Strom.ZoomPan.getViewportSize();
            const t = window.Strom.ZoomPan.getTransform();
            return [(width / 2 - t.tx) / t.scale, (height / 2 - t.ty) / t.scale];
        });

        await panel.locator('.live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        await expect(ov).toHaveAttribute('role', 'complementary');
        await expect(panel).toBeHidden();
        const after = await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width);
        expect(after).toBeLessThan(before - 400);
        // The point in the middle of the view stays in the middle.
        const midAfter = await page.evaluate(() => {
            const { width, height } = window.Strom.ZoomPan.getViewportSize();
            const t = window.Strom.ZoomPan.getTransform();
            return [(width / 2 - t.tx) / t.scale, (height / 2 - t.ty) / t.scale];
        });
        expect(Math.abs(midAfter[0] - midBefore[0])).toBeLessThan(2);
        expect(Math.abs(midAfter[1] - midBefore[1])).toBeLessThan(2);

        await expect(ov.locator('.research-overview__cell-value')).toHaveText(['Working', '+3 people', '$3.20']);
        // The state says when the research last changed; its version only on hover.
        const stateSub = ov.locator('.research-overview__cell-sub').first();
        await expect(stateSub).toHaveText(/^last change (just now|\d+ min)/);
        await expect(stateSub).toHaveAttribute('title', /· Research version h2$/);
        await expect(ov.locator('.research-overview__cell-sub').nth(1)).toHaveText(/^\+1 source · since \d{1,2}:\d{2}/);
        // An older research (no waiting.groups): compact rows in its order, no chips or phases.
        const rows = ov.locator('.research-overview__waiting-item');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0).locator('.research-overview__waiting-who')).toHaveText('Jan Víšek');
        await expect(rows.nth(1)).toContainText('whole research');
        await expect(ov.locator('.research-overview__waiting-filters')).toHaveCount(0);
        await expect(ov.locator('.research-overview__phase-head')).toHaveCount(0);
        await expect(ov.locator('.research-overview__waiting-detail')).toHaveCount(0);
        await rows.nth(0).locator('.research-overview__waiting-row').click();
        await expect(rows.nth(0).locator('.research-overview__waiting-detail .live-person-link')).toHaveText('Jan Víšek');
        // Without actions from the research: only "Answer ↗", as before; no hint.
        await expect(rows.nth(0).locator('.research-overview__waiting-action')).toHaveText(['Answer ↗']);
        await expect(rows.nth(0).locator('.research-overview__waiting-hint')).toHaveCount(0);
        await expect(ov.locator('.research-overview__now-row')).toContainText('agent-matriky — Sčítání 1921');
        await expect(ov.locator('.research-overview__now-row .link-button')).toHaveText('Show in tree');

        // Progress: one group (the task), every change; the filters count and filter.
        await expect(ov.locator('.research-overview__group-head')).toHaveCount(1);
        await expect(ov.locator('.research-overview__group-title')).toHaveText('Sčítání 1921');
        // The task the agent works on now stays open.
        await expect(ov.locator('.research-overview__group-head')).toHaveAttribute('aria-expanded', 'true');
        await expect(ov.locator('.research-overview__row')).toHaveCount(6);
        await expect(ov.locator('.research-overview__filter')).toHaveText(['All 6', 'People 4', 'Sources 1', 'Stories 1']);
        await ov.locator('.research-overview__filter[data-filter="sources"]').click();
        await expect(ov.locator('.research-overview__row')).toHaveCount(1);
        await expect(ov.locator('.research-overview__filter[data-filter="sources"]')).toHaveAttribute('aria-checked', 'true');
        await ov.locator('.research-overview__filter[data-filter="all"]').click();

        // Hovering a row lights its card up.
        await ov.locator('.research-overview__row.has-person', { hasText: 'Ludmila' }).hover();
        await expect(card(page, 'Ludmila')).toHaveClass(/overview-hover/);
        await ov.locator('.research-overview__head').hover();
        await expect(page.locator('.person-card.overview-hover')).toHaveCount(0);

        // Queue and What the research knows start folded.
        await expect(head(page, '#research-overview', 'Queue')).toHaveAttribute('aria-expanded', 'false');
        await expect(head(page, '#research-overview', 'What the research knows').locator('.live-section__sum')).toHaveText('1 conflict');

        await ov.locator('.research-overview__show-changed').click();
        await expect(page.locator('#evidence-pill')).toContainText('Changed people in the progress · 4');
        await expect(card(page, 'Ludmila')).toHaveClass(/evidence-hit/);
        await expect(card(page, 'Josef')).toHaveClass(/evidence-dim/);
        // A filter narrows the people shown in the tree (Stories: whose story changed).
        await ov.locator('.research-overview__filter[data-filter="stories"]').click();
        await expect(page.locator('#evidence-pill')).toContainText('Changed people in the progress · Stories · 1');
        await expect(card(page, 'Ludmila')).toHaveClass(/evidence-dim/);
        await ov.locator('.research-overview__filter[data-filter="all"]').click();
        await expect(page.locator('#evidence-pill')).toContainText('Changed people in the progress · 4');
        await expect(ov).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#evidence-pill')).toHaveCount(0);
        await expect(ov).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(ov).toHaveCount(0);
        await expect(panel).toBeVisible();
        await expect(panel).not.toHaveClass(/ended/);
        expect(await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(before, 0);
    });

    test('the overview opens again with the next following; the Research menu has it', async ({ page }) => {
        await follow(page);
        await page.locator('#live-panel .live-panel-expand').click();
        await expect(page.locator('#research-overview')).toBeVisible();
        await page.reload();
        await expect(page.locator('#research-overview')).toBeVisible();
        await page.locator('#research-overview .research-overview__close').click();
        await expect(page.locator('#research-overview')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.openResearchMenu());
        await page.evaluate(() => window.Strom.UI.refreshResearchMenu());
        await page.evaluate(() => window.Strom.UI.researchActionOverview());
        await expect(page.locator('#research-overview')).toBeVisible();
        await expect(page.locator('#research-item-overview')).toHaveCount(1);
        // Already following: no "Follow live".
        await expect(page.locator('#research-item-live')).toHaveCount(0);
    });

    test('switching the language redraws the panel and the overview', async ({ page }) => {
        await follow(page);
        await expect(page.locator('#live-panel .live-changes li')).toHaveCount(5);
        await page.evaluate(() => window.Strom.UI.setLanguage('cs'));
        await expect(page.locator('#live-panel .live-section__title').first()).toHaveText('Pracuje se');
        await page.locator('#live-panel .live-panel-expand').click();
        await expect(page.locator('#research-overview .research-overview__title')).toHaveText('Přehled výzkumu');
        await page.evaluate(() => window.Strom.UI.setLanguage('de'));
        await expect(page.locator('#research-overview .research-overview__title')).toHaveText('Forschungsübersicht');
        await expect(page.locator('#research-overview .research-overview__filter').first()).toHaveText('Alle 6');
    });

    test('tablet: over the tree, the tree keeps its width', async ({ page }) => {
        await follow(page, { width: 1024, height: 768 });
        const before = await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width);
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--overlay/);
        expect(await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width)).toBe(before);
        expect((await ov.boundingBox())!.width).toBe(400);
    });

    test('phone: a strip; a tap opens the sheet; a person closes it', async ({ page }) => {
        await follow(page, { width: 360, height: 780 });
        const panel = page.locator('#live-panel');
        await expect(panel).toHaveClass(/phone-strip/);
        await expect(panel.locator('.live-panel-summary')).toContainText('Working');
        await expect(panel.locator('.live-panel-summary')).toContainText('Awaiting action 2');
        await expect(panel.locator('.live-panel-expand')).toHaveCount(0);
        await panel.locator('.live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        await expect(ov).toHaveAttribute('aria-modal', 'true');
        await ov.locator('.research-overview__waiting-row').first().click();
        await expect(ov.locator('.live-waiting-answer')).toHaveCount(0);
        await expect(ov.locator('.research-overview__waiting-detail')).toContainText('answered in the research on the computer');
        await ov.locator('.research-overview__row .live-person-link', { hasText: 'Karel Víšek' }).first().click();
        await expect(ov).toHaveCount(0);
        await expect(card(page, 'Karel')).toBeVisible();
    });
});

/**
 * A research with `waiting.groups` (Strom Research 1.13.2-beta.13): 35 items
 * in four places, to do and sent, in the research's order. Invented archives,
 * offices and webs.
 */
function groupedWaiting(): Record<string, unknown>[] {
    const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    const out: Record<string, unknown>[] = [];
    const web = { key: 'host:rodokmen.example', name: 'rodokmen.example', kind: 'web' };
    const archive = { key: 'repo:R0001', name: 'Archiv Vzorov', kind: 'archive' };
    const office = { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' };
    const family = { key: 'family', name: 'Rodina', kind: 'family' };
    const push = (item: Record<string, unknown>) => out.push({ order: out.length, at: day(20 - out.length / 2), ...item });
    let n = 1;
    const id = () => `T${String(n++).padStart(4, '0')}`;
    push({ id: id(), what: 'Ověřit, zda badatelna funguje', kind: 'check', section: 'decide', group: web, url: 'https://rodokmen.example/badatelna', actions: ['answer'] });
    for (let i = 0; i < 6; i++) {
        push({ id: id(), what: `Dohledat sňatek ${i + 1} na https://rodokmen.example/hledat?q=${i + 1}.`, kind: 'web', section: 'web', group: web,
            url: `https://rodokmen.example/zaznam/${i + 1}`, actions: ['answer', 'chat'] });
    }
    for (let i = 0; i < 10; i++) {
        push({ id: id(), what: `Uložit snímky matriky Vzorov ${i + 1}`, kind: 'images', section: 'images', group: archive, person: i === 0 ? 'P0012' : undefined,
            inbox: { dir: `inbox/T${i}`, have: 3, want: 10 }, actions: ['folder', 'chat'] });
    }
    for (let i = 0; i < 6; i++) {
        push({ id: id(), what: `Napsat matrice o zápis ${i + 1}`, kind: 'letter', section: 'letter', group: office, to: 'MěÚ Vzorov',
            note: `notes/T${i}-dotaz.md`, actions: ['answer', 'file', 'note', 'sent', 'chat'] });
    }
    for (let i = 0; i < 7; i++) {
        push({ id: id(), what: `Zeptat se rodiny na fotografii ${i + 1}`, kind: 'family', section: 'family', group: family, actions: ['answer', 'file'] });
    }
    for (let i = 0; i < 3; i++) {
        push({ id: id(), what: `Odeslaný dopis ${i + 1}`, kind: 'letter', section: 'letter', group: office, phase: 'sent', sentAt: day(9),
            actions: ['answer', 'file', 'chat'] });
    }
    for (let i = 0; i < 2; i++) {
        push({ id: id(), what: `Odeslaný dotaz rodině ${i + 1}`, kind: 'family', section: 'family', group: family, phase: 'sent', sentAt: day(4),
            actions: ['answer', 'file'] });
    }
    return out;
}

const grouped = (b: Bridge) => { b.features = ['waiting.groups']; b.waiting = groupedWaiting(); };

async function recordLaunches(page: Page): Promise<void> {
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}
const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

test.describe('Awaiting action from a research with waiting.groups', () => {
    test('the small panel: the first five to do with their kind, the rest in the overview', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, grouped);
        const panel = page.locator('#live-panel');
        const waiting = head(page, '#live-panel', 'Awaiting action · 30');
        await expect(waiting).toBeVisible();
        await expect(waiting.locator('.live-section__sum')).toHaveText('awaiting a reply 5');
        const rows = panel.locator('.live-waiting-row');
        await expect(rows).toHaveCount(5);
        await expect(rows.first().locator('.live-kind')).toHaveText('Decision');
        await expect(rows.nth(1).locator('.live-kind')).toHaveText('Web');
        await expect(rows.first()).toContainText('Ověřit, zda badatelna funguje');
        const more = panel.locator('.live-waiting-more');
        await expect(more).toHaveText('25 more in the overview ⤢');
        await more.click();
        await expect(page.locator('#research-overview')).toBeVisible();
        // The menu counts what is to do.
        await page.keyboard.press('Escape');
        await panel.locator('.live-panel-toggle').click();
        await expect(page.locator('#research-menu-signal')).toHaveText('30');
    });

    test('overview: chips, phases, groups by place, one detail with its actions', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, grouped);
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        await recordLaunches(page);
        const section = head(page, '#research-overview', 'Awaiting action · 30');
        await expect(section.locator('.live-section__sum')).toHaveText('awaiting a reply 5');
        await expect(ov.locator('.research-overview__waiting-filters .research-overview__filter'))
            .toHaveText(['All 35', 'Decisions 1', 'Images 10', 'Archives and offices 9', 'Family 9', 'Web 6']);

        // To do open, Awaiting a reply folded; the places folded with their counts, in the research's order.
        const todo = ov.locator('.research-overview__phase-head[data-phase="todo"]');
        const sent = ov.locator('.research-overview__phase-head[data-phase="sent"]');
        await expect(todo).toHaveText(/To do · 30/);
        await expect(todo).toHaveAttribute('aria-expanded', 'true');
        await expect(sent).toHaveText(/Awaiting a reply · 5/);
        await expect(sent).toHaveAttribute('aria-expanded', 'false');
        const groups = ov.locator('.research-overview__phase[data-phase="todo"] .research-overview__waiting-group');
        await expect(groups.locator('.research-overview__group-title')).toHaveText(['rodokmen.example', 'Archiv Vzorov', 'MěÚ Vzorov', 'Rodina']);
        await expect(groups.locator('.research-overview__group-span')).toHaveText(['7', '10', '6', '7']);
        await expect(groups.locator('.research-overview__group-kind')).toHaveText(['Web', 'Archive', 'Office', 'Family']);
        await expect(groups.first()).toHaveAttribute('aria-expanded', 'false');
        await expect(ov.locator('.research-overview__waiting-item')).toHaveCount(0);

        // A place's own "Chat ↗", folded or not: the first item in order that offers a chat
        // (the check before it does not); none where no item offers one (the family).
        const heads = ov.locator('.research-overview__phase[data-phase="todo"] .research-overview__waiting-grouphead');
        const groupChat = heads.locator('.research-overview__waiting-groupchat');
        await expect(groupChat).toHaveCount(3);
        await expect(heads.nth(0).locator('.research-overview__waiting-groupchat')).toHaveAttribute('data-task', 'T0002');
        await expect(heads.nth(1).locator('.research-overview__waiting-groupchat')).toHaveAttribute('data-task', 'T0008');
        await expect(heads.nth(2).locator('.research-overview__waiting-groupchat')).toHaveAttribute('data-task', 'T0018');
        await expect(heads.nth(3).locator('.research-overview__waiting-groupchat')).toHaveCount(0);
        // A bridge without waiting.sent / waiting.note: no place's Sent, no queries' text.
        await expect(ov.locator('.research-overview__waiting-groupwrite')).toHaveCount(0);
        await heads.nth(0).locator('.research-overview__waiting-groupchat').click();
        await expect(groups.first()).toHaveAttribute('aria-expanded', 'false');
        expect(await launched(page)).toEqual([`strom-research://task?tree=${UUID}&task=T0002&do=chat`]);
        await page.evaluate(() => { (window as unknown as { __launched: string[] }).__launched.length = 0; });

        // A place unfolds to its items: compact rows with the kind.
        await groups.nth(1).click();
        const items = ov.locator('.research-overview__waiting-item');
        await expect(items).toHaveCount(10);
        await expect(items.first().locator('.live-kind')).toHaveText('Images');
        await expect(items.first().locator('.research-overview__waiting-who')).toHaveText('Jan Víšek');
        await items.first().locator('.research-overview__waiting-row').click();
        await expect(items.first().locator('.research-overview__waiting-row')).toHaveAttribute('aria-expanded', 'true');
        const detail = items.first().locator('.research-overview__waiting-detail');
        await expect(detail.locator('.research-overview__waiting-inbox')).toHaveText('saved 3/10');
        // Images are saved by hand: Chat leads, as the detail's main button; nothing to answer, no hint.
        await expect(detail.locator('.research-overview__waiting-action')).toHaveText(['Chat ↗', 'Folder ↗']);
        const imagesChat = detail.locator('.research-overview__waiting-action[data-action="chat"]');
        await expect(imagesChat).toBeVisible();
        await expect(imagesChat).toHaveClass(/is-primary/);
        await expect(detail.locator('.research-overview__waiting-hint')).toHaveCount(0);
        await imagesChat.click();
        expect(await launched(page)).toEqual([`strom-research://task?tree=${UUID}&task=T0008&do=chat`]);
        await page.evaluate(() => { (window as unknown as { __launched: string[] }).__launched.length = 0; });

        // Another place: a letter; one detail at a time; Chat right next to Answer.
        await groups.nth(2).click();
        const letter = ov.locator('.research-overview__waiting-item', { hasText: 'Napsat matrice o zápis 1' });
        await letter.locator('.research-overview__waiting-row').click();
        await expect(ov.locator('.research-overview__waiting-detail')).toHaveCount(1);
        const actions = letter.locator('.research-overview__waiting-action');
        await expect(actions).toHaveText(['Answer ↗', 'Chat ↗', 'Add a file ↗', 'Query text ↗', 'Sent ↗']);
        await expect(actions.nth(1)).toBeVisible();
        await expect(actions.nth(1)).not.toHaveClass(/is-primary/);
        await expect(letter.locator('.research-overview__waiting-hint')).toHaveText('The answer is saved with the task; the agent takes it up in its next work.');
        await expect(letter.locator('.research-overview__waiting-on')).toContainText('to: MěÚ Vzorov');
        const task = await letter.getAttribute('data-id');
        await actions.nth(0).click();
        await actions.nth(1).click();
        await actions.nth(3).click();
        await actions.nth(4).click();
        expect(await launched(page)).toEqual([
            `strom-research://task?tree=${UUID}&task=${task}`,
            `strom-research://task?tree=${UUID}&task=${task}&do=chat`,
            `strom-research://task?tree=${UUID}&task=${task}&do=note`,
            `strom-research://task?tree=${UUID}&task=${task}&do=sent`,
        ]);

        // A web item: its address opens in a new tab; addresses in the text are links.
        await groups.nth(0).click();
        const webItem = ov.locator('.research-overview__waiting-item', { hasText: 'Dohledat sňatek 1' });
        await webItem.locator('.research-overview__waiting-row').click();
        const web = webItem.locator('a.research-overview__waiting-web');
        await expect(web).toHaveText('Open website ↗');
        await expect(web).toHaveAttribute('href', 'https://rodokmen.example/zaznam/1');
        await expect(web).toHaveAttribute('target', '_blank');
        await expect(web).toHaveAttribute('rel', 'noopener noreferrer');
        const inText = webItem.locator('.research-overview__waiting-text a.live-text-link');
        await expect(inText).toHaveText('https://rodokmen.example/hledat?q=1');
        await expect(inText).toHaveAttribute('href', 'https://rodokmen.example/hledat?q=1');
        await expect(inText).toHaveAttribute('rel', 'noopener noreferrer');
        // The row itself holds no link (the text is clamped there).
        await expect(webItem.locator('.research-overview__waiting-row a')).toHaveCount(0);

        // Awaiting a reply: unfolds to its places; the rows say when they were sent.
        await sent.click();
        await expect(sent).toHaveAttribute('aria-expanded', 'true');
        const sentGroups = ov.locator('.research-overview__phase[data-phase="sent"] .research-overview__waiting-group');
        await expect(sentGroups.locator('.research-overview__group-title')).toHaveText(['MěÚ Vzorov', 'Rodina']);
        await sentGroups.first().click();
        const sentRows = ov.locator('.research-overview__phase[data-phase="sent"] .research-overview__waiting-item');
        await expect(sentRows).toHaveCount(3);
        await expect(sentRows.first().locator('.research-overview__waiting-sent')).toHaveText(/^sent \d{1,2}\/\d{1,2}$/);
        await expect(sentRows.first().locator('.research-overview__waiting-age')).toHaveText('9 days ago');
        await sentRows.first().locator('.research-overview__waiting-row').click();
        // What was sent is not marked sent again.
        await expect(sentRows.first().locator('.research-overview__waiting-action')).toHaveText(['Answer ↗', 'Chat ↗', 'Add a file ↗']);
    });

    test('a chip filters and unfolds every place; the choice stays; a new item hidden by it dots its chip', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, grouped);
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        const chip = (f: string) => ov.locator(`.research-overview__waiting-filters .research-overview__filter[data-filter="${f}"]`);
        await chip('family').click();
        await expect(chip('family')).toHaveAttribute('aria-checked', 'true');
        // One place, unfolded; what was sent stays folded.
        await expect(ov.locator('.research-overview__phase[data-phase="todo"] .research-overview__waiting-group')).toHaveText(/Rodina/);
        await expect(ov.locator('.research-overview__phase[data-phase="todo"] .research-overview__waiting-group')).toHaveAttribute('aria-expanded', 'true');
        await expect(ov.locator('.research-overview__waiting-item')).toHaveCount(7);
        await expect(ov.locator('.research-overview__phase-head[data-phase="sent"]')).toHaveText(/Awaiting a reply · 2/);
        expect(await page.evaluate(() => localStorage.getItem('strom-live-overview-waiting-filter'))).toBe('family');

        // A new image task: the Images chip gets a dot while Family hides it.
        await expect(chip('images')).not.toHaveClass(/has-new/);
        bridge.waiting = [...bridge.waiting, {
            id: 'T0099', what: 'Uložit nový snímek', kind: 'images', section: 'images', order: 99,
            group: { key: 'repo:R0001', name: 'Archiv Vzorov', kind: 'archive' }, at: new Date().toISOString(),
        }];
        await expect(chip('images')).toHaveClass(/has-new/, { timeout: 15000 });
        await expect(chip('images')).toHaveText('Images 11');
        await expect(chip('family')).not.toHaveClass(/has-new/);
        // Shown: the dot goes, and its place is open.
        await chip('images').click();
        await expect(chip('images')).not.toHaveClass(/has-new/);
        await expect(ov.locator('.research-overview__waiting-item.is-fresh')).toHaveText(/Uložit nový snímek/);
        await chip('all').click();
        await expect(ov.locator('.research-overview__waiting-group', { hasText: 'Archiv Vzorov' })).toHaveAttribute('aria-expanded', 'true');
        await expect(ov.locator('.research-overview__waiting-group', { hasText: 'Rodina' }).first()).toHaveAttribute('aria-expanded', 'false');

        // A filter whose last item went falls back to All.
        await chip('decide').click();
        bridge.waiting = bridge.waiting.filter(w => w.kind !== 'check');
        await expect(chip('decide')).toHaveCount(0, { timeout: 15000 });
        await expect(chip('all')).toHaveAttribute('aria-checked', 'true');
    });

    test('phone: the sheet has no ways into the research on the computer, only the website', async ({ page }) => {
        await follow(page, { width: 360, height: 780 }, grouped);
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-panel-summary')).toContainText('Awaiting action 30');
        await panel.locator('.live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        const filters = ov.locator('.research-overview__waiting-filters');
        await expect(filters).toHaveCSS('overflow-x', 'auto');
        await ov.locator('.research-overview__waiting-group').first().click();
        await ov.locator('.research-overview__waiting-item', { hasText: 'Dohledat sňatek 1' }).locator('.research-overview__waiting-row').click();
        const detail = ov.locator('.research-overview__waiting-detail');
        await expect(detail.locator('.research-overview__waiting-action')).toHaveCount(0);
        await expect(detail.locator('.research-overview__waiting-hint')).toHaveCount(0);
        await expect(ov.locator('.research-overview__waiting-groupchat')).toHaveCount(0);
        await expect(detail.locator('a.research-overview__waiting-web')).toHaveText('Open website ↗');
        await expect(detail).toContainText('answered in the research on the computer');
    });
});

/**
 * Written through the bridge (variant B): Sent for an item (Undo, Back to To
 * do), Sent for a place, the queries' text with Copy, a file for a task; a
 * refused write puts the row back. Only what the bridge announces.
 */
const writable = (features: string[], accepts?: Record<string, unknown>) => (b: Bridge) => {
    grouped(b);
    b.features = ['waiting.groups', ...features];
    if (accepts) b.accepts = accepts;
    b.note = {
        text: 'Vážený úřade,\nprosím o výpisy z matriky Vzorov:\n\n1. sňatek 1885\n2. narození 1890',
        notes: ['notes/T0-dotaz.md', 'notes/T1-dotaz.md'], tasks: ['T0018', 'T0019', 'T0020', 'T0021', 'T0022', 'T0023'],
    };
};

async function openOverview(page: Page) {
    await page.locator('#live-panel .live-panel-expand').click();
    const ov = page.locator('#research-overview');
    await expect(ov).toBeVisible();
    await recordLaunches(page);
    return ov;
}

const todoHead = (page: Page) => page.locator('#research-overview .research-overview__phase-head[data-phase="todo"]');
const sentHead = (page: Page) => page.locator('#research-overview .research-overview__phase-head[data-phase="sent"]');
const placeHead = (page: Page, phase: string, name: string) => page.locator(`#research-overview .research-overview__phase[data-phase="${phase}"] .research-overview__waiting-grouphead`)
    .filter({ has: page.locator('.research-overview__group-title', { hasText: name }) });

async function openLetter(page: Page, text = 'Napsat matrice o zápis 1') {
    const ov = page.locator('#research-overview');
    await placeHead(page, 'todo', 'MěÚ Vzorov').locator('.research-overview__waiting-group').click();
    const item = ov.locator('.research-overview__waiting-item', { hasText: text });
    await item.locator('.research-overview__waiting-row').click();
    return item;
}

test.describe('Awaiting action written through the bridge', () => {
    test('Sent at an item: one write, the row in Awaiting a reply at once, Undo; Back to To do at a sent one', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, writable(['waiting.sent']));
        const ov = await openOverview(page);
        const letter = await openLetter(page);
        // Sent goes through the bridge (no ↗); the file still by the link (no accepts.media.task).
        const actions = letter.locator('.research-overview__waiting-action');
        await expect(actions).toHaveText(['Answer ↗', 'Chat ↗', 'Add a file ↗', 'Query text ↗', 'Sent']);
        const sent = letter.locator('.research-overview__waiting-action[data-action="sent"]');
        await expect(sent).toHaveAttribute('data-write', 'bridge');
        // A double click writes once.
        await sent.evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
        await expect(todoHead(page)).toHaveText(/To do · 29/);
        await expect(sentHead(page)).toHaveText(/Awaiting a reply · 6/);
        await expect(head(page, '#research-overview', 'Awaiting action · 29')).toBeVisible();
        const toast = page.locator('.toast[data-kind="waiting-sent"]');
        await expect(toast).toContainText(/^Recorded as sent on \d{1,2}\/\d{1,2}/);
        expect(bridge.writes.map(w => [w.method, w.path, w.body])).toEqual([['POST', 'waiting/T0018', '{"do":"sent"}']]);
        expect(bridge.writes[0].headers['content-type']).toMatch(/^text\/plain/);
        expect(await launched(page)).toEqual([]);
        // The menu counts what is left to do.
        await expect(page.locator('#research-menu-signal')).toHaveText('29');

        // Undo: back to do.
        await toast.locator('.toast-action', { hasText: 'Undo' }).click();
        await expect(todoHead(page)).toHaveText(/To do · 30/);
        await expect(page.locator('.toast[data-kind="waiting-unsent"]')).toHaveText('Back in To do');
        expect(bridge.writes.map(w => [w.path, w.body])).toEqual([['waiting/T0018', '{"do":"sent"}'], ['waiting/T0018', '{"do":"unsent"}']]);

        // A sent item offers Back to To do (and is not marked sent again).
        await sentHead(page).click();
        await placeHead(page, 'sent', 'MěÚ Vzorov').locator('.research-overview__waiting-group').click();
        const sentItem = ov.locator('.research-overview__phase[data-phase="sent"] .research-overview__waiting-item', { hasText: 'Odeslaný dopis 1' });
        await sentItem.locator('.research-overview__waiting-row').click();
        await expect(sentItem.locator('.research-overview__waiting-action')).toHaveText(['Answer ↗', 'Chat ↗', 'Add a file ↗', 'Back to To do']);
        await sentItem.locator('.research-overview__waiting-action[data-action="unsent"]').click();
        await expect(todoHead(page)).toHaveText(/To do · 31/);
        expect(bridge.writes.at(-1)).toMatchObject({ path: 'waiting/T0031', body: '{"do":"unsent"}' });
        // The bridge's next status agrees: the row stays where it went.
        await page.waitForTimeout(2500);
        await expect(todoHead(page)).toHaveText(/To do · 31/);
    });

    test('a place: Sent for its items to do and the text of all its queries with Copy, folded, the fold untouched', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, writable(['waiting.sent', 'waiting.note']));
        const ov = await openOverview(page);
        const office = placeHead(page, 'todo', 'MěÚ Vzorov');
        // Only where items offer them: the office (letters with sent and a query text); not the family, web or archive.
        await expect(office.locator('.research-overview__waiting-groupwrite')).toHaveText(['Sent', 'All queries\' text']);
        await expect(office.locator('.research-overview__waiting-groupchat')).toHaveText('Chat ↗');
        for (const name of ['Rodina', 'rodokmen.example', 'Archiv Vzorov']) {
            await expect(placeHead(page, 'todo', name).locator('.research-overview__waiting-groupwrite')).toHaveCount(0);
        }
        await page.evaluate(() => {
            const copied: string[] = [];
            (window as unknown as { __copied: string[] }).__copied = copied;
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { copied.push(t); } } });
        });

        // The queries' text: a small window over the overview, the text as text with its lines.
        await office.locator('.research-overview__waiting-groupnote').click();
        const dialog = page.locator('#waiting-note-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('#waiting-note-title')).toHaveText('All queries\' text');
        await expect(dialog.locator('.audit-log-subtitle')).toHaveText('MěÚ Vzorov · 6 queries');
        const text = dialog.locator('.waiting-note-text');
        await expect(text).toHaveCSS('white-space', 'pre-wrap');
        expect(await text.evaluate(n => n.textContent)).toBe(bridge.note!.text);
        expect(await text.evaluate(n => n.children.length)).toBe(0);
        await dialog.locator('.waiting-note-copy').click();
        expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([bridge.note!.text]);
        await expect(page.locator('.toast[data-kind="waiting-copied"]')).toHaveText('Copied');
        expect(bridge.writes.map(w => [w.method, w.path])).toEqual([['GET', `group/${encodeURIComponent('to:MěÚ Vzorov')}/note`]]);
        // Escape closes the window alone.
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(ov).toBeVisible();
        await expect(office.locator('.research-overview__waiting-group')).toHaveAttribute('aria-expanded', 'false');

        // Sent for the place: its six letters move at once; the fold never toggled.
        await office.locator('.research-overview__waiting-groupwrite[data-action="group-sent"]').click();
        await expect(todoHead(page)).toHaveText(/To do · 24/);
        await expect(sentHead(page)).toHaveText(/Awaiting a reply · 11/);
        await expect(page.locator('.toast[data-kind="waiting-sent"]')).toContainText(/^6 items recorded as sent on/);
        expect(bridge.writes.at(-1)).toMatchObject({ method: 'POST', path: `group/${encodeURIComponent('to:MěÚ Vzorov')}`, body: '{"do":"sent"}' });
        await expect(placeHead(page, 'todo', 'MěÚ Vzorov')).toHaveCount(0);
        await expect(ov.locator('.research-overview__phase[data-phase="todo"] .research-overview__waiting-item')).toHaveCount(0);
        expect(await launched(page)).toEqual([]);
    });

    test('Add a file at a task: the originals\' path with X-Strom-Task, then "Sent to the research"', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, writable([], { media: { task: true } }));
        await openOverview(page);
        const letter = await openLetter(page);
        await expect(letter.locator('.research-overview__waiting-action')).toHaveText(['Answer ↗', 'Chat ↗', 'Add a file', 'Query text ↗', 'Sent ↗']);
        const chooser = page.waitForEvent('filechooser');
        await letter.locator('.research-overview__waiting-action[data-action="file"]').click();
        await (await chooser).setFiles({ name: 'odpoved-uradu.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 vymyšlená odpověď') });
        await expect(page.locator('.toast[data-kind="waiting-file-sent"]')).toHaveText('Sent to the research');
        const put = bridge.writes.find(w => w.method === 'PUT');
        expect(put?.path).toMatch(/^media\/[0-9a-f]{64}$/);
        expect(put?.headers['x-strom-task']).toBe('T0018');
        expect(put?.headers['x-strom-name']).toBe('odpoved-uradu.pdf');
        expect(put?.headers['content-type']).toBe('application/pdf');
        expect(await launched(page)).toEqual([]);
    });

    test('a refused or unanswered write puts the row back and says so', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, writable(['waiting.sent']));
        bridge.refuse = { status: 423, code: 'locked' };
        await openOverview(page);
        let letter = await openLetter(page);
        await letter.locator('.research-overview__waiting-action[data-action="sent"]').click();
        await expect(page.locator('.toast[data-kind="waiting-failed"]')).toHaveText('Not recorded: another session holds the tree in the research.');
        await expect(todoHead(page)).toHaveText(/To do · 30/);
        await expect(letter).toBeVisible();
        bridge.refuse = 'abort';
        letter = page.locator('#research-overview .research-overview__waiting-item', { hasText: 'Napsat matrice o zápis 1' });
        await letter.locator('.research-overview__waiting-action[data-action="sent"]').click();
        await expect(page.locator('.toast[data-kind="waiting-failed"]')).toHaveText('Not recorded: the research did not answer.');
        await expect(todoHead(page)).toHaveText(/To do · 30/);
        expect(bridge.writes).toHaveLength(2);
    });

    test('phone: the sheet writes through the bridge (Sent, a file, the queries\' text), no way into the research', async ({ page }) => {
        const bridge = await follow(page, { width: 360, height: 780 }, writable(['waiting.sent', 'waiting.note'], { media: { task: true } }));
        await page.locator('#live-panel .live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        await recordLaunches(page);
        const office = placeHead(page, 'todo', 'MěÚ Vzorov');
        await expect(office.locator('.research-overview__waiting-groupwrite')).toHaveText(['Sent', 'All queries\' text']);
        await expect(ov.locator('.research-overview__waiting-groupchat')).toHaveCount(0);
        const box = await office.locator('.research-overview__waiting-groupwrite').first().boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);

        const letter = await openLetter(page);
        await expect(letter.locator('.research-overview__waiting-action')).toHaveText(['Add a file', 'Sent']);
        await expect(letter.locator('.research-overview__waiting-detail')).toContainText('answered in the research on the computer');
        // The queries' text opens over the sheet; × closes it, the sheet stays.
        await office.locator('.research-overview__waiting-groupnote').click();
        const dialog = page.locator('#waiting-note-modal');
        await expect(dialog.locator('.waiting-note-text')).toContainText('prosím o výpisy z matriky Vzorov');
        await expect(dialog.locator('.waiting-note-copy')).toBeVisible();
        await dialog.locator('.close-btn').click();
        await expect(dialog).toHaveCount(0);
        await expect(ov).toBeVisible();
        await letter.locator('.research-overview__waiting-action[data-action="sent"]').click();
        await expect(todoHead(page)).toHaveText(/To do · 29/);
        expect(bridge.writes.map(w => [w.method, w.path])).toEqual([
            ['GET', `group/${encodeURIComponent('to:MěÚ Vzorov')}/note`], ['POST', 'waiting/T0018'],
        ]);
        expect(await launched(page)).toEqual([]);
    });
});
