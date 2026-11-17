import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, HEAD, UUID, BRIDGE,
    FakeMaterial, FakeMaterialFile,
} from './research-bridge.js';

/**
 * Sort with the agent (spec 102 §13): nothing goes to the agent before its
 * dialog said what it costs and where the files go and its button was
 * clicked — closing, Esc, Cancel, a batch's end and a reload send nothing.
 * The proposal is accepted into the research's files, a person's title stays.
 * Without the research's gate only the batch strip says a newer research can;
 * without an agent nothing is offered. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const ARCHIVE = { ...MEDIA_ACCEPTS, mode: 'archive', sync: { auto: 'mirror' }, media: { ...MEDIA_ACCEPTS.media, tasks: 'parked' } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };
const SORT_FEATURES = [...MATERIAL_FEATURES, 'material.edit', 'material.sort'];
const BATCH = { id: 'b-12345678', name: 'Krabice od babičky', at: '2026-11-10T09:00:00Z' };

const win = (page: Page) => page.locator('#materials-modal');
const strip = (page: Page) => win(page).locator('.mw-sort');
const sortDialog = (page: Page) => page.locator('.mdlg--sort');
const proposal = (page: Page) => page.locator('#material-sort-proposal');

function files(): FakeMaterialFile[] {
    return [
        materialFile(1, { batch: BATCH.id }),
        materialFile(2, { batch: BATCH.id, title: 'Grandma at the well' }),
        materialFile(3, { batch: BATCH.id }),
    ];
}

async function setup(page: Page, opts: { features?: string[]; archive?: boolean } = {}): Promise<FakeMaterial> {
    const material = fakeMaterial({
        files: files(), batches: [BATCH], people: PEOPLE,
        sortProposals: [
            { id: 'I0001', title: 'Wedding 1924', kind: 'photo', links: [{ type: 'person', ref: 'P0001' }], why: 'A veil and a bouquet', sure: 'high' },
            { id: 'I0002', title: 'Agent’s other title', links: [], why: 'A well', sure: 'low' },
        ],
    });
    const ged = opts.archive
        ? researchGed(HEAD).replace('1 _STROM_LINKS send open live app setup', '1 _STROM_LINKS send open live app setup\n1 _STROM_MODE archive')
        : researchGed();
    const accepts = opts.archive ? ARCHIVE : MEDIA_ACCEPTS;
    await fakeBridge(page, { accepts, features: opts.features ?? SORT_FEATURES, material, treeGed: ged });
    await openResearch(page, { media: true, ged });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts });
    await poll(page);
    return material;
}

async function openWindow(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    await expect(win(page).locator('.mw-canvas .mw-tile').first()).toBeVisible();
}

test.describe('Sort with the agent', () => {
    test.use({ viewport: DESKTOP });

    test('nothing is sent without the dialog\'s click: close, Esc, Cancel, a batch\'s end and a reload', async ({ page }) => {
        const material = await setup(page);
        await openWindow(page);
        await expect(strip(page)).toContainText('3 new files · 2 without title · 3 without person');
        const btn = strip(page).locator('[data-sort="sort"]');
        await expect(btn.locator('.research-ai-badge')).toHaveCount(1);
        await expect(btn.locator('.research-open-mark')).toHaveCount(0);

        // The dialog says where the files go and what it costs, before anything is sent.
        await btn.click();
        await expect(sortDialog(page)).toContainText('What the agent opens goes to the model provider.');
        await expect(sortDialog(page)).toContainText('Uses the subscription or credit.');
        await sortDialog(page).locator('.mdlg-sort-text').fill('A box from the attic, the Fíšek family');
        await page.keyboard.press('Escape');
        await expect(sortDialog(page)).toHaveCount(0);
        await btn.click();
        await sortDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(sortDialog(page)).toHaveCount(0);
        await btn.click();
        // A click beside the dialog closes it.
        await page.locator('.mdlg-overlay').click({ position: { x: 5, y: 5 } });
        await expect(sortDialog(page)).toHaveCount(0);

        // The selection's action opens the same dialog.
        await btn.focus();
        await page.keyboard.press('ControlOrMeta+a');
        const sel = win(page).locator('.mw-selbar [data-mw="sel-sort"]');
        await expect(sel).toBeVisible();
        await sel.click();
        await expect(sortDialog(page)).toContainText('Sort with the agent · 3 files');
        await page.keyboard.press('Escape');
        await expect(sortDialog(page)).toHaveCount(0);

        // A batch's end offers the dialog and sends nothing by itself.
        await page.evaluate(() => (window.Strom.UI as unknown as { closeMaterials(): void }).closeMaterials());
        await expect(win(page)).toHaveCount(0);
        await page.evaluate(() => (window.Strom.UI as unknown as { showBatchDialog(): void }).showBatchDialog());
        await page.evaluate(() => {
            const list = ['Krabice/a.jpg', 'Krabice/b.jpg'].map(path => ({ path, file: new File([`obsah ${path}`], path.split('/').pop()!, { type: 'image/jpeg' }) }));
            (window.Strom.UI as unknown as { addBatchFiles(f: unknown): void }).addBatchFiles(list);
        });
        const batch = page.locator('#batch-modal');
        await batch.locator('[data-act="next"]').click();
        await batch.getByRole('button', { name: 'Send 2 files' }).click();
        await expect(batch.locator('.batch-sort [data-act="sort-agent"]')).toBeVisible();
        await expect(batch.locator('.batch-sort')).toContainText('2 files without title · 2 without person');

        await page.reload();
        await poll(page);
        await page.waitForTimeout(500);
        expect(material.sorts ?? []).toHaveLength(0);
    });

    test('the click sends the files and the text once; the proposal is accepted, a person\'s title stays', async ({ page }) => {
        const material = await setup(page);
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-text').fill('A box from the attic, the Fíšek family');
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(sortDialog(page)).toHaveCount(0);
        expect(material.sorts).toHaveLength(1);
        expect([...(material.sorts![0].ids as string[])].sort()).toEqual(['I0001', 'I0002', 'I0003']);
        expect(material.sorts![0].text).toBe('A box from the attic, the Fíšek family');

        await expect(strip(page)).toContainText('The agent’s proposal is ready');
        await strip(page).locator('[data-sort="open"]').click();
        await expect(proposal(page)).toBeVisible();
        const row1 = proposal(page).locator('.msp-row[data-id="I0001"]');
        const row2 = proposal(page).locator('.msp-row[data-id="I0002"]');
        await expect(row1.locator('.msp-title')).toHaveText('Wedding 1924');
        await expect(row1.locator('.msp-chip')).toContainText('Josef Fíšek');
        // The person's title stays; the agent's is only shown beside it.
        await expect(row2.locator('.msp-kept')).toContainText('Grandma at the well');
        await expect(row2.locator('.msp-kept')).toContainText('Agent’s other title');
        // The file without a proposal waits under Unassigned.
        await expect(proposal(page).locator('.msp-tab[data-tab="unassigned"]')).toContainText('1');

        await proposal(page).locator('.msp-accept-all').click();
        await expect.poll(() => (material.edits ?? []).length).toBeGreaterThan(0);
        const edits = JSON.stringify(material.edits);
        expect(edits).toContain('Wedding 1924');
        expect(edits).not.toContain('Agent’s other title');
        await expect.poll(() => JSON.stringify(material.assigns)).toContain('P0001');
        expect(material.sorts).toHaveLength(1);
    });

    test('a research without the gate: only the batch strip says a newer one can', async ({ page }) => {
        const material = await setup(page, { features: [...MATERIAL_FEATURES, 'material.edit'] });
        await openWindow(page);
        await expect(strip(page)).toHaveText('A newer version of the research can sort with the agent.');
        await expect(strip(page).locator('[data-sort]')).toHaveCount(0);
        await page.keyboard.press('ControlOrMeta+a');
        await expect(win(page).locator('.mw-selbar')).toBeVisible();
        await expect(win(page).locator('[data-mw="sel-sort"], [data-action="sel-sort"]')).toHaveCount(0);
        expect(material.sorts ?? []).toHaveLength(0);
    });

    test('an archive without an agent offers nothing', async ({ page }) => {
        const material = await setup(page, { archive: true });
        await openWindow(page);
        await expect(strip(page)).toBeHidden();
        await page.keyboard.press('ControlOrMeta+a');
        await expect(win(page).locator('.mw-selbar')).toBeVisible();
        await expect(win(page).locator('[data-mw="sel-sort"], [data-action="sel-sort"]')).toHaveCount(0);
        expect(material.sorts ?? []).toHaveLength(0);
    });
});
