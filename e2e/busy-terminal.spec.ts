import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, openResearchMenu, handedOff, links, UUID, type FakeBridge } from './research-bridge.js';

/**
 * A link into the research's terminal (waiting buttons §3.1): the control that started it says "Opening the
 * research…" until the research says it took the link (`/status.handoffs`, feature `handoffs`), at most 10 s;
 * then a neutral sentence "Did the terminal not open?" with Try again under it, which a late confirmation takes
 * away by itself. A second click while it waits hands nothing over again.
 */

const OPEN = `strom-research://open?tree=${UUID}`;

/** A control of the page that opens the research the way the app's controls do (no element handed over). */
async function addOpenButton(page: Page): Promise<void> {
    await page.evaluate((url) => {
        const row = document.createElement('div');
        row.className = 'test-open-row busy-host';
        row.style.cssText = 'position:fixed;top:80px;left:16px;z-index:120;display:flex;gap:8px;background:var(--surface);padding:8px;max-width:360px;flex-wrap:wrap';
        const b = document.createElement('button');
        b.id = 'test-open';
        b.className = 'btn';
        b.type = 'button';
        b.textContent = 'Open research';
        b.onclick = () => window.Strom.UI.launchResearchLink(url);
        row.appendChild(b);
        document.body.appendChild(row);
    }, OPEN);
}

/** The research takes every link handed over so far. */
async function confirmAll(page: Page, bridge: FakeBridge): Promise<void> {
    bridge.handoffs = [...await handedOff(page)];
}

/** Playwright's clock forward a second at a time: the asks of the bridge answer in between. */
async function runSeconds(page: Page, s: number): Promise<void> {
    for (let i = 0; i < s; i++) {
        await page.clock.runFor(1000);
        await page.waitForTimeout(20);
    }
}

async function setup(page: Page): Promise<FakeBridge> {
    await page.clock.install({ time: new Date('2026-11-18T10:00:00Z') });
    const bridge = await fakeBridge(page, { features: ['handoffs'], handoffs: [] });
    await openResearch(page);
    await addOpenButton(page);
    return bridge;
}

