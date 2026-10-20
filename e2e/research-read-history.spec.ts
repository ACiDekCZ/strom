import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakeRead, readAccepts, openResearch, openResearchMenu, poll, researchGed, FakeBridge, FakeReading, READ_ID } from './research-bridge.js';
import { cardAction } from './helpers.js';

/**
 * "Read a document", P2 (spec 013 U6): the readings of the research
 * (`GET reads`) under "Research for this tree…", a reading opened from that
 * list, from a source written from it (its entry chosen) and from a person's
 * sources; when the research cannot show it, the source's own transcription.
 * All against a fake bridge; invented documents and names.
 */

const DESKTOP = { width: 1440, height: 900 };
const FAILED_ID = 'D20261020091500-c3d4';
const UNREADABLE_ID = 'D20261018080000-0e0f';

/** The research's tree: Jan's baptism source written from entry e2 of the reading (marks kept in the transcription), and a census source without a reading. */
function ged(): string {
    return researchGed(undefined, [
        '1 SOUR @S0002@', '1 SOUR @S0003@',
        '0 @S0003@ SOUR', '1 TITL Sčítání lidu, Lhota 1869', '1 REFN S0003',
        '0 @S0002@ SOUR', '1 TITL Křest, Lhota 1846', '1 REFN S0002',
        '1 TEXT Joannes filius [?] legitimus', '2 CONT Antonii [...] Novák, Lhota',
        `1 _STROM_READING ${READ_ID}`, '2 _STROM_ENTRY e2',
    ]);
}

/** The reading's result: two entries, the second one is Jan's. */
function result(id = READ_ID): Record<string, unknown> {
    return {
        id, state: 'done', lang: 'en',
        doc: { kind: 'register.baptism', language: ['la'], script: 'kurrent', date: '3. 4. 1846', legible: 'yes', why: null },
        readers: { asked: 1, ran: 1, agree: null },
        pages: [{ n: 1, file: 'I0101', name: 'krest-lhota-1846.jpg', page: 1, w: 600, h: 800, image: `read/${id}/page/1.jpg` }],
        entries: [
            { id: 'e1', page: 1, transcript: 'Maria filia legitima\nWenceslai Král, Lhota', persons: [], events: [], relations: [] },
            { id: 'e2', page: 1, transcript: 'Joannes filius legitimus\nJosephi Fíšek, Lhota', persons: [], events: [], relations: [] },
        ],
        context: '', version: 1,
    };
}

function reading(id: string, state: string, at: string, extra: Partial<FakeReading> = {}): FakeReading & { inSource?: boolean } {
    return { id, state, version: 1, at, since: at, files: 1, pages: 1, readers: 1, done: 1, entries: 0, name: 'zapis.jpg', person: '', from: 'app', ...extra };
}

/** Three readings, not in their asked-for order: a done one of Jan (in a source), a failed one of the research, an unreadable one. */
function history(): (FakeReading & { inSource?: boolean })[] {
    return [
        reading(READ_ID, 'done', '2026-10-19T15:30:12Z', { entries: 2, name: 'krest-lhota-1846.jpg', person: 'P0003', inSource: true }),
        reading(UNREADABLE_ID, 'unreadable', '2026-10-18T08:00:00Z', { name: 'rozmazana-strana.jpg' }),
        reading(FAILED_ID, 'failed', '2026-10-20T09:15:00Z', { name: 'pozemkova-kniha-lhota-svazek-druhy.pdf', from: 'research' }),
    ];
}

async function setup(page: Page, opts: { history?: boolean; historyReply?: { status: number; body: unknown } } = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, {
        accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true }, read: readAccepts() },
        features: ['read.now'],
        read: fakeRead({
            ...(opts.history === false ? {} : { history: history() }),
            ...(opts.historyReply ? { historyReply: opts.historyReply } : {}),
        }),
    });
    await openResearch(page, { media: true, ged: ged() });
    b.read!.results.set(READ_ID, result());
    b.read!.results.set(UNREADABLE_ID, { ...result(UNREADABLE_ID), state: 'unreadable', entries: [],
        doc: { kind: 'other', language: [], script: '', date: '', legible: 'no', why: 'blur' } });
    await poll(page);
    return b;
}

const dialog = (page: Page) => page.locator('#read-document-modal');
const list = (page: Page) => page.locator('#read-history-modal');
const row = (page: Page) => page.locator('#research-read-history');

async function openSettings(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
    const modal = page.locator('#research-tree-settings-modal');
    await expect(modal).toBeVisible();
    return modal;
}

async function openList(page: Page): Promise<Locator> {
    await openSettings(page);
    await row(page).click();
    await expect(list(page)).toBeVisible();
    return list(page);
}

