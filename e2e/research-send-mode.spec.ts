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
        await expect(settings(page).locator('.research-originals-toggle')).toBeHidden();
        await settings(page).locator('label:has(input[value="manual"])').click();
        const piled = settings(page).locator('#research-send-piled');
        await expect(piled).toContainText('Changed since the last send: 1 person.');
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
        await expect(block).toContainText('Changed since the last send: 1 person.');
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

test.describe('"Export all" now and then (only with a research)', () => {
    const reminder = (page: Page) => page.locator('#research-export-reminder');

    test('Backups say when all trees were last exported, with Export all; ⋯ → Research reminds at most three times, then rests three weeks', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await manualTree(page);
        await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
        const box = page.locator('#snapshots-export');
        await expect(box).toContainText('Not all trees have been exported yet');
        await expect(box.getByRole('button', { name: 'Export all' })).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());
        // Never exported: the last row of the research menu, shown three times.
        for (let i = 0; i < 3; i++) {
            await openResearchMenu(page);
            await expect(reminder(page)).toContainText('Not all trees have been exported yet');
            await page.evaluate(() => window.Strom.UI.closeActionsMenu());
            await page.clock.fastForward(61_000);
        }
        await openResearchMenu(page);
        await expect(reminder(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // Three weeks later it is back; Export all from it opens the dialog and it rests again.
        await page.clock.fastForward(22 * 24 * 3600_000);
        await openResearchMenu(page);
        await reminder(page).getByRole('menuitem', { name: 'Export all' }).click();
        await expect(page.locator('#export-all-modal')).toHaveClass(/active/);
        await page.evaluate(() => window.Strom.UI.closeExportAllDialog());
        await openResearchMenu(page);
        await expect(reminder(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // A full "Export all": the date in Backups, no reminder for three weeks.
        await page.evaluate(() => window.Strom.UI.downloadAllTreesJson(null, false, 'full', true));
        await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
        await expect(box).toContainText('Last export of all trees:');
        await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());
    });

    test('a browser without a research tree: no reminder in Backups', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { bridge: false });
        await page.evaluate(async () => {
            const tm = window.Strom.TreeManager;
            await window.Strom.DataManager.importAsNewTree({ version: 11, persons: {}, partnerships: {} } as never, 'Konopáskovi');
            for (const t of tm.getTrees()) if (t.research) await tm.deleteTree(t.id);
        });
        await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
        await expect(page.locator('#snapshots-export')).toBeHidden();
    });
});

test('D of rc.34: switching to a tree without a research shows no state of the last one (at once)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await manualTree(page);
    await editJan(page);
    await page.clock.fastForward(2000);
    const pill = page.locator('#research-sync-pill');
    await expect(pill).toBeVisible();
    const other = await page.evaluate(async () => {
        const tm = window.Strom.TreeManager;
        const id = tm.createTree('Bez výzkumu');
        tm.saveTreeData(id, { version: 11, persons: {}, partnerships: {} } as never);
        return id;
    });
    await page.evaluate((id) => window.Strom.UI.switchToTree(id), other);
    await expect(pill).toBeHidden();
});

test('"Only load from the research" and following live: changes made here are never replaced unasked — the load dialog first, Cancel keeps them', async ({ page }) => {
    const { openResearch, fakeBridge, poll, editJan, researchGed, NEW_HEAD, BRIDGE } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await page.evaluate(() => { const tm = window.Strom.TreeManager; tm.patchResearchLink(tm.getActiveTreeId()!, { sendMode: 'off' }); });
    await poll(page);
    await editJan(page, 'Praha');
    bridge.head = NEW_HEAD;
    bridge.treeGed = researchGed(NEW_HEAD);
    const birthPlace = () => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Jan').birthPlace ?? '');
    await page.evaluate((b) => { void window.Strom.UI.startLiveFollow(b); }, BRIDGE);
    const dialog = page.locator('#research-load-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Praha');
    await dialog.locator('#research-load-cancel').click();
    await expect(dialog).toBeHidden();
    expect(await birthPlace()).toBe('Praha');
    await expect(page.locator('#live-panel')).toBeHidden();
    // Asked again, loaded: the research's version, following on.
    await page.evaluate((b) => { void window.Strom.UI.startLiveFollow(b); }, BRIDGE);
    await dialog.locator('#research-load-ok').click();
    await expect.poll(birthPlace).toBe('');
});

/** "What will be sent" first on a send by hand, as for a user (openResearch skips it). */
async function previewOn(page: Page): Promise<void> {
    await page.evaluate(() => {
        const id = window.Strom.TreeManager.getActiveTreeId()!;
        const key = `strom-research-auto:${id}`;
        localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), skipPreview: false }));
    });
}

