import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * A research that tells what it has (Strom Research 1.12+: `accepts` and
 * `inbox` in its status): the state of the tree at the top of ⋯ → Research,
 * the dot on ⋯, sending straight to the bridge without the terminal, a send
 * refused or discarded there, "Send, then load", the update dialog over
 * changes the research does not have, Research for this tree and
 * "Transcription verified". The bridge is answered by page.route.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const HEAD = '3f2a9c1e5b7d';
const NEW_HEAD = '9b8c7d6e5f40';
const BRIDGE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };

function researchGed(head = HEAD, extra: string[] = []): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 27 SEP 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
        ...extra,
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 @S0001@ SOUR', '1 TITL Oddací matrika Čáslav', '1 PAGE fol. 41', '1 REFN S0001', '1 TEXT Josef Víšek a Anna', '1 _STROM_READ research',
        '0 TRLR',
    ].join('\n');
}

async function dropFile(page: Page, name: string, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle(({ name, content }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], name, { type: 'text/plain' }));
        return dt;
    }, { name, content });
    await page.dispatchEvent('#tree-container', 'dragenter', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'dragover', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'drop', { dataTransfer });
}

/** What the fake bridge says and what it got. */
interface FakeBridge {
    head: string;
    accepts: unknown;
    inbox: { tree: string; at: string; changes: number; sent: string }[];
    sends: { intake: string; at: string; state: string; changes: number; tree: string; sent: string; decidedAt?: string; reason?: string }[];
    lastIntake: { id: string; at: string } | null;
    syncReply: { status: number; body: unknown };
    treeGed: string;
    down: boolean;
    posts: string[];
}

async function fakeBridge(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    const b: FakeBridge = {
        head: HEAD,
        accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null },
        inbox: [], sends: [], lastIntake: null,
        syncReply: { status: 200, body: { ok: true, input: 'I0042', changes: 6, inbox: true } },
        treeGed: researchGed(),
        down: false,
        posts: [],
        ...init,
    };
    await page.route(`${BRIDGE}/**`, async (route) => {
        if (b.down) return route.abort('connectionrefused');
        const url = new URL(route.request().url());
        const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (url.pathname.endsWith('/status')) {
            return json(200, {
                tree: { id: UUID, name: 'Víškovi' }, head: b.head, links: ['send', 'open', 'live', 'app', 'setup'],
                accepts: b.accepts, inbox: { trees: b.inbox, material: 0 }, lastIntake: b.lastIntake,
                ...(b.accepts ? { sends: b.sends } : {}),
            });
        }
        if (url.pathname.endsWith('/sync') && route.request().method() === 'POST') {
            const body = route.request().postData() ?? '';
            b.posts.push(body);
            const sent = /1 _STROM_SENT (\S+)/.exec(body)?.[1] ?? '';
            const appTree = /1 _STROM_APP_TREE (\S+)/.exec(body)?.[1] ?? UUID;
            const intake = `R${Date.now()}-${b.posts.length}`;
            if (b.syncReply.status === 200 && (b.syncReply.body as { inbox?: boolean }).inbox) {
                const at = new Date().toISOString();
                for (const rec of b.sends) if (rec.tree === appTree && rec.state === 'pending') rec.state = 'replaced';
                b.inbox = [{ tree: appTree, at, changes: 6, sent }];
                b.sends.unshift({ intake, at, state: 'pending', changes: 6, tree: appTree, sent });
            }
            return json(b.syncReply.status, b.syncReply.status === 200 ? { ...(b.syncReply.body as object), intake } : b.syncReply.body);
        }
        if (url.pathname.endsWith('/tree.ged')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: b.treeGed });
        }
        if (url.pathname.endsWith('/cancel')) return json(200, { ok: true });
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    return b;
}

/** The research opened in the app; its bridge remembered (as after a ?live= / ?send=); optionally changed. */
async function openResearch(page: Page, opts: { edit?: boolean; bridge?: boolean; capable?: boolean } = {}): Promise<void> {
    await openApp(page);
    await page.evaluate(() => {
        // Opening links in the system is not testable: record them instead.
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
    });
    await dropFile(page, 'tree-strom.ged', researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
    if (opts.bridge !== false) {
        // As after a ?live= / ?send= from a research that says what it takes.
        await page.evaluate(({ uuid, base, accepts }) => {
            localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, ...(accepts ? { accepts } : {}) }));
        }, { uuid: UUID, base: BRIDGE, accepts: opts.capable === false ? null : { sync: { auto: 'off' }, sources: true, verified: true } });
    }
    if (opts.edit) await editJan(page);
}

async function editJan(page: Page, place = 'Praha'): Promise<void> {
    await page.evaluate((place) => {
        const dm = window.Strom.DataManager;
        const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
        dm.updatePerson(jan.id, { birthPlace: place });
    }, place);
}

const poll = (page: Page) => page.evaluate(() => window.Strom.UI.pollResearchBridge());
const links = (page: Page) => page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links);

async function openResearchMenu(page: Page): Promise<void> {
    await page.evaluate(() => {
        if (!document.getElementById('actions-menu-dropdown')?.classList.contains('active')) window.Strom.UI.toggleActionsMenu();
        window.Strom.UI.openActionsResearchSubmenu();
    });
}

const block = (page: Page) => page.locator('#research-sync-block');
const dot = (page: Page) => page.locator('#actions-menu-dot');

test.describe('the state of the tree and sending straight', () => {
    test('changes the research lacks: the block and the dot; Send posts without a dialog; then sent and waiting, no dot', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page);
        await poll(page);
        await expect(dot(page)).toBeVisible();
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

    test('nothing to send; in sync quietly, no dot', async ({ page }) => {
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

    test('refused: a dialog with the reason; Try again sends again', async ({ page }) => {
        await openResearch(page, { edit: true });
        const bridge = await fakeBridge(page, { syncReply: { status: 409, body: { error: 'strom ve výzkumu je zamčený jiným sezením' } } });
        await poll(page);
        void page.evaluate(() => window.Strom.UI.researchSendNow());
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText("The research didn't accept the changes");
        await expect(dialog).toContainText('Reason from the research: strom ve výzkumu je zamčený jiným sezením');
        bridge.syncReply = { status: 200, body: { ok: true, changes: 6, inbox: true } };
        await dialog.getByRole('button', { name: 'Try again' }).click();
        await expect(page.locator('.toast')).toContainText('Sent to the research, 6 changes');
        expect(bridge.posts).toHaveLength(2);
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
        await openResearchMenu(page);
        await expect(block(page)).toHaveCount(0);
        await expect(dot(page)).toBeHidden();
        await expect(page.locator('#research-item-tree-settings')).toHaveCount(0);
        expect(asked).toBe(0);   // an older research is never asked unasked
    });
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
        await expect(page.locator('.toast')).toContainText('New version loaded from the research, including your changes.');
        await expect(pill).toBeHidden();
        const meta = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata());
        expect(meta.research.head).toBe('aa11bb22cc33');
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
