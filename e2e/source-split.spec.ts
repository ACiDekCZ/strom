import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * "Split as suggested…" for a tree without a research (spec 075 §5): the
 * Sources manager's line and the Table's line over Sources, the dialog's
 * preview (a table, cards on a phone, "Show all"), Split in one undo step with
 * the toast's Undo and Ctrl+Z, the dialog's undo row, the note line of an
 * earlier GEDCOM import moving to the call number; a research tree is not
 * split here. Invented data only.
 */

type Rec = Record<string, unknown>;

/** Eight older locations the split recognises, one it does not, one already split. */
function sources(): Record<string, Rec> {
    const all: Record<string, Rec> = {};
    for (let i = 1; i <= 8; i++) {
        all[`s${i}`] = { title: `Matrika N ${i} Vzorov`, repository: 'Zemský archiv Vzorov', reference: `fol. ${10 + i}v, č. ${i}, snímek ${30 + i}` };
    }
    all.u1 = { title: 'Kniha zápisů Pokusov', reference: 'Kniha N 7, zápis bez čísla' };
    all.d1 = { title: 'Pozemková kniha Vzorov', folio: 'fol. 3', image: '4' };
    return all;
}

async function tree(page: Page, src: Record<string, Rec> = sources(), width = 1440, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await page.evaluate(async (src) => {
        const all: Record<string, unknown> = {};
        for (const [id, s] of Object.entries(src)) all[id] = { id, ...s };
        const persons = {
            a: { id: 'a', firstName: 'Anna', lastName: 'Vzorková', gender: 'female', birthDate: '1834', isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [], sourceIds: Object.keys(src) },
        };
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships: {}, sources: all } as never, 'Prameny');
    }, src);
}

const dialog = (page: Page) => page.locator('#source-split-modal');
const line = (page: Page) => page.locator('#sources-split-bulk');
const source = (page: Page, id: string) => page.evaluate((id) => window.Strom.DataManager.getData().sources?.[id] as Rec | undefined, id);
const openSources = (page: Page) => page.evaluate(() => window.Strom.UI.showSourcesDialog());

async function noOverflow(page: Page): Promise<void> {
    const wide = await dialog(page).locator('.ssp-modal, .ssp-modal *').evaluateAll(els => els
        .filter(e => !(e as HTMLElement).closest('.ssp-list'))
        .filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'auto')
        .map(e => `${e.tagName}.${(e as HTMLElement).className}`));
    expect(wide).toEqual([]);
    const box = await dialog(page).locator('.ssp-modal').boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 0.5);
}

