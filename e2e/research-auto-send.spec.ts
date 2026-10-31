import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';
import {
    BRIDGE, BRIDGE2, UUID, HEAD, NEW_HEAD, block, dot, editJan, fakeBridge, links, openResearch, openResearchMenu, poll, researchGed, FakeBridge, acceptLoad,
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

/**
 * Wait until the app has taken in the answer to the send the research took
 * in as `intake` (the post is counted when it goes): a load asked before that
 * found the send still out, sent instead (which does nothing while a send is
 * out) and the tree stayed on its old head.
 */
async function sendTakenIn(page: Page, intake: string): Promise<void> {
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.intake)).toBe(intake);
}

/**
 * Load the research's version, confirming "Update" whenever it is asked, until
 * the tree stands on `head` (a dialog that came only after a fixed wait under
 * load used to be left open).
 */
async function loadNewerAsked(page: Page, head: string): Promise<void> {
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    const update = page.locator('.dialog-confirm').getByRole('button', { name: 'Update' });
    await expect.poll(async () => {
        if (await update.isVisible()) await update.click({ timeout: 1000 }).catch(() => undefined);
        return page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);
    }).toBe(head);
}

const mark = (page: Page) => page.locator('#research-sync-mark');
const pill = (page: Page) => page.locator('#research-sync-pill');
const treeId = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
const janPlace = (page: Page) => page.evaluate(() =>
    (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any).birthPlace ?? '');

async function hide(page: Page): Promise<void> {
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
}

test.describe('sending by itself', () => {
    test('an edit goes after two quiet minutes, once; another edit moves the time on', { tag: '@smoke' }, async ({ page }) => {
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

    test('switching trees and leaving the page send at once', { tag: '@smoke' }, async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        const first = await treeId(page);
        await editJan(page);
        const other = await page.evaluate(() => window.Strom.DataManager.importAsNewTree({ version: 11, persons: {}, partnerships: {} } as never, 'Mrkváskovi'));
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
        await expect(pill(page)).toContainText('Start, opens in the research');
        await expect(dot(page)).toBeVisible();
        expect(bridge.posts).toHaveLength(0);
        expect(await links(page)).toEqual([]);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'autoBridgeDown');
        await expect(block(page)).toContainText('will be sent once the research starts');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        bridge.down = false;
        await poll(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(pill(page)).not.toHaveClass(/is-warn/);
    });

    test('refused with a code: the toast says why in the app\'s words', async ({ page }) => {
        const bridge = await autoTree(page);
        bridge.syncReply = { status: 413, body: { error: 'strom je na poslání moc velký', code: 'tree.large', text: 'the tree is too large to send' } };
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(page.locator('.toast')).toContainText("Automatic sending stopped. The research didn't accept the changes: the tree is too large to send this way; it can be exported as GEDCOM and loaded in the research.");
        await expect(page.locator('.toast')).not.toContainText('moc velký');
    });

    test('refused: the pill, one toast; nothing goes by itself until Send again', async ({ page }) => {
        const bridge = await autoTree(page);
        bridge.syncReply = { status: 500, body: { error: 'zamčeno jiným sezením' } };
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        // The bridge's sentence (the research's language) is not put into this app's sentence.
        await expect(page.locator('.toast')).toContainText('Automatic sending stopped. The research didn\'t accept the changes.');
        await expect(page.locator('.toast')).not.toContainText('zamčeno');
        await expect(pill(page)).toContainText("Research didn't accept the changes");
        await expect(dot(page)).toBeVisible();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'autoPaused');
        await expect(block(page)).toContainText('Automatic sending is paused until the next send.');
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

    test('the research started again with a new token right before the send (404 at the old address, as Strom Research answers an old token): after its new ?live= the changes go by themselves (N20)', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        bridge.rotateAt = 'sync';
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect(pill(page)).toContainText("Research didn't accept the changes");
        expect(bridge.posts).toHaveLength(0);
        expect(await page.evaluate(() => !!window.Strom.TreeManager.getTreeMetadata(window.Strom.TreeManager.getActiveTreeId()!)?.research?.refused)).toBe(true);
        // The research hands over its new address: the refusal of the old one is over, the changes go — no click.
        await page.evaluate((b) => { void window.Strom.UI.startLiveFollow(b); }, BRIDGE2);
        await expect.poll(() => bridge.posts.length).toBe(1);
        expect(bridge.posts[0]).toContain('2 PLAC Praha');
        await expect(pill(page)).not.toHaveClass(/is-warn/);
        expect(await page.evaluate(() => !!window.Strom.TreeManager.getTreeMetadata(window.Strom.TreeManager.getActiveTreeId()!)?.research?.refused)).toBe(false);
        // Going by itself again, to the new address.
        await editJan(page, 'Kolín');
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(2);
        expect(bridge.seen!.filter(x => x === 'POST /sync')).toHaveLength(3);
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

    test('not sent and the research has a newer version: sent at once; its version is loaded only when asked (newer, Load)', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        const headBefore = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);
        await editJan(page);
        bridge.head = NEW_HEAD;
        await poll(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).toBe('written');
        await page.clock.fastForward(30_000);
        await poll(page);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(headBefore);
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
        // The research had moved on before the write: its version is newer, to load when the user wants.
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'newer');
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

    test('a write at once: ✓, its version not loaded (only when asked), the view kept; a new conflict gets the note, with the person', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0007', person: 'P0003', fact: 'BIRT' }] } };
        const view = () => page.evaluate(() => window.Strom.ZoomPan.getTransform());
        const before = await view();
        const headBefore = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.replyHead)).toBe('ab10cd10ef10');
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(headBefore);
        const note = page.locator('.research-sync-note');
        await expect(note).toContainText('Written, 1 conflict to decide');
        await expect(note.getByRole('button', { name: 'Jan Fíšek ›' })).toBeVisible();
        expect(await view()).toEqual(before);
        // Gone after 8 s; the conflict stays in sight (its version, holding the research's value, not loaded).
        await page.clock.fastForward(9000);
        await expect(note).toHaveCount(0);
        await expect(pill(page)).toContainText('Written, 1 conflict to decide');
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'writtenConflicts');
        await expect(block(page)).toContainText('1 conflict to decide');
        await expect(block(page).locator('[data-action="showConflicts"]')).toBeVisible();
    });
});

test('a window narrower than the toolbar\'s mark (1100 px): a new conflict is told by a toast with the person', async ({ page }) => {
    const bridge = await autoTree(page);
    await page.setViewportSize({ width: 1100, height: 900 });
    writesAtOnce(bridge);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0003', person: 'P0003', fact: 'BIRT' }] } };
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    const toast = page.locator('.toast', { hasText: 'Written, 1 conflict to decide' });
    await expect(toast.getByRole('button', { name: 'Jan Fíšek' })).toBeVisible();
});

test('waiting for the quiet time: the mark and the block say when the changes go', async ({ page }) => {
    await autoTree(page);
    await editJan(page);
    await expect(mark(page)).toHaveAttribute('title', /^Changes will be sent at \d{1,2}:\d{2}/);
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'autoWaiting');
    await expect(block(page)).toContainText(/sent at \d{1,2}:\d{2}/);
    await expect(block(page).getByRole('menuitem', { name: 'Send now' })).toBeVisible();
});

test('a written send taken back in the research: told once, not sent again by itself, the new version asks before it loads', async ({ page }) => {
    const bridge = await autoTree(page);
    writesAtOnce(bridge);
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.replyHead)).toBe('ab10cd10ef10');
    Object.assign(bridge.sends[0], { state: 'undone', decidedAt: new Date().toISOString() });
    bridge.head = 'ee77ff88aa99';
    bridge.treeGed = researchGed('ee77ff88aa99');
    await poll(page);
    await expect(page.locator('.toast')).toContainText('was taken back in the research. The changes are still here.');
    await expect(pill(page)).toContainText('Send taken back');
    await expect(dot(page)).toBeVisible();
    await page.clock.fastForward(QUIET * 2);
    expect(bridge.posts).toHaveLength(1);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await expect(page.locator('#confirmation-modal')).toContainText("There are changes the research doesn't have");
    await page.locator('#confirm-cancel-btn').click();
    // Praha is still here.
    expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any).birthPlace)).toBe('Praha');
});

/** A send written at once, then taken back in the research (`strom sync undo`): the app told so. */
async function writtenThenUndone(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    const bridge = await autoTree(page, init);
    writesAtOnce(bridge);
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.replyHead)).toBe('ab10cd10ef10');
    Object.assign(bridge.sends[0], { state: 'undone', decidedAt: new Date().toISOString() });
    bridge.head = 'ee77ff88aa99';
    bridge.treeGed = researchGed('ee77ff88aa99');
    await poll(page);
    await expect(pill(page)).toContainText('Send taken back');
    return bridge;
}

test('finding 35: Send again after a send taken back asks the research to write it again (POST /sync/<R…>/again), no copy goes', async ({ page }) => {
    const bridge = await writtenThenUndone(page);
    const first = bridge.sends.find(r => r.state === 'undone')!.intake;
    await openResearchMenu(page);
    await block(page).getByRole('menuitem', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toEqual([first]);
    expect(bridge.posts).toHaveLength(1);
    await expect(pill(page)).not.toContainText('Send taken back');
    // Written again: nothing taken back any more (its version loads only when asked).
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).not.toBe('undone');
    expect(await janPlace(page)).toBe('Praha');
});

test('Send again with an edit made since the send taken back: that send is written again, then the edit goes like any send (beta.59 round, 1)', async ({ page }) => {
    const bridge = await writtenThenUndone(page);
    const first = bridge.sends.find(r => r.state === 'undone')!.intake;
    await editJan(page, 'Brno');
    await openResearchMenu(page);
    await block(page).getByRole('menuitem', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toEqual([first]);
    // By hand the preview may come first: Send there sends.
    const panel = page.locator('#research-changes-panel');
    await expect.poll(async () => bridge.posts.length === 2 || await panel.isVisible()).toBe(true);
    if (bridge.posts.length < 2) await panel.getByRole('button', { name: /^Send/ }).first().click();
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.posts[1]).toContain('Brno');
    await expect(pill(page)).not.toContainText('Send taken back');
});

test('finding 35: the research no longer keeps the send taken back (404 send.none): said, the bar stays, its version offered', async ({ page }) => {
    const bridge = await writtenThenUndone(page);
    bridge.sends.length = 0;
    await page.evaluate(() => window.Strom.UI.researchSendNow({ undoAgain: true }));
    await expect.poll(() => (bridge.againAsks ?? []).length).toBe(1);
    const toast = page.locator('.toast', { hasText: 'no longer keeps the send it took back' });
    await expect(toast.getByRole('button', { name: "Load the research's version" })).toBeVisible();
    await expect(pill(page)).toContainText('Send taken back');
    expect(bridge.posts).toHaveLength(1);
});

test('finding 35: a copy that still carries a send taken back (undoneSince): what was written stands, the bar "taken back" stays, never loaded quietly', async ({ page }) => {
    const bridge = await autoTree(page);
    writesAtOnce(bridge);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, undoneSince: ['R20261003190000000-abcd'] } };
    const headBefore = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect(page.locator('.toast', { hasText: 'The research took back a send this copy of the tree still carries' })).toBeVisible();
    await expect(pill(page)).toContainText('Send taken back');
    const sent = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent);
    expect(sent).toMatchObject({ state: 'undone', intake: 'R20261003190000000-abcd' });
    // Not loaded quietly over what it carries.
    await page.clock.fastForward(30_000);
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(headBefore);
});

test('finding 35: keeping the undo: "Load the research\'s version" on the bar asks plainly (no "send first"), then the tree is the research\'s', async ({ page }) => {
    await writtenThenUndone(page);
    await openResearchMenu(page);
    await block(page).getByRole('menuitem', { name: "Load the research's version" }).click();
    const choice = page.locator('.dialog-confirm', { hasText: 'Changed in the app' });
    await choice.getByRole('button', { name: 'Update' }).click();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('ee77ff88aa99');
    await expect(pill(page)).not.toContainText('Send taken back');
});

test('findings 35/29: the copy has a value, the research writes nothing (and moves on): the value stays, never loaded over quietly', async ({ page }) => {
    const bridge = await autoTree(page);
    // "Nothing" — and the research has a newer version without the user's value (as after an undo).
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 0, applied: 0 } };
    bridge.onWrite = () => ({ head: 'dd44ee55ff66', ged: researchGed('dd44ee55ff66') });
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    for (let i = 0; i < 3; i++) { await poll(page); await page.clock.fastForward(30_000); }
    expect(await janPlace(page)).toBe('Praha');
    // The research opens its version here (?import-url=): asked, never replaced without a word.
    await page.evaluate((u) => window.Strom.UI.openExternalRequest(new URLSearchParams({ 'import-url': u })), `${BRIDGE}/tree.ged`);
    const ask = page.locator('.dialog-confirm', { hasText: 'Changed in the app' });
    await expect(ask).toBeVisible();
    // Plainly: no "send first" (it would send nothing new).
    await expect(ask.getByRole('button', { name: 'Send first, then load' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await janPlace(page)).toBe('Praha');
});

