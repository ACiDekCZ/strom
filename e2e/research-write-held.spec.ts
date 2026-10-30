import { test, expect, Page } from '@playwright/test';
import { UUID, block, editJan, fakeBridge, links, openResearch, openResearchMenu, poll, FakeBridge } from './research-bridge.js';
import { partBoxes } from './research-conflict.js';

/**
 * Writes the research holds back until something there is settled (spec 017
 * U7): the tree sealed on another computer (409 `seal.foreign`), files of its
 * cloud folder not downloaded yet (409 `tree.not-downloaded`), a full disk
 * (507 `disk.full`) — the research's own sentence, the edits waiting here,
 * never sent again by itself, "Take over on this computer" for the seal
 * (`strom-research://seal`). Said ahead when `/status` says so (`seal`,
 * `notDownloaded`); each only from a bridge naming its capability in
 * `features`, an older one as before. And the switcher's Archive / Research
 * by `tree.kind` (a research waiting for its agent: Archive). Invented data.
 */

const QUIET = 120_000;
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'seal'];
const SEAL = '„Fíškovi“ byl zapečetěn na jiném počítači: nic se nezapsalo — až se převezme na tomto (terminál: strom seal adopt), pošlete znovu';
const CLOUD = 'Fíškovi: 4 soubory ještě nejsou stažené z cloudové složky (media/a.jpg) — nic se nezapsalo, až se stáhnou, pošlete znovu';
const DISK = 'Na disku výzkumu došlo místo (/Users/x/Strom): nic se nezapsalo — uvolněte místo a pošlete znovu';

const REFUSALS = [
    { code: 'seal.foreign', feature: 'seal.foreign', status: 409, error: SEAL, params: { name: 'Fíškovi', set: 'strom seal adopt' }, title: 'Sealed on another computer' },
    { code: 'tree.not-downloaded', feature: 'tree.notDownloaded', status: 409, error: CLOUD, params: { n: 4, first: 'media/a.jpg' }, title: 'Files not downloaded yet' },
    { code: 'disk.full', feature: 'disk.full', status: 507, error: DISK, params: { where: '/Users/x/Strom' }, title: 'No room left on the disk' },
];

const KEPT = 'The changes made here wait unsent; nothing is lost.';
const dialog = (page: Page) => page.locator('#confirmation-modal');
const pill = (page: Page) => page.locator('#research-sync-pill');
const sealUrl = `strom-research://seal?tree=${UUID}`;

/** A research tree that sends by itself (the default), its bridge running. */
async function autoTree(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    await page.clock.install();
    await openResearch(page, { auto: true });
    const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null }, links: LINKS, ...init });
    await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
    await poll(page);
    return bridge;
}

