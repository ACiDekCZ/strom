import { test, expect, Page } from '@playwright/test';
import { openApp, cardAction, personModal } from './helpers.js';

/**
 * Source flows the other source suites leave out: deleting a source (from the
 * catalog and from "Manage sources" while a person is open), citing a
 * person's event, the suggested titles of a new source, cutting an excerpt
 * from an attachment and cropping it again, Replace / "Add continuation",
 * the "Paste from clipboard" button, "another entry from the same register"
 * from the editor, the crop editor's pointer and zoom tools, the viewer's
 * list of what a source supports, and attachments other than one image.
 * Invented data only.
 */

type Rec = Record<string, unknown>;

/** Research fields on (unless `advanced` is false), a tree built from plain records. */
async function tree(page: Page, data: { persons: Record<string, Rec>; partnerships?: Record<string, Rec>; sources?: Record<string, Rec> }, advanced = true): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async ({ data, advanced }) => {
        window.Strom.SettingsManager.setAdvancedFields(advanced);
        const persons: Record<string, unknown> = {};
        for (const [id, p] of Object.entries(data.persons)) {
            persons[id] = { id, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p };
        }
        const partnerships: Record<string, unknown> = {};
        for (const [id, u] of Object.entries(data.partnerships ?? {})) {
            partnerships[id] = { id, status: 'married', childIds: [], ...u };
        }
        const sources: Record<string, unknown> = {};
        for (const [id, s] of Object.entries(data.sources ?? {})) sources[id] = { id, ...s };
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, sources } as never, 'Prameny');
    }, { data, advanced });
}

/** A JPEG data URL drawn in the page (a stand-in for a scanned page). */
function jpegDataUrl(page: Page, width: number, height: number): Promise<string> {
    return page.evaluate(({ width, height }) => {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#333';
        for (let y = 30; y < height; y += 50) ctx.fillRect(30, y, width - 60, 5);
        return c.toDataURL('image/jpeg', 0.8);
    }, { width, height });
}

/** The same picture as PNG bytes, for file inputs. */
async function pngBuffer(page: Page, width: number, height: number): Promise<Buffer> {
    const b64 = await page.evaluate(({ width, height }) => {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#333';
        for (let y = 40; y < height; y += 60) ctx.fillRect(40, y, width - 80, 6);
        return c.toDataURL('image/png').split(',')[1];
    }, { width, height });
    return Buffer.from(b64, 'base64');
}

const getData = (page: Page) => page.evaluate(() => window.Strom.DataManager.getData() as unknown as {
    persons: Record<string, any>; partnerships: Record<string, any>; sources?: Record<string, any>;
});

/** The toasts sit over the bottom of the dialogs: clear them before clicking there. */
async function clearToasts(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.Strom.UI.dismissUndoToast();
        document.querySelectorAll('.toast').forEach(t => t.remove());
    });
}

const editor = (page: Page) => page.locator('#source-editor-modal');
const viewer = (page: Page) => page.locator('#source-viewer-modal');
const picker = (page: Page) => page.locator('#source-picker-modal');
const catalog = (page: Page) => page.locator('#sources-modal');
const confirmDlg = (page: Page) => page.locator('#confirmation-modal');
const cropper = (page: Page) => page.locator('.crop-overlay');

const jan = { firstName: 'Jan', lastName: 'Novák', birthDate: '1865', partnerships: ['u1'] };
const marie = { firstName: 'Marie', lastName: 'Nováková', gender: 'female', birthDate: '1868', partnerships: ['u1'] };

