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
        await expect(b3.locator('.research-overview__book-meta')).toHaveText('Archiv ve Vzorově·2 waiting · +13 in the queue·516 images · on disk 303 · missing 213');
        await expect(b3.locator('.research-overview__book-counts')).not.toHaveClass(/is-key/);
        // Its actions: the offer, the book's viewer ↗, its folder (no mark), Chat.
        await expect(b3.locator('.research-overview__book-offer')).toHaveText('Whole book can be downloaded · 516 images');
        await expect(b3.locator('a.research-overview__waiting-archiveweb')).toHaveAttribute('href', 'https://archiv-vzorov.example/kniha/3');
        const folder = b3.locator('.research-overview__book-folder');
        await expect(folder).toHaveText('Open folder');
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
        // Always by book, whatever groups were chosen: B0005 (20 tasks) before B0003 (16).
        expect(await groupKeys(page)).toEqual(['book:B0005', 'book:B0003', 'to:MěÚ Vzorov']);
        const counts = bookHead(page, 'B0003').locator('.research-overview__book-meta > span').first();
        await expect(counts).toHaveText('2 waiting · +13 in the queue');
        await expect(counts).toHaveClass(/is-key/);
        expect(await counts.evaluate(el => getComputedStyle(el).fontWeight)).toBe('600');
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
        // The archive on its own line of the second line.
        const [archive, meta] = await Promise.all([
            b3.locator('.research-overview__book-archive').boundingBox(),
            b3.locator('.research-overview__book-meta').boundingBox(),
        ]);
        expect(Math.round(archive!.width)).toBe(Math.round(meta!.width));
        // Chat opens the research on the computer: not on a phone.
        await expect(b3.locator('.research-overview__waiting-groupchat')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        const over = await sec(page).evaluate(el => [...el.querySelectorAll<HTMLElement>('.research-overview__book-meta, .research-overview__book-line, .research-overview__waiting-grouphead')]
            .filter(e => e.scrollWidth > e.clientWidth + 1).length);
        expect(over).toBe(0);
    });
});
