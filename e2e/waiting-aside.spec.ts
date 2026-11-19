import { test, expect, Page, Route } from '@playwright/test';
import { BRIDGE, HEAD, UUID, fakeBridge, openResearch, poll, researchGed, type FakeBridge } from './research-bridge.js';

/**
 * Files of a book's inbox set aside (`inbox.aside`, Strom Research 1.36) in
 * Awaiting action: each one a decision under its book (by archive too), its
 * sentence, the saved image it is compared with and the book's folder (no
 * mark: the bridge, no terminal); 'other' answered Keep / The new file is
 * image n / Another number…, 'same' only the bin, each through
 * `POST books/aside` with its button working meanwhile; the answer's list
 * replaces the books' files, 404 makes the item go without a word, 409 says
 * why at the item; the small panel's Decide ⤢ opens the overview at the item;
 * without the feature nothing new. German at 1440/1024/390, light and dark,
 * long names: nothing spills. Invented books and files (Lhota, Lhoták); a
 * fake bridge; a fixed clock.
 */

test.use({ timezoneId: 'Europe/Prague' });

const NOW = new Date('2026-11-19T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat', 'task', 'book'];
const FEATURES = ['waiting.groups', 'books', 'inbox.aside'];
const archive = { key: 'repo:R0001', name: 'Archiv v Lhotě', kind: 'archive' };
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const LONG_BOOK = 'Matrika Lhota u Lhotáku 12, N O Z';
const LONG_FILE = '0003_matrika-lhota-u-lhotaku-sken-strana-203-opraveny.jpg.other-than-M0042';

interface Opts { long?: boolean; features?: string[]; width?: number; lang?: string }

function asideList(long = false): Record<string, unknown>[] {
    return [
        { file: long ? LONG_FILE : '3.jpg.other-than-M0042', recordset: 'B0001', image: 3, kind: 'other', media: 'M0042', at: minAgo(10) },
        { file: '10.jpg.same-as-M0041', recordset: 'B0001', image: 10, kind: 'same', media: 'M0041', at: minAgo(25) },
    ];
}

function booksPart(long = false): Record<string, unknown> {
    return {
        settings: { minTasks: 5, minTasksOwn: false, minTasksDefault: 5, sameBook: 'no', sameBookOwn: false, sameBookDefault: 'no' },
        list: [{
            id: 'B0001', title: long ? LONG_BOOK : 'Matrika Lhota 1, N', years: '1784-1820', folder: 'B0001 Matrika Lhota 1',
            archive: { id: 'R0001', name: 'Archiv v Lhotě' }, access: 'online-free',
            tasks: 6, waiting: 1, open: 5, parked: 0, onDisk: 12, download: 'none',
        }],
        more: 0,
        aside: asideList(long),
    };
}

/** What the fake research does with an answer: the body, and how it answers (default: done, the file gone from the list). */
interface AsideBridge {
    posts: Record<string, unknown>[];
    reply: ((body: Record<string, unknown>) => { status: number; body: unknown } | null) | null;
    /** Answers wait for this (a button's working state seen meanwhile). */
    gate: Promise<void> | null;
}

async function asideRoute(page: Page, fb: FakeBridge): Promise<AsideBridge> {
    const a: AsideBridge = { posts: [], reply: null, gate: null };
    const cors = { 'access-control-allow-origin': '*' };
    await page.route(`${BRIDGE}/books/aside*`, async (route: Route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        a.posts.push(body);
        if (a.gate) await a.gate;
        const books = fb.books!.books;
        const left = (books.aside as Record<string, unknown>[]).filter(x => x.file !== body.file);
        const own = a.reply?.(body);
        if (own) {
            // Answered elsewhere meanwhile: the research's list says it gone too.
            if (own.status === 404) fb.books!.books = { ...books, aside: left };
            return route.fulfill({ status: own.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(own.body) });
        }
        fb.books!.books = { ...books, aside: left };
        return route.fulfill({
            status: 200, headers: { ...cors, 'content-type': 'application/json' },
            body: JSON.stringify({ done: body.do, added: body.do === 'discard' ? [] : ['M0050'], replaced: body.do === 'take' ? ['M0042'] : [], aside: left }),
        });
    });
    return a;
}

