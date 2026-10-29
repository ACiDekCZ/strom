import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistoryR1, historyGed, openResearch, poll, links, touchScreenNow,
    HISTORY_R1_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * A place's own history on request (work 1028 §6a, research answer R6): the
 * card's third kind (▲ with "{place} and surroundings"), the card's last row
 * offering the person's main place, the confirmation with the estimate before
 * anything is spent (the research's terminal decides: `403 history.link`, the
 * link opened), the place's states in the card and in Places, the research's
 * suggestions, the place's detail with "Search again in the research", and the
 * gates (`history.place`, a place with its record id, `history.place.direct`).
 * Invented data (fakeHistoryR1): Jan lived in Čapkov (L0001) 1860–1910.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];
const OFFER = 'The research has not looked for the history of Čapkov and surroundings yet. Find local history…';
const TITLE = 'Find the history of Čapkov and surroundings?';
const COST_NONE = "One research session. Uses the subscription of the research's AI agent.";
const TERMINAL = "The research's terminal window completes the confirmation. All trees on this computer will see the result.";
const LINK_L0001 = /^strom-research:\/\/history\?tree=.+&place=L0001&do=search$/;

/** Čapkov's own history done: one event of the place (▲) besides the regional ones. */
function placeDone(): FakeHistory {
    const h = fakeHistoryR1();
    (h.payload.events as Record<string, unknown>[]).push({
        id: 'E5', from: 1885, kind: 'economy', scope: 'place',
        place: { key: 'Čapkov', id: 'L0001', name: { cs: 'Čapkov', en: 'Čapkov' } },
        text: { cs: 'Otevřen cukrovar u Čapkovi.', en: 'A sugar factory opened near Čapkov.' },
        source: { title: 'Invented town chronicle', url: 'https://example.org/caslav-1885', checked: '2026-10-01' },
    });
    const caslav = h.payload.places['Čapkov'];
    caslav.events = [...(caslav.events as string[]), 'E5'];
    caslav.history = 'done';
    caslav.at = '2026-10-26T10:00:00Z';
    caslav.area = { cs: 'Čapkovsko', en: 'the Čapkov district' };
    return h;
}

async function setup(page: Page, opts: { history?: FakeHistory; features?: string[]; width?: number; height?: number } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = opts.history ?? fakeHistoryR1();
    const ged = historyGed();
    const bridge = await fakeBridge(page, { features: opts.features ?? HISTORY_R1_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await poll(page);
    await expect.poll(() => history.reads).toBeGreaterThan(0);
    return { bridge, history };
}

/** The research changed its answer: read again. */
async function changed(page: Page, history: FakeHistory, change: (h: FakeHistory) => void): Promise<void> {
    const reads = history.reads;
    change(history);
    history.rev = `h${Number(history.rev.replace(/\D/g, '')) + 1}`;
    history.payload.state.rev = history.rev;
    await poll(page);
    await expect.poll(() => history.reads).toBeGreaterThan(reads);
}

const idOf = (page: Page, first: string) => page.evaluate((first) =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);

async function openCard(page: Page, first = 'Jan'): Promise<void> {
    await page.evaluate(() => window.Strom.UI.forceCloseModal());
    const id = await idOf(page, first);
    await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
    await expect(page.locator('#pm-lifeline-section')).toBeVisible();
}

async function openManager(page: Page, opts: { tab?: string } = {}): Promise<void> {
    await page.evaluate((o) => (window.Strom.UI as unknown as { openHistoryManage(o: object): void }).openHistoryManage(o), opts);
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('#history-manage-state .hm-state-text')).not.toHaveText('Loading history…');
}

const placeRow = (page: Page) => page.locator('#pm-lifeline-body .pm-lifeline-row[data-place-row]');
const offerLink = (page: Page) => placeRow(page).locator('button[data-place-find]');
const dialog = (page: Page) => page.locator('#history-place-modal');
const modal = (page: Page) => page.locator('#history-modal');
const allPlace = (page: Page, key: string) => modal(page).locator(`.hm-group[data-group="all"] .hm-place[data-place="${key}"]`);
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });

