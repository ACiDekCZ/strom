import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE,
    type FakeMaterial, type FakeMaterialFile,
} from './research-bridge.js';

/**
 * Family tree files in Materials (spec 117 §5, §6; the research's gate
 * `material.trees`): a tile and a list row with "Family tree file · size",
 * the tag of the source made of it, a Kind filter row only while there is
 * one, a menu of Details and Delete permanently… (a sheet from below on a
 * phone), Details without a preview, and Delete permanently… of a file no
 * source was made of (its letters in the head, no "Only hide"). Without the
 * gate the research is not asked for them. Invented data.
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

async function research(page: Page, features: string[], list: FakeMaterialFile[] = files()): Promise<FakeMaterial> {
    const material = fakeMaterial({ files: list, batches: [], people: PEOPLE });
    await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
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

    test('a tap opens the sheet from below; Delete permanently… opens the dialog with its letters', async ({ page }) => {
        await research(page, GATED);
        await tile(page, 'quellmayer.ged').click();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet.locator('.bottom-sheet-menu-title')).toHaveText('quellmayer.ged');
        await expect(sheet.locator('.bottom-sheet-menu-sub')).toHaveText('Family tree file · 180 kB · the file of the source Quellmayer family tree 1990');
        await expect(sheet.locator('.bottom-sheet-item .bottom-sheet-label')).toHaveText(['Details', 'Delete permanently…']);
        await expect(sheet.locator('.bottom-sheet-item.danger')).toHaveCount(1);
        await sheet.locator('.bottom-sheet-item.danger').click();
        await expect(dialog(page)).toBeVisible();
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

        // The plain one: the sheet without the source, the Filters sheet with the Kind row.
        await tile(page, 'talvanen.ged').click();
        await expect(sheet.locator('.bottom-sheet-menu-sub')).toHaveText('Family tree file · 61 kB');
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await win(page).locator('[data-mw="sheet"]').click();
        await expect(page.locator('.mw-pop-sheet input[data-pop="kind"][value="tree"]')).toHaveCount(1);
    });
});
