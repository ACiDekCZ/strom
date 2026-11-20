import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE, HEAD,
    type FakeBridge, type FakeMaterial, type FakeMaterialFile,
} from './research-bridge.js';

/**
 * Family tree files in Materials (spec 117 §5, §6; the research's gate
 * `material.trees`): a tile and a list row with "Family tree file · size",
 * the tag of the source made of it, a Kind filter row only while there is
 * one, a menu of Details and Delete permanently… (a sheet from below on a
 * phone), Details without a preview, and Delete permanently… of a file no
 * source was made of (its letters in the head, no "Only hide"). Without the
 * gate the research is not asked for them. A file a live source was made of
 * goes to the two-part dialog (spec 117 §7): the source first, then the file,
 * one write (`retractSources`, one confirmation), the source gone from the
 * tree afterwards, a toast without Undo; a list changed meanwhile unticks the
 * box, a failed write deletes nothing. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0042: 'Ilsa Talvanenová (1901–1980)' };
const GATED = [...MATERIAL_FEATURES, 'material.delete', 'material.sourceOf', 'material.trees'];

const win = (page: Page) => page.locator('#materials-modal');
// By its label: on a phone a tile shows no title.
const tile = (page: Page, name: string) => win(page).locator(`.mw-canvas .mw-tile[aria-label^="${name}"]`);
const tiles = (page: Page) => win(page).locator('.mw-canvas .mw-tile');
const itemMenu = (page: Page) => page.locator('.mw-pop-itemMenu');
const viewer = (page: Page) => page.locator('#attachment-overlay');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg--delete');
const go = (page: Page) => dialog(page).locator('.mdlg-foot .mdlg-btn.is-danger');
const box = (page: Page) => dialog(page).locator('input[name="mdlg-delete-understand"]');
const toast = (page: Page) => page.locator('.toast[data-kind="materials"]');
const both = (page: Page) => page.locator('.mdlg-overlay .mdlg--both');
const bothGo = (page: Page) => both(page).locator('.mdlg-foot-acts .is-danger');
const bothBox = (page: Page) => both(page).locator('input[name="mdlg-delete-understand"]');
const part = (page: Page, which: 'source' | 'file') => both(page).locator(`.mdlg-part[data-part="${which}"]`);
const hasSource = (page: Page, refn: string) => page.evaluate(r => Object.values(window.Strom.DataManager.getData().sources ?? {}).some(s => s.refn === r), refn);

/** Delete permanently… of quellmayer.ged from its menu: the two-part dialog, both lists read. */
async function openBoth(page: Page): Promise<void> {
    await tile(page, 'quellmayer.ged').click();
    await itemMenu(page).locator('[data-action="delete"]').click();
    await expect(both(page)).toBeVisible();
    await expect(part(page, 'source')).toBeVisible();
}

/** Two photos, a family tree file no source was made of and one a live source was made of. */
function files(): FakeMaterialFile[] {
    return [
        materialFile(1, { persons: ['P0042'] }),
        materialFile(2),
        materialFile(3, { name: 'talvanen.ged', mime: 'text/plain', bytes: 62_000, kind: 'tree', state: 'processed' }),
        materialFile(4, {
            name: 'quellmayer.ged', mime: 'text/plain', bytes: 184_000, kind: 'tree', state: 'processed',
            uses: { excerpts: 0, sources: [], tasks: 0, of: [{ source: 'S0012', title: 'Quellmayer family tree 1990', via: 'input', inTree: true }] },
        }),
    ];
}

/** The source made of quellmayer.ged stands in the tree: its record and a citation on Jan's birth. */
const TREE_GED = researchGed(HEAD, ['1 BIRT', '2 DATE 1865', '2 SOUR @S0012@', '0 @S0012@ SOUR', '1 TITL Quellmayer family tree 1990', '1 REFN S0012']);
const SOURCE_TITLE = 'Quellmayer family tree 1990';

