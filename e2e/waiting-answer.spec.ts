import { test, expect, Page } from '@playwright/test';

/**
 * Awaiting action in the Research overview for items waiting for images of a
 * book, a website or a check (spec 048 U6): the actions of their kind by
 * weight with "More actions", the images' state (dots in the row, the book's
 * frame in the detail), an archive's place with its website and what it
 * misses, and the answer written in the app through the bridge (200, 409
 * changed, 404, 503; the draft kept over a reload). An older bridge keeps
 * today's way: the answer in the terminal, no "Add images". Invented data only.
 */

const UUID = '6b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const BRIDGE = 'http://127.0.0.1:5996/fedcba9876543210fedcba9876543210';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research', 'live'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 2 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Vrbovi',
    '0 @P0001@ INDI', '1 NAME Tomáš /Vrba/', '1 SEX M', '1 BIRT', '2 DATE 1862', '1 REFN P0001',
    '0 TRLR',
].join('\n');

interface Reply { status: number; body: Record<string, unknown> }
interface Bridge {
    waiting: Record<string, unknown>[];
    features: string[];
    accepts?: Record<string, unknown>;
    /** The answers the next answers get, in turn (none left: 200, the task leaves the list). */
    replies: Reply[];
    writes: { path: string; body: Record<string, unknown> }[];
}

const ARCHIVE = {
    key: 'repo:R0042', kind: 'archive', url: 'https://archiv.example/badatelna',
    name: 'Státní oblastní archiv ve Vzorově, fond Římskokatolický farní úřad Horní Vzorov, matriky 1784–1949',
};

function newBridgeWaiting(): Record<string, unknown>[] {
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    return [
        {
            id: 'T0001', what: 'Uložit snímky 57–58 oddací matriky Horní Vzorov', kind: 'images', section: 'images', group: ARCHIVE, at, order: 0,
            person: 'P0001', url: 'https://archiv.example/kniha/12',
            inbox: { dir: 'inbox/T0001', have: 1, want: 2, missing: [58], book: 'Oddací matrika N 1860–1875', images: '57–58' },
            actions: ['images', 'answer', 'chat', 'folder'],
        },
        {
            id: 'T0002', what: 'Uložit snímky 112–113 křestní matriky', kind: 'images', section: 'images', group: ARCHIVE, at, order: 1,
            inbox: { dir: 'inbox/T0002', have: 0, want: 2, missing: [112, 113], book: 'Křestní matrika N 1850–1870', images: '112–113' },
            actions: ['images', 'answer', 'chat', 'folder'],
        },
        {
            id: 'T0003', what: 'Ověřit záznam na webu obce', kind: 'web', section: 'web', at, order: 2,
            group: { key: 'host:obec.example', name: 'obec.example', kind: 'web' }, url: 'https://obec.example/kronika',
            actions: ['answer', 'chat'],
        },
    ];
}

