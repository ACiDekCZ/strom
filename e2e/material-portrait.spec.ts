import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, materialSha, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE,
    FakeBridge, FakeMaterial, FakeMaterialFile,
} from './research-bridge.js';

/**
 * A portrait from a picture of the research the person is named in (1121):
 * "Use as portrait…" in the ⋯ of the person's Materials and in the viewer
 * opened for the person; the editor over the working copy from the bridge,
 * and only Done (in the person dialog: Save) makes the file the tree's file
 * at the person, in one undo step. A photo of two people: one file, two
 * crops. The bridge down / an older research / a failed download. "Link
 * to…" opened for a person chooses them. Removing a person from a file keeps
 * the portrait cut from it. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };
const WEDDING_SHA = materialSha('I0001');

/** The wedding photo of Josef and Anna (only in the research), and a letter (a PDF) of Josef. */
const FILES = (): FakeMaterialFile[] => [
    materialFile(1, { persons: ['P0001', 'P0002'], title: 'Svatba' }),
    materialFile(2, { persons: ['P0001'], title: 'Dopis', name: 'dopis.pdf', mime: 'application/pdf' }),
];

async function setup(page: Page, opts: { features?: string[]; files?: FakeMaterialFile[] } = {}): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({ files: opts.files ?? FILES(), batches: [], people: PEOPLE });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: opts.features ?? MATERIAL_FEATURES, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    return { bridge, material };
}

const personId = (page: Page, first: string) => page.evaluate((first) =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);

async function editModal(page: Page, first: string): Promise<void> {
    const id = await personId(page, first);
    await page.evaluate((id) => {
        const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
        ui.pushDialog('person-modal');
        ui.showEditPersonModal(id);
    }, id);
    await expect(page.locator('#person-modal')).toBeVisible();
}

/** A person's portrait and the tree's files with whom they are at. */
const stored = (page: Page, first: string) => page.evaluate((first) => {
    const dm = window.Strom.DataManager;
    const p = dm.getAllPersons().find(x => x.firstName === first)!;
    const media = (Object.values(dm.getData().media ?? {}) as { id: string; places: { personId?: string }[]; original?: { sha256: string }; removed?: unknown }[])
        .map(a => ({ id: a.id, persons: a.places.map(pl => pl.personId), sha: a.original?.sha256 ?? null }));
    return { photo: p.photo ?? null, source: (p.photoSource ?? null) as { attachmentId?: string; region?: { x: number; y: number; w: number; h: number } } | null, media };
}, first);

const section = (page: Page) => page.locator('#materials-section');
const row = (page: Page, text: string) => section(page).locator('.material-row:not(.is-skeleton)', { hasText: text });
const menuItem = (page: Page, id: string) => page.locator(`#materials-item-menu [data-action="${id}"]`);
const win = (page: Page) => page.locator('#materials-modal');
const tile = (page: Page, text: string) => win(page).locator('.mw-canvas .mw-tile', { hasText: text });
const viewer = (page: Page) => page.locator('#attachment-overlay');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const act = (page: Page, id: string) => panel(page).locator(`.mv-act[data-action="${id}"]`);
const editor = (page: Page) => page.locator('.pe-overlay');
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg');
const toast = (page: Page) => page.locator('.toast[data-kind="materials"]');

/** The Materials window filtered to a person, one of its files in the viewer. */
async function viewFor(page: Page, refn: string, text: string): Promise<void> {
    await page.evaluate((refn) => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({ person: refn }), refn);
    await expect(win(page)).toBeVisible();
    await tile(page, text).click();
    await expect(viewer(page)).toHaveClass(/active/);
    await expect(panel(page).locator('.mv-title')).toBeVisible();
}

async function closeWindow(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { closeMaterials(): void }).closeMaterials());
    await expect(win(page)).toHaveCount(0);
}

