import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, links, UUID, type FakeBridge } from './research-bridge.js';

/**
 * "Research on" (spec 064): the research tree's switch in the research panel
 * and in the tree manager shows whether its bridge runs; off through the
 * bridge (`POST /live {"do":"stop"}`, feature `live.stop`), on by the quiet
 * link `live?tree=…&do=start` (feature `live.start`, no mark); without the
 * features only the state and the command (nothing sent). Settings › Research
 * on this computer writes the choice (`POST /live {"idleMinutes"}`, feature
 * `live.idle`) or names the commands. A phone has no switch. The idle panel
 * while the research is off has no switch: "Switch on" (the same link) and one
 * command under it. Off, a missing `live.start` leaves only the command when
 * the research said so as it is now (its version, nothing newer known); after
 * an update the link is offered. Invented data.
 */

const ALL = ['live.idle', 'live.stop', 'live.start'];

async function setup(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, { features: ALL, live: { idleMinutes: 0, writes: [] }, ...init });
    await openResearch(page);
    await poll(page);
    return b;
}

async function idlePanel(page: Page) {
    await page.evaluate(() => window.Strom.UI.showResearchWaiting());
    const panel = page.locator('#live-panel.idle');
    await expect(panel).toBeVisible();
    return panel;
}

/** What the bridge remembered for the switch (as after its last status and end). */
async function remember(page: Page, state: Record<string, unknown>): Promise<void> {
    await page.evaluate(({ id, s }) => localStorage.setItem(`strom-research-live:${id}`, JSON.stringify(s)), { id: UUID, s: state });
}

const liveWrites = (b: FakeBridge) => b.live!.writes;
const livePosts = (b: FakeBridge) => (b.seen ?? []).filter(s => s === 'POST /live');