async function follow(page: Page, size: { width: number; height: number }, setup: (b: Bridge) => void, fast = false): Promise<Bridge> {
    await page.setViewportSize(size);
    // A short wait between the bridge's statuses only where a test waits for the next one (2 s in use).
    if (fast) await page.addInitScript(() => { (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250; });
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    const bridge: Bridge = { waiting: newBridgeWaiting(), features: ['waiting.groups', 'waiting.answer'], accepts: { media: { taskImages: true } }, replies: [], writes: [] };
    setup(bridge);
    const status = () => ({
        tree: { id: UUID, name: 'Vrbovi' }, head: 'h1', persons: 1, working: [], waiting: bridge.waiting, links: LINKS,
        queue: [], features: bridge.features, ...(bridge.accepts ? { accepts: bridge.accepts } : {}),
    });
    const json = (s: number, body: unknown) => ({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, PUT', 'access-control-allow-headers': '*' } });
        }
        if (path.endsWith('/status')) return route.fulfill(json(200, status()));
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        const write = /\/waiting\/(T\d+)$/.exec(path);
        if (write && req.method() === 'POST') {
            const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>;
            bridge.writes.push({ path: write[1], body });
            const next = bridge.replies.shift();
            if (next) return route.fulfill(json(next.status, next.body));
            const i = bridge.waiting.findIndex(w => w.id === write[1]);
            if (i < 0) return route.fulfill(json(404, { error: 'not waiting', code: 'waiting.none' }));
            bridge.waiting.splice(i, 1);
            return route.fulfill(json(200, { task: write[1], head: '' }));
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    return bridge;
}

async function openOverview(page: Page) {
    await page.locator('#live-panel .live-panel-expand').click();
    const ov = page.locator('#research-overview');
    await expect(ov).toBeVisible();
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
    return ov;
}
const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

const archiveHead = (page: Page) => page.locator('#research-overview .research-overview__waiting-grouphead')
    .filter({ has: page.locator('.research-overview__group-title', { hasText: 'Státní oblastní archiv' }) });

async function openItem(page: Page, id: string) {
    const head = archiveHead(page).locator('.research-overview__waiting-group');
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
    const item = page.locator(`#research-overview .research-overview__waiting-item[data-id="${id}"]`);
    await item.locator('.research-overview__waiting-row').click();
    await expect(item.locator('.research-overview__waiting-detail')).toBeVisible();
    return item;
}

const DRAFT_PREFIX = 'strom.waiting.draft.';
async function draftOf(page: Page, task: string): Promise<string | null> {
    return page.evaluate(([prefix, t]) => {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)!;
            if (k.startsWith(prefix) && k.endsWith(`.${t}`)) return localStorage.getItem(k);
        }
        return null;
    }, [DRAFT_PREFIX, task]);
}

test.describe('a research that takes answers and images (waiting.answer, accepts.media.taskImages)', () => {
    test('the archive\'s place, the images\' state, the actions by weight and More actions', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, () => {});
        const ov = await openOverview(page);

        // The archive's place: its long name in two lines (whole on hover), what it misses, its website, Chat.
        const head = archiveHead(page);
        const title = head.locator('.research-overview__group-title');
        await expect(title).toHaveClass(/is-two-lines/);
        await expect(title).toHaveAttribute('title', ARCHIVE.name);
        await expect(head.locator('.research-overview__group-missing')).toHaveText('3 images missing');
        const archiveWeb = head.locator('a.research-overview__waiting-archiveweb');
        await expect(archiveWeb).toHaveText('Archive website ↗');
        await expect(archiveWeb).toHaveAttribute('href', ARCHIVE.url);
        await expect(archiveWeb).toHaveAttribute('target', '_blank');
        await expect(archiveWeb).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(head.locator('.research-overview__waiting-groupchat')).toHaveAttribute('data-task', 'T0001');

        // Rows: dots and how many, or which are needed.
        await head.locator('.research-overview__waiting-group').click();
        const first = ov.locator('.research-overview__waiting-item[data-id="T0001"]');
        const second = ov.locator('.research-overview__waiting-item[data-id="T0002"]');
        await expect(first.locator('.waiting-images__text')).toHaveText('1 of 2 images');
        await expect(first.locator('.img-dot')).toHaveCount(2);
        await expect(first.locator('.img-dot.is-on')).toHaveCount(1);
        await expect(first.locator('.img-dots')).toHaveAttribute('aria-hidden', 'true');
        await expect(second.locator('.waiting-images__text')).toHaveText('images 112–113');

        // The detail: the book's frame with its numbers, the sentence.
        const item = await openItem(page, 'T0001');
        const book = item.locator('.wait-book');
        await expect(book.locator('.wait-book__label')).toHaveText('Book');
        await expect(book.locator('.wait-book__name')).toHaveText('Oddací matrika N 1860–1875');
        await expect(book.locator('.wait-book__slot')).toHaveText(['✓ 57 · saved', '○ 58 · missing']);
        await expect(book.locator('.wait-book__state')).toHaveText('1 of 2 images saved – image 58 missing.');
        await expect(item.locator('.research-overview__waiting-inbox')).toHaveCount(0);

        // Add images (filled, through the bridge: no mark), the book's website (outlined), Answer (a link), the rest under ⋯.
        const row = item.locator('.waiting-actions');
        const shown = row.locator('> .waiting-action');
        await expect(shown).toHaveCount(3);
        await expect(shown.nth(0)).toHaveAttribute('data-action', 'images');
        await expect(shown.nth(0)).toHaveClass(/waiting-action--primary/);
        await expect(shown.nth(0)).toHaveText('Add images');
        await expect(shown.nth(0).locator('.research-open-mark')).toHaveCount(0);
        await expect(shown.nth(1)).toHaveAttribute('data-action', 'web');
        await expect(shown.nth(1)).toHaveClass(/waiting-action--secondary/);
        await expect(shown.nth(1)).toHaveText('Open website ↗');
        await expect(shown.nth(1)).toHaveAttribute('href', 'https://archiv.example/kniha/12');
        await expect(shown.nth(1)).toHaveAttribute('title', 'https://archiv.example/kniha/12');
        await expect(shown.nth(2)).toHaveAttribute('data-action', 'answer');
        await expect(shown.nth(2)).toHaveClass(/waiting-action--link/);
        await expect(shown.nth(2)).toHaveText('Answer');
        // No terminal answer here: no hint of it.
        await expect(item.locator('.research-overview__waiting-hint')).toHaveCount(0);
        // "Add images" leads to the upload area (another part); it fails nowhere.
        await shown.nth(0).click();
        await expect(item.locator('.research-overview__waiting-detail')).toBeVisible();

        const more = row.locator('.waiting-more');
        await expect(more).toHaveAttribute('aria-haspopup', 'menu');
        await expect(more).toHaveAttribute('aria-label', 'More actions');
        await more.click();
        const menu = page.locator('#waiting-more-menu');
        await expect(menu).toHaveAttribute('role', 'menu');
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        const entries = menu.locator('[role="menuitem"]');
        await expect(entries).toHaveText(['Discuss with the agent, AI, opens in the researchAI', 'Open folder, opens in the research']);
        await expect(entries.nth(0).locator('.research-ai-badge')).toHaveCount(1);
        await expect(entries.nth(1).locator('.research-ai-badge')).toHaveCount(0);
        await expect(entries.nth(1).locator('.research-open-mark')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(ov).toBeVisible();
        await expect(more).toBeFocused();
        await more.click();
        await menu.locator('[data-action="folder"]').click();
        await expect(menu).toHaveCount(0);
        expect(await launched(page)).toEqual([`strom-research://task?tree=${UUID}&task=T0001&do=folder`]);
        // A click elsewhere closes it too.
        await more.click();
        await expect(menu).toBeVisible();
        await item.locator('.research-overview__waiting-text').click();
        await expect(menu).toHaveCount(0);
    });

    test('Answer in the detail: busy, then the task changed, then saved; the draft is kept until it is taken', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, () => {});
        await openOverview(page);
        const item = await openItem(page, 'T0001');
        await item.locator('.waiting-actions [data-action="answer"]').click();

        // One thing at a time: the field, the actions hidden.
        const form = item.locator('.waiting-answer');
        await expect(form).toBeVisible();
        await expect(item.locator('.waiting-actions')).toHaveCount(0);
        const field = form.locator('textarea');
        await expect(field).toBeFocused();
        await expect(form.locator('label')).toHaveText('Answer to the task');
        await expect(field).toHaveAttribute('maxlength', '4000');
        const send = form.locator('.waiting-answer__send');
        await expect(send).toHaveAttribute('aria-disabled', 'true');
        await field.fill('   ');
        await expect(send).toHaveAttribute('aria-disabled', 'true');
        // aria-disabled keeps it in the tab order; a click sends nothing.
        await send.click({ force: true });
        expect(bridge.writes).toHaveLength(0);
        await field.fill('Snímek 58 v archivu chybí, zápis je jen na 57.');
        await expect(send).toHaveAttribute('aria-disabled', 'false');
        await expect.poll(() => draftOf(page, 'T0001')).toBe('Snímek 58 v archivu chybí, zápis je jen na 57.');
        await expect(form.locator('.waiting-answer__count')).toBeHidden();

        // Busy: the red line, Try again, the draft stays.
        bridge.replies.push({ status: 503, body: { error: 'busy', code: 'research.busy' } });
        await send.click();
        await expect(form.locator('.waiting-answer__error')).toHaveText('The research is busy right now; the answer was not sent. The draft stays; it can be sent again shortly.');
        await expect(send).toHaveText('Try again');
        await expect(form.locator('.waiting-answer__draft')).toHaveText('The draft stays on this device.');
        expect(bridge.writes[0]).toEqual({ path: 'T0001', body: { do: 'answer', text: 'Snímek 58 v archivu chybí, zápis je jen na 57.', expect: bridge.waiting[0].at } });

        // The task waits for something else now: the ochre note on top, the draft stays, the next try expects the new wording.
        const newAt = new Date().toISOString();
        bridge.replies.push({ status: 409, body: { error: 'changed', code: 'waiting.changed', at: newAt } });
        bridge.waiting[0] = { ...bridge.waiting[0], what: 'Uložit snímek 58 oddací matriky Horní Vzorov', at: newAt };
        await send.click();
        const note = item.locator('.waiting-answer-changed');
        await expect(note).toHaveAttribute('role', 'alert');
        await expect(note).toContainText('The task now waits for something else; the answer was not sent.');
        await expect(form.locator('.waiting-answer__error')).toBeHidden();
        await expect(item.locator('.research-overview__waiting-text')).toHaveText('Uložit snímek 58 oddací matriky Horní Vzorov', { timeout: 10000 });
        await expect(field).toHaveValue('Snímek 58 v archivu chybí, zápis je jen na 57.');

        // Saved: the row goes, the toast says so, the draft goes.
        await send.click();
        await expect(page.locator('.toast[data-kind="waiting-answered"]')).toHaveText('Answer saved, the task is back in the queue.');
        await expect(page.locator('#research-overview .research-overview__waiting-item[data-id="T0001"]')).toHaveCount(0);
        expect(bridge.writes[2].body).toEqual({ do: 'answer', text: 'Snímek 58 v archivu chybí, zápis je jen na 57.', expect: newAt });
        await expect.poll(() => draftOf(page, 'T0001')).toBeNull();
    });

    test('an answer the research had already (404): the row goes without a word; Cancel and Escape keep the draft', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, () => {});
        await openOverview(page);
        let item = await openItem(page, 'T0002');
        await item.locator('.waiting-actions [data-action="answer"]').click();
        const field = item.locator('.waiting-answer textarea');
        await field.fill('Oba snímky jsou ve fondu pod jinou signaturou.');
        // Cancel: the field closes, the answer button has the focus back; the draft comes back with it.
        await item.locator('.waiting-answer__cancel').click();
        await expect(item.locator('.waiting-answer')).toHaveCount(0);
        await expect(item.locator('.waiting-actions [data-action="answer"]')).toBeFocused();
        expect(await draftOf(page, 'T0002')).toBe('Oba snímky jsou ve fondu pod jinou signaturou.');
        await item.locator('.waiting-actions [data-action="answer"]').click();
        await expect(field).toHaveValue('Oba snímky jsou ve fondu pod jinou signaturou.');
        // Escape in the field is Cancel; the overview stays.
        await page.keyboard.press('Escape');
        await expect(item.locator('.waiting-answer')).toHaveCount(0);
        await expect(page.locator('#research-overview')).toBeVisible();

        await item.locator('.waiting-actions [data-action="answer"]').click();
        bridge.replies.push({ status: 404, body: { error: 'not waiting', code: 'waiting.none' } });
        await item.locator('.waiting-answer__send').click();
        item = page.locator('#research-overview .research-overview__waiting-item[data-id="T0002"]');
        await expect(item).toHaveCount(0);
        await expect(page.locator('.toast[data-kind="waiting-answered"]')).toHaveCount(0);
        await expect.poll(() => draftOf(page, 'T0002')).toBeNull();
    });

    test('the draft survives a reload; a failure keeps it and says so', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, () => {});
        await openOverview(page);
        let item = await openItem(page, 'T0001');
        await item.locator('.waiting-actions [data-action="answer"]').click();
        await item.locator('.waiting-answer textarea').fill('Zápis je na snímku 57 dole.');
        await expect.poll(() => draftOf(page, 'T0001')).toBe('Zápis je na snímku 57 dole.');
        await page.reload();
        // Tied to the research now: asked once how changes go (kept); the overview comes back open.
        const ask = page.locator('#research-mode-ask-modal');
        await expect(ask).toBeVisible();
        await ask.getByRole('button', { name: 'Keep' }).click();
        await expect(page.locator('#research-overview')).toBeVisible();
        item = await openItem(page, 'T0001');
        await item.locator('.waiting-actions [data-action="answer"]').click();
        await expect(item.locator('.waiting-answer textarea')).toHaveValue('Zápis je na snímku 57 dole.');
        bridge.replies.push({ status: 500, body: { error: 'failed', code: 'research.failed' } });
        await item.locator('.waiting-answer__send').click();
        await expect(item.locator('.waiting-answer__error')).toHaveText('The answer was not saved. The draft stays.');
        await expect(item.locator('.waiting-answer__send')).toHaveText('Try again');
        expect(await draftOf(page, 'T0001')).toBe('Zápis je na snímku 57 dole.');
    });

    test('images arriving by themselves: the dot fills, the short state says which came', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, () => {}, true);
        const ov = await openOverview(page);
        await archiveHead(page).locator('.research-overview__waiting-group').click();
        const first = ov.locator('.research-overview__waiting-item[data-id="T0001"]');
        await expect(first.locator('.img-dot.is-on')).toHaveCount(1);
        bridge.waiting[0] = { ...bridge.waiting[0], inbox: { dir: 'inbox/T0001', have: 2, want: 2, missing: [], book: 'Oddací matrika N 1860–1875', images: '57–58' } };
        await expect(first.locator('.img-dot.is-on')).toHaveCount(2, { timeout: 10000 });
        await expect(first.locator('.waiting-images__text')).toHaveText('2 of 2 images');
        await expect(first.locator('.waiting-images__arrived')).toHaveText('· image 58 arrived');
        await expect(page.locator('#waiting-live-region')).toHaveText('image 58 arrived');
        // The detail folded: what arrived was seen.
        await first.locator('.research-overview__waiting-row').click();
        await first.locator('.research-overview__waiting-row').click();
        await expect(first.locator('.waiting-images__arrived')).toHaveCount(0);
    });
});

