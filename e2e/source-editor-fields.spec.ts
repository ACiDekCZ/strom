import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * The source editor's place of an entry (spec 075 §1): archive and call
 * number, folio, image and the other location; the proposal from an older
 * location (Use / Undo) saved in one undo step and kept through a GEDCOM
 * export and import; a conflict between the location and the image field;
 * another entry from the same book; the image field's help; a phone.
 * Invented data only.
 */

type Rec = Record<string, unknown>;

async function tree(page: Page, sources: Record<string, Rec>, width = 1440, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await page.evaluate(async (sources) => {
        const all: Record<string, unknown> = {};
        for (const [id, s] of Object.entries(sources)) all[id] = { id, ...s };
        const persons = {
            a: { id: 'a', firstName: 'Anna', lastName: 'Vzorková', gender: 'female', birthDate: '1834', isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [], sourceIds: Object.keys(sources) },
        };
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships: {}, sources: all } as never, 'Prameny');
    }, sources);
}

const editor = (page: Page) => page.locator('#source-editor-modal');
const note = (page: Page) => page.locator('#source-location-note');
const source = (page: Page, id: string) => page.evaluate((id) => window.Strom.DataManager.getData().sources?.[id] as Rec | undefined, id);

const LEGACY = { title: 'Oddací matrika Pokusov 1820–1835', repository: 'Zemský archiv Vzorov', reference: 'fol. 31 recto, image 3, no. 2' };

