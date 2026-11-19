import { readFileSync } from 'node:fs';
import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, materialSha, MATERIAL_FEATURES, openResearch, openResearchMenu, poll, researchGed, HEAD, UUID, BRIDGE,
    FakeBridge, FakeMaterial, FakeMaterialFile,
} from './research-bridge.js';

/**
 * Sort with the agent (spec 102 §13, §1, §5, §6): nothing goes to the agent
 * before its dialog said what it costs and where the files go and its button
 * was clicked — closing, Esc, Cancel, a batch's end and a reload send nothing.
 * One strip over the Materials window says the state of the whole archive
 * (A–F), with a filter too. The proposal is accepted into the research's
 * files, a person's title stays; its end says what was done and what is left
 * (Sort the next), and it closes by itself or with Close the proposal….
 * Without the research's gate the strip says a newer research can; without an
 * agent nothing is offered. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const ARCHIVE = { ...MEDIA_ACCEPTS, mode: 'archive', sync: { auto: 'mirror' }, media: { ...MEDIA_ACCEPTS.media, tasks: 'parked' } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };
const SORT_FEATURES = [...MATERIAL_FEATURES, 'material.edit', 'material.sort'];
const BATCH = { id: 'b-12345678', name: 'Krabice od babičky', at: '2026-11-10T09:00:00Z' };

const win = (page: Page) => page.locator('#materials-modal');
/** The one strip of sorting over the list (spec 102 §1), its state in data-state (A–F). */
const strip = (page: Page) => win(page).locator('.mw-sort--top');
const sortDialog = (page: Page) => page.locator('.mdlg--sort');
const proposal = (page: Page) => page.locator('#material-sort-proposal');

function files(): FakeMaterialFile[] {
    return [
        materialFile(1, { batch: BATCH.id }),
        materialFile(2, { batch: BATCH.id, title: 'Grandma at the well' }),
        materialFile(3, { batch: BATCH.id }),
    ];
}

const PROPOSALS = [
    { id: 'I0001', title: 'Wedding 1924', kind: 'photo', links: [{ type: 'person', ref: 'P0001' }], why: 'A veil and a bouquet', sure: 'high' },
    { id: 'I0002', title: 'Agent’s other title', links: [], why: 'A well', sure: 'low' },
];

