/**
 * "Do next" and Undo (spec 052 §4, `queue.next`): the first item of a
 * queued task's ⋯ with its hint in the Queue, in the search's results and in
 * the small panel; the move to the top with its tag, flash and focus, the
 * toast with Undo putting the task back exactly (`restore` with the bridge's
 * `was`), the latest one marked on top, the agent at work on it and a bridge
 * that does not answer. Without `queue.next` the ⋯ is drawn as before.
 * A fake bridge with invented data (the Fíškovi of Smrkov).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, Page } from '@playwright/test';
import { CAPS, MANAGED_AGENT, ManagedBridge, ago, followManaged, GED, openOverview, overview } from './live-directions-bridge';

const OWN_FEATURES = ['directions.edit', 'directions.order', 'offLine.branches', 'queue.own'];

const GED_OFFLINE = GED.replace('0 @F0001@ FAM', [
    '0 @P0031@ INDI', '1 NAME Alois /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1868', '1 REFN P0031',
    '0 @F0001@ FAM',
].join('\n'));

const BRANCHES = [
    { id: 'B-P0031', person: 'P0031', via: { person: 'P0012', rel: 'sibling' }, nearest: 'G0001', tasks: 2, persons: 1,
        samples: [{ id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894' }], mode: 'occasional', own: false },
];
const OFF_LINE = { mode: 'occasional', own: false, share: 10, suggest: true, tasks: 4, queued: 4, ownTasks: 0, branches: BRANCHES };

const BRANCH_QUEUE = [
    { id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001', why: { kind: 'line', research: 'G0001' } },
    { id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894', state: 'next', branch: 'B-P0031', why: { kind: 'off', mode: 'occasional', branch: 'B-P0031' } },
    { id: 'T0102', text: 'Kdo byl Josef Fíšek', state: 'next', research: 'G0002', why: { kind: 'helps', research: 'G0002', by: 'question' } },
];

/** The ⋯ menu as drawn (its place on the screen left out). */
const menuHtml = (page: Page) => page.locator('#live-task-menu').evaluate(n => {
    const c = n.cloneNode(true) as HTMLElement;
    c.removeAttribute('style');
    return c.outerHTML;
});

/** The menu's DOM as the build before `queue.next` drew it (recorded once with RECORD_MENU=1). */
function expectRecorded(html: string, name: string): void {
    const file = join('e2e', 'fixtures', name);
    if (process.env.RECORD_MENU === '1') writeFileSync(file, html);
    expect(existsSync(file)).toBe(true);
    expect(html).toBe(readFileSync(file, 'utf8'));
}

test.describe('Do next without queue.next: the ⋯ as before', () => {
    test('queue.own with branches: Do now / To the end, then the research\'s Park / Drop', async ({ page }) => {
        await followManaged(page, { caps: { ...CAPS, offLineBranches: true }, features: OWN_FEATURES, offLine: OFF_LINE, queue: BRANCH_QUEUE, ged: GED_OFFLINE });
        await openOverview(page);
        await overview(page).locator('.live-queue-toggle').click();
        await overview(page).locator('.live-queue .live-queue-more[data-task="T0412"]').click();
        await expect(page.locator('#live-task-menu')).toBeVisible();
        expectRecorded(await menuHtml(page), 'task-menu-own.html');
    });

    test('neither queue.own nor queue.next: the research\'s Park / Drop only', async ({ page }) => {
        await followManaged(page, { queue: BRANCH_QUEUE });
        await openOverview(page);
        await overview(page).locator('.live-queue-toggle').click();
        await overview(page).locator('.live-queue .live-queue-more[data-task="T0412"]').click();
        await expect(page.locator('#live-task-menu')).toBeVisible();
        expectRecorded(await menuHtml(page), 'task-menu-plain.html');
    });
});