test.describe('deleting a source', () => {
    test('the question names it and counts its places; Cancel keeps it; Delete removes every citation; Undo brings them back', { tag: '@smoke' }, async ({ page }) => {
        await tree(page, {
            persons: {
                j: { ...jan, sourceIds: ['s1'], birthSourceIds: ['s1'], events: [{ id: 'e1', type: 'baptism', date: '1865', sourceIds: ['s1', 's2'] }] },
                m: marie,
            },
            partnerships: { u1: { person1Id: 'j', person2Id: 'm', sourceIds: ['s1'], events: [{ id: 'c1', type: 'banns', date: '1888', sourceIds: ['s1'] }] } },
            sources: { s1: { title: 'Matrika Lhota' }, s2: { title: 'Sčítání 1880' } },
        });
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        const row = catalog(page).locator('.source-row', { hasText: 'Matrika Lhota' });
        await expect(row.locator('.source-count')).toHaveText('5×');

        await row.locator('.source-delete-btn').click();
        await expect(confirmDlg(page).locator('#confirm-title')).toContainText('Delete source Matrika Lhota?');
        await expect(confirmDlg(page).locator('#confirm-message')).toHaveText(
            'It is cited in 5 places; those citations are removed too. The Undo button brings it back.');
        await confirmDlg(page).locator('#confirm-cancel-btn').click();
        expect((await getData(page)).sources?.s1?.title).toBe('Matrika Lhota');

        await row.locator('.source-delete-btn').click();
        await confirmDlg(page).locator('#confirm-ok-btn').click();
        await expect(catalog(page).locator('.source-row')).toHaveCount(1);
        await expect(catalog(page).locator('#sources-list')).not.toContainText('Matrika Lhota');
        const after = await getData(page);
        expect(after.sources?.s1).toBeUndefined();
        expect(after.persons.j.sourceIds).toBeUndefined();
        expect(after.persons.j.birthSourceIds).toBeUndefined();
        expect(after.persons.j.events[0].sourceIds).toEqual(['s2']);
        expect(after.partnerships.u1.sourceIds).toBeUndefined();
        expect(after.partnerships.u1.events[0].sourceIds).toBeUndefined();

        // One step back restores the source and all five citations (the undo
        // toast shows once no dialog is open).
        await catalog(page).locator('.close-btn').click();
        await page.locator('.undo-toast-btn').click();
        const undone = await getData(page);
        expect(undone.sources?.s1?.title).toBe('Matrika Lhota');
        expect(undone.persons.j.sourceIds).toEqual(['s1']);
        expect(undone.persons.j.birthSourceIds).toEqual(['s1']);
        expect(undone.persons.j.events[0].sourceIds).toEqual(['s1', 's2']);
        expect(undone.partnerships.u1.sourceIds).toEqual(['s1']);
        expect(undone.partnerships.u1.events[0].sourceIds).toEqual(['s1']);
    });

    test('from "Manage sources" while the person is open: the person\'s chips drop it; an uncited one only mentions Undo', async ({ page }) => {
        await tree(page, {
            persons: { j: { ...jan, partnerships: [], sourceIds: ['s1'], birthSourceIds: ['s1'] } },
            sources: { s1: { title: 'Křest Jana' }, s2: { title: 'Nepoužitý pramen' } },
        });
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        await expect(modal.locator('#person-sources-chips .source-chip')).toHaveCount(1);
        await expect(modal.locator('#birth-sources-chips .source-chip')).toHaveCount(1);

        await modal.locator('#btn-cite-person').click();
        await picker(page).getByRole('button', { name: 'Manage sources' }).click();
        await expect(catalog(page)).toHaveClass(/active/);

        await catalog(page).locator('.source-row', { hasText: 'Nepoužitý' }).locator('.source-delete-btn').click();
        await expect(confirmDlg(page).locator('#confirm-message')).toHaveText('The Undo button brings it back.');
        await confirmDlg(page).locator('#confirm-ok-btn').click();
        await clearToasts(page);
        await catalog(page).locator('.source-row', { hasText: 'Křest Jana' }).locator('.source-delete-btn').click();
        await expect(confirmDlg(page).locator('#confirm-message')).toContainText('It is cited in 2 places');
        await confirmDlg(page).locator('#confirm-ok-btn').click();
        await expect(catalog(page).locator('.sources-empty')).toBeVisible();

        // Back to the picker (now empty), then to the person: no chips left.
        await catalog(page).locator('.close-btn').click();
        await expect(picker(page)).toHaveClass(/active/);
        await expect(picker(page).locator('#source-picker-list')).toHaveText('No sources — create one');
        await picker(page).locator('.close-btn').click();
        await expect(modal.locator('#person-sources-chips .source-chip')).toHaveCount(0);
        await expect(modal.locator('#birth-sources-chips .source-chip')).toHaveCount(0);
        const j = (await getData(page)).persons.j;
        expect(j.sourceIds).toBeUndefined();
        expect(j.birthSourceIds).toBeUndefined();
    });
});

