import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';
import {
    BRIDGE, FakeBridge, HEAD, NEW_HEAD, UUID, block, dot, dropFile, editJan, fakeBridge, links, openResearch, openResearchMenu, poll, researchGed,
} from './research-bridge.js';

/**
 * A research that tells what it has (Strom Research 1.12+: `accepts` and
 * `inbox` in its status): the state of the tree at the top of ⋯ → Research,
 * the dot on ⋯, sending straight to the bridge without the terminal, a send
 * refused or discarded there, "Send, then load", the update dialog over
 * changes the research does not have, Research for this tree and
 * "Transcription verified". The bridge is answered by page.route.
 */



test.describe('the state of the tree and sending straight', () => {
    test('changes the research lacks: the block and the dot; Send posts without a dialog; then sent and waiting, no dot', { tag: '@smoke' }, async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page);
        await poll(page);
        // Sent by hand: the toolbar's Send button, no dot on ⋯ where the button is.
        await expect(page.locator('#research-sync-send')).toBeVisible();
        await expect(dot(page)).toBeHidden();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'unsent');
        await expect(block(page)).toContainText("Changes the research doesn't have");
        await block(page).getByRole('button', { name: 'Send changes' }).click();
        await expect(page.locator('.toast')).toContainText('Sent to the research, 6 changes. Confirm them in the research.');
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
        expect(bridge.posts).toHaveLength(1);
        const ged = bridge.posts[0];
        const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
        expect(ged).toContain(`1 _STROM_TREE ${UUID}`);
        expect(ged).toContain(`1 _STROM_APP_TREE ${treeId}`);
        expect(ged).toMatch(/1 _STROM_SENT v2-[a-z0-9-]+/);
        expect(ged).not.toContain('_STROM_TRANSCRIPTS');   // lead: the research's default
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'sentPending');
        await expect(block(page)).toContainText('· 6 changes');
        await expect(block(page)).toContainText('Waiting for you to confirm them in the research.');
        await expect(dot(page)).toBeHidden();
        // Nothing claims it is stored in the research.
        await expect(page.locator('body')).not.toContainText('saved in the research');
    });

    test('nothing to send; in sync quietly, no dot', { tag: '@smoke' }, async ({ page }) => {
        await openResearch(page);
        const bridge = await fakeBridge(page);
        await poll(page);
        await expect(dot(page)).toBeHidden();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'inSync');
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(page.locator('.toast')).toContainText('Nothing to send. The research has the same tree.');
        expect(bridge.posts).toHaveLength(0);
    });

    test('refused: a dialog in the app\'s words, the technical reason as details; Try again sends again', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page, { syncReply: { status: 500, body: { error: 'výzkum úpravy nezapsal', reason: 'P0002 already has birth parents in F0001' } } });
        await poll(page);
        void page.evaluate(() => window.Strom.UI.researchSendNow());
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText("The research didn't accept the changes");
        await expect(dialog).toContainText('Details (to pass on): P0002 already has birth parents in F0001');
        await expect(dialog).not.toContainText('nezapsal');
        bridge.syncReply = { status: 200, body: { ok: true, changes: 6, inbox: true } };
        await dialog.getByRole('button', { name: 'Try again' }).click();
        await expect(page.locator('.toast')).toContainText('Sent to the research, 6 changes');
        expect(bridge.posts).toHaveLength(2);
    });

    test('written with a change skipped (1.12): said so in the app\'s words', async ({ page }) => {
        await openResearch(page, { edit: true });
        await fakeBridge(page, { syncReply: { status: 200, body: { ok: true, inbox: false, changes: 3, applied: 2,
            skipped: [{ n: 3, kind: 'family', why: 'P0002 already has birth parents in F0001' }] } } });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(page.locator('.toast')).toContainText('The research wrote the rest but skipped 1 change. Those changes stay only in the app.');
    });

    test('the bridge not running: the changes wait; Send takes the old way (the research starts it)', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page);
        await poll(page);          // learns `accepts`
        bridge.down = true;
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'unsentBridgeDown');
        await expect(block(page)).toContainText('Your changes will wait, nothing is lost.');
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        expect(bridge.posts).toHaveLength(0);
        expect(await links(page)).toContain(`strom-research://send?tree=${UUID}`);
    });

    test('discarded in the research: its own state and one notice (not again after a reload); Send again', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page, { lastIntake: { id: 'I0041', at: '2026-09-30T09:00:00Z' } });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(page.locator('.toast')).toContainText('Sent to the research');
        // The user discarded it in the research.
        bridge.inbox = [];
        Object.assign(bridge.sends[0], { state: 'discarded', decidedAt: new Date().toISOString(), reason: 'zkouška' });
        await poll(page);
        await expect(page.locator('.toast')).toContainText('was discarded in the research (zkouška)');
        await expect(dot(page)).toBeVisible();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'rejected');
        await expect(block(page)).not.toContainText('Sent ');

        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await poll(page);
        await page.waitForTimeout(300);
        await expect(page.locator('.toast', { hasText: 'discarded' })).toHaveCount(0);
        await openResearchMenu(page);
        await block(page).getByRole('button', { name: 'Send again' }).click();
        await expect(page.locator('.toast')).toContainText('Sent to the research');
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'sentPending');
    });

    test('a tree without a research, and a research that does not say what it takes: nothing new', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.toggleActionsMenu());
        await expect(page.locator('#actions-research-wrap')).toBeHidden();
        await expect(page.locator('#research-sync-pill')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());

        await openResearch(page, { edit: true, capable: false });
        let asked = 0;
        page.on('request', r => { if (r.url().startsWith(BRIDGE)) asked++; });
        await fakeBridge(page, { accepts: undefined });
        await poll(page);
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveCount(0);
        await expect(dot(page)).toBeHidden();
        await expect(page.locator('#research-item-tree-settings')).toHaveCount(0);
        // An older research is asked once per page whether it was updated, never more.
        expect(asked).toBeLessThanOrEqual(1);
    });
});