test('finding 29: a write that left a conflict (named in the reply): the note says so, the user\'s value is not loaded over quietly', async ({ page }) => {
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0003', person: 'P0003', fact: 'BIRT' }] } };
    // The research keeps its own value; the user's is the other side of the conflict.
    bridge.onWrite = () => ({ head: 'cc33dd44ee55', ged: researchGed('cc33dd44ee55', ['1 BIRT', '2 PLAC Brno', '1 _STROM_CONFLICT X0003', '2 TYPE BIRT', '2 STAT open', '2 VAL Brno', '2 VAL Praha']) });
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    for (let i = 0; i < 3; i++) { await poll(page); await page.clock.fastForward(30_000); }
    expect(await janPlace(page)).toBe('Praha');
});

/** Jan by the research's number (his first name changes in these tests). */
const janFirst = (page: Page) => page.evaluate(() =>
    (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.lastName === 'Fíšek' && p.firstName !== 'Josef') as any).firstName);
const janBirthPlace = (page: Page, place: string) => page.evaluate((place) => {
    const dm = window.Strom.DataManager;
    const jan = Object.values(dm.getData().persons).find((p: any) => p.lastName === 'Fíšek' && p.firstName !== 'Josef') as any;
    dm.updatePerson(jan.id, { birthPlace: place });
}, place);
const janWhere = (page: Page) => page.evaluate(() =>
    (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.lastName === 'Fíšek' && p.firstName !== 'Josef') as any).birthPlace ?? '');
const renameJan = (page: Page, first: string) => page.evaluate((first) => {
    const dm = window.Strom.DataManager;
    const jan = Object.values(dm.getData().persons).find((p: any) => p.lastName === 'Fíšek' && p.firstName !== 'Josef') as any;
    dm.updatePerson(jan.id, { firstName: first });
}, first);
/** The research's version: its own name for Jan, the conflict about it still open, the user's birth place written. */
const nameConflictGed = (head: string, birth: string[] = []) => researchGed(head, [...birth,
    '1 _STROM_CONFLICT X0001', '2 TYPE NAME', '2 STAT open', '2 VAL Jan /Fíšek/', '2 VAL Jenda /Fíšek/']);

test('finding 37: a later send written without a conflict never takes over the name an earlier conflict is about', async ({ page }) => {
    const bridge = await autoTree(page);
    // 1st send: the rename, written with a conflict (the research keeps its name).
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0001', person: 'P0003', fact: 'NAME' }] } };
    bridge.onWrite = () => ({ head: 'c1c1c1c1c1c1', ged: nameConflictGed('c1c1c1c1c1c1') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    // 2nd send: only the birth place, written, nothing new to decide; the version still has the research's name.
    bridge.syncReply = WRITE;
    bridge.onWrite = () => ({ head: 'c2c2c2c2c2c2', ged: nameConflictGed('c2c2c2c2c2c2', ['1 BIRT', '2 PLAC Praha']) });
    await janBirthPlace(page, 'Praha');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    for (let i = 0; i < 3; i++) { await poll(page); await page.clock.fastForward(30_000); }
    expect(await janFirst(page)).toBe('Jenda');
    expect(await janWhere(page)).toBe('Praha');
    // Its version waits for the user, asked.
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await expect(page.locator('.dialog-confirm', { hasText: 'Changed in the app' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await janFirst(page)).toBe('Jenda');
});

test('finding 40: a write that left a conflict stays in sight after the note goes: the block and the pill, its version offered (asked)', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0001', person: 'P0003', fact: 'NAME' }] } };
    bridge.onWrite = () => ({ head: 'c1c1c1c1c1c1', ged: nameConflictGed('c1c1c1c1c1c1') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect(page.locator('.research-sync-note')).toContainText('Written, 1 conflict to decide');
    // The note goes; the conflict stays on the toolbar.
    await page.clock.fastForward(30_000);
    await poll(page);
    await expect(page.locator('.research-sync-note')).toHaveCount(0);
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    await expect(pill(page).getByRole('button', { name: 'Show' })).toBeVisible();
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'writtenConflicts');
    await expect(block(page)).toContainText('The value from the app stays here');
    await block(page).getByRole('menuitem', { name: "Load the research's version" }).click();
    await expect(page.locator('.dialog-confirm', { hasText: 'Changed in the app' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await janFirst(page)).toBe('Jenda');
});

test('"Written, N conflicts" counts the conflicts the write left, not every conflict open in the tree (1021)', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0001', person: 'P0003', fact: 'NAME' }] } };
    // Its version: the write's conflict and two more the research opened by itself, all on Jan.
    bridge.onWrite = () => ({ head: 'c1c1c1c1c1c1', ged: nameConflictGed('c1c1c1c1c1c1', [
        '1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 VAL 1865', '2 VAL 1866',
        '1 _STROM_CONFLICT X0010', '2 TYPE DEAT', '2 STAT open', '2 VAL 1930', '2 VAL 1931']) });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    Object.assign(bridge.sends[0], { conflicts: 1 });
    await page.clock.fastForward(30_000);
    await poll(page);
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'writtenConflicts');
    await expect(block(page)).toContainText('Written, 1 conflict to decide');
    await expect(block(page)).not.toContainText('3 conflicts');
});

test('findings 38/39: a copy carrying a send taken back, the next send written with a conflict: the conflict told and kept, the bar names the send taken back at its own time', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await autoTree(page);
    writesAtOnce(bridge);
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.replyHead)).toBe('ab10cd10ef10');
    // Taken back in the research without this app hearing of it: the next copy still carries it.
    const undone = bridge.sends[0];
    await page.clock.fastForward(5 * 60_000);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0043', conflicts: [{ id: 'X0002', person: 'P0003', fact: 'NAME' }], undoneSince: [undone.intake] } };
    bridge.onWrite = () => ({ head: 'd2d2d2d2d2d2', ged: nameConflictGed('d2d2d2d2d2d2') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    await expect(page.locator('.toast', { hasText: 'The research took back a send this copy of the tree still carries' })).toBeVisible();
    const sent = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent);
    expect(sent).toMatchObject({ state: 'undone', intake: undone.intake, at: undone.at });
    const lw = await page.evaluate((id) => JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}').lastWritten, await treeId(page));
    expect(lw).toMatchObject({ conflicts: 1, conflictIds: ['X0002'] });
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).toBe('undone');
    expect(await janFirst(page)).toBe('Jenda');
    // Both in sight: the send taken back, and what this send wrote with its conflict (finding 39).
    await expect(pill(page)).toContainText('Send taken back · 1 conflict to decide');
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'rejected');
    await expect(block(page)).toContainText('Written, 1 conflict');
    await expect(block(page).locator('[data-action="showConflicts"]')).toBeVisible();
    await expect(block(page).getByRole('menuitem', { name: 'Send again' })).toBeVisible();
});

test('finding 43: after a send taken back, an unrelated edit does not go by itself (it would write the send taken back again); Send again first, then the edit goes', async ({ page }) => {
    const bridge = await writtenThenUndone(page);
    const first = bridge.sends.find(r => r.state === 'undone')!.intake;
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET * 3);
    await poll(page);
    expect(bridge.posts).toHaveLength(1);
    await expect(pill(page)).toContainText('Send taken back');
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'rejected');
    await expect(block(page)).toContainText('Nothing more is sent by itself until a choice is made');
    // Leaving the tree does not send it either.
    await page.evaluate(() => window.Strom.UI.researchAutoLeave());
    expect(bridge.posts).toHaveLength(1);
    // A plain Send (the menu, the toolbar) neither: the user is asked to decide; nothing goes, nothing written again.
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect(page.locator('.toast', { hasText: 'First choose: Send again' })).toBeVisible();
    expect(bridge.posts).toHaveLength(1);
    expect(bridge.againAsks ?? []).toEqual([]);
    // The user's choice: written again from what the research kept; the rename goes after it.
    await block(page).getByRole('menuitem', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toEqual([first]);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.posts[1]).toContain('Jenda');
});

test('finding 43, research 1.12.0-rc.19: it leaves out what a send taken back brought (takenBack), so edits go as usual; said, with Send again', async ({ page }) => {
    const bridge = await writtenThenUndone(page, { strom: '1.12.0-rc.19' });
    const first = bridge.sends.find(r => r.state === 'undone')!.intake;
    await openResearchMenu(page);
    await expect(block(page)).toContainText('new edits go to the research as usual');
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0044', changes: 1, applied: 1, undoneSince: [first], takenBack: 1 } };
    bridge.onWrite = () => ({ head: 'e3e3e3e3e3e3', ged: researchGed('e3e3e3e3e3e3') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.againAsks ?? []).toEqual([]);
    const toast = page.locator('.toast', { hasText: '1 change from the send taken back was not written' });
    await expect(toast.getByRole('button', { name: 'Send again' })).toBeVisible();
    await expect(pill(page)).toContainText('Send taken back');
    await openResearchMenu(page);
    await expect(block(page)).toContainText('1 change from the send taken back was not written again');
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());
    // A plain Send by hand is a copy too (never the send taken back written again, finding A).
    await renameJan(page, 'Jeník');
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(3);
    expect(bridge.againAsks ?? []).toEqual([]);
    await renameJan(page, 'Jenda');
    await openResearchMenu(page);
    // Send again: the research writes the send taken back from what it kept.
    await block(page).getByRole('menuitem', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toEqual([first]);
    expect(await janFirst(page)).toBe('Jenda');
});

test('017 U7: Send again is told by what the research wrote again (applied, notWritten): a detail it still keeps is one this window never had', async ({ page }) => {
    const bridge = await writtenThenUndone(page);
    const first = bridge.sends.find(r => r.state === 'undone')!.intake;
    bridge.againReply = { applied: 5, notWritten: [{ kind: 'fact.gone', person: 'P0003', fact: 'BIRT', why: 'kept' }] };
    await openResearchMenu(page);
    await block(page).getByRole('menuitem', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toEqual([first]);
    await expect(page.locator('.toast', { hasText: 'Written 5, not written 1.' })).toBeVisible();
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'notWritten');
    await block(page).getByRole('menuitem', { name: 'Show' }).click();
    const row = page.locator('#research-changes-panel .research-changes-row.is-not-written');
    await expect(row).toContainText('Jan Fíšek');
    await expect(row).toContainText('the Strom archive still keeps it: this window never had these details');
});

test('finding 40: a conflict the next rename updates shows its new value in What the research knows, and stays on the toolbar after an unrelated send', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await autoTree(page);
    const conflictGed = (head: string, user: string, birth: string[] = []) => researchGed(head, [...birth,
        '1 _STROM_CONFLICT X0001', '2 TYPE NAME', '2 STAT open', '2 VAL Jan /Fíšek/', `2 VAL ${user} /Fíšek/`]);
    const conflicts = [{ id: 'X0001', person: 'P0003', fact: 'NAME' }];
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts } };
    bridge.onWrite = () => ({ head: 'c1c1c1c1c1c1', ged: conflictGed('c1c1c1c1c1c1', 'Jenda') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    // The next rename: the research writes the user's newer word into the open conflict (same id).
    bridge.onWrite = () => ({ head: 'c2c2c2c2c2c2', ged: conflictGed('c2c2c2c2c2c2', 'Jendula') });
    await renameJan(page, 'Jendula');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    const janId = await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jendula') as any).id);
    await expect.poll(() => page.evaluate((id) => window.Strom.UI.researchConflictsOf(id).flatMap((c: any) => c.values.map((v: any) => v.value)), janId))
        .toContain('Jendula /Fíšek/');
    await page.evaluate((id) => window.Strom.UI.showPersonResearchDialog(id), janId);
    await expect(page.locator('.modal-overlay.active').last()).toContainText('Jendula');
    await page.keyboard.press('Escape');
    // An unrelated send, written without a conflict: the conflict is still there, and so is the mark.
    bridge.syncReply = WRITE;
    bridge.onWrite = () => ({ head: 'c3c3c3c3c3c3', ged: conflictGed('c3c3c3c3c3c3', 'Jendula', ['1 BIRT', '2 PLAC Praha']) });
    await janBirthPlace(page, 'Praha');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(3);
    await page.clock.fastForward(30_000);
    await poll(page);
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    expect(await janFirst(page)).toBe('Jendula');
    expect(await janWhere(page)).toBe('Praha');
});

test('the bridge stops: "not running" at its next ask (within 20 s), and the tasks it listed wait until it runs again', async ({ page }) => {
    const bridge = await autoTree(page, { waiting: [{ id: 'T0010', what: 'Confirm the baptism', at: new Date().toISOString() }] });
    await poll(page);
    await openResearchMenu(page);
    const sub = page.locator('#research-menu');
    await expect(sub.locator('#research-item-waiting')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());
    bridge.down = true;
    await page.clock.fastForward(21_000);
    await expect.poll(() => page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('bridgeDown');
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'bridgeDown');
    await expect(sub.locator('#research-item-waiting')).toHaveCount(0);
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());
    // Back: the tasks again — asked at once when the window comes back (visibilitychange), no timer waited for.
    bridge.down = false;
    await page.clock.fastForward(6000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).not.toBe('bridgeDown');
    await openResearchMenu(page);
    await expect(sub.locator('#research-item-waiting')).toBeVisible();
});

