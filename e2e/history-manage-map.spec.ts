import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistoryR1, historyGed, openResearch, poll,
    HISTORY_R1_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * "History of places", a place's region by hand (work 1028 §4, research R5):
 * the region picker over the manager (choice, years, overlap, the sentence of
 * what happens, Assign with Undo), "let the research decide again" with a
 * note (no Undo), "Back to the research's choice" on a place set by hand,
 * refusals, the gate by `history.map`, the phone's bottom sheet, and the
 * History line of a place in Places (§4.6).
 * Invented data (fakeHistoryR1): Jan born in Čapkov, died in Lhotka.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];

async function setup(page: Page, opts: { features?: string[]; width?: number; height?: number } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = fakeHistoryR1();
    // Lhotka (unlocated in the research) a place of the tree too, for the Places dialog.
    const ged = historyGed().replace('1 DEAT\n2 DATE 1910\n2 PLAC Čapkov', '1 DEAT\n2 DATE 1910\n2 PLAC Lhotka');
    const features = opts.features ?? HISTORY_R1_FEATURES;
    const bridge = await fakeBridge(page, { features, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await poll(page);
    await expect.poll(() => history.reads).toBeGreaterThan(0);
    return { bridge, history };
}

const modal = (page: Page) => page.locator('#history-modal');
const picker = (page: Page) => page.locator('#history-map-modal');
const place = (page: Page, key: string, group = 'all') => modal(page).locator(`.hm-group[data-group="${group}"] .hm-place[data-place="${key}"]`);
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });
const option = (page: Page, id: string) => picker(page).locator(`.hmp-opt[data-id="${id}"]`);
const chosen = (page: Page, id: string) => picker(page).locator(`.hmp-sel[data-id="${id}"]`);
const assignBtn = (page: Page) => picker(page).locator('[data-hmp="assign"]');

async function openPlaces(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openHistoryManage(o: object): void }).openHistoryManage({ tab: 'places' }));
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.hm-group[data-group="unassigned"]')).toBeVisible();
}

