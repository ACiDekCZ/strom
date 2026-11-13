import { test, expect, Page } from '@playwright/test';
import { FakeBridge, UUID, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * Awaiting action searched in the Research overview (spec 083 §1, K1.1–K1.3):
 * the field from ten items, filtering at once with every key, the kind chips
 * counting what was found (a kind with nothing found dashed in its place),
 * "Found n of m", nothing found with Clear search (and Search all kinds under
 * a kind), a person's or task's number in an amber tag, the phases and places
 * with a match open while searching and the hand-made state back once
 * cleared, the folded section saying the text; the same without the bridge
 * (as of what was said last) and nothing asked of the bridge while typing; a
 * phone of 390 px. Invented data (the Fíškovi of Čapkov); the bridge is
 * answered by page.route; a fixed clock.
 */

const NOW = new Date('2026-11-10T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat'];

const web = { key: 'host:rodokmen.example', name: 'rodokmen.example', kind: 'web' };
const archive = { key: 'repo:R0001', name: 'Archiv Čapkov', kind: 'archive' };
const office = { key: 'to:Pfarramt Großhof', name: 'Pfarramt Großhof', kind: 'office' };
const family = { key: 'family', name: 'Rodina', kind: 'family' };

/** Twelve items: ten to do in four places, two sent. */
function waiting(): Record<string, unknown>[] {
    const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
    const items: Record<string, unknown>[] = [
        { id: 'T0001', what: 'Ověřit, zda badatelna funguje', kind: 'check', section: 'decide', group: web, actions: ['answer'] },
        { id: 'T0002', what: 'Uložit snímky matriky Čapkov 1841', kind: 'images', section: 'images', group: archive, person: 'P0003', actions: ['folder'] },
        { id: 'T0003', what: 'Uložit snímky matriky Čapkov 1850', kind: 'images', section: 'images', group: archive, actions: ['folder'] },
        { id: 'T0004', what: 'Uložit snímky matriky Białe Pole', kind: 'images', section: 'images', group: archive, actions: ['folder'] },
        { id: 'T0005', what: 'Napsat faře o křest', kind: 'letter', section: 'letter', group: office, person: 'P0001', to: 'Pfarramt Großhof', actions: ['answer'] },
        { id: 'T0006', what: 'Napsat faře o sňatek', kind: 'letter', section: 'letter', group: office, to: 'Pfarramt Großhof', actions: ['answer'] },
        { id: 'T0007', what: 'Zeptat se rodiny na fotografii', kind: 'family', section: 'family', group: family, actions: ['answer'] },
        { id: 'T0008', what: 'Zeptat se rodiny na dopisy', kind: 'family', section: 'family', group: family, actions: ['answer'] },
        { id: 'T0009', what: 'Dohledat sňatek na rodokmen.example', kind: 'web', section: 'web', group: web, actions: ['answer'] },
        { id: 'T0010', what: 'Dohledat úmrtí na rodokmen.example', kind: 'web', section: 'web', group: web, actions: ['answer'] },
        { id: 'T0011', what: 'Odeslaný dopis faře', kind: 'letter', section: 'letter', group: office, phase: 'sent', sentAt: at(72), actions: ['answer'] },
        { id: 'T0012', what: 'Odeslaný dotaz rodině', kind: 'family', section: 'family', group: family, phase: 'sent', sentAt: at(48), actions: ['answer'] },
    ];
    return items.map((w, i) => ({ order: i, at: at(100 - i), ...w }));
}

/** The research tree, its bridge answering with `items`; not followed. */
async function researchTree(page: Page, items = waiting()): Promise<FakeBridge> {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: ACCEPTS, links: LINKS, waiting: items, features: ['waiting.groups'], treeGed: researchGed() });
    await poll(page);
    return bridge;
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-waiting');
const heading = (page: Page) => ov(page).locator('[aria-controls="ov-sec-waiting"]');
const field = (page: Page) => sec(page).locator('.research-overview__section-search-input');
const chips = (page: Page) => sec(page).locator('.research-overview__waiting-filters .research-overview__filter');
const status = (page: Page) => sec(page).locator('.research-overview__search-status');
const empty = (page: Page) => sec(page).locator('.research-overview__search-empty');
const rowIds = (page: Page) => sec(page).locator('.research-overview__waiting-item').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id));
const phaseHead = (page: Page, phase: string) => sec(page).locator(`.research-overview__phase-head[data-phase="${phase}"]`);
const groupHead = (page: Page, phase: string, key: string) =>
    sec(page).locator(`.research-overview__phase[data-phase="${phase}"] .research-overview__waiting-group[data-group="${key}"]`);

