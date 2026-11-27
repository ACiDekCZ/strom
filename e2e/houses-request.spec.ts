import { test, expect, Page, Route } from '@playwright/test';
import { fakeBridge, fakePlaces, links, openResearch, poll, BRIDGE } from './research-bridge.js';

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

async function setup(page: Page, opts: { on?: boolean; features?: string[]; places?: boolean; rows?: Record<string, unknown>[] } = {}): Promise<FakeHouses> {
    await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
    const houses: FakeHouses = { rev: 'r1', rows: opts.rows ?? [row()], requests: [], on: !!opts.on };
    const bridge = await fakeBridge(page, {
        features: [...(opts.features ?? HOUSE), ...(opts.places ? ['places.identify'] : [])], links: LINKS,
        statusExtra: { houses: { on: houses.on, rev: houses.rev, counts: { done: 0, running: 0, queued: 0, waiting: 0, held: 0 } } },
        // The research's Look up of places: the place menu of a place without a location.
        ...(opts.places ? { places: fakePlaces({ reply: { rev: 'p1', places: {}, forms: {}, queue: { queued: 0, running: 0 },
            counts: { offMap: 2, placed: 0, proposed: 0, unlocated: 0 } } }) } : {}),
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

    for (const width of [1440, 1024]) {
        test(`Places at ${width} px: a family house's row keeps its text readable beside its actions`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await setup(page);
            // A long double surname and the house's name after its farm (invented): the row's text column must not shrink to a few letters.
            await page.evaluate(() => {
                const dm = window.Strom.DataManager;
                for (const p of Object.values(dm.getData().persons) as { id: string; firstName: string }[]) {
                    if (p.firstName === 'Josef' || p.firstName === 'Jan') dm.updatePerson(p.id as never, { lastName: 'Prouzal-Kvitelkovský' } as never);
                }
                dm.setHouseUserData('belokamen|16', { name: 'U Prouzalů pod Kvitelkovým vrchem' }, 'seed');
            });
            // The town chosen: its row beside the place's detail, a narrower column.
            await page.evaluate(() => window.Strom.UI.showPlacesManager('belokamen', undefined, 'tree'));
            await page.locator('#places-modal .place-houses-wrap[data-town="belokamen"] .place-houses-toggle').click();
            const r = page.locator(`#places-modal .place-houses-sub .r[data-house="${KEY}"]`);
            await expect(r.locator('.m')).toContainText('Prouzal-Kvitelkovský');
            await expect(r.locator('.house-req[data-house-act="request"]')).toBeVisible();
            const m = await r.locator('.m').boundingBox();
            expect(m!.width).toBeGreaterThanOrEqual(150);
            // The text stays on few lines (a column a few letters wide wraps it into many).
            const lines = await r.locator('.m').evaluate(el => Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 18)));
            expect(lines).toBeLessThanOrEqual(3);
        });
    }

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

    test('the place menu of an address at a house: the research\'s state in the item\'s line, also as the first view of a house', async ({ page }) => {
        await setup(page, { places: true, rows: [row({ state: 'done', at: '2027-03-12' })] });
        await page.evaluate(() => {
            const josef = Object.values(window.Strom.DataManager.getData().persons).find((p: { firstName: string }) => p.firstName === 'Josef') as { id: string };
            window.Strom.UI.showEditPersonModal(josef.id as never);
        });
        // Nothing has read the research's houses yet: the menu reads them and its line follows.
        const rowWithHouse = page.locator('#pm-lifeline-body .pm-lifeline-row', { has: page.locator(`.pm-house-link[data-house="${KEY}"]`) }).first();
        await rowWithHouse.locator('button[data-place]').first().click();
        const item = page.locator('.place-menu .place-menu-house');
        await expect(item.locator('.place-menu-house-name')).toHaveText('House history čp. 16');
        await expect(item.locator('.place-menu-house-line .hs[data-state="done"]')).toHaveCount(1);
        await expect(item.locator('.place-menu-house-line')).toHaveText('done 12 Mar 2027 · house page');
    });

    // The row's ⋯ menu (Milan 27 Nov 2026): "House page" first, then the same action as in its detail (houseActionOf), above "Attach material…".
    const menuItems = (page: Page) => page.locator('.houses-menu [role="menuitem"]');
    const actItem = (page: Page) => page.locator('.houses-menu [role="menuitem"][data-action^="act-"]');
    async function openRowMenu(page: Page, key = KEY, more = false): Promise<void> {
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        // A house without history: under the town's "More houses".
        if (more) await page.locator('#houses-modal .house-more-h').click();
        const r = page.locator(`#houses-modal .house-row[data-house="${key}"]`);
        await expect(r).toBeVisible();
        await r.locator('.house-more-btn').click();
        await expect(page.locator('.houses-menu')).toBeVisible();
    }

    test('⋯ menu, setting off: "Find the house history…" with AI and the terminal, the dialog', async ({ page }) => {
        const houses = await setup(page);
        await openRowMenu(page);
        await expect(menuItems(page)).toHaveText(['House page', /^Find the house history…/, 'Attach material…', 'Merge with another house…']);
        const ask = actItem(page);
        await expect(ask.locator('.research-ai-badge')).toHaveCount(1);
        await expect(ask.locator('.research-open-mark')).toHaveCount(1);
        await ask.click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText('History of house čp. 16, Bělokamen');
        await dialog(page).locator('#hrq-go').click();
        await expect(dialog(page)).toBeHidden();
        expect(houses.requests).toEqual([{ house: KEY }]);
        await expect.poll(() => links(page)).toHaveLength(1);
        expect((await links(page))[0]).toContain('do=search');
    });

    test('⋯ menu, setting on: "Move to the top" over the bridge, no mark, no terminal; also for a queued house', async ({ page }) => {
        const houses = await setup(page, { on: true });
        await openRowMenu(page);
        const top = actItem(page);
        await expect(top).toHaveText('Move to the top');
        await expect(top.locator('.research-ai-badge, .research-open-mark')).toHaveCount(0);
        await top.click();
        await expect(page.locator('.toast').filter({ hasText: 'House čp. 16 is at the top of the research queue.' })).toBeVisible();
        expect(houses.requests).toEqual([{ house: KEY }]);
        expect(await links(page)).toEqual([]);
        // Now queued: the menu still offers it.
        await expect(houseRow(page).locator('.house-side .hs[data-state="queued"]')).toBeVisible();
        await houseRow(page).locator('.house-more-btn').click();
        await expect(actItem(page)).toHaveText('Move to the top');
    });

    test('⋯ menu: a house done "Request again…"; being researched or waiting nothing but its own items', async ({ page }) => {
        const houses = await setup(page, { on: true, rows: [row({ state: 'done', at: '2027-03-12' })] });
        await openRowMenu(page);
        await expect(menuItems(page)).toHaveText(['House page', 'Request again…', 'Attach material…', 'Merge with another house…']);
        await actItem(page).click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('.hrq-again')).toBeVisible();
        await dialog(page).locator('[data-hrq="cancel"].secondary').click();
        await expect(dialog(page)).toBeHidden();
        for (const state of ['running', 'waiting']) {
            houses.rows = [row({ state, task: 'T0050', work: 'house' })];
            houses.rev = `r-${state}`;
            await page.evaluate(() => window.Strom.UI.closeHousesWindow(false));
            await page.evaluate(() => window.Strom.UI.loadHouseStates());
            await openRowMenu(page);
            await expect(houseRow(page).locator(`.house-side .hs[data-state="${state}"]`)).toBeVisible();
            await expect(menuItems(page)).toHaveText(['House page', 'Attach material…', 'Merge with another house…']);
            await page.keyboard.press('Escape');
        }
    });

    test('⋯ menu: any house of the tree, also one the research does not know yet (no row, not a family house)', async ({ page }) => {
        const houses = await setup(page, { on: true });
        // Anna's čp. 4: one person, no history, no row of the research.
        await openRowMenu(page, 'belokamen|4', true);
        await expect(actItem(page)).toHaveText('Move to the top');
        await actItem(page).click();
        await expect.poll(() => houses.requests).toEqual([{ house: 'belokamen|4' }]);
    });

    // spec 145 T2: the agent's chat about the house only with `house.chat` (without it missing: the tests above).
    test('⋯ menu with house.chat: "Discuss with the agent" after the action, AI and the terminal, do=chat; a house the research does not know by the tree\'s key', async ({ page }) => {
        await setup(page, { features: [...HOUSE, 'house.chat'] });
        await openRowMenu(page);
        await expect(menuItems(page)).toHaveText(['House page', /^Find the house history…/, /^Discuss with the agent/, 'Attach material…',
            'Merge with another house…']);
        const chat = page.locator('.houses-menu [role="menuitem"][data-action="chat"]');
        await expect(chat.locator('.research-ai-badge')).toHaveCount(1);
        await expect(chat.locator('.research-open-mark')).toHaveCount(1);
        await chat.click();
        await expect.poll(() => links(page)).toHaveLength(1);
        expect((await links(page))[0]).toMatch(/^strom-research[a-z0-9-]*:\/\/house\?tree=[^&]+&house=belokamen%7C16&do=chat$/);
        await page.evaluate(() => window.Strom.UI.closeHousesWindow(false));
        // Anna's čp. 4: no row of the research.
        await openRowMenu(page, 'belokamen|4', true);
        await page.locator('.houses-menu [role="menuitem"][data-action="chat"]').click();
        await expect.poll(() => links(page)).toHaveLength(2);
        expect((await links(page))[1]).toMatch(/&house=belokamen%7C4&do=chat$/);
    });

    test('the house page\'s ⋯ menu: the same action', async ({ page }) => {
        const houses = await setup(page, { on: true });
        await page.evaluate(k => window.Strom.UI.openHousePage(k), KEY);
        const win = page.locator('#house-page-modal');
        await win.locator('.pp-more').click();
        const act = win.locator('.pp-menu [data-hp-menu="act-top"]');
        await expect(act).toHaveText('Move to the top');
        await act.click();
        await expect.poll(() => houses.requests).toEqual([{ house: KEY }]);
    });

    test('the Houses window with the research\'s states: the done tag with ✓ and its day, "Researched", "Recently researched", ⋯ "House page"', async ({ page }) => {
        // čp. 16 done on 18 Mar, čp. 4 (Anna, also dying there: a house with history too) not researched.
        await setup(page, { on: true, rows: [row({ state: 'done', at: '2027-03-18' }), row({ id: 'A0002', key: 'belokamen|4', house: '4', persons: 1 })] });
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const anna = Object.values(dm.getData().persons).find((p: { firstName: string }) => p.firstName === 'Anna') as { id: string };
            dm.updatePerson(anna.id as never, { deathPlace: 'Bělokamen', deathAddress: 'čp. 4', deathDate: '1890' } as never);
        });
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        const rows = page.locator('#houses-modal .house-row');
        await expect(rows).toHaveCount(2);
        const done = houseRow(page).locator('.house-side .hs.is-done[data-state="done"]');
        await expect(done).toHaveText('✓done 18 Mar 2027');
        await expect(done.locator('.hs-ok[aria-hidden="true"]')).toHaveCount(1);
        // Sorted by number, then the latest researched first.
        const order = () => rows.evaluateAll(els => els.map(e => (e as HTMLElement).dataset.house));
        expect(await order()).toEqual(['belokamen|4', KEY]);
        const sort = page.locator('#houses-sort');
        await expect(sort.locator('option[value="researched"]')).toHaveText('Recently researched');
        await sort.selectOption('researched');
        await expect.poll(order).toEqual([KEY, 'belokamen|4']);
        // "Researched": the house done only, the count of hits.
        const chip = page.locator('#houses-researched');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveText('Researched');
        await chip.click();
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(order).toEqual([KEY]);
        await chip.click();
        await expect.poll(order).toEqual([KEY, 'belokamen|4']);
        // ⋯ starts with the house's page.
        await houseRow(page).locator('.house-more-btn').click();
        await expect(menuItems(page).first()).toHaveText('House page');
        await menuItems(page).first().click();
        await expect(page.locator('#house-page-modal #hp-title')).toHaveText('Bělokamen čp. 16');
        await expect(page.locator('#house-page-modal .hs.is-done')).toContainText('done 18 Mar 2027');
    });

    test('without the research: no "Researched", no "Recently researched"; ⋯ still has "House page"', async ({ page }) => {
        await setup(page, { features: [] });
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        await expect(houseRow(page)).toBeVisible();
        await expect(page.locator('#houses-researched')).toBeHidden();
        await expect(page.locator('#houses-sort option[value="researched"]')).toBeDisabled();
        await houseRow(page).locator('.house-more-btn').click();
        await expect(menuItems(page).first()).toHaveText('House page');
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

    // A tree followed live is read-only (1127, Milan 27 Nov 2026): Houses… stays in the tree's menu, the window opens
    // read-only (no merge, no split), and the research's action and Attach material… go over the bridge as it allows.
    test('a followed tree: Houses… in the tree\'s menu, the window read-only, the research\'s action over the bridge', async ({ page }) => {
        const houses = await setup(page, { on: true });
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            dm.setLiveTree(dm.getCurrentTreeId());
        });
        expect(await page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(true);
        await page.locator('.actions-menu-btn').click();
        await page.locator('#actions-tree-row').hover();
        const submenu = page.locator('#actions-tree-submenu');
        await expect(submenu).toBeVisible();
        await expect(submenu.locator('[data-action="places"], [data-action="surnames"], [data-action="rename"]')).toHaveCount(0);
        await submenu.locator('[data-action="houses"]').click();
        await expect(houseRow(page)).toBeVisible();
        await houseRow(page).locator('.house-more-btn').click();
        await expect(menuItems(page)).toHaveText(['House page', 'Move to the top', 'Attach material…']);
        await actItem(page).click();
        await expect(page.locator('.toast').filter({ hasText: 'House čp. 16 is at the top of the research queue.' })).toBeVisible();
        expect(houses.requests).toEqual([{ house: KEY }]);
        // The houses' own data stays as it is meanwhile (names, merges, points).
        expect(await page.evaluate(() => window.Strom.DataManager.housesReadOnly())).toBe(true);
    });
});