test('following live with changes to send: "Send, then load" sends them, loads what the research added, then following starts (R3 of the N1 round, of beta.56)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, editJan, researchGed, NEW_HEAD, BRIDGE } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await poll(page);
    await previewOn(page);
    await editJan(page, 'Praha');
    // The research adds a person; the app has not polled since.
    const bohumil = ['0 @P0017@ INDI', '1 NAME Bohumil /Víšek/', '1 SEX M', '1 REFN P0017', '2 TYPE strom-research'];
    bridge.head = NEW_HEAD;
    bridge.treeGed = researchGed(NEW_HEAD, bohumil);
    const written = 'abcdef123456';
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0061' } };
    bridge.onWrite = () => ({ head: written, ged: researchGed(written, ['1 BIRT', '2 PLAC Praha', ...bohumil]) });
    await page.evaluate((b) => { void window.Strom.UI.startLiveFollow(b); }, BRIDGE);
    await page.getByRole('button', { name: 'Send, then load' }).click();
    // Sent at once (the choice was made in the dialog: no preview), the research's version loaded.
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect(page.locator('#research-changes-panel')).toHaveCount(0);
    const names = () => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).map(p => p.firstName));
    await expect.poll(names).toContain('Bohumil');
    await expect(page.locator('#live-panel')).toBeVisible();
    // Nothing of the user's lost: the research has it.
    expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Jan').birthPlace)).toBe('Praha');
    // The research's version after the write is not taken for the app's own: nothing newer is left.
    await poll(page);
    expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().core)).not.toBe('newer');
});

test('a send made before the poll saw a person the research added: its version is offered to load, ?live= loads it (R3 of beta.56)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, editJan, researchGed, NEW_HEAD, BRIDGE } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await poll(page);
    await editJan(page, 'Praha');
    const bohumil = ['0 @P0017@ INDI', '1 NAME Bohumil /Víšek/', '1 SEX M', '1 REFN P0017', '2 TYPE strom-research'];
    bridge.head = NEW_HEAD;
    bridge.treeGed = researchGed(NEW_HEAD, bohumil);
    const written = 'abcdef123456';
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0061' } };
    bridge.onWrite = () => ({ head: written, ged: researchGed(written, ['1 BIRT', '2 PLAC Praha', ...bohumil]) });
    await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
    await expect.poll(() => bridge.posts.length).toBe(1);
    await poll(page);
    expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().core)).toBe('newer');
    // Following live loads that version (never only "connected again").
    await page.evaluate((b) => { void window.Strom.UI.startLiveFollow(b); }, BRIDGE);
    const names = () => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).map(p => p.firstName));
    const load = page.locator('#research-load-ok');
    await expect.poll(async () => (await names()).includes('Bohumil') || await load.isVisible()).toBe(true);
    if (await load.isVisible()) await load.click();
    await expect.poll(names).toContain('Bohumil');
    await expect(page.locator('#live-panel')).toBeVisible();
    await expect(page.locator('.toast', { hasText: 'Connected to the research again' })).toHaveCount(0);
});

test('the send preview opens under the research\'s place in the toolbar from the amber pill and from Send in the menu (R6 of beta.56)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, editJan, researchGed, NEW_HEAD } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } })
        .then((bridge) => { bridge.head = NEW_HEAD; bridge.treeGed = researchGed(NEW_HEAD); });
    await previewOn(page);
    await editJan(page, 'Praha');
    await poll(page);
    // Changes here and a newer version there: the amber pill with its Send.
    const pill = page.locator('#research-sync-pill');
    await expect(pill).toHaveClass(/is-warn/);
    const panel = page.locator('#research-changes-panel');
    const under = async () => {
        await expect(panel).toBeVisible();
        const p = (await panel.boundingBox())!;
        const at = (await pill.boundingBox())!;
        // Below the pill, reaching to it — not at the right edge under the actions menu.
        expect(p.y).toBeGreaterThan(at.y + at.height - 1);
        expect(p.x).toBeLessThan(at.x + at.width);
        expect(p.x + p.width).toBeLessThan(1440 / 2 + p.width / 2);
    };
    await pill.locator('.research-sync-pill-send').click();
    await under();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    // Send in the research menu (it closes the menu): the same place.
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await under();
});

