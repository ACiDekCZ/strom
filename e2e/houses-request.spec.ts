import { test, expect, Page, Route } from '@playwright/test';
import { fakeBridge, links, openResearch, poll, BRIDGE } from './research-bridge.js';

/**
 * Asking the research for a house's history (spec 030 §2, §5): with the setting off the request goes to the
 * research's terminal (`do=search`, the houses going with it in `with=`), with the setting on over the bridge
 * (the house on top of the queue); a town's "Family houses" in Places with their actions and "House page ›";
 * an event's address at a house of the tree as the link to the house; an older research (no `house.request`)
 * without any action. A fake bridge with invented data: the Fíšek family of Bělokamen čp. 16, Anna at čp. 4.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const HOUSE = ['house', 'house.material', 'house.request'];
const KEY = 'belokamen|16';

interface FakeHouses {
    rev: string;
    rows: Record<string, unknown>[];
    requests: { house?: string; with?: string[] }[];
    /** The setting on: a request answers queued (and the house is then queued); off: 403 house.link. */
    on: boolean;
}

function row(init: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'A0001', key: KEY, place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16',
        persons: 2, years: { from: 1820, to: 1880 }, state: 'none',
        summary: { events: 0, holders: 0, residents: 0, unknown: 0, materials: 0, passed: 0 }, ...init,
    };
}

async function setup(page: Page, opts: { on?: boolean; features?: string[] } = {}): Promise<FakeHouses> {
    await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
    const houses: FakeHouses = { rev: 'r1', rows: [row()], requests: [], on: !!opts.on };
    const bridge = await fakeBridge(page, {
        features: opts.features ?? HOUSE, links: LINKS,
        statusExtra: { houses: { on: houses.on, rev: houses.rev, counts: { done: 0, running: 0, queued: 0, waiting: 0, held: 0 } } },
    });
    await page.route(u => `${u.origin}${u.pathname}` === `${BRIDGE}/houses`, async (route: Route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: houses.rev, houses: houses.rows }) });
    });
    await page.route(u => `${u.origin}${u.pathname}`.startsWith(`${BRIDGE}/houses/`), async (route: Route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/houses\//, ''));
        if (route.request().method() === 'POST' && path === 'request') {
            houses.requests.push(JSON.parse(route.request().postData() ?? 'null'));
            if (!houses.on) {
                await route.fulfill({ status: 403, contentType: 'application/json',
                    body: JSON.stringify({ code: 'house.link', error: 'House history is off.', estimate: { minutes: 50, measured: false } }) });
                return;
            }
            houses.rows = [row({ state: 'queued', task: 'T0050', work: 'house' })];
            houses.rev = 'r2';
            (bridge.statusExtra!.houses as { rev: string }).rev = 'r2';
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ house: houses.rows[0], task: 'T0050', head: 'a1b2c3d4e5f6', parent: '9b8c7d6e5f40' }) });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...row(), ...houses.rows[0], numbers: [], timeline: [],
            holders: [], residents: [], maps: [], passed: [], manual: [], unknown: [], archiveOnly: [], sensitive: [], same: [], persons: [], materials: [] }) });
    });
    await openResearch(page);
    // Josef (born 1820, died 1880) and his son Jan (1850) at Bělokamen čp. 16: a house with history; Anna at čp. 4.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        for (const p of Object.values(dm.getData().persons) as { id: string; firstName: string }[]) {
            if (p.firstName === 'Josef') {
                dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820',
                    deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1880' } as never);
            }
            if (p.firstName === 'Jan') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850' } as never);
            if (p.firstName === 'Anna') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 4', birthDate: '1825' } as never);
        }
    });
    await poll(page);
    return houses;
}

const houseRow = (page: Page) => page.locator(`#houses-modal .house-row[data-house="${KEY}"]`);
const dialog = (page: Page) => page.locator('#house-request-modal');

async function openHouseDetail(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showHousesWindow());
    await expect(houseRow(page)).toBeVisible();
    await houseRow(page).locator('.house-chev').click();
    await expect(page.locator('#houses-modal .house-research')).toBeVisible();
}