test('findings D/E: "Send, then load" with a conflict still open over the user\'s value: nothing asked, nothing loaded over it; the research stopping is said beside the conflict', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0001', person: 'P0003', fact: 'NAME' }] } };
    bridge.onWrite = () => ({ head: 'c1c1c1c1c1c1', ged: nameConflictGed('c1c1c1c1c1c1') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    // Its answer taken first: "Send now" while a send is out does nothing (the post is counted when it goes).
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).toBe('written');
    // An unrelated edit sent with "Send, then load": written, no new conflict; its version still has the research's name.
    bridge.syncReply = WRITE;
    bridge.onWrite = () => ({ head: 'c2c2c2c2c2c2', ged: nameConflictGed('c2c2c2c2c2c2', ['1 BIRT', '2 PLAC Praha']) });
    await janBirthPlace(page, 'Praha');
    await page.evaluate(() => window.Strom.UI.researchSendNow({ thenLoad: true }));
    await expect.poll(() => bridge.posts.length).toBe(2);
    await page.clock.fastForward(5000);
    await expect(page.locator('.dialog-confirm', { hasText: 'Changed in the app' })).toHaveCount(0);
    expect(await janFirst(page)).toBe('Jenda');
    expect(await janWhere(page)).toBe('Praha');
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    // Asked by the user, the question names the conflict that Update would replace.
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await expect(page.locator('.dialog-confirm')).toContainText('A conflict is still open in the research about Jenda Fíšek');
    await page.keyboard.press('Escape');
    expect(await janFirst(page)).toBe('Jenda');
    // The research stops: said beside the conflict.
    bridge.down = true;
    await page.clock.fastForward(21_000);
    await expect(pill(page)).toContainText("The research isn't running");
    await openResearchMenu(page);
    await expect(block(page)).toContainText("The research isn't running");
});

test('F4/F5 of the Windows round: the browser blocking the research is said as such (with the setting to allow), never "not running"; allowed, it connects', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    // Edge 154: "Apps on device" (loopback-network) governs 127.0.0.1; asked first.
    await page.addInitScript(() => {
        const status = { state: 'granted', onchange: null };
        (window as unknown as { __lna: typeof status }).__lna = status;
        const orig = navigator.permissions?.query?.bind(navigator.permissions);
        Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
            query: (d: { name: string }) => d.name === 'loopback-network' ? Promise.resolve(status)
                : d.name === 'local-network-access' || d.name === 'local-network' ? Promise.resolve({ state: 'denied', onchange: null })
                : orig ? orig(d as PermissionDescriptor) : Promise.reject(new TypeError('no')),
        } });
    });
    const bridge = await autoTree(page);
    // Only "Local network" blocked: the research is reached all the same.
    await expect(mark(page)).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __lna: { state: string } }).__lna.state = 'denied'; });
    bridge.down = true;
    await page.clock.fastForward(21_000);
    await expect(pill(page)).toContainText('Browser blocks the research');
    await expect(pill(page)).not.toContainText("isn't running");
    await openResearchMenu(page);
    await expect(block(page)).toContainText("The browser doesn't let the app reach the research");
    await expect(block(page)).toContainText('allow “Apps on device” (in older versions “Local network access”)');
    await expect(block(page)).not.toContainText("isn't running");
    // The way to allow it: the dialog with the steps open; allowed, Try again connects.
    await block(page).getByRole('menuitem', { name: 'How to allow' }).click();
    const d = page.locator('#research-connect-failed');
    await expect(d.locator('.connect-reason')).toHaveText('Chromium blocks the connection');
    await expect(d.locator('.connect-how li').nth(1)).toHaveText('Open Site settings and find Apps on device (in older versions Local network access).');
    await page.evaluate(() => { (window as unknown as { __lna: { state: string } }).__lna.state = 'granted'; });
    bridge.down = false;
    await d.getByRole('button', { name: 'Try again' }).click();
    await expect(d).toHaveCount(0);
    await expect(mark(page)).toHaveAttribute('data-look', 'dot');
    await expect(pill(page)).not.toContainText('Browser blocks the research');
});

test('finding 43 by the bridge\'s features (rc.20): sync.takenBack lets edits go after an undo, whatever its version; a send written again elsewhere clears the bar', async ({ page }) => {
    const bridge = await writtenThenUndone(page, { strom: '1.11.0', features: ['sync.again', 'sync.undoneSince', 'sync.takenBack', 'sync.conflictEdit'] });
    const first = bridge.sends.find(r => r.state === 'undone')!;
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0044', changes: 1, applied: 1, undoneSince: [first.intake], takenBack: 1 } };
    bridge.onWrite = () => ({ head: 'e3e3e3e3e3e3', ged: researchGed('e3e3e3e3e3e3') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.againAsks ?? []).toEqual([]);
    await expect(pill(page)).toContainText('Send taken back');
    // Written again in the research (another window's Send again): the bar goes at the next answer.
    (first as { again?: string }).again = 'R20261004060000000-zzzz';
    await poll(page);
    await expect(pill(page)).not.toContainText('Send taken back');
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).not.toBe('undone');
});

test('finding 43, a bridge whose features lack sync.takenBack: nothing goes by itself after an undo, whatever its version', async ({ page }) => {
    const bridge = await writtenThenUndone(page, { strom: '1.12.0', features: ['sync.again'] });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET * 2);
    await poll(page);
    expect(bridge.posts).toHaveLength(1);
});

test('A2: a switch of mode not yet acknowledged is said beside a send taken back, never in its place', async ({ page }) => {
    await writtenThenUndone(page);
    // The research was an archive when this browser last saw it: the switch to an agent is still to be said.
    await page.evaluate((id) => {
        const key = `strom-research-auto:${id}`;
        localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), modeSeen: 'archive' }));
    }, await treeId(page));
    await poll(page);
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'rejected');
    await expect(block(page)).toContainText('was taken back in the research');
    await expect(block(page).getByRole('menuitem', { name: 'Send again' })).toBeVisible();
    await expect(block(page).getByRole('menuitem', { name: 'Got it' })).toBeVisible();
    await expect(pill(page)).toContainText('Send taken back');
});

test('R3 of the rc.49 round: after Send again an older send taken back is not offered (an older state), not even when the next copy\'s reply still lists it', async ({ page }) => {
    const bridge = await writtenThenUndone(page, { features: ['sync.again', 'sync.undoneSince', 'sync.takenBack', 'sync.conflictEdit'] });
    const older = bridge.sends.find(r => r.state === 'undone')!;
    // A later send, written, then taken back too.
    await page.clock.fastForward(60_000);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0050', changes: 1, applied: 1, undoneSince: [older.intake], takenBack: 0 } };
    bridge.onWrite = () => ({ head: 'f1f1f1f1f1f1', ged: researchGed('f1f1f1f1f1f1') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    const later = bridge.sends[0]; // the newest first, as the research lists them
    Object.assign(later, { state: 'undone', decidedAt: new Date().toISOString() });
    await page.clock.fastForward(60_000);
    // Send again for the later one: written; the older one, still taken back there, is an older state — not offered.
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0051', changes: 1, applied: 1, undoneSince: [later.intake, older.intake], takenBack: 1 } };
    await renameJan(page, 'Jeník');
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(3);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.intake)).toBe(later.intake);
    await openResearchMenu(page);
    await block(page).getByRole('menuitem', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toEqual([later.intake]);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).not.toBe('undone');
    await expect(pill(page)).not.toContainText('Send taken back');
    // And the next copy, the research still listing both: the older one is still not offered.
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0052', changes: 1, applied: 1, undoneSince: [later.intake, older.intake], takenBack: 1 } };
    await renameJan(page, 'Jenda');
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(4);
    await poll(page);
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).not.toBe('undone');
    await expect(pill(page)).not.toContainText('Send taken back');
    expect(bridge.againAsks ?? []).toEqual([later.intake]);
    // Never a silent difference (the beta.70 round): the older one's changes are said to be only here,
    // with the way to see them (loading the research's version), and the ⋯ row has its dot.
    await openResearchMenu(page);
    await expect(block(page)).toContainText('are not in the research: they stayed only here');
    await expect(block(page).locator('[data-action="loadNewer"]')).toBeVisible();
    await expect(page.locator('#research-menu-signal[data-signal="attention"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // Its version loaded after the undo: settled, nothing said any more.
    await page.evaluate(() => {
        const id = window.Strom.DataManager.getCurrentTreeId();
        window.Strom.TreeManager.patchResearchLink(id, { syncedAt: new Date(Date.now() + 60_000).toISOString() });
    });
    await openResearchMenu(page);
    await expect(block(page)).not.toContainText('are not in the research: they stayed only here');
});

test('a send taken back before this page knew (not its last write) is shown with its own Send again; one taken back before the last load is settled', async ({ page }) => {
    const bridge = await autoTree(page);
    const syncedAt = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.syncedAt);
    const tree = await treeId(page);
    const before = new Date(Date.parse(syncedAt!) - 60_000).toISOString();
    // Taken back before the tree last loaded the research's version: the undo was kept there, nothing to say.
    bridge.sends.push({ intake: 'R20261004050000000-old1', at: before, state: 'undone', changes: 1, tree, sent: 'x', decidedAt: before });
    await poll(page);
    await expect(pill(page)).not.toContainText('Send taken back');
    // Taken back since: in sight, its own Send again.
    const now = new Date().toISOString();
    bridge.sends.unshift({ intake: 'R20261004060000000-new1', at: now, state: 'undone', changes: 1, tree, sent: 'y', decidedAt: now });
    await poll(page);
    await expect(pill(page)).toContainText('Send taken back');
    await openResearchMenu(page);
    await block(page).getByRole('menuitem', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toEqual(['R20261004060000000-new1']);
});

test('the rc.22 round: a stuck bridge says it does not respond (B5), an old address that it turned down (B4), both in the pill', async ({ page }) => {
    const bridge = await autoTree(page);
    bridge.statusHang = true;
    void page.evaluate(() => window.Strom.UI.pollResearchBridge());
    await page.clock.fastForward(4000);
    await expect(pill(page)).toContainText("The research doesn't respond");
    await openResearchMenu(page);
    await expect(block(page)).toContainText('strom live stop');
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());
    bridge.statusHang = false;
    bridge.statusCode = 404;
    await poll(page);
    await expect(pill(page)).toContainText('The research turned the connection down');
    bridge.statusCode = undefined;
    await poll(page);
    await expect(pill(page)).not.toContainText('turned the connection down');
});

test('the rc.22 round: a send by hand cut on its way says so and offers Try again, not the old way through the terminal (B6)', async ({ page }) => {
    const bridge = await autoTree(page);
    bridge.syncAbort = true;
    await editJan(page);
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    const toast = page.locator('.toast', { hasText: "couldn't be reached" });
    await expect(toast.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('#research-send-modal, .research-send-dialog')).toHaveCount(0);
    bridge.syncAbort = false;
    writesAtOnce(bridge);
    await toast.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => bridge.posts.length).toBe(1);
});

test('the rc.22 round: a send taken back shows in the toolbar when changes go by hand too (B1)', async ({ page }) => {
    await writtenThenUndone(page, { features: ['sync.again', 'sync.undoneSince', 'sync.takenBack'] });
    await page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        tm.patchResearchLink(tm.getActiveTreeId()!, { sendMode: 'manual' });
        window.Strom.UI.refreshResearchSyncUi();
    });
    await expect(pill(page)).toContainText('Send taken back');
    await openResearchMenu(page);
    await expect(block(page)).toContainText('new edits go to the research as usual');
});

test('the rc.22 round: opened again by ?live= with nothing new there and changes here (a new port): connected, nothing asked (B3)', async ({ page }) => {
    await autoTree(page);
    await editJan(page);
    await page.evaluate((b) => { void window.Strom.UI.startLiveFollow(b); }, BRIDGE);
    await expect(page.locator('.toast', { hasText: 'Connected to the research again' })).toBeVisible();
    await expect(page.locator('.dialog-confirm, #confirmation-modal.active')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.UI.isFollowingActiveResearch())).toBe(false);
    expect(await janWhere(page)).not.toBe('');
});

test('connected again by ?live= with changes here: Follow live on the toast asks first, and Send, then load sends, loads and follows (beta.60 round)', async ({ page }) => {
    const bridge = await autoTree(page);
    writesAtOnce(bridge);
    await editJan(page);
    await page.evaluate((b) => { void window.Strom.UI.startLiveFollow(b); }, BRIDGE);
    const toast = page.locator('.toast', { hasText: 'Connected to the research again' });
    await toast.getByRole('button', { name: 'Follow live' }).click();
    // The research has nothing newer than the tree's base: not said it has (N61-4).
    await expect(page.getByRole('button', { name: 'Send, then load' })).toBeVisible();
    await expect(page.locator('.modal-overlay.active').last()).not.toContainText('the research has a newer version');
    await page.getByRole('button', { name: 'Send, then load' }).click();
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect.poll(() => page.evaluate(() => window.Strom.UI.isFollowingActiveResearch())).toBe(true);
    expect(await janWhere(page)).not.toBe('');
});

