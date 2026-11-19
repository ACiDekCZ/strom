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
        // While selecting, A gives way to the selection bar's own Sort (spec 102 §1); out of it, the strip is back.
        if (await win(page).evaluate(el => el.classList.contains('is-selecting'))) {
            await expect(strip(page)).toBeHidden();
            await win(page).locator('[data-mw="select"]').click();
            await expect(win(page)).not.toHaveClass(/is-selecting/);
        }
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

test.describe('What the next sorting sends and the proposal\'s own chips (spec 102 §4, §10)', () => {
    test.use({ viewport: DESKTOP });

    test('a file the agent left unassigned is tagged and has a filter of its own; it and a copy of another file are not sent again', async ({ page }) => {
        const material = await setup(page, {
            features: [...SORT_FEATURES, 'material.left'],
            files: [
                materialFile(4, { batch: BATCH.id, left: { at: '2026-11-18T10:00:00Z', why: 'nothing-said', said: 'A blank page' } }),
                // The same content as I0001, come later: a copy.
                materialFile(5, { batch: BATCH.id, sha: materialSha('I0001') }),
            ],
        });
        await openWindow(page);
        const tile = (name: string) => win(page).locator('.mw-tile', { hasText: name });
        await expect(tile('scan-4.jpg').locator('.mw-tile-persons .mw-intree-tag')).toHaveText('Not assigned by the agent');
        await expect(tile('scan-5.jpg').locator('.mw-tile-persons .mw-intree-tag')).toHaveText('Same content');
        await expect(tile('scan-1.jpg').locator('.mw-intree-tag')).toHaveCount(0);
        // The filter: only with such a file, after a separator.
        const left = win(page).locator('.mw-toggle[data-mw="left"]');
        await expect(left).toHaveText('Not assigned by the agent · 1');
        await left.click();
        await expect(left).toHaveAttribute('aria-pressed', 'true');
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(1);
        await expect(win(page).locator('.mw-canvas .mw-tile').first()).toContainText('scan-4.jpg');
        await left.click();
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(5);
        // The list's row carries the tag too.
        await win(page).locator('[data-mw="view-list"]').click();
        await expect(win(page).locator('.mw-li', { hasText: 'scan-4.jpg' }).locator('.mw-li-persons .mw-intree-tag')).toHaveText('Not assigned by the agent');
        // Sorting over everything leaves both out.
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sorts?.length).toBe(1);
        expect([...(material.sorts![0].ids as string[])].sort()).toEqual(['I0001', 'I0002', 'I0003']);
    });

    test('without the research\'s gate its word on a file left unassigned is not read', async ({ page }) => {
        await setup(page, { files: [materialFile(4, { batch: BATCH.id, left: { at: '2026-11-18T10:00:00Z', why: 'nothing-said' } })] });
        await openWindow(page);
        await expect(win(page).locator('.mw-tile', { hasText: 'scan-4.jpg' })).toBeVisible();
        await expect(win(page).locator('.mw-intree-tag', { hasText: 'Not assigned by the agent' })).toHaveCount(0);
        await expect(win(page).locator('.mw-toggle[data-mw="left"]')).toHaveCount(0);
    });

    test('the back side and the portrait are chips of the proposal; × takes one off; the back is written with its front, titled "(back)"', async ({ page }) => {
        const material = await setup(page, {
            proposals: [
                { id: 'I0001', title: 'Wedding 1924', kind: 'photo', why: 'A veil and a bouquet; a dedication on the back', sure: 'high',
                    links: [{ type: 'person', ref: 'P0001' }, { type: 'back', ref: 'I0003' }, { type: 'portrait', ref: 'P0001' }] },
                PROPOSALS[1],
            ],
        });
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        await strip(page).locator('[data-sort="open"]').click();
        const row = proposal(page).locator('.msp-row[data-id="I0001"]');
        await expect(row.locator('.msp-file')).toHaveText('scan-1.jpg + scan-3.jpg (back)');
        await expect(row.locator('.msp-meta')).toContainText('2 sides');
        const back = row.locator('.msp-chip[data-chip="back"]');
        await expect(back.locator('.msp-chip-thumb')).toHaveCount(1);
        await expect(back.locator('.msp-chip-label')).toHaveText('Back:');
        await expect(back).toContainText('scan-3.jpg');
        const portrait = row.locator('.msp-chip.is-person[data-chip="portrait"]');
        await expect(portrait.locator('.msp-chip-label')).toHaveText('Portrait:');
        await expect(portrait).toContainText('Josef Fíšek');
        // The back has no row of its own: nothing unassigned.
        await expect(proposal(page).locator('.msp-row[data-id="I0003"]')).toHaveCount(0);
        await expect(proposal(page).locator('.msp-tab[data-tab="unassigned"]')).not.toContainText('1');
        await portrait.getByRole('button', { name: 'Remove Portrait' }).click();
        await expect(row.locator('.msp-chip[data-chip="portrait"]')).toHaveCount(0);
        await expect(back).toBeVisible();
        await row.locator('.msp-accept').click();
        await expect.poll(() => JSON.stringify(material.edits ?? [])).toContain('Wedding 1924 (back)');
        await expect.poll(() => JSON.stringify(material.assigns ?? [])).toContain('I0003');
        // No portrait editor: its chip was taken off.
        await expect(page.locator('.pe-overlay')).toHaveCount(0);
    });
});