async function research(page: Page, opts: Opts = {}): Promise<{ fb: FakeBridge; aside: AsideBridge }> {
    const width = opts.width ?? 1440;
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width, height: width > 640 ? 900 : 844 });
    await openResearch(page);
    const fb = await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, features: opts.features ?? FEATURES, treeGed: researchGed(),
        waiting: [{ id: 'T0001', order: 0, what: 'Uložit snímky 20–21 matriky Lhota 1', kind: 'images', section: 'images', group: archive, at: minAgo(60), book: 'B0001', actions: ['folder'] }],
        books: { books: booksPart(opts.long), posts: [] },
    });
    const aside = await asideRoute(page, fb);
    await poll(page);
    if (opts.lang) await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), opts.lang);
    return { fb, aside };
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-waiting');
const itemOf = (page: Page, file: string) => sec(page).locator(`.research-overview__waiting-item[data-id="aside:B0001/${file}"]`);
const OTHER = 'aside:B0001/3.jpg.other-than-M0042';

async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(sec(page)).toBeVisible();
}

async function openItem(page: Page, file: string) {
    const group = sec(page).locator('.research-overview__phase[data-phase="todo"] .research-overview__waiting-group[data-group="book:B0001"]');
    if (await group.getAttribute('aria-expanded') === 'false') await group.click();
    const item = itemOf(page, file);
    if (!(await item.getAttribute('class'))?.includes('is-open')) await item.locator('.research-overview__waiting-row').click();
    await expect(item).toHaveClass(/is-open/);
    return item;
}

async function recordLaunches(page: Page): Promise<void> {
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}
const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

