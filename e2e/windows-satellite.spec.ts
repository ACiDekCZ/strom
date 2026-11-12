import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp, setFollowMode } from './helpers.js';

/**
 * The satellite window (spec 079 §2): its header in place of the toolbar
 * (no tree switcher, Research or Settings), the selection shared with the
 * main window both ways (off: nothing sent or taken, kept over a reload; an
 * incoming selection waits for a cell's edit to end), Undo from the
 * satellite (its button and Ctrl/Cmd+Z) in both windows, and the person
 * menu's research rows run by the main window.
 */

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

const EXTRA = 60;
const PERSONS: Record<string, unknown> = {
    v: person('v', 'Bořivoj', 'Vrtišek', { birthDate: '1850-03-01', birthPlace: 'Lopuchov', partnerships: ['u1'], childIds: ['c'] }),
    k: person('k', 'Kunhuta', 'Hrnčíříková', { gender: 'female', birthDate: '1852-04-05', partnerships: ['u1'], childIds: ['c'] }),
    c: person('c', 'Celestýn', 'Vrtišek', { birthDate: '1875-06-07', parentIds: ['v', 'k'] }),
};
// Enough rows below them for the Table to scroll.
for (let i = 0; i < EXTRA; i++) {
    PERSONS[`x${i}`] = person(`x${i}`, 'Kvido', 'Žampion', { birthDate: `${1900 + i}-01-01` });
}
const PARTNERSHIPS = {
    u1: { id: 'u1', person1Id: 'v', person2Id: 'k', childIds: ['c'], status: 'married' },
};
const LAST = `x${EXTRA - 1}`;

async function openMain(page: Page): Promise<string> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    const treeId = await page.evaluate(async ({ persons, partnerships }) => {
        const dm = window.Strom.DataManager;
        await dm.importAsNewTree({ persons, partnerships } as never, 'Vrtišek');
        await window.Strom.TreeRenderer.setFocus('c' as never);
        return dm.getCurrentTreeId() as string;
    }, { persons: PERSONS, partnerships: PARTNERSHIPS });
    await expect(card(page, 'Celestýn')).toBeVisible();
    return treeId;
}

async function openSatellite(context: BrowserContext, treeId: string): Promise<Page> {
    const sat = await context.newPage();
    await sat.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await sat.goto(`/strom.html?okno=table&tree=${encodeURIComponent(treeId)}&w=t1`);
    await expect(tv(sat, '.tv-status-count')).toHaveText(`${EXTRA + 3} of ${EXTRA + 3} people`);
    // Connected to the main window (editable).
    await expect(tv(sat, '.tv-status-ro')).toBeHidden();
    return sat;
}

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);
const row = (page: Page, id: string) => tv(page, `.tv-body .tv-row[data-key="p:${id}"]`);

