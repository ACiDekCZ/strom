import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, materialSha, MATERIAL_FEATURES, openResearch, poll, links,
    researchGed, UUID, BRIDGE, FakeBridge, FakeMaterial, FakeMaterialFile, FakeMaterialBatch,
    HEAD, NEW_HEAD, block, dot, openResearchMenu, foreignCommit,
} from './research-bridge.js';

/**
 * The materials viewer and the research's writes (spec 017 U5, §4–§6, §8.5):
 * going through a list, the cards for files the browser does not show, the
 * details panel, Assign to a person (with Undo), removing a person from a
 * file or its whole batch, Hide / Restore, the states while the research is
 * not running and its refusals. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };

interface Setup {
    features?: string[];
    files?: FakeMaterialFile[];
    batches?: FakeMaterialBatch[];
    people?: Record<string, string>;
    before?: (page: Page) => Promise<void>;
}

async function setup(page: Page, opts: Setup = {}): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({ files: opts.files ?? [], batches: opts.batches ?? [], people: opts.people ?? PEOPLE });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: opts.features ?? MATERIAL_FEATURES, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    if (opts.before) await opts.before(page);
    await poll(page);
    return { bridge, material };
}

const personId = (page: Page, first: string) => page.evaluate((first) =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);

/** Jan's attachment whose original the research has (the file's SHA). */
async function attachOriginal(page: Page, name: string, sha: string): Promise<void> {
    const id = await personId(page, 'Jan');
    await page.evaluate(({ id, name, sha, px }) => {
        window.Strom.DataManager.addAttachment(id as never, {
            name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70,
            original: { sha256: sha, name, mimeType: 'image/png', bytes: 70 },
        } as never);
    }, { id, name, sha, px: PX });
}

const janAttachments = async (page: Page) => page.evaluate((id) =>
    window.Strom.DataManager.getPerson(id as never)!.attachments?.length ?? 0, await personId(page, 'Jan'));

async function editJanModal(page: Page): Promise<void> {
    const id = await personId(page, 'Jan');
    await page.evaluate((id) => {
        const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
        ui.pushDialog('person-modal');
        ui.showEditPersonModal(id);
    }, id);
    await expect(page.locator('#person-modal')).toBeVisible();
}

const section = (page: Page) => page.locator('#materials-section');
const rows = (page: Page) => section(page).locator('.material-row:not(.is-skeleton)');
const win = (page: Page) => page.locator('#materials-modal');
const tile = (page: Page, text: string) => win(page).locator('.mw-canvas .mw-tile', { hasText: text });
const viewer = (page: Page) => page.locator('#attachment-overlay');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const pos = (page: Page) => page.locator('#image-viewer-pos');
const card = (page: Page) => page.locator('#image-viewer-card');
const act = (page: Page, id: string) => panel(page).locator(`.mv-act[data-action="${id}"]`);
const chips = (page: Page) => panel(page).locator('.mv-chip');
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg');
const toast = (page: Page) => page.locator('.toast[data-kind="materials"]');

async function openWindow(page: Page, opts: { person?: string; batch?: string } = {}): Promise<void> {
    await page.evaluate((opts) => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials(opts), opts);
    await expect(win(page)).toBeVisible();
}

/** The window, then one of its files in the viewer. */
async function view(page: Page, text: string): Promise<void> {
    await openWindow(page);
    await tile(page, text).click();
    await expect(viewer(page)).toHaveClass(/active/);
    await expect(panel(page).locator('.mv-title')).toBeVisible();
}

/** Tick people in the assign dialog's picker. */
async function pick(page: Page, names: string[]): Promise<void> {
    for (const name of names) await dialog(page).locator('.ppm-row', { hasText: name }).click();
}