async function setup(page: Page, opts: { features?: string[]; archive?: boolean; proposals?: Record<string, unknown>[]; bridge?: (b: FakeBridge) => void;
    files?: FakeMaterialFile[]; batches?: typeof BATCH[] } = {}): Promise<FakeMaterial> {
    const material = fakeMaterial({
        files: [...files(), ...(opts.files ?? [])], batches: [BATCH, ...(opts.batches ?? [])], people: PEOPLE,
        sortProposals: opts.proposals ?? PROPOSALS,
    });
    const ged = opts.archive
        ? researchGed(HEAD).replace('1 _STROM_LINKS send open live app setup', '1 _STROM_LINKS send open live app setup\n1 _STROM_MODE archive')
        : researchGed();
    const accepts = opts.archive ? ARCHIVE : MEDIA_ACCEPTS;
    const bridge = await fakeBridge(page, { accepts, features: opts.features ?? SORT_FEATURES, material, treeGed: ged });
    opts.bridge?.(bridge);
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
        await expect(strip(page)).toHaveAttribute('data-state', 'A');
        await expect(strip(page).locator('.mw-sort-text')).toHaveText('3 files without title or person');
        // No strip under a batch any more: the one over the list stands for the whole archive.
        await expect(win(page).locator('.mw-sort--row, .mw-sort--whole')).toHaveCount(0);
        const btn = strip(page).locator('[data-sort="sort"]');
        await expect(btn).toHaveClass(/primary/);
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

    test('a batch\'s end: Sort with the agent says in a toast that its files are asked for until its dialog opens', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => (window.Strom.UI as unknown as { showBatchDialog(): void }).showBatchDialog());
        await page.evaluate(() => {
            const list = ['Krabice/a.jpg', 'Krabice/b.jpg'].map(path => ({ path, file: new File([`obsah ${path}`], path.split('/').pop()!, { type: 'image/jpeg' }) }));
            (window.Strom.UI as unknown as { addBatchFiles(f: unknown): void }).addBatchFiles(list);
        });
        const batch = page.locator('#batch-modal');
        await batch.locator('[data-act="next"]').click();
        await batch.getByRole('button', { name: 'Send 2 files' }).click();
        await expect(batch.locator('.batch-sort [data-act="sort-agent"]')).toBeVisible();
        let release = (): void => undefined;
        const held = new Promise<void>(r => { release = r; });
        await page.route(u => /\/material$/.test(u.pathname) && u.searchParams.has('batch'), async (route) => { await held; await route.fallback(); });
        await batch.locator('.batch-sort [data-act="sort-agent"]').click();
        await expect(batch).toHaveCount(0);
        const toast = page.locator('.toast.toast--progress');
        await expect(toast).toBeVisible();
        await expect(sortDialog(page)).toHaveCount(0);
        const answered = page.waitForResponse(r => /\/material$/.test(new URL(r.url()).pathname) && new URL(r.url()).searchParams.has('batch'));
        release();
        await answered;
        await expect(toast).toHaveCount(0);
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

        // D: the proposal waits and nothing works (spec 102 §1).
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent’s proposal: 2 to go through');
        await expect(strip(page).locator('.mw-sort-note')).toHaveText('1 batch · 3 files');
        await expect(strip(page).locator('[data-sort="open"]')).toHaveText('Go through the proposal (2)');
        // The research menu's Materials row carries the waiting dot (13e).
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-materials .research-item-attn')).toHaveCount(1);
        await expect(page.locator('#research-item-materials')).toHaveAttribute('aria-label', /The agent’s proposal is ready/);
        await page.keyboard.press('Escape');
        await strip(page).locator('[data-sort="open"]').click();
        // The tabs are the Line (spec 046): the chosen one has the dark line, never the green one.
        const chosen = proposal(page).locator('.msp-tab[aria-selected="true"]');
        await expect(chosen).toHaveClass(/sel-tab/);
        expect(await chosen.evaluate(el => ({ border: getComputedStyle(el).borderBottomStyle, line: getComputedStyle(el).boxShadow.includes('inset') })))
            .toEqual({ border: 'none', line: true });
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

    test('a research without the gate: the strip says a newer one can, nothing to send', async ({ page }) => {
        const material = await setup(page, { features: [...MATERIAL_FEATURES, 'material.edit'] });
        await openWindow(page);
        await expect(strip(page)).toHaveAttribute('data-state', 'A');
        await expect(strip(page)).toHaveClass(/is-off/);
        await expect(strip(page).locator('.mw-sort-note')).toHaveText('A newer version of the research can sort with the agent.');
        await expect(strip(page).locator('[data-sort="sort"], [data-sort="next"]')).toHaveCount(0);
        await page.keyboard.press('ControlOrMeta+a');
        await expect(win(page).locator('.mw-selbar')).toBeVisible();
        await expect(win(page).locator('[data-mw="sel-sort"], [data-action="sel-sort"]')).toHaveCount(0);
        expect(material.sorts ?? []).toHaveLength(0);
    });

    test('an archive without an agent offers nothing', async ({ page }) => {
        const material = await setup(page, { archive: true });
        await openWindow(page);
        await expect(win(page).locator('.mw-sort:visible')).toHaveCount(0);
        await page.keyboard.press('ControlOrMeta+a');
        await expect(win(page).locator('.mw-selbar')).toBeVisible();
        await expect(win(page).locator('[data-mw="sel-sort"], [data-action="sel-sort"]')).toHaveCount(0);
        expect(material.sorts ?? []).toHaveLength(0);
    });

    test('one strip for the whole archive, with a filter too; a batch is sorted from its ⋯ menu; while it works the strip says it everywhere', async ({ page }) => {
        const other = { id: 'b-87654321', name: 'Dopisy z Talvan', at: '2026-11-12T09:00:00Z' };
        const material = await setup(page, { batches: [other], files: [materialFile(7, { batch: other.id }), materialFile(8, { batch: other.id })] });
        material.sortDoneAt = 99;
        await openWindow(page);
        await expect(strip(page)).toHaveAttribute('data-state', 'A');
        await expect(strip(page).locator('.mw-sort-text')).toHaveText('5 files without title or person');
        // A narrowing filter keeps the archive's strip as it is (spec 102 §1).
        await win(page).locator('[data-mw="nosource"]').click();
        await expect(strip(page)).toBeVisible();
        await expect(strip(page).locator('.mw-sort-text')).toHaveText('5 files without title or person');
        await expect(win(page).locator('.mw-sort--row')).toHaveCount(0);
        // The batch's ⋯ menu: Sort with the agent… (AI badge alone) opens the dialog for its files.
        await win(page).locator('.mw-canvas .mw-group', { hasText: BATCH.name }).locator('[data-mw="batch-menu"]').click();
        const item = page.locator('.mw-pop-batchMenu [data-action="sort"]');
        await expect(item.locator('.research-ai-badge')).toHaveCount(1);
        await expect(item.locator('.research-open-mark')).toHaveCount(0);
        await item.click();
        await expect(sortDialog(page)).toContainText('3 files from the batch Krabice od babičky');
        await sortDialog(page).locator('.mdlg-sort-go').click();
        expect(material.sorts).toHaveLength(1);
        expect([...(material.sorts![0].ids as string[])].sort()).toEqual(['I0001', 'I0002', 'I0003']);
        // B: it works and nothing waits: no ×, Cancel only; the same with and without the filter.
        await expect(strip(page)).toHaveAttribute('data-state', 'B');
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent is sorting · 3 files');
        await expect(strip(page).locator('[data-sort="close"], [data-sort="open"]')).toHaveCount(0);
        await expect(strip(page).locator('[data-sort="cancel"]')).toBeVisible();
        await win(page).locator('[data-mw="nosource"]').click();
        await expect(strip(page)).toHaveAttribute('data-state', 'B');
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent is sorting · 3 files');
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-materials .research-item-dot')).toHaveCount(1);
        await page.keyboard.press('Escape');
    });

    test('a batch sends only its files without a title or a person; a selection sends every file selected', async ({ page }) => {
        // I0004 in the batch has its title and a person: the strip and its dialog leave it out.
        const material = await setup(page, { files: [materialFile(4, { batch: BATCH.id, title: 'Letter from Talvany', persons: ['P0001'] })] });
        await openWindow(page);
        await expect(strip(page).locator('.mw-sort-text')).toHaveText('3 files without title or person');
        await win(page).locator('.mw-canvas [data-mw="batch-menu"]').first().click();
        await page.locator('.mw-pop-batchMenu [data-action="sort"]').click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 3 files');
        await expect(sortDialog(page)).toContainText('3 files from the batch Krabice od babičky');
        await page.keyboard.press('Escape');
        // Selected by hand: all four, the finished one too.
        await strip(page).locator('[data-sort="sort"]').focus();
        await page.keyboard.press('ControlOrMeta+a');
        await win(page).locator('.mw-selbar [data-mw="sel-sort"]').click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 4 files');
        await page.keyboard.press('Escape');
        await win(page).locator('.mw-selbar [data-mw="select"], [data-mw="select"]').first().click();
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sorts?.length ?? 0).toBe(1);
        expect([...(material.sorts![0].ids as string[])].sort()).toEqual(['I0001', 'I0002', 'I0003']);
    });

    test('Cancel with proposals made asks: keep them (the proposal stays) or discard them', async ({ page }) => {
        const material = await setup(page);
        material.sortDoneAt = 99;
        material.sortWorkingProposals = 1;
        material.sortFilesDone = 1;
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(strip(page)).toContainText('The agent is sorting · 1 of 3');
        await strip(page).locator('[data-sort="cancel"]').click();
        const ask = page.locator('.mdlg', { hasText: 'Discard the finished proposals?' });
        await expect(ask).toBeVisible();
        await expect(ask.getByRole('button', { name: 'Keep them' })).toBeFocused();
        await ask.getByRole('button', { name: 'Keep them' }).click();
        // The proposals made stay: D, waiting and nothing at work.
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent’s proposal: 1 to go through');
        expect(material.cancels).toHaveLength(1);

        // A new sorting from the selection, cancelled and its proposals discarded: the strip offers sorting again.
        await win(page).locator('.mw-canvas .mw-tile').first().focus();
        await page.keyboard.press('ControlOrMeta+a');
        await win(page).locator('.mw-selbar [data-mw="sel-sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        // The click ends before its request reaches the research: counted once it has.
        await expect.poll(() => material.sorts?.length).toBe(2);
        await page.keyboard.press('Escape');
        // C: it works and a proposal waits already.
        await expect(strip(page)).toHaveAttribute('data-state', 'C');
        await expect(strip(page)).toContainText('1 of 3');
        await strip(page).locator('[data-sort="cancel"]').click();
        await page.locator('.mdlg', { hasText: 'Discard the finished proposals?' }).getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(strip(page)).toHaveAttribute('data-state', 'A');
        await expect(strip(page).locator('.mw-sort-text')).toHaveText('3 files without title or person');
        await expect(strip(page).locator('[data-sort="sort"]')).toBeVisible();
        expect(material.cancels).toHaveLength(2);
    });

    test('Sort with the agent says Sending… on its button and the strip\'s Cancel Cancelling… until the research answers', async ({ page }) => {
        const material = await setup(page);
        material.sortDoneAt = 99;
        material.sortWorkingProposals = 1;
        material.sortFilesDone = 1;
        await openWindow(page);
        let release!: () => void;
        let held = new Promise<void>(r => { release = r; });
        await page.route(url => /\/material\/sort(\/[^/]+\/cancel)?$/.test(url.pathname), async route => {
            if (route.request().method() === 'POST') await held;
            await route.fallback();
        });
        await strip(page).locator('[data-sort="sort"]').click();
        const go = sortDialog(page).locator('.mdlg-sort-go');
        await go.click();
        await expect(go).toHaveAttribute('data-busy', 'busy');
        await expect(go).toContainText('Sending…');
        release();
        await expect(strip(page)).toContainText('The agent is sorting · 1 of 3');
        expect(material.sorts).toHaveLength(1);

        held = new Promise<void>(r => { release = r; });
        const cancel = strip(page).locator('[data-sort="cancel"]');
        await cancel.click();
        await expect(cancel).toHaveAttribute('data-busy', 'busy');
        await expect(cancel).toContainText('Cancelling…');
        await cancel.click();
        release();
        await expect(page.locator('.mdlg', { hasText: 'Discard the finished proposals?' })).toBeVisible();
        expect(material.cancels).toHaveLength(1);
    });

    test('the research turns a sorting down: said in the dialog, sent once per click, never again by itself', async ({ page }) => {
        const material = await setup(page);
        await openWindow(page);
        const cases: Array<[string, string]> = [
            ['sort.limit', 'The research’s limit for reading by the agent is used up for now.'],
            ['sort.queue', 'Too many sortings are waiting in the research; it is possible again later.'],
            ['sort.not-ready', 'The agent cannot work now: agent-busy'],
        ];
        await strip(page).locator('[data-sort="sort"]').click();
        for (const [i, [code, text]] of cases.entries()) {
            material.sortRefuse = code;
            await sortDialog(page).locator('.mdlg-sort-go').click();
            await expect(sortDialog(page).locator('.mdlg-error')).toHaveText(text);
            expect(material.sorts).toHaveLength(i + 1);
        }
        await page.waitForTimeout(2500);
        expect(material.sorts).toHaveLength(cases.length);
        await expect(sortDialog(page)).toBeVisible();
    });

    test('a row edited (title, a link off, + Person…) is accepted as edited and undone back through the bridge', async ({ page }) => {
        const material = await setup(page);
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await strip(page).locator('[data-sort="open"]').click();
        const row1 = proposal(page).locator('.msp-row[data-id="I0001"]');
        await row1.locator('.msp-edit').click();
        await row1.locator('.msp-edit-title').fill('Wedding of Josef and Anna');
        await row1.locator('.msp-chip', { hasText: 'Josef Fíšek' }).locator('.msp-chip-x').click();
        await row1.locator('.msp-add-person').click();
        await row1.locator('.person-picker-input').fill('Anna');
        await row1.locator('.person-picker-item', { hasText: 'Anna' }).first().click();
        await expect(row1.locator('.msp-chip')).toHaveText(['Anna Svobodová×']);
        await row1.locator('.msp-accept-edited').click();
        await expect.poll(() => JSON.stringify(material.edits ?? [])).toContain('Wedding of Josef and Anna');
        await expect.poll(() => JSON.stringify(material.assigns ?? [])).toContain('P0002');
        expect(JSON.stringify(material.assigns)).not.toContain('P0001');

        // Undo under Done: the research gets its title and people back, the row is a proposal again.
        await proposal(page).locator('.msp-tab[data-tab="done"]').click();
        const done1 = proposal(page).locator('.msp-row[data-id="I0001"]');
        await expect(done1.locator('.msp-state')).toHaveText('Accepted');
        const edits = material.edits!.length;
        await done1.locator('.msp-undo').click();
        await expect.poll(() => material.edits!.length).toBe(edits + 1);
        expect(material.edits![edits]).toMatchObject({ ids: ['I0001'], title: '' });
        await expect.poll(() => JSON.stringify(material.assigns!.at(-1))).toContain('remove');
        expect(JSON.stringify(material.assigns!.at(-1))).toContain('P0002');
        await proposal(page).locator('.msp-tab[data-tab="proposals"]').click();
        await expect(proposal(page).locator('.msp-row[data-id="I0001"] .msp-accept')).toBeVisible();
        expect(material.sorts).toHaveLength(1);
    });

    test('material outside the tree: an event, a known and a research source the tree lacks go into the tree; Undo takes them out', async ({ page }) => {
        let fb!: FakeBridge;
        const material = await setup(page, {
            proposals: [
                { id: 'I0003', title: 'Marriage record', kind: 'record', why: 'A register page', sure: 'high',
                    links: [{ type: 'event', ref: 'F0001', event: 'MARR' }, { type: 'source', ref: 'S0001' }, { type: 'source', ref: 'S0099' }] },
                { id: 'I0002', title: 'Marriage record, back', kind: 'record', why: 'The page behind', sure: 'high', links: [{ type: 'source', ref: 'S0099' }] },
            ],
            bridge: b => {
                fb = b;
                b.mediaFiles.set(materialSha('I0003'), { type: 'image/png', body: readFileSync('e2e/fixtures/avatar.png') });
                b.mediaFiles.set(materialSha('I0002'), { type: 'image/png', body: readFileSync('e2e/fixtures/avatar.png') });
            },
        });
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await strip(page).locator('[data-sort="open"]').click();
        const row = proposal(page).locator('.msp-row[data-id="I0003"]');
        await expect(row.locator('.msp-chip')).toContainText(['Event: Marriage · Josef Fíšek & Anna Svobodová', 'Source: Oddací matrika Čapkov', 'Source: Marriage record (from the research)']);
        await row.locator('.msp-accept').click();
        await expect.poll(() => JSON.stringify(material.edits ?? [])).toContain('Marriage record');
        const tree = () => page.evaluate(() => {
            const data = window.Strom.DataManager.getData();
            const media = Object.values(data.media ?? {}) as Array<{ title?: string; places: Array<Record<string, string>> }>;
            const sources = Object.values(data.sources ?? {}).map(src => ({ title: src.title, refn: src.refn ?? null }));
            const file = media.find(m => m.places.some(p => p.partnershipId));
            const at99 = Object.values(data.sources ?? {}).filter(src => src.refn === 'S0099').map(src => src.id);
            return { kinds: file ? file.places.map(p => Object.keys(p).filter(k => k !== 'by').join('+')).sort() : [], sources,
                at99: media.filter(m => m.places.some(p => at99.includes(p.sourceId))).length };
        });
        await expect.poll(async () => (await tree()).kinds).toEqual(['partnershipId', 'sourceId', 'sourceId']);
        // The source the research has and the tree did not: made with the research's number, as one loaded from it.
        expect((await tree()).sources.filter(src => src.refn === 'S0099')).toEqual([{ title: 'Marriage record', refn: 'S0099' }]);
        // Another file of the same source: the same source, never a second one.
        await proposal(page).locator('.msp-row[data-id="I0002"] .msp-accept').click();
        await expect.poll(async () => (await tree()).at99).toBe(2);
        expect((await tree()).sources.filter(src => src.refn === 'S0099' || src.title === 'Marriage record')).toHaveLength(1);
        // Written to the research: the source by its number, once (it pairs with the research's own).
        await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
        await expect.poll(() => fb.posts.length).toBeGreaterThan(0);
        const sent = fb.posts.at(-1)!;
        expect(sent.match(/\n1 REFN S0099\r?\n/g)).toHaveLength(1);
        expect(sent.match(/\n1 TITL Marriage record\r?\n/g)).toHaveLength(1);

        await proposal(page).locator('.msp-tab[data-tab="done"]').click();
        await proposal(page).locator('.msp-row[data-id="I0003"] .msp-undo').click();
        await expect.poll(async () => (await tree()).kinds).toEqual([]);
        // The other file still has it: the source stays until that one is undone too.
        expect((await tree()).sources.map(src => src.title)).toContain('Marriage record');
        await proposal(page).locator('.msp-row[data-id="I0002"] .msp-undo').click();
        await expect.poll(async () => (await tree()).sources.map(src => src.title)).not.toContain('Marriage record');
        expect(material.sorts).toHaveLength(1);
    });
});

