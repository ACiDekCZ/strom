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

const excerpt = (clip: string, url = ''): string[] => ['1 OBJE', '2 FORM png', '2 _STROM_KIND excerpt', `2 _STROM_CLIP ${clip}`, ...(url ? [`2 _URL ${url}`] : []), `2 FILE ${PNG}`];

/** The research's file: S0001 with its original in the research (`orig`) and its excerpts. */
function ged(opts: { orig?: boolean; clips?: string[]; text?: string; pageUrl?: string } = {}): string {
    const extra = [...(opts.orig === false ? [] : ['1 _STROM_ORIG Y']), ...(opts.clips ?? [CLIP]).flatMap((c, i) => excerpt(c, i === 0 ? opts.pageUrl : ''))];
    const file = researchGed().replace('1 _STROM_READ research', ['1 _STROM_READ research', ...extra].join('\n'));
    return opts.text ? file.replace('1 TEXT Josef Fíšek a Anna', `1 TEXT ${opts.text}`) : file;
}

async function setup(page: Page, opts: { orig?: boolean; clips?: string[]; features?: string[]; ready?: boolean; links?: string[]; text?: string; pageUrl?: string } = {}): Promise<FakeBridge> {
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
    // The comparison with the transcript is named as such, even with one reader.
    b.read!.reads[0].state = 'checking';
    await poll(page);
    await expect(d.locator('.read-run-title')).toHaveText('Comparing with the source’s transcript');
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
        // The header in one sentence; who read under the text; nothing to check.
        const verdict = d.locator('#read-verdict');
        await expect(verdict).toHaveText('Read. Matches the existing transcript.');
        await expect(verdict).toHaveAttribute('data-agree', 'same');
        await expect(d.locator('.read-who-sentence')).toHaveText('Read by one reader (Claude Code · Opus).');
        await expect(d.locator('.read-check-row, .read-transcript .read-mk')).toHaveCount(0);
        // The footer says what became of the transcript.
        await expect(d.locator('.read-kept .read-foot-line')).toHaveText([
            'The existing transcript stays unchanged; the text as read is saved next to it.', 'The match supports the existing transcript.']);
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
        // A line of the text shows on the other part too (the entry stands on the same page).
        await d.locator('.read-line[data-line="1"]').click();
        await expect(d.locator('#read-scan-line')).toBeVisible();
        // The text is reader 1's; reader 2 read independently and disagreed in the places marked; both named once, under the text.
        await expect(d.locator('.read-who-sentence')).toHaveText('Text by reader 1 (Claude Code · Opus). Reader 2 (Codex · GPT-6-Astra) read independently, as a check.');
        await expect(d.locator('.read-transcript .read-mk-dis')).toHaveCount(2);
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveText(['Anně']);
        await expect(d.locator('#read-verdict')).toHaveText('Read. Against the existing transcript 1 change. The readers disagree in 2 places.');
        await expect(d.locator('#read-verdict strong')).toHaveText(['1 change', '2 places']);
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

    test('a register line of cells (S1383): every place marked once in the text and one row in "To check"; the data apart; an empty side in words', async ({ page }) => {
        const d = await readCells(page, CELL_VARIANTS);
        const check = d.locator('.read-check');
        // The readers' places: 5 in the line (neighbours within a cell merged), 1 only at reader 2, 1 in the data (the other one repeats a text place).
        const marked = await d.locator('.read-transcript .read-mk-dis').evaluateAll(els => new Set(els.map(e => e.getAttribute('data-place'))).size);
        expect(marked).toBe(5);
        const dis = check.locator('[data-group="dis"] .read-check-row');
        await expect(dis).toHaveCount(7);
        await expect(check.locator('[data-group="dis"] .read-check-head')).toHaveText(/The readers disagree· 7 places$/);
        await expect(dis.nth(0)).toHaveText(/^l\. 1/);
        await expect(dis.nth(5).locator('.read-place-missing')).toHaveText('missing');
        await expect(dis.nth(5)).toContainText('sponsus');
        await expect(dis.nth(6)).toContainText('Birth · date:');
        await expect(dis.nth(6)).toContainText('12 Martii 1774');
        await expect(check.locator('.read-places-more')).toHaveCount(0);
        // The changes against the existing transcript: in groups first, 2 marked in the text, 1 only listed.
        await expect(check.locator('.read-check-group').first()).toHaveAttribute('data-group', 'chg');
        const chg = check.locator('[data-group="chg"] .read-check-row');
        await expect(chg).toHaveCount(3);
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveCount(2);
        await expect(chg.nth(0).locator('.read-check-old')).toHaveText('Zvonářík');
        // An uncertain reading keeps its mark against the transcript as well (problemy.md č. 11), in the text too.
        await expect(chg.nth(0).locator('.read-mk-unc')).toHaveCount(1);
        await expect(d.locator('.read-transcript .read-mk-unc')).toHaveCount(1);
        await expect(chg.nth(2).locator('.read-place-missing')).toHaveText('missing');
        await expect(d.locator('#read-verdict')).toHaveText('Read, 1 word illegible. Against the existing transcript 3 changes. The readers disagree in 7 places.');
        // Nothing said with an ellipsis or empty quotes; each program named once.
        const text = await check.evaluate(el => el.textContent ?? '');
        expect(text).not.toContain('…');
        expect(text).not.toMatch(/“\s*”|""/);
        const all = await d.evaluate(el => el.textContent ?? '');
        expect(all.split('Codex').length).toBe(2);
        expect(all.split('Claude Code').length).toBeLessThanOrEqual(2);
        await expect(d.locator('.read-kept .read-foot-line')).toHaveText([
            'The existing transcript stays unchanged; the text as read is saved next to it.',
            'The changes are decided in the source task, which opens in the research terminal.']);
    });

    test('more than 8 places in a group: the first 8 and "and N more", unfolded in place', async ({ page }) => {
        const d = await readCells(page, [...CELL_VARIANTS, { at: '', other: 'sponsa' }, { at: '', other: 'testis' }, { at: '', other: 'parochus' }]);
        const group = d.locator('.read-check [data-group="dis"]');
        await expect(group.locator('.read-check-row')).toHaveCount(10);
        await expect(group.locator('.read-check-row:visible')).toHaveCount(8);
        const more = group.locator('.read-places-more');
        await expect(more).toHaveText('and 2 more');
        await more.click();
        await expect(group.locator('.read-check-row:visible')).toHaveCount(10);
        await expect(more).toHaveCount(0);
    });

    test('each kind of mark has its own shape, not only its colour (readable in greyscale)', async ({ page }) => {
        const d = await readCells(page, CELL_VARIANTS);
        const tr = d.locator('.read-transcript');
        const shape = (sel: string) => tr.locator(sel).first().evaluate(el => {
            const c = getComputedStyle(el);
            return { outline: c.outlineStyle, deco: c.textDecorationLine.includes('underline') ? c.textDecorationStyle : 'none', inset: c.boxShadow.includes('inset'),
                italic: c.fontStyle === 'italic', block: c.display === 'inline-block', sup: !!el.querySelector('sup'), bg: c.backgroundColor !== 'rgba(0, 0, 0, 0)' };
        });
        const dis = await shape('.read-mk-dis');
        const chg = await shape('.read-mk-chg');
        const unc = await shape('.read-mk-unc');
        const ill = await shape('.read-mk-ill');
        // A disagreement: tinted with a line under it; a change: a dashed frame; uncertain: dotted with "?"; illegible: a label.
        expect(dis).toMatchObject({ inset: true, bg: true, outline: 'none' });
        expect(chg).toMatchObject({ outline: 'dashed', inset: false });
        expect(unc).toMatchObject({ deco: 'dotted', sup: true, outline: 'none' });
        expect(ill).toMatchObject({ block: true, italic: true, bg: true });
        const sigs = [dis, chg, unc, ill].map(x => JSON.stringify([x.outline, x.deco, x.inset, x.italic, x.block, x.sup]));
        expect(new Set(sigs).size).toBe(4);
        // The groups' samples are drawn as their marks.
        expect(await d.locator('.read-check [data-group="chg"] .read-check-head .read-mk-chg').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('dashed');
    });

    /** Invented people (Vlk): the existing transcript, the text as read, the research's kinds of the changes. */
    const VLK_OLD = 'Vojtěch Vlk, syn Matěje Vlka a Ludmily, roz. Vlkové z Lhotky čp 12';
    const VLK_NEW = 'Vojtěch Vlk syn Matěje Vlka a Ludmily roz. Vlkové z Lhotky čp. 21';
    const VLK_CHANGES = [
        { at: 'Vlk,', other: 'Vlk', kind: 'punctuation' },
        { at: 'Ludmily,', other: 'Ludmily', kind: 'punctuation' },
        { at: 'čp 12', other: 'čp. 21', kind: 'number' },
    ];
    async function readVlk(page: Page, features: string[], extra: Record<string, unknown> = {}): Promise<Locator> {
        const b = await setup(page, { text: VLK_OLD, features: ['read.now', 'read.source', ...features] });
        await view(page);
        const d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.sourcePosts?.length ?? 0).toBe(1);
        b.read!.reads[0].state = 'done';
        b.read!.results.set(READ_ID, {
            ...result({ id: 'S0001', agree: 'differ', task: 'T0077', variants: VLK_CHANGES }),
            entries: [{ id: 'e1', page: 1, transcript: VLK_NEW, variants: [], persons: [], events: [], relations: [] }],
            ...extra,
        });
        await poll(page);
        await expect(d.locator('#read-title')).toHaveText('Source read again');
        return d;
    }

    test('read.variantKind: substantive changes first, minor details folded with their count and kinds; every one marked in the text', async ({ page }) => {
        const d = await readVlk(page, ['read.variantKind']);
        await expect(d.locator('#read-verdict')).toHaveText('Read. Against the existing transcript 1 substantive change and 2 minor details.');
        await expect(d.locator('#read-verdict strong')).toHaveText(['1 substantive change']);
        // Marks stay at minor details too.
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveCount(3);
        const group = d.locator('.read-check [data-group="chg"]');
        await expect(group.locator('.read-check-head')).toHaveText(/Differs from the existing transcript· 1 substantive change$/);
        const major = group.locator(':scope > .read-check-rows .read-check-row');
        await expect(major).toHaveCount(1);
        await expect(major.locator('.read-check-old')).toHaveText('čp 12');
        await expect(major.locator('.read-check-what .read-mk-chg')).toHaveText('čp. 21');
        await expect(major.locator('.read-check-kind')).toHaveText('house number');
        const minors = group.locator('.read-check-minors');
        await expect(minors.locator('summary')).toHaveText('and 2 minor details (punctuation)');
        await expect(minors).not.toHaveAttribute('open', '');
        await expect(minors.locator('.read-check-row')).toHaveCount(2);
        await expect(minors.locator('.read-check-row:visible')).toHaveCount(0);
        await minors.locator('summary').click();
        await expect(minors.locator('.read-check-row:visible')).toHaveCount(2);
        await expect(minors.locator('.read-check-kind')).toHaveText(['punctuation', 'punctuation']);
        // A minor one's mark in the text opens its row folded out, its bubble saying the kind.
        await minors.locator('summary').click();
        await d.locator('.read-transcript .read-mk-chg').first().click();
        await expect(minors).toHaveAttribute('open', '');
        await expect(minors.locator('.read-check-row.is-focus')).toHaveCount(1);
        const pop = d.locator('#read-pop');
        await expect(pop.locator('.read-pop-row')).toHaveCount(2);
        await expect(pop.locator('.read-pop-row').nth(1)).toContainText('Existing transcript');
        await expect(pop.locator('.read-pop-row').nth(1).locator('.read-pop-val')).toHaveText('Vlk,');
        await expect(pop.locator('.read-pop-note')).toHaveText('punctuation · minor detail');
        await pop.locator('[data-act="pop-close"]').click();
        await expect(pop).toHaveCount(0);
    });

    test('without read.variantKind: told apart in the app, "changes" without a kind, the kinds the research sent unused', async ({ page }) => {
        const d = await readVlk(page, []);
        await expect(d.locator('#read-verdict')).toHaveText('Read. Against the existing transcript 1 change and 2 minor details.');
        const group = d.locator('.read-check [data-group="chg"]');
        await expect(group.locator(':scope > .read-check-rows .read-check-kind')).toHaveText(['']);
        await expect(group.locator('.read-check-minors summary')).toHaveText('and 2 minor details');
    });

    test('reader 2\'s text: no change marked in it, said so; the changes listed from reader 1\'s text, a row goes back to it', async ({ page }) => {
        const blind = 'Vojtěch Vlk syn Matěje Vlka a Lidmily roz. Vlkove z Lhotky cp. 21';
        const d = await readVlk(page, ['read.variantKind', 'read.blindText'], {
            readers: { asked: 2, ran: 2, agree: 'differ', who: [
                { agent: 'claude', name: 'Claude Code', model: 'opus', modelName: 'Opus', effort: 'high', ran: true },
                { agent: 'codex', name: 'Codex', model: 'gpt-6-astra', modelName: 'GPT-6-Astra', effort: 'xhigh', ran: true },
            ] },
            blind: { doc: { kind: 'register.marriage' }, entries: [{ id: 'b1', page: 1, transcript: blind, of: 'e1' }] },
        });
        const btns = d.locator('.read-reader-btn');
        await expect(btns).toHaveText(['Reader 1', 'Reader 2']);
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveCount(3);
        await expect(d.locator('.read-r2note')).toHaveCount(0);
        await btns.nth(1).click();
        await expect(d.locator('.read-transcript')).toContainText('Lidmily');
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveCount(0);
        await expect(d.locator('.read-r2note')).toHaveText('Text of reader 2. Changes against the existing transcript are computed from the text of reader 1 and not marked here.');
        const group = d.locator('.read-check [data-group="chg"]');
        await expect(group.locator('.read-check-from')).toHaveText('· in the text of reader 1');
        await expect(group.locator('.read-check-row')).toHaveCount(3);
        // The row of a change: back in reader 1's text, its mark picked.
        await group.locator(':scope > .read-check-rows .read-check-row').click();
        await expect(btns.nth(0)).toHaveAttribute('aria-pressed', 'true');
        await expect(d.locator('.read-transcript .read-mk-chg.is-focus')).toHaveText('čp. 21');
        await expect(d.locator('.read-r2note')).toHaveCount(0);
    });

    test('under the scan: Full quality opens the excerpt in the research, the page opens in the archive', async ({ page }) => {
        const PAGE_URL = 'https://archive.example/register/41';
        const b = await setup(page, { links: ['send', 'open', 'live', 'app', 'setup', 'task', 'excerpt'], pageUrl: PAGE_URL });
        await view(page);
        const d = await openAgain(page, excerptAgain(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'same', variants: [] });
        const links = d.locator('.read-scan-links');
        await expect(links).toBeVisible();
        const archive = links.locator('.read-scan-archive');
        await expect(archive).toHaveText('Open the page in the archive ↗');
        await expect(archive).toHaveAttribute('href', PAGE_URL);
        await expect(archive).toHaveAttribute('target', '_blank');
        const full = links.locator('.read-scan-full');
        await expect(full).toHaveText('Full quality');
        // The excerpt opens in the system's viewer through the research, no terminal: no mark.
        await expect(full.locator('.research-open-mark')).toHaveCount(0);
        // Enlarge beside the text, not an overlay.
        await expect(d.locator('.read-scan-zoom')).toHaveCount(1);
        await full.click();
        await expect.poll(() => page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links))
            .toEqual([expect.stringMatching(new RegExp(`^strom-research://excerpt\\?tree=.+&source=S0001&clip=${CLIP}$`))]);
    });

    test('under the scan: no excerpt link announced and no page address, no links', async ({ page }) => {
        const b = await setup(page);
        await view(page);
        const d = await openAgain(page, excerptAgain(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'same', variants: [] });
        await expect(d.locator('.read-scan-box')).toBeVisible();
        await expect(d.locator('.read-scan-links')).toHaveCount(0);
    });

    test('reader 2 read as reader 1, or no reader 2: nothing said of it', async ({ page }) => {
        const b = await setup(page);
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], task: 'T0042' });
        await expect(d.locator('#read-verdict')).toHaveText('Read. Against the existing transcript 1 change.');
        await expect(d.locator('.read-check [data-group="dis"], .read-reader-seg')).toHaveCount(0);
        await expect(d.locator('.read-page-tabs')).toHaveCount(0);
        await expect(d.locator('.read-view-region')).toHaveCount(0);
    });

    test('it differs: a task to check, not a conflict; its places with the marks; Open the task in the research', async ({ page }) => {
        const b = await setup(page);
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], task: 'T0042' });
        // A research without read.sourceTask creates its task itself: the request as before.
        expect(b.read!.sourcePosts![0]).not.toHaveProperty('taskChoice');
        const verdict = d.locator('#read-verdict');
        await expect(verdict).toHaveText('Read. Against the existing transcript 1 change.');
        await expect(verdict).toHaveAttribute('data-agree', 'differ');
        // The change marked in the text (reader 1's) and one row: the transcript's words struck, the new ones framed.
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveText(['Anně']);
        const rows = d.locator('.read-check [data-group="chg"] .read-check-row');
        await expect(rows).toHaveCount(1);
        await expect(rows.locator('.read-check-old')).toHaveText('Anna');
        await expect(rows.locator('.read-check-what .read-mk-chg')).toHaveText('Anně');
        await expect(rows.locator('.read-check-ln')).toHaveText('l. 1');
        await expect(d.locator('.read-check [data-group="chg"] .read-check-head')).toHaveText(/Differs from the existing transcript· 1 change$/);
        // One reader ran: nothing between the readers.
        await expect(d.locator('.read-check [data-group="dis"]')).toHaveCount(0);
        await expect(d.locator('.read-kept .read-foot-line')).toHaveText([
            'The existing transcript stays unchanged; the text as read is saved next to it.',
            'The changes are decided in the source task, which opens in the research terminal.']);
        // The task opens in the research's terminal: its mark, not the AI badge.
        const open = d.locator('[data-act="open-task"]');
        await expect(open).toHaveText(/Open task T0042/);
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

    test('read.sourceTask: the app chooses who creates the task; the sure changes counted alike everywhere; one call; a failure retried', async ({ page }) => {
        const b = await setup(page, { features: ['read.now', 'read.source', 'read.sourceTask'] });
        await view(page);
        const d = await openAgain(page, again(page));
        const source = {
            id: 'S0001', agree: 'differ', task: '', taskSetting: 'ask', taskOffer: true,
            variants: [{ at: 'Anna', other: 'Anně', sure: true }, { at: 'Josef', other: 'Josef,', sure: true }],
        };
        await readAndFinish(page, b, d, source);
        expect(b.read!.sourcePosts![0].taskChoice).toBe(true);
        // The header, the first group and the agent's group say the same count: 1 sure change (the comma is minor).
        await expect(d.locator('#read-verdict')).toHaveText('Read. 1 substantive change against the transcript · 1 minor detail');
        await expect(d.locator('#read-verdict strong').first()).toHaveText('1 substantive change against the transcript');
        await expect(d.locator('.read-check [data-group="major"] .read-check-count')).toHaveText('(1)');
        await expect(d.locator('.read-check [data-group="major"] .read-check-note')).toHaveText('Only these places go into the task.');
        await expect(d.locator('.read-check [data-group="minor"] details')).not.toHaveAttribute('open', '');
        const foot = d.locator('.read-task-foot');
        await expect(foot).toHaveAttribute('data-task-state', 'A');
        await expect(foot.locator('[data-group="agent"] legend')).toContainText('1 substantive change to check');
        // Marks: now = the agent badge and the terminal mark, queue = the agent badge alone, save none.
        const now = foot.locator('[data-act="task-now"]');
        const queue = foot.locator('[data-act="task-queue"]');
        const save = foot.locator('[data-act="task-save"]');
        await expect(now.locator('.research-ai-badge')).toHaveCount(1);
        await expect(now.locator('.research-open-mark')).toHaveCount(1);
        await expect(queue.locator('.research-ai-badge')).toHaveCount(1);
        await expect(queue.locator('.research-open-mark')).toHaveCount(0);
        await expect(save.locator('.research-ai-badge, .research-open-mark')).toHaveCount(0);
        // A choice fits a finger.
        for (const c of [now, queue, save]) expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);

        // The research does not answer: said, and a retry repeats the choice.
        b.read!.taskReply = { status: 500, body: { code: 'oops' } };
        await queue.click();
        await expect(foot).toContainText('The task could not be created');
        const retry = foot.locator('[data-act="task-retry"]');
        await expect(retry).toHaveAttribute('data-how', 'queue');
        await expect(retry).toBeFocused();
        b.read!.taskReply = undefined;
        await retry.click();
        await expect(foot).toContainText('Task T0043 for the agent created, ahead in the queue.');
        expect(b.read!.taskPosts!.map(p => [p.source, p.read, p.body])).toEqual([['S0001', READ_ID, { how: 'queue' }], ['S0001', READ_ID, { how: 'queue' }]]);
        await expect(d.locator('.read-check [data-group="major"] .read-check-note')).toHaveText('Task T0043 has these places.');
        // Nothing opens by itself for the queue; the task opens from the footer.
        expect(await page.evaluate(() => (window.Strom.UI as unknown as { __links?: string[] }).__links ?? [])).toEqual([]);
        await foot.locator('[data-act="open-task"]').click();
        await expect.poll(() => page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links)).toEqual([expect.stringContaining('task=T0043')]);
    });

    test('read.sourceTask: "now" opens the chat with the agent in the research terminal', async ({ page }) => {
        const b = await setup(page, { features: ['read.now', 'read.source', 'read.sourceTask'] });
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'differ', task: '', taskSetting: 'ask', taskOffer: true, variants: [{ at: 'Anna', other: 'Anně', sure: true }] });
        await d.locator('[data-act="task-now"]').click();
        await expect.poll(() => page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links)).toEqual([expect.stringMatching(/task=T0043.*do=chat|do=chat.*task=T0043/)]);
        await expect(d.locator('.read-task-foot')).toContainText('Task T0043 for the agent created.');
    });

    test('read.sourceTask: the setting "always" as the bridge says it (no offer, the task made): created, the task to open', async ({ page }) => {
        const b = await setup(page, { features: ['read.now', 'read.source', 'read.sourceTask'] });
        await view(page);
        const d = await openAgain(page, again(page));
        // The research sends `taskOffer: false` once a task holds the places.
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'differ', task: 'T0001', taskFor: 'agent', taskSetting: 'always', taskOffer: false, variants: [{ at: 'Anna', other: 'Anně', sure: true }] });
        const foot = d.locator('.read-task-foot');
        await expect(foot).toHaveAttribute('data-task-state', 'C');
        await expect(foot).toContainText('T0001');
        await expect(foot).not.toContainText('No task is needed');
        await expect(foot.locator('[data-act="open-task"]')).toBeVisible();
        expect(b.read!.taskPosts ?? []).toEqual([]);
    });

    test('read.sourceTask: the setting "never": no choice, the footer says why, nothing sent', async ({ page }) => {
        const b = await setup(page, { features: ['read.now', 'read.source', 'read.sourceTask'] });
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'differ', task: '', taskSetting: 'never', taskOffer: true, variants: [{ at: 'Anna', other: 'Anně', sure: true }] });
        const foot = d.locator('.read-task-foot');
        await expect(foot).toHaveAttribute('data-task-state', 'D');
        await expect(foot.locator('[data-act^="task-"]')).toHaveCount(0);
        await expect(foot.locator('[data-act="close"]')).toHaveClass(/primary/);
        expect(b.read!.taskPosts ?? []).toEqual([]);
        // "Change in the research settings ›": the research's settings with "Reading documents" open and its value checked.
        await foot.locator('[data-act="open-settings"]').click();
        const group = page.locator('#research-tree-settings-modal #research-readtask-group');
        await expect(group).toBeVisible();
        await expect(group).toHaveAttribute('open', '');
        await expect(group.locator('input[name="research-read-task"]:checked')).toBeFocused();
    });

    // Only uncertain places, no sure change, no task (spec 059 P8): the research says `unsureOffer`.
    const UNSURE_SOURCE = {
        id: 'S0001', agree: 'differ', task: '', taskSetting: 'ask', taskOffer: false, unsureOffer: true,
        variants: [{ at: 'Anna', other: 'Anně', sure: false }],
    };
    const UNSURE_FEATURES = ['read.now', 'read.source', 'read.sourceTask', 'read.sourceTask.unsure'];

    test('read.sourceTask.unsure: only uncertain places, the agent looks at them on a click; Close stays the main action', async ({ page }) => {
        const b = await setup(page, { features: UNSURE_FEATURES });
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, UNSURE_SOURCE);
        const foot = d.locator('.read-task-foot');
        await expect(foot).toHaveAttribute('data-task-state', 'B');
        const choice = foot.locator('[data-act="task-queue"][data-unsure="true"]');
        await expect(choice).toContainText('Give to the agent to assess');
        await expect(choice).toContainText('corrects the transcript only where the scan is clear');
        await expect(choice.locator('.research-ai-badge')).toHaveCount(1);
        await expect(choice.locator('.research-open-mark')).toHaveCount(0);
        await expect(foot.locator('[data-act="close"]')).toHaveClass(/primary/);
        await expect(foot.locator('[data-act^="task-"]')).toHaveCount(1);
        expect(await foot.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        // Never by itself.
        expect(b.read!.taskPosts ?? []).toEqual([]);
        await choice.click();
        await expect(foot).toContainText('Task T0043 for the agent created, ahead in the queue.');
        expect(b.read!.taskPosts!.map(p => p.body)).toEqual([{ how: 'queue', unsure: true }]);
        await expect(foot.locator('[data-act="close"]')).toHaveClass(/primary/);
        await foot.locator('[data-act="open-task"]').click();
        await expect.poll(() => page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links)).toEqual([expect.stringContaining('task=T0043')]);
    });

    test('read.sourceTask.unsure: the places added to the source\'s open task (appended)', async ({ page }) => {
        const b = await setup(page, { features: UNSURE_FEATURES });
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { ...UNSURE_SOURCE, openTask: 'T0399' });
        b.read!.taskReply = { status: 200, body: { ok: true, how: 'queue', unsure: true, task: 'T0399', taskFor: 'agent', appended: true } };
        await d.locator('[data-act="task-queue"][data-unsure="true"]').click();
        await expect(d.locator('.read-task-foot')).toContainText('Places added to task T0399.');
    });

    test('without read.sourceTask.unsure: the offer unread, only Close as before', async ({ page }) => {
        const b = await setup(page, { features: ['read.now', 'read.source', 'read.sourceTask'] });
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, UNSURE_SOURCE);
        const foot = d.locator('.read-task-foot');
        await expect(foot).toHaveAttribute('data-task-state', 'B');
        await expect(foot.locator('[data-act^="task-"]')).toHaveCount(0);
        await expect(foot.locator('[data-unsure]')).toHaveCount(0);
        await expect(foot.locator('[data-act="close"]')).toHaveClass(/primary/);
    });

    test('read.sourceTask.unsure on a confirmed transcript: set aside for a person\'s review; a failure retried as the same choice; nothing to propose said', async ({ page }) => {
        const b = await setup(page, { features: UNSURE_FEATURES });
        await page.evaluate(() => {
            const src = Object.values(window.Strom.DataManager.getData().sources).find((s: any) => s.refn === 'S0001') as any;
            src.readBy = 'both';
            src.readConfirmed = '2026-11-01';
        });
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, UNSURE_SOURCE);
        const foot = d.locator('.read-task-foot');
        await expect(foot).toHaveAttribute('data-task-state', 'B');
        const choice = foot.locator('[data-act="task-review"][data-unsure="true"]');
        await expect(choice).toContainText('Set aside for review');
        await expect(choice).toContainText('only from the uncertain places the new reading read');
        await expect(choice.locator('.research-ai-badge, .research-open-mark')).toHaveCount(0);
        b.read!.taskReply = { status: 503, body: { code: 'research.busy' } };
        await choice.click();
        await expect(foot).toContainText('The task could not be created');
        const retry = foot.locator('[data-act="task-retry"]');
        await expect(retry).toHaveAttribute('data-how', 'review');
        await expect(retry).toHaveAttribute('data-unsure', 'true');
        b.read!.taskReply = { status: 409, body: { code: 'read.decide.noproposal' } };
        await retry.click();
        await expect(foot).toContainText('The new reading did not read the uncertain places: there is nothing to propose.');
        await expect(foot).not.toContainText('could not be created');
        expect(b.read!.taskPosts!.map(p => p.body)).toEqual([{ how: 'review', unsure: true }, { how: 'review', unsure: true }]);
        await expect(foot.locator('[data-act="close"]')).toHaveClass(/primary/);
    });

    test('read.sourceTask on a tablet: the two groups of choices fit the dialog\'s width', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 1000 });
        const b = await setup(page, { features: ['read.now', 'read.source', 'read.sourceTask'] });
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'differ', task: '', taskSetting: 'ask', taskOffer: true, variants: [{ at: 'Anna', other: 'Anně', sure: true }] });
        const foot = d.locator('.read-task-foot');
        await expect(foot.locator('.read-task-choice')).toHaveCount(3);
        const box = (await d.locator('.modal-content, .modal').first().boundingBox())!;
        for (const c of await foot.locator('.read-task-choice').all()) {
            const r = (await c.boundingBox())!;
            expect(r.x).toBeGreaterThanOrEqual(box.x);
            expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
        }
        expect(await foot.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
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

    test('a busy bridge takes the reading late: the dialog waits for it and follows it, no input offering a second reading', async ({ page }) => {
        const b = await setup(page);
        await page.evaluate(() => { (globalThis as { __STROM_READ_TIMEOUT_MS?: number }).__STROM_READ_TIMEOUT_MS = 600; });
        b.read!.startDelayMs = 2000;
        await view(page);
        const d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        // No answer in time: said so; neither the input's "Read" nor "Try again" (a second reading paid for).
        await expect(d.locator('.read-error[data-error="late"] .read-error-title')).toHaveText('The research did not confirm the reading in time.');
        await expect(d.locator('.read-error-text')).toHaveText('The reading may have started all the same: its progress shows here as soon as the research lists it.');
        await expect(d.locator('[data-act="read"]')).toHaveCount(0);
        await expect(d.locator('[data-act="retry"]')).toHaveCount(0);
        // A status while the bridge has not taken it yet: still waiting, not the input.
        await poll(page);
        await expect(d.locator('.read-error[data-error="late"]')).toBeVisible();
        // The bridge takes it: its progress, then its result.
        await expect.poll(() => b.read!.reads.length).toBe(1);
        await poll(page);
        await expect(d.locator('.read-dialog')).toHaveAttribute('data-phase', 'progress');
        await expect(d.locator('#read-title')).toHaveText('Reading again');
        b.read!.reads[0].state = 'done';
        b.read!.results.set(READ_ID, result({ id: 'S0001', agree: 'same', variants: [] }));
        await poll(page);
        await expect(d.locator('#read-title')).toHaveText('Source read again');
        expect(b.read!.sourcePosts).toHaveLength(1);
    });

    test('a start without an answer that the bridge never lists: long after, it most likely did not start and can be tried again', async ({ page }) => {
        const b = await setup(page);
        await page.evaluate(() => {
            const g = globalThis as { __STROM_READ_TIMEOUT_MS?: number; __STROM_READ_LATE_WAIT_MS?: number };
            g.__STROM_READ_TIMEOUT_MS = 600;
            g.__STROM_READ_LATE_WAIT_MS = 1500;
        });
        b.read!.startDelayMs = 1500;
        b.read!.sourceReply = { status: 500, body: { error: 'lost' } };
        await view(page);
        const d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        await expect(d.locator('.read-error[data-error="late"]')).toBeVisible();
        await expect(d.locator('[data-act="retry"]')).toHaveCount(0);
        await expect.poll(async () => { await poll(page); return d.locator('[data-act="retry"]').count(); }, { timeout: 15_000 }).toBe(1);
        await expect(d.locator('.read-error-text')).toHaveText('The research has not listed such a reading since then, so it most likely did not start.');
        // Tried again with a bridge that answers: the progress.
        b.read!.startDelayMs = 0;
        delete b.read!.sourceReply;
        await d.locator('[data-act="retry"]').click();
        await expect(d.locator('#read-title')).toHaveText('Reading again');
        expect(b.read!.sourcePosts).toHaveLength(2);
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

/**
 * A source read again with `read.sourceEntry` and `read.kinds` (spec 059 K6.4, K6.10): the source's own entry
 * among the entries read (the neighbours at the excerpt's edge told apart), a comparison that did not succeed
 * or was not written to the research, and readers that differ on the kind of entry. Without the features the
 * same responses show as today.
 */
test.describe('Read a source again: its own entry, a failed comparison, the kinds', () => {
    test.use({ viewport: DESKTOP });

    const TWO_READERS = { asked: 2, ran: 2, agree: 'differ', who: [
        { agent: 'claude', name: 'Claude Code', model: 'opus', modelName: 'Opus', effort: 'high', ran: true },
        { agent: 'codex', name: 'Codex', model: 'gpt-6-astra', modelName: 'GPT-6-Astra', effort: 'xhigh', ran: true },
    ] };
    /** Three entries of the excerpt: the source's own one in the middle (e2), its neighbours at the edges. */
    const THREE = [
        { id: 'e1', page: 1, region: [0.02, 0.02, 0.96, 0.2], transcript: '… Wenceslaus Zderadil', variants: [], events: [], relations: [],
            persons: [{ ref: 'p1', role: 'child', given: 'Wenceslaus', surname: 'Zderadil', written: 'Wenceslaus Zderadil' }] },
        { id: 'e2', page: 1, region: [0.02, 0.3, 0.96, 0.3], transcript: 'Josef Fíšek a Anně', variants: [], events: [], relations: [],
            persons: [{ ref: 'p1', role: 'groom', given: 'Josef', surname: 'Fíšek', written: 'Josef Fíšek' }] },
        { id: 'e3', page: 1, region: [0.02, 0.7, 0.96, 0.25], transcript: 'Ludmila Kortanová …', variants: [], events: [], relations: [],
            persons: [{ ref: 'p1', role: 'child', given: 'Ludmila', surname: 'Kortanová', written: 'Ludmila Kortanová' }] },
    ];

    async function readWith(page: Page, features: string[], res: Record<string, unknown>): Promise<Locator> {
        const b = await setup(page, { features: ['read.now', 'read.source', ...features] });
        await view(page);
        const d = await openAgain(page, again(page));
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.sourcePosts?.length ?? 0).toBe(1);
        b.read!.reads[0].state = 'done';
        b.read!.results.set(READ_ID, res);
        await poll(page);
        return d;
    }
    const neighbours = (source: Record<string, unknown>): Record<string, unknown> => ({ ...result(source), entries: THREE });

    test('read.sourceEntry: its own entry chosen, the neighbours told apart, a neighbour says it is not compared', async ({ page }) => {
        const d = await readWith(page, ['read.sourceEntry'], neighbours({ id: 'S0001', entries: ['e2'], agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], task: 'T0042' }));
        await expect(d.locator('#read-title')).toHaveText('Source read again');
        const pills = d.locator('.read-entry-pill');
        // The neighbours folded: the source's entry chosen, "+ 2 neighbouring entries".
        await expect(pills).toHaveCount(1);
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '1');
        await expect(d.locator('.read-nb-toggle')).toHaveText('+ 2 neighbouring entries');
        // A neighbour picked on the scan unfolds them; back on the source's entry they can fold again.
        await d.locator('.read-frame[data-entry="2"]').click();
        await expect(pills).toHaveCount(3);
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '2');
        await d.locator('.read-frame[data-entry="1"]').click();
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '1');
        await expect(d.locator('.read-nb-toggle')).toHaveText('hide neighbours');
        await d.locator('.read-nb-toggle').click();
        await expect(pills).toHaveCount(1);
        await d.locator('.read-nb-toggle').click();
        // Unfolded: the order stays, the neighbours dashed; "hide neighbours".
        await expect(pills).toHaveCount(3);
        await expect(d.locator('.read-nb-toggle')).toHaveText('hide neighbours');
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '1');
        await expect(d.locator('.read-entry-pill.is-source')).toHaveAttribute('data-entry', '1');
        await expect(d.locator('.read-entry-pill.is-neighbour')).toHaveCount(2);
        expect(await d.locator('.read-entry-pill.is-neighbour').first().evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('dashed');
        await expect(pills.locator('.read-entry-n')).toHaveText(['Entry 1', 'Entry 2', 'Entry 3']);
        await expect(pills.locator('.read-entry-tag')).toHaveText(['neighbouring', 'source entry', 'neighbouring']);
        await expect(d.locator('.read-frame.is-neighbour')).toHaveCount(2);
        await expect(d.locator('.read-frame.is-selected')).not.toHaveClass(/is-neighbour/);
        // The source's entry: its change marked and listed, no neighbour note.
        await expect(d.locator('.read-neighbour-note')).toHaveCount(0);
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveText(['Anně']);
        await expect(d.locator('.read-check [data-group="chg"] .read-check-row')).toHaveCount(1);

        // A neighbour: said at the top; the changes are not its own, nothing marked or checked.
        await pills.first().click();
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '0');
        await expect(d.locator('.read-neighbour-note')).toHaveText('Neighbouring entry from the edge of the excerpt. It is not compared with the existing transcript.');
        await expect(d.locator('.read-transcript .read-mk-chg, .read-check-row')).toHaveCount(0);
        await expect(d.locator('.read-check .read-check-none')).toHaveText('Nothing is checked at a neighbouring entry.');
        await pills.nth(1).click();
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '1');
        await expect(d.locator('.read-neighbour-note')).toHaveCount(0);
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveText(['Anně']);
    });

    test('without read.sourceEntry: the same result as today, the first entry chosen, nothing told apart', async ({ page }) => {
        const d = await readWith(page, [], neighbours({ id: 'S0001', entries: ['e2'], agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], task: 'T0042' }));
        await expect(d.locator('#read-title')).toHaveText('Source read again');
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '0');
        await expect(d.locator('.read-entry-pill.is-neighbour, .read-entry-pill.is-source, .read-entry-tag, .read-frame.is-neighbour')).toHaveCount(0);
        await expect(d.locator('.read-neighbour-note')).toHaveCount(0);
        // The comparison is listed (its words are not in the entry shown, so nothing is marked).
        const rows = d.locator('.read-check [data-group="chg"] .read-check-row');
        await expect(rows).toHaveCount(1);
        await expect(rows.locator('.read-check-old')).toHaveText('Anna');
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveCount(0);
    });

    test('no entry of the source found: the comparison did not succeed, the transcript stays; the app compares a chosen entry, nothing saved', async ({ page }) => {
        const res = neighbours({ id: 'S0001', entries: [], failed: { code: 'no-entry', why: 'only neighbours read' } });
        const d = await readWith(page, ['read.sourceEntry'], res);
        await expect(d.locator('#read-title')).toHaveText('Source read again');
        const verdict = d.locator('#read-verdict');
        await expect(verdict).toHaveAttribute('data-agree', 'failed');
        await expect(verdict).toHaveAttribute('data-failed', 'no-entry');
        await expect(verdict).toHaveText('Read. The source entry was not found in the text as read, so it was not compared with the existing transcript.');
        await expect(d).not.toContainText('only neighbours read');
        await expect(d.locator('.read-kept .read-foot-line')).toHaveText(['The existing transcript stays unchanged.']);
        // Nothing to propose here, as at any source read again; reading again is the research agent's.
        await expect(d.locator('[data-act="propose"]')).toHaveCount(0);
        await expect(d.locator('[data-act="open-task"]')).toHaveCount(0);
        await expect(d.locator('.read-footer [data-act="again"] .research-ai-badge')).toHaveCount(1);
        await expect(d.locator('.read-footer button.primary')).toHaveText('Close');
        // The one notice: which entry is the source's; its entries as chips, the comparison in the app (no mark).
        const nc = d.locator('.read-nc');
        await expect(nc).toHaveCount(1);
        await expect(d.locator('.read-kinds-note')).toHaveCount(0);
        await expect(nc.locator('.read-nc-q')).toHaveText('Which entry belongs to the source?');
        await expect(nc.locator('.read-nc-chip')).toHaveCount(3);
        const compare = nc.locator('[data-act="nc-compare"]');
        await expect(compare).toHaveText('Compare with the existing transcript');
        await expect(compare.locator('.research-ai-badge, .research-open-mark')).toHaveCount(0);
        await nc.locator('.read-nc-chip').nth(1).click();
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '1');
        await d.locator('.read-nc [data-act="nc-compare"]').click();
        await expect(d.locator('.read-nc')).toHaveCount(0);
        await expect(d.locator('.read-nc-done')).toHaveText('Compared in the app; nothing was saved.');
        await expect(d.locator('.read-transcript .read-mk-chg')).toHaveText(['Anně']);
        const rows = d.locator('.read-check [data-group="chg"] .read-check-row');
        await expect(rows).toHaveCount(1);
        await expect(rows.locator('.read-check-old')).toHaveText('Anna');
        await expect(verdict).toHaveText('Read. Against the existing transcript 1 change.');
        // Only in the dialog: the source's transcript untouched, nothing sent.
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().sources).find((s: any) => s.refn === 'S0001') as any).transcript))
            .toBe('Josef Fíšek a Anna');
        await expect(d.locator('[data-act="open-task"]')).toHaveCount(0);
    });

    test('a source changed meanwhile, or another failure: their own sentence', async ({ page }) => {
        const d = await readWith(page, ['read.sourceEntry'], result({ id: 'S0001', failed: { code: 'no-source', why: 'merged' } }));
        const verdict = d.locator('#read-verdict');
        await expect(verdict).toHaveAttribute('data-failed', 'no-source');
        await expect(verdict).toHaveText('Read. The source changed or was merged in the research meanwhile, so nothing was compared with the transcript.');
        await expect(d.locator('.read-kept .read-foot-line')).toHaveText(['The existing transcript stays unchanged.']);
    });

    test('compared but not written to the research: the comparison, and nothing says it was saved', async ({ page }) => {
        const d = await readWith(page, ['read.sourceEntry'], result({ id: 'S0001', agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], failed: { code: 'write', why: 'sealed elsewhere' } }));
        await expect(d.locator('#read-title')).toHaveText('Source read again');
        const verdict = d.locator('#read-verdict');
        await expect(verdict).toHaveAttribute('data-agree', 'differ');
        await expect(verdict).toHaveAttribute('data-failed', 'write');
        await expect(verdict).toHaveText('Read. Against the existing transcript 1 change.');
        await expect(d.locator('.read-kept .read-foot-line')).toHaveText(['The result was not written to the research (neither a task nor another reading at the source came of it); the source’s transcript stays.']);
        await expect(d.locator('.read-kept')).not.toContainText('saved next to it');
        await expect(d.locator('.read-check [data-group="chg"] .read-check-row')).toHaveCount(1);
        await expect(d.locator('[data-act="open-task"]')).toHaveCount(0);
    });

    test('without read.sourceEntry: no comparison as today, a plain reading without the comparison', async ({ page }) => {
        const d = await readWith(page, [], result({ id: 'S0001', failed: { code: 'no-entry', why: 'x' } }));
        // No `agree`: a plain reading, as today.
        await expect(d.locator('.read-transcript')).toBeVisible();
        await expect(d.locator('#read-title')).not.toHaveText('Source read again');
        await expect(d.locator('#read-verdict')).not.toHaveAttribute('data-agree', /./);
        await expect(d.locator('.read-nc, .read-check [data-group="chg"]')).toHaveCount(0);
    });

    test('without read.sourceEntry: a write failure compared as before', async ({ page }) => {
        const d = await readWith(page, [], result({ id: 'S0001', agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], failed: { code: 'write', why: 'x' } }));
        await expect(d.locator('#read-title')).toHaveText('Source read again');
        await expect(d.locator('#read-verdict')).not.toHaveAttribute('data-failed', /./);
        await expect(d.locator('.read-kept .read-foot-line').first()).toHaveText('The existing transcript stays unchanged; the text as read is saved next to it.');
    });

    test('read.kinds: the readers differ on the kind of entry, one notice over the text; never that they agree', async ({ page }) => {
        const res = { ...result({ id: 'S0001', agree: 'same', variants: [] }), readers: { ...TWO_READERS, kinds: { first: 'register.marriage', blind: 'register.baptism' } } };
        const d = await readWith(page, ['read.kinds'], res);
        const kinds = d.locator('.read-kinds-note');
        await expect(kinds).toHaveCount(1);
        await expect(kinds).toHaveText('!The readers disagree on the kind of entry: reader 1 reads marriage, reader 2 baptism. This changes how the whole entry is read. To be checked against the scan before writing to the tree.');
        await expect(kinds.locator('strong')).toHaveText('The readers disagree on the kind of entry: reader 1 reads marriage, reader 2 baptism.');
        await expect(kinds).toHaveAttribute('role', 'note');
        // Above the text, before it.
        expect(await d.locator('#read-text').evaluate(el => {
            const n = el.querySelector('.read-kinds-note'), tx = el.querySelector('.read-transcript');
            return !!n && !!tx && !!(n.compareDocumentPosition(tx) & Node.DOCUMENT_POSITION_FOLLOWING);
        })).toBe(true);
        await expect(d.locator('#read-verdict')).toHaveText('Read. Matches the existing transcript.');
    });

    test('without read.kinds: nothing said of the kinds', async ({ page }) => {
        const res = { ...result({ id: 'S0001', agree: 'same', variants: [] }), readers: { ...TWO_READERS, kinds: { first: 'register.marriage', blind: 'register.baptism' } } };
        const d = await readWith(page, [], res);
        await expect(d.locator('#read-verdict')).toHaveText('Read. Matches the existing transcript. The readers agree.');
        await expect(d.locator('.read-kinds-note')).toHaveCount(0);
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
