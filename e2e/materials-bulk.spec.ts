import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE,
    FakeMaterial,
} from './research-bridge.js';
import { openApp, seedTree } from './helpers.js';

/**
 * Going through many files at once (spec 102 §8): the review filters with
 * their counts (Without title, Without source; In the tree / Only in the
 * archive beside an archive), selecting ("Linka", Ctrl/⌘+A takes what the
 * filters show), Title… / Kind… / Date… over the selection in one undo step
 * (the research's files through material.edit, by value), Go through in the
 * viewer (Enter and → save and go on, Skip, Esc ends) and the list's
 * columns sorted by their header (aria-sort, Enter). Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DAY = 86_400_000;

const win = (page: Page) => page.locator('#materials-modal');
const tiles = (page: Page) => win(page).locator('.mw-canvas .mw-tile');
const tile = (page: Page, text: string) => tiles(page).filter({ hasText: text });
const bar = (page: Page) => win(page).locator('.mw-selbar');
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg');
const toast = (page: Page) => page.locator('.toast[data-kind="materials"]');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const viewer = (page: Page) => page.locator('#attachment-overlay');

/** A tree of three people and three files of its own: one titled, one at a source only. */
async function appTree(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        p1: { firstName: 'Florimund', lastName: 'Pfefferkorn', partners: ['p2'] },
        p2: { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female' },
        p3: { firstName: 'Kasimir', lastName: 'Pfefferkorn', parents: ['p1', 'p2'] },
    }, 'Pfefferkorn', 'p3');
    await page.evaluate(({ px, day }) => {
        const dm = window.Strom.DataManager;
        const at = (days: number) => new Date(Date.now() - days * day).toISOString();
        const file = (name: string, days: number) => ({ name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70, addedAt: at(days) });
        const a = dm.addAttachment('p1' as never, file('svatba.png', 1))!;
        dm.setMediaDetails(a.id, { title: 'Wedding at Quellbach' });
        dm.addAttachment('p3' as never, file('dopis.png', 1));
        const source = dm.addSource({ title: 'Matrika Quellbach' } as never)!;
        dm.addAttachment('p3' as never, file('matrika.png', 1), source.id);
    }, { px: PX, day: DAY });
}

const titles = (page: Page) => page.evaluate(() => {
    const dm = window.Strom.DataManager;
    const out: Record<string, string | null> = {};
    for (const p of Object.values(dm.getData().persons) as { id: string }[]) {
        for (const a of dm.personMedia(p.id as never)) out[a.name] = a.title ?? null;
    }
    return out;
});

const details = (page: Page) => page.evaluate(() => {
    const dm = window.Strom.DataManager;
    const out: Record<string, [string | null, string | null]> = {};
    for (const p of Object.values(dm.getData().persons) as { id: string }[]) {
        for (const a of dm.personMedia(p.id as never)) out[a.name] = [a.kind ?? null, a.date ?? null];
    }
    return out;
});

async function openWindow(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
}