test.describe('citing from the editors', () => {
    /** The modal overlay that actually receives a click in the middle of `selector`. */
    const topmostAt = (page: Page, selector: string) => page.evaluate((sel) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.modal-overlay')?.id ?? null;
    }, selector);

    // Regression: "Manage sources" opened the catalog beneath the dialog that
    // cited — the event editor (z-index 210) and the relationships panel —
    // where its rows could not be clicked.
    test('"Manage sources" from the event editor and from the relationships panel opens the catalog on top', async ({ page }) => {
        await tree(page, {
            persons: { j: { ...jan, events: [{ id: 'e1', type: 'baptism', date: '1865' }] }, m: marie },
            partnerships: { u1: { person1Id: 'j', person2Id: 'm' } },
            sources: { s1: { title: 'Křest Jana' } },
        });
        await page.evaluate(() => window.Strom.UI.showRelationshipsPanel('j' as never));
        await page.locator('#relationships-modal .partnership-cite-btn').first().click();
        await picker(page).getByRole('button', { name: 'Manage sources' }).click();
        await expect(catalog(page)).toHaveClass(/active/);
        expect(await topmostAt(page, '#sources-list .source-delete-btn')).toBe('sources-modal');
        await catalog(page).locator('.close-btn').click({ timeout: 3000 });
        await picker(page).locator('.close-btn').click();
        await page.locator('#relationships-modal button.secondary', { hasText: 'Cancel' }).click();

        await cardAction(page, 'Jan', 'edit');
        await personModal(page).locator('#events-list .event-edit-btn[data-event-id="e1"]').click();
        await page.locator('#btn-cite-event').click();
        await picker(page).getByRole('button', { name: 'Manage sources' }).click();
        expect(await topmostAt(page, '#sources-list .source-delete-btn')).toBe('sources-modal');
    });

    test('a person\'s event: a new source from the event editor gets a title from the event and is cited there; × uncites', async ({ page }) => {
        await tree(page, { persons: { j: { ...jan, partnerships: [], events: [{ id: 'e1', type: 'baptism', date: '1865-03-14', place: 'Lhota' }] } } });
        await cardAction(page, 'Jan', 'edit');
        await personModal(page).locator('#events-list .event-edit-btn[data-event-id="e1"]').click();
        const ev = page.locator('#event-editor-modal');
        await expect(ev).toBeVisible();
        await expect(ev.locator('#event-sources-section')).toBeVisible();
        await expect(ev.locator('#event-sources-chips')).toHaveText('No sources yet');

        await ev.locator('#btn-cite-event').click();
        await expect(picker(page)).toHaveClass(/active/);
        // No "Supports" choice for an event: the context is fixed.
        await expect(picker(page).locator('#source-picker-fact')).toBeHidden();
        await picker(page).getByRole('button', { name: 'New source…' }).click();
        await expect(editor(page).locator('#input-source-title')).toHaveValue('Baptism – Jan Novák, 1865');
        await editor(page).locator('#input-source-reference').fill('fol. 12');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        await expect(picker(page)).not.toHaveClass(/active/);

        await expect(ev.locator('#event-sources-chips .source-chip')).toHaveCount(1);
        await expect(ev.locator('#event-sources-chips .source-chip-label')).toHaveText('Baptism – Jan Novák, 1865');
        let data = await getData(page);
        const sid = Object.keys(data.sources ?? {})[0];
        expect(data.persons.j.events[0].sourceIds).toEqual([sid]);
        expect(data.persons.j.sourceIds).toBeUndefined();
        expect(data.sources![sid].reference).toBe('fol. 12');

        await ev.locator('#event-sources-chips .source-chip-remove').click();
        await expect(ev.locator('#event-sources-chips')).toHaveText('No sources yet');
        data = await getData(page);
        expect(data.persons.j.events[0].sourceIds).toBeUndefined();
        // The source itself stays in the catalog.
        expect(data.sources![sid].title).toBe('Baptism – Jan Novák, 1865');
    });

    test('suggested titles for the birth and a marriage; a new source from the marriage is cited on it; × under the birth uncites the birth only', async ({ page }) => {
        await tree(page, {
            persons: { j: { ...jan, sourceIds: ['s1'], birthSourceIds: ['s1'] }, m: marie },
            partnerships: { u1: { person1Id: 'j', person2Id: 'm', startDate: '1890-05-02' } },
            sources: { s1: { title: 'Křest Jana' } },
        });
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        await modal.locator('#birth-sources-group .fact-cite-btn').click();
        await picker(page).getByRole('button', { name: 'New source…' }).click();
        await expect(editor(page).locator('#input-source-title')).toHaveValue('Birth – Jan Novák, 1865');
        await editor(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(editor(page)).toBeHidden();
        await expect(picker(page)).not.toHaveClass(/active/);
        expect(Object.keys((await getData(page)).sources ?? {})).toEqual(['s1']);

        // × on the birth chip: the person-level citation of the same source stays.
        await modal.locator('#birth-sources-chips .source-chip-remove').click();
        await expect(modal.locator('#birth-sources-chips .source-chip')).toHaveCount(0);
        let j = (await getData(page)).persons.j;
        expect(j.birthSourceIds).toBeUndefined();
        expect(j.sourceIds).toEqual(['s1']);
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(modal).toBeHidden();

        // The marriage: the title names both partners and the year.
        await page.evaluate(() => window.Strom.UI.showRelationshipsPanel('j' as never));
        const panel = page.locator('#relationships-modal');
        await panel.locator('.partnership-cite-btn').first().click();
        await picker(page).getByRole('button', { name: 'New source…' }).click();
        await expect(editor(page).locator('#input-source-title')).toHaveValue('Marriage – Jan Novák and Marie Nováková, 1890');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        await expect(panel.locator('.partnership-citations .source-chip')).toContainText('Marriage – Jan Novák and Marie Nováková, 1890');
        await panel.locator('button.primary').last().click();
        await expect(panel).toBeHidden();
        const data = await getData(page);
        const created = Object.values(data.sources ?? {}).find((s: any) => s.title.startsWith('Marriage'));
        expect(data.partnerships.u1.sourceIds).toEqual([created.id]);
        j = data.persons.j;
        expect(j.sourceIds).toEqual(['s1']);
    });
});

