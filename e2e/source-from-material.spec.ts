import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, materialSha, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE,
    FakeBridge, FakeMaterial, FakeMaterialFile,
} from './research-bridge.js';
import { openApp, seedTree } from './helpers.js';

/**
 * A source from a file (spec 102 §5-§7): "Create a source from this file…"
 * in the viewer and in Link to… (the evidence, the title from the file,
 * "Cite at" preselected, one undo step with the toast); the evidence from the
 * person's materials in a new source (groups, search over 12 files, hidden
 * without files); the source viewer's "Taken from" with the excerpt's file,
 * "×" and "Link evidence…"; material only in the archive through its working
 * copy from the bridge. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const win = (page: Page) => page.locator('#materials-modal');
const tile = (page: Page, text: string) => win(page).locator('.mw-canvas .mw-tile', { hasText: text });
const viewer = (page: Page) => page.locator('#attachment-overlay');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const act = (page: Page, id: string) => panel(page).locator(`.mv-act[data-action="${id}"]`);
const pill = (page: Page) => page.locator('body > .undo-toast.show');
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg');
const editor = (page: Page) => page.locator('#source-editor-modal');
const docs = (page: Page) => editor(page).locator('#source-docs');
const citeAt = (page: Page) => editor(page).locator('#source-cite-at');
const offer = (page: Page) => editor(page).locator('#source-offer');
const offerTile = (page: Page, text: string) => offer(page).locator('.source-offer-tile', { hasText: text });
const sourceViewer = (page: Page) => page.locator('#source-viewer-modal');

async function tree(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        p1: { firstName: 'Florimund', lastName: 'Pfefferkorn', partners: ['p2'] },
        p2: { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female' },
        p3: { firstName: 'Kasimir', lastName: 'Pfefferkorn', parents: ['p1', 'p2'], birthDate: '1925' },
    }, 'Pfefferkorn', 'p3');
}

/** A file at a person of the tree, with its title, kind and date (`big`: a page large enough to crop). */
function addFile(page: Page, personId: string, name: string, details: { title?: string; kind?: string; date?: string } = {}, big = false): Promise<string> {
    return page.evaluate(({ px, personId, name, details, big }) => {
        const dm = window.Strom.DataManager;
        let dataUrl = px;
        if (big) {
            const c = document.createElement('canvas');
            c.width = 800; c.height = 500;
            const ctx = c.getContext('2d')!;
            ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, 800, 500);
            ctx.fillStyle = '#333';
            for (let y = 40; y < 500; y += 60) ctx.fillRect(40, y, 720, 6);
            dataUrl = c.toDataURL('image/png');
        }
        const id = dm.addAttachment(personId as never, { name, mimeType: 'image/png', dataUrl, sizeBytes: dataUrl.length } as never)!.id as string;
        if (Object.keys(details).length) dm.setMediaDetails(id, details as never);
        return id;
    }, { px: PX, personId, name, details, big });
}

async function view(page: Page, text: string): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    await tile(page, text).click();
    await expect(viewer(page)).toHaveClass(/active/);
}

/** The "New source…" of the picker opened on a person (the editor with the person as its context). */
async function newSourceAt(page: Page, personId: string): Promise<void> {
    await page.evaluate((id) => (window.Strom.UI as unknown as { showSourcePickerForPersonId(id: string): void }).showSourcePickerForPersonId(id), personId);
    await page.locator('#source-picker-modal').getByRole('button', { name: 'New source…' }).click();
    await expect(editor(page)).toBeVisible();
}

const placesOf = (page: Page, id: string) => page.evaluate((id) => JSON.stringify(window.Strom.DataManager.getMedia(id)?.places ?? []), id).then(s => JSON.parse(s) as Record<string, string>[]);
const sources = (page: Page) => page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources ?? {}) as { id: string; title: string; recordDate?: string }[]);
const birthSources = (page: Page, id: string) => page.evaluate((id) => window.Strom.DataManager.getPerson(id as never)?.birthSourceIds ?? [], id);

