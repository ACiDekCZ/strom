import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistory, historyGed, openResearch, poll,
    HISTORY_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * History in the life timeline (spec 020) — the person card's
 * layer: the research's events of the time between the person's rows (with
 * the age then, the kind, the source), a year's cluster, the "⋯" menu that
 * hides an event for the place or for the person only (toast with Undo),
 * "Hidden: n" with "Show again", the state rows, the phone's bottom sheet and
 * the device's copy read again after the local data is unlocked. Invented
 * data (fakeHistory): Jan lived in Čáslav 1860–1910, Josef 1830–1890, Anna's
 * dates have no place.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];

function layerGed(): string {
    return historyGed()
        .replace('1 NAME Josef /Fíšek/', '1 NAME Josef /Fíšek/\n1 BIRT\n2 DATE 1830\n2 PLAC Čáslav\n1 DEAT\n2 DATE 1890\n2 PLAC Čáslav')
        .replace('1 NAME Anna /Svobodová/', '1 NAME Anna /Svobodová/\n1 BIRT\n2 DATE 1835\n1 DEAT\n2 DATE 1900');
}

async function setup(page: Page, opts: { history?: Partial<FakeHistory>; features?: string[]; layerOn?: boolean; width?: number; height?: number } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = fakeHistory(opts.history);
    const ged = layerGed();
    const bridge = await fakeBridge(page, { features: opts.features ?? HISTORY_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    // On by default (never chosen); `layerOn: false` = the user switched it off.
    if (opts.layerOn === false) await page.evaluate(() => window.Strom.UI.toggleHistoryLayer(false));
    await poll(page);
    return { bridge, history };
}

const idOf = (page: Page, first: string) => page.evaluate((first) =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);

async function openCard(page: Page, first: string): Promise<void> {
    const id = await idOf(page, first);
    await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
    await expect(page.locator('#pm-lifeline-section')).toBeVisible();
}

async function closeCard(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.forceCloseModal());
}

const body = (page: Page) => page.locator('#pm-lifeline-body');
const historyRows = (page: Page) => page.locator('#pm-lifeline-body .pm-lifeline-row.k-history');
const warRow = (page: Page) => historyRows(page).filter({ hasText: 'Austro-Prussian War; fighting around Čáslav.' });
const chip = (page: Page) => page.locator('#pm-lifeline-history-toggle');

test.describe('History in the life timeline: the person card', () => {
    test('switched off: the card is as it was and nothing is read', async ({ page }) => {
        const { history } = await setup(page, { layerOn: false });
        await openCard(page, 'Jan');
        const before = await page.locator('#pm-lifeline-section').evaluate(el => el.outerHTML);
        await expect(chip(page)).toHaveCount(0);
        await expect(page.locator('#pm-lifeline-head .pm-lifeline-chips')).toHaveCount(0);
        await expect(page.locator('#pm-lifeline-body [class*="k-history"]')).toHaveCount(0);
        expect(history.reads).toBe(0);
        // On and off again: the head and the body exactly as before.
        await page.evaluate(() => window.Strom.UI.toggleHistoryLayer(true));
        await poll(page);
        await expect(warRow(page)).toBeVisible();
        await page.evaluate(() => window.Strom.UI.toggleHistoryLayer(false));
        await expect(chip(page)).toHaveCount(0);
        expect(await page.locator('#pm-lifeline-section').evaluate(el => el.outerHTML)).toBe(before);
    });

    test('on: the event between the person\'s rows, with its kind, age and source', { tag: '@smoke' }, async ({ page }) => {
        await setup(page);
        await openCard(page, 'Jan');
        await expect(chip(page)).toHaveAttribute('aria-checked', 'true');
        await expect(warRow(page)).toBeVisible();
        await expect(warRow(page).locator('.pm-lifeline-year')).toHaveText('1866');
        await expect(warRow(page).locator('.pm-lifeline-hmeta')).toContainText('war');
        await expect(warRow(page).locator('.pm-lifeline-hmeta')).toContainText('age 6');
        const link = warRow(page).locator('.pm-lifeline-hsrc a');
        await expect(link).toHaveText(/Invented encyclopedia/);
        await expect(link).toHaveAttribute('href', 'https://example.org/war-1866');
        await expect(link).toHaveAttribute('title', /Invented encyclopedia · checked/);
        // Between the birth (1860) and the death (1910): the timeline's order.
        const years = await body(page).locator('.pm-lifeline-row .pm-lifeline-year').allTextContents();
        expect(years).toEqual(['1860', '1866', '1910']);
        // The crash of 1873 is hidden at Čáslav.
        await expect(page.locator('.pm-lifeline-hidden')).toHaveText(/Hidden: 1/);
        // The chip off: the timeline as it was, the chip stays; on again: back.
        await chip(page).click();
        await expect(chip(page)).toHaveAttribute('aria-checked', 'false');
        await expect(historyRows(page)).toHaveCount(0);
        await expect(page.locator('.pm-lifeline-hidden')).toHaveCount(0);
        await expect(page.locator('.pm-lifeline-hinfo')).toBeHidden();
        await expect(page.locator('#pm-lifeline-section')).not.toHaveClass(/collapsed/);
        await chip(page).click();
        await expect(warRow(page)).toBeVisible();
    });

    test('a year with two events is one folded row; Enter and Space unfold it', async ({ page }) => {
        const base = fakeHistory();
        base.payload.events.push({ id: 'E3', from: 1866, kind: 'epidemic', scope: 'region',
            text: { cs: 'Epidemie cholery.', en: 'Cholera epidemic.' },
            source: { title: 'Invented chronicle', url: 'https://example.org/cholera', checked: '2026-10-01', quote: 'Cholera came with the armies.' } });
        (base.payload.places['Čáslav'] as { events: string[] }).events.push('E3');
        await setup(page, { history: base });
        await openCard(page, 'Jan');
        const group = body(page).locator('.k-historyGroup');
        await expect(group).toHaveCount(1);
        await expect(group).toHaveText(/2 events: war, epidemic/);
        await expect(group).toHaveAttribute('aria-expanded', 'false');
        await expect(historyRows(page)).toHaveCount(0);
        await group.focus();
        await page.keyboard.press('Enter');
        await expect(body(page).locator('.k-historyGroup')).toHaveAttribute('aria-expanded', 'true');
        await expect(body(page).locator('.k-historyGroup')).toBeFocused();
        await expect(historyRows(page)).toHaveCount(2);
        // The excerpt opens under the labels.
        const cholera = historyRows(page).filter({ hasText: 'Cholera epidemic.' });
        await cholera.locator('.pm-lifeline-hquote').click();
        await expect(cholera.locator('.pm-lifeline-hquotebox')).toContainText('“Cholera came with the armies.”');
        await expect(cholera.locator('.pm-lifeline-hquote')).toHaveAttribute('aria-expanded', 'true');
        await body(page).locator('.k-historyGroup').focus();
        await page.keyboard.press(' ');
        await expect(historyRows(page)).toHaveCount(0);
        // Forgotten with the card.
        await page.keyboard.press(' ');
        await expect(historyRows(page)).toHaveCount(2);
        await closeCard(page);
        await openCard(page, 'Jan');
        await expect(body(page).locator('.k-historyGroup')).toHaveAttribute('aria-expanded', 'false');
    });

    test('hide for the place: gone for everyone from Čáslav, sent to the research; Undo brings it back', async ({ page }) => {
        const { history } = await setup(page);
        await openCard(page, 'Jan');
        const more = warRow(page).locator('.pm-lifeline-hmore');
        await more.click();
        const menu = page.locator('.pm-lifeline-hmenu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.pm-lifeline-hmenu-head')).toHaveText('1866 · Austro-Prussian War; fighting around Čáslav.');
        await expect(menu.getByRole('menuitem')).toHaveText([/Hide for Čáslav/, /Hide for Jan Fíšek only/]);
        await expect(menu.getByRole('menuitem').first()).toBeFocused();
        // Keyboard: arrows move, Esc closes and returns to "⋯".
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(more).toBeFocused();
        await expect(page.locator('#person-modal')).toHaveClass(/active/);

        await more.click();
        await menu.getByRole('menuitem', { name: /Hide for Čáslav/ }).click();
        await expect(warRow(page)).toHaveCount(0);
        const toast = page.locator('.toast', { hasText: 'Event hidden for Čáslav.' });
        await expect(toast).toBeVisible();
        // Over the card, the toast stands above its footer: the card's buttons stay free.
        const footTop = await page.locator('#person-modal .pm-footer').evaluate(el => el.getBoundingClientRect().top);
        await expect.poll(() => toast.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(footTop);
        await expect.poll(() => history.hides).toEqual([{ event: 'E1', place: 'Čáslav' }]);
        await expect(page.locator('.pm-lifeline-hidden')).toHaveText(/Hidden: 2/);
        // Josef lived in Čáslav too: hidden for him as well.
        await closeCard(page);
        await openCard(page, 'Josef');
        await expect(warRow(page)).toHaveCount(0);
        await expect(page.locator('.pm-lifeline-hidden')).toHaveText(/Hidden: 2/);
        // Undo: back for both.
        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect(warRow(page)).toBeVisible();
        await expect.poll(() => history.hides.length).toBe(2);
        expect(history.hides[1]).toEqual({ event: 'E1', place: 'Čáslav', do: 'show' });
    });

    test('hide for the person only: the other person of the place keeps it', async ({ page }) => {
        const { history } = await setup(page);
        await openCard(page, 'Jan');
        await warRow(page).locator('.pm-lifeline-hmore').click();
        await page.locator('.pm-lifeline-hmenu').getByRole('menuitem', { name: /Hide for Jan Fíšek only/ }).click();
        await expect(warRow(page)).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: 'Event hidden for Jan Fíšek only.' })).toBeVisible();
        await expect.poll(() => history.hides).toEqual([{ event: 'E1', person: 'P0003' }]);
        await closeCard(page);
        await openCard(page, 'Josef');
        await expect(warRow(page)).toBeVisible();
        await expect(warRow(page).locator('.pm-lifeline-hmeta')).toContainText('age 36');
    });

    test('"Hidden: n" lists the person\'s hidden events; "Show again" returns one', async ({ page }) => {
        const { history } = await setup(page);
        await openCard(page, 'Jan');
        const toggle = page.locator('.pm-lifeline-hidden');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('.pm-lifeline-hiddenlist')).toBeHidden();
        await toggle.click();
        await expect(page.locator('.pm-lifeline-hidden')).toHaveAttribute('aria-expanded', 'true');
        const list = page.locator('.pm-lifeline-hiddenlist');
        await expect(list).toBeVisible();
        await expect(list).toContainText('A hidden event is not offered again');
        const item = list.locator('.pm-lifeline-hiddenitem');
        await expect(item).toHaveCount(1);
        await expect(item).toContainText('1873');
        await expect(item).toContainText('Vienna stock exchange crash.');
        await expect(item).toContainText('for Čáslav');
        await item.getByRole('button', { name: 'Show again' }).click();
        const crash = historyRows(page).filter({ hasText: 'Vienna stock exchange crash.' });
        await expect(crash).toBeVisible();
        await expect(crash.locator('.pm-lifeline-hmeta')).toContainText('age 13');
        await expect(page.locator('.pm-lifeline-hidden')).toHaveCount(0);
        await expect.poll(() => history.hides).toEqual([{ event: 'E2', place: 'Čáslav', do: 'show' }]);
    });

    test('a hiding from the card shows in the tree\'s list in Settings', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Jan');
        await warRow(page).locator('.pm-lifeline-hmore').click();
        await page.locator('.pm-lifeline-hmenu').getByRole('menuitem', { name: /Hide for Jan Fíšek only/ }).click();
        await expect(warRow(page)).toHaveCount(0);
        await closeCard(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#history-hidden-link')).toHaveText('Hidden events (2)');
        await page.locator('#history-hidden-link').click();
        const list = page.locator('#history-hidden-list');
        await expect(list.locator('.history-hidden-item')).toHaveCount(2);
        await expect(list.locator('.history-hidden-item', { hasText: 'Austro-Prussian War' })).toContainText('for Jan Fíšek only');
    });

    test('on by default, the research not searching and without events: the card shows nothing', async ({ page }) => {
        const { history } = await setup(page, { history: {
            searching: false,
            payload: { state: { on: false, search: 'none', rev: 'h1' }, lang: 'cs', events: [], places: {}, hidden: [] },
        } });
        await expect.poll(() => history.reads).toBe(1);
        await openCard(page, 'Jan');
        await expect(page.locator('#pm-lifeline-head .pm-lifeline-chips')).toHaveCount(0);
        await expect(chip(page)).toHaveCount(0);
        await expect(page.locator('#pm-lifeline-body [class*="k-history"]')).toHaveCount(0);
        await closeCard(page);
        // The state is Settings' only.
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#history-setting-status')).toContainText('The research does not look for events.');
    });

    test('an older research without history.events: the card shows nothing, nothing read', async ({ page }) => {
        const { history } = await setup(page, { features: HISTORY_FEATURES.filter(f => f !== 'history.events') });
        await openCard(page, 'Jan');
        await expect(chip(page)).toHaveCount(0);
        await expect(page.locator('#pm-lifeline-body [class*="k-history"]')).toHaveCount(0);
        expect(history.reads).toBe(0);
    });

    test('the research searching, no events yet: the chip and the "still looking" row', async ({ page }) => {
        await setup(page, { history: {
            payload: { state: { on: true, search: 'running', pending: 1, rev: 'h1' }, lang: 'cs', events: [], places: { 'Čáslav': { events: [], state: 'pending' } }, hidden: [] },
        } });
        await openCard(page, 'Jan');
        await expect(chip(page)).toBeVisible();
        await expect(body(page).locator('.k-historyState')).toHaveText('The research is still looking for events for the places of this tree.');
        await expect(historyRows(page)).toHaveCount(0);
    });

    test('a person without a place with a year: the state row says so', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Anna');
        await expect(chip(page)).toBeVisible();
        const state = body(page).locator('.k-historyState');
        await expect(state).toHaveText('Without a place with a year, no events of the time can be matched to this person.');
        await expect(historyRows(page)).toHaveCount(0);
    });

    test('the legend: "i" opens it, Esc closes it back to "i"', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Jan');
        const info = page.locator('.pm-lifeline-hinfo');
        await info.click();
        const legend = page.locator('.pm-lifeline-legend-pop');
        await expect(legend).toBeVisible();
        await expect(legend).toContainText('History in the timeline');
        await expect(legend).toContainText('Regional history');
        await expect(legend).toContainText('From research records');
        // Not a feature on trial any more (K1.5).
        await expect(legend).toContainText('History is switched off in Settings.');
        await expect(legend).not.toContainText('on trial');
        await expect(info).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(legend).toHaveCount(0);
        await expect(info).toBeFocused();
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
        // "i" again toggles.
        await info.click();
        await expect(legend).toBeVisible();
        await info.click();
        await expect(legend).toHaveCount(0);
    });

    test('phone (390 px): the hide menu is a bottom sheet with Cancel', async ({ page }) => {
        const { history } = await setup(page, { width: 390, height: 844 });
        await openCard(page, 'Jan');
        const more = warRow(page).locator('.pm-lifeline-hmore');
        await expect(more).toBeVisible();
        await more.click();
        const sheet = page.locator('.bottom-sheet.pm-lifeline-hmenu-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.pm-lifeline-hsheet-head')).toHaveText('1866 · Austro-Prussian War; fighting around Čáslav.');
        await expect(sheet.getByRole('menuitem')).toHaveCount(2);
        await sheet.getByRole('button', { name: 'Cancel' }).click();
        await expect(sheet).toHaveCount(0);
        await expect(warRow(page)).toBeVisible();
        expect(history.hides).toEqual([]);
        await more.click();
        await page.locator('.bottom-sheet.pm-lifeline-hmenu-sheet').getByRole('menuitem', { name: /Hide for Čáslav/ }).click();
        await expect(warRow(page)).toHaveCount(0);
        await expect.poll(() => history.hides).toEqual([{ event: 'E1', place: 'Čáslav' }]);
    });

    test('unlocking the local data reads the device\'s copy again at once', async ({ page }) => {
        const PASSWORD = 'linden-tree-42';
        const { bridge } = await setup(page);
        // Encryption on: the device's copy is written encrypted from now.
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await page.locator('#settings-modal #encryption-toggle').check();
        const pwd = page.locator('#password-setup-modal');
        await pwd.locator('#password-setup-input').fill(PASSWORD);
        await pwd.locator('#password-setup-confirm').fill(PASSWORD);
        await pwd.getByRole('button', { name: 'Save' }).click();
        await expect(pwd).toBeHidden();
        await page.evaluate(() => window.Strom.UI.closeSettingsDialog());
        // A new read saved under encryption.
        bridge.history!.rev = 'h9';
        bridge.history!.payload.state.rev = 'h9';
        await poll(page);
        await expect.poll(() => bridge.history!.reads).toBe(2);
        await page.waitForTimeout(300);
        // The bridge stops; a new page asks for the password.
        bridge.down = true;
        await page.reload();
        const prompt = page.locator('#password-prompt-modal');
        await expect(prompt).toBeVisible();
        await prompt.locator('#password-prompt-input').fill(PASSWORD);
        await prompt.locator('#password-prompt-input').press('Enter');
        await expect(prompt).toBeHidden();
        await openCard(page, 'Jan');
        await expect(warRow(page)).toBeVisible();
    });
});
