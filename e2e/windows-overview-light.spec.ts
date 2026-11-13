/**
 * The Research overview's own window and what the main window's tree does
 * (K3, 1113 D): the tree's "Verifying" drawn from the main window's snapshot
 * as the docked overview draws it (the waiting facts with Stop, the bulk
 * verification with its mark); its bulk verification opens in the main
 * window, which comes forward, Stop is written there; the main window closed
 * greys both. The group the main window's tree lights (the pill there) lit at
 * its button in the window, out once the pill ends or the main window
 * closes. The window never asks the research's bridge. A fake bridge with
 * invented data.
 */

import { test, expect, Page } from '@playwright/test';
import { BRIDGE, MANAGED_AGENT, ago, followManaged } from './live-directions-bridge';

const VERIFY = ['directions.edit', 'directions.order', 'verify', 'verify.bulk', 'verify.stop'];

/** The overview's own window, opened from the ⧉ menu; every request it makes to the bridge is kept. */
async function openWindow(page: Page): Promise<{ popup: Page; asked: string[] }> {
    await page.locator('#view-window-btn').click();
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
    const asked: string[] = [];
    popup.on('request', (req) => { if (req.url().startsWith(BRIDGE.slice(0, 22))) asked.push(req.url()); });
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
    return { popup, asked };
}

/** The main window's `window.focus()` counted (a window asking it forward ends there). */
async function countFocus(page: Page): Promise<() => Promise<number>> {
    await page.evaluate(() => {
        const w = window as unknown as { __focused: number; focus: () => void };
        const own = window.focus.bind(window);
        w.__focused = 0;
        w.focus = () => { w.__focused++; own(); };
    });
    return () => page.evaluate(() => (window as unknown as { __focused: number }).__focused);
}

const ov = (p: Page) => p.locator('#research-overview');
const verifyBlock = (p: Page) => ov(p).locator('[data-verify-section="tree"]');

async function unfold(p: Page, key: string): Promise<void> {
    const head = ov(p).locator(`.live-section__head[aria-controls="ov-sec-${key}"]`);
    await expect(head).toBeVisible();
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
}

test.describe('the main window\'s tree in the overview\'s own window', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Verifying as the docked overview draws it; the bulk verification opens in the main window, which comes forward; Stop written there; greyed with the main window closed', async ({ page }) => {
        const b = await followManaged(page, { features: VERIFY, verify: { waiting: 3 } });
        // The docked overview's block, as drawn there (its marks with it).
        await page.locator('#live-panel .live-panel-expand').click();
        await unfold(page, 'knows');
        await expect(verifyBlock(page)).toBeVisible();
        const docked = await verifyBlock(page).evaluate(n => n.outerHTML);
        const { popup, asked } = await openWindow(page);
        const focused = await countFocus(page);
        await unfold(popup, 'knows');
        await expect(verifyBlock(popup)).toBeVisible();
        expect(await verifyBlock(popup).evaluate(n => n.outerHTML)).toBe(docked);
        await expect(verifyBlock(popup).locator('.vfy-sec-pending .vfy-sec-title')).toHaveText('Waiting to be verified: 3 facts');

        // The bulk verification: its dialog opens in the main window, brought forward; nothing opens here.
        await verifyBlock(popup).locator('[data-verify-act="bulk"]').click();
        await expect(page.locator('#verify-bulk-modal')).toBeVisible();
        await expect.poll(focused).toBeGreaterThan(0);
        await expect(popup.locator('#verify-bulk-modal')).toHaveCount(0);
        // Its estimate asked of the bridge by the main window.
        await expect.poll(() => b.verifyAsks).toContain('verify/bulk');
        await page.keyboard.press('Escape');
        await expect(page.locator('#verify-bulk-modal')).toHaveCount(0);

        // Stop: written by the main window to its bridge, which says nothing waits any more; the window follows.
        const before = await focused();
        await verifyBlock(popup).locator('[data-verify-act="stop"]').click();
        await expect.poll(() => b.verifyAsks.filter(a => a === 'verify/stop')).toEqual(['verify/stop']);
        await expect(verifyBlock(popup).locator('.vfy-sec-pending')).toHaveCount(0, { timeout: 6000 });
        await expect(verifyBlock(popup).locator('[data-verify-act="bulk"]')).toBeVisible();
        expect(await focused()).toBe(before);

        // The main window closed: the block greyed with every other action.
        await page.close();
        await expect(ov(popup).locator('.research-overview__strip')).toBeVisible({ timeout: 6000 });
        await expect(verifyBlock(popup).locator('[data-verify-act="bulk"]')).toBeDisabled();
        await expect(verifyBlock(popup).locator('[data-verify-act="bulk"]')).toHaveAttribute('data-greyed', 'all');
        expect(asked).toEqual([]);
        await popup.close();
    });

    test('a group lit in the main window\'s tree is lit at its button in the window; the pill ended, it goes out', async ({ page }) => {
        // Two lines at work: each line its own row in Now, with its Show in tree.
        const second = { who: 'agent-pozemky', since: ago(40), task: 'Pozemková kniha Smrkov', person: 'P0001', research: 'G0002', session: 'N0133' };
        await followManaged(page, { features: ['directions.edit', 'directions.order'], working: [MANAGED_AGENT, second] });
        const { popup, asked } = await openWindow(page);
        const nowShow = ov(popup).locator('.research-overview__now-row--line[data-direction="G0001"] .research-overview__show-in-tree');
        await expect(nowShow).toBeVisible();
        await expect(nowShow).not.toHaveClass(/is-lit/);
        await expect(ov(popup).locator('.is-lit')).toHaveCount(0);

        // Lit in the main window (its own Research › direction's people): the window's button says so.
        await page.evaluate(() => {
            const ids = Object.keys(window.Strom.DataManager.getData().persons).slice(0, 2);
            window.Strom.UI.startPersonHighlight('direction', 'Předci: Jan Fíšek', ids as never, null);
        });
        await expect(page.locator('#evidence-pill')).toBeVisible();
        await expect(nowShow).toHaveClass(/is-lit/);
        await expect(nowShow).toHaveAttribute('aria-current', 'true');
        // Another line's button stays as it was; only the buttons of that group are lit.
        await expect(ov(popup).locator('.research-overview__now-row--line[data-direction="G0002"] .research-overview__show-in-tree')).not.toHaveClass(/is-lit/);
        await expect(ov(popup).locator('.is-lit')).toHaveCount(await ov(popup).locator('[data-lights="direction"][data-lights-name="Předci: Jan Fíšek"]').count());

        // The pill ended in the main window: out here too.
        await page.locator('#evidence-pill .evidence-pill-close').click();
        await expect(page.locator('#evidence-pill')).toHaveCount(0);
        await expect(nowShow).not.toHaveClass(/is-lit/);
        await expect(nowShow).not.toHaveAttribute('aria-current', 'true');

        // A click in the window does what it did: the main window lights it (and comes forward), the window says it is lit.
        await nowShow.click();
        await expect(page.locator('#evidence-pill')).toBeVisible();
        await expect(nowShow).toHaveClass(/is-lit/);

        // The main window closed: its tree with its light gone, nothing lit here.
        await page.close();
        await expect(ov(popup).locator('.research-overview__strip')).toBeVisible({ timeout: 6000 });
        await expect(ov(popup).locator('.is-lit')).toHaveCount(0);
        expect(asked).toEqual([]);
        await popup.close();
    });
});