test.describe('A source from a file of the tree', () => {
    test.use({ viewport: DESKTOP });

    test('from the viewer: the title, the evidence, cited at the birth of the record\'s year; one undo step', async ({ page }) => {
        await tree(page);
        const id = await addFile(page, 'p3', 'krest.png', { title: 'Křestní list', kind: 'record', date: '3 FEB 1925' });
        await view(page, 'Křestní list');
        await expect(act(page, 'makeSource')).toHaveText('Create a source from this file…');
        await act(page, 'makeSource').click();
        await expect(editor(page)).toBeVisible();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(editor(page).locator('#input-source-title')).toHaveValue('Křestní list');
        await expect(editor(page).locator('#source-title-from-file')).toBeVisible();
        await expect(docs(page).locator('.source-doc-card')).toHaveCount(1);
        await expect(docs(page).locator('.source-doc-title')).toHaveText('Křestní list');
        await expect(docs(page).getByRole('button', { name: 'Cut an excerpt' })).toBeVisible();
        await expect(citeAt(page).locator('.source-cite-chip')).toContainText('Kasimir Pfefferkorn');
        await expect(citeAt(page).locator('#source-cite-event option:checked')).toHaveText('Birth · 1925');

        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Source created: Křestní list, cited at Birth.');
        const [src] = await sources(page);
        expect(src).toMatchObject({ title: 'Křestní list', recordDate: '1925-02-03' });
        expect(await placesOf(page, id)).toEqual([{ personId: 'p3' }, { sourceId: src.id }]);
        expect(await birthSources(page, 'p3')).toEqual([src.id]);

        // One step back: no source, the file only at the person, no citation.
        await pill(page).locator('.undo-toast-btn').click();
        await expect.poll(() => sources(page).then(s => s.length)).toBe(0);
        expect(await placesOf(page, id)).toEqual([{ personId: 'p3' }]);
        expect(await birthSources(page, 'p3')).toEqual([]);
    });

    test('from Link to…: a file without a title, the citation taken off; cut from the evidence; the viewer shows where the excerpt is from', async ({ page }) => {
        await tree(page);
        const id = await addFile(page, 'p3', 'list.png', {}, true);
        await view(page, 'list.png');
        await act(page, 'attach').click();
        await dialog(page).locator('.mdlg-seg [data-target="source"]').click();
        await dialog(page).getByRole('button', { name: 'New source from this file…' }).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('#input-source-title')).toHaveValue('');
        await expect(editor(page).locator('#input-source-title')).toHaveAttribute('placeholder', 'list.png');
        await expect(editor(page).locator('#source-title-from-file')).toBeHidden();
        await expect(citeAt(page).locator('#source-cite-event option:checked')).toHaveText('No event');
        await citeAt(page).getByRole('button', { name: 'Do not cite at Kasimir Pfefferkorn' }).click();
        await expect(citeAt(page).locator('.source-cite-none')).toHaveText('Cited nowhere');

        // The excerpt block cuts from the evidence: the crop editor opens on it.
        await editor(page).getByRole('button', { name: 'Cut from the evidence' }).click();
        await expect(page.locator('.crop-overlay')).toBeVisible();
        await page.locator('.crop-overlay .crop-buttons .crop-apply').click();
        await expect(page.locator('.crop-overlay')).toHaveCount(0);
        await expect(editor(page).locator('.excerpt-from')).toHaveText('Excerpt cut from list.png ›');
        await editor(page).locator('#input-source-title').fill('Zápis o narození');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Source created: Zápis o narození.');
        const [src] = await sources(page);
        expect(await placesOf(page, id)).toEqual([{ personId: 'p3' }, { sourceId: src.id }]);
        expect(await birthSources(page, 'p3')).toEqual([]);

        await page.evaluate((sid) => window.Strom.UI.showSourceViewer(sid, null), src.id);
        await expect(sourceViewer(page)).toHaveClass(/active/);
        const from = sourceViewer(page).locator('.viewer-from');
        await expect(from.locator('.viewer-section-title')).toHaveText('Taken from');
        await expect(from.locator('.viewer-doc-title')).toHaveText('list.png');
        await expect(from.locator('.viewer-doc-meta')).toContainText('evidence, the excerpt is from here');
        await expect(sourceViewer(page).locator('.excerpt-from')).toHaveText('Excerpt cut from list.png ›');
    });

    test('a PDF: the evidence opens it, no excerpt to cut', async ({ page }) => {
        await tree(page);
        await page.evaluate(() => window.Strom.DataManager.addAttachment('p3' as never,
            { name: 'kronika.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK', sizeBytes: 9 } as never));
        // From the ⋯ of the person's attachment row.
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
            ui.pushDialog('person-modal');
            ui.showEditPersonModal('p3');
        });
        await page.locator('#person-modal .attachment-more').click();
        await page.locator('#materials-item-menu [data-action="makeSource"]').click();
        await expect(editor(page)).toBeVisible();
        await expect(docs(page).getByRole('button', { name: 'Open PDF ↗' })).toBeVisible();
        await expect(docs(page).getByRole('button', { name: 'Cut an excerpt' })).toHaveCount(0);
        await expect(editor(page).getByRole('button', { name: 'Cut from the evidence' })).toHaveCount(0);
    });
});