const sourceId = (page: Page) => page.evaluate((id) =>
    Object.values(window.Strom.DataManager.getData().sources ?? {}).find((s: any) => s.reading === id)!.id as string, READ_ID);

test.describe('Read a document: the history', () => {
    test.use({ viewport: DESKTOP });

    test('"Read documents (N)" in Research for this tree, the list newest first with its tags', { tag: '@smoke' }, async ({ page }) => {
        await setup(page);
        await openResearchMenu(page);
        await page.locator('#research-item-tree-settings').click();
        await expect(row(page)).toHaveText('Read documents (3) ›');
        await row(page).click();
        // The settings close, the list opens.
        await expect(page.locator('#research-tree-settings-modal')).toHaveCount(0);
        const l = list(page);
        await expect(l.locator('#read-history-title')).toHaveText('Read documents');
        const rows = l.locator('.read-history-row');
        await expect(rows).toHaveCount(3);
        await expect(rows.locator('.read-history-name')).toHaveText(['pozemkova-kniha-lhota-svazek-druhy.pdf', 'krest-lhota-1846.jpg', 'rozmazana-strana.jpg']);
        await expect(rows.nth(0).locator('[data-tag="state"]')).toHaveText('Didn’t finish');
        await expect(rows.nth(0).locator('[data-tag="from-research"]')).toHaveText('read in the research');
        // The person by the research's REFN, the entries, "in the tree".
        await expect(rows.nth(1).locator('.read-history-meta')).toContainText('Jan Fíšek');
        await expect(rows.nth(1).locator('.read-history-meta')).toContainText('2 entries');
        await expect(rows.nth(1).locator('[data-tag="state"]')).toHaveText('Read');
        await expect(rows.nth(1).locator('[data-tag="in-source"]')).toHaveText('in the tree');
        await expect(rows.nth(2).locator('[data-tag="state"]')).toHaveText('Can’t be read');
        await expect(rows.nth(2).locator('[data-tag="in-source"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(l).toHaveCount(0);
    });

    test('a row opens its reading over the list: the result, what failed (no reading again for the research\'s own), why unreadable', async ({ page }) => {
        const b = await setup(page);
        const l = await openList(page);
        await l.locator('.read-history-row').nth(1).click();
        const d = dialog(page);
        await expect(d.locator('#read-result')).toBeVisible();
        await expect(d.locator('#read-transcript')).toContainText('Maria filia legitima');
        await expect(d.locator('.read-kept')).toHaveText('The result stays in the reading history');
        await expect(d.locator('.read-footer [data-act="close"]')).toBeVisible();
        await d.locator('.read-footer [data-act="close"]').click();
        await expect(d).toHaveCount(0);
        await expect(l).toBeVisible();
        // Failed in the research: said, nothing to read again from here.
        await l.locator('.read-history-row').nth(0).click();
        await expect(d.locator('.read-error')).toHaveAttribute('data-error', 'failed');
        await expect(d.locator('[data-act="retry"], [data-act="again"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(d).toHaveCount(0);
        await l.locator('.read-history-row').nth(2).click();
        await expect(d.locator('.read-error')).toHaveAttribute('data-error', 'unreadable');
        await expect(d.locator('.read-error-title')).toContainText('blurred');
        expect(b.read!.agains).toEqual([]);
    });

    test('an older research without the history: no row; an archive (404 read.none): no row', async ({ page }) => {
        const b = await setup(page, { history: false });
        await openSettings(page);
        await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('/reads')))).toBe(true);
        await expect(row(page)).toBeHidden();
        b.read!.historyReply = { status: 404, body: { error: 'No readings in an archive.', code: 'read.none', text: 'No readings in an archive.' } };
        await openSettings(page);
        await expect.poll(() => b.read!.historyAsks ?? 0).toBeGreaterThan(0);
        await expect(row(page)).toBeHidden();
        // An empty history: no row either.
        b.read!.historyReply = undefined;
        b.read!.history = [];
        await openSettings(page);
        await expect.poll(() => b.read!.historyAsks ?? 0).toBeGreaterThan(1);
        await expect(row(page)).toBeHidden();
    });
});

test.describe('Read a document: from a source and a person', () => {
    test.use({ viewport: DESKTOP });

    test('the source\'s detail: "Reading result…" beside the transcript opens the result on the source\'s entry', async ({ page }) => {
        await setup(page);
        const id = await sourceId(page);
        await page.evaluate((sid) => window.Strom.UI.showSourceViewer(sid, null), id);
        const viewer = page.locator('#source-viewer-modal');
        const link = viewer.locator('#source-viewer-reading');
        await expect(link).toHaveText('Reading result…');
        // Under the transcript, in its section.
        await expect(viewer.locator('section', { has: page.locator('.viewer-transcript') }).locator('#source-viewer-reading')).toHaveCount(1);
        await link.click();
        const d = dialog(page);
        await expect(d.locator('#read-result')).toBeVisible();
        // Entry e2 (the source's), not the first one.
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '1');
        await expect(d.locator('#read-transcript')).toContainText('Joannes filius legitimus');
        // Over the viewer: its buttons answer.
        await d.locator('.read-footer [data-act="close"]').click();
        await expect(d).toHaveCount(0);
        await expect(viewer).toBeVisible();
    });

    test('the links stand flush with the text around them (no button padding at their sides)', async ({ page }) => {
        await setup(page);
        const left = (l: Locator) => l.evaluate(el => {
            const r = document.createRange();
            r.selectNodeContents(el);
            return Math.round(r.getBoundingClientRect().left);
        });
        // The source's detail: the link under the transcript starts where the transcript does.
        await page.evaluate((sid) => window.Strom.UI.showSourceViewer(sid, null), await sourceId(page));
        const viewer = page.locator('#source-viewer-modal');
        expect(await left(viewer.locator('#source-viewer-reading'))).toBe(await left(viewer.locator('.viewer-transcript')));
        await page.keyboard.press('Escape');
        await expect(viewer).toBeHidden();
        // A person's sources: under the source's title.
        await cardAction(page, 'Jan', 'sources');
        const ps = page.locator('#person-sources-modal');
        const item = ps.locator('.person-source-item');
        expect(await left(item.locator('.person-source-reading'))).toBe(await left(item.locator('.person-source-title')));
        await page.keyboard.press('Escape');
        await expect(ps).toBeHidden();
        // Research for this tree: the row starts where the dialog's text does.
        const modal = await openSettings(page);
        await expect(row(page)).toBeVisible();
        expect(await left(row(page))).toBe(await left(modal.locator('.research-trial-sentence')));
    });

    test('a person\'s sources: the link under the row of a source from a reading only', async ({ page }) => {
        await setup(page);
        await cardAction(page, 'Jan', 'sources');
        const ps = page.locator('#person-sources-modal');
        await expect(ps.locator('.person-source-row')).toHaveCount(2);
        const links = ps.locator('.person-source-reading');
        await expect(links).toHaveCount(1);
        await expect(links).toHaveText('Reading result…');
        await expect(ps.locator('.person-source-item .person-source-title')).toHaveText('Křest, Lhota 1846');
        await links.click();
        const d = dialog(page);
        await expect(d.locator('#read-transcript')).toContainText('Joannes filius legitimus');
        await d.locator('.read-footer [data-act="close"]').click();
        await expect(ps).toBeVisible();
    });

    test('the research not running: the block with the source\'s transcription and its marks, copy, open the research', async ({ page }) => {
        const b = await setup(page);
        b.down = true;
        await poll(page);
        await page.evaluate((sid) => window.Strom.UI.showReadingOfSource(sid), await sourceId(page));
        const d = dialog(page);
        await expect(d.locator('#read-title')).toHaveText('Křest, Lhota 1846');
        const block = d.locator('.read-source-block');
        await expect(block).toHaveAttribute('data-why', 'down');
        await expect(block.locator('.read-error-title')).toHaveText('The whole reading result can’t be opened right now.');
        await expect(block.locator('.read-error-text')).toHaveText('Research isn’t running right now.');
        const lines = d.locator('.read-source-line');
        await expect(lines).toHaveCount(2);
        await expect(lines.nth(0).locator('mark.uncertain')).toHaveCount(1);
        await expect(lines.nth(1).locator('.illegible')).toHaveCount(1);
        await expect(d.locator('.read-footer .primary')).toHaveAttribute('data-act', 'open-research');
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await d.locator('[data-act="copy-source"]').click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Joannes filius [?] legitimus\nAntonii [...] Novák, Lhota');
        // No technical words in the dialog.
        await expect(d).not.toContainText('read.none');
        // The research back: the result comes in its place.
        b.down = false;
        await poll(page);
        await page.evaluate(() => window.Strom.UI.refreshReadGate());
        await expect(d.locator('#read-result')).toBeVisible();
    });

    test('an older research that does not read (running, read/<id> a bare 404): the block says so, Update, no asking again', async ({ page }) => {
        await fakeBridge(page, { accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true } } });
        await openResearch(page, { media: true, ged: ged() });
        await poll(page);
        const asks: string[] = [];
        page.on('request', r => { if (/\/read\//.test(new URL(r.url()).pathname)) asks.push(r.url()); });
        await page.evaluate((sid) => window.Strom.UI.showReadingOfSource(sid), await sourceId(page));
        const d = dialog(page);
        const block = d.locator('.read-source-block');
        await expect(block).toHaveAttribute('data-why', 'older');
        await expect(block.locator('.read-error-text')).toHaveText('This research version doesn’t give reading results; a newer one does.');
        await expect(d.locator('.read-footer .primary')).toHaveAttribute('data-act', 'update-research');
        await expect(d.locator('[data-act="open-research"]')).toHaveCount(0);
        await expect(d.locator('.read-source-line')).toHaveCount(2);
        // Statuses come and go: the block stays and the research is not asked for the reading.
        for (let i = 0; i < 3; i++) {
            await poll(page);
            await page.evaluate(() => window.Strom.UI.refreshReadGate());
        }
        await expect(block).toHaveAttribute('data-why', 'older');
        expect(asks).toEqual([]);
    });

    test('the research does not have the reading (404 read.none): the block says so, Close is the main button', async ({ page }) => {
        const b = await setup(page);
        b.read!.results.delete(READ_ID);
        await page.evaluate((sid) => window.Strom.UI.showReadingOfSource(sid), await sourceId(page));
        const block = dialog(page).locator('.read-source-block');
        await expect(block).toHaveAttribute('data-why', 'none');
        await expect(block.locator('.read-error-text')).toHaveText('The research doesn’t have this reading.');
        await expect(dialog(page).locator('.read-footer .primary')).toHaveAttribute('data-act', 'close');
        await expect(dialog(page).locator('[data-act="open-research"]')).toHaveCount(0);
        await expect(dialog(page).locator('.read-source-line')).toHaveCount(2);
    });

    test('a tree not linked to a research: the link still shows, the block says the tree is not linked', async ({ page }) => {
        await setup(page);
        const id = await sourceId(page);
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            tm.setResearchLink(tm.getActiveTreeId()!, undefined);
        });
        expect(await page.evaluate(() => !!window.Strom.UI.researchOriginalsLink())).toBe(false);
        await page.evaluate((sid) => window.Strom.UI.showSourceViewer(sid, null), id);
        await page.locator('#source-viewer-reading').click();
        const block = dialog(page).locator('.read-source-block');
        await expect(block).toHaveAttribute('data-why', 'unlinked');
        await expect(dialog(page).locator('[data-act="open-research"]')).toHaveCount(0);
    });
});