/** What deleting S0012 leaves behind, as the research lists it (`sourceImpacts`). */
const SOURCE_IMPACT = {
    id: 'S0012', title: SOURCE_TITLE, input: 'I0004',
    counts: { names: 0, events: 3, families: 0, stories: 0 },
    cites: [{ owner: 'P0003', fact: 'BIRT', others: 0, main: true }],
    stories: [], bare: [{ owner: 'P0003', fact: 'BIRT' }],
    lowered: [
        { owner: 'P0001', fact: 'BIRT', from: 'proven', to: 'probable' },
        { owner: 'P0002', fact: 'BIRT', from: 'proven', to: 'probable' },
    ],
    conflicts: [], tasks: [{ id: 'T0020', state: 'open', becomes: 'dropped' }], files: ['I0004'], images: 0, more: {},
};

let lastBridge: FakeBridge | null = null;

async function research(page: Page, features: string[], list: FakeMaterialFile[] = files(), init: Partial<FakeMaterial> = {}): Promise<FakeMaterial> {
    const material = fakeMaterial({ files: list, batches: [], people: PEOPLE, deleteSourceImpacts: { S0012: SOURCE_IMPACT }, ...init });
    lastBridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features, material, treeGed: TREE_GED });
    await openResearch(page, { media: true, ged: TREE_GED });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    return material;
}