async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(ov(page)).toBeVisible();
    await expect(heading(page)).toBeVisible();
}

/** Every phase and place unfolded by hand (to see all the rows). */
async function unfoldAll(page: Page): Promise<void> {
    for (const h of await sec(page).locator('.research-overview__phase-head[aria-expanded="false"]').all()) await h.click();
    for (const g of await sec(page).locator('.research-overview__waiting-group[aria-expanded="false"]').all()) await g.click();
}

/** The bridge's requests besides its regular status asks. */
const asked = (b: FakeBridge) => (b.seen ?? []).filter(s => !/^GET \/status\b/.test(s));

test.describe('Awaiting action searched in the overview', () => {
    test('typing filters at once: chips count what was found, a kind with none dashed, Found n of m; nothing asked of the bridge', async ({ page }) => {
        const bridge = await researchTree(page);
        await openOverview(page);
        await expect(heading(page)).toContainText('Awaiting action · 10');
        // The order: the field under the heading, over the chips.
        await expect(field(page)).toBeVisible();
        await expect(field(page)).toHaveAttribute('placeholder', 'Search people, places, archives, tasks…');
        await expect(field(page)).toHaveAttribute('aria-label', 'Search Awaiting action');
        const order = await sec(page).evaluate(s => [...s.children].map(c => c.className.split(' ')[0]));
        expect(order.indexOf('research-overview__section-search')).toBeLessThan(order.indexOf('research-overview__filters'));
        await expect(chips(page)).toHaveText(['All 12', 'Decisions 1', 'Images 3', 'Archives and offices 3', 'Family 3', 'Web 2']);
        await expect(status(page)).toBeHidden();

        const before = asked(bridge).length;
        await field(page).click();
        // Each key filters at once (no pause).
        await page.keyboard.type('matrik');
        await expect(status(page)).toHaveText('Found 3 of 12');
        await expect(chips(page)).toHaveText(['All 3', 'Decisions 0', 'Images 3', 'Archives and offices 0', 'Family 0', 'Web 0']);
        await expect(chips(page).nth(1)).toHaveClass(/research-overview__filter--empty/);
        await expect(chips(page).nth(1)).toHaveCSS('border-top-style', 'dashed');
        await expect(chips(page).nth(2)).not.toHaveClass(/research-overview__filter--empty/);
        // The place with a match open, its rows in sight; the phase without one not drawn.
        expect(await rowIds(page)).toEqual(['T0002', 'T0003', 'T0004']);
        await expect(phaseHead(page, 'todo')).toHaveText(/To do · 3/);
        await expect(phaseHead(page, 'sent')).toHaveCount(0);
        // The text keeps the focus while the list changes under it.
        await expect(field(page)).toBeFocused();
        // A kind with nothing found can be chosen; Found n of m counts within the kind.
        await chips(page).nth(2).click();
        await expect(status(page)).toHaveText('Found 3 of 3');
        await chips(page).nth(0).click();
        // ł spelled out, the last letter forgiven.
        await field(page).fill('bialy');
        expect(await rowIds(page)).toEqual(['T0004']);
        await field(page).fill('grosshof');
        expect(await rowIds(page)).toEqual(['T0005', 'T0006', 'T0011']);
        await expect(phaseHead(page, 'sent')).toHaveAttribute('aria-expanded', 'true');
        // A screen reader is told after a pause, from the field's live region.
        await expect(sec(page).locator('.research-overview__section-search-live')).toHaveText('Found 3 of 12');
        // Searched here only: nothing went to the bridge while typing.
        expect(asked(bridge).slice(before)).toEqual([]);
    });

    test('a person\'s or task\'s number: the amber tag in the row, that part left out of its line', async ({ page }) => {
        await researchTree(page);
        await openOverview(page);
        await field(page).fill('P3');
        expect(await rowIds(page)).toEqual(['T0002']);
        const row = sec(page).locator('.research-overview__waiting-item[data-id="T0002"]');
        await expect(row.locator('.research-overview__hit')).toHaveText('P0003 Jan Fíšek');
        await expect(row.locator('.research-overview__waiting-who')).toHaveCount(0);
        await expect(row.locator('.research-overview__hit')).toHaveCSS('font-weight', '600');
        // T and the task's number by its value.
        await field(page).fill('T5');
        expect(await rowIds(page)).toEqual(['T0005']);
        const letter = sec(page).locator('.research-overview__waiting-item[data-id="T0005"]');
        await expect(letter.locator('.research-overview__hit')).toHaveText('T0005');
        await expect(letter.locator('.research-overview__waiting-who')).toHaveText('Josef Fíšek');
        // Text matches are not lit.
        await field(page).fill('fíšek');
        expect(await rowIds(page)).toEqual(['T0002', 'T0005']);
        await expect(sec(page).locator('.research-overview__hit')).toHaveCount(0);
    });

    test('nothing found: Clear search; under a kind: Search all kinds', async ({ page }) => {
        await researchTree(page);
        await openOverview(page);
        await field(page).fill('xyzzy');
        await expect(empty(page)).toHaveText(/Nothing found\.\s*Clear search/);
        await expect(status(page)).toBeHidden();
        await expect(chips(page)).toHaveText(['All 0', 'Decisions 0', 'Images 0', 'Archives and offices 0', 'Family 0', 'Web 0']);
        await expect(phaseHead(page, 'todo')).toHaveCount(0);
        await empty(page).locator('.research-overview__search-cancel').click();
        await expect(field(page)).toHaveValue('');
        await expect(field(page)).toBeFocused();
        await expect(empty(page)).toHaveCount(0);
        await expect(chips(page).first()).toHaveText('All 12');
        // Under Images, a text of the letters: said there, with the way to all kinds.
        await chips(page).nth(2).click();
        await field(page).fill('faře');
        await expect(empty(page)).toContainText('Nothing found in Images.');
        await expect(chips(page).nth(3)).toHaveText('Archives and offices 3');
        await empty(page).locator('.research-overview__search-all').click();
        await expect(chips(page).first()).toHaveAttribute('aria-checked', 'true');
        await expect(field(page)).toHaveValue('faře');
        await expect(field(page)).toBeFocused();
        expect(await rowIds(page)).toEqual(['T0005', 'T0006', 'T0011']);
        // Escape clears a full field first; the overview stays.
        await page.keyboard.press('Escape');
        await expect(field(page)).toHaveValue('');
        await expect(ov(page)).toBeVisible();
    });

    test('phases and places with a match open while searching; cleared, the hand-made state is back', async ({ page }) => {
        await researchTree(page);
        await openOverview(page);
        // By hand: Archiv Čapkov unfolded; Awaiting a reply folded (its default).
        await groupHead(page, 'todo', 'repo:R0001').click();
        await expect(groupHead(page, 'todo', 'repo:R0001')).toHaveAttribute('aria-expanded', 'true');
        await expect(groupHead(page, 'todo', 'to:Pfarramt Großhof')).toHaveAttribute('aria-expanded', 'false');
        await expect(phaseHead(page, 'sent')).toHaveAttribute('aria-expanded', 'false');
        await field(page).fill('faře');
        await expect(phaseHead(page, 'sent')).toHaveAttribute('aria-expanded', 'true');
        await expect(phaseHead(page, 'sent')).toHaveText(/Awaiting a reply · 1/);
        await expect(groupHead(page, 'todo', 'to:Pfarramt Großhof')).toHaveAttribute('aria-expanded', 'true');
        await expect(groupHead(page, 'todo', 'to:Pfarramt Großhof').locator('.research-overview__group-span')).toHaveText('2');
        // Places without a match are not drawn.
        await expect(groupHead(page, 'todo', 'repo:R0001')).toHaveCount(0);
        // Folded during the search: for the search only.
        await groupHead(page, 'todo', 'to:Pfarramt Großhof').click();
        await expect(groupHead(page, 'todo', 'to:Pfarramt Großhof')).toHaveAttribute('aria-expanded', 'false');
        expect(await rowIds(page)).toEqual(['T0011']);
        // ×: the state before the search.
        await sec(page).locator('.research-overview__section-search-clear').click();
        await expect(phaseHead(page, 'sent')).toHaveAttribute('aria-expanded', 'false');
        await expect(groupHead(page, 'todo', 'repo:R0001')).toHaveAttribute('aria-expanded', 'true');
        await expect(groupHead(page, 'todo', 'to:Pfarramt Großhof')).toHaveAttribute('aria-expanded', 'false');
        // A new search opens everything with a match again.
        await field(page).fill('faře');
        await expect(groupHead(page, 'todo', 'to:Pfarramt Großhof')).toHaveAttribute('aria-expanded', 'true');
    });

    test('new data while searching: the result follows, the text, focus and caret stay', async ({ page }) => {
        const bridge = await researchTree(page);
        await openOverview(page);
        await field(page).click();
        await page.keyboard.type('matriky');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        expect(await rowIds(page)).toEqual(['T0002', 'T0003', 'T0004']);
        // One item done, a new one arrives.
        bridge.waiting = [...waiting().filter(w => w.id !== 'T0003'),
            { id: 'T0013', what: 'Uložit snímky matriky Čapkov 1862', kind: 'images', section: 'images', group: archive, order: 20, at: NOW.toISOString(), actions: ['folder'] }];
        await poll(page);
        await expect.poll(() => rowIds(page)).toEqual(['T0002', 'T0004', 'T0013']);
        await expect(status(page)).toHaveText('Found 3 of 12');
        await expect(field(page)).toBeFocused();
        await expect(field(page)).toHaveValue('matriky');
        expect(await field(page).evaluate(i => (i as HTMLInputElement).selectionStart)).toBe(5);
    });

    test('under ten items no field; folded, the heading says the text and unfolds to the same result', async ({ page }) => {
        const bridge = await researchTree(page, waiting().slice(0, 9));
        await openOverview(page);
        await expect(heading(page)).toContainText('Awaiting action · 9');
        await expect(field(page)).toHaveCount(0);
        await expect(sec(page).locator('.research-overview__search-status')).toHaveCount(0);
        // Ten or more: the field.
        bridge.waiting = waiting();
        await poll(page);
        await expect(field(page)).toBeVisible();
        await field(page).fill('matriky');
        await heading(page).click();
        await expect(heading(page)).toHaveAttribute('aria-expanded', 'false');
        const sum = heading(page).locator('.research-overview__section-sum--search');
        await expect(sum).toHaveText('“matriky”');
        await expect(sum.locator('svg')).toHaveCount(1);
        await expect(heading(page).locator('.live-section__sum:not(.research-overview__section-sum--search)')).toHaveCount(0);
        await heading(page).click();
        await expect(field(page)).toHaveValue('matriky');
        expect(await rowIds(page)).toEqual(['T0002', 'T0003', 'T0004']);
        // Fewer than ten meanwhile: the field stays while it has a text.
        bridge.waiting = waiting().slice(0, 9);
        await poll(page);
        await expect.poll(() => rowIds(page)).toEqual(['T0002', 'T0003', 'T0004']);
        await expect(field(page)).toBeVisible();
        await field(page).fill('');
        await expect(field(page)).toHaveCount(0);
        // Closed and opened again: nothing of the search is kept.
        bridge.waiting = waiting();
        await poll(page);
        await field(page).fill('matriky');
        await ov(page).locator('.research-overview__close').click();
        await openOverview(page);
        await expect(field(page)).toHaveValue('');
    });

    test('without the bridge (as of what was said last): searched the same, nothing sent', async ({ page }) => {
        const bridge = await researchTree(page);
        bridge.down = true;
        await poll(page);
        await openOverview(page);
        await expect(sec(page).locator('.research-overview__as-of')).toContainText('as of');
        const seen = (bridge.seen ?? []).length;
        await field(page).fill('rodiny');
        await unfoldAll(page);
        // "rodiny" forgives its last letter: "rodině" of the sent one too.
        expect(await rowIds(page)).toEqual(['T0007', 'T0008', 'T0012']);
        await expect(status(page)).toHaveText('Found 3 of 12');
        await expect(chips(page).nth(4)).toHaveText('Family 3');
        await field(page).fill('p1');
        await expect(sec(page).locator('.research-overview__waiting-item[data-id="T0005"] .research-overview__hit')).toHaveText('P0001 Josef Fíšek');
        expect((bridge.seen ?? []).length).toBe(seen);
    });
});

