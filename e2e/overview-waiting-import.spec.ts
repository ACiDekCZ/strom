import { test, expect, Page, Route } from '@playwright/test';
import { BRIDGE, HEAD, UUID, fakeBridge, moveHead, openResearch, poll, researchGed, type FakeBridge } from './research-bridge.js';

/**
 * "Did this come from a family tree (import, merge)?" (1127, `waiting.import`)
 * in Awaiting action: the question with the send's day, how many people and
 * three of them; opened, what Yes would change (the research's preview: ✓ →
 * ○○ and of how many people, what stays ✓ and why), the marks' meaning with
 * "What the marks mean"; Yes → `POST waiting/W-S-I… {do: import}`, the item
 * goes, the toast says what changed and the research's tree is loaded again;
 * No → `{do: own}`; 404 makes the item go with a word, 503 says why at the
 * item; no mark anywhere (the bridge, no terminal, no agent); the small
 * panel opens the overview at the item; without the feature nothing new.
 * German at 1440/1024/390, light and dark, long names: nothing spills.
 * Invented people (Pomněnkový, Kapradinová); a fake bridge; a fixed clock.
 */

test.use({ timezoneId: 'Europe/Prague' });

const NOW = new Date('2026-11-27T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat', 'task'];
const FEATURES = ['waiting.groups', 'waiting.import'];
const ID = 'W-S-I0042';
const LONG = 'Kunigunde Pomněnková-Kapradinová';

function askItem(long = false): Record<string, unknown> {
    return {
        id: ID, order: 0, kind: 'import', section: 'decide', at: '2026-11-25T17:01:01Z', day: '2026-11-25', input: 'I0042', persons: 142,
        group: { key: 'app', name: 'Strom' },
        what: 'Odeslání z aplikace 25. 11. přidalo 142 lidí – přišli z rodokmenu?',
        samples: [
            { id: 'P0101', name: long ? LONG : 'Vratislav Pomněnkový' },
            { id: 'P0102', name: long ? 'Zikmund Rozrazilovský z Javorné' : 'Ludmila Kapradinová' },
            { id: 'P0103', name: 'Anežka Bezinková' },
        ],
    };
}

const PREVIEW = {
    input: 'I0042', day: '2026-11-25', persons: 142,
    change: { values: 512, persons: 138 },
    stay: { values: 21, changed: 15, confirmed: 4, was: 2, other: 0 },
};

interface ImportBridge {
    gets: number;
    posts: Record<string, unknown>[];
    reply: ((body: Record<string, unknown>) => { status: number; body: unknown; headers?: Record<string, string> } | null) | null;
    gate: Promise<void> | null;
}