test.describe('Materials viewer', () => {
    test.use({ viewport: DESKTOP });

    test('‹ ›, arrows and the position go through the person\'s materials; Esc leaves the editor open', async ({ page }) => {
        await setup(page, { files: [1, 2, 3].map(n => materialFile(n, { persons: ['P0003'], title: `Dopis ${n}` })) });
        await editJanModal(page);
        await expect(rows(page)).toHaveCount(3);
        await rows(page).first().click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(pos(page)).toHaveText('1 / 3 · Materials of Jan Fíšek');
        const first = await panel(page).locator('.mv-title').textContent();
        await page.locator('#image-viewer-next').click();
        await expect(pos(page)).toContainText('2 / 3');
        await page.keyboard.press('ArrowRight');
        await expect(pos(page)).toContainText('3 / 3');
        await expect(page.locator('#image-viewer-next')).toBeDisabled();
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await expect(pos(page)).toContainText('1 / 3');
        await expect(panel(page).locator('.mv-title')).toHaveText(first!);
        // The image in full quality (the file itself).
        await expect(page.locator('#attachment-overlay-img')).toHaveAttribute('src', /\?file=1/);
        await page.keyboard.press('Escape');
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(page.locator('#person-modal')).toBeVisible();
    });

    test('a PDF: a new tab from the list, a card in the viewer; TIFF: "Open in the system"; a file not here: the record only', async ({ page }) => {
        const { material } = await setup(page, { files: [
            materialFile(1, { name: 'list.pdf', mime: 'application/pdf', title: 'Výpis' }),
            materialFile(2, { name: 'scan.tif', mime: 'image/tiff', title: 'Sken TIFF', at: '2026-09-30T08:00:00.000Z' }),
            materialFile(3, { title: 'Ztracená fotka', here: false, at: '2026-09-29T08:00:00.000Z' }),
        ] });
        await openWindow(page);
        // New tabs are recorded instead of opened.
        await page.evaluate(() => {
            const w = window as unknown as { __opened: string[] };
            w.__opened = [];
            window.open = ((url: string) => { w.__opened.push(String(url)); return null; }) as typeof window.open;
        });
        await tile(page, 'Výpis').click();
        const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
        expect(opened).toHaveLength(1);
        expect(opened[0]).toContain(`/media/${materialSha('I0001')}?file=1`);
        await expect(viewer(page)).not.toHaveClass(/active/);

        await tile(page, 'Sken TIFF').click();
        await expect(card(page)).toBeVisible();
        await expect(card(page).locator('.mv-card-text')).toHaveText('This app cannot show TIF. A program on the computer opens it.');
        await card(page).getByRole('button', { name: 'Open in system ↗' }).click();
        expect((await links(page)).some(l => l.includes(`sha=${materialSha('I0002')}`))).toBe(true);
        // No preview asked of the research for a TIFF (it answers 415).
        expect(material.thumbAsks.filter(a => a.startsWith(materialSha('I0002')))).toEqual([]);
        // ‹ goes to the PDF: its card.
        await page.keyboard.press('ArrowLeft');
        await expect(card(page).locator('.mv-card-text')).toHaveText('The PDF opens in a new tab.');
        await expect(card(page).getByRole('button', { name: 'Open PDF ↗' })).toBeVisible();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await expect(card(page).locator('.mv-card-text')).toHaveText('The file is not on this computer. The record stays in the research.');
        await expect(card(page).locator('button')).toHaveCount(0);
    });

    test('people: a tree person is a link (closes the viewer and the window, focuses them); one only in the research is not', async ({ page }) => {
        await setup(page, {
            files: [materialFile(1, { persons: ['P0001', 'P0009'], title: 'Svatba' })],
            people: { ...PEOPLE, P0009: 'Karel Neznámý (1880–1950)' },
        });
        await view(page, 'Svatba');
        await expect(chips(page)).toHaveCount(2);
        const only = chips(page).nth(1).locator('.mv-chip-name');
        await expect(only).toHaveText('Karel Neznámý (1880–1950)');
        await expect(only).toHaveAttribute('title', 'This person is only in the research so far.');
        await expect(chips(page).nth(1).locator('.mv-chip-link')).toHaveCount(0);
        await chips(page).first().locator('.mv-chip-link').click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(win(page)).toHaveCount(0);
        const josef = await personId(page, 'Josef');
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(josef);
    });

    test('the research stops: the remembered preview with its sentence, the writes shown but off', async ({ page }) => {
        const { bridge, material } = await setup(page, { files: [materialFile(1, { persons: ['P0003'], title: 'Portrét' })] });
        await openWindow(page);
        // Its preview came while the research ran (and is remembered).
        await expect(tile(page, 'Portrét').locator('img')).toBeVisible();
        bridge.down = true;
        await poll(page);
        await tile(page, 'Portrét').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(page.locator('#image-viewer-note')).toHaveText('Stored preview. Full quality once the research runs.');
        await expect(page.locator('#attachment-overlay-img')).toHaveAttribute('src', /^blob:/);
        await expect(act(page, 'assign')).toHaveAttribute('aria-disabled', 'true');
        await expect(act(page, 'hide')).toHaveAttribute('aria-disabled', 'true');
        await expect(panel(page).locator('.mv-off')).toHaveText('Assigning and hiding work while the research runs.');
        await act(page, 'assign').click({ force: true });
        await expect(dialog(page)).toHaveCount(0);
        // The × on a person's chip is off the same way: dimmed as Assign / Hide, a click sends nothing.
        const x = chips(page).first().locator('.mv-chip-x');
        await expect(x).toHaveAttribute('aria-disabled', 'true');
        const opacity = (sel: string) => panel(page).locator(sel).first().evaluate(el => Number(getComputedStyle(el).opacity));
        // (A borderless faint × needs more than the buttons' 0.5 to look off.)
        expect(await opacity('.mv-chip-x')).toBeLessThan(Math.min(0.45, await opacity('.mv-act[data-action="assign"]')));
        await x.click({ force: true });
        await page.waitForTimeout(200);
        expect(material.assigns).toHaveLength(0);
    });

    test('an older research (no assigning): the sentence, no writes', async ({ page }) => {
        await setup(page, { features: ['material.list', 'material.thumb'], files: [materialFile(1, { persons: ['P0003'] })] });
        await view(page, 'scan-1.jpg');
        await expect(panel(page).locator('.mv-sentence.is-muted')).toHaveText('Assigning needs a newer research version.');
        await expect(act(page, 'assign')).toHaveCount(0);
        await expect(act(page, 'hide')).toHaveCount(0);
        await expect(chips(page).locator('.mv-chip-x')).toHaveCount(0);
    });
});

