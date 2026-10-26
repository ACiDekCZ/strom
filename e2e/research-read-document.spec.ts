import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakeRead, readAccepts, openResearch, openResearchMenu, poll, researchGed, FakeBridge, READ_ID } from './research-bridge.js';
import { card, cardAction } from './helpers.js';

/**
 * "Read a document" (spec 013): the Research menu's item and its states, the
 * person menu's item, the dialog (pages, refused files, person, note,
 * readers), sending (a PUT per page, then POST /read), the progress, the
 * notice when a reading ends with the dialog closed, cancelling, the limit.
 * All against a fake bridge; invented documents and names.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

function accepts(read: Record<string, unknown> | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true },
        ...(read ? { read } : {}), ...extra,
    };
}

async function setup(page: Page, opts: { read?: Record<string, unknown> | null; features?: string[]; extra?: Record<string, unknown> } = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, {
        accepts: accepts(opts.read === undefined ? readAccepts() : opts.read, opts.extra),
        features: opts.features ?? ['read.now'],
        read: fakeRead(),
    });
    await openResearch(page, { media: true });
    await poll(page);
    return b;
}

const item = (page: Page) => page.locator('#research-item-read');
const dialog = (page: Page) => page.locator('#read-document-modal');

/** Now and then: the first item of "Other actions", never on the menu's first level. */
async function expectFirstOfMore(page: Page): Promise<void> {
    await expect(page.locator('#research-menu > .research-menu-group > #research-item-read')).toHaveCount(0);
    await expect(page.locator('#research-menu-more [role="menuitem"]').first()).toHaveId('research-item-read');
}

async function openFromMenu(page: Page): Promise<Locator> {
    await openResearchMenu(page, { expandMore: true });
    await item(page).click();
    await expect(dialog(page)).toBeVisible();
    return dialog(page);
}

