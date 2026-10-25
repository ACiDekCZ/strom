import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * Message toasts on a phone (017 j): as wide as the phone allows (16px
 * gutters; held sideways, the room beside the side bar up to 420px), never
 * only the half right of their centre; a long sentence wraps; they cover
 * none of the floating buttons (back / forward, the zoom stack, the bar).
 * The desktop toast is as before.
 */

const LONG = 'Not sent. This copy of the tree does not have the research numbers for its people yet, so it would arrive there as a second family tree.';

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function sampleWithBack(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#toolbar-focus-name')).not.toHaveText('');
    await page.evaluate(() => {
        const S = window.Strom;
        const ids = Object.keys(S.DataManager.getData().persons);
        S.TreeRenderer.setFocus(ids[5] as never);
    });
    await expect(page.locator('#focus-back-btn')).toBeVisible();
}

/** A toast that stays, with an action and its ×, slid in. */
async function longToast(page: Page, text = LONG): Promise<Locator> {
    await page.evaluate((t) => window.Strom.UI.showToast(t, Infinity, { closable: true, action: { label: 'Load the version', run: () => undefined } }), text);
    const toast = page.locator('.toast.show');
    await expect(toast).toBeVisible();
    // Measured once it has slid in.
    await expect.poll(() => toast.evaluate(e => getComputedStyle(e).transform)).toMatch(/, 0\)$|^none$/);
    return toast;
}

/** None of the floating buttons and bars under the toast, nothing inside it wider than it. */
async function coversNothing(page: Page, toast: Locator): Promise<void> {
    const t = (await toast.boundingBox())!;
    for (const sel of ['#focus-back-btn', '#focus-forward-btn', '.zoom-controls button', '#bottom-bar']) {
        for (const el of await page.locator(sel).all()) {
            if (!await el.isVisible()) continue;
            const b = (await el.boundingBox())!;
            expect(overlaps(t, b), `${sel} under the toast`).toBe(false);
        }
    }
    expect(await toast.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
}

/** Every frame of a toast's slide in and out, measured against the shown elements under it. */
async function crossings(page: Page, selectors: string[], atLeast: number): Promise<string[]> {
    return page.evaluate(async ({ t, selectors, atLeast }) => {
        const under = selectors
            .map(s => document.querySelector(s) as HTMLElement | null)
            .filter((e): e is HTMLElement => !!e && e.checkVisibility())
            .map(e => e.getBoundingClientRect());
        if (under.length < atLeast) return [`${under.length} elements shown`];
        const hits: string[] = [];
        const frames = async (ms: number): Promise<void> => {
            const end = performance.now() + ms;
            while (performance.now() < end) {
                await new Promise(r => requestAnimationFrame(r));
                const el = document.querySelector('.toast');
                if (!el) continue;
                const r = el.getBoundingClientRect();
                for (const b of under) {
                    if (r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom) hits.push(`${Math.round(r.top)}–${Math.round(r.bottom)} over ${Math.round(b.top)}`);
                }
            }
        };
        window.Strom.UI.showToast(t, 500);
        await frames(1200);
        return hits;
    }, { t: LONG, selectors, atLeast });
}

/** The action whole on one line under the sentence, the × beside the sentence. */
async function actionWhole(toast: Locator): Promise<void> {
    const a = (await toast.locator('.toast-action').boundingBox())!;
    const x = (await toast.locator('.toast-close').boundingBox())!;
    expect(a.height).toBeLessThan(30);
    expect(a.y).toBeGreaterThan(x.y + x.height);
}

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('390: a long toast takes the width between 16px gutters, wraps, covers no button', async ({ page }) => {
        await sampleWithBack(page);
        const toast = await longToast(page);
        const t = (await toast.boundingBox())!;
        expect(Math.round(t.x)).toBe(16);
        expect(Math.round(t.width)).toBe(390 - 32);
        // Wrapped onto several lines (one line is about 20px).
        expect(t.height).toBeGreaterThan(60);
        await actionWhole(toast);
        await coversNothing(page, toast);
    });

    test('390: coming and going, the toast never slides across back / forward or the bar', async ({ page }) => {
        await sampleWithBack(page);
        // Back and the bar at least (forward only once there is a way forward).
        expect(await crossings(page, ['#focus-back-btn', '#focus-forward-btn', '#bottom-bar'], 2)).toEqual([]);
    });

    test('390: a short toast stays as wide as its text, centred', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 6000));
        const toast = page.locator('.toast.show');
        await expect(toast).toBeVisible();
        const t = (await toast.boundingBox())!;
        expect(t.width).toBeLessThan(150);
        expect(Math.abs(t.x + t.width / 2 - 195)).toBeLessThan(2);
    });
});