test.describe('Assign to a person', () => {
    test.use({ viewport: DESKTOP });

    test('a file without anyone to three people: the toast, the chips, the person\'s section; Undo takes them off', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1, { title: 'Rodinná fotka' })] });
        await view(page, 'Rodinná fotka');
        await expect(panel(page).locator('.mv-none')).toHaveText('No person');
        await act(page, 'assign').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Assign to a person');
        await expect(dialog(page).locator('.mdlg-sub')).toHaveText('file Rodinná fotka');
        const go = dialog(page).locator('.mdlg-btn.is-primary');
        await expect(go).toBeDisabled();
        await pick(page, ['Josef Fíšek', 'Anna Svobodová', 'Jan Fíšek']);
        await expect(go).toHaveText('Assign (3 people)');
        await go.click();
        await expect(dialog(page)).toHaveCount(0);
        expect(material.assigns[0]).toEqual({ files: ['I0001'], add: expect.arrayContaining(['P0001', 'P0002', 'P0003']) });
        await expect(toast(page)).toContainText('Assigned: 1 file to');
        await expect(chips(page)).toHaveCount(3);

        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.assigns.length).toBe(2);
        expect(material.assigns[1]).toMatchObject({ files: ['I0001'] });
        expect((material.assigns[1].remove as string[]).sort()).toEqual(['P0001', 'P0002', 'P0003']);
        await expect(panel(page).locator('.mv-none')).toBeVisible();

        // Assigned again: Jan's section has it.
        await act(page, 'assign').click();
        await pick(page, ['Jan Fíšek']);
        await dialog(page).locator('.mdlg-btn.is-primary').click();
        await expect(chips(page)).toHaveCount(1);
        await page.keyboard.press('Escape');
        await page.locator('#materials-modal .close-btn').click();
        await editJanModal(page);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText('Rodinná fotka');
    });

    test('people already on the file are fixed; Undo takes off only those added', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1, { persons: ['P0003'], title: 'Křest' })] });
        await view(page, 'Křest');
        await act(page, 'assign').click();
        const jan = dialog(page).locator('.ppm-row', { hasText: 'Jan Fíšek' });
        await expect(jan).toHaveClass(/is-fixed/);
        await expect(jan.locator('input')).toBeChecked();
        await expect(jan.locator('input')).toBeDisabled();
        await pick(page, ['Anna Svobodová']);
        await dialog(page).locator('.mdlg-btn.is-primary').click();
        await expect(toast(page)).toHaveText(/Assigned: 1 file to Anna Svobodová\./);
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.assigns.length).toBe(2);
        expect(material.assigns[1]).toEqual({ files: ['I0001'], remove: ['P0002'] });
        expect(material.files[0].persons).toEqual(['P0003']);
    });

    test('a person without REFN cannot be picked', async ({ page }) => {
        await setup(page, { files: [materialFile(1)] });
        await page.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Petr', lastName: 'Nový', gender: 'male' }));
        await view(page, 'scan-1.jpg');
        await act(page, 'assign').click();
        await dialog(page).locator('.ppm-search').fill('Petr');
        const petr = dialog(page).locator('.ppm-row', { hasText: 'Petr Nový' });
        await expect(petr).toHaveClass(/is-blocked/);
        await expect(petr).toContainText('The research knows this person after the next tree save. It can be assigned then.');
        await expect(petr.locator('input')).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        // Esc closed the dialog only.
        await expect(viewer(page)).toHaveClass(/active/);
    });

    test('a batch\'s ⋯: the whole batch to a person, and a person off the whole batch', async ({ page }) => {
        const { material } = await setup(page, {
            files: [1, 2].map(n => materialFile(n, { batch: 'b-box', path: `foto-${n}.jpg` })),
            batches: [{ id: 'b-box', name: 'Krabice', at: '2026-10-10T10:00:00.000Z', persons: ['P0001'] }],
        });
        await openWindow(page);
        await win(page).locator('.mw-canvas [data-mw="batch-menu"]').first().click();
        await page.locator('.mw-pop-batchMenu [data-action="assign"]').click();
        await expect(dialog(page).locator('.mdlg-sub')).toHaveText('whole batch Krabice (2)');
        await expect(dialog(page).locator('.ppm-row', { hasText: 'Josef Fíšek' })).toHaveClass(/is-fixed/);
        await pick(page, ['Anna Svobodová']);
        await dialog(page).locator('.mdlg-btn.is-primary').click();
        await expect(toast(page)).toContainText('Assigned: 2 files to Anna Svobodová.');
        expect(material.assigns[0]).toEqual({ batch: 'b-box', add: ['P0002'] });

        await win(page).locator('.mw-canvas [data-mw="batch-menu"]').first().click();
        await page.locator('.mw-pop-batchMenu [data-action="removePerson"]').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Remove a person from the whole batch');
        await expect(dialog(page).locator('.mdlg-radio')).toHaveText(['Josef Fíšek', 'Anna Svobodová']);
        await dialog(page).locator('.mdlg-radio', { hasText: 'Anna Svobodová' }).click();
        await dialog(page).locator('.mdlg-btn.is-danger').click();
        await expect.poll(() => material.assigns.length).toBe(2);
        expect(material.assigns[1]).toEqual({ batch: 'b-box', remove: ['P0002'] });
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.assigns.length).toBe(3);
        expect(material.assigns[2]).toEqual({ batch: 'b-box', add: ['P0002'] });
    });
});