test.describe('an older research (no waiting.answer, no images through the bridge)', () => {
    test('no new buttons that would fail: Answer goes to the terminal with its hint; the state as before', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.features = ['waiting.groups'];
            delete b.accepts;
            for (const w of b.waiting) {
                if (w.inbox) w.inbox = { dir: (w.inbox as { dir: string }).dir, have: (w.inbox as { have: number }).have, want: 2 };
                w.actions = (w.actions as string[]).filter(a => a !== 'images');
                if (w.group === ARCHIVE) w.group = { key: ARCHIVE.key, name: 'Archiv Vzorov', kind: 'archive' };
            }
        });
        const ov = await openOverview(page);
        const head = ov.locator('.research-overview__waiting-grouphead').filter({ has: page.locator('.research-overview__group-title', { hasText: 'Archiv Vzorov' }) });
        await expect(head.locator('.research-overview__group-missing')).toHaveCount(0);
        await expect(head.locator('.research-overview__waiting-archiveweb')).toHaveCount(0);
        await head.locator('.research-overview__waiting-group').click();
        const item = ov.locator('.research-overview__waiting-item[data-id="T0002"]');
        await expect(item.locator('.waiting-images__text')).toHaveText('0 of 2 images');
        await item.locator('.research-overview__waiting-row').click();
        await expect(item.locator('.wait-book')).toHaveCount(0);
        await expect(item.locator('.wait-book__state')).toHaveText('0 of 2 images saved.');
        await expect(ov.locator('[data-action="images"]')).toHaveCount(0);
        const answer = item.locator('.waiting-actions [data-action="answer"]');
        await expect(answer).toHaveText('Answer, opens in the research');
        // Without a website the answer leads.
        await expect(answer).toHaveClass(/waiting-action--primary/);
        await expect(item.locator('.research-overview__waiting-hint')).toHaveText('The answer is saved with the task; the agent takes it up in its next work.');
        await answer.click();
        await expect(item.locator('.waiting-answer')).toHaveCount(0);
        expect(await launched(page)).toEqual([`strom-research://task?tree=${UUID}&task=T0002`]);

        // With the book's website: it leads (filled), the answer in the terminal beside it.
        const withWeb = ov.locator('.research-overview__waiting-item[data-id="T0001"]');
        await withWeb.locator('.research-overview__waiting-row').click();
        const shown = withWeb.locator('.waiting-actions > .waiting-action');
        await expect(shown.nth(0)).toHaveAttribute('data-action', 'web');
        await expect(shown.nth(0)).toHaveClass(/waiting-action--primary/);
        await expect(shown.nth(1)).toHaveText('Answer, opens in the research');
        await expect(shown.nth(2)).toHaveText('Discuss with the agent, AI, opens in the researchAI');
    });

    test('a website without a book: Answer, its website, Discuss with the agent', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => { b.features = ['waiting.groups']; delete b.accepts; });
        const ov = await openOverview(page);
        const item = ov.locator('.research-overview__waiting-item[data-id="T0003"]');
        await item.locator('.research-overview__waiting-row').click();
        const shown = item.locator('.waiting-actions > .waiting-action');
        await expect(shown).toHaveText(['Answer, opens in the research', 'Open website ↗', 'Discuss with the agent, AI, opens in the researchAI']);
        await expect(item.locator('.waiting-more')).toHaveCount(0);
        await expect(item.locator('.wait-book, .waiting-images')).toHaveCount(0);
    });
});