test('after a send that added a person (the research gave its number) the next edit\'s preview lists what will be sent (N58-1)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, editJan, researchGed } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await poll(page);
    await page.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Zuzana', lastName: 'Nová', gender: 'female' }));
    const written = 'abcdef123456';
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0062' } };
    bridge.onWrite = () => ({ head: written, ged: researchGed(written, ['0 @P0018@ INDI', '1 NAME Zuzana /Nová/', '1 SEX F', '1 REFN P0018', '2 TYPE strom-research']) });
    bridge.replyExtra = (posted) => {
        const xref = /0 (@I\d+@) INDI\n1 NAME Zuzana/.exec(posted)?.[1];
        return xref ? { ids: { persons: { [xref]: 'P0018' }, sources: {} } } : {};
    };
    await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect.poll(() => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Zuzana') as any)?.refn)).toBe('P0018');
    await editJan(page, 'Praha');
    const list = await page.evaluate(async () => (await window.Strom.UI.researchChangesReady())?.map(c => c.name) ?? null);
    expect(list).toEqual(['Jan Víšek']);
    // The same after a reload (the copy kept under the send's fingerprint).
    await page.reload();
    await expect.poll(() => page.evaluate(async () => (await window.Strom.UI.researchChangesReady())?.length ?? null)).toBe(1);
});

test('a sex the research leaves unknown (SEX U) is no change to Female: the load dialog lists none, the tree keeps its sex (N58-2)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, researchGed, NEW_HEAD } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await poll(page);
    bridge.head = NEW_HEAD;
    bridge.treeGed = researchGed(NEW_HEAD, ['0 @P0017@ INDI', '1 NAME Bohumil /Víšek/', '1 SEX M', '1 REFN P0017', '2 TYPE strom-research'])
        .replace('1 NAME Jan /Víšek/\n1 SEX M', '1 NAME Jan /Víšek/\n1 SEX U');
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    const names = () => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).map(p => p.firstName));
    const dialog = page.locator('#research-load-modal');
    await expect.poll(async () => (await names()).includes('Bohumil') || await dialog.isVisible()).toBe(true);
    if (await dialog.isVisible()) {
        await expect(dialog).toContainText('Added from the research: + 1 person');
        await expect(dialog).toContainText('Nothing here will be overwritten.');
        await expect(dialog).not.toContainText('Female');
        await dialog.locator('#research-load-ok').click();
    }
    await expect.poll(names).toContain('Bohumil');
    expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any).gender)).toBe('male');
});

test('a sex the research leaves unknown is said in the load dialog and as a word in What the research knows (beta.59 round, 2)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, researchGed, NEW_HEAD } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await poll(page);
    bridge.head = NEW_HEAD;
    bridge.treeGed = researchGed(NEW_HEAD, ['1 _STROM_CONFLICT X0001', '2 TYPE SEX', '2 STAT open', '2 VAL U', '2 VAL M',
        '0 @P0017@ INDI', '1 NAME Bohumil /Víšek/', '1 SEX M', '1 REFN P0017', '2 TYPE strom-research'])
        .replace('1 NAME Jan /Víšek/\n1 SEX M', '1 NAME Jan /Víšek/\n1 SEX U');
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    const dialog = page.locator('#research-load-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.research-load-sex')).toHaveText('Jan Víšek: the research gives no sex, male stays here.');
    await dialog.locator('#research-load-ok').click();
    const jan = () => page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any);
    await expect.poll(async () => (await jan())?.research?.conflicts?.length ?? 0).toBe(1);
    expect((await jan()).gender).toBe('male');
    await page.evaluate((id) => window.Strom.UI.showPersonResearchDialog(id), (await jan()).id);
    const knows = page.locator('.modal-overlay.active').last();
    await expect(knows).toContainText('unknown');
    await expect(knows.locator('td').filter({ hasText: /^U$/ })).toHaveCount(0);
});

test('the load dialog says every sex the research leaves unknown: one that stays as a line (a husband too), one that changes as "unknown (… here)" (N61-1, N61-2)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, researchGed, NEW_HEAD } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await poll(page);
    const dialog = page.locator('#research-load-modal');
    const anna = () => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Anna') as any).gender);
    // A version where Anna is a man: loaded, so the tree holds her as one.
    bridge.head = NEW_HEAD;
    bridge.treeGed = researchGed(NEW_HEAD).replace('1 NAME Anna /Svobodová/\n1 SEX F', '1 NAME Anna /Svobodová/\n1 SEX M');
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await dialog.locator('#research-load-ok').click();
    await expect.poll(anna).toBe('male');
    await expect(page.locator('.toast', { hasText: 'Research version loaded' })).toBeVisible();
    await page.waitForTimeout(300);
    // Then the research gives no sex for Josef (husband) and Anna (wife).
    bridge.head = 'c3c3c3c3c3c3';
    bridge.treeGed = researchGed('c3c3c3c3c3c3')
        .replace('1 NAME Josef /Víšek/\n1 SEX M', '1 NAME Josef /Víšek/\n1 SEX U')
        .replace('1 NAME Anna /Svobodová/\n1 SEX F', '1 NAME Anna /Svobodová/\n1 SEX U');
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await expect(dialog).toBeVisible();
    // Josef stays a man (the guess for a husband): said, though nothing was kept against the guess.
    await expect(dialog.locator('.research-load-sex')).toHaveText(['Josef Víšek: the research gives no sex, male stays here.']);
    // Anna turns a woman (the guess for a wife): the research gives none, said so in the row.
    await expect(dialog.locator('.research-load-table')).toContainText('Male → unknown (female here)');
    await dialog.locator('#research-load-ok').click();
    await expect.poll(anna).toBe('female');
});