test.describe('The evidence from the person\'s materials', () => {
    test.use({ viewport: DESKTOP });

    test('a new source at a person: files without a source and with another one; the chosen file is the evidence', async ({ page }) => {
        await tree(page);
        const letter = await addFile(page, 'p3', 'dopis.png', { title: 'Dopis z Quellbachu' });
        const register = await addFile(page, 'p3', 'matrika.png');
        await page.evaluate((id) => {
            const dm = window.Strom.DataManager;
            const src = dm.addSource({ title: 'Matrika Quellbach' } as never)!;
            dm.addMediaPlace(id, { sourceId: src.id });
        }, register);
        await newSourceAt(page, 'p3');
        await expect(offer(page)).toBeVisible();
        await expect(offer(page).locator('.source-offer-title-main')).toHaveText('Evidence from the person’s materials');
        await expect(offer(page).locator('.source-offer-sub')).toHaveText('Kasimir Pfefferkorn · 2 files');
        await expect(offer(page).locator('.source-offer-group')).toHaveText(['Without source · 1', 'With another source · 1']);
        await expect(offer(page).locator('.source-offer-search')).toHaveCount(0);
        await expect(docs(page).locator('.source-doc-card')).toHaveCount(0);
        await offerTile(page, 'Dopis z Quellbachu').click();
        await expect(offerTile(page, 'Dopis z Quellbachu')).toHaveAttribute('aria-pressed', 'true');
        await expect(docs(page).locator('.source-doc-title')).toHaveText('Dopis z Quellbachu');
        await editor(page).locator('#input-source-title').fill('Dopis o Kasimirovi');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        const made = (await sources(page)).find(s => s.title === 'Dopis o Kasimirovi')!;
        expect(await placesOf(page, letter)).toEqual([{ personId: 'p3' }, { sourceId: made.id }]);
        expect(await placesOf(page, register)).toHaveLength(2);
    });

    test('over 12 files a search; a person without files has no block', async ({ page }) => {
        await tree(page);
        for (let i = 1; i <= 13; i++) await addFile(page, 'p3', `strana-${i}.png`);
        await newSourceAt(page, 'p3');
        await expect(offer(page)).toHaveClass(/is-many/);
        await offer(page).locator('.source-offer-search').fill('strana-13');
        await expect(offer(page).locator('.source-offer-tile')).toHaveCount(1);
        await expect(offer(page).locator('.source-offer-search')).toBeFocused();
        await editor(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(editor(page)).toBeHidden();

        await newSourceAt(page, 'p1');
        await expect(offer(page)).toBeHidden();
        await expect(docs(page)).toBeHidden();
    });
});

test.describe('The source viewer: Taken from', () => {
    test.use({ viewport: DESKTOP });

    test('× takes the evidence off with Undo; without evidence "Link evidence…" opens the editor with the offer', async ({ page }) => {
        await tree(page);
        const id = await addFile(page, 'p3', 'matrika.png');
        const sid = await page.evaluate((id) => {
            const dm = window.Strom.DataManager;
            const src = dm.addSource({ title: 'Matrika Quellbach' } as never)!;
            dm.citePerson('p3' as never, src.id, 'birth');
            dm.addMediaPlace(id, { sourceId: src.id });
            return src.id as string;
        }, id);
        await page.evaluate((sid) => window.Strom.UI.showSourceViewer(sid, null), sid);
        const from = sourceViewer(page).locator('.viewer-from');
        await expect(from.locator('.viewer-doc')).toHaveCount(1);
        await expect(from.locator('.viewer-doc-meta')).toContainText('matrika.png ·');
        await expect(from.locator('.viewer-doc-meta')).toContainText('· evidence');
        await from.getByRole('button', { name: 'Remove the evidence: matrika.png' }).click();
        await expect(pill(page).locator('.undo-toast-msg')).toContainText('matrika.png');
        await expect(from.locator('.viewer-doc')).toHaveCount(0);
        await expect(from.locator('.viewer-no-doc p')).toHaveText('No evidence. The file the source is taken from is not here yet.');
        expect(await placesOf(page, id)).toEqual([{ personId: 'p3' }]);

        await from.getByRole('button', { name: 'Link evidence…' }).click();
        await expect(editor(page)).toBeVisible();
        await expect(offer(page)).toBeVisible();
        await offerTile(page, 'matrika.png').click();
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        expect(await placesOf(page, id)).toEqual([{ personId: 'p3' }, { sourceId: sid }]);
    });
});

test.describe('On a phone', () => {
    test.use({ viewport: PHONE });

    test('the offer is one row of tiles; All (N) opens the whole grid as a sheet from the bottom', async ({ page }) => {
        await tree(page);
        for (let i = 1; i <= 5; i++) await addFile(page, 'p3', `strana-${i}.png`);
        await newSourceAt(page, 'p3');
        const all = offer(page).getByRole('button', { name: 'All (5) ›' });
        await expect(all).toBeVisible();
        const tops = (root: ReturnType<typeof offer>) => root.locator('.source-offer-tile')
            .evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size);
        expect(await tops(offer(page))).toBe(1);
        await all.click();

        // A sheet of its own over the editor, not the editor's block opened up.
        const sheet = page.locator('.mdlg--offer-all');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.mdlg-title')).toHaveText('Evidence from the person’s materials');
        await expect(offer(page)).not.toHaveClass(/is-all/);
        expect(await tops(offer(page))).toBe(1);
        expect(await tops(sheet)).toBeGreaterThan(1);
        const box = await sheet.boundingBox();
        expect(Math.round(box!.y + box!.height)).toBe(844);
        expect(Math.round(box!.width)).toBe(390);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        // A tile chosen in the sheet is chosen in the editor too, the focus stays on it.
        const tile = sheet.locator('.source-offer-tile', { hasText: 'strana-3.png' });
        await tile.click();
        await expect(tile).toHaveAttribute('aria-pressed', 'true');
        await expect(tile).toBeFocused();
        await expect(offerTile(page, 'strana-3.png')).toHaveAttribute('aria-pressed', 'true');

        // Esc closes only the sheet; Done does the same, back to All (N).
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(editor(page)).toBeVisible();
        await expect(all).toBeFocused();
        await all.click();
        await page.locator('.mdlg--offer-all').getByRole('button', { name: 'Done' }).click();
        await expect(page.locator('.mdlg--offer-all')).toHaveCount(0);
        await expect(editor(page)).toBeVisible();
        await expect(offerTile(page, 'strana-3.png')).toHaveAttribute('aria-pressed', 'true');
    });
});

