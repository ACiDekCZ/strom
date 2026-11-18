import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp, setFollowMode, followModeOf } from './helpers.js';

/**
 * "Focus" sent from another window (spec 110): a Table window whose choices
 * are sent with `focus` makes the chosen person the main window's centre,
 * also one the main window's chart did not draw; running down the rows with
 * the arrow keys changes the centre once, to the last row; one Back returns
 * to the centre before the run. "Mark" keeps the centre, "off" sends
 * nothing. The window's header chooses it in "Selection" (spec 110 §1):
 * This window / Main window, the main window's group greyed while off or
 * without the main window, none in a chart's view.
 */

const NOW = new Date('2026-06-15T10:00:00Z');

async function openMain(page: Page, context: BrowserContext): Promise<string> {
    await context.clock.install({ time: NOW });
    await context.route('**://tile.openstreetmap.org/**', r => r.abort());
    await context.route('**://nominatim.openstreetmap.org/**', r => r.abort());
    await page.setViewportSize({ width: 1400, height: 900 });
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    // Every new centre of the main window, and every choice on the windows' channel.
    await page.evaluate(() => {
        const w = window as unknown as { __focuses: string[]; __selects: string[] };
        w.__focuses = [];
        w.__selects = [];
        window.addEventListener('strom:focus-changed', (e) => { w.__focuses.push((e as CustomEvent<{ personId: string }>).detail.personId); });
        new BroadcastChannel('strom-windows').onmessage = (e: MessageEvent) => {
            const m = e.data as { type?: string; personId?: string; intent?: string };
            if (m?.type === 'select') w.__selects.push(`${m.intent ?? '-'}:${m.personId}`);
        };
    });
    return page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
}

async function openTable(context: BrowserContext, treeId: string, w: string, send: 'focus' | 'mark', errors: string[]): Promise<Page> {
    const sat = await context.newPage();
    sat.on('pageerror', e => errors.push(`table: ${e.message}`));
    // The send mode as the header's choice keeps it (A2's menu sets the same key).
    if (send === 'focus') await sat.addInitScript((key) => { sessionStorage.setItem(key, 'focus'); }, `strom.win.send.${w}`);
    await sat.setViewportSize({ width: 1200, height: 800 });
    await sat.goto(`/strom.html?okno=table&tree=${encodeURIComponent(treeId)}&w=${w}`);
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    await expect(sat.locator('.sat-header-title')).toHaveText('Sample: the Berg family');
    return sat;
}

const focusOf = (p: Page) => p.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId() as string | null);
const focuses = (p: Page) => p.evaluate(() => (window as unknown as { __focuses: string[] }).__focuses.slice());
const selects = (p: Page) => p.evaluate(() => (window as unknown as { __selects: string[] }).__selects.slice());
const row = (p: Page, id: string) => p.locator(`#table-container .tv-body .tv-row[data-key="p:${id}"] [role="gridcell"]`).first();
/** A person of the sample the main window's chart does not draw now. */
const undrawn = (p: Page) => p.evaluate(() => window.Strom.DataManager.getAllPersons()
    .map(x => x.id as string)
    .find(id => !document.querySelector(`.person-card[data-id="${CSS.escape(id)}"]`)) ?? null);

