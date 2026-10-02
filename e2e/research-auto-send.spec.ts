import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';
import {
    BRIDGE, UUID, HEAD, NEW_HEAD, block, dot, editJan, fakeBridge, links, openResearch, openResearchMenu, poll, researchGed, FakeBridge,
} from './research-bridge.js';

/**
 * Sending to the research by itself (the default) and by hand, the research
 * as an archive (no agent): the toolbar's mark / Send button / amber pill,
 * the quiet time, a switch of trees and leaving the page, the bridge not
 * there, a refusal and a discarded send, the write at once with its quiet
 * load and the conflicts it left, one-time notices, Research for this tree.
 * The bridge is answered by page.route; the quiet time runs on Playwright's clock.
 */

const QUIET = 120_000;
const WRITE = { status: 200, body: { ok: true, inbox: false, changes: 6, applied: 6, input: 'I0042' } };

/** The research writes at once and makes a new version (with `extra` lines on Jan, e.g. a conflict). */
function writesAtOnce(bridge: FakeBridge, extra: string[] = []): void {
    let n = 0;
    bridge.syncReply = WRITE;
    bridge.onWrite = () => {
        n++;
        const head = `ab${n}0cd${n}0ef${n}0`;
        return { head, ged: researchGed(head, ['1 BIRT', '2 PLAC Praha', ...extra]) };
    };
}

/** A research tree that sends by itself (the default), its bridge running. */
async function autoTree(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    await page.clock.install();
    await openResearch(page, { auto: true });
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null }, ...init });
    // The first start's note is not what these tests are about.
    await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
    await poll(page);
    return bridge;
}

const mark = (page: Page) => page.locator('#research-sync-mark');
const pill = (page: Page) => page.locator('#research-sync-pill');
const treeId = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);

async function hide(page: Page): Promise<void> {
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
}

