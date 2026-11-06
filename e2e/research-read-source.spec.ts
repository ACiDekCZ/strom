import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakeRead, readAccepts, openResearch, poll, researchGed, FakeBridge, READ_ID } from './research-bridge.js';

/**
 * "Read again…" at a source (spec 059 §4): the research reads the source
 * again from its original (`POST sources/read`) and compares the new reading
 * with the transcript. Offered only with `read.source`, a research that reads
 * now and `_STROM_ORIG Y` at the source; one excerpt alone is sent by its
 * clip only for a source of one excerpt. The result says how it compares (a
 * difference is a task of the research, nothing is overwritten); noscan /
 * notext take the action away until the research's next file; a source read
 * already opens that reading's progress. A fake bridge; invented sources.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const CLIP = 'c0a1b2c3d4e';
const CLIP2 = 'c5f6a7b8c9d';
const RUNNING_ID = 'D20261106101500-c3d4';

const excerpt = (clip: string): string[] => ['1 OBJE', '2 FORM png', '2 _STROM_KIND excerpt', `2 _STROM_CLIP ${clip}`, `2 FILE ${PNG}`];

/** The research's file: S0001 with its original in the research (`orig`) and its excerpts. */
function ged(opts: { orig?: boolean; clips?: string[]; text?: string } = {}): string {
    const extra = [...(opts.orig === false ? [] : ['1 _STROM_ORIG Y']), ...(opts.clips ?? [CLIP]).flatMap(excerpt)];
    const file = researchGed().replace('1 _STROM_READ research', ['1 _STROM_READ research', ...extra].join('\n'));
    return opts.text ? file.replace('1 TEXT Josef Fíšek a Anna', `1 TEXT ${opts.text}`) : file;
}

async function setup(page: Page, opts: { orig?: boolean; clips?: string[]; features?: string[]; ready?: boolean; links?: string[]; text?: string } = {}): Promise<FakeBridge> {
    const file = ged(opts);
    const b = await fakeBridge(page, {
        treeGed: file,
        accepts: {
            sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true },
            read: readAccepts({ ready: opts.ready !== false }),
        },
        features: opts.features ?? ['read.now', 'read.source'],
        links: opts.links ?? ['send', 'open', 'live', 'app', 'setup', 'task'],
        read: fakeRead(),
    });
    await openResearch(page, { ged: file, media: true });
    await page.evaluate(() => localStorage.setItem('read.readers', '1'));
    await poll(page);
    return b;
}

async function view(page: Page): Promise<void> {
    await page.evaluate(() => {
        const ui = window.Strom.UI;
        if (document.getElementById('source-viewer-modal')?.classList.contains('active')) ui.closeSourceViewer();
        const id = (Object.values(window.Strom.DataManager.getData().sources).find((s: any) => s.refn === 'S0001') as any).id;
        ui.showSourceViewer(id, null);
    });
    await expect(page.locator('#source-viewer-modal')).toBeVisible();
}

const viewer = (page: Page) => page.locator('#source-viewer-modal');
const again = (page: Page) => page.locator('#source-viewer-read-again');
const excerptAgain = (page: Page) => page.locator('#source-viewer-modal [data-read-again-clip]');
const dialog = (page: Page) => page.locator('#read-document-modal');

async function openAgain(page: Page, from: Locator): Promise<Locator> {
    await from.click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d.locator('#read-title')).toHaveText('Read the source again');
    return d;
}

/** A finished reading of the source again: how it compares with the transcript. */
function result(source: Record<string, unknown>): Record<string, unknown> {
    return {
        id: READ_ID, state: 'done', lang: 'en',
        doc: { kind: 'register.marriage', language: ['cs'], script: 'latin', date: '1888', legible: 'yes', why: null },
        readers: { asked: 1, ran: 1, agree: 'same', who: [{ agent: 'claude', name: 'Claude Code', model: 'opus', modelName: 'Opus', effort: 'high', ran: true }] },
        pages: [{ n: 1, file: 'M0001', name: 'S0001', page: 1, w: 600, h: 800, image: `read/${READ_ID}/page/1.jpg` }],
        entries: [{ id: 'e1', page: 1, transcript: 'Josef Fíšek a Anně', variants: [], persons: [], events: [], relations: [] }],
        context: '', version: 1, source,
    };
}