test.describe('source editor: where the entry stands', () => {
    test('fields in their order, placeholders, the old labels gone', async ({ page }) => {
        await tree(page, {});
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        const ids = await editor(page).locator('input[type="text"]').evaluateAll(els => els.map(e => e.id));
        const order = ['input-source-title', 'input-source-repository', 'input-source-callnumber', 'input-source-folio',
            'input-source-image', 'input-source-reference', 'input-source-url'];
        expect(ids.filter(id => order.includes(id))).toEqual(order);
        await expect(editor(page).locator('label[for="input-source-repository"]')).toHaveText('Archive');
        await expect(editor(page).locator('label[for="input-source-callnumber"]')).toHaveText('Call number');
        await expect(editor(page).locator('label[for="input-source-folio"]')).toHaveText('Folio/page');
        await expect(editor(page).locator('label[for="input-source-image"]')).toHaveText('Image');
        await expect(editor(page).locator('label[for="input-source-reference"]')).toHaveText('Other location');
        await expect(editor(page).locator('#input-source-folio')).toHaveAttribute('placeholder', 'fol. 12v, p. 112');
        await expect(editor(page).locator('#input-source-url')).toHaveAttribute('placeholder', 'https://');
        await expect(note(page)).toBeHidden();
        // Desktop: folio | image | other location on one row.
        const tops = await Promise.all(['#input-source-folio', '#input-source-image', '#input-source-reference']
            .map(id => editor(page).locator(id).evaluate(e => Math.round(e.getBoundingClientRect().top))));
        expect(new Set(tops).size).toBe(1);
    });

    test('proposal from an older location: Use fills the fields, Save is one undo step, GEDCOM export and import keep them', async ({ page }) => {
        await tree(page, { s1: LEGACY });
        await page.evaluate(() => window.Strom.UI.showEditSourceModal('s1'));
        await expect(note(page)).toHaveClass(/is-proposal/);
        await expect(note(page)).toContainText('From the location: fol. 31 recto · image 3 · rest “no. 2”');
        await note(page).getByRole('button', { name: 'Use' }).click();
        await expect(editor(page).locator('#input-source-folio')).toHaveValue('fol. 31 recto');
        await expect(editor(page).locator('#input-source-image')).toHaveValue('3');
        await expect(editor(page).locator('#input-source-reference')).toHaveValue('no. 2');
        for (const id of ['#input-source-folio', '#input-source-image', '#input-source-reference']) {
            await expect(editor(page).locator(id)).toHaveClass(/is-taken/);
        }
        await expect(note(page)).toHaveClass(/is-taken/);
        await expect(note(page)).toContainText('Taken from the location “fol. 31 recto, image 3, no. 2”. Saved with Save.');
        // Nothing is stored before Save.
        expect((await source(page, 's1'))?.folio).toBeUndefined();
        // A field changed by hand is no longer marked as taken.
        await editor(page).locator('#input-source-callnumber').fill('O 3');
        await editor(page).locator('#input-source-reference').fill('no. 2a');
        await expect(editor(page).locator('#input-source-reference')).not.toHaveClass(/is-taken/);
        await expect(editor(page).locator('#input-source-folio')).toHaveClass(/is-taken/);
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        expect(await source(page, 's1')).toMatchObject({ callNumber: 'O 3', folio: 'fol. 31 recto', image: '3', reference: 'no. 2a' });
        // One undo step takes the whole save back.
        await page.evaluate(() => window.Strom.DataManager.undo());
        expect(await source(page, 's1')).toEqual({ id: 's1', ...LEGACY });
        await page.evaluate(() => window.Strom.DataManager.redo());
        expect(await source(page, 's1')).toMatchObject({ folio: 'fol. 31 recto', image: '3' });

        // GEDCOM out and back in: the fields as they were.
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.evaluate(() => window.Strom.UI.exportTargetTreeGedcom());
        const pwd = page.locator('#export-password-modal');
        await expect(pwd).toBeVisible();
        await pwd.locator('#export-privacy-mode').selectOption('full');
        const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
        await page.locator('#gedcom-input').setInputFiles(await download.path());
        const result = page.locator('#gedcom-result-modal');
        await expect(result).toBeVisible();
        await result.locator('#gedcom-new-tree-btn').click();
        const dialog = page.locator('#import-tree-modal');
        await dialog.locator('#import-tree-name').fill('Back from GEDCOM');
        await dialog.getByRole('button', { name: 'Import' }).click();
        await expect(dialog).toBeHidden();
        const back = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources ?? {})
            .find(s => s.title === 'Oddací matrika Pokusov 1820–1835'));
        expect(back).toMatchObject({ repository: 'Zemský archiv Vzorov', callNumber: 'O 3', folio: 'fol. 31 recto', image: '3', reference: 'no. 2a' });
    });

    test('Undo after Use: the three fields as before, the proposal again; Cancel keeps the source', async ({ page }) => {
        await tree(page, { s1: LEGACY });
        await page.evaluate(() => window.Strom.UI.showEditSourceModal('s1'));
        await note(page).getByRole('button', { name: 'Use' }).click();
        await note(page).getByRole('button', { name: 'Undo' }).click();
        await expect(editor(page).locator('#input-source-folio')).toHaveValue('');
        await expect(editor(page).locator('#input-source-image')).toHaveValue('');
        await expect(editor(page).locator('#input-source-reference')).toHaveValue(LEGACY.reference);
        await expect(editor(page).locator('#input-source-folio')).not.toHaveClass(/is-taken/);
        await expect(note(page)).toHaveClass(/is-proposal/);
        // Nothing changed: closing asks nothing, the source is as it was.
        await editor(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(editor(page)).toBeHidden();
        expect(await source(page, 's1')).toEqual({ id: 's1', ...LEGACY });
    });

    test('the proposal follows Other location as typed; two images propose nothing', async ({ page }) => {
        await tree(page, {});
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        const ref = editor(page).locator('#input-source-reference');
        await ref.fill('fol. 12v');
        await expect(note(page)).toContainText('From the location: fol. 12v');
        await expect(note(page)).not.toContainText('rest');
        await ref.fill('image 3, image 4');
        await expect(note(page)).toBeHidden();
        await ref.fill('no. 5');
        await expect(note(page)).toBeHidden();
        // A folio typed in its field: no proposal any more.
        await ref.fill('fol. 12v');
        await expect(note(page)).toBeVisible();
        await editor(page).locator('#input-source-folio').fill('fol. 12v');
        await expect(note(page)).toBeHidden();
    });

    test('conflict: the location names another image than the field; "Change location to …" keeps the field', async ({ page }) => {
        await tree(page, { s1: { title: 'Baptism – John Example, 1834', repository: 'Zemský archiv Vzorov', callNumber: 'N 7', image: '4', reference: 'fol. 12, image 3' } });
        await page.evaluate(() => window.Strom.UI.showEditSourceModal('s1'));
        await expect(note(page)).toHaveClass(/is-conflict/);
        await expect(note(page)).toContainText('The location names image 3, the Image field says 4. GED uses the field.');
        await note(page).getByRole('button', { name: 'Change location to “fol. 12”' }).click();
        await expect(editor(page).locator('#input-source-reference')).toHaveValue('fol. 12');
        await expect(editor(page).locator('#input-source-image')).toHaveValue('4');
        // fol. 12 in the location while the folio field is empty: a folio could be proposed, but a field is filled.
        await expect(note(page)).toBeHidden();
        await editor(page).getByRole('button', { name: 'Save' }).click();
        expect(await source(page, 's1')).toMatchObject({ image: '4', reference: 'fol. 12' });

        // Saving with a conflict is allowed (the field is what counts).
        await page.evaluate(() => window.Strom.UI.showEditSourceModal('s1'));
        await editor(page).locator('#input-source-reference').fill('image 9');
        await expect(note(page)).toContainText('The location names image 9');
        await expect(note(page).getByRole('button', { name: 'Remove the conflicting part' })).toBeVisible();
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        expect(await source(page, 's1')).toMatchObject({ image: '4', reference: 'image 9' });
    });

    test('a folio conflict names the folio; emptied fields are removed from the source', async ({ page }) => {
        await tree(page, { s1: { title: 'Burial', callNumber: 'N 7', folio: 'fol. 12v', image: '34', reference: 'fol. 13' } });
        await page.evaluate(() => window.Strom.UI.showEditSourceModal('s1'));
        await expect(note(page)).toContainText('The location names fol. 13, the Folio/page field says fol. 12v.');
        await note(page).getByRole('button', { name: 'Remove the conflicting part' }).click();
        await expect(editor(page).locator('#input-source-reference')).toHaveValue('');
        await editor(page).locator('#input-source-callnumber').fill('');
        await editor(page).locator('#input-source-image').fill('');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        const s = await source(page, 's1');
        expect(s).toMatchObject({ folio: 'fol. 12v' });
        expect(Object.keys(s!).sort()).toEqual(['folio', 'id', 'title']);
    });

    test('another entry from the same book: archive, call number and link; folio, image and location empty, the cursor in the folio', async ({ page }) => {
        await tree(page, { s1: { title: 'Baptism – John Example, 1834', repository: 'Zemský archiv Vzorov', callNumber: 'N 7', folio: 'fol. 12v',
            image: '34', reference: 'no. 5', url: 'https://archiv.example/matriky/n7/34' } });
        await page.evaluate(() => window.Strom.UI.showEditSourceModal('s1'));
        await editor(page).locator('#source-editor-same-book').click();
        await expect(editor(page).locator('#source-editor-same-book')).toBeHidden();
        await expect(editor(page).locator('#input-source-title')).toHaveAttribute('placeholder', 'Baptism – John Example, 1834');
        await expect(editor(page).locator('#input-source-repository')).toHaveValue('Zemský archiv Vzorov');
        await expect(editor(page).locator('#input-source-callnumber')).toHaveValue('N 7');
        await expect(editor(page).locator('#input-source-url')).toHaveValue('https://archiv.example/matriky/n7/34');
        for (const id of ['#input-source-folio', '#input-source-image', '#input-source-reference']) {
            await expect(editor(page).locator(id)).toHaveValue('');
        }
        await expect(editor(page).locator('#input-source-folio')).toBeFocused();
        await page.keyboard.type('fol. 13r');
        await editor(page).locator('#input-source-image').fill('35');
        await editor(page).locator('#input-source-title').fill('Baptism – Mary Example, 1836');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        const made = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources ?? {})
            .find(s => s.title === 'Baptism – Mary Example, 1836'));
        expect(made).toMatchObject({ repository: 'Zemský archiv Vzorov', callNumber: 'N 7', folio: 'fol. 13r', image: '35' });
        expect(made?.reference).toBeUndefined();
    });

    test('the image field\'s help: hover, a click pins it, Escape closes it before the editor', async ({ page }) => {
        await tree(page, {});
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        const btn = editor(page).locator('#source-image-help-btn');
        const tip = page.locator('#source-image-help');
        await expect(btn).toHaveAttribute('aria-label', 'Why the image');
        await expect(editor(page).locator('#input-source-image')).toHaveAttribute('aria-describedby', 'source-image-help');
        await expect(tip).toBeHidden();
        await btn.hover();
        await expect(tip).toBeVisible();
        await expect(tip).toHaveAttribute('role', 'tooltip');
        await expect(tip).toContainText('The image number in the archive’s viewer.');
        await editor(page).locator('#input-source-title').hover();
        await expect(tip).toBeHidden();
        await btn.click();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        await editor(page).locator('#input-source-title').hover();
        await expect(tip).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(tip).toBeHidden();
        await expect(editor(page)).toBeVisible();
        await btn.click();
        await expect(tip).toBeVisible();
        await editor(page).locator('#input-source-title').click();
        await expect(tip).toBeHidden();
        await expect(btn).toHaveAttribute('aria-expanded', 'false');
        // Opened again, the editor's help still answers (its state is kept across openings).
        await editor(page).getByRole('button', { name: 'Cancel' }).click();
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        await expect(tip).toBeHidden();
        await btn.click();
        await expect(tip).toBeVisible();
        await btn.click();
        await expect(tip).toBeHidden();
    });
});

