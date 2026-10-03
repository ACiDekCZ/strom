import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { FakeBridge, fakeBridge, poll, openResearchMenu, researchGed, HEAD, UUID, BRIDGE, dropFile } from './research-bridge.js';

/**
 * A research that is an archive (`mode: archive`): nothing in the app speaks
 * of an agent or AI — no option, no text — in any menu or dialog of the tree,
 * in English, Czech and German. Data from the time with an agent (an open
 * conflict, the research edge with its tasks and sessions) is still there:
 * the archive keeps it as a record, nothing that leads to an agent.
 */

const ARCHIVE = { mode: 'archive', sync: { auto: 'mirror' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'parked', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const ALL_LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat', 'review', 'research', 'sync-undo', 'conflict', 'direction', 'task', 'update'];

/** Agent, AI and paying for it, in the three languages. */
const AGENT_WORDS = /\bagent|\bAI\b|\bKI\b|Claude|subscription|předplatn|\bAbo\b|\bpaid\b|zaplat|bezahl/i;

/** Jan, as the research had him with an agent: an open conflict and the research edge (tasks, sessions, a decision). */
const JAN_RESEARCH = [
    '1 BIRT', '2 DATE 1865', '2 PLAC Chlumy',
    '1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 VAL 3 FEB 1865', '2 VAL 1866',
    '1 _STROM_EDGE parents', '2 _SCOPE in', '2 _RESEARCH G0001', '2 _GEN 2', '2 _END not-found', '2 _NEXT decide',
    '2 _TASK T0002', '3 _LEVEL link', '3 STAT waiting', '3 TITL Baptism of Jan', '3 _POS 1',
    '2 _SEARCHES 4', '2 _SESSIONS 2', '3 _COST 1.50',
];

function archiveGed(): string {
    return researchGed(HEAD, JAN_RESEARCH)
        .replace('1 _STROM_LINKS send open live app setup', `1 _STROM_LINKS ${ALL_LINKS.join(' ')}\n1 _STROM_MODE archive\n1 _STROM_ASOF 2026-09-27`);
}

async function openArchive(page: Page): Promise<FakeBridge> {
    await page.clock.install();
    await openApp(page);
    await page.evaluate(() => {
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
        localStorage.setItem('strom-research-auto-intro-seen', '1');
    });
    await dropFile(page, 'tree-strom.ged', archiveGed());
    await expect(card(page, 'Jan')).toBeVisible();
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: ARCHIVE });
    const bridge = await fakeBridge(page, { accepts: ARCHIVE, links: ALL_LINKS, treeGed: archiveGed(), lastIntake: { id: 'I0041', at: new Date().toISOString() } });
    // Set to Evidence while the research worked with an agent: kept, not offered nor sent in the archive.
    await page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        tm.patchResearchLink(tm.getActiveTreeId()!, { transcripts: 'evidence' });
    });
    await poll(page);
    return bridge;
}

/** The visible words of what is open now (the whole of a dialog, scrolled or not). */
async function shownText(page: Page, selector: string): Promise<string> {
    return page.locator(selector).evaluateAll(els => els.map(el => (el as HTMLElement).innerText
        + ' ' + [...el.querySelectorAll('[aria-label],[title]')].filter(x => (x as HTMLElement).offsetParent !== null)
            .map(x => `${x.getAttribute('aria-label') ?? ''} ${x.getAttribute('title') ?? ''}`).join(' ')).join('\n'));
}

function expectNoAgent(where: string, text: string): void {
    const hit = AGENT_WORDS.exec(text);
    expect(hit ? `${where}: …${text.slice(Math.max(0, hit.index - 60), hit.index + 60)}…` : '', where).toBe('');
}