test('focus from a Table window: the chosen person becomes the main window\'s centre (also one not drawn there), with the notice; one Back returns', async ({ page, context }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    const treeId = await openMain(page, context);
    const before = await focusOf(page);
    const target = await undrawn(page);
    expect(target).not.toBeNull();
    const sat = await openTable(context, treeId, 'sf01aa', 'focus', errors);

    const r = row(sat, target!);
    await r.scrollIntoViewIfNeeded();
    await r.click();
    await expect.poll(() => focusOf(page)).toBe(target);
    await expect(page.locator(`.person-card[data-id="${target}"]`)).toHaveCount(1);
    const notice = page.locator('#window-notice .wn-box[data-kind="focus"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Centre chosen in another window');
    await expect(page.locator('#window-notice-status')).toHaveText('Centre chosen in another window');
    expect((await selects(page)).at(-1)).toBe(`focus:${target}`);

    // ↶ is the centre before: one Back returns there and the notice goes.
    await page.evaluate(() => window.Strom.TreeRenderer.goBack());
    await expect.poll(() => focusOf(page)).toBe(before);
    await expect(page.locator('#window-notice .wn-box')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('arrow keys over the rows: one change of the centre, to the last row; one Back returns to the centre before the run', async ({ page, context }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    const treeId = await openMain(page, context);
    const before = await focusOf(page);
    const sat = await openTable(context, treeId, 'sf02aa', 'focus', errors);

    // A row that is not the centre, then four rows down quickly.
    const rows = sat.locator('#table-container .tv-body .tv-row[data-key^="p:"]');
    const keys = await rows.evaluateAll(els => els.map(e => (e.getAttribute('data-key') ?? '').slice(2)));
    const start = keys.findIndex(k => k !== before);
    await row(sat, keys[start]).click();
    await expect.poll(() => focusOf(page)).toBe(keys[start]);
    const n0 = (await focuses(page)).length;
    for (let i = 0; i < 4; i++) await sat.keyboard.press('ArrowDown');
    const last = await sat.evaluate(() => {
        const r = document.activeElement?.closest('.tv-row');
        return (r?.getAttribute('data-key') ?? '').slice(2);
    });
    expect(last).not.toBe(keys[start]);
    await expect.poll(() => focusOf(page)).toBe(last);
    await page.waitForTimeout(400);
    // One transition for the four rows.
    expect((await focuses(page)).slice(n0)).toEqual([last]);
    // The run is one step of the history: Back returns to the centre before the first row.
    await page.evaluate(() => window.Strom.TreeRenderer.goBack());
    await expect.poll(() => focusOf(page)).toBe(before);
    expect(errors).toEqual([]);
});

test('mark keeps the main window\'s centre (the card ringed); off sends nothing', async ({ page, context }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    const treeId = await openMain(page, context);
    const before = await focusOf(page);
    const sat = await openTable(context, treeId, 'sf03aa', 'mark', errors);
    const drawn = await page.evaluate((f) => [...document.querySelectorAll<HTMLElement>('.person-card[data-id]')]
        .map(c => c.dataset.id!).find(id => id !== f) ?? null, before);
    expect(drawn).not.toBeNull();

    await row(sat, drawn!).click();
    await expect(page.locator(`.person-card.window-selected[data-id="${drawn}"]`)).toHaveCount(1);
    await page.waitForTimeout(400);
    expect(await focusOf(page)).toBe(before);
    expect((await selects(page)).at(-1)).toBe(`mark:${drawn}`);

    // Mark only, a person not drawn in the chart: the notice says so with "Go to".
    const away = await undrawn(page);
    const r = row(sat, away!);
    await r.scrollIntoViewIfNeeded();
    await r.click();
    const notice = page.locator('#window-notice .wn-box[data-kind="not-in-view"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('is not in this view.');
    await notice.getByRole('button', { name: 'Go to' }).click();
    await expect.poll(() => focusOf(page)).toBe(away);
    await expect(page.locator('#window-notice .wn-box')).toHaveCount(0);

    // Off: nothing on the channel.
    await setFollowMode(sat, 'off');
    const n = (await selects(page)).length;
    await row(sat, before!).click();
    await page.waitForTimeout(400);
    expect((await selects(page)).length).toBe(n);
    expect(await focusOf(page)).toBe(away);
    expect(errors).toEqual([]);
});

const control = (p: Page) => p.locator('.sat-follow');
const menu = (p: Page) => p.locator('.sat-follow-menu');

test('"Selection" in a Table window: mark only by default, Focus chosen in the menu makes the main window\'s centre; off greys the main window\'s group and sends nothing; the choice is kept; a Family view has no such group; without the main window it is greyed', async ({ page, context }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    const treeId = await openMain(page, context);
    const sat = await openTable(context, treeId, 'sf04aa', 'mark', errors);

    // Mark only by default; at 1200 px both directions in words, no "Selection:".
    await expect(control(sat)).toHaveAttribute('data-send', 'mark');
    await expect(control(sat)).toHaveAttribute('aria-label', 'Person selection between windows. From other windows: mark only. To the main window: mark only.');
    await expect(control(sat)).toHaveAttribute('aria-haspopup', 'menu');
    await expect(sat.locator('.sat-follow-label')).toBeHidden();
    await expect(sat.locator('.sat-follow-state')).toHaveText('mark only');
    await expect(sat.locator('.sat-follow-send-state')).toHaveText('mark only');

    // The menu: two groups, Focus named as the card's Focus.
    await control(sat).click();
    await expect(control(sat)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(sat).locator('[role="group"]')).toHaveCount(2);
    await expect(menu(sat).locator('[role="group"]').nth(0)).toHaveAttribute('aria-label', 'This window');
    await expect(menu(sat).locator('[role="group"]').nth(1)).toHaveAttribute('aria-label', 'Main window');
    await expect(menu(sat).locator('[data-send="mark"]')).toHaveAttribute('aria-checked', 'true');
    await expect(menu(sat).locator('[data-send="focus"] .view-window-item-label')).toHaveText('focus');
    await menu(sat).locator('[data-send="focus"]').click();
    await expect(menu(sat)).toHaveCount(0);
    await expect(control(sat)).toHaveAttribute('data-send', 'focus');
    await expect(sat.locator('.sat-follow-send-state')).toHaveText('focus');
    expect(await sat.evaluate(() => sessionStorage.getItem('strom.win.send.sf04aa'))).toBe('focus');

    // A row chosen now makes the main window's centre.
    const target = await undrawn(page);
    const r = row(sat, target!);
    await r.scrollIntoViewIfNeeded();
    await r.click();
    await expect.poll(() => focusOf(page)).toBe(target);
    expect((await selects(page)).at(-1)).toBe(`focus:${target}`);

    // Off: the main window's group stays, greyed, Focus still checked, with its note; a click there does nothing; nothing sent.
    await setFollowMode(sat, 'off');
    await expect(control(sat)).toHaveAttribute('aria-label', 'Person selection between windows: off.');
    await expect(sat.locator('.sat-follow-send')).toBeHidden();
    await control(sat).click();
    const main = menu(sat).locator('[role="group"]').nth(1);
    await expect(main).toHaveAttribute('aria-disabled', 'true');
    await expect(main.locator('[data-send="focus"]')).toHaveAttribute('aria-checked', 'true');
    await expect(main.locator('[data-send="focus"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(main.locator('.sat-follow-note')).toHaveText('Unavailable – selection sharing is off in this window.');
    await main.locator('[data-send="mark"]').click({ force: true });
    await expect(menu(sat)).toBeVisible();
    await sat.keyboard.press('Escape');
    await expect(menu(sat)).toHaveCount(0);
    expect(await sat.evaluate(() => sessionStorage.getItem('strom.win.send.sf04aa'))).toBe('focus');
    const n = (await selects(page)).length;
    const other = await sat.locator('#table-container .tv-body .tv-row[data-key^="p:"]').evaluateAll((els, t) => els
        .map(e => (e.getAttribute('data-key') ?? '').slice(2)).find(k => k !== t)!, target);
    await row(sat, other).click();
    await page.waitForTimeout(400);
    expect((await selects(page)).length).toBe(n);

    // Kept over a reload; on again, Focus applies again. The arrows go through both groups, Enter chooses.
    await sat.reload();
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    expect(await followModeOf(sat)).toBe('off');
    await setFollowMode(sat, 'mark');
    await expect(control(sat)).toHaveAttribute('data-send', 'focus');
    await control(sat).focus();
    await sat.keyboard.press('ArrowDown');
    await expect(menu(sat).locator('[data-mode="mark"]')).toBeFocused();
    await sat.keyboard.press('ArrowDown');
    await sat.keyboard.press('ArrowDown');
    await expect(menu(sat).locator('[data-send="mark"]')).toBeFocused();
    await sat.keyboard.press('Enter');
    await expect(menu(sat)).toHaveCount(0);
    await expect(control(sat)).toHaveAttribute('data-send', 'mark');
    await expect(control(sat)).toBeFocused();

    // A Family view: the window's own direction alone, no main window's group.
    await sat.locator('.sat-view-segment [data-view="family"]').click();
    await expect(control(sat)).not.toHaveAttribute('data-send', /./);
    await control(sat).click();
    await expect(menu(sat).locator('[role="group"]')).toHaveCount(1);
    await expect(menu(sat).locator('[data-send]')).toHaveCount(0);
    await sat.keyboard.press('Escape');
    await sat.locator('.sat-view-segment [data-view="table"]').click();
    await expect(control(sat)).toHaveAttribute('data-send', 'mark');

    // Without the main window: the group greyed with its note, the choice kept.
    await page.close();
    await expect(sat.locator('.sat-follow-send')).toHaveClass(/is-muted/, { timeout: 4500 });
    await control(sat).click();
    await expect(menu(sat).locator('[role="group"]').nth(1)).toHaveAttribute('aria-disabled', 'true');
    await expect(menu(sat).locator('.sat-follow-note')).toHaveText('The main window is not open.');
    expect(errors).toEqual([]);
});