test('rc.23 / N1: a copy built on a written send whose version was not loaded says so (_STROM_SINCE), always when known; a version loaded since is the base then', async ({ page }) => {
    const bridge = await autoTree(page, { features: ['sync.again', 'sync.undoneSince', 'sync.takenBack', 'sync.since'] });
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0001', person: 'P0003', fact: 'NAME' }] } };
    bridge.onWrite = () => ({ head: 'c1c1c1c1c1c1', ged: nameConflictGed('c1c1c1c1c1c1') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    expect(bridge.posts[0]).not.toContain('_STROM_SINCE');
    const first = bridge.sends[0].intake;
    // Not loaded (a conflict over the user's value): the next copy builds on the first one.
    bridge.syncReply = WRITE;
    bridge.onWrite = () => ({ head: 'c2c2c2c2c2c2', ged: nameConflictGed('c2c2c2c2c2c2', ['1 BIRT', '2 PLAC Praha']) });
    await janBirthPlace(page, 'Praha');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.posts[1]).toContain(`1 _STROM_SINCE ${first}`);
    expect(bridge.posts[1]).toContain('1 _STROM_HEAD');
    const second = bridge.sends[0].intake;
    // A bridge that does not say sync.since (or whose status is not read yet): still said (N1).
    bridge.features = ['sync.again'];
    await poll(page);
    await janBirthPlace(page, 'Brno');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(3);
    expect(bridge.posts[2]).toContain(`1 _STROM_SINCE ${second}`);
    // The research's version loaded here (asked): it is the base — no SINCE of an older copy.
    const loaded = bridge.head;
    await sendTakenIn(page, bridge.sends[0].intake);
    await loadNewerAsked(page, loaded);
    await janBirthPlace(page, 'Kolín');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(4);
    expect(bridge.posts[3]).not.toContain('_STROM_SINCE');
    expect(bridge.posts[3]).toContain(`1 _STROM_HEAD ${loaded}`);
});

test('B18-2: after `strom update` (1.12.1 → 1.13) the next copy names no _STROM_SINCE of a copy the older version took in (what it left out, a known sex set unknown, would read as given); the copies after it do again', async ({ page }) => {
    const bridge = await autoTree(page, { strom: '1.12.1', features: ['sync.again', 'sync.undoneSince', 'sync.takenBack', 'sync.since'] });
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0001', person: 'P0003', fact: 'NAME' }] } };
    bridge.onWrite = () => ({ head: 'c1c1c1c1c1c1', ged: nameConflictGed('c1c1c1c1c1c1') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    const first = bridge.sends[0].intake;
    // Not loaded (a conflict over the user's value): the next copy builds on the first one — the same research.
    bridge.syncReply = WRITE;
    bridge.onWrite = () => ({ head: 'c2c2c2c2c2c2', ged: nameConflictGed('c2c2c2c2c2c2', ['1 BIRT', '2 PLAC Praha']) });
    await janBirthPlace(page, 'Praha');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.posts[1]).toContain(`1 _STROM_SINCE ${first}`);
    // Updated: the copy 1.12.1 took in is no base for 1.13 — _STROM_HEAD only, the research finds its base itself.
    bridge.strom = '1.13.0-beta.9';
    bridge.features = [...bridge.features!, 'person.titles'];
    await poll(page);
    await janBirthPlace(page, 'Brno');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(3);
    expect(bridge.posts[2]).not.toContain('_STROM_SINCE');
    expect(bridge.posts[2]).toContain('1 _STROM_HEAD');
    const third = bridge.sends[0].intake;
    // The next one builds on the copy 1.13 took in.
    await janBirthPlace(page, 'Kolín');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(4);
    expect(bridge.posts[3]).toContain(`1 _STROM_SINCE ${third}`);
});

test('a restored backup sends the base it kept: _STROM_HEAD and _STROM_SINCE of when it was taken (N61-3)', async ({ page }) => {
    const bridge = await autoTree(page, { features: ['sync.again', 'sync.undoneSince', 'sync.takenBack', 'sync.since'] });
    const base = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);
    expect(base).toBeTruthy();
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0001', person: 'P0003', fact: 'NAME' }] } };
    bridge.onWrite = () => ({ head: 'c1c1c1c1c1c1', ged: nameConflictGed('c1c1c1c1c1c1') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    const first = bridge.sends[0].intake;
    // The backup keeps the copy the research took in (lastCopy): wait until the
    // app has taken the reply in, not only sent (a loaded machine took the
    // backup in between, and it kept no _STROM_SINCE).
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem(`strom-research-auto:${window.Strom.TreeManager.getActiveTreeId()}`) ?? '{}').lastCopy?.intake)).toBe(first);
    // A backup now: the copy the research took in, on the head the tree stands on.
    const snap = await page.evaluate(() => window.Strom.DataManager.snapshotNow('manual'));
    expect(snap).toBeTruthy();
    // Then the research's version is loaded here (a newer head) and an edit goes on it.
    const loaded = bridge.head;
    await sendTakenIn(page, first);
    await loadNewerAsked(page, loaded);
    bridge.syncReply = WRITE;
    await janBirthPlace(page, 'Praha');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.posts[1]).toContain(`1 _STROM_HEAD ${loaded}`);
    // The backup restored: its data build on the head and the copy of when it was taken, and the next send says so.
    expect(await page.evaluate((id) => window.Strom.DataManager.restoreSnapshot(id!).then(r => !!r), snap)).toBe(true);
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(base);
    await janBirthPlace(page, 'Brno');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(3);
    expect(bridge.posts[2]).toContain(`1 _STROM_HEAD ${base}`);
    expect(bridge.posts[2]).toContain(`1 _STROM_SINCE ${first}`);
});

/** A write that left a conflict over the user's value: its version not loaded, the conflict in sight. */
async function conflictLeft(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await autoTree(page, init);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0001', person: 'P0003', fact: 'NAME' }] } };
    bridge.onWrite = () => ({ head: 'c1c1c1c1c1c1', ged: nameConflictGed('c1c1c1c1c1c1') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    await page.clock.fastForward(30_000);
    await poll(page);
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    return bridge;
}

test('V-E: the conflict decided in the research (its record: none open) — no "1 conflict to decide" here any more', async ({ page }) => {
    const bridge = await conflictLeft(page);
    // Its record says what is still open: one, then none.
    (bridge.sends[0] as unknown as { conflicts: number }).conflicts = 1;
    await page.clock.fastForward(30_000);
    await poll(page);
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    const jan = page.locator('.person-card', { hasText: 'Jenda' }).first();
    await expect(jan).toHaveAttribute('aria-label', /conflicting sources/);
    (bridge.sends[0] as unknown as { conflicts: number }).conflicts = 0;
    await page.clock.fastForward(30_000);
    await poll(page);
    await expect(pill(page)).not.toContainText('conflict');
    // The card's badge follows (no load needed).
    await expect(jan).not.toHaveAttribute('aria-label', /conflicting sources/);
    await openResearchMenu(page);
    await expect(block(page)).not.toHaveAttribute('data-state', 'writtenConflicts');
    await expect(block(page)).not.toContainText('conflict');
});

test('the rc.23 round: beside an open conflict, a stuck bridge, a refused address and a stopped one are each said (A1); a send by hand then never the old way (A2)', async ({ page }) => {
    const bridge = await conflictLeft(page);
    bridge.statusHang = true;
    void page.evaluate(() => window.Strom.UI.pollResearchBridge());
    await page.clock.fastForward(4000);
    await expect(pill(page)).toContainText("The research doesn't respond");
    await openResearchMenu(page);
    await expect(block(page)).toContainText('strom live stop');
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());
    // Send by hand now: said, Try again — no dialog about the terminal.
    await janBirthPlace(page, 'Brno');
    void page.evaluate(() => window.Strom.UI.researchSendNow());
    await page.clock.fastForward(4000);
    await expect(page.locator('.toast', { hasText: "doesn't respond" }).getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
    bridge.statusHang = false;
    bridge.statusCode = 404;
    await poll(page);
    await expect(pill(page)).toContainText('The research turned the connection down');
    bridge.statusCode = undefined;
    bridge.down = true;
    await poll(page);
    await openResearchMenu(page);
    await expect(block(page)).toContainText('strom app --live');
});

test('the rc.23 round: ?live= again with an open conflict and nothing new there: connected, nothing asked (A3)', async ({ page }) => {
    await conflictLeft(page);
    await page.evaluate((b) => { void window.Strom.UI.startLiveFollow(b); }, BRIDGE);
    await expect(page.locator('.toast', { hasText: 'Connected to the research again' })).toBeVisible();
    await expect(page.locator('.dialog-confirm')).toHaveCount(0);
    expect(await janFirst(page)).toBe('Jenda');
});

test('the rc.23 round: _STROM_SINCE after a send taken back too — the last copy the research took in (A4)', async ({ page }) => {
    const bridge = await writtenThenUndone(page, { features: ['sync.again', 'sync.undoneSince', 'sync.takenBack', 'sync.since'] });
    const first = bridge.sends.find(r => r.state === 'undone')!.intake;
    // Nothing loads by itself: each copy names the last one the research took in.
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0060', changes: 1, applied: 1, undoneSince: [first], takenBack: 0 } };
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    const second = bridge.sends[0].intake;
    // Beside the send taken back (nothing loaded): the next copy builds on the second.
    await renameJan(page, 'Jeník');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(3);
    expect(bridge.posts[2]).toContain(`1 _STROM_SINCE ${second}`);
});

test('the rc.23 round: changes the research counted but neither wrote nor explained are told (A5)', async ({ page }) => {
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 0, input: 'I0070' } };
    bridge.onWrite = () => ({ head: 'd9d9d9d9d9d9', ged: researchGed('d9d9d9d9d9d9') });
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect(page.locator('.toast', { hasText: "1 change was not written to the research, and it didn't say why" })).toBeVisible();
});

test('rc.25: what the research did not write is listed with its reason (notWritten)', async ({ page }) => {
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 2, applied: 1, input: 'I0071',
        notWritten: [{ kind: 'event.edit', person: 'P0003', fact: 'BIRT', why: 'pick' }] } };
    bridge.onWrite = () => ({ head: 'd8d8d8d8d8d8', ged: researchGed('d8d8d8d8d8d8') });
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    const toast = page.locator('.toast', { hasText: '1 change was not written to the research' });
    await toast.getByRole('button', { name: 'Show' }).click();
    // "What was written": not written first, with the reason; the person named there is not listed as written.
    const panel = page.locator('#research-changes-panel');
    await expect(panel.locator('.research-changes-section.is-warn')).toHaveText('Not written · 1');
    await expect(panel.locator('.research-changes-row.is-not-written')).toContainText('Jan Fíšek');
    await expect(panel.locator('.research-changes-row.is-not-written')).toContainText('Birth');
    await expect(panel.locator('.research-changes-row.is-not-written')).toContainText('no common ground: choose in the research');
    await expect(panel.locator('.research-changes-row:not(.is-not-written)')).toHaveCount(0);
});

test('V-J: what the research did not write is the state until the next send (a dot until seen); loading over it asks first; nothing loads after a send that left it', async ({ page }) => {
    await page.clock.install();
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
    await poll(page);
    // Kept there: the change and the citation with it, said only as "BIRT kept".
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 3, applied: 2, input: 'I0072',
        notWritten: [{ kind: 'event.edit', person: 'P0003', fact: 'BIRT', why: 'kept' }] } };
    bridge.onWrite = () => ({ head: 'd7d7d7d7d7d7', ged: researchGed('d7d7d7d7d7d7') });
    await editJan(page);
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect(page.locator('.toast', { hasText: 'Written 2, not written 1.' })).toBeVisible();
    await expect(dot(page)).toBeVisible();
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'notWritten');
    await expect(block(page)).toContainText('Written 2, not written 1');
    await expect(block(page)).toContainText('What was not written stays here in the app.');
    await block(page).getByRole('menuitem', { name: 'Show' }).click();
    const panel = page.locator('#research-changes-panel');
    await expect(panel.locator('.research-changes-row.is-not-written')).toContainText('Jan Fíšek');
    // Jan is not claimed as written (V-J): his citation went with the change kept there.
    await expect(panel.locator('.research-changes-list.is-quiet')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Seen: no dot, the block stays (neutral) until the next send.
    await expect(dot(page)).toBeHidden();
    // The research has a newer version: loading it would drop the change here — asked first.
    bridge.head = 'e7e7e7e7e7e7';
    bridge.treeGed = researchGed('e7e7e7e7e7e7');
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    const ask = page.locator('#research-load-modal');
    await expect(ask.locator('.research-load-warn')).toContainText('1 change of the last send was not written to the research.');
    await expect(ask.locator('#research-load-ok')).toHaveText('Load and overwrite');
    await ask.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).not.toBe('e7e7e7e7e7e7');
    expect(await janPlace(page)).toBe('Praha');
});