test.describe('after a send the research wrote', () => {
    test('the new version loads by itself (nothing here the research lacks), the view kept; the window coming back asks at once', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page);
        await poll(page);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(page.locator('.toast')).toContainText('Sent to the research');
        // Written in the research; no explicit ask from the test — the window coming back asks.
        bridge.inbox = [];
        Object.assign(bridge.sends[0], { state: 'written', decidedAt: new Date().toISOString() });
        bridge.lastIntake = { id: 'I0001', at: new Date(Date.now() + 1000).toISOString() };
        bridge.head = 'aa11bb22cc33';
        bridge.treeGed = researchGed('aa11bb22cc33').replace('1 NAME Jan /Víšek/', '1 NAME Jan /Víšek/\n1 BIRT\n2 PLAC Praha');
        await page.waitForTimeout(5100);   // past the "just asked" window
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('aa11bb22cc33');
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'written');
        await expect(dot(page)).toBeHidden();
    });

    test('the user\'s own images stay with their people and sources when the new version loads by itself; images of a person the research dropped are asked about', async ({ page }) => {
        await openResearch(page);
        const bridge = await fakeBridge(page);
        await poll(page);
        // A portrait and a crop the user cut, then the send the research wrote.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            const px = 'data:image/jpeg;base64,' + '/9j/'.padEnd(2400, 'A');
            dm.updatePerson(jan.id, { photo: px });
            const src = Object.values(dm.getData().sources).find((s: any) => s.refn === 'S0001') as any;
            dm.updateSource(src.id, { excerpts: [{ id: 'exc_user', dataUrl: px, width: 10, height: 10, sizeBytes: 1800 }] });
        });
        const kept = () => page.evaluate(() => {
            const d = window.Strom.DataManager.getData();
            return { photo: !!(Object.values(d.persons).find((p: any) => p.firstName === 'Jan') as any)?.photo,
                excerpts: (Object.values(d.sources).find((s: any) => s.refn === 'S0001') as any).excerpts?.length ?? 0 };
        });
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(page.locator('.toast')).toContainText('Sent to the research');
        bridge.inbox = [];
        Object.assign(bridge.sends[0], { state: 'written', decidedAt: new Date().toISOString() });
        bridge.head = 'aa11bb22cc33';
        bridge.treeGed = researchGed('aa11bb22cc33');
        await poll(page);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('aa11bb22cc33');
        expect(await kept()).toEqual({ photo: true, excerpts: 1 });
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);

        // The research no longer has Jan: his portrait has nowhere to go — never quietly, and the question says so.
        bridge.head = 'dd44ee55ff66';
        bridge.treeGed = researchGed('dd44ee55ff66')
            .replace(/0 @P0003@ INDI[\s\S]*?(?=0 @F0001@)/, '').replace('1 CHIL @P0003@\n', '');
        await poll(page);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('aa11bb22cc33');
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText('Images would be removed');
        await expect(dialog).toContainText('carry 1 image');
        await dialog.locator('#confirm-cancel-btn').click();
        expect(await kept()).toEqual({ photo: true, excerpts: 1 });
    });

    test('a tree handed over with the user\'s images (unchanged since): the update keeps them without asking', async ({ page }) => {
        await openResearch(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { photo: 'data:image/jpeg;base64,' + '/9j/'.padEnd(2400, 'A') });
        });
        // As after "Start research with this tree" (sent without images): the
        // research's version counts as this very tree, its images included.
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            const tree = tm.getActiveTreeId();
            const link = tm.getActiveTreeMetadata().research;
            const fp = (window.Strom.UI as any).researchSyncFingerprints(tree, { ...link, fingerprint: 'x' }).current;
            tm.setResearchLink(tree, { ...link, fingerprint: fp });
        });
        await dropFile(page, 'tree-strom.ged', researchGed(NEW_HEAD));
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(NEW_HEAD);
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
        expect(await page.evaluate(() => !!(Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any).photo)).toBe(true);
    });

    test('no strom-research:// links: the state, loading and Research for this tree are still there', async ({ page }) => {
        await openResearch(page);
        await page.evaluate(() => localStorage.removeItem('strom-research-links'));
        await fakeBridge(page, { links: [] });
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'inSync');
        await expect(page.locator('#research-item-version')).toBeVisible();
        await expect(page.locator('#research-item-tree-settings')).toBeVisible();
        await expect(page.locator('#research-item-open')).toHaveCount(0);   // opening the research needs its links
    });
});

