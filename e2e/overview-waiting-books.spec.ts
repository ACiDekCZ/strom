import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * Awaiting action by book in the Research overview (spec 105 §1, §2): with
 * the research's books (`books` in the features and its part `books`) the
 * choice of groups Archive | Book [| No groups] in place of the Groups switch
 * (a segment wide, "Groups: Book ▾" and a sheet on a phone), the books'
 * groups with their head (title, Book, how many; archive · waiting · in the
 * queue · images; the offer, the archive's website ↗, the book's folder
 * without a mark, Chat), the places after them under "No book", a book
 * outside the research's list by its title only, the search by a book's
 * title, and the fourth order "Most tasks" (the books by their tasks, its key
 * bold first, no choice of groups); the choices kept on this device and taken
 * from another window; without the feature everything as before. Invented
 * books and archives; a fake bridge; a fixed clock in a fixed time zone.
 */

test.use({ timezoneId: 'Europe/Prague' });

const NOW = new Date('2026-11-10T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat', 'task', 'book'];
const FEATURES = ['waiting.groups', 'books'];

const archive = { key: 'repo:R0001', name: 'Archiv ve Vzorově', kind: 'archive', url: 'https://archiv-vzorov.example/' };
const office = { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' };

const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

/** Two books something waits for (B0003 first in the research's order, B0005 with more tasks), a letter without a book. */
function waiting(): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [
        { id: 'T0001', what: 'Uložit snímky matriky Vzorov 3 (křest)', kind: 'images', section: 'images', group: archive, at: minAgo(25), book: 'B0003', actions: ['chat', 'folder'] },
        { id: 'T0002', what: 'Uložit snímky matriky Vzorov 3 (sňatek)', kind: 'images', section: 'images', group: archive, at: minAgo(180), book: 'B0003', actions: ['chat', 'folder'] },
        { id: 'T0003', what: 'Uložit snímky matriky Vzorov 5', kind: 'images', section: 'images', group: archive, at: minAgo(1440), book: 'B0005', actions: ['folder'] },
        { id: 'T0004', what: 'Napsat úřadu o úmrtí', kind: 'letter', section: 'letter', group: office, to: 'MěÚ Vzorov', at: minAgo(2 * 1440), actions: ['answer'] },
        { id: 'T0007', what: 'Odeslaný dopis úřadu', kind: 'letter', section: 'letter', group: office, phase: 'sent', sentAt: minAgo(4 * 1440), at: minAgo(5 * 1440), actions: ['answer'] },
    ];
    return items.map((w, i) => ({ order: i, ...w }));
}

function booksPart(): Record<string, unknown> {
    return {
        settings: { minTasks: 5, minTasksOwn: false, minTasksDefault: 5, sameBook: 'no', sameBookOwn: false, sameBookDefault: 'no' },
        list: [
            {
                id: 'B0005', title: 'Matrika Vzorov 5, O 1820–1850', folder: 'B0005 Matrika Vzorov 5',
                archive: { id: 'R0001', name: 'Archiv ve Vzorově' }, access: 'online-login',
                tasks: 20, waiting: 1, open: 19, parked: 0, onDisk: 0, download: 'none',
            },
            {
                id: 'B0003', title: 'Matrika Vzorov 3, N', years: '1784-1820', folder: 'B0003 Matrika Vzorov 3',
                archive: { id: 'R0001', name: 'Archiv ve Vzorově', url: 'https://archiv-vzorov.example/' }, access: 'online-free',
                url: 'https://archiv-vzorov.example/kniha/3',
                tasks: 16, waiting: 2, open: 13, parked: 1, images: 516, onDisk: 303, missing: 213, download: 'whole', offer: true,
            },
        ],
        more: 0,
    };
}

async function researchTree(page: Page, opts: { items?: Record<string, unknown>[]; width?: number; height?: number; features?: string[]; books?: Record<string, unknown> } = {}): Promise<void> {
    const width = opts.width ?? 1440;
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width, height: opts.height ?? (width > 640 ? 900 : 844) });
    await openResearch(page);
    await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, waiting: opts.items ?? waiting(), features: opts.features ?? FEATURES, treeGed: researchGed(),
        books: { books: opts.books ?? booksPart(), posts: [] },
    });
    await poll(page);
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-waiting');
const orderBtn = (page: Page) => sec(page).locator('.research-overview__order-btn:not(.research-overview__groups-btn)');
const seg = (page: Page) => sec(page).getByRole('radiogroup', { name: 'Groups' });
const groupsBtn = (page: Page) => sec(page).locator('.research-overview__groups-btn');
const todo = (page: Page) => sec(page).locator('.research-overview__phase[data-phase="todo"]');
const groupKeys = (page: Page, phase = 'todo') =>
    sec(page).locator(`.research-overview__phase[data-phase="${phase}"] .research-overview__waiting-group`).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.group));
const bookHead = (page: Page, id: string, phase = 'todo') =>
    sec(page).locator(`.research-overview__phase[data-phase="${phase}"] .research-overview__waiting-grouphead.is-book:has([data-book="${id}"])`);
const stored = (page: Page) => page.evaluate(() => [localStorage.getItem('strom-live-overview-waiting-order'), localStorage.getItem('strom-live-overview-waiting-groups')]);

async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(ov(page)).toBeVisible();
    await expect(sec(page)).toBeVisible();
}

async function closeOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.closeResearchOverview());
    await expect(ov(page)).toHaveCount(0);
}