// ==================== BESIDE AN ARCHIVE ====================

const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };

async function research(page: Page, files: FakeMaterialFile[]): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({ files, batches: [], people: PEOPLE });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: MATERIAL_FEATURES, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    return { bridge, material };
}

/** The tree's stand-in image of a file whose original is only in the archive (validation.ts ORIGINAL_ONLY_DATA_URL). */
const ORIGINAL_ONLY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAaklEQVR42u3YsQ2AMAwEwOw/AGuwGDtAQRsky2Aw0n3h+qT/NBlbswwgICCgyyzhvAfaA7lpKgGdtxcobSoE5Uy1oISpatTpd/c8aEoEAmoPWgNRGZBRqwzIqFUGBAT0PSgdP2hAQED/AR2hzcxJL1f+tQAAAABJRU5ErkJggg==';

const treeRecordOf = (page: Page, sha: string) => page.evaluate((sha) => {
    const att = (Object.values(window.Strom.DataManager.getData().media ?? {}) as { original?: { sha256: string }; places: Record<string, string>[] }[])
        .find(a => a.original?.sha256 === sha);
    return att ? att.places.map(p => Object.keys(p).join()) : null;
}, sha);

test.describe('A source from material only in the archive', () => {
    test.use({ viewport: DESKTOP });

    test('the working copy comes from the bridge and is linked on Save, cited at the archive\'s person; the research is not written', async ({ page }) => {
        const sha = materialSha('I0001');
        const { material } = await research(page, [materialFile(1, { title: 'Křest', persons: ['P0003'] })]);
        await view(page, 'Křest');
        await act(page, 'makeSource').click();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('#input-source-title')).toHaveValue('Křest');
        await expect(docs(page).locator('.source-doc-title')).toHaveText('Křest');
        await expect(citeAt(page).locator('.source-cite-chip')).toContainText('Jan Fíšek');
        // Nothing in the tree before Save.
        expect(await treeRecordOf(page, sha)).toBeNull();
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Source created: Křest, cited at Jan Fíšek.');
        await expect.poll(() => treeRecordOf(page, sha)).toEqual(['sourceId', 'personId']);
        expect(material.assigns).toHaveLength(0);
    });

    test('a new source at a person: the research\'s material in the offer shows its preview from the bridge', async ({ page }) => {
        const { material } = await research(page, [materialFile(1, { title: 'Křest', persons: ['P0003'] })]);
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await expect(tile(page, 'Křest')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(win(page)).toHaveCount(0);
        const jan = await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);
        await newSourceAt(page, jan);
        const offerTile = page.locator('#source-offer .source-offer-tile', { hasText: 'Křest' });
        await expect(offerTile).toBeVisible();
        await expect(offerTile.locator('.source-offer-thumb img')).toHaveCount(1);
        expect(material.thumbAsks.length).toBeGreaterThan(0);
    });

    test('evidence whose original is only in the archive: its card offers Open in system (5e)', async ({ page }) => {
        const sha = materialSha('I0001');
        await research(page, [materialFile(1, { title: 'Kronika', persons: ['P0003'], mime: 'image/tiff', name: 'kronika.tif' })]);
        const jan = await page.evaluate(({ sha, url }) => {
            const dm = window.Strom.DataManager;
            const id = (Object.values(dm.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id;
            dm.addAttachment(id as never, {
                name: 'kronika.tif', mimeType: 'image/tiff', dataUrl: url, sizeBytes: 70, originalOnly: true,
                original: { sha256: sha, name: 'kronika.tif', mimeType: 'image/tiff', bytes: 70 },
            } as never);
            return id;
        }, { sha, url: ORIGINAL_ONLY });
        await newSourceAt(page, jan);
        await page.locator('#source-offer .source-offer-tile').first().click();
        const card = docs(page).locator('.source-doc-card');
        await expect(card).toHaveCount(1);
        await expect(card.locator('[data-doc-act="system"]')).toContainText('Open in system');
        await expect(card.locator('[data-doc-act="cut"]')).toHaveCount(0);
    });

    test('the research stopped: the action is off for material outside the tree', async ({ page }) => {
        const { bridge } = await research(page, [materialFile(1, { title: 'Křest' })]);
        bridge.down = true;
        await poll(page);
        await view(page, 'Křest');
        await expect(act(page, 'makeSource')).toHaveAttribute('aria-disabled', 'true');
        await act(page, 'makeSource').click({ force: true });
        await expect(editor(page)).toBeHidden();
    });
});
