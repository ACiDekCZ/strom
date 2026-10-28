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
 * nothing. Invented data (fakeHistoryR1): Jan lived in Čáslav 1860–1910;
 * Čáslav is still being looked at, so the row replaces "still looking".
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];
const STILL_LOOKING = "For some of this person's places the research is still looking.";

/** Bohemia not searched yet (and with `many` the Austrian Empire too). */
function unsearched(o: { many?: boolean; pace?: FakeHistory['pace'] } = {}): FakeHistory {
    const h = fakeHistoryR1(o.pace ? { pace: o.pace } : {});
    const regions = h.payload.regions!;
    regions['cz-bohemia'].state = 'queued';
    if (o.many) regions['at-empire'].state = 'queued';
    h.payload.places['Čáslav'].state = 'pending';
    return h;
}

async function setup(page: Page, opts: { history?: FakeHistory; features?: string[]; width?: number; height?: number } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = opts.history ?? unsearched();
    const ged = historyGed();
    const bridge = await fakeBridge(page, { features: opts.features ?? HISTORY_R1_FEATURES, history, treeGed: ged, links: LINKS });
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
        await expect(lastRow(page).locator('button.pm-lifeline-hfind-note')).toHaveText('Turn on the search in the research');
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
        const one = await row.locator('.pm-lifeline-desc').evaluate(el => {
            const link = el.querySelector('button')!.getBoundingClientRect();
            const text = el.querySelector('.pm-lifeline-hfind-text')!.getBoundingClientRect();
            return Math.abs(link.top - text.top) < 12 && link.right <= el.getBoundingClientRect().right + 1;
        });
        expect(one).toBe(true);
    });

    test('without history.first the row says "still looking" and offers nothing', async ({ page }) => {
        await setup(page, { features: HISTORY_R1_FEATURES.filter(f => f !== 'history.first') });
        await openCard(page, 'Jan');
        await expect(lastRow(page)).toHaveText(STILL_LOOKING);
        await expect(findLink(page)).toHaveCount(0);
    });
});