test.describe('Removing a person', () => {
    test.use({ viewport: DESKTOP });

    test('a direct person: × removes them from the file; Undo puts them back', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1, { persons: ['P0001', 'P0003'], title: 'Svatba' })] });
        await view(page, 'Svatba');
        await chips(page).first().locator('.mv-chip-x').click();
        await expect(toast(page)).toHaveText(/Removed: Josef Fíšek from Svatba\./);
        expect(material.assigns[0]).toEqual({ files: ['I0001'], remove: ['P0001'] });
        await expect(chips(page)).toHaveCount(1);
        await toast(page).locator('.toast-action').click();
        await expect(chips(page)).toHaveCount(2);
        expect(material.assigns[1]).toEqual({ files: ['I0001'], add: ['P0001'] });
    });

    test('a person only through the batch: the bubble offers the whole batch; Undo puts them back on it', async ({ page }) => {
        const { material } = await setup(page, {
            files: [1, 2, 3].map(n => materialFile(n, { batch: 'b-box', title: `Dopis ${n}` })),
            batches: [{ id: 'b-box', name: 'Krabice', persons: ['P0003'] }],
        });
        await view(page, 'Dopis 1');
        await expect(chips(page).first().locator('.mv-chip-via')).toHaveText('via batch');
        await chips(page).first().locator('.mv-chip-x').click();
        const bubble = page.locator('.mdlg-overlay.is-bubble .mdlg');
        await expect(bubble.locator('.mdlg-text')).toHaveText('Jan Fíšek is on the whole batch Krabice (3 files). It cannot be removed from a single file.');
        await bubble.getByRole('button', { name: 'Cancel' }).click();
        await expect(bubble).toHaveCount(0);
        expect(material.assigns).toHaveLength(0);
        await chips(page).first().locator('.mv-chip-x').click();
        await bubble.getByRole('button', { name: 'Remove from the whole batch' }).click();
        await expect.poll(() => material.assigns.length).toBe(1);
        expect(material.assigns[0]).toEqual({ batch: 'b-box', remove: ['P0003'] });
        await expect(panel(page).locator('.mv-none')).toBeVisible();
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.assigns.length).toBe(2);
        expect(material.assigns[1]).toEqual({ batch: 'b-box', add: ['P0003'] });
    });

    test('kept through the batch: the toast offers removing from the whole batch', async ({ page }) => {
        const { material } = await setup(page, {
            files: [materialFile(1, { batch: 'b-box', persons: ['P0003'], title: 'Dopis' }), materialFile(2, { batch: 'b-box' })],
            batches: [{ id: 'b-box', name: 'Krabice', persons: ['P0003'] }],
        });
        await editJanModal(page);
        await expect(rows(page)).toHaveCount(2);
        await rows(page).filter({ hasText: 'Dopis' }).locator('.material-more').click();
        await page.locator('#materials-item-menu [data-action="removeFromPerson"]').click();
        await expect(toast(page)).toHaveText(/Jan Fíšek stays on 1 file via batch Krabice\./);
        expect(material.assigns[0]).toEqual({ files: ['I0001'], remove: ['P0003'] });
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.assigns.length).toBe(2);
        expect(material.assigns[1]).toEqual({ batch: 'b-box', remove: ['P0003'] });
    });
});