test.describe('sending by itself', () => {
    test('an edit goes after two quiet minutes, once; another edit moves the time on', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        await editJan(page);
        await expect(mark(page)).toHaveAttribute('data-look', 'ring');
        await page.clock.fastForward(60_000);
        await editJan(page, 'Brno');
        await page.clock.fastForward(QUIET - 10_000);
        expect(bridge.posts).toHaveLength(0);
        await page.clock.fastForward(11_000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        expect(bridge.posts[0]).toContain('2 PLAC Brno');
        // No toast for a routine send; the mark says it.
        await expect(page.locator('.toast', { hasText: 'Written to the research' })).toHaveCount(0);
        await page.clock.fastForward(QUIET * 2);
        expect(bridge.posts).toHaveLength(1);
    });

    test('switching trees and leaving the page send at once', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        const first = await treeId(page);
        await editJan(page);
        const other = await page.evaluate(() => window.Strom.DataManager.importAsNewTree({ version: 11, persons: {}, partnerships: {} } as never, 'Konopáskovi'));
        await page.evaluate((id) => window.Strom.UI.switchToTree(id), other);
        await expect.poll(() => bridge.posts.length).toBe(1);
        expect(bridge.posts[0]).toContain(`1 _STROM_APP_TREE ${first}`);
        await page.evaluate((id) => window.Strom.UI.switchToTree(id), first);
        await expect(card(page, 'Jan')).toBeVisible();
        await editJan(page, 'Kolín');
        await hide(page);
        await expect.poll(() => bridge.posts.length).toBe(2);
        expect(bridge.posts[1]).toContain('2 PLAC Kolín');
    });

    test('the bridge not running: nothing fetched or opened; "not running" only after the quiet time; sent when it is back', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        bridge.down = true;
        await editJan(page);
        await expect(dot(page)).toBeHidden();
        await page.clock.fastForward(QUIET + 1000);
        await expect(pill(page)).toHaveClass(/is-warn/);
        await expect(pill(page)).toContainText('Start ↗');
        await expect(dot(page)).toBeVisible();
        expect(bridge.posts).toHaveLength(0);
        expect(await links(page)).toEqual([]);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'autoBridgeDown');
        await expect(block(page)).toContainText('will be sent once you start it');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        bridge.down = false;
        await poll(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(pill(page)).not.toHaveClass(/is-warn/);
    });

    test('refused: the pill, one toast; nothing goes by itself until Send again', async ({ page }) => {
        const bridge = await autoTree(page);
        bridge.syncReply = { status: 500, body: { error: 'zamčeno jiným sezením' } };
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(page.locator('.toast')).toContainText('Automatic sending stopped. The research didn\'t accept the changes: zamčeno jiným sezením.');
        await expect(pill(page)).toContainText("Research didn't accept the changes");
        await expect(dot(page)).toBeVisible();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'autoPaused');
        await expect(block(page)).toContainText('Automatic sending is paused until you send again.');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        await editJan(page, 'Brno');
        await page.clock.fastForward(QUIET + 1000);
        expect(bridge.posts).toHaveLength(1);
        writesAtOnce(bridge);
        await pill(page).getByRole('button', { name: 'Send again' }).click();
        await expect.poll(() => bridge.posts.length).toBe(2);
        await expect(pill(page)).not.toHaveClass(/is-warn/);
        // Going by itself again.
        await editJan(page, 'Kolín');
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(3);
    });

    test('discarded in the research: the same state is not sent again; after an edit it is', async ({ page }) => {
        const bridge = await autoTree(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        // Kept for the user (sync.review on): the ring, waiting there.
        await poll(page);
        await expect(mark(page)).toHaveAttribute('data-look', 'ring');
        bridge.inbox = [];
        Object.assign(bridge.sends[0], { state: 'discarded', decidedAt: new Date().toISOString(), reason: 'zkouška' });
        await poll(page);
        await expect(page.locator('.toast')).toContainText('was discarded in the research (zkouška)');
        await expect(pill(page)).toContainText('Send discarded');
        await page.clock.fastForward(QUIET * 2);
        expect(bridge.posts).toHaveLength(1);
        await editJan(page, 'Brno');
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(2);
    });

    test('not sent and the research has a newer version: sent at once, then the new version loads', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        await editJan(page);
        bridge.head = NEW_HEAD;
        await poll(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('ab10cd10ef10');
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
    });

    test('Load new version with changes the research lacks: sent first, no question', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        await editJan(page);
        await page.evaluate(() => { void window.Strom.UI.researchActionLoadVersion(); });
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('ab10cd10ef10');
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
    });

    test('a write at once: ✓, the new version loaded quietly (the view kept); a new conflict gets the note, with the person', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge, ['1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 VAL Praha', '2 VAL Čáslav']);
        const view = () => page.evaluate(() => window.Strom.ZoomPan.getTransform());
        const before = await view();
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('ab10cd10ef10');
        const note = page.locator('.research-sync-note');
        await expect(note).toContainText('Written, 1 conflict to decide');
        await expect(note.getByRole('button', { name: 'Jan Víšek ›' })).toBeVisible();
        expect(await view()).toEqual(before);
        // Gone after 8 s.
        await page.clock.fastForward(9000);
        await expect(note).toHaveCount(0);
        await expect(mark(page)).toHaveAttribute('data-look', 'dot');
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'written');
        await expect(block(page)).toContainText('6 changes · 1 conflict to decide');
        await block(page).getByRole('button', { name: 'Jan Víšek ›' }).click();
        await expect(page.locator('#person-research-modal, .person-research-modal').first()).toBeVisible();
    });
});

test('the research names the conflicts in its reply: the note names the person', async ({ page }) => {
    const bridge = await autoTree(page);
    writesAtOnce(bridge);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0003', person: 'P0003', fact: 'BIRT' }] } };
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    const note = page.locator('.research-sync-note');
    await expect(note).toContainText('Written, 1 conflict to decide');
    await expect(note.getByRole('button', { name: 'Jan Víšek ›' })).toBeVisible();
});

test('a written send taken back in the research: told once, not sent again by itself, the new version asks before it loads', async ({ page }) => {
    const bridge = await autoTree(page);
    writesAtOnce(bridge);
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('ab10cd10ef10');
    Object.assign(bridge.sends[0], { state: 'undone', decidedAt: new Date().toISOString() });
    bridge.head = 'ee77ff88aa99';
    bridge.treeGed = researchGed('ee77ff88aa99');
    await poll(page);
    await expect(page.locator('.toast')).toContainText('was taken back in the research. Your changes are still here.');
    await expect(pill(page)).toContainText('Send taken back');
    await expect(dot(page)).toBeVisible();
    await page.clock.fastForward(QUIET * 2);
    expect(bridge.posts).toHaveLength(1);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await expect(page.locator('#confirmation-modal')).toContainText("You have changes the research doesn't have");
    await page.locator('#confirm-cancel-btn').click();
    // Praha is still here.
    expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any).birthPlace)).toBe('Praha');
});

