import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeCensus, fakeHistoryR1, historyGed, openResearch, poll, HISTORY_R1_FEATURES, FakeBridge, FakeCensus,
} from './research-bridge.js';
import { followManaged, openOverview, overview, ManagedBridge } from './live-directions-bridge';
import { cardAction, personModal } from './helpers.js';

/**
 * Census records (spec 106 U6, K1.1, K1.4, K3.4): Research for this tree →
 * Sources, "Census records" — only with the research's `census`; the switch
 * follows `/status.census`, the tasks set aside said under it while off; on
 * and off through `POST /census` at once (dashed while on its way, no mark);
 * a refusal says why under the row, the switch as the research says; without
 * the bridge the switch rests. The queue's kind "Census" and "Other" asking
 * `known=census` only of a research with the feature. A household from the
 * research's file (two copies of a census with one `_STROM_SHARE`): the
 * "with …" line in the person's events and life timeline, the one mark on the
 * Timeline view beside its history row. A fake bridge with invented data.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const CENSUS = ['census', 'seal.foreign', 'disk.full'];

async function setup(page: Page, census: FakeCensus, features: string[] = CENSUS): Promise<FakeBridge> {
    await page.clock.setFixedTime(new Date('2026-11-20T10:30:00Z'));
    const bridge = await fakeBridge(page, { features, census, links: LINKS });
    await openResearch(page);
    await poll(page);
    return bridge;
}

async function openTreeSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
    await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
}

const section = (page: Page) => page.locator('#research-tree-settings-modal .research-census');
const toggle = (page: Page) => page.locator('#research-census-on');
const note = (page: Page) => page.locator('#research-census-note');

test.describe('Census records: Research for this tree', () => {
    test('off with 3 tasks set aside: the sentence; on goes at once, dashed while on its way, confirmed by the status; no mark', { tag: '@smoke' }, async ({ page }) => {
        const census = fakeCensus(false, 3);
        await setup(page, census);
        let release!: () => void;
        const held = new Promise<void>(r => { release = r; });
        const write = (u: URL) => /\/census$/.test(u.pathname);
        await page.route(write, async route => { if (route.request().method() === 'POST') await held; await route.fallback(); });
        await openTreeSettings(page);
        await expect(section(page).locator('legend')).toHaveText('Sources');
        await expect(section(page).locator('.settings-name')).toHaveText('Census records');
        await expect(section(page).locator('.settings-desc')).toHaveText('The research may use census records as a source: a household in one year shows who lived together and where each person came from. Most archives only display census records, so the sheets are mostly supplied by hand as screenshots.');
        await expect(toggle(page)).not.toBeChecked();
        await expect(note(page)).toHaveText('Set aside: 3 census tasks. They come back when this is switched on.');
        // Through the bridge, no terminal: no AI badge, no terminal mark, no link.
        await expect(section(page).locator('.research-ai-badge, .research-open-mark, svg, button, a')).toHaveCount(0);
        // Under Stories, before the hypotheses.
        const order = await page.locator('#research-tree-settings-modal [id$="-host"]').evaluateAll(els => els.map(e => e.id));
        expect(order.indexOf('research-census-host')).toBe(order.indexOf('research-stories-host') + 1);

        await section(page).locator('label').click();
        await expect(toggle(page)).toBeChecked();
        await expect(section(page).locator('label[data-pend="1"]')).toHaveCount(1);
        await expect(section(page).locator('.pend-st')).toHaveText('Saving…');
        await expect(note(page)).toHaveCount(0);
        // Locked while on its way: a second click writes nothing.
        await toggle(page).dispatchEvent('click');
        await expect(toggle(page)).toBeChecked();
        release();
        await expect.poll(() => census.posts).toEqual([{ on: true }]);
        await expect(section(page).locator('[data-pend]')).toHaveCount(0);
        await expect(toggle(page)).toBeChecked();
        await poll(page);
        await expect(toggle(page)).toBeChecked();
        await expect(toggle(page)).toBeEnabled();
        await expect(note(page)).toHaveCount(0);
        await page.unroute(write);
    });

    test('on: off at once, the tasks it set aside said under the row', async ({ page }) => {
        const census = fakeCensus(true, 1);
        await setup(page, census);
        await openTreeSettings(page);
        await expect(toggle(page)).toBeChecked();
        await expect(note(page)).toHaveCount(0);
        await section(page).locator('label').click();
        await expect.poll(() => census.posts).toEqual([{ on: false }]);
        await expect(toggle(page)).not.toBeChecked();
        await expect(note(page)).toHaveText('Set aside: 1 census task. It comes back when this is switched on.');
        await poll(page);
        await expect(note(page)).toHaveText('Set aside: 1 census task. It comes back when this is switched on.');
    });

    test('a state not said validly: the row off without a sentence of tasks', async ({ page }) => {
        const census = fakeCensus(false, 2);
        census.census = { on: false, held: 'many' };
        await setup(page, census);
        await openTreeSettings(page);
        await expect(toggle(page)).not.toBeChecked();
        await expect(note(page)).toHaveCount(0);
    });

    test('busy (503): the sentence under the row, the switch as it was', async ({ page }) => {
        const census = fakeCensus(false, 3);
        census.replies.push({ status: 503, body: { error: 'Busy.', code: 'research.busy' } });
        await setup(page, census);
        await openTreeSettings(page);
        await section(page).locator('label').click();
        await expect(note(page)).toHaveText('The research is busy. It will work again shortly.');
        await expect(toggle(page)).not.toBeChecked();
        expect(census.posts).toEqual([{ on: true }]);
    });

    test('sealed on another computer (409 seal.foreign): the app\'s sentence under the row, the switch as it was', async ({ page }) => {
        const census = fakeCensus(true);
        census.replies.push({ status: 409, body: { error: 'The tree is sealed on another computer.', code: 'seal.foreign' } });
        await setup(page, census);
        await openTreeSettings(page);
        await section(page).locator('label').click();
        await expect(note(page)).toContainText('The tree is sealed on another computer.');
        await expect(note(page)).toContainText('The changes made here wait unsent in this browser.');
        await expect(toggle(page)).toBeChecked();
    });

    test('written by a newer tree (423): the books\' sentence; an archive (409 census.archive): the row goes', async ({ page }) => {
        const census = fakeCensus(false);
        census.replies.push({ status: 423, body: { error: 'Locked.', code: 'locked' } });
        census.replies.push({ status: 409, body: { error: 'An archive.', code: 'census.archive' } });
        await setup(page, census);
        await openTreeSettings(page);
        await section(page).locator('label').click();
        await expect(note(page)).toHaveText('Not recorded: another session holds the tree in the research.');
        await expect(toggle(page)).not.toBeChecked();
        await section(page).locator('label').click();
        await expect.poll(() => census.posts.length).toBe(2);
        await expect(section(page)).toHaveCount(0);
    });

    test('without the bridge the switch rests with the sentence', async ({ page }) => {
        const bridge = await setup(page, fakeCensus(false, 3));
        bridge.down = true;
        await poll(page);
        await openTreeSettings(page);
        await expect(toggle(page)).toBeDisabled();
        await expect(note(page)).toHaveText("The research isn't running. This can be changed once it runs.");
    });

    test('an older research without census: no row, even with the key in its status', async ({ page }) => {
        await setup(page, fakeCensus(false, 3), ['seal.foreign']);
        await openTreeSettings(page);
        await expect(page.locator('#research-tree-settings-modal .research-tree-settings')).toBeVisible();
        await expect(section(page)).toHaveCount(0);
        await expect(page.locator('#research-census-host')).toBeEmpty();
    });
});

/** The queue by kind (spec 065 K7.4) with census tasks (spec 106 §2.4): two registers, two census, one other. */
const QUEUE_BASE = ['directions.edit', 'directions.order', 'queue.page', 'queue.search', 'queue.kind'];

