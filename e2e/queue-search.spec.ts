/**
 * The queue searched through its bridge (spec 052 §1–§2, `queue.search`): the
 * field under the Queue's heading in the overview, the search sent after a
 * pause of typing (`GET /queue?q=`), its states (found, nothing, a number
 * outside the queue, a failed bridge, the queue changing meanwhile), the keys
 * and what a screen reader hears; "Search the queue…" in the small panel.
 * Without `queue.search` the Queue is drawn as before. A fake bridge with
 * invented data.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';
import { ManagedBridge, followManaged, openOverview, overview } from './live-directions-bridge';

const FEATURES = ['directions.edit', 'directions.order', 'queue.page'];
const SEARCH = [...FEATURES, 'queue.search'];

/**
 * 120 tasks up next (T0701–T0820): every tenth a baptism of Jan Fíšek (P0012)
 * in the line G0002, the rest registers of Smrkov in G0001; one set aside about P0012.
 */
function queue(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (let i = 1; i <= 120; i++) {
        const id = `T${String(700 + i).padStart(4, '0')}`;
        out.push(i % 10 === 0
            ? { id, text: `Křest Jana Fíška ${i / 10}`, state: 'next', research: 'G0002', person: 'P0012' }
            : { id, text: `Matriky Smrkov ${i}`, state: 'next', research: 'G0001' });
    }
    out.push({ id: 'T0900', text: 'Pozemková kniha Fíšků', state: 'parked', research: 'G0002', person: 'P0012' });
    return out;
}

const ELSEWHERE = { T0950: 'done', T0951: 'waiting', T0952: 'parked', T0953: 'dropped' };

const follow = (page: Page, o: { features?: string[]; size?: { width: number; height: number }; fastReconnect?: boolean } = {}): Promise<ManagedBridge> =>
    followManaged(page, { features: o.features ?? SEARCH, queue: queue(), paged: true, elsewhere: ELSEWHERE,
        ...(o.size ? { size: o.size } : {}), ...(o.fastReconnect ? { fastReconnect: true } : {}) });

const queueHead = (page: Page) => overview(page).locator('.live-section__head[aria-controls="ov-sec-queue"]');
const field = (page: Page) => overview(page).locator('.research-overview__queue-search-input');
const result = (page: Page) => overview(page).locator('.research-overview__queue-result');
const rows = (page: Page) => overview(page).locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]');
const live = (page: Page) => overview(page).locator('.research-overview__queue-search-live');

async function unfoldQueue(page: Page): Promise<void> {
    if (await queueHead(page).getAttribute('aria-expanded') === 'false') await queueHead(page).click();
    await expect(queueHead(page)).toHaveAttribute('aria-expanded', 'true');
}

/** Type a text and wait for its answer (the field no longer busy). */
async function search(page: Page, text: string): Promise<void> {
    await field(page).fill(text);
    await expect(field(page)).not.toHaveAttribute('aria-busy', 'true');
}