test.describe('German at a tablet\'s width', () => {
    test.use({ locale: 'de-DE' });
    test('the longest labels wrap inside the overview; nothing spills sideways', async ({ page }) => {
        await follow(page, { width: 1024, height: 768 }, () => {});
        const ov = await openOverview(page);
        const item = await openItem(page, 'T0001');
        await expect(item.locator('.waiting-actions [data-action="images"]')).toBeVisible();
        const spill = await ov.locator('.research-overview__body').evaluate((b) => b.scrollWidth - b.clientWidth);
        expect(spill).toBeLessThanOrEqual(0);
        const box = await item.locator('.waiting-actions').boundingBox();
        const host = await item.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(host!.x + host!.width + 1);
    });
});

test.describe('a phone in German', () => {
    test.use({ locale: 'de-DE' });
    test('the sheet: the images\' state and the actions fit; nothing spills sideways', async ({ page }) => {
        await follow(page, { width: 390, height: 844 }, () => {});
        await page.locator('#live-panel .live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        const head = archiveHead(page).locator('.research-overview__waiting-group');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        const item = ov.locator('.research-overview__waiting-item[data-id="T0001"]');
        await expect(item.locator('.waiting-images__text')).toBeVisible();
        await item.locator('.research-overview__waiting-row').click();
        await expect(item.locator('.wait-book__state')).toBeVisible();
        await expect(item.locator('.waiting-actions')).toBeVisible();
        // The item and all in it (the filter chips above scroll edge to edge on purpose).
        const spill = await item.evaluate((o) => [o, ...o.querySelectorAll<HTMLElement>('*')]
            .filter(n => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'hidden' && getComputedStyle(n).overflowX !== 'clip' && n.clientWidth > 0)
            .map(n => `${n.className} ${n.scrollWidth}/${n.clientWidth} ${getComputedStyle(n).overflowX}`));
        expect(spill).toEqual([]);
        const box = await item.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    });
});
