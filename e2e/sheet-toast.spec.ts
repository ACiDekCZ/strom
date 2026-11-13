/**
 * A toast and a bottom sheet over its darkened backdrop (src/sheet-toasts.ts):
 * the newer one wins. A sheet opened over a toast on the screen hides it
 * while it is open (back when the sheet closes, its time run on); a toast
 * coming while a sheet is open stands over the backdrop above the sheet,
 * its bottom edge 8 px over the sheet's top edge, its Undo at hand. Before,
 * the toast lay between the backdrop and the sheet, its second line cut by
 * the sheet's top edge. A phone (390), a phone held sideways and a touch
 * tablet. A phone's research overview is itself a sheet over the whole
 * window: a toast over it stands at the window's top. A fake bridge with
 * invented data (the Fíškovi of Smrkov).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { ManagedBridge, followManaged, overview } from './live-directions-bridge';

const QUEUE = [
    { id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001' },
    { id: 'T0102', text: 'Sčítání lidu 1880', state: 'next', research: 'G0001' },
    { id: 'T0103', text: 'Pozemková kniha Smrkov', state: 'next', research: 'G0001' },
    { id: 'T0104', text: 'Křest Jana Fíška', state: 'next', research: 'G0001', person: 'P0012' },
];
const NEXT = ['queue.next'];
/** Two lines on a phone, as the research's "opened" message. */
const OPENED = 'Opened the research Fíškovi from Strom Research — 4 persons, 2 sources (as of 12 Nov 2026)';

const row = (page: Page, id: string) => overview(page).locator(`#ov-sec-queue .live-queue > .live-queue-row[data-task="${id}"]`);
const menu = (page: Page) => page.locator('#live-task-menu');
const backdrop = (page: Page) => page.locator('.bottom-sheet-overlay.live-task-sheet');
const message = (page: Page, text: string) => page.locator('body > .toast', { hasText: text });
const orderWrites = (b: ManagedBridge) => b.writes.filter(w => w.method === 'POST' && w.path.startsWith('queue/')).map(w => [w.path, w.body]);

async function unfoldQueue(page: Page): Promise<void> {
    const head = overview(page).locator('.live-section__head[aria-controls="ov-sec-queue"]');
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
}

/** A phone 390 × 844 following the research, the overview's sheet open on its Queue. */
async function phoneQueue(page: Page): Promise<ManagedBridge> {
    const b = await followManaged(page, { features: NEXT, queue: QUEUE, size: { width: 390, height: 844 } });
    await page.locator('#live-panel .live-panel-toggle').click();
    await expect(overview(page)).toHaveClass(/research-overview--sheet/);
    await unfoldQueue(page);
    return b;
}

/** A message on the screen (as the app shows one), with an action when `action` is given. */
async function showMessage(page: Page, text: string, action?: string): Promise<void> {
    await page.evaluate(([t, a]) => {
        const w = window as unknown as { actionRun?: number };
        w.actionRun = 0;
        window.Strom.UI.showToast(t!, 10000, a ? { action: { label: a, run: () => { w.actionRun = (w.actionRun ?? 0) + 1; } } } : {});
    }, [text, action]);
}

/** The sheet's top edge once it has slid up into its place. */
async function settledTop(sheet: Locator, vh: number): Promise<number> {
    await expect.poll(async () => {
        const b = (await sheet.boundingBox())!;
        return Math.round(b.y + b.height);
    }).toBe(vh);
    return (await sheet.boundingBox())!.y;
}

/** Whether the element at the middle of `loc` is (inside) it: nothing lies over it. */
function onTop(loc: Locator): Promise<boolean> {
    return loc.evaluate(n => {
        const r = n.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit !== null && (hit === n || n.contains(hit));
    });
}

