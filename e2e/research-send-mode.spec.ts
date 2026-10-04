import { test, expect, Page } from '@playwright/test';
import { editJan, fakeBridge, FakeBridge, openResearch, openResearchMenu, poll, researchGed, NEW_HEAD, HEAD } from './research-bridge.js';

/**
 * How changes go to the research, as one set of cards everywhere (the
 * hand-over, the one-time question, Research for this tree), the "trial" tag
 * with its note, and what "only load" leaves out (data protection, 3.9).
 */

const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };

async function manualTree(page: Page): Promise<FakeBridge> {
    await page.clock.install();
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: ACCEPTS });
    await poll(page);
    return bridge;
}

const treeId = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
const settings = (page: Page) => page.locator('#research-tree-settings-modal');
const note = (page: Page) => page.locator('#research-trial-note');
const TRIAL = 'The research is in trial operation. The app saves a backup before loading each of its versions. To be safe, export all trees now and then.';

/** The hand-over dialog for the open tree, as ?adopt= opens it (not answered here). */
async function openHandOver(page: Page): Promise<void> {
    await page.evaluate(() => {
        const ui = window.Strom.UI as unknown as { askResearchAdopt: (t: unknown, o: unknown, d: unknown) => Promise<unknown>; __adopt: unknown };
        const tm = window.Strom.TreeManager;
        void ui.askResearchAdopt(tm.getActiveTreeMetadata(), { name: 'Víškovi' }, window.Strom.DataManager.getData())
            .then(v => { ui.__adopt = v; });
    });
    await expect(page.locator('#research-adopt-modal')).toBeVisible();
}

test.describe('the "trial" tag', () => {
    test('beside the research group of ⋯ and in Research for this tree (with the sentence); its note opens by click and Enter, Esc and a click outside close it', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await manualTree(page);
        await openResearchMenu(page);
        const heading = page.locator('#actions-research-submenu .research-submenu-heading');
        await expect(heading).toContainText('Research');
        const menuTag = heading.locator('.research-trial-tag');
        await expect(menuTag).toHaveText('trial');
        await expect(menuTag).toHaveAttribute('aria-expanded', 'false');
        await menuTag.click();
        await expect(note(page)).toHaveText(TRIAL);
        await expect(menuTag).toHaveAttribute('aria-expanded', 'true');
        // A click in the note keeps the menu; no "More" link while there is no help page.
        await note(page).click();
        await expect(page.locator('#actions-research-submenu')).toBeVisible();
        await expect(note(page).locator('a, button')).toHaveCount(0);
        // Closing the menu closes the note.
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        await expect(note(page)).toHaveCount(0);

        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        await expect(settings(page).locator('.research-trial-sentence')).toHaveText(TRIAL);
        const tag = settings(page).locator('.research-trial-tag');
        await tag.focus();
        await page.keyboard.press('Enter');
        await expect(note(page)).toBeVisible();
        await expect(tag).toHaveAttribute('aria-expanded', 'true');
        // Esc closes only the note (the dialog stays), focus back on the tag.
        await page.keyboard.press('Escape');
        await expect(note(page)).toHaveCount(0);
        await expect(settings(page)).toBeVisible();
        await expect(tag).toBeFocused();
        await expect(tag).toHaveAttribute('aria-expanded', 'false');
        await tag.click();
        await expect(note(page)).toBeVisible();
        await settings(page).locator('.research-transcripts-title').first().click();
        await expect(note(page)).toHaveCount(0);
    });
});

test.describe('the hand-over', () => {
    for (const vp of [{ width: 1366, height: 768 }, { width: 500, height: 640 }]) {
        test(`Hand over stays in view at ${vp.width} × ${vp.height}; by hand chosen, Recommended; what goes over; the backup said`, async ({ page }) => {
            await page.setViewportSize(vp);
            await manualTree(page);
            await openHandOver(page);
            const dialog = page.locator('#research-adopt-modal');
            const confirm = dialog.locator('#research-adopt-confirm');
            await expect(confirm).toBeVisible();
            const bottom = await confirm.evaluate(el => el.getBoundingClientRect().bottom);
            expect(bottom).toBeLessThanOrEqual(vp.height);
            await expect(dialog.locator('input[value="manual"]')).toBeChecked();
            await expect(dialog.locator('label:has(input[value="manual"])')).toContainText('Recommended');
            await expect(dialog.locator('.research-send-principles.is-boxed')).toBeVisible();
            await expect(dialog).toContainText('Change it any time in the tree’s research settings.');
            await expect(dialog.locator('.research-trial-tag')).toBeVisible();
            if (vp.width >= 640) {
                await expect(dialog.locator('.research-adopt-tiles')).toBeVisible();
                await expect(dialog.locator('.research-adopt-counts-line')).toBeHidden();
                await expect(dialog.locator('.research-send-dialog-note')).toHaveText('A backup is saved before handing over.');
            } else {
                // Narrow: the counts as one line under the title, the backup under the sentences.
                await expect(dialog.locator('.research-adopt-tiles')).toBeHidden();
                await expect(dialog.locator('.research-adopt-counts-line')).toBeVisible();
                await expect(dialog.locator('.research-adopt-backup-narrow')).toBeVisible();
                await expect(dialog.locator('.research-send-dialog-note')).toBeHidden();
            }
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
        });
    }
});