test.describe('Use as portrait… on a picture of the research (1121)', () => {
    test.use({ viewport: DESKTOP });

    test('the person dialog: in the ⋯ of a picture the research names them in (not a PDF); Cancel writes nothing; Done waits for Save, which links the file', async ({ page }) => {
        const { material } = await setup(page);
        await editModal(page, 'Josef');
        await expect(row(page, 'Svatba')).toBeVisible();
        await row(page, 'Dopis').locator('.material-more').click();
        await expect(menuItem(page, 'removeFromPerson')).toBeVisible();
        await expect(menuItem(page, 'useAsPortrait')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await row(page, 'Svatba').locator('.material-more').click();
        await expect(menuItem(page, 'useAsPortrait')).toHaveText('Use as portrait…');
        await expect(menuItem(page, 'useAsPortrait')).not.toHaveAttribute('aria-disabled', 'true');
        await menuItem(page, 'useAsPortrait').click();
        await expect(editor(page)).toBeVisible();
        await editor(page).getByRole('button', { name: 'Cancel' }).first().click();
        await expect(editor(page)).toHaveCount(0);
        expect((await stored(page, 'Josef')).media).toEqual([]);

        await row(page, 'Svatba').locator('.material-more').click();
        await menuItem(page, 'useAsPortrait').click();
        await expect(editor(page)).toBeVisible();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(editor(page)).toHaveCount(0);
        // Waiting for Save: nothing in the tree yet.
        let s = await stored(page, 'Josef');
        expect(s.media).toEqual([]);
        expect(s.photo).toBeNull();
        await page.locator('#person-modal').getByRole('button', { name: 'Save' }).click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        s = await stored(page, 'Josef');
        const josef = await personId(page, 'Josef');
        expect(s.media).toEqual([{ id: expect.any(String), persons: [josef], sha: WEDDING_SHA }]);
        expect(s.photo).toMatch(/^data:image\//);
        expect(s.source?.attachmentId).toBe(s.media[0].id);
        // The tree's own write: the research is not written.
        expect(material.assigns).toHaveLength(0);
    });

    test('the viewer of the window filtered to a person: Done writes the portrait and the file at once, one Undo takes both', async ({ page }) => {
        await setup(page);
        await viewFor(page, 'P0002', 'Svatba');
        await expect(act(page, 'useAsPortrait')).toHaveText('Use as portrait…');
        await expect(act(page, 'useAsPortrait')).not.toHaveAttribute('aria-disabled', 'true');
        await act(page, 'useAsPortrait').click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(editor(page)).toBeVisible();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        const pill = page.locator('.undo-toast', { hasText: 'Portrait updated.' });
        await expect(pill).toBeVisible();
        const anna = await personId(page, 'Anna');
        let s = await stored(page, 'Anna');
        expect(s.media).toEqual([{ id: expect.any(String), persons: [anna], sha: WEDDING_SHA }]);
        expect(s.source?.attachmentId).toBe(s.media[0].id);
        await pill.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(async () => (await stored(page, 'Anna')).photo).toBeNull();
        s = await stored(page, 'Anna');
        expect(s.media).toEqual([]);
    });

    test('a photo of two people: the second portrait is cut from the same file of the tree (one more place), even with the research stopped', async ({ page }) => {
        const { bridge } = await setup(page);
        await viewFor(page, 'P0001', 'Svatba');
        await act(page, 'useAsPortrait').click();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(page.locator('.undo-toast', { hasText: 'Portrait updated.' })).toBeVisible();
        await closeWindow(page);

        bridge.down = true;
        await poll(page);
        await viewFor(page, 'P0002', 'Svatba');
        await expect(act(page, 'useAsPortrait')).not.toHaveAttribute('aria-disabled', 'true');
        await act(page, 'useAsPortrait').click();
        await expect(editor(page)).toBeVisible();
        // Another crop: zoomed in and moved.
        await page.keyboard.press('+');
        await page.keyboard.press('+');
        await editor(page).locator('.pe-frame').focus();
        await page.keyboard.press('Shift+ArrowRight');
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(editor(page)).toHaveCount(0);

        const josef = await stored(page, 'Josef');
        const anna = await stored(page, 'Anna');
        expect(anna.media).toHaveLength(1);
        expect(anna.media[0].persons).toEqual([await personId(page, 'Josef'), await personId(page, 'Anna')]);
        expect(anna.source?.attachmentId).toBe(anna.media[0].id);
        expect(josef.source?.attachmentId).toBe(anna.media[0].id);
        expect(anna.source?.region).not.toEqual(josef.source?.region);
    });

    test('the research stopped: off for a file only in the research, nothing written', async ({ page }) => {
        const { bridge, material } = await setup(page);
        // The rows come from the list remembered while the bridge ran: the poll asks for it without waiting
        // for it, so a loaded machine turned the bridge off before the list was asked (no rows to open).
        await expect.poll(() => material.asks.some(q => !/(^|&)(person|batch|files0)=/.test(q))).toBe(true);
        bridge.down = true;
        await poll(page);
        await editModal(page, 'Josef');
        await row(page, 'Svatba').locator('.material-more').click();
        await expect(menuItem(page, 'useAsPortrait')).toHaveAttribute('aria-disabled', 'true');
        await expect(menuItem(page, 'useAsPortrait')).toHaveAttribute('title', 'Linking, hiding and editing material outside the tree works while the research runs.');
        await menuItem(page, 'useAsPortrait').click({ force: true });
        await expect(editor(page)).toHaveCount(0);
        expect((await stored(page, 'Josef')).media).toEqual([]);
    });

    test('an older research without assigning: Use as portrait… is not offered, without an error', async ({ page }) => {
        // (Without titles from the research the file is shown by its name.)
        await setup(page, { features: ['material.list', 'material.thumb'] });
        await editModal(page, 'Josef');
        await row(page, 'scan-1.jpg').locator('.material-more').click();
        await expect(page.locator('#materials-item-menu')).toBeVisible();
        await expect(menuItem(page, 'useAsPortrait')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await row(page, 'scan-1.jpg').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(panel(page).locator('.mv-title')).toBeVisible();
        await expect(act(page, 'useAsPortrait')).toHaveCount(0);
        await expect(page.locator('#confirmation-modal.active')).toHaveCount(0);
    });

    test('the file cannot be read from the research: one sentence, nothing written, no editor', async ({ page }) => {
        await setup(page);
        await page.route((url) => url.searchParams.get('file') === '1', (route) => route.fulfill({ status: 500, body: '' }));
        await editModal(page, 'Josef');
        await row(page, 'Svatba').locator('.material-more').click();
        await menuItem(page, 'useAsPortrait').click();
        await expect(page.locator('#confirmation-modal #confirm-message')).toHaveText('The file could not be read from the archive. Nothing was linked.');
        await expect(editor(page)).toHaveCount(0);
        expect((await stored(page, 'Josef')).media).toEqual([]);
    });
});

test.describe('Use as portrait… among the first actions of the viewer opened for the person (1121)', () => {
    const order = (page: Page) => panel(page).locator('.mv-actions > *').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.action));

    test('a desktop: right after the first action', async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await setup(page);
        await viewFor(page, 'P0001', 'Svatba');
        expect((await order(page)).slice(0, 2)).toEqual(['attach', 'useAsPortrait']);
    });

    test('a phone (390): the collapsed sheet shows it', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await setup(page);
        await viewFor(page, 'P0001', 'Svatba');
        await expect(panel(page)).not.toHaveClass(/is-expanded/);
        expect((await order(page)).slice(0, 2)).toEqual(['attach', 'useAsPortrait']);
        await expect(act(page, 'useAsPortrait')).toBeVisible();
        await expect(act(page, 'makeSource')).toBeHidden();
    });
});