test.describe('Research on: the switch', () => {
    test('on in the panel; switched off through the bridge, the off word and the way back', async ({ page }) => {
        const b = await setup(page);
        const panel = await idlePanel(page);
        const sw = panel.getByRole('switch', { name: 'Research on' });
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await expect(sw).not.toHaveAttribute('aria-disabled', 'true');
        await sw.click();
        await expect.poll(() => liveWrites(b)).toEqual([{ do: 'stop' }]);
        const off = page.locator('#live-panel.idle');
        await expect(off.locator('.research-live-note')).toContainText('Switched off. It stays off until switched on again.', { timeout: 15_000 });
        await expect(off.locator('.research-live-busy')).toHaveCount(0);
        // Off in the idle panel: no switch, "Switch on" (live.start, links announced) and the one command under it.
        await expect(off.getByRole('switch')).toHaveCount(0);
        await expect(off.getByRole('button', { name: 'Switch on' })).toBeVisible();
        await expect(off.locator('.research-live-note code')).toHaveText('strom live start');
        expect(await links(page)).toEqual([]);
    });

    test('off: the idle panel has "Switch on" and one command (no strom app); the quiet link (no mark), on once the bridge answers', async ({ page }) => {
        // It ran before (its status said the features and the links), then went.
        const b = await setup(page);
        b.down = true;
        await poll(page);
        const panel = await idlePanel(page);
        await expect(panel).toHaveClass(/is-off/);
        await expect(panel.getByRole('switch')).toHaveCount(0);
        const on = panel.getByRole('button', { name: 'Switch on' });
        await expect(on).toBeVisible();
        await expect(panel.locator('.research-live-note')).toHaveText(/If nothing happens, in the terminal, in the tree’s folder: ?strom live start ?Copy$/);
        await expect(panel.locator('.live-panel-body code')).toHaveText(['strom live start']);
        await expect(panel).not.toContainText('strom app');
        // No terminal, no window: no mark on the button.
        await expect(panel.locator('.research-live .research-open-mark, .research-live .ai-badge')).toHaveCount(0);
        await on.click();
        expect(await links(page)).toEqual([`strom-research://live?tree=${UUID}&do=start`]);
        await expect(panel.locator('.research-live-start')).toHaveText('Switching on…');
        await expect(panel.locator('.research-live-start')).toBeDisabled();
        b.down = false;
        await expect(page.locator('#live-panel.idle').getByRole('switch', { name: 'Research on' })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
        await expect(page.locator('#live-panel.idle .research-live-busy')).toHaveCount(0);
        await expect(page.locator('#live-panel.idle')).not.toHaveClass(/is-off/);
    });

    test('the command copied from the idle panel', async ({ page }) => {
        const b = await setup(page);
        // The clipboard recorded (granting it would take the page's other permissions away).
        await page.evaluate(() => {
            const w = window as unknown as { __copied: string[] };
            w.__copied = [];
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => { w.__copied.push(t); return Promise.resolve(); } } });
        });
        b.down = true;
        await poll(page);
        const panel = await idlePanel(page);
        await expect(panel).toHaveClass(/is-off/);
        await panel.locator('.research-live-copy').click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual(['strom live start']);
        await expect(page.locator('.toast', { hasText: 'Command copied.' })).toBeVisible();
    });

    test('off after a time without work vs. switched off: each its own word', async ({ page }) => {
        await setup(page, { down: true });
        await remember(page, { features: ALL, ended: { kind: 'idle', at: Date.now() } });
        const panel = await idlePanel(page);
        await expect(panel).toHaveClass(/is-off/);
        await expect(panel.locator('.research-live-note')).toHaveText(/^Switched off after a time without work\. New work in the tree switches it on again\./);
        await remember(page, { features: ALL, ended: { kind: 'stopped', by: 'app', at: Date.now() } });
        await page.evaluate(() => window.Strom.UI.renderLivePanel());
        await expect(page.locator('#live-panel .research-live-note')).toHaveText(/^Switched off\. It stays off until switched on again\./);
    });

    test('an older research: the state and the command only, nothing sent', async ({ page }) => {
        // It says its version: its features are its word as it is now.
        const b = await setup(page, { features: [], strom: '1.28.0' });
        const panel = await idlePanel(page);
        const sw = panel.getByRole('switch', { name: 'Research on' });
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await expect(sw).toHaveAttribute('aria-disabled', 'true');
        // Read-only (aria-disabled), a click only says the command.
        await sw.click({ force: true });
        await expect(panel.locator('.research-live-note')).toContainText('switched off in the terminal');
        await expect(panel.locator('.research-live-note code')).toHaveText('strom live stop');
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        // Off, without live.start: how to switch it on, nothing to click in the panel.
        b.down = true;
        await poll(page);
        await expect(page.locator('#live-panel.idle')).toHaveClass(/is-off/);
        const off = page.locator('#live-panel.idle');
        await expect(off.getByRole('button', { name: 'Switch on' })).toHaveCount(0);
        await expect(off.locator('.research-live-note')).toContainText('Switched on in the terminal, in the tree’s folder:');
        await expect(off.locator('.research-live-note code')).toHaveText('strom live start');
        // The manager's switch: read-only, a click says the command, nothing handed over.
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const row = page.locator('#tree-manager-list .tree-manager-item').first();
        const rowSwitch = row.getByRole('switch', { name: 'Research on' });
        await expect(rowSwitch).toHaveAttribute('aria-checked', 'false');
        await expect(rowSwitch).toHaveAttribute('aria-disabled', 'true');
        await expect(row.locator('.research-live-note code')).toHaveText('strom live start');
        await rowSwitch.click({ force: true });
        expect(await links(page)).toEqual([]);
        expect(livePosts(b)).toEqual([]);
    });

    test('after an update of the research: the old word without live.start offers the link; the answer says the features', async ({ page }) => {
        // Its bridge last ran on 1.28.0 (no live.start), which said 1.29.0 is out; off since.
        const b = await setup(page);
        b.down = true;
        await poll(page);
        await remember(page, { features: ['live.idle', 'live.stop'], version: '1.28.0', newer: '1.29.0' });
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const row = page.locator('#tree-manager-list .tree-manager-item').first();
        const sw = row.getByRole('switch', { name: 'Research on' });
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        await expect(sw).not.toHaveAttribute('aria-disabled', 'true');
        await expect(row.locator('.research-live-note code')).toHaveCount(0);
        await sw.click();
        expect(await links(page)).toEqual([`strom-research://live?tree=${UUID}&do=start`]);
        await expect(row.locator('.research-live-busy')).toHaveText('Switching on…');
        // The updated research answers: on, its features (and version) remembered for the next time it is off.
        b.strom = '1.29.0';
        b.down = false;
        await expect(row.getByRole('switch', { name: 'Research on' })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
        await expect(row.locator('.research-live-busy')).toHaveCount(0);
        const kept = await page.evaluate((id) => JSON.parse(localStorage.getItem(`strom-research-live:${id}`) ?? '{}'), UUID);
        expect(kept).toMatchObject({ features: ['live.idle', 'live.stop', 'live.start'], version: '1.29.0' });
    });

    test('off with the features remembered before versions were, or another tree\'s bridge newer: the link, not the command', async ({ page }) => {
        const b = await setup(page);
        b.down = true;
        await poll(page);
        // Remembered by 3.25.0-beta.2 (no version): not the research's word.
        await remember(page, { features: ['live.idle', 'live.stop'] });
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const row = page.locator('#tree-manager-list .tree-manager-item').first();
        await expect(row.getByRole('switch', { name: 'Research on' })).not.toHaveAttribute('aria-disabled', 'true');
        // Said by 1.28.0 and nothing newer known: read-only with the command.
        await remember(page, { features: ['live.idle', 'live.stop'], version: '1.28.0' });
        await page.evaluate(() => window.Strom.UI.refreshResearchLiveSwitches());
        await expect(row.getByRole('switch', { name: 'Research on' })).toHaveAttribute('aria-disabled', 'true');
        await expect(row.locator('.research-live-note code')).toHaveText('strom live start');
        // Another tree's bridge (the same install) answered with 1.29.0: the research was updated.
        await page.evaluate(() => localStorage.setItem('strom-research-live:0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
            JSON.stringify({ features: ['live.idle', 'live.stop', 'live.start'], version: '1.29.0' })));
        await page.evaluate(() => window.Strom.UI.refreshResearchLiveSwitches());
        await expect(row.getByRole('switch', { name: 'Research on' })).not.toHaveAttribute('aria-disabled', 'true');
        await expect(row.locator('.research-live-note code')).toHaveCount(0);
    });

    test('a refusal of the bridge is said and the switch stays on', async ({ page }) => {
        const b = await setup(page);
        b.live!.reply = { status: 503, body: { error: 'busy', code: 'research.busy' } };
        const panel = await idlePanel(page);
        await panel.getByRole('switch', { name: 'Research on' }).click();
        await expect(panel.locator('.research-live-note')).toContainText('The research is writing something else right now.');
        await expect(panel.getByRole('switch', { name: 'Research on' })).toHaveAttribute('aria-checked', 'true');
    });

    test('the tree manager: a row with research has the switch, switched off there', async ({ page }) => {
        const b = await setup(page);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const row = page.locator('#tree-manager-list .tree-manager-item').first();
        const sw = row.getByRole('switch', { name: 'Research on' });
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('#tree-manager-list .research-live')).toHaveCount(1);
        await sw.click();
        await expect.poll(() => liveWrites(b)).toEqual([{ do: 'stop' }]);
        await expect(row.locator('.research-live-note')).toContainText('Switched off.', { timeout: 15_000 });
        await expect(row.getByRole('switch', { name: 'Research on' })).toHaveAttribute('aria-checked', 'false');
    });
});

