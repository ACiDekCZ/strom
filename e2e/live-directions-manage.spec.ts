import { test, expect, Page } from '@playwright/test';
import {
    BridgeReply, directionRow, directionWrites, followManaged, launchedLinks, openOverview, overview, UUID,
} from './live-directions-bridge.js';

/**
 * Research directions managed from the app through the research's bridge
 * (spec 038 §1, §3, §4, §7): the order of work numbered with a paused one in
 * its place and ended ones folded, the state line, what a direction found,
 * pause with Undo (no question), end with a confirmation, moves by Alt+↑
 * and from ⋯ written once, a busy research tried again once then a box at
 * the row, an archive read-only, the empty state, and an older research
 * unchanged (the terminal's links, a footer naming the version).
 */

const managedNames = (page: Page) => overview(page).locator('.research-direction--managed .research-direction__name');
const BUSY: BridgeReply = { status: 503, body: { error: 'research.busy' }, headers: { 'Retry-After': '3' } };

test.describe('directions managed through the bridge', () => {
    test('the order of work: numbers, a paused one in its place, ended folded, the state line, the detail', async ({ page }) => {
        await followManaged(page);
        await openOverview(page);
        const sec = overview(page).locator('.research-directions--managed');
        await expect(managedNames(page)).toHaveText(['Předci: Jan Fíšek', 'Předci: Anna Svobodová', 'Potomci: Josef Fíšek']);
        await expect(sec.locator('.research-direction--managed .research-direction__num')).toHaveText(['1', '2', '3']);
        await expect(overview(page).locator('.live-section__title', { hasText: 'Directions' })).toHaveText('Directions · 2 active');
        await expect(directionRow(page, 'G0001').locator('.research-direction__meta'))
            .toHaveText(/Jan Fíšek.*Now: křest Marie Fíškové, Smrkov 1871.*up to 8 generations/);
        await expect(directionRow(page, 'G0004').locator('.research-direction__chip')).toHaveText(/^paused · /);
        await expect(directionRow(page, 'G0004').locator('.research-direction__meta')).toHaveText('“matriky ještě nejsou online”');
        await expect(directionRow(page, 'G0002').locator('.research-direction__meta'))
            .toHaveText(/Josef Fíšek.*The next run proposes the tasks\..*before 1750/);
        await expect(sec.locator('.research-directions__note'))
            .toHaveText('The research spends most time on the directions at the top; the others keep going.');
        await expect(overview(page).locator('.research-directions__new')).toHaveText('+ New direction');
        await expect(sec.locator('.research-directions__foot')).toHaveCount(0);
        // No in-row End / Restart for the order's rows: it is in the detail and the ⋯.
        await expect(sec.locator('.research-direction--managed .research-direction__do')).toHaveCount(0);

        const ended = sec.locator('.research-directions__inactive[data-ended]');
        await expect(ended).toHaveText('▸Ended · 1');
        await ended.click();
        await expect(directionRow(page, 'G0005').locator('.research-direction__num')).toHaveCount(0);
        await expect(directionRow(page, 'G0005').locator('.research-direction__do')).toHaveText('Restart');
        await expect(directionRow(page, 'G0005').locator('.research-direction__do .research-open-mark')).toHaveCount(0);

        await directionRow(page, 'G0001').locator('.research-direction__head').click();
        const detail = directionRow(page, 'G0001').locator('.research-direction__detail');
        await expect(detail.locator('.research-direction__found')).toHaveText(/Last 7 days:.*3 sessions.*1 person.*9 sources/);
        await expect(detail.locator('[data-do="pause"]')).toHaveText('Pause');
        await expect(detail.locator('[data-do="pause"] .research-open-mark')).toHaveCount(0);
        await expect(detail.locator('[data-do="work"] .research-ai-badge')).toHaveCount(1);
        await expect(detail.locator('[data-do="work"] .research-open-mark')).toHaveCount(1);
        await expect(detail.locator('[data-do="show"]')).toHaveText('Show in tree');
    });

    test('pause: written at once without a question, Undo restarts it', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        await directionRow(page, 'G0001').locator('.research-direction__head').click();
        await directionRow(page, 'G0001').locator('[data-do="pause"]').click();
        await expect.poll(() => directionWrites(b).map(w => [w.path, w.body])).toEqual([['directions/G0001/state', { do: 'pause' }]]);
        await expect(directionRow(page, 'G0001').locator('.research-direction__chip')).toHaveText(/^paused/);
        // Its running task finishes, no further one is taken.
        await expect(directionRow(page, 'G0001').locator('.research-direction__meta')).toHaveText(/^finishing: křest Marie Fíškové, Smrkov 1871/);
        // A paused row shows no limits (they stay in Edit).
        await expect(directionRow(page, 'G0001').locator('.research-direction__limit')).toHaveCount(0);
        await expect(directionRow(page, 'G0001').locator('.research-direction__meta')).not.toContainText('generations');
        expect(await launchedLinks(page)).toEqual([]);
        const toast = page.locator('.toast[data-kind="direction"]');
        await expect(toast).toContainText('Paused');
        await toast.locator('.toast-action').click();
        await expect.poll(() => directionWrites(b).length).toBe(2);
        expect(directionWrites(b)[1]).toMatchObject({ path: 'directions/G0001/state', body: { do: 'resume' } });
        await expect(directionRow(page, 'G0001').locator('.research-direction__chip')).toHaveCount(0);
    });

    test('end: the ⋯ asks first (Esc cancels, focus back), the reason goes with it', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        const more = directionRow(page, 'G0002').locator('.research-direction__more');
        await more.click();
        const menu = page.locator('#live-direction-menu');
        await expect(menu.locator('.research-direction-menu__item')).toHaveText([
            /^Edit/, /^Pause/, /^End…/, /^Move up/, /^Move to the top/, /^Work on this direction/,
        ]);
        await expect(menu.locator('[role="separator"]')).toHaveCount(2);
        await expect(menu.locator('[data-do="pause"] .research-open-mark')).toHaveCount(0);
        await expect(menu.locator('[data-do="work"] .research-open-mark')).toHaveCount(1);
        await menu.locator('[data-do="done"]').click();
        const dlg = page.locator('#research-direction-end');
        await expect(dlg).toHaveAttribute('role', 'dialog');
        await expect(dlg).toContainText('End the direction Potomci: Josef Fíšek?');
        await expect(dlg.locator('.research-direction-end__reason')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dlg).toHaveCount(0);
        await expect(more).toBeFocused();
        expect(directionWrites(b)).toEqual([]);

        await more.click();
        await menu.locator('[data-do="done"]').click();
        await dlg.locator('.research-direction-end__reason').fill('rodina vymřela');
        await page.keyboard.press('Enter');
        await expect.poll(() => directionWrites(b).map(w => [w.path, w.body]))
            .toEqual([['directions/G0002/state', { do: 'done', reason: 'rodina vymřela' }]]);
        await expect(managedNames(page)).toHaveText(['Předci: Jan Fíšek', 'Předci: Anna Svobodová']);
        await expect(overview(page).locator('.research-directions__inactive[data-ended]')).toHaveText('▸Ended · 2');
        await expect(page.locator('.toast[data-kind="direction"]')).toContainText('Ended');
    });

    test('order: Alt+↑ on the handle and a ⋯ move, one write after the series', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        const handle = directionRow(page, 'G0002').locator('.research-direction__handle');
        await expect(handle).toHaveAttribute('aria-label', 'Potomci: Josef Fíšek, 3 of 3');
        await expect(handle).toHaveAttribute('aria-roledescription', 'reorder handle');
        await handle.focus();
        // Two moves in a row: one write after them.
        await page.keyboard.press('Alt+ArrowUp');
        await page.keyboard.press('Alt+ArrowUp');
        await expect(managedNames(page)).toHaveText(['Potomci: Josef Fíšek', 'Předci: Jan Fíšek', 'Předci: Anna Svobodová']);
        await expect(directionRow(page, 'G0002').locator('.research-direction__handle')).toBeFocused();
        await expect(page.locator('#research-directions-live')).toHaveText('Potomci: Josef Fíšek, 1 of 3');
        await expect.poll(() => directionWrites(b).length).toBe(1);
        expect(directionWrites(b)[0]).toMatchObject({ path: 'directions/order', body: { order: ['G0002', 'G0001', 'G0004'] } });

        // ⋯ Move down: the last row has no Move down.
        const janMore = directionRow(page, 'G0001').locator('.research-direction__more');
        await janMore.click();
        await page.locator('#live-direction-menu [data-do="down"]').click();
        await expect(managedNames(page)).toHaveText(['Potomci: Josef Fíšek', 'Předci: Anna Svobodová', 'Předci: Jan Fíšek']);
        await expect.poll(() => directionWrites(b).length).toBe(2);
        expect(directionWrites(b)[1]).toMatchObject({ path: 'directions/order', body: { order: ['G0002', 'G0004', 'G0001'] } });
        await expect(overview(page).locator('.research-direction--managed .research-direction__num')).toHaveText(['1', '2', '3']);
        await directionRow(page, 'G0001').locator('.research-direction__more').click();
        await expect(page.locator('#live-direction-menu [data-do="down"]')).toHaveCount(0);
        await expect(page.locator('#live-direction-menu [data-do="up"]')).toHaveCount(1);
        await page.keyboard.press('Escape');
        // The second: up and down, not to the top (that is Move up); the first: neither up nor to the top.
        await directionRow(page, 'G0004').locator('.research-direction__more').click();
        await expect(page.locator('#live-direction-menu [data-do="up"], #live-direction-menu [data-do="down"], #live-direction-menu [data-do="top"]'))
            .toHaveText(['Move up', 'Move down']);
        await page.keyboard.press('Escape');
        await directionRow(page, 'G0002').locator('.research-direction__more').click();
        await expect(page.locator('#live-direction-menu [data-do="up"], #live-direction-menu [data-do="down"], #live-direction-menu [data-do="top"]'))
            .toHaveText(['Move down']);
    });

    test('a refusal at the row in the research\'s words without Try again; an Undo that fails says so in an alert toast', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        b.replies.push({ status: 500, body: {} });
        await directionRow(page, 'G0002').locator('.research-direction__head').click();
        await directionRow(page, 'G0002').locator('[data-do="pause"]').click();
        const box = directionRow(page, 'G0002').locator('.research-direction__problem');
        await expect(box).toHaveText('The change to the direction was not saved.');
        await expect(box.locator('[data-do="retry"]')).toHaveCount(0);
        b.replies.push({ status: 409, body: { error: 'directions.state', text: 'Linie má rozdělaný zápis.' } });
        await directionRow(page, 'G0002').locator('[data-do="pause"]').click();
        await expect(box).toHaveText('The change to the direction was not saved: “Linie má rozdělaný zápis.”');
        await expect(box.locator('[data-do="retry"]')).toHaveCount(0);

        // Paused, then its Undo refused: an alert toast with the research's sentence, no action; the change stays.
        await directionRow(page, 'G0002').locator('[data-do="pause"]').click();
        await expect(directionRow(page, 'G0002').locator('.research-direction__chip')).toHaveText(/^paused/);
        b.replies.push({ status: 409, body: { error: 'directions.state', text: 'Linie má rozdělaný zápis.' } });
        await page.locator('.toast[data-kind="direction"] .toast-action').click();
        const toast = page.locator('.toast[data-kind="direction"]');
        await expect(toast).toHaveText('Undo failed, the change stays. · “Linie má rozdělaný zápis.”');
        await expect(toast).toHaveAttribute('role', 'alert');
        await expect(toast.locator('.toast-action')).toHaveCount(0);
        await expect(directionRow(page, 'G0002').locator('.research-direction__chip')).toHaveText(/^paused/);
        await expect(directionRow(page, 'G0002').locator('.research-direction__problem')).toHaveCount(0);
    });

    test('a busy research: tried once more after 3 s, then a box with Try again at the row', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        b.replies.push(BUSY, BUSY);
        await directionRow(page, 'G0002').locator('.research-direction__head').click();
        await directionRow(page, 'G0002').locator('[data-do="pause"]').click();
        await expect.poll(() => directionWrites(b).length, { timeout: 8000 }).toBe(2);
        const box = directionRow(page, 'G0002').locator('.research-direction__problem');
        await expect(box).toContainText('Not saved, the research is busy.');
        await expect(box).toHaveAttribute('role', 'alert');
        await expect(page.locator('.toast[data-kind="direction"]')).toHaveCount(0);
        await box.locator('[data-do="retry"]').click();
        await expect.poll(() => directionWrites(b).length).toBe(3);
        await expect(directionRow(page, 'G0002').locator('.research-direction__problem')).toHaveCount(0);
        await expect(directionRow(page, 'G0002').locator('.research-direction__chip')).toHaveText(/^paused/);
    });

    test('an archive answer: the directions read-only from then on', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        b.replies.push({ status: 409, body: { error: 'directions.archive' } });
        await directionRow(page, 'G0002').locator('.research-direction__head').click();
        await directionRow(page, 'G0002').locator('[data-do="pause"]').click();
        const sec = overview(page).locator('.research-directions--managed');
        await expect(sec.locator('.research-directions__note').first()).toHaveText('Archive: directions are read-only.');
        await expect(sec.locator('.research-direction__more')).toHaveCount(0);
        await expect(sec.locator('.research-direction__handle:not(.is-none)')).toHaveCount(0);
        await expect(overview(page).locator('.research-directions__new')).toHaveCount(0);
        await expect(sec.locator('.research-direction--managed .research-direction__num')).toHaveText(['1', '2', '3']);
    });

    test('the bridge does not answer: the last state shown, its actions held, Show in tree works', async ({ page }) => {
        const b = await followManaged(page, { fastReconnect: true });
        await openOverview(page);
        await directionRow(page, 'G0002').locator('.research-direction__head').click();
        b.down = true;
        const sec = overview(page).locator('.research-directions--managed');
        await expect(sec.locator('.research-directions__note.is-warn'))
            .toHaveText('The research is not running. Directions can be changed once it runs.', { timeout: 10000 });
        await expect(managedNames(page)).toHaveText(['Předci: Jan Fíšek', 'Předci: Anna Svobodová', 'Potomci: Josef Fíšek']);
        await expect(overview(page).locator('.research-directions__new')).toHaveAttribute('aria-disabled', 'true');
        const more = directionRow(page, 'G0002').locator('.research-direction__more');
        await expect(more).toHaveAttribute('aria-disabled', 'true');
        await more.click({ force: true });
        await expect(page.locator('#live-direction-menu')).toHaveCount(0);
        const pause = directionRow(page, 'G0002').locator('[data-do="pause"]');
        await expect(pause).toHaveAttribute('aria-disabled', 'true');
        await pause.click({ force: true });
        // No handle while nothing can be written; the numbers stay.
        await expect(sec.locator('.research-direction__handle:not(.is-none)')).toHaveCount(0);
        await expect(sec.locator('.research-direction--managed .research-direction__num')).toHaveText(['1', '2', '3']);
        await expect(directionRow(page, 'G0002').locator('[data-do="show"]')).not.toHaveAttribute('aria-disabled', 'true');
        expect(directionWrites(b)).toEqual([]);
    });

    test('no directions: the empty state with + New direction, no work outside them', async ({ page }) => {
        await followManaged(page, { researches: [], working: [{ who: 'agent-scitani', since: new Date().toISOString(), task: 'Sčítání 1921', person: 'P0050' }] });
        await openOverview(page);
        const empty = overview(page).locator('.research-directions__empty');
        await expect(empty).toContainText('No directions.');
        // No count in the title with no directions.
        await expect(overview(page).locator('.live-section__title', { hasText: /^Directions/ })).toHaveText('Directions');
        await expect(empty.locator('[data-do="new"]')).toHaveText('+ New direction');
        await expect(overview(page).locator('.research-direction--outside')).toHaveCount(0);
    });

    test('an older research: the section as before, the terminal for its actions, a footer naming the version', async ({ page }) => {
        const b = await followManaged(page, { caps: null });
        await openOverview(page);
        const sec = overview(page).locator('.research-directions');
        await expect(sec).toHaveCount(1);
        await expect(sec.locator('.research-direction__num')).toHaveCount(0);
        await expect(sec.locator('.research-direction__handle')).toHaveCount(0);
        await expect(overview(page).locator('.research-directions__new')).toHaveCount(0);
        await expect(sec.locator('.research-directions__foot')).toHaveText('The research manages directions from the app from version 1.26.0.');
        await directionRow(page, 'G0001').locator('.research-direction__more').click();
        const pause = page.locator('#live-direction-menu [data-do="pause"]');
        await expect(pause.locator('.research-open-mark')).toHaveCount(1);
        await pause.click();
        expect(await launchedLinks(page)).toEqual([`strom-research://direction?tree=${UUID}&id=G0001&do=pause`]);
        expect(directionWrites(b)).toEqual([]);
    });
});