/** Four tasks up next in one direction (no branches, the research's links for Park / Drop). */
const QUEUE = [
    { id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001' },
    { id: 'T0102', text: 'Sčítání lidu 1880', state: 'next', research: 'G0001' },
    { id: 'T0103', text: 'Pozemková kniha Smrkov', state: 'next', research: 'G0001' },
    { id: 'T0104', text: 'Křest Jana Fíška', state: 'next', research: 'G0001', person: 'P0012' },
];
const NEXT = ['queue.next'];

/**
 * A research that numbers its queue (`queue.page`) and says why each task stands where it stands, as
 * Strom Research 1.32 does: its answer to a write carries the task's place (`pos`) and reason (`why`).
 */
const PLACED_FEATURES = ['directions.edit', 'directions.order', 'offLine.branches', 'queue.page', 'queue.next'];
const PLACED_QUEUE = Array.from({ length: 8 }, (_, i) => ({
    id: `T010${i + 1}`, text: `Matriky Smrkov, svazek ${i + 1}`, state: 'next', research: 'G0001', why: { kind: 'line', research: 'G0001' },
}));

const queueRows = (page: Page) => overview(page).locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]');
const order = (page: Page) => queueRows(page).evaluateAll(rs => rs.map(r => (r as HTMLElement).dataset.task));
const row = (page: Page, id: string) => overview(page).locator(`#ov-sec-queue .live-queue > .live-queue-row[data-task="${id}"]`);
const menu = (page: Page) => page.locator('#live-task-menu');
const toast = (page: Page) => page.locator('.toast[data-kind="queue-next"]');
const orderWrites = (b: ManagedBridge) => b.writes.filter(w => w.method === 'POST' && w.path.startsWith('queue/')).map(w => [w.path, w.body]);

async function unfoldQueue(page: Page): Promise<void> {
    const head = overview(page).locator('.live-section__head[aria-controls="ov-sec-queue"]');
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
}

/** "Do next" from the task's ⋯ in the overview's Queue. */
async function doNext(page: Page, id: string): Promise<void> {
    await row(page, id).locator('.live-queue-more').click();
    await menu(page).locator('[data-order="next"]').click();
    await expect(menu(page)).toHaveCount(0);
}