test.describe('Hide and Restore', () => {
    test.use({ viewport: DESKTOP });

    test('hide with a reason, Undo; then Restore and its Undo', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1, { persons: ['P0003'], title: 'Cizí fotka' })] });
        await view(page, 'Cizí fotka');
        await act(page, 'hide').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Hide the file?');
        await expect(dialog(page).locator('.mdlg-text')).toHaveText('The files stay in the research. They leave the lists, can be found with “Show hidden” and restored.');
        await expect(dialog(page).locator('input[value="unrelated"]')).toBeChecked();
        await expect(dialog(page).locator('.mdlg-check')).toHaveCount(0);
        await dialog(page).locator('.mdlg-radio', { hasText: 'Duplicate' }).click();
        await dialog(page).getByRole('button', { name: 'Hide', exact: true }).click();
        await expect(toast(page)).toHaveText(/Hidden: 1 file\. They stay in the research\./);
        expect(material.hides[0]).toEqual({ files: ['I0001'], hidden: true, reason: 'duplicate' });
        await expect(act(page, 'restore')).toBeVisible();
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.hides.length).toBe(2);
        expect(material.hides[1]).toEqual({ files: ['I0001'], hidden: false });
        await expect(act(page, 'hide')).toBeVisible();

        material.files[0].hidden = { by: 'app', reason: 'unrelated' };
        await page.keyboard.press('Escape');
        await page.locator('#materials-modal .close-btn').click();
        await page.evaluate(() => window.Strom.UI.pollResearchBridge());
        await openWindow(page);
        await win(page).locator('[data-mw="hidden"]').click();
        await tile(page, 'Cizí fotka').click();
        await act(page, 'restore').click();
        await expect(toast(page)).toHaveText(/Restored: 1 file\./);
        expect(material.hides.at(-1)).toEqual({ files: ['I0001'], hidden: false });
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.hides.at(-1)).toEqual({ files: ['I0001'], hidden: true, reason: 'unrelated' });
    });

    test('a file also in the tree: the attachment stays unless "Also delete" is ticked; Undo brings it back', async ({ page }) => {
        const sha1 = materialSha('I0001');
        const sha2 = materialSha('I0002');
        const { material } = await setup(page, {
            files: [materialFile(1, { persons: ['P0003'], title: 'Kopie A' }), materialFile(2, { persons: ['P0003'], title: 'Kopie B', at: '2026-09-30T08:00:00.000Z' })],
            before: async page => { await attachOriginal(page, 'a.png', sha1); await attachOriginal(page, 'b.png', sha2); },
        });
        expect(await janAttachments(page)).toBe(2);
        await view(page, 'Kopie A');
        await expect(panel(page).locator('.mv-sentence')).toHaveText('Also in the tree: in exports, the book and on the phone.');
        await act(page, 'hide').click();
        const check = dialog(page).locator('.mdlg-check input');
        await expect(dialog(page).locator('.mdlg-check')).toContainText('Also delete the attachment from the tree');
        await expect(check).not.toBeChecked();
        await dialog(page).getByRole('button', { name: 'Hide', exact: true }).click();
        await expect(toast(page)).toBeVisible();
        expect(await janAttachments(page)).toBe(2);

        await page.keyboard.press('ArrowRight');
        await expect(panel(page).locator('.mv-title')).toHaveText('Kopie B');
        await act(page, 'hide').click();
        await dialog(page).locator('.mdlg-check').click();
        await dialog(page).getByRole('button', { name: 'Hide', exact: true }).click();
        await expect.poll(() => janAttachments(page)).toBe(1);
        expect(material.hides.at(-1)).toEqual({ files: ['I0002'], hidden: true, reason: 'unrelated' });
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => janAttachments(page)).toBe(2);
        await expect.poll(() => material.hides.at(-1)).toEqual({ files: ['I0002'], hidden: false });
    });

    test('the selection: hiding several files ends selecting', async ({ page }) => {
        const { material } = await setup(page, { files: [1, 2, 3].map(n => materialFile(n, { title: `Sken ${n}` })) });
        await openWindow(page);
        await win(page).locator('[data-mw="select"]').click();
        await tile(page, 'Sken 1').click();
        await tile(page, 'Sken 2').click();
        await win(page).locator('[data-mw="sel-hide"]').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Hide 2 files?');
        await dialog(page).getByRole('button', { name: 'Hide', exact: true }).click();
        await expect(toast(page)).toHaveText(/Hidden: 2 files\./);
        expect((material.hides[0].files as string[]).sort()).toEqual(['I0001', 'I0002']);
        await expect(win(page).locator('.mw-selbar')).toBeHidden();
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(1);
    });
});