test.describe('a window as narrow as a phone, with a mouse', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('390: ＋ and − stay in the zoom stack, the toast leaves them their column', async ({ page }) => {
        await sampleWithBack(page);
        await expect(page.locator('.zoom-controls button').first()).toBeVisible();
        const toast = await longToast(page);
        const t = (await toast.boundingBox())!;
        expect(Math.round(t.x)).toBe(16);
        await actionWhole(toast);
        await coversNothing(page, toast);
    });
});

test.describe('phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('844 × 390: the room beside the side bar up to 420px, covering no button', async ({ page }) => {
        await sampleWithBack(page);
        const toast = await longToast(page);
        const t = (await toast.boundingBox())!;
        expect(Math.round(t.width)).toBe(420);
        const bar = (await page.locator('#bottom-bar').boundingBox())!;
        expect(t.x).toBeGreaterThanOrEqual(bar.x + bar.width);
        expect(t.x + t.width).toBeLessThanOrEqual(844);
        await actionWhole(toast);
        await coversNothing(page, toast);
    });
});

test.describe('tablet', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('1024: coming and going, the toast never slides across the bottom bar', async ({ page }) => {
        await sampleWithBack(page);
        expect(await crossings(page, ['#bottom-bar'], 1)).toEqual([]);
    });
});

test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('1440: the toast as before (at most the half right of its centre)', async ({ page }) => {
        await openApp(page);
        const toast = await longToast(page, LONG + ' ' + LONG);
        const t = (await toast.boundingBox())!;
        expect(t.width).toBeLessThanOrEqual(720);
        expect(Math.abs(t.x + t.width / 2 - 720)).toBeLessThan(2);
        expect(await toast.evaluate(e => getComputedStyle(e).paddingLeft)).toBe('24px');
    });
});

/**
 * The tour offer after the sample tree and a long toast with an action (both bottom-centre, the offer
 * above): the offer steps aside while the toast shows, so the toast's action is the one under a tap
 * at its centre; once the toast is gone the offer is back.
 */
async function offerAndToast(page: Page): Promise<void> {
    await openApp(page, { tourOffer: true });
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    const offer = page.locator('.tour-offer');
    await expect(offer).toBeVisible();
    const toast = await longToast(page);
    const action = toast.locator('.toast-action');
    await expect.poll(() => action.evaluate((a) => {
        const r = a.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === a;
    })).toBe(true);
    // Nothing of the offer over the toast (it may stay only where it leaves the toast free).
    await expect.poll(async () => {
        if (!await offer.isVisible()) return false;
        return overlaps((await offer.boundingBox())!, (await toast.boundingBox())!);
    }).toBe(false);
    await toast.locator('.toast-close').click();
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(offer).toBeVisible();
    await expect(offer.locator('.tour-offer-btn')).toBeEnabled();
    await offer.locator('.tour-offer-btn').click();
    await expect(page.locator('#tour-overlay')).toHaveClass(/active/);
}

test.describe('tour offer and a toast, phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('390 touch: the tour offer leaves the toast and its action free', async ({ page }) => { await offerAndToast(page); });
});

