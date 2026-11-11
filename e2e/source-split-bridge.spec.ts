import { test, expect, Page } from '@playwright/test';
import { fakeBridge, fakeSourcesSplit, openResearch, poll, researchGed, type FakeBridge, type FakeSourcesSplit } from './research-bridge.js';

/**
 * "Split as suggested…" in a research tree (spec 075 §5): through the
 * research's bridge while it says `sources.split` — the preview read from
 * `GET /sources/split` (`?all=1` for Show all), Split with its progress, the
 * toast and the research's version taken quietly, its Undo; another plan
 * meanwhile (409 `source.split.plan`: the new preview), a busy research (503
 * `research.busy`: Try again), an undo refused because sources changed since
 * (409 `source.split.changed`: nothing undone); without the feature only the
 * quiet sentence. Nothing is split in the app. Invented data only.
 */

const N = 12;
const PLAN = '0123456789abcdef';

/** The research's sources: N older locations the split recognises, two it does not. `split`: as after the split. */
function ged(split = false, head?: string): string {
    const lines: string[] = [];
    for (let i = 1; i <= N; i++) {
        lines.push(`0 @S${100 + i}@ SOUR`, `1 TITL Matrika N ${i} Vzorov`, `1 REFN S${100 + i}`);
        if (split) lines.push(`1 PAGE fol. ${10 + i}v, image ${30 + i}, č. ${i}`, `1 _STROM_FOLIO fol. ${10 + i}v`, `1 _STROM_IMAGE ${30 + i}`, `1 _STROM_LOCATOR č. ${i}`);
        else lines.push(`1 PAGE fol. ${10 + i}v, č. ${i}, snímek ${30 + i}`);
    }
    lines.push('0 @S201@ SOUR', '1 TITL Kniha zápisů Pokusov', '1 PAGE Kniha N 7, zápis bez čísla', '1 REFN S201');
    lines.push('0 @S202@ SOUR', '1 TITL Kniha zápisů Zkušov', '1 PAGE svazek bez označení', '1 REFN S202');
    return researchGed(head, lines);
}

function rows(n = N): unknown[] {
    return Array.from({ length: n }, (_, k) => {
        const i = k + 1;
        return { source: `S${100 + i}`, title: `Matrika N ${i} Vzorov`, before: { locator: `fol. ${10 + i}v, č. ${i}, snímek ${30 + i}` },
            after: { locator: `č. ${i}`, folio: `fol. ${10 + i}v`, image: `${30 + i}` } };
    });
}

async function setup(page: Page, opts: { features?: string[]; split?: Partial<FakeSourcesSplit> } = {}): Promise<FakeBridge & { sourcesSplit: FakeSourcesSplit }> {
    await page.setViewportSize({ width: 1440, height: 900 });
    const bridge = await fakeBridge(page, {
        features: opts.features ?? ['sources.split', 'sources.fields'],
        treeGed: ged(),
        sourcesSplit: fakeSourcesSplit({ rows: rows(), unrecognized: 2, plan: PLAN, splitGed: ged(true), ...opts.split }),
    });
    await openResearch(page, { ged: ged() });
    await poll(page);
    return bridge as FakeBridge & { sourcesSplit: FakeSourcesSplit };
}

const dialog = (page: Page) => page.locator('#source-split-modal');
const line = (page: Page) => page.locator('#sources-split-bulk');
const toast = (page: Page) => page.locator('.toast[data-kind="source-split"]');
const openSources = (page: Page) => page.evaluate(() => window.Strom.UI.showSourcesDialog());
const byTitle = (page: Page, title: string) => page.evaluate((title) =>
    Object.values(window.Strom.DataManager.getData().sources ?? {}).find(s => s.title === title) as Record<string, unknown> | undefined, title);
const splitButton = (page: Page) => dialog(page).locator('[data-ssp="go"]');

