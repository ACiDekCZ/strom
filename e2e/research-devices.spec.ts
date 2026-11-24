import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';
import { block, fakeBridge, openResearch, openResearchMenu, poll, editJan } from './research-bridge.js';
import { setupConflict, editJosef, openKnows, cardOf, side, overflowing, conflictGed } from './research-conflict.js';
import type { FakeBridge } from './research-bridge.js';

/**
 * The devices of the research's sends (spec 094 K2.4): a conflict between two
 * sends named by the browser each edit came from (the card in "What the
 * research knows", the note after the write, the research menu), a line of
 * the research's history and a send taken back from another browser marked
 * "from …", and an older research that names no device read as before.
 * The bridge is answered by page.route. Invented data only.
 */

const OWN = 'own-browser-0001';
const EDGE = { id: 'edge-windows-77aa', name: 'Edge · Windows' };

/** This browser's id, known before anything is sent (as one made on first use). */
const ownDevice = (page: Page) => page.evaluate(id => localStorage.setItem('strom-device-id', id), OWN);

/** The answer to a send whose write left Jan's birth conflict (X0007), with the sends behind each side when said. */
function conflictReply(sent: boolean, other: { id: string; name: string } = EDGE) {
    return {
        status: 200, body: {
            ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042',
            conflicts: [{
                id: 'X0007', person: 'P0003', fact: 'BIRT',
                ...(sent ? { sent: { user: { client: { id: OWN, name: 'Chrome · macOS' } }, research: { client: other, input: 'I0041' } } } : {}),
            }],
        },
    };
}