test('a write that takes longer (202): "writing" until the status says written, then loaded quietly', async ({ page }) => {
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 202, body: { ok: true, inbox: false, pending: true, changes: 6 } };
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect(mark(page)).toHaveAttribute('data-look', 'spin');
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'sending');
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());
    Object.assign(bridge.sends[0], { state: 'written', decidedAt: new Date().toISOString() });
    bridge.head = 'aa11bb22cc33';
    bridge.treeGed = researchGed('aa11bb22cc33', ['1 BIRT', '2 PLAC Praha']);
    await poll(page);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('aa11bb22cc33');
    await expect(mark(page)).toHaveAttribute('data-look', /check|dot/);
});

test.describe('the toolbar', () => {
    test('the mark: only sending by itself, from 1180 px, for a research that tells what it has; it never moves the toolbar', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 900 });
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        await expect(mark(page)).toHaveAttribute('data-look', 'dot');
        await editJan(page);
        await expect(mark(page)).toHaveAttribute('data-look', 'ring');
        const switcher = page.locator('.tree-switcher').first();
        const at = await switcher.boundingBox();
        bridge.syncDelayMs = 1500;
        void page.evaluate(() => window.Strom.UI.researchAutoLeave()).catch(() => undefined);
        await expect(mark(page)).toHaveAttribute('data-look', 'spin');
        expect(await switcher.boundingBox()).toEqual(at);
        await expect(mark(page)).toHaveAttribute('data-look', 'check');
        expect(await switcher.boundingBox()).toEqual(at);
        await page.clock.fastForward(2500);
        await expect(mark(page)).toHaveAttribute('data-look', 'dot');
        expect(await switcher.boundingBox()).toEqual(at);
        bridge.down = true;
        await poll(page);
        await expect(mark(page)).toHaveAttribute('data-look', 'ghost');
        await page.setViewportSize({ width: 1100, height: 900 });
        await expect(mark(page)).toBeHidden();
        // Sent by hand: no mark.
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.evaluate(() => window.Strom.UI.setResearchSendMode(window.Strom.TreeManager.getActiveTreeId()!, 'manual'));
        await expect(mark(page)).toHaveCount(0);
    });

    test('reduced motion: the spinner stands still', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        bridge.syncDelayMs = 1500;
        await editJan(page);
        void page.evaluate(() => window.Strom.UI.researchAutoLeave()).catch(() => undefined);
        const spinner = mark(page).locator('.research-sync-spinner');
        await expect(spinner).toBeVisible();
        expect(await spinner.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    });

    test('the first start: a note under the mark once per install; at 1100 px a block instead', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        await poll(page);
        const note = page.locator('.research-sync-note');
        await expect(note).toContainText('Your changes now go to the research automatically.');
        await note.getByRole('button', { name: 'Close' }).click();
        await expect(note).toHaveCount(0);
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await poll(page);
        await expect(mark(page)).toBeVisible();
        await expect(note).toHaveCount(0);
        // Another install, narrow: a block (no dot), Got it closes it for good.
        await page.evaluate(() => localStorage.removeItem('strom-research-auto-intro-seen'));
        await page.setViewportSize({ width: 1100, height: 900 });
        await poll(page);
        await expect(dot(page)).toBeHidden();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'autoIntro');
        await block(page).getByRole('button', { name: 'Got it' }).click();
        await openResearchMenu(page);
        await expect(block(page)).not.toHaveAttribute('data-state', 'autoIntro');
    });

    test('sent by hand: the Send button only with changes and the bridge up; its text by width; the dot where it is not; the toast after', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 900 });
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        writesAtOnce(bridge);
        await poll(page);
        const send = page.locator('#research-sync-send');
        await expect(send).toHaveCount(0);
        await editJan(page);
        await expect.poll(() => send.innerText()).toBe('Send to research');
        await expect(send).toHaveAttribute('title', 'Send your changes to the research');
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect.poll(() => send.innerText()).toBe('Send');
        await expect(page.locator('#actions-menu-research-dot')).toBeHidden();
        await page.setViewportSize({ width: 1100, height: 900 });
        await expect(send).toBeHidden();
        await expect(page.locator('#actions-menu-research-dot')).toBeVisible();
        await page.setViewportSize({ width: 1440, height: 900 });
        bridge.down = true;
        await poll(page);
        await expect(send).toHaveCount(0);
        bridge.down = false;
        await poll(page);
        await send.click();
        await expect(page.locator('.toast')).toContainText('Written to the research, 6 changes.');
        await expect(send).toHaveCount(0);
    });

    test('sent by hand: the bridge back is found within seconds; the button\'s place is kept, the toolbar does not move', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        await poll(page);
        const switcher = page.locator('.tree-switcher').first();
        const send = page.locator('#research-sync-send');
        bridge.down = true;
        await poll(page);
        await editJan(page);
        await expect(send).toHaveCount(0);
        // (After the edit: the storage pill "only in this browser" has its own place.)
        await page.waitForTimeout(1700);
        const at = await switcher.boundingBox();
        bridge.down = false;
        await page.clock.fastForward(16_000);
        await expect(send).toBeVisible();
        expect(await switcher.boundingBox()).toEqual(at);
    });

    test('a tree without a research at 360 and 768 px: no research place, no dot', async ({ page }) => {
        for (const width of [360, 768]) {
            await page.setViewportSize({ width, height: 800 });
            await page.goto('/');
            await expect(pill(page)).toBeHidden();
            await expect(page.locator('#actions-menu-research-dot')).toBeHidden();
        }
    });
});