test.describe('a send the research holds back', () => {
    for (const r of REFUSALS) {
        test(`${r.code} (${r.status}), sent by hand: the research's sentence, the edits kept, nothing sent again by itself`, async ({ page }) => {
            await openResearch(page, { edit: true });
            const bridge = await fakeBridge(page, { features: [r.feature], links: LINKS,
                syncReply: { status: r.status, body: { error: r.error, code: r.code, text: 'nothing was written', params: r.params } } });
            await poll(page);
            void page.evaluate(() => window.Strom.UI.researchSendNow());
            await expect(dialog(page)).toContainText(r.title);
            await expect(dialog(page)).toContainText(r.error);
            await expect(dialog(page)).toContainText(KEPT);
            await expect(dialog(page)).not.toContainText("didn't accept");
            await expect(dialog(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
            const take = dialog(page).getByRole('button', { name: 'Take over on this computer, opens in the research' });
            if (r.code === 'seal.foreign') {
                await take.click();
                expect(await links(page)).toContain(sealUrl);
            } else {
                await expect(take).toHaveCount(0);
                await dialog(page).getByRole('button', { name: 'Close' }).click();
            }
            await expect(dialog(page)).not.toHaveClass(/active/);
            expect(bridge.posts).toHaveLength(1);
            // The tree's state says it, with the sentence; more edits and answers: nothing goes by itself.
            await openResearchMenu(page);
            await expect(block(page)).toHaveAttribute('data-state', 'writeHeld');
            await expect(block(page)).toContainText(r.title);
            await expect(block(page)).toContainText(r.error);
            await expect(block(page).getByRole('menuitem', { name: 'Take over on this computer, opens in the research' })).toHaveCount(r.code === 'seal.foreign' ? 1 : 0);
            await page.evaluate(() => window.Strom.UI.closeActionsMenu());
            await editJan(page, 'Brno');
            await poll(page);
            await poll(page);
            expect(bridge.posts).toHaveLength(1);
            // Settled there: sent by hand, it goes.
            bridge.syncReply = { status: 200, body: { ok: true, input: 'I0042', changes: 6, inbox: true } };
            await page.evaluate(() => window.Strom.UI.researchSendNow());
            await expect(page.locator('.toast')).toContainText('Sent to the research');
            expect(bridge.posts).toHaveLength(2);
            await openResearchMenu(page);
            await expect(block(page)).not.toHaveAttribute('data-state', 'writeHeld');
        });

        test(`${r.code} from a bridge that does not name ${r.feature}: the refusal as before`, async ({ page }) => {
            await openResearch(page, { edit: true });
            await fakeBridge(page, { links: LINKS, syncReply: { status: r.status, body: { error: r.error, code: r.code, text: 'nothing was written', params: r.params } } });
            await poll(page);
            void page.evaluate(() => window.Strom.UI.researchSendNow());
            await expect(dialog(page)).toContainText("The research didn't accept the changes");
            await expect(dialog(page)).not.toContainText(r.error);
            await expect(dialog(page)).not.toContainText(r.title);
            await expect(dialog(page).getByRole('button', { name: 'Take over on this computer, opens in the research' })).toHaveCount(0);
            await dialog(page).getByRole('button', { name: 'Close' }).click();
            await openResearchMenu(page);
            await expect(block(page)).not.toHaveAttribute('data-state', 'writeHeld');
        });
    }

    test('seal.foreign while sending by itself: one toast with the sentence and the way to take over; nothing goes by itself after', async ({ page }) => {
        const bridge = await autoTree(page, { features: ['seal.foreign'],
            syncReply: { status: 409, body: { error: SEAL, code: 'seal.foreign', text: 'sealed elsewhere', params: { name: 'Fíškovi', set: 'strom seal adopt' } } } });
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        const toast = page.locator('.toast', { hasText: SEAL });
        await expect(toast).toContainText(KEPT);
        await expect(page.locator('.toast')).not.toContainText('Automatic sending stopped');
        await expect(pill(page)).toContainText('Sealed on another computer');
        await toast.getByRole('button', { name: 'Take over on this computer, opens in the research' }).click();
        expect(await links(page)).toContain(sealUrl);
        await editJan(page, 'Brno');
        await page.clock.fastForward(QUIET * 3);
        await poll(page);
        expect(bridge.posts).toHaveLength(1);
        await expect(page.locator('.toast', { hasText: SEAL })).toHaveCount(0);
    });

    test('seal.foreign sent by hand, then taken over: the block goes with the status, the edits wait unsent, nothing goes by itself', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page, { features: ['seal.foreign'], links: LINKS,
            syncReply: { status: 409, body: { error: SEAL, code: 'seal.foreign', text: 'sealed elsewhere', params: { name: 'Fíškovi', set: 'strom seal adopt' } } } });
        await poll(page);
        void page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(dialog(page)).toContainText(SEAL);
        await dialog(page).getByRole('button', { name: 'Close' }).click();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'writeHeld');
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        // Taken over there: the next answer says the seal is here.
        bridge.statusExtra = { seal: 'here' };
        bridge.syncReply = { status: 200, body: { ok: true, input: 'I0042', changes: 6, inbox: true } };
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'unsent');
        await expect(block(page)).not.toContainText('Sealed on another computer');
        await expect(block(page).getByRole('menuitem', { name: 'Take over on this computer, opens in the research' })).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());
        await poll(page);
        expect(bridge.posts).toHaveLength(1);
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(page.locator('.toast')).toContainText('Sent to the research');
        expect(bridge.posts).toHaveLength(2);
    });

    test('seal.foreign while sending by itself, then taken over: the status says so, the edits go once', async ({ page }) => {
        const bridge = await autoTree(page, { features: ['seal.foreign'],
            syncReply: { status: 409, body: { error: SEAL, code: 'seal.foreign', text: 'sealed elsewhere', params: { name: 'Fíškovi', set: 'strom seal adopt' } } } });
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(pill(page)).toContainText('Sealed on another computer');
        await poll(page);
        expect(bridge.posts).toHaveLength(1);
        bridge.statusExtra = { seal: 'here' };
        bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 6, applied: 6, input: 'I0042' } };
        await poll(page);
        await expect(pill(page)).not.toContainText('Sealed on another computer');
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(2);
        await page.clock.fastForward(QUIET * 3);
        await poll(page);
        expect(bridge.posts).toHaveLength(2);
    });
});

