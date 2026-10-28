import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistory, fakeHistoryR1, historyGed, openResearch, openResearchMenu, poll, links,
    HISTORY_FEATURES, HISTORY_R1_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * "History of places" (#history-modal, spec 020 K4.3/K4.4, work 1028 part A):
 * its entries (Settings, the Research menu, the card's legend, "All hidden ›"),
 * the header in each state of the research, the tabs with a search without
 * diacritics, the regions grouped as the research takes them, the places,
 * the hidden and the deleted events, the row actions (Find first, Hide all,
 * Do not search and their undo) and their gates by `/status.features`.
 * Invented data (fakeHistoryR1): Jan lived in Čáslav 1860–1910.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];

async function setup(page: Page, opts: { history?: FakeHistory; features?: string[]; width?: number; height?: number } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = opts.history ?? fakeHistoryR1();
    const ged = historyGed();
    const features = opts.features ?? HISTORY_R1_FEATURES;
    const bridge = await fakeBridge(page, { features, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await poll(page);
    if (features.includes('history.events')) await expect.poll(() => history.reads).toBeGreaterThan(0);
    return { bridge, history };
}

const modal = (page: Page) => page.locator('#history-modal');
const stateText = (page: Page) => page.locator('#history-manage-state .hm-state-text');
const region = (page: Page, key: string) => modal(page).locator(`.hm-region[data-key="${key}"]`);
const place = (page: Page, key: string) => modal(page).locator(`.hm-place[data-place="${key}"]`);
const tab = (page: Page, name: string) => page.locator(`#hm-tab-${name}`);
const confirmModal = (page: Page) => page.locator('#confirmation-modal');
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });

async function openManager(page: Page, opts: { tab?: string } = {}): Promise<void> {
    await page.evaluate((o) => (window.Strom.UI as unknown as { openHistoryManage(o: object): void }).openHistoryManage(o), opts);
    await expect(modal(page)).toBeVisible();
    await expect(stateText(page)).not.toHaveText('Loading history…');
}

/** A row's "⋯" menu (a popup on a desktop), its items' scopes. */
async function rowMenu(page: Page, key: string): Promise<string[]> {
    await region(page, key).locator('[data-hm="menu"]').click();
    const menu = page.locator('.hm-menu');
    await expect(menu).toBeVisible();
    return menu.locator('[data-scope]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.scope ?? ''));
}

const idOf = (page: Page, first: string) => page.evaluate((first) =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);

async function openCard(page: Page, first: string): Promise<void> {
    const id = await idOf(page, first);
    await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
    await expect(page.locator('#pm-lifeline-section')).toBeVisible();
}

test.describe('History of places: the manager', () => {
    test('from Settings: the regions in the research\'s order, each state on its row', { tag: '@smoke' }, async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#history-manage-link-sub')).toHaveText('7 regions · 4 events · 1 hidden');
        await page.locator('#history-manage-link').click();
        await expect(modal(page)).toBeVisible();
        await expect(tab(page, 'regions')).toHaveAttribute('aria-selected', 'true');
        // Waiting: Brno only (Opava is not searched, Lhotka waits for its region, not for the search).
        await expect(stateText(page)).toHaveText('The research is looking for history, now for the region Silesia; 1 place of the tree is still waiting.');
        await expect(page.locator('#history-manage-state .hm-state-summary')).toHaveText('7 regions · 5 places · 4 events · 1 hidden');
        // Pace (experiments.pace not said by this bridge yet): none.
        await expect(page.locator('#history-manage-state .hm-state-pace')).toHaveCount(0);

        // The queue in the research's order: running, first, queued by order, waiting.
        const queue = modal(page).locator('.hm-group[data-group="queue"] .hm-region');
        await expect(queue.locator('.hm-r-title')).toHaveText(['Silesia', 'Moravia', 'Lower Austria', 'Nebraska']);
        await expect(queue.locator('.hm-r-state-line > span:last-child')).toHaveText(['Searching', 'First', 'Queued · 3rd', 'Waiting']);
        await expect(region(page, 'us-nebraska').locator('.hm-r-why')).toHaveText('its archive is held by another tree');
        await expect(region(page, 'cz-moravia').locator('.hm-r-meta')).toHaveText('2 places · 2 people');
        // Nothing found yet in the queue: "–".
        await expect(region(page, 'cz-silesia').locator('.hm-r-events')).toHaveText('–');
        // Parent from `covered` (the research gives no `parent`).
        await expect(region(page, 'cz-moravia').locator('.hm-r-parent')).toHaveText('Austrian Empire');

        // Done: its date, the years without events and their filling, the hidden count; opens its detail.
        const bohemia = region(page, 'cz-bohemia');
        await expect(modal(page).locator('.hm-group[data-group="done"] .hm-r-title')).toHaveText(['Bohemia']);
        await expect(bohemia.locator('.hm-r-state-line > span:last-child')).toHaveText(/^Done · \d/);
        await expect(bohemia.locator('.hm-r-gaps')).toHaveText('years without events 1870–1913 · filling queued');
        await expect(bohemia.locator('.hm-r-events')).toHaveText('2');
        await expect(bohemia.locator('.hm-r-hidden')).toHaveText('1 hidden');
        await expect(bohemia).toHaveAttribute('data-hm', 'open');

        // Not searched: the covered state first, then the skipped one with "Search again".
        const skip = modal(page).locator('.hm-group[data-group="skip"] .hm-region');
        await expect(skip.locator('.hm-r-title')).toHaveText(['Austrian Empire', 'Prussia']);
        await expect(region(page, 'at-empire').locator('.hm-r-state-line > span:last-child')).toHaveText('Covered by Bohemia and Moravia');
        await expect(region(page, 'at-empire').locator('.hm-r-meta')).toHaveText('state above its lands');
        await expect(region(page, 'de-prussia')).toHaveClass(/is-dim/);
        await expect(region(page, 'de-prussia').locator('[data-hm="searchAgain"]')).toHaveText('Search again');

        // Without region: the tree's own findings.
        await expect(modal(page).locator('.hm-group[data-group="noRegion"] .hm-r-title')).toHaveText(['From research sources']);
        await expect(region(page, 'local').locator('.hm-r-events')).toHaveText('1');

        // Close: back in Settings.
        await modal(page).locator('.buttons [data-dismiss]').click();
        await expect(modal(page)).toBeHidden();
        await expect(page.locator('#settings-modal')).toBeVisible();
    });

    test('the header follows the research: next in the queue, all done, matching places, pace', async ({ page }) => {
        const history = fakeHistoryR1({ pace: 'rare' });
        const { bridge } = await setup(page, { history });
        await openManager(page);
        await expect(page.locator('#history-manage-state .hm-state-pace')).toHaveText('Frequency: rarely, about every 10th session. Changed in the research settings.');
        const regions = history.payload.regions!;
        const change = async (fn: () => void) => {
            fn();
            history.rev = `h${Number(history.rev.slice(1)) + 1}`;
            history.payload.state.rev = history.rev;
            await poll(page);
        };
        await change(() => { regions['cz-silesia'].state = 'done'; });
        await expect(stateText(page)).toHaveText('The research is looking for history. Next up is the region Moravia.');
        await change(() => { for (const r of Object.values(regions)) if (['queued', 'running', 'waiting'].includes(r.state as string)) r.state = 'done'; });
        await expect(stateText(page)).toHaveText('The research has finished all regions of this tree. New places are matched when they are added.');
        await change(() => { Object.assign(history.payload.state, { search: 'running', mapping: { mapped: 3, mappable: 5 } }); });
        await expect(stateText(page)).toHaveText('The research is matching places to regions: 3 of 5 done.');
        expect(bridge.history).toBe(history);
    });

    test('the research not searching: the header says so with the link to switch it on; no "Find first"', async ({ page }) => {
        await setup(page, { history: fakeHistoryR1({ searching: false }) });
        await openManager(page);
        await expect(stateText(page)).toHaveText('The research is not looking for history. Events already found stay. Turn on the search in the research');
        expect(await rowMenu(page, 'at-lower-austria')).toEqual(['hideAll', 'skip']);
        await page.keyboard.press('Escape');
        await stateText(page).getByRole('button', { name: 'Turn on the search in the research' }).click();
        const opened = await links(page);
        expect(opened.some(u => u.includes('experiment') && u.includes('do=on'))).toBe(true);
    });

    test('without the bridge: from the copy with its time; hiding stays, the bridge\'s actions go', async ({ page }) => {
        const { bridge } = await setup(page);
        bridge.down = true;
        await poll(page);
        await openManager(page);
        await expect(stateText(page)).toHaveText(/^Status as of .+\. The research is not running now\.$/);
        await expect(page.locator('#history-manage-state .hm-state-note')).toHaveText('Hiding works now too and is saved once the research runs. Other changes need the research running.');
        // Only "Hide all" (it waits in the queue): no Find first, no Do not search, no Search again.
        expect(await rowMenu(page, 'at-lower-austria')).toEqual(['hideAll']);
        await page.keyboard.press('Escape');
        await expect(region(page, 'de-prussia').locator('[data-hm="searchAgain"]')).toHaveCount(0);
        await tab(page, 'deleted').click();
        await expect(modal(page).locator('.hm-deleted')).toHaveCount(2);
        await expect(modal(page).locator('[data-hm="restoreDeleted"]')).toHaveCount(0);
    });

    test('an older research without regions: one list without states, places without regions', async ({ page }) => {
        const history = fakeHistoryR1();
        delete history.payload.regions;
        delete history.payload.deleted;
        delete history.payload.suggest;
        for (const [k, pl] of Object.entries(history.payload.places)) {
            history.payload.places[k] = { events: pl.events, ...(pl.state ? { state: pl.state } : {}) };
        }
        await setup(page, { history, features: [...HISTORY_FEATURES, 'history.first'] });
        await openManager(page);
        await expect(stateText(page)).toHaveText('The research is still looking for events for the places of this tree.');
        const all = modal(page).locator('.hm-group[data-group="all"] .hm-region');
        await expect(all.locator('.hm-r-title')).toHaveText(['Austrian Empire', 'Bohemia']);
        await expect(all.locator('.hm-r-state-line > span:last-child')).toHaveCount(0);
        await expect(modal(page).locator('.hm-dots')).toHaveCount(0);
        await expect(tab(page, 'deleted')).toHaveCount(0);
        await tab(page, 'places').click();
        await expect(modal(page).locator('select[data-hm="sort"]')).toHaveCount(0);
        await expect(place(page, 'Brno').locator('.hm-p-state')).toHaveText('Waiting for the search');
        await expect(place(page, 'Čáslav').locator('.hm-p-meta')).toHaveCount(0);
    });

    test('tabs and a search without diacritics, with its count and clear', async ({ page }) => {
        await setup(page);
        await openManager(page);
        await expect(modal(page).locator('.hm-tab-count')).toHaveText(['8', '5', '1', '2']);
        const search = page.locator('#history-manage-search');
        // The Czech name of Bohemia, typed without its háček.
        await search.fill('cechy');
        await expect(modal(page).locator('.hm-region .hm-r-title')).toHaveText(['Bohemia']);
        await expect(page.locator('#history-manage-count')).toHaveText('1 of 8');
        await search.fill('nothing like it');
        await expect(modal(page).locator('.hm-empty')).toHaveText('Nothing found.');
        await page.locator('#history-manage-clear').click();
        await expect(search).toHaveValue('');
        await expect(page.locator('#history-manage-clear')).toBeHidden();
        await expect(page.locator('#history-manage-count')).toHaveText('');
        // Keys: the arrows move between tabs.
        await tab(page, 'regions').focus();
        await page.keyboard.press('ArrowRight');
        await expect(tab(page, 'places')).toHaveAttribute('aria-selected', 'true');
        await expect(tab(page, 'places')).toBeFocused();
        await search.fill('caslav');
        await expect(modal(page).locator('.hm-group[data-group="all"] .hm-p-name')).toHaveText(['Čáslav']);
        await expect(page.locator('#history-manage-count')).toHaveText('1 of 5');
    });

    test('Places: unassigned first, all by people or alphabetically (kept), states and regions with years', async ({ page }) => {
        await setup(page);
        await openManager(page, { tab: 'places' });
        await expect(tab(page, 'places')).toHaveAttribute('aria-selected', 'true');
        await expect(modal(page).locator('.hm-group-title')).toHaveText(['Unassigned places', 'All places · 5']);
        const unassigned = modal(page).locator('.hm-group[data-group="unassigned"] .hm-place');
        await expect(unassigned.locator('.hm-p-name')).toHaveText(['Lhotka']);
        await expect(unassigned.locator('.hm-p-why')).toHaveText('several places of that name');
        // The suggestions lead only to "Find local history…" (a later part): not shown without it.
        await expect(modal(page).locator('.hm-group[data-group="suggest"]')).toHaveCount(0);
        const all = modal(page).locator('.hm-group[data-group="all"] .hm-p-name');
        await expect(all).toHaveText(['Kutná Hora', 'Čáslav', 'Brno', 'Lhotka', 'Opava']);
        const caslav = modal(page).locator('.hm-group[data-group="all"] .hm-place[data-place="Čáslav"]');
        await expect(caslav.locator('.hm-p-meta')).toHaveText('Bohemia · Austrian Empire until 1918 · 3 people');
        await expect(caslav.locator('.hm-p-count')).toHaveText('4');
        await expect(modal(page).locator('.hm-group[data-group="all"] .hm-place[data-place="Brno"] .hm-p-state')).toHaveText('Region waits for the search');
        const opava = modal(page).locator('.hm-group[data-group="all"] .hm-place[data-place="Opava"]');
        await expect(opava).toHaveClass(/is-dim/);
        await expect(opava.locator('.hm-p-state')).toContainText('Not searched');
        await expect(opava.locator('.hm-p-meta')).toHaveText('Silesia from 1742 · 1 person');
        await modal(page).locator('select[data-hm="sort"]').selectOption('alpha');
        await expect(all).toHaveText(['Brno', 'Čáslav', 'Kutná Hora', 'Lhotka', 'Opava']);
        expect(await page.evaluate(() => window.Strom.SettingsManager.getHistoryPlacesSort())).toBe('alpha');
    });

    test('Hidden: a region hidden whole and an event, each with its way back', async ({ page }) => {
        const history = fakeHistoryR1();
        history.payload.hidden.push({ region: 'cz-silesia', at: '2026-10-22T08:00:00Z' });
        const { history: h } = await setup(page, { history });
        await openManager(page, { tab: 'hidden' });
        const rows = modal(page).locator('.hm-row.hm-hidden');
        await expect(rows.locator('.hm-h-text')).toHaveText(['Everything from Silesia', 'Vienna stock exchange crash.']);
        await expect(rows.nth(0).locator('.hm-h-meta')).toHaveText('in this tree · 0 events, future ones too');
        await expect(rows.nth(1).locator('.hm-h-meta')).toHaveText('Bohemia · for Čáslav');
        await rows.nth(0).locator('[data-hm="restoreHidden"]').click();
        await expect(toast(page, 'Events of Silesia show again in this tree.')).toBeVisible();
        await expect.poll(() => h.hides).toEqual([{ region: 'cz-silesia', do: 'show' }]);
        await expect(rows.locator('.hm-h-text')).toHaveText(['Vienna stock exchange crash.']);
        await rows.locator('[data-hm="restoreHidden"]').click();
        await expect(modal(page).locator('.hm-empty')).toHaveText('Nothing is hidden in this tree.');
        await expect.poll(() => h.hides.length).toBe(2);
        expect(h.hides[1]).toEqual({ event: 'E2', place: 'Čáslav', do: 'show' });
    });

    test('Deleted: newest first, a copy-less one by its id; Restore goes to the research', async ({ page }) => {
        const { history } = await setup(page);
        await openManager(page, { tab: 'deleted' });
        await expect(tab(page, 'deleted')).toHaveAttribute('aria-selected', 'true');
        const rows = modal(page).locator('.hm-deleted');
        await expect(rows.locator('.hm-h-text')).toHaveText(['A flood on the Doubrava.', 'E8']);
        await expect(rows.nth(0).locator('.hm-h-year')).toHaveText('1882');
        await expect(rows.nth(0).locator('.hm-h-meta')).toHaveText(/^Bohemia · deleted .+ · from all trees on this computer$/);
        await rows.nth(0).locator('[data-hm="restoreDeleted"]').click();
        await expect(toast(page, 'The event is restored.')).toBeVisible();
        expect(history.writes.delete).toEqual([{ event: 'E9', do: 'restore' }]);
        await expect(rows.locator('.hm-h-text')).toHaveText(['E8']);
        await expect(tab(page, 'deleted').locator('.hm-tab-count')).toHaveText('1');
    });

    test('Find first: the research\'s queue, the sentence under the row with the pace', async ({ page }) => {
        const { history } = await setup(page, { history: fakeHistoryR1({ pace: 'rare' }) });
        await openManager(page);
        expect(await rowMenu(page, 'at-lower-austria')).toEqual(['first', 'hideAll', 'skip']);
        await page.locator('.hm-menu [data-scope="first"]').click();
        await expect(modal(page).locator('.hm-row-note[data-note="at-lower-austria"]')).toHaveText(
            'The history of Lower Austria comes first of the regions, at the next history session (about every 10th research session). It can be started right away in the research.');
        expect(history.writes.first).toEqual([{ region: 'at-lower-austria' }]);
        // Read again: the row says "First" and has no "Find first" any more.
        await expect(region(page, 'at-lower-austria').locator('.hm-r-state-line > span:last-child')).toHaveText('First');
        expect(await rowMenu(page, 'at-lower-austria')).toEqual(['hideAll', 'skip']);
        // A done region and the running one never offer it.
        await page.keyboard.press('Escape');
        expect(await rowMenu(page, 'cz-bohemia')).toEqual(['hideAll']);
    });

    test('Hide all: confirmed, the region dimmed with "Show again"; Undo in the toast', async ({ page }) => {
        const { history } = await setup(page);
        await openManager(page);
        await rowMenu(page, 'cz-bohemia');
        await page.locator('.hm-menu [data-scope="hideAll"]').click();
        await expect(confirmModal(page)).toBeVisible();
        await expect(page.locator('#confirm-title')).toHaveText('Hide everything from Bohemia?');
        await confirmModal(page).locator('#confirm-ok-btn').click();
        await expect(toast(page, 'Everything from Bohemia is hidden in this tree.')).toBeVisible();
        await expect.poll(() => history.hides).toEqual([{ region: 'cz-bohemia' }]);
        const bohemia = region(page, 'cz-bohemia');
        await expect(bohemia.locator('.hm-r-state-line > span:last-child')).toHaveText('Hidden in this tree');
        await expect(bohemia).toHaveClass(/is-dim/);
        await tab(page, 'hidden').click();
        await expect(modal(page).locator('.hm-row.hm-hidden.is-region .hm-h-text')).toHaveText('Everything from Bohemia');
        await tab(page, 'regions').click();
        await bohemia.locator('[data-hm="showAgain"]').click();
        await expect.poll(() => history.hides.length).toBe(2);
        expect(history.hides[1]).toEqual({ region: 'cz-bohemia', do: 'show' });
        await expect(bohemia.locator('.hm-r-state-line > span:last-child')).toHaveText(/^Done/);
    });

    test('Do not search: confirmed, Undo; Search again; busy says so under the row', async ({ page }) => {
        const { history } = await setup(page);
        await openManager(page);
        await rowMenu(page, 'cz-moravia');
        await page.locator('.hm-menu [data-scope="skip"]').click();
        await expect(page.locator('#confirm-title')).toHaveText('Stop searching Moravia for this tree?');
        await confirmModal(page).locator('#confirm-ok-btn').click();
        await expect(toast(page, 'Moravia is not searched for this tree.')).toBeVisible();
        expect(history.writes.skip).toEqual([{ region: 'cz-moravia' }]);
        await expect(modal(page).locator('.hm-group[data-group="skip"] .hm-r-title')).toHaveText(['Austrian Empire', 'Moravia', 'Prussia']);
        await toast(page, 'Moravia is not searched for this tree.').getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => history.writes.skip.length).toBe(2);
        expect(history.writes.skip[1]).toEqual({ region: 'cz-moravia', do: 'undo' });
        await expect(region(page, 'cz-moravia').locator('.hm-r-state-line > span:last-child')).toHaveText('First');

        // A place: from its "⋯".
        await tab(page, 'places').click();
        await place(page, 'Brno').locator('[data-hm="menu"]').click();
        await expect(page.locator('.hm-menu [data-scope]')).toHaveText(['Change region…', 'Do not search for this place', 'Open in Places ›']);
        await page.locator('.hm-menu [data-scope="skipPlace"]').click();
        await expect(page.locator('#confirm-title')).toHaveText('Do not search history for Brno?');
        await confirmModal(page).locator('#confirm-ok-btn').click();
        await expect(toast(page, 'Brno is not searched for history.')).toBeVisible();
        expect(history.writes.skip[2]).toEqual({ place: 'Brno' });

        // Busy: the sentence under the row, the row stays.
        history.writeReply = { skip: { status: 503, body: { error: 'busy', code: 'research.busy' } } };
        await tab(page, 'regions').click();
        await region(page, 'de-prussia').locator('[data-hm="searchAgain"]').click();
        await expect(modal(page).locator('.hm-row-note[data-note="de-prussia"]')).toHaveText('The research is busy. It will work again shortly.');
        await expect(region(page, 'de-prussia').locator('.hm-r-state-line > span:last-child')).toHaveText('Not searched');
        history.writeReply = undefined;
        await region(page, 'de-prussia').locator('[data-hm="searchAgain"]').click();
        await expect(toast(page, 'Prussia is searched again for this tree.')).toBeVisible();
        await expect(modal(page).locator('.hm-row-note[data-note="de-prussia"]')).toHaveCount(0);
    });

    test('a region\'s detail opens on its row: title focused, state with the gaps, the events by centuries; back to the row', async ({ page }) => {
        await setup(page);
        await openManager(page);
        await region(page, 'cz-bohemia').click();
        await expect(modal(page)).toHaveClass(/is-detail/);
        const title = modal(page).locator('.hm-detail-title');
        await expect(title.locator('.hm-detail-name')).toHaveText('Bohemia');
        await expect(title).toBeFocused();
        await expect(modal(page).locator('.hm-detail-state')).toContainText('years without events 1870–1913 · filling queued');
        const events = modal(page).locator('.hd-ev');
        await expect(events).toHaveCount(2);
        await expect(events.locator('.pm-lifeline-htext')).toHaveText(['Austro-Prussian War; fighting around Čáslav.', 'Vienna stock exchange crash.']);
        await expect(modal(page).locator('.hd-century-head')).toHaveText([/1800–1899 · 2/]);
        // The event's menu opens by its "⋯".
        await events.nth(0).locator('[data-hd="menu"]').click();
        await expect(page.locator('.hd-menu [data-scope]').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.hd-menu')).toHaveCount(0);
        await modal(page).locator('.hm-back').click();
        await expect(region(page, 'cz-bohemia')).toBeFocused();
    });

    test('gates: an action without its feature is not in the menu; without any, no "⋯"', async ({ page }) => {
        const { bridge } = await setup(page, { features: [...HISTORY_FEATURES, 'history.regions', 'history.first'] });
        await openManager(page);
        expect(await rowMenu(page, 'at-lower-austria')).toEqual(['first']);
        await page.keyboard.press('Escape');
        await expect(region(page, 'cz-bohemia').locator('.hm-dots')).toHaveCount(0);
        await expect(region(page, 'de-prussia').locator('[data-hm="searchAgain"]')).toHaveCount(0);
        await tab(page, 'deleted').click();
        await expect(modal(page).locator('[data-hm="restoreDeleted"]')).toHaveCount(0);
        // The status takes `history.first` away: the menus go with it.
        bridge.features = [...HISTORY_FEATURES, 'history.regions'];
        await poll(page);
        await tab(page, 'regions').click();
        await expect(modal(page).locator('.hm-region .hm-dots')).toHaveCount(0);
        await tab(page, 'places').click();
        await place(page, 'Brno').locator('[data-hm="menu"]').click();
        await expect(page.locator('.hm-menu [data-scope]')).toHaveText(['Open in Places ›']);
    });

    test('without history.events there is no entry anywhere', async ({ page }) => {
        const { history } = await setup(page, { features: HISTORY_FEATURES.filter(f => f !== 'history.events') });
        expect(history.reads).toBe(0);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#history-setting-toggle')).toBeVisible();
        await expect(page.locator('#history-manage-link')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.forceCloseModal());
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-more')).toBeVisible();
        await expect(page.locator('#research-item-history')).toHaveCount(0);
    });

    test('entries: the Research menu, the card\'s legend and "All hidden ›" (Hidden tab)', async ({ page }) => {
        await setup(page);
        await openResearchMenu(page, { expandMore: true });
        const item = page.locator('#research-item-history');
        await expect(item).toContainText('History of places');
        await expect(item).toContainText('7 regions · 4 events');
        await item.click();
        await expect(modal(page)).toBeVisible();
        await expect(tab(page, 'regions')).toHaveAttribute('aria-selected', 'true');
        await modal(page).locator('.buttons [data-dismiss]').click();
        await expect(modal(page)).toBeHidden();

        await openCard(page, 'Jan');
        await page.locator('.pm-lifeline-hinfo').click();
        await page.locator('.pm-lifeline-legend-manage').click();
        await expect(modal(page)).toBeVisible();
        await expect(page.locator('.pm-lifeline-legend-manage')).toHaveCount(0);
        await modal(page).locator('.buttons [data-dismiss]').click();
        await expect(modal(page)).toBeHidden();
        await expect(page.locator('#person-modal')).toBeVisible();

        await page.locator('.pm-lifeline-hidden').click();
        await page.locator('.pm-lifeline-hall').click();
        await expect(modal(page)).toBeVisible();
        await expect(tab(page, 'hidden')).toHaveAttribute('aria-selected', 'true');
        await expect(modal(page).locator('.hm-row.hm-hidden .hm-h-text')).toHaveText(['Vienna stock exchange crash.']);
    });

    test('phone (390 px): the row\'s "⋯" is a bottom sheet with Cancel, and the dialog fits', { tag: '@smoke' }, async ({ page }) => {
        const { history } = await setup(page, { width: 390, height: 844 });
        await openManager(page);
        const fits = await modal(page).locator('.modal-content, #history-manage-body').first().evaluate(el => el.scrollWidth <= el.clientWidth + 1);
        expect(fits).toBe(true);
        await region(page, 'at-lower-austria').locator('[data-hm="menu"]').click();
        const sheet = page.locator('.bottom-sheet.hm-menu-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.pm-lifeline-hsheet-head')).toHaveText('Lower Austria · Queued · 3rd');
        await expect(sheet.locator('[data-scope]')).toHaveCount(3);
        await sheet.getByRole('button', { name: 'Cancel' }).click();
        await expect(sheet).toHaveCount(0);
        await region(page, 'at-lower-austria').locator('[data-hm="menu"]').click();
        await page.locator('.bottom-sheet.hm-menu-sheet [data-scope="first"]').click();
        await expect(modal(page).locator('.hm-row-note[data-note="at-lower-austria"]')).toContainText('The history of Lower Austria comes first of the regions');
        expect(history.writes.first).toEqual([{ region: 'at-lower-austria' }]);
    });

    test('an older payload from a research without R1 keeps the old Settings sentence (regression)', async ({ page }) => {
        // The plain fakeHistory (no regions): the manager still opens from Settings and shows the derived list.
        await setup(page, { history: fakeHistory(), features: HISTORY_FEATURES });
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#history-manage-link-sub')).toHaveText(/ · 1 hidden$/);
        await page.locator('#history-manage-link').click();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page).locator('.hm-empty')).toHaveText('The research has no region for this tree yet.');
    });
});