test.describe('The research\'s own commits', () => {
    test.use({ viewport: DESKTOP });

    const treeHead = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);

    /** In step with the research: the tree's head is the research's, no dot, the block says so. */
    async function inStep(page: Page, bridge: FakeBridge): Promise<void> {
        await expect.poll(() => treeHead(page)).toBe(bridge.head);
        await poll(page);
        await expect(dot(page)).toBeHidden();
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'inSync');
        await page.keyboard.press('Escape');
    }

    test('Assign, its Undo and Hide move the research\'s head: still in step, no "newer version"', async ({ page }) => {
        const { bridge, material } = await setup(page, { files: [materialFile(1, { title: 'Rodinná fotka' })] });
        expect(await treeHead(page)).toBe(HEAD);
        await view(page, 'Rodinná fotka');
        await act(page, 'assign').click();
        await pick(page, ['Jan Fíšek']);
        await dialog(page).locator('.mdlg-btn.is-primary').click();
        await expect(toast(page)).toContainText('Assigned: 1 file to');
        expect(bridge.head).not.toBe(HEAD);
        await expect.poll(() => treeHead(page)).toBe(bridge.head);

        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.assigns.length).toBe(2);
        await expect.poll(() => treeHead(page)).toBe(bridge.head);

        await act(page, 'hide').click();
        await dialog(page).getByRole('button', { name: 'Hide', exact: true }).click();
        await expect(toast(page)).toHaveText(/Hidden: 1 file/);
        expect(material.hides).toHaveLength(1);
        await page.keyboard.press('Escape');
        await page.locator('#materials-modal .close-btn').click();
        await inStep(page, bridge);
    });

    test('the research moved on before the write: its head is not taken, the newer version stays offered', async ({ page }) => {
        const { bridge } = await setup(page, { files: [materialFile(1, { title: 'Rodinná fotka' })] });
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD);
        await poll(page);
        await view(page, 'Rodinná fotka');
        await act(page, 'assign').click();
        await pick(page, ['Jan Fíšek']);
        await dialog(page).locator('.mdlg-btn.is-primary').click();
        await expect(toast(page)).toContainText('Assigned: 1 file to');
        await page.waitForTimeout(200);
        expect(await treeHead(page)).toBe(HEAD);
        await page.keyboard.press('Escape');
        await page.locator('#materials-modal .close-btn').click();
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'newer');
    });

    /** Assign "Rodinná fotka" to Jan from the viewer; its toast said. */
    async function assignToJan(page: Page): Promise<void> {
        await view(page, 'Rodinná fotka');
        await act(page, 'assign').click();
        await pick(page, ['Jan Fíšek']);
        await dialog(page).locator('.mdlg-btn.is-primary').click();
        await expect(toast(page)).toContainText('Assigned: 1 file to');
    }

    /** The tree kept its head; the research's newer version (its agent's commit) is offered. */
    async function newerOffered(page: Page, head: string): Promise<void> {
        await page.waitForTimeout(200);
        expect(await treeHead(page)).toBe(head);
        await page.keyboard.press('Escape');
        await page.locator('#materials-modal .close-btn').click();
        await poll(page);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'newer');
    }

    test('its agent committed after the last ask (an older research, no parent): asked right before the write, nothing taken', async ({ page }) => {
        const { bridge, material } = await setup(page, { files: [materialFile(1, { title: 'Rodinná fotka' })] });
        // The app's last poll said HEAD; the agent commits before the write — no poll in between.
        foreignCommit(bridge);
        await assignToJan(page);
        expect(material.assigns).toHaveLength(1);
        await newerOffered(page, HEAD);
    });

    test('its agent committed right as the write arrived: the answer\'s parent is not the tree\'s head, nothing taken', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1, { title: 'Rodinná fotka' })] });
        material.writeParent = true;
        material.foreignAtWrite = 1;
        await assignToJan(page);
        await newerOffered(page, HEAD);
    });

    test('the answer\'s parent is the tree\'s head: taken, still in step (no /status asked before the next write)', async ({ page }) => {
        const { bridge, material } = await setup(page, { files: [materialFile(1, { title: 'Rodinná fotka' })] });
        material.writeParent = true;
        await assignToJan(page);
        await expect.poll(() => treeHead(page)).toBe(bridge.head);
        // The research says parent: the Undo goes without asking its status first.
        const statusAsks = () => (bridge.seen ?? []).filter(x => x.startsWith('GET /status')).length;
        const asked = statusAsks();
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => material.assigns.length).toBe(2);
        await expect.poll(() => treeHead(page)).toBe(bridge.head);
        expect(statusAsks()).toBe(asked);
        await page.keyboard.press('Escape');
        await page.locator('#materials-modal .close-btn').click();
        await inStep(page, bridge);
    });

    test('a write takes seconds: the button is busy, a second click sends nothing more', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1, { title: 'Rodinná fotka' })] });
        material.writeDelayMs = 1500;
        await view(page, 'Rodinná fotka');
        await act(page, 'assign').click();
        await pick(page, ['Jan Fíšek']);
        const go = dialog(page).locator('.mdlg-btn.is-primary');
        await go.click();
        await expect(dialog(page)).toHaveAttribute('aria-busy', 'true');
        await expect(go).toBeDisabled();
        await go.dispatchEvent('click');
        await expect(dialog(page)).toHaveCount(0);
        await expect(toast(page)).toContainText('Assigned: 1 file to');
        expect(material.assigns).toHaveLength(1);

        // × on a chip: the chip waits, a second click sends nothing more.
        const x = chips(page).first().locator('.mv-chip-x');
        await x.click();
        await expect(x).toHaveAttribute('aria-busy', 'true');
        await x.dispatchEvent('click');
        await expect(chips(page)).toHaveCount(0);
        expect(material.assigns).toHaveLength(2);
    });
});

