import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, materialSha, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE,
    FakeBridge, FakeMaterial, FakeMaterialFile,
} from './research-bridge.js';
import { openApp, seedTree, cardAction, personModal } from './helpers.js';

/**
 * "Where used" of a material (spec 102 §3): in the viewer's panel and in the
 * Attachment dialog the file's places, the portrait and the excerpt cut from
 * it, in the order persons, portraits, unions, events, sources, excerpts;
 * over five places the first four and "+ N more"; each a link, a place of
 * its own with "×" (a toast with Undo; the last place of a file nothing
 * else keeps asks first); none in a locked tree. Beside an archive: "In the
 * tree" and "In the archive" with the people the archive assigned and the
 * research's uses (`material.uses`, "as of" while the research is stopped,
 * the older research's sentence without the gate). Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const win = (page: Page) => page.locator('#materials-modal');
const tile = (page: Page, text: string) => win(page).locator('.mw-canvas .mw-tile', { hasText: text });
const viewer = (page: Page) => page.locator('#attachment-overlay');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const uses = (page: Page) => panel(page).locator('.mv-uses');
const types = (root: ReturnType<Page['locator']>) => root.locator('.mv-use-type').allTextContents();
const links = (root: ReturnType<Page['locator']>) => root.locator('.mv-use-link').allTextContents();
const pill = (page: Page) => page.locator('body > .undo-toast.show');
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg');

async function tree(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        p1: { firstName: 'Florimund', lastName: 'Pfefferkorn', partners: ['p2'] },
        p2: { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female' },
        p3: { firstName: 'Kasimir', lastName: 'Pfefferkorn', parents: ['p1', 'p2'], birthDate: '1925' },
    }, 'Pfefferkorn', 'p3');
}

/**
 * The wedding photo at eight uses: Florimund, Quirinella and Kasimir, the
 * union, Kasimir's birth, the register (places), Kasimir's portrait and an
 * excerpt of the register cut from it; Kasimir's letter only at him.
 */
async function files(page: Page): Promise<{ wedding: string; letter: string }> {
    return page.evaluate(({ px }) => {
        const dm = window.Strom.DataManager;
        const file = (name: string) => ({ name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70 });
        const wedding = dm.addAttachment('p1' as never, file('svatba.png'))!;
        const data = dm.getData();
        const union = Object.keys(data.partnerships)[0];
        const source = dm.addSource({ title: 'Matrika Quellbach' } as never)!;
        dm.addMediaPlace(wedding.id, { personId: 'p2' as never });
        dm.addMediaPlace(wedding.id, { personId: 'p3' as never });
        dm.addMediaPlace(wedding.id, { partnershipId: union as never });
        dm.addMediaPlace(wedding.id, { personId: 'p3' as never, fact: 'birth' } as never);
        dm.addMediaPlace(wedding.id, { sourceId: source.id } as never);
        (data.persons as Record<string, { photoSource?: unknown }>).p3.photoSource = { attachmentId: wedding.id, x: 0, y: 0, w: 1, h: 1 };
        (data.sources as Record<string, { excerpts?: unknown[] }>)[source.id].excerpts = [
            { id: 'x1', dataUrl: px, width: 1, height: 1, sizeBytes: 70, fromAttachmentId: wedding.id },
        ];
        const letter = dm.addAttachment('p3' as never, file('dopis.png'))!;
        return { wedding: wedding.id as string, letter: letter.id as string };
    }, { px: PX });
}

async function view(page: Page, text: string): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    await tile(page, text).click();
    await expect(viewer(page)).toHaveClass(/active/);
    await expect(uses(page)).toBeVisible();
}

const placesOf = (page: Page, id: string) => page.evaluate((id) => window.Strom.DataManager.getMedia(id)?.places.length ?? 0, id);