test.describe('Going through many files (a tree without a research)', () => {
    test.use({ viewport: DESKTOP });

    test('review filters with counts; Ctrl/⌘+A selects what they show; the selection is a line, not a colour', async ({ page }) => {
        await appTree(page);
        await openWindow(page);
        await expect(tiles(page)).toHaveCount(3);
        const noTitle = win(page).locator('.mw-chips-review [data-mw="notitle"]');
        const noSource = win(page).locator('.mw-chips-review [data-mw="nosource"]');
        await expect(noTitle).toHaveText('Without title · 2');
        await expect(noSource).toHaveText('Without source · 2');
        // Beside no archive there is no "In the tree / Only in the archive".
        await expect(win(page).locator('[data-mw="where-tree"], [data-mw="where-archive"]')).toHaveCount(0);
        await noTitle.click();
        await expect(noTitle).toHaveAttribute('aria-pressed', 'true');
        await expect(tiles(page)).toHaveCount(2);
        await noSource.click();
        await expect(tiles(page)).toHaveCount(1);
        await expect(tile(page, 'dopis.png')).toBeVisible();
        await noSource.click();
        // Ctrl/⌘+A: the two files the filter shows.
        await tile(page, 'dopis.png').focus();
        await page.keyboard.press('ControlOrMeta+a');
        await expect(win(page)).toHaveClass(/is-selecting/);
        await expect(bar(page).locator('.mw-selcount')).toHaveText('2 files selected');
        const look = await win(page).locator('.mw-tile.is-selected').first().evaluate(el => {
            const cs = getComputedStyle(el);
            return { shadow: cs.boxShadow, bg: cs.backgroundColor };
        });
        // "Linka": a line of the text colour around the tile (no green).
        expect(look.shadow).toContain('6px');
        expect(look.shadow).not.toContain('rgb(63, 107, 79)');
        expect(look.bg).not.toBe('rgba(0, 0, 0, 0)');
        // The filters are remembered, the person and the search not.
        await page.keyboard.press('Escape');
        expect(JSON.parse(await page.evaluate(() => localStorage.getItem('strom.materials.view') ?? '{}')).filters).toEqual({ noTitle: true });
    });

    test('Title… numbers the selected untitled files in the window\'s order, one undo step; Kind… and Date…', async ({ page }) => {
        await appTree(page);
        await openWindow(page);
        await win(page).locator('[data-mw="select"]').click();
        await tiles(page).first().focus();
        await page.keyboard.press('ControlOrMeta+a');
        await expect(bar(page).locator('.mw-selcount')).toHaveText('3 files selected');
        await bar(page).locator('[data-mw="sel-title"]').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Title for 3 files');
        await dialog(page).locator('input[name="mdlg-bulk-title"]').fill('Pfefferkorn album');
        await expect(dialog(page).locator('.mdlg-bulk-row')).toHaveCount(2);
        await expect(dialog(page).locator('.mdlg-bulk-row').first()).toContainText('Pfefferkorn album 1');
        await expect(dialog(page).getByRole('button', { name: 'Apply to 2 files' })).toBeVisible();
        await dialog(page).getByRole('button', { name: 'Apply to 2 files' }).click();
        await expect(toast(page)).toContainText('2 of 3 files updated.');
        const after = await titles(page);
        expect(after['svatba.png']).toBe('Wedding at Quellbach');
        expect([after['dopis.png'], after['matrika.png']].sort()).toEqual(['Pfefferkorn album 1', 'Pfefferkorn album 2']);
        await expect(win(page)).not.toHaveClass(/is-selecting/);
        // The toast's Undo takes one step back: both titles go.
        await toast(page).getByRole('button', { name: 'Undo' }).first().click();
        await expect(tile(page, 'dopis.png')).toBeVisible();
        const undone = await titles(page);
        expect([undone['dopis.png'], undone['matrika.png']]).toEqual([null, null]);
        // Kind… over two files; Date… over all three.
        await win(page).locator('[data-mw="select"]').click();
        await tile(page, 'dopis.png').click();
        await tile(page, 'matrika.png').click();
        await bar(page).locator('[data-mw="sel-kind"]').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Kind for 2 files');
        await dialog(page).locator('input[name="mdlg-bulk-kind"][value="document"]').check();
        await dialog(page).getByRole('button', { name: 'Apply to 2 files' }).click();
        await expect(toast(page)).toContainText('2 of 2 files updated.');
        await win(page).locator('[data-mw="select"]').click();
        await tiles(page).first().focus();
        await page.keyboard.press('ControlOrMeta+a');
        await bar(page).locator('[data-mw="sel-date"]').click();
        await dialog(page).locator('input[name="mdlg-bulk-date"]').fill('1924');
        await dialog(page).getByRole('button', { name: 'Apply to 3 files' }).click();
        await expect(toast(page)).toContainText('3 of 3 files updated.');
        expect(await details(page)).toEqual({
            'svatba.png': [null, '1924'], 'dopis.png': ['document', '1924'], 'matrika.png': ['document', '1924'],
        });
    });

    test('Go through: the fields open from the first file, Enter saves and goes on, Skip, → at the end of the field, Esc ends', async ({ page }) => {
        await appTree(page);
        await openWindow(page);
        await win(page).locator('.mw-chips-review [data-mw="notitle"]').click();
        await win(page).locator('[data-mw="select"]').click();
        await tiles(page).first().focus();
        await page.keyboard.press('ControlOrMeta+a');
        await bar(page).locator('[data-mw="sel-review"]').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(page.locator('#image-viewer-pos')).toHaveText('Going through · 1 of 2 · Without title · Esc ends');
        const title = panel(page).locator('.mat-edit-title');
        await expect(title).toBeFocused();
        await expect(panel(page).locator('[data-action="saveNext"]')).toHaveText('Save and next →');
        await expect(panel(page).locator('.mv-keys')).toHaveText('Enter or → saves and goes on · ← previous');
        await title.fill('Letter from Quellbach');
        await title.press('Enter');
        await expect(page.locator('#image-viewer-pos')).toHaveText('Going through · 2 of 2 · Without title · Esc ends');
        await expect(title).toBeFocused();
        // ← at the field's start goes back (the first file keeps its new title).
        await title.evaluate(el => (el as HTMLInputElement).setSelectionRange(0, 0));
        await title.press('ArrowLeft');
        await expect(page.locator('#image-viewer-pos')).toContainText('1 of 2');
        await expect(title).toHaveValue('Letter from Quellbach');
        // The caret at the end (End does not move it on a Mac).
        await title.evaluate(el => { const i = el as HTMLInputElement; i.setSelectionRange(i.value.length, i.value.length); });
        await title.press('ArrowRight');
        await expect(page.locator('#image-viewer-pos')).toContainText('2 of 2');
        await title.fill('Not saved');
        await title.press('Escape');
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(toast(page)).toContainText('1 of 2 files updated.');
        const t = await titles(page);
        expect(Object.values(t).filter(v => v === 'Letter from Quellbach')).toHaveLength(1);
        expect(Object.values(t)).not.toContain('Not saved');
        // The window keeps its filter: the file now titled leaves it.
        await expect(tiles(page)).toHaveCount(1);
    });

    test('Skip goes on without saving; after the last file the review ends', async ({ page }) => {
        await appTree(page);
        await openWindow(page);
        await win(page).locator('.mw-chips-review [data-mw="notitle"]').click();
        await win(page).locator('[data-mw="select"]').click();
        await tiles(page).first().focus();
        await page.keyboard.press('ControlOrMeta+a');
        await bar(page).locator('[data-mw="sel-review"]').click();
        await panel(page).locator('.mat-edit-title').fill('Skipped');
        await panel(page).locator('[data-action="skip"]').click();
        await expect(page.locator('#image-viewer-pos')).toContainText('2 of 2');
        await panel(page).locator('.mat-edit-title').fill('Last one');
        await panel(page).locator('[data-action="saveNext"]').click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(toast(page)).toContainText('1 of 2 files updated.');
        const t = await titles(page);
        expect(Object.values(t)).toContain('Last one');
        expect(Object.values(t)).not.toContain('Skipped');
    });

    test('the list: columns, sorting by a header (click, Enter, a third time back), remembered', async ({ page }) => {
        await appTree(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            for (const p of Object.values(dm.getData().persons) as { id: string }[]) {
                for (const a of dm.personMedia(p.id as never)) {
                    dm.setMediaDetails(a.id, { date: a.name === 'svatba.png' ? '1924' : a.name === 'dopis.png' ? '1931' : '' });
                }
            }
        });
        await openWindow(page);
        await win(page).locator('[data-mw="view-list"]').click();
        const head = win(page).locator('.mw-lhead');
        await expect(head).toBeVisible();
        await expect(head.locator('[role="columnheader"]')).toHaveText(['Title', 'Kind', 'Date', 'People', 'Source', 'Used']);
        const rows = () => win(page).locator('.mw-canvas .mw-li .mw-li-title').allTextContents();
        const date = head.locator('.mw-lh-date');
        await expect(date).toHaveAttribute('aria-sort', 'none');
        await date.locator('button').click();
        await expect(date).toHaveAttribute('aria-sort', 'ascending');
        expect(await rows()).toEqual(['Wedding at Quellbach', 'dopis.png', 'matrika.png']);
        await date.locator('button').press('Enter');
        await expect(date).toHaveAttribute('aria-sort', 'descending');
        // Without a date last both ways.
        expect(await rows()).toEqual(['dopis.png', 'Wedding at Quellbach', 'matrika.png']);
        await expect(win(page).locator('.mw-li', { hasText: 'svatba.png' }).locator('.mw-li-source')).toHaveText('no source');
        await expect(win(page).locator('.mw-li', { hasText: 'matrika.png' }).locator('.mw-li-source')).toHaveText('Matrika Quellbach');
        expect(JSON.parse(await page.evaluate(() => localStorage.getItem('strom.materials.view') ?? '{}')).sort).toEqual({ col: 'date', dir: -1 });
        await date.locator('button').press('Enter');
        await expect(date).toHaveAttribute('aria-sort', 'none');
    });
});