test('rc.26: the numbers the research gave what a send added (ids, by its xrefs) are kept, quietly — no new send, the next names them', async ({ page }) => {
    const bridge = await conflictLeft(page);
    await page.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Petr', lastName: 'Fíšek', gender: 'male' }));
    bridge.syncReply = WRITE;
    bridge.onWrite = () => ({ head: 'c2c2c2c2c2c2', ged: nameConflictGed('c2c2c2c2c2c2') });
    bridge.replyExtra = (posted) => {
        const xref = /0 (@I\d+@) INDI\n1 NAME Petr/.exec(posted)?.[1];
        return xref ? { ids: { persons: { [xref]: 'P0099' }, sources: {} } } : {};
    };
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    await expect.poll(() => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Petr') as any)?.refn)).toBe('P0099');
    // Not a change to send: nothing goes by itself after the quiet time.
    await page.clock.fastForward(QUIET * 2);
    await poll(page);
    expect(bridge.posts).toHaveLength(2);
    // The next send names him by the research's number.
    await janBirthPlace(page, 'Kolín');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(3);
    expect(bridge.posts[2]).toMatch(/1 NAME Petr[\s\S]*?1 REFN P0099/);
});

test('the rc.27 round: ?live= with an old token says the research turned it down, on the tree of that research (not another)', async ({ page }) => {
    const bridge = await autoTree(page);
    const researchTree = await treeId(page);
    // Another tree open, as the page may start with.
    await page.evaluate(async () => {
        const id = window.Strom.TreeManager.createTree('Other');
        await window.Strom.DataManager.switchTree(id);
    });
    expect(await treeId(page)).not.toBe(researchTree);
    bridge.statusCode = 404;
    await page.evaluate((b) => { void window.Strom.UI.startLiveFollow(b); }, BRIDGE);
    const dialog = page.locator('.research-connect-failed');
    await expect(dialog).toHaveAttribute('data-reason', 'refused');
    await expect(dialog).toContainText('The research turned the connection down');
    expect(await treeId(page)).toBe(researchTree);
});

test('1021 (over the rc.27 round): the pill counts the write\'s conflicts; another one open on a card is not the write\'s', async ({ page }) => {
    await conflictLeft(page);
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    // A conflict the research opened by itself (not the write's): on its card and under "Waiting for you", not in the count.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const josef = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Josef') as any;
        josef.research = { conflicts: [{ id: 'X0009', fact: 'BIRT', status: 'open', values: [{ value: '1840' }, { value: '1841' }] }] };
        window.Strom.UI.refreshResearchSyncUi();
    });
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    await expect(pill(page)).not.toContainText('2 conflicts');
});

test('a write that takes longer (202): "writing" until the status says written; its version is this tree\'s own (not "newer"), loaded only when asked', async ({ page }) => {
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
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.replyHead)).toBe('aa11bb22cc33');
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).not.toBe('aa11bb22cc33');
    await expect(mark(page)).toHaveAttribute('data-look', /check|dot/);
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'written');
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
        // Sent by hand with nothing to send: the quiet mark stays, in the Send button's kept place.
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.evaluate(() => window.Strom.UI.setResearchSendMode(window.Strom.TreeManager.getActiveTreeId()!, 'manual'));
        await expect(mark(page)).toHaveAttribute('data-look', 'ghost');
        await expect(page.locator('#research-sync-pill')).toHaveClass(/is-reserved/);
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
        await expect(note).toContainText('Changes now go to the research automatically.');
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
        await block(page).getByRole('menuitem', { name: 'Got it' }).click();
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
        await expect(send).toHaveAttribute('title', 'Send the changes to the research');
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect.poll(() => send.innerText()).toBe('Send');
        // Changes not sent: the Research button's one dot (at every width); none on ⋯.
        const unsentDot = page.locator('#research-menu-signal[data-signal="unsent"]');
        await expect(unsentDot).toBeVisible();
        await expect(page.locator('#research-menu-btn')).toHaveAttribute('aria-label', 'Research – changes from the app not yet in the research');
        await expect(page.locator('.actions-menu-btn')).toHaveAttribute('aria-label', 'Actions');
        await page.setViewportSize({ width: 1100, height: 900 });
        await expect(send).toBeHidden();
        await expect(unsentDot).toBeVisible();
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
        // Nothing to send: the quiet mark in the button's place, next to the tree switcher.
        await expect(page.locator('#research-sync-mark')).toHaveAttribute('data-look', 'dot');
        bridge.down = true;
        await poll(page);
        await expect(page.locator('#research-sync-mark')).toHaveAttribute('data-look', 'ghost');
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
            await expect(page.locator('#research-menu-signal')).toHaveCount(0);
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
        await openResearchMenu(page, { expandMore: true });
        const sub = page.locator('#research-menu');
        // In step with a running bridge: no "Load new version" row (the block offers one when there is).
        await expect(sub.locator('#research-item-version')).toHaveCount(0);
        await expect(sub.locator('#research-item-open')).toBeVisible();
        await expect(sub.locator('#research-item-tree-settings')).toBeVisible();
        for (const id of ['research-item-chat', 'research-item-live', 'research-item-send']) {
            await expect(sub.locator(`#${id}`)).toHaveCount(0);
        }
        // Taking the last send back stays the user's in an archive.
        await expect(sub.locator('#research-item-undo')).toBeVisible();
        // "Archive" opens the state block's second line (the menu has no heading of its own), once (D17).
        await expect(block(page).locator('.research-sync-sub #research-menu-archive')).toHaveText('Strom archive');
        await expect(sub.locator('.research-sync-tag')).toHaveCount(1);
        // The footer says what the research mark means in an archive.
        await expect(sub.locator('#research-menu-foot')).toHaveAttribute('title', 'Continues in the Strom archive on this computer; actions are confirmed there.');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        const actions = await page.evaluate(() => {
            const jan = Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            return window.Strom.UI.getPersonMenuActions(jan.id).map((a: any) => [a.action, ...(a.submenu ?? []).map((x: any) => x.action)]).flat();
        });
        for (const a of ['research-review', 'research-ancestors', 'research-descendants', 'research-ask', 'research']) expect(actions).not.toContain(a);
    });

    test('the bridge switches to archive while the page is open: the menu changes at its next answer, no reload', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null },
            links: ['send', 'open', 'live', 'app', 'setup', 'chat', 'review', 'research', 'sync-undo'] });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await poll(page);
        await openResearchMenu(page, { expandMore: true });
        const sub = page.locator('#research-menu');
        await expect(sub.locator('#research-item-chat')).toBeVisible();
        await expect(sub.locator('#research-item-live')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        bridge.accepts = ARCHIVE;
        await poll(page);
        await openResearchMenu(page);
        await expect(sub.locator('#research-item-chat')).toHaveCount(0);
        await expect(sub.locator('#research-item-live')).toHaveCount(0);
        await expect(sub).not.toContainText('paid');
        // And back: the agent's rows again, at the next answer.
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        bridge.accepts = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
        await poll(page);
        await openResearchMenu(page);
        await expect(sub.locator('#research-item-chat')).toBeVisible();
    });

    test('the research\'s bridge never reached this browser (others did): no agent rows, no old "waiting"; its ?import-url= pairs it, the menu follows', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true, bridge: false });
        await page.evaluate(({ uuid }) => {
            // Another research's bridge is known here; this one's not. Links were announced, a list was kept.
            localStorage.setItem('strom-research-bridge:11111111-2222-4333-8444-555555555555', JSON.stringify({ base: 'http://127.0.0.1:5997/ffffffffffffffffffffffffffffffff' }));
            localStorage.setItem('strom-research-links', JSON.stringify({ actions: ['send', 'open', 'live', 'app', 'setup', 'chat'], at: new Date().toISOString() }));
            localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({ items: [{ id: 'T0010', what: 'Confirm', at: new Date().toISOString() }], at: new Date().toISOString() }));
            localStorage.setItem('strom-research-auto-intro-seen', '1');
        }, { uuid: UUID });
        await openResearchMenu(page);
        const sub = page.locator('#research-menu');
        await expect(sub.locator('#research-item-open')).toBeVisible();
        for (const id of ['research-item-chat', 'research-item-live', 'research-item-waiting']) await expect(sub.locator(`#${id}`)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // The research opens its version here from its bridge: the bridge is known from now on, its mode said.
        await fakeBridge(page, { accepts: ARCHIVE, links: ['send', 'open', 'live', 'app', 'setup', 'chat'] });
        await page.evaluate((u) => window.Strom.UI.openExternalRequest(new URLSearchParams({ 'import-url': u })), `${BRIDGE}/tree.ged`);
        await expect.poll(() => page.evaluate((uuid) => !!localStorage.getItem(`strom-research-bridge:${uuid}`), UUID)).toBe(true);
        await expect.poll(() => page.evaluate(() => window.Strom.UI.activeResearchArchive())).toBe(true);
        // An archive: the old tasks are gone, not only hidden.
        await poll(page);
        expect(await page.evaluate((uuid) => JSON.parse(localStorage.getItem(`strom-research-waiting:${uuid}`) ?? '{}').items, UUID)).toEqual([]);
        await openResearchMenu(page);
        for (const id of ['research-item-chat', 'research-item-live', 'research-item-waiting']) await expect(sub.locator(`#${id}`)).toHaveCount(0);
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
        await expect(block(page)).toContainText('The research is now a Strom archive.');
        await block(page).getByRole('menuitem', { name: 'Got it' }).click();
        await expect(dot(page)).toBeHidden();
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).not.toHaveAttribute('data-state', 'switched');
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        const dialog = page.locator('#research-tree-settings-modal');
        await expect(dialog.locator('h2 .research-sync-tag')).toHaveText('Strom archive');
        await expect(dialog).toContainText('The research has been a Strom archive since');
        // An archive takes transcripts as leads: no setting for them (it waits for a switch to research).
        await expect(dialog.locator('input[name="research-transcripts"]')).toHaveCount(0);
        await expect(dialog).toContainText('The research writes every send straight away.');
    });

    test('the offer to send by itself: only after five sends by hand were written; either answer closes it for good', async ({ page }) => {
        await page.clock.install();
        await openResearch(page);
        await fakeBridge(page, { accepts: ARCHIVE });
        const writes = (n: number) => page.evaluate((n) => {
            const key = `strom-research-auto:${window.Strom.TreeManager.getActiveTreeId()}`;
            localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), manualWrites: n }));
        }, n);
        await writes(4);
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).not.toHaveAttribute('data-state', 'offerAuto');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        await writes(5);
        await poll(page);
        await expect(dot(page)).toBeHidden();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'offerAuto');
        await expect(block(page)).toContainText('Changes are sent regularly. Send them by themselves?');
        await block(page).getByRole('menuitem', { name: 'No, thanks' }).click();
        await openResearchMenu(page);
        await expect(block(page)).not.toHaveAttribute('data-state', 'offerAuto');
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sendMode)).toBe('manual');
        // Another tree of the same archive: Send automatically.
        await page.evaluate(() => localStorage.setItem(`strom-research-auto:${window.Strom.TreeManager.getActiveTreeId()}`, JSON.stringify({ modeAsked: true, manualWrites: 5 })));
        await poll(page);
        await openResearchMenu(page);
        await block(page).getByRole('menuitem', { name: 'Yes' }).click();
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
        await expect(page.locator('.confirm-note')).toContainText('Strom archive The research sets it aside; it can be restored.');
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
        // An archive is not running (not "the research"); its changes wait (A9).
        await expect(block(page).locator('.research-sync-title')).toContainText("The Strom archive hasn't been running since");
        await expect(block(page)).toContainText("The Strom archive can't take anything now. 3 changes waiting");
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        await expect(page.locator('#research-send-status')).toContainText("The Strom archive hasn't been running since");
    });

    test('a second switch of mode: the date in Research for this tree is the last switch (K5.3)', async ({ page }) => {
        await page.clock.install({ time: new Date('2026-10-01T10:00:00') });
        await openResearch(page, { auto: true });
        const RESEARCH = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
        const bridge = await fakeBridge(page, { accepts: RESEARCH });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await poll(page);
        const modeLine = async (): Promise<string> => {
            await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
            const text = await page.locator('#research-tree-settings-modal .research-mode-line').first().innerText();
            await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());
            return text;
        };
        const gotIt = async (): Promise<void> => {
            await openResearchMenu(page);
            await expect(block(page)).toHaveAttribute('data-state', 'switched');
            await block(page).getByRole('menuitem', { name: 'Got it' }).click();
        };
        // 1 October: to an archive.
        bridge.accepts = ARCHIVE;
        await poll(page);
        await gotIt();
        const first = await modeLine();
        expect(first).toMatch(/^The research has been a Strom archive since .*1.*Oct.*2026|^The research has been a Strom archive since .*2026/);
        // 10 October: back to research — the line says so, from that day.
        await page.clock.setSystemTime(new Date('2026-10-10T10:00:00'));
        bridge.accepts = RESEARCH;
        await poll(page);
        await gotIt();
        const second = await modeLine();
        expect(second).toMatch(/^The research has worked with an agent since /);
        expect(second).toContain('10');
        expect(second.replace(/^.* since /, '')).not.toBe(first.replace(/^.* since /, ''));
    });

    test('Research for this tree says where the mode is switched, both ways, with Open the research (K5.4)', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        const RESEARCH = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
        const bridge = await fakeBridge(page, { accepts: RESEARCH });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await poll(page);
        const where = page.locator('#research-tree-settings-modal #research-mode-where');
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        await expect(where).toHaveText('The research is switched to a Strom archive in the research: Settings → “Research, or only a Strom archive”. Open the research, opens in the research');
        await where.locator('#research-mode-where-open').click();
        await expect(page.locator('#research-tree-settings-modal')).toHaveCount(0);
        expect(await links(page)).toEqual([`strom-research://open?tree=${UUID}`]);
        bridge.accepts = ARCHIVE;
        await poll(page);
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        await expect(where).toHaveText('The Strom archive is switched to research in the research, with the first item of its menu: “Switch research on”. Open the research, opens in the research');
        await where.locator('#research-mode-where-open').click();
        expect(await links(page)).toEqual([`strom-research://open?tree=${UUID}`, `strom-research://open?tree=${UUID}`]);
    });

    test('batches nobody sorts are stored, never waiting to be filed: kept by the bridge, or an archive of an older bridge (K4.5)', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true, media: true });
        const MEDIA = { max: 500 * 1024 * 1024, region: true, batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } };
        const batches = [{ id: 'b-12345678', name: 'Matriky', state: 'closed', at: new Date().toISOString(), files: 5, known: 0, refused: 0, sorted: 0 }];
        const kept = [{ ...batches[0], kept: true }];
        const RESEARCH = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: MEDIA };
        const bridge = await fakeBridge(page, { accepts: RESEARCH, batches });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        const batchLine = async (): Promise<string> => {
            await poll(page);
            await openResearchMenu(page);
            await expect(page.locator('#research-menu')).toBeVisible();
            const text = await page.locator('#research-menu .batch-line').count() ? await page.locator('#research-menu .batch-line .research-sync-line2-text').innerText() : '';
            await page.evaluate(() => window.Strom.UI.closeActionsMenu());
            return text;
        };
        // With an agent: how far it sorted.
        expect(await batchLine()).toBe('Matriky: 0 of 5 sorted');
        // An archive of an older bridge (no batch.kept): stored by the archive's mode.
        bridge.accepts = { ...ARCHIVE, media: MEDIA };
        expect(await batchLine()).toBe('Matriky: 5 files stored');
        await openResearchMenu(page);
        await expect(page.locator('#research-menu .batch-line')).toContainText('Overview');
        await expect(page.locator('#research-menu')).not.toContainText(/waiting to be filed|sorted/);
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // A bridge that marks kept batches: in the archive, and in a research waiting for its agent.
        bridge.features = ['batch.kept'];
        bridge.batches = kept;
        expect(await batchLine()).toBe('Matriky: 5 files stored');
        bridge.accepts = { ...RESEARCH, agentHere: false };
        expect(await batchLine()).toBe('Matriky: 5 files stored');
        // Waiting for its agent on an older bridge (no kept): as before.
        bridge.features = undefined;
        bridge.batches = batches;
        expect(await batchLine()).toBe('Matriky: 0 of 5 sorted');
        // With an agent and the feature, a batch not kept: how far it sorted.
        bridge.features = ['batch.kept'];
        bridge.accepts = RESEARCH;
        expect(await batchLine()).toBe('Matriky: 0 of 5 sorted');
    });
    test('a deletion the archive kept (undone there): named as the deletion it was, not as written, its version offered at once (audit 017 a-D2)', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        const bridge = await fakeBridge(page, { accepts: ARCHIVE });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await poll(page);
        // The archive keeps Jan: his deletion there was undone, what this window sent last had no Jan.
        bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 0, input: 'I0074',
            notWritten: [{ kind: 'person.delete', person: 'P0003', why: 'kept' }] } };
        bridge.onWrite = () => ({ head: 'd6d6d6d6d6d6', ged: researchGed('d6d6d6d6d6d6') });
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.deletePerson(jan.id);
        });
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(1);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'notWritten');
        // The archive's version (with Jan) at once, beside Show.
        await expect(block(page).getByRole('menuitem', { name: "Load the research's version" })).toBeVisible();
        await block(page).getByRole('menuitem', { name: 'Show' }).click();
        const panel = page.locator('#research-changes-panel');
        const row = panel.locator('.research-changes-row.is-not-written');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('Jan Fíšek');
        await expect(row).toContainText('the Strom archive still keeps it: the deletion was undone there');
        await expect(panel).not.toContainText('never had');
        // Not written, so not "written" too.
        await expect(panel.locator('.research-changes-row:not(.is-not-written)', { hasText: 'Jan Fíšek' })).toHaveCount(0);
        await panel.locator('[data-act="loadNewer"]').click();
        await expect(panel).toHaveCount(0);
        // Asked first, as any load over changes made here.
        await page.locator('.dialog-confirm', { hasText: 'Changed in the app' }).getByRole('button', { name: 'Update' }).click();
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('d6d6d6d6d6d6');
        await expect(card(page, 'Jan')).toBeVisible();
    });

    test('conflicts in an archive as in a research: counted in "What was written", decided there; no note that it has none (audit 017 c-D3)', async ({ page }) => {
        await conflictLeft(page, { accepts: ARCHIVE, links: ['send', 'open', 'live', 'app', 'setup', 'conflict'] });
        await page.evaluate(() => window.Strom.UI.showResearchChanges('written'));
        const panel = page.locator('#research-changes-panel');
        await expect(panel).toContainText('1 conflict');
        await expect(panel).not.toContainText(/doesn't create conflicts/);
        await expect(panel.locator('[data-act="decide"]')).toHaveText('Decide in the research, opens in the research');
    });
});