/** "Read" in the source's input; the progress follows, then the result once the research is done. */
async function readAndFinish(page: Page, b: FakeBridge, d: Locator, source: Record<string, unknown>): Promise<void> {
    await d.locator('[data-act="read"]').click();
    await expect.poll(() => b.read!.sourcePosts?.length ?? 0).toBe(1);
    await expect(d.locator('#read-title')).toHaveText('Reading again');
    // The comparison with the transcript is a step even with one reader.
    await expect(d.locator('.read-step')).toHaveCount(3);
    await expect(d.locator('.read-step').last()).toContainText('Comparing with the source’s transcript');
    b.read!.reads[0].state = 'done';
    b.read!.results.set(READ_ID, result(source));
    await poll(page);
    await expect(d.locator('#read-title')).toHaveText('Source read again');
}

test.describe('Read a source again from its original', () => {
    test.use({ viewport: DESKTOP });

    test('offered with read.source, a research that reads now and _STROM_ORIG; the AI badge alone; not without each of them', async ({ page }) => {
        const b = await setup(page);
        await view(page);
        await expect(again(page)).toHaveText(/Read again…/);
        // An agent reads through the bridge, no terminal: the AI badge alone.
        await expect(again(page).locator('.research-ai-badge')).toHaveCount(1);
        await expect(again(page).locator('.research-open-mark')).toHaveCount(0);
        // One excerpt of the research: it can be read alone, beside "Full quality".
        await expect(excerptAgain(page)).toHaveCount(1);
        await expect(excerptAgain(page).locator('.research-ai-badge')).toHaveCount(1);
        // Opening the viewer sends nothing.
        expect(b.read!.sourcePosts ?? []).toEqual([]);

        // The research does not read sources again (an older one): no action.
        b.features = ['read.now'];
        await poll(page);
        await view(page);
        await expect(viewer(page).locator('.viewer-transcript')).toBeVisible();
        await expect(again(page)).toHaveCount(0);
        await expect(excerptAgain(page)).toHaveCount(0);

        // It does, but does not read now (its agent not ready): no action.
        b.features = ['read.now', 'read.source'];
        b.accepts = { ...(b.accepts as Record<string, unknown>), read: readAccepts({ ready: false, why: 'auth' }) };
        await poll(page);
        await view(page);
        await expect(viewer(page).locator('.viewer-transcript')).toBeVisible();
        await expect(again(page)).toHaveCount(0);

        // Ready again: the action is back.
        b.accepts = { ...(b.accepts as Record<string, unknown>), read: readAccepts() };
        await poll(page);
        await view(page);
        await expect(again(page)).toBeVisible();
    });

    test('a source without its original in the research (_STROM_ORIG): no action', async ({ page }) => {
        await setup(page, { orig: false });
        await view(page);
        await expect(viewer(page).locator('.viewer-transcript')).toBeVisible();
        await expect(again(page)).toHaveCount(0);
        await expect(excerptAgain(page)).toHaveCount(0);
    });

    test('the request: the excerpt alone by its clip, the whole entry without; a source of several excerpts only whole', async ({ page }) => {
        const b = await setup(page);
        await view(page);
        // The excerpt alone.
        let d = await openAgain(page, excerptAgain(page));
        await expect(d.locator('.audit-log-subtitle')).toHaveText('Oddací matrika Čapkov · excerpt 1');
        await expect(d.locator('.read-source-preview .read-source-what')).toHaveText('Excerpt 1 · Oddací matrika Čapkov');
        await expect(d.locator('.read-source-preview .read-source-gloss strong')).toHaveText('The original in the research is read');
        // No pages, no person, no note: the source is what is read.
        await expect(d.locator('#read-drop, #read-note, #read-person-picker')).toHaveCount(0);
        await expect(d.locator('#read-foot-note strong')).toHaveText('1 excerpt will be read · 1 reader');
        await expect(d.locator('[data-act="read"] .research-ai-badge')).toHaveCount(1);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.sourcePosts?.length ?? 0).toBe(1);
        expect(b.read!.sourcePosts![0]).toEqual({ source: 'S0001', clip: CLIP, readers: 1, lang: 'en' });
        // Nothing else asked of the bridge's readings.
        expect(b.read!.posts).toEqual([]);
        await d.locator('[data-act="close"]').last().click();
        await expect(d).toHaveCount(0);

        // The whole entry (the transcript's action): no clip.
        b.read!.reads = [];
        b.read!.nextId = 'D20261106110000-e5f6';
        await poll(page);
        await view(page);
        d = await openAgain(page, again(page));
        await expect(d.locator('.audit-log-subtitle')).toHaveText('Oddací matrika Čapkov');
        await expect(d.locator('#read-foot-note strong')).toHaveText('The whole entry will be read · 1 reader');
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.sourcePosts?.length ?? 0).toBe(2);
        expect(b.read!.sourcePosts![1]).toEqual({ source: 'S0001', readers: 1, lang: 'en' });
    });

    test('a source of several excerpts: no excerpt read alone, the whole entry without a clip', async ({ page }) => {
        const b = await setup(page, { clips: [CLIP, CLIP2] });
        await view(page);
        await expect(viewer(page).locator('.viewer-excerpt')).toHaveCount(2);
        await expect(excerptAgain(page)).toHaveCount(0);
        const d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.sourcePosts?.length ?? 0).toBe(1);
        expect('clip' in b.read!.sourcePosts![0]).toBe(false);
    });

    test('the same as the transcript: it says so, it supports the transcript, only Close', { tag: '@smoke' }, async ({ page }) => {
        const b = await setup(page);
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'same', variants: [] });
        await expect(d.locator('[data-pill="source"]')).toHaveText('Matches the transcript');
        await expect(d.locator('[data-pill="source"]')).toHaveClass(/is-ok/);
        await expect(d.locator('.read-result-who')).toContainText('New reading:');
        const note = d.locator('.read-source-note');
        await expect(note).toHaveAttribute('data-agree', 'same');
        await expect(note.locator('.read-source-note-text')).toHaveText('The source’s transcript stays unchanged and the new reading is saved beside it; the match supports today’s transcript.');
        await expect(note.locator('.read-source-vs')).toHaveCount(0);
        await expect(note.locator('.read-source-variants')).toHaveCount(0);
        // Nothing to propose to the tree, nothing to read anew here: Close alone, the main button.
        await expect(d.locator('.read-footer button')).toHaveText(['Close']);
        await expect(d.locator('.read-footer button.primary')).toHaveText('Close');
        // The source's transcript is untouched.
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().sources).find((s: any) => s.refn === 'S0001') as any).transcript))
            .toBe('Josef Fíšek a Anna');
        await d.locator('[data-act="close"]').last().click();
        // A match leaves no line in the viewer.
        await expect(viewer(page).locator('.viewer-read-again-after')).toHaveCount(0);
    });

    test('two parts of one page read (S1408): "Excerpt 1 / 2", each part framed with the entry on it; reader 2 says where it differed', async ({ page }) => {
        const b = await setup(page);
        await view(page);
        const d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.sourcePosts?.length ?? 0).toBe(1);
        const part = (n: number, region: number[]) => ({ n, file: 'M0001', sha: 'c'.repeat(64), name: 'S0001', page: 1, w: 600, h: 800, region, image: `read/${READ_ID}/page/${n}.jpg` });
        b.read!.reads[0].state = 'done';
        b.read!.results.set(READ_ID, {
            ...result({ id: 'S0001', agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], task: 'T0042' }),
            readers: { asked: 2, ran: 2, agree: 'differ', who: [
                { agent: 'claude', name: 'Claude Code', model: 'opus', modelName: 'Opus', effort: 'high', ran: true },
                { agent: 'codex', name: 'Codex', model: 'gpt-6-astra', modelName: 'GPT-6-Astra', effort: 'xhigh', ran: true },
            ] },
            pages: [part(1, [0.03, 0.72, 0.45, 0.15]), part(2, [0.05, 0.77, 0.32, 0.17])],
            entries: [{ id: 'e1', page: 1, region: [0.03, 0.72, 0.45, 0.2], transcript: 'Josef Fíšek a Anně\nAnno 1774', persons: [], events: [], relations: [],
                variants: [{ at: 'Fíšek', other: 'Fišek' }, { at: 'Anno 1774', other: '' }] }],
        });
        await poll(page);
        await expect(d.locator('#read-title')).toHaveText('Source read again');
        // Two parts of the same page: excerpts, not pages.
        await expect(d.locator('.read-page-tab')).toHaveText(['Excerpt 1', 'Excerpt 2']);
        await expect(d.locator('.read-scan-img')).toHaveAttribute('alt', 'Excerpt 1');
        const region = d.locator('.read-view-region');
        await expect(region).toHaveCount(1);
        await expect(region).toHaveAttribute('style', /left:3%/);
        await expect(d.locator('.read-frame')).toHaveCount(1);
        // The second part: its own part framed, and the entry read on the same page still there.
        await d.locator('.read-page-tab').nth(1).click();
        await expect(d.locator('.read-page-tab.is-selected')).toHaveText('Excerpt 2');
        await expect(region).toHaveAttribute('style', /left:5%/);
        await expect(d.locator('.read-frame')).toHaveCount(1);
        await expect(d.locator('.read-scan-var')).toHaveCount(2);
        // The new reading is reader 1's text; reader 2 (independent) differed in the places marked amber.
        await expect(d.locator('.read-source-sides')).toHaveText(/^left the transcript so far, right the new reading · Claude Code/);
        await expect(d.locator('.read-transcript .read-variant')).toHaveCount(2);
        await expect(d.locator('.read-source-readers .read-source-head')).toHaveText('Between the readers');
        await expect(d.locator('.read-source-second')).toHaveText('The readers differ in 2 places, marked in the transcript below.');
    });

    /**
     * A register entry as one line of cells (like S1383): the places the readers differ in, found in the line
     * however the research composed them (cells, `[?]`, `[...]`, "Joan.Martinus"), each one row of the legend
     * with its words around it; the data places apart, a duplicate of a text place dropped.
     */
    const CELLS = '1774 | 12 | Martinus Zvonařík [?] | Joan.Martinus Klabouch | Catharina [...] filia | Adalbertus Mlhovský | Zálesíčko';
    const OLD_TRANSCRIPT = '1774 | 12 | Martinus Zvonářík | Joan. Martinus Klabouch | Catharina Mlhovská | Zálesíčky';
    const CELL_VARIANTS = [
        { at: '12 Martinus', other: '12 Martin' },
        { at: 'Zvonařík[?]', other: 'Zvonářík' },
        { at: 'Joan. Martinus', other: 'Joannes Martinus' },
        { at: 'Catharina […]', other: 'Catharina Mlhovská' },
        { at: 'Mlhovský', other: 'Mlhovsky' },
        { at: 'Zálesíčko', other: 'Zálesíčky' },
        { at: '', other: 'sponsus' },
        { field: 'p1.surname', at: 'Zvonařík', other: 'Zvonářík' },
        { field: 'BIRT.date', at: '12 Martii 1774', other: '13 Martii 1774' },
    ];
    async function readCells(page: Page, variants: Record<string, string>[]): Promise<Locator> {
        const b = await setup(page, { text: OLD_TRANSCRIPT });
        await view(page);
        const d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.sourcePosts?.length ?? 0).toBe(1);
        b.read!.reads[0].state = 'done';
        b.read!.results.set(READ_ID, {
            ...result({ id: 'S0001', agree: 'differ', task: 'T1369', variants: [
                { at: 'Zvonářík', other: 'Zvonařík [?]' }, { at: 'Zálesíčky', other: 'Zálesíčko' }, { at: 'Klabouch', other: '' },
            ] }),
            readers: { asked: 2, ran: 2, agree: 'differ', who: [
                { agent: 'claude', name: 'Claude Code', model: 'opus', modelName: 'Opus', effort: 'high', ran: true },
                { agent: 'codex', name: 'Codex', model: 'gpt-6-astra', modelName: 'GPT-6-Astra', effort: 'xhigh', ran: true },
            ] },
            entries: [{ id: 'e1', page: 1, transcript: CELLS, variants, events: [], relations: [],
                persons: [{ ref: 'p1', role: 'child', given: 'Martinus', surname: 'Zvonařík', written: 'Martinus Zvonařík' }] }],
        });
        await poll(page);
        await expect(d.locator('#read-title')).toHaveText('Source read again');
        return d;
    }

    test('a register line of cells (S1383): every place marked in the text and one row of the legend; the data apart; both parts of the note', async ({ page }) => {
        const d = await readCells(page, CELL_VARIANTS);
        const legend = d.locator('.read-legend:not(.read-source-variants)');
        const rows = legend.locator('.read-legend-place');
        // 7 places in the text (6 in the line, 1 only at reader 2) and 1 in the data (the other one repeats a text place).
        await expect(d.locator('.read-transcript .read-variant')).toHaveCount(6);
        await expect(rows).toHaveCount(8);
        await expect(legend.locator('.read-legend-place--data')).toHaveCount(1);
        await expect(legend.locator('.read-legend-differ')).toHaveText('/The readers differ in 8 places: Claude Code · Opus, Codex · GPT-6-Astra');
        await expect(d.locator('.read-source-second')).toHaveText('The readers differ in 8 places, marked in the transcript below.');
        // The rows: the words around each place, its marks as in the text; nothing said with an ellipsis or empty quotes.
        await expect(rows.nth(0)).toHaveText(/^1774 \| 12 Martinus\/12 Martin Zvonařík/);
        await expect(rows.nth(0).locator('.read-place-ctx').last()).toHaveClass(/is-cut-after/);
        await expect(rows.nth(6)).toHaveText('missing/sponsus');
        const text = await legend.evaluate(el => el.textContent ?? '');
        expect(text).not.toContain('…');
        expect(text).not.toMatch(/“\s*”|""/);
        expect(text.split('Codex').length).toBe(2);
        const unsure = legend.locator('.read-legend-place mark.uncertain').first();
        await expect(unsure).toBeVisible();
        expect(await unsure.evaluate(el => getComputedStyle(el).borderBottomStyle)).toBe('dotted');
        await expect(legend.locator('.read-legend-place .read-variant .illegible')).toHaveCount(1);
        await expect(legend.locator('.read-legend-place .read-place-missing')).toHaveText(['missing']);
        await expect(legend.locator('.read-legend-sub')).toHaveText('Only in the data (the text matches):');
        await expect(legend.locator('.read-legend-place--data')).toHaveText('Birth · date: 12 Martii 1774/13 Martii 1774');
        await expect(legend.locator('.read-places-more')).toHaveCount(0);
        // The titles say an illegible spot and a missing side in words.
        const titles = await legend.locator('.read-legend-place .read-variant').evaluateAll(els => els.map(el => el.getAttribute('title') ?? ''));
        expect(titles.join('\n')).not.toMatch(/“\s*”|…/);
        expect(titles.join('\n')).toContain('“Catharina illegible”');
        expect(titles.join('\n')).toContain('“missing”');
        // The note: one sentence, the part against the transcript so far, the part between the readers.
        const note = d.locator('.read-source-note');
        await expect(note.locator('.read-source-note-text')).toHaveText('The source’s transcript stays unchanged and the new reading is saved beside it; task T1369 in the research decides where they differ.');
        await expect(d.locator('[data-pill="source"]')).toHaveText('3 places differ from the transcript');
        const vs = note.locator('.read-source-vs .read-legend-place');
        await expect(vs).toHaveCount(3);
        await expect(note.locator('.read-source-vs .read-source-head')).toHaveText('Compared with the transcript so far · 3 places');
        await expect(vs.nth(0)).toContainText('Martinus Zvonářík→Zvonařík');
        await expect(vs.nth(2).locator('.read-place-missing')).toHaveText('missing');
        await expect(note.locator('.read-source-readers')).toHaveCount(1);
        expect(await note.evaluate(el => el.textContent ?? '')).not.toContain('…');
    });

    test('more than 8 places: the first 8 and "and N more", unfolded in place', async ({ page }) => {
        const d = await readCells(page, [...CELL_VARIANTS,
            { at: '1774', other: '1775' }, { at: 'filia', other: 'filius' }, { at: 'Adalbertus', other: 'Vojtěch' }]);
        const legend = d.locator('.read-legend:not(.read-source-variants)');
        const rows = legend.locator('.read-legend-place');
        await expect(d.locator('.read-transcript .read-variant')).toHaveCount(9);
        await expect(rows).toHaveCount(11);
        await expect(legend.locator('.read-legend-place:visible')).toHaveCount(8);
        const more = legend.locator('.read-places-more');
        await expect(more).toHaveText('and 3 more');
        await more.click();
        await expect(legend.locator('.read-legend-place:visible')).toHaveCount(11);
        await expect(more).toHaveCount(0);
        await expect(legend.locator('.read-legend-sub')).toBeVisible();
    });

    test('reader 2 read as reader 1, or no reader 2: nothing said of it', async ({ page }) => {
        const b = await setup(page);
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], task: 'T0042' });
        await expect(d.locator('.read-source-note')).toBeVisible();
        await expect(d.locator('.read-source-second')).toHaveCount(0);
        await expect(d.locator('.read-page-tabs')).toHaveCount(0);
        await expect(d.locator('.read-view-region')).toHaveCount(0);
    });

    test('it differs: a task to check, not a conflict; its places with the marks; Open the task in the research', async ({ page }) => {
        const b = await setup(page);
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], task: 'T0042' });
        await expect(d.locator('[data-pill="source"]')).toHaveText('1 place differs from the transcript');
        await expect(d.locator('[data-pill="source"]')).toHaveClass(/is-warn/);
        const note = d.locator('.read-source-note');
        await expect(note).toHaveAttribute('data-agree', 'differ');
        await expect(note.locator('.read-source-note-text')).toHaveText('The source’s transcript stays unchanged and the new reading is saved beside it; task T0042 in the research decides where they differ.');
        // One part against the transcript so far: the count and the sides once, then the place with the words before it.
        await expect(note.locator('.read-source-vs .read-source-head')).toHaveText('Compared with the transcript so far · 1 place');
        await expect(note.locator('.read-source-sides')).toHaveText('left the transcript so far, right the new reading · Claude Code · Opus');
        const rows = note.locator('.read-source-vs .read-legend-place');
        await expect(rows).toHaveText(['Josef Fíšek a Anna→Anně']);
        const mks = rows.locator('.read-variant-mk');
        await expect(mks).toHaveCount(2);
        expect(await mks.first().getAttribute('data-mk')).toBe('transcript');
        expect(await mks.last().getAttribute('data-mk')).toBe('new');
        // One reader ran: nothing between the readers.
        await expect(note.locator('.read-source-readers')).toHaveCount(0);
        // The task opens in the research's terminal: its mark, not the AI badge.
        const open = d.locator('[data-act="open-task"]');
        await expect(open).toHaveText(/Open the task/);
        await expect(open).toHaveClass(/primary/);
        await expect(open.locator('.research-open-mark')).toHaveCount(1);
        await expect(open.locator('.research-ai-badge')).toHaveCount(0);
        await open.click();
        await expect.poll(() => page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links)).toEqual([expect.stringContaining('task=T0042')]);
        await d.locator('[data-act="close"]').last().click();
        await expect(d).toHaveCount(0);
        // The viewer says it was read again and differs, the result a click away.
        const after = viewer(page).locator('.viewer-read-again-after');
        await expect(after).toContainText('1 place differs from the transcript');
        await after.locator('[data-read-again-open]').click();
        await expect(dialog(page).locator('#read-title')).toHaveText('Source read again');
    });

    for (const code of ['noscan', 'notext'] as const) {
        test(`409 read.source.${code}: said in the dialog, the action gone until the research's next file`, async ({ page }) => {
            const b = await setup(page);
            b.read!.sourceReply = { status: 409, body: { error: code, code: `read.source.${code}`, source: 'S0001' } };
            await view(page);
            const d = await openAgain(page, again(page));
            await d.locator('[data-act="read"]').click();
            await expect(d.locator('.read-error')).toHaveAttribute('data-error', 'source-again');
            await expect(d.locator('.read-error-title')).toHaveText('The source can’t be read again right now.');
            await expect(d.locator('.read-error-text')).toHaveText(code === 'noscan'
                ? 'The research does not have the source’s original on this computer.'
                : 'The source has no transcript to compare a new reading with.');
            await expect(d.locator('.read-footer button')).toHaveText(['Close']);
            await d.locator('[data-act="close"]').last().click();
            // The viewer under it is drawn again without the action, the excerpt's too.
            await expect(again(page)).toHaveCount(0);
            await expect(excerptAgain(page)).toHaveCount(0);
            await view(page);
            await expect(again(page)).toHaveCount(0);
            // The research's next file: offered again.
            await page.evaluate(() => {
                const ui = window.Strom.UI;
                const ctx = ui.researchSyncLink()!;
                window.Strom.TreeManager.patchResearchLink(ctx.treeId, { syncedAt: new Date(Date.now() + 1000).toISOString() });
            });
            await view(page);
            await expect(again(page)).toBeVisible();
        });
    }

    test('409 read.source.running: the progress of that reading; the viewer shows it running with Show', async ({ page }) => {
        const b = await setup(page);
        b.read!.sourceReply = { status: 409, body: { error: 'running', code: 'read.source.running', source: 'S0001', read: RUNNING_ID } };
        await view(page);
        const d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        await expect(d.locator('#read-title')).toHaveText('Reading again');
        await expect(d.locator('.read-dialog')).toHaveAttribute('data-phase', 'progress');
        // The bridge lists it: still its progress, and the viewer shows it running.
        const now = new Date().toISOString();
        b.read!.reads = [{ id: RUNNING_ID, state: 'reading', version: 1, at: now, since: now, files: 1, pages: 1, readers: 1, done: 0, entries: 0, name: 'S0001', person: '', from: 'research', source: 'S0001' }];
        await poll(page);
        await expect(d.locator('#read-title')).toHaveText('Reading again');
        await d.locator('[data-act="close"]').last().click();
        await expect(d).toHaveCount(0);
        const live = viewer(page).locator('#source-viewer-read-again-live');
        await expect(live).toContainText('Reading again');
        await expect(again(page)).toHaveCount(0);
        await expect(excerptAgain(page)).toHaveCount(0);
        await live.locator('[data-read-again-open]').click();
        await expect(dialog(page).locator('.read-dialog')).toHaveAttribute('data-phase', 'progress');
        await expect(dialog(page).locator('#read-title')).toHaveText('Reading again');
        // A second "Read again…" is not sent while it runs.
        expect(b.read!.sourcePosts).toHaveLength(1);
    });

    test('other refusals: an unknown source and a research not ready say why; the action stays', async ({ page }) => {
        const b = await setup(page);
        b.read!.sourceReply = { status: 404, body: { error: 'none', code: 'read.source.none', source: 'S0001' } };
        await view(page);
        let d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        await expect(d.locator('.read-error-title')).toHaveText('The source can’t be read again right now.');
        await expect(d.locator('.read-error-text')).toHaveText('The research does not know this source (it may have been merged or removed).');
        await d.locator('[data-act="close"]').last().click();
        await expect(again(page)).toBeVisible();

        b.read!.sourceReply = { status: 503, body: { error: 'not ready', code: 'read.not-ready', why: 'limit' } };
        d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        await expect(d.locator('.read-error')).toHaveAttribute('data-error', 'not-ready');
        await expect(d.locator('#read-title')).toHaveText('Read the source again');
    });
});