test.describe('the research as an archive', () => {
    const ARCHIVE = { mode: 'archive', sync: { auto: 'mirror' }, sources: true, verified: true, media: null };

    test('menus: nothing that leads to an agent; the person menu keeps only what the research knows', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        await fakeBridge(page, { accepts: ARCHIVE, links: ['send', 'open', 'live', 'app', 'setup', 'chat', 'review', 'research', 'sync-undo'],
            lastIntake: { id: 'I0041', at: new Date().toISOString() } });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await poll(page);
        await openResearchMenu(page);
        const sub = page.locator('#actions-research-submenu');
        await expect(sub.locator('#research-item-version')).toBeVisible();
        await expect(sub.locator('#research-item-open')).toBeVisible();
        await expect(sub.locator('#research-item-tree-settings')).toBeVisible();
        for (const id of ['research-item-chat', 'research-item-undo', 'research-item-live', 'research-item-send']) {
            await expect(sub.locator(`#${id}`)).toHaveCount(0);
        }
        await expect(block(page).locator('.research-sync-tag')).toHaveText('Archive');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        const actions = await page.evaluate(() => {
            const jan = Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            return window.Strom.UI.getPersonMenuActions(jan.id).map((a: any) => [a.action, ...(a.submenu ?? []).map((x: any) => x.action)]).flat();
        });
        for (const a of ['research-review', 'research-ancestors', 'research-descendants', 'research-ask', 'research']) expect(actions).not.toContain(a);
    });

    test('a switch of mode is said once (the dot until Got it, nothing after a reload); the dialog keeps the date', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await poll(page);
        await expect(dot(page)).toBeHidden();
        bridge.accepts = ARCHIVE;
        await poll(page);
        await expect(dot(page)).toBeVisible();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'switched');
        await expect(block(page)).toContainText('The research is an archive again.');
        await block(page).getByRole('button', { name: 'Got it' }).click();
        await expect(dot(page)).toBeHidden();
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).not.toHaveAttribute('data-state', 'switched');
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        const dialog = page.locator('#research-tree-settings-modal');
        await expect(dialog.locator('h2 .research-sync-tag')).toHaveText('Archive');
        await expect(dialog).toContainText('The research has been an archive since');
        await expect(dialog).toContainText('Takes effect once the research starts working with an agent.');
        await expect(dialog).toContainText('The research writes every send straight away.');
    });

    test('the offer to send by itself (an archive sent by hand): either answer closes it for good', async ({ page }) => {
        await page.clock.install();
        await openResearch(page);
        await fakeBridge(page, { accepts: ARCHIVE });
        await poll(page);
        await expect(dot(page)).toBeHidden();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'offerAuto');
        await block(page).getByRole('button', { name: 'Keep manual' }).click();
        await openResearchMenu(page);
        await expect(block(page)).not.toHaveAttribute('data-state', 'offerAuto');
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sendMode)).toBe('manual');
        // Another tree of the same archive: Send automatically.
        await page.evaluate(() => localStorage.removeItem(`strom-research-auto:${window.Strom.TreeManager.getActiveTreeId()}`));
        await poll(page);
        await openResearchMenu(page);
        await block(page).getByRole('button', { name: 'Send automatically' }).click();
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sendMode)).toBe('auto');
    });

    test('a delete says it is set aside in the archive (the tree came from there); not with an agent', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        const bridge = await fakeBridge(page, { accepts: ARCHIVE });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await poll(page);
        const askDelete = () => page.evaluate(() => {
            const jan = Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            void window.Strom.UI.confirmDeletePersonDialog(jan.id);
        });
        // Before any send: the archive has the tree it gave.
        await askDelete();
        await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
        await expect(page.locator('.confirm-note')).toContainText('Archive The research sets it aside; it can be restored.');
        await page.locator('#confirm-cancel-btn').click();
        bridge.accepts = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
        await poll(page);
        await askDelete();
        await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
        await expect(page.locator('.confirm-note')).toHaveCount(0);
    });

    test('opened by ?live=: an archive opens for editing, not followed', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        await fakeBridge(page, { accepts: ARCHIVE });
        await page.evaluate((b) => window.Strom.UI.startLiveFollow(b), BRIDGE);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.id)).toBe(UUID);
        expect(await page.evaluate(() => window.Strom.UI.isFollowingActiveResearch())).toBe(false);
        expect(await page.evaluate(() => window.Strom.DataManager.isReadOnly())).toBe(false);
        await expect(page.locator('.live-panel')).toHaveCount(0);
    });

    test('the bridge not running with changes: how many wait', async ({ page }) => {
        const bridge = await autoTree(page, { accepts: ARCHIVE });
        bridge.down = true;
        await editJan(page);
        await editJan(page, 'Brno');
        await editJan(page, 'Kolín');
        await page.clock.fastForward(QUIET + 1000);
        await expect(pill(page)).toContainText('Research not running · 3 changes waiting');
        await openResearchMenu(page);
        await expect(block(page)).toContainText("The archive can't take anything now. 3 changes waiting");
    });
});