/**
 * The dialog's scope and batches (spec 102 §2): what to sort as tiles of the
 * Line, each with its count; what is sent in how many batches and what it
 * costs; what is not sent (copies, text and data files, sources' files, what
 * the agent left unassigned) in one sentence with its details and actions;
 * text and data files only when asked. Behind material.sortRun a run of
 * batches; without it one batch of 50, as before. Invented data.
 */
test.describe('Sort with the agent: the dialog\'s scope and batches (spec 102 §2)', () => {
    test.use({ viewport: DESKTOP });
    const RUN = [...SORT_FEATURES, 'material.sortRun', 'material.left', 'material.sourceOf'];
    const OTHER = { id: 'b-87654321', name: 'Dopisy Quellmayer', at: '2026-11-12T09:00:00Z' };
    /** n photos without a title or a person in the batch OTHER, from I0100. */
    const photos = (n: number) => Array.from({ length: n }, (_, i) => materialFile(100 + i, { batch: OTHER.id, path: `Talvanen/${String(i).padStart(4, '0')}.jpg` }));
    /** A copy, a text file, a source's file, one the agent left: none of them goes by itself. */
    const odd = (): FakeMaterialFile[] => [
        materialFile(4, { batch: BATCH.id, left: { at: '2026-11-18T10:00:00Z', why: 'nothing-said' } }),
        materialFile(5, { batch: BATCH.id, sha: materialSha('I0001'), name: 'scan-1 (1).jpg' }),
        materialFile(6, { batch: BATCH.id, name: 'notes-Talvanen.md', mime: 'text/markdown' }),
        materialFile(7, { batch: BATCH.id, uses: { excerpts: 0, sources: [], tasks: 0, of: [{ source: 'S0001', via: 'input', title: 'Parish register of Talvany' }] } }),
    ];
    const scope = (page: Page, s: string) => sortDialog(page).locator(`.mdlg-scope[data-scope="${s}"]`);

    test('the scope as the Line, the plan in batches, what is not sent with its details; text files only when asked; a run sends once', async ({ page }) => {
        const material = await setup(page, { features: RUN, batches: [OTHER], files: [...odd(), ...photos(55)] });
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        const d = sortDialog(page);
        await expect(d.locator('.mdlg-scopes legend')).toHaveText('What to sort');
        await expect(d.locator('.mdlg-scope')).toHaveCount(1);
        const all = scope(page, 'all');
        await expect(all).toHaveClass(/sel-opt/);
        await expect(all).toHaveAttribute('data-sel-form', 'tile');
        await expect(all.locator('input[type="radio"]')).toBeChecked();
        await expect(all.locator('.mdlg-scope-name')).toHaveText('All unsorted');
        // Every file without a title or a person: the 58 sent and the 4 not.
        await expect(all.locator('.mdlg-scope-n')).toHaveText('62');
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 58 files');
        await expect(d.locator('.mdlg-sort-plan')).toHaveText('58 files are sent in 2 batches of at most 50. The batches run one after another; each finished batch’s proposal can be gone through at once.');
        await expect(d.locator('.mdlg-sort-cost')).toHaveText('Each batch uses the subscription or credit: 2 batches.');
        await expect(d.locator('.mdlg-sort-big')).toBeHidden();
        const go = d.locator('.mdlg-sort-go');
        await expect(go).toContainText('Sort with the agent · 2 batches');
        await expect(go.locator('.research-ai-badge')).toHaveCount(1);
        await expect(go.locator('.research-open-mark')).toHaveCount(0);

        // What is not sent: one sentence, its details on demand.
        const left = d.locator('.mdlg-left');
        await expect(left.locator('.mdlg-left-sum')).toHaveText('4 not sent: 1 copy · 1 text and data · 1 file of a source · 1 left unassigned');
        const toggle = left.locator('.mdlg-left-toggle');
        await expect(toggle).toHaveText('Details');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(left.locator('.mdlg-left-list')).toBeHidden();
        await toggle.click();
        await expect(left.locator('.mdlg-left-toggle')).toHaveText('Hide details');
        await expect(left.locator('.mdlg-left-toggle')).toHaveAttribute('aria-expanded', 'true');
        await expect(left.locator('.mdlg-left-toggle')).toBeFocused();
        const list = left.locator('.mdlg-left-list');
        await expect(list).toContainText('1 copy with the same content (only one is sent)');
        await expect(list).toContainText('scan-1 (1).jpg');
        await expect(list).toContainText('1 text and data file (.md, .txt, .json, .csv)');
        await expect(list).toContainText('notes-Talvanen.md');
        await expect(list).toContainText('1 is the file of a source');
        await expect(list).toContainText('1 left unassigned by the agent last time');
        await expect(list.locator('.mdlg-left-hide')).toHaveText('Hide as Duplicate (1)…');
        await expect(list.locator('.mdlg-left-show')).toHaveText('Show in Materials');

        // Text and data files: only when asked, last.
        const withText = left.locator('.mdlg-sort-withtext');
        await expect(withText).toContainText('Send text and data files too (1)');
        await expect(withText).toContainText('They go last, after photos and scans.');
        await withText.locator('input').check();
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 59 files');
        await expect(left.locator('.mdlg-left-sum')).toHaveText('3 not sent');
        await expect(withText.locator('input')).toBeFocused();
        await withText.locator('input').uncheck();
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 58 files');

        // Hide as Duplicate: the hide dialog with Duplicate chosen; cancelled, the sorting's dialog comes back.
        await list.locator('.mdlg-left-hide').click();
        const hide = page.locator('.mdlg', { hasText: 'Reason' });
        await expect(hide.locator('input[value="duplicate"]')).toBeChecked();
        await hide.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 58 files');
        // Show in Materials: the filter of the files the agent left.
        await d.locator('.mdlg-left-toggle').click();
        await d.locator('.mdlg-left-show').click();
        await expect(d).toHaveCount(0);
        await expect(win(page).locator('.mw-toggle[data-mw="left"]')).toHaveAttribute('aria-pressed', 'true');
        await win(page).locator('.mw-toggle[data-mw="left"]').click();

        // Sent: one POST of the whole run, nothing that was not to go.
        await strip(page).locator('[data-sort="sort"]').click();
        await d.locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sorts?.length).toBe(1);
        const ids = material.sorts![0].ids as string[];
        expect(ids).toHaveLength(58);
        expect(ids).not.toEqual(expect.arrayContaining(['I0004']));
        for (const no of ['I0004', 'I0005', 'I0006', 'I0007']) expect(ids).not.toContain(no);
        expect(material.sortRuns?.size).toBe(1);
    });

    test('a selection first, everything beside it; copies and sources\' files selected are said and sent; a batch\'s scope from its menu', async ({ page }) => {
        await setup(page, { features: RUN, batches: [OTHER], files: [...odd(), ...photos(3)] });
        await openWindow(page);
        await win(page).locator('.mw-canvas .mw-tile').first().focus();
        await page.keyboard.press('ControlOrMeta+a');
        await win(page).locator('.mw-selbar [data-mw="sel-sort"]').click();
        const d = sortDialog(page);
        await expect(d.locator('.mdlg-scope')).toHaveCount(2);
        await expect(d.locator('.mdlg-scope').first()).toHaveAttribute('data-scope', 'selection');
        await expect(scope(page, 'selection').locator('.mdlg-scope-name')).toHaveText('Selected only');
        await expect(scope(page, 'selection').locator('input')).toBeChecked();
        await expect(scope(page, 'selection').locator('.mdlg-scope-n')).toHaveText('10');
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 10 files');
        await expect(d.locator('.mdlg-sort-plan')).toHaveText('10 files are sent in 1 batch.');
        // The copy and the source's file go too, and the dialog says so.
        await expect(d.locator('.mdlg-sort-warn')).toHaveText('2 selected files have the same content as others or are the file of a source. They are sent too.');
        await expect(d.locator('.mdlg-left')).toBeHidden();
        await expect(d.locator('.mdlg-sort-go')).toContainText('Sort with the agent');
        await expect(d.locator('.mdlg-sort-go')).not.toContainText('·');
        // Arrows move between the scopes as in a radio group.
        await scope(page, 'selection').locator('input').focus();
        await page.keyboard.press('ArrowDown');
        await expect(scope(page, 'all').locator('input')).toBeChecked();
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 6 files');
        await expect(d.locator('.mdlg-sort-warn')).toBeHidden();
        await expect(d.locator('.mdlg-left')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        // A batch's ⋯: its scope first, its name in it.
        await win(page).locator('.mw-canvas .mw-group', { hasText: OTHER.name }).locator('[data-mw="batch-menu"]').click();
        await page.locator('.mw-pop-batchMenu [data-action="sort"]').click();
        await expect(d.locator('.mdlg-scope').first()).toHaveAttribute('data-scope', 'batch');
        await expect(scope(page, 'batch').locator('.mdlg-scope-name')).toHaveText('Batch “Dopisy Quellmayer” only');
        await expect(scope(page, 'batch').locator('.mdlg-scope-n')).toHaveText('3');
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 3 files');
    });

    test('many batches: the cost said loudly and First 50 only to try; over 1,500 the rest is for the next sorting', async ({ page }) => {
        const material = await setup(page, { features: RUN, batches: [OTHER], files: photos(1530) });
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        const d = sortDialog(page);
        await expect(d.locator('.mdlg-scope')).toHaveCount(2);
        await expect(scope(page, 'all').locator('.mdlg-scope-sub')).toHaveText('30 batches of 50');
        await expect(scope(page, 'first').locator('.mdlg-scope-name')).toContainText('First 50 only');
        await expect(scope(page, 'first').locator('.mdlg-scope-sub')).toHaveText('1 batch; the rest later with “Sort the next”');
        await expect(scope(page, 'first').locator('.mdlg-scope-n')).toHaveText('50');
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 1,500 files');
        await expect(d.locator('.mdlg-sort-big')).toHaveText('30 batches: each uses the subscription or credit. If the limit runs out, the run stops and finished proposals stay. “First 50 only” is enough to try.');
        await expect(d.locator('.mdlg-sort-big')).toHaveClass(/is-warn/);
        await expect(d.locator('.mdlg-sort-over')).toHaveText('The first 30 batches (1,500 files) are sent; the rest later with “Sort the next”.');
        await expect(d.locator('.mdlg-sort-cost')).toHaveText('');
        await expect(d.locator('.mdlg-sort-go')).toContainText('Sort with the agent · 30 batches');
        await scope(page, 'first').click();
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 50 files');
        await expect(d.locator('.mdlg-sort-big')).toBeHidden();
        await expect(d.locator('.mdlg-sort-over')).toBeHidden();
        await expect(d.locator('.mdlg-sort-cost')).toHaveText('Uses the subscription or credit.');
        await d.locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sorts?.length).toBe(1);
        expect(material.sorts![0].ids as string[]).toHaveLength(50);
        expect(material.sortRuns?.size ?? 0).toBe(0);
    });

    test('without the research\'s run: one batch of 50 as before, the rest for the next sorting', async ({ page }) => {
        const material = await setup(page, { batches: [OTHER], files: photos(55) });
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        const d = sortDialog(page);
        await expect(scope(page, 'all').locator('.mdlg-scope-n')).toHaveText('58');
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 50 files');
        await expect(d.locator('.mdlg-sort-plan')).toHaveText('50 files are sent in 1 batch.');
        await expect(d.locator('.mdlg-sort-over')).toHaveText('The agent takes at most 50 files at once. A newer version of the research sorts in batches.');
        await expect(scope(page, 'first')).toHaveCount(0);
        await expect(d.locator('.mdlg-sort-go')).toContainText('Sort with the agent');
        await expect(d.locator('.mdlg-sort-go')).not.toContainText('·');
        await d.locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sorts?.length).toBe(1);
        expect(material.sorts![0].ids as string[]).toHaveLength(50);
    });

    test.describe('on a phone (390 px)', () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test('the dialog from below in German: the scope tiles 44 px, nothing wider than the screen', async ({ page }) => {
            await setup(page, { features: RUN, batches: [OTHER], files: [...odd(), ...photos(55)] });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await openWindow(page);
            await page.evaluate(() => (window.Strom.UI as unknown as { openSortDialog(t: unknown): void }).openSortDialog({ items: [], batch: null, whole: true }));
            const d = sortDialog(page);
            await expect(d.locator('.mdlg-title')).toHaveText('Mit dem Agenten sortieren · 58 Dateien');
            await expect(scope(page, 'all').locator('.mdlg-scope-name')).toHaveText('Alle nicht eingeordneten');
            await expect(d.locator('.mdlg-left-sum')).toHaveText('4 werden nicht gesendet: 1 Kopie · 1 Text und Daten · 1 Datei einer Quelle · 1 nicht zugeordnet');
            await d.locator('.mdlg-left-toggle').click();
            await expect(d.locator('.mdlg-left-hide')).toHaveText('Als Duplikat ausblenden (1)…');
            const box = await d.boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(390);
            const wide = await d.evaluate(el => [...el.querySelectorAll('*')].filter(x => (x as HTMLElement).scrollWidth > (x as HTMLElement).clientWidth + 1 && getComputedStyle(x).overflowX !== 'visible').length);
            expect(wide).toBe(0);
            expect((await scope(page, 'all').boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await expect(d.locator('.mdlg-sort-go')).toContainText('Mit dem Agenten sortieren · 2 Stapel');
        });
    });
});