test.describe('split locally', () => {
    test('the Sources manager offers it; preview, Show all, Split, the toast Undo; again and Ctrl+Z', async ({ page }) => {
        await tree(page);
        await openSources(page);
        await expect(line(page)).toContainText('The locations of 8 sources can be split into fields.');
        await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
        await expect(dialog(page).locator('h2')).toHaveText('Split locations into fields');
        await expect(dialog(page).locator('.ssp-lead')).toContainText('The locations of 8 sources can be split');
        await expect(dialog(page).locator('.ssp-table th')).toHaveText(['Source', 'Location before', 'Folio/page', 'Image', 'Other location']);
        await expect(dialog(page).locator('.ssp-table tbody tr')).toHaveCount(6);
        const first = dialog(page).locator('.ssp-table tbody tr').first();
        await expect(first.locator('td')).toHaveText(['Matrika N 1 Vzorov', 'fol. 11v, č. 1, snímek 31', 'fol. 11v', '31', 'č. 1']);
        await expect(dialog(page).locator('.ssp-unrec')).toContainText('1 location was not recognised and stays unchanged.');
        await expect(dialog(page).locator('.ssp-unrec-ex')).toHaveText('E.g. “Kniha N 7, zápis bez čísla”.');
        await expect(dialog(page).locator('.ssp-sig')).toHaveCount(0);
        await noOverflow(page);
        await dialog(page).getByRole('button', { name: 'Show all (8)' }).click();
        await expect(dialog(page).locator('.ssp-table tbody tr')).toHaveCount(8);
        await expect(dialog(page).locator('.ssp-list')).toHaveClass(/is-all/);
        // Nothing stored before Split.
        expect((await source(page, 's1'))?.folio).toBeUndefined();
        await dialog(page).getByRole('button', { name: 'Split (8)' }).click();
        await expect(dialog(page)).toHaveCount(0);
        const toast = page.locator('.toast[data-kind="source-split"]');
        await expect(toast).toContainText('8 locations split.');
        expect(await source(page, 's3')).toMatchObject({ folio: 'fol. 13v', image: '33', reference: 'č. 3', repository: 'Zemský archiv Vzorov' });
        expect(await source(page, 'u1')).toMatchObject({ reference: 'Kniha N 7, zápis bez čísla' });
        // Nothing left: the manager's line names the split done.
        await expect(line(page)).toContainText('Locations split on 15 Jun');
        await toast.getByRole('button', { name: 'Undo' }).click();
        expect(await source(page, 's3')).toMatchObject({ reference: 'fol. 13v, č. 3, snímek 33' });
        expect((await source(page, 's3'))?.folio).toBeUndefined();
        await expect(line(page)).toContainText('The locations of 8 sources can be split into fields.');

        // Again, then Ctrl+Z once the manager is closed.
        await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
        await dialog(page).getByRole('button', { name: 'Split (8)' }).click();
        expect((await source(page, 's8'))?.image).toBe('38');
        await page.keyboard.press('Escape');
        await expect(page.locator('#sources-modal')).not.toHaveClass(/active/);
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(async () => (await source(page, 's8'))?.reference).toBe('fol. 18v, č. 8, snímek 38');
        expect((await source(page, 's8'))?.image).toBeUndefined();
    });

    test('the undo row while the split is the last step; nothing left, Close only; Undo brings the preview back', async ({ page }) => {
        await tree(page);
        await openSources(page);
        await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
        await dialog(page).getByRole('button', { name: 'Split (8)' }).click();
        await expect(line(page)).toContainText('(8 sources)');
        await line(page).getByRole('button', { name: 'Undo…' }).click();
        await expect(dialog(page).locator('.ssp-undo-row')).toContainText('Undo the split of 15 Jun');
        await expect(dialog(page).locator('.ssp-undo-row')).toContainText('(8 sources)');
        await expect(dialog(page).locator('.ssp-nothing')).toHaveText('No other locations to split right now.');
        await expect(dialog(page).locator('.ssp-foot button')).toHaveText(['Close']);
        await expect(dialog(page).locator('.ssp-modal')).toHaveAttribute('data-dialog-kind', 'info');
        await dialog(page).locator('.ssp-undo-row').getByRole('button', { name: 'Undo' }).click();
        await expect(dialog(page).locator('.ssp-undo-row')).toHaveCount(0);
        await expect(dialog(page).locator('.ssp-table tbody tr')).toHaveCount(6);
        await expect(dialog(page).locator('.ssp-foot button')).toHaveText(['Cancel', 'Split (8)']);
        expect((await source(page, 's1'))?.folio).toBeUndefined();
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(line(page)).toContainText('The locations of 8 sources can be split into fields.');
        // Another change after the split: no undo row any more.
        await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
        await dialog(page).getByRole('button', { name: 'Split (8)' }).click();
        await page.evaluate(() => window.Strom.DataManager.updateSource('u1', { note: 'Kniha se ztratila' }));
        await page.evaluate(() => window.Strom.UI.renderSourcesList());
        await expect(line(page)).toBeHidden();
    });

    test('a note line "Call number: …" moves to an empty call number; a filled one stays', async ({ page }) => {
        await tree(page, {
            c1: { title: 'Oddací matrika Pokusov', note: 'Matrika obce Pokusov\nCall number: N 7', reference: 'fol. 12v, snímek 34' },
            c2: { title: 'Křestní matrika Pokusov', callNumber: 'N 9', note: 'Call number: N 8', reference: 'fol. 2r' },
        });
        await openSources(page);
        await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
        await expect(dialog(page).locator('.ssp-table th')).toHaveText(['Source', 'Location before', 'Folio/page', 'Image', 'Other location', 'Call number']);
        await expect(dialog(page).locator('.ssp-intro')).toContainText('moves to the Call number field (1 source)');
        await expect(dialog(page).locator('.ssp-table tbody tr').nth(1).locator('td').last()).toHaveText('N 7 · from note');
        await expect(dialog(page).locator('.ssp-table tbody tr').nth(0).locator('td').last()).toHaveText('N 9 · unchanged');
        await dialog(page).getByRole('button', { name: 'Split (2)' }).click();
        expect(await source(page, 'c1')).toMatchObject({ callNumber: 'N 7', folio: 'fol. 12v', image: '34', note: 'Matrika obce Pokusov' });
        expect(await source(page, 'c2')).toMatchObject({ callNumber: 'N 9', folio: 'fol. 2r', note: 'Call number: N 8' });
    });
});