test.describe('excerpts', () => {
    test('crop from an attachment: a page picker, the excerpt linked to its page; re-crop keeps the link, a rotated re-crop drops it', async ({ page }) => {
        await tree(page, { persons: { j: { ...jan, partnerships: [] } } });
        const scan = await jpegDataUrl(page, 1000, 600);
        await page.evaluate((scan) => {
            window.Strom.DataManager.addAttachment('j' as never, { name: 'matrika-57.jpg', mimeType: 'image/jpeg', dataUrl: scan, sizeBytes: 1000 });
        }, scan);
        const attId = (await getData(page)).persons.j.attachments[0].id;

        await cardAction(page, 'Jan', 'edit');
        await personModal(page).locator('#btn-cite-person').click();
        await picker(page).getByRole('button', { name: 'New source…' }).click();
        const box = editor(page).locator('#source-excerpts');
        await box.getByRole('button', { name: 'Crop from attachment' }).click();
        const pages = box.locator('.excerpt-page-picker');
        await expect(pages).toHaveAttribute('aria-label', 'Choose a page');
        await expect(pages.locator('button')).toHaveCount(1);
        await expect(pages.locator('button')).toHaveAttribute('aria-label', 'matrika-57.jpg');
        await pages.locator('button').click();
        await expect(pages).toHaveCount(0);
        await expect(cropper(page)).toBeVisible();
        // The page is already an attachment: no "save the whole page" offer.
        await expect(cropper(page).locator('#crop-keep-page')).toHaveCount(0);
        await cropper(page).locator('.crop-buttons .crop-apply').click();
        await expect(cropper(page)).toHaveCount(0);
        await expect(box.locator('.excerpt-item')).toHaveCount(1);
        await expect(box.getByRole('button', { name: 'Crop', exact: true })).toBeVisible();
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();

        let data = await getData(page);
        const sid = Object.keys(data.sources ?? {})[0];
        let exc = data.sources![sid].excerpts[0];
        expect(data.persons.j.sourceIds).toEqual([sid]);
        expect(exc.fromAttachmentId).toBe(attId);
        expect(exc.region).toEqual({ x: 0.1, y: 0.4, w: 0.8, h: 0.2 });
        expect(exc.width).toBe(800);
        expect(exc.height).toBe(120);
        // No second copy of the page was stored.
        expect(data.persons.j.attachments).toHaveLength(1);

        // Crop again: the frame starts where it was; one step right keeps the link.
        await page.evaluate((sid) => window.Strom.UI.showEditSourceModal(sid), sid);
        await box.getByRole('button', { name: 'Crop', exact: true }).click();
        const frame = cropper(page).locator('.crop-frame');
        await expect(frame).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await expect(cropper(page)).toHaveCount(0);
        await editor(page).getByRole('button', { name: 'Save' }).click();
        data = await getData(page);
        exc = data.sources![sid].excerpts[0];
        expect(exc.fromAttachmentId).toBe(attId);
        expect(exc.region.x).toBeCloseTo(0.11, 5);
        expect(exc.region.w).toBeCloseTo(0.8, 5);

        // A rotated page no longer matches the stored one: the link goes.
        await page.evaluate((sid) => window.Strom.UI.showEditSourceModal(sid), sid);
        await box.getByRole('button', { name: 'Crop', exact: true }).click();
        await cropper(page).locator('.crop-tools .crop-rot-r').click();
        await cropper(page).locator('.crop-buttons .crop-apply').click();
        await expect(cropper(page)).toHaveCount(0);
        await editor(page).getByRole('button', { name: 'Save' }).click();
        exc = (await getData(page)).sources![sid].excerpts[0];
        expect(exc.fromAttachmentId).toBeUndefined();
        expect(exc.region).toBeUndefined();
        // The band across the page is now a tall strip of the turned page.
        expect(exc.height).toBeGreaterThan(exc.width);
    });

    test('Replace keeps the caption; "Add continuation" offers the same choices; the trash removes one', async ({ page }) => {
        await tree(page, { persons: { j: { ...jan, partnerships: [] } } });
        const first = await jpegDataUrl(page, 600, 120);
        await page.evaluate((first) => {
            window.Strom.DataManager.addSource({ title: 'Křest Jana', excerpts: [{ id: 'x1', dataUrl: first, width: 600, height: 120, sizeBytes: 900, caption: 'levá strana' }] });
        }, first);
        const sid = Object.keys((await getData(page)).sources ?? {})[0];
        await page.evaluate((sid) => window.Strom.UI.showEditSourceModal(sid), sid);
        const box = editor(page).locator('#source-excerpts');
        await expect(box.locator('.excerpt-caption')).toHaveValue('levá strana');

        await box.getByRole('button', { name: 'Replace' }).click();
        const menu = box.locator('.excerpt-adder-menu');
        await expect(menu.locator('button')).toHaveText([/Paste from clipboard/, 'Upload image']);
        await expect(menu.locator('button').first()).toBeFocused();
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            menu.getByRole('button', { name: 'Upload image' }).click(),
        ]);
        await chooser.setFiles({ name: 'p2.png', mimeType: 'image/png', buffer: await pngBuffer(page, 1200, 800) });
        await expect(cropper(page)).toBeVisible();
        await cropper(page).locator('.crop-buttons .crop-apply').click();
        await expect(menu).toHaveCount(0);
        await expect(box.locator('.excerpt-item')).toHaveCount(1);
        await expect(box.locator('.excerpt-caption')).toHaveValue('levá strana');

        // A continuation from the next page: the same menu, a new item.
        await box.getByRole('button', { name: /Add continuation/ }).click();
        await expect(box.locator('.excerpt-adder-menu button')).toHaveCount(2);
        const [chooser2] = await Promise.all([
            page.waitForEvent('filechooser'),
            box.locator('.excerpt-adder-menu').getByRole('button', { name: 'Upload image' }).click(),
        ]);
        await chooser2.setFiles({ name: 'p3.png', mimeType: 'image/png', buffer: await pngBuffer(page, 1200, 800) });
        await cropper(page).locator('.crop-buttons .crop-apply').click();
        await expect(box.locator('.excerpt-item')).toHaveCount(2);
        await box.locator('.excerpt-caption').nth(1).fill('pravá strana');
        await editor(page).getByRole('button', { name: 'Save' }).click();

        let excs = (await getData(page)).sources![sid].excerpts;
        expect(excs).toHaveLength(2);
        expect(excs[0].caption).toBe('levá strana');
        expect(excs[0].dataUrl).not.toBe(first);
        expect(excs[0].width).toBe(960);   // the default band of a 1200 px wide page
        expect(excs[1].caption).toBe('pravá strana');

        await page.evaluate((sid) => window.Strom.UI.showEditSourceModal(sid), sid);
        await box.locator('.excerpt-item').first().locator('.excerpt-remove').click();
        await expect(box.locator('.excerpt-item')).toHaveCount(1);
        await editor(page).getByRole('button', { name: 'Save' }).click();
        excs = (await getData(page)).sources![sid].excerpts;
        expect(excs.map((e: { caption?: string }) => e.caption)).toEqual(['pravá strana']);
    });

    test('"Paste from clipboard": without permission a hint, plain text a notice, an image becomes the excerpt as it is', async ({ page, context }) => {
        await tree(page, { persons: { j: { ...jan, partnerships: [] } } });
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        const paste = editor(page).locator('#source-excerpts').getByRole('button', { name: /Paste from clipboard/ });
        await expect(paste.locator('kbd')).toHaveText(/^(Ctrl\+V|⌘V)$/);

        await paste.click();
        await expect(page.locator('.toast')).toHaveText('Press Ctrl+V (⌘V on a Mac).');
        await clearToasts(page);

        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.evaluate(() => navigator.clipboard.writeText('Jan, syn Josefa'));
        await paste.click();
        await expect(page.locator('.toast')).toHaveText('The clipboard contains no image.');
        await clearToasts(page);
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(0);

        await page.evaluate(async () => {
            const c = document.createElement('canvas');
            c.width = 1600; c.height = 300;
            const ctx = c.getContext('2d')!;
            ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 1600, 300);
            const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        });
        await paste.click();
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(1);
        await expect(cropper(page)).toHaveCount(0);
        // A pasted image can be cropped later from the original it came from.
        await expect(editor(page).getByRole('button', { name: 'Crop', exact: true })).toBeVisible();
        await editor(page).locator('#input-source-title').fill('Snímek z prohlížeče');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        const exc = Object.values((await getData(page)).sources ?? {})[0].excerpts[0];
        expect(exc.dataUrl.startsWith('data:image/jpeg')).toBe(true);
        expect(exc.width).toBe(1200);
        expect(exc.height).toBe(225);
    });

    test('a pasted excerpt cropped again from its original: smaller, still unlinked', async ({ page }) => {
        await tree(page, { persons: { j: { ...jan, partnerships: [] } } });
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        const png = await pngBuffer(page, 1000, 500);
        await page.evaluate((b64) => {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const dt = new DataTransfer();
            dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
            document.querySelector('#source-editor-modal')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }, png.toString('base64'));
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(1);
        await editor(page).getByRole('button', { name: 'Crop', exact: true }).click();
        await expect(cropper(page)).toBeVisible();
        await cropper(page).locator('.crop-buttons .crop-apply').click();
        await expect(cropper(page)).toHaveCount(0);
        await editor(page).locator('#input-source-title').fill('Výřez');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        const exc = Object.values((await getData(page)).sources ?? {})[0].excerpts[0];
        // The default band of the original (80 % × 20 %), not the whole screenshot.
        expect(exc.width).toBe(800);
        expect(exc.height).toBe(100);
        expect(exc.fromAttachmentId).toBeUndefined();
        expect(exc.region).toBeUndefined();
    });
});