test.describe('Family tree files in Materials (material.trees)', () => {
    test.use({ viewport: DESKTOP });

    test('a tile and a list row: the kind and size, the source tag, no places; the Kind filter row', async ({ page }) => {
        const material = await research(page, GATED);
        expect(material.asks.some(q => q.split('&').includes('trees=1'))).toBe(true);
        await expect(tiles(page)).toHaveCount(4);
        const plain = tile(page, 'talvanen.ged');
        await expect(plain.locator('.mw-tile-persons.is-tree')).toHaveText('Family tree file · 61 kB');
        await expect(plain.locator('.mw-places')).toHaveCount(0);
        await expect(plain.locator('.mw-type')).toHaveText('GED');
        const sourced = tile(page, 'quellmayer.ged');
        await expect(sourced.locator('.mw-tile-persons.is-tree .mw-srcof-tag')).toHaveText('File of a source');
        await expect(sourced.locator('.mw-tile-persons.is-tree')).toHaveText('File of a sourceFamily tree file · 180 kB');
        await expect(sourced.locator('.mw-places')).toHaveCount(0);
        await expect(sourced).toHaveAttribute('aria-label', /Family tree file · 180 kB, the file of the source Quellmayer family tree 1990/);
        // The file itself has no place in the tree, though the source made of it has (design 5a): no "In the tree".
        await expect(sourced.locator('.mw-intree')).toHaveCount(0);
        // The tag, the kind and the size whole, not cut to "Family…" (the row is taller for them).
        const whole = (loc: import('@playwright/test').Locator) => loc.evaluate(el => el.scrollHeight <= el.clientHeight + 1);
        expect(await whole(sourced.locator('.mw-tile-persons.is-tree'))).toBe(true);
        expect(await whole(plain.locator('.mw-tile-persons.is-tree'))).toBe(true);

        // The Kind filter: the row only because there is a family tree file.
        await win(page).locator('[data-mw="kind"]').click();
        const row = page.locator('.mw-pop-kind input[data-pop="kind"][value="tree"]');
        await expect(row).toHaveCount(1);
        await expect(page.locator('.mw-pop-kind .mw-check-row', { has: page.locator('input[value="tree"]') })).toHaveText('Family tree files');
        await row.check();
        await expect(tiles(page)).toHaveCount(2);
        await expect(win(page).locator('[data-mw="kind"]')).toContainText('Family tree files');
        await page.keyboard.press('Escape');

        // The list: its kind, its name with the size, no people, the source, used nowhere.
        await win(page).locator('[data-mw="view-list"]').click();
        const li = win(page).locator('.mw-li', { hasText: 'quellmayer.ged' });
        await expect(li.locator('.mw-li-kind')).toHaveText('Family tree file');
        await expect(li.locator('.mw-li-file')).toHaveText('quellmayer.ged · 180 kB');
        await expect(li.locator('.mw-li-source')).toContainText('Quellmayer family tree 1990');
        await expect(li.locator('.mw-li-used')).toHaveText('nowhere');
    });

    test('the menu: Details and Delete permanently… only; Details shows no preview and the source made of it', async ({ page }) => {
        await research(page, GATED);
        await tile(page, 'quellmayer.ged').click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(itemMenu(page).locator('[role="menuitem"]')).toHaveText(['Details', 'Delete permanently…']);
        await expect(itemMenu(page).locator('.materials-item-menu-divider + [data-action="delete"]')).toHaveCount(1);
        await expect(itemMenu(page).locator('[data-action="delete"]')).toHaveClass(/is-danger/);
        await expect(itemMenu(page).locator('.research-ai-badge, .research-open-mark')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(itemMenu(page)).toHaveCount(0);

        await tile(page, 'quellmayer.ged').click();
        await itemMenu(page).locator('[data-action="open"]').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(viewer(page).locator('.mv-card-tile')).toHaveText('GED');
        await expect(viewer(page).locator('.mv-card-tile img')).toHaveCount(0);
        await expect(panel(page).locator('.mv-uses-title')).toHaveText('What refers to the file');
        await expect(panel(page).locator('.mv-uses-treeof')).toHaveText('the file of the source Quellmayer family tree 1990');
        await expect(panel(page).locator('.mv-act')).toHaveCount(1);
        await expect(panel(page).locator('.mv-act')).toHaveAttribute('data-action', 'delete');
        await expect(panel(page).locator('.mv-act')).toHaveText('Delete permanently…');
    });

    test('Delete permanently… of a family tree file no source was made of: its letters, the archive alone, no Only hide', async ({ page }) => {
        const material = await research(page, GATED);
        await tile(page, 'talvanen.ged').click();
        await itemMenu(page).locator('[data-action="delete"]').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Delete permanently?');
        await expect(dialog(page).locator('.mdlg-head.has-thumb .mdlg-attach-type')).toHaveText('GED');
        await expect(dialog(page).locator('.mdlg-attach-thumb')).toHaveCount(0);
        await expect(dialog(page).locator('.mdlg-sub .mdlg-sub-file')).toHaveText('talvanen.ged');
        await expect(dialog(page).locator('.mdlg-delete-list .mdlg-note')).toHaveText('Nothing refers to the file: no source was made from it.');
        await expect(dialog(page).locator('.mdlg-text')).toHaveText('The family tree file is deleted from the research archive. This cannot be undone in the app.');
        await expect(dialog(page).locator('.mdlg-foot .link-button')).toHaveCount(0);
        await expect(go(page)).toBeDisabled();
        expect(material.deletes).toEqual([{ files: ['I0003'], dryRun: true }]);
        await box(page).check();
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(toast(page)).toContainText('Deleted permanently: 1 file.');
        await expect(tile(page, 'talvanen.ged')).toHaveCount(0);
        await expect(tiles(page)).toHaveCount(3);
        expect((material.deletes ?? []).filter(b => b.dryRun !== true)).toEqual([{ files: ['I0003'], confirm: 'confirm-1' }]);
    });

    test('two family tree files selected: only Delete permanently…, the sentence of several', async ({ page }) => {
        const list = [...files().slice(0, 3), materialFile(5, { name: 'ostrovid.ged', mime: 'text/plain', bytes: 9_000, kind: 'tree', state: 'processed' })];
        await research(page, GATED, list);
        await win(page).locator('[data-mw="select"]').click();
        await tile(page, 'talvanen.ged').click();
        await tile(page, 'ostrovid.ged').click();
        await expect(itemMenu(page)).toHaveCount(0);
        await win(page).locator('[data-mw="sel-more"]').click();
        await page.locator('.mw-pop-selMenu [data-action="sel-delete"]').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Delete 2 files permanently?');
        await expect(dialog(page).locator('.mdlg-text')).toHaveText('The family tree files are deleted from the research archive. This cannot be undone in the app.');
        await expect(dialog(page).locator('.mdlg-foot .link-button')).toHaveCount(0);
    });

    test('a file a live source was made of: the two-part dialog, both deleted in one write, the source gone from the tree, no Undo', async ({ page }) => {
        const material = await research(page, GATED);
        expect(await hasSource(page, 'S0012')).toBe(true);
        await openBoth(page);
        const d = both(page);
        await expect(d.locator('.mdlg-title')).toHaveText('Delete the source and the file?');
        await expect(d.locator('.mdlg-head.has-thumb .mdlg-attach-type')).toHaveText('GED');
        await expect(d.locator('.mdlg-sub .mdlg-sub-file')).toHaveText('quellmayer.ged');
        await expect(d.locator('.mdlg-body > .mdlg-text').first())
            .toHaveText(`The source ${SOURCE_TITLE} was made from this file. The file is deleted after the source, both at once.`);
        await expect(d.locator('.mdlg-changed')).toBeHidden();
        // 1. The source: its counts, the one warning, only what it leaves behind (one less certain fact shown).
        const src = part(page, 'source');
        await expect(src.locator('.mdlg-part-title')).toHaveText('First the source is deleted');
        await expect(src.locator('.mdlg-part-sub')).toHaveText(`${SOURCE_TITLE} · S0012`);
        await expect(src.locator('.mdlg-src-sum-parts')).toHaveText('events 3');
        await expect(d.locator('.mdlg-warn')).toHaveCount(1);
        await expect(src.locator('.mdlg-warn')).toHaveText('1 fact is left without a source. The facts stay, only without a citation.');
        await expect(src.locator('.mv-uses-head')).toHaveCount(0);
        await expect(src.locator('[data-retract-row]')).toHaveCount(3);
        await expect(src.locator('[data-retract-row="bare"]')).toContainText('Jan Fíšek');
        await expect(src.locator('[data-retract-row="lowered"] .mv-use-text')).toHaveText('2 facts become less certain');
        await expect(src.locator('[data-retract-row="lowered"] .mv-use-item')).toHaveCount(1);
        await expect(src.locator('[data-retract-row="lowered"] .mv-use-more')).toHaveText('and 1 more');
        await expect(src.locator('[data-retract-row="tasks"] [data-task]')).toHaveText('T0020');
        await expect(src.locator('[data-retract-row="cites"], [data-retract-row="files"]')).toHaveCount(0);
        await expect(src.locator('> .mdlg-note')).toHaveText('The source can be restored in the research later, but without the file.');
        // 2. The file: what refers to it, the sentence of the archive.
        const fil = part(page, 'file');
        await expect(fil.locator('.mdlg-part-title')).toHaveText('Then the file is deleted');
        await expect(fil.locator('.mdlg-part-sub')).toHaveText('quellmayer.ged · 180 kB');
        await expect(fil.locator('.mv-uses-title')).toHaveText('What refers to the file');
        await expect(fil.locator('[data-delete-row="source"]')).toHaveText(`${SOURCE_TITLE}deleted in the first step`);
        await expect(fil.locator('.mdlg-text')).toHaveText('The family tree file is deleted from the research archive. This cannot be undone in the app.');
        // One box, one danger button; no Only hide; through the bridge: no mark.
        await expect(d.locator('.mdlg-check')).toContainText('I understand the file cannot be brought back in the app');
        await expect(d.locator('.mdlg-foot .link-button')).toHaveCount(0);
        await expect(bothGo(page)).toHaveText('Delete source and file');
        await expect(bothGo(page).locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await expect(bothGo(page)).toBeDisabled();
        expect(material.deletes).toEqual([{ files: ['I0004'], retractSources: ['S0012'], dryRun: true }]);

        await bothBox(page).check();
        await bothGo(page).click();
        await expect(both(page)).toHaveCount(0);
        expect((material.deletes ?? []).filter(b => b.dryRun !== true)).toEqual([{ files: ['I0004'], retractSources: ['S0012'], confirm: 'confirm-1' }]);
        await expect(toast(page)).toContainText(`Deleted the source ${SOURCE_TITLE} and the file quellmayer.ged.`);
        await expect(toast(page).locator('.toast-action')).toHaveCount(0);
        await expect(tile(page, 'quellmayer.ged')).toHaveCount(0);
        await expect(tiles(page)).toHaveCount(3);
        // The research's new version loaded (a tied tree: the usual question), the source gone from the tree.
        expect(lastBridge!.treeGed).not.toContain('REFN S0012');
        await page.getByRole('dialog', { name: 'Load the research version?' }).getByRole('button', { name: 'Load' }).click();
        await expect.poll(() => hasSource(page, 'S0012')).toBe(false);
    });

    test('changed meanwhile: one sentence above both parts, the box unticked, the new list confirmed again', async ({ page }) => {
        const material = await research(page, GATED, files(), {
            deleteSourceChangeOnce: { S0012: { bare: [{ owner: 'P0003', fact: 'BIRT' }, { owner: 'P0001', fact: 'BIRT' }] } },
        });
        await openBoth(page);
        await bothBox(page).check();
        await bothGo(page).click();
        const changed = both(page).locator('.mdlg-changed');
        await expect(changed).toHaveText('What refers to the source and the file has changed meanwhile. The list below is new; the deletion needs to be confirmed again.');
        await expect(both(page).locator('.mdlg-changed')).toHaveCount(1);
        await expect(part(page, 'source').locator('.mdlg-warn')).toHaveText('2 facts are left without a source. The facts stay, only without a citation.');
        await expect(bothBox(page)).not.toBeChecked();
        await expect(bothGo(page)).toBeDisabled();
        expect(await hasSource(page, 'S0012')).toBe(true);
        await expect(tile(page, 'quellmayer.ged')).toHaveCount(1);
        // Asked again: a new confirmation of the new list.
        await expect.poll(() => (material.deletes ?? []).filter(b => b.dryRun === true).length).toBe(2);
        await bothBox(page).check();
        await bothGo(page).click();
        await expect(both(page)).toHaveCount(0);
        expect((material.deletes ?? []).filter(b => b.dryRun !== true).map(b => b.confirm)).toEqual(['confirm-1', 'confirm-2']);
        await expect(toast(page)).toContainText(`Deleted the source ${SOURCE_TITLE}`);
    });

    test('a failed write (500): nothing deleted, said so, Try again sends the same confirmation', async ({ page }) => {
        const material = await research(page, GATED, files(), { deleteFailOnce: { status: 500, body: { error: 'failed', code: 'material.failed', text: 'failed' } } });
        await openBoth(page);
        await bothBox(page).check();
        await bothGo(page).click();
        const err = both(page).locator('.mdlg-error');
        await expect(err).toContainText('Writing to the research failed. Nothing was deleted.');
        // Atomic: the file and the source are both still there.
        await expect(tile(page, 'quellmayer.ged')).toHaveCount(1);
        expect(lastBridge!.treeGed).toContain('REFN S0012');
        expect(await hasSource(page, 'S0012')).toBe(true);
        await expect(bothBox(page)).toBeChecked();
        await err.getByRole('button', { name: 'Try again' }).click();
        await expect(both(page)).toHaveCount(0);
        expect((material.deletes ?? []).filter(b => b.dryRun !== true).map(b => b.confirm)).toEqual(['confirm-1', 'confirm-1']);
        await expect(tile(page, 'quellmayer.ged')).toHaveCount(0);
    });

    test('the source deleted elsewhere already (409 source.retracted): said, Reload, the danger button gone', async ({ page }) => {
        const material = await research(page, GATED);
        await openBoth(page);
        // The research's tree loses the source in between (deleted with another window).
        lastBridge!.treeGed = lastBridge!.treeGed.replace(/0 @S0012@ SOUR\n1 TITL [^\n]*\n1 REFN S0012\n/, '');
        material.deleteRetracted = ['S0012'];
        await bothBox(page).check();
        await bothGo(page).click();
        await expect(both(page).locator('.mdlg-error')).toContainText('The source is already retracted in the research.');
        await expect(bothGo(page)).toBeHidden();
        await expect(both(page).locator('.mdlg-error').getByRole('button', { name: 'Reload' })).toBeVisible();
        await expect(tile(page, 'quellmayer.ged')).toHaveCount(1);
    });

    test('without the gate the research is not asked for family tree files, nor is there a Kind row', async ({ page }) => {
        const material = await research(page, [...MATERIAL_FEATURES, 'material.delete', 'material.sourceOf']);
        expect(material.asks.some(q => q.split('&').includes('trees=1'))).toBe(false);
        await expect(tiles(page)).toHaveCount(2);
        await win(page).locator('[data-mw="kind"]').click();
        await expect(page.locator('.mw-pop-kind input[data-pop="kind"]').first()).toBeVisible();
        await expect(page.locator('.mw-pop-kind input[value="tree"]')).toHaveCount(0);
    });
});

test.describe('Family tree files on a narrow screen', () => {
    // A touch phone shows the research's material only on the computer (the window's note); the width alone here.
    test.use({ viewport: PHONE });

    test('a tap opens the sheet from below; Delete permanently… of a file no source was made of opens the dialog with its letters', async ({ page }) => {
        await research(page, GATED);
        // A phone shows no texts under a tile, a family tree file's neither (its row has no room for them).
        await expect(tile(page, 'talvanen.ged').locator('.mw-tile-persons')).toBeHidden();
        // The file a source was made of: the sheet names the source (its Delete permanently… is the two-part dialog's, below).
        await tile(page, 'quellmayer.ged').click();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet.locator('.bottom-sheet-menu-title')).toHaveText('quellmayer.ged');
        await expect(sheet.locator('.bottom-sheet-menu-sub')).toHaveText('Family tree file · 180 kB · the file of the source Quellmayer family tree 1990');
        await expect(sheet.locator('.bottom-sheet-item .bottom-sheet-label')).toHaveText(['Details', 'Delete permanently…']);
        await expect(sheet.locator('.bottom-sheet-item.danger')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);

        // The plain one: the sheet without the source, the dialog of the file alone.
        await tile(page, 'talvanen.ged').click();
        await expect(sheet.locator('.bottom-sheet-menu-title')).toHaveText('talvanen.ged');
        await expect(sheet.locator('.bottom-sheet-menu-sub')).toHaveText('Family tree file · 61 kB');
        await sheet.locator('.bottom-sheet-item.danger').click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).not.toHaveClass(/mdlg--both/);
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Delete permanently?');
        await expect(dialog(page).locator('.mdlg-attach-type')).toHaveText('GED');
        // The dialog a sheet from below, its letters beside the title.
        const sheetBox = await dialog(page).boundingBox();
        expect(sheetBox!.width).toBe(PHONE.width);
        expect(Math.round(sheetBox!.y + sheetBox!.height)).toBe(PHONE.height);
        const type = await dialog(page).locator('.mdlg-attach-type').boundingBox();
        const title = await dialog(page).locator('.mdlg-title').boundingBox();
        expect(type!.x + type!.width).toBeLessThan(title!.x);
        await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog(page)).toHaveCount(0);

        // The Filters sheet with the Kind row.
        await win(page).locator('[data-mw="sheet"]').click();
        await expect(page.locator('.mw-pop-sheet input[data-pop="kind"][value="tree"]')).toHaveCount(1);
    });

    test('the two-part dialog a sheet from below: both parts one under the other with their headings, nothing too wide', async ({ page }) => {
        await research(page, GATED);
        await tile(page, 'quellmayer.ged').click();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item.danger').click();
        await expect(part(page, 'file')).toBeVisible();
        const sheetBox = await both(page).boundingBox();
        expect(sheetBox!.width).toBe(PHONE.width);
        expect(Math.round(sheetBox!.y + sheetBox!.height)).toBe(PHONE.height);
        await expect(part(page, 'source').locator('.mdlg-part-title')).toBeVisible();
        const a = await part(page, 'source').boundingBox();
        const b = await part(page, 'file').boundingBox();
        expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height - 1);
        expect(Math.abs(a!.x - b!.x)).toBeLessThan(1);
        expect(await both(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        // Cancel and the danger button side by side.
        const cancel = await both(page).getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
        const go2 = await bothGo(page).boundingBox();
        expect(Math.abs(cancel!.y - go2!.y)).toBeLessThan(2);
    });
});