test.describe('Where used, a tree without a research', () => {
    test.use({ viewport: DESKTOP });

    test('eight uses: the first four and "+ 4 more", in their order with their sentences; portrait and excerpt without ×', async ({ page }) => {
        await tree(page);
        await files(page);
        await view(page, 'svatba.png');
        await expect(uses(page).locator('.mv-uses-title')).toHaveText('Where used');
        await expect(uses(page).locator('.mv-uses-count')).toHaveText('8 places');
        // Without an archive no "In the tree" / "In the archive".
        await expect(uses(page).locator('.mv-uses-sub')).toHaveCount(0);
        expect(await types(uses(page))).toEqual(['Person', 'Person', 'Person', 'Portrait']);
        const more = uses(page).locator('.mv-uses-more');
        await expect(more).toHaveText('+ 4 more');
        await more.click();
        expect(await types(uses(page))).toEqual(['Person', 'Person', 'Person', 'Portrait', 'Union', 'Event', 'Source', 'Excerpt']);
        expect(await links(uses(page))).toEqual([
            'Florimund Pfefferkorn', 'Quirinella Pfefferkornová', 'Kasimir Pfefferkorn', 'Kasimir Pfefferkorn',
            'Florimund Pfefferkorn and Quirinella Pfefferkornová', 'Birth 1925 · Kasimir Pfefferkorn', 'Matrika Quellbach', 'Matrika Quellbach',
        ]);
        await expect(uses(page).locator('.mv-use-sub')).toHaveText(['cut from this file', 'evidence', 'excerpt cut from this file']);
        await expect(uses(page).locator('.mv-use-link.is-person')).toHaveCount(4);
        // Six places of its own with ×; the portrait and the excerpt have none.
        await expect(uses(page).locator('.mv-use-x')).toHaveCount(6);
        await expect(uses(page).locator('.mv-use-x').nth(1)).toHaveAttribute('aria-label', 'Unlink: Quirinella Pfefferkornová');
        // The old sentences gave way to where the file is kept.
        await expect(panel(page).locator('.mv-sentence')).toHaveText('The file is only in this browser. Backup: Export all.');
    });

    test('a source cited at a birth: its row says "evidence · cited at Birth" (5d)', async ({ page }) => {
        await tree(page);
        await files(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const src = (Object.values(dm.getData().sources ?? {}) as { id: string; title: string }[]).find(s => s.title === 'Matrika Quellbach')!;
            dm.citePerson('p3' as never, src.id, 'birth' as never);
        });
        await view(page, 'svatba.png');
        await uses(page).locator('.mv-uses-more').click();
        await expect(uses(page).locator('.mv-use-sub')).toHaveText(['cut from this file', 'evidence · cited at Birth', 'excerpt cut from this file']);
    });

    test('a read-only tree (spec 102 §12g): Where used with its links, no pencil, no ×, no action but Download', async ({ page }) => {
        await tree(page);
        await files(page);
        await page.evaluate(() => { window.Strom.DataManager.isReadOnly = () => true; });
        await view(page, 'svatba.png');
        await expect(uses(page).locator('.mv-uses-count')).toHaveText('8 places');
        await expect(uses(page).locator('.mv-use-link').first()).toBeEnabled();
        await expect(uses(page).locator('.mv-use-x')).toHaveCount(0);
        await expect(panel(page).locator('.mv-edit')).toHaveCount(0);
        expect(await panel(page).locator('.mv-act').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.action))).toEqual(['download']);
    });

    test('× takes the file off one place: the toast with Undo, the block redrawn; Undo brings the place back', async ({ page }) => {
        await tree(page);
        const { wedding } = await files(page);
        await view(page, 'svatba.png');
        expect(await placesOf(page, wedding)).toBe(6);
        await uses(page).locator('.mv-use-x').nth(1).click();
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Removed: Quirinella Pfefferkornová from svatba.png.');
        expect(await placesOf(page, wedding)).toBe(5);
        await expect(uses(page).locator('.mv-uses-count')).toHaveText('7 places');
        await expect(viewer(page)).toHaveClass(/active/);
        await pill(page).locator('.undo-toast-btn').first().click();
        await expect.poll(() => placesOf(page, wedding)).toBe(6);
        await expect(uses(page).locator('.mv-uses-count')).toHaveText('8 places');
    });

    test('the last place of a file nothing else keeps asks first (Delete the file); confirmed, the file goes with Undo', async ({ page }) => {
        await tree(page);
        const { letter } = await files(page);
        await view(page, 'dopis.png');
        await expect(uses(page).locator('.mv-uses-count')).toHaveText('1 place');
        await uses(page).locator('.mv-use-x').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Delete the file from the tree?');
        await expect(dialog(page).locator('.mdlg-rm-app')).toHaveText('The file is not stored anywhere else. Only Undo or a backup (Export all) brings it back.');
        await dialog(page).getByRole('button', { name: 'Delete the file' }).click();
        await expect.poll(() => page.evaluate((id) => !!window.Strom.DataManager.getMedia(id), letter)).toBe(false);
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Deleted: dopis.png.');
        await pill(page).locator('.undo-toast-btn').click();
        await expect.poll(() => page.evaluate((id) => window.Strom.DataManager.getMedia(id)?.places.length ?? 0, letter)).toBe(1);
    });

    test('a person\'s link closes the viewer and the window and focuses them; a source\'s link opens the source', async ({ page }) => {
        await tree(page);
        await files(page);
        await view(page, 'svatba.png');
        await uses(page).locator('.mv-use-link', { hasText: 'Quirinella' }).click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(win(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('p2');

        await view(page, 'svatba.png');
        await uses(page).locator('.mv-uses-more').click();
        await uses(page).locator('.mv-use-link[data-use="source"]').click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(page.locator('#source-viewer-modal')).toBeVisible();
        await expect(page.locator('#source-viewer-modal')).toContainText('Matrika Quellbach');
    });

    test('a locked tree: the links stay, no ×', async ({ page }) => {
        await tree(page);
        await files(page);
        await page.evaluate(() => window.Strom.TreeManager.toggleTreeLock(window.Strom.DataManager.getCurrentTreeId()!));
        await view(page, 'svatba.png');
        await expect(uses(page).locator('.mv-use-link')).toHaveCount(4);
        await expect(uses(page).locator('.mv-use-x')).toHaveCount(0);
    });

    test('the Attachment dialog shows "Where used"; × there draws it again', async ({ page }) => {
        await tree(page);
        const { wedding } = await files(page);
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await cardAction(page, 'Florimund', 'edit');
        await expect(personModal(page)).toBeVisible();
        const row = page.locator('#person-modal #attachments-list .attachment-row', { hasText: 'svatba.png' });
        await row.locator('.attachment-more').click();
        await page.locator('#materials-item-menu [data-action="edit"]').click();
        await expect(dialog(page)).toBeVisible();
        const block = dialog(page).locator('.mv-uses');
        await expect(block.locator('.mv-uses-count')).toHaveText('8 places');
        await expect(block.locator('.mv-uses-more')).toHaveText('+ 4 more');
        await block.locator('.mv-use-x').nth(2).click();
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Removed: Kasimir Pfefferkorn from svatba.png.');
        await expect(dialog(page).locator('.mv-uses-count')).toHaveText('7 places');
        expect(await placesOf(page, wedding)).toBe(5);
        await expect(dialog(page)).toBeVisible();
    });
});