test.describe('another entry from the same register, from the editor', () => {
    test('with unsaved edits: Save keeps them, then the new entry is cited where the chip was', async ({ page }) => {
        await tree(page, {
            persons: { j: { ...jan, partnerships: [], sourceIds: ['s1'] } },
            sources: { s1: { title: 'Křest Jana', repository: 'SOA Zámrsk', reference: 'Týnec 17', url: 'https://archive.example/b/17' } },
        });
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        await modal.locator('#person-sources-chips .source-chip-open').click();
        await viewer(page).locator('#source-viewer-edit').click();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('#source-editor-same-book')).toBeVisible();
        await editor(page).locator('#input-source-note').fill('fol. 3 je poškozený');

        await editor(page).locator('#source-editor-same-book').click();
        await expect(confirmDlg(page).locator('#confirm-save-btn')).toBeVisible();
        await confirmDlg(page).locator('#confirm-save-btn').click();

        await expect(editor(page)).toBeVisible();
        await expect(viewer(page)).toBeHidden();
        await expect(editor(page).locator('#source-editor-same-book')).toBeHidden();
        await expect(editor(page).locator('#input-source-title')).toHaveValue('');
        await expect(editor(page).locator('#input-source-title')).toHaveAttribute('placeholder', 'Křest Jana');
        await expect(editor(page).locator('#input-source-repository')).toHaveValue('SOA Zámrsk');
        await expect(editor(page).locator('#input-source-note')).toHaveValue('');
        expect((await getData(page)).sources!.s1.note).toBe('fol. 3 je poškozený');

        await editor(page).locator('#input-source-title').fill('Křest bratra');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        await expect(viewer(page)).toBeHidden();
        await expect(modal.locator('#person-sources-chips .source-chip')).toHaveCount(2);
        const data = await getData(page);
        const created = Object.values(data.sources ?? {}).find((s: any) => s.title === 'Křest bratra');
        expect(created.repository).toBe('SOA Zámrsk');
        expect(created.reference).toBe('Týnec 17');
        expect(created.note).toBeUndefined();
        expect(data.persons.j.sourceIds).toEqual(['s1', created.id]);
    });
});