test.describe('the Table and a phone', () => {
    test('the Table offers it over Sources; split, the line gone, Ctrl+Z brings it back', async ({ page }) => {
        await tree(page);
        await page.locator('#view-mode-table').click();
        const bulk = page.locator('#table-container .table-bulk');
        await expect(bulk).toBeHidden();
        await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
        await expect(bulk).toContainText('The locations of 8 sources can be split into fields.');
        await bulk.getByRole('button', { name: 'Split as suggested…' }).click();
        await dialog(page).getByRole('button', { name: 'Split (8)' }).click();
        await expect(bulk).toBeHidden();
        await page.keyboard.press('ControlOrMeta+z');
        await expect(bulk).toContainText('The locations of 8 sources can be split into fields.');
        expect((await source(page, 's2'))?.folio).toBeUndefined();
    });

    test('a phone: the whole screen, three cards, 48 px buttons, nothing wider than the screen', async ({ page }) => {
        await tree(page, sources(), 390, 844);
        await openSources(page);
        await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
        await expect(dialog(page).locator('.ssp-card')).toHaveCount(3);
        await expect(dialog(page).locator('.ssp-table')).toHaveCount(0);
        const card = dialog(page).locator('.ssp-card').first();
        await expect(card.locator('.ssp-card-title')).toHaveText('Matrika N 1 Vzorov');
        await expect(card.locator('dt')).toHaveText(['Folio/page', 'Image', 'Other location']);
        await expect(card.locator('dd')).toHaveText(['fol. 11v', '31', 'č. 1']);
        const box = await dialog(page).locator('.ssp-modal').boundingBox();
        expect(Math.round(box!.width)).toBe(390);
        for (const b of await dialog(page).locator('.ssp-foot button').all()) {
            expect(Math.round((await b.boundingBox())!.height)).toBeGreaterThanOrEqual(48);
        }
        await noOverflow(page);
        await dialog(page).getByRole('button', { name: 'Show all (8)' }).click();
        await expect(dialog(page).locator('.ssp-card')).toHaveCount(8);
        await dialog(page).getByRole('button', { name: 'Split (8)' }).click();
        await expect(page.locator('.toast[data-kind="source-split"]')).toContainText('8 locations split.');
    });
});

test('a research tree is not split here: a quiet sentence in the Sources manager, nothing in the Table', async ({ page }) => {
    const { openResearch } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page, { bridge: false });
    await page.evaluate(() => {
        window.Strom.DataManager.addSource({ title: 'Matrika N 7 Vzorov', reference: 'fol. 12v, snímek 34' } as never);
        window.Strom.UI.showSourcesDialog();
    });
    await expect(line(page)).toHaveText('Splitting locations works while the research is running.');
    await expect(line(page).getByRole('button')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('#view-mode-table').click();
    await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
    await expect(page.locator('#table-container .table-bulk')).toBeHidden();
});
