import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp, followModeOf, setFollowMode } from './helpers.js';

/**
 * "Follow selection" with three modes (spec 079 K2.1): a Descendants, Fan or
 * Family window set to "switch" (their default) makes a person chosen in
 * another window its centre (the main window's chart or Table); "mark only"
 * rings the card and keeps the centre; the Map only marks (no switch on
 * offer). Two windows set to switch do not send each other's choice back
 * and forth. The mode is kept over the window's reload.
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
    // Every "select" on the windows' channel, as the main window's page hears it.
    await page.evaluate(() => {
        const w = window as unknown as { __selects: string[] };
        w.__selects = [];
        new BroadcastChannel('strom-windows').onmessage = (e: MessageEvent) => {
            const m = e.data as { type?: string; personId?: string; origin?: string };
            if (m?.type === 'select') w.__selects.push(`${m.origin}:${m.personId}`);
        };
    });
    return page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
}

async function openSatellite(context: BrowserContext, treeId: string, kind: string, w: string, errors: string[]): Promise<Page> {
    const sat = await context.newPage();
    sat.on('pageerror', e => errors.push(`${kind}: ${e.message}`));
    await sat.setViewportSize({ width: 1200, height: 800 });
    await sat.goto(`/strom.html?okno=${kind}&tree=${encodeURIComponent(treeId)}&w=${w}`);
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    await expect(sat.locator('.sat-header-title')).toHaveText('Sample: the Berg family');
    return sat;
}

const personId = (page: Page, firstName: string, lastName: string) => page.evaluate(([f, l]) =>
    window.Strom.DataManager.getAllPersons().find(p => p.firstName === f && p.lastName === l)!.id as string, [firstName, lastName]);
const focusOf = (p: Page) => p.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId() as string | null);
const selectedIn = (p: Page) => p.evaluate(() => window.Strom.TreeRenderer.getWindowSelected() as string | null);
const chooseIn = (p: Page, id: string) => p.evaluate(async (pid) => { await window.Strom.TreeRenderer.setFocus(pid as never); }, id);
const selects = (p: Page) => p.evaluate(() => (window as unknown as { __selects: string[] }).__selects.slice());
const ringed = (p: Page) => p.locator('.person-card.window-selected');

test('a Descendants window set to switch takes the person chosen in the main window\'s chart or Table as its centre; mark only rings; the Map only marks', async ({ page, context }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    const treeId = await openMain(page, context);
    const [johan, erik, thomas] = [await personId(page, 'Johan', 'Berg'), await personId(page, 'Erik', 'Berg'), await personId(page, 'Thomas', 'Berg')];
    const desc = await openSatellite(context, treeId, 'descendants', 'fw01aa', errors);
    const map = await openSatellite(context, treeId, 'map', 'fw02aa', errors);
    await expect(desc.locator('.sat-follow')).toHaveAttribute('aria-label', 'Follow selection: switch');
    expect(await followModeOf(map)).toBe('mark');
    // The Map offers no switch: its centre is not a person.
    await map.locator('.sat-follow').click();
    await expect(map.locator('.sat-follow-menu [role="menuitemradio"]')).toHaveCount(2);
    await expect(map.locator('.sat-follow-menu [data-mode="switch"]')).toHaveCount(0);
    await map.keyboard.press('Escape');
    await expect(map.locator('.sat-follow-menu')).toHaveCount(0);
    const mapFocus = await focusOf(map);

    // The main window's chart: Descendants on the person, no ring; the main window's centre is its own.
    const first = (await focusOf(page)) === erik ? thomas : erik;
    await chooseIn(page, first);
    await expect.poll(() => focusOf(desc)).toBe(first);
    await expect(card(desc, first === erik ? 'Erik' : 'Thomas')).toBeVisible();
    await expect(ringed(desc)).toHaveCount(0);
    expect(await focusOf(page)).toBe(first);
    // The Map: marked only (the person's places, if any, as another window's choice).
    await expect.poll(() => selectedIn(map)).toBe(first);
    expect(await focusOf(map)).toBe(mapFocus);

    // The main window's Table: a row chosen there, Descendants on it.
    await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('table' as never));
    const johanRow = page.locator(`#table-container .tv-body .tv-row[data-key="p:${johan}"] [role="gridcell"]`).first();
    await johanRow.scrollIntoViewIfNeeded();
    await johanRow.click();
    await expect.poll(() => focusOf(desc)).toBe(johan);
    // The new centre is not sent back: one choice on the channel, the main window's.
    await page.waitForTimeout(300);
    expect((await selects(page)).filter(s => !s.startsWith('fw'))).toEqual(await selects(page));

    // Mark only: the card's ring, the centre stays.
    await setFollowMode(desc, 'mark');
    await page.locator(`#table-container .tv-body .tv-row[data-key="p:${erik}"] [role="gridcell"]`).first().click();
    await expect(desc.locator(`.person-card.window-selected[data-id="${erik}"]`)).toHaveCount(1);
    expect(await focusOf(desc)).toBe(johan);

    // Kept over the window's reload.
    await desc.reload();
    await expect(desc.locator('.sat-header-title')).toHaveText('Sample: the Berg family');
    expect(await followModeOf(desc)).toBe('mark');
    expect(errors).toEqual([]);
});

test('two windows set to switch: each takes the other\'s choice as its centre, nothing goes back and forth', async ({ page, context }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    const treeId = await openMain(page, context);
    const [johan, erik, thomas] = [await personId(page, 'Johan', 'Berg'), await personId(page, 'Erik', 'Berg'), await personId(page, 'Thomas', 'Berg')];
    const desc = await openSatellite(context, treeId, 'descendants', 'fw11aa', errors);
    const fan = await openSatellite(context, treeId, 'fan', 'fw12aa', errors);
    expect([await followModeOf(desc), await followModeOf(fan)]).toEqual(['switch', 'switch']);
    const mainFocus = await focusOf(page);

    // A Focus in Descendants: the Fan's centre, the main window's ring, one choice on the channel.
    const a = mainFocus === erik ? thomas : erik;
    await chooseIn(desc, a);
    await expect.poll(() => focusOf(fan)).toBe(a);
    await expect.poll(() => selectedIn(page)).toBe(a);
    expect(await focusOf(page)).toBe(mainFocus);
    await page.waitForTimeout(400);
    expect(await selects(page)).toEqual([`fw11aa:${a}`]);

    // A sector of the Fan: Descendants' centre; again one choice.
    await chooseIn(fan, johan);
    await expect.poll(() => focusOf(desc)).toBe(johan);
    await page.waitForTimeout(400);
    expect(await selects(page)).toEqual([`fw11aa:${a}`, `fw12aa:${johan}`]);

    // The main window chooses: both on it, nothing sent on.
    const b = a === erik ? thomas : erik;
    await chooseIn(page, b);
    await expect.poll(() => focusOf(desc)).toBe(b);
    await expect.poll(() => focusOf(fan)).toBe(b);
    await page.waitForTimeout(400);
    expect((await selects(page)).filter(s => s.startsWith('fw'))).toEqual([`fw11aa:${a}`, `fw12aa:${johan}`]);
    expect(errors).toEqual([]);
});
