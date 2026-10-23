import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { card } from './helpers.js';
import {
    fakeBridge, fakeMaterial, materialFile, materialSha, MATERIAL_FEATURES, openResearch, openResearchMenu, poll, block, dot,
    researchGed, HEAD, UUID, BRIDGE, FakeBridge, FakeMaterial, FakeMaterialFile, FakeMaterialBatch, foreignCommit,
} from './research-bridge.js';

/**
 * Materials at the person (spec 017 U5): the editor's "Sources and
 * materials" section (attachments joined with the research's files, the
 * batch's files, the states while the research is not running), the item's
 * ⋯ menu, "Add material…" with "Also save to the tree", and the ways into
 * the materials window. Gated only by the research's `/status.features`.
 * Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const AVATAR = 'e2e/fixtures/avatar.png';
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const ARCHIVE = { mode: 'archive', sync: { auto: 'mirror' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'parked', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };

function archiveGed(): string {
    return researchGed(HEAD).replace('1 _STROM_LINKS send open live app setup', '1 _STROM_LINKS send open live app setup\n1 _STROM_MODE archive');
}

interface Setup {
    features?: string[];
    files?: FakeMaterialFile[];
    batches?: FakeMaterialBatch[];
    archive?: boolean;
    /** Status batches (the research block's line). */
    statusBatches?: unknown[];
    /** Before the first poll (Jan's attachments, remembered capabilities). */
    before?: (page: Page) => Promise<void>;
    down?: boolean;
}

async function setup(page: Page, opts: Setup = {}): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({ files: opts.files ?? [], batches: opts.batches ?? [], people: PEOPLE });
    const ged = opts.archive ? archiveGed() : researchGed();
    const accepts = opts.archive ? ARCHIVE : MEDIA_ACCEPTS;
    const bridge = await fakeBridge(page, { accepts, features: opts.features ?? MATERIAL_FEATURES, material, treeGed: ged,
        ...(opts.statusBatches ? { batches: opts.statusBatches } : {}) });
    await openResearch(page, { media: true, ged });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts });
    if (opts.before) await opts.before(page);
    bridge.down = !!opts.down;
    await poll(page);
    return { bridge, material };
}

const janId = (page: Page) => page.evaluate(() =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);

/** Jan's attachments (a tree-only one, and one whose original the research has). */
async function attach(page: Page, list: { name: string; original?: string }[]): Promise<void> {
    const id = await janId(page);
    await page.evaluate(({ id, list, px }) => {
        for (const a of list) {
            window.Strom.DataManager.addAttachment(id as never, {
                name: a.name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70,
                ...(a.original ? { original: { sha256: a.original, name: a.name, mimeType: 'image/png', bytes: 70 } } : {}),
            } as never);
        }
        // The cards show the new counts (adding through the editor redraws them itself).
        window.Strom.TreeRenderer.render();
    }, { id, list, px: PX });
}

async function editJanModal(page: Page): Promise<void> {
    const id = await janId(page);
    await page.evaluate((id) => {
        const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
        ui.pushDialog('person-modal');
        ui.showEditPersonModal(id);
    }, id);
    await expect(page.locator('#person-modal')).toBeVisible();
}

const section = (page: Page) => page.locator('#materials-section');
const rows = (page: Page) => section(page).locator('.material-row:not(.is-skeleton)');

