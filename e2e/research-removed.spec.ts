import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';
import { UUID, block, dot, editJan, fakeBridge, links, openResearch, openResearchMenu, poll, researchGed, FakeBridge } from './research-bridge.js';

/**
 * A person removed by an earlier send of another window (Strom Research
 * `sync.removed`): a send that did not touch them is told so (`notWritten`,
 * `why: removed`), its version offered; one that edited them, or removed one
 * edited elsewhere, asks whether the person comes back or goes (a `PERSON`
 * conflict decided by a side through the research's `conflict` link) — one
 * question per person, until the research's status has it decided, then its
 * version loads. A research without the feature: as before.
 */

const ARCHIVE = { mode: 'archive', sync: { auto: 'mirror' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'conflict'];
const REMOVED = ['sync.removed'];

/** The research's version without Jan (removed there). */
function withoutJan(head: string): string {
    const lines = researchGed(head).split('\n');
    const at = lines.indexOf('0 @P0003@ INDI');
    const end = lines.findIndex((l, i) => i > at && l.startsWith('0 '));
    return [...lines.slice(0, at), ...lines.slice(end)].filter(l => l !== '1 CHIL @P0003@').join('\n');
}

/** An archive by hand (the send goes at once, no preview), its bridge running. */
async function archiveTree(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: ARCHIVE, links: LINKS, features: REMOVED, ...init });
    await poll(page);
    return bridge;
}

/** The research writes at once with this answer and makes `ged` its version. */
function writes(bridge: FakeBridge, body: Record<string, unknown>, ged: (head: string) => string = withoutJan): void {
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0074', ...body } };
    let n = 0;
    bridge.onWrite = () => {
        n++;
        const head = `d${n}d${n}d${n}d${n}d${n}d${n}`;
        return { head, ged: ged(head) };
    };
}

/** Sent by hand (not awaited: a question it asks holds the send until answered). */
const send = (page: Page) => { void page.evaluate(() => window.Strom.UI.researchSendNow()); };
const dialog = (page: Page) => page.locator('#confirmation-modal');
const deleteJan = (page: Page) => page.evaluate(() => {
    const dm = window.Strom.DataManager;
    dm.deletePerson((Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any).id);
});
const conflictLink = (id: string, take: string) => `strom-research://conflict?tree=${UUID}&id=${id}&do=decide&take=${take}`;
const head = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);

/**
 * The research decided it (its record lists no conflict open), its version `ged`: the next look loads it —
 * nothing unsent here, without asking (017 i).
 */
async function decidedThere(page: Page, bridge: FakeBridge, ged: (head: string) => string): Promise<void> {
    bridge.sends[0].conflicts = [];
    bridge.head = 'e5e5e5e5e5e5';
    bridge.treeGed = ged('e5e5e5e5e5e5');
    await poll(page);
}

test.describe('removed by an earlier send of another window', () => {
    test('not edited here: "removed by an earlier send from another window: not written", the research\'s version offered and loaded without the person', async ({ page }) => {
        const bridge = await archiveTree(page);
        writes(bridge, { applied: 0, notWritten: [{ kind: 'person.removed', person: 'P0003', why: 'removed', removedBy: 'I0042' }] });
        await editJan(page, 'Kolín');
        send(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(page.locator('.toast')).toContainText('Written 0, not written 1.');
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'notWritten');
        await expect(block(page).getByRole('menuitem', { name: "Load the research's version" })).toBeVisible();
        await block(page).getByRole('menuitem', { name: 'Show' }).click();
        const panel = page.locator('#research-changes-panel');
        const row = panel.locator('.research-changes-row.is-not-written');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('Jan Fíšek');
        await expect(row).toContainText('removed by an earlier send from another window: not written');
        await panel.locator('[data-act="loadNewer"]').click();
        await page.locator('.dialog-confirm', { hasText: 'Changed in the app' }).getByRole('button', { name: 'Update' }).click();
        await expect.poll(() => head(page)).toBe('d1d1d1d1d1d1');
        await expect(card(page, 'Jan')).toHaveCount(0);
    });

    test('a research without sync.removed: no reason of its own, nothing offered (as before)', async ({ page }) => {
        const bridge = await archiveTree(page, { features: [] });
        writes(bridge, { applied: 0, notWritten: [{ kind: 'person.removed', person: 'P0003', why: 'removed', removedBy: 'I0042' }] });
        await editJan(page, 'Kolín');
        send(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'notWritten');
        await expect(block(page).getByRole('menuitem', { name: "Load the research's version" })).toHaveCount(0);
        await block(page).getByRole('menuitem', { name: 'Show' }).click();
        const row = page.locator('#research-changes-panel .research-changes-row.is-not-written');
        await expect(row).toContainText('Jan Fíšek');
        await expect(row).not.toContainText('another window');
    });
});