test.describe('Houses: asking the research for a house\'s history', () => {
    test('setting off: the dialog, a family house going with it, the terminal\'s link with do=search and with=', async ({ page }) => {
        const houses = await setup(page);
        await openHouseDetail(page);
        const ask = page.locator('#houses-modal .house-research .house-req[data-house-act="request"]');
        await expect(ask).toContainText('Find the house history…');
        // Through the research's terminal with its agent: the AI badge and the terminal mark.
        await expect(ask.locator('.research-ai-badge')).toHaveCount(1);
        await ask.click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText('History of house čp. 16, Bělokamen');
        await expect(dialog(page).locator('#hrq-cost')).toContainText('One research session, about 50 min');
        const four = dialog(page).locator('input[data-hrq-with="belokamen|4"]');
        await expect(four).not.toBeChecked();
        await four.check();
        await dialog(page).locator('#hrq-go').click();
        await expect(dialog(page)).toBeHidden();
        expect(houses.requests).toEqual([{ house: KEY, with: ['belokamen|4'] }]);
        await expect.poll(() => links(page)).toHaveLength(1);
        const link = (await links(page))[0];
        expect(link).toContain('do=search');
        expect(link).toMatch(/with=belokamen(%7C|\|)4/);
        expect(link).toMatch(/house=belokamen(%7C|\|)16/);
    });

    test('setting on: "Move to the top" over the bridge, no terminal; the house then queued', async ({ page }) => {
        const houses = await setup(page, { on: true });
        await openHouseDetail(page);
        const top = page.locator('#houses-modal .house-research .house-req[data-house-act="top"]');
        await expect(top).toHaveText('Move to the top');
        await expect(top.locator('.research-ai-badge')).toHaveCount(0);
        await top.click();
        await expect(page.locator('.toast').filter({ hasText: 'House čp. 16 is at the top of the research queue.' })).toBeVisible();
        expect(houses.requests).toEqual([{ house: KEY }]);
        expect(await links(page)).toEqual([]);
        await expect(houseRow(page).locator('.house-side .hs[data-state="queued"]')).toBeVisible();
    });

    test('Places: the town\'s "Family houses", its houses opened with their action and "House page ›"', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        const wrap = page.locator('#places-modal .place-houses-wrap[data-town="belokamen"]');
        await expect(wrap.locator('.place-houses')).toContainText('Family houses');
        await expect(wrap.locator('.place-houses')).toContainText('1 house with history');
        const toggle = wrap.locator('.place-houses-toggle');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        const r = page.locator(`#places-modal .place-houses-sub .r[data-house="${KEY}"]`);
        await expect(r).toBeVisible();
        await expect(r.locator('b')).toHaveText('čp. 16');
        await expect(r.locator('.house-req[data-house-act="request"]')).toBeVisible();
        // Anna's čp. 4 is not a family house (one person, no history).
        await expect(page.locator('#places-modal .place-houses-sub .r')).toHaveCount(1);
        // The house's page (spec 030 §3) over Places, which comes back when it closes.
        await r.locator('.place-house-page').click();
        await expect(page.locator('#house-page-modal #hp-title')).toHaveText('Bělokamen čp. 16');
        await expect(page.locator('#places-modal')).not.toHaveClass(/active/);
        await page.locator('#house-page-modal .pp-close').click();
        await expect(page.locator('#house-page-modal')).toHaveCount(0);
        await expect(page.locator('#places-modal')).toHaveClass(/active/);
    });

    test('the person card: an address at a house of the tree opens the house', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const josef = Object.values(window.Strom.DataManager.getData().persons).find((p: { firstName: string }) => p.firstName === 'Josef') as { id: string };
            window.Strom.UI.showEditPersonModal(josef.id as never);
        });
        const link = page.locator(`#pm-lifeline-body .pm-house-link[data-house="${KEY}"]`).first();
        await expect(link).toHaveText('čp. 16');
        await link.click();
        await expect(page.locator('#house-page-modal #hp-title')).toHaveText('Bělokamen čp. 16');
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
    });

    test('an older research without house.request: no action anywhere, the house page still there', async ({ page }) => {
        await setup(page, { features: ['house', 'house.material'] });
        await openHouseDetail(page);
        await expect(page.locator('#houses-modal .house-req')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeHousesWindow(false));
        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        await page.locator('#places-modal .place-houses-wrap[data-town="belokamen"] .place-houses-toggle').click();
        const r = page.locator(`#places-modal .place-houses-sub .r[data-house="${KEY}"]`);
        await expect(r.locator('.place-house-page')).toBeVisible();
        await expect(r.locator('.house-req')).toHaveCount(0);
    });
});