test.describe('Sort with the agent: the progress and the open proposal', () => {
    test.use({ viewport: DESKTOP });

    const bar = (page: Page) => strip(page).locator('.mw-sort-bar');

    test('a research that does not say how far it is: the file count and a progress without a number, still under reduced motion', async ({ page }) => {
        const material = await setup(page);
        material.sortDoneAt = 99;
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent is sorting · 3 files');
        await expect(strip(page)).not.toContainText(' of ');
        await expect(bar(page)).toHaveAttribute('role', 'progressbar');
        await expect(bar(page)).not.toHaveAttribute('aria-valuenow', /.*/);
        await expect(bar(page)).toHaveAttribute('aria-label', 'The agent is sorting · 3 files');
        // The suite runs with reduced motion: the bar stands still there, it moves only without it.
        const animation = () => bar(page).locator('span').evaluate(el => getComputedStyle(el).animationName);
        expect(await animation()).toBe('none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        expect(await animation()).toBe('mw-sort-sweep');

        // A phone: the strip with its bar stays within the window.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(bar(page)).toBeVisible();
        const over = await win(page).locator('.mw-sort').evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).length);
        expect(over).toBe(0);
    });

    test('a research that says the files judged: k of n and the bar\'s value', async ({ page }) => {
        const material = await setup(page);
        material.sortDoneAt = 99;
        material.sortFilesDone = 2;
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent is sorting · 2 of 3');
        await expect(bar(page)).toHaveAttribute('aria-valuenow', '2');
        await expect(bar(page)).toHaveAttribute('aria-valuemax', '3');
        await expect(bar(page)).not.toHaveClass(/is-indeterminate/);
        // More than sent is never said.
        material.sortFilesDone = 7;
        await expect(bar(page)).toHaveAttribute('aria-valuenow', '3');
    });

    test('the open proposal stays still while the research is asked: no preview drawn anew', async ({ page }) => {
        await page.clock.install({ time: new Date('2026-11-18T20:00:00Z') });
        await setup(page, {
            bridge: b => {
                for (const id of ['I0001', 'I0002', 'I0003']) b.mediaFiles.set(materialSha(id), { type: 'image/png', body: readFileSync('e2e/fixtures/avatar.png') });
            },
        });
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await strip(page).locator('[data-sort="open"]').click();
        await expect(proposal(page).locator('.msp-row')).toHaveCount(2);
        await expect(proposal(page).locator('.msp-thumb img').first()).toBeVisible();

        // Every preview and image as drawn now; any of them taken out or replaced is counted.
        await page.evaluate(() => {
            const w = window as unknown as { __mspSwaps: number; __mspThumbs: Element[] };
            w.__mspSwaps = 0;
            w.__mspThumbs = [...document.querySelectorAll('#material-sort-proposal .msp-thumb')];
            new MutationObserver(records => {
                for (const r of records) {
                    for (const n of r.removedNodes) {
                        if (n instanceof Element && (n.matches('img, .msp-thumb') || n.querySelector('img, .msp-thumb'))) w.__mspSwaps++;
                    }
                }
            }).observe(document.querySelector('#material-sort-proposal')!, { childList: true, subtree: true });
        });
        // 30 s without a click: the research asked again and again (its polls redraw the Materials window).
        for (let i = 0; i < 6; i++) {
            await poll(page);
            await page.clock.runFor(5_000);
        }
        const after = await page.evaluate(() => {
            const w = window as unknown as { __mspSwaps: number; __mspThumbs: Element[] };
            return { swaps: w.__mspSwaps, same: w.__mspThumbs.every(el => el.isConnected) };
        });
        expect(after).toEqual({ swaps: 0, same: true });
    });
});