test.describe('crop editor tools', () => {
    async function openCropper(page: Page, width: number, height: number): Promise<void> {
        await tree(page, { persons: { j: { ...jan, partnerships: [] } } });
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        await editor(page).locator('#input-source-title').fill('Ořez');
        await editor(page).locator('#source-excerpt-file').setInputFiles({
            name: 'scan.png', mimeType: 'image/png', buffer: await pngBuffer(page, width, height),
        });
        await expect(cropper(page)).toBeVisible();
        await expect(cropper(page).locator('.crop-frame')).toBeFocused();
    }

    async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
        await page.mouse.move(to.x, to.y);
        await page.mouse.up();
    }

    test('draw a new frame, resize it by a handle, move it; a too small frame cannot be used; Cancel adds nothing', async ({ page }) => {
        await openCropper(page, 1000, 1000);
        const wrap = (await cropper(page).locator('.crop-wrap').boundingBox())!;
        const frame = cropper(page).locator('.crop-frame');
        const size = cropper(page).locator('.crop-size');
        await expect(size).toHaveText('800 × 200 px · ≈ 19 kB');

        // Dragging outside the frame draws a new one.
        await drag(page, { x: wrap.x + wrap.width * 0.05, y: wrap.y + wrap.height * 0.05 },
            { x: wrap.x + wrap.width * 0.55, y: wrap.y + wrap.height * 0.25 });
        let f = (await frame.boundingBox())!;
        expect(f.x).toBeCloseTo(wrap.x + wrap.width * 0.05, -1);
        expect(f.width).toBeCloseTo(wrap.width * 0.5, -1);
        expect(f.height).toBeCloseTo(wrap.height * 0.2, -1);
        await expect(size).toHaveText(/^500 × 200 px/);

        // The south-east handle makes it bigger, the top left corner stays.
        const se = (await cropper(page).locator('.crop-h-se').boundingBox())!;
        await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 },
            { x: se.x + se.width / 2 + wrap.width * 0.1, y: se.y + se.height / 2 + wrap.height * 0.1 });
        const g = (await frame.boundingBox())!;
        expect(g.x).toBeCloseTo(f.x, 0);
        expect(g.width).toBeCloseTo(f.width + wrap.width * 0.1, -1);
        expect(g.height).toBeCloseTo(f.height + wrap.height * 0.1, -1);

        // Dragging inside moves it, the size stays.
        await drag(page, { x: g.x + g.width / 2, y: g.y + g.height / 2 },
            { x: g.x + g.width / 2 + wrap.width * 0.2, y: g.y + g.height / 2 + wrap.height * 0.3 });
        f = (await frame.boundingBox())!;
        expect(f.x).toBeCloseTo(g.x + wrap.width * 0.2, -1);
        expect(f.y).toBeCloseTo(g.y + wrap.height * 0.3, -1);
        expect(f.width).toBeCloseTo(g.width, 0);

        // A frame a few pixels big: "Use excerpt" is disabled, Enter does nothing.
        await drag(page, { x: wrap.x + wrap.width * 0.02, y: wrap.y + wrap.height * 0.9 },
            { x: wrap.x + wrap.width * 0.03, y: wrap.y + wrap.height * 0.91 });
        await expect(cropper(page).locator('.crop-buttons .crop-apply')).toBeDisabled();
        await frame.focus();
        await page.keyboard.press('Enter');
        await expect(cropper(page)).toBeVisible();

        // Tab stays inside the crop editor.
        for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            expect(await page.evaluate(() => !!document.activeElement?.closest('.crop-overlay'))).toBe(true);
        }

        await cropper(page).locator('.crop-buttons .crop-cancel').click();
        await expect(cropper(page)).toHaveCount(0);
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(0);
        await expect(editor(page)).toBeVisible();
    });

    test('zoom: buttons, the wheel, Fit and a double click; a turned page is cut turned; × closes without a result', async ({ page }) => {
        await openCropper(page, 1000, 500);
        const pct = cropper(page).locator('.crop-zoom-pct');
        await expect(pct).toHaveText('100 %');
        await cropper(page).locator('.crop-zoom-in').click();
        await expect(pct).toHaveText('125 %');
        await cropper(page).locator('.crop-zoom-in').click();
        await expect(pct).toHaveText('156 %');
        await cropper(page).locator('.crop-zoom-out').click();
        await expect(pct).toHaveText('125 %');
        await cropper(page).locator('.crop-fit').click();
        await expect(pct).toHaveText('100 %');
        // Zooming out below 100 % is not possible.
        await cropper(page).locator('.crop-zoom-out').click();
        await expect(pct).toHaveText('100 %');

        const stage = (await cropper(page).locator('.crop-stage').boundingBox())!;
        await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
        await page.mouse.wheel(0, -100);
        await expect(pct).toHaveText('115 %');
        await page.mouse.wheel(0, -100);
        await expect(pct).toHaveText('132 %');
        await cropper(page).locator('.crop-stage').dblclick({ position: { x: 4, y: 4 } });
        await expect(pct).toHaveText('100 %');

        // ↻ turns the page and the frame with it: 1000 × 500 becomes 500 × 1000,
        // the 800 × 100 band becomes a 100 × 800 strip.
        await cropper(page).locator('.crop-tools .crop-rot-r').click();
        await expect(cropper(page).locator('.crop-size')).toHaveText(/^100 × 800 px/);
        await cropper(page).locator('.crop-tools .crop-rot-l').click();
        await expect(cropper(page).locator('.crop-size')).toHaveText(/^800 × 100 px/);
        await cropper(page).locator('.crop-tools .crop-rot-l').click();
        await expect(cropper(page).locator('.crop-size')).toHaveText(/^100 × 800 px/);
        await cropper(page).locator('.crop-buttons .crop-apply').click();
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(1);
        await editor(page).getByRole('button', { name: 'Save' }).click();
        const exc = Object.values((await getData(page)).sources ?? {})[0].excerpts[0];
        expect([exc.width, exc.height]).toEqual([100, 800]);

        // × in the toolbar: no excerpt.
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        await editor(page).locator('#source-excerpt-file').setInputFiles({
            name: 'scan.png', mimeType: 'image/png', buffer: await pngBuffer(page, 600, 400),
        });
        await cropper(page).locator('.crop-close').click();
        await expect(cropper(page)).toHaveCount(0);
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(0);
    });
});