test.describe('Link to… opened for a person (1121)', () => {
    test.use({ viewport: DESKTOP });

    test('the person whose card it is opened from is chosen at the start and can be unticked', async ({ page }) => {
        await setup(page, { files: [...FILES(), materialFile(3, { title: 'Pole' })] });
        // Jan's card, then all files and one that is not anyone's yet.
        await editModal(page, 'Jan');
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await expect(win(page)).toBeVisible();
        await tile(page, 'Pole').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await act(page, 'attach').click();
        await expect(dialog(page).locator('.mdlg-attach-has')).toHaveCount(0);
        await expect(dialog(page).locator('.ppm-chip')).toHaveText(['Jan Fíšek×']);
        await expect(dialog(page).locator('.mdlg-foot .mdlg-btn.is-primary')).toHaveText('Link (1 person)');
        // Unticked: nothing to link.
        await dialog(page).locator('.ppm-row', { hasText: 'Jan Fíšek' }).click();
        await expect(dialog(page).locator('.ppm-chip')).toHaveCount(0);
        await expect(dialog(page).locator('.mdlg-foot .mdlg-btn.is-primary')).toBeDisabled();
    });

    test('a file the research already gives to the person: nothing chosen, the sentence says so, its people shown linked', async ({ page }) => {
        await setup(page);
        await editModal(page, 'Josef');
        await row(page, 'Svatba').locator('.material-more').click();
        await menuItem(page, 'attach').click();
        await expect(dialog(page).locator('.mdlg-attach-has')).toHaveText('The file is already linked to Josef Fíšek.');
        await expect(dialog(page).locator('.mdlg-foot .mdlg-btn.is-primary')).toBeDisabled();
        // Whose the file is already: named above the list with the mark, never "Nobody yet"; ticked and fixed in the list.
        await expect(dialog(page).locator('.ppm-none')).toHaveCount(0);
        const fixedChips = dialog(page).locator('.ppm-chip--fixed');
        await expect(fixedChips).toHaveCount(2);
        await expect(fixedChips.first()).toContainText('Josef Fíšek');
        await expect(fixedChips.first().locator('.ppm-chip-mark')).toHaveText('already linked');
        await expect(fixedChips.nth(1)).toContainText('Anna Svobodová');
        await expect(fixedChips.locator('.ppm-chip-x')).toHaveCount(0);
        const josef = dialog(page).locator('.ppm-row', { hasText: 'Josef Fíšek' });
        await expect(josef).toHaveClass(/is-fixed/);
        await expect(josef.locator('input')).toBeChecked();
        await expect(josef.locator('input')).toBeDisabled();
        await expect(dialog(page).locator('.ppm-row', { hasText: 'Jan Fíšek' })).not.toHaveClass(/is-fixed/);
    });
});