test.describe('Materials at the person', () => {
    test.use({ viewport: DESKTOP });

    test('an attachment whose original the research has is one row; a batch file says "via batch"; tree-only stays', async ({ page }) => {
        const shared = materialSha('I0001');
        const { material } = await setup(page, {
            files: [
                materialFile(1, { persons: ['P0003'], title: 'Křestní list' }),
                materialFile(2, { batch: 'b-box', path: 'Dopisy/scan-2.jpg', from: 'batch from the Strom app' }),
                materialFile(3, { persons: ['P0001'] }),
            ],
            batches: [{ id: 'b-box', name: 'Krabice', persons: ['P0003'] }],
            before: page => attach(page, [{ name: 'krest.png', original: shared }, { name: 'jen-strom.png' }]),
        });
        await editJanModal(page);
        await expect(section(page)).toBeVisible();
        await expect(page.locator('#attachments-section')).toBeHidden();
        await expect(page.locator('#pm-section-research .pm-section-title')).toHaveText('Sources and materials');
        await expect(rows(page)).toHaveCount(3);
        await expect(section(page).locator('.materials-count')).toHaveText('3');
        await expect(section(page).locator('.material-via')).toHaveCount(1);
        await expect(section(page).locator('.material-row', { has: page.locator('.material-via') })).toContainText('Krabice');
        // The tree-only attachment keeps its note field; the research's files show where they are.
        await expect(section(page).locator('.material-note-input')).toHaveCount(1);
        await expect(section(page).locator('.material-where')).toHaveCount(3);
        await expect(section(page).locator('.material-row', { has: page.locator('.material-note-input') }).locator('.material-where')).toHaveText('In the tree');
        await expect(section(page).locator('.materials-all')).toHaveText('All materials ›');
        expect(material.asks).toContain('person=P0003');
        // The tree's attachments are untouched.
        expect(await page.evaluate((id) => window.Strom.DataManager.getPerson(id as never)!.attachments!.length, await janId(page))).toBe(2);
    });

    test('the first 6 rows, then "All materials of this person (8)" opens the window filtered', async ({ page }) => {
        await setup(page, { files: Array.from({ length: 8 }, (_, i) => materialFile(i + 1, { persons: ['P0003'] })) });
        await editJanModal(page);
        await expect(rows(page)).toHaveCount(6);
        const all = section(page).locator('.materials-all');
        await expect(all).toHaveText('All materials of this person (8) ›');
        await all.click();
        const win = page.locator('#materials-modal');
        await expect(win).toBeVisible();
        await expect(win).toHaveAttribute('data-person', 'P0003');
        await expect(win).toHaveAttribute('data-group', 'date');
        await expect(win.locator('#materials-title')).toHaveText('Materials');
        await page.keyboard.press('Escape');
        await expect(win).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
    });

    test('nothing yet: the empty state with "Add material…"', async ({ page }) => {
        await setup(page, { files: [materialFile(1, { persons: ['P0001'] })] });
        await editJanModal(page);
        await expect(rows(page)).toHaveCount(0);
        await expect(section(page).locator('.materials-empty')).toContainText('Originals are kept in the research.');
        await expect(section(page).locator('.materials-empty .materials-add')).toHaveText('Add material…');
        await expect(section(page).locator('.materials-all')).toHaveCount(0);
    });

    test('a person the research does not know yet (no REFN): the sentence and the tree\'s attachments only', async ({ page }) => {
        await setup(page, { files: [materialFile(1, { persons: ['P0003'] })] });
        const id = await page.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Petr', lastName: 'Nový', gender: 'male' }).id);
        await page.evaluate(({ id, px }) => {
            window.Strom.DataManager.addAttachment(id as never, { name: 'foto.png', mimeType: 'image/png', dataUrl: px, sizeBytes: 70 } as never);
            const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
            ui.pushDialog('person-modal');
            ui.showEditPersonModal(id);
        }, { id, px: PX });
        await expect(section(page)).toHaveAttribute('data-state', 'norefn');
        await expect(section(page).locator('.materials-note')).toHaveText('The research knows this person after the next tree save. Until then only tree attachments are shown.');
        await expect(rows(page)).toHaveCount(1);
    });

    test('a research without material.assign: read only — the ⋯ menu opens, no assigning nor hiding', async ({ page }) => {
        await setup(page, { features: ['material.list', 'material.thumb'], files: [materialFile(1, { persons: ['P0003'] })] });
        await editJanModal(page);
        await expect(rows(page)).toHaveCount(1);
        const more = rows(page).first().locator('.material-more');
        await more.click();
        const menu = page.locator('#materials-item-menu');
        await expect(menu).toBeVisible();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await expect(menu.locator('[data-action="open"]')).toBeVisible();
        await expect(menu.locator('[data-action="assign"], [data-action="hide"], [data-action="removeFromPerson"]')).toHaveCount(0);
        // Esc closes the menu only, the editor stays.
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
    });

    test('a research without material.list: today\'s attachments, no menu row, no "Materials" in the card\'s tooltip', async ({ page }) => {
        await setup(page, { features: [], before: page => attach(page, [{ name: 'foto.png' }]) });
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-story')).toHaveText('1 attachment');
        await editJanModal(page);
        await expect(section(page)).toBeHidden();
        await expect(page.locator('#attachments-section')).toBeVisible();
        await expect(page.locator('#attachments-section > label')).toHaveText('Attachments');
        await expect(page.locator('#btn-add-attachment')).toHaveText('Add attachment');
        await page.keyboard.press('Escape');
        await card(page, 'Jan').click();
        await expect(page.locator('.context-menu')).toBeVisible();
        await expect(page.locator('.context-menu [data-action="materials"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-materials')).toHaveCount(0);
    });

    test('the research stops: the remembered list with its time, the research\'s writes off', async ({ page }) => {
        const { bridge } = await setup(page, { files: [materialFile(1, { persons: ['P0003'] })] });
        // The whole list came with the first poll; the card says how many.
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-story')).toHaveText('Materials 1');
        bridge.down = true;
        await poll(page);
        await editJanModal(page);
        await expect(section(page)).toHaveAttribute('data-state', 'stale');
        await expect(section(page).locator('.materials-bar[role="status"]')).toContainText('The research is not running · state from');
        await expect(rows(page)).toHaveCount(1);
        await rows(page).first().locator('.material-more').click();
        const menu = page.locator('#materials-item-menu');
        await expect(menu.locator('[data-action="assign"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(menu.locator('[data-action="hide"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(menu.locator('[data-action="open"]')).not.toHaveAttribute('aria-disabled', 'true');
    });

    test('never listed and not running: "load once the research runs"', async ({ page }) => {
        await setup(page, {
            down: true,
            before: page => page.evaluate((uuid) => localStorage.setItem(`strom-material-features:${uuid}`, JSON.stringify(['material.list', 'material.assign', 'material.thumb'])), UUID),
        });
        await editJanModal(page);
        await expect(section(page)).toHaveAttribute('data-state', 'nocache');
        await expect(section(page).locator('.materials-bar')).toContainText('Materials from the archive load once the research runs.');
    });

    test('person menu "Materials N" opens the editor at the materials; the tooltip says "Materials N"', async ({ page }) => {
        await setup(page, { files: [materialFile(1, { persons: ['P0003'] }), materialFile(2, { persons: ['P0003'] })] });
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-story')).toHaveText('Materials 2');
        await card(page, 'Jan').click();
        const row = page.locator('.context-menu [data-action="materials"]');
        await expect(row).toContainText('Materials');
        await expect(row).toContainText('2');
        await row.click();
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(section(page)).toBeVisible();
        await expect(rows(page)).toHaveCount(2);
    });

    test('Research menu "Materials N" and the block\'s batch line open the window', async ({ page }) => {
        await setup(page, {
            files: [materialFile(1, { persons: ['P0003'] }), materialFile(2), materialFile(3, { hidden: { by: 'app' } })],
            statusBatches: [{ id: 'b-12345678', name: 'Matriky', state: 'closed', kept: true, at: new Date().toISOString(), files: 5, known: 0, refused: 0, sorted: 0 }],
        });
        await openResearchMenu(page, { expandMore: true });
        const item = page.locator('#research-item-materials');
        await expect(item).toContainText('2');
        await item.click();
        await expect(page.locator('#materials-modal')).toBeVisible();
        await page.locator('#materials-modal .close-btn').click();
        await expect(page.locator('#materials-modal')).toHaveCount(0);

        await openResearchMenu(page);
        await block(page).locator('.batch-line').getByText('Materials ›').click();
        await expect(page.locator('#materials-modal')).toHaveAttribute('data-batch', 'b-12345678');
    });

    test('the end of "Add materials…": Open in Materials opens the batch', async ({ page }) => {
        const { bridge } = await setup(page);
        await page.evaluate(() => (window.Strom.UI as unknown as { showBatchDialog(): void }).showBatchDialog());
        await page.evaluate(() => {
            const files = ['Krabice/a.jpg', 'Krabice/b.jpg'].map(path => ({ path, file: new File([`obsah ${path}`], path.split('/').pop()!, { type: 'image/jpeg' }) }));
            (window.Strom.UI as unknown as { addBatchFiles(f: unknown): void }).addBatchFiles(files);
        });
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        await dialog.getByRole('button', { name: 'Send 2 files' }).click();
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        await expect(dialog.locator('.batch-footer [data-act="close"]')).toHaveText('Close');
        await expect(dialog.locator('.batch-footer [data-act="open-research"]')).toHaveCount(1);
        await dialog.getByRole('button', { name: 'Open in Materials' }).click();
        await expect(dialog).toHaveCount(0);
        const id = bridge.mediaPuts[0].headers['x-strom-batch'];
        await expect(page.locator('#materials-modal')).toHaveAttribute('data-batch', id);
    });
});

test.describe('Add material… (Strom archive)', () => {
    test.use({ viewport: DESKTOP });

    const open = async (page: Page) => {
        await editJanModal(page);
        await section(page).locator('.materials-add').first().click();
        const dialog = page.locator('#material-modal');
        await expect(dialog.locator('h2')).toHaveText('Save material to the Strom archive');
        return dialog;
    };
    const janAttachments = async (page: Page) => page.evaluate((id) => window.Strom.DataManager.getPerson(id as never)!.attachments?.length ?? 0, await janId(page));

    test('"Also save to the tree" checked: the image goes to the archive and the tree; the toast shows it', async ({ page }) => {
        const { bridge, material } = await setup(page, { archive: true });
        const dialog = await open(page);
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        const box = dialog.locator('#material-attach');
        await expect(box).toBeChecked();
        await expect(dialog.locator('.material-attach')).toContainText('Also save to the tree');
        await expect(dialog.locator('.material-attach')).toContainText('(1 of 1)');
        const asked = material.asks.length;
        await dialog.getByRole('button', { name: 'Save 1 file' }).click();
        await expect(dialog).toHaveCount(0);
        const toast = page.locator('.toast').filter({ hasText: 'Saved to the Strom archive' });
        await expect(toast).toBeVisible();
        await expect(toast.getByRole('button', { name: 'Show' })).toBeVisible();
        expect(bridge.mediaPuts).toHaveLength(1);
        expect(bridge.mediaPuts[0].headers['x-strom-person']).toBe('P0003');
        expect(await janAttachments(page)).toBe(1);
        // The person's list is asked again quietly.
        await expect.poll(() => material.asks.slice(asked)).toContain('person=P0003');
    });

    test('unchecked: only the archive; the next opening has it checked again', async ({ page }) => {
        const { bridge } = await setup(page, { archive: true });
        const dialog = await open(page);
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await dialog.locator('#material-attach').uncheck();
        await dialog.getByRole('button', { name: 'Save 1 file' }).click();
        await expect(dialog).toHaveCount(0);
        expect(bridge.mediaPuts).toHaveLength(1);
        expect(await janAttachments(page)).toBe(0);
        const again = await open(page);
        await again.locator('#material-input').setInputFiles(AVATAR);
        await expect(again.locator('#material-attach')).toBeChecked();
    });

    test('the archive commits the file: its new head is the tree\'s own, no "newer version"', async ({ page }) => {
        const { bridge } = await setup(page, { archive: true });
        const dialog = await open(page);
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await dialog.locator('#material-attach').uncheck();
        await dialog.getByRole('button', { name: 'Save 1 file' }).click();
        await expect(dialog).toHaveCount(0);
        expect(bridge.mediaPuts).toHaveLength(1);
        expect(bridge.head).not.toBe(HEAD);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(bridge.head);
        await page.keyboard.press('Escape');
        await poll(page);
        await expect(dot(page)).toBeHidden();
        await openResearchMenu(page);
        await expect(block(page)).not.toHaveAttribute('data-state', 'newer');
        await expect(block(page)).toHaveAttribute('data-state', 'inSync');
    });

    test('its agent committed after the last ask: the new file\'s head is not taken, the newer version is offered', async ({ page }) => {
        const { bridge } = await setup(page, { archive: true });
        foreignCommit(bridge);
        const dialog = await open(page);
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await dialog.locator('#material-attach').uncheck();
        await dialog.getByRole('button', { name: 'Save 1 file' }).click();
        await expect(dialog).toHaveCount(0);
        expect(bridge.mediaPuts).toHaveLength(1);
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(HEAD);
        await page.keyboard.press('Escape');
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'newer');
    });

    test('a file over 2 MB: "Also save to the tree" is off and cannot be ticked', async ({ page }) => {
        await setup(page, { archive: true });
        const dialog = await open(page);
        const big = Buffer.concat([readFileSync(AVATAR), Buffer.alloc(2 * 1024 * 1024 + 10)]);
        await dialog.locator('#material-input').setInputFiles({ name: 'velky.png', mimeType: 'image/png', buffer: big });
        const box = dialog.locator('#material-attach');
        await expect(box).toBeDisabled();
        await expect(box).not.toBeChecked();
        await expect(dialog.locator('.material-attach')).toContainText('(0 of 1)');
    });

    test('person menu: "Add material…" in place of "Send material…"', async ({ page }) => {
        await setup(page, { archive: true });
        await card(page, 'Jan').click();
        const research = page.locator('.context-menu [data-menu="research"]');
        if (await research.count()) await research.click();
        await expect(page.locator('.context-menu, .context-submenu').getByText('Add material…').first()).toBeVisible();
        await expect(page.locator('.context-menu, .context-submenu').getByText('Send material…')).toHaveCount(0);
    });
});

test.describe('Materials on a touch device', () => {
    test.use({ viewport: { width: 800, height: 1000 }, hasTouch: true, isMobile: true });

    test('today\'s attachments under "Materials" with a sentence; no materials row in the menu', async ({ page }) => {
        await setup(page, { files: [materialFile(1, { persons: ['P0003'] })], before: page => attach(page, [{ name: 'foto.png' }]) });
        await editJanModal(page);
        await expect(section(page)).toBeHidden();
        await expect(page.locator('#attachments-section > label')).toHaveText('Materials');
        await expect(page.locator('#attachments-materials-note')).toHaveText('Materials from the research are shown in the app on the computer.');
        await expect(page.locator('#btn-add-attachment')).toHaveText('Add material…');
        await expect(page.locator('#attachments-list .attachment-item, #attachments-list > *')).not.toHaveCount(0);
        await page.evaluate(() => (window.Strom.UI as unknown as { closeModal?: () => void }).closeModal?.());
    });
});

test.describe('Removing a linked tree', () => {
    test.use({ viewport: DESKTOP });

    test('its remembered materials go from this browser; the research is not asked to change anything', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1, { persons: ['P0003'] })] });
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-story')).toHaveText('Materials 1');
        const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
        const stored = () => page.evaluate((treeId) => new Promise<boolean>((resolve) => {
            const req = indexedDB.open('strom-materials');
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('lists')) { db.close(); resolve(false); return; }
                const get = db.transaction('lists').objectStore('lists').get(treeId);
                get.onsuccess = () => { db.close(); resolve(!!get.result); };
                get.onerror = () => { db.close(); resolve(false); };
            };
            req.onerror = () => resolve(false);
        }), treeId);
        await expect.poll(stored).toBe(true);
        // The confirmation waits for its answer: started, not awaited.
        await page.evaluate((id) => { void window.Strom.UI.confirmDeleteTree(id); }, treeId);
        await page.locator('.modal-overlay.active').last().getByRole('button', { name: 'Delete tree' }).click();
        await expect.poll(stored).toBe(false);
        expect(material.assigns).toEqual([]);
        expect(material.hides).toEqual([]);
    });
});


