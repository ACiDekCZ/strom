import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE,
    type FakeMaterial, type FakeMaterialFile,
} from './research-bridge.js';

/**
 * Delete permanently (spec 102 §9, K1.17; the research's gate
 * `material.delete`, V3): only through the dialog that shows the count, the
 * previews and what refers to the files as the research's dry run says it;
 * the danger button works only once "cannot be undone in the app" is
 * ticked; a list that changed meanwhile (409 `material.delete-changed`) is
 * shown again and asks again; never a deletion without the dry run's
 * confirmation. At the end of the selection's ⋯ and the viewer's actions
 * (a narrow screen: the viewer under All details); without the gate nowhere.
 * Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0042: 'Ilsa Talvanenová (1901–1980)', P0043: 'Aaro Quellmayer (1898–1960)' };
const GATED = [...MATERIAL_FEATURES, 'material.delete'];

const win = (page: Page) => page.locator('#materials-modal');
const tile = (page: Page, text: string) => win(page).locator('.mw-canvas .mw-tile', { hasText: text });
const tiles = (page: Page) => win(page).locator('.mw-canvas .mw-tile');
const viewer = (page: Page) => page.locator('#attachment-overlay');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const act = (page: Page, id: string) => panel(page).locator(`.mv-act[data-action="${id}"]`);
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg--delete');
const go = (page: Page) => dialog(page).locator('.mdlg-foot .mdlg-btn.is-danger');
const box = (page: Page) => dialog(page).locator('input[name="mdlg-delete-understand"]');
const toast = (page: Page) => page.locator('.toast[data-kind="materials"]');

async function research(page: Page, features: string[], files: FakeMaterialFile[], init: Partial<FakeMaterial> = {}): Promise<FakeMaterial> {
    const material = fakeMaterial({ files, batches: [], people: PEOPLE, ...init });
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

/** Every deletion carried the confirmation of the dry run right before it: never one without the list shown. */
function expectOnlyConfirmed(material: FakeMaterial): void {
    let dry = 0;
    for (const body of material.deletes ?? []) {
        if (body.dryRun === true) { dry++; continue; }
        expect(dry, 'a deletion before any dry run').toBeGreaterThan(0);
        expect(body.confirm).toBe(`confirm-${dry}`);
    }
}

const confirmations = (material: FakeMaterial) => (material.deletes ?? []).filter(b => b.dryRun !== true);

async function viewTile(page: Page, text: string): Promise<void> {
    await tile(page, text).click();
    await expect(viewer(page)).toHaveClass(/active/);
}

