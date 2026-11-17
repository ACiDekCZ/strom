import { test, expect, Page, Route } from '@playwright/test';
import { BRIDGE, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * "Faster by downloading" (spec 105 §3, §5): the books the research offers
 * to download that nothing waits for, at the end of Awaiting action, folded,
 * never counted (the section's title stays); open, the sentence with
 * Settings… (Research for this tree at Books), a row per book in the order of
 * "Most tasks" (its line, what can be downloaded, the archive's website ↗,
 * its folder without a mark), its details under its title and "and N more";
 * only under All or Images, searching only the books that match; under
 * nothing when nothing waits. The small panel with the books: the order and
 * "Groups: … ▾", the books' heads compact, "No book", and the line "Faster by
 * downloading · N books ⤢" that opens the overview with it open. A phone:
 * the title wraps, the actions 44px. Invented books and archives; a fake
 * bridge; a fixed clock.
 */

test.use({ timezoneId: 'Europe/Prague' });

const NOW = new Date('2026-11-10T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat', 'task', 'book'];
const FEATURES = ['waiting.groups', 'books'];
const LONG = 'Matrika narozených a oddaných farnosti Horní Vzorov'; // ≈ 50 characters

const archive = { key: 'repo:R0001', name: 'Archiv ve Vzorově', kind: 'archive', url: 'https://archiv-vzorov.example/' };
const office = { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' };

const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

/** One book something waits for (B0003), letters without a book, one reply awaited. */
function waiting(): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [
        { id: 'T0001', what: 'Uložit snímky matriky Vzorov 3 (křest)', kind: 'images', section: 'images', group: archive, at: minAgo(25), book: 'B0003', actions: ['folder'] },
        { id: 'T0002', what: 'Uložit snímky matriky Vzorov 3 (sňatek)', kind: 'images', section: 'images', group: archive, at: minAgo(180), book: 'B0003', actions: ['folder'] },
        { id: 'T0004', what: 'Napsat úřadu o úmrtí', kind: 'letter', section: 'letter', group: office, to: 'MěÚ Vzorov', at: minAgo(2 * 1440), actions: ['answer'] },
        { id: 'T0005', what: 'Napsat úřadu o sňatku', kind: 'letter', section: 'letter', group: office, to: 'MěÚ Vzorov', at: minAgo(3 * 1440), actions: ['answer'] },
        { id: 'T0007', what: 'Odeslaný dopis úřadu', kind: 'letter', section: 'letter', group: office, phase: 'sent', sentAt: minAgo(4 * 1440), at: minAgo(5 * 1440), actions: ['answer'] },
    ];
    return items.map((w, i) => ({ order: i, ...w }));
}

function booksPart(): Record<string, unknown> {
    return {
        settings: { minTasks: 5, minTasksOwn: false, minTasksDefault: 5, sameBook: 'no', sameBookOwn: false, sameBookDefault: 'no' },
        list: [
            {
                id: 'B0003', title: 'Matrika Vzorov 3, N', years: '1784-1820', folder: 'B0003 Matrika Vzorov 3',
                archive: { id: 'R0001', name: 'Archiv ve Vzorově' }, access: 'online-free', url: 'https://archiv-vzorov.example/kniha/3',
                tasks: 16, waiting: 2, open: 13, parked: 1, images: 516, onDisk: 303, missing: 213, download: 'whole', offer: true,
            },
            {
                id: 'B0008', title: 'Pozemková kniha Lhota', folder: 'B0008 Pozemková kniha Lhota',
                archive: { id: 'R0002', name: 'Zemský archiv v Lhotě', url: 'https://zemsky-lhota.example/' }, access: 'online-login',
                tasks: 8, waiting: 0, open: 7, parked: 1, onDisk: 4, download: 'selected', need: '14, 88, 203', needCount: 3, offer: true, pending: 12,
            },
            {
                id: 'B0009', title: LONG, folder: 'B0009 Matrika Horní Vzorov',
                archive: { id: 'R0001', name: 'Archiv ve Vzorově' }, access: 'online-free', url: 'https://archiv-vzorov.example/kniha/9',
                tasks: 11, waiting: 0, open: 11, parked: 0, images: 727, onDisk: 0, missing: 727, download: 'range', need: '31-36', needCount: 6, offer: true,
            },
            {
                id: 'B0010', title: 'Sčítání Vzorov 1880', archive: { name: 'Archiv ve Vzorově' },
                tasks: 9, waiting: 0, open: 9, parked: 0, onDisk: 0, download: 'none',
            },
        ],
        more: 3,
    };
}

async function researchTree(page: Page, opts: { items?: Record<string, unknown>[]; width?: number; height?: number; features?: string[] } = {}): Promise<void> {
    const width = opts.width ?? 1440;
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width, height: opts.height ?? (width > 640 ? 900 : 844) });
    await openResearch(page);
    await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, waiting: opts.items ?? waiting(), features: opts.features ?? FEATURES, treeGed: researchGed(),
        books: { books: booksPart(), posts: [] },
    });
    await poll(page);
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-waiting');
const secTitle = (page: Page) => ov(page).locator('[aria-controls="ov-sec-waiting"] .live-section__title');
const urgentHead = (page: Page) => sec(page).locator('.research-overview__urgent-head');
const urgentRows = (page: Page) => sec(page).locator('.research-overview__urgent-book');
const urgentRow = (page: Page, id: string) => sec(page).locator(`.research-overview__urgent-book[data-book="${id}"]`);