/** A body cell of a row by its column's id. */
async function cell(page: Page, key: string, colId: string) {
    const head = tv(page, '.tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return tv(page, `.tv-body .tv-row[data-key="${key}"] [aria-colindex="${index}"]`);
}

const birthPlace = (page: Page, id: string) => page.evaluate((pid) => window.Strom.DataManager.getPerson(pid as never)?.birthPlace, id);
const selectedKey = (page: Page) => tv(page, '.tv-body .tv-row[aria-selected="true"]').getAttribute('data-key');
const ringed = (page: Page) => page.locator('.person-card.window-selected');
const scrollTop = (page: Page) => tv(page, '.tv-grid').evaluate(el => el.scrollTop);

/** Choose a person in the main window (as a click on a card does: the focus). */
const chooseInMain = (page: Page, id: string) => page.evaluate((pid) => window.Strom.TreeRenderer.setFocus(pid as never), id);

async function editPlace(sat: Page, id: string, value: string): Promise<void> {
    await (await cell(sat, `p:${id}`, 'bPlace')).dblclick();
    await tv(sat, '.tv-editor-input').fill(value);
    await tv(sat, '.tv-editor-input').press('Enter');
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the header stands in place of the toolbar: no tree switcher, Research or Settings', async ({ page, context }) => {
        const treeId = await openMain(page);
        const sat = await openSatellite(context, treeId);
        await expect(sat.locator('header.sat-header')).toBeVisible();
        await expect(sat.locator('.sat-header-title')).toHaveText('Vrtišek');
        // The Table only marks another window's choice (K2.1).
        await expect(sat.locator('.sat-follow')).toHaveAttribute('aria-haspopup', 'menu');
        await expect(sat.locator('.sat-follow')).toHaveAttribute('data-mode', 'mark');
        await expect(sat.locator('.sat-follow')).toHaveAttribute('aria-label', 'Follow selection: mark only');
        // Not mounted at all (not only hidden).
        for (const sel of ['.toolbar', '#bottom-bar', '.tree-switcher', '#research-menu-row', '#actions-settings-row', '#research-sync-pill']) {
            await expect(sat.locator(sel), sel).toHaveCount(0);
        }
        // ⌖ Show in tree leaves the Table: not offered in a satellite.
        await expect(tv(sat, '.tv-acts [data-act="tree"]')).toHaveCount(0);

        // A rename in the main window reaches the header and the title.
        await page.evaluate((id) => window.Strom.TreeManager.renameTree(id as never, 'Vrtišek z Pažitkova'), treeId);
        await expect(sat.locator('.sat-header-title')).toHaveText('Vrtišek z Pažitkova');
        await expect(sat).toHaveTitle('Table – Vrtišek z Pažitkova – Strom');
        await sat.close();
    });

    test('the selection is shared both ways; off, nothing is sent or taken, also after a reload', async ({ page, context }) => {
        const treeId = await openMain(page);
        const sat = await openSatellite(context, treeId);

        // Main → satellite: the person's row is selected, with the shared look.
        await chooseInMain(page, 'v');
        await expect(row(sat, 'v')).toHaveAttribute('aria-selected', 'true');
        await expect(row(sat, 'v')).toHaveClass(/is-shared/);

        // Satellite → main: the card gets its ring, the focus (the chart's centre) stays.
        await (await cell(sat, 'p:k', 'bPlace')).click();
        await expect(ringed(page)).toHaveCount(1);
        await expect(ringed(page)).toHaveAttribute('data-id', 'k');
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('v');

        // A person far below: the row is scrolled to.
        expect(await scrollTop(sat)).toBe(0);
        await chooseInMain(page, LAST);
        await expect(row(sat, LAST)).toHaveAttribute('aria-selected', 'true');
        await expect(row(sat, LAST)).toBeInViewport();
        expect(await scrollTop(sat)).toBeGreaterThan(0);

        // Off: kept for this window over a reload.
        await setFollowMode(sat, 'off');
        await sat.reload();
        await expect(tv(sat, '.tv-status-ro')).toBeHidden();
        // The window's own Table state is kept over the reload too: its row, in view.
        await expect(row(sat, LAST)).toHaveAttribute('aria-selected', 'true');
        await expect(row(sat, LAST)).toBeInViewport();
        await tv(sat, '.tv-grid').evaluate(el => { el.scrollTop = 0; });
        await expect(row(sat, 'v')).toBeVisible();
        await expect(sat.locator('.sat-follow')).toHaveAttribute('data-mode', 'off');

        // Nothing sent: a row chosen here rings no card in the main window.
        await page.evaluate(() => window.Strom.TreeRenderer.setWindowSelected(null));
        await (await cell(sat, 'p:v', 'bPlace')).click();
        await expect(row(sat, 'v')).toHaveAttribute('aria-selected', 'true');
        await expect(row(sat, 'v')).not.toHaveClass(/is-shared/);
        await page.waitForTimeout(600);
        await expect(ringed(page)).toHaveCount(0);

        // Nothing taken: the main window's choice leaves the Table as it is.
        await chooseInMain(page, 'c');
        await sat.waitForTimeout(600);
        expect(await selectedKey(sat)).toBe('p:v');
        await sat.close();
    });

    test('a selection arriving during a cell\'s edit waits for its end: the Table does not move', async ({ page, context }) => {
        const treeId = await openMain(page);
        const sat = await openSatellite(context, treeId);
        await (await cell(sat, 'p:v', 'bPlace')).dblclick();
        await expect(tv(sat, '.tv-editor-input')).toBeVisible();

        await chooseInMain(page, LAST);
        await sat.waitForTimeout(600);
        // The editor stays, the selection and the scroll too.
        await expect(tv(sat, '.tv-editor-input')).toBeVisible();
        await expect(tv(sat, '.tv-editor-input')).toBeFocused();
        expect(await selectedKey(sat)).toBe('p:v');
        expect(await scrollTop(sat)).toBe(0);

        // The edit ends (Esc): the waiting selection comes.
        await tv(sat, '.tv-editor-input').press('Escape');
        await expect(row(sat, LAST)).toHaveAttribute('aria-selected', 'true');
        await expect(row(sat, LAST)).toBeInViewport();
        await sat.close();
    });

    test('Undo from the satellite (its button and Ctrl/Cmd+Z) takes the edit back in both windows', async ({ page, context }) => {
        const treeId = await openMain(page);
        const sat = await openSatellite(context, treeId);
        const undo = sat.locator('.sat-header #toolbar-undo-btn');

        await editPlace(sat, 'v', 'Pantoflov');
        await expect.poll(() => birthPlace(page, 'v')).toBe('Pantoflov');
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect.poll(() => birthPlace(page, 'v')).toBe('Lopuchov');
        await expect(await cell(sat, 'p:v', 'bPlace')).toHaveText('Lopuchov');
        // Redo is offered now (the main window's status).
        await expect(sat.locator('.sat-header #toolbar-redo-btn')).toBeEnabled();

        await editPlace(sat, 'v', 'Kapustov');
        await expect.poll(() => birthPlace(page, 'v')).toBe('Kapustov');
        await expect(await cell(sat, 'p:v', 'bPlace')).toHaveText('Kapustov');
        await sat.locator('.sat-header-title').click();
        await sat.keyboard.press('ControlOrMeta+z');
        await expect.poll(() => birthPlace(page, 'v')).toBe('Lopuchov');
        await expect(await cell(sat, 'p:v', 'bPlace')).toHaveText('Lopuchov');
        await sat.close();
    });

    test('a research row of the person menu is run by the main window', async ({ page, context }) => {
        const treeId = await openMain(page);
        // The main window's research rows for the person, and what it runs (the bridge is not part of this).
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as Record<string, unknown>;
            const ran: string[] = [];
            (window as unknown as { __ran: string[] }).__ran = ran;
            ui.personResearchMenuItems = () => [{ action: 'research-check', label: 'Check the records', badge: 'ai' }];
            const run = ui.runPersonMenuAction as (p: string, a: string) => void;
            ui.runPersonMenuAction = function (this: unknown, p: string, a: string) {
                if (a === 'research-check') { ran.push(`${p} ${a}`); return; }
                run.call(this, p, a);
            };
        });
        const sat = await openSatellite(context, treeId);

        // K1's Table opens no person menu of its own: opened as a chart's card opens it (an event with its target).
        await sat.evaluate(() => {
            const ev = new MouseEvent('contextmenu', { clientX: 400, clientY: 300, bubbles: false, cancelable: true });
            document.querySelector('.sat-header-title')!.dispatchEvent(ev);
            window.Strom.UI.showContextMenu('v' as never, ev);
        });
        const menu = sat.locator('.context-menu.person-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.win-research-head')).toHaveText('Research · runs in the main window');
        const item = menu.locator('[data-action="win-research:research-check"]');
        await expect(item).toHaveText(/Check the records/);
        // Rows that leave the window are not there.
        await expect(menu.locator('[data-action="focus"]')).toHaveCount(0);
        await item.click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __ran: string[] }).__ran)).toEqual(['v research-check']);
        await sat.close();
    });
});