test.describe('a long sentence of the research (German, a long path)', () => {
    test.use({ locale: 'de-DE' });
    const NAME = 'Familienchronik Großeltern Müll';
    const PATH = '/Users/familie/Library/Mobile_Documents/com~apple~CloudDocs/Strom/familienchronik-grosseltern-muell';
    const SEAL_DE = `„${NAME}“ wurde auf einem anderen Computer versiegelt: Nichts wurde geschrieben — sobald er auf diesem übernommen ist (Terminal: strom seal adopt), erneut senden`;
    const DISK_DE = `Auf dem Datenträger der Forschung ist kein Platz mehr (${PATH}): Nichts wurde geschrieben — Platz freigeben und erneut senden`;
    const fits = (l: ReturnType<Page['locator']>) => l.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!;

    for (const width of [1440, 390]) {
        test(`${width} px: the block keeps the sentence's width, Take over under it; nothing past the menu`, async ({ page }) => {
            await page.setViewportSize({ width, height: width > 640 ? 900 : 844 });
            await openResearch(page, { edit: true });
            await fakeBridge(page, { features: ['seal.foreign'], links: LINKS,
                syncReply: { status: 409, body: { error: SEAL_DE, code: 'seal.foreign', text: 'sealed', params: { name: NAME, set: 'strom seal adopt' } } } });
            await poll(page);
            void page.evaluate(() => window.Strom.UI.researchSendNow()).catch(() => {});
            await expect(dialog(page)).toHaveClass(/active/);
            await page.locator('#confirm-cancel-btn').click();
            await openResearchMenu(page);
            await expect(block(page)).toHaveAttribute('data-state', 'writeHeld');
            // Read in one go: the phone's sheet may still be gliding up.
            const [whole, status, take] = await partBoxes(block(page), [':scope', '.research-sync-status', '.research-sync-main']);
            expect(status.width).toBeGreaterThan(whole.width * 0.6);
            expect(take.y).toBeGreaterThanOrEqual(status.y + status.height - 1);
            expect(take.x + take.width).toBeLessThanOrEqual(whole.x + whole.width + 0.5);
            expect(await fits(block(page))).toBe(true);
        });

        test(`${width} px: a long path wraps in the dialog, the block and the toast`, async ({ page }) => {
            await page.setViewportSize({ width, height: width > 640 ? 900 : 844 });
            await page.clock.install();
            await openResearch(page, { auto: true });
            const bridge = await fakeBridge(page, { features: ['disk.full'], links: LINKS,
                accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null },
                syncReply: { status: 507, body: { error: DISK_DE, code: 'disk.full', text: 'disk full', params: { where: PATH } } } });
            await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
            await poll(page);
            await editJan(page);
            await page.clock.fastForward(QUIET + 1000);
            await expect.poll(() => bridge.posts.length).toBe(1);
            const toast = page.locator('.toast', { hasText: PATH.slice(0, 20) });
            await expect(toast).toHaveClass(/show/);
            const t = await box(toast);
            expect(t.x).toBeGreaterThanOrEqual(-0.5);
            expect(t.x + t.width).toBeLessThanOrEqual(width + 0.5);
            await openResearchMenu(page);
            await expect(block(page)).toHaveAttribute('data-state', 'writeHeld');
            expect(await fits(block(page))).toBe(true);
            expect(await fits(block(page).locator('.research-sync-sub'))).toBe(true);
            const [sub, main] = await partBoxes(block(page), ['.research-sync-sub', '.research-sync-main']);
            expect(main.y).toBeGreaterThanOrEqual(sub.y + sub.height - 1);
            // Sent by hand: the dialog says it, wrapped.
            await page.evaluate(() => window.Strom.UI.closeActionsMenu());
            void page.evaluate(() => window.Strom.UI.researchSendNow()).catch(() => {});
            await expect(dialog(page)).toContainText(PATH);
            expect(await fits(page.locator('#confirmation-modal .modal-content'))).toBe(true);
            expect(await fits(page.locator('#confirm-message'))).toBe(true);
        });
    }
});