test.describe('tour offer and a toast, phone-narrow window with a mouse', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('390 mouse: the tour offer leaves the toast and its action free', async ({ page }) => { await offerAndToast(page); });
});

test.describe('tour offer and a toast, tablet', () => {
    test.use({ viewport: { width: 1024, height: 768 } });
    test('1024: the tour offer leaves the toast and its action free', async ({ page }) => { await offerAndToast(page); });
});

test.describe('tour offer and a toast, desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test('1440: the tour offer leaves the toast and its action free', async ({ page }) => { await offerAndToast(page); });
});

/**
 * Clear of the floating controls (round 7 §55): the undo pill and a message at its place (carrying
 * its "Undo") stand between ↩ / ↪ and the zoom stack's ⛶, 8px from each, never over them; a
 * message's actions are one group that wraps whole to the next line, a separator only between two
 * of them (none at a line's end, none before the first).
 */
const DE_LONG = 'Gespeichert: die Änderungen gehen mit der nächsten Kopie hinaus';

/** The pill, then (its 3 s over) a message with an action at its place carrying its "Undo". */
async function pillThenMessage(page: Page, text: string, action: string): Promise<{ pill: Box; msg: Locator }> {
    // The sample tree's message put away: the pill at its own place, low in the row of ↩ and ⛶
    await page.evaluate(() => document.querySelectorAll('body > .toast').forEach(t => t.remove()));
    await expect(page.locator('body > .toast')).toHaveCount(0);
    await page.evaluate(() => window.Strom.UI.showUndoToast('deleting Ann Berg'));
    const pillEl = page.locator('body > .undo-toast.show');
    await expect(pillEl).toBeVisible();
    await expect(pillEl).not.toHaveClass(/at-message-toast/);
    await expect.poll(() => pillEl.evaluate(e => e.getAnimations().length)).toBe(0);
    const pill = (await pillEl.boundingBox())!;
    await page.evaluate(([t, a]) => window.Strom.UI.showToast(t, 10000, { action: { label: a, run: () => undefined } }), [text, action] as const);
    const msg = page.locator('body > .toast.show');
    await expect(msg).toBeVisible({ timeout: 5000 });
    await expect(msg.locator('.undo-toast-btn')).toBeVisible();
    await expect.poll(() => msg.evaluate(e => e.getAnimations().length)).toBe(0);
    return { pill, msg };
}

/** The box between ↩ / ↪ and ⛶, 8px from each where they show in its row; how many are in its row. */
async function clearOfControls(page: Page, box: Box, what: string): Promise<number> {
    let inRow = 0;
    for (const sel of ['#focus-back-btn', '#focus-forward-btn', '.zoom-controls > button']) {
        for (const el of await page.locator(sel).all()) {
            if (!await el.isVisible()) continue;
            const b = (await el.boundingBox())!;
            if (b.y >= box.y + box.height || box.y >= b.y + b.height) continue;
            inRow++;
            if (b.x + b.width / 2 < box.x + box.width / 2) expect(box.x, `${what} 8px right of ${sel}`).toBeGreaterThanOrEqual(b.x + b.width + 8 - 0.5);
            else expect(box.x + box.width, `${what} 8px left of ${sel}`).toBeLessThanOrEqual(b.x - 8 + 0.5);
        }
    }
    return inRow;
}

/** The message's actions in one group on one line, its first shown item a button. */
async function actionsWhole(msg: Locator, count: number): Promise<void> {
    const group = msg.locator(':scope > .toast-actions');
    await expect(group).toHaveCount(1);
    const items = await group.evaluate(g => [...g.children].filter(c => (c as HTMLElement).checkVisibility())
        .map(c => { const r = c.getBoundingClientRect(); return { tag: c.tagName, mid: r.top + r.height / 2 }; }));
    expect(items.filter(i => i.tag === 'BUTTON')).toHaveLength(count);
    expect(items[0].tag).toBe('BUTTON');
    expect(items[items.length - 1].tag).toBe('BUTTON');
    for (const i of items) expect(Math.abs(i.mid - items[0].mid)).toBeLessThanOrEqual(2);
}