test.describe('Sort with the agent: the one strip over the whole archive (spec 102 §1)', () => {
    test.use({ viewport: DESKTOP });
    const top = strip;
    const other = { id: 'b-87654321', name: 'Dopisy z Talvan', at: '2026-11-12T09:00:00Z' };
    /** Two batches and a loose file: I0007 has its title and a person, the other five lack one of them. */
    const spread = () => ({
        batches: [other],
        files: [
            materialFile(7, { batch: other.id, title: 'Letter from Talvany', persons: ['P0001'] }),
            materialFile(8, { batch: other.id }),
            materialFile(9, { title: 'Grandpa’s passport' }),
        ],
    });

    test('A counts only the files without a title or a person; Go through by hand; its dialog says the count and the cost; × closes it while the window is open; nothing is sent by itself', async ({ page }) => {
        const material = await setup(page, spread());
        await openWindow(page);
        await expect(top(page)).toHaveAttribute('data-state', 'A');
        await expect(top(page).locator('.mw-sort-text')).toHaveText('5 files without title or person');
        const btn = top(page).locator('[data-sort="sort"]');
        await expect(btn.locator('.research-ai-badge')).toHaveCount(1);
        await expect(btn.locator('.research-open-mark')).toHaveCount(0);

        // Go through by hand: the files the sorting would take, in the viewer.
        await top(page).locator('[data-sort="review"]').click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
        await expect(page.locator('#image-viewer-pos')).toContainText('1 of 5');
        await page.keyboard.press('Escape');
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);

        // The dialog: the count of the files that need it and what it costs; Esc sends nothing.
        await btn.click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 5 files');
        await expect(sortDialog(page)).toContainText('Uses the subscription or credit.');
        await page.keyboard.press('Escape');
        await expect(sortDialog(page)).toHaveCount(0);

        // Selecting has its own Sort with the agent: the offer steps aside meanwhile.
        await win(page).locator('[data-mw="select"]').click();
        await expect(top(page)).toBeHidden();
        await win(page).locator('[data-mw="select"]').click();
        await expect(top(page)).toBeVisible();

        // × closes it while the window is open; the focus goes on to the files.
        await top(page).locator('[data-sort="close"]').click();
        await expect(top(page)).toBeHidden();
        await expect(win(page).locator('.mw-sort--row')).toHaveCount(0);
        await expect(page.locator('#materials-modal :focus')).toHaveCount(1);
        await page.waitForTimeout(2500);
        await expect(top(page)).toBeHidden();
        expect(material.sorts ?? []).toHaveLength(0);
        // The window opened again offers it again.
        await page.evaluate(() => (window.Strom.UI as unknown as { closeMaterials(): void }).closeMaterials());
        await openWindow(page);
        await expect(top(page).locator('.mw-sort-text')).toHaveText('5 files without title or person');

        // Sent only by the dialog's button: the five files, never the one with its title and person.
        await top(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(sortDialog(page)).toHaveCount(0);
        expect(material.sorts).toHaveLength(1);
        expect([...(material.sorts![0].ids as string[])].sort()).toEqual(['I0001', 'I0002', 'I0003', 'I0008', 'I0009']);
        // The same strip says the sorting now (D), never "the proposal is ready" beside an offer.
        await expect(top(page)).toHaveAttribute('data-state', 'D');
        await expect(top(page)).not.toContainText('The agent’s proposal is ready');
    });

    test('everything with a title and a person: nothing is offered', async ({ page }) => {
        const material = fakeMaterial({
            files: [materialFile(1, { batch: BATCH.id, title: 'Wedding 1924', persons: ['P0001'] }), materialFile(9, { title: 'Passport', persons: ['P0002'] })],
            batches: [BATCH], people: PEOPLE,
        });
        await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: SORT_FEATURES, material, treeGed: researchGed() });
        await openResearch(page, { media: true, ged: researchGed() });
        await page.evaluate(({ uuid, base, accepts }) => {
            localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
        }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
        await poll(page);
        await openWindow(page);
        await expect(win(page).locator('.mw-sort:visible')).toHaveCount(0);
    });

    test.describe('beside a 1024 px window', () => {
        test.use({ viewport: { width: 1024, height: 800 } });

        test('the strip keeps its button and its × (the toolbar\'s Sort ▾ hidden there is another one)', async ({ page }) => {
            await setup(page, spread());
            await openWindow(page);
            await expect(win(page).locator('[data-mw="sort-menu"]')).toBeHidden();
            await expect(top(page).locator('[data-sort="sort"]')).toBeVisible();
            await expect(top(page).locator('[data-sort="close"]')).toBeVisible();
            const over = await top(page).evaluate(el => el.scrollWidth > el.clientWidth + 1);
            expect(over).toBe(false);
        });
    });

    test.describe('on a phone (390 px)', () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test('the state only (spec 102 §11): the German text whole, the sentence that sorting is on the computer, no button and no ×', async ({ page }) => {
            await setup(page, spread());
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await openWindow(page);
            await expect(top(page)).toHaveAttribute('data-state', 'A');
            const what = top(page).locator('.mw-sort-what');
            await expect(what).toHaveText('5 Dateien ohne Titel oder Person');
            const fit = await what.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
            expect(fit.sw).toBeLessThanOrEqual(fit.cw);
            expect(fit.sh).toBeLessThanOrEqual(fit.ch);
            const box = await top(page).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
            expect(box.sw).toBeLessThanOrEqual(box.cw);
            await expect(top(page).locator('.mw-sort-phone')).toBeVisible();
            await expect(top(page).locator('.mw-sort-phone-short')).toBeHidden();
            await expect(top(page).locator('button')).toHaveCount(0);
        });
    });
});

