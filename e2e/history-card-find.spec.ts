import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistoryR1, historyGed, openResearch, poll,
    HISTORY_R1_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * "Find the history of {region}" in the person card's timeline (work 1028 §5):
 * the last row offers the region of the person's places the research has not
 * searched yet (most facts first), `POST /history/first` from the card and
 * each answer in that row; a phone's one line; without `history.first`
 * nothing. Invented data (fakeHistoryR1): Jan lived in Čapkov 1860–1910;
 * Čapkov is still being looked at, so the row replaces "still looking".
 * The main suite runs without `history.place` (the region alone); with it the
 * place's own row follows the region's (both offers, BACKLOG 29 Oct).
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];
const REGION_ONLY = HISTORY_R1_FEATURES.filter(f => f !== 'history.place');
const STILL_LOOKING = "For some of this person's places the research is still looking.";

/** Bohemia not searched yet (and with `many` the Austrian Empire too). */
function unsearched(o: { many?: boolean; pace?: FakeHistory['pace'] } = {}): FakeHistory {
    const h = fakeHistoryR1(o.pace ? { pace: o.pace } : {});
    const regions = h.payload.regions!;
    regions['cz-bohemia'].state = 'queued';
    if (o.many) regions['at-empire'].state = 'queued';
    h.payload.places['Čapkov'].state = 'pending';
    return h;
}

