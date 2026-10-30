import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistory, historyGed, openResearch, poll, links,
    HISTORY_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * The person card's line "the research does not look for history yet"
 * (spec 020 K1.6): a tree tied to its research, the bridge running and the
 * search off there → the timeline's last row says so with "Turn on the
 * search in the research" (the experiment link, as in Settings) and ×.
 * Closed, it does not come back in this browser. Invented data.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];
const SENTENCE = "The research does not look for the history of the ancestors' places yet.";

/** No events yet and the search off: the card shows no layer. */
function notSearching(): FakeHistory {
    return fakeHistory({
        searching: false,
        payload: { state: { on: false, search: 'none' }, lang: 'cs', events: [], places: {}, hidden: [] },
    });
}

async function setup(page: Page, opts: { features?: string[]; width?: number } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: 844 });
    const history = notSearching();
    const ged = historyGed();
    const bridge = await fakeBridge(page, {
        features: opts.features ?? HISTORY_FEATURES, history, treeGed: ged, links: LINKS,
    });
    await openResearch(page, { ged });
    await poll(page);
    return { bridge, history };
}

const idOf = (page: Page, first: string) => page.evaluate((first) =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);

async function openCard(page: Page, first = 'Jan'): Promise<void> {
    const id = await idOf(page, first);
    await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
    await expect(page.locator('#pm-lifeline-section')).toBeVisible();
}

const strip = (page: Page) => page.locator('#pm-lifeline-body [data-history-strip]');
const enable = (page: Page) => strip(page).getByRole('button', { name: 'Turn on the search in the research' });
const close = (page: Page) => strip(page).getByRole('button', { name: 'Close this note' });

test.describe('History in the card: "not searched yet" with the link to switch it on', () => {
    test('the line with its link (the experiment link, nothing written through the bridge)', { tag: '@smoke' }, async ({ page }) => {
        const { history } = await setup(page);
        await openCard(page);
        await expect(strip(page)).toHaveCount(1);
        await expect(strip(page).locator('.pm-lifeline-desc')).toHaveText(`${SENTENCE} Turn on the search in the research, opens in the research`);
        // The last row of the timeline, no chip of the layer.
        await expect(page.locator('#pm-lifeline-body > :last-child')).toHaveAttribute('data-history-strip', '');
        await enable(page).click();
        const opened = await links(page);
        expect(opened.some(u => u.includes('experiment') && u.includes('do=on'))).toBe(true);
        expect(history.offs).toEqual([]);
        // The line stays until the research says it searches; then the layer speaks instead.
        await expect(strip(page)).toHaveCount(1);
        history.searching = true;
        await poll(page);
        await expect(strip(page)).toHaveCount(0);
    });

    test('closed: it goes at once, is remembered in this browser and does not come back after a reload', async ({ page }) => {
        await setup(page);
        await openCard(page);
        await close(page).click();
        await expect(strip(page)).toHaveCount(0);
        await expect(page.locator('#pm-lifeline-head')).toBeFocused();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').historyStripClosed)).toBe(true);
        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);
        await poll(page);
        await openCard(page);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row').first()).toBeVisible();
        await expect(strip(page)).toHaveCount(0);
        // Settings keeps the way to switch it on.
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#history-setting-status').getByRole('button', { name: 'Turn on the search in the research' })).toBeVisible();
    });

    test('nothing with the layer off or for a followed (read-only) tree', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.SettingsManager.setHistoryLayer(false));
        await openCard(page);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row').first()).toBeVisible();
        await expect(strip(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.forceCloseModal());
        await page.evaluate(() => window.Strom.SettingsManager.setHistoryLayer(true));
        // A followed tree is read-only: nothing to offer there.
        await page.evaluate(() => window.Strom.DataManager.setLiveTree(window.Strom.DataManager.getCurrentTreeId()));
        await openCard(page);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row').first()).toBeVisible();
        await expect(strip(page)).toHaveCount(0);
    });

    test('an older research (no history.events): nothing', async ({ page }) => {
        await setup(page, { features: HISTORY_FEATURES.filter(f => f !== 'history.events') });
        await openCard(page);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row').first()).toBeVisible();
        await expect(strip(page)).toHaveCount(0);
    });

    test('the research not saying whether it searches: nothing', async ({ page }) => {
        await setup(page, { features: HISTORY_FEATURES.filter(f => f !== 'experiments') });
        await openCard(page);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row').first()).toBeVisible();
        await expect(strip(page)).toHaveCount(0);
    });

    test('without the experiment link (the research elsewhere): nothing', async ({ page }) => {
        await setup(page, { features: HISTORY_FEATURES.filter(f => f !== 'experiments.link') });
        await openCard(page);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row').first()).toBeVisible();
        await expect(strip(page)).toHaveCount(0);
    });

    test('phone (390 px): one line, the short sentence ellipsized when needed and the short link whole', async ({ page }) => {
        await setup(page, { width: 390 });
        await openCard(page);
        await expect(strip(page)).toHaveClass(/is-find-one/);
        await expect(strip(page).locator('.pm-lifeline-hfind-text')).toHaveText('History not searched yet.');
        await expect(strip(page).getByRole('button', { name: 'Turn on' })).toBeVisible();
        const fit = await strip(page).evaluate(row => {
            const desc = row.querySelector('.pm-lifeline-desc')!;
            const text = desc.querySelector('.pm-lifeline-hfind-text') as HTMLElement;
            const link = desc.querySelector('button')!;
            const x = row.querySelector('.pm-lifeline-hstrip-close')!.getBoundingClientRect();
            const l = link.getBoundingClientRect();
            return {
                oneLine: Math.abs(l.top - text.getBoundingClientRect().top) < 14,
                ellipsis: getComputedStyle(text).textOverflow === 'ellipsis',
                linkWhole: link.scrollWidth <= link.clientWidth + 1,
                clear: l.right <= x.left + 1,
                noScroll: document.documentElement.scrollWidth <= window.innerWidth,
            };
        });
        expect(fit).toEqual({ oneLine: true, ellipsis: true, linkWhole: true, clear: true, noScroll: true });
    });
});