/** Nothing wider than the window. */
function overflow(page: Page): Promise<number> {
    return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe('a toast and a bottom sheet: the newer one wins', () => {
    test('390: a sheet opened over a two-line toast hides it while open; it comes back when the sheet closes', async ({ page }) => {
        await phoneQueue(page);
        await showMessage(page, OPENED);
        const opened = message(page, OPENED);
        await expect(opened).toBeVisible();
        expect((await opened.boundingBox())!.height).toBeGreaterThan(40);

        const more = row(page, 'T0103').locator('.live-queue-more');
        await more.click();
        await expect(backdrop(page)).toHaveClass(/\bactive\b/);
        const top = await settledTop(menu(page), 844);
        // Hidden under the sheet: nothing of it between the backdrop and the sheet, the sheet's title whole.
        await expect(opened).toBeHidden();
        await expect(opened).toHaveClass(/toast-under-sheet/);
        expect(await onTop(menu(page).locator('.live-task-menu__title'))).toBe(true);
        expect(top).toBeLessThan(844);
        expect(await overflow(page)).toBeLessThanOrEqual(0);

        // Closed (Escape): the toast is back for the rest of its time, over the overview's sheet
        // (over the whole window: at its top, clear of the sheet's actions at the bottom).
        await page.keyboard.press('Escape');
        await expect(backdrop(page)).toHaveCount(0);
        await expect(opened).toBeVisible();
        await expect(opened).not.toHaveClass(/toast-under-sheet/);
        await expect(opened).toHaveClass(/toast-over-sheet/);
        await expect.poll(async () => Math.round((await opened.boundingBox())!.y)).toBe(8);
        await expect(more).toBeFocused();
    });

    test('390: a toast coming while the sheet is open stands above it over the backdrop, its action at hand; the sheet stays open', async ({ page }) => {
        await phoneQueue(page);
        await row(page, 'T0103').locator('.live-queue-more').click();
        const top = await settledTop(menu(page), 844);

        await showMessage(page, 'T0103 parked until the archive answers', 'Undo');
        const t = message(page, 'T0103 parked until the archive answers');
        await expect(t).toBeVisible();
        await expect(t).toHaveClass(/toast-over-sheet/);
        // Once in its place: its bottom edge 8 px over the sheet's top edge, within the window's width.
        await expect.poll(async () => {
            const b = (await t.boundingBox())!;
            return Math.round(b.y + b.height);
        }).toBe(Math.round(top - 8));
        const b = (await t.boundingBox())!;
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(390);
        expect(b.y + b.height).toBeLessThanOrEqual(top);
        // Over the backdrop, not under it: its action takes the tap.
        const action = t.locator('.toast-action');
        expect(await onTop(action)).toBe(true);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await action.click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { actionRun: number }).actionRun)).toBe(1);
        // A press on the toast leaves the sheet open.
        await expect(menu(page)).toBeVisible();
        await expect(backdrop(page)).toHaveCount(1);

        // The sheet closed: a toast still on the screen stands over the overview's sheet, at the window's top.
        await showMessage(page, 'T0103 kept in the queue');
        const kept = message(page, 'T0103 kept in the queue');
        await expect(kept).toHaveClass(/toast-over-sheet/);
        await page.keyboard.press('Escape');
        await expect(backdrop(page)).toHaveCount(0);
        await expect(kept).toHaveClass(/toast-over-sheet/);
        await expect.poll(async () => Math.round((await kept.boundingBox())!.y)).toBe(8);
        // The overview closed too: back at its own place.
        await page.keyboard.press('Escape');
        await expect(overview(page)).toHaveCount(0);
        await expect(kept).not.toHaveClass(/toast-over-sheet/);
        await expect.poll(() => kept.evaluate(n => (n as HTMLElement).style.bottom)).toBe('');
    });

    test('390: "Do next" from the sheet with a toast standing: the toast with Undo shows whole and Undo writes', async ({ page }) => {
        const b = await phoneQueue(page);
        await showMessage(page, OPENED);
        await expect(message(page, OPENED)).toBeVisible();
        await row(page, 'T0103').locator('.live-queue-more').click();
        await expect(message(page, OPENED)).toBeHidden();
        await menu(page).locator('[data-order="next"]').click();
        await expect(menu(page)).toHaveCount(0);

        const next = page.locator('.toast[data-kind="queue-next"]');
        await expect(next).toContainText('T0103 comes up next');
        await expect(next).toBeVisible();
        const undo = next.locator('.toast-action', { hasText: 'Undo' });
        await expect(undo).toBeVisible();
        // One toast on the screen: the older message replaced by it, nothing left hidden for a sheet;
        // it stands over the overview's sheet (at the window's top).
        await expect(message(page, OPENED)).toBeHidden();
        await expect(page.locator('.toast-under-sheet')).toHaveCount(0);
        await expect(next).toHaveClass(/toast-over-sheet/);
        const box = (await next.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
        expect(await onTop(undo)).toBe(true);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await undo.click();
        await expect.poll(() => orderWrites(b).map(w => (w[1] as { do: string }).do)).toEqual(['next', 'restore']);
    });

    for (const size of [{ name: 'a phone held sideways', width: 844, height: 390 }, { name: 'a touch tablet', width: 1024, height: 768 }]) {
        test(`${size.name}: the app's sheet hides a toast standing and a toast coming stands clear of it, on top`, async ({ page }) => {
            await followManaged(page, { features: NEXT, queue: QUEUE, size: { width: size.width, height: size.height } });
            await showMessage(page, OPENED);
            const opened = message(page, OPENED);
            await expect(opened).toBeVisible();
            await page.evaluate(() => {
                const p = window.Strom.DataManager.getAllPersons()[0];
                window.Strom.UI.showPersonBottomSheet(p.id);
            });
            const sheet = page.locator('.bottom-sheet-overlay.active > .bottom-sheet');
            await expect(sheet).toBeVisible();
            // Once slid into its place (up from the bottom; sideways: in from the right, over the whole height).
            await expect.poll(() => sheet.evaluate(n => n.getAnimations().length)).toBe(0);
            await expect.poll(async () => {
                const r = (await sheet.boundingBox())!;
                return Math.round(r.y + r.height);
            }).toBe(size.height);
            const s = (await sheet.boundingBox())!;
            await expect(opened).toBeHidden();

            await showMessage(page, 'Saved', 'Undo');
            const t = message(page, 'Saved');
            await expect(t).toBeVisible();
            await expect(t).toHaveClass(/toast-over-sheet/);
            // Clear of the sheet once in its place: above it, or (a sheet at the side) left of it.
            await expect.poll(async () => {
                const b = (await t.boundingBox())!;
                return b.y + b.height <= s.y - 7 || b.x + b.width <= s.x - 7;
            }).toBe(true);
            const b = (await t.boundingBox())!;
            expect(b.y).toBeGreaterThanOrEqual(0);
            expect(b.y + b.height).toBeLessThanOrEqual(size.height);
            expect(b.x).toBeGreaterThanOrEqual(0);
            expect(b.x + b.width).toBeLessThanOrEqual(size.width);
            expect(await onTop(t.locator('.toast-action'))).toBe(true);
            expect(await overflow(page)).toBeLessThanOrEqual(0);

            // The sheet closed: the newer toast at its place (the older message replaced by it).
            await page.evaluate(() => window.Strom.UI.hideBottomSheet());
            await expect(page.locator('.bottom-sheet-overlay')).toHaveCount(0);
            await expect(t).toBeVisible();
            await expect(page.locator('.toast-under-sheet, .toast-over-sheet')).toHaveCount(0);
            expect(await t.evaluate(n => [(n as HTMLElement).style.bottom, (n as HTMLElement).style.left, (n as HTMLElement).style.maxWidth])).toEqual(['', '', '']);
        });
    }
});