test.describe('Do next with queue.next', () => {
    test('first in the ⋯ with its hint and no mark; not for the first task; the task on top, tagged, lit and focused; the latest on top', async ({ page }) => {
        const b = await followManaged(page, { features: NEXT, queue: QUEUE });
        await openOverview(page);
        await unfoldQueue(page);
        await expect.poll(() => order(page)).toEqual(['T0101', 'T0102', 'T0103', 'T0104']);

        // The first task: no "Do next", the research's Park / Drop alone.
        await row(page, 'T0101').locator('.live-queue-more').click();
        await expect(menu(page).locator('[data-order]')).toHaveCount(0);
        await expect(menu(page).locator('.context-menu-divider')).toHaveCount(0);
        await expect(menu(page).locator('[data-action]')).toHaveCount(2);
        await page.keyboard.press('Escape');

        // Another: "Do next" first (no To the end without branches), a divider, Park / Drop.
        await row(page, 'T0103').locator('.live-queue-more').click();
        const items = menu(page).locator('.context-menu-item, .context-menu-divider');
        expect(await items.evaluateAll(es => es.map(e => (e as HTMLElement).dataset.order ?? (e as HTMLElement).dataset.action ?? 'divider')))
            .toEqual(['next', 'divider', 'park', 'drop']);
        await expect(menu(page).locator('[data-order="next"]')).toHaveText('Do nextComes up after the task in progress');
        await expect(menu(page).locator('[data-order="next"] .research-open-mark, [data-order="next"] .research-ai-badge')).toHaveCount(0);
        await expect(menu(page).locator('[data-order="next"]')).toBeFocused();
        await menu(page).locator('[data-order="next"]').click();

        await expect.poll(() => orderWrites(b)).toEqual([['queue/T0103', { do: 'next' }]]);
        await expect.poll(() => order(page)).toEqual(['T0103', 'T0101', 'T0102', 'T0104']);
        await expect(row(page, 'T0103').locator('.research-queue__tag-next')).toHaveText('next');
        await expect(row(page, 'T0103')).toHaveClass(/research-queue__row--flash/);
        await expect(row(page, 'T0103')).toBeFocused();
        await expect(toast(page)).toContainText('T0103 comes up next');
        await expect(toast(page).locator('.toast-action')).toHaveText('Undo');
        // The light goes after its 1.6 s.
        await expect(row(page, 'T0103')).not.toHaveClass(/research-queue__row--flash/, { timeout: 4000 });
        // The tag in place of the "set by hand" sentence.
        await expect(row(page, 'T0103').locator('.live-queue-why')).toHaveCount(0);

        // Two marked next: the latest on top.
        await doNext(page, 'T0104');
        await expect.poll(() => order(page)).toEqual(['T0104', 'T0103', 'T0101', 'T0102']);
        await expect(overview(page).locator('#ov-sec-queue .research-queue__tag-next')).toHaveCount(2);
    });

    test('Undo puts a task set to come next before back exactly: behind the one set later, its tag kept', async ({ page }) => {
        const queue = [{ ...QUEUE[3], own: 'next' }, { ...QUEUE[2], own: 'next' }, QUEUE[0], QUEUE[1]];
        const b = await followManaged(page, { features: NEXT, queue });
        await openOverview(page);
        await unfoldQueue(page);
        await expect.poll(() => order(page)).toEqual(['T0104', 'T0103', 'T0101', 'T0102']);
        await expect(overview(page).locator('#ov-sec-queue .research-queue__tag-next')).toHaveCount(2);
        await doNext(page, 'T0103');
        await expect.poll(() => order(page)).toEqual(['T0103', 'T0104', 'T0101', 'T0102']);
        await toast(page).locator('.toast-action', { hasText: 'Undo' }).click();
        await expect.poll(() => orderWrites(b)).toEqual([
            ['queue/T0103', { do: 'next' }],
            ['queue/T0103', { do: 'restore', was: { own: 'next', at: '2026-11-13T09:00:49.000Z' } }],
        ]);
        await expect.poll(() => order(page)).toEqual(['T0104', 'T0103', 'T0101', 'T0102']);
        await expect(row(page, 'T0103').locator('.research-queue__tag-next')).toHaveText('next');
    });

    test('Undo puts a task in the default order back to its place, without its tag', async ({ page }) => {
        const b = await followManaged(page, { features: NEXT, queue: QUEUE });
        await openOverview(page);
        await unfoldQueue(page);
        await doNext(page, 'T0102');
        await expect.poll(() => order(page)).toEqual(['T0102', 'T0101', 'T0103', 'T0104']);
        await toast(page).locator('.toast-action', { hasText: 'Undo' }).click();
        await expect.poll(() => orderWrites(b).at(-1)).toEqual(['queue/T0102', { do: 'restore', was: {} }]);
        await expect.poll(() => order(page)).toEqual(['T0101', 'T0102', 'T0103', 'T0104']);
        await expect(row(page, 'T0102').locator('.research-queue__tag-next')).toHaveCount(0);
    });

    test('Undo with a research that numbers its queue: back at its place at once, as the bridge answered (not with the next status)', async ({ page }) => {
        const b = await followManaged(page, {
            caps: { ...CAPS, offLineBranches: true }, features: PLACED_FEATURES, offLine: { ...OFF_LINE, branches: [] }, queue: PLACED_QUEUE, paged: true,
        });
        await openOverview(page);
        await unfoldQueue(page);
        await expect.poll(() => order(page)).toEqual(PLACED_QUEUE.map(q => q.id));
        await expect(row(page, 'T0106').locator('.live-queue-why')).toHaveText(/^in the direction /);
        const asks = b.statusAsks;
        await doNext(page, 'T0106');
        await expect.poll(() => order(page)).toEqual(['T0106', 'T0101', 'T0102', 'T0103', 'T0104', 'T0105', 'T0107', 'T0108']);
        await expect(toast(page)).toContainText('T0106 comes up next');
        // The status after the move read; the next one is not here yet (the app asks it only seconds later).
        await expect.poll(() => b.statusAsks).toBeGreaterThan(asks);
        let release = (): void => {};
        b.statusHold = { after: b.writes.length, until: new Promise<void>(r => { release = r; }) };
        // The research writes its tree before it answers.
        b.orderWriteMs = 300;
        await toast(page).locator('.toast-action', { hasText: 'Undo' }).click();
        await expect.poll(() => orderWrites(b).at(-1)).toEqual(['queue/T0106', { do: 'restore', was: {} }]);
        await expect.poll(() => order(page), { timeout: 1500 }).toEqual(PLACED_QUEUE.map(q => q.id));
        await expect(row(page, 'T0106').locator('.live-queue-num')).toHaveText('6');
        await expect(row(page, 'T0106').locator('.research-queue__tag-next')).toHaveCount(0);
        await expect(row(page, 'T0106').locator('.live-queue-why')).toHaveText(/^in the direction /);
        await expect(row(page, 'T0101').locator('.live-queue-num')).toHaveText('1');
        b.statusHold = null;
        release();
    });

    test('the agent at work on it: no "Do next"; taken meanwhile: said with no Undo and the queue read again', async ({ page }) => {
        const doing = { ...MANAGED_AGENT, task: 'Sčítání lidu 1880' };
        const b = await followManaged(page, { features: NEXT, queue: QUEUE, working: [doing] });
        await openOverview(page);
        await unfoldQueue(page);
        await row(page, 'T0102').locator('.live-queue-more').click();
        await expect(menu(page).locator('[data-order]')).toHaveCount(0);
        await page.keyboard.press('Escape');

        b.replies.push({ status: 409, body: { error: 'queue.doing' } });
        const asks = b.statusAsks;
        await doNext(page, 'T0103');
        await expect(toast(page)).toHaveText('The agent is working on this task now; its place cannot change.');
        await expect(toast(page).locator('.toast-action')).toHaveCount(0);
        await expect.poll(() => b.statusAsks).toBeGreaterThan(asks);
        await expect.poll(() => order(page)).toEqual(['T0101', 'T0102', 'T0103', 'T0104']);
        await expect(row(page, 'T0103').locator('.live-queue-problem')).toHaveCount(0);
    });

    test('a bridge that does not answer: said with Try again, the order unchanged; Try again writes it', async ({ page }) => {
        const b = await followManaged(page, { features: NEXT, queue: QUEUE });
        await openOverview(page);
        await unfoldQueue(page);
        b.replies.push({ status: 500, body: {} });
        await doNext(page, 'T0104');
        await expect(toast(page)).toContainText('The research is not responding; the order has not changed.');
        await expect(order(page)).resolves.toEqual(['T0101', 'T0102', 'T0103', 'T0104']);
        await expect(row(page, 'T0104').locator('.research-queue__tag-next')).toHaveCount(0);
        await toast(page).locator('.toast-action', { hasText: 'Try again' }).click();
        await expect.poll(() => order(page)).toEqual(['T0104', 'T0101', 'T0102', 'T0103']);
        expect(orderWrites(b)).toEqual([['queue/T0104', { do: 'next' }], ['queue/T0104', { do: 'next' }]]);
    });

    test('in the search\'s results: the row stays, on top with its tag, the search not cancelled', async ({ page }) => {
        const queue = Array.from({ length: 30 }, (_, i) => {
            const id = `T${String(701 + i).padStart(4, '0')}`;
            return i % 3 === 2
                ? { id, text: `Křest Jana Fíška ${i}`, state: 'next', research: 'G0001', person: 'P0012' }
                : { id, text: `Matriky Smrkov ${i}`, state: 'next', research: 'G0001' };
        });
        const b = await followManaged(page, { features: ['directions.edit', 'directions.order', 'queue.page', 'queue.search', 'queue.next'], queue, paged: true });
        await openOverview(page);
        await unfoldQueue(page);
        const field = overview(page).locator('.research-overview__queue-search-input');
        await field.fill('Křest');
        await expect(field).not.toHaveAttribute('aria-busy', 'true');
        await expect(overview(page).locator('.research-overview__queue-result')).toHaveText('10 tasks found');
        await expect(queueRows(page)).toHaveCount(10);
        await row(page, 'T0712').locator('.live-queue-more').click();
        await expect(menu(page).locator('[data-order="next"]')).toHaveText('Do nextComes up after the task in progress');
        await menu(page).locator('[data-order="next"]').click();
        await expect.poll(() => orderWrites(b)).toEqual([['queue/T0712', { do: 'next' }]]);
        await expect(field).toHaveValue('Křest');
        await expect(overview(page).locator('.research-overview__queue-result')).toHaveText('10 tasks found');
        await expect.poll(async () => (await order(page))[0]).toBe('T0712');
        await expect(queueRows(page)).toHaveCount(10);
        await expect(row(page, 'T0712').locator('.live-queue-num')).toHaveText('1');
        await expect(row(page, 'T0712').locator('.research-queue__tag-next')).toHaveText('next');
        // The search read again with the queue's new order (the same text).
        await expect.poll(() => b.queueReads.filter(q => q.includes('q=')).length).toBeGreaterThan(1);
    });

    for (const width of [1440, 1200, 1024]) {
        test(`its toast over the overview stands clear of the overview's footer (${width} px)`, async ({ page }) => {
            await followManaged(page, { features: NEXT, queue: QUEUE, size: { width, height: 860 } });
            await openOverview(page);
            await unfoldQueue(page);
            await doNext(page, 'T0103');
            await expect(toast(page)).toBeVisible();
            const foot = overview(page).locator('.research-overview__foot');
            await expect(foot).toBeVisible();
            const footTop = (await foot.boundingBox())!.y;
            // Once in its place (it rises there): above the footer's links, within the overview.
            await expect.poll(async () => {
                const t = (await toast(page).boundingBox())!;
                return Math.round(t.y + t.height);
            }).toBeLessThanOrEqual(Math.floor(footTop) - 8);
            const t = (await toast(page).boundingBox())!;
            const ov = (await overview(page).boundingBox())!;
            expect(t.x).toBeGreaterThanOrEqual(ov.x);
            expect(t.x + t.width).toBeLessThanOrEqual(ov.x + ov.width);
        });
    }

    test('the small panel\'s queue: "Do next" first in its ⋯', async ({ page }) => {
        const b = await followManaged(page, { features: NEXT, queue: QUEUE });
        const more = page.locator('#live-panel .live-queue-more[data-task="T0102"]');
        await more.click();
        await expect(menu(page).locator('.context-menu-item').first()).toHaveAttribute('data-order', 'next');
        await menu(page).locator('[data-order="next"]').click();
        await expect.poll(() => orderWrites(b)).toEqual([['queue/T0102', { do: 'next' }]]);
        await expect.poll(() => page.locator('#live-panel .live-queue > .live-queue-row[data-task]').first().getAttribute('data-task')).toBe('T0102');
        await expect(toast(page)).toContainText('T0102 comes up next');
    });

    test('a phone: the ⋯ a sheet at the bottom titled by the task, its rows 52 / 44 px', async ({ page }) => {
        await followManaged(page, { features: NEXT, queue: QUEUE, size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await unfoldQueue(page);
        await row(page, 'T0103').locator('.live-queue-more').click();
        const m = menu(page);
        await expect(m).toHaveClass(/live-task-menu--sheet/);
        await expect(m.locator('.live-task-menu__title')).toHaveText('T0103 Pozemková kniha Smrkov');
        // Once slid up (the app's sheet rises into its place).
        await expect.poll(async () => {
            const box = (await m.boundingBox())!;
            return [box.x, Math.round(box.width), Math.round(box.y + box.height)];
        }).toEqual([0, 390, 844]);
        expect((await m.locator('[data-order="next"]').boundingBox())!.height).toBeGreaterThanOrEqual(52);
        expect((await m.locator('[data-action="park"]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // Every row's text at its left, the research's Park / Drop as "Do next" (none centred).
        const lefts = await m.locator('[data-order="next"], [data-action="park"], [data-action="drop"]').evaluateAll(items => items.map(i => {
            const r = document.createRange();
            r.selectNodeContents(i);
            return Math.round(r.getClientRects()[0].left - i.getBoundingClientRect().left);
        }));
        expect(lefts).toEqual([16, 16, 16]);
        await expect(m.locator('[data-order="next"]')).toBeFocused();
        // Above the overview's sheet.
        const top = await page.evaluate(() => {
            const r = document.querySelector('#live-task-menu [data-order="next"]')!.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('#live-task-menu') !== null;
        });
        expect(top).toBe(true);
    });

    test('a phone: the ⋯ sheet over the app\'s darkened backdrop with its handle; a tap on the backdrop or Escape closes it, focus back on the ⋯', async ({ page }) => {
        await followManaged(page, { features: NEXT, queue: QUEUE, size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await unfoldQueue(page);
        const more = row(page, 'T0103').locator('.live-queue-more');
        await more.click();
        const backdrop = page.locator('.bottom-sheet-overlay.live-task-sheet');
        await expect(backdrop).toHaveClass(/\bactive\b/);
        // The app's sheet: in the backdrop, its handle first, the title under it.
        await expect(backdrop.locator('> #live-task-menu.bottom-sheet')).toBeVisible();
        const handle = menu(page).locator('> .bottom-sheet-handle');
        await expect(handle).toBeVisible();
        expect(await menu(page).evaluate(m => m.firstElementChild?.classList.contains('bottom-sheet-handle'))).toBe(true);
        const h = (await handle.boundingBox())!;
        expect(Math.round(h.width)).toBe(40);
        expect(h.y + h.height).toBeLessThanOrEqual((await menu(page).locator('.live-task-menu__title').boundingBox())!.y);
        // The window darkened under it, over the overview's sheet.
        await expect.poll(() => backdrop.evaluate(b => getComputedStyle(b).backgroundColor)).toBe('rgba(0, 0, 0, 0.35)');
        const b = (await backdrop.boundingBox())!;
        expect([b.x, b.y, Math.round(b.width), Math.round(b.height)]).toEqual([0, 0, 390, 844]);
        await expect.poll(async () => {
            const box = (await menu(page).boundingBox())!;
            return [box.x, Math.round(box.width), Math.round(box.y + box.height)];
        }).toEqual([0, 390, 844]);
        // A tap on the darkened window above the sheet: closed, focus back on the ⋯.
        await page.mouse.click(195, 80);
        await expect(menu(page)).toHaveCount(0);
        await expect(backdrop).toHaveCount(0);
        await expect(more).toBeFocused();
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        // Escape: the same.
        await more.click();
        await expect(menu(page).locator('[data-order="next"]')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(backdrop).toHaveCount(0);
        await expect(more).toBeFocused();
        // A tap in the sheet (its title) keeps it open.
        await more.click();
        await menu(page).locator('.live-task-menu__title').click();
        await expect(menu(page)).toBeVisible();
    });

    test('a phone without queue.next: the ⋯ the small menu as before, no backdrop and no handle', async ({ page }) => {
        await followManaged(page, { queue: QUEUE, size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await unfoldQueue(page);
        await row(page, 'T0103').locator('.live-queue-more').click();
        await expect(menu(page)).toBeVisible();
        await expect(menu(page)).not.toHaveClass(/live-task-menu--sheet|bottom-sheet/);
        await expect(menu(page).locator('.bottom-sheet-handle, .live-task-menu__title')).toHaveCount(0);
        await expect(page.locator('.bottom-sheet-overlay')).toHaveCount(0);
        expect(await menu(page).evaluate(m => m.parentElement === document.body)).toBe(true);
        expect(Math.round((await menu(page).boundingBox())!.width)).toBeLessThan(390);
    });
});

test.describe('Do next in the overview\'s own window', () => {
    test('asked of the main window (its bridge), the outcome shown in the window with Undo', async ({ page }) => {
        const b = await followManaged(page, { features: NEXT, queue: QUEUE });
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        const ov = popup.locator('#research-overview.research-overview--window');
        await expect(ov).toBeVisible();
        // What the window posts: research actions only, never a request to the bridge.
        const bridgeAsks: string[] = [];
        popup.on('request', r => { if (r.url().startsWith('http://127.0.0.1:5996')) bridgeAsks.push(r.url()); });
        const head = ov.locator('.live-section__head[aria-controls="ov-sec-queue"]');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        const winRow = (id: string) => ov.locator(`#ov-sec-queue .live-queue > .live-queue-row[data-task="${id}"]`);
        await winRow('T0103').locator('.live-queue-more').click();
        const m = popup.locator('#live-task-menu');
        await expect(m.locator('[data-order="next"]')).toHaveText('Do nextComes up after the task in progress');
        await m.locator('[data-order="next"]').click();
        await expect.poll(() => orderWrites(b)).toEqual([['queue/T0103', { do: 'next' }]]);
        await expect.poll(() => ov.locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]').first().getAttribute('data-task')).toBe('T0103');
        await expect(winRow('T0103').locator('.research-queue__tag-next')).toHaveText('next');
        const winToast = popup.locator('.toast[data-kind="queue-next"]');
        await expect(winToast).toContainText('T0103 comes up next');
        await winToast.locator('.toast-action').click();
        await expect.poll(() => orderWrites(b).at(-1)).toEqual(['queue/T0103', { do: 'restore', was: {} }]);
        await expect.poll(() => ov.locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]').first().getAttribute('data-task')).toBe('T0101');
        expect(bridgeAsks).toEqual([]);
        await popup.close();
    });

    test('Undo with a research that numbers its queue: back at its place in the window at once, as the bridge answered', async ({ page }) => {
        const b = await followManaged(page, {
            caps: { ...CAPS, offLineBranches: true }, features: PLACED_FEATURES, offLine: { ...OFF_LINE, branches: [] }, queue: PLACED_QUEUE, paged: true,
        });
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        const ov = popup.locator('#research-overview.research-overview--window');
        await expect(ov).toBeVisible();
        const head = ov.locator('.live-section__head[aria-controls="ov-sec-queue"]');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        const winOrder = () => ov.locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]').evaluateAll(rs => rs.map(r => (r as HTMLElement).dataset.task));
        const winRow = (id: string) => ov.locator(`#ov-sec-queue .live-queue > .live-queue-row[data-task="${id}"]`);
        await expect.poll(winOrder).toEqual(PLACED_QUEUE.map(q => q.id));
        const asks = b.statusAsks;
        await winRow('T0105').locator('.live-queue-more').click();
        await popup.locator('#live-task-menu [data-order="next"]').click();
        await expect.poll(() => orderWrites(b)).toEqual([['queue/T0105', { do: 'next' }]]);
        await expect.poll(async () => (await winOrder())[0]).toBe('T0105');
        const winToast = popup.locator('.toast[data-kind="queue-next"]');
        await expect(winToast).toContainText('T0105 comes up next');
        await expect.poll(() => b.statusAsks).toBeGreaterThan(asks);
        let release = (): void => {};
        b.statusHold = { after: b.writes.length, until: new Promise<void>(r => { release = r; }) };
        b.orderWriteMs = 300;
        await winToast.locator('.toast-action').click();
        await expect.poll(() => orderWrites(b).at(-1)).toEqual(['queue/T0105', { do: 'restore', was: {} }]);
        await expect.poll(winOrder, { timeout: 1500 }).toEqual(PLACED_QUEUE.map(q => q.id));
        await expect(winRow('T0105').locator('.research-queue__tag-next')).toHaveCount(0);
        await expect(winRow('T0105').locator('.live-queue-why')).toHaveText(/^in the direction /);
        b.statusHold = null;
        release();
        await popup.close();
    });
});

test.describe('Now: the actions under the text (§6)', () => {
    const LONG = 'Taufe von Marie Fischer in Smrkov 1871 und die Trauung ihrer Eltern im Pfarrbuch';
    const second = { who: 'agent-pozemky', since: ago(40), task: 'Grundbuch Smrkov, Haus Nr. 12 und seine Besitzer', person: 'P0001', research: 'G0001', session: 'N0133' };

    test('two sessions: each its own row of actions under its text (Show in tree, Finish and stop)', async ({ page }) => {
        await followManaged(page, { working: [{ ...MANAGED_AGENT, task: LONG }, second] });
        await openOverview(page);
        const now = overview(page).locator('.research-overview__now');
        const acts = now.locator('.research-overview__now-actions');
        await expect(acts).toHaveCount(2);
        await expect(acts.nth(0).locator('.link-button').first()).toHaveText('Show in tree');
        await expect(acts.nth(0).locator('.research-overview__finish')).toHaveCount(1);
        await expect(acts.nth(1).locator('.research-overview__finish')).toHaveCount(1);
        // Under its own text: the row's text across the width, the actions below it.
        for (const i of [0, 1]) {
            const li = now.locator('.research-overview__now-row').nth(i);
            const text = await li.locator('.research-overview__now-text').boundingBox();
            const a = await li.locator('.research-overview__now-actions').boundingBox();
            expect(a!.y).toBeGreaterThanOrEqual(text!.y + text!.height - 1);
            const liBox = await li.boundingBox();
            expect(text!.width).toBeGreaterThan(liBox!.width - 2);
        }
    });

    test('two lines at work: each line\'s session its own row of actions under its text', async ({ page }) => {
        await followManaged(page, { working: [MANAGED_AGENT, { ...second, research: 'G0002' }] });
        await openOverview(page);
        const lines = overview(page).locator('.research-overview__now-row--line');
        await expect(lines).toHaveCount(2);
        for (const i of [0, 1]) {
            const text = lines.nth(i).locator('.research-overview__now-text');
            await expect(text.locator('.research-overview__now-actions')).toHaveCount(1);
            await expect(text.locator('.research-overview__now-actions .research-overview__finish')).toHaveCount(1);
            // The actions under the session's meta line.
            const meta = await text.locator('.research-overview__now-meta').boundingBox();
            const a = await text.locator('.research-overview__now-actions').boundingBox();
            expect(a!.y).toBeGreaterThanOrEqual(meta!.y + meta!.height - 1);
        }
    });

    test('400 px in German: at least 32 characters a line, nothing overflowing', async ({ page }) => {
        await followManaged(page, { working: [{ ...MANAGED_AGENT, task: LONG }, second], size: { width: 1024, height: 800 } });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await openOverview(page);
        const ov = overview(page);
        await expect.poll(async () => Math.round((await ov.boundingBox())!.width)).toBeLessThanOrEqual(400);
        const task = ov.locator('.research-overview__now-row').first().locator('.live-task');
        await expect(task).toContainText('Taufe von Marie');
        const lines = await task.evaluate(n => {
            const text = n.firstChild as Text;
            const range = document.createRange();
            const tops = new Map<number, number>();
            for (let i = 0; i < text.length; i++) {
                range.setStart(text, i);
                range.setEnd(text, i + 1);
                const r = range.getClientRects()[0];
                if (!r) continue;
                const top = Math.round(r.top);
                tops.set(top, (tops.get(top) ?? 0) + 1);
            }
            return [...tops.values()];
        });
        // Every full line (all but the last) holds 32 characters or more.
        expect(lines.length).toBeGreaterThan(1);
        for (const n of lines.slice(0, -1)) expect(n).toBeGreaterThanOrEqual(32);
        const over = await ov.locator('.research-overview__now').evaluate(list => {
            const right = list.getBoundingClientRect().right + 0.5;
            return [...list.querySelectorAll<HTMLElement>('*')].filter(e => e.getBoundingClientRect().right > right || e.scrollWidth > e.clientWidth + 1)
                .map(e => e.className);
        });
        expect(over).toEqual([]);
        await expect(ov.locator('.research-overview__now-actions').first().locator('.link-button').first()).toHaveText('Im Stammbaum zeigen');
    });
});
