import { test, expect, Page, Route } from '@playwright/test';
import { BRIDGE, FakeBridge, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * A task's finding in Awaiting action (spec 109 K1.4, K1.6): a research that
 * announces `tasks.audit` sends `audit: {kinds, fix, stamp}` at a task whose
 * waiting is not recorded as needed. The overview marks the item's title and,
 * in its detail, shows the finding's row under the waiting text — the same in
 * an archive's group, under "No book" and in the flat list — with Fix,
 * Discuss with the agent (moved there from the item's actions: AI + terminal)
 * and Leave as is (written at once with the finding's stamp, a toast with
 * Undo). The small panel only marks the item. An older research: as before.
 * A phone: nothing wider than the screen, 44 px targets. Invented tasks,
 * books and archives; a fake bridge; a fixed clock.
 */

test.use({ timezoneId: 'Europe/Prague' });

const NOW = new Date('2026-11-13T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat', 'task', 'book'];
const FEATURES = ['waiting.groups', 'books', 'tasks.audit'];
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

const smyslenka = { key: 'repo:R0003', name: 'Archiv ve Smyšlence', kind: 'archive', url: 'https://archiv-smyslenka.example/' };
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const STAMP_412 = 'T0412@2026-11-12T09:14:03Z';
const STAMP_377 = 'T0377@2026-11-11T08:00:00Z';
const STAMP_520 = 'T0520@2026-11-10T07:00:00Z';

/** One task waiting rightly for a book's images, three with a finding (part, whole, none), none of them with a book. */
function waiting(): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [
        { id: 'T0001', what: 'Uložit snímky matriky Smyšlenka 3 (křest)', kind: 'images', section: 'images', group: smyslenka, at: minAgo(25), book: 'B0003', actions: ['chat', 'folder'] },
        {
            id: 'T0412', what: 'Křest dítěte z čp. 12 ve Smyšlence, 1806 – ověřit rodiče', kind: 'web', section: 'web', group: smyslenka, at: minAgo(60),
            on: 'Snímky 57–58 z knihy Smyšlenka 3, N 1784–1820 a snímek 14 z knihy Vymyšlov 9, O 1801–1850 k ručnímu uložení',
            url: 'https://archiv-smyslenka.example/vymyslov/9', actions: ['answer', 'chat'],
            audit: { kinds: ['images-as-text', 'several-books', 'book-unknown'], fix: 'part', stamp: STAMP_412 },
        },
        {
            id: 'T0377', what: 'Zápis sňatku rodičů ve Smyšlence, 1798', kind: 'web', section: 'web', group: smyslenka, at: minAgo(120),
            on: 'Snímky 31–32 z knihy Smyšlenka 3, N 1784–1820', actions: ['answer', 'chat'],
            audit: { kinds: ['images-as-text'], fix: 'whole', stamp: STAMP_377 },
        },
        {
            id: 'T0520', what: 'Úmrtí kmotra ve Vymyšlově, 1812', kind: 'web', section: 'web', group: smyslenka, at: minAgo(180),
            on: 'Snímek 14 z knihy Vymyšlov 9, O 1801–1850', actions: ['answer', 'chat'],
            audit: { kinds: ['book-unknown'], fix: 'none', stamp: STAMP_520 },
        },
    ];
    return items.map((w, i) => ({ order: i, ...w }));
}

function booksPart(): Record<string, unknown> {
    return {
        settings: { minTasks: 5, minTasksOwn: false, minTasksDefault: 5, sameBook: 'no', sameBookOwn: false, sameBookDefault: 'no' },
        list: [{
            id: 'B0003', title: 'Smyšlenka 3, N', years: '1784-1820', folder: 'Smyšlenka 3 N 1784-1820',
            archive: { id: 'R0003', name: smyslenka.name, url: smyslenka.url }, access: 'online-free',
            tasks: 4, waiting: 1, open: 3, parked: 0, onDisk: 0, download: 'none',
        }],
        more: 0,
    };
}

interface AuditBridge { bridge: FakeBridge; writes: [string, unknown][] }

/**
 * The research tree, its bridge answering; a write of a finding as the research writes it: `keep` drops the
 * item's `audit` (and keeps it aside), `unkeep` brings it back.
 */
async function researchTree(page: Page, opts: { width?: number; height?: number; features?: string[] } = {}): Promise<AuditBridge> {
    const width = opts.width ?? 1440;
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width, height: opts.height ?? (width > 640 ? 900 : 844) });
    await openResearch(page);
    const bridge = await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, waiting: waiting(), features: opts.features ?? FEATURES, treeGed: researchGed(),
        books: { books: booksPart(), posts: [] },
    });
    const writes: [string, unknown][] = [];
    const keptAside = new Map<string, unknown>();
    await page.route(`${BRIDGE}/waiting/*`, async (route: Route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const id = new URL(req.url()).pathname.split('/').pop()!;
        const body = JSON.parse(req.postData() ?? '{}') as { do: string; expect?: string };
        writes.push([id, body]);
        const w = (bridge.waiting ?? []).find(x => (x as { id: string }).id === id) as Record<string, unknown> | undefined;
        if (!w) return route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ error: 'not waiting', code: 'waiting.none' }) });
        if (body.do === 'keep') {
            const audit = w.audit as { stamp: string; kinds: string[] } | undefined;
            if (!audit) return route.fulfill({ status: 409, headers: cors, body: JSON.stringify({ error: 'no finding', code: 'audit.none' }) });
            if (body.expect !== audit.stamp) return route.fulfill({ status: 409, headers: cors, body: JSON.stringify({ error: 'changed', code: 'waiting.changed', id, at: '' }) });
            keptAside.set(id, audit);
            delete w.audit;
            return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ task: id, kept: { at: NOW.toISOString(), by: 'person', givenIn: 'app', kinds: audit.kinds, wait: 'x' }, head: '' }) });
        }
        if (body.do === 'unkeep') {
            const audit = keptAside.get(id);
            if (audit) w.audit = audit;
            keptAside.delete(id);
            return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ task: id, kept: null, head: '' }) });
        }
        return route.fulfill({ status: 400, headers: cors, body: JSON.stringify({ error: 'bad body', code: 'waiting.bad-body' }) });
    });
    await poll(page);
    return { bridge, writes };
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-waiting');
const todo = (page: Page) => sec(page).locator('.research-overview__phase[data-phase="todo"]');
const item = (page: Page, id: string) => sec(page).locator(`.research-overview__waiting-item[data-id="${id}"]`);
const detail = (page: Page, id: string) => item(page, id).locator('.research-overview__waiting-detail');
const finding = (page: Page, id: string) => item(page, id).locator('.waiting-audit');
const titleMark = (page: Page, id: string) => item(page, id).locator('.research-overview__waiting-what .waiting-audit-mark');
const seg = (page: Page) => sec(page).getByRole('radiogroup', { name: 'Groups' });
const orderBtn = (page: Page) => sec(page).locator('.research-overview__order-btn:not(.research-overview__groups-btn)');