async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(ov(page)).toBeVisible();
    await expect(sec(page)).toBeVisible();
}

async function recordLaunches(page: Page): Promise<void> {
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}
const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

/** Nothing of the section wider than its box (a 1 px rounding allowed) and no page scrolled sideways. */
async function noOverflow(page: Page, scope: string): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const over = await page.locator(scope).evaluate(el => [...el.querySelectorAll<HTMLElement>(
        '.research-overview__urgent-book, .research-overview__urgent-toggle, .research-overview__urgent-meta, .research-overview__urgent-actions, .research-overview__urgent-text, .live-waiting-grouphead, .live-waiting-urgent')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
    expect(over).toEqual([]);
}

test.describe('Faster by downloading', () => {
    test('folded at the end, never counted; open: the sentence, the books by their tasks with their lines, offers and actions, and N more', async ({ page }) => {
        await researchTree(page);
        await recordLaunches(page);
        await openOverview(page);
        await expect(secTitle(page)).toHaveText('Awaiting action · 4');
        // After the phases, folded.
        await expect(urgentHead(page)).toHaveText(/Faster by downloading\s*· 2 books/);
        await expect(urgentHead(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(urgentRows(page)).toHaveCount(0);
        const after = await sec(page).evaluate(el => {
            const heads = [...el.querySelectorAll('.research-overview__phase-head')];
            return heads[heads.length - 1].classList.contains('research-overview__urgent-head');
        });
        expect(after).toBe(true);

        await urgentHead(page).click();
        await expect(urgentHead(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(sec(page).locator('.research-overview__urgent-text')).toContainText('Images saved to the book’s folder are read by the agent from disk');
        // Only the offered books nothing waits for (B0003 is waited for, B0010 not offered), by their tasks.
        expect(await urgentRows(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.book))).toEqual(['B0009', 'B0008']);
        const long = urgentRow(page, 'B0009');
        await expect(long.locator('.research-overview__urgent-title')).toHaveText(LONG);
        await expect(long.locator('.research-overview__urgent-meta')).toHaveText(/Archiv ve Vzorově\s*·\s*11 tasks in the queue\s*·\s*727 images\s*·\s*on disk 0\s*·\s*missing 727/);
        await expect(long.locator('.research-overview__book-offer')).toHaveText('Images 31–36 can be downloaded · 6 images');
        const lhota = urgentRow(page, 'B0008');
        // Images unknown: on disk without missing; the files to be taken in; the sign-in.
        await expect(lhota.locator('.research-overview__urgent-meta')).toHaveText(/Zemský archiv v Lhotě\s*·\s*7 tasks in the queue\s*·\s*on disk 4\s*·\s*12 files to be taken in\s*·\s*archive website requires sign-in/);
        await expect(lhota.locator('.research-overview__book-offer')).toHaveText('Selected images 14, 88, 203 can be downloaded · 3 images');
        // The archive's website (its own address without a viewer), the folder without any mark.
        await expect(lhota.locator('a.research-overview__waiting-archiveweb')).toHaveAttribute('href', 'https://zemsky-lhota.example/');
        const folder = lhota.locator('.research-overview__book-folder');
        await expect(folder).toHaveText('Open folder');
        await expect(folder.locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        await folder.click();
        expect((await launched(page)).some(u => u.includes('book?') && u.includes('id=B0008') && u.includes('do=folder'))).toBe(true);
        await expect(sec(page).locator('.research-overview__urgent-more')).toHaveText('and 3 more books are in the research');
        // Still the same counts.
        await expect(secTitle(page)).toHaveText('Awaiting action · 4');

        // A click on its title: the details.
        await lhota.locator('.research-overview__urgent-toggle').click();
        const dl = urgentRow(page, 'B0008').locator('.research-overview__urgent-detail');
        await expect(dl.locator('dt')).toHaveText(['Tasks', 'Folder', 'Access']);
        await expect(dl.locator('dd')).toHaveText(['8 · 1 parked', 'B0008 Pozemková kniha Lhota', 'archive website requires sign-in']);
        await urgentRow(page, 'B0008').locator('.research-overview__urgent-toggle').click();
        await expect(urgentRow(page, 'B0008').locator('.research-overview__urgent-detail')).toHaveCount(0);
        await noOverflow(page, '#ov-sec-waiting');
    });

    test('only under All and Images; searching, the books whose title or archive match', async ({ page }) => {
        const items = [
            ...waiting(),
            // Enough items for the section's search field.
            ...Array.from({ length: 6 }, (_, i) => ({ id: `T00${20 + i}`, order: 20 + i, what: `Napsat úřadu ${i + 1}`, kind: 'letter', section: 'letter', group: office, to: 'MěÚ Vzorov', actions: ['answer'] })),
        ];
        await researchTree(page, { items });
        await openOverview(page);
        await expect(urgentHead(page)).toBeVisible();
        await sec(page).locator('.research-overview__filter[data-filter="letter"]').click();
        await expect(urgentHead(page)).toHaveCount(0);
        await sec(page).locator('.research-overview__filter[data-filter="images"]').click();
        await expect(urgentHead(page)).toBeVisible();
        await sec(page).locator('.research-overview__filter[data-filter="all"]').click();

        const field = sec(page).locator('.research-overview__section-search-input');
        await field.fill('Lhotě');
        // Searching opens what matched.
        await expect(urgentHead(page)).toHaveText(/· 1 book$/);
        expect(await urgentRows(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.book))).toEqual(['B0008']);
        await expect(sec(page).locator('.research-overview__urgent-more')).toHaveCount(0);
        await field.fill('farnosti');
        expect(await urgentRows(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.book))).toEqual(['B0009']);
        await field.fill('úmrtí');
        await expect(urgentHead(page)).toHaveCount(0);
    });

    test('Settings… opens Research for this tree at Books, open and highlighted', async ({ page }) => {
        await researchTree(page);
        await openOverview(page);
        await urgentHead(page).click();
        await sec(page).locator('.research-overview__urgent-settings').click();
        const group = page.locator('#research-books-group');
        await expect(group).toBeVisible();
        await expect(group).toHaveAttribute('open', '');
        await expect(group).toHaveClass(/is-flash/);
    });

    test('nothing waits, books offered: the section at 0 with the part folded; without the feature no section', async ({ page }) => {
        await researchTree(page, { items: [] });
        await openOverview(page);
        await expect(secTitle(page)).toHaveText('Awaiting action · 0');
        await expect(urgentHead(page)).toHaveText(/· 2 books/);
        await expect(urgentHead(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(sec(page).locator('.research-overview__order, .research-overview__phase-head:not(.research-overview__urgent-head)')).toHaveCount(0);
    });

    test('without the books feature: no part, as before', async ({ page }) => {
        await researchTree(page, { features: ['waiting.groups'] });
        await openOverview(page);
        await expect(sec(page).locator('.research-overview__urgent, .research-overview__urgent-head')).toHaveCount(0);
    });

    for (const size of [{ width: 390, height: 844, name: 'a phone' }, { width: 844, height: 390, name: 'a phone held sideways' }]) {
        test(`${size.name}: the title wraps whole, the actions 44px, nothing wider than the screen`, async ({ page }) => {
            await researchTree(page, size);
            await openOverview(page);
            await urgentHead(page).click();
            const title = urgentRow(page, 'B0009').locator('.research-overview__urgent-title');
            await expect(title).toHaveText(LONG);
            expect(await title.evaluate(e => getComputedStyle(e).whiteSpace)).toBe('normal');
            expect(await title.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
            // 44px where touched (a phone; held sideways it is touched too, `pointer: coarse`).
            for (const sel of size.width <= 640 ? ['a.research-overview__waiting-archiveweb', '.research-overview__book-folder'] : []) {
                const box = await urgentRow(page, 'B0009').locator(sel).boundingBox();
                expect(box!.height, sel).toBeGreaterThanOrEqual(44);
            }
            await noOverflow(page, '#ov-sec-waiting');
        });
    }
});

/** The research followed live (its events quiet), the small panel shown. */
async function follow(page: Page, opts: { width?: number; height?: number; features?: string[] } = {}): Promise<void> {
    const width = opts.width ?? 1440;
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width, height: opts.height ?? 900 });
    await page.addInitScript((announced) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
    }, LINKS);
    const items = [
        ...waiting(),
        { id: 'T0030', order: 30, what: 'Rozhodnout o otci', kind: 'other', section: 'other', at: minAgo(60) },
        { id: 'T0031', order: 31, what: 'Napsat faře', kind: 'letter', section: 'letter', group: office, to: 'MěÚ Vzorov', at: minAgo(70) },
    ];
    await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, waiting: items, features: opts.features ?? FEATURES, treeGed: researchGed(),
        books: { books: booksPart(), posts: [] },
    });
    await openResearch(page);
    await poll(page);
    await page.route(`${BRIDGE}/events*`, (route: Route) => new Promise<void>(() => { void route; }));
    await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
    await expect(page.locator('#live-panel')).toBeVisible();
}

test.describe('the small panel with the books', () => {
    test('the order and "Groups: … ▾"; by book compact heads and "No book"; Waiting N as before; the offer\'s line opens the overview with it open', async ({ page }) => {
        await follow(page);
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-panel-heading-waiting .live-section__title')).toHaveText('Awaiting action · 6');
        // By archive (the default): the places' heads, the first five rows.
        await expect(panel.locator('.live-waiting-row')).toHaveCount(5);
        await expect(panel.locator('.live-waiting-more')).toHaveText('1 more in the overview ⤢');
        const groups = panel.locator('.research-overview__groups-btn');
        await expect(groups).toHaveAttribute('aria-label', 'Groups: Archive');
        await groups.click();
        const menu = page.getByRole('menu', { name: 'Groups' });
        await expect(menu.getByRole('menuitemradio')).toHaveText([/Archive/, /Book/]);
        await menu.getByRole('menuitemradio', { name: 'Book' }).click();
        await expect(groups).toHaveAttribute('aria-label', 'Groups: Book');
        const head = panel.locator('.live-waiting-grouphead.is-book');
        await expect(head).toHaveCount(1);
        await expect(head.locator('.live-waiting-grouptitle')).toHaveText('Matrika Vzorov 3, N 1784–1820');
        await expect(head.locator('.live-waiting-groupwait')).toHaveText('2 waiting');
        await expect(head.locator('.live-waiting-groupcount')).toHaveText('2');
        // The book's rows hang on its line under its band (U4 §2, D1); a short title has no "more".
        await expect(panel.locator('.live-waiting-grouphead.is-book + ul.live-waiting')).toHaveClass(/is-grouped/);
        await expect(head.locator('.research-overview__group-more')).toBeHidden();
        // The book's actions stay in the overview.
        await expect(panel.locator('.research-overview__book-folder, .research-overview__book-meta')).toHaveCount(0);
        await expect(panel.locator('.live-waiting-nobook')).toHaveText('No book');
        await expect(panel.locator('.live-waiting-row')).toHaveCount(5);
        await expect(panel.locator('.live-panel-heading-waiting .live-section__title')).toHaveText('Awaiting action · 6');
        // The order's choices with the books.
        await panel.locator('.research-overview__order-btn:not(.research-overview__groups-btn)').click();
        await expect(page.getByRole('menu', { name: 'Order' }).getByRole('menuitemradio')).toHaveText([/Recommended/, /Newest first/, /Oldest first/, /Most tasks/]);
        await page.keyboard.press('Escape');

        const line = panel.locator('.live-waiting-urgent');
        await expect(line).toHaveText('Faster by downloading · 2 books ⤢');
        await noOverflow(page, '#live-panel');
        await line.click();
        await expect(ov(page)).toBeVisible();
        await expect(urgentHead(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(urgentRows(page)).toHaveCount(2);
    });

    test('without the books feature: the panel as before, no buttons, heads or line', async ({ page }) => {
        await follow(page, { features: ['waiting.groups'] });
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-waiting-row')).toHaveCount(5);
        await expect(panel.locator('.research-overview__order, .live-waiting-grouphead, .live-waiting-nobook, .live-waiting-urgent')).toHaveCount(0);
    });
});