// ==================== BESIDE AN ARCHIVE ====================

const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };
const USES_FEATURES = [...MATERIAL_FEATURES, 'material.uses'];
const USES = { excerpts: 3, sources: ['S0001'], tasks: 2 };

async function research(page: Page, opts: { features?: string[]; files?: FakeMaterialFile[] } = {}): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({ files: opts.files ?? [], batches: [], people: PEOPLE });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: opts.features ?? USES_FEATURES, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    return { bridge, material };
}

test.describe('Where used beside an archive', () => {
    test.use({ viewport: DESKTOP });

    test('a file only in the archive: nowhere in the tree; the archive\'s people and the research\'s uses', async ({ page }) => {
        await research(page, { files: [materialFile(1, { persons: ['P0003'], uses: USES })] });
        await view(page, 'scan-1.jpg');
        await expect(uses(page).locator('.mv-uses-sub')).toHaveText(['In the tree', 'In the archive']);
        await expect(uses(page).locator('.mv-uses-none')).toHaveText('Not in the tree yet. Link to…');
        await expect(uses(page).locator('.mv-uses-count')).toHaveCount(0);
        await expect(uses(page).locator('.mv-uses-persons .mv-label')).toHaveText('Assigned in the archive');
        await expect(uses(page).locator('.mv-chip')).toHaveText(['Jan Fíšek×']);
        await expect(uses(page).locator('.mv-uses-arch')).toHaveText('3 excerpts in the research · 1 research source · 2 open tasks');
        await expect(panel(page).locator('.mv-body > .mv-sentence').first()).toHaveText('The file is only in the research so far. Linked, it is also in the tree: in exports, the book and on the phone.');
    });

    test('the research stopped: the remembered uses with the time they are from', async ({ page }) => {
        const { bridge } = await research(page, { files: [materialFile(1, { persons: ['P0003'], uses: USES })] });
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await expect(tile(page, 'scan-1.jpg')).toBeVisible();
        bridge.down = true;
        await poll(page);
        await tile(page, 'scan-1.jpg').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(uses(page).locator('.mv-uses-arch')).toHaveText(/^3 excerpts in the research · 1 research source · 2 open tasks · as of \d{1,2}:\d{2}/);
    });

    test('an older research without material.uses: its sentence, faint', async ({ page }) => {
        await research(page, { features: MATERIAL_FEATURES, files: [materialFile(1, { persons: ['P0003'], uses: USES })] });
        await view(page, 'scan-1.jpg');
        await expect(uses(page).locator('.mv-uses-arch.is-faint')).toHaveText('A newer version of the research shows the uses in the archive.');
    });

    test('the tree\'s file whose original the archive keeps: its places; × on the last one keeps the file in the archive without asking', async ({ page }) => {
        const sha = materialSha('I0001');
        await research(page, { files: [materialFile(1, { persons: ['P0003'], uses: USES })] });
        const id = await page.evaluate(({ px, sha }) => {
            const dm = window.Strom.DataManager;
            const jan = (Object.values(dm.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id;
            const att = dm.addAttachment(jan as never, { name: 'scan-1.jpg', mimeType: 'image/png', dataUrl: px, sizeBytes: 70,
                original: { sha256: sha, name: 'scan-1.jpg', mimeType: 'image/jpeg', bytes: 400_001 } } as never)!;
            return att.id as string;
        }, { px: PX, sha });
        await view(page, 'scan-1.jpg');
        await expect(uses(page).locator('.mv-uses-sub')).toHaveText(['In the tree', 'In the archive']);
        expect(await links(uses(page))).toEqual(['Jan Fíšek']);
        // The archive's people are the tree's rows for a file in both.
        await expect(uses(page).locator('.mv-chip')).toHaveCount(0);
        await uses(page).locator('.mv-use-x').click();
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Removed: Jan Fíšek from scan-1.jpg. The file stays only in the research.');
        await expect.poll(() => page.evaluate((id) => window.Strom.DataManager.getMedia(id)?.places.length ?? 0, id)).toBe(0);
    });
});