test.describe('Read a source again on a narrow screen', () => {
    test.use({ viewport: PHONE });

    test('the source\'s input fits the width', async ({ page }) => {
        await setup(page);
        await view(page);
        await expect(again(page)).toBeVisible();
        const d = await openAgain(page, again(page));
        await expect(d.locator('.read-source-preview')).toBeVisible();
        await expect(d.locator('[data-act="read"]')).toBeVisible();
        const over = await d.locator('.read-dialog').evaluate(el => el.scrollWidth - el.clientWidth);
        expect(over).toBeLessThanOrEqual(1);
    });
});

test.describe('Read a source again on a phone', () => {
    // A touch phone reaches no bridge: the research's file alone says where reading again works.
    test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    test('no action, a sentence where it works; none at an excerpt; none without the original', async ({ page }) => {
        await setup(page);
        await view(page);
        const phone = viewer(page).locator('#source-viewer-read-again-phone');
        await expect(phone).toHaveText('Reading again works in the app on the computer with the research.');
        await expect(again(page)).toHaveCount(0);
        await expect(excerptAgain(page)).toHaveCount(0);
        // Under the transcript, in its section.
        await expect(viewer(page).locator('section:has(.viewer-transcript) #source-viewer-read-again-phone')).toHaveCount(1);
        const over = await viewer(page).locator('.source-viewer-body').evaluate(el => el.scrollWidth - el.clientWidth);
        expect(over).toBeLessThanOrEqual(1);
    });

    test('a source without its original in the research: no sentence', async ({ page }) => {
        await setup(page, { orig: false });
        await view(page);
        await expect(viewer(page).locator('.viewer-transcript')).toBeVisible();
        await expect(viewer(page).locator('#source-viewer-read-again-phone')).toHaveCount(0);
    });
});

test.describe('Read a source again on a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('the sentence in place of the action', async ({ page }) => {
        await setup(page);
        await view(page);
        await expect(viewer(page).locator('#source-viewer-read-again-phone')).toBeVisible();
        await expect(again(page)).toHaveCount(0);
    });
});