test('the preview comes from the bridge; Split with its progress, the toast, the version taken quietly; its Undo', async ({ page }) => {
    const b = await setup(page, { split: { delayMs: 800 } });
    await openSources(page);
    await expect(line(page)).toContainText('The locations of 12 sources can be split into fields.');
    expect(b.sourcesSplit.gets).toEqual(['']);
    await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
    await expect(dialog(page).locator('.ssp-lead')).toContainText('The locations of 12 sources can be split');
    await expect(dialog(page).locator('.ssp-table tbody tr')).toHaveCount(6);
    await expect(dialog(page).locator('.ssp-table tbody tr').first().locator('td'))
        .toHaveText(['Matrika N 1 Vzorov', 'fol. 11v, č. 1, snímek 31', 'fol. 11v', '31', 'č. 1']);
    await expect(dialog(page).locator('.ssp-unrec')).toContainText('2 locations were not recognised and stay unchanged.');
    await expect(dialog(page).locator('.ssp-unrec-ex')).toHaveCount(0);
    // The dialog read nothing again: the Sources manager's reading.
    expect(b.sourcesSplit.gets).toEqual(['']);
    await dialog(page).getByRole('button', { name: 'Show all (12)' }).click();
    await expect(dialog(page).locator('.ssp-table tbody tr')).toHaveCount(12);
    expect(b.sourcesSplit.gets).toEqual(['', 'all']);
    // No mark on the actions (the research's code, no terminal, no agent).
    await expect(dialog(page).locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
    await splitButton(page).click();
    await expect(splitButton(page)).toHaveText('Splitting 12 locations…');
    await expect(splitButton(page)).toBeDisabled();
    await expect(dialog(page).locator('.ssp-progress')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expect(toast(page)).toContainText('12 locations split.');
    expect(b.sourcesSplit.posts).toEqual([{ plan: PLAN }]);
    // The research's version taken quietly: the fields in the app, nothing asked.
    await expect.poll(async () => (await byTitle(page, 'Matrika N 1 Vzorov'))?.folio).toBe('fol. 11v');
    const s1 = await byTitle(page, 'Matrika N 1 Vzorov');
    expect(s1?.image).toBe('31');
    expect(s1?.reference).toBe('č. 1');
    expect((await byTitle(page, 'Kniha zápisů Pokusov'))?.reference).toBe('Kniha N 7, zápis bez čísla');
    await expect(page.locator('#research-load-modal')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(b.head);
    await expect(line(page)).toContainText(/Locations split on .+ \(12 sources\)\./);
    // The toast's Undo: the research takes it back, its version comes quietly again.
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => b.sourcesSplit.undoPosts).toEqual([{ undo: '20261111101500-a1b2c0' }]);
    await expect.poll(async () => (await byTitle(page, 'Matrika N 1 Vzorov'))?.folio).toBeUndefined();
    expect((await byTitle(page, 'Matrika N 1 Vzorov'))?.reference).toBe('fol. 11v, č. 1, snímek 31');
    await expect(line(page)).toContainText('The locations of 12 sources can be split into fields.');
    await expect(page.locator('#research-load-modal')).toHaveCount(0);
});

test('the research\'s examples of locations not recognised are shown as in a tree of the app\'s own', async ({ page }) => {
    await setup(page, { split: { unrecognizedExamples: ['Kniha N 7, zápis bez čísla', 'svazek bez označení'] } });
    await openSources(page);
    await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
    await expect(dialog(page).locator('.ssp-unrec')).toContainText('2 locations were not recognised and stay unchanged.');
    await expect(dialog(page).locator('.ssp-unrec-ex')).toHaveText('E.g. “Kniha N 7, zápis bez čísla”, “svazek bez označení”.');
});

test('another plan meanwhile: the preview as it is now, said above the buttons, with its count', async ({ page }) => {
    const b = await setup(page, { split: { postReplies: [{ status: 409, body: {
        error: 'the split would now do otherwise', code: 'source.split.plan',
        preview: { split: rows(9), count: 9, unrecognized: 0, nothing: 0, undos: [], plan: 'fedcba9876543210' },
    } }] } });
    await openSources(page);
    await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
    await splitButton(page).click();
    await expect(dialog(page).locator('.ssp-error')).toContainText('The sources changed in the meantime. The preview shows them as they are now.');
    await expect(dialog(page).locator('.ssp-lead')).toContainText('The locations of 9 sources can be split');
    await expect(splitButton(page)).toHaveText('Split (9)');
    await expect(splitButton(page)).toBeEnabled();
    await expect(dialog(page).locator('.ssp-unrec')).toHaveCount(0);
    // Nothing changed in the app.
    expect((await byTitle(page, 'Matrika N 1 Vzorov'))?.folio).toBeUndefined();
    // The research's preview is that one now: Split (9) goes with its plan.
    b.sourcesSplit.rows = rows(9);
    b.sourcesSplit.plan = 'fedcba9876543210';
    await splitButton(page).click();
    await expect(toast(page)).toContainText('9 locations split.');
    expect(b.sourcesSplit.posts).toEqual([{ plan: PLAN }, { plan: 'fedcba9876543210' }]);
});

test('a busy research: said above the buttons, Split held, Try again splits', async ({ page }) => {
    const b = await setup(page, { split: { postReplies: [{ status: 503, body: { error: 'busy', code: 'research.busy' } }] } });
    await openSources(page);
    await line(page).getByRole('button', { name: 'Split as suggested…' }).click();
    await splitButton(page).click();
    await expect(dialog(page).locator('.ssp-error')).toContainText('The research is busy with another task. Splitting works again in a moment.');
    await expect(splitButton(page)).toBeDisabled();
    await dialog(page).getByRole('button', { name: 'Try again' }).click();
    await expect(toast(page)).toContainText('12 locations split.');
    expect(b.sourcesSplit.posts).toEqual([{ plan: PLAN }, { plan: PLAN }]);
    await expect.poll(async () => (await byTitle(page, 'Matrika N 2 Vzorov'))?.folio).toBe('fol. 12v');
});

test('an undo refused because sources changed since: the first three named, nothing undone', async ({ page }) => {
    const titles = [1, 2, 3, 4, 5].map(i => ({ id: `S${100 + i}`, title: `Matrika N ${i} Vzorov` }));
    const b = await setup(page, { split: {
        rows: [], undos: [{ id: '20261110090000-abcdef', at: '2026-11-10T09:00:00.000Z', sources: 6 }],
        undoReplies: [{ status: 409, body: { error: 'changed since', code: 'source.split.changed', count: 7, sources: titles } }],
    } });
    await openSources(page);
    await expect(line(page)).toContainText(/Locations split on .+ \(6 sources\)\./);
    await line(page).getByRole('button', { name: 'Undo…' }).click();
    await expect(dialog(page).locator('.ssp-undo-row')).toContainText('(6 sources)');
    await expect(dialog(page).locator('.ssp-nothing')).toHaveText('No other locations to split right now.');
    await dialog(page).locator('[data-ssp="undo"]').click();
    await expect(dialog(page).locator('.ssp-error')).toHaveText(
        'Cannot undo: 7 sources changed after the split (Matrika N 1 Vzorov; Matrika N 2 Vzorov; Matrika N 3 Vzorov). Nothing was undone.');
    expect(b.sourcesSplit.undoPosts).toEqual([{ undo: '20261110090000-abcdef' }]);
    await expect(dialog(page).locator('.ssp-undo-row')).toBeVisible();
    expect((await byTitle(page, 'Matrika N 1 Vzorov'))?.reference).toBe('fol. 11v, č. 1, snímek 31');
});

test('the Table\'s line over Sources reads the bridge\'s count', async ({ page }) => {
    await setup(page);
    await page.locator('#view-mode-table').click();
    await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
    await expect(page.locator('#table-container .table-bulk')).toContainText('The locations of 12 sources can be split into fields.');
    await page.locator('#table-container .table-bulk').getByRole('button', { name: 'Split as suggested…' }).click();
    await expect(dialog(page).locator('.ssp-lead')).toContainText('The locations of 12 sources can be split');
});

test('a research without sources.split: the quiet sentence, nothing asked of the bridge', async ({ page }) => {
    const b = await setup(page, { features: ['sources.fields'] });
    await openSources(page);
    await expect(line(page)).toHaveText('Splitting locations works while the research is running.');
    await expect(line(page).getByRole('button')).toHaveCount(0);
    expect(b.sourcesSplit.gets).toEqual([]);
    expect((b.seen ?? []).filter(r => r.includes('/sources/split'))).toEqual([]);
});