/** The research moved on after the write (its head changed): the menu says the conflicts to decide. */
async function movedOn(page: Page, bridge: FakeBridge): Promise<void> {
    bridge.head = 'cccc2222dddd';
    bridge.treeGed = conflictGed({ head: 'cccc2222dddd' });
    await poll(page);
    await expect.poll(() => page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('writtenConflicts');
}

const said = (page: Page, text: string) => page.locator('.research-sync-note, .toast').filter({ hasText: text });

test.describe('a conflict between two sends', () => {
    test('named by device in the note, the card and the menu, also after a reload; the send carries this browser', async ({ page }) => {
        const { bridge } = await setupConflict(page);
        await ownDevice(page);
        bridge.syncReply = conflictReply(true);
        await editJosef(page);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(1);
        // The send says which browser it is (its id, its readable name under it).
        expect(bridge.posts[0]).toMatch(new RegExp(`\\n1 _STROM_CLIENT ${OWN}\\r?\\n2 NAME \\S`));
        await expect(said(page, 'Edit from Edge · Windows × edit from this browser.').first()).toBeVisible();

        const check = async () => {
            await openKnows(page);
            const c = cardOf(page);
            await expect(c.locator('.prc-side-label')).toHaveText(['Edit from this browser', 'Edit from Edge · Windows']);
            await expect(side(page, 'user').locator('.prc-choice')).toHaveText('Keep the edit from this browser');
            await expect(side(page, 'research').locator('.prc-choice')).toHaveText('Keep the edit from Edge · Windows');
            // The sentences under the choices speak of the two edits, not of the app's value and the research's.
            await expect(c.locator('#prc-note-X0007-user')).toHaveText('The research writes the edit from this browser; the edit from Edge · Windows stays in its history with the reason.');
            await expect(c.locator('#prc-note-X0007-research')).toHaveText(/^The value here changes to the edit from Edge · Windows\. /);
            await page.keyboard.press('Escape');
        };
        await check();
        await openResearchMenu(page);
        await expect(block(page)).toContainText('edit from Edge · Windows × edit from this browser');
        await page.keyboard.press('Escape');
        await movedOn(page, bridge);
        await openResearchMenu(page);
        await expect(block(page)).toContainText('The edit from this browser stays here; the research has the edit from Edge · Windows in that place until the conflict is decided.');
        await expect(block(page)).not.toContainText('The value from the app stays here');
        await page.keyboard.press('Escape');

        // Kept with the tree: the same after the page is opened again.
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await poll(page);
        await check();
    });

    test('an older research (no sends said): the card, the note and the history read as before', async ({ page }) => {
        const { bridge } = await setupConflict(page);
        await ownDevice(page);
        bridge.syncReply = conflictReply(false);
        await editJosef(page);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(said(page, '1 conflict to decide').first()).toBeVisible();
        await expect(said(page, 'Edit from')).toHaveCount(0);
        await openKnows(page);
        await expect(cardOf(page).locator('.prc-side-label')).toHaveText(['From the app', 'In the research']);
        await expect(side(page, 'user').locator('.prc-choice')).toHaveText('Keep the value from the app');
        await expect(cardOf(page).locator('#prc-note-X0007-user')).toHaveText("The research writes the value from the app; the record's value stays in its history with the reason.");
        await page.keyboard.press('Escape');
        await movedOn(page, bridge);
        await openResearchMenu(page);
        await expect(block(page)).toContainText('The value from the app stays here; the research keeps its own in that place until the conflict is decided.');
    });
});

/** A device's name as long as the research lets one be (60 graphemes). */
const LONG = { id: 'long-name-5511aa', name: 'Chrome · Pracovní notebook v kanceláři ve druhém patře budovy B'.slice(0, 60) };

test.describe('decided in a terminal: the two devices\' edits without choices', () => {
    for (const lang of ['en', 'de'] as const) {
        for (const [width, dark] of [[1440, false], [1440, true], [1024, false], [1024, true], [390, false], [390, true]] as const) {
            test(`${lang}, ${width}${dark ? ', dark' : ''}: a 60-character device's name over its value, nothing squeezed or past the edge`, async ({ page }) => {
                await page.setViewportSize({ width, height: width < 641 ? 844 : 900 });
                if (dark) await page.emulateMedia({ colorScheme: 'dark' });
                // A bridge that decides nothing and no conflict link: not on this device.
                const { bridge } = await setupConflict(page, { features: [], opened: { links: ['send', 'open', 'live', 'app', 'setup'] } });
                await ownDevice(page);
                bridge.syncReply = conflictReply(true, LONG);
                await editJosef(page);
                await page.evaluate(() => window.Strom.UI.researchSendNow());
                await expect.poll(() => bridge.posts.length).toBe(1);
                if (lang === 'de') await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
                await openKnows(page);
                const c = cardOf(page);
                await expect(c).toHaveAttribute('data-state', 'none');
                await expect(c.locator('.prc-choice')).toHaveCount(0);
                await expect(c.locator('.prc-side-label')).toHaveText(lang === 'en'
                    ? ['Edit from this browser', `Edit from ${LONG.name}`]
                    : ['Änderung von diesem Browser', `Änderung von ${LONG.name}`]);
                expect(await overflowing(c)).toEqual([]);
                for (const which of ['user', 'research'] as const) {
                    const s = side(page, which);
                    expect(await s.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
                    // The value on one line, never wrapped letter by letter beside a long label.
                    const lines = await s.locator('.prc-value').evaluate(el => {
                        const r = document.createRange();
                        r.selectNodeContents(el);
                        return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size;
                    });
                    expect(lines).toBe(1);
                    if (width === 390) {
                        // On a phone the device's name stands over its value.
                        const [label, value] = await Promise.all([s.locator('.prc-side-label').boundingBox(), s.locator('.prc-value').boundingBox()]);
                        expect(label!.y + label!.height).toBeLessThanOrEqual(value!.y + 0.5);
                    }
                }
            });
        }
    }
});

test.describe('sends and the history from two browsers', () => {
    test('a history line written by another browser\'s send says which one; this browser\'s and an older research\'s say nothing', async ({ page }) => {
        await openResearch(page);
        await ownDevice(page);
        const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
        await fakeBridge(page, {
            sends: [
                { intake: 'R3', at: at(2), state: 'written', changes: 1, tree: 'other-app-tree', sent: 'x', client: EDGE },
                { intake: 'R2', at: at(4), state: 'written', changes: 1, tree: 'own-app-tree', sent: 'y', client: { id: OWN, name: 'Chrome · macOS' } },
            ],
            log: [
                { head: 'h3', at: at(2), what: ['+P0004 Ludmila /Fíšková/'], task: '', via: EDGE },
                { head: 'h2', at: at(4), what: ['+P0005 Marie /Fíšková/'], task: '', via: { id: OWN, name: 'Chrome · macOS' } },
                { head: 'h1', at: at(6), what: ['+P0006 Karel /Fíšek/'], task: '' },
            ],
        });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        const ov = page.locator('#research-overview');
        // The lines of no task are one group, folded.
        await ov.getByText('Other changes', { exact: true }).click();
        const rows = ov.locator('li').filter({ hasText: /Ludmila|Marie|Karel/ });
        await expect(rows).toHaveCount(3);
        await expect(rows.filter({ hasText: 'Ludmila' }).locator('.research-change-via')).toHaveText('from Edge · Windows');
        await expect(rows.filter({ hasText: 'Marie' }).locator('.research-change-via')).toHaveCount(0);
        await expect(rows.filter({ hasText: 'Karel' }).locator('.research-change-via')).toHaveCount(0);
    });

    test('a send taken back that the research names as another browser\'s: told as before, with that browser', async ({ page }) => {
        await openResearch(page);
        await ownDevice(page);
        const bridge = await fakeBridge(page);
        await poll(page);
        await editJan(page);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.intake)).toBe(bridge.sends[0].intake);
        // This browser's own send: nothing about a device.
        expect(bridge.sends[0].client).toEqual(expect.objectContaining({ id: OWN }));
        // The research names another browser for it (e.g. this one's storage was cleared since).
        Object.assign(bridge.sends[0], { state: 'undone', decidedAt: new Date().toISOString(), client: EDGE });
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toContainText('was taken back in the research');
        await expect(block(page)).toContainText('Sent from Edge · Windows.');
    });
});
