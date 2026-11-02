import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistoryR1, fakeAlign, historyGed, openResearch, poll, links,
    HISTORY_R1_FEATURES, FAKE_KINDS, UUID, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * Kinds of history in Settings (spec 035 §1, §2, §5): the Search column beside
 * Show (the searches of regions and of places), the nine kinds of events with
 * their own Search switch, whose choice it is (this tree / the default), a
 * kind switched off at once through the bridge, a kind switched on waiting for
 * the research's terminal (with the estimate), the searches of origin switched
 * off and on, and the states: without `history.kinds` the box is as it always
 * was, without `history.align` the alignment is the research's, a research not
 * running, an archive. Invented data (fakeHistoryR1).
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment', 'history-kinds', 'history-align'];
const KINDS_FEATURES = [...HISTORY_R1_FEATURES, 'experiments.split', 'experiments.pace', 'history.kinds', 'history.align'];

async function setup(page: Page, opts: { history?: Partial<FakeHistory>; features?: string[]; kinds?: string[]; own?: boolean; width?: number } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: 800 });
    const history = fakeHistoryR1({
        split: { regions: true, places: true },
        pace: 'sometimes',
        kinds: { kinds: opts.kinds ?? [...FAKE_KINDS], own: opts.own ?? false, def: [...FAKE_KINDS] },
        align: fakeAlign(),
        ...opts.history,
    });
    const ged = historyGed();
    const bridge = await fakeBridge(page, { features: opts.features ?? KINDS_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await page.evaluate(() => { try { sessionStorage.removeItem('strom.historyKindsOpen'); } catch { /* none */ } });
    await poll(page);
    return { bridge, history };
}

const openSettings = (page: Page) => page.evaluate(() => window.Strom.UI.showSettingsDialog());
const box = (page: Page) => page.locator('#history-kinds');
const kindSwitch = (page: Page, k: string) => page.locator(`[data-search-kind="${k}"]`);
const openKinds = async (page: Page) => {
    await page.locator('#history-kinds .history-kinds-toggle').click();
    await expect(page.locator('#history-kinds-search')).toBeVisible();
};

test.describe('Kinds of history: Settings', () => {
    test('§1: the Search column, the searches of origin, the kinds and whose choice', async ({ page }) => {
        await setup(page);
        await openSettings(page);
        await expect(box(page)).toHaveClass(/has-search/);
        await expect(page.locator('.history-kinds-head')).toContainText('Show');
        await expect(page.locator('.history-kinds-head')).toContainText('Search');
        await expect(page.locator('#history-search-regions')).toHaveAttribute('data-state', 'on');
        await expect(page.locator('#history-search-places')).toHaveAttribute('data-state', 'on');
        await expect(page.locator('.history-search-pair-label')).toBeVisible();
        await expect(page.locator('#history-kinds-sum')).toHaveText('All 9 kinds searched · default choice');
        const toggle = page.locator('#history-kinds .history-kinds-toggle');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#history-kinds-search')).toHaveCount(0);
        await openKinds(page);
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.history-kind-search-row')).toHaveCount(9);
        await expect(page.locator('.history-search-switch[data-search-kind][data-state="on"]')).toHaveCount(9);
        await expect(page.locator('.history-kinds-seg [data-scope="default"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.history-kinds-seg [data-scope="tree"]')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#history-align-link')).toBeVisible();
        // Kept open for the browser tab's session.
        await page.evaluate(() => window.Strom.UI.closeSettingsDialog());
        await openSettings(page);
        await expect(page.locator('#history-kinds-search')).toBeVisible();
    });

    test('§2: a kind switched off is written at once; the sentence offers the alignment', async ({ page }) => {
        const { history } = await setup(page);
        await openSettings(page);
        await openKinds(page);
        await kindSwitch(page, 'economy').click();
        await expect(kindSwitch(page, 'economy')).toHaveAttribute('data-state', 'off');
        await expect.poll(() => history.kindsWrites).toEqual([{ kinds: FAKE_KINDS.filter(k => k !== 'economy'), scope: 'default' }]);
        const off = page.locator('.history-kinds-off');
        await expect(off).toContainText('Economy is no longer searched. Found events stay visible.');
        await expect(off.locator('[data-hk-action="align"]')).toBeVisible();
        await expect(page.locator('#history-kinds-sum')).toHaveText('8 of 9 kinds searched · not searched: economy · default choice');
        // The status agrees: still off.
        await poll(page);
        await expect(kindSwitch(page, 'economy')).toHaveAttribute('data-state', 'off');
        // A refusal takes it back with a toast.
        history.kindsReply = { status: 503, body: { error: 'busy', code: 'research.busy', text: 'busy' } };
        await kindSwitch(page, 'war').click();
        await expect(page.locator('.toast').last()).toBeVisible();
        await expect(kindSwitch(page, 'war')).toHaveAttribute('data-state', 'on');
    });

    test('§2: a kind switched on waits with the estimate, continues in the terminal and comes back by the status', async ({ page }) => {
        const { history } = await setup(page, { kinds: FAKE_KINDS.filter(k => k !== 'law' && k !== 'economy'), own: true });
        await openSettings(page);
        await openKinds(page);
        await expect(page.locator('.history-kinds-seg [data-scope="tree"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.history-kinds-scope-note')).toContainText('Applies only to the research of the tree');
        await kindSwitch(page, 'law').click();
        await expect(kindSwitch(page, 'law')).toHaveAttribute('data-state', 'pend');
        const pend = page.locator('#history-kinds-pend');
        await expect(pend.locator('.history-kinds-pend-title')).toHaveText('Turn on search:');
        await expect(pend.locator('.history-kinds-chip')).toHaveText(['law']);
        await expect(pend.locator('.history-kinds-cost')).toContainText('To be searched in 1 region and 1 place, about 2 research sessions');
        // The estimate asked with the kinds as they would be (decoded from the query).
        expect(history.align!.reads.at(-1)!.split(',')).toContain('law');
        expect(history.kindsWrites ?? []).toEqual([]);
        // Cancel: nothing written.
        await pend.locator('[data-hk-action="cancel"]').click();
        await expect(pend).toHaveCount(0);
        await expect(kindSwitch(page, 'law')).toHaveAttribute('data-state', 'off');
        // Again, and continue in the research.
        await kindSwitch(page, 'law').click();
        await pend.locator('[data-hk-action="go"]').click();
        await expect(pend).toHaveClass(/is-waiting/);
        await expect(pend.locator('.history-kinds-pend-title')).toHaveText('Waiting for confirmation in the research');
        expect(history.kindsWrites).toEqual([{ kinds: FAKE_KINDS.filter(k => k !== 'economy'), scope: 'tree' }]);
        const launched = await links(page);
        expect(launched.at(-1)).toMatch(new RegExp(`^strom-research://history-kinds\\?tree=${UUID}&scope=tree&kinds=`));
        // Locked while waiting.
        await expect(kindSwitch(page, 'economy')).toHaveAttribute('aria-disabled', 'true');
        // The terminal confirms: the status brings it.
        history.kinds!.kinds = FAKE_KINDS.filter(k => k !== 'economy');
        await poll(page);
        await expect(page.locator('.toast').last()).toContainText('Law is searched again.');
        await expect(pend).toHaveCount(0);
        await expect(kindSwitch(page, 'law')).toHaveAttribute('data-state', 'on');
    });

    test('§2: no kind searched says so', async ({ page }) => {
        await setup(page, { kinds: [], own: true });
        await openSettings(page);
        await openKinds(page);
        await expect(page.locator('.history-kinds-alloff')).toContainText('No kind is searched.');
        await expect(page.locator('.history-search-switch[data-search-kind][data-state="off"]')).toHaveCount(9);
    });

    test('§2: a search of origin switched off at once, switched on waits for the terminal', async ({ page }) => {
        const { history } = await setup(page);
        await openSettings(page);
        const regions = page.locator('#history-search-regions');
        await regions.click();
        await expect(regions).toHaveAttribute('data-state', 'off');
        expect(history.split).toEqual({ regions: false, places: true });
        await expect(page.locator('#history-origin-note')).toContainText('Regional history is no longer searched for this tree.');
        await regions.click();
        await expect(regions).toHaveAttribute('data-state', 'pend');
        await expect(page.locator('#history-origin-note')).toContainText("Regional history: turning on waits for confirmation in the research's terminal window.");
        expect((await links(page)).at(-1)).toMatch(/^strom-research:\/\/experiment\?/);
        history.split!.regions = true;
        await poll(page);
        await expect(regions).toHaveAttribute('data-state', 'on');
        await expect(page.locator('#history-origin-note')).toHaveCount(0);
    });

    test('§5: without history.kinds the box is byte for byte as before; with it and without again', async ({ page }) => {
        const { bridge } = await setup(page, { features: KINDS_FEATURES.filter(f => f !== 'history.kinds' && f !== 'history.align') });
        await openSettings(page);
        await expect(box(page)).toBeVisible();
        const before = await box(page).evaluate(n => n.outerHTML);
        expect(before).not.toContain('hk-added');
        bridge.features = KINDS_FEATURES;
        await poll(page);
        await expect(page.locator('#history-kinds .hk-added').first()).toBeAttached();
        bridge.features = KINDS_FEATURES.filter(f => f !== 'history.kinds' && f !== 'history.align');
        await poll(page);
        await expect(page.locator('#history-kinds .hk-added')).toHaveCount(0);
        expect(await box(page).evaluate(n => n.outerHTML)).toBe(before);
    });

    test('§5: without history.align the alignment is the research\'s', async ({ page }) => {
        await setup(page, { features: KINDS_FEATURES.filter(f => f !== 'history.align') });
        await openSettings(page);
        await openKinds(page);
        await expect(page.locator('#history-align-link')).toHaveCount(0);
        const none = page.locator('#history-align-none');
        await expect(none).toContainText('Aligning found history with the settings is done in the research.');
        await none.locator('[data-hk-action="open-research"]').click();
        expect((await links(page)).at(-1)).toMatch(new RegExp(`^strom-research://open\\?tree=${UUID}`));
    });

    test('§5: a research not running — the sentence, the switches disabled', async ({ page }) => {
        const { bridge } = await setup(page);
        await openSettings(page);
        await openKinds(page);
        bridge.down = true;
        await poll(page);
        await expect(box(page)).toHaveClass(/is-down/);
        await expect(page.locator('.history-kinds-down')).toHaveText("The research isn't running. This can be changed once it runs.");
        await expect(kindSwitch(page, 'war')).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('#history-search-regions')).toHaveAttribute('aria-disabled', 'true');
        const opacity = await kindSwitch(page, 'war').evaluate(n => getComputedStyle(n).opacity);
        expect(Number(opacity)).toBeCloseTo(0.45, 2);
        await kindSwitch(page, 'war').click({ force: true });
        await expect(kindSwitch(page, 'war')).toHaveAttribute('data-state', 'on');
    });

    test('§5: an archive says only that it does not search', async ({ page }) => {
        const { bridge } = await setup(page);
        bridge.statusExtra = { tree: { id: UUID, name: 'Fíškovi', state: 'archive' } };
        await poll(page);
        await openSettings(page);
        await expect(page.locator('#history-kinds-archive')).toHaveText('The research does not search here.');
        await expect(page.locator('#history-kinds .history-search-switch')).toHaveCount(0);
        await expect(page.locator('#history-kinds .history-kinds-toggle')).toHaveCount(0);
    });

    test('German at 360 px: nothing wider than the box', async ({ page }) => {
        await setup(page, { width: 360, kinds: FAKE_KINDS.filter(k => k !== 'law'), own: true });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await openSettings(page);
        await openKinds(page);
        await kindSwitch(page, 'law').click();
        await kindSwitch(page, 'economy').click();
        await expect(page.locator('#history-kinds-pend')).toBeVisible();
        await expect(page.locator('.history-kinds-off')).toBeVisible();
        const over = await page.evaluate(() => {
            const root = document.getElementById('history-kinds')!;
            const r = root.getBoundingClientRect();
            const wide: string[] = [];
            if (root.scrollWidth > root.clientWidth) wide.push(`#history-kinds ${root.scrollWidth}>${root.clientWidth}`);
            for (const n of root.querySelectorAll<HTMLElement>('*')) {
                const b = n.getBoundingClientRect();
                if (b.width && (b.right > r.right + 0.5 || b.left < r.left - 0.5)) wide.push(`${n.className || n.tagName} ${Math.round(b.left)}–${Math.round(b.right)}`);
            }
            const modal = document.querySelector<HTMLElement>('#settings-modal .modal-content') ?? document.documentElement;
            if (modal.scrollWidth > modal.clientWidth) wide.push(`modal ${modal.scrollWidth}>${modal.clientWidth}`);
            return wide;
        });
        expect(over).toEqual([]);
    });
});