async function setup(page: Page, opts: { history?: FakeHistory; features?: string[]; width?: number; height?: number } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = opts.history ?? unsearched();
    const ged = historyGed();
    const bridge = await fakeBridge(page, { features: opts.features ?? REGION_ONLY, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await poll(page);
    await expect.poll(() => history.reads).toBeGreaterThan(0);
    return { bridge, history };
}

const idOf = (page: Page, first: string) => page.evaluate((first) =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);

async function openCard(page: Page, first: string): Promise<void> {
    const id = await idOf(page, first);
    await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
    await expect(page.locator('#pm-lifeline-section')).toBeVisible();
}

const lastRow = (page: Page) => page.locator('#pm-lifeline-body .pm-lifeline-row.k-historyState');
const findLink = (page: Page) => lastRow(page).locator('button.pm-lifeline-hfind');
const regionRow = (page: Page) => page.locator('#pm-lifeline-body .pm-lifeline-row.k-historyState:not([data-place-row])');
const placeRow = (page: Page) => page.locator('#pm-lifeline-body .pm-lifeline-row[data-place-row]');
const PLACE_OFFER = 'The research has not looked for the history of Čapkov and surroundings yet. Find local history…';
/** On a phone: the row's sentence and its link on one line, inside the row. */
const oneLine = (row: ReturnType<Page['locator']>) => row.locator('.pm-lifeline-desc').evaluate(el => {
    const link = el.querySelector('button')!.getBoundingClientRect();
    const text = el.querySelector('.pm-lifeline-hfind-text')!.getBoundingClientRect();
    return Math.abs(link.top - text.top) < 12 && link.right <= el.getBoundingClientRect().right + 1;
});
const refuse = (status: number, code: string, text: string) => ({ status, body: { error: text, code, text } });

test.describe('History of places: "Find the history of …" in the card', () => {
    test('one region: the sentence with its link; the click asks first, the row says when', { tag: '@smoke' }, async ({ page }) => {
        const { history } = await setup(page, { history: unsearched({ pace: 'rare' }) });
        await openCard(page, 'Jan');
        await expect(lastRow(page)).toHaveText('The research has not looked for the history of Bohemia yet. Find the history of Bohemia');
        await expect(lastRow(page)).toHaveCount(1);
        await findLink(page).click();
        await expect.poll(() => history.writes.first).toEqual([{ region: 'cz-bohemia' }]);
        await expect(lastRow(page)).toHaveText('The history of Bohemia comes first of the regions, at the next history session '
            + '(about every 10th research session). It can be started right away in the research.');
        await expect(findLink(page)).toHaveCount(0);
        // Read again: the region is first, the card says so on its own.
        await expect.poll(() => history.reads).toBeGreaterThan(1);
        await page.evaluate(() => window.Strom.UI.forceCloseModal());
        await openCard(page, 'Jan');
        await expect(lastRow(page)).toContainText('The history of Bohemia comes first of the regions');
    });

    test('several regions: the two names, the link for the first one, "More in the manager ›" opens Regions', async ({ page }) => {
        await setup(page, { history: unsearched({ many: true }) });
        await openCard(page, 'Jan');
        // Two facts in each; the tie goes to the research's order (Bohemia has one, the Empire none).
        await expect(lastRow(page)).toHaveText('The research has not looked for the history of Bohemia and Austrian Empire yet. '
            + 'Find the history of Bohemia · More in the manager ›');
        await lastRow(page).locator('button.pm-lifeline-hfind-more').click();
        await expect(page.locator('#history-modal')).toBeVisible();
        await expect(page.locator('#hm-tab-regions')).toHaveAttribute('aria-selected', 'true');
    });

    test('the research not looking: the sentence with the link to switch it on', async ({ page }) => {
        const { history } = await setup(page);
        history.writeReply = { first: refuse(409, 'history.off', 'History search is off.') };
        await openCard(page, 'Jan');
        await findLink(page).click();
        await expect(lastRow(page)).toContainText('The research is not looking for history. Events already found stay.');
        await expect(lastRow(page).locator('button.pm-lifeline-hfind-note')).toHaveText('Turn on the search in the research, opens in the research');
    });

    test('busy: the row says so', async ({ page }) => {
        const { history } = await setup(page);
        history.writeReply = { first: refuse(503, 'research.busy', 'Busy.') };
        await openCard(page, 'Jan');
        await findLink(page).click();
        await expect(lastRow(page)).toHaveText('The research is busy. It will work again shortly.');
    });

    test('done meanwhile: the offer goes to the next region; an archive says why', async ({ page }) => {
        const { history } = await setup(page, { history: unsearched({ many: true }) });
        await openCard(page, 'Jan');
        history.writeReply = { first: refuse(409, 'history.done', 'The region is done.') };
        await findLink(page).click();
        await expect(lastRow(page)).toHaveText('The research has not looked for the history of Austrian Empire yet. Find the history of Austrian Empire');
        history.writeReply = { first: refuse(409, 'history.archive', 'its archive is held by another tree') };
        await findLink(page).click();
        await expect(lastRow(page)).toHaveText('The research does not search here: its archive is held by another tree.');
        expect(history.writes.first).toEqual([{ region: 'cz-bohemia' }, { region: 'at-empire' }]);
    });

    test('phone (390 px): one line, the sentence cut short and the link whole', async ({ page }) => {
        await setup(page, { width: 390 });
        await openCard(page, 'Jan');
        const row = lastRow(page);
        await expect(row).toHaveClass(/is-find-one/);
        await expect(row.locator('.pm-lifeline-hfind-text')).toHaveText('Bohemia not searched yet.');
        await expect(findLink(page)).toHaveText('Find first');
        expect(await oneLine(row)).toBe(true);
    });

    test('without history.first the row says "still looking" and offers no region; the main place is offered (K7.1a)', async ({ page }) => {
        await setup(page, { features: HISTORY_R1_FEATURES.filter(f => f !== 'history.first') });
        await openCard(page, 'Jan');
        await expect(lastRow(page)).toHaveText([STILL_LOOKING,
            'The research has not looked for the history of Čapkov and surroundings yet. Find local history…']);
        await expect(lastRow(page).locator('button[data-find]')).toHaveCount(0);
    });
});

/** Both offers (BACKLOG 29 Oct): the region's row and, after it, the main place's own row — each says which it is. */
test.describe('History of places: the region and the place both offered in the card', () => {
    test('two rows: the region\'s and the place\'s, each with its own link; the region asked first, the place is still offered', async ({ page }) => {
        const { history } = await setup(page, { features: HISTORY_R1_FEATURES });
        await openCard(page, 'Jan');
        await expect(lastRow(page)).toHaveText([
            'The research has not looked for the history of Bohemia yet. Find the history of Bohemia',
            PLACE_OFFER,
        ]);
        await expect(placeRow(page)).toHaveAttribute('data-place-row', 'offer');
        await regionRow(page).locator('button[data-find]').click();
        await expect.poll(() => history.writes.first).toEqual([{ region: 'cz-bohemia' }]);
        await expect(regionRow(page)).toContainText('The history of Bohemia comes first of the regions');
        await expect(placeRow(page)).toHaveText(PLACE_OFFER);
        // The place's link still leads to its confirmation, as when it is alone.
        await placeRow(page).locator('button[data-place-find]').click();
        await expect(page.locator('#history-place-modal')).toBeVisible();
        expect(history.writes.place).toEqual([]);
    });

    test('the place searched meanwhile: the region is offered beside the place\'s state', async ({ page }) => {
        const h = unsearched();
        h.payload.places['Čapkov'].history = 'running';
        await setup(page, { history: h, features: HISTORY_R1_FEATURES });
        await openCard(page, 'Jan');
        await expect(lastRow(page)).toHaveText([
            'The research has not looked for the history of Bohemia yet. Find the history of Bohemia',
            'The research is looking for the history of Čapkov and surroundings right now.',
        ]);
    });

    test('phone (390 px): two lines, "Region Bohemia" and "Čapkov and surroundings", each with its link whole', async ({ page }) => {
        await setup(page, { width: 390, features: HISTORY_R1_FEATURES });
        await openCard(page, 'Jan');
        await expect(regionRow(page).locator('.pm-lifeline-hfind-text')).toHaveText('Region Bohemia not searched yet.');
        await expect(regionRow(page).locator('button[data-find]')).toHaveText('Find first');
        await expect(placeRow(page)).toHaveText('Čapkov and surroundings: Find history…');
        expect(await oneLine(regionRow(page))).toBe(true);
        expect(await oneLine(placeRow(page))).toBe(true);
    });
});
