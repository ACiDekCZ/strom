import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * The order of Awaiting action in the Research overview (spec 083 U6,
 * K5.1–K5.4): "Order: Recommended" from two items; Newest / Oldest first by
 * when an item has waited since, its groups standing where their newest
 * (oldest) item stands, the time beside each row and after each place's
 * name; the Groups switch only in a time order, off one list per phase with
 * each row's place in a tag; the "new" tag on what the record of Awaiting
 * action had not seen; the choice kept on this device when the overview opens
 * again; a phone's sheet; "Most helpful" only with `waiting.gain` (spec 105
 * K4.1), by score with its reason under the rows. Invented data (the Fíškovi of Čapkov);
 * the bridge is answered by page.route; a fixed clock in a fixed time zone.
 */

test.use({ timezoneId: 'Europe/Prague' });

// 11:30 in Prague.
const NOW = new Date('2026-11-10T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat'];

const web = { key: 'host:rodokmen.example', name: 'rodokmen.example', kind: 'web' };
const archive = { key: 'repo:R0001', name: 'Archiv Čapkov', kind: 'archive' };
const office = { key: 'to:Pfarramt Großhof', name: 'Pfarramt Großhof', kind: 'office' };
const family = { key: 'family', name: 'Rodina', kind: 'family' };

const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

/** Six to do in four places (in the research's order the archive first), two sent. */
function waiting(): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [
        { id: 'T0003', what: 'Uložit snímky matriky Čapkov 1850', kind: 'images', section: 'images', group: archive, at: minAgo(6 * 1440), actions: ['folder'] },
        { id: 'T0002', what: 'Uložit snímky matriky Čapkov 1841', kind: 'images', section: 'images', group: archive, at: minAgo(180), actions: ['folder'] },
        { id: 'T0005', what: 'Zeptat se rodiny na fotografii', kind: 'family', section: 'family', group: family, actions: ['answer'] },
        { id: 'T0004', what: 'Napsat faře o křest', kind: 'letter', section: 'letter', group: office, to: 'Pfarramt Großhof', at: minAgo(1440), actions: ['answer'] },
        { id: 'T0006', what: 'Dohledat úmrtí na rodokmen.example', kind: 'web', section: 'web', group: web, at: minAgo(2 * 1440), actions: ['answer'] },
        { id: 'T0001', what: 'Dohledat sňatek na rodokmen.example', kind: 'web', section: 'web', group: web, at: minAgo(25), actions: ['answer'] },
        { id: 'T0007', what: 'Odeslaný dopis faře', kind: 'letter', section: 'letter', group: office, phase: 'sent', sentAt: minAgo(4 * 1440), at: minAgo(5 * 1440), actions: ['answer'] },
        { id: 'T0008', what: 'Odeslaný dotaz rodině', kind: 'family', section: 'family', group: family, phase: 'sent', sentAt: minAgo(1440), at: minAgo(2000), actions: ['answer'] },
    ];
    return items.map((w, i) => ({ order: i, ...w }));
}

/** The items with the research's gains (spec 105 K4.1): two by score 40 (in the research's order), two without one. */
function gainItems(): Record<string, unknown>[] {
    const gains: Record<string, unknown> = {
        T0004: { score: 110, says: 'nová generace: rodiče osoby Jan Fíšek · přímá linie · odblokuje 3 úkoly', parts: [{ kind: 'line' }, { kind: 'unblocks', n: 3 }] },
        T0003: { score: 40, says: 'přímá linie', parts: [{ kind: 'line' }] },
        T0006: { score: 40, says: '', parts: [] },
        T0002: { score: 10, says: '', parts: [] },
    };
    return waiting().map(w => (gains[w.id as string] ? { ...w, gain: gains[w.id as string] } : w));
}

/** The research tree, its bridge answering with `items`; not followed. */
async function researchTree(page: Page, items = waiting(), width = 1440, features = ['waiting.groups']): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width, height: width > 640 ? 900 : 844 });
    await openResearch(page);
    await fakeBridge(page, { accepts: ACCEPTS, links: LINKS, waiting: items, features, treeGed: researchGed() });
    await poll(page);
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-waiting');
const orderBtn = (page: Page) => sec(page).locator('.research-overview__order-btn');
const groupsSwitch = (page: Page) => sec(page).getByRole('switch', { name: 'Groups' });
const rowIds = (page: Page, phase = 'todo') =>
    sec(page).locator(`.research-overview__phase[data-phase="${phase}"] .research-overview__waiting-item`).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id));
