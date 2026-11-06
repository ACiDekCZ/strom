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
function ged(opts: { orig?: boolean; clips?: string[] } = {}): string {
    const extra = [...(opts.orig === false ? [] : ['1 _STROM_ORIG Y']), ...(opts.clips ?? [CLIP]).flatMap(excerpt)];
    return researchGed().replace('1 _STROM_READ research', ['1 _STROM_READ research', ...extra].join('\n'));
}

async function setup(page: Page, opts: { orig?: boolean; clips?: string[]; features?: string[]; ready?: boolean; links?: string[] } = {}): Promise<FakeBridge> {
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
        await expect(note).toContainText('The source’s transcript has not changed.');
        await expect(note).toContainText('The match supports today’s transcript.');
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

    test('it differs: a task to check, not a conflict; its places with the marks; Open the task in the research', async ({ page }) => {
        const b = await setup(page);
        await view(page);
        const d = await openAgain(page, again(page));
        await readAndFinish(page, b, d, { id: 'S0001', agree: 'differ', variants: [{ at: 'Anna', other: 'Anně' }], task: 'T0042' });
        await expect(d.locator('[data-pill="source"]')).toHaveText('1 place differs from the transcript');
        await expect(d.locator('[data-pill="source"]')).toHaveClass(/is-warn/);
        const note = d.locator('.read-source-note');
        await expect(note).toHaveAttribute('data-agree', 'differ');
        await expect(note).toContainText('The difference is a task to check in the research, not a conflict; nothing is overwritten.');
        await expect(note.locator('.read-source-task')).toHaveText('Task T0042');
        const lines = note.locator('.read-legend-who-line');
        await expect(lines).toHaveText(['Today’s transcript of the source: “Anna”', 'New reading · Claude Code · Opus: “Anně”']);
        await expect(lines.locator('.read-variant-mk')).toHaveCount(2);
        expect(await lines.first().locator('.read-variant-mk').getAttribute('data-mk')).toBe('transcript');
        expect(await lines.last().locator('.read-variant-mk').getAttribute('data-mk')).toBe('new');
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
