/**
 * The queue searched and read by pages in the Research overview's own window
 * (spec 052 §1 in the window, K3 D2): the window never asks the bridge; each
 * page of the queue (a search's or the whole queue's) is asked of the main
 * window (`queue-list`), which reads it from its bridge with the function the
 * docked overview uses and answers with the page. The window draws the field
 * and the results as the docked overview does: the count in the Queue's
 * heading, Load more, a number outside the queue, nothing found, a failed
 * bridge with Try again; the main window closed greys the field as every
 * other action. A research without `queue.search`: the window as before. A
 * fake bridge with invented data.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';
import { BRIDGE, ManagedBridge, followManaged } from './live-directions-bridge';

const FEATURES = ['directions.edit', 'directions.order', 'queue.page'];
const SEARCH = [...FEATURES, 'queue.search'];
const BASELINE = join('e2e', 'fixtures', 'window-queue-without-search.html');

/** 120 tasks up next (every tenth a baptism of Jan Fíšek, P0012, in G0002), one set aside. */
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

const follow = (page: Page, features = SEARCH): Promise<ManagedBridge> =>
    followManaged(page, { features, queue: queue(), paged: true, elsewhere: { T0950: 'done' } });

/** The overview's own window, opened from the ⧉ menu; every request it makes to the bridge is kept. */
async function openWindow(page: Page): Promise<{ popup: Page; asked: string[] }> {
    await page.locator('#view-window-btn').click();
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
    const asked: string[] = [];
    popup.on('request', (req) => { if (req.url().startsWith(BRIDGE.slice(0, 22))) asked.push(req.url()); });
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
    return { popup, asked };
}

const ov = (p: Page) => p.locator('#research-overview');
const queueHead = (p: Page) => ov(p).locator('.live-section__head[aria-controls="ov-sec-queue"]');
const field = (p: Page) => ov(p).locator('.research-overview__queue-search-input');
const result = (p: Page) => ov(p).locator('.research-overview__queue-result');
const rows = (p: Page) => ov(p).locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]');

async function unfoldQueue(p: Page): Promise<void> {
    await expect(queueHead(p)).toBeVisible();
    if (await queueHead(p).getAttribute('aria-expanded') === 'false') await queueHead(p).click();
    await expect(queueHead(p)).toHaveAttribute('aria-expanded', 'true');
}

async function search(p: Page, text: string): Promise<void> {
    await field(p).fill(text);
    await expect(field(p)).not.toHaveAttribute('aria-busy', 'true');
}