test.describe('Research for this tree', () => {
    test('out of "only load" with an edit made meanwhile: what piled up is said there with "What will be sent" (no toast), nothing goes; the effect box only for by hand / by itself', async ({ page }) => {
        const bridge = await manualTree(page);
        const id = await treeId(page);
        await page.evaluate((id) => window.Strom.UI.setResearchSendMode(id as never, 'off'), id);
        await editJan(page);
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        await expect(settings(page).locator('#research-send-effect')).toBeHidden();
        await expect(settings(page).locator('#research-send-piled')).toBeHidden();
        await settings(page).locator('label:has(input[value="manual"])').click();
        const piled = settings(page).locator('#research-send-piled');
        await expect(piled).toContainText('Since the last send you changed 1 person.');
        await expect(settings(page).locator('#research-send-effect')).toBeVisible();
        await expect(page.locator('.toast', { hasText: 'Nothing goes until you send' })).toHaveCount(0);
        expect(bridge.posts).toHaveLength(0);
        // "What will be sent": the preview, without "Send without preview next time" (this first one always shows it).
        await piled.getByRole('button', { name: 'What will be sent' }).click();
        const panel = page.locator('#research-changes-panel');
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('Jan Víšek');
        await expect(panel.locator('#research-changes-skip')).toHaveCount(0);
        await panel.locator('[data-act="send"]').click();
        await expect.poll(() => bridge.posts.length).toBe(1);
    });

    test('out of "only load": ⋯ → Research says what piled up (neutral), "What will be sent" opens the preview; only load is a quiet line with Change', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const bridge = await manualTree(page);
        const id = await treeId(page);
        await page.evaluate((id) => window.Strom.UI.setResearchSendMode(id as never, 'off'), id);
        await openResearchMenu(page);
        const block = page.locator('#research-sync-block');
        await expect(block).toHaveAttribute('data-state', 'off');
        await expect(block).toContainText('Changes are not sent to the research');
        await expect(block.getByRole('button', { name: 'Change' })).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        await editJan(page);
        await page.evaluate((id) => window.Strom.UI.setResearchSendMode(id as never, 'manual'), id);
        await openResearchMenu(page);
        await expect(block).toHaveAttribute('data-state', 'piled');
        await expect(block).toHaveClass(/research-sync-block--neutral/);
        await expect(block).toContainText('Since the last send you changed 1 person.');
        await block.getByRole('button', { name: 'What will be sent' }).click();
        await expect(page.locator('#research-changes-panel')).toBeVisible();
        await expect(page.locator('#research-changes-skip')).toHaveCount(0);
        expect(bridge.posts).toHaveLength(0);
    });

    test('only load: no "Send changes" in ⋯ → Research', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await manualTree(page);
        await openResearchMenu(page);
        await expect(page.locator('#research-item-send')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        const id = await treeId(page);
        await page.evaluate((id) => window.Strom.UI.setResearchSendMode(id as never, 'off'), id);
        await openResearchMenu(page);
        await expect(page.locator('#actions-research-submenu')).toBeVisible();
        await expect(page.locator('#research-item-send')).toHaveCount(0);
    });
});

test.describe('V-I: changes not in the research while it has a newer version', () => {
    test('Send in the toolbar goes through "What will be sent" and loads nothing (loading only when asked)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.clock.install();
        await openResearch(page, { edit: true });
        await page.evaluate(() => {
            const key = `strom-research-auto:${window.Strom.TreeManager.getActiveTreeId()}`;
            const st = JSON.parse(localStorage.getItem(key) ?? '{}');
            delete st.skipPreview;
            localStorage.setItem(key, JSON.stringify(st));
        });
        const bridge = await fakeBridge(page, { accepts: ACCEPTS, head: NEW_HEAD, treeGed: researchGed(NEW_HEAD) });
        bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0050' } };
        bridge.onWrite = () => ({ head: 'ab12cd34ef56', ged: researchGed('ab12cd34ef56') });
        await poll(page);
        const pill = page.locator('#research-sync-pill');
        await expect(pill).toContainText('Changes not in the research');
        await pill.locator('[data-action="send"]').click();
        const panel = page.locator('#research-changes-panel');
        await expect(panel).toBeVisible();
        expect(bridge.posts).toHaveLength(0);
        await panel.locator('[data-act="send"]').click();
        await expect.poll(() => bridge.posts.length).toBe(1);
        await page.clock.fastForward(5000);
        // Not loaded: the tree still builds on the head it had; the newer version waits for "Load".
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(HEAD);
        await openResearchMenu(page);
        await expect(page.locator('#research-sync-block')).toHaveAttribute('data-state', 'newer');
        await expect(page.locator('#research-sync-block')).toContainText('A backup is saved before loading.');
    });
});