test('a newer version: the block offers Load, the menu does not repeat it', async ({ page }) => {
    await openResearch(page);
    await fakeBridge(page, { head: NEW_HEAD, treeGed: researchGed(NEW_HEAD) });
    await poll(page);
    await openResearchMenu(page);
    await expect(block(page)).toHaveAttribute('data-state', 'newer');
    await expect(block(page).locator('[data-action="loadNewer"]')).toBeVisible();
    await expect(page.locator('#research-item-version')).toHaveCount(0);
});

test.describe('updating over changes the research does not have', () => {
    test('the pill; "Send, then load" waits for the research, then the new version loads by itself', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page, { head: NEW_HEAD, treeGed: researchGed(NEW_HEAD) });
        await poll(page);
        const pill = page.locator('#research-sync-pill');
        await expect(pill).toBeVisible();
        await expect(pill).toContainText('Changes not in the research');

        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText("You have changes the research doesn't have");
        await expect(dialog.locator('.confirm-aside-btn')).toHaveText('Load without changes');
        await dialog.getByRole('button', { name: 'Send, then load' }).click();
        await expect(page.locator('.toast')).toContainText('Sent to the research');
        await expect(pill).toContainText('Confirm the changes in the research, then the new version loads');

        // Written in the research: its record says so, the version holds the change.
        bridge.inbox = [];
        Object.assign(bridge.sends[0], { state: 'written', decidedAt: new Date().toISOString() });
        bridge.lastIntake = { id: 'I0042', at: new Date(Date.now() + 1000).toISOString() };
        bridge.head = 'aa11bb22cc33';
        bridge.treeGed = researchGed('aa11bb22cc33').replace('1 NAME Jan /Víšek/', '1 NAME Jan /Víšek/\n1 BIRT\n2 PLAC Praha');
        await poll(page);
        await expect(page.locator('.toast')).toContainText("Loaded the research's new version, made after it wrote your send.");
        // Sent by hand, nothing to send: only the Send button's empty place stays.
        await expect(pill).not.toHaveClass(/is-warn|is-wait/);
        await expect(pill.locator('#research-sync-send')).toHaveCount(0);
        const meta = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata());
        expect(meta.research.head).toBe('aa11bb22cc33');
    });

    test('another tree open: the research tree is switched to before the question; neither answer touches the other tree', async ({ page }) => {
        await openResearch(page, { edit: true });
        const researchTreeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
        const bridge = await fakeBridge(page, { head: NEW_HEAD, treeGed: researchGed(NEW_HEAD) });
        await poll(page);
        // The user's own tree is open (as when ?live= starts on the last active tree).
        const otherId = await page.evaluate(async () => {
            const id = await window.Strom.DataManager.importAsNewTree({ version: 11, persons: {}, partnerships: {} } as never, 'Konopáskovi');
            const dm = window.Strom.DataManager;
            dm.createPerson({ firstName: 'Václav', lastName: 'Konopásek', gender: 'male' } as never);
            return id;
        });
        await page.evaluate((id) => window.Strom.UI.switchToTree(id), otherId);
        const otherBefore = await page.evaluate((id) => window.Strom.TreeManager.getTreeData(id).then(d => JSON.stringify(d)), otherId);

        await page.evaluate((u) => { void window.Strom.UI.importResearchFromUrl(u); }, `${BRIDGE}/tree.ged`);
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText("You have changes the research doesn't have");
        // Behind the question: the research tree, not the user's other tree.
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).toBe(researchTreeId);
        await expect(card(page, 'Jan')).toBeVisible();

        // "Send, then load" sends the research tree.
        await dialog.getByRole('button', { name: 'Send, then load' }).click();
        await expect.poll(() => bridge.posts.length).toBe(1);
        expect(bridge.posts[0]).toContain(`1 _STROM_APP_TREE ${researchTreeId}`);
        expect(bridge.posts[0]).not.toContain('Konopásek');

        // "Load without changes" replaces the research tree only.
        await page.evaluate((id) => window.Strom.UI.switchToTree(id), otherId);
        await page.evaluate((u) => { void window.Strom.UI.importResearchFromUrl(u); }, `${BRIDGE}/tree.ged`);
        await expect(dialog).toContainText("You have changes the research doesn't have");
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).toBe(researchTreeId);
        await dialog.locator('.confirm-aside-btn').click();
        await expect(page.locator('.toast')).toContainText('Updated the research');
        const otherAfter = await page.evaluate((id) => window.Strom.TreeManager.getTreeData(id).then(d => JSON.stringify(d)), otherId);
        expect(otherAfter).toBe(otherBefore);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata().research.head)).toBe(NEW_HEAD);
    });

    test('the bridge not running: the copy is the advice, overwriting set apart', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page);
        await poll(page);
        bridge.down = true;
        await poll(page);
        await dropFile(page, 'tree-strom.ged', researchGed(NEW_HEAD));
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText("The research doesn't have these changes and the update will overwrite them");
        await expect(dialog.locator('#confirm-buttons > button.primary')).toHaveText('Open as copy');
        await expect(dialog.locator('.confirm-aside-btn')).toHaveText('Update and overwrite');
        await dialog.locator('#confirm-cancel-btn').click();
    });
});