test.describe('the queue in the overview\'s own window (queue-list through the main window)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('without queue.search: no field, the Queue drawn as before, nothing asked', async ({ page }) => {
        const b = await follow(page, FEATURES);
        const { popup, asked } = await openWindow(page);
        await unfoldQueue(popup);
        await expect(rows(popup)).toHaveCount(15);
        await expect(field(popup)).toHaveCount(0);
        const html = await ov(popup).locator('#ov-sec-queue').evaluate(n => `${n.previousElementSibling?.outerHTML ?? ''}\n${n.outerHTML}`);
        // Recorded from the build before the window searched (RECORD_BASELINE=1 writes it again).
        if (process.env.RECORD_BASELINE) writeFileSync(BASELINE, html);
        expect(html).toBe(readFileSync(BASELINE, 'utf8'));
        expect(b.queueReads).toEqual([]);
        expect(asked).toEqual([]);
        await popup.close();
    });
    test('the search through the main window: the count in the heading, a task\'s number, a person, Load more, a number outside the queue, nothing found; the window asks no bridge', async ({ page }) => {
        const b = await follow(page);
        const { popup, asked } = await openWindow(page);
        await unfoldQueue(popup);
        await expect(queueHead(popup)).toContainText('Queue · 120');
        await expect(popup.locator('[role="search"] .research-overview__queue-search-input')).toHaveAttribute('aria-label', 'Search the queue');

        await search(popup, 'T0815');
        await expect(result(popup)).toHaveText('1 task found');
        await expect(rows(popup)).toHaveCount(1);
        await expect(rows(popup).first().locator('.research-queue__match')).toHaveText('T0815');
        await expect(rows(popup).first().locator('.live-queue-num')).toHaveText('115');

        await search(popup, 'P12');
        await expect(result(popup)).toHaveText('13 tasks found');
        await expect(rows(popup).first().locator('.research-queue__match')).toHaveText('P0012 Jan Fíšek');
        await expect(rows(popup).last().locator('.research-queue__deferred')).toHaveText('postponed');

        await search(popup, 'Smrkov');
        await expect(result(popup)).toHaveText('108 tasks found');
        await expect(rows(popup)).toHaveCount(50);
        await expect(ov(popup).locator('.live-queue-shown')).toHaveText('50 of 108 shown');
        await ov(popup).locator('.live-queue-load').click();
        await expect(rows(popup)).toHaveCount(100);
        await expect(ov(popup).locator('.live-queue-load')).toBeFocused();

        await search(popup, 'T0950');
        await expect(result(popup)).toContainText('T0950 is no longer in the queue (done).');
        await expect(rows(popup)).toHaveCount(0);
        await search(popup, 'zzz');
        await expect(result(popup)).toHaveText(/^Nothing found\.Clear search$/);
        await result(popup).locator('.research-overview__queue-cancel').click();
        await expect(field(popup)).toHaveValue('');
        await expect(rows(popup)).toHaveCount(15);

        // Every page read by the main window from its bridge, the same requests as the docked overview's.
        expect(b.queueReads).toEqual(['count=50&q=T0815', 'count=50&q=P12', 'count=50&q=Smrkov', 'from=50&count=50&q=Smrkov', 'count=50&q=T0950', 'count=50&q=zzz']);
        expect(asked).toEqual([]);
        await popup.close();
    });

    test('the whole queue by pages in the window: Load more past the status\'s tasks, asked of the main window', async ({ page }) => {
        const b = await follow(page);
        const { popup, asked } = await openWindow(page);
        await unfoldQueue(popup);
        await expect(rows(popup)).toHaveCount(15);
        await expect(ov(popup).locator('.live-queue-shown')).toHaveText('14 of 120 shown');
        await ov(popup).locator('.live-queue-load').click();
        await expect(ov(popup).locator('.live-queue-shown')).toHaveText('64 of 120 shown');
        await expect(rows(popup)).toHaveCount(65);
        expect(b.queueReads).toEqual(['from=14&count=50&state=next']);
        expect(asked).toEqual([]);
        await popup.close();
    });

    test('a busy or silent bridge says so with Try again; the main window closed greys the field; a field greyed before is usable again once drawn with its main window', async ({ page }) => {
        const b = await follow(page);
        const { popup, asked } = await openWindow(page);
        await unfoldQueue(popup);
        b.queueReplies.push({ status: 503, body: { error: 'research.busy' }, headers: { 'Retry-After': '2' } });
        await search(popup, 'Fíška');
        await expect(result(popup)).toContainText('The research is busy; search is not available right now.');
        await expect(field(popup)).toHaveValue('Fíška');
        await result(popup).locator('.live-queue-retry').click();
        await expect(result(popup)).toHaveText('12 tasks found');

        // The field is kept over the redraws: greyed once (as state 5 greys it), drawn again with the main window there, usable.
        await popup.evaluate(() => {
            const input = document.querySelector<HTMLInputElement>('.research-overview__queue-search-input')!;
            input.dataset.greyed = 'all';
            input.setAttribute('aria-disabled', 'true');
            input.disabled = true;
            (window.Strom.UI as unknown as { renderResearchOverview(): void }).renderResearchOverview();
        });
        await expect(field(popup)).toBeEnabled();
        await expect(field(popup)).not.toHaveAttribute('aria-disabled', 'true');
        await expect(field(popup)).toHaveValue('Fíška');

        b.queueReplies.push({ status: 500, body: {} });
        await search(popup, 'Smrkov 1');
        await expect(result(popup).locator('.live-queue-retry')).toBeVisible();
        await expect(result(popup)).toHaveClass(/is-error/);

        await page.close();
        await expect(ov(popup).locator('.research-overview__strip')).toBeVisible({ timeout: 6000 });
        await expect(field(popup)).toBeDisabled();
        await expect(field(popup)).toHaveAttribute('data-greyed', 'all');
        expect(asked).toEqual([]);
        await popup.close();
    });
});