/** Nothing in the element is wider than the element itself. */
async function noOverflow(target: Locator): Promise<void> {
    const sizes = await target.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const wider = [...el.querySelectorAll<HTMLElement>('*')]
            .filter(c => c.getClientRects().length > 0)
            .filter(c => { const r = c.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1; })
            .map(c => c.className || c.tagName);
        return { scroll: el.scrollWidth, client: el.clientWidth, right: box.right, vw: window.innerWidth, wider };
    });
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
    expect(sizes.right).toBeLessThanOrEqual(sizes.vw + 1);
    expect(sizes.wider).toEqual([]);
}

for (const viewport of [DESKTOP, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    test.describe(`The history in German at ${viewport.width}px`, () => {
        test.use({ viewport, locale: 'de-DE' });

        test('the list and the block: nothing runs over', async ({ page }) => {
            const b = await setup(page);
            const l = await openList(page);
            await expect(row(page)).toHaveCount(0);
            await expect(l.locator('#read-history-title')).toHaveText('Gelesene Dokumente');
            await expect(l.locator('.read-history-row').nth(0).locator('[data-tag="from-research"]')).toHaveText('in der Forschung gelesen');
            await noOverflow(l.locator('.modal'));
            await noOverflow(l.locator('.read-history-list'));
            await page.keyboard.press('Escape');
            b.down = true;
            await poll(page);
            await page.evaluate((sid) => window.Strom.UI.showReadingOfSource(sid), await sourceId(page));
            const d = dialog(page);
            await expect(d.locator('.read-error-title')).toHaveText('Das ganze Leseergebnis lässt sich gerade nicht öffnen.');
            await noOverflow(d.locator('.read-dialog'));
            await noOverflow(d.locator('.read-footer'));
            // An older research (running, does not read): its own words and Update in the footer.
            await d.locator('.read-footer [data-act="close"]').click();
            b.down = false;
            b.features = [];
            delete (b.accepts as { read?: unknown }).read;
            await poll(page);
            await page.evaluate((sid) => window.Strom.UI.showReadingOfSource(sid), await sourceId(page));
            await expect(d.locator('.read-source-block')).toHaveAttribute('data-why', 'older');
            await expect(d.locator('[data-act="update-research"]')).toBeVisible();
            await noOverflow(d.locator('.read-dialog'));
            await noOverflow(d.locator('.read-footer'));
        });
    });
}