test.describe('Research for this tree: sending changes', () => {
    test('two cards, the box by the research, the status line; switching is saved at once', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        const dialog = page.locator('#research-tree-settings-modal');
        await expect(dialog.locator('legend', { hasText: 'Sending changes' })).toBeVisible();
        await expect(dialog.locator('input[name="research-send-mode"][value="auto"]')).toBeChecked();
        await expect(dialog).toContainText('Changing a fact backed by a record creates a conflict to decide.');
        await expect(dialog.locator('#research-send-status')).toContainText('Last written to the research');
        await dialog.locator('input[name="research-send-mode"][value="manual"]').check();
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sendMode)).toBe('manual');
    });

    test('sync.review on: the box says changes wait for confirmation', async ({ page }) => {
        await autoTree(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        await expect(page.locator('#research-tree-settings-modal')).toContainText('Changes are written in the research only after you confirm them.');
    });

    test('a phone-sized window: short texts and the note instead of the box', async ({ page }) => {
        await autoTree(page);
        await page.setViewportSize({ width: 360, height: 760 });
        await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
        const dialog = page.locator('#research-tree-settings-modal');
        await expect(dialog).toContainText('By themselves, after a short pause.');
        await expect(dialog).toContainText('Changes are sent from the computer where the research runs.');
        await expect(dialog.locator('#research-send-status')).toHaveCount(0);
    });

    test('a research that does not say what it takes: no sending section', async ({ page }) => {
        await openResearch(page, { capable: false });
        await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
        await expect(page.locator('#research-tree-settings-modal legend', { hasText: 'Sending changes' })).toHaveCount(0);
    });
});

// Unused import guards (shared helpers).
void BRIDGE; void UUID; void HEAD;