test.describe('the source viewer', () => {
    test('names each kind of place it supports, the record date and reliability; "Add excerpt" opens the editor at the excerpt block', async ({ page }) => {
        await tree(page, {
            persons: { j: { ...jan, events: [{ id: 'e1', type: 'baptism', date: '1865-03-14', sourceIds: ['s1'] }] }, m: marie },
            partnerships: { u1: { person1Id: 'j', person2Id: 'm', sourceIds: ['s1'], events: [{ id: 'c1', type: 'banns', date: '1888-01-22', sourceIds: ['s1'] }] } },
            sources: { s1: { title: 'Matrika Lhota', repository: 'SOA Zámrsk', recordDate: '1865-03-20', quality: 1 } },
        });
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        await catalog(page).locator('.source-row-open').click();
        const v = viewer(page);
        await expect(v).toBeVisible();
        await expect(v.locator('#source-viewer-meta')).toHaveText('SOA Zámrsk · recorded 3/20/1865 · Uncertain');
        await expect(v.locator('.viewer-cites li')).toHaveText([
            'Jan Novák — Baptism (1865)',
            'Marriage: Jan Novák and Marie Nováková',
            'Jan Novák & Marie Nováková — Banns (1888)',
        ]);
        await v.getByRole('button', { name: 'Add excerpt' }).click();
        await expect(v).toBeHidden();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('#source-excerpts button').first()).toBeFocused();
        await editor(page).getByRole('button', { name: 'Cancel' }).click();
        // Back to the viewer it came from.
        await expect(v).toBeVisible();
        await expect(v.locator('#source-viewer-title')).toHaveText('Matrika Lhota');
    });
});