test.describe('Research on: Settings', () => {
    test('the computer\'s choice written through the bridge, as it says it', async ({ page }) => {
        const b = await setup(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const group = page.locator('#settings-group-research-live');
        await expect(group).toBeVisible();
        await expect(group.locator('.settings-group-title')).toHaveText('Research on this computer');
        const forever = group.getByRole('radio', { name: 'Until the computer shuts down' });
        const twoHours = group.getByRole('radio', { name: 'After 2 hours without work' });
        await expect(forever).toBeChecked();
        await twoHours.check();
        await expect.poll(() => liveWrites(b)).toEqual([{ idleMinutes: 120 }]);
        await expect(twoHours).toBeChecked();
        await expect(twoHours).toBeEnabled();
        expect(b.live!.idleMinutes).toBe(120);
    });

    test('a value set in the terminal shows as its own', async ({ page }) => {
        await setup(page, { live: { idleMinutes: 30, writes: [] } });
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const group = page.locator('#settings-group-research-live');
        await expect(group.getByRole('radio', { name: 'Own value (30 min)' })).toBeChecked();
    });

    test('without live.idle: no choice, the commands only', async ({ page }) => {
        const b = await setup(page, { features: ['live.stop'] });
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const group = page.locator('#settings-group-research-live');
        await expect(group).toBeVisible();
        await expect(group.getByRole('radio')).toHaveCount(0);
        await expect(group.locator('code')).toHaveText([
            'strom config set live.idleMinutes 0', 'strom config set live.idleMinutes 120',
        ]);
        await expect(group).toContainText('This version of the research takes the choice only in the terminal');
        expect(livePosts(b)).toEqual([]);
    });

    test('no research tree: no group', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager as unknown as { patchResearchLink(id: string, p: unknown): void; getActiveTreeId(): string };
            tm.patchResearchLink(tm.getActiveTreeId(), { copy: true });
            window.Strom.UI.showSettingsDialog();
        });
        await expect(page.locator('#settings-modal')).toBeVisible();
        await expect(page.locator('#settings-group-research-live')).toBeHidden();
    });
});

test.describe('Research on: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('no switch and no Settings group (the research runs on a computer)', async ({ page }) => {
        await fakeBridge(page, { features: ALL, live: { idleMinutes: 0, writes: [] } });
        await openResearch(page);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        await expect(page.locator('#tree-manager-list .tree-manager-item').first()).toBeVisible();
        await expect(page.locator('#tree-manager-list .research-live:not([hidden])')).toHaveCount(0);
        await page.evaluate(() => {
            window.Strom.UI.closeTreeManagerDialog();
            window.Strom.UI.showSettingsDialog();
        });
        await expect(page.locator('#settings-group-research-live')).toBeHidden();
    });
});