async function addPages(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void> {
    await page.setInputFiles('#read-input', files);
    await expect(dialog(page).locator('.read-page')).toHaveCount(files.length);
}

/** A finished reading as `GET /read/<id>` answers it. */
function result(id = READ_ID): Record<string, unknown> {
    return {
        id, state: 'done', lang: 'en',
        doc: { kind: 'register.baptism', language: ['la'], script: 'kurrent', date: '3. 4. 1846', legible: 'yes', why: null },
        readers: { asked: 1, ran: 1, agree: null },
        pages: [{ n: 1, file: 'I0101', name: 'zapis.jpg', page: 1, w: 3024, h: 4032, image: `read/${id}/page/1.jpg` }],
        entries: [{ id: 'e1', page: 1, transcript: 'Joannes filius legitimus\nAntonii Novák, Lhota', persons: [], events: [], relations: [] }],
        context: '', version: 1,
    };
}

/** The reading moves on at the bridge; the app asks it now. */
async function step(page: Page, b: FakeBridge, state: string, done = 0): Promise<void> {
    const r = b.read!.reads[0];
    r.state = state;
    r.done = done;
    r.since = new Date().toISOString();
    if (state === 'done') b.read!.results.set(r.id, result(r.id));
    await poll(page);
}

/** Pages chosen, sent; the reading started (the dialog shows its progress). */
async function startReading(page: Page, b: FakeBridge): Promise<Locator> {
    const d = await openFromMenu(page);
    await addPages(page, [{ name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
    await d.locator('[data-act="read"]').click();
    await expect(d.locator('#read-title')).toHaveText('Reading a document');
    await expect.poll(() => b.read!.posts.length).toBe(1);
    return d;
}

test.describe('Read a document', () => {
    test.use({ viewport: DESKTOP });

    test('ready: the Research menu offers it with the AI badge; the person menu too', { tag: '@smoke' }, async ({ page }) => {
        await setup(page);
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toBeVisible();
        await expectFirstOfMore(page);
        await expect(item(page)).toContainText('Read a document…');
        await expect(item(page)).toContainText('starts the research agent');
        await expect(item(page)).not.toHaveAttribute('aria-disabled', 'true');
        await item(page).click();
        await expect(dialog(page).locator('#read-title')).toHaveText('Read a document');
        await expect(dialog(page).locator('#read-drop')).toBeVisible();
        // Taking a photo with the phone does not exist yet: no row promises it.
        await expect(dialog(page)).not.toContainText('Take a photo with the phone');
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);

        // The person menu: the dialog with the person chosen.
        await cardAction(page, 'Jan', 'research-read');
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('#read-person-picker input')).toHaveValue('Jan Fíšek');
    });

    test('offered by a research that announces no strom-research:// links: reading goes through the bridge', async ({ page }) => {
        await fakeBridge(page, {
            accepts: accepts(readAccepts()), features: ['read.now'], read: fakeRead(), links: [],
        });
        await openResearch(page, { media: true, ged: researchGed().replace(/^1 _STROM_LINKS .*\n/m, '') });
        await poll(page);
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-open')).toHaveCount(0);
        await expect(item(page)).toBeVisible();
        await expectFirstOfMore(page);
        await expect(item(page)).toContainText('Read a document…');
        await item(page).click();
        await expect(dialog(page).locator('#read-drop')).toBeVisible();
    });

    test('progress names the chosen file, not the name the research gives a page it already had', async ({ page }) => {
        const b = await setup(page);
        b.read!.readName = `${'f8948c91'.repeat(8)}.jpg`;
        const d = await openFromMenu(page);
        await addPages(page, [{ name: 'kostel-lhota.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        await step(page, b, 'reading');
        await expect(d.locator('.read-step.is-done')).not.toHaveCount(0);
        await expect(d.locator('#read-title')).toHaveText('Reading a document');
        await expect(d.locator('.audit-log-subtitle')).toContainText('kostel-lhota.jpg');
        await expect(d.locator('.audit-log-subtitle')).not.toContainText('f8948c91');
    });

    test('the research panel\'s strip: a long file name cut with an ellipsis, the whole name in its tooltip', async ({ page }) => {
        const b = await setup(page);
        const long = 'farni-matrika-lhota-krty-1846-strana-12-zapis-jana.jpg';
        // The strip names the reading as the research lists it.
        b.read!.readName = long;
        const d = await openFromMenu(page);
        await addPages(page, [{ name: long, mimeType: 'image/jpeg', buffer: JPEG }]);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        await d.locator('.read-footer [data-act="close"]').last().click();
        await expect(dialog(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        const name = page.locator('#live-panel #read-strip .read-strip__name');
        await expect(name).toHaveText(long);
        await expect(name).toHaveAttribute('title', long);
        // Cut, not wrapped or running over the panel.
        expect(await name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
        expect(await page.locator('#live-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    });

    test('not ready: shown greyed with the reason and the way to the research; not in the person menu', async ({ page }) => {
        await setup(page, { read: readAccepts({ ready: false, why: 'auth' }) });
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toHaveAttribute('aria-disabled', 'true');
        await expect(item(page)).toContainText('not possible now: the research agent is not signed in');
        await expect(page.locator('#research-item-read-link')).toBeVisible();
        await item(page).click({ force: true });
        await expect(dialog(page)).toHaveCount(0);

        await page.evaluate(() => (window.Strom.UI as any).closeResearchMenu());
        await card(page, 'Jan').click();
        await expect(page.locator('.context-menu:not(.context-submenu)')).toBeVisible();
        const research = page.locator('.context-menu [data-menu="research"]');
        if (await research.count() > 0) {
            await research.click();
            await expect(page.locator('.context-submenu')).toBeVisible();
            await expect(page.locator('.context-submenu [data-action="research-material"], .context-submenu [data-action]').first()).toBeVisible();
        }
        await expect(page.locator('[data-action="research-read"]')).toHaveCount(0);
    });

    test('absent for an archive and for a research that cannot read', async ({ page }) => {
        // An archive: no agent.
        await setup(page, { extra: { mode: 'archive', sync: { auto: 'mirror' } } });
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-sync-block, .research-menu').first()).toBeVisible();
        await expect(item(page)).toHaveCount(0);
    });

    test('absent for an older research (no read.now)', async ({ page }) => {
        await setup(page, { features: [] });
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-open')).toBeVisible();
        await expect(item(page)).toHaveCount(0);
    });

    test('pages: chosen, a file of another type kept as refused, moved and removed', async ({ page }) => {
        await setup(page);
        const d = await openFromMenu(page);
        await addPages(page, [
            { name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG },
            { name: 'popis.txt', mimeType: 'text/plain', buffer: Buffer.from('Lhota 1846') },
            { name: 'zapis-2.jpg', mimeType: 'image/jpeg', buffer: JPEG },
        ]);
        const refused = d.locator('.read-page.is-refused');
        await expect(refused).toHaveCount(1);
        await expect(refused.locator('.read-page-why')).toContainText('not supported');
        await expect(d.locator('.read-pages-sum')).toContainText('2');
        // The second page goes first.
        await d.locator('.read-page:not(.is-refused)').nth(1).locator('[data-act="up"]').click();
        await expect(d.locator('.read-page:not(.is-refused) .read-page-name').first()).toHaveText('zapis-2.jpg');
        await refused.locator('[data-act="remove"]').click();
        await expect(d.locator('.read-page')).toHaveCount(2);
        await expect(d.locator('[data-act="read"]')).toBeEnabled();
    });

    test('sending: a PUT per page marked for reading, then POST /read with person, note, readers and language', { tag: '@smoke' }, async ({ page }) => {
        const b = await setup(page);
        await cardAction(page, 'Jan', 'research-read');
        const d = dialog(page);
        await addPages(page, [{ name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
        await d.locator('#read-note').fill('Lhota, 1846');
        await d.locator('input[name="read-readers"][value="2"]').check();
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        expect(b.mediaPuts).toHaveLength(1);
        const put = b.mediaPuts[0];
        expect(put.headers['x-strom-read']).toBe('1');
        expect(put.headers['x-strom-name']).toBe('zapis.jpg');
        expect(put.headers['x-strom-person']).toBe('P0003');
        expect(put.headers['content-type']).toBe('image/jpeg');
        expect(put.bytes).toBe(JPEG.length);
        expect(b.read!.posts[0]).toEqual({ files: [put.sha], readers: 2, lang: 'en', person: 'P0003', note: 'Lhota, 1846' });
        // The choice of readers is remembered for the next time.
        expect(await page.evaluate(() => localStorage.getItem('read.readers'))).toBe('2');
    });

    test('progress to the result in the dialog; a reader of no told pace has no several-minutes line', async ({ page }) => {
        const b = await setup(page);
        const d = await openFromMenu(page);
        // Not a slow reader (readSlow: under two minutes, or not said): no several-minutes line.
        await expect(d.locator('.read-drop')).toBeVisible();
        await expect(d.locator('.read-slow-note')).toHaveCount(0);
        await addPages(page, [{ name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
        await d.locator('[data-act="read"]').click();
        await expect(d.locator('#read-title')).toHaveText('Reading a document');
        await expect.poll(() => b.read!.posts.length).toBe(1);
        await expect(d.locator('.read-step.is-now')).toHaveCount(1);
        await expect(d.locator('#read-progress-time')).toContainText('Usually within');
        // An older research says nothing of its reader's pace: no several-minutes line.
        await expect(d.locator('.read-progress-expect')).toBeHidden();
        await step(page, b, 'reading');
        await expect(d.locator('.read-step.is-done')).not.toHaveCount(0);
        await step(page, b, 'done', 1);
        await expect(d.locator('#read-result')).toBeVisible();
        await expect(d.locator('.read-transcript').first()).toContainText('Antonii Novák, Lhota');
        // Opened here: the menu offers reading again.
        await page.keyboard.press('Escape');
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toContainText('Read a document…');
    });

    test('a slow reader: the dialog and the progress say reading takes several minutes', async ({ page }) => {
        const b = await setup(page, { read: readAccepts({ expectSecs: 300 }) });
        const d = await openFromMenu(page);
        await expect(d.locator('.read-slow-note')).toHaveText('Reading with this agent takes several minutes.');
        await addPages(page, [{ name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
        await expect(d.locator('#read-foot-note')).toContainText('usually within 5 minutes');
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        await expect(d.locator('.read-progress-expect')).toHaveText('Reading with this agent takes several minutes.');
        await expect(d.locator('#read-progress-time')).toContainText('Usually within 5 minutes');
        // The bridge's own time for the running reading wins.
        b.read!.reads[0].expectSecs = 480;
        await step(page, b, 'reading');
        await expect(d.locator('#read-progress-time')).toContainText('Usually within 8 minutes');
        await expect(d.locator('.read-progress-expect')).toBeVisible();
    });

    test('a slow pace said only by /status shows at once, while queued only the agent\'s own pace counts', async ({ page }) => {
        const b = await setup(page);
        const d = await startReading(page, b);
        await expect(d.locator('#read-progress-time')).toContainText('Usually within 3 minutes');
        await expect(d.locator('.read-progress-expect')).toBeHidden();
        // Queued behind other readings: the time grows, the agent is not slow.
        b.read!.reads[0].state = 'queued';
        b.read!.reads[0].expectSecs = 300;
        await poll(page);
        await expect(d.locator('#read-progress-time')).toContainText('Usually within 5 minutes');
        await expect(d.locator('.read-progress-expect')).toBeHidden();
        // Running: a new expected time alone (same state) brings the line.
        b.read!.reads[0].state = 'reading';
        delete b.read!.reads[0].expectSecs;
        await poll(page);
        await expect(d.locator('#read-progress-time')).toContainText('Usually within 3 minutes');
        await expect(d.locator('.read-progress-expect')).toBeHidden();
        b.read!.reads[0].expectSecs = 240;
        await poll(page);
        await expect(d.locator('#read-progress-time')).toContainText('Usually within 4 minutes');
        await expect(d.locator('.read-progress-expect')).toBeVisible();
    });

    test('dialog closed: the menu says it reads, then the notice when it ends; Show opens the result', async ({ page }) => {
        const b = await setup(page);
        const d = await startReading(page, b);
        await d.locator('.read-footer [data-act="close"]').last().click();
        await expect(dialog(page)).toHaveCount(0);
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toContainText('Reading a document…');
        await page.keyboard.press('Escape');

        await step(page, b, 'done', 1);
        const toast = page.locator('.toast', { hasText: 'Document read' });
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('baptism');
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toContainText('Document read');
        await page.keyboard.press('Escape');
        await toast.locator('.toast-action').click();
        await expect(dialog(page).locator('#read-result')).toBeVisible();
    });

    test('the notice comes once in a reading\'s life: not again after a reload', async ({ page }) => {
        const b = await setup(page);
        const d = await startReading(page, b);
        await d.locator('.read-footer [data-act="close"]').last().click();
        await step(page, b, 'done', 1);
        await expect(page.locator('.toast', { hasText: 'Document read' })).toBeVisible();

        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await poll(page);
        // Still read and not opened: the menu says so; no notice again.
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toContainText('Document read');
        await page.keyboard.press('Escape');
        await poll(page);
        await expect(page.locator('.toast[data-kind="read"]')).toHaveCount(0);
    });

    test('readings that ended long ago (kept from before): no notice at the start', async ({ page }) => {
        const older = 'D20261019153012-a1b2';
        const newer = 'D20261020091500-c3d4';
        const reading = (id: string, state: string, at: string) => ({
            id, state, version: 1, at, since: at, files: 1, pages: 1, readers: 1, done: 1, entries: 1, name: 'rodny-list.jpg', person: '', from: 'app' as const,
        });
        const b = await fakeBridge(page, {
            accepts: accepts(readAccepts()), features: ['read.now'],
            read: fakeRead({ reads: [reading(newer, 'done', '2026-10-20T09:15:00Z'), reading(older, 'unreadable', '2026-10-19T15:30:12Z')] }),
        });
        b.read!.results.set(newer, result(newer));
        // As an older app kept them: the readings, nothing about their notice.
        await page.addInitScript(({ older, newer }) => localStorage.setItem('read.recent', JSON.stringify([
            { id: newer, opened: false, research: '' }, { id: older, opened: false, research: '' },
        ])), { older, newer });
        await openResearch(page, { media: true });
        await poll(page);
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toContainText('Document read');
        await page.keyboard.press('Escape');
        await poll(page);
        await expect(page.locator('.toast[data-kind="read"]')).toHaveCount(0);
    });

    test('cancel: asked of the bridge at once, the dialog says it was cancelled', async ({ page }) => {
        const b = await setup(page);
        const d = await startReading(page, b);
        await d.locator('.read-cancel').click();
        await expect.poll(() => b.read!.cancels).toEqual([READ_ID]);
        await expect(d.locator('.read-error[data-error="cancelled"]')).toBeVisible();
        expect(b.read!.reads[0].state).toBe('cancelled');
    });

    test('the hourly limit: not started, said why', async ({ page }) => {
        const b = await setup(page);
        b.read!.startReply = { status: 429, body: { error: 'Limit.', code: 'read.limit', text: 'Limit.', params: { per: 'hour' } }, retryAfter: '600' };
        const d = await openFromMenu(page);
        await addPages(page, [{ name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
        await d.locator('[data-act="read"]').click();
        await expect(d.locator('.read-error[data-error="limit"]')).toBeVisible();
        await expect(d.locator('.read-error')).toContainText('hourly limit');
        expect(b.read!.reads).toHaveLength(0);
    });
});

/** Nothing in the element is wider than the element itself. */
async function noOverflow(target: Locator): Promise<void> {
    const sizes = await target.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const wider = [...el.querySelectorAll<HTMLElement>('*')]
            .filter(c => c.getClientRects().length > 0)
            // The result's scan strip shows a crop of a larger page on purpose (clipped by its view).
            .filter(c => !c.closest('.read-scan-view'))
            .filter(c => { const r = c.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1; })
            .map(c => c.className || c.tagName);
        return { scroll: el.scrollWidth, client: el.clientWidth, right: box.right, vw: window.innerWidth, wider };
    });
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
    expect(sizes.right).toBeLessThanOrEqual(sizes.vw + 1);
    expect(sizes.wider).toEqual([]);
}

for (const viewport of [DESKTOP, PHONE]) {
    test.describe(`German at ${viewport.width}px`, () => {
        test.use({ viewport, locale: 'de-DE' });

        test('the menu item, the dialog with pages and readers, the progress: nothing runs over', async ({ page }) => {
            // A slow reader: its several-minutes line is on screen too.
            const b = await setup(page, { read: readAccepts({ expectSecs: 240 }) });
            await openResearchMenu(page, { expandMore: true });
            await expect(item(page)).toContainText('Dokument lesen…');
            await noOverflow(item(page));
            await item(page).click();
            const d = dialog(page);
            await expect(d).toBeVisible();
            await addPages(page, [
                { name: 'taufmatrikel-lhota-1846-seite-zwei-und-drei.jpg', mimeType: 'image/jpeg', buffer: JPEG },
                { name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('Lhota') },
            ]);
            await expect(d.locator('.read-readers')).toBeVisible();
            await noOverflow(d.locator('.modal'));
            await d.locator('[data-act="read"]').click();
            await expect.poll(() => b.read!.posts.length).toBe(1);
            await expect(d.locator('.read-steps')).toBeVisible();
            await expect(d.locator('.read-progress-expect')).toBeVisible();
            await noOverflow(d.locator('.modal'));
        });
    });
}

// ==================== The result (§4) ====================

/** A baptism page with two entries, read by two readers who differ in one place (invented). */
function baptismPage(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: READ_ID, state: 'done', lang: 'en',
        doc: { kind: 'register.baptism', language: ['la'], script: 'kurrent', date: '3. 4. 1846', legible: 'yes', why: null },
        readers: { asked: 2, ran: 2, agree: 'differ' },
        pages: [{ n: 1, file: 'I0101', name: 'matrika-lhota-1846.jpg', page: 1, w: 600, h: 800, image: `read/${READ_ID}/page/1.jpg` }],
        entries: [
            {
                id: 'e1', page: 1, region: [0.08, 0.08, 0.84, 0.26],
                transcript: 'Anna filia legitima\nGeorgii Svoboda, Lhota',
                persons: [{ ref: 'p1', role: 'child', given: 'Anna', surname: 'Svobodová', match: [{ person: 'P0002', why: 'name', score: 0.5 }] }],
            },
            {
                id: 'e2', page: 1, region: [0.08, 0.42, 0.84, 0.36],
                transcript: 'Joannes[?] filius legitimus\nAntonii Novák et Mariae [...]\nLhota N. 12 | patrinus Wenceslaus',
                variants: [{ at: 'Novák', other: 'Nowak' }],
                translation: 'Jan[?], legitimate son\nof Antonín Novák and Marie [...]',
                glossary: [
                    { term: 'filius legitimus', meaning: 'legitimate son', kind: 'term' },
                    { term: 'patrinus', meaning: 'godfather', kind: 'term' },
                    { term: 'inquilinus', meaning: 'cottager without land', kind: 'occupation' },
                ],
                persons: [
                    { ref: 'p1', role: 'child', given: 'Joannes', surname: 'Novák', match: [{ person: 'P0003', why: 'name, place', score: 0.8 }] },
                    { ref: 'p2', role: 'father', given: 'Antonius', surname: 'Novák' },
                    { ref: 'p3', role: 'godparent', given: 'Wenceslaus', surname: '' },
                ],
            },
        ],
        context: 'A Catholic baptism register of the parish; Latin form with columns for the house, the child and the parents.',
        version: 1, ...over,
    };
}

/** One entry of a document of another kind. */
function oneEntry(kind: string, language: string[], entry: Record<string, unknown>, doc: Record<string, unknown> = {}): Record<string, unknown> {
    return baptismPage({
        doc: { kind, language, script: '', date: '1921', legible: 'yes', why: null, ...doc },
        readers: { asked: 1, ran: 1, agree: null },
        entries: [{ id: 'e1', page: 1, region: [0.1, 0.1, 0.8, 0.3], ...entry }],
        context: '',
    });
}

/** The bridge has a finished reading with this result; the dialog opens on it. */
async function showResult(page: Page, res: Record<string, unknown>, person = ''): Promise<{ d: Locator; b: FakeBridge }> {
    const b = await setup(page);
    const now = new Date().toISOString();
    b.read!.reads = [{ id: READ_ID, state: 'done', version: 1, at: now, since: now, files: 1, pages: 1, readers: 1, done: 1,
        entries: (res.entries as unknown[]).length, name: 'matrika-lhota-1846.jpg', person, from: 'app' }];
    b.read!.results.set(READ_ID, res);
    await poll(page);
    await page.evaluate((id) => (window.Strom.UI as any).showReadDocumentDialog({ readId: id }), READ_ID);
    const d = dialog(page);
    await expect(d.locator('#read-result')).toBeVisible();
    return { d, b };
}

test.describe('Read a document: the result', () => {
    test.use({ viewport: DESKTOP });

    test('title, pills, the entry of the dialog\'s person, marks by shape and the legend of those present', { tag: '@smoke' }, async ({ page }) => {
        const { d, b } = await showResult(page, baptismPage(), 'P0003');
        await expect(d.locator('#read-title')).toHaveText('Baptism entry, Latin, Kurrent, 1846');
        await expect(d.locator('.read-file')).toHaveText('matrika-lhota-1846.jpg');
        await expect(d.locator('.read-pill[data-pill="legible"]')).toHaveText('legible');
        await expect(d.locator('.read-pill[data-pill="legible"]')).toHaveClass(/is-ok/);
        await expect(d.locator('.read-pill[data-pill="readers"]')).toHaveText('2 readers, 1 place differs');
        await expect(d.locator('.read-pill[data-pill="readers"]')).toHaveClass(/is-warn/);
        // The entry with the person the dialog was about (P0003) is chosen.
        await expect(d.locator('.read-entry-pill[aria-pressed="true"]')).toContainText('2');
        await expect(d.locator('.read-entry-pill[aria-pressed="true"]')).toContainText('Joannes Novák');
        const tr = d.locator('.read-transcript');
        await expect(tr).toContainText('filius legitimus');
        // Uncertain: a dotted mark; illegible: a block with its own label; differing: A / B.
        await expect(tr.locator('mark.uncertain')).toHaveCount(1);
        await expect(tr.locator('mark.uncertain')).toContainText('Joannes');
        const ill = tr.locator('.illegible');
        await expect(ill).toHaveCount(1);
        await expect(ill).toHaveAttribute('aria-label', 'illegible spot');
        await expect(ill).toHaveText('illegible');
        expect(await ill.evaluate(el => getComputedStyle(el).display)).toBe('inline-block');
        expect(await tr.locator('mark.uncertain').evaluate(el => getComputedStyle(el).borderBottomStyle)).toBe('dotted');
        const variant = tr.locator('.read-variant');
        await expect(variant.locator('.read-variant-a')).toHaveText('Novák');
        await expect(variant.locator('.read-variant-slash')).toHaveText('/');
        await expect(variant.locator('.read-variant-b')).toHaveText('Nowak');
        await expect(tr).toContainText('|');
        const legend = d.locator('.read-legend li');
        await expect(legend).toHaveCount(3);
        await expect(legend.nth(1)).toContainText('the first reads “Novák”, the second “Nowak”');
        // Translation (Latin ≠ English), with its marks.
        const translation = d.locator('.read-section--translation');
        await expect(translation).toContainText('legitimate son');
        await expect(translation.locator('mark.uncertain')).toHaveCount(1);
        await expect(translation.locator('.illegible')).toHaveCount(1);
        // Explanation: terms with their kind, then about the document.
        const gloss = d.locator('.read-section--gloss');
        await expect(gloss.locator('dt')).toHaveCount(3);
        await expect(gloss).toContainText('cottager without land');
        await expect(gloss.locator('.read-gloss-kind')).toHaveText('occupation');
        await expect(gloss).toContainText('3 terms');
        await expect(gloss.locator('.read-about')).toContainText('A Catholic baptism register');
        // The scan: the page from the bridge, the chosen entry's frame solid.
        await expect.poll(() => b.read!.pageAsks.length).toBeGreaterThan(0);
        await expect(d.locator('.read-frame')).toHaveCount(2);
        await expect(d.locator('.read-frame.is-selected')).toHaveAttribute('data-entry', '1');
        await expect(d.locator('.read-scan-var')).toHaveCount(1);
        // Footer: kept in the history, Suggest for the tree… as the main action.
        await expect(d.locator('.read-kept')).toHaveText('The result stays in the reading history');
        await expect(d.locator('.read-footer .primary')).toHaveText('Suggest for the tree…');
    });

    test('a line on the text marks it on the scan; a click into the frame marks the line in the text', async ({ page }) => {
        const { d } = await showResult(page, baptismPage(), 'P0003');
        const line = d.locator('#read-scan-line');
        await expect(line).toBeHidden();
        await d.locator('.read-line[data-line="1"]').click();
        await expect(d.locator('.read-line[data-line="1"]')).toHaveClass(/is-active/);
        await expect(line).toBeVisible();
        await expect(line).toHaveClass(/is-variant/);
        const frame = d.locator('.read-frame.is-selected');
        const box = (await frame.boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * (5 / 6));
        await expect(d.locator('.read-line.is-active')).toHaveAttribute('data-line', '2');
        await expect(line).not.toHaveClass(/is-variant/);
    });

    test('several entries: a pill or a frame chooses one; the text and the suggestion follow', async ({ page }) => {
        const { d } = await showResult(page, baptismPage());
        // Without a person: the first entry.
        await expect(d.locator('.read-frame.is-selected')).toHaveAttribute('data-entry', '0');
        await expect(d.locator('.read-transcript')).toContainText('Georgii Svoboda');
        await expect(d.locator('.read-section--translation')).toHaveCount(0);
        await expect(d.locator('.read-legend')).toHaveCount(0);
        await d.locator('.read-frame[data-entry="1"]').click();
        await expect(d.locator('.read-frame.is-selected')).toHaveAttribute('data-entry', '1');
        await expect(d.locator('.read-entry-pill[data-entry="1"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(d.locator('.read-transcript')).toContainText('Joannes');
        await expect(d.locator('.read-section--translation')).toBeVisible();
        await d.locator('.read-entry-pill[data-entry="0"]').click();
        await expect(d.locator('.read-transcript')).toContainText('Anna filia legitima');
        await expect(d.locator('.read-frame.is-selected')).toHaveAttribute('data-entry', '0');
    });

    test('copy: the transcription with its original marks', async ({ page }) => {
        const { d } = await showResult(page, baptismPage(), 'P0003');
        await page.evaluate(() => {
            (window as any).__copied = null;
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { (window as any).__copied = t; } } });
        });
        await d.locator('[data-act="copy"]').click();
        await expect(page.locator('.toast', { hasText: 'Transcription copied' })).toBeVisible();
        expect(await page.evaluate(() => (window as any).__copied))
            .toBe('Joannes[?] filius legitimus\nAntonii Novák et Mariae [...]\nLhota N. 12 | patrinus Wenceslaus');
    });

    test('the explanation folds, and stays folded next time', async ({ page }) => {
        const { d } = await showResult(page, baptismPage(), 'P0003');
        const toggle = d.locator('.read-gloss-toggle');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(d.locator('#read-gloss-body')).toBeHidden();
        expect(await page.evaluate(() => localStorage.getItem('read.glossOpen'))).toBe('0');
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await page.evaluate((id) => (window.Strom.UI as any).showReadDocumentDialog({ readId: id }), READ_ID);
        await expect(dialog(page).locator('.read-gloss-toggle')).toHaveAttribute('aria-expanded', 'false');
    });

    test('in the app\'s language: no translation', async ({ page }) => {
        const { d } = await showResult(page, oneEntry('letter', ['en'], {
            transcript: 'Dear brother,\nwe are well in Lhota.', translation: 'Dear brother, we are well in Lhota.',
            persons: [{ ref: 'p1', role: 'writer', given: 'Marie', surname: 'Nováková' }, { ref: 'p2', role: 'addressee', given: 'Josef', surname: 'Novák' }],
        }));
        await expect(d.locator('#read-title')).toHaveText('Letter, English, 1921');
        await expect(d.locator('.read-transcript')).toContainText('we are well in Lhota');
        await expect(d.locator('.read-section--translation')).toHaveCount(0);
        // No data, no section: no explanation, no legend.
        await expect(d.locator('.read-section--gloss')).toHaveCount(0);
        await expect(d.locator('.read-legend')).toHaveCount(0);
        await expect(d.locator('.read-pill[data-pill="readers"]')).toHaveText('1 reader');
        await expect(d.locator('.read-pill[data-pill="readers"]')).toHaveClass(/is-muted/);
        await expect(d.locator('[data-act="propose"]')).toBeVisible();
    });

    test('sections by kind: a gravestone\'s inscription and symbols', async ({ page }) => {
        const { d } = await showResult(page, oneEntry('gravestone', ['de'], {
            transcript: 'Hier ruht\nJosef Novák\n† 1921', translation: 'Here rests\nJosef Novák\n† 1921',
            glossary: [{ term: '†', meaning: 'died', kind: 'symbol' }],
            persons: [{ ref: 'p1', role: 'deceased', given: 'Josef', surname: 'Novák' }],
        }));
        await expect(d.locator('#read-s-transcript')).toHaveText('Inscription');
        await expect(d.locator('.read-section--gloss')).toContainText('symbols');
        await expect(d.locator('.read-gloss-kind')).toHaveText('symbol');
        await expect(d.locator('.read-section--mentioned')).toHaveCount(0);
        await expect(d.locator('[data-act="propose"]')).toBeVisible();
    });

    test('sections by kind: the back of a photo lists the mentioned, without a suggestion', async ({ page }) => {
        const { d: d2 } = await showResult(page, oneEntry('photo.back', ['cs'], {
            transcript: 'Teta Marie a strýc Josef, Lhota 1921',
            translation: 'Aunt Marie and uncle Josef, Lhota 1921',
            persons: [{ ref: 'p1', role: 'mentioned', given: 'Marie', surname: '' }, { ref: 'p2', role: 'mentioned', given: 'Josef', surname: '' }],
        }));
        await expect(d2.locator('#read-title')).toHaveText('Back of a photo, Czech, 1921');
        await expect(d2.locator('#read-s-transcript')).toHaveText('Transcription');
        await expect(d2.locator('.read-section--translation')).toBeVisible();
        await expect(d2.locator('.read-section--mentioned')).toContainText('Mentioned');
        await expect(d2.locator('.read-mentioned li')).toHaveCount(2);
        await expect(d2.locator('[data-act="propose"]')).toHaveCount(0);
        await expect(d2.locator('.read-footer .primary')).toHaveText('Close');
    });

    test('partly legible: the note over the text, Insert a better photo goes back to the input', async ({ page }) => {
        const { d } = await showResult(page, baptismPage({
            doc: { kind: 'register.death', language: ['la'], script: '', date: '1850', legible: 'partly', why: 'glare' },
        }), 'P0003');
        await expect(d.locator('#read-title')).toHaveText('Death entry, Latin, 1850');
        await expect(d.locator('.read-pill[data-pill="legible"]')).toHaveText('partly legible');
        await expect(d.locator('.read-pill[data-pill="legible"]')).toHaveClass(/is-warn/);
        const note = d.locator('.read-partial');
        await expect(note).toContainText('Partly legible:');
        await expect(note).toContainText('glare over the text');
        await note.locator('[data-act="insert-other"]').click();
        await expect(d.locator('#read-drop')).toBeVisible();
    });

    test('while it reads: the entries read so far show under the progress', async ({ page }) => {
        const b = await setup(page);
        const d = await startReading(page, b);
        const r = b.read!.reads[0];
        r.state = 'reading';
        r.entries = 1;
        b.read!.results.set(r.id, { ...result(r.id), state: 'reading', entries: [{ id: 'e1', page: 1, transcript: 'Joannes[?] filius\nAntonii Novák', persons: [] }] });
        await poll(page);
        const sofar = d.locator('.read-sofar');
        await expect(sofar).toContainText('Read so far · 1 entry');
        await expect(sofar.locator('mark.uncertain')).toContainText('Joannes');
        await expect(d.locator('#read-title')).toHaveText('Reading a document');
    });
});


for (const viewport of [DESKTOP, { width: 1024, height: 768 }, PHONE]) {
    test.describe(`The result in German at ${viewport.width}px`, () => {
        test.use({ viewport, locale: 'de-DE' });

        test('scan and text, the pills, the footer: nothing runs over', async ({ page }) => {
            const { d } = await showResult(page, baptismPage({
                doc: { kind: 'register.baptism', language: ['la'], script: 'kurrent', date: '1846', legible: 'partly', why: 'glare' },
                pages: [{ n: 1, file: 'I0101', name: 'taufmatrikel-lhota-1846-seite-zwei-und-drei-mit-randvermerken.jpg', page: 1, w: 600, h: 800, image: `read/${READ_ID}/page/1.jpg` }],
            }), 'P0003');
            await expect(d.locator('#read-title')).toHaveText('Taufeintrag, Latein, Kurrent, 1846');
            await expect(d.locator('.read-pill[data-pill="readers"]')).toHaveText('2 Leser, 1 Stelle weicht ab');
            await expect(d.locator('[data-act="propose"]')).toHaveText('In den Stammbaum vorschlagen…');
            await expect(d.locator('.read-kept')).toHaveText('Das Ergebnis bleibt im Leseverlauf');
            await expect(d.locator('.read-scan-img')).toBeVisible();
            await noOverflow(d.locator('.modal'));
            await noOverflow(d.locator('.read-text'));
            await noOverflow(d.locator('.read-footer'));
            const scan = (await d.locator('#read-scan').boundingBox())!;
            const text = (await d.locator('#read-text').boundingBox())!;
            if (viewport.width > 1180) {
                expect(Math.round(scan.width)).toBe(520);
                expect(text.x).toBeGreaterThan(scan.x + scan.width - 2);
            } else if (viewport.width > 900) {
                // 2 : 3 beside each other.
                expect(scan.width / (scan.width + text.width)).toBeCloseTo(0.4, 1);
            } else {
                // The scan as a strip on top with the chosen entry's crop; the text below it.
                await expect(d.locator('.read-scan-view')).toHaveClass(/is-strip/);
                expect(text.y).toBeGreaterThanOrEqual(scan.y + scan.height - 2);
                const box = (await d.locator('.read-scan-box').boundingBox())!;
                expect(box.height).toBeGreaterThanOrEqual(200);
                expect(box.height).toBeLessThanOrEqual(220);
                const frame = (await d.locator('.read-frame.is-selected').boundingBox())!;
                expect(frame.width).toBeGreaterThan(box.width * 0.8);
                const foot = (await d.locator('[data-act="propose"]').boundingBox())!;
                expect(foot.height).toBeGreaterThanOrEqual(44);
                // ⤢ shows the whole page in the image viewer.
                await d.locator('[data-act="open-page"]').click();
                await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
                await expect(page.locator('#attachment-overlay-img')).toHaveAttribute('src', /read\/D20261019153012-a1b2\/page\/1\.jpg/);
            }
        });
    });
}