test.describe('The research refuses', () => {
    test.use({ viewport: DESKTOP });

    test('busy: asked again quietly, then it goes through', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1)] });
        await view(page, 'scan-1.jpg');
        await act(page, 'assign').click();
        await pick(page, ['Jan Fíšek']);
        material.busyTimes = 2;
        await dialog(page).locator('.mdlg-btn.is-primary').click();
        await expect(toast(page)).toContainText('Assigned: 1 file to Jan Fíšek.');
        expect(material.assigns).toHaveLength(3);
        await expect(chips(page)).toHaveCount(1);
    });

    test('a person the research no longer has: the sentence in the dialog with Reload; nothing changes', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1)], people: { P0001: 'Josef Fíšek', P0003: 'Jan Fíšek' } });
        await view(page, 'scan-1.jpg');
        await act(page, 'assign').click();
        await pick(page, ['Anna Svobodová']);
        await dialog(page).locator('.mdlg-btn.is-primary').click();
        const err = dialog(page).locator('.mdlg-error');
        await expect(err).toContainText('The person is missing in the research (merged or removed). Nothing changed.');
        await expect(err.getByRole('button', { name: 'Reload' })).toBeVisible();
        await expect(panel(page).locator('.mv-none')).toBeVisible();
        const asks = material.asks.length;
        await err.getByRole('button', { name: 'Reload' }).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(() => material.asks.length).toBe(asks + 1);
        expect(material.asks.at(-1)).toBe('');
    });

    test('a file gone from the research, and a research that cannot be written to', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1, { persons: ['P0003'] })] });
        await view(page, 'scan-1.jpg');
        material.files = [];
        await act(page, 'hide').click();
        await dialog(page).getByRole('button', { name: 'Hide', exact: true }).click();
        await expect(dialog(page).locator('.mdlg-error')).toContainText('The file is no longer in the research. Nothing changed.');
        await page.keyboard.press('Escape');
        await expect(act(page, 'hide')).toBeVisible();

        material.files = [materialFile(1, { persons: ['P0003'] })];
        material.readonly = true;
        await chips(page).first().locator('.mv-chip-x').click();
        await expect(toast(page)).toHaveText(/The research cannot be written to right now\./);
        await expect(toast(page).locator('.toast-action')).toHaveCount(0);
        await expect(chips(page)).toHaveCount(1);
    });
});

test.describe('Materials viewer on a phone', () => {
    test('the details as a sheet: collapsed with a summary and two actions, "All details" pulls it up', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await setup(page, { files: [materialFile(1, { persons: ['P0003'], title: 'Křestní list', kind: 'document', date: '12 MAR 1901' })] });
        await openWindow(page);
        await win(page).locator('.mw-tile[data-key="m:I0001"]').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(panel(page).locator('.mv-summary')).toBeVisible();
        await expect(panel(page).locator('.mv-fields')).toBeHidden();
        await expect(panel(page).locator('.mv-act:visible')).toHaveCount(2);
        const more = panel(page).locator('.mv-more');
        await expect(more).toHaveText('All details');
        await more.click();
        await expect(more).toHaveText('Fewer details');
        await expect(panel(page).locator('.mv-fields')).toBeVisible();
        await expect(panel(page).locator('.mv-summary')).toBeHidden();
    });
});
