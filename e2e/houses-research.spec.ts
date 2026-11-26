import { test, expect, Page, Route } from '@playwright/test';
import { fakeBridge, openResearch, poll, BRIDGE, FakeBridge } from './research-bridge.js';

/**
 * The research's houses in the Houses window (spec 030 §2 K7.5, §7): the state of a house the research lists in
 * its row, in the open row's detail and summed up at its town in Places; refreshed when `/status.houses.rev`
 * changes; a waiting question's "Answer" opens it as an item of "Awaiting action". Without `house` in
 * `/status.features` nothing of the research is drawn. A fake bridge with invented data: the Fíšek family of
 * Bělokamen čp. 16.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const HOUSE = ['house', 'house.material', 'house.import'];
const KEY = 'belokamen|16';

interface FakeHouses {
    rev: string;
    rows: Record<string, unknown>[];
    lists: number;
}

function row(init: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'A0001', key: KEY, place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16',
        persons: 2, years: { from: 1820, to: 1850 }, state: 'running', task: 'T0040', work: 'house',
        summary: { events: 0, holders: 0, residents: 0, unknown: 0, materials: 0, passed: 0 }, ...init,
    };
}

async function setup(page: Page, opts: { features?: string[]; houses?: FakeHouses } = {}): Promise<{ bridge: FakeBridge; houses: FakeHouses }> {
    await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
    const houses = opts.houses ?? { rev: 'r1', rows: [row()], lists: 0 };
    const bridge = await fakeBridge(page, {
        features: opts.features ?? HOUSE, links: LINKS,
        statusExtra: { houses: { on: true, rev: houses.rev, counts: { done: 0, running: 1, queued: 0, waiting: 0, held: 0 } } },
        waiting: [{ id: 'T0042', what: 'Which house is čp. 16 after the renumbering?', on: 'user', at: '2027-03-19T09:00:00Z' }],
    });
    await page.route(u => `${u.origin}${u.pathname}` === `${BRIDGE}/houses`, async (route: Route) => {
        houses.lists++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: houses.rev, houses: houses.rows }) });
    });
    await openResearch(page);
    // Josef and his son Jan born in Bělokamen čp. 16: a house of two generations.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        for (const p of Object.values(dm.getData().persons) as { id: string; firstName: string }[]) {
            if (p.firstName === 'Josef') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820' } as never);
            if (p.firstName === 'Jan') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850' } as never);
        }
    });
    await poll(page);
    return { bridge, houses };
}

/** A new state of the research's houses: a new rev in `/status.houses`, then a poll. */
async function changeHouses(page: Page, bridge: FakeBridge, houses: FakeHouses, rows: Record<string, unknown>[], rev: string): Promise<void> {
    houses.rows = rows;
    houses.rev = rev;
    (bridge.statusExtra!.houses as { rev: string }).rev = rev;
    await poll(page);
}

async function openHouses(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showHousesWindow());
    await expect(page.locator('#houses-modal')).toBeVisible();
}

const houseRow = (page: Page) => page.locator(`#houses-modal .house-row[data-house="${KEY}"]`);
const side = (page: Page) => houseRow(page).locator('.house-side');

test.describe('Houses: the research\'s state', () => {
    test('the row shows the state; a new rev redraws it; waiting → "Answer" opens the question in the overview', { tag: '@smoke' }, async ({ page }) => {
        const { bridge, houses } = await setup(page);
        await openHouses(page);
        await expect(side(page).locator('.hs[data-state="running"]')).toHaveText('being researched');
        await expect(side(page).locator('.hs-pulse')).toHaveCount(1);
        // The same rev again: the list is not read again.
        const lists = houses.lists;
        await poll(page);
        expect(houses.lists).toBe(lists);

        await changeHouses(page, bridge, houses, [row({ state: 'done', at: '2027-03-12' })], 'r2');
        await expect(side(page).locator('.hs[data-state="done"]')).toHaveText('done 12 Mar 2027');

        await changeHouses(page, bridge, houses, [row({ state: 'queued', work: 'takeover' })], 'r3');
        await expect(side(page).locator('.hs[data-state="takeover"]')).toHaveText('own research waiting to be taken over');
        await expect(side(page).locator('.hs-note')).toHaveText('the agent takes it over in its next session');

        await changeHouses(page, bridge, houses, [row({ state: 'waiting', question: { id: 'T0042', text: 'Which house is čp. 16 after the renumbering?' } })], 'r4');
        await expect(side(page).locator('.hs.is-wait')).toHaveText('waiting for an answer');
        const answer = side(page).locator('button.house-answer');
        await expect(answer).toHaveText('Answer');
        // Through the app, no terminal: no mark.
        await expect(side(page).locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        // The open row's detail says the same.
        await houseRow(page).locator('.house-chev').click();
        await expect(page.locator('#houses-modal .house-detail .house-research .hs.is-wait')).toHaveText('waiting for an answer');
        await answer.click();
        await expect(page.locator('#houses-modal')).toHaveCount(0);
        await expect(page.locator('#research-overview')).toBeVisible();
        await expect(page.locator('#research-overview .research-overview__waiting-item[data-id="T0042"]')).toBeVisible();
    });

    test('a house the research does not list shows nothing; "none" shows "not researched"', async ({ page }) => {
        const { bridge, houses } = await setup(page, { houses: { rev: 'r1', rows: [], lists: 0 } });
        await openHouses(page);
        await expect(houseRow(page)).toBeVisible();
        await expect(houseRow(page).locator('.house-side')).toHaveCount(0);
        // A material only, not researched yet.
        await changeHouses(page, bridge, houses, [row({ state: 'none', task: undefined, work: undefined })], 'r2');
        await expect(side(page).locator('.hs.is-text[data-state="none"]')).toHaveText('not researched');
    });

    test('Places: the town\'s houses per state beside "Houses in this town ›"', async ({ page }) => {
        const { bridge, houses } = await setup(page);
        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        const line = page.locator('#places-modal .place-town-house-states[data-town="belokamen"]');
        await expect(line).toHaveText('1 being researched');
        await changeHouses(page, bridge, houses, [row({ state: 'done', at: '2027-03-12' })], 'r2');
        await expect(line).toHaveText('1 done');
    });

    test('without the feature house: no state, no column, no request for the list', async ({ page }) => {
        const { houses } = await setup(page, { features: ['census'] });
        await openHouses(page);
        await expect(houseRow(page)).toBeVisible();
        await expect(page.locator('#houses-modal .house-side, #houses-modal .hs')).toHaveCount(0);
        await houseRow(page).locator('.house-chev').click();
        await expect(page.locator('#houses-modal .house-research')).toHaveCount(0);
        expect(houses.lists).toBe(0);
        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        await expect(page.locator('#places-modal .place-town-houses[data-town="Bělokamen"]')).toBeVisible();
        await expect(page.locator('#places-modal .place-town-house-states')).toHaveCount(0);
    });
});
