import { test, expect, Page, Route, Locator } from '@playwright/test';
import { openApp, seedTree, SeedPerson } from './helpers.js';
import { fakeBridge, openResearch, poll, BRIDGE } from './research-bridge.js';

/**
 * Houses across the app (spec 030 §14, §15): the research's work on houses in the overview's queue (a house's
 * task with "House page ›", a town's frame with "Houses in this town ›", a takeover) and in Awaiting action
 * (a question of a house with the tag Houses and "House čp. 4 ›"); the Table's House column (a link to the
 * house's page, sorted by town and number, the column's text filter); the lists' rule "Lived in the house"
 * with its preview; the Statistics' topic Houses; the toolbar's search with the group Houses and "House ›"
 * on a person found by a house number.
 *
 * Invented villages: Bělokamen čp. 16 (numbered 9 before a renumbering, joined by hand) where Dobromil
 * Kvitelka married in, čp. 7 of the Trnovec family, čp. 40; Hvozdnice čp. 3, čp. 5 and Kopřivná 12. The
 * research's tree: the Fíšek family of Bělokamen čp. 16, Anna at čp. 4, Jan dying at čp. 21.
 */

const PEOPLE: Record<string, SeedPerson> = {
    svatobor: { firstName: 'Svatobor', lastName: 'Prouzal', birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1820', partners: ['radegunda'] },
    radegunda: {
        firstName: 'Radegunda', lastName: 'Prouzalová', gender: 'female', birthPlace: 'Mlýnkovice', birthDate: '1824',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1890', partners: ['svatobor'],
    },
    hostivit: {
        firstName: 'Hostivít', lastName: 'Prouzal', birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1848',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1910', parents: ['svatobor', 'radegunda'],
    },
    dobroslava: {
        firstName: 'Dobroslava', lastName: 'Prouzalová', gender: 'female', birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1850',
        deathDate: '1920', parents: ['svatobor', 'radegunda'], partners: ['dobromil'],
    },
    dobromil: {
        firstName: 'Dobromil', lastName: 'Kvitelka', birthPlace: 'Mlýnkovice', birthDate: '1847',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1915', partners: ['dobroslava'],
    },
    radhost: {
        firstName: 'Radhost', lastName: 'Kvitelka', birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1875', deathDate: '1940',
        parents: ['dobroslava', 'dobromil'],
        events: [{ id: 'e-radhost-res', type: 'residence', place: 'Hvozdnice', address: 'čp. 5', date: '1900' }],
    },
    lubomir: { firstName: 'Lubomír', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1830', deathDate: '1890' },
    kresomysl: {
        firstName: 'Křesomysl', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1862', deathDate: '1930',
        parents: ['lubomir'],
    },
    hroznata: { firstName: 'Hroznata', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 40', birthDate: '1900', deathDate: '1970' },
    kapradin: {
        firstName: 'Kapradin', lastName: 'Kvitelka', birthPlace: 'Hvozdnice', birthAddress: 'čp. 3', birthDate: '1840', deathDate: '1900',
        events: [{ id: 'e-kapradin-res', type: 'residence', place: 'Hvozdnice', address: 'Kopřivná 12', date: '1880' }],
    },
    lubomira: {
        firstName: 'Lubomíra', lastName: 'Kvitelková', gender: 'female', birthPlace: 'Hvozdnice', birthAddress: 'čp. 3', birthDate: '1871',
        deathDate: '1950', parents: ['kapradin'],
    },
};

/** The villages, with čp. 9 joined into čp. 16 (a renumbering). */
async function seedVillages(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
    await openApp(page);
    await seedTree(page, PEOPLE, 'Prouzal', 'hostivit');
    await page.evaluate(async () => {
        const S = window.Strom;
        S.DataManager.setHouseUserData('belokamen|16' as never, { name: 'U Prouzalů', merged: ['belokamen|9' as never] }, 'čp. 16');
        await S.TreeManager.flush();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
    });
}

const housePage = (page: Page): Locator => page.locator('#house-page-modal');

/** The house's page is open on a house (its title). */
async function onHousePage(page: Page, title: string): Promise<void> {
    await expect(housePage(page)).toBeVisible();
    await expect(housePage(page).locator('h1.pp-name')).toHaveText(title);
}

// ---------------------------------------------------------------------------------------------------------------
// The research's work on houses (spec 030 §14)
// ---------------------------------------------------------------------------------------------------------------

function researchRow(key: string, house: string, init: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: `A${house.padStart(4, '0')}`, key, place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house,
        persons: 2, years: { from: 1820, to: 1880 }, state: 'none',
        summary: { events: 0, holders: 0, residents: 0, unknown: 0, materials: 0, passed: 0 }, ...init,
    };
}

const QUESTION = 'Which house is čp. 4 after the renumbering?';

/**
 * A research with house history: čp. 16 queued (its own task), čp. 21 queued as a takeover of an own
 * research, čp. 7 the town's frame (a task without a house), čp. 4 waiting for an answer.
 */
async function researchWithHouses(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
    const rows = [
        researchRow('belokamen|16', '16', { state: 'queued', task: 'T0050', work: 'house' }),
        researchRow('belokamen|21', '21', { state: 'queued', task: 'T0052', work: 'takeover' }),
        researchRow('belokamen|7', '7', { state: 'queued', task: 'T0051', work: 'town' }),
        researchRow('belokamen|4', '4', { state: 'waiting', task: 'T0042', question: { id: 'T0042', text: QUESTION } }),
    ];
    await fakeBridge(page, {
        features: ['house', 'house.material', 'house.request'], links: ['send', 'open', 'live', 'app', 'setup'],
        statusExtra: {
            houses: { on: true, rev: 'r1', counts: { done: 0, running: 0, queued: 3, waiting: 1, held: 0 } },
            queue: [
                { id: 'T0050', text: 'Dějiny domu belokamen|16', state: 'next', taskKind: 'house', house: 'belokamen|16' },
                { id: 'T0051', text: 'Kostra obce T0051', state: 'next', taskKind: 'house' },
                { id: 'T0052', text: 'Převzetí belokamen|21', state: 'next', taskKind: 'house', house: 'belokamen|21' },
                { id: 'T0060', text: 'Matriky Smrkov', state: 'next', taskKind: 'records' },
            ],
        },
        waiting: [{ id: 'T0042', what: QUESTION, on: 'user', at: '2027-03-19T09:00:00Z' }],
    });
    await page.route(u => `${u.origin}${u.pathname}` === `${BRIDGE}/houses`, async (route: Route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: 'r1', houses: rows }) });
    });
    await page.route(u => `${u.origin}${u.pathname}`.startsWith(`${BRIDGE}/houses/`), async (route: Route) => {
        const key = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/houses\//, ''));
        const r = rows.find(x => x.key === key) ?? rows[0];
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...r, numbers: [], timeline: [],
            holders: [], residents: [], maps: [], passed: [], manual: [], unknown: [], archiveOnly: [], sensitive: [], same: [], persons: [], materials: [] }) });
    });
    await openResearch(page);
    // Josef and his son Jan born at čp. 16, Jan died at čp. 21; Anna born at čp. 4; the Trnovec farm čp. 7 is not in this tree.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        for (const p of Object.values(dm.getData().persons) as { id: string; firstName: string }[]) {
            if (p.firstName === 'Josef') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820' } as never);
            if (p.firstName === 'Jan') {
                dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850',
                    deathPlace: 'Bělokamen', deathAddress: 'čp. 21', deathDate: '1910' } as never);
            }
            if (p.firstName === 'Anna') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 4', birthDate: '1825' } as never);
        }
    });
    await poll(page);
}