test.describe('Research for this tree and "Transcription verified"', () => {
    test('lead / evidence: saved at once, not retroactive, older sources linked; the send says evidence', async ({ page }) => {
        await openResearch(page);
        const bridge = await fakeBridge(page);
        await poll(page);
        // A source of the user's, sent before the switch.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            const src = dm.addSource({ title: 'Křestní matrika Čáslav', reference: 'fol. 112', transcript: 'Jan, syn Josefa Víška' });
            dm.updatePerson(jan.id, { birthSourceIds: [src.id] });
        });
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(page.locator('.toast')).toContainText('Sent to the research');

        await openResearchMenu(page);
        await page.locator('#research-item-tree-settings').click();
        const modal = page.locator('#research-tree-settings-modal');
        await expect(modal).toContainText('My source transcriptions');
        await expect(modal).toContainText('Applies to sources added or changed from the next send');
        await expect(modal.locator('#research-older-sources')).toBeHidden();
        await modal.locator('input[value="evidence"]').check();
        await expect(modal.locator('#research-older-sources')).toHaveText('Older sources with a transcription (1) ›');
        const link = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata().research);
        expect(link.transcripts).toBe('evidence');
        await modal.locator('#research-older-sources').click();
        await expect(page.locator('#sources-modal')).toHaveClass(/active/);
        await expect(page.locator('#sources-filter .segment-btn.active')).toHaveText('Transcription not verified');
        await expect(page.locator('#sources-list .source-title')).toHaveText(['Křestní matrika Čáslav']);
        await page.evaluate(() => window.Strom.UI.closeSourcesDialog());

        await editJan(page);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(2);
        expect(bridge.posts[1]).toContain('1 _STROM_TRANSCRIPTS evidence');
    });

    test('from the tree manager too', async ({ page }) => {
        await openResearch(page);
        await fakeBridge(page);
        await poll(page);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        await page.locator('.tree-manager-item.active .tree-row-menu-btn').click();
        await page.locator('.tree-row-menu', { hasText: 'Research…' }).getByText('Research…').click();
        await expect(page.locator('#research-tree-settings-modal')).toContainText('Research for this tree');
    });

    test('the checkbox under the transcript: ticked and sent; emptying the transcript unticks; the research\'s reading has none, a change shows the note', async ({ page }) => {
        await openResearch(page);
        const bridge = await fakeBridge(page);
        await poll(page);
        const id = await page.evaluate(() => window.Strom.DataManager.addSource({ title: 'Křestní matrika Čáslav', transcript: 'Jan, syn Josefa' }).id);
        await page.evaluate((id) => window.Strom.UI.showEditSourceModal(id), id);
        const row = page.locator('#source-verified-row');
        await expect(row).toBeVisible();
        await expect(row).toContainText('I read it from the record. The research will take it as the first reading.');
        await page.locator('#input-source-verified').check();
        await page.locator('#input-source-transcript').fill('');
        await expect(row).toBeHidden();
        await page.locator('#input-source-transcript').fill('Jan, syn Josefa Víška');
        await expect(page.locator('#input-source-verified')).not.toBeChecked();
        await page.locator('#input-source-verified').check();
        await page.locator('#source-editor-modal .primary', { hasText: 'Save' }).click();
        expect(await page.evaluate((id) => window.Strom.DataManager.getData().sources[id].transcriptVerified, id)).toBe(true);
        await editJan(page);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(1);
        expect(bridge.posts[0]).toMatch(/1 TEXT Jan, syn Josefa Víška\r?\n1 _STROM_VERIFIED Y/);

        // The research's own source (read by it): no checkbox; the first change says what it becomes there.
        const researchSource = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources).find((s: any) => s.refn === 'S0001') as any);
        expect(researchSource.readBy).toBe('research');
        await page.evaluate((id) => window.Strom.UI.showEditSourceModal(id), researchSource.id);
        await expect(page.locator('#source-verified-row')).toBeHidden();
        await expect(page.locator('#source-user-reading-note')).toBeHidden();
        await page.locator('#input-source-reference').fill('fol. 42');
        await expect(page.locator('#source-user-reading-note')).toContainText('The research read this transcription');
        await expect(page.locator('#source-verified-row')).toBeHidden();
        await page.locator('#input-source-reference').fill('fol. 41');
        await expect(page.locator('#source-user-reading-note')).toBeVisible();   // stays until the editor closes
    });

    test('who read it: one quiet line in the source viewer', async ({ page }) => {
        await openResearch(page);
        const id = await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().sources).find((s: any) => s.refn === 'S0001') as any).id);
        await page.evaluate((id) => window.Strom.UI.showSourceViewer(id, null), id);
        await expect(page.locator('.viewer-read-by')).toHaveText('Transcription read by the research');
    });
});