test.describe('History of places: a place\'s region by hand', () => {
    test('the picker: a region, years, overlap, the sentence; Assign writes, the toast\'s Undo goes back', { tag: '@smoke' }, async ({ page }) => {
        const { history } = await setup(page);
        await openPlaces(page);
        await place(page, 'Lhotka', 'unassigned').locator('[data-hm="assign"]').click();
        await expect(picker(page)).toBeVisible();
        await expect(picker(page).locator('#hmp-title')).toHaveText('Region for Lhotka');
        await expect(picker(page).locator('.hmp-why')).toHaveText('Research: several places of that name · 1 person');
        await expect(picker(page).locator('.hmp-none')).toHaveText('No region chosen yet.');
        await expect(assignBtn(page)).toBeDisabled();
        // A state on top, its lands indented under it.
        await expect(option(page, 'cz-moravia')).toHaveClass(/is-indent/);
        await expect(option(page, 'at-empire')).not.toHaveClass(/is-indent/);
        await expect(option(page, 'at-empire').locator('.hmp-opt-meta')).toHaveText('state');

        // The search narrows the list (without diacritics).
        await picker(page).locator('input.hmp-q').fill('mor');
        await expect(picker(page).locator('.hmp-opt:visible .hmp-opt-name')).toHaveText(['Moravia']);
        await option(page, 'cz-moravia').locator('input').check();
        await expect(chosen(page, 'cz-moravia')).toBeVisible();
        await expect(picker(page).locator('.hmp-result')).toHaveText('Moravia is in the queue; the place is added to it.');
        await expect(assignBtn(page)).toBeEnabled();

        // Two regions without years overlap: Assign off until the years part them.
        await picker(page).locator('input.hmp-q').fill('');
        await option(page, 'cz-silesia').locator('input').check();
        await expect(picker(page).locator('#hmp-title')).toHaveText('Regions for Lhotka');
        await expect(chosen(page, 'cz-silesia').locator('.hmp-sel-err')).toHaveText('The years of the regions overlap.');
        await expect(assignBtn(page)).toBeDisabled();
        await chosen(page, 'cz-moravia').locator('input[data-hmp="to"]').fill('1850');
        await chosen(page, 'cz-silesia').locator('input[data-hmp="from"]').fill('99');
        await expect(chosen(page, 'cz-silesia').locator('.hmp-sel-err')).toHaveText('A year is a number from 100 to 9999, "from" not after "to".');
        await expect(assignBtn(page)).toBeDisabled();
        // Letters do not get in; touching ends do not overlap.
        await chosen(page, 'cz-silesia').locator('input[data-hmp="from"]').fill('');
        await chosen(page, 'cz-silesia').locator('input[data-hmp="from"]').pressSequentially('18a50');
        await expect(chosen(page, 'cz-silesia').locator('input[data-hmp="from"]')).toHaveValue('1850');
        await expect(picker(page).locator('.hmp-sel-err:visible')).toHaveCount(0);
        await expect(picker(page).locator('.hmp-result')).toHaveText(
            'The research is searching the history of Silesia right now; events show once found. Moravia is in the queue; the place is added to it.');
        await assignBtn(page).click();

        await expect(picker(page)).toHaveCount(0);
        expect(history.writes.map).toEqual([{ place: 'Lhotka', regions: [{ id: 'cz-moravia', to: 1850 }, { id: 'cz-silesia', from: 1850 }] }]);
        const t = toast(page, 'Lhotka belongs to Moravia and Silesia.');
        await expect(t).toBeVisible();
        // Set by hand: out of the unassigned, with its way back.
        await expect(place(page, 'Lhotka', 'unassigned')).toHaveCount(0);
        await expect(place(page, 'Lhotka').locator('.hm-p-meta')).toContainText('Moravia until 1850');
        await expect(place(page, 'Lhotka').locator('[data-hm="mapAuto"]')).toHaveText('Back to the research\'s choice');
        // Undo: the research had not placed it, so it decides again.
        await t.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => history.writes.map.length).toBe(2);
        expect(history.writes.map[1]).toEqual({ place: 'Lhotka', do: 'auto' });
    });

    test('a place set by hand: Change region with its regions and years, Back to the research\'s choice with Undo', async ({ page }) => {
        const { history } = await setup(page);
        await openPlaces(page);
        await place(page, 'Čapkov').locator('[data-hm="menu"]').click();
        await page.locator('.hm-menu [data-scope="assign"]').click();
        await expect(picker(page)).toBeVisible();
        await expect(picker(page).locator('#hmp-title')).toHaveText('Regions for Čapkov');
        await expect(chosen(page, 'at-empire').locator('input[data-hmp="to"]')).toHaveValue('1918');
        // A state with its own land is no overlap.
        await expect(assignBtn(page)).toBeEnabled();
        await chosen(page, 'at-empire').locator('[data-hmp="remove"]').click();
        await expect(chosen(page, 'at-empire')).toHaveCount(0);
        await expect(option(page, 'at-empire').locator('input')).not.toBeChecked();
        await assignBtn(page).click();
        expect(history.writes.map).toEqual([{ place: 'Čapkov', regions: [{ id: 'cz-bohemia' }] }]);
        await expect(toast(page, 'Čapkov belongs to Bohemia.')).toBeVisible();

        const back = place(page, 'Čapkov').locator('[data-hm="mapAuto"]');
        await expect(back).toBeVisible();
        await back.click();
        await expect.poll(() => history.writes.map.length).toBe(2);
        expect(history.writes.map[1]).toEqual({ place: 'Čapkov', do: 'auto' });
        const t = toast(page, 'The research decides the region of Čapkov again.');
        await expect(t).toBeVisible();
        await expect(place(page, 'Čapkov').locator('[data-hm="mapAuto"]')).toHaveCount(0);
        // Undo puts the regions by hand back.
        await t.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => history.writes.map.length).toBe(3);
        expect(history.writes.map[2]).toEqual({ place: 'Čapkov', regions: [{ id: 'cz-bohemia' }] });
        await expect(place(page, 'Čapkov').locator('[data-hm="mapAuto"]')).toBeVisible();
    });

    test('decide again with a note: no Undo, the place waits with the note; Escape steps back', async ({ page }) => {
        const { history } = await setup(page);
        await openPlaces(page);
        await place(page, 'Lhotka', 'unassigned').locator('[data-hm="assign"]').click();
        await picker(page).locator('[data-hmp="redo"]').click();
        await expect(picker(page).locator('#hmp-title')).toHaveText('Let the research decide the region again');
        const note = picker(page).locator('#hmp-note');
        await expect(note).toBeFocused();
        await expect(note).toHaveAttribute('placeholder', 'several places of that name');
        // Escape: back to the choice, then closed (the manager stays).
        await page.keyboard.press('Escape');
        await expect(picker(page).locator('#hmp-title')).toHaveText('Region for Lhotka');
        await page.keyboard.press('Escape');
        await expect(picker(page)).toHaveCount(0);
        await expect(modal(page)).toBeVisible();

        await place(page, 'Lhotka', 'unassigned').locator('[data-hm="assign"]').click();
        await picker(page).locator('[data-hmp="redo"]').click();
        // At most 200 characters.
        await note.fill('x'.repeat(230));
        await expect(note).toHaveValue('x'.repeat(200));
        await note.fill('Lhotka near Čapkov');
        await picker(page).locator('[data-hmp="redoGo"]').click();
        await expect(picker(page)).toHaveCount(0);
        expect(history.writes.map).toEqual([{ place: 'Lhotka', redo: true, note: 'Lhotka near Čapkov' }]);
        const t = toast(page, 'The research will decide the region of Lhotka again.');
        await expect(t).toBeVisible();
        await expect(t.getByRole('button', { name: 'Undo' })).toHaveCount(0);
        const row = place(page, 'Lhotka', 'unassigned');
        await expect(row.locator('.hm-p-meta')).toContainText('The research will decide again');
        await expect(place(page, 'Lhotka').locator('.hm-p-why')).toHaveText('Note for the research: “Lhotka near Čapkov”');
        await expect(place(page, 'Lhotka').locator('[data-hm="mapAuto"]')).toHaveCount(0);
    });

    test('refusals: busy says so in the picker and keeps it; gone closes nothing and reads again', async ({ page }) => {
        const { history } = await setup(page);
        await openPlaces(page);
        await place(page, 'Lhotka', 'unassigned').locator('[data-hm="assign"]').click();
        await option(page, 'cz-bohemia').locator('input').check();
        history.writeReply = { map: { status: 503, body: { error: 'busy', code: 'research.busy' } } };
        await assignBtn(page).click();
        await expect(picker(page).locator('.hmp-error')).toHaveText('The research is busy. It will work again shortly.');
        await expect(chosen(page, 'cz-bohemia')).toBeVisible();
        await expect(assignBtn(page)).toBeEnabled();
        const reads = history.reads;
        history.writeReply = { map: { status: 404, body: { error: 'No such place in the facts of this tree.', code: 'history.place' } } };
        await assignBtn(page).click();
        await expect(picker(page).locator('.hmp-error')).toHaveText('No such place in the facts of this tree.');
        await expect.poll(() => history.reads).toBeGreaterThan(reads);
        history.writeReply = undefined;
        await assignBtn(page).click();
        await expect(picker(page)).toHaveCount(0);
        await expect(toast(page, 'Lhotka belongs to Bohemia.')).toBeVisible();
    });

    test('gate: without history.map no Assign, no Change region, no way back', async ({ page }) => {
        await setup(page, { features: HISTORY_R1_FEATURES.filter(f => f !== 'history.map') });
        await openPlaces(page);
        await expect(place(page, 'Lhotka', 'unassigned')).toBeVisible();
        await expect(modal(page).locator('[data-hm="assign"]')).toHaveCount(0);
        await place(page, 'Čapkov').locator('[data-hm="menu"]').click();
        await expect(page.locator('.hm-menu [data-scope="assign"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.evaluate(() => (window.Strom.UI as unknown as { openHistoryRegionPicker(k: string): void }).openHistoryRegionPicker('Lhotka'));
        await expect(picker(page)).toHaveCount(0);
    });

    test('phone (390 px): a bottom sheet 40 px under the top, the footer reachable, nothing wider than the screen', { tag: '@smoke' }, async ({ page }) => {
        const { history } = await setup(page, { width: 390, height: 844 });
        await openPlaces(page);
        await place(page, 'Lhotka', 'unassigned').locator('[data-hm="assign"]').click();
        const sheet = picker(page).locator('.hmp-modal');
        await expect(sheet).toBeVisible();
        const box = (await sheet.boundingBox())!;
        expect(Math.round(box.y)).toBe(40);
        expect(Math.round(box.y + box.height)).toBe(844);
        expect(box.width).toBeLessThanOrEqual(390);
        const year = await option(page, 'cz-bohemia').boundingBox();
        expect(year!.height).toBeGreaterThanOrEqual(44);
        await option(page, 'cz-bohemia').locator('input').check();
        const from = chosen(page, 'cz-bohemia').locator('input[data-hmp="from"]');
        await expect(from).toHaveAttribute('inputmode', 'numeric');
        const overflow = await sheet.evaluate(el => el.scrollWidth - el.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await expect(assignBtn(page)).toBeInViewport();
        await assignBtn(page).click();
        expect(history.writes.map).toEqual([{ place: 'Lhotka', regions: [{ id: 'cz-bohemia' }] }]);
    });

    test('the research\'s data changes while the picker is open: the regions follow, the choice and its years stay', async ({ page }) => {
        const { history } = await setup(page);
        await openPlaces(page);
        await place(page, 'Lhotka', 'unassigned').locator('[data-hm="assign"]').click();
        await option(page, 'cz-moravia').locator('input').check();
        await chosen(page, 'cz-moravia').locator('input[data-hmp="from"]').fill('1850');
        await expect(option(page, 'sk-upper-hungary')).toHaveCount(0);
        // The research finds a new region and another place of Moravia (a read after its agent's work).
        const reads = history.reads;
        const regions = history.payload.regions!;
        regions['sk-upper-hungary'] = { name: { cs: 'Horní Uhry', en: 'Upper Hungary', de: 'Oberungarn' }, state: 'queued', order: 5, events: 0, places: 1, persons: 1 };
        regions['cz-moravia'] = { ...regions['cz-moravia'], places: 3 };
        history.rev = 'h2';
        history.payload.state.rev = 'h2';
        await poll(page);
        await expect.poll(() => history.reads).toBeGreaterThan(reads);
        await expect(option(page, 'sk-upper-hungary')).toContainText('Upper Hungary');
        await expect(option(page, 'cz-moravia')).toContainText('3 places');
        await expect(option(page, 'cz-moravia').locator('input')).toBeChecked();
        await expect(chosen(page, 'cz-moravia').locator('input[data-hmp="from"]')).toHaveValue('1850');
        await assignBtn(page).click();
        await expect.poll(() => history.writes.map).toEqual([{ place: 'Lhotka', regions: [{ id: 'cz-moravia', from: 1850 }] }]);
    });

    test('Places: a place\'s History line; Manage opens the manager at it, an unassigned place\'s Assign region the picker', async ({ page }) => {
        const { history } = await setup(page);
        await page.evaluate(() => window.Strom.UI.showPlacesManager());
        const places = page.locator('#places-modal');
        await expect(places).toBeVisible();
        const caslav = places.locator('.place-row[data-key="capkov"] .place-history');
        await expect(caslav.locator('.place-history-label')).toHaveText('History');
        await expect(caslav.locator('.place-history-text')).toContainText('Bohemia');
        await expect(caslav.locator('.place-history-text')).toContainText('done');
        await expect(caslav.locator('.place-history-link')).toHaveText('Manage ›');
        const lhotka = places.locator('.place-row[data-key="lhotka"] .place-history');
        await expect(lhotka.locator('.place-history-text')).toHaveText('unassigned: several places of that name');
        await expect(lhotka.locator('.place-history-link')).toHaveText('Assign region ›');

        await lhotka.locator('.place-history-link').click();
        await expect(picker(page)).toBeVisible();
        await option(page, 'cz-moravia').locator('input').check();
        await assignBtn(page).click();
        expect(history.writes.map).toEqual([{ place: 'Lhotka', regions: [{ id: 'cz-moravia' }] }]);
        // The line follows the research's answer.
        await expect(lhotka.locator('.place-history-link')).toHaveText('Manage ›');
        await expect(lhotka.locator('.place-history-text')).toContainText('Moravia');

        await caslav.locator('.place-history-link').click();
        await expect(modal(page)).toBeVisible();
        await expect(page.locator('#hm-tab-places')).toHaveAttribute('aria-selected', 'true');
    });

    test('Places without the history.map feature: the unassigned place leads to the manager', async ({ page }) => {
        await setup(page, { features: HISTORY_R1_FEATURES.filter(f => f !== 'history.map') });
        await page.evaluate(() => window.Strom.UI.showPlacesManager());
        const lhotka = page.locator('#places-modal .place-row[data-key="lhotka"] .place-history');
        await expect(lhotka.locator('.place-history-link')).toHaveText('Manage ›');
    });
});
