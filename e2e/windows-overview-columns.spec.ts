import { test, expect, Page } from '@playwright/test';

/**
 * The Research overview's own window by its width (spec 083 §4, story 3):
 * one column under 1100 px as before, two from 1100 px, three from 1600 px,
 * each column at most 660 px and scrolled by itself (the window's body does
 * not scroll), the sections split in their reading order; a long section's
 * head (heading, field, chips) sticks to its column's top while its rows
 * scroll; a drag of the window across a threshold moves the same nodes into
 * the new columns, the caret in a search field staying where it was; in
 * German with a long research name nothing overflows. Invented data (the
 * Hrotkovi of Olšinky); the bridge is answered by page.route.
 */

const UUID = '7c2e4a1b-3d5f-4e6a-8b9c-1d2e3f4a5b6c';
const BRIDGE = 'http://127.0.0.1:5997/a1b2c3d4e5f60718293a4b5c6d7e8f90';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research', 'live'];
/** A long name (36 characters): the window's head must not overflow with it. */
const NAME = 'Hrotkovi a Šeříkovi z Malých Olšinek';

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 2 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', `1 NOTE ${NAME}`,
    '0 @P0001@ INDI', '1 NAME Kvirín /Hrotek/', '1 SEX M', '1 BIRT', '2 DATE 1871', '1 REFN P0001',
    '0 @P0002@ INDI', '1 NAME Eufrozína /Šeříková/', '1 SEX F', '1 BIRT', '2 DATE 1875', '1 REFN P0002',
    '0 TRLR',
].join('\n');

const archive = { key: 'repo:R0001', name: 'Archiv Olšinky', kind: 'archive' };
const office = { key: 'to:Pfarramt Großhof', name: 'Pfarramt Großhof', kind: 'office' };
const web = { key: 'host:matriky.example', name: 'matriky.example', kind: 'web' };
/** Fixed times: the same status on every poll (nothing new to draw while the window is dragged). */
const AT = new Date(Date.now() - 3 * 86_400_000).toISOString();
const SINCE = new Date(Date.now() - 12 * 60_000).toISOString();

/** Fourteen items to do in three places (the field shows from ten). */
function waiting(): Record<string, unknown>[] {
    const at = AT;
    const out: Record<string, unknown>[] = [];
    for (let i = 1; i <= 6; i++) out.push({ id: `T00${10 + i}`, what: `Uložit snímky matriky Olšinky ${i === 1 ? 'Hrotek' : `18${40 + i}`}`, kind: 'images', section: 'images', group: archive, actions: ['folder'] });
    for (let i = 1; i <= 4; i++) out.push({ id: `T00${20 + i}`, what: `Napsat faře o křest ${i}`, kind: 'letter', section: 'letter', group: office, to: 'Pfarramt Großhof', actions: ['answer'] });
    for (let i = 1; i <= 4; i++) out.push({ id: `T00${30 + i}`, what: `Dohledat sňatek Hrotků ${i}`, kind: 'web', section: 'web', group: web, actions: ['answer'] });
    return out.map((w, i) => ({ order: i, at, ...w }));
}

/** Twenty-four tasks up next (the Queue is long: its column scrolls). */
function queue(): Record<string, unknown>[] {
    return Array.from({ length: 24 }, (_, i) => ({ id: `T${String(701 + i).padStart(4, '0')}`, text: `Matriky Olšinky ${i + 1}`, state: 'next' }));
}