test.describe('Removing a person from a file keeps the portrait (1121)', () => {
    test.use({ viewport: DESKTOP });

    test('Remove from this person in the person\'s ⋯ and the viewer\'s chip ×, both with Undo; the portrait cut from the photo stays', async ({ page }) => {
        const { material } = await setup(page, { files: [...FILES(), materialFile(3, { persons: ['P0001'], title: 'Pole' })] });
        await viewFor(page, 'P0001', 'Svatba');
        await act(page, 'useAsPortrait').click();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(page.locator('.undo-toast', { hasText: 'Portrait updated.' })).toBeVisible();
        await closeWindow(page);
        const before = await stored(page, 'Josef');
        expect(before.photo).toMatch(/^data:image\//);

        // The person's ⋯: through the bridge, Undo puts them back; the portrait stays.
        await editModal(page, 'Josef');
        await row(page, 'Svatba').locator('.material-more').click();
        await menuItem(page, 'removeFromPerson').click();
        await expect(toast(page)).toHaveText(/Removed: Josef Fíšek from Svatba\./);
        expect(material.assigns[0]).toEqual({ files: ['I0001'], remove: ['P0001'] });
        expect((await stored(page, 'Josef')).photo).toBe(before.photo);
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.assigns.length).toBe(2);
        expect(material.assigns[1]).toEqual({ files: ['I0001'], add: ['P0001'] });
        await page.locator('#person-modal').getByRole('button', { name: 'Cancel' }).click();

        // The viewer's chip × of the research's people (a file only in the research): through the bridge, with Undo.
        await viewFor(page, 'P0001', 'Pole');
        const chip = panel(page).locator('.mv-chip', { hasText: 'Josef Fíšek' });
        await chip.locator('.mv-chip-x').click();
        await expect.poll(() => material.assigns.length).toBe(3);
        expect(material.assigns[2]).toEqual({ files: ['I0003'], remove: ['P0001'] });
        await expect(toast(page).locator('.toast-action')).toHaveText('Undo');
        expect((await stored(page, 'Josef')).photo).toBe(before.photo);
        await page.keyboard.press('Escape');
        await expect(viewer(page)).not.toHaveClass(/active/);
        await closeWindow(page);

        // The tree's place taken off too ("Where used" ×): the portrait itself stays.
        await viewFor(page, 'P0001', 'Svatba');
        await panel(page).locator('.mv-use-x').first().click();
        await expect.poll(async () => (await stored(page, 'Josef')).media.some(m => m.persons.length > 0)).toBe(false);
        expect((await stored(page, 'Josef')).photo).toBe(before.photo);
    });

    test('a photo that is also the tree\'s file at the person: Remove from this person takes the research\'s assignment and the tree\'s places in one step, Undo brings both back; the other person\'s place and the portraits stay', async ({ page }) => {
        const { material } = await setup(page);
        // Both portraits from the wedding photo: one file of the tree, at Josef and at Anna.
        for (const refn of ['P0001', 'P0002']) {
            await viewFor(page, refn, 'Svatba');
            await act(page, 'useAsPortrait').click();
            await editor(page).getByRole('button', { name: 'Done' }).click();
            await expect(editor(page)).toHaveCount(0);
            await closeWindow(page);
        }
        const josefId = await personId(page, 'Josef');
        const annaId = await personId(page, 'Anna');
        const josef = await stored(page, 'Josef');
        const anna = await stored(page, 'Anna');
        expect(josef.media).toEqual([{ id: expect.any(String), persons: [josefId, annaId], sha: WEDDING_SHA }]);
        expect(josef.source?.attachmentId).toBe(josef.media[0].id);

        await editModal(page, 'Josef');
        await row(page, 'Svatba').locator('.material-more').click();
        await menuItem(page, 'removeFromPerson').click();
        await expect(toast(page)).toHaveText(/Removed: Josef Fíšek from Svatba\./);
        expect(material.assigns).toEqual([{ files: ['I0001'], remove: ['P0001'] }]);
        // The tree's places at Josef go too (one toast, no second Undo pill); Anna keeps hers, both portraits stay.
        let s = await stored(page, 'Josef');
        expect(s.media).toEqual([{ id: josef.media[0].id, persons: [annaId], sha: WEDDING_SHA }]);
        expect(s.photo).toBe(josef.photo);
        expect((await stored(page, 'Anna')).source).toEqual(anna.source);
        expect((await stored(page, 'Anna')).photo).toBe(anna.photo);
        await expect(row(page, 'Svatba')).toHaveCount(0);
        await expect(page.locator('.undo-toast')).toHaveCount(0);

        // Undo: the research's assignment and the tree's places back.
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.assigns.length).toBe(2);
        expect(material.assigns[1]).toEqual({ files: ['I0001'], add: ['P0001'] });
        s = await stored(page, 'Josef');
        expect(s.media).toEqual(josef.media);
        expect(s.source).toEqual(josef.source);
        expect(s.photo).toBe(josef.photo);
        await expect(row(page, 'Svatba')).toBeVisible();
    });
});