test.describe('Sort with the agent: a proposal after a reload (spec 102 §3)', () => {
    test.use({ viewport: DESKTOP });

    test('a row accepted before a reload counts under Done, not under Unassigned (the file has the title and the person now)', async ({ page }) => {
        const material = await setup(page);
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await strip(page).locator('[data-sort="open"]').click();
        await proposal(page).locator('.msp-row[data-id="I0001"] .msp-accept').click();
        await expect.poll(() => JSON.stringify(material.edits ?? [])).toContain('Wedding 1924');
        await expect.poll(() => JSON.stringify(material.assigns ?? [])).toContain('P0001');
        await expect(proposal(page).locator('.msp-tab[data-tab="done"]')).toHaveText('Done · 1');

        await page.reload();
        await expect(page.locator('.person-card').first()).toBeVisible();
        await poll(page);
        await openWindow(page);
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        await strip(page).locator('[data-sort="open"]').click();
        const p = proposal(page);
        await expect(p.locator('.msp-tab[data-tab="done"]')).toHaveText('Done · 1');
        await expect(p.locator('.msp-tab[data-tab="unassigned"]')).toHaveText('Unassigned · 1');
        await expect(p.locator('.msp-tab[data-tab="proposals"]')).toHaveText('Proposals · 1');
        await p.locator('.msp-tab[data-tab="done"]').click();
        await expect(p.locator('.msp-row[data-id="I0001"] .msp-state')).toHaveText('Accepted');
        await p.locator('.msp-tab[data-tab="unassigned"]').click();
        await expect(p.locator('.msp-row[data-id="I0001"]')).toHaveCount(0);
    });
});