test.describe('files of a book\'s inbox set aside in Awaiting action', () => {
    test('under their book (by archive too), a decision each; the saved image, the book\'s folder without a mark, the answers of their kind', async ({ page }) => {
        await research(page);
        await openOverview(page);
        // By archive (the default): the task under its archive, the files under their book.
        const groups = await sec(page).locator('.research-overview__phase[data-phase="todo"] .research-overview__waiting-group')
            .evaluateAll(els => els.map(e => (e as HTMLElement).dataset.group));
        expect(groups).toEqual(['book:B0001', 'repo:R0001']);
        await expect(sec(page).locator('.research-overview__nobook')).toHaveCount(0);
        // Counted as decisions: the section's chips.
        await expect(sec(page).locator('.research-overview__waiting-filters .research-overview__filter')).toHaveText([/^All\s*3$/, /^Decisions\s*2$/, /^Images\s*1$/]);

        const other = await openItem(page, '3.jpg.other-than-M0042');
        await expect(other.locator('.research-overview__waiting-row')).toContainText('3.jpg.other-than-M0042: a different scan than image 3 of the book Matrika Lhota 1, N');
        await expect(other.locator('.research-overview__waiting-inbox')).toHaveText('Saved image 3: M0042');
        const folder = other.locator('.research-overview__book-folder');
        await expect(folder).toHaveText('Open the book’s folder');
        await expect(folder.locator('.research-open-mark, .research-ai-badge, svg')).toHaveCount(0);
        await recordLaunches(page);
        await folder.click();
        expect((await launched(page))[0]).toMatch(/^strom-research:\/\/book\?tree=[^&]+&id=B0001&do=folder$/);
        await expect(other.locator('.research-overview__aside-actions button')).toHaveText(['Keep image 3', 'The new file is image 3', 'Another number…']);
        // Through the bridge: no mark at any answer.
        await expect(other.locator('.research-overview__aside-actions .research-open-mark, .research-overview__aside-actions .research-ai-badge')).toHaveCount(0);

        const same = await openItem(page, '10.jpg.same-as-M0041');
        await expect(same.locator('.research-overview__waiting-row')).toContainText('10.jpg.same-as-M0041: the same scan as image M0041 under another number – one of the numbers is wrong');
        await expect(same.locator('.research-overview__aside-actions button')).toHaveText(['File to the bin']);
        // Never "Answer (research)" here.
        await expect(sec(page).locator(`.research-overview__waiting-item[data-id^="aside:"] [data-action="answer"]`)).toHaveCount(0);
    });

    test('Keep: its button works till the answer, the item goes at once and the list is the answer\'s; the toast says it', async ({ page }) => {
        const { fb, aside } = await research(page);
        await openOverview(page);
        const item = await openItem(page, '3.jpg.other-than-M0042');
        let open!: () => void;
        aside.gate = new Promise<void>(r => { open = r; });
        const keep = item.locator('[data-action="aside-discard"]');
        await keep.click();
        await expect(keep).toHaveAttribute('aria-busy', 'true');
        // The other answers wait meanwhile.
        await expect(item.locator('[data-action="aside-take"]')).toHaveAttribute('aria-disabled', 'true');
        open();
        await expect(sec(page).locator(`.research-overview__waiting-item[data-id="${OTHER}"]`)).toHaveCount(0);
        expect(aside.posts).toEqual([{ file: '3.jpg.other-than-M0042', do: 'discard' }]);
        await expect(page.locator('.toast')).toHaveText('The file is in the bin.');
        // The books' files as the answer said them: the other one stays.
        await expect(itemOf(page, '10.jpg.same-as-M0041')).toHaveCount(1);
        expect((fb.books!.books.aside as unknown[]).length).toBe(1);
        await poll(page);
        await expect(sec(page).locator(`.research-overview__waiting-item[data-id="${OTHER}"]`)).toHaveCount(0);
    });

    test('The new file is image n, and the bin for the same scan', async ({ page }) => {
        const { aside } = await research(page);
        await openOverview(page);
        await (await openItem(page, '3.jpg.other-than-M0042')).locator('[data-action="aside-take"]').click();
        await expect(page.locator('.toast')).toHaveText('Image 3 is now the new file.');
        await (await openItem(page, '10.jpg.same-as-M0041')).locator('[data-action="aside-discard"]').click();
        await expect(sec(page).locator('.research-overview__waiting-item[data-id^="aside:"]')).toHaveCount(0);
        expect(aside.posts).toEqual([{ file: '3.jpg.other-than-M0042', do: 'take' }, { file: '10.jpg.same-as-M0041', do: 'discard' }]);
    });

    test('Another number…: the field with Save (only with a number) and Cancel; a number taken says why at the item, the next one is saved', async ({ page }) => {
        const { aside } = await research(page);
        await openOverview(page);
        const item = await openItem(page, '3.jpg.other-than-M0042');
        await item.locator('[data-action="aside-another"]').click();
        const field = item.locator('.research-overview__aside-number input');
        await expect(field).toBeFocused();
        await expect(item.locator('.research-overview__aside-numlabel')).toHaveText('The new file as image number');
        const save = item.locator('[data-action="aside-image"]');
        await expect(save).toHaveAttribute('aria-disabled', 'true');
        // Cancel: back to the three answers.
        await item.locator('.research-overview__aside-cancel').click();
        await expect(item.locator('.research-overview__aside-number')).toHaveCount(0);
        await expect(item.locator('[data-action="aside-another"]')).toBeVisible();

        await item.locator('[data-action="aside-another"]').click();
        aside.reply = (b) => (b.image === 5 ? { status: 409, body: { error: 'aside.taken', code: 'aside.taken' } } : null);
        await field.fill('5');
        await expect(save).toHaveAttribute('aria-disabled', 'false');
        await field.press('Enter');
        const problem = item.locator('.research-direction__problem[role="alert"]');
        await expect(problem).toHaveText('Number 5 already has another scan.');
        // The item stays, the number kept for another try.
        await expect(field).toHaveValue('5');
        await field.fill('7');
        await save.click();
        await expect(sec(page).locator(`.research-overview__waiting-item[data-id="${OTHER}"]`)).toHaveCount(0);
        await expect(page.locator('.toast')).toHaveText('The new file is saved as image 7.');
        expect(aside.posts).toEqual([{ file: '3.jpg.other-than-M0042', do: 'image', image: 5 }, { file: '3.jpg.other-than-M0042', do: 'image', image: 7 }]);
    });

    test('answered elsewhere meanwhile (404): the item goes without a word', async ({ page }) => {
        const { aside } = await research(page);
        await openOverview(page);
        const item = await openItem(page, '10.jpg.same-as-M0041');
        aside.reply = () => ({ status: 404, body: { error: 'aside.unknown', code: 'aside.unknown', aside: [] } });
        await item.locator('[data-action="aside-discard"]').click();
        await expect(itemOf(page, '10.jpg.same-as-M0041')).toHaveCount(0);
        await expect(sec(page).locator('.research-direction__problem')).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: /bin|image/ })).toHaveCount(0);
        await poll(page);
        await expect(itemOf(page, '10.jpg.same-as-M0041')).toHaveCount(0);
    });

    test('the small panel: the file\'s sentence and Decide ⤢, which opens the overview at the item', async ({ page }) => {
        const { fb } = await research(page);
        // Followed through the bridge (its stream's hello as the status says it): the panel's rows answer.
        await page.route(`${BRIDGE}/events*`, route => route.fulfill({
            status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream' },
            body: `event: hello\ndata: ${JSON.stringify({ tree: { id: UUID, name: 'Fíškovi' }, head: HEAD, links: LINKS, accepts: ACCEPTS, working: [],
                waiting: fb.waiting, features: FEATURES, books: fb.books!.books })}\n\n`,
        }));
        expect(await page.evaluate(() => (window.Strom.UI as unknown as { startFollowLive(o: string): Promise<string> }).startFollowLive('menu'))).toBe('on');
        await page.evaluate(() => window.Strom.UI.closeResearchOverview());
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        const panel = page.locator('#live-panel');
        const decide = panel.locator('.live-waiting-answer[data-action="aside-open"]');
        await expect(decide).toHaveCount(2);
        await expect(decide.first()).toHaveText('Decide ⤢');
        await expect(panel.locator('.live-waiting-answer[data-action="aside-open"] .research-open-mark')).toHaveCount(0);
        await decide.first().click();
        const item = sec(page).locator(`.research-overview__waiting-item[data-id="${OTHER}"]`);
        await expect(item).toHaveClass(/is-open/);
        await expect(item.locator('[data-action="aside-take"]')).toBeVisible();
    });

    test('without inbox.aside: no item, the book\'s task as before', async ({ page }) => {
        await research(page, { features: ['waiting.groups', 'books'] });
        await openOverview(page);
        await expect(sec(page).locator('.research-overview__waiting-item[data-id^="aside:"]')).toHaveCount(0);
        await expect(sec(page).locator('.research-overview__waiting-item[data-id="T0001"]')).toHaveCount(1);
    });

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark, long names: nothing spills, nothing overlaps`, async ({ page }) => {
            await research(page, { width, long: true, lang: 'de' });
            await openOverview(page);
            const item = await openItem(page, LONG_FILE);
            await expect(item.locator('.research-overview__waiting-row')).toContainText(`${LONG_FILE}: ein anderer Scan als Bild 3 des Buchs ${LONG_BOOK}`);
            await item.locator('[data-action="aside-another"]').click();
            await item.locator('.research-overview__aside-number input').fill('7');
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                await item.scrollIntoViewIfNeeded();
                const spill = await item.evaluate((o) => [o, ...o.querySelectorAll<HTMLElement>('*')]
                    .filter(n => n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0 && !['hidden', 'clip'].includes(getComputedStyle(n).overflowX))
                    .map(n => `${n.className} ${n.scrollWidth}/${n.clientWidth}`));
                expect(spill).toEqual([]);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
                // The buttons and the field inside the item, none over another.
                const boxes = await item.locator('.research-overview__aside-actions button, .research-overview__aside-number > *, .research-overview__book-folder')
                    .evaluateAll(els => els.filter(e => e.getClientRects().length > 0).map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
                const outer = (await item.boundingBox())!;
                for (const b of boxes) {
                    expect(b.l).toBeGreaterThanOrEqual(outer.x - 0.5);
                    expect(b.r).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
                }
                for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                    const p = boxes[i], q = boxes[j];
                    const overlap = Math.min(p.r, q.r) - Math.max(p.l, q.l) > 0.5 && Math.min(p.b, q.b) - Math.max(p.t, q.t) > 0.5;
                    expect(overlap).toBe(false);
                }
                if (width === 390) {
                    const small = await item.locator('.research-overview__aside-actions button, .research-overview__aside-number button')
                        .evaluateAll(els => els.filter(e => e.getBoundingClientRect().height < 44).map(e => `${e.className} ${e.getBoundingClientRect().height}`));
                    expect(small).toEqual([]);
                }
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/aside-de-${width}-${scheme}.png` });
            }
        });
    }

    test('Czech at 1024: the sentence, the saved image and the answers', async ({ page }) => {
        await research(page, { width: 1024, lang: 'cs' });
        await openOverview(page);
        const item = await openItem(page, '3.jpg.other-than-M0042');
        await expect(item.locator('.research-overview__waiting-row')).toContainText('3.jpg.other-than-M0042: jiný sken než snímek 3 knihy Matrika Lhota 1, N');
        await expect(item.locator('.research-overview__waiting-inbox')).toHaveText('Zapsaný snímek 3: M0042');
        await expect(item.locator('.research-overview__aside-actions button')).toHaveText(['Ponechat snímek 3', 'Nový soubor je snímek 3', 'Jiné číslo…']);
        if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/aside-cs-1024.png` });
    });
});