test.describe('attachments beyond one image', () => {
    test('a small PDF is attached and opens as a PDF in a new tab; an image opens the viewer; another type is refused', async ({ page }) => {
        await tree(page, { persons: { j: { ...jan, partnerships: [] } } });
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        const list = modal.locator('#attachments-list');

        const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n%test\n'), Buffer.alloc(2048, 0x20)]);
        await modal.locator('#input-attachment').setInputFiles({ name: 'oddaci-list.pdf', mimeType: 'application/pdf', buffer: pdf });
        await expect(list.locator('.attachment-row')).toHaveCount(1);
        await expect(list.locator('.attachment-name')).toHaveText('oddaci-list.pdf');
        await expect(list.locator('.attachment-thumb')).toHaveAttribute('title', 'PDF');
        const att = (await getData(page)).persons.j.attachments[0];
        expect(att.mimeType).toBe('application/pdf');
        expect(att.dataUrl.startsWith('data:application/pdf;base64,')).toBe(true);

        // The new tab gets a blob URL typed as a PDF (no real tab is opened here).
        await page.evaluate(() => {
            (window as any).__opened = [];
            window.open = ((url: string) => { (window as any).__opened.push(url); return null; }) as typeof window.open;
        });
        await list.locator('.attachment-thumb').click();
        const opened = await page.evaluate(async () => {
            const urls = (window as any).__opened as string[];
            const blob = urls.length ? await (await fetch(urls[0])).blob() : null;
            return { urls, type: blob?.type, size: blob?.size };
        });
        expect(opened.urls).toHaveLength(1);
        expect(opened.urls[0]).toMatch(/^blob:/);
        expect(opened.type).toBe('application/pdf');
        expect(opened.size).toBe(pdf.length);

        await modal.locator('#input-attachment').setInputFiles('e2e/fixtures/avatar.png');
        await expect(list.locator('.attachment-row')).toHaveCount(2);
        await list.locator('.attachment-thumb img').click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
        await expect(modal).toBeVisible();

        await modal.locator('#input-attachment').setInputFiles({ name: 'poznamky.txt', mimeType: 'text/plain', buffer: Buffer.from('Jan') });
        await expect(confirmDlg(page).locator('#confirm-message')).toHaveText('Unsupported file type. Use JPG, PNG or PDF.');
        await confirmDlg(page).locator('#confirm-ok-btn').click();
        await expect(list.locator('.attachment-row')).toHaveCount(2);
        expect((await getData(page)).persons.j.attachments).toHaveLength(2);
    });

    test('an attachment from a foreign file that claims to be a PDF but is not one never opens', async ({ page }) => {
        await tree(page, { persons: { j: { ...jan, partnerships: [] } } });
        const jpeg = await jpegDataUrl(page, 40, 40);
        await page.evaluate((jpeg) => {
            window.Strom.DataManager.addAttachment('j' as never, { name: 'scan.pdf', mimeType: 'application/pdf', dataUrl: jpeg, sizeBytes: 900 });
            (window as any).__opened = [];
            window.open = ((url: string) => { (window as any).__opened.push(url); return null; }) as typeof window.open;
        }, jpeg);
        await cardAction(page, 'Jan', 'edit');
        await personModal(page).locator('#attachments-list .attachment-thumb').click();
        await expect(confirmDlg(page).locator('#confirm-message')).toHaveText('Unsupported file type. Use JPG, PNG or PDF.');
        await confirmDlg(page).locator('#confirm-ok-btn').click();
        expect(await page.evaluate(() => (window as any).__opened.length)).toBe(0);
    });
});