async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(ov(page)).toBeVisible();
    await expect(sec(page)).toBeVisible();
}

async function unfoldPlaces(page: Page): Promise<void> {
    const folded = sec(page).locator('.research-overview__waiting-group[aria-expanded="false"]');
    while (await folded.count() > 0) await folded.first().click();
}

/** An item's detail open (its place unfolded). */
async function openItem(page: Page, id: string): Promise<void> {
    await unfoldPlaces(page);
    await expect(item(page, id)).toBeVisible();
    if (await detail(page, id).count() === 0) await item(page, id).locator('.research-overview__waiting-row').click();
    await expect(detail(page, id)).toBeVisible();
}

async function recordLaunches(page: Page): Promise<void> {
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}
const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

const HEAD = 'Task not recorded as needed';
const EXPLAIN_412 = 'Images are only described in text, with no book – saved images do not bring the task back. '
    + 'Waits for images from several books; the research does not know one of them.';
const CHAT = 'Discuss with the agent, AI, opens in the researchAI';

/** T0412's finding row as the design draws it, wherever the item stands. */
async function findingOf412(page: Page): Promise<void> {
    await unfoldPlaces(page);
    await expect(titleMark(page, 'T0412')).toHaveAttribute('title', HEAD);
    await expect(titleMark(page, 'T0412').locator('svg')).toHaveAttribute('aria-label', HEAD);
    await openItem(page, 'T0412');
    const row = finding(page, 'T0412');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('role', 'group');
    await expect(row).toHaveAttribute('aria-label', HEAD);
    await expect(row.locator('.waiting-audit__title')).toHaveText(HEAD);
    await expect(row.locator('.waiting-audit__text')).toHaveText(EXPLAIN_412);
    await expect(row.locator('.waiting-audit__actions button')).toHaveText(['Fix', CHAT, 'Leave as is']);
    // Discuss with the agent only once, in the finding's row; under the waiting text.
    await expect(detail(page, 'T0412').locator('[data-action="chat"]')).toHaveCount(1);
    const order = await detail(page, 'T0412').evaluate(d => {
        const on = d.querySelector('.research-overview__waiting-on-box');
        const audit = d.querySelector('.waiting-audit');
        return !!on && !!audit && !!(on.compareDocumentPosition(audit) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
}

test.describe('a task\'s finding in Awaiting action', () => {
    test('the row in an archive\'s group, under "No book" and in the flat list; the mark at the title; Discuss only in the row', async ({ page }) => {
        await researchTree(page);
        await recordLaunches(page);
        await openOverview(page);

        // By archive: the archive's group holds them all.
        await findingOf412(page);
        const row = finding(page, 'T0412');
        // Fix and Leave as is go through the bridge: no mark; Discuss: AI + terminal, its hint said.
        await expect(row.locator('[data-action="audit-fix"] .research-open-mark, [data-action="audit-fix"] .research-ai-badge')).toHaveCount(0);
        await expect(row.locator('[data-action="audit-keep"] .research-open-mark, [data-action="audit-keep"] .research-ai-badge')).toHaveCount(0);
        const chat = row.locator('[data-action="chat"]');
        await expect(chat.locator('.research-ai-badge')).toHaveCount(1);
        await expect(chat.locator('.research-open-mark')).toHaveCount(1);
        await expect(chat).toHaveAttribute('title', 'The agent gets the finding and proposes a fix');
        await expect(chat).toHaveAccessibleDescription('The agent gets the finding and proposes a fix');
        await chat.click();
        expect((await launched(page)).at(-1)).toMatch(/^strom-research:\/\/task\?tree=[^&]+&task=T0412&do=chat$/);
        // No red, no green: the warm tint.
        const look = await row.evaluate(el => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = 'var(--warning-soft)';
            el.appendChild(probe);
            const want = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return { bg: getComputedStyle(el).backgroundColor, want };
        });
        expect(look.bg).toBe(look.want);

        // The other two: whole (only the images sentence), none (no Fix; the agent adds the book).
        await openItem(page, 'T0377');
        await expect(finding(page, 'T0377').locator('.waiting-audit__text')).toHaveText('Images are only described in text, with no book – saved images do not bring the task back.');
        await expect(finding(page, 'T0377').locator('.waiting-audit__actions button')).toHaveText(['Fix', CHAT, 'Leave as is']);
        await openItem(page, 'T0520');
        await expect(finding(page, 'T0520').locator('.waiting-audit__text')).toHaveText('The research does not know the book – the task has no folder for images. The agent adds the book to the research.');
        await expect(finding(page, 'T0520').locator('.waiting-audit__actions button')).toHaveText([CHAT, 'Leave as is']);
        // An item without a finding: Discuss stays in its actions, no mark.
        await openItem(page, 'T0001');
        await expect(finding(page, 'T0001')).toHaveCount(0);
        await expect(titleMark(page, 'T0001')).toHaveCount(0);

        // By book: T0412 has no book, it stands under "No book".
        await seg(page).getByRole('radio', { name: 'Book' }).click();
        await expect(todo(page).locator('.research-overview__nobook')).toHaveText('No book');
        expect(await todo(page).evaluate(el => {
            const nb = el.querySelector('.research-overview__nobook');
            const it = el.querySelector('.research-overview__waiting-item[data-id="T0412"]');
            return !!nb && !!it && !!(nb.compareDocumentPosition(it) & Node.DOCUMENT_POSITION_FOLLOWING);
        })).toBe(true);
        await findingOf412(page);

        // The flat list (a time order, no groups).
        await orderBtn(page).click();
        await page.getByRole('menu', { name: 'Order' }).getByRole('menuitemradio', { name: 'Newest first' }).click();
        await seg(page).getByRole('radio', { name: 'No groups' }).click();
        await expect(todo(page).locator('.research-overview__waiting-group')).toHaveCount(0);
        await findingOf412(page);
    });

    test('Leave as is: written at once with the finding\'s stamp, the row and mark gone, Discuss back; Undo offers it again', async ({ page }) => {
        const { writes } = await researchTree(page);
        await openOverview(page);
        await openItem(page, 'T0377');
        await finding(page, 'T0377').locator('[data-action="audit-keep"]').click();
        await expect.poll(() => writes).toEqual([['T0377', { do: 'keep', expect: STAMP_377 }]]);
        await expect(finding(page, 'T0377')).toHaveCount(0);
        await expect(titleMark(page, 'T0377')).toHaveCount(0);
        // Discuss with the agent back in the item's own actions; nothing said in the item.
        await expect(detail(page, 'T0377').locator('[data-action="chat"]')).toHaveCount(1);
        await expect(detail(page, 'T0377')).not.toContainText('finding');
        const toast = page.locator('.toast[data-kind="waiting-audit-kept"]');
        await expect(toast).toContainText('The finding is no longer offered');
        await expect(toast.locator('.toast-action')).toHaveText('Undo');
        await toast.locator('.toast-action').click();
        await expect.poll(() => writes.at(-1)).toEqual(['T0377', { do: 'unkeep' }]);
        // Undo worked in the toast (§4): its end said there.
        await expect(toast).toContainText('Undone.');
        await expect(titleMark(page, 'T0377')).toHaveCount(1);
        await openItem(page, 'T0377');
        await expect(finding(page, 'T0377')).toHaveCount(1);
        await expect(detail(page, 'T0377').locator('[data-action="chat"]')).toHaveCount(1);
        await expect(finding(page, 'T0377').locator('[data-action="chat"]')).toHaveCount(1);
    });

    test('an older research without tasks.audit: the items as before, no mark, no row', async ({ page }) => {
        await researchTree(page, { features: ['waiting.groups', 'books'] });
        await openOverview(page);
        await openItem(page, 'T0412');
        await expect(sec(page).locator('.waiting-audit-mark, .waiting-audit')).toHaveCount(0);
        await expect(detail(page, 'T0412').locator('[data-action="chat"]')).toHaveCount(1);
    });

    test('the small panel: only the mark before the item\'s title', async ({ page }) => {
        await page.addInitScript((announced) => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
        }, LINKS);
        await researchTree(page);
        await page.route(`${BRIDGE}/events*`, (route: Route) => new Promise<void>(() => { void route; }));
        await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        const marks = panel.locator('.live-waiting-what .waiting-audit-mark');
        await expect(marks).toHaveCount(3);
        await expect(marks.first()).toHaveAttribute('title', 'Task not recorded as needed – opens in the overview');
        await expect(panel.locator('.waiting-audit')).toHaveCount(0);
    });

    for (const size of [{ width: 390, height: 844, name: 'a phone' }, { width: 844, height: 390, name: 'a phone held sideways' }]) {
        test(`${size.name}: the row whole, nothing wider than the screen, 44 px targets`, async ({ page }) => {
            await researchTree(page, size);
            await openOverview(page);
            await openItem(page, 'T0412');
            const row = finding(page, 'T0412');
            await expect(row.locator('.waiting-audit__text')).toHaveText(EXPLAIN_412);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
            // Nothing of the row wider than it or sticking out of it.
            const over = await row.evaluate(r => {
                const edge = r.getBoundingClientRect();
                return [r, ...r.querySelectorAll<HTMLElement>('*')]
                    .filter(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > edge.right + 1 || e.getBoundingClientRect().left < edge.left - 1)
                    .filter(e => e.getBoundingClientRect().width > 1)
                    .map(e => (e as HTMLElement).className || e.tagName);
            });
            expect(over).toEqual([]);
            const box = await row.boundingBox();
            const secBox = await sec(page).boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(secBox!.x - 1);
            expect(box!.x + box!.width).toBeLessThanOrEqual(secBox!.x + secBox!.width + 1);
            const buttons = row.locator('.waiting-audit__actions button');
            await expect(buttons.first()).toBeVisible();
            for (const b of await buttons.all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        });
    }
});
