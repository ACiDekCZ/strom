import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';
import { block, fakeBridge, openResearch, openResearchMenu, poll, editJan } from './research-bridge.js';
import { setupConflict, editJosef, openKnows, cardOf, side } from './research-conflict.js';

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
function conflictReply(sent: boolean) {
    return {
        status: 200, body: {
            ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042',
            conflicts: [{
                id: 'X0007', person: 'P0003', fact: 'BIRT',
                ...(sent ? { sent: { user: { client: { id: OWN, name: 'Chrome · macOS' } }, research: { client: EDGE, input: 'I0041' } } } : {}),
            }],
        },
    };
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
            await page.keyboard.press('Escape');
        };
        await check();
        await openResearchMenu(page);
        await expect(block(page)).toContainText('edit from Edge · Windows × edit from this browser');
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
    });
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