test.describe('source editor on a phone', () => {
    test.use({ hasTouch: true });

    test('390 px: archive | call number and folio | image side by side, other location under them, 44 px fields, nothing wider than the dialog; the help opens and closes by tap', async ({ page }) => {
        await tree(page, { s1: LEGACY }, 390, 844);
        await page.evaluate(() => window.Strom.UI.showEditSourceModal('s1'));
        const box = (id: string) => editor(page).locator(id).boundingBox();
        const [repo, call, folio, image, ref] = await Promise.all(['#input-source-repository', '#input-source-callnumber',
            '#input-source-folio', '#input-source-image', '#input-source-reference'].map(box));
        expect(Math.round(repo!.y)).toBe(Math.round(call!.y));
        expect(Math.round(folio!.y)).toBe(Math.round(image!.y));
        expect(ref!.y).toBeGreaterThan(folio!.y + folio!.height);
        for (const b of [repo, call, folio, image, ref]) expect(Math.round(b!.height)).toBeGreaterThanOrEqual(44);
        const take = note(page).getByRole('button', { name: 'Use' });
        expect(Math.round((await take.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        const overflow = await page.evaluate(() => {
            const modal = document.querySelector('#source-editor-modal .modal') as HTMLElement;
            const out: string[] = [];
            modal.querySelectorAll<HTMLElement>('*').forEach(el => {
                if (el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') out.push(el.id || el.className);
            });
            const r = modal.getBoundingClientRect();
            if (r.right > window.innerWidth + 1 || document.documentElement.scrollWidth > window.innerWidth) out.push('page');
            return out;
        });
        expect(overflow).toEqual([]);
        const tip = page.locator('#source-image-help');
        await editor(page).locator('#source-image-help-btn').tap();
        await expect(tip).toBeVisible();
        const t = (await tip.boundingBox())!;
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width).toBeLessThanOrEqual(390);
        await editor(page).locator('#source-image-help-btn').tap();
        await expect(tip).toBeHidden();
        await editor(page).locator('#source-image-help-btn').tap();
        await expect(tip).toBeVisible();
        await editor(page).locator('#input-source-title').tap();
        await expect(tip).toBeHidden();
    });
});