test.describe('Materials follow the tree\'s attachments', () => {
    test.use({ viewport: DESKTOP });

    test('an attachment removed or brought back by Undo: the person\'s section and the Materials window at once', async ({ page }) => {
        await setup(page, { files: [materialFile(1, { persons: ['P0003'], title: 'Křestní list' })],
            before: page => attach(page, [{ name: 'a.png' }, { name: 'b.png' }]) });
        await editJanModal(page);
        await expect(rows(page)).toHaveCount(3);
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        const win = page.locator('#materials-modal');
        const treeCount = win.locator('.mw-canvas .mw-group', { has: page.locator('.mw-group-name', { hasText: 'In the tree' }) })
            .locator('.mw-group-count');
        await expect(treeCount).toHaveText('2');
        // From now on the research's list does not change (no answers): only the tree does.
        await page.route(url => url.href.startsWith(`${BRIDGE}/material`), () => { /* never answered */ });
        // Removed elsewhere: both follow.
        const id = await janId(page);
        await page.evaluate((id) => {
            const dm = window.Strom.DataManager;
            const att = dm.getPerson(id as never)!.attachments!.find(a => a.name === 'b.png')!;
            dm.removeAttachment(id as never, att.id);
        }, id);
        await expect(treeCount).toHaveText('1');
        await expect(rows(page)).toHaveCount(2);
        // Undo brings it back into both.
        await page.evaluate(() => (window.Strom.UI as unknown as { performUndo(): void }).performUndo());
        await expect(treeCount).toHaveText('2');
        await expect(rows(page)).toHaveCount(3);
    });
});