test.describe('History of places: a place\'s own history on request (§6a)', () => {
    test('the card offers the main place; the confirmation says the cost; Continue opens the research\'s terminal', { tag: '@smoke' }, async ({ page }) => {
        const { history } = await setup(page);
        await openCard(page);
        await expect(placeRow(page)).toHaveText(OFFER);
        await expect(placeRow(page)).toHaveAttribute('data-place-row', 'offer');
        await offerLink(page).click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('#hpf-title')).toHaveText(TITLE);
        await expect(dialog(page).locator('.hpf-area strong')).toHaveText('Surroundings: suggested by the research');
        await expect(dialog(page).locator('#hpf-cost')).toHaveText(COST_NONE);
        await expect(dialog(page).locator('.hpf-mode')).toHaveText(TERMINAL);
        await expect(dialog(page).locator('.hpf-foot button')).toHaveText(['Cancel', 'Continue in the research']);
        // Nothing starts without a click: Cancel has the focus.
        await expect(dialog(page).locator('.hpf-foot [data-hpf="cancel"]')).toBeFocused();
        expect(history.writes.place).toEqual([]);
        await dialog(page).locator('[data-hpf="go"]').click();
        await expect.poll(() => history.writes.place).toEqual([{ place: 'L0001' }]);
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(async () => (await links(page)).at(-1)).toMatch(LINK_L0001);
        await expect(toast(page, 'Opening the research…')).toBeVisible();
    });

    test('the estimate: minutes, minutes with USD; the research\'s surroundings; Enter and Escape cancel', async ({ page }) => {
        const history = fakeHistoryR1({ placeEstimate: { minutes: [20, 40] } });
        history.payload.places['Čapkov'].area = { cs: 'Čapkovsko', en: 'the Čapkov district' };
        await setup(page, { history });
        await openCard(page);
        await offerLink(page).click();
        await expect(dialog(page).locator('.hpf-area strong')).toHaveText('Surroundings: the Čapkov district');
        await expect(dialog(page).locator('#hpf-cost'))
            .toHaveText("One research session, about 20–40 minutes. Uses the subscription of the research's AI agent.");
        await page.keyboard.press('Enter');
        await expect(dialog(page)).toHaveCount(0);
        await expect(offerLink(page)).toBeFocused();
        history.placeEstimate = { minutes: [20, 40], usd: [1, 3] };
        await poll(page);
        await offerLink(page).click();
        await expect(dialog(page).locator('#hpf-cost'))
            .toHaveText("One research session, about 20–40 minutes, about 1–3 USD of the research's AI agent subscription.");
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('#pm-lifeline-section')).toBeVisible();
        expect(history.writes.place).toEqual([]);
    });

    test('a refusal stays in the confirmation: the research not searching, with the way to switch it on', async ({ page }) => {
        const history = fakeHistoryR1();
        history.writeReply = { place: { status: 409, body: { error: 'off', code: 'history.off', text: 'The research does not look for history.',
            link: 'strom-research://experiment?tree=x&name=history&do=on' } } };
        await setup(page, { history });
        await openCard(page);
        await offerLink(page).click();
        await dialog(page).locator('[data-hpf="go"]').click();
        await expect(dialog(page).locator('.hpf-note')).toHaveText('The research is not looking for history. Events already found stay. Turn on the search in the research');
        await dialog(page).locator('[data-hpf="noteLink"]').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(async () => (await links(page)).at(-1)).toContain('name=history&do=on');
    });

    test('the place\'s states in the card and in Places (M5)', async ({ page }) => {
        const { history } = await setup(page);
        const cases: [string, string, string][] = [
            ['first', 'The history of Čapkov and surroundings comes first, at the next research session.', 'Local history: first'],
            ['running', 'The research is looking for the history of Čapkov and surroundings right now.', 'Local history: searching'],
            ['empty', 'For Čapkov and surroundings the research found no documented event.', 'Local history: nothing documented'],
            ['waiting', 'The research is not looking for events now: no agent on this computer.', 'Local history: waiting'],
        ];
        for (const [state, card, places] of cases) {
            await changed(page, history, h => {
                h.payload.places['Čapkov'].history = state;
                if (state === 'waiting') h.payload.places['Čapkov'].why = 'no agent on this computer';
            });
            await openCard(page);
            await expect(placeRow(page)).toHaveText(card);
            await expect(offerLink(page)).toHaveCount(0);
            await openManager(page, { tab: 'places' });
            await expect(allPlace(page, 'Čapkov').locator('.hm-p-state')).toHaveText(places);
        }
    });

    test('done: ▲ events with "Čapkov and surroundings" and no row; Without region and the detail with Search again', async ({ page }) => {
        const { history } = await setup(page, { history: placeDone() });
        await openCard(page);
        const ev = page.locator('#pm-lifeline-body .pm-lifeline-row', { hasText: 'A sugar factory opened near Čapkov.' });
        await expect(ev).toHaveClass(/is-place/);
        await expect(ev.locator('.pm-lifeline-hplace-name')).toHaveText('Čapkov and surroundings');
        await expect(placeRow(page)).toHaveCount(0);
        await page.locator('.pm-lifeline-hinfo').click();
        await expect(page.locator('.pm-lifeline-legend .pm-lifeline-legend-row .pm-lifeline-legend-mark.is-place')).toHaveCount(1);
        await page.keyboard.press('Escape');

        await openManager(page, { tab: 'places' });
        await expect(allPlace(page, 'Čapkov').locator('.hm-p-state')).toHaveText('Local history: done · 1');
        await page.locator('#hm-tab-regions').click();
        const group = modal(page).locator('.hm-group[data-group="noRegion"]');
        await expect(group.locator('.hm-group-title')).toHaveText('Without region');
        const row = group.locator('.hm-region[data-key="place:Čapkov"]');
        await expect(row).toContainText('Čapkov and surroundings');
        await row.click();
        await expect(modal(page)).toHaveClass(/is-detail/);
        await expect(modal(page).locator('.hm-detail-title .hm-mark.is-place')).toHaveCount(1);
        await expect(modal(page).locator('.hm-detail-body')).toContainText('A sugar factory opened near Čapkov.');
        const again = modal(page).locator('[data-hm="placeAgain"]');
        await expect(again).toHaveText('Search again in the research');
        await again.click();
        await expect.poll(() => history.writes.place).toEqual([{ place: 'L0001' }]);
        await expect.poll(async () => (await links(page)).at(-1)).toMatch(LINK_L0001);
    });

    test('Places: the research\'s suggestions and a place\'s "⋯" lead to the confirmation', async ({ page }) => {
        const { history } = await setup(page);
        await openManager(page, { tab: 'places' });
        const suggest = modal(page).locator('.hm-group[data-group="suggest"]');
        await expect(suggest.locator('.hm-group-title')).toHaveText('Places with the most people of the tree');
        await expect(suggest.locator('.hm-group-note')).toHaveText('suggested by the research: local history, each search separately');
        await expect(suggest.locator('.hm-p-name')).toHaveText(['Kutná Hora']);
        await suggest.locator('[data-hm="find"]').click();
        await expect(dialog(page).locator('#hpf-title')).toHaveText('Find the history of Kutná Hora and surroundings?');
        await dialog(page).locator('.hpf-foot [data-hpf="cancel"]').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(modal(page)).toBeVisible();
        // A suggested place is listed in All places too: its "⋯" there opens the row's own menu.
        await allPlace(page, 'Kutná Hora').locator('[data-hm="menu"]').click();
        await expect(page.locator('.hm-menu [data-scope]')).toHaveText(['Change region…', 'Find local history…', 'Do not search for this place', 'Open in Places ›']);
        await page.keyboard.press('Escape');
        await expect(page.locator('.hm-menu')).toHaveCount(0);

        await allPlace(page, 'Čapkov').locator('[data-hm="menu"]').click();
        await expect(page.locator('.hm-menu [data-scope]')).toHaveText(['Change region…', 'Find local history…', 'Do not search for this place', 'Open in Places ›']);
        await page.locator('.hm-menu [data-scope="find"]').click();
        await expect(dialog(page).locator('#hpf-title')).toHaveText(TITLE);
        await dialog(page).locator('[data-hpf="go"]').click();
        await expect.poll(() => history.writes.place).toEqual([{ place: 'L0001' }]);
        // K7.1a: a place whose region still waits is offered, its state beside it.
        await openManager(page, { tab: 'places' });
        await expect(allPlace(page, 'Brno').locator('.hm-p-state')).toHaveText('Region waits for the search');
        await allPlace(page, 'Brno').locator('[data-hm="menu"]').click();
        await page.locator('.hm-menu [data-scope="find"]').click();
        await expect(dialog(page).locator('#hpf-title')).toHaveText('Find the history of Brno and surroundings?');
        await dialog(page).locator('[data-hpf="go"]').click();
        await expect.poll(() => history.writes.place).toEqual([{ place: 'L0001' }, { place: 'L0002' }]);
        // A place still being matched to its regions is not offered.
        await changed(page, history, h => { delete h.payload.places['Brno'].regions; });
        await openManager(page, { tab: 'places' });
        await expect(allPlace(page, 'Brno').locator('.hm-p-state')).toHaveText('Waiting to be matched');
        await allPlace(page, 'Brno').locator('[data-hm="menu"]').click();
        await expect(page.locator('.hm-menu [data-scope="find"]')).toHaveCount(0);
    });

    test('gates: without history.place nothing; a place without its record id is not offered', async ({ page }) => {
        const { bridge, history } = await setup(page, { features: HISTORY_R1_FEATURES.filter(f => f !== 'history.place') });
        await openCard(page);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row').first()).toBeVisible();
        await expect(placeRow(page)).toHaveCount(0);
        await openManager(page, { tab: 'places' });
        await expect(modal(page).locator('.hm-group[data-group="suggest"]')).toHaveCount(0);
        await allPlace(page, 'Čapkov').locator('[data-hm="menu"]').click();
        await expect(page.locator('.hm-menu [data-scope="find"]')).toHaveCount(0);
        await page.keyboard.press('Escape');

        bridge.features = HISTORY_R1_FEATURES;
        await changed(page, history, h => { delete h.payload.places['Čapkov'].id; });
        await openCard(page);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row').first()).toBeVisible();
        await expect(placeRow(page)).toHaveCount(0);
    });

    test('split (K8.3): Local history off — nothing offers "Find local history…"; a refusal meanwhile leads to its link', async ({ page }) => {
        const history = fakeHistoryR1({ split: { regions: true, places: false } });
        await setup(page, { history, features: [...HISTORY_R1_FEATURES, 'experiments.split'] });
        await openCard(page);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row').first()).toBeVisible();
        await expect(placeRow(page)).toHaveCount(0);
        await openManager(page, { tab: 'places' });
        await expect(modal(page).locator('.hm-switch-text')).toHaveText(['Regional history: on', 'Local history: off']);
        await expect(modal(page).locator('.hm-group[data-group="suggest"]')).toHaveCount(0);
        await allPlace(page, 'Čapkov').locator('[data-hm="menu"]').click();
        await expect(page.locator('.hm-menu [data-scope="find"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(modal(page)).toBeHidden();

        // On in the research: offered again; switched off there before the app reads the status: 409 with its link.
        history.split = { regions: true, places: true };
        await poll(page);
        await openCard(page);
        await expect(placeRow(page)).toHaveText(OFFER);
        history.split = { regions: true, places: false };
        await offerLink(page).click();
        await dialog(page).locator('[data-hpf="go"]').click();
        await expect(dialog(page).locator('.hpf-note')).toHaveText('Local history is not searched for this tree. Turn on in the research');
        await dialog(page).locator('[data-hpf="noteLink"]').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(async () => (await links(page)).at(-1)).toMatch(/^strom-research:\/\/experiment\?tree=.+&name=placeHistory&do=on$/);
    });

    test('history.place.direct: the place comes first over the bridge (Find, toast); a link after all switches to the terminal', async ({ page }) => {
        const history = fakeHistoryR1();
        history.writeReply = { place: { status: 200, body: { ok: true, place: 'L0001' } } };
        await setup(page, { history, features: [...HISTORY_R1_FEATURES, 'history.place.direct'] });
        await openCard(page);
        await offerLink(page).click();
        await expect(dialog(page).locator('.hpf-mode')).toHaveText('The place comes first, at the next session. All trees on this computer will see the result.');
        await expect(dialog(page).locator('.hpf-foot button')).toHaveText(['Cancel', 'Find']);
        await dialog(page).locator('[data-hpf="go"]').click();
        await expect.poll(() => history.writes.place).toEqual([{ place: 'L0001' }]);
        await expect(dialog(page)).toHaveCount(0);
        await expect(toast(page, 'The history of Čapkov and surroundings comes first.')).toBeVisible();

        // The bridge leaves it to the terminal after all: the dialog stays and its button opens the link.
        history.writeReply = {};
        await openCard(page);
        await offerLink(page).click();
        await dialog(page).locator('[data-hpf="go"]').click();
        await expect(dialog(page).locator('.hpf-mode')).toHaveText(TERMINAL);
        await expect(dialog(page).locator('[data-hpf="go"]')).toHaveText('Continue in the research');
        await dialog(page).locator('[data-hpf="go"]').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(async () => (await links(page)).at(-1)).toMatch(LINK_L0001);
    });

    test('phone (390 px): the short row; the confirmation is a bottom sheet that fits', { tag: '@smoke' }, async ({ page }) => {
        await setup(page, { width: 390 });
        await openCard(page);
        await expect(placeRow(page)).toHaveText('Čapkov and surroundings: Find history…');
        await offerLink(page).click();
        const box = await dialog(page).locator('.hpf-modal').boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(390.5);
        expect(Math.abs(box!.y + box!.height - 844)).toBeLessThan(2);
        await expect(dialog(page).locator('#hpf-cost')).toBeVisible();
        await expect(dialog(page).locator('[data-hpf="go"]')).toBeInViewport();
    });

    test.describe('German', () => {
        // The longest chip and title of the three languages.
        test.use({ locale: 'de-DE' });
        test('phone with a touch screen: the card head\'s "i" does not reach over the History chip; the confirmation\'s × is 44 px', async ({ page }) => {
            await setup(page, { width: 390 });
            await touchScreenNow(page);
            await openCard(page);
            const gap = await page.locator('#pm-lifeline-head').evaluate(head => {
                const chip = head.querySelector('#pm-lifeline-history-toggle')!.getBoundingClientRect();
                const info = head.querySelector('.pm-lifeline-hinfo')!.getBoundingClientRect();
                return Math.round(info.left - chip.right);
            });
            expect(gap).toBeGreaterThanOrEqual(0);
            await offerLink(page).click();
            const close = (await dialog(page).locator('.hpf-header .close-btn').boundingBox())!;
            expect(Math.round(close.width)).toBeGreaterThanOrEqual(44);
            expect(Math.round(close.height)).toBeGreaterThanOrEqual(44);
        });
    });
});