/** The research's side: the preview, and the answer (done: the item gone from the list, after "import" a new version). */
async function importRoute(page: Page, fb: FakeBridge): Promise<ImportBridge> {
    const a: ImportBridge = { gets: 0, posts: [], reply: null, gate: null };
    const cors = { 'access-control-allow-origin': '*' };
    // Retry-After readable by the page only when the research lets it (Access-Control-Expose-Headers).
    const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
        route.fulfill({ status, headers: { ...cors, 'access-control-expose-headers': 'Retry-After', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    await page.route(`${BRIDGE}/waiting/W-S-I**`, async (route: Route) => {
        const method = route.request().method();
        if (method === 'GET' && route.request().url().includes('/preview')) {
            a.gets++;
            return json(route, 200, PREVIEW);
        }
        if (method !== 'POST') return route.fallback();
        const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        a.posts.push(body);
        if (a.gate) await a.gate;
        const own = a.reply?.(body);
        if (own) {
            if (own.status === 404) fb.waiting = (fb.waiting ?? []).filter(w => (w as { id: string }).id !== ID);
            return json(route, own.status, own.body, own.headers);
        }
        fb.waiting = (fb.waiting ?? []).filter(w => (w as { id: string }).id !== ID);
        const parent = fb.head;
        if (body.do === 'import') {
            const head = moveHead(fb);
            return json(route, 200, { input: 'I0042', answer: 'import', values: 512, persons: 138, backup: true, head, parent });
        }
        return json(route, 200, { input: 'I0042', answer: 'own', head: parent, parent });
    });
    return a;
}

interface Opts { long?: boolean; features?: string[]; width?: number; lang?: string }

async function research(page: Page, opts: Opts = {}): Promise<{ fb: FakeBridge; imp: ImportBridge }> {
    const width = opts.width ?? 1440;
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width, height: width > 640 ? 900 : 844 });
    await openResearch(page);
    const fb = await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, features: opts.features ?? FEATURES, treeGed: researchGed(),
        waiting: [
            askItem(opts.long),
            { id: 'T0001', order: 1, what: 'Napsat faře v Pomněnkově', kind: 'letter', section: 'letter', at: '2026-11-26T09:00:00Z',
                group: { key: 'to:Fara Pomněnkov', name: 'Fara Pomněnkov', kind: 'office' }, actions: ['answer'] },
        ],
    });
    const imp = await importRoute(page, fb);
    await poll(page);
    if (opts.lang) await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), opts.lang);
    return { fb, imp };
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-waiting');
const itemOf = (page: Page) => sec(page).locator(`.research-overview__waiting-item[data-id="${ID}"]`);

async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(sec(page)).toBeVisible();
}

/**
 * The overview drawn for the last time before measuring (it draws again from timers a moment after a poll, as in
 * overview-waiting-books.spec.ts): the timers due run at once, then nothing may draw it again for 300 ms.
 */
async function overviewStill(page: Page): Promise<void> {
    await page.clock.fastForward(2000);
    const draws = () => page.evaluate(() => {
        const w = window as unknown as { __ovDraws?: number };
        if (w.__ovDraws === undefined) {
            w.__ovDraws = 0;
            new MutationObserver(ms => { if (ms.some(m => (m.target as HTMLElement).id === 'research-overview')) w.__ovDraws!++; })
                .observe(document.body, { childList: true, subtree: true });
        }
        return w.__ovDraws;
    });
    let seen = await draws();
    let since = Date.now();
    await expect.poll(async () => {
        const now = await draws();
        if (now !== seen) { seen = now; since = Date.now(); }
        return Date.now() - since;
    }, { intervals: [100], timeout: 10_000 }).toBeGreaterThanOrEqual(300);
}

async function openItem(page: Page) {
    const item = itemOf(page);
    if (!(await item.isVisible())) {
        const group = sec(page).locator('.research-overview__phase[data-phase="todo"] .research-overview__waiting-group:has([data-id="' + ID + '"])');
        if (await group.getAttribute('aria-expanded') === 'false') await group.click();
    }
    if (!(await item.getAttribute('class'))?.includes('is-open')) await item.locator('.research-overview__waiting-row').click();
    await expect(item).toHaveClass(/is-open/);
    return item;
}