test.describe('a link into the research\'s terminal', () => {
    test('a double click hands one link over; "Opening the research…" until the research confirms it', async ({ page }) => {
        const bridge = await setup(page);
        const btn = page.locator('#test-open');
        await btn.dblclick();
        await expect(btn).toHaveAttribute('aria-busy', 'true');
        await expect(btn).toContainText('Opening the research…');
        await expect(btn).toHaveAttribute('aria-disabled', 'true');
        // One more click while it waits (forced: Playwright waits for an aria-disabled control otherwise).
        await btn.click({ force: true });
        expect(await links(page)).toEqual([OPEN]);
        const ids = await handedOff(page);
        expect(ids).toHaveLength(1);
        expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        // Working is not disabled: full colour.
        await expect(btn).toHaveCSS('opacity', '1');
        await confirmAll(page, bridge);
        await runSeconds(page, 2);
        await expect(btn).not.toHaveAttribute('aria-busy', 'true');
        await expect(btn).toHaveText('Open research');
        await expect(page.locator('.busy-msg')).toHaveCount(0);
    });

    test('no confirmation in 10 s: the button at rest, the sentence with Try again; a late confirmation takes it away', async ({ page }) => {
        const bridge = await setup(page);
        const btn = page.locator('#test-open');
        await btn.click();
        await runSeconds(page, 8);
        await expect(btn).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('.busy-msg')).toHaveCount(0);
        await runSeconds(page, 3);
        await expect(btn).not.toHaveAttribute('aria-busy', 'true');
        const msg = page.locator('.busy-msg');
        await expect(msg).toHaveAttribute('role', 'status');
        await expect(msg).toContainText('Did the terminal not open?');
        await expect(msg).toContainText('If nothing opened, Strom Research needs to be started.');
        await expect(msg.getByRole('button', { name: 'Try again' })).toBeVisible();
        // The browser's "Open Strom Research?" answered late: the research confirms the link after the limit.
        await runSeconds(page, 5);
        await expect(msg).toBeVisible();
        await confirmAll(page, bridge);
        await runSeconds(page, 3);
        await expect(page.locator('.busy-msg')).toHaveCount(0);
    });

    test('Try again hands the link over once more, with a new id', async ({ page }) => {
        await setup(page);
        await page.locator('#test-open').click();
        await runSeconds(page, 11);
        await page.locator('.busy-msg').getByRole('button', { name: 'Try again' }).click();
        await expect(page.locator('#test-open')).toHaveAttribute('aria-disabled', 'true');
        expect(await links(page)).toEqual([OPEN, OPEN]);
        const ids = await handedOff(page);
        expect(new Set(ids).size).toBe(2);
    });

    test('from the Research menu: the menu closes, a toast carries the state until the confirmation', async ({ page }) => {
        const bridge = await setup(page);
        await openResearchMenu(page);
        await page.locator('#research-item-open').click();
        const toast = page.locator('.toast--progress');
        await expect(toast).toContainText('Opening the research…');
        await expect(toast.locator('.busy-spin')).toHaveCount(1);
        await confirmAll(page, bridge);
        await runSeconds(page, 3);
        await expect(page.locator('.toast--progress.show')).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: 'Did the terminal not open?' })).toHaveCount(0);
    });

    test('in a dialog\'s footer the sentence stands above the footer, not under the dialog\'s last line', async ({ page }) => {
        await setup(page);
        await page.evaluate((url) => {
            const UI = window.Strom.UI as unknown as { showConfirm: (m: string, t: string) => Promise<boolean>; launchResearchLink: (u: string, k: string, el: HTMLElement) => void };
            void UI.showConfirm('The research opens.', 'Research');
            UI.launchResearchLink(url, 'terminal', document.getElementById('confirm-ok-btn')!);
        }, OPEN);
        await expect(page.locator('#confirm-ok-btn')).toHaveAttribute('aria-busy', 'true');
        await runSeconds(page, 11);
        const msg = page.locator('#confirmation-modal .busy-msg');
        await expect(msg).toContainText('Did the terminal not open?');
        expect(await page.evaluate(() => document.getElementById('confirm-buttons')!.previousElementSibling?.classList.contains('busy-msg'))).toBe(true);
        // Its text in line with the footer's buttons' side, not at the dialog's edge.
        const sides = await page.evaluate(() => {
            const m = document.querySelector<HTMLElement>('#confirmation-modal .busy-msg')!.getBoundingClientRect();
            const f = document.getElementById('confirm-buttons')!;
            const pad = parseFloat(getComputedStyle(f).paddingLeft);
            const text = document.querySelector<HTMLElement>('#confirmation-modal .busy-msg__text, #confirmation-modal .busy-msg > span')!.getBoundingClientRect();
            return { textLeft: text.left - f.getBoundingClientRect().left, pad, width: m.width };
        });
        expect(Math.abs(sides.textLeft - sides.pad)).toBeLessThan(2);
    });

    test('a list drawn anew keeps the sentence under its new button; a list gone takes it away', async ({ page }) => {
        await setup(page);
        const LIST = '<div data-id="T0001"><span>Write to the parish</span><div class="acts"><button type="button" class="btn" data-action="chat">Chat</button></div></div>';
        await page.evaluate(({ url, html }) => {
            const list = document.createElement('div');
            list.id = 'test-list';
            list.style.cssText = 'position:fixed;top:160px;left:16px;z-index:120;background:var(--surface);padding:8px;width:320px';
            list.innerHTML = html;
            document.body.appendChild(list);
            const b = list.querySelector<HTMLElement>('[data-action="chat"]')!;
            b.onclick = () => (window.Strom.UI as unknown as { launchResearchLink: (u: string, k: string, el: HTMLElement) => void }).launchResearchLink(url, 'terminal', b);
        }, { url: `strom-research://task?tree=${UUID}&task=T0001&do=chat`, html: LIST });
        await page.locator('#test-list [data-action="chat"]').click();
        await runSeconds(page, 1);
        // Drawn anew while the link waits: the new button carries the working state and takes no second click.
        await page.evaluate((html) => { document.getElementById('test-list')!.innerHTML = html; }, LIST);
        await runSeconds(page, 1);
        const again = page.locator('#test-list [data-action="chat"]');
        await expect(again).toHaveAttribute('aria-busy', 'true');
        await expect(again).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('.toast--progress')).toHaveCount(0);
        await runSeconds(page, 10);
        await expect(again).not.toHaveAttribute('aria-busy', 'true');
        const msg = page.locator('#test-list [data-id="T0001"] .busy-msg');
        await expect(msg).toContainText('Did the terminal not open?');
        // The list drawn anew (a new status): the sentence stands under the new button at once.
        expect(await page.evaluate(async (html) => {
            document.getElementById('test-list')!.innerHTML = html;
            await new Promise(r => queueMicrotask(() => r(null)));
            return !!document.querySelector('#test-list [data-id="T0001"] .busy-msg');
        }, LIST)).toBe(true);
        // The list gone for good: the sentence goes with it.
        await page.evaluate(() => document.getElementById('test-list')!.remove());
        await runSeconds(page, 1);
        await expect(page.locator('.busy-msg')).toHaveCount(0);
    });

    test('reduced motion: the spinner stands still as three dots', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await setup(page);
        const btn = page.locator('#test-open');
        await btn.click();
        const spin = btn.locator('.busy-spin');
        await expect(spin).toBeVisible();
        await expect(spin).toHaveCSS('animation-name', 'none');
        await expect(spin).toHaveCSS('background-image', /radial-gradient/);
        await expect(spin).toHaveCSS('border-top-width', '0px');
    });
});