const groupKeys = (page: Page, phase = 'todo') =>
    sec(page).locator(`.research-overview__phase[data-phase="${phase}"] .research-overview__waiting-group`).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.group));
const item = (page: Page, id: string) => sec(page).locator(`.research-overview__waiting-item[data-id="${id}"]`);

async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(ov(page)).toBeVisible();
    await expect(sec(page)).toBeVisible();
}

async function closeOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.closeResearchOverview());
    await expect(ov(page)).toHaveCount(0);
}

/** Every phase and place unfolded by hand (to see all the rows). */
async function unfoldAll(page: Page): Promise<void> {
    for (const h of await sec(page).locator('.research-overview__phase-head[aria-expanded="false"]').all()) await h.click();
    for (let i = 0; i < 10; i++) {
        const g = sec(page).locator('.research-overview__waiting-group[aria-expanded="false"]').first();
        if (await g.count() === 0) break;
        await g.click();
    }
}

async function choose(page: Page, name: string): Promise<void> {
    await orderBtn(page).click();
    const menu = page.getByRole('menu', { name: 'Order' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitemradio', { name }).click();
    await expect(menu).toHaveCount(0);
}

test.describe('Awaiting action in an order', () => {
    test('Order: Recommended from two items; Newest first by time with groups, the time beside the rows; the switch only in a time order', async ({ page }) => {
        await researchTree(page);
        await openOverview(page);
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Recommended');
        await expect(orderBtn(page)).toHaveAttribute('aria-haspopup', 'menu');
        await expect(orderBtn(page)).not.toHaveClass(/is-time/);
        await expect(groupsSwitch(page)).toHaveCount(0);
        await unfoldAll(page);
        // Recommended: the research's order and places, the time in the meta line as before.
        expect(await groupKeys(page)).toEqual(['repo:R0001', 'family', 'to:Pfarramt Großhof', 'host:rodokmen.example']);
        expect(await rowIds(page)).toEqual(['T0003', 'T0002', 'T0005', 'T0004', 'T0006', 'T0001']);
        await expect(sec(page).locator('.research-overview__since')).toHaveCount(0);

        // The menu: three orders, a choice of one.
        await orderBtn(page).click();
        await expect(orderBtn(page)).toHaveAttribute('aria-expanded', 'true');
        const menu = page.getByRole('menu', { name: 'Order' });
        await expect(menu.getByRole('menuitemradio')).toHaveText([/Recommended/, /Newest first/, /Oldest first/]);
        await expect(menu.getByRole('menuitemradio', { name: 'Recommended' })).toHaveAttribute('aria-checked', 'true');
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);

        await choose(page, 'Newest first');
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Newest first');
        await expect(orderBtn(page)).toHaveClass(/is-time/);
        await expect(groupsSwitch(page)).toHaveAttribute('aria-checked', 'true');
        await unfoldAll(page);
        // Each place where its newest item stands; within it newest first; without a time last.
        expect(await groupKeys(page)).toEqual(['host:rodokmen.example', 'repo:R0001', 'to:Pfarramt Großhof', 'family']);
        expect(await rowIds(page)).toEqual(['T0001', 'T0006', 'T0002', 'T0003', 'T0004', 'T0005']);
        // The time beside each row: within the hour, today, yesterday, a day; none said, none shown.
        await expect(item(page, 'T0001').locator('.research-overview__since')).toHaveText('25 min. ago');
        await expect(item(page, 'T0002').locator('.research-overview__since')).toHaveText('08:30 AM');
        await expect(item(page, 'T0004').locator('.research-overview__since')).toHaveText('yesterday');
        await expect(item(page, 'T0003').locator('.research-overview__since')).toHaveText('11/4');
        await expect(item(page, 'T0003').locator('time.research-overview__since')).toHaveAttribute('datetime', minAgo(6 * 1440));
        await expect(item(page, 'T0005').locator('.research-overview__since')).toHaveCount(0);
        // Under a place's name (in its band, spec 105 U4) the time of its first item.
        await expect(sec(page).locator('.research-overview__waiting-grouphead:has(> .research-overview__waiting-group[data-group="host:rodokmen.example"]) > .research-overview__group-since')).toHaveText('25 min. ago');
        // Awaiting a reply by time too.
        expect(await rowIds(page, 'sent')).toEqual(['T0008', 'T0007']);

        // Groups off: one list per phase, each row with its place.
        await groupsSwitch(page).click();
        await expect(groupsSwitch(page)).toHaveAttribute('aria-checked', 'false');
        await expect(groupsSwitch(page)).toBeFocused();
        await expect(sec(page).locator('.research-overview__phase[data-phase="todo"] .research-overview__waiting-group')).toHaveCount(0);
        expect(await rowIds(page)).toEqual(['T0001', 'T0002', 'T0004', 'T0006', 'T0003', 'T0005']);
        await expect(item(page, 'T0002').locator('.research-overview__group-tag')).toHaveText('Archiv Čapkov');
        await expect(item(page, 'T0002').locator('.research-overview__group-tag')).toHaveAttribute('title', 'Archiv Čapkov');

        await choose(page, 'Oldest first');
        expect(await rowIds(page)).toEqual(['T0003', 'T0006', 'T0004', 'T0002', 'T0001', 'T0005']);

        // Back to Recommended: no switch, the places and the research's order again.
        await choose(page, 'Recommended');
        await expect(groupsSwitch(page)).toHaveCount(0);
        await expect(orderBtn(page)).toBeFocused();
        await unfoldAll(page);
        expect(await rowIds(page)).toEqual(['T0003', 'T0002', 'T0005', 'T0004', 'T0006', 'T0001']);
    });

    test('Most helpful (spec 105 K4.1): not offered without waiting.gain; a kept choice draws Recommended and stays kept', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('strom-live-overview-waiting-order', 'gain'));
        await researchTree(page, gainItems());
        await openOverview(page);
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Recommended');
        await orderBtn(page).click();
        await expect(page.getByRole('menu', { name: 'Order' }).getByRole('menuitemradio')).toHaveText([/Recommended/, /Newest first/, /Oldest first/]);
        await page.keyboard.press('Escape');
        await unfoldAll(page);
        expect(await rowIds(page)).toEqual(['T0003', 'T0002', 'T0005', 'T0004', 'T0006', 'T0001']);
        await expect(sec(page).locator('.waiting-gain')).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('strom-live-overview-waiting-order'))).toBe('gain');
    });

    test('Most helpful with waiting.gain: by score, without a gain last; its reason only in this order; kept', async ({ page }) => {
        await researchTree(page, gainItems(), 1440, ['waiting.groups', 'waiting.gain']);
        await openOverview(page);
        await orderBtn(page).click();
        const menu = page.getByRole('menu', { name: 'Order' });
        await expect(menu.getByRole('menuitemradio')).toHaveText([/Recommended/, /Newest first/, /Oldest first/, /Most helpful/]);
        await page.keyboard.press('Escape');
        // Recommended: no reason.
        await unfoldAll(page);
        await expect(sec(page).locator('.waiting-gain')).toHaveCount(0);
        await choose(page, 'Most helpful');
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Most helpful');
        await unfoldAll(page);
        // Each place where its most helpful item stands; within it by score, then the research's order.
        expect(await groupKeys(page)).toEqual(['to:Pfarramt Großhof', 'repo:R0001', 'host:rodokmen.example', 'family']);
        expect(await rowIds(page)).toEqual(['T0004', 'T0003', 'T0002', 'T0006', 'T0001', 'T0005']);
        // The reason under the row, only where the research said one; no time beside the rows.
        await expect(item(page, 'T0004').locator('.waiting-gain')).toHaveText('nová generace: rodiče osoby Jan Fíšek · přímá linie · odblokuje 3 úkoly');
        await expect(item(page, 'T0004').locator('.waiting-gain')).toBeVisible();
        await expect(item(page, 'T0003').locator('.waiting-gain')).toHaveText('přímá linie');
        await expect(item(page, 'T0006').locator('.waiting-gain')).toHaveCount(0);
        await expect(item(page, 'T0005').locator('.waiting-gain')).toHaveCount(0);
        await expect(sec(page).locator('.research-overview__waiting-side .research-overview__since')).toHaveCount(0);
        // Groups off: one list by score, the items without a gain last in the research's order.
        await groupsSwitch(page).click();
        expect(await rowIds(page)).toEqual(['T0004', 'T0003', 'T0006', 'T0002', 'T0005', 'T0001']);
        // Another order: no reason.
        await choose(page, 'Newest first');
        await expect(sec(page).locator('.waiting-gain')).toHaveCount(0);
        await choose(page, 'Most helpful');
        // Kept when the overview opens again.
        await closeOverview(page);
        await openOverview(page);
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Most helpful');
        await expect(item(page, 'T0004').locator('.waiting-gain')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('strom-live-overview-waiting-order'))).toBe('gain');
    });

    test('Most helpful on a phone: a reason with a long word without spaces wraps inside its row, nothing cut', async ({ page }) => {
        const long = 'Pfarramt_Großhof_Matriken_und_Kirchenbücher_der_Gemeinde_Unterwaldenstein_1780';
        const items = gainItems().map(w => (w.id === 'T0003' ? { ...w, gain: { score: 40, says: long, parts: [] } } : w));
        await researchTree(page, items, 390, ['waiting.groups', 'waiting.gain']);
        await openOverview(page);
        await choose(page, 'Most helpful');
        await unfoldAll(page);
        const why = item(page, 'T0003').locator('.waiting-gain');
        await expect(why).toHaveText(long);
        const fit = await why.evaluate((g) => {
            const row = g.closest<HTMLElement>('.research-overview__waiting-item')!;
            const r = g.getBoundingClientRect();
            return {
                own: g.scrollWidth <= g.clientWidth + 1,
                inRow: r.right <= row.getBoundingClientRect().right + 1,
                wraps: r.height > parseFloat(getComputedStyle(g).fontSize) * 2,
                page: document.documentElement.scrollWidth <= window.innerWidth,
            };
        });
        expect(fit).toEqual({ own: true, inRow: true, wraps: true, page: true });
    });

    test('one item: no order offered', async ({ page }) => {
        await researchTree(page, waiting().slice(0, 1));
        await openOverview(page);
        await expect(item(page, 'T0003')).toBeVisible();
        await expect(orderBtn(page)).toHaveCount(0);
    });

    test('the "new" tag on what was not seen yet, in every order; a folded place counts it', async ({ page }) => {
        await researchTree(page);
        // The record of Awaiting action saw all but T0002 and T0006.
        await page.evaluate(() => {
            const tree = window.Strom.DataManager.getCurrentTreeId();
            localStorage.setItem('strom-live-waiting-seen', JSON.stringify({ [tree]: ['T0003', 'T0005', 'T0004', 'T0001'] }));
        });
        await openOverview(page);
        // Folded: the place says how many are new.
        const archiveHead = sec(page).locator('.research-overview__waiting-group[data-group="repo:R0001"]');
        await expect(archiveHead).toHaveAttribute('aria-expanded', 'false');
        await expect(archiveHead.locator('.research-overview__new')).toHaveText('new: 1');
        await expect(archiveHead).toHaveAttribute('aria-label', /, new: 1$/);
        await unfoldAll(page);
        await expect(item(page, 'T0002').locator('.research-overview__new')).toHaveText('new');
        await expect(item(page, 'T0006').locator('.research-overview__new')).toHaveText('new');
        await expect(sec(page).locator('.research-overview__waiting-item .research-overview__new')).toHaveCount(2);
        // Seen now, the tag stays while the overview is open, in a time order too (over the time).
        await choose(page, 'Newest first');
        await unfoldAll(page);
        const side = item(page, 'T0002').locator('.research-overview__waiting-side');
        await expect(side.locator('.research-overview__new')).toHaveText('new');
        await expect(side.locator('.research-overview__since')).toHaveText('08:30 AM');
        // Closed and opened again: all was seen, nothing is new.
        await closeOverview(page);
        await openOverview(page);
        await unfoldAll(page);
        await expect(sec(page).locator('.research-overview__new')).toHaveCount(0);
    });

    test('the choice is kept on this device when the overview opens again', async ({ page }) => {
        await researchTree(page);
        await openOverview(page);
        await choose(page, 'Oldest first');
        await groupsSwitch(page).click();
        await closeOverview(page);
        await openOverview(page);
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Oldest first');
        await expect(groupsSwitch(page)).toHaveAttribute('aria-checked', 'false');
        expect(await rowIds(page)).toEqual(['T0003', 'T0006', 'T0004', 'T0002', 'T0001', 'T0005']);
        // The switch keeps its state through Recommended for the next time order.
        await choose(page, 'Recommended');
        await choose(page, 'Newest first');
        await expect(groupsSwitch(page)).toHaveAttribute('aria-checked', 'false');
        expect(await page.evaluate(() => [localStorage.getItem('strom-live-overview-waiting-order'), localStorage.getItem('strom-live-overview-waiting-groups')]))
            .toEqual(['newest', '0']);
    });

    test('a phone: the orders in a sheet, a choice of one', async ({ page }) => {
        await researchTree(page, waiting(), 390);
        await openOverview(page);
        await orderBtn(page).click();
        const sheet = page.getByRole('menu', { name: 'Order' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('menuitemradio', { name: 'Recommended' })).toHaveAttribute('aria-checked', 'true');
        await sheet.getByRole('menuitemradio', { name: 'Oldest first' }).click();
        await expect(orderBtn(page)).toHaveAttribute('aria-label', 'Order: Oldest first');
        await expect(groupsSwitch(page)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
});
