import { test, expect, Page, Route } from '@playwright/test';
import { fakeBridge, openResearch, poll, BRIDGE, FakeBridge } from './research-bridge.js';

/**
 * "House history" in Research for this tree (spec 030 §6, K6.1): the row under Census records, only with the
 * research's `house.auto`. Off: the estimate of what the setting gives the agent (`/status.houses.auto` +
 * `estimate`); switching on asks first, then `POST /houses {on}` at once (dashed while on its way, no mark); on:
 * the tasks by state and "Houses ›"; switching off asks, the tasks set aside said under the row. An older research
 * without `house.auto`: no row. A fake bridge with invented data.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const FEATURES = ['house', 'house.material', 'house.auto', 'house.request', 'seal.foreign', 'disk.full'];
const COUNTS = { done: 2, running: 1, queued: 4, waiting: 0, held: 0 };
const ESTIMATE = {
    houses: 7, towns: 3, minutes: 270, usd: 11.2, measured: true, perHouse: { minutes: 30, usd: 1.2 }, perTown: { minutes: 20, usd: 0.9 },
};

interface FakeAuto {
    houses: Record<string, unknown>;
    posts: unknown[];
    replies: { status: number; body: unknown }[];
    /** Held until released: the write on its way. */
    hold?: Promise<void>;
}

function state(on: boolean, held = 0): Record<string, unknown> {
    return { on, rev: on ? 'r-on' : 'r-off', counts: { ...COUNTS, held }, auto: { houses: 7, towns: 3 }, estimate: ESTIMATE };
}

async function setup(page: Page, auto: FakeAuto, features: string[] = FEATURES): Promise<FakeBridge> {
    await page.clock.setFixedTime(new Date('2026-11-20T10:30:00Z'));
    const bridge = await fakeBridge(page, { features, links: LINKS, statusExtra: { houses: auto.houses } });
    await page.route(u => `${u.origin}${u.pathname}` === `${BRIDGE}/houses`, async (route: Route) => {
        if (route.request().method() !== 'POST') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: auto.houses.rev, houses: [] }) });
            return;
        }
        const body = JSON.parse(route.request().postData() ?? 'null') as { on: boolean };
        auto.posts.push(body);
        if (auto.hold) await auto.hold;
        const said = auto.replies.shift();
        if (said) {
            await route.fulfill({ status: said.status, contentType: 'application/json', body: JSON.stringify(said.body) });
            return;
        }
        // Written: the research's state now, also in its next status.
        auto.houses = state(body.on, body.on ? 0 : 3);
        bridge.statusExtra!.houses = auto.houses;
        await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ houses: auto.houses, head: 'a'.repeat(40), parent: 'b'.repeat(40) }),
        });
    });
    await openResearch(page);
    await poll(page);
    return bridge;
}

async function openTreeSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
    await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
}

const row = (page: Page) => page.locator('#research-houses-host');
const toggle = (page: Page) => page.locator('#research-houses-on');
const note = (page: Page) => page.locator('#research-houses-note');
const confirmDialog = (page: Page) => page.locator('#confirmation-modal');