for (const locale of ['en-US', 'cs-CZ', 'de-DE']) {
    test.describe(`an archive never speaks of an agent or AI (${locale})`, () => {
        test.use({ locale });

        test('menus, the block and the dialogs of the tree', async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            const bridge = await openArchive(page);
            const janId = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id);
            expect(await page.evaluate(() => window.Strom.UI.activeResearchArchive())).toBe(true);

            // Actions → Research (with the sync block above it).
            await openResearchMenu(page);
            await expect(page.locator('#actions-research-submenu')).toBeVisible();
            expectNoAgent('Actions → Research', await shownText(page, '#actions-research-submenu'));
            expectNoAgent('Actions menu', await shownText(page, '#actions-menu-dropdown'));
            await page.evaluate(() => window.Strom.UI.closeActionsMenu());

            // The person menu.
            const labels = await page.evaluate((id) => window.Strom.UI.getPersonMenuActions(id)
                .flatMap((a: any) => [a.label, a.sub, ...(a.submenu ?? []).flatMap((x: any) => [x.label, x.sub])]).filter(Boolean).join('\n'), janId);
            expectNoAgent('person menu', labels);

            // Research for this tree.
            await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
            await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
            await expect(page.locator('#research-tree-settings-modal input[name="research-send-mode"]')).toHaveCount(2);
            await expect(page.locator('#research-tree-settings-modal input[name="research-transcripts"]')).toHaveCount(0);
            expectNoAgent('Research for this tree', await shownText(page, '#research-tree-settings-modal'));
            await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());

            // What the research knows about Jan: the conflict and the edge.
            await page.evaluate((id) => window.Strom.UI.showPersonResearchDialog(id, { edge: true }), janId);
            const research = page.locator('.modal-overlay.active').last();
            await expect(research).toContainText(/1866/);
            // There: deciding the conflict, the edge as a record.
            await expect(research.locator('[data-do="decide"]')).toBeVisible();
            await expect(research.locator('[data-do="agent"]')).toHaveCount(0);
            await expect(research.locator('#research-edge-section')).toBeVisible();
            await expect(research.locator('.rep-action')).toHaveCount(0);
            expectNoAgent('person research dialog', await shownText(page, '.modal-overlay.active'));
            await page.keyboard.press('Escape');

            // Send material to the research (the person), and Add materials.
            await page.evaluate((id) => window.Strom.UI.showMaterialDialog({ personId: id }), janId);
            await expect(page.locator('.modal-overlay.active').last()).toBeVisible();
            expectNoAgent('send material', await shownText(page, '.modal-overlay.active'));
            await page.keyboard.press('Escape');
            await page.evaluate(() => window.Strom.UI.showBatchDialog());
            await expect(page.locator('.modal-overlay.active').last()).toBeVisible();
            expectNoAgent('add materials', await shownText(page, '.modal-overlay.active'));
            await page.keyboard.press('Escape');

            // A source with a transcript the user wrote: the tree set to Evidence does not count in an archive,
            // the source offers its own "Transcription verified".
            const sourceId = await page.evaluate(() => window.Strom.DataManager.addSource({ title: 'Matrika', transcript: 'Jan Víšek, narozen 1865' }).id);
            await page.evaluate((id) => window.Strom.UI.showEditSourceModal(id), sourceId);
            await expect(page.locator('#source-verified-row')).toBeVisible();
            await expect(page.locator('#source-verified-bytree')).toBeHidden();
            expectNoAgent('source editor', await shownText(page, '#source-editor-modal'));
            await page.evaluate(() => window.Strom.UI.closeSourceEditor());

            // Settings (the tree's research edge, card badges).
            await page.evaluate(() => window.Strom.UI.showSettingsDialog());
            await expect(page.locator('#settings-modal')).toBeVisible();
            await expect(page.locator('#research-edge-settings')).toBeVisible();
            await expect(page.locator('#research-edge-motion-toggle')).toHaveCount(0);
            expectNoAgent('Settings', await shownText(page, '#settings-modal'));
            await page.evaluate(() => window.Strom.UI.closeSettingsDialog());

            // Waiting for you and the list of changes.
            await page.evaluate(() => window.Strom.UI.showResearchWaiting());
            expectNoAgent('Waiting for you', await shownText(page, '.modal-overlay.active'));
            await page.keyboard.press('Escape');

            // Cards: their tooltips and labels.
            expectNoAgent('cards', await shownText(page, '#tree-container'));

            // A send says nothing of how transcripts weigh (an archive takes them as leads).
            await page.evaluate(() => {
                const dm = window.Strom.DataManager;
                const jan = dm.getAllPersons().find(p => p.firstName === 'Jan')!;
                dm.updatePerson(jan.id, { birthPlace: 'Praha' });
            });
            await page.evaluate(() => window.Strom.UI.researchSendNow());
            await expect.poll(() => bridge.posts.length).toBe(1);
            expect(bridge.posts[0]).toContain('_STROM_TREE');
            expect(bridge.posts[0]).not.toContain('_STROM_TRANSCRIPTS');
        });
    });
}
