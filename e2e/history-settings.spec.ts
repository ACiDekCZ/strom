import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';
import {
    fakeBridge, fakeHistory, fakeHistoryR1, historyGed, openResearch, poll, links,
    HISTORY_FEATURES, HISTORY_R1_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * History in the life timeline (spec 020) — its Settings rows in "Person
 * card": the toggle (on by default; a user's "off" stays), its
 * status row by the research's bridge (`/status.features`, `history.rev`,
 * `experiments.history`), switching the search off through the bridge or on
 * through the research's `experiment` link, and the tree's list of hidden
 * events with "Show again". Invented data (fakeHistory).
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];

async function setup(page: Page, opts: { history?: Partial<FakeHistory>; features?: string[]; layerOn?: boolean } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    const history = fakeHistory(opts.history);
    const ged = historyGed();
    const bridge = await fakeBridge(page, { features: opts.features ?? HISTORY_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    if (opts.layerOn !== undefined) await page.evaluate((on) => window.Strom.SettingsManager.setHistoryLayer(on), opts.layerOn);
    await poll(page);
    return { bridge, history };
}

const openSettings = (page: Page) => page.evaluate(() => window.Strom.UI.showSettingsDialog());
const toggle = (page: Page) => page.locator('#history-setting-toggle');
const status = (page: Page) => page.locator('#history-setting-status');
const manageLink = (page: Page) => page.locator('#history-manage-link');
const manageSub = (page: Page) => page.locator('#history-manage-link-sub');
const manager = (page: Page) => page.locator('#history-modal');

test.describe('History in the life timeline: Settings', () => {
    test('on by default: the toggle is checked and the events are read', async ({ page }) => {
        const { history } = await setup(page);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').historyLayer)).toBeUndefined();
        await openSettings(page);
        // Not experimental any more (K1.5): the row is in "Person card", the empty Experimental features group hidden.
        await expect(page.locator('section[aria-labelledby="settings-group-card"] #history-setting-toggle')).toBeVisible();
        await expect(page.locator('#settings-experiments')).toBeHidden();
        await expect(toggle(page)).toBeChecked();
        await expect(status(page)).toContainText('The research looks for events.');
        expect(history.reads).toBe(1);
    });

    test('switched off by the user: it stays off after a reload, nothing is read and the card API says nothing', async ({ page }) => {
        const { history } = await setup(page, { history: { searching: false } });
        await openSettings(page);
        await toggle(page).uncheck();
        history.reads = 0;
        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);
        await poll(page);
        await openSettings(page);
        await expect(toggle(page)).not.toBeChecked();
        await expect(status(page)).toBeHidden();
        await expect(manageLink(page)).toBeHidden();
        await poll(page);
        expect(history.reads).toBe(0);
        const view = await page.evaluate(() => {
            const jan = (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!;
            return window.Strom.UI.historyForPerson(jan.id);
        });
        expect(view).toBeNull();
    });

    test('on for a tree without a research: says so', async ({ page }) => {
        await openApp(page);
        await openSettings(page);
        await expect(toggle(page)).toBeChecked();
        await expect(status(page)).toHaveText('Events for places are found by the research. This tree is not linked to a research.');
    });

    test('switched on: reads the events once per rev, says the search, counts the hidden', async ({ page }) => {
        const { history } = await setup(page);
        await openSettings(page);
        await toggle(page).check();
        await expect(status(page)).toContainText('The research looks for events. Last search:');
        await expect(manageLink(page)).toBeVisible();
        await expect(manageSub(page)).toHaveText(/ · 1 hidden$/);
        expect(history.reads).toBe(1);
        // The same rev: not read again.
        await poll(page);
        await expect(status(page)).toContainText('The research looks for events.');
        expect(history.reads).toBe(1);
        // The card API: Jan (Čapkov 1860–1910) gets the war of 1866; the crash stays hidden.
        const view = await page.evaluate(() => {
            const jan = (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!;
            const v = window.Strom.UI.historyForPerson(jan.id);
            return v && { chipOn: v.chipOn, items: v.history?.items.map(i => i.ev.id), hidden: v.history?.hidden.map(i => i.ev.id) };
        });
        expect(view).toEqual({ chipOn: true, items: ['E1'], hidden: ['E2'] });
    });

    test('History of places, Hidden tab: "Show again" goes to the research; Close returns to Settings', async ({ page }) => {
        const { history } = await setup(page, { layerOn: true });
        await openSettings(page);
        await expect(manageSub(page)).toHaveText(/ · 1 hidden$/);
        await manageLink(page).click();
        const modal = manager(page);
        await expect(modal).toBeVisible();
        await expect(page.locator('#hm-tab-regions')).toHaveAttribute('aria-selected', 'true');
        await page.locator('#hm-tab-hidden').click();
        const item = modal.locator('.hm-row.hm-hidden');
        await expect(item).toHaveCount(1);
        await expect(item).toContainText('Vienna stock exchange crash.');
        await expect(item.locator('.hm-h-meta')).toContainText('for Čapkov');
        await item.locator('[data-hm="restoreHidden"]').click();
        await expect(modal.locator('.hm-empty')).toHaveText('Nothing is hidden in this tree.');
        await expect.poll(() => history.hides).toEqual([{ event: 'E2', place: 'Čapkov', do: 'show' }]);
        await modal.locator('.buttons [data-dismiss]').click();
        await expect(modal).toBeHidden();
        await expect(page.locator('#settings-modal')).toBeVisible();
        await expect(manageSub(page)).not.toContainText('hidden');
    });

    test('a hiding from the card waits in the browser while the bridge refuses, then goes', async ({ page }) => {
        const { history } = await setup(page, { layerOn: true, history: { hideReply: { status: 503, body: { error: 'busy', code: 'research.busy' } } } });
        await openSettings(page);
        await expect(manageSub(page)).toHaveText(/ · 1 hidden$/);
        await page.evaluate(() => {
            const ui = window.Strom.UI;
            const jan = (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!;
            const item = ui.historyForPerson(jan.id)!.history!.items[0];
            ui.hideHistoryItem(jan.id, item, 'person');
        });
        await expect(manageSub(page)).toHaveText(/ · 2 hidden$/);
        await expect.poll(() => history.hides.length).toBe(1);
        await manageLink(page).click();
        await page.locator('#hm-tab-hidden').click();
        await expect(manager(page).locator('.hm-hidden .hm-h-meta').filter({ hasText: 'so far only in this browser' })).toHaveCount(1);
        await manager(page).locator('.buttons [data-dismiss]').click();
        history.hideReply = undefined;
        await poll(page);
        await expect.poll(() => history.hides.length).toBe(2);
        expect(history.hides[1]).toEqual({ event: 'E1', person: 'P0003' });
        await expect(manageSub(page)).toHaveText(/ · 2 hidden$/);
    });

    test('switched off while the research still searches: the search goes off through the bridge', async ({ page }) => {
        const { history } = await setup(page, { layerOn: true });
        await openSettings(page);
        await expect(status(page)).toContainText('The research looks for events.');
        await toggle(page).uncheck();
        await expect(status(page)).toContainText('The research still looks for events for this tree.');
        await status(page).getByRole('button', { name: 'Turn off the search for this tree' }).click();
        await expect.poll(() => history.offs).toEqual([{ history: false }]);
        await expect(page.locator('.toast').filter({ hasText: 'The search for events is off for this tree.' })).toBeVisible();
        await expect(status(page)).toBeHidden();
        await poll(page);
        await expect(status(page)).toBeHidden();
    });

    test('the research not searching: the search is switched on by its terminal (the experiment link)', async ({ page }) => {
        const { history } = await setup(page, { layerOn: true, history: { searching: false } });
        await openSettings(page);
        await expect(status(page)).toHaveText("The research does not look for events. Turn on the search in the research, opens in the research The search can also be switched on in the research's Settings.");
        await status(page).getByRole('button', { name: 'Turn on the search in the research' }).click();
        const opened = await links(page);
        expect(opened.some(u => u.includes('experiment') && u.includes('on'))).toBe(true);
        expect(history.offs).toEqual([]);
    });

    test('without the experiment link: the search is switched on in the research, no button', async ({ page }) => {
        await setup(page, { layerOn: true, history: { searching: false }, features: HISTORY_FEATURES.filter(f => f !== 'experiments.link') });
        await openSettings(page);
        await expect(status(page)).toHaveText("The research does not look for events. The search is switched on in the tree's research.");
        await expect(status(page).getByRole('button')).toHaveCount(0);
    });

    test('an older research without history.events: its version does not offer history, nothing read', async ({ page }) => {
        const { history } = await setup(page, { layerOn: true, features: HISTORY_FEATURES.filter(f => f !== 'history.events') });
        await openSettings(page);
        await expect(status(page)).toHaveText('This version of the research does not offer history yet. An update of the research brings it.');
        await expect(status(page).getByRole('button')).toHaveCount(0);
        expect(history.reads).toBe(0);
    });

    test.describe('the kinds of history (1028 §6)', () => {
        async function setupKinds(page: Page, features = HISTORY_R1_FEATURES): Promise<void> {
            const history = fakeHistoryR1();
            const ged = historyGed();
            await fakeBridge(page, { features, history, treeGed: ged, links: LINKS });
            await openResearch(page, { ged });
            await poll(page);
            await expect.poll(() => history.reads).toBeGreaterThan(0);
        }
        const kind = (page: Page, k: string) => page.locator(`#history-kind-${k}`);
        const kindRow = (page: Page, k: string) => page.locator(`#history-kinds .history-kind-row[data-kind="${k}"]`);
        const note = (page: Page) => page.locator('#history-kinds-note');
        const stored = (page: Page) => page.evaluate(() => {
            const s = JSON.parse(localStorage.getItem('strom-settings') ?? '{}');
            return [s.historyKindRegion, s.historyKindPlace, s.historyKindLocal];
        });

        test('three sub-options on by default; the last one on stays with its sentence; the main option mutes them', async ({ page }) => {
            await setupKinds(page);
            await openSettings(page);
            for (const k of ['region', 'place', 'local']) {
                await expect(kindRow(page, k)).toBeVisible();
                await expect(kind(page, k)).toBeChecked();
            }
            await expect(kindRow(page, 'region')).toHaveText('Regional history');
            await expect(kindRow(page, 'place')).toHaveText('Local history');
            await expect(kindRow(page, 'local')).toHaveText('From research sources');
            await expect(note(page)).toBeHidden();
            // 6b: the small switch, the row indented under the main option.
            const box = await kind(page, 'region').boundingBox();
            expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([32, 18]);

            await kindRow(page, 'region').click();
            await kindRow(page, 'place').click();
            await expect(kind(page, 'region')).not.toBeChecked();
            await expect(kind(page, 'local')).toHaveAttribute('aria-disabled', 'true');
            await expect(note(page)).toHaveText('One kind stays on. All can be turned off with the main option.');
            await kindRow(page, 'local').click({ force: true });
            await expect(kind(page, 'local')).toBeChecked();
            expect(await stored(page)).toEqual([false, false, undefined]);

            // The main option off: the sub-options muted and kept, no "History of places ›".
            await toggle(page).uncheck();
            for (const k of ['region', 'place', 'local']) {
                await expect(kindRow(page, k)).toHaveClass(/is-muted/);
                await expect(kind(page, k)).toHaveAttribute('aria-disabled', 'true');
            }
            await expect(manageLink(page)).toBeHidden();
            await expect(note(page)).toBeHidden();
            await kindRow(page, 'region').click({ force: true });
            await expect(kind(page, 'region')).not.toBeChecked();
            await toggle(page).check();
            await expect(kind(page, 'region')).not.toBeChecked();
            await expect(kind(page, 'local')).toBeChecked();
        });

        test('without history.place there is no place sub-option', async ({ page }) => {
            await setupKinds(page, HISTORY_R1_FEATURES.filter(f => f !== 'history.place'));
            await openSettings(page);
            await expect(kindRow(page, 'region')).toBeVisible();
            await expect(kindRow(page, 'local')).toBeVisible();
            await expect(kindRow(page, 'place')).toBeHidden();
        });

        test('the card: a kind switched off is not in the timeline; the legend mutes it and shows the place kind', async ({ page }) => {
            await setupKinds(page);
            const id = await page.evaluate(() =>
                (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);
            await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
            const body = page.locator('#pm-lifeline-body');
            await expect(body).toContainText('A fire in Čapkov.');
            await page.evaluate(() => { window.Strom.SettingsManager.setHistoryKind('local', false); window.Strom.UI.historyChanged(); });
            await expect(body).not.toContainText('A fire in Čapkov.');
            await expect(body).toContainText('The Austro-Hungarian Compromise.');
            await page.locator('.pm-lifeline-hinfo').click();
            const legend = page.locator('.pm-lifeline-legend');
            await expect(legend.locator('.pm-lifeline-legend-name')).toHaveText(['Regional history', 'Local history', 'From research records', 'Research tip']);
            const local = legend.locator('.pm-lifeline-legend-row', { hasText: 'From research records' });
            await expect(local).toHaveClass(/is-off/);
            await expect(local).toContainText('Off in Settings.');
            await expect(legend.locator('.pm-lifeline-legend-row.is-off')).toHaveCount(1);
        });
    });
});