/** The main window follows the research; Queue and Awaiting action unfolded. */
async function follow(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().addInitScript((links) => {
        // The events' stream (closed at once by the route) is not asked again: no new snapshot while the window is
        // dragged, so a section found the same is one moved, not drawn anew.
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 600_000;
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        localStorage.setItem('strom-live-section-prefs', JSON.stringify({ v: 2, s: { working: 'expanded', waiting: 'expanded', queue: 'expanded' } }));
    }, LINKS);
    const status = () => ({
        tree: { id: UUID, name: NAME }, head: 'h1', persons: 2, links: LINKS, queue: queue(),
        working: [{ who: 'agent-matriky', since: SINCE, task: 'Sčítání 1910', person: 'P0002' }],
        waiting: waiting(), features: ['waiting.groups', 'waiting.answer'],
    });
    const json = (s: number, body: unknown) => ({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await page.context().route(`${BRIDGE}/**`, async (route) => {
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
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel .live-panel-expand')).toBeVisible();
}

/** The overview's own window from the ⧉ menu. */
async function openWindow(page: Page): Promise<Page> {
    await page.locator('#view-window-btn').click();
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
    return popup;
}

const ov = (p: Page) => p.locator('#research-overview');
const cols = (p: Page) => ov(p).locator('.research-overview__body > .research-overview__col');
const field = (p: Page) => ov(p).locator('.research-overview__section-search-input');

/** The sections' titles of each column (one column: all in one list). */
function titlesByColumn(p: Page): Promise<string[][]> {
    return ov(p).evaluate((root) => {
        const body = root.querySelector('.research-overview__body')!;
        const groups = [...body.querySelectorAll(':scope > .research-overview__col')];
        const of = (n: Element) => [...n.querySelectorAll('.live-section__title')].map(t => (t.textContent ?? '').split(' ·')[0].trim());
        return groups.length > 0 ? groups.map(of) : [of(body)];
    });
}

test.describe('the overview window by its width', () => {
    test('one column at 1024 as before, two at 1440, three at 1700: each column scrolls by itself, a long section\'s head stays on top', async ({ page }) => {
        await follow(page);
        const popup = await openWindow(page);

        await popup.setViewportSize({ width: 1024, height: 600 });
        await expect(ov(popup)).not.toHaveClass(/\bis-cols\b/);
        await expect(cols(popup)).toHaveCount(0);
        expect(await titlesByColumn(popup)).toEqual([['Now', 'Awaiting action', 'Progress', 'Queue']]);
        // One scrollbar: the body's.
        expect(await ov(popup).locator('.research-overview__body').evaluate(b => getComputedStyle(b).overflowY)).toBe('auto');

        await popup.setViewportSize({ width: 1440, height: 600 });
        await expect(ov(popup)).toHaveClass(/\bis-cols\b/);
        await expect(cols(popup)).toHaveCount(2);
        // Contiguous in the reading order: Now and Awaiting action, then the long Queue.
        expect(await titlesByColumn(popup)).toEqual([['Now', 'Awaiting action', 'Progress'], ['Queue']]);

        await popup.setViewportSize({ width: 1700, height: 600 });
        await expect(cols(popup)).toHaveCount(3);
        expect(await titlesByColumn(popup)).toEqual([['Now'], ['Awaiting action', 'Progress'], ['Queue']]);
        // At most 660 px each, centred, a divider from the second on, each focusable by a click into it.
        const geo = await cols(popup).evaluateAll(cs => cs.map(c => {
            const r = c.getBoundingClientRect();
            return { left: r.left, right: r.right, width: r.width, border: getComputedStyle(c).borderLeftWidth, tab: (c as HTMLElement).tabIndex };
        }));
        for (const g of geo) expect(g.width).toBeLessThanOrEqual(660.5);
        expect(geo.map(g => g.border)).toEqual(['0px', '1px', '1px']);
        expect(geo.every(g => g.tab === -1)).toBe(true);
        const vw = 1700;
        expect(Math.abs(geo[0].left - (vw - geo[2].right))).toBeLessThan(24);

        // The Queue's column scrolls by itself; the body and the page do not.
        const queueCol = cols(popup).nth(2);
        await queueCol.hover();
        await popup.mouse.wheel(0, 400);
        await expect.poll(() => queueCol.evaluate(c => c.scrollTop)).toBeGreaterThan(100);
        expect(await cols(popup).nth(0).evaluate(c => c.scrollTop)).toBe(0);
        expect(await ov(popup).locator('.research-overview__body').evaluate(b => b.scrollTop)).toBe(0);
        expect(await popup.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
        // Its head (heading, more than 8 rows) stays at the column's top while its rows scroll.
        const stuck = await queueCol.evaluate((c) => {
            const head = c.querySelector<HTMLElement>('.research-overview__section-head')!;
            return { dy: head.getBoundingClientRect().top - c.getBoundingClientRect().top, heading: !!head.querySelector('[aria-controls="ov-sec-queue"]'), pos: getComputedStyle(head).position };
        });
        expect(stuck).toEqual({ dy: expect.any(Number), heading: true, pos: 'sticky' });
        expect(Math.abs(stuck.dy)).toBeLessThan(1.5);
        // Awaiting action has its field: its head holds the heading and the field, padded under it.
        const waitHead = cols(popup).nth(1).locator('.research-overview__section-head.has-field');
        await expect(waitHead.locator('[aria-controls="ov-sec-waiting"]')).toHaveCount(1);
        await expect(waitHead.locator('.research-overview__section-search-input')).toHaveCount(1);
        // A row focused under the head is not hidden by it.
        expect(await cols(popup).nth(1).evaluate(c => parseFloat(getComputedStyle(c).scrollPaddingTop))).toBeGreaterThan(40);

        // Drawn anew (as for new live data): the same split, each column scrolled where it was.
        const scrolled = await queueCol.evaluate(c => c.scrollTop);
        await popup.evaluate(() => document.dispatchEvent(new Event('strom:live-section-prefs')));
        expect(await titlesByColumn(popup)).toEqual([['Now'], ['Awaiting action', 'Progress'], ['Queue']]);
        expect(await cols(popup).nth(2).evaluate(c => c.scrollTop)).toBe(scrolled);

        // Back under 1100: one column again, the field back in its section, nothing sticky.
        await popup.setViewportSize({ width: 1024, height: 600 });
        await expect(cols(popup)).toHaveCount(0);
        await expect(ov(popup).locator('.research-overview__section-head')).toHaveCount(0);
        await expect(ov(popup).locator('#ov-sec-waiting .research-overview__section-search-input')).toHaveCount(1);
        await popup.close();
    });

    test('a drag of the window with the caret in the search field: its text, focus and caret stay, the columns change, the sections are moved, not drawn anew', async ({ page }) => {
        await follow(page);
        const popup = await openWindow(page);
        await popup.setViewportSize({ width: 1440, height: 600 });
        await expect(cols(popup)).toHaveCount(2);
        await field(popup).click();
        await field(popup).pressSequentially('Olšinky');
        await expect(ov(popup).locator('.research-overview__waiting-item')).toHaveCount(6);
        await field(popup).evaluate((i: HTMLInputElement) => i.setSelectionRange(2, 4));
        // A mark on the drawn list: moved, not drawn anew, it keeps it.
        await ov(popup).locator('.research-overview__waiting-rows').first().evaluate(n => { (n as HTMLElement).dataset.mark = 'kept'; });

        const caret = () => field(popup).evaluate((i: HTMLInputElement) => ({
            focused: document.activeElement === i, value: i.value, start: i.selectionStart, end: i.selectionEnd,
        }));
        for (const [width, n] of [[1700, 3], [1024, 0], [1440, 2]] as const) {
            await popup.setViewportSize({ width, height: 600 });
            await expect(cols(popup)).toHaveCount(n);
            expect(await caret()).toEqual({ focused: true, value: 'Olšinky', start: 2, end: 4 });
            await expect(ov(popup).locator('[data-mark="kept"]')).toHaveCount(1);
        }
        // Typing on: filters as before, the split kept.
        await field(popup).evaluate((i: HTMLInputElement) => i.setSelectionRange(i.value.length, i.value.length));
        await popup.keyboard.type(' Hrotek');
        await expect(field(popup)).toHaveValue('Olšinky Hrotek');
        await expect(ov(popup).locator('.research-overview__waiting-item')).toHaveCount(1);
        expect(await titlesByColumn(popup)).toEqual([['Now', 'Awaiting action', 'Progress'], ['Queue']]);
        await popup.close();
    });

    test.describe('in German', () => {
        test.use({ locale: 'de-DE' });

        test('a research of a long name: nothing overflows at 1700 or 1440', async ({ page }) => {
            await follow(page);
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            const popup = await openWindow(page);
            for (const width of [1700, 1440]) {
                await popup.setViewportSize({ width, height: 700 });
                await expect(ov(popup)).toHaveClass(/\bis-cols\b/);
                await expect(ov(popup).locator('.research-overview__head--window')).toContainText(NAME);
                const over = await ov(popup).evaluate((root) => [root, ...root.querySelectorAll<HTMLElement>(
                    '.research-overview__head--window, .research-overview__body, .research-overview__lead, .research-overview__col, .research-overview__section-head')]
                    .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
                expect(over).toEqual([]);
                expect(await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            }
            await popup.close();
        });
    });
});
