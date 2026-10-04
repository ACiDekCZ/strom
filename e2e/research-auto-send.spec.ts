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
        // The bridge's sentence (the research's language) is not put into this app's sentence.
        await expect(page.locator('.toast')).toContainText('Automatic sending stopped. The research didn\'t accept the changes.');
        await expect(page.locator('.toast')).not.toContainText('zamčeno');
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

test('a window narrower than the toolbar\'s mark (1100 px): a new conflict is told by a toast with the person', async ({ page }) => {
    const bridge = await autoTree(page);
    await page.setViewportSize({ width: 1100, height: 900 });
    writesAtOnce(bridge);
    bridge.syncReply = { status: 200, body: { ...WRITE.body, conflicts: [{ id: 'X0003', person: 'P0003', fact: 'BIRT' }] } };
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => bridge.posts.length).toBe(1);
    const toast = page.locator('.toast', { hasText: 'Written, 1 conflict to decide' });
    await expect(toast.getByRole('button', { name: 'Jan Víšek' })).toBeVisible();
});

test('waiting for the quiet time: the mark and the block say when the changes go', async ({ page }) => {
    await autoTree(page);
    await editJan(page);
    await expect(mark(page)).toHaveAttribute('title', /^Your changes will be sent at \d{1,2}:\d{2}/);
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'autoWaiting');
    await expect(block(page)).toContainText(/sent at \d{1,2}:\d{2}/);
    await expect(block(page).getByRole('button', { name: 'Send now' })).toBeVisible();
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

/** A send written at once, then taken back in the research (`strom sync undo`): the app told so. */
async function writtenThenUndone(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    const bridge = await autoTree(page, init);
    writesAtOnce(bridge);
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('ab10cd10ef10');
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
    await block(page).getByRole('button', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toEqual([first]);
    expect(bridge.posts).toHaveLength(1);
    await expect(pill(page)).not.toContainText('Send taken back');
    // Written again: its version (with the changes) loaded quietly, nothing taken back any more.
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(bridge.head);
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).not.toBe('undone');
    expect(await janPlace(page)).toBe('Praha');
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
    await block(page).getByRole('button', { name: "Load the research's version" }).click();
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
    (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.lastName === 'Víšek' && p.firstName !== 'Josef') as any).firstName);
const janBirthPlace = (page: Page, place: string) => page.evaluate((place) => {
    const dm = window.Strom.DataManager;
    const jan = Object.values(dm.getData().persons).find((p: any) => p.lastName === 'Víšek' && p.firstName !== 'Josef') as any;
    dm.updatePerson(jan.id, { birthPlace: place });
}, place);
const janWhere = (page: Page) => page.evaluate(() =>
    (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.lastName === 'Víšek' && p.firstName !== 'Josef') as any).birthPlace ?? '');
const renameJan = (page: Page, first: string) => page.evaluate((first) => {
    const dm = window.Strom.DataManager;
    const jan = Object.values(dm.getData().persons).find((p: any) => p.lastName === 'Víšek' && p.firstName !== 'Josef') as any;
    dm.updatePerson(jan.id, { firstName: first });
}, first);
/** The research's version: its own name for Jan, the conflict about it still open, the user's birth place written. */
const nameConflictGed = (head: string, birth: string[] = []) => researchGed(head, [...birth,
    '1 _STROM_CONFLICT X0001', '2 TYPE NAME', '2 STAT open', '2 VAL Jan /Víšek/', '2 VAL Jenda /Víšek/']);

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
    await expect(block(page)).toContainText('Your value stays here');
    await block(page).getByRole('button', { name: "Load the research's version" }).click();
    await expect(page.locator('.dialog-confirm', { hasText: 'Changed in the app' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await janFirst(page)).toBe('Jenda');
});

test('findings 38/39: a copy carrying a send taken back, the next send written with a conflict: the conflict told and kept, the bar names the send taken back at its own time', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await autoTree(page);
    writesAtOnce(bridge);
    await editJan(page);
    await page.clock.fastForward(QUIET + 1000);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('ab10cd10ef10');
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
    await expect(block(page).getByRole('button', { name: 'Send again' })).toBeVisible();
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
    await expect(block(page)).toContainText('Nothing more is sent by itself until you choose');
    // Leaving the tree does not send it either.
    await page.evaluate(() => window.Strom.UI.researchAutoLeave());
    expect(bridge.posts).toHaveLength(1);
    // A plain Send (the menu, the toolbar) neither: the user is asked to decide; nothing goes, nothing written again.
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect(page.locator('.toast', { hasText: 'First choose: Send again' })).toBeVisible();
    expect(bridge.posts).toHaveLength(1);
    expect(bridge.againAsks ?? []).toEqual([]);
    // The user's choice: written again from what the research kept; the rename goes after it.
    await block(page).getByRole('button', { name: 'Send again' }).click();
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
    await block(page).getByRole('button', { name: 'Send again' }).click();
    await expect.poll(() => bridge.againAsks ?? []).toEqual([first]);
    expect(await janFirst(page)).toBe('Jenda');
});

test('finding 40: a conflict the next rename updates shows its new value in What the research knows, and stays on the toolbar after an unrelated send', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bridge = await autoTree(page);
    const conflictGed = (head: string, user: string, birth: string[] = []) => researchGed(head, [...birth,
        '1 _STROM_CONFLICT X0001', '2 TYPE NAME', '2 STAT open', '2 VAL Jan /Víšek/', `2 VAL ${user} /Víšek/`]);
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
        .toContain('Jendula /Víšek/');
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
    const sub = page.locator('#actions-research-submenu');
    await expect(sub.locator('#research-item-waiting')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());
    bridge.down = true;
    await page.clock.fastForward(21_000);
    await expect.poll(() => page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('bridgeDown');
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'bridgeDown');
    await expect(sub.locator('#research-item-waiting')).toHaveCount(0);
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());
    // Back: the tasks again.
    bridge.down = false;
    await poll(page);
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
    await expect(page.locator('.dialog-confirm')).toContainText('A conflict is still open in the research about Jenda Víšek');
    await page.keyboard.press('Escape');
    expect(await janFirst(page)).toBe('Jenda');
    // The research stops: said beside the conflict.
    bridge.down = true;
    await page.clock.fastForward(21_000);
    await expect(pill(page)).toContainText("The research isn't running");
    await openResearchMenu(page);
    await expect(block(page)).toContainText("The research isn't running");
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
        // In step with a running bridge: no "Load new version" row (the block offers one when there is).
        await expect(sub.locator('#research-item-version')).toHaveCount(0);
        await expect(sub.locator('#research-item-open')).toBeVisible();
        await expect(sub.locator('#research-item-tree-settings')).toBeVisible();
        for (const id of ['research-item-chat', 'research-item-live', 'research-item-send']) {
            await expect(sub.locator(`#${id}`)).toHaveCount(0);
        }
        // Taking the last send back stays the user's in an archive.
        await expect(sub.locator('#research-item-undo')).toBeVisible();
        await expect(block(page).locator('.research-sync-tag')).toHaveText('Archive');
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
        await openResearchMenu(page);
        const sub = page.locator('#actions-research-submenu');
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
        const sub = page.locator('#actions-research-submenu');
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
        await expect(block(page)).toContainText('The research is now an archive.');
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
        // An archive takes transcripts as leads: no setting for them (it waits for a switch to research).
        await expect(dialog.locator('input[name="research-transcripts"]')).toHaveCount(0);
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
