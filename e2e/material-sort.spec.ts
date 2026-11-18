import { readFileSync } from 'node:fs';
import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, materialSha, MATERIAL_FEATURES, openResearch, openResearchMenu, poll, researchGed, HEAD, UUID, BRIDGE,
    FakeBridge, FakeMaterial, FakeMaterialFile,
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
/** The strip under the batch's header (13b); the one over the list stands for a review filter. */
const strip = (page: Page) => win(page).locator('.mw-sort--row');
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

        await expect(strip(page)).toContainText('The agent’s proposal is ready');
        // The research menu's Materials row carries the waiting dot (13e).
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-materials .research-item-attn')).toHaveCount(1);
        await expect(page.locator('#research-item-materials')).toHaveAttribute('aria-label', /The agent’s proposal is ready/);
        await page.keyboard.press('Escape');
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
        await expect(win(page).locator('.mw-sort:visible')).toHaveCount(0);
        await page.keyboard.press('ControlOrMeta+a');
        await expect(win(page).locator('.mw-selbar')).toBeVisible();
        await expect(win(page).locator('[data-mw="sel-sort"], [data-action="sel-sort"]')).toHaveCount(0);
        expect(material.sorts ?? []).toHaveLength(0);
    });

    test('a strip under each batch with files to sort; the sorting stands in its batch and the others wait', async ({ page }) => {
        const other = { id: 'b-87654321', name: 'Dopisy z Talvan', at: '2026-11-12T09:00:00Z' };
        const material = await setup(page, { batches: [other], files: [materialFile(7, { batch: other.id }), materialFile(8, { batch: other.id })] });
        material.sortDoneAt = 99;
        await openWindow(page);
        // The whole view has one strip over both batches; a filter that narrows the window shows the batches' own.
        await expect(win(page).locator('.mw-sort--top')).toContainText('5 files without title or person');
        await expect(strip(page)).toHaveCount(0);
        // A narrowing filter opens every batch it finds files in: each batch has its strip.
        await win(page).locator('[data-mw="nosource"]').click();
        await expect(strip(page)).toHaveCount(2);
        await expect(win(page).locator('.mw-sort--top')).toBeHidden();
        await strip(page).filter({ hasText: '3 new files' }).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        // While it works, only its batch says so; the other batch offers nothing.
        await expect(strip(page)).toHaveCount(1);
        await expect(strip(page)).toContainText('of 3');
        expect(material.sorts).toHaveLength(1);
        // Back in the whole view the sorting at work has priority: still in its batch, no strip over everything.
        await win(page).locator('[data-mw="nosource"]').click();
        await expect(win(page).locator('.mw-sort--top')).toBeHidden();
        // Only the newest batch is open there; a closed batch shows no strip until it is opened.
        await expect(strip(page)).toHaveCount(0);
        await win(page).locator('.mw-group-toggle', { hasText: BATCH.name }).click();
        await expect(strip(page)).toHaveCount(1);
        await expect(strip(page)).toContainText('of 3');
        await expect(win(page).locator('.mw-sort--top')).toBeHidden();
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-materials .research-item-dot')).toHaveCount(1);
        await page.keyboard.press('Escape');
    });

    test('a batch sends only its files without a title or a person; a selection sends every file selected', async ({ page }) => {
        // I0004 in the batch has its title and a person: the strip and its dialog leave it out.
        const material = await setup(page, { files: [materialFile(4, { batch: BATCH.id, title: 'Letter from Talvany', persons: ['P0001'] })] });
        await openWindow(page);
        await expect(strip(page)).toContainText('3 new files · 2 without title · 3 without person');
        await strip(page).locator('[data-sort="sort"]').click();
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
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(strip(page)).toContainText('The agent is sorting · 1 of 3');
        await strip(page).locator('[data-sort="cancel"]').click();
        const ask = page.locator('.mdlg', { hasText: 'Discard the finished proposals?' });
        await expect(ask).toBeVisible();
        await expect(ask.getByRole('button', { name: 'Keep them' })).toBeFocused();
        await ask.getByRole('button', { name: 'Keep them' }).click();
        await expect(strip(page)).toContainText('The agent’s proposal is ready');
        expect(material.cancels).toHaveLength(1);

        // A new sorting from the selection, cancelled and its proposals discarded: the batch offers sorting again.
        await page.keyboard.press('ControlOrMeta+a');
        await win(page).locator('.mw-selbar [data-mw="sel-sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        expect(material.sorts).toHaveLength(2);
        await page.keyboard.press('Escape');
        // A selection's sorting has no batch: it stands over the list and the batch offers nothing meanwhile.
        const top = win(page).locator('.mw-sort--top');
        await expect(top).toContainText('1 of 3');
        await expect(strip(page)).toHaveCount(0);
        await top.locator('[data-sort="cancel"]').click();
        await page.locator('.mdlg', { hasText: 'Discard the finished proposals?' }).getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(strip(page)).toContainText('3 new files');
        await expect(strip(page).locator('[data-sort="sort"]')).toBeVisible();
        expect(material.cancels).toHaveLength(2);
    });

    test('Sort with the agent says Sending… on its button and the strip\'s Cancel Cancelling… until the research answers', async ({ page }) => {
        const material = await setup(page);
        material.sortDoneAt = 99;
        material.sortWorkingProposals = 1;
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

test.describe('Sort with the agent over everything (the whole view)', () => {
    test.use({ viewport: DESKTOP });
    const top = (page: Page) => win(page).locator('.mw-sort--top');
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

    test('one strip counts only the files without a title or a person; its dialog says the count and the cost; × closes it for the window; nothing is sent by itself', async ({ page }) => {
        const material = await setup(page, spread());
        await openWindow(page);
        await expect(top(page)).toHaveClass(/mw-sort--whole/);
        await expect(top(page).locator('.mw-sort-text')).toHaveText('5 files without title or person');
        await expect(strip(page)).toHaveCount(0);
        const btn = top(page).locator('[data-sort="sort"]');
        await expect(btn.locator('.research-ai-badge')).toHaveCount(1);
        await expect(btn.locator('.research-open-mark')).toHaveCount(0);

        // The dialog: the count of the files that need it and what it costs; Esc sends nothing.
        await btn.click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 5 files');
        await expect(sortDialog(page)).toContainText('Uses the subscription or credit.');
        await page.keyboard.press('Escape');
        await expect(sortDialog(page)).toHaveCount(0);

        // Selecting has its own Sort with the agent: the strip steps aside meanwhile.
        await win(page).locator('[data-mw="select"]').click();
        await expect(top(page)).toBeHidden();
        await win(page).locator('[data-mw="select"]').click();
        await expect(top(page)).toBeVisible();

        // × closes it while the window is open; the batches' strips do not take its place.
        await top(page).locator('[data-sort="close-whole"]').click();
        await expect(top(page)).toBeHidden();
        await expect(strip(page)).toHaveCount(0);
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
        // The sorting's own strip stands there now.
        await expect(top(page)).not.toHaveClass(/mw-sort--whole/);
        await expect(top(page)).toContainText('The agent’s proposal is ready');
    });

    test('one batch\'s strip already offers every file that needs it: no strip over everything; a review filter keeps its own strip', async ({ page }) => {
        const older = { ...other, at: '2026-11-01T09:00:00Z' };
        await setup(page, { batches: [older], files: [materialFile(7, { batch: older.id, title: 'Letter from Talvany', persons: ['P0001'] })] });
        await openWindow(page);
        await expect(strip(page)).toContainText('3 new files');
        await expect(top(page)).toBeHidden();
        await win(page).locator('[data-mw="notitle"]').click();
        await expect(top(page)).toContainText('2 files in the filter');
        await expect(top(page)).not.toHaveClass(/mw-sort--whole/);
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

        test('the strip keeps its button (the toolbar\'s Sort ▾ hidden there is another one)', async ({ page }) => {
            await setup(page, spread());
            await openWindow(page);
            await expect(win(page).locator('[data-mw="sort-menu"]')).toBeHidden();
            await expect(top(page).locator('[data-sort="sort"]')).toBeVisible();
            await expect(top(page).locator('[data-sort="close-whole"]')).toBeVisible();
        });
    });

    test.describe('on a phone (390 px)', () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test('the German text stays whole (wrapped, never cut short) beside ×, the button below it', async ({ page }) => {
            await setup(page, spread());
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await openWindow(page);
            const text = top(page).locator('.mw-sort-text');
            await expect(text).toHaveText('5 Dateien ohne Titel oder Person');
            const fit = await text.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
            expect(fit.sw).toBeLessThanOrEqual(fit.cw);
            expect(fit.sh).toBeLessThanOrEqual(fit.ch);
            const strip = await top(page).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
            expect(strip.sw).toBeLessThanOrEqual(strip.cw);
            const t = (await text.boundingBox())!;
            const btn = (await top(page).locator('[data-sort="sort"]').boundingBox())!;
            const close = (await top(page).locator('[data-sort="close-whole"]').boundingBox())!;
            expect(btn.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
            expect(close.x).toBeGreaterThanOrEqual(t.x + t.width - 1);
            expect(close.y).toBeLessThan(t.y + t.height);
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

    test('a research that does not say it: Unassigned as before, nothing offered to hide', async ({ page }) => {
        await setup(page);
        await openProposal(page);
        await expect(proposal(page).locator('.msp-row')).toHaveCount(1);
        await expect(proposal(page).locator('.msp-flag')).toHaveCount(0);
        await expect(proposal(page).locator('.msp-hide, .msp-hide-unrelated, .msp-restore')).toHaveCount(0);
        await expect(proposal(page).locator('.msp-review')).toHaveText('Go through by hand (1)');
    });
});