test.describe('Going through many files beside an archive', () => {
    test.use({ viewport: DESKTOP });

    async function research(page: Page): Promise<FakeMaterial> {
        const accepts = { sync: { auto: 'off' }, sources: true, verified: true,
            media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
        const material = fakeMaterial({
            files: [materialFile(1, { title: 'Census 1921' }), materialFile(2), materialFile(3, { kind: 'photo' })],
            batches: [], people: { P0001: 'Josef Fíšek' },
        });
        await fakeBridge(page, { accepts, features: [...MATERIAL_FEATURES, 'material.edit'], material, treeGed: researchGed() });
        await openResearch(page, { media: true });
        await page.evaluate(({ uuid, base, accepts }) => {
            localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
        }, { uuid: UUID, base: BRIDGE, accepts });
        await poll(page);
        return material;
    }

    test('In the tree / Only in the archive; Kind… goes to the research in one request, Undo sends the earlier kinds back', async ({ page }) => {
        const material = await research(page);
        await openWindow(page);
        await expect(tiles(page)).toHaveCount(3);
        await expect(win(page).locator('[data-mw="where-tree"]')).toHaveText('In the tree · 0');
        await expect(win(page).locator('[data-mw="where-archive"]')).toHaveText('Only in the archive · 3');
        await win(page).locator('[data-mw="select"]').click();
        await tiles(page).first().focus();
        await page.keyboard.press('ControlOrMeta+a');
        await bar(page).locator('[data-mw="sel-kind"]').click();
        await dialog(page).locator('input[name="mdlg-bulk-kind"][value="document"]').check();
        await dialog(page).locator('input[name="mdlg-bulk-overwrite"]').check();
        await dialog(page).getByRole('button', { name: 'Apply to 3 files' }).click();
        await expect(toast(page)).toContainText('3 of 3 files updated.');
        expect(material.edits!.map(e => ({ ...e, ids: (e.ids as string[]).sort() }))).toEqual([{ ids: ['I0001', 'I0002', 'I0003'], kind: 'document' }]);
        await toast(page).getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => material.edits!.length).toBe(3);
        const back = material.edits!.slice(1).map(e => ({ ...e, ids: (e.ids as string[]).sort() }))
            .sort((a, b) => String(a.kind).localeCompare(String(b.kind)));
        expect(back).toEqual([{ ids: ['I0001', 'I0002'], kind: '' }, { ids: ['I0003'], kind: 'photo' }]);
    });
});