test.describe('Awaiting action searched on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('390 px: the field 44 px with 16 px text, the chips 32 px, nothing wider than the sheet, the title under the sheet\'s head on focus', async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await openResearch(page, { bridge: false });
        // What the research said last, remembered on this device (a phone shows the tree's side only).
        await page.evaluate(({ uuid, items, at }) => {
            localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({ items, groups: true, at }));
        }, { uuid: UUID, items: waiting(), at: NOW.toISOString() });
        await openOverview(page);
        await expect(ov(page)).toHaveClass(/research-overview--sheet/);
        const box = await field(page).evaluate(i => {
            const wrap = i.closest('.research-overview__section-search')!.getBoundingClientRect();
            return { h: Math.round(wrap.height), font: parseFloat(getComputedStyle(i).fontSize) };
        });
        expect(box).toEqual({ h: 44, font: 16 });
        const clear = sec(page).locator('.research-overview__section-search-clear');
        await field(page).tap();
        await page.keyboard.type('fíšek');
        await expect(clear).toBeVisible();
        expect(Math.round((await clear.boundingBox())!.height)).toBe(40);
        expect(Math.round((await chips(page).first().boundingBox())!.height)).toBe(32);
        // The section's title just under the sheet's head (as far as the sheet scrolls).
        const at = await ov(page).evaluate(root => {
            const body = root.querySelector('.research-overview__body') as HTMLElement;
            const head = root.querySelector('[aria-controls="ov-sec-waiting"]')!.closest('.live-section__headrow') as HTMLElement;
            return { gap: head.getBoundingClientRect().top - body.getBoundingClientRect().top, end: body.scrollTop >= body.scrollHeight - body.clientHeight - 1 };
        });
        expect(at.end || Math.abs(at.gap - 4) <= 2).toBe(true);
        expect(await rowIds(page)).toEqual(['T0002', 'T0005']);
        // In German (the longest) nothing is wider than the sheet or the page.
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await expect(field(page)).toHaveAttribute('placeholder', 'Person, Ort, Archiv, Aufgabe suchen…');
        const over = await ov(page).evaluate(root => {
            const body = root.querySelector('.research-overview__body') as HTMLElement;
            const r = root.getBoundingClientRect();
            const out = [...root.querySelectorAll('#ov-sec-waiting *')].filter(e => {
                const b = e.getBoundingClientRect();
                return b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5);
            }).map(e => e.className);
            return { scroll: body.scrollWidth - body.clientWidth, out };
        });
        expect(over).toEqual({ scroll: 0, out: [] });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