/**
 * The end of the proposal and closing it (spec 102 §5, §6): the proposal
 * handled to its end says what was done and what is left in its own window
 * (Sort the next (N)…, what the agent left unassigned); it closes by itself
 * when its window closes with nothing waiting, or before that with Close the
 * proposal… after a question. Closed, the strip says what was done (E) or
 * that nothing is left (F), and the research menu's dot goes.
 */
test.describe('Sort with the agent: the end of the proposal and closing it', () => {
    test.use({ viewport: DESKTOP });
    const ask = (page: Page) => page.locator('.mdlg', { hasText: 'Close the proposal?' });
    const menuMarks = async (page: Page): Promise<number> => {
        await openResearchMenu(page, { expandMore: true });
        const n = await page.locator('#research-item-materials .research-item-attn, #research-item-materials .research-item-dot').count();
        await page.keyboard.press('Escape');
        return n;
    };
    async function sortAndOpen(page: Page, opts: { batchMenu?: boolean } = {}): Promise<void> {
        await openWindow(page);
        if (opts.batchMenu) {
            await win(page).locator('.mw-canvas .mw-group', { hasText: BATCH.name }).locator('[data-mw="batch-menu"]').click();
            await page.locator('.mw-pop-batchMenu [data-action="sort"]').click();
        } else {
            await strip(page).locator('[data-sort="sort"]').click();
        }
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        await strip(page).locator('[data-sort="open"]').click();
        await expect(proposal(page)).toBeVisible();
    }

    test('Close the proposal… asks first, from the proposal\'s footer and from the strip; closed, nothing is written and the strip says what was done (E) with Sort the next and ×', async ({ page }) => {
        const material = await setup(page);
        await sortAndOpen(page);
        // D: no × while proposals wait.
        await expect(strip(page).locator('[data-sort="close"]')).toHaveCount(0);

        // From the footer: Keep (focused) brings the proposal window back.
        await proposal(page).locator('.msp-close-proposal').click();
        await expect(ask(page)).toContainText('2 open proposals will not be written; the files stay unsorted. Accepted ones stay accepted.');
        await expect(ask(page).getByRole('button', { name: 'Keep', exact: true })).toBeFocused();
        await ask(page).getByRole('button', { name: 'Keep', exact: true }).click();
        await expect(proposal(page)).toBeVisible();
        // Closed with proposals waiting: the proposal stays (D).
        await proposal(page).locator('.msp-close').click();
        await expect(proposal(page)).toHaveCount(0);
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        expect(await menuMarks(page)).toBe(1);

        // From the strip: the same question; Close the proposal closes it.
        await strip(page).locator('[data-sort="close-proposal"]').click();
        await ask(page).getByRole('button', { name: 'Close the proposal', exact: true }).click();
        await expect(ask(page)).toHaveCount(0);
        await expect(strip(page)).toHaveAttribute('data-state', 'E');
        await expect(strip(page)).toHaveClass(/is-done/);
        await expect(strip(page).locator('.mw-sort-what')).toHaveText('Done: 0 handled · 1 unassigned · 2 unsorted left');
        expect(material.edits ?? []).toHaveLength(0);
        expect(material.assigns ?? []).toHaveLength(0);
        expect(await menuMarks(page)).toBe(0);

        // Go through by hand: the file the agent left unassigned.
        await strip(page).locator('[data-sort="review"]').click();
        await expect(page.locator('#image-viewer-pos')).toContainText('1 of 1');
        await page.keyboard.press('Escape');
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);

        // Sort the next: the files left, never the one the agent left unassigned.
        const next = strip(page).locator('[data-sort="next"]');
        await expect(next).toContainText('Sort the next (2)…');
        await expect(next.locator('.research-ai-badge')).toHaveCount(1);
        await expect(strip(page).locator('[data-sort="close"]')).toBeVisible();
        await next.click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 2 files');
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sorts?.length).toBe(2);
        expect([...(material.sorts![1].ids as string[])].sort()).toEqual(['I0001', 'I0002']);
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
    });

    test('the end in the proposal window: what was done, Sort the next (N) closes the proposal and opens the dialog; E closes with its ×', async ({ page }) => {
        const other = { id: 'b-87654321', name: 'Dopisy z Talvan', at: '2026-11-12T09:00:00Z' };
        const material = await setup(page, {
            batches: [other], files: [materialFile(8, { batch: other.id }), materialFile(9, { batch: other.id })],
            proposals: [PROPOSALS[0], { id: 'I0002', links: [{ type: 'person', ref: 'P0002' }], why: 'A well', sure: 'low' }],
        });
        await sortAndOpen(page, { batchMenu: true });
        expect([...(material.sorts![0].ids as string[])].sort()).toEqual(['I0001', 'I0002', 'I0003']);
        await proposal(page).locator('.msp-accept-all').click();
        await expect.poll(() => JSON.stringify(material.assigns ?? [])).toContain('P0002');

        // In place of the empty list, the tab stays where it is.
        const end = proposal(page).locator('.msp-end');
        await expect(end.locator('.msp-end-title')).toHaveText('Done · 2 accepted · 0 rejected · 1 unassigned');
        await expect(end.locator('.msp-end-sub')).toHaveText('For the whole run: 1 batch · 3 files');
        await expect(proposal(page).locator('.msp-tab[data-tab="proposals"]')).toHaveAttribute('aria-selected', 'true');
        await expect(proposal(page).locator('.msp-empty')).toHaveCount(0);
        await expect(end).toContainText('2 unsorted files are left in the archive');
        const go = end.locator('.msp-sort-next');
        await expect(go).toContainText('Sort the next (2)…');
        await expect(go.locator('.research-ai-badge')).toHaveCount(1);
        await expect(end).toContainText('The agent did not assign 1 file');
        await expect(end.locator('.msp-review')).toHaveText('Go through by hand (1)');
        // The footer at the end: closing closes the proposal, Close is the one action.
        await expect(proposal(page).locator('.msp-write')).toHaveText('Closing the window closes the proposal. Accepted ones stay written; the app’s Undo still works.');
        await expect(proposal(page).locator('.msp-accept-all')).toBeHidden();
        await expect(proposal(page).locator('.msp-accept-sel')).toBeHidden();
        await expect(proposal(page).locator('.msp-close-proposal')).toBeHidden();
        await expect(proposal(page).locator('.msp-close')).toHaveClass(/is-primary/);

        // Sort the next: the window and the proposal close, the dialog takes the other batch's files.
        await go.click();
        await expect(proposal(page)).toHaveCount(0);
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 2 files');
        await page.keyboard.press('Escape');
        await expect(strip(page)).toHaveAttribute('data-state', 'E');
        await expect(strip(page).locator('.mw-sort-what')).toHaveText('Done: 2 handled · 1 unassigned · 2 unsorted left');
        await expect(strip(page).locator('[data-sort="next"]')).toContainText('Sort the next (2)…');
        expect(await menuMarks(page)).toBe(0);
        // × closes E while it stays; nothing was sent meanwhile.
        await strip(page).locator('[data-sort="close"]').click();
        await expect(strip(page)).toBeHidden();
        expect(material.sorts).toHaveLength(1);
    });

    test('only unassigned files left: Go through by hand is the action; the window closed, the proposal closes by itself and E keeps them (no Sort the next)', async ({ page }) => {
        const material = await setup(page, {
            proposals: [PROPOSALS[0], { id: 'I0002', links: [{ type: 'person', ref: 'P0002' }], why: 'A well', sure: 'low' }],
        });
        await sortAndOpen(page);
        await proposal(page).locator('.msp-accept-all').click();
        await expect.poll(() => JSON.stringify(material.assigns ?? [])).toContain('P0002');
        const end = proposal(page).locator('.msp-end');
        await expect(end.locator('.msp-end-nothing')).toHaveText('Nothing else in the archive is left to sort.');
        await expect(end.locator('.msp-sort-next')).toHaveCount(0);
        await expect(end.locator('.msp-review')).toHaveClass(/is-primary/);

        // Closed with nothing waiting and nothing at work: the proposal closes by itself.
        await proposal(page).locator('.msp-close').click();
        await expect(proposal(page)).toHaveCount(0);
        await expect(strip(page)).toHaveAttribute('data-state', 'E');
        await expect(strip(page).locator('.mw-sort-what')).toHaveText('Done: 2 handled · 1 unassigned');
        await expect(strip(page).locator('[data-sort="next"], [data-sort="open"]')).toHaveCount(0);
        await expect(strip(page).locator('[data-sort="review"]')).toBeVisible();
        expect(await menuMarks(page)).toBe(0);
        // The proposal does not come back with the window.
        await page.evaluate(() => (window.Strom.UI as unknown as { closeMaterials(): void }).closeMaterials());
        await openWindow(page);
        await expect(strip(page)).toHaveAttribute('data-state', 'E');
        expect(material.sorts).toHaveLength(1);
    });

    test('nothing left: the end says so, the window closed, the strip says All files have a title and a person, then goes', async ({ page }) => {
        const material = await setup(page, {
            proposals: [
                PROPOSALS[0],
                { id: 'I0002', links: [{ type: 'person', ref: 'P0002' }], why: 'A well', sure: 'low' },
                { id: 'I0003', title: 'Letter from Ostrovid', links: [{ type: 'person', ref: 'P0003' }], why: 'A signature', sure: 'high' },
            ],
        });
        await sortAndOpen(page);
        await proposal(page).locator('.msp-accept-all').click();
        await expect.poll(() => JSON.stringify(material.assigns ?? [])).toContain('P0003');
        const end = proposal(page).locator('.msp-end');
        await expect(end.locator('.msp-end-title')).toHaveText('Done · 3 accepted · 0 rejected · 0 unassigned');
        await expect(end).toContainText('All files have a title and a person.');
        await expect(end.locator('.msp-sort-next, .msp-review')).toHaveCount(0);
        await proposal(page).locator('.msp-close').click();
        await expect(strip(page)).toHaveAttribute('data-state', 'F');
        await expect(strip(page)).toHaveAttribute('role', 'status');
        await expect(strip(page).locator('.mw-sort-text')).toHaveText('All files have a title and a person.');
        await expect(strip(page).locator('button')).toHaveCount(0);
        // A moment later the strip goes.
        await expect(strip(page)).toBeHidden({ timeout: 10_000 });
        expect(await menuMarks(page)).toBe(0);
    });

    test.describe('on a phone (390 px)', () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test('the proposal waiting is said as a state only: no Go through, no Close the proposal', async ({ page }) => {
            await setup(page);
            await page.setViewportSize(DESKTOP);
            await openWindow(page);
            await strip(page).locator('[data-sort="sort"]').click();
            await sortDialog(page).locator('.mdlg-sort-go').click();
            await expect(strip(page)).toHaveAttribute('data-state', 'D');
            await page.evaluate(() => (window.Strom.UI as unknown as { closeMaterials(): void }).closeMaterials());
            await page.setViewportSize({ width: 390, height: 844 });
            await openWindow(page);
            await expect(strip(page)).toHaveAttribute('data-state', 'D');
            await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent’s proposal: 2 to go through');
            await expect(strip(page).locator('.mw-sort-phone')).toBeVisible();
            await expect(strip(page).locator('button')).toHaveCount(0);
            const over = await strip(page).evaluate(el => el.scrollWidth > el.clientWidth + 1);
            expect(over).toBe(false);
        });
    });
});