const overview = (page: Page): Locator => page.locator('#research-overview');
const queueRow = (page: Page, task: string): Locator => overview(page).locator(`#ov-sec-queue .live-queue-row[data-task="${task}"]`);

async function unfoldQueue(page: Page): Promise<void> {
    const head = overview(page).locator('.live-section__head[aria-controls="ov-sec-queue"]');
    await expect(head).toBeVisible();
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
}

test.describe('Houses: the research\'s queue and Awaiting action (§14)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a house\'s task, a takeover and a town\'s frame in the queue, each with the tag Houses and its link', async ({ page }) => {
        await researchWithHouses(page);
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        await expect(overview(page)).toBeVisible();
        await unfoldQueue(page);

        const own = queueRow(page, 'T0050');
        await expect(own.locator('.live-queue-text')).toContainText('House history čp. 16, Bělokamen');
        await expect(own.locator('.live-queue-kind[data-kind="house"]')).toHaveText('Houses');
        await expect(own.locator('.live-queue-house')).toHaveText('House page ›');
        // Stays in the app: no mark of the research's terminal.
        await expect(own.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);

        const frame = queueRow(page, 'T0051');
        await expect(frame.locator('.live-queue-text')).toContainText('Town skeleton Bělokamen for houses');
        await expect(frame.locator('.live-queue-kind[data-kind="house"]')).toHaveText('Houses');
        await expect(frame.locator('.live-queue-house')).toHaveText('Houses in this town ›');

        const takeover = queueRow(page, 'T0052');
        await expect(takeover.locator('.live-queue-text')).toContainText('Take over research for house čp. 21');
        await expect(takeover.locator('.live-queue-house')).toHaveText('House page ›');

        // Another kind of work keeps the research's own text and no house's link.
        await expect(queueRow(page, 'T0060').locator('.live-queue-text')).toContainText('Matriky Smrkov');
        await expect(queueRow(page, 'T0060').locator('.live-queue-house')).toHaveCount(0);

        await own.locator('.live-queue-house').click();
        await onHousePage(page, 'Bělokamen čp. 16');
        await page.keyboard.press('Escape');
        await expect(housePage(page)).toHaveCount(0);

        await expect(frame.locator('.live-queue-house')).toBeVisible();
        await frame.locator('.live-queue-house').click();
        await expect(page.locator('#houses-modal')).toBeVisible();
        await expect(page.locator('#houses-modal .house-town[data-town="belokamen"]')).toBeVisible();
    });

    test('a question of a house in Awaiting action: the tag Houses, in its detail "House čp. 4 ›" to its page', async ({ page }) => {
        await researchWithHouses(page);
        await page.evaluate(() => window.Strom.UI.openResearchOverview({ showWaiting: true }));
        const item = overview(page).locator('.research-overview__waiting-item[data-id="T0042"]');
        await expect(item).toBeVisible();
        await expect(item.locator('.live-kind--house')).toHaveText('Houses');
        await expect(item.locator('.live-kind--house')).toHaveAttribute('data-house', 'belokamen|4');
        await item.locator('.research-overview__waiting-row').click();
        const link = item.locator('.live-waiting-house');
        await expect(link).toHaveText('House čp. 4 ›');
        await link.click();
        await onHousePage(page, 'Bělokamen čp. 4');
    });
});