test.describe('Sort with the agent: a run of batches as it goes (spec 102 §3)', () => {
    test.use({ viewport: DESKTOP });
    const RUN = [...SORT_FEATURES, 'material.sortRun', 'material.left', 'material.sourceOf'];
    const OTHER = { id: 'b-87654321', name: 'Dopisy Quellmayer', at: '2026-11-12T09:00:00Z' };
    /** 117 photos without a title or a person: with the 3 files of BATCH (none has a person) 120 files, 3 batches (50, 50, 20). */
    const photos = () => Array.from({ length: 117 }, (_, i) => materialFile(100 + i, { batch: OTHER.id, path: `Talvanen/${String(i).padStart(4, '0')}.jpg` }));
    const bar = (page: Page) => strip(page).locator('.mw-sort-bar.is-run');
    const runPart = (m: FakeMaterial, k: number) => {
        const run = [...m.sortRuns!.values()][0];
        return m.sortJobs!.get(run.parts[k])!;
    };
    /** Lets the run take one step (each GET of the run is one) and holds it there. */
    const step = async (m: FakeMaterial, k: number, state: string) => {
        m.sortRunHold = false;
        await expect.poll(() => runPart(m, k).state, { timeout: 10_000 }).toBe(state);
        m.sortRunHold = true;
    };
    /** Proposals for the first files of each batch: 2 in batch 1, 3 in batch 2, 1 in batch 3. */
    const propose = (m: FakeMaterial) => {
        m.sortProposals = [2, 3, 1].flatMap((n, k) => runPart(m, k).files.slice(0, n).map((id, i) => ({
            id, title: `Talvanen letter ${k + 1}.${i + 1}`, links: [{ type: 'person', ref: 'P0001' }], why: 'The same hand', sure: 'high',
        })));
    };
    const start = async (page: Page) => {
        const material = await setup(page, { features: RUN, batches: [OTHER], files: photos() });
        material.sortRunHold = true;
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 120 files');
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sortRuns?.size).toBe(1);
        propose(material);
        return material;
    };

    test('one bar with a tick between batches; finished batches\' proposals join at the end, said below; the end of the window for the whole run', async ({ page }) => {
        const material = await start(page);
        expect(material.sorts).toHaveLength(1);
        expect(material.sorts![0].ids as string[]).toHaveLength(120);

        // Batch 1 of 3 starting: one bar for the run (120 files), ticks where a batch ends.
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent is sorting · batch 1 of 3 is starting');
        await expect(bar(page)).toHaveAttribute('aria-valuemax', '120');
        await expect(bar(page)).toHaveAttribute('aria-valuenow', '0');
        await expect(bar(page).locator('i')).toHaveCount(2);
        expect(await bar(page).locator('i').evaluateAll(els => els.map(e => (e as HTMLElement).style.left))).toEqual(['41.7%', '83.3%']);

        await step(material, 0, 'working');
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent is sorting · batch 1 of 3 · 12 of 50');
        await expect(bar(page)).toHaveAttribute('aria-valuenow', '12');
        await expect(strip(page).locator('[data-sort="open"]')).toHaveCount(0);

        // Batch 1 done: its proposals wait (C) while batch 2 starts.
        await step(material, 0, 'done');
        await expect(strip(page)).toHaveAttribute('data-state', 'C');
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent is sorting · batch 2 of 3 is starting');
        await expect(bar(page)).toHaveAttribute('aria-valuenow', '50');
        await strip(page).locator('[data-sort="open"]').click();
        const p = proposal(page);
        await expect(p.locator('.msp-list .msp-row')).toHaveCount(2);
        await expect(p.locator('.msp-tab[data-tab="proposals"]')).toContainText('2');
        await expect(p.locator('.msp-run .mw-sort-run')).toHaveText('Batch 2 of 3 is running · more proposals will come');
        await expect(p.locator('.msp-run .mw-sort-bar.is-run')).toHaveAttribute('aria-valuenow', '50');
        await expect(p.locator('.msp-more')).toBeHidden();

        // Batch 2 done while the proposals are gone through: they join at the end, the focus stays, a line says so.
        const first = p.locator('.msp-list .msp-row').first();
        const firstId = await first.getAttribute('data-id');
        await first.focus();
        await step(material, 1, 'working');
        await expect(p.locator('.msp-run .mw-sort-note')).toHaveText('12 of 50');
        await step(material, 1, 'done');
        await expect(p.locator('.msp-list .msp-row')).toHaveCount(5);
        await expect(p.locator('.msp-tab[data-tab="proposals"]')).toContainText('5');
        await expect(p.locator('.msp-more')).toBeVisible();
        await expect(p.locator('.msp-more-text')).toHaveText('3 proposals from batch 2 arrived: they are at the end of the list.');
        await expect(p.locator(`.msp-list .msp-row[data-id="${firstId}"]`)).toBeFocused();
        await expect(p.locator('.msp-list .msp-row').nth(2).locator('.msp-title')).toHaveText('Talvanen letter 2.1');
        await expect(p.locator('.msp-run .mw-sort-run')).toHaveText('Batch 3 of 3 is running · more proposals will come');
        // Show goes to the first of them.
        await p.locator('.msp-more-show').click();
        await expect(p.locator('.msp-more')).toBeHidden();
        await expect(p.locator('.msp-list .msp-row').nth(2)).toBeFocused();

        // Everything finished handled while batch 3 runs: so far, and more will come.
        await p.locator('.msp-accept-all').click();
        await expect(p.locator('.msp-end-title')).toHaveText('Everything finished is handled · 5 accepted · 0 rejected');
        await expect(p.locator('.msp-end-sub')).toHaveText('So far 2 of 3 batches · 100 files');
        await expect(p.locator('.msp-end .msp-run .mw-sort-run')).toHaveText('More proposals will come: batch 3 of 3 is running');
        await expect(p.locator('.msp-run:not(.msp-end-run)')).toBeHidden();

        // Batch 3 done: its proposal shows (nothing was waiting, no line), then the end for the whole run.
        await step(material, 2, 'working');
        await step(material, 2, 'done');
        material.sortRunHold = false;
        await expect(p.locator('.msp-list .msp-row')).toHaveCount(1);
        await expect(p.locator('.msp-list .msp-row .msp-title')).toHaveText('Talvanen letter 3.1');
        await expect(p.locator('.msp-more')).toBeHidden();
        await expect(p.locator('.msp-run')).toBeHidden();
        await p.locator('.msp-accept-all').click();
        await expect(p.locator('.msp-end-sub')).toHaveText('For the whole run: 3 batches · 120 files');
        await expect(p.locator('.msp-end-title')).toContainText('6 accepted');
        expect(material.sorts).toHaveLength(1);
    });

    test('a reload in the middle of a run: the run is watched again where it was, its finished proposals kept, nothing sent again', async ({ page }) => {
        const material = await start(page);
        await step(material, 0, 'working');
        await step(material, 0, 'done');
        await expect(strip(page)).toHaveAttribute('data-state', 'C');
        await strip(page).locator('[data-sort="open"]').click();
        await proposal(page).locator('.msp-list .msp-row').first().locator('.msp-accept').click();
        await expect.poll(() => (material.edits ?? []).length).toBeGreaterThan(0);

        await page.reload();
        await expect(page.locator('.person-card').first()).toBeVisible();
        await poll(page);
        await openWindow(page);
        await expect(strip(page)).toHaveAttribute('data-state', 'C');
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent is sorting · batch 2 of 3 is starting');
        await expect(bar(page)).toHaveAttribute('aria-valuenow', '50');
        await strip(page).locator('[data-sort="open"]').click();
        const p = proposal(page);
        await expect(p.locator('.msp-list .msp-row')).toHaveCount(1);
        // The accepted one is not offered again; it counts under Done, not under Unassigned (its file has the title and the person now).
        await expect(p.locator('.msp-tab[data-tab="proposals"]')).toHaveText('Proposals · 1');
        await expect(p.locator('.msp-tab[data-tab="done"]')).toHaveText('Done · 1');
        await expect(p.locator('.msp-tab[data-tab="unassigned"]')).toHaveText('Unassigned · 48');
        await expect(p.locator('.msp-run .mw-sort-run')).toHaveText('Batch 2 of 3 is running · more proposals will come');

        material.sortRunHold = false;
        await expect(p.locator('.msp-list .msp-row')).toHaveCount(5, { timeout: 15_000 });
        await expect(p.locator('.msp-run')).toBeHidden({ timeout: 15_000 });
        await p.locator('.msp-accept-all').click();
        await expect(p.locator('.msp-end-sub')).toHaveText('For the whole run: 3 batches · 120 files');
        expect(material.sorts).toHaveLength(1);
        expect(material.sortRuns?.size).toBe(1);
    });
    test('Cancel in the middle of a run: the batches not run stay unsorted, the finished proposals stay to go through', async ({ page }) => {
        const material = await start(page);
        await step(material, 0, 'working');
        await step(material, 0, 'done');
        await step(material, 1, 'working');
        await expect(strip(page)).toHaveAttribute('data-state', 'C');
        await strip(page).locator('[data-sort="cancel"]').click();
        const ask = page.locator('.mdlg', { hasText: 'Discard the finished proposals?' });
        await expect(ask.locator('.mdlg-text')).toHaveText('Sorting stops: batches 2 to 3 of 3 will not run and their 70 files stay unsorted. The finished proposals (2) can stay to go through.');
        await expect(ask.locator('.mdlg-foot button', { hasText: 'Keep them' })).toBeFocused();
        await ask.locator('.mdlg-foot button', { hasText: 'Keep them' }).click();
        expect(material.runCancels).toHaveLength(1);
        expect(runPart(material, 1).state).toBe('cancelled');
        expect(runPart(material, 2).state).toBe('cancelled');
        material.sortRunHold = false;
        // Cancelled here: no stop said, the proposal waits (D) with its 2 rows.
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('The agent’s proposal: 2 to go through');
        await strip(page).locator('[data-sort="open"]').click();
        const p = proposal(page);
        await expect(p.locator('.msp-list .msp-row')).toHaveCount(2);
        await expect(p.locator('.msp-run')).toBeHidden();
        await p.locator('.msp-accept-all').click();
        await expect(p.locator('.msp-end-sub')).toHaveText('For the whole run: 1 batch · 50 files');
        expect(material.sorts).toHaveLength(1);
    });

    test('a batch that did not run: the strip says it with what is left, Try again… sorts only that and the proposal goes on', async ({ page }) => {
        const material = await start(page);
        material.sortRunFail = 2;
        material.sortRunHold = false;
        // The research goes on after the failed batch: said once the run ended.
        await expect(strip(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
        await expect(strip(page)).toHaveAttribute('role', 'alert');
        await expect(strip(page)).toHaveClass(/is-error/);
        expect(runPart(material, 2).state).toBe('done');
        await expect(strip(page).locator('.mw-sort-err')).toHaveText('Batch 2 of 3 did not run:');
        await expect(strip(page).locator('.mw-sort-text')).toContainText('The research’s limit for reading by the agent is used up for now.');
        await expect(strip(page).locator('.mw-sort-note')).toHaveText('50 files stay unsorted · finished proposals (3) are waiting');
        await expect(strip(page).locator('[data-sort="open"]')).toHaveText('Go through the proposal (3)');
        await expect(strip(page).locator('[data-sort="open"]')).toHaveClass(/secondary/);
        await expect(strip(page).locator('[data-sort="retry"] .research-ai-badge')).toHaveCount(1);
        await expect(strip(page).locator('[data-sort="close-run"]')).toHaveText('Close');
        // A reload says it again, as remembered.
        await page.reload();
        await expect(page.locator('.person-card').first()).toBeVisible();
        await poll(page);
        await openWindow(page);
        await expect(strip(page)).toHaveAttribute('data-state', 'error');
        expect(material.sorts).toHaveLength(1);

        await strip(page).locator('[data-sort="retry"]').click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 50 files');
        await expect(sortDialog(page).locator('.mdlg-scope')).toHaveCount(1);
        await expect(sortDialog(page).locator('.mdlg-scope-name')).toHaveText('What is left of the run');
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sorts?.length).toBe(2);
        expect(material.sorts![1].ids).toEqual(runPart(material, 1).files);
        // The new batch's proposals join the ones still waiting.
        await expect(strip(page)).toHaveAttribute('data-state', 'D', { timeout: 15_000 });
        await strip(page).locator('[data-sort="open"]').click();
        const p = proposal(page);
        await expect(p.locator('.msp-tab[data-tab="proposals"]')).toHaveText('Proposals · 6');
        await p.locator('.msp-accept-all').click();
        await expect(p.locator('.msp-end-sub')).toHaveText('For the whole run: 3 batches · 120 files');
    });

    test('a run stopped elsewhere: the strip says after which batch, Continue (N batches)… opens the dialog over the rest', async ({ page }) => {
        const material = await start(page);
        material.sortRunStopAt = 2;
        material.sortRunHold = false;
        await expect(strip(page)).toHaveAttribute('data-state', 'stopped', { timeout: 15_000 });
        await expect(strip(page)).toHaveClass(/is-done/);
        await expect(strip(page).locator('.mw-sort-text b')).toHaveText('Sorting stopped after batch 1 of 3.');
        await expect(strip(page).locator('.mw-sort-note')).toHaveText('70 files stay unsorted');
        await expect(strip(page).locator('[data-sort="resume"]')).toContainText('Continue (2 batches)…');
        await expect(strip(page).locator('[data-sort="resume"] .research-ai-badge')).toHaveCount(1);
        // Nothing starts by itself.
        expect(material.sorts).toHaveLength(1);
        material.sortRunStopAt = undefined;

        await strip(page).locator('[data-sort="resume"]').click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 70 files');
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sortRuns?.size).toBe(2);
        expect(material.sorts![1].ids).toEqual([...runPart(material, 1).files, ...runPart(material, 2).files]);
        await expect(strip(page)).toHaveAttribute('data-state', 'D', { timeout: 15_000 });
        await strip(page).locator('[data-sort="open"]').click();
        const p = proposal(page);
        await expect(p.locator('.msp-tab[data-tab="proposals"]')).toHaveText('Proposals · 6');
        await p.locator('.msp-accept-all').click();
        await expect(p.locator('.msp-end-sub')).toHaveText('For the whole run: 3 batches · 120 files');
    });

    test('Close on a stopped run with proposals waiting: the proposal stays to go through', async ({ page }) => {
        const material = await start(page);
        material.sortRunStopAt = 2;
        material.sortRunHold = false;
        await expect(strip(page)).toHaveAttribute('data-state', 'stopped', { timeout: 15_000 });
        await strip(page).locator('[data-sort="close-run"]').click();
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        await expect(strip(page).locator('[data-sort="open"]')).toBeFocused();
        expect(material.sorts).toHaveLength(1);
    });

    test('the next batch waits: the strip and the proposal say why and when it starts by itself', async ({ page }) => {
        const material = await start(page);
        await step(material, 0, 'working');
        await step(material, 0, 'done');
        material.sortRunWaiting = { why: 'read.app', retry: 300 };
        material.sortRunHold = false;
        await expect(strip(page).locator('.mw-sort-run')).toHaveText('Batch 2 of 3 is waiting');
        const why = 'The readings the app may ask for are used up for this hour or day. It starts by itself in about 5 min.';
        await expect(strip(page).locator('.mw-sort-note').first()).toHaveText(why);
        await strip(page).locator('[data-sort="open"]').click();
        const p = proposal(page);
        await expect(p.locator('.msp-run .mw-sort-run')).toHaveText('Batch 2 of 3 is waiting');
        await expect(p.locator('.msp-run .msp-run-wait')).toHaveText(why);
        // The readings come back: it goes on by itself (held there to read it).
        material.sortRunHold = true;
        material.sortRunWaiting = undefined;
        await expect(p.locator('.msp-run .mw-sort-run')).toHaveText('Batch 2 of 3 is running · more proposals will come', { timeout: 15_000 });
        await expect(p.locator('.msp-run .msp-run-wait')).toHaveCount(0);
    });

    test('the line of proposals that arrived goes once they are handled; the run\'s end says itself in the open window, no toast over it', async ({ page }) => {
        const material = await start(page);
        await step(material, 0, 'working');
        await step(material, 0, 'done');
        await strip(page).locator('[data-sort="open"]').click();
        const p = proposal(page);
        await expect(p.locator('.msp-list .msp-row')).toHaveCount(2);
        await step(material, 1, 'working');
        await step(material, 1, 'done');
        await expect(p.locator('.msp-more')).toBeVisible();
        // All of them accepted without Show: the line points at nothing any more.
        await p.locator('.msp-accept-all').click();
        await expect(p.locator('.msp-end-title')).toBeVisible();
        await expect(p.locator('.msp-more')).toBeHidden();
        material.sortRunHold = false;
        await expect(p.locator('.msp-list .msp-row')).toHaveCount(1, { timeout: 15_000 });
        await p.locator('.msp-accept-all').click();
        await expect(p.locator('.msp-end-sub')).toHaveText('For the whole run: 3 batches · 120 files');
        await expect(p.locator('.msp-more')).toBeHidden();
        await expect(page.locator('.toast[data-kind="materials"]', { hasText: 'The agent’s proposal is ready' })).toHaveCount(0);
    });

    test.describe('on a phone held sideways (844 × 390)', () => {
        test.use({ viewport: { width: 844, height: 390 } });

        test('the strip of a run on one line in German: what does not fit ends with an ellipsis, nothing cut off (spec 102 §11)', async ({ page }) => {
            const material = await setup(page, { features: RUN, batches: [OTHER], files: photos() });
            material.sortRunHold = true;
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await openWindow(page);
            await expect(strip(page)).toHaveAttribute('data-state', 'A');
            await expect(strip(page).locator('.mw-sort-phone-short')).toBeVisible();
            await expect(strip(page).locator('.mw-sort-phone')).toBeHidden();
            await expect(strip(page).locator('button')).toHaveCount(0);
            await page.evaluate(() => (window.Strom.UI as unknown as { openSortDialog(t: unknown): void }).openSortDialog({ items: [], batch: null, whole: true }));
            await sortDialog(page).locator('.mdlg-sort-go').click();
            await expect.poll(() => material.sortRuns?.size).toBe(1);
            propose(material);
            await step(material, 0, 'working');
            await step(material, 0, 'done');
            await expect(strip(page)).toHaveAttribute('data-state', 'C');
            const fit = await strip(page).evaluate((el) => {
                const text = el.querySelector<HTMLElement>('.mw-sort-text')!;
                const cut = [...text.children].filter(c => (c as HTMLElement).scrollWidth > (c as HTMLElement).clientWidth + 1 && getComputedStyle(c).textOverflow !== 'ellipsis').length;
                return { height: el.getBoundingClientRect().height, over: text.scrollWidth - text.clientWidth, cut };
            });
            expect(fit.height).toBeLessThanOrEqual(48);
            expect(fit.over).toBeLessThanOrEqual(1);
            expect(fit.cut).toBe(0);
        });
    });
});