/**
 * Not about the family (spec 110, point 4): a file the agent says has nothing to
 * do with the family is marked under Unassigned with its reason; Hide as Not about
 * the family (all of them, or one row) asks first in Hide… with that reason
 * chosen, only hides (Undo and Restore bring it back). Nothing hides by itself;
 * a research that does not say it leaves Unassigned as it was.
 */
test.describe('Sort with the agent: not about the family', () => {
    test.use({ viewport: DESKTOP });

    const UNRELATED = [
        { id: 'I0001', unrelated: true, why: 'A shop receipt from 2019', sure: 'high' },
        { id: 'I0002', title: 'Agent’s other title', links: [], why: 'A well', sure: 'low' },
        { id: 'I0003', unrelated: true, why: 'A screenshot of a phone', sure: 'medium' },
    ];
    const hideDialog = (page: Page) => page.locator('.mdlg-overlay .mdlg:not(#material-sort-proposal)');
    const unassignedTab = (page: Page) => proposal(page).locator('.msp-tab[data-tab="unassigned"]');
    const row = (page: Page, id: string) => proposal(page).locator(`.msp-row[data-id="${id}"]`);

    async function openProposal(page: Page): Promise<void> {
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(strip(page).locator('[data-sort="open"]')).toBeVisible();
        await strip(page).locator('[data-sort="open"]').click();
        await expect(proposal(page)).toBeVisible();
        await unassignedTab(page).click();
    }

    test('marked under Unassigned with the reason; Hide as Not about the family asks, hides with the reason, Undo and Restore bring them back', async ({ page }) => {
        const material = await setup(page, { proposals: UNRELATED, files: [materialFile(4, { batch: BATCH.id })] });
        await openProposal(page);
        await expect(unassignedTab(page)).toContainText('3');
        // The marked ones first, each with its reason; the file without the flag stays as before.
        await expect(proposal(page).locator('.msp-row')).toHaveCount(3);
        await expect(proposal(page).locator('.msp-row').first()).toHaveAttribute('data-id', 'I0001');
        await expect(row(page, 'I0001').locator('.msp-flag.is-unrelated')).toHaveText('Not about the family');
        await expect(row(page, 'I0001').locator('.msp-why')).toHaveText('Why not: A shop receipt from 2019');
        await expect(row(page, 'I0003').locator('.msp-flag')).toHaveText('Not about the family');
        await expect(row(page, 'I0004').locator('.msp-flag')).toHaveCount(0);
        await expect(row(page, 'I0004').locator('.msp-hide')).toHaveCount(0);
        // Nothing is hidden by itself.
        expect(material.hides).toHaveLength(0);

        // One row: its own Hide…, Cancel hides nothing and the proposal comes back on Unassigned.
        await row(page, 'I0003').locator('.msp-hide').click();
        await expect(hideDialog(page).locator('.mdlg-title')).toHaveText('Hide the file?');
        await hideDialog(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(proposal(page)).toBeVisible();
        await expect(unassignedTab(page)).toHaveAttribute('aria-selected', 'true');
        expect(material.hides).toHaveLength(0);

        // Over the group: one confirmation with Not about the family chosen.
        const all = proposal(page).locator('.msp-hide-unrelated');
        await expect(all).toHaveText('Hide as Not about the family (2)');
        await all.click();
        await expect(proposal(page)).toHaveCount(0);
        await expect(hideDialog(page).locator('.mdlg-title')).toHaveText('Hide 2 files?');
        await expect(hideDialog(page).locator('input[value="unrelated"]')).toBeChecked();
        await hideDialog(page).getByRole('button', { name: 'Hide', exact: true }).click();
        await expect.poll(() => material.hides.length).toBe(1);
        expect({ ...material.hides[0], files: [...(material.hides[0].files as string[])].sort() })
            .toEqual({ files: ['I0001', 'I0003'], hidden: true, reason: 'unrelated' });
        // Back on Unassigned: hidden, nothing deleted, Restore beside each.
        await expect(proposal(page)).toBeVisible();
        await expect(unassignedTab(page)).toHaveAttribute('aria-selected', 'true');
        await expect(row(page, 'I0001').locator('.msp-state.is-hidden')).toHaveText('Hidden · not about the family');
        await expect(row(page, 'I0003').locator('.msp-state.is-hidden')).toHaveText('Hidden · not about the family');
        await expect(all).toHaveCount(0);
        await expect(proposal(page).locator('.msp-review')).toHaveText('Go through by hand (1)');

        // The toast's Undo shows them again; the rows say so.
        await page.locator('.toast[data-kind="materials"] .toast-action').click();
        await expect.poll(() => material.hides.length).toBe(2);
        expect(material.hides[1].hidden).toBe(false);
        await expect(row(page, 'I0001').locator('.msp-hide')).toBeVisible();
        await expect(all).toHaveText('Hide as Not about the family (2)');

        // One row hidden, then Restore on its row.
        await row(page, 'I0001').locator('.msp-hide').click();
        await expect(hideDialog(page).locator('input[value="unrelated"]')).toBeChecked();
        await hideDialog(page).getByRole('button', { name: 'Hide', exact: true }).click();
        await expect.poll(() => material.hides.length).toBe(3);
        expect(material.hides[2]).toEqual({ files: ['I0001'], hidden: true, reason: 'unrelated' });
        await expect(all).toHaveText('Hide as Not about the family (1)');
        await row(page, 'I0001').locator('.msp-restore').click();
        await expect.poll(() => material.hides.length).toBe(4);
        expect(material.hides[3]).toEqual({ files: ['I0001'], hidden: false });
        await expect(row(page, 'I0001').locator('.msp-hide')).toBeVisible();
        expect(material.files.every(f => !f.hidden)).toBe(true);
    });

    test('why a file has no proposal: one quiet line, what the reader said cut to one line with the whole in its tooltip; an unknown reason says nothing', async ({ page }) => {
        const said = 'Only a blank page with a coffee stain in its corner and a fold across the middle: no names, no dates, no place, '
            + 'no stamp and no handwriting anywhere on it, front or back, nothing to tell whose it was, when it was kept or why it lay in the box';
        const material = await setup(page, {
            proposals: [PROPOSALS[0]],
            files: [materialFile(4, { batch: BATCH.id }), materialFile(5, { batch: BATCH.id })],
        });
        material.sortUnproposed = [
            { id: 'I0002', why: 'nothing-said', said },
            { id: 'I0003', why: 'reader-failed', outcome: 'timeout' },
            { id: 'I0004', why: 'something-new-one-day' },
        ];
        await openProposal(page);
        await expect(unassignedTab(page)).toContainText('4');
        await expect(row(page, 'I0002').locator('.msp-unproposed')).toHaveText('The reader said nothing about the file');
        const saidLine = row(page, 'I0002').locator('.msp-said');
        await expect(saidLine).toHaveText(said);
        await expect(saidLine).toHaveAttribute('title', said);
        // One line, cut with an ellipsis, inside its row.
        const fit = await saidLine.evaluate(el => {
            const r = el.getBoundingClientRect();
            const row = el.closest('.msp-row')!.getBoundingClientRect();
            return { cut: el.scrollWidth > el.clientWidth, oneLine: r.height < 24, inside: r.right <= row.right + 0.5 };
        });
        expect(fit).toEqual({ cut: true, oneLine: true, inside: true });
        await expect(row(page, 'I0003').locator('.msp-unproposed')).toHaveText('The file could not be read');
        await expect(row(page, 'I0003').locator('.msp-said')).toHaveCount(0);
        // A reason this app does not know, and a file the research says nothing of: no line, nothing broken.
        await expect(row(page, 'I0004').locator('.msp-unproposed, .msp-said')).toHaveCount(0);
        await expect(row(page, 'I0005').locator('.msp-unproposed, .msp-said')).toHaveCount(0);
        // The proposals' tab carries no reason line.
        await proposal(page).locator('.msp-tab[data-tab="proposals"]').click();
        await expect(proposal(page).locator('.msp-unproposed')).toHaveCount(0);
    });

    test('a research that does not say it: Unassigned as before, nothing offered to hide', async ({ page }) => {
        await setup(page);
        await openProposal(page);
        await expect(proposal(page).locator('.msp-row')).toHaveCount(1);
        await expect(proposal(page).locator('.msp-unproposed, .msp-said')).toHaveCount(0);
        await expect(proposal(page).locator('.msp-flag')).toHaveCount(0);
        await expect(proposal(page).locator('.msp-hide, .msp-hide-unrelated, .msp-restore')).toHaveCount(0);
        await expect(proposal(page).locator('.msp-review')).toHaveText('Go through by hand (1)');
    });
});
