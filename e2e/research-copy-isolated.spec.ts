import { test, expect, type Page } from '@playwright/test';
import { HEAD, editJan, fakeBridge, openResearch, poll, researchGed, links, openResearchMenu, block, type FakeBridge } from './research-bridge.js';
import { mergeCompare, mergeDone, mergeToStep5, mergeWrite } from './helpers.js';

/**
 * One research, one tree (spec 139 K5.1, K5.2): a copy of a research tree
 * (Duplicate, "Open as a new copy", a second import) is a tree without
 * research. It writes nothing to the research of the tree it came from — not
 * the first write with the app's files the original makes by itself, not an
 * edit sent by itself, not a send by hand, not a merge into it — and only the
 * owner is sent. An older copy still tied as `copy: true` is held the same
 * way. The bridge is answered by page.route (research-bridge.ts).
 */

/** A picture of Jan, a tiny JPEG (header only). */
const PORTRAIT = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/wAARCAHgAoADASIAAhEBAxEB/9k=';
const withPortrait = researchGed(HEAD, ['1 OBJE', '2 FORM jpeg', '2 TITL jan.jpg', `2 FILE ${PORTRAIT}`]);

/** A research tree sending by itself, its research keeping the app's own files (`media.app`): its first write went. */
async function researchTree(page: Page): Promise<{ bridge: FakeBridge; ownerId: string }> {
    await page.clock.install({ time: new Date('2026-11-17T10:30:00Z') });
    await openResearch(page, { auto: true, ged: withPortrait });
    const bridge = await fakeBridge(page, { features: ['media.app'], accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
    await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
    await poll(page);
    await expect.poll(() => bridge.posts.length).toBe(1);
    expect(bridge.postQueries?.[0].get('media')).toBe('app');
    const ownerId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    return { bridge, ownerId };
}

const switchTo = (page: Page, id: string) => page.evaluate((id) => window.Strom.UI.switchToTree(id), id);

/** Every way of sending, tried on the tree `id` (open): none of them may reach the bridge. */
async function trySendingEveryWay(page: Page, id: string): Promise<void> {
    await page.evaluate(async (id) => {
        const ui = window.Strom.UI as unknown as {
            researchSendNow(o?: { previewed?: boolean; treeId?: string }): Promise<void>;
            researchSendTree(id: string): Promise<void>;
            postResearchSend(id: string, o: { auto: boolean }): Promise<void>;
            sendTreeToResearch(id: string): Promise<void>;
        };
        await ui.researchSendNow();
        await ui.researchSendNow({ previewed: true });
        await ui.researchSendNow({ treeId: id });
        await ui.researchSendTree(id);
        await ui.postResearchSend(id, { auto: false });
        await ui.postResearchSend(id, { auto: true });
        await ui.sendTreeToResearch(id);
    }, id);
}

test('Duplicate of a research tree: the copy has no research, and nothing of it goes to the original\'s research — not the first write with its files, not an edit, not by hand', async ({ page }) => {
    const { bridge, ownerId } = await researchTree(page);
    const puts = bridge.mediaPuts.length;
    const copyId = await page.evaluate((id) => window.Strom.TreeManager.duplicateTree(id, 'Fíškovi – zkouška'), ownerId);
    const copy = await page.evaluate((id) => window.Strom.TreeManager.getTreeMetadata(id), copyId);
    expect(copy.research).toBeUndefined();
    expect(copy.copyOf).toEqual({ treeId: ownerId, name: 'Fíškovi' });

    // The copy open: the bridge's answers ask for no first write of its files, its edit goes nowhere.
    await switchTo(page, copyId);
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Fíškovi – zkouška');
    await poll(page);
    await page.clock.fastForward(5_000);
    await poll(page);
    await editJan(page, 'Brno');
    await page.clock.fastForward(150_000);
    await poll(page);
    await trySendingEveryWay(page, copyId);
    await page.clock.fastForward(5_000);
    expect(bridge.posts).toHaveLength(1);
    expect(bridge.mediaPuts.length).toBe(puts);
    expect(await links(page)).toEqual([]);
    // Nothing offers to send it: no research block in the Research menu.
    await openResearchMenu(page);
    await expect(block(page)).toBeHidden();
    await page.evaluate(() => window.Strom.UI.closeActionsMenu());

    // The original still sends, itself only.
    await switchTo(page, ownerId);
    await editJan(page, 'Kolín');
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.posts[1]).toContain(`_STROM_APP_TREE ${ownerId}`);
    expect(bridge.posts.join('\n')).not.toContain(copyId);
});

test('an older copy still tied as a copy (copy: true) sends nothing either, by itself or by hand', async ({ page }) => {
    const { bridge, ownerId } = await researchTree(page);
    const copyId = await page.evaluate((id) => {
        const tm = window.Strom.TreeManager;
        const copy = tm.duplicateTree(id, 'Fíškovi – stará kopie');
        // As a copy was made before: the research's tie kept, marked a copy, sending by itself.
        tm.setResearchLink(copy, { id: tm.getTreeMetadata(id)!.research!.id, fingerprint: '', syncedAt: new Date().toISOString(), copy: true, sendMode: 'auto' } as never);
        return copy;
    }, ownerId);
    await switchTo(page, copyId);
    await poll(page);
    await editJan(page, 'Brno');
    await page.clock.fastForward(150_000);
    await poll(page);
    await trySendingEveryWay(page, copyId);
    await page.clock.fastForward(5_000);
    expect(bridge.posts).toHaveLength(1);
    expect(await links(page)).toEqual([]);
    // Manage trees calls it a copy without research, never a research tree.
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const item = page.locator('.tree-manager-item', { hasText: 'Fíškovi – stará kopie' });
    await expect(item.locator('.tree-manager-item-origin')).toHaveAttribute('data-origin', 'copy');
    await expect(item.locator('.tree-manager-item-origin-text')).toHaveText('copy of the tree “Fíškovi” · no research');
});

test('a merge into a copy of a research tree says nothing about the research and sends nothing', async ({ page }) => {
    const { bridge, ownerId } = await researchTree(page);
    const copyId = await page.evaluate((id) => window.Strom.TreeManager.duplicateTree(id, 'Fíškovi – zkouška'), ownerId);
    await switchTo(page, copyId);
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await wizard.locator('.merge-s1-modes [data-mode="add"]').click();
    const target = wizard.locator('.merge-s1-target').filter({ has: page.locator('.merge-s1-tname', { hasText: /^Fíškovi – zkouška$/ }) });
    await expect(target).toContainText('copy of the tree “Fíškovi” · no research');
    await expect(target.locator('input')).toBeChecked();
    await expect(wizard.locator('.merge-s1-res-kept')).toHaveCount(0);
    await mergeCompare(wizard);
    await mergeToStep5(wizard);
    await expect(wizard.locator('.merge-s5-research')).toBeHidden();
    await mergeWrite(wizard, 'tree');
    await expect(wizard.locator('.merge-s6-research')).toBeHidden();
    await mergeDone(wizard);
    await poll(page);
    await page.clock.fastForward(150_000);
    await poll(page);
    expect(bridge.posts).toHaveLength(1);
    expect(await page.evaluate((id) => window.Strom.TreeManager.getTreeMetadata(id)?.research, copyId)).toBeUndefined();
});