test.describe('House history: Research for this tree', () => {
    test('off: the estimate; on after the question, dashed while on its way; then the tasks and Houses ›; no mark', { tag: '@smoke' }, async ({ page }) => {
        const auto: FakeAuto = { houses: state(false), posts: [], replies: [] };
        await setup(page, auto);
        await openTreeSettings(page);
        // In Sources, under Census records' place.
        await expect(page.locator('#research-tree-settings-modal .research-census legend')).toHaveText('Sources');
        await expect(row(page).locator('.settings-name')).toHaveText('House history');
        await expect(row(page).locator('.settings-desc')).toHaveText('The research itself processes houses of direct ancestors where the family lived for at least two generations or 30 years and the oldest record is more than 100 years old. Other houses only on request.');
        await expect(row(page).locator('#research-houses-est')).toHaveText('The task covers 7 houses in 3 towns · about 5 h of agent work (≈ 11 USD) · uses the AI subscription');
        await expect(toggle(page)).not.toBeChecked();
        // Through the bridge, no terminal: no AI badge, no terminal mark.
        await expect(row(page).locator('.research-ai-badge, .research-open-mark, svg')).toHaveCount(0);

        // Cancel writes nothing.
        await row(page).locator('label').click();
        await expect(confirmDialog(page)).toHaveClass(/active/);
        await page.locator('#confirm-cancel-btn').click();
        await expect(toggle(page)).not.toBeChecked();
        expect(auto.posts).toEqual([]);

        let release!: () => void;
        auto.hold = new Promise<void>(r => { release = r; });
        await row(page).locator('label').click();
        await expect(page.locator('#confirm-title')).toHaveText('Turn on house history?');
        await expect(page.locator('#confirm-message')).toHaveText('The task covers 7 houses in 3 towns, about 5 h of agent work (≈ 11 USD). Uses the AI subscription. Further houses are added automatically once they meet the threshold.');
        await expect(page.locator('#confirm-ok-btn')).toHaveText('Turn on');
        await page.locator('#confirm-ok-btn').click();
        await expect(toggle(page)).toBeChecked();
        await expect(row(page).locator('label[data-pend="1"]')).toHaveCount(1);
        await expect(row(page).locator('.pend-st')).toHaveText('Turning on…');
        await expect(row(page).locator('#research-houses-est')).toHaveCount(0);
        release();
        await expect.poll(() => auto.posts).toEqual([{ on: true }]);
        await expect(row(page).locator('[data-pend]')).toHaveCount(0);
        await poll(page);
        await expect(toggle(page)).toBeChecked();
        await expect(page.locator('#research-houses-st > span')).toHaveText('On · 7 houses: 2 done, 1 being researched, 4 queued');
        await expect(note(page)).toHaveCount(0);
        await page.locator('#research-houses-open').click();
        await expect(page.locator('#research-tree-settings-modal')).toHaveCount(0);
        await expect(page.locator('#houses-modal')).toBeVisible();
    });

    test('on: off after its question, the tasks set aside said under the row', async ({ page }) => {
        const auto: FakeAuto = { houses: state(true), posts: [], replies: [] };
        await setup(page, auto);
        await openTreeSettings(page);
        await expect(toggle(page)).toBeChecked();
        await expect(page.locator('#research-houses-st > span')).toHaveText('On · 7 houses: 2 done, 1 being researched, 4 queued');
        await row(page).locator('label').click();
        await expect(page.locator('#confirm-title')).toHaveText('Turn off house history?');
        await expect(page.locator('#confirm-message')).toHaveText('Waiting house tasks are postponed; finished results stay.');
        await page.locator('#confirm-ok-btn').click();
        await expect.poll(() => auto.posts).toEqual([{ on: false }]);
        await expect(toggle(page)).not.toBeChecked();
        await expect(note(page)).toHaveText('Postponed: 3 house tasks. They return when turned on.');
        await expect(page.locator('#research-houses-st')).toHaveCount(0);
        await poll(page);
        await expect(note(page)).toHaveText('Postponed: 3 house tasks. They return when turned on.');
    });

    // spec 145 T1: "Also the look of the houses" only said (switched in the research's terminal), only while on.
    test('on: the look of the houses said in one quiet line, on or off with where it changes; nothing without the field or while off', async ({ page }) => {
        const auto: FakeAuto = { houses: { ...state(true), look: true }, posts: [], replies: [] };
        const bridge = await setup(page, auto, [...FEATURES, 'house.look']);
        await openTreeSettings(page);
        const look = page.locator('#research-houses-look');
        await expect(look).toHaveText('Also the look of the houses: on');
        await expect(row(page).locator('#research-houses-look input, #research-houses-look button')).toHaveCount(0);
        const again = async (houses: Record<string, unknown>): Promise<void> => {
            bridge.statusExtra!.houses = houses;
            await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());
            await poll(page);
            await openTreeSettings(page);
            await expect(toggle(page)).toHaveCount(1);
        };
        await again({ ...state(true), look: false });
        await expect(look).toHaveText('Also the look of the houses: off – changed in the research terminal: Settings → History of the houses.');
        await again(state(true));
        await expect(look).toHaveCount(0);
        await again({ ...state(false), look: true });
        await expect(toggle(page)).not.toBeChecked();
        await expect(look).toHaveCount(0);
    });

    test('a refusal (503) says why under the row, the switch as it was; without the bridge it rests', async ({ page }) => {
        const auto: FakeAuto = { houses: state(false), posts: [], replies: [{ status: 503, body: { error: 'Busy.', code: 'research.busy' } }] };
        const bridge = await setup(page, auto);
        await openTreeSettings(page);
        await row(page).locator('label').click();
        await page.locator('#confirm-ok-btn').click();
        await expect(note(page)).toHaveText('The research is busy. It will work again shortly.');
        await expect(toggle(page)).not.toBeChecked();
        expect(auto.posts).toEqual([{ on: true }]);
        bridge.down = true;
        await poll(page);
        await openTreeSettings(page);
        await expect(toggle(page)).toBeDisabled();
        await expect(note(page)).toHaveText("The research isn't running. This can be changed once it runs.");
    });

    test('an older research without house.auto: no row, even with the houses in its status', async ({ page }) => {
        const auto: FakeAuto = { houses: state(false), posts: [], replies: [] };
        await setup(page, auto, ['house', 'house.material']);
        await openTreeSettings(page);
        await expect(page.locator('#research-tree-settings-modal .research-tree-settings')).toBeVisible();
        await expect(row(page)).toHaveCount(0);
        await expect(toggle(page)).toHaveCount(0);
    });
});