test.describe('Delete permanently (material.delete)', () => {
    test.use({ viewport: DESKTOP });

    test('one file from the viewer: the last action, nothing refers to it, the box before the button, no Undo', async ({ page }) => {
        const material = await research(page, GATED, [1, 2, 3].map(n => materialFile(n)));
        await viewTile(page, 'scan-3.jpg');
        // The last of the viewer's actions, in the danger tone, without any mark.
        await expect(panel(page).locator('.mv-act').last()).toHaveAttribute('data-action', 'delete');
        await expect(act(page, 'delete')).toHaveText('Delete permanently…');
        await expect(act(page, 'delete')).toHaveClass(/is-danger/);
        await expect(act(page, 'delete').locator('.research-ai-badge, .research-open-mark')).toHaveCount(0);
        await act(page, 'delete').click();

        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Delete permanently?');
        await expect(dialog(page).locator('.mdlg-sub')).toHaveText('scan-3.jpg');
        await expect(dialog(page).locator('.mdlg-delete-list .mdlg-note')).toHaveText('Nothing refers to the file: it is not a source’s file, an attachment or a portrait.');
        await expect(dialog(page).locator('.mdlg-text')).toHaveText('The file is deleted from the research’s archive and from the tree. This cannot be undone in the app.');
        await expect(dialog(page).locator('.mdlg-check-text')).toContainText('I understand that deleting cannot be undone in the app');
        await expect(dialog(page).locator('.mdlg-check-hint')).toHaveText('The file stays only in earlier backups of the research. Neither the agent nor the tree ever delete on their own.');
        await expect(dialog(page).locator('.mdlg-foot .link-button')).toHaveText('Only hide – can be undone');
        await expect(dialog(page).getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
        // The box is the condition: the button works only while it is ticked.
        await expect(go(page)).toHaveText('Delete permanently');
        await expect(go(page)).toBeDisabled();
        await box(page).check();
        await expect(go(page)).toBeEnabled();
        await box(page).uncheck();
        await expect(go(page)).toBeDisabled();
        // Only the dry run so far: nothing deleted while the list is shown.
        expect(material.deletes).toEqual([{ files: ['I0003'], dryRun: true }]);

        await box(page).check();
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(toast(page)).toContainText('Deleted permanently: 1 file.');
        await expect(toast(page).getByRole('button', { name: 'Undo' })).toHaveCount(0);
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(tile(page, 'scan-3.jpg')).toHaveCount(0);
        await expect(tiles(page)).toHaveCount(2);
        expect(confirmations(material)).toHaveLength(1);
        expectOnlyConfirmed(material);
    });

    test('12 files from the selection: the last item of ⋯, previews, how many refer to something; Cancel deletes nothing', async ({ page }) => {
        const files = Array.from({ length: 13 }, (_, k) => materialFile(k + 1));
        const material = await research(page, GATED, files, {
            deleteImpacts: {
                I0002: { links: 1 },
                I0005: { sources: [{ id: 'S0007', title: 'Sčítání lidu Ostrovid 1921', via: 'media', citedCount: 1 }], excerpts: 2 },
            },
        });
        await win(page).locator('[data-mw="select"]').click();
        for (let k = 1; k <= 12; k++) await tile(page, `scan-${k}.jpg`).click();
        await win(page).locator('[data-mw="sel-more"]').click();
        const menu = page.locator('.mw-pop-selMenu');
        const item = menu.locator('[data-action="sel-delete"]');
        await expect(item).toHaveText('Delete permanently…');
        await expect(item).toHaveClass(/is-danger/);
        // The last item, after a divider of its own.
        await expect(menu.locator('[data-action]').last()).toHaveAttribute('data-action', 'sel-delete');
        await expect(menu.locator('.materials-item-menu-divider + [data-action="sel-delete"]')).toHaveCount(1);
        await item.click();

        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Delete 12 files permanently?');
        await expect(dialog(page).locator('.mdlg-sort-preview')).toHaveCount(5);
        await expect(dialog(page).locator('.mdlg-sort-more')).toHaveText('and 7 more');
        const warn = dialog(page).locator('[data-delete-warn]');
        await expect(warn.locator('b')).toHaveText('2 of 12 files refer to something.');
        await expect(warn).toContainText('A source loses its image of the same content; its text and citations stay. 2 excerpts disappear. 1 place in the tree goes with the tree’s next version from the research.');
        await expect(dialog(page).locator('.mv-uses-title')).toHaveText('What refers to the files');
        await expect(dialog(page).locator('.mv-uses-count')).toHaveText('1 source · 2 excerpts · 1 place in the tree');
        await expect(go(page)).toHaveText('Delete permanently (12)');
        await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog(page)).toHaveCount(0);
        expect(confirmations(material)).toHaveLength(0);
        await expect(tiles(page)).toHaveCount(13);

        await win(page).locator('[data-mw="sel-more"]').click();
        await page.locator('.mw-pop-selMenu [data-action="sel-delete"]').click();
        await box(page).check();
        await go(page).click();
        await expect(toast(page)).toContainText('Deleted permanently: 12 files.');
        await expect(win(page).locator('.mw-selbar')).toBeHidden();
        await expect(tiles(page)).toHaveCount(1);
        expect((confirmations(material)[0].files as string[]).sort()).toEqual(files.slice(0, 12).map(f => f.id).sort());
        expectOnlyConfirmed(material);
    });

    test('the file of a source: the warning and the list of what refers to it', async ({ page }) => {
        const material = await research(page, GATED, [materialFile(17, { name: 'sken-017.jpg', persons: ['P0042'] })], {
            deleteImpacts: {
                I0017: {
                    sources: [{ id: 'S0001', title: 'Matrika narozených Talvany 1895–1910', via: 'input', citedCount: 3 }],
                    excerpts: 3, links: 1, tasks: ['t-ostrovid'],
                },
            },
        });
        await viewTile(page, 'sken-017.jpg');
        await act(page, 'delete').click();
        const warn = dialog(page).locator('[data-delete-warn]');
        await expect(warn.locator('b')).toHaveText('The file is the file of the source Matrika narozených Talvany 1895–1910.');
        await expect(warn).toContainText('The source stays, only without its file. 3 excerpts disappear.');
        await expect(dialog(page).locator('.mv-uses-title')).toHaveText('What refers to the file');
        await expect(dialog(page).locator('.mv-uses-count')).toHaveText('1 source · 3 excerpts · 1 person · 1 place in the tree · 1 task');
        const rows = dialog(page).locator('.mv-uses-grid .mv-use-main');
        await expect(rows).toHaveText([
            'Matrika narozených Talvany 1895–1910stays, only without its file · Cited by 3 people',
            '3 excerpts from this filedeleted with it',
            '1 place in the treethe tree’s next version from the research takes them off',
            'Ilsa Talvanenováthe file leaves their materials',
            '1 taskthe file leaves them; a task with no other file is given up',
        ]);
        await expect(dialog(page).locator('.mv-use-type')).toHaveText(['Source', 'Excerpts', 'Tree', 'Person', 'Tasks']);
        // A dialog that deletes for good never leads elsewhere: the names are plain.
        await expect(dialog(page).locator('.mv-use-link')).toHaveCount(0);
        await box(page).check();
        await go(page).click();
        await expect(toast(page)).toContainText('Deleted permanently: 1 file.');
        expectOnlyConfirmed(material);
    });

    test('the list changed meanwhile (409): the new list, the box unticked, asked again', async ({ page }) => {
        const material = await research(page, GATED, [materialFile(3)], {
            deleteChangeOnce: { I0003: { links: 2 } },
        });
        await viewTile(page, 'scan-3.jpg');
        await act(page, 'delete').click();
        await expect(dialog(page).locator('.mdlg-delete-list .mdlg-note')).toHaveText('Nothing refers to the file: it is not a source’s file, an attachment or a portrait.');
        await box(page).check();
        await go(page).click();

        await expect(dialog(page).locator('.mdlg-delete-note')).toHaveText('What refers to the files changed meanwhile. The list below is new; deleting has to be confirmed again.');
        await expect(dialog(page).locator('.mv-uses-count')).toHaveText('2 places in the tree');
        await expect(box(page)).not.toBeChecked();
        await expect(go(page)).toBeDisabled();
        // A new dry run for the new list's confirmation; nothing deleted.
        await expect.poll(() => material.deletes?.length).toBe(3);
        expect(material.files).toHaveLength(1);
        await box(page).check();
        await expect(go(page)).toBeEnabled();
        await go(page).click();
        await expect(toast(page)).toContainText('Deleted permanently: 1 file.');
        expect(material.files).toHaveLength(0);
        expect(confirmations(material)).toHaveLength(2);
        expectOnlyConfirmed(material);
    });

    test('without the gate: neither the viewer nor the selection offers it', async ({ page }) => {
        const material = await research(page, MATERIAL_FEATURES, [1, 2].map(n => materialFile(n)));
        await viewTile(page, 'scan-1.jpg');
        await expect(panel(page).locator('.mv-act').first()).toBeVisible();
        await expect(act(page, 'delete')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(viewer(page)).not.toHaveClass(/active/);
        await win(page).locator('[data-mw="select"]').click();
        await tile(page, 'scan-1.jpg').click();
        await win(page).locator('[data-mw="sel-more"]').click();
        await expect(page.locator('.mw-pop-selMenu [data-action]').first()).toBeVisible();
        await expect(page.locator('.mw-pop-selMenu [data-action="sel-delete"]')).toHaveCount(0);
        expect(material.deletes ?? []).toHaveLength(0);
    });
});

test.describe('Delete permanently on a narrow screen', () => {
    // A touch phone shows the research's material only on the computer (the window's note); the width alone here.
    test.use({ viewport: PHONE });

    test('the viewer\'s last action under All details; the dialog a sheet from below, Only hide under the buttons', async ({ page }) => {
        const material = await research(page, GATED, [materialFile(4, { persons: ['P0043'] })]);
        await viewTile(page, 'scan-4.jpg');
        await expect(act(page, 'delete')).toBeHidden();
        await panel(page).locator('.mv-more').click();
        await expect(act(page, 'delete')).toBeVisible();
        await expect(panel(page).locator('.mv-act').last()).toHaveAttribute('data-action', 'delete');
        await act(page, 'delete').click();
        await expect(dialog(page).locator('.mv-uses-count')).toHaveText('1 person');
        const sheet = await dialog(page).boundingBox();
        expect(sheet!.x).toBe(0);
        expect(sheet!.width).toBe(PHONE.width);
        expect(Math.round(sheet!.y + sheet!.height)).toBe(PHONE.height);
        const cancel = await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
        const del = await go(page).boundingBox();
        const hide = await dialog(page).locator('.mdlg-foot .link-button').boundingBox();
        expect(Math.round(cancel!.y)).toBe(Math.round(del!.y));
        expect(cancel!.x).toBeLessThan(del!.x);
        expect(hide!.y).toBeGreaterThan(del!.y + del!.height - 1);
        expect(del!.height).toBeGreaterThanOrEqual(44);
        await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
        await box(page).check();
        await go(page).click();
        await expect(toast(page)).toContainText('Deleted permanently: 1 file.');
        expectOnlyConfirmed(material);
    });
});