test.describe('clear of the floating controls, phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('390: the undo pill and a message at its place stand between ↩ and ⛶, 8px from each (round 7 §55)', async ({ page }) => {
        await sampleWithBack(page);
        const { pill, msg } = await pillThenMessage(page, 'Saved: the changes go out with the next copy', 'Open');
        // Both in the row of ↩ and ⛶
        expect(await clearOfControls(page, pill, 'the pill')).toBe(2);
        expect(await clearOfControls(page, (await msg.boundingBox())!, 'the message')).toBe(2);
        await actionsWhole(msg, 2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});

test.describe('clear of the floating controls, phone held sideways (de)', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('844 × 390 de: the actions wrap whole to the next line, no separator at its end; clear of ↩ and ⛶ (round 7 §55)', async ({ page }) => {
        await sampleWithBack(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('de'));
        const { pill, msg } = await pillThenMessage(page, DE_LONG, 'Öffnen');
        await clearOfControls(page, pill, 'the pill');
        const m = (await msg.boundingBox())!;
        await clearOfControls(page, m, 'the message');
        // Two lines: the sentence, then the group of both actions under it
        expect(m.height).toBeGreaterThan(50);
        await actionsWhole(msg, 2);
        expect(await msg.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    });
});

/**
 * The undo pill's sentence is never cut (prod 3.16 finding 1): after a message has gone, the pill stands
 * at its own place, between ↩ and ⛶ where its sentence fits there (round 7 §55); a longer sentence (a
 * person's edit with the name and year) stands above them at the phone's width, whole, covering no button.
 */
async function pillAfterClosedMessage(page: Page): Promise<Locator> {
    await page.evaluate(() => document.querySelectorAll('body > .toast').forEach(t => t.remove()));
    const toast = await longToast(page);
    await toast.locator('.toast-close').click();
    await expect(page.locator('body > .toast')).toHaveCount(0);
    return page.locator('body > .undo-toast.show');
}

async function settled(pill: Locator): Promise<Box> {
    await expect(pill).toBeVisible();
    await expect.poll(() => pill.evaluate(e => e.getAnimations().length)).toBe(0);
    return (await pill.boundingBox())!;
}

test.describe('the undo pill whole, phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    for (const lang of ['cs', 'de'] as const) {
        test(`390 ${lang}: after a closed message, a person's edit names the person whole, covering no button`, async ({ page }) => {
            await sampleWithBack(page);
            await page.evaluate(l => window.Strom.UI.setLanguage(l), lang);
            const pill = await pillAfterClosedMessage(page);
            const name = await page.evaluate(() => {
                const DM = window.Strom.DataManager;
                const p = DM.getAllPersons()[5];
                DM.updatePerson(p.id, { notes: 'x' });
                return p.firstName;
            });
            await settled(pill);
            await expect(pill).not.toHaveClass(/at-message-toast|at-focus-toast/);
            const msg = pill.locator('.undo-toast-msg');
            await expect(msg).toContainText(name);
            // The whole sentence: nothing hidden behind "…"
            expect(await msg.evaluate(e => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight + 1)).toBe(true);
            await coversNothing(page, pill);
        });
    }

    test('390: a sentence that fits stays between ↩ and ⛶ (round 7 §55)', async ({ page }) => {
        await sampleWithBack(page);
        const pill = await pillAfterClosedMessage(page);
        await page.evaluate(() => window.Strom.UI.showUndoToast('editing Ann'));
        const box = await settled(pill);
        expect(await clearOfControls(page, box, 'the pill')).toBe(2);
        expect(await pill.locator('.undo-toast-msg').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    });
});