test.describe('said ahead by /status', () => {
    test('sealed on another computer: said before anything is sent, sending by itself waits; taken over, the edits go', async ({ page }) => {
        const bridge = await autoTree(page, { features: ['seal.foreign'], statusExtra: { seal: 'elsewhere' } });
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await poll(page);
        expect(bridge.posts).toHaveLength(0);
        await expect(pill(page)).toContainText('Sealed on another computer');
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'writeHeld');
        await expect(block(page)).toContainText('This tree was sealed on another computer: nothing can be written to it here until it is taken over on this computer.');
        await expect(block(page)).toContainText('Changes made here wait unsent until then; nothing is lost.');
        await block(page).getByRole('menuitem', { name: 'Take over on this computer, opens in the research' }).click();
        expect(await links(page)).toContain(sealUrl);
        // Taken over there: the next answer says so, the edits go by themselves.
        bridge.statusExtra = { seal: 'here' };
        bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 6, applied: 6, input: 'I0042' } };
        await poll(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
    });

    test('files not downloaded: said with their count; sent by hand it is not offered as Send', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page, { features: ['tree.notDownloaded'], statusExtra: { notDownloaded: 3 }, links: LINKS });
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'writeHeld');
        await expect(block(page)).toContainText('Files not downloaded yet');
        await expect(block(page)).toContainText('3 files of the tree are not downloaded from the cloud folder yet: nothing is written until then.');
        await expect(block(page).getByRole('menuitem', { name: 'Take over on this computer, opens in the research' })).toHaveCount(0);
        await expect(block(page).getByRole('menuitem', { name: 'Send changes' })).toHaveCount(0);
        expect(bridge.posts).toHaveLength(0);
        // Downloaded: the changes are offered again.
        bridge.statusExtra = { notDownloaded: 0 };
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'unsent');
    });

    test('a bridge without the capabilities: seal and notDownloaded mean nothing, the edits go as before', async ({ page }) => {
        const bridge = await autoTree(page, { statusExtra: { seal: 'elsewhere', notDownloaded: 3 },
            syncReply: { status: 200, body: { ok: true, inbox: false, changes: 6, applied: 6, input: 'I0042' } } });
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await expect(pill(page)).not.toContainText('Sealed on another computer');
    });
});