test('a research copy kept for another fingerprint than the one stored beside it is not compared: no list of changes the user never made (N60-3)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, editJan } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await poll(page);
    await editJan(page, 'Brno');
    await expect.poll(() => page.evaluate(async () => (await window.Strom.UI.researchChangesReady())?.length ?? null)).toBe(1);
    // Another window loaded a newer version: its fingerprint is stored at once, its copy not yet.
    await page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        tm.patchResearchLink(id, { fingerprint: 'fp-of-a-newer-version' });
        localStorage.setItem(`strom-research-base-fp:${id}`, 'fp-of-a-newer-version');
    });
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await page.waitForTimeout(500);
    expect(await page.evaluate(async () => (await window.Strom.UI.researchChangesReady())?.length ?? null)).toBeNull();
});

test('a sex the research leaves unknown goes back as SEX U while it stays; changed here it goes as the user\'s (N60-2)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, editJan, researchGed, NEW_HEAD } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await poll(page);
    const unknownJan = (head: string, extra: string[] = []) => researchGed(head, extra).replace('1 NAME Jan /Víšek/\n1 SEX M', '1 NAME Jan /Víšek/\n1 SEX U');
    bridge.head = NEW_HEAD;
    bridge.treeGed = unknownJan(NEW_HEAD);
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await page.locator('#research-load-modal #research-load-ok').click();
    const jan = () => page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any);
    await expect.poll(async () => (await jan())?.gender).toBe('male');
    await expect(page.locator('.toast', { hasText: 'Research version loaded' })).toBeVisible();
    await page.waitForTimeout(300);
    const janSex = (ged: string) => /1 NAME Jan \/Víšek\/[\s\S]*?1 SEX (\w)/.exec(ged)?.[1];
    // An edit of something else: the research's unknown goes back unknown.
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0081' } };
    bridge.onWrite = () => ({ head: 'b1b1b1b1b1b1', ged: unknownJan('b1b1b1b1b1b1', ['1 BIRT', '2 PLAC Brno']) });
    await editJan(page, 'Brno');
    await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
    await expect.poll(() => bridge.posts.length).toBe(1);
    expect(bridge.posts[0]).toContain('1 _STROM_SEX_U Y');
    expect(janSex(bridge.posts[0])).toBe('U');
    // Set otherwise here: the user's word.
    bridge.onWrite = () => ({ head: 'b2b2b2b2b2b2', ged: unknownJan('b2b2b2b2b2b2', ['1 BIRT', '2 PLAC Brno']) });
    await page.evaluate(() => { const dm = window.Strom.DataManager; const j = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any; dm.updatePerson(j.id, { gender: 'female' }); });
    await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(janSex(bridge.posts[1])).toBe('F');
    // Still unknown after a reload (kept with the tie).
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sexU)).toEqual({ P0003: 'male' });
});

test('"Send, then load" where the research takes nothing new: said so (never "the same tree"), its newer version loads, asked first (N60-4)', async ({ page }) => {
    const { openResearch, fakeBridge, poll, editJan, researchGed, NEW_HEAD } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null } });
    await poll(page);
    await editJan(page, 'Brno');
    bridge.head = NEW_HEAD;
    bridge.treeGed = researchGed(NEW_HEAD, ['0 @P0017@ INDI', '1 NAME Bohumil /Víšek/', '1 SEX M', '1 REFN P0017', '2 TYPE strom-research']);
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 0, applied: 0, input: 'I0091' } };
    await page.evaluate(() => { void window.Strom.UI.researchSendNow({ thenLoad: true }); });
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect(page.locator('.toast', { hasText: 'The research took nothing new from this send.' })).toBeVisible();
    await expect(page.locator('.toast', { hasText: 'The research has the same tree' })).toHaveCount(0);
    // Asked before it replaces the edit the research did not take.
    const ok = page.locator('#research-load-modal #research-load-ok, #confirmation-modal.active button:has-text("Update")').first();
    await ok.click();
    const names = () => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).map(p => p.firstName));
    await expect.poll(names).toContain('Bohumil');
});