test.describe('a research waiting for its agent (agentHere: false)', () => {
    // No agent on this computer: it writes as an archive does and is shown as one (the Archive tag)
    // until the agent starts (spec 017 decision e); nothing is said to have switched.
    const WAITING = { mode: 'research', agentHere: false, sync: { auto: 'mirror' }, sources: true, verified: true, media: null };
    const ALL = ['send', 'open', 'live', 'app', 'setup', 'chat', 'review', 'research', 'sync-undo', 'conflict', 'direction'];

    test('nothing of the agent: no agent rows, queue, spend or "Claude Code"; the Archive tag until the agent starts, no switch said; installing the agent offered (K5.1, spec 017 e)', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null }, links: ALL,
            lastIntake: { id: 'I0041', at: new Date().toISOString() },
            waiting: [{ id: 'T0010', what: 'Confirm the father', person: 'P0012', at: new Date().toISOString() }],
            statusExtra: { agent: { id: 'claude', name: 'Claude Code' } } });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await poll(page);
        await openResearchMenu(page);
        const sub = page.locator('#research-menu');
        await expect(sub.locator('#research-item-chat')).toBeVisible();
        await expect(sub.locator('#research-item-waiting')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());

        // The agent is gone from this computer: the bridge says so (and sends no agent, queue or spend).
        bridge.accepts = WAITING;
        bridge.statusExtra = {};
        await poll(page);
        expect(await page.evaluate(() => window.Strom.UI.activeResearchArchive())).toBe(false);
        expect(await page.evaluate(() => window.Strom.UI.activeResearchNoAgent())).toBe(true);
        await openResearchMenu(page, { expandMore: true });
        await expect(sub).toBeVisible();
        for (const id of ['research-item-chat', 'research-item-live', 'research-item-waiting']) await expect(sub.locator(`#${id}`)).toHaveCount(0);
        await expect(sub.locator('#research-item-open')).toBeVisible();
        // Taking the last send back stays the user's.
        await expect(sub.locator('#research-item-undo')).toBeVisible();
        // Shown as an archive (the tag), not switched to one: no "switched" said; where to install the agent instead.
        await expect(sub.locator('#research-menu-archive')).toHaveCount(1);
        await expect(block(page)).not.toHaveAttribute('data-state', 'switched');
        await expect(sub.locator('#research-menu-foot')).toHaveAttribute('title', 'Continues in the research on this computer. The research waits for an AI agent: the first item of its menu installs one.');
        await expect(sub.locator('#research-menu-foot .research-menu-foot-text')).toHaveText('continues in the research');
        await expect(sub).not.toContainText(/Claude Code|USD|\$/);
        await expect(dot(page)).toBeHidden();
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());

        // The person menu: only what the research knows.
        const actions = await page.evaluate(() => {
            const jan = Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            return window.Strom.UI.getPersonMenuActions(jan.id).map((a: any) => [a.action, ...(a.submenu ?? []).map((x: any) => x.action)]).flat();
        });
        for (const a of ['research-review', 'research-ancestors', 'research-descendants', 'research-ask']) expect(actions).not.toContain(a);

        // Research for this tree: the Archive tag, a send written at once, the way to install the agent, Open the research.
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        const dialog = page.locator('#research-tree-settings-modal');
        await expect(dialog.locator('h2 .research-sync-tag')).toHaveCount(1);
        await expect(dialog).not.toContainText('has been a Strom archive since');
        await expect(dialog).not.toContainText('worked with an agent since');
        await expect(dialog).toContainText('The research writes every send straight away.');
        // Nobody to weigh transcriptions: the setting is not offered (as in an archive).
        await expect(dialog.locator('input[name="research-transcripts"]')).toHaveCount(0);
        await expect(dialog.locator('#research-older-sources')).toHaveCount(0);
        await expect(dialog).not.toContainText('My source transcriptions');
        await expect(dialog.locator('#research-mode-where')).toHaveText('The research waits for an AI agent. At the top of its menu: “Install or choose the AI agent”, or “Keep it only as a Strom archive”. Open the research, opens in the research');
        await dialog.locator('#research-mode-where-open').click();
        expect(await links(page)).toEqual([`strom-research://open?tree=${UUID}`]);

        // The agent installed: the research again, nothing switched, nothing to say.
        bridge.accepts = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
        await poll(page);
        await openResearchMenu(page);
        await expect(sub.locator('#research-item-chat')).toBeVisible();
        await expect(sub.locator('#research-menu-archive')).toHaveCount(0);
        await expect(block(page)).not.toHaveAttribute('data-state', 'switched');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // With its agent: the transcriptions setting is offered again.
        await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        await expect(dialog.locator('input[name="research-transcripts"]')).toHaveCount(2);
    });

    test('opened by ?live= while it waits for its agent: opens for editing, not followed', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        await fakeBridge(page, { accepts: WAITING });
        await page.evaluate((b) => window.Strom.UI.startLiveFollow(b), BRIDGE);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.id)).toBe(UUID);
        expect(await page.evaluate(() => window.Strom.UI.isFollowingActiveResearch())).toBe(false);
        expect(await page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(false);
        await expect(page.locator('.live-panel')).toHaveCount(0);
    });
});

test.describe('Research for this tree: sending changes', () => {
    test('two cards, the box by the research, the status line; switching is saved at once', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        // The dialog reads the state when it opens: wait for the write to be
        // taken in, not only sent (a loaded machine opened it in between).
        await expect.poll(() => page.evaluate(() =>
            !!JSON.parse(localStorage.getItem(`strom-research-auto:${window.Strom.TreeManager.getActiveTreeId()}`) ?? '{}').lastWritten)).toBe(true);
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
        await expect(page.locator('#research-tree-settings-modal')).toContainText('Changes are written in the research only after confirmation.');
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

// ==================== DATA PROTECTION AROUND THE RESEARCH (3.9) ====================

/** The tree's backups as stored: their reasons, newest first. */
const backupReasons = (page: Page) => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const req = indexedDB.open('strom-db');
    req.onsuccess = () => {
        const all = req.result.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
        all.onsuccess = () => resolve(all.result
            .filter((s: { meta?: unknown }) => s.meta)
            .map((s: { meta: { reason: string; createdAt: number } }) => s.meta)
            .sort((a: { createdAt: number }, b: { createdAt: number }) => b.createdAt - a.createdAt)
            .map((m: { reason: string }) => m.reason));
        all.onerror = () => reject(all.error);
    };
    req.onerror = () => reject(req.error);
}));