test.describe('a batch the research holds back', () => {
    const BATCH_ACCEPTS = {
        sync: { auto: 'off' }, sources: true, verified: true,
        media: { max: 500 * 1024 * 1024, region: true, batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } },
    };
    test.use({ viewport: { width: 1440, height: 900 } });

    test('sealed elsewhere: paused with the sentence and the way to take over; no new batch, nothing sent again by itself', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS, features: ['seal.foreign', 'media.codes'], links: LINKS, mediaPutStatus: 409,
            mediaPutReply: { error: SEAL, code: 'seal.foreign', text: 'sealed elsewhere', params: { name: 'Fíškovi', set: 'strom seal adopt' } } });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await page.evaluate(() => {
            const files = ['Krabice/a.jpg', 'Krabice/b.jpg'].map(path => ({ path, file: new File([`obsah ${path}`], path.split('/').pop()!, { type: 'image/jpeg' }) }));
            (window.Strom.UI as any).addBatchFiles(files);
        });
        const modal = page.locator('#batch-modal');
        await modal.locator('[data-act="next"]').click();
        await modal.getByRole('button', { name: 'Send 2 files' }).click();
        await expect(modal.locator('.batch-progress-title')).toHaveText('Paused');
        await expect(modal.locator('.batch-paused-note')).toContainText(SEAL);
        await expect(modal.locator('.batch-paused-note')).not.toContainText('stopped responding');
        await expect(modal.locator('.batch-refused')).toHaveCount(0);
        expect(b.mediaPuts).toHaveLength(1);
        expect(b.batchDone ?? []).toHaveLength(0);
        const heads = new Set(b.mediaPuts.map(p => p.headers['x-strom-batch']));
        await modal.locator('[data-act="seal"]').click();
        expect(await links(page)).toContain(sealUrl);
        // Taken over: Continue sends the rest in the same batch.
        b.mediaPutStatus = 200;
        await poll(page);
        await modal.getByRole('button', { name: 'Continue' }).click();
        await expect(modal.locator('.batch-confirm-title')).toContainText('is in the research');
        expect(b.mediaPuts).toHaveLength(3);
        expect(new Set(b.mediaPuts.map(p => p.headers['x-strom-batch']))).toEqual(heads);
        expect(b.batchDone).toHaveLength(1);
    });
});

test.describe('the switcher: Archive or Research by the tree\'s kind', () => {
    test.use({ viewport: { width: 1024, height: 768 } });
    const kind = (page: Page) => page.locator('#tree-switcher-dropdown .tree-switcher-item.active .tree-item-kind');

    async function shown(page: Page, init: Partial<FakeBridge>): Promise<void> {
        await openResearch(page);
        await fakeBridge(page, init);
        await poll(page);
        await page.evaluate(() => window.Strom.UI.updateTreeSwitcher());
        await page.locator('.tree-switcher-btn').click();
    }

    test('a research waiting for its agent (kind archive, state waiting): Archive, though its agent was said here', async ({ page }) => {
        await shown(page, { features: ['tree.kind', 'tree.state'], accepts: { mode: 'research', agentHere: true, sync: { auto: 'off' } },
            statusExtra: { tree: { id: UUID, name: 'Fíškovi', kind: 'archive', state: 'waiting' } } });
        await expect(kind(page)).toHaveText('Archive');
        await expect(kind(page)).toHaveAttribute('data-kind', 'archive');
    });

    test('kind research: Research, though no agent was said here', async ({ page }) => {
        await shown(page, { features: ['tree.kind', 'tree.state'], accepts: { mode: 'research', agentHere: false, sync: { auto: 'off' } },
            statusExtra: { tree: { id: UUID, name: 'Fíškovi', kind: 'research', state: 'research' } } });
        await expect(kind(page)).toHaveText('Research');
        await expect(kind(page)).toHaveAttribute('data-kind', 'agent');
    });

    test('kind archive: Archive; kept after a reload with the research not running', async ({ page }) => {
        await shown(page, { features: ['tree.kind', 'tree.state'], accepts: { mode: 'research', sync: { auto: 'off' } },
            statusExtra: { tree: { id: UUID, name: 'Fíškovi', kind: 'archive', state: 'archive' } } });
        await expect(kind(page)).toHaveText('Archive');
        await page.reload();
        await page.evaluate(() => window.Strom.UI.updateTreeSwitcher());
        await page.locator('.tree-switcher-btn').click();
        await expect(kind(page)).toHaveText('Archive');
    });

    test('a bridge without tree.kind: its kind means nothing, accepts decides as before', async ({ page }) => {
        await shown(page, { accepts: { mode: 'research', agentHere: true, sync: { auto: 'off' } },
            statusExtra: { tree: { id: UUID, name: 'Fíškovi', kind: 'archive', state: 'waiting' } } });
        await expect(kind(page)).toHaveText('Research');
    });
});
