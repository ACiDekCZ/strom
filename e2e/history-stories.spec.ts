import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistoryR1, historyGed, openResearch, poll, links,
    HISTORY_R1_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * "History in stories" (work 1028 §7): Research for this tree → Stories, its
 * last row; only with `stories.history`; the switch follows
 * `/status.stories.history`; off and on through `POST /stories`; a refusal
 * with the research's link opens it, without the bridge the switch rests.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];

async function setup(page: Page, opts: { history?: Partial<FakeHistory>; features?: string[] } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    const history = fakeHistoryR1(opts.history);
    const ged = historyGed();
    const bridge = await fakeBridge(page, { features: opts.features ?? HISTORY_R1_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await poll(page);
    return { bridge, history };
}

async function openTreeSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
    await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
}

const section = (page: Page) => page.locator('#research-tree-settings-modal .research-stories');
const toggle = (page: Page) => page.locator('#research-stories-history');
const note = (page: Page) => page.locator('#research-stories-note');

test.describe('History in stories: Research for this tree', () => {
    test('on as the research says; off goes to the research at once', { tag: '@smoke' }, async ({ page }) => {
        const { history } = await setup(page, { history: { stories: true } });
        await openTreeSettings(page);
        await expect(section(page).locator('legend')).toHaveText('Stories');
        await expect(section(page)).toContainText('History in stories');
        await expect(section(page)).toContainText('The research may use the history of places as a source when writing stories; finished stories are not rewritten for it.');
        await expect(toggle(page)).toBeChecked();
        await section(page).locator('label').click();
        await expect.poll(() => history.writes.stories).toEqual([{ history: false }]);
        await expect(toggle(page)).not.toBeChecked();
        await poll(page);
        await expect(toggle(page)).not.toBeChecked();
        await expect(toggle(page)).toBeEnabled();
    });

    test('on while the research does not look for history: its link opens it, the switch waits for the research', async ({ page }) => {
        const { history } = await setup(page, { history: { stories: false, searching: false } });
        await openTreeSettings(page);
        await expect(toggle(page)).not.toBeChecked();
        await section(page).locator('label').click();
        await expect.poll(() => history.writes.stories).toEqual([{ history: true }]);
        await expect(note(page)).toHaveText('Opening the research…');
        await expect(toggle(page)).not.toBeChecked();
        expect((await links(page)).some(u => u.includes('experiment') && u.includes('do=on'))).toBe(true);
    });

    test('busy: the sentence under the row, the switch as it was', async ({ page }) => {
        const { history } = await setup(page, { history: { stories: false } });
        history.writeReply = { stories: { status: 503, body: { error: 'Busy.', code: 'research.busy', text: 'Busy.' } } };
        await openTreeSettings(page);
        await section(page).locator('label').click();
        await expect(note(page)).toHaveText('The research is busy. It will work again shortly.');
        await expect(toggle(page)).not.toBeChecked();
    });

    test('without the bridge the switch rests with the sentence', async ({ page }) => {
        const { bridge } = await setup(page, { history: { stories: true } });
        bridge.down = true;
        await poll(page);
        await openTreeSettings(page);
        await expect(toggle(page)).toBeDisabled();
        await expect(note(page)).toHaveText("The research isn't running. This can be changed once it runs.");
    });

    test('a research without stories.history: no row', async ({ page }) => {
        await setup(page, { features: HISTORY_R1_FEATURES.filter(f => f !== 'stories.history') });
        await openTreeSettings(page);
        await expect(page.locator('#research-tree-settings-modal .research-tree-settings')).toBeVisible();
        await expect(section(page)).toHaveCount(0);
    });
});