function queue(census: boolean): Record<string, unknown>[] {
    return [
        { id: 'T0701', text: 'Matriky Smrkov 1871', state: 'next', research: 'G0001', taskKind: 'records' },
        ...(census ? [
            { id: 'T0702', text: 'Sčítání lidu 1890, Smrkov čp. 14', state: 'next', research: 'G0001', taskKind: 'census' },
            { id: 'T0703', text: 'Sčítání lidu 1900, Smrkov čp. 14', state: 'next', research: 'G0001', taskKind: 'census' },
        ] : []),
        { id: 'T0704', text: 'Matriky Smrkov 1875', state: 'next', research: 'G0001', taskKind: 'records' },
        { id: 'T0705', text: 'Dopis na obecní úřad', state: 'next', research: 'G0001', taskKind: 'other' },
    ];
}

const kinds = (page: Page) => overview(page).locator('.research-overview__queue-kinds');
const kindChip = (page: Page, kind: string) => kinds(page).locator(`[data-task-kind="${kind}"]`);
const nextRows = (page: Page) => overview(page).locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]:not(.live-queue-row--parked)');
const kindReads = (b: ManagedBridge) => b.queueReads.filter(q => q.includes('kind='));

async function openQueue(page: Page): Promise<void> {
    await openOverview(page);
    const head = overview(page).locator('.live-section__head[aria-controls="ov-sec-queue"]');
    await expect(head).toBeVisible();
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
}

test.describe('Census records in the queue', () => {
    test('with census: the chip "Census" after Registers; it asks kind=census; "Other" asks known=census and leaves census out', async ({ page }) => {
        const b = await followManaged(page, { features: [...QUEUE_BASE, 'census'], queue: queue(true), paged: true });
        await openQueue(page);
        await expect(kinds(page).locator('.research-overview__filter')).toHaveText(['Registers 2', 'Census 2', 'Other 1']);
        await kindChip(page, 'census').click();
        await expect.poll(() => kindReads(b)).toEqual(['count=50&kind=census']);
        await expect(nextRows(page)).toHaveCount(2);
        await expect(nextRows(page).first()).toContainText('Sčítání lidu 1890');
        await kindChip(page, 'other').click();
        await expect.poll(() => kindReads(b).at(-1)).toBe('count=50&kind=other&known=census');
        await expect(nextRows(page)).toHaveCount(1);
        await expect(nextRows(page).first()).toContainText('Dopis na obecní úřad');
    });

    test('an older research without census: no census chip, "Other" asks without known, nothing refused', async ({ page }) => {
        const b = await followManaged(page, { features: QUEUE_BASE, queue: queue(false), paged: true });
        await openQueue(page);
        await expect(kinds(page).locator('.research-overview__filter')).toHaveText(['Registers 2', 'Other 1']);
        await kindChip(page, 'other').click();
        await expect.poll(() => kindReads(b)).toEqual(['count=50&kind=other']);
        await expect(nextRows(page)).toHaveCount(1);
        expect(b.queueReads.some(q => q.includes('census') || q.includes('known'))).toBe(false);
    });
});