test.describe('the import question in Awaiting action', () => {
    test('the question with the day, the count and three people; opened, what changes and what stays, the meaning; no mark', async ({ page }) => {
        const { imp } = await research(page);
        await openOverview(page);
        const item = itemOf(page);
        await expect(item.locator('.research-overview__waiting-row')).toContainText('Did this come from a family tree (import, merge)?');
        await expect(item.locator('.research-overview__waiting-row')).toContainText('11/25/2026 · 142 people: Vratislav Pomněnkový, Ludmila Kapradinová, Anežka Bezinková');
        // A decision.
        await expect(sec(page).locator('.research-overview__waiting-filters .research-overview__filter')).toContainText([/Decisions\s*1/]);
        expect(imp.gets).toBe(0);
        await openItem(page);
        // The day, the count and the three people once (1128): in the row, not again in the detail.
        await expect(item.locator('.research-overview__import-ask')).not.toContainText('Ludmila Kapradinová');
        await expect(item.locator('.research-overview__waiting-detail')).not.toContainText('11/25/2026');
        await expect(item.locator('.research-overview__waiting-detail')).not.toContainText('142 people');
        await expect(item.locator('.research-overview__import-change')).toHaveText('512 facts go from ✓ to ○○ (138 people).');
        await expect(item.locator('.research-overview__import-stay'))
            .toHaveText('21 facts stay ✓: 15 edited since the send, 4 confirmed, 2 an earlier value (an accepted proposal, an undo).');
        expect(imp.gets).toBe(1);
        await expect(item.locator('.research-overview__import-meaning')).toContainText('✓ confirmed by a person – ○○ from a family tree, not verified against a record.');
        await expect(item.locator('.research-overview__import-help')).toHaveText('What the marks mean');
        await expect(item.locator('.research-overview__import-actions button')).toHaveText(['Yes, from a family tree', 'No, written by hand']);
        await expect(item.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await expect(item.locator('[data-action="answer"]')).toHaveCount(0);
        // The marks' help: the reliability topic.
        await item.locator('.research-overview__import-help').click();
        await expect(page.locator('.help-modal')).toBeVisible();
    });

    test('Yes: POST {do: import}, its button works till the answer, the item goes, the toast says what changed, the tree loaded again', async ({ page }) => {
        const { fb, imp } = await research(page);
        await openOverview(page);
        const item = await openItem(page);
        let open!: () => void;
        imp.gate = new Promise<void>(r => { open = r; });
        const yes = item.locator('[data-action="import-import"]');
        await yes.click();
        await expect(yes).toHaveAttribute('aria-busy', 'true');
        await expect(item.locator('[data-action="import-own"]')).toHaveAttribute('aria-disabled', 'true');
        open();
        await expect(itemOf(page)).toHaveCount(0);
        expect(imp.posts).toEqual([{ do: 'import' }]);
        await expect(page.locator('.toast[data-kind="import-ask"]')).toHaveText('512 facts are now ○○ from a family tree (138 people).');
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(fb.head);
        expect(fb.head).not.toBe(HEAD);
        await poll(page);
        await expect(itemOf(page)).toHaveCount(0);
        await expect(sec(page).locator('.research-overview__waiting-item[data-id="T0001"]')).toHaveCount(1);
    });

    test('No: POST {do: own}, the item goes, the toast says it does not come again', async ({ page }) => {
        const { fb, imp } = await research(page);
        await openOverview(page);
        await (await openItem(page)).locator('[data-action="import-own"]').click();
        await expect(itemOf(page)).toHaveCount(0);
        expect(imp.posts).toEqual([{ do: 'own' }]);
        await expect(page.locator('.toast[data-kind="import-ask"]')).toHaveText('Kept as written by hand. The question does not come again.');
        expect(fb.head).toBe(HEAD);
    });

    test('answered elsewhere (404 waiting.none): the item goes and a toast says why; busy (503): why at the item, with Try again', async ({ page }) => {
        const { imp } = await research(page);
        await openOverview(page);
        let item = await openItem(page);
        imp.reply = () => ({ status: 503, body: { error: 'research.busy', code: 'research.busy' }, headers: { 'retry-after': '30' } });
        await item.locator('[data-action="import-import"]').click();
        await expect(item.locator('.research-direction__problem')).toHaveText(/The research is busy; it can be tried again in 30 s\./);
        await expect(item.locator('.research-direction__problem .research-direction__retry')).toBeVisible();
        imp.reply = () => ({ status: 404, body: { error: 'waiting.none', code: 'waiting.none' } });
        item = await openItem(page);
        await item.locator('[data-action="import-own"]').click();
        await expect(itemOf(page)).toHaveCount(0);
        await expect(page.locator('.toast[data-kind="import-ask"]')).toHaveText('The question was answered elsewhere or no longer waits.');
        expect(imp.posts).toEqual([{ do: 'import' }, { do: 'own' }]);
    });

    test('the small panel: the question and Decide ⤢, which opens the overview at the item', async ({ page }) => {
        const { fb } = await research(page);
        await page.route(`${BRIDGE}/events*`, route => route.fulfill({
            status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream' },
            body: `event: hello\ndata: ${JSON.stringify({ tree: { id: UUID, name: 'Fíškovi' }, head: HEAD, links: LINKS, accepts: ACCEPTS, working: [],
                waiting: fb.waiting, features: FEATURES })}\n\n`,
        }));
        expect(await page.evaluate(() => (window.Strom.UI as unknown as { startFollowLive(o: string): Promise<string> }).startFollowLive('menu'))).toBe('on');
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        const panel = page.locator('#live-panel');
        await expect(panel).toContainText('Did this come from a family tree (import, merge)?');
        await expect(panel).toContainText('142 people: Vratislav Pomněnkový, Ludmila Kapradinová, Anežka Bezinková');
        const decide = panel.locator('.live-waiting-answer[data-action="import-open"]');
        await expect(decide).toHaveText('Decide ⤢');
        await expect(decide.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await decide.click();
        await expect(itemOf(page)).toHaveClass(/is-open/);
        await expect(itemOf(page).locator('[data-action="import-import"]')).toBeVisible();
    });

    test('without waiting.import: no question, nothing asked of the bridge', async ({ page }) => {
        const { imp } = await research(page, { features: ['waiting.groups'] });
        await openOverview(page);
        await expect(itemOf(page)).toHaveCount(0);
        await expect(sec(page).locator('.research-overview__waiting-item[data-id="T0001"]')).toHaveCount(1);
        expect(imp.gets).toBe(0);
    });

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark, long names: nothing spills, nothing overlaps`, async ({ page }) => {
            await research(page, { width, long: true, lang: 'de' });
            await openOverview(page);
            const item = await openItem(page);
            await expect(item.locator('.research-overview__waiting-row')).toContainText('Stammt das aus einem Stammbaum (Import, Zusammenführung)?');
            await expect(item.locator('.research-overview__waiting-row')).toContainText(LONG);
            await expect(item.locator('.research-overview__import-change')).toBeVisible();
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                await overviewStill(page);
                await item.scrollIntoViewIfNeeded();
                const spill = await item.evaluate((o) => [o, ...o.querySelectorAll<HTMLElement>('*')]
                    .filter(n => n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0 && !['hidden', 'clip'].includes(getComputedStyle(n).overflowX))
                    .map(n => `${n.className} ${n.scrollWidth}/${n.clientWidth}`));
                expect(spill).toEqual([]);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
                const boxes = await item.locator('.research-overview__import-ask > *, .research-overview__import-help, .research-overview__import-actions button')
                    .evaluateAll(els => els.filter(e => e.getClientRects().length > 0).map(e => { const r = e.getBoundingClientRect(); return { c: e.className, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
                const outer = (await item.boundingBox())!;
                for (const b of boxes) {
                    expect(b.l, b.c).toBeGreaterThanOrEqual(outer.x - 0.5);
                    expect(b.r, b.c).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
                }
                // The lines of the box one under another, the buttons side by side or wrapped: none over another.
                const flat = boxes.filter(b => !b.c.includes('import-help'));
                for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) {
                    const p = flat[i], q = flat[j];
                    const overlap = Math.min(p.r, q.r) - Math.max(p.l, q.l) > 0.5 && Math.min(p.b, q.b) - Math.max(p.t, q.t) > 0.5;
                    expect(overlap, `${p.c} / ${q.c}`).toBe(false);
                }
                if (width === 390) {
                    const small = await item.locator('.research-overview__import-actions button')
                        .evaluateAll(els => els.filter(e => e.getBoundingClientRect().height < 44).map(e => `${e.className} ${e.getBoundingClientRect().height}`));
                    expect(small).toEqual([]);
                }
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/import-de-${width}-${scheme}.png` });
            }
        });
    }
});
