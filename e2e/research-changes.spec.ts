import { test, expect } from '@playwright/test';
import { fakeBridge, openResearch, openResearchMenu, poll, block, editJan, researchGed, NEW_HEAD } from './research-bridge.js';

/**
 * Changes per person (A2): what the user changed since the research's
 * version, person by person — "What will be sent" (the split Send button, the
 * block's link), "What was written" after the send, and the names in the
 * dialog that would load over them. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };

test.describe('changes per person', () => {
    test.use({ viewport: DESKTOP });

    test('what will be sent: the split button and the block say who changed; what was written after the send', { tag: '@smoke' }, async ({ page }) => {
        await openResearch(page);
        const b = await fakeBridge(page, { syncReply: { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042' } } });
        await poll(page);
        await editJan(page, 'Kolín');
        await page.evaluate(() => window.Strom.UI.refreshResearchSyncUi());

        // The toolbar: "Send | 1 ⌄"; the second part opens the panel.
        const more = page.locator('#research-sync-send-more');
        await expect(more).toHaveText(/1/);
        await expect(more).toHaveAttribute('aria-label', 'Show what will be sent (1 person)');
        await more.click();
        const panel = page.locator('#research-changes-panel');
        await expect(panel.locator('.research-changes-title')).toHaveText('What will be sent');
        await expect(panel.locator('.research-changes-row')).toHaveCount(1);
        await expect(panel.locator('.research-changes-name')).toHaveText('Jan Víšek');
        await expect(panel.locator('.research-changes-kinds')).toHaveText('birth');
        // Esc closes it.
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);

        // The block in ⋯ → Research: how many people, and the same panel.
        await openResearchMenu(page);
        await expect(block(page)).toContainText('1 person changed');
        await block(page).getByRole('button', { name: 'What will be sent ›' }).click();
        await expect(panel).toBeVisible();
        // A name selects the person and closes the panel.
        await panel.locator('.research-changes-name').click();
        await expect(panel).toHaveCount(0);

        // Sent and written: "What was written ›" lists the same person, ticked.
        await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
        await expect.poll(() => b.posts.length).toBe(1);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'written');
        await block(page).getByRole('button', { name: 'What was written ›' }).click();
        await expect(panel.locator('.research-changes-title')).toContainText('Written');
        await expect(panel.locator('.research-changes-name')).toHaveText('Jan Víšek');
        await expect(panel.locator('.research-changes-icon')).toHaveText('✓');
        // Nothing left to send: no split part.
        await page.keyboard.press('Escape');
        await expect(more).toHaveCount(0);
    });

    test('a new version over unsent changes names the people it would overwrite', async ({ page }) => {
        await openResearch(page, { edit: true });
        await fakeBridge(page, { head: NEW_HEAD, treeGed: researchGed(NEW_HEAD) });
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText("The research doesn't have these changes yet. Loading without sending would overwrite them:");
        await expect(dialog).toContainText('• Jan Víšek (birth)');
    });

    test('a tree in step with the research: nothing to tell, no split part', async ({ page }) => {
        await openResearch(page);
        await fakeBridge(page);
        await poll(page);
        await expect(page.locator('#research-sync-send-more')).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.UI.researchChangesNow())).toEqual([]);
    });
});
