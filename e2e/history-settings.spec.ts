import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';
import {
    fakeBridge, fakeHistory, historyGed, openResearch, poll, links,
    HISTORY_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * History in the life timeline (spec 020, experiment) — Settings' section
 * "Experimental features": the toggle (on by default; a user's "off" stays), its
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
const hiddenLink = (page: Page) => page.locator('#history-hidden-link');

test.describe('History in the life timeline: Settings', () => {
    test('on by default: the toggle is checked and the events are read', async ({ page }) => {
        const { history } = await setup(page);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').historyLayer)).toBeUndefined();
        await openSettings(page);
        await expect(page.locator('#settings-experiments')).toBeVisible();
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
        await expect(hiddenLink(page)).toBeHidden();
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
        await expect(hiddenLink(page)).toHaveText('Hidden events (1)');
        expect(history.reads).toBe(1);
        // The same rev: not read again.
        await poll(page);
        await expect(status(page)).toContainText('The research looks for events.');
        expect(history.reads).toBe(1);
        // The card API: Jan (Čáslav 1860–1910) gets the war of 1866; the crash stays hidden.
        const view = await page.evaluate(() => {
            const jan = (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!;
            const v = window.Strom.UI.historyForPerson(jan.id);
            return v && { chipOn: v.chipOn, items: v.history?.items.map(i => i.ev.id), hidden: v.history?.hidden.map(i => i.ev.id) };
        });
        expect(view).toEqual({ chipOn: true, items: ['E1'], hidden: ['E2'] });
    });

    test('hidden list: "Show again" goes to the research; back returns to Settings', async ({ page }) => {
        const { history } = await setup(page, { layerOn: true });
        await openSettings(page);
        await expect(hiddenLink(page)).toHaveText('Hidden events (1)');
        await hiddenLink(page).click();
        const modal = page.locator('#history-hidden-modal');
        await expect(modal).toBeVisible();
        await expect(page.locator('#settings-modal')).toBeHidden();
        await expect(page.locator('#history-hidden-subtitle')).toHaveText('Fíškovi · 1 event');
        const item = modal.locator('.history-hidden-item');
        await expect(item).toHaveCount(1);
        await expect(item).toContainText('Vienna stock exchange crash.');
        await expect(item.locator('.history-hidden-scope')).toHaveText('for Čáslav');
        await item.locator('.history-hidden-restore').click();
        await expect(modal.locator('.history-hidden-empty')).toHaveText('No hidden events.');
        await expect.poll(() => history.hides).toEqual([{ event: 'E2', place: 'Čáslav', do: 'show' }]);
        await modal.locator('.history-hidden-back').click();
        await expect(modal).toBeHidden();
        await expect(page.locator('#settings-modal')).toBeVisible();
        await expect(hiddenLink(page)).toBeHidden();
    });

    test('a hiding from the card waits in the browser while the bridge refuses, then goes', async ({ page }) => {
        const { history } = await setup(page, { layerOn: true, history: { hideReply: { status: 503, body: { error: 'busy', code: 'research.busy' } } } });
        await openSettings(page);
        await expect(hiddenLink(page)).toHaveText('Hidden events (1)');
        await page.evaluate(() => {
            const ui = window.Strom.UI;
            const jan = (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!;
            const item = ui.historyForPerson(jan.id)!.history!.items[0];
            ui.hideHistoryItem(jan.id, item, 'person');
        });
        await expect(hiddenLink(page)).toHaveText('Hidden events (2)');
        await expect.poll(() => history.hides.length).toBe(1);
        await hiddenLink(page).click();
        await expect(page.locator('#history-hidden-modal .history-hidden-scope').filter({ hasText: 'so far only in this browser' })).toHaveCount(1);
        await page.locator('#history-hidden-modal .history-hidden-back').click();
        history.hideReply = undefined;
        await poll(page);
        await expect.poll(() => history.hides.length).toBe(2);
        expect(history.hides[1]).toEqual({ event: 'E1', person: 'P0003' });
        await expect(hiddenLink(page)).toHaveText('Hidden events (2)');
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
        await expect(status(page)).toHaveText("The research does not look for events. Turn on the search in the research The search can also be switched on in the research's Settings.");
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
});