test.describe('whether a person comes back or goes (PERSON)', () => {
    const BACK = { id: 'X0008', person: 'P0003', fact: 'PERSON', take: true,
        sides: { user: 'edited in the app since', research: 'removed by an earlier send (I0042)' } };

    test('removed in another window, edited here: one question (its fact conflict with it), Return to the tree takes the app\'s side; once decided there, its version loads', async ({ page }) => {
        const bridge = await archiveTree(page);
        writes(bridge, { conflicts: [{ id: 'X0007', person: 'P0003', fact: 'BIRT', take: true, sides: { user: 'Kolín', research: '' } }, BACK] });
        await editJan(page, 'Kolín');
        send(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        const d = dialog(page);
        await expect(d.locator('#confirm-title')).toHaveText('Removed in another window');
        await expect(d).toContainText('Jan Fíšek');
        await expect(d).toContainText('Removed from the tree in another window, edited here meanwhile. Return to the tree?');
        await expect(d).toContainText('From the app: edited in the app since');
        await expect(d).toContainText('In the research: removed by an earlier send (I0042)');
        await expect(d.locator('[data-choice]')).toHaveText(['Return to the tree ↗', 'Keep removed ↗']);
        await d.locator('[data-choice="user"]').click();
        expect(await links(page)).toEqual([conflictLink('X0008', 'user')]);
        // Never also told as a conflict among the others (nor its fact conflict).
        await expect(page.locator('.toast', { hasText: 'conflict' })).toHaveCount(0);
        await openResearchMenu(page);
        await expect(block(page)).toContainText('1 person to decide: in the tree or not.');
        await expect(block(page)).not.toContainText('conflict');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // Not decided there yet: nothing loads.
        await poll(page);
        expect(await head(page)).not.toBe('e5e5e5e5e5e5');
        // Decided there (Jan back in its version): the question ends, the version loads — nothing unsent
        // here, so nothing asked ("Load the research version?" never shows), the backup offered.
        await decidedThere(page, bridge, (h) => researchGed(h));
        await expect.poll(() => head(page)).toBe('e5e5e5e5e5e5');
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: 'Research version loaded.' })
            .getByRole('button', { name: 'Restore the state before loading' })).toBeVisible();
        await expect(card(page, 'Jan')).toBeVisible();
        await openResearchMenu(page);
        await expect(block(page)).not.toContainText('to decide: in the tree or not');
    });

    test('decided from here with changes made meanwhile that are not sent: asked as before, nothing loads unasked', async ({ page }) => {
        const bridge = await archiveTree(page);
        writes(bridge, { conflicts: [BACK] });
        await editJan(page, 'Kolín');
        send(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await dialog(page).locator('[data-choice="user"]').click();
        expect(await links(page)).toEqual([conflictLink('X0008', 'user')]);
        // Edited again here, not sent.
        await editJan(page, 'Brno');
        const before = await head(page);
        await decidedThere(page, bridge, (h) => researchGed(h));
        // The question ends; its version waits behind the question every load over unsent changes asks.
        await expect(dialog(page).locator('#confirm-title')).toHaveText("There are changes the research doesn't have");
        expect(await head(page)).toBe(before);
        await page.locator('#confirm-cancel-btn').click();
        expect(await head(page)).toBe(before);
        await openResearchMenu(page);
        await expect(block(page)).not.toContainText('to decide: in the tree or not');
    });

    test('Keep removed takes the research\'s side; asked again by the next send, still one question', async ({ page }) => {
        const bridge = await archiveTree(page);
        writes(bridge, { conflicts: [BACK] });
        await editJan(page, 'Kolín');
        send(page);
        await expect(dialog(page).locator('[data-choice]')).toHaveCount(2);
        // Later: the question waits in the state block, with the dot.
        await page.locator('#confirm-cancel-btn').click();
        await expect(dot(page)).toBeVisible();
        await editJan(page, 'Brno');
        send(page);
        await expect.poll(() => bridge.posts.length).toBe(2);
        await page.locator('#confirm-cancel-btn').click();
        await openResearchMenu(page);
        await expect(block(page)).toContainText('1 person to decide: in the tree or not.');
        await block(page).getByRole('menuitem', { name: 'Decide' }).click();
        await dialog(page).locator('[data-choice="research"]').click();
        expect(await links(page)).toEqual([conflictLink('X0008', 'research')]);
    });

    test('removed here, edited elsewhere (the person not in this copy): Remove from the tree, or Keep in the tree', async ({ page }) => {
        const bridge = await archiveTree(page);
        writes(bridge, { conflicts: [{ id: 'X0009', person: 'P0003', fact: 'PERSON', take: true,
            sides: { user: 'removed in the app', research: 'edited since in another copy' } }] }, (h) => researchGed(h));
        await deleteJan(page);
        send(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        const d = dialog(page);
        await expect(d.locator('#confirm-title')).toHaveText('Edited elsewhere');
        await expect(d).toContainText('Jan Fíšek');
        await expect(d).toContainText('Removed from the tree here, edited elsewhere meanwhile. Remove from the tree?');
        await expect(d.locator('[data-choice]')).toHaveText(['Remove from the tree ↗', 'Keep in the tree ↗']);
        await d.locator('[data-choice="research"]').click();
        await openResearchMenu(page);
        await block(page).getByRole('menuitem', { name: 'Decide' }).click();
        await dialog(page).locator('[data-choice="user"]').click();
        expect(await links(page)).toEqual([conflictLink('X0009', 'research'), conflictLink('X0009', 'user')]);
        // Decided there to keep him: his version brings him back.
        await decidedThere(page, bridge, (h) => researchGed(h));
        await expect.poll(() => head(page)).toBe('e5e5e5e5e5e5');
    });

    test('no conflict link here: the sides and where it is decided (strom → What waits), no choices', async ({ page }) => {
        const bridge = await archiveTree(page, { links: ['send', 'open', 'live', 'app', 'setup'] });
        writes(bridge, { conflicts: [BACK] });
        await editJan(page, 'Kolín');
        send(page);
        const d = dialog(page);
        await expect(d).toContainText('From the app: edited in the app since');
        await expect(d).toContainText('Decided in a terminal on the computer with the research: strom → What waits.');
        await expect(d.locator('[data-choice]')).toHaveCount(0);
        await expect(page.locator('#confirm-cancel-btn')).toHaveText('Close');
        await page.locator('#confirm-cancel-btn').click();
        expect(await links(page)).toEqual([]);
    });

    test('sent by itself: a toast that stays, Decide opens the question', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { auto: true });
        const bridge = await fakeBridge(page, { accepts: ARCHIVE, links: LINKS, features: REMOVED });
        await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
        await poll(page);
        writes(bridge, { conflicts: [BACK] });
        await editJan(page, 'Kolín');
        await page.clock.fastForward(121_000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        const toast = page.locator('.toast', { hasText: 'Jan Fíšek: removed in another window, edited here. Return to the tree?' });
        await toast.getByRole('button', { name: 'Decide' }).click();
        await expect(dialog(page).locator('#confirm-title')).toHaveText('Removed in another window');
    });

    test('a research without sync.removed: the PERSON conflict counted as any conflict, no question (as before)', async ({ page }) => {
        const bridge = await archiveTree(page, { features: [] });
        writes(bridge, { conflicts: [BACK] });
        await editJan(page, 'Kolín');
        send(page);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(page.locator('.toast', { hasText: '1 conflict' })).toBeVisible();
        await expect(dialog(page)).not.toBeVisible();
    });
});