// ---------------------------------------------------------------------------------------------------------------
// The Table, the lists' rule, the Statistics and the search (spec 030 §15)
// ---------------------------------------------------------------------------------------------------------------

const table = (page: Page): Locator => page.locator('#table-container');
const status = (page: Page): Locator => table(page).locator('.tv-status-count');
const head = (page: Page, col: string): Locator => table(page).locator(`.tv-headrow [data-col="${col}"]`);
/** The House column's cell of a person (the body's cells go by the head's column index). */
async function houseCell(page: Page, id: string): Promise<Locator> {
    const i = await head(page, 'house').getAttribute('aria-colindex');
    return table(page).locator(`.tv-body .tv-row[data-key="p:${id}"] > [aria-colindex="${i}"]`);
}

/** The House column's texts, top to bottom. */
async function houseColumn(page: Page): Promise<string[]> {
    const i = await head(page, 'house').getAttribute('aria-colindex');
    return table(page).locator(`.tv-body .tv-row[data-key^="p:"] > [aria-colindex="${i}"]`).evaluateAll(els => els.map(e => (e.textContent ?? '').trim()));
}

test.describe('Houses: the Table, the lists, the Statistics and the search (§15)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Table\'s House column: the house as a link to its page, the older number in brackets, sorted by town and number, filtered by text', async ({ page }) => {
        await seedVillages(page);
        await page.locator('#view-mode-table').click();
        await expect(table(page).locator('.tv-grid')).toBeVisible();
        await expect(status(page)).toHaveText('11 of 11 people');

        // The column from the Columns panel.
        await table(page).locator('.tv-cols-btn').click();
        const panel = page.getByRole('dialog', { name: 'Columns' });
        await expect(panel).toBeVisible();
        await page.locator('.tv-cp-q').fill('house');
        await panel.getByRole('checkbox', { name: 'House', exact: true }).check();
        await expect(head(page, 'house')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();

        // The birth house; a fact written with the older number says it faint in brackets.
        await expect((await houseCell(page, 'radhost')).locator('.tv-house')).toHaveText('Bělokamen čp. 16');
        await expect((await houseCell(page, 'hostivit')).locator('.tv-house')).toHaveText('Bělokamen čp. 16');
        await expect((await houseCell(page, 'hostivit')).locator('.tv-house-old')).toHaveText('(9)');
        await expect((await houseCell(page, 'kapradin')).locator('.tv-house')).toHaveText('Hvozdnice čp. 3');
        // Born in a town without a number: no house.
        await expect((await houseCell(page, 'dobromil')).locator('.tv-house')).toHaveCount(0);

        // Sorted by town, then by number (7 before 16 before 40); the people without a house last.
        await head(page, 'house').locator('.tv-cell-text').click();
        await expect(head(page, 'house')).toHaveAttribute('aria-sort', 'ascending');
        const sorted = await houseColumn(page);
        const at = (t: string) => sorted.indexOf(t);
        expect(at('Bělokamen čp. 7')).toBeGreaterThanOrEqual(0);
        expect(at('Bělokamen čp. 7')).toBeLessThan(at('Bělokamen čp. 16'));
        expect(at('Bělokamen čp. 16')).toBeLessThan(at('Bělokamen čp. 40'));
        expect(sorted.slice(-2).filter(t => t.includes('čp.'))).toEqual([]);
        // One town's houses together.
        const towns = sorted.filter(Boolean).map(t => t.split(' ')[0]);
        expect(towns.filter((t, i) => i === 0 || t !== towns[i - 1])).toHaveLength(2);

        // The column's text filter: "čp. 16" finds the house written with either number; a town finds its houses.
        await head(page, 'house').click({ button: 'right' });
        await page.locator('.tv-menu .tv-menu-item[data-id="filter"]').click();
        const filter = page.locator('.tv-fpanel');
        await expect(filter).toBeVisible();
        await filter.locator('.tv-ff-text').fill('čp. 16');
        await filter.locator('.tv-ff-text').press('Enter');
        await expect(filter).toHaveCount(0);
        await expect(status(page)).toHaveText('4 of 11 people');
        await expect(table(page).locator('.tv-chip--col')).toContainText('House');
        await table(page).locator('.tv-chip--col .tv-chip-x').click();
        await expect(status(page)).toHaveText('11 of 11 people');
        await head(page, 'house').click({ button: 'right' });
        await page.locator('.tv-menu .tv-menu-item[data-id="filter"]').click();
        await filter.locator('.tv-ff-text').fill('hvozdnice');
        await filter.locator('.tv-ff-text').press('Enter');
        await expect(status(page)).toHaveText('2 of 11 people');

        // A click on the house opens its page.
        await (await houseCell(page, 'kapradin')).locator('.tv-house').click();
        await onHousePage(page, 'Hvozdnice čp. 3');
    });

    test('the lists\' rule "Lived in the house": the house by its number, the people in the preview, the years narrow it', async ({ page }) => {
        await seedVillages(page);
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const lists = page.locator('#person-lists-modal');
        await lists.locator('.pl-new').first().click();
        const form = page.locator('#person-list-new');
        await expect(form).toBeVisible();
        await form.locator('.pln-opt[data-opt="custom"] .pln-opt-label').click();
        await expect(form.locator('.pln-modal')).toHaveClass(/pln-modal--rule/);

        // Next to Place and surroundings in the catalog.
        await form.locator('.plr > .plr-add [data-rb="add"]').click();
        const menu = page.locator('.plr-menu');
        await expect(menu).toBeVisible();
        const ids = await menu.locator('.pl-menu-item').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id));
        expect(ids.indexOf('livedInHouse')).toBe(ids.indexOf('near') + 1);
        await menu.locator('.pl-menu-item[data-id="livedInHouse"]').click();

        // The house's choice opens at once: the tree's houses with their people.
        await expect(menu).toBeVisible();
        await expect(menu).toHaveAttribute('aria-label', 'Lived in the house');
        const choice = menu.locator('.pl-menu-item[data-id="belokamen|16"]');
        await expect(choice.locator('.pl-menu-label')).toHaveText('Bělokamen čp. 16');
        await expect(choice.locator('.pl-menu-val')).toHaveText('6 people');
        await choice.click();
        await expect(menu).toHaveCount(0);

        const row = form.locator('.plr-row[data-path="0"]');
        await expect(row.locator('> .plr-m [data-pc="place"]')).toContainText('Bělokamen čp. 16');
        await expect(row.locator('> .plr-m > .plr-s')).toHaveText('Preview: 6 people · by birth, marriage, census, residence and death in the house');
        await expect(form.locator('.pln-total')).toHaveText('6 people match');

        // The years: only facts dated within them; the preview follows the typing (the field keeps the focus).
        await row.locator('> .plr-m [data-pc="from"]').fill('1870');
        await expect(row.locator('> .plr-m > .plr-s')).toHaveText('Preview: 4 people · by birth, marriage, census, residence and death in the house');
        await expect(form.locator('.pln-total')).toHaveText('4 people match');
        await expect(row.locator('> .plr-m [data-pc="from"]')).toBeFocused();
    });

    test('the Statistics\' topic Houses: the houses by their people, the longest one family and the married-in', async ({ page }) => {
        await seedVillages(page);
        await page.evaluate(() => window.Strom.UI.showActiveTreeStats());
        const win = page.locator('#tree-stats-modal .modal.stv');
        await expect(win.locator('.stv-table')).toBeVisible();
        const topic = win.locator('.stv-topic[data-topic="houses"]');
        await expect(topic).toBeVisible();
        await topic.click();
        await expect(win.locator('.stv-th-t')).toHaveText('Houses');
        const first = win.locator('.stv-vbody .stv-row').first();
        await expect(first.locator('.stv-val')).toContainText('Bělokamen čp. 16');
        await expect(first.locator('.stv-n')).toHaveText('6');
        await expect(win.locator('.stv-vbody .stv-row')).toHaveCount(6);
        // Everybody has a fact at a house: no Not given.
        await expect(win.locator('.stv-none-row')).toHaveCount(0);
        await expect(win.locator('.stv-total')).toContainText('Longest one family:');
        await expect(win.locator('.stv-total')).toContainText('Married into the house: 1 of');
    });

    test('a tree without a house has no topic Houses', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
        await openApp(page);
        await seedTree(page, { orwin: { firstName: 'Orwin', lastName: 'Halvek', birthPlace: 'Hvozdnice', birthDate: '1850' } }, 'Halvek');
        await page.evaluate(() => window.Strom.UI.showActiveTreeStats());
        const win = page.locator('#tree-stats-modal .modal.stv');
        await expect(win.locator('.stv-table')).toBeVisible();
        await expect(win.locator('.stv-topic[data-topic="birthPlaces"]')).toBeVisible();
        await expect(win.locator('.stv-topic[data-topic="houses"]')).toHaveCount(0);
    });

    test('the toolbar\'s search: the group Houses above the people, House › on a person found by the number, arrows and Enter', async ({ page }) => {
        await seedVillages(page);
        const input = page.locator('#toolbar-search-picker .person-picker-input');
        const picker = page.locator('#toolbar-search-picker');

        // The older number finds the house it was joined into, and the people born under it.
        await input.fill('čp. 9');
        const house = picker.locator('.person-picker-house[data-house="belokamen|16"]');
        await expect(house).toBeVisible();
        await expect(house.locator('.person-picker-name')).toHaveText('Bělokamen čp. 16');
        await expect(house.locator('.person-picker-dist')).toContainText('U Prouzalů');
        await expect(house.locator('.person-picker-dist')).toContainText('6 people');
        await expect(house.locator('.person-picker-houselink')).toHaveText('House page ›');
        await expect(picker.locator('.person-picker-group')).toHaveText(['Houses', 'People']);
        const people = picker.locator('.person-picker-item');
        await expect(people).toHaveCount(3);
        const svatobor = people.filter({ hasText: 'Svatobor' });
        await expect(svatobor.locator('.person-picker-houseact')).toHaveText('House ›');
        await expect(svatobor.locator('.person-picker-houseact')).toHaveAttribute('aria-label', 'House page Bělokamen čp. 16');

        // A house's row opens its page; the field clears.
        await house.click();
        await onHousePage(page, 'Bělokamen čp. 16');
        await expect(input).toHaveValue('');
        await page.keyboard.press('Escape');
        await expect(housePage(page)).toHaveCount(0);

        // "House ›" on a person.
        await input.fill('čp. 9');
        await picker.locator('.person-picker-item').filter({ hasText: 'Hostivít' }).locator('.person-picker-houseact').click();
        await onHousePage(page, 'Bělokamen čp. 16');
        await page.keyboard.press('Escape');
        await expect(housePage(page)).toHaveCount(0);

        // The arrows reach the houses first; Enter opens the selected one.
        await input.fill('hvozdnice');
        await expect(picker.locator('.person-picker-house')).toHaveCount(3);
        await input.press('ArrowDown');
        await input.press('ArrowDown');
        await expect(picker.locator('.person-picker-house').nth(1)).toHaveClass(/selected/);
        const second = await picker.locator('.person-picker-house').nth(1).locator('.person-picker-name').textContent();
        await input.press('Enter');
        await onHousePage(page, second ?? '');
    });
});