test.describe('the queue searched through the bridge (queue.search)', () => {
    test('without queue.search: no field, the Queue drawn as before', async ({ page }) => {
        await follow(page, { features: FEATURES });
        await openOverview(page);
        await unfoldQueue(page);
        await expect(field(page)).toHaveCount(0);
        await expect(page.locator('#live-panel .live-queue-search-link')).toHaveCount(0);
        // The section exactly as it was drawn before the search came (its heading, chips and rows).
        const html = await overview(page).locator('#ov-sec-queue').evaluate(n => `${n.previousElementSibling?.outerHTML ?? ''}\n${n.outerHTML}`);
        // Recorded from the build before the search (e2e/fixtures/queue-without-search.html).
        expect(html).toBe(readFileSync(join('e2e', 'fixtures', 'queue-without-search.html'), 'utf8'));
    });

    test('the field under the heading, the count in the title, a task\'s number in its spellings, a person, a name without diacritics', async ({ page }) => {
        const b = await follow(page);
        await openOverview(page);
        await unfoldQueue(page);
        await expect(queueHead(page)).toContainText('Queue · 120');
        await expect(overview(page).locator('[role="search"] .research-overview__queue-search-input')).toHaveAttribute('aria-label', 'Search the queue');
        // The field stands over the chips.
        const order = await overview(page).locator('#ov-sec-queue').evaluate(n => [...n.children].map(c => c.className.split(' ')[0]));
        expect(order.slice(0, 2)).toEqual(['research-overview__queue-search', 'research-overview__filters']);
        // Rows of the plain queue carry no task number.
        await expect(rows(page).first().locator('.live-queue-id, .research-queue__match')).toHaveCount(0);

        for (const text of ['T0815', 't815', '815']) {
            await search(page, text);
            await expect(result(page)).toHaveText('1 task found');
            await expect(rows(page)).toHaveCount(1);
            await expect(rows(page).first().locator('.research-queue__match')).toHaveText('T0815');
            await expect(rows(page).first().locator('.live-queue-num')).toHaveText('115');
        }
        expect(b.queueReads.filter(q => q.includes('q='))).toEqual(['count=50&q=T0815', 'count=50&q=t815', 'count=50&q=815']);

        // A person's number: the person's tag on each row, the one set aside last with "–" and its tag.
        await search(page, 'P12');
        await expect(result(page)).toHaveText('13 tasks found');
        await expect(rows(page)).toHaveCount(13);
        await expect(rows(page).first().locator('.research-queue__match')).toHaveText('P0012 Jan Fíšek');
        await expect(rows(page).first().locator('.live-queue-id')).toHaveText('T0710');
        const last = rows(page).last();
        await expect(last).toHaveClass(/live-queue-row--parked/);
        await expect(last.locator('.live-queue-num')).toHaveText('–');
        await expect(last.locator('.research-queue__deferred')).toHaveText('postponed');

        // A name without diacritics finds it with them (the bridge searches; the text is not lit).
        await search(page, 'krest jana');
        await expect(result(page)).toHaveText('12 tasks found');
        await expect(rows(page).first()).toContainText('Křest Jana Fíška 1');
        await expect(rows(page).first().locator('.research-queue__match')).toHaveCount(0);
        await expect(live(page)).toHaveText('12 tasks found');
    });

    test('a chip narrows the search; nothing found in it offers all directions; a number outside the queue in its four states', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        await unfoldQueue(page);
        const chips = overview(page).locator('.research-overview__queue-filters');
        await chips.locator('[data-direction="G0002"]').click();
        await search(page, 'Fíška');
        await expect(result(page)).toHaveText('12 tasks found · in Potomci: Josef Fíšek');
        // The chips keep the queue's counts.
        await expect(chips.locator('[data-direction="all"]')).toHaveText('All 120');

        await search(page, 'Smrkov');
        await expect(result(page)).toContainText('Nothing found in Potomci: Josef Fíšek.');
        await result(page).locator('.research-overview__queue-all').click();
        await expect(chips.locator('[data-direction="all"]')).toHaveAttribute('aria-checked', 'true');
        await expect(result(page)).toHaveText('108 tasks found');
        await expect(field(page)).toBeFocused();

        for (const [id, said] of [['T0950', 'done'], ['T0951', 'awaiting action'], ['T0952', 'postponed'], ['T0953', 'given up']]) {
            await search(page, id);
            await expect(result(page)).toContainText(`${id} is no longer in the queue (${said}).`);
            await expect(rows(page)).toHaveCount(0);
        }
        await search(page, 'zzz');
        await expect(result(page)).toHaveText(/^Nothing found\.Clear search$/);
        await result(page).locator('.research-overview__queue-cancel').click();
        await expect(field(page)).toHaveValue('');
        await expect(field(page)).toBeFocused();
        await expect(result(page)).toHaveCount(0);
        // The queue again: its window of 14 up next and the one set aside.
        await expect(rows(page)).toHaveCount(15);
    });

    test('more than a page found: Load more reads the next page with the same text', async ({ page }) => {
        const b = await follow(page);
        await openOverview(page);
        await unfoldQueue(page);
        await search(page, 'Smrkov');
        await expect(result(page)).toHaveText('108 tasks found');
        await expect(rows(page)).toHaveCount(50);
        await expect(overview(page).locator('.live-queue-shown')).toHaveText('50 of 108 shown');
        await overview(page).locator('.live-queue-load').click();
        await expect(rows(page)).toHaveCount(100);
        expect(b.queueReads.at(-1)).toBe('from=50&count=50&q=Smrkov');
        await expect(overview(page).locator('.live-queue-load')).toBeFocused();
    });

    test('Escape clears a full field (the overview stays), closes it from an empty one; ↓ goes to the rows, ↑ back', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        await unfoldQueue(page);
        await search(page, 'Smrkov');
        await field(page).press('Escape');
        await expect(field(page)).toHaveValue('');
        await expect(overview(page)).toBeVisible();
        await expect(field(page)).toBeFocused();
        await field(page).press('ArrowDown');
        await expect(rows(page).first()).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(rows(page).nth(1)).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await expect(field(page)).toBeFocused();
        await field(page).press('Escape');
        await expect(overview(page)).toHaveCount(0);
    });

    test('while typed and read the old list stands dimmed; the answer is said once; a failed or busy bridge says so with Try again', async ({ page }) => {
        const b = await follow(page);
        await openOverview(page);
        await unfoldQueue(page);
        let release: () => void = () => {};
        b.queueHold = new Promise<void>(r => { release = r; });
        await field(page).fill('Smrkov');
        await expect(field(page)).toHaveAttribute('aria-busy', 'true');
        await expect(overview(page).locator('.research-overview__queue-search-spin')).toBeVisible();
        await expect(overview(page).locator('#ov-sec-queue')).toHaveClass(/research-queue--pending/);
        await expect(rows(page)).toHaveCount(15);
        await expect(live(page)).toHaveText('');
        b.queueHold = null;
        release();
        await expect(field(page)).not.toHaveAttribute('aria-busy', 'true');
        await expect(overview(page).locator('#ov-sec-queue')).not.toHaveClass(/research-queue--pending/);
        await expect(live(page)).toHaveText('108 tasks found');

        b.queueReplies.push({ status: 503, body: { error: 'research.busy' }, headers: { 'Retry-After': '2' } });
        await search(page, 'Fíška');
        await expect(result(page)).toContainText('The research is busy; search is not available right now.');
        await expect(field(page)).toHaveValue('Fíška');
        await result(page).locator('.live-queue-retry').click();
        await expect(result(page)).toHaveText('12 tasks found');
    });

    test('the queue changing while the field has the focus: the field keeps its text, caret and focus, the results are read again', async ({ page }) => {
        // The bridge's stream comes back every 250 ms: each time the status, the overview drawn again.
        const b = await follow(page, { fastReconnect: true });
        await openOverview(page);
        await unfoldQueue(page);
        await search(page, 'Fíška');
        await expect(result(page)).toHaveText('12 tasks found');
        await field(page).evaluate((n: HTMLInputElement) => n.setSelectionRange(2, 2));
        b.queue.unshift({ id: 'T0999', text: 'Křest Jana Fíška 0', state: 'next', research: 'G0002', person: 'P0012' });
        b.paged!.rev++;
        await expect(result(page)).toHaveText('13 tasks found');
        await expect(field(page)).toBeFocused();
        await expect(field(page)).toHaveValue('Fíška');
        expect(await field(page).evaluate((n: HTMLInputElement) => [n.selectionStart, n.selectionEnd])).toEqual([2, 2]);
        await expect(overview(page).locator('#ov-sec-queue')).not.toHaveClass(/research-queue--pending/);
    });

    test('closed and opened again: the field empty, nothing of the search kept in storage', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        await unfoldQueue(page);
        await search(page, 'Smrkov');
        const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
        expect(stored).not.toContain('Smrkov');
        await overview(page).locator('.research-overview__close').click();
        await openOverview(page);
        await expect(field(page)).toHaveValue('');
        await expect(result(page)).toHaveCount(0);
    });

    test('"Search the queue…" in the small panel: the Queue unfolded at the top, the caret in its field, its choice kept', async ({ page }) => {
        await follow(page);
        const link = page.locator('#live-panel .live-queue-search-link');
        await expect(link).toHaveText('Search the queue…');
        const before = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => /section|pref/i.test(k))));
        await link.click();
        await expect(overview(page)).toBeVisible();
        await expect(queueHead(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(field(page)).toBeFocused();
        // Its heading at the top of the overview's body (or the body scrolled as far as it goes).
        const at = await overview(page).evaluate((root) => {
            const scroller = root.querySelector<HTMLElement>('.research-overview__body')!;
            const head = root.querySelector('[aria-controls="ov-sec-queue"]')!.getBoundingClientRect();
            return { top: head.top - scroller.getBoundingClientRect().top, end: scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1 };
        });
        expect(at.top >= 0 && (at.top < 20 || at.end)).toBe(true);
        const after = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => /section|pref/i.test(k))));
        expect(after).toBe(before);
        // Closed and opened again: the Queue as its choice says (folded).
        await overview(page).locator('.research-overview__close').click();
        await openOverview(page);
        await expect(queueHead(page)).toHaveAttribute('aria-expanded', 'false');
    });

    test('a phone: no link in the small panel', async ({ page }) => {
        await follow(page, { size: { width: 390, height: 800 } });
        await expect(page.locator('.live-queue-search-link')).toHaveCount(0);
    });
});