test.describe('data protection around the research', () => {
    test('a backup before the first send and before every load, whatever the backup setting; "Restore the state before loading" brings the tree back', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        await page.evaluate(() => window.Strom.TreeManager.setAutoBackups(window.Strom.TreeManager.getActiveTreeId()!, false));
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect.poll(() => backupReasons(page)).toContain('pre-first-send');
        // The research moves on with something of its own; the user loads it.
        bridge.head = 'fe11fe11fe11';
        bridge.treeGed = researchGed('fe11fe11fe11', ['1 BIRT', '2 PLAC Praha', '1 OCCU tesař']);
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'newer');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await acceptLoad(page);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('fe11fe11fe11');
        expect((await backupReasons(page))[0]).toBe('pre-research-load');
        const toast = page.locator('.toast', { hasText: 'Research version loaded.' });
        await expect(toast.getByRole('button', { name: 'Restore the state before loading' })).toBeVisible();
        // Still offered in Research while nothing was edited: the first hour as the block.
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'loaded');
        await expect(block(page)).toContainText('Research version loaded');
        await block(page).getByRole('menuitem', { name: 'Restore the state before loading' }).click();
        await expect(page.locator('.toast', { hasText: 'Restored to the state before loading.' }).getByRole('button', { name: 'Undo' })).toBeVisible();
        const occu = await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any).occupation ?? '');
        expect(occu).not.toBe('tesař');
        expect(await janPlace(page)).toBe('Praha');
        // V-B: built on the tie it had before the load — the research's version is newer again, the next copy
        // names that head and the copy since.
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(HEAD);
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'newer');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        const first = bridge.sends[bridge.sends.length - 1].intake;
        await editJan(page, 'Brno');
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(2);
        expect(bridge.posts[1]).toContain(`1 _STROM_HEAD ${HEAD}`);
        expect(bridge.posts[1]).toContain(`1 _STROM_SINCE ${first}`);
    });

    test('V-H: "Restore the state before loading" stands until the next edit: the block for an hour, then the menu row; gone after an edit', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        bridge.head = 'fe11fe11fe11';
        bridge.treeGed = researchGed('fe11fe11fe11', ['1 BIRT', '2 PLAC Praha', '1 OCCU tesař']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await acceptLoad(page);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('fe11fe11fe11');
        // After the hour: no block, the row with when it was loaded.
        await page.clock.fastForward(61 * 60_000);
        await openResearchMenu(page, { expandMore: true });
        await expect(block(page)).not.toHaveAttribute('data-state', 'loaded');
        await expect(page.locator('#research-item-restore')).toContainText('Restore the state before loading');
        await expect(page.locator('#research-item-restore')).toContainText('loaded');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // An edit: never offered again, not even when undone back to what was loaded.
        await editJan(page, 'Kolín');
        await page.evaluate(() => window.Strom.UI.performUndo());
        await openResearchMenu(page);
        await expect(page.locator('#research-item-restore')).toHaveCount(0);
        await expect(block(page)).not.toHaveAttribute('data-state', 'loaded');
    });

    test('V-A: back to the value the research had before a written send is a change to send (compared with the copy sent)', async ({ page }) => {
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        writesAtOnce(bridge);
        await poll(page);
        const baseFp = await page.evaluate(() => window.Strom.UI.researchSyncFingerprints(window.Strom.TreeManager.getActiveTreeId()!,
            window.Strom.TreeManager.getActiveTreeMetadata()!.research!).current);
        await editJan(page, 'Bergen');
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).toBe('written');
        // Back as the research's version loaded here had it.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { birthPlace: '' });
        });
        expect(await page.evaluate(() => window.Strom.UI.researchSyncFingerprints(window.Strom.TreeManager.getActiveTreeId()!,
            window.Strom.TreeManager.getActiveTreeMetadata()!.research!).current)).toBe(baseFp);
        await expect(page.locator('#research-sync-send')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(2);
        expect(bridge.posts[1]).not.toContain('2 PLAC Bergen');
    });

    test('"Only load from the research": nothing goes by itself or by hand, said with the way to change it; back to by hand, what piled up is told', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        await page.evaluate(() => window.Strom.UI.setResearchSendMode(window.Strom.TreeManager.getActiveTreeId()!, 'off'));
        await editJan(page);
        await page.clock.fastForward(QUIET * 2);
        expect(bridge.posts).toHaveLength(0);
        // No Send button, only the quiet mark saying so.
        await expect(page.locator('#research-sync-send')).toHaveCount(0);
        await expect(mark(page)).toHaveAttribute('title', 'Changes are not sent to the research');
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(page.locator('.toast', { hasText: 'not sent to the research' }).getByRole('button', { name: 'Change' })).toBeVisible();
        expect(bridge.posts).toHaveLength(0);
        await openResearchMenu(page);
        await expect(block(page)).toContainText('Changes are not sent to the research');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // Settings: three choices, by hand the recommended one, and the three sentences.
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        const dialog = page.locator('#research-tree-settings-modal');
        await expect(dialog.locator('input[name="research-send-mode"]')).toHaveCount(3);
        await expect(dialog.locator('input[value="off"]')).toBeChecked();
        await expect(dialog).toContainText('The tree in the app is the main one.');
        await dialog.locator('input[name="research-send-mode"][value="manual"]').check();
        // Said in the dialog itself (research-send-mode.spec.ts), no toast over it.
        await expect(dialog.locator('#research-send-piled')).toContainText('Changed since the last send: 1 person.');
        expect(bridge.posts).toHaveLength(0);
        await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());
        // Switched elsewhere (not from that dialog): the toast tells it.
        await page.evaluate(() => window.Strom.UI.setResearchSendMode(window.Strom.TreeManager.getActiveTreeId()!, 'off'));
        await page.evaluate(() => window.Strom.UI.setResearchSendMode(window.Strom.TreeManager.getActiveTreeId()!, 'manual'));
        await expect(page.locator('.toast', { hasText: 'Changed since then: 1 person' }).getByRole('button', { name: 'What will be sent' })).toBeVisible();
        expect(bridge.posts).toHaveLength(0);
    });

    test('a new tie sends by hand; a tie from before 3.9 (no choice stored) keeps sending by itself', async ({ page }) => {
        await openResearch(page, { auto: true });
        // (The helper stores "by itself" as a tie from before 3.9 would have it: no choice made.)
        await page.evaluate(() => window.Strom.TreeManager.patchResearchLink(window.Strom.TreeManager.getActiveTreeId()!, { sendMode: undefined }));
        await poll(page).catch(() => undefined);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sendMode)).toBeUndefined();
        // A new tie (another research id): by hand.
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            const link = tm.getActiveTreeMetadata().research;
            tm.setResearchLink(tm.getActiveTreeId()!, { id: '0b0b0b0b-1111-4222-8333-444455556666', fingerprint: link.fingerprint, syncedAt: link.syncedAt });
        });
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sendMode)).toBe('manual');
        // A new tie to an archive, or to a research waiting for its agent: by itself (audit 017 a-D5).
        const tie = (id: string, extra: Record<string, unknown>, opts: Record<string, unknown> = {}) => page.evaluate(({ id, extra, opts }) => {
            const tm = window.Strom.TreeManager;
            const link = tm.getActiveTreeMetadata().research;
            tm.setResearchLink(tm.getActiveTreeId()!, { id, fingerprint: link.fingerprint, syncedAt: link.syncedAt, ...extra }, opts);
            return tm.getActiveTreeMetadata()?.research?.sendMode;
        }, { id, extra, opts });
        expect(await tie('0c0c0c0c-1111-4222-8333-444455556666', { mode: 'archive' })).toBe('auto');
        expect(await tie('0d0d0d0d-1111-4222-8333-444455556666', {}, { agentless: true })).toBe('auto');
        // The tie again (the same research), its choice made by hand: kept, whatever the research is now.
        await page.evaluate(() => window.Strom.TreeManager.patchResearchLink(window.Strom.TreeManager.getActiveTreeId()!, { sendMode: 'manual' }));
        expect(await tie('0d0d0d0d-1111-4222-8333-444455556666', { mode: 'archive' }, { agentless: true })).toBe('manual');
    });

    test('"Written N, not written M · Show" when sending by itself too', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        bridge.syncReply = { status: 200, body: { ...WRITE.body, changes: 3, applied: 2,
            notWritten: [{ kind: 'event.edit', person: 'P0003', fact: 'OCCU', why: 'kept' }] } };
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(page.locator('.toast', { hasText: 'Written 2, not written 1.' }).getByRole('button', { name: 'Show' })).toBeVisible();
    });
});

test.describe('the one-time question: how should changes go', () => {
    const forget = (page: Page) => page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        // As a tree tied before 3.9: no choice stored, never asked.
        tm.patchResearchLink(id, { sendMode: undefined });
        const key = `strom-research-auto:${id}`;
        const st = JSON.parse(localStorage.getItem(key) ?? '{}');
        delete st.modeAsked;
        localStorage.setItem(key, JSON.stringify(st));
    });
    const ask = (page: Page) => page.locator('#research-mode-ask-modal');

    test('a tree tied before 3.9: asked once while its research runs, how it goes now checked; Keep stores it, never asked again', async ({ page }) => {
        await autoTree(page);
        await forget(page);
        await poll(page);
        await expect(ask(page)).toBeVisible();
        await expect(ask(page).locator('input[value="auto"]')).toBeChecked();
        // How it went so far is marked; Recommended stays on by hand.
        await expect(ask(page).locator('label:has(input[value="auto"])')).toContainText('(so far)');
        await expect(ask(page).locator('label:has(input[value="manual"])')).toContainText('Recommended');
        await expect(ask(page)).toContainText('choose how now');
        await expect(ask(page)).toContainText('Until answered, sending stays as it was.');
        await expect(ask(page)).toContainText('Whatever the research does not write always stays visible.');
        // One answer button: Keep while the choice is how it goes, Save otherwise.
        await ask(page).locator('input[value="off"]').check();
        await expect(ask(page).locator('#research-mode-ask-save')).toHaveText('Save');
        await ask(page).locator('input[value="auto"]').check();
        await expect(ask(page).locator('#research-mode-ask-save')).toHaveText('Keep');
        await ask(page).getByRole('button', { name: 'Keep' }).click();
        await expect(ask(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sendMode)).toBe('auto');
        await page.clock.fastForward(30_000);
        await poll(page);
        await expect(ask(page)).toHaveCount(0);
    });

    test('Save takes the choice (by hand); Escape and × leave it unanswered, asked again when the tree is opened again; never while the research is not running or a dialog is open', async ({ page }) => {
        const bridge = await autoTree(page);
        await forget(page);
        bridge.down = true;
        await poll(page);
        await expect(ask(page)).toHaveCount(0);
        bridge.down = false;
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        await poll(page);
        await expect(ask(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());
        await poll(page);
        await expect(ask(page)).toBeVisible();
        await ask(page).locator('input[value="manual"]').check();
        await ask(page).getByRole('button', { name: 'Save' }).click();
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sendMode)).toBe('manual');
        // Another time, Escape: how it goes stays.
        await forget(page);
        await page.evaluate(() => window.Strom.TreeManager.patchResearchLink(window.Strom.TreeManager.getActiveTreeId()!, { sendMode: 'off' }));
        await page.clock.fastForward(30_000);
        await poll(page);
        await expect(ask(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(ask(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sendMode)).toBe('off');
        // Not an answer: not asked again while the tree stays open, asked again when it is opened again.
        const asked = () => page.evaluate(() => JSON.parse(localStorage.getItem(`strom-research-auto:${window.Strom.TreeManager.getActiveTreeId()}`) ?? '{}').modeAsked ?? false);
        expect(await asked()).toBe(false);
        await page.clock.fastForward(30_000);
        await poll(page);
        await expect(ask(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.forgetResearchModeAskLater(window.Strom.TreeManager.getActiveTreeId()!));
        await page.clock.fastForward(30_000);
        await poll(page);
        await expect(ask(page)).toBeVisible();
        await ask(page).locator('#research-mode-ask-x').click();
        await expect(ask(page)).toHaveCount(0);
        expect(await asked()).toBe(false);
    });
});

test.describe('"What will be sent" before sending by hand', () => {
    const previewOn = (page: Page) => page.evaluate(() => {
        const key = `strom-research-auto:${window.Strom.TreeManager.getActiveTreeId()}`;
        const st = JSON.parse(localStorage.getItem(key) ?? '{}');
        delete st.skipPreview;
        localStorage.setItem(key, JSON.stringify(st));
    });
    const panel = (page: Page) => page.locator('#research-changes-panel');

    test('Send by hand shows who changed first; Send there sends; "Send without preview next time" sends at once after; the setting brings it back', async ({ page }) => {
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        writesAtOnce(bridge);
        await previewOn(page);
        await poll(page);
        await editJan(page);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(panel(page)).toBeVisible();
        await expect(panel(page)).toContainText('What will be sent');
        await expect(panel(page)).toContainText('Jan Fíšek');
        expect(bridge.posts).toHaveLength(0);
        // Close leaves it unsent; the state block offers the send (no "Send changes…" row beside it).
        await panel(page).getByRole('button', { name: 'Close' }).click();
        await expect(panel(page)).toHaveCount(0);
        await openResearchMenu(page);
        await expect(block(page).locator('[data-action="send"]')).toBeVisible();
        await expect(page.locator('#research-item-send')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(panel(page)).toBeVisible();
        await panel(page).getByText('Send without preview next time').click();
        await expect(panel(page).locator('#research-changes-skip')).toBeChecked();
        await panel(page).locator('[data-act="send"]').click();
        await expect.poll(() => bridge.posts.length).toBe(1);
        // Its answer taken first: "Send now" while a send is out does nothing (the post is counted when it goes).
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).toBe('written');
        // Next time at once (this tree).
        await editJan(page, 'Brno');
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(2);
        await expect(panel(page)).toHaveCount(0);
        // Nothing left to send (the block offers no send): the row is there, without dots.
        await openResearchMenu(page);
        await expect(block(page).locator('[data-action="send"]')).toHaveCount(0);
        await expect(page.locator('#research-item-send')).toHaveText('Send changes');
        await page.evaluate(() => window.Strom.UI.closeResearchMenu());
        // Research for this tree says so and brings the preview back.
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        const dialog = page.locator('#research-tree-settings-modal');
        await expect(dialog.locator('#research-send-preview-off')).toBeVisible();
        await expect(dialog.locator('#research-send-preview-off')).toContainText('Sending without preview');
        await dialog.locator('#research-send-preview-on').click();
        await expect(dialog.locator('#research-send-preview-off')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());
        await editJan(page, 'Kolín');
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(panel(page)).toBeVisible();
        expect(bridge.posts).toHaveLength(2);
    });

    test('A of rc.34: after "Restore the state before loading" an edit by hand still goes through the preview (the list cannot be told exactly: said so)', async ({ page }) => {
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        writesAtOnce(bridge);
        await previewOn(page);
        await poll(page);
        bridge.head = 'fe11fe11fe11';
        bridge.treeGed = researchGed('fe11fe11fe11', ['1 BIRT', '2 PLAC Praha', '1 OCCU tesař']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await acceptLoad(page);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('fe11fe11fe11');
        await page.evaluate(() => window.Strom.UI.researchRestoreBeforeLoad(window.Strom.TreeManager.getActiveTreeId()!));
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(HEAD);
        await editJan(page, 'Kolín');
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(panel(page)).toBeVisible();
        expect(bridge.posts).toHaveLength(0);
        await panel(page).locator('[data-act="send"]').click();
        await expect.poll(() => bridge.posts.length).toBe(1);
    });

    test('out of "only load" into "by itself" with changes made meanwhile: nothing goes by itself until the first send went through the list (always shown)', async ({ page }) => {
        const bridge = await autoTree(page);
        writesAtOnce(bridge);
        const id = await treeId(page);
        await page.evaluate((id) => window.Strom.UI.setResearchSendMode(id as never, 'off'), id);
        await editJan(page);
        await page.evaluate((id) => window.Strom.UI.setResearchSendMode(id as never, 'auto'), id);
        await page.clock.fastForward(QUIET * 2);
        expect(bridge.posts).toHaveLength(0);
        // Even with "without the list" chosen before: this first one shows it.
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(panel(page)).toBeVisible();
        await expect(panel(page).locator('#research-changes-skip')).toHaveCount(0);
        await panel(page).locator('[data-act="send"]').click();
        await expect.poll(() => bridge.posts.length).toBe(1);
        // Cleared once the research's answer is read, a moment after the bridge got the send.
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.previewDue)).toBeUndefined();
        // By itself again.
        await editJan(page, 'Brno');
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(2);
    });
});