async function chooseOrder(page: Page, name: string): Promise<void> {
    await orderBtn(page).click();
    const menu = page.getByRole('menu', { name: 'Order' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitemradio', { name }).click();
    await expect(menu).toHaveCount(0);
}

async function recordLaunches(page: Page): Promise<void> {
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}
const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

/** A book's title from a catalogue, over 230 characters (spec 105 U4 1h), and an archive with a long name (invented). */
const LONG_TITLE = 'Matrika Ukázkov 7, narození, oddaní a zemřelí farnosti Ukázkov s filiálními obcemi Nákresov, Příkladná Lhota a Zkušebná '
    + '1801–1838 + rejstříky narozených a oddaných, opravy a dodatky farního úřadu Ukázkov z let 1839–1850, svazek druhý';
const archive2 = {
    key: 'repo:R0002', name: 'Státní archiv Ukázkov, pracoviště Nákresov – fond Farní úřad Ukázkov, matriky a rejstříky 1650–1950',
    kind: 'archive', url: 'https://archiv-ukazkov.example/',
};

/** The items and books of the bands (U4): a third book with the long title, whole on disk, two of its tasks parked. */
function bandItems(): Record<string, unknown>[] {
    return [...waiting(), { id: 'T0009', order: 9, what: 'Přečíst zápis sňatku v matrice Ukázkov 7', kind: 'images', section: 'images', group: archive2, at: minAgo(60), book: 'B0007', actions: ['chat', 'folder'] }];
}
function bandBooks(): Record<string, unknown> {
    const part = booksPart();
    (part.list as Record<string, unknown>[]).push({
        id: 'B0007', title: LONG_TITLE, folder: 'B0007 Matrika Ukázkov 7',
        archive: { id: 'R0002', name: archive2.name, url: archive2.url }, access: 'online-free',
        tasks: 9, waiting: 1, open: 8, parked: 2, images: 40, onDisk: 40, missing: 0, download: 'none',
    });
    return part;
}

/** Nothing of the section's bands and rows wider than its box (1 px rounding) and the page not scrolled sideways. */
async function bandsFit(page: Page): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const over = await sec(page).evaluate(el => [...el.querySelectorAll<HTMLElement>(
        '.research-overview__waiting-grouphead, .research-overview__waiting-group, .research-overview__group-title, .research-overview__book-archive, '
        + '.research-overview__book-meta, .research-overview__waiting-groupactions, .research-overview__waiting-rows')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
    expect(over).toEqual([]);
}

test.describe('Awaiting action by book', () => {
    test('Recommended: Archive | Book, by archive as before; Book: the books\' heads first, the places under "No book"', async ({ page }) => {
        await researchTree(page);
        await openOverview(page);
        // By archive (the default): the places as before, no switch, the segment with two choices.
        await expect(sec(page).getByRole('switch', { name: 'Groups' })).toHaveCount(0);
        await expect(seg(page).getByRole('radio')).toHaveText(['Archive', 'Book']);
        await expect(seg(page).getByRole('radio', { name: 'Archive' })).toHaveAttribute('aria-checked', 'true');
        expect(await groupKeys(page)).toEqual(['repo:R0001', 'to:MěÚ Vzorov']);
        await expect(sec(page).locator('.research-overview__nobook')).toHaveCount(0);

        await seg(page).getByRole('radio', { name: 'Book' }).click();
        await expect(seg(page).getByRole('radio', { name: 'Book' })).toHaveAttribute('aria-checked', 'true');
        await expect(seg(page).getByRole('radio', { name: 'Book' })).toBeFocused();
        expect(await stored(page)).toEqual([null, 'book']);
        // The books where their first item stands, then "No book" and the places.
        expect(await groupKeys(page)).toEqual(['book:B0003', 'book:B0005', 'to:MěÚ Vzorov']);
        await expect(todo(page).locator('.research-overview__nobook')).toHaveText('No book');
        // "No book" stands right before the first place.
        expect(await todo(page).evaluate(el => {
            const nb = el.querySelector('.research-overview__nobook');
            return (nb?.nextElementSibling?.querySelector('.research-overview__waiting-group') as HTMLElement | null)?.dataset.group;
        })).toBe('to:MěÚ Vzorov');

        // The head: the title with its years, Book, how many; the second line; the whole in its title.
        const b3 = bookHead(page, 'B0003');
        await expect(b3.locator('.research-overview__group-title')).toHaveText('Matrika Vzorov 3, N 1784–1820');
        await expect(b3.locator('.research-overview__group-title')).toHaveAttribute('title', 'Matrika Vzorov 3, N 1784–1820 · Archiv ve Vzorově · 16 tasks, 1 of them parked');
        await expect(b3.locator('.research-overview__group-kind')).toHaveText('Book');
        await expect(b3.locator('.research-overview__group-span')).toHaveText('2');
        // The archive whole on its own line; the tasks and the parked ones seen (U4 §1).
        await expect(b3.locator('.research-overview__book-archive')).toHaveText('Archiv ve Vzorově');
        await expect(b3.locator('.research-overview__book-meta')).toHaveText('16 tasks · 2 waiting · +13 in the queue · 1 parked·516 images · on disk 303 · missing 213');
        await expect(b3.locator('.research-overview__book-counts')).not.toHaveClass(/is-key/);
        // Its actions: the offer, the book's viewer ↗, its folder (no mark), Chat.
        await expect(b3.locator('.research-overview__book-offer')).toHaveText('Whole book can be downloaded · 516 images');
        await expect(b3.locator('a.research-overview__waiting-archiveweb')).toHaveAttribute('href', 'https://archiv-vzorov.example/kniha/3');
        const folder = b3.locator('.research-overview__book-folder');
        await expect(folder).toHaveText('Open the book’s folder');
        await expect(folder.locator('.research-open-mark, .ai-badge, svg')).toHaveCount(0);
        await expect(b3.locator('.research-overview__waiting-groupchat')).toHaveAttribute('data-task', 'T0001');
        await recordLaunches(page);
        const expanded = await b3.locator('.research-overview__waiting-group').getAttribute('aria-expanded');
        await folder.click();
        expect((await launched(page))[0]).toMatch(/^strom-research:\/\/book\?tree=[^&]+&id=B0003&do=folder$/);
        // A click on an action never folds the book.
        await expect(b3.locator('.research-overview__waiting-group')).toHaveAttribute('aria-expanded', expanded!);

        // A book without an offer, its website said by its archive only when it has one; sign-in said.
        const b5 = bookHead(page, 'B0005');
        await expect(b5.locator('.research-overview__book-offer')).toHaveCount(0);
        await expect(b5.locator('a.research-overview__waiting-archiveweb')).toHaveCount(0);
        await expect(b5.locator('.research-overview__book-login')).toHaveText('archive website requires sign-in');
        await expect(b5.locator('.research-overview__book-meta')).toContainText('on disk 0');
        await expect(b5.locator('.research-overview__book-meta')).not.toContainText('missing');

        // The book's group folds like a place's.
        const head3 = b3.locator('.research-overview__waiting-group');
        if (await head3.getAttribute('aria-expanded') === 'false') await head3.click();
        await expect(head3).toHaveAttribute('aria-expanded', 'true');
        await expect(todo(page).locator('.research-overview__waiting-item[data-id="T0001"]')).toBeVisible();
        await head3.click();
        await expect(head3).toHaveAttribute('aria-expanded', 'false');
        await expect(todo(page).locator('.research-overview__waiting-item[data-id="T0001"]')).toHaveCount(0);

        // The order button: no time order, no green.
        await expect(orderBtn(page)).not.toHaveClass(/is-time/);
    });

    test('a time order: three choices, the time after a book\'s title; No groups is one list as before; the time order\'s button framed dark', async ({ page }) => {
        await researchTree(page);
        await openOverview(page);
        await chooseOrder(page, 'Newest first');
        await expect(orderBtn(page)).toHaveClass(/is-time/);
        // Q1 b: a dark 1 px frame on the surface, no green fill.
        const look = await orderBtn(page).evaluate(el => {
            const cs = getComputedStyle(el);
            const probe = document.createElement('span');
            probe.style.color = 'var(--text)';
            probe.style.backgroundColor = 'var(--surface)';
            el.appendChild(probe);
            const p = getComputedStyle(probe);
            const out = { border: cs.borderTopColor, width: cs.borderTopWidth, bg: cs.backgroundColor, text: p.color, surface: p.backgroundColor };
            probe.remove();
            return out;
        });
        expect(look.border).toBe(look.text);
        expect(look.width).toBe('1px');
        expect(look.bg).toBe(look.surface);

        await expect(seg(page).getByRole('radio')).toHaveText(['Archive', 'Book', 'No groups']);
        await seg(page).getByRole('radio', { name: 'Book' }).click();
        expect(await groupKeys(page)).toEqual(['book:B0003', 'book:B0005', 'to:MěÚ Vzorov']);
        await expect(bookHead(page, 'B0003').locator('.research-overview__group-since')).toHaveText('25 min. ago');
        // The arrows move the choice.
        await seg(page).getByRole('radio', { name: 'Book' }).press('ArrowRight');
        await expect(seg(page).getByRole('radio', { name: 'No groups' })).toHaveAttribute('aria-checked', 'true');
        await expect(seg(page).getByRole('radio', { name: 'No groups' })).toBeFocused();
        expect(await stored(page)).toEqual(['newest', '0']);
        await expect(todo(page).locator('.research-overview__waiting-group')).toHaveCount(0);
        await expect(todo(page).locator('.research-overview__waiting-item[data-id="T0001"] .research-overview__group-tag')).toHaveText('Archiv ve Vzorově');
        // Back in Recommended: no "No groups", drawn by archive, the choice kept.
        await chooseOrder(page, 'Recommended');
        await expect(seg(page).getByRole('radio')).toHaveText(['Archive', 'Book']);
        await expect(seg(page).getByRole('radio', { name: 'Archive' })).toHaveAttribute('aria-checked', 'true');
        expect(await stored(page)).toEqual([null, '0']);
    });

    test('Most tasks: the books by their tasks, their counts first and bold, no choice of groups; kept and taken from another window', async ({ page }) => {
        await researchTree(page);
        await openOverview(page);
        await orderBtn(page).click();
        const menu = page.getByRole('menu', { name: 'Order' });
        await expect(menu.getByRole('menuitemradio')).toHaveText([/Recommended/, /Newest first/, /Oldest first/, /Most tasks/]);
        await menu.getByRole('menuitemradio', { name: 'Most tasks' }).click();
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Most tasks');
        await expect(orderBtn(page)).not.toHaveClass(/is-time/);
        await expect(seg(page)).toHaveCount(0);
        await expect(groupsBtn(page)).toHaveCount(0);
        // Always by book, whatever groups were chosen: B0005 (20 tasks) before B0003 (16); both to download, so no subheading.
        expect(await groupKeys(page)).toEqual(['book:B0005', 'book:B0003', 'to:MěÚ Vzorov']);
        await expect(todo(page).locator('.research-overview__books-part')).toHaveCount(0);
        const counts = bookHead(page, 'B0003').locator('.research-overview__book-meta > span').first();
        await expect(counts).toHaveText('16 tasks · 2 waiting · +13 in the queue · 1 parked');
        // Its keys bold: the tasks and the images missing (U4 §4).
        const keys = bookHead(page, 'B0003').locator('.research-overview__book-meta .is-key');
        await expect(keys).toHaveText(['16 tasks', 'missing 213']);
        expect(await keys.first().evaluate(el => getComputedStyle(el).fontWeight)).toBe('600');
        // No time beside the rows or after the titles.
        await expect(sec(page).locator('.research-overview__group-since, .research-overview__waiting-side .research-overview__since')).toHaveCount(0);
        expect(await stored(page)).toEqual(['most', null]);

        // Kept when the overview opens again.
        await closeOverview(page);
        await openOverview(page);
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Most tasks');

        // Another window of this device chose Recommended by book: drawn here too.
        await page.evaluate(() => {
            localStorage.removeItem('strom-live-overview-waiting-order');
            localStorage.setItem('strom-live-overview-waiting-groups', 'book');
            window.dispatchEvent(new StorageEvent('storage', { key: 'strom-live-overview-waiting-order' }));
        });
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Recommended');
        await expect(seg(page).getByRole('radio', { name: 'Book' })).toHaveAttribute('aria-checked', 'true');
        expect(await groupKeys(page)).toEqual(['book:B0003', 'book:B0005', 'to:MěÚ Vzorov']);
    });

    test('a book outside the research\'s list: its title, Book and how many only; the search finds a book by its title', async ({ page }) => {
        const items = [
            ...waiting(),
            { id: 'T0011', order: 10, what: 'Uložit snímky matriky Vzorov 11', kind: 'images', section: 'images', group: archive, book: 'B0011',
                inbox: { have: 0, want: 2, book: 'Matrika Vzorov 11, Z 1850–1870', recordset: 'B0011', dir: '' } },
            // Enough items for the section's search field.
            ...Array.from({ length: 6 }, (_, i) => ({ id: `T00${20 + i}`, order: 20 + i, what: `Napsat úřadu ${i + 1}`, kind: 'letter', section: 'letter', group: office, to: 'MěÚ Vzorov', actions: ['answer'] })),
        ];
        await researchTree(page, { items });
        await page.evaluate(() => localStorage.setItem('strom-live-overview-waiting-groups', 'book'));
        await openOverview(page);
        const b11 = bookHead(page, 'B0011');
        await expect(b11.locator('.research-overview__group-title')).toHaveText('Matrika Vzorov 11, Z 1850–1870');
        await expect(b11.locator('.research-overview__group-kind')).toHaveText('Book');
        await expect(b11.locator('.research-overview__group-span')).toHaveText('1');
        await expect(b11.locator('.research-overview__book-meta')).toHaveCount(0);
        await expect(b11.locator('.research-overview__book-actions')).toHaveCount(0);

        // "Vzorov 3" names only B0003's title (its items' texts say "Vzorov 3" too, but not T0003's).
        const field = sec(page).locator('.research-overview__section-search-input');
        await field.fill('1784');
        expect(await groupKeys(page)).toEqual(['book:B0003']);
        await expect(todo(page).locator('.research-overview__waiting-item')).toHaveCount(2);
    });

    test('without the books feature: as before — the switch in a time order, three orders, no book', async ({ page }) => {
        await researchTree(page, { features: ['waiting.groups'] });
        await page.evaluate(() => {
            localStorage.setItem('strom-live-overview-waiting-groups', 'book');
            localStorage.setItem('strom-live-overview-waiting-order', 'most');
        });
        await openOverview(page);
        // "Most tasks" kept is drawn as Recommended, "book" as by archive; nothing rewritten.
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Recommended');
        await expect(seg(page)).toHaveCount(0);
        await expect(sec(page).locator('.research-overview__groups-choice, .research-overview__nobook, .is-book')).toHaveCount(0);
        expect(await groupKeys(page)).toEqual(['repo:R0001', 'to:MěÚ Vzorov']);
        await orderBtn(page).click();
        await expect(page.getByRole('menu', { name: 'Order' }).getByRole('menuitemradio')).toHaveText([/Recommended/, /Newest first/, /Oldest first/]);
        await page.getByRole('menu', { name: 'Order' }).getByRole('menuitemradio', { name: 'Oldest first' }).click();
        await expect(sec(page).getByRole('switch', { name: 'Groups' })).toHaveAttribute('aria-checked', 'true');
        expect(await groupKeys(page)).toEqual(['to:MěÚ Vzorov', 'repo:R0001']);
        expect(await stored(page)).toEqual(['oldest', 'book']);
    });

    for (const size of [{ width: 390, height: 844, name: 'a phone' }, { width: 844, height: 390, name: 'a phone held sideways' }]) test(`${size.name}: "Groups: Archive ▾" opens a sheet, a choice of one; the book's head without the Book tag, nothing wider than the screen`, async ({ page }) => {
        await researchTree(page, size);
        await openOverview(page);
        await expect(seg(page)).toHaveCount(0);
        await expect(groupsBtn(page)).toHaveAttribute('aria-label', 'Groups: Archive');
        await groupsBtn(page).click();
        const sheet = page.getByRole('menu', { name: 'Groups' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('menuitemradio')).toHaveText([/Archive/, /Book/]);
        await expect(sheet.getByRole('menuitemradio', { name: 'Archive' })).toHaveAttribute('aria-checked', 'true');
        await sheet.getByRole('menuitemradio', { name: 'Book' }).click();
        await expect(groupsBtn(page)).toHaveAttribute('aria-label', 'Groups: Book');
        expect(await stored(page)).toEqual([null, 'book']);
        const b3 = bookHead(page, 'B0003');
        await expect(b3.locator('.research-overview__group-kind')).toBeHidden();
        // The archive on its own line above the facts.
        const [archive, meta] = await Promise.all([
            b3.locator('.research-overview__book-archive').boundingBox(),
            b3.locator('.research-overview__book-meta').boundingBox(),
        ]);
        expect(archive!.y + archive!.height).toBeLessThanOrEqual(meta!.y + 1);
        expect(Math.round(archive!.x)).toBe(Math.round(meta!.x));
        // Chat opens the research on the computer: not on a phone.
        await expect(b3.locator('.research-overview__waiting-groupchat')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        const over = await sec(page).evaluate(el => [...el.querySelectorAll<HTMLElement>('.research-overview__book-meta, .research-overview__book-archive, .research-overview__waiting-group, .research-overview__waiting-grouphead')]
            .filter(e => e.scrollWidth > e.clientWidth + 1).length);
        expect(over).toBe(0);
        // The orders' sheet: "Most tasks" says what it puts first on its second line (spec 105 U4 §4).
        await orderBtn(page).click();
        const orders = page.getByRole('menu', { name: 'Order' });
        await expect(orders).toBeVisible();
        await expect(orders.locator('.bottom-sheet-sub')).toHaveText(['books to download first']);
        await expect(orders.getByRole('menuitemradio', { name: /Most tasks/ }).locator('.bottom-sheet-sub')).toHaveText('books to download first');
    });

    for (const size of [{ width: 390, height: 844, cap: 4, indent: [0, 8] }, { width: 1440, height: 900, cap: 3, indent: [13, 12] }]) test(`spec 105 U4 at ${size.width} in German: a book's whole title wrapped up to ${size.cap} lines, "more" only when cut and never folding; the archive, facts and actions in its band; its items on its line`, async ({ page }) => {
        await researchTree(page, { items: bandItems(), books: bandBooks(), width: size.width, height: size.height });
        await page.evaluate(() => {
            window.Strom.UI.setLanguage('de');
            localStorage.setItem('strom-live-overview-waiting-groups', 'book');
        });
        await openOverview(page);
        const long = bookHead(page, 'B0007');
        const title = long.locator('.research-overview__group-title');
        // The research's title as the app keeps it (200 characters), whole in the band: no "…" of its own.
        const kept = LONG_TITLE.slice(0, 199) + '…';
        await expect(title).toHaveText(kept);
        await expect(title).toHaveAttribute('title', `${kept} · ${archive2.name} · 9 Aufgaben, davon zurückgestellt 2`);
        // Cut at its cap ("…" by the clamp, no ellipsis on one line), "more" under it.
        const clamped = await title.evaluate(el => ({ h: el.clientHeight, sh: el.scrollHeight, lh: parseFloat(getComputedStyle(el).lineHeight), ws: getComputedStyle(el).whiteSpace }));
        expect(clamped.ws).toBe('normal');
        expect(clamped.h).toBeLessThanOrEqual(size.cap * clamped.lh + 1);
        expect(clamped.h).toBeGreaterThan((size.cap - 1) * clamped.lh);
        expect(clamped.sh).toBeGreaterThan(clamped.h + 1);
        const more = long.locator('.research-overview__group-more');
        await expect(more).toBeVisible();
        await expect(more).toHaveText('mehr');
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        // A title that fits has none.
        await expect(bookHead(page, 'B0003').locator('.research-overview__group-more')).toBeHidden();
        // The band: the archive whole on its own line, the facts with the tasks and the parked ones, whole on disk said so.
        await expect(long.locator('.research-overview__book-archive')).toHaveText(archive2.name);
        await expect(long.locator('.research-overview__book-meta')).toHaveText('9 Aufgaben · 1 wartet · +8 in der Warteschlange · 2 zurückgestellt·40 Bilder · vollständig lokal');
        await expect(long.locator('.research-overview__book-folder')).toHaveText('Ordner des Buchs öffnen');
        const look = await long.evaluate(el => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = 'var(--surface-2)';
            probe.style.color = 'var(--divider)';
            el.appendChild(probe);
            const p = getComputedStyle(probe);
            const cs = getComputedStyle(el);
            const out = { bg: cs.backgroundColor, border: cs.borderTopColor, width: cs.borderTopWidth, surface2: p.backgroundColor, divider: p.color, shadow: cs.boxShadow };
            probe.remove();
            return out;
        });
        expect(look).toMatchObject({ bg: look.surface2, border: look.divider, width: '1px', shadow: 'none' });
        await bandsFit(page);

        // "more" unfolds the whole title in place and never folds the group; "less" folds the title back.
        const fold = long.locator('.research-overview__waiting-group');
        const expanded = await fold.getAttribute('aria-expanded');
        await more.click();
        await expect(title).toHaveClass(/is-full/);
        await expect(more).toHaveText('weniger');
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await expect(fold).toHaveAttribute('aria-expanded', expanded!);
        expect(await title.evaluate(el => el.clientHeight)).toBeGreaterThan(clamped.h + 1);
        await bandsFit(page);
        await more.click();
        await expect(title).not.toHaveClass(/is-full/);
        await expect(more).toHaveText('mehr');
        await expect(fold).toHaveAttribute('aria-expanded', expanded!);

        // Its items hang on its line: 2 px, indented under the title on a computer, at the edge on a phone (D1).
        if (expanded === 'false') await fold.click();
        await expect(fold).toHaveAttribute('aria-expanded', 'true');
        const list = todo(page).locator('.research-overview__waiting-grouphead:has([data-book="B0007"]) + ul.research-overview__waiting-rows');
        await expect(list).toHaveClass(/is-grouped/);
        await expect(list.locator('.research-overview__waiting-item[data-id="T0009"]')).toBeVisible();
        const line = await list.evaluate(el => {
            const cs = getComputedStyle(el);
            return { width: cs.borderLeftWidth, style: cs.borderLeftStyle, margin: parseFloat(cs.marginLeft), padding: parseFloat(cs.paddingLeft) };
        });
        expect(line).toEqual({ width: '2px', style: 'solid', margin: size.indent[0], padding: size.indent[1] });
        await bandsFit(page);

        // By archive: the place's actions in its band under its name (no longer beside it).
        await closeOverview(page);
        await page.evaluate(() => localStorage.removeItem('strom-live-overview-waiting-groups'));
        await openOverview(page);
        const place = todo(page).locator('.research-overview__waiting-grouphead').filter({ has: page.locator('[data-group="repo:R0002"]') });
        const [nameBox, actionsBox] = await Promise.all([
            place.locator('.research-overview__group-title').boundingBox(),
            place.locator('.research-overview__waiting-groupactions > :first-child').boundingBox(),
        ]);
        expect(actionsBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1);
        expect(Math.abs(actionsBox!.x - nameBox!.x)).toBeLessThanOrEqual(1);
        await expect(place.locator('.research-overview__waiting-groupactions a.research-overview__waiting-archiveweb')).toHaveAttribute('href', archive2.url);
        await expect(place.locator('.research-overview__group-title')).toHaveCSS('white-space', 'normal');
        await bandsFit(page);
    });
    test('spec 105 U4 §4 Most tasks: the books to download first, then those whole on disk, each part under its subheading; what it puts first said under the order and in the menu', async ({ page }) => {
        const books = bandBooks();
        // The book whole on disk has the most tasks: still under the books to download.
        (books.list as Record<string, unknown>[]).find(b => b.id === 'B0007')!.tasks = 30;
        await researchTree(page, { items: bandItems(), books });
        await openOverview(page);
        await orderBtn(page).click();
        const menu = page.getByRole('menu', { name: 'Order' });
        await expect(menu.locator('.tv-menu-item[data-id="order-most"] .tv-menu-desc')).toHaveText('books to download first');
        await expect(menu.locator('.tv-menu-desc')).toHaveCount(1);
        await menu.getByRole('menuitemradio', { name: /Most tasks/ }).click();
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Most tasks');
        expect(await groupKeys(page)).toEqual(['book:B0005', 'book:B0003', 'book:B0007', 'to:MěÚ Vzorov']);
        const parts = todo(page).locator('.research-overview__books-part');
        await expect(parts).toHaveText(['To download · 2 books', 'Whole on disk · 1 book']);
        // Each right before the first book of its part; "No book" before the places as before.
        expect(await todo(page).evaluate(el => [...el.querySelectorAll('.research-overview__books-part, .research-overview__nobook:not(.research-overview__books-part)')]
            .map(n => (n.nextElementSibling?.querySelector('.research-overview__waiting-group') as HTMLElement | null)?.dataset.group))).toEqual(['book:B0005', 'book:B0007', 'to:MěÚ Vzorov']);
        // The sentence under the order.
        const note = sec(page).locator('.research-overview__order-note');
        await expect(note).toHaveText('Books missing images come first: downloading them settles the most tasks at once. Books whole on disk follow.');
        expect(await note.evaluate(el => el.previousElementSibling?.classList.contains('research-overview__order'))).toBe(true);
        // A book whole on disk: only its tasks bold.
        await expect(bookHead(page, 'B0007').locator('.research-overview__book-meta .is-key')).toHaveText(['30 tasks']);
        await expect(bookHead(page, 'B0003').locator('.research-overview__book-meta .is-key')).toHaveText(['16 tasks', 'missing 213']);
        await bandsFit(page);

        // Another order: no sentence, no subheading, nothing bold.
        await chooseOrder(page, 'Recommended');
        await expect(note).toHaveCount(0);
        await expect(parts).toHaveCount(0);
        await expect(sec(page).locator('.research-overview__book-meta .is-key')).toHaveCount(0);
    });

    /** "Waiting on" of a manual step, about 240 characters (invented). */
    const ON240 = 'Badatelna archivu ve Vzorově vydává snímky jen na žádost: vyplnit formulář na webu archivu, uvést signaturu knihy 4 a strany 112 až 113, '
        + 'zaplatit poplatek převodem a počkat na odkaz e-mailem; snímky pak uložit do složky úkolu výzkumu.';
    const WEB_WHAT = 'Dohledat sňatek v digitalizované matrice Vzorov 4 a ověřit jméno nevěsty';
    function itemsOn(on: string): Record<string, unknown>[] {
        return [
            { id: 'T0011', order: 0, what: WEB_WHAT, kind: 'web', section: 'web', group: archive, url: 'https://archiv-vzorov.example/kniha/4',
                on, to: 'Archiv ve Vzorově, badatelna', at: minAgo(30), actions: ['answer', 'chat'] },
            { id: 'T0012', order: 1, what: 'Uložit snímky matriky Vzorov 5', kind: 'images', section: 'images', group: archive, on: 'user', at: minAgo(40), book: 'B0005', actions: ['folder'] },
        ];
    }
    async function openItem(page: Page, id: string) {
        const group = sec(page).locator('.research-overview__waiting-group[data-group="repo:R0001"]');
        if (await group.getAttribute('aria-expanded') === 'false') await group.click();
        const item = sec(page).locator(`.research-overview__waiting-item[data-id="${id}"]`);
        await item.locator('.research-overview__waiting-row').click();
        await expect(item).toHaveClass(/is-open/);
        return item;
    }
    /** A clamped text's lines: its height in line heights, and whether it is cut. */
    const linesOf = (loc: ReturnType<Page['locator']>) => loc.evaluate(el => {
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        return { lines: el.clientHeight / lh, cut: el.scrollHeight > el.clientHeight + 1, wide: el.scrollWidth > el.clientWidth + 1 };
    });

    for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) test(`spec 105 U4 §3 at ${size.width} in German: the open item's text whole once in its row; "Waiting on" whole in its block, whom it goes to under it; none when it waits on the user`, async ({ page }) => {
        await researchTree(page, { items: itemsOn(ON240), ...size });
        await page.evaluate(() => window.Strom.UI.setLanguage('de'));
        await openOverview(page);
        expect(ON240.length).toBeGreaterThanOrEqual(230);
        const item = await openItem(page, 'T0011');
        // The text once: whole in the row (no clamp), not again in the body.
        const what = item.locator('.research-overview__waiting-what');
        await expect(what).toContainText(WEB_WHAT);
        expect((await linesOf(what)).cut).toBe(false);
        const detail = item.locator('.research-overview__waiting-detail');
        await expect(detail.locator('.research-overview__waiting-text')).toHaveCount(0);
        expect(await detail.innerText()).not.toContain(WEB_WHAT);
        // "Waiting on": the body's first block, its heading, the whole text (no "waiting on:" before it), not cut, no "more".
        const box = detail.locator('.research-overview__waiting-on-box');
        await expect(box).toHaveCount(1);
        expect(await detail.evaluate(el => el.firstElementChild?.className)).toBe('research-overview__waiting-on-box');
        await expect(box.locator('.research-overview__waiting-on-label')).toHaveText('Wartet auf');
        const on = box.locator('.research-overview__waiting-on');
        await expect(on).toHaveText(ON240);
        const fit = await linesOf(on);
        expect(fit.cut).toBe(false);
        expect(fit.wide).toBe(false);
        expect(fit.lines).toBeGreaterThanOrEqual(2);
        expect(await on.evaluate(el => getComputedStyle(el).fontSize)).toBe(size.width <= 640 ? '15px' : '14px');
        await expect(box.locator('.research-overview__waiting-on-more')).toBeHidden();
        // Whom it goes to: the block's second line.
        await expect(box.locator('.research-overview__waiting-to')).toHaveText('An Archiv ve Vzorově, badatelna');
        // Then the person · direction and the actions under it.
        const [boxBox, metaBox, actionsBox] = await Promise.all([
            box.boundingBox(), detail.locator('.research-overview__waiting-meta').boundingBox(), detail.locator('.research-overview__waiting-actions, .waiting-actions').first().boundingBox(),
        ]);
        expect(metaBox!.y).toBeGreaterThanOrEqual(boxBox!.y + boxBox!.height - 1);
        expect(actionsBox!.y).toBeGreaterThanOrEqual(metaBox!.y);
        // Nothing wider than the item.
        const itemBox = await item.boundingBox();
        expect(boxBox!.x + boxBox!.width).toBeLessThanOrEqual(itemBox!.x + itemBox!.width + 0.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

        // An item waiting on the user alone: no block; the body starts with what else it has.
        const user = await openItem(page, 'T0012');
        await expect(user.locator('.research-overview__waiting-on-box, .research-overview__waiting-on')).toHaveCount(0);
        await expect(user.locator('.research-overview__waiting-detail .research-overview__waiting-text')).toHaveCount(0);
    });

    test('spec 105 U4 §3 a phone held sideways: the open item\'s text whole in its row; a long "Waiting on" cut at 3 lines with "more" that unfolds it, "less" folds it back', async ({ page }) => {
        const long = `${ON240} ${ON240} ${ON240}`;
        await researchTree(page, { items: itemsOn(long), width: 844, height: 390 });
        await openOverview(page);
        const item = await openItem(page, 'T0011');
        expect((await linesOf(item.locator('.research-overview__waiting-what'))).cut).toBe(false);
        const on = item.locator('.research-overview__waiting-on-box .research-overview__waiting-on');
        await expect(on).toHaveText(long);
        const cut = await linesOf(on);
        expect(cut.cut).toBe(true);
        expect(cut.lines).toBeLessThanOrEqual(3.05);
        expect(cut.lines).toBeGreaterThan(2.5);
        const more = item.locator('.research-overview__waiting-on-more');
        await expect(more).toBeVisible();
        await expect(more).toHaveText('more');
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await more.click();
        await expect(on).toHaveClass(/is-full/);
        await expect(more).toHaveText('less');
        // The item stays open.
        await expect(item).toHaveClass(/is-open/);
        const whole = await linesOf(on);
        expect(whole.cut).toBe(false);
        expect(whole.lines).toBeGreaterThan(3.5);
        await more.click();
        await expect(on).not.toHaveClass(/is-full/);
        await expect(more).toHaveText('more');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
});

test.describe('spec 105 U4 §5 an item waiting for images: images to deliver, not an answer', () => {
    const IMG_ACCEPTS = { ...ACCEPTS, media: { taskImages: true } };
    const IMG_FEATURES = [...FEATURES, 'waiting.answer'];
    /** Items taking images: B0003 with its website and folder, B0005 with its folder only (no website). */
    function imageItems(): Record<string, unknown>[] {
        return [
            {
                id: 'T0021', order: 0, what: 'Uložit snímky 112–113 matriky Vzorov 3', kind: 'images', section: 'images', group: archive, at: minAgo(30), book: 'B0003',
                inbox: { dir: 'inbox/B0003', have: 1, want: 3, missing: [112, 113], images: '111–113' }, actions: ['images', 'answer', 'chat', 'folder'],
            },
            {
                id: 'T0022', order: 1, what: 'Uložit snímek 40 matriky Vzorov 5', kind: 'images', section: 'images', group: archive, at: minAgo(60), book: 'B0005',
                inbox: { dir: 'inbox/B0005', have: 0, want: 1, missing: [40], images: '40' }, actions: ['images', 'answer', 'chat', 'folder'],
            },
        ];
    }
    async function setup(page: Page, size: { width: number; height: number }, lang?: string): Promise<void> {
        await page.clock.setFixedTime(NOW);
        await page.setViewportSize(size);
        await openResearch(page);
        await fakeBridge(page, {
            accepts: IMG_ACCEPTS, links: LINKS, waiting: imageItems(), features: IMG_FEATURES, treeGed: researchGed(),
            books: { books: booksPart(), posts: [] },
        });
        await poll(page);
        if (lang) await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
        await openOverview(page);
        await recordLaunches(page);
    }
    async function openItem(page: Page, id: string) {
        const group = sec(page).locator('.research-overview__waiting-group[data-group="repo:R0001"]');
        if (await group.getAttribute('aria-expanded') === 'false') await group.click();
        const item = sec(page).locator(`.research-overview__waiting-item[data-id="${id}"]`);
        await item.locator('.research-overview__waiting-row').click();
        await expect(item).toHaveClass(/is-open/);
        return item;
    }
    /** Nothing in the item wider than its box, and the page not scrolled sideways. */
    async function fits(page: Page, item: ReturnType<Page['locator']>): Promise<void> {
        const spill = await item.evaluate((o) => [o, ...o.querySelectorAll<HTMLElement>('*')]
            .filter(n => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'hidden' && getComputedStyle(n).overflowX !== 'clip' && n.clientWidth > 0)
            .map(n => `${n.className} ${n.scrollWidth}/${n.clientWidth}`));
        expect(spill).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        const box = (await item.boundingBox())!;
        const deliver = (await item.locator('.research-overview__waiting-deliver').boundingBox())!;
        expect(deliver.x + deliver.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }

    test('a book\'s item: the numbers and the book\'s folder; ① its website ↗ ② its folder without a mark ③ Add images, the one main action; without a website the folder is ①', async ({ page }) => {
        await setup(page, { width: 1440, height: 900 });
        const item = await openItem(page, 'T0021');
        const deliver = item.locator('.research-overview__waiting-deliver');
        await expect(deliver.locator('.research-overview__deliver-text')).toHaveText('Images 112–113 as files (JPG or PNG) in the folder of the book Matrika Vzorov 3, N 1784–1820');
        // The body's first block.
        expect(await item.locator('.research-overview__waiting-detail').evaluate(el => el.firstElementChild?.className)).toBe('research-overview__waiting-deliver');
        const steps = deliver.locator('.research-overview__deliver-step');
        await expect(steps).toHaveText(['1Archive website ↗', '2Open the book’s folder', '3Add images']);
        await expect(steps.nth(0).locator('a')).toHaveAttribute('href', 'https://archiv-vzorov.example/kniha/3');
        const folder = steps.nth(1).locator('[data-action="folder"]');
        await expect(folder.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await expect(folder).toHaveAttribute('aria-label', 'Step 2 of 3: Open the book’s folder');
        // Read in their order (wrapped as the room allows), arrows between them at this width.
        const at = await steps.evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ top: Math.round(r.top), left: r.left })));
        for (let i = 1; i < at.length; i++) expect(at[i].top > at[i - 1].top || (at[i].top === at[i - 1].top && at[i].left > at[i - 1].left)).toBe(true);
        await expect(deliver.locator('.research-overview__deliver-arrow')).toHaveCount(2);
        await expect(item.locator('.waiting-action--primary')).toHaveCount(1);
        await expect(item.locator('.waiting-action--primary')).toHaveAttribute('data-action', 'images');
        await expect(item.locator('[data-action="images"]')).toHaveCount(1);
        await folder.click();
        expect((await launched(page))[0]).toMatch(/^strom-research:\/\/book\?tree=[^&]+&id=B0003&do=folder$/);
        // Under it: "Images can't be obtained…" as a link, Discuss with the agent under ⋯ (the task's folder not again).
        const cannot = item.locator('.waiting-actions [data-action="answer"]');
        await expect(cannot).toHaveText('Images can’t be obtained…');
        await expect(cannot).toHaveClass(/link-button/);
        await item.locator('.waiting-more').click();
        await expect(page.locator('#waiting-more-menu [role="menuitem"]')).toHaveText(['Discuss with the agent, AI, opens in the researchAI']);
        await page.keyboard.press('Escape');
        // It opens the field with its own heading and hint; the steps hide while it is written.
        await cannot.click();
        const form = item.locator('.waiting-answer');
        await expect(form.locator('.waiting-answer__label')).toHaveText('Why the images can’t be obtained');
        await expect(form.locator('.waiting-answer__hint')).toHaveText(/^This is for why the images can’t be supplied/);
        await expect(item.locator('.research-overview__deliver-steps')).toHaveCount(0);
        await form.locator('.waiting-answer__cancel').click();
        await expect(item.locator('.research-overview__deliver-steps')).toBeVisible();

        // A book without a website: no step ①, the folder takes its number.
        const other = await openItem(page, 'T0022');
        await expect(other.locator('.research-overview__deliver-text')).toHaveText('Image 40 as a file (JPG or PNG) in the folder of the book Matrika Vzorov 5, O 1820–1850');
        await expect(other.locator('.research-overview__deliver-step')).toHaveText(['1Open the book’s folder', '2Add images']);
        await expect(other.locator('[data-action="images"]')).toHaveAttribute('aria-label', 'Step 2 of 2: Add images');
        await expect(other.locator('[data-action="web"]')).toHaveCount(0);
    });

    test('a column under 380 px: the steps under each other, no arrows, their order kept', async ({ page }) => {
        await setup(page, { width: 1440, height: 900 });
        await page.addStyleTag({ content: 'body { --overview-w: 340px !important; }' });
        const item = await openItem(page, 'T0021');
        const steps = item.locator('.research-overview__deliver-step');
        await expect(steps).toHaveText(['1Archive website ↗', '2Open the book’s folder', '3Add images']);
        const boxes = await steps.evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ top: r.top, bottom: r.bottom })));
        for (let i = 1; i < boxes.length; i++) expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 0.5);
        await expect(item.locator('.research-overview__deliver-arrow').first()).toBeHidden();
        await fits(page, item);
    });

    for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) test(`German at ${size.width}: nothing spills; a phone shows the Deliver block alone, its link opens the sheet with the new heading`, async ({ page }) => {
        await setup(page, size, 'de');
        const item = await openItem(page, 'T0021');
        const deliver = item.locator('.research-overview__waiting-deliver');
        await expect(deliver.locator('.research-overview__deliver-label')).toHaveText('Liefern');
        await expect(deliver.locator('.research-overview__deliver-text')).toHaveText('Bilder 112–113 als Dateien (JPG oder PNG) im Ordner des Buchs Matrika Vzorov 3, N 1784–1820');
        const cannot = item.locator('.waiting-actions [data-action="answer"]');
        await expect(cannot).toHaveText('Bilder nicht erhältlich…');
        if (size.width > 640) {
            await expect(deliver.locator('.research-overview__deliver-step')).toHaveText(['1Archiv-Website ↗', '2Ordner des Buchs öffnen', '3Bilder hinzufügen']);
            await fits(page, item);
            return;
        }
        await expect(deliver.locator('.research-overview__deliver-text')).toHaveCSS('font-size', '15px');
        await expect(deliver.locator('.research-overview__deliver-phone')).toHaveText('Bilder werden am Computer gespeichert.');
        await expect(item.locator('.research-overview__deliver-steps, [data-action="images"], [data-action="web"], .waiting-more')).toHaveCount(0);
        expect((await cannot.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await fits(page, item);
        await cannot.click();
        const sheet = page.locator('.waiting-answer-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.waiting-answer__label')).toHaveText('Warum die Bilder nicht erhältlich sind');
        await expect(sheet.locator('.waiting-answer__hint')).toHaveText(/^Hierher gehört, warum die Bilder nicht geliefert werden können/);
    });
});