/**
 * A household of the census of 1857 as the research writes it (§2.3): Josef (the head) and Anna (his wife),
 * one copy each with the same `_STROM_SHARE`, own age and role, the same note and place.
 */
function householdGed(): string {
    const copy = (age: string, role: string) => ['1 CENS', '2 DATE 31 OCT 1857', '2 PLAC Čapkov', '2 ADDR čp. 14', `2 AGE ${age}`,
        '2 NOTE V domácnosti dále: čeledín, 19 let.', '2 _STROM_SHARE k7Qm2Rx9', `3 _ROLE ${role}`].join('\n');
    return historyGed()
        .replace('1 NAME Josef /Fíšek/', `1 NAME Josef /Fíšek/\n1 BIRT\n2 DATE 1830\n2 PLAC Čapkov\n1 DEAT\n2 DATE 1869\n2 PLAC Čapkov\n${copy('27y', 'hlava domácnosti')}`)
        .replace('1 NAME Anna /Svobodová/', `1 NAME Anna /Svobodová/\n1 BIRT\n2 DATE 1835\n2 PLAC Čapkov\n${copy('22y', 'manželka')}`);
}

async function household(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-11-20T10:30:00Z'));
    const history = fakeHistoryR1();
    const ged = householdGed();
    await fakeBridge(page, { features: [...HISTORY_R1_FEATURES, 'event.share', 'census'], history, treeGed: ged, links: LINKS, census: fakeCensus(true) });
    await openResearch(page, { ged });
    await poll(page);
    await expect.poll(() => history.reads).toBeGreaterThan(0);
}

test.describe('Census records: a household from the research', () => {
    test('one shared event: "with Anna" under Census in Josef\'s events and life timeline, "with Josef" in hers; no finding of copies that differ', async ({ page }) => {
        await household(page);
        const copies = await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as unknown as
            { firstName: string; events?: { type: string; shareId?: string; shareRole?: string; age?: string; note?: string }[] }[])
            .flatMap(p => (p.events ?? []).filter(e => e.type === 'census').map(e => ({ who: p.firstName, shareId: e.shareId, role: e.shareRole, age: e.age, note: e.note }))));
        expect(copies).toHaveLength(2);
        expect(new Set(copies.map(c => c.shareId))).toEqual(new Set(['k7Qm2Rx9']));
        expect(copies.map(c => c.note)).toEqual(['V domácnosti dále: čeledín, 19 let.', 'V domácnosti dále: čeledín, 19 let.']);

        await cardAction(page, 'Josef', 'edit');
        const modal = personModal(page);
        const line = modal.locator('#events-list .event-row', { hasText: 'Census' }).locator('.shared-line');
        await expect(line).toHaveText('with Anna');
        await expect(page.locator('#pm-lifeline-body .shared-line').first()).toHaveText('with Anna');
        await line.getByRole('button', { name: 'Anna' }).click();
        await expect(modal.locator('#pm-name')).toContainText('Anna Svobodová');
        const hers = modal.locator('#events-list .event-row', { hasText: 'Census' }).locator('.shared-line');
        await expect(hers).toHaveText('with Josef');
        // Her copy's editor: shared with Josef, no amber bar of copies that differ.
        await hers.locator('.shared-line-text').click({ position: { x: 4, y: 6 } });
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await expect(editor.locator('.sw-row')).toHaveCount(1);
        await expect(editor.locator('.sw-row').first()).toContainText('Josef');
        await expect(editor.locator('.sw-row--warn')).toHaveCount(0);
        await expect(editor.locator('#event-shared-diff')).toBeHidden();
    });

    test('the Timeline view: the census one mark across Josef\'s and Anna\'s rows, the history row still there', async ({ page }) => {
        await household(page);
        await page.evaluate(async () => {
            const p = (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(x => x.firstName === 'Jan')!;
            await window.Strom.TreeRenderer.setFocus(p.id as never);
            window.Strom.UI.setDisplayViewMode('timeline');
        });
        await expect(page.locator('#timeline-container .timeline-bar').first()).toBeVisible();
        const mark = page.locator('#timeline-container g.tl-shared[data-share="k7Qm2Rx9"]');
        await expect(mark).toHaveCount(1);
        await expect(mark.locator('title')).toHaveText('Census 1857: Josef Fíšek, Anna Svobodová');
        await expect(page.locator('#timeline-container .tl-hist-row')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
});