test('R6 of the N1 round: after a send taken back, "What will be sent" lists what the research no longer has, not "cannot be told"', async ({ page }) => {
    await writtenThenUndone(page);
    await page.evaluate(() => window.Strom.UI.showResearchChanges('send'));
    const panel = page.locator('#research-changes-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Jan Fíšek');
    await expect(panel).not.toContainText('cannot be told');
});

test('R7 of the N1 round: a later send that leaves no conflict keeps "1 conflict to decide" while the earlier one is open there', async ({ page }) => {
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0043', conflicts: [{ id: 'X0002', fact: 'MARR' }] } };
    // A conflict that is no value of a person here (a family's, a source's): only the send's record tells it.
    bridge.onWrite = () => ({ head: 'd2d2d2d2d2d2', ged: researchGed('d2d2d2d2d2d2') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    // The research's record of that send: one conflict open.
    Object.assign(bridge.sends[0], { conflicts: 1 });
    await poll(page);
    await expect(pill(page)).toContainText('1 conflict to decide');
    // A later send with none.
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0044' } };
    bridge.onWrite = () => ({ head: 'd3d3d3d3d3d3', ged: researchGed('d3d3d3d3d3d3') });
    await renameJan(page, 'Jeník');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    await poll(page);
    await expect(pill(page)).toContainText('1 conflict to decide');
});

test('a write\'s conflicts loaded since: the research moving on (an update, its agent) never brings "Written, N conflicts" back', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0043', conflicts: [{ id: 'X0002', fact: 'MARR' }] } };
    bridge.onWrite = () => ({ head: 'd2d2d2d2d2d2', ged: researchGed('d2d2d2d2d2d2') });
    await renameJan(page, 'Jenda');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    // The research's record of that send: one conflict open (and it stays open there).
    Object.assign(bridge.sends[0], { conflicts: 1 });
    await poll(page);
    await expect(pill(page)).toContainText('1 conflict to decide');
    // Its version loaded: the write is in the tree now.
    await openResearchMenu(page);
    await block(page).getByRole('menuitem', { name: "Load the research's version" }).click();
    const ask = page.locator('.dialog-confirm', { hasText: 'Changed in the app' });
    await ask.getByRole('button', { name: 'Update' }).click();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('d2d2d2d2d2d2');
    await page.keyboard.press('Escape');
    // The research moves on (an update restarts its bridge, its agent works): the old write is not told again.
    await page.clock.fastForward(60_000);
    bridge.head = 'e3e3e3e3e3e3';
    bridge.treeGed = researchGed('e3e3e3e3e3e3');
    await poll(page);
    await expect(pill(page)).not.toContainText('conflict');
    await openResearchMenu(page);
    await expect(block(page)).not.toHaveAttribute('data-state', 'writtenConflicts');
    await expect(block(page)).not.toContainText('conflict');
});

test('B1 of beta.56: a send with a conflict taken back in the research (the conflict closed with it): no "1 conflict to decide" here any more', async ({ page }) => {
    const bridge = await conflictLeft(page);
    Object.assign(bridge.sends[0], { conflicts: 1 });
    // A later send of something else: written, the conflict still open there.
    bridge.syncReply = { status: 200, body: { ...WRITE.body, input: 'I0044' } };
    bridge.onWrite = () => ({ head: 'c2c2c2c2c2c2', ged: nameConflictGed('c2c2c2c2c2c2', ['1 BIRT', '2 PLAC Praha']) });
    await janBirthPlace(page, 'Praha');
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(2);
    await page.clock.fastForward(30_000);
    await poll(page);
    await expect(pill(page)).toContainText('1 conflict to decide');
    const jan = page.locator('.person-card', { hasText: 'Jenda' }).first();
    await expect(jan).toHaveAttribute('aria-label', /conflicting sources/);
    // `strom sync undo` of the first send: its conflict closed, its version without it.
    const first = bridge.sends.find(r => (r as unknown as { conflicts?: number }).conflicts === 1)!;
    Object.assign(first, { state: 'undone', conflicts: 0, decidedAt: new Date().toISOString() });
    bridge.head = 'c3c3c3c3c3c3';
    bridge.treeGed = researchGed('c3c3c3c3c3c3', ['1 BIRT', '2 PLAC Praha']);
    await page.clock.fastForward(30_000);
    await poll(page);
    await expect(pill(page)).toContainText('Send taken back');
    await expect(pill(page)).not.toContainText('conflict');
    await expect(jan).not.toHaveAttribute('aria-label', /conflicting sources/);
    await openResearchMenu(page);
    await expect(block(page)).not.toContainText('conflict');
});

test('R4 of the rc.49 round: the state of a send taken back never sends again — only its button does; the state opens the details', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await writtenThenUndone(page);
    // The text and the mark open ⋯ → Research; nothing is asked of the research.
    await pill(page).locator('.research-sync-pill-label').click();
    // N1 of the beta.70 round: the menu stays open (the toolbar's own click closed it again at once)
    await expect(page.locator('#research-menu')).toHaveClass(/\bactive\b/);
    await expect(block(page)).toBeVisible();
    await expect(block(page)).toContainText('was taken back in the research');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await pill(page).locator('.research-sync-pill-mark').click();
    // N1 of the beta.70 round: the menu stays open (the toolbar's own click closed it again at once)
    await expect(page.locator('#research-menu')).toHaveClass(/\bactive\b/);
    await expect(block(page)).toBeVisible();
    await expect(block(page)).toContainText('was taken back in the research');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // Narrower, the text hidden: what carries the state's name is not the button (the pill had it, Send again in its middle).
    await page.setViewportSize({ width: 1500, height: 900 });
    const named = page.getByTitle('Send taken back', { exact: true }).locator('visible=true');
    await expect(named).toHaveCount(1);
    await named.click();
    await page.clock.fastForward(1000);
    await poll(page);
    expect(bridge.againAsks ?? []).toEqual([]);
    await expect(pill(page)).toContainText('Send taken back');
    // N1 of the beta.70 round: the menu stays open (the toolbar's own click closed it again at once)
    await expect(page.locator('#research-menu')).toHaveClass(/\bactive\b/);
    await expect(block(page)).toBeVisible();
    await expect(block(page)).toContainText('was taken back in the research');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // The button does.
    await pill(page).getByRole('button', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toHaveLength(1);
});

test('R1 of the rc.49 round: a conflict the research still lists with later sends counts once ("1 conflict", not one per send)', async ({ page }) => {
    const bridge = await conflictLeft(page);
    Object.assign(bridge.sends[0], { conflicts: 1 });
    const later: [string, string, string][] = [['I0044', 'c2c2c2c2c2c2', 'Praha'], ['I0045', 'c3c3c3c3c3c3', 'Brno']];
    for (const [input, head, place] of later) {
        bridge.syncReply = { status: 200, body: { ...WRITE.body, input } };
        bridge.onWrite = () => ({ head, ged: nameConflictGed(head, ['1 BIRT', `2 PLAC ${place}`]) });
        const n = bridge.posts.length;
        await janBirthPlace(page, place);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(n + 1);
        // The research's record of each send names the same conflict, still open.
        Object.assign(bridge.sends[0], { conflicts: 1 });
    }
    await page.clock.fastForward(30_000);
    await poll(page);
    await expect(pill(page)).toContainText('Written, 1 conflict to decide');
    await openResearchMenu(page);
    await expect(block(page)).toContainText('Written, 1 conflict to decide');
    await expect(block(page)).not.toContainText('3 conflicts');
});

test('N38: a send the research took nothing from, the tree still apart from its version: never "In sync with the research" (by itself and by hand), Send goes again', async ({ page }) => {
    const bridge = await autoTree(page);
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 0, applied: 0, input: 'I0091' } };
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    // By itself: the mark says the research lacks the changes, and it does not send the same copy again.
    await expect(mark(page)).toHaveAttribute('aria-label', "Changes the research doesn't have");
    await openResearchMenu(page, { expandMore: true });
    await expect(block(page)).not.toContainText('In sync with the research');
    await expect(block(page)).toContainText('Not in the research yet');
    await expect(block(page)).toContainText('nothing new from the last send');
    // Send sends at once here: "What will be sent" is a row of "Other actions" (menu 1020 §2.2).
    await expect(page.locator('#research-menu-more #research-item-changes')).toBeVisible();
    await page.clock.fastForward(QUIET * 2);
    expect(bridge.posts).toHaveLength(1);
    // By hand: the Send button, not the quiet mark.
    await page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        tm.patchResearchLink(tm.getActiveTreeId()!, { sendMode: 'manual' });
        window.Strom.UI.refreshResearchSyncUi();
    });
    await expect(page.locator('#research-sync-send')).toBeVisible();
    // The research takes it now: in step again, written.
    writesAtOnce(bridge);
    await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
    await expect.poll(() => bridge.posts.length).toBe(2);
    await expect(page.locator('#research-sync-send')).toHaveCount(0);
    await openResearchMenu(page);
    await expect(block(page)).not.toContainText('Not in the research yet');
});

test.describe('the research not running, at rest (audit 017 a-D6)', () => {
    test('sent by hand: the quiet mark keeps the number of changes waiting in sight, its title says the research is not running', async ({ page }) => {
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        await poll(page);
        await editJan(page);
        await expect(page.locator('#research-sync-send')).toBeVisible();
        bridge.down = true;
        await poll(page);
        await expect(page.locator('#research-sync-send')).toHaveCount(0);
        await expect(mark(page)).toHaveAttribute('data-look', 'ghost');
        await expect(mark(page).locator('.research-sync-mark-count')).toHaveText('1');
        await expect(mark(page)).toHaveAttribute('title', "The research isn't running · 1 change waiting");
    });

    test('sent by itself, the browser started again with the research not running: never "will be sent at" — the changes wait, said with their number', async ({ page }) => {
        const bridge = await autoTree(page);
        await editJan(page);
        await expect(mark(page)).toHaveAttribute('title', /^Changes will be sent at \d{1,2}:\d{2}/);
        await page.evaluate(() => window.Strom.TreeManager.flush());
        bridge.down = true;
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        // Before the bridge answers (it is not confirmed yet), and after it did not: no time promised.
        await expect(mark(page)).not.toHaveAttribute('title', /will be sent/);
        await poll(page);
        await expect(mark(page)).toHaveAttribute('data-look', 'ghost');
        await expect(mark(page)).toHaveAttribute('title', "The research isn't running · 1 change waiting");
        await expect(mark(page).locator('.research-sync-mark-count')).toHaveText('1');
        await openResearchMenu(page);
        await expect(block(page)).not.toContainText(/sent at \d/);
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // Running again: the time it goes is said once more.
        bridge.down = false;
        await poll(page);
        await expect(mark(page)).toHaveAttribute('title', /^Changes will be sent at \d{1,2}:\d{2}/);
        await expect(mark(page).locator('.research-sync-mark-count')).toHaveCount(0);
    });
});

test.describe('the research not running, on tablet and phone (audit 017 a-D6)', () => {
    const moreCount = (page: Page) => page.locator('#bottom-bar-more-count');
    const moreDot = (page: Page) => page.locator('#bottom-bar-more-dot');
    for (const [name, size] of [['tablet', { width: 1024, height: 768 }], ['phone', { width: 390, height: 844 }], ['phone sideways', { width: 844, height: 390 }]] as const) {
        test(`${name}, sent by hand: the More tab carries the number of changes waiting, in place of its dot`, async ({ page }) => {
            await page.setViewportSize(size);
            await page.clock.install();
            await openResearch(page);
            const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
            await poll(page);
            await editJan(page);
            await expect(moreCount(page)).toBeHidden();
            bridge.down = true;
            await poll(page);
            await expect(moreCount(page)).toBeVisible();
            await expect(moreCount(page)).toHaveText('1');
            await expect(moreCount(page)).toHaveAttribute('title', "The research isn't running · 1 change waiting");
            await expect(moreDot(page)).toBeHidden();
            // Inside the tab, never over the tree or off the screen.
            const box = (await moreCount(page).boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(size.width);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
            bridge.down = false;
            await poll(page);
            await expect(moreCount(page)).toBeHidden();
        });
    }

    test('phone, sent by itself, started again with the research not running: the number is on the More tab', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const bridge = await autoTree(page);
        await editJan(page);
        await editJan(page, 'Brno');
        await page.evaluate(() => window.Strom.TreeManager.flush());
        bridge.down = true;
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await poll(page);
        await expect(moreCount(page)).toHaveText('1');
        await expect(moreDot(page)).toBeHidden();
        bridge.down = false;
        await poll(page);
        await expect(moreCount(page)).toBeHidden();
    });
});
